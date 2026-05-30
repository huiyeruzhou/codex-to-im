# 阶段归档：interactive SDK stream preview owner

## 阶段信息

- 阶段时间：2026-05-30 07:20-07:23 CST
- 主状态文件：`work/rebuild/STATUS.md`
- 阶段名称：interactive SDK stream consumption 边界审计
- 阶段目标：继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts` 内部剩余 `consumeStream`、inline tool block rendering、final artifact collection，审计是否能形成自然 owner，优先降低 SDK engine 对 SSE parsing / tool rendering / final artifact collection 的混杂感，新增测试前先审计既有覆盖是否足够。

## 原始行动记录

- 2026-05-30 07:20 已开启新阶段。当前 HEAD 为 `f68c8cd Extract interactive SDK attachment owner`，工作树仅剩用户侧 `AGENTS.md` 未提交改动，不属于 rebuild 提交范围。下一步读取 `sdk-conversation-engine.ts` 的 `consumeStream`、tool inline rendering helper 和 `interactive-turn-sdk-conversation-engine.test.ts` 既有覆盖，判断 stream reducer、tool block rendering、final artifact collection 哪个能作为自然子边界；如果只是移动大函数而不降低入口复杂度，则不做。
- 2026-05-30 07:20 完成 `consumeStream` 职责审计：当前剩余混杂点包括 SSE 消费和状态写入、tool/result content block reducer、stream preview markdown rendering、final response artifact collection。其中最自然的一刀是抽出 SDK stream preview renderer：`appendStreamPreviewChunk`、inline tool block markdown、reasoning note quote rendering 都是展示格式规则，不应继续让 SDK engine 直接 import logger/security/markdown rendering。既有 `appendStreamPreviewChunk` 单测和 processMessage tool expansion 集成测试可覆盖行为，不新增测试数量。
- 2026-05-30 07:21 已新增 `src/lib/bridge/interactive-turn/sdk-stream-preview.ts`，承接 `appendStreamPreviewChunk`、inline tool block markdown 和 reasoning note quote rendering；`sdk-conversation-engine.ts` 不再直接 import `logger.ts`、`security/validators.ts`、`markdown/fence.ts`，只通过 preview owner 调用渲染结果。测试未新增，仅把 `appendStreamPreviewChunk` import 指向新 owner；targeted tests 22 条和 `npm run typecheck` 已通过。
- 2026-05-30 07:21 已重跑 `node work/rebuild/source-audit.mjs`。最新审计为 202 个 `src/**/*.ts` 文件，其中生产 136 个、测试 66 个；本地 import / re-export 边 772 条。`sdk-conversation-engine.ts` 从 646 行降到 573 行，直接 import 从 10 降到 8，风险跨聚合 import 从 3 降到 1；`processMessage` 函数体从 181 行降到 110 行，`consumeStream` 从 307 行降到 305 行。新增 `sdk-stream-preview.ts` 83 行；自然聚类把 `src/lib/bridge/interactive-turn` 识别成 `cluster-05`（8 文件 / 2076 行 / 出边 33 / 入边 11），说明目录入口独立性改善，但聚合总风险仍为 17。
- 2026-05-30 07:23 已补完整验证：`npm run build` 通过，`npm test` 为 487 tests / 90 suites 全部通过，`git diff --check` 通过。当前进入阶段审计，准备归档原始行动记录、审计事实和验证摘要。

## 依赖事实和扫描结果

- 新增 `src/lib/bridge/interactive-turn/sdk-stream-preview.ts`，承接 `appendStreamPreviewChunk`、`buildInlineToolBlock`、`buildReasoningPreviewNote`。
- `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts` 不再直接 import `logger.ts`、`security/validators.ts`、`markdown/fence.ts`；这些展示格式依赖集中到 SDK stream preview owner。
- 测试没有新增数量，只将 `appendStreamPreviewChunk` 的 import 从 SDK conversation engine 移到 SDK stream preview owner。
- 最新审计：202 个 `src/**/*.ts` 文件，其中生产 136 个、测试 66 个；本地 import / re-export 边 772 条；函数节点 1561。
- `sdk-conversation-engine.ts` 573 行，直接 import 8，风险跨聚合 import 1；`processMessage` 110 函数体行，`consumeStream` 305 函数体行。
- `sdk-stream-preview.ts` 83 行，直接 import `logger.ts`、`markdown/fence.ts`、`security/validators.ts`；它是 intentionally narrow 的 presentation owner。
- 自然聚类将 `src/lib/bridge/interactive-turn` 识别为 `cluster-05`：8 文件 / 2076 行 / 出边 33 / 入边 11，说明 interactive turn 目录从混合 `cluster-01` 中更独立，但跨聚合端口仍需继续收窄。

## 验证输出摘要

- `node --test --import tsx src/__tests__/interactive-turn-sdk-conversation-engine.test.ts src/__tests__/interactive-turn-runner.test.ts`：22 tests / 4 suites 全部通过。
- `npm run typecheck`：通过。
- `node work/rebuild/source-audit.mjs`：通过，写出 `work/rebuild/source-file-audit.json` 和 `work/rebuild/source-file-audit.md`。
- `npm run build`：通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- `npm test`：487 tests / 90 suites 全部通过。
- `git diff --check`：通过，无输出。

## 阶段审计结论

- 完成：SDK stream preview markdown rendering 已从 provider orchestration / SSE consumption 中分离，形成 `interactive-turn/sdk-stream-preview.ts` owner。
- 完成：未新增测试数量，只调整既有测试 import，符合用户对测试膨胀的纠偏。
- 价值：`sdk-conversation-engine.ts` 不再直接依赖 logger/security/markdown rendering，文件从 646 行降到 573 行，直接 import 从 10 降到 8，风险跨聚合 import 从 3 降到 1；AI 定位“SDK 流式预览如何插入 tool/reasoning 展示”时有稳定入口。
- 限制：`consumeStream` 仍然 305 行，仍混合 SSE event reducer、session metadata 写入、assistant message persistence 和 final artifacts；聚合总风险仍为 17。下一阶段应优先考虑 stream event reducer 或 assistant response persistence owner，而不是继续只拆展示 helper。
