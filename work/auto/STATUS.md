# /auto 自动化任务功能族

## 任务目标

原始指令：开发一个新功能族 `/auto`，绑定到 session 身上。

- `/auto ls` 查看当前自动化任务，列出绑定的 session 标题、脚本路径、创建时间、已经触发的次数、上一次触发时间、一共要触发多少次、session codex-id；需要文字形式和飞书卡片形式两种模式，标题用绿色风格；飞书卡片的布局和功能参考 `/t`。
- `/auto rm` 删除自动化任务，使用序号。
- `/auto skill <install|uninstall>` 将「告诉模型如何创建自动化脚本」的 skills 复制到 `~/.codex` 中，或者从其中删除。
- `/auto new <scriptpath> <times>` 启动一个守护进程，该进程持续运行伪代码：

```text
t = 0
while t < times:
    run <scriptpath>
    use codex-sdk, resume codex-session in current binding, with the same mode and permissons. prompt is the stdout of scriptpath.
    t ++
```

并且写一个 skill 告诉模型如何创建适用于 `/auto` 的脚本，示例包括用户说“每20分钟跟踪一下某试验的进度”时，脚本应该等待并检查状态，最后 echo prompt。创建完之后，把脚本内容和绝对路径告诉用户，脚本名字应该能描述执行任务的时机。

用户修改：`/auto` 命令绑定到 bridge session 上，与 binding 无关。

## 任务上下文

- 当前仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前时间：`2026-05-30 12:46 CST`。
- 本任务需要创建 Codex skill，因此已读取系统 `skill-creator` skill 的说明；要求 skill 至少包含 `SKILL.md`，frontmatter 需要 `name` 和 `description`，内容应精简，只包含执行任务所需信息。
- 当前工作树在任务开始前已有大量与 `work/rebuild` 和 `AGENTS.md` 有关的未提交变更；本任务不回滚这些变更。
- 当前环境没有 `rg` 命令，代码检索改用 `find`/`grep`。
- `/t` 命令由 `src/lib/bridge/command/session-thread.ts` 处理，文本/飞书卡片表格在 `src/lib/bridge/command/presentation.ts`，命令分发在 `src/lib/bridge/command/dispatch.ts`。
- 普通消息入口 `bridge-manager.handleMessage` 会按当前聊天的 active binding 解析 session；`/auto` 后台触发不能复用该入口，否则用户切换当前线程后自动任务会跑到错误 session。
- 后台自动任务不能持有或依赖 binding id；任务归属于 bridge session。IM 聊天地址只用于发送通知/回显，触发时需要用任务记录中的 `bridgeSessionId` 和当前 session 数据构造一次性运行上下文。
- 飞书卡片可复用 `OutboundRichCard` 的 table/select/actions 模型；`/auto ls` 需要使用绿色 template。

## 任务日志

### 2026-05-30 12:46 阶段：需求落盘与现有结构审计

阶段描述：建立本任务状态文件，读取 skill 创建规则，并审计现有命令、会话绑定、飞书卡片和 Codex SDK 调用结构，确定 `/auto` 的接入点。

- 已创建 `work/auto/STATUS.md`，记录原始需求、环境事实和当前阶段计划。
- 已确认需要使用 `skill-creator` 指导新增 skill 内容。
- 已审计 `/t` 命令、rich card、callback、普通消息转交 Codex SDK 的执行路径。
- 设计结论已按用户纠偏修正：新增持久化的 auto task store、`/auto` command handler、自动任务运行时和 card callback；任务记录绑定 `bridgeSessionId`，并记录创建来源 chat 用于通知，但不记录/依赖 binding id。

阶段验证和git提交：

- 待完成本阶段审计后执行。

下一个阶段计划：

- 审计现有 `/t` 命令、命令注册、session binding、Codex SDK resume 实现、持久化目录约定和测试结构。

### 2026-05-30 13:05 阶段：/auto 持久化、命令面与后台运行时实现

阶段描述：实现 session 级 `/auto` 任务的持久化、命令处理、飞书卡片展示、skill 安装和 bridge 内后台触发循环。

- 新增 `src/lib/bridge/auto-tasks.ts`，使用 `~/.codex-to-im/data/auto-tasks.json` 持久化自动任务；任务记录包含 `bridgeSessionId`、创建来源 chat、脚本路径、创建时间、触发计数、上次触发时间、总次数和状态，不记录 binding id。
- 新增 `/auto` 命令处理与展示模块：`/auto ls` 按当前 bridge session 列表并生成绿色 rich card；`/auto rm <序号>` 按列表序号删除；`/auto new <scriptpath> <times>` 校验脚本并创建任务；`/auto skill install|uninstall` 安装/删除自动脚本创建 skill。
- 新增 `skills/codex-to-im-auto/SKILL.md`，指导模型创建 `/auto` 脚本：脚本负责等待/检查状态并将下一轮 Codex prompt 输出到 stdout，创建后需要告诉用户脚本内容、绝对路径和建议 `/auto new` 命令。
- 已在 bridge manager 中接入自动任务后台运行时：bridge 启动时恢复未完成任务，任务触发时运行脚本，将 stdout 作为 prompt 发给记录中的 bridge session；使用一次性 synthetic binding，仅作为 `runInteractiveMessage` 的运行上下文，不依赖持久 binding。
- 已添加 auto task 飞书卡片 select/delete callback，并更新命令帮助、UI 命令说明、schema manifest 和 npm package files。

阶段验证和git提交：

- 当前进入阶段审计。
- 已重新核对用户纠偏：自动任务归属 `bridgeSessionId`，不持久化 binding id；后台触发仅构造一次性 synthetic binding 给既有 interactive turn runner 使用。
- 验证命令：
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`：通过。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --import tsx --test-timeout=15000 src/__tests__/command-dispatch.test.ts`：通过，19 tests。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --import tsx --test-timeout=15000 src/__tests__/json-schemas.test.ts`：通过，3 tests。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`：通过。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`：通过，491 tests。
- 审计结论：本阶段功能闭环已完成；`/auto` 命令、绿色 rich card、序号删除、skill 安装/删除、后台循环、schema 和帮助入口均已实现并通过回归。
- 工作树仍存在任务开始前已有的 `AGENTS.md` 修改、`work/rebuild` 删除和 `work/rebuild/manual-audit.md` 未跟踪文件；本阶段未回滚这些无关变更。
- 已执行本地提交：`git commit --amend --no-edit`；提交哈希以 `git log -1 --oneline` 为准。

下一个阶段计划：

- 提交本阶段相关文件到本地 git；如后续继续，可做一次手动端到端 smoke：创建短脚本 `/auto new <script> 1`，确认实际 IM 通知和 Codex 恢复链路。
