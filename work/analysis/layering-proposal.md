# 分层方案草案

这份草案基于当前依赖图和用户故事分析。它仍需继续对照更多代码路径验证。

## 关键约束

不要把共享业务概念拆成一堆便利模块。核心领域词汇必须保持内聚：

- channel instance/address/binding/default target；
- Bridge session；
- Codex thread identity；
- local Codex session/index；
- execution provider；
- provenance/source；
- display model；
- runtime/mirror state。

## 建议分层

### 1. 领域模型

纯类型和规则。不能 import filesystem、HTTP、SDK、process、adapter。

负责：

- `BridgeSession` shape，或至少一个更窄的 domain-facing view；
- `ChannelBinding`、BridgeSession id 和 legacy selector 迁移语义；
- `CodexThreadIdentity`；
- turn classification；
- display title/source normalization；
- provider/mode normalization。

允许依赖：

- 只依赖其他纯 domain helpers。

当前 extraction 候选：

- `turns/turn-classifier.ts`；
- `thread-display-resolver.ts` 的一部分；
- `session-bindings.ts` 和 `ui-server.ts` 中重复的 display helpers。

### 2. Registry / 持久化应用服务

负责产品状态不变量，以及 sessions/bindings/default targets 相关 use cases。

负责：

- bind chat to existing session；
- bind chat to Codex thread；
- 为本地 Codex thread 创建 imported Bridge session；
- enforce one-session/one-thread binding uniqueness；
- rename session/thread；
- delete/archive session target。

允许依赖：

- domain model；
- repository ports；
- local Codex session lookup 和 channel metadata 的 query ports。

当前 extraction 候选：

- `session-bindings.ts`；
- `ui-server.ts` 里的 session rename/config/delete handlers；
- `channel-router.ts` 的一部分。

重要点：

- registry 不应长期直接 import local Codex session scanning 或 config loading。它应该通过 ports 接受这些能力，这样它才是产品状态服务，而不是基础设施拼装。

### 3. Local Codex Session Index 基础设施

负责读取 `~/.codex/sessions`、session index/state DB、JSONL history、mirror records、archive state 和文件 watch 支持。

允许依赖：

- domain model types；
- filesystem/sqlite infrastructure。

当前 extraction 候选：

- 把 `desktop-sessions.ts` 内部拆成：
  - index discovery；
  - selectable-session filtering；
  - title fallback；
  - history parser；
  - mirror record parser；
  - archive store。

对外 contract 应保持小：

- list sessions；
- get by thread id；
- read history；
- read mirror delta；
- archive thread。

### 4. Use Case 运行时

负责业务流程，不负责 platform 细节：

- handle inbound normal message；
- handle slash command use cases；
- run interactive turn；
- reconcile mirror subscriptions；
- stop active task；
- permission approval/denial。

允许依赖：

- domain model；
- registry services；
- local Codex session index port；
- provider port；
- channel delivery port；
- runtime state port。

当前 extraction 候选：

- 按 workflow family 拆 `command-dispatch.ts`；
- 暂时保留 `interactive-message-runner.ts` 作为单个 use-case module，然后再拆 stream UI orchestration 和 turn finalization；
- 把 mirror wiring 从 `bridge-manager.ts` 移到 mirror application service facade。

### 5. Channel Delivery 和平台适配器

负责 platform I/O：

- inbound adapter loops；
- outbound text/card/file delivery；
- Feishu/Weixin API calls；
- platform callback parsing；
- platform resource downloads。

允许依赖：

- channel delivery contracts；
- presentation renderers；
- 不直接修改 registry，只能通过 use-case/application ports。

当前 extraction 候选：

- 把 Feishu adapter 拆成 API client、streaming card renderer/state、rich command card renderer、resource download、adapter loop。

### 6. 表现层查询和渲染器

负责人类可见输出模型：

- IM command field/table/card renderers；
- UI session summaries；
- stream card metadata；
- source badges；
- markdown/plain renderers。

允许依赖：

- domain model；
- query services；
- 不做 mutation。

当前 extraction 候选：

- 将 `ThreadDisplayService` 提升为共享 display query service；
- 把 UI session summary creation 从 `ui-server.ts` 移出；
- 把 command formatting 和 command execution 分开。

### 7. 装配入口

负责 wiring：

- daemon startup；
- UI server startup；
- tests/mocks。

当前文件：

- `src/main.ts`；
- `src/ui-server.ts` 应收缩成 composition root 加 route declarations；
- `src/lib/bridge/bridge-manager.ts` 应收缩成 runtime orchestration，而不是持有 domain rules。

## 依赖方向

建议方向：

```text
composition roots
  -> use case runtime
    -> registry/services
      -> domain model
    -> provider/channel/local Codex session ports
  -> infrastructure implementations
  -> presentation renderers
```

禁止方向草案：

- Domain 不能 import infrastructure 或 presentation。
- Registry services 不能 import 具体 UI server、具体 adapters 或 provider implementations。
- Adapters 不能直接编码 session/thread business invariants。
- UI routes 不能直接复制 display/source rules。
- Command handlers 不能直接 parse Codex JSONL；它们应该调用 local Codex session index/query port。

## 第一批安全重构候选

1. 创建共享 display query module，回答：
   - 通过 `sessionId` 获取 summary；
   - 通过 `threadId` 获取 summary；
   - 通过 BridgeSession id 获取 summary；
   - 为 legacy `targetKey` 提供过渡解析，但不让新逻辑继续依赖它；
   - 规范化 title/source/provenance。
2. 将 UI session summary logic 移到该 query module，不改变 route 行为。
3. 将 `/t` display 和 stream card display 接到同一个 query module。
4. 之后再把 `/t` command handling 从 `command-dispatch.ts` 拆出。

为什么先做这个：

- 它修复当前真实存在的不一致；
- 它集中共享概念，而不是打散概念；
- 可以跨 UI、`/t`、stream cards、mirror cards 测试。

## 早期风险

- `BridgeSession` 当前包含 config、identity、runtime health、stream UI diagnostics、mirror status 和 lifecycle timestamps。它可能需要的是 view/read model，而不是立刻替换成更小类型。
- `source` 术语应在深度重构前重命名，否则混乱会被新模块边界固化。
- 现有文档使用旧术语（`CodePilot`、`SharedSession`、`sdkSessionId`），会误导重构决策。
