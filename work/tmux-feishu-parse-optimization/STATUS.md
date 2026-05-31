# tmux 优化与飞书解析优化

## 任务目标

原始指令：

- / goal 完成下列任务
- 阶段：tmux优化
  1. ensureSession要能支持自动创建（可以作为一个参数），比如/p切过去找不到了就应该重建
  2. 一个问题是普通/tmux命令中如果发了尖括号有的时候会误触，一个修改方法是普通/tmux命令改为只支持文本或者尖括号，不再支持混传，但不确定这样是不是好，另外这样对于需要混传的场景也需要有一个更好的支持。你思考一下
- 阶段：飞书解析优化
  - 现在用户发来的飞书内容是怎么解析的，汇报一下，直接在思考内容里汇报给我
  - 我看现在用户发来的代码块没有解析？你查查日志。比如我现在给你一条 `KEY=AHAHAHAH`，这条是以rust代码块的方式附在这个消息底下的，但是飞书收不到？

## 任务上下文

- 当前仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前时间：`2026-05-31 14:46 CST`。
- 上一阶段提交：`450e1d6 Abstract tmux core operations`，已把 tmux 底层 CLI 收敛到 `src/lib/bridge/tmux/core.ts`。
- 当前工作树存在既有 unrelated 改动：`AGENTS.md`、`work/auto/STATUS.md`、`work/develop/STATUS.md`、大量 `work/rebuild/*` 删除和 `work/rebuild/manual-audit.md`；本任务不回滚、不纳入。
- 2026-05-31 14:48 CST 用户补充/确认仓库协作准则：长期任务必须围绕 `work/<goalname>/STATUS.md` 推进；新认识、计划、依赖事实、审计结果、测试结果或用户纠偏必须立即落盘；阶段完成后需要审计并使用 `git commit --amend`；Node.js 开发命令需使用 Node.js 24；除非用户明确要求，不 push、不 hot update/redeploy 本地 bridge。
- 当前环境 `rg` 不可用，后续检索使用 `find`/`grep`。
- 2026-05-31 14:53 CST 用户纠偏：`replaceDetachedSession` 命名/抽象不清晰，应直接合并到 ensure 语义；特殊按键命令不要叫 `tmux-keys`，定名为 `/tmux-key`；需要查飞书官方文档确认代码块在 post content 中的结构。
- 2026-05-31 15:02 CST 用户新增要求：飞书消息类型很多，遇到不支持的消息类型，或者支持类型中有不支持的字段/元素，不能静默 drop，必须给用户一个提示信息。
- 2026-05-31 15:45 CST 用户明确要求：push 当前提交，并 hot update 本地 bridge。

## 任务日志

### 2026-05-31 14:46 CST 阶段：审计 tmux ensure 与飞书入站解析

阶段描述：确认当前 tmux core/session 创建能力、`/tmux` 解析策略，以及飞书消息解析/日志路径，再实现修复。

