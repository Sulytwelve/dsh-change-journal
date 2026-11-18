import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { apply } from '../index.js'
import { deriveOperations } from '../lib/derive.mjs'
import { createStore } from '../lib/store.mjs'
import { normalizeConfig } from '../lib/config.mjs'
import { tempDir } from './support/fixtures.mjs'

function makeCtx() {
  const handlers = {}
  const ctx = {
    logger: { warn() {} },
    tools: { register() { return () => {} } },
    on(event, handler) { handlers[event] = handler; return () => {} },
    effect(callback) { const disposer = callback(); return typeof disposer === 'function' ? disposer : () => {} },
  }
  return { ctx, handlers }
}

test('passive fs observations are recorded unattributed and never become operations', () => {
  const stateDir = tempDir()
  const { ctx, handlers } = makeCtx()
  apply(ctx, { stateDir, passive: true })
  assert.equal(typeof handlers['fs/observed'], 'function')
  handlers['fs/observed'](
    { targetKey: 'key-1', displayPath: '/tmp/example.txt' },
    { kind: 'present', version: 'v7' },
    { name: 'fs', callId: 'call-9', agent: { id: 'session-9' } },
  )
  const read = JSON.parse(fs.readFileSync(path.join(stateDir, 'plugin-loaded.json'), 'utf8'))
  assert.equal(read.passive, true)

  const store = createStore({ stateDir, config: normalizeConfig({}) })
  const journal = store.readEvents().events
  const observation = journal.find(event => event.type === 'observation')
  assert.ok(observation)
  assert.equal(observation.data.attribution, 'unattributed')
  assert.equal(observation.data.displayPath, '/tmp/example.txt')
  assert.equal(observation.actor.tool, 'fs')
  assert.equal(deriveOperations(journal).length, 0)
  fs.rmSync(stateDir, { recursive: true, force: true })
})

test('passive:false registers no fs listener', () => {
  const { ctx, handlers } = makeCtx()
  apply(ctx, { stateDir: tempDir(), passive: false })
  assert.equal(handlers['fs/observed'], undefined)
})
