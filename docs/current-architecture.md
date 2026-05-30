# Codex-to-IM Current Architecture

This document describes the current architecture and vocabulary of Codex-to-IM.
It is intentionally descriptive: it explains what the running system does today,
which concepts own which data, and where the main workflows meet.

## Core Concepts

### Codex Session

A Codex session is the underlying Codex conversation identified by a Codex
thread id. In Codex-to-IM this id is stored as `codex_thread_id`.

The thread can be created or continued through different surfaces:

- an IM-driven SDK run;
- a Codex CLI or TUI run;
- a Codex Native/CLI/TUI conversation that writes the same local JSONL session format.

The important architecture point is that this is not a desktop-only concept.
The local index module uses Codex naming; "Desktop" is reserved for the Creator
badge when Codex source metadata explicitly identifies a desktop-originated
session.

Codex session data is owned by Codex, not by Codex-to-IM. Codex-to-IM reads it
from `~/.codex/sessions/**/*.jsonl` and, for compatibility, reads some
`~/.codex/state_*.sqlite` data in the local session index path.

### BridgeSession

A `BridgeSession` is the local product session owned by Codex-to-IM. It lives
in `~/.codex-to-im/data/sessions.json` and is keyed by a local session id.

It stores:

- display name and working directory;
- model, mode, reasoning, sandbox, network, and provider settings;
- optional `codex_thread_id`, the only persisted Codex thread identity;
- local runtime state, queue state, health state, stream UI diagnostics, and
  mirror status;
- timestamps and draft/hidden metadata.

A `BridgeSession` can exist before any Codex thread has been created. Once
`codex_thread_id` is set, that session is associated with a real Codex thread.
The thread may have started from IM, CLI/TUI, or a native Codex client; business logic should
not branch on retired fields such as `desktop_thread_id`, `sdk_session_id`, or
`thread_origin`.

### IMChannel

An `IMChannel` is a configured IM entry point. In code this appears as channel
configuration plus runtime adapter state:

- channel provider: Feishu or Weixin;
- channel instance id / `channelType`;
- optional alias shown in the UI;
- credentials and platform-specific connection settings;
- a running adapter that consumes inbound messages and sends outbound text,
  cards, files, and callbacks.

Multiple channel instances can exist at the same time. A channel instance is
not a conversation by itself; it is the transport through which chats reach the
bridge.

### Binding

A `ChannelBinding` connects one IM chat to one `BridgeSession`.

It lives in `~/.codex-to-im/data/bindings.json` and stores:

- channel identity: `channelType`, optional provider and alias;
- chat identity: chat id, optional user id and display name;
- `bridgeSessionId`, the local `BridgeSession.id`;
- binding-level working directory, model, mode, and active flag.

Bindings do not own Codex thread identity. To find the Codex thread for a chat,
the bridge resolves the active binding, loads the referenced `BridgeSession`,
and reads `BridgeSession.codex_thread_id`.

A single chat can have multiple bindings. Exactly one is active for normal
messages; inactive bindings can still be useful for mirror subscriptions and
fast switching through `/t ls` and `/t use`.

### Session Selection

The UI/API model now uses explicit identities:

- UI/API operations target a `BridgeSession.id`;
- a locally discovered Codex thread is imported/materialized into a
  `BridgeSession` before it is renamed, configured, deleted, bound, or used as
  a channel default;
- `BridgeSession.codex_thread_id` remains the underlying Codex thread identity;
- `codex_thread_id` should not replace `BridgeSession.id` as the UI row id,
  because a Bridge session can exist before a Codex thread is created.

The retired selector strings are only migration input. Runtime code should use
`bridgeSessionId` and, for read-only local-index rows, `codexThreadId`.

## Product Capabilities

### Local Workbench and Service Management

The local web UI is served by `src/ui-server.ts`. It lets the local operator:

- inspect bridge and UI process status;
- edit global config;
- manage Feishu and Weixin channel instances;
- start, stop, and restart the bridge;
- view logs;
- list local sessions;
- open session history;
- rename, configure, delete, and bind sessions;
- set channel default targets.

