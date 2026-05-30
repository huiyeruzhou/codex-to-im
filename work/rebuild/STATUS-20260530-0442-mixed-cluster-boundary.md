# 2026-05-30 04:42 混合簇边界审计归档

## 阶段目标

基于自然聚类结果审计 `cluster-01` 与 `cluster-02` 的混合原因，定位具体跨职责依赖边和缺失端口，形成下一刀自然边界方案。

## 原始行动记录

- 读取当前工作树、最近提交、`STATUS.md` 和自然聚类报告，确认上一阶段已提交 `Add natural source clustering audit`。
- 当前工作树仅 `AGENTS.md` 未提交，作为用户侧协作规范更新保留；本阶段不纳入提交。
- 从 `source-file-audit.json` 生成 `cluster-01` / `cluster-02` 的内部跨聚合边、热点文件、候选拆分边界和跨 cluster 边统计。
- 扩展 `source-audit.mjs`，在 `source-file-audit.json` / `source-file-audit.md` 中生成“混合簇边界审计”。
- 新增 `mixed-cluster-boundary-audit.md`，记录 `cluster-01` / `cluster-02` 的混合原因和下一刀建议。
- 读取热点文件以校准结论：`types.ts`、`channel-adapter.ts`、`host.ts`、`mirror-feedback-controller.ts`、`ui-server.ts`、`config.ts`、`store.ts`、`bridge-manager.ts`。

## 关键命令和输出摘要

- `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && node source-audit.mjs`
  - 输出：`Wrote work/rebuild/source-file-audit.json`
  - 输出：`Wrote work/rebuild/source-file-audit.md`
- `grep -n '^## ' STATUS.md && grep -nE '^## 当前规划|^#### ' STATUS.md || true`
  - h2 只包含 `## 任务目标`、`## 任务上下文`、`## 任务日志`。
  - 旧 `## 当前规划` 和 h4 扫描无输出。
- `git diff --check -- STATUS.md source-audit.mjs source-file-audit.json source-file-audit.md mixed-cluster-boundary-audit.md`
  - 输出为空，通过。

## 审计事实

### cluster-01

- 名称：`Mixed: Bridge Host / Feishu Adapter / Mirror Runtime`
- 内部跨聚合边：71 条。
- 热点文件：
  - `src/lib/bridge/types.ts`：16 条。
  - `src/lib/bridge/mirror-feedback-controller.ts`：10 条。
  - `src/lib/bridge/adapters/feishu-adapter.ts`：9 条。
  - `src/lib/bridge/bridge-manager.ts`：9 条。
  - `src/codex-session-index.ts`：8 条。
- 判断：
  - 一部分混合来自 shared contracts 被归入 `Bridge Host / Runtime Contracts`，例如 `types.ts`、`host.ts`、`channel-adapter.ts`。
  - 另一部分是真实耦合：`bridge-manager.ts` 直接读取 mirror/turn internals；`mirror-feedback-controller.ts` 同时读取 mirror turn state、delivery layer、stream feedback controller、turn response assembler 和 stream-state。

### cluster-02

- 名称：`Mixed: Local UI / Config / Service / Store / Persistence`
- 内部跨聚合边：26 条。
- 热点文件：
  - `src/config.ts`：9 条。
  - `src/ui-server.ts`：8 条。
  - `src/store.ts`：7 条。
  - `src/main.ts`：4 条。
  - `src/service-manager.ts`：3 条。
- 判断：
  - `ui-server.ts` 仍同时承担 HTTP shell、认证、静态 UI、配置读写、服务控制、Codex model 查询、Weixin 登录流程、binding/session route composition。
  - 已存在 `ui-session-routes.ts`、`ui-binding-routes.ts`、`src/ui/application/session.ts`、`src/ui/application/binding.ts`，说明 UI 应用层拆分已经开始，但 `ui-server.ts` 还没有收缩成 composition root + route declarations + static shell。

## 阶段审计结论

- 本阶段满足用户纠偏：继续从全文件自然聚类出发，没有回到 command 风险榜。
- 本阶段没有改生产代码，只增强可复跑审计和文档化下一刀方案。
- `cluster-01` 是更大的结构性风险，但直接重构前需要先分清 shared contracts、delivery primitives、runtime host 三类职责，否则容易制造高 churn 的机械搬移。
- 下一阶段建议优先进入 `cluster-02` 的 UI server 收缩：把设置、服务控制、Weixin 登录、模型列表等 workflow 从 `ui-server.ts` 移到 UI application/route 模块，让 `ui-server.ts` 成为 composition root + route dispatch + static shell。
