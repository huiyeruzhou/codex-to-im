# STATUS

## 关键理解

- 项目是 TypeScript/Node 的 Codex-to-IM 桥接服务，测试使用 Node 原生 `node --test`，由 `scripts/run-tests.js` 收集 `src/__tests__/*.test.ts` 并串行执行。
- 运行期核心状态由 `JsonFileStore` 负责，落盘到 `CTI_HOME/data` 下的 sessions、bindings、messages 等 JSON 文件。
- IM 命令入口主要在 `src/lib/bridge/command-dispatch.ts`，外层由 `src/lib/bridge/bridge-manager.ts` 处理消息、路由、锁、健康状态和交付。
- session/thread 身份目前有三组字段需要区分：旧兼容字段 `sdk_session_id`，Bridge/SDK 线程字段 `codex_thread_id`，Desktop 线程字段 `desktop_thread_id`，并通过 `thread_origin` 辅助判断来源。
- `/his`/`/history` 当前有两类历史来源：优先读取 Codex Desktop JSONL 文件，找不到文件时退回 Bridge 缓存消息；`/his json` 只能用于已经落盘的 Codex session JSONL。
- 已存在未提交改动：`.gitignore`、`src/__tests__/bridge-manager.test.ts`、`src/__tests__/bridge-command-e2e.test.ts`、`src/__tests__/test-bridge-utils.ts`。本轮会在这些现有改动基础上继续，不回退用户已有工作。

## 当前目标

- 在保证代码功能完全不变的前提下，梳理测试结构，减少没有行为价值的单测，增加覆盖真实命令入口和真实持久化路径的端到端测试。
- 对 history 的不同建模方案做中文说明，供维护者决策；代码层面暂不做会改变语义的数据模型改造。
- 审计命令菜单、IM 命令后端实现和 Web 前端配置之间的匹配关系，找出命令设计、说明文案、回显内容和前后端配置不一致的问题。

## 命令与前端配置审计

### 命令体系理解

- 命令后端入口在 `src/lib/bridge/command-dispatch.ts`，短命令别名由 `src/lib/bridge/command-aliases.ts` 统一解析。
- Web 命令说明页在 `src/ui-server.ts` 的 `data-page="commands"` 静态 HTML 中维护；IM 内 `/h` 帮助在 `command-dispatch.ts` 中单独维护；README 和安装文档也各有一份命令说明。
- Web 基础配置保存走 `/api/config`，由 `mergeConfig` 写入全局默认；会话级配置走 `/api/session-config`，由 `sanitizeSessionConfig` 写入单个 `BridgeSession` 覆盖值。
- 命令里的 `/m`、`/provider`、`/r`、`/sb`、`/net`、`/model` 多数写入当前 IM 会话；Web 基础配置写入全局默认。二者不是同一层级，UI 文案需要明确“全局默认”和“当前会话覆盖”的关系。

### 发现的不匹配或设计不合理点

