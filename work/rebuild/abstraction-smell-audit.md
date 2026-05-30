# Abstraction Smell Audit

## 审计目标

用户要求本轮重构收尾前逐个阅读 `src` 下生产 `.ts` 文件，检查是否存在“屎山级别的不合理抽象”，如存在则标注出来。

本审计不是继续按文件大小刷榜，也不是把所有大文件都判为问题。判定重点是：

- 大而空的 composition / dependency injection 堆叠，隐藏而不是消除复杂度；
- catch-all support/helper，把多个用户故事的事实读取和规则混在一起；
- 名字、路径和真实职责不一致，误导 AI 或维护者定位入口；
- 跨用户故事的万能 owner，导致修改一个故事必须理解多个不相关故事；
- 为了移动复杂度制造跳转，入口复杂度和局部修改复杂度没有真实下降。

## 覆盖进度

- 生产源文件总数：137（来自 `find src -name '*.ts' ! -path 'src/__tests__/*'` 和最新 `source-file-audit.json`）。
- 已逐文件阅读并记录初判：137 / 137。
- 本批优先覆盖：最新 `source-file-audit.json` 的 top hot/risky 文件，以及用户此前明确反对的 composition / support / runner 相关入口。

## 已标注问题

### S1: `src/lib/bridge/bridge-session-support.ts`

- 判定：存在不合理抽象风险，属于 catch-all support/helper。
- 证据：同一文件同时负责本地 Codex session 列表/查找、workspace root、模型显示/选择、runtime settings、`/new` 工作目录解析、draft reset、history limit、Codex thread title fallback；这些不是一个自然用户故事或基础设施端口。
- 影响：command、diagnostics、status、bridge manager 会为了局部事实读取 import 这个 support 文件，AI 定位“本地 Codex source”“runtime settings”“new session cwd”时会被引到同一个混合入口。
- 处置建议：不要再往里加 helper；后续拆成少量真实 owner，例如 command/session source、runtime setting resolver、new-session cwd resolver。已完成的 `command/session-source.ts` 是正确方向之一。

### S2: `src/lib/bridge/interactive-turn/runner.ts`

- 判定：存在不合理抽象风险，但不是因为文件大，而是 `RunInteractiveMessageDeps` 过宽，runner 仍是 interactive turn 的事实汇聚点。
- 证据：`RunInteractiveMessageDeps` 同时包含 task registry、bridge turn registry、mirror suppression、session health、stream UI snapshot、permission forwarding、SDK runtime、environment resolver、display resolver、binding list、timer hooks、terminal timeout 等多类端口；`runInteractiveMessage` 本体仍串起 environment、runtime settings、stream UI、SDK events、permission、mirror suppression、terminal finalization、delivery。
- 影响：虽然此前删除了不可接受的 `composition.ts`，但复杂度目前暴露在 runner 参数面上；修改一个 interactive turn 子故事时仍需要扫描大量 deps。
- 处置建议：不要恢复大而空的 composition 文件；应优先按用户故事压缩 runner 内部流程，例如 permission flow、final delivery flow、mirror suppression flow 各自拥有更窄的本地状态 owner，而不是再增加 host wiring 层。

### S2: `src/service-manager.ts`

- 判定：存在不合理抽象风险，属于 service-manager catch-all。
- 证据：同一文件同时处理 bridge pid/status、instance lock/start lock、daemon start/stop/restart、Windows PowerShell 管理员检测和计划任务、全局 npm uninstall 延迟脚本、UI server 状态、bridge 日志读取、Codex integration 安装、打开浏览器。函数列表从 `startBridge` / `stopBridge` 到 `installBridgeAutostart` / `uninstallCodexToImPackage` / `ensureUiServerRunning` / `installCodexIntegration` 横跨多个 operator workflow。
- 影响：UI service route、CLI 和本地运维入口都被迫依赖同一个超宽 service manager。AI 要改“开机自启”“UI server”“bridge 启停”“卸载”任一故事时，会扫描大量无关平台脚本和状态文件逻辑。
- 处置建议：拆分时不要按 helper 粒度切碎；应按 operator workflow 分为 bridge process control、Windows autostart、UI server process、package/integration maintenance，并保持 `service-manager.ts` 作为窄 facade 或直接让 route/CLI 调用对应 workflow。

### S2: `src/lib/bridge/adapters/feishu-adapter.ts`

- 判定：存在不合理抽象风险，属于平台 adapter class 过载。
- 证据：`FeishuAdapter` 同时承担 env proxy 解析、REST/WS client lifecycle、WS SDK monkey patch、inbound message parsing、dedup、resource download/upload、post/card/plain text sending、rich command card update、structured streaming card state machine、tool/task/status/action flushing、callback conversion。文件内 `FeishuCardState` 和 `RichCardUpdateState` 说明“平台连接”和“CardKit v2 streaming UI state”实际是两个自然 owner。
- 影响：Feishu 平台接入、消息解析、普通发送、streaming card 更新任一改动都要穿过 2882 行同一 class；AI 很难判断修改边界，也容易把 CardKit 状态机回归带到普通消息发送。
- 处置建议：优先抽出 Feishu streaming card runtime 和 Feishu resource/message parser，保留 adapter class 做平台生命周期和 BaseChannelAdapter 方法编排；不要创建通用 adapter composition 层。

### S2: `src/lib/bridge/command/runtime-settings.ts`

- 判定：存在不合理抽象风险，属于 command runtime setting workflow 混合 owner。
- 证据：文件同时处理 `/mode`、`/provider`、`/reasoning`、`/sandbox`、`/network`、`/ui`、`/model`；还直接读取 config/model catalog、bridge-session-support、router、tmux runtime、turn-classifier，并内含 tmux provider 切换和 mirror reconcile side effect。
- 影响：修改某个设置命令会被迫理解模型、tmux provider、Codex thread 复用、全局 config 保存和 session mutation 的交叉规则。
- 处置建议：按 runtime setting 子故事拆成 mode/provider/model 与 sandbox/network/ui 两类，先把 bridge-session-support 读取改为明确 setting resolver，再决定是否保留一个 command facade。

### S2: `src/lib/bridge/command/diagnostics.ts`

- 判定：存在不合理抽象风险，属于 diagnostics/history/file command 混合 owner。
- 证据：同一文件处理 `/check` health、`/current` session status、`/his` history rendering / limit save / raw JSONL attachment、`/cat` 文件读取、`/file` 文件发送；同时直接依赖 config、Codex JSONL reader、feedback delivery、security validators、turn classifier、bridge-session-support 和 runtime-settings。
- 影响：health/status/history/local file delivery 是不同用户故事，放在一个 diagnostics 文件会让 AI 难以定位“我要改 history source”还是“我要改 health display”。
- 处置建议：按命令用户故事拆分为 session diagnostics、history export、local file commands；共享格式化保留在 command presentation。

### S2: `src/lib/bridge/command/tmux.ts`

- 判定：存在不合理抽象风险，但边界比 diagnostics 更自然。
- 证据：文件围绕 tmux command family，但同时拥有 tmux session list/select rich card、special key parser、send/capture、screen monitor global state、streaming card actions、tmux setting mutation 和 callback stop handling。
- 影响：它是一个胖 command family，仍能按用户故事理解；风险在于 screen monitor runtime state 放在 command module，可能让 command execution 和 long-running monitor lifecycle 混在一起。
- 处置建议：后续优先把 `screenMonitors` 和定时 capture runtime 移到 tmux command runtime owner；解析/展示 helper 可留在 command family 内，不要按每个小 parser 单独拆文件。

