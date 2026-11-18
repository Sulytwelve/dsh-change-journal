# Sample outputs

## `smoke` — packaged acceptance fixture

```
operation op-tooc5v-wc9gxf · verified · /tmp/target.txt
intent    smoke: append a line
opened    2026-11-18T09:29:55+08:00 by cli · session cli
backup    verified · /tmp/backup.txt · sha256 2c8b08da5ce60398…
mutation 1 · 09:29:55 · append "two"
mutation 2 · 09:29:56 · append "two" correctly
verify    09:29:55 · exit 1 · sh -c "grep -qx two target.txt" · not found
verify    09:29:56 · exit 0 · sh -c "grep -qx two target.txt" · two
rollback  cp /tmp/backup.txt /tmp/target.txt (workdir /tmp) · expects sha256 c3f9c8c283a2b1f2…
          preconditions: target exists
state     verified: a successful check follows the last mutation
```

From this text alone the next operator can see both attempts, the exact failing and passing output,
the verified backup and the rollback command and precondition.

## `today`

```
change journal · 2026-11-18 (Asia/Singapore) · 2 operation(s), 2 passive observation(s)
09:29:55 · op-tooc5v-wc9gxf · verified · /tmp/target.txt · smoke: append a line
10:02:10 · op-tooc7g-q0l8d6 · mutated · /srv/app/config.yml · raise the timeout
unattributed observations (recorded by passive fs/observed; never auto-linked):
  09:41:12 · fs · /srv/app/config.yml · present · version v7
  09:41:30 · fs · /srv/app/backup/config.yml · absent
if one of these changes matters, open an operation with `change open` so it gets backup/verify/rollback coverage.
```

## `verify` with literal `\n` in the output

```
verification for op-tooc7g-q0l8d6: exit 1 · line one\nline two · warning: the output contains literal \n, not real newlines; pass real newlines or use --output FILE
```

The text is stored as supplied; the warning is also recorded as `outputLooksEscaped: true` on the
event so a later reader can tell it apart from a multi-line output.

## `unverified`

```
unverified operations: 1
op-tooc7g-q0l8d6 · mutated · /srv/app/config.yml · last mutation 2026-11-18T10:02:10+08:00 · backup verified
```

## `export`

```
exported 12 event(s) → /srv/storage/changes-2026-11-18.jsonl
sha256 8f14e45fceea167a5a36dedd4bea2543…
manifest /srv/storage/changes-2026-11-18.jsonl.manifest.json
```

The manifest records event count, segment count, damaged records, the SHA-256 and the rule version.
