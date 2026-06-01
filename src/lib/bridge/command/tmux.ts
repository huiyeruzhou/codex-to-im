import type { BridgeSession, BridgeStore } from '../host.js';
import type { ChannelBinding, OutboundRichCard } from '../types.js';
import type { StructuredStreamingUiActionButton } from '../channel-adapter.js';
import { buildCommandCallbackData } from '../command-callbacks.js';
import { buildCommandFields } from './presentation.js';
import { buildFencedCodeBlock } from '../markdown/fence.js';
import { sanitizeInput } from '../security/validators.js';
import { getBridgeContext } from '../context.js';
import {
  tmuxCore,
  codexTmuxSessionName,
  startCodexResumeTmuxSession,
  type StartCodexResumeTmuxSessionParams,
  type TmuxSendAction,
  type TmuxSessionInfo,
} from '../tmux/runtime.js';
import { resolveEffectiveCodexProvider, resolveSessionRuntimeConfig } from '../bridge-session-support.js';
import { getCodexThreadId } from '../turns/turn-classifier.js';
import {
  bootstrapCodexThreadWithSdk,
  type BootstrapCodexThreadParams,
} from './runtime-settings.js';
export {
  buildCodexResumeTmuxCommand,
  codexTmuxSessionName,
  sendTmuxInterrupt,
  startCodexResumeTmuxSession,
  type StartCodexResumeTmuxSessionParams,
} from '../tmux/runtime.js';

const DEFAULT_CAPTURE_LINES = 0;
const MIN_CAPTURE_LINES = 0;
const MAX_CAPTURE_LINES = 500;
const MIN_SCREEN_INTERVAL_SECONDS = 3;
const SEND_ACTION_DELAY_MS = 500;
const CAPTURE_AFTER_SEND_DELAY_MS = 250;

function buildTmuxSwitchSelect(
  sessions: TmuxSessionInfo[],
  scopeSessionId: string,
): NonNullable<OutboundRichCard['selects']> {
  return [{
    id: 'tmux_select',
    placeholder: '选择要绑定的 tmux session',
    options: sessions.map((session, index) => {
      const command = `/tmux-attach ${session.name}`;
      return {
        text: session.name,
        callbackData: buildCommandCallbackData(command, scopeSessionId),
      };
    }),
  }];
}

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
  autoRecoverProviderSession?: boolean;
  reconcileMirrorSubscriptions?: () => Promise<void>;
}

interface TmuxScreenArgs {
  action: 'show' | 'stop';
  lines?: number;
  intervalSeconds?: number;
}

interface TmuxScreenMonitor {
  timer: ReturnType<typeof setTimeout>;
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
  stopped: boolean;
}

const screenMonitors = new Map<string, TmuxScreenMonitor>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopAllTmuxScreenMonitors(): number {
  const monitors = [...screenMonitors.values()];
  for (const monitor of monitors) {
    monitor.stopped = true;
    clearTimeout(monitor.timer);
  }
  screenMonitors.clear();
  return monitors.length;
}

export const _testOnlyTmuxScreenMonitors = {
  activeCount: () => screenMonitors.size,
  stopAll: stopAllTmuxScreenMonitors,
};

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
  scopeSessionId: string,
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
    selects: buildTmuxSwitchSelect(sessions, scopeSessionId),
    footer: [
      '纯文本命令：`/tmux-attach <session>` 绑定指定 session。',
      '表格横向可滚动；长 session 名和命令会省略，可悬浮或点击查看。',
    ],
  };
}