### S2: `src/lib/bridge/command/session-thread.ts`

- 判定：存在不合理抽象风险，属于 session/thread command family 过宽。
- 证据：同一文件处理 `/new`、`/t add/use/rm/rename/ls`、`/thread`、`/threads`，同时读取 registry、router、bridge-session-support、binding audit、display title、command session source 和 runtime setting formatter。
- 影响：session creation、binding mutation、thread selection/listing 和 active-task guard 交织；当前新增 `command/session-source.ts` 已收窄本地 Codex source，但 `/new` cwd 和 draft reset 仍从 `bridge-session-support.ts` 进入。
- 处置建议：保留 session/thread command family，不要拆成每个命令小文件；下一刀应分离 new-session workflow 与 binding-list/use/rm workflow，优先消除 bridge-session-support catch-all 依赖。

### S2: `src/lib/bridge/command/dispatch.ts`

- 判定：存在不合理抽象风险，属于 command switchboard 叠加执行细节。
- 证据：文件作为 command dispatch 入口是合理的，但 switch 里不仅分派命令，还直接构造 tmux screen streaming feedback target、处理危险输入差异、决定 default target 解析、维护 thread table refresh/pin、最终发送和审计响应。
- 影响：AI 修改某个命令 dispatch 规则时容易误碰 tmux screen card runtime 或响应发送策略；`dispatch.ts` 逐渐从 switchboard 变成 command execution composition。
- 处置建议：保留 command switchboard，但把 tmux screen feedback target 构造和最终 response delivery/pin 逻辑抽成有语义的 command execution helper；不要按每个 case 拆文件。

### S2: `src/lib/bridge/session-registry/bindings.ts`

- 判定：存在不合理抽象风险，但属于真实 owner 过宽，不是空 facade。
- 证据：文件拥有 binding target 校验、Codex thread materialization、chat binding mutation、active binding switch、binding target options、binding summaries、channel default target mutation、remove/update binding；同时直接读取 config channel instance、Local Codex Session Index、turn-classifier、session-title。
- 影响：Session Registry 作为大模块是对的，但 `bindings.ts` 同时承担 mutation、query summary 和 local Codex candidate lookup，导致 UI/command 需要 query 时也接触 mutation owner。
- 处置建议：继续保留 registry public facade；内部优先拆 query/summary 与 mutation/default-target 两个 owner，local Codex candidate 通过 registry port 注入或专门 source owner 承接。

### S2: `src/lib/bridge/thread-display-resolver.ts`

- 判定：存在不合理抽象风险，属于 display query 与数据读取混合。
- 证据：`ThreadDisplayService` 负责 binding/codex/thread display title、selection 和 rename，但仍直接通过 `getCodexSessionByThreadIdSafe` 读取本地 Codex source，并用 `BridgeStore` 查 session；display title、creator、execution provider、selection 规则集中在一个 service。
- 影响：display 规则作为共享 owner 是正确方向，但这里让“展示模型”和“本地 Codex 查询”粘在一起；command/UI/runtime 复用 display 时会间接依赖 bridge-session-support。
- 处置建议：保留 display service，但把 Codex thread lookup 改为窄 source port；selection 规则可留在 command display adapter，避免通用 display service继续变胖。

### S2: `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts`

- 判定：存在不合理抽象风险，属于 SDK conversation engine 过宽。
- 证据：`processMessage` 同时做 session lock、runtime option resolution、message persistence、attachment preparation、provider resolution、history loading、LLM stream start、permission callback wiring；`consumeStream` 再处理 SSE parsing、tool/task/status projection、permission request capture、response blocks、token usage、Codex thread capture 和 outbound artifacts。
- 影响：它是 interactive turn 的核心 engine，但 store/provider/persistence/stream reducer 混在一起，导致修改 SSE 映射或 persistence 策略都要理解整个执行流程。
- 处置建议：优先拆 stream reducer / event mapper 为纯函数，保留 processMessage 作为 engine 流程；不要新增上层 composition 文件。

### S2: `src/weixin/login.ts`

- 判定：存在不合理抽象风险，属于 CLI login 与 Web popup login 混合 owner。
- 证据：同一文件包含 QR HTML 页面、popup HTML + browser JS、runtime web session Map、CLI HTML 写入和 open browser、QR refresh、polling loop、confirmed login persistence、`startWeixinLoginWebSession`、`runWeixinLogin` CLI 主流程。
- 影响：修改 Web 控制台扫码体验会接触 CLI 文件写入/自动打开浏览器流程；修改 CLI login 也会接触 popup polling JS。
- 处置建议：拆分为 login runtime/polling core、web session API state、CLI HTML launcher 三个自然 owner；不要把 HTML 字符串拆成无语义片段。

### S2: `src/codex/session-index/jsonl-types.ts`

- 判定：存在不合理抽象风险，主要是文件名和真实职责不一致。
- 证据：文件名叫 `jsonl-types`，但除了 JSONL interface，还包含 structured/free text extraction、task progress parsing、tool output extraction、patch/tool-search summary、dynamic tool call id、tool name formatting、event signature 和 type guard 等 Codex JSONL 协议解析/投影规则。
- 影响：AI 搜索“Codex JSONL parser/normalizer/tool projection”时不容易先想到 `types` 文件；后续新增协议规则时也容易把行为逻辑继续塞进类型文件。
- 处置建议：保留类型和纯规则的集中 owner，但改名或拆成 `jsonl-protocol.ts` / `jsonl-text-normalizer.ts` 这类语义文件；不要按每个 extractor 切成小 helper。

### S2: `src/lib/bridge/mirror-formatters.ts`

- 判定：存在不合理抽象风险，formatter 混入全局 runtime context 读取。
- 证据：`formatMirrorMessage` 通过 `getMirrorAssistantRuntimeLabel` 间接调用 `getBridgeContext().store.getSetting('bridge_runtime')`，导致格式化函数不是纯展示规则，而是读取全局 bridge store 决定 speaker label。
- 影响：Mirror Runtime / Interactive Turn 复用 formatter 时会隐式依赖全局 context；测试和后续迁移到更窄 port 时容易漏掉 runtime label 的来源。
- 处置建议：将 assistant runtime label 作为参数或由 mirror feedback owner 注入，保持 `mirror-formatters.ts` 为纯格式化规则；不要为了这一点新建 composition wrapper。

### S2: `src/lib/bridge/mirror-turns.ts`

- 判定：存在不合理抽象风险，属于 mirror turn reducer 与 pending delivery queue 混合。
- 证据：文件同时拥有 `CodexMirrorTurnState` 生命周期、CodexMirrorRecord -> turn state reducer、timeout finalize、pending delivery enqueue/remove/select、buffer consume；其中 pending delivery queue 更接近 Mirror Runtime delivery coordination，而不是 turn state 本身。
- 影响：修改镜像 turn 文本聚合、tool/task progress reducer 或 delivery retry queue 任一规则都要进入同一文件；这会让 mirror runtime 的 reducer 和 delivery coordination 边界变模糊。
- 处置建议：保留 turn reducer 的胖模块形态，但把 pending delivery queue helpers 移到 mirror delivery owner 或 runtime state owner；不要拆散每个 record type handler。

### S2: `src/lib/bridge/mirror-suppression.ts`

