# Codex-to-IM Rebuild Status

## 任务目标

本文件是本轮 rebuild 任务的主入口。它记录当前架构理解、严格扫描结论、重构目标形态和后续执行计划。

目标不是按文件大小机械拆分，也不是把现有代码搬到更多小文件里。目标是把当前代码整理成自然聚合物：

- 大模块胖而紧凑，拥有清晰业务边界和内部协作；
- 小模块只在同一大模块内服务明确职责，不把共享概念拆碎；
- 模块之间通过窄接口连接，避免跨层直接读取对方内部状态；
- 术语无歧义，字段名和模型名表达真实业务含义；
- 不合适的设计要先标记为待迁移目标，不能在新架构文档里合理化；
- 
用户后续纠偏：
最终目标不是只整理 command 模块。command 的重构思路可以作为样板：先按文件级依赖和职责审计，再重划聚合边界，最后小步重构。但同样的方法必须覆盖当前每一个源文件。
- 不能把 command 模块机械拆分当成完成；必须先按文件级依赖、导入对象、实际职责和高内聚/低耦合目标审计。
- command 的重构思路只是样板；同样方法必须覆盖当前每一个 `src/**/*.ts` 源文件。
- 关键认识、计划、扫描事实、修改和验证必须立即落盘到本文件；阶段完成后做阶段审计、归档原始素材，并用本地 commit/amend 收口。

## 当前规划

1. 已完成：建立全源文件审计脚本和机器可复核产物。
2. 已完成：bridge runtime / command presentation 反向依赖第一刀。
3. 已完成：本阶段改动已 amend 到当前 feature commit。
4. 下一阶段：建立 command public facade / command ports，继续减少 `bridge-manager.ts` 和 `command/*` 对彼此内部文件的读取。
5. 未完成：全量 rebuild 目标尚未达成；不能把本次审计产物视为终点。

## 任务上下文

- 当前工作目录：`/data00/home/hongli.fish/Codex/codex-to-im`
- 当前日期：2026-05-30
- 当前架构入口：`docs/current-architecture.md`
- 历史分析入口：`work/analysis/STATUS.md`
- 本轮 rebuild 入口：`work/rebuild/STATUS.md`
- 全源文件审计产物：`work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md`
- 审计脚本：`work/rebuild/source-audit.mjs`
- 当前 feature commit：当前 `HEAD`，提交主题 `Add session display and registry rebuild slice`


## 行动日志

2026-05-30 03:51 已生成全源文件审计基线：

- 产物：`work/rebuild/source-file-audit.json`、`work/rebuild/source-file-audit.md`。
- 脚本：`work/rebuild/source-audit.mjs`。
- 范围：174 个 `src/**/*.ts` 文件，其中生产文件 117 个、测试文件 57 个。
- 本地 import / re-export 边：702 条。
- 最大聚合：`Bridge Host / Runtime Contracts` 24 文件 / 6804 行 / 42 条风险跨聚合 import；`Local UI and Service Management` 5 文件 / 6035 行 / 8 条风险跨聚合 import；`Command Application` 11 文件 / 4198 行 / 50 条风险跨聚合 import。
- 最大文件：`src/ui-server.ts` 4357 行、`src/lib/bridge/adapters/feishu-adapter.ts` 2882 行、`src/lib/bridge/bridge-manager.ts` 1316 行、`src/lib/bridge/interactive-message-runner.ts` 1056 行。
- 第一批风险文件：`bridge-manager.ts`、`command/diagnostics.ts`、`command/dispatch.ts`、`command/session-thread.ts`、`interactive-message-runner.ts`、`mirror-feedback-controller.ts`、`ui-server.ts`、`command/runtime-settings.ts`、`command/tmux.ts`、`command/presentation.ts`、`thread-display-resolver.ts`。
- 结论：当前最大结构性问题不再是缺少文件清单，而是 `Bridge Host / Runtime Contracts` 作为 catch-all 聚合继续直接读取 command、mirror、turns、adapter、health 内部；下一阶段必须先收敛 bridge runtime 与 command/delivery/display 的边界。

2026-05-30 03:59 已完成 bridge runtime / command presentation 反向依赖第一刀：

- 新增 `src/lib/bridge/command/thread-display.ts`，把 `/t` 命令专用的绑定列表响应、Codex thread rich card、绑定 rich card、绑定状态 DTO 从通用 `ThreadDisplayService` 中移到 command 聚合。
- `src/lib/bridge/thread-display-resolver.ts` 从 321 行收缩到 226 行，不再 import `command/presentation.ts`；现在只保留 title/source/display query、binding selection 和 Codex thread selection。
- `src/lib/bridge/thread-table-message-pins.ts` 移到 `src/lib/bridge/command/thread-table-message-pins.ts`，因为它只服务 `/t` command card pin/update。
- `src/lib/bridge/command-callbacks.ts` 扩展为 command callback 协议层，承接 thread card callback prefix / update key / action callback builder；`bridge-manager.ts` 不再为 callback 常量 import command presentation。
- 新增 `src/lib/bridge/command-errors.ts`，承接 command user-visible error 文案；`bridge-manager.ts` 不再为错误文案 import command presentation。
- `bridge-manager.test.ts` 不再通过 `_testOnly` 间接测试 command presentation / aliases helper，而是直接 import 被测 helper，减少 bridge manager 的 test-only re-export。
- 最新审计产物已复跑：当前 176 个 `src/**/*.ts` 文件、711 条本地 import / re-export 边；`Bridge Host / Runtime Contracts` 风险跨聚合 import 从审计基线 42 降到 39，`bridge-manager.ts` 的风险跨聚合 import 从 17 降到 16。
- 解释：`Command Application` 风险计数暂时仍高，是因为 command handler 继续直接 import router/registry/display/tmux/runtime helper；这正是下一阶段要用 command ports 解决的问题。
- 完整验证：`npm run typecheck`、聚焦 96 tests、完整 `npm test` 455 tests、`npm run build` 均通过。
- 阶段归档：原始动作、事实和验证摘要已归档到 `work/rebuild/STATUS-20260530-0400-source-audit-command-boundary.md`。
- 本地提交：本阶段已通过 `git commit --amend --no-edit` 合并到当前 feature commit。

2026-05-30 04:03 进入 command public facade / ports 阶段：

- 当前事实：`bridge-manager.ts` 仍直接 import `command/aliases.ts`、`command/dispatch.ts`、`command/status.ts`；`bridge-adapter-runtime.ts` 仍直接 import `command/aliases.ts`。
- 阶段目标：新增 command public facade，让 bridge runtime 只依赖 command 对外入口，而不是读取 command 内部目录。
- 本阶段先不重写 command handler 的业务依赖；先把 runtime -> command 的入口收窄，再复跑审计判断风险边是否减少。

2026-05-30 04:05 command public facade 第一刀完成：

