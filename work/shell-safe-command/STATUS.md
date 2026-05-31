## 任务目标

原始指令：`/t和表格也支持归档命令。完成后commit一下，然后开发一个/shell命令，做好危险命令审计，必要时提醒用户，包括rm等高风险操作，单独的'/'（很有可能是绝对路径打出了空格），或者我记得codex是有自己的sandbox的，看看能不能用那个执行命令，并且强制即使是yolo mode下也要用sandbox？`

## 任务上下文

- 仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前工作树已有与本任务无关的改动：`AGENTS.md`、`work/auto/STATUS.md`、`work/bridge-started-card/STATUS.md`、大量 `work/rebuild/*` 删除、`work/rebuild/manual-audit.md`、`work/tmux-feishu-parse-optimization/STATUS.md`；本任务不能回退或纳入这些改动。
- 当前环境 `rg` 不可用，检索使用 `find`/`grep`。
- 已有提交 `6566649 Add /t archive for Codex sessions` 实现 `/t archive` 纯文本命令：支持当前线程归档、按全局 `/t` 列表序号归档、解绑/清理 linked BridgeSession，并已有 command-dispatch 测试。
- 当前 `/t` 全局 Codex 会话卡片已经有“绑定/解绑/激活/新建/刷新”按钮，footer 提到 `/t archive 1`，但动作按钮和回调解析还不支持 `archive`。
- 当前 `command-callbacks.ts` 的 `buildThreadActionCallbackData()` 只允许 `bind|rm|use`；`bridge-manager.ts` 的 `parseThreadSelectActionCallback()` 和回调命令生成也只允许 `bind|rm|use`。
- 当前 `/t ls` 绑定表选择值是 binding id；如果绑定表要支持归档所选绑定背后的 Codex thread，需要 `/t archive <binding-id>` 能解析到该 binding 的 `codex_thread_id`，或回调层把 binding id 转成 thread id。
- 官方 Codex 文档确认 Codex local/CLI 有 sandbox 概念，`workspace-write` 是默认/推荐的受限写模式，`danger-full-access` 会移除本地 sandbox 限制且只应在受控环境使用；这支持 `/shell` 需要强制受限 sandbox、不能沿用 yolo 的危险全权模式。

## 任务日志

### 2026-05-31 21:38 CST 阶段：审计 `/t archive` 表格支持现状

阶段描述：基于当前工作树确认 `/t archive` 纯文本命令已存在，定位表格/卡片缺口。

- 行动：检查 `git status` 和最近提交，确认 HEAD 为 `6d2ed2b Update /his history command defaults`，其父提交中已有 `Add /t archive for Codex sessions`；工作树仍有多处 unrelated 改动。
- 行动：检查 `src/lib/bridge/command/session-thread.ts`，确认 `/t archive` 分支已实现，且不做 active task 阻断；归档后调用 registry archive、`onBindingRemoved` 和 mirror reconcile。
- 行动：检查 `src/lib/bridge/command/presentation.ts`、`src/lib/bridge/command-callbacks.ts`、`src/lib/bridge/bridge-manager.ts`，确认卡片/表格目前只有 `bind/rm/use` 交互按钮，尚无 `archive` action。
- 行动：检查测试，确认已有 `/t archive` alias、当前归档、按全局列表序号归档测试；尚缺卡片 archive action、回调 archive action、绑定表所选绑定归档测试。
- 下一个阶段计划：补全卡片 action 类型、全局/绑定表归档按钮与回调命令生成；必要时增强 `/t archive <binding-id>` 解析；补测试后提交一个归档表格支持阶段。

### 2026-05-31 21:42 CST 阶段：补齐 `/t` 表格归档动作并提交

阶段描述：让 `/t` 全局表和 `/t ls` 绑定表都能通过卡片按钮归档所选 Codex thread，并验证不会破坏已有切换/解绑行为。

- 行动：修改 `src/lib/bridge/command-callbacks.ts`，把 thread card action 类型从 `bind|rm|use` 扩展为 `bind|rm|use|archive`。
- 行动：修改 `src/lib/bridge/command/presentation.ts`，在全局 Codex 会话卡片和当前聊天绑定卡片中增加“归档”危险按钮；保留原有绑定、解绑、激活、刷新按钮。
- 行动：修改 `src/lib/bridge/bridge-manager.ts`，让 `cti-thread-action:*:archive` 回调合法，并把全局表归档回调转成 `/t archive <thread-id>`，绑定表归档回调转成 `/t archive <binding-id>`。
- 行动：修改 `src/lib/bridge/command/session-thread.ts`，让 `/t archive <binding-id>` 解析当前聊天绑定表，找到 binding 背后的 Codex thread 后复用既有 archive 流程；纯数字仍优先按 `/t` 全局列表序号解析，保持 `/t archive 1` 的既有语义。
- 行动：补充测试：
  - `src/__tests__/bridge-command-e2e.test.ts` 覆盖 `/t` rich card 选择会话后点击“归档”，确认 JSONL 被移走、聊天未绑定、卡片更新原消息。
  - `src/__tests__/command-dispatch.test.ts` 覆盖 `/t archive <binding-id>` 可以归档绑定背后的 Codex thread。
  - `src/__tests__/bridge-manager.test.ts` / 既有 command-dispatch 断言更新，确认表格动作中包含“归档”。
- 行动：首次定向测试发现既有绑定表按钮期望未包含“归档”，以及测试对标题的断言与现有 display title 规则不一致；已按产品实际行为修正测试。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/bridge-manager.test.ts src/__tests__/command-dispatch.test.ts src/__tests__/bridge-command-e2e.test.ts`，结果 122 个测试全部通过。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`，通过。
- 行动：运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`，通过。
- 阶段验证和git提交：当前进入阶段审计。
- 阶段审计：
  - 需求“`/t` 支持归档命令”：已有纯文本 `/t archive`，本阶段额外保持 `/t archive <binding-id>` 可用；数字序号仍走全局 `/t` 列表，未改变既有语义。
  - 需求“表格也支持归档命令”：全局 `/t` 卡片和绑定 `/t ls` 卡片都增加“归档”按钮；回调解析允许 `archive`；全局表按所选 thread id 归档，绑定表按所选 binding id 归档其 Codex thread。
  - 风险审计：绑定表中非 Codex thread 归档会返回“不是本地 Codex 会话，不能归档”，避免误把普通 IM 绑定当 Codex session 处理。
  - 验证覆盖：卡片按钮生成、回调归档、binding id 归档、原有绑定/切换/解绑流程均被定向测试覆盖；typecheck/build 通过。
- 阶段结论：归档命令和表格归档支持完成。
- 阶段验证和git提交：已创建本地提交 `Add thread archive card action`；随后将本提交记录 amend 进同一阶段提交。
- 下一个阶段计划：amend 状态记录后进入 `/shell` 命令设计与实现阶段。
