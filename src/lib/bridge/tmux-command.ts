import { spawn } from 'node:child_process';

import {
  buildCodexTuiArgs,
  buildCodexTuiEnv,
} from '../../codex-tmux-provider.js';
import type { BridgeSession, BridgeStore } from './host.js';
import type { StreamChatParams } from './host.js';
import type { ChannelBinding, OutboundRichCard } from './types.js';
import type { StructuredStreamingUiActionButton } from './channel-adapter.js';
import { buildCommandCallbackData } from './command-callbacks.js';
import { buildCommandFields } from './command-formatters.js';
import { buildFencedCodeBlock } from './markdown/fence.js';
import { sanitizeInput } from './security/validators.js';

const DEFAULT_CAPTURE_LINES = 80;
const MIN_CAPTURE_LINES = 1;
const MAX_CAPTURE_LINES = 500;
const MIN_SCREEN_INTERVAL_SECONDS = 3;
const SEND_ACTION_DELAY_MS = 200;
const CAPTURE_AFTER_SEND_DELAY_MS = 250;

function buildTmuxSwitchSelect(
  sessions: TmuxSessionInfo[],
): NonNullable<OutboundRichCard['selects']> {
  return [{
    id: 'tmux_select',
    placeholder: '选择要绑定的 tmux session',
    options: sessions.map((session, index) => {
      const command = `/tmux-attach ${session.name}`;
      return {
        text: session.name,
        callbackData: buildCommandCallbackData(command),
      };
    }),
  }];
}

interface TmuxCommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface TmuxSessionInfo {
  name: string;
  windows: string;
  attached: string;
  created: string;
  activity: string;
}

type TmuxSendAction =
  | { type: 'literal'; text: string }
  | { type: 'key'; key: string };

type TmuxArgv = [string, ...string[]];

export interface HandleTmuxBridgeCommandParams {
  command: string;
  args: string;
  store: BridgeStore;
  binding: ChannelBinding;
  session: BridgeSession;
  markdown: boolean;
  screenMonitor?: {
    key: string;
    stopCallbackData?: string;
    deliver: (text: string) => Promise<void>;
    card?: {
      update: (text: string, statusText: string) => void;
      actions?: (actions: StructuredStreamingUiActionButton[][]) => void;
      finish: (status: 'completed' | 'interrupted' | 'error', text: string) => Promise<boolean>;
    };
  };
  richCard?: (card: OutboundRichCard) => void;
}

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

interface TmuxScreenArgs {
  action: 'show' | 'stop';
  lines?: number;
  intervalSeconds?: number;
}

interface TmuxScreenMonitor {
  timer: ReturnType<typeof setInterval>;
  target: string;
  lines: number;
  intervalSeconds: number;
  markdown: boolean;
  deliver: (text: string) => Promise<void>;
  stopCallbackData?: string;
  card?: {
    update: (text: string, statusText: string) => void;
    actions?: (actions: StructuredStreamingUiActionButton[][]) => void;
    finish: (status: 'completed' | 'interrupted' | 'error', text: string) => Promise<boolean>;
  };
  busy: boolean;
}

const screenMonitors = new Map<string, TmuxScreenMonitor>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quoteShellArg(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function tmuxCommandPreview(args: readonly string[]): string {
  return ['tmux', ...args].map(quoteShellArg).join(' ');
}

function codexCommandPreview(args: readonly string[]): string {
  return ['codex', ...args].map(quoteShellArg).join(' ');
}

function shouldForwardCodexTuiEnv(key: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return false;
  if (key.startsWith('CTI_')) return true;
  if (key.startsWith('OPENAI_')) return true;
  if (key.startsWith('HTTPS_PROXY')) return true;
  if (key.startsWith('HTTP_PROXY')) return true;
  if (key.startsWith('ALL_PROXY')) return true;
  if (key.startsWith('NO_PROXY')) return true;
  if (key.startsWith('NODE_')) return true;
  if (key.startsWith('NVM_')) return true;
  if (key.startsWith('LC_')) return true;
  return [
    'CODEX_API_KEY',
    'CODEX_HOME',
    'HOME',
    'LANG',
    'LITELLM_KEY',
    'LOGNAME',
    'PATH',
    'SHELL',
    'SSL_CERT_FILE',
    'TERM',
    'USER',
  ].includes(key);
}

function codexCommandWithEnvPreview(args: readonly string[]): string {
  const forwardedEnv = Object.entries(buildCodexTuiEnv())
    .filter(([key]) => shouldForwardCodexTuiEnv(key))
    .sort(([a], [b]) => a.localeCompare(b));
  if (forwardedEnv.length === 0) return codexCommandPreview(args);
  return [
    'env',
    ...forwardedEnv.map(([key, value]) => `${key}=${quoteShellArg(value)}`),
    codexCommandPreview(args),
  ].join(' ');
}

export function codexTmuxSessionName(threadId: string): string {
  const safe = threadId.trim().replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 180);
  return `codex-${safe || 'thread'}`;
}

