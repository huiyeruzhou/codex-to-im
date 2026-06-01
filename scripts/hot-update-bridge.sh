#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CTI_HOME="${CTI_HOME:-$HOME/.codex-to-im}"
LOG_DIR="$CTI_HOME/logs"
BRIDGE_LOG="$LOG_DIR/bridge.log"

usage() {
  cat <<'USAGE'
Usage: bash scripts/hot-update-bridge.sh [--pull] [--skip-tests] [--dry-run] [--run]

Dispatch a detached Codex-to-IM hot update so the current bridge-hosted
Codex session can survive the bridge stop/start sequence.

Options:
  --pull         Run git pull before build/test/restart.
  --skip-tests   Skip npm test during this hot update.
  --dry-run      Validate environment and print the planned detached update
                 without dispatching a worker, building, testing, or restarting.
  --run          Internal worker mode. Do not call directly from a bridge session.
USAGE
}

USE_PULL=0
SKIP_TESTS=0
RUN_WORKER=0
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --pull)
      USE_PULL=1
      ;;
    --skip-tests)
      SKIP_TESTS=1
      ;;
    --run)
      RUN_WORKER=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

validate_project_dir() {
  if [ ! -f "$PROJECT_DIR/package.json" ] || [ ! -f "$PROJECT_DIR/scripts/hot-update-bridge.sh" ]; then
    echo "[hot-update] refusing to run outside a codex-to-im project directory" >&2
    exit 1
  fi

  local package_name
  package_name="$(node -e "const fs = require('fs'); const pkg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); process.stdout.write(String(pkg.name || ''));" "$PROJECT_DIR/package.json" 2>/dev/null || true)"
  if [ "$package_name" != "codex-to-im" ]; then
    echo "[hot-update] refusing to run outside a codex-to-im project directory" >&2
    exit 1
  fi
}

ensure_node24() {
  # npm test can export npm_config_prefix, which makes nvm refuse to run.
  # Hot update owns its Node runtime selection, so clear the incompatible prefix.
  unset npm_config_prefix NPM_CONFIG_PREFIX

  if [ -s "$HOME/.nvm/nvm.sh" ]; then
    # shellcheck source=/dev/null
    source "$HOME/.nvm/nvm.sh"
    nvm use 24 >/dev/null
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "[hot-update] node is not available in PATH" >&2
    exit 1
  fi

  local major
  major="$(node -p "process.versions.node.split('.')[0]")"
  if [ "$major" != "24" ]; then
    echo "[hot-update] Node.js 24 is required, found $(node -v)" >&2
    exit 1
  fi
}

node_supports_env_proxy() {
  node --help 2>/dev/null | grep -F -- --use-env-proxy >/dev/null 2>&1
}

run_logged() {
  echo "[hot-update] $*"
  "$@"
}

run_worker() {
  cd "$PROJECT_DIR"
  mkdir -p "$LOG_DIR"

  echo "[hot-update] started $(date -Is)"
  echo "[hot-update] project: $PROJECT_DIR"
  echo "[hot-update] bridge log: $BRIDGE_LOG"

  validate_project_dir

  ensure_node24
  echo "[hot-update] node: $(node -v)"

  local proxy_supported=0
  local node_options_prefix=()
  if node_supports_env_proxy; then
    proxy_supported=1
    node_options_prefix=(env NODE_OPTIONS=--use-env-proxy)
    echo "[hot-update] --use-env-proxy: supported"
  else
    echo "[hot-update] --use-env-proxy: not supported"
  fi

  if [ "$USE_PULL" = "1" ]; then
    run_logged git pull
  else
    echo "[hot-update] git pull: skipped"
  fi

  run_logged npm run build
  if [ "$SKIP_TESTS" = "1" ]; then
    echo "[hot-update] npm test: skipped by --skip-tests"
  else
    run_logged npm test
  fi

  if [ "$proxy_supported" = "1" ]; then
    echo "[hot-update] restart command: NODE_OPTIONS=--use-env-proxy LITELLM_KEY=sk-local-dev codex-to-im stop && npm run build && NODE_OPTIONS=--use-env-proxy LITELLM_KEY=sk-local-dev codex-to-im start"
    LITELLM_KEY="sk-local-dev" "${node_options_prefix[@]}" codex-to-im stop
    run_logged npm run build
    LITELLM_KEY="sk-local-dev" "${node_options_prefix[@]}" codex-to-im start
  else
    echo "[hot-update] restart command: LITELLM_KEY=sk-local-dev codex-to-im stop && npm run build && LITELLM_KEY=sk-local-dev codex-to-im start"
    LITELLM_KEY="sk-local-dev" codex-to-im stop
    run_logged npm run build
    LITELLM_KEY="sk-local-dev" codex-to-im start
  fi

  echo "[hot-update] completed $(date -Is)"
}

