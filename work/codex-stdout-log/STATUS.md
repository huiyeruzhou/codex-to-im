## 任务目标

原始指令：按照你刚才说的，把codex启动的stdout也打印进日志，并且也要回显给用户。

## 任务日志

### 阶段：定位 Codex 启动输出链路 - 2026-06-01 12:47

- 已检查工作树，存在 AGENTS.md、work/shell-safe-command/STATUS.md 以及若干 work 目录的既有改动；本任务只处理 stdout 日志/回显相关代码和本状态文件。
- 环境缺少 rg，改用 find/grep 搜索 Codex 启动、stdout、stderr、spawn 相关代码。

- 已确认 `@openai/codex-sdk` 内部把 Codex CLI stdout 当 JSONL 读取并解析成 ThreadEvent；当前 `src/codex/provider.ts` 只记录启动参数预览，没有记录每行 stdout。
- 回显链路在 `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts`，`status.reasoning` 已能进入流式预览；本阶段将复用 `status` 事件携带 `codex_stdout`，避免改动外部协议的大结构。

### 阶段：实现 stdout 日志与用户回显 - 2026-06-01 12:55

- 修改 `src/codex/provider.ts`：每个 SDK ThreadEvent 还原为一行 JSON stdout，使用 `[codex-provider] Codex stdout:` 写入日志，并通过 `status.codex_stdout` 进入 SSE 流。
- 修改 `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts`：消费 `status.codex_stdout` 时追加 `Codex stdout` 代码块到流式预览，从而回显给用户。
- 增加 provider 测试覆盖 stdout 日志和 status 事件，增加 conversation engine 测试覆盖 stdout status 到预览的回显。

- 阶段审计：当前进入阶段审计。
- 重新对照目标：Codex 启动后的 SDK stdout 现在会以 `[codex-provider] Codex stdout:` 写入 bridge 日志；同一 stdout 行通过 `status.codex_stdout` 进入流式预览并回显给用户。
- 验证结果：`npm run typecheck` 通过；针对性 `node --test --import tsx src/__tests__/codex-provider.test.ts src/__tests__/interactive-turn-sdk-conversation-engine.test.ts` 通过；完整 `npm test` 通过，543 个测试全部通过。
- 审计结论：本阶段目标完成，未修改既有无关工作树改动。准备提交本地 git commit。
- 阶段验证和git提交：待提交。
- 阶段验证和git提交：已创建本地提交 `6a31a1e Log and echo Codex stdout`，随后把提交结果补写入 STATUS 并 amend 到同一提交。
