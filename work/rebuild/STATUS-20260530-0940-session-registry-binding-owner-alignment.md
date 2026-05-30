# 2026-05-30 09:40 阶段归档：session registry binding owner alignment

## 阶段描述

继续 `cluster-02`，聚焦 `src/session-bindings.ts`、`src/lib/bridge/session-registry.ts`、`src/ui/application/binding.ts`、`src/ui/application/chat-display.ts` 和 command 对 binding list 的引用；审计 binding/default-target mutation owner 是否应从顶层 `src` 收入 Session Registry 目录，改善“绑定/默认目标/切换会话”用户故事入口和 `src` 顶层可读性，同时避免新增小 util 或扩大测试矩阵。

## 原始行动记录

- 2026-05-30 09:31 已开启新阶段。当前 HEAD 为 `16314a6 Rebuild source architecture`，工作树仅有用户侧 `AGENTS.md` 和本次 `STATUS.md` 记录改动。第一轮审计确认 `src/session-bindings.ts` 644 行、7 个本地 import、3 条风险跨聚合 import，承担 binding uniqueness、BridgeSession materialize、binding summaries、channel default target mutation、binding switch/remove 和 Local Codex lookup；引用方包括 `SessionRegistryService`、UI chat-display、command diagnostics/session-thread/thread-display 和 `session-bindings.test.ts`。该文件不是真正顶层入口，路径名也不能表达它属于 Session Registry，因此本阶段选择目录/命名收口：将其移入 `src/lib/bridge/session-registry/bindings.ts`，同步将测试重命名为 `session-registry-bindings.test.ts`，并更新调用方 import。暂不拆分内部函数，避免把一个 registry invariant 拆碎。当前 `npm run typecheck` 通过；registry/UI/command 定向测试 43 tests / 5 suites 全部通过；`node work/rebuild/source-audit.mjs` 通过。最新审计显示顶层 `src/*.ts` 从 14 降到 13；`bindings.ts` 和 `SessionRegistryService` 同归 `cluster-01` / Session Registry，路径入口更可猜；全局文件数和 import 边数不变，说明本阶段是 owner 归位，不宣称全局耦合下降。
- 2026-05-30 09:36 根据用户 09:35 纠偏转入依赖审计校准：`source-audit.mjs` 已更新聚合识别、自然聚类解读和“潜在聚合分析”，重新生成的 `source-file-audit.md/json` 显示 203 个 `src/**/*.ts` 文件、774 条本地 import/re-export 边、1562 个函数节点、1742 条函数依赖边。新 cluster 形态把 Local Codex Session Index、Execution Providers、Weixin Adapter、Weixin Support、Session Registry 从旧混合分类里拆得更清楚：`cluster-05` 是 Local Codex Session Index 自然边界，`cluster-06` 是 Weixin Adapter，`cluster-04` 是 Interactive Turn Runtime；`cluster-01` 仍混合 Bridge Host / Feishu Adapter / Execution Providers / Mirror Runtime / Session Registry，`cluster-02` 仍混合 Local UI / Config / Service / Store / Weixin Support。下一步把这次聚合分析写入独立文档 `work/rebuild/cluster-aggregation-analysis.md`，作为后续选择阶段边界的依据。
- 2026-05-30 09:38 已新增 `work/rebuild/cluster-aggregation-analysis.md`，单独记录最新审计基线、9 个自然 cluster、主要聚合判断、下一阶段建议和明确禁止的误判。二次校准 `source-audit.mjs` 的 anti-pattern 判断顺序，避免 `cluster-02` 因 `ui/application/binding.ts` 被误判成纯 registry 风险；重新生成 `source-file-audit.md/json` 后，`cluster-02` 的明确规避为 UI application 不应直接读取 config/store/local Codex 细节。文档结论保持与 `source-file-audit.md` 一致：先完成当前 Session Registry binding owner 收口，再考虑 registry query facade 或回到 `cluster-01` 审计 mirror/adapter/bridge-manager 的真实状态 owner；禁止新增大而空的 composition/factory。
- 2026-05-30 09:39 阶段收口验证：按 Node.js 24 运行 `npm run build` 通过；运行 `npm test` 通过，488 tests / 91 suites 全部通过；`git diff --check` 通过。