- 已处理：Web 命令页没有列出后端支持的 `/check all`，但 README 和后端支持；用户很难从 Web 控制台发现“查看所有运行中会话健康状态”的入口。
- 已处理：Web 命令页没有列出 `//...` 转义 slash prompt，但后端和 README 支持；这是避免 `/status` 这类文本被当命令拦截的关键能力，应出现在“最常用”或“其它”里。
- 已处理：Web 命令页没有列出 `/cat <path> [start] [end]` 和 `/file <path>`，但 IM `/h` 帮助和后端支持；这会造成 Web 命令说明与实际可用命令不一致。
- 已处理：Web 命令页将 `/stop`、`/perm` 的“命令”列显示为 `—`、原始命令列显示真实命令，和其它没有短别名的 `/provider`、`/model`、`/unbind` 表达不一致。建议统一为：命令列就是推荐输入，原始命令列只有存在别名时才填不同值。
- `/his` 命名仍然偏“history”，但实际核心能力包含“发送原始 Codex JSONL 文件”和“从 JSONL 解析可视化消息”。目前 `/his json` 文案清楚，但 `/his` / `/his msg` 的说明偏“最近消息”，没有明确说明优先读取 Codex session JSONL、找不到再退回 Bridge 缓存。
- 已处理：`/his raw` 的描述“原始记录”容易误解为原始 JSONL；实际 raw 仍是解析后的最近消息文本，真正原始文件是 `/his json`。建议把 `/his raw` 改文案为“解析后的纯文本视图”，把 `/his json` 明确为“原始 JSONL 文件”。
- 已处理：`/new` 回显里总是提示“如果当前聊天里已有旧任务在运行，它不会被终止...”，但非 `--force` 情况下已有任务会被阻止切换；这句在普通成功路径上可能制造不必要焦虑。建议只在 `--force` 成功时提示旧任务仍可能回消息。
- 已处理：`/status` 对非 Desktop 的普通会话提示“当前聊天还没有绑定桌面会话。可先发送 `/t`，再用 `/t 1` 接管。”，即使当前已经绑定了一个正常 IM 会话也会出现。这容易让用户误以为当前会话“不完整”。建议改成“当前是 IM 会话；如需接管桌面会话可用 `/t`”。
- 已处理：`/thread <id>` 允许直接输入 32-64 位十六进制/UUID thread id，即使未在 Desktop 列表找到也会创建 Desktop-backed binding；命令说明只写序号接管，没写可用 thread id/prefix，能力和文案不匹配。
- 已处理：`/thread 0` 临时草稿线程会创建/切换隐藏 draft session，但命令菜单把它放在“设置与切换”，和“最常用”里直接发送文本未绑定时自动进草稿之间关系不明显。建议把 draft 作为“临时会话”单独解释：自动草稿、`/t 0`、`/t 0 reset` 是同一组。
- 已处理：`/model` 命令说明说 Desktop 不支持的模型会标注“仅 IM”，但当前 IM 回显文案中实际使用“CLI only”。Web 和 IM 文案术语不一致，建议统一成“仅 IM/CLI”或“CLI only”。
- 已处理：Web 基础配置的 `/his 返回条数` 输入框限制 `min=1 max=20`，IM 命令 `parseHistoryLimitArg` 也限制 1-20；但 `/api/config` 的 `mergeConfig` 只用 `asPositiveInt`，没有后端 clamp 到 20。手写 API payload 可以保存超过 20，运行时 `getHistoryMessageLimit` 又会 clamp 到 20，导致“配置文件值”和“实际生效值”不一致。
- 已处理：Web 基础配置的 `codexSandboxMode` 后端 `mergeConfig` 只接受 `read-only` 和 `danger-full-access`，其它值都落到 `workspace-write`；前端 select 包含 `workspace-write`，当前能正常保存为默认值但逻辑表达绕了一下。建议后端显式接受 `workspace-write`，避免以后改默认时产生隐性错误。
- Web 基础配置提示 `codexSkipGitRepoCheck` “修改后需要重启 Bridge”，保存消息也将它归为 restart field；但其它 Codex 默认项如 sandbox/network/reasoning 标为即时生效。实际对新请求是否即时生效取决于 provider 读取 config 的时机，建议逐项核实后统一“下一轮请求生效/重启生效”的文案。
- 会话配置支持 `codexNetworkAccess` true/false，但没有“恢复全局默认”的空值表达；命令 `/net default` 支持删除会话覆盖。前端会话配置和命令能力不匹配，建议会话配置 UI 增加 tri-state：全局默认 / 开启 / 关闭。
- 会话配置支持 `codexSandboxMode`、`reasoningEffort` 空字符串恢复默认，这和命令 `/sb default`、`/r` 查看默认的语义基本匹配；但 Web 基础配置和会话配置文案需要明确哪些是“默认”，哪些是“覆盖”。
- 通道配置的保存和测试分离：测试通道前会先保存当前编辑内容，这是合理但风险较高；如果用户只是想试填配置，点击测试会持久化。建议按钮文案改为“保存并测试”或先做不落盘测试。
- 微信通道测试返回“请使用开始微信扫码”，而通道编辑器也有微信扫码流程；这块后端/前端能匹配，但命令说明页完全没有提到通道登录/配置不通过时 IM 命令会不可用，属于文档层缺口。

