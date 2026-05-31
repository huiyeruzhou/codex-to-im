## 任务目标

原始指令：

```text
继续修改代码，当前工作区work/newfeat。/t use现在不接受name或者binding_id作为参数了，这很不好，要支持，/t家族的命令都要支持：序号>binding_id>codex_thread_id>name这四个优先级的依次解析，name重复了就报错。这里的name是bridge-session暴露出来的name，相当于session_name或者codex_title（如果前者为空）
```

## 任务上下文

- 当前仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前时间：`2026-05-31 17:50 CST`。
- 最新用户目标要求使用 `work/newfeat/` 作为当前工作区；该目录原先不存在，本阶段创建 `work/newfeat/STATUS.md`。
- 当前工作树已有无关未提交变更：`AGENTS.md`、`work/auto/STATUS.md`、`work/bridge-started-card/STATUS.md`、大量 `work/rebuild/STATUS-*.md` 删除项、`work/rebuild/manual-audit.md` 未跟踪文件、`work/tmux-feishu-parse-optimization/STATUS.md`。本阶段不回滚这些变更。
- 当前最新提交包括：
  - `ece2f92 Support direct thread target resolution`：实现 `/t` 目标解析 fallback。
  - `6d235b9 Parse tmux direct key sequences`：后续 `/tmux` 优化，与本目标无关。

## 任务日志

### 2026-05-31 17:50 阶段：审计 /t 家族目标解析完成性

阶段描述：按当前工作树审计 `/t`、`/t use`、`/t rm` 是否满足“序号 > binding_id > codex_thread_id > name”的 fallback 优先级，并确认 name 重复时报错。

- 当前计划：
  - 审计 `src/lib/bridge/thread-display-resolver.ts` 中 `/t use`、`/t rm` 共用的 bound binding 解析函数。
  - 审计 `src/lib/bridge/command/session-thread.ts` 中直接 `/t <目标>` 的解析函数，确认不会按 token 格式提前失败。
  - 审计 `src/__tests__/command-dispatch.test.ts` 中对 name、binding_id、数字 codex_thread_id fallback、重复 name 的覆盖。
  - 运行相关单测、typecheck 和 diff 检查；若当前实现已满足目标，则记录阶段审计并完成 goal。
- 审计结论：
  - `ThreadDisplayService.resolveBoundBindingSelection` 是 `/t use` 与 `/t rm` 的共用解析入口；当前实现为：数字 token 先尝试序号，只有序号命中才返回，否则继续尝试 binding id / bridge session id，再尝试 bound codex_thread_id，最后尝试 display title；name 匹配超过 1 个时返回 ambiguous。
  - 直接 `/t <目标>` 使用 `selectDirectThreadTarget`；当前实现保留 `/t 1` 选择全局 Codex 列表的语义，但如果数字序号未命中，会继续 fallback 到当前聊天绑定的 binding id / bridge session id、bound codex_thread_id、Codex thread id、display title。
  - bridge-session 暴露 name 由 `getBridgeSessionDisplayTitle` 定义：优先 `session.name`，为空时回落 `session.codex_title`，再回落工作目录/短 id。
  - 现有测试已覆盖 `/t use <name>`、`/t use <binding_id>`、直接 `/t <name>`、直接 `/t <binding_id>`、数字 codex_thread_id fallback（`546754`）、重复 name 报错、`/t rm <name>`。
- 已补测试：
  - 在 `src/__tests__/command-dispatch.test.ts` 中增加 `codex_title` fallback 场景：当 bridge session `name` 为空、`codex_title` 为 `标题回退` 时，`/t use 标题回退` 能切换到该 binding，`/t rm 标题回退` 能移除该 binding。
- 阶段验证：
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --import tsx --test-timeout=15000 src/__tests__/command-dispatch.test.ts`：通过，21 tests。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`：通过。
  - `git diff --check -- src/__tests__/command-dispatch.test.ts work/newfeat/STATUS.md`：通过。
- 当前进入阶段审计：
  - 目标要求的 `/t use` 支持 name 和 binding_id：已由测试覆盖。
  - `/t` 家族中当前聊天绑定目标选择的解析优先级：`/t use`、`/t rm` 使用共用解析；直接 `/t <目标>` 已补充同语义 fallback。
  - “序号 > binding_id > codex_thread_id > name”已按“命中优先、未命中 fallback”实现，不再按 token 格式提前失败。
  - name 重复报错：`/t use 前端修复` 和直接 `/t 前端修复` 的重复 name 测试覆盖 ambiguous。
  - name 来源是 bridge session display title：`session.name` 与 `codex_title` fallback 均有测试或源码证据。