## 修改摘要

- 将顶层 `src/session-bindings.ts` 移入 `src/lib/bridge/session-registry/bindings.ts`，保持 binding/default target/materialize 规则在同一个 registry owner 内，没有拆碎内部 invariant。
- 将 `src/__tests__/session-bindings.test.ts` 重命名为 `src/__tests__/session-registry-bindings.test.ts`，测试描述从 `session-bindings uniqueness` 调整为 `session registry bindings`。
- 更新引用方 import：`SessionRegistryService`、`src/ui/application/chat-display.ts`、command diagnostics/session-thread/thread-display。
- 更新 `work/rebuild/source-audit.mjs`：识别新目录后的 Session Registry、Local Codex Session Index、Weixin Adapter、Weixin Support、Execution Providers；新增潜在聚合分析；校准 anti-pattern 判断顺序。
- 重新生成 `work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md`。
- 新增 `work/rebuild/cluster-aggregation-analysis.md`，作为后续阶段边界选择的独立分析入口。

## 审计事实

- 最新全源审计：203 个 `src/**/*.ts` 文件，其中生产 136、测试 67；本地 import / re-export 边 774；函数节点 1562；函数依赖边 1742，其中内聚 1481、外聚 261。
- 顶层 `src/*.ts` 从 14 降到 13，`src/session-bindings.ts` 不再作为顶层文件存在。
- `src/lib/bridge/session-registry/` 现在承载 bindings owner；`src/lib/bridge/session-registry.ts` 继续作为 Session Registry facade/service。
- 新自然聚类：`cluster-05` 是 Local Codex Session Index 自然边界；`cluster-06` 是 Weixin Adapter；`cluster-04` 是 Interactive Turn Runtime；`cluster-01` 仍是 Bridge Host / Feishu Adapter / Execution Providers / Mirror Runtime / Session Registry 混合簇；`cluster-02` 仍是 Local UI / Config / Service / Store / Weixin Support 混合簇。
- 阶段收益是路径和 owner 归位，降低“绑定/默认目标/切换会话”用户故事入口的不确定性；不宣称全局耦合下降。

## 验证摘要

- 已通过：`npm run typecheck`。
- 已通过：`node --test --import tsx src/__tests__/session-registry-bindings.test.ts src/__tests__/session-registry.test.ts src/__tests__/ui-binding-application.test.ts src/__tests__/command-dispatch.test.ts src/__tests__/bridge-command-e2e.test.ts`，43 tests / 5 suites 全部通过。
- 已通过：`node work/rebuild/source-audit.mjs`。
- 已通过：`npm run build`。
- 已通过：`npm test`，488 tests / 91 suites 全部通过。
- 已通过：`git diff --check`。

## 阶段反思

- 这次阶段边界覆盖了一个合理 cluster 切片：registry binding owner、UI display query 调用方、command binding 调用方和审计脚本，而不是单文件移动后立刻提交。
- `bindings.ts` 仍然有 644 行，当前选择不拆分是刻意的：binding uniqueness、default target、BridgeSession materialize 和 binding summaries 是同一个 registry invariant 家族，机械拆开会降低可读性。
- 新的 cluster 分析明确提醒，下一步不能用 composition/factory facade 掩盖 `cluster-01` 的 bridge/mirror/adapter 状态耦合，也不能把 `cluster-02` 的 UI/config/store 混合合理化成一个大模块。

## 下一个阶段建议

- 优先审计 UI chat-display / command 是否仍应直接 import `session-registry/bindings.ts`，判断是否需要 registry query facade；如果做 facade，必须承载真实 use case/query 规则，不能成为空转发层。
- 或回到 `cluster-01`，选择 bridge-manager 与 mirror/adapter 的一个双向依赖切片，移动真实状态规则或收窄具体端口；禁止新增大而空的 composition/factory。
