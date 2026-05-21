import path from 'node:path';

import type { BridgeSession, BridgeStore } from './lib/bridge/host.js';
import type { ChannelAddress, ChannelBinding, ChannelDefaultTarget } from './lib/bridge/types.js';
import { recordBindingChange } from './lib/bridge/binding-audit.js';
import { findChannelInstance, loadConfig, type ChannelProvider } from './config.js';
import {
  getDesktopSessionByThreadId,
  isArchivedDesktopThread,
  listDesktopSessions,
  type DesktopSessionSummary,
} from './desktop-sessions.js';
import {
  getCodexThreadId,
  getExplicitDesktopThreadId,
} from './lib/bridge/turns/turn-classifier.js';

export interface BindingTargetOption {
  key: string;
  kind: 'desktop' | 'session';
  id: string;
  label: string;
  description: string;
  cwd: string;
  threadId?: string;
  sessionId?: string;
}

export interface BindingSummary {
  id: string;
  channelType: string;
  channelProvider?: string;
  channelAlias?: string;
  chatId: string;
  chatUserId?: string;
  chatDisplayName?: string;
  mode: ChannelBinding['mode'];
  model: string;
  workingDirectory: string;
  currentTargetKey: string;
  currentTargetLabel: string;
  currentSessionId: string;
  currentSessionName: string;
  currentThreadId?: string;
  runtimeStatus?: BridgeSession['runtime_status'];
  queuedCount?: number;
  mirrorStatus?: BridgeSession['mirror_status'];
  mirrorLastEventAt?: string;
}

export interface ChannelDefaultTargetSummary {
  id: string;
  channelType: string;
  channelProvider?: string;
  channelAlias?: string;
  targetKey: string;
  targetLabel: string;
  targetSessionId?: string;
  targetThreadId?: string;
  createdAt: string;
  updatedAt: string;
}

interface BindingChatMeta {
  chatUserId?: string;
  chatDisplayName?: string;
}

function asChannelProvider(value: string | undefined): ChannelProvider | undefined {
  return value === 'feishu' || value === 'weixin' ? value : undefined;
}

function resolveChannelMeta(channelType: string, provider?: ChannelProvider): {
  provider?: ChannelProvider;
  alias?: string;
} {
  const instance = findChannelInstance(channelType, loadConfig());
  if (instance) {
    return {
      provider: instance.provider,
      alias: instance.alias,
    };
  }
  return {
    provider,
    alias: channelType,
  };
}

function formatChannelLabel(binding: Pick<ChannelBinding, 'channelType' | 'channelProvider' | 'channelAlias'>): string {
  return binding.channelAlias?.trim()
    || resolveChannelMeta(binding.channelType, asChannelProvider(binding.channelProvider)).alias
    || binding.channelType;
}

function formatBindingChatTarget(binding: ChannelBinding): string {
  return binding.chatDisplayName?.trim() || binding.chatId;
}

function findConflictingBinding(
  store: BridgeStore,
  current: { channelType: string; chatId: string },
  match: (binding: ChannelBinding) => boolean,
): ChannelBinding | null {
  return store.listChannelBindings().find((binding) => {
    if (binding.channelType === current.channelType && binding.chatId === current.chatId) {
      return false;
    }
    return match(binding);
  }) || null;
}

function findTargetConflict(
  store: BridgeStore,
  opts: { sessionId?: string; sdkSessionId?: string },
): ChannelBinding | null {
  return store.listChannelBindings().find((binding) => (
    (opts.sessionId ? binding.codepilotSessionId === opts.sessionId : false)
    || (opts.sdkSessionId ? binding.sdkSessionId === opts.sdkSessionId : false)
  )) || null;
}

function assertBindingTargetAvailable(
  store: BridgeStore,
  current: { channelType: string; chatId: string },
  opts: { sessionId?: string; sdkSessionId?: string },
): void {
  const conflict = findConflictingBinding(
    store,
    current,
    (binding) => (
      (opts.sessionId ? binding.codepilotSessionId === opts.sessionId : false)
      || (opts.sdkSessionId ? binding.sdkSessionId === opts.sdkSessionId : false)
    ),
  );

  if (!conflict) return;

  throw new Error(
    `该会话已绑定到 ${formatChannelLabel(conflict)} 聊天 ${formatBindingChatTarget(conflict)}。一个会话只能绑定一个聊天。`,
  );
}