- 新增 `src/lib/bridge/command.ts` 作为 command application public facade，导出 command text 判断、alias 解析、prompt escape、dispatch 和 global status response。
- `bridge-manager.ts` 改为只从 `./command.js` 读取 command public API，不再直接 import `command/aliases.ts`、`command/dispatch.ts`、`command/status.ts`。
- `bridge-adapter-runtime.ts` 改为从 `./command.js` 读取 `isBridgeCommandText`。
- `command-dispatch.test.ts` 的 dispatch 入口改为 public facade；保留 command 内部 presentation/alias 单元测试直接 import 内部模块。
- `work/rebuild/source-audit.mjs` 已把 `src/lib/bridge/command.ts` 标记为 Command Application public facade，允许 bridge runtime 依赖它，但仍把直接依赖 `src/lib/bridge/command/*` 视为风险。
- 审计结果：`Bridge Host / Runtime Contracts` 风险跨聚合 import 从 39 降到 34；`bridge-manager.ts` 风险跨聚合 import 从 16 降到 13；`bridge-adapter-runtime.ts` 不再有风险跨聚合 import。
- 验证：`npm run typecheck` 通过；聚焦测试 `command-dispatch.test.ts`、`bridge-manager.test.ts`、`bridge-adapter-runtime.test.ts` 90 tests 全部通过。

## 任务上下文
### 模块形态

大模块应该是业务聚合边界，不是目录标签。一个大模块可以很胖，但必须紧凑：

- 内部文件共享同一套领域词汇和不变量；
- 内部调用可以具体，外部接口必须窄；
- 外部不能为了方便 import 内部 helper；
- 模块名字必须说明它拥有的业务能力，而不是技术实现细节。

小模块只服务以下目的：

- 分离不可共享的基础设施实现；
- 封装同一大模块内的复杂算法；
- 隔离平台 API、文件格式、协议格式；
- 提供可测的纯规则。

不接受的拆分：

- 因为文件长就拆；
- 把同一个 invariant 拆到多个模块；
- 为了复用几行代码制造公共 util；
- 让 UI、command、adapter 各自复制 session/thread/display 规则。

### 术语

必须收敛的 canonical 术语：

- `BridgeSession`：Codex-to-IM 自己拥有的本地会话。
- `codex_thread_id`：底层 Codex thread identity，只存在于 BridgeSession。
- `ChannelBinding`：IM chat 到 BridgeSession 的绑定。
- `IMChannel` / channel instance：Feishu/Weixin 等入口实例。
- Local Codex session index：读取 `~/.codex/sessions` 的本地 Codex 会话索引。
- Execution provider：`sdk` / `tmux` 等执行路径。
- CodexSource：Codex 本地 session 事实来源，包含 JSONL / SQLite 里的 `originator`、`source`、`cliVersion` 等原始字段；`cli`、`exec`、`vscode` 都是 Codex source 值，不叫 provenance。
- Creator：业务展示上的创建/来源类别，用来区分 `Bridge`、`SDK`、`VS Code`、`TUI / CLI`、`Native` 等 UI/IM badge；它不等同于 CodexSource。
- Desktop：严重错误的历史术语。除非 CodexSource 明确表明该 JSONL/session 来自桌面端 Codex，否则业务、代码、UI、测试都不应使用 Desktop 泛指 Codex session、Codex thread、mirror、history 或 Native 会话。默认使用 Codex / Native。
- Codex：不作为 canonical 术语。没有 Remote Codex 对立概念；读取 `~/.codex/sessions` 的索引就叫 Codex session index，记录叫 CodexSession，镜像记录叫 CodexMirrorRecord。

必须降级或迁移的术语：

- `targetKey`：retired legacy UI/API selector，不是领域概念。当前 runtime/UI/API/store contract 已迁移到 `BridgeSession.id` / `codexThreadId`；startup storage migration 不再升级旧 selector，`channel-default-targets` v2 只接受 `bridgeSessionId`。
- `desktop:<threadId>`：retired legacy selector，只表示历史上从 local Codex session index 选中的 thread；新代码、UI/API 和 tests 不应继续生成或消费。
- `codepilotSessionId`：历史字段名，语义应是 `bridgeSessionId`。
- `desktop-sessions.ts` / `Desktop*` / `Codex*` symbols：历史或过度命名，语义应迁移为 Codex / Native；只有 Creator 明确为桌面端时才保留 `desktop` creator 值或 Desktop badge。
- `source`：重载严重，必须拆成 execution provider、CodexSource、Creator、channel provider；不再使用 provenance / display source 作为 canonical 术语。

## 当前严格扫描结论

### 1. Identity / Display 规则仍然散落（原始基线，已部分收敛）

证据：

- 原始基线：`src/ui-server.ts` 自己生成 `session:<id>` / `desktop:<threadId>`，并直接判断 source/originator badge。
- 当前状态：UI session identity 已迁移为 `sessionRef` + `bridgeSessionId` / `codexThreadId`；Creator badge 已由 `SessionDisplayQuery` DTO 提供。
- 原始基线：`src/session-bindings.ts` 自己解析 legacy selector，并同时做 binding invariant、display label、channel metadata、local Codex lookup。
- 当前状态：legacy selector parser 已从 runtime facade 中删除；`session-bindings.ts` 仍承担 binding invariant 和 BridgeSession materialize 规则，后续要继续收窄。
- `src/lib/bridge/thread-display-resolver.ts` 服务 `/t` 和 command 层，但还不是全局 display query model。
- `src/lib/bridge/command-formatters.ts` 仍有 session display helper 和 legacy Desktop prefix 清理。

结论：

- 这是第一优先级。不要先拆 command 或 UI 大文件；先建立共享 Session Identity / Display Query 模块。（已执行）
- 该模块不能把 `targetKey` 合理化为领域模型；当前已删除 runtime 过渡解析，startup migration 也不再消费旧 selector。

### 2. Session / Binding Registry 是大模块，不是 util

证据：

- `src/session-bindings.ts` 维护 one-session/one-thread binding uniqueness。
- `src/lib/bridge/channel-router.ts` 在无 binding 时自动创建 draft 或应用 channel default target。
- `src/store.ts` 提供 sessions、bindings、default targets、messages、permissions、audit 等持久化。
- `storage-migrations.ts` 强制旧 thread fields 迁移到 `BridgeSession.codex_thread_id`。

结论：

- Registry 应拥有 session/binding/default target 的 mutation use cases。
- Registry 不应直接 import config 或 local Codex scanner；这些应通过 ports/query services 注入。
- `codepilotSessionId` 字段名要进入重命名计划，但行为不应在第一步改。

### 3. Local Codex Session Index 是独立基础设施大模块

证据：

- `src/desktop-sessions.ts` 约 2026 行，入边高，出边低，已经是基础设施枢纽。
- 它同时负责 JSONL discovery、state sqlite compatibility、archive/visibility、title fallback、history parsing、mirror records。
- UI、commands、mirror、tmux/finalization 都依赖它的结果。

结论：

- 这个大模块应保留为胖模块，但内部拆成紧凑子模块。
- 对外只暴露 list/get/read history/read mirror delta/archive/import metadata 等窄接口。
- 文件和 public type 应逐步从 Desktop 命名迁移到 CodexSession 命名。

### 4. Interactive Turn Runtime 和 Mirror Runtime 应保持分离

