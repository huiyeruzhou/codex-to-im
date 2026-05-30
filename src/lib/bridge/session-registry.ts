import type { BridgeSession, BridgeStore } from './host.js';
import type { ChannelAddress, ChannelBinding } from './types.js';
import {
  getBridgeSessionCodexThreadId,
  isVisibleBridgeSession,
} from './display/session-display-query.js';
import {
  bindStoreToCodexThread,
  bindStoreToSession,
  type BindingSummary,
  type ChannelDefaultTargetSummary,
  removeBinding,
  removeChannelDefaultTarget,
  updateChannelDefaultCodexThread,
  updateBindingTarget,
  updateChannelDefaultTarget,
} from './session-registry/bindings.js';

export {
  type BindingSummary,
  type BindingTargetOption,
  type ChannelDefaultTargetSummary,
  listBindingSummaries,
  listBindingsForChat,
  listBindingTargetOptions,
  listChannelDefaultTargetSummaries,
  setActiveBindingForChat,
} from './session-registry/bindings.js';

export interface BindChatOptions {
  active?: boolean;
}

export interface ImportCodexThreadOptions extends BindChatOptions {
  workingDirectory?: string;
  model?: string;
  displayName?: string;
}

export interface CodexThreadRecord {
  codexThreadId: string;
  title: string;
  cwd: string;
}

export interface CodexThreadRegistryPort {
  getThread(codexThreadId: string): CodexThreadRecord | null;
  archiveThread?(codexThreadId: string): boolean;
}

export interface SessionRegistryOptions {
  codexThreads?: CodexThreadRegistryPort;
  readDefaultModel?: () => string | null | undefined;
  defaultWorkingDirectory?: () => string;
}

export interface DeleteBridgeSessionResult {
  deleted: BridgeSession;
  deletedBridgeSessionIds: string[];
}

export interface ArchiveCodexThreadResult {
  codexThreadId: string;
  deletedBridgeSessions: BridgeSession[];
  deletedBridgeSessionIds: string[];
}

export class SessionRegistryService {
  constructor(
    private readonly store: BridgeStore,
    private readonly options: SessionRegistryOptions = {},
  ) {}

  bindChatToBridgeSession(
    address: ChannelAddress,
    bridgeSessionId: string,
    opts: BindChatOptions = {},
  ): ChannelBinding | null {
    return bindStoreToSession(
      this.store,
      address.channelType,
      address.chatId,
      bridgeSessionId,
      {
        chatUserId: address.userId,
        chatDisplayName: address.displayName,
        active: opts.active,
      },
    );
  }

  importCodexThreadForChat(
    address: ChannelAddress,
    codexThreadId: string,
    opts: ImportCodexThreadOptions = {},
  ): ChannelBinding {
    return bindStoreToCodexThread(this.store, address.channelType, address.chatId, codexThreadId, {
      workingDirectory: opts.workingDirectory,
      model: opts.model,
      displayName: opts.displayName,
      chatUserId: address.userId,
      chatDisplayName: address.displayName,
      active: opts.active,
    });
  }

  switchBindingToBridgeSession(bindingId: string, bridgeSessionId: string): BindingSummary {
    return updateBindingTarget(this.store, bindingId, { bridgeSessionId });
  }

  switchBindingToCodexThread(bindingId: string, codexThreadId: string): BindingSummary {
    return updateBindingTarget(this.store, bindingId, { codexThreadId });
  }

  removeBinding(bindingId: string): void {
    removeBinding(this.store, bindingId);
  }

  setChannelDefaultBridgeSession(channelType: string, bridgeSessionId: string): ChannelDefaultTargetSummary {
    return updateChannelDefaultTarget(this.store, channelType, bridgeSessionId);
  }

  setChannelDefaultCodexThread(channelType: string, codexThreadId: string): ChannelDefaultTargetSummary {
    return updateChannelDefaultCodexThread(this.store, channelType, codexThreadId);
  }

  removeChannelDefaultTarget(channelType: string): void {
    removeChannelDefaultTarget(this.store, channelType);
  }

  getVisibleBridgeSession(bridgeSessionId: string): BridgeSession {
    const session = this.store.getSession(bridgeSessionId);
    if (!session || !isVisibleBridgeSession(session)) {
      throw new Error('指定的 Bridge 会话不存在。');
    }
    return session;
  }

  findVisibleBridgeSessionByCodexThread(codexThreadId: string): BridgeSession | null {
    if (!codexThreadId) return null;
    return this.store.listSessions().find((session) => (
      isVisibleBridgeSession(session)
      && getBridgeSessionCodexThreadId(session) === codexThreadId
    )) || null;
  }

  materializeCodexThread(codexThreadId: string): BridgeSession {
    const existing = this.findVisibleBridgeSessionByCodexThread(codexThreadId);
    if (existing) return existing;

    const localThread = this.options.codexThreads?.getThread(codexThreadId) || null;
    if (!localThread) {
      throw new Error('指定的 Codex 会话不存在。');
    }

    const session = this.store.createSession(
      '',
      this.options.readDefaultModel?.() || 'default',
      undefined,
      localThread.cwd || this.options.defaultWorkingDirectory?.() || process.cwd(),
      'normal',
    );
    this.store.updateSessionCodexThreadId(session.id, codexThreadId);
    if (localThread.title) {
      this.store.updateSession(session.id, { codex_title: localThread.title }, { touch: false });
    }
    return this.store.getSession(session.id) || { ...session, codex_thread_id: codexThreadId };
  }

  renameBridgeSession(bridgeSessionId: string, name: string | undefined): BridgeSession {
    const session = this.getVisibleBridgeSession(bridgeSessionId);
    this.store.updateSession(session.id, { name });
    return this.store.getSession(session.id) || { ...session, name };
  }

  renameCodexThread(codexThreadId: string, name: string | undefined): BridgeSession {
    const session = this.materializeCodexThread(codexThreadId);
    return this.renameBridgeSession(session.id, name);
  }

  updateBridgeSessionConfig(bridgeSessionId: string, updates: Partial<BridgeSession>): BridgeSession {
    const session = this.getVisibleBridgeSession(bridgeSessionId);
    this.store.updateSession(session.id, updates);
    return this.store.getSession(session.id) || { ...session, ...updates };
  }

  deleteBridgeSession(bridgeSessionId: string): DeleteBridgeSessionResult {
    const session = this.getVisibleBridgeSession(bridgeSessionId);
    this.store.deleteSession(session.id);
    return {
      deleted: session,
      deletedBridgeSessionIds: [session.id],
    };
  }

  archiveCodexThread(codexThreadId: string): ArchiveCodexThreadResult {
    if (!this.options.codexThreads?.archiveThread) {
      throw new Error('Local Codex archive is not configured.');
    }
    const archived = this.options.codexThreads.archiveThread(codexThreadId);
    if (!archived) {
      throw new Error('指定的 Codex 会话不存在。');
    }

    const linkedSessions = this.store.listSessions()
      .filter((session) => getBridgeSessionCodexThreadId(session) === codexThreadId);
    for (const session of linkedSessions) {
      this.store.deleteSession(session.id);
    }

    return {
      codexThreadId,
      deletedBridgeSessions: linkedSessions,
      deletedBridgeSessionIds: linkedSessions.map((session) => session.id),
    };
  }

}
