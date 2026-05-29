import fs from 'node:fs';
import path from 'node:path';
import { getOrCreateDraftSession } from '../../internal-sessions.js';
import { isCliOnlyCodexModel, readConfiguredCodexModel } from '../../codex-models.js';
import { loadConfig, saveConfig } from '../../config.js';
import { getBridgeStatus, getCurrentUiServerUrl, getUiServerStatus } from '../../service-manager.js';
import {
  buildHealthCommandResponse,
  buildHealthListResponse,
  buildCommandFields,
  buildDesktopThreadsCommandResponse,
  DEFAULT_DESKTOP_THREAD_LIST_LIMIT,
  formatCommandDateTime,
  formatCommandPath,
  formatHistoryRole,
  formatMirrorStatus,
  formatRuntimeStatus,
  formatStoredMessageContent,
  formatReasoningEffort,
  getSessionDisplayName,
  MAX_DESKTOP_THREAD_LIST_LIMIT,
  normalizeReasoningEffort,
  parseDesktopThreadListArgs,
  resolveCommandAlias,
  toUserVisibleBindingError,
  truncateHistoryContent,
} from './command-helpers.js';
import { getBridgeContext } from './context.js';
import { deliverBridgeNotice, deliverResponse } from './feedback-delivery.js';
import * as broker from './permission-broker.js';
import * as router from './channel-router.js';
import type { BaseChannelAdapter, StructuredStreamingUiActionButton } from './channel-adapter.js';
import type { BridgeSession, BridgeStore } from './host.js';
import type { ChannelBinding, InboundMessage, OutboundAttachment, OutboundRichCard } from './types.js';
import { recordBindingChange, type BindingChangeAction } from './binding-audit.js';
import { isDangerousInput, parseMode, sanitizeInput, validateSessionId } from './security/validators.js';
import { parseSandboxMode } from '../../runtime-options.js';
import {
  ensureWorkingDirectoryExists,
  formatDisplayedModel,
  getAvailableModelChoicesText,
  getDesktopSessionByThreadIdSafe,
  getDisplayedDesktopThreads,
  getHistoryMessageLimit,
  getSelectableCodexModel,
  resetDraftSession,
  resolveDisplayedModel,
  resolveEffectiveNetworkAccess,
  resolveEffectiveReasoningEffort,
  resolveEffectiveSandboxMode,
  resolveNewSessionWorkingDirectory,
} from './bridge-session-support.js';
import {
  getFeedbackParseMode,
} from './bridge-channel-runtime.js';
import { readDesktopSessionMessagesByFilePath, type DesktopSessionSummary } from '../../desktop-sessions.js';
import { getCodexThreadId, getExplicitDesktopThreadId } from './turns/turn-classifier.js';
import { buildFencedCodeBlock } from './markdown/fence.js';
import { ThreadDisplayService } from './thread-display-resolver.js';
import { persistAndPinLatestThreadTableMessage } from './thread-table-message-pins.js';
import {
  codexTmuxSessionName,
  handleTmuxBridgeCommand,
  sendTmuxInterrupt,
  startCodexResumeTmuxSession,
} from './tmux-command.js';
import {
  finalizeStreamFeedback,
  pushStreamFeedbackActions,
  pushStreamFeedbackStatus,
  pushStreamFeedbackText,
  type StreamFeedbackTarget,
} from './stream-feedback-controller.js';
import {
  listBindingsForChat,
  setActiveBindingForChat,
} from '../../session-bindings.js';
import type { ThreadCardScope } from './command-formatters.js';

const MODE_OPTIONS_TEXT = '可选：`normal`（普通执行，默认） `yolo`（跳过审批和沙箱）。兼容：`code` 等同于 `normal`。';
const CODEX_PROVIDER_OPTIONS_TEXT = '可选：`sdk`（默认 SDK 路径） `tmux`（Codex TUI/tmux 路径）';
const REASONING_OPTIONS_TEXT = '可选：`1=minimal` `2=low` `3=medium` `4=high` `5=xhigh`';
const SANDBOX_OPTIONS_TEXT = '可选：`read-only` `workspace-write` `danger-full-access` `default`（回到全局默认）';
const NETWORK_OPTIONS_TEXT = '可选：`on`/`true` 开启网络，`off`/`false` 关闭网络，`default` 回到全局默认。';
const UI_DETAIL_OPTIONS_TEXT = '可选：`on` 显示 SDK 工具输入输出，`off` 只显示工具名和状态、正文更接近 mirror；兼容 `/ui detail on|off`。';
const TMUX_SCREEN_STOP_CALLBACK_PREFIX = 'tmux-screen:stop:';
const RUNNING_HEALTH_STATUSES = new Set([
  'running_active',
  'waiting_tool',
  'slow_observed',
  'suspected_stall',
  'suspected_stream_ui_stall',
  'suspected_detached',
]);

function sessionLooksRunning(session: BridgeSession | null | undefined): boolean {
  return session?.runtime_status === 'running'
    || session?.runtime_status === 'queued'
    || RUNNING_HEALTH_STATUSES.has(session?.health_status || '');
}

function shouldMapStopToTmuxInterrupt(session: BridgeSession | null | undefined): session is BridgeSession & { tmux_session_name: string } {
  return session?.codex_provider === 'tmux'
    && Boolean(session.tmux_session_name)
    && session.mirror_status === 'watching'
    && sessionLooksRunning(session);
}

function parseHistoryLimitArg(raw: string): number | null {
  const token = raw.trim();
  if (!/^\d+$/.test(token)) return null;
  const parsed = Number(token);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) return null;
  return parsed;
}

function parseUiDetailArg(raw: string): boolean | null {
  const token = raw.trim().toLowerCase();
  if (!token) return null;
  if (token === 'on' || token === 'true' || token === '1' || token === 'yes' || token === 'detail' || token === 'details' || token === 'verbose') {
    return true;
  }
  if (token === 'off' || token === 'false' || token === '0' || token === 'no' || token === 'compact' || token === 'brief') {
    return false;
  }
  return null;
}

function formatUiDetailMode(enabled: boolean): string {
  return enabled ? '显示工具输入输出' : '只显示工具名、状态和正文';
}

function formatGlobalRunning(running: boolean): string {
  return running ? 'running' : 'stopped';
}

function formatPid(pid: number | undefined): string {
  return Number.isFinite(pid) && (pid as number) > 0 ? String(pid) : '-';
}

export function buildGlobalStatusResponse(
  store: BridgeStore,
  currentBinding: ChannelBinding | null,
  markdown: boolean,
): string {
  const config = loadConfig();
  const bridgeStatus = getBridgeStatus();
  const uiStatus = getUiServerStatus();
  const bindings = store.listChannelBindings();
  const activeBindings = bindings.filter((binding) => binding.active !== false);
  const sessions = store.listSessions();
  const runningSessions = sessions.filter((session) => session.runtime_status === 'running' || session.runtime_status === 'queued');
  const adapters = bridgeStatus.adapters || [];
  const enabledChannels = (config.channels || []).filter((channel) => channel.enabled !== false);
  const uiUrl = getCurrentUiServerUrl();
  const currentChatBindingCount = currentBinding
    ? bindings.filter((binding) => binding.channelType === currentBinding.channelType && binding.chatId === currentBinding.chatId).length
    : 0;

  const channelLines = (config.channels || []).map((channel) => {
    const adapter = adapters.find((item) => item.channelType === channel.id);
    return [
      channel.id,
      `alias=${channel.alias || '-'}`,
      `provider=${channel.provider}`,
      `enabled=${channel.enabled !== false ? 'yes' : 'no'}`,
      `adapter=${adapter ? formatGlobalRunning(adapter.running) : 'missing'}`,
      adapter?.error ? `error=${adapter.error}` : '',
    ].filter(Boolean).join('  ');
  });
  const bindingLines = activeBindings.map((binding) => {
    const session = store.getSession(binding.codepilotSessionId);
    return [
      binding.channelType,
      binding.channelAlias ? `alias=${binding.channelAlias}` : '',
      binding.chatDisplayName ? `chat=${binding.chatDisplayName}` : `chat=${binding.chatId}`,
      `session=${binding.codepilotSessionId.slice(0, 8)}`,
      session?.runtime_status ? `runtime=${session.runtime_status}` : '',
    ].filter(Boolean).join('  ');
  });

  const main = buildCommandFields(
    '全局状态',
    [
      ['Bridge', formatGlobalRunning(bridgeStatus.running)],
      ['Bridge PID', formatPid(bridgeStatus.pid)],
      ['Bridge Run ID', bridgeStatus.runId || '-'],
      ['Bridge 启动时间', formatCommandDateTime(bridgeStatus.startedAt)],
      ['Bridge 上次退出', bridgeStatus.lastExitReason || '-'],
      ['UI Server', formatGlobalRunning(uiStatus.running)],
      ['UI PID', formatPid(uiStatus.pid)],
      ['UI 地址', uiUrl || '-'],
      ['通道', `${enabledChannels.length}/${(config.channels || []).length} enabled`],
      ['Adapter', `${adapters.filter((adapter) => adapter.running).length}/${adapters.length} running`],
      ['绑定', `${activeBindings.length}/${bindings.length} active`],
      ['会话', `${sessions.length} total, ${runningSessions.length} running/queued`],
      ['当前聊天绑定', currentBinding ? `${currentBinding.channelType}:${currentBinding.chatId} -> ${currentBinding.codepilotSessionId.slice(0, 8)} (${currentChatBindingCount} bound, active=${currentBinding.id.slice(0, 8)})` : '未绑定'],
    ],
    [
      '发送 `/` 查看当前聊天/当前会话诊断；发送 `/check` 查看当前会话健康检查。',
    ],
    markdown,
  );

  const sections: string[] = [main];
  if (channelLines.length > 0) {
    sections.push([
      markdown ? '**通道明细**' : '通道明细',
      '',
      markdown ? buildFencedCodeBlock(channelLines.join('\n'), 'text') : channelLines.join('\n'),
    ].join('\n').trim());
  }
  if (bindingLines.length > 0) {
    sections.push([
      markdown ? '**绑定明细**' : '绑定明细',
      '',
      markdown ? buildFencedCodeBlock(bindingLines.join('\n'), 'text') : bindingLines.join('\n'),
    ].join('\n').trim());
  }
  return sections.join('\n\n');
}

