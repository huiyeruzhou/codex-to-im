# 当前用户故事

本文记录当前已经实现的用户可见行为。它是描述性文档，不是目标模块结构。

## 角色

- 本地 operator：安装、配置、启动、停止、诊断 bridge。
- IM 用户：从 Feishu/Weixin 发送普通消息和 slash commands。
- Codex Desktop/CLI/TUI 用户：拥有本地 `~/.codex/sessions` 下的 Codex threads。
- Maintainer：调试 storage、adapter、runtime 和 schema migrations。

## 用户故事分组

### 1. 安装、配置和运行本地 Bridge

作为本地 operator，我可以从 UI 配置 channel instances，启动/停止/重启 bridge，查看日志，检查本地服务状态。

当前代码：

- status/config/service controls 的 UI routes 在 `src/ui-server.ts`。
- service process management 在 `src/service-manager.ts`。
- config loading/saving 和 channel instance metadata 在 `src/config.ts`。
- daemon entrypoint 在 `src/main.ts` 中初始化 storage、config、logger、store、permissions、provider routing 和 bridge manager。

当前耦合点：

- `ui-server.ts` 同时直接 import config、service manager、store、desktop sessions、session bindings、Weixin login 和 UI assets。它既是 API server，也是 frontend asset generator。

### 2. 连接一个或多个 IM Channel 实例

作为本地 operator，我可以配置 Feishu/Weixin channel instances，测试它们，并把 chat 绑定到 session 或 default target。

当前代码：

- channel config 在 `src/config.ts`。
- runtime adapter planning 在 `src/lib/bridge/adapter-sync-plan.ts`。
- adapter lifecycle 在 `src/lib/bridge/bridge-adapter-runtime.ts`。
- Feishu 实现在 `src/lib/bridge/adapters/feishu-adapter.ts`。
- Weixin 实现在 `src/adapters/weixin-adapter.ts` 和 `src/adapters/weixin/*`。

当前耦合点：

- Feishu card rendering、streaming updates、REST calls、resource downloads、platform callbacks 都集中在一个大 adapter 文件里。

### 3. 自动把 IM Chat 解析到 Bridge Session

作为 IM 用户，当我在 chat 里发送普通消息时，系统会找到 active binding，或创建合适的 draft/default binding。

当前代码：

- `src/lib/bridge/channel-router.ts` 解析入站 `ChannelAddress`。
- `src/session-bindings.ts` 维护 binding target uniqueness，并创建到 Bridge session 或 Codex thread 的 binding。
- `src/internal-sessions.ts` 创建 hidden draft sessions。
- `src/store.ts` 持久化 sessions 和 bindings。

关键当前规则：

- binding 通过 `codepilotSessionId` 指向 Bridge session。
- Bridge session 可以通过 `codex_thread_id` 指向 Codex thread。
- `codex_thread_id` 属于 session，不属于 binding。

### 4. 发现并选择已有本地 Codex Threads

作为 IM 用户，我可以运行 `/t` 或 `/thread` 来列出、添加、切换、重命名或移除本地可发现的 Codex threads。

当前代码：

- 本地 Codex thread discovery 和 JSONL parsing 在 `src/desktop-sessions.ts`；文件名仍是历史命名。
- Thread display 和 selection logic 在 `src/lib/bridge/thread-display-resolver.ts`。
- `/t` 和 `/thread` 命令行为当前集中在 `src/lib/bridge/command-dispatch.ts`。
- `src/session-bindings.ts` 会 import 本地 Codex session 查询能力，以绑定 `desktop:<threadId>` 这样的历史 selector。这个 selector 不应继续扩展；目标是先物化为 BridgeSession，再用 session id 操作。

当前耦合点：

- Display title/source 规则重复出现在 `thread-display-resolver.ts`、`session-bindings.ts`、`ui-server.ts`。
- resolver 应升级为共享 query model，用于用户可见 session/thread identity。

### 5. 从 IM 发送普通消息到 Codex

作为 IM 用户，我可以发送文本和附件；bridge 会在当前 session 中运行 Codex，并把进度 stream 回来。

当前代码：

- `src/lib/bridge/bridge-manager.ts` 消费 adapter messages，并判断 command 还是普通 prompt。
- `src/lib/bridge/interactive-message-runner.ts` 管理一个 interactive turn、streaming UI、task state 和 final delivery。
- `src/lib/bridge/conversation-engine.ts` 消费 provider SSE 并组装 assistant/tool progress。
- `src/codex-routing-provider.ts` 选择 SDK 或 tmux provider。
- `src/codex-provider.ts` start/resume Codex SDK threads。
- `src/codex-tmux-provider.ts` 驱动 Codex TUI/tmux provider mode。

关键当前规则：

- 如果 `session.codex_thread_id` 存在，SDK provider resume 它；否则 provider start 新 thread，并在 Codex 返回 thread id 后持久化。

### 6. 判断一个 Turn 是否复用本地 Codex Thread

作为 runtime，我需要知道一个 IM-driven turn 是普通 SDK bridge turn，还是正在驱动一个本地可见的 Codex/TUI thread。

当前代码：

- `src/lib/bridge/turns/turn-classifier.ts` 基于 `session.codex_thread_id` 和本地 Codex thread lookup 进行分类。
- `src/lib/bridge/interactive-message-runner.ts` 使用分类结果协调 terminal/local Codex finalization。

当前耦合点：

- `source` 有多重含义：execution provider（`sdk`/`tmux`）、Codex JSONL provenance（`originator`/`source`）、UI badge source（`Bridge`/`Desktop`/`TUI`）。这些需要分开命名。

