## 任务目标

原始指令：

```text
你兼容一下新旧两种codex的写法，并且标注一下这是新特性，用codex --help看看。。。然后不要显示覆盖了好可怕啊。。。。
```

用户追加指令：

```text
另外，你的/shell命令现在能ping通本地了嘛？
```

用户追加指令：

```text
好的，完成实现之后push一下并且告诉我你是怎么实现的
```

用户追加指令：

```text
最后我想到一点，/shell应该返回的是一个流式卡片，并且应该类似/tmux-screen一样，不断更新。这个更新频率也是一个命令，/shell <cmd>或者/shell <数字> <cmd>，这样，最少5s一次。
```

## 任务上下文

- 当前仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前时间：`2026-05-31 23:16 CST`。
- 需遵守仓库要求：长期任务状态落在 `work/<goalname>/STATUS.md`；Node.js 命令前使用 Node.js 24；阶段完成后本地提交。
- 当前已知工作树存在无关未提交改动：`AGENTS.md`、`work/shell-safe-command/STATUS.md`；本任务不回滚这些改动。
- 用户要求：
  - 兼容新旧两种 Codex CLI 写法。
  - 用 `codex --help` 查证当前写法。
  - 在产品/提示中标注这是新特性。
  - 用户纠正：“不要显示覆盖”实际是“不要显式覆盖”；含义是应根据 Codex 暴露的接口决定怎么调用 Codex，而不是固定用一种显式覆盖/强行参数形态。
  - 验证 `/shell` 是否能访问本地回环地址。
  - 完成后 push，并向用户解释实现方式。
  - `/shell` 返回应改为流式卡片，并类似 `/tmux-screen` 持续更新。
  - `/shell <cmd>` 使用默认刷新间隔；`/shell <数字> <cmd>` 指定刷新间隔；刷新间隔最低 5 秒。

## 任务日志

### 2026-05-31 23:16 CST 阶段：定位 Codex CLI 新旧写法和相关 UI 文案

阶段描述：通过 `codex --help` 与源码搜索确认新旧 CLI 写法差异，定位需要兼容和需要调整的用户可见文案。

- 行动：建立任务状态文件，记录用户新增要求和当前约束。
- 行动：用户纠正任务理解：不是调整 UI 中“覆盖”文案，而是避免固定显式覆盖式调用；接下来按 `codex sandbox --help`/子命令 help 检测接口并选择新旧参数。
- 行动：2026-05-31 23:19 CST 运行 `codex --help` 和 `codex sandbox --help`，确认全局 Codex CLI 为 `codex-cli 0.135.0`，顶层 `codex sandbox` 直接支持 `--permissions-profile <NAME>` 与 `--cd <DIR>`。
- 行动：2026-05-31 23:19 CST 运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && ./node_modules/.bin/codex --version`，确认项目依赖里的 Codex CLI 为 `0.130.0`；其顶层 `codex sandbox --help` 只列 `linux/macos/windows` 子命令，`codex sandbox linux --help` 才支持 `--permissions-profile <NAME>`。
- 当前计划：
  - 将 `/shell` runner 从“先试新写法、失败再 fallback”调整为“先读取 `codex sandbox --help`，按 help 暴露的接口选择新写法或旧 `sandbox linux` 写法”，保留异常 fallback 兜底。
  - 在 README/help/UI 中把 `/shell` 标注为新特性。
  - 增加测试覆盖新旧 help 检测和旧版 argv。
  - 按现有代码风格实现兼容和文案调整。
  - 运行相关测试，阶段审计后提交。
- 代码修改：
  - 修改 `src/lib/bridge/command/shell.ts`：新增 `detectCodexSandboxCliStyleFromHelp()`，`defaultShellCommandRunner` 先执行 `codex sandbox --help` 检测当前 CLI 形态；新 CLI 使用顶层 `codex sandbox --permissions-profile ...`，旧 CLI 使用 `codex sandbox linux --permissions-profile ...`；执行异常时保留旧版 fallback 兜底。
  - 修改 `src/__tests__/command-dispatch.test.ts`：补充新/旧 help 检测断言，以及旧版 `sandbox linux` 参数构造断言。
  - 修改 `README.md`、`README_EN.md`、`src/lib/bridge/command/help.ts`、`src/ui/shell.ts`：将 `/shell` 标注为新特性。
- 本地访问验证：
  - `src/__tests__/command-dispatch.test.ts` 中的真实 `/shell` localhost TCP 用例会在 Node 测试进程监听 `127.0.0.1` 随机端口，再让 `/shell` 通过 bash `/dev/tcp/127.0.0.1/<port>` 读取 `cti-localhost-ok`；该用例在定向测试和完整回归中均通过。
- 阶段验证：
  - 2026-05-31 23:21 CST 运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --test-concurrency=1 --import tsx --test-timeout=30000 src/__tests__/command-dispatch.test.ts`：通过，37 tests。
  - 2026-05-31 23:21 CST 运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`：通过。
  - 2026-05-31 23:21 CST 运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`：通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`，无 dist 工作树变更。
  - 2026-05-31 23:21 CST 运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`：通过，532 tests。
  - 2026-05-31 23:21 CST 运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && codex sandbox --permissions-profile :workspace --cd "$PWD" /bin/bash -lc true`：全局 0.135.0 新写法通过，退出码 0。
  - 2026-05-31 23:21 CST 运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && ./node_modules/.bin/codex sandbox linux --permissions-profile :workspace --cd "$PWD" /bin/bash -lc true`：项目内 0.130.0 旧写法通过，退出码 0。
