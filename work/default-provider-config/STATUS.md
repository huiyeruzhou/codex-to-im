## 任务目标

原始指令：新增一个 set 项，允许配置 `defualtProvider`，要覆盖配置全链路。

说明：用户原文拼写为 `defualtProvider`，实现时需要检查项目现有命名，判断是否应兼容该拼写或使用已有的 `defaultProvider` 字段。

## 任务日志

### 阶段 1：梳理配置链路并实现 defaultProvider set 项（2026-06-01 12:33 CST）

- 已创建本任务状态文件。当前工作树存在无关改动：`AGENTS.md`、`work/shell-safe-command/STATUS.md`、`work/binding-d492179f-activation/`，本任务不会回退这些改动。
- 初步计划：查找配置 schema、配置读写、CLI set 命令、文档和测试；确认字段命名后实现 set 项覆盖全链路，并运行相关验证。
- 已确认项目现有路由字段名为 `defaultProvider`，用户原文 `defualtProvider` 是拼写错误；实现会使用正确字段名，并在 `/set` alias 中兼容 `defualtProvider`，避免用户按原文输入失败。
- 配置全链路缺口：`Config`/`RuntimeConfigV2`、legacy env/v2 overlay、env snapshot、`configToSettings`、UI config payload/merge、`/set` 定义、daemon `resolveProvider` 向 `CodexRoutingProvider` 传入默认 provider，以及配置和命令测试。
- 已完成第一轮代码修改：新增 `CodexProviderChoice` 与 `normalizeCodexProviderChoice`，支持 `CTI_DEFAULT_PROVIDER` 读写和 overlay，`configToSettings` 输出 `bridge_default_provider`；`configToPayload`/`mergeConfig` 支持 `defaultProvider`；`/set defaultProvider sdk|tmux` 和拼写别名 `defualtProvider`；daemon 启动时把 `config.defaultProvider` 传给 `CodexRoutingProvider`。
- 已补充配置测试和 `/set` 命令测试，下一步运行 typecheck/相关测试并根据失败修正。
- 验证结果：`unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` 通过。随后运行测试命令时由于 shell 管道优先级实际触发全量 `npm test`，全量 541 个测试全部通过。
- 当前进入阶段审计：审计 diff 时发现 `mergeConfig` 对部分 payload 更新可能清空未传入的 `defaultProvider`，已修正为未传则保留、传 `sdk|tmux` 则更新、传空/其他值则清空，并在 UI config 测试中覆盖保留行为。
- 审计后验证：再次运行 `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm run typecheck` 通过。尝试直接 `node --test src/__tests__/...` 失败，原因是项目 TypeScript 测试需要仓库 runner/loader，直接 node 无法解析同目录 `.js` 测试辅助导入；随后使用 `npm test -- ...` 运行，runner 实际执行全量套件，541/541 全部通过。
- 阶段审计结论：本阶段已覆盖配置 schema、env 迁移/overlay、env snapshot、运行态 settings、UI payload/merge、`/set` 命令、daemon 路由默认值注入和测试；功能目标完成。下一步提交本阶段本地 git commit。
- 阶段验证和 git 提交：已创建本地提交 `Add configurable default Codex provider`（amend 后具体 hash 以 `git log -1 --oneline` 为准）。提交包含本阶段代码、测试和状态文件；未暂存/提交已有无关工作树改动。
