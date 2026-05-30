# 阶段归档：final response delivery owner 审计

## 阶段信息

- 阶段时间：2026-05-30 06:31 - 06:45 CST
- 阶段目标：继续 `cluster-01`，聚焦 interactive final response delivery、mirror finalized delivery、stale binding notice、stream card text skip 与 attachment fallback 的 owner，先审计共享 delivery port 和重复决策，再选择一刀能降低状态流认知成本的修改。
- 当前 HEAD：`Extract interactive terminal finalization controller`
- 本阶段提交前现场：阶段代码未提交；用户侧 `AGENTS.md` 有未提交改动，不纳入本阶段 rebuild 提交。

## 原始行动记录

- 2026-05-30 06:41 已同步续跑指令、当前工作树事实和用户命名纠偏，并完成 final delivery owner 审计、小步抽取和目录命名收口：当前 HEAD 为 `Extract interactive terminal finalization controller`，分支领先远端 19 个提交；工作树仅剩用户侧 `AGENTS.md` 未提交改动，不纳入本阶段提交。审计发现 interactive 路径中 final response 选源、stream card 文本、stale binding notice、card finalized 后是否跳过文本投递混在 `runInteractiveMessage` 的主流程里；mirror 路径已复用 `deliverFinalResponse`，但 mirror formatting 和 stream finalize 仍应留在 mirror owner。本阶段先抽出 final response plan 纯规则，然后按用户纠偏把 interactive IM turn 相关文件集中到 `src/lib/bridge/interactive-turn/`：`runner.ts`、`stream-ui-controller.ts`、`terminal-finalization-controller.ts`、`final-response-plan.ts`；对应测试改名为 `interactive-turn-runner.test.ts`、`interactive-turn-terminal-finalization-controller.test.ts`、`interactive-turn-final-response-plan.test.ts`。同时更新 `source-audit.mjs`，让 `interactive-turn/` 目录归入 `Interactive Turn Runtime`，避免审计结果继续把规整后的目录错误归类到 Bridge Host。已通过 `npm run typecheck`；已通过 `node --test --import tsx src/__tests__/interactive-turn-final-response-plan.test.ts src/__tests__/interactive-turn-runner.test.ts src/__tests__/interactive-turn-terminal-finalization-controller.test.ts src/__tests__/delivery-pipeline.test.ts src/__tests__/response-assembler.test.ts src/__tests__/bridge-manager.test.ts src/__tests__/mirror-feedback-controller.test.ts`（99 tests）。最新 `node work/rebuild/source-audit.mjs`：文件数 197（生产 132，测试 65），本地 import / re-export 边 751；新增目录聚合统计 `src/lib/bridge/interactive-turn` 4 文件 / 1328 行；`runInteractiveMessage` 位于 `src/lib/bridge/interactive-turn/runner.ts`，525 行；审计重新归类后 `Bridge Host / Runtime Contracts` 从 27 文件 / 6885 行降为 23 文件 / 5557 行，`Interactive Turn Runtime` 为 12 文件 / 1907 行。
- 2026-05-30 06:42 本次续跑已重新取证：当前阶段实现仍处于未提交状态，`git status --short` 显示旧 `interactive-*` 文件删除、新 `src/lib/bridge/interactive-turn/` 文件和新测试待纳入，且 `AGENTS.md` 是用户侧未提交改动，应排除在 rebuild 提交之外。下一步补齐当前阶段的代码核对、完整验证、阶段审计归档和本地提交。
- 2026-05-30 06:45 当前进入阶段审计：已重新运行完整验证链 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node work/rebuild/source-audit.mjs && npm run typecheck && npm run build && npm test && git diff --check`，使用 Node v24.12.0 / npm v11.6.2；审计产物生成成功，typecheck 通过，build 生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`，完整测试 484 tests / 89 suites 全部通过，`git diff --check` 通过。最新审计：197 个 `src/**/*.ts` 文件（生产 132，测试 65）、751 条本地 import / re-export 边；函数节点 1554，函数依赖边 1759（内聚 1496，外聚 263）；`Bridge Host / Runtime Contracts` 为 23 文件 / 5557 行 / 29 条风险跨聚合 import，`Interactive Turn Runtime` 为 12 文件 / 1907 行 / 14 条风险跨聚合 import；`runInteractiveMessage` 迁入 `src/lib/bridge/interactive-turn/runner.ts`，函数体 525 行、外聚度 7。