function captureTmuxArgv(target: string, lines: number): TmuxArgv {
  return ['capture-pane', '-t', target, '-p', '-S', `-${lines}`];
}

function buildTmuxCommandPreview(commands: string[], markdown: boolean): string {
  const normalized = commands.map((command) => command.trim()).filter(Boolean);
  if (normalized.length === 0) return '';
  const hasRealTmuxCommand = normalized.some((command) => command.startsWith('tmux '));
  if (markdown) {
    return [
      '**真实 tmux 底层命令**',
      '',
      hasRealTmuxCommand ? buildFencedCodeBlock(normalized.join('\n'), 'sh') : normalized.join('\n'),
    ].join('\n').trim();
  }
  return ['真实 tmux 底层命令', '', ...normalized].join('\n').trim();
}

function appendTmuxCommandPreview(response: string, commands: string[], markdown: boolean): string {
  const preview = buildTmuxCommandPreview(commands, markdown);
  return preview ? [response, preview].filter(Boolean).join('\n\n') : response;
}

function runCommand(command: string, args: string[], stdin?: string): Promise<TmuxCommandResult> {
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

async function runTmux(args: string[], stdin?: string): Promise<TmuxCommandResult> {
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
    sdkSessionId: params.threadId,
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
  const codexCommand = codexCommandWithEnvPreview(codexArgs);
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

function normalizeCaptureLines(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : Number(String(value || '').trim());
  if (!Number.isFinite(parsed)) return DEFAULT_CAPTURE_LINES;
  return Math.min(MAX_CAPTURE_LINES, Math.max(MIN_CAPTURE_LINES, Math.floor(parsed)));
}

function validateTmuxSessionName(raw: string): string | null {
  const name = raw.trim();
  if (!name || name.length > 120) return null;
  if (/[\x00-\x1f\x7f]/.test(name)) return null;
  return name;
}

function getCaptureLines(session: BridgeSession): number {
  return normalizeCaptureLines(session.tmux_capture_lines || DEFAULT_CAPTURE_LINES);
}

function getAutoEnter(session: BridgeSession): boolean {
  return session.tmux_auto_enter === true;
}

function formatOnOff(value: boolean): string {
  return value ? 'on' : 'off';
}

function formatTmuxError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT/.test(message)) {
    return '没有找到 `tmux` 命令，请先确认 tmux 已安装并在 PATH 中。';
  }
  return `tmux 执行失败：${message}`;
}

async function hasTmuxSession(name: string): Promise<boolean> {
  const result = await runCommand('tmux', ['has-session', '-t', name]);
  return result.code === 0;
}