function tmuxDirectHelp(): string[] {
  return [
    '普通文本：直接写在 `/tmux` 后面，例如 `/tmux pwd`；如果整段不是特殊键序列，尖括号会按原文发送。',
    '纯特殊键序列：`/tmux <C-c><Enter>` 会按顺序发送 Ctrl+C 和 Enter。',
    '特殊键：使用 `/tmux-key` 和尖括号，例如 `/tmux-key <Enter>`、`/tmux-key <Tab>`、`/tmux-key <Esc>`。',
    'Ctrl/Cmd：写成 `/tmux-key <C-c>`、`/tmux-key <Ctrl+C>` 或 `/tmux-key <Cmd+C>`，都会按 tmux 的 `C-c` 形式发送。',
    'Option/Alt：写成 `/tmux-key <Option+Enter>`、`/tmux-key <Alt+Enter>` 或 tmux 原生命名 `/tmux-key <M-Enter>`。',
    '混合按键：`/tmux-key git status<Enter><C-c>` 会先输入普通字符，再按回车，再发 Ctrl+C。',
  ];
}

function tmuxCommandFamilyHelp(): string[] {
  return [
    '`/tmux-switch`：列出 tmux sessions，类似 `Ctrl+b s`。',
    '`/tmux-attach <session>`：把当前 IM 会话绑定到指定 tmux session。',
    '`/tmux-new [session]`：新建并绑定 tmux session；如果已存在，会提示并直接绑定。',
    '`/tmux-status`：查看当前绑定到哪个 tmux session，以及当前展示行数。',
    '`/tmux-set lines <0-500>`：设置 `/tmux ...` 自动截屏返回的行数，默认 0。',
    '`/tmux-set enter on|off`：设置 `/tmux ...` 每次发送后是否自动补一个 Enter。',
    '`/tmux-screen [lines] [seconds]s`：查看当前绑定 tmux session 的屏幕状态；`lines` 只对本次/本轮定时生效。',
    '`/tmux-screen 5s`：使用默认行数，并每 5 秒刷新一次。',
    '`/tmux-screen 120 5s`：临时展示 120 行，并每 5 秒刷新一次；最低间隔 3 秒。',
    '`/tmux-screen stop`：停止当前聊天的 tmux 屏幕定时刷新。',
    '`/tmux ...`：把后面的普通文本发送给当前绑定的 tmux session，并自动截屏返回；尖括号按原文发送。',
    '`/tmux-key ...`：解析 `<Enter>`、`<C-c>` 等特殊键，适合需要按键控制或混合文本/按键的场景。',
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

function parseTmuxKeySequence(raw: string): TmuxSendAction[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const actions: TmuxSendAction[] = [];
  const pattern = /<([^<>]+)>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(trimmed)) !== null) {
    if (trimmed.slice(lastIndex, match.index).trim()) return null;
    const parsedKey = parseSpecialKeyToken(match[1]);
    if (parsedKey.error) return null;
    actions.push({ type: 'key', key: parsedKey.key! });
    lastIndex = pattern.lastIndex;
  }

  if (trimmed.slice(lastIndex).trim()) return null;
  return actions.length > 0 ? actions : null;
}

