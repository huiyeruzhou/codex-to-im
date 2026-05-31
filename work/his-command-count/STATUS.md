## 任务目标

原始指令：`/his直接解释为/his msg，给/his raw和/his msg都加一个参数，可以临时指定条数`

## 任务上下文

- 仓库要求长期任务在 `work/<goalname>/STATUS.md` 记录事实、计划、测试和审计；本任务状态文件为 `work/his-command-count/STATUS.md`。
- 当前工作树已有与本任务无关的改动：`AGENTS.md`、多个 `work/*/STATUS.md`、`work/rebuild/*` 删除/新增等；本任务不应回退这些改动。
- `rg` 在当前环境不可用，代码检索改用 `grep`/`find`。
- `/his` 是 `/history` 的别名，别名映射在 `src/lib/bridge/command/aliases.ts`。
- `/history` 命令分发到 `handleHistoryCommand`，主要实现在 `src/lib/bridge/command/diagnostics.ts`。
- 现状：空 `/his` 会进入解析文本视图；`/his msg` 才渲染卡片；`/his raw` 是解析纯文本；`/his json` 发送原始 Codex session JSONL；`/his limit <1-20>` 修改全局配置 `historyMessageLimit`。
- 需求拆解：
  - 空 `/his` 应等同 `/his msg`。
  - `/his msg <1-20>` 临时指定本次返回条数，不修改全局配置。
  - `/his raw <1-20>` 临时指定本次返回条数，不修改全局配置。
  - 保留 `/his limit <1-20>` 修改全局配置的能力。
  - 命令帮助、README、UI 命令表需要同步，避免旧描述误导。
- Node.js 开发命令按仓库要求使用 Node.js 24；如有 `NODE_OPTIONS` 兼容问题，使用 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && ...`。

## 任务日志

### 2026-05-31 21:23 阶段：审计现状并规划 `/his` 行为调整

阶段描述：确认 `/his` 当前实现、相关测试和文档位置，建立本任务状态文件。

- 行动：检查工作树状态，发现已有多处无关改动，本任务只处理 `/his` 命令相关代码、测试、文档和本状态文件。
- 行动：检索 `/his`、`historyMessageLimit`、`history raw/msg`，确认命令入口在 `src/lib/bridge/command/dispatch.ts`，核心逻辑在 `src/lib/bridge/command/diagnostics.ts`，相关 E2E 测试在 `src/__tests__/bridge-command-e2e.test.ts`。
- 行动：确认当前 `/his` 空参数走“最近对话（解析文本）”，这与新要求“直接解释为 `/his msg`”冲突。
- 下一个阶段计划：修改 `handleHistoryCommand` 的参数解析，使 `msg/raw` 支持本次 limit；空 `/his` 默认走 `msg`；同步 help、README、UI 命令表；补充 E2E 测试。

### 2026-05-31 21:25 阶段：实现 `/his` 默认卡片与临时条数参数

阶段描述：调整 `/his` 参数解析、用户提示、文档和 E2E 覆盖，使新行为可验证。

- 行动：修改 `src/lib/bridge/command/diagnostics.ts`，新增统一 usage 文案和本次/配置条数显示；空 `/his` 规范化为 `msg` 视图；`/his msg <1-20>`、`/his raw <1-20>`、`/his <1-20>` 使用临时条数；`/his limit <1-20>` 仍写入全局配置。
- 行动：补充 `src/__tests__/bridge-command-e2e.test.ts`，覆盖 `/his msg 1` 不修改全局配置、空 `/his` 返回卡片、`/his raw 1` 返回解析文本并只展示最后一条。
- 行动：同步 `src/lib/bridge/command/help.ts`、`src/ui/shell.ts`、`README.md`、`README_EN.md`，将旧的“`/his` 纯文本/原始消息”描述改为默认卡片，并记录 `[N]` 临时条数参数。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && CTI_HOME=$(mktemp -d) node --test --test-concurrency=1 --import tsx --test-timeout=15000 src/__tests__/bridge-command-e2e.test.ts`，结果 19 个测试全部通过。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`，通过。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`，通过，输出 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`，结果 522 个测试全部通过。
- 阶段验证和git提交：当前进入阶段审计。
- 阶段审计：
  - 需求“`/his` 直接解释为 `/his msg`”：已由 `handleHistoryCommand` 默认 `historyView = 'msg'` 实现；E2E `falls back to bridge cached messages for /his and supports temporary raw limits` 验证空 `/his` 返回 `最近对话（msg）` 且产生 rich card。
  - 需求“`/his msg` 加参数临时指定条数”：已支持 `/his msg <1-20>`；E2E 验证 `/his msg 1` 只返回最后一条，并确认 `historyMessageLimit` 仍为 12，证明未修改全局配置。
  - 需求“`/his raw` 加参数临时指定条数”：已支持 `/his raw <1-20>`；E2E 验证 `/his raw 1` 返回解析文本，只展示最后一条，并显示 `本次 1（配置 8）`。
  - 兼容性：保留 `/his json`/`/his file` 发送原始 JSONL，保留 `/his limit <1-20>` 写入默认配置；新增 `/his <1-20>` 作为 `/his msg <1-20>` 的自然简写。
  - 文档审计：`README.md`、`README_EN.md`、`src/lib/bridge/command/help.ts`、`src/ui/shell.ts` 均已去掉旧的“`/his` 是纯文本/原始消息”描述，并补充临时条数参数。
  - 验证命令：定向 E2E、`npm run typecheck`、`npm run build`、完整 `npm test` 均通过。
- 阶段结论：本阶段已满足当前任务目标；准备提交本地 git。由于提交前 HEAD `Add /t archive for Codex sessions` 与本任务无关，本阶段创建单独提交，不 amend 无关提交。
- 阶段验证和git提交：已创建并 amend 本地提交 `Update /his history command defaults`；最终提交哈希以 `git log -1` 为准，避免在状态文件中固定会随 amend 改变的哈希。
- 下一个阶段计划：做最终工作树核对。
