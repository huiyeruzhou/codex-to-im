## 任务目标

原始指令：查现在的 bridge 日志，说明 2026-06-01 18:37 `/new` 出来的 tmux provider 为什么没有启动成功，为什么 `/` 命令也没有返回 `codex_thread_id`。

补充要求：先定位日志，dump 后续几十条仔细看；然后在新的 worktree 中继续查清楚这件事。

## 任务日志

### 阶段 1：日志定位与初步证据固化

- 已从主工作树创建独立 worktree：`/data00/home/hongli.fish/Codex/codex-to-im-tmux-bootstrap-dangling`，分支 `work/tmux-bootstrap-dangling`。
- 主工作树存在无关未提交改动，本任务在独立 worktree 继续，避免回退或混入其它改动。
- 目标日志文件：`/home/hongli.fish/.codex-to-im/logs/bridge.log`。
- 精确日志位置：`bridge.log:35921` 开始。
- 关键时间换算：用户说的 18:37 CST 对应日志中的 `2026-06-01T10:37Z`。

#### 18:37 事件链

- `10:37:41.668` 收到 `/new`。
- `10:37:42.318` `/new` 回包成功。
- audit 记录 binding 切换：从 session `a1c58ff9-1b6a-42ec-aaaa-863284a3ba54` 切到新 session `52f0213d-2552-4602-b3fa-70065a0ff42e`。
- `/new` 回显 Provider 为 `tmux (全局默认)`，说明配置显示层读到了全局默认 provider。
- `10:37:46.416` 收到普通消息 `hi`。
- `10:37:46.423` 出现 `[codex-routing-provider] Route Codex request`：
  - `bridge_session_id: 52f0213d-2552-4602-b3fa-70065a0ff42e`
  - `provider: sdk`
  - `configured_provider: sdk`
  - `default_provider: tmux`
- 这条 `provider=sdk` 不能直接解释为整轮普通消息走 SDK，因为 audit 后续回显包含 tmux 底层命令；更像是 tmux provider 自动转发前的 SDK bootstrap 子请求，用来生成 `codex_thread_id`。
- `10:37:46.429` SDK bootstrap 启动 `codex exec`，`thread_id: undefined`。
- `10:37:49.125` bootstrap 路径报错：`TypeError [ERR_INVALID_STATE]: Invalid state: Controller is already closed`，位置 `dist/daemon.mjs:3936:28`。
- `10:37:50.404` mirror runtime 清理刚生成的 thread：
  - `Clearing dangling Codex thread 019e82c2-d31c-7810-ab30-a9c2629018cf`
  - `for session 52f0213d-2552-4602-b3fa-70065a0ff42e`
  - 原因：`Codex thread no longer exists locally`
- `10:37:52.344` `hi` 的回包成功，audit 摘要显示“tmux 发送结果”和真实 tmux 命令：
  - `tmux has-session -t codex_019e82c2-d31c-7810-ab30-a9c2629018cf`
  - `tmux has-session -t codex_019e82c2-d31c-7810-ab30-a9c2629018cf`
  - `tmux ne...`
- 当前系统里 `tmux ls` 已不存在 `codex_019e82c2-d31c-7810-ab30-a9c2629018cf`，且 `~/.codex/sessions` 中找不到 `019e82c2-d31c-7810-ab30-a9c2629018cf` 的 JSONL。
- 当前 `sessions.json` 中 session `52f0213d-2552-4602-b3fa-70065a0ff42e` 保留了：
  - `codex_provider: "tmux"`
  - `tmux_session_name: "codex_019e82c2-d31c-7810-ab30-a9c2629018cf"`
  - `tmux_auto_enter: false`
  - 但没有 `codex_thread_id`
- `10:38:07.574` 收到 `/`。
- `10:38:09.001` `/` 回包成功，但 audit 没有显示 outbound 正文；结合当前 session 状态可解释为：此时 `codex_thread_id` 已被 dangling 清理，所以 `/current` 无法返回 thread id。
- `10:38:39.989` 用户 `/t use 5678464a` 切回原 session `a1c58ff9-1b6a-42ec-aaaa-863284a3ba54`。

#### 初步判断

当前最可疑根因不是“完整配置系统没有生效”，也不是“整轮消息走了 SDK”。日志同时证明：

