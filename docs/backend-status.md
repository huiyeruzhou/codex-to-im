# 目标：建立以会话和绑定为核心的本地后端体系

目标：把 Codex-to-IM 的业务数据结构整理成一个清晰的本地后端体系。核心不是 SQLite/JSON 的技术选型，而是先把 `BridgeSession`、`ChannelBinding`、线程身份、历史读取、mirror/reuse 等业务概念拆清楚。项目不引入真正的远端后端服务；自有小数据继续优先使用 JSON/JSONL，以保持可读、可调试、容易手工修复。

## 当前结论

- Codex-to-IM 自己的核心运行数据当前已经主要使用 JSON 文件存储。
- SQLite 的使用点很集中，只在本地 Codex session 列表兼容逻辑中只读访问 `~/.codex/state_*.sqlite`。
- 后续改造重点不是“把项目从 SQLite 迁走”，也不是先抽通用 storage helper，而是先重构业务模型：`BridgeSession` 负责本地会话和唯一 Codex thread 身份，`ChannelBinding` 只负责 IM 聊天到本地 session 的绑定。
- `codex_thread_id` 保留，并作为唯一的 Codex thread id 字段使用；不新增 `thread_id`。
- 旧字段 `sdk_session_id`、`desktop_thread_id`、`thread_origin`、`ChannelBinding.sdkSessionId` 要从业务模型中删除，不再作为 fallback 或兼容兜底。

## 业务模型目标

### BridgeSession

`BridgeSession` 是本地会话容器，负责承载一次可持续对话的业务状态。

保留职责：

- 本地 session id。
- 会话名、工作目录、模型、默认模式、reasoning 设置。
- 运行态：running/queued/idle、health、mirror 状态、stream UI 状态。
- 消息缓存：`messages/<sessionId>.json`。
- 唯一 Codex thread 身份：`codex_thread_id`。

字段收敛：

- 保留 `codex_thread_id`：表示该 session 关联的 Codex thread id。
- 删除 `sdk_session_id`：不再把 SDK resume id 作为单独业务字段。
- 删除 `desktop_thread_id`：不再把 Native/Native 客户端作为业务核心身份。
- 删除 `thread_origin`：不再用 origin 字段决定业务路径。

语义规则：

- 没有 `codex_thread_id`：这是一个尚未创建 Codex thread 的本地 session。
- 有 `codex_thread_id`：这是一个已经关联 Codex thread 的本地 session。
- 这个 thread 可能来自普通 IM 对话，也可能来自用户接管已有 Codex 会话；业务逻辑不应再通过 `desktop_*` 字段区分。

### ChannelBinding

`ChannelBinding` 只表示“某个 IM chat 当前绑定到哪个本地 session”。

保留职责：

- channel instance：`channelType`、`channelProvider`、`channelAlias`。
- chat 身份：`chatId`、`chatUserId`、`chatDisplayName`。
- 本地 session 指针：`bridgeSessionId`。
- active 状态。
- 绑定级展示/默认项：`workingDirectory`、`model`、`mode`。

字段收敛：

- 删除 `sdkSessionId`。
- binding 不再缓存 Codex thread id。
- binding 不再参与 thread 身份判断。
- 所有 thread id 读取都必须从 `store.getSession(binding.bridgeSessionId)?.codex_thread_id` 获取。

### 线程相关能力

以下能力都基于 `BridgeSession.codex_thread_id`：

- 普通 IM 对话 resume。
- `/t` 选择或接管已有 Codex 会话。
- history 读取。
- mirror 订阅。
- reuse 当前 Codex thread。
- tmux provider resume。

不再允许以下 fallback：

- 从 `ChannelBinding.sdkSessionId` 读 thread id。
- 从 `BridgeSession.sdk_session_id` 读 thread id。
- 从 `BridgeSession.desktop_thread_id` 读 thread id。
- 通过 `thread_origin === 'desktop'` 决定 mirror/reuse。

### 命名原则

- 用户界面可以继续出现“本地 Codex 会话”这类用户能理解的入口描述。
- 内部业务模型不再把 Native/Native 客户端作为核心抽象。
- 代码里的新逻辑应围绕 `codex_thread_id`、session、binding 命名。
- 旧函数名如 `bindStoreToSdkSession` 应改成更准确的“绑定到 Codex thread”语义。

