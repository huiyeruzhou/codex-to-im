import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import type { ChannelBinding } from '../types.js';
import { buildCommandFields, formatCommandPath } from './presentation.js';
import { buildFencedCodeBlock } from '../markdown/fence.js';
import { sanitizeInput } from '../security/validators.js';

const execFileAsync = promisify(execFile);

const DEFAULT_SHELL_SANDBOX_MODE = 'workspace-write';
const SHELL_COMMAND_TIMEOUT_MS = 60_000;
const SHELL_COMMAND_MAX_OUTPUT_BYTES = 96_000;
const CODEX_SHELL_WORKSPACE_NETWORK_PROFILE = 'cti_shell_workspace_network';
const CODEX_SHELL_READ_ONLY_NETWORK_PROFILE = 'cti_shell_read_only_network';
const CODEX_SANDBOX_HELP_TIMEOUT_MS = 5_000;
const DEFAULT_SHELL_REFRESH_INTERVAL_SECONDS = 5;
const MIN_SHELL_REFRESH_INTERVAL_SECONDS = 5;

type ShellSandboxMode = 'read-only' | 'workspace-write';
type CodexSandboxCliStyle = 'top-level' | 'linux-subcommand';

export interface ShellCommandRunRequest {
  command: string;
  cwd: string;
  sandboxMode: ShellSandboxMode;
  networkAccess: boolean;
  shell: string;
  timeoutMs: number;
  refreshIntervalSeconds?: number;
  onProgress?: (progress: ShellCommandProgress) => void;
}

export interface ShellCommandRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  outputTruncated?: boolean;
}

export interface ShellCommandProgress {
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  outputTruncated?: boolean;
}

export type ShellCommandRunner = (request: ShellCommandRunRequest) => Promise<ShellCommandRunResult>;

interface ParsedShellCommandArgs {
  command: string;
  force: boolean;
  sandboxMode: ShellSandboxMode;
  refreshIntervalSeconds: number;
}

interface ShellStreamCard {
  update: (text: string, statusText: string) => void;
  finish: (status: 'completed' | 'interrupted' | 'error', text: string) => Promise<boolean>;
}

interface ShellAuditFinding {
  level: 'block' | 'warn';
  message: string;
}

function codexSandboxPermissionProfile(request: ShellCommandRunRequest): string {
  if (!request.networkAccess) {
    return request.sandboxMode === 'read-only' ? ':read-only' : ':workspace';
  }
  return request.sandboxMode === 'read-only'
    ? CODEX_SHELL_READ_ONLY_NETWORK_PROFILE
    : CODEX_SHELL_WORKSPACE_NETWORK_PROFILE;
}

function buildCodexNetworkProfileConfigArgs(request: ShellCommandRunRequest): string[] {
  if (!request.networkAccess) return [];
  const profile = codexSandboxPermissionProfile(request);
  const parentProfile = request.sandboxMode === 'read-only' ? ':read-only' : ':workspace';
  return [
    '-c',
    `permissions.${profile}.extends=${JSON.stringify(parentProfile)}`,
    '-c',
    `permissions.${profile}.network.enabled=true`,
    '-c',
    `permissions.${profile}.network.mode="full"`,
  ];
}

export function buildCodexSandboxArgs(
  request: ShellCommandRunRequest,
  cliStyle: CodexSandboxCliStyle = 'top-level',
): string[] {
  return [
    'sandbox',
    ...(cliStyle === 'linux-subcommand' ? ['linux'] : []),
    ...buildCodexNetworkProfileConfigArgs(request),
    '--permissions-profile',
    codexSandboxPermissionProfile(request),
    '--cd',
    request.cwd,
    request.shell,
    '-lc',
    request.command,
  ];
}

export function detectCodexSandboxCliStyleFromHelp(helpText: string): CodexSandboxCliStyle {
  if (/(^|\n)\s+--permissions-profile\b/.test(helpText)) return 'top-level';
  if (/(^|\n)Commands:\s*[\s\S]*\n\s+linux\b/.test(helpText)) return 'linux-subcommand';
  return 'top-level';
}