This cluster depends on config loading, service management, the JSON store,
the local Codex session index, and binding summary helpers. It should consume
application/query services over time instead of rebuilding session and display
rules inside route handlers.

### Channel Runtime

Channel runtime turns platform-specific events into bridge messages and bridge
responses back into platform output.

Main responsibilities:

- adapter lifecycle and channel sync planning;
- inbound message consumption and authorization;
- callback parsing for permissions and rich-card commands;
- text/card/file delivery;
- streaming card support where the platform allows it;
- delivery audit, deduplication, chunking, and retry behavior.

Key files include `bridge-adapter-runtime.ts`, `bridge-channel-runtime.ts`,
`channel-adapter.ts`, `delivery-layer.ts`, `feedback-delivery.ts`,
`adapters/feishu-adapter.ts`, and the Weixin adapter files.

### Session and Binding Registry

The registry behavior is spread across `JsonFileStore`, `channel-router.ts`,
`session-bindings.ts`, and storage migrations.

It is responsible for:

- creating local Bridge sessions;
- resolving an IM chat to its active binding;
- creating hidden draft sessions for unbound chats;
- binding a chat to an existing Bridge session;
- importing a local Codex thread into a Bridge session;
- enforcing binding conflicts;
- storing default targets for new chats;
- keeping `codex_thread_id` on the session, not the binding.

This is a real product state layer. It should remain close to the business
invariants instead of becoming a generic storage helper.

### Local Codex Session Index

The local Codex session index reads Codex-owned data from the user's machine.
The main implementation is currently `src/codex-session-index.ts` with internal
modules under `src/codex-session-index/`.

It provides:

- discovery of local Codex JSONL sessions;
- title, cwd, origin, source, and last-activity summaries;
- lookup by thread id;
- history parsing for UI and `/his`;
- mirror-record parsing for runtime delivery;
- archive/visibility filtering;
- compatibility reads from local Codex state sqlite files.

The current file name is historical. The architectural dependency is broader:
this module indexes local Codex sessions regardless of whether the conversation
was started by a native Codex client, CLI, TUI, or an IM run that has already
produced a Codex JSONL file.

### Interactive Turn Runtime

An interactive turn is one normal IM prompt sent to Codex.

The main path is:

1. The adapter produces an `InboundMessage`.
2. `bridge-manager.ts` classifies it as permission callback, command, or
   normal prompt.
3. `channel-router.ts` resolves the chat to a binding and session.
4. `interactive-message-runner.ts` starts task state and stream feedback.
5. `conversation-engine.ts` consumes provider events.
6. `CodexRoutingProvider` chooses SDK or tmux provider.
7. The provider starts or resumes the Codex thread.
8. The returned thread id is persisted to `BridgeSession.codex_thread_id`.
9. The delivery pipeline sends final text and attachments back to the channel.

This runtime depends on session identity, provider selection, command settings,
permission handling, streaming UI, and final-response assembly.

### Mirror Runtime

Mirror is continuous observation of local Codex session JSONL files. It sends
events that happened outside the current IM prompt back to the relevant IM
chat.

The main path is:

1. `mirror-subscription-registry.ts` finds bindings whose sessions have
   `codex_thread_id`.
2. `mirror-runtime.ts` reconciles desired subscriptions with active adapters.
3. Each subscription resolves the Codex thread to a JSONL file.
4. File watch and periodic reconcile read new JSONL records.
5. Suppression removes records caused by the current IM-originated turn.
6. `mirror-turns.ts` buffers records until a coherent turn is finalized.
7. `mirror-feedback-controller.ts` updates stream cards or sends fallback final
   messages.

Mirror should be understood as Codex-thread mirror. The source data is a local
Codex session file.

### Command Application Layer

Slash commands are parsed in `src/lib/bridge/command/dispatch.ts`, with aliases
in `command/aliases.ts`, command presentation in `command/presentation.ts`, and
diagnostics/health presentation in `command/diagnostics-presentation.ts`.

Commands currently mix several use-case families:

- diagnostics and status;
- session/thread selection;
- binding management;
- runtime provider and settings;
- tmux remote control;
- history and local file helpers;
- permissions and stop handling.

Future extraction should group commands by user workflow, not by arbitrary
single-command files.

