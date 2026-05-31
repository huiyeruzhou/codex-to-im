## 任务目标

原始指令：标题 bridge 已启动那句，能不能带个标题，这样就很醒目，甚至是使用卡片消息，用青色的卡片消息吧

## 任务上下文

- 当前仓库工作树已有多处非本任务改动；本任务只处理 bridge 启动提示相关代码和本状态文件，不回退其它改动。
- Node.js 开发命令按仓库约定需要使用 Node.js 24。

## 任务日志

### 2026-05-31 16:20 CST

阶段描述：定位 bridge 启动提示发送链路并改为醒目的青色卡片消息

- 已记录用户原始需求：让“bridge 已启动”这句带标题、更醒目，倾向使用青色卡片消息。
- 初始检查发现 `rg` 不可用，后续使用 `find`/`grep` 定位代码。
- 用户追加观察：需要查飞书文档，并检查上一条 bridge log；用户看到收到的标题叫「标题」，最后被渲染成普通文字，说明当前飞书标题解析逻辑不符合预期。
- 用户澄清：这里的“标题”不是卡片标题，而是用户发送的飞书普通富文本 post 标题。
- 本机 bridge log 证实上一条用户消息 `messageType: 'post'` 的 `rawContentPreview` 为 `{"title":"标题","content":[...]}`，但入站 `textPreview` 变成 `标题bridge已启动那句...`；原因是 `parseFeishuPostContent` 把 `parsed.title` 直接 `textParts.push(title)`，没有用换行保留标题和正文边界。
- 用户追加要求：普通富文本标题应当给一个 `#` 表示 H1；修完这个继续改飞书启动 UI，启动通知是真正要使用卡片标题。
- 本地 SDK 类型 `InteractiveCardHeaderTemplate` 支持 `turquoise`，比现有项目类型中的 `blue | green | red | yellow | grey` 更符合用户说的“青色卡片”。
- 已修改 `parseFeishuPostContent`：飞书普通富文本 `post.title` 会转成 Markdown H1（`# 标题`）并用空行和正文分隔，避免拼成 `标题正文`。
- 已扩展 rich card/stream metadata 的 template 类型，允许飞书 SDK 支持的 `turquoise` 等 header 模板。
- 已修改 bridge 启动通知：保留纯文本 fallback，同时附带 `richCard`，卡片 header 标题为 `Bridge 已启动`，template 为 `turquoise`，正文保留完整 Markdown 状态信息。
- 已补测试：飞书 post title H1 解析、raw markdown rich card 保留、启动通知 richCard 断言。
- 阶段验证：已用 Node.js 24 运行 `node --test --test-concurrency=1 --import tsx --test-timeout=15000 src/__tests__/feishu-adapter.test.ts src/__tests__/feishu-markdown.test.ts src/__tests__/bridge-manager.test.ts`，115 个测试全部通过。
- 阶段验证：已用 Node.js 24 运行 `npm run typecheck`，通过。
- 阶段验证：已用 Node.js 24 运行完整 `npm test`，512 个测试全部通过。
- 当前进入阶段审计：本阶段同时解决两个用户明确需求：
  - 飞书普通富文本标题 `post.title` 不再被拼成正文前缀，而是桥接为 Markdown H1，符合用户说的“普通标题应该给一个 #”。
  - Bridge 启动通知保留纯文本 fallback，同时为飞书等支持 rich card 的通道提供青色 `turquoise` 卡片，卡片 header 标题为 `Bridge 已启动`。
- 阶段审计结论：相关解析、渲染、启动通知测试和完整测试均通过；本阶段可提交。下一步计划：暂存本任务相关文件并使用 `git commit --amend` 合入当前阶段提交，不触碰其它已有工作树改动。
- 阶段提交：已执行 `git commit --amend --no-edit` 合入本阶段改动；由于 amend 会改变提交哈希，最终提交哈希以 `git log -1 --oneline` 为准。

### 2026-05-31 16:50 CST

阶段描述：按用户要求 push 并热更新本地 Bridge

