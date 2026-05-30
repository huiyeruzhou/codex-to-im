## 任务目标

原始指令：

```text
继续修改代码，当前工作区work/develop。
先debug一下auto命令最近运行的情况，落status判断当前/auto命令执行屡屡失败的问题是啥？

然后，/t 解绑之后bridgesession就没了，这对吗，鉴于bridge session总是包含codex我认为它应该永远要高于codex，因为这才是用户真正创造的数据结构。修改一下这个行为，另外，可以用术语区分一下，codex_title和name，这样bridge session自己也可以保留原本的codex_title，并且在/current命令中使用了

我的建议是检查一下所有对codex原始数据结构的访问，确保其他地方的一致性~

另外，/t use现在不接受name或者binding_id作为参数了，这很不好，要支持，/t家族的命令都要支持：序号>binding_id>codex_thread_id>name这四个优先级的依次解析，name重复了就报错。这里的name是bridge-session暴露出来的name，相当于session_name或者codex_title（如果前者为空）

另外/auto ls的卡片
```

补充事实：bridge 日志中保留了同一条用户消息的完整标准化文本，末尾补全为：`/auto ls的卡片应该和/t一样，是持久更新的。并且额外规定所有auto的scripts都要在当前目录的那个~/.codex下好了。然后skills能不能写的清楚点，为啥模型还得查/auto new的参数用法。。。这个也要反映在端到端测试里`。

## 任务上下文

- 当前仓库路径：`/data00/home/hongli.fish/Codex/codex-to-im`。
- 当前时间：`2026-05-30 16:20 CST`。
- 当前工作区按用户要求使用 `work/develop/`。
- 当前环境没有 `rg` 命令，代码检索使用 `grep`/`find`。
- 工作树在本任务开始前已有无关未提交变更：`AGENTS.md`、`work/auto/STATUS.md`、大量 `work/rebuild/STATUS-*.md` 删除项和 `work/rebuild/manual-audit.md` 未跟踪文件。本任务不回滚这些变更。
- 运行态路径：`/data00/home/hongli.fish/.codex-to-im/`。

## 任务日志

### 2026-05-30 16:20 阶段：/auto 失败审计与 bridge session 语义修改准备

阶段描述：建立本轮状态文件，审计最近 `/auto` 运行情况，拆解 bridge session 与 Codex 原始数据访问的一致性问题，准备后续代码修改。

- 已创建 `work/develop/STATUS.md`，记录用户原始目标和当前工作树事实。
- 初步计划：
  - 检查 `~/.codex-to-im` 中 auto task 持久化数据和 bridge 日志，定位 `/auto` 最近反复失败的根因。
  - 审计 session registry、binding、`/t` 命令、`/current` 命令和 auto task 展示代码，明确 bridge session 与 Codex 原始线程数据的边界。
  - 修改 `/t` 解绑行为，确保 bridge session 作为用户创建的数据结构不因解绑而被删除；引入/统一 `codex_title` 与 `name` 语义。
  - 为 `/t` 家族命令实现统一目标解析优先级：序号 > binding_id > codex_thread_id > name；name 重复时报错。
  - 检查并修正 `/auto ls` 卡片与新 session/name 语义的一致性。
  - 将 `/auto ls` 卡片调整为类似 `/t` 的持久更新卡片。
  - 规定 `/auto` scripts 必须位于当前目录对应的 `~/.codex` 下，并更新 skill 说明与端到端测试。