## Data Operations

### Codex-to-IM Owned Data

Codex-to-IM stores small local data as JSON/JSONL under `~/.codex-to-im`.

Important files:

- `config.v2.json`: structured runtime and channel configuration;
- `data/sessions.json`: Bridge sessions, including `codex_thread_id`;
- `data/bindings.json`: channel/chat to Bridge session bindings;
- `data/channel-default-targets.json`: default target per channel instance;
- `data/messages/<sessionId>.json`: Bridge message cache;
- `data/permissions.json`: permission links;
- `data/offsets.json`: adapter consumption offsets;
- `data/dedup.json`: dedup timestamps;
- `data/audit.json`: audit records;
- `thread-table-messages.json`: latest thread-card message pins;
- Weixin account/context token files;
- runtime status files for bridge and UI processes.

Schemas are published under `schemas/`, and `docs/json-schemas.md` describes
the upgrade contract. Startup storage migrations fold retired thread fields
into `codex_thread_id` and reject thread identity on bindings.

### Codex-Owned Data

Codex data is read, not owned:

- `~/.codex/sessions/**/*.jsonl` for local Codex session events;
- `~/.codex/state_*.sqlite` for compatibility metadata in the local index path.

The bridge uses these files for thread discovery, history views, and mirror
delivery. It should not treat them as Codex-to-IM storage.

### Mutation Boundaries

Current mutation boundaries are:

- `JsonFileStore` mutates bridge-owned JSON state;
- `storage-migrations.ts` mutates old local state into the current schema;
- `config.ts` mutates config files;
- `session-bindings.ts` and `channel-router.ts` create/update bindings and
  imported sessions through the store;
- command handlers and UI routes call those helpers directly in several places.

The architectural direction is to move these mutations behind session/binding
application services, while keeping JSON files human-readable and repairable.

## Conversation Modes

### Direct Conversation

Direct conversation is the normal IM-to-Codex path.

The user sends plain text. The bridge resolves the chat to the active binding,
creates a draft or new session if needed, runs Codex through the selected
provider, streams progress back to IM, persists assistant output in the Bridge
message cache, and stores the returned `codex_thread_id` on the session.

Motivation: IM should be able to continue a real Codex conversation without
forcing users into a separate bridge-only chat model.

Main dependencies:

- channel adapter;
- channel router;
- BridgeSession and Binding registry;
- Codex provider routing;
- conversation engine;
- stream feedback and delivery pipeline.

### Mirror

Mirror is observation of a Codex thread that may be active outside IM.

If a binding's session has `codex_thread_id`, mirror can watch the local Codex
JSONL file and deliver new output to the chat. It is independent from direct
conversation, although suppression coordinates the two so IM-originated turns
do not echo back as duplicate mirror messages.

Motivation: users can leave the native/TUI/CLI surface and still see progress
from the same Codex thread in IM.

Main dependencies:

- local Codex session index;
- mirror subscription registry;
- mirror reconcile and cursor state;
- mirror turn finalization;
- channel streaming or fallback delivery.

### Commands

Commands are control messages. They may inspect global status, mutate the
current chat's binding/session, change runtime settings, read history, send
files, or handle permissions.

Motivation: IM platforms need reliable text-first operations that work even
when rich cards are unavailable.

Main dependencies:

- command aliases and parser;
- store/session/binding registry;
- local Codex session index for thread lists and history;
- config for global settings;
- provider/tmux helpers;
- delivery and rich-card formatting.

## Command Scope

### Channel-Level Commands

Channel-level commands can answer without creating or applying a default target
for the chat. In the current dispatcher, `/status`, `/threads`, and the base
`/t` path are handled this way.

Examples:

- `/status`: global bridge, UI, adapter, session, and binding status;
- `/threads`: list local Codex sessions from the local session index;
- `/t`: list local Codex sessions and show binding state for the current chat;
- `/t all` and `/t n 100`: expanded local Codex session lists.

These commands still know the current channel/chat because they annotate which
threads are already bound to that chat, but their primary subject is the
channel or global bridge state rather than one active binding.

### Binding-Level Commands

Binding-level commands inspect or mutate the current chat's active binding or
one of its bound sessions.

