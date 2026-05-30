# Codex-to-IM Rebuild Status

## 任务目标

### 原始指令

本文件是本轮 rebuild 任务的主入口。它记录当前架构理解、严格扫描结论、重构目标形态和后续执行计划。

目标不是按文件大小机械拆分，也不是把现有代码搬到更多小文件里。目标是把当前代码整理成自然聚合物：

- 大模块胖而紧凑，拥有清晰业务边界和内部协作；
- 小模块只在同一大模块内服务明确职责，不把共享概念拆碎；
- 模块之间通过窄接口连接，避免跨层直接读取对方内部状态；
- 术语无歧义，字段名和模型名表达真实业务含义；
- 不合适的设计要先标记为待迁移目标，不能在新架构文档里合理化。

### 用户追加和纠偏

- 2026-05-30 用户纠偏：最终目标不是只整理 command 模块。command 的重构思路可以作为样板：先按文件级依赖和职责审计，再重划聚合边界，最后小步重构。但同样的方法必须覆盖当前每一个 `src/**/*.ts` 源文件。
- 2026-05-30 用户纠偏：不能把 command 模块机械拆分当成完成；必须先按文件级依赖、导入对象、实际职责和高内聚/低耦合目标审计。
- 2026-05-30 用户纠偏：关键认识、计划、扫描事实、修改和验证必须立即落盘到本文件；阶段完成后做阶段审计、归档原始素材，并用本地 commit/amend 收口。
- 2026-05-30 04:14 用户追加：以 `work/rebuild` 为工作目录，将 `STATUS.md` 整理成符合要求的格式。
- 2026-05-30 04:19 用户追加：上次 hot update 脚本没有派发出去，要求重新派发一次。
- 2026-05-30 04:22 用户追加：用户更新了 `AGENTS.md`，要求按照新格式更新 `work/rebuild/STATUS.md`。
- 2026-05-30 04:30 用户追加：继续推进当前长期目标；工作目录是 `work/rebuild`，按照状态文件和项目指示完成任务。
- 2026-05-30 04:31 用户纠偏：不要盯着 command 耦合程度刷榜；应做全文件审计和自然聚类，用全局模块形态判断下一步重构边界。
- 2026-05-30 04:38 用户追加：继续当前长期目标；仍以 `work/rebuild` 为工作目录推进。
- 2026-05-30 04:54 用户纠偏：审计模型要区分内聚边和外聚边，并且度数从文件粒度改为函数粒度；这更贴近人类直观，也要求重构时思考简化函数。
- 2026-05-30 04:56 用户追加：继续推进 active thread goal；以当前工作树和外部状态为权威，不把部分进展重定义为完成。
- 2026-05-30 05:02 用户纠偏：函数级审计解析不要继续依赖 regex/string scanning，应使用 AST 好好解析。
- 2026-05-30 05:15 用户追加：继续推进 active thread goal；仍以 `work/rebuild` 和当前工作树为权威。

## 任务上下文

### 工作目录和权威文件

- 当前工作目录：`/data00/home/hongli.fish/Codex/codex-to-im`
- 本轮 rebuild 工作目录：`work/rebuild`
- 本轮 rebuild 主状态文件：`work/rebuild/STATUS.md`
- 当前架构入口：`docs/current-architecture.md`
- 历史分析入口：`work/analysis/STATUS.md`
- 全源文件审计产物：`work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md`
- 混合簇边界审计产物：`work/rebuild/mixed-cluster-boundary-audit.md`
- 审计脚本：`work/rebuild/source-audit.mjs`
- 前序 rebuild feature commit 主题：`Add session display and registry rebuild slice`
- 最近提交：`Extract UI config routes and AST audit`，包含 UI config route 模块、AST 函数级审计、聚焦测试、审计产物、阶段状态和归档。
- 当前工作树仅剩 `AGENTS.md` 未提交改动；这是用户侧协作规范更新，不属于当前 rebuild 阶段提交范围。

### 已归档状态材料

- `work/rebuild/STATUS-20260530-0336-final-instructions-binding-id.md`
- `work/rebuild/STATUS-20260530-0400-source-audit-command-boundary.md`
- `work/rebuild/STATUS-20260530-0414-status-format-normalization.md`
- `work/rebuild/STATUS-20260530-0422-status-format-v2.md`
- `work/rebuild/STATUS-20260530-0435-natural-clustering-audit.md`
- `work/rebuild/STATUS-20260530-0442-mixed-cluster-boundary.md`
- `work/rebuild/STATUS-20260530-0449-ui-service-routes.md`
- `work/rebuild/STATUS-20260530-0513-ui-config-ast-function-audit.md`

### 当前执行约束

