## 任务目标

原始指令：

```text
现在你来审计一下openai从0.130.0到0.135.0的changelog，给我讲讲有什么重要新特性和api变化？特别是对sessions下jsonl的写入发生的变化，新的slash命令，还有新的cli命令这些
```

## 任务上下文

- 当前仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前时间：`2026-05-31 22:46 CST`。
- 当前工作树已有无关未提交改动：`AGENTS.md`、`work/shell-safe-command/STATUS.md`；本任务不回滚这些改动。
- 本机全局 `codex` 为 `0.135.0`；项目依赖里的 `@openai/codex` 为 `0.130.0`，由 `@openai/codex-sdk@0.130.0` 间接带入。
- 本任务需要同时使用官方文档/发布信息和本机版本对比；OpenAI docs MCP 工具在当前工具列表中不可用，因此会使用官方 OpenAI 文档、npm 包和本地 CLI 行为作为证据。
- 2026-05-31 22:48 CST 继续审计时确认：`rg` 在当前 shell 不可用；改用 `find`/`grep`/`sed` 收集本地证据。
- 当前工作树已有本任务目录 `work/codex-changelog-audit/` 未跟踪；继续复用该目录维护本任务状态。

## 任务日志

### 2026-05-31 22:46 CST 阶段：收集 Codex 0.130.0 到 0.135.0 变更证据

阶段描述：建立审计工作区，收集版本差异来源，重点定位 session JSONL、slash 命令和 CLI 命令变化。

- 当前计划：
  - 收集官方 OpenAI Codex CLI/permissions/docs 和 npm/GitHub release 信息。
  - 下载或检查 `@openai/codex` / `@openai/codex-sdk` 0.130.0 与 0.135.0 包内容。
  - 对比 `codex --help`、`codex sandbox --help`、slash command 文档和 session JSONL 样例/解析逻辑。
  - 输出中文审计结论，明确哪些是确认变化、哪些只是推断或需要继续查证。

### 2026-05-31 22:48 CST 阶段：继续收集并交叉验证版本差异

阶段描述：从本地 npm 包、全局 CLI 和官方发布源继续收集 0.130.0 到 0.135.0 的证据，形成面向 Codex-to-IM 兼容性的审计结论。

- 行动：读取既有 `STATUS.md`，确认任务目标、已有事实和无关工作树改动；本阶段不会回滚 `AGENTS.md` 或 `work/shell-safe-command/STATUS.md` 的未提交改动。
- 行动：列出仓库内与 Codex session/jsonl/CLI 相关的源码位置，后续重点对照 `src/codex/session-index/*.ts`、`src/codex/session-mirror.ts`、`src/cli.ts` 与 `node_modules/@openai/codex*`。
- 行动：通过官方 OpenAI Codex changelog、GitHub release 搜索结果、OpenAI CLI docs 搜索结果、npm 包信息、本地 0.130.0/0.135.0 CLI help、`~/.codex/sessions` 样本交叉验证版本变化。GitHub API/`git ls-remote` 在当前网络下失败或超时，因此没有依赖它作为唯一证据。
- 行动：确认 npm 事实：`@openai/codex@0.130.0` 和 `@openai/codex@0.135.0` 都存在；Linux 平台包实际通过 alias 版本 `@openai/codex@<version>-linux-x64` 分发。0.135.0 平台包布局从 `vendor/<triple>/codex/codex`、`path/rg` 变为 `vendor/<triple>/bin/codex`、`codex-path/rg`，并新增 `codex-package.json` 与 `codex-resources/zsh/bin/zsh`；主入口 `bin/codex.js` 兼容新旧两种布局，并设置 `CODEX_MANAGED_PACKAGE_ROOT`。
- 行动：CLI help 对比确认：
  - 0.135.0 顶层新增 `doctor`；0.130.0 下执行 `codex doctor --help` 会退回顶层 help。
  - 0.135.0 的 `remote-control` 从“start headless app-server”变为“manage app-server daemon”，新增 `start`/`stop` 子命令和 `--json` 输出。
  - 0.135.0 的 `plugin` 从只有 `marketplace` 扩展到 `add`、`list`、`marketplace`、`remove`。
  - 0.135.0 的 `app-server` 新增 `daemon` 子命令，并在 app-server 参数中支持 `--strict-config`。
  - 0.135.0 的 Linux `sandbox` 入口从平台子命令式 `sandbox linux ...` 等，变成可直接接收 `[COMMAND]...`，并新增 `--permissions-profile`、`--profile`、`--cd`、`--include-managed-config`。
  - 0.135.0 顶层/交互相关参数新增或扩展：`--strict-config`、`--dangerously-bypass-hook-trust`；`--remote` 支持从 `ws://`/`wss://` 扩展到 `unix://`/`unix://PATH`；`--profile` 帮助文案从 config.toml 内 profile 改成加载 `$CODEX_HOME/<name>.config.toml`。
