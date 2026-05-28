# STATUS

## 关键理解

- 项目是 TypeScript/Node 的 Codex-to-IM 桥接服务，测试使用 Node 原生 `node --test`，由 `scripts/run-tests.js` 收集 `src/__tests__/*.test.ts` 并串行执行。
- 运行期核心状态由 `JsonFileStore` 负责，落盘到 `CTI_HOME/data` 下的 sessions、bindings、messages 等 JSON 文件。
- IM 命令入口主要在 `src/lib/bridge/command-dispatch.ts`，外层由 `src/lib/bridge/bridge-manager.ts` 处理消息、路由、锁、健康状态和交付。
- session/thread 身份目前有三组字段需要区分：旧兼容字段 `sdk_session_id`，Bridge/SDK 线程字段 `codex_thread_id`，Desktop 线程字段 `desktop_thread_id`，并通过 `thread_origin` 辅助判断来源。
- `/his`/`/history` 当前有两类历史来源：优先读取 Codex Desktop JSONL 文件，找不到文件时退回 Bridge 缓存消息；`/his json` 只能用于已经落盘的 Codex session JSONL。

## 消息流与展示链路理解

### 普通 IM 对话如何操纵消息

- 普通 IM 消息入口是 `bridge-manager.handleMessage()`：先处理权限回调、命令、输入清洗，再调用 `runInteractiveMessage()`。
- `runInteractiveMessage()` 负责一次 active task 的生命周期：注册 task/turn、启动 IM 侧消息 UI、绑定流式预览/卡片回调、调用 `conversation-engine.processMessage()`，最后通过 `delivery-pipeline` 投递最终文本和附件。
- `processMessage()` 会先把用户消息写入 Bridge 缓存消息：`CTI_HOME/data/messages/<sessionId>.json`。如果用户带文件，会先尝试把文件落到工作目录 `.codepilot-uploads/`，再在持久化消息前面写入 `<!--files:JSON-->` 元数据。
- `processMessage()` 构造给 Codex 的 prompt 时，会从 Bridge 缓存取最近 50 条消息作为 `conversationHistory`，排除刚写入的当前用户消息。也就是说普通 IM 的上下文来源是 Bridge 自己的 messages JSON，不是直接读取 Desktop JSONL。
- 默认 SDK 路径下，`codex-provider` 调用 Codex SDK 的 `thread.runStreamed()`，消费 SDK 的 typed thread/item event。bridge 随后把这些 SDK event 映射成自己的内部 SSE 字符串：`status`、`text`、`tool_use`、`tool_result`、`task_update`、`result`、`error` 等。这里不是前端浏览器直接消费的 HTTP SSE，而是 provider 到 conversation engine 之间的内部 `ReadableStream<string>` 协议。
- `conversation-engine.consumeStream()` 再用 `consumeSseEvents()` 解析这些 `data: ...` 行：`text` 累加成正文，`tool_use/tool_result` 变成结构化 content block，`status` 更新 session/thread id、模型或 reasoning note，`task_update` 同步 todo/task，`result` 保存 token usage 和最终 SDK session id，`error` 变成错误响应。
- assistant 最终持久化到 Bridge 缓存：如果有工具块，就把 content blocks 整体 JSON stringify；如果只有正文，就保存纯文本。正文里的 `<cti-send>` 附件协议会在保存和最终投递前被清理/提取。
- 如果当前 session 是显式 Desktop-backed（有 `desktop_thread_id`），IM 发起的消息仍然会走 SDK stream 做进度来源，但 turn 会被标记为 `im_desktop_reuse`；最终答案可能等待 Desktop JSONL 的 `task_complete.last_agent_message` 再和 SDK final 合并。同时会开启 mirror suppression，避免同一批 Desktop JSONL records 又被 mirror 当成桌面主动消息重复投递。

### Mirror 如何操纵消息