- 判定：存在不合理抽象风险，属于 prompt suppression 状态机过隐蔽。
- 证据：文件同时维护 suppression window、prompt match grace、candidate/active turn id、ignored turn id TTL、begin/settle/abort 以及 record filtering；`filterSuppressedMirrorRecords` 内部有多层 while/continue/break 状态转移。
- 影响：这是 IM 发起复用 Codex thread 时避免本地 mirror 回显的关键规则，但名字只说 suppression，状态机含义难从入口看清；改 mirror delivery 或 interactive reuse 时容易误判哪些 Codex records 被丢弃。
- 处置建议：保留为专门 owner，但补状态机注释或拆出纯 transition table；不要把 suppression 逻辑散回 runner/mirror runtime。

### S2: `src/lib/bridge/bridge-adapter-runtime.ts`

- 判定：存在不合理抽象风险，属于 adapter lifecycle 与 inbound message execution 混合 owner。
- 证据：`createAdapterRuntime` 同时处理 adapter start/stop/config fingerprint invalid cache、consume loop、bridge command shortcut、numeric permission shortcut、session lock routing、message handling error backoff 和 adapter meta error tracking。
- 影响：改“adapter 配置热同步”和改“入站消息如何进入 session lock”会进入同一 runtime 文件；AI 容易把平台生命周期和消息执行路径混在一起。
- 处置建议：保留 adapter runtime facade，但后续应把 consume loop / inbound dispatch policy 从 config sync lifecycle 中分出来；不要回退到 bridge-manager。

### S2: `src/lib/bridge/bridge-channel-runtime.ts`

- 判定：存在不合理抽象风险，属于 channel config lookup 与 rendering/display helper 混合。
- 证据：文件从全局 `getBridgeContext().store` 读取 channel instances，同时提供 provider inference、feedback markdown parse mode、markdown/plain rendering、binding chat label formatting。
- 影响：rendering helper 隐式依赖全局 store；display/channel label 规则与配置读取绑在一起，command/UI/mirror feedback 复用时不容易看出依赖来源。
- 处置建议：把 channel instance lookup 做成明确 source port，把 render/label helper 保持纯函数或 display owner；不要继续往这里追加 channel 杂项。

### S2: `src/lib/bridge/channel-router.ts`

- 判定：存在不合理抽象风险，属于 router、binding mutation、draft session creation 混合 owner。
- 证据：`resolve` 既查找 existing binding，又修复 displayName/userId，又自动重建缺失 session，又应用 channel default target，还创建 draft session 并记录 binding audit；文件直接依赖 global context、SessionRegistryService、internal draft sessions 和 binding audit。
- 影响：它是入站消息首个关键入口，但“路由解析”和“修改 session/binding/default target”交织；AI 修改默认绑定、draft session 或 audit 规则时都会进入同一个 router。
- 处置建议：保留 inbound address -> binding 的 public facade；内部拆 resolve existing、apply default target、create draft binding 三个 use case，并把 store/context 依赖显式化。

### S2: `src/lib/bridge/delivery-layer.ts`

- 判定：存在不合理抽象风险，属于 delivery transport、rate limit、dedup、audit/persistence 混合 owner。
- 证据：`deliver` 同时做 chunking、global rate limiter、retry/error classification、HTML fallback、dedup check/insert、outbound ref insert、audit log insert；文件还有模块级 `ChatRateLimiter` 和 cleanup timer。
- 影响：修改发送重试、平台限制、审计或 dedup 任一规则都要理解整个 delivery layer；全局 context 和模块级 timer 也增加测试和替换成本。
- 处置建议：保持可靠 delivery 入口，但后续分离 pure send retry/chunk plan、delivery persistence hooks 和 rate limiter owner；不要按每个平台拆 delivery。

### S2: `src/lib/bridge/channel-adapter.ts`

- 判定：存在不合理抽象风险，属于 base adapter contract 过宽。
- 证据：`BaseChannelAdapter` 同时定义生命周期、内部 inbound queue、发送、pin/unpin、callback answer、authorization、typing lifecycle、offset acknowledge、preview draft、structured streaming UI、mirror stream、tool/task stream event 和 final stream end hooks。
- 影响：每个具体 adapter 会被同一个 base contract 暗示要理解所有平台能力；Feishu streaming card、Weixin polling、preview draft、permission callback 等不同能力的边界被折叠到一个抽象类。
- 处置建议：保留 adapter base 的最小生命周期/send/consume contract，把 structured streaming / preview / pin / callback 能力逐步提取为 capability interfaces；不要用更大的 adapter composition 抽象覆盖它。

### S2: `src/lib/bridge/permission-broker.ts`

- 判定：存在不合理抽象风险，属于 permission prompt delivery 与 permission resolution 混合 owner。
- 证据：文件同时格式化 HTML/plain permission card、做 recent forward dedup、调用 delivery layer、写 permission link、解析 callback、校验 chat/message、atomic resolve、解析 allow_session suggestions 并调用 permissions gateway。
- 影响：修改权限展示、Weixin numeric fallback、callback security 或 SDK permission resolution 会进入同一文件；这既是 UI delivery owner 又是 permission state transition owner。
- 处置建议：拆为 permission prompt delivery 和 permission callback resolver 两个 owner；共享 callback data/parser 可保留小纯函数。

### S2: `src/lib/bridge/command/control.ts`

- 判定：存在不合理抽象风险，属于 stop command 与 permission command 混合 owner。
- 证据：`handleStopCommand` 处理 active task abort、tmux provider C-c 映射、health end 记录和 thread display；`handlePermissionCommand` 解析 `/perm` 并委托 permission broker callback。两者同属“control”但用户故事和依赖完全不同。
- 影响：修改 `/stop` tmux 行为时要看到 permission broker/router；修改 `/perm` 时要看到 tmux/runtime health 规则。
- 处置建议：按 command family 拆为 stop command owner 与 permission command owner；不要按每个 if 分 helper。

### S2: `src/lib/bridge/command/status.ts`

- 判定：存在不合理抽象风险，属于 command status rendering 直接读取 process/service/config。
- 证据：`buildGlobalStatusResponse` 直接调用 `loadConfig`、`getBridgeStatus`、`getUiServerStatus`、`getCurrentUiServerUrl`，再读取 store sessions/bindings/adapters 并格式化文本。
- 影响：command presentation 与 service-manager/config runtime 状态读取耦合；未来 UI/server/service 状态字段变化会影响 command 模块内部。
- 处置建议：将 global status facts 作为 port/input DTO 传入 command status renderer，或建立 service status query owner；保持 command 文件只负责渲染和轻量聚合。

### S2: `src/lib/bridge/host.ts`

- 判定：存在不合理抽象风险，属于 host contract catch-all。
- 证据：同一文件定义 file attachment、SSE event、LLM content block、token usage、provider config、BridgeSession、BridgeStore、StreamChatParams、LLMProvider、PermissionGateway、LifecycleHooks；这些横跨 persistence contract、LLM execution contract、permission contract 和 lifecycle contract。
- 影响：任何模块 import `BridgeStore` / `BridgeSession` 都被带到一个超宽 host contract 文件；AI 搜索 store、provider、permission、SSE 类型时都会落到同一个大接口合集。
- 处置建议：后续按 contracts 拆成 `session-contracts`、`store-contracts`、`llm-provider-contracts`、`permission-contracts`，保留 `host.ts` 作为兼容 re-export facade。

### S2: `src/lib/bridge/context.ts`

