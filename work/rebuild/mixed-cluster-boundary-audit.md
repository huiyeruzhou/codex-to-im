# Mixed Cluster Boundary Audit

生成时间：2026-05-30 04:38 +0800

## 输入证据

- `source-file-audit.json`：177 个 `src/**/*.ts` 文件，711 条本地 import / re-export 边，10 个自然聚类候选。
- `cluster-01`：45 文件 / 13414 行 / 内部跨聚合边 71。
- `cluster-02`：18 文件 / 10897 行 / 内部跨聚合边 26。
- 本审计只判断下一阶段边界，不把自然聚类结果直接等同于目标模块。

## cluster-01：Bridge Host / Feishu Adapter / Mirror Runtime 混合簇

### 事实

- 热点文件：
  - `src/lib/bridge/types.ts`：16 条内部跨聚合边。
  - `src/lib/bridge/mirror-feedback-controller.ts`：10 条内部跨聚合边。
  - `src/lib/bridge/adapters/feishu-adapter.ts`：9 条内部跨聚合边。
  - `src/lib/bridge/bridge-manager.ts`：9 条内部跨聚合边。
  - `src/codex-session-index.ts`：8 条内部跨聚合边。
- 主要方向：
  - Interactive Turn Runtime -> Bridge Host / Runtime Contracts：11 条。
  - Bridge Host / Runtime Contracts -> Interactive Turn Runtime：10 条。
  - Mirror Runtime -> Bridge Host / Runtime Contracts：8 条。
  - Feishu Adapter -> Bridge Host / Runtime Contracts：7 条。
  - Session Registry -> Bridge Host / Runtime Contracts：7 条。

### 混合原因

- `Bridge Host / Runtime Contracts` 当前分类过粗，包含至少三类不同职责：
  - Shared contracts：`types.ts`、`host.ts`、`channel-adapter.ts`。
  - Runtime composition/orchestration：`bridge-manager.ts`、`bridge-adapter-runtime.ts`、`interactive-runtime.ts`。
  - Delivery primitives：`delivery-layer.ts`、`feedback-delivery.ts`、`stream-feedback-controller.ts`、`streaming-metadata.ts`、`outbound-artifacts.ts`。
- Feishu adapter 主要通过 shared contracts 和 Feishu markdown renderer 接入 bridge；这部分不应被解读为 adapter 拥有 host runtime 内部。
- `bridge-manager.ts` 仍直接 import mirror internals 和 turn internals，包括 `mirror-turns.ts`、`mirror-suppression.ts`、`mirror-feedback-controller.ts`、`turns/local-codex-terminal-router.ts`、`turns/turn-coordinator.ts`。
- `mirror-feedback-controller.ts` 同时读取 mirror turn state、delivery layer、stream feedback controller、turn response assembler 和 stream-state，说明 mirror feedback 其实是 mirror runtime 与 channel delivery/turn delivery 的交界，不应继续被当成纯 mirror 内部。

### 下一刀候选

1. 先把 shared bridge contracts 作为独立聚合识别出来。
   - 目标文件：`types.ts`、`host.ts`、`channel-adapter.ts`，必要时包含 `context.ts` 的 public access 部分。
   - 目的：避免把所有 adapter / registry / turn 对公共类型的依赖误判为读取 Bridge Host 内部。
   - 风险：如果移动文件路径会造成大量 import churn；第一步可先调整审计分类和文档，后续再考虑目录迁移。
2. 设计 `Mirror Feedback Delivery` 边界。
   - 目标文件：`mirror-feedback-controller.ts` 及其对 delivery/stream/turn helper 的依赖。
   - 目的：让 pure mirror runtime 只负责订阅、cursor、turn buffering、suppression；具体 IM delivery 和 streaming card 更新通过 port 注入。
   - 风险：涉及 bridge-manager、mirror-runtime、turn delivery，多模块行为面较大，需要聚焦测试。
3. 收缩 `bridge-manager.ts` 对 mirror/turn internals 的直接 import。
   - 目标：bridge manager 只组合 mirror runtime public facade、turn coordinator public facade、adapter runtime public facade。
   - 风险：需要先定义 facade，不能只把 import 机械搬到另一个 util。

## cluster-02：Local UI / Config / Service / Store 混合簇

### 事实

- 热点文件：
  - `src/config.ts`：9 条内部跨聚合边。
  - `src/ui-server.ts`：8 条内部跨聚合边。
  - `src/store.ts`：7 条内部跨聚合边。
  - `src/main.ts`：4 条内部跨聚合边。
  - `src/service-manager.ts`：3 条内部跨聚合边。
- 主要方向：
  - Composition Roots -> Configuration / Service Management：4 条。
  - Local UI and Service Management -> Configuration / Service Management：3 条。
  - Local UI and Service Management -> Store / Persistence：3 条。
  - Weixin Adapter -> Configuration / Service Management：3 条。
  - Composition Roots -> Store / Persistence：2 条。

### 混合原因

- `ui-server.ts` 仍同时承担 HTTP server shell、认证、静态 UI、配置读写、服务控制、Codex model 查询、Weixin 登录流程、binding/session route composition。
- `store.ts` 依赖 `config.ts` 的 `CTI_HOME`、`configToSettings`、`findChannelInstance`、`loadConfig`，说明 persistence 与 config migration/default settings 仍有耦合。
- `service-manager.ts` 依赖 `bridge-instance-lock.ts`，但两者都被 UI/CLI composition root 直接使用，导致 service management 与 composition root 边界不清。
- 已存在 `ui-session-routes.ts`、`ui-binding-routes.ts`、`src/ui/application/session.ts`、`src/ui/application/binding.ts`，说明 UI 应用层拆分已经开始，但 `ui-server.ts` 还没有收缩成 composition root + route declarations + static shell。

### 下一刀候选

1. 收缩 `ui-server.ts` 为 UI composition root。
   - 把设置、服务控制、Weixin 登录、模型列表等 workflow 从 `ui-server.ts` 移到 `src/ui/application/*` 或专门 route 模块。
   - `ui-server.ts` 保留 server lifecycle、auth、static asset、route dispatch。
   - 这是 cluster-02 最清晰的自然边界切片。
2. 定义 UI application 对 config/store/service 的窄接口。
   - UI route 不直接复制 config/store/service 规则。
   - 配置保存、channel instance 解析、service 状态查询通过 UI application function 表达。
3. 后续再处理 `store.ts` 对 `config.ts` 的耦合。
   - 这属于 persistence/config 边界，不应和第一刀 UI server 收缩混在同一阶段。

## 下一阶段建议

优先进入 `cluster-02` 的 UI server 收缩阶段。

理由：

- 该边界已经由现有代码结构支持：`ui-session-routes.ts`、`ui-binding-routes.ts` 和 `src/ui/application/*` 已存在。
- 目标与长期架构判断一致：Local UI 是 operator workflow，不是 domain owner；`ui-server.ts` 应成为 composition root + route declarations + static UI shell。
- 不需要先移动大量 shared contracts 路径，能避免在 `cluster-01` 尚未厘清 contracts / delivery / runtime 三类职责前做高 churn 改动。

`cluster-01` 仍是更大的结构性风险；完成 UI server 收缩后，应回到 cluster-01，先把 shared bridge contracts 与 bridge runtime host 从审计模型和代码边界上分开。
