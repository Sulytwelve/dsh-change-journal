import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { makeStore, tempDir } from './support/fixtures.mjs'

function append(store, overrides = {}) {
  return store.appendEvent({
    opId: overrides.opId ?? 'op-1',
    type: overrides.type ?? 'open',
    atMs: overrides.atMs ?? Date.now(),
    eventId: overrides.eventId,
    actor: { sessionId: 's1', source: 'test' },
    data: overrides.data ?? { target: '/tmp/x', intent: 'test' },
  })
}

test('an appended event round-trips with its schema and byte offset', () => {
  const { store } = makeStore()
  const appended = append(store)
  const read = store.readEvents()
  assert.equal(read.events.length, 1)
  assert.equal(read.events[0].schema, 'dsh.change-journal/event@1')
  assert.equal(read.events[0].opId, 'op-1')
  assert.equal(read.events[0].offset, appended.offset)
  assert.equal(read.damaged.length, 0)
})

test('the same eventId is acknowledged once, not appended twice', () => {
  const { store } = makeStore()
  const first = append(store, { eventId: 'evt-fixed' })
  const second = append(store, { eventId: 'evt-fixed' })
  assert.equal(first.duplicate, false)
  assert.equal(second.duplicate, true)
  assert.equal(store.readEvents().events.length, 1)
})

test('a crash-partial trailing line is reported, preserved, and appended after', () => {
  const { stateDir, store } = makeStore()
  append(store)
  const month = new Date().toISOString().slice(0, 7)
  const file = path.join(stateDir, 'journal', `${month}.jsonl`)
  fs.appendFileSync(file, '{"partial":')
  const before = store.readEvents()
  assert.ok(before.damaged.some(item => item.reason === 'partial trailing line'))
  assert.equal(before.events.length, 1)
  append(store, { type: 'note', data: { text: 'after crash' } })
  const after = store.readEvents()
  assert.equal(after.events.length, 2, 'accepted history and the new event survive')
  assert.ok(after.damaged.length >= 1, 'the damaged bytes are still reported')
  assert.ok(after.events.some(event => event.type === 'note'))
})

test('a malformed middle line is skipped and its offset reported', () => {
  const { stateDir, store } = makeStore()
  append(store)
  const month = new Date().toISOString().slice(0, 7)
  const file = path.join(stateDir, 'journal', `${month}.jsonl`)
  fs.appendFileSync(file, 'not json\n')
  append(store, { type: 'note', data: { text: 'later' } })
  const read = store.readEvents()
  assert.equal(read.events.length, 2)
  assert.equal(read.damaged.length, 1)
  assert.ok(read.damaged[0].offset > 0)
})

test('gc keeps segments holding an unresolved operation and removes resolved old ones', () => {
  const { store } = makeStore({ retentionDays: 1 })
  const old = Date.now() - 90 * 24 * 60 * 60 * 1000
  // Unresolved operation in an old segment: open + mutation without a check.
  const unresolved = append(store, { opId: 'op-unresolved', type: 'open', atMs: old })
  append(store, { opId: 'op-unresolved', type: 'mutation', atMs: old, data: { delta: 'x', post: 'v2', postHash: 'a'.repeat(64) } })
  // Resolved operation in a different old segment (different month).
  const older = old - 31 * 24 * 60 * 60 * 1000
  append(store, { opId: 'op-resolved', type: 'open', atMs: older })
  append(store, { opId: 'op-resolved', type: 'mutation', atMs: older, data: { delta: 'x', post: 'v2', postHash: 'b'.repeat(64) } })
  append(store, { opId: 'op-resolved', type: 'verify', atMs: older, data: { command: 'check', exitCode: 0 } })

  const result = store.gc()
  assert.ok(result.protected.length >= 1, 'unresolved segment is protected')
  assert.ok(result.removed.length >= 1, 'resolved old segment is removed')
  assert.ok(result.protected.some(entry => entry.opIds.includes('op-unresolved')))
  assert.ok(fs.existsSync(unresolved.file))
})