function assertTargetAvailableForDefaultRouting(
  store: BridgeStore,
  targetKey: string,
): void {
  if (targetKey.startsWith('session:')) {
    const sessionId = targetKey.slice('session:'.length);
    const session = store.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found.');
    }

    const conflict = findTargetConflict(store, {
      sessionId: session.id,
      sdkSessionId: getCodexThreadId(session) || getExplicitDesktopThreadId(session),
    });
    if (conflict) {
      throw new Error(
        `该会话已绑定到 ${formatChannelLabel(conflict)} 聊天 ${formatBindingChatTarget(conflict)}。一个会话只能绑定一个聊天。`,
      );
    }
    return;
  }

  if (targetKey.startsWith('desktop:')) {
    const threadId = targetKey.slice('desktop:'.length);
    const conflict = findTargetConflict(store, { sdkSessionId: threadId });
    if (conflict) {
      throw new Error(
        `该会话已绑定到 ${formatChannelLabel(conflict)} 聊天 ${formatBindingChatTarget(conflict)}。一个会话只能绑定一个聊天。`,
      );
    }
    return;
  }

  throw new Error('Unsupported target.');
}

function getSessionName(session: BridgeSession): string {
  if (session.session_type === 'draft') return '临时草稿线程';
  if (session.name?.trim()) return session.name.trim();
  if (session.working_directory) return path.basename(session.working_directory);
  return session.id.slice(0, 8);
}

function getSessionMode(store: BridgeStore, session: BridgeSession): ChannelBinding['mode'] {
  return session.preferred_mode
    || (store.getSetting('bridge_default_mode') as ChannelBinding['mode'])
    || 'code';
}

function getBindingResumeThreadId(session: BridgeSession): string {
  return getCodexThreadId(session) || '';
}

function describeTargetKey(
  store: BridgeStore,
  targetKey: string,
): { targetLabel: string; targetSessionId?: string; targetThreadId?: string } {
  if (targetKey.startsWith('desktop:')) {
    const threadId = targetKey.slice('desktop:'.length);
    const desktop = getDesktopSessionByThreadId(threadId);
    const archived = isArchivedDesktopThread(threadId);
    return {
      targetLabel: desktop?.title || (archived ? `已归档桌面线程 ${threadId.slice(0, 8)}...` : `Desktop thread ${threadId.slice(0, 8)}...`),
      targetThreadId: threadId,
    };
  }

  if (targetKey.startsWith('session:')) {
    const sessionId = targetKey.slice('session:'.length);
    const session = store.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found.');
    }
    return {
      targetLabel: getSessionName(session),
      targetSessionId: session.id,
      targetThreadId: getCodexThreadId(session) || undefined,
    };
  }

  throw new Error('Unsupported target.');
}

function markSessionAsDesktopBacked(
  store: BridgeStore,
  sessionId: string,
  desktopThreadId: string,
): void {
  store.updateSdkSessionId(sessionId, desktopThreadId);
  store.updateSession(sessionId, {
    sdk_session_id: desktopThreadId,
    codex_thread_id: desktopThreadId,
    desktop_thread_id: desktopThreadId,
    thread_origin: 'desktop',
  });
}

export function bindStoreToSession(
  store: BridgeStore,
  channelType: string,
  chatId: string,
  sessionId: string,
  chatMeta?: BindingChatMeta,
): ChannelBinding | null {
  const session = store.getSession(sessionId);
  if (!session) return null;

  assertBindingTargetAvailable(
    store,
    { channelType, chatId },
    {
      sessionId: session.id,
      sdkSessionId: getCodexThreadId(session) || getExplicitDesktopThreadId(session),
    },
  );
  const meta = resolveChannelMeta(channelType);
  const sdkSessionId = getBindingResumeThreadId(session);

  return store.upsertChannelBinding({
    channelType,
    channelProvider: meta.provider,
    channelAlias: meta.alias,
    chatId,
    chatUserId: chatMeta?.chatUserId,
    chatDisplayName: chatMeta?.chatDisplayName,
    codepilotSessionId: session.id,
    sdkSessionId,
    workingDirectory: session.working_directory,
    model: session.model,
    mode: getSessionMode(store, session),
  });
}

