# 阶段归档：interactive turn environment resolver port

## 阶段信息

- 阶段开始：2026-05-30 08:07 CST
- 阶段审计：2026-05-30 08:24 CST
- 阶段目标：继续 `cluster-01`，聚焦 `resolveInteractiveTurnEnvironment` 对 `channel-router.ts`、`context.ts`、`bridge-session-support.ts` 的直接读取；审计是否能将“解析 inbound address 到 turn environment”的粗粒度职责作为 bridge manager 注入端口，从而让 runner/environment 不再直接读取 router/context/session support。
- 阶段起点 HEAD：`a519ce1 Port interactive turn display and stale ports`
- 工作树注意事项：`AGENTS.md` 有用户侧协作规范更新，不属于本阶段提交范围。

## 原始行动记录

- 2026-05-30 08:07 已开启新阶段。当前 HEAD 为 `a519ce1 Port interactive turn display and stale ports`；工作树仅剩用户侧 `AGENTS.md` 未提交改动。当前阶段先读取 `turn-environment.ts`、`runner.ts`、`bridge-manager.ts`、turn classifier 和相关测试，判断 environment resolver 端口是否能以一个粗粒度 `resolveInteractiveTurnEnvironment` deps 保持边界清晰，避免继续逐函数补小端口。
- 2026-05-30 08:12 已审计 environment resolver 调用链：当前 `turn-environment.ts` 直接 import `channel-router.ts`、`context.ts`、`bridge-session-support.ts` 和 `turn-classifier.ts` 来解析 binding / initial session / Codex thread availability；runner 只需要最终的 `InteractiveTurnEnvironment`。本阶段可做成粗粒度 resolver 端口：`turn-environment.ts` 保留纯 `buildInteractiveTurnEnvironment` 组装和 stream metadata/stale notice 规则，`runner.ts` 通过 deps 调用 resolver，生产 resolver 放在 `bridge-manager.ts`，测试用 test-local resolver 复用现有 router/store。该方案不新增生产文件，能让 interactive-turn/environment 不再直接读取 Bridge Host 的 router/context/session support。
- 2026-05-30 08:16 已完成第一轮代码修改：`turn-environment.ts` 删除 router / bridge-session-support / turn-classifier 直接 import，`resolveInteractiveTurnEnvironment` 改为纯 `buildInteractiveTurnEnvironment`；`RunInteractiveMessageDeps` 新增必填 `resolveInteractiveTurnEnvironment`；`bridge-manager.ts` 用现有 router/store/session support/classifier 组装生产 resolver；`interactive-turn-runner.test.ts` 新增 test-local resolver 并为所有 direct runner 调用显式注入。下一步运行 targeted runner 测试和 typecheck，确认没有漏掉调用点或分类行为。
- 2026-05-30 08:20 第一轮源审计显示 `Interactive Turn Runtime` 风险从 14 降到 12，但 `bridge-manager.ts` 直接 import classifier/build helper 使 Bridge Host 风险从 27 升到 29，说明实现把分类细节泄漏给 composition owner。已调整为更窄的 resolver port：`turn-environment.ts` 内部仍拥有 `classifyInteractiveTurn` 和 `buildInteractiveTurnEnvironment`，但 `resolveInteractiveTurnEnvironment(address, messageId, ports)` 只通过 `resolveBinding`、`getBridgeSession`、`codexThreadExists` 三个端口读取外部事实；`bridge-manager.ts` 和测试只提供这三个端口，不直接 import classifier。重新通过 targeted runner 测试和 `npm run typecheck`；重新运行 source audit 后，源文件数保持 202，生产 136、测试 66，本地 import / re-export 边 769；`Interactive Turn Runtime` 风险 14 -> 12，`Bridge Host / Runtime Contracts` 风险 27 -> 28，`cluster-01` 内部跨聚合边 106 -> 105。该结果把 router/context/session support 读取集中到 bridge manager，代价是一条 Bridge Host -> environment composition 边。

## 修改摘要

- `src/lib/bridge/interactive-turn/environment/turn-environment.ts`
  - 删除对 `channel-router.ts`、`bridge-session-support.ts` 的直接 import。
  - 新增 `ResolveInteractiveTurnEnvironmentPorts`，包含 `resolveBinding`、`getBridgeSession`、`codexThreadExists`。
  - `resolveInteractiveTurnEnvironment` 仍拥有 turn classification 和 stream key 组装，但外部事实全部通过端口注入。
- `src/lib/bridge/interactive-turn/runner.ts`
  - `RunInteractiveMessageDeps.resolveInteractiveTurnEnvironment` 改为必填，runner 不再自己调用 environment 默认 resolver。
- `src/lib/bridge/bridge-manager.ts`
  - 生产入口在 `handleMessage` 中提供 resolver 端口，集中调用 router、store 和 Codex thread lookup。
- `src/__tests__/interactive-turn-runner.test.ts`
  - 新增 test-local resolver，并为 direct runner 测试显式注入，避免 runner 测试隐式依赖全局 router/context 读取。

## 验证记录

- 通过：`node --import tsx --test src/__tests__/interactive-turn-runner.test.ts`
  - 15 tests / 1 suite 全部通过。
- 通过：`npm run typecheck`
- 通过：`node work/rebuild/source-audit.mjs`
  - 202 个源文件，生产 136、测试 66。
  - 本地 import / re-export 边：769。
  - `Interactive Turn Runtime` 风险跨聚合 import：12。
  - `Bridge Host / Runtime Contracts` 风险跨聚合 import：28。
  - `cluster-01` 内部跨聚合边：105。
- 通过：`npm run build`
- 通过：`npm test`
  - 487 tests / 90 suites 全部通过。
- 通过：`git diff --check`

## 阶段审计

- 本阶段达成目标：`interactive-turn/environment` 不再直接读取 router 或 Codex session support，runner 对 turn environment 解析的外部事实依赖变成显式端口。
- 复杂度变化不是单纯数字下降：`Interactive Turn Runtime` 风险 14 -> 12，`cluster-01` 内部跨聚合边 106 -> 105；同时 Bridge Host 风险 27 -> 28，因为 bridge manager 作为 composition root 显式承接 resolver 注入。这是预期的依赖方向调整。
- 未新增生产文件；测试只增加一个本地 resolver helper，没有新增测试数量。
- 未完成项：`turn-environment.ts` 仍通过 `getBridgeContext()` 读取 stream config / SDK tool detail 设置；`sdk/conversation-engine.ts` 仍直接读取 context 和 SSE decoder；后续应继续选择粗粒度 settings / SDK runtime port，而不是逐个设置函数补端口。