- 新版 `AGENTS.md` 要求 `STATUS.md` 只包含三个 h2 主区块：任务目标、任务上下文、任务日志。
- 阶段日志使用 h3 阶段条目，阶段条目必须带精确到分钟级别的时间戳。
- 阶段条目内部使用 `> 阶段描述：...`，然后用列表记录行动条目、阶段验证和 git 提交、下一个阶段计划。
- Node.js 开发命令必须使用 Node.js 24；必要时使用 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && ...`。
- 除非用户明确要求，不 push、不 hot update、不 redeploy 本地 bridge。
- 每个阶段完成后必须同步本文件、归档原始素材，并提交到本地 git。同一功能阶段的 follow-up 如未 push，应优先 `git commit --amend` 合并。

### 模块形态原则

- 大模块应该是业务聚合边界，不是目录标签。一个大模块可以很胖，但必须紧凑。
- 小模块只服务明确目的：隔离基础设施实现、封装同一大模块内复杂算法、隔离平台 API/文件格式/协议格式、提供可测纯规则。
- 不接受因为文件长就拆、把同一个 invariant 拆到多个模块、为几行代码制造公共 util、让 UI/command/adapter 各自复制 session/thread/display 规则。
- 外部模块不能为了方便 import 内部 helper；外部接口必须窄。

### Canonical 术语

- `BridgeSession`：Codex-to-IM 自己拥有的本地会话。
- `codex_thread_id`：底层 Codex thread identity，只存在于 BridgeSession。
- `ChannelBinding`：IM chat 到 BridgeSession 的绑定。
- `IMChannel` / channel instance：Feishu/Weixin 等入口实例。
- Local Codex session index：读取 `~/.codex/sessions` 的本地 Codex 会话索引。
- Execution provider：`sdk` / `tmux` 等执行路径。
- `CodexSource`：Codex 本地 session 事实来源，包含 JSONL / SQLite 中的 `originator`、`source`、`cliVersion` 等原始字段；`cli`、`exec`、`vscode` 都是 Codex source 值，不叫 provenance。
- `Creator`：业务展示上的创建/来源类别，用来区分 `Bridge`、`SDK`、`VS Code`、`TUI / CLI`、`Native` 等 UI/IM badge；它不等同于 CodexSource。
- `Desktop`：严重错误的历史术语。除非 CodexSource 明确表明该 JSONL/session 来自桌面端 Codex，否则业务、代码、UI、测试都不应使用 Desktop 泛指 Codex session、Codex thread、mirror、history 或 Native 会话。
- `Codex`：不作为 canonical 术语。没有 Remote Codex 对立概念；读取 `~/.codex/sessions` 的索引就叫 Codex session index，记录叫 CodexSession，镜像记录叫 CodexMirrorRecord。

### Retired 术语和迁移状态

- `targetKey`：retired legacy UI/API selector，不是领域概念。当前 runtime/UI/API/store contract 已迁移到 `BridgeSession.id` / `codexThreadId`；startup storage migration 不再升级旧 selector，`channel-default-targets` v2 只接受 `bridgeSessionId`。
- `desktop:<threadId>`：retired legacy selector，只表示历史上从 local Codex session index 选中的 thread；新代码、UI/API 和 tests 不应继续生成或消费。
- `codepilotSessionId`：历史字段名，语义应是 `bridgeSessionId`。当前 `ChannelBinding` 内部字段已迁移为 `bridgeSessionId`，startup migration 仍读取旧字段并写出新字段，bindings schema 已升级到 v2。
- `desktop-sessions.ts` / `Desktop*` / `Codex*` symbols：历史或过度命名，语义应迁移为 Codex / Native；只有 Creator 明确为桌面端时才保留 `desktop` creator 值或 Desktop badge。
- `source`：重载严重，必须拆成 execution provider、CodexSource、Creator、channel provider；不再使用 provenance / display source 作为 canonical 术语。

### 最新严格扫描结论

- 全源文件审计基线：174 个 `src/**/*.ts` 文件，其中生产文件 117 个、测试文件 57 个；本地 import / re-export 边 702 条。
- 最新自然聚类审计后：179 个 `src/**/*.ts` 文件，其中生产文件 121 个、测试文件 58 个；本地 import / re-export 边 715 条；生产文件自然聚类候选 10 个。
- 自然聚类算法：以生产文件 import / re-export 图为主，叠加同目录弱亲和；测试文件不参与聚类计算，只映射到它主要覆盖的生产聚类。
- `cluster-01` 是最大混合簇：45 文件 / 13414 行 / 内部边 162 / 出边 38 / 入边 161；构成为 Bridge Host 6562 行、Feishu Adapter 2882 行、Mirror Runtime 1318 行、Session Registry 1023 行、Markdown Rendering 811 行等。它不是目标模块，而是当前 host / delivery / mirror / turn / registry 纠缠的证据。
- `cluster-02` 是第二个混合簇：18 文件 / 10897 行 / 内部边 37 / 出边 17 / 入边 62；构成为 Local UI 5910 行、Config / Service 1990 行、Store / Persistence 1281 行、Weixin Adapter 914 行、Composition Roots 543 行等。它说明 UI / service management / config / persistence 仍需重新分边界。
- `cluster-03` 是 Command Application 候选簇：22 文件 / 5201 行 / 内部边 55 / 出边 69 / 入边 26；它职责相对集中但对外耦合高，只能作为后续端口化对象之一，不能作为当前全局重构完成标准。
- `cluster-04` Local Codex Session Index、`cluster-08` Session Health Runtime、`cluster-09` Markdown Rendering 是当前较清晰的自然边界候选。
- 混合簇边界审计显示：`cluster-01` 内部跨聚合边 71 条，热点是 `types.ts`、`mirror-feedback-controller.ts`、`feishu-adapter.ts`、`bridge-manager.ts`、`codex-session-index.ts`；其中一部分是 shared contracts 被归入 Bridge Host 的分类问题，另一部分是 bridge manager / mirror feedback 继续直接读取 mirror、turn、delivery 内部。
- 混合簇边界审计显示：`cluster-02` 内部跨聚合边 26 条，热点是 `config.ts`、`ui-server.ts`、`store.ts`、`main.ts`、`service-manager.ts`；核心问题是 `ui-server.ts` 同时承担 HTTP shell、配置读写、服务控制、Weixin 登录、模型查询和 route composition。
- 最大聚合基线：`Bridge Host / Runtime Contracts` 24 文件 / 6804 行 / 42 条风险跨聚合 import；`Local UI and Service Management` 5 文件 / 6035 行 / 8 条风险跨聚合 import；`Command Application` 11 文件 / 4198 行 / 50 条风险跨聚合 import。
- 第一批风险文件：`bridge-manager.ts`、`command/diagnostics.ts`、`command/dispatch.ts`、`command/session-thread.ts`、`interactive-message-runner.ts`、`mirror-feedback-controller.ts`、`ui-server.ts`、`command/runtime-settings.ts`、`command/tmux.ts`、`command/presentation.ts`、`thread-display-resolver.ts`。
- 当前最大结构性问题不是缺少文件清单，而是 `Bridge Host / Runtime Contracts` 作为 catch-all 聚合继续直接读取 command、mirror、turns、adapter、health 内部。
- 已完成第一刀后，`Bridge Host / Runtime Contracts` 风险跨聚合 import 从 42 降到 39；建立 command public facade 后从 39 降到 34，`bridge-manager.ts` 从 16 降到 13，`bridge-adapter-runtime.ts` 不再有风险跨聚合 import。
- `Command Application` 风险计数仍高，因为 command handler 继续直接 import router/registry/display/tmux/runtime helper；但下一阶段选择必须先服从全文件自然聚类，不再只按 command 风险计数推进。
- 函数级审计模型已改为 TypeScript AST 解析：当前未提交现场下覆盖 182 个 `src/**/*.ts` 文件，其中生产 123 个、测试 59 个；本地 import / re-export 边 712 条；函数节点 1526 个；函数依赖边 1743 条，其中内聚边 1485 条、外聚边 258 条。
- 当前 AST 函数外聚热点前五：`main` 外聚度 7、`runInteractiveMessage` 外聚度 5、`handleBridgeCommand` 外聚度 5、`handleThreadSwitchCommand` 外聚度 4、`handleProviderCommand` 外聚度 4。当前大函数热点前五：`renderHtml` 3148 函数体行、`runInteractiveMessage` 731、`handleBridgeCommand` 365、`createMirrorFeedbackController` 345、`createSessionHealthRuntime` 333。
- UI channel route 迁出后最新审计：185 个 `src/**/*.ts` 文件，其中生产 125 个、测试 60 个；本地 import / re-export 边 721 条；函数节点 1533 个；函数依赖边 1749 条，其中内聚 1490、外聚 259。`src/ui-server.ts` 从 4193 行降到 3940 行；`src/ui-channel-routes.ts` 164 行、`src/ui/application/channel.ts` 190 行，二者风险跨聚合 import 均为 0。

### 当前架构判断

- Identity / Display 规则仍然是高优先级边界；display query / Creator / session title 已进入 `src/lib/bridge/display/`，但仍需继续避免 command/UI/runtime 各自复制规则。
- Session / Binding Registry 是大模块，不是 util。Registry 应拥有 session/binding/default target mutation use cases，不应直接 import config 或 local Codex scanner。
- Local Codex Session Index 是独立基础设施大模块。它应保留胖模块形态，但内部继续拆成紧凑子模块；对外只暴露 list/get/read history/read mirror delta/archive/import metadata 等窄接口。
- Interactive Turn Runtime 和 Mirror Runtime 应保持分离。两者可共享 display query、delivery contracts、stream feedback primitives，不共享 turn state machine、cursor/suppression、provider SSE parsing。
- Command Layer 是 use-case switchboard。command 不应按每个命令随意拆小文件，应按用户故事族形成胖而紧凑的 command module，并分离 command execution 与 command rendering。
- Channel Delivery / Adapter 要分清可共享和不可共享。共享 delivery contract、chunk/retry/dedup/audit、rich card IR、stream feedback contract、attachment contract；不共享 Feishu/Weixin 平台协议细节。
- Local UI 是 operator workflow，不是 domain owner。UI server 应收缩成 composition root + route declarations + static UI shell，UI route 不应复制 Creator/CodexSource/session import rules。
- 自然聚类显示，当前最高优先级不应是继续细抠 command 内部，而是先处理 `cluster-01` 和 `cluster-02` 这两个混合簇：它们分别暴露 bridge host/delivery/mirror/turn/registry 纠缠，以及 local UI/config/service/store 纠缠。
- 当前下一刀建议进入 `cluster-02` 的 UI server 收缩阶段：把 `ui-server.ts` 收缩为 composition root + route dispatch + static shell，把设置、服务控制、Weixin 登录、模型列表等 workflow 移到 UI application/route 模块。`cluster-01` 仍是更大的结构性风险，但应先分清 shared contracts / delivery / runtime host 后再做高 churn 改动。

### 当前阶段计划

- 当前 UI config route 迁移和 AST 函数级审计阶段已进入收口；提交后下一阶段应基于 AST 外聚热点和自然聚类共同选择边界，不再只看文件级风险榜。
- 下一阶段候选：继续 `cluster-02` 的 channel/Weixin workflow 收缩，或转向 `cluster-01` 的 mirror / turn / delivery 外聚热点；选择前先用函数级外聚热点确认收益。
- 2026-05-30 05:15 续跑时确认上一阶段已提交，工作树仅有用户侧 `AGENTS.md` 未提交改动；本阶段先用 AST 外聚热点和自然聚类重新选择下一刀。

## 任务日志

### 2026-05-30 05:15 阶段：AST 热点驱动的下一刀选择

> 阶段描述：基于 AST 函数级外聚热点和自然聚类结果，选择下一轮重构边界，并推进一个小而清晰的模块收缩切片。

- 行动条目：
  - 续跑后读取 `STATUS.md`、`source-file-audit.md` 和当前 git 状态，确认上一阶段 `Extract UI config routes and AST audit` 已提交；当前未提交改动只有用户侧 `AGENTS.md`。本阶段将先审计 `cluster-02` channel/Weixin workflow 与 `cluster-01` mirror/turn/delivery 外聚热点，选择能减少跨职责读取且验证面可控的一刀。AST 热点显示 `cluster-02` 中 `ui-server.ts` 的 `mergeChannelInstance`、`resolveFeishuBindingDisplay`、`buildUiAccessInfo` 仍是 Local UI 外聚点；`cluster-01` 的 mirror/turn/delivery 外聚更深且验证面更大。因此本阶段选择继续 `cluster-02`，先迁出 `/api/channels/save`、`/api/channels/delete`、`/api/channels/test`，暂不迁出 Weixin login web session 和 Feishu binding display enrichment。已新增 `src/ui/application/channel.ts` 承接 channel merge/delete/Feishu credential validation 规则，新增 `src/ui-channel-routes.ts` 承接 channel save/delete/test routes，`ui-server.ts` 只把 route 接入现有 store 和 bindings payload。聚焦测试 9 tests 通过；复跑审计显示 `ui-server.ts` 从 4193 行降到 3940 行，新增 `ui-channel-routes.ts` / `ui/application/channel.ts` 均为 Local UI 聚合且风险跨聚合 import 为 0。
- 阶段验证和git提交（如通过）：
  - 2026-05-30 05:21 当前进入阶段审计：确认本阶段只迁出 channel save/delete/test route 和 channel config 规则，没有迁出 Weixin login web session，也没有改 Feishu binding display enrichment；审计重点是路由行为保持、`ui-server.ts` 职责收缩、AST 审计产物复跑。
  - 已通过：`npm run typecheck`。
  - 已通过：`node --test --import tsx src/__tests__/ui-channel-routes.test.ts src/__tests__/ui-config-routes.test.ts src/__tests__/ui-service-routes.test.ts`，9 tests 全部通过。
  - 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && node source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，464 tests 全部通过。
  - 已通过：`git diff --check -- src/ui-server.ts src/ui-channel-routes.ts src/ui/application/channel.ts src/__tests__/ui-channel-routes.test.ts work/rebuild/STATUS.md work/rebuild/source-file-audit.json work/rebuild/source-file-audit.md`。
- 下一个阶段计划：
  - 归档本阶段原始行动记录和扫描输出摘要，压缩主状态文件，并提交本阶段 rebuild 相关改动；用户侧 `AGENTS.md` 改动不纳入本阶段提交。

### 2026-05-30 03:36 阶段：目标纠偏与 binding id 收口

> 阶段描述：把长期 rebuild 任务的红线原则写入仓库协作规范，并收尾 `ChannelBinding` 内部字段从 `codepilotSessionId` 到 `bridgeSessionId` 的命名迁移。

- 行动条目：
  - 明确最终目标升级为“审计当前每一个源文件 -> 重新划分模块 -> 分阶段重构”；command 重构只作为方法样板，不能作为完成证明。
  - 将红线原则写入 `AGENTS.md`，并要求关键认识、计划、扫描事实、修改和验证立即落盘到 `STATUS.md`。
  - 完成 `ChannelBinding` 内部字段迁移；startup migration 仍读取旧字段并写出新字段；bindings schema 升级到 v2。
- 阶段验证和git提交（如通过）：
  - 验证通过：`npm run typecheck`、聚焦迁移/schema/store/registry/router 测试 50 tests、完整 `npm test` 455 tests、`npm run build`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0336-final-instructions-binding-id.md`。
  - 本地提交：已合并到前序 rebuild feature commit。
