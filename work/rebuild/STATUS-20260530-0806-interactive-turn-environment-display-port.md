# 阶段归档：interactive turn environment display/stale port

## 阶段信息

- 阶段开始：2026-05-30 07:49 CST
- 阶段审计：2026-05-30 08:06 CST
- 阶段目标：继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/environment/turn-environment.ts` 对 router/context/display 的直接读取；先审计它当前承担的绑定解析、session 查询、stream 设置、display metadata 和 stale notice 职责，选择能减少跨层读取或稳定入口的一刀，避免新增小 owner 文件。
- 阶段起点 HEAD：`25aa02a Port interactive turn stop callback`
- 工作树注意事项：`AGENTS.md` 有用户侧协作规范更新，不属于本阶段提交范围。

## 原始行动记录

- 2026-05-30 07:49 已开启新阶段。当前 HEAD 为 `25aa02a Port interactive turn stop callback`；工作树仅剩用户侧 `AGENTS.md` 未提交改动。下一步读取 `environment/turn-environment.ts`、runner 调用点、bridge manager 可提供的上下文端口和相关测试，判断是否应把 router/context/display 读取集中到 bridge manager 注入的 environment resolver / metadata resolver，而不是让 interactive turn 自行读取全局 context。
- 2026-05-30 07:52 重新读取状态和协作准则：当前本地时间为 `2026-05-30 07:51 CST`，`rg` 不可用，后续使用 `find` / `sed` / `grep` 取证；当前工作树显示 `AGENTS.md` 与 `work/rebuild/STATUS.md` 有未提交改动，其中 `AGENTS.md` 是用户侧协作规范更新，不纳入本阶段代码提交。本阶段继续围绕 `environment/turn-environment.ts` 的 router/context/display 读取做端口审计，已形成初步方向：environment 保留 turn 环境组装，但 display/stale binding 查询应由 bridge manager 注入显式端口，避免 interactive turn 继续自行 new display service 或直接读取 display 内部。
- 2026-05-30 07:58 审计 `turn-environment.ts`、`runner.ts`、`bridge-manager.ts` 和 stale notice 测试后确认：`turn-environment.ts` 当前直接 import `ThreadDisplayService` 生成 stream card metadata / stale notice title，并直接通过 `store.listChannelBindings(address.channelType)` 判断旧绑定是否仍存在；`runner.ts` 只需要“给定 binding 的展示信息”和“列出当前 channel bindings”两个业务端口即可完成这两处职责。接下来编辑范围限定为 `turn-environment.ts`、`runner.ts`、`bridge-manager.ts` 和 stale notice 相关测试：删除 environment 对 display service 的直接读取，生产由 bridge manager 注入 `ThreadDisplayService(store).binding(...)` 和 `store.listChannelBindings(...)`，runner 直测默认不执行 stale 判断，只有 stale notice 场景显式提供 binding list 端口。
- 2026-05-30 08:01 已完成端口化代码修改：`turn-environment.ts` 删除对 `ThreadDisplayService` 的直接 import，新增 `ResolveInteractiveTurnDisplayInfo` / `ListInteractiveTurnBindings` 端口和 fallback display 组装；`runner.ts` 从 `RunInteractiveMessageDeps` 接收 display resolver 与 binding list；`bridge-manager.ts` 在生产路径用 `ThreadDisplayService(store).binding(..., { stripInternalPrefix: true })` 和 `store.listChannelBindings(...)` 注入端口；`interactive-turn-runner.test.ts` 仅在 stale notice 场景显式提供 list binding 端口。已通过针对性命令 `node --import tsx --test src/__tests__/interactive-turn-runner.test.ts`，15 tests / 1 suite 全部通过；已通过 `npm run typecheck`。
- 2026-05-30 08:03 已运行 `node work/rebuild/source-audit.mjs` 并更新 `work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md`。最新审计：202 个 `src/**/*.ts` 文件，其中生产 136、测试 66；本地 import / re-export 边数从上一阶段 769 降到 768；`Interactive Turn Runtime` 风险跨聚合 import 从 15 降到 14；`src/lib/bridge/interactive-turn/environment/turn-environment.ts` 不再 import `thread-display-resolver.ts`，但仍直接依赖 `channel-router.ts` / `context.ts` / `bridge-session-support.ts`，说明本阶段只消除了 display/stale 读取中的一条跨层边，未完成 turn environment 全端口化。

## 修改摘要

- `src/lib/bridge/interactive-turn/environment/turn-environment.ts`
  - 删除对 `ThreadDisplayService` 的直接 import。
  - 新增 `ResolveInteractiveTurnDisplayInfo`、`ListInteractiveTurnBindings`、`StaleTaskCompletionNoticePorts`。
  - `buildInteractiveStreamCardMetadata` 改为通过 display resolver 获取 title / tags 元数据。
  - `buildStaleTaskCompletionNotice` 改为通过 binding list 端口判断是否 stale；未提供端口时返回 `null`，避免 runner 直测误判旧绑定。
- `src/lib/bridge/interactive-turn/runner.ts`
  - `RunInteractiveMessageDeps` 新增 display resolver 和 binding list 端口。
  - 初始 stream metadata、Codex thread metadata refresh、external terminal finalization 和 SDK result finalization 都通过端口读取 display/stale 信息。
- `src/lib/bridge/bridge-manager.ts`
  - 生产入口在 `handleMessage` 中创建 `ThreadDisplayService(store)`，向 runner 注入 display resolver 和 `store.listChannelBindings(...)`。
- `src/__tests__/interactive-turn-runner.test.ts`
  - 仅 stale notice 用例显式提供 `listInteractiveTurnBindings`，验证解绑后旧任务回复被 stale notice 替代。

## 验证记录

- 通过：`node --import tsx --test src/__tests__/interactive-turn-runner.test.ts`
  - 15 tests / 1 suite 全部通过。
- 通过：`npm run typecheck`
- 通过：`node work/rebuild/source-audit.mjs`
  - 202 个源文件，生产 136、测试 66。
  - 本地 import / re-export 边：768。
  - `Interactive Turn Runtime` 风险跨聚合 import：14。
  - `src/lib/bridge/interactive-turn/environment/turn-environment.ts` 不再 import `thread-display-resolver.ts`。
- 通过：`npm run build`
- 通过：`npm test`
  - 487 tests / 90 suites 全部通过。
- 通过：`git diff --check`

## 阶段审计

- 本阶段达成了一个实际耦合下降：display/stale 读取从 interactive turn environment 内部直接读取 display service 和 store list，改为由 bridge manager 显式注入端口。本地 import 边 769 -> 768，`Interactive Turn Runtime` 风险跨聚合 import 15 -> 14。
- 本阶段没有新增小 owner 文件；`interactive-turn/environment` 仍保持单文件入口。
- 复杂度改善是局部但真实的：runner 需要 display/stale 行为时能从 deps 看见生产依赖，测试可以选择是否提供 stale 判断端口；AI 定位 display metadata/stale notice 时先看 `turn-environment.ts` 的端口，再看 bridge manager 注入。
- 未完成项：`resolveInteractiveTurnEnvironment` 仍直接读取 `channel-router.ts`、`context.ts` 和 `bridge-session-support.ts`；stream config / SDK tool detail 设置仍直接读取全局 store。下一阶段如果继续 environment，应以更粗的 environment resolver/settings port 收口，避免只逐个函数打补丁。
