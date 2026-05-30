import type { CodexSessionSummary } from '../../codex/session-index.js';
import { getCodexSessionByThreadIdSafe } from './bridge-session-support.js';
import {
  bridgeSessionExecutionProvider,
  buildCodexThreadDisplaySummary,
  findVisibleBridgeSessionByCodexThread,
  getBridgeSessionDisplayTitle,
} from './display/session-display-query.js';
import {
  resolveCreatorKind,
  type CodexSourceSummary,
  type CreatorKind,
} from './display/session-creator.js';
import {
  getSessionDisplayName,
  stripLegacySessionPrefix,
} from './display/session-title.js';
import type { BridgeStore } from './host.js';
import type { ChannelBinding } from './types.js';
import { getCodexThreadId } from './turns/turn-classifier.js';

export interface ThreadDisplayInfo {
  title: string;
  threadId: string;
  cwd: string;
  lastActiveAt?: string;
  originator?: string;
  bridgeSessionId?: string;
  creatorKind?: CreatorKind;
  codexSource?: CodexSourceSummary;
  executionProvider?: string;
}

export interface ThreadTitleOptions {
  stripInternalPrefix?: boolean;
}

export interface BindingSelection {
  binding?: ChannelBinding;
  ambiguous?: boolean;
  index?: number;
}

export interface CodexThreadSelection {
  thread?: CodexSessionSummary;
  threadId?: string;
  ambiguous?: boolean;
  index?: number;
}

export class ThreadDisplayService {
  constructor(private readonly store: BridgeStore) {}

  bindingThreadId(binding: ChannelBinding): string {
    const session = this.store.getSession(binding.bridgeSessionId);
    return getCodexThreadId(session, binding) || '';
  }

  bindingShortId(binding: ChannelBinding): string {
    return binding.id.slice(0, 8);
  }

  binding(binding: ChannelBinding, options: ThreadTitleOptions = {}): ThreadDisplayInfo {
    const session = this.store.getSession(binding.bridgeSessionId);
    const threadId = this.bindingThreadId(binding);
    const codexSession = threadId ? getCodexSessionByThreadIdSafe(threadId, 'thread display binding') : null;
    const sessionForTitle = session && !session.codex_title?.trim() && codexSession?.title
      ? { ...session, codex_title: codexSession.title }
      : session;
    const title = this.resolveTitle({
      sessionName: sessionForTitle ? getBridgeSessionDisplayTitle(sessionForTitle) : undefined,
      sessionId: session?.id || binding.bridgeSessionId,
      threadId,
      codexTitle: session?.codex_title || codexSession?.title,
      fallback: getSessionDisplayName(session, binding.workingDirectory) || binding.bridgeSessionId.slice(0, 8),
    });
    const codexSource = codexSession ? codexSessionSource(codexSession) : undefined;
    return {
      title: formatResolvedThreadTitle(title, options),
      threadId,
      cwd: binding.workingDirectory || codexSession?.cwd || '',
      lastActiveAt: codexSession?.lastEventAt || session?.last_progress_at || session?.updated_at || binding.updatedAt,
      originator: codexSession?.originator || '当前聊天',
      bridgeSessionId: session?.id || binding.bridgeSessionId,
      creatorKind: codexSession ? resolveCreatorKind(codexSource || {}) : 'bridge',
      codexSource,
      executionProvider: bridgeSessionExecutionProvider(session),
    };
  }

  codex(session: CodexSessionSummary, binding?: ChannelBinding, options: ThreadTitleOptions = {}): ThreadDisplayInfo {
    const bindingDisplay = binding ? this.binding(binding, options) : null;
    const linkedBridgeSession = binding
      ? this.store.getSession(binding.bridgeSessionId) || undefined
      : findVisibleBridgeSessionByCodexThread(this.store, session.threadId);
    const linkedForTitle = linkedBridgeSession && !linkedBridgeSession.codex_title?.trim()
      ? { ...linkedBridgeSession, codex_title: session.title }
      : linkedBridgeSession;
    const summary = buildCodexThreadDisplaySummary(session, linkedForTitle);
    const title = this.resolveTitle({
      sessionName: linkedForTitle ? getBridgeSessionDisplayTitle(linkedForTitle) : undefined,
      sessionId: linkedForTitle?.id || binding?.bridgeSessionId,
      threadId: session.threadId,
      codexTitle: linkedBridgeSession?.codex_title || session.title,
      fallback: session.cwd || session.threadId.slice(0, 8),
    });
    return {
      title: formatResolvedThreadTitle(title, options),
      threadId: session.threadId,
      cwd: session.cwd || bindingDisplay?.cwd || '',
      lastActiveAt: session.lastEventAt || bindingDisplay?.lastActiveAt,
      originator: session.originator || bindingDisplay?.originator || 'Codex Native',
      bridgeSessionId: bindingDisplay?.bridgeSessionId || linkedBridgeSession?.id,
      creatorKind: summary.creatorKind,
      codexSource: summary.codexSource,
      executionProvider: bindingDisplay?.executionProvider || summary.executionProvider,
    };
  }

