# Thread Binding and Rich Card Refactor Technical Report

## Scope

This document summarizes the multi-turn refactor that changed `/t` from a single chat-to-thread switch into a multi-binding thread control surface, then aligned rich-card UX, streaming-card metadata, mirror delivery, and local deployment behavior around that model.

It supersedes the temporary working notes previously kept in `status.md` and the local `userprompt.md` extraction file.

## Requirements Analysis

The requested work evolved through several related requirements:

- Allow one IM chat to keep multiple bound Codex Desktop threads, with one active binding that receives normal user messages.
- Preserve text command compatibility while adding richer `/t` card controls.
- Remove the old standalone unbind flow and express removal through `/t rm`.
- Add `/t rename` with validation that rejects empty names, pure numbers, and names that look like binding IDs or thread IDs.
- Make `/t ls` ordering stable by binding creation order.
- Make `/t add`, `/t use`, `/t rm`, and `/t <target>` accept index, thread ID, binding ID, or exact session title, with ambiguity handled explicitly.
- Add Feishu rich cards for `/t` and `/tmux-switch` style list views while keeping text-only fallback.
- For `/t`, use a table plus a single-select dropdown and action buttons: bind, unbind, activate, refresh.
- Keep `/t add/use/rm/rename` text commands focused on concise result messages; only explicit list commands and button/refresh callbacks are responsible for refreshing `/t` cards.
- Make `/t` card button operations update the existing card in place when possible, instead of sending a replacement card.
- Remove `/t` rich-card local update TTL so the bridge does not intentionally age out its own update state.
- Unify thread display titles across `/`, `/current`, `/status`, `/his`, `/t`, dropdowns, mirror cards, and user-triggered streaming cards.
- Add streaming-card title metadata and visible binding tags for mirror and user-triggered runs, then remove the `thread_id` tag after review.
- Remove the `Desktop:` prefix from newly created Desktop-backed binding names and strip legacy prefixes from user-visible titles.
- Keep development commands on Node.js 24, commit local code changes, and only push or hot-update when explicitly requested.

## Architecture

### Data Model

`JsonFileStore` remains the persistence boundary for sessions, channel bindings, messages, dedup state, permissions, and audit logs.

The binding model now supports multiple `ChannelBinding` records for the same `channelType + chatId`. The compatibility method `getChannelBinding(channelType, chatId)` returns the active binding, while newer flows use list helpers to operate on all bindings in a chat.

Important identity fields:

- `ChannelBinding.id`: stable binding identity used by `/t use`, `/t rm`, card callbacks, and stream metadata.
- `ChannelBinding.active`: active target marker within a chat.
- `BridgeSession.codex_thread_id`: Codex SDK thread identity.
- `BridgeSession.desktop_thread_id`: explicit Codex Desktop thread identity.
- `BridgeSession.thread_origin`: identifies Desktop-backed sessions for mirror subscription and command policy.

### Routing Layer

The command and message routing path stays centered on:

- `bridge-manager.ts`: adapter lifecycle, command entry, interactive task lifecycle, mirror reconcile hooks.
- `channel-router.ts`: binding creation, active binding selection, and compatibility routing.
- `session-bindings.ts`: binding target validation, one-chat/multi-binding invariants, Desktop-backed session marking.
- `command-dispatch.ts`: `/t` parsing, list rendering decisions, rename validation, callback behavior, and concise command responses.

The main invariant is that normal IM messages go to the active binding only. Inactive bindings may still receive mirror output if they are Desktop-backed and the channel is running.

### Display Layer

`ThreadDisplayService` centralizes thread-title resolution and binding/thread display data.

It resolves titles from, in order:

- stored bridge session name,
- UI metadata,
- Desktop session title,
- working directory fallback,
- shortened session/thread ID fallback.

The service also strips internal `Bridge:` and legacy `Desktop:` prefixes for user-facing surfaces. This prevents `/`, `/current`, `/t`, dropdowns, card headers, and stream metadata from drifting apart.

### Rich Card Layer

`command-formatters.ts` builds command rich-card payloads independent of any one adapter.

For `/t`:

- Global Desktop list cards use `thread-card:global:<channelType>:<chatId>` update keys.
- Bound-thread list cards use `thread-card:bound:<channelType>:<chatId>` update keys.
- Cards include a table, a single-select option list, action buttons, and a refresh button.
- Cards with more than `DESKTOP_THREADS_CARD_MAX_ITEMS` items fall back to text to avoid oversized IM cards.
- `/t` cards set `updateTtlMs: null`, meaning "do not expire this update state locally".

`updateTtlMs` is an internal adapter-cache policy. It is not a Feishu API field. Feishu CardKit update still succeeds or fails according to platform rules, card identity, app identity, and card availability.

### Feishu Adapter Update Strategy

The Feishu adapter supports two rich-card paths:

- Create a CardKit card entity, send it as an interactive message, and store `updateKey -> cardId/messageId`.
- On callback refresh, update the stored card entity in place using `card.update`.

If a callback provides `richCardUpdateMessageId` but the local state is missing, the adapter attempts `card.idConvert` to recover the `card_id`, then updates that recovered card.

If recovery fails, callback-triggered `/t` updates fall back to a plain text reply instead of creating a replacement `/t` card. This avoids confusing the chat with duplicate table cards.

