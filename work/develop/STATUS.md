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
  - 补充 `/t rm` 不删除 BridgeSession 的断言后重跑 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --import tsx --test-timeout=15000 src/__tests__/command-dispatch.test.ts`：通过，20 tests。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`：通过，499 tests。
- 当前进入阶段审计：
  - `/auto` 失败审计完成：运行态直接错误是 tmux provider 在 tmux 2.8 上使用 `new-session -e`，与 auto script 本身无关；该修复已单独归为 `/tmux` 组。
  - `/t` 组完成：bridge session 在 session 列表展示中优先于 Codex 原始线程；`/t use`/`/t rm` 的目标解析顺序调整为序号 > binding_id/bridge_session_id > codex_thread_id > name；Codex 删除/归档仍按用户纠偏保留“删除关联 bridge session”的既有行为。
  - `/current` 审计：`handleCurrentCommand` 已明确输出 `name`、`codex_title`、`codex-thread-id`，标题通过 thread display 统一解析；现有 e2e `keeps renamed thread titles identical in /current and /t dropdown surfaces` 随完整测试通过。
  - `/auto` 组完成：`/auto ls` 卡片具备稳定 updateKey、持久 message 记录和 pin 路径；auto scripts 限制在 Codex home 下；skill 文档明确了脚本目录和 `/auto new` 参数。
  - `/tmux` 组完成：tmux provider 不再向 `tmux new-session` 传 `-e`，改为在 tmux session command 中使用 `env ... codex ...` 形式，兼容本机 `tmux 2.8`。
- 阶段提交：
  - `/t` 组：`5d83612 Keep bridge sessions primary in thread lists`
  - `/t` 组 follow-up：`Verify thread unbind preserves sessions`（提交哈希以 `git log --oneline` 为准）
  - `/auto` 组：`b4c7f08 Persist auto task cards and constrain scripts`
  - `/tmux` 组：`348a8f5 Avoid tmux new-session env flags`
- 下一个阶段计划：
  - 如继续推进，可进一步跑完整 `npm test`，并根据实际 IM 环境做一次 `/auto new ~/.codex/auto-scripts/...` 手动 smoke；当前未 hot update/redeploy。

### 2026-05-30 16:43 阶段：审计 /auto 端到端测试覆盖

阶段描述：按用户追问逐条核对 `/auto` 端到端测试是否覆盖完整使用链路。

- 用户追问：`所以auto的端到端测试你写没写`，并再次列出需要覆盖的链路：skill 安装/卸载及幂等；文本链路 ls/new/ls/rm/ls；卡片链路同样流程；跨 session 仍可 ls 到旧 session 定时器且旧任务能启动；set 次数重新触发；解绑时 set 为 0 但不移除，重绑后可 set。
- 当前审计计划：以当前工作树为准，检查 `src/__tests__/bridge-command-e2e.test.ts` 与 `src/__tests__/command-dispatch.test.ts` 中的具体测试和断言；如果发现缺口，立即补测试和实现。
- 审计发现：已有 e2e 覆盖了大部分链路，但“重新绑定上之后再 set”原先只覆盖到“切换到另一个 session 后仍可见并可 set”，没有严格通过 `/t <codex_thread_id>` 重新绑定回原 BridgeSession 后再 set。
- 已补测试 `allows /auto set after rebinding the original session with /t`：创建 Codex-backed session，`/auto new` 后 `/t rm 1` 使任务 times=0/status=completed；再用 `/t <codex_thread_id>` 重新绑定，确认 binding 回到同一个 BridgeSession；随后 `/auto set 1 2` 恢复为 running。
- 当前逐条覆盖证据：
  - skill 安装/卸载与幂等：`bridge-command-e2e.test.ts` 的 `handles /auto skill install and uninstall idempotently`，覆盖 install、重复 install、uninstall、重复 uninstall，并断言 skill 文档含 `/auto new <absolute-script-path> <times>` 与 `~/.codex/auto-scripts`。
  - 文本链路：`runs the /auto text command chain from list to create, refresh, remove, and refresh`，覆盖 `/auto ls` 空列表、`/auto new`、刷新 `/auto ls`、`/auto rm 1`、再次刷新空列表。
  - 卡片链路：`runs the /auto rich card chain with refresh, set, remove, and refresh callbacks`，覆盖卡片 select、set、delete、refresh callback。
  - 跨 session：`keeps /auto tasks visible across session switches and restarts the original session after set`，覆盖 session A 创建任务、切到 session B 后仍能 `/auto ls` 到任务，并且 `/auto set` 后触发的 LLM call 仍回到 session A。
  - 次数耗尽后 set 重启：`stops /auto task after configured times and set restarts from zero`，覆盖 times=2 触发完变 completed，`/auto set 1 1` 后重新触发并 completed。
  - 解绑暂停不移除：`sets /auto task times to zero when its session binding is removed and allows set after rebinding`，覆盖 `/t rm 1` 后 task `times=0`、`triggeredCount=0`、`status=completed`，且列表仍可见、可 set。
  - 重新绑定原 session 后 set：新增 `allows /auto set after rebinding the original session with /t`，覆盖用 `/t <codex_thread_id>` 重新绑定回同一个 BridgeSession 后 `/auto set`。