run_dry_run() {
  cd "$PROJECT_DIR"
  validate_project_dir
  ensure_node24

  local args=(--run)
  if [ "$USE_PULL" = "1" ]; then
    args+=(--pull)
  fi
  if [ "$SKIP_TESTS" = "1" ]; then
    args+=(--skip-tests)
  fi

  echo "[hot-update] dry-run: yes"
  echo "[hot-update] project: $PROJECT_DIR"
  echo "[hot-update] pwd: $(pwd)"
  echo "[hot-update] script: $PROJECT_DIR/scripts/hot-update-bridge.sh"
  echo "[hot-update] CTI_HOME: $CTI_HOME"
  echo "[hot-update] log dir: $LOG_DIR"
  echo "[hot-update] bridge log: $BRIDGE_LOG"
  echo "[hot-update] node: $(node -v)"
  if node_supports_env_proxy; then
    echo "[hot-update] --use-env-proxy: supported"
  else
    echo "[hot-update] --use-env-proxy: not supported"
  fi
  echo "[hot-update] worker args: ${args[*]}"
  echo "[hot-update] dispatch command: bash scripts/hot-update-bridge.sh ${args[*]}"
  echo "[hot-update] git pull: $([ "$USE_PULL" = "1" ] && echo planned || echo skipped)"
  echo "[hot-update] npm run build: planned"
  echo "[hot-update] npm test: $([ "$SKIP_TESTS" = "1" ] && echo skipped || echo planned)"
  echo "[hot-update] restart: planned"
}

dispatch_worker() {
  local log_stamp
  log_stamp="$(date +%Y%m%d-%H%M%S)"
  local log_file="$LOG_DIR/hot-update-$log_stamp.log"
  if ! { mkdir -p "$LOG_DIR" && : >"$log_file"; } 2>/dev/null; then
    local fallback_log_dir="${TMPDIR:-/tmp}/codex-to-im-logs"
    mkdir -p "$fallback_log_dir"
    log_file="$fallback_log_dir/hot-update-$log_stamp.log"
    : >"$log_file"
  fi
  local args=(--run)
  if [ "$USE_PULL" = "1" ]; then
    args+=(--pull)
  fi
  if [ "$SKIP_TESTS" = "1" ]; then
    args+=(--skip-tests)
  fi

  if command -v setsid >/dev/null 2>&1; then
    nohup setsid bash "$0" "${args[@]}" >"$log_file" 2>&1 </dev/null &
  else
    nohup bash "$0" "${args[@]}" >"$log_file" 2>&1 </dev/null &
  fi

  echo "Dispatched Codex-to-IM hot update."
  echo "PID: $!"
  echo "Hot update log: $log_file"
  echo "Bridge log: $BRIDGE_LOG"
  echo "Pull requested: $([ "$USE_PULL" = "1" ] && echo yes || echo no)"
  echo "Tests skipped: $([ "$SKIP_TESTS" = "1" ] && echo yes || echo no)"
}

if [ "$DRY_RUN" = "1" ]; then
  run_dry_run
elif [ "$RUN_WORKER" = "1" ]; then
  run_worker
else
  dispatch_worker
fi
