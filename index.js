/**
 * `change-journal` — the Host row.
 *
 * Registers one model-facing `change` tool and, when enabled, a synchronous
 * `fs/observed` recorder. It grants no execution authority, intercepts no
 * approval, and never applies a rollback recipe.
 */

import path from 'node:path'
import { normalizeConfig } from './lib/config.mjs'
import { defaultStateDir, statePaths } from './lib/paths.mjs'
import { createStore } from './lib/store.mjs'
import { deriveOperations } from './lib/derive.mjs'
import { operationText, todayText, unverifiedText } from './lib/format.mjs'
import {
  checkRollback, getOperation, openOperation, recordBackup, recordMutation, recordRollback,
  recordVerification, todayOperations, unverifiedOperations,
} from './lib/ops.mjs'
import { isoLocal } from './lib/time.mjs'
import { writeJsonAtomic } from './lib/write.mjs'
import { ownVersion } from './lib/version.mjs'

export const name = 'change-journal'
export const inject = ['tools']

const DESCRIPTION = 'Record a managed change as one operation id: open intent, verify the caller\'s backup, '
  + 'record the mutation, record a verification command/exit/output, and store a rollback recipe. '
  + 'Observational: it never executes, never applies a rollback and never asks for approval. '
  + 'Use op=open before a change, then backup, mutation, verify and rollback. Queries: op, today, unverified.'

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { type: 'string', enum: ['open', 'backup', 'mutation', 'verify', 'rollback', 'rollback-check', 'get', 'today', 'unverified'] },
    opId: { type: 'string', description: 'The operation id returned by op=open.' },
    target: { type: 'string', description: 'The object or path being changed (op=open).' },
    intent: { type: 'string', description: 'What the operation intends to change and why (op=open).' },
    uri: { type: 'string', description: 'Backup location; a local path or file:// is verified, a remote URI is recorded pending.' },
    sha256: { type: 'string', description: 'Expected backup digest; the journal computes and compares it.' },
    delta: { type: 'string', description: 'The intended change (op=mutation).' },
    pre: { type: 'string', description: 'Observed pre-change state or version (op=mutation).' },
    post: { type: 'string', description: 'Observed post-change state or version (op=mutation).' },
    postHash: { type: 'string', description: 'Observed post-change sha256 (op=mutation).' },
    command: { type: 'string', description: 'Verification command you already ran, or the rollback command to record (op=verify/rollback).' },
    exitCode: { type: 'integer', description: 'Actual exit status of the verification command (op=verify).' },
    output: { type: 'string', description: 'Bounded actual output/evidence from the verification (op=verify).' },
    evidence: { type: 'string', description: 'Durable evidence reference instead of inline output (op=verify).' },
    workdir: { type: 'string', description: 'Working directory the rollback recipe needs (op=rollback).' },
    preconditions: { type: 'string', description: 'Semicolon/newline separated rollback preconditions (op=rollback).' },
    tz: { type: 'string', description: 'IANA time zone for op=today; defaults to the host zone.' },
  },
  required: ['op'],
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean' }, text: { type: 'string' } },
  required: ['ok', 'text'],
}

function actorOf(exec) {
  return {
    sessionId: exec?.agent?.id ?? 'unknown',
    tool: exec?.name ?? 'change',
    callId: exec?.callId ?? null,
    source: 'tool',
  }
}

