import fs from 'node:fs';
import path from 'node:path';

import { CTI_HOME } from '../../config.js';
import type { DesktopSessionSummary } from '../../desktop-sessions.js';
import { getDesktopSessionByThreadIdSafe } from './bridge-session-support.js';
import {
  buildBoundThreadsCommandCard,
  buildCommandFields,
  buildDesktopThreadsCommandCard,
  formatCommandPath,
  getSessionDisplayName,
  stripDesktopSessionPrefix,
  type BoundThreadCardItem,
  type DesktopThreadCardBindingState,
} from './command-formatters.js';
import type { BridgeStore } from './host.js';
import { buildFencedCodeBlock } from './markdown/fence.js';
import type { ChannelBinding } from './types.js';
import { getCodexThreadId, getExplicitDesktopThreadId } from './turns/turn-classifier.js';
import { listBindingsForChat } from '../../session-bindings.js';

interface UiSessionMetaEntry {
  name?: string;
}

export interface ThreadDisplayInfo {
  title: string;
  threadId: string;
  cwd: string;
  originator?: string;
}

export interface ThreadTitleOptions {
  stripInternalPrefix?: boolean;
}

export interface BindingSelection {
  binding?: ChannelBinding;
  ambiguous?: boolean;
  index?: number;
}

export interface DesktopThreadSelection {
  thread?: DesktopSessionSummary;
  threadId?: string;
  ambiguous?: boolean;
  index?: number;
}

export class ThreadDisplayService {
  private readonly uiSessionMetaPath: string;
  private uiSessionMeta: Record<string, UiSessionMetaEntry> | null = null;

  constructor(private readonly store: BridgeStore, options: { uiSessionMetaPath?: string } = {}) {
    this.uiSessionMetaPath = options.uiSessionMetaPath || path.join(CTI_HOME, 'data', 'ui-session-meta.json');
  }

  chatBindingsResponse(channelType: string, chatId: string, markdown: boolean): string {
    const bindings = listBindingsForChat(this.store, channelType, chatId);
    if (bindings.length === 0) {
      return buildCommandFields(
        '当前聊天绑定',
        [],
        ['还没有绑定线程。发送 `/t` 查看最近桌面会话，再用 `/t add 1` 添加。'],
        markdown,
      );
    }

    const lines = bindings.map((binding, index) => {
      const display = this.binding(binding);
      const marker = binding.active !== false ? '*' : ' ';
      return `${marker} ${index + 1}. ${display.title}  thread=${display.threadId || '-'}  binding=${this.bindingShortId(binding)}  cwd=${display.cwd || '(no cwd)'}`;
    });

    return [
      buildCommandFields(
        '当前聊天绑定',
        [
          ['数量', `${bindings.length}`],
          ['当前', bindings.find((binding) => binding.active !== false) ? '已标记 *' : '未设置'],
        ],
        [
          '`/t use <序号|thread-id|binding-id|名称>` 切换当前线程；`/t rm <序号|thread-id|binding-id|名称>` 移除绑定；`/t rename <名称>` 重命名当前线程。',
          '`/t use` 和 `/t rm` 的序号来自 `/t ls` 的局部绑定表；`/t` 和 `/t add` 的序号来自全局桌面会话表。',
        ],
        markdown,
      ),
      markdown ? buildFencedCodeBlock(lines.join('\n'), 'text') : lines.join('\n'),
    ].join('\n\n').trim();
  }

  refreshedDesktopThreadsCard(
    desktopSessions: DesktopSessionSummary[] | null | undefined,
    showAll: boolean,
    limit: number,
    channelType: string,
    chatId: string,
  ) {
    if (!desktopSessions || desktopSessions.length === 0) return undefined;
    return buildDesktopThreadsCommandCard(
      this.decorateDesktopSessions(desktopSessions, channelType, chatId),
      showAll,
      limit,
      this.desktopBindingStates(channelType, chatId),
      { channelType, chatId },
    ) || undefined;
  }

  refreshedBoundThreadsCard(channelType: string, chatId: string) {
    return buildBoundThreadsCommandCard(
      this.boundThreadCardItems(channelType, chatId),
      { channelType, chatId },
    ) || undefined;
  }

