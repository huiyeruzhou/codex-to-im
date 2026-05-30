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
- 2026-05-30 05:23 用户追加：重新提供 `AGENTS.md` 协作准则和当前环境；继续要求长期任务围绕 `work/<goalname>/STATUS.md` 推进，关键事实、计划、审计、验证和用户纠偏必须立即落盘；Node.js 命令使用 Node.js 24；未经明确要求不 push、不 hot update、不 redeploy。
- 2026-05-30 05:31 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须以当前工作树和状态文件为权威，不把阶段性进展重定义为整体完成。
- 2026-05-30 05:36 用户纠偏：阶段划分太稀碎，整个 UI 重构可以视为一个阶段；后续 UI server / route / query 收缩应作为同一 UI 重构阶段内的行动条目和验证点记录，不再每迁一个 UI 子模块就创建独立阶段。
- 2026-05-30 05:40 用户追加：继续推进 active thread goal；仍以 `work/rebuild` 和当前工作树为权威，保持 UI 重构作为一个阶段继续推进。
- 2026-05-30 05:47 用户追加：继续推进 active thread goal；工作目录仍是 `work/rebuild`，必须以当前工作树和状态文件为权威，继续向完整 rebuild 目标推进，不能把阶段性进展重定义为完成。
- 2026-05-30 05:53 用户反馈：当前重构推进很久但复杂度似乎没有明显减少，用户不确定这种结构是否真的更利于 AI 工作；后续重构判断必须显式考虑复杂度是否真实下降、认知入口是否更清晰、AI 是否更容易定位和修改，而不是只看文件拆分或审计数字。
- 2026-05-30 05:59 用户追加：重新提供 `AGENTS.md` 协作准则和当前环境；继续要求本仓库长期重构必须围绕 `work/<goalname>/STATUS.md` 推进，新认识/计划/审计/验证/用户纠偏要立即落盘；Node.js 命令使用 Node.js 24；未经明确要求不 push、不 hot update、不 redeploy。
- 2026-05-30 06:08 用户追加：继续推进 active thread goal；工作目录仍是 `work/rebuild`，必须以当前工作树和外部状态为权威，不把阶段性进展重定义为完成，继续向完整 rebuild 目标推进。
- 2026-05-30 06:24 用户追加：重新提供 `AGENTS.md` 协作准则和当前环境；继续要求本仓库长期重构围绕 `work/<goalname>/STATUS.md` 推进，所有新认识、计划、依赖事实、审计、验证和用户纠偏必须立即落盘；阶段完成后审计、归档并本地提交；Node.js 命令使用 Node.js 24；未经明确要求不 push、不 hot update、不 redeploy。
- 2026-05-30 06:31 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须以当前工作树和外部状态为权威，不把阶段性进展重定义为完整目标完成。
- 2026-05-30 06:37 用户纠偏：文件名和目录名也必须规整，方便 AI 查找；当前命名/放置方式会让人困惑。后续重构不只看代码职责，还要让路径、文件名和聚合入口能稳定表达“要改哪个用户故事先看哪里”。
- 2026-05-30 06:42 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和外部状态取证，继续补齐真实完成所需的验证、审计和提交，不把阶段性进展重定义为完整目标完成。
- 2026-05-30 06:53 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须以当前工作树和外部状态为权威，继续向完整 rebuild 目标推进，不能把已完成阶段重定义为整体完成。
- 2026-05-30 06:58 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树、状态文件和外部状态取证，继续完成当前阶段验证、审计和提交，不把阶段性进展重定义为完整目标完成。
- 2026-05-30 06:59 用户纠偏：单元测试有膨胀倾向，每次改代码后应先非常谨慎地审计是否存在不需要的单测，再判断是否需要新增；同时必须重视文件名和目录名，同一目录下命名应更规整，方便 AI 按用户故事定位入口。
- 2026-05-30 07:05 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须以当前工作树和状态文件为权威，继续向完整 rebuild 目标推进。
- 2026-05-30 07:12 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和状态文件取证，继续向完整 rebuild 目标推进。
- 2026-05-30 07:24 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和状态文件取证，继续向完整 rebuild 目标推进，不能把阶段性进展重定义为完整目标完成。
- 2026-05-30 07:27 用户纠偏：不能只围绕一个文件跑一大轮阶段，这太麻烦；至少要定位一个 cluster 来推进。
- 2026-05-30 07:27 用户纠偏：当前推进不断让文件变多，后续需要更多目录、清晰的分割边界，然后再审计；不能继续在同一目录里堆小 owner 文件。
- 2026-05-30 07:33 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和状态文件取证，继续向完整 rebuild 目标推进。
- 2026-05-30 07:37 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和状态文件取证，不把阶段性进展重定义为完整目标完成。
- 2026-05-30 07:43 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和状态文件取证，继续向完整 rebuild 目标推进。
- 2026-05-30 07:49 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和状态文件取证，继续向完整 rebuild 目标推进。
- 2026-05-30 07:51 用户追加：重新提供 `AGENTS.md` 协作准则和当前环境；继续要求本仓库长期重构围绕 `work/<goalname>/STATUS.md` 推进，所有新认识、计划、依赖事实、审计、验证和用户纠偏必须立即落盘；阶段完成后审计并本地提交；Node.js 命令使用 Node.js 24；未经明确要求不 push、不 hot update、不 redeploy。
- 2026-05-30 07:58 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和外部状态取证，继续向完整 rebuild 目标推进，不把阶段性进展重定义为完整目标完成。
- 2026-05-30 08:07 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和外部状态取证，继续向完整 rebuild 目标推进，不把阶段性进展重定义为完整目标完成。
- 2026-05-30 08:19 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和外部状态取证，不把阶段性进展重定义为完整目标完成；若完整目标未被逐项证明，不得标记 goal complete。
- 2026-05-30 08:29 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和外部状态取证，继续向完整 rebuild 目标推进，不把阶段性进展重定义为完整目标完成。
- 2026-05-30 08:36 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和外部状态取证，继续向完整 rebuild 目标推进，不把阶段性进展重定义为完整目标完成。
- 2026-05-30 08:41 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和外部状态取证，继续向完整 rebuild 目标推进，不把阶段性进展重定义为完整目标完成。
- 2026-05-30 08:48 用户纠偏：`src/lib/bridge/interactive-turn/` 下有些文件可能没必要单独成文件，应考虑用更直接的前缀命名或合并；`turns` 与 `interactive-turn` 的关系不清楚；`src/lib/bridge/interactive-turn-composition.ts` 这种大依赖注入可读性存疑；不要为了重构而制造同前缀但分散在外层的文件，命名和目录必须让人一眼知道为什么放在那里。
- 2026-05-30 08:56 用户强纠偏：`src/lib/bridge/interactive-turn/composition.ts` 是不可接受的依赖注入堆叠，严禁继续写这种莫名其妙的 composition 文件。必须删除该抽象，不能把复杂度从 `bridge-manager.ts` 换壳搬到 `composition.ts`。
- 2026-05-30 09:00 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和状态文件取证，继续向完整 rebuild 目标推进，不把阶段性进展重定义为完整目标完成。
- 2026-05-30 09:02 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和外部状态取证，继续向完整 rebuild 目标推进，不把阶段性进展重定义为完整目标完成，若完整目标未逐项证明则不得标记 goal complete。
- 2026-05-30 09:04 用户纠偏：不要每改一个文件就 commit；改完一个文件后应立刻查相同问题，判断能否在同一阶段改更多同类问题。后续阶段边界应覆盖一个合理 cluster，而不是单文件收口。
- 2026-05-30 09:05 用户纠偏：全量测试也不要每改一个文件就跑；应等一个模块阶段改完后再跑一遍，避免耗时。后续验证采用分层策略：修改中跑定向测试/类型检查/审计，阶段收口时再跑全量测试。
- 2026-05-30 09:08 用户追加：当前 interactive-turn/turns 小文件合并任务收口后，列出当前 `src` 底下的 `.ts` 和 `src/lib/bridge` 底下的 `.ts` 文件名；对明显长得像、职责相关的文件，审计能否放进同一个文件夹，并让 `lib/bridge` 和 `src` 中的文件形成更清晰的一一对应关系。
- 2026-05-30 09:22 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须以当前工作树和外部状态为权威，不把阶段性进展重定义为完整目标完成。
- 2026-05-30 09:24 用户追加：可以先把过去几十个本轮重构 commit 全部 amend/squash；执行前必须保留当前未完成的 UI session WIP 和用户侧 `AGENTS.md` 改动，不把未验证 WIP 混入已完成阶段提交。
- 2026-05-30 09:31 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和外部状态取证，继续向完整 rebuild 目标推进，不把阶段性进展重定义为完整目标完成。
- 2026-05-30 09:35 用户纠偏：之前的 `STATUS.md` 规划可能仍基于旧依赖图；需要重新跑依赖检查，更新依赖检查代码，并基于新 cluster 分析潜在聚合可能；分析和后续重构必须规避之前明确反对的“屎山写法”，尤其不要用大而空的 composition/依赖注入堆叠掩盖复杂度。
- 2026-05-30 09:36 用户追加：重新提供 `AGENTS.md` 协作准则和当前环境；继续要求本仓库长期重构围绕 `work/<goalname>/STATUS.md` 推进，所有新认识、计划、依赖事实、审计、验证和用户纠偏必须立即落盘；阶段完成后审计、归档并本地提交；Node.js 命令使用 Node.js 24；未经明确要求不 push、不 hot update、不 redeploy。
- 2026-05-30 09:47 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须以当前工作树和外部状态为权威，继续向完整 rebuild 目标推进，不把阶段性进展重定义为完成。
- 2026-05-30 09:56 用户追加：继续推进 active thread goal；必须从当前工作树和 `work/rebuild/STATUS.md` 恢复，继续以当前状态为权威推进，不把当前阶段 WIP 视为完整目标完成。
- 2026-05-30 09:57 用户追加：要求尽快 hot update 本地 bridge 以检查功能是否混乱；本次 hot update 不包含 pull，且因为当前阶段 WIP 尚未完整跑过全量测试，不使用 `--skip-tests`。
- 2026-05-30 10:00 用户追加：现在基本可以做本轮重构收尾；最后一个工作是逐个阅读文件，检查是否存在“屎山级别的不合理抽象”，如果有就标注出来。
- 2026-05-30 10:09 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和外部状态取证，继续完成当前长期 rebuild 目标，不把阶段性进展重定义为完整完成。
- 2026-05-30 10:25 用户追加：重新提供 `AGENTS.md` 协作准则和当前环境；继续要求本仓库长期重构围绕 `work/<goalname>/STATUS.md` 推进，所有新认识、计划、依赖事实、审计、验证和用户纠偏必须立即落盘；阶段完成后审计、归档并本地提交；Node.js 命令使用 Node.js 24；未经明确要求不 push、不 hot update、不 redeploy。
- 2026-05-30 10:31 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须以当前工作树和状态文件为权威，继续完成收尾审计，不把阶段性进展重定义为完整完成。
- 2026-05-30 10:49 用户追加：继续推进 active thread goal；工作目录是 `work/rebuild`，必须从当前工作树和外部状态取证，继续完成真实目标，不把阶段性进展重定义为完整完成。

## 任务上下文

### 工作目录和权威文件

- 当前工作目录：`/data00/home/hongli.fish/Codex/codex-to-im`
- 本轮 rebuild 工作目录：`work/rebuild`
- 本轮 rebuild 主状态文件：`work/rebuild/STATUS.md`
- 当前架构入口：`docs/current-architecture.md`
- 历史分析入口：`work/analysis/STATUS.md`
- 全源文件审计产物：`work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md`
- 混合簇边界审计产物：`work/rebuild/mixed-cluster-boundary-audit.md`
- 不合理抽象收尾审计产物：`work/rebuild/abstraction-smell-audit.md`
- 审计脚本：`work/rebuild/source-audit.mjs`
- 前序 rebuild feature commit 主题：`Add session display and registry rebuild slice`
- 最近提交：`Rebuild source architecture`（当前 HEAD；hash 会随后续 amend 改变），由 `origin/master..52e7f7b` 的 35 个本地重构/文档提交 squash 后继续 amend 当前 command provider boundary 阶段而成；未 push。
- 当前工作树仅剩用户侧 `AGENTS.md` 未提交改动；这是用户侧协作规范更新，不属于当前 rebuild 提交范围。

### 已归档状态材料