- 已检查 `/data00/home/hongli.fish/.codex-to-im/data/auto-tasks.json`：当前内容为 `{}`，说明最近失败后没有遗留 active auto task。
- 已检查最近 bridge 日志：`/auto` 后台触发 `im:8e6a6f02-317e-4815-95f4-d633e710be53:auto:a36da5b7-9f23-446b-b883-87c36f59a251:3`，脚本输出 2 字符 prompt 后进入 `codex-routing-provider`，选择 provider `tmux`，启动命令中 `resume_thread_id: null`。
- 日志中的直接失败原因：`[codex-tmux] Error: tmux: unknown option -- e`，随后 `interactive-turn/runner` 将该错误作为 task error，Feishu streaming card 以 `status=error` 结束。
- 初步判断：`/auto` 屡屡失败的直接原因不是脚本本身，而是后台触发恢复 Codex 时走到 tmux provider，当前机器的 `tmux new-session` 不支持代码传入的 `-e` 参数；同时日志显示 `resume_thread_id: null`，需要继续检查 bridge session 被 `/t` 解绑/删除后是否丢失了 codex 原始线程信息，导致 auto 恢复链路更脆弱。
- 已确认本机 `tmux -V` 为 `tmux 2.8`，而 `src/codex/tmux-provider.ts` 的 `launchTmuxCodexSession` 会为 `tmux new-session` 追加 `-e KEY=VALUE`。tmux 2.8 的 `new-session` usage 不包含 `-e`，所以这是可复现的版本兼容性 bug。
- 已查看 `sessions.json` 中失败的 bridge session `8e6a6f02-317e-4815-95f4-d633e710be53`：它保留 `name: rebuild`、`codex_provider: tmux`、`tmux_session_name: codex-019e7734-...`，但缺少 `codex_thread_id` 字段，`health_reason` 已写入同一个 `tmux: unknown option -- e` 错误。
- 同一 Codex 原始线程 `019e7734-053d-7202-8b00-b1170f6d3ca5` 目前存在于另一个 bridge session `c7b22256-766d-4b35-8434-7cd78f2925fd`。这支持用户指出的问题：当前实现可能把 Codex 原始线程当成主身份，导致解绑/重绑后 bridge session 自身数据被丢弃或与 Codex 线程字段脱钩。
- 已审计核心代码位置：
  - `src/codex/tmux-provider.ts`：`launchTmuxCodexSession` 使用 `tmux new-session -e`，需要改成 tmux 2.8 可用的 `env KEY=... codex ...` shell command 形式。
  - `src/lib/bridge/session-registry.ts`：短暂误判为 `archiveCodexThread` 也应保留 bridge session。
  - `src/lib/bridge/thread-display-resolver.ts`：`resolveBoundBindingSelection` 当前顺序为序号 > codex_thread_id > binding/bridge id > name；应改为序号 > binding_id/bridge_session_id > codex_thread_id > name。
  - `src/lib/bridge/command/auto-presentation.ts`：`/auto ls` 卡片没有 `updateKey/updateTtlMs`，因此不具备 `/t` 卡片那种可更新卡片身份。
  - `src/lib/bridge/command/dispatch.ts` 只对 `/t` 持久化并 pin 最新卡片；`/auto ls` 需要类似持久记录。
  - `src/lib/bridge/auto-tasks.ts` 的 `validateAutoScriptPath` 目前只检查存在且是文件，没有限制脚本必须位于 `CODEX_HOME`/`~/.codex`。
- 当前准备修改上述文件，并补充相关测试与 skill 文档。
- 用户纠偏（2026-05-30 16:??）：`codex删了bridge跟着删是对的`。正确范围是：`/t` 解绑不应删除 bridge session；但用户在 UI/接口中删除或归档 Codex 原始线程时，关联 bridge session 跟着删除仍是正确行为。
- 反思：我把“bridge session 高于 codex”的语义过度扩展到了 Codex 删除/归档流程。后续必须只针对 `/t` 解绑行为和绑定解析语义修改，不改变 `archiveCodexThread` 删除关联 bridge session 的既有行为。
- 用户纠偏（2026-05-30 16:??）：`tmux和这个根本就是两组，他也不搭边啊。你到时候提交的时候不要混在一起啊，/t，/auto，/tmux是三组`。
- 阶段/提交边界更新：
  - `/t` 组：bridge session/name/codex_title、`/current`、解绑行为、`/t` 家族目标解析优先级。
  - `/auto` 组：最近失败审计结论、`/auto ls` 持久更新卡片、auto scripts 路径规则、skill 文档、端到端测试。
  - `/tmux` 组：`tmux 2.8` 不支持 `new-session -e` 的兼容性修复。此项只作为 `/auto` 失败审计的根因证据，不与 `/auto` 或 `/t` 代码提交混在一起。
