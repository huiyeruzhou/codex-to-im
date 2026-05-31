## 任务目标

原始指令：`/t和表格也支持归档命令。完成后commit一下，然后开发一个/shell命令，做好危险命令审计，必要时提醒用户，包括rm等高风险操作，单独的'/'（很有可能是绝对路径打出了空格），或者我记得codex是有自己的sandbox的，看看能不能用那个执行命令，并且强制即使是yolo mode下也要用sandbox？`

## 任务上下文

- 仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前工作树已有与本任务无关的改动：`AGENTS.md`、`work/auto/STATUS.md`、`work/bridge-started-card/STATUS.md`、大量 `work/rebuild/*` 删除、`work/rebuild/manual-audit.md`、`work/tmux-feishu-parse-optimization/STATUS.md`；本任务不能回退或纳入这些改动。
- 当前环境 `rg` 不可用，检索使用 `find`/`grep`。
- 已有提交 `6566649 Add /t archive for Codex sessions` 实现 `/t archive` 纯文本命令：支持当前线程归档、按全局 `/t` 列表序号归档、解绑/清理 linked BridgeSession，并已有 command-dispatch 测试。
- 当前 `/t` 全局 Codex 会话卡片已经有“绑定/解绑/激活/新建/刷新”按钮，footer 提到 `/t archive 1`，但动作按钮和回调解析还不支持 `archive`。
- 当前 `command-callbacks.ts` 的 `buildThreadActionCallbackData()` 只允许 `bind|rm|use`；`bridge-manager.ts` 的 `parseThreadSelectActionCallback()` 和回调命令生成也只允许 `bind|rm|use`。
- 当前 `/t ls` 绑定表选择值是 binding id；如果绑定表要支持归档所选绑定背后的 Codex thread，需要 `/t archive <binding-id>` 能解析到该 binding 的 `codex_thread_id`，或回调层把 binding id 转成 thread id。
- 官方 Codex 文档确认 Codex local/CLI 有 sandbox 概念，`workspace-write` 是默认/推荐的受限写模式，`danger-full-access` 会移除本地 sandbox 限制且只应在受控环境使用；这支持 `/shell` 需要强制受限 sandbox、不能沿用 yolo 的危险全权模式。

## 任务日志

### 2026-05-31 21:38 CST 阶段：审计 `/t archive` 表格支持现状

阶段描述：基于当前工作树确认 `/t archive` 纯文本命令已存在，定位表格/卡片缺口。

- 行动：检查 `git status` 和最近提交，确认 HEAD 为 `6d2ed2b Update /his history command defaults`，其父提交中已有 `Add /t archive for Codex sessions`；工作树仍有多处 unrelated 改动。
- 行动：检查 `src/lib/bridge/command/session-thread.ts`，确认 `/t archive` 分支已实现，且不做 active task 阻断；归档后调用 registry archive、`onBindingRemoved` 和 mirror reconcile。
- 行动：检查 `src/lib/bridge/command/presentation.ts`、`src/lib/bridge/command-callbacks.ts`、`src/lib/bridge/bridge-manager.ts`，确认卡片/表格目前只有 `bind/rm/use` 交互按钮，尚无 `archive` action。
- 行动：检查测试，确认已有 `/t archive` alias、当前归档、按全局列表序号归档测试；尚缺卡片 archive action、回调 archive action、绑定表所选绑定归档测试。
- 下一个阶段计划：补全卡片 action 类型、全局/绑定表归档按钮与回调命令生成；必要时增强 `/t archive <binding-id>` 解析；补测试后提交一个归档表格支持阶段。

### 2026-05-31 21:42 CST 阶段：补齐 `/t` 表格归档动作并提交

阶段描述：让 `/t` 全局表和 `/t ls` 绑定表都能通过卡片按钮归档所选 Codex thread，并验证不会破坏已有切换/解绑行为。

