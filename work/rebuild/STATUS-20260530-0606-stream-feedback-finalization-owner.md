# 阶段归档：stream feedback finalization owner

归档时间：2026-05-30 06:06 CST

## 阶段目标

继续 `cluster-01`，审计 mirror delivery / stream feedback / interactive turn runtime 之间的状态规则归属，寻找能减少状态机耦合或收窄 delivery port 的一刀；先审计再改代码。

## 原始行动记录

- 上一阶段已提交为 `6b9f95d Refactor mirror runtime context dependencies`；当前工作树仅剩用户侧 `AGENTS.md` 未提交。本阶段开始读取 `mirror-feedback-controller.ts`、`interactive-message-runner.ts`、`delivery-pipeline.ts`、`stream-feedback-controller.ts`、`stream-state.ts`、`mirror-turns.ts` 等文件，目标是判断 stream target/status/finalize/action rows 的 owner 是否分散，以及哪一个边界收缩能真实降低修改半径。
- 初步审计发现 `delivery-pipeline.ts` 作为最终响应投递模块仍导出 `finalizeStreamingUi`，实际只是包一层 `stream-feedback-controller.finalizeStreamFeedback`；同时 `mirror-feedback-controller.ts` 的最终镜像投递路径绕过 `stream-feedback-controller` 直接调用 adapter `onStreamEnd`。本阶段选择把 stream UI finalization 统一收回 `stream-feedback-controller`，让 delivery pipeline 只保留 text/attachment delivery 职责。
- 已实施 stream finalization owner 收缩：`delivery-pipeline.ts` 删除 `finalizeStreamingUi` wrapper；`interactive-message-runner.ts` 直接调用 `finalizeStreamFeedback` 并继续先用 `assembleCodexFinalResponse` 剥离 final-only send blocks；`mirror-feedback-controller.ts` 的 finalized mirror stream 也改走 `finalizeStreamFeedback`，不再直接调用 adapter `onStreamEnd`；对应测试从 `delivery-pipeline.test.ts` 移到 `stream-feedback-controller.test.ts`。该改动降低的是职责归属混杂，不追求文件体积变化。

## 修改摘要

- `src/lib/bridge/turns/delivery-pipeline.ts`
  - 删除 `finalizeStreamingUi`。
  - 删除对 `stream-feedback-controller.ts` / `StreamFeedbackTarget` 的 import。
  - 保持 `deliverFinalResponse` 只负责最终文本和附件投递。
- `src/lib/bridge/interactive-message-runner.ts`
  - 从 `stream-feedback-controller.ts` 直接 import `finalizeStreamFeedback`。
  - `finalizeStreamUiOnce` 继续通过 `assembleCodexFinalResponse({ text }).text` 剥离 final-only send blocks，再交给 stream feedback finalization。
- `src/lib/bridge/mirror-feedback-controller.ts`
  - finalized mirror stream 的 `onStreamEnd` 路径改为 `finalizeStreamFeedback`。
  - 保留 Feishu provider gating 和附件 fallback delivery 行为。
- `src/__tests__/delivery-pipeline.test.ts`
  - 删除 stream finalization 测试，让该文件只覆盖 final response delivery。
- `src/__tests__/stream-feedback-controller.test.ts`
  - 新增 `finalizeStreamFeedback` 通过 adapter finalization 的测试。
- `work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md`
  - 复跑审计脚本，记录本阶段后的依赖图和函数级依赖结果。

## 扫描和复杂度结论

- 最新审计：192 个 `src/**/*.ts` 文件，其中生产 129 个、测试 63 个；本地 import / re-export 边仍为 740。
- 函数节点从 1553 降到 1551；函数依赖边从 1772 降到 1771；外聚边从 258 降到 257。
- `Interactive Turn Runtime` 风险跨聚合 import 从 4 降到 3。
- `src/lib/bridge/turns/delivery-pipeline.ts` 从 87 行降到 75 行，不再 import `stream-feedback-controller.ts`；它在风险列表中只剩 `feedback-delivery.ts` 依赖。
- `cluster-01` 内部跨聚合边从 100 降到 99；这只是小幅指标变化，主要价值是职责 owner 更清晰。

## 验证记录

- 已通过：`npm run typecheck`。
- 已通过：`node --test --import tsx src/__tests__/stream-feedback-controller.test.ts src/__tests__/delivery-pipeline.test.ts src/__tests__/interactive-message-runner.test.ts src/__tests__/mirror-feedback-controller.test.ts src/__tests__/bridge-manager.test.ts`，91 tests 全部通过。
- 已通过：`node work/rebuild/source-audit.mjs`。
- 已通过：`npm run build`。
- 已通过：`npm test`，477 tests / 87 suites 全部通过。
- 已通过：`git diff --check -- src/lib/bridge/turns/delivery-pipeline.ts src/lib/bridge/interactive-message-runner.ts src/lib/bridge/mirror-feedback-controller.ts src/__tests__/delivery-pipeline.test.ts src/__tests__/stream-feedback-controller.test.ts work/rebuild/STATUS.md work/rebuild/source-file-audit.json work/rebuild/source-file-audit.md`。
- 验证期间出现的 `bridge-manager` / `codex-provider` / `feishu-adapter` 错误日志来自测试覆盖的预期失败路径。

## 阶段审计判断

- 完成情况：本阶段完成了 stream UI finalization owner 收缩，消除了 delivery pipeline 对 stream feedback 的反向职责依赖，并让 interactive / mirror finalized stream 都经由同一个 stream feedback owner。
- 复杂度价值：这不是大规模降复杂度，但它让“最终响应投递”和“stream UI finalization”两个入口的职责更稳定，后续 AI 修改附件投递或 stream card finalize 时更容易定位 owner。
- 保留缺口：`runInteractiveMessage` 仍直接管理 heartbeat、status、preview、structured stream snapshot、stop action 和 final response delivery；`mirror-feedback-controller.ts` 仍同时拥有 mirror formatting、stream update 和 final delivery。后续应继续把状态 session 或 delivery port 收窄，而不是按行数拆分。

## 下一阶段建议

继续 `cluster-01`，优先审计 `runInteractiveMessage` 中 structured stream heartbeat / snapshot / stop action 的 owner，或审计 mirror finalized delivery 与 attachment fallback 的 port 边界。
