# 阶段归档：interactive turn permission port

## 阶段描述

继续 `cluster-01`，聚焦 `src/lib/bridge/interactive-turn/runner.ts` 对 `permission-broker`、delivery pipeline、bridge host/context 的直接依赖。阶段目标是先选择一个能减少跨层读取或稳定入口的端口收缩，不新增小 owner 文件，不扩大测试数量。

## 原始行动记录

- 2026-05-30 07:37 已开启新阶段。当前 HEAD 为 `5a69ef5 Organize interactive turn directory boundaries`；工作树仅剩用户侧 `AGENTS.md` 未提交改动。下一步读取 `runner.ts`、`permission-broker.ts`、`turns/delivery-pipeline.ts`、`environment/turn-environment.ts` 和相关测试，判断 runner 依赖哪些外部细节，优先寻找可通过注入端口或收缩既有 environment owner 完成的一刀。
- 2026-05-30 07:39 完成 runner 端口审计第一刀：`runner.ts` 对 `permission-broker` 的直接 import 是最清晰的跨聚合风险，因为 bridge manager 已经负责 permission callback，runner 只需要“转发权限请求”端口。已将 `forwardPermissionRequestImpl?: typeof broker.forwardPermissionRequest` 改为本地 `ForwardPermissionRequest` 端口，并由 `bridge-manager.ts` 显式传入 `broker.forwardPermissionRequest`；测试无需新增，未触碰 delivery pipeline 或 command callback 格式，避免同阶段扩大范围。
- 2026-05-30 07:40 已通过 targeted tests、`npm run typecheck` 和 `node work/rebuild/source-audit.mjs`。最新审计：202 个源文件不变，本地 import / re-export 边 772 降到 771；`Interactive Turn Runtime` 风险跨聚合 import 从 17 降到 16；`runner.ts` 直接 import 从 16 降到 15，风险 import 从 3 降到 2；`runInteractiveMessage` 外聚度从 2 降到 1。下一步补跑 `npm run build`、`npm test` 和 `git diff --check` 后做阶段审计归档。
- 2026-05-30 07:41 已通过 `npm run build`、`npm test`（487 tests / 90 suites）和 `git diff --check`。当前进入阶段审计：准备将原始行动、审计事实和验证摘要归档到 `work/rebuild/STATUS-20260530-0741-interactive-turn-permission-port.md`，并把主状态压缩为阶段结论。

## 修改范围

- `src/lib/bridge/interactive-turn/runner.ts`
  - 删除对 `../permission-broker.js` 的直接 import。
  - 新增本地 `ForwardPermissionRequest` 端口类型。
  - 将 `forwardPermissionRequestImpl?: typeof broker.forwardPermissionRequest` 改为 `forwardPermissionRequest?: ForwardPermissionRequest`。
  - 权限请求到来时通过 deps 端口转发；如果生产组合根未配置该端口则显式报错。
- `src/lib/bridge/bridge-manager.ts`
  - 在调用 `runInteractiveMessage` 时显式传入 `forwardPermissionRequest: broker.forwardPermissionRequest`。
- `work/rebuild/source-file-audit.json` / `work/rebuild/source-file-audit.md`
  - 由 `node work/rebuild/source-audit.mjs` 重写。

## 审计事实

- 源文件数保持 202（生产 136，测试 66），没有新增测试文件或生产 owner 文件。
- 本地 import / re-export 边从 772 降到 771。
- `Interactive Turn Runtime` 风险跨聚合 import 从 17 降到 16。
- `src/lib/bridge/interactive-turn/runner.ts` 直接 import 从 16 降到 15，风险 import 从 3 降到 2；风险摘要中不再列出 `permission-broker.ts`，只剩 `command-callbacks.ts` 和 `security/validators.ts`。
- `runInteractiveMessage` 外聚度从 2 降到 1。
- 本阶段没有处理 delivery pipeline 和 command callback 格式；它们仍是后续 runner 端口审计对象。

## 验证

- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node --test --import tsx src/__tests__/interactive-turn-runner.test.ts src/__tests__/bridge-manager.test.ts src/__tests__/command-dispatch.test.ts`，104 tests / 11 suites 全部通过。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck`。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && node work/rebuild/source-audit.mjs`。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run build`。
- 已通过：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test`，487 tests / 90 suites 全部通过。
- 已通过：`git diff --check`。

## 阶段结论

本阶段完成了 runner 的 permission forwarding 端口收缩。收益是明确把 permission broker 的 owner 留在 bridge manager / Bridge Host 一侧，interactive turn runner 不再默认读取 broker 具体实现；这降低了 runner 的跨聚合 import 和函数外聚度。代价是 runner 仍保留 command callback 和安全格式化依赖，`environment/turn-environment.ts` 仍直接读取 router/context/display。下一阶段应继续在 `cluster-01` 内处理 stop callback / environment context 端口，而不是转回单文件机械拆分。
