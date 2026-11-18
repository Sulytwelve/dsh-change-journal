/** Compact text for the model and the CLI, sharing the same derived facts. */

import { clip } from './util.mjs'

function shortTime(value) {
  return typeof value === 'string' && value.length >= 19 ? value.slice(11, 19) : String(value ?? '?')
}

export function operationText(operation) {
  const lines = []
  lines.push(`operation ${operation.opId} · ${operation.state}${operation.target === null ? '' : ` · ${operation.target}`}`)
  if (operation.intent !== null) lines.push(`intent    ${operation.intent}`)
  lines.push(`opened    ${operation.openedAt ?? 'unknown'} by ${operation.actor?.source ?? 'unknown'}${operation.actor?.sessionId ? ` · session ${operation.actor.sessionId}` : ''}`)
  lines.push(`backup    ${operation.backupState}${operation.backup?.uri ? ` · ${operation.backup.uri}` : ''}${operation.backup?.sha256 ? ` · sha256 ${operation.backup.sha256.slice(0, 16)}…` : ''}${operation.backup?.reason ? ` · ${operation.backup.reason}` : ''}`)
  if (operation.mutations.length === 0) {
    lines.push('mutation  none recorded')
  } else {
    operation.mutations.forEach((mutation, index) => {
      lines.push(`mutation ${index + 1} · ${shortTime(mutation.at)} · ${mutation.delta}${mutation.complete ? '' : ' (interrupted: no post state)'}`)
    })
  }
  if (operation.verifications.length === 0) {
    lines.push('verify    none recorded')
  } else {
    for (const check of operation.verifications) {
      lines.push(`verify    ${shortTime(check.at)} · exit ${check.exitCode} · ${check.command}${check.output ? ` · ${clip(check.output.split('\n')[0], 100)}` : ''}`)
    }
  }
  if (operation.rollback !== null) {
    lines.push(`rollback  ${operation.rollback.command}${operation.rollback.workdir ? ` (workdir ${operation.rollback.workdir})` : ''}${operation.rollback.expectedPostSha256 ? ` · expects sha256 ${operation.rollback.expectedPostSha256.slice(0, 16)}…` : ''}${operation.rollback.redacted ? ' · redacted value' : ''}`)
    if (operation.rollback.preconditions.length > 0) lines.push(`          preconditions: ${operation.rollback.preconditions.join('; ')}`)
  } else {
    lines.push('rollback  no recipe recorded')
  }
  const lastCheck = operation.rollbackChecks.at(-1)
  if (lastCheck !== undefined) lines.push(`rollback-check ${shortTime(lastCheck.at)} · ${lastCheck.result}${lastCheck.reason ? ` · ${lastCheck.reason}` : ''}`)
  if (operation.verifiedAtMs !== null) lines.push('state     verified: a successful check follows the last mutation')
  else if (operation.state === 'interrupted') lines.push('state     interrupted: the mutation recorded no post state')
  else if (operation.state === 'check-failed') lines.push('state     check-failed: the last applicable check failed')
  return lines.join('\n')
}

export function todayText(result) {
  const lines = [`change journal · ${result.day} (${result.zone}) · ${result.operations.length} operation(s), ${result.observations.length} passive observation(s)`]
  for (const operation of result.operations) {
    lines.push(`${shortTime(operation.openedAt)} · ${operation.opId} · ${operation.state} · ${operation.target ?? '?'} · ${operation.intent ?? ''}`)
  }
  if (result.observations.length > 0) {
    lines.push(`unattributed observations: ${result.observations.length} (see op output or --json; never auto-linked)`)
  }
  return lines.join('\n')
}

export function unverifiedText(operations) {
  const lines = [`unverified operations: ${operations.length}`]
  for (const operation of operations) {
    lines.push(`${operation.opId} · ${operation.state} · ${operation.target ?? '?'} · last mutation ${operation.lastMutationAt ?? 'none'} · backup ${operation.backupState}`)
  }
  return lines.join('\n')
}
