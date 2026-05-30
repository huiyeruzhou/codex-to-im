# 普通对话停止后的 mirror 抑制修复

## 任务目标

原始指令：

- 我发现普通对话点停止之后，会冒出来一个mirror，这不太好哦，fix一下。一看就是终止mirror抑制没等到最后一个completed事件出来

## 任务上下文

- 当前仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前时间：`2026-05-30 19:33 CST`。
- 当前主工作树存在既有 unrelated 改动：`AGENTS.md`、`work/auto/STATUS.md`、`work/develop/STATUS.md`、大量 `work/rebuild/*` 删除和 `work/rebuild/manual-audit.md`；本任务不纳入、不回滚这些改动。
- 当前本地 `master` 相对 `origin/master` 显示 ahead 7 / behind 8，这是上一阶段为避免触碰脏工作树而通过 detached worktree rebase/push 后留下的本地主分支状态；本任务以当前工作树源码为权威，不先做 destructive 同步。

## 任务日志

### 2026-05-30 19:33 CST 阶段：定位 stop 后 mirror 冒出

阶段描述：复现和定位普通对话点击停止后的 mirror suppression 生命周期，确认是否因为 stop/终止路径过早释放 suppression，导致最后一个 completed/task_complete 事件被 mirror runtime 作为外部消息投递。

- 行动：已记录用户原始目标，并确认本阶段需要围绕“普通对话点停止后不应冒出额外 mirror”补修复和回归测试。
- 行动：已确认当前工作树存在 unrelated 改动，本阶段只处理本目标相关文件。
- 行动：已定位普通对话 stop 路径：`runInteractiveMessage()` 的 `finally` 中当 `finalOutcome === 'aborted'` 会调用 `abortMirrorSuppression()`；该函数若已有 tracked turn id，会把 turn 加入 `ignoredTurnIds` 后立刻清掉全局 suppression；若未拿到 tracked turn id，则只保留 `suppressionWindowMs` 默认 4 秒。
- 行动：已定位 suppression 状态机：`filterSuppressedMirrorRecords()` 在 `droppingTurn` 状态下会丢弃当前 turn 的 mirror 记录，并在 `task_complete` 时清理 suppression；但当前没有把 `task_aborted` 当作终止事件，且 abort 路径可能在最后一个 terminal record 到达前过早释放 suppression。
- 行动：当前判断：用户描述的“点停止后冒出来一个 mirror”符合 abort 后 suppression 未等最后 terminal record 的时序缺口，尤其是缺少 `turnId` 或 terminal 事件晚于 4 秒窗口时会复现。
- 行动：已修改 `src/lib/bridge/mirror-suppression.ts`：新增 terminal record 判断，把 `task_complete` 和 `task_aborted` 都作为当前 mirror turn 的结束事件；`abortMirrorSuppression()` 在 suppression 仍处于 `awaitingPromptMatch` 或 `droppingTurn` 时不再立即清理或只给 4 秒窗口，而是延长到 prompt match grace，等待 terminal record 清理。
- 行动：已修改 `src/__tests__/bridge-manager.test.ts`：更新 abort suppression 用例，断言 stop 后 suppression 会保留到 `task_aborted`；新增无 `turnId` 的 stopped tail 用例，模拟 abort 5 秒后才出现 assistant tail + `task_complete`，断言这些记录不会被 mirror 投递，terminal 后 suppression 释放。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/bridge-manager.test.ts`：通过，72/72。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/mirror-runtime.test.ts src/__tests__/interactive-turn-runner.test.ts src/__tests__/turn-coordinator.test.ts`：通过，23/23。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; npm run typecheck`：通过。
- 行动：验证命令 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh; nvm use 24; npm test`：通过，504/504。
- 行动：当前进入阶段审计。
- 阶段验证和git提交：审计结论：本阶段满足用户目标。普通对话 stop 后，abort 路径不会在 `task_complete` / `task_aborted` 前过早释放当前 IM-originated mirror turn；无 `turnId` 且 terminal record 晚于原 4 秒 abort 窗口的 stopped tail 已有回归测试证明不会被投递成 mirror；`task_aborted` 也会作为 terminal record 清理 suppression，避免长期残留。完整测试和 typecheck 均通过。已执行 `git commit -m "Fix stopped mirror suppression"`，提交记录随后 amend 本状态文件；最终提交 hash 以 `git log -1` 为准。
- 下一个阶段计划：当前目标已完成；不处理 unrelated 工作树改动。
- 阶段验证和git提交：待完成。