- 验证命令：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --import tsx --test-timeout=15000 src/__tests__/bridge-command-e2e.test.ts`：通过，18 tests。

### 2026-05-30 16:?? 阶段：补充定时器启动与 tmux 命令行回归测试

阶段描述：回应用户关于“定时器能正常启动是否测到位、为什么没测出 tmux 命令行错误”的追问，补齐对应测试。

- 用户追问：`定时器能正常启动测到位了吗？为什么没能测出来刚才那个tmux的那个命令行的错误？定时器运行是怎么判断的？是不是至少应该有个单测？`
- 当前判断：已有 `/auto` e2e 对“定时器能运行”的判断是：auto runtime 触发脚本、取 stdout prompt、调用注入的 LLM provider，并断言 `RecordedLlmCall.sessionId` 与 `prompt`，以及 task `triggeredCount/status/times`。这能证明 auto runtime 链路，但不能证明真实 tmux provider 的 `tmux new-session` 命令行兼容。
- 缺口：tmux provider 启动路径在 e2e 中被 fake LLM/SDK provider 替代，或只 mock `startAutoTask`，因此不会执行 `src/codex/tmux-provider.ts` 的 `launchTmuxCodexSession`，也不会捕获 `tmux 2.8` 不支持 `new-session -e` 的问题。
- 当前计划：补一个 tmux provider 单测/回归测试，使用 fake `tmux` 捕获 argv，断言 `new-session` 不再包含 `-e`，且 command 中用 `env ... codex ...` 传递必要环境。

### 2026-05-31 17:39 阶段：按当前工作树复核 /t 与 /auto 收尾状态

阶段描述：继续长期目标，按当前工作树而不是既有状态记录复核 `/t`、`/auto`、`/tmux` 三组改动是否真实存在，并修补缺口。

- 用户补充/重申：`/t use现在不接受name或者binding_id作为参数了，这很不好，要支持，/t家族的命令都要支持：序号>binding_id>codex_thread_id>name这四个优先级的依次解析，name重复了就报错。这里的name是bridge-session暴露出来的name，相当于session_name或者codex_title（如果前者为空）`。
- 用户补充/重申：`/auto ls` 卡片应该和 `/t` 一样是持久更新卡片；所有 `/auto` scripts 都要放在当前目录对应的 `~/.codex` 下；skills 文档必须写清楚 `/auto new` 参数用法；这些要求要反映在端到端测试里。
- 发现：本环境实际没有 `rg`，后续使用 `find`/`grep` 审计。
- 当前工作树已有多处非本阶段变更，包括 `AGENTS.md`、多个 `work/*/STATUS.md`、`work/rebuild` 删除项和未跟踪文件；本阶段只处理当前目标相关文件，不回滚无关变更。
- 当前计划：
  - 核对 git log、diff 与相关源码/测试，确认前述状态记录里宣称完成的 `/t`、`/auto`、`/tmux` 代码是否真实在当前工作树中。
  - 若 `/t` 解析、bridge session 展示、`name/codex_title`、`/current` 或解绑行为有缺口，先修 `/t` 组并单独验证。
  - 若 `/auto ls` 持久卡片、脚本路径、skill 文档或 e2e 有缺口，再修 `/auto` 组并单独验证。
  - 若 tmux provider 命令行回归测试仍缺失，作为 `/tmux` 组单独补测，避免和 `/t`、`/auto` 混在一个提交里。
- 用户更新（2026-05-31 17:??）：`之前auto相关的命令不用管了，focus新的就行`。
- 范围收缩：本阶段先暂停 `/auto` 与 `/tmux` 的新增处理，只聚焦新的 `/t` 家族目标解析要求；既有 `/auto` 代码不主动改动。
- 审计发现：`/t use` 与 `/t rm` 已经通过 `resolveBoundBindingSelection` 支持 binding id / bridge session id、codex_thread_id、name；直接 `/t <目标>` 仍只走本地 Codex 会话选择，不能直接用当前聊天已绑定线程的 `binding_id` 或 bridge session 暴露的 `name` 切换。
- 已修改 `src/lib/bridge/command/session-thread.ts`：
  - 直接 `/t <目标>` 保留数字序号选择全局 Codex 列表的既有语义。
  - 非数字目标按 `binding_id/bridge_session_id > codex_thread_id > name` 解析当前聊天已绑定线程；命中后直接激活该 binding。
  - 若没有命中已绑定线程，再回落到本地 Codex thread id / title 选择。
  - name 阶段会把 bound bridge session title 与本地 Codex title 作为候选，多个不同目标同名时返回 ambiguous，不静默选择。
- 已补 `src/__tests__/command-dispatch.test.ts`：在既有 `/t use`/`/t rm` name 测试基础上，新增直接 `/t 后端修复`、直接 `/t <binding_id>`、直接 `/t 前端修复` 重名报错断言。
- 阶段验证：
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --import tsx --test-timeout=15000 src/__tests__/command-dispatch.test.ts`：通过，21 tests。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`：通过。
  - `git diff --check -- src/lib/bridge/command/session-thread.ts src/__tests__/command-dispatch.test.ts work/develop/STATUS.md`：通过。
- 当前进入阶段审计：
  - 新增要求中的 `/t use` name/binding_id 支持在现有测试里已覆盖；本阶段额外补齐直接 `/t <目标>` 的同优先级解析缺口。
  - `/t rm` name/binding_id 支持仍沿用同一绑定解析函数，现有测试覆盖 `/t rm 后端修复`。
  - 直接 `/t <目标>` 对数字序号仍兼容原有全局 Codex 列表，不改变 `/t 1` 常用流程。
  - 本阶段没有继续修改 `/auto` 或 `/tmux`，符合用户最新 focus 指令。
- 用户纠偏（2026-05-31 17:??）：当前实现仍是按格式 dispatch；例如 `/t use 546754` 会因为 token 是数字直接报“没有第 546754 个 session”，而不是在序号未命中后继续尝试 binding_id / codex_thread_id / name。
- 修正理解：`序号 > binding_id > codex_thread_id > name` 的优先级表示“如果序号命中则优先使用序号”，不是“只要格式像序号就停止解析”。序号越界或未命中时，必须继续 fallback 到后续解析层级。
- 已修正：
  - `ThreadDisplayService.resolveBoundBindingSelection`：数字 token 只有在对应序号存在时才返回；序号不存在时继续匹配 binding_id / bridge_session_id / codex_thread_id / name。
  - `selectDirectThreadTarget`：直接 `/t <数字>` 只有命中全局 Codex 序号时才按序号切换；序号不存在时继续 fallback 到 bound binding id / thread id / name。
  - `command-dispatch` 回归测试新增纯数字 `codex_thread_id=546754`，覆盖 `/t use 546754` 和直接 `/t 546754` 都能 fallback 命中绑定。
- 纠偏后验证：
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --import tsx --test-timeout=15000 src/__tests__/command-dispatch.test.ts`：通过，21 tests。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`：通过。
- 用户追加下阶段目标（2026-05-31 17:??）：当前 `/t` fallback 修正完成后，下一个阶段做 `/tmux` 优化：`/tmux` 命令如果参数能匹配成关键字序列（例如 `<C-c><Enter>`），就全部按关键字发送；否则全部按普通文本发送。
- 阶段边界：上述 `/tmux` 优化不混入当前 `/t` 提交，待 `/t` 阶段 amend 完成后作为下一阶段处理。
- `/t` 阶段提交：`ece2f92 Support direct thread target resolution`。

### 2026-05-31 17:48 阶段：/tmux 关键字序列解析优化

阶段描述：按用户最新要求，优化 `/tmux` 命令的参数分流：只有整段参数可解析为 tmux 关键字序列时才按关键字发送，否则整段都按普通文本发送。

- 阶段目标：`/tmux <C-c><Enter>` 这类输入应按 tmux key 序列发送；如果参数不能完整匹配为关键字序列，则不做局部混合解析，而是全量作为普通文本发送。
- 当前计划：审计 `src/lib/bridge/command/tmux.ts` 的 key/text 解析函数和现有测试，补实现与回归测试，验证后单独提交。
- 审计发现：此前 `/tmux` 永远把参数作为 literal 发送并按 `tmux_auto_enter` 自动补 Enter；只有 `/tmux-key` 调用 `parseTmuxSendActions`，且 `/tmux-key` 支持文字与 `<...>` 按键混合。
- 已修改 `src/lib/bridge/command/tmux.ts`：
  - 新增 `parseTmuxKeySequence`，只接受整段由 `<key>` token 组成的输入，中间允许空白但不允许普通文本。
  - `/tmux <C-c>`、`/tmux <C-c><Enter>` 这类纯特殊键序列按 key actions 发送。
  - `/tmux <C-c> hello` 这类不能完整解析成 key 序列的输入整体作为普通文本发送。
  - 纯 key 序列分支不再追加 `tmux_auto_enter` 的隐式 Enter，普通文本分支仍保留既有自动回车行为。
  - `/tmux-key` 的混合文本/按键解析保持不变。
- 已补 `src/__tests__/command-dispatch.test.ts` 回归：
  - `/tmux <C-c>` 发送 `C-c`，不发送 literal，也不隐式补 Enter。
  - `/tmux <C-c><Enter>` 发送 `C-c` 和 `Enter` 两个 key，不按 literal 发送。
  - `/tmux <C-c> hello` 整体作为 literal 发送，并在自动回车开启时补 Enter。
- 阶段验证：
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --import tsx --test-timeout=15000 src/__tests__/command-dispatch.test.ts`：通过，21 tests。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`：通过。
  - `git diff --check -- src/lib/bridge/command/tmux.ts src/__tests__/command-dispatch.test.ts work/develop/STATUS.md`：通过。
- 当前进入阶段审计：本阶段只修改 `/tmux` key/text 分流与对应测试，未混入 `/t` 或 `/auto` 代码变更；用户要求的“能匹配成关键字序列就全按关键字，否则全普通文本”已由实现和回归测试覆盖。