- 判定：存在不合理抽象风险，属于全局 service locator。
- 证据：`getBridgeContext()` 通过 `globalThis.__bridge_context__` 暴露 store/llm/permissions/lifecycle，当前多个 formatter/router/delivery/helper 直接调用它读取全局状态。
- 影响：模块依赖被隐藏，纯 helper 很容易变成全局状态读取者；测试必须初始化全局 context，端口边界也难从函数签名看出来。
- 处置建议：保留启动期 context，但新增代码应优先显式传入 store/config/source port；逐步把 formatter/router/delivery 中的隐式 context 读取移到应用服务或 runtime owner。

### S2: `src/lib/bridge/interactive-runtime.ts`

- 判定：存在不合理抽象风险，属于 interactive runtime 状态协调过宽。
- 证据：`createInteractiveRuntime` 同时管理 active task registry、queued count、session runtime status 持久化、external terminal finalization、force stop、terminal health reconcile、startup persisted state reset、per-session promise lock、cooldown 和 lock invalidation。
- 影响：修改队列/锁、健康状态收尾、`/stop` 行为或 persisted runtime reset 都会进入同一 runtime 文件；它是一个真实 owner，但内部子状态边界已经变宽。
- 处置建议：保留 interactive runtime facade；后续可拆 session lock queue、runtime status persistence、terminal task finalization 三个内部 owner。

### S2: `src/lib/bridge/types.ts`

- 判定：存在不合理抽象风险，属于 shared runtime contracts catch-all。
- 证据：同一文件包含 channel address、inbound/outbound message、attachments、inline button、rich card/table/action/select、send result、channel binding/default target、bridge/adapter status、audit log、permission link、preview state、tool/task progress 和 platform limits。
- 影响：任何模块为了 `ChannelAddress`、`OutboundRichCard`、`ToolCallInfo` 或 `ChannelBinding` 都 import 同一共享大类型文件，导致领域边界在类型层面被抹平。
- 处置建议：按 shared contracts 拆成 channel message contract、rich card contract、binding contract、status/audit contract、stream progress contract；保留 `types.ts` 作为兼容 re-export facade。

## 暂不判为“屎山级别”的大文件

### `src/lib/bridge/bridge-manager.ts`

- 初判：仍然复杂且是高风险入口，但当前不是“空抽象”本身。它作为 singleton bridge host / composition root 仍聚合 adapter runtime、interactive runtime、mirror runtime、session health、turn coordinator、command dispatch 等 wiring。
- 保留风险：1341 行、34 个本地 import、15 条风险跨聚合 import；仍有过多 runtime wiring 和 `_testOnly` 暴露。
- 处置建议：继续把真实 runtime owner 从 bridge host 中抽走，但不能再用无语义的 composition/DI 堆叠换壳。

### `src/ui/server.ts`

- 初判：当前不判为“屎山级别”抽象。它现在主要是 UI HTTP composition root / route chain，234 行，结构能反映 operator workflow 入口。
- 保留风险：仍直接创建 store、读取 config/weixin accounts，并串联多个 route handler；后续可用 UI context 收缩，但不应为了减少 import 创建空 route composition。

### `src/ui/shell.ts`

- 初判：不判为“屎山级别”不合理抽象。它是单个静态 UI shell 字符串，虽然 3151 行非常大，但主要问题是缺少前端 asset/build 边界，不是抽象换壳。
- 保留风险：HTML、交互 JS 和命令说明都在一个 template literal 里；AI 修改 UI 时搜索入口明确但局部编辑容易误伤。
- 处置建议：如继续改 UI，应按真实页面/asset 边界引入前端构建或模板拆分；不要把它拆成多个只返回字符串片段的小 helper。

### `src/config.ts`

- 初判：不判为“屎山级别”不合理抽象。它是配置格式 owner，集中处理 `config.v2.json`、legacy `config.env` migration、env overlay、snapshot 和 settings projection。
- 保留风险：861 行，legacy env -> v2 migration 和 runtime/channel overlay 都在同一文件；后续新增配置项容易扩大文件。
- 处置建议：若继续增长，优先按配置格式拆成 v2 schema normalization、legacy env migration、settings projection 三个内部 owner；不要抽通用 config helper。

### `src/store.ts`

- 初判：不判为“屎山级别”不合理抽象。它是 JSON file-backed `BridgeStore` 实现，session/binding/message/permission/dedup/lock/audit 都是同一持久化 adapter 的职责。
- 保留风险：857 行，写入策略和 legacy binding upgrade 都集中在一个 class；但路径和名字没有误导。
- 处置建议：除非引入第二种 store 后端，否则保持胖 adapter；最多抽 schema migration/legacy upgrade，不要把每个 Map 操作拆成文件。

### `src/codex/provider.ts`

- 初判：不判为“屎山级别”不合理抽象。它是 Codex SDK provider，集中处理 SDK lazy load、CLI preview、event -> SSE mapping、permission bridge、attachment temp file 和 error normalization。
- 保留风险：763 行，SDK event mapping 与 process/session finalization混在同一 provider；但 owner 自然。
- 处置建议：后续如增长，先抽 event mapper 纯函数和 temp attachment helper；不需要新建 provider composition。

### `src/codex/tmux-provider.ts`

- 初判：不判为“屎山级别”不合理抽象。它是 Codex TUI/tmux provider，包含 tmux launch、prompt injection、session JSONL polling、mirror record -> SSE projection。
- 保留风险：706 行，tmux transport 与 Codex session file polling 交织；但这是 tmux provider 的核心机制。
- 处置建议：可拆 session-file watcher/poller 与 tmux process launcher，保留 provider 作为流程编排。

### `src/lib/bridge/command/presentation.ts`

- 初判：暂不判为“屎山级别”，但需要继续观察。它是 command rendering/presentation owner，包含字段列表、thread table/rich card、history formatting、runtime/mirror status formatting。
- 保留风险：630 行且 re-export 多个 display/command callback 概念；presentation 和 callback payload 生成有轻微混合。
- 处置建议：若继续拆，按 thread card rendering 与 generic command text formatting 分开，不要按每个 formatter 小函数拆。

### `src/lib/bridge/adapters/weixin-adapter.ts`

- 初判：暂不判为“屎山级别”。它是 Weixin channel adapter，负责多账号 polling、offset commit、context token、media download、typing indicator、message send 和 inbound conversion，职责虽然多但都围绕 Weixin adapter。
- 保留风险：poll loop、message item parser、cursor commit、audit log 和 typing ticket 都在一个 class；后续多媒体/群聊能力增加时会变成 Feishu adapter 同类问题。
- 处置建议：若继续增长，先抽 Weixin polling worker 和 message item parser；当前不需要为减少行数拆。

### `src/weixin/store.ts`

- 初判：不判为“屎山级别”。它是 Weixin account/context token JSON store，路径和职责一致。
- 保留风险：account store 与 context token store 共享一个文件；体量小，暂不处理。
- 处置建议：保持。

### `src/lib/bridge/markdown/feishu.ts`

- 初判：暂不判为“屎山级别”。它是 Feishu rendering owner，集中处理 markdown card/post、rich command card、table/select/button、streaming task/tool/final/permission card JSON。
- 保留风险：811 行且覆盖 Feishu 多种 card 模式；与 `feishu-adapter.ts` 的 streaming card runtime 强耦合，后续 Feishu UI 调整会穿透较多函数。
- 处置建议：可按 Feishu rich command card 与 structured streaming/final card 分成两个 renderer；不要拆成每个 JSON element helper 文件。

