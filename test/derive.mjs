import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveOperations } from '../lib/derive.mjs'

const BASE = 1_790_000_000_000

function event(type, atMs, data = {}, opId = 'op-1') {
  return { opId, type, atMs, at: new Date(atMs).toISOString(), actor: { sessionId: 's1', source: 'test' }, data }
}

test('an opened operation with no mutation is open and not unresolved', () => {
  const [operation] = deriveOperations([event('open', BASE, { target: '/tmp/x', intent: 'edit' })])
  assert.equal(operation.state, 'open')
  assert.equal(operation.unresolved, false)
})

test('a mutation without a post state is interrupted', () => {
  const [operation] = deriveOperations([
    event('open', BASE, { target: '/tmp/x', intent: 'edit' }),
    event('mutation', BASE + 10, { delta: 'edit' }),
  ])
  assert.equal(operation.state, 'interrupted')
  assert.equal(operation.unresolved, true)
})

test('a failed check is check-failed; a later success verifies', () => {
  const failed = deriveOperations([
    event('open', BASE, { target: '/tmp/x', intent: 'edit' }),
    event('mutation', BASE + 10, { delta: 'edit', post: 'v2' }),
    event('verify', BASE + 20, { command: 'check', exitCode: 1 }),
  ])[0]
  assert.equal(failed.state, 'check-failed')
  assert.equal(failed.unresolved, true)

  const passed = deriveOperations([
    event('open', BASE, { target: '/tmp/x', intent: 'edit' }),
    event('mutation', BASE + 10, { delta: 'edit', post: 'v2' }),
    event('verify', BASE + 20, { command: 'check', exitCode: 1 }),
    event('mutation', BASE + 30, { delta: 'fix', post: 'v3' }),
    event('verify', BASE + 40, { command: 'check', exitCode: 0 }),
  ])[0]
  assert.equal(passed.state, 'verified')
  assert.equal(passed.unresolved, false)
  assert.equal(passed.verifiedAtMs, BASE + 40)
})

test('a later mutation invalidates an earlier successful check', () => {
  const [operation] = deriveOperations([
    event('open', BASE, { target: '/tmp/x', intent: 'edit' }),
    event('mutation', BASE + 10, { delta: 'v2', post: 'v2' }),
    event('verify', BASE + 20, { command: 'check', exitCode: 0 }),
    event('mutation', BASE + 30, { delta: 'v3', post: 'v3' }),
  ])
  assert.equal(operation.state, 'mutated')
  assert.equal(operation.unresolved, true)
  assert.equal(operation.verifiedAtMs, null)
})

test('backup state reflects the latest backup record', () => {
  const [operation] = deriveOperations([
    event('open', BASE, { target: '/tmp/x', intent: 'edit' }),
    event('backup', BASE + 5, { state: 'pending', uri: 's3://bucket/x' }),
    event('backup', BASE + 6, { state: 'verified', uri: '/tmp/backup', sha256: 'a'.repeat(64) }),
  ])
  assert.equal(operation.backupState, 'verified')
  assert.equal(operation.backup.uri, '/tmp/backup')
})