- 下一个阶段计划：
  - 进入全源文件审计，先生成机器可复核的源文件清单、import/export 图、入边/出边和职责审计表。

### 2026-05-30 04:00 阶段：全源文件审计与 command/runtime 边界第一刀

> 阶段描述：建立可复跑的全源文件审计产物，并先切断一批 bridge runtime 对 command presentation 的反向依赖。

- 行动条目：
  - 生成 `work/rebuild/source-file-audit.json`、`work/rebuild/source-file-audit.md` 和审计脚本 `work/rebuild/source-audit.mjs`。
  - 新增 `src/lib/bridge/command/thread-display.ts`，把 `/t` 命令专用的绑定列表响应、Codex thread rich card、绑定 rich card、绑定状态 DTO 从通用 `ThreadDisplayService` 移到 command 聚合。
  - `src/lib/bridge/thread-display-resolver.ts` 从 321 行收缩到 226 行，不再 import `command/presentation.ts`。
  - `src/lib/bridge/thread-table-message-pins.ts` 移到 `src/lib/bridge/command/thread-table-message-pins.ts`。
  - 扩展 `src/lib/bridge/command-callbacks.ts` 为 command callback 协议层；新增 `src/lib/bridge/command-errors.ts` 承接 command user-visible error 文案。
  - `bridge-manager.test.ts` 不再通过 `_testOnly` 间接测试 command presentation / aliases helper，而是直接 import 被测 helper。
