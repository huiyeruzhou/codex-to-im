## 任务目标

原始指令：给/new加第二个参数，name，允许运行的时候就给bridgesession重命名，/new <name> <path>这样，另外，path要展开~为$HOME奥

## 任务日志

### 阶段 1：实现 /new name path 与 ~ 展开 - 2026-06-01 13:32

- 已定位 `/new` 创建链路：`session-thread.ts` 处理命令，`bridge-session-support.ts` 解析工作目录，`channel-router.ts` 创建 BridgeSession。
- 当前行为：`/new <path>` 把全部参数当路径，session 名称默认为 `Bridge: <chat>`；`~` 当前会被当成普通相对项目名，没有展开到 HOME。
- 计划：保留单参数 `/new <path>` 兼容；新增双参数 `/new <name> <path>` 将 name 写入 BridgeSession；路径解析前对 `~`、`~/...`、`~\...` 展开到 `os.homedir()`。
- 已实现 `expandHomePath`，在 `/new` 工作目录解析前展开 `~`、`~/...`、`~\...` 到 `os.homedir()`。
- 已扩展 `router.createBinding` 支持可选 sessionName，并让 `/new <name> <path>` 创建 BridgeSession 时使用该名称；单参数路径用法继续保留。
- 已补测试：`resolveNewWorkingDirectory('~/proj1')` 展开 HOME；`/new RenamedSession D:\workspace\named-flow` 会创建名为 `RenamedSession` 的 BridgeSession。
- 用户纠偏：首个 token 像路径的判断需要对用户讲清楚，并且必须支持 `/new ./hi` 这种路径用法。
- 已调整解析规则：单参数路径继续按旧 `/new <path>`；两参数时首个参数如果包含 `/`、`\`、`~` 路径前缀或盘符，会报错提示 name 不能包含路径分隔符；成功响应会说明 name/path 规则，并明确 `./hi`、`~/hi`、绝对路径会被当作路径。
- 已补测试：`./hi` 解析为 workspace 下的相对路径；`/new bad/name <path>` 返回 name 不能包含路径分隔符提示。
- 阶段审计：当前进入阶段审计。
- 对照目标：`/new <name> <path>` 已创建指定 name 的 BridgeSession；单参数 `/new <path>` 兼容旧用法；`~`、`~/...`、`~\...` 会展开到 HOME；`./hi` 会按路径解析；用户响应中说明 name 不能包含 `/` 或 `\`，并说明首个参数像路径时按旧 `/new <path>` 处理。
- 验证结果：`npm run typecheck` 通过；定向 `node --test --import tsx src/__tests__/bridge-manager.test.ts src/__tests__/command-dispatch.test.ts src/__tests__/bridge-command-e2e.test.ts` 通过；完整 `npm test` 通过，545 个测试全部通过。
- 审计结论：目标完成，准备提交本地 git commit；未执行 hot update/redeploy，未 push。
- 阶段验证和git提交：已创建本地提交 `16f008a Support named new sessions and home paths`，随后补写提交结果并 amend 到同一提交。