- `work/rebuild/STATUS-20260530-0336-final-instructions-binding-id.md`
- `work/rebuild/STATUS-20260530-0400-source-audit-command-boundary.md`
- `work/rebuild/STATUS-20260530-0414-status-format-normalization.md`
- `work/rebuild/STATUS-20260530-0422-status-format-v2.md`
- `work/rebuild/STATUS-20260530-0435-natural-clustering-audit.md`
- `work/rebuild/STATUS-20260530-0442-mixed-cluster-boundary.md`
- `work/rebuild/STATUS-20260530-0449-ui-service-routes.md`
- `work/rebuild/STATUS-20260530-0513-ui-config-ast-function-audit.md`
- `work/rebuild/STATUS-20260530-0521-ui-channel-routes.md`
- `work/rebuild/STATUS-20260530-0529-ui-weixin-login-routes.md`
- `work/rebuild/STATUS-20260530-0554-ui-rebuild-stage-audit.md`
- `work/rebuild/STATUS-20260530-0601-cluster-01-mirror-runtime-context-port.md`
- `work/rebuild/STATUS-20260530-0606-stream-feedback-finalization-owner.md`
- `work/rebuild/STATUS-20260530-0622-interactive-stream-ui-controller.md`
- `work/rebuild/STATUS-20260530-0628-interactive-terminal-finalization.md`
- `work/rebuild/STATUS-20260530-0645-final-response-delivery-owner.md`
- `work/rebuild/STATUS-20260530-0651-interactive-turn-environment.md`
- `work/rebuild/STATUS-20260530-0703-interactive-sdk-stream-events.md`
- `work/rebuild/STATUS-20260530-0710-interactive-sdk-conversation-engine.md`
- `work/rebuild/STATUS-20260530-0717-interactive-sdk-attachments-owner.md`
- `work/rebuild/STATUS-20260530-0723-interactive-sdk-stream-preview.md`
- `work/rebuild/STATUS-20260530-0735-interactive-turn-directory-boundaries.md`
- `work/rebuild/STATUS-20260530-0741-interactive-turn-permission-port.md`
- `work/rebuild/STATUS-20260530-0747-interactive-turn-stop-callback-port.md`
- `work/rebuild/STATUS-20260530-0806-interactive-turn-environment-display-port.md`
- `work/rebuild/STATUS-20260530-0818-interactive-turn-settings-port.md`
- `work/rebuild/STATUS-20260530-0827-interactive-sdk-runtime-port.md`
- `work/rebuild/STATUS-20260530-0834-interactive-structured-stream-feedback-port.md`
- `work/rebuild/STATUS-20260530-0824-interactive-turn-environment-resolver-port.md`
- `work/rebuild/STATUS-20260530-0845-interactive-turn-composition-factory.md`
- `work/rebuild/STATUS-20260530-0858-interactive-turn-naming-correction.md`
- `work/rebuild/STATUS-20260530-0908-interactive-turn-small-file-merge.md`
- `work/rebuild/STATUS-20260530-0921-src-lib-bridge-folder-alignment.md`
- `work/rebuild/STATUS-20260530-0928-ui-session-source-boundary.md`
- `work/rebuild/STATUS-20260530-0940-session-registry-binding-owner-alignment.md`
- `work/rebuild/STATUS-20260530-0946-session-registry-query-facade.md`
- `work/rebuild/STATUS-20260530-1014-command-provider-boundary.md`

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

### 复杂度价值判断原则

- 文件变短不是重构价值证明。必须判断复杂度是否被消除，而不是被搬到更多文件。
- 阶段审计需要区分入口复杂度、局部修改复杂度、业务 invariant 分散程度、测试定位成本和跨模块跳转成本。
- 对 AI 友好的结构不是文件越小越好，而是“要改某个用户故事应先看哪里”的答案稳定，且 public facade / application service 明确。
- 对 AI 友好的结构也要求文件名和目录名规整：同一用户故事族的文件应在可预测目录下，文件名要表达 owner 和职责，避免 `interactive-*`、`turns/*`、`runner` 等概念交叉后让入口不可猜。
- 2026-05-30 08:56 用户强纠偏后新增判断：`interactive-turn-composition.ts` / `interactive-turn/composition.ts` 这类大依赖注入中转文件应删除；如果 `runInteractiveMessage` 入口依赖过宽，正确方向是重审 runner 职责和端口本身，而不是再造一个 composition facade。
- 后续重构优先减少状态机和跨层读取，集中业务规则 owner；避免继续用机械拆分追求审计数字好看。

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
- UI Weixin login route 迁出后最新审计：187 个 `src/**/*.ts` 文件，其中生产 126 个、测试 61 个；本地 import / re-export 边 727 条。`src/ui-server.ts` 从 3940 行降到 3819 行；新增 `src/ui-weixin-login-routes.ts` 211 行、`src/__tests__/ui-weixin-login-routes.test.ts` 200 行；`handleUiWeixinLoginApiRoute` 函数体 92 行，当前仍有 Local UI -> Weixin login workflow 依赖，后续可用更窄 port 继续收缩。
- UI auth/access route 迁出后最新审计：191 个 `src/**/*.ts` 文件，其中生产 128 个、测试 63 个；本地 import / re-export 边 741 条；函数节点 1553 个；函数依赖边 1776 条，其中内聚 1514、外聚 262。`src/ui-server.ts` 从 3627 行降到 3384 行；新增 `src/ui-auth-routes.ts` 325 行、`src/__tests__/ui-auth-routes.test.ts` 174 行；`src/ui-auth-routes.ts` 风险跨聚合 import 为 0。
- UI shell 迁出后最新审计：192 个 `src/**/*.ts` 文件，其中生产 129 个、测试 63 个；本地 import / re-export 边 742 条；函数节点 1553 个；函数依赖边 1776 条，其中内聚 1514、外聚 262。`src/ui-server.ts` 从 3384 行降到 234 行；新增 `src/ui-shell.ts` 3152 行；`renderUiShellHtml` 仍是 3148 行静态 shell 大函数但外聚度为 0，`src/ui-server.ts` 现在聚焦 route composition / server lifecycle。
- Mirror runtime 去全局 context 依赖后最新审计：192 个 `src/**/*.ts` 文件，其中生产 129 个、测试 63 个；本地 import / re-export 边 740 条；函数节点 1553 个；函数依赖边 1772 条，其中内聚 1514、外聚 258。`src/lib/bridge/mirror-runtime.ts` 不再 import `context.ts`，Mirror Runtime -> Bridge Host / Runtime Contracts 聚合依赖从 10 降到 9；`src/__tests__/mirror-runtime.test.ts` 不再初始化全局 bridge context。
- Stream feedback finalization owner 收缩后最新审计：192 个 `src/**/*.ts` 文件，其中生产 129 个、测试 63 个；本地 import / re-export 边 740 条；函数节点 1551；函数依赖边 1771，其中内聚 1514、外聚 257。`src/lib/bridge/turns/delivery-pipeline.ts` 不再 import `stream-feedback-controller.ts`；`Interactive Turn Runtime` 风险跨聚合 import 从 4 降到 3，`cluster-01` 内部跨聚合边从 100 降到 99。
- Interactive structured stream UI controller 收缩后最新审计：193 个 `src/**/*.ts` 文件，其中生产 130 个、测试 63 个；本地 import / re-export 边 744 条；函数节点 1551；函数依赖边 1755，其中内聚 1499、外聚 256。`runInteractiveMessage` 从 731 行降到 641 行，外聚度保持 5；新增 `src/lib/bridge/interactive-stream-ui.ts` 214 行，`createInteractiveStreamUiController` 138 行、外聚度 0。该阶段改善 structured stream UI 生命周期的认知入口，但没有带来全局依赖图净下降。
- Interactive terminal finalization controller 收缩后最新审计：195 个 `src/**/*.ts` 文件，其中生产 131 个、测试 64 个；本地 import / re-export 边 746 条；函数节点 1550；函数依赖边 1754，其中内聚 1498、外聚 256。`runInteractiveMessage` 从 641 行降到 574 行，外聚度保持 5；新增 `src/lib/bridge/interactive-terminal-finalization.ts` 125 行，controller 外聚度 0；新增 focused controller test。本阶段改善 external terminal finalization 状态 owner，但没有带来全局依赖图净下降。
- Final response delivery owner 和 interactive turn 目录规整后最新审计：197 个 `src/**/*.ts` 文件，其中生产 132 个、测试 65 个；本地 import / re-export 边 751 条；函数节点 1554；函数依赖边 1759，其中内聚 1496、外聚 263。`src/lib/bridge/interactive-turn/` 成为 interactive IM turn 用户故事族入口，4 文件 / 1328 行；`runInteractiveMessage` 位于 `interactive-turn/runner.ts`，函数体 525 行、外聚度 7。`Bridge Host / Runtime Contracts` 被重新归类后为 23 文件 / 5557 行 / 29 条风险跨聚合 import，`Interactive Turn Runtime` 为 12 文件 / 1907 行 / 14 条风险跨聚合 import。本阶段改善命名和 final response 决策 owner，但未降低全局依赖图，后续仍需收窄 runner 对 host/context/router/engine/delivery 的端口。
- Interactive turn environment 收口后最新审计：198 个 `src/**/*.ts` 文件，其中生产 133 个、测试 65 个；本地 import / re-export 边 755 条；函数节点 1555；函数依赖边 1755，其中内聚 1492、外聚 263。`runner.ts` 从 845 行降到 759 行，直接 import 数从 22 降到 16；`runInteractiveMessage` 函数体 524 行，外聚度从 7 降到 4。新增 `src/lib/bridge/interactive-turn/turn-environment.ts` 131 行，集中路由绑定解析、全局 store 读取、Codex thread classify、stream 设置、display metadata 和 stale binding notice。聚合层面 `Interactive Turn Runtime` 仍为 13 文件 / 1952 行 / 14 条风险跨聚合 import，说明本阶段降低 runner 入口复杂度，但没有降低聚合总耦合。
- Interactive SDK stream events owner 收口后最新审计：200 个 `src/**/*.ts` 文件，其中生产 134 个、测试 66 个；本地 import / re-export 边 767 条。`src/lib/bridge/interactive-turn/runner.ts` 从 759 行降到 623 行，直接 import 数保持 16，风险跨聚合 import 保持 4；`runInteractiveMessage` 函数体从 524 行降到 426 行，外聚度从 4 降到 3。新增 `src/lib/bridge/interactive-turn/sdk-stream-events-controller.ts` 204 行，`createInteractiveSdkStreamEventsController` 函数体 113 行、外聚度 0。`Interactive Turn Runtime` 为 14 文件 / 2020 行 / 15 条风险跨聚合 import，说明本阶段降低 runner 事件状态复杂度和入口认知成本，但没有降低聚合总耦合，下一步仍需端口化 execution/permission/delivery 边界。
- Interactive SDK conversation engine owner 收口后最新审计：200 个 `src/**/*.ts` 文件，其中生产 134 个、测试 66 个；本地 import / re-export 边 767 条。`src/lib/bridge/conversation-engine.ts` 移入 `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts`，测试重命名为 `interactive-turn-sdk-conversation-engine.test.ts`，没有新增测试数量。`Bridge Host / Runtime Contracts` 从 23 文件 / 5557 行 / 风险 29 降到 22 文件 / 4834 行 / 风险 27；`Interactive Turn Runtime` 从 14 文件 / 2020 行 / 风险 15 变为 15 文件 / 2743 行 / 风险 17；`runner.ts` 风险跨聚合 import 从 4 降到 3。阶段收益是 Bridge Host catch-all 面积缩小、SDK 执行 owner 更清楚；代价是 Interactive Turn Runtime 变胖，后续需在该聚合内部继续整理 `sdk-conversation-engine.ts` 的 stream reducer / attachment persistence / runtime options。
- Interactive SDK attachments owner 收口后最新审计：201 个 `src/**/*.ts` 文件，其中生产 135 个、测试 66 个；本地 import / re-export 边 770 条；函数节点 1557。新增 `src/lib/bridge/interactive-turn/sdk-attachments.ts` 110 行，承接 attachment metadata、`<!--files:JSON-->` 本地持久化格式、非图片附件 prompt supplement 和 LLM file path 回填；`src/lib/bridge/interactive-turn/sdk-conversation-engine.ts` 为 646 行，不再直接 import `fs` / `path`，`processMessage` 函数体从 226 行降到 181 行。`Interactive Turn Runtime` 为 16 文件 / 2776 行 / 风险 17，说明本阶段降低 SDK engine 入口复杂度和文件格式 owner 混杂，但没有降低聚合总风险。
- Interactive SDK stream preview owner 收口后最新审计：202 个 `src/**/*.ts` 文件，其中生产 136 个、测试 66 个；本地 import / re-export 边 772 条；函数节点 1561。新增 `src/lib/bridge/interactive-turn/sdk-stream-preview.ts` 83 行，承接 `appendStreamPreviewChunk`、inline tool block markdown 和 reasoning note quote rendering；`sdk-conversation-engine.ts` 从 646 行降到 573 行，直接 import 从 10 降到 8，风险跨聚合 import 从 3 降到 1，`processMessage` 函数体从 181 行降到 110 行。自然聚类将 `src/lib/bridge/interactive-turn` 识别为 `cluster-05`（8 文件 / 2076 行 / 出边 33 / 入边 11），说明 interactive turn 目录入口独立性改善；但 `consumeStream` 仍为 305 行，聚合总风险仍为 17。
- Interactive turn permission forwarding 端口收缩后最新审计：202 个 `src/**/*.ts` 文件，其中生产 136 个、测试 66 个；本地 import / re-export 边从 772 降到 771；`Interactive Turn Runtime` 风险跨聚合 import 从 17 降到 16；`runner.ts` 直接 import 从 16 降到 15，风险 import 从 3 降到 2；`runInteractiveMessage` 外聚度从 2 降到 1。`runner.ts` 不再直接 import `permission-broker.ts`，由 `bridge-manager.ts` 通过 `ForwardPermissionRequest` 端口注入。
- Interactive turn stop callback 端口收缩后最新审计：202 个 `src/**/*.ts` 文件，其中生产 136 个、测试 66 个；本地 import / re-export 边从 771 降到 769；`Interactive Turn Runtime` 风险跨聚合 import 从 16 降到 15；`runner.ts` 直接 import 从 15 降到 14，风险 import 从 2 降到 1；`runInteractiveMessage` 外聚度从 1 降到 0。`runner.ts` 不再直接 import `command-callbacks.ts`，由 `bridge-manager.ts` 通过 `BuildStopCallbackData` 端口注入。
- Interactive turn environment display/stale 端口收缩后最新审计：202 个 `src/**/*.ts` 文件，其中生产 136 个、测试 66 个；本地 import / re-export 边从 769 降到 768；`Interactive Turn Runtime` 风险跨聚合 import 从 15 降到 14；`src/lib/bridge/interactive-turn/environment/turn-environment.ts` 不再 import `thread-display-resolver.ts`，display metadata 和 stale binding list 由 `bridge-manager.ts` 通过 `ResolveInteractiveTurnDisplayInfo` / `ListInteractiveTurnBindings` 端口注入。`resolveInteractiveTurnEnvironment` 仍直接依赖 router/context/session support，说明 environment 尚未全端口化。
- Interactive turn environment resolver 端口收缩后最新审计：202 个 `src/**/*.ts` 文件，其中生产 136 个、测试 66 个；本地 import / re-export 边从 768 到 769；`Interactive Turn Runtime` 风险跨聚合 import 从 14 降到 12；`Bridge Host / Runtime Contracts` 风险跨聚合 import 从 27 到 28；`cluster-01` 内部跨聚合边从 106 降到 105。`turn-environment.ts` 不再 import `channel-router.ts` / `bridge-session-support.ts`，通过 `ResolveInteractiveTurnEnvironmentPorts` 注入 `resolveBinding`、`getBridgeSession`、`codexThreadExists`；`bridge-manager.ts` 作为 composition root 承接这些外部事实读取。
- Interactive turn composition factory 收束后最新审计：204 个 `src/**/*.ts` 文件，其中生产 138 个、测试 66 个；本地 import / re-export 边从 774 到 776；`Bridge Host / Runtime Contracts` 风险跨聚合 import 保持 28，`Interactive Turn Runtime` 风险跨聚合 import 保持 10。`bridge-manager.ts` 行数从 1341 降到 1310、直接 import 从 34 降到 31、文件风险跨聚合 import 从 15 降到 13、`handleMessage` 函数体从 339 行降到 298 行；新增 `src/lib/bridge/interactive-turn-composition.ts` 120 行，作为 Bridge Host 侧 interactive turn host wiring owner。
- Interactive turn naming correction 后最新审计：203 个 `src/**/*.ts` 文件，其中生产 137 个、测试 66 个；本地 import / re-export 边回到 774；`src/lib/bridge/interactive-turn-composition.ts` / `interactive-turn/composition.ts` 已删除；`src/lib/bridge/interactive-turn/` 下无子目录，统一扁平为前缀文件。`bridge-manager.ts` 回到 1341 行、34 个本地 import、15 条文件风险跨聚合 import；`Interactive Turn Runtime` 为 18 文件 / 2956 行 / 风险 10。阶段判断：删除 composition 避免伪抽象，代价是 runner deps 宽度重新暴露；后续必须改 runner 职责/接口，而不是再造 composition 中转。
- Interactive turn small-file merge 后最新审计：201 个 `src/**/*.ts` 文件，其中生产 135 个、测试 66 个；本地 import / re-export 边 767；`Interactive Turn Runtime` 为 16 文件 / 2946 行 / 风险跨聚合 import 9。删除 `stream-feedback-port.ts` 与 `turns/final-response-artifacts.ts`，将 structured stream feedback 适配并入 `stream-ui-controller.ts`，将 final response artifact 解析/附件去重并入 `response-assembler.ts`。阶段收益是减少两个单一 owner 小文件并降低 interactive turn/turns 文件碎片；不宣称解决 runner/bridge host 根耦合。
- `src` / `lib/bridge` 目录规整后最新审计：201 个 `src/**/*.ts` 文件，其中生产 135 个、测试 66 个；本地 import / re-export 边 767。顶层 `src/*.ts` 从 33 个降到 14 个；`src/ui-*` 收入 `src/ui/` 与 `src/ui/routes/`，`codex-*` 收入 `src/codex/`，Weixin adapter 收入 `src/lib/bridge/adapters/`，Weixin login/store 收入 `src/weixin/`。阶段收益是让 UI / Local Codex / platform adapters / Weixin support 的文件路径和用户故事入口更可预测；代价是 source audit 重新归类后若干风险跨聚合 import 更显性，后续应继续用端口/应用服务降低直接依赖。

