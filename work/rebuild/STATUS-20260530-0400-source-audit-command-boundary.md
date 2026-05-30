# 2026-05-30 04:00 Source Audit / Command Boundary Archive

## 阶段目标

覆盖当前每一个 `src/**/*.ts` 文件，生成机器可复核的全源文件审计产物，并基于审计先处理最明确的 bridge runtime / command presentation 反向依赖。

## 原始事实与产物

- 新增审计脚本：`work/rebuild/source-audit.mjs`
- 审计产物：`work/rebuild/source-file-audit.json`
- 审计摘要：`work/rebuild/source-file-audit.md`
- 初始审计基线：174 个 TS 文件，生产 117 个、测试 57 个，本地 import / re-export 702 条。
- 本阶段代码调整后复跑审计：176 个 TS 文件，本地 import / re-export 711 条。
- `Bridge Host / Runtime Contracts` 风险跨聚合 import：从 42 降到 39。
- `bridge-manager.ts` 风险跨聚合 import：从 17 降到 16。
- `thread-display-resolver.ts`：从 321 行降到 226 行，不再 import `command/presentation.ts`。

## 修改记录

- 新增 `src/lib/bridge/command/thread-display.ts`，承接 `/t` command-only 的绑定列表 response、Codex thread rich card、绑定 rich card、binding state DTO 和 command table item assembly。
- 移动 `src/lib/bridge/thread-table-message-pins.ts` 到 `src/lib/bridge/command/thread-table-message-pins.ts`，因为该持久化 helper 只服务 `/t` rich command card pin/update。
- 扩展 `src/lib/bridge/command-callbacks.ts`，把 thread card callback prefix、update key 和 action callback builder 放入 command callback 协议层。
- 新增 `src/lib/bridge/command-errors.ts`，承接 command user-visible error 文案。
- `src/lib/bridge/thread-display-resolver.ts` 降回通用 display/query service。
- `src/lib/bridge/bridge-manager.ts` 不再为 callback 常量或 command presentation helper import `command/presentation.ts`。
- `src/__tests__/bridge-manager.test.ts` 直接 import command aliases / presentation / error helper，不再通过 `_testOnly` re-export 测试这些 helper。

## 验证记录

- `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && node work/rebuild/source-audit.mjs` 通过，生成审计 JSON/Markdown。
- `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm run typecheck` 通过。
- 聚焦测试：`node --test --import tsx src/__tests__/command-dispatch.test.ts src/__tests__/bridge-manager.test.ts src/__tests__/session-bindings.test.ts` 通过，96 tests 全部通过。
- 完整验证：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm test && npm run build` 通过。
- `npm test`：455 tests 全部通过。
- `npm run build`：生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。

## 审计结论

本阶段完成了全源文件审计基线，并证明可以用审计脚本反馈结构性重构效果。当前仍未完成全量 rebuild：

- `bridge-manager.ts` 仍直接 import `command/aliases.ts`、`command/dispatch.ts`、`command/status.ts`。
- `Command Application` 仍直接 import `channel-router.ts`、`session-bindings.ts`、`bridge-session-support.ts`、`tmux/runtime.ts`、`thread-display-resolver.ts` 等内部 helper。
- 下一阶段应建立 command public facade / command ports，继续减少 bridge runtime 与 command internals 的互相读取。