- 显示层和 `/new` 回显读到了全局默认 `tmux`。
- 普通消息最终确实走到了 tmux `/tmux` 发送路径，因为回显有 tmux 底层命令。
- 中间 `provider=sdk configured_provider=sdk` 更可能是 `bootstrapCodexThreadWithSdk()` 的强制 SDK 子请求。
- 真正破坏结果的是：bootstrap 生成的 `019e82c2...` 很快被 mirror runtime 当作 dangling thread 清掉，导致 `/` 后续看不到 `codex_thread_id`。

下一步：在 worktree 中查 `bootstrapCodexThreadWithSdk()`、SDK stream close 报错、mirror dangling 清理阈值和订阅创建时序，确认为什么刚 bootstrap 出来的 thread 会被立即清理，以及为什么 tmux session 启动后没有留下可用 pane/session。

### 阶段 2：根因确认、修复和测试

- 根因确认：
  - `ensureCodexTmuxSessionForProvider()` 在默认 tmux provider 的第一条普通消息中先调用 SDK bootstrap 创建 Codex thread。
  - bootstrap 一拿到 `status.session_id` 就 abort/cancel SDK stream，并立即写入 `codex_thread_id` 且触发 mirror reconcile。
  - 真实 Codex 的 JSONL/session index 落盘存在短暂延迟；mirror 在这段时间内通过 `getCodexSessionByThreadIdSafe()` 查不到刚创建的 thread。
  - dangling mirror 策略连续几轮查不到本地 Codex thread 后，会调用 `clearSessionCodexThreadId()`。因此刚 bootstrap 出来的 `019e82c2-d31c-7810-ab30-a9c2629018cf` 被误判成 dangling 并清除。
  - SDK stream cancel 还会在 provider 侧表现为 `Controller is already closed`，该错误进一步说明 bootstrap 退出时序不干净。
- 修复：
  - `src/lib/bridge/command/runtime-settings.ts`：`bootstrapCodexThreadWithSdk()` 拿到 thread id 后先等待短时间，直到本地 Codex session 可见，再 abort/cancel stream。
  - `src/lib/bridge/command/tmux.ts`：去掉 bootstrap 只写 `codex_thread_id` 后的过早 mirror reconcile；等 tmux provider session 状态落库后再 reconcile。
  - `src/codex/provider.ts`：识别 ReadableStream consumer cancel，避免正常取消时继续 enqueue/close 并把 `Controller is already closed` 当成 provider 错误清缓存。
- 测试补强：
  - `src/__tests__/bridge-command-e2e.test.ts` 新增回归：SDK 先返回 `status.session_id`，Codex JSONL 延迟写入；之后连续三次 mirror reconcile，断言 `codex_thread_id` 仍保留且 mirror subscription 指向 JSONL。
  - `src/__tests__/real-codex-tmux-provider.e2e.test.ts` 新增默认 skip 的真实 e2e。显式设置 `CTI_REAL_CODEX_TMUX_E2E=1` 时，走真实 `CodexProvider -> @openai/codex-sdk -> codex exec -> tmux`；仅 model provider 由测试内本地 Responses proxy 模拟。
  - 真实 e2e 的本地 Responses proxy 同时支持 Codex 0.135 的 `/v1/responses` WebSocket 和 POST SSE fallback，记录真实 provider 请求，并断言 `model`、`reasoning.effort`、bootstrap prompt 确实传入 provider。
  - 真实 e2e cleanup 覆盖 tmux session、临时 workdir、临时 `CODEX_HOME`、生成的 Codex thread JSONL/session_index 记录、环境变量恢复和 bridge runtime reset。
- 验证：
  - 已通过：`npm run typecheck`。
  - 已通过：目标 fake 回归和 dangling 单测：
    `node --test --test-concurrency=1 --import tsx --test-timeout=15000 --test-name-pattern "keeps a bootstrapped tmux provider thread|initializes a default tmux provider|bootstraps a codex thread before starting tmux provider|clears dangling Codex thread ids" src/__tests__/bridge-command-e2e.test.ts src/__tests__/bridge-manager.test.ts`
  - 已通过：默认 skip 的真实 e2e：
    `node --test --test-concurrency=1 --import tsx --test-timeout=15000 src/__tests__/real-codex-tmux-provider.e2e.test.ts`
  - 已通过：显式真实 e2e：
    `CTI_REAL_CODEX_TMUX_E2E=1 node --test --test-concurrency=1 --import tsx --test-timeout=130000 src/__tests__/real-codex-tmux-provider.e2e.test.ts`
  - 已通过：`git diff --check`。
- 后续补充：
  - 完整 `bridge-command-e2e.test.ts` 曾暴露 `/t use 1/2` 的旧顺序假设；已在阶段 3 按“活跃时间越新越靠前”的新语义修正。