- 阶段验证和git提交（如通过）：
  - 验证通过：`npm run typecheck`、聚焦 96 tests、完整 `npm test` 455 tests、`npm run build`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0400-source-audit-command-boundary.md`。
  - 本地提交：已通过 `git commit --amend --no-edit` 合并到前序 rebuild feature commit。
- 下一个阶段计划：
  - 建立 command public facade / command ports，继续减少 `bridge-manager.ts` 和 `command/*` 对彼此内部文件的读取。

### 2026-05-30 04:03 阶段：command public facade / ports

> 阶段描述：新增 command application public facade，让 bridge runtime 只依赖 command 对外入口，而不是读取 command 内部目录。本阶段先收窄 runtime -> command 的入口，不重写 command handler 的业务依赖。

- 行动条目：
  - 新增 `src/lib/bridge/command.ts` 作为 command application public facade，导出 command text 判断、alias 解析、prompt escape、dispatch 和 global status response。
  - `bridge-manager.ts` 改为只从 `./command.js` 读取 command public API，不再直接 import `command/aliases.ts`、`command/dispatch.ts`、`command/status.ts`。
  - `bridge-adapter-runtime.ts` 改为从 `./command.js` 读取 `isBridgeCommandText`。
  - `command-dispatch.test.ts` 的 dispatch 入口改为 public facade；保留 command 内部 presentation/alias 单元测试直接 import 内部模块。
  - `work/rebuild/source-audit.mjs` 已把 `src/lib/bridge/command.ts` 标记为 Command Application public facade，允许 bridge runtime 依赖它，但仍把直接依赖 `src/lib/bridge/command/*` 视为风险。
- 阶段验证和git提交（如通过）：
  - 验证通过：`npm run typecheck`；聚焦测试 `command-dispatch.test.ts`、`bridge-manager.test.ts`、`bridge-adapter-runtime.test.ts` 90 tests 全部通过。
  - 审计结果：`Bridge Host / Runtime Contracts` 风险跨聚合 import 从 39 降到 34；`bridge-manager.ts` 风险跨聚合 import 从 16 降到 13；`bridge-adapter-runtime.ts` 不再有风险跨聚合 import。
  - 本地提交：待本阶段后续 ports 收口完成后 amend 到前序 rebuild feature commit。
- 下一个阶段计划：
  - 继续设计 command ports，减少 command handler 对 registry/display/tmux/runtime helper 的直接读取。
  - 复跑审计脚本，以风险跨聚合 import 数量和具体文件清单判断是否真正收窄边界。

### 2026-05-30 04:14 阶段：STATUS 格式整理

> 阶段描述：按照当时仓库协作准则整理 `work/rebuild/STATUS.md`，把散落行动日志整理为任务目标、当前规划、任务上下文、任务日志四个 h2。

- 行动条目：
  - 读取当前 git 状态，确认工作树已有多项生产代码变更和 `work/rebuild/STATUS.md` 修改；本阶段只处理 `work/rebuild` 状态文件。
  - 读取整理前的 `work/rebuild/STATUS.md`，确认存在重复 `## 任务上下文`、重复 `## 行动日志`、未按 h3/h4 分层的行动流水。
  - 将整理前原始状态文件复制归档为 `work/rebuild/STATUS-20260530-0414-status-format-normalization.md`。
  - 重写主 `STATUS.md` 为四个 h2 主区块，并把历史流水压缩成阶段化日志。
- 阶段验证和git提交（如通过）：
  - 验证通过：`grep -n '^## ' work/rebuild/STATUS.md` 仅返回当时要求的四个 h2。
  - 验证通过：旧的重复 h2 标题扫描无输出。
  - 本地提交：已提交 `Normalize rebuild status format`；本阶段 follow-up 按新格式迁移时应 amend 到该提交。
- 下一个阶段计划：
  - 根据新版 `AGENTS.md` 再次迁移为三 h2 格式。

### 2026-05-30 04:19 阶段：重新派发本地 bridge hot update

> 阶段描述：用户反馈上一轮 `bash scripts/hot-update-bridge.sh` 没有实际派发出去，要求重新执行 hot update。

- 行动条目：
  - 检查上次 hot update 日志 `/tmp/codex-to-im-logs/hot-update-20260530-041757.log`，读取无输出。
  - 从项目根目录运行 `bash scripts/hot-update-bridge.sh`。
  - 本阶段未执行 pull，未跳过测试，未前台停止 bridge。
- 阶段验证和git提交（如通过）：
  - 脚本返回：`Dispatched Codex-to-IM hot update.`，PID `342538`。
  - Hot update log：`/home/hongli.fish/.codex-to-im/logs/hot-update-20260530-041913.log`。
  - Bridge log：`/home/hongli.fish/.codex-to-im/logs/bridge.log`。
  - Pull requested：`no`；Tests skipped：`no`。
  - 后续日志确认：`npm test` 455 tests 全部通过；restart command 完成；`npm run build` 通过；bridge restarted，PID `345574`；hot update completed at `2026-05-30T04:19:48+08:00`。
  - 本阶段没有提交；它是用户明确要求的本地部署操作，关键事实已写入本文件。
- 下一个阶段计划：
  - 回到 `STATUS.md` 新格式迁移，再继续 command public facade / ports 阶段。

### 2026-05-30 04:22 阶段：STATUS 新格式迁移

> 阶段描述：用户更新 `AGENTS.md` 后，按新要求把 `work/rebuild/STATUS.md` 从四 h2 格式迁移到三 h2 格式，并调整阶段日志内部结构。

- 行动条目：
  - 读取新版 `AGENTS.md`，确认状态文件必须包含 `## 任务目标`、`## 任务上下文`、`## 任务日志`，不再要求单独 `## 当前规划`。
  - 确认阶段条目格式调整为 h3 时间戳阶段、`> 阶段描述：...`、行动条目列表、阶段验证和 git 提交列表、下一个阶段计划列表。
  - 归档迁移前主文件为 `work/rebuild/STATUS-20260530-0422-status-format-v2.md`。
  - 重写主 `STATUS.md`，把当前规划内容合并到 `任务上下文 / 当前阶段计划` 和各阶段的“下一个阶段计划”。
- 阶段验证和git提交（如通过）：
  - 验证通过：`grep -n '^## ' work/rebuild/STATUS.md` 只返回 `## 任务目标`、`## 任务上下文`、`## 任务日志`。
  - 验证通过：`grep -nE '^## 当前规划|^#### ' work/rebuild/STATUS.md || true` 无输出。
  - 验证通过：`git diff --check -- work/rebuild/STATUS.md work/rebuild/STATUS-20260530-0422-status-format-v2.md` 无输出。
  - 验证记录：`wc -l` 显示主文件 211 行，本阶段归档 229 行。
  - 本地提交：本阶段通过 `git commit --amend --no-edit` 合并到 `Normalize rebuild status format`，仅纳入 `work/rebuild/STATUS.md` 与本阶段归档文件。
- 下一个阶段计划：
  - 验证并 amend 后，回复用户已按新版 `AGENTS.md` 更新完成。

### 2026-05-30 04:30 阶段：全文件自然聚类审计

> 阶段描述：在已有全源文件审计基础上，升级审计产物为全文件依赖图和自然聚类候选，用全局模块形态重新判断下一阶段边界；command 只作为被审计对象之一。

- 行动条目：
  - 本阶段根据用户 04:31 纠偏，暂停 command 局部 port 化，改为升级全文件审计产物；`source-audit.mjs` 现在生成生产文件自然聚类、测试覆盖映射、聚合构成、混合簇判定和边界判断。当前审计覆盖 177 个 `src/**/*.ts` 文件、711 条本地 import / re-export 边、10 个自然聚类候选；`cluster-01` 和 `cluster-02` 被明确标记为混合簇，`cluster-03` 仅作为 Command Application 高耦合簇记录。
- 阶段验证和git提交（如通过）：
  - 2026-05-30 04:35 当前进入阶段审计：确认产物覆盖全部 `src/**/*.ts`，聚类结果没有被误写成目标模块，并能支持下一阶段选择。
  - 已通过：`git diff --check -- work/rebuild/source-audit.mjs work/rebuild/source-file-audit.json work/rebuild/source-file-audit.md work/rebuild/STATUS.md`。
  - 已通过：`npm run typecheck`。
  - 已通过：聚焦测试 `node --test --import tsx src/__tests__/command-dispatch.test.ts src/__tests__/bridge-manager.test.ts src/__tests__/bridge-adapter-runtime.test.ts`，90 tests 全部通过。
  - 阶段归档：`work/rebuild/STATUS-20260530-0435-natural-clustering-audit.md`。
  - 本地提交：`Add natural source clustering audit`。
- 下一个阶段计划：
  - 审计 `cluster-01` 和 `cluster-02` 的混合原因，优先选择能拆出自然边界的下一阶段，而不是继续按 command 风险榜做局部 port 化。

### 2026-05-30 04:38 阶段：混合簇边界审计

> 阶段描述：基于自然聚类结果审计 `cluster-01` 与 `cluster-02` 的混合原因，定位具体跨职责依赖边和缺失端口，形成下一刀自然边界方案。

- 行动条目：
  - 本阶段从 `cluster-01` / `cluster-02` 的跨职责边入手，扩展 `source-audit.mjs`，在 `source-file-audit.json` / `.md` 中生成“混合簇边界审计”，并新增 `mixed-cluster-boundary-audit.md` 记录 root cause 和下一刀建议。结论：`cluster-01` 需要先分清 shared contracts / delivery / runtime host；下一阶段优先做 `cluster-02` 的 UI server 收缩。
- 阶段验证和git提交（如通过）：
  - 2026-05-30 04:42 当前进入阶段审计：确认本阶段产物是混合簇边界审计和下一刀方案，没有改生产代码；审计重点是产物是否可复跑、是否覆盖 `cluster-01` / `cluster-02` 的跨职责边、是否避免把混合簇误认为目标模块。
  - 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && node source-audit.mjs`。
  - 已通过：`grep -n '^## ' STATUS.md && grep -nE '^## 当前规划|^#### ' STATUS.md || true`，h2 只包含 `任务目标`、`任务上下文`、`任务日志`，旧标题扫描无输出。
  - 已通过：`git diff --check -- STATUS.md source-audit.mjs source-file-audit.json source-file-audit.md mixed-cluster-boundary-audit.md`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0442-mixed-cluster-boundary.md`。
  - 本地提交：`Audit mixed source clusters`。
- 下一个阶段计划：
  - 验证审计产物后归档本阶段；下一阶段优先进入 `cluster-02` 的 UI server 收缩，而不是继续 command 风险榜或直接搬动 cluster-01 shared contracts。

### 2026-05-30 04:43 阶段：UI server 收缩

> 阶段描述：基于 `cluster-02` 审计结论，把 `ui-server.ts` 中的一个明确 UI workflow 迁出到 UI application/route 模块，降低 Local UI / Config / Service / Store 混合簇的耦合。

- 行动条目：
  - 根据上一阶段 `mixed-cluster-boundary-audit.md`，本阶段进入 `cluster-02` 的 UI server 收缩。当前工作树只有 `AGENTS.md` 未提交，继续保留为用户侧协作规范改动；审计 `ui-server.ts` 的 route/function 结构后，选择先迁出服务控制 workflow：`/api/status`、`/api/install-codex-integration`、`/api/bridge/start`、`/api/bridge/stop`、`/api/bridge/restart`、`/api/logs`。新增 `src/ui-service-routes.ts` 承接这组 route，`ui-server.ts` 只传入 UI access 和 Weixin accounts 的页面上下文；新增 `src/__tests__/ui-service-routes.test.ts` 覆盖 `/api/logs` 和非本模块 route pass-through。
- 阶段验证和git提交（如通过）：
  - 2026-05-30 04:49 当前进入阶段审计：确认本阶段只迁出 UI service route workflow，没有处理 config/channel/Weixin 深层 workflow；审计重点是路由行为保持、`ui-server.ts` 职责收缩、审计产物已复跑。
  - 已通过：`npm run typecheck`。
  - 已通过：`node --test --import tsx src/__tests__/ui-service-routes.test.ts src/__tests__/service-manager.test.ts`，19 tests 全部通过。
  - 已通过：`npm run build`。
  - 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && node source-audit.mjs`。
  - 已通过：`git diff --check -- src/ui-server.ts src/ui-service-routes.ts src/__tests__/ui-service-routes.test.ts work/rebuild/STATUS.md work/rebuild/source-file-audit.json work/rebuild/source-file-audit.md`。
  - 审计记录：当前 `src/**/*.ts` 文件 179 个（生产 121，测试 58），本地 import / re-export 边 715 条；`ui-server.ts` 为 4313 行，`ui-service-routes.ts` 为 83 行。
  - 阶段归档：`work/rebuild/STATUS-20260530-0449-ui-service-routes.md`。
  - 本地提交：`Extract UI service routes`。
