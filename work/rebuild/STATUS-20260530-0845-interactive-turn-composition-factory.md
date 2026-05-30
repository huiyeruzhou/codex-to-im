# 阶段归档：interactive turn composition factory audit

## 阶段信息

- 时间：2026-05-30 08:36 - 08:45 CST
- 阶段：interactive turn composition factory audit
- 阶段目标：继续 `cluster-01`，聚焦 `bridge-manager.ts` 中 `runInteractiveMessage` deps wiring 的 composition 复杂度；审计是否能提取 interactive turn composition factory，把 environment/runtime/display/permission/health/stream 等端口组装从 bridge manager 主流程中移出，同时不把业务规则拆碎、不新增无意义跳转。
- 起点 HEAD：`771468a Port interactive structured stream feedback`

## 原始行动记录

- 2026-05-30 08:36 已开启新阶段。当前 HEAD 为 `Port interactive structured stream feedback`；工作树仅剩用户侧 `AGENTS.md` 未提交改动。本阶段先读取 `bridge-manager.ts` 的 interactive turn 调用块、相关 imports、runner deps 类型和审计热点，判断提取 factory 是否能降低 bridge manager 入口复杂度，还是只是把 wiring 搬到另一个文件。
- 2026-05-30 08:38 已完成第一轮审计：`handleMessage` 内部 `runInteractiveMessage` deps object 同时组装 interactive runtime、turn coordinator、session health、mirror suppression、SDK conversation runtime、turn environment、runtime settings、permission forwarding、display info、binding list 和 terminal finalization timeout；这些是 Bridge Host composition 事实，不是 interactive turn 领域规则。下一步新增 bridge host 侧 `interactive-turn-composition.ts`，提供 `createInteractiveTurnMessageRunner`，由 bridge manager 注入 store/llm/runtime/router/broker 等外部事实，composition 文件负责创建 runner deps；避免把 host wiring 塞进 `interactive-turn` 领域目录，也避免继续让 `handleMessage` 变胖。
- 2026-05-30 08:40 已完成第一轮代码修改和初步验证：新增 `src/lib/bridge/interactive-turn-composition.ts`，`bridge-manager.ts` 通过 `INTERACTIVE_TURN_MESSAGE_RUNNER.run(...)` 调用 interactive turn，`handleMessage` 中原 50 行左右 deps wiring 已移出；已通过 `bridge-manager.test.ts`、`interactive-turn-runner.test.ts` 和 `npm run typecheck`。第一次 source audit 显示 `bridge-manager.ts` 行数 1341 -> 1310、直接 import 34 -> 31、文件风险 15 -> 13、`handleMessage` 函数体 339 -> 298、外聚 4 -> 2；但新增 composition 文件使 Bridge Host 风险 28 -> 31、源文件 203 -> 204、import 边 774 -> 783。为避免纯搬运导致依赖图恶化，已进一步收紧 composition 文件类型依赖，改用 `RunInteractiveMessageDeps` 的结构类型而不是直接 import `InteractiveRuntime` / `SessionHealthRuntime` / `TurnCoordinator` 具体类型。
- 2026-05-30 08:43 复跑 targeted tests 已通过 `bridge-manager.test.ts` 与 `interactive-turn-runner.test.ts`（86 tests / 10 suites），但 `npm run typecheck` 暴露二次收紧过度：composition store 不能声明为只含 `getSession/getSetting/listChannelBindings` 的最小结构，因为它还要传入 `ThreadDisplayService` 和 SDK conversation runtime，二者需要完整 `BridgeStore`。已改为从 `RunInteractiveMessageDeps['resolveSdkConversationRuntime']` 的返回值反推 store/llm 类型，继续避免直接 import `host.ts`。
- 2026-05-30 08:44 已通过修复后的 `npm run typecheck` 和 `node work/rebuild/source-audit.mjs`。最终审计显示新增 composition 文件后源文件 203 -> 204、import 边 774 -> 776；`bridge-manager.ts` 行数 1341 -> 1310、直接 import 34 -> 31、风险跨聚合 import 15 -> 13、`handleMessage` 函数体 339 -> 298；`src/lib/bridge/interactive-turn-composition.ts` 为 120 行 / 5 个本地 import / 2 个风险跨聚合 import，Bridge Host 总风险保持 28、Interactive Turn Runtime 总风险保持 10。阶段价值判断：该提取没有降低全局 import 数，也新增一个 bridge host 文件；收益是把 interactive turn 端口 wiring 从 message handling 主流程中移到可命名 composition owner，且没有使聚合风险净上升，因此可保留，但不能宣称 `cluster-01` 已解决。

## 关键审计事实

- 新增 `src/lib/bridge/interactive-turn-composition.ts` 是 Bridge Host 侧 composition owner，不放入 `interactive-turn/` 领域目录，避免把 host wiring 误标为 interactive turn 业务规则。
- `bridge-manager.ts` 删除对 `runInteractiveMessage`、interactive turn environment resolver、`consumeSseEvents`、runtime option normalizer 的直接 import，只保留 `createInteractiveTurnMessageRunner`。
- `handleMessage` 从直接构造 50 行左右的 deps object 变为调用 `INTERACTIVE_TURN_MESSAGE_RUNNER.run(...)`，message handling 主流程更聚焦命令路由、session lock 和 ack。
- composition 文件仍直接持有 runner/environment/display/SSE/runtime-options 依赖。该文件使全局文件数和 import 边增加，因此价值不是依赖图下降，而是让“IM interactive turn 的 host wiring 在哪里组装”有稳定入口。

## 验证记录

- 已通过：`node --import tsx --test src/__tests__/bridge-manager.test.ts src/__tests__/interactive-turn-runner.test.ts`，86 tests / 10 suites 全部通过。
- 已通过：`npm run typecheck`。
- 已通过：`node work/rebuild/source-audit.mjs`。
- 已通过：`npm run build`。
- 已通过：`npm test`，487 tests / 90 suites 全部通过。
- 已通过：`git diff --check`。

## 阶段反思

- 本阶段没有让 `cluster-01` 完成解耦，也没有降低全局 import 数；若继续沿着“每个 deps object 提一个文件”的方向走，会重新变成机械拆分。
- 本阶段可接受的原因是它把 Bridge Host composition 从用户消息主流程移出，且二次收紧后 Bridge Host 总风险没有净上升。
- 下一阶段应避免继续给 `bridge-manager.ts` 堆 composition 小文件。更高价值的候选是审计 `bridge-manager.ts` 的 mirror runtime / mirror feedback wiring，或者转向 `session-bindings.ts` 与 UI/session history 被吸入 `cluster-01` 的边界问题。