### 建议优先级

- P0：统一命令说明来源，至少让 Web 命令页和 `/h` 覆盖同一组后端命令：补 `/check all`、`//...`、`/cat`、`/file`，修 `/stop`、`/perm` 列展示。
- P1：修 `/his raw`、`/his msg`、`/his json` 的文案，明确“解析视图”和“原始 JSONL 文件”的区别。
- P1：修 `/status` 普通 IM 会话提示，避免把“未绑定桌面会话”说成当前会话的主要状态。
- P1：修 Web `/api/config` 对 `historyMessageLimit` 的 1-20 clamp，显式接受 `workspace-write`。
- P2：会话配置增加网络访问 tri-state，让 Web 能表达 `/net default`。
- P2：将“测试通道”改成“保存并测试”或支持不落盘测试，避免行为超出用户预期。

### 本次已处理

- Web 命令页补齐 `/check`、`/check all`、`//...`、`/cat`、`/file`，并把 `/stop`、`/perm` 的“命令”列改成真实可输入命令。
- Web 命令页和 IM `/h` 帮助统一 `/his` 语义：`/his`/`/his raw` 是解析后的纯文本视图，`/his json` 才是原始 Codex session JSONL 文件。
- `/status` 对普通 IM 会话不再提示“还没有绑定桌面会话”，改成说明当前正在使用 IM 会话，并提示如需接管桌面会话再用 `/t`。
- `/new` 普通成功路径不再提示旧任务仍在运行；只有 `--force` 切换时保留旧任务后台继续的提醒。
- `/model` CLI-only 模型提示改为“仅 IM/CLI”，与 Web 的“仅 IM”说法收敛。
- Web `/api/config` 保存 `historyMessageLimit` 时后端 clamp 到 1-20，并显式接受 `workspace-write` sandbox。
- `config.env` 比 `config.v2.json` 更新且内容不是当前 v2 自动快照时，`loadConfig()` 会把 env 中显式出现的全局/默认通道配置 overlay 到 `config.v2.json`，让用户手改 env 后仍能同步到全局配置。

## 时间线

