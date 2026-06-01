import type { CodexSessionSummary } from '../../../codex/session-index.js';
import { listBindingsForChat } from '../session-registry.js';
import type { BridgeStore } from '../host.js';
import { getBridgeSessionCodexThreadId } from '../display/session-display-query.js';
import {
  ThreadDisplayService,
  type ThreadTitleOptions,
} from '../thread-display-resolver.js';
import type { ChannelBinding, OutboundRichCard } from '../types.js';
import {
  buildBoundThreadsCommandCard,
  buildBoundThreadsCommandResponse,
  buildCodexThreadsCommandCard,
  buildCommandFields,
  type BoundThreadCardItem,
  type CodexThreadCardBindingState,
  type ThreadCardScope,
} from './presentation.js';

export class CommandThreadDisplay {
  private readonly display: ThreadDisplayService;

  constructor(private readonly store: BridgeStore) {
    this.display = new ThreadDisplayService(store);
  }

  chatBindingsResponse(channelType: string, chatId: string, markdown: boolean): string {
    const bindings = listBindingsForChat(this.store, channelType, chatId);
    if (bindings.length === 0) {
      return buildCommandFields(
        '当前聊天绑定',
        [],
        ['还没有绑定线程。发送 `/t` 查看本地 Codex 会话，再用 `/t add 1` 添加。'],
        markdown,
      );
    }

    return buildBoundThreadsCommandResponse(this.boundThreadCardItems(channelType, chatId), markdown);
  }

  refreshedCodexThreadsCard(
    codexSessions: CodexSessionSummary[] | null | undefined,
    showAll: boolean,
    limit: number | undefined,
    channelType: string,
    chatId: string,
    selectedThreadId?: string | null,
  ): OutboundRichCard | undefined {
    if (!codexSessions || codexSessions.length === 0) return undefined;
    return buildCodexThreadsCommandCard(
      this.decorateCodexSessions(codexSessions, channelType, chatId),
      showAll,
      limit,
      this.codexBindingStates(channelType, chatId),
      { channelType, chatId, selectedThreadId },
    ) || undefined;
  }

  refreshedBoundThreadsCard(
    channelType: string,
    chatId: string,
    selectedBindingId?: string | null,
  ): OutboundRichCard | undefined {
    return buildBoundThreadsCommandCard(
      this.boundThreadCardItems(channelType, chatId),
      { channelType, chatId, selectedBindingId },
    ) || undefined;
  }

  bindingThreadId(binding: ChannelBinding): string {
    return this.display.bindingThreadId(binding);
  }

  bindingShortId(binding: ChannelBinding): string {
    return this.display.bindingShortId(binding);
  }

  binding(binding: ChannelBinding, options: ThreadTitleOptions = {}) {
    return this.display.binding(binding, options);
  }

  codex(session: CodexSessionSummary, binding?: ChannelBinding, options: ThreadTitleOptions = {}) {
    return this.display.codex(session, binding, options);
  }

  resolveBoundBindingSelection(bindings: ChannelBinding[], raw: string) {
    return this.display.resolveBoundBindingSelection(bindings, raw);
  }

  selectCodexThread(raw: string, displayedThreads: CodexSessionSummary[]) {
    return this.display.selectCodexThread(raw, displayedThreads);
  }

  renameBinding(binding: ChannelBinding, name: string): void {
    this.display.renameBinding(binding, name);
  }

  decorateCodexSessions(
    codexSessions: CodexSessionSummary[],
    channelType?: string,
    chatId?: string,
  ): CodexSessionSummary[] {
    const bindingByThreadId = new Map<string, ChannelBinding>();
    if (channelType && chatId) {
      for (const binding of listBindingsForChat(this.store, channelType, chatId)) {
        const threadId = this.bindingThreadId(binding);
        if (threadId) bindingByThreadId.set(threadId, binding);
      }
    }

    return codexSessions.map((session) => ({
      ...session,
      title: this.codex(session, bindingByThreadId.get(session.threadId)).title,
    }));
  }

  codexBindingStates(channelType: string, chatId: string): CodexThreadCardBindingState[] {
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
        lastActiveAt: display.lastActiveAt,
        threadId: display.threadId,
        bindingId: binding.id,
        active: binding.active !== false,
        originator: display.originator,
      };
    });
  }

  bridgeOnlyBoundThreadCardItems(channelType: string, chatId: string): BoundThreadCardItem[] {
    const currentChatBindingsBySessionId = new Map(
      listBindingsForChat(this.store, channelType, chatId)
        .map((binding) => [binding.bridgeSessionId, binding]),
    );
    return this.store.listSessions()
      .filter((session) => (
        session.hidden !== true
        && session.session_type !== 'draft'
        && !getBridgeSessionCodexThreadId(session)
      ))
      .map((session) => {
        const binding = currentChatBindingsBySessionId.get(session.id);
        const display = binding ? this.binding(binding) : this.display.thread('', session.id);
        return {
          title: display.title,
          cwd: display.cwd || session.working_directory,
          lastActiveAt: display.lastActiveAt || session.updated_at,
          threadId: '',
          bindingId: binding ? binding.id : session.id,
          active: binding?.active !== false && Boolean(binding),
          originator: binding ? display.originator : 'Bridge',
        };
      });
  }
}

export type { ThreadCardScope };