async function resolveCodexSandboxCliStyle(executable: string): Promise<CodexSandboxCliStyle> {
  try {
    const help = await execFileAsync(executable, ['sandbox', '--help'], {
      timeout: CODEX_SANDBOX_HELP_TIMEOUT_MS,
      maxBuffer: 48_000,
      env: process.env,
    });
    return detectCodexSandboxCliStyleFromHelp(String(help.stdout || ''));
  } catch {
    return 'top-level';
  }
}

async function execCodexSandbox(
  executable: string,
  request: ShellCommandRunRequest,
  cliStyle: CodexSandboxCliStyle,
): Promise<ShellCommandRunResult> {
  const args = buildCodexSandboxArgs(request, cliStyle);
  if (!request.onProgress) {
    const result = await execFileAsync(executable, args, {
      cwd: request.cwd,
      timeout: request.timeoutMs,
      maxBuffer: SHELL_COMMAND_MAX_OUTPUT_BYTES,
      env: process.env,
    });
    return {
      exitCode: 0,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  }

  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: request.cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;

    const appendOutput = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      if (outputTruncated) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > SHELL_COMMAND_MAX_OUTPUT_BYTES) {
        outputTruncated = true;
        child.kill('SIGTERM');
        return;
      }
      const text = chunk.toString('utf8');
      if (stream === 'stdout') stdout += text;
      else stderr += text;
    };

    const emitProgress = () => {
      request.onProgress?.({ stdout, stderr, timedOut, outputTruncated });
    };

    const progressTimer = setInterval(
      emitProgress,
      Math.max(MIN_SHELL_REFRESH_INTERVAL_SECONDS, request.refreshIntervalSeconds || DEFAULT_SHELL_REFRESH_INTERVAL_SECONDS) * 1000,
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, request.timeoutMs);

    const finish = (result: ShellCommandRunResult) => {
      if (settled) return;
      settled = true;
      clearInterval(progressTimer);
      clearTimeout(timeout);
      emitProgress();
      resolve(result);
    };

    child.stdout?.on('data', (chunk: Buffer) => appendOutput('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => appendOutput('stderr', chunk));
    child.on('error', (error) => {
      finish({
        exitCode: null,
        stdout,
        stderr: stderr || error.message,
        timedOut,
        outputTruncated,
      });
    });
    child.on('close', (code) => {
      const exitCode = typeof code === 'number' ? code : null;
      const finalStderr = outputTruncated
        ? `${stderr}${stderr ? '\n' : ''}输出超过 ${SHELL_COMMAND_MAX_OUTPUT_BYTES} bytes，已终止。`
        : stderr;
      request.onProgress?.({ exitCode, stdout, stderr: finalStderr, timedOut, outputTruncated });
      finish({
        exitCode,
        stdout,
        stderr: finalStderr,
        timedOut,
        outputTruncated,
      });
    });
  });
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isNodeModulesBinPath(dirPath: string): boolean {
  const parts = dirPath.split(path.sep).filter(Boolean);
  return parts.at(-1) === '.bin' && parts.includes('node_modules');
}

export function resolveCodexCliExecutable(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CTI_CODEX_CLI_PATH?.trim();
  if (override) return override;

  const pathValue = env.PATH || '';
  const entries = pathValue.split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32'
    ? ['codex.cmd', 'codex.exe', 'codex']
    : ['codex'];

  for (const dir of entries) {
    if (isNodeModulesBinPath(dir)) continue;
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }

  for (const dir of entries) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (isExecutable(candidate)) return candidate;
    }
  }

  return 'codex';
}

