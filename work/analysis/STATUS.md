# Codex-to-IM 架构分析状态

## 目标

从用户故事、功能边界和依赖关系三个角度分析当前代码库，在不打散共享业务概念的前提下，推导自然的模块边界。

## 当前状态

- 开始时间：2026-05-29
- 范围：本地分析产物，全部放在 `work/analysis/`
- 工作原则：优先保持业务规则内聚；不能因为文件大就机械拆文件。

## 操作记录

### 2026-05-29 继续清理与正式架构文档

- 复查当前工作树，确认上一轮已提交 `b847b51 Remove obsolete bridge documentation`，删除了 7 个旧 PRD/设计/bridge 文档。
- 重新扫描剩余 Markdown，发现根目录 `STATUS.md` 仍记录旧的 `desktop_thread_id` / `thread_origin` 身份模型，`src/lib/bridge/README.md` 仍引用不存在的 `hosts/codepilot.ts`，二者都会误导后续架构整理。
- 按要求逐个使用绝对路径删除：
  - `/data00/home/hongli.fish/Codex/codex-to-im/STATUS.md`
  - `/data00/home/hongli.fish/Codex/codex-to-im/src/lib/bridge/README.md`
- 新增正式当前架构文档：`docs/current-architecture.md`。
- 文档写法刻意收敛 Desktop 术语：当前业务核心是本地可发现的 Codex session / Codex thread，`desktop-sessions.ts` 和 `desktop:<threadId>` 是历史命名与 UI target key，不应再扩展成新的 Desktop-only 业务模型。
- 顺手收敛用户文档中的核心表述：`README.md`、`README_EN.md`、`docs/install-windows.md` 将主要能力从“桌面线程”改成“本地 Codex 线程/会话”或“共享 Codex 线程”；保留 `/t` 等现有入口，不改命令行为。

### 2026-05-30 targetKey 纠偏

- 复查 `targetKey` 使用点，确认它不是 Codex 或 Bridge domain 概念，而是 UI/API 为了混合展示 `session:<BridgeSession.id>` 和 `desktop:<codex_thread_id>` 两类行造出的 legacy selector。
- 结论：`targetKey` 不应写成架构原语，也不应扩展。更合理的目标模型是 UI/API 统一操作 `BridgeSession.id`；本地 Codex JSONL thread 在发生 rename/config/delete/bind/default target 等 mutation 前先导入/物化成 `BridgeSession`；`codex_thread_id` 继续只表示底层 Codex thread 身份。
- 已重写 `docs/current-architecture.md` 的 Session Selection / UI Mapping / Terminology Rules：把 `targetKey` 标成 transitional glue，而不是 domain concept。

### 2026-05-30 rebuild 任务入口

- 根据新目标建立 `work/rebuild/STATUS.md`，作为 rebuild 任务的主入口和状态文件。
- 严格扫描了当前源码中的 `targetKey`、`desktop:`、`session:`、`codepilotSessionId`、`source/originator`、legacy/fallback/startsWith 判断，以及 `ui-server.ts`、`session-bindings.ts`、`desktop-sessions.ts`、`command-dispatch.ts`、Feishu adapter 等大文件职责。
- 结论写入 `work/rebuild/STATUS.md`：第一刀不应先拆大文件，而应先建立 Session Identity / Display Query 和 Session Registry facade；`targetKey` 只能作为兼容 facade，不能继续进入新逻辑。
- `work/rebuild/STATUS.md` 已记录大模块和小模块划分、可共享/不可共享边界、重构阶段、验收命令和待确认问题。

### 2026-05-29 23:45

- 根据用户要求，把 `work/analysis` 下的分析报告统一改成中文。
- 同步修改 `analyze-imports.mjs` 的 Markdown 报告输出，避免以后重新生成后又出现英文报告。

### 2026-05-29 23:39

- 阅读了 PRD、共享 thread 设计文档，以及核心实现路径：
  - command dispatch 和 `/t` thread 管理；
  - bridge manager 编排；
  - interactive message runner；
  - channel router 和 session binding registry；
  - store/session/thread 持久化；
  - Codex provider routing；
  - mirror runtime；
  - UI API routes。
