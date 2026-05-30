# 阶段归档：interactive turn stop callback port

## 阶段描述

继续 `cluster-01`，聚焦 `runner.ts` 剩余 command callback 依赖；审计 structured stream UI stop action 是否应由 Bridge Host / command callback owner 提供端口。目标是在不新增文件、不扩大测试数量的前提下降低 runner 对 command callback 格式的直接读取。

## 原始行动记录

- 2026-05-30 07:43 已开启新阶段。当前 HEAD 为 `d7695a0 Port interactive turn permission forwarding`；工作树仅剩用户侧 `AGENTS.md` 未提交改动。下一步读取 `runner.ts`、`stream/ui-controller.ts`、`command-callbacks.ts`、`bridge-manager.ts` 和相关测试，判断 stop callback 格式能否通过 deps 从 bridge manager 注入，避免 runner 继续 import command callback helper。
- 2026-05-30 07:45 完成 stop callback 端口收缩：`runner.ts` 不再 import `command-callbacks.ts`，新增 `BuildStopCallbackData` 端口，由 `bridge-manager.ts` 显式传入 `(sessionId) => buildCommandCallbackData('/stop', sessionId)`。`stream/ui-controller.ts` 的 `stopCallbackData` 改为可选，只在提供 callback 数据时渲染 structured stream stop action；生产路径保持 stop 按钮，测试路径无需新增 mock owner，也避免复制 `cti-command` 格式。
- 2026-05-30 07:46 targeted tests 已通过 118 tests / 12 suites；第一次 `npm run typecheck` 暴露 bridge manager 组合根漏 import `buildCommandCallbackData`，已把 `command-callbacks.ts` imports 合并修正。该问题说明本阶段修改范围仍是端口组合根修正，不是新增行为。
- 2026-05-30 07:46 修正后 `npm run typecheck` 和 `node work/rebuild/source-audit.mjs` 通过。最新审计：202 个源文件不变，本地 import / re-export 边 771 降到 769；`Interactive Turn Runtime` 风险 import 从 16 降到 15；`runner.ts` 直接 import 从 15 降到 14，风险 import 从 2 降到 1；`runInteractiveMessage` 外聚度从 1 降到 0。下一步补跑 build、full test、diff check 后做阶段审计归档。
- 2026-05-30 07:47 已通过 `npm run build`、`npm test`（487 tests / 90 suites）和 `git diff --check`。当前进入阶段审计：准备将原始行动、审计事实和验证摘要归档到 `work/rebuild/STATUS-20260530-0747-interactive-turn-stop-callback-port.md`，并把主状态压缩为阶段结论。

## 修改范围

- `src/lib/bridge/interactive-turn/runner.ts`
  - 删除对 `../command-callbacks.js` 的直接 import。
  - 新增本地 `BuildStopCallbackData` 端口类型。
  - `createInteractiveStreamUiController` 参数改为从 `deps.buildStopCallbackData?.(binding.bridgeSessionId)` 获取 stop callback 数据。
- `src/lib/bridge/interactive-turn/stream/ui-controller.ts`
  - `stopCallbackData` 改为可选。
  - 只有在 callback 数据存在时渲染 structured stream stop action；生产路径由 bridge manager 提供，测试路径不需要复制 command callback 格式。
- `src/lib/bridge/bridge-manager.ts`
  - 合并 `command-callbacks.ts` imports。
  - 调用 `runInteractiveMessage` 时显式传入 `buildStopCallbackData: (sessionId) => buildCommandCallbackData('/stop', sessionId)`。
- `work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md`
  - 由 `node work/rebuild/source-audit.mjs` 重写。

## 审计事实

- 源文件数保持 202（生产 136，测试 66），没有新增测试文件或生产 owner 文件。
- 本地 import / re-export 边从 771 降到 769。
- `Interactive Turn Runtime` 风险跨聚合 import 从 16 降到 15。
- `src/lib/bridge/interactive-turn/runner.ts` 直接 import 从 15 降到 14，风险 import 从 2 降到 1；风险摘要中不再列出 `command-callbacks.ts`，只剩 `security/validators.ts`。
- `runInteractiveMessage` 外聚度从 1 降到 0。
- `cluster-01` 仍是最大混合簇，`environment/turn-environment.ts` 仍直接读取 router/context/display；本阶段不宣称 cluster 完成。

## 验证

- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --import tsx src/__tests__/interactive-turn-runner.test.ts src/__tests__/bridge-manager.test.ts src/__tests__/stream-feedback-controller.test.ts src/__tests__/feishu-adapter.test.ts`，118 tests / 12 suites 全部通过。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node work/rebuild/source-audit.mjs`。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`，487 tests / 90 suites 全部通过。
- 已通过：`git diff --check`。

## 阶段结论

本阶段完成了 runner 的 stop callback 端口收缩。收益是 command callback 格式回到 bridge manager / command callback owner 一侧，interactive turn runner 不再直接知道 `cti-command` 格式；`runInteractiveMessage` 的函数级外聚度降为 0。代价是 `stream/ui-controller.ts` 允许测试路径缺省 stop action，生产路径由组合根保证；后续如果需要更强约束，可在 runner 测试辅助中统一提供该端口。下一阶段应继续处理 `environment/turn-environment.ts` 对 router/context/display 的直接读取，或继续收缩 `stream/ui-controller.ts` 对 stream feedback controller 的边界。