async function listTmuxSessions(): Promise<TmuxSessionInfo[]> {
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

function buildTmuxSwitchResponse(
  sessions: TmuxSessionInfo[],
  currentName: string | undefined,
  markdown: boolean,
): string {
  if (sessions.length === 0) {
    return buildCommandFields(
      'tmux session 选择',
      [],
      ['当前没有 tmux session。可发送 `/tmux-new <name>` 新建并绑定。'],
      markdown,
    );
  }

  const lines = sessions.map((session, index) => {
    const marker = session.name === currentName ? '*' : ' ';
    const attached = Number(session.attached || '0');
    return `${marker} ${index + 1}. ${session.name}  windows=${session.windows || '?'} attached=${attached}`;
  });
  return [
    buildCommandFields(
      'tmux session 选择',
      [
        ['当前绑定', currentName || '未绑定'],
        ['选择方式', '`/tmux-attach <session>`'],
      ],
      ['下面的列表类似 `Ctrl+b s` 的 session 选择；`*` 表示当前绑定。'],
      markdown,
    ),
    markdown ? buildFencedCodeBlock(lines.join('\n'), 'text') : lines.join('\n'),
  ].join('\n\n');
}

function buildTmuxSwitchCommandCard(
  sessions: TmuxSessionInfo[],
): OutboundRichCard {
  if (sessions.length === 0) {
    return {
      title: 'tmux session 选择',
      subtitle: '当前没有 tmux session。',
      template: 'blue',
      sections: [{
        text: '可以发送纯文本命令 `/tmux-new <name>` 新建并绑定。',
      }],
    };
  }

  return {
    title: 'tmux session 选择',
    subtitle: '点击“绑定”会执行对应命令；也可以继续发送纯文本命令。',
    template: 'blue',
    table: {
      pageSize: 10,
      rowHeight: 'low',
      freezeFirstColumn: false,
      columns: [
        { name: 'session', displayName: 'session', width: '260px' },
        { name: 'windows', displayName: '窗口', width: '80px', horizontalAlign: 'right' },
        { name: 'attached', displayName: '连接', width: '80px', horizontalAlign: 'right' },
        { name: 'command', displayName: '命令', width: '320px' },
      ],
      rows: sessions.map((tmuxSession) => ({
        session: tmuxSession.name,
        windows: Number(tmuxSession.windows || '0'),
        attached: Number(tmuxSession.attached || '0'),
        command: `/tmux-attach ${tmuxSession.name}`,
      })),
    },
    sections: [],
    selects: buildTmuxSwitchSelect(sessions),
    footer: [
      '纯文本命令：`/tmux-attach <session>` 绑定指定 session。',
      '表格横向可滚动；长 session 名和命令会省略，可悬浮或点击查看。',
    ],
  };
}

function tmuxDirectHelp(): string[] {
  return [
    '普通字符：直接写在 `/tmux` 后面，例如 `/tmux pwd<Enter>`。',
    '特殊键：用尖括号写，例如 `<Enter>`、`<Tab>`、`<Esc>`。',
    'Ctrl/Cmd：写成 `<C-c>`、`<Ctrl+C>` 或 `<Cmd+C>`，都会按 tmux 的 `C-c` 形式发送。',
    'Option/Alt：写成 `<Option+Enter>`、`<Alt+Enter>` 或 tmux 原生命名 `<M-Enter>`。',
    '混合发送：`/tmux git status<Enter><C-c>` 会先输入普通字符，再按回车，再发 Ctrl+C。',
  ];
}

function tmuxCommandFamilyHelp(): string[] {
  return [
    '`/tmux-switch`：列出 tmux sessions，类似 `Ctrl+b s`。',
    '`/tmux-attach <session>`：把当前 IM 会话绑定到指定 tmux session。',
    '`/tmux-new [session]`：新建并绑定 tmux session；如果已存在，会提示并直接绑定。',
    '`/tmux-status`：查看当前绑定到哪个 tmux session，以及当前展示行数。',
    '`/tmux-set lines <1-500>`：设置 `/tmux ...` 自动截屏返回的行数，默认 80。',
    '`/tmux-set enter on|off`：设置 `/tmux ...` 每次发送后是否自动补一个 Enter。',
    '`/tmux-screen [lines] [seconds]s`：查看当前绑定 tmux session 的屏幕状态；`lines` 只对本次/本轮定时生效。',
    '`/tmux-screen 5s`：使用默认行数，并每 5 秒刷新一次。',
    '`/tmux-screen 120 5s`：临时展示 120 行，并每 5 秒刷新一次；最低间隔 3 秒。',
    '`/tmux-screen stop`：停止当前聊天的 tmux 屏幕定时刷新。',
    '`/tmux ...`：把后面的普通字符和特殊键发送给当前绑定的 tmux session，并自动截屏返回。',
  ];
}

function tmuxFullHelp(): string[] {
  return [
    ...tmuxCommandFamilyHelp(),
    ...tmuxDirectHelp(),
  ];
}

function buildTmuxStatusResponse(session: BridgeSession, markdown: boolean): string {
  return buildCommandFields(
    'tmux 状态',
    [
      ['当前绑定', session.tmux_session_name || '未绑定'],
      ['展示行数', `${getCaptureLines(session)}`],
      ['自动回车', formatOnOff(getAutoEnter(session))],
    ],
    ['查看当前 IM 会话绑定到哪个 tmux session，以及 `/tmux ...` 自动截屏返回的展示行数和发送设置。'],
    markdown,
  );
}

function buildTmuxOverviewResponse(session: BridgeSession, markdown: boolean): string {
  return buildCommandFields(
    'tmux',
    [
      ['当前绑定', session.tmux_session_name || '未绑定'],
      ['展示行数', `${getCaptureLines(session)}`],
      ['自动回车', formatOnOff(getAutoEnter(session))],
    ],
    tmuxFullHelp(),
    markdown,
  );
}

function canonicalBaseKey(raw: string): string | null {
  const normalized = raw.trim();
  const lower = normalized.toLowerCase();
  const named: Record<string, string> = {
    enter: 'Enter',
    return: 'Enter',
    tab: 'Tab',
    esc: 'Escape',
    escape: 'Escape',
    space: 'Space',
    backspace: 'BSpace',
    bs: 'BSpace',
    delete: 'DC',
    del: 'DC',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
  };
  if (named[lower]) return named[lower];
  if (/^f(?:[1-9]|1[0-2])$/i.test(normalized)) return normalized.toUpperCase();
  if (/^[A-Za-z0-9]$/.test(normalized)) return normalized.toLowerCase();
  if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(normalized)) return normalized;
  return null;
}