- `/t` 组进展：
  - 已调整 `SessionDisplayQuery.listSessions`：当 BridgeSession 和 Codex 原始线程共享 `codex_thread_id` 时，列表展示优先保留 BridgeSession 行，Codex 原始线程只补充未 materialize 的候选行；这样 `/t` 解绑后不会因为列表按 Codex 行去重而让用户误以为 bridge session 消失。
  - 已调整 bound binding 解析顺序为：序号 > binding_id/bridge_session_id > codex_thread_id > name。
  - 已更新 `/t use`、`/t rm` 相关帮助文案，并补充测试覆盖 binding_id 与 codex_thread_id 冲突时优先 binding_id。
- `/auto` 组进展：
  - 已给 `/auto ls` rich card 增加稳定 `updateKey=thread-card:auto:<channelType>:<chatId>` 和 `updateTtlMs=null`。
  - 已让 `/auto ls` 返回的 rich card 走和 `/t` 表格卡片相同的 `persistAndPinLatestThreadTableMessage` 路径。
  - 已收紧 `/auto new` 脚本校验：自动化脚本必须位于 `CODEX_HOME`/`~/.codex` 下，建议目录为 `~/.codex/auto-scripts/`。
  - 已更新 `skills/codex-to-im-auto/SKILL.md`，明确 `/auto new <absolute-script-path> <times>`、`times` 必须为正整数、脚本应存放在 `~/.codex/auto-scripts/`。
  - 已更新 `command-dispatch` 与 `bridge-command-e2e` 相关测试，覆盖 auto script 路径规则、持久卡片 updateKey/updateTtlMs、`auto` scope message id 记录、skill 文档内容。
- 阶段验证：
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --import tsx --test-timeout=15000 src/__tests__/session-display-query.test.ts src/__tests__/command-dispatch.test.ts src/__tests__/bridge-command-e2e.test.ts`：通过，39 tests。
  - 追加断言后重跑 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --import tsx --test-timeout=15000 src/__tests__/command-dispatch.test.ts`：通过，20 tests。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`：通过。
- 当前进入阶段审计：
  - `/auto` 失败审计完成：运行态直接错误是 tmux provider 在 tmux 2.8 上使用 `new-session -e`，与 auto script 本身无关；该修复已单独归为 `/tmux` 组。
  - `/t` 组完成：bridge session 在 session 列表展示中优先于 Codex 原始线程；`/t use`/`/t rm` 的目标解析顺序调整为序号 > binding_id/bridge_session_id > codex_thread_id > name；Codex 删除/归档仍按用户纠偏保留“删除关联 bridge session”的既有行为。
  - `/auto` 组完成：`/auto ls` 卡片具备稳定 updateKey、持久 message 记录和 pin 路径；auto scripts 限制在 Codex home 下；skill 文档明确了脚本目录和 `/auto new` 参数。
  - `/tmux` 组完成：tmux provider 不再向 `tmux new-session` 传 `-e`，改为在 tmux session command 中使用 `env ... codex ...` 形式，兼容本机 `tmux 2.8`。
- 阶段提交：
  - `/t` 组：`5d83612 Keep bridge sessions primary in thread lists`
  - `/auto` 组：`b4c7f08 Persist auto task cards and constrain scripts`
  - `/tmux` 组：`348a8f5 Avoid tmux new-session env flags`
- 下一个阶段计划：
  - 如继续推进，可进一步跑完整 `npm test`，并根据实际 IM 环境做一次 `/auto new ~/.codex/auto-scripts/...` 手动 smoke；当前未 hot update/redeploy。