async function execute(args, exec, { store, config }) {
  const op = typeof args?.op === 'string' ? args.op : ''
  const actor = actorOf(exec)
  const nowMs = Date.now()
  switch (op) {
    case 'open': {
      const result = await openOperation({ store, target: args?.target, intent: args?.intent, actor, nowMs })
      return { ok: true, text: result.text }
    }
    case 'backup': {
      const result = await recordBackup({ store, config, opId: args?.opId, uri: args?.uri, sha256: args?.sha256, actor, nowMs })
      return { ok: result.ok, text: result.text }
    }
    case 'mutation': {
      const result = await recordMutation({ store, opId: args?.opId, delta: args?.delta, pre: args?.pre, post: args?.post, postHash: args?.postHash, actor, nowMs })
      return { ok: true, text: result.text }
    }
    case 'verify': {
      const result = await recordVerification({
        store, config, opId: args?.opId, command: args?.command, exitCode: args?.exitCode,
        output: args?.output, evidence: args?.evidence, actor, nowMs,
      })
      return { ok: true, text: result.text }
    }
    case 'rollback': {
      const preconditions = typeof args?.preconditions === 'string'
        ? args.preconditions.split(/[;\n]/).map(item => item.trim()).filter(item => item !== '')
        : []
      const result = await recordRollback({ store, opId: args?.opId, command: args?.command, workdir: args?.workdir, preconditions, actor, nowMs })
      return { ok: true, text: result.text }
    }
    case 'rollback-check': {
      const result = await checkRollback({ store, config, opId: args?.opId, actor, nowMs })
      return { ok: result.ok, text: result.text }
    }
    case 'get': {
      const result = getOperation(store, args?.opId)
      return { ok: true, text: operationText(result.operation) }
    }
    case 'today': {
      const result = todayOperations({ store, timezone: args?.tz ?? config.timezone, nowMs })
      return { ok: true, text: todayText(result) }
    }
    case 'unverified': {
      const result = unverifiedOperations({ store })
      return { ok: true, text: unverifiedText(result.operations) }
    }
    default:
      return { ok: false, text: `change: unknown op "${op}"; use open, backup, mutation, verify, rollback, rollback-check, get, today or unverified.` }
  }
}

function selfTest() {
  try {
    const at = Date.now()
    const base = { atMs: at, at: isoLocal(at), actor: { sessionId: 'selftest', source: 'selftest' } }
    const events = [
      { ...base, type: 'open', opId: 'selftest', data: { target: '/tmp/selftest', intent: 'self-test' } },
      { ...base, type: 'backup', opId: 'selftest', data: { state: 'verified', uri: '/tmp/backup', sha256: 'a'.repeat(64) } },
      { ...base, type: 'mutation', opId: 'selftest', data: { delta: 'edit', post: 'v2', postHash: 'b'.repeat(64) } },
      { ...base, type: 'verify', opId: 'selftest', data: { command: 'check', exitCode: 0, output: 'ok' } },
    ]
    const operation = deriveOperations(events)[0]
    return { ok: operation?.state === 'verified' && operation?.backupState === 'verified' }
  } catch (error) {
    return { ok: false, error: error?.message ?? String(error) }
  }
}

function writeHeartbeat({ stateDir, config }) {
  try {
    writeJsonAtomic(statePaths(stateDir).loaded, {
      schema: 'dsh.change-journal/plugin-loaded@1',
      plugin: 'change-journal',
      version: ownVersion(),
      pid: process.pid,
      loadedAtMs: Date.now(),
      loadedAt: new Date().toISOString(),
      stateDir,
      hooks: { tool: true, passive: config.passive },
      timezone: config.timezone,
      passive: config.passive,
      selfTest: selfTest(),
    })
  } catch {
    // A diagnostic file that cannot be written must not block the row.
  }
}

export function apply(ctx, rawConfig = {}) {
  const config = normalizeConfig(rawConfig)
  if (!config.enabled) return
  const stateDir = typeof rawConfig.stateDir === 'string' && rawConfig.stateDir.trim() !== ''
    ? path.resolve(rawConfig.stateDir.trim())
    : defaultStateDir()
  const store = createStore({ stateDir, config })

  ctx.effect(() => ctx.tools.register({
    name: 'change',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) { return [{ type: 'text', text: value.text }] },
    },
    async execute(args, exec) {
      try {
        return await execute(args, exec, { store, config })
      } catch (error) {
        return { ok: false, text: `change failed: ${error?.message ?? String(error)}` }
      }
    },
  }))

  if (config.passive) {
    ctx.effect(() => ctx.on('fs/observed', (target, observation, actor) => {
      try {
        store.appendEvent({
          opId: 'passive',
          type: 'observation',
          actor: {
            sessionId: actor?.agent?.id ?? null,
            tool: actor?.name ?? null,
            callId: actor?.callId ?? null,
            source: 'passive',
          },
          data: {
            targetKey: target?.targetKey ?? null,
            displayPath: target?.displayPath ?? null,
            kind: observation?.kind ?? 'unknown',
            version: observation?.version ?? null,
            attribution: 'unattributed',
          },
        })
      } catch {
        // fs/observed listeners must not throw into the tool call.
      }
    }))
  }

  ctx.effect(() => {
    writeHeartbeat({ stateDir, config })
    return () => {}
  })
}