- mirror 只针对显式 Desktop thread 建立 subscription；普通 IM session 只有 `codex_thread_id` 时不会自动成为 mirror 来源。
- mirror 的输入源是 Codex Desktop session JSONL 文件，路径来自 `~/.codex/sessions/**/*.jsonl` 的 Desktop session index/scan 结果。`mirror-runtime` 为 subscription 记录 file path、offset、cursor、pending turn，并用 `fs.watch()` 加 reconcile 轮询读取增量。
- `mirror-reconcile-core.readMirrorDeliverableRecords()` 按文件快照判断是增量读还是全量恢复读，再调用 `desktop-sessions` 的 JSONL parser 生成 `DesktopMirrorRecord[]`。cursor 用 signature/count/timestamp 找“上次看到哪里”；首次初始化只建立 cursor，不把旧历史全部投递。
- 读到的新 records 会先进入 `desktop-terminal-router`。如果它们属于当前 active 的 IM Desktop reuse turn，就被 claimed，后续用于该 IM turn 的 terminal finalization，不进入 mirror delivery。
- 未被 claimed 的 records 才是 Desktop 主动发生的 mirror 内容。它们会先过 `filterSuppressedMirrorRecords()` 去掉 IM 回声 records；suppression 现在只过滤 records，不再作为整个 mirror delivery 的全局阻塞条件。
- `mirror-delivery-plan` 把 records 放入 subscription buffer；`mirror-turns.consumeMirrorRecords()` 按 `task_started/message/reasoning/plan_update/tool_started/tool_finished/task_complete/task_aborted` 维护一个 pending mirror turn。assistant/commentary 文本会追加到流式正文，tool/task/status 会更新结构化状态；`task_complete` 或 `task_aborted` 才 finalize 成 `FinalizedDesktopMirrorTurn`。
- mirror 的实时 UI 和最终投递集中在 `mirror-feedback-controller`：Feishu 且支持 streaming hooks 时，先用 `onMirrorStreamStart/onStreamText/onToolEvent/onTaskEvent/onStreamStatus` 更新卡片，结束时用 `onStreamEnd` 收尾；如果卡片收尾不可用或失败，则回退到普通最终消息。最终正文会先经过 `assembleDesktopFinalResponse()` 清理附件协议，再用 `formatMirrorMessage()` 包上桌面线程标题、用户消息和 Codex 回复。

### 前端/IM UI 如何显示

- IM 侧普通对话的实时显示由 adapter capability 决定。支持 `onStreamText` 的通道会走流式卡片；支持 structured streaming UI 的 Feishu 还会显示工具、任务和运行状态。没有流式卡片的通道会尽量用 `sendPreview()` 草稿预览，最终仍发送普通消息。
- 普通 IM 对话结束时，`runInteractiveMessage()` 会先尝试 finalize streaming UI；如果结构化卡片已经承载了最终正文，就跳过重复文本投递，但仍会补发附件。没有卡片或卡片失败时，走普通 `deliverResponse()`。
- mirror UI 与普通 IM UI 共用 `stream-feedback-controller` 和 delivery pipeline 的思想，但入口不同：mirror 的流式卡片来自 Desktop JSONL records，而普通 IM 的流式卡片来自 SDK stream events。
- Web 控制台的会话历史页不是实时聊天 UI。它通过 `/api/session-history?targetKey=...` 拉取一次数据，前端 `renderSessionHistory()` 把消息渲染成 `.chat-history-message` 列表，并提供“显示解析/显示 JSONL”和“复制 JSONL”按钮。

### History 中的消息如何显示

