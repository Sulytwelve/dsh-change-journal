# Change journal

Append-only, observational journal for managed changes.

## Behavior

- One model-facing `change` tool and one CLI expose the same operations: `open`, `backup`,
  `mutation`, `verify`, `rollback`, `rollback-check`, `get`, `today`, `unverified`.
- Every operation starts with `open`, which returns the operation id and is durably recorded before
  the caller mutates anything.
- Backups are verified by reading the file (existence + SHA-256); a remote URI is recorded pending.
- A verification only covers the mutation it follows; a later mutation invalidates it.
- Rollback recipes are recorded, shown on request and checked read-only; the journal never executes
  them and never intercepts approval.
- Passive `fs/observed` events are recorded as unattributed observations, never auto-linked.

## Storage

Monthly JSONL segments under `~/.local/state/dsh-change-journal/journal/`, single-writer lock,
`fsync` per event, idempotent event ids, damaged-line reporting with offsets. Owner-only mode.
Nothing under `~/.dsh/storages/agent_memory` is touched.

## Configuration

`enabled`, `passive`, `timezone`, `retentionDays`, `quotaBytes`, `hashMaxBytes`,
`maxVerifyOutputBytes`, `maxEventsPerQuery`, `stateDir`. Numeric defaults are calibrate-required; see
the README table.

## Boundaries

- External shells and uninstrumented editors are not attributed; only explicit `open` operations are
  the unit of work. SSH's mere appearance never proves a remote mutation.
- Verifications are caller-reported facts, not journal executions.
- GC protects segments that hold an unresolved operation's evidence.
