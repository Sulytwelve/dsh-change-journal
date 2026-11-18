import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const cli = path.join(root, 'bin', 'cli.mjs')

function run(args, stateDir) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DSH_CHANGE_JOURNAL_STATE_DIR: stateDir },
  })
}

function temp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ms-journal-cli-'))
}

test('the CLI records a full operation and answers today/unverified', () => {
  const stateDir = temp()
  const target = path.join(stateDir, 'target.txt')
  fs.writeFileSync(target, 'one\n')
  const backup = path.join(stateDir, 'backup.txt')
  fs.copyFileSync(target, backup)

  const opened = run(['open', '--target', target, '--intent', 'append two'], stateDir)
  assert.equal(opened.status, 0, opened.stderr)
  const opId = /opened (op-\S+)/.exec(opened.stdout)[1]

  const backed = run(['backup', opId, '--uri', backup], stateDir)
  assert.equal(backed.status, 0)
  assert.match(backed.stdout, /verified/)

  run(['mutation', opId, '--delta', 'append two', '--post', 'v2'], stateDir)
  run(['verify', opId, '--command', 'grep -qx two target.txt', '--exit', '1', '--output-text', 'missing'], stateDir)
  const unverified = run(['unverified', '--json'], stateDir)
  assert.equal(unverified.status, 0)
  assert.equal(JSON.parse(unverified.stdout).length, 1)

  run(['mutation', opId, '--delta', 'append two fixed', '--post', 'v3'], stateDir)
  run(['verify', opId, '--command', 'grep -qx two target.txt', '--exit', '0', '--output-text', 'two'], stateDir)
  assert.equal(JSON.parse(run(['unverified', '--json'], stateDir).stdout).length, 0)

  const op = run(['op', opId], stateDir)
  assert.equal(op.status, 0)
  assert.match(op.stdout, /state     verified/)
  assert.match(op.stdout, /verify    0*.*exit 1/)
  assert.match(op.stdout, /exit 0/)

  const today = run(['today', '--json'], stateDir)
  assert.equal(today.status, 0)
  assert.ok(JSON.parse(today.stdout).operations.some(item => item.opId === opId))

  fs.rmSync(stateDir, { recursive: true, force: true })
})

test('export writes a checksum and manifest', () => {
  const stateDir = temp()
  run(['open', '--target', '/tmp/x', '--intent', 'test'], stateDir)
  const out = path.join(stateDir, 'out.jsonl')
  const result = run(['export', '--out', out, '--json'], stateDir)
  assert.equal(result.status, 0, result.stderr)
  const manifest = JSON.parse(result.stdout)
  assert.ok(fs.existsSync(out))
  assert.ok(fs.existsSync(`${out}.sha256`))
  assert.equal(manifest.sha256.length, 64)
  assert.ok(manifest.events >= 1)
  fs.rmSync(stateDir, { recursive: true, force: true })
})

test('rollback-check exits 2 on mismatch and 3 when unavailable', () => {
  const stateDir = temp()
  const target = path.join(stateDir, 't.txt')
  fs.writeFileSync(target, 'after\n')
  const opened = run(['open', '--target', target, '--intent', 'x'], stateDir)
  const opId = /opened (op-\S+)/.exec(opened.stdout)[1]
  const hash = crypto.createHash('sha256').update('after\n').digest('hex')
  run(['mutation', opId, '--delta', 'x', '--post', 'v2', '--post-hash', hash], stateDir)
  run(['rollback', opId, '--command', 'restore'], stateDir)
  assert.equal(run(['rollback-check', opId], stateDir).status, 0)
  fs.writeFileSync(target, 'changed\n')
  assert.equal(run(['rollback-check', opId], stateDir).status, 2)

  const other = run(['open', '--target', '/tmp/no-hash', '--intent', 'x'], stateDir)
  const otherId = /opened (op-\S+)/.exec(other.stdout)[1]
  assert.equal(run(['rollback-check', otherId], stateDir).status, 3)
  fs.rmSync(stateDir, { recursive: true, force: true })
})

test('doctor, smoke and version run', () => {
  const stateDir = temp()
  const doctor = run(['doctor'], stateDir)
  assert.equal(doctor.status, 0)
  assert.match(doctor.stdout, /doctor: no failures/)
  const smoke = run(['smoke'], stateDir)
  assert.equal(smoke.status, 0, smoke.stderr)
  assert.match(smoke.stdout, /state     verified/)
  const version = run(['version'], stateDir)
  assert.match(version.stdout, /dsh-change-journal 0\.1\.0/)
  fs.rmSync(stateDir, { recursive: true, force: true })
})
