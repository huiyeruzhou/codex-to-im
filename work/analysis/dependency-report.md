# 依赖报告

生成时间：2026-05-29T15:41:11.061Z

文件数：146
本地 import 边数：595

## 最大/最连接的文件

| 文件 | 层 | 行数 | 入边 | 出边 |
| --- | --- | ---: | ---: | ---: |
| `src/ui-server.ts` | ui | 4899 | 0 | 12 |
| `src/lib/bridge/adapters/feishu-adapter.ts` | bridge/adapters | 2882 | 2 | 9 |
| `src/__tests__/bridge-manager.test.ts` | tests | 2629 | 0 | 12 |
| `src/desktop-sessions.ts` | desktop | 2026 | 24 | 2 |
| `src/lib/bridge/command-dispatch.ts` | bridge/core | 2022 | 2 | 30 |
| `src/__tests__/desktop-sessions.test.ts` | tests | 1711 | 0 | 2 |
| `src/__tests__/interactive-message-runner.test.ts` | tests | 1476 | 0 | 9 |
| `src/__tests__/feishu-adapter.test.ts` | tests | 1419 | 0 | 2 |
| `src/__tests__/command-dispatch.test.ts` | tests | 1411 | 0 | 9 |
| `src/__tests__/codex-provider.test.ts` | tests | 1392 | 0 | 72 |
| `src/lib/bridge/bridge-manager.ts` | bridge/core | 1313 | 3 | 31 |
| `src/ui-assets.ts` | ui | 1106 | 1 | 0 |
| `src/lib/bridge/interactive-message-runner.ts` | bridge/core | 1053 | 3 | 19 |
| `src/lib/bridge/tmux-command.ts` | bridge/core | 1026 | 1 | 9 |
| `src/service-manager.ts` | service | 980 | 4 | 3 |
| `src/config.ts` | config | 861 | 40 | 1 |
| `src/store.ts` | storage | 857 | 12 | 4 |
| `src/__tests__/bridge-command-e2e.test.ts` | tests | 820 | 0 | 5 |
| `src/lib/bridge/markdown/feishu.ts` | bridge/markdown | 811 | 2 | 3 |
| `src/codex-provider.ts` | codex | 763 | 36 | 5 |
| `src/lib/bridge/markdown/ir.ts` | bridge/markdown | 739 | 2 | 0 |
| `src/lib/bridge/conversation-engine.ts` | bridge/core | 723 | 3 | 10 |
| `src/codex-tmux-provider.ts` | codex | 706 | 3 | 5 |
| `src/weixin-login.ts` | weixin | 697 | 2 | 5 |
| `src/session-bindings.ts` | sessions | 691 | 5 | 7 |
| `src/__tests__/store.test.ts` | tests | 687 | 0 | 3 |
| `src/lib/bridge/command-formatters.ts` | bridge/core | 680 | 9 | 6 |
| `src/__tests__/config.test.ts` | tests | 587 | 0 | 2 |
| `src/adapters/weixin-adapter.ts` | adapters | 563 | 2 | 12 |
| `src/__tests__/mirror-runtime.test.ts` | tests | 527 | 0 | 4 |
| `src/__tests__/session-health-runtime.test.ts` | tests | 520 | 0 | 4 |
| `src/lib/bridge/session-health-reducer.ts` | bridge/core | 465 | 3 | 2 |
| `src/lib/bridge/mirror-turns.ts` | bridge/core | 434 | 8 | 3 |
| `src/lib/bridge/mirror-feedback-controller.ts` | bridge/core | 434 | 2 | 12 |
| `src/storage-migrations.ts` | storage | 410 | 3 | 1 |
| `src/lib/bridge/mirror-runtime.ts` | bridge/core | 405 | 2 | 10 |
| `src/lib/bridge/session-health-runtime.ts` | bridge/core | 386 | 5 | 7 |
| `src/lib/bridge/host.ts` | bridge/core | 350 | 36 | 2 |
| `src/lib/bridge/mirror-suppression.ts` | bridge/core | 329 | 1 | 1 |
| `src/__tests__/mirror-subscription-state.test.ts` | tests | 329 | 0 | 1 |

## 层摘要

| 层 | 文件数 | 行数 | import 入边 | import 出边 |
| --- | ---: | ---: | ---: | ---: |
| tests | 54 | 18491 | 43 | 239 |
| bridge/core | 44 | 13967 | 273 | 234 |
| ui | 3 | 6130 | 2 | 14 |
| bridge/adapters | 2 | 2896 | 4 | 11 |
| desktop | 2 | 2184 | 27 | 3 |
| bridge/markdown | 5 | 1785 | 13 | 6 |
| codex | 4 | 1600 | 45 | 14 |
| storage | 3 | 1484 | 20 | 6 |
| service | 1 | 980 | 4 | 3 |
| config | 1 | 861 | 40 | 1 |
| sessions | 2 | 796 | 8 | 9 |
| root | 8 | 772 | 58 | 14 |
| weixin | 1 | 697 | 2 | 5 |
| bridge/turns | 8 | 594 | 31 | 19 |
| adapters | 1 | 563 | 2 | 12 |
| weixin/infra | 5 | 525 | 16 | 5 |
| bridge/security | 2 | 227 | 7 | 0 |

## 最常见层间依赖

| 依赖边 | 次数 |
| --- | ---: |
| bridge/core -> bridge/core | 167 |
| tests -> bridge/core | 64 |
| tests -> tests | 43 |
| tests -> root | 41 |
| tests -> codex | 38 |
| bridge/core -> desktop | 16 |
| bridge/core -> bridge/turns | 14 |
| tests -> config | 14 |
| tests -> storage | 13 |
| bridge/turns -> bridge/core | 11 |
| bridge/core -> config | 9 |
| tests -> bridge/turns | 9 |
| bridge/adapters -> bridge/core | 7 |
| bridge/core -> bridge/security | 7 |
| bridge/turns -> bridge/turns | 7 |
| adapters -> weixin/infra | 6 |
| bridge/core -> sessions | 6 |
| codex -> root | 6 |
| bridge/core -> bridge/markdown | 5 |
| bridge/core -> root | 5 |
| sessions -> bridge/core | 5 |
| tests -> desktop | 5 |
| bridge/markdown -> bridge/markdown | 4 |
| tests -> weixin/infra | 4 |
| weixin/infra -> weixin/infra | 4 |
| adapters -> bridge/core | 3 |
| bridge/core -> codex | 3 |
| codex -> bridge/core | 3 |
| root -> bridge/core | 3 |
| root -> config | 3 |
| root -> root | 3 |
| storage -> config | 3 |
| ui -> bridge/core | 3 |
| bridge/markdown -> bridge/core | 2 |
| codex -> codex | 2 |
| codex -> config | 2 |
| desktop -> bridge/core | 2 |
| root -> storage | 2 |
| service -> config | 2 |
| sessions -> config | 2 |
| storage -> bridge/core | 2 |
| tests -> bridge/markdown | 2 |
| ui -> desktop | 2 |
| ui -> storage | 2 |
| weixin -> config | 2 |
| weixin -> weixin/infra | 2 |
| adapters -> bridge/markdown | 1 |
| adapters -> config | 1 |
| adapters -> storage | 1 |
| bridge/adapters -> adapters | 1 |

## 循环依赖分量

### 循环 1：2 个文件

层：bridge/core

- `src/lib/bridge/host.ts`
- `src/lib/bridge/types.ts`