- 行动：已记录用户原始目标。本阶段分为 tmux 优化和飞书解析优化两个子域，但会在同一阶段内保持可测试的稳定状态。
- 行动：2026-05-31 14:48 CST 已按用户补充的 AGENTS 准则补记工作流约束；确认本任务状态目录为 `work/tmux-feishu-parse-optimization/`。`git status --short` 显示存在多项既有改动/删除，当前任务只处理 tmux 与飞书解析相关文件。
- 行动：2026-05-31 14:52 CST 已读取 tmux core/runtime/command、飞书 adapter/markdown 与相关测试。当前 `replaceDetachedSession` 与 `ensureDetachedSession` 分离，`/provider tmux` 使用 replace 语义；当前 `/tmux` 解析混合文本和 `<...>` 特殊键，容易把普通尖括号误当按键；当前飞书 `post` 入站解析只处理 `text/a/at/img`，`text` 元素直接拼接，未读取 `style` 或代码块 tag。
- 行动：2026-05-31 14:52 CST 检查 `~/.codex-to-im/logs/bridge.log`：用户示例消息为 `messageType: 'post'`，`rawContentPreview` 中每个文本元素包含 `style: []`；入站队列 `textPreview` 已包含 `KEY=AHAHAHAH`，但代码块语言/结构丢失，被扁平化为普通文本。
- 行动：2026-05-31 14:53 CST 用户纠偏后，阶段计划调整为：1) 查飞书官方文档确认 post 代码块结构；2) 将 tmux replace 重启语义并入 ensure API；3) `/tmux` 改为纯文本发送，新增 `/tmux-key` 承载 `<Enter>/<C-c>` 等特殊键和混合按键语法；4) 修复飞书 post 代码块解析并补测试。
- 行动：2026-05-31 14:53 CST 已查飞书官方“接收消息内容结构”文档：接收富文本 `post` 的 `content` 是二维数组；代码块元素形如 `{ "tag": "code_block", "language": "GO", "text": "..." }`；文档同时说明接收富文本会把发送内容中的 `md` 标签转换为其它标签。因此本仓库当前只处理 `text/a/at/img` 的 `parsePostContent` 会丢代码块结构和语言。
- 行动：2026-05-31 14:55 CST 已执行代码修改：`TmuxCore.ensureDetachedSession` 增加 `recreate?: boolean` 并返回创建命令，移除独立 `replaceDetachedSession`；`startCodexResumeTmuxSession` 和 Codex TUI tmux 启动改用 `ensureDetachedSession({ recreate: true })`；命令集合新增 `/tmux-key`；`/tmux` 改为只发送普通文本并保留自动回车，`/tmux-key` 解析 `<Enter>/<C-c>` 等特殊键且不隐式追加自动回车；飞书 `parsePostContent` 增加 `code_block` 元素解析并转为 fenced code block。
- 行动：2026-05-31 14:55 CST 已补测试：`feishu-adapter.test.ts` 覆盖 `post` 中 `code_block` -> fenced markdown；`command-dispatch.test.ts` 调整 tmux 场景，覆盖 `/tmux` 尖括号按原文发送与 `/tmux-key` 特殊键解析。
- 行动：2026-05-31 14:57 CST 定向测试通过：`node --test --test-concurrency=1 --import tsx --test-timeout=15000 src/__tests__/command-dispatch.test.ts src/__tests__/feishu-adapter.test.ts`，52 个测试全部通过。
- 行动：2026-05-31 14:57 CST 类型检查通过：`npm run typecheck`（Node.js 24）。
- 行动：2026-05-31 15:02 CST 构建通过：`npm run build`（Node.js 24），已更新 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- 行动：2026-05-31 15:02 CST 全量测试通过：`npm test`（Node.js 24），508 个测试全部通过。
- 行动：2026-05-31 15:02 CST 用户新增飞书不支持内容提示要求；当前阶段未进入最终审计，需先补实现和测试。
- 行动：2026-05-31 15:04 CST 已补实现：`post` 解析结果增加 `warnings`；未知富文本元素会进入文本占位 `[unsupported Feishu post element: ...]` 并触发用户提示；`post` 中不支持/异常结构会生成提示；不支持的 `message_type` 会回复用户说明暂不支持且不会转发给 Codex，不再只 log 后静默 return。
- 行动：2026-05-31 15:04 CST 已补测试：`feishu-adapter.test.ts` 覆盖 `post` 未知元素保留和 warning，以及 unsupported `message_type` 会通过 `im.message.reply:text` 给用户可见提示且不入站转发。
- 行动：2026-05-31 15:05 CST 定向测试通过：`node --test --test-concurrency=1 --import tsx --test-timeout=15000 src/__tests__/feishu-adapter.test.ts`，33 个测试全部通过。
- 行动：2026-05-31 15:05 CST 类型检查通过：`npm run typecheck`（Node.js 24）。
- 行动：2026-05-31 15:05 CST 构建通过：`npm run build`（Node.js 24），已更新 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- 行动：2026-05-31 15:06 CST 全量测试通过：`npm test`（Node.js 24），510 个测试全部通过。
- 行动：2026-05-31 15:06 CST 已检查 diff：本任务相关变更集中在 tmux core/runtime/command、Codex tmux 启动、飞书 adapter、相关测试和本 STATUS；工作树中 `AGENTS.md`、`work/auto/STATUS.md`、`work/develop/STATUS.md`、大量 `work/rebuild/*` 删除及 `work/rebuild/manual-audit.md` 是既有无关改动，不纳入本阶段提交。
- 阶段验证和git提交：当前进入阶段审计。对照目标：tmux ensure 已合并重启语义，`replaceDetachedSession` 已消除；`/tmux` 改为纯文本，`/tmux-key` 承担特殊键/混合按键；飞书 `post` 代码块按官方 `code_block` 结构解析为 fenced code block；不支持的飞书消息类型/富文本元素会用户可见提示，不再静默丢弃。验证覆盖：定向测试、typecheck、build、全量测试均通过。
- 阶段验证和git提交：2026-05-31 15:07 CST 已 stage 本任务相关文件并执行 `git commit --amend -m "Optimize tmux and Feishu inbound parsing"`，随后用 `git commit --amend --no-edit` 同步状态记录；最终提交哈希以当前 `git log -1` 为准。
- 行动：2026-05-31 15:45 CST 用户明确要求 push 和 hot update；按开发工作流，本次可执行 push，并通过 `scripts/hot-update-bridge.sh --skip-tests` 派发 detached hot update。由于 15:06 CST 刚完成全量 `npm test` 且通过，hot update 允许跳过测试；用户未要求 pull，因此不传 `--pull`。
- 行动：2026-05-31 15:46 CST 已将 push/hot update 指令 amend 进当前提交，当前本地提交为 `1dcdc34 Optimize tmux and Feishu inbound parsing`。执行 `git push origin master` 被远端拒绝，原因是 non-fast-forward；fetch 后确认本地 `master` 与 `origin/master` 分叉，普通 push 无法完成，需用户确认是否允许 `git push --force-with-lease origin master` 或改走 rebase/merge。
- 下一个阶段计划：先按用户明确要求派发本地 hot update；push 的强制更新等待用户确认。