function shouldRetryWithLegacyLinuxSandbox(error: unknown): boolean {
  const err = error as { stderr?: string | Buffer; message?: string };
  const stderr = err.stderr ? String(err.stderr) : '';
  const message = err.message || '';
  return /unexpected argument ['"]--permissions-profile['"]/.test(stderr)
    || /unexpected argument ['"]--permissions-profile['"]/.test(message)
    || /bwrap: execvp .*\/codex\/codex: No such file or directory/.test(stderr)
    || /bwrap: execvp .*\/codex\/codex: No such file or directory/.test(message);
}

export const defaultShellCommandRunner: ShellCommandRunner = async (request) => {
  const executable = resolveCodexCliExecutable();
  const cliStyle = await resolveCodexSandboxCliStyle(executable);
  try {
    let result: ShellCommandRunResult;
    try {
      result = await execCodexSandbox(executable, request, cliStyle);
    } catch (error) {
      if (!shouldRetryWithLegacyLinuxSandbox(error)) throw error;
      result = await execCodexSandbox(executable, request, 'linux-subcommand');
    }
    if (
      result.exitCode !== 0
      && cliStyle !== 'linux-subcommand'
      && shouldRetryWithLegacyLinuxSandbox({ stderr: result.stderr, message: result.stderr })
    ) {
      result = await execCodexSandbox(executable, request, 'linux-subcommand');
    }
    return result;
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      code?: number | string;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      killed?: boolean;
    };
    return {
      exitCode: typeof err.code === 'number' ? err.code : null,
      stdout: err.stdout ? String(err.stdout) : '',
      stderr: err.stderr ? String(err.stderr) : (err.message || String(error)),
      timedOut: err.killed === true || /timed out/i.test(err.message || ''),
    };
  }
};

export function parseShellCommandArgs(rawArgs: string): ParsedShellCommandArgs | { error: string } {
  let rest = rawArgs.trim();
  let force = false;
  let sandboxMode: ShellSandboxMode = DEFAULT_SHELL_SANDBOX_MODE;

  while (rest.startsWith('--')) {
    if (rest === '--') {
      rest = '';
      break;
    }
    if (rest.startsWith('-- ')) {
      rest = rest.slice(3).trimStart();
      break;
    }
    if (rest === '--force' || rest.startsWith('--force ')) {
      force = true;
      rest = rest.slice('--force'.length).trimStart();
      continue;
    }
    if (rest.startsWith('--sandbox=')) {
      const next = consumeLeadingToken(rest.slice('--sandbox='.length));
      const parsed = parseShellSandboxMode(next?.token || '');
      if (!parsed) return { error: 'sandbox 只能是 read-only 或 workspace-write；/shell 不允许 danger-full-access。' };
      sandboxMode = parsed;
      rest = next?.rest.trimStart() || '';
      continue;
    }
    if (rest === '--sandbox' || rest.startsWith('--sandbox ')) {
      const next = consumeLeadingToken(rest.slice('--sandbox'.length));
      const parsed = parseShellSandboxMode(next?.token || '');
      if (!parsed) return { error: 'sandbox 只能是 read-only 或 workspace-write；/shell 不允许 danger-full-access。' };
      sandboxMode = parsed;
      rest = next?.rest.trimStart() || '';
      continue;
    }
    return { error: `未知 /shell 参数：${rest.split(/\s+/)[0]}` };
  }

  const refresh = consumeLeadingRefreshInterval(rest);
  if (refresh) {
    rest = refresh.rest.trimStart();
  }

  return {
    command: normalizeShellCommandTransportMarkdown(rest).trim(),
    force,
    refreshIntervalSeconds: refresh?.intervalSeconds || DEFAULT_SHELL_REFRESH_INTERVAL_SECONDS,
    sandboxMode,
  };
}

export function normalizeShellCommandTransportMarkdown(command: string): string {
  return command.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/gi, (_match, label: string) => label);
}

