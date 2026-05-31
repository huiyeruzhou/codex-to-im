## 任务目标

原始指令：`/hot-update 命令要能够按照/tmux-screen的风格每十秒cat一次热更新日志来看`

用户追加：`好的，我需要你后台定时刷新他/hot-update`

用户追加：`当你发现hot-update进程已经推出了的时候就不更新了，这个有吧？`

## 任务上下文

- 仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前环境 `rg` 不可用，检索使用 `find`/`grep`。
- 当前工作树已有未提交改动：`AGENTS.md`、`work/shell-safe-command/STATUS.md`、`work/binding-d492179f-activation/`；这些不属于本任务，不回退、不纳入本阶段提交。
- 开发命令需要使用 Node.js 24：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && ...`。

## 任务日志

### 2026-05-31 23:43 CST 阶段：审计 `/hot-update` 与 `/tmux-screen` 流式刷新路径

阶段描述：确认 `/hot-update` 当前执行与日志路径，复用 `/tmux-screen` 风格的结构化流式卡片刷新能力。

- 行动：检查 `git status --short --branch`，当前 `master...origin/master` 已同步；仍有未提交 `AGENTS.md`、`work/shell-safe-command/STATUS.md`、`work/binding-d492179f-activation/`，本任务不触碰这些无关改动。
- 行动：初步检索到 `/hot-update` 实现在 `src/lib/bridge/command/hot-update.ts`，dispatch 分支在 `src/lib/bridge/command/dispatch.ts`；`/tmux-screen` 的卡片刷新实现位于 `src/lib/bridge/command/tmux.ts` 和 dispatch 中的 `StreamFeedbackTarget` 集成。
- 行动：读取 `src/lib/bridge/command/hot-update.ts`，确认当前流程是解析参数后运行 `bash scripts/hot-update-bridge.sh ...`，脚本返回后把 stdout/stderr 拼到普通文本回复；当前没有 structured streaming card 和日志 monitor。
- 行动：读取 `scripts/hot-update-bridge.sh`，确认默认派发 worker 时会输出：
  - `Hot update log: <log_file>`
  - `Bridge log: <bridge_log>`
  - worker 日志写入 `~/.codex-to-im/logs/hot-update-YYYYMMDD-HHMMSS.log` 或 `/tmp/codex-to-im-logs/...` fallback。
- 行动：读取 `dispatch.ts` 中 `/tmux-screen` 和 `/shell` 的 `StreamFeedbackTarget` 集成，确认可以在 `/hot-update` 分支构造同样的 card adapter，命令层负责定时更新。
- 设计结论：
  - `/hot-update --dry-run` 不派发 worker，也没有 hot update log，保持普通返回。
  - 正常 `/hot-update` 派发成功且 stdout 中有 `Hot update log:` 时，若 adapter 支持 structured streaming UI，则返回流式卡片，并每 10 秒读取一次该 log 文件更新卡片。
  - 日志内容检测到 `[hot-update] completed` 或明显失败标记时自动 finalize；否则 timer 会随当前 bridge 生命周期运行，实际 hot update 重启 bridge 时旧进程 timer 会自然停止。
  - 不支持 structured streaming UI 时保持普通文本回复，并在普通文本中保留 hot update log 路径。
- 行动：修改 `src/lib/bridge/command/hot-update.ts`：
  - 解析脚本 stdout 中的 `Hot update log:` 与 `Bridge log:`。
  - 正常派发后如存在 structured streaming card，则启动 hot update log monitor。
  - monitor 初始立即读一次日志，之后每 10 秒读取一次，卡片中展示执行目录、命令、参数、日志路径、派发输出和 hot update log 内容。
  - 日志包含 `[hot-update] completed` 时 finalize 为 completed；包含明显 failed/error/refusing/required 标记或超过 30 分钟时 finalize 为 error。
- 行动：修改 `src/lib/bridge/command/dispatch.ts`，为 `/hot-update` 构造 `hot-update:<channel>:<chat>:<messageId>` stream key，并接入 `onStreamText` / `onStreamStatus` / `onStreamEnd`。
- 行动：补充 `src/__tests__/command-dispatch.test.ts`，模拟 runner 返回 `Hot update log:`，并断言 `/hot-update --skip-tests` 在 structured streaming UI 下不发送普通文本，而是更新并完成流式卡片，状态中包含 `every 10s`。
- 行动：同步 `src/lib/bridge/command/help.ts`，说明 `/hot-update` 会每 10 秒刷新 hot update log 卡片。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm exec -- node --test --test-concurrency=1 --import tsx --test-timeout=30000 src/__tests__/command-dispatch.test.ts`，通过，40 tests。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`，通过。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`，通过。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`，通过，535 tests。
- 阶段验证：运行 `git diff --check`，通过。
- 当前进入阶段审计：
  - 用户指出 streaming card 显示“处理中”且无法选中；本阶段已移除 `/hot-update` 对 `onStreamText` / `onStreamStatus` / `onStreamEnd` 的依赖，不再创建 structured streaming UI。
  - `/hot-update` 现在派发成功后先发送普通 `OutboundRichCard`；卡片带稳定 `updateKey=hot-update-log:<channel>:<chat>:<messageId>` 和 `updateTtlMs: null`，走与 `/t` 表格同类的 rich card 更新机制。
  - 后台 timer 在初次发送成功并拿到 message id 后启动；生产默认每 10 秒读取一次 hot update log，并通过 `richCardUpdateMessageId` 更新原卡片。
  - 测试中把刷新间隔压到 5ms，验证初始普通 rich card 发送后，日志追加 completed 行会触发同一 `updateKey` 的原消息更新，且 streaming API 如果被调用会直接失败。
  - dry-run、错误和无法解析 hot update log 的场景仍保持普通文本回复，不启动后台 timer。
  - 验证覆盖：定向 command-dispatch、typecheck、build、完整 npm test 均通过。
- 阶段结论：`/hot-update` 已改为普通卡片后台定时刷新，不再使用“处理中”的 streaming card。提交策略：amend 当前本地提交 `Stream hot update logs`，只暂存本任务相关文件。
- 阶段验证和git提交：已执行 `git commit --amend --no-edit`，当前本地提交为 `52610e2 Stream hot update logs`；本次 amend 只纳入 `src/lib/bridge/command/hot-update.ts`、`src/lib/bridge/command/dispatch.ts`、`src/__tests__/command-dispatch.test.ts` 和本 `STATUS.md`。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`，通过。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`，通过。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`，通过，535 tests。
- 阶段验证：运行 `git diff --check`，通过。
- 阶段验证和git提交：当前进入阶段审计。
- 阶段审计：
  - 需求“`/hot-update` 命令要能够按照 `/tmux-screen` 的风格”：dispatch 为 `/hot-update` 构造稳定 stream key，并复用 `pushStreamFeedbackText` / `pushStreamFeedbackStatus` / `finalizeStreamFeedback`，与 `/tmux-screen` 同一类 structured streaming card 更新路径。
  - 需求“每十秒 cat 一次热更新日志来看”：命令层从脚本派发输出解析 `Hot update log:`，启动 monitor；monitor 初始立即读取一次，之后 `setInterval(..., 10 * 1000)` 每 10 秒读取完整日志文件并更新卡片。
  - 日志展示范围：卡片包含执行目录、命令、参数、刷新间隔、hot update log 路径、bridge log 路径、派发输出和 hot update log 内容；日志内容按 24k 字符清理截断，避免卡片过大。
  - 结束条件：日志出现 `[hot-update] completed` 时 finalize 为 completed；出现明显失败标记或超过 30 分钟未完成时 finalize 为 error；热更新真正重启 bridge 时旧进程 timer 会随进程停止。
  - 兼容性：`/hot-update --dry-run` 不派发 worker，保持普通文本回复；不支持 structured streaming UI 的 adapter 也保持普通文本回复。
  - 验证覆盖：新增 command-dispatch 测试证明 structured streaming UI 下 `/hot-update --skip-tests` 不发普通消息、返回 hot update log 卡片、状态包含 `every 10s` 并正常 finalize；定向测试、typecheck、build、完整 npm test 全部通过。