  bindingThreadId(binding: ChannelBinding): string {
    const session = this.store.getSession(binding.codepilotSessionId);
    return getExplicitDesktopThreadId(session) || getCodexThreadId(session, binding) || binding.sdkSessionId || '';
  }

  bindingShortId(binding: ChannelBinding): string {
    return binding.id.slice(0, 8);
  }

  binding(binding: ChannelBinding, options: ThreadTitleOptions = {}): ThreadDisplayInfo {
    const session = this.store.getSession(binding.codepilotSessionId);
    const threadId = this.bindingThreadId(binding);
    const desktop = threadId ? getDesktopSessionByThreadIdSafe(threadId, 'thread display binding') : null;
    const title = this.resolveTitle({
      sessionName: session?.name,
      sessionId: session?.id || binding.codepilotSessionId,
      threadId,
      desktopTitle: desktop?.title,
      fallback: getSessionDisplayName(session, binding.workingDirectory) || binding.codepilotSessionId.slice(0, 8),
    });
    return {
      title: formatResolvedThreadTitle(title, options),
      threadId,
      cwd: binding.workingDirectory || desktop?.cwd || '',
      originator: desktop?.originator || '当前聊天',
    };
  }

  desktop(session: DesktopSessionSummary, binding?: ChannelBinding, options: ThreadTitleOptions = {}): ThreadDisplayInfo {
    const bindingDisplay = binding ? this.binding(binding, options) : null;
    const title = this.resolveTitle({
      sessionName: binding ? this.store.getSession(binding.codepilotSessionId)?.name : undefined,
      sessionId: binding?.codepilotSessionId,
      threadId: session.threadId,
      desktopTitle: session.title,
      fallback: session.cwd || session.threadId.slice(0, 8),
    });
    return {
      title: formatResolvedThreadTitle(title, options),
      threadId: session.threadId,
      cwd: session.cwd || bindingDisplay?.cwd || '',
      originator: session.originator || bindingDisplay?.originator || 'Codex Desktop',
    };
  }

  thread(threadId: string, sessionId?: string | null, options: ThreadTitleOptions = {}): ThreadDisplayInfo {
    const session = sessionId ? this.store.getSession(sessionId) : null;
    const desktop = getDesktopSessionByThreadIdSafe(threadId, 'thread display thread') || null;
    const title = this.resolveTitle({
      sessionName: session?.name,
      sessionId: session?.id,
      threadId,
      desktopTitle: desktop?.title,
      fallback: desktop?.cwd || threadId.slice(0, 8),
    });
    return {
      title: formatResolvedThreadTitle(title, options),
      threadId,
      cwd: session?.working_directory || desktop?.cwd || '',
      originator: desktop?.originator || 'Codex Desktop',
    };
  }

  decorateDesktopSessions(
    desktopSessions: DesktopSessionSummary[],
    channelType?: string,
    chatId?: string,
  ): DesktopSessionSummary[] {
    const bindingByThreadId = new Map<string, ChannelBinding>();
    if (channelType && chatId) {
      for (const binding of listBindingsForChat(this.store, channelType, chatId)) {
        const threadId = this.bindingThreadId(binding);
        if (threadId) bindingByThreadId.set(threadId, binding);
      }
    }

    return desktopSessions.map((session) => ({
      ...session,
      title: this.desktop(session, bindingByThreadId.get(session.threadId)).title,
    }));
  }

  desktopBindingStates(channelType: string, chatId: string): DesktopThreadCardBindingState[] {
    return listBindingsForChat(this.store, channelType, chatId)
      .map((binding) => {
        const display = this.binding(binding);
        return {
          threadId: display.threadId,
          bindingId: binding.id,
          active: binding.active !== false,
          title: display.title,
        };
      })
      .filter((state) => state.threadId);
  }

  boundThreadCardItems(channelType: string, chatId: string): BoundThreadCardItem[] {
    return listBindingsForChat(this.store, channelType, chatId).map((binding) => {
      const display = this.binding(binding);
      return {
        title: display.title,
        cwd: display.cwd,
        threadId: display.threadId,
        bindingId: binding.id,
        active: binding.active !== false,
        originator: display.originator,
      };
    });
  }

