# AGENTS.md — Project Guidelines for Codex-to-IM

## Replying to GitHub Issues

When replying to user-reported issues, always include a **self-help prompt** at the end of the reply. Guide users to use their AI coding assistant (Codex / Codex) to diagnose and fix the problem themselves. Example:

> **自助排查提示：** 你可以直接在 Codex 中发送以下提示，让 AI 帮你诊断问题：
>
> ```
> 请帮我排查 Codex-to-im 桥接服务的问题。
> 1. 读取 ~/.codex-to-im/logs/bridge.log 最近 50 行日志
> 2. 读取 ~/.codex-to-im/config.env 检查配置是否正确
> 3. 如果当前仓库存在 scripts/doctor.ps1，就运行 powershell -ExecutionPolicy Bypass -File .\\scripts\\doctor.ps1 并分析输出
> 4. 根据日志和配置给出具体的修复建议
> ```

This approach:
- Reduces maintainer burden by enabling users to self-diagnose
- Leverages the fact that users already have an AI coding assistant installed
- Provides actionable next steps rather than just error explanations

## Development Workflow

Use Node.js 24 for development commands. In this repository, run `nvm use 24` before `npm run build`, `npm test`, `npm run typecheck`, or other Node-based commands unless the active shell is already using Node.js 24.

Do not push commits or hot update/redeploy the bridge unless the user explicitly asks for that action. Code changes should still be committed locally when the work is complete.

When the user adds follow-up requirements for the same functional change before the work is pushed, combine those updates into the same feature commit instead of creating a stack of incremental fix commits. Use a separate commit only for unrelated changes.

## Hot Updating the Local Bridge

When the user asks to hot update or redeploy the local Codex-to-IM bridge, use the project script instead of running `codex-to-im stop` in the foreground. The foreground command can stop the bridge that is carrying the current Codex session and abort itself.

1. Confirm the current working directory is the `codex-to-im` project directory.
2. If and only if the user explicitly asks to pull latest changes, pass `--pull`; otherwise omit it.
3. If a full `npm test` was just run successfully for the same local changes, pass `--skip-tests` to avoid rerunning the full test suite during the detached hot update. Otherwise omit it.
4. Dispatch the detached updater from the project root:

   ```bash
   bash scripts/hot-update-bridge.sh
   ```

   With pull:

   ```bash
   bash scripts/hot-update-bridge.sh --pull
   ```

   Skipping tests after a just-completed full test run:

   ```bash
   bash scripts/hot-update-bridge.sh --skip-tests
   ```

5. Tell the user exactly which command was dispatched, whether `--pull` was requested, whether tests were skipped, where the hot update log is, and where the bridge log is.

The script is responsible for using Node.js 24, detecting `--use-env-proxy`, running build and tests unless `--skip-tests` is passed, and restarting the bridge from a detached worker. The default bridge log path is `~/.codex-to-im/logs/bridge.log`.
