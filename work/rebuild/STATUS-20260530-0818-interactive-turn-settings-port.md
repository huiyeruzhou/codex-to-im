# 阶段归档：interactive turn settings port

## 阶段信息

- 阶段开始：2026-05-30 08:07 CST
- 阶段审计：2026-05-30 08:18 CST
- 阶段目标：继续 `cluster-01`，聚焦 `turn-environment.ts` 剩余 settings 读取；审计 `getInteractiveStreamConfig`、`getInteractiveStreamStatusTimingConfig`、`shouldWriteSdkToolDetailsInText` 是否能合并为一个粗粒度 interactive turn runtime settings 端口，由 bridge manager 注入 store setting reader，从而让 environment 不再直接读取 global bridge context。
- 阶段起点 HEAD：`3bd9967 Port interactive turn environment resolution`
- 工作树注意事项：`AGENTS.md` 有用户侧协作规范更新，不属于本阶段提交范围。

## 原始行动记录

- 2026-05-30 08:07 已开启新阶段。当前 HEAD 为 `3bd9967 Port interactive turn environment resolution`；工作树仅剩用户侧 `AGENTS.md` 未提交改动。本阶段先读取 `turn-environment.ts`、runner 设置读取调用点、bridge manager 注入点和相关 runner tests，判断能否用一个 settings resolver 端口替代 environment 内部的 `getBridgeContext().store.getSetting`。
- 2026-05-30 08:10 已审计 settings 读取：`getInteractiveStreamConfig`、`getInteractiveStreamStatusTimingConfig`、`shouldWriteSdkToolDetailsInText` 只被 `runner.ts` 使用，本质上是同一组 interactive turn runtime settings，而不是三个独立业务端口。下一步将它们合并为 `resolveInteractiveTurnRuntimeSettings(channelType, getSetting)` 纯函数，runner 通过必填 deps 获取 settings，bridge manager 注入 `store.getSetting`，测试用本地 helper 注入当前 test store；目标是删除 `turn-environment.ts` 对 `context.ts` 的直接 import。
- 2026-05-30 08:14 已完成代码修改：`turn-environment.ts` 删除 `getBridgeContext` import，新增 `InteractiveTurnRuntimeSettings` / `ReadInteractiveTurnSetting` / `ResolveInteractiveTurnRuntimeSettings`，并用一个 `resolveInteractiveTurnRuntimeSettings(channelType, readSetting)` 返回 preview stream config、status timing 和 SDK tool detail 开关；`runner.ts` 新增必填 `resolveInteractiveTurnRuntimeSettings` deps；`bridge-manager.ts` 注入 `(key) => store.getSetting(key)`；runner 测试新增 `resolveTestInteractiveTurnRuntimeSettings` 并为所有 direct runner 调用显式注入。下一步运行 targeted runner 测试和 typecheck。
- 2026-05-30 08:17 已通过 targeted runner 测试和 `npm run typecheck`。已运行 `node work/rebuild/source-audit.mjs` 并更新审计产物：源文件数保持 202，生产 136、测试 66；本地 import / re-export 边从上一阶段 769 回到 768；`turn-environment.ts` 不再列出 `context.ts` 依赖；`Interactive Turn Runtime` 风险保持 12，`Bridge Host / Runtime Contracts` 风险保持 28，`Interactive Turn Runtime -> Bridge Host / Runtime Contracts` 聚合依赖从 26 降到 25。自然聚类把部分 interactive turn 文件拆到 `cluster-05`，说明该目录的内部独立性继续增强，但全局风险计数未下降。

## 修改摘要

- `src/lib/bridge/interactive-turn/environment/turn-environment.ts`
  - 删除对 `context.ts` / `getBridgeContext` 的直接 import。
  - 删除 `getInteractiveStreamConfig`、`getInteractiveStreamStatusTimingConfig`、`shouldWriteSdkToolDetailsInText` 三个全局 context 读取函数。
  - 新增 `resolveInteractiveTurnRuntimeSettings(channelType, readSetting)`，一次性解析 preview stream config、status heartbeat timing 和 SDK tool detail 开关。
- `src/lib/bridge/interactive-turn/runner.ts`
  - `RunInteractiveMessageDeps` 新增必填 `resolveInteractiveTurnRuntimeSettings`。
  - runner 使用同一个 runtime settings payload 驱动 status heartbeat、preview throttle 和 SDK tool detail rendering。
- `src/lib/bridge/bridge-manager.ts`
  - 生产入口注入 `(key) => store.getSetting(key)`，作为 interactive turn runtime settings 的唯一 settings 读取端口。
- `src/__tests__/interactive-turn-runner.test.ts`
  - 新增 `resolveTestInteractiveTurnRuntimeSettings`，direct runner 测试显式注入当前 test store settings。

## 验证记录

- 通过：`node --import tsx --test src/__tests__/interactive-turn-runner.test.ts`
  - 15 tests / 1 suite 全部通过。
- 通过：`npm run typecheck`
- 通过：`node work/rebuild/source-audit.mjs`
  - 202 个源文件，生产 136、测试 66。
  - 本地 import / re-export 边：768。
  - `Interactive Turn Runtime` 风险跨聚合 import：12。
  - `Bridge Host / Runtime Contracts` 风险跨聚合 import：28。
  - `Interactive Turn Runtime -> Bridge Host / Runtime Contracts` 聚合依赖：25。
  - `turn-environment.ts` 不再列出 `context.ts` 依赖。
- 通过：`npm run build`
- 通过：`npm test`
  - 487 tests / 90 suites 全部通过。
- 通过：`git diff --check`

## 阶段审计

- 本阶段达成目标：interactive turn environment 不再直接读取 global bridge context；所有运行时设置读取集中到 bridge manager 注入的 setting reader。
- 复杂度收益是边界清晰化而不是大幅数字下降：本地 import 边 769 -> 768，Interactive Turn Runtime 风险保持 12，但 `Interactive Turn Runtime -> Bridge Host / Runtime Contracts` 聚合依赖 26 -> 25。
- 没有新增生产文件或测试数量；测试只是显式注入已有 test store settings。
- 未完成项：`sdk/conversation-engine.ts` 仍直接读取 `context.ts`、SSE decoder、runtime options；`stream/ui-controller.ts` 仍直接依赖 stream feedback controller。下一阶段应优先审计 SDK conversation engine 是否能用一个 SDK runtime port 承接 context / provider / decoder 读取。
