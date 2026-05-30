# Cluster Aggregation Analysis

生成时间：2026-05-30 09:45 CST

依据：`work/rebuild/source-audit.mjs` 重新生成的 `work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md`。

## 审计基线

- `src/**/*.ts` 文件数：203（生产 136，测试 67）
- 本地 import / re-export 边数：775
- 函数节点数：1562
- 函数依赖边数：1743（内聚 1481，外聚 262）
- 自然聚类数：10

本轮在 `session-registry.ts` 增加 public re-export 后，本地 import/re-export 边增加 1。UI / command 不再直接 import `session-registry/bindings.ts`，但自然聚类因 facade 边变化重新洗牌：这说明自然聚类只能作为边界线索，不能机械当成目标模块名。后续仍以业务 owner、路径可预测性和跨层读取是否减少为判断标准。

## 最新自然聚类

| 聚类 | 当前候选边界 | 文件/行数 | 出边/入边 | 判断 |
| --- | --- | ---: | ---: | --- |
| cluster-01 | Mixed: Bridge Host / Feishu Adapter / Mirror Runtime | 25 / 9007 | 42 / 105 | Bridge Host、Feishu adapter、Mirror feedback 仍纠缠，是最高优先级混合簇之一。 |
| cluster-02 | Mixed: Command Application / Execution Providers / Bridge Host | 36 / 8906 | 56 / 119 | Command、provider、registry/display/bridge facts 被聚到一起，说明 command 出边仍高。 |
| cluster-03 | Mixed: Local UI / Config / Service / Store / Persistence | 29 / 7183 | 21 / 121 | UI、配置、服务和持久化仍混合；`src/ui/shell.ts` 被拆成独立 Local UI 簇。 |
| cluster-04 | Local UI | 3 / 4384 | 2 / 3 | UI shell/assets/history 相对独立，暂不优先迁移。 |
| cluster-05 | Interactive Turn Runtime | 15 / 2885 | 29 / 29 | Interactive turn + shared turns 被识别为同一应用流附近的簇，仍需收窄 Bridge Host 边。 |
| cluster-06 | Local Codex Session Index | 10 / 2155 | 3 / 1 | 自然边界成立，应保持胖而紧凑，对外走 facade。 |
| cluster-07 | Weixin Adapter | 6 / 1088 | 7 / 8 | 自然簇基本成立，但仍需审计 adapter 对 context/store/support 的边。 |
| cluster-08 | Session Health Runtime | 3 / 972 | 4 / 4 | 自然边界成立，暂不优先迁移。 |
| cluster-09 | Bridge markdown | 3 / 965 | 0 / 3 | 自然边界成立，暂不优先迁移。 |
| cluster-10 | Mirror Runtime | 6 / 877 | 10 / 12 | 职责集中但与 Bridge Host 双向边明显，应找真实状态 owner。 |

## 主要结论

### cluster-01 不能再靠 composition 换壳

`cluster-01` 的前四个构成是 Bridge Host 3895 行 / 17 文件、Feishu Adapter 2882 行 / 1 文件、Mirror Runtime 1319 行 / 4 文件、Markdown Rendering 811 行 / 1 文件，内部跨聚合边 23。热点文件包括 `src/lib/bridge/bridge-manager.ts`、`src/lib/bridge/adapters/feishu-adapter.ts`、`src/lib/bridge/mirror-feedback-controller.ts`、`src/lib/bridge/markdown/feishu.ts`。

潜在目标不是创建 `bridge-composition`、`bridge-runtime-wiring` 之类大参数对象。正确方向是让 Bridge Host 保留启动/路由/生命周期入口，platform adapter 只拥有平台协议，mirror runtime 拥有 cursor/suppression/delivery 状态机。

### cluster-02 是新的 command/provider 混合热点

`cluster-02` 的前四个构成是 Command Application 4460 行 / 14 文件、Execution Providers 1600 行 / 4 文件、Bridge Host 998 行 / 5 文件、Session Registry 929 行 / 3 文件，内部跨聚合边 78。热点包括 `src/lib/bridge/command/session-thread.ts`、`src/lib/bridge/command/diagnostics.ts`、`src/codex/provider.ts`、`src/codex/tmux-provider.ts`。

