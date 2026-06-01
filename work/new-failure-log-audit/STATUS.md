## 任务目标

原始指令：查一下最近10分钟以内的日志，为什么 `/new` 出来的都失败了，是不是又没传环境变量。

## 任务日志

### 阶段 1：审计最近 10 分钟日志和运行环境（2026-06-01 12:44 CST）

- 已创建任务状态文件。目标是只审计日志和运行状态，不执行 hot update/redeploy。
- 计划检查 `~/.codex-to-im/logs/bridge.log` 最近 10 分钟相关 `/new`、Codex exec、环境快照、错误栈；同时读取 runtime status 和配置快照中与 provider/env 相关的字段。
- 日志窗口：当前本地时间 2026-06-01 12:44 CST，对应日志 UTC 04:34 之后。Bridge 当前 PID `1387807`，启动于 2026-06-01 12:30 CST，hot update log 为 `~/.codex-to-im/logs/hot-update-20260601-123029.log`。
- 最近失败集中在 session `43c370da-42a4-4cb6-94ed-118f00866628`：04:41:13、04:41:51、04:42:47 UTC 三次 SDK `codex exec` 均以 code 1 退出，日志表面错误为 `Reading prompt from stdin...`。
- 复现同一 `codex exec` 命令后确认 stdout JSON 中真实上游错误为：`The following tools cannot be used with reasoning.effort 'minimal': web_search`。SDK 当前只把 stderr 拼到异常里，导致 bridge 日志只显示 `Reading prompt from stdin...`，隐藏了 stdout 的真实错误。
- 配置/状态事实：`config.env` 和 `config.v2.json` 全局 `CTI_CODEX_REASONING_EFFORT`/`codexReasoningEffort` 为 `high`，但 `~/.codex-to-im/data/sessions.json` 中 session `43c370da-42a4-4cb6-94ed-118f00866628` 持久化了 `reasoning_effort: "minimal"`；audit 中也有“已更新思考级别 minimal (1)”记录。
- 环境事实：daemon 进程环境确实没有 `CTI_CODEX_API_KEY`/`CODEX_API_KEY`/`OPENAI_API_KEY`/`CTI_CODEX_BASE_URL`，hot update 启动命令只显式传了 `NODE_OPTIONS=--use-env-proxy LITELLM_KEY=sk-local-dev codex-to-im start`；但复现命令能到达 LiteLLM/Azure 并返回业务错误，说明这次失败主因不是认证 key 缺失，而是 `minimal` reasoning 与 `web_search` 工具组合不兼容。
- 额外风险：daemon 继承了当前 Codex 会话的 `CODEX_CI=1`、`CODEX_INTERNAL_ORIGINATOR_OVERRIDE=codex_sdk_ts`、`CODEX_THREAD_ID=...` 等内部环境；这不是本次错误的直接证据，但属于 bridge 启动环境污染，应在后续修复 hot update/launcher 时清理。
- 阶段审计结论：`/new` 创建出的 session 本身成功，后续请求失败是因为该 session 被设置为 `reasoning_effort=minimal`，而上游当前对带 `web_search` 的请求拒绝 minimal effort。短期绕过：对该 session 执行 `/r high` 或 `/r medium`；长期修复应避免 minimal 时启用 web_search，或在 provider 侧捕获 stdout JSON 并把真实错误写入日志/IM。

### 阶段 2：修复 minimal/web_search 组合和失败 stdout 诊断（2026-06-01 12:55 CST）

- 用户纠偏：不是要把 Codex stdout 每一行常规打印/回显，而是要在报错路径把 stdout JSON error 一起打进日志，避免只看到 stderr `Reading prompt from stdin...` 误导排查。
- 已读取 SDK 实现：`@openai/codex-sdk` 在子进程退出非 0 时只把 stderr 放进 `Codex Exec exited...` 异常；stdout JSON 行会先被解析为 ThreadEvent，provider 可以在 `turn.failed`/`error` 事件处保存真实错误。
- 已确认 SDK ThreadOptions 支持 `webSearchMode?: "disabled" | "cached" | "live"`；本阶段计划在 `modelReasoningEffort === "minimal"` 时显式传 `webSearchMode: "disabled"`，避免 minimal 与默认 web_search 组合冲突。
- 修改 `src/codex/provider.ts`：`modelReasoningEffort === "minimal"` 时向 SDK threadOptions 显式设置 `webSearchMode: "disabled"`，启动日志预览也记录该配置。
- 修改失败诊断：provider 在 stdout 解析出的 `turn.failed`/`error` 事件中保存真实错误；若随后 SDK 因子进程非 0 退出抛出只含 stderr 的 `Codex Exec exited...`，则以 `[codex-provider] Codex exec failed after stdout error:` 同时记录 `stdout_error` 与 `sdk_exit_error`，并避免重复用 stderr-only 异常覆盖用户已收到的真实错误。
- 增加测试：覆盖 minimal reasoning 禁用 web search，以及 stdout error 后跟 SDK exit stderr 时日志包含两者且用户错误不被 `Reading prompt from stdin...` 覆盖。
- 阶段审计：当前进入阶段审计。
- 对照目标：已同时处理两个长期修复点。minimal reasoning 的 SDK 请求会显式传 `webSearchMode: "disabled"`，避免默认 web_search 与 minimal 组合；失败路径会保留 stdout JSON error，并在 SDK 后续抛出 stderr-only exit error 时把二者一起写入日志。
- 验证结果：`npm run typecheck` 通过；`node --test --import tsx src/__tests__/codex-provider.test.ts` 通过；完整 `npm test` 通过，543 个测试全部通过。
- 审计结论：本阶段完成；没有执行 hot update/redeploy，没有 push。
- 阶段验证和git提交：待提交本地 git commit。
- 阶段验证和git提交：已创建本地提交 `151399f Fix minimal web search and stdout error logging`，随后补写提交结果并 amend 到同一提交。

### 阶段 3：minimal 设置提示 web search 不可用（2026-06-01 13:00 CST）

- 用户要求：当用户把 reasoning 设置为 `minimal` 时给出提示，说明这会导致无法使用 web search。
- 已定位入口：会话级 `/r` 由 `runtime-settings.ts` 处理；全局 `/set codexReasoningEffort` 由 `global-settings.ts` 处理。
- 修改 `presentation.ts` 增加 minimal web search 警告文案；会话级 `/r minimal` 和全局 `/set codexReasoningEffort minimal` 的成功反馈都会提示 `minimal` 会禁用 web search，需要联网搜索时切到 `low` 或更高。
- 增加测试：`bridge-command-e2e` 覆盖 `/r minimal` 提示；`command-dispatch` 覆盖 `/set codexReasoningEffort minimal` 提示。
- 阶段审计：当前进入阶段审计。
- 验证结果：`npm run typecheck` 通过；定向 `node --test --import tsx src/__tests__/command-dispatch.test.ts src/__tests__/bridge-command-e2e.test.ts` 通过；完整 `npm test` 通过，543 个测试全部通过。
- 审计结论：minimal 设置提示已覆盖会话级和全局设置入口，文案不会影响非 minimal 设置。
- 阶段验证和git提交：准备 amend 到当前本地提交。