- 行动：修改 `src/lib/bridge/command-callbacks.ts`，把 thread card action 类型从 `bind|rm|use` 扩展为 `bind|rm|use|archive`。
- 行动：修改 `src/lib/bridge/command/presentation.ts`，在全局 Codex 会话卡片和当前聊天绑定卡片中增加“归档”危险按钮；保留原有绑定、解绑、激活、刷新按钮。
- 行动：修改 `src/lib/bridge/bridge-manager.ts`，让 `cti-thread-action:*:archive` 回调合法，并把全局表归档回调转成 `/t archive <thread-id>`，绑定表归档回调转成 `/t archive <binding-id>`。
- 行动：修改 `src/lib/bridge/command/session-thread.ts`，让 `/t archive <binding-id>` 解析当前聊天绑定表，找到 binding 背后的 Codex thread 后复用既有 archive 流程；纯数字仍优先按 `/t` 全局列表序号解析，保持 `/t archive 1` 的既有语义。
- 行动：补充测试：
  - `src/__tests__/bridge-command-e2e.test.ts` 覆盖 `/t` rich card 选择会话后点击“归档”，确认 JSONL 被移走、聊天未绑定、卡片更新原消息。
  - `src/__tests__/command-dispatch.test.ts` 覆盖 `/t archive <binding-id>` 可以归档绑定背后的 Codex thread。
  - `src/__tests__/bridge-manager.test.ts` / 既有 command-dispatch 断言更新，确认表格动作中包含“归档”。