- 阶段结论：`/hot-update` 每 10 秒刷新热更新日志卡片目标已完成。提交时只暂存本任务相关文件，排除既有 `AGENTS.md`、`work/shell-safe-command/STATUS.md` 和其他任务目录。
- 阶段验证和git提交：已创建本地提交 `14652b7 Stream hot update logs`；随后将本提交记录 amend 进同一阶段提交。

### 2026-05-31 23:?? CST 阶段：用户反馈 streaming card 交互状态

阶段描述：用户反馈当前 `/hot-update` 日志卡片显示“处理中”，且处于无法选中的状态，询问是否能像 `/t` 表格一样按需更新，以及二者是否相同。

- 用户问题：`为什么你这个卡片现在的状态是「处理中」，然后处于一个完全无法选中的状态？能不能像/t表格一样按需更新的，还是说这俩其实都一样？`
- 初步解释：当前 `/hot-update` 用的是 structured streaming UI，类似运行中回复卡片；`/t` 表格用的是普通 rich command card + card update，二者不是同一种卡片能力。

### 2026-06-01 00:02 CST 阶段：改为普通 rich card 后台定时刷新

阶段描述：按用户要求取消 `/hot-update` 的 streaming card，改成普通 rich card，并由后台 timer 每 10 秒更新同一张卡片。

