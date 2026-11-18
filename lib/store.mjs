/**
 * Append-only JSON Lines journal with a single-writer lock, idempotency keys,
 * monthly segments and damage reporting. The writer acknowledges durability
 * (`fsync`) before the caller starts the managed mutation.
 */

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { statePaths } from './paths.mjs'
import { EVENT_SCHEMA, isoLocal, monthKey, resolveTimeZone } from './time.mjs'
import { deriveOperations } from './derive.mjs'

const SEGMENT_PATTERN = /^\d{4}-\d{2}\.jsonl$/
const LOCK_STALE_MS = 10_000
const LOCK_TIMEOUT_MS = 5_000
const sleeper = new Int32Array(new SharedArrayBuffer(4))

function sleepSync(ms) {
  Atomics.wait(sleeper, 0, 0, ms)
}

export function createStore({ stateDir, config, fs: fileSystem = fs, now = Date.now }) {
  const paths = statePaths(stateDir)
  const timezone = resolveTimeZone(config.timezone)

  function ensureJournal() {
    fileSystem.mkdirSync(paths.journal, { recursive: true, mode: 0o700 })
  }

  function segments() {
    try {
      return fileSystem.readdirSync(paths.journal).filter(name => SEGMENT_PATTERN.test(name)).sort()
    } catch {
      return []
    }
  }

  function withLock(fn) {
    ensureJournal()
    const deadline = Date.now() + LOCK_TIMEOUT_MS
    for (;;) {
      try {
        const fd = fileSystem.openSync(paths.lock, 'wx', 0o600)
        try { fileSystem.writeSync(fd, `${process.pid}\n`) } finally { fileSystem.closeSync(fd) }
        try {
          return fn()
        } finally {
          try { fileSystem.unlinkSync(paths.lock) } catch { /* already gone */ }
        }
      } catch (error) {
        if (error.code !== 'EEXIST') throw error
        try {
          const stat = fileSystem.statSync(paths.lock)
          if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
            fileSystem.unlinkSync(paths.lock)
            continue
          }
        } catch {
          continue
        }
        if (Date.now() > deadline) throw Object.assign(new Error('change journal lock timeout'), { code: 'ELOCK' })
        sleepSync(20)
      }
    }
  }

  /** Parse one segment, reporting any malformed or trailing partial line with its byte offset. */
  function readSegment(file) {
    let buffer
    try {
      buffer = fileSystem.readFileSync(file)
    } catch {
      return { events: [], damaged: [] }
    }
    const events = []
    const damaged = []
    let start = 0
    let line = 0
    for (let index = 0; index < buffer.length; index += 1) {
      if (buffer[index] !== 10) continue
      const text = buffer.subarray(start, index).toString('utf8')
      const offset = start
      start = index + 1
      line += 1
      if (text.trim() === '') continue
      try {
        const event = JSON.parse(text)
        if (event.schema !== EVENT_SCHEMA || typeof event.opId !== 'string' || typeof event.type !== 'string') {
          damaged.push({ file, offset, line, reason: 'unexpected event shape', preview: text.slice(0, 120) })
          continue
        }
        events.push({ ...event, file, offset })
      } catch {
        damaged.push({ file, offset, line, reason: 'malformed JSON', preview: text.slice(0, 120) })
      }
    }
    if (start < buffer.length) {
      const text = buffer.subarray(start).toString('utf8')
      if (text.trim() !== '') damaged.push({ file, offset: start, line: line + 1, reason: 'partial trailing line', preview: text.slice(0, 120), trailing: true })
    }
    return { events, damaged }
  }

  function readEvents() {
    const events = []
    const damaged = []
    const files = segments()
    for (const name of files) {
      const file = path.join(paths.journal, name)
      const read = readSegment(file)
      events.push(...read.events)
      damaged.push(...read.damaged)
    }
    return { events, damaged, files }
  }

  function appendEvent({ opId, type, data = {}, actor = {}, atMs = now(), eventId = undefined }) {
    const id = typeof eventId === 'string' && eventId !== '' ? eventId : `evt-${randomUUID()}`
    const month = monthKey(atMs, timezone)
    const file = path.join(paths.journal, `${month}.jsonl`)
    const event = {
      schema: EVENT_SCHEMA,
      journalVersion: 1,
      eventId: id,
      opId: String(opId),
      type: String(type),
      at: isoLocal(atMs),
      atMs,
      tz: timezone,
      actor: {
        sessionId: actor.sessionId ?? null,
        tool: actor.tool ?? null,
        callId: actor.callId ?? null,
        source: actor.source ?? 'unknown',
      },
      data,
    }
    return withLock(() => {
      const existing = readSegment(file)
      const duplicate = existing.events.find(item => item.eventId === id)
      if (duplicate !== undefined) return { event: duplicate, duplicate: true, file, offset: duplicate.offset }
      const fd = fileSystem.openSync(file, 'a+', 0o600)
      try {
        const size = fileSystem.fstatSync(fd).size
        if (size > 0) {
          const last = Buffer.alloc(1)
          fileSystem.readSync(fd, last, 0, 1, size - 1)
          if (last[0] !== 10) fileSystem.writeSync(fd, '\n')
        }
        const offset = fileSystem.fstatSync(fd).size
        fileSystem.writeSync(fd, `${JSON.stringify(event)}\n`)
        fileSystem.fsyncSync(fd)
        return { event, duplicate: false, file, offset }
      } finally {
        fileSystem.closeSync(fd)
      }
    })
  }

  function sizeBytes() {
    let total = 0
    for (const name of segments()) {
      try { total += fileSystem.statSync(path.join(paths.journal, name)).size } catch { /* vanished */ }
    }
    return total
  }

  /** Remove segments past the retention window, never one holding an unresolved operation. */
  function gc({ dryRun = false } = {}) {
    const { events } = readEvents()
    const unresolved = deriveOperations(events).filter(op => op.unresolved)
    const protectedBy = new Map()
    for (const op of unresolved) {
      for (const event of events) {
        if (event.opId !== op.opId) continue
        const list = protectedBy.get(event.file) ?? []
        if (!list.includes(op.opId)) list.push(op.opId)
        protectedBy.set(event.file, list)
      }
    }
    const cutoffMonth = monthKey(now() - config.retentionDays * 24 * 60 * 60 * 1000, timezone)
    const removed = []
    const protectedFiles = []
    let freedBytes = 0
    for (const name of segments()) {
      const file = path.join(paths.journal, name)
      const month = name.slice(0, 7)
      if (protectedBy.has(file)) {
        protectedFiles.push({ file, opIds: protectedBy.get(file) })
        continue
      }
      if (month >= cutoffMonth) continue
      let bytes = 0
      try { bytes = fileSystem.statSync(file).size } catch { /* vanished */ }
      if (!dryRun) {
        try { fileSystem.unlinkSync(file) } catch { continue }
      }
      removed.push({ file, bytes })
      freedBytes += bytes
    }
    return { removed, protected: protectedFiles, freedBytes, dryRun, cutoffMonth }
  }

  return {
    paths,
    timezone,
    segments,
    readEvents,
    appendEvent,
    sizeBytes,
    gc,
  }
}