- 当前进入阶段审计：本阶段目标是兼容新旧 Codex sandbox CLI 写法、标注 `/shell` 新特性、验证本地回环访问能力，并按用户要求 push。
- 阶段审计：
  - 兼容性：`/shell` 不再固定显式使用新写法，而是先读取 `codex sandbox --help`，检测顶层是否暴露 `--permissions-profile`；若暴露则用 0.135.0 顶层 `codex sandbox ...`，否则检测 `linux` 子命令并用 0.130.0 `codex sandbox linux ...`。运行错误中仍保留旧式 fallback。
  - 新特性标注：README、英文 README、IM `/help`、UI 命令说明均标注 `/shell` 为新特性。
  - 本地访问：新版 sandbox 加网络 permission profile 后可访问 `127.0.0.1`；测试中 `/shell` localhost 用例通过。
  - 工作树：本任务只准备提交 README、README_EN、`src/lib/bridge/command/shell.ts`、`src/lib/bridge/command/help.ts`、`src/ui/shell.ts`、`src/__tests__/command-dispatch.test.ts` 和本 `STATUS.md`；保留无关未提交改动 `AGENTS.md`、`work/shell-safe-command/STATUS.md`。
- 阶段验证和git提交：已创建本地提交 `Support new and legacy Codex sandbox CLI`；用户追加 `/shell` 流式卡片要求，因此暂不 push，后续实现后 amend 同一提交再 push。

### 2026-05-31 23:43 CST 阶段：实现 /shell 流式卡片和刷新频率

阶段描述：将 `/shell` 从一次性文本回复调整为类似 `/tmux-screen` 的流式卡片，支持命令内指定刷新间隔且最低 5 秒。

- 行动：记录用户追加要求；暂停 push，计划在同一功能提交中 amend。
- 行动：
  - 阅读 `src/lib/bridge/command/dispatch.ts`、`src/lib/bridge/command/tmux.ts` 和 `src/lib/bridge/stream-feedback-controller.ts`，确认 `/tmux-screen` 通过 `pushStreamFeedbackText` / `pushStreamFeedbackStatus` / `finalizeStreamFeedback` 更新 structured streaming UI。
  - 当前 `/shell` runner 已有基于 `spawn` 的 `onProgress` 分支，但 command dispatch 尚未传入 card，参数解析也尚未真正设置 `refreshIntervalSeconds`。
- 代码修改：
  - 修改 `src/lib/bridge/command/dispatch.ts`：当适配器支持 structured streaming UI 时，为 `/shell` 创建独立 stream key，并把 update/finish card 回调传入 `handleShellCommand()`。
  - 修改 `src/lib/bridge/command/shell.ts`：支持 `/shell [秒数] <command>`，最低 5 秒；执行前发送初始卡片，执行中按刷新间隔推送 stdout/stderr 快照，结束时 finalize 卡片；不支持卡片时仍返回一次性文本。
  - 修改 README、英文 README、`/help` 和 UI 命令说明，说明 `/shell` 是流式命令且卡片刷新最低 5 秒。
  - 修改 `src/__tests__/command-dispatch.test.ts`：补充 structured streaming UI 适配器下的 `/shell 2 echo streamed` 测试，验证刷新间隔被抬到 5 秒、进度和最终输出进入卡片且不再发送普通文本。
- 阶段验证：
  - 首次运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --test-concurrency=1 --import tsx --test-timeout=30000 src/__tests__/command-dispatch.test.ts`：新增 `/shell` streaming 测试通过，但既有 `/t archive` 全局列表序号用例归档到相邻 fixture thread，疑似列表排序/fixture 干扰；先复跑确认是否稳定失败。
  - 复跑同一 `command-dispatch.test.ts` 命令：通过，38 tests。
  - 运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`：通过。
  - 运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`：通过。
  - 运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`：通过，533 tests。
- 当前进入阶段审计：
  - `/shell` 在支持 structured streaming UI 的 adapter 上会创建独立 stream key，执行前发送初始卡片，执行中按刷新间隔推送输出快照，最终 finalize 卡片；不支持卡片时仍返回原有一次性文本。
  - `/shell [秒数] <command>` 已支持，低于 5 秒会抬到 5 秒；`--force`、`--sandbox read-only|workspace-write` 和 Markdown 自动链接还原继续保留。
  - 默认 runner 的流式执行使用 `spawn` 收集 stdout/stderr；仅当传入 `onProgress` 时启用增量进度，普通文本路径仍可走一次性结果。
  - 验证覆盖：新增 structured card 用例覆盖最低刷新间隔、进度输出、最终输出、无普通文本重复发送；既有真实 sandbox、localhost、危险命令审计、新旧 CLI 检测均在 `command-dispatch` 中通过；typecheck、build、完整回归通过。
  - diff check 通过后已 amend 到 `Support new and legacy Codex sandbox CLI`。
- 阶段验证和git提交：
  - 2026-05-31 23:30 CST 已 amend 本地提交 `Support new and legacy Codex sandbox CLI`；最终提交哈希以 `git log -1` 为准。
  - 2026-05-31 23:30 CST 运行 `git push --force-with-lease origin master`：成功，将 `master` 推送到 `origin/master`。