export function bindStoreToSdkSession(
  store: BridgeStore,
  channelType: string,
  chatId: string,
  sdkSessionId: string,
  opts?: { workingDirectory?: string; model?: string; displayName?: string; chatUserId?: string; chatDisplayName?: string },
): ChannelBinding {
  assertBindingTargetAvailable(
    store,
    { channelType, chatId },
    { sdkSessionId },
  );
  const meta = resolveChannelMeta(channelType);

  const existing = store.findSessionBySdkSessionId(sdkSessionId);
  if (existing) {
      markSessionAsDesktopBacked(store, existing.id, sdkSessionId);
      return store.upsertChannelBinding({
        channelType,
        channelProvider: meta.provider,
        channelAlias: meta.alias,
        chatId,
        chatUserId: opts?.chatUserId,
        chatDisplayName: opts?.chatDisplayName,
        codepilotSessionId: existing.id,
        sdkSessionId,
        workingDirectory: opts?.workingDirectory || existing.working_directory,
        model: opts?.model || existing.model,
        mode: getSessionMode(store, existing),
      });
  }

  const workingDirectory = opts?.workingDirectory
    || '';
  const model = opts?.model || store.getSetting('bridge_default_model') || '';
  const baseName = opts?.displayName
    || (workingDirectory ? path.basename(workingDirectory) : sdkSessionId.slice(0, 8));

  const session = store.createSession(
    `Desktop: ${baseName}`,
    model,
    undefined,
    workingDirectory,
    'code',
  );
  markSessionAsDesktopBacked(store, session.id, sdkSessionId);

  return store.upsertChannelBinding({
    channelType,
    channelProvider: meta.provider,
    channelAlias: meta.alias,
    chatId,
    chatUserId: opts?.chatUserId,
    chatDisplayName: opts?.chatDisplayName,
    codepilotSessionId: session.id,
    sdkSessionId,
    workingDirectory: workingDirectory || session.working_directory,
    model: model || session.model,
    mode: getSessionMode(store, session),
  });
}

export function bindAddressToTarget(
  store: BridgeStore,
  address: Pick<ChannelAddress, 'channelType' | 'chatId' | 'userId' | 'displayName'>,
  targetKey: string,
): ChannelBinding {
  if (targetKey.startsWith('desktop:')) {
    const threadId = targetKey.slice('desktop:'.length);
    const desktop = getDesktopSessionByThreadId(threadId);
    return bindStoreToSdkSession(store, address.channelType, address.chatId, threadId, desktop ? {
      workingDirectory: desktop.cwd,
      displayName: desktop.title,
      chatUserId: address.userId,
      chatDisplayName: address.displayName,
    } : {
      chatUserId: address.userId,
      chatDisplayName: address.displayName,
    });
  }

  if (targetKey.startsWith('session:')) {
    const sessionId = targetKey.slice('session:'.length);
    const binding = bindStoreToSession(store, address.channelType, address.chatId, sessionId, {
      chatUserId: address.userId,
      chatDisplayName: address.displayName,
    });
    if (!binding) {
      throw new Error('Session not found.');
    }
    return binding;
  }

  throw new Error('Unsupported target.');
}

export function listBindingTargetOptions(
  store: BridgeStore,
  desktopLimit = 12,
): BindingTargetOption[] {
  const bridgeOptions = store.listSessions()
    .filter((session) => session.hidden !== true && session.session_type !== 'draft')
    .filter((session) => !getExplicitDesktopThreadId(session))
    .map((session) => {
      const threadId = getCodexThreadId(session) || undefined;
      return {
        key: `session:${session.id}`,
        kind: 'session' as const,
        id: session.id,
        label: getSessionName(session),
        description: `${threadId ? `${threadId.slice(0, 8)}... · ` : ''}${session.working_directory || '(no cwd)'}`,
        cwd: session.working_directory,
        threadId,
        sessionId: session.id,
      };
    });

  const desktopOptions = listDesktopSessions(desktopLimit).map((session) => ({
    key: `desktop:${session.threadId}`,
    kind: 'desktop' as const,
    id: session.threadId,
    label: session.title,
    description: `${session.threadId.slice(0, 8)}... · ${session.cwd || '(no cwd)'}`,
    cwd: session.cwd,
    threadId: session.threadId,
  }));

  return [...bridgeOptions, ...desktopOptions];
}

