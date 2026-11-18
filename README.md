# dsh-change-journal

Append-only change journal for DeepSeek Harness 0.2.2-rc.3, profile `web`.
One explicit operation id carries intent, backup, mutation, verification and a rollback recipe, so a
disconnected session can be handed to a colleague who can still answer: what changed, who changed
it, where the backup is, how to roll it back, and whether the change was verified.

The journal is **observational**: it grants no execution authority, intercepts no approval, and
never applies a rollback recipe.

## Verified host contract (not assumed)

| Contract | Verification |
|---|---|
| Tool registration and plain-object definition | `ctx.tools.register` (same path as the shipped plugins); tested in `test/tool.mjs` |
| Passive file observations | `fs/observed(target, {kind:'present',version}|{kind:'absent'}, actor)`; synchronous listener, actor is the tool execution | Inspector `Event:fs/observed` |
| Actor identity | `exec.agent.id`, `exec.name`, `exec.callId` | `dsh-tools/src/pipeline.ts:131-147` |
| No execution surface | no shell/subprocess import in the journal path; rollback is recorded text | `test/tool.mjs`, static checks |
| CLI parity | one store and one derivation used by tool and CLI | this package |

## Operation model

```sh
open   → opId        # durable intent; ack before any mutation
backup → verified|pending|mismatch
mutation → delta + observed pre/post state
verify → command, actual exit code, bounded actual output or evidence ref
rollback → command, workdir, preconditions, expected post sha256
rollback-check → read-only comparison of the target with the recorded post state
```

`verify` counts only for the mutation it follows; any later mutation invalidates it. `unverified`
lists every operation whose last mutation has no successful applicable check. `backup pending`
(remote or unreadable), `check-failed`, and `interrupted` (mutation without post state) stay
distinguishable.

Two small guards for the operator:

- If a verification's `output` contains literal `\n` sequences and no real newlines, it is stored as
  supplied with a warning and `outputLooksEscaped: true`; pass real newlines or `--output FILE`.
- `today` lists each passive observation (time, observing tool, target, state/version) instead of
  only a count, and points at `change open` when a reported change deserves full coverage.

## Storage

- `~/.local/state/dsh-change-journal/journal/YYYY-MM.jsonl` — one UTF-8 JSON event per line,
  monthly segments, append-only.
- Every write takes a single-writer lock, appends with `fsync`, and is idempotent by `eventId`;
  the same event id is acknowledged once, not stored twice.
- A crash-partial line is preserved, reported with its byte offset, and never included in query
  results; the next append starts on a clean line.
- Events carry `at` (local time with offset), `atMs`, the journal time zone, actor, session, tool,
  call id and source.
- No credentials are stored: rollback commands have credential-looking values replaced with `***`
  and the event records `redacted: true`.
- The state directory is owner-only; nothing under `~/.dsh/storages/agent_memory` is touched.

## Queries

| Query | Answer |
|---|---|
| `today` | operations with activity today in the requested IANA zone (default: host zone), plus each passive observation named explicitly |
| `op <id>` | every attempt, the failing/passing verification output, backup state, rollback recipe |
| `unverified` | operations whose last mutation has no successful check |
| `export` | all events as JSONL + `.sha256` + manifest, for migration or a quota-pressure handoff |
| `smoke` | the packaged acceptance fixture, printed from the journal alone |

Passive `fs/observed` events are recorded as **unattributed observations** and surfaced separately;
they are never auto-linked to an operation. Coverage is therefore explicit: operations opened with
`open` are the unit of work, and changes made through external shells or uninstrumented editors are
not attributed by the journal. An SSH invocation records the local caller and requested command; its
appearance alone is never recorded as a remote file mutation.

## CLI

