import path from 'node:path';

import type { BridgeSession, BridgeStore } from '../host.js';
import type { ChannelAddress, ChannelBinding, ChannelDefaultTarget } from '../types.js';
import { recordBindingChange } from '../binding-audit.js';
import { findChannelInstance, loadConfig, type ChannelProvider } from '../../../config.js';
import {
  getCodexSessionByThreadId,
  isArchivedCodexThread,
  listCodexSessions,
  type CodexSessionSummary,
} from '../../../codex/session-index.js';
import {
  getCodexThreadId,
} from '../turns/turn-classifier.js';
import { getBridgeSessionDisplayTitle } from '../display/session-display-query.js';

export interface BindingTargetOption {
  kind: 'codex' | 'session';
  id: string;
  label: string;
  description: string;
  cwd: string;
  bridgeSessionId?: string;
  codexThreadId?: string;
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
  codexProvider: BridgeSession['codex_provider'] | 'default';
  model: string;
  workingDirectory: string;
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
  bridgeSessionId: string;
  targetLabel: string;
  targetSessionId: string;
  targetThreadId?: string;
  createdAt: string;
  updatedAt: string;
}

interface BindingChatMeta {
  chatUserId?: string;
  chatDisplayName?: string;
  active?: boolean;
}

function compareBindingsForChatList(a: ChannelBinding, b: ChannelBinding): number {
  const aCreated = Date.parse(a.createdAt || '');
  const bCreated = Date.parse(b.createdAt || '');
  const createdDiff = (Number.isFinite(aCreated) ? aCreated : 0) - (Number.isFinite(bCreated) ? bCreated : 0);
  if (createdDiff !== 0) return createdDiff;
  return 0;
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
  opts: { sessionId?: string; codexThreadId?: string },
): ChannelBinding | null {
  return store.listChannelBindings().find((binding) => (
    (opts.sessionId ? binding.bridgeSessionId === opts.sessionId : false)
    || (opts.codexThreadId
      ? store.getSession(binding.bridgeSessionId)?.codex_thread_id === opts.codexThreadId
      : false)
  )) || null;
}

function assertBindingTargetAvailable(
  store: BridgeStore,
  current: { channelType: string; chatId: string },
  opts: { sessionId?: string; codexThreadId?: string },
): void {
  const conflict = findConflictingBinding(
    store,
    current,
    (binding) => (
      (opts.sessionId ? binding.bridgeSessionId === opts.sessionId : false)
      || (opts.codexThreadId
        ? store.getSession(binding.bridgeSessionId)?.codex_thread_id === opts.codexThreadId
        : false)
    ),
  );

  if (!conflict) return;

  throw new Error(
    `该会话已绑定到 ${formatChannelLabel(conflict)} 聊天 ${formatBindingChatTarget(conflict)}。一个会话只能绑定一个聊天。`,
  );
}

function assertBridgeSessionAvailableForDefaultRouting(
  store: BridgeStore,
  bridgeSessionId: string,
): void {
  const session = store.getSession(bridgeSessionId);
  if (!session) {
    throw new Error('Session not found.');
  }

  const conflict = findTargetConflict(store, {
    sessionId: session.id,
    codexThreadId: getCodexThreadId(session),
  });
  if (conflict) {
    throw new Error(
      `该会话已绑定到 ${formatChannelLabel(conflict)} 聊天 ${formatBindingChatTarget(conflict)}。一个会话只能绑定一个聊天。`,
    );
  }
}

function getSessionName(session: BridgeSession): string {
  if (session.session_type === 'draft') return '临时草稿线程';
  if (session.name?.trim() || session.codex_title?.trim()) return getBridgeSessionDisplayTitle(session);
  if (session.working_directory) return path.basename(session.working_directory);
  return session.id.slice(0, 8);
}

function getSessionMode(store: BridgeStore, session: BridgeSession): ChannelBinding['mode'] {
  return (session.preferred_mode || store.getSetting('bridge_default_mode')) === 'yolo'
    ? 'yolo'
    : 'normal';
}

function getSessionCodexProvider(session: BridgeSession | null | undefined): BridgeSession['codex_provider'] | 'default' {
  return session?.codex_provider || 'default';
}

function describeBridgeSessionTarget(
  store: BridgeStore,
  bridgeSessionId: string,
): { targetLabel: string; targetSessionId: string; targetThreadId?: string } {
  const session = store.getSession(bridgeSessionId);
  if (!session) {
    throw new Error('Session not found.');
  }

  return {
    targetLabel: getSessionName(session),
    targetSessionId: session.id,
    targetThreadId: getCodexThreadId(session) || undefined,
  };
}

function updateSessionCodexThread(
  store: BridgeStore,
  sessionId: string,
  codexThreadId: string,
): void {
  store.updateSessionCodexThreadId(sessionId, codexThreadId);
}