### 当前架构判断

- Identity / Display 规则仍然是高优先级边界；display query / Creator / session title 已进入 `src/lib/bridge/display/`，但仍需继续避免 command/UI/runtime 各自复制规则。
- Session / Binding Registry 是大模块，不是 util。Registry 应拥有 session/binding/default target mutation use cases，不应直接 import config 或 local Codex scanner。
- Local Codex Session Index 是独立基础设施大模块。它应保留胖模块形态，但内部继续拆成紧凑子模块；对外只暴露 list/get/read history/read mirror delta/archive/import metadata 等窄接口。
- Interactive Turn Runtime 和 Mirror Runtime 应保持分离。两者可共享 display query、delivery contracts、stream feedback primitives，不共享 turn state machine、cursor/suppression、provider SSE parsing。`turns/` 当前更接近“Bridge turn shared primitives”（turn classification/coordinator/final response assembly/delivery/stream state/terminal routing），`interactive-turn/` 更接近“IM inbound interactive turn application flow”（runner、SDK conversation、stream UI、terminal finalization、environment）；二者命名关系需要继续规整，不能让读者误以为是平级但重叠的两个 turn 模块。
- Command Layer 是 use-case switchboard。command 不应按每个命令随意拆小文件，应按用户故事族形成胖而紧凑的 command module，并分离 command execution 与 command rendering。
- Channel Delivery / Adapter 要分清可共享和不可共享。共享 delivery contract、chunk/retry/dedup/audit、rich card IR、stream feedback contract、attachment contract；不共享 Feishu/Weixin 平台协议细节。
- Local UI 是 operator workflow，不是 domain owner。UI server 应收缩成 composition root + route declarations + static UI shell，UI route 不应复制 Creator/CodexSource/session import rules。
- 自然聚类显示，当前最高优先级不应是继续细抠 command 内部，而是先处理 `cluster-01` 和 `cluster-02` 这两个混合簇：它们分别暴露 bridge host/delivery/mirror/turn/registry 纠缠，以及 local UI/config/service/store 纠缠。
- `cluster-02` 的 UI server 收缩阶段已经把 `ui-server.ts` 收缩为 route composition / server lifecycle。它改善了入口复杂度和局部测试边界，但没有消除整个系统的核心复杂度；`ui-shell.ts` 仍保留大块静态前端 shell，`cluster-01` 的 mirror / turn / delivery / bridge host 纠缠仍是更大的结构性风险。

### 当前阶段计划

- `abstraction smell closing audit` 已完成并 amend 到当前 `Rebuild source architecture` feature commit。`work/rebuild/abstraction-smell-audit.md` 已覆盖当前 137 个生产 `.ts` / `.d.ts` 文件，标注 1 个 S1 和 28 个 S2 不合理抽象风险；后续若继续 rebuild，应从该 S1/S2 清单中选择 cluster 级问题推进。

## 任务日志

### 2026-05-30 10:19 阶段：abstraction smell closing audit

> 阶段描述：根据用户 10:00 收尾要求，逐个阅读 `src` 下生产 `.ts` 文件，检查是否存在“屎山级别的不合理抽象”，并将证据、影响和处置建议落盘到 `work/rebuild/abstraction-smell-audit.md`。

- 行动条目：
  - 2026-05-30 10:53 当前进入阶段审计：原始逐批阅读记录、恢复取证、覆盖校验脚本纠正和验证输出已归档到 `work/rebuild/STATUS-20260530-1047-abstraction-smell-closing-audit.md`。本阶段新增 `work/rebuild/abstraction-smell-audit.md`，逐文件初判当前 137 个生产 `.ts` / `.d.ts` 文件；标注 1 个 S1 问题（`bridge-session-support.ts` catch-all support/helper）和 28 个 S2 问题，集中在 runner deps 过宽、service/context/contracts catch-all、平台 adapter/base adapter 过载、command/UI/service workflow 混合 owner、文件名与职责不一致等风险。本阶段没有修改生产代码，结论是这些问题应作为后续处置清单保留，不在收尾审计阶段继续展开重构。
- 阶段验证和git提交（如通过）：
  - 已通过：修正后的覆盖脚本显示 `src_count=137`、`audited_count=137`、`missing=0`、`extra=0`、`duplicate=0`。
  - 已通过：S1/S2 标注计数为 29，其中 S1 为 1、S2 为 28。
  - 已通过：`git diff --check -- work/rebuild/STATUS.md work/rebuild/abstraction-smell-audit.md work/rebuild/STATUS-20260530-1047-abstraction-smell-closing-audit.md`。
  - 已通过：`grep -n '[[:blank:]]$' work/rebuild/abstraction-smell-audit.md work/rebuild/STATUS-20260530-1047-abstraction-smell-closing-audit.md work/rebuild/STATUS.md` 无输出。
  - 阶段归档：`work/rebuild/STATUS-20260530-1047-abstraction-smell-closing-audit.md`。
  - 本地提交：已通过 `git commit --amend --no-edit` 合并到当前 `Rebuild source architecture` feature commit，保留用户侧 `AGENTS.md` 未提交改动。
- 下一个阶段计划：
  - 若本地 amend 成功，本轮用户 10:00 指定的收尾审计已完成；后续若继续 rebuild，应从 `abstraction-smell-audit.md` 的 S1/S2 清单中选择一个 cluster 级问题推进，而不是继续零散单文件修改。

### 2026-05-30 08:47 阶段：session application boundary audit

> 阶段描述：继续 `cluster-01`，聚焦 `src/ui/application/session.ts` 与 `src/lib/bridge/session-registry.ts` 的边界；审计 UI session application 是否混入 Codex index 读取、display query 和 registry mutation composition，选择能让“查看/导入/配置会话”用户故事入口更稳定的一刀，避免继续给 `bridge-manager.ts` 堆 composition 小文件。

- 行动条目：
  - 2026-05-30 08:47 已开启新阶段。当前 HEAD 为 `Extract interactive turn composition runner`；工作树仅剩用户侧 `AGENTS.md` 未提交改动。第一轮读取 `session-bindings.ts`、`ui-session-history.ts`、`src/ui/application/session.ts`、`SessionRegistryService` 和 source audit 后纠正假设：最新审计中 `session-bindings.ts` 为 `cluster-03`、`ui-session-history.ts` 为 `cluster-03`，真正仍在 `cluster-01` 的是 `src/ui/application/session.ts`（287 行 / 7 import / 风险 2）和 `src/lib/bridge/session-registry.ts`（205 行 / 4 import / 风险 0）。因此本阶段转为审计 UI session application 是否应提取 Codex session source / registry composition，而不是直接改 `session-bindings.ts`。
  - 2026-05-30 08:50 第二轮审计显示 `UiSessionApplication` 同时承担 HTTP-facing use cases、Codex session index 文件读取、Codex history rendering source、默认模型读取、registry port composition 和 session config sanitization；`SessionRegistryService` 已经有 `codexThreads` port，不应把 Codex index 细节继续留在 UI application 主文件里。下一步新增 UI 本地 `session-codex-source.ts`，集中 list/get/history/archive/default model/root 这些 Local Codex Session Index 访问；`UiSessionApplication` 改为依赖该 source port，并继续把 mutation 交给 `SessionRegistryService`。
- 阶段验证和git提交（如通过）：
  - 2026-05-30 08:48 用户纠偏打断本阶段；本阶段只保留审计事实，不提交代码修改。