```sh
dsh-change-journal open --target T --intent I
dsh-change-journal backup <opId> --uri U [--sha256 H]
dsh-change-journal mutation <opId> --delta D [--pre P] [--post S] [--post-hash H]
dsh-change-journal verify <opId> --command C --exit N [--output FILE | --output-text TEXT]
dsh-change-journal rollback <opId> --command C [--workdir W] [--precondition P]...
dsh-change-journal rollback-check <opId>
dsh-change-journal today [--tz ZONE] | op <id> | unverified | export | smoke | doctor | gc | version
```

Exit codes: 0 ok, 1 failure, 2 rollback precondition mismatch, 3 rollback check unavailable.
The same operations are exposed as the model-facing `change` tool with `op=`.

## Defaults: calibrate-required

| Setting | Default | Class |
|---|---|---|
| segment rotation | monthly | calibrate-required |
| retention | 90 days | calibrate-required |
| local quota | 64 MiB | calibrate-required |
| verification output | 8 KiB stored per check | calibrate-required |
| hash budget | 512 MiB per file | calibrate-required |
| passive observations | on, unattributed | product choice; no auto-link |
| timezone | host zone, override per query | measured from the host |
| observed event size | ~440 B per event (fixture, 2026-11-18) | measured on this fixture |

At quota the journal reports capacity pressure and offers `export`; GC never removes a segment that
holds an unresolved operation's evidence, and a later change invalidates an earlier check.

## Tests

```sh
npm test   # 6 files, 29 assertions, no dependencies
```

Covers the packaged acceptance fixture (file edit, verified backup, failing check, corrected edit,
passing check), remote/mismatched backups, redaction, rollback precondition match/mismatch, duplicate
event ids, interrupted writes with damaged offsets, concurrent-writer locking, GC protection for
unresolved operations, time-zone day filtering, passive observations, the tool surface, and CLI
export/doctor/smoke. Clean install path:

```sh
mkdir /tmp/dsh-journal && tar -xzf sulytwelve-dsh-change-journal-0.1.1.tgz -C /tmp/dsh-journal
cd /tmp/dsh-journal/package && node test/*.mjs
```

## Security and boundaries

- Read-only toward the machine: hashes and reads backups/targets; never writes targets, never runs
  verification or rollback commands.
- No approval interception and no new execution permission.
- Backup verification is local: a remote URI is recorded `pending` with the reason, never claimed as
  verified. A touched directory alone is not accepted as a backup.
- Verifications are caller-reported; the journal records the actual exit code and actual output or a
  durable evidence reference, and marks the state from those facts.
- The journal can be handed over as plain JSONL; `export` adds a manifest and checksum.

## Rollback

```sh
dsh plugin --profile web remove @sulytwelve/dsh-change-journal
# restart the DSH process that serves the profile
rm -rf ~/.local/state/dsh-change-journal   # optional: discard the journal
```

## Distribution

Three install paths, in preference order:

1. **npm** — the repository carries a tag-triggered publish workflow; once the `NPM_TOKEN` secret is
   configured, a tagged release publishes to the registry and installs as a normal package.
2. **GitHub tag** — `dsh plugin --profile web add github:Sulytwelve/dsh-change-journal#vX.Y.Z` (pin the tag).
3. **Release tarball URL** — `dsh plugin --profile web add https://github.com/Sulytwelve/dsh-change-journal/releases/download/vX.Y.Z/sulytwelve-dsh-change-journal.tgz`.

**Upgrading:** DSH hot-updates code inside an installed plugin (HMR), but it does not overwrite an
installed plugin package. A new version therefore needs remove then add (restart only if the Host
does not hot-load the new module generation):
tag, then restart the process that serves the profile:

```sh
dsh plugin --profile web remove @sulytwelve/dsh-change-journal
dsh plugin --profile web add github:Sulytwelve/dsh-change-journal#v0.1.1
```

Until npm publishing is enabled, use the GitHub tag or the release tarball spec after the remove.
## License

MIT — see [LICENSE](LICENSE). Sample outputs: [docs/SAMPLES.md](docs/SAMPLES.md).