function isPureSpecialKeySyntax(raw: string): boolean {
  const trimmed = raw.trim();
  return Boolean(trimmed) && /^(?:<[^<>]+>\s*)+$/.test(trimmed);
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

async function ensureCodexTmuxSessionForProvider(
  params: Pick<HandleTmuxBridgeCommandParams, 'store' | 'binding' | 'session' | 'autoRecoverProviderSession' | 'reconcileMirrorSubscriptions'>,
): Promise<{ target: string | undefined; commands: string[]; recovered: boolean; error?: string }> {
  const { store, binding, session } = params;
  const configuredTarget = session.tmux_session_name?.trim() || '';
  if (resolveEffectiveCodexProvider(session) !== 'tmux') {
    return { target: configuredTarget || undefined, commands: [], recovered: false };
  }

  let threadId = getCodexThreadId(session, binding);
  if (!threadId && params.autoRecoverProviderSession === true) {
    const runtimeConfig = resolveSessionRuntimeConfig(binding, session);
    const bootstrapParams: BootstrapCodexThreadParams = {
      session,
      binding,
      mode: runtimeConfig.mode,
      sandboxMode: runtimeConfig.sandboxMode as BootstrapCodexThreadParams['sandboxMode'],
      networkAccessEnabled: runtimeConfig.networkAccessEnabled,
      modelReasoningEffort: runtimeConfig.reasoningEffort as BootstrapCodexThreadParams['modelReasoningEffort'],
      skipGitRepoCheck: runtimeConfig.skipGitRepoCheck,
    };
    threadId = await bootstrapCodexThreadWithSdk(getBridgeContext().llm, bootstrapParams);
    store.updateSessionCodexThreadId(session.id, threadId);
  }

  const target = configuredTarget || (threadId ? codexTmuxSessionName(threadId) : '');
  if (!target) {
    return {
      target: undefined,
      commands: [],
      recovered: false,
      error: 'tmux Provider 缺少 codex_thread_id，无法自动恢复 Codex TUI。请先发送 `/provider tmux` 重新初始化。',
    };
  }

  const exists = await tmuxCore.hasSession(target);
  if (exists.exists) {
    if (!configuredTarget || !session.codex_thread_id) {
      store.updateSession(session.id, {
        tmux_session_name: target,
        ...(threadId ? { codex_thread_id: threadId } : {}),
      });
      await params.reconcileMirrorSubscriptions?.();
    }
    return { target, commands: [exists.command], recovered: false };
  }

  if (params.autoRecoverProviderSession !== true) {
    return {
      target,
      commands: [exists.command],
      recovered: false,
      error: `tmux session 不存在：${target}。请先发送 \`/provider tmux\` 重新启动 Codex TUI，或发送 \`/tmux-new ${target}\` 手动创建。`,
    };
  }

  if (!threadId) {
    return {
      target,
      commands: [exists.command],
      recovered: false,
      error: 'tmux Provider 缺少 codex_thread_id，无法自动恢复 Codex TUI。请先发送 `/provider tmux` 重新初始化。',
    };
  }

  const runtimeConfig = resolveSessionRuntimeConfig(binding, session);
  const started = await startCodexResumeTmuxSession({
    sessionName: target,
    threadId,
    bridgeSessionId: session.id,
    workingDirectory: binding.workingDirectory || session.working_directory,
    model: runtimeConfig.model || undefined,
    sandboxMode: runtimeConfig.sandboxMode as StartCodexResumeTmuxSessionParams['sandboxMode'],
    networkAccessEnabled: runtimeConfig.networkAccessEnabled,
    modelReasoningEffort: runtimeConfig.reasoningEffort as StartCodexResumeTmuxSessionParams['modelReasoningEffort'],
    skipGitRepoCheck: runtimeConfig.skipGitRepoCheck,
    codexMode: runtimeConfig.mode === 'yolo' ? 'yolo' : 'normal',
    permissionMode: runtimeConfig.mode === 'yolo' ? 'never' : 'acceptEdits',
  });
  store.updateSession(session.id, {
    codex_provider: 'tmux',
    tmux_session_name: target,
    tmux_auto_enter: session.tmux_auto_enter === true,
    codex_thread_id: threadId,
  });
  await params.reconcileMirrorSubscriptions?.();
  return { target, commands: [exists.command, ...started.commands], recovered: true };
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
  existing.stopped = true;
  clearTimeout(existing.timer);
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
    timer: setTimeout(() => {}, params.intervalSeconds * 1000),
    target: params.target,
    lines: params.lines,
    intervalSeconds: params.intervalSeconds,
    markdown: params.markdown,
    deliver: params.deliver,
    stopCallbackData: params.stopCallbackData,
    card: params.card,
    busy: false,
    stopped: false,
  };
  const scheduleNext = () => {
    if (monitor.stopped) return;
    monitor.timer = setTimeout(async () => {
      if (monitor.stopped) return;
      if (monitor.busy) {
        scheduleNext();
        return;
      }
      monitor.busy = true;
      try {
        const capture = await tmuxCore.capturePane(monitor.target, monitor.lines);
        if (monitor.stopped) return;
        const text = buildTmuxScreenResponse(
          monitor.target,
          capture.screen,
          monitor.lines,
          monitor.markdown,
          {
            intervalSeconds: monitor.intervalSeconds,
            commands: monitor.card ? [] : [capture.command],
          },
        );
        if (monitor.card) {
          monitor.card.update(text, formatTmuxScreenCardStatus(monitor.target, monitor.lines, monitor.intervalSeconds));
        } else {
          await monitor.deliver(text);
        }
      } catch (error) {
        if (monitor.stopped) return;
        const text = formatTmuxError(error);
        if (monitor.card) {
          monitor.card.update(text, `tmux ${monitor.target} · refresh failed`);
        } else {
          await monitor.deliver(text);
        }
      } finally {
        monitor.busy = false;
        scheduleNext();
      }
    }, monitor.intervalSeconds * 1000);
    monitor.timer.unref?.();
  };
  clearTimeout(monitor.timer);
  scheduleNext();
  screenMonitors.set(params.key, monitor);
}

