# 阶段归档：ui session application source boundary audit

## 阶段描述

基于新目录形态，聚焦 `src/ui/application/session.ts`、`src/ui/session-history.ts`、`src/lib/bridge/session-registry.ts` 和 `src/codex/session-index.ts` 的 UI session 用户故事边界；审计并收束 UI session application 对 Local Codex Session Index、默认模型读取、Codex history 读取和 registry wiring 的混杂依赖，让“查看/导入/配置会话”的入口更稳定，同时避免新增无意义测试或单文件阶段。

## 原始行动和事实

- 2026-05-30 09:24 开启阶段。初始 HEAD 为 `52e7f7b Organize source module folders`，随后按用户指令将 `origin/master..52e7f7b` 的 35 个本地重构/文档 commit squash 为 `6064595 Rebuild source architecture`。执行前将当前 UI session WIP 和用户侧 `AGENTS.md` 临时 stash，squash 后恢复，避免未验证 WIP 混入已完成阶段。
- 第一轮审计确认 `UiSessionApplication` 直接 import `readConfiguredCodexModel`、`archiveCodexSession`、`getCodexSessionByThreadId`、`getCodexSessionsRoot`、`listCodexSessions`、`readCodexSessionJsonlHistoryStreamByFilePath`、`SessionDisplayQuery` 和 `SessionRegistryService`。它同时承担 HTTP-facing use cases、Local Codex source 读取、history markdown rendering、registry port composition 和 config payload sanitize。
- `SessionRegistryService` 已有 `CodexThreadRegistryPort`，说明 registry 层已经预留 Local Codex source 端口。UI application 继续直接知道 Codex index 细节会让“查看/导入/配置会话”的入口混杂。
- 实现新增 `src/ui/application/session-source.ts`，定义 `UiSessionCodexSource`、默认 Local Codex source 和 `createUiSessionRegistry`。`UiSessionApplication` 改为依赖该 source port，不再直接 import `src/codex/*` 或 `SessionRegistryService`。
- 新增 `src/__tests__/ui-session-application.test.ts`，用注入 fake source 验证 list/history/import/archive 都通过同一个 source port。新增测试是为了覆盖新的 application 边界，不是为了扩大用例矩阵。

## 审计结果

- 最新 `node work/rebuild/source-audit.mjs`：203 个 `src/**/*.ts` 文件，其中生产 136 个、测试 67 个；本地 import / re-export 边 774。
- `src/ui/application/session.ts` 从 287 行降到 272 行，直接 import 从 7 降到 5，风险跨聚合 import 从 3 降到 1。
- 新增 `src/ui/application/session-source.ts` 57 行，承接 Local Codex source 和 registry factory 4 个外部 import。阶段收益是 UI session application 主入口更纯，代价是 Local Codex source adapter 仍是跨聚合接点。
- `src/ui/application` 目录现在包含 6 个文件 / 921 行；新增 source adapter 后 UI session 用户故事入口更清楚，但 `cluster-02` 仍是 Local UI / Config / Service / Store / Persistence 混合簇，不能宣称完整 UI/config/service/store 纠缠已解决。

## 验证命令

- 通过：`node --test --import tsx src/__tests__/ui-session-application.test.ts src/__tests__/ui-session-history.test.ts src/__tests__/session-registry.test.ts src/__tests__/session-display-query.test.ts`，9 tests / 3 suites 全部通过。
- 通过：`npm run typecheck`。
- 通过：`node work/rebuild/source-audit.mjs`。
- 通过：`npm run build`。
- 通过：`npm test`，488 tests / 91 suites 全部通过。
- 通过：`git diff --check`。

## 阶段结论

本阶段完成。它没有降低全局 import 边数，也新增了一个测试文件；但新增测试覆盖的是新抽出的粗粒度 source port，收益是 `UiSessionApplication` 不再直接读取 Codex index 或构造 `SessionRegistryService`，后续修改 UI session list/history/import/archive 时入口更稳定。下一阶段应继续沿 `cluster-02` 或 `cluster-01` 的真实混合边界推进，例如审计 `src/ui/application/binding.ts` / `src/session-bindings.ts` / `src/lib/bridge/session-registry.ts` 的 registry ownership，或转回 `bridge-manager.ts` 对 `src/codex/session-index.ts` 的直接依赖。
