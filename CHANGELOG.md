# Changelog

## 0.1.0 — 2026-11-18

First release. Append-only change journal for DSH 0.2.2-rc.3, profile `web`.

### Why

Configuration and data changes survived only as conversation history. A disconnected session left no
record of what changed, where the backup was, how to roll back, or whether the change was verified.

### Added

- `change` tool and `dsh-change-journal` CLI with `open`, `backup`, `mutation`, `verify`, `rollback`,
  `rollback-check`, `get`, `today`, `unverified`.
- Append-only monthly JSONL segments: single-writer lock, `fsync` per event, idempotent event ids,
  byte-offset damage reporting, preserved history after an interrupted write.
- Backup verification by existence + SHA-256; remote or unreadable backups recorded `pending` with a
  reason rather than claimed verified.
- Derived state: a verification covers only the mutation it follows; later mutations invalidate it;
  `interrupted`, `check-failed`, `mutated`, `verified` stay distinguishable; `unverified` query.
- Rollback recipe with workdir, preconditions and expected post digest; read-only `rollback-check`
  that detects a target changed after the recorded state; credential values redacted in commands.
- Safe GC: segments holding an unresolved operation are protected; exports include JSONL, SHA-256 and
  a manifest.
- Passive `fs/observed` observations recorded as unattributed and never auto-linked; coverage
  boundaries documented (external shells, uninstrumented editors, SSH).
- 6 test files / 27 assertions, including the packaged acceptance fixture and clean-install path.

### Limits

- Verifications and mutations are caller-reported facts; the journal does not execute them.
- Remote backups stay `pending`; verification requires local read access.
- Numeric defaults are calibrate-required until measured per operator.
