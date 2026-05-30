# Abstraction Smell Closing Audit Archive

## 阶段目标

根据用户 2026-05-30 10:00 收尾要求，逐个阅读当前 `src` 下生产 `.ts` / `.d.ts` 文件，检查是否存在“屎山级别的不合理抽象”，并将证据、影响和处置建议记录到 `work/rebuild/abstraction-smell-audit.md`。

## 原始行动记录摘要

- 2026-05-30 10:19 开启阶段。确认生产源文件目标数为 137；创建 `work/rebuild/abstraction-smell-audit.md`；首批阅读 `bridge-session-support.ts`、`interactive-turn/runner.ts`、`bridge-manager.ts`、`ui/server.ts`，标注 `bridge-session-support.ts` 为 S1，`interactive-turn/runner.ts` 为 S2。
- 2026-05-30 10:27 阅读 hot/risky 文件：`ui/shell.ts`、`adapters/feishu-adapter.ts`、`service-manager.ts`、`config.ts`、`store.ts`、`command/tmux.ts`、`codex/provider.ts`、`codex/tmux-provider.ts`、`command/session-thread.ts`、`command/presentation.ts`、`command/runtime-settings.ts`、`command/diagnostics.ts`；覆盖 16/137。
- 2026-05-30 10:34 阅读 runtime/registry/UI application 交叉边界：`main.ts`、`command/dispatch.ts`、`mirror-feedback-controller.ts`、`mirror-runtime.ts`、`session-registry/bindings.ts`、`thread-display-resolver.ts`、`interactive-turn/turn-environment.ts`、`interactive-turn/stream-ui-controller.ts`、`interactive-turn/sdk-conversation-engine.ts`、`ui/application/session.ts`、`ui/application/session-source.ts`；覆盖 27/137。
- 2026-05-30 10:41 阅读 platform adapter / markdown / Local Codex Session Index：`adapters/weixin-adapter.ts`、`weixin/login.ts`、`weixin/store.ts`、`markdown/feishu.ts`、`markdown/ir.ts`、`codex/session-index/core.ts`、`event-mirror-parser.ts`、`discovery-scanner.ts`、`history-parser.ts`、`file-readers.ts`；覆盖 37/137。
- 2026-05-30 10:26 阅读 Local Codex Session Index 剩余小文件与 mirror helpers：`codex/session-index.ts`、`archive-store.ts`、`jsonl-types.ts`、`paths.ts`、`sqlite-visibility.ts`、`workspace-filter.ts`、`mirror-turns.ts`、`mirror-formatters.ts`、`mirror-reconcile-core.ts`、`mirror-delivery-plan.ts`；覆盖 47/137。
- 2026-05-30 10:28 阅读 bridge turn shared primitives 与 delivery helpers；纠正过期路径，`turn-*` 文件实际在 `src/lib/bridge/turns/`；覆盖 56/137。
- 2026-05-30 10:30 阅读 mirror reconcile/subscription support 与 bridge runtime/delivery helpers；覆盖 66/137。
- 2026-05-30 10:33 阅读 channel contracts / permission / command facade helpers；覆盖 76/137。
- 2026-05-30 10:34 阅读 command presentation/source 与 display/host/context helpers；覆盖 86/137。
- 2026-05-30 10:36 阅读 interactive-turn remaining helpers、interactive runtime 和 markdown/security helpers；覆盖 96/137。
- 2026-05-30 10:37 阅读 session health / registry / tmux runtime / shared contracts helpers；覆盖 106/137。
- 2026-05-30 10:39 阅读顶层 runtime support：`bridge-instance-lock.ts`、`cli.ts`、`codex/models.ts`、`codex/routing-provider.ts`、`codex/session-mirror.ts`、`internal-sessions.ts`、`logger.ts`、`permission-gateway.ts`、`runtime-options.ts`、`sse-utils.ts`、`storage-migrations.ts`、`qrcode.d.ts`；覆盖 118/137。
- 2026-05-30 10:41 阅读 UI application 与 UI route helpers；发现原清单中的 `src/ui/application/session-import.ts` 当前不存在；覆盖 128/137。
- 2026-05-30 10:47 阅读最后 9 个未覆盖生产源文件：`lib/bridge/adapters/index.ts`、`lib/bridge/adapters/weixin/weixin-api.ts`、`weixin-ids.ts`、`weixin-media.ts`、`weixin-session-guard.ts`、`weixin-types.ts`、`ui/routes/session.ts`、`ui/routes/weixin-login.ts`、`ui/session-history.ts`；覆盖 137/137。
- 2026-05-30 10:49 恢复 active goal 后重新取证：工作树有用户侧 `AGENTS.md` 修改、本阶段 `STATUS.md` 修改、未跟踪归档和 `abstraction-smell-audit.md`；当前环境没有 `rg`，扫描改用 `find`/`grep`。
- 2026-05-30 10:51 第一版覆盖脚本只匹配 `### \`file\``，没有匹配 `### S1: \`file\`` / `### S2: \`file\``，误报 108/137 和 29 个 missing；修正正则后覆盖校验通过。