function consumeLeadingToken(raw: string): { token: string; rest: string } | null {
  const match = raw.trimStart().match(/^(\S+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return {
    token: match[1] || '',
    rest: match[2] || '',
  };
}

function consumeLeadingRefreshInterval(raw: string): { intervalSeconds: number; rest: string } | null {
  const match = raw.trimStart().match(/^(\d+)(?:s|秒)?\s+([\s\S]+)$/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return {
    intervalSeconds: Math.max(MIN_SHELL_REFRESH_INTERVAL_SECONDS, Math.floor(parsed)),
    rest: match[2] || '',
  };
}

function parseShellSandboxMode(value: string): ShellSandboxMode | null {
  const normalized = value.trim().toLowerCase();
  return normalized === 'read-only' || normalized === 'workspace-write' ? normalized : null;
}

function resolveUserShell(): string {
  return process.env.SHELL || (process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/bash');
}

function auditShellCommand(command: string): ShellAuditFinding[] {
  const findings: ShellAuditFinding[] = [];
  if (!command) {
    findings.push({ level: 'block', message: '缺少 shell 命令。' });
    return findings;
  }
  if (command.length > 8_000) {
    findings.push({ level: 'block', message: '命令过长，请拆成更小的命令。' });
  }
  if (command.includes('\0')) {
    findings.push({ level: 'block', message: '命令包含 null byte，已拒绝。' });
  }
  if (command === '/' || command.startsWith('/ ')) {
    findings.push({
      level: 'block',
      message: '命令开头是单独的 `/`，这通常是绝对路径被空格拆开。请检查路径后重新发送。',
    });
  }

  const highRiskPatterns: Array<{ pattern: RegExp; message: string }> = [
    { pattern: /(^|[;&|]\s*)(sudo\s+)?rm(\s|$)/, message: '`rm` 会删除文件或目录。' },
    { pattern: /\bfind\b[\s\S]*\s-delete(\s|$)/, message: '`find ... -delete` 会批量删除文件。' },
    { pattern: /(^|[;&|]\s*)git\s+clean\b/, message: '`git clean` 会删除未跟踪文件。' },
    { pattern: /(^|[;&|]\s*)dd\s+[\s\S]*\bof=/, message: '`dd of=...` 可能覆盖磁盘或文件。' },
    { pattern: /(^|[;&|]\s*)(mkfs|wipefs|shred|truncate)(\s|$)/, message: '该命令可能擦除或破坏数据。' },
    { pattern: /(^|[;&|]\s*)(shutdown|reboot|halt|poweroff)(\s|$)/, message: '该命令会影响系统运行状态。' },
    { pattern: /(^|[;&|]\s*)docker\s+system\s+prune\b/, message: '`docker system prune` 会批量删除 Docker 资源。' },
    { pattern: /(^|[;&|]\s*)chmod\s+-R\s+777\s+\//, message: '`chmod -R 777 /...` 会大范围放宽权限。' },
    { pattern: /(^|[;&|]\s*)chown\s+-R\b/, message: '`chown -R` 会递归修改所有权。' },
  ];

  for (const { pattern, message } of highRiskPatterns) {
    if (pattern.test(command)) {
      findings.push({
        level: 'warn',
        message,
      });
    }
  }

  return findings;
}

function formatShellOutput(label: string, value: string, maxLength: number): string[] {
  const { text, truncated } = sanitizeInput(value.trim() || '(empty)', maxLength);
  return [
    `**${label}**`,
    '',
    buildFencedCodeBlock(text, 'text'),
    ...(truncated ? ['输出过长，已截断。'] : []),
  ];
}

function formatShellElapsed(startedAtMs: number, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.floor((nowMs - startedAtMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

function buildShellStatusText(
  parsed: ParsedShellCommandArgs,
  startedAtMs: number,
  state: 'running' | 'done' | 'failed' | 'timeout',
): string {
  return `shell · ${state} · ${formatShellElapsed(startedAtMs)} · refresh ${parsed.refreshIntervalSeconds}s`;
}

function buildShellExecutionResponse(params: {
  binding: ChannelBinding;
  markdown: boolean;
  parsed: ParsedShellCommandArgs;
  result: ShellCommandRunResult | ShellCommandProgress;
  running: boolean;
  startedAtMs: number;
  warnings: string[];
}): string {
  const { binding, markdown, parsed, result, running, startedAtMs, warnings } = params;
  const exitCode = 'exitCode' in result ? result.exitCode : null;
  const lines = [
    ...buildCommandFields(
      running ? '/shell 执行中' : '/shell 执行完成',
      [
        ['命令', buildFencedCodeBlock(parsed.command, 'sh')],
        ['工作目录', formatCommandPath(binding.workingDirectory)],
        ['Codex sandbox', parsed.sandboxMode],
        ['网络', 'on'],
        ['刷新间隔', `${parsed.refreshIntervalSeconds}s`],
        ['Shell', resolveUserShell()],
        ['运行时间', formatShellElapsed(startedAtMs)],
        ['退出码', exitCode === undefined || exitCode === null ? '-' : String(exitCode)],
      ],
      [
        ...warnings.map((warning) => `已确认高风险操作：${warning}`),
        result.timedOut ? `命令超过 ${Math.round(SHELL_COMMAND_TIMEOUT_MS / 1000)} 秒，已超时终止。` : '',
        result.outputTruncated ? '输出超过限制，已终止或截断。' : '',
      ],
      markdown,
    ).split('\n'),
    '',
    ...formatShellOutput('stdout', result.stdout, 24_000),
    '',
    ...formatShellOutput('stderr', result.stderr, 8_000),
  ];
  return lines.join('\n').trim();
}

export async function handleShellCommand(options: {
  args: string;
  binding: ChannelBinding | null;
  card?: ShellStreamCard;
  markdown: boolean;
  runner?: ShellCommandRunner;
}): Promise<string> {
  const parsed = parseShellCommandArgs(options.args);
  if ('error' in parsed) return parsed.error;
  if (!parsed.command) {
    return [
      '用法：/shell [--force] <command>',
      '示例：/shell --sandbox read-only git status --short',
    ].join('\n');
  }
  if (!options.binding) {
    return '当前聊天还没有绑定会话，无法确定命令工作目录。请先用 `/new` 或 `/t` 选择会话。';
  }

  const findings = auditShellCommand(parsed.command);
  const blocked = findings.filter((finding) => finding.level === 'block');
  if (blocked.length > 0) {
    return buildCommandFields(
      '/shell 已拒绝执行',
      [
        ['命令', buildFencedCodeBlock(parsed.command, 'sh')],
        ['工作目录', formatCommandPath(options.binding.workingDirectory)],
      ],
      blocked.map((finding) => finding.message),
      options.markdown,
    );
  }

  const warnings = findings.filter((finding) => finding.level === 'warn').map((finding) => finding.message);
  if (warnings.length > 0 && !parsed.force) {
    return buildCommandFields(
      '/shell 需要确认',
      [
        ['命令', buildFencedCodeBlock(parsed.command, 'sh')],
        ['工作目录', formatCommandPath(options.binding.workingDirectory)],
        ['Codex sandbox', parsed.sandboxMode],
        ['网络', 'on'],
        ['刷新间隔', `${parsed.refreshIntervalSeconds}s`],
        ['Shell', resolveUserShell()],
      ],
      [
        ...warnings,
        '如果确认要在 Codex sandbox 内直接执行该命令，请追加 `--force` 后重发。',
      ],
      options.markdown,
    );
  }

  const runner = options.runner || defaultShellCommandRunner;
  const startedAtMs = Date.now();
  const card = options.card;
  let latestProgress: ShellCommandProgress = { stdout: '', stderr: '' };
  let lastCardUpdateAt = 0;
  let hasOutputProgressUpdate = false;
  const pushCardSnapshot = (force = false, outputProgress = false) => {
    if (!card) return;
    const now = Date.now();
    if (!force && hasOutputProgressUpdate && now - lastCardUpdateAt < parsed.refreshIntervalSeconds * 1000) return;
    if (outputProgress) hasOutputProgressUpdate = true;
    lastCardUpdateAt = now;
    card.update(
      buildShellExecutionResponse({
        binding: options.binding!,
        markdown: options.markdown,
        parsed,
        result: latestProgress,
        running: true,
        startedAtMs,
        warnings,
      }),
      buildShellStatusText(parsed, startedAtMs, 'running'),
    );
  };
  const cardTimer = card
    ? setInterval(() => pushCardSnapshot(true), parsed.refreshIntervalSeconds * 1000)
    : null;
  pushCardSnapshot(true);
  const result = await runner({
    command: parsed.command,
    cwd: options.binding.workingDirectory,
    sandboxMode: parsed.sandboxMode,
    networkAccess: true,
    shell: resolveUserShell(),
    timeoutMs: SHELL_COMMAND_TIMEOUT_MS,
    refreshIntervalSeconds: parsed.refreshIntervalSeconds,
    onProgress: card
      ? (progress) => {
          latestProgress = progress;
          pushCardSnapshot(false, true);
        }
      : undefined,
  });
  if (cardTimer) clearInterval(cardTimer);

  const finalText = buildShellExecutionResponse({
    binding: options.binding,
    markdown: options.markdown,
    parsed,
    result,
    running: false,
    startedAtMs,
    warnings,
  });
  if (card) {
    const state = result.timedOut ? 'timeout' : result.exitCode === 0 ? 'done' : 'failed';
    card.update(finalText, buildShellStatusText(parsed, startedAtMs, state));
    const finalized = await card.finish(result.exitCode === 0 ? 'completed' : 'error', finalText);
    if (finalized) return '';
  }
  return finalText;
}