- Web history 对 `session:<id>` 的处理：如果 Bridge session 上能找到 `codex_thread_id` 对应的 Desktop JSONL，就显示 Desktop 来源；否则读取 Bridge 缓存 messages JSON。
- Web history 对 `desktop:<threadId>` 的处理：直接读取对应 Desktop JSONL。
- Desktop JSONL 展示路径是：`readDesktopSessionJsonlHistoryStreamByFilePath()` -> `parseDesktopSessionJsonlHistoryText()` -> 每行 JSONL 分类为 role/kind/content/rawJsonl -> `uiHistoryMessage()` 用 MarkdownIt 预渲染 `renderedContent`。前端默认显示解析后的 Markdown，切换 raw 时显示原始 JSONL 行。
- Bridge 缓存展示路径是：`store.getMessages(session.id)` -> `uiHistoryMessage(role, 'bridge:message', content, timestamp)`。这类消息没有真实 JSONL 行，`rawJsonl` 是 UI 层合成的 `{ role, kind, content, timestamp }` JSON 字符串。
- IM 命令 `/his` 与 Web history 有相近但不完全相同的投影：它优先用同一套 Desktop JSONL history entry parser 转成 `BridgeMessage[]`，只保留 user/assistant/commentary/task_complete 等可读消息并去重；找不到 Desktop JSONL 时退回 Bridge 缓存。`/his json` 不做解析，直接把原始 session JSONL 文件作为附件发送。

## 当前结论

- 测试结构整理已完成：减少低价值直连单测，增加覆盖真实命令入口和持久化路径的 bridge command E2E。
- JSONL/history 链路已收敛：`/his` 复用 Web history 同源的 Desktop JSONL history entry 解析结果。
- 命令菜单、IM 命令后端实现和 Web 前端配置的主要不一致项已处理，剩余项集中在会话配置 tri-state、通道测试按钮语义和文档提示。
- `config.env` 到 `config.v2.json` 的同步策略已实现，并避免用 env 直接覆盖无法匹配的已有多通道实例。
- SDK 工具执行细节的文本展示已增加全局配置：Web 基础配置和 IM `/ui detail on|off` 都可切换；默认保持展示。

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
- `config.env` 比 `config.v2.json` 更新且内容不是当前 v2 自动快照时，`loadConfig()` 会把 env 中显式出现的全局配置 overlay 到 `config.v2.json`；通道配置只更新匹配到同一通道的实例，匹配不到则新增 env 导入通道并提示，任何实际同步写入 v2 的情况都会提示。
- 新增 `sdkToolCallDetailsInText` 全局配置，默认开启；关闭后 SDK 对话仍保留结构化工具事件回调，但不再把工具调用/结果写入文本预览和 Bridge assistant history。

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
- 2026-05-28 07:24 CST：根据反馈修正 env 通道同步策略：不再用 provider 的首个通道直接覆盖；飞书按 `CTI_FEISHU_APP_ID` 匹配已有通道，微信按 `CTI_WEIXIN_BASE_URL` 匹配，未匹配时新增 `<provider>-env` 通道并 `console.warn` 提示；只要 env 变更实际写入 `config.v2.json`，也会输出总同步提示。
- 2026-05-28 07:40 CST：梳理普通 IM、Desktop reuse、Desktop mirror、IM 流式 UI、Web history 和 `/his` 的消息操纵/展示链路，并记录到“消息流与展示链路理解”。
- 2026-05-28 08:10 CST：新增 `sdkToolCallDetailsInText` 全局显示配置，默认开启。Web 基础配置增加“消息中显示 SDK 执行细节”，IM 增加 `/ui detail on|off` 命令；关闭后 SDK 对话仍保留结构化工具事件回调，但不再把工具调用/结果写入文本预览和 Bridge assistant history。旧的 `/tools on|off` 作为命令兼容入口保留，不出现在帮助文案中。执行 `source ~/.nvm/nvm.sh && npm run typecheck` 通过，定向 26 个测试通过，全量 `npm test` 403 个测试全部通过。
- 2026-05-28 11:21 CST：恢复上下文后复验当前工作区：`source ~/.nvm/nvm.sh && npm run typecheck` 通过，`source ~/.nvm/nvm.sh && npm test` 通过，403 个测试全部通过；`git diff --check` 无空白错误。
- 2026-05-28 12:18 CST：整理 `STATUS.md`，移除已过期的未提交/暂不推送说明，并修正 `/tools` 兼容说明。
