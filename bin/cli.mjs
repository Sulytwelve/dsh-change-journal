#!/usr/bin/env node
/**
 * `dsh-change-journal` — keyboard-first journal operations.
 *
 * Same read/write path as the Host tool. The journal records what the caller
 * reports; it never executes a command or applies a rollback.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defaultStateDir, statePaths } from '../lib/paths.mjs'
import { normalizeConfig } from '../lib/config.mjs'
import { createStore } from '../lib/store.mjs'
import { deriveOperations } from '../lib/derive.mjs'
import { operationText, todayText, unverifiedText } from '../lib/format.mjs'
import {
  checkRollback, getOperation, openOperation, recordBackup, recordMutation, recordRollback,
  recordVerification, todayOperations, unverifiedOperations,
} from '../lib/ops.mjs'
import { isoLocal } from '../lib/time.mjs'
import { sha256Text } from '../lib/util.mjs'
import { writeJsonAtomic } from '../lib/write.mjs'
import { ownVersion } from '../lib/version.mjs'

const EXIT = { ok: 0, error: 1, mismatch: 2, unavailable: 3 }

function usage() {
  return `dsh-change-journal ${ownVersion()}

Usage:
  dsh-change-journal open --target T --intent I [--json]
  dsh-change-journal backup <opId> --uri U [--sha256 H] [--json]
  dsh-change-journal mutation <opId> --delta D [--pre P] [--post S] [--post-hash H] [--json]
  dsh-change-journal verify <opId> --command C --exit N [--output FILE | --output-text TEXT] [--json]
  dsh-change-journal rollback <opId> --command C [--workdir W] [--precondition P]... [--json]
  dsh-change-journal rollback-check <opId> [--json]
  dsh-change-journal today [--tz ZONE] [--json]
  dsh-change-journal op <opId> [--json]
  dsh-change-journal unverified [--json]
  dsh-change-journal export [--out FILE] [--json]
  dsh-change-journal smoke
  dsh-change-journal gc [--dry-run] [--json]
  dsh-change-journal doctor [--json]
  dsh-change-journal version

Exit codes: 0 ok, 1 failure, 2 rollback precondition mismatch, 3 rollback check unavailable.`
}

function parseArgs(argv) {
  const flags = { preconditions: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--json') flags.json = true
    else if (value === '--dry-run') flags.dryRun = true
    else if (value === '--help' || value === '-h') flags.help = true
    else if (value === '--state-dir' || value === '--root') flags.stateDir = argv[++index]
    else if (value === '--target') flags.target = argv[++index]
    else if (value === '--intent') flags.intent = argv[++index]
    else if (value === '--uri') flags.uri = argv[++index]
    else if (value === '--sha256') flags.sha256 = argv[++index]
    else if (value === '--delta') flags.delta = argv[++index]
    else if (value === '--pre') flags.pre = argv[++index]
    else if (value === '--post') flags.post = argv[++index]
    else if (value === '--post-hash') flags.postHash = argv[++index]
    else if (value === '--command') flags.command = argv[++index]
    else if (value === '--workdir') flags.workdir = argv[++index]
    else if (value === '--precondition') flags.preconditions.push(argv[++index])
    else if (value === '--exit') flags.exitCode = Number(argv[++index])
    else if (value === '--output') flags.outputFile = argv[++index]
    else if (value === '--output-text') flags.outputText = argv[++index]
    else if (value === '--evidence') flags.evidence = argv[++index]
    else if (value === '--tz') flags.tz = argv[++index]
    else if (value === '--out') flags.out = argv[++index]
    else if (!value.startsWith('-') && flags.action === undefined) flags.action = value
    else if (!value.startsWith('-') && flags.arg === undefined) flags.arg = value
  }
  return flags
}

function resolveState(flags) {
  return flags.stateDir === undefined ? defaultStateDir() : path.resolve(flags.stateDir)
}

function setup(flags) {
  const stateDir = resolveState(flags)
  const config = normalizeConfig({})
  return { stateDir, config, store: createStore({ stateDir, config }) }
}

const actor = { sessionId: 'cli', tool: null, callId: null, source: 'cli' }

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

async function cmdOpen(flags, ctx) {
  const result = await openOperation({ store: ctx.store, target: flags.target, intent: flags.intent, actor, nowMs: Date.now() })
  if (flags.json) printJson({ opId: result.opId, event: result.event })
  else process.stdout.write(`${result.text}\n`)
  return EXIT.ok
}

async function cmdBackup(flags, ctx) {
  const result = await recordBackup({ store: ctx.store, config: ctx.config, opId: flags.arg, uri: flags.uri, sha256: flags.sha256, actor, nowMs: Date.now() })
  if (flags.json) printJson(result)
  else process.stdout.write(`${result.text}\n`)
  return result.ok ? EXIT.ok : EXIT.error
}

async function cmdMutation(flags, ctx) {
  const result = await recordMutation({ store: ctx.store, opId: flags.arg, delta: flags.delta, pre: flags.pre, post: flags.post, postHash: flags.postHash, actor, nowMs: Date.now() })
  if (flags.json) printJson(result)
  else process.stdout.write(`${result.text}\n`)
  return EXIT.ok
}

async function cmdVerify(flags, ctx) {
  let output = flags.outputText
  if (flags.outputFile !== undefined) output = fs.readFileSync(flags.outputFile, 'utf8')
  const result = await recordVerification({
    store: ctx.store, config: ctx.config, opId: flags.arg, command: flags.command,
    exitCode: flags.exitCode, output, evidence: flags.evidence, actor, nowMs: Date.now(),
  })
  if (flags.json) printJson(result)
  else process.stdout.write(`${result.text}\n`)
  return EXIT.ok
}

async function cmdRollback(flags, ctx) {
  const result = await recordRollback({
    store: ctx.store, opId: flags.arg, command: flags.command, workdir: flags.workdir,
    preconditions: flags.preconditions, actor, nowMs: Date.now(),
  })
  if (flags.json) printJson(result)
  else process.stdout.write(`${result.text}\n`)
  return EXIT.ok
}

async function cmdRollbackCheck(flags, ctx) {
  const result = await checkRollback({ store: ctx.store, config: ctx.config, opId: flags.arg, actor, nowMs: Date.now() })
  if (flags.json) printJson(result)
  else process.stdout.write(`${result.text}\n`)
  return result.result === 'match' ? EXIT.ok : result.result === 'mismatch' ? EXIT.mismatch : EXIT.unavailable
}

function cmdToday(flags, ctx) {
  const result = todayOperations({ store: ctx.store, timezone: flags.tz ?? ctx.config.timezone, nowMs: Date.now() })
  if (flags.json) printJson({ day: result.day, zone: result.zone, operations: result.operations, observations: result.observations })
  else process.stdout.write(`${todayText(result)}\n`)
  return EXIT.ok
}

function cmdOp(flags, ctx) {
  const result = getOperation(ctx.store, flags.arg)
  if (flags.json) printJson(result.operation)
  else process.stdout.write(`${operationText(result.operation)}\n`)
  return EXIT.ok
}

function cmdUnverified(flags, ctx) {
  const result = unverifiedOperations({ store: ctx.store })
  if (flags.json) printJson(result.operations)
  else process.stdout.write(`${unverifiedText(result.operations)}\n`)
  return EXIT.ok
}

function cmdExport(flags, ctx) {
  const { events, damaged, files } = ctx.store.readEvents()
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const target = flags.out === undefined ? path.join(statePaths(ctx.stateDir).exports, `change-journal-${stamp}.jsonl`) : path.resolve(flags.out)
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 })
  const lines = events.map(event => `${JSON.stringify(event)}\n`).join('')
  fs.writeFileSync(target, lines, { mode: 0o600 })
  const digest = sha256Text(lines)
  fs.writeFileSync(`${target}.sha256`, `${digest}  ${path.basename(target)}\n`, { mode: 0o600 })
  const manifest = {
    schema: 'dsh.change-journal/export@1',
    exportedAt: isoLocal(Date.now()),
    events: events.length,
    segments: files.length,
    damagedRecords: damaged.length,
    sha256: digest,
    file: target,
    ruleVersion: 1,
  }
  writeJsonAtomic(`${target}.manifest.json`, manifest)
  if (flags.json) printJson(manifest)
  else process.stdout.write(`exported ${events.length} event(s) → ${target}\nsha256 ${digest}\nmanifest ${target}.manifest.json\n`)
  return EXIT.ok
}

async function cmdSmoke(flags) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-change-journal-smoke-'))
  const config = normalizeConfig({})
  const store = createStore({ stateDir, config })
  const file = path.join(stateDir, 'target.txt')
  fs.writeFileSync(file, 'one\n')
  const backupFile = path.join(stateDir, 'backup.txt')
  fs.copyFileSync(file, backupFile)

  const opened = await openOperation({ store, target: file, intent: 'smoke: append a line', actor, nowMs: Date.now() })
  const backup = await recordBackup({ store, config, opId: opened.opId, uri: backupFile, actor, nowMs: Date.now() })
  await recordMutation({ store, opId: opened.opId, delta: 'append "two"', pre: 'one', post: 'two', postHash: sha256Text('one\ntwo\n'), actor, nowMs: Date.now() })
  const failed = await recordVerification({ store, config, opId: opened.opId, command: 'sh -c "grep -qx two target.txt"', exitCode: 1, output: 'not found', actor, nowMs: Date.now() })
  await recordMutation({ store, opId: opened.opId, delta: 'append "two" correctly', pre: 'one', post: 'one+two', postHash: sha256Text('one\ntwo\n'), actor, nowMs: Date.now() })
  await recordVerification({ store, config, opId: opened.opId, command: 'sh -c "grep -qx two target.txt"', exitCode: 0, output: 'two', actor, nowMs: Date.now() })
  await recordRollback({ store, opId: opened.opId, command: `cp ${backupFile} ${file}`, workdir: stateDir, preconditions: ['target exists'], actor, nowMs: Date.now() })

  const operation = getOperation(store, opened.opId).operation
  process.stdout.write(`${operationText(operation)}\n`)
  process.stdout.write(`backup ${backup.state}; smoke journal at ${stateDir}\n`)
  return operation.state === 'verified' && backup.ok ? EXIT.ok : EXIT.error
}

function cmdGc(flags, ctx) {
  const result = ctx.store.gc({ dryRun: flags.dryRun === true })
  if (flags.json) printJson(result)
  else process.stdout.write(`${result.dryRun ? 'would remove' : 'removed'} ${result.removed.length} segment(s); protected ${result.protected.length}; freed ${result.freedBytes} bytes\n`)
  return EXIT.ok
}

function cmdDoctor(flags, ctx) {
  const checks = []
  const add = (name, level, detail) => checks.push({ name, level, detail })
  try {
    fs.mkdirSync(statePaths(ctx.stateDir).journal, { recursive: true, mode: 0o700 })
    add('journal directory', 'ok', statePaths(ctx.stateDir).journal)
  } catch (error) {
    add('journal directory', 'fail', error.message)
  }
  const { events, damaged, files } = ctx.store.readEvents()
  const operations = deriveOperations(events)
  add('segments', 'ok', `${files.length} file(s), ${events.length} event(s), ${ctx.store.sizeBytes()} bytes`)
  add('damaged records', damaged.length === 0 ? 'ok' : 'warn', damaged.length === 0 ? 'none' : `${damaged.length}; queries skip them and report offsets`)
  const unresolved = operations.filter(operation => operation.unresolved)
  add('unverified', unresolved.length === 0 ? 'ok' : 'warn', `${unresolved.length} operation(s) need a check`)
  const ratio = ctx.store.sizeBytes() / ctx.config.quotaBytes
  add('quota', ratio > 0.9 ? 'warn' : 'ok', `${(ratio * 100).toFixed(1)}% of ${ctx.config.quotaBytes} bytes (calibrate-required)`)
  add('passive', 'ok', `enabled=${ctx.config.passive}; observations are recorded unattributed and never auto-linked`)
  const loaded = (() => { try { return JSON.parse(fs.readFileSync(statePaths(ctx.stateDir).loaded, 'utf8')) } catch { return null } })()
  add('host plugin', loaded === null ? 'warn' : 'ok', loaded === null ? 'no plugin-loaded.json' : `v${loaded.version} pid ${loaded.pid}; self-test ${loaded.selfTest?.ok === true ? 'ok' : 'failed'}`)
  const failed = checks.filter(check => check.level === 'fail').length
  if (flags.json) printJson({ stateDir: ctx.stateDir, checks, ok: failed === 0 })
  else {
    for (const check of checks) process.stdout.write(`[${check.level}] ${check.name}: ${check.detail}\n`)
    process.stdout.write(`doctor: ${failed === 0 ? 'no failures' : `${failed} failure(s)`}\n`)
  }
  return failed === 0 ? EXIT.ok : EXIT.error
}

async function main() {
  const flags = parseArgs(process.argv.slice(2))
  if (flags.help) {
    process.stdout.write(`${usage()}\n`)
    return EXIT.ok
  }
  const command = flags.action ?? 'today'
  try {
    switch (command) {
      case 'open': return await cmdOpen(flags, setup(flags))
      case 'backup': return await cmdBackup(flags, setup(flags))
      case 'mutation': return await cmdMutation(flags, setup(flags))
      case 'verify': return await cmdVerify(flags, setup(flags))
      case 'rollback': return await cmdRollback(flags, setup(flags))
      case 'rollback-check': return await cmdRollbackCheck(flags, setup(flags))
      case 'today': return cmdToday(flags, setup(flags))
      case 'op': return cmdOp(flags, setup(flags))
      case 'unverified': return cmdUnverified(flags, setup(flags))
      case 'export': return cmdExport(flags, setup(flags))
      case 'smoke': return await cmdSmoke(flags)
      case 'gc': return cmdGc(flags, setup(flags))
      case 'doctor': return cmdDoctor(flags, setup(flags))
      case 'version':
        process.stdout.write(`dsh-change-journal ${ownVersion()} (node ${process.version})\n`)
        return EXIT.ok
      default:
        process.stderr.write(`unknown command: ${command}\n\n${usage()}\n`)
        return EXIT.error
    }
  } catch (error) {
    process.stderr.write(`dsh-change-journal: ${error?.message ?? String(error)}\n`)
    return EXIT.error
  }
}

process.exitCode = await main()
