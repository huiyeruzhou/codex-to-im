# JSON Schemas and Upgrade Contracts

Codex-to-IM publishes JSON Schemas for the files under `~/.codex-to-im`.
The entry point is [`schemas/manifest.json`](../schemas/manifest.json).

The schemas are intended for three uses:

- validating hand-edited local files before the bridge reads them;
- giving `doctor` or a future `migrate` command a machine-readable file map;
- defining stable upgrade boundaries between persisted versions.

At runtime, Codex-to-IM runs a startup storage migration before loading the
bridge store. The daemon calls this migration before `loadConfig()` and
`JsonFileStore` also calls it before reading persisted data, so opening the UI
or starting the bridge can repair old local files without a manual command.

## Files

| Runtime file | Schema | Notes |
| --- | --- | --- |
| `config.v2.json` | `schemas/config.v2.schema.json` | Versioned by `schemaVersion: 2`. |
| `data/sessions.json` | `schemas/data/sessions.v1.schema.json` | Map keyed by bridge session id. `codex_thread_id` lives here. |
| `data/bindings.json` | `schemas/data/bindings.v2.schema.json` | Map keyed by binding id. Uses `bridgeSessionId`; thread identity fields and retired binding session id fields are intentionally forbidden here. |
| `data/channel-default-targets.json` | `schemas/data/channel-default-targets.v2.schema.json` | Map keyed by channel instance id. Uses `bridgeSessionId`; records without it are discarded at startup. |
| `data/messages/*.json` | `schemas/data/messages.v1.schema.json` | Per-session message arrays. |
| `data/permissions.json` | `schemas/data/permissions.v1.schema.json` | Permission request links. |
| `data/offsets.json` | `schemas/data/string-map.v1.schema.json` | Channel offset map. |
| `data/dedup.json` | `schemas/data/number-map.v1.schema.json` | Dedup timestamp map. |
| `data/audit.json` | `schemas/data/audit.v1.schema.json` | Audit ring buffer. |

## Upgrade Model

JSON Schema does not perform migrations by itself. The manifest is the
contract migration runners should use:

1. Read `schemas/manifest.json`.
2. Resolve each `files[].path` relative to `~/.codex-to-im`.
3. If a file is missing, use its `missingFile` policy.
4. Detect the stored version from `versionField` when present; otherwise treat
   the file as the manifest entry's version.
5. Validate the source document against the schema for that version.
6. Run registered migrations in version order.
7. Validate the migrated document against the current schema.
8. Write atomically through a temporary file and rename.

Migration code should preserve unknown fields unless the manifest or a schema
explicitly marks them as retired. This avoids data loss when users downgrade,
hot-update, or manually carry files between bridge versions.

The current startup migration repairs the thread-identity refactor:

- session fields `sdk_session_id`, `desktop_thread_id`, and `thread_id` are
  folded into `codex_thread_id` when the session does not already have one;
- binding fields `sdkSessionId`, `sdk_session_id`, `desktop_thread_id`,
  `thread_id`, and `codex_thread_id` are moved to the referenced session and
  then removed from the binding;
- if an old binding only has a thread id and no `bridgeSessionId`, the
  migration creates a local bridge session and points the binding at it.
- old `data/ui-session-meta.json` names are folded into `sessions.json.name`;
  local Codex-only names create a local bridge session with `codex_thread_id`, then
  `ui-session-meta.json` is removed.
- v1 `data/channel-default-targets.json` records are rewritten from old target
  selector strings to `bridgeSessionId`. A local Codex thread selector is first
  materialized into a bridge session, then the old selector field is removed.

## Thread Identity Rule

`BridgeSession.codex_thread_id` is the only persisted Codex thread identity.
It belongs in `data/sessions.json`.

The schemas reject the removed identity fields:

- `sdk_session_id` / `sdkSessionId`
- `desktop_thread_id` / `desktopThreadId`
- `thread_origin` / `threadOrigin`
- `thread_id` / `threadId`

`data/bindings.json` also rejects `codex_thread_id` / `codexThreadId`, because
bindings point to sessions through `bridgeSessionId`; they do not own thread
identity.