- 行动：首次定向测试发现既有绑定表按钮期望未包含“归档”，以及测试对标题的断言与现有 display title 规则不一致；已按产品实际行为修正测试。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/bridge-manager.test.ts src/__tests__/command-dispatch.test.ts src/__tests__/bridge-command-e2e.test.ts`，结果 122 个测试全部通过。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`，通过。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`，通过。
- 阶段验证和git提交：当前进入阶段审计。
- 阶段审计：
  - 需求“`/t` 支持归档命令”：已有纯文本 `/t archive`，本阶段额外保持 `/t archive <binding-id>` 可用；数字序号仍走全局 `/t` 列表，未改变既有语义。
  - 需求“表格也支持归档命令”：全局 `/t` 卡片和绑定 `/t ls` 卡片都增加“归档”按钮；回调解析允许 `archive`；全局表按所选 thread id 归档，绑定表按所选 binding id 归档其 Codex thread。
  - 风险审计：绑定表中非 Codex thread 归档会返回“不是本地 Codex 会话，不能归档”，避免误把普通 IM 绑定当 Codex session 处理。
  - 验证覆盖：卡片按钮生成、回调归档、binding id 归档、原有绑定/切换/解绑流程均被定向测试覆盖；typecheck/build 通过。
- 阶段结论：归档命令和表格归档支持完成。
- 阶段验证和git提交：已创建本地提交 `Add thread archive card action`；随后将本提交记录 amend 进同一阶段提交。
- 下一个阶段计划：amend 状态记录后进入 `/shell` 命令设计与实现阶段。

### 2026-05-31 21:47 CST 阶段：实现 `/shell` Codex sandbox 执行与危险命令审计

阶段描述：新增 `/shell` 命令，通过 Codex CLI sandbox 执行当前会话目录下的 shell 命令，并在执行前审计高风险输入。

- 行动：本机执行 `codex exec --help`，确认 Codex CLI 支持 `--sandbox read-only|workspace-write|danger-full-access`、`--cd <DIR>`、`--skip-git-repo-check`、`--ephemeral`、`--config approval_policy=...` 等参数；这可用于 `/shell` 调用受限 sandbox，且不需要沿用当前 IM 会话的 yolo/danger 模式。
- 行动：官方 OpenAI 文档取证：Codex local/CLI 的 sandbox 是本地命令执行边界；`workspace-write` 是默认/推荐受限写模式，`danger-full-access` 会移除本地 sandbox 限制，只适合外部隔离的受控环境。因此 `/shell` 不允许 `danger-full-access`。
- 行动：新增 `src/lib/bridge/command/shell.ts`：
  - 解析 `/shell [--sandbox read-only|workspace-write] [--force] <command>`。
  - 默认强制 `workspace-write` sandbox，只允许显式降到 `read-only`，拒绝 `danger-full-access`。
  - 默认 runner 使用 `execFile('codex', ['exec', '--sandbox', sandbox, '--cd', cwd, '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--config', 'approval_policy="never"', prompt])`，不通过 shell 拼接参数，避免本地注入。
  - prompt 明确要求 Codex 只运行用户给定命令一次，并返回 exit code/stdout/stderr；真实执行仍由 Codex CLI sandbox 约束。
  - 输出用 `sanitizeInput` 限长清理，避免 IM 输出过长或控制字符污染。
- 行动：危险命令审计：
  - 空命令、null byte、过长命令、命令开头为单独 `/` 或 `/ ` 直接拒绝，提示这通常是绝对路径被空格拆开。
  - `rm`、`find ... -delete`、`git clean`、`dd of=...`、`mkfs/wipefs/shred/truncate`、`shutdown/reboot/halt/poweroff`、`docker system prune`、`chmod -R 777 /...`、`chown -R` 等高风险操作先提示风险并要求追加 `--force`。
  - 即使 `--force`，命令仍通过 Codex sandbox 执行，不会切到 yolo 的 `danger-full-access`。
- 行动：修改 `src/lib/bridge/command/dispatch.ts`，加入 `/shell` 分支和可注入 `shellRunner` 测试口；对 `/shell` 跳过原有通用 injection 拦截，只保留 null byte/超长硬拒绝，让 `/shell` 自己返回更具体的审计提示。
- 行动：修改 `src/lib/bridge/command/aliases.ts`，将 `/shell` 加入已知命令。
- 行动：同步文档和 UI：`src/lib/bridge/command/help.ts`、`src/ui/shell.ts`、`README.md`、`README_EN.md` 说明 `/shell` 的 Codex sandbox、`--sandbox read-only` 和高风险 `--force` 规则。
- 行动：补充 `src/__tests__/command-dispatch.test.ts`：
  - 覆盖当前绑定处于 yolo 且 session sandbox 为 `danger-full-access` 时，`/shell echo ok` 仍以 `workspace-write` 调用 runner。
  - 覆盖 `/shell rm -rf dist` 不带 `--force` 不执行 runner 并提示确认。
  - 覆盖 `/shell / tmp` 直接拒绝并提示绝对路径空格风险。
  - 覆盖 `/shell --sandbox danger-full-access ...` 直接拒绝。
  - 覆盖 `/shell --force rm -rf dist` 会执行 runner，并在响应中记录已确认高风险。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/command-dispatch.test.ts`，31 个测试全部通过。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`，通过。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`，通过。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`，526 个测试全部通过。
- 阶段验证和git提交：当前进入阶段审计。
- 阶段审计：
  - 需求“开发 `/shell` 命令”：已加入 command alias/dispatch/help/UI/README，命令需要当前绑定会话目录，避免无上下文执行。
  - 需求“做好危险命令审计，必要时提醒用户，包括 rm 等高风险操作”：高风险模式不直接执行，返回 `/shell 需要确认` 并要求 `--force`；`--force` 响应仍记录“已确认高风险操作”。
  - 需求“单独的 `/` 很可能是绝对路径打出了空格”：命令等于 `/` 或以 `/ ` 开头直接拒绝，并提示检查路径。
  - 需求“看看能不能用 Codex sandbox 执行命令”：本机 `codex exec --help` 和官方文档均确认 Codex CLI sandbox 参数可用；实现默认通过 `codex exec --sandbox workspace-write --cd <cwd> --ephemeral` 执行。
  - 需求“强制即使 yolo mode 下也要用 sandbox”：`/shell` 不读取当前 session 的 yolo/danger 设置，默认 `workspace-write`，只允许 `read-only` 和 `workspace-write`，拒绝 `danger-full-access`；测试覆盖 yolo + session `danger-full-access` 下仍传 `workspace-write`。
  - 安全边界：本地调用 `codex` 使用 `execFile` 参数数组，不通过本地 shell 拼接；通用 command injection 拦截对 `/shell` 只保留 null byte/超长硬拒绝，具体危险语义由 `/shell` 自己提示。
  - 验证覆盖：定向 command-dispatch、typecheck、build、完整 npm test 均通过。
- 阶段结论：`/shell` 阶段满足当前目标。
- 阶段验证和git提交：已创建并 amend 本地提交 `Add sandboxed shell command`；最终哈希以 `git log -1` 为准，避免在状态文件中固定会随 amend 改变的哈希。
- 最终完成审计：
  - `/t` 支持归档命令：由既有 `/t archive` 实现和本任务补充的 `/t archive <binding-id>` 证明；测试覆盖当前归档、全局序号归档、binding id 归档。
  - 表格支持归档命令：全局 `/t` 卡片和 `/t ls` 绑定卡片均有“归档”按钮；回调动作 `archive` 已接入；E2E 覆盖从 `/t` rich card 选择并点击“归档”。
  - “完成后 commit 一下”：归档表格阶段已提交 `ab6d792 Add thread archive card action`。
  - `/shell` 命令：已实现、接入 dispatch、help、UI、README；完整回归测试通过。
  - 危险命令审计：高风险命令要求 `--force`，单独 `/` 直接拒绝，`danger-full-access` sandbox 直接拒绝。
  - Codex sandbox：执行路径使用 `codex exec --sandbox read-only|workspace-write`，默认 `workspace-write`，不沿用 yolo/danger；测试覆盖 yolo 下仍强制 sandbox。
  - “完成后 commit”：`/shell` 阶段已提交 `Add sandboxed shell command`。
- 下一个阶段计划：无；目标完成。

### 2026-05-31 22:?? CST 阶段：答疑 `/shell` 当前执行路径

阶段描述：回答用户“现在 `/shell` 命令是怎么执行的？”的问题，只做源码阅读和说明，不修改业务代码。

- 行动：读取 `src/lib/bridge/command/shell.ts`、`src/lib/bridge/command/dispatch.ts`、`src/__tests__/command-dispatch.test.ts`、help/README 相关片段，确认当前 `/shell` 执行路径。
- 结论：`/shell` 由 command dispatch 传入当前绑定的工作目录，先解析 `--sandbox`/`--force` 和命令正文，执行危险命令审计；通过审计后默认使用 `execFile('codex', ['exec', '--sandbox', sandbox, '--cd', cwd, '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--config', 'approval_policy="never"', prompt])` 调起 Codex CLI，而不是直接把用户命令交给本地 shell。

### 2026-05-31 22:28 CST 阶段：改为直接执行用户 shell 命令

阶段描述：按用户纠偏移除 `/shell` 的 `codex exec` 执行路径，改为直接在当前绑定会话目录执行用户原始命令。

- 用户纠偏：`这个太蠢了，/shell必须直接走用户命令，别让codex exec了。。。`
- 用户再次纠偏：`你应该用的是`codex sandbox`而不是`codex exec``。
- 当前计划：
  - 将默认 runner 从 `codex exec <prompt>` 改为 `codex sandbox --permissions-profile :workspace|:read-only --cd <cwd> <shell> -lc <command>`。
  - 用户命令不再进入 Codex prompt，不再由模型解释；命令字符串直接交给 shell 执行，但外层仍由 Codex sandbox 承载。
  - 保留 `/shell --sandbox read-only|workspace-write`，分别映射到 `:read-only` 和 `:workspace`；继续拒绝 `danger-full-access`。
  - 同步 help、README、UI 命令说明和 command-dispatch 测试。
  - 验证定向测试、typecheck、build；完成后本地 commit，不 push。
- 行动：
  - 本地执行 `codex sandbox --help`，确认子命令用于在 Codex-provided sandbox 中运行命令，参数形态为 `codex sandbox --permissions-profile <NAME> --cd <DIR> <COMMAND>...`。
  - 本地验证 `codex sandbox --permissions-profile :workspace --cd <repo> bash -lc 'printf ok'` 和 `:read-only` 均可运行；未指定 `--permissions-profile` 会报缺少必填参数。
  - 已将 `src/lib/bridge/command/shell.ts` 调整为 `execFile('codex', ['sandbox', '--permissions-profile', profile, '--cd', cwd, shell, '-lc', command])`。
- 行动：
  - 更新 `src/__tests__/command-dispatch.test.ts`，用 fake `codex` 二进制锁定默认 runner 调用 argv 为 `codex sandbox --permissions-profile :read-only --cd <cwd> /bin/bash -lc <command>`，避免回退到 `codex exec` 或裸 shell。
  - 同步 `src/lib/bridge/command/help.ts`、`src/ui/shell.ts`、`README.md`、`README_EN.md`，说明 `/shell` 通过 `codex sandbox` 直接执行命令。
- 阶段验证：
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/command-dispatch.test.ts`：通过，32 tests。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`：通过。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`：通过。
  - `git diff --check -- src/lib/bridge/command/shell.ts src/__tests__/command-dispatch.test.ts src/lib/bridge/command/help.ts src/ui/shell.ts README.md README_EN.md work/shell-safe-command/STATUS.md`：通过。
