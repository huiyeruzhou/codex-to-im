# 自然模块聚类

这是一份分析草案，不是搬文件计划。它只记录当前代码中自然出现的业务聚类。

## 聚类 1：身份和展示模型

职责：

- 统一 Bridge session、Codex thread、本地 Codex session、display title、source/provenance、session mode/provider labels 的含义。

当前相关文件：

- `src/lib/bridge/host.ts`
- `src/lib/bridge/types.ts`
- `src/lib/bridge/turns/turn-classifier.ts`
- `src/lib/bridge/thread-display-resolver.ts`
- `src/session-bindings.ts`
- `src/ui-server.ts`
- `src/lib/bridge/command-formatters.ts`

为什么这是自然聚类：

- `/t`、stream cards、mirror cards、UI session lists、binding summaries、storage migrations 都需要这些规则。
- 同一组事实被渲染成多种形式：Bridge session id、legacy `session:<id>` / `desktop:<threadId>` selector、title、cwd、source、provider、mode。
- `targetKey` 是历史 UI selector，不应继续作为领域概念；目标应是先把本地 Codex thread 物化成 BridgeSession，再用 `BridgeSession.id` 操作。

设计压力：

- 这里应成为共享 query/model 层，而不是嵌在 UI 和 command handlers 里。
- source model 应区分：
  - execution provider：`sdk` 或 `tmux`；
  - Codex JSONL provenance：`originator` 和 `source`；
  - product row kind：`bridge` 或 `desktop`；
  - delivery channel provider：Feishu/Weixin。

## 聚类 2：Session 和 Binding Registry

职责：

- 管理产品持久状态：sessions、bindings、default targets、messages、locks、dedup、permissions、audit。

当前相关文件：

- `src/store.ts`
- `src/storage-migrations.ts`
- `src/session-bindings.ts`
- `src/internal-sessions.ts`
- `schemas/`

为什么这是自然聚类：

- Binding uniqueness、target availability、session/thread identity 是产品不变量。
- Storage migrations 强制 `codex_thread_id` 属于 session，而不是 binding。

设计压力：

- `session-bindings.ts` 当前 import config 和本地 Codex session discovery，所以它混合了 registry invariants 和 display/lookup enrichment。
- 更好的形态是 registry service 接受本地 Codex session lookup 和 channel metadata ports，而不是直接 import 两者。

## 聚类 3：Local Codex Session Index

职责：

- 发现本地 Codex JSONL sessions，判断哪些可选择，解析 history 和 mirror records，并把 thread id 映射到文件。

当前相关文件：

- `src/desktop-sessions.ts`
- `src/desktop-session-mirror.ts`
- `src/ui-session-history.ts`
- `src/lib/bridge/mirror-reconcile-core.ts` 的一部分

为什么这是自然聚类：

- 很多消费者依赖 `desktop-sessions.ts`（24 条 inbound edges），但它自己的 outbound 依赖很少。它事实上已经是基础设施枢纽。

设计压力：

- 当前文件同时包含 index scanning、visibility filtering、title fallback、history rendering、mirror record extraction、archive handling。
- 可以先在内部按职责拆分，但对外保持稳定的本地 Codex session index/history port。

## 聚类 4：交互式 Turn 运行时

职责：

- 处理一个 IM prompt 到一个 Codex provider run 的生命周期，stream progress，处理 tools/tasks，并 deliver final response。

当前相关文件：

- `src/lib/bridge/interactive-message-runner.ts`
- `src/lib/bridge/conversation-engine.ts`
- `src/lib/bridge/interactive-runtime.ts`
- `src/lib/bridge/turns/*`
- `src/codex-routing-provider.ts`
- `src/codex-provider.ts`
- `src/codex-tmux-provider.ts`

为什么这是自然聚类：

- 它围绕一个 active task 生命周期，以及 SDK result 和本地 Codex terminal JSONL 之间的 final source 竞争。

设计压力：

- Stream UI handling 和 business finalization 在 `interactive-message-runner.ts` 内部缠在一起。
- Provider choice 应和 source/provenance display 分开。