### `src/lib/bridge/markdown/ir.ts`

- 初判：不判为“屎山级别”。它是 markdown parser IR 纯规则文件，表格/list/link/style/chunk 都围绕 MarkdownIR。
- 保留风险：739 行，算法复杂但职责集中。
- 处置建议：保留，必要时补算法注释和 focused tests，而不是拆碎。

### `src/codex/session-index/core.ts`

- 初判：暂不判为“屎山级别”。它是 Local Codex Session Index public core/facade，汇总 discovery、visibility、workspace filter、archive、history/event/mirror readers。
- 保留风险：`core.ts` 仍承载 list/get/archive/history/event/mirror 多个 use case；名字 `core` 不如 `session-index.ts` 清楚，但外层已有 `src/codex/session-index.ts` facade。
- 处置建议：后续可把 public facade 留在 `session-index.ts`，把 `core.ts` 改名为 `session-catalog.ts` 或分离 history/mirror readers，避免“core”继续吸收新职责。

### `src/codex/session-index/event-mirror-parser.ts`

- 初判：不判为“屎山级别”。它是 Codex JSONL event -> mirror record parser，复杂度来自协议分支而非抽象错误。
- 保留风险：654 行，`pushCodexMirrorEventRecord` / `pushCodexMirrorResponseRecord` 仍很大；新增 Codex event kind 时需要谨慎。
- 处置建议：按 event_msg / response_item parser tables 拆纯规则时可以做，但不是收尾必须。

### `src/codex/session-index/discovery-scanner.ts`

- 初判：不判为“屎山级别”。递归扫描 `.jsonl` 文件，职责单一。
- 处置建议：保持。

### `src/codex/session-index/history-parser.ts`

- 初判：不判为“屎山级别”。它是 Codex JSONL history renderer/parser，复杂度来自协议事件种类和展示格式。
- 保留风险：多种 payload kind 的 rendering 分支集中在一个函数，后续可做 table-driven parser，但当前路径清楚。
- 处置建议：保留。

### `src/codex/session-index/file-readers.ts`

- 初判：不判为“屎山级别”。低层文件读取 helper，职责单一。
- 处置建议：保持。

### `src/codex/session-index.ts`

- 初判：不判为“屎山级别”。它是单行 public facade，把外部入口稳定在 `src/codex/session-index.ts`。
- 处置建议：保持；如果内部 `core.ts` 后续改名，facade 继续保护外部 import。

### `src/codex/session-index/archive-store.ts`

- 初判：不判为“屎山级别”。它只负责 archived session 文件名解析、归档目录扫描和跨设备 move fallback。
- 处置建议：保持。

### `src/codex/session-index/paths.ts`

- 初判：不判为“屎山级别”。它集中 Codex home/session/index/global-state 路径，职责单一。
- 处置建议：保持。

### `src/codex/session-index/sqlite-visibility.ts`

- 初判：不判为“屎山级别”。它只读取 Codex state sqlite 中未归档 thread 可见性，并处理 updated_at 解析。
- 保留风险：直接依赖 `node:sqlite`，运行环境必须是 Node.js 24；这与仓库执行约束一致。
- 处置建议：保持。

### `src/codex/session-index/workspace-filter.ts`

- 初判：不判为“屎山级别”。它集中 saved workspace roots 和 internal skill workspace filter，职责清楚。
- 保留风险：读取 `.codex-global-state.json` 里的 `electron-saved-workspace-roots` 历史字段名，文档中应避免把它误解释成 Desktop canonical 术语。
- 处置建议：保持。

### `src/main.ts`

- 初判：不判为“屎山级别”不合理抽象。它是 daemon composition root，负责实例锁、配置/store/provider/context 组装、状态文件写入、生命周期回调和进程信号。
- 保留风险：同时写 status/PID、mask proxy env、处理 shutdown/unhandled error；但作为进程入口可接受。
- 处置建议：只有当 daemon 状态文件协议继续增长时，才抽 daemon status writer；不要拆成泛用 bootstrap helper。

### `src/lib/bridge/mirror-feedback-controller.ts`

- 初判：暂不判为“屎山级别”。它是 Mirror Runtime 的 feedback/delivery owner，集中处理 mirror stream card 状态、mirror final delivery、attachment delivery 和 hooks。
- 保留风险：441 行且同时 import stream-feedback、delivery-pipeline、response-assembler、mirror-formatters、bridge-channel-runtime；如果继续增长，会把 mirror stream UI 与 mirror final delivery 绑死。
- 处置建议：后续可分为 mirror streaming feedback 和 mirror finalized delivery 两个内部 owner，但不要把它们藏回 bridge-manager。

### `src/lib/bridge/mirror-runtime.ts`

- 初判：不判为“屎山级别”不合理抽象。它是 mirror subscription runtime owner，通过 deps 接收 store/session/health/delivery/route 端口，内部流程围绕 subscription set sync、file watch、reconcile、delivery retry。
- 保留风险：deps interface 很宽，但这是 runtime 与 bridge host 的真实边界；当前比直接留在 bridge-manager 更清楚。
- 处置建议：继续按 reconcile subdomain 抽纯 plan/core，不要再做无语义 composition。

### `src/lib/bridge/mirror-reconcile-core.ts`

- 初判：不判为“屎山级别”。它是 mirror file snapshot / cursor reconcile 纯执行核心，从文件 stat、source refresh 到 delta read 都围绕 mirror reconcile。
- 保留风险：`readMirrorDeliverableRecords` 同时处理 full recover 和 incremental read，但这是同一 cursor invariant。
- 处置建议：保持。

### `src/lib/bridge/mirror-delivery-plan.ts`

- 初判：不判为“屎山级别”。它是小而明确的 mirror delivery plan 纯函数，封装 suppressed record buffering、timeout turn 和 active-task blocked 策略。
- 处置建议：保持。

### `src/lib/bridge/mirror-subscription-state.ts`

- 初判：暂不判为“屎山级别”。它是 mirror subscription state owner，集中 subscription identity、file cursor、watcher target、buffered records、pending turn/delivery、unknown kind 和 failure suspension 状态。
- 保留风险：状态字段较多，且 pending delivery / failure suspension / file read cursor 都在同一 subscription bag；但这是 mirror runtime 的真实持久内存状态，不是空 facade。
- 处置建议：保持；若后续继续增长，优先按 read cursor、delivery queue、failure backoff 拆内部 state helpers。

### `src/lib/bridge/stream-feedback-controller.ts`

- 初判：暂不判为“屎山级别”。它是 adapter streaming feedback push helper，集中 text/tool/task/status/metadata/actions/finalize 的 best-effort 调用。
- 保留风险：文件名叫 controller，但实现更像 delivery adapter helper；同时依赖 `renderFeedbackTextForChannel`。
- 处置建议：可后续改名为 `stream-feedback-delivery.ts` 或与 delivery layer 关系澄清；当前职责足够集中。

### `src/lib/bridge/turns/turn-coordinator.ts`

- 初判：不判为“屎山级别”。它只维护 active interactive turn by session，并处理 Codex terminal record claim/release。
- 处置建议：保持。

### `src/lib/bridge/turns/turn-classifier.ts`

- 初判：不判为“屎山级别”。它是 bridge session/binding -> turn kind 的小规则 owner。
- 保留风险：`getCodexThreadId` 的 `_binding` 参数目前未使用，说明历史接口有轻微残留；不构成不合理抽象。
- 处置建议：保持，后续可清理未使用参数。

