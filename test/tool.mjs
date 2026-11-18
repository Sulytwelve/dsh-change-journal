import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { apply } from '../index.js'
import { tempDir } from './support/fixtures.mjs'

function makeCtx() {
  const handlers = {}
  const tools = []
  const ctx = {
    logger: { warn() {} },
    on(event, handler) { handlers[event] = handler; return () => {} },
    effect(callback) { const disposer = callback(); return typeof disposer === 'function' ? disposer : () => {} },
    tools: { register(definition) { tools.push(definition); return () => {} } },
  }
  return { ctx, handlers, tools }
}

test('apply registers one change tool and a passing heartbeat', () => {
  const stateDir = tempDir()
  const { ctx, tools } = makeCtx()
  apply(ctx, { stateDir })
  assert.equal(tools.length, 1)
  const heartbeat = JSON.parse(fs.readFileSync(path.join(stateDir, 'plugin-loaded.json'), 'utf8'))
  assert.equal(heartbeat.plugin, 'change-journal')
  assert.equal(heartbeat.hooks.tool, true)
  assert.equal(heartbeat.selfTest.ok, true)
  fs.rmSync(stateDir, { recursive: true, force: true })
})

test('the change tool records the operation lifecycle and answers queries', async () => {
  const stateDir = tempDir()
  const target = path.join(stateDir, 'target.txt')
  fs.writeFileSync(target, 'one\n')
  const backup = path.join(stateDir, 'backup.txt')
  fs.copyFileSync(target, backup)
  const { ctx, tools } = makeCtx()
  apply(ctx, { stateDir })
  const tool = tools[0]
  const exec = { name: 'change', callId: 'call-1', agent: { id: 'session-1' } }

  const opened = await tool.execute({ op: 'open', target, intent: 'append two' }, exec)
  assert.equal(opened.ok, true)
  const opId = /opened (op-\S+)/.exec(opened.text)[1]

  const backed = await tool.execute({ op: 'backup', opId, uri: backup }, exec)
  assert.equal(backed.ok, true)
  assert.match(backed.text, /verified/)

  const mutated = await tool.execute({ op: 'mutation', opId, delta: 'append two', pre: 'v1', post: 'v2' }, exec)
  assert.equal(mutated.ok, true)

  const failed = await tool.execute({ op: 'verify', opId, command: 'grep', exitCode: 1, output: 'missing' }, exec)
  assert.equal(failed.ok, true)
  assert.match(failed.text, /exit 1/)

  await tool.execute({ op: 'rollback', opId, command: 'cp backup target', workdir: stateDir, preconditions: 'target exists' }, exec)
  const check = await tool.execute({ op: 'rollback-check', opId }, exec)
  assert.equal(check.ok, false, 'no recorded post hash means unavailable')

  const got = await tool.execute({ op: 'get', opId }, exec)
  assert.match(got.text, /mutation 1/)
  assert.match(got.text, /rollback/)

  const unverified = await tool.execute({ op: 'unverified' }, exec)
  assert.match(unverified.text, /unverified operations: 1/)

  const today = await tool.execute({ op: 'today', tz: 'UTC' }, exec)
  assert.match(today.text, new RegExp(opId))

  const unknown = await tool.execute({ op: 'nope' }, exec)
  assert.equal(unknown.ok, false)
  fs.rmSync(stateDir, { recursive: true, force: true })
})

test('tool errors degrade to ok:false text, never a throw', async () => {
  const stateDir = tempDir()
  const { ctx, tools } = makeCtx()
  apply(ctx, { stateDir })
  const result = await tools[0].execute({ op: 'backup', opId: 'op-missing', uri: '/tmp/x' }, { name: 'change', agent: { id: 's' } })
  assert.equal(result.ok, false)
  assert.match(result.text, /unknown operation/)
  fs.rmSync(stateDir, { recursive: true, force: true })
})

test('enabled:false registers nothing', () => {
  const { ctx, tools, handlers } = makeCtx()
  apply(ctx, { enabled: false, stateDir: tempDir() })
  assert.equal(tools.length, 0)
  assert.equal(handlers['fs/observed'], undefined)
})