- 下一个阶段计划：
  - 转入 `interactive turn naming correction`，先修正 interactive turn / turns 命名和 composition 放置问题。

### 2026-05-30 08:48 阶段：interactive turn naming correction

> 阶段描述：回应用户纠偏，停止继续制造小文件；审计 `interactive-turn/`、`turns/` 和 `interactive-turn-composition.ts` 的命名/目录/可读性问题，删除不可接受的大依赖注入中转层，保留扁平前缀命名，再判断是否需要合并 `interactive-turn/` 内的小文件。

- 行动条目：
  - 2026-05-30 08:58 当前进入阶段审计：原始行动、用户纠偏、验证摘要和阶段反思已归档到 `work/rebuild/STATUS-20260530-0858-interactive-turn-naming-correction.md`。本阶段删除 `src/lib/bridge/interactive-turn-composition.ts` / `interactive-turn/composition.ts` 中转层，撤回大依赖注入方向；同时把 `interactive-turn/` 下的 `environment/`、`response/`、`sdk/`、`stream/`、`terminal/` 单文件子目录全部扁平化为前缀文件。最新审计显示源文件 204 -> 203，import 边回到 774；代价是 `bridge-manager.ts` 恢复直接构造 `runInteractiveMessage` deps，说明后续若要降低复杂度，必须改 runner 接口和职责本身。
- 阶段验证和git提交（如通过）：
  - 已通过：interactive-turn / bridge-manager targeted tests，103 tests / 16 suites 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0858-interactive-turn-naming-correction.md`。
  - 本地提交：amend 为 `Flatten interactive turn module boundaries`。
- 下一个阶段计划：
  - 下一阶段如继续 interactive turn，直接审计 `runInteractiveMessage` deps 过宽的真实原因，或审计 `stream-feedback-port.ts` 是否应合并进 `stream-ui-controller.ts` / `sdk-stream-events-controller.ts`；禁止再创建 composition facade。

### 2026-05-30 09:00 阶段：interactive turn small-file merge audit

> 阶段描述：继续 interactive turn 纠偏，先合并 `stream-feedback-port.ts` 这类小文件噪声；根据用户 09:04 纠偏，本阶段不按单文件提交，而是继续审计 `interactive-turn/` 和相邻 `turns/` 的同类小文件，选择能降低入口碎片且不制造 composition facade 的合并。

- 行动条目：
  - 2026-05-30 09:08 当前进入阶段审计：原始行动、依赖事实、同类小文件审计结论和验证摘要已归档到 `work/rebuild/STATUS-20260530-0908-interactive-turn-small-file-merge.md`。本阶段删除 `stream-feedback-port.ts` 与 `turns/final-response-artifacts.ts`，把 structured stream feedback 适配收回 `stream-ui-controller.ts`，把 final response artifact 解析/附件去重收回 `response-assembler.ts`；同时审计 `interactive-turn/` 与 `turns/` 剩余短文件，确认 `terminal-finalization-controller.ts`、`final-response-plan.ts`、`sdk-attachments.ts`、`sdk-stream-preview.ts` 和 shared turn primitives 仍有独立 owner，不应为减少文件数而合并。
- 阶段验证和git提交（如通过）：
  - 2026-05-30 09:03 已通过：`node --test --import tsx src/__tests__/interactive-turn-sdk-stream-events-controller.test.ts src/__tests__/interactive-turn-runner.test.ts src/__tests__/bridge-manager.test.ts`，89 tests / 11 suites 全部通过。
  - 2026-05-30 09:07 已通过：`node --test --import tsx src/__tests__/interactive-turn-sdk-stream-events-controller.test.ts src/__tests__/interactive-turn-sdk-conversation-engine.test.ts src/__tests__/interactive-turn-runner.test.ts src/__tests__/response-assembler.test.ts src/__tests__/delivery-pipeline.test.ts src/__tests__/bridge-manager.test.ts`，101 tests / 16 suites 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0908-interactive-turn-small-file-merge.md`。
  - 本地提交：amend 到 `Flatten interactive turn module boundaries`。
- 下一个阶段计划：
  - 进入 `src/lib bridge naming and folder alignment audit`：按用户 09:08 指令列出 `src/*.ts` 与 `src/lib/bridge/**/*.ts` 文件名，找相似前缀/职责文件是否应进同一文件夹，并让 `src` 与 `lib/bridge` 的入口关系更可预测。

### 2026-05-30 09:09 阶段：src/lib bridge naming and folder alignment audit

> 阶段描述：按用户 09:08 指令，列出当前 `src/*.ts` 和 `src/lib/bridge/**/*.ts` 文件名，按明显相似前缀和职责审计目录规整机会；优先选择一个能让顶层 `src` 与 `lib/bridge` 入口关系更可预测的切片，而不是继续单文件搬动。

- 行动条目：
  - 2026-05-30 09:21 当前进入阶段审计：原始清单、迁移记录、路径修复、测试摘要和阶段判断已归档到 `work/rebuild/STATUS-20260530-0921-src-lib-bridge-folder-alignment.md`。本阶段将顶层 UI 文件收入 `src/ui/`，将 Weixin adapter 与 helper 收入 `src/lib/bridge/adapters/`，将 Local Codex source / execution provider 收入 `src/codex/`，将 Weixin login/store 收入 `src/weixin/`；顶层 `src/*.ts` 从 33 个降到 14 个，剩余主要是真入口或全局基础设施。阶段价值是改善“要改哪个用户故事先看哪里”的路径答案；不宣称降低全局耦合。
- 阶段验证和git提交（如通过）：
  - 2026-05-30 09:10 已通过：`npm run typecheck`。
  - 2026-05-30 09:10 已通过：UI routes/application 定向测试，24 tests / 8 suites 全部通过。
  - 2026-05-30 09:12 UI + Weixin 定向测试已通过：41 tests / 13 suites 全部通过。
  - 2026-05-30 09:12 首次 `npm run typecheck` 发现 `src/lib/bridge/adapters/weixin/weixin-media.ts` 迁目录后仍引用旧路径 `../../lib/bridge/types.js`；已改为 `../../types.js` 后重跑 `npm run typecheck` 通过。
  - 2026-05-30 09:14 Codex/bridge 定向测试已通过：161 tests / 22 suites 全部通过。
  - 2026-05-30 09:14 首次 Codex 迁移后 `npm run typecheck` 发现 `src/codex/session-index/*` 仍有 3 个旧层级 import；已修正为 `../../lib/bridge/...` 后重跑 `npm run typecheck` 通过。
  - 2026-05-30 09:16 Weixin 登录/账号存储迁移后首次 UI+Weixin 定向测试失败，原因是 `src/weixin/login.ts` / `src/weixin/store.ts` 仍按旧顶层路径 import `config` 和 bridge adapter helper；修正为 `../config.js`、`../lib/bridge/adapters/weixin/*` 后，`npm run typecheck` 通过，Weixin 定向测试 23 tests / 7 suites 全部通过。
  - 已通过：残留旧路径扫描。
  - 已通过：`node source-audit.mjs`。
  - 已通过：`git diff --check`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 阶段归档：`work/rebuild/STATUS-20260530-0921-src-lib-bridge-folder-alignment.md`。
  - 本地提交：`8009356 Organize source module folders`。
- 下一个阶段计划：
  - 基于新目录形态，优先审计 `src/ui/application/session.ts` 对 `src/codex/*` / `SessionRegistryService` 的直接组合，或审计 `src/lib/bridge/bridge-manager.ts` 对 `src/codex/session-index.ts` 的直接依赖。

### 2026-05-30 09:24 阶段：ui session application source boundary audit

> 阶段描述：基于新目录形态，聚焦 `src/ui/application/session.ts`、`src/ui/session-history.ts`、`src/lib/bridge/session-registry.ts` 和 `src/codex/session-index.ts` 的 UI session 用户故事边界；审计并收束 UI session application 对 Local Codex Session Index、默认模型读取、Codex history 读取和 registry wiring 的混杂依赖，让“查看/导入/配置会话”的入口更稳定，同时避免新增无意义测试或单文件阶段。

- 行动条目：
  - 2026-05-30 09:28 当前进入阶段审计：原始行动、squash 记录、审计事实、实现细节和验证摘要已归档到 `work/rebuild/STATUS-20260530-0928-ui-session-source-boundary.md`。本阶段新增 `src/ui/application/session-source.ts`，集中 UI session 所需 Local Codex source 和 registry factory；`UiSessionApplication` 不再直接 import `src/codex/*` 或 `SessionRegistryService`，只编排 list/history/import/config/delete UI use cases。新增 `src/__tests__/ui-session-application.test.ts` 覆盖新的 source port。阶段收益是 UI session application 主入口更纯，`session.ts` 直接 import 从 7 降到 5、风险跨聚合 import 从 3 降到 1；代价是新增 57 行 source adapter 和一个 focused test，`cluster-02` 仍未整体解耦。
- 阶段验证和git提交（如通过）：
  - 已通过：`node --test --import tsx src/__tests__/ui-session-application.test.ts src/__tests__/ui-session-history.test.ts src/__tests__/session-registry.test.ts src/__tests__/session-display-query.test.ts`，9 tests / 3 suites 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，488 tests / 91 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0928-ui-session-source-boundary.md`。
  - 本地提交：amend 到当前 `Rebuild source architecture` feature commit。
- 下一个阶段计划：
  - 继续沿 `cluster-02` 审计 `src/ui/application/binding.ts` / `src/session-bindings.ts` / `src/lib/bridge/session-registry.ts` 的 registry ownership，或转回 `cluster-01` 审计 `bridge-manager.ts` 对 `src/codex/session-index.ts` 的直接依赖。

### 2026-05-30 09:31 阶段：session registry binding owner alignment

> 阶段描述：继续 `cluster-02`，聚焦 `src/session-bindings.ts`、`src/lib/bridge/session-registry.ts`、`src/ui/application/binding.ts`、`src/ui/application/chat-display.ts` 和 command 对 binding list 的引用；审计 binding/default-target mutation owner 是否应从顶层 `src` 收入 Session Registry 目录，改善“绑定/默认目标/切换会话”用户故事入口和 `src` 顶层可读性，同时避免新增小 util 或扩大测试矩阵。

- 行动条目：
  - 2026-05-30 09:40 当前进入阶段审计：原始行动、依赖事实、审计脚本校准、聚合分析和验证摘要已归档到 `work/rebuild/STATUS-20260530-0940-session-registry-binding-owner-alignment.md`。本阶段将顶层 `src/session-bindings.ts` 收入 `src/lib/bridge/session-registry/bindings.ts`，同步重命名测试并更新 UI/command/registry service 引用；不拆分 `bindings.ts` 内部规则，保留 binding uniqueness、default target、materialize 和 summaries 的同一 owner。阶段同时更新 `source-audit.mjs` 并新增 `work/rebuild/cluster-aggregation-analysis.md`，用最新依赖图替代旧规划：Local Codex Session Index、Weixin Adapter、Interactive Turn Runtime 已是较清晰自然边界，`cluster-01` 与 `cluster-02` 仍是后续重构重点混合簇。
- 阶段验证和git提交（如通过）：
  - 已通过：`npm run typecheck`。
  - 已通过：`node --test --import tsx src/__tests__/session-registry-bindings.test.ts src/__tests__/session-registry.test.ts src/__tests__/ui-binding-application.test.ts src/__tests__/command-dispatch.test.ts src/__tests__/bridge-command-e2e.test.ts`，43 tests / 5 suites 全部通过。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，488 tests / 91 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0940-session-registry-binding-owner-alignment.md`。
  - 本地提交：amend 到当前 `Rebuild source architecture` feature commit，保留用户侧 `AGENTS.md` 未提交改动。
- 下一个阶段计划：
  - 基于 `work/rebuild/cluster-aggregation-analysis.md`，优先审计 UI chat-display / command 对 `session-registry/bindings.ts` 的直接引用是否应收束为 registry query facade；若回到 `cluster-01`，选择 bridge-manager 与 mirror/adapter 的真实状态 owner 切片，禁止新增大而空的 composition/factory。

### 2026-05-30 09:42 阶段：session registry query facade audit

> 阶段描述：继续 Session Registry 方向，审计 `src/ui/application/chat-display.ts` 和 command diagnostics/session-thread/thread-display 对 `src/lib/bridge/session-registry/bindings.ts` 的直接 import；判断是否需要通过 `src/lib/bridge/session-registry.ts` 暴露更稳定的 registry query/use case facade，从而让外部调用方不依赖 registry 内部文件，同时避免空 facade 和重复测试。

