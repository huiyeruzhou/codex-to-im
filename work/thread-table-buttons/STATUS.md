## 任务目标

原始指令：`现在/t表格的按钮有点太多了在手机上看不清，能不能每三个一行？`

## 任务上下文

- 仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前环境 `rg` 不可用，检索使用 `find`/`grep`。
- 当前工作树已有未提交无关改动：`AGENTS.md`、`work/shell-safe-command/STATUS.md`、`work/binding-d492179f-activation/`；本任务不回退、不纳入提交。
- Node.js 开发命令需要使用 Node.js 24：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && ...`。

## 任务日志

### 2026-06-01 11:50 CST 阶段：调整 `/t` 表格按钮移动端布局

阶段描述：让 `/t` 表格 rich card 的按钮每行最多 3 个，降低手机端按钮挤在一行导致看不清的问题。

- 行动：记录用户目标；检查当前工作树，确认 `master...origin/master` 同步，存在无关未提交改动，需排除。
- 行动：初步检索到 `/t` 表格卡片生成集中在 `src/lib/bridge/command/thread-display.ts`，rich card 到飞书卡片 JSON 的渲染集中在 `src/lib/bridge/markdown/feishu.ts`；准备读取按钮 rows/actions 的数据结构和测试覆盖。
- 行动：读取 `src/lib/bridge/command/presentation.ts`，确认 `/t` 全局表格卡片原来第一行有 4 个按钮（绑定、解绑、归档、激活），第二行 2 个按钮（新建、刷新）；`/t ls` 当前绑定表格是 3+1。
- 行动：修改 `src/lib/bridge/command/presentation.ts`，新增 `THREAD_CARD_ACTIONS_PER_ROW = 3` 和 `buildThreadCardActionRows()`，所有 `/t` 表格卡片 action buttons 先按原顺序线性排列，再统一切成每行最多 3 个。
- 行动：全局 `/t` action rows 现在为 `绑定/解绑/归档` 与 `激活/新建/刷新`；`/t ls` action rows 保持 `解绑/归档/激活` 与 `刷新`；空绑定表保持 `新建/刷新` 一行。
- 行动：补充 `src/__tests__/command-dispatch.test.ts` 断言：全局 `/t` rich card 的按钮行精确为 3+3，且每行长度不超过 3；`/t ls` rich card 按钮行保持 3+1。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm exec -- node --test --test-concurrency=1 --import tsx --test-timeout=30000 src/__tests__/command-dispatch.test.ts`，通过，41 tests。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`，通过。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`，通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- 阶段验证：运行 `git diff --check`，通过。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`，通过，536 tests。
- 阶段验证和git提交：当前进入阶段审计。
- 阶段审计：
  - 需求“`/t` 表格按钮每三个一行”：`buildThreadCardActionRows()` 对 `/t` 表格卡片 action buttons 按 3 个一组切行；全局 `/t` 从原来的 4+2 变成 3+3，`/t ls` 为 3+1，空绑定表为 2。
  - 需求“手机上看得清”：rich card 渲染层 `buildCardActionElements()` 已经按 action rows 逐行生成 `column_set`；现在每个 `column_set` 最多 3 个按钮，避免 4 个按钮在手机端挤在同一行。
  - 兼容性：按钮顺序和 callbackData 未改变，只改变行分组；现有 flat action 顺序测试仍通过。
  - 回归覆盖：`command-dispatch` 断言全局 `/t` rows 为 `绑定/解绑/归档`、`激活/新建/刷新` 且每行不超过 3；`/t ls` rows 为 `解绑/归档/激活`、`刷新`。
  - 验证覆盖：定向 command-dispatch、typecheck、build、diff check、完整 npm test 均通过。
- 阶段结论：本阶段满足用户目标。接下来只暂存 `src/lib/bridge/command/presentation.ts`、`src/__tests__/command-dispatch.test.ts`、本 `STATUS.md` 并创建本地提交；无关工作树改动不纳入提交。
- 阶段验证和git提交：已创建本地提交 `Limit thread table card action rows`；本记录将 amend 到同一提交。用户本轮未要求 push，因此不 push。