function parseSpecialKeyToken(raw: string): { key?: string; error?: string } {
  const compact = raw.trim().replace(/\s+/g, '');
  if (!compact) return { error: '空的特殊键。' };

  const modifierMatch = compact.match(/^(ctrl|control|c|cmd|command|option|opt|alt|m)[+-](.+)$/i);
  if (modifierMatch) {
    const modifier = modifierMatch[1].toLowerCase();
    const base = canonicalBaseKey(modifierMatch[2]);
    if (!base) return { error: `不支持的特殊键：<${raw}>。` };
    if ((modifier === 'cmd' || modifier === 'command') && base === 'BSpace') {
      return { key: 'C-u' };
    }
    if (modifier === 'ctrl' || modifier === 'control' || modifier === 'c' || modifier === 'cmd' || modifier === 'command') {
      return { key: `C-${base}` };
    }
    return { key: `M-${base}` };
  }

  const base = canonicalBaseKey(compact);
  if (!base) return { error: `不支持的特殊键：<${raw}>。` };
  return { key: base };
}

function parseTmuxSendActions(raw: string): { actions?: TmuxSendAction[]; error?: string } {
  const actions: TmuxSendAction[] = [];
  const pattern = /<([^<>]+)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(raw)) !== null) {
    const literal = raw.slice(lastIndex, match.index);
    if (literal) actions.push({ type: 'literal', text: literal });

    const parsedKey = parseSpecialKeyToken(match[1]);
    if (parsedKey.error) return { error: parsedKey.error };
    actions.push({ type: 'key', key: parsedKey.key! });
    lastIndex = pattern.lastIndex;
  }

  const trailing = raw.slice(lastIndex);
  if (trailing) actions.push({ type: 'literal', text: trailing });
  return { actions };
}

function shouldAppendAutoEnter(actions: TmuxSendAction[], session: BridgeSession): boolean {
  if (!getAutoEnter(session)) return false;
  const lastAction = actions.at(-1);
  return !(lastAction?.type === 'key' && lastAction.key === 'Enter');
}

function applyAutoEnter(actions: TmuxSendAction[], session: BridgeSession): TmuxSendAction[] {
  return shouldAppendAutoEnter(actions, session)
    ? [...actions, { type: 'key', key: 'Enter' }]
    : actions;
}

function tmuxSendActionArgv(target: string, action: TmuxSendAction): TmuxArgv {
  if (action.type === 'literal') {
    return ['send-keys', '-t', target, '-l', action.text];
  }
  return ['send-keys', '-t', target, action.key];
}

function tmuxSendCommandPreviews(target: string, actions: TmuxSendAction[], captureLines: number): string[] {
  return [
    ...actions.map((action) => tmuxCommandPreview(tmuxSendActionArgv(target, action))),
    tmuxCommandPreview(captureTmuxArgv(target, captureLines)),
  ];
}