- 当前进入阶段审计：
  - `/shell` 不再使用 `codex exec` 和 prompt；用户命令直接作为 shell `-lc` 参数运行。
  - 执行仍由 `codex sandbox` 承载；默认 `workspace-write` 映射到 `:workspace`，`read-only` 映射到 `:read-only`，继续拒绝 `danger-full-access`。
  - 高风险命令审计、`--force` 二次确认、单独 `/` 拒绝逻辑保留。
  - 当前工作树仍有用户/既有无关改动 `AGENTS.md`，本阶段不会暂存或回滚。
- 用户纠偏：
  - 2026-05-31 22:?? CST 用户指出不能把“写不存在目录失败”当作 sandbox 写权限边界测试，要求先思考清楚 `codex sandbox` 如何定义写入权限。
- 反思：
  - 刚才真实功能测试覆盖了 `/shell ls` 和当前目录 `echo > temp.txt`，但第三项“非法目录”只证明 shell 对不存在目录返回失败，不能证明 `codex sandbox` 拒绝 workspace 外写入。
  - 需要重新确认 `:workspace` / `:read-only` profile 的写入范围，尤其是否允许 `/tmp`、当前工作区、额外可写目录或配置中的权限 profile。
- 权限模型确认：
  - 官方文档说明 permission profile 的 workspace roots 与 filesystem rules 决定每个有效 workspace root 内的权限；旧式 `sandbox_mode` / `sandbox_workspace_write` 也有 writable roots 概念。
  - 本机 `codex sandbox --help` 显示当前 CLI 需要 `--permissions-profile <NAME>`；内置 profile `:workspace` / `:read-only` 可用。
  - 本机实验：`:read-only` 下工作目录内 `echo > in.txt` 失败；`:workspace` 下工作目录内写入成功。
  - 本机实验：`:workspace` 下写 `/tmp/...` 成功，因此 `/tmp` 不是合适的“非法目录”测试目标。
  - 本机实验：`:workspace` 下写 `/data00/home/hongli.fish/.cti-sandbox-outside-*` 和 `/etc/...` 失败，报 `Read-only file system`；因此真实测试应选择 workspace root 之外且非 `/tmp` 的 home 临时目录。