- 用户指令：`好的，我需要你后台定时刷新他/hot-update`
- 行动：读取当前 `hot-update.ts` 和 `dispatch.ts`，确认上一阶段实现仍使用 `StreamFeedbackTarget` / `onStreamText` / `onStreamStatus` / `onStreamEnd`，所以飞书会显示“处理中”。
- 行动：改造 `src/lib/bridge/command/hot-update.ts`：
  - `handleHotUpdateCommand()` 改为返回 `{ response, richCard, monitor }`。
  - 正常派发并解析到 `Hot update log:` 后，生成普通 `OutboundRichCard`，带稳定 `updateKey` 和 `updateTtlMs: null`。
  - 新增 `startHotUpdateLogMonitor()`，由后台 timer 每 10 秒读取 hot update log，并用 `deliverBridgeNotice(..., { richCard, richCardUpdateMessageId })` 更新同一张普通 rich card。
  - dry-run、错误和无日志路径场景仍返回普通文本。
- 行动：改造 `src/lib/bridge/command/dispatch.ts`：
  - `/hot-update` 不再构造 streaming card。
  - 初次响应通过普通 rich card 发送；发送成功后拿到 message id，再启动后台日志 monitor。
  - 测试注入 `hotUpdateLogRefreshIntervalMs`，生产默认仍为 10 秒。
- 行动：更新 `src/__tests__/command-dispatch.test.ts`：将 `/hot-update` 测试改为断言不会调用 streaming API；初始发送普通 rich card；后台 timer 追加日志完成行后用相同 `updateKey` 和 `richCardUpdateMessageId` 更新原卡片。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm exec -- node --test --test-concurrency=1 --import tsx --test-timeout=30000 src/__tests__/command-dispatch.test.ts`，通过，40 tests。

### 2026-06-01 00:17 CST 阶段：hot-update worker 退出检测

阶段描述：补齐 `/hot-update` 后台日志卡片的停止条件：如果派发的 hot-update worker 进程已经退出，但日志没有写出 completed/error，也应该停止继续刷新并将卡片标为异常结束。

- 用户纠偏：用户询问“发现 hot-update 进程已经退出了就不更新了，这个有吧？”；当前审计结论是“没有直接查 PID 存活”，只能靠日志 completed/error、30 分钟超时或 bridge 进程重启自然停止。
- 用户追加：完成之后 push 当前改动。
- 行动：开始读取当前 `src/lib/bridge/command/hot-update.ts`、`src/lib/bridge/command/dispatch.ts`、`scripts/hot-update-bridge.sh` 和相关测试，准备解析脚本输出中的 `PID:` 并在 monitor tick 中检查 worker 是否仍存活。
- 行动：修改 `src/lib/bridge/command/hot-update.ts`，为 `HotUpdateLogMonitorSpec` 增加 `workerPid`；从派发输出的 `PID:` 解析正整数；刷新卡片时展示 Worker PID；每次后台刷新先读 hot update log，如果日志未 completed/error 且 `process.kill(pid, 0)` 判断 worker 不存在，则将状态置为 error、写入“PID 已退出，停止刷新”的说明并清理 timer。
- 行动：补充 `src/__tests__/command-dispatch.test.ts` 回归测试：模拟脚本派发输出一个不存在的 worker PID，日志没有 completed/error；断言初始卡片正常发送，后台刷新一次后更新为“热更新异常”，footer 包含 PID 已退出说明，并且后续不再继续更新。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm exec -- node --test --test-concurrency=1 --import tsx --test-timeout=30000 src/__tests__/command-dispatch.test.ts`，通过，41 tests。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`，通过。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`，通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- 阶段验证：运行 `git diff --check`，通过。
- 阶段验证：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`，通过，536 tests。
- 阶段验证和git提交：当前进入阶段审计。
- 阶段审计：
  - 需求“发现 hot-update 进程已经退出就不更新”：脚本派发输出已有 `PID: ...`；当前实现会解析该 PID，写入 monitor spec，并在每次后台刷新时用 `process.kill(pid, 0)` 检查 worker 是否仍存在。日志未 completed/error 且 PID 已退出时，最终更新一次异常卡片并清理 timer。
  - 需求“不要误判正常完成”：monitor 先读取并检测日志状态；如果日志已经有 `[hot-update] completed`，优先走 completed，不再因为 worker 已退出标红。
  - UI 可观察性：卡片字段新增 `Worker PID`；异常 footer 会说明 `hot update worker PID ... 已退出，但日志未写出 completed；停止刷新。`
  - 回归覆盖：新增 command-dispatch 测试验证不存在 PID 的异常退出路径会停止后续更新；既有 completed 测试继续覆盖正常完成路径。
  - 验证覆盖：定向 command-dispatch、typecheck、build、diff check、完整 npm test 均通过。
- 阶段结论：本阶段满足用户纠偏。接下来只暂存 `src/lib/bridge/command/hot-update.ts`、`src/__tests__/command-dispatch.test.ts`、本 `STATUS.md`，amend 到当前 `Stream hot update logs` 本地提交，然后按用户追加要求 push。
- 阶段验证和git提交：已执行 `git commit --amend --no-edit`，本阶段代码、测试和状态记录已 amend 到同一 `Stream hot update logs` 本地提交；接下来按用户要求 push `master`。
