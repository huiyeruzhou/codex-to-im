# 阶段归档：interactive turn directory boundaries

## 阶段描述

原阶段从 `src/lib/bridge/interactive-turn/sdk/conversation-engine.ts` 的 `consumeStream` 审计开始，随后根据用户 2026-05-30 07:27 纠偏调整为 cluster 级推进：定位 `cluster-01` 内的 `Interactive Turn Runtime` 子边界，并把 `src/lib/bridge/interactive-turn/` 从平铺 owner 文件重排为可按用户故事猜测的子目录。

## 原始行动记录

- 2026-05-30 07:24 已开启新阶段。当前 HEAD 为 `87d1e40 Extract interactive SDK stream preview owner`，工作树仅剩用户侧 `AGENTS.md` 未提交改动；本次用户继续要求以 `work/rebuild` 和当前状态为权威推进完整 rebuild 目标。下一步读取 `sdk-conversation-engine.ts`、相关 tests 和审计热点，判断 `consumeStream` 内是否应抽出 stream event reducer 或 assistant response persistence owner；不把 `consumeStream` 剩余 305 行只机械切块。
- 2026-05-30 07:24 完成 `consumeStream` 剩余职责审计：事件 case 本身仍强依赖 callback、session metadata 和 partial state，直接抽 reducer 容易制造大参数对象；更自然的一刀是 assistant response persistence/output owner，集中 final artifact 剥离、tool block JSON 持久化、纯文本 responseText 拼装和 outbound attachment 去重。该逻辑独立于 SSE 事件循环，且已有 processMessage tool expansion / outbound artifact 测试路径覆盖，不需要新增测试数量。
- 2026-05-30 07:25 已新增 `src/lib/bridge/interactive-turn/sdk-assistant-response.ts`，承接 `buildSdkAssistantResponse` 和 `buildSdkAssistantMessageContent`。成功路径由该 owner 统一生成 assistant 持久化内容、IM responseText 和去重后的 outbound attachments；异常路径复用 message content builder，保留原来不剥离 final artifacts、不写 tokenUsage 的 best-effort 保存语义。`sdk-conversation-engine.ts` 不再直接 import `final-response-artifacts.ts`。
- 2026-05-30 07:26 已通过 targeted tests 26 条和 `npm run typecheck`，并重跑 `node work/rebuild/source-audit.mjs`。最新审计为 203 个 `src/**/*.ts` 文件，其中生产 137 个、测试 66 个；本地 import / re-export 边 775 条。`sdk-conversation-engine.ts` 从 573 行降到 548 行，`consumeStream` 从 305 行降到 280 行，风险跨聚合 import 保持 1。新增 `sdk-assistant-response.ts` 54 行；本阶段降低了 SDK engine 输出模型混杂，但生产文件数和 import 边继续增加，自然聚类没有证明全局改善，后续不应继续用这种小 owner 连续切碎。
- 2026-05-30 07:27 收到用户纠偏：本阶段不能继续按单文件小 owner 推进，也不能继续在同一目录下增加文件。当前未提交的 `sdk-assistant-response.ts` 先视为待整合素材，不作为独立阶段提交；下一步改为定位 cluster 并规划目录边界，把 interactive turn 相关文件按清晰子目录重排后再审计。
- 2026-05-30 07:29 已定位本阶段 cluster：最新审计中的 `cluster-01` 仍是最大混合簇，其中 `Interactive Turn Runtime` 为 18 文件 / 2815 行 / boundary 48，是当前要规整的子边界；不是继续只处理 `sdk-conversation-engine.ts` 单文件。已将 `src/lib/bridge/interactive-turn/` 从平铺文件改为目录边界：`sdk/` 承接 SDK 执行、附件、预览、输出模型、SDK event；`stream/` 承接 structured stream UI；`terminal/` 承接外部终端收尾；`response/` 承接最终响应计划；`environment/` 承接 turn 环境解析；`runner.ts` 保留为 interactive turn 聚合入口。`npm run typecheck` 已通过，下一步重跑 source audit 验证目录和 cluster 变化。
- 2026-05-30 07:31 重跑审计后确认目录边界改善但新增 `sdk-assistant-response.ts` 仍使文件数继续增加，不符合用户纠偏。已撤回该新增文件，将 assistant response 构建逻辑放回 `sdk/conversation-engine.ts`；本阶段只保留 cluster 级目录重排，不再把单文件拆分作为独立收益。
- 2026-05-30 07:32 撤回新增文件后重新通过 `npm run typecheck` 和 `node work/rebuild/source-audit.mjs`。最新审计回到 202 个 `src/**/*.ts` 文件，其中生产 136 个、测试 66 个；本地 import / re-export 边 772 条。目录统计明确出现 `src/lib/bridge/interactive-turn/sdk` 4 文件 / 970 行、`stream` 1 文件 / 214 行、`response` 1 文件 / 144 行、`environment` 1 文件 / 131 行、`terminal` 1 文件 / 125 行。`cluster-01` 仍为最大混合簇（59 文件 / 14702 行 / 内部跨聚合边 108），但 Interactive Turn Runtime 在 cluster 内从无目录语义的平铺 17 文件，变成以 runner + 子目录表达用户故事边界；本阶段价值是定位 cluster 并重排目录边界，不宣称全局耦合下降。
- 2026-05-30 07:33 本轮继续推进前已取证：当前 staged 区有 8 个 interactive-turn 文件纯重命名到 `environment/`、`response/`、`sdk/`、`stream/`、`terminal/` 子目录；未暂存区包含 import 路径调整、相关测试路径更新、审计产物和本状态文件更新。`AGENTS.md` 是用户侧协作规范改动，继续排除在 rebuild 阶段提交之外。下一步执行完整验证、阶段审计归档，并将本阶段目录重排提交到本地 git。
- 2026-05-30 07:35 阶段验证已通过：targeted interactive-turn tests 32 tests / 7 suites 全部通过；`npm run typecheck` 通过；`node work/rebuild/source-audit.mjs` 已重写审计产物；`npm run build` 通过；`npm test` 487 tests / 90 suites 全部通过；`git diff --check` 通过。当前进入阶段审计：准备将原始行动记录、验证摘要和审计事实归档到 `work/rebuild/STATUS-20260530-0735-interactive-turn-directory-boundaries.md`，并把 `STATUS.md` 压缩为阶段结论。