export function ensureBridgeSessionForCodexThread(
  store: BridgeStore,
  codexThreadId: string,
  opts?: { workingDirectory?: string; model?: string; displayName?: string; name?: string; codexTitle?: string },
): BridgeSession {
  const codexTitle = opts?.codexTitle || opts?.displayName || '';
  const existing = store.findSessionByCodexThreadId(codexThreadId);
  if (existing) {
    updateSessionCodexThread(store, existing.id, codexThreadId);
    if (codexTitle && existing.codex_title !== codexTitle) {
      store.updateSession(existing.id, { codex_title: codexTitle }, { touch: false });
    }
    return store.getSession(existing.id) || existing;
  }

  const workingDirectory = opts?.workingDirectory || '';
  const model = opts?.model || store.getSetting('bridge_default_model') || '';
  const baseName = opts?.name || '';

  const session = store.createSession(
    baseName,
    model,
    undefined,
    workingDirectory,
    'code',
  );
  updateSessionCodexThread(store, session.id, codexThreadId);
  if (codexTitle) {
    store.updateSession(session.id, { codex_title: codexTitle }, { touch: false });
  }
  return store.getSession(session.id) || { ...session, codex_thread_id: codexThreadId };
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
      codexThreadId: getCodexThreadId(session),
    },
  );
  const meta = resolveChannelMeta(channelType);

  return store.upsertChannelBinding({
    channelType,
    channelProvider: meta.provider,
    channelAlias: meta.alias,
    chatId,
    chatUserId: chatMeta?.chatUserId,
    chatDisplayName: chatMeta?.chatDisplayName,
    bridgeSessionId: session.id,
    workingDirectory: session.working_directory,
    model: session.model,
    mode: getSessionMode(store, session),
    active: chatMeta?.active,
  });
}

export function bindStoreToCodexThread(
  store: BridgeStore,
  channelType: string,
  chatId: string,
  codexThreadId: string,
  opts?: { workingDirectory?: string; model?: string; displayName?: string; name?: string; codexTitle?: string; chatUserId?: string; chatDisplayName?: string; active?: boolean },
): ChannelBinding {
  assertBindingTargetAvailable(
    store,
    { channelType, chatId },
    { codexThreadId },
  );
  const meta = resolveChannelMeta(channelType);

  const session = ensureBridgeSessionForCodexThread(store, codexThreadId, opts);

  return store.upsertChannelBinding({
    channelType,
    channelProvider: meta.provider,
    channelAlias: meta.alias,
    chatId,
    chatUserId: opts?.chatUserId,
    chatDisplayName: opts?.chatDisplayName,
    bridgeSessionId: session.id,
    workingDirectory: opts?.workingDirectory || session.working_directory,
    model: opts?.model || session.model,
    mode: getSessionMode(store, session),
    active: opts?.active,
  });
}

export function bindAddressToBridgeSession(
  store: BridgeStore,
  address: Pick<ChannelAddress, 'channelType' | 'chatId' | 'userId' | 'displayName'>,
  bridgeSessionId: string,
  opts?: { active?: boolean },
): ChannelBinding {
  const binding = bindStoreToSession(store, address.channelType, address.chatId, bridgeSessionId, {
    chatUserId: address.userId,
    chatDisplayName: address.displayName,
    active: opts?.active,
  });
  if (!binding) {
    throw new Error('Session not found.');
  }
  return binding;
}

export function listBindingsForChat(
  store: BridgeStore,
  channelType: string,
  chatId: string,
): ChannelBinding[] {
  return store.listChannelBindings(channelType)
    .filter((binding) => binding.chatId === chatId)
    .sort(compareBindingsForChatList);
}

export function setActiveBindingForChat(
  store: BridgeStore,
  bindingId: string,
): ChannelBinding {
  const binding = store.listChannelBindings().find((item) => item.id === bindingId);
  if (!binding) {
    throw new Error('Binding not found.');
  }
  store.updateChannelBinding(binding.id, { active: true });
  const updated = store.listChannelBindings().find((item) => item.id === binding.id);
  return updated || { ...binding, active: true };
}