Examples:

- `/`: current chat/current session diagnostics;
- `/current`: detailed active binding/session state;
- `/new`: create a new Bridge session and bind it to the chat;
- `/t ls`: list bindings for this chat;
- `/t add`: add a local Codex thread as a binding;
- `/t use`: switch the active binding;
- `/t rm`: remove a binding;
- `/t rename`: rename the current session;
- `/thread 0`: switch to hidden draft session;
- `/mode`, `/provider`, `/reasoning`, `/sandbox`, `/network`, `/model`: update
  session-level runtime settings;
- `/history` or `/his`: read history for the current session;
- `/stop`: stop the current active task or tmux provider output;
- `/perm`: handle permission requests for the relevant session;
- `/cat` and `/file`: read/send local files relative to the current binding's
  working directory unless an absolute path is provided.

### Global Setting Commands

Some commands are invoked from a chat but mutate global configuration.

Example:

- `/ui on|off` toggles global SDK tool-detail display.
- `/his limit <1-20>` changes the global default history card limit.

These commands should remain clearly labeled because they are not scoped to a
single binding even though they are sent through one chat.

## UI Mapping

The local UI exposes the same concepts in a more operator-oriented way.

### Overview

Shows service and bridge status, process state, configured channel count, and
runtime controls. This corresponds to `/status`, but includes local-only
process controls such as start/stop/restart.

### Sessions

Lists local Bridge sessions and locally discovered Codex sessions. The UI uses
`BridgeSession.id` for mutable operations and `codexThreadId` only for
read-only local-index rows before materialization. Local Codex sessions are
materialized into Bridge sessions when the user performs a mutating action.
The user-facing concept should be "local Codex session" or "Codex thread",
not a selector string.

### Session History

Displays parsed history for a selected session.

For a Bridge session with `codex_thread_id`, the UI prefers the corresponding
Codex JSONL history. If no JSONL file is available, it falls back to
`data/messages/<sessionId>.json`. For a read-only local-index Codex row, it
reads the local Codex JSONL directly by `codexThreadId`.

This maps to `/his`, `/his msg`, and `/his json` on the IM side.

### Channels

Shows configured Feishu/Weixin instances, login/test controls, binding lists,
and channel default targets. This is the operator view over `IMChannel`,
`ChannelBinding`, and `ChannelDefaultTarget`.

### Config

Edits global defaults such as model, sandbox, network, reasoning, markdown
feedback, history limits, and SDK tool-detail display. Some IM commands can
override these values per session; the UI should keep "global default" and
"current session override" language explicit.

### Commands

Displays user-facing command help. It is a presentation surface over the
command application layer and must stay aligned with `command/dispatch.ts`.

## Natural Clusters

The codebase naturally groups into these clusters:

- identity and display model: session/thread target summaries, titles, source
  labels, provider/mode labels;
- session and binding registry: product state and invariants;
- local Codex session index: JSONL/session discovery, history, and mirror
  input;
- interactive turn runtime: one IM prompt to one Codex provider run;
- mirror runtime: local Codex session events back to IM;
- command application layer: text-first use cases;
- channel delivery and adapters: platform I/O;
- local UI and service management: operator workflows.

The main current issue is not import cycles. The main issue is that domain
rules, display rules, application workflows, runtime orchestration, and
platform formatting are mixed inside broad files such as `ui-server.ts`,
`command/dispatch.ts`, `session-bindings.ts`, and the local Codex session index.

## Terminology Rules Going Forward

- Use `codex_thread_id` as the only persisted Codex thread identity.
- Do not introduce `thread_id` as a replacement field.
- Do not read retired identity fields as business fallback:
  `sdk_session_id`, `sdkSessionId`, `desktop_thread_id`, or `thread_origin`.
- Use "Codex session" or "local Codex session" for JSONL-indexed threads.
- Use "Native" or "local Codex" for local Codex clients and JSONL-indexed
  sessions.
- Keep `ChannelBinding` as chat-to-BridgeSession state, not chat-to-thread
  state.
- Treat old selector strings as migration input only. Runtime UI/API code
  should use `BridgeSession.id` plus explicit Codex-thread import.