## 修改范围

- 纯重命名并更新 import：
  - `src/lib/bridge/interactive-turn/turn-environment.ts` -> `src/lib/bridge/interactive-turn/environment/turn-environment.ts`
  - `src/lib/bridge/interactive-turn/final-response-plan.ts` -> `src/lib/bridge/interactive-turn/response/final-response-plan.ts`
  - `src/lib/bridge/interactive-turn/sdk-attachments.ts` -> `src/lib/bridge/interactive-turn/sdk/attachments.ts`
  - `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts` -> `src/lib/bridge/interactive-turn/sdk/conversation-engine.ts`
  - `src/lib/bridge/interactive-turn/sdk-stream-events-controller.ts` -> `src/lib/bridge/interactive-turn/sdk/stream-events-controller.ts`
  - `src/lib/bridge/interactive-turn/sdk-stream-preview.ts` -> `src/lib/bridge/interactive-turn/sdk/stream-preview.ts`
  - `src/lib/bridge/interactive-turn/stream-ui-controller.ts` -> `src/lib/bridge/interactive-turn/stream/ui-controller.ts`
  - `src/lib/bridge/interactive-turn/terminal-finalization-controller.ts` -> `src/lib/bridge/interactive-turn/terminal/finalization-controller.ts`
- 更新受影响测试和 `src/lib/bridge/examples/mock-host.ts` 的 import 路径。
- 重跑并更新 `work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md`。
- `AGENTS.md` 是用户侧工作树改动，不属于本阶段提交范围。

## 审计事实

- 最新审计：202 个 `src/**/*.ts` 文件，其中生产 136 个、测试 66 个；本地 import / re-export 边 772 条。
- 目录统计显示 `src/lib/bridge/interactive-turn/sdk` 4 文件 / 970 行，`stream` 1 文件 / 214 行，`response` 1 文件 / 144 行，`environment` 1 文件 / 131 行，`terminal` 1 文件 / 125 行，`runner.ts` 仍保留为 interactive turn 聚合入口。
- `cluster-01` 仍是最大混合簇：59 文件 / 14702 行 / 内部跨聚合边 108。本阶段不宣称全局耦合下降；真实收益是 interactive turn 用户故事族入口和子目录命名更清楚。
- 先尝试的 `sdk-assistant-response.ts` 小 owner 已撤回；这次提交不增加源文件数量，避免继续在同一目录堆小文件。

## 验证

- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --import tsx src/__tests__/interactive-turn-sdk-conversation-engine.test.ts src/__tests__/interactive-turn-sdk-stream-events-controller.test.ts src/__tests__/interactive-turn-final-response-plan.test.ts src/__tests__/interactive-turn-terminal-finalization-controller.test.ts src/__tests__/interactive-turn-runner.test.ts`，32 tests / 7 suites 全部通过。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node work/rebuild/source-audit.mjs`。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`，487 tests / 90 suites 全部通过。
- 已通过：`git diff --check`。

## 阶段结论

本阶段完成的是 cluster 级目录边界规整，而不是 `consumeStream` 内部职责拆分。它响应了用户关于“至少定位一个 cluster”和“不能继续在同一目录堆小 owner 文件”的纠偏：interactive turn 聚合现在以 `runner.ts` 作为入口，下面按 SDK 执行、structured stream UI、外部终端收尾、final response plan 和 turn environment 分目录承接。这个结果提高路径和文件名的可预测性，但核心耦合仍在 `cluster-01`，后续应继续处理 interactive turn 与 permission / delivery / bridge host 的端口边界。