async function sendTmuxActions(target: string, actions: TmuxSendAction[]): Promise<void> {
  for (const [index, action] of actions.entries()) {
    await runTmux(tmuxSendActionArgv(target, action));
    if (index < actions.length - 1) {
      await delay(SEND_ACTION_DELAY_MS);
    }
  }
}

async function captureTmuxPane(target: string, lines: number): Promise<string> {
  const result = await runTmux(captureTmuxArgv(target, lines));
  return result.stdout.replace(/\s+$/g, '');
}

function buildTmuxCaptureResponse(screen: string, lines: number, commands: string[], markdown: boolean): string {
  const { text, truncated } = sanitizeInput(screen || '(empty)', 24_000);
  const body = markdown ? buildFencedCodeBlock(text, 'sh') : text;
  const suffix = truncated ? '\n\n（屏幕内容过长已截断）' : '';
  return appendTmuxCommandPreview([
    body + suffix,
    '',
    buildCommandFields(
      'tmux 发送结果',
      [['展示行数', `${lines}`]],
      [],
      markdown,
    ),
  ].join('\n').trim(), commands, markdown);
}

function buildTmuxScreenResponse(
  target: string,
  screen: string,
  lines: number,
  markdown: boolean,
  options?: { intervalSeconds?: number; monitorStarted?: boolean; commands?: string[] },
): string {
  const { text, truncated } = sanitizeInput(screen || '(empty)', 24_000);
  const screenBlock = markdown ? buildFencedCodeBlock(text, 'sh') : text;
  const suffix = truncated ? '\n\n（屏幕内容过长已截断）' : '';
  const notes = ['只查看当前屏幕，不发送任何按键。'];
  if (options?.intervalSeconds) {
    notes.push(options.monitorStarted
      ? `已开启定时刷新：每 ${options.intervalSeconds} 秒刷新一次；发送 \`/tmux-screen stop\` 停止。`
      : `定时刷新：每 ${options.intervalSeconds} 秒。`);
  }
  const response = [
    buildCommandFields(
      'tmux 当前屏幕状态',
      [
        ['tmux session', target],
        ['展示行数', `${lines}`],
        ...(options?.intervalSeconds ? [['定时刷新', `${options.intervalSeconds}s`] as [string, string]] : []),
      ],
      notes,
      markdown,
    ),
    '',
    screenBlock + suffix,
  ].join('\n').trim();
  return appendTmuxCommandPreview(response, options?.commands || [], markdown);
}

function formatTmuxScreenCardStatus(target: string, lines: number, intervalSeconds: number): string {
  const refreshedAt = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  return `tmux ${target} · ${lines} lines · every ${intervalSeconds}s · ${refreshedAt}`;
}

function buildTmuxScreenStopActions(callbackData: string, stopped: boolean): StructuredStreamingUiActionButton[][] {
  return [[{
    text: stopped ? '已停止' : '停止',
    callbackData,
    type: stopped ? 'default' : 'danger',
    disabled: stopped,
  }]];
}

function buildTmuxAttachResponse(
  title: string,
  fields: Array<[string, string | null | undefined]>,
  screen: string,
  lines: number,
  commands: string[],
  markdown: boolean,
): string {
  const { text, truncated } = sanitizeInput(screen || '(empty)', 24_000);
  const screenBlock = markdown ? buildFencedCodeBlock(text, 'sh') : text;
  const suffix = truncated ? '\n\n（屏幕内容过长已截断）' : '';
  const response = [
    buildCommandFields(
      title,
      fields,
      ['已展示当前 tmux 屏幕；之后发送 `/tmux ...` 会把按键传给这个 tmux session，并自动截屏返回。'],
      markdown,
    ),
    '',
    screenBlock + suffix,
  ].join('\n').trim();
  return appendTmuxCommandPreview(response, commands, markdown);
}

function parseOnOff(raw: string): boolean | null {
  const token = raw.trim().toLowerCase();
  if (['on', 'true', '1', 'yes', 'enable', 'enabled'].includes(token)) return true;
  if (['off', 'false', '0', 'no', 'disable', 'disabled'].includes(token)) return false;
  return null;
}