## 关键依赖事实

- `bridge-manager.ts` 和 `interactive-runtime.ts` 改为从 `src/lib/bridge/interactive-turn/runner.ts` 引入 interactive turn runner / task state。
- 旧散落文件 `src/lib/bridge/interactive-message-runner.ts`、`src/lib/bridge/interactive-stream-ui.ts`、`src/lib/bridge/interactive-terminal-finalization.ts` 删除；职责迁入 `src/lib/bridge/interactive-turn/runner.ts`、`stream-ui-controller.ts`、`terminal-finalization-controller.ts`。
- 新增 `src/lib/bridge/interactive-turn/final-response-plan.ts`，把 external terminal finalization 和 SDK process finalization 的最终 stream status、card text、deliverable response、card finalized 后是否跳过文本投递收成纯规则。
- 测试文件从旧 `interactive-message-runner.test.ts` / `interactive-terminal-finalization.test.ts` 改名并规整为 `interactive-turn-runner.test.ts`、`interactive-turn-terminal-finalization-controller.test.ts`，新增 `interactive-turn-final-response-plan.test.ts` 覆盖 stale binding notice、Codex terminal final text + SDK attachments merge、fallback SDK error delivery、aborted empty response。
- `work/rebuild/source-audit.mjs` 将 `src/lib/bridge/interactive-turn/` 归为 `Interactive Turn Runtime`，防止文件规整后仍被误算入 Bridge Host。

## 验证摘要

- `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node work/rebuild/source-audit.mjs && npm run typecheck && npm run build && npm test && git diff --check`
- Node.js：v24.12.0；npm：v11.6.2。
- `node work/rebuild/source-audit.mjs`：已写入 `work/rebuild/source-file-audit.json` 和 `work/rebuild/source-file-audit.md`。
- `npm run typecheck`：通过。
- `npm run build`：通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- `npm test`：484 tests / 89 suites，全部通过。
- `git diff --check`：通过。

## 审计数据

- 文件数：197（生产 132，测试 65）。
- 本地 import / re-export 边数：751。
- `src/lib/bridge/interactive-turn` 目录：4 文件 / 1328 行。
- `Bridge Host / Runtime Contracts`：23 文件 / 5557 行 / 29 条风险跨聚合 import。
- `Interactive Turn Runtime`：12 文件 / 1907 行 / 14 条风险跨聚合 import。
- 函数节点数：1554。
- 函数依赖边数：1759（内聚 1496，外聚 263）。
- `runInteractiveMessage`：`src/lib/bridge/interactive-turn/runner.ts`，函数体 525 行，内聚度 17，外聚度 7。

## 阶段判断

- 本阶段的真实收益不是全局依赖图净下降；风险跨聚合 import 数量在归类修正后仍显示 Interactive Turn Runtime 对 Bridge Host / Runtime Contracts 有大量依赖。
- 本阶段完成了两个对 AI 查找更重要的收口：一是 final response delivery 决策有了可测纯规则 owner，二是 interactive IM turn 用户故事族有了稳定目录入口 `src/lib/bridge/interactive-turn/`。
- `runInteractiveMessage` 仍是 525 行大函数且外聚度升至 7，说明 runner 仍同时协调 context/store/router/engine/broker/delivery/stream state。下一阶段应继续沿 interactive turn runtime 的端口收窄，而不是只继续搬文件。