本阶段已经把 UI/command 对 `session-registry/bindings.ts` 的直接 import 改到 `session-registry.ts` public facade，降低了 bindings internals 泄漏；但 command 仍需要继续收窄对 Local Codex Session Index、Display Query、Bridge Host runtime facts 和 provider 细节的直接依赖。不能用空 facade 掩盖 command 出边，只有当命令用户故事入口更稳定时才移动或拆分。

### cluster-03 仍是 UI/配置/持久化混合簇

`cluster-03` 的前四个构成是 Local UI 2107 行 / 12 文件、Config / Service 1990 行 / 4 文件、Store / Persistence 1281 行 / 2 文件、Weixin Support 914 行 / 2 文件，内部跨聚合边 36。热点文件包括 `src/service-manager.ts`、`src/config.ts`、`src/store.ts`、`src/weixin/login.ts`。

目标边界仍是 Operator UI application、Configuration / Service Management、Store / Persistence、Weixin Support 和 Session Registry 分清 owner。UI application 不应直接读取 config/store/local Codex 细节；应通过明确 query/source/service，而不是万能 app context。

### cluster-05 是 interactive turn 应用流，不是继续拆小文件的理由

Interactive Turn Runtime 现在 15 文件 / 2885 行，主要热点是 `runner.ts`、`sdk-conversation-engine.ts`、`stream-ui-controller.ts`、`sdk-stream-events-controller.ts`。这说明 `interactive-turn/` 与 `turns/` 的关系仍需要命名解释，但它们确实围绕 inbound IM turn 和 shared turn primitives 聚集。

后续不能继续靠小 controller 数量制造“变干净”的错觉。更值得处理的是 `runInteractiveMessage` 入口认知成本、`consumeStream` 内部状态机，以及 runner 与 Bridge Host 的具体端口边。

### cluster-06 是明确自然边界

Local Codex Session Index 10 文件 / 2155 行，出边 3、入边 1，是目前最稳定的自然边界之一。目标形态：`src/codex/session-index.ts` 是对外 facade，内部 `session-index/*` 保留 JSONL parser、history parser、event mirror parser、archive/import metadata 等实现细节。后续应扫描并防止外部直接 import `src/codex/session-index/*` 内部文件。

### cluster-07 和 cluster-10 暂不急搬目录

Weixin Adapter 与 Mirror Runtime 都已经被新依赖图识别成相对独立的自然簇。下一步如果碰它们，应先审计最大外聚函数和热点边：

- Weixin Adapter：重点看 adapter 对 `context.ts`、Weixin support store/login、platform API helper 的依赖是否应收窄。
- Mirror Runtime：重点看 `mirror-feedback-controller.ts`、`mirror-runtime.ts` 与 Bridge Host / stream feedback / final response assembly 的边界。

## 下一阶段建议

优先级按当前阶段连续性和结构收益排序：

1. 完成 `session registry query facade audit`：阶段收口时跑 build/full test/diff check 并 amend。这个阶段已让 UI/command 从 `bindings.ts` internal owner 改走 `session-registry.ts` public facade。
2. 继续 command/provider 混合簇：审计 `session-thread.ts` / `diagnostics.ts` 对 Local Codex Session Index、display query、bridge runtime facts 的直接依赖。
3. 回到 `cluster-01`：选择 mirror/adapter/bridge-manager 的一个双向依赖切片，移动真实状态规则或收窄具体端口；禁止新增大而空的 composition/factory。
4. 对 Local Codex Session Index 做外部内部路径扫描，若发现外部 import 内部文件，改走 `src/codex/session-index.ts` facade。

## 明确禁止的误判

- 不把混合簇直接命名成目标模块。
- 不把自然聚类编号变化当成架构改善或退化的直接证明。
- 不把文件数减少等同于复杂度降低。
- 不用大 deps object、composition/factory facade 掩盖状态机和跨层读取。
- 不为了消除一个 import 就把同一个 invariant 拆到多个文件。
- 不让 UI/command/adapter 各自复制 session/thread/display 规则。