- 下一个阶段计划：
  - 后续继续从 `ui-server.ts` 迁出 config/channel/Weixin workflow，或回到 `cluster-01` 处理 shared contracts / delivery / runtime host 分类。

### 2026-05-30 04:51 阶段：UI config/channel workflow 收缩

> 阶段描述：延续 `cluster-02` UI server 收缩，把 `ui-server.ts` 中的 config/channel/Weixin 相关 workflow 再迁出一个清晰切片，继续降低 Local UI / Config / Service / Store 混合簇耦合。

- 行动条目：
  - 本阶段从 `ui-server.ts` 迁出 `/api/config` workflow：新增 `src/ui-config-routes.ts` 和 `src/ui/application/config.ts` 承接 config read/write、payload 转换、默认模型校验、LAN access token 生成；`ui-server.ts` 继续保留 channel save/delete/test 与 Weixin login，避免一次迁出多个复杂 workflow。用户 04:54 纠偏后，审计脚本升级为函数级内聚/外聚模型；用户 05:02 纠偏后，函数级审计改为 TypeScript compiler AST 解析 import/export、命名函数、函数表达式、箭头函数、class method、函数体本地调用和 import 符号使用。AST 产物覆盖 182 个源文件、712 条本地 import / re-export 边、1526 个函数节点、1743 条函数依赖边，其中内聚 1485、外聚 258；原始流水和扫描输出摘要已归档到 `work/rebuild/STATUS-20260530-0513-ui-config-ast-function-audit.md`。
