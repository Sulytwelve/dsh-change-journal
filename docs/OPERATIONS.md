# Operations

## Paths

```
<state>/journal/YYYY-MM.jsonl   append-only events, one JSON per line
<state>/journal/.lock          single-writer lock (stale after 10 s)
<state>/exports/*.jsonl        explicit exports + .sha256 + manifest.json
<state>/plugin-loaded.json     Host row heartbeat and self-test
```

Default state directory: `~/.local/state/dsh-change-journal` (Linux), platform local state on
Windows, or `DSH_CHANGE_JOURNAL_STATE_DIR`. The tree is owner-only.

## Write path

1. acquire `.lock` (`O_EXCL`, 5 s timeout, 10 s stale detection);
2. scan the current segment for the event id (idempotency);
3. append one line, adding a newline first if the file ends mid-line;
4. `fsync`, release the lock, return the byte offset;
5. the caller may now mutate the target.

A failed append returns the failure before the operation claims coverage. A crash between intent and
mutation leaves the operation `interrupted` / unverified, which is visible in `unverified`.

## Queries and export

```sh
dsh-change-journal today --tz Asia/Singapore
dsh-change-journal op <opId>
dsh-change-journal unverified
dsh-change-journal export --out /srv/storage/changes-2026-11.jsonl
```

`export` writes every event, a `.sha256` sidecar and a manifest with counts, segment count, damaged
record count and rule version. Use it before quota pressure or when handing the journal to someone
else.

## Retention and quota

- Monthly segments; `gc` removes segments older than `retentionDays` (default 90, calibrate-required).
- A segment holding any event of an unresolved operation is protected and reported, not removed.
- Quota (default 64 MiB, calibrate-required) is reported by `doctor`; the journal never silently
  deletes history at quota — export or raise the quota explicitly.
- Segments are human-readable JSONL and diff cleanly in Git.

## Diagnose

```sh
dsh-change-journal doctor
dsh-change-journal today --json
```

`doctor` reports the journal directory, segment/event counts, damaged records with offsets, unresolved
operations, quota ratio, passive mode and the loaded Host self-test.

## Damaged records

A malformed or partial line is preserved, reported with its byte offset in `readEvents`/`doctor`, and
excluded from query results. The next append begins after a clean newline. No history is rewritten.

## Upgrade

```sh
# DSH has no in-place update: remove, add the new tag, then restart.
dsh plugin --profile web remove @sulytwelve/dsh-change-journal
dsh plugin --profile web add github:Sulytwelve/dsh-change-journal#v0.1.1
# restart the DSH process that serves the profile
```

Events are versioned (`schema`, `journalVersion`); mixed versions remain readable.

## Rollback

```sh
dsh plugin --profile web remove @sulytwelve/dsh-change-journal
# restart the DSH process that serves the profile
rm -rf ~/.local/state/dsh-change-journal   # optional
```

Rollback recipes recorded in the journal are text; applying one is a separate operator action and
is never done by this plugin.