function parseUiArgs(raw: string): { action: 'show' } | { action: 'set-details'; enabled: boolean } | null {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { action: 'show' };

  // Compatibility for the short-lived /tools on|off command: /tools resolves
  // here with only the on/off token as args.
  if (parts.length === 1) {
    const direct = parseUiDetailArg(parts[0]);
    if (direct !== null) return { action: 'set-details', enabled: direct };
  }

  const topic = parts[0]?.toLowerCase();
  if (
    topic === 'detail'
    || topic === 'details'
    || topic === 'tool'
    || topic === 'tools'
    || topic === 'sdk'
  ) {
    const enabled = parseUiDetailArg(parts.slice(1).join(' '));
    return enabled === null ? null : { action: 'set-details', enabled };
  }

  return null;
}

function resolveHistorySessionFile(
  session: BridgeSession | null,
  binding: ChannelBinding,
): { filePath: string; fileName: string; threadId: string; title: string | null } | null {
  const candidates = [
    getExplicitDesktopThreadId(session),
    getCodexThreadId(session, binding),
  ].filter((value): value is string => !!value?.trim());
  const uniqueThreadIds = Array.from(new Set(candidates));

  for (const threadId of uniqueThreadIds) {
    const desktopSession = getDesktopSessionByThreadIdSafe(threadId, 'history lookup');
    if (!desktopSession?.filePath) continue;
    try {
      const stat = fs.statSync(desktopSession.filePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    return {
      filePath: desktopSession.filePath,
      fileName: path.basename(desktopSession.filePath),
      threadId,
      title: desktopSession.title || null,
    };
  }

  return null;
}

function buildHistoryMessagesCard(
  messages: Array<{ role: string; content: string }>,
  options: {
    title: string;
    source: string;
    limit: number;
    markdown: boolean;
  },
): string {
  const header = buildCommandFields(
    '最近对话（msg）',
    [
      ['标题', options.title],
      ['来源', options.source],
      ['返回条数', `${messages.length} / 配置 ${options.limit}`],
    ],
    ['`/his raw` 查看解析后的纯文本视图；`/his json` 直接发送原始 session JSONL 文件；`/his limit 12` 修改返回条数。'],
    options.markdown,
  );

  const body = messages.map((message, index) => {
    const role = formatHistoryRole(message.role);
    const content = truncateHistoryContent(formatStoredMessageContent(message.content));
    if (options.markdown) {
      return `### ${index + 1}. ${role}\n\n${buildFencedCodeBlock(content, 'text')}`;
    }
    return `${index + 1}. ${role}\n${content}`;
  }).join('\n\n');

  return [header, body].join('\n\n').trim();
}

function parseForceFlag(args: string): { args: string; force: boolean } {
  const forcePattern = /(^|\s)--force(?=\s|$)/;
  const force = forcePattern.test(args);
  const cleaned = args.replace(/(^|\s)--force(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  return { args: cleaned, force };
}

function parseNetworkAccessArg(raw: string): boolean | 'default' | null {
  const token = raw.trim().toLowerCase();
  if (!token) return null;
  if (token === 'default' || token === 'reset') return 'default';
  if (token === 'on' || token === 'true' || token === '1' || token === 'yes' || token === 'enable' || token === 'enabled') {
    return true;
  }
  if (token === 'off' || token === 'false' || token === '0' || token === 'no' || token === 'disable' || token === 'disabled') {
    return false;
  }
  return null;
}

function formatNetworkAccess(enabled: boolean): string {
  return enabled ? 'enabled' : 'disabled';
}

function parseCodexProviderArg(raw: string): 'sdk' | 'tmux' | null {
  const token = raw.trim().toLowerCase();
  if (token === 'sdk' || token === 'tmux') return token;
  return null;
}

function formatSessionMode(binding: ChannelBinding | null | undefined, session?: BridgeSession | null): string {
  return parseMode(binding?.mode || session?.preferred_mode || '') || 'normal';
}

function formatSessionCodexProvider(session?: BridgeSession | null): string {
  return session?.codex_provider || 'default';
}

function isTmuxProviderSession(session?: BridgeSession | null): boolean {
  return session?.codex_provider === 'tmux';
}

function buildTmuxProviderModeBlockedResponse(markdown: boolean): string {
  return buildCommandFields(
    '当前是 tmux Provider',
    [],
    [
      '`/mode` 无法影响已经启动的 Codex TUI 终端。',
      '如需切换 yolo，请先发送 `/provider sdk` 退出 tmux Provider，再发送 `/m yolo`，然后重新发送 `/provider tmux`。',
    ],
    markdown,
  );
}

function buildTmuxProviderRuntimeOptionBlockedResponse(commandLabel: string, markdown: boolean): string {
  return buildCommandFields(
    '当前是 tmux Provider',
    [['命令', commandLabel]],
    [
      '这个设置无法影响已经启动的 Codex TUI 终端。',
      '请在 Codex TUI 里使用内置 slash 命令调整，或发送 `/provider sdk` 退出后重新配置再进入 tmux Provider。',
    ],
    markdown,
  );
}

function buildActiveTaskSwitchBlockedResponse(
  store: ReturnType<typeof getBridgeContext>['store'],
  binding: ChannelBinding,
  markdown: boolean,
): string {
  const threadDisplay = new ThreadDisplayService(store);
  return buildCommandFields(
    '当前会话仍在运行',
    [
      ['标题', threadDisplay.binding(binding).title],
      ['Session', binding.codepilotSessionId],
    ],
    [
      '为避免旧任务完成后把回复发到已经切走的聊天，当前不直接切换绑定。',
      '请先发送 `/stop` 停止当前任务；如果确认要强制切换，请在原命令末尾加 `--force`。',
    ],
    markdown,
  );
}

function guardBindingChangeWhileRunning(
  store: ReturnType<typeof getBridgeContext>['store'],
  binding: ChannelBinding | null,
  force: boolean,
  deps: BridgeCommandDispatchDeps,
  markdown: boolean,
): string | null {
  if (!binding || force) return null;
  return deps.getActiveTask(binding.codepilotSessionId)
    ? buildActiveTaskSwitchBlockedResponse(store, binding, markdown)
    : null;
}

function isReservedThreadName(name: string): boolean {
  const trimmed = name.trim();
  return /^\d+$/.test(trimmed)
    || /^[0-9a-f]{8,}$/i.test(trimmed)
    || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
}

function validateThreadName(raw: string): { ok: true; name: string } | { ok: false; message: string } {
  const name = raw.trim();
  if (!name) return { ok: false, message: '用法：/t rename <新名称>。' };
  if (name.length > 80) return { ok: false, message: '名称过长，请控制在 80 个字符以内。' };
  if (/[\x00-\x1f\x7f]/.test(name)) return { ok: false, message: '名称不能包含控制字符。' };
  if (isReservedThreadName(name)) {
    return { ok: false, message: '名称不能是纯数字，也不能长得像 binding id 或 thread id。' };
  }
  return { ok: true, name };
}

function selectDesktopThreadForCommand(
  threadDisplay: ThreadDisplayService,
  raw: string,
  displayedThreads: DesktopSessionSummary[],
): {
  thread?: DesktopSessionSummary;
  threadId?: string;
  ambiguous?: boolean;
  index?: number;
} {
  const selected = threadDisplay.selectDesktopThread(raw, displayedThreads);
  if (selected.threadId || selected.ambiguous || selected.index !== undefined) {
    return selected;
  }
  const token = raw.trim();
  if (!validateSessionId(token)) return {};
  const desktop = getDesktopSessionByThreadIdSafe(token, 'thread bind');
  return {
    thread: desktop ? { ...desktop, title: threadDisplay.desktop(desktop).title } : undefined,
    threadId: token,
  };
}

function auditCommandBindingChange(
  action: BindingChangeAction,
  msg: InboundMessage,
  fromBinding: ChannelBinding | null | undefined,
  toBinding: ChannelBinding | null | undefined,
  reason?: string,
): void {
  recordBindingChange(getBridgeContext().store, {
    action,
    address: msg.address,
    fromBinding,
    toBinding,
    messageId: msg.messageId,
    source: 'im_command',
    reason,
  });
}

export interface BridgeCommandDispatchDeps {
  getActiveTask(sessionId: string): { abortController: AbortController } | undefined;
  forceStopSession?(sessionId: string, detail?: string): Promise<boolean>;
  recordInteractiveHealthEnd?(sessionId: string, outcome: 'completed' | 'failed' | 'aborted', detail?: string): void;
  reconcileMirrorSubscriptions?(): Promise<void>;
  diagnoseSessionHealth(sessionId: string): Promise<import('./session-health-runtime.js').SessionHealthDiagnosis | null>;
  diagnoseAllActiveSessions(): Promise<import('./session-health-runtime.js').SessionHealthDiagnosis[]>;
  scopedBinding?: ChannelBinding | null;
  threadCardRefreshScope?: ThreadCardScope | null;
  threadCardSelectedId?: string | null;
}

function buildThreadCardRefresh(
  threadDisplay: ThreadDisplayService,
  scope: ThreadCardScope | null | undefined,
  address: InboundMessage['address'],
  selectedId?: string | null,
): OutboundRichCard | undefined {
  if (scope === 'bound') {
    return threadDisplay.refreshedBoundThreadsCard(address.channelType, address.chatId, selectedId);
  }
  if (scope === 'global') {
    return threadDisplay.refreshedDesktopThreadsCard(
      getDisplayedDesktopThreads(DEFAULT_DESKTOP_THREAD_LIST_LIMIT),
      false,
      DEFAULT_DESKTOP_THREAD_LIST_LIMIT,
      address.channelType,
      address.chatId,
      selectedId,
    );
  }
  return undefined;
}

async function reconcileMirrorSubscriptionsBestEffort(deps: BridgeCommandDispatchDeps, context: string): Promise<void> {
  if (!deps.reconcileMirrorSubscriptions) return;
  try {
    await deps.reconcileMirrorSubscriptions();
  } catch (error) {
    console.error(`[command-dispatch] Mirror reconcile failed during ${context}:`, error);
  }
}

export async function handleBridgeCommand(
  adapter: BaseChannelAdapter,
  msg: InboundMessage,
  text: string,
  deps: BridgeCommandDispatchDeps,
): Promise<void> {
  const { store } = getBridgeContext();
  const threadDisplay = new ThreadDisplayService(store);

  const trimmedText = text.trim();
  const commandToken = trimmedText.split(/\s+/)[0] || '';
  const rawCommand = commandToken.split('@')[0].toLowerCase();
  const args = trimmedText.slice(commandToken.length).trim();
  const command = resolveCommandAlias(rawCommand, args);

  const isTmuxKeystrokeCommand = command === '/tmux'
    || command === '/tmux-switch'
    || command === '/tmux-attach'
    || command === '/tmux-new'
    || command === '/tmux-status'
    || command === '/tmux-screen'
    || command === '/tmux-set';
  const dangerCheck = isTmuxKeystrokeCommand
    ? { dangerous: text.includes('\0') || text.length > 64_000, reason: text.includes('\0') ? 'null byte detected' : 'excessively long input' }
    : isDangerousInput(text);
  if (dangerCheck.dangerous) {
    store.insertAuditLog({
      channelType: adapter.channelType,
      chatId: msg.address.chatId,
      direction: 'inbound',
      messageId: msg.messageId,
      summary: `[BLOCKED] Dangerous input detected: ${dangerCheck.reason}`,
    });
    console.warn(`[bridge-manager] Blocked dangerous command input from chat ${msg.address.chatId}: ${dangerCheck.reason}`);
    await deliverBridgeNotice(adapter, msg.address, '命令被拒绝：检测到无效输入。', {
      replyToMessageId: msg.messageId,
    });
    return;
  }

  let response = '';
  let responseRichCard: OutboundRichCard | undefined;
  let responseParseMode: 'Markdown' | 'plain' = getFeedbackParseMode(adapter.channelType);
  let auditResponse = true;
  let threadTableCardScope: ThreadCardScope | undefined;
  const currentBinding = deps.scopedBinding || store.getChannelBinding(msg.address.channelType, msg.address.chatId);
  const shouldApplyDefaultTargetForCommand = !new Set(['/status', '/threads', '/t']).has(command);
  const commandBinding = !shouldApplyDefaultTargetForCommand
    ? currentBinding
    : currentBinding || (store.getChannelDefaultTarget(msg.address.channelType) ? router.resolve(msg.address) : null);

  switch (command) {
    case '/start':
      response = [
        'Codex to IM',
        '',
        '直接发送文本，就会继续当前聊天绑定的会话。',
        '',
        '常用流程',
        '1. /t 查看最近桌面会话',
        '2. /t 1 接管第 1 条桌面会话并设为当前线程',
        '3. /t add 2 可把更多桌面会话加入当前聊天',
        '4. /t ls 查看绑定，/t use 1 切换当前线程',
        '',
        '发送 /h 查看完整说明。',
      ].join('\n');
      break;

    case '/new': {
      const parsedArgs = parseForceFlag(args);
      const blocked = guardBindingChangeWhileRunning(
        store,
        commandBinding,
        parsedArgs.force,
        deps,
        responseParseMode === 'Markdown',
      );
      if (blocked) {
        response = blocked;
        break;
      }
      const currentSession = commandBinding
        ? store.getSession(commandBinding.codepilotSessionId)
        : null;
      const resolved = resolveNewSessionWorkingDirectory(parsedArgs.args, commandBinding, currentSession);
      if (!resolved.ok) {
        response = resolved.message;
        break;
      }

      const workDir = resolved.workDir;
      ensureWorkingDirectoryExists(workDir);
      const binding = router.createBinding(msg.address, workDir);
      const session = store.getSession(binding.codepilotSessionId);
      auditCommandBindingChange(
        'new_session',
        msg,
        commandBinding,
        binding,
        parsedArgs.force ? 'forced' : undefined,
      );
      const notes = [
        parsedArgs.args.trim() ? '接下来直接发送文本即可继续。' : '已在当前工作目录下新建一个线程。接下来直接发送文本即可继续。',
        ...(parsedArgs.force
          ? ['如果当前聊天里已有旧任务在运行，它不会被终止，仍会在后台继续执行并可能稍后回消息。']
          : []),
        '这是 IM 侧线程，当前只保证在 IM 中可继续；不会自动出现在 Codex Desktop 会话列表中。',
      ];
      response = buildCommandFields(
        '已新建会话',
        [
          ['标题', threadDisplay.binding(binding).title],
          ['目录', formatCommandPath(binding.workingDirectory)],
          ['模式', formatSessionMode(binding, session)],
          ['Provider', formatSessionCodexProvider(session)],
        ],
        notes,
        responseParseMode === 'Markdown',
      );
      break;
    }

    case '/t': {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const rawSubcommand = (parts[0] || '').toLowerCase();
      const subcommand = rawSubcommand === 'remove' ? 'rm' : rawSubcommand;
      const subArgs = parts.slice(1).join(' ');

      if (subcommand === 'ls') {
        response = threadDisplay.chatBindingsResponse(msg.address.channelType, msg.address.chatId, responseParseMode === 'Markdown');
        responseRichCard = threadDisplay.refreshedBoundThreadsCard(msg.address.channelType, msg.address.chatId);
        if (listBindingsForChat(store, msg.address.channelType, msg.address.chatId).length > 0) {
          threadTableCardScope = 'bound';
        }
        break;
      }

      if (subcommand === 'add') {
        const targetToken = subArgs.trim();
        if (!targetToken) {
          response = '用法：/t add <序号|thread-id|名称>。发送 `/t` 查看最近桌面会话，或发送 `/t ls` 查看已绑定线程。';
          break;
        }
        const displayedThreads = getDisplayedDesktopThreads(DEFAULT_DESKTOP_THREAD_LIST_LIMIT);
        if (!displayedThreads) {
          response = '读取桌面会话列表失败，请稍后重试。';
          break;
        }
        const decoratedThreads = threadDisplay.decorateDesktopSessions(displayedThreads, msg.address.channelType, msg.address.chatId);
        const selected = selectDesktopThreadForCommand(threadDisplay, targetToken, decoratedThreads);
        if (selected.ambiguous) {
          response = '匹配到多个桌面会话，请先发送 `/t` 查看列表，再用 `/t add 1` 这种序号添加。';
          break;
        }
        if (!selected.threadId) {
          if (selected.index !== undefined) {
            response = `最近桌面会话列表没有第 ${selected.index} 条。先发送 \`/t\` 查看最近会话，或直接使用 thread id。`;
            break;
          }
          response = '没有找到对应的桌面会话。先发送 `/t` 查看最近会话，再用 `/t add 1` 添加。';
          break;
        }

        const previousActive = store.getChannelBinding(msg.address.channelType, msg.address.chatId);
        let binding: ReturnType<typeof router.bindToSdkSession>;
        try {
          binding = router.bindToSdkSession(msg.address, selected.threadId, selected.thread ? {
            workingDirectory: selected.thread.cwd,
            displayName: selected.thread.title,
            active: previousActive ? false : true,
          } : {
            active: previousActive ? false : true,
          });
        } catch (error) {
          response = toUserVisibleBindingError(error, '添加桌面会话失败。');
          break;
        }
        const updatedBinding = store.listChannelBindings().find((item) => item.id === binding.id) || binding;
        auditCommandBindingChange(
          'add_desktop',
          msg,
          previousActive,
          updatedBinding,
          previousActive ? 'added inactive' : 'added active',
        );
        response = buildCommandFields(
          updatedBinding.active !== false ? '已添加并激活线程' : '已添加绑定线程',
          [
            ['线程', threadDisplay.binding(updatedBinding).title],
            ['binding_id', threadDisplay.bindingShortId(updatedBinding)],
            ['thread_id', threadDisplay.bindingThreadId(updatedBinding) || '-'],
          ],
          updatedBinding.active !== false
            ? ['接下来直接发送文本即可继续。']
            : ['当前线程未改变。需要切换时发送 `/t use <序号|thread-id|binding-id|名称>`。'],
          responseParseMode === 'Markdown',
        );
        responseRichCard = buildThreadCardRefresh(threadDisplay, deps.threadCardRefreshScope, msg.address, deps.threadCardSelectedId);
        if (responseRichCard && deps.threadCardRefreshScope) threadTableCardScope = deps.threadCardRefreshScope;
        break;
      }

      if (subcommand === 'use') {
        const targetToken = subArgs.trim();
        if (!targetToken) {
          response = '用法：/t use <序号|thread-id|binding-id|名称>。发送 `/t ls` 查看已绑定线程。';
          break;
        }
        const bindings = listBindingsForChat(store, msg.address.channelType, msg.address.chatId);
        const selected = threadDisplay.resolveBoundBindingSelection(bindings, targetToken);
        if (selected.ambiguous) {
          response = '匹配到多个绑定线程，请先发送 `/t ls` 查看列表，再用序号切换。';
          break;
        }
        if (!selected.binding) {
          response = selected.index !== undefined
            ? `当前聊天只有 ${bindings.length} 个绑定线程，没有第 ${selected.index} 个。发送 \`/t ls\` 查看列表。`
            : '没有找到对应的绑定线程。发送 `/t ls` 查看列表。';
          break;
        }
        const previousActive = store.getChannelBinding(msg.address.channelType, msg.address.chatId);
        const updatedBinding = setActiveBindingForChat(store, selected.binding.id);
        auditCommandBindingChange(
          'use_binding',
          msg,
          previousActive,
          updatedBinding,
        );
        response = buildCommandFields(
          '当前线程已切换',
          [
            ...(previousActive && previousActive.id !== updatedBinding.id
              ? [['原线程', threadDisplay.binding(previousActive).title] as [string, string]]
              : []),
            ['当前', threadDisplay.binding(updatedBinding).title],
            ['binding_id', threadDisplay.bindingShortId(updatedBinding)],
            ['thread_id', threadDisplay.bindingThreadId(updatedBinding) || '-'],
          ],
          ['接下来直接发送文本即可继续。'],
          responseParseMode === 'Markdown',
        );
        responseRichCard = buildThreadCardRefresh(threadDisplay, deps.threadCardRefreshScope, msg.address, deps.threadCardSelectedId);
        if (responseRichCard && deps.threadCardRefreshScope) threadTableCardScope = deps.threadCardRefreshScope;
        break;
      }

      if (subcommand === 'rm') {
        const parsedArgs = parseForceFlag(subArgs);
        const targetToken = parsedArgs.args;
        if (!targetToken) {
          response = '用法：/t rm <序号|thread-id|binding-id|名称>。发送 `/t ls` 查看已绑定线程。';
          break;
        }
        const bindings = listBindingsForChat(store, msg.address.channelType, msg.address.chatId);
        const selected = threadDisplay.resolveBoundBindingSelection(bindings, targetToken);
        if (selected.ambiguous) {
          response = '匹配到多个绑定线程，请先发送 `/t ls` 查看列表，再用序号移除。';
          break;
        }
        if (!selected.binding) {
          response = selected.index !== undefined
            ? `当前聊天只有 ${bindings.length} 个绑定线程，没有第 ${selected.index} 个。发送 \`/t ls\` 查看列表。`
            : '没有找到对应的绑定线程。发送 `/t ls` 查看列表。';
          break;
        }
        const blocked = guardBindingChangeWhileRunning(
          store,
          selected.binding,
          parsedArgs.force,
          deps,
          responseParseMode === 'Markdown',
        );
        if (blocked) {
          response = blocked;
          break;
        }
        const previousActive = store.getChannelBinding(msg.address.channelType, msg.address.chatId);
        store.deleteChannelBinding(selected.binding.id);
        const nextActive = store.getChannelBinding(msg.address.channelType, msg.address.chatId);
        auditCommandBindingChange(
          'remove_binding',
          msg,
          selected.binding,
          nextActive,
          parsedArgs.force ? 'forced' : undefined,
        );
        response = buildCommandFields(
          '已移除绑定线程',
          [
            ['移除', threadDisplay.binding(selected.binding).title],
            ['当前', nextActive ? threadDisplay.binding(nextActive).title : '未绑定'],
          ],
          nextActive
            ? ['已自动将另一个绑定线程设为当前。']
            : ['当前聊天已没有绑定线程。之后直接发送文本会自动进入新的临时草稿线程。'],
          responseParseMode === 'Markdown',
        );
        await reconcileMirrorSubscriptionsBestEffort(deps, 'binding remove');
        responseRichCard = buildThreadCardRefresh(threadDisplay, deps.threadCardRefreshScope, msg.address, deps.threadCardSelectedId);
        if (responseRichCard && deps.threadCardRefreshScope) threadTableCardScope = deps.threadCardRefreshScope;
        break;
      }

      if (subcommand === 'rename') {
        const binding = store.getChannelBinding(msg.address.channelType, msg.address.chatId);
        if (!binding) {
          response = '当前聊天还没有绑定线程，无法重命名。';
          break;
        }
        const parsed = validateThreadName(subArgs);
        if (!parsed.ok) {
          response = parsed.message;
          break;
        }
        const session = store.getSession(binding.codepilotSessionId);
        if (!session) {
          response = '当前会话不存在，无法重命名。';
          break;
        }
        threadDisplay.renameBinding(binding, parsed.name);
        response = buildCommandFields(
          '当前线程已重命名',
          [
            ['新标题', parsed.name],
            ['binding_id', threadDisplay.bindingShortId(binding)],
            ['thread_id', threadDisplay.bindingThreadId(binding) || '-'],
          ],
          [],
          responseParseMode === 'Markdown',
        );
        break;
      }

      response = '用法：/t、/t ls、/t add <序号|thread-id|名称>、/t use <序号|thread-id|binding-id|名称>、/t rm/remove <序号|thread-id|binding-id|名称>、/t rename <名称>';
      break;
    }

    case '/thread': {
      const parsedArgs = parseForceFlag(args);
      const threadArgs = parsedArgs.args;
      if (threadArgs === '0' || threadArgs === '0 reset') {
        const blocked = guardBindingChangeWhileRunning(
          store,
          commandBinding,
          parsedArgs.force,
          deps,
          responseParseMode === 'Markdown',
        );
        if (blocked) {
          response = blocked;
          break;
        }
        const draftSession = threadArgs === '0 reset'
          ? resetDraftSession(msg.address)
          : getOrCreateDraftSession(store, msg.address);
        const binding = router.bindToSession(msg.address, draftSession.id);
        if (!binding) {
          response = '草稿线程切换失败。';
          break;
        }
        router.updateBinding(binding.id, {
          mode: 'normal',
          workingDirectory: draftSession.working_directory,
          model: draftSession.model || binding.model,
        });
        const updatedBinding = store.getChannelBinding(msg.address.channelType, msg.address.chatId) || binding;
        auditCommandBindingChange(
          'switch_draft',
          msg,
          commandBinding,
          updatedBinding,
          [
            threadArgs === '0 reset' ? 'reset' : null,
            parsedArgs.force ? 'forced' : null,
          ].filter(Boolean).join(', ') || undefined,
        );
        response = buildCommandFields(
          threadArgs === '0 reset' ? '已重置临时草稿线程' : '已切换到临时草稿线程',
          [
            ['标题', getSessionDisplayName(draftSession, draftSession.working_directory)],
            ['目录', formatCommandPath(draftSession.working_directory)],
            ['过期时间', formatCommandDateTime(draftSession.expires_at)],
            ['模式', 'normal'],
          ],
          ['这是隐藏的草稿线程，不会出现在常规会话列表中。'],
          responseParseMode === 'Markdown',
        );
        break;
      }

      if (!threadArgs) {
        response = `用法：/thread <序号>，或 /thread 0 进入临时草稿线程；发送 /t all 查看最多 ${MAX_DESKTOP_THREAD_LIST_LIMIT} 条，或 /t n 100 查看最近 100 条桌面会话`;
        break;
      }
      if (threadArgs === 'all') {
        const desktopSessions = getDisplayedDesktopThreads(MAX_DESKTOP_THREAD_LIST_LIMIT);
        if (!desktopSessions) {
          response = '读取桌面会话列表失败，请稍后重试。';
          break;
        }
        if (desktopSessions.length === 0) {
          response = '没有找到桌面会话。先在 Codex Desktop App 中打开一个会话，再回来试一次。';
          break;
        }
        const decoratedSessions = threadDisplay.decorateDesktopSessions(desktopSessions, msg.address.channelType, msg.address.chatId);
        response = buildDesktopThreadsCommandResponse(
          decoratedSessions,
          responseParseMode === 'Markdown',
          true,
          MAX_DESKTOP_THREAD_LIST_LIMIT,
          threadDisplay.desktopBindingStates(msg.address.channelType, msg.address.chatId),
        );
        responseRichCard = threadDisplay.refreshedDesktopThreadsCard(
          decoratedSessions,
          true,
          MAX_DESKTOP_THREAD_LIST_LIMIT,
          msg.address.channelType,
          msg.address.chatId,
        );
        threadTableCardScope = 'global';
        break;
      }

      const blocked = guardBindingChangeWhileRunning(
        store,
        commandBinding,
        parsedArgs.force,
        deps,
        responseParseMode === 'Markdown',
      );
      if (blocked) {
        response = blocked;
        break;
      }

      const displayedThreads = getDisplayedDesktopThreads(MAX_DESKTOP_THREAD_LIST_LIMIT);
      if (!displayedThreads) {
        response = '读取桌面会话列表失败，请稍后重试。';
        break;
      }
      const decoratedThreads = threadDisplay.decorateDesktopSessions(displayedThreads, msg.address.channelType, msg.address.chatId);
      const selected = selectDesktopThreadForCommand(threadDisplay, threadArgs, decoratedThreads);
      if (selected.ambiguous) {
        response = '匹配到多个桌面会话，请先发送 `/t` 查看列表，再用 `/t 1` 这种序号切换。';
        break;
      }
      if (!selected.threadId) {
        if (selected.index !== undefined) {
          response = displayedThreads.length > 0
            ? `当前只找到 ${displayedThreads.length} 条桌面会话，没有第 ${selected.index} 条。先发送 \`/t\` 查看最近会话，或发送 \`/t all\` 查看更多后再选择。`
            : '没有找到桌面会话。先在 Codex Desktop App 中打开一个会话，再回来试一次。';
          break;
        }
        response = '没有找到对应的桌面会话。先发送 `/t` 查看最近会话，再用 `/t 1` 接管。';
        break;
      }
      if (!selected.thread) {
        let binding: ReturnType<typeof router.bindToSdkSession>;
        try {
          binding = router.bindToSdkSession(msg.address, selected.threadId);
        } catch (error) {
          response = toUserVisibleBindingError(error, '切换桌面会话失败。');
          break;
        }
        auditCommandBindingChange(
          'switch_desktop',
          msg,
          currentBinding,
          binding,
          parsedArgs.force ? 'forced' : undefined,
        );
        const session = store.getSession(binding.codepilotSessionId);
        response = buildCommandFields(
          '已切换到桌面会话',
          [
            ['标题', threadDisplay.binding(binding).title],
            ['binding_id', threadDisplay.bindingShortId(binding)],
            ['thread_id', threadDisplay.bindingThreadId(binding) || selected.threadId],
            ['目录', formatCommandPath(binding.workingDirectory)],
          ],
          ['接下来直接发送文本即可继续。'],
          responseParseMode === 'Markdown',
        );
        responseRichCard = buildThreadCardRefresh(threadDisplay, deps.threadCardRefreshScope, msg.address, deps.threadCardSelectedId);
        if (responseRichCard && deps.threadCardRefreshScope) threadTableCardScope = deps.threadCardRefreshScope;
        break;
      }
      let binding: ReturnType<typeof router.bindToSdkSession>;
      try {
        binding = router.bindToSdkSession(msg.address, selected.thread.threadId, {
          workingDirectory: selected.thread.cwd,
          displayName: selected.thread.title,
        });
      } catch (error) {
        response = toUserVisibleBindingError(error, '切换桌面会话失败。');
        break;
      }
      auditCommandBindingChange(
        'switch_desktop',
        msg,
        commandBinding,
        binding,
        parsedArgs.force ? 'forced' : undefined,
      );
      response = buildCommandFields(
        '已切换到桌面会话',
        [
          ['标题', threadDisplay.binding(binding).title],
          ['binding_id', threadDisplay.bindingShortId(binding)],
          ['thread_id', threadDisplay.bindingThreadId(binding) || selected.thread.threadId],
          ['目录', formatCommandPath(binding.workingDirectory)],
        ],
        ['接下来直接发送文本即可继续。'],
        responseParseMode === 'Markdown',
      );
      responseRichCard = buildThreadCardRefresh(threadDisplay, deps.threadCardRefreshScope, msg.address, deps.threadCardSelectedId);
      if (responseRichCard && deps.threadCardRefreshScope) threadTableCardScope = deps.threadCardRefreshScope;
      break;
    }

    case '/threads': {
      const listArgs = parseDesktopThreadListArgs(args);
      if (!listArgs) {
        response = `用法：/threads、/threads all、/threads n 100（最多 ${MAX_DESKTOP_THREAD_LIST_LIMIT} 条）`;
        break;
      }
      const { showAll, limit } = listArgs;
      const desktopSessions = getDisplayedDesktopThreads(limit);
      if (!desktopSessions) {
        response = '读取桌面会话列表失败，请稍后重试。';
        break;
      }
      if (desktopSessions.length === 0) {
        response = showAll
          ? '没有找到桌面会话。先在 Codex Desktop App 中打开一个会话，再回来试一次。'
          : '没有找到最近桌面会话。先在 Codex Desktop App 中打开一个会话，再回来试一次。';
        break;
      }
      const decoratedSessions = threadDisplay.decorateDesktopSessions(desktopSessions, msg.address.channelType, msg.address.chatId);
      response = buildDesktopThreadsCommandResponse(
        decoratedSessions,
        responseParseMode === 'Markdown',
        showAll,
        limit,
        threadDisplay.desktopBindingStates(msg.address.channelType, msg.address.chatId),
      );
      responseRichCard = threadDisplay.refreshedDesktopThreadsCard(
        decoratedSessions,
        showAll,
        limit,
        msg.address.channelType,
        msg.address.chatId,
      );
      threadTableCardScope = 'global';
      break;
    }

    case '/tmux':
    case '/tmux-switch':
    case '/tmux-attach':
    case '/tmux-new':
    case '/tmux-status':
    case '/tmux-screen':
    case '/tmux-set': {
      const binding = currentBinding || router.resolve(msg.address);
      const session = store.getSession(binding.codepilotSessionId);
      if (!session) {
        response = '当前会话不存在，无法维护 tmux 状态。';
        break;
      }
      const tmuxScreenKey = `tmux-screen:${msg.address.channelType}:${msg.address.chatId}:${binding.codepilotSessionId}`;
      const tmuxScreenTarget: StreamFeedbackTarget = {
        adapter,
        channelType: adapter.channelType,
        chatId: msg.address.chatId,
        streamKey: tmuxScreenKey,
      };
      const tmuxScreenCard = (
        command === '/tmux-screen'
        && adapter.supportsStructuredStreamingUi?.(msg.address.chatId)
        && typeof adapter.onStreamText === 'function'
      )
        ? {
            update: (text: string, statusText: string) => {
              pushStreamFeedbackText(tmuxScreenTarget, text);
              pushStreamFeedbackStatus(tmuxScreenTarget, statusText);
            },
            actions: (actions: StructuredStreamingUiActionButton[][]) => {
              pushStreamFeedbackActions(tmuxScreenTarget, actions);
            },
            finish: (status: 'completed' | 'interrupted' | 'error', text: string) => (
              finalizeStreamFeedback(tmuxScreenTarget, status, text)
            ),
          }
        : undefined;
      response = await handleTmuxBridgeCommand({
        command,
        args,
        store,
        binding,
        session,
        markdown: responseParseMode === 'Markdown',
        screenMonitor: command === '/tmux-screen'
          ? {
              key: `${msg.address.channelType}:${msg.address.chatId}:${binding.codepilotSessionId}`,
              stopCallbackData: `${TMUX_SCREEN_STOP_CALLBACK_PREFIX}${encodeURIComponent(binding.codepilotSessionId)}`,
              card: tmuxScreenCard,
              deliver: async (text) => {
                await deliverBridgeNotice(adapter, msg.address, text, {
                  sessionId: binding.codepilotSessionId,
                  audit: true,
                });
              },
            }
          : undefined,
        richCard: (card) => {
          responseRichCard = card;
        },
      });
      break;
    }

    case '/reasoning': {
      if (!commandBinding) {
        response = '当前聊天还没有绑定会话。先发送消息创建会话，或先用 `/t 1` 接管桌面会话。';
        break;
      }
      const session = store.getSession(commandBinding.codepilotSessionId);
      if (!session) {
        response = '当前会话不存在。';
        break;
      }
      if (!args) {
        response = buildCommandFields(
          '当前思考级别',
          [['级别', formatReasoningEffort(resolveEffectiveReasoningEffort(session))]],
          [REASONING_OPTIONS_TEXT, '发送 `/r 4` 或 `/r high` 可切换。'],
          responseParseMode === 'Markdown',
        );
        break;
      }
      const reasoning = normalizeReasoningEffort(args);
      if (!reasoning) {
        response = buildCommandFields(
          '思考级别用法',
          [['命令', '`/reasoning minimal|low|medium|high|xhigh`']],
          ['也支持完整命令：`/reasoning 1|2|3|4|5`', REASONING_OPTIONS_TEXT],
          responseParseMode === 'Markdown',
        );
        break;
      }
      store.updateSession(session.id, {
        reasoning_effort: reasoning as BridgeSession['reasoning_effort'],
      });
      response = buildCommandFields(
        '已更新思考级别',
        [['级别', formatReasoningEffort(reasoning)]],
        [REASONING_OPTIONS_TEXT],
        responseParseMode === 'Markdown',
      );
      break;
    }

    case '/cwd': {
      response = '当前版本已不支持 /cwd。请使用 /new 新建会话，或使用 /t 切换到已有桌面会话。';
      break;
    }

    case '/mode': {
      const binding = currentBinding || router.resolve(msg.address);
      const session = store.getSession(binding.codepilotSessionId);
      const mode = formatSessionMode(binding, session);
      if (!args) {
        response = buildCommandFields(
          '当前模式',
          [
            ['模式', mode],
            ['Provider', formatSessionCodexProvider(session)],
          ],
          [MODE_OPTIONS_TEXT, '发送 `/m normal` 或 `/m yolo` 切换。完整命令也兼容：`/mode normal`。'],
          responseParseMode === 'Markdown',
        );
        break;
      }
      if (isTmuxProviderSession(session)) {
        response = buildTmuxProviderModeBlockedResponse(responseParseMode === 'Markdown');
        break;
      }
      const requestedMode = parseMode(args);
      if (!requestedMode) {
        response = buildCommandFields(
          '模式用法',
          [['命令', '`/mode normal|yolo`']],
          [MODE_OPTIONS_TEXT],
          responseParseMode === 'Markdown',
        );
        break;
      }
      if (session) {
        store.updateSession(session.id, {
          preferred_mode: requestedMode,
        });
      }
      router.updateBinding(binding.id, { mode: requestedMode });
      response = buildCommandFields(
        '已切换模式',
        [
          ['模式', requestedMode],
          ['Provider', formatSessionCodexProvider(session)],
        ],
        [MODE_OPTIONS_TEXT],
        responseParseMode === 'Markdown',
      );
      break;
    }

    case '/provider': {
      const binding = currentBinding || router.resolve(msg.address);
      const session = store.getSession(binding.codepilotSessionId);
      if (!session) {
        response = '当前会话不存在。';
        break;
      }
      if (!args) {
        response = buildCommandFields(
          '当前 Codex Provider',
          [
            ['模式', formatSessionMode(binding, session)],
            ['Provider', formatSessionCodexProvider(session)],
          ],
          [CODEX_PROVIDER_OPTIONS_TEXT, '发送 `/provider sdk` 或 `/provider tmux` 切换；修改从下一轮 Codex 请求开始生效。'],
          responseParseMode === 'Markdown',
        );
        break;
      }
      const requestedProvider = parseCodexProviderArg(args);
      if (!requestedProvider) {
        response = buildCommandFields(
          'Codex Provider 用法',
          [['命令', '`/provider sdk|tmux`']],
          [CODEX_PROVIDER_OPTIONS_TEXT],
          responseParseMode === 'Markdown',
        );
        break;
      }
      if (requestedProvider === 'sdk') {
        store.updateSession(session.id, {
          codex_provider: 'sdk',
          desktop_thread_id: undefined,
          thread_origin: getCodexThreadId(session, binding) ? 'bridge' : undefined,
        });
        await reconcileMirrorSubscriptionsBestEffort(deps, 'provider sdk switch');
        response = buildCommandFields(
          '已切换 Codex Provider',
          [
            ['模式', formatSessionMode(binding, store.getSession(session.id))],
            ['Provider', 'sdk'],
          ],
          ['之后的普通消息会回到 SDK Provider；tmux 会话不会自动关闭。'],
          responseParseMode === 'Markdown',
        );
        break;
      }

      const threadId = getCodexThreadId(session, binding);
      if (!threadId) {
        response = buildCommandFields(
          '无法进入 tmux Provider',
          [],
          ['当前会话还没有 codex_thread_id。请先用 SDK Provider 发送一条普通消息创建 Codex thread，再发送 `/provider tmux`。'],
          responseParseMode === 'Markdown',
        );
        break;
      }
      const mode = formatSessionMode(binding, session);
      const tmuxSessionName = codexTmuxSessionName(threadId);
      const startResult = await startCodexResumeTmuxSession({
        sessionName: tmuxSessionName,
        threadId,
        bridgeSessionId: session.id,
        workingDirectory: binding.workingDirectory || session.working_directory,
        sandboxMode: resolveEffectiveSandboxMode(session) as import('../../config.js').CodexSandboxMode,
        networkAccessEnabled: resolveEffectiveNetworkAccess(session),
        modelReasoningEffort: resolveEffectiveReasoningEffort(session) as import('../../config.js').CodexReasoningEffort,
        skipGitRepoCheck: (store.getSetting('bridge_codex_skip_git_repo_check') || '').toLowerCase() === 'true',
        codexMode: mode === 'yolo' ? 'yolo' : 'normal',
        permissionMode: mode === 'yolo' ? 'never' : 'acceptEdits',
      });
      store.updateSdkSessionId(session.id, threadId);
      store.updateSession(session.id, {
        codex_provider: 'tmux',
        tmux_session_name: tmuxSessionName,
        tmux_auto_enter: true,
        codex_thread_id: threadId,
        desktop_thread_id: threadId,
        thread_origin: 'desktop',
      });
      await reconcileMirrorSubscriptionsBestEffort(deps, 'provider tmux switch');
      response = buildCommandFields(
        '已切换 Codex Provider',
        [
          ['模式', mode],
          ['Provider', 'tmux'],
          ['codex_thread_id', threadId],
          ['tmux session', tmuxSessionName],
          ['自动回车', 'on'],
        ],
        [
          startResult.existed
            ? '同名 tmux session 已存在，已先销毁并重新启动 Codex TUI。'
            : '已启动 Codex TUI 并 resume 当前 thread。',
          '之后普通消息会发送到这个 tmux session；回复由 mirror 机制从 Codex session JSONL 自动同步。',
        ],
        responseParseMode === 'Markdown',
      );
      break;
    }

    case '/sandbox': {
      const binding = currentBinding || router.resolve(msg.address);
      const session = store.getSession(binding.codepilotSessionId);
      if (!session) {
        response = '当前会话不存在。';
        break;
      }
      if (!args) {
        response = buildCommandFields(
          '当前 Codex 沙箱',
          [
            ['沙箱', resolveEffectiveSandboxMode(session)],
            ['来源', session.codex_sandbox_mode ? '当前会话' : '全局默认'],
          ],
          [SANDBOX_OPTIONS_TEXT, '发送 `/sandbox workspace-write` 可切换；修改从下一轮 Codex 请求开始生效。'],
          responseParseMode === 'Markdown',
        );
        break;
      }
      if (isTmuxProviderSession(session)) {
        response = buildTmuxProviderRuntimeOptionBlockedResponse('`/sandbox`', responseParseMode === 'Markdown');
        break;
      }
      const requestedSandbox = args.trim().toLowerCase();
      if (requestedSandbox === 'default' || requestedSandbox === 'reset') {
        store.updateSession(session.id, { codex_sandbox_mode: undefined });
        response = buildCommandFields(
          '已恢复默认 Codex 沙箱',
          [['沙箱', resolveEffectiveSandboxMode(store.getSession(session.id))]],
          ['当前会话将继续使用 Web 配置里的全局默认值；下一轮 Codex 请求生效。'],
          responseParseMode === 'Markdown',
        );
        break;
      }
      const sandboxMode = parseSandboxMode(requestedSandbox);
      if (!sandboxMode) {
        response = buildCommandFields(
          'Codex 沙箱用法',
          [['命令', '`/sandbox read-only|workspace-write|danger-full-access|default`']],
          [SANDBOX_OPTIONS_TEXT],
          responseParseMode === 'Markdown',
        );
        break;
      }
      store.updateSession(session.id, { codex_sandbox_mode: sandboxMode });
      response = buildCommandFields(
        '已更新 Codex 沙箱',
        [['沙箱', sandboxMode]],
        ['修改从下一轮 Codex 请求开始生效；正在运行的任务请先 `/stop` 后重发。'],
        responseParseMode === 'Markdown',
      );
      break;
    }

    case '/network': {
      const binding = currentBinding || router.resolve(msg.address);
      const session = store.getSession(binding.codepilotSessionId);
      if (!session) {
        response = '当前会话不存在。';
        break;
      }
      if (!args) {
        response = buildCommandFields(
          '当前 Codex 网络',
          [
            ['网络', formatNetworkAccess(resolveEffectiveNetworkAccess(session))],
            ['来源', typeof session.codex_network_access === 'boolean' ? '当前会话' : '全局默认'],
          ],
          [NETWORK_OPTIONS_TEXT, '这个开关会传给 `sandbox_workspace_write.network_access`；下一轮 Codex 请求生效。'],
          responseParseMode === 'Markdown',
        );
        break;
      }
      if (isTmuxProviderSession(session)) {
        response = buildTmuxProviderRuntimeOptionBlockedResponse('`/network`', responseParseMode === 'Markdown');
        break;
      }
      const networkAccess = parseNetworkAccessArg(args);
      if (networkAccess === null) {
        response = buildCommandFields(
          'Codex 网络用法',
          [['命令', '`/network on|off|default`']],
          [NETWORK_OPTIONS_TEXT],
          responseParseMode === 'Markdown',
        );
        break;
      }
      if (networkAccess === 'default') {
        store.updateSession(session.id, { codex_network_access: undefined });
        response = buildCommandFields(
          '已恢复默认 Codex 网络',
          [['网络', formatNetworkAccess(resolveEffectiveNetworkAccess(store.getSession(session.id)))]],
          ['当前会话将继续使用 Web 配置里的全局默认值；下一轮 Codex 请求生效。'],
          responseParseMode === 'Markdown',
        );
        break;
      }
      store.updateSession(session.id, { codex_network_access: networkAccess });
      response = buildCommandFields(
        '已更新 Codex 网络',
        [['网络', formatNetworkAccess(networkAccess)]],
        ['修改从下一轮 Codex 请求开始生效；正在运行的任务请先 `/stop` 后重发。'],
        responseParseMode === 'Markdown',
      );
      break;
    }

    case '/ui': {
      const currentConfig = loadConfig();
      const parsedUi = parseUiArgs(args);
      if (!parsedUi) {
        response = buildCommandFields(
          'UI 显示设置用法',
          [['命令', '`/ui on|off`']],
          [UI_DETAIL_OPTIONS_TEXT],
          responseParseMode === 'Markdown',
        );
        break;
      }

      if (parsedUi.action === 'show') {
        response = buildCommandFields(
          'UI 显示设置',
          [['SDK 工具详情', formatUiDetailMode(currentConfig.sdkToolCallDetailsInText !== false)]],
          [
            UI_DETAIL_OPTIONS_TEXT,
            '这是全局设置，会影响 SDK 对话文本预览/history，以及流式工具区是否展示工具输入输出；mirror 仍按 Desktop JSONL 展示。',
          ],
          responseParseMode === 'Markdown',
        );
        break;
      }

      saveConfig({ ...currentConfig, sdkToolCallDetailsInText: parsedUi.enabled });
      response = buildCommandFields(
        '已更新 UI 显示设置',
        [['SDK 工具详情', formatUiDetailMode(parsedUi.enabled)]],
        ['修改从下一轮 Codex 请求开始生效；正在运行的任务请先 `/stop` 后重发。'],
        responseParseMode === 'Markdown',
      );
      break;
    }

    case '/model': {
      const binding = currentBinding || router.resolve(msg.address);
      const session = store.getSession(binding.codepilotSessionId);
      if (!session) {
        response = '当前会话不存在。';
        break;
      }

      if (!args) {
        const desktopThreadId = getExplicitDesktopThreadId(session);
        const currentModel = resolveDisplayedModel(
          binding,
          session,
          store.getSetting('default_model'),
          readConfiguredCodexModel(),
        );
        response = buildCommandFields(
          '当前模型',
          [['模型', formatDisplayedModel(currentModel)]],
          [
            getAvailableModelChoicesText(),
            desktopThreadId
              ? '当前是共享桌面线程，只支持查看模型；如需切换，请先用 `/new` 新建一个 IM 会话线程。'
              : '发送 `/model gpt-5.4` 可切换；发送 `/model default` 可回退到默认模型。',
            '模型切换只影响后续从 IM 发起的 Codex CLI 请求。',
          ],
          responseParseMode === 'Markdown',
        );
        break;
      }

      if (getExplicitDesktopThreadId(session)) {
        response = '当前是共享桌面线程，不支持直接切换模型。请先用 `/new` 新建一个线程，再执行 `/model ...`。';
        break;
      }

      const requestedModel = args.trim();
      if (requestedModel === 'default') {
        store.updateSessionModel(session.id, '');
        router.updateBinding(binding.id, { model: '' });
        const updatedBinding = router.resolve(msg.address);
        const updatedSession = store.getSession(updatedBinding.codepilotSessionId);
        const currentModel = resolveDisplayedModel(
          updatedBinding,
          updatedSession,
          store.getSetting('default_model'),
          readConfiguredCodexModel(),
        );
        response = buildCommandFields(
          '已恢复默认模型',
          [['模型', formatDisplayedModel(currentModel)]],
          ['后续从 IM 发起的 Codex CLI 请求会跟随默认模型。'],
          responseParseMode === 'Markdown',
        );
        break;
      }

      const selectedModel = getSelectableCodexModel(requestedModel);
      if (!selectedModel) {
        response = buildCommandFields(
          '模型用法',
          [['命令', '`/model <slug>`']],
          [
            getAvailableModelChoicesText(),
            '发送 `/model default` 可回退到默认模型。',
          ],
          responseParseMode === 'Markdown',
        );
        break;
      }

      store.updateSessionModel(session.id, selectedModel.slug);
      router.updateBinding(binding.id, { model: selectedModel.slug });
      response = buildCommandFields(
        '已更新模型',
        [['模型', formatDisplayedModel(selectedModel.slug)]],
        [
          '后续从 IM 发起的 Codex CLI 请求会使用这个模型。',
          ...(isCliOnlyCodexModel(selectedModel)
            ? ['这是仅 IM/CLI 模型，只能在 IM -> Codex CLI 调用中使用，Codex Desktop 不支持。']
            : []),
        ],
        responseParseMode === 'Markdown',
      );
      break;
    }

    case '/status': {
      auditResponse = false;
      response = buildGlobalStatusResponse(
        store,
        currentBinding,
        responseParseMode === 'Markdown',
      );
      break;
    }

    case '/current': {
      auditResponse = false;
      const binding = commandBinding;
      if (!binding) {
        response = buildCommandFields(
          '当前会话',
          [],
          ['当前聊天还没有绑定会话。可先发送 `/t` 查看最近桌面会话，再用 `/t 1` 接管；或发送 `/new proj1` / `/new 绝对路径` 创建项目会话。'],
          responseParseMode === 'Markdown',
        );
        break;
      }

      const session = store.getSession(binding.codepilotSessionId);
      if (!session) {
        response = buildCommandFields(
          '当前会话',
          [
            ['Session', binding.codepilotSessionId],
            ['codex-thread-id', binding.sdkSessionId || '-'],
            ['目录', formatCommandPath(binding.workingDirectory)],
          ],
          ['当前聊天绑定的会话已经不存在。可用 `/t` 接管桌面会话，或用 `/new proj1` / `/new 绝对路径` 创建新会话。'],
          responseParseMode === 'Markdown',
        );
        break;
      }

      const desktopThreadId = getExplicitDesktopThreadId(session);
      const codexThreadId = getCodexThreadId(session, binding);
      const threadInfo = threadDisplay.binding(binding);
      const sandboxMode = resolveEffectiveSandboxMode(session);
      const networkAccess = resolveEffectiveNetworkAccess(session);
      const reasoningEffort = resolveEffectiveReasoningEffort(session);
      const currentModel = resolveDisplayedModel(
        binding,
        session,
        store.getSetting('default_model'),
        readConfiguredCodexModel(),
      );
      const chatBindingCount = listBindingsForChat(store, msg.address.channelType, msg.address.chatId).length;
      const sessionKind = session?.session_type === 'draft'
        ? '临时草稿线程'
        : '普通会话';
      response = buildCommandFields(
        '当前会话',
        [
          ['标题', threadInfo.title],
          ['codex-thread-id', codexThreadId || '-'],
          ['当前 binding', threadDisplay.bindingShortId(binding)],
          ['聊天绑定数', `${chatBindingCount}`],
          ['目录', formatCommandPath(binding.workingDirectory)],
          ['模式', formatSessionMode(binding, session)],
          ['Provider', formatSessionCodexProvider(session)],
          ['当前模型', formatDisplayedModel(currentModel)],
          ['类型', sessionKind],
          ['运行状态', formatRuntimeStatus(session)],
          ['共享镜像', formatMirrorStatus(session)],
          ['文件系统权限', sandboxMode],
          ['网络访问', formatNetworkAccess(networkAccess)],
          ['思考级别', formatReasoningEffort(reasoningEffort)],
        ],
        [
          desktopThreadId
            ? '当前聊天已绑定到一条共享会话，直接发送消息即可继续。'
            : session?.session_type === 'draft'
              ? '当前聊天正在使用临时草稿线程（等同 `/t 0`）。可直接发送消息，或用 `/t` / `/new proj1` / `/new 绝对路径` 切换到正式会话。'
              : '当前聊天正在使用 IM 会话。可直接发送消息继续；如需接管桌面会话，可先发送 `/t`，再用 `/t 1` 接管。',
          '发送 `/t ls` 可查看这个聊天绑定的全部线程。',
        ],
        responseParseMode === 'Markdown',
      );
      break;
    }

    case '/health': {
      auditResponse = false;
      if (args === 'all') {
        const diagnoses = await deps.diagnoseAllActiveSessions();
        response = diagnoses.length > 0
          ? buildHealthListResponse(diagnoses, responseParseMode === 'Markdown')
          : '当前没有检测到运行中的会话。';
        break;
      }

      const explicitTargetSessionId = args.trim();
      const targetSessionId = explicitTargetSessionId || commandBinding?.codepilotSessionId;
      if (!targetSessionId) {
        response = '当前聊天还没有绑定会话。先发送消息创建会话，或先用 `/t 1` 接管桌面会话。';
        break;
      }
      const diagnosis = await deps.diagnoseSessionHealth(targetSessionId);
      if (!diagnosis) {
        response = `没有找到会话 ${targetSessionId}。`;
        break;
      }
      response = buildHealthCommandResponse(
        explicitTargetSessionId ? '指定会话健康检查' : '当前会话健康检查',
        diagnosis,
        responseParseMode === 'Markdown',
      );
      break;
    }

    case '/history': {
      const historyParts = args.trim().split(/\s+/).filter(Boolean);
      const historyArg = (historyParts[0] || '').toLowerCase();
      if (historyArg === 'limit' || historyArg === 'n') {
        const nextLimit = parseHistoryLimitArg(historyParts[1] || '');
        if (!nextLimit || historyParts.length > 2) {
          response = [
            '用法：/his limit <1-20>',
            '示例：/his limit 12',
            `当前配置：${getHistoryMessageLimit()}`,
          ].join('\n');
          break;
        }
        try {
          const currentConfig = loadConfig();
          saveConfig({ ...currentConfig, historyMessageLimit: nextLimit });
          response = `已将 /his msg 返回条数限制设置为 ${nextLimit}。`;
        } catch (error) {
          response = `修改失败：${error instanceof Error ? error.message : String(error)}`;
        }
        break;
      }

      if (!commandBinding) {
        response = '当前聊天还没有绑定会话。先发送消息创建会话，或先用 `/t 1` 接管桌面会话。';
        break;
      }

      if (historyArg && historyArg !== 'msg' && historyArg !== 'raw' && historyArg !== 'json' && historyArg !== 'file') {
        response = [
          '用法：/his [msg|raw|json|limit <1-20>]',
          '示例：',
          '- /his msg',
          '- /his',
          '- /his raw',
          '- /his json',
          '- /his limit 12',
        ].join('\n');
        break;
      }

      const limit = getHistoryMessageLimit();
      const session = store.getSession(commandBinding.codepilotSessionId);
      const sessionFile = resolveHistorySessionFile(session, commandBinding);

      if (historyArg === 'json' || historyArg === 'file') {
        if (!sessionFile) {
          response = '当前会话没有可直接发送的 Codex session JSONL 文件。只有已落盘到 Codex session 文件的线程才能使用 `/his json`。';
          break;
        }
        const attachment: OutboundAttachment = {
          kind: 'file',
          path: sessionFile.filePath,
          name: sessionFile.fileName,
        };
        const result = await deliverResponse(
          adapter,
          msg.address,
          '',
          commandBinding.codepilotSessionId,
          msg.messageId,
          [attachment],
        );
        if (!result.ok) {
          response = `发送失败：${result.error || '未知错误'}`;
        }
        break;
      }

      const desktopMessages = sessionFile
        ? readDesktopSessionMessagesByFilePath(sessionFile.filePath, limit)
        : [];
      const { messages: storedMessages } = store.getMessages(commandBinding.codepilotSessionId, { limit });
      const messages = desktopMessages.length > 0 ? desktopMessages : storedMessages;
      if (messages.length === 0) {
        response = '当前会话还没有历史消息。';
        break;
      }
      const threadTitle = threadDisplay.binding(commandBinding).title;
      const messageSource = desktopMessages.length > 0 ? 'Codex session JSONL' : 'Bridge 缓存';

      if (historyArg === 'msg') {
        response = buildHistoryMessagesCard(messages, {
          title: threadTitle,
          source: messageSource,
          limit,
          markdown: responseParseMode === 'Markdown',
        });
        break;
      }

      const header = buildCommandFields(
        '最近对话（解析文本）',
        [
          ['标题', threadTitle],
          ['来源', messageSource],
          ['返回条数', `${messages.length} / 配置 ${limit}`],
        ],
        historyArg === 'raw'
          ? []
          : ['`/his msg` 查看卡片版消息；`/his raw` 查看解析后的纯文本视图；`/his json` 直接发送原始 session JSONL 文件；`/his limit 12` 修改返回条数。'],
        responseParseMode === 'Markdown',
      );
      const body = messages.map((message, index) => {
        if (responseParseMode === 'Markdown') {
          return `${index + 1}. **${formatHistoryRole(message.role)}**\n\n${truncateHistoryContent(formatStoredMessageContent(message.content))}`;
        }
        return `${index + 1}. ${formatHistoryRole(message.role)}\n${truncateHistoryContent(formatStoredMessageContent(message.content))}`;
      }).join('\n\n');
      response = [header, body].join('\n\n').trim();
      break;
    }

    case '/cat': {
      const binding = currentBinding || router.resolve(msg.address);
      const parts = args.split(/\s+/).filter(Boolean);
      const rawPath = parts[0] || '';
      if (!rawPath) {
        response = '用法：/cat <path> [start_line] [end_line]\n示例：/cat README.md 1 200';
        break;
      }
      const hasAbs = path.isAbsolute(rawPath) || path.win32.isAbsolute(rawPath);
      if (!hasAbs && !binding.workingDirectory) {
        response = '当前会话没有工作目录，请使用绝对路径。';
        break;
      }
      const resolvedPath = hasAbs ? rawPath : path.resolve(binding.workingDirectory, rawPath);
      let startLine = 1;
      let endLine = 200;
      const maybeStart = parts[1];
      const maybeEnd = parts[2];
      if (maybeStart && /^\d+$/.test(maybeStart) && maybeEnd && /^\d+$/.test(maybeEnd)) {
        startLine = Math.max(1, parseInt(maybeStart, 10));
        endLine = Math.max(startLine, parseInt(maybeEnd, 10));
      } else if (maybeStart && /^\d+$/.test(maybeStart)) {
        endLine = Math.max(1, parseInt(maybeStart, 10));
      }
      try {
        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile()) {
          response = '目标不是文件。';
          break;
        }
        const raw = fs.readFileSync(resolvedPath, 'utf-8');
        const lines = raw.replace(/\r\n/g, '\n').split('\n');
        const slice = lines.slice(startLine - 1, endLine);
        const slicedText = slice.join('\n');
        const { text: safeText, truncated } = sanitizeInput(slicedText, 12_000);
        const suffix = truncated || lines.length > endLine ? '\n\n（内容过长已截断）' : '';
        response = responseParseMode === 'Markdown'
          ? `**${path.basename(resolvedPath)}**\n\n${buildFencedCodeBlock(safeText, 'text')}${suffix}`
          : `${path.basename(resolvedPath)}\n\n${safeText}${suffix}`;
      } catch (error) {
        response = `读取文件失败：${error instanceof Error ? error.message : String(error)}`;
      }
      break;
    }

    case '/file': {
      const binding = currentBinding || router.resolve(msg.address);
      const rawPath = args.trim();
      if (!rawPath) {
        response = '用法：/file <path>\n示例：/file report.txt';
        break;
      }
      const hasAbs = path.isAbsolute(rawPath) || path.win32.isAbsolute(rawPath);
      if (!hasAbs && !binding.workingDirectory) {
        response = '当前会话没有工作目录，请使用绝对路径。';
        break;
      }
      const resolvedPath = hasAbs ? rawPath : path.resolve(binding.workingDirectory, rawPath);
      try {
        const stat = fs.statSync(resolvedPath);
        if (!stat.isFile()) {
          response = '目标不是文件。';
          break;
        }
        if (stat.size > 20 * 1024 * 1024) {
          response = `文件过大（${stat.size} bytes），暂不支持通过 /file 发送。`;
          break;
        }
        const attachment: OutboundAttachment = {
          kind: 'file',
          path: resolvedPath,
          name: path.basename(resolvedPath),
        };
        const result = await deliverResponse(
          adapter,
          msg.address,
          '',
          binding.codepilotSessionId,
          msg.messageId,
          [attachment],
        );
        response = result.ok ? `已发送文件：${path.basename(resolvedPath)}` : `发送失败：${result.error || '未知错误'}`;
      } catch (error) {
        response = `读取文件失败：${error instanceof Error ? error.message : String(error)}`;
      }
      break;
    }

    case '/stop': {
      const binding = commandBinding || router.resolve(msg.address);
      const session = store.getSession(binding.codepilotSessionId);
      const task = deps.getActiveTask(binding.codepilotSessionId);
      const looksRunning = sessionLooksRunning(session);
      if (!task && shouldMapStopToTmuxInterrupt(session)) {
        const command = await sendTmuxInterrupt(session.tmux_session_name);
        response = buildCommandFields(
          '已发送停止按键',
          [
            ['Provider', 'tmux'],
            ['tmux session', session.tmux_session_name],
          ],
          [
            '当前会话处于 tmux Provider，且 mirror 显示任务仍在输出；`/stop` 已映射为向 Codex TUI 发送 `C-c`。',
            `底层命令：\`${command}\``,
          ],
          responseParseMode === 'Markdown',
        );
        break;
      }
      if (task || looksRunning) {
        const taskName = threadDisplay.binding(binding).title;
        const detail = '用户执行 /stop，已停止当前任务。';
        if (deps.forceStopSession) {
          await deps.forceStopSession(binding.codepilotSessionId, detail);
        } else if (task) {
          task.abortController.abort();
        }
        deps.recordInteractiveHealthEnd?.(binding.codepilotSessionId, 'aborted', detail);
        response = `旧会话「${taskName}」任务已停止，可继续发送消息恢复该线程。`;
      } else {
        response = '当前没有正在运行的任务。';
      }
      break;
    }

    case '/perm': {
      const permParts = args.split(/\s+/);
      const permAction = permParts[0];
      const permId = permParts.slice(1).join(' ');
      if (!permAction || !permId || !['allow', 'allow_session', 'deny'].includes(permAction)) {
        response = '用法：/perm allow|allow_session|deny <permission_id>';
        break;
      }
      const link = store.getPermissionLink(permId);
      if (!link) {
        response = '没有找到对应权限，或该权限已处理。';
        break;
      }
      if (
        currentBinding?.codepilotSessionId
        && link.sessionId
        && link.sessionId !== currentBinding.codepilotSessionId
      ) {
        response = '这条权限请求不属于当前会话。请先切回对应会话，再处理该权限。';
        break;
      }
      const callbackData = `perm:${permAction}:${permId}`;
      const handled = broker.handlePermissionCallback(callbackData, msg.address.chatId);
      response = handled
        ? `已记录权限操作：${permAction}`
        : '没有找到对应权限，或该权限已处理。';
      break;
    }

    case '/help':
      responseParseMode = getFeedbackParseMode(adapter.channelType);
      response = [
        '**命令速览**',
        '',
        '**常用**',
        '- `/` 当前聊天/当前会话诊断',
        '- `/status` 全局状态（通道、Bridge/UI 进程、PID、绑定与会话数量）',
        '- `/check` 健康检查',
        '- `/check all` 查看所有运行中会话的健康状态',
        '- `//...` 向模型发送以 `/` 开头的文本',
        '- `/h` 帮助',
        `- \`/t\` 最近 ${DEFAULT_DESKTOP_THREAD_LIST_LIMIT} 条桌面会话`,
        `- \`/t all\` 最多 ${MAX_DESKTOP_THREAD_LIST_LIMIT} 条桌面会话`,
        `- \`/t n 100\` 最近 100 条桌面会话（最多 ${MAX_DESKTOP_THREAD_LIST_LIMIT} 条）`,
        '- `/t 1` 接管第 1 条会话，并设为当前线程',
        '- `/t ls` 查看当前聊天已绑定线程',
        '- `/t add 1` 添加第 1 条桌面会话但不切走当前线程',
        '- `/t use 1` 切换当前绑定线程（也可用 thread id、binding id 或名称）',
        '- `/t rm 1` 移除指定绑定线程（也可用 thread id、binding id 或名称）',
        '- `/t rename <名称>` 重命名当前线程',
        '- 序号范围：`/t 1` 和 `/t add 1` 使用 `/t` 全局桌面会话表；`/t use 1` 和 `/t rm 1` 使用 `/t ls` 当前聊天局部绑定表',
        '- `/n` 在当前工作目录下新建线程（仅保证 IM 可继续，不会自动出现在桌面会话列表）',
        '- `/n proj1` 在默认工作空间下新建项目会话',
        '- 直接发文本：继续当前会话；未绑定时进入临时草稿线程',
        '- `/his` 最近消息纯文本视图（优先 Codex session JSONL，找不到再读 Bridge 缓存）',
        '- `/his msg` 最近消息卡片',
        '- `/his json` 直接发送原始 session JSONL 文件',
        '- `/his limit 12` 修改 `/his msg` 返回条数（1-20）',
        '- `/tmux-switch` 列出 tmux sessions，类似 `Ctrl+b s`',
        '- `/tmux-attach <session>` 绑定当前 IM 会话的远程 tmux session',
        '- `/tmux-new [session]` 新建并绑定 tmux session；已存在则提示并直接绑定',
        '- `/tmux-status` 查看当前绑定和截屏行数',
        '- `/tmux-set lines 120` 设置 `/tmux` 自动截屏行数',
        '- `/tmux-set enter on|off` 设置 `/tmux` 发送内容后是否自动补 Enter',
        '- `/tmux-screen [lines] [seconds]s` 查看当前绑定 tmux session 的屏幕状态；例如 `/tmux-screen 5s` 或 `/tmux-screen 120 5s`，最低 3 秒',
        '- `/tmux-screen stop` 停止当前聊天的 tmux 屏幕定时刷新',
        '- `/tmux pwd<Enter>` 向当前 tmux session 发送按键并自动截屏返回',
        '',
        '**设置**',
        '- `/m` 查看模式；可用 `normal | yolo`（`code` 会映射为 `normal`）',
        '- `/provider` 查看或切换 Codex Provider；可用 `sdk | tmux`',
        '- `/r` 查看思考级别；可用 `1 | 2 | 3 | 4 | 5`',
        '- `/sb` 查看或切换 Codex 沙箱；可用 `read-only | workspace-write | danger-full-access | default`',
        '- `/net` 查看或切换 Codex 网络；可用 `on | off | default`',
        '- `/ui` 查看 UI 显示设置；`/ui on|off` 切换 SDK 工具输入输出显示',
        '- `/model` 查看当前模型；`/model gpt-5.4` 可切换，`/model default` 回退到默认模型',
        '- `/t 0` 临时草稿线程',
        '- `/t 0 reset` 重置草稿线程',
        '- `/stop` 停止当前任务',
        '',
        '**其它**',
        '- `/his raw` 解析后的纯文本视图（兼容别名）',
        '- `/his json` 直接发送原始 session JSONL 文件（兼容别名：`/his file`）',
        '- `/perm allow|allow_session|deny <id>` 或 `1 / 2 / 3` 处理权限',
        '- `/cat <path> [start] [end]` 打印文件内容（默认前 200 行）',
        '- `/file <path>` 直接发送本地文件',
      ].join('\n');
      break;

    default:
      response = `未知命令：${rawCommand}\n发送 /h 或 /help 查看可用命令。`;
  }

  if (response) {
    const result = await deliverBridgeNotice(adapter, msg.address, response, {
      replyToMessageId: msg.messageId,
      audit: auditResponse,
      richCard: responseRichCard,
      richCardUpdateMessageId: msg.callbackMessageId,
    });
    if (result.ok && threadTableCardScope && result.messageId) {
      await persistAndPinLatestThreadTableMessage(adapter, msg.address, threadTableCardScope, result.messageId);
    }
  }
}
