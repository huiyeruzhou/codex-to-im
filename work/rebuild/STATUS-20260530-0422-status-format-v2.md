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

## 当前规划

1. 已完成：归档整理前的 `work/rebuild/STATUS.md` 原始流水到 `work/rebuild/STATUS-20260530-0414-status-format-normalization.md`。
2. 已完成：把主 `STATUS.md` 整理为固定四个 h2 区块：任务目标、当前规划、任务上下文、任务日志。
3. 已完成：校验整理后的 Markdown 结构，确认不再存在重复 h2 或散落行动日志。
4. 已完成：仅提交本阶段文档整理相关文件；不纳入当前工作树中其他生产代码改动。
5. 已完成：按用户要求重新派发本地 bridge hot update；不带 `--pull`，不带 `--skip-tests`。
6. 下一阶段：继续 command public facade / ports 阶段，从 runtime -> command 入口收窄推进到 command handler 对 registry/display/tmux/runtime 的 port 化。

## 任务上下文

### 工作目录和权威文件

- 当前工作目录：`/data00/home/hongli.fish/Codex/codex-to-im`
- 本轮 rebuild 工作目录：`work/rebuild`
- 本轮 rebuild 主状态文件：`work/rebuild/STATUS.md`
- 已归档原始流水：
  - `work/rebuild/STATUS-20260530-0336-final-instructions-binding-id.md`
  - `work/rebuild/STATUS-20260530-0400-source-audit-command-boundary.md`
  - `work/rebuild/STATUS-20260530-0414-status-format-normalization.md`
- 当前架构入口：`docs/current-architecture.md`
- 历史分析入口：`work/analysis/STATUS.md`
- 全源文件审计产物：`work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md`
- 审计脚本：`work/rebuild/source-audit.mjs`
- 当前 HEAD：`6eb7b4e Normalize rebuild status format`
- 前序 rebuild feature commit：`c254ffe Add session display and registry rebuild slice`
- 当前工作树仍有未提交的 command facade / source audit 相关源码和审计产物变更；本次 STATUS 格式整理未纳入这些变更。

### 执行约束