- 2026-05-28 06:17 CST：读取仓库结构、测试运行器、当前 git 状态、history/session 相关实现，建立本文件作为持续工作记录。
- 2026-05-28 06:18 CST：执行 `npm test`，当前基线为 424 个测试全部通过；确认后续改动以测试结构和端到端覆盖为主，不改业务功能。
- 2026-05-28 06:19 CST：计划只改测试层：抽出 bridge E2E 测试辅助函数，并补 `/his` 在 Bridge 缓存与 Desktop JSONL 两种来源下的端到端覆盖。
- 2026-05-28 06:21 CST：更新 `src/__tests__/test-bridge-utils.ts`，集中管理 bridge 测试状态清理和 Desktop JSONL fixture；更新 `src/__tests__/bridge-command-e2e.test.ts`，新增 `/his` Bridge 缓存回退与 Desktop JSONL 优先读取的端到端测试。定向运行 `bridge-command-e2e.test.ts`，4 个测试全部通过。
- 2026-05-28 06:22 CST：执行 `npm run typecheck` 和 `npm test`，类型检查通过，全量 426 个测试全部通过。
- 2026-05-28 06:23 CST：检查 git diff，确认业务源码未改动；当前改动集中在测试辅助、bridge command E2E、`STATUS.md`，并保留已有的 `.gitignore` 和删除低价值 `/his` alias 单测改动。
- 2026-05-28 06:24 CST：根据新的目标重新检查测试和 JSONL 链路。发现 `/his` 使用 `readDesktopSessionMessages`，Web UI 使用 `readDesktopSessionJsonlHistoryStreamByFilePath`，两者都是 JSONL 文件到可视化消息的解析路径，存在可收敛空间；下一步会优先收敛 `/his` 到 JSONL history entry 解析链，并删除已被 E2E 覆盖的低价值 command-dispatch history 单测。
- 2026-05-28 06:27 CST：修改 JSONL 解析链路：新增 `desktopJsonlHistoryEntriesToBridgeMessages` 和 `readDesktopSessionMessagesByFilePath`，让 `/his` 通过 Web UI 同源的 JSONL history entry 解析结果生成消息，减少 JSONL 到可视化消息的重复路径。
- 2026-05-28 06:30 CST：删除 `command-dispatch.test.ts` 中已被 bridge command E2E 覆盖的 `/history` 缓存、卡片、JSON 附件和 limit 直连单测；保留预绑定 slash command 最小验证并改用 `/status`。补充 E2E：Desktop JSONL `agent_message` 与 `response_item` 去重、`task_complete.last_agent_message` 可视化。
- 2026-05-28 06:31 CST：收到澄清：这是两个独立需求。测试优化必须覆盖全仓库测试，不只 history；JSONL/history 重构单独处理，重点是 JSONL 文件解析与可视化过程的冗余链路。
- 2026-05-28 06:33 CST：定向测试发现共享 JSONL history parser 对 `task_complete` 只输出“任务完成”，而旧 `/his` event-stream 路径会读取 `last_agent_message`。已修正 parser，使 UI 和 `/his` 的同源 JSONL entry 都能展示最终答案。
- 2026-05-28 06:36 CST：开始全仓库测试优化。合并 `logger.test.ts` 中同形 secret mask 用例；合并 `config.test.ts` 中过碎的 maskSecret/runtime scalar 映射用例并删除纯 `CTI_HOME` 常量测试；删除 `store.test.ts` 中两个 no-op provider 返回值测试；合并 `bridge-manager.test.ts` 中纯命令 alias 映射测试。
- 2026-05-28 06:39 CST：新增 bridge command E2E，覆盖 `/new -> /m -> /provider -> /sandbox -> /network -> /status` 的真实入口路径；删除 `command-dispatch.test.ts` 中同一行为的直连重复单测。定向运行 bridge command E2E 与 command-dispatch 测试，18 个测试全部通过。
- 2026-05-28 06:41 CST：执行 `npm run typecheck` 和 `npm test`。类型检查通过；全量 398 个测试全部通过。测试数从本轮开始前的 426 降到 398，同时新增了更贴近真实入口的 bridge command E2E 覆盖。
- 2026-05-28 06:52 CST：继续处理命令/前端配置审计项。更新 `command-dispatch.ts` 和 `ui-server.ts` 的命令文案、`/status` 普通 IM 会话提示、`/new --force` 条件提示、`historyMessageLimit` clamp 与 `workspace-write` 保存逻辑；补充/调整 bridge command E2E 和 `/new` 断言。执行 `npm run typecheck` 通过，定向 18 个测试通过，全量 `npm test` 398 个测试全部通过。
- 2026-05-28 07:04 CST：按要求先提交并推送当前基线：`1d2e798 test: streamline bridge command coverage`，已推送到 `origin/master`。后续开始实现“用户修改 `config.env` 后同步更新全局 `config.v2.json`”的新功能。
- 2026-05-28 07:14 CST：实现 env -> v2 同步：当 `config.env` mtime 新于 `config.v2.json` 且不是当前 v2 自动生成快照时，按 env 中显式键覆盖 runtime 和默认 provider 通道配置，并保留 v2 多通道实例；`saveConfig()` 改为先写 env 快照再写 v2，避免自身快照被误判为用户修改。补充配置测试覆盖 env overlay 与自动快照 no-op；执行 `npm run typecheck`、定向 `config.test.ts`、全量 `npm test`，400 个测试全部通过。
