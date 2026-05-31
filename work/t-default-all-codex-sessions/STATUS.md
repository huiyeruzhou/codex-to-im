# /t 默认显示所有 Codex 会话

## 任务目标

### 原始指令

- `/t默认显示所有codex会话，并且去掉字数过多就fallback到普通文本的设定`

### 用户追加和纠偏

- 2026-05-31 20:07 CST 用户纠偏：`/t` 默认展示仍保留 200 条上限；但达到上限时需要告诉用户。
- 2026-05-31 20:08 CST 用户进一步纠偏：特别是 `/t` 的文本形式一定要有上限，并且默认值还是 10。

## 任务上下文

- 当前仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前时间：`2026-05-31 20:02 CST`。
- 当前环境 `rg` 不可用，检索使用 `find`/`grep`。
- 当前工作树存在既有 unrelated 改动：`AGENTS.md`、`work/auto/STATUS.md`、`work/bridge-started-card/STATUS.md`、大量 `work/rebuild/*` 删除、`work/rebuild/manual-audit.md`、`work/tmux-feishu-parse-optimization/STATUS.md`；本任务不回滚、不纳入。
- 初步 grep 显示 `/t` 文档和命令展示集中在 `src/lib/bridge/command/presentation.ts`、`src/ui/shell.ts`，命令别名在 `src/lib/bridge/command/aliases.ts`。

## 任务日志

### 2026-05-31 20:02 CST 阶段：调整 /t 会话列表默认展示与富卡降级策略

阶段描述：定位 `/t` 默认列表数量和富卡过长 fallback 普通文本的实现，改为 `/t` 默认展示所有 Codex 会话，并移除“字数过多就 fallback 到普通文本”的设定。