  thread(threadId: string, sessionId?: string | null, options: ThreadTitleOptions = {}): ThreadDisplayInfo {
    const session = sessionId
      ? this.store.getSession(sessionId)
      : findVisibleBridgeSessionByCodexThread(this.store, threadId) || null;
    const codexSession = getCodexSessionByThreadIdSafe(threadId, 'thread display thread') || null;
    const sessionForTitle = session && !session.codex_title?.trim() && codexSession?.title
      ? { ...session, codex_title: codexSession.title }
      : session;
    const title = this.resolveTitle({
      sessionName: sessionForTitle ? getBridgeSessionDisplayTitle(sessionForTitle) : undefined,
      sessionId: session?.id,
      threadId,
      codexTitle: session?.codex_title || codexSession?.title,
      fallback: codexSession?.cwd || threadId.slice(0, 8),
    });
    const codexSource = codexSession ? codexSessionSource(codexSession) : undefined;
    return {
      title: formatResolvedThreadTitle(title, options),
      threadId,
      cwd: session?.working_directory || codexSession?.cwd || '',
      lastActiveAt: codexSession?.lastEventAt || session?.last_progress_at || session?.updated_at,
      originator: codexSession?.originator || 'Codex Native',
      bridgeSessionId: session?.id,
      creatorKind: codexSession ? resolveCreatorKind(codexSource || {}) : (session ? 'bridge' : 'native'),
      codexSource,
      executionProvider: bridgeSessionExecutionProvider(session),
    };
  }

  resolveBoundBindingSelection(bindings: ChannelBinding[], raw: string): BindingSelection {
    const token = raw.trim();
    const lowerToken = token.toLowerCase();
    const index = /^\d+$/.test(token) ? Number(token) : null;
    if (index !== null) {
      if (!Number.isInteger(index) || index < 1) return {};
      return { binding: bindings[index - 1], index };
    }

    const bindingMatches = bindings.filter((binding) => (
      binding.id.toLowerCase() === lowerToken
      || binding.id.toLowerCase().startsWith(lowerToken)
      || binding.bridgeSessionId.toLowerCase() === lowerToken
      || binding.bridgeSessionId.toLowerCase().startsWith(lowerToken)
    ));
    if (bindingMatches.length > 1) return { ambiguous: true };
    if (bindingMatches.length === 1) return { binding: bindingMatches[0] };

    const threadMatches = bindings.filter((binding) => {
      const threadId = this.bindingThreadId(binding);
      return Boolean(threadId && (threadId.toLowerCase() === lowerToken || threadId.toLowerCase().startsWith(lowerToken)));
    });
    if (threadMatches.length > 1) return { ambiguous: true };
    if (threadMatches.length === 1) return { binding: threadMatches[0] };

    const nameMatches = bindings.filter((binding) => this.binding(binding).title.trim() === token);
    if (nameMatches.length > 1) return { ambiguous: true };
    return { binding: nameMatches[0] };
  }

  selectCodexThread(raw: string, displayedThreads: CodexSessionSummary[]): CodexThreadSelection {
    const token = raw.trim();
    const lowerToken = token.toLowerCase();
    const index = /^\d+$/.test(token) ? Number(token) : null;
    if (index !== null) {
      return displayedThreads[index - 1]
        ? { thread: displayedThreads[index - 1], threadId: displayedThreads[index - 1].threadId, index }
        : { index };
    }

    const exactThread = displayedThreads.find((session) => session.threadId.toLowerCase() === lowerToken);
    if (exactThread) return { thread: exactThread, threadId: exactThread.threadId };

    const prefixMatches = displayedThreads.filter((session) => session.threadId.toLowerCase().startsWith(lowerToken));
    if (prefixMatches.length > 1) return { ambiguous: true };
    if (prefixMatches.length === 1) return { thread: prefixMatches[0], threadId: prefixMatches[0].threadId };

    const nameMatches = displayedThreads.filter((session) => session.title.trim() === token);
    if (nameMatches.length > 1) return { ambiguous: true };
    if (nameMatches.length === 1) return { thread: nameMatches[0], threadId: nameMatches[0].threadId };
    return {};
  }

  renameBinding(binding: ChannelBinding, name: string): void {
    const session = this.store.getSession(binding.bridgeSessionId);
    if (!session) throw new Error('Session not found.');
    this.store.updateSession(session.id, { name });
  }

  private resolveTitle(options: {
    sessionName?: string | null;
    sessionId?: string;
    threadId?: string;
    codexTitle?: string | null;
    fallback: string;
  }): string {
    return options.sessionName?.trim()
      || options.codexTitle?.trim()
      || options.fallback.trim()
      || '未命名线程';
  }
}

function formatResolvedThreadTitle(value: string, options: ThreadTitleOptions): string {
  const withoutLegacyPrefix = stripLegacySessionPrefix(value);
  const title = options.stripInternalPrefix ? stripInternalSessionPrefix(withoutLegacyPrefix) : withoutLegacyPrefix;
  return stripLegacySessionPrefix(title);
}

function codexSessionSource(session: CodexSessionSummary): CodexSourceSummary {
  return {
    originator: session.originator || undefined,
    source: session.source || undefined,
    cliVersion: session.cliVersion || undefined,
  };
}

function stripInternalSessionPrefix(value: string): string {
  return value.replace(/^(Bridge|Desktop):\s*/i, '').trim() || value;
}
