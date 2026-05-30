# 阶段归档：interactive SDK stream events owner

归档时间：2026-05-30 07:03 CST

## 阶段描述

继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/runner.ts` 剩余 execution/delivery 端口，审计 conversation engine callbacks、permission forwarding、stream feedback、final delivery context 是否能形成更窄 owner，避免继续只搬 helper。

## 原始行动记录

- 2026-05-30 06:53 已开启新阶段。当前 HEAD 为 `d9801ab Extract interactive turn environment`，工作树仅剩用户侧 `AGENTS.md` 未提交改动，不属于当前 rebuild 提交范围。下一步读取 `runner.ts` 剩余 import/callback 块、`conversation-engine.ts` 端口和 `permission-broker.ts`/`delivery-pipeline.ts` 调用，选择能降低状态耦合且不扩大跨聚合风险的一刀。
- 2026-05-30 06:55 已完成 execution event 回调组审计并实施第一刀：`runner.ts` 中 `processMessageImpl` 的 text/tool/task/status/permission-wait callbacks 同时维护 stream state、task health、preview、stream card regions 和 tool tracker，属于 SDK execution event owner，不应继续散落在主流程。新增 `src/lib/bridge/interactive-turn/sdk-stream-events-controller.ts`，集中 `onPartialText`、`onToolEvent`、`onTaskEvent`、`onStatusNote`、`onPermissionWait` 和 final card text push；runner 改为只创建 controller 并把 callbacks 接给 conversation engine。
- 2026-05-30 06:58 继续推进时重新取证：当前有未提交阶段代码和审计产物，新增 controller/test 尚未进入 git 暂存区；`AGENTS.md` 仍是用户侧协作规范改动，不属于本阶段提交范围。下一步先验证 controller 行为、检查 runner 是否仍保留重复 event 状态逻辑，再运行针对性测试和全量门禁。
- 2026-05-30 06:59 根据用户纠偏调整当前阶段顺序：先审计新增 `interactive-turn-execution-events-controller.test.ts` 是否与既有 `interactive-turn-runner.test.ts` 重复，只有能锁定新 owner 的独立规则才保留；暂不继续追加测试，除非发现既有测试无法覆盖迁移风险。同时检查 `src/lib/bridge/interactive-turn/` 内文件名是否规整，尤其是新文件是否应体现 SDK/conversation event 来源而不是泛称 execution。
- 2026-05-30 07:00 完成测试膨胀和命名审计后的调整：新文件命名从泛称 `execution-events-controller.ts` 改为 `sdk-stream-events-controller.ts`，测试改为 `interactive-turn-sdk-stream-events-controller.test.ts`，与同目录 `stream-ui-controller.ts`、`terminal-finalization-controller.ts` 的 controller 后缀保持规整；删除了与 `interactive-turn-runner.test.ts` 中 tool-details-off 集成场景重复的 controller 单测，改为覆盖 stale task guard，测试数量不增加且更贴近新 owner 风险。

## 关键实现事实

- 新增 `src/lib/bridge/interactive-turn/sdk-stream-events-controller.ts`，集中 SDK/conversation-engine 事件到 stream UI、health runtime 和 task state 的映射。
- `runner.ts` 不再直接维护 `toolCallTracker`、`latestTasks`、`markActivity`、`markContentResponse`、`onPartialText`、`onToolEvent`、`onTaskEvent`、`onStatusNote`、permission-wait health 更新和 final card text push。
- `runner.ts` 仍负责 turn 生命周期、permission forwarding、external terminal race、final response plan 和 delivery pipeline 调用；本阶段没有解决 runner 对 `conversation-engine`、`permission-broker`、delivery/context 的跨聚合端口。
- 测试审计后没有净增加 controller 测试数量：删除与 runner 集成测试重复的 tool-details-off controller 单测，保留 partial text / permission wait，并改为新增 stale task guard 覆盖。
- 文件命名调整后，`src/lib/bridge/interactive-turn/` 当前文件为：`runner.ts`、`turn-environment.ts`、`stream-ui-controller.ts`、`sdk-stream-events-controller.ts`、`terminal-finalization-controller.ts`、`final-response-plan.ts`。

## 审计数据

- `node work/rebuild/source-audit.mjs` 后：200 个 `src/**/*.ts` 文件，其中生产 134 个、测试 66 个；本地 import / re-export 边 767 条。
- `Interactive Turn Runtime`：14 文件 / 2020 行 / 入边 52 / 出边 57 / 风险跨聚合 import 15。
- `src/lib/bridge/interactive-turn/runner.ts`：623 行，直接 import 16，风险跨聚合 import 4。
- `runInteractiveMessage`：函数体 426 行，外聚度 3。
- 新增 `createInteractiveSdkStreamEventsController`：函数体 113 行，外聚度 0。
- 价值判断：本阶段真实收益是 SDK stream event 状态 owner 更清晰，runner 入口复杂度下降；全局依赖图没有净下降，`Interactive Turn Runtime` 风险跨聚合 import 从 14 升到 15，说明只是把 SDK event 状态集中到了更明确的模块，没有完成 cluster-01 解耦。

## 验证输出摘要

- 已通过：`node --test --import tsx src/__tests__/interactive-turn-sdk-stream-events-controller.test.ts src/__tests__/interactive-turn-runner.test.ts src/__tests__/interactive-turn-final-response-plan.test.ts src/__tests__/interactive-turn-terminal-finalization-controller.test.ts`，25 tests / 4 suites 全部通过。
- 已通过：`npm run typecheck`。
- 已通过：`node work/rebuild/source-audit.mjs`，已更新 `source-file-audit.json` / `source-file-audit.md`。
- 已通过：`npm run build`。
- 已通过：`npm test`，487 tests / 90 suites 全部通过。
- 已通过：`git diff --check`。

## 后续判断

- 下一阶段不应继续沿着“抽 controller”惯性拆小文件；需要优先审计 runner 剩余跨聚合入口是否能通过更窄的 SDK execution port 或 permission/delivery adapter 降低总耦合。
- 用户关于测试膨胀的纠偏应作为后续阶段固定门禁：新增测试前先找重复覆盖，优先删除或替换冗余测试，只有新 owner 独立 invariant 才新增。