## S1/S2 问题清单

- S1: `src/lib/bridge/bridge-session-support.ts`
- S2: `src/lib/bridge/interactive-turn/runner.ts`
- S2: `src/service-manager.ts`
- S2: `src/lib/bridge/adapters/feishu-adapter.ts`
- S2: `src/lib/bridge/command/runtime-settings.ts`
- S2: `src/lib/bridge/command/diagnostics.ts`
- S2: `src/lib/bridge/command/tmux.ts`
- S2: `src/lib/bridge/command/session-thread.ts`
- S2: `src/lib/bridge/command/dispatch.ts`
- S2: `src/lib/bridge/session-registry/bindings.ts`
- S2: `src/lib/bridge/thread-display-resolver.ts`
- S2: `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts`
- S2: `src/weixin/login.ts`
- S2: `src/codex/session-index/jsonl-types.ts`
- S2: `src/lib/bridge/mirror-formatters.ts`
- S2: `src/lib/bridge/mirror-turns.ts`
- S2: `src/lib/bridge/mirror-suppression.ts`
- S2: `src/lib/bridge/bridge-adapter-runtime.ts`
- S2: `src/lib/bridge/bridge-channel-runtime.ts`
- S2: `src/lib/bridge/channel-router.ts`
- S2: `src/lib/bridge/delivery-layer.ts`
- S2: `src/lib/bridge/channel-adapter.ts`
- S2: `src/lib/bridge/permission-broker.ts`
- S2: `src/lib/bridge/command/control.ts`
- S2: `src/lib/bridge/command/status.ts`
- S2: `src/lib/bridge/host.ts`
- S2: `src/lib/bridge/context.ts`
- S2: `src/lib/bridge/interactive-runtime.ts`
- S2: `src/lib/bridge/types.ts`

## 验证输出摘要

- 覆盖校验：
  - `src_count=137`
  - `audited_count=137`
  - `missing:` 无输出
  - `extra:` 无输出
  - `duplicate=0`
- S1/S2 标注校验：`grep -n '^### S[12]:' work/rebuild/abstraction-smell-audit.md | wc -l` 输出 `29`。
- `git diff --check -- work/rebuild/STATUS.md` 通过。
- `grep -n '[[:blank:]]$' work/rebuild/abstraction-smell-audit.md` 无输出。

## 阶段判断

本阶段是收尾审计和文档标注，没有修改生产代码。审计证明当前 137 个生产 `.ts` / `.d.ts` 文件均有逐文件初判；发现的问题主要是 catch-all support/helper、全局 context/service locator、shared contracts catch-all、平台 adapter/base adapter contract 过宽、UI/command/service workflow 混合 owner。当前不立即重构这些 S1/S2 项，而是作为后续处置清单保留；这符合用户 10:00 的“如果有就标注出来”要求。