- 用户追加指令：`push，热更新`。
- 当前目录确认是项目根目录 `/data00/home/hongli.fish/Codex/codex-to-im`。
- `git status --short --branch` 显示当前分支 `master...origin/master [ahead 10, behind 8]`，且存在多处非本任务未提交改动；本阶段不会回退或清理这些改动。
- 因为用户明确要求 push，将先把本状态更新 amend 进当前提交，再尝试普通 `git push`。不会执行 force push；也不会执行 pull，因为用户没有要求拉取远端变更。
- 因为用户明确要求热更新，将从项目根目录执行 detached updater。刚刚同一批本地改动已完整跑过 `npm test` 且通过，所以计划使用 `bash scripts/hot-update-bridge.sh --skip-tests`；不使用 `--pull`。
- 已执行 `git commit --amend --no-edit` 将本阶段状态更新合入当前提交。
- 已执行普通 `git push`，但 GitHub 拒绝：`master -> master (non-fast-forward)`，原因是本地分支 behind 远端。未执行 force push，也未自动 pull。
- 下一步继续执行用户要求的本地 hot update：`bash scripts/hot-update-bridge.sh --skip-tests`。
- 已执行 `bash scripts/hot-update-bridge.sh --skip-tests`，脚本成功派发 detached worker。
- Hot update 参数记录：未使用 `--pull`；使用 `--skip-tests`，因为本阶段刚完整跑过 `npm test` 且 512 个测试通过。
- Hot update log：`/home/hongli.fish/.codex-to-im/logs/hot-update-20260531-165138.log`。
- Bridge log：`/home/hongli.fish/.codex-to-im/logs/bridge.log`。
- 检查 hot update log：worker 使用 Node `v24.12.0`，执行 build，通过 `codex-to-im stop && npm run build && codex-to-im start` 重启，最后显示 `Bridge started. PID: 3742981`，并于 `2026-05-31T16:51:40+08:00` completed。
- 阶段审计结论：热更新已完成；push 未完成，阻塞原因是远端非 fast-forward，需要用户决定是否 pull/rebase 后再 push，或明确允许 force push。

### 2026-05-31 16:54 CST

阶段描述：分析本地 master 和远端 origin/master 的 divergence

- 用户追加指令：分析本地和远程有什么 divergence。
- 计划：先 `git fetch --prune` 更新远端引用，再查看 `master...origin/master` 的 ahead/behind 提交、merge-base、双方改动文件列表，并评估 rebase/merge 的潜在冲突风险。
- 已执行 `git fetch --prune`。
- 当前状态：`master...origin/master [ahead 10, behind 8]`；merge-base 为 `4e1e2b92355c0f8266072a7377cdd591019a429c`。
- `git log --left-right --cherry-mark master...origin/master` 显示 5 对提交 patch-id 等价：
  - `Keep bridge sessions primary in thread lists`
  - `Persist auto task cards and constrain scripts`
  - `Avoid tmux new-session env flags`
  - `Record develop task status`
  - `Verify thread unbind preserves sessions`
- 非等价差异：
  - 远端独有/不同：`6a5a02c Rebuild source architecture`、`c9e8cc9 Rebuild source architecture`、`dc85797 Fix auto SDK timer finalization`。
  - 本地独有/不同：`4edd9c4 Rebuild source architecture`、`7a441d7 Fix auto SDK timer finalization`、`a235c1e Fix stopped mirror suppression`、`bc89632 Snapshot tmux Codex shell environment`、`1638973 Optimize tmux and Feishu inbound parsing`。
- `git range-diff` 结论：本地的 `4edd9c4 Rebuild source architecture` 已吸收/改变了远端 `6a5a02c` 的部分内容；远端还有一个额外的 `c9e8cc9 Rebuild source architecture`，主要包含 `codex_title`/BridgeSession 标题一致性、`work/auto-hi-every-10s` 和 `work/thread-title-display-analysis` 记录；本地后续又新增了 stop mirror suppression、tmux shell snapshot、tmux/Feishu inbound parsing 和启动卡片改动。
- `git diff --stat origin/master..master` 显示当前本地相对远端净差异集中在 25 个文件，约 `1347 insertions / 417 deletions`，重点文件包括 `src/codex/tmux-provider.ts`、`src/codex/shell-snapshot.ts`、`src/lib/bridge/tmux/core.ts`、`src/lib/bridge/tmux/runtime.ts`、`src/lib/bridge/adapters/feishu-adapter.ts`、`src/lib/bridge/bridge-manager.ts`、`src/lib/bridge/command/tmux.ts`、`src/lib/bridge/types.ts` 和相关测试/status。
- 用 `git merge-tree` 评估直接合并风险，发现至少以下文件会出现文本冲突：
  - `src/__tests__/codex-tmux-provider.test.ts`
  - `src/codex/tmux-provider.ts`
  - `src/lib/bridge/bridge-manager.ts`
  - `src/lib/bridge/command/aliases.ts`
  - `src/lib/bridge/command/dispatch.ts`
  - `src/lib/bridge/command/tmux.ts`
  - `src/lib/bridge/tmux/runtime.ts`
  - `work/auto-runtime-debug/STATUS.md`
- 审计结论：普通 `git pull --rebase` 或 merge 都不会是零冲突；冲突核心在 tmux provider/runtime 抽象和 auto-runtime-debug 状态记录，另有 bridge-manager/command 别名与 dispatch 轻量冲突。推荐后续用临时 worktree 做 rebase，把远端 5 个等价提交跳过/复用，再手动解决上述冲突，最后跑完整测试；不建议 force push 覆盖远端，因为远端有 `c9e8cc9` 和 `dc85797` 中不完全等价的内容。
