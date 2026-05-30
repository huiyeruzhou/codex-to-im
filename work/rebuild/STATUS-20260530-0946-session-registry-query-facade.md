# 2026-05-30 09:46 阶段归档：session registry query facade audit

## 阶段描述

继续 Session Registry 方向，审计 `src/ui/application/chat-display.ts` 和 command diagnostics/session-thread/thread-display 对 `src/lib/bridge/session-registry/bindings.ts` 的直接 import；判断是否需要通过 `src/lib/bridge/session-registry.ts` 暴露更稳定的 registry query/use case facade，从而让外部调用方不依赖 registry 内部文件，同时避免空 facade 和重复测试。

## 原始行动记录

- 2026-05-30 09:42 已开启新阶段。当前 HEAD 为 `598112a Rebuild source architecture`，工作树仅剩用户侧 `AGENTS.md` 未提交改动。第一步读取 `session-registry.ts`、`session-registry/bindings.ts`、UI chat-display 和 command binding 调用点，确认直接 import 的函数是否是 registry 对外查询/命令语义，还是只属于内部 helper。
- 2026-05-30 09:45 审计结论：UI chat-display 和 command diagnostics/thread-display/session-thread 直接使用的 `listBindingSummaries`、`listBindingTargetOptions`、`listChannelDefaultTargetSummaries`、`listBindingsForChat`、`setActiveBindingForChat` 都是 Session Registry 对外 query/use case 语义，不是内部算法 helper；因此本阶段不新增新 facade 文件，只在已有 `src/lib/bridge/session-registry.ts` 公共入口 re-export 这些查询/切换 API，并把 UI/command import 改到该 facade。`session-registry/bindings.ts` 继续保留真正的 binding owner 和内部规则，focused binding tests 仍直接测试该 owner。
- 2026-05-30 09:45 定向验证通过后重新跑 `source-audit.mjs`，最新审计显示本地 import/re-export 边从 774 到 775，原因是 `session-registry.ts` 增加 public re-export；Local UI 风险跨聚合 import 从 9 降到 8，Command Application 从 46 降到 43，说明 UI/command 不再直接依赖 bindings internal owner。自然聚类编号随 facade 边变化重新洗牌为 10 个 cluster，因此已更新 `cluster-aggregation-analysis.md`，明确自然聚类只是边界线索，后续判断仍以业务 owner、路径可预测性和跨层读取是否减少为准。
- 2026-05-30 09:46 阶段收口验证：`npm run build` 通过；`npm test` 通过，488 tests / 91 suites 全部通过；`git diff --check` 通过。

## 修改摘要

- `src/lib/bridge/session-registry.ts` 作为 Session Registry public facade，re-export `BindingSummary`、`BindingTargetOption`、`ChannelDefaultTargetSummary`、`listBindingSummaries`、`listBindingsForChat`、`listBindingTargetOptions`、`listChannelDefaultTargetSummaries`、`setActiveBindingForChat`。
- `src/ui/application/chat-display.ts` 改为从 `../../lib/bridge/session-registry.js` import registry query API。
- `src/lib/bridge/command/diagnostics.ts`、`src/lib/bridge/command/thread-display.ts`、`src/lib/bridge/command/session-thread.ts` 改为从 `../session-registry.js` import binding query/switch API。
- `src/lib/bridge/session-registry/bindings.ts` 继续作为内部 owner；没有拆分 binding uniqueness、default target、materialize 和 summaries 规则。
- `work/rebuild/source-audit.mjs` 校准自然聚类命名和潜在聚合判断：`interactive-turn + turns` 识别为 Interactive Turn Runtime；含 command 的混合簇优先按 command/provider 出边分析，不误判成纯 Session Registry。
- `work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md` / `work/rebuild/cluster-aggregation-analysis.md` 已按最新依赖图更新。

## 审计事实

- 最新全源审计：203 个 `src/**/*.ts` 文件，其中生产 136、测试 67；本地 import / re-export 边 775；函数节点 1562；函数依赖边 1743，其中内聚 1481、外聚 262。
- UI/command 对 `session-registry/bindings.ts` 的直接 import 已清零；剩余 direct import 只有 `session-registry.ts` 自身和 focused owner test。
- Local UI 风险跨聚合 import 从 9 降到 8；Command Application 风险跨聚合 import 从 46 降到 43。
- 自然聚类从 9 个变为 10 个，说明 label propagation 对 facade/re-export 边敏感；因此后续不能机械按 cluster 编号判断阶段边界。

## 验证摘要

- 已通过：`npm run typecheck`。
- 已通过：`node --test --import tsx src/__tests__/session-registry-bindings.test.ts src/__tests__/session-registry.test.ts src/__tests__/ui-binding-application.test.ts src/__tests__/command-dispatch.test.ts src/__tests__/bridge-command-e2e.test.ts`，43 tests / 5 suites 全部通过。
- 已通过：`node work/rebuild/source-audit.mjs`。
- 已通过：`npm run build`。
- 已通过：`npm test`，488 tests / 91 suites 全部通过。
- 已通过：`git diff --check`。

## 阶段反思

- 这个 facade 有真实收益：外部调用方现在依赖 Session Registry 公共入口，而不是内部 `bindings.ts` owner 文件。
- 这不是新建空 facade，也没有拆碎 registry invariant；`session-registry.ts` 已经是现有 service/facade，本阶段只是补齐它应公开的 query/use case API。
- re-export 增加了一条 import 边并导致自然聚类编号变化，这暴露了审计指标的局限；后续评估必须结合业务 owner 和路径可预测性。

## 下一个阶段建议

- 优先转向 command/provider 混合簇，审计 `session-thread.ts` / `diagnostics.ts` 对 Local Codex Session Index、display query、bridge runtime facts 的直接依赖。
- 或回到 `cluster-01`，选择 bridge-manager 与 mirror/adapter 的真实状态 owner 切片；禁止新增大而空的 composition/factory。
