# 阶段归档：interactive turn runner 外聚端口审计

## 阶段信息

- 阶段时间：2026-05-30 06:47 - 06:51 CST
- 阶段目标：继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/runner.ts` 对 Bridge Host / Runtime Contracts 的外聚依赖，先审计 context/router/engine/broker/delivery/display 等跨聚合调用的真实职责，再选择一刀能降低 runner 外聚度和入口跳转成本的端口收窄。
- 阶段起点 HEAD：`91eae18 Extract interactive final response planning`
- 本阶段提交前现场：仅用户侧 `AGENTS.md` 未提交改动不属于 rebuild；本阶段新增/修改文件为 `src/lib/bridge/interactive-turn/runner.ts`、`src/lib/bridge/interactive-turn/turn-environment.ts`、`work/rebuild/source-file-audit.*`、`work/rebuild/STATUS.md`。

## 原始行动记录

- 2026-05-30 06:47 已开启新阶段。当前 HEAD 为 `91eae18 Extract interactive final response planning`，工作树仅剩用户侧 `AGENTS.md` 未提交改动，不属于当前 rebuild 提交范围。下一步读取 `interactive-turn/runner.ts` 的 import、函数热点和调用点，结合 `source-file-audit.md` 的函数外聚热点选择修改边界。
- 2026-05-30 06:49 已完成第一轮 runner 外聚审计：`runner.ts` 当前直接 import `channel-router`、`conversation-engine`、`permission-broker`、`context`、`mirror-formatters`、`streaming-metadata`、`thread-display-resolver`、`bridge-session-support` 等；其中 `conversation-engine`/`permission-broker` 是执行主流程端口，暂不适合本刀处理。更适合作为本阶段切口的是路由解析、全局 store 读取、stream 设置读取、display metadata、stale binding 判断和 Codex thread classify，这些都属于 interactive turn 的环境查询，不应该散落在 runner 状态机内部。拟新增 `src/lib/bridge/interactive-turn/turn-environment.ts` 收拢 bridge-context-backed 查询，减少 runner 的外部入口跳转。
- 2026-05-30 06:50 已实施 turn environment 收口：新增 `src/lib/bridge/interactive-turn/turn-environment.ts`，集中 `router.resolve`、`getBridgeContext().store`、Codex thread classify、stream key、stream 设置、display metadata 和 stale binding notice；`runner.ts` 不再直接 import `channel-router`、`context`、`mirror-formatters`、`streaming-metadata`、`thread-display-resolver`、`bridge-session-support`。已通过 `npm run typecheck`；已通过 focused 验证 `node --test --import tsx src/__tests__/interactive-turn-runner.test.ts src/__tests__/interactive-turn-final-response-plan.test.ts src/__tests__/interactive-turn-terminal-finalization-controller.test.ts src/__tests__/bridge-manager.test.ts`，93 tests 全部通过；已刷新 `node work/rebuild/source-audit.mjs`。最新审计显示文件数 198（生产 133，测试 65），本地 import / re-export 边 755；`runner.ts` 从 845 行降到 759 行，直接 import 数从 22 降到 16，`runInteractiveMessage` 外聚度从 7 降到 4、函数体 525 到 524 行；但 `Interactive Turn Runtime` 聚合风险跨聚合 import 仍为 14，说明本刀降低了 runner 入口复杂度，没有降低聚合总耦合。
- 2026-05-30 06:51 当前进入阶段审计：已通过完整验证链 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build && npm test && git diff --check`，使用 Node v24.12.0 / npm v11.6.2；build 生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`，完整测试 484 tests / 89 suites 全部通过，`git diff --check` 通过。

## 关键依赖事实

- `runner.ts` 本阶段前直接承担环境查询：路由绑定解析、全局 store session 读取、Codex thread 可见性检查、stream key 构造、stream 设置读取、display metadata 构造、stale binding notice 判断。
- 这些查询会让 `runInteractiveMessage` 的入口同时跨状态机、runtime settings、display query、binding registry 和 local Codex index，增加 AI 定位成本。
- 本阶段新增 `turn-environment.ts` 后，runner 仍保留 execution path 依赖：`conversation-engine`、`permission-broker`、`stream-feedback-controller`、`delivery-pipeline`、`response-assembler`、`stream-state`。这些属于后续更大的 execution/delivery port 收窄对象。
- 聚合风险跨聚合 import 没有下降，因为外部依赖从 runner 迁入同聚合的 `turn-environment.ts`。本阶段价值不能用聚合总风险下降证明，只能用 runner 入口复杂度下降和路径命名明确证明。

## 验证摘要

- `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck && node --test --import tsx src/__tests__/interactive-turn-runner.test.ts src/__tests__/interactive-turn-final-response-plan.test.ts src/__tests__/interactive-turn-terminal-finalization-controller.test.ts src/__tests__/bridge-manager.test.ts && node work/rebuild/source-audit.mjs`
- focused 验证：93 tests / 12 suites 全部通过。
- `node work/rebuild/source-audit.mjs`：已写入 `work/rebuild/source-file-audit.json` 和 `work/rebuild/source-file-audit.md`。
- `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build && npm test && git diff --check`
- `npm run build`：通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- `npm test`：484 tests / 89 suites，全部通过。
- `git diff --check`：通过。

## 审计数据

- 文件数：198（生产 133，测试 65）。
- 本地 import / re-export 边数：755。
- `src/lib/bridge/interactive-turn` 目录：5 文件 / 1373 行。
- `src/lib/bridge/interactive-turn/runner.ts`：759 行，直接 import 数 16，风险跨聚合 import 5。
- `src/lib/bridge/interactive-turn/turn-environment.ts`：131 行，风险跨聚合 import 10。
- `runInteractiveMessage`：函数体 524 行，内聚度 12，外聚度 4。
- `Interactive Turn Runtime`：13 文件 / 1952 行 / 14 条风险跨聚合 import。
- 函数节点数：1555。
- 函数依赖边数：1755（内聚 1492，外聚 263）。

## 阶段判断

- 本阶段真实收益是 runner 不再直接处理 bridge-context-backed 环境查询，`runInteractiveMessage` 的外聚度从 7 降到 4，AI 先看 runner 时更容易分清“turn orchestration”和“环境查询”。
- 本阶段没有降低 `Interactive Turn Runtime` 聚合总风险 import；只是把环境查询集中到一个明确 owner。后续如果继续沿这个方向，应把 `turn-environment.ts` 暴露的查询改成由 bridge manager 注入的窄端口，或继续处理 execution/delivery port。
- 当前 `runInteractiveMessage` 仍是 524 行大函数，下一阶段不应继续只搬 helper；更有价值的方向是把 process execution callbacks、permission forwarding 或 final delivery context 做成更明确端口。