### 7. 把本地 Codex/TUI Thread 输出 Mirror 回 IM

作为 IM 用户，当已绑定的本地 Codex thread 在本地变化时，我可以在 IM 中收到 mirrored progress/output。

当前代码：

- `src/lib/bridge/mirror-runtime.ts` 管理 subscription reconciliation 和 file watchers。
- `src/lib/bridge/mirror-subscription-registry.ts` 决定哪些 bindings 需要 mirror subscriptions。
- `src/lib/bridge/mirror-reconcile-core.ts` 读取 JSONL deltas。
- `src/lib/bridge/mirror-turns.ts` buffer/finalize mirror turns。
- `src/lib/bridge/mirror-feedback-controller.ts` 发送 structured streaming mirror feedback。
- `src/desktop-sessions.ts` 从 JSONL 解析 mirror records。

关键当前规则：

- 如果 binding 对应的 session 有非空 `codex_thread_id`，且 channel adapter active，则该 binding 有 mirror 资格。

### 8. 处理 Permissions 和 Stop 请求

作为 IM 用户，我可以 approve/deny permission requests，也可以停止正在运行的任务。

当前代码：

- `src/lib/bridge/permission-broker.ts` 格式化并跟踪 permission requests。
- `src/permission-gateway.ts` 存储 pending permission waiters。
- `src/lib/bridge/interactive-runtime.ts` 跟踪 active tasks 和 force stop。
- `/stop` 处理当前在 `src/lib/bridge/command-dispatch.ts` 中，由 bridge-manager wiring。

### 9. 创建和管理 `/auto` 定时器任务

作为 IM 用户，我可以安装自动脚本 skill，用文本命令或卡片创建、查看、刷新、重置和删除当前 chat 可见的自动化定时器任务。

当前代码：

- `/auto` 命令入口在 `src/lib/bridge/command/auto.ts`。
- 自动化任务持久化在 `src/lib/bridge/auto-tasks.ts`，数据 schema 在 `schemas/data/auto-tasks.v1.schema.json`。
- 自动化任务表格和卡片在 `src/lib/bridge/command/auto-presentation.ts`。
- 后台触发循环、跨 session 执行、解绑置零和卡片 callback wiring 在 `src/lib/bridge/bridge-manager.ts`。
- 自动脚本创建 skill 在 `skills/codex-to-im-auto/SKILL.md`。

关键当前规则：

- `/auto skill install` 和 `/auto skill uninstall` 是幂等操作：已安装时再次安装不会覆盖，未安装时再次卸载返回未安装。
- `/auto ls` 显示当前 chat 可见的全部自动化任务，包括已经完成或暂停的任务，并返回表格卡片；卡片支持选择任务、删除、设为 1 次和刷新。
- `/auto new <scriptpath> <times>` 绑定到当前 bridge session；用户切换到同一 chat 的另一个 session 后，仍能在 `/auto ls` 中看到旧 session 的任务。
- 自动化任务每次触发会执行脚本，将 stdout 作为 prompt 发给任务所属的原始 bridge session；触发达到 `times` 后状态变为 `completed`，不会继续触发。
- `/auto set <序号> <times>` 会清零 `triggeredCount` 并设置新的总次数；`times > 0` 时重新启动任务，`times = 0` 时暂停。
- 当用户解除某个会话绑定时，该 session 下的自动化任务不会被移除，但 `times` 和 `triggeredCount` 会置 0，状态变为 `completed`；重新绑定或切换到其他 session 后仍可通过 `/auto set` 重新启用。

当前测试覆盖：

- `src/__tests__/bridge-command-e2e.test.ts` 覆盖 skill 装载/卸载幂等、文本链路、卡片链路、跨 session 可见与原 session 触发、达到次数停止后 set 重新触发、解绑置零不移除。

### 10. 在本地 UI 管理 Sessions

作为本地 operator，我可以检查 Bridge sessions 和本地 Codex sessions，查看 history，重命名 session，编辑 session config，指定 channels，删除 sessions，设置 default channel targets。

当前代码：

- UI session list/history/config/delete routes 在 `src/ui-server.ts`。
- UI history conversion 一部分在 `src/ui-session-history.ts`，一部分在 `ui-server.ts`。
- Binding target summaries 在 `src/session-bindings.ts`。

当前耦合点：

- UI 直接重建 session display summaries，而不是使用 `ThreadDisplayService` 或共享 display query。

## 初步业务概念

- Channel instance：配置好的 IM 账号/bot endpoint。
- Channel address：adapter 传入的一个 chat/user context。
- Channel binding：一个 chat 到 Bridge session 的当前或非当前映射。
- Channel default target：应用到 channel instance 下一条新 chat 的预绑定目标。
- Bridge session：本地产品 session 记录，包含配置、runtime health、展示名称和可选 Codex thread identity。
- Codex thread：底层 Codex conversation identity，即 `codex_thread_id`，持久化在 `~/.codex/sessions`。
- Local Codex session：本地可发现的 Codex JSONL 记录，带 `originator/source/cwd/title`；当前部分代码仍以 Desktop 命名。
- Interactive turn：一个 IM-driven prompt，通过 SDK/tmux provider 发送。
- Mirror subscription：一个 binding 对某个 Codex thread JSONL 文件的 watch。
- Display model：暴露给人的 title、cwd、source/provenance、last activity、mode/provider、BridgeSession id；当前 UI 仍有 legacy `targetKey`。
