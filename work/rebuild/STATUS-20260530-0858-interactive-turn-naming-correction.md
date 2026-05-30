# 阶段归档：interactive turn naming correction

## 阶段信息

- 时间：2026-05-30 08:48 - 08:58 CST
- 阶段：interactive turn naming correction
- 阶段目标：回应用户纠偏，停止继续制造小文件；审计 `interactive-turn/`、`turns/` 和 `interactive-turn-composition.ts` 的命名、目录和可读性问题，删除不可接受的大依赖注入中转层，保留扁平前缀命名。
- 起点 HEAD：`35e25d2 Extract interactive turn composition runner`

## 用户纠偏

- 2026-05-30 08:48 用户指出：`src/lib/bridge/interactive-turn/` 下有些文件可能没必要单独成文件，应考虑用更直接的前缀命名或合并；`turns` 与 `interactive-turn` 的关系不清楚；`src/lib/bridge/interactive-turn-composition.ts` 这种大依赖注入可读性存疑；不要为了重构而制造同前缀但分散在外层的文件。
- 2026-05-30 08:56 用户强纠偏：`src/lib/bridge/interactive-turn/composition.ts` 是不可接受的依赖注入堆叠，严禁继续写这种 composition 文件。

## 原始行动记录

- 2026-05-30 08:48 已开启纠偏阶段。判断 `turns/` 当前更接近 shared Bridge turn primitives，`interactive-turn/` 更接近 IM inbound interactive turn application flow；二者关系需要解释和规整。
- 2026-05-30 08:48 第一刀尝试把 `interactive-turn-composition.ts` 移入 `interactive-turn/composition.ts` 并按 host/runtime/mirror/delivery/environment/permission/terminal 分组。随后用户强纠偏确认该方向仍然不可接受。
- 2026-05-30 08:56 已删除 `src/lib/bridge/interactive-turn/composition.ts`，`bridge-manager.ts` 恢复直接 import `runInteractiveMessage`、`resolveInteractiveTurnEnvironment`、`resolveInteractiveTurnRuntimeSettings`、`consumeSseEvents` 和 runtime option normalizers，并在 `handleMessage` 中显式构造 runner deps。
- 2026-05-30 08:48 - 08:56 已删除 `interactive-turn/environment`、`response`、`sdk`、`stream`、`terminal` 这些一层小目录，把文件扁平为 `turn-environment.ts`、`final-response-plan.ts`、`sdk-conversation-engine.ts`、`sdk-attachments.ts`、`sdk-stream-events-controller.ts`、`sdk-stream-preview.ts`、`stream-feedback-port.ts`、`stream-ui-controller.ts`、`terminal-finalization-controller.ts`。

## 审计事实

- 最新 `src/lib/bridge/interactive-turn/` 只有一层文件，无子目录。
- `src/lib/bridge/interactive-turn-composition.ts` / `src/lib/bridge/interactive-turn/composition.ts` 均不存在。
- `bridge-manager.ts` 重新暴露 `runInteractiveMessage` deps 构造。阶段判断：这段 deps 确实偏宽，但这是 runner 接口和职责问题，不能用 composition facade 掩盖。
- Source audit：203 个 `src/**/*.ts` 文件，其中生产 137 个、测试 66 个；本地 import / re-export 边 774；`Bridge Host / Runtime Contracts` 为 22 文件 / 4893 行 / 风险 28；`Interactive Turn Runtime` 为 18 文件 / 2956 行 / 风险 10。

## 验证记录

- 已通过：`node --import tsx --test src/__tests__/interactive-turn-runner.test.ts src/__tests__/interactive-turn-final-response-plan.test.ts src/__tests__/interactive-turn-terminal-finalization-controller.test.ts src/__tests__/interactive-turn-sdk-conversation-engine.test.ts src/__tests__/interactive-turn-sdk-stream-events-controller.test.ts src/__tests__/bridge-manager.test.ts`，103 tests / 16 suites 全部通过。
- 已通过：`npm run typecheck`。
- 已通过：`node work/rebuild/source-audit.mjs`。
- 已通过：`npm run build`。
- 已通过：`npm test`，487 tests / 90 suites 全部通过。
- 已通过：`git diff --check`。

## 阶段反思

- `composition.ts` 是错误方向：它没有减少业务复杂度，只是把大依赖注入从 `bridge-manager.ts` 换壳移动到另一个文件。
- 扁平前缀命名改善了文件查找：同一用户故事族都在 `interactive-turn/` 一层目录下，避免同前缀文件分散在根目录或单文件子目录里。
- 后续若继续 interactive turn，应直接处理 `runInteractiveMessage` 接口过宽、`stream-feedback-port.ts` 是否该合并、以及 `turns/` 是否应重命名为 shared turn primitives，而不是再抽 composition facade。
