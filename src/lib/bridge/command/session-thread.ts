import { getOrCreateDraftSession } from '../../../internal-sessions.js';
import {
  listBindingsForChat,
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
  getCommandCodexThreadByIdSafe,
  listCommandCodexThreads,
  type CodexSessionSummary,
} from './session-source.js';
import { getSessionDisplayName } from '../display/session-title.js';
import type { ChannelBinding, InboundMessage, OutboundRichCard } from '../types.js';
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
    return threadDisplay.refreshedCodexThreadsCard(
      listCommandCodexThreads(DEFAULT_CODEX_THREAD_LIST_LIMIT),
      false,
      DEFAULT_CODEX_THREAD_LIST_LIMIT,
      address.channelType,
      address.chatId,
      selectedId,
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
    '1. /t 查看最近本地 Codex 会话',
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

  const currentSession = options.commandBinding
    ? options.store.getSession(options.commandBinding.bridgeSessionId)
    : null;
  const resolved = resolveNewSessionWorkingDirectory(parsedArgs.args, options.commandBinding, currentSession);
  if (!resolved.ok) return { response: resolved.message };

  const workDir = resolved.workDir;
  ensureWorkingDirectoryExists(workDir);
  const binding = router.createBinding(options.msg.address, workDir);
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
      return { response: '用法：/t add <序号|thread-id|名称>。发送 `/t` 查看最近本地 Codex 会话，或发送 `/t ls` 查看已绑定线程。' };
    }
    const displayedThreads = listCommandCodexThreads(DEFAULT_CODEX_THREAD_LIST_LIMIT);
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
        return { response: `最近本地 Codex 会话列表没有第 ${selected.index} 条。先发送 \`/t\` 查看最近会话，或直接使用 thread id。` };
      }
      return { response: '没有找到对应的本地 Codex 会话。先发送 `/t` 查看最近会话，再用 `/t add 1` 添加。' };
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

  return { response: '用法：/t、/t ls、/t add <序号|thread-id|名称>、/t use <序号|binding-id|thread-id|名称>、/t rm/remove <序号|binding-id|thread-id|名称>、/t rename <名称>' };
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
    return { response: `用法：/thread <序号>，或 /thread 0 进入临时草稿线程；发送 /t all 查看最多 ${MAX_CODEX_THREAD_LIST_LIMIT} 条，或 /t n 100 查看最近 100 条本地 Codex 会话` };
  }
  if (threadArgs === 'all') {
    const codexSessions = listCommandCodexThreads(MAX_CODEX_THREAD_LIST_LIMIT);
    if (!codexSessions) {
      return { response: '读取本地 Codex 会话列表失败，请稍后重试。' };
    }
    if (codexSessions.length === 0) {
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
      ),
      richCard: options.threadDisplay.refreshedCodexThreadsCard(
        decoratedSessions,
        true,
        MAX_CODEX_THREAD_LIST_LIMIT,
        options.msg.address.channelType,
        options.msg.address.chatId,
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
          ? `当前只找到 ${displayedThreads.length} 条本地 Codex 会话，没有第 ${selected.index} 条。先发送 \`/t\` 查看最近会话，或发送 \`/t all\` 查看更多后再选择。`
          : '没有找到本地 Codex 会话。先在 本机 Codex 中打开一个会话，再回来试一次。',
      };
    }
    return { response: '没有找到对应的本地 Codex 会话。先发送 `/t` 查看最近会话，再用 `/t 1` 接管。' };
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
  const codexSessions = listCommandCodexThreads(limit);
  if (!codexSessions) {
    return { response: '读取本地 Codex 会话列表失败，请稍后重试。' };
  }
  if (codexSessions.length === 0) {
    return {
      response: showAll
        ? '没有找到本地 Codex 会话。先在 本机 Codex 中打开一个会话，再回来试一次。'
        : '没有找到最近本地 Codex 会话。先在 本机 Codex 中打开一个会话，再回来试一次。',
    };
  }
  const decoratedSessions = options.threadDisplay.decorateCodexSessions(codexSessions, options.msg.address.channelType, options.msg.address.chatId);
  return {
    response: buildCodexThreadsCommandResponse(
      decoratedSessions,
      options.markdown,
      showAll,
      limit,
      options.threadDisplay.codexBindingStates(options.msg.address.channelType, options.msg.address.chatId),
    ),
    richCard: options.threadDisplay.refreshedCodexThreadsCard(
      decoratedSessions,
      showAll,
      limit,
      options.msg.address.channelType,
      options.msg.address.chatId,
    ),
    threadTableCardScope: 'global',
  };
}
