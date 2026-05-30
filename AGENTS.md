# AGENTS.md — Codex-to-IM 项目协作准则

## 总原则

本仓库的长期重构任务必须围绕 `STATUS.md` 推进。不要只凭对话记忆、局部代码印象或已经完成的某个阶段判断任务完成；当前工作树和状态文件才是权威来源。

允许在中文文档中保留必要英文术语，例如 `BridgeSession`、`ChannelBinding`、`CodexSource`、`Creator`、`command`、`adapter`、`runtime`、`schema`、`amend`。

## 红线原则

### 动作要落盘

- 始终在`work/<goalname>`目录下维护 `STATUS.md`。
- 每当有新的认识、理解、计划、依赖事实、审计结果、测试结果或用户纠偏，必须立即写入 `STATUS.md`。
- 状态文件必须包含：
  - h2-任务目标：原始指令：任务开始时的目标，不能改变。 用户修改后，追加修改。
  - h2-当前规划：和你的内部规划工具保持一致。
  - h2-任务上下文：这里存储你在任务过程中遇到的所有事实性信息
  - h2-阶段日志：这里存储每个阶段的计划
    - h3-阶段条目：带有精确到分钟级别的时间戳，对当前阶段的计划的一个描述，阶段有一个相对大一点的模块化的任务，需要若干个行动来完成，是一个自包含的原子任务。每个阶段应该对应一个git提交。
  - h2-行动日志
    - h3-行动条目：带有精确到分钟级别的时间戳，对当前思考了什么、做了什么、得到什么结论的一个描述，最新的日志写在最前面
- 不要把“我打算做什么”只留在对话里；长期任务的关键上下文必须落盘。

### 动作成阶段

- 不要一次做过于巨大的改动。
- 每个阶段都应该有清晰边界：审计范围、修改范围、验证命令、文档同步、提交策略。
- 逐步修改、逐步测试。每个阶段完成代码修改后，确认已经同步 `STATUS.md` 和相关项目文档。
- 每个阶段完成后要提交到本地 git。
- 如果后续修改仍属于同一个模块/同一个功能阶段，并且还没有 push，应合并到同一个 feature commit，用 `git commit --amend`，不要堆叠无意义的 incremental fix commits。
- 只有无关变更才单独提交。

### 阶段要审计

每当一个阶段改完，必须执行阶段审计：

- 在 `STATUS.md` 中简要总结本阶段修改，并明确记录“当前进入阶段审计”。
- 将该阶段的原始行动记录、原始依赖事实、扫描结果、关键命令输出摘要等，移动到新的归档文件：`STATUS-yyyymmdd-hhmm-name.md`。
- 在 `STATUS.md` 中删掉具体的行动日志，撰写阶段日志。
- 针对任务目标重新判断当前阶段是否真正完成：
  - 功能开发：运行相关测试，并尽量假设一个端到端使用场景验证。
  - 文档编写：检查内容是否全面、准确、没有旧术语误导。
  - 代码重构：检查重构是否干净、彻底，是否消除了目标耦合，而不是只移动文件。
- 如果完成，标记阶段完成，结合当前进度规划下一步并更新 `STATUS.md`。
- 如果没有完成，记录反思、缺口和改进计划，然后继续推进。

## GitHub Issue 回复

回复用户报告的 GitHub Issue 时，结尾必须包含 **自助排查提示**，引导用户使用自己的 AI coding assistant（Codex / Codex）先诊断并尝试修复问题。

示例：

> **自助排查提示：** 你可以直接在 Codex 中发送以下提示，让 AI 帮你诊断问题：
>
> ```text
> 请帮我排查 Codex-to-im 桥接服务的问题。
> 1. 读取 ~/.codex-to-im/logs/bridge.log 最近 50 行日志
> 2. 读取 ~/.codex-to-im/config.env 检查配置是否正确
> 3. 如果当前仓库存在 scripts/doctor.ps1，就运行 powershell -ExecutionPolicy Bypass -File .\scripts\doctor.ps1 并分析输出
> 4. 根据日志和配置给出具体的修复建议
> ```

这样做的目的：

- 降低维护成本，让用户能先自助定位问题。
- 利用用户本来已经安装的 AI coding assistant。
- 给出可执行的下一步，而不是只解释错误。

## 开发工作流

- 本仓库的 Node.js 开发命令使用 Node.js 24。
- 运行 `npm run build`、`npm test`、`npm run typecheck` 或其他 Node 命令前，除非当前 shell 已经是 Node.js 24，否则先运行 `nvm use 24`。
- 由于环境可能带有普通 Node 不接受的 `NODE_OPTIONS`，必要时使用 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && ...`。
- 除非用户明确要求，不要 push commit。
- 除非用户明确要求，不要 hot update 或 redeploy 本地 bridge。
- 工作完成后，代码变更仍应提交到本地 git；同一功能阶段的 follow-up 应 amend 到同一个 commit。

## Hot Update 本地 Bridge

只有用户明确要求 hot update 或 redeploy 本地 Codex-to-IM bridge 时才执行本节。

不要在前台运行 `codex-to-im stop`。前台 stop 可能停止承载当前 Codex 会话的 bridge，导致命令自己中断。

操作步骤：

1. 确认当前工作目录是 `codex-to-im` 项目根目录。
2. 只有用户明确要求 pull latest changes 时，才传 `--pull`；否则不要传。
3. 如果刚刚针对同一批本地改动完整跑过 `npm test` 且通过，可以传 `--skip-tests`，避免 detached hot update 重跑完整测试；否则不要传。
4. 从项目根目录派发 detached updater：

   ```bash
   bash scripts/hot-update-bridge.sh
   ```

   带 pull：

   ```bash
   bash scripts/hot-update-bridge.sh --pull
   ```

   刚跑完完整测试后跳过测试：

   ```bash
   bash scripts/hot-update-bridge.sh --skip-tests
   ```

5. 回复用户时必须说明：实际派发的命令、是否使用 `--pull`、是否跳过测试、hot update log 路径、bridge log 路径。

脚本负责使用 Node.js 24、检测 `--use-env-proxy`、运行 build/test（除非传 `--skip-tests`）、并从 detached worker 重启 bridge。默认 bridge log 路径是 `~/.codex-to-im/logs/bridge.log`。