证据：

- interactive path 消费 provider SSE，并处理 active task、stream feedback、final response。
- mirror path 消费 Codex JSONL 增量，并处理 suppression、turn buffering、mirror feedback。
- 两者共享 session/thread identity、display summary、delivery capability，但生命周期不同。

结论：

- 两者是两个用例大模块，不能因为都发 streaming card 就合并。
- 可共享的是 display query、delivery contracts、stream feedback primitives。
- 不可共享的是 turn state machine、cursor/suppression、provider SSE parsing。

### 5. Command Layer 是 use-case switchboard

证据：

- `src/lib/bridge/command-dispatch.ts` 约 2022 行，混合 `/t`、`/new`、runtime settings、history、tmux、stop、permissions、help。
- `command-formatters.ts` 同时包含 help/card/table/history/runtime status 等展示逻辑。
- `/t` command 同时依赖 display、registry、local Codex index、rich card callbacks。

结论：

- command 不应每个命令一个小文件随意拆。
- 应按用户故事族拆成胖而紧凑的 command module：
  - session/thread commands；
  - runtime settings commands；
  - diagnostics/history/file commands；
  - tmux remote-control commands；
  - permission/stop commands。
- command execution 和 command rendering 要分离。

### 6. Channel Delivery / Adapter 需要分清可共享和不可共享

证据：

- Feishu adapter 约 2882 行，混合 REST client、stream card state、resource download、callbacks、rich command cards。
- Weixin adapter 有不同登录、消息、文本反馈约束。
- delivery-layer / feedback-delivery 已经是部分共享层。

结论：

- 可共享：delivery contract、chunk/retry/dedup/audit、rich card IR、stream feedback contract、attachment contract。
- 不可共享：Feishu CardKit API、Weixin login/protocol、platform resource download、platform callback payload parsing。
- Feishu adapter 应内部拆成 API client、streaming cards、rich command cards、resource download、adapter loop，但仍属于 Feishu 大模块。

### 7. Local UI 是 operator workflow，不是 domain owner

证据：

- `src/ui-server.ts` 约 4899 行，直接重建 sessions payload、history、config, binding assignment, source badges, front-end HTML/JS。
- 原始基线：UI API 直接接受 legacy `targetKey`。
- 当前状态：UI mutating/history endpoints 已迁移到 `bridgeSessionId` / `codexThreadId` payload，前端 hash/state 使用 `sessionRef`。
- UI 仍包含较多 route/front-end shell 和 workflow orchestration；后续收缩重点是 route 模块化和静态 UI shell 拆分。

结论：

- UI server 应收缩成 composition root + route declarations + static UI shell。
- UI route 不应复制 Creator/CodexSource/session import rules。
- UI mutating APIs 应从 `targetKey` 迁移到 `bridgeSessionId`，并通过 explicit import endpoint 处理 local Codex thread。

### Phase 7: 命名迁移

目标：术语无歧义。

任务：

- `codepilotSessionId` -> internal `bridgeSessionId` view；
- `desktop-sessions.ts` public docs/types -> local Codex session；
- `source` 拆为 execution provider、CodexSource、Creator；
- docs/schema migration 说明保留旧字段但不再作为业务术语。

当前进展：

- 已新增 `src/codex-session-index.ts` 作为 Local Codex session index 的对外 facade，继续复用 `desktop-sessions.ts` 内部实现。
- 应用层、runtime 层和 UI server 已改为通过 local Codex facade 读取 session root、session list/get/archive、history、mirror/event delta 和消息转换；`desktop-sessions.ts` 现在只作为实现模块和专门测试目标被直接 import。
- Mirror/runtime 的公共类型 import 已从 `DesktopMirrorRecord` / `DesktopSessionSummary` 收敛为 `CodexMirrorRecord` / `CodexSessionSummary`。命令名、UI DOM 状态、`desktop:<threadId>` legacy selector 和用户可见“桌面线程”文案暂不在本阶段强行重命名。
- 已验证 direct import 扫描：除 `src/codex-session-index.ts` facade 和 `src/__tests__/desktop-sessions.test.ts` 外，应用/runtime 代码不再直接 import `desktop-sessions.js`。
- 已从 `desktop-sessions.ts` 内部拆出 Local Codex 基础设施子模块：
  - `src/codex-session-index/paths.ts`
  - `src/codex-session-index/archive-store.ts`
  - `src/codex-session-index/sqlite-visibility.ts`
  - `src/codex-session-index/file-readers.ts`
  - `src/codex-session-index/workspace-filter.ts`
  - `src/codex-session-index/discovery-scanner.ts`
- 已从 `desktop-sessions.ts` 内部拆出 JSONL history parser 支撑模块：
  - `src/codex-session-index/jsonl-types.ts`
  - `src/codex-session-index/history-parser.ts`
- 已从 `desktop-sessions.ts` 内部拆出 event/mirror parser：
  - `src/codex-session-index/event-mirror-parser.ts`
- 当前拆分已移动路径、归档、SQLite visibility、文件读取、workspace 过滤、JSONL 发现、history parser 类型/辅助规则、history parser、event parser 和 mirror parser；`desktop-sessions.ts` 现在主要保留 public API wrapper、session metadata/listing orchestration 和 file IO wrapper。


## 行动日志




- 关键 takeaway（2026-05-30 03:36）：最终目标升级为“审计当前每一个源文件 -> 重新划分模块 -> 分阶段重构”。command 重构思路只是方法样板，不能作为完成证明。
- 红线原则已写入 `AGENTS.md`，并且 `AGENTS.md` 已翻译为全中文（保留必要英文术语）。后续必须遵守动作落盘、动作成阶段、阶段要审计。
- `AGENTS.md` 中的 STATUS 内容要求已补充“原始指令”：任务开始目标和用户追加的所有后续指令不能改变，避免长期任务中收缩或改写目标。
- 本阶段同时收尾了 Phase 7 术语清理的一项：`ChannelBinding` 内部字段 `codepilotSessionId` 已迁移为 `bridgeSessionId`；startup migration 仍读取旧字段并写出新字段；bindings schema 升级到 v2。
- 验证（2026-05-30 03:36）：`npm run typecheck` 通过；聚焦迁移/schema/store/registry/router 测试 50 tests 通过；`npm test && npm run build` 通过，455 tests 全部通过，build 生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- 阶段审计：本阶段原始素材已归档到 `work/rebuild/STATUS-20260530-0336-final-instructions-binding-id.md`。
- 下一步：提交/合并本阶段改动后，进入“全源文件审计”阶段，先生成机器可复核的源文件清单、import/export 图、入边/出边和职责审计表。


当前用户明确指出：不能继续按“把大文件切成多个 command 文件”这种局部机械拆分推进；必须先逐个文件检查 import、导入对象和实际功能，参考 `work/rebuild` 已写下的高内聚/低耦合目标，判断现有切片是否真的应该存在、是否应合并或重新排列。

立即执行约束：

