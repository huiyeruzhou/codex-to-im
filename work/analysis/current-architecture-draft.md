# 当前架构草案

> 这份草案保留为分析历史。正式当前架构文档已整理到 `docs/current-architecture.md`，其中 Desktop 术语已收敛为“本地 Codex session/index”。

本文描述当前代码实际做了什么。它不是重构目标图，也不急着提出大规模搬迁方案。

## 产品形态

Codex-to-IM 是一个本地 bridge，连接以下几类对象：

- 本地 channel 配置和后台服务管理；
- 一个或多个 IM channel instance；
- IM chat 及其当前/非当前 bindings；
- 持久化在 `~/.codex-to-im/data` 下的 Bridge sessions；
- 由 Codex 持久化在 `~/.codex/sessions` 下的 Codex threads；
- SDK/tmux 执行 provider；
- 从本地 Codex JSONL mirror 回 IM 的输出。

产品核心不变量：用户可见的 Bridge session 可以通过 `BridgeSession.codex_thread_id` 绑定到真实 Codex thread。当这个字段存在时，IM 应该驱动或观察同一条底层 Codex 对话，而不是创建一条无关的私有 IM 会话。

## 运行时装配

`src/main.ts` 是 daemon composition root：

1. 获取 instance lock；
2. 执行启动存储迁移；
3. 读取配置；
4. 初始化 `JsonFileStore`；
5. 初始化 permission gateway；
6. 初始化 `CodexRoutingProvider`；
7. 初始化 bridge context；
8. 启动 bridge manager。

`src/ui-server.ts` 是本地 UI composition root 和 API server。它现在还内嵌浏览器 HTML/JS 行为和若干 application action。

## 核心运行链路

### 入站消息

1. channel adapter 收到 IM 消息。
2. `bridge-manager.ts` 消费消息并判断类型：
   - permission shortcut/callback；
   - command text；
   - normal model prompt。
3. command 进入 `command-dispatch.ts`。
4. normal prompt 进入 `interactive-message-runner.ts`。

### 会话解析

1. `channel-router.ts` 解析入站 `ChannelAddress`。
2. 如果当前 binding 存在且对应 session 存在，则复用。
3. 如果 channel default target 存在，则把第一个新 chat 绑定到该 target。
4. 否则创建或复用 hidden draft session。

binding 存储 `codepilotSessionId`；Bridge session 存储 `codex_thread_id`。

### 交互式 Turn

1. `interactive-message-runner.ts` 解析 binding/session。
2. 通过 `turn-classifier.ts` 分类当前 turn。
3. 如果 adapter 支持，打开 stream feedback。
4. 调用 `conversation-engine.ts` 消费 provider SSE。
5. `CodexRoutingProvider` 选择 SDK 或 tmux provider。
6. SDK provider start/resume Codex thread。
7. 将返回的 Codex thread id 持久化回 `session.codex_thread_id`。
8. 从 SDK 结果和可选 Desktop terminal finalization 组装最终回复。
9. delivery pipeline 把文本/card/file 发回 IM channel。

### Mirror 运行时

1. `mirror-runtime.ts` 从 active adapters 和 bindings 生成期望 subscriptions；只有 session 带 `codex_thread_id` 的 binding 才有资格订阅。
2. 每个 subscription 将一个 binding 映射到一个 Codex thread JSONL 文件。
3. 文件 watcher 和周期 reconcile 读取 JSONL 增量。
4. mirror records 会经过 IM-originated suppression 过滤。
5. mirror turns 被 buffer/finalize。
6. mirror feedback controller 发送 stream cards 或最终消息。

## 当前数据模型

### Bridge 会话

来源：`src/lib/bridge/host.ts`。

当前存储内容：

- 本地展示名称；
- 工作目录；
- model 和 prompt 配置；
- preferred mode 和 provider 配置；
- canonical Codex thread identity：`codex_thread_id`；
- tmux 远程控制状态；
- draft/hidden 元数据；
- runtime queue/status 字段；
- health/status 诊断；
- stream UI 诊断；
- mirror status；
- timestamps。

观察：这个类型承担了多种职责。它不应立即被硬拆，但大多数层应该使用更窄的 read/write view。

### Channel 绑定

来源：`src/lib/bridge/types.ts`。

表示一个 IM chat 到 Bridge session 的映射。一个 chat 可以有多个 binding，其中一个是 active binding。

重要不变量：

- binding 不拥有 Codex thread identity；
- binding 通过 `codepilotSessionId` 指向 session。

### Legacy UI Selector

UI 和 binding API 使用的目标标识：

- `session:<bridgeSessionId>`；
- `desktop:<codexThreadId>`。

观察：这不应该是产品级 identity 概念。它是 UI 同时展示 Bridge session 和本地 Codex JSONL thread 时产生的 legacy selector。目标模型应是：本地 Codex thread 在需要 mutation 前先物化为 BridgeSession，之后 UI/API 统一用 `BridgeSession.id`；`codex_thread_id` 只作为底层 Codex thread 身份。

## Source 和身份术语

当前代码里的 `source` 有多种含义：

- execution provider：`sdk` 或 `tmux`；
- Codex JSONL source：`session_meta.payload.source`；
- Codex JSONL originator：`session_meta.payload.originator`；
- UI row kind：`bridge` 或 `desktop`；
- channel provider：Feishu 或 Weixin；
- stream metadata source：常见为 `sdk`/`mirror`。

这是重构风险点。模块化设计应先给这些概念改名，再强制依赖边界。

## 当前依赖图

生成的 import graph：

- 146 个 TypeScript 文件；
- 595 条本地 import 边；
- 只有一个多文件 import cycle：`host.ts` <-> `types.ts`。

高行数热点：

- `src/ui-server.ts`；
- `src/lib/bridge/adapters/feishu-adapter.ts`；
- `src/desktop-sessions.ts`；
- `src/lib/bridge/command-dispatch.ts`；
- `src/lib/bridge/bridge-manager.ts`；
- `src/lib/bridge/interactive-message-runner.ts`。

高 inbound 枢纽：

- `src/config.ts`；
- `src/codex-provider.ts`；
- `src/lib/bridge/host.ts`；
- `src/desktop-sessions.ts`；
- `src/store.ts`。

解读：

- import graph 不是循环依赖灾难；
- 真正问题是宽泛的 `bridge/core` 区域混合了 domain rules、application workflows、runtime orchestration 和 presentation formatting。

## 当前文档不匹配

旧文档仍描述一些“未来工作”，但当前代码已经部分实现：

- 本地 Codex session scanning 已存在；
- `/t` thread list/add/use/rm/rename 已存在；
- mirror runtime 已存在；
- UI session management 已存在；
- canonical thread field 现在是 `codex_thread_id`，不是旧的 `sdkSessionId`/`sdk_session_id`。

文档清理应先发布一份当前状态架构文档，然后把旧设计文档按需要降级为历史设计说明。

## 近期重构假设

第一批 extraction 不应是“把所有大文件切开”。它应该先收敛一个共享业务概念：

`Session/Thread Display Query`

职责：

- 通过 BridgeSession id 解析 display summary；
- 通过 session id 解析 display summary；
- 通过 thread id 解析 display summary；
- 规范化 title；
- 提供明确的 source/provenance 字段；
- 暴露 mode/provider labels；
- 支持 UI、`/t`、stream cards、mirror cards。

为什么先做这个：

- 它直接处理当前行为分叉；
- 它能减少 `ui-server.ts`、`thread-display-resolver.ts`、`session-bindings.ts`、command formatting 之间的重复；
- 它保持一个共享业务概念内聚，而不是制造碎片模块。