- 行动条目：
  - 2026-05-30 09:46 当前进入阶段审计：原始行动、依赖事实、审计脚本校准、验证摘要和阶段反思已归档到 `work/rebuild/STATUS-20260530-0946-session-registry-query-facade.md`。本阶段确认 UI chat-display 和 command diagnostics/thread-display/session-thread 使用的是 Session Registry 对外 query/use case 语义，因此在已有 `src/lib/bridge/session-registry.ts` public facade re-export binding query/switch API，并把 UI/command import 从 internal `session-registry/bindings.ts` 改到 facade。`bindings.ts` 继续保留真正的 binding owner 和 focused owner test；最新审计显示 Local UI 风险跨聚合 import 9 -> 8，Command Application 46 -> 43，但 re-export 让自然聚类变为 10 个，说明 cluster 编号只能作线索，不能机械作为目标模块。
- 阶段验证和git提交（如通过）：
  - 已通过：`npm run typecheck`。
  - 已通过：`node --test --import tsx src/__tests__/session-registry-bindings.test.ts src/__tests__/session-registry.test.ts src/__tests__/ui-binding-application.test.ts src/__tests__/command-dispatch.test.ts src/__tests__/bridge-command-e2e.test.ts`，43 tests / 5 suites 全部通过。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，488 tests / 91 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0946-session-registry-query-facade.md`。
  - 本地提交：amend 到当前 `Rebuild source architecture` feature commit，保留用户侧 `AGENTS.md` 未提交改动。
- 下一个阶段计划：
  - 阶段收口后，优先转向 command/provider 混合簇，审计 `session-thread.ts` / `diagnostics.ts` 对 Local Codex Session Index、display query、bridge runtime facts 的直接依赖；或回到 `cluster-01` mirror/adapter/bridge-manager 状态 owner。

### 2026-05-30 09:47 阶段：command provider boundary audit

> 阶段描述：继续最新 `cluster-02` command/provider 混合热点，聚焦 `src/lib/bridge/command/session-thread.ts`、`src/lib/bridge/command/diagnostics.ts`、`src/lib/bridge/command/thread-display.ts` 与 Local Codex Session Index、Display Query、Bridge Host runtime facts 的依赖；寻找能收窄 command 出边且不制造空 facade 的真实 owner 切片。

- 行动条目：
  - 2026-05-30 10:14 当前进入阶段审计：原始行动、错误 WIP 反思、hot update 记录、依赖扫描摘要和验证流水已归档到 `work/rebuild/STATUS-20260530-1014-command-provider-boundary.md`。本阶段最终只保留一刀：新增 `src/lib/bridge/command/session-source.ts` 作为 command 对 Local Codex Session Index 的窄 source owner，承接 `/t` / `/thread` 所需的本地 Codex session 列表和 thread-id 安全查找；`session-thread.ts` 不再直接读取 `getDisplayedCodexThreads` / `getCodexSessionByThreadIdSafe` / `validateSessionId`，`thread-display.ts` 回到 display/presentation adapter。本阶段明确放弃把 source 逻辑塞进 `CommandThreadDisplay` 的错误方向，因为那只会让 display owner 同时承担数据来源和安全查找，不能降低真实复杂度。
- 阶段验证和git提交（如通过）：
  - 插队 hot update 验证：`bash scripts/hot-update-bridge.sh` detached worker 完成；`npm test` 488 tests 全部通过；restart 内部 `npm run build` 通过；bridge PID `1072535` 已启动。
  - 已通过：`node --test --import tsx src/__tests__/command-dispatch.test.ts src/__tests__/session-display-query.test.ts src/__tests__/codex-session-index.test.ts`，49 tests 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，488 tests / 91 suites 全部通过。
  - 已通过：`node source-audit.mjs`，生成 204 个 `src/**/*.ts` 文件（生产 137、测试 67），本地 import / re-export 776 条。
  - 已通过：`git diff --check -- src/lib/bridge/command/session-thread.ts src/lib/bridge/command/session-source.ts work/rebuild/STATUS.md work/rebuild/source-file-audit.json work/rebuild/source-file-audit.md`。
  - 阶段归档：`work/rebuild/STATUS-20260530-1014-command-provider-boundary.md`。
  - 本地提交：已通过 `git commit --amend --no-edit` 合并到当前 `Rebuild source architecture` feature commit，保留用户侧 `AGENTS.md` 未提交改动。
- 下一个阶段计划：
  - 完成本阶段 amend 后，进入用户 10:00 指定的逐生产文件不合理抽象审计；先生成/维护 `work/rebuild/abstraction-smell-audit.md`，重点标注大而空的 composition/DI 堆叠、catch-all support/helper、名字与职责不符、跨用户故事万能 owner、路径/文件名误导 AI 定位、为了隐藏复杂度而制造跳转的文件。

### 2026-05-30 08:36 阶段：interactive turn composition factory audit

> 阶段描述：继续 `cluster-01`，聚焦 `bridge-manager.ts` 中 `runInteractiveMessage` deps wiring 的 composition 复杂度；审计是否能提取 interactive turn composition factory，把 environment/runtime/display/permission/health/stream 等端口组装从 bridge manager 主流程中移出，同时不把业务规则拆碎、不新增无意义跳转。

- 行动条目：
  - 2026-05-30 08:45 当前进入阶段审计：原始行动、审计事实和验证摘要已归档到 `work/rebuild/STATUS-20260530-0845-interactive-turn-composition-factory.md`。本阶段新增 Bridge Host 侧 `src/lib/bridge/interactive-turn-composition.ts`，用 `createInteractiveTurnMessageRunner` 集中 interactive turn 的 host wiring；`bridge-manager.ts` 删除对 runner/environment/SSE/runtime-options 的直接组装依赖，`handleMessage` 只调用 `INTERACTIVE_TURN_MESSAGE_RUNNER.run(...)`。二次审计确认该提取没有降低全局 import 数（774 -> 776），但 `bridge-manager.ts` 直接 import 34 -> 31、文件风险跨聚合 import 15 -> 13、`handleMessage` 函数体 339 -> 298，且 Bridge Host 总风险保持 28；因此本阶段收益是入口认知和 composition owner 命名清晰，不能宣称 `cluster-01` 已解决。
- 阶段验证和git提交（如通过）：
  - 已通过：`node --import tsx --test src/__tests__/bridge-manager.test.ts src/__tests__/interactive-turn-runner.test.ts`，86 tests / 10 suites 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0845-interactive-turn-composition-factory.md`。
  - 本地提交：`Extract interactive turn composition runner`。
- 下一个阶段计划：
  - 继续 `cluster-01`，避免继续按 deps object 机械造小 composition 文件；优先审计 `bridge-manager.ts` 剩余 mirror runtime / mirror feedback wiring，或者审计 `session-bindings.ts` 与 UI/session history 被吸入 `cluster-01` 的边界问题。

### 2026-05-30 08:29 阶段：interactive structured stream feedback port audit

> 阶段描述：继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/stream/ui-controller.ts` 与 `src/lib/bridge/interactive-turn/sdk/stream-events-controller.ts` 对 `stream-feedback-controller.ts`、security、markdown helper 的直接依赖；先审计这些依赖是否构成 structured stream feedback port，或者是否应先把 interactive turn composition 从 `bridge-manager.ts` 中收束出来，避免继续把所有端口堆进 bridge manager。

- 行动条目：
  - 2026-05-30 08:34 当前进入阶段审计：原始行动、审计事实和验证摘要已归档到 `work/rebuild/STATUS-20260530-0834-interactive-structured-stream-feedback-port.md`。本阶段确认 `ui-controller.ts` 与 `sdk/stream-events-controller.ts` 对 shared `stream-feedback-controller.ts` 的直接依赖属于 interactive turn 内部 structured stream feedback 适配职责，而不是 bridge manager composition 事实；新增 `src/lib/bridge/interactive-turn/stream/feedback-port.ts` 集中定义 `InteractiveStreamFeedback` / target 并唯一适配 shared stream feedback controller；`ui-controller.ts` 通过本地 feedback port 推送 metadata/status/actions/finalize，`sdk/stream-events-controller.ts` 通过同一 port 推送 text/tools/tasks。最新审计显示 `Interactive Turn Runtime` 风险跨聚合 import 11 -> 10，两个 controller 不再直接 import `stream-feedback-controller.ts`；代价是源文件 202 -> 203，import 边 771 -> 774，`Interactive Turn Runtime -> Bridge Host` 聚合依赖 23 -> 24。
- 阶段验证和git提交（如通过）：
  - 已通过：`node --import tsx --test src/__tests__/interactive-turn-sdk-stream-events-controller.test.ts src/__tests__/interactive-turn-runner.test.ts src/__tests__/stream-feedback-controller.test.ts`，20 tests / 3 suites 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0834-interactive-structured-stream-feedback-port.md`。
  - 本地提交：`Port interactive structured stream feedback`。
- 下一个阶段计划：
  - 继续 `cluster-01`，优先审计 `bridge-manager.ts` 中 interactive turn deps wiring 是否应提取为 composition factory，减少 bridge manager 继续变胖。

### 2026-05-30 08:22 阶段：interactive SDK runtime port audit

> 阶段描述：继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/sdk/conversation-engine.ts` 对 `context.ts`、`sse-stream-decoder.ts`、runtime options 的直接依赖；先审计这些依赖是否共同构成 SDK turn execution runtime port，若能收束为一个粗粒度端口，再由 bridge manager 或 runner 注入，避免继续在 interactive-turn 目录内逐个 helper 造小 owner。

- 行动条目：
  - 2026-05-30 08:27 当前进入阶段审计：原始行动、审计事实和验证摘要已归档到 `work/rebuild/STATUS-20260530-0827-interactive-sdk-runtime-port.md`。本阶段确认 `context.ts`、`consumeSseEvents`、runtime options normalizer 是同一个 SDK turn execution runtime 依赖组；`conversation-engine.ts` 新增 `SdkConversationRuntime` / `ConsumeSdkSseEvents` 并删除对 `context.ts`、`sse-stream-decoder.ts`、`runtime-options.ts` 的直接 import；`runner.ts` 通过可选 `resolveSdkConversationRuntime` 端口向 SDK engine 传入 runtime；`bridge-manager.ts` 作为 composition root 注入 store、llm、SSE consumer 和 normalizers；direct tests 与 mock-host 显式构造 runtime。最新审计显示 `conversation-engine.ts` 风险跨聚合 import 1 -> 0，`Interactive Turn Runtime` 风险 12 -> 11，`Interactive Turn Runtime -> Bridge Host / Runtime Contracts` 25 -> 23；代价是 bridge manager 更胖且全局 import 边 768 -> 771。
- 阶段验证和git提交（如通过）：
  - 已通过：`node --import tsx --test src/__tests__/interactive-turn-sdk-conversation-engine.test.ts`，7 tests / 3 suites 全部通过。
  - 已通过：`node --import tsx --test src/__tests__/interactive-turn-runner.test.ts`，15 tests / 1 suite 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0827-interactive-sdk-runtime-port.md`。
  - 本地提交：`Port interactive SDK conversation runtime`。
- 下一个阶段计划：
  - 继续 `cluster-01`，审计 structured stream feedback 相关依赖，重点判断是否需要先把 interactive turn composition 从 bridge manager 中收束出来，避免后续每个 runtime port 都直接堆进 bridge manager。

### 2026-05-30 08:07 阶段：interactive turn settings port

> 阶段描述：继续 `cluster-01`，聚焦 `turn-environment.ts` 剩余 settings 读取；审计 `getInteractiveStreamConfig`、`getInteractiveStreamStatusTimingConfig`、`shouldWriteSdkToolDetailsInText` 是否能合并为一个粗粒度 interactive turn runtime settings 端口，由 bridge manager 注入 store setting reader，从而让 environment 不再直接读取 global bridge context。若该方向会导致 runner deps 过宽，则转向 `sdk/conversation-engine.ts` 的 context / SSE decoder / runtime options 边界。

- 行动条目：
  - 2026-05-30 08:21 当前进入阶段审计：原始行动、审计事实和验证摘要已归档到 `work/rebuild/STATUS-20260530-0818-interactive-turn-settings-port.md`。本阶段确认 `getInteractiveStreamConfig`、`getInteractiveStreamStatusTimingConfig`、`shouldWriteSdkToolDetailsInText` 属于同一组 interactive turn runtime settings，而不是三个独立业务端口；`turn-environment.ts` 删除对 `context.ts` / `getBridgeContext` 的直接读取，新增 `resolveInteractiveTurnRuntimeSettings(channelType, readSetting)` 一次性解析 preview stream config、status heartbeat timing 和 SDK tool detail 开关；`runner.ts` 通过必填 deps 接收 runtime settings；`bridge-manager.ts` 作为 composition root 注入 `store.getSetting`；runner 测试仅显式注入已有 test store settings，没有新增测试文件或扩大测试数量。阶段收益是 interactive turn environment 不再直接读取 global bridge context，`Interactive Turn Runtime -> Bridge Host / Runtime Contracts` 聚合依赖 26 -> 25；代价是全局风险计数没有继续下降，下一阶段应转向 `sdk/conversation-engine.ts` 的 context / SSE decoder / runtime options 粗粒度端口。