### 阶段 3：`/t` / `/t ls` 活跃时间排序与真实用户故事 e2e

- 排序修复：
  - `src/lib/bridge/command/thread-display.ts`：恢复 `/t ls` 当前聊天绑定表的活跃时间降序排序，`/t use <序号>` 和 `/t detach <序号>` 继续复用同一排序结果，保证显示与操作一致。
  - `src/lib/bridge/command/thread-display.ts`：`/t` 全局表中的 Bridge-only 项也按同一活跃时间降序排序，避免旧 Bridge 会话排在新 Bridge 会话前面。
  - `src/lib/bridge/command/presentation.ts`、`src/lib/bridge/command/session-thread.ts`：`/t` 全局表改为把 Bridge-only 和本地 Codex 会话合并成同一份活跃时间降序列表；文本表、卡片下拉、`/t <序号>`、`/t attach <序号>`、`/t archive <序号>` 共用同一序号语义。
- 旧 e2e 用户故事更新：
  - `src/__tests__/bridge-command-e2e.test.ts`：多绑定普通消息流程改为断言 `/t ls` 中最新活跃绑定排第 1，并按新序号完成 `/t use`、后台任务切换和 `/t detach`。
  - `src/__tests__/bridge-command-e2e.test.ts`：Bridge-only 全局 `/t` 归档流程改为断言最新活跃 Bridge 会话优先，并按新全局序号归档。
  - `src/__tests__/bridge-command-e2e.test.ts`：新增跨 Bridge-only / Codex 的 `/t` 全局排序回归，断言更新的本地 Codex 会话可排在 Bridge-only 会话前，且 `/t 1` 接管的对象与表格第 1 行一致。
- 新真实 e2e 用户故事：
  - `src/__tests__/real-codex-tmux-provider.e2e.test.ts` 新增默认 skip 的真实多绑定用户故事。显式设置 `CTI_REAL_CODEX_USER_STORY_E2E=1` 时，走真实 `CodexProvider -> @openai/codex-sdk -> codex exec`，模型侧仍使用测试内本地 Responses proxy。
  - 该真实故事覆盖：`/new real-a`、真实 Codex 普通消息、`/new real-b`、`/t ls` 按活跃时间排序、`/t use 2` 切回旧线程、旧线程再次活跃后重新排到第 1、再用 `/t use 2` 切回另一个线程。
  - cleanup 覆盖临时 `CODEX_HOME`、临时 workdir、生成的 Codex thread JSONL/session_index 记录、环境变量恢复和 bridge runtime reset。
- 最新验证：
  - 已通过：`env -u NODE_OPTIONS PATH=/data00/home/hongli.fish/.nvm/versions/node/v24.12.0/bin:$PATH npm run typecheck`。
  - 已通过：`env -u NODE_OPTIONS PATH=/data00/home/hongli.fish/.nvm/versions/node/v24.12.0/bin:$PATH node --test --test-concurrency=1 --import tsx --test-timeout=20000 --test-name-pattern "routes normal messages to the active binding|lists inactive /new bridge sessions|keeps a bootstrapped tmux provider thread|initializes a default tmux provider|bootstraps a codex thread before starting tmux provider|clears dangling Codex thread ids" src/__tests__/bridge-command-e2e.test.ts src/__tests__/bridge-manager.test.ts`。
  - 已通过：`env -u NODE_OPTIONS PATH=/data00/home/hongli.fish/.nvm/versions/node/v24.12.0/bin:$PATH node --test --test-concurrency=1 --import tsx --test-timeout=30000 src/__tests__/bridge-command-e2e.test.ts`（28/28）。
  - 已通过：`env -u NODE_OPTIONS PATH=/data00/home/hongli.fish/.nvm/versions/node/v24.12.0/bin:$PATH node --test --test-concurrency=1 --import tsx --test-timeout=15000 src/__tests__/real-codex-tmux-provider.e2e.test.ts`（默认 skip 检查）。
  - 已通过：`env -u NODE_OPTIONS PATH=/data00/home/hongli.fish/.nvm/versions/node/v24.12.0/bin:$PATH CTI_REAL_CODEX_USER_STORY_E2E=1 node --test --test-concurrency=1 --import tsx --test-timeout=130000 --test-name-pattern "routes a real multi-binding user story" src/__tests__/real-codex-tmux-provider.e2e.test.ts`。
  - 已通过：`env -u NODE_OPTIONS PATH=/data00/home/hongli.fish/.nvm/versions/node/v24.12.0/bin:$PATH git diff --check`。