function parseTmuxSetArgs(args: string): { key: 'lines'; value: number } | { key: 'enter'; value: boolean } | null {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return null;
  const key = parts[0].toLowerCase();
  if (['lines', 'line', 'rows', 'row', 'capture-lines', 'capture'].includes(key)) {
    if (!/^\d+$/.test(parts[1])) return null;
    return { key: 'lines', value: normalizeCaptureLines(parts[1]) };
  }
  if (['enter', 'auto-enter', 'autoenter', 'submit'].includes(key)) {
    const value = parseOnOff(parts[1]);
    return value === null ? null : { key: 'enter', value };
  }
  return null;
}

function parseIntervalSeconds(raw: string): number | null {
  const token = raw.trim().toLowerCase();
  const match = token.match(/^(\d+)s$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.max(MIN_SCREEN_INTERVAL_SECONDS, Math.floor(parsed));
}

function parseTmuxScreenArgs(args: string): TmuxScreenArgs | null {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { action: 'show' };
  if (parts.length === 1 && parts[0].toLowerCase() === 'stop') return { action: 'stop' };

  let lines: number | undefined;
  let intervalSeconds: number | undefined;

  if (parts.length === 1) {
    const token = parts[0].toLowerCase();
    const interval = parseIntervalSeconds(token);
    if (interval) return { action: 'show', intervalSeconds: interval };
    if (/^\d+$/.test(token)) return { action: 'show', lines: normalizeCaptureLines(token) };
    return null;
  }

  if (parts.length !== 2) return null;
  const [lineToken, intervalToken] = parts.map((part) => part.toLowerCase());
  if (!/^\d+$/.test(lineToken)) return null;
  lines = normalizeCaptureLines(lineToken);
  intervalSeconds = parseIntervalSeconds(intervalToken) ?? undefined;
  if (!intervalSeconds) return null;

  return { action: 'show', lines, intervalSeconds };
}

function stopTmuxScreenMonitor(key: string): TmuxScreenMonitor | null {
  const existing = screenMonitors.get(key);
  if (!existing) return null;
  clearInterval(existing.timer);
  screenMonitors.delete(key);
  return existing;
}

function startTmuxScreenMonitor(params: {
  key: string;
  target: string;
  lines: number;
  intervalSeconds: number;
  markdown: boolean;
  deliver: (text: string) => Promise<void>;
  stopCallbackData?: string;
  card?: {
    update: (text: string, statusText: string) => void;
    actions?: (actions: StructuredStreamingUiActionButton[][]) => void;
    finish: (status: 'completed' | 'interrupted' | 'error', text: string) => Promise<boolean>;
  };
}): void {
  stopTmuxScreenMonitor(params.key);
  const monitor: TmuxScreenMonitor = {
    timer: setInterval(async () => {
      if (monitor.busy) return;
      monitor.busy = true;
      try {
        const screen = await captureTmuxPane(monitor.target, monitor.lines);
        const text = buildTmuxScreenResponse(
          monitor.target,
          screen,
          monitor.lines,
          monitor.markdown,
          {
            intervalSeconds: monitor.intervalSeconds,
            commands: monitor.card ? [] : [tmuxCommandPreview(captureTmuxArgv(monitor.target, monitor.lines))],
          },
        );
        if (monitor.card) {
          monitor.card.update(text, formatTmuxScreenCardStatus(monitor.target, monitor.lines, monitor.intervalSeconds));
        } else {
          await monitor.deliver(text);
        }
      } catch (error) {
        const text = formatTmuxError(error);
        if (monitor.card) {
          monitor.card.update(text, `tmux ${monitor.target} · refresh failed`);
        } else {
          await monitor.deliver(text);
        }
      } finally {
        monitor.busy = false;
      }
    }, params.intervalSeconds * 1000),
    target: params.target,
    lines: params.lines,
    intervalSeconds: params.intervalSeconds,
    markdown: params.markdown,
    deliver: params.deliver,
    stopCallbackData: params.stopCallbackData,
    card: params.card,
    busy: false,
  };
  screenMonitors.set(params.key, monitor);
}

export async function handleTmuxBridgeCommand(params: HandleTmuxBridgeCommandParams): Promise<string> {
  const { command, args, store, binding, session, markdown } = params;

  try {
    if (command === '/tmux-switch') {
      const sessions = await listTmuxSessions();
      params.richCard?.(buildTmuxSwitchCommandCard(sessions));
      return appendTmuxCommandPreview(
        buildTmuxSwitchResponse(sessions, session.tmux_session_name, markdown),
        [tmuxCommandPreview([
          'list-sessions',
          '-F',
          '#{session_name}\t#{session_windows}\t#{session_attached}\t#{session_created}\t#{session_activity}',
        ])],
        markdown,
      );
    }

    if (command === '/tmux-status') {
      return buildTmuxStatusResponse(session, markdown);
    }

    if (command === '/tmux-screen') {
      const parsed = parseTmuxScreenArgs(args);
      if (!parsed) {
        return buildCommandFields(
          'tmux 屏幕用法',
          [['命令', '`/tmux-screen [lines] [seconds]s`']],
          [
            '`/tmux-screen`：查看默认行数。',
            '`/tmux-screen 120`：临时查看 120 行，不修改 `/tmux-set` 的默认值。',
            '`/tmux-screen 5s`：使用默认行数，每 5 秒刷新一次。',
            '`/tmux-screen 120 5s`：临时查看 120 行，并每 5 秒刷新一次；最低 3 秒。',
            '`/tmux-screen stop`：停止当前聊天的定时刷新。',
          ],
          markdown,
        );
      }
      if (parsed.action === 'stop') {
        if (!params.screenMonitor) return '当前环境不支持停止 tmux 屏幕定时刷新。';
        const stopped = stopTmuxScreenMonitor(params.screenMonitor.key);
        if (!stopped) return '当前聊天没有正在运行的 tmux 屏幕定时刷新。';
        if (stopped.card) {
          if (stopped.stopCallbackData) {
            stopped.card.actions?.(buildTmuxScreenStopActions(stopped.stopCallbackData, true));
          }
          await stopped.card.finish('interrupted', '已停止 tmux 屏幕定时刷新。');
        }
        return '已停止 tmux 屏幕定时刷新。';
      }

      const target = session.tmux_session_name;
      if (!target) {
        return 'tmux 未绑定。先发送 `/tmux-switch` 查看 session，或 `/tmux-attach <session>` / `/tmux-new <session>` 绑定。';
      }
      const lines = parsed.lines ?? getCaptureLines(session);
      const commandPreview = tmuxCommandPreview(captureTmuxArgv(target, lines));
      const screen = await captureTmuxPane(target, lines);
      if (parsed.intervalSeconds) {
        if (!params.screenMonitor) return appendTmuxCommandPreview('当前环境不支持 tmux 屏幕定时刷新。', [commandPreview], markdown);
        const card = params.screenMonitor.card;
        const initialText = buildTmuxScreenResponse(target, screen, lines, markdown, {
          intervalSeconds: parsed.intervalSeconds,
          monitorStarted: true,
          commands: card ? [] : [commandPreview],
        });
        if (card) {
          if (params.screenMonitor.stopCallbackData) {
            card.actions?.(buildTmuxScreenStopActions(params.screenMonitor.stopCallbackData, false));
          }
          card.update(initialText, formatTmuxScreenCardStatus(target, lines, parsed.intervalSeconds));
        }
        startTmuxScreenMonitor({
          key: params.screenMonitor.key,
          target,
          lines,
          intervalSeconds: parsed.intervalSeconds,
          markdown,
          deliver: params.screenMonitor.deliver,
          stopCallbackData: params.screenMonitor.stopCallbackData,
          card,
        });
        if (card) return '';
      }
      return buildTmuxScreenResponse(target, screen, lines, markdown, {
        intervalSeconds: parsed.intervalSeconds,
        monitorStarted: Boolean(parsed.intervalSeconds),
        commands: [commandPreview],
      });
    }

    if (command === '/tmux-set') {
      const parsed = parseTmuxSetArgs(args);
      if (!parsed) {
        return buildCommandFields(
          'tmux 设置用法',
          [['命令', '`/tmux-set lines <1-500>` 或 `/tmux-set enter on|off`']],
          [
            `当前展示行数：${getCaptureLines(session)}`,
            `当前自动回车：${formatOnOff(getAutoEnter(session))}`,
          ],
          markdown,
        );
      }
      if (parsed.key === 'lines') {
        store.updateSession(session.id, { tmux_capture_lines: parsed.value });
        return buildCommandFields(
          '已更新 tmux 设置',
          [['展示行数', `${parsed.value}`]],
          ['下一次 `/tmux ...` 截屏生效。'],
          markdown,
        );
      }
      store.updateSession(session.id, { tmux_auto_enter: parsed.value });
      return buildCommandFields(
        '已更新 tmux 设置',
        [['自动回车', formatOnOff(parsed.value)]],
        [
          parsed.value
            ? '之后 `/tmux ...` 会在发送内容后自动补一个 Enter；如果消息已显式以 `<Enter>` 结尾，不会重复补。'
            : '之后 `/tmux ...` 不会自动补 Enter。',
        ],
        markdown,
      );
    }

    if (command === '/tmux-attach') {
      const name = validateTmuxSessionName(args);
      if (!name) return '用法：/tmux-attach <session>';
      const hasSessionCommand = tmuxCommandPreview(['has-session', '-t', name]);
      if (!(await hasTmuxSession(name))) {
        return appendTmuxCommandPreview(
          `没有找到 tmux session：${name}。可先发送 \`/tmux-switch\` 查看，或 \`/tmux-new ${name}\` 新建。`,
          [hasSessionCommand],
          markdown,
        );
      }
      store.updateSession(session.id, { tmux_session_name: name });
      const lines = getCaptureLines(session);
      const captureCommand = tmuxCommandPreview(captureTmuxArgv(name, lines));
      const screen = await captureTmuxPane(name, lines);
      return buildTmuxAttachResponse(
        '已绑定 tmux session',
        [
          ['tmux session', name],
          ['Bridge session', binding.codepilotSessionId],
          ['展示行数', `${lines}`],
        ],
        screen,
        lines,
        [hasSessionCommand, captureCommand],
        markdown,
      );
    }

    if (command === '/tmux-new') {
      const requestedName = args.trim() || `cti-${binding.codepilotSessionId.slice(0, 8)}`;
      const name = validateTmuxSessionName(requestedName);
      if (!name) return '用法：/tmux-new [session]';
      const cwd = binding.workingDirectory || process.cwd();
      const hasSessionCommand = tmuxCommandPreview(['has-session', '-t', name]);
      const existed = await hasTmuxSession(name);
      if (!existed) {
        await runTmux(['new-session', '-d', '-s', name, '-c', cwd]);
      }
      store.updateSession(session.id, { tmux_session_name: name });
      const lines = getCaptureLines(session);
      const commands = [
        hasSessionCommand,
        ...(existed ? [] : [tmuxCommandPreview(['new-session', '-d', '-s', name, '-c', cwd])]),
        tmuxCommandPreview(captureTmuxArgv(name, lines)),
      ];
      const screen = await captureTmuxPane(name, lines);
      return buildTmuxAttachResponse(
        existed ? 'tmux session 已存在，已直接绑定' : '已新建并绑定 tmux session',
        [
          ['tmux session', name],
          ['目录', cwd],
          ['展示行数', `${lines}`],
        ],
        screen,
        lines,
        commands,
        markdown,
      );
    }

    if (command === '/tmux') {
      const target = session.tmux_session_name;
      if (!args.trim()) {
        return buildTmuxOverviewResponse(session, markdown);
      }
      if (!target) {
        return buildCommandFields(
          'tmux 未绑定',
          [],
          ['先发送 `/tmux-switch` 查看 session，或 `/tmux-attach <session>` / `/tmux-new <session>` 绑定。'],
          markdown,
        );
      }
      const parsed = parseTmuxSendActions(args);
      if (parsed.error) {
        return buildCommandFields(
          'tmux 按键用法',
          [['错误', parsed.error]],
          ['发送 `/tmux` 查看完整用法。'],
          markdown,
        );
      }
      const actions = parsed.actions || [];
      const actionsToSend = applyAutoEnter(actions, session);
      await sendTmuxActions(target, actionsToSend);
      await delay(CAPTURE_AFTER_SEND_DELAY_MS);
      const lines = getCaptureLines(session);
      const screen = await captureTmuxPane(target, lines);
      return buildTmuxCaptureResponse(screen, lines, tmuxSendCommandPreviews(target, actionsToSend, lines), markdown);
    }

    return `未知 tmux 命令：${command}`;
  } catch (error) {
    return formatTmuxError(error);
  }
}