  resolveBoundBindingSelection(bindings: ChannelBinding[], raw: string): BindingSelection {
    const token = raw.trim();
    const lowerToken = token.toLowerCase();
    const index = /^\d+$/.test(token) ? Number(token) : null;
    if (index !== null) {
      if (!Number.isInteger(index) || index < 1) return {};
      return { binding: bindings[index - 1], index };
    }

    const threadMatches = bindings.filter((binding) => {
      const threadId = this.bindingThreadId(binding);
      return Boolean(threadId && (threadId.toLowerCase() === lowerToken || threadId.toLowerCase().startsWith(lowerToken)));
    });
    if (threadMatches.length > 1) return { ambiguous: true };
    if (threadMatches.length === 1) return { binding: threadMatches[0] };

    const bindingMatches = bindings.filter((binding) => (
      binding.id.toLowerCase() === lowerToken
      || binding.id.toLowerCase().startsWith(lowerToken)
      || binding.codepilotSessionId.toLowerCase() === lowerToken
      || binding.codepilotSessionId.toLowerCase().startsWith(lowerToken)
    ));
    if (bindingMatches.length > 1) return { ambiguous: true };
    if (bindingMatches.length === 1) return { binding: bindingMatches[0] };

    const nameMatches = bindings.filter((binding) => this.binding(binding).title.trim() === token);
    if (nameMatches.length > 1) return { ambiguous: true };
    return { binding: nameMatches[0] };
  }

  selectDesktopThread(raw: string, displayedThreads: DesktopSessionSummary[]): DesktopThreadSelection {
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
    const session = this.store.getSession(binding.codepilotSessionId);
    if (!session) throw new Error('Session not found.');
    this.store.updateSession(session.id, { name });
    this.updateUiSessionName(`session:${session.id}`, name);
    const threadId = this.bindingThreadId(binding);
    if (threadId) this.updateUiSessionName(`desktop:${threadId}`, name);
  }

  private resolveTitle(options: {
    sessionName?: string | null;
    sessionId?: string;
    threadId?: string;
    desktopTitle?: string | null;
    fallback: string;
  }): string {
    return options.sessionName?.trim()
      || (options.sessionId ? this.getUiSessionName(`session:${options.sessionId}`) : '')
      || (options.threadId ? this.getUiSessionName(`desktop:${options.threadId}`) : '')
      || options.desktopTitle?.trim()
      || options.fallback.trim()
      || '未命名线程';
  }

  private getUiSessionName(targetKey: string): string {
    return this.readUiSessionMeta()[targetKey]?.name?.trim() || '';
  }

  private updateUiSessionName(targetKey: string, name: string | undefined): void {
    const meta = this.readUiSessionMeta();
    const trimmed = name?.trim();
    if (!trimmed) {
      delete meta[targetKey];
    } else {
      meta[targetKey] = { ...(meta[targetKey] || {}), name: trimmed };
    }
    fs.mkdirSync(path.dirname(this.uiSessionMetaPath), { recursive: true });
    fs.writeFileSync(this.uiSessionMetaPath, JSON.stringify(meta, null, 2));
  }

  private readUiSessionMeta(): Record<string, UiSessionMetaEntry> {
    if (this.uiSessionMeta) return this.uiSessionMeta;
    try {
      this.uiSessionMeta = JSON.parse(fs.readFileSync(this.uiSessionMetaPath, 'utf-8')) as Record<string, UiSessionMetaEntry>;
    } catch {
      this.uiSessionMeta = {};
    }
    return this.uiSessionMeta;
  }
}

function formatResolvedThreadTitle(value: string, options: ThreadTitleOptions): string {
  const withoutDesktopPrefix = stripDesktopSessionPrefix(value);
  const title = options.stripInternalPrefix ? stripInternalSessionPrefix(withoutDesktopPrefix) : withoutDesktopPrefix;
  return stripDesktopSessionPrefix(title);
}

function stripInternalSessionPrefix(value: string): string {
  return value.replace(/^(Bridge|Desktop):\s*/i, '').trim() || value;
}