- 测试调整：
  - 删除 fake `codex` argv 测试，改为从 `/shell` command dispatch 入口跑真实功能：`/shell ls`、`/shell echo shell-ok > temp.txt`、`/shell echo nope > <home 下 workspace 外临时目录>/blocked.txt`。
- 阶段验证：
  - 首次真实测试用 `/tmp` 作为 workspace 外写入目标，结果写入成功；据此确认 `/tmp` 在当前 `codex sandbox :workspace` 下不是非法写入目标。
  - 改用 `os.homedir()` 下、当前 workspace root 外的临时目录作为非法写入目标后，`/shell echo nope > <outside>/blocked.txt` 返回非零退出码且文件不存在。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --test-concurrency=1 --import tsx --test-timeout=30000 src/__tests__/command-dispatch.test.ts`：通过，32 tests。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`：通过。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`：通过。
  - `git diff --check -- src/lib/bridge/command/shell.ts src/__tests__/command-dispatch.test.ts src/lib/bridge/command/help.ts src/ui/shell.ts README.md README_EN.md work/shell-safe-command/STATUS.md`：通过。
- 阶段审计：
  - `/shell` 当前执行路径符合用户纠偏：不使用 `codex exec`，不把命令交给模型 prompt；直接通过 `codex sandbox` 调用用户 shell 执行原始命令。
  - 测试覆盖用户指定三类场景：直接 `ls`、当前目录 `echo > temp.txt`、写 workspace 外非法目录失败。
  - 当前工作树仍有无关 `AGENTS.md` 改动；本阶段提交时不暂存该文件。

### 2026-05-31 22:?? CST 阶段：排查 npm test 中 Codex CLI sandbox 参数差异

阶段描述：完整 `npm test` 失败后，排查为什么测试环境下 `codex sandbox` CLI 形态与交互环境不同。

- 失败现象：
  - 完整 `npm test` 中 `/shell ls` 返回退出码 2，stderr 显示 `error: unexpected argument '--permissions-profile' found`，usage 为 `codex sandbox [OPTIONS] <COMMAND>`。
  - 直接在当前 shell 执行全局 `codex sandbox --help` 时，usage 支持 `--permissions-profile <NAME>`。
- 排查结论：
  - `scripts/run-tests.js` 由 `npm test` 启动；npm script 会把项目 `node_modules/.bin` 放到 `PATH` 前面。
  - 项目依赖里的 `node_modules/@openai/codex-linux-x64/.../codex` 是 `codex-cli 0.130.0`；全局 `/home/hongli.fish/.local/bin/codex` 是 `codex-cli 0.135.0`。
  - 0.130.0 的顶层 `codex sandbox` 不接受 `--permissions-profile`，但 `codex sandbox linux --permissions-profile :workspace --cd <dir> ...` 可用。
  - 0.135.0 的顶层 `codex sandbox --permissions-profile :workspace --cd <dir> ...` 可用，但 `codex sandbox linux ...` 会把 `linux` 当成被执行命令并失败。
- 修复计划：
  - `/shell` 默认先走新版 argv：`codex sandbox --permissions-profile ... --cd ... <shell> -lc <command>`。
  - 如果 stderr/message 命中 `unexpected argument '--permissions-profile'`，说明命中旧版 CLI，则自动重试旧版 Linux 子命令 argv：`codex sandbox linux --permissions-profile ... --cd ... <shell> -lc <command>`。
  - 重新运行定向测试、typecheck、build、完整 `npm test`，通过后 amend 并 push。
- 执行记录：
  - 已实现新版/旧版 CLI fallback：默认调用 `codex sandbox --permissions-profile ...`，遇到旧版顶层参数错误后重试 `codex sandbox linux --permissions-profile ...`。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm exec -- node --test --test-concurrency=1 --import tsx --test-timeout=30000 src/__tests__/command-dispatch.test.ts`：通过，32 tests；该命令使用 npm PATH，可复现项目依赖旧版 Codex CLI 环境。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`：通过。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`：通过。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`：通过，527 tests。
  - 检查并清理了本阶段产生的 home、`/tmp` 与仓库内临时目录残留。
- 当前阶段审计：
  - CLI 差异原因已确认：npm PATH 优先命中项目依赖 `@openai/codex` 0.130.0，全局 shell 命中 0.135.0。
  - `/shell` 兼容两种 CLI 形态，真实功能测试在 npm PATH 环境和完整测试中均通过。
  - 当前仍有无关 `AGENTS.md` 本地改动；提交时不纳入。
