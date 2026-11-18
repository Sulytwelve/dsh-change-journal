/**
 * Derive each operation's state from its events. A verification only counts for
 * the mutation it follows: any later mutation invalidates earlier checks.
 */

export function deriveOperations(events) {
  const operations = new Map()
  for (const event of events) {
    if (event.type === 'observation') continue
    let operation = operations.get(event.opId)
    if (operation === undefined) {
      operation = {
        opId: event.opId,
        target: null,
        intent: null,
        openedAtMs: null,
        openedAt: null,
        actor: event.actor,
        backup: null,
        mutations: [],
        verifications: [],
        rollback: null,
        rollbackChecks: [],
        notes: [],
        events: [],
      }
      operations.set(event.opId, operation)
    }
    operation.events.push(event)
    const data = event.data ?? {}
    switch (event.type) {
      case 'open':
        operation.target = data.target ?? null
        operation.intent = data.intent ?? null
        operation.openedAtMs = event.atMs
        operation.openedAt = event.at
        operation.actor = event.actor
        break
      case 'backup':
        operation.backup = {
          state: data.state ?? 'pending',
          uri: data.uri ?? null,
          sha256: data.sha256 ?? null,
          bytes: data.bytes ?? null,
          reason: data.reason ?? null,
          atMs: event.atMs,
        }
        break
      case 'mutation':
        operation.mutations.push({
          atMs: event.atMs,
          at: event.at,
          delta: data.delta ?? null,
          pre: data.pre ?? null,
          post: data.post ?? null,
          postHash: data.postHash ?? null,
          complete: Boolean(data.post || data.postHash),
        })
        break
      case 'verify':
        operation.verifications.push({
          atMs: event.atMs,
          at: event.at,
          command: data.command ?? null,
          exitCode: Number.isInteger(data.exitCode) ? data.exitCode : null,
          output: data.output ?? null,
          evidence: data.evidence ?? null,
        })
        break
      case 'rollback':
        operation.rollback = {
          atMs: event.atMs,
          command: data.command ?? null,
          workdir: data.workdir ?? null,
          preconditions: Array.isArray(data.preconditions) ? data.preconditions : [],
          expectedPostSha256: data.expectedPostSha256 ?? null,
          redacted: data.redacted === true,
        }
        break
      case 'rollback-check':
        operation.rollbackChecks.push({
          atMs: event.atMs,
          result: data.result ?? 'unknown',
          currentSha256: data.currentSha256 ?? null,
          expectedSha256: data.expectedSha256 ?? null,
          reason: data.reason ?? null,
        })
        break
      case 'note':
        operation.notes.push({ atMs: event.atMs, text: data.text ?? '' })
        break
      default:
        break
    }
  }

  for (const operation of operations.values()) {
    const last = operation.mutations.at(-1)
    const after = last === undefined ? [] : operation.verifications.filter(check => check.atMs >= last.atMs)
    const success = after.find(check => check.exitCode === 0)
    const failed = after.find(check => check.exitCode !== null && check.exitCode !== 0)
    operation.lastMutationAtMs = last?.atMs ?? null
    operation.lastMutationAt = last?.at ?? null
    operation.verifiedAtMs = last !== undefined && last.complete && success !== undefined ? success.atMs : null
    operation.state = last === undefined
      ? 'open'
      : !last.complete
        ? 'interrupted'
        : operation.verifiedAtMs !== null
          ? 'verified'
          : failed !== undefined
            ? 'check-failed'
            : 'mutated'
    operation.unresolved = last !== undefined && operation.verifiedAtMs === null
    operation.backupState = operation.backup?.state ?? 'missing'
  }

  return [...operations.values()].sort((left, right) => (left.openedAtMs ?? 0) - (right.openedAtMs ?? 0))
}

/** Passive observations are surfaced separately; they are never auto-linked to an operation. */
export function deriveObservations(events) {
  return events.filter(event => event.type === 'observation').map(event => ({
    atMs: event.atMs,
    at: event.at,
    target: event.data?.displayPath ?? event.data?.targetKey ?? null,
    kind: event.data?.kind ?? 'unknown',
    version: event.data?.version ?? null,
    attribution: event.data?.attribution ?? 'unattributed',
    actor: event.actor,
  }))
}
