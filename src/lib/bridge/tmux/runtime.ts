import { spawn } from 'node:child_process';

import {
  buildCodexTuiArgs,
  buildCodexTuiEnv,
  buildCodexTuiShellCommand,
} from '../../../codex/tmux-provider.js';
import type { StreamChatParams } from '../host.js';

export interface TmuxCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface TmuxSessionInfo {
  name: string;
  windows: string;
  attached: string;
  created: string;
  activity: string;
}

export type TmuxArgv = [string, ...string[]];

export interface StartCodexResumeTmuxSessionParams {
  sessionName: string;
  threadId: string;
  bridgeSessionId: string;
  workingDirectory?: string;
  model?: string;
  sandboxMode?: StreamChatParams['sandboxMode'];
  networkAccessEnabled?: boolean;
  modelReasoningEffort?: StreamChatParams['modelReasoningEffort'];
  skipGitRepoCheck?: boolean;
  codexMode?: StreamChatParams['codexMode'];
  permissionMode?: string;
}

function quoteShellArg(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function tmuxCommandPreview(args: readonly string[]): string {
  return ['tmux', ...args].map(quoteShellArg).join(' ');
}

export function codexTmuxSessionName(threadId: string): string {
  const safe = threadId.trim().replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 180);
  return `codex-${safe || 'thread'}`;
}

export function captureTmuxArgv(target: string, lines: number): TmuxArgv {
  return ['capture-pane', '-t', target, '-p', '-S', `-${lines}`];
}

export function runCommand(command: string, args: string[], stdin?: string): Promise<TmuxCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: process.platform === 'win32',
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, stdout, stderr }));
    if (stdin !== undefined) {
      child.stdin?.end(stdin);
    }
  });
}

export async function runTmux(args: string[], stdin?: string): Promise<TmuxCommandResult> {
  const result = await runCommand('tmux', args, stdin);
  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || `tmux ${args[0] || ''} failed`).trim());
  }
  return result;
}

export function buildCodexResumeTmuxCommand(params: StartCodexResumeTmuxSessionParams): {
  tmuxArgs: string[];
  codexCommand: string;
} {
  const codexArgs = buildCodexTuiArgs({
    prompt: '',
    sessionId: params.bridgeSessionId,
    codexThreadId: params.threadId,
    model: params.model,
    forceModel: false,
    sandboxMode: params.sandboxMode,
    networkAccessEnabled: params.networkAccessEnabled,
    modelReasoningEffort: params.modelReasoningEffort,
    skipGitRepoCheck: params.skipGitRepoCheck,
    workingDirectory: params.workingDirectory,
    permissionMode: params.permissionMode,
    codexMode: params.codexMode,
  }, []);
  const codexCommand = buildCodexTuiShellCommand('codex', codexArgs, buildCodexTuiEnv());
  const tmuxArgs = ['new-session', '-d', '-s', params.sessionName];
  if (params.workingDirectory) {
    tmuxArgs.push('-c', params.workingDirectory);
  }
  tmuxArgs.push('--', codexCommand);
  return { tmuxArgs, codexCommand };
}

export async function startCodexResumeTmuxSession(params: StartCodexResumeTmuxSessionParams): Promise<{
  existed: boolean;
  sessionName: string;
  codexCommand: string;
  tmuxCommand: string;
}> {
  const existed = await hasTmuxSession(params.sessionName);
  const { tmuxArgs, codexCommand } = buildCodexResumeTmuxCommand(params);
  if (existed) {
    await runTmux(['kill-session', '-t', params.sessionName]);
  }
  await runTmux(tmuxArgs);
  return {
    existed,
    sessionName: params.sessionName,
    codexCommand,
    tmuxCommand: tmuxCommandPreview(tmuxArgs),
  };
}

export async function sendTmuxInterrupt(target: string): Promise<string> {
  const args: TmuxArgv = ['send-keys', '-t', target, 'C-c'];
  await runTmux(args);
  return tmuxCommandPreview(args);
}

export async function hasTmuxSession(name: string): Promise<boolean> {
  const result = await runCommand('tmux', ['has-session', '-t', name]);
  return result.code === 0;
}

export async function listTmuxSessions(): Promise<TmuxSessionInfo[]> {
  const result = await runCommand('tmux', [
    'list-sessions',
    '-F',
    '#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}\t#{session_activity}',
  ]);
  if (result.code !== 0) {
    if (/no server running|failed to connect/i.test(result.stderr || result.stdout)) return [];
    throw new Error((result.stderr || result.stdout || 'tmux list-sessions failed').trim());
  }
  return result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name = '', windows = '', attached = '', created = '', activity = ''] = line.split('\t');
      return { name, windows, attached, created, activity };
    })
    .filter((session) => session.name);
}
