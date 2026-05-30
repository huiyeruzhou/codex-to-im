# 阶段归档：interactive SDK runtime port audit

## 阶段信息

- 阶段开始：2026-05-30 08:22 CST
- 阶段审计：2026-05-30 08:27 CST
- 阶段目标：继续 `cluster-01`，审计并收缩 `src/lib/bridge/interactive-turn/sdk/conversation-engine.ts` 对 `context.ts`、`sse-stream-decoder.ts`、runtime options 的直接依赖；若这些依赖构成同一个 SDK turn execution runtime，则通过一个粗粒度端口注入。
- 阶段起点 HEAD：`d2d22e4 Port interactive turn runtime settings`
- 工作树注意事项：`AGENTS.md` 有用户侧协作规范更新，不属于本阶段提交范围。

## 原始行动记录

- 2026-05-30 08:22 已开启新阶段。当前 HEAD 为 `Port interactive turn runtime settings`；工作树仅剩用户侧 `AGENTS.md` 未提交改动。本阶段先读取 `conversation-engine.ts`、runner 调用点、bridge manager 注入点、conversation engine tests 和审计产物中的外聚热点，判断能否用一个 SDK runtime port 同时承接 context store/llm、SSE decoder 和 runtime options 解析。
- 2026-05-30 08:24 已完成第一轮审计：`processMessage` 当前直接读取 `getBridgeContext()` 获取 `store` / `llm`，`consumeStream` 再次直接读取 `getBridgeContext().store`，同文件还直接 import `consumeSseEvents` 和 `normalizeSandboxMode` / `normalizeReasoningEffort`。这些依赖共同描述“SDK turn execution runtime”，适合合并为一个 `SdkConversationRuntime` 端口：包含 store、llm、SSE event consumer、runtime option normalizers。下一步改 `conversation-engine.ts` 只依赖该端口，runner 通过 deps 将端口传入，bridge manager 作为 composition root 注入当前 context / decoder / normalizers；direct conversation-engine tests 和 mock-host 显式构造 runtime。
- 2026-05-30 08:26 已完成代码修改并通过初步验证：`conversation-engine.ts` 新增 `SdkConversationRuntime` / `ConsumeSdkSseEvents`，删除对 `context.ts`、`sse-stream-decoder.ts`、`runtime-options.ts` 的直接 import；`processMessage` 和 `consumeStream` 通过 runtime 访问 store、llm、SSE consumer 和 runtime option normalizer；`runner.ts` 新增可选 `resolveSdkConversationRuntime` 端口并传给 SDK engine；`bridge-manager.ts` 注入当前 store、llm、`consumeSseEvents`、`normalizeSandboxMode`、`normalizeReasoningEffort`；conversation-engine focused tests 和 mock-host 显式构造 runtime。已通过 `interactive-turn-sdk-conversation-engine.test.ts`、`interactive-turn-runner.test.ts`、`npm run typecheck`、`source-audit.mjs`。最新审计：本地 import 边 768 -> 771，`Interactive Turn Runtime` 风险 12 -> 11，`Interactive Turn Runtime -> Bridge Host / Runtime Contracts` 25 -> 23，`conversation-engine.ts` 风险跨聚合 import 1 -> 0；代价是 bridge manager composition root 更胖，Bridge Host 出边增加。

## 修改摘要

- `src/lib/bridge/interactive-turn/sdk/conversation-engine.ts`
  - 新增 `SdkConversationRuntime` 和 `ConsumeSdkSseEvents` 端口。
  - 删除对 `context.ts`、`sse-stream-decoder.ts`、`runtime-options.ts` 的直接 import。
  - `processMessage` 和 `consumeStream` 通过 runtime 访问 store、llm、SSE consumer 和 runtime option normalizer。
- `src/lib/bridge/interactive-turn/runner.ts`
  - 新增可选 `resolveSdkConversationRuntime` deps，并在调用 SDK engine 时传入 runtime。
- `src/lib/bridge/bridge-manager.ts`
  - 作为 composition root 注入当前 store、llm、`consumeSseEvents`、`normalizeSandboxMode`、`normalizeReasoningEffort`。
- `src/__tests__/interactive-turn-sdk-conversation-engine.test.ts`
  - 显式构造 test runtime，没有新增测试数量。
- `src/lib/bridge/examples/mock-host.ts`
  - 示例调用显式构造 SDK conversation runtime，保持 direct engine example 可运行。

## 验证记录

- 通过：`node --import tsx --test src/__tests__/interactive-turn-sdk-conversation-engine.test.ts`
  - 7 tests / 3 suites 全部通过。
- 通过：`node --import tsx --test src/__tests__/interactive-turn-runner.test.ts`
  - 15 tests / 1 suite 全部通过。
- 通过：`npm run typecheck`。
- 通过：`node work/rebuild/source-audit.mjs`。
  - 202 个源文件，生产 136、测试 66。
  - 本地 import / re-export 边：771。
  - `Interactive Turn Runtime` 风险跨聚合 import：11。
  - `Interactive Turn Runtime -> Bridge Host / Runtime Contracts` 聚合依赖：23。
  - `src/lib/bridge/interactive-turn/sdk/conversation-engine.ts` 风险跨聚合 import：0。
- 通过：`npm run build`。
- 通过：`npm test`，487 tests / 90 suites 全部通过。
- 通过：`git diff --check`。

## 阶段审计

- 本阶段达成目标：SDK conversation engine 不再直接读取 global bridge context，也不直接持有 SSE decoder / runtime options 的具体实现；这些运行时事实由 bridge manager composition root 注入。
- 复杂度收益集中在边界清晰化：`conversation-engine.ts` 的风险跨聚合 import 归零，`processMessage` / `consumeStream` 外聚度降为 0，`Interactive Turn Runtime -> Bridge Host / Runtime Contracts` 聚合依赖 25 -> 23。
- 代价是 bridge manager 继续变胖，且全局 import 边 768 -> 771；这是 composition root 明确承接 runtime 依赖导致的可解释增长，但后续不能继续无限堆 deps，应考虑把 interactive turn composition 入口从 bridge manager 中收束出来。
- 没有新增生产文件或测试文件；测试只把隐式 context 依赖改为显式 runtime 构造。
- 未完成项：`stream/ui-controller.ts` 和 `sdk/stream-events-controller.ts` 仍直接依赖 `stream-feedback-controller.ts` / security / markdown helper；下一阶段可审计是否应把 structured stream feedback 作为一个 port，而不是继续迁移零散 helper。