- 新增 `work/analysis/user-stories-current.md`。
- 新增 `work/analysis/module-clusters.md`。
- 新增 `work/analysis/docs-cleanup-notes.md`。
- 新增 `work/analysis/layering-proposal.md`。
- 新增 `work/analysis/current-architecture-draft.md`。
- 从 `dependency-report.json` 里抽取热点文件的 inbound/outbound 依赖。
- 扩展依赖脚本，加入 Tarjan 强连通分量检测，并重新生成报告。

### 2026-05-29 23:27

- 新增 `work/analysis/analyze-imports.mjs`。
- 生成 `work/analysis/dependency-report.json` 和 `work/analysis/dependency-report.md`。
- 运行脚本时需要使用 Node.js 24 并清掉 `NODE_OPTIONS`，因为继承环境里的 `--use-env-proxy` 会被普通 Node 启动拒绝。
- 修复脚本，使其能把运行时风格的 `.js` import specifier 解析回源码 `.ts` 文件；第一版报告只有文件规模，没有依赖边。

### 2026-05-29 23:20

- 创建 `work/analysis/STATUS.md`。
- 分析开始前确认 git worktree 干净。
- 目标工具里仍挂着一个旧的已完成 goal，所以这份文件作为当前新分析任务的主动追踪文件。

## 当前理解

- Codex-to-IM 连接的是 IM chat、本地 Bridge session 和 Codex thread/session 状态。
- 最关键的共享概念是：session identity、thread identity、routing、runtime state、source/provenance、display title、channel delivery。
- 产品文档确认了核心方向：共享底层 Codex `thread_id`，IM 是远程控制/观察端，不是另一套独立聊天产品。
- 当前实现已经超过旧设计文档的一部分规划：本地 Codex session 扫描、`/t` 切换、mirror runtime、UI session 管理都已经存在。
- 当前代码和旧文档之间的主要问题是术语不一致，而不是能力完全缺失。
- 最新结论：业务文档里应把 Codex thread/session 作为核心概念；Desktop 只用于指实际 Desktop app 或历史 UI/代码命名。`BridgeSession.codex_thread_id` 是唯一持久化 thread 身份，binding 只指向 BridgeSession。
- `docs/current-architecture.md` 已把四个核心概念放在开头：Codex Session、BridgeSession、IMChannel、Binding，并补充功能模块、数据操作、直接对话/mirror/命令三种模式、命令 scope 和 UI 映射。`targetKey` 已降级为 legacy UI/API selector，不再作为领域概念。

## 依赖分析结论

- `work/analysis/dependency-report.md` 统计到 146 个 TypeScript 文件和 595 条本地 import 边。
- 最大实现热点：
  - `src/ui-server.ts`：4899 行；
  - `src/lib/bridge/adapters/feishu-adapter.ts`：2882 行；
  - `src/desktop-sessions.ts`：2026 行；
  - `src/lib/bridge/command-dispatch.ts`：2022 行；
  - `src/lib/bridge/bridge-manager.ts`：1313 行；
  - `src/lib/bridge/interactive-message-runner.ts`：1053 行。
- 最密集的边组是 `bridge/core -> bridge/core`，共 167 条。这说明当前痛点不是目录太平，而是核心编排、领域规则和表现层 helper 混在一个宽泛层里。
- `src/config.ts`、`src/codex-provider.ts`、`src/lib/bridge/host.ts`、`src/desktop-sessions.ts`、`src/store.ts` inbound 较高，实际上已经是共享接口或基础设施枢纽。
- import cycle 很少：目前只发现一个多文件循环，`src/lib/bridge/host.ts` <-> `src/lib/bridge/types.ts`。因此模块化问题主要是职责归属和边界设计，不是循环依赖债务。

## 用户故事结论

- 这个产品更适合从用户工作流理解，而不是从当前目录理解：
  - 本地 operator 配置和服务管理；
  - channel instance 配置；
  - IM chat 自动解析到 binding/session；
  - 本地 Codex thread 发现和选择；
  - 普通 IM prompt 执行到 Codex；
  - 本地 Codex thread reuse 分类；
  - 本地 Codex/TUI 输出 mirror 回 IM；
  - permission 和 stop 处理；
  - 本地 UI session 管理。
