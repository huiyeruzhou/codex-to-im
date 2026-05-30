# 2026-05-30 04:35 全文件自然聚类审计归档

## 阶段目标

在已有全源文件审计基础上，升级审计产物为全文件依赖图和自然聚类候选，用全局模块形态重新判断下一阶段边界；command 只作为被审计对象之一。

## 用户纠偏

- 2026-05-30 04:30 用户追加：继续推进当前长期目标；工作目录是 `work/rebuild`，按照状态文件和项目指示完成任务。
- 2026-05-30 04:31 用户纠偏：不要盯着 command 耦合程度刷榜；应做全文件审计和自然聚类，用全局模块形态判断下一步重构边界。

## 原始行动记录

- 读取当前 `STATUS.md`、`AGENTS.md`、git 状态和最近提交后确认，格式迁移阶段已经完成，原计划回到 `command public facade / ports` 阶段。
- 在准备审计 command handler 直接依赖时收到用户纠偏；随即暂停 command 局部 port 化，把阶段目标改为升级全文件审计产物。
- 更新 `work/rebuild/STATUS.md`：追加用户纠偏、调整当前阶段计划，并把 04:30 阶段从 command ports 收口改为全文件自然聚类审计。
- 升级 `work/rebuild/source-audit.mjs`：
  - 新增生产文件加权依赖图。
  - 新增 label propagation 自然聚类。
  - 测试文件不参与聚类计算，只映射到它主要覆盖的生产聚类。
  - 新增聚类聚合构成、混合簇判定、边界判断。
  - `src/lib/bridge/command.ts` 作为 Command Application public facade 纳入审计模型。
- 复跑审计脚本生成 `work/rebuild/source-file-audit.json` 和 `work/rebuild/source-file-audit.md`。
- 第一轮自然聚类出现误导性命名：巨型混合簇被命名为 Mirror Runtime，UI/config/store 混合簇被命名为 Weixin Adapter。随后修正报告逻辑，按聚合行数组成识别混合簇，并将其标记为“混合簇：不是目标模块”。

## 关键命令和输出摘要

- `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && node source-audit.mjs`
  - 输出：`Wrote work/rebuild/source-file-audit.json`
  - 输出：`Wrote work/rebuild/source-file-audit.md`
- `unset NODE_OPTIONS; source ~/.nvm/nvm.sh && nvm use 24 >/dev/null && node -e "..."`
  - 输出摘要：`files=177`，`prod=120`，`tests=57`，`edges=711`，`clusters=10`。
  - 混合簇：`cluster-01`、`cluster-02`。
- `git diff --check -- work/rebuild/source-audit.mjs work/rebuild/source-file-audit.json work/rebuild/source-file-audit.md work/rebuild/STATUS.md`
  - 输出为空，通过。
- `grep -n '^## ' STATUS.md && grep -nE '^## 当前规划|^#### ' STATUS.md || true`
  - h2 只包含 `## 任务目标`、`## 任务上下文`、`## 任务日志`。
  - 旧 `## 当前规划` 和 h4 扫描无输出。
- `npm run typecheck`
  - 通过。
- `node --test --import tsx src/__tests__/command-dispatch.test.ts src/__tests__/bridge-manager.test.ts src/__tests__/bridge-adapter-runtime.test.ts`
  - 90 tests 全部通过。

## 自然聚类结果摘要

- `cluster-01`：`Mixed: Bridge Host / Feishu Adapter / Mirror Runtime`
  - 45 文件 / 13414 行 / 内部边 162 / 出边 38 / 入边 161 / 测试文件 33。
  - 聚合构成：Bridge Host 6562 行、Feishu Adapter 2882 行、Mirror Runtime 1318 行、Session Registry 1023 行、Markdown Rendering 811 行等。
  - 判断：当前 host / delivery / mirror / turn / registry 纠缠的证据，不是目标模块。
- `cluster-02`：`Mixed: Local UI / Config / Service / Store / Persistence`
  - 18 文件 / 10897 行 / 内部边 37 / 出边 17 / 入边 62 / 测试文件 10。
  - 聚合构成：Local UI 5910 行、Config / Service 1990 行、Store / Persistence 1281 行、Weixin Adapter 914 行、Composition Roots 543 行等。
  - 判断：UI / service management / config / persistence 仍需重新分边界。
- `cluster-03`：`Command Application`
  - 22 文件 / 5201 行 / 内部边 55 / 出边 69 / 入边 26。
  - 判断：职责相对集中但对外耦合高，只能作为后续端口化对象之一，不能作为当前全局重构完成标准。
- `cluster-04`：`Local Codex Session Index`
  - 10 文件 / 2155 行 / 内部边 14 / 出边 3 / 入边 1。
  - 判断：较清晰的自然边界候选。
- `cluster-08`：`Session Health Runtime`
  - 3 文件 / 972 行。
  - 判断：较清晰的自然边界候选。
- `cluster-09`：`Markdown Rendering`
  - 3 文件 / 965 行。
  - 判断：较清晰的自然边界候选。

## 阶段审计结论

- 本阶段满足用户纠偏：审计目标回到全源文件和自然聚类，没有继续以 command 风险计数作为成功标准。
- 审计产物覆盖当前所有 `src/**/*.ts` 文件，并在逐文件审计表中写入自然聚类编号。
- 当前自然聚类结果不能直接当作最终架构；前两个最大簇是混合簇，价值在于定位下一阶段应拆的边界。
- 下一阶段应先审计 `cluster-01` 和 `cluster-02` 的混合原因，优先从 bridge host/delivery/mirror/turn/registry 或 local UI/config/service/store 纠缠中选一个自然边界切片。
