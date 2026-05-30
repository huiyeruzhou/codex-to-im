# 默认 shell snapshot 与 tmux 环境导出

## 任务目标

原始指令：

- 你学习一下codex，给当前codex-to-im进程搞一个默认shell的snap，里面装满了declare命令，用于tmux之后的导出，避免手动传变量又麻烦又容易漏掉，当然你得看看目前使用的shell是哪个才能知道怎么导出，这部分请你直接学习codex源代码。在linux下我们知道了是用chsh里配置的那个，别的系统下，以及各个shell怎么操作，都学一下codex。

## 任务上下文

- 当前仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前时间：`2026-05-30 19:57 CST`。
- 当前主工作树存在既有 unrelated 改动：`AGENTS.md`、`work/auto/STATUS.md`、`work/develop/STATUS.md`、大量 `work/rebuild/*` 删除和 `work/rebuild/manual-audit.md`；本任务不纳入、不回滚这些改动。
- 当前本地 `master` 相对 `origin/master` 显示 ahead 8 / behind 8，这是之前为避免触碰脏工作树而通过 detached worktree rebase/push 后留下的本地主分支状态；本任务以当前工作树源码为权威，不先做 destructive 同步。

## 任务日志

### 2026-05-30 19:57 CST 阶段：研究 Codex shell 选择与当前 tmux provider

阶段描述：读取当前 tmux provider 代码和本机安装的 Codex 源码/包，确认 Codex 在不同系统下选择默认 shell 的逻辑，以及 shell-specific 环境导出应该怎样生成。

