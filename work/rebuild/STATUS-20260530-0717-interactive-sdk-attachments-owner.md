# 阶段归档：interactive SDK attachments owner

## 阶段信息

- 阶段时间：2026-05-30 07:12-07:17 CST
- 主状态文件：`work/rebuild/STATUS.md`
- 阶段名称：interactive SDK conversation engine 内部边界审计
- 阶段目标：继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts` 内部的 `processMessage` / `consumeStream`，审计 SDK stream reducer、attachment persistence、runtime options resolver 哪个是自然子边界，并在不增加冗余测试的前提下选择一刀能降低认知入口复杂度的修改。

## 原始行动记录

- 2026-05-30 07:12 已开启新阶段。当前 HEAD 为 `7e8f313 Move SDK conversation engine into interactive turn`，工作树仅剩用户侧 `AGENTS.md` 未提交改动，不属于当前 rebuild 提交范围。下一步读取 `sdk-conversation-engine.ts` 的函数结构、现有 `interactive-turn-sdk-conversation-engine.test.ts` 覆盖和审计热点，优先找能把独立算法/文件格式/协议处理从 provider orchestration 中分离的自然边界；新增测试前先审计是否能复用或移动现有测试。
- 2026-05-30 07:14 完成第一刀内部边界收口：附件元数据格式、非图片附件 prompt supplement、用户消息 `<!--files:JSON-->` 持久化和 LLM file path 回填是独立文件格式/本地文件系统边界，不应继续放在 `processMessage` provider orchestration 中。新增 `src/lib/bridge/interactive-turn/sdk-attachments.ts` 承接 `buildLocalAttachmentPromptSupplement`、`buildConversationPromptText`、`prepareSdkMessageAttachments`；`sdk-conversation-engine.ts` 不再直接 import `fs` / `path`，从 723 行降到 645 行。测试没有新增，只把既有 attachment prompt import 指向新模块；targeted tests 22 条已通过。
- 2026-05-30 07:15 已通过 `npm run typecheck` 和 `node work/rebuild/source-audit.mjs`。最新审计显示 `sdk-conversation-engine.ts` 为 646 行，`processMessage` 函数体从 226 行降到 181 行；新增 `sdk-attachments.ts` 110 行。`Interactive Turn Runtime` 从 15 文件 / 2743 行 / 风险 17 变为 16 文件 / 2776 行 / 风险 17，说明本阶段降低 provider orchestration 局部复杂度，但没有降低聚合风险。
- 2026-05-30 07:16 续跑时复核当前工作树：除用户侧 `AGENTS.md` 外，当前阶段未提交文件为 `sdk-conversation-engine.ts`、新增 `sdk-attachments.ts`、测试 import 调整、`STATUS.md` 和审计产物。`grep` 显示 attachment prompt/build/prepare 入口只在 interactive turn SDK engine 与既有测试中引用；本环境无 `rg`，后续扫描改用 `grep/find`。当前判断仍是附件持久化/文件格式 owner 抽取，未新增测试数量，下一步补跑完整 `build`、`npm test`、`git diff --check` 后进入阶段审计。

## 依赖事实和扫描结果

- 代码修改：新增 `src/lib/bridge/interactive-turn/sdk-attachments.ts`，承接 `PersistedAttachmentMeta`、`buildLocalAttachmentPromptSupplement`、`buildConversationPromptText`、`prepareSdkMessageAttachments`。
- `sdk-conversation-engine.ts` 不再直接 import `fs` / `path`，附件持久化和 `<!--files:JSON-->` 持久化格式由 `sdk-attachments.ts` 负责。
- 测试修改仅为 import 调整：`interactive-turn-sdk-conversation-engine.test.ts` 继续覆盖 attachment prompt supplement 和 prompt text 组合，没有新增测试文件或测试数量。
- 引用扫描：`buildLocalAttachmentPromptSupplement`、`buildConversationPromptText`、`prepareSdkMessageAttachments` 只在 interactive turn SDK engine 与既有测试中引用。
- 最新审计：201 个 `src/**/*.ts` 文件，其中生产 135 个、测试 66 个；本地 import / re-export 边 770 条；函数节点 1557。
- 聚合审计：`Bridge Host / Runtime Contracts` 22 文件 / 4834 行 / 风险 27；`Interactive Turn Runtime` 16 文件 / 2776 行 / 风险 17。
- 函数审计：`processMessage` 为 181 函数体行，外聚度 2；`consumeStream` 仍为 307 函数体行，外聚度 2，是下一阶段候选热点。

## 验证输出摘要

- `node --test --import tsx src/__tests__/interactive-turn-sdk-conversation-engine.test.ts src/__tests__/interactive-turn-runner.test.ts`：22 tests / 4 suites 全部通过。
- `npm run typecheck`：通过。
- `npm run build`：通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- `npm test`：487 tests / 90 suites 全部通过。
- `git diff --check`：通过，无输出。
- `node work/rebuild/source-audit.mjs`：通过，写出 `work/rebuild/source-file-audit.json` 和 `work/rebuild/source-file-audit.md`。

## 阶段审计结论

- 完成：本阶段将附件本地持久化、附件元数据格式和非图片附件 prompt supplement 从 SDK provider orchestration 中分离，形成可按用户故事猜到的 `interactive-turn/sdk-attachments.ts` owner。
- 完成：未增加测试数量，仅移动既有测试 import，符合用户对测试膨胀的纠偏。
- 价值：`processMessage` 从 226 函数体行降到 181 函数体行，且 SDK engine 不再直接接触 `fs` / `path`，AI 后续定位“IM 附件如何进入 SDK prompt / 本地文件路径”时有稳定入口。
- 限制：`Interactive Turn Runtime` 风险跨聚合 import 仍为 17，说明本阶段没有降低聚合总耦合；`consumeStream` 仍是 307 行热点，后续需继续审计 SDK stream reducer / tool block rendering / final artifact collection。