## 聚类 5：Mirror 运行时

职责：

- 持续 watch 已绑定的 Codex threads，并把本地 Codex/TUI-originated events deliver 回 IM。

当前相关文件：

- `src/lib/bridge/mirror-runtime.ts`
- `src/lib/bridge/mirror-subscription-registry.ts`
- `src/lib/bridge/mirror-subscription-state.ts`
- `src/lib/bridge/mirror-reconcile-core.ts`
- `src/lib/bridge/mirror-reconcile-batch.ts`
- `src/lib/bridge/mirror-delivery-plan.ts`
- `src/lib/bridge/mirror-turns.ts`
- `src/lib/bridge/mirror-feedback-controller.ts`
- `src/lib/bridge/mirror-suppression.ts`
- `src/lib/bridge/mirror-formatters.ts`

为什么这是自然聚类：

- 这一组已经比较接近 coherent module。它有很多小文件，测试也比较清晰。

设计压力：

- `bridge-manager.ts` 仍持有过多 mirror wiring、config constants、status synchronization。
- Mirror runtime 应向 orchestrator 暴露更少、更稳定的接口。

## 聚类 6：命令应用层

职责：

- 解析 slash commands 并执行产品 use cases：new session、switch thread、provider/mode settings、status、history、file commands、tmux remote control、stop/permissions。

当前相关文件：

- `src/lib/bridge/command-dispatch.ts`
- `src/lib/bridge/command-helpers.ts`
- `src/lib/bridge/command-formatters.ts`
- `src/lib/bridge/command-callbacks.ts`
- `src/lib/bridge/tmux-command.ts`
- `src/lib/bridge/thread-table-message-pins.ts`

为什么这是自然聚类：

- `command-dispatch.ts` 是 use-case switchboard，不是 domain module。

设计压力：

- command 应按用户故事族分组，而不是随意按单个命令拆：
  - thread/session commands；
  - runtime/provider commands；
  - status/diagnostic commands；
  - tmux remote-control commands；
  - file/history commands。

## 聚类 7：Channel Delivery 和平台适配器

职责：

- 把 platform inbound events 转成 bridge messages，并发送 outbound text/cards/files/reactions。

当前相关文件：

- `src/lib/bridge/channel-adapter.ts`
- `src/lib/bridge/bridge-adapter-runtime.ts`
- `src/lib/bridge/bridge-channel-runtime.ts`
- `src/lib/bridge/delivery-layer.ts`
- `src/lib/bridge/feedback-delivery.ts`
- `src/lib/bridge/adapters/feishu-adapter.ts`
- `src/adapters/weixin-adapter.ts`
- `src/adapters/weixin/*`
- `src/lib/bridge/markdown/*`

为什么这是自然聚类：

- platform adapters 应依赖 delivery/rendering contracts，而不是直接拥有业务 identity rules。

设计压力：

- Feishu adapter 过宽：streaming card state、Feishu API calls、resource download、proxy setup、rich command cards、callback handling 全在一起。

## 聚类 8：本地 UI 和服务管理

职责：

- 提供本地 Web UI、配置、session 管理、service start/stop/restart 和 logs。

当前相关文件：

- `src/ui-server.ts`
- `src/ui-assets.ts`
- `src/service-manager.ts`
- `src/weixin-login.ts`
- `src/weixin-store.ts`
- `src/config.ts`

为什么这是自然聚类：

- 这些是本地 operator workflows，和 IM runtime 不同。

设计压力：

- UI route handlers 应调用 application services 和 display query services，而不是直接重建 registry/local Codex state。

## 当前依赖异味总结

- `bridge/core` 不是一层；它包含 orchestration、use cases、domain rules、display formatting、runtime state 和 adapters glue。
- `ui-server.ts` 是独立 composition root，但直接伸进了很多内部模块。
- `session-bindings.ts` 一半是 invariant-enforcer，一半是 display summary builder。
- `desktop-sessions.ts` 是很有价值的基础设施枢纽，但内部职责太宽。
- `ThreadDisplayService` 方向是对的，但应升级为共享 display query model，停止作为 command-centric helper 存在。
