# tmux 核心接口收紧

## 任务目标

原始指令：

- 你看刚才的修改实际上暴露出tmux这个模块没有收紧。/p tmux和/tmux-命令族都依赖tmux底层逻辑，而现在的写法是否分开了？关于tmux的核心功能应该抽象成一组接口，让应用避免裸发tmux命令行。

## 任务上下文

- 当前仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前时间：`2026-05-31 14:28 CST`。
- 上一目标提交：`bc89632 Snapshot tmux Codex shell environment`，完成默认 shell snapshot，但暴露 tmux 底层逻辑仍分散。
- 当前工作树存在既有 unrelated 改动：`AGENTS.md`、`work/auto/STATUS.md`、`work/develop/STATUS.md`、大量 `work/rebuild/*` 删除和 `work/rebuild/manual-audit.md`；本目标不回滚、不纳入。
- 本目标要求：收紧 tmux 模块边界，抽象 tmux 核心功能为一组接口，让 `/p tmux` 和 `/tmux-*` 命令族依赖接口而不是应用层裸发 tmux 命令行。

## 任务日志

### 2026-05-31 14:28 CST 阶段：审计 tmux 调用边界并收敛接口

阶段描述：读取当前 tmux runtime、命令族和 provider 调用，确认裸 tmux 命令构造分布，再设计最小但完整的核心接口。

- 行动：已记录用户新目标，并确认本阶段必须覆盖 `/p tmux` 和 `/tmux-` 命令族，不只处理上一轮 shell snapshot 路径。
- 行动：审计发现当前 `/p tmux` 经 `src/lib/bridge/command/runtime-settings.ts` 调用 `src/lib/bridge/tmux/runtime.ts`；`/tmux-*` 命令族在 `src/lib/bridge/command/tmux.ts` 中虽复用部分 runtime 函数，但仍直接构造 `send-keys`、`capture-pane`、`has-session`、`new-session` 等 argv，并直接调用 `runTmux()`。旧 `src/codex/tmux-provider.ts` 还保留另一套 legacy tmux TUI provider 执行逻辑。
- 行动：已在 `src/lib/bridge/tmux/runtime.ts` 中新增 `TmuxCore` 接口和默认 `tmuxCore` 实现，接口包括 `hasSession()`、`listSessions()`、`ensureDetachedSession()`、`capturePane()`、`sendActions()`、`sendInterrupt()`、`startCodexResumeSession()`，由接口返回 command preview，避免上层为了展示真实命令而自行拼 argv。
- 行动：已更新 `src/lib/bridge/command/tmux.ts`：命令族改为调用 `tmuxCore` 的语义方法；删除命令层的 `tmuxSendActionArgv()`、`sendTmuxActions()`、`captureTmuxPane()` 以及对 `runTmux()`/`captureTmuxArgv()`/`tmuxCommandPreview()` 的直接依赖。`/tmux-switch`、`/tmux-screen`、`/tmux-attach`、`/tmux-new` 和 `/tmux ...` 均从接口结果获取命令预览。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; npm run typecheck`：通过。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/command-dispatch.test.ts src/__tests__/bridge-command-e2e.test.ts src/__tests__/codex-tmux-provider.test.ts`：通过，50/50，覆盖 `/provider tmux`、`/tmux-*` 命令族和 legacy Codex TUI tmux provider。
- 行动：为避免 `src/codex/tmux-provider.ts` 继续保留一套平行 tmux 执行逻辑，已将 tmux 低层 CLI 抽到 `src/lib/bridge/tmux/core.ts`，其中定义 `TmuxCore`、默认 `tmuxCore`、session/list/capture/send/kill/inject prompt/replace detached session 等接口；`src/lib/bridge/tmux/runtime.ts` 只保留 Codex resume tmux session 的领域组合逻辑。
- 行动：已更新 legacy `src/codex/tmux-provider.ts`：移除本地 `spawn`/`runTmux`/`hasTmuxSession`/`killTmuxSession`/prompt 逐命令实现，改用 `tmuxCore.injectPromptIntoPane()`、`replaceDetachedSession()`、`hasSession()`、`killSession()`。这使 `/p tmux`、`/tmux-*` 和 legacy env-switch TUI provider 均共用同一 tmux 核心接口。
- 行动：再次搜索 `src/lib/bridge` 和 `src/codex` 中的裸 tmux argv/`runTmux`/`runCommand('tmux')`，结果显示底层命令构造集中在 `src/lib/bridge/tmux/core.ts`，`src/lib/bridge/tmux/runtime.ts` 仅为 Codex resume 命令组合保留 `new-session` argv 预览构造，命令应用层和 legacy provider 不再裸发 tmux 命令行。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; npm run typecheck`：通过。
- 行动：重新验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/command-dispatch.test.ts src/__tests__/bridge-command-e2e.test.ts src/__tests__/codex-tmux-provider.test.ts`：通过，50/50。
- 行动：最终边界搜索：`src/lib/bridge/command` 和 `src/codex` 中不再有裸 `send-keys`/`capture-pane`/`new-session`/`has-session`/`kill-session` argv、`runTmux` 或 `runCommand('tmux')`；这些低层命令集中在 `src/lib/bridge/tmux/core.ts`。`src/lib/bridge/tmux/runtime.ts` 保留 `buildCodexResumeTmuxCommand()` 的 `new-session` argv 组装用于 Codex resume session 领域组合/预览，不属于命令应用层裸发。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; npm test`：通过，507/507。
- 行动：当前进入阶段审计。
- 阶段验证和git提交：审计结论：本阶段满足目标。`/p tmux` 的 provider 切换路径经 `src/lib/bridge/tmux/runtime.ts` 调用 `TmuxCore.replaceDetachedSession()`；`/tmux-*` 命令族经 `src/lib/bridge/command/tmux.ts` 调用 `tmuxCore.listSessions()`、`hasSession()`、`ensureDetachedSession()`、`capturePane()`、`sendActions()`；legacy `src/codex/tmux-provider.ts` 也复用 `tmuxCore`。应用层不再裸发 tmux CLI，底层 argv/spawn 集中在 `src/lib/bridge/tmux/core.ts`。验证覆盖 typecheck、定向 50/50 和完整 507/507。已执行 `git commit -m "Abstract tmux core operations"`，提交记录随后 amend 本状态文件；最终提交 hash 以 `git log -1` 为准。
- 下一个阶段计划：当前目标已完成；不处理 unrelated 工作树改动。