The adapter still has a default TTL for generic updatable rich cards. `/t` explicitly disables only the bridge's local TTL with `updateTtlMs: null`.

Relevant Feishu platform findings:

- CardKit card entity update uses `card_id` and supports Card JSON 2.0 / CardKit cards.
- Message-card patching by message ID has platform time constraints and is a different API path from the CardKit entity update path.
- Card JSON 2.0 cards are shared cards; the bridge must not rely on exclusive-card behavior.

Official references:

- `https://open.feishu.cn/document/cardkit-v1/card/update`
- `https://open.feishu.cn/document/server-docs/im-v1/message-card/patch`
- `https://open.feishu.cn/document/feishu-cards/card-json-v2-structure`

### Streaming Card Metadata

`streaming-metadata.ts` owns stream header tags.

Current behavior:

- `binding_id:<short-id>` is included when a binding or fallback session identity exists.
- `thread_id` is no longer emitted for mirror cards or user-triggered streaming cards.

Mirror and interactive user-message paths both call this shared helper:

- `mirror-feedback-controller.ts`
- `interactive-message-runner.ts`

This keeps stream metadata consistent across Desktop mirror output and user-triggered Codex runs.

## Debugging Process

### Multi-Binding Migration

The first problem was that the original binding storage model effectively behaved like a singleton per chat. The migration kept compatibility by preserving `getChannelBinding()` while adding list-based binding operations for the new `/t` flows.

Tests were extended at the store, command, and bridge-entry levels to prove:

- multiple bindings can exist for one chat,
- active binding selection remains deterministic,
- inactive bound Desktop threads can continue mirror delivery,
- deleting a binding removes only the intended binding.

### `/t` Card Action Semantics

The card UX debugging showed a key ownership rule:

- Text commands like `/t rename`, `/t use`, `/t add`, and `/t rm` should only return concise command results.
- Card callbacks and explicit refresh commands are responsible for mutating or refreshing a card.

This removed the earlier behavior where many `/t` subcommands replied with an entire `/t` table.

The second issue was that callbacks sometimes produced a new card instead of updating the old card. Logs showed a `card.create + im.message.create` path when local card state was not found. The fix was to:

- attach stable `updateKey` values to `/t` cards,
- pass callback message IDs into rich-card sending,
- recover card IDs with `card.idConvert` when needed,
- fall back to plain text if recovery fails during a callback.

### Feishu Rich Card Layout

Card formatting was improved by using native card tables and single-select controls instead of long plain-text lists. The table shape was tuned for mobile and compact scanning:

- long fields like title and working directory receive wider columns,
- short fields like binding ID and action command stay narrow,
- global `/t` cards stop at 20 items and fall back to text beyond that.

### `/t` TTL

The previous `/t` cards used a local `THREAD_CARD_UPDATE_TTL_MS = 30 * 60_000`. That meant the bridge could intentionally reject its own cached card update state after 30 minutes.

Documentation review clarified that this TTL was not a Feishu card property. It was only a local adapter eligibility check. The final behavior is:

- `/t` cards still have stable update keys.
- `/t` cards set `updateTtlMs: null`.
- Feishu adapter treats `null` as "no local expiry".
- If local state is missing, callback message ID recovery is still attempted.
- Platform-level limits remain outside this local policy.

### Title and Metadata Drift

Different surfaces used different title sources. This caused `/`, `/t` dropdowns, and streaming-card titles to disagree.

`ThreadDisplayService` was introduced to make title lookup explicit and reusable. Later cleanup removed the `Desktop:` prefix at creation time and in display-time legacy cleanup. Stream tags were also reduced to only `binding_id` after review.

## Verification

The implementation was verified with Node.js 24.

Commands run during the final pass:

```bash
nvm use 24
npm run typecheck
npm test
npm run build
```

The full test suite passed with 435 tests.

Focused coverage includes:

- `bridge-command-e2e.test.ts`: command entrypoint behavior, multi-binding flows, `/t` card callbacks.
- `command-dispatch.test.ts`: `/t` parsing, rename validation, concise command responses.
- `session-bindings.test.ts`: cross-chat uniqueness, Desktop-backed naming, legacy prefix display cleanup.
- `bridge-manager.test.ts`: mirror behavior, stream metadata, inactive binding mirror continuity.
- `interactive-message-runner.test.ts`: user-triggered stream metadata and card finalization.
- `feishu-adapter.test.ts`: rich-card create/update/recovery/fallback paths and disabled local `/t` TTL.
- `store.test.ts`: multiple bindings per chat and active binding persistence.

## Commit Consolidation

The local work originally existed as several incremental commits:

- multi-binding data model and `/t` command behavior,
- concurrent mirror delivery for inactive bound Desktop threads,
- centralized thread title display,
- Feishu rich-card layout and in-place update recovery,
- stream metadata cleanup and `Desktop:` prefix removal,
- `/t` local TTL removal.

Before pushing, these commits should be squashed into one cohesive feature commit because they are all part of the same unpushed functional change set.

Recommended final commit message:

```text
Refactor thread bindings and rich card updates
```

## Operational Notes

Do not hot update the bridge with a foreground stop command. Use:

```bash
bash scripts/hot-update-bridge.sh
```

If a full `npm test` has just passed for the same local changes, use:

```bash
bash scripts/hot-update-bridge.sh --skip-tests
```

Only pass `--pull` when the user explicitly requests pulling latest remote changes.