- 阶段验证和git提交（如通过）：
  - 已通过：`node --import tsx --test src/__tests__/interactive-turn-runner.test.ts`，15 tests / 1 suite 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0818-interactive-turn-settings-port.md`。
  - 本地提交：`Port interactive turn runtime settings`。
- 下一个阶段计划：
  - 继续 `cluster-01`，优先审计 `src/lib/bridge/interactive-turn/sdk/conversation-engine.ts` 的 `getBridgeContext`、`consumeSseEvents`、runtime options 直接依赖是否能收束成一个 SDK runtime port；保持粗粒度阶段，避免每个 helper 单独造端口。

### 2026-05-30 08:07 阶段：interactive turn environment resolver port

> 阶段描述：继续 `cluster-01`，聚焦 `resolveInteractiveTurnEnvironment` 对 `channel-router.ts`、`context.ts`、`bridge-session-support.ts` 的直接读取；审计是否能将“解析 inbound address 到 turn environment”的粗粒度职责作为 bridge manager 注入端口，从而让 runner/environment 不再直接读取 router/context/session support。若该方向会导致 runner deps 过宽或只是迁移复杂度，则转向审计 SDK conversation engine / stream UI controller 的边界。

- 行动条目：
  - 2026-05-30 08:24 当前进入阶段审计：原始行动、审计事实和验证摘要已归档到 `work/rebuild/STATUS-20260530-0824-interactive-turn-environment-resolver-port.md`。本阶段删除 `turn-environment.ts` 对 `channel-router.ts` 和 `bridge-session-support.ts` 的直接 import，新增 `ResolveInteractiveTurnEnvironmentPorts`，用 `resolveBinding`、`getBridgeSession`、`codexThreadExists` 注入外部事实；`runner.ts` 通过必填 deps 获取 turn environment；`bridge-manager.ts` 作为 composition root 提供生产端口；runner 测试用 test-local resolver 显式注入。本阶段没有新增生产文件或测试数量。最新审计显示 `Interactive Turn Runtime` 风险 14 降到 12，`cluster-01` 内部跨聚合边 106 降到 105；代价是 Bridge Host 风险 27 到 28，因为 composition root 显式承接 environment resolver 注入。
- 阶段验证和git提交（如通过）：
  - 已通过：`node --import tsx --test src/__tests__/interactive-turn-runner.test.ts`，15 tests / 1 suite 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0824-interactive-turn-environment-resolver-port.md`。
  - 本地提交：`Port interactive turn environment resolution`。
- 下一个阶段计划：
  - 继续 `cluster-01`，优先审计 `turn-environment.ts` 剩余 settings 读取是否适合统一 settings port；如果会导致 runner deps 过宽，则转向 `sdk/conversation-engine.ts` 的 context / SSE decoder / runtime options 边界。

### 2026-05-30 07:49 阶段：interactive turn environment port audit

> 阶段描述：继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/environment/turn-environment.ts` 对 router/context/display 的直接读取；先审计它当前承担的绑定解析、session 查询、stream 设置、display metadata 和 stale notice 职责，选择能减少跨层读取或稳定入口的一刀，避免新增小 owner 文件。

- 行动条目：
  - 2026-05-30 08:06 当前进入阶段审计：原始行动、审计事实和验证摘要已归档到 `work/rebuild/STATUS-20260530-0806-interactive-turn-environment-display-port.md`。本阶段删除 `turn-environment.ts` 对 `ThreadDisplayService` 的直接 import，新增 `ResolveInteractiveTurnDisplayInfo` / `ListInteractiveTurnBindings` 端口；`runner.ts` 从 deps 接收 display/stale 端口；`bridge-manager.ts` 在生产路径注入 `ThreadDisplayService(store).binding(..., { stripInternalPrefix: true })` 和 `store.listChannelBindings(...)`；stale notice 直测显式提供 binding list 端口。本阶段没有新增 owner 文件，只在现有 environment/runner/bridge-manager 边界上减少 display 跨层读取。最新审计显示本地 import / re-export 边 769 降到 768，`Interactive Turn Runtime` 风险 import 15 降到 14；但 `resolveInteractiveTurnEnvironment` 仍直接依赖 router/context/session support，environment 未完成全端口化。
- 阶段验证和git提交（如通过）：
  - 已通过：`node --import tsx --test src/__tests__/interactive-turn-runner.test.ts`，15 tests / 1 suite 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0806-interactive-turn-environment-display-port.md`。
  - 本地提交：`Port interactive turn display and stale ports`。
- 下一个阶段计划：
  - 继续 `cluster-01`，优先审计 `resolveInteractiveTurnEnvironment` 的 router/context/session support 读取是否能作为粗粒度 environment resolver 由 bridge manager 注入；如果该方向会导致 runner deps 过宽，则转向 `sdk/conversation-engine.ts` / `stream/ui-controller.ts` 的 context、SSE decoder、stream feedback controller 边界审计。

### 2026-05-30 07:43 阶段：interactive turn stop callback port

> 阶段描述：继续 `cluster-01`，聚焦 `runner.ts` 剩余 command callback 依赖；审计 structured stream UI stop action 是否应由 Bridge Host / command callback owner 提供端口，目标是在不新增文件、不扩大测试数量的前提下降低 runner 对 command callback 格式的直接读取。

- 行动条目：
  - 2026-05-30 07:47 当前进入阶段审计：原始行动、审计事实和验证摘要已归档到 `work/rebuild/STATUS-20260530-0747-interactive-turn-stop-callback-port.md`。本阶段删除 `runner.ts` 对 `command-callbacks.ts` 的直接 import，新增 `BuildStopCallbackData` 端口，由 `bridge-manager.ts` 显式传入 `(sessionId) => buildCommandCallbackData('/stop', sessionId)`；`stream/ui-controller.ts` 只在提供 callback 数据时渲染 structured stream stop action。最新审计显示源文件数不变，本地 import / re-export 边 771 降到 769，`Interactive Turn Runtime` 风险 import 16 降到 15，`runner.ts` 风险 import 2 降到 1，`runInteractiveMessage` 外聚度 1 降到 0。本阶段没有新增测试或 owner 文件。
- 阶段验证和git提交（如通过）：
  - 已通过：targeted tests，118 tests / 12 suites 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0747-interactive-turn-stop-callback-port.md`。
  - 本地提交：`Port interactive turn stop callback`。
- 下一个阶段计划：
  - 继续 `cluster-01`，优先审计 `environment/turn-environment.ts` 对 router/context/display 的直接读取，或继续收缩 `stream/ui-controller.ts` 对 stream feedback controller 的边界；避免回到单文件小 owner 拆分。

### 2026-05-30 07:37 阶段：interactive turn runner port audit

> 阶段描述：继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/runner.ts` 对 `permission-broker`、delivery pipeline、bridge host/context 的直接依赖，先审计是否存在自然端口边界；选择能减少跨层读取或稳定入口的修改，避免继续新增小 owner 文件或只做表面路径调整。

- 行动条目：
  - 2026-05-30 07:41 当前进入阶段审计：原始行动、审计事实和验证摘要已归档到 `work/rebuild/STATUS-20260530-0741-interactive-turn-permission-port.md`。本阶段删除 `runner.ts` 对 `permission-broker.ts` 的直接 import，新增本地 `ForwardPermissionRequest` 端口，并由 `bridge-manager.ts` 显式传入 `broker.forwardPermissionRequest`。最新审计显示源文件数不变，本地 import / re-export 边 772 降到 771，`Interactive Turn Runtime` 风险 import 17 降到 16，`runner.ts` 风险 import 3 降到 2，`runInteractiveMessage` 外聚度 2 降到 1。本阶段没有新增测试或 owner 文件，未处理 delivery pipeline / command callback，后续继续审计。
- 阶段验证和git提交（如通过）：
  - 已通过：targeted tests，104 tests / 11 suites 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0741-interactive-turn-permission-port.md`。
  - 本地提交：`Port interactive turn permission forwarding`。
- 下一个阶段计划：
  - 继续 `cluster-01`，优先审计 runner 的 stop callback / command callback 依赖，以及 `environment/turn-environment.ts` 对 router/context/display 的直接读取；避免回到单文件小 owner 拆分。

### 2026-05-30 07:24 阶段：interactive turn directory boundaries

> 阶段描述：从 `consumeStream` owner 审计开始，根据用户纠偏调整为 cluster 级推进；定位 `cluster-01` 内的 `Interactive Turn Runtime` 子边界，把 `src/lib/bridge/interactive-turn/` 从平铺 owner 文件重排为按用户故事可猜的子目录，同时撤回新增小 owner 文件，避免继续增加文件数量。

- 行动条目：
  - 2026-05-30 07:35 当前进入阶段审计：原始行动记录、验证摘要、审计事实和阶段反思已归档到 `work/rebuild/STATUS-20260530-0735-interactive-turn-directory-boundaries.md`。本阶段先尝试 assistant response 小 owner，但根据用户纠偏撤回；最终只保留 interactive turn cluster 目录重排：`sdk/` 承接 SDK 执行、附件、预览和 SDK event；`stream/` 承接 structured stream UI；`terminal/` 承接外部终端收尾；`response/` 承接最终响应计划；`environment/` 承接 turn 环境解析；`runner.ts` 保留为聚合入口。最新审计保持 202 个 `src/**/*.ts` 文件，未增加源文件数量；`cluster-01` 仍为最大混合簇（59 文件 / 14702 行 / 内部跨聚合边 108），本阶段只宣称路径和入口可读性改善，不宣称全局耦合下降。
- 阶段验证和git提交（如通过）：
  - 已通过：targeted interactive-turn tests，32 tests / 7 suites 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0735-interactive-turn-directory-boundaries.md`。
  - 本地提交：`Organize interactive turn directory boundaries`。
- 下一个阶段计划：
  - 继续 `cluster-01`，优先审计 `runner.ts` 对 `permission-broker`、delivery pipeline、bridge host/context 的端口边界；下一刀应减少跨层读取或让入口更稳定，而不是继续在 interactive-turn 下新增小文件。

### 2026-05-30 07:20 阶段：interactive SDK stream consumption 边界审计

> 阶段描述：继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts` 内部剩余 `consumeStream`、inline tool block rendering、final artifact collection，审计是否能形成自然 owner，优先降低 SDK engine 对 SSE parsing / tool rendering / final artifact collection 的混杂感，新增测试前先审计既有覆盖是否足够。

- 行动条目：
  - 2026-05-30 07:23 当前进入阶段审计：本阶段新增 `src/lib/bridge/interactive-turn/sdk-stream-preview.ts`，把 SDK stream preview 的文本拼接、inline tool block markdown 和 reasoning note quote rendering 从 `sdk-conversation-engine.ts` 抽出；`sdk-conversation-engine.ts` 不再直接 import `logger.ts`、`security/validators.ts`、`markdown/fence.ts`。原始行动记录、审计事实和验证摘要已归档到 `work/rebuild/STATUS-20260530-0723-interactive-sdk-stream-preview.md`。
  - 阶段价值判断：本阶段真实收益是 SDK 流式预览展示规则有稳定 owner，`sdk-conversation-engine.ts` 从 646 行降到 573 行，直接 import 从 10 降到 8，风险跨聚合 import 从 3 降到 1；代价是 `consumeStream` 仍为 305 行，`Interactive Turn Runtime` 聚合总风险仍为 17，下一阶段不能把此阶段解释为 stream consumption 已经完成。
- 阶段验证和git提交（如通过）：
  - 已通过：`node --test --import tsx src/__tests__/interactive-turn-sdk-conversation-engine.test.ts src/__tests__/interactive-turn-runner.test.ts`，22 tests / 4 suites 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0723-interactive-sdk-stream-preview.md`。
  - 本地提交：`Extract interactive SDK stream preview owner`。
- 下一个阶段计划：
  - 下一阶段继续 `cluster-01` / `cluster-05`：审计 `consumeStream` 是否应抽出 stream event reducer 或 assistant response persistence owner；同时继续评估 runner 对 `permission-broker` / delivery pipeline 的窄端口。

### 2026-05-30 07:12 阶段：interactive SDK conversation engine 内部边界审计