### `src/lib/bridge/turns/turn-types.ts`

- 初判：不判为“屎山级别”。它是 turn shared contract 类型文件，没有混入行为逻辑。
- 处置建议：保持。

### `src/lib/bridge/turns/local-codex-terminal-router.ts`

- 初判：不判为“屎山级别”。它只负责把 Codex mirror terminal record 路由给 active IM turn coordinator，并返回 claimed/unclaimed records。
- 处置建议：保持。

### `src/lib/bridge/turns/stream-state.ts`

- 初判：暂不判为“屎山级别”。它集中 stream runtime state mutation 和 runtime status 文案格式化，体量小且规则内聚。
- 保留风险：state reducer 与中文 status rendering 在同一文件；如果后续多 channel 文案出现，需拆 display formatter。
- 处置建议：当前保持。

### `src/lib/bridge/turns/delivery-pipeline.ts`

- 初判：不判为“屎山级别”。它是 final response text/attachment delivery pipeline，封装 text delivery、attachment-only delivery 和 `SendResult` normalization。
- 处置建议：保持。

### `src/lib/bridge/turns/response-assembler.ts`

- 初判：不判为“屎山级别”。它集中 final response text、artifact block parsing、attachment dedupe、SDK/Codex final source assembly。
- 保留风险：artifact parsing 依赖 `outbound-artifacts.ts`，但职责边界清楚。
- 处置建议：保持。

### `src/lib/bridge/mirror-reconcile-batch.ts`

- 初判：不判为“屎山级别”。它是 mirror reconcile 批处理循环，deps 明确，职责是 sync subscription set 后逐个 reconcile 并处理 failure。
- 处置建议：保持。

### `src/lib/bridge/mirror-subscription-registry.ts`

- 初判：不判为“屎山级别”。它是纯 plan builder，根据 active channel、existing binding 和 session codex thread 状态计算 upsert/remove。
- 处置建议：保持。

### `src/lib/bridge/outbound-artifacts.ts`

- 初判：不判为“屎山级别”。它是 `<cti-send>` artifact block parser/stripper/support predicate，职责集中。
- 保留风险：当前 `supportsOutboundArtifacts` 只允许 `feishu`，后续多平台支持时应避免把平台规则继续塞进 parser。
- 处置建议：保持。

### `src/lib/bridge/streaming-metadata.ts`

- 初判：不判为“屎山级别”。它只负责 streaming context tag/id 格式化。
- 处置建议：保持。

### `src/lib/bridge/adapter-sync-plan.ts`

- 初判：不判为“屎山级别”。它是 adapter config fingerprint 和 sync plan 纯函数，已从 runtime lifecycle 中分离出来。
- 处置建议：保持。

### `src/lib/bridge/feedback-delivery.ts`

- 初判：暂不判为“屎山级别”。它是 response/notice/final attachment delivery facade，复用 `delivery-layer.ts` 和 channel parse mode。
- 保留风险：依赖已标注的 `bridge-channel-runtime.ts` / `delivery-layer.ts`，并在 final response 中处理 caption、unsupported attachment fallback 和 attachment error 文案。
- 处置建议：当前保持；若 delivery-layer 拆分，跟随调整为 final response delivery adapter。

### `src/lib/bridge/command.ts`

- 初判：不判为“屎山级别”。它是 command public facade，只 re-export command 对外 API，避免 bridge runtime 直接 import command 内部文件。
- 处置建议：保持，但不要继续向 facade 塞实现逻辑。

### `src/lib/bridge/command-callbacks.ts`

- 初判：不判为“屎山级别”。它是 command callback data 编解码和 thread card update key 纯规则。
- 处置建议：保持。

### `src/lib/bridge/command-errors.ts`

- 初判：不判为“屎山级别”。它只负责 command/binding user-visible error 文案归一。
- 处置建议：保持。

### `src/lib/bridge/command/aliases.ts`

- 初判：不判为“屎山级别”。它是 command alias、known command、escaped slash、thread list args、reasoning effort 解析规则。
- 保留风险：known commands set 需要和 dispatch/help 保持同步；这是 command module 内部一致性问题。
- 处置建议：保持。

### `src/lib/bridge/command/help.ts`

- 初判：不判为“屎山级别”。它是 command help text renderer。
- 保留风险：长文案需要和 dispatch/aliases 手动同步。
- 处置建议：保持，后续若命令元数据化再统一生成。

### `src/lib/bridge/command/diagnostics-presentation.ts`

- 初判：不判为“屎山级别”。它是 health/status diagnostics 的 command presentation formatter。
- 保留风险：`formatCommandTimestamp` 读取 `Date.now()`，测试相对时间时需控制时钟。
- 处置建议：保持。

### `src/lib/bridge/command/session-source.ts`

- 初判：不判为“屎山级别”。它是 command 对 Local Codex Session Index 的窄 source adapter，且带安全校验和失败降级。
- 处置建议：保持。

### `src/lib/bridge/command/thread-display.ts`

- 初判：暂不判为“屎山级别”。它是 command thread display adapter，集中 chat binding response、Codex thread card refresh、bound thread card refresh 和 selection/decorate 规则。
- 保留风险：依赖 `ThreadDisplayService` 和 `listBindingsForChat`，如果继续增长可能把 command card rendering 与 display selection 混在一起。
- 处置建议：当前保持，后续只按 command thread display 用户故事拆。

### `src/lib/bridge/command/thread-table-message-pins.ts`

- 初判：不判为“屎山级别”。它是 `/t` thread table message id persistence + pin/unpin owner，文件路径和职责一致。
- 保留风险：直接读写 `CTI_HOME/data/thread-table-messages.json`，后续若需要多进程并发再迁 store。
- 处置建议：保持。

### `src/lib/bridge/display/channel-label.ts`

- 初判：不判为“屎山级别”。它是 channel binding chat label 纯格式化。
- 处置建议：保持。

### `src/lib/bridge/display/session-creator.ts`

- 初判：不判为“屎山级别”。它集中 CreatorKind 解析和 badge 展示，符合 canonical 术语方向。
- 保留风险：仍保留 `desktop` CreatorKind，但仅当 source/originator 明确包含 desktop 时出现，符合当前术语约束。
- 处置建议：保持。

### `src/lib/bridge/display/session-display-query.ts`

- 初判：暂不判为“屎山级别”。它是 session/binding display query owner，集中 BridgeSession/CodexSession display summary、dedupe 和 counts。
- 保留风险：`SessionDisplayQuery.listSessions` 同时做 dedupe、排序和 counts；但这是同一 UI/query payload invariant。
- 处置建议：保持，后续如增长再拆 counts builder。

### `src/lib/bridge/display/session-title.ts`

- 初判：不判为“屎山级别”。它是 session display name 纯规则，并显式清理 legacy `Desktop:` 前缀。
- 处置建议：保持。

### `src/lib/bridge/interactive-turn/final-response-plan.ts`

- 初判：不判为“屎山级别”。它是 interactive final response/card delivery plan 纯规则，集中 terminal final、process final、stale task notice 和 error card fallback。
- 保留风险：命名偏抽象，但内容是明确 final response decision table，不是 DI/composition 中转。
- 处置建议：保持。

### `src/lib/bridge/interactive-turn/sdk-attachments.ts`

- 初判：不判为“屎山级别”。它是 SDK turn attachment persistence/prompt supplement owner，处理本地落盘、非图片文件 prompt supplement 和 LLM file metadata。
- 保留风险：仍使用 `.codepilot-uploads` 历史目录名；如未来统一品牌/术语，可迁移目录或兼容旧目录。
- 处置建议：保持。

