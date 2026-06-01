import { getOrCreateDraftSession } from '../../../internal-sessions.js';
import { readConfiguredCodexModel } from '../../../codex/models.js';
import { DEFAULT_WORKSPACE_ROOT } from '../../../config.js';
import {
  listBindingsForChat,
  SessionRegistryService,
  setActiveBindingForChat,
} from '../session-registry.js';
import {
  DEFAULT_CODEX_THREAD_LIST_LIMIT,
  MAX_CODEX_THREAD_LIST_LIMIT,
  parseListIndex,
  parseCodexThreadListArgs,
} from './aliases.js';
import {
  buildCodexThreadsCommandResponse,
  buildCodexThreadLimitNotice,
  buildCommandFields,
  formatCommandDateTime,
  formatCommandPath,
  toUserVisibleBindingError,
} from './presentation.js';
import * as router from '../channel-router.js';
import {
  ensureWorkingDirectoryExists,
  resetDraftSession,
  resolveNewSessionWorkingDirectory,
} from '../bridge-session-support.js';
import { recordBindingChange, type BindingChangeAction } from '../binding-audit.js';
import type { BridgeStore } from '../host.js';
import {
  CommandThreadDisplay,
  type ThreadCardScope,
} from './thread-display.js';
import {
  getBridgeSessionCodexThreadId,
  getBridgeSessionDisplayTitle,
} from '../display/session-display-query.js';
import { getSessionDisplayName } from '../display/session-title.js';
import type { ChannelBinding, InboundMessage, OutboundRichCard } from '../types.js';
import {
  getCommandCodexThreadByIdSafe,
  archiveCommandCodexThread,
  listCommandCodexThreads,
  type CodexSessionSummary,
} from './session-source.js';
import {
  formatSessionCodexProvider,
  formatSessionMode,
} from './runtime-settings.js';

export interface SessionThreadCommandDeps {
  getActiveTask(sessionId: string): { abortController: AbortController } | undefined;
  reconcileMirrorSubscriptions?(): Promise<void>;
  onBindingRemoved?(binding: ChannelBinding): void;
  threadCardRefreshScope?: ThreadCardScope | null;
  threadCardSelectedId?: string | null;
}

export interface SessionThreadCommandResult {
  response: string;
  richCard?: OutboundRichCard;
  threadTableCardScope?: ThreadCardScope;
}