- 行动：已记录用户原始目标。
- 行动：已确认当前工作树存在 unrelated 改动，本阶段只处理本目标相关文件。
- 行动：初步发现仓库本地存在 `node_modules/@openai/codex`、`node_modules/@openai/codex-sdk` 和平台包 `node_modules/@openai/codex-linux-x64`，优先从这些本机安装源码/产物学习 Codex 行为；必要时再查上游官方仓库。
- 行动：已读取当前 `src/codex/tmux-provider.ts`。当前实现把 `process.env` 复制后，通过 `shouldForwardCodexTuiEnv()` allowlist 生成 `env KEY=value ... codex` shell command；这正是用户指出的“手动传变量又麻烦又容易漏掉”的来源。
- 行动：本机 `@openai/codex` npm 包只包含 JS wrapper 和 native binary；`package.json` 指向官方仓库 `https://github.com/openai/codex.git` 的 `codex-cli` 目录。已 shallow clone 官方源码到 `/tmp/openai-codex-source`，当前源码提交 `3e7baa0 Add thread archive CLI commands (#25021)`。
- 行动：已读取官方 Codex `codex-rs/core/src/shell.rs`。结论：Codex 的 `default_user_shell()` 在 Windows 上优先 PowerShell，否则 ultimate fallback 为 `cmd.exe`；非 Windows 先从用户 passwd/chsh shell 识别 `zsh`/`bash`/`powershell`/`sh`/`cmd`，macOS fallback 顺序为 zsh 再 bash，其他 Unix fallback 顺序为 bash 再 zsh，最终 fallback 为 `/bin/sh`。
- 行动：已读取官方 Codex `codex-rs/core/src/shell_snapshot.rs`。结论：Codex shell snapshot 生成到 `codex_home/shell_snapshots`，Posix snapshot 会捕获 functions、setopts、aliases、exports；bash 使用 `declare -xp` 枚举 exports，zsh/sh 使用各自可 source 的 export/typeset 形式；PowerShell snapshot 脚本存在但当前写入逻辑仍标注 PowerShell/Cmd snapshot not supported。
- 行动：本阶段方案：在 codex-to-im 中实现轻量 TS 版默认 shell 解析和“当前进程环境 snapshot”。snapshot 目标不是完整模拟 Codex 的 shell rc/functions，而是把 `buildCodexTuiEnv()` 得到的当前 bridge 进程环境完整写成 shell-specific export/declare 文件，再让 tmux 启动命令显式调用默认 shell source 该文件并 `exec codex ...`，去掉 env allowlist。
- 行动：已新增 `src/codex/shell-snapshot.ts`：实现 `detectCodexShellType()`、`resolveDefaultUserShell()`、`buildShellSnapshotContent()`、`ensureShellSnapshot()` 和 `buildShellSnapshotLaunchCommand()`。默认 shell fallback 规则按 Codex 源码迁移；snapshot 过滤非法变量名、排除 `PWD`/`OLDPWD`，bash 使用 `declare -x`，zsh 使用 `typeset -gx`，sh 使用 `export`，PowerShell 使用 `Set-Item Env:*`，cmd 使用 `set "KEY=value"`。
- 行动：已修改 `src/codex/tmux-provider.ts`：`buildCodexTuiShellCommand()` 不再使用 env allowlist，而是创建当前进程环境 snapshot，并返回“默认 shell `-c` source snapshot 后 `exec codex ...`”的命令。
- 行动：已修改 `src/__tests__/codex-tmux-provider.test.ts`：补 Codex-compatible 默认 shell fallback 测试、shell-specific snapshot 内容测试，并把真实 tmux 集成测试更新为 snapshot command form。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/codex-tmux-provider.test.ts`：通过，9/9。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; npm run typecheck`：通过。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/codex-tmux-provider.test.ts src/__tests__/bridge-command-e2e.test.ts`：通过，28/28。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; npm test`：通过，506/506。
- 行动：最终审计前发现跨平台路径细节：在 Linux 上直接用 `path.basename()` 解析 Windows 反斜杠路径会失败。已调整 `detectCodexShellType()` 先把 `\` 归一化为 `/`，并补 Windows PowerShell 绝对路径检测断言。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/codex-tmux-provider.test.ts && npm run typecheck`：通过，codex-tmux-provider 9/9，typecheck 通过。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; npm test`：最终代码通过，506/506。
- 行动：当前进入阶段审计。
- 阶段验证和git提交：审计结论：本阶段满足用户目标。已直接学习官方 Codex 源码并迁移默认 shell 解析规则；Linux/Unix 跟随用户 chsh/passwd shell，可识别 zsh/bash/pwsh/powershell/sh/cmd，Linux fallback bash->zsh->sh，macOS fallback zsh->bash->sh，Windows fallback PowerShell->cmd。当前 codex-to-im tmux provider 不再维护 env allowlist，而是把当前 bridge 进程环境完整写入 0600 snapshot，并按 shell 类型输出可 source 的导出命令；tmux 启动时显式用解析到的默认 shell source snapshot 后 exec codex。测试覆盖默认 shell fallback、Windows 路径识别、bash/zsh/sh/PowerShell snapshot 内容、真实 tmux 环境传递、`/p tmux` E2E、typecheck 和完整测试。已执行 `git commit -m "Snapshot tmux Codex shell environment"`，提交记录随后 amend 本状态文件；最终提交 hash 以 `git log -1` 为准。
- 下一个阶段计划：当前目标已完成；不处理 unrelated 工作树改动。
- 阶段验证和git提交：后续补强审计发现当前 bridge 命令运行时仍有遗漏，转入下一阶段继续修正。

### 2026-05-30 20:11 CST 阶段：补强 snapshot 形态审计

阶段描述：重新从当前工作树审计已提交实现和测试，确保测试证据真实覆盖“tmux 之后通过默认 shell source snapshot 导出环境”，而不是残留旧 allowlist 断言。

- 行动：续跑目标时读取当前 `STATUS.md`、`git status`、`src/codex/shell-snapshot.ts`、`src/codex/tmux-provider.ts` 和相关测试；确认本地已有提交 `19421c7 Snapshot tmux Codex shell environment`，但工作树仍有 unrelated 改动，本阶段只修改当前目标相关文件。
- 行动：重新读取官方 Codex 源码 `/tmp/openai-codex-source`，当前提交 `3e7baa0`。关键证据仍是 `codex-rs/core/src/shell.rs` 的 `default_user_shell()`、`derive_exec_args()`，以及 `codex-rs/core/src/shell_snapshot.rs` 的 bash `declare -xp`、zsh/sh export/typeset snapshot 脚本。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/codex-tmux-provider.test.ts src/__tests__/bridge-command-e2e.test.ts`：通过，28/28。但审计发现 `src/__tests__/bridge-command-e2e.test.ts` 仍有旧的 `/-- env .* codex/` 断言，证据与目标不完全一致，需要修正测试断言。
- 行动：更新 `src/__tests__/bridge-command-e2e.test.ts` 为 snapshot command 断言后，定向测试失败并显示真实 `/provider tmux` 路径仍输出旧的 `env ... codex`。进一步定位到 `src/lib/bridge/tmux/runtime.ts` 仍保留 `shouldForwardCodexTuiEnv()` allowlist；这说明先前只修改了旧 tmux provider 路径，当前 bridge 命令运行时还没有完成目标。
- 行动：已修改 `src/lib/bridge/tmux/runtime.ts`，让 `buildCodexResumeTmuxCommand()` 使用同一套 `buildCodexTuiShellCommand('codex', args, buildCodexTuiEnv())`，删除旧 allowlist 生成逻辑。已修正 E2E 断言为必须看到 `codex-to-im-shell-snapshot-*.sh` 和 `exec codex`，并明确不允许 `-- env .* codex`。
- 行动：已补 `src/codex/shell-snapshot.ts` 的目标平台 PATH 拼接：Windows 解析使用 `path.win32.join`，POSIX 使用 `path.posix.join`，避免在 Linux 测试 Windows PATH 时生成混合分隔符。同步补充单测覆盖 Windows 反斜杠 PATH 和 bash/PowerShell launch command 形态。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/codex-tmux-provider.test.ts src/__tests__/bridge-command-e2e.test.ts`：通过，29/29。该次验证确认 `/provider tmux` E2E 的 fake tmux 日志已包含 `/bin/bash -c '. /tmp/codex-to-im-shell-snapshot-*.sh; exec codex ...'`，并不再包含 `-- env .* codex`。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; npm run typecheck`：通过。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; npm test`：通过，507/507。
- 行动：搜索 `src` 中旧逻辑标识 `shouldForwardCodexTuiEnv`、`codexCommandWithEnvPreview` 和旧 `-- env .* codex` 断言；结果只剩 E2E 的 `doesNotMatch` 负向断言，没有生产代码继续使用旧 allowlist。
- 行动：当前进入阶段审计。
- 阶段验证和git提交：审计结论：本阶段补齐了先前遗漏的新桥接 tmux runtime 路径。当前证据表明两条 tmux 启动路径都通过 `buildCodexTuiShellCommand()` 创建默认 shell snapshot；当前 bridge 命令 `/provider tmux` 的 E2E 日志明确验证了 snapshot source + `exec codex`，并负向验证不再使用 `env` allowlist。跨平台补强包括 Windows PATH 分隔/拼接、Windows PowerShell 路径识别、bash/PowerShell launch command 形态。验证已覆盖定向 29/29、typecheck、完整 507/507。已执行 `git commit --amend --no-edit`，最终提交 hash 以 `git log -1` 为准。
- 下一个阶段计划：当前目标已完成；不处理 unrelated 工作树改动。
