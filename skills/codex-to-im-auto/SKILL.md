---
name: codex-to-im-auto
description: Use this skill when the user wants to create a local script for Codex-to-IM /auto automation. The script should wait for or detect a trigger condition, then print the exact prompt that /auto should send back into the bound bridge session.
---

# Codex-to-IM /auto script creation

Use this skill when the user asks to create an automation script for `/auto new <scriptpath> <times>`.

## Contract

Create a local executable script that:

- waits for the requested timing or condition
- checks any relevant local process, log, job, Ray cluster, file, or command state
- prints exactly one useful Codex prompt to stdout
- exits with code 0 when stdout is ready for Codex
- exits non-zero only when the script itself cannot run

The bridge runs the script repeatedly. Each stdout becomes the next prompt sent to the bridge session that owns the `/auto` task.

## Output to the user

After creating the script, tell the user:

- the script content
- the absolute script path
- the suggested `/auto new <scriptpath> <times>` command

Name the script after the trigger timing or condition, for example `check_experiment_progress_every_20m.sh`.

## Script pattern

Prefer Bash on Unix-like systems:

```bash
#!/usr/bin/env bash
set -euo pipefail

prompt="20分钟过去了，请检查一下实验进度。"
deadline=$((SECONDS + 20 * 60))

while (( SECONDS < deadline )); do
  sleep 5

  # Replace this block with task-specific checks.
  if ! pgrep -f "experiment-command-or-name" >/dev/null 2>&1; then
    prompt="实验进程似乎已经退出。请检查实验进度、最近日志和退出原因。"
    break
  fi

  if command -v ray >/dev/null 2>&1; then
    ray_status="$(ray status 2>&1 || true)"
    if printf '%s\n' "$ray_status" | grep -qiE "failed|error|dead|unhealthy"; then
      prompt="ray status 显示异常，请检查实验进度并诊断：\n$ray_status"
      break
    fi
  fi
done

printf '%b\n' "$prompt"
```

Make the script executable with `chmod +x`.

## Rules

- Use absolute paths inside the script when checking known files or logs.
- Keep stdout focused on the Codex prompt. Put debug logs on stderr if needed.
- Do not start long-running experiment work unless the user asked for that; `/auto` scripts should usually observe and report.
- If the user asks for “every N minutes”, the script itself should sleep for N minutes, checking every few seconds when useful.