- 暂停继续修改生产代码；当前未提交代码只作为待审计现状，不再继续扩展。
- 先更新本文件，再做文件级 import / responsibility 审计。
- 审计重点包括 `src/lib/bridge/commands/*`、`tmux-command.ts`、`health` / formatter 相关模块、`command-dispatch.ts`、以及刚抽出的 UI route 模块。
- 审计必须列出文件之间的引用关系，特别关注 `from '../'` / `from '../../'` 这类跨模块反向引用和 command 子模块直接拿太多外部 service 的情况。
- 目标不是让文件数量更多，而是重新设计目录和模块边界，使跨模块引用最少，业务聚合更紧凑。

待写入结论：

- 当前 command 系列还有多少职责没有真正合并进合理聚合物；
- `tmux-command.ts` 与 command application 的关系是否应内聚为 command 子域，而不是旁挂在 bridge 根目录；
- health formatter / diagnostics / command renderer 是否是同一展示子域，是否应合并；
- UI route 切片是否只是把 `ui-server.ts` 的 helper 搬出去，还是形成了真正的 route/application 边界；
- 下一步必须先基于 import graph 设计重排方案，再决定是否改代码。

#### 纠偏执行：presentation 反向依赖第一刀

- 读取 `command-formatters.ts`、`session-display-query.ts`、`thread-display-resolver.ts`、`session-bindings.ts`、`ui-session-routes.ts` 中对 `stripLegacySessionPrefix` / `getSessionDisplayName` 的使用。
- 新增 `src/lib/bridge/display/session-title.ts`，把 session title 清理和 fallback display name 规则移出 command presentation。
- 修改 `session-display-query.ts`、`thread-display-resolver.ts`、`session-bindings.ts`、`ui-session-routes.ts`，让 display/query/UI/binding 层直接依赖 display title 规则，不再为了 title helper import `command-formatters.ts`。
- `command-formatters.ts` 暂时 re-export `getSessionDisplayName` / `stripLegacySessionPrefix` 以保持 command 侧兼容；后续删除 `command-helpers` barrel 时再让 command handler 显式 import。
- 验证：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm run typecheck` 通过。
- 最新理解：presentation 反向依赖可以先通过抽 display/shared title rule 收口，不需要继续扩大 command 文件数量；下一刀应继续把 `command-helpers.ts` barrel 拆掉，让 `health-formatters` 和 command presentation 真实依赖显性化。

#### 纠偏执行：删除 command-helpers barrel

- 读取所有 `command-helpers` import，确认它只是 `command-aliases`、`command-formatters`、`health-formatters` 的 `export *` 聚合，隐藏真实依赖。
- 修改 `bridge-channel-runtime.ts`、`bridge-manager.ts`、`command-dispatch.ts`、`commands/control-command.ts`、`commands/diagnostics-command.ts`、`commands/help-command.ts`、`commands/runtime-settings-command.ts`、`commands/session-thread-command.ts`、`commands/status-command.ts`，改为直接 import `command-aliases`、`command-formatters`、`health-formatters` 或 `display/session-title`。
- 删除 `src/lib/bridge/command-helpers.ts`。
- 验证：`grep -R "command-helpers" -n src lib docs README.md README_EN.md` 无输出；`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm run typecheck` 通过。
- 最新理解：依赖图已经从“helpers barrel 隐藏耦合”变成显性耦合；下一步应按新图重排 command 聚合目录，并把 `health-formatters` 并入 diagnostics presentation，把 `tmux-command.ts` 从 bridge 根目录移走或拆成 tmux runtime + command handler。

#### 纠偏执行：command 聚合目录收口

- 把机械切片和旧 bridge 根目录 command 文件收口到 `src/lib/bridge/command/`：
  - `command-dispatch.ts` -> `command/dispatch.ts`
  - `command-aliases.ts` -> `command/aliases.ts`
  - `command-formatters.ts` -> `command/presentation.ts`
  - `health-formatters.ts` -> `command/diagnostics-presentation.ts`
  - `commands/session-thread-command.ts` -> `command/session-thread.ts`
  - `commands/runtime-settings-command.ts` -> `command/runtime-settings.ts`
  - `commands/diagnostics-command.ts` -> `command/diagnostics.ts`
  - `commands/control-command.ts` -> `command/control.ts`
  - `commands/help-command.ts` -> `command/help.ts`
  - `commands/status-command.ts` -> `command/status.ts`
- 更新 `bridge-manager.ts`、`bridge-adapter-runtime.ts`、`bridge-channel-runtime.ts`、`thread-display-resolver.ts`、`thread-table-message-pins.ts`、`tmux-command.ts` 和 command tests 的 import。
- 删除空的 `src/lib/bridge/commands/` 临时目录。
- 验证：旧路径 grep `command-dispatch|command-aliases|command-formatters|health-formatters|commands/|runtime-settings-command|status-command` 只剩日志前缀和测试描述文本；`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm run typecheck` 通过。
- 最新理解：command 现在至少是目录层面的聚合，不再把 handler 散挂在 `bridge` 根目录和 `commands/` 临时目录；下一刀是 tmux，因为 `command/control.ts`、`command/runtime-settings.ts`、`command/dispatch.ts` 仍直接 import `../tmux-command.js`，而 `tmux-command.ts` 仍混合 runtime、shell adapter、screen monitor 和 command presentation。

#### 纠偏执行：tmux runtime / command handler 分离

- 读取 `tmux-command.ts` 的 export 和内部结构，确认它同时承担 tmux process/shell 调用、Codex TUI resume command 构造、tmux screen capture/list/send/interrupt、screen monitor 和 `/tmux*` command rendering。
- 新增 `src/lib/bridge/tmux/runtime.ts`，迁入并导出 tmux runtime 能力：
  - `runCommand` / `runTmux`
  - `tmuxCommandPreview`
  - `captureTmuxArgv`
  - `hasTmuxSession` / `listTmuxSessions`
  - `codexTmuxSessionName`
  - `buildCodexResumeTmuxCommand`
  - `startCodexResumeTmuxSession`
  - `sendTmuxInterrupt`
  - runtime types `TmuxArgv`、`TmuxSessionInfo`、`StartCodexResumeTmuxSessionParams`
- 修改原 `tmux-command.ts` 先复用 `tmux/runtime.ts`，再移动为 `src/lib/bridge/command/tmux.ts`，使 `/tmux*` command handler 归入 command 聚合。
- 修改 `command/control.ts` 和 `command/runtime-settings.ts`：`/stop` interrupt 与 `/provider tmux` resume 启动改为依赖 `../tmux/runtime.js`，不再 import tmux command handler。
- 修改 `command/dispatch.ts`：`/tmux*` family 调 `./tmux.js`。
- 验证：`grep -R "tmux-command" -n src` 只剩测试 message id 文本；`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm run typecheck` 通过。
- 最新理解：tmux 的运行能力和 command handler 已经分离；`command/tmux.ts` 仍较胖，但它现在是 command 聚合内部文件，后续如果继续拆 screen monitor，应在 command/tmux 或 tmux runtime 内部完成，不再从外部直接读取 handler 内部函数。

#### 纠偏执行：display 聚合目录收口

- 移动 display/query/source 规则到 `src/lib/bridge/display/`：
  - `session-display-query.ts` -> `display/session-display-query.ts`
  - `session-creator.ts` -> `display/session-creator.ts`
  - `display/session-title.ts` 已在前一刀新增
- 更新 `session-registry.ts`、`thread-display-resolver.ts`、`ui-session-routes.ts`、`command/presentation.ts` 和 `session-display-query.test.ts` 的 import。
- 验证：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm run typecheck` 通过。
- 最新理解：Creator/CodexSource/title/session list display 规则现在是明确 display 聚合；command presentation 只作为消费者 import display creator/title，不再拥有这些 display/domain 命名规则。

