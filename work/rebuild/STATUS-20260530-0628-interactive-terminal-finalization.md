# 阶段归档：interactive terminal finalization controller

## 阶段

- 时间：2026-05-30 06:24-06:28 CST
- 阶段描述：继续 `cluster-01`，审计 external terminal finalization、mirror suppression 和 final response delivery 三者之间的状态切换、跨层读取与 invariant owner，再决定是否实施一刀能真实降低复杂度的代码修改。

## 原始行动记录

- 06:24 同步用户最新 `AGENTS.md` 指令和当前环境：本阶段仍以 `work/rebuild/STATUS.md` 与当前工作树为权威；只剩用户侧 `AGENTS.md` 未提交改动，不纳入本阶段提交；下一步读取 `interactive-message-runner.ts`、`turns/delivery-pipeline.ts`、`turns/final-response-artifacts.ts`、`mirror-suppression.ts`、`mirror-feedback-controller.ts` 及相关测试，先画清 finalization / suppression / delivery 的真实状态流。
- 06:26 第一轮审计结论：`runInteractiveMessage` 直接维护 external terminal request、completion promise、SDK/process race、process 后等待 terminal timeout、final response delivery 分支；`mirror-suppression.ts` 是独立模块，但 settle/abort 仍由 runner 的 `finalOutcome` 决定。`mirror-feedback-controller.ts` 和 `delivery-pipeline.ts` 已共享 `deliverFinalResponse`，本阶段不继续改 mirror final delivery，避免跨越太多 owner。
- 06:27 实施小步抽取：新增 `src/lib/bridge/interactive-terminal-finalization.ts`，将 external terminal finalization 的 `current` request、process race、process-settled 标记、Codex terminal timeout wait、completion promise 收成 controller；`interactive-message-runner.ts` 改为通过 controller 暴露 `finalizeFromExternalTerminal`、`raceProcess`、`waitAfterProcess` 和 `settleCompletion`。
- 06:28 补充 `src/__tests__/interactive-terminal-finalization.test.ts`，直接锁定三类语义：external terminal 先完成时 abort 仍在跑的 process；process 先完成后短暂等待 terminal finalization 且不 abort；未期待 Codex terminal final 时不等待。

## 审计事实

- 本阶段改善的是状态 owner 清晰度：external terminal finalization 不再是 `runInteractiveMessage` 内部多组闭包变量，而是独立 controller。
- `runInteractiveMessage` 仍保留最终响应组装、stream card finalize、stale binding notice、mirror suppression settle/abort 的业务决策；这是有意保留，避免把 final delivery 与 suppression owner 同时迁出导致行为风险过大。
- 最新审计：文件数 195（生产 131，测试 64），本地 import / re-export 边 746；函数节点 1550；函数依赖边 1754（内聚 1498，外聚 256）。
- `runInteractiveMessage` 从上一阶段 641 行降到 574 行，外聚度保持 5；新增 `createExternalTerminalFinalizationController` 125 行、外聚度 0。依赖图没有净下降，本阶段不能解释为 `cluster-01` 已解决。

## 验证摘要

- 已通过：`npm run typecheck`。
- 已通过定向测试：`node --test --import tsx src/__tests__/interactive-terminal-finalization.test.ts src/__tests__/interactive-message-runner.test.ts src/__tests__/delivery-pipeline.test.ts src/__tests__/local-codex-terminal-router.test.ts src/__tests__/turn-coordinator.test.ts`，25 tests 全部通过。
- 已通过定向测试：`node --test --import tsx src/__tests__/bridge-manager.test.ts src/__tests__/mirror-runtime.test.ts src/__tests__/mirror-feedback-controller.test.ts src/__tests__/mirror-turns.test.ts`，84 tests 全部通过。
- 已通过：`node work/rebuild/source-audit.mjs`，更新 `work/rebuild/source-file-audit.json` 和 `work/rebuild/source-file-audit.md`。
- 已通过：`npm run build`。
- 已通过：`npm test`，480 tests / 88 suites 全部通过。
- 已通过：`git diff --check`。

## 阶段价值判断

- 本阶段把 external terminal finalization 从 runner 的通用长流程中取出，减少了一个状态机子问题的局部认知成本。
- 本阶段没有减少跨聚合外聚度；`runInteractiveMessage` 仍是 `cluster-01` 最大状态流入口之一，继续拥有 SDK processing、stream UI、final response delivery、stale binding notice、mirror suppression settle/abort 等决策。
- 下一阶段应继续沿状态 owner 推进，优先审计 final response delivery 与 mirror feedback final delivery 的共享 port，或把 stale binding / final card / text delivery 决策收成更明确的 final response coordinator。
