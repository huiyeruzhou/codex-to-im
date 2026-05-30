# 阶段归档：interactive SDK conversation engine owner

归档时间：2026-05-30 07:10 CST

## 阶段描述

继续 `cluster-01`，聚焦 `runner.ts` 剩余对 `conversation-engine`、`permission-broker` 和 delivery pipeline 的跨聚合端口，先审计真实 owner、文件命名和测试重复覆盖，再选择一刀能降低入口复杂度或跨聚合读取的修改。

## 原始行动记录

- 2026-05-30 07:05 已开启新阶段。当前 HEAD 为 `d2eadfe Extract interactive SDK stream events owner`，工作树仅剩用户侧 `AGENTS.md` 未提交改动，不属于当前 rebuild 提交范围。下一步读取 `runner.ts` 剩余 import/call site、`conversation-engine.ts` 使用方和测试覆盖，优先判断 `conversation-engine` 是否本质属于 interactive turn SDK execution，而不是继续留在 bridge root 作为模糊 host 文件；新增测试前先审计是否已有 runner/conversation-engine 覆盖。
- 2026-05-30 07:07 完成 SDK conversation engine 使用范围审计并实施命名/路径收口：`conversation-engine.ts` 的生产使用者只有 interactive turn runner 和 mock-host 示例，自身职责是 SDK provider 调用、session lock、附件落盘、SSE stream 消费、permission request event 转发和 assistant message 持久化，本质属于 interactive turn SDK execution。已将其移动为 `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts`，runner 改为同目录 import，mock-host 和测试同步更新；原测试重命名为 `interactive-turn-sdk-conversation-engine.test.ts`，没有新增测试数量。`permission-broker.ts` 仍承担权限回调校验和 permission gateway 解析，不只属于 runner 内部，本阶段暂不移动。
- 2026-05-30 07:08 已运行针对性验证和审计：`interactive-turn-sdk-conversation-engine.test.ts` + `interactive-turn-runner.test.ts` 共 22 tests 通过，`npm run typecheck` 通过，`node work/rebuild/source-audit.mjs` 已更新审计产物。最新审计显示 `Bridge Host / Runtime Contracts` 从 23 文件 / 5557 行 / 风险 29 降为 22 文件 / 4834 行 / 风险 27；`Interactive Turn Runtime` 从 14 文件 / 2020 行 / 风险 15 变为 15 文件 / 2743 行 / 风险 17；`runner.ts` 风险跨聚合 import 从 4 降为 3。结论：这不是总复杂度下降，而是把 SDK execution 大块移回真实 owner，提升“interactive turn SDK 执行要先看哪里”的定位稳定性。
- 2026-05-30 07:10 当前进入阶段审计：本阶段完整验证已通过 `npm run build`、`npm test`（487 tests / 90 suites）和 `git diff --check`；旧 `src/lib/bridge/conversation-engine.ts` 导入已清空，当前未提交变更只剩本阶段文件移动/审计产物和用户侧 `AGENTS.md`。下一步归档原始行动和验证摘要，主 `STATUS.md` 收缩为阶段结论，再提交本阶段。

## 关键实现事实

- `src/lib/bridge/conversation-engine.ts` 移动并重命名为 `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts`。
- `src/__tests__/conversation-engine.test.ts` 移动并重命名为 `src/__tests__/interactive-turn-sdk-conversation-engine.test.ts`，仅更新路径和 describe 名称，没有新增测试数量。
- `src/lib/bridge/interactive-turn/runner.ts` 从同目录 import `sdk-conversation-engine`，不再跨回 bridge root 读取 conversation engine。
- `src/lib/bridge/examples/mock-host.ts` 同步更新 import。
- `sdk-conversation-engine.ts` 内部日志前缀从 `[conversation-engine]` 改为 `[sdk-conversation-engine]`，避免运行日志继续暴露旧术语。
- `permission-broker.ts` 保持在 Bridge Host / Runtime Contracts，因为它还负责权限 callback 校验、permission link 去重和 gateway 解析，不只是 runner 内部事件转发。

## 测试审计

- 本阶段没有新增单测，只重命名既有 `conversation-engine.test.ts`。
- 既有测试覆盖 `buildLocalAttachmentPromptSupplement`、`buildConversationPromptText`、`appendStreamPreviewChunk` 和 `processMessage` tool expansion 语义，足以证明移动未改变 SDK conversation engine 行为。
- `interactive-turn-runner.test.ts` 覆盖 runner 与 SDK conversation engine callback 交互、stream card、terminal finalization、stale binding 和 error diagnostics；无需新增重复 runner 场景。

## 审计数据

- `node work/rebuild/source-audit.mjs` 后：200 个 `src/**/*.ts` 文件，其中生产 134 个、测试 66 个；本地 import / re-export 边 767 条。
- `Bridge Host / Runtime Contracts`：22 文件 / 4834 行 / 入边 226 / 出边 98 / 风险跨聚合 import 27。上一阶段为 23 文件 / 5557 行 / 风险 29。
- `Interactive Turn Runtime`：15 文件 / 2743 行 / 入边 55 / 出边 66 / 风险跨聚合 import 17。上一阶段为 14 文件 / 2020 行 / 风险 15。
- `src/lib/bridge/interactive-turn/runner.ts`：623 行，直接 import 16，风险跨聚合 import 从 4 降到 3。
- `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts`：723 行，直接 import 9，风险跨聚合 import 3。
- 阶段价值判断：这不是总复杂度下降，Interactive Turn Runtime 变胖且风险 import 增加；但这是有意把 SDK 执行大块归还真实 owner，使 interactive turn SDK 执行入口更稳定，Bridge Host 的 catch-all 面积下降。

## 验证输出摘要

- 已通过：`node --test --import tsx src/__tests__/interactive-turn-sdk-conversation-engine.test.ts src/__tests__/interactive-turn-runner.test.ts`，22 tests 全部通过。
- 已通过：`npm run typecheck`。
- 已通过：`node work/rebuild/source-audit.mjs`，已更新 `source-file-audit.json` / `source-file-audit.md`。
- 已通过：`npm run build`。
- 已通过：`npm test`，487 tests / 90 suites 全部通过。
- 已通过：`git diff --check`。

## 后续判断

- 下一阶段仍应继续 `cluster-01`，但不能只沿着目录移动惯性。优先审计 `sdk-conversation-engine.ts` 内 `processMessage` / `consumeStream` 是否能自然拆出 SDK stream reducer、attachment persistence 或 runtime options resolver。
- `runner.ts` 剩余 Bridge Host 风险 import 主要来自 `permission-broker.ts`、`command-callbacks.ts`、`security/validators.ts`；其中 permission-broker 不宜简单移动，后续可考虑为 runner 暴露更窄 permission forwarding adapter。