### `src/lib/bridge/interactive-turn/sdk-stream-events-controller.ts`

- 初判：暂不判为“屎山级别”。它是 SDK stream event -> stream UI / health progress / task state 的 controller，职责围绕 interactive SDK event projection。
- 保留风险：内部同时做 tool value masking/sanitizing、health progress、stream feedback 和 preview text；但这些都服务同一个 stream event user story。
- 处置建议：保持；后续如增长，优先拆 tool summary pure helper。

### `src/lib/bridge/interactive-turn/sdk-stream-preview.ts`

- 初判：不判为“屎山级别”。它是 inline stream preview markdown block builder，职责集中。
- 处置建议：保持。

### `src/lib/bridge/interactive-turn/terminal-finalization-controller.ts`

- 初判：不判为“屎山级别”。它封装 external terminal finalization 与 process race/wait/settle 的状态机，边界明确。
- 保留风险：promise 状态机需要 focused tests 保护；当前不属于不合理抽象。
- 处置建议：保持。

### `src/lib/bridge/markdown/fence.ts`

- 初判：不判为“屎山级别”。它只负责安全生成 fenced code block。
- 处置建议：保持。

### `src/lib/bridge/markdown/plain.ts`

- 初判：不判为“屎山级别”。它是 markdown IR -> plain text renderer wrapper。
- 处置建议：保持。

### `src/lib/bridge/markdown/render.ts`

- 初判：不判为“屎山级别”。它是 MarkdownIR marker renderer，算法复杂但职责单一。
- 处置建议：保持。

### `src/lib/bridge/security/validators.ts`

- 初判：暂不判为“屎山级别”。它集中 working directory、session id、dangerous input、sanitize input、mode parsing validation。
- 保留风险：security validators 与 command mode parsing 混在同一文件，后者更像 command setting rule；体量小，暂不拆。
- 处置建议：保持，后续可将 `parseMode` 移到 command runtime settings。

### `src/lib/bridge/security/rate-limiter.ts`

- 初判：不判为“屎山级别”。它是 per-chat sliding window rate limiter，职责单一。
- 处置建议：保持。

### `src/lib/bridge/session-health-process.ts`

- 初判：不判为“屎山级别”。它是 Windows Codex thread process probe adapter，平台边界清楚。
- 处置建议：保持。

### `src/lib/bridge/session-health-reducer.ts`

- 初判：暂不判为“屎山级别”。它是 session health pure reducer/diagnosis rules，虽然 464 行但集中处理 progress/tool/stream UI/process probe 状态。
- 保留风险：健康状态、中文原因文案和 stream UI stall 判定在同一 reducer；但这是同一 health invariant。
- 处置建议：保持，后续可按 process probe diagnosis / stream UI diagnosis 拆纯函数文件。

### `src/lib/bridge/session-health-runtime.ts`

- 初判：暂不判为“屎山级别”。它是 session health runtime owner，负责记录 interactive/mirror progress、tool state、structured stream UI snapshot、reconcile 和 diagnose。
- 保留风险：记录和诊断两个方向在同一 runtime；如果健康体系继续增长，可拆 progress recorder 与 diagnosis query。
- 处置建议：保持。

### `src/lib/bridge/session-registry.ts`

- 初判：暂不判为“屎山级别”。它是 Session Registry public service/facade，承接 bind/import/switch/default target/materialize/rename/delete/archive 等 session/binding use cases。
- 保留风险：内部已经很接近 application service，继续增长可能重复 `session-registry/bindings.ts` 的 query/mutation混合问题。
- 处置建议：保持 facade，后续内部按 query/mutation/default/archive 拆。

### `src/lib/bridge/sse-stream-decoder.ts`

- 初判：不判为“屎山级别”。它是 SSE line decoder，职责单一。
- 处置建议：保持。

### `src/lib/bridge/tmux/runtime.ts`

- 初判：暂不判为“屎山级别”。它是 tmux process/runtime adapter，集中 command preview、env forwarding、Codex resume tmux command、session start/interrupt/list。
- 保留风险：Codex TUI env forwarding 与 tmux command execution 在同一文件；但这是 tmux runtime 的自然边界。
- 处置建议：保持，后续如增长可拆 env preview helper。

### `src/lib/bridge/binding-audit.ts`

- 初判：不判为“屎山级别”。它是 binding change audit summary writer，职责单一。
- 处置建议：保持。

### `src/lib/bridge/examples/mock-host.ts`

- 初判：暂不判为“屎山级别”。它是 example/mock host，不参与 runtime 模块边界。
- 保留风险：注释和示例文案仍出现历史 `CodePilot` 名称，可能误导新读者；这属于示例/文档术语债，不是生产抽象问题。
- 处置建议：后续文档清理时改为 Codex-to-IM / Bridge。

### `src/bridge-instance-lock.ts`

- 初判：不判为“屎山级别”。它是 bridge singleton lock 文件 owner，集中读锁、检测 PID、acquire/release/clear stale。
- 处置建议：保持。

### `src/cli.ts`

- 初判：暂不判为“屎山级别”。它是 CLI command switchboard，负责 start/open/url/stop/status/autostart/uninstall。
- 保留风险：强依赖已标注的 `service-manager.ts` catch-all；CLI 本身目前只是薄入口。
- 处置建议：保持 CLI switchboard，后续跟随 service-manager workflow 拆分调整 import。

### `src/codex/models.ts`

- 初判：不判为“屎山级别”。它是 Codex config/model cache reader，职责集中。
- 处置建议：保持。

### `src/codex/routing-provider.ts`

- 初判：不判为“屎山级别”。它是 SDK/tmux Codex provider router，职责清楚。
- 处置建议：保持。

### `src/codex/session-mirror.ts`

- 初判：不判为“屎山级别”。它是 Codex mirror cursor advance/reconcile 纯规则。
- 处置建议：保持。

### `src/internal-sessions.ts`

- 初判：不判为“屎山级别”。它集中 hidden draft session TTL、scratch dir、cleanup、get/reset draft session。
- 保留风险：`Draft:` 前缀是内部实现名，不应泄露成业务术语。
- 处置建议：保持。

### `src/logger.ts`

- 初判：暂不判为“屎山级别”。它是 process logger setup，集中 secret mask、log arg formatting、rotation、console override。
- 保留风险：`setupLogger` monkey-patches `console.*`，测试或嵌入式使用时要小心；但这是进程级 logger owner。
- 处置建议：保持。

### `src/permission-gateway.ts`

- 初判：不判为“屎山级别”。它是 pending permission promise registry，职责单一。
- 处置建议：保持。

### `src/runtime-options.ts`

- 初判：不判为“屎山级别”。它集中 sandbox/reasoning/channel id normalization。
- 保留风险：`normalizeChannelId` 与 runtime options 语义略不同，但体量小。
- 处置建议：保持。

### `src/sse-utils.ts`

- 初判：不判为“屎山级别”。它只负责格式化 SSE event 字符串。
- 处置建议：保持。

### `src/storage-migrations.ts`

- 初判：暂不判为“屎山级别”。它是 startup storage migration owner，集中 sessions、bindings、channel defaults 和 ui-session-meta 旧数据迁移。
- 保留风险：文件包含大量 retired field names（`desktop*`、`codepilot*`、`threadId`），但这是迁移兼容所需；文档/新代码不应复用这些术语。
- 处置建议：保持，迁移完成后可按 schema generation 拆分。