function parseForceFlag(args: string): { args: string; force: boolean } {
  const forcePattern = /(^|\s)--force(?=\s|$)/;
  const force = forcePattern.test(args);
  const cleaned = args.replace(/(^|\s)--force(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  return { args: cleaned, force };
}

function readFirstArg(raw: string): { first: string; rest: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const quote = trimmed[0];
  if (quote === '"' || quote === "'") {
    let escaped = false;
    let value = '';
    for (let i = 1; i < trimmed.length; i += 1) {
      const ch = trimmed[i];
      if (escaped) {
        value += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) {
        return { first: value, rest: trimmed.slice(i + 1).trim() };
      }
      value += ch;
    }
    return null;
  }
  const match = trimmed.match(/^(\S+)(?:\s+([\s\S]+))?$/);
  if (!match) return null;
  return { first: match[1] || '', rest: (match[2] || '').trim() };
}

function looksLikeNewPath(value: string): boolean {
  return value === '~'
    || value.startsWith('~/')
    || value.startsWith('~\\')
    || value.includes('/')
    || value.includes('\\')
    || /^[A-Za-z]:/.test(value);
}

const NEW_SESSION_ARG_RULE_NOTE = '参数规则：`/new <name> <path>` 可指定会话名；name 不能包含 `/` 或 `\\`。如果第一个参数像路径（如 `./hi`、`~/hi`、`/abs/path`、`C:\\work`），会按旧用法 `/new <path>` 处理。';

export function parseNewSessionArgs(args: string): { name?: string; pathArgs: string } | { error: string } {
  const trimmed = args.trim();
  if (!trimmed) return { pathArgs: '' };
  const firstArg = readFirstArg(trimmed);
  if (!firstArg) return { error: '参数格式无效。名称包含空格时请使用引号，例如 `/new \"项目名\" ~/work/proj`。' };
  if (!firstArg.rest) {
    return { pathArgs: trimmed };
  }
  if (looksLikeNewPath(firstArg.first)) {
    return { error: `会话名不能包含路径分隔符或路径前缀。${NEW_SESSION_ARG_RULE_NOTE}` };
  }
  return { name: firstArg.first, pathArgs: firstArg.rest };
}

function buildActiveTaskSwitchBlockedResponse(
  store: BridgeStore,
  binding: ChannelBinding,
  markdown: boolean,
): string {
  const threadDisplay = new CommandThreadDisplay(store);
  return buildCommandFields(
    '当前会话仍在运行',
    [
      ['标题', threadDisplay.binding(binding).title],
      ['Session', binding.bridgeSessionId],
    ],
    [
      '为避免旧任务完成后把回复发到已经切走的聊天，当前不直接切换绑定。',
      '请先发送 `/stop` 停止当前任务；如果确认要强制切换，请在原命令末尾加 `--force`。',
    ],
    markdown,
  );
}

function guardBindingChangeWhileRunning(
  store: BridgeStore,
  binding: ChannelBinding | null,
  force: boolean,
  deps: SessionThreadCommandDeps,
  markdown: boolean,
): string | null {
  if (!binding || force) return null;
  return deps.getActiveTask(binding.bridgeSessionId)
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

function selectCodexThreadForCommand(
  threadDisplay: CommandThreadDisplay,
  raw: string,
  displayedThreads: CodexSessionSummary[],
): {
  thread?: CodexSessionSummary;
  threadId?: string;
  ambiguous?: boolean;
  index?: number;
} {
  const selected = threadDisplay.selectCodexThread(raw, displayedThreads);
  if (selected.threadId || selected.ambiguous || selected.index !== undefined) {
    return selected;
  }

  const fallback = getCommandCodexThreadByIdSafe(raw, 'thread bind');
  return {
    thread: fallback.thread ? { ...fallback.thread, title: threadDisplay.codex(fallback.thread).title } : undefined,
    threadId: fallback.threadId,
  };
}

function selectCodexThreadByThreadId(
  raw: string,
  displayedThreads: CodexSessionSummary[],
): {
  thread?: CodexSessionSummary;
  threadId?: string;
  ambiguous?: boolean;
} {
  const token = raw.trim();
  const lowerToken = token.toLowerCase();
  const exactThread = displayedThreads.find((session) => session.threadId.toLowerCase() === lowerToken);
  if (exactThread) return { thread: exactThread, threadId: exactThread.threadId };

  const prefixMatches = displayedThreads.filter((session) => session.threadId.toLowerCase().startsWith(lowerToken));
  if (prefixMatches.length > 1) return { ambiguous: true };
  if (prefixMatches.length === 1) return { thread: prefixMatches[0], threadId: prefixMatches[0].threadId };

  const fallback = getCommandCodexThreadByIdSafe(raw, 'thread switch by id');
  return {
    thread: fallback.thread,
    threadId: fallback.threadId,
  };
}

function selectDirectThreadTarget(
  threadDisplay: CommandThreadDisplay,
  raw: string,
  bindings: ChannelBinding[],
  displayedThreads: CodexSessionSummary[],
): {
  binding?: ChannelBinding;
  thread?: CodexSessionSummary;
  threadId?: string;
  ambiguous?: boolean;
  index?: number;
} {
  const token = raw.trim();
  const lowerToken = token.toLowerCase();
  const index = parseListIndex(token);
  if (index !== null) {
    const selected = selectCodexThreadForCommand(threadDisplay, raw, displayedThreads);
    if (selected.threadId || selected.ambiguous) {
      return {
        thread: selected.thread,
        threadId: selected.threadId,
        ambiguous: selected.ambiguous,
        index: selected.index,
      };
    }
  }

  const bindingIdMatches = bindings.filter((binding) => (
    binding.id.toLowerCase() === lowerToken
    || binding.id.toLowerCase().startsWith(lowerToken)
    || binding.bridgeSessionId.toLowerCase() === lowerToken
    || binding.bridgeSessionId.toLowerCase().startsWith(lowerToken)
  ));
  if (bindingIdMatches.length > 1) return { ambiguous: true };
  if (bindingIdMatches.length === 1) return { binding: bindingIdMatches[0] };

  const bindingThreadMatches = bindings.filter((binding) => {
    const threadId = threadDisplay.bindingThreadId(binding);
    return Boolean(threadId && (threadId.toLowerCase() === lowerToken || threadId.toLowerCase().startsWith(lowerToken)));
  });
  if (bindingThreadMatches.length > 1) return { ambiguous: true };
  if (bindingThreadMatches.length === 1) return { binding: bindingThreadMatches[0] };

  const codexThreadMatch = selectCodexThreadByThreadId(raw, displayedThreads);
  if (codexThreadMatch.ambiguous) return { ambiguous: true };
  if (codexThreadMatch.threadId) return codexThreadMatch;

  const bindingNameMatches = bindings.filter((binding) => threadDisplay.binding(binding).title.trim() === token);
  const codexNameMatches = displayedThreads.filter((session) => session.title.trim() === token);
  const targets = new Map<string, { binding?: ChannelBinding; thread?: CodexSessionSummary; threadId?: string }>();
  for (const binding of bindingNameMatches) {
    const threadId = threadDisplay.bindingThreadId(binding);
    targets.set(threadId ? `thread:${threadId}` : `binding:${binding.id}`, { binding });
  }
  for (const thread of codexNameMatches) {
    const key = `thread:${thread.threadId}`;
    if (!targets.has(key)) {
      targets.set(key, { thread, threadId: thread.threadId });
    }
  }
  if (targets.size > 1) return { ambiguous: true };
  return Array.from(targets.values())[0] || {};
}

function getRawCodexTitle(threadId: string | undefined, fallback?: string): string | undefined {
  if (!threadId) return fallback;
  return getCommandCodexThreadByIdSafe(threadId, 'thread raw title').thread?.title || fallback;
}

function createCommandSessionRegistry(store: BridgeStore): SessionRegistryService {
  return new SessionRegistryService(store, {
    codexThreads: {
      getThread(codexThreadId) {
        const session = getCommandCodexThreadByIdSafe(codexThreadId, 'command registry lookup').thread;
        return session
          ? { codexThreadId: session.threadId, title: session.title, cwd: session.cwd }
          : null;
      },
      archiveThread: (codexThreadId) => Boolean(archiveCommandCodexThread(codexThreadId)),
    },
    readDefaultModel: () => readConfiguredCodexModel(),
    defaultWorkingDirectory: () => DEFAULT_WORKSPACE_ROOT,
  });
}

function findBridgeSessionByCodexThread(store: BridgeStore, threadId: string) {
  return store.listSessions().find((session) => getBridgeSessionCodexThreadId(session) === threadId) || null;
}

function findBridgeOnlySessionByToken(store: BridgeStore, token: string) {
  const lowerToken = token.trim().toLowerCase();
  if (!lowerToken) return { session: null, ambiguous: false };
  const matches = store.listSessions().filter((session) => (
    session.hidden !== true
    && session.session_type !== 'draft'
    && !getBridgeSessionCodexThreadId(session)
    && (
      session.id.toLowerCase() === lowerToken
      || session.id.toLowerCase().startsWith(lowerToken)
      || getBridgeSessionDisplayTitle(session).trim() === token.trim()
    )
  ));
  return {
    session: matches.length === 1 ? matches[0] : null,
    ambiguous: matches.length > 1,
  };
}

function resolveCurrentCodexThreadTarget(
  store: BridgeStore,
  threadDisplay: CommandThreadDisplay,
  address: InboundMessage['address'],
): {
  threadId?: string;
  title?: string;
  cwd?: string;
  binding?: ChannelBinding;
  bridgeSessionId?: string;
} {
  const binding = store.getChannelBinding(address.channelType, address.chatId);
  if (!binding) return {};

  const session = store.getSession(binding.bridgeSessionId);
  const threadId = getBridgeSessionCodexThreadId(session || { codex_thread_id: '' });
  if (!threadId) return { binding, bridgeSessionId: binding.bridgeSessionId };

  const codexThread = getCommandCodexThreadByIdSafe(threadId, 'thread archive current').thread;
  return {
    threadId,
    title: codexThread?.title || (session ? getBridgeSessionDisplayTitle(session) : threadDisplay.binding(binding).title),
    cwd: codexThread?.cwd || session?.working_directory || binding.workingDirectory,
    binding,
    bridgeSessionId: binding.bridgeSessionId,
  };
}

function auditCommandBindingChange(
  store: BridgeStore,
  action: BindingChangeAction,
  msg: InboundMessage,
  fromBinding: ChannelBinding | null | undefined,
  toBinding: ChannelBinding | null | undefined,
  reason?: string,
): void {
  recordBindingChange(store, {
    action,
    address: msg.address,
    fromBinding,
    toBinding,
    messageId: msg.messageId,
    source: 'im_command',
    reason,
  });
}

function buildThreadCardRefresh(
  threadDisplay: CommandThreadDisplay,
  scope: ThreadCardScope | null | undefined,
  address: InboundMessage['address'],
  selectedId?: string | null,
): OutboundRichCard | undefined {
  if (scope === 'bound') {
    return threadDisplay.refreshedBoundThreadsCard(address.channelType, address.chatId, selectedId);
  }
  if (scope === 'global') {
    const bridgeBindings = threadDisplay.bridgeOnlyBoundThreadCardItems(address.channelType, address.chatId);
    return threadDisplay.refreshedCodexThreadsCard(
      listCommandCodexThreads(MAX_CODEX_THREAD_LIST_LIMIT),
      true,
      MAX_CODEX_THREAD_LIST_LIMIT,
      address.channelType,
      address.chatId,
      selectedId,
      bridgeBindings,
    );
  }
  return undefined;
}

async function reconcileMirrorSubscriptionsBestEffort(
  deps: SessionThreadCommandDeps,
  context: string,
): Promise<void> {
  if (!deps.reconcileMirrorSubscriptions) return;
  try {
    await deps.reconcileMirrorSubscriptions();
  } catch (error) {
    console.error(`[session-thread-command] Mirror reconcile failed during ${context}:`, error);
  }
}

export function buildStartCommandResponse(): string {
  return [
    'Codex to IM',
    '',
    '直接发送文本，就会继续当前聊天绑定的会话。',
    '',
    '常用流程',
    '1. /t 查看本地 Codex 会话',
    '2. /t 1 接管第 1 条本地 Codex 会话并设为当前线程',
    '3. /t add 2 可把更多本地 Codex 会话加入当前聊天',
    '4. /t ls 查看绑定，/t use 1 切换当前线程',
    '',
    '发送 /h 查看完整说明。',
  ].join('\n');
}

export function handleNewSessionCommand(options: {
  msg: InboundMessage;
  args: string;
  commandBinding: ChannelBinding | null;
  store: BridgeStore;
  deps: SessionThreadCommandDeps;
  threadDisplay: CommandThreadDisplay;
  markdown: boolean;
}): SessionThreadCommandResult {
  const parsedArgs = parseForceFlag(options.args);
  const blocked = guardBindingChangeWhileRunning(
    options.store,
    options.commandBinding,
    parsedArgs.force,
    options.deps,
    options.markdown,
  );
  if (blocked) return { response: blocked };
  const newSessionArgs = parseNewSessionArgs(parsedArgs.args);
  if ('error' in newSessionArgs) return { response: newSessionArgs.error };

  const currentSession = options.commandBinding
    ? options.store.getSession(options.commandBinding.bridgeSessionId)
    : null;
  const resolved = resolveNewSessionWorkingDirectory(newSessionArgs.pathArgs, options.commandBinding, currentSession);
  if (!resolved.ok) return { response: resolved.message };

  const workDir = resolved.workDir;
  ensureWorkingDirectoryExists(workDir);
  const binding = router.createBinding(options.msg.address, workDir, newSessionArgs.name);
  const session = options.store.getSession(binding.bridgeSessionId);
  auditCommandBindingChange(
    options.store,
    'new_session',
    options.msg,
    options.commandBinding,
    binding,
    parsedArgs.force ? 'forced' : undefined,
  );
  const notes = [
    parsedArgs.args.trim() ? '接下来直接发送文本即可继续。' : '已在当前工作目录下新建一个线程。接下来直接发送文本即可继续。',
    NEW_SESSION_ARG_RULE_NOTE,
    ...(parsedArgs.force
      ? ['如果当前聊天里已有旧任务在运行，它不会被终止，仍会在后台继续执行并可能稍后回消息。']
      : []),
    '这是 IM 侧线程，当前只保证在 IM 中可继续；不会自动出现在 Codex Native 会话列表中。',
  ];
  return {
    response: buildCommandFields(
      '已新建会话',
      [
        ['标题', options.threadDisplay.binding(binding).title],
        ['目录', formatCommandPath(binding.workingDirectory)],
        ['模式', formatSessionMode(binding, session)],
        ['Provider', formatSessionCodexProvider(session)],
      ],
      notes,
      options.markdown,
    ),
  };
}

export async function handleThreadBindingCommand(options: {
  msg: InboundMessage;
  args: string;
  store: BridgeStore;
  deps: SessionThreadCommandDeps;
  threadDisplay: CommandThreadDisplay;
  markdown: boolean;
}): Promise<SessionThreadCommandResult> {
  const parts = options.args.trim().split(/\s+/).filter(Boolean);
  const rawSubcommand = (parts[0] || '').toLowerCase();
  const subcommand = rawSubcommand === 'remove' ? 'rm' : rawSubcommand;
  const subArgs = parts.slice(1).join(' ');

  if (subcommand === 'ls') {
    const response = options.threadDisplay.chatBindingsResponse(options.msg.address.channelType, options.msg.address.chatId, options.markdown);
    const richCard = options.threadDisplay.refreshedBoundThreadsCard(options.msg.address.channelType, options.msg.address.chatId);
    return {
      response,
      richCard,
      threadTableCardScope: richCard ? 'bound' : undefined,
    };
  }

  if (subcommand === 'add') {
    const targetToken = subArgs.trim();
    if (!targetToken) {
      return { response: '用法：/t add <序号|thread-id|名称>。发送 `/t` 查看本地 Codex 会话，或发送 `/t ls` 查看已绑定线程。' };
    }
    const displayedThreads = listCommandCodexThreads(MAX_CODEX_THREAD_LIST_LIMIT);
    if (!displayedThreads) {
      return { response: '读取本地 Codex 会话列表失败，请稍后重试。' };
    }
    const decoratedThreads = options.threadDisplay.decorateCodexSessions(displayedThreads, options.msg.address.channelType, options.msg.address.chatId);
    const selected = selectCodexThreadForCommand(options.threadDisplay, targetToken, decoratedThreads);
    if (selected.ambiguous) {
      return { response: '匹配到多个本地 Codex 会话，请先发送 `/t` 查看列表，再用 `/t add 1` 这种序号添加。' };
    }
    if (!selected.threadId) {
      if (selected.index !== undefined) {
        return { response: `本地 Codex 会话列表没有第 ${selected.index} 条。先发送 \`/t\` 查看列表，或直接使用 thread id。` };
      }
      return { response: '没有找到对应的本地 Codex 会话。先发送 `/t` 查看列表，再用 `/t add 1` 添加。' };
    }

    const previousActive = options.store.getChannelBinding(options.msg.address.channelType, options.msg.address.chatId);
    let binding: ReturnType<typeof router.bindToCodexThread>;
    try {
      binding = router.bindToCodexThread(options.msg.address, selected.threadId, selected.thread ? {
        workingDirectory: selected.thread.cwd,
        codexTitle: getRawCodexTitle(selected.threadId, selected.thread.title),
        active: previousActive ? false : true,
      } : {
        active: previousActive ? false : true,
      });
    } catch (error) {
      return { response: toUserVisibleBindingError(error, '添加本地 Codex 会话失败。') };
    }
    const updatedBinding = options.store.listChannelBindings().find((item) => item.id === binding.id) || binding;
    auditCommandBindingChange(
      options.store,
      'add_codex',
      options.msg,
      previousActive,
      updatedBinding,
      previousActive ? 'added inactive' : 'added active',
    );
    const richCard = buildThreadCardRefresh(options.threadDisplay, options.deps.threadCardRefreshScope, options.msg.address, options.deps.threadCardSelectedId);
    return {
      response: buildCommandFields(
        updatedBinding.active !== false ? '已添加并激活线程' : '已添加绑定线程',
        [
          ['线程', options.threadDisplay.binding(updatedBinding).title],
          ['binding_id', options.threadDisplay.bindingShortId(updatedBinding)],
          ['thread_id', options.threadDisplay.bindingThreadId(updatedBinding) || '-'],
        ],
        updatedBinding.active !== false
          ? ['接下来直接发送文本即可继续。']
          : ['当前线程未改变。需要切换时发送 `/t use <序号|binding-id|thread-id|名称>`。'],
        options.markdown,
      ),
      richCard,
      threadTableCardScope: richCard && options.deps.threadCardRefreshScope ? options.deps.threadCardRefreshScope : undefined,
    };
  }

  if (subcommand === 'archive') {
    const targetToken = subArgs.trim();
    let target: {
      threadId?: string;
      title?: string;
      cwd?: string;
      index?: number;
      bridgeSessionId?: string;
    } = {};

    if (targetToken) {
      const displayedThreads = listCommandCodexThreads(MAX_CODEX_THREAD_LIST_LIMIT);
      if (!displayedThreads) {
        return { response: '读取本地 Codex 会话列表失败，请稍后重试。' };
      }
      const bindings = listBindingsForChat(options.store, options.msg.address.channelType, options.msg.address.chatId);
      const decoratedThreads = options.threadDisplay.decorateCodexSessions(displayedThreads, options.msg.address.channelType, options.msg.address.chatId);
      const selected = selectDirectThreadTarget(options.threadDisplay, targetToken, bindings, decoratedThreads);
      if (selected.ambiguous) {
        return { response: '匹配到多个本地 Codex 会话，请先发送 `/t` 查看列表，再用 `/t archive 1` 这种序号归档。' };
      }
      if (selected.binding) {
        const threadId = options.threadDisplay.bindingThreadId(selected.binding);
        if (!threadId) {
          const session = options.store.getSession(selected.binding.bridgeSessionId);
          if (!session) {
            return { response: '这个 Bridge 会话已经不存在。可发送 `/t ls` 刷新绑定列表。' };
          }
          const bindingsBeforeArchive = options.store.listChannelBindings()
            .filter((binding) => binding.bridgeSessionId === session.id);
          try {
            createCommandSessionRegistry(options.store).deleteBridgeSession(session.id);
          } catch (error) {
            return { response: toUserVisibleBindingError(error, '归档 Bridge 会话失败。') };
          }
          for (const binding of bindingsBeforeArchive) {
            options.deps.onBindingRemoved?.(binding);
          }
          await reconcileMirrorSubscriptionsBestEffort(options.deps, 'bridge archive');
          const activeAfterArchive = options.store.getChannelBinding(options.msg.address.channelType, options.msg.address.chatId);
          const richCard = buildThreadCardRefresh(options.threadDisplay, options.deps.threadCardRefreshScope, options.msg.address, options.deps.threadCardSelectedId);
          return {
            response: buildCommandFields(
              '已归档 Bridge 会话',
              [
                ['标题', getBridgeSessionDisplayTitle(session)],
                ['binding_id', options.threadDisplay.bindingShortId(selected.binding)],
                ['目录', formatCommandPath(selected.binding.workingDirectory || session.working_directory)],
                ['解除绑定', `${bindingsBeforeArchive.length}`],
                ['当前', activeAfterArchive ? options.threadDisplay.binding(activeAfterArchive).title : '未绑定'],
              ],
              activeAfterArchive
                ? ['Bridge 会话已直接删除，并自动切到当前聊天的其它绑定线程。']
                : ['Bridge 会话已直接删除；之后直接发送文本会自动进入临时草稿线程。'],
              options.markdown,
            ),
            richCard,
            threadTableCardScope: richCard && options.deps.threadCardRefreshScope ? options.deps.threadCardRefreshScope : undefined,
          };
        }
        const session = options.store.getSession(selected.binding.bridgeSessionId);
        target = {
          threadId,
          title: options.threadDisplay.binding(selected.binding).title,
          cwd: selected.binding.workingDirectory || session?.working_directory,
          bridgeSessionId: selected.binding.bridgeSessionId,
        };
      } else if (!selected.threadId) {
        const bridgeOnlyMatch = findBridgeOnlySessionByToken(options.store, targetToken);
        if (bridgeOnlyMatch.ambiguous) {
          return { response: '匹配到多个 Bridge 会话，请先发送 `/t` 查看列表，再使用更长的 bridge session id。' };
        }
        if (bridgeOnlyMatch.session) {
          const bindingsBeforeArchive = options.store.listChannelBindings()
            .filter((binding) => binding.bridgeSessionId === bridgeOnlyMatch.session!.id);
          try {
            createCommandSessionRegistry(options.store).deleteBridgeSession(bridgeOnlyMatch.session.id);
          } catch (error) {
            return { response: toUserVisibleBindingError(error, '归档 Bridge 会话失败。') };
          }
          for (const binding of bindingsBeforeArchive) {
            options.deps.onBindingRemoved?.(binding);
          }
          await reconcileMirrorSubscriptionsBestEffort(options.deps, 'bridge archive');
          const activeAfterArchive = options.store.getChannelBinding(options.msg.address.channelType, options.msg.address.chatId);
          const richCard = buildThreadCardRefresh(options.threadDisplay, options.deps.threadCardRefreshScope, options.msg.address, options.deps.threadCardSelectedId);
          return {
            response: buildCommandFields(
              '已归档 Bridge 会话',
              [
                ['标题', getBridgeSessionDisplayTitle(bridgeOnlyMatch.session)],
                ['bridge_session_id', bridgeOnlyMatch.session.id.slice(0, 8)],
                ['目录', formatCommandPath(bridgeOnlyMatch.session.working_directory)],
                ['解除绑定', `${bindingsBeforeArchive.length}`],
                ['当前', activeAfterArchive ? options.threadDisplay.binding(activeAfterArchive).title : '未绑定'],
              ],
              activeAfterArchive
                ? ['Bridge 会话已直接删除，并自动切到当前聊天的其它绑定线程。']
                : ['Bridge 会话已直接删除；之后直接发送文本会自动进入临时草稿线程。'],
              options.markdown,
            ),
            richCard,
            threadTableCardScope: richCard && options.deps.threadCardRefreshScope ? options.deps.threadCardRefreshScope : undefined,
          };
        }
        if (selected.index !== undefined) {
          return { response: `本地 Codex 会话列表没有第 ${selected.index} 条。先发送 \`/t\` 查看列表，或直接使用 thread id。` };
        }
        return { response: '没有找到对应的本地 Codex 或 Bridge 会话。先发送 `/t` 查看列表，再用 `/t archive 1` 或 `/t archive <binding_id>` 归档。' };
      } else {
        target = {
          threadId: selected.threadId,
          title: selected.thread?.title,
          cwd: selected.thread?.cwd,
          index: selected.index,
        };
      }
    } else {
      target = resolveCurrentCodexThreadTarget(options.store, options.threadDisplay, options.msg.address);
      if (!target.threadId) {
        return {
          response: target.bridgeSessionId
            ? '当前聊天绑定的不是本地 Codex 会话。请发送 `/t archive <序号|thread-id|名称>` 指定要归档的 Codex 会话。'
            : '当前聊天还没有绑定本地 Codex 会话。请发送 `/t archive <序号|thread-id|名称>` 指定要归档的 Codex 会话。',
        };
      }
    }

    const threadId = target.threadId;
    if (!threadId) {
      return { response: '没有找到对应的本地 Codex 会话。先发送 `/t` 查看列表，再用 `/t archive 1` 归档。' };
    }
    const bridgeSessionBeforeArchive = findBridgeSessionByCodexThread(options.store, threadId);
    const bindingsBeforeArchive = options.store.listChannelBindings()
      .filter((binding) => binding.bridgeSessionId === bridgeSessionBeforeArchive?.id);

    let result: ReturnType<SessionRegistryService['archiveCodexThread']>;
    try {
      result = createCommandSessionRegistry(options.store).archiveCodexThread(threadId);
    } catch (error) {
      return { response: toUserVisibleBindingError(error, '归档本地 Codex 会话失败。') };
    }

    for (const binding of bindingsBeforeArchive) {
      options.deps.onBindingRemoved?.(binding);
    }
    await reconcileMirrorSubscriptionsBestEffort(options.deps, 'codex archive');
    const activeAfterArchive = options.store.getChannelBinding(options.msg.address.channelType, options.msg.address.chatId);
    const richCard = buildThreadCardRefresh(options.threadDisplay, options.deps.threadCardRefreshScope, options.msg.address, options.deps.threadCardSelectedId);
    const title = target.title || (bridgeSessionBeforeArchive ? getBridgeSessionDisplayTitle(bridgeSessionBeforeArchive) : threadId.slice(0, 8));

    return {
      response: buildCommandFields(
        '已归档本地 Codex 会话',
        [
          ['标题', title],
          ['thread_id', threadId],
          ['目录', formatCommandPath(target.cwd || bridgeSessionBeforeArchive?.working_directory)],
          ['解除绑定', `${bindingsBeforeArchive.length}`],
          ['清理 Bridge 会话', `${result.deletedBridgeSessionIds.length}`],
          ['当前', activeAfterArchive ? options.threadDisplay.binding(activeAfterArchive).title : '未绑定'],
        ],
        activeAfterArchive
          ? ['已自动切到当前聊天的其它绑定线程。']
          : ['当前聊天已解除该 Codex 会话绑定；之后直接发送文本会自动进入临时草稿线程。'],
        options.markdown,
      ),
      richCard,
      threadTableCardScope: richCard && options.deps.threadCardRefreshScope ? options.deps.threadCardRefreshScope : undefined,
    };
  }

  if (subcommand === 'use') {
    const targetToken = subArgs.trim();
    if (!targetToken) {
      return { response: '用法：/t use <序号|binding-id|thread-id|名称>。发送 `/t ls` 查看已绑定线程。' };
    }
    const bindings = listBindingsForChat(options.store, options.msg.address.channelType, options.msg.address.chatId);
    const selected = options.threadDisplay.resolveBoundBindingSelection(bindings, targetToken);
    if (selected.ambiguous) {
      return { response: '匹配到多个绑定线程，请先发送 `/t ls` 查看列表，再用序号切换。' };
    }
    if (!selected.binding) {
      return {
        response: selected.index !== undefined
          ? `当前聊天只有 ${bindings.length} 个绑定线程，没有第 ${selected.index} 个。发送 \`/t ls\` 查看列表。`
          : '没有找到对应的绑定线程。发送 `/t ls` 查看列表。',
      };
    }
    const previousActive = options.store.getChannelBinding(options.msg.address.channelType, options.msg.address.chatId);
    const updatedBinding = setActiveBindingForChat(options.store, selected.binding.id);
    auditCommandBindingChange(
      options.store,
      'use_binding',
      options.msg,
      previousActive,
      updatedBinding,
    );
    const richCard = buildThreadCardRefresh(options.threadDisplay, options.deps.threadCardRefreshScope, options.msg.address, options.deps.threadCardSelectedId);
    return {
      response: buildCommandFields(
        '当前线程已切换',
        [
          ...(previousActive && previousActive.id !== updatedBinding.id
            ? [['原线程', options.threadDisplay.binding(previousActive).title] as [string, string]]
            : []),
          ['当前', options.threadDisplay.binding(updatedBinding).title],
          ['binding_id', options.threadDisplay.bindingShortId(updatedBinding)],
          ['thread_id', options.threadDisplay.bindingThreadId(updatedBinding) || '-'],
        ],
        ['接下来直接发送文本即可继续。'],
        options.markdown,
      ),
      richCard,
      threadTableCardScope: richCard && options.deps.threadCardRefreshScope ? options.deps.threadCardRefreshScope : undefined,
    };
  }

  if (subcommand === 'rm') {
    const parsedArgs = parseForceFlag(subArgs);
    const targetToken = parsedArgs.args;
    if (!targetToken) {
      return { response: '用法：/t rm <序号|binding-id|thread-id|名称>。发送 `/t ls` 查看已绑定线程。' };
    }
    const bindings = listBindingsForChat(options.store, options.msg.address.channelType, options.msg.address.chatId);
    const selected = options.threadDisplay.resolveBoundBindingSelection(bindings, targetToken);
    if (selected.ambiguous) {
      return { response: '匹配到多个绑定线程，请先发送 `/t ls` 查看列表，再用序号移除。' };
    }
    if (!selected.binding) {
      return {
        response: selected.index !== undefined
          ? `当前聊天只有 ${bindings.length} 个绑定线程，没有第 ${selected.index} 个。发送 \`/t ls\` 查看列表。`
          : '没有找到对应的绑定线程。发送 `/t ls` 查看列表。',
      };
    }
    const blocked = guardBindingChangeWhileRunning(
      options.store,
      selected.binding,
      parsedArgs.force,
      options.deps,
      options.markdown,
    );
    if (blocked) return { response: blocked };

    const previousActive = options.store.getChannelBinding(options.msg.address.channelType, options.msg.address.chatId);
    options.store.deleteChannelBinding(selected.binding.id);
    options.deps.onBindingRemoved?.(selected.binding);
    const nextActive = options.store.getChannelBinding(options.msg.address.channelType, options.msg.address.chatId);
    auditCommandBindingChange(
      options.store,
      'remove_binding',
      options.msg,
      selected.binding,
      nextActive,
      parsedArgs.force ? 'forced' : undefined,
    );
    await reconcileMirrorSubscriptionsBestEffort(options.deps, 'binding remove');
    const richCard = buildThreadCardRefresh(options.threadDisplay, options.deps.threadCardRefreshScope, options.msg.address, options.deps.threadCardSelectedId);
    return {
      response: buildCommandFields(
        '已移除绑定线程',
        [
          ['移除', options.threadDisplay.binding(selected.binding).title],
          ['当前', nextActive ? options.threadDisplay.binding(nextActive).title : '未绑定'],
        ],
        nextActive
          ? ['已自动将另一个绑定线程设为当前。']
          : ['当前聊天已没有绑定线程。之后直接发送文本会自动进入新的临时草稿线程。'],
        options.markdown,
      ),
      richCard,
      threadTableCardScope: richCard && options.deps.threadCardRefreshScope ? options.deps.threadCardRefreshScope : undefined,
    };
  }

  if (subcommand === 'rename') {
    const binding = options.store.getChannelBinding(options.msg.address.channelType, options.msg.address.chatId);
    if (!binding) {
      return { response: '当前聊天还没有绑定线程，无法重命名。' };
    }
    const parsed = validateThreadName(subArgs);
    if (!parsed.ok) {
      return { response: parsed.message };
    }
    const session = options.store.getSession(binding.bridgeSessionId);
    if (!session) {
      return { response: '当前会话不存在，无法重命名。' };
    }
    options.threadDisplay.renameBinding(binding, parsed.name);
    return {
      response: buildCommandFields(
        '当前线程已重命名',
        [
          ['新标题', parsed.name],
          ['binding_id', options.threadDisplay.bindingShortId(binding)],
          ['thread_id', options.threadDisplay.bindingThreadId(binding) || '-'],
        ],
        [],
        options.markdown,
      ),
    };
  }

  return { response: '用法：/t、/t ls、/t add <序号|thread-id|名称>、/t archive [序号|thread-id|名称]、/t use <序号|binding-id|thread-id|名称>、/t rm/remove <序号|binding-id|thread-id|名称>、/t rename <名称>' };
}

export async function handleThreadSwitchCommand(options: {
  msg: InboundMessage;
  args: string;
  currentBinding: ChannelBinding | null;
  commandBinding: ChannelBinding | null;
  store: BridgeStore;
  deps: SessionThreadCommandDeps;
  threadDisplay: CommandThreadDisplay;
  markdown: boolean;
}): Promise<SessionThreadCommandResult> {
  const parsedArgs = parseForceFlag(options.args);
  const threadArgs = parsedArgs.args;
  if (threadArgs === '0' || threadArgs === '0 reset') {
    const blocked = guardBindingChangeWhileRunning(
      options.store,
      options.commandBinding,
      parsedArgs.force,
      options.deps,
      options.markdown,
    );
    if (blocked) return { response: blocked };

    const draftSession = threadArgs === '0 reset'
      ? resetDraftSession(options.msg.address)
      : getOrCreateDraftSession(options.store, options.msg.address);
    const binding = router.bindToSession(options.msg.address, draftSession.id);
    if (!binding) {
      return { response: '草稿线程切换失败。' };
    }
    router.updateBinding(binding.id, {
      mode: 'normal',
      workingDirectory: draftSession.working_directory,
      model: draftSession.model || binding.model,
    });
    const updatedBinding = options.store.getChannelBinding(options.msg.address.channelType, options.msg.address.chatId) || binding;
    auditCommandBindingChange(
      options.store,
      'switch_draft',
      options.msg,
      options.commandBinding,
      updatedBinding,
      [
        threadArgs === '0 reset' ? 'reset' : null,
        parsedArgs.force ? 'forced' : null,
      ].filter(Boolean).join(', ') || undefined,
    );
    return {
      response: buildCommandFields(
        threadArgs === '0 reset' ? '已重置临时草稿线程' : '已切换到临时草稿线程',
        [
          ['标题', getSessionDisplayName(draftSession, draftSession.working_directory)],
          ['目录', formatCommandPath(draftSession.working_directory)],
          ['过期时间', formatCommandDateTime(draftSession.expires_at)],
          ['模式', 'normal'],
        ],
        ['这是隐藏的草稿线程，不会出现在常规会话列表中。'],
        options.markdown,
      ),
    };
  }

  if (!threadArgs) {
    return { response: `用法：/thread <序号>，或 /thread 0 进入临时草稿线程；发送 /t 查看最近 ${DEFAULT_CODEX_THREAD_LIST_LIMIT} 条文本列表和最多 ${MAX_CODEX_THREAD_LIST_LIMIT} 条卡片列表，或 /t n 100 查看最近 100 条本地 Codex 会话` };
  }
  if (threadArgs === 'all') {
    const codexSessions = listCommandCodexThreads(MAX_CODEX_THREAD_LIST_LIMIT);
    if (!codexSessions) {
      return { response: '读取本地 Codex 会话列表失败，请稍后重试。' };
    }
    const bridgeBindings = options.threadDisplay.bridgeOnlyBoundThreadCardItems(options.msg.address.channelType, options.msg.address.chatId);
    if (codexSessions.length === 0 && bridgeBindings.length === 0) {
      return { response: '没有找到本地 Codex 会话。先在 本机 Codex 中打开一个会话，再回来试一次。' };
    }
    const decoratedSessions = options.threadDisplay.decorateCodexSessions(codexSessions, options.msg.address.channelType, options.msg.address.chatId);
    return {
      response: buildCodexThreadsCommandResponse(
        decoratedSessions,
        options.markdown,
        true,
        MAX_CODEX_THREAD_LIST_LIMIT,
        options.threadDisplay.codexBindingStates(options.msg.address.channelType, options.msg.address.chatId),
        bridgeBindings,
      ),
      richCard: options.threadDisplay.refreshedCodexThreadsCard(
        decoratedSessions,
        true,
        MAX_CODEX_THREAD_LIST_LIMIT,
        options.msg.address.channelType,
        options.msg.address.chatId,
        undefined,
        bridgeBindings,
      ),
      threadTableCardScope: 'global',
    };
  }

  const blocked = guardBindingChangeWhileRunning(
    options.store,
    options.commandBinding,
    parsedArgs.force,
    options.deps,
    options.markdown,
  );
  if (blocked) return { response: blocked };

  const displayedThreads = listCommandCodexThreads(MAX_CODEX_THREAD_LIST_LIMIT);
  if (!displayedThreads) {
    return { response: '读取本地 Codex 会话列表失败，请稍后重试。' };
  }
  const decoratedThreads = options.threadDisplay.decorateCodexSessions(displayedThreads, options.msg.address.channelType, options.msg.address.chatId);
  const bindings = listBindingsForChat(options.store, options.msg.address.channelType, options.msg.address.chatId);
  const selected = selectDirectThreadTarget(options.threadDisplay, threadArgs, bindings, decoratedThreads);
  if (selected.ambiguous) {
    return { response: '匹配到多个本地 Codex 会话，请先发送 `/t` 查看列表，再用 `/t 1` 这种序号切换。' };
  }
  if (selected.binding) {
    const previousActive = options.store.getChannelBinding(options.msg.address.channelType, options.msg.address.chatId);
    const updatedBinding = setActiveBindingForChat(options.store, selected.binding.id);
    auditCommandBindingChange(
      options.store,
      'use_binding',
      options.msg,
      previousActive,
      updatedBinding,
      parsedArgs.force ? 'forced' : undefined,
    );
    const richCard = buildThreadCardRefresh(options.threadDisplay, options.deps.threadCardRefreshScope, options.msg.address, options.deps.threadCardSelectedId);
    return {
      response: buildCommandFields(
        '当前线程已切换',
        [
          ...(previousActive && previousActive.id !== updatedBinding.id
            ? [['原线程', options.threadDisplay.binding(previousActive).title] as [string, string]]
            : []),
          ['当前', options.threadDisplay.binding(updatedBinding).title],
          ['binding_id', options.threadDisplay.bindingShortId(updatedBinding)],
          ['thread_id', options.threadDisplay.bindingThreadId(updatedBinding) || '-'],
        ],
        ['接下来直接发送文本即可继续。'],
        options.markdown,
      ),
      richCard,
      threadTableCardScope: richCard && options.deps.threadCardRefreshScope ? options.deps.threadCardRefreshScope : undefined,
    };
  }
  if (!selected.threadId) {
    if (selected.index !== undefined) {
      return {
        response: displayedThreads.length > 0
          ? `当前只找到 ${displayedThreads.length} 条本地 Codex 会话，没有第 ${selected.index} 条。先发送 \`/t\` 查看最多 ${MAX_CODEX_THREAD_LIST_LIMIT} 条卡片列表后再选择。`
          : '没有找到本地 Codex 会话。先在 本机 Codex 中打开一个会话，再回来试一次。',
      };
    }
    return { response: '没有找到对应的本地 Codex 会话。先发送 `/t` 查看列表，再用 `/t 1` 接管。' };
  }
  if (!selected.thread) {
    let binding: ReturnType<typeof router.bindToCodexThread>;
    try {
      binding = router.bindToCodexThread(options.msg.address, selected.threadId);
    } catch (error) {
      return { response: toUserVisibleBindingError(error, '切换本地 Codex 会话失败。') };
    }
    auditCommandBindingChange(
      options.store,
      'switch_codex',
      options.msg,
      options.currentBinding,
      binding,
      parsedArgs.force ? 'forced' : undefined,
    );
    const richCard = buildThreadCardRefresh(options.threadDisplay, options.deps.threadCardRefreshScope, options.msg.address, options.deps.threadCardSelectedId);
    return {
      response: buildCommandFields(
        '已切换到本地 Codex 会话',
        [
          ['标题', options.threadDisplay.binding(binding).title],
          ['binding_id', options.threadDisplay.bindingShortId(binding)],
          ['thread_id', options.threadDisplay.bindingThreadId(binding) || selected.threadId],
          ['目录', formatCommandPath(binding.workingDirectory)],
        ],
        ['接下来直接发送文本即可继续。'],
        options.markdown,
      ),
      richCard,
      threadTableCardScope: richCard && options.deps.threadCardRefreshScope ? options.deps.threadCardRefreshScope : undefined,
    };
  }

  let binding: ReturnType<typeof router.bindToCodexThread>;
  try {
    binding = router.bindToCodexThread(options.msg.address, selected.thread.threadId, {
      workingDirectory: selected.thread.cwd,
      codexTitle: getRawCodexTitle(selected.thread.threadId, selected.thread.title),
    });
  } catch (error) {
    return { response: toUserVisibleBindingError(error, '切换本地 Codex 会话失败。') };
  }
  auditCommandBindingChange(
    options.store,
    'switch_codex',
    options.msg,
    options.commandBinding,
    binding,
    parsedArgs.force ? 'forced' : undefined,
  );
  const richCard = buildThreadCardRefresh(options.threadDisplay, options.deps.threadCardRefreshScope, options.msg.address, options.deps.threadCardSelectedId);
  return {
    response: buildCommandFields(
      '已切换到本地 Codex 会话',
      [
        ['标题', options.threadDisplay.binding(binding).title],
        ['binding_id', options.threadDisplay.bindingShortId(binding)],
        ['thread_id', options.threadDisplay.bindingThreadId(binding) || selected.thread.threadId],
        ['目录', formatCommandPath(binding.workingDirectory)],
      ],
      ['接下来直接发送文本即可继续。'],
      options.markdown,
    ),
    richCard,
    threadTableCardScope: richCard && options.deps.threadCardRefreshScope ? options.deps.threadCardRefreshScope : undefined,
  };
}

export function handleCodexThreadsCommand(options: {
  msg: InboundMessage;
  args: string;
  threadDisplay: CommandThreadDisplay;
  markdown: boolean;
}): SessionThreadCommandResult {
  const listArgs = parseCodexThreadListArgs(options.args);
  if (!listArgs) {
    return { response: `用法：/threads、/threads all、/threads n 100（最多 ${MAX_CODEX_THREAD_LIST_LIMIT} 条）` };
  }
  const { showAll, limit } = listArgs;
  const textCodexSessions = listCommandCodexThreads(limit);
  if (!textCodexSessions) {
    return { response: '读取本地 Codex 会话列表失败，请稍后重试。' };
  }
  const bridgeBindings = options.threadDisplay.bridgeOnlyBoundThreadCardItems(options.msg.address.channelType, options.msg.address.chatId);
  if (textCodexSessions.length === 0 && bridgeBindings.length === 0) {
    return {
      response: showAll
        ? '没有找到本地 Codex 会话。先在 本机 Codex 中打开一个会话，再回来试一次。'
        : '没有找到本地 Codex 会话。先在 本机 Codex 中打开一个会话，再回来试一次。',
    };
  }
  const isDefaultListRequest = options.args.trim() === '';
  const cardShowAll = isDefaultListRequest || showAll;
  const cardLimit = isDefaultListRequest ? MAX_CODEX_THREAD_LIST_LIMIT : limit;
  const cardCodexSessions = cardLimit === limit
    ? textCodexSessions
    : listCommandCodexThreads(cardLimit);
  const bindingStates = options.threadDisplay.codexBindingStates(options.msg.address.channelType, options.msg.address.chatId);
  const decoratedTextSessions = options.threadDisplay.decorateCodexSessions(textCodexSessions, options.msg.address.channelType, options.msg.address.chatId);
  const decoratedCardSessions = cardCodexSessions
    ? options.threadDisplay.decorateCodexSessions(cardCodexSessions, options.msg.address.channelType, options.msg.address.chatId)
    : null;
  const cardLimitNotice = decoratedCardSessions && cardLimit !== limit
    ? buildCodexThreadLimitNotice(decoratedCardSessions.length, cardLimit)
    : null;
  const richCard = options.threadDisplay.refreshedCodexThreadsCard(
    decoratedCardSessions || [],
    cardShowAll,
    cardLimit,
    options.msg.address.channelType,
    options.msg.address.chatId,
    undefined,
    bridgeBindings,
  );
  return {
    response: buildCodexThreadsCommandResponse(
      decoratedTextSessions,
      options.markdown,
      showAll,
      limit,
      bindingStates,
      bridgeBindings,
      cardLimitNotice ? [cardLimitNotice] : [],
    ),
    richCard,
    threadTableCardScope: richCard ? 'global' : undefined,
  };
}
