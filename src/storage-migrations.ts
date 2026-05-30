import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { CTI_HOME } from './config.js';

interface MigrationOptions {
  ctiHome?: string;
  now?: () => Date;
  logger?: Pick<Console, 'log' | 'warn'> | false;
}

export interface StorageMigrationResult {
  changed: boolean;
  changedFiles: string[];
  createdSessions: number;
  migratedSessions: number;
  migratedBindings: number;
  migratedChannelDefaultTargets: number;
  migratedUiSessionNames: number;
  removedFields: number;
  errors: string[];
}

const SESSION_THREAD_SOURCE_FIELDS = [
  'desktop_thread_id',
  'desktopThreadId',
  'sdk_session_id',
  'sdkSessionId',
  'thread_id',
  'threadId',
];

const RETIRED_SESSION_FIELDS = [
  'desktop_thread_id',
  'desktopThreadId',
  'sdk_session_id',
  'sdkSessionId',
  'thread_origin',
  'threadOrigin',
  'thread_id',
  'threadId',
];

const BINDING_THREAD_SOURCE_FIELDS = [
  'codex_thread_id',
  'codexThreadId',
  'desktop_thread_id',
  'desktopThreadId',
  'sdk_session_id',
  'sdkSessionId',
  'thread_id',
  'threadId',
];

const RETIRED_BINDING_FIELDS = [
  'codepilotSessionId',
  'codepilot_session_id',
  'codex_thread_id',
  'codexThreadId',
  'desktop_thread_id',
  'desktopThreadId',
  'sdk_session_id',
  'sdkSessionId',
  'thread_origin',
  'threadOrigin',
  'thread_id',
  'threadId',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readJsonRecord(filePath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = readString(record, key);
    if (value) return value;
  }
  return undefined;
}

function removeFields(record: Record<string, unknown>, fields: string[]): number {
  let removed = 0;
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(record, field)) {
      delete record[field];
      removed += 1;
    }
  }
  return removed;
}

function uniqueSessionId(sessions: Record<string, unknown>, seed: string | undefined): string {
  const normalizedSeed = seed?.trim();
  if (normalizedSeed && !Object.prototype.hasOwnProperty.call(sessions, normalizedSeed)) {
    return normalizedSeed;
  }

  for (let i = 0; i < 10; i += 1) {
    const id = `migrated-${crypto.randomUUID()}`;
    if (!Object.prototype.hasOwnProperty.call(sessions, id)) return id;
  }

  return `migrated-${Date.now()}`;
}

function normalizeMode(value: unknown): 'normal' | 'yolo' {
  return value === 'yolo' ? 'yolo' : 'normal';
}

function createSessionFromBinding(
  sessions: Record<string, unknown>,
  requestedId: string | undefined,
  binding: Record<string, unknown>,
  codexThreadId: string,
  nowIso: string,
): Record<string, unknown> {
  const id = uniqueSessionId(sessions, requestedId);
  const chatDisplayName = readString(binding, 'chatDisplayName');
  const chatId = readString(binding, 'chatId');
  const session: Record<string, unknown> = {
    id,
    name: chatDisplayName || chatId ? `Bridge: ${chatDisplayName || chatId}` : 'Migrated Bridge Session',
    working_directory: readString(binding, 'workingDirectory') || process.cwd(),
    model: readString(binding, 'model') || 'default',
    preferred_mode: normalizeMode(binding.mode),
    codex_thread_id: codexThreadId,
    session_type: 'normal',
    hidden: false,
    created_at: readString(binding, 'createdAt') || nowIso,
    updated_at: nowIso,
  };
  sessions[id] = session;
  return session;
}

function migrateSessions(
  sessions: Record<string, unknown>,
): Pick<StorageMigrationResult, 'migratedSessions' | 'removedFields'> & { changed: boolean } {
  let changed = false;
  let migratedSessions = 0;
  let removedFields = 0;

  for (const [key, value] of Object.entries(sessions)) {
    if (!isRecord(value)) continue;
    const threadId = firstString(value, SESSION_THREAD_SOURCE_FIELDS);
    const hadCodexThreadId = Boolean(readString(value, 'codex_thread_id'));
    if (threadId && !hadCodexThreadId) {
      value.codex_thread_id = threadId;
      migratedSessions += 1;
      changed = true;
    }

    if (!readString(value, 'id')) {
      value.id = key;
      changed = true;
    }

    const removed = removeFields(value, RETIRED_SESSION_FIELDS);
    if (removed > 0) {
      removedFields += removed;
      changed = true;
    }
  }

  return { changed, migratedSessions, removedFields };
}

