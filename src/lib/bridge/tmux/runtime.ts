import {
  buildCodexTuiArgs,
  buildCodexTuiEnv,
  buildCodexTuiShellCommand,
} from '../../../codex/tmux-provider.js';
import type { StreamChatParams } from '../host.js';
import {
  tmuxCore,
  type TmuxCore,
} from './core.js';

export {
  tmuxCore,
  type TmuxCore,
  type TmuxSendAction,
  type TmuxSessionInfo,
} from './core.js';

export interface StartCodexResumeTmuxSessionParams {
  sessionName: string;
  threadId?: string;
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

export interface StartCodexResumeTmuxSessionResult {
  existed: boolean;
  sessionName: string;
  codexCommand: string;
  tmuxCommand: string;
  commands: string[];
}

export function codexTmuxSessionName(threadId: string): string {
  const safe = threadId.trim().replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 180);
  return `codex_${safe || 'thread'}`;
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

export async function startCodexResumeTmuxSession(
  params: StartCodexResumeTmuxSessionParams,
  core: TmuxCore = tmuxCore,
): Promise<StartCodexResumeTmuxSessionResult> {
  const { codexCommand } = buildCodexResumeTmuxCommand(params);
  const started = await core.ensureDetachedSession({
    name: params.sessionName,
    cwd: params.workingDirectory,
    command: codexCommand,
    recreate: true,
  });
  return {
    existed: started.existed,
    sessionName: params.sessionName,
    codexCommand,
    tmuxCommand: started.command || '',
    commands: started.commands,
  };
}

export async function sendTmuxInterrupt(target: string): Promise<string> {
  return tmuxCore.sendInterrupt(target);
}