## 当前 JSON 存储

`src/store.ts` 中的 `JsonFileStore` 是当前 Bridge 运行期数据的主存储实现，数据目录位于 `CTI_HOME/data`。

主要文件包括：

- `sessions.json`：Bridge session 记录。
- `bindings.json`：IM channel 与 session 的绑定关系。
- `channel-default-targets.json`：通道默认目标。
- `permissions.json`：权限回调链接。
- `offsets.json`：消费偏移量。
- `dedup.json`：去重键。
- `audit.json`：审计日志。
- `messages/<sessionId>.json`：单个 Bridge session 的消息缓存。

其它模块也有独立 JSON 状态文件：

- `config.v2.json`：结构化配置文件。
- `ui-session-meta.json`：旧 UI session 名称元数据；启动迁移会合并进 `sessions.json.name` 并删除该文件。
- `thread-table-messages.json`：线程表格消息置顶/展示记录。
- `weixin-accounts.json`、`weixin-context-tokens.json`：微信登录和上下文 token。
- `runtime/status.json`、`runtime/ui-server.json`：服务运行状态。

## 存储边界

Codex-to-IM 自有数据：

- 使用 JSON/JSONL。
- 支持人工检查和修复。
- 先保证业务字段清晰，再考虑统一 storage helper。
- 后续可以增加 schema version、迁移、备份和损坏恢复策略。

Codex 外部数据：

- Codex Native session JSONL：只读解析。
- Codex Native `state_*.sqlite`：只读兼容读取。
- Codex CLI/SDK thread id：写入本地 session 的 `codex_thread_id`，不再写入 binding。

### 5. API 层

目标：让 UI server 和 IM 命令共享更清晰的本地后端契约。

计划：

- 为 UI server 的本地接口定义 typed request/response。
- 修改类接口增加输入校验。
- 错误返回统一为：

```json
{
  "ok": false,
  "code": "ERROR_CODE",
  "message": "Human readable message",
  "details": {}
}
```

- UI 只依赖 API DTO，不直接理解存储文件结构。

### 6. Runtime 层

目标：统一 bridge、UI server、mirror、health 和 hot update 的状态表达。

计划：

- 梳理 `runtime/status.json`、`runtime/ui-server.json` 等状态文件。
- 统一字段：`running`、`pid`、`port`、`startedAt`、`lastError`、`updatedAt`。
- doctor 脚本读取 runtime 状态、配置文件和日志，输出可执行的修复建议。
- 状态查询保持只读，不承担运行态修复动作。


## 测试计划

- Store：`codex_thread_id` 只写 session，不写 binding。
- Binding：binding 删除 `sdkSessionId` 后仍能绑定、切换 active、删除、列出。
- Conflict：同一个 session 或同一个 `codex_thread_id` 不能被绑定到多个 chat。
- `/t`：接管已有 Codex 会话会写 session 的 `codex_thread_id`。
- History：优先用 session 的 `codex_thread_id` 查外部 JSONL，找不到退回 Bridge messages。
- Mirror：只根据 session 的 `codex_thread_id` 建立订阅。
- Reuse：普通 IM 对话只根据 session 的 `codex_thread_id` resume。
- Tmux：只根据 session 的 `codex_thread_id` resume。
- Full：typecheck、全量 test、build 通过后再热更新。

## 交付顺序

1. 更新业务模型文档，明确 `codex_thread_id` 是唯一 thread id。
2. 修改类型定义：删除 session 和 binding 上的旧 thread 字段。
3. 修改 store 接口和实现：thread id 只写 session。
4. 修改 binding/session helper：不再读写 `binding.sdkSessionId`。
5. 修改 `/t`、history、mirror、reuse、tmux provider 的 thread id 来源。
6. 更新测试，删除旧字段断言，补新业务结构断言。
7. 跑 `nvm use 24` 后执行 typecheck、test、build。
8. 验证通过后热更新 bridge；不 commit、不 push。

## 非目标

- 不引入远端数据库。
- 不把项目自有小数据迁移到 SQLite。
- 不改变 Codex Native 自己的数据格式。
- 不重写微信或飞书 adapter 的底层 API。
- 不新增 `thread_id` 字段替代 `codex_thread_id`。
- 不保留旧字段作为 fallback。
- 不在验证通过前热更新本机 bridge。