- 阶段验证和git提交（如通过）：
  - 2026-05-30 05:13 当前进入阶段审计：确认本阶段一方面只迁出 `/api/config` workflow，未继续迁出 channel save/delete/test 或 Weixin login；另一方面按用户 04:54 和 05:02 纠偏把审计模型升级为 AST 函数级内聚/外聚依赖，不再只看文件级度数或 regex/string scanning。
  - 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && node source-audit.mjs`。
  - 已通过：`npm run typecheck`。
  - 已通过：`node --test --import tsx src/__tests__/ui-config-routes.test.ts src/__tests__/ui-service-routes.test.ts`，6 tests 全部通过。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，461 tests 全部通过。
  - 已通过：`git diff --check -- src/ui-server.ts src/ui-config-routes.ts src/ui/application/config.ts src/__tests__/ui-config-routes.test.ts work/rebuild/STATUS.md work/rebuild/source-audit.mjs work/rebuild/source-file-audit.json work/rebuild/source-file-audit.md`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0513-ui-config-ast-function-audit.md`。
  - 本地提交：`Extract UI config routes and AST audit`。
- 下一个阶段计划：
  - 下一阶段基于 AST 外聚热点和自然聚类共同选择继续收缩 `cluster-02` channel/Weixin workflow，还是转向 `cluster-01` 的 mirror / turn / delivery 边界。