export function listBindingTargetOptions(
  store: BridgeStore,
  codexLimit = 12,
): BindingTargetOption[] {
  const bridgeOptions = store.listSessions()
    .filter((session) => session.hidden !== true && session.session_type !== 'draft')
    .map((session) => {
      const threadId = getCodexThreadId(session) || undefined;
      return {
        kind: 'session' as const,
        id: session.id,
        label: getSessionName(session),
        description: `${threadId ? `${threadId.slice(0, 8)}... · ` : ''}${session.working_directory || '(no cwd)'}`,
        cwd: session.working_directory,
        bridgeSessionId: session.id,
        threadId,
        sessionId: session.id,
      };
    });

  const bridgeByThreadId = new Map<string, BridgeSession>();
  for (const session of store.listSessions()) {
    const threadId = getCodexThreadId(session);
    if (threadId && session.hidden !== true && session.session_type !== 'draft') {
      bridgeByThreadId.set(threadId, session);
    }
  }
  const codexOptions = listCodexSessions(codexLimit).map((session) => {
    const bridgeSession = bridgeByThreadId.get(session.threadId);
    return {
      kind: 'codex' as const,
      id: session.threadId,
      label: bridgeSession
        ? getBridgeSessionDisplayTitle(bridgeSession.codex_title ? bridgeSession : { ...bridgeSession, codex_title: session.title })
        : session.title,
      description: `${session.threadId.slice(0, 8)}... · ${session.cwd || '(no cwd)'}`,
      cwd: session.cwd,
      codexThreadId: session.threadId,
      threadId: session.threadId,
      bridgeSessionId: bridgeSession?.id,
    };
  });

  return [...bridgeOptions, ...codexOptions];
}

export function listBindingSummaries(store: BridgeStore): BindingSummary[] {
  return store.listChannelBindings().map((binding) => {
    const session = store.getSession(binding.bridgeSessionId);
    const currentThreadId = getCodexThreadId(session) || undefined;
    const currentTargetLabel = getSessionName(session || {
          id: binding.bridgeSessionId,
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
      mode: (binding.mode === 'yolo' ? 'yolo' : 'normal') as ChannelBinding['mode'],
      codexProvider: getSessionCodexProvider(session),
      model: binding.model,
      workingDirectory: binding.workingDirectory,
      currentTargetLabel,
      currentSessionId: binding.bridgeSessionId,
      currentSessionName: session ? getSessionName(session) : binding.bridgeSessionId.slice(0, 8),
      currentThreadId,
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
    const resolved = describeBridgeSessionTarget(store, target.bridgeSessionId);
    return {
      id: target.id,
      channelType: target.channelType,
      channelProvider: target.channelProvider,
      channelAlias: target.channelAlias,
      bridgeSessionId: target.bridgeSessionId,
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
  bridgeSessionId: string,
): ChannelDefaultTargetSummary {
  assertBridgeSessionAvailableForDefaultRouting(store, bridgeSessionId);
  const meta = resolveChannelMeta(channelType);
  const existing = store.getChannelDefaultTarget(channelType);
  const updated = store.upsertChannelDefaultTarget({
    channelType,
    channelProvider: meta.provider,
    channelAlias: meta.alias,
    bridgeSessionId,
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
      bridgeSessionId: existing.bridgeSessionId,
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
      bridgeSessionId: updated.bridgeSessionId,
      workingDirectory: '',
      model: '',
      mode: 'code',
      active: true,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    },
    source: 'web_ui',
    reason: `bridgeSessionId=${bridgeSessionId}`,
  });

  return listChannelDefaultTargetSummaries(store).find((item) => item.channelType === channelType)!;
}

export function updateChannelDefaultCodexThread(
  store: BridgeStore,
  channelType: string,
  codexThreadId: string,
): ChannelDefaultTargetSummary {
  const local = getCodexSessionByThreadId(codexThreadId);
  const session = ensureBridgeSessionForCodexThread(store, codexThreadId, local ? {
    workingDirectory: local.cwd,
    codexTitle: local.title,
  } : undefined);
  return updateChannelDefaultTarget(store, channelType, session.id);
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
      bridgeSessionId: existing.bridgeSessionId,
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
  target: { bridgeSessionId?: string; codexThreadId?: string },
): BindingSummary {
  const binding = store.listChannelBindings().find((item) => item.id === bindingId);
  if (!binding) {
    throw new Error('Binding not found.');
  }
  const fromBinding = { ...binding };

  if (target.codexThreadId) {
    const codexSession = getCodexSessionByThreadId(target.codexThreadId);
    bindStoreToCodexThread(store, binding.channelType, binding.chatId, target.codexThreadId, codexSession ? {
      workingDirectory: codexSession.cwd,
      codexTitle: codexSession.title,
      chatUserId: binding.chatUserId,
      chatDisplayName: binding.chatDisplayName,
    } : {
      workingDirectory: binding.workingDirectory,
      chatUserId: binding.chatUserId,
      chatDisplayName: binding.chatDisplayName,
    });
  } else if (target.bridgeSessionId) {
    const updated = bindStoreToSession(store, binding.channelType, binding.chatId, target.bridgeSessionId, {
      chatUserId: binding.chatUserId,
      chatDisplayName: binding.chatDisplayName,
    });
    if (!updated) {
      throw new Error('Session not found.');
    }
  } else {
    throw new Error('Unsupported session target.');
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
    reason: target.codexThreadId ? `codexThreadId=${target.codexThreadId}` : `bridgeSessionId=${target.bridgeSessionId}`,
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

export function getCodexCandidateForThread(threadId: string): CodexSessionSummary | null {
  return getCodexSessionByThreadId(threadId);
}