- 行动：已记录用户原始目标。当前阶段先从工作树取证，不沿用历史记忆；本任务状态目录为 `work/t-default-all-codex-sessions/`。
- 行动：已确认 `rg` 不可用；`git status --short` 显示存在多项既有无关改动，本阶段只处理 `/t` 命令展示、相关文档和测试。
- 行动：2026-05-31 20:02 CST 已定位当前实现：`src/lib/bridge/command/aliases.ts` 中 `DEFAULT_CODEX_THREAD_LIST_LIMIT = 10`，`parseCodexThreadListArgs('')` 返回 `{ showAll: false, limit: 10 }`；`src/lib/bridge/command/session-thread.ts` 的 `/t add` 和卡片刷新也使用默认 10；`src/lib/bridge/command/presentation.ts` 中 `buildCodexThreadsCommandCard` 超过 `CODEX_THREADS_CARD_MAX_ITEMS = 20` 会返回 `null`，导致命令结果只剩普通文本。
- 行动：2026-05-31 20:02 CST 同步发现文档引用：`src/lib/bridge/command/help.ts`、`src/ui/shell.ts`、`buildStartCommandResponse` 和 `/t` footer 仍说明“最近 10 / /t all 更多”，需要随行为一起更新，避免用户继续被旧提示误导。
- 行动：2026-05-31 20:05 CST 已完成第一轮实现：`parseCodexThreadListArgs('')` 改为 `{ showAll: true, limit: 200 }`，`DEFAULT_CODEX_THREAD_LIST_LIMIT` 对齐最大 200；全局 thread 卡片刷新改用 showAll；`/t add` 的序号选择随默认列表覆盖最多 200 条；`buildCodexThreadsCommandCard` 不再因 Codex 会话超过 20 条返回 `null`。
- 行动：2026-05-31 20:05 CST 已同步用户可见文案：`/start`、`/help`、UI 命令说明、诊断提示、`/t` 命令 footer 中的“最近 10/更多 all/过长只发文本”已改为 `/t` 默认显示最多 200 条，`/t n 100` 才是收窄最近 100 条。
- 行动：2026-05-31 20:08 CST 二次审计目标措辞后决定收紧口径：用户要求“所有 Codex 会话”，不能把完成标准降格为现有 `/t all` 的最多 200 条。下一步将 `/t` 和 `/t all` 改为不传 limit、真正列出全部；`/t n <数量>` 仍保留显式收窄和 200 上限。
- 行动：2026-05-31 20:07 CST 用户纠偏后调整方向：恢复 `/t` 和 `/t all` 的 200 条上限；新增达到上限时的用户可见提示。此前“不传 limit 真正全部”的中间改法不作为最终目标。
- 行动：2026-05-31 20:08 CST 用户进一步明确“文本形式”默认仍应是 10。最终实现口径调整为：`/t` 的纯文本响应/卡片失败 fallback 默认最多 10 条；富卡不再因超过 20 条被预先取消，可显示最多 200 条；达到 200 条上限时在富卡和文本提示中告诉用户。
- 行动：2026-05-31 20:10 CST 已按最终口径改实现：`parseCodexThreadListArgs('')` 恢复 `{ showAll: false, limit: 10 }`；`handleCodexThreadsCommand` 将文本响应与富卡数据源拆开，默认 `/t` 文本最多 10 条，富卡单独读取最多 200 条；`/t all` 文本和富卡均最多 200 条；`buildCodexThreadsCommandCard` 移除 20 条以上返回 `null` 的降级；达到 200 条时文本和富卡 footer 都会出现上限提示。
- 行动：2026-05-31 20:10 CST 已将上述规则写入 UT：`bridge-manager.test.ts` 覆盖解析默认 10、200 上限提示、富卡 200 行不降级；`command-dispatch.test.ts` 用 200 条 Codex session fixture 验证 `/t` 实际发送时文本 fallback 是最近 10 条而 rich card 是 200 条，并且两者都有上限提示。
- 行动：2026-05-31 20:13 CST 首次定向测试失败：`command-dispatch.test.ts` 新增断言使用行首匹配，但 Markdown 响应会以 `**最近 10 条本地 Codex 会话**` 开头。实现行为正确，已把断言改为包含匹配。
- 行动：2026-05-31 20:16 CST 定向测试通过：`node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/bridge-manager.test.ts src/__tests__/command-dispatch.test.ts`，99 个测试全部通过。类型检查通过：`npm run typecheck`。构建通过：`npm run build`，输出 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`，当前未产生 dist 工作树改动。
- 行动：2026-05-31 20:16 CST 追加文案审计发现一处“查看完整列表”仍不精确；已改为“查看最多 200 条卡片列表”，与文本默认 10 / 卡片最多 200 的口径一致。
- 行动：2026-05-31 20:18 CST 文案收口后复跑验证通过：`node --test --test-concurrency=1 --import tsx --test-timeout=20000 src/__tests__/bridge-manager.test.ts src/__tests__/command-dispatch.test.ts && npm run typecheck`，99 个测试全部通过，typecheck 通过。随后 `npm run build` 通过，未产生 dist 工作树改动。
- 阶段验证和git提交：当前进入阶段审计。对照最新目标：`/t` 的文本形式仍默认 10 条且有上限；卡片形式最多 200 条；Codex 会话卡片不再因为超过 20 条而 fallback 成普通文本；达到 200 条显示上限时文本和卡片都会提示；上述关键规则均有 UT 覆盖。当前 grep 未发现 Codex 会话列表还存在“超过条数只发送文本列表/避免卡片过长”的旧提示。
- 阶段验证和git提交：验证通过：定向测试 99/99，通过；`npm run typecheck` 通过；`npm run build` 通过。本阶段只应提交 `/t` 命令展示、相关 UI/帮助文案、UT 和本 `STATUS.md`，不纳入既有 `AGENTS.md`、`work/auto`、`work/rebuild` 等无关改动。
- 阶段验证和git提交：2026-05-31 20:20 CST 已 stage 本阶段相关文件并执行 `git commit --amend -m "Tune /t Codex session list presentation"`，随后执行 `git commit --amend --no-edit` 将提交记录同步进状态文件；最终提交以 `git log -1 --oneline` 为准。
- 下一个阶段计划：做最终工作树审计并标记 goal complete。