> 阶段描述：继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts` 内部的 `processMessage` / `consumeStream`，审计 SDK stream reducer、attachment persistence、runtime options resolver 哪个是自然子边界，并在不增加冗余测试的前提下选择一刀能降低认知入口复杂度的修改。

- 行动条目：
  - 2026-05-30 07:17 当前进入阶段审计：本阶段新增 `src/lib/bridge/interactive-turn/sdk-attachments.ts`，把附件本地持久化、`<!--files:JSON-->` 文件格式、非图片附件 prompt supplement 和 LLM file path 回填从 `sdk-conversation-engine.ts` 中抽出；`sdk-conversation-engine.ts` 不再直接 import `fs` / `path`，`processMessage` 函数体从 226 行降到 181 行。原始行动记录、引用扫描、审计事实和验证输出摘要已归档到 `work/rebuild/STATUS-20260530-0717-interactive-sdk-attachments-owner.md`。
  - 阶段价值判断：本阶段真实收益是 attachment persistence 成为 interactive turn 内可猜入口，SDK provider orchestration 的局部复杂度下降，且没有新增测试数量；代价是 `Interactive Turn Runtime` 仍为 16 文件 / 2776 行 / 风险 17，聚合总耦合没有下降，`consumeStream` 仍是 307 行热点。
- 阶段验证和git提交（如通过）：
  - 已通过：`node --test --import tsx src/__tests__/interactive-turn-sdk-conversation-engine.test.ts src/__tests__/interactive-turn-runner.test.ts`，22 tests / 4 suites 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0717-interactive-sdk-attachments-owner.md`。
  - 本地提交：`Extract interactive SDK attachment owner`。
- 下一个阶段计划：
  - 下一阶段继续 `cluster-01`：审计 `sdk-conversation-engine.ts` 剩余 `consumeStream`、inline tool block rendering、final artifact collection 是否能自然分边界；同时继续评估 runner 对 `permission-broker` / delivery pipeline 的窄端口。

### 2026-05-30 07:05 阶段：interactive turn SDK execution 端口审计

> 阶段描述：继续 `cluster-01`，聚焦 `runner.ts` 剩余对 `conversation-engine`、`permission-broker` 和 delivery pipeline 的跨聚合端口，先审计真实 owner、文件命名和测试重复覆盖，再选择一刀能降低入口复杂度或跨聚合读取的修改。

- 行动条目：
  - 2026-05-30 07:10 当前进入阶段审计：本阶段将 bridge root 下模糊的 `conversation-engine.ts` 移入 `src/lib/bridge/interactive-turn/sdk-conversation-engine.ts`，同步重命名测试为 `interactive-turn-sdk-conversation-engine.test.ts`，没有新增测试数量；runner 改为同目录 import，mock-host 示例同步更新。原始行动记录、使用范围审计、测试审计和验证摘要已归档到 `work/rebuild/STATUS-20260530-0710-interactive-sdk-conversation-engine.md`。
  - 阶段价值判断：本阶段真实收益是 Bridge Host catch-all 面积从 23 文件 / 5557 行 / 风险 29 降到 22 文件 / 4834 行 / 风险 27，`runner.ts` 风险跨聚合 import 从 4 降到 3，interactive turn SDK 执行入口更清楚；代价是 Interactive Turn Runtime 变胖到 15 文件 / 2743 行 / 风险 17，本阶段不是总复杂度下降，只是 owner 归位。
- 阶段验证和git提交（如通过）：
  - 已通过：`node --test --import tsx src/__tests__/interactive-turn-sdk-conversation-engine.test.ts src/__tests__/interactive-turn-runner.test.ts`，22 tests 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0710-interactive-sdk-conversation-engine.md`。
  - 本地提交：`Move SDK conversation engine into interactive turn`。
- 下一个阶段计划：
  - 下一阶段继续 `cluster-01`：审计 `sdk-conversation-engine.ts` 内部的 `processMessage` / `consumeStream` 是否能自然拆出 SDK stream reducer、attachment persistence 或 runtime options resolver；同时继续评估 runner 对 `permission-broker` / delivery pipeline 的窄端口。

### 2026-05-30 06:53 阶段：interactive turn execution/delivery 端口审计

> 阶段描述：继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/runner.ts` 剩余 execution/delivery 端口，审计 conversation engine callbacks、permission forwarding、stream feedback、final delivery context 是否能形成更窄 owner，避免继续只搬 helper。

- 行动条目：
  - 2026-05-30 07:03 当前进入阶段审计：本阶段新增 `src/lib/bridge/interactive-turn/sdk-stream-events-controller.ts`，把 SDK/conversation-engine text/tool/task/status/permission-wait callbacks 到 stream UI、task state 和 health runtime 的映射集中为明确 owner；`runner.ts` 不再直接维护 tool tracker、latest tasks、stream activity/content response 更新时间、permission wait health 更新和 final card text push。根据用户测试膨胀纠偏，审计并删除了与 runner tool-details-off 集成场景重复的 controller 单测，改为 stale task guard，测试数量不增加；根据命名纠偏，将新文件从泛称 execution events 规整为 `sdk-stream-events-controller.ts`。原始行动记录、审计事实和验证输出摘要已归档到 `work/rebuild/STATUS-20260530-0703-interactive-sdk-stream-events.md`。
  - 阶段价值判断：本阶段真实收益是 `runInteractiveMessage` 从 524 行降到 426 行、外聚度从 4 降到 3，SDK stream event 状态 owner 更清楚，AI 查找“SDK 流式事件如何更新卡片/health/task state”有稳定入口；但 `Interactive Turn Runtime` 风险跨聚合 import 从 14 升到 15，说明本阶段没有降低聚合总耦合，不能被解释为 `cluster-01` 已解决。
- 阶段验证和git提交（如通过）：
  - 已通过：`node --test --import tsx src/__tests__/interactive-turn-sdk-stream-events-controller.test.ts src/__tests__/interactive-turn-runner.test.ts src/__tests__/interactive-turn-final-response-plan.test.ts src/__tests__/interactive-turn-terminal-finalization-controller.test.ts`，25 tests / 4 suites 全部通过。
  - 已通过：`npm run typecheck`。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，487 tests / 90 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0703-interactive-sdk-stream-events.md`。
  - 本地提交：`Extract interactive SDK stream events owner`。
- 下一个阶段计划：
  - 下一阶段继续 `cluster-01`：审计 runner 剩余 `conversation-engine` / `permission-broker` / delivery pipeline 端口，优先判断是否能形成真正窄的 SDK execution 或 permission/delivery adapter；新增测试前先做重复覆盖审计，避免单测继续膨胀。

### 2026-05-30 06:47 阶段：interactive turn runner 外聚端口审计

> 阶段描述：继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/runner.ts` 对 Bridge Host / Runtime Contracts 的外聚依赖，先审计 context/router/engine/broker/delivery/display 等跨聚合调用的真实职责，再选择一刀能降低 runner 外聚度和入口跳转成本的端口收窄。

- 行动条目：
  - 2026-05-30 06:51 当前进入阶段审计：本阶段新增 `src/lib/bridge/interactive-turn/turn-environment.ts`，集中 `router.resolve`、`getBridgeContext().store`、Codex thread classify、stream key、stream 设置、display metadata 和 stale binding notice；`runner.ts` 不再直接 import `channel-router`、`context`、`mirror-formatters`、`streaming-metadata`、`thread-display-resolver`、`bridge-session-support`。原始行动记录、审计事实和验证输出摘要已归档到 `work/rebuild/STATUS-20260530-0651-interactive-turn-environment.md`。
  - 阶段价值判断：本阶段真实收益是 `runInteractiveMessage` 的入口复杂度下降，外聚度从 7 降到 4，文件直接 import 从 22 降到 16；但 `Interactive Turn Runtime` 聚合风险 import 仍为 14，只是把环境查询集中到明确 owner，没有消除聚合总耦合。
- 阶段验证和git提交（如通过）：
  - 已通过：`npm run typecheck`。
  - 已通过：`node --test --import tsx src/__tests__/interactive-turn-runner.test.ts src/__tests__/interactive-turn-final-response-plan.test.ts src/__tests__/interactive-turn-terminal-finalization-controller.test.ts src/__tests__/bridge-manager.test.ts`，93 tests 全部通过。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，484 tests / 89 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0651-interactive-turn-environment.md`。
  - 本地提交：`Extract interactive turn environment`。
- 下一个阶段计划：
  - 下一阶段继续 `cluster-01`：审计 runner 剩余 execution/delivery 端口，优先判断 `conversation-engine` callbacks、permission forwarding、stream feedback 或 final delivery context 是否能形成真正窄接口。

### 2026-05-30 06:31 阶段：final response delivery owner 审计

> 阶段描述：继续 `cluster-01`，聚焦 interactive final response delivery、mirror finalized delivery、stale binding notice、stream card text skip 与 attachment fallback 的 owner，先审计共享 delivery port 和重复决策，再选择一刀能降低状态流认知成本的修改。

- 行动条目：
  - 2026-05-30 06:45 当前进入阶段审计：本阶段新增 `src/lib/bridge/interactive-turn/final-response-plan.ts`，把 external terminal 和 SDK process 的 final response 选源、stale binding notice、stream card finalization 后是否跳过文本投递、fallback error delivery 收成可测纯规则；同时按用户命名纠偏把 `interactive-message-runner.ts`、`interactive-stream-ui.ts`、`interactive-terminal-finalization.ts` 规整为 `src/lib/bridge/interactive-turn/runner.ts`、`stream-ui-controller.ts`、`terminal-finalization-controller.ts`，对应测试改名为 `interactive-turn-*`。原始行动记录、审计事实和验证输出摘要已归档到 `work/rebuild/STATUS-20260530-0645-final-response-delivery-owner.md`。
  - 阶段价值判断：本阶段真实收益是 final response delivery 决策有明确 owner，且 interactive IM turn 用户故事族有稳定目录入口，AI 查找入口更清晰；但 `runInteractiveMessage` 仍有 525 行且外聚度升至 7，`Interactive Turn Runtime` 仍有 14 条风险跨聚合 import，本阶段不应被解释为 `cluster-01` 已解决。
- 阶段验证和git提交（如通过）：
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run typecheck`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，484 tests / 89 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0645-final-response-delivery-owner.md`。
  - 本地提交：`Extract interactive final response planning`。
- 下一个阶段计划：
  - 下一阶段继续 `cluster-01`：审计 `src/lib/bridge/interactive-turn/runner.ts` 对 context/router/engine/broker/delivery/display 的外聚依赖，优先选择能降低 runner 外聚度和入口跳转成本的端口收窄。

### 2026-05-30 06:24 阶段：external terminal finalization / mirror suppression / final delivery 状态流审计

> 阶段描述：继续 `cluster-01`，审计 external terminal finalization、mirror suppression 和 final response delivery 三者之间的状态切换、跨层读取与 invariant owner，再决定是否实施一刀能真实降低复杂度的代码修改。

- 行动条目：
  - 2026-05-30 06:28 当前进入阶段审计：本阶段新增 `src/lib/bridge/interactive-terminal-finalization.ts`，把 external terminal finalization 的 request、process race、process-settled 标记、Codex terminal timeout wait 和 completion promise 收成 controller；`interactive-message-runner.ts` 改为通过 controller 暴露 `finalizeFromExternalTerminal`、`raceProcess`、`waitAfterProcess` 和 `settleCompletion`。新增 `src/__tests__/interactive-terminal-finalization.test.ts` 锁定 race/abort/process 后等待 terminal 语义。原始行动记录、审计事实和验证输出摘要已归档到 `work/rebuild/STATUS-20260530-0628-interactive-terminal-finalization.md`。
  - 阶段价值判断：本阶段真实收益是 external terminal finalization 状态 owner 更清晰，`runInteractiveMessage` 内部少维护一组异步闭包状态；但外聚度没有下降，final response delivery、stale binding notice、stream card finalize、mirror suppression settle/abort 仍在 runner 中，本阶段不应被解释为 `cluster-01` 已解决。
- 阶段验证和git提交（如通过）：
  - 已通过：`npm run typecheck`。
  - 已通过：`node --test --import tsx src/__tests__/interactive-terminal-finalization.test.ts src/__tests__/interactive-message-runner.test.ts src/__tests__/delivery-pipeline.test.ts src/__tests__/local-codex-terminal-router.test.ts src/__tests__/turn-coordinator.test.ts`，25 tests 全部通过。
  - 已通过：`node --test --import tsx src/__tests__/bridge-manager.test.ts src/__tests__/mirror-runtime.test.ts src/__tests__/mirror-feedback-controller.test.ts src/__tests__/mirror-turns.test.ts`，84 tests 全部通过。
  - 已通过：`node work/rebuild/source-audit.mjs`。最新审计显示文件数 195（生产 131，测试 64），本地 import / re-export 边 746；函数节点 1550；函数依赖边 1754，其中内聚 1498、外聚 256；`runInteractiveMessage` 从 641 行降到 574 行，外聚度保持 5；新增 controller 125 行、外聚度 0。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，480 tests / 88 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0628-interactive-terminal-finalization.md`。
  - 本地提交：`Extract interactive terminal finalization controller`。
- 下一个阶段计划：
  - 下一阶段继续 `cluster-01`：优先审计 final response delivery 与 mirror feedback final delivery 的共享 port，或把 stale binding / final card / text delivery 决策收成更明确的 final response coordinator。

### 2026-05-30 06:08 阶段：interactive structured stream 状态 owner 审计

