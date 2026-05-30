# 2026-05-30 03:36 阶段归档：最终指令落盘与 binding id 命名收尾

## 原始用户指令

用户要求：

- 在 status.md 中维护最终指令。
- 最终目标是按照 command 模块的重构思路去审计当前每一个源文件，然后重新划分模块并重构。
- command 的整体重构思路可以借鉴，但此前没有看完整依赖，肯定会遗漏可以修改的地方。
- 修改过程中始终记得红线；红线原则放到 `AGENTS.md`，并把 `AGENTS.md` 翻译为全中文，允许中英混合使用一些英文术语。
- 长期任务原则：
  - 动作要落盘：始终追踪 STATUS.md，新认识/理解/计划/信息要立即更新。
  - 动作成阶段：不要一次做过大改动；逐步修改、逐步测试；同步 STATUS.md 和项目文档；每阶段提交，同模块 commit 用 amend。
  - 阶段要审计：阶段结束时总结修改、记录进入审计、将原始素材移动到 `STATUS-yyyymmdd-hhmm-name.md`、关键 takeaway 留在 STATUS.md、按任务目标判断是否完成、完成则规划继续，不完成则反思改进。

## 本阶段操作

- 读取 `AGENTS.md`，确认其原本主要是英文项目说明。
- 读取 `work/rebuild/STATUS.md` 顶部，确认它是当前 rebuild 状态入口。
- 将 `AGENTS.md` 改写为全中文项目准则，保留必要英文术语。
- 在 `AGENTS.md` 中新增红线原则：
  - 动作要落盘；
  - 动作成阶段；
  - 阶段要审计；
  - 当前长期重构目标必须覆盖当前每一个源文件；
  - Node.js 24、禁止擅自 push/hot update、GitHub Issue 自助排查提示等原有项目规则继续保留。
- 更新 `work/rebuild/STATUS.md` 的“当前最新决策”，把最终目标改为全源文件审计 + 重新划分模块 + 分阶段重构。
- 记录当前下一阶段必须先生成 `src/**/*.ts` 全源文件清单、import/export 图、入边/出边、职责和候选聚合判断。

## binding id 命名收尾

本阶段开始前，工作树中已有一个正在进行的小改动：将 `ChannelBinding` 的历史字段名 `codepilotSessionId` 迁移为 `bridgeSessionId`。该改动属于 Phase 7 术语清理的一部分。

已完成：

- 生产代码、测试和文档中的 `ChannelBinding.codepilotSessionId` 内部字段迁移为 `bridgeSessionId`。
- `storage-migrations.ts` 继续读取旧 `codepilotSessionId` / `codepilot_session_id` / `bridge_session_id`，写出 canonical `bridgeSessionId` 并删除旧字段。
- `schemas/data/bindings.v1.schema.json` 升级为 `schemas/data/bindings.v2.schema.json`。
- `schemas/manifest.json` 指向 `data.bindings.v2`。
- bindings v2 schema 禁止旧 binding session id 字段。
- `docs/json-schemas.md` 同步 schema 路径和字段说明。

## 验证命令

```bash
unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && npm run typecheck
```

结果：通过。

```bash
unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && node --test --import tsx src/__tests__/storage-migrations.test.ts src/__tests__/json-schemas.test.ts src/__tests__/store.test.ts src/__tests__/session-registry.test.ts src/__tests__/channel-router.test.ts
```

结果：50 tests 全部通过。

```bash
unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 && npm test && npm run build
```

结果：

- `npm test` 455 tests 全部通过。
- `npm run build` 通过，生成 `dist/daemon.mjs`、`dist/ui-server.mjs`、`dist/cli.mjs`。

## 阶段审计

完成判断：

- 红线原则已落入 `AGENTS.md`。
- `work/rebuild/STATUS.md` 已记录最终目标变更和下一阶段入口。
- binding id 术语迁移已完成当前代码、schema、migration、测试同步。
- 全量测试和 build 已通过。

未完成但进入下一阶段：

- 尚未完成当前每一个源文件的完整审计。
- 尚未基于全源文件审计重新划分所有模块。
- 尚未按新模块规划继续重构。

下一步：

1. 提交/合并本阶段改动到当前 rebuild commit。
2. 进入“全源文件审计”阶段，先生成机器可复核的审计输入。
3. 将全源文件审计的原始素材继续按阶段归档，`work/rebuild/STATUS.md` 只保留关键 takeaway。
