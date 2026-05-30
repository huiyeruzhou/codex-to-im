# 2026-05-30 04:49 UI service routes 阶段归档

## 阶段目标

基于 `cluster-02` 审计结论，把 `ui-server.ts` 中的一个明确 UI workflow 迁出到 UI application/route 模块，降低 Local UI / Config / Service / Store 混合簇的耦合。

## 原始行动记录

- 根据 `mixed-cluster-boundary-audit.md` 进入 `cluster-02` 的 UI server 收缩阶段。
- 审计 `ui-server.ts` 的 imports、helper、route dispatch 和现有 `ui-session-routes.ts` / `ui-binding-routes.ts` 模式。
- 选择服务控制 workflow 作为第一刀：
  - `GET /api/status`
  - `POST /api/install-codex-integration`
  - `POST /api/bridge/start`
  - `POST /api/bridge/stop`
  - `POST /api/bridge/restart`
  - `GET /api/logs`
- 新增 `src/ui-service-routes.ts`，承接上述 route。
- `ui-server.ts` 删除 service-manager 的直接服务控制 imports，只保留 `getUiServerUrl` 和 `writeUiServerStatus` 这类 server lifecycle 依赖；通过 `handleUiServiceRoute` 注入 UI access 和 Weixin accounts 的页面上下文。
- 新增 `src/__tests__/ui-service-routes.test.ts`，覆盖 `/api/logs` route 以及非本模块 route pass-through。
- 复跑 `source-audit.mjs` 更新 `source-file-audit.json` / `.md`。

## 关键命令和输出摘要

- `npm run typecheck`
  - 通过。
- `node --test --import tsx src/__tests__/ui-service-routes.test.ts src/__tests__/service-manager.test.ts`
  - 19 tests 全部通过。
- `npm run build`
  - 输出：`Built dist/daemon.mjs, dist/ui-server.mjs, dist/cli.mjs`
- `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && node source-audit.mjs`
  - 输出：`Wrote work/rebuild/source-file-audit.json`
  - 输出：`Wrote work/rebuild/source-file-audit.md`
- `git diff --check -- src/ui-server.ts src/ui-service-routes.ts src/__tests__/ui-service-routes.test.ts work/rebuild/STATUS.md work/rebuild/source-file-audit.json work/rebuild/source-file-audit.md`
  - 输出为空，通过。

## 审计事实

- 当前 `src/**/*.ts` 文件：179 个，其中生产 121 个、测试 58 个。
- 本地 import / re-export 边：715 条。
- `ui-server.ts`：4313 行，仍在 `cluster-02`。
- `src/ui-service-routes.ts`：83 行，位于 `cluster-02`，只直接依赖 `service-manager.ts`。
- 本阶段不声称解决 `cluster-02` 混合簇；它只是把 service control workflow 从 UI shell 中迁出，给后续迁出 config/channel/Weixin workflow 建立 route 模块模式。

## 阶段审计结论

- 本阶段符合自然聚类方向：从 `cluster-02` 的 `ui-server.ts` 混合职责出发，不再按 command 风险榜推进。
- `ui-server.ts` 更接近 composition root + route dispatch + static shell，但仍保留 config/channel/Weixin/model workflow，需要后续继续收缩。
- 下一阶段建议继续迁出 `ui-server.ts` 中的 channel config / Weixin login workflow，或先为 config save/channel save 定义 UI application 层窄接口。