function migrateBindings(
  bindings: Record<string, unknown>,
  sessions: Record<string, unknown>,
  nowIso: string,
): Pick<StorageMigrationResult, 'createdSessions' | 'migratedBindings' | 'removedFields'> & {
  bindingsChanged: boolean;
  sessionsChanged: boolean;
} {
  let bindingsChanged = false;
  let sessionsChanged = false;
  let createdSessions = 0;
  let migratedBindings = 0;
  let removedFields = 0;

  for (const [key, value] of Object.entries(bindings)) {
    if (!isRecord(value)) continue;

    if (!readString(value, 'id')) {
      value.id = key;
      bindingsChanged = true;
    }

    const bindingThreadId = firstString(value, BINDING_THREAD_SOURCE_FIELDS);
    let sessionId = readString(value, 'bridgeSessionId');
    const legacySessionId = firstString(value, [
      'codepilotSessionId',
      'codepilot_session_id',
      'bridge_session_id',
    ]);
    if (!sessionId && legacySessionId) {
      sessionId = legacySessionId;
      value.bridgeSessionId = legacySessionId;
      bindingsChanged = true;
    }

    if (bindingThreadId) {
      let session = sessionId && isRecord(sessions[sessionId]) ? sessions[sessionId] as Record<string, unknown> : null;
      if (!session) {
        session = createSessionFromBinding(sessions, sessionId, value, bindingThreadId, nowIso);
        sessionId = readString(session, 'id');
        value.bridgeSessionId = sessionId;
        createdSessions += 1;
        sessionsChanged = true;
        bindingsChanged = true;
      } else if (!readString(session, 'codex_thread_id')) {
        session.codex_thread_id = bindingThreadId;
        session.updated_at = readString(session, 'updated_at') || nowIso;
        sessionsChanged = true;
      }

      migratedBindings += 1;
    }

    const removed = removeFields(value, RETIRED_BINDING_FIELDS);
    if (removed > 0) {
      removedFields += removed;
      bindingsChanged = true;
    }
  }

  return {
    bindingsChanged,
    sessionsChanged,
    createdSessions,
    migratedBindings,
    removedFields,
  };
}

function migrateUiSessionMeta(
  uiSessionMeta: Record<string, unknown>,
  sessions: Record<string, unknown>,
  nowIso: string,
): Pick<StorageMigrationResult, 'createdSessions' | 'migratedUiSessionNames'> & { sessionsChanged: boolean } {
  let sessionsChanged = false;
  let createdSessions = 0;
  let migratedUiSessionNames = 0;

  for (const [metaKey, value] of Object.entries(uiSessionMeta)) {
    if (!isRecord(value)) continue;
    const name = readString(value, 'name');
    if (!name) continue;

    if (metaKey.startsWith('session:')) {
      const sessionId = metaKey.slice('session:'.length);
      const session = isRecord(sessions[sessionId]) ? sessions[sessionId] as Record<string, unknown> : null;
      if (!session) continue;
      if (readString(session, 'name') !== name) {
        session.name = name;
        session.updated_at = readString(session, 'updated_at') || nowIso;
        sessionsChanged = true;
      }
      migratedUiSessionNames += 1;
      continue;
    }

    // Retired selector keys such as desktop:<threadId> are intentionally not
    // materialized into new BridgeSession records.
  }

  return { sessionsChanged, createdSessions, migratedUiSessionNames };
}

function migrateChannelDefaultTargets(
  targets: Record<string, unknown>,
): Pick<StorageMigrationResult, 'migratedChannelDefaultTargets' | 'removedFields'> & {
  targetsChanged: boolean;
} {
  let targetsChanged = false;
  let migratedChannelDefaultTargets = 0;
  let removedFields = 0;

  for (const [key, value] of Object.entries(targets)) {
    if (!isRecord(value)) {
      delete targets[key];
      targetsChanged = true;
      continue;
    }

    if (!readString(value, 'id')) {
      value.id = key;
      targetsChanged = true;
    }
    if (!readString(value, 'channelType')) {
      value.channelType = key;
      targetsChanged = true;
    }

    if (!readString(value, 'bridgeSessionId')) {
      delete targets[key];
      targetsChanged = true;
      continue;
    }

    migratedChannelDefaultTargets += 1;
  }

  return {
    targetsChanged,
    migratedChannelDefaultTargets,
    removedFields,
  };
}

