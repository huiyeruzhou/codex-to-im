# STATUS

## 任务目标

原始指令：分析为什么现在 `/t` 在绑定中和解绑状态下显示的标题不一样。

用户追加指令（2026-05-30 15:49 CST）：修改该行为。用户认为 BridgeSession 是用户真正创造的数据结构，且 BridgeSession 总是包含 Codex，因此显示优先级应永远高于 Codex。引入术语区分 `codex_title` 和 `name`，让 BridgeSession 保留原本的 `codex_title`，并在 `/current` 命令中使用。

用户追加指令（2026-05-30 15:51 CST）：检查所有对 Codex 原始数据结构的访问，确保其他地方的一致性。

## 任务上下文

- 2026-05-30 15:41 CST：当前工作树仍有既有无关未提交改动，包括 `AGENTS.md`、`work/auto/STATUS.md`、多份 `work/rebuild/*` 删除和 `work/rebuild/manual-audit.md`，本次分析不回退这些改动。
- 2026-05-30 15:41 CST：`rg` 不可用，使用 `find`、`grep`、`sed`、`nl` 进行代码定位。
- 2026-05-30 15:49 CST：需要把本分析转为实现阶段，范围包括 BridgeSession 类型/schema/store、导入 Codex thread 时保存 `codex_title`、全局 `/t` 标题优先 BridgeSession，以及 `/current` 展示 `name` 与 `codex_title`。
- 2026-05-30 15:51 CST：需要扩大审计范围，检查所有使用 `CodexSessionSummary.title`、`getCodexSessionByThreadIdSafe`、`listCommandCodexThreads`、`getCodexSessionByThreadId`、`readJsonl` 之类原始 Codex 数据的路径，区分哪些应该保留 raw Codex title，哪些应该用 BridgeSession 的 `name`/`codex_title` 展示模型。

## 任务日志

### 2026-05-30 15:41 CST

阶段描述：分析 `/t` 绑定态与未绑定态标题来源分叉。

- 行动：已创建本状态文件，接下来读取 `/t` command、thread display resolver、session display query、session registry binding 路径，定位标题生成规则差异。
- 行动：确认 `/t` 无参数会被 `resolveCommandAlias` 转成 `/threads`，显示全局本地 Codex 会话；`/t ls` 才显示当前聊天绑定表。
- 行动：确认标题分叉点在 `ThreadDisplayService`：绑定态 `binding()` 会先取 `getBridgeSessionDisplayTitle(session)`，再取 Codex JSONL title；未绑定全局态 `codex()` 在没有当前聊天 binding 时没有 linkedBridgeSession，只取 Codex JSONL title。
- 行动：确认 `CommandThreadDisplay.decorateCodexSessions()` 只用“当前 chat 的 bindings”建立 `bindingByThreadId`；同一个 Codex thread 即使已有 BridgeSession，只要在当前 chat 没有 binding，`/t` 全局表就不会用 BridgeSession 名称。
- 行动：确认 `buildCodexThreadCommandTableRows()` 在全局表里仅当传入 bindingStates 时才用 binding title 覆盖 session title；解绑后 bindingState 消失，标题回退到 Codex JSONL title。
- 行动：常见触发场景：`/t rename` 只改 BridgeSession name，解绑后全局 `/t` 又显示 Codex JSONL 原标题；`/new <目录>` 创建的 BridgeSession 名称可能是 `Bridge: <chat>`，而 Codex JSONL title 可能是第一条用户消息，因此绑定态和未绑定态也会不同。
- 阶段验证和git提交：本轮为原因分析，未改业务代码；只新增本分析状态文件，暂不提交。
- 下一个阶段计划：向用户说明原因链路和修复选择：要么保持“绑定态显示 IM/Bridge 自定义名、未绑定显示 Native Codex 标题”的设计；要么让 `/t` 全局列表按 threadId 查找已有 BridgeSession，即使未绑定也优先显示 BridgeSession 名称。

### 2026-05-30 15:49 CST

阶段描述：实现 BridgeSession 标题优先和 `codex_title` 元数据。

- 行动：收到用户确认的设计方向：BridgeSession 优先级应高于 Codex 原始标题，并需要区分 `name` 与 `codex_title`。
- 行动：计划读取 BridgeSession 类型、session schema、store 创建/更新、Codex thread 导入、`/current` 输出和现有测试，随后最小范围修改并补测试。
- 行动：已开始实现：在 `BridgeSession` 类型和 `schemas/data/sessions.v1.schema.json` 增加 `codex_title` 字段；`getBridgeSessionDisplayTitle` 改为 `name -> codex_title -> working_directory -> id`。
- 行动：收到用户追加审计要求，暂停继续改具体调用点，先系统性搜索 Codex 原始标题/原始 session summary 的访问点，避免只修 `/t`。
- 行动：审计 `CodexSessionSummary.title` 访问点后分类：`src/codex/session-index/*`、`src/ui/application/session-source.ts` 属于 raw source 层，保留 raw Codex title；`thread-display-resolver`、`session-display-query`、`session-registry/bindings`、`/current`、UI session payload 属于 display/import 层，需要使用 BridgeSession 优先。
- 行动：实现 `codex_title` 元数据：导入/物化 Codex thread 时把 raw title 写入 `BridgeSession.codex_title`，不再把 raw Codex title 写入用户 `name`；用户 rename 只改 `name`。
- 行动：实现显示优先级：`getBridgeSessionDisplayTitle` 使用 `name -> codex_title -> working_directory -> id`；`ThreadDisplayService.codex()` 在没有当前聊天 binding 时也会按 `threadId` 查找已有可见 BridgeSession，保证解绑后 `/t` 仍优先显示 BridgeSession 标题。
- 行动：更新 `/current` 字段，除既有“标题”外增加 `name` 和 `codex_title`，其中 `codex_title` 优先读已保存的 BridgeSession 元数据，缺失时回退到 raw Codex JSONL title。
- 行动：补充/调整测试：E2E 验证 rename 后 `/current` 同时展示 `name` 与 `codex_title`，解绑后 `/t` 全局列表仍显示 BridgeSession 名称；session registry 测试验证 Codex import 保存 `codex_title` 且 `name` 为空；session display query 测试验证 linked Codex rows 暴露 `codexTitle`。
- 行动：运行针对性测试：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --test-concurrency=1 --import tsx --test-timeout=15000 src/__tests__/bridge-command-e2e.test.ts src/__tests__/session-registry.test.ts src/__tests__/session-registry-bindings.test.ts src/__tests__/session-display-query.test.ts src/__tests__/ui-session-application.test.ts src/__tests__/command-dispatch.test.ts`，结果 51/51 通过。
- 行动：运行静态检查：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`，结果通过。
- 行动：运行完整测试：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`，结果 498/498 通过。
- 阶段验证和git提交：当前进入阶段审计。已验证 BridgeSession 标题优先、`codex_title` 元数据、解绑后 `/t` 标题一致、`/current` 展示 name/codex_title、UI/session registry/display query 相关路径；下一步审计 diff 后提交。
- 行动：diff 审计确认本阶段相关文件为 session schema、BridgeSession 类型、display/query、thread display、session registry/bindings、`/t` command、`/current` diagnostics、bridge manager codex title persistence、UI session payload，以及对应测试；既有无关工作树改动仍不纳入。
- 阶段验证和git提交：已将本阶段相关文件和本状态文件执行 `git commit --amend --no-edit`，当前本地提交为 `9bc00a6 Rebuild source architecture`。
- 下一个阶段计划：本阶段完成；因本次用户未要求 push，保持本地提交状态。