- 最重要的不变量仍然是：当 session 有 `codex_thread_id` 时，IM 应该驱动或观察同一条底层 Codex thread。
- `source` 被严重重载，需要拆成几个明确概念：
  - execution provider；
  - Codex JSONL provenance；
  - product row kind；
  - channel provider。

## 自然聚类结论

- Identity/display model 是真实共享领域，不应该散落在 UI、command formatting、session binding summary 里。
- Session/binding registry 是真实产品状态层，应负责不变量；本地 Codex session lookup 和 channel metadata 应变成注入的查询依赖。
- Local Codex session index 是基础设施层，对外应暴露稳定小接口，但当前 `desktop-sessions.ts` 内部过宽。
- Interactive turn runtime 和 mirror runtime 是两个独立 use-case cluster，但二者都消费 session/thread identity。
- Command handling 应该按用户故事族拆，而不是每个命令一个任意文件。
- Local UI/service management 是 operator-facing cluster，应消费 application/query service，而不是重建业务规则。

## 分层草案

- 建议方向：domain model -> registry/application services -> runtime use cases -> infrastructure/presentation -> composition roots。
- 第一刀最安全的是共享 display query 模块，用于统一 session/thread target summary。这能直接解决当前重复和显示不一致问题，同时不会打散共享概念。
- `BridgeSession` 暂时不应硬拆。它现在同时承载身份、配置、runtime health、stream UI diagnostics、mirror status 和 timestamps。更稳妥的是先定义各层使用的 read model/write model。
- 大规模重构前，应先修正 `source` 术语，否则混乱会固化到新模块边界里。
- `targetKey` 是另一个必须提前收敛的术语：它应被替换为 `BridgeSession.id` 作为 UI/API identity；本地 Codex thread 通过显式 import/materialize 流程进入 BridgeSession。
- rebuild 的第一刀应是只读 display query 和 registry facade，而不是先动 Feishu adapter、UI 大字符串或命令巨型 switch。

## 产物

- `docs/current-architecture.md`：正式当前架构文档，作为后续术语整理和模块重构的主入口。
- `STATUS.md`：实时状态、理解和结论。
- `analyze-imports.mjs`：本地 import 图抽取脚本。
- `dependency-report.json`：生成的 import 图和层级摘要。
- `dependency-report.md`：生成的中文依赖报告。
- `user-stories-current.md`：从用户故事角度描述当前已实现行为。
- `module-clusters.md`：从业务概念和依赖关系推导的自然聚类。
- `docs-cleanup-notes.md`：当前文档状态和清理方向。
- `layering-proposal.md`：依赖方向和第一批安全 refactor 候选。
- `current-architecture-draft.md`：当前架构草案，已整理进 `docs/current-architecture.md`，后续可作为分析历史保留。
- `work/rebuild/STATUS.md`：rebuild 任务入口，包含严格标准、扫描结论、大模块/小模块划分、迁移阶段和验收门槛。

## 未解决问题

- 当前哪些 display/source 规则还散落在 UI、`/t`、stream card、mirror delivery 之间，尚未接入统一 query model？
- UI、`/t`、stream card、mirror delivery 之间的 title/source/provenance 规则具体还有哪些分叉？
- 哪些依赖是真实业务依赖，哪些只是平铺文件结构造成的偶然 import？
- 是否还需要继续收敛命令回显和 UI 内部文案中的“桌面会话”，并保留必要的用户可理解入口描述？

## 下一步

- 验证 `docs/current-architecture.md` 没有引用已删除文档或保留旧身份模型。
- 更新 `docs-cleanup-notes.md`，把新增正式文档和本轮删除项记录清楚。
- 为提议分层写出明确的 allowed imports 规则。
- 判断 `ThreadDisplayService` 应升级成 display query service，还是应由新的 query model 替代。
- 对剩余大文件继续校验当前架构草案：`feishu-adapter.ts`、`tmux-command.ts`、`service-manager.ts`。
- 按 `work/rebuild/STATUS.md` 的 Phase 0 补测试，然后进入 display query module。
