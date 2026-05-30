# 2026-05-30 09:08 interactive turn small-file merge archive

## 阶段目标

继续回应用户关于 `interactive-turn/` 小文件和命名的纠偏，审计 `stream-feedback-port.ts` 这类单一 owner 转接文件是否应合并；根据 09:04 / 09:05 用户纠偏，本阶段不按单文件提交，也不在每个小改动后跑全量测试，而是扩大到 `interactive-turn/` 与相邻 `turns/` 的同类小文件 cluster，模块收口时统一验证。

## 原始事实和扫描

- 阶段开始时 HEAD：`Flatten interactive turn module boundaries`。
- 工作树另有用户侧 `AGENTS.md` 未提交改动，本阶段不纳入提交。
- `stream-feedback-port.ts` 只有 65 行；运行时唯一创建点在 `stream-ui-controller.ts`，`sdk-stream-events-controller.ts` 和测试只消费 `InteractiveStreamFeedback` 类型。
- `grep -R "stream-feedback-port\|InteractiveStreamFeedback\|createInteractiveStreamFeedback" src work/rebuild` 证明没有第三个 production owner。
- `turns/final-response-artifacts.ts` 只有 44 行；其中 `collectFinalResponseArtifacts` / `dedupeOutboundAttachments` 是 `response-assembler.ts` 的 final response 规则，另一个使用点 `sdk-conversation-engine.ts` 也处于 SDK final response 整理链路。
- `grep -R "final-response-artifacts\|stream-feedback-port" src` 在修改后无输出，说明生产/测试代码无残留 import。

## 修改记录

- 删除 `src/lib/bridge/interactive-turn/stream-feedback-port.ts`。
- 将 `InteractiveStreamFeedbackTarget`、`InteractiveStreamFeedback` 和 `createInteractiveStreamFeedback` 移入 `src/lib/bridge/interactive-turn/stream-ui-controller.ts`。
- 更新 `src/lib/bridge/interactive-turn/sdk-stream-events-controller.ts` 和 `src/__tests__/interactive-turn-sdk-stream-events-controller.test.ts`，改从 `stream-ui-controller.ts` type-only import `InteractiveStreamFeedback`。
- 删除 `src/lib/bridge/turns/final-response-artifacts.ts`。
- 将 `FinalResponseArtifactParseResult`、`collectFinalResponseArtifacts`、`dedupeOutboundAttachments` 并入 `src/lib/bridge/turns/response-assembler.ts`。
- 更新 `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts`，改从 `response-assembler.ts` 获取 final response artifact 规则。
- 刷新 `work/rebuild/source-file-audit.json` 和 `work/rebuild/source-file-audit.md`。

## 同类小文件审计结论

- `terminal-finalization-controller.ts`：虽是单一 runtime owner，但包含异步 race / abort / wait 状态机并有专门测试，合并回 `runner.ts` 会增加入口复杂度，保留。
- `final-response-plan.ts`：纯 final delivery 决策 owner，有 focused tests，保留。
- `sdk-attachments.ts`：拥有本地附件持久化格式、非图片附件 prompt supplement 和 LLM file path 回填，保留。
- `sdk-stream-preview.ts`：虽小且单一 owner，但承担工具/推理 preview 渲染规则；当前保留，避免把 `sdk-conversation-engine.ts` 重新拉胖。
- `turn-types.ts`、`stream-state.ts`、`turn-coordinator.ts`、`turn-classifier.ts`、`local-codex-terminal-router.ts`、`delivery-pipeline.ts` 均为 shared turn primitives 或独立状态/路由规则，不能按文件短机械合并。

## 验证结果

- 2026-05-30 09:03 定向测试通过：`node --test --import tsx src/__tests__/interactive-turn-sdk-stream-events-controller.test.ts src/__tests__/interactive-turn-runner.test.ts src/__tests__/bridge-manager.test.ts`，89 tests / 11 suites 全部通过。
- 2026-05-30 09:07 定向测试通过：`node --test --import tsx src/__tests__/interactive-turn-sdk-stream-events-controller.test.ts src/__tests__/interactive-turn-sdk-conversation-engine.test.ts src/__tests__/interactive-turn-runner.test.ts src/__tests__/response-assembler.test.ts src/__tests__/delivery-pipeline.test.ts src/__tests__/bridge-manager.test.ts`，101 tests / 16 suites 全部通过。
- 2026-05-30 09:07 `npm run typecheck` 通过。
- 2026-05-30 09:07 `node source-audit.mjs` 通过并刷新审计产物。
- 2026-05-30 09:08 `npm run build` 通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- 2026-05-30 09:08 `npm test` 通过，487 tests / 90 suites 全部通过。
- 2026-05-30 09:07 `git diff --check` 通过。

## 最新审计指标

- `src/**/*.ts` 文件数：201（生产 135，测试 66）。
- 本地 import / re-export 边：767。
- `Interactive Turn Runtime`：16 文件 / 2946 行 / 风险跨聚合 import 9。
- `cluster-04` 现在覆盖 `src/lib/bridge/interactive-turn` 和 `src/lib/bridge/turns`：16 文件 / 2946 行 / 出边 33 / 入边 27。
- 阶段收益：删除两个小转接/内部规则文件，降低 interactive turn/turns 文件碎片；没有解决 runner / bridge host 的根耦合。

## 后续计划

进入 `src/lib bridge naming and folder alignment audit`：按用户 09:08 指令，列出 `src/*.ts` 与 `src/lib/bridge/**/*.ts` 文件名，找相似前缀/职责文件是否应进同一文件夹，并让 `src` 与 `lib/bridge` 的入口关系更可预测。