- 行动：session JSONL 样本确认：
  - 0.130.0 与 0.135.0 都使用 `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl`，行类型包括 `session_meta`、`turn_context`、`response_item`、`event_msg`，长上下文还会出现 `compacted`。
  - 0.130.0 样本已有 `session_meta.payload.base_instructions`，`turn_context.payload.truncation_policy`，以及 `response_item`/`event_msg` 双轨记录；因此 0.130.0 到 0.135.0 不是“从纯聊天 history 变成 JSONL event log”的变化。
  - 0.134.0/0.135.0 TUI 样本在 `session_meta` 中可见 `thread_source`、`git`，0.135.0 SDK/exec 样本也可见 `git`；这意味着读取器不要把 `session_meta.payload` 当成固定字段集合。
  - 0.133.0 目标模式默认开启后，0.134.0/0.135.0 样本中出现大量 `event_msg.payload.type === "thread_goal_updated"`；0.130.0 的旧 SDK 样本没有该事件，但后续 0.130.0 SDK/exec 文件也可能因为运行时/桥接场景写出更新字段，所以兼容策略应按事件类型而非 CLI 版本判断。
  - 0.135.0 当前样本 `turn_context` 可包含 `user_instructions`；早期 0.130.0 样本没有。读取器应忽略不需要的大字段，避免把 system/developer/user instruction 全量展示为普通对话。
- 行动：官方 release/docs 搜索结果确认重点新特性：
  - 0.131.0：Python SDK 迁移到 `openai-codex` / `openai_codex`；新增初版 `codex doctor`；TUI 增强状态/mention/插件等操作。
  - 0.132.0：Python SDK auth 增强；`codex exec resume` 支持 `--output-schema`；TUI 启动性能提升。
  - 0.133.0：Goals 默认开启；`codex remote-control` 变成前台式管理命令；permission profile、plugin discovery、extension lifecycle 继续扩展。
  - 0.134.0：本地 conversation history 搜索；`--profile` 标准化为独立 profile 文件，旧 `[profiles.*]` 配置被拒绝/迁移；MCP env/OAuth/read-only tool 并发；hook/extension 上下文增强。
  - 0.135.0：`codex doctor` 报告更丰富；`/status` 在远程 TUI 连接时展示 remote connection/server version；Vim/text-object、`/permissions` named profiles、TUI Markdown 表格和列表渲染改进；Python SDK 提供 Sandbox presets。
- 当前进入阶段审计：本阶段目标是提供审计结论，不修改项目运行代码；验证方式为官方 changelog/docs 搜索结果、npm registry、0.130/0.135 本地 CLI help、session JSONL 样本解析。
- 阶段验证：
  - 已验证 `codex --version` 为全局 `0.135.0`；`npx -p @openai/codex@0.130.0 codex --version` 为 `0.130.0`。
  - 已验证 0.130.0/0.135.0 的顶层 help、`exec`、`resume`、`doctor`、`remote-control`、`plugin`、`app-server`、`sandbox` help 差异。
  - 已验证 `~/.codex/sessions` 中存在 0.130.0、0.134.0、0.135.0 样本，并统计 line type / payload type。
  - 未运行项目测试，因为本阶段没有修改项目代码；本任务输出是审计结论。
- 阶段审计结论：用户要求的三个重点已经覆盖：sessions JSONL 写入变化、slash 命令变化、CLI 命令/API 变化。需要在最终回复中区分“官方确认”“本机实测”“兼容性推断”。
- 阶段验证和git提交：已提交本任务 `STATUS.md`，提交主题为 `Audit Codex changelog changes`；不会提交临时 npm tarball/解包内容，已删除 `work/codex-changelog-audit/npm`。
- 下一个阶段计划：向用户输出中文审计总结，包含重要新特性、API/命令变化、对 Codex-to-IM 的兼容建议和证据来源。
