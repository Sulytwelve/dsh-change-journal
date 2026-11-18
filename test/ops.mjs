import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeStore, tempDir } from './support/fixtures.mjs'
import {
  openOperation, recordBackup, recordMutation, recordRollback, recordVerification,
  checkRollback, getOperation, todayOperations, unverifiedOperations,
} from '../lib/ops.mjs'
import { sha256Text } from '../lib/util.mjs'

const actor = { sessionId: 's1', source: 'test' }

async function fullFixture() {
  const { stateDir, config, store } = makeStore()
  const target = path.join(stateDir, 'target.txt')
  fs.writeFileSync(target, 'one\n')
  const backupFile = path.join(stateDir, 'backup.txt')
  fs.copyFileSync(target, backupFile)
  const opened = await openOperation({ store, target, intent: 'append two', actor, nowMs: Date.now() })
  const backup = await recordBackup({ store, config, opId: opened.opId, uri: backupFile, actor, nowMs: Date.now() })
  await recordMutation({ store, opId: opened.opId, delta: 'append two', pre: 'v1', post: 'v2', postHash: sha256Text('one\ntwo\n'), actor, nowMs: Date.now() })
  await recordVerification({ store, config, opId: opened.opId, command: 'grep -qx two target.txt', exitCode: 1, output: 'missing', actor, nowMs: Date.now() })
  await recordMutation({ store, opId: opened.opId, delta: 'append two (fixed)', pre: 'v2', post: 'v3', postHash: sha256Text('one\ntwo\n'), actor, nowMs: Date.now() })
  await recordVerification({ store, config, opId: opened.opId, command: 'grep -qx two target.txt', exitCode: 0, output: 'two', actor, nowMs: Date.now() })
  return { stateDir, config, store, target, backupFile, opId: opened.opId, backup }
}

test('the acceptance fixture records both attempts, the failing output and a passing check', async () => {
  const fixture = await fullFixture()
  const operation = getOperation(fixture.store, fixture.opId).operation
  assert.equal(fixture.backup.state, 'verified')
  assert.equal(operation.mutations.length, 2)
  assert.equal(operation.verifications.length, 2)
  assert.equal(operation.verifications[0].exitCode, 1)
  assert.equal(operation.verifications[0].output, 'missing')
  assert.equal(operation.state, 'verified')
  assert.equal(operation.unresolved, false)
  assert.equal(unverifiedOperations({ store: fixture.store }).operations.length, 0)
  const today = todayOperations({ store: fixture.store, timezone: 'UTC', nowMs: Date.now() })
  assert.ok(today.operations.some(item => item.opId === fixture.opId))
})

test('a remote backup is recorded pending, not claimed as verified', async () => {
  const { config, store } = makeStore()
  const opened = await openOperation({ store, target: '/tmp/x', intent: 'edit', actor, nowMs: Date.now() })
  const result = await recordBackup({ store, config, opId: opened.opId, uri: 's3://bucket/backup.tgz', actor, nowMs: Date.now() })
  assert.equal(result.state, 'pending')
  assert.match(result.text, /remote/)
})

test('a digest mismatch is recorded and not treated as a successful backup', async () => {
  const { stateDir, config, store } = makeStore()
  const backup = path.join(stateDir, 'backup.txt')
  fs.writeFileSync(backup, 'data')
  const opened = await openOperation({ store, target: '/tmp/x', intent: 'edit', actor, nowMs: Date.now() })
  const result = await recordBackup({ store, config, opId: opened.opId, uri: backup, sha256: 'a'.repeat(64), actor, nowMs: Date.now() })
  assert.equal(result.state, 'mismatch')
  assert.equal(result.ok, false)
})

test('a verification output is bounded and rollback commands are redacted', async () => {
  const { config, store } = makeStore()
  const opened = await openOperation({ store, target: '/tmp/x', intent: 'edit', actor, nowMs: Date.now() })
  await recordMutation({ store, opId: opened.opId, delta: 'edit', post: 'v2', postHash: 'b'.repeat(64), actor, nowMs: Date.now() })
  await recordVerification({ store, config, opId: opened.opId, command: 'check', exitCode: 0, output: 'x'.repeat(config.maxVerifyOutputBytes + 100), actor, nowMs: Date.now() })
  const rollback = await recordRollback({
    store, opId: opened.opId, command: 'deploy --token=supersecret --target prod',
    workdir: '/srv', preconditions: ['service stopped'], actor, nowMs: Date.now(),
  })
  assert.equal(rollback.redacted, true)
  const operation = getOperation(store, opened.opId).operation
  assert.ok(operation.rollback.command.includes('--token=***'))
  assert.ok(!operation.rollback.command.includes('supersecret'))
  assert.equal(operation.rollback.expectedPostSha256, 'b'.repeat(64))
  assert.ok(operation.verifications[0].output.length < config.maxVerifyOutputBytes + 100)
})

test('rollback-check detects a target that changed after the recorded post state', async () => {
  const { stateDir, config, store } = makeStore()
  const target = path.join(stateDir, 'target.txt')
  fs.writeFileSync(target, 'after\n')
  const opened = await openOperation({ store, target, intent: 'edit', actor, nowMs: Date.now() })
  await recordMutation({ store, opId: opened.opId, delta: 'edit', post: 'v2', postHash: sha256Text('after\n'), actor, nowMs: Date.now() })
  await recordRollback({ store, opId: opened.opId, command: 'restore', actor, nowMs: Date.now() })

  const match = await checkRollback({ store, config, opId: opened.opId, actor, nowMs: Date.now() })
  assert.equal(match.result, 'match')

  fs.writeFileSync(target, 'someone else\n')
  const mismatch = await checkRollback({ store, config, opId: opened.opId, actor, nowMs: Date.now() })
  assert.equal(mismatch.result, 'mismatch')
  assert.match(mismatch.text, /changed after/)

  const operation = getOperation(store, opened.opId).operation
  assert.deepEqual(operation.rollbackChecks.map(check => check.result), ['match', 'mismatch'])
})

test('an unknown operation is rejected before any event is written', async () => {
  const { store } = makeStore()
  await assert.rejects(
    recordMutation({ store, opId: 'op-nope', delta: 'x', post: 'v', actor, nowMs: Date.now() }),
    /unknown operation/,
  )
  assert.equal(store.readEvents().events.length, 0)
})

test('today filters by the requested time zone', async () => {
  const { store } = makeStore()
  const opened = await openOperation({ store, target: '/tmp/x', intent: 'edit', actor, nowMs: Date.now() })
  const today = todayOperations({ store, timezone: 'Pacific/Kiritimati', nowMs: Date.now() })
  assert.equal(today.zone, 'Pacific/Kiritimati')
  assert.ok(today.operations.some(item => item.opId === opened.opId))
})
