# 2026-05-30 09:21 src/lib bridge folder alignment archive

## 阶段目标

按用户 09:08 指令，列出当前 `src/*.ts` 与 `src/lib/bridge/**/*.ts` 文件名，找明显相似命名和职责的文件是否应进入同一文件夹，并让顶层 `src` 与 `lib/bridge` 的入口关系更可预测。

## 原始清单

阶段开始时顶层 `src/*.ts` 共 33 个：

`bridge-instance-lock.ts`、`cli.ts`、`codex-models.ts`、`codex-provider.ts`、`codex-routing-provider.ts`、`codex-session-index.ts`、`codex-session-mirror.ts`、`codex-tmux-provider.ts`、`config.ts`、`internal-sessions.ts`、`logger.ts`、`main.ts`、`permission-gateway.ts`、`qrcode.d.ts`、`runtime-options.ts`、`service-manager.ts`、`session-bindings.ts`、`sse-utils.ts`、`storage-migrations.ts`、`store.ts`、`ui-assets.ts`、`ui-auth-routes.ts`、`ui-binding-routes.ts`、`ui-channel-routes.ts`、`ui-config-routes.ts`、`ui-server.ts`、`ui-service-routes.ts`、`ui-session-history.ts`、`ui-session-routes.ts`、`ui-shell.ts`、`ui-weixin-login-routes.ts`、`weixin-login.ts`、`weixin-store.ts`。

`src/lib/bridge/**/*.ts` 共 80 个。明显目录/前缀簇包括：

- `src/lib/bridge/adapters/*`：Feishu adapter 已在 bridge adapters 目录，Weixin adapter 不在。
- `src/lib/bridge/command/*` 与 command facade。
- `src/lib/bridge/interactive-turn/*` 与 `src/lib/bridge/turns/*`。
- `src/lib/bridge/mirror-*`。
- `src/lib/bridge/session-health-*`。
- `src/lib/bridge/display/*`、`markdown/*`、`security/*`、`tmux/*`。

## 修改记录

- 将顶层 UI 文件迁入 `src/ui/`：
  - `ui-server.ts` -> `src/ui/server.ts`
  - `ui-shell.ts` -> `src/ui/shell.ts`
  - `ui-assets.ts` -> `src/ui/assets.ts`
  - `ui-session-history.ts` -> `src/ui/session-history.ts`
  - `ui-*-routes.ts` -> `src/ui/routes/*.ts`
- 更新 `package.json` 的 `dev:ui` 和 `scripts/build.js` 的 UI build entry。
- 将 Weixin adapter 和 helper 迁入 bridge adapters 聚合：
  - `src/adapters/weixin-adapter.ts` -> `src/lib/bridge/adapters/weixin-adapter.ts`
  - `src/adapters/weixin/*` -> `src/lib/bridge/adapters/weixin/*`
- 将 Local Codex source / execution provider 簇迁入 `src/codex/`：
  - `codex-models.ts` -> `src/codex/models.ts`
  - `codex-provider.ts` -> `src/codex/provider.ts`
  - `codex-routing-provider.ts` -> `src/codex/routing-provider.ts`
  - `codex-session-index.ts` -> `src/codex/session-index.ts`
  - `codex-session-index/*` -> `src/codex/session-index/*`
  - `codex-session-mirror.ts` -> `src/codex/session-mirror.ts`
  - `codex-tmux-provider.ts` -> `src/codex/tmux-provider.ts`
- 将 Weixin login/store 收入口：
  - `weixin-login.ts` -> `src/weixin/login.ts`
  - `weixin-store.ts` -> `src/weixin/store.ts`
- 更新生产代码和测试中的 import 路径。

## 验证和修复

- UI 迁移后 `npm run typecheck` 通过。
- UI routes/application 定向测试通过：24 tests / 8 suites。
- Weixin adapter 迁移后首轮 `npm run typecheck` 发现 `weixin-media.ts` 有旧路径 `../../lib/bridge/types.js`，修正为 `../../types.js`。
- UI + Weixin 定向测试通过：41 tests / 13 suites。
- Codex 迁移后 Codex/bridge 定向测试通过：161 tests / 22 suites。
- Codex 迁移后首轮 `npm run typecheck` 发现 `src/codex/session-index/*` 内 3 个旧层级 import，修正为 `../../lib/bridge/...`。
- Weixin login/store 迁移后首轮 UI+Weixin 定向测试失败，原因是 `src/weixin/login.ts` / `src/weixin/store.ts` 仍按旧顶层路径 import `config` 和 bridge adapter helper；修正后 `npm run typecheck` 通过，Weixin 定向测试通过：23 tests / 7 suites。
- 残留旧路径扫描通过。
- `node source-audit.mjs` 通过并刷新审计产物。
- `git diff --check` 通过。
- `npm run build` 通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。
- `npm test` 通过：487 tests / 90 suites。

## 最新形态

- 顶层 `src/*.ts` 从 33 个降到 14 个，剩余主要是真入口或全局基础设施：`main.ts`、`cli.ts`、`config.ts`、`store.ts`、`service-manager.ts`、`storage-migrations.ts` 等。
- `src/ui/` 现在包含 `application/`、`routes/`、`server.ts`、`shell.ts`、`assets.ts`、`session-history.ts`。
- `src/codex/` 现在包含 Local Codex session index、provider、routing provider、tmux provider、mirror cursor。
- `src/lib/bridge/adapters/` 同时包含 Feishu 与 Weixin adapter。
- `src/weixin/` 包含 Weixin QR login 与账号 store。
- 最新 source audit：201 个 `src/**/*.ts` 文件（生产 135，测试 66），本地 import / re-export 边 767。

## 阶段判断

本阶段主要改善命名和目录入口，不声称降低了全局耦合。Source audit 显示部分风险跨聚合 import 数上升，这是目录移动后聚合归类变化和跨层事实暴露更清楚的结果；后续应继续用端口/应用服务降低 UI、command、bridge host 对 `src/codex/*`、`src/config.ts`、`src/store.ts` 的直接依赖。