export async function handleTmuxBridgeCommand(params: HandleTmuxBridgeCommandParams): Promise<string> {
  const { command, args, store, binding, session, markdown } = params;

  try {
    if (command === '/tmux-switch') {
      const { sessions, command: listCommand } = await tmuxCore.listSessions();
      params.richCard?.(buildTmuxSwitchCommandCard(sessions, params.binding.bridgeSessionId));
      return appendTmuxCommandPreview(
        buildTmuxSwitchResponse(sessions, session.tmux_session_name, markdown),
        [listCommand],
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

      const ensured = await ensureCodexTmuxSessionForProvider(params);
      if (ensured.error) return ensured.error;
      const captureTarget = ensured.target || session.tmux_session_name;
      if (!captureTarget) {
        return 'tmux 未绑定。先发送 `/tmux-switch` 查看 session，或 `/tmux-attach <session>` / `/tmux-new <session>` 绑定。';
      }
      const lines = parsed.lines ?? getCaptureLines(session);
      const capture = await tmuxCore.capturePane(captureTarget, lines);
      if (parsed.intervalSeconds) {
        if (!params.screenMonitor) return appendTmuxCommandPreview('当前环境不支持 tmux 屏幕定时刷新。', [capture.command], markdown);
        const card = params.screenMonitor.card;
        const initialText = buildTmuxScreenResponse(captureTarget, capture.screen, lines, markdown, {
          intervalSeconds: parsed.intervalSeconds,
          monitorStarted: true,
          commands: card ? [] : [...ensured.commands, capture.command],
        });
        if (card) {
          if (params.screenMonitor.stopCallbackData) {
            card.actions?.(buildTmuxScreenStopActions(params.screenMonitor.stopCallbackData, false));
          }
          card.update(initialText, formatTmuxScreenCardStatus(captureTarget, lines, parsed.intervalSeconds));
        }
        startTmuxScreenMonitor({
          key: params.screenMonitor.key,
          target: captureTarget,
          lines,
          intervalSeconds: parsed.intervalSeconds,
          markdown,
          deliver: params.screenMonitor.deliver,
          stopCallbackData: params.screenMonitor.stopCallbackData,
          card,
        });
        if (card) return '';
      }
      return buildTmuxScreenResponse(captureTarget, capture.screen, lines, markdown, {
        intervalSeconds: parsed.intervalSeconds,
        monitorStarted: Boolean(parsed.intervalSeconds),
        commands: [...ensured.commands, capture.command],
      });
    }

    if (command === '/tmux-set') {
      const parsed = parseTmuxSetArgs(args);
      if (!parsed) {
        return buildCommandFields(
          'tmux 设置用法',
          [['命令', '`/tmux-set lines <0-500>` 或 `/tmux-set enter on|off`']],
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
      const exists = await tmuxCore.hasSession(name);
      if (!exists.exists) {
        return appendTmuxCommandPreview(
          `没有找到 tmux session：${name}。可先发送 \`/tmux-switch\` 查看，或 \`/tmux-new ${name}\` 新建。`,
          [exists.command],
          markdown,
        );
      }
      store.updateSession(session.id, { tmux_session_name: name });
      const lines = getCaptureLines(session);
      const capture = await tmuxCore.capturePane(name, lines);
      return buildTmuxAttachResponse(
        '已绑定 tmux session',
        [
          ['tmux session', name],
          ['Bridge session', binding.bridgeSessionId],
          ['展示行数', `${lines}`],
        ],
        capture.screen,
        lines,
        [exists.command, capture.command],
        markdown,
      );
    }

    if (command === '/tmux-new') {
      const requestedName = args.trim() || `cti-${binding.bridgeSessionId.slice(0, 8)}`;
      const name = validateTmuxSessionName(requestedName);
      if (!name) return '用法：/tmux-new [session]';
      const cwd = binding.workingDirectory || process.cwd();
      const ensured = await tmuxCore.ensureDetachedSession({ name, cwd });
      store.updateSession(session.id, { tmux_session_name: name });
      const lines = getCaptureLines(session);
      const capture = await tmuxCore.capturePane(name, lines);
      return buildTmuxAttachResponse(
        ensured.existed ? 'tmux session 已存在，已直接绑定' : '已新建并绑定 tmux session',
        [
          ['tmux session', name],
          ['目录', cwd],
          ['展示行数', `${lines}`],
        ],
        capture.screen,
        lines,
        [...ensured.commands, capture.command],
        markdown,
      );
    }

    if (command === '/tmux' || command === '/tmux-key') {
      if (!args.trim()) {
        return buildTmuxOverviewResponse(session, markdown);
      }
      const ensured = await ensureCodexTmuxSessionForProvider(params);
      const target = ensured.target || session.tmux_session_name;
      if (ensured.error) return ensured.error;
      if (!target) {
        return buildCommandFields(
          'tmux 未绑定',
          [],
          ['先发送 `/tmux-switch` 查看 session，或 `/tmux-attach <session>` / `/tmux-new <session>` 绑定。'],
          markdown,
        );
      }
      const keySequenceActions = command === '/tmux' ? parseTmuxKeySequence(args) : null;
      if (command === '/tmux' && !keySequenceActions && isPureSpecialKeySyntax(args)) {
        const invalid = parseTmuxSendActions(args);
        return buildCommandFields(
          'tmux 按键用法',
          [['错误', invalid.error || '特殊键序列不合法。']],
          ['`/tmux` 单独发送尖括号序列时只接受合法控制键，例如 `/tmux <C-c><Enter>`；普通文本请不要写成单独的尖括号 token。'],
          markdown,
        );
      }
      const parsed = command === '/tmux-key'
        ? parseTmuxSendActions(args)
        : { actions: keySequenceActions || [{ type: 'literal', text: args }] as TmuxSendAction[] };
      if (parsed.error) {
        return buildCommandFields(
          'tmux 按键用法',
          [['错误', parsed.error]],
          ['发送 `/tmux` 查看完整用法；普通尖括号文本请用 `/tmux ...`，特殊按键请用 `/tmux-key ...`。'],
          markdown,
        );
      }
      const actions = parsed.actions || [];
      const actionsToSend = command === '/tmux' && !keySequenceActions
        ? applyAutoEnter(actions, session)
        : actions;
      const sendResult = await tmuxCore.sendActions(target, actionsToSend, { delayMs: SEND_ACTION_DELAY_MS });
      await delay(CAPTURE_AFTER_SEND_DELAY_MS);
      const lines = getCaptureLines(session);
      const capture = await tmuxCore.capturePane(target, lines);
      return buildTmuxCaptureResponse(capture.screen, lines, [...ensured.commands, ...sendResult.commands, capture.command], markdown);
    }

    return `未知 tmux 命令：${command}`;
  } catch (error) {
    return formatTmuxError(error);
  }
}
