## 任务目标

原始指令：`下一个阶段的任务是加上显示context的功能，目前ui端已经有百分比形式的context显示，要在interactive和mirror的流式卡片的底部状态栏也有实时消耗context的一个展示，形式为xxxk(xx%)还有本轮task的输入/输出token总量的展示，可以显示为上箭头/下箭头的形式，以k为单位，这需要你正确解析jsonl提供的context信息`

## 任务上下文

- 仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前环境 `rg` 不可用，检索使用 `find`/`grep`。
- 当前工作树已有未提交无关改动：`AGENTS.md`、`work/shell-safe-command/STATUS.md`、`work/binding-d492179f-activation/`；另外本地 `master` 已有未 push 的上一阶段提交 `19d94ac Limit thread table card action rows`。本任务不回退、不混入无关改动。
- Node.js 开发命令需要使用 Node.js 24：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && ...`。

## 任务日志

### 2026-06-01 12:03 CST 阶段：流式卡片 context/token 状态栏展示

阶段描述：解析 Codex JSONL 中的 context/token 信息，并在 interactive 与 mirror 流式卡片底部状态栏实时显示 context 消耗和本轮输入/输出 token。

- 行动：记录用户目标；检查当前工作树，确认存在无关未提交改动，需排除。
- 行动：初步检索现有 context/token 处理，发现 `src/codex/session-index/history-parser.ts` 已解析 `token_count` payload，其中包含 `total_token_usage`、`last_token_usage`、`model_context_window`，并生成 UI 历史展示用的百分比信息。
- 行动：初步检索 interactive/mirror 流式路径，定位候选文件：`src/lib/bridge/interactive-turn/runner.ts`、`src/lib/bridge/interactive-turn/sdk-stream-events-controller.ts`、`src/lib/bridge/mirror-feedback-controller.ts`、`src/codex/session-index/event-mirror-parser.ts`、`src/lib/bridge/mirror-turns.ts`。
- 行动：新增 `src/lib/bridge/context-usage.ts`，集中定义 `ContextUsageInfo` / `ContextTokenUsage`，解析 JSONL `token_count.info` 中的 `model_context_window`、`last_token_usage`、`total_token_usage`，并提供历史详情格式和流式状态栏紧凑格式。
- 行动：修改 `src/codex/session-index/history-parser.ts`，复用新的 context usage 解析/格式化，保持 UI 历史中原有百分比形式语义。
- 行动：修改 `src/codex/session-index/event-mirror-parser.ts` 与 `src/codex/session-index/jsonl-types.ts`，不再把 `token_count` 仅作为 ignored bookkeeping，而是解析成 `context_usage` mirror record，携带结构化 `contextUsage`。
- 行动：修改 `src/lib/bridge/turns/stream-state.ts`，给 `StreamState` 增加 `contextUsage`，状态栏格式化追加紧凑 context 文本：`xxxk(xx%) · ↑xxk ↓xxk`。
- 行动：修改 `src/lib/bridge/mirror-turns.ts` 与 `src/lib/bridge/mirror-feedback-controller.ts`，mirror 消费 `context_usage` record 后更新当前 turn 的 `contextUsage`，并触发状态栏刷新；mirror 状态栏传入该 context usage。
- 行动：2026-06-01 12:10 CST 继续审计当前工作树，确认已有改动已新增 `context-usage.ts`、JSONL `token_count` -> `context_usage` mirror record、`StreamState.contextUsage` 与 mirror 状态栏传递；缺口是 interactive/sdk provider 的 `result.usage` 尚未转成同一套 context 状态，且需要确认测试覆盖与格式是否满足 `xxxk(xx%) · ↑xxk ↓xxk`。
- 行动：2026-06-01 12:10 CST 已补齐 interactive 数据通路：`CodexTmuxProvider` 将 JSONL `context_usage` mirror record 转为 SSE `context_usage`；`sdk-conversation-engine` 消费该事件并回调；SDK `result.usage` 兜底转成本轮 `last_token_usage`；`sdk-stream-events-controller` 更新 `StreamState.contextUsage` 并刷新运行状态。新增 controller 测试覆盖 stale task 忽略和 context usage 刷新。
- 阶段验证：2026-06-01 12:12 CST `npm run typecheck` 通过。随后运行测试命令时脚本未按 pattern 限制，实际跑完整套测试；首次 539/541，两个失败均为旧 deepEqual 期望缺少新增 `contextUsage: null` 字段。已更新断言后复跑完整测试，结果 541/541 通过。

### 2026-06-01 12:13 CST 阶段审计：流式卡片 context/token 状态栏展示

- 当前进入阶段审计。
- 审计目标对照：
- JSONL context 解析：`token_count.info` 通过 `parseContextUsageInfo()` 解析 `model_context_window`、`last_token_usage`、`total_token_usage`，mirror parser 输出 `context_usage` record；`codex-session-index` 测试覆盖。
- mirror 流式卡片状态栏：`mirror-turns` 保存 `contextUsage`，`mirror-feedback-controller` 传入 `formatStreamRuntimeStatus()`，测试覆盖 `125k(63%) · ↑125k ↓4.6k`。
- interactive 流式卡片状态栏：`tmux-provider` 将 JSONL-derived `context_usage` 转成 SSE，`sdk-conversation-engine` 消费并回调，`sdk-stream-events-controller` 更新 `StreamState.contextUsage` 并刷新状态；SDK `result.usage` 兜底提供本轮输入/输出 token。
- 格式：`formatContextUsageCompact()` 输出 `xxxk(xx%) · ↑xxk ↓xxk`；没有 context window 时仍可显示本轮 ↑/↓ token。
- 验证：`npm run typecheck` 通过；`npm test -- --test-name-pattern ...` 实际执行完整测试，最终 541/541 通过；`npm run build` 通过。
- 阶段结论：目标已覆盖 interactive 与 mirror 两条流式状态栏路径，JSONL `token_count` 被结构化解析并用于实时状态展示。本阶段可以提交。

### 2026-06-01 12:20 CST 阶段：completed/error 终态保留 context 展示

阶段描述：用户追加要求 `在completed或者error的时候给我把context信息流下，amend进之前的feature`；需要确保流式卡片从 running 切到 completed/error 后，最终状态/内容仍能看到 context/token 信息，并 amend 到 `Show context usage in stream status`。

- 行动：检查当前提交和工作树，确认上一阶段提交为 `0ef573a Show context usage in stream status`，存在无关未提交改动 `AGENTS.md`、`work/shell-safe-command/STATUS.md`、`work/binding-d492179f-activation/`，本阶段继续排除无关改动。
- 行动：检索 completed/error/finalize 路径，初步发现 running 状态已通过 `formatStreamRuntimeStatus(..., contextUsage)` 展示 context；interactive `finalizeOnce()` 当前停止状态更新后直接 `finalizeStreamFeedback(status, normalizeFinalText(responseText))`，终态文本可能不包含 context。
- 行动：实现终态 context 保留：新增 `appendContextUsageCompactText()`，interactive `finalizeOnce()` 在 completed/error 时把紧凑 context 行追加到最终流式卡片文本；mirror `FinalizedCodexMirrorTurn` 携带 `contextUsage`，completed turn 在最终卡片文本中追加同一 context 行。
- 行动：补充测试意图：interactive 结构化流式卡片完成时 `onStreamEnd` 文本应包含 `Context: 125k(63%) · ↑125k ↓4.6k`；mirror completed 最终卡片也应包含同一 context 行。
- 行动：首次 `npm run typecheck` 暴露 `FinalizedCodexMirrorTurn.contextUsage` 被误设为必填会冲击既有 pending-delivery 测试夹具；已修正为 finalized turn 可选、pending turn 必填，保持持久化/测试兼容。
- 行动：复跑验证时测试脚本仍实际执行全量测试。第二次执行前已修正 mirror 无 context 终态对象不再输出 `contextUsage: null/undefined`，避免破坏既有深等断言。
- 验证：`npm run typecheck` 通过；`npm test -- --test-name-pattern "context|structured stream UI already finalized|mirror context"` 实际执行完整测试，最终 `541/541` 通过。
- 验证：`npm run build` 通过，已生成 dist 产物但当前工作树未出现 dist 改动。

### 2026-06-01 12:31 CST 阶段审计：completed/error 终态保留 context 展示

- 当前进入阶段审计。
- 审计目标对照：用户要求 completed 或 error 时也把 context 信息流下，并 amend 进之前 feature。interactive 路径现在在 `finalizeOnce()` 里仅对 `completed`/`error` 追加 `Context: xxxk(xx%) · ↑xxk ↓xxk`；`interrupted` 不追加，避免停止场景噪音。
- mirror 路径现在在 turn finalize 时保留非空 `contextUsage`，并在 completed 最终卡片文本里追加同一 context 行；无 context 的旧/普通 mirror turn 不输出 `contextUsage: null/undefined`，保持既有深等和 pending-delivery 兼容。
- 测试覆盖：interactive runner 测试断言 completed `onStreamEnd` 文本包含最终回复和 context 行；mirror feedback controller 测试断言 running status 与 completed final card 都包含 context 行。
- 验证结果：`npm run typecheck` 通过；完整测试 `541/541` 通过；`npm run build` 通过。
- 阶段结论：追加需求已完成，准备只暂存本 feature 相关源码、测试和本 `STATUS.md`，amend 到 `Show context usage in stream status`。
- 阶段验证和git提交：已执行 `git commit --amend --no-edit`，当前本地提交为 `Show context usage in stream status`（最终 hash 以 `git log -1` 为准）；本次 amend 只暂存 context feature 相关源码、测试和本 `STATUS.md`，未暂存既有无关改动 `AGENTS.md`、`work/shell-safe-command/STATUS.md`、`work/binding-d492179f-activation/`。