- Node.js 开发命令必须使用 Node.js 24；必要时使用 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && ...`。
- 除非用户明确要求，不 push、不 hot update、不 redeploy 本地 bridge。
- 每个阶段完成后必须同步本文件、归档原始素材，并提交到本地 git。同一功能阶段的 follow-up 如未 push，应优先 `git commit --amend` 合并。
- 当前整理阶段只允许触碰 `work/rebuild/STATUS.md` 和对应归档文件；工作树中其他未提交源码变更视为既有变更，不在本阶段回退或纳入提交。

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
- 最新 command facade 审计后：176 个 `src/**/*.ts` 文件、711 条本地 import / re-export 边。
- 最大聚合基线：`Bridge Host / Runtime Contracts` 24 文件 / 6804 行 / 42 条风险跨聚合 import；`Local UI and Service Management` 5 文件 / 6035 行 / 8 条风险跨聚合 import；`Command Application` 11 文件 / 4198 行 / 50 条风险跨聚合 import。
- 第一批风险文件：`bridge-manager.ts`、`command/diagnostics.ts`、`command/dispatch.ts`、`command/session-thread.ts`、`interactive-message-runner.ts`、`mirror-feedback-controller.ts`、`ui-server.ts`、`command/runtime-settings.ts`、`command/tmux.ts`、`command/presentation.ts`、`thread-display-resolver.ts`。
- 当前最大结构性问题不是缺少文件清单，而是 `Bridge Host / Runtime Contracts` 作为 catch-all 聚合继续直接读取 command、mirror、turns、adapter、health 内部。
- 已完成第一刀后，`Bridge Host / Runtime Contracts` 风险跨聚合 import 从 42 降到 39；建立 command public facade 后从 39 降到 34，`bridge-manager.ts` 从 16 降到 13，`bridge-adapter-runtime.ts` 不再有风险跨聚合 import。
- `Command Application` 风险计数仍高，因为 command handler 继续直接 import router/registry/display/tmux/runtime helper；下一阶段要用 command ports 解决。

### 当前架构判断

- Identity / Display 规则仍然是高优先级边界；display query / Creator / session title 已进入 `src/lib/bridge/display/`，但仍需继续避免 command/UI/runtime 各自复制规则。
- Session / Binding Registry 是大模块，不是 util。Registry 应拥有 session/binding/default target mutation use cases，不应直接 import config 或 local Codex scanner。
- Local Codex Session Index 是独立基础设施大模块。它应保留胖模块形态，但内部继续拆成紧凑子模块；对外只暴露 list/get/read history/read mirror delta/archive/import metadata 等窄接口。
- Interactive Turn Runtime 和 Mirror Runtime 应保持分离。两者可共享 display query、delivery contracts、stream feedback primitives，不共享 turn state machine、cursor/suppression、provider SSE parsing。
- Command Layer 是 use-case switchboard。command 不应按每个命令随意拆小文件，应按用户故事族形成胖而紧凑的 command module，并分离 command execution 与 command rendering。
- Channel Delivery / Adapter 要分清可共享和不可共享。共享 delivery contract、chunk/retry/dedup/audit、rich card IR、stream feedback contract、attachment contract；不共享 Feishu/Weixin 平台协议细节。
- Local UI 是 operator workflow，不是 domain owner。UI server 应收缩成 composition root + route declarations + static UI shell，UI route 不应复制 Creator/CodexSource/session import rules。

## 任务日志

### 2026-05-30 03:36 阶段：目标纠偏与 binding id 收口

#### 阶段描述

把长期 rebuild 任务的红线原则写入仓库协作规范，并收尾 `ChannelBinding` 内部字段从 `codepilotSessionId` 到 `bridgeSessionId` 的命名迁移。

#### 行动条目

- 明确最终目标升级为“审计当前每一个源文件 -> 重新划分模块 -> 分阶段重构”；command 重构只作为方法样板，不能作为完成证明。
- 将红线原则写入 `AGENTS.md`，并要求关键认识、计划、扫描事实、修改和验证立即落盘到 `STATUS.md`。
- 完成 `ChannelBinding` 内部字段迁移；startup migration 仍读取旧字段并写出新字段；bindings schema 升级到 v2。

#### 阶段验证和git提交（如通过）

- 验证通过：`npm run typecheck`、聚焦迁移/schema/store/registry/router 测试 50 tests、完整 `npm test` 455 tests、`npm run build`。
- 阶段归档：`work/rebuild/STATUS-20260530-0336-final-instructions-binding-id.md`。
- 本地提交：已合并到当前 feature commit。

#### 阶段计划

- 下一阶段进入全源文件审计，先生成机器可复核的源文件清单、import/export 图、入边/出边和职责审计表。

### 2026-05-30 04:00 阶段：全源文件审计与 command/runtime 边界第一刀

#### 阶段描述

建立可复跑的全源文件审计产物，并先切断一批 bridge runtime 对 command presentation 的反向依赖。

#### 行动条目

- 生成 `work/rebuild/source-file-audit.json`、`work/rebuild/source-file-audit.md` 和审计脚本 `work/rebuild/source-audit.mjs`。
- 新增 `src/lib/bridge/command/thread-display.ts`，把 `/t` 命令专用的绑定列表响应、Codex thread rich card、绑定 rich card、绑定状态 DTO 从通用 `ThreadDisplayService` 移到 command 聚合。
- `src/lib/bridge/thread-display-resolver.ts` 从 321 行收缩到 226 行，不再 import `command/presentation.ts`。
- `src/lib/bridge/thread-table-message-pins.ts` 移到 `src/lib/bridge/command/thread-table-message-pins.ts`。
- 扩展 `src/lib/bridge/command-callbacks.ts` 为 command callback 协议层；新增 `src/lib/bridge/command-errors.ts` 承接 command user-visible error 文案。
- `bridge-manager.test.ts` 不再通过 `_testOnly` 间接测试 command presentation / aliases helper，而是直接 import 被测 helper。

#### 阶段验证和git提交（如通过）

- 验证通过：`npm run typecheck`、聚焦 96 tests、完整 `npm test` 455 tests、`npm run build`。
- 阶段归档：`work/rebuild/STATUS-20260530-0400-source-audit-command-boundary.md`。
- 本地提交：已通过 `git commit --amend --no-edit` 合并到当前 feature commit。

#### 阶段计划

- 下一阶段建立 command public facade / command ports，继续减少 `bridge-manager.ts` 和 `command/*` 对彼此内部文件的读取。

### 2026-05-30 04:03 阶段：command public facade / ports

#### 阶段描述

新增 command application public facade，让 bridge runtime 只依赖 command 对外入口，而不是读取 command 内部目录。本阶段先收窄 runtime -> command 的入口，不重写 command handler 的业务依赖。

#### 行动条目

- 新增 `src/lib/bridge/command.ts` 作为 command application public facade，导出 command text 判断、alias 解析、prompt escape、dispatch 和 global status response。
- `bridge-manager.ts` 改为只从 `./command.js` 读取 command public API，不再直接 import `command/aliases.ts`、`command/dispatch.ts`、`command/status.ts`。
- `bridge-adapter-runtime.ts` 改为从 `./command.js` 读取 `isBridgeCommandText`。
- `command-dispatch.test.ts` 的 dispatch 入口改为 public facade；保留 command 内部 presentation/alias 单元测试直接 import 内部模块。
- `work/rebuild/source-audit.mjs` 已把 `src/lib/bridge/command.ts` 标记为 Command Application public facade，允许 bridge runtime 依赖它，但仍把直接依赖 `src/lib/bridge/command/*` 视为风险。

#### 阶段验证和git提交（如通过）

- 验证通过：`npm run typecheck`；聚焦测试 `command-dispatch.test.ts`、`bridge-manager.test.ts`、`bridge-adapter-runtime.test.ts` 90 tests 全部通过。
- 审计结果：`Bridge Host / Runtime Contracts` 风险跨聚合 import 从 39 降到 34；`bridge-manager.ts` 风险跨聚合 import 从 16 降到 13；`bridge-adapter-runtime.ts` 不再有风险跨聚合 import。
- 本地提交：待本阶段后续 ports 收口完成后 amend 到当前 feature commit。

#### 阶段计划

- 继续设计 command ports，减少 command handler 对 registry/display/tmux/runtime helper 的直接读取。
- 复跑审计脚本，以风险跨聚合 import 数量和具体文件清单判断是否真正收窄边界。

### 2026-05-30 04:14 阶段：STATUS 格式整理

#### 阶段描述

按照仓库协作准则整理 `work/rebuild/STATUS.md`，把散落行动日志整理为固定结构：任务目标、当前规划、任务上下文、任务日志。

#### 行动条目

- 读取当前 git 状态，确认工作树已有多项生产代码变更和 `work/rebuild/STATUS.md` 修改；本阶段只处理 `work/rebuild` 状态文件。
- 读取整理前的 `work/rebuild/STATUS.md`，确认存在重复 `## 任务上下文`、重复 `## 行动日志`、未按 h3/h4 分层的行动流水。
- 将整理前原始状态文件复制归档为 `work/rebuild/STATUS-20260530-0414-status-format-normalization.md`。
- 重写主 `STATUS.md` 为四个 h2 主区块，并把历史流水压缩成阶段化日志。

#### 阶段验证和git提交（如通过）

- 验证通过：`grep -n '^## ' work/rebuild/STATUS.md` 仅返回四个 h2：任务目标、当前规划、任务上下文、任务日志。
- 验证通过：`grep -nE '^## 行动日志|^## 起始说明|^## 当前最新决策|^## 严格标准|^## 当前严格扫描结论' work/rebuild/STATUS.md || true` 无输出。
- 验证通过：`wc -l` 显示主 `STATUS.md` 为 199 行，本阶段归档为 540 行。
- 本地提交：本阶段随 `Normalize rebuild status format` 提交落盘，仅提交 `work/rebuild/STATUS.md` 与本阶段归档文件。

#### 阶段计划

- 验证后提交本阶段文档整理。
- 提交完成后回到 command public facade / ports 阶段继续推进。

### 2026-05-30 04:19 阶段：重新派发本地 bridge hot update

#### 阶段描述

用户反馈上一轮 `bash scripts/hot-update-bridge.sh` 没有实际派发出去，要求重新执行 hot update。

#### 行动条目

- 检查上次 hot update 日志 `/tmp/codex-to-im-logs/hot-update-20260530-041757.log`，当前读取无输出。
- 本阶段只重新派发 hot update；不执行 pull，不跳过测试，不前台停止 bridge。

#### 阶段验证和git提交（如通过）

- 已执行：从项目根目录运行 `bash scripts/hot-update-bridge.sh`。
- 脚本返回：`Dispatched Codex-to-IM hot update.`，PID `342538`。
- Hot update log：`/home/hongli.fish/.codex-to-im/logs/hot-update-20260530-041913.log`。
- Bridge log：`/home/hongli.fish/.codex-to-im/logs/bridge.log`。
- Pull requested：`no`；Tests skipped：`no`。
- 进程检查：`ps -p 342538 -o pid,ppid,stat,cmd` 显示 detached worker 正在以 `bash scripts/hot-update-bridge.sh --run` 运行。

#### 阶段计划

- 继续观察 hot update log 至 build/test/restart 完成，然后把结果回复给用户。
