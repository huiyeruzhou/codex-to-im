# 文档清理笔记

## 当前保留文档

- `docs/current-architecture.md`：当前架构主入口，定义 Codex session、BridgeSession、IMChannel、Binding、功能模块、数据边界、对话模式、命令 scope 和 UI 映射。
- `docs/backend-status.md`：存储和后端状态说明。最近已更新 `ui-session-meta.json` 迁移。
- `docs/json-schemas.md`：schema 和迁移策略说明。最近已更新 UI session name 迁移。
- `src/lib/bridge/SECURITY.md`：bridge 安全说明，暂未发现会误导当前架构判断的旧身份模型。

## 已删除过时文档

- `docs/codex-to-im-prd.md`
- `docs/codex-to-im-shared-thread-design.md`
- `docs/dev-plan.md`
- `docs/thread-binding-card-technical-report.md`
- `src/lib/bridge/ARCHITECTURE.md`
- `src/lib/bridge/MIGRATION.md`
- `src/lib/bridge/CONTRIBUTING.md`
- `STATUS.md`
- `src/lib/bridge/README.md`

## 清理方向

不要一开始就按未来理想结构重写公开文档。应先写准当前架构：

- 产品概念和不变量；
- 用户故事和 use cases；
- 依赖聚类；
- 已知术语偏差和过时内容；
- 建议模块边界和迁移顺序。

之后再把旧文档标记为：

- 当前有效且权威；
- 历史设计说明；
- 部分过时，并链接到替代章节；
- 已废弃，可以删除。

## 过时或高风险术语

- `CodePilot`：仍出现在 `codepilotSessionId` 这类类型名里；产品文档现在应围绕 Codex-to-IM 和 Bridge session 表达。
- `sdkSessionId`：旧 thread identity 术语。当前 canonical 字段是 `BridgeSession.codex_thread_id`。
- `SharedSession`：设计文档里的概念。当前实现是 `BridgeSession` 加 `codex_thread_id`。
- `Desktop Session`：既指真实 Codex JSONL session，也被 UI 用作行类型，需要精确定义。
- `source`：在 execution source、Codex JSONL source、UI badge、channel provider 之间重载。

## 建议正式文档产物

- `docs/current-architecture.md`：当前状态架构和模块职责。
- `docs/domain-model.md`：session、binding、thread、source/provenance、display title、provider、runtime status 的 canonical 定义。
- `docs/use-cases.md`：用户故事和 use-case flows。
- `docs/module-boundaries.md`：允许依赖方向和 extraction plan。

这些文档应在分析结论稳定后，由 `work/analysis` 下的草案整理生成。
