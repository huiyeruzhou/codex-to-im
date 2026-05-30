# 阶段归档：interactive structured stream feedback port audit

## 阶段信息

- 阶段开始：2026-05-30 08:29 CST
- 阶段审计：2026-05-30 08:34 CST
- 阶段目标：继续 `cluster-01`，审计 `stream/ui-controller.ts` 与 `sdk/stream-events-controller.ts` 对 `stream-feedback-controller.ts`、security、markdown helper 的直接依赖，判断是否应收束为 interactive structured stream feedback port，或先收束 bridge manager composition 入口。
- 阶段起点 HEAD：`e0e9366 Port interactive SDK conversation runtime`
- 工作树注意事项：`AGENTS.md` 有用户侧协作规范更新，不属于本阶段提交范围。

## 原始行动记录

- 2026-05-30 08:29 已开启新阶段。当前 HEAD 为 `Port interactive SDK conversation runtime`；工作树仅剩用户侧 `AGENTS.md` 未提交改动。本阶段先读取 stream UI controller、SDK stream events controller、stream feedback controller、runner 调用点和审计热点，判断下一刀是否真的降低跨聚合读取和 AI 入口复杂度。
- 2026-05-30 08:32 已完成审计和第一轮修改：`ui-controller.ts` 与 `sdk/stream-events-controller.ts` 都直接 import `stream-feedback-controller.ts`，但这不是 bridge manager composition 事实，而是 interactive turn 内部的 structured stream feedback 适配职责。新增 `src/lib/bridge/interactive-turn/stream/feedback-port.ts`，集中定义 `InteractiveStreamFeedback` / target，并在该文件里唯一适配 shared `stream-feedback-controller.ts`；`ui-controller.ts` 负责创建本地 feedback port，`sdk/stream-events-controller.ts` 只依赖 `InteractiveStreamFeedback`，runner 传递 `streamUi.feedback`。这保留 shared delivery primitive，同时把两个 controller 从跨聚合直接依赖中解耦；代价是新增一个小端口文件，但它是目录内明确入口，不是零散 helper。
- 2026-05-30 08:33 已通过 targeted tests、`npm run typecheck` 和 source audit。最新审计：源文件 202 -> 203，生产 136 -> 137，import 边 771 -> 774；`Interactive Turn Runtime` 风险跨聚合 import 11 -> 10；`sdk/stream-events-controller.ts` 不再 import `stream-feedback-controller.ts`，`ui-controller.ts` 不再 import `stream-feedback-controller.ts`；跨聚合适配集中到 `stream/feedback-port.ts`。代价是 `Interactive Turn Runtime -> Bridge Host / Runtime Contracts` 聚合依赖 23 -> 24，因为新增本地端口文件同时依赖 shared feedback controller 和 adapter/types；这是有意把直接依赖集中成单一端口，不是全局复杂度净下降。

## 修改摘要

- `src/lib/bridge/interactive-turn/stream/feedback-port.ts`
  - 新增 `InteractiveStreamFeedback` / `InteractiveStreamFeedbackTarget`。
  - 集中适配 shared `stream-feedback-controller.ts` 的 text/tools/tasks/status/metadata/actions/finalize 操作。
- `src/lib/bridge/interactive-turn/stream/ui-controller.ts`
  - 删除对 `stream-feedback-controller.ts` 的直接 import。
  - 通过 `createInteractiveStreamFeedback` 创建本地 feedback port，并向外暴露 `streamUi.feedback`。
- `src/lib/bridge/interactive-turn/sdk/stream-events-controller.ts`
  - 删除对 `stream-feedback-controller.ts` 的直接 import。
  - 通过 `InteractiveStreamFeedback` 推送 partial text、tool progress、task progress 和 final card text。
- `src/lib/bridge/interactive-turn/runner.ts`
  - 将 `streamUi.feedback` 传给 SDK stream events controller。
- `src/__tests__/interactive-turn-sdk-stream-events-controller.test.ts`
  - 用本地 `InteractiveStreamFeedback` test double 替代 adapter-level stream feedback target。

## 验证记录

- 通过：`node --import tsx --test src/__tests__/interactive-turn-sdk-stream-events-controller.test.ts src/__tests__/interactive-turn-runner.test.ts src/__tests__/stream-feedback-controller.test.ts`
  - 20 tests / 3 suites 全部通过。
- 通过：`npm run typecheck`。
- 通过：`node work/rebuild/source-audit.mjs`。
  - 203 个源文件，生产 137、测试 66。
  - 本地 import / re-export 边：774。
  - `Interactive Turn Runtime` 风险跨聚合 import：10。
  - `Interactive Turn Runtime -> Bridge Host / Runtime Contracts` 聚合依赖：24。
  - `stream-events-controller.ts` / `ui-controller.ts` 不再直接 import `stream-feedback-controller.ts`。
- 通过：`npm run build`。
- 通过：`npm test`，487 tests / 90 suites 全部通过。
- 通过：`git diff --check`。

## 阶段审计

- 本阶段达成局部目标：interactive structured stream UI 的两个 controller 不再直接读取 shared stream feedback controller，跨聚合适配集中到 `stream/feedback-port.ts`。
- 复杂度收益是入口和依赖 owner 更清楚：要改 interactive turn structured feedback 先看 `interactive-turn/stream/feedback-port.ts` 和两个 controller，而不是让 SDK event controller 直接知道 shared delivery primitive。
- 数字收益有限且有代价：风险跨聚合 import 11 -> 10，但源文件 202 -> 203、本地 import 边 771 -> 774、Interactive Turn Runtime -> Bridge Host 聚合依赖 23 -> 24。该阶段不是全局复杂度净下降，只是把直接依赖集中成一个可命名端口。
- 未新增测试文件；只调整现有 SDK stream events controller 测试的 test double。
- 未完成项：`bridge-manager.ts` 仍承担过多 interactive turn composition；下一阶段应优先审计是否提取 interactive turn composition factory，而不是继续把所有 runtime port 直接堆进 bridge manager。
