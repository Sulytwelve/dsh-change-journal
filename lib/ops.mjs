/**
 * Explicit journal operations. Every function only records what the caller
 * reports; the journal never executes a command, mutates a target or approves
 * anything. Backups are verified by reading them, not by trusting a touch.
 */

import path from 'node:path'
import { deriveOperations } from './derive.mjs'
import { dayKey, resolveTimeZone } from './time.mjs'
import { clip, hashFile, normalizeSha256, redactCommand } from './util.mjs'

function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`"${name}" is required`)
  return value.trim()
}

function requireOp(store, opId) {
  const id = requireText(opId, 'opId')
  const operation = deriveOperations(store.readEvents().events).find(item => item.opId === id)
  if (operation === undefined) throw new Error(`unknown operation "${id}"`)
  return operation
}

function localPathOf(uri) {
  if (uri.startsWith('file://')) return decodeURIComponent(uri.slice('file://'.length))
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(uri)) return null
  return path.resolve(uri)
}

export async function openOperation({ store, target, intent, actor, nowMs }) {
  const name = requireText(target, 'target')
  const why = requireText(intent, 'intent')
  const opId = `op-${Math.floor(nowMs / 1000).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const { event } = store.appendEvent({
    opId,
    type: 'open',
    atMs: nowMs,
    actor,
    data: { target: name, intent: why },
  })
  return { ok: true, opId, event, text: `opened ${opId} · ${why} · target ${name}` }
}

export async function recordBackup({ store, config, opId, uri, sha256, actor, nowMs }) {
  const operation = requireOp(store, opId)
  const location = requireText(uri, 'uri')
  const expected = normalizeSha256(sha256)
  let state
  let computed = null
  let bytes = null
  let reason = null
  const local = localPathOf(location)
  if (local === null) {
    state = 'pending'
    reason = 'remote backup cannot be verified from this host'
  } else {
    try {
      const hashed = await hashFile(local, { maxBytes: config.hashMaxBytes })
      computed = hashed.sha256
      bytes = hashed.bytes
      state = expected === null || expected === computed ? 'verified' : 'mismatch'
      if (state === 'mismatch') reason = `digest mismatch: expected ${expected}, computed ${computed}`
    } catch (error) {
      state = 'pending'
      reason = `backup not readable: ${error?.code ?? error?.message ?? 'error'}`
    }
  }
  const { event } = store.appendEvent({
    opId: operation.opId,
    type: 'backup',
    atMs: nowMs,
    actor,
    data: { uri: location, state, sha256: computed ?? expected, expectedSha256: expected, bytes, reason },
  })
  return {
    ok: state === 'verified',
    opId: operation.opId,
    state,
    text: `${state} backup for ${operation.opId}: ${location}${computed === null ? '' : ` sha256=${computed}`}${reason === null ? '' : ` (${reason})`}`,
    event,
  }
}

export async function recordMutation({ store, opId, delta, pre, post, postHash, actor, nowMs }) {
  const operation = requireOp(store, opId)
  const change = requireText(delta, 'delta')
  const normalizedPostHash = normalizeSha256(postHash)
  const complete = typeof post === 'string' && post !== '' || normalizedPostHash !== null
  const { event } = store.appendEvent({
    opId: operation.opId,
    type: 'mutation',
    atMs: nowMs,
    actor,
    data: { delta: change, pre: pre ?? null, post: post ?? null, postHash: normalizedPostHash },
  })
  return {
    ok: true,
    opId: operation.opId,
    complete,
    text: `mutation recorded for ${operation.opId}${complete ? '' : ' (no post state: counted as interrupted)'}`,
    event,
  }
}

export async function recordVerification({ store, config, opId, command, exitCode, output, evidence, actor, nowMs }) {
  const operation = requireOp(store, opId)
  const verification = requireText(command, 'command')
  const code = Number(exitCode)
  if (!Number.isInteger(code)) throw new Error('"exitCode" must be an integer')
  const bounded = typeof output === 'string' ? clip(output, config.maxVerifyOutputBytes) : null
  const { event } = store.appendEvent({
    opId: operation.opId,
    type: 'verify',
    atMs: nowMs,
    actor,
    data: { command: verification, exitCode: code, output: bounded, evidence: evidence ?? null },
  })
  return {
    ok: true,
    opId: operation.opId,
    succeeded: code === 0,
    text: `verification for ${operation.opId}: exit ${code}${bounded === null ? '' : ` · ${bounded.split('\n').slice(0, 3).join(' ⏎ ')}`}`,
    event,
  }
}

export async function recordRollback({ store, opId, command, workdir, preconditions, actor, nowMs }) {
  const operation = requireOp(store, opId)
  const raw = requireText(command, 'command')
  const redacted = redactCommand(raw)
  const expectedPostSha256 = operation.mutations.at(-1)?.postHash ?? null
  const list = Array.isArray(preconditions) ? preconditions.filter(item => typeof item === 'string' && item !== '') : []
  const { event } = store.appendEvent({
    opId: operation.opId,
    type: 'rollback',
    atMs: nowMs,
    actor,
    data: {
      command: redacted.command,
      workdir: typeof workdir === 'string' && workdir !== '' ? workdir : null,
      preconditions: list,
      expectedPostSha256,
      redacted: redacted.redacted,
    },
  })
  return {
    ok: true,
    opId: operation.opId,
    redacted: redacted.redacted,
    text: `rollback recipe recorded for ${operation.opId}${redacted.redacted ? ' (credential value redacted)' : ''}; it is never executed by the journal`,
    event,
  }
}

export async function checkRollback({ store, config, opId, actor, nowMs }) {
  const operation = requireOp(store, opId)
  const expected = operation.rollback?.expectedPostSha256 ?? operation.mutations.at(-1)?.postHash ?? null
  const target = operation.target
  let result = 'unavailable'
  let current = null
  let reason = null
  if (expected === null) {
    reason = 'no recorded post-change digest to compare'
  } else if (typeof target !== 'string' || localPathOf(target) === null) {
    reason = 'target is not a local file path'
  } else {
    try {
      const hashed = await hashFile(localPathOf(target), { maxBytes: config.hashMaxBytes })
      current = hashed.sha256
      result = current === expected ? 'match' : 'mismatch'
      if (result === 'mismatch') reason = 'the target changed after the recorded post-change state'
    } catch (error) {
      result = 'missing'
      reason = `target unreadable: ${error?.code ?? error?.message ?? 'error'}`
    }
  }
  store.appendEvent({
    opId: operation.opId,
    type: 'rollback-check',
    atMs: nowMs,
    actor,
    data: { result, currentSha256: current, expectedSha256: expected, reason },
  })
  return {
    ok: result === 'match',
    opId: operation.opId,
    result,
    text: `rollback precondition for ${operation.opId}: ${result}${reason === null ? '' : ` (${reason})`}`,
  }
}

export function getOperation(store, opId) {
  const operation = requireOp(store, opId)
  return { ok: true, operation, text: '' }
}

export function todayOperations({ store, timezone, nowMs }) {
  const zone = resolveTimeZone(timezone)
  const today = dayKey(nowMs, zone)
  const operations = deriveOperations(store.readEvents().events)
    .filter(operation => operation.events.some(event => dayKey(event.atMs, zone) === today))
  const observations = store.readEvents().events
    .filter(event => event.type === 'observation' && dayKey(event.atMs, zone) === today)
  return { ok: true, day: today, zone, operations, observations, text: '' }
}

export function unverifiedOperations({ store }) {
  const operations = deriveOperations(store.readEvents().events).filter(operation => operation.unresolved)
  return { ok: true, operations, text: '' }
}
