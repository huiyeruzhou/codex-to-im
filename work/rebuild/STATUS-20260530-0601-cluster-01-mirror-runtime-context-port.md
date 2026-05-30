# 阶段归档：cluster-01 mirror runtime context port

归档时间：2026-05-30 06:01 CST

## 阶段目标

转向 `cluster-01` 的 mirror / turn / delivery / bridge host 边界，不先按文件大小拆分；先用复杂度价值判断审计状态流、跨层读取和 invariant owner，选择能真实降低复杂度的一刀。

## 原始行动记录

- UI 重构阶段已通过归档和 amend 收口到 `f68cfee Refactor UI server routes and queries`，当前工作树仅剩用户侧 `AGENTS.md`。本阶段不以“文件变短”为目标，先审计 `cluster-01` 中 `bridge-manager.ts`、`interactive-message-runner.ts`、`mirror-feedback-controller.ts`、`mirror-runtime.ts`、`delivery-pipeline.ts`、`stream-feedback-controller.ts` 等状态流协作，判断哪些跨层读取导致真实认知负担和修改半径上升。
- 初步审计确认 `cluster-01` 的复杂度不是单个大文件问题，而是多条状态流交叉：interactive run path 与 mirror delivery path 都直接拼装 stream feedback target、metadata/status/text/tool/task/finalize，并共享 `stream-feedback-controller.ts`、`stream-state.ts`、`delivery-pipeline.ts`；`mirror-runtime.ts` 负责 subscription/watch/reconcile/delivery planning，但仍通过 `getBridgeContext()` 直接读写 store 并清理 dangling thread，导致 mirror runtime 同时拥有文件游标、订阅生命周期、store mutation 和 delivery trigger。下一步需要把候选改动聚焦到“集中 owner / 收窄接口”，而不是拆 `interactive-message-runner.ts` 或 `mirror-feedback-controller.ts` 的文件体积。
- 本阶段第一刀选择 `mirror-runtime.ts` 去全局 context 依赖：把 `listChannelBindings`、`getSession`、`clearSessionCodexThreadId` 作为显式 deps 由 `bridge-manager.ts` 注入。价值判断：这不会让文件明显变短，但会把 runtime 的 store 边界从隐式全局读取改为显式端口，降低测试和后续移动 mirror runtime 时的环境耦合。
- 已完成 `mirror-runtime.ts` deps 端口化：移除 `getBridgeContext()` import，`syncMirrorSubscriptionSet`、`upsertMirrorSubscription`、`reconcileMirrorSubscription`、dangling thread 清理都改走显式 deps；`bridge-manager.ts` 作为 composition root 注入 store 读写；`mirror-runtime.test.ts` 不再初始化全局 bridge context。该改动降低的是隐式环境耦合和 runtime 可测性成本，不追求行数下降。
- 2026-05-30 05:59 用户重新提供协作准则后已再次核对：当前仍以 `work/rebuild/STATUS.md` 和工作树为权威，未执行 push / hot update / redeploy；完整验证命令 `node work/rebuild/source-audit.mjs && npm run build && npm test` 已在 Node.js 24 环境中运行。

## 修改摘要

- `src/lib/bridge/mirror-runtime.ts`
  - 新增 `MirrorRuntimeBinding` / `MirrorRuntimeSession` 端口类型。
  - `CreateMirrorRuntimeDeps` 新增 `listChannelBindings`、`getSession`、`clearSessionCodexThreadId`。
  - `syncMirrorSubscriptionSet`、`upsertMirrorSubscription`、`reconcileMirrorSubscription`、`clearDanglingMirrorThread` 不再调用 `getBridgeContext()`。
- `src/lib/bridge/bridge-manager.ts`
  - 在 bridge composition root 中把 store 的 binding/session/codex-thread 清理能力注入 mirror runtime。
- `src/__tests__/mirror-runtime.test.ts`
  - 移除 `initBridgeContext`、noop LLM、noop permissions 和全局 context 清理。
  - 各用例直接注入 mirror runtime 所需 store 端口。
- `work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md`
  - 复跑审计脚本，记录本阶段后的依赖图和函数级依赖结果。

## 扫描和复杂度结论

- 最新审计：192 个 `src/**/*.ts` 文件，其中生产 129 个、测试 63 个；本地 import / re-export 边从 742 降到 740。
- 函数依赖边从 1776 降到 1772，内聚 1514 不变，外聚从 262 降到 258。
- `src/lib/bridge/mirror-runtime.ts` 行数从 408 到 418，import 出边从 10 降到 9；这说明本阶段不是缩短文件，而是减少一条对 Bridge context 的隐式跨聚合依赖。
- `src/__tests__/mirror-runtime.test.ts` 行数从 527 到 495，import 出边从 4 降到 3；测试不再需要初始化全局 bridge context。
- `Mirror Runtime -> Bridge Host / Runtime Contracts` 聚合依赖从 10 降到 9；`cluster-07` 出边从 10 降到 9。

## 验证记录

- 已通过：`npm run typecheck`。
- 已通过：`node --test --import tsx src/__tests__/mirror-runtime.test.ts src/__tests__/bridge-manager.test.ts src/__tests__/mirror-reconcile-batch.test.ts src/__tests__/mirror-subscription-registry.test.ts src/__tests__/mirror-subscription-state.test.ts`，84 tests 全部通过。
- 已通过完整验证链：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && node work/rebuild/source-audit.mjs && npm run build && npm test && git diff --check -- src/lib/bridge/mirror-runtime.ts src/lib/bridge/bridge-manager.ts src/__tests__/mirror-runtime.test.ts work/rebuild/STATUS.md work/rebuild/source-file-audit.json work/rebuild/source-file-audit.md`。
- 完整测试结果：477 tests / 87 suites 全部通过，0 fail，耗时约 34.2s。
- 验证期间出现的 `bridge-manager` / `codex-provider` / `feishu-adapter` 错误日志来自测试覆盖的预期失败路径。

## 阶段审计判断

- 完成情况：本阶段完成了一个小而明确的边界收缩，把 mirror runtime 对 store 的隐式全局读取改为显式依赖端口。
- 复杂度价值：入口复杂度和文件体积基本没有下降，但可测性、后续移动 mirror runtime 的环境依赖、跨层读取隐蔽性都有实际改善。
- 保留缺口：`cluster-01` 的核心状态机复杂度仍在，尤其是 interactive run path / mirror delivery path 共享 stream feedback 和 delivery pipeline 的规则；后续还需要继续集中状态 owner，而不是把大函数机械拆小。

## 下一阶段建议

继续审计 `cluster-01`，优先选择能减少状态机耦合的一刀：例如把 mirror delivery 对 stream feedback target/status/finalize 的拼装规则收拢为一个明确 owner，或为 bridge-manager 与 mirror feedback controller 之间建立更窄的 delivery port。