export function runStartupStorageMigrations(options: MigrationOptions = {}): StorageMigrationResult {
  const ctiHome = options.ctiHome || CTI_HOME;
  const logger = options.logger === undefined ? console : options.logger;
  const nowIso = (options.now ? options.now() : new Date()).toISOString();
  const dataDir = path.join(ctiHome, 'data');
  const sessionsPath = path.join(dataDir, 'sessions.json');
  const bindingsPath = path.join(dataDir, 'bindings.json');
  const channelDefaultTargetsPath = path.join(dataDir, 'channel-default-targets.json');
  const uiSessionMetaPath = path.join(dataDir, 'ui-session-meta.json');
  const result: StorageMigrationResult = {
    changed: false,
    changedFiles: [],
    createdSessions: 0,
    migratedSessions: 0,
    migratedBindings: 0,
    migratedChannelDefaultTargets: 0,
    migratedUiSessionNames: 0,
    removedFields: 0,
    errors: [],
  };

  const sessionsExists = fs.existsSync(sessionsPath);
  const bindingsExists = fs.existsSync(bindingsPath);
  const channelDefaultTargetsExists = fs.existsSync(channelDefaultTargetsPath);
  const uiSessionMetaExists = fs.existsSync(uiSessionMetaPath);
  const sessions = sessionsExists ? readJsonRecord(sessionsPath) : {};
  const bindings = bindingsExists ? readJsonRecord(bindingsPath) : {};
  const channelDefaultTargets = channelDefaultTargetsExists ? readJsonRecord(channelDefaultTargetsPath) : {};
  const uiSessionMeta = uiSessionMetaExists ? readJsonRecord(uiSessionMetaPath) : {};

  if (sessionsExists && !sessions) {
    result.errors.push(`Cannot parse ${sessionsPath}`);
  }
  if (bindingsExists && !bindings) {
    result.errors.push(`Cannot parse ${bindingsPath}`);
  }
  if (channelDefaultTargetsExists && !channelDefaultTargets) {
    result.errors.push(`Cannot parse ${channelDefaultTargetsPath}`);
  }
  if (uiSessionMetaExists && !uiSessionMeta) {
    result.errors.push(`Cannot parse ${uiSessionMetaPath}`);
  }
  if (!sessions || !bindings || !channelDefaultTargets || !uiSessionMeta) {
    for (const error of result.errors) logger && logger.warn(`[codex-to-im] Storage migration skipped: ${error}`);
    return result;
  }

  const sessionMigration = migrateSessions(sessions);
  const bindingMigration = migrateBindings(bindings, sessions, nowIso);
  const channelDefaultTargetMigration = migrateChannelDefaultTargets(channelDefaultTargets);
  const uiSessionMetaMigration = migrateUiSessionMeta(uiSessionMeta, sessions, nowIso);
  result.createdSessions += bindingMigration.createdSessions;
  result.createdSessions += uiSessionMetaMigration.createdSessions;
  result.migratedSessions += sessionMigration.migratedSessions;
  result.migratedBindings += bindingMigration.migratedBindings;
  result.migratedChannelDefaultTargets += channelDefaultTargetMigration.migratedChannelDefaultTargets;
  result.migratedUiSessionNames += uiSessionMetaMigration.migratedUiSessionNames;
  result.removedFields += sessionMigration.removedFields + bindingMigration.removedFields + channelDefaultTargetMigration.removedFields;

  if (
    sessionMigration.changed
    || bindingMigration.sessionsChanged
    || uiSessionMetaMigration.sessionsChanged
  ) {
    atomicWriteJson(sessionsPath, sessions);
    result.changedFiles.push(sessionsPath);
  }
  if (bindingMigration.bindingsChanged) {
    atomicWriteJson(bindingsPath, bindings);
    result.changedFiles.push(bindingsPath);
  }
  if (channelDefaultTargetMigration.targetsChanged) {
    atomicWriteJson(channelDefaultTargetsPath, channelDefaultTargets);
    result.changedFiles.push(channelDefaultTargetsPath);
  }
  if (uiSessionMetaExists) {
    fs.rmSync(uiSessionMetaPath, { force: true });
    result.changedFiles.push(uiSessionMetaPath);
  }

  result.changed = result.changedFiles.length > 0;
  if (result.changed) {
    logger && logger.log(
      `[codex-to-im] 已自动迁移旧存储数据：sessions=${result.migratedSessions}, bindings=${result.migratedBindings}, channel_defaults=${result.migratedChannelDefaultTargets}, ui_names=${result.migratedUiSessionNames}, created_sessions=${result.createdSessions}, removed_fields=${result.removedFields}`,
    );
  }

  return result;
}