export function listBindingSummaries(store: BridgeStore): BindingSummary[] {
  return store.listChannelBindings().map((binding) => {
    const session = store.getSession(binding.codepilotSessionId);
    const currentDesktopThreadId = session ? getExplicitDesktopThreadId(session) : undefined;
    const desktop = currentDesktopThreadId ? getDesktopSessionByThreadId(currentDesktopThreadId) : null;
    const archived = currentDesktopThreadId ? isArchivedDesktopThread(currentDesktopThreadId) : false;
    const currentTargetKey = currentDesktopThreadId ? `desktop:${currentDesktopThreadId}` : `session:${binding.codepilotSessionId}`;
    const currentTargetLabel = currentDesktopThreadId
      ? (desktop?.title || (archived ? `已归档桌面线程 ${currentDesktopThreadId.slice(0, 8)}...` : `Desktop thread ${currentDesktopThreadId.slice(0, 8)}...`))
      : getSessionName(session || {
          id: binding.codepilotSessionId,
          working_directory: binding.workingDirectory,
          model: binding.model,
        });

    return {
      id: binding.id,
      channelType: binding.channelType,
      channelProvider: binding.channelProvider,
      channelAlias: binding.channelAlias,
      chatId: binding.chatId,
      chatUserId: binding.chatUserId,
      chatDisplayName: binding.chatDisplayName,
      mode: binding.mode,
      model: binding.model,
      workingDirectory: binding.workingDirectory,
      currentTargetKey,
      currentTargetLabel,
      currentSessionId: binding.codepilotSessionId,
      currentSessionName: session ? getSessionName(session) : binding.codepilotSessionId.slice(0, 8),
      currentThreadId: currentDesktopThreadId || getCodexThreadId(session, binding),
      runtimeStatus: session?.runtime_status,
      queuedCount: session?.queued_count,
      mirrorStatus: session?.mirror_status,
      mirrorLastEventAt: session?.mirror_last_event_at,
    };
  }).sort((a, b) => {
    const aLabel = a.channelAlias || a.channelType;
    const bLabel = b.channelAlias || b.channelType;
    if (aLabel !== bLabel) return aLabel.localeCompare(bLabel);
    return a.chatId.localeCompare(b.chatId);
  });
}

export function listChannelDefaultTargetSummaries(store: BridgeStore): ChannelDefaultTargetSummary[] {
  return store.listChannelDefaultTargets().map((target) => {
    const resolved = describeTargetKey(store, target.targetKey);
    return {
      id: target.id,
      channelType: target.channelType,
      channelProvider: target.channelProvider,
      channelAlias: target.channelAlias,
      targetKey: target.targetKey,
      targetLabel: resolved.targetLabel,
      targetSessionId: resolved.targetSessionId,
      targetThreadId: resolved.targetThreadId,
      createdAt: target.createdAt,
      updatedAt: target.updatedAt,
    };
  }).sort((a, b) => {
    const aLabel = a.channelAlias || a.channelType;
    const bLabel = b.channelAlias || b.channelType;
    return aLabel.localeCompare(bLabel);
  });
}

