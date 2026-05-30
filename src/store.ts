/**
 * JSON file-backed BridgeStore implementation.
 *
 * Uses in-memory Maps as cache with write-through persistence
 * to JSON files in ~/.codex-to-im/data/.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  BridgeStore,
  BridgeSession,
  BridgeMessage,
  BridgeApiProvider,
  AuditLogInput,
  PermissionLinkInput,
  PermissionLinkRecord,
  OutboundRefInput,
  UpsertChannelBindingInput,
  UpsertChannelDefaultTargetInput,
} from './lib/bridge/host.js';
import type { ChannelBinding, ChannelBindingMode, ChannelDefaultTarget, ChannelType } from './lib/bridge/types.js';
import { CTI_HOME, configToSettings, findChannelInstance, loadConfig } from './config.js';
import { runStartupStorageMigrations } from './storage-migrations.js';

const DATA_DIR = path.join(CTI_HOME, 'data');
const MESSAGES_DIR = path.join(DATA_DIR, 'messages');
const CHANNEL_DEFAULT_TARGETS_PATH = path.join(DATA_DIR, 'channel-default-targets.json');

// ── Helpers ──

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function atomicWrite(filePath: string, data: string): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, data, 'utf-8');
  fs.renameSync(tmp, filePath);
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filePath: string, data: unknown): void {
  atomicWrite(filePath, JSON.stringify(data, null, 2));
}

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

function normalizeStoredMode(mode: unknown): ChannelBindingMode {
  if (mode === 'yolo') return 'yolo';
  if (mode === 'normal' || mode === 'code') return 'normal';
  return 'normal';
}

function defaultAliasForProvider(provider: string | undefined): string | undefined {
  if (provider === 'feishu') return '飞书';
  if (provider === 'weixin') return '微信';
  return undefined;
}

// One-time upgrade path for bindings created before v2 channel instances.
// Runtime should read and write v2 bindings only; legacy singleton ids are
// rewritten to instance ids the first time they are encountered on disk.
function upgradeLegacyBinding(binding: ChannelBinding): ChannelBinding {
  const config = loadConfig();
  const exactInstance = findChannelInstance(binding.channelType, config);
  const hasInstanceMetadata = Boolean(binding.channelProvider || binding.channelAlias);
  const legacyProvider = !exactInstance
    && !hasInstanceMetadata
    && (binding.channelType === 'feishu' || binding.channelType === 'weixin')
    ? binding.channelType
    : undefined;
  const resolvedInstance = exactInstance
    || (legacyProvider
      ? (config.channels || []).find((channel) => channel.provider === legacyProvider)
      : undefined);

  if (!resolvedInstance && !legacyProvider) {
    return {
      ...binding,
      mode: normalizeStoredMode(binding.mode),
      active: binding.active !== false,
    };
  }

  const channelType = resolvedInstance?.id || binding.channelType;
  const channelProvider = resolvedInstance?.provider || legacyProvider || binding.channelProvider;
  const channelAlias = resolvedInstance?.alias || binding.channelAlias || defaultAliasForProvider(channelProvider);

  return {
    ...binding,
    channelType,
    channelProvider,
    channelAlias,
    mode: normalizeStoredMode(binding.mode),
    active: binding.active !== false,
  };
}

function didBindingChange(before: ChannelBinding, after: ChannelBinding): boolean {
  return before.channelType !== after.channelType
    || before.channelProvider !== after.channelProvider
    || before.channelAlias !== after.channelAlias
    || before.id !== after.id
    || (before.active !== false) !== after.active
    || before.mode !== after.mode;
}

function bindingChatKey(binding: Pick<ChannelBinding, 'channelType' | 'chatId'>): string {
  return `${binding.channelType}:${binding.chatId}`;
}

function bindingTargetMatches(binding: ChannelBinding, data: UpsertChannelBindingInput): boolean {
  if (binding.channelType !== data.channelType || binding.chatId !== data.chatId) return false;
  return binding.bridgeSessionId === data.bridgeSessionId;
}

function compareBindingUpdatedAtDesc(a: ChannelBinding, b: ChannelBinding): number {
  const aTime = Date.parse(a.updatedAt || a.createdAt || '');
  const bTime = Date.parse(b.updatedAt || b.createdAt || '');
  return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
}

function normalizeChannelDefaultTarget(target: ChannelDefaultTarget): ChannelDefaultTarget {
  const config = loadConfig();
  const instance = findChannelInstance(target.channelType, config);
  const channelProvider = instance?.provider || target.channelProvider;
  const channelAlias = instance?.alias || target.channelAlias || defaultAliasForProvider(channelProvider);

  return {
    ...target,
    channelProvider,
    channelAlias,
  };
}

function didChannelDefaultTargetChange(before: ChannelDefaultTarget, after: ChannelDefaultTarget): boolean {
  return before.channelProvider !== after.channelProvider
    || before.channelAlias !== after.channelAlias;
}

// ── Lock entry ──

interface LockEntry {
  lockId: string;
  owner: string;
  expiresAt: number;
}

// ── Store ──

export class JsonFileStore implements BridgeStore {
  private settings: Map<string, string>;
  private dynamicSettings: boolean;
  private sessions = new Map<string, BridgeSession>();
  private bindings = new Map<string, ChannelBinding>();
  private channelDefaultTargets = new Map<string, ChannelDefaultTarget>();
  private messages = new Map<string, BridgeMessage[]>();
  private permissionLinks = new Map<string, PermissionLinkRecord>();
  private offsets = new Map<string, string>();
  private dedupKeys = new Map<string, number>();
  private locks = new Map<string, LockEntry>();
  private auditLog: Array<AuditLogInput & { id: string; createdAt: string }> = [];

  constructor(
    settingsMap: Map<string, string>,
    options?: { dynamicSettings?: boolean },
  ) {
    this.settings = settingsMap;
    this.dynamicSettings = options?.dynamicSettings === true;
    ensureDir(DATA_DIR);
    ensureDir(MESSAGES_DIR);
    runStartupStorageMigrations({ logger: false });
    this.loadAll();
  }

  // ── Persistence ──

  private loadAll(): void {
    this.reloadSessions();
    this.reloadBindings();
    this.reloadChannelDefaultTargets();

    // Permission links
    const perms = readJson<Record<string, PermissionLinkRecord>>(
      path.join(DATA_DIR, 'permissions.json'),
      {},
    );
    for (const [id, p] of Object.entries(perms)) {
      this.permissionLinks.set(id, p);
    }

    // Offsets
    const offsets = readJson<Record<string, string>>(
      path.join(DATA_DIR, 'offsets.json'),
      {},
    );
    for (const [k, v] of Object.entries(offsets)) {
      this.offsets.set(k, v);
    }

    // Dedup
    const dedup = readJson<Record<string, number>>(
      path.join(DATA_DIR, 'dedup.json'),
      {},
    );
    for (const [k, v] of Object.entries(dedup)) {
      this.dedupKeys.set(k, v);
    }

    // Audit
    this.auditLog = readJson(path.join(DATA_DIR, 'audit.json'), []);
  }

  private reloadSessions(): void {
    const sessions = readJson<Record<string, BridgeSession>>(
      path.join(DATA_DIR, 'sessions.json'),
      {},
    );
    this.sessions = new Map(Object.entries(sessions));
  }

  private reloadBindings(): void {
    const bindings = readJson<Record<string, ChannelBinding>>(
      path.join(DATA_DIR, 'bindings.json'),
      {},
    );
    const normalized = new Map<string, ChannelBinding>();
    let changed = false;

    for (const [storedKey, binding] of Object.entries(bindings)) {
      const normalizedBinding = upgradeLegacyBinding({
        ...binding,
        id: binding.id || uuid(),
      });
      if (storedKey !== normalizedBinding.id || didBindingChange(binding, normalizedBinding)) {
        changed = true;
      }

      normalized.set(normalizedBinding.id, normalizedBinding);
    }

    const byChat = new Map<string, ChannelBinding[]>();
    for (const binding of normalized.values()) {
      const key = bindingChatKey(binding);
      byChat.set(key, [...(byChat.get(key) || []), binding]);
    }
    for (const chatBindings of byChat.values()) {
      const activeBindings = chatBindings.filter((binding) => binding.active !== false);
      const activeBinding = (activeBindings.length > 0 ? activeBindings : chatBindings)
        .sort(compareBindingUpdatedAtDesc)[0];
      if (!activeBinding) continue;

      for (const binding of chatBindings) {
        const shouldBeActive = binding.id === activeBinding.id;
        if (binding.active !== shouldBeActive) {
          normalized.set(binding.id, { ...binding, active: shouldBeActive });
          changed = true;
        }
      }
    }

    this.bindings = normalized;
    if (changed) {
      this.persistBindings();
    }
  }

  private reloadChannelDefaultTargets(): void {
    const targets = readJson<Record<string, ChannelDefaultTarget>>(
      CHANNEL_DEFAULT_TARGETS_PATH,
      {},
    );
    const normalized = new Map<string, ChannelDefaultTarget>();
    let changed = false;

    for (const target of Object.values(targets)) {
      const normalizedTarget = normalizeChannelDefaultTarget(target);
      if (didChannelDefaultTargetChange(target, normalizedTarget)) {
        changed = true;
      }
      normalized.set(normalizedTarget.channelType, normalizedTarget);
    }

    this.channelDefaultTargets = normalized;
    if (changed) {
      this.persistChannelDefaultTargets();
    }
  }

  private persistSessions(): void {
    writeJson(
      path.join(DATA_DIR, 'sessions.json'),
      Object.fromEntries(this.sessions),
    );
  }

  private persistBindings(): void {
    writeJson(
      path.join(DATA_DIR, 'bindings.json'),
      Object.fromEntries(this.bindings),
    );
  }

  private persistChannelDefaultTargets(): void {
    writeJson(
      CHANNEL_DEFAULT_TARGETS_PATH,
      Object.fromEntries(this.channelDefaultTargets),
    );
  }

  private persistPermissions(): void {
    writeJson(
      path.join(DATA_DIR, 'permissions.json'),
      Object.fromEntries(this.permissionLinks),
    );
  }

  private persistOffsets(): void {
    writeJson(
      path.join(DATA_DIR, 'offsets.json'),
      Object.fromEntries(this.offsets),
    );
  }

  private persistDedup(): void {
    writeJson(
      path.join(DATA_DIR, 'dedup.json'),
      Object.fromEntries(this.dedupKeys),
    );
  }

  private persistAudit(): void {
    writeJson(path.join(DATA_DIR, 'audit.json'), this.auditLog);
  }

  private persistMessages(sessionId: string): void {
    const msgs = this.messages.get(sessionId) || [];
    writeJson(path.join(MESSAGES_DIR, `${sessionId}.json`), msgs);
  }

  private loadMessages(sessionId: string): BridgeMessage[] {
    if (this.messages.has(sessionId)) {
      return this.messages.get(sessionId)!;
    }
    const msgs = readJson<BridgeMessage[]>(
      path.join(MESSAGES_DIR, `${sessionId}.json`),
      [],
    );
    this.messages.set(sessionId, msgs);
    return msgs;
  }

  // ── Settings ──

  private refreshSettings(): void {
    if (!this.dynamicSettings) return;
    try {
      const next = configToSettings(loadConfig());
      this.settings = new Map([
        ...this.settings,
        ...next,
      ]);
    } catch {
      // Keep the last known settings if the config file is temporarily unreadable.
    }
  }

  getSetting(key: string): string | null {
    this.refreshSettings();
    return this.settings.get(key) ?? null;
  }

  // ── Channel Bindings ──

  private getBindingsForChat(channelType: string, chatId: string): ChannelBinding[] {
    return Array.from(this.bindings.values()).filter((binding) => (
      binding.channelType === channelType && binding.chatId === chatId
    ));
  }

  private enforceChatActiveBinding(channelType: string, chatId: string, preferredActiveId?: string): void {
    const chatBindings = this.getBindingsForChat(channelType, chatId);
    if (chatBindings.length === 0) return;

    const preferred = preferredActiveId
      ? chatBindings.find((binding) => binding.id === preferredActiveId)
      : undefined;
    const currentActive = chatBindings
      .filter((binding) => binding.active !== false)
      .sort(compareBindingUpdatedAtDesc)[0];
    const nextActive = preferred
      || currentActive
      || [...chatBindings].sort(compareBindingUpdatedAtDesc)[0];

    for (const binding of chatBindings) {
      this.bindings.set(binding.id, {
        ...binding,
        active: binding.id === nextActive.id,
      });
    }
  }

  getChannelBinding(channelType: string, chatId: string): ChannelBinding | null {
    this.reloadBindings();
    return this.getBindingsForChat(channelType, chatId)
      .filter((binding) => binding.active !== false)
      .sort(compareBindingUpdatedAtDesc)[0] ?? null;
  }

  upsertChannelBinding(data: UpsertChannelBindingInput): ChannelBinding {
    this.reloadBindings();
    const shouldActivate = data.active !== false;
    const existing = Array.from(this.bindings.values()).find((binding) => bindingTargetMatches(binding, data));
    if (existing) {
      const updated: ChannelBinding = {
        ...existing,
        bridgeSessionId: data.bridgeSessionId,
        channelProvider: data.channelProvider ?? existing.channelProvider,
        channelAlias: data.channelAlias ?? existing.channelAlias,
        chatUserId: data.chatUserId ?? existing.chatUserId,
        chatDisplayName: data.chatDisplayName ?? existing.chatDisplayName,
        workingDirectory: data.workingDirectory,
        model: data.model,
        mode: data.mode === undefined ? existing.mode : normalizeStoredMode(data.mode),
        active: shouldActivate ? true : existing.active,
        updatedAt: now(),
      };
      this.bindings.set(updated.id, updated);
      this.enforceChatActiveBinding(data.channelType, data.chatId, shouldActivate ? updated.id : undefined);
      this.persistBindings();
      return this.bindings.get(updated.id) || updated;
    }
    const timestamp = now();
    const binding: ChannelBinding = {
      id: uuid(),
      channelType: data.channelType,
      channelProvider: data.channelProvider,
      channelAlias: data.channelAlias,
      chatId: data.chatId,
      chatUserId: data.chatUserId,
      chatDisplayName: data.chatDisplayName,
      bridgeSessionId: data.bridgeSessionId,
      workingDirectory: data.workingDirectory,
      model: data.model,
      mode: normalizeStoredMode(data.mode || this.getSetting('bridge_default_mode') || 'normal'),
      active: shouldActivate,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.bindings.set(binding.id, binding);
    this.enforceChatActiveBinding(data.channelType, data.chatId, shouldActivate ? binding.id : undefined);
    this.persistBindings();
    return this.bindings.get(binding.id) || binding;
  }

  deleteChannelBinding(id: string): void {
    this.reloadBindings();
    const binding = this.bindings.get(id);
    if (!binding) return;
    this.bindings.delete(id);
    this.enforceChatActiveBinding(binding.channelType, binding.chatId);
    this.persistBindings();
  }

  updateChannelBinding(id: string, updates: Partial<ChannelBinding>): void {
    this.reloadBindings();
    const binding = this.bindings.get(id);
    if (!binding) return;
    const updated = { ...binding, ...updates, id: binding.id, updatedAt: now() };
    this.bindings.set(id, updated);
    this.enforceChatActiveBinding(updated.channelType, updated.chatId, updates.active === true ? id : undefined);
    this.persistBindings();
  }

  listChannelBindings(channelType?: ChannelType): ChannelBinding[] {
    this.reloadBindings();
    const all = Array.from(this.bindings.values());
    if (!channelType) return all;
    return all.filter((b) => b.channelType === channelType);
  }

  getChannelDefaultTarget(channelType: string): ChannelDefaultTarget | null {
    this.reloadChannelDefaultTargets();
    return this.channelDefaultTargets.get(channelType) ?? null;
  }

  upsertChannelDefaultTarget(data: UpsertChannelDefaultTargetInput): ChannelDefaultTarget {
    this.reloadChannelDefaultTargets();
    const existing = this.channelDefaultTargets.get(data.channelType);
    if (existing) {
      const updated: ChannelDefaultTarget = {
        ...existing,
        bridgeSessionId: data.bridgeSessionId,
        channelProvider: data.channelProvider ?? existing.channelProvider,
        channelAlias: data.channelAlias ?? existing.channelAlias,
        updatedAt: now(),
      };
      this.channelDefaultTargets.set(data.channelType, updated);
      this.persistChannelDefaultTargets();
      return updated;
    }

    const target: ChannelDefaultTarget = {
      id: uuid(),
      channelType: data.channelType,
      channelProvider: data.channelProvider,
      channelAlias: data.channelAlias,
      bridgeSessionId: data.bridgeSessionId,
      createdAt: now(),
      updatedAt: now(),
    };
    this.channelDefaultTargets.set(data.channelType, target);
    this.persistChannelDefaultTargets();
    return target;
  }

  deleteChannelDefaultTarget(channelType: string): void {
    this.reloadChannelDefaultTargets();
    if (this.channelDefaultTargets.delete(channelType)) {
      this.persistChannelDefaultTargets();
    }
  }

  listChannelDefaultTargets(): ChannelDefaultTarget[] {
    this.reloadChannelDefaultTargets();
    return Array.from(this.channelDefaultTargets.values());
  }

  // ── Sessions ──

  getSession(id: string): BridgeSession | null {
    this.reloadSessions();
    return this.sessions.get(id) ?? null;
  }

  listSessions(): BridgeSession[] {
    this.reloadSessions();
    return Array.from(this.sessions.values());
  }

  findSessionByCodexThreadId(codexThreadId: string): BridgeSession | null {
    this.reloadSessions();
    const normalized = codexThreadId.trim();
    if (!normalized) return null;
    for (const session of this.sessions.values()) {
      if (session.codex_thread_id === normalized) {
        return session;
      }
    }
    return null;
  }

  createSession(
    name: string,
    model: string,
    systemPrompt?: string,
    cwd?: string,
    mode?: string,
    options?: {
      reasoningEffort?: BridgeSession['reasoning_effort'];
      sessionType?: BridgeSession['session_type'];
      hidden?: boolean;
      parentSessionId?: string;
      expiresAt?: string;
    },
  ): BridgeSession {
    this.reloadSessions();
    const timestamp = now();
    const session: BridgeSession = {
      id: uuid(),
      name,
      working_directory: cwd || process.cwd(),
      model,
      preferred_mode: normalizeStoredMode(mode || this.getSetting('bridge_default_mode') || 'normal') as BridgeSession['preferred_mode'],
      system_prompt: systemPrompt,
      reasoning_effort: options?.reasoningEffort,
      session_type: options?.sessionType || 'normal',
      hidden: options?.hidden === true,
      parent_session_id: options?.parentSessionId,
      expires_at: options?.expiresAt,
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.sessions.set(session.id, session);
    this.persistSessions();
    return session;
  }

  updateSessionProviderId(sessionId: string, providerId: string): void {
    this.reloadSessions();
    const s = this.sessions.get(sessionId);
    if (s) {
      s.provider_id = providerId;
      s.updated_at = now();
      this.persistSessions();
    }
  }

  updateSession(sessionId: string, updates: Partial<BridgeSession>, options?: { touch?: boolean }): void {
    this.reloadSessions();
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const next: BridgeSession = {
      ...session,
      ...updates,
      id: session.id,
      updated_at: options?.touch === false ? session.updated_at : now(),
    };
    this.sessions.set(sessionId, next);
    this.persistSessions();
  }

  deleteSession(sessionId: string): void {
    this.reloadSessions();
    this.reloadBindings();
    this.sessions.delete(sessionId);
    for (const [key, binding] of this.bindings) {
      if (binding.bridgeSessionId === sessionId) {
        this.bindings.delete(key);
      }
    }
    this.messages.delete(sessionId);
    try {
      fs.rmSync(path.join(MESSAGES_DIR, `${sessionId}.json`), { force: true });
    } catch {
      // best effort
    }
    this.persistSessions();
    this.persistBindings();
  }

  // ── Messages ──

  addMessage(sessionId: string, role: string, content: string, _usage?: string | null): void {
    const msgs = this.loadMessages(sessionId);
    msgs.push({ role, content, timestamp: now() });
    this.persistMessages(sessionId);
  }

  getMessages(sessionId: string, opts?: { limit?: number }): { messages: BridgeMessage[] } {
    const msgs = this.loadMessages(sessionId);
    if (opts?.limit && opts.limit > 0) {
      return { messages: msgs.slice(-opts.limit) };
    }
    return { messages: [...msgs] };
  }

  // ── Session Locking ──

  acquireSessionLock(sessionId: string, lockId: string, owner: string, ttlSecs: number): boolean {
    const existing = this.locks.get(sessionId);
    if (existing && existing.expiresAt > Date.now()) {
      // Lock held by someone else
      if (existing.lockId !== lockId) return false;
    }
    this.locks.set(sessionId, {
      lockId,
      owner,
      expiresAt: Date.now() + ttlSecs * 1000,
    });
    return true;
  }

  renewSessionLock(sessionId: string, lockId: string, ttlSecs: number): void {
    const lock = this.locks.get(sessionId);
    if (lock && lock.lockId === lockId) {
      lock.expiresAt = Date.now() + ttlSecs * 1000;
    }
  }

  releaseSessionLock(sessionId: string, lockId: string): void {
    const lock = this.locks.get(sessionId);
    if (lock && lock.lockId === lockId) {
      this.locks.delete(sessionId);
    }
  }

  setSessionRuntimeStatus(_sessionId: string, _status: string): void {
    this.reloadSessions();
    const session = this.sessions.get(_sessionId);
    if (!session) return;

    const queuedCount = session.queued_count && session.queued_count > 0
      ? session.queued_count
      : 0;
    let runtimeStatus: BridgeSession['runtime_status'];

    if (_status === 'running') {
      runtimeStatus = queuedCount > 0 ? 'queued' : 'running';
    } else if (_status === 'idle') {
      runtimeStatus = queuedCount > 0 ? 'queued' : 'idle';
    } else {
      runtimeStatus = session.runtime_status;
    }

    const next: BridgeSession = {
      ...session,
      runtime_status: runtimeStatus,
      last_runtime_update_at: now(),
      updated_at: now(),
    };
    this.sessions.set(_sessionId, next);
    this.persistSessions();
  }

  // ── Codex Thread ──

  updateSessionCodexThreadId(sessionId: string, codexThreadId: string): void {
    this.reloadSessions();
    const s = this.sessions.get(sessionId);
    if (s) {
      if (codexThreadId) {
        s.codex_thread_id = codexThreadId;
      } else {
        delete s.codex_thread_id;
      }
      s.updated_at = now();
      this.persistSessions();
    }
  }

  updateSessionModel(sessionId: string, model: string): void {
    this.reloadSessions();
    const s = this.sessions.get(sessionId);
    if (s) {
      s.model = model;
      s.updated_at = now();
      this.persistSessions();
    }
  }

  syncSdkTasks(_sessionId: string, _todos: unknown): void {
    // no-op
  }

  // ── Provider ──

  getProvider(_id: string): BridgeApiProvider | undefined {
    return undefined;
  }

  getDefaultProviderId(): string | null {
    return null;
  }

  // ── Audit & Dedup ──

  insertAuditLog(entry: AuditLogInput): void {
    this.auditLog.push({
      ...entry,
      id: uuid(),
      createdAt: now(),
    });
    // Ring buffer: keep last 1000
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-1000);
    }
    this.persistAudit();
  }

  checkDedup(key: string): boolean {
    const ts = this.dedupKeys.get(key);
    if (ts === undefined) return false;
    // 5 minute window
    if (Date.now() - ts > 5 * 60 * 1000) {
      this.dedupKeys.delete(key);
      return false;
    }
    return true;
  }

  insertDedup(key: string): void {
    this.dedupKeys.set(key, Date.now());
    this.persistDedup();
  }

  cleanupExpiredDedup(): void {
    const cutoff = Date.now() - 5 * 60 * 1000;
    let changed = false;
    for (const [key, ts] of this.dedupKeys) {
      if (ts < cutoff) {
        this.dedupKeys.delete(key);
        changed = true;
      }
    }
    if (changed) this.persistDedup();
  }

  insertOutboundRef(_ref: OutboundRefInput): void {
    // no-op for file-based store
  }

  // ── Permission Links ──

  insertPermissionLink(link: PermissionLinkInput): void {
    const record: PermissionLinkRecord = {
      permissionRequestId: link.permissionRequestId,
      chatId: link.chatId,
      messageId: link.messageId,
      sessionId: link.sessionId,
      resolved: false,
      suggestions: link.suggestions,
    };
    this.permissionLinks.set(link.permissionRequestId, record);
    this.persistPermissions();
  }

  getPermissionLink(permissionRequestId: string): PermissionLinkRecord | null {
    return this.permissionLinks.get(permissionRequestId) ?? null;
  }

  markPermissionLinkResolved(permissionRequestId: string): boolean {
    const link = this.permissionLinks.get(permissionRequestId);
    if (!link || link.resolved) return false;
    link.resolved = true;
    this.persistPermissions();
    return true;
  }

  listPendingPermissionLinksByChat(chatId: string): PermissionLinkRecord[] {
    const result: PermissionLinkRecord[] = [];
    for (const link of this.permissionLinks.values()) {
      if (link.chatId === chatId && !link.resolved) {
        result.push(link);
      }
    }
    return result;
  }

  // ── Channel Offsets ──

  getChannelOffset(key: string): string {
    return this.offsets.get(key) ?? '0';
  }

  setChannelOffset(key: string, offset: string): void {
    this.offsets.set(key, offset);
    this.persistOffsets();
  }
}
