# 阶段归档：interactive structured stream UI controller

归档时间：2026-05-30 06:22 CST

## 阶段目标

继续 `cluster-01`，聚焦 `runInteractiveMessage` 中 structured stream heartbeat / snapshot / stop action / finalization 状态 owner，先审计再选择能降低状态机耦合的一刀。

## 原始行动记录

- 当前工作树确认只剩用户侧 `AGENTS.md` 未提交；最近 rebuild 提交为 `f7ce88b Refactor stream feedback finalization ownership`。本阶段按上一阶段计划读取 `interactive-message-runner.ts`、`stream-feedback-controller.ts`、`turns/stream-state.ts` 及相关测试，判断 structured stream UI 的 active/snapshot/status/finalize/stop action 规则是否分散在 runner 中，以及是否存在可抽出的同聚合 helper，目标是降低 `runInteractiveMessage` 的局部状态机负担，而不是追求文件行数变化。
- 审计确认 `runInteractiveMessage` 当前同时拥有 structured stream UI 的 status heartbeat、snapshot 同步、active 标记、停止按钮 action 状态、finalize-once 和关闭状态；这些规则围绕同一个 UI 生命周期，散落在 runner 的局部闭包里。下一刀选择新增同聚合 helper `interactive-stream-ui.ts`，把这组状态收拢为 controller，runner 只保留业务事件到 controller 方法的调用。
- 已新增 `src/lib/bridge/interactive-stream-ui.ts`：集中 `StreamFeedbackTarget` 创建、structured stream support 判断、metadata/status/action 推送、heartbeat 生命周期、snapshot 同步、inactive 记录、finalize-once 和 skip-text 判断；`interactive-message-runner.ts` 改为通过 `streamUi` controller 调用这些能力。该改动降低 `runInteractiveMessage` 的局部闭包状态数量，仍保持 preview、conversation processing、health/mirror suppression 等 runner 自身职责不变。
- 复审后将 helper 从 `turns/` 移到 `src/lib/bridge/interactive-stream-ui.ts`：放在 `turns/` 会被审计归入 Interactive Turn Runtime，反而制造 Bridge Host -> Interactive Turn Runtime 的错误跨聚合边；该 helper 实际服务 `runInteractiveMessage` 的 stream UI 生命周期，放在 bridge root 更符合当前 owner。进一步把 final text normalization 作为回调注入，避免 helper 重复依赖 `response-assembler.ts`。

## 修改摘要

- `src/lib/bridge/interactive-stream-ui.ts`
  - 新增 `createInteractiveStreamUiController`。
  - 集中 structured stream support 判断、metadata/status/actions、heartbeat、snapshot sync、inactive snapshot、finalize-once、skip-text 判断。
  - 只依赖 stream feedback primitives 和 `turns/stream-state.ts` 的纯状态 timing helpers。
- `src/lib/bridge/interactive-message-runner.ts`
  - 删除 runner 内部的 `supportsStructuredStreamUi`、`buildStopActions`、`syncStructuredStreamUiSnapshot`、heartbeat interval、inactive snapshot、stream UI finalize-once 等局部闭包。
  - 改为创建 `streamUi` controller，并在 text/tool/task/status/final delivery 事件处调用 controller 方法。
  - final text normalization 仍由 runner 注入，避免 helper 拥有 final response assembly 规则。
- `work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md`
  - 复跑审计脚本，记录本阶段后的依赖图和函数级依赖结果。

## 扫描和复杂度结论

- 最新审计：193 个 `src/**/*.ts` 文件，其中生产 130 个、测试 63 个；本地 import / re-export 边 744。
- 函数节点 1551；函数依赖边 1755，其中内聚 1499、外聚 256。
- `runInteractiveMessage` 从 731 行降到 641 行，外聚度保持 5；`src/lib/bridge/interactive-message-runner.ts` 文件从 1056 行降到 959 行。
- 新增 `createInteractiveStreamUiController` 138 行、外聚度 0；`src/lib/bridge/interactive-stream-ui.ts` 214 行。
- `cluster-01` 内部跨聚合边为 100，未取得全局依赖图净下降。阶段收益主要是 structured stream UI 生命周期从 runner 的局部闭包中收拢为明确 owner，AI 后续修改 stream card heartbeat / snapshot / stop action / finalize 行为时入口更稳定。
- 复审修正：将 helper 放在 `turns/` 会增加错误聚合边；移动到 bridge root 并注入 final text normalization 后，避免把 UI lifecycle helper 误归为 turn runtime。

## 验证记录

- 已通过：`npm run typecheck`。
- 已通过：`node --test --import tsx src/__tests__/interactive-message-runner.test.ts src/__tests__/stream-feedback-controller.test.ts src/__tests__/bridge-manager.test.ts`，88 tests 全部通过。
- 已通过：`node work/rebuild/source-audit.mjs`。
- 已通过：`npm run build`。
- 已通过：`npm test`，477 tests / 87 suites 全部通过。
- 已通过：`git diff --check -- src/lib/bridge/interactive-message-runner.ts src/lib/bridge/interactive-stream-ui.ts work/rebuild/STATUS.md work/rebuild/source-file-audit.json work/rebuild/source-file-audit.md`。
- 验证期间出现的 `bridge-manager` / `codex-provider` / `feishu-adapter` 错误日志来自测试覆盖的预期失败路径。

## 阶段审计判断

- 完成情况：本阶段完成 structured stream UI 生命周期 owner 收缩，runner 现在通过 controller 处理 stream card status、snapshot、heartbeat、inactive 和 finalize 行为。
- 复杂度价值：局部认知入口改善明确，但全局依赖图没有净下降；该阶段不应被解读为核心状态机复杂度已解决。
- 保留缺口：`runInteractiveMessage` 仍是 641 行大函数，继续拥有 conversation processing、preview、health、mirror suppression、external terminal finalization 和 final delivery orchestration；`cluster-01` 仍是最大混合簇。

## 下一阶段建议

继续 `cluster-01`，下一刀应优先处理更实质的状态边界：例如 external terminal finalization / mirror suppression / final response delivery 之间的状态切换，或 bridge host 与 session health runtime 的快照写入边界。