> 阶段描述：继续 `cluster-01`，聚焦 `runInteractiveMessage` 中 structured stream heartbeat / snapshot / stop action / finalization 状态 owner，先审计再选择能降低状态机耦合的一刀。

- 行动条目：
  - 2026-05-30 06:22 当前进入阶段审计：本阶段新增 `src/lib/bridge/interactive-stream-ui.ts`，把 structured stream UI 的 target、support 判断、metadata/status/actions、heartbeat、snapshot、inactive 和 finalize-once 收拢为 controller；`interactive-message-runner.ts` 改为通过 `streamUi` controller 调用这些能力。原始行动记录、扫描事实和验证输出摘要已归档到 `work/rebuild/STATUS-20260530-0622-interactive-stream-ui-controller.md`。
  - 阶段价值判断：本阶段改善 `runInteractiveMessage` 的局部认知入口，减少 runner 内局部闭包状态；但审计显示全局依赖图没有净下降，本阶段不应被解释为系统核心复杂度已解决。
  - 阶段保留缺口：`runInteractiveMessage` 仍是 641 行大函数，继续拥有 conversation processing、preview、health、mirror suppression、external terminal finalization 和 final delivery orchestration；`cluster-01` 仍是最大混合簇。
- 阶段验证和git提交（如通过）：
  - 已通过：`npm run typecheck`。
  - 已通过：`node --test --import tsx src/__tests__/interactive-message-runner.test.ts src/__tests__/stream-feedback-controller.test.ts src/__tests__/bridge-manager.test.ts`，88 tests 全部通过。
  - 已通过：`node work/rebuild/source-audit.mjs`。最新审计显示文件数 193（生产 130，测试 63），本地 import / re-export 边 744；函数节点 1551；函数依赖边 1755，其中内聚 1499、外聚 256。`runInteractiveMessage` 从 731 行降到 641 行，外聚度保持 5；新增 `createInteractiveStreamUiController` 138 行、外聚度 0。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，477 tests / 87 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0622-interactive-stream-ui-controller.md`。
  - 本地提交：`Extract interactive stream UI controller`。
- 下一个阶段计划：
  - 下一阶段继续 `cluster-01`：优先处理 external terminal finalization / mirror suppression / final response delivery 之间的状态切换，或 bridge host 与 session health runtime 的快照写入边界。

### 2026-05-30 06:02 阶段：cluster-01 stream feedback 状态 owner 审计

> 阶段描述：继续 `cluster-01`，审计 mirror delivery / stream feedback / interactive turn runtime 之间的状态规则归属，寻找能减少状态机耦合或收窄 delivery port 的一刀；先审计再改代码。

- 行动条目：
  - 2026-05-30 06:06 当前进入阶段审计：本阶段把 stream UI finalization 统一收回 `stream-feedback-controller.ts`，删除 `delivery-pipeline.ts` 的 `finalizeStreamingUi` wrapper，并让 finalized mirror stream 也经由 `finalizeStreamFeedback`；原始行动记录、扫描事实和验证输出摘要已归档到 `work/rebuild/STATUS-20260530-0606-stream-feedback-finalization-owner.md`。
  - 阶段价值判断：本阶段真实收益是职责 owner 更清晰，`delivery-pipeline.ts` 只保留 final response text/attachment delivery，stream card finalize 行为统一归属 stream feedback controller；它只带来小幅依赖指标下降，不应被解读为核心状态机复杂度已经解决。
  - 阶段保留缺口：`runInteractiveMessage` 仍直接管理 heartbeat、status、preview、structured stream snapshot、stop action 和 final delivery；`mirror-feedback-controller.ts` 仍同时拥有 mirror formatting、stream update 和 final delivery。下一阶段仍需继续围绕状态 owner 或 port 收窄推进。
- 阶段验证和git提交（如通过）：
  - 已通过：`npm run typecheck`。
  - 已通过：`node --test --import tsx src/__tests__/stream-feedback-controller.test.ts src/__tests__/delivery-pipeline.test.ts src/__tests__/interactive-message-runner.test.ts src/__tests__/mirror-feedback-controller.test.ts src/__tests__/bridge-manager.test.ts`，91 tests 全部通过。
  - 已通过：`node work/rebuild/source-audit.mjs`。最新审计显示本地 import / re-export 边仍为 740；函数节点 1551；函数依赖边 1771，其中内聚 1514、外聚 257；`Interactive Turn Runtime` 风险跨聚合 import 从 4 降到 3，`src/lib/bridge/turns/delivery-pipeline.ts` 不再依赖 `stream-feedback-controller.ts`。
  - 已通过：`npm run build`。
  - 已通过：`npm test`，477 tests / 87 suites 全部通过。
  - 已通过：`git diff --check`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0606-stream-feedback-finalization-owner.md`。
  - 本地提交：`Refactor stream feedback finalization ownership`。
- 下一个阶段计划：
  - 下一阶段继续 `cluster-01`：优先审计 `runInteractiveMessage` 中 structured stream heartbeat / snapshot / stop action 的 owner，或审计 mirror finalized delivery 与 attachment fallback 的 port 边界。

### 2026-05-30 05:55 阶段：cluster-01 状态流复杂度审计

> 阶段描述：转向 `cluster-01` 的 mirror / turn / delivery / bridge host 边界，不先改代码；先用复杂度价值判断审计状态流、跨层读取和 invariant owner，选择能真实降低复杂度的一刀。

- 行动条目：
  - 2026-05-30 06:01 当前进入阶段审计：本阶段完成 `mirror-runtime.ts` 去全局 bridge context 依赖，把 binding/session/thread-id 清理能力改为由 `bridge-manager.ts` 显式注入；原始行动记录、扫描事实和验证输出摘要已归档到 `work/rebuild/STATUS-20260530-0601-cluster-01-mirror-runtime-context-port.md`。
  - 阶段价值判断：本阶段不以文件变短为成功标准，`mirror-runtime.ts` 反而因端口类型增加而略变长；真实收益是减少隐式跨层读取、让 mirror runtime 测试不再依赖全局 bridge context，并降低后续移动 mirror runtime 聚合时的环境耦合。
  - 阶段保留缺口：`cluster-01` 的核心复杂度仍在 interactive run path / mirror delivery path 共享 stream feedback、stream state 和 delivery pipeline 的状态规则；后续应继续集中状态 owner 或收窄 delivery port，而不是机械拆大文件。
- 阶段验证和git提交（如通过）：
  - 已通过：`npm run typecheck`。
  - 已通过：`node --test --import tsx src/__tests__/mirror-runtime.test.ts src/__tests__/bridge-manager.test.ts src/__tests__/mirror-reconcile-batch.test.ts src/__tests__/mirror-subscription-registry.test.ts src/__tests__/mirror-subscription-state.test.ts`，84 tests 全部通过。
  - 已通过完整验证链：`node work/rebuild/source-audit.mjs`、`npm run build`、`npm test`、`git diff --check`；完整测试 477 tests / 87 suites 全部通过。
  - 阶段归档：`work/rebuild/STATUS-20260530-0601-cluster-01-mirror-runtime-context-port.md`。
  - 本地提交：`Refactor mirror runtime context dependencies`。
- 下一个阶段计划：
  - 下一阶段继续 `cluster-01`：优先审计 mirror delivery / stream feedback / interactive turn runtime 的状态 owner，选择能减少状态机耦合或收窄 delivery port 的一刀。

### 2026-05-30 05:31 阶段：UI 重构阶段

> 阶段描述：沿 `cluster-02` 收缩 UI server，把 service/config/channel/Weixin login/binding display query 等 UI workflow 从 `ui-server.ts` 迁入 UI route/application 模块；这些 UI 子切片属于同一个 UI 重构阶段，后续不再按单个 route/query 创建微阶段。

- 行动条目：
  - 本阶段把 Local UI 的 service/config/channel/Weixin login/binding display/auth access/static shell 从 `ui-server.ts` 迁入独立 route/application/shell 模块；详细原始行动记录、扫描事实、验证命令和用户复杂度反馈已归档到 `work/rebuild/STATUS-20260530-0554-ui-rebuild-stage-audit.md`。
  - 阶段价值判断：本阶段真实降低的是 UI 入口复杂度、route 局部修改半径和聚焦测试成本；`ui-server.ts` 从 4193 行收缩到 234 行，当前只负责 route composition / server lifecycle。它没有消除系统核心复杂度：`ui-shell.ts` 仍是 3152 行静态前端 shell，`cluster-02` 仍混有 UI/config/service/weixin/store，`cluster-01` 的 mirror / turn / delivery / bridge host 状态流仍是更大的复杂度来源。
  - AI 协作判断：本阶段让 AI 更容易定位 UI route 行为和相关测试，但不能证明整体架构已经“简单”。后续重构必须优先减少状态机耦合、集中业务 invariant owner、收窄跨层读取，而不是继续用文件拆分或行数下降作为主要成功标准。
- 阶段验证和git提交（如通过）：
  - 已通过最终验证：内容一致性脚本确认新 `src/ui-shell.ts` 的 `renderUiShellHtml` 与旧 `ui-server.ts` 的 `renderHtml` 函数体一致；`npm run typecheck`；`node work/rebuild/source-audit.mjs`；`npm run build`；`npm test`，477 tests 全部通过；`git diff --check -- src/ui-server.ts src/ui-shell.ts work/rebuild/STATUS.md work/rebuild/source-file-audit.json work/rebuild/source-file-audit.md`。
  - 阶段归档：`work/rebuild/STATUS-20260530-0554-ui-rebuild-stage-audit.md`。
  - 本地提交：`Refactor UI server routes and queries`，已通过 amend 合并 binding display query、auth/access、static shell 和阶段审计文档；未新增 UI 微阶段提交。
- 下一个阶段计划：
  - 下一阶段转向 `cluster-01` 的 mirror / turn / delivery / bridge host 边界。先做复杂度价值导向的状态流审计，识别能真实减少状态机耦合、集中 invariant owner、降低跨层读取的一刀，再实施代码修改。

### 2026-05-30 05:23 阶段：UI Weixin login route 收缩

> 阶段描述：继续沿 `cluster-02` 收缩 `ui-server.ts`，优先审计并迁出 Weixin login web session routes；保持 Feishu binding display enrichment 暂不迁移，避免把 channel display 规则与 Weixin 登录状态管理混在同一阶段。

- 行动条目：
  - 本阶段将 `/weixin-login/:sessionId`、`/api/channels/weixin-login`、`/api/channels/weixin-login/start`、`/api/channels/weixin-login/:sessionId` 迁入 `src/ui-weixin-login-routes.ts`，并在 `src/ui/application/channel.ts` 新增 `mergeWeixinLoginAccount` 统一扫码账号写回微信通道配置的规则；`ui-server.ts` 不再直接 import `weixin-login.ts`，但保留 Feishu binding display enrichment 待后续阶段处理。阶段审计中确认曾误从 `work/rebuild` 目录运行审计脚本导致历史归档文件出现删除标记，已恢复后从项目根目录正确复跑审计。
- 阶段验证和git提交（如通过）：
  - 2026-05-30 05:29 当前进入阶段审计：确认本阶段只迁出 Weixin login route 和微信账号写回配置 helper，没有迁出 Feishu binding display enrichment，也没有改 hot update / bridge runtime 行为。
  - 已通过：`npm run typecheck`。
  - 已通过：`node --test --import tsx src/__tests__/ui-weixin-login-routes.test.ts src/__tests__/weixin-login.test.ts src/__tests__/ui-channel-routes.test.ts src/__tests__/ui-config-routes.test.ts src/__tests__/ui-service-routes.test.ts`，17 tests 全部通过。
  - 已通过：`node work/rebuild/source-audit.mjs`。
  - 已通过：`npm run build`。
  - 已通过：`git diff --check -- src/ui-server.ts src/ui-weixin-login-routes.ts src/ui/application/channel.ts src/__tests__/ui-weixin-login-routes.test.ts work/rebuild/STATUS.md work/rebuild/source-file-audit.json work/rebuild/source-file-audit.md`。
  - 已通过：`npm test`，470 tests 全部通过。
  - 阶段归档：`work/rebuild/STATUS-20260530-0529-ui-weixin-login-routes.md`。
  - 本地提交：`Extract UI Weixin login routes`。
- 下一个阶段计划：
  - 下一阶段继续基于最新审计选择：优先考虑 `ui-server.ts` 中 Feishu binding display enrichment 的 query/route 收缩，或转向 `cluster-01` 的 mirror / turn / delivery 边界。

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
  - 阶段归档：`work/rebuild/STATUS-20260530-0521-ui-channel-routes.md`。
  - 本地提交：`Extract UI channel routes`。
- 下一个阶段计划：
  - 下一阶段继续基于 AST 外聚热点和自然聚类选择：可继续收缩 `cluster-02` 的 Weixin login / Feishu binding display workflow，或转向 `cluster-01` 的 mirror / turn / delivery 边界。

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