### `src/qrcode.d.ts`

- 初判：不判为“屎山级别”。它是 `qrcode` 模块类型声明。
- 处置建议：保持。

### `src/ui/application/binding.ts`

- 初判：不判为“屎山级别”。它是 UI binding application thin wrapper，委托 SessionRegistryService 执行 binding/default target mutation。
- 处置建议：保持。

### `src/ui/application/channel.ts`

- 初判：暂不判为“屎山级别”。它是 UI channel config application rules，集中 channel id/alias、Feishu/Weixin config merge、Weixin account conflict 和 Feishu credential validation。
- 保留风险：Feishu credential validation 发网络请求，和纯 config merge 在同一文件；但都属于 channel settings workflow。
- 处置建议：保持。

### `src/ui/application/chat-display.ts`

- 初判：暂不判为“屎山级别”。它是 UI binding chat display enrichment owner，集中 Feishu token/cache、chat/user lookup 和 bindings payload enrichment。
- 保留风险：Feishu API lookup、cache 和 store update 都在同一文件；如果支持更多平台显示名，需按 provider display resolver 拆。
- 处置建议：保持。

### `src/ui/application/config.ts`

- 初判：不判为“屎山级别”。它是 UI config payload/merge rules，职责集中。
- 保留风险：模块加载时缓存 `availableCodexModels`，如果模型缓存运行时更新，UI 需要重启或刷新模块。
- 处置建议：保持。

### `src/ui/assets.ts`

- 初判：不判为“屎山级别”。它是 UI CSS asset string owner，虽 1106 行但不是不合理抽象。
- 保留风险：和 `ui/shell.ts` 一样缺少前端 asset/build 边界。
- 处置建议：保持，后续如继续 UI 改造再引入前端 asset 分层。

### `src/ui/routes/auth.ts`

- 初判：暂不判为“屎山级别”。它是 UI auth/access route owner，集中 cookie、local/LAN auth、login/access-denied HTML 和 auth API。
- 保留风险：route handler 与 HTML template 在同一文件；体量可接受。
- 处置建议：保持。

### `src/ui/routes/binding.ts`

- 初判：不判为“屎山级别”。它是 UI binding routes thin layer，委托 `UiBindingApplication` 和 payload builder。
- 处置建议：保持。

### `src/ui/routes/channel.ts`

- 初判：暂不判为“屎山级别”。它是 UI channel routes owner，处理 save/delete/test 和 binding channel meta sync。
- 保留风险：route 直接 load/save config 并更新 binding meta；当前仍是同一 channel settings workflow。
- 处置建议：保持。

### `src/ui/routes/config.ts`

- 初判：不判为“屎山级别”。它是 UI config route thin layer。
- 处置建议：保持。

### `src/ui/routes/service.ts`

- 初判：暂不判为“屎山级别”。它是 UI service route thin layer，暴露 status、install integration、bridge start/stop/restart、logs。
- 保留风险：依赖已标注的 `service-manager.ts` catch-all；route 本身没有扩散复杂度。
- 处置建议：保持。

### `src/lib/bridge/adapters/index.ts`

- 初判：不判为“屎山级别”。它是 adapter catalog side-effect import 入口，用于注册所有 channel adapters。
- 处置建议：保持。

### `src/lib/bridge/adapters/weixin/weixin-api.ts`

- 初判：暂不判为“屎山级别”。它是 Weixin bot API transport owner，集中 getupdates/sendmessage/getconfig/typing/QR login endpoints。
- 保留风险：message API 与 QR login API 在同一 transport 文件；但都属于 Weixin bot HTTP API adapter。
- 处置建议：保持。

### `src/lib/bridge/adapters/weixin/weixin-ids.ts`

- 初判：不判为“屎山级别”。它是 Weixin composite chat id encode/decode 纯规则。
- 处置建议：保持。

### `src/lib/bridge/adapters/weixin/weixin-media.ts`

- 初判：不判为“屎山级别”。它是 Weixin media CDN download/decrypt/attachment conversion owner。
- 处置建议：保持。

### `src/lib/bridge/adapters/weixin/weixin-session-guard.ts`

- 初判：不判为“屎山级别”。它是 Weixin account pause guard，职责单一。
- 处置建议：保持。

### `src/lib/bridge/adapters/weixin/weixin-types.ts`

- 初判：不判为“屎山级别”。它是 Weixin protocol DTO/type constants 文件。
- 处置建议：保持。

### `src/ui/routes/session.ts`

- 初判：暂不判为“屎山级别”。它是 UI session routes thin layer，转发 list/history/config/import/rename/update/delete 到 `UiSessionApplication`。
- 保留风险：一个 route handler 覆盖多个 session endpoint；当前仍是同一 UI session workflow。
- 处置建议：保持。

### `src/ui/routes/weixin-login.ts`

- 初判：暂不判为“屎山级别”。它是 UI Weixin login route owner，处理 popup page、CLI/web login API、session status 和 confirmed account 写回 config。
- 保留风险：依赖已标注的 `weixin/login.ts` 混合 owner；route 本身只是薄协调层。
- 处置建议：保持。

### `src/ui/session-history.ts`

- 初判：不判为“屎山级别”。它是 Codex mirror records -> UI history entries 纯格式化。
- 处置建议：保持。

### `src/lib/bridge/interactive-turn/turn-environment.ts`

- 初判：不判为“屎山级别”不合理抽象。文件负责 interactive turn environment、runtime settings、display metadata 和 stale binding notice，体量小且语义集中。
- 保留风险：`buildInteractiveStreamCardMetadata` import mirror formatter/streaming metadata，命名上仍暴露 interactive turn 与 shared stream metadata 的交叉。
- 处置建议：如继续规整，迁移 shared stream metadata helper 的命名，而不是拆这个文件。

### `src/lib/bridge/interactive-turn/stream-ui-controller.ts`

- 初判：不判为“屎山级别”不合理抽象。它是 structured stream UI controller，封装 stop actions、feedback target、heartbeat、snapshot、finalize once。
- 保留风险：与 shared `stream-feedback-controller.ts` 关系需要继续命名澄清，但当前 controller 职责清楚。
- 处置建议：保留；后续如抽象，应改名/路径表达 shared feedback vs interactive UI，而非新增 wrapper。

### `src/ui/application/session.ts`

- 初判：不判为“屎山级别”不合理抽象。它是 UI session application，用例包括 list/history/config/import/rename/delete，已通过 `UiSessionCodexSource` 隔离本地 Codex source。
- 保留风险：仍包含 markdown rendering、payload sanitize、summary conversion 与 registry composition；但比迁出前入口更清楚。
- 处置建议：如果继续拆，优先分离 history rendering 或 config sanitize；不要把每个 UI action 单独拆小文件。

### `src/ui/application/session-source.ts`

- 初判：不判为“屎山级别”不合理抽象。它是 UI session 对 Local Codex Session Index 和 SessionRegistryService 的 source/registry adapter。
- 保留风险：同时包装 Codex source 和 registry creation，名字 `session-source` 对 registry composition 表达略弱。
- 处置建议：如果后续混淆明显，可改名为 `session-codex-source.ts` 或拆出 `session-registry-adapter.ts`；当前不急。

## 待逐文件审计清单

- 当前 `src` 下 137 个生产 `.ts` / `.d.ts` 文件已全部完成逐文件初判。