#### 纠偏执行：UI route / application 边界收口

- 新增 `src/ui/application/session.ts`，把 UI session workflow 从 route handler 中抽出：
  - session list query；
  - session history assembly and Markdown rendering；
  - session config payload；
  - Codex thread materialization；
  - rename/config/delete use cases；
  - `SessionRegistryService` wiring and local Codex session index reads。
- 重写 `src/ui-session-routes.ts`，只保留 HTTP method/path 判断、query/body 参数解析、JSON response 和错误码映射；不再直接 import Codex session index、display query、MarkdownIt 或 `SessionRegistryService`。
- 新增 `src/ui/application/binding.ts`，把 binding switch、channel default target update/delete 和 binding delete 的 registry mutation 移出 route。
- 修改 `src/ui-binding-routes.ts`，只保留 HTTP 参数解析、JSON response 和 bindings payload refresh；registry mutation 通过 `UiBindingApplication` 完成。
- 验证：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm run typecheck` 通过。
- 最新理解：UI route 切片已经从“把 `ui-server.ts` helper 搬出去”进一步变成 route adapter + application service；后续 UI server 剩余的大块静态 shell/channel/config/service management 可作为 Phase 5 的下一轮，但 session/binding route 不再直接拥有 session import 和 registry invariant。

#### 纠偏执行：架构文档路径同步

- 更新 `docs/current-architecture.md`，把旧 `command-dispatch.ts`、`command-aliases.ts`、`command-formatters.ts` 路径同步为当前 `src/lib/bridge/command/dispatch.ts`、`command/aliases.ts`、`command/presentation.ts` 和 `command/diagnostics-presentation.ts`。
- 验证：`grep -R "command-dispatch\\|command-aliases\\|command-formatters\\|command-helpers\\|health-formatters\\|tmux-command\\|commands/" -n src docs README.md README_EN.md` 只剩测试描述/message id 文本；`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm run typecheck` 通过。
- 最新理解：源码和当前架构文档已不再指向旧 command 文件名；`work/rebuild/STATUS.md` 前文保留历史审计证据，但顶部“当前最新决策”和本操作记录是当前状态。

#### 验证记录：command/tmux/display/UI 重排后

- `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test` 通过，455 tests 全部通过。
- `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build` 通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- 当前重排范围已覆盖本次纠偏中列出的主要问题：
  - command handler、aliases、presentation、diagnostics presentation 已进入 `src/lib/bridge/command/`；
  - `command-helpers` barrel 已删除；
  - tmux runtime 和 `/tmux*` command handler 已分离；
  - display query / Creator / session title 已进入 `src/lib/bridge/display/`；
  - UI session/binding route 已拆成 HTTP adapter + `src/ui/application/*`。

#### 纠偏执行：channel label display 规则外移

- 发现 `bridge-channel-runtime.ts` 仍为 `formatBindingChatLabel` 依赖 `command/presentation.ts`，属于非 command runtime 读取 command presentation。
- 新增 `src/lib/bridge/display/channel-label.ts`，把 binding/channel/chat label display rule 移入 display 聚合。
- 修改 `bridge-channel-runtime.ts` 直接依赖 `display/channel-label.ts`；`command/presentation.ts` 仅 re-export 给 command 侧兼容使用。
- 验证：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm run typecheck` 通过。

- 最终工作树状态下运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test && npm run build` 通过。
- `npm test` 455 tests 全部通过。
- `npm run build` 生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。

- 建立 `work/rebuild/STATUS.md` 作为 rebuild 任务入口。
- 复查 `docs/current-architecture.md`、`work/analysis/STATUS.md`、`work/analysis/module-clusters.md`、`work/analysis/layering-proposal.md`。
- 扫描源码中的 `targetKey`、`desktop:`、`session:`、`codepilotSessionId`、`source/originator`、legacy/fallback/startsWith 判断。
- 结论：第一刀必须处理 identity/display query 和 registry facade，而不是先拆大文件。
- 补充“持续追踪约定”：后续 rebuild 的最新理解、操作、结论、写入位置和验证结果都以本文件为准。
- 新建 `src/lib/bridge/session-display-query.ts`，把 UI session list 所需的 BridgeSession/local Codex thread 合并、dedupe、title、execution provider、Creator、CodexSource、legacy selector 兼容字段收敛到只读 query module。
- 修改 `src/ui-server.ts`，让 `/api/desktop-sessions` 和 session history/config/delete 相关 summary 构造复用 display query helper；保持原有 `targetKey`、`sessionId`、`threadId`、`title` 等 UI 兼容字段。
- 新增 `src/__tests__/session-display-query.test.ts`，覆盖 legacy selector 解析、linked desktop row 去重、`bridgeSessionId`/`codexThreadId`/`displayTitle`/`creatorKind`/`codexSource`/`executionProvider` 字段。
- 扩展 `src/__tests__/channel-router.test.ts`，覆盖 `desktop:<threadId>` channel default target 在新聊天进入时 materialize BridgeSession、保留 chat display metadata、清理 default target。
- 验证：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` 通过；`npm test` 448 tests 全部通过；`npm run build` 通过并生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- 最新理解：Phase 1 可以先以兼容 DTO 接入 UI，避免一次性改前端 API；`targetKey` 应继续集中在 display query 和 session-bindings facade，后续 registry service 再把 mutation API 改为 `bridgeSessionId` first。
- 新建 `src/lib/bridge/session-registry.ts`，用 canonical 方法名包住现有 `session-bindings.ts` mutation：`bindChatToBridgeSession`、`importCodexThreadForChat`、`bindChatToLegacyTarget`、`switchBindingToLegacyTarget`、`setChannelDefaultLegacyTarget`、delete/remove 方法。
- 修改 `src/lib/bridge/channel-router.ts`，让新聊天应用 one-shot default target、显式 bind BridgeSession、显式 import CodexThread 都通过 `SessionRegistryService`。
- 修改 `src/ui-server.ts`，让 binding switch、channel default target update/delete、binding delete 走 registry facade；UI API 仍保留 legacy `targetKey` payload。
- 新增 `src/__tests__/session-registry.test.ts`，覆盖 canonical bind/import 方法和 legacy target compatibility 方法。
- 验证：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` 通过；聚焦测试 `session-registry.test.ts`、`session-display-query.test.ts`、`channel-router.test.ts` 通过；完整 `npm test` 451 tests 全部通过；`npm run build` 通过。
- 最新理解：Phase 2 可以先以 facade 形式收口 mutation 调用点，不急于改落盘字段；下一步应把 rename/config/delete/archive 也移入 registry，并逐步提供 `bridgeSessionId` first 的 UI mutation API，同时保留 `targetKey` compatibility layer。
- 修改 `src/lib/bridge/thread-display-resolver.ts`，让 `/t` 和交互运行时使用的 thread display 结果携带 `bridgeSessionId`、`creatorKind`、`codexSource`、`executionProvider`；标题解析复用 display query 中的 BridgeSession title 规则。
- 扩展 `src/__tests__/session-bindings.test.ts`，覆盖绑定到 local Codex thread 后 `/t` display 暴露 VS Code CodexSource、execution provider 和 BridgeSession identity。
- 验证：`npm run typecheck` 通过；聚焦测试 `session-bindings.test.ts`、`session-display-query.test.ts` 通过；完整 `npm test` 452 tests 全部通过；`npm run build` 通过。
- 最新理解：`/t` 当前还只消费 title/cwd/originator 字段，但 resolver 已经能输出 canonical display DTO 关键字段；后续 command renderer 可以逐步停止自己判断 CodexSource/source。
- 扩展 `src/lib/bridge/session-registry.ts`，新增 local Codex thread port，并把 materialize CodexThread、rename BridgeSession、update BridgeSession config、delete BridgeSession、archive CodexThread + 删除关联 BridgeSession 收进 registry service。
- 修改 `src/ui-server.ts`，新增 `createSessionRegistry` composition helper；`GET/POST /api/session-config`、`POST /api/sessions/rename`、`POST /api/sessions/delete` 支持 `bridgeSessionId` first，同时保留 legacy `targetKey`；新增 `POST /api/sessions/import-codex-thread` 显式 materialize endpoint。
- 扩展 `src/__tests__/session-registry.test.ts`，覆盖 canonical materialize/rename/config/delete 和 legacy desktop archive compatibility。
- 验证：`npm run typecheck` 通过；聚焦测试 `session-registry.test.ts`、`session-display-query.test.ts`、`channel-router.test.ts` 通过；完整 `npm test` 454 tests 全部通过；`npm run build` 通过。
- 最新理解：UI 前端仍然主要发送 `targetKey`，但 route/API 层已经有 `bridgeSessionId` first surface；后续应把前端调用和 URL/hash 状态迁移到 `bridgeSessionId`，把 `targetKey` 限制为 compatibility 输入。
- 修改 `src/lib/bridge/streaming-metadata.ts`，为 structured stream metadata 增加 `bridge_session_id`、`codex_thread_id`、`provider`、`creator`。
- 修改 `src/lib/bridge/interactive-message-runner.ts` 和 `src/lib/bridge/mirror-feedback-controller.ts`，让 interactive 与 mirror streaming card 使用 display/query 派生的 canonical identity/source tags。
- 新增 `src/__tests__/streaming-metadata.test.ts`，并更新 interactive/mirror 精确断言，覆盖 canonical stream tags。
- 验证：`npm run typecheck` 通过；聚焦测试 `streaming-metadata.test.ts`、`interactive-message-runner.test.ts`、`bridge-manager.test.ts` 通过；完整 `npm test` 455 tests 全部通过；`npm run build` 通过。
- 最新理解：stream metadata 现在已不只暴露 runtime source；可供 Feishu/Weixin 后续展示 BridgeSession、Codex thread、execution provider 和 Creator；按干净优先原则不保留 `display_source` 兼容 tag。
- 修改 `src/lib/bridge/session-display-query.ts`，新增 `creatorLabel` / `creatorClass`，把 UI source badge 文案和 class 从 CodexSource/source 解析中收敛到 display query DTO。
- 修改 `src/ui-server.ts` 前端脚本，`sessionCreatorTag` 优先渲染 DTO 中的 badge 字段；binding target table 也复用 `renderCreatorBadge`，不再在前端根据 `source/originator` 推断 badge。
- 扩展 `src/__tests__/session-display-query.test.ts`，覆盖 Bridge、VS Code、TUI/CLI source badge DTO。
- 验证：`npm run typecheck` 通过；聚焦测试 `session-display-query.test.ts` 通过；完整 `npm test` 455 tests 全部通过；`npm run build` 通过。
- 最新理解：UI 仍保留 raw source toggle 展示原始 CodexSource 文本，但 badge 判定已经由 presentation model 负责；后续可以把 raw CodexSource 也改为读取 `codexSource`。
- 新增 `src/codex-session-index.ts`，把 `desktop-sessions.ts` 的 list/get/archive/history/mirror/event/message API 重新暴露为 Local Codex session index facade。
- 修改 `src/ui-server.ts`、`src/session-bindings.ts`、`src/codex-tmux-provider.ts`、`src/desktop-session-mirror.ts`、`src/ui-session-history.ts` 以及 bridge command/mirror/health/runtime 模块，让应用层不再直接 import `desktop-sessions.js`。
- 更新相关测试类型 import：`desktop-session-mirror.test.ts`、`desktop-terminal-router.test.ts`、`session-display-query.test.ts`、`ui-session-history.test.ts` 改为使用 local Codex facade type。
- 验证 direct import 扫描：`git grep -n "from '.*desktop-sessions\\.js'" -- src ':!src/desktop-sessions.ts' ':!src/codex-session-index.ts' ':!src/__tests__/desktop-sessions.test.ts'` 无输出。
- 验证：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` 通过；`npm test` 455 tests 全部通过；`npm run build` 通过。
- 最新理解：本次只收缩基础设施 import 边界，不强行改命令/UI 中的 legacy Desktop 命名；这样能推进 Phase 7 的 public type/import 命名迁移，同时不扩大 `desktop:<threadId>` compatibility 面。
- 继续 Phase 3 内部重组：从 `desktop-sessions.ts` 拆出 Local Codex session index 的路径解析、归档 store、SQLite visibility 兼容 reader、文件 range/prefix reader、workspace root filter 和递归 JSONL discovery scanner。
- 修改 `desktop-sessions.ts` 为这些基础设施模块的组合者，保留原 public API 和 parser 行为；本次没有改变 list/get/archive/history/mirror 对外 contract。
- 验证：拆分过程中每一小步均运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` 通过；完成后完整 `npm test` 455 tests 全部通过；`npm run build` 通过。
- 最新理解：Local Codex Session Index 可以先把纯基础设施职责拆出，parser 仍需保持紧凑迁移；下一步适合拆 JSONL history/event/mirror parser，或在 command/UI 继续减少 legacy Desktop 命名的内部扩散。
- 继续 Phase 3 parser 拆分：新增 `jsonl-types.ts`，收敛 Codex JSONL line shapes、event/mirror/history public types、文本抽取、tool summary、signature 和 type guard helper；新增 `history-parser.ts`，承接 `parseDesktopSessionJsonlHistoryText` 和 `desktopJsonlHistoryEntriesToBridgeMessages`。
- 修改 `desktop-sessions.ts` 复用 history parser，并继续 re-export `parseDesktopSessionJsonlHistoryText`，保持原 public API；file path 读取 wrapper 仍留在 `desktop-sessions.ts`。
- 验证：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` 通过；完整 `npm test` 455 tests 全部通过；`npm run build` 通过。
- 最新理解：history parser 已脱离 `desktop-sessions.ts`，但 event/mirror parser 还在原文件中消费 `jsonl-types.ts` helper；下一步应把 `parseDesktopSessionEventText` / `parseDesktopMirrorRecordText` 和对应 push record 规则迁到独立 parser 模块。
- 继续 Phase 3 parser 拆分：新增 `event-mirror-parser.ts`，承接 `parseDesktopSessionEventText`、`parseDesktopMirrorRecordText`、event push 规则、mirror record push 规则和 unknown-kind 分类；`desktop-sessions.ts` 只保留 read-by-file wrapper 和 thread-id wrapper。
- 修复拆分过程中的过宽删除，恢复并保留 `listDesktopSessions`、`getDesktopSessionByThreadId`、`archiveDesktopSession`、`isArchivedDesktopThread` public API。
- 验证：`npm run typecheck` 通过；聚焦 JSONL/mirror 测试 `node --test --import tsx src/__tests__/desktop-sessions.test.ts src/__tests__/desktop-session-mirror.test.ts src/__tests__/mirror-reconcile-core.test.ts src/__tests__/mirror-runtime.test.ts src/__tests__/mirror-turns.test.ts src/__tests__/ui-session-history.test.ts` 55 tests 全部通过；完整 `npm test` 455 tests 全部通过；`npm run build` 通过。
- 最新理解：Phase 3 的指定内部职责已经基本分离完成；后续可继续把 metadata parser/list orchestration 从 `desktop-sessions.ts` 迁到 Local Codex index 内部子模块，或进入 Phase 4 command module 拆分。
- 本轮新目标：直接放弃 `targetKey` 兼容，不再把它作为 UI/API/store contract；`channel-default-targets` v2 只接受 `bridgeSessionId`，不再把旧 selector materialize 成新记录；用户可见术语避免强调 Desktop，改用 Native / Codex / 本地 Codex。
- 已开始修改：
  - `ChannelDefaultTarget` / store upsert 改为持久化 `bridgeSessionId`，新增 `schemas/data/channel-default-targets.v2.schema.json` 并把 manifest current 指向 v2。
  - startup migration 对 `channel-default-targets.json` 只保留已含 `bridgeSessionId` 的 canonical 记录；没有 `bridgeSessionId` 的旧 selector 记录直接丢弃，不做兼容升级。
  - `session-display-query` 移除 `targetKey` DTO 字段和 legacy parser，source badge 默认文案从 Desktop 改为 Native，counts 从 `desktopPhysical` 改为 `codexPhysical`。
  - `session-bindings` / `session-registry` / `channel-router` 开始改为 `bridgeSessionId` / `codexThreadId` mutation surface；旧 legacy 方法已删除或正在替换测试。
  - UI 前端脚本已开始把 hash/state/API payload 从 `targetKey` 改为 `sessionRef` + `bridgeSessionId`/`codexThreadId`，并替换主要用户可见 Desktop 文案。
- 本轮收尾：
  - 已删除 runtime/UI/API/store 对 `targetKey` 的依赖；`channel-default-targets` startup migration 不再读取旧 selector。
  - `channel-default-targets` 当前 schema 升级到 v2，最终落盘字段为 `bridgeSessionId`；v1 `session:*` / `desktop:*` selector 不再兼容升级。
  - UI 前端改为 `sessionRef` + `bridgeSessionId` / `codexThreadId`；binding switch、channel default target、history、rename、config、delete 都不再发送 `targetKey`。
  - 用户可见通用文案已从“桌面会话/桌面线程”收敛到“本地 Codex 会话/Codex thread/Native”。真正能从 CodexSource 判断为桌面端 Codex 的展示仍可使用 Desktop badge。
  - docs/README/schema 说明同步到新模型；`schemas/data/channel-default-targets.v1.schema.json` 删除，新增 `channel-default-targets.v2.schema.json`。
- 验证：
  - `source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` 通过。
  - 聚焦测试 `node --test --import tsx src/__tests__/session-display-query.test.ts src/__tests__/bridge-manager.test.ts src/__tests__/storage-migrations.test.ts src/__tests__/session-registry.test.ts src/__tests__/channel-router.test.ts` 85 tests 通过。
  - `npm test` 455 tests 全部通过。
  - `npm run build` 通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- 当前态审计补充：
  - `git grep -n "targetKey" -- src docs README.md README_EN.md schemas` 无输出；runtime/UI/API/store/schema/docs 不再使用 `targetKey` contract。
  - `git grep -n "桌面" -- src ':!src/__tests__'` 无输出；用户可见通用中文文案不再强调“桌面”。
  - 修正 `formatMirrorStatus` stale 文案为“本地 Codex thread 文件”，并同步 `bridge-manager.test.ts` 断言。
  - 更新本文件前半段，把 `targetKey` 使用点明确标记为历史基线，当前状态以 runtime/UI/API/store 已清理为准。
- 最新验证：
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` 通过。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test` 455 tests 全部通过。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build` 通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- 术语纠偏：确认 `CodexSource` / `Creator` 是本轮 canonical 术语。Codex 原始来源事实统一叫 `CodexSource`，包含 JSONL / SQLite 的 `originator`、`source`、`cliVersion`；`cli`、`exec`、`vscode` 是 Codex source 值。UI/IM 上用于区分 Bridge、SDK、VS Code、TUI/CLI、Native 的业务展示类别统一叫 `Creator`。
- 代码收敛目标：把旧 `jsonlProvenance` / `JsonlProvenanceSummary` 改为 `codexSource` / `CodexSourceSummary`，把旧 `displaySourceKind` / label / class 改为 `creatorKind` / `creatorLabel` / `creatorClass`；stream metadata 只保留 `creator:*` tag，不保留 `display_source:*` 兼容 tag。
- 已完成术语收敛：
  - 新增 `src/lib/bridge/session-creator.ts`，定义 `CodexSourceSummary`、`CreatorKind`、Creator 推导和 badge 文案。
  - `SessionDisplayQuery`、`ThreadDisplayService`、interactive/mirror stream metadata、UI 前端脚本和 `/t` 表格已迁移到 `codexSource` / `creatorKind` / `creatorLabel` / `creatorClass`。
  - `channel-default-targets` 不再兼容旧 selector：startup migration 只保留含 `bridgeSessionId` 的 canonical 记录；schema 改为 `additionalProperties: false`。
  - `git grep -n "targetKey\\|display_source\\|displaySource\\|JsonlProvenance\\|jsonlProvenance\\|provenance\\|display source" -- src docs README.md README_EN.md schemas` 无输出。
- 验证：
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` 通过。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test` 455 tests 全部通过。
  - `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build` 通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- 新纠偏：`Desktop` 本身也是错误历史术语，必须先完成该术语重构再继续 Phase 4 command 拆分。默认命名改为 Codex / Native；不引入 `Codex`。只有从 CodexSource 能明确判断 creator 是桌面端 Codex 时，展示层才可使用 Desktop badge。
- Desktop 术语重构目标：
  - `desktop-sessions.ts`、`desktop-session-mirror.ts`、`DesktopSession*`、`DesktopMirror*`、`DesktopThread*` 等通用 Codex 概念改为 Codex 命名。
  - UI DOM/state/API 中泛指 Codex 会话的 `desktop*` id/function/state 改为 `codex*`。
  - `/t` 命令、history、mirror、health、tests 中泛指本地 Codex JSONL/session/thread 的文案不再使用 Desktop。
  - 保留条件：`CreatorKind === 'desktop'` 和 `Desktop` badge 只用于 CodexSource 明确为桌面端 Codex 的记录。
- Desktop 术语重构已完成：
  - `src/desktop-sessions.ts` 已迁移为 `src/codex-session-index.ts` + `src/codex-session-index/core.ts` 和内部子模块；`src/desktop-session-mirror.ts` 已迁移为 `src/codex-session-mirror.ts`；`desktop-terminal-router` 测试和 import 已迁移到 `local-codex-terminal-router`。
  - UI DOM/state/API 泛用命名已迁移到 `codex*`，会话列表接口从 `/api/desktop-sessions` 改为 `/api/codex-sessions`。
  - turn runtime 泛用命名已迁移到 Codex：`im_codex_reuse`、`codex_mirror`、`codex_jsonl`、`codex_task_complete`、`codexThreadId`。
  - startup storage migration 不再把旧 `desktop:<threadId>` UI meta selector materialize 成新 BridgeSession；旧 `desktop_thread_id` / `desktopThreadId` 只保留为历史落盘迁移输入。
  - 生产代码 grep 剩余 `desktop` 仅属于白名单：legacy `Desktop:` 前缀剥离、真实 `CreatorKind === 'desktop'` / Desktop badge / `.pill-desktop`、CodexSource 原始值检测、历史 migration/schema 字段。
  - 审计命令确认 `desktopRawSessions`、`desktopThreadIds`、`desktopSessions`、`DesktopSession*`、`DesktopMirror*`、`DesktopThread*` 在 `src` 中无命中。
- 本次 Desktop 术语重构操作记录：
  - 读取 `work/rebuild/STATUS.md`、当前 git 状态、`src/codex-session-index.ts`、`src/codex-session-index/core.ts`、`src/codex-session-mirror.ts`、`src/lib/bridge/turns/local-codex-terminal-router.ts`，确认前序重命名已开始但 facade/import 尚有断点。
  - 修复 `src/codex-session-index.ts` 顶层 facade 自调用问题，改为 re-export `src/codex-session-index/core.ts`；修正 `core.ts` 内部模块相对路径。
  - 重命名应用/runtime/test import：`desktop-session-mirror` -> `codex-session-mirror`，`desktop-terminal-router` -> `local-codex-terminal-router`，`desktop-sessions` -> `codex-session-index`。
  - 收敛 command/display/mirror/runtime 类型和函数名：`getDisplayedCodexThreads`、`buildCodexThreadCommandTableRows`、`CodexMirrorSubscription`、`CodexMirrorTurnState`、`buildUiHistoryEntriesFromCodexRecords`、`getCodexCandidateForThread` 等。
  - 更新 UI 前端和 route：`desktopRoot`/`desktopMessage`/`loadDesktopSessions`/`renderDesktopSessions` 等改为 `codex*`，`/api/codex-sessions` 成为当前 route。
  - 修正 `storage-migrations.ts`：恢复历史 `desktop_thread_id` / `desktopThreadId` 作为 retired field migration input，同时删除旧 `desktop:<threadId>` UI meta materialization。
  - 更新 `docs/current-architecture.md` 当前实现描述，避免继续指向 `src/desktop-sessions.ts`。
  - 验证：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` 通过；`npm test` 455 tests 全部通过；`npm run build` 通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- Phase 4 command module 拆分继续推进：
  - 读取 `work/rebuild/STATUS.md`、`src/lib/bridge/command-dispatch.ts`、`bridge-manager.ts`、`command-dispatch.test.ts`，确认当前下一步是 command layer 按用户故事族拆分。
  - 新增 `src/lib/bridge/commands/status-command.ts`，把全局 `/status` response builder 从 `command-dispatch.ts` 移出，并让 `bridge-manager.ts` 直接复用该模块。
  - 新增 `src/lib/bridge/commands/diagnostics-command.ts`，承接 `/current`、`/check`、`/his`、`/cat`、`/file`，包含 history JSONL 文件查找、附件发送、文件读取和当前会话诊断渲染。
  - 新增 `src/lib/bridge/commands/runtime-settings-command.ts`，承接 `/reasoning`、`/mode`、`/provider`、`/sandbox`、`/network`、`/ui`、`/model`，并集中 runtime settings parsing/formatting。
  - 新增 `src/lib/bridge/commands/control-command.ts`，承接 `/stop` 和 `/perm`；tmux provider running mirror 的 `/stop` -> `C-c` 映射也移入该模块。
  - 新增 `src/lib/bridge/commands/help-command.ts`，承接 help text assembly。
  - `command-dispatch.ts` 当前保留命令解析、危险输入审计、session/thread 剩余流程、tmux screen stream card glue、统一 response delivery 和 thread table pin。
  - 验证：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` 通过；聚焦测试 `node --test --import tsx src/__tests__/command-dispatch.test.ts src/__tests__/bridge-manager.test.ts` 89 tests 通过；完整 `npm test` 455 tests 全部通过；`npm run build` 通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
  - 最新理解：Phase 4 的 runtime/diagnostics/control/help/status 切片已完成，下一刀应集中抽 session/thread command module，避免在 dispatch 中继续保留 binding selection、active-task guard、thread card refresh 和 audit 规则。
- Phase 4 session/thread command module 收尾：
  - 新增 `src/lib/bridge/commands/session-thread-command.ts`，承接 `/start`、`/new`、`/t`、`/thread`、`/threads`，并一起迁走 binding change audit、active-task switch guard、Codex thread selection、thread card refresh 和 mirror subscription reconcile best-effort。
  - 修改 `src/lib/bridge/command-dispatch.ts`，让这些命令只调用 session/thread handler；dispatch 当前约 440 行，只保留命令解析、危险输入审计、tmux screen stream card glue、统一 response delivery 和 thread table pin。
  - 验证：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` 通过；聚焦测试 `node --test --import tsx src/__tests__/command-dispatch.test.ts src/__tests__/bridge-command-e2e.test.ts src/__tests__/bridge-manager.test.ts` 100 tests 通过；完整 `npm test` 455 tests 全部通过；`npm run build` 通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
  - 旧结论：当时判断 Phase 4 既定拆分已完成，下一阶段进入 Phase 5 UI route 收缩。
  - 2026-05-30 用户纠偏后覆盖该结论：上述变化只是机械切片，未通过高内聚/低耦合验收；当前必须先按“2026-05-30 纠偏审计：Command/UI 文件级依赖”重新设计 command/tmux/formatter/UI route 排列，再继续生产代码变更。