export function updateChannelDefaultTarget(
  store: BridgeStore,
  channelType: string,
  targetKey: string,
): ChannelDefaultTargetSummary {
  assertTargetAvailableForDefaultRouting(store, targetKey);
  const meta = resolveChannelMeta(channelType);
  const existing = store.getChannelDefaultTarget(channelType);
  const updated = store.upsertChannelDefaultTarget({
    channelType,
    channelProvider: meta.provider,
    channelAlias: meta.alias,
    targetKey,
  });

  recordBindingChange(store, {
    action: 'web_set_default_target',
    address: {
      channelType,
      channelProvider: meta.provider,
      channelAlias: meta.alias,
      chatId: '*',
    },
    fromBinding: existing ? ({
      id: existing.id,
      channelType: existing.channelType,
      channelProvider: existing.channelProvider,
      channelAlias: existing.channelAlias,
      chatId: '*',
      codepilotSessionId: existing.targetKey,
      sdkSessionId: '',
      workingDirectory: '',
      model: '',
      mode: 'code',
      active: true,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    } satisfies ChannelBinding) : null,
    toBinding: {
      id: updated.id,
      channelType: updated.channelType,
      channelProvider: updated.channelProvider,
      channelAlias: updated.channelAlias,
      chatId: '*',
      codepilotSessionId: updated.targetKey,
      sdkSessionId: '',
      workingDirectory: '',
      model: '',
      mode: 'code',
      active: true,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
    source: 'web_ui',
    reason: `target=${targetKey}`,
  });

  return listChannelDefaultTargetSummaries(store).find((item) => item.channelType === channelType)!;
}

export function removeChannelDefaultTarget(
  store: BridgeStore,
  channelType: string,
): void {
  const existing = store.getChannelDefaultTarget(channelType);
  if (!existing) {
    throw new Error('Channel default target not found.');
  }
  store.deleteChannelDefaultTarget(channelType);
  recordBindingChange(store, {
    action: 'web_clear_default_target',
    address: {
      channelType,
      channelProvider: existing.channelProvider,
      channelAlias: existing.channelAlias,
      chatId: '*',
    },
    fromBinding: {
      id: existing.id,
      channelType: existing.channelType,
      channelProvider: existing.channelProvider,
      channelAlias: existing.channelAlias,
      chatId: '*',
      codepilotSessionId: existing.targetKey,
      sdkSessionId: '',
      workingDirectory: '',
      model: '',
      mode: 'code',
      active: true,
      createdAt: existing.createdAt,
      updatedAt: existing.updatedAt,
    },
    toBinding: null,
    source: 'web_ui',
  });
}

export function updateBindingTarget(
  store: BridgeStore,
  bindingId: string,
  targetKey: string,
): BindingSummary {
  const binding = store.listChannelBindings().find((item) => item.id === bindingId);
  if (!binding) {
    throw new Error('Binding not found.');
  }
  const fromBinding = { ...binding };

  if (targetKey.startsWith('desktop:')) {
    const threadId = targetKey.slice('desktop:'.length);
    const desktop = getDesktopSessionByThreadId(threadId);
    bindStoreToSdkSession(store, binding.channelType, binding.chatId, threadId, desktop ? {
      workingDirectory: desktop.cwd,
      displayName: desktop.title,
      chatUserId: binding.chatUserId,
      chatDisplayName: binding.chatDisplayName,
    } : {
      workingDirectory: binding.workingDirectory,
      chatUserId: binding.chatUserId,
      chatDisplayName: binding.chatDisplayName,
    });
  } else if (targetKey.startsWith('session:')) {
    const sessionId = targetKey.slice('session:'.length);
    const updated = bindStoreToSession(store, binding.channelType, binding.chatId, sessionId, {
      chatUserId: binding.chatUserId,
      chatDisplayName: binding.chatDisplayName,
    });
    if (!updated) {
      throw new Error('Session not found.');
    }
  } else {
    throw new Error('Unsupported target.');
  }

  const toBinding = store.getChannelBinding(binding.channelType, binding.chatId);
  recordBindingChange(store, {
    action: 'web_switch',
    address: {
      channelType: binding.channelType,
      channelProvider: binding.channelProvider,
      channelAlias: binding.channelAlias,
      chatId: binding.chatId,
    },
    fromBinding,
    toBinding,
    source: 'web_ui',
    reason: `target=${targetKey}`,
  });

  const updated = listBindingSummaries(store).find((item) => item.id === bindingId);
  if (!updated) {
    throw new Error('Updated binding not found.');
  }
  return updated;
}

export function removeBinding(
  store: BridgeStore,
  bindingId: string,
): void {
  const binding = store.listChannelBindings().find((item) => item.id === bindingId);
  if (!binding) {
    throw new Error('Binding not found.');
  }
  const fromBinding = { ...binding };
  store.deleteChannelBinding(bindingId);
  recordBindingChange(store, {
    action: 'web_unbind',
    address: {
      channelType: binding.channelType,
      channelProvider: binding.channelProvider,
      channelAlias: binding.channelAlias,
      chatId: binding.chatId,
    },
    fromBinding,
    toBinding: null,
    source: 'web_ui',
  });
}

export function getChannelBindingSummaries(
  store: BridgeStore,
  channelType: string,
): BindingSummary[] {
  return listBindingSummaries(store).filter((binding) => binding.channelType === channelType);
}

export function getDesktopCandidateForThread(threadId: string): DesktopSessionSummary | null {
  return getDesktopSessionByThreadId(threadId);
}
