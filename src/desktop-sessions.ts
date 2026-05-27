import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { BridgeMessage } from './lib/bridge/host.js';
import type { TaskProgressInfo } from './lib/bridge/types.js';

export interface DesktopSessionSummary {
  threadId: string;
  filePath: string;
  cwd: string;
  originator: string;
  source?: string;
  cliVersion?: string;
  firstSeenAt: string;
  lastEventAt: string;
  title: string;
  activeEstimate: boolean;
}

export interface DesktopSessionEvent {
  signature: string;
  role: 'user' | 'assistant' | 'commentary';
  content: string;
  timestamp: string;
}

export interface DesktopSessionEventDelta {
  events: DesktopSessionEvent[];
  nextOffset: number;
  trailingText: string;
}

export interface DesktopMirrorRecord {
  signature: string;
  type: 'message' | 'reasoning' | 'plan_update' | 'task_started' | 'task_complete' | 'task_aborted' | 'tool_started' | 'tool_finished';
  role?: 'user' | 'assistant' | 'commentary';
  content: string;
  timestamp: string;
  turnId?: string;
  toolId?: string;
  toolName?: string;
  isError?: boolean;
  tasks?: TaskProgressInfo[];
}

export interface DesktopMirrorRecordDelta {
  records: DesktopMirrorRecord[];
  nextOffset: number;
  trailingText: string;
  nextTurnId: string | null;
  nextSpecialCallIds: string[];
  unknownKinds: string[];
}

interface SessionMetaLine {
  timestamp?: string;
  type?: string;
  payload?: {
    id?: string;
    timestamp?: string;
    cwd?: string;
    originator?: unknown;
    cli_version?: unknown;
    source?: unknown;
  };
}

interface SessionMessageLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    role?: string;
    phase?: string;
    name?: unknown;
    namespace?: unknown;
    arguments?: string;
    execution?: unknown;
    call_id?: unknown;
    output?: unknown;
    is_error?: boolean;
    status?: unknown;
    input?: unknown;
    query?: unknown;
    server?: unknown;
    tool?: unknown;
    summary?: unknown;
    aggregated_output?: unknown;
    formatted_output?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    exit_code?: unknown;
    success?: unknown;
    changes?: unknown;
    tools?: unknown;
    content?: Array<{
      type?: string;
      text?: unknown;
    }>;
  };
}

interface SessionEventLine {
  timestamp?: string;
  type?: string;
  payload?: {
    type?: string;
    message?: unknown;
    text?: unknown;
    phase?: unknown;
    last_agent_message?: unknown;
    turn_id?: string;
    turnId?: string;
    reason?: unknown;
    call_id?: unknown;
    callId?: unknown;
    query?: unknown;
    command?: unknown;
    aggregated_output?: unknown;
    formatted_output?: unknown;
    stdout?: unknown;
    stderr?: unknown;
    exit_code?: unknown;
    status?: unknown;
    success?: unknown;
    changes?: unknown;
    tool?: unknown;
    arguments?: unknown;
    content_items?: unknown;
    error?: unknown;
    invocation?: {
      server?: unknown;
      tool?: unknown;
      arguments?: unknown;
    };
  };
}

interface TurnContextLine {
  timestamp?: string;
  type?: string;
  payload?: {
    turn_id?: string;
  };
}

interface SessionIndexLine {
  id?: string;
  thread_name?: string;
  updated_at?: string;
}

interface ThreadIndexEntry {
  title: string;
  updatedAt: string;
}

interface VisibleDesktopThreadRow {
  id: string;
  updatedAtMs: number;
}

interface CodexGlobalState {
  'electron-saved-workspace-roots'?: unknown;
}

const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
const MAX_SESSION_META_BYTES = 4 * 1024 * 1024;
const MAX_SESSION_TITLE_SCAN_BYTES = 512 * 1024;
const TITLE_MAX_CHARS = 72;

function getCodexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

export function getCodexSessionsRoot(): string {
  return path.join(getCodexHome(), 'sessions');
}

function getArchivedSessionsRoot(): string {
  return path.join(getCodexHome(), 'archived_sessions');
}

function getSessionIndexPath(): string {
  return path.join(getCodexHome(), 'session_index.jsonl');
}

function getCodexGlobalStatePath(): string {
  return path.join(getCodexHome(), '.codex-global-state.json');
}

function getDesktopStateDbPath(): string | null {
  const codexHome = getCodexHome();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(codexHome, { withFileTypes: true });
  } catch {
    return null;
  }

  const candidates = entries
    .filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/i.test(entry.name))
    .map((entry) => path.join(codexHome, entry.name))
    .sort((left, right) => {
      try {
        return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
      } catch {
        return 0;
      }
    });

  return candidates[0] || null;
}

function extractThreadIdFromRolloutName(name: string): string | null {
  const match = name.match(/-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return match?.[1] || null;
}

function normalizeComparablePath(value: string): string {
  if (!value) return '';
  const stripped = value.replace(/^\\\\\?\\/, '');
  return path.resolve(stripped).replace(/[\\/]+$/, '').toLowerCase();
}

function isInternalSkillWorkspace(cwd: string): boolean {
  const normalizedCwd = normalizeComparablePath(cwd);
  if (!normalizedCwd) return false;

  const skillsRoot = normalizeComparablePath(path.join(getCodexHome(), 'skills'));
  if (!skillsRoot) return false;

  return normalizedCwd === skillsRoot || normalizedCwd.startsWith(`${skillsRoot}\\`) || normalizedCwd.startsWith(`${skillsRoot}/`);
}

function loadSavedWorkspaceRoots(): string[] | null {
  const statePath = getCodexGlobalStatePath();
  if (!fs.existsSync(statePath)) return null;

  let parsed: CodexGlobalState;
  try {
    parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as CodexGlobalState;
  } catch {
    return null;
  }

  const roots = Array.isArray(parsed['electron-saved-workspace-roots'])
    ? parsed['electron-saved-workspace-roots']
        .map((value) => (typeof value === 'string' ? normalizeComparablePath(value) : ''))
        .filter(Boolean)
    : [];

  return roots.length > 0 ? roots : null;
}

function isWithinSavedWorkspaceRoots(cwd: string, roots: string[] | null): boolean {
  if (!roots || roots.length === 0) return true;
  const normalizedCwd = normalizeComparablePath(cwd);
  if (!normalizedCwd) return false;

  return roots.some((root) =>
    normalizedCwd === root || normalizedCwd.startsWith(`${root}\\`) || normalizedCwd.startsWith(`${root}/`));
}

function loadArchivedThreadIds(): Set<string> {
  const archivedRoot = getArchivedSessionsRoot();
  if (!fs.existsSync(archivedRoot)) return new Set();

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(archivedRoot, { withFileTypes: true });
  } catch {
    return new Set();
  }

  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const threadId = extractThreadIdFromRolloutName(entry.name);
    if (threadId) ids.add(threadId);
  }
  return ids;
}

function readFirstLine(filePath: string, maxBytes = MAX_SESSION_META_BYTES): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunks: Buffer[] = [];
    let bytesReadTotal = 0;
    const buffer = Buffer.alloc(4096);

    while (bytesReadTotal < maxBytes) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, bytesReadTotal);
      if (bytesRead <= 0) break;

      const slice = Buffer.from(buffer.subarray(0, bytesRead));
      chunks.push(slice);
      bytesReadTotal += bytesRead;

      const newlineIndex = slice.indexOf(0x0a);
      if (newlineIndex !== -1) {
        const combined = Buffer.concat(chunks);
        return combined.subarray(0, combined.indexOf(0x0a)).toString('utf-8').replace(/\r$/, '');
      }
    }

    return Buffer.concat(chunks).toString('utf-8').split(/\r?\n/, 1)[0] || '';
  } finally {
    fs.closeSync(fd);
  }
}

function readFilePrefix(filePath: string, maxBytes = MAX_SESSION_TITLE_SCAN_BYTES): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(maxBytes, 64 * 1024));
    const chunks: Buffer[] = [];
    let offset = 0;

    while (offset < maxBytes) {
      const bytesToRead = Math.min(buffer.length, maxBytes - offset);
      const bytesRead = fs.readSync(fd, buffer, 0, bytesToRead, offset);
      if (bytesRead <= 0) break;
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      offset += bytesRead;
    }

    return Buffer.concat(chunks).toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

function walkSessionFiles(dirPath: string, target: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkSessionFiles(entryPath, target);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      target.push(entryPath);
    }
  }
}

function isSelectableCodexSession(meta: SessionMetaLine['payload']): boolean {
  const rawSource = meta?.source;
  if (rawSource != null && typeof rawSource !== 'string') return false;

  const originator = typeof meta?.originator === 'string' ? meta.originator.toLowerCase() : '';
  const source = typeof rawSource === 'string' ? rawSource.toLowerCase() : '';

  // Desktop can emit internal exec rollouts that are not user-selectable threads.
  if (source === 'exec' && originator.includes('desktop')) return false;

  return true;
}

function loadThreadIndexEntries(archivedThreadIds: Set<string>): Map<string, ThreadIndexEntry> {
  const indexPath = getSessionIndexPath();
  if (!fs.existsSync(indexPath)) return new Map();

  let content = '';
  try {
    content = fs.readFileSync(indexPath, 'utf-8');
  } catch {
    return new Map();
  }

  const titles = new Map<string, ThreadIndexEntry>();
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;

    let parsed: SessionIndexLine;
    try {
      parsed = JSON.parse(line) as SessionIndexLine;
    } catch {
      continue;
    }

    const threadId = parsed.id?.trim();
    const title = trimTitle(parsed.thread_name || '');
    if (!threadId || !title || archivedThreadIds.has(threadId)) continue;

    const updatedAt = parsed.updated_at || '';
    const existing = titles.get(threadId);
    if (!existing || updatedAt >= existing.updatedAt) {
      titles.set(threadId, { title, updatedAt });
    }
  }

  return titles;
}

function parseUpdatedAtValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const numeric = Number(value.trim());
    if (Number.isFinite(numeric)) {
      return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function loadVisibleDesktopThreads(limit?: number): VisibleDesktopThreadRow[] | null {
  const dbPath = getDesktopStateDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) return null;

  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const hasLimit = typeof limit === 'number' && Number.isFinite(limit) && limit > 0;
    const sql = `
      SELECT id, updated_at
      FROM threads
      WHERE archived = 0
      ORDER BY updated_at DESC
      ${hasLimit ? 'LIMIT ?' : ''}
    `;
    const rows = hasLimit
      ? db.prepare(sql).all(Math.max(1, Math.floor(limit!))) as Array<{ id?: string; updated_at?: string | number }>
      : db.prepare(sql).all() as Array<{ id?: string; updated_at?: string | number }>;

    const ids = rows
      .map((row) => {
        const id = typeof row.id === 'string' ? row.id.trim() : '';
        if (!id) return null;
        return {
          id,
          updatedAtMs: parseUpdatedAtValue(row.updated_at),
        } satisfies VisibleDesktopThreadRow;
      })
      .filter((row): row is VisibleDesktopThreadRow => Boolean(row));

    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

function buildFallbackTitle(threadId: string, filePath: string, cwd: string): string {
  try {
    const content = readFilePrefix(filePath);
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;

      let parsed: SessionMessageLine | SessionEventLine;
      try {
        parsed = JSON.parse(line) as SessionMessageLine | SessionEventLine;
      } catch {
        continue;
      }

      if (!isSessionEventLine(parsed) || parsed.payload?.type !== 'user_message') continue;

      const firstUserMessage = trimTitle(extractNormalizedFreeText(parsed.payload.message));
      if (firstUserMessage) return firstUserMessage;
    }
  } catch {
    // Best-effort fallback only.
  }

  const dirName = trimTitle(path.basename(cwd || ''));
  if (dirName) return dirName;
  return `Session ${threadId.slice(0, 8)}`;
}

function parseDesktopSession(
  filePath: string,
  threadIndexEntries: Map<string, ThreadIndexEntry>,
  archivedThreadIds: Set<string>,
): DesktopSessionSummary | null {
  const firstLine = readFirstLine(filePath);
  if (!firstLine) return null;

  let parsed: SessionMetaLine;
  try {
    parsed = JSON.parse(firstLine) as SessionMetaLine;
  } catch {
    return null;
  }

  if (parsed.type !== 'session_meta' || !parsed.payload?.id || !isSelectableCodexSession(parsed.payload)) {
    return null;
  }

  if (archivedThreadIds.has(parsed.payload.id)) {
    return null;
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }

  const cwd = parsed.payload.cwd || '';
  if (isInternalSkillWorkspace(cwd)) {
    return null;
  }
  const lastEventAt = stat.mtime.toISOString();
  const firstSeenAt = parsed.payload.timestamp || parsed.timestamp || stat.birthtime.toISOString();
  const threadId = parsed.payload.id;
  const title = threadIndexEntries.get(threadId)?.title || buildFallbackTitle(threadId, filePath, cwd);

  return {
    threadId,
    filePath,
    cwd,
    originator: typeof parsed.payload.originator === 'string' ? parsed.payload.originator : 'Codex Desktop',
    source: typeof parsed.payload.source === 'string' ? parsed.payload.source : undefined,
    cliVersion: typeof parsed.payload.cli_version === 'string' ? parsed.payload.cli_version : undefined,
    firstSeenAt,
    lastEventAt,
    title,
    activeEstimate: Date.now() - stat.mtimeMs < ACTIVE_WINDOW_MS,
  };
}

function trimTitle(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= TITLE_MAX_CHARS) return normalized;
  return `${normalized.slice(0, TITLE_MAX_CHARS - 3).trimEnd()}...`;
}

function normalizeFreeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalizeStructuredText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim();
}

function collectStructuredTextParts(value: unknown, parts: string[], depth = 0): void {
  if (value == null || depth > 6) return;
  if (typeof value === 'string') {
    parts.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStructuredTextParts(item, parts, depth + 1);
    }
    return;
  }
  if (typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') {
    parts.push(record.text);
  }
  if (typeof record.message === 'string') {
    parts.push(record.message);
  }
  if (typeof record.summary === 'string') {
    parts.push(record.summary);
  }
  if ('content' in record) {
    collectStructuredTextParts(record.content, parts, depth + 1);
  }
  if ('items' in record) {
    collectStructuredTextParts(record.items, parts, depth + 1);
  }
}

function extractNormalizedFreeText(value: unknown): string {
  if (typeof value === 'string') return normalizeFreeText(value);
  const parts: string[] = [];
  collectStructuredTextParts(value, parts);
  return parts.length > 0 ? normalizeFreeText(parts.join('\n')) : '';
}

function extractNormalizedStructuredText(value: unknown): string {
  if (typeof value === 'string') return normalizeStructuredText(value);
  const parts: string[] = [];
  collectStructuredTextParts(value, parts);
  return parts.length > 0 ? normalizeStructuredText(parts.join('\n\n')) : '';
}

function parseJsonSafely(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeTaskStatus(value: unknown): TaskProgressInfo['status'] {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'in_progress' || normalized === 'running' || normalized === 'active') {
    return 'in_progress';
  }
  if (normalized === 'completed' || normalized === 'complete' || normalized === 'done') {
    return 'completed';
  }
  return 'pending';
}

function parseTaskProgressItems(value: unknown): TaskProgressInfo[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = item as { step?: unknown; text?: unknown; status?: unknown };
      const text = extractNormalizedStructuredText(record.text ?? record.step);
      if (!text) return null;
      return {
        text,
        status: normalizeTaskStatus(record.status),
      } satisfies TaskProgressInfo;
    })
    .filter((item): item is TaskProgressInfo => Boolean(item));
}

function parseUpdatePlanTasks(argumentsJson: string | undefined): TaskProgressInfo[] {
  const parsed = parseJsonSafely(argumentsJson) as { plan?: unknown; tasks?: unknown } | null;
  if (!parsed || typeof parsed !== 'object') return [];
  return parseTaskProgressItems(parsed.plan ?? parsed.tasks);
}

function extractReasoningSummary(payload: { summary?: unknown; content?: unknown; text?: unknown; message?: unknown }): string {
  for (const value of [payload.summary, payload.content, payload.text, payload.message]) {
    const text = extractNormalizedStructuredText(value);
    if (text) return text;
  }
  return '';
}

function extractToolOutputText(value: unknown): string {
  if (typeof value !== 'string') return extractNormalizedFreeText(value);
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = parseJsonSafely(trimmed) as { output?: unknown } | null;
    if (parsed && typeof parsed === 'object') {
      const extracted = extractNormalizedFreeText(parsed.output ?? parsed);
      if (extracted) return extracted;
    }
  }
  return extractNormalizedFreeText(value);
}

function summarizePatchChanges(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value as Record<string, unknown>)
    .map(([filePath, detail]) => {
      const kind = detail && typeof detail === 'object'
        ? extractNormalizedFreeText((detail as { type?: unknown; kind?: unknown }).type ?? (detail as { kind?: unknown }).kind)
        : '';
      return kind ? `${kind}: ${filePath}` : filePath;
    })
    .filter(Boolean)
    .join('\n');
}

function summarizeToolSearchOutput(value: unknown): string {
  if (!Array.isArray(value)) return '';
  let count = 0;
  const names: string[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const namespaceName = extractNormalizedFreeText((entry as { name?: unknown }).name);
    if (namespaceName) names.push(namespaceName);
    const tools = (entry as { tools?: unknown }).tools;
    if (Array.isArray(tools)) count += tools.length;
  }
  const prefix = count > 0 ? `Found ${count} tools` : '';
  const suffix = names.length > 0 ? names.slice(0, 5).join(', ') : '';
  return [prefix, suffix].filter(Boolean).join(': ');
}

function getDynamicToolCallId(payload: { call_id?: unknown; callId?: unknown }): string {
  return extractNormalizedFreeText(payload.call_id ?? payload.callId);
}

function formatDesktopToolName(namespaceValue: unknown, nameValue: unknown): string {
  const name = extractNormalizedFreeText(nameValue);
  if (!name) return '';
  const namespace = extractNormalizedFreeText(namespaceValue);
  if (!namespace) return name;
  if (name.startsWith(namespace)) return name;
  return namespace.endsWith('__') || namespace.endsWith('/') || namespace.endsWith('.')
    ? `${namespace}${name}`
    : `${namespace}__${name}`;
}

function createDesktopEventSignature(rawLine: string): string {
  return crypto.createHash('sha1').update(rawLine).digest('hex');
}

function readFileUtf8Range(filePath: string, startOffset: number, endOffset: number): string {
  const safeStart = Math.max(0, startOffset);
  const safeEnd = Math.max(safeStart, endOffset);
  const bytesToRead = safeEnd - safeStart;
  if (bytesToRead <= 0) return '';

  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    let totalRead = 0;
    while (totalRead < bytesToRead) {
      const bytesRead = fs.readSync(fd, buffer, totalRead, bytesToRead - totalRead, safeStart + totalRead);
      if (bytesRead <= 0) break;
      totalRead += bytesRead;
    }
    return buffer.subarray(0, totalRead).toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

function isSessionEventLine(line: SessionMessageLine | SessionEventLine | TurnContextLine): line is SessionEventLine {
  return line.type === 'event_msg';
}

function isSessionMessageLine(line: SessionMessageLine | SessionEventLine | TurnContextLine): line is SessionMessageLine {
  return line.type === 'response_item';
}

function isTurnContextLine(line: SessionMessageLine | SessionEventLine | TurnContextLine): line is TurnContextLine {
  return line.type === 'turn_context';
}

const IGNORED_EVENT_MSG_TYPES = new Set([
  'thread_name_updated',
  'thread_rolled_back',
  'token_count',
]);

const CONTEXT_COMPACTED_NOTICE = '上下文已压缩，后续回复会基于压缩后的上下文继续。';

const IGNORED_RESPONSE_ITEM_TYPES = new Set([
  'web_search_call',
]);

function isIgnoredMirrorLineKind(line: SessionMessageLine | SessionEventLine | TurnContextLine): boolean {
  if (isSessionEventLine(line)) {
    const payloadType = typeof line.payload?.type === 'string' ? line.payload.type.trim() : '';
    return IGNORED_EVENT_MSG_TYPES.has(payloadType);
  }
  if (isSessionMessageLine(line)) {
    const payloadType = typeof line.payload?.type === 'string' ? line.payload.type.trim() : '';
    return IGNORED_RESPONSE_ITEM_TYPES.has(payloadType);
  }
  return false;
}

function describeUnhandledMirrorLineKind(
  line: SessionMessageLine | SessionEventLine | TurnContextLine,
): string | null {
  if (isIgnoredMirrorLineKind(line)) return null;
  if (isSessionEventLine(line)) {
    const payloadType = typeof line.payload?.type === 'string' ? line.payload.type.trim() : '';
    return `event_msg:${payloadType || '<unknown>'}`;
  }
  if (isSessionMessageLine(line)) {
    const payloadType = typeof line.payload?.type === 'string' ? line.payload.type.trim() : '';
    return `response_item:${payloadType || '<unknown>'}`;
  }
  return null;
}

export function listDesktopSessions(limit?: number): DesktopSessionSummary[] {
  const root = getCodexSessionsRoot();
  if (!fs.existsSync(root)) return [];
  const archivedThreadIds = loadArchivedThreadIds();
  const threadIndexEntries = loadThreadIndexEntries(archivedThreadIds);
  const savedWorkspaceRoots = loadSavedWorkspaceRoots();
  const visibleThreads = loadVisibleDesktopThreads(limit);
  const visibleThreadIds = visibleThreads?.map((thread) => thread.id) || null;
  const visibleThreadSet = visibleThreadIds ? new Set(visibleThreadIds) : null;
  const visibleThreadUpdatedAt = new Map(visibleThreads?.map((thread) => [thread.id, thread.updatedAtMs]) || []);
  const oldestVisibleUpdatedAtMs = visibleThreads && visibleThreads.length > 0
    ? Math.min(...visibleThreads.map((thread) => thread.updatedAtMs || Number.MAX_SAFE_INTEGER))
    : 0;

  const files: string[] = [];
  walkSessionFiles(root, files);

  const allSessions = new Map<string, DesktopSessionSummary>();
  for (const filePath of files) {
    const session = parseDesktopSession(filePath, threadIndexEntries, archivedThreadIds);
    if (!session) continue;
    if (!isWithinSavedWorkspaceRoots(session.cwd, savedWorkspaceRoots)) continue;
    allSessions.set(session.threadId, session);
  }

  const sessions = Array.from(allSessions.values());

  if (visibleThreadSet && visibleThreadIds) {
    const mergedThreadIds = new Set<string>(visibleThreadIds);
    if (oldestVisibleUpdatedAtMs > 0) {
      for (const session of sessions) {
        if (visibleThreadSet.has(session.threadId)) continue;
        const candidateUpdatedAtMs = parseUpdatedAtValue(threadIndexEntries.get(session.threadId)?.updatedAt || session.lastEventAt);
        if (candidateUpdatedAtMs > oldestVisibleUpdatedAtMs) {
          mergedThreadIds.add(session.threadId);
        }
      }
    }

    return sessions
      .filter((session) => mergedThreadIds.has(session.threadId))
      .sort((left, right) => {
        const rightUpdatedAtMs = visibleThreadUpdatedAt.get(right.threadId)
          || parseUpdatedAtValue(threadIndexEntries.get(right.threadId)?.updatedAt || right.lastEventAt);
        const leftUpdatedAtMs = visibleThreadUpdatedAt.get(left.threadId)
          || parseUpdatedAtValue(threadIndexEntries.get(left.threadId)?.updatedAt || left.lastEventAt);
        return rightUpdatedAtMs - leftUpdatedAtMs;
      })
      .slice(0, typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.max(1, Math.floor(limit)) : undefined);
  }

  return sessions
    .sort((a, b) => b.lastEventAt.localeCompare(a.lastEventAt))
    .slice(0, typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? Math.max(1, Math.floor(limit)) : undefined);
}

export function getDesktopSessionByThreadId(threadId: string): DesktopSessionSummary | null {
  const sessions = listDesktopSessions();
  return sessions.find((session) => session.threadId === threadId) || null;
}

function uniqueArchivedSessionPath(filePath: string): string {
  const archivedRoot = getArchivedSessionsRoot();
  fs.mkdirSync(archivedRoot, { recursive: true });

  const parsed = path.parse(path.basename(filePath));
  let candidate = path.join(archivedRoot, path.basename(filePath));
  let suffix = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(archivedRoot, `${parsed.name}.${suffix}${parsed.ext}`);
    suffix += 1;
  }
  return candidate;
}

export function archiveDesktopSession(threadId: string): DesktopSessionSummary | null {
  const session = getDesktopSessionByThreadId(threadId);
  if (!session) return null;

  const archivedPath = uniqueArchivedSessionPath(session.filePath);
  try {
    fs.renameSync(session.filePath, archivedPath);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { code?: string }).code
      : '';
    if (code !== 'EXDEV') throw error;
    fs.copyFileSync(session.filePath, archivedPath);
    fs.unlinkSync(session.filePath);
  }
  return session;
}

export function isArchivedDesktopThread(threadId: string): boolean {
  return loadArchivedThreadIds().has(threadId);
}

function extractDesktopMessageText(line: SessionMessageLine): string {
  const parts = line.payload?.content
    ?.map((item) => (item && typeof item.text === 'string' ? item.text : ''))
    .filter(Boolean) || [];
  const text = parts.join('\n').trim();
  if (!text) return '';
  if (line.payload?.phase === 'commentary') {
    return `[commentary]\n${text}`;
  }
  return text;
}

function pushDesktopSessionEvent(
  events: DesktopSessionEvent[],
  parsed: SessionMessageLine | SessionEventLine,
  rawLine: string,
): void {
  if (isSessionEventLine(parsed) && parsed.payload?.type === 'context_compacted') {
    events.push({
      signature: createDesktopEventSignature(rawLine),
      role: 'commentary',
      content: CONTEXT_COMPACTED_NOTICE,
      timestamp: parsed.timestamp || '',
    });
    return;
  }

  if (isSessionEventLine(parsed) && parsed.payload?.type === 'user_message') {
    const text = extractNormalizedStructuredText(parsed.payload.message);
    if (!text) return;
    events.push({
      signature: createDesktopEventSignature(rawLine),
      role: 'user',
      content: text,
      timestamp: parsed.timestamp || '',
    });
    return;
  }

  if (isSessionEventLine(parsed) && parsed.payload?.type === 'agent_message') {
    const text = extractNormalizedStructuredText(parsed.payload.message);
    if (!text) return;
    const role = parsed.payload.phase === 'commentary' ? 'commentary' : 'assistant';
    const lastEvent = events[events.length - 1];
    if (lastEvent?.role === role && lastEvent.content === text) return;
    events.push({
      signature: createDesktopEventSignature(rawLine),
      role,
      content: text,
      timestamp: parsed.timestamp || '',
    });
    return;
  }

  if (isSessionEventLine(parsed) && parsed.payload?.type === 'task_complete') {
    const text = extractNormalizedStructuredText(parsed.payload.last_agent_message);
    if (!text) return;

    const lastEvent = events[events.length - 1];
    if (lastEvent?.role === 'assistant' && lastEvent.content === text) {
      return;
    }

    events.push({
      signature: createDesktopEventSignature(rawLine),
      role: 'assistant',
      content: text,
      timestamp: parsed.timestamp || '',
    });
    return;
  }

  if (isSessionMessageLine(parsed) && parsed.payload?.type === 'message' && parsed.payload.role === 'assistant') {
    const text = extractDesktopMessageText(parsed);
    if (!text) return;
    const role = parsed.payload.phase === 'commentary' ? 'commentary' : 'assistant';
    const content = parsed.payload.phase === 'commentary' ? text.replace(/^\[commentary\]\n/, '') : text;
    const lastEvent = events[events.length - 1];
    if (lastEvent?.role === role && lastEvent.content === content) return;
    events.push({
      signature: createDesktopEventSignature(rawLine),
      role,
      content,
      timestamp: parsed.timestamp || '',
    });
  }
}

function pushDesktopMirrorRecord(
  records: DesktopMirrorRecord[],
  parsed: SessionMessageLine | SessionEventLine | TurnContextLine,
  rawLine: string,
  activeTurnId: string | null,
  activeSpecialCallIds: Set<string>,
): boolean {
  if (isSessionEventLine(parsed)) {
    return pushDesktopMirrorEventRecord(records, parsed, rawLine, activeTurnId);
  }
  if (isSessionMessageLine(parsed)) {
    return pushDesktopMirrorResponseRecord(records, parsed, rawLine, activeTurnId, activeSpecialCallIds);
  }
  return false;
}

function pushDesktopMirrorEventRecord(
  records: DesktopMirrorRecord[],
  parsed: SessionEventLine,
  rawLine: string,
  activeTurnId: string | null,
): boolean {
  const signature = createDesktopEventSignature(rawLine);
  const timestamp = parsed.timestamp || '';

  if (parsed.payload?.type === 'task_started') {
    records.push({
      signature,
      type: 'task_started',
      content: '',
      timestamp,
      turnId: parsed.payload.turn_id || '',
    });
    return true;
  }

  if (parsed.payload?.type === 'turn_aborted') {
    records.push({
      signature,
      type: 'task_aborted',
      content: extractNormalizedStructuredText(parsed.payload.reason),
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (parsed.payload?.type === 'context_compacted') {
    records.push({
      signature,
      type: 'message',
      role: 'commentary',
      content: CONTEXT_COMPACTED_NOTICE,
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (isIgnoredMirrorLineKind(parsed)) {
    return true;
  }

  if (parsed.payload?.type === 'agent_message') {
    const text = extractNormalizedStructuredText(parsed.payload.message);
    if (!text) return true;
    records.push({
      signature,
      type: 'message',
      role: parsed.payload.phase === 'commentary' ? 'commentary' : 'assistant',
      content: text,
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (parsed.payload?.type === 'agent_reasoning') {
    const text = extractNormalizedStructuredText(parsed.payload.text);
    if (!text) return true;
    records.push({
      signature,
      type: 'reasoning',
      content: text,
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (parsed.payload?.type === 'web_search_end') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    records.push({
      signature,
      type: 'tool_finished',
      content: extractNormalizedStructuredText(parsed.payload.query),
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      toolName: 'Web Search',
    });
    return true;
  }

  if (parsed.payload?.type === 'mcp_tool_call_end') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    const server = extractNormalizedFreeText(parsed.payload.invocation?.server);
    const tool = extractNormalizedFreeText(parsed.payload.invocation?.tool);
    const toolName = server && tool ? `mcp__${server}__${tool}` : 'mcp_tool_call';
    records.push({
      signature,
      type: 'tool_finished',
      content: '',
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      toolName,
      isError: false,
    });
    return true;
  }

  if (parsed.payload?.type === 'exec_command_end') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    const exitCode = typeof parsed.payload.exit_code === 'number' ? parsed.payload.exit_code : null;
    const status = extractNormalizedFreeText(parsed.payload.status).toLowerCase();
    records.push({
      signature,
      type: 'tool_finished',
      content: extractToolOutputText(
        parsed.payload.aggregated_output
          ?? parsed.payload.formatted_output
          ?? parsed.payload.stdout
          ?? parsed.payload.stderr
          ?? parsed.payload.command,
      ),
      timestamp,
      ...(parsed.payload.turn_id || activeTurnId ? { turnId: parsed.payload.turn_id || activeTurnId || undefined } : {}),
      toolId,
      toolName: 'Bash',
      isError: status === 'failed' || (exitCode != null && exitCode !== 0),
    });
    return true;
  }

  if (parsed.payload?.type === 'patch_apply_end') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    const status = extractNormalizedFreeText(parsed.payload.status).toLowerCase();
    records.push({
      signature,
      type: 'tool_finished',
      content: summarizePatchChanges(parsed.payload.changes)
        || extractToolOutputText(parsed.payload.stdout ?? parsed.payload.stderr),
      timestamp,
      ...(parsed.payload.turn_id || activeTurnId ? { turnId: parsed.payload.turn_id || activeTurnId || undefined } : {}),
      toolId,
      toolName: 'apply_patch',
      isError: parsed.payload.success === false || status === 'failed',
    });
    return true;
  }

  if (parsed.payload?.type === 'dynamic_tool_call_request') {
    const toolId = getDynamicToolCallId(parsed.payload) || signature;
    const toolName = extractNormalizedFreeText(parsed.payload.tool) || 'tool';
    records.push({
      signature,
      type: 'tool_started',
      content: '',
      timestamp,
      ...(parsed.payload.turnId || activeTurnId ? { turnId: parsed.payload.turnId || activeTurnId || undefined } : {}),
      toolId,
      toolName,
    });
    return true;
  }

  if (parsed.payload?.type === 'dynamic_tool_call_response') {
    const toolId = getDynamicToolCallId(parsed.payload) || signature;
    const toolName = extractNormalizedFreeText(parsed.payload.tool) || 'tool';
    records.push({
      signature,
      type: 'tool_finished',
      content: extractToolOutputText(parsed.payload.content_items ?? parsed.payload.error),
      timestamp,
      ...(parsed.payload.turn_id || activeTurnId ? { turnId: parsed.payload.turn_id || activeTurnId || undefined } : {}),
      toolId,
      toolName,
      isError: parsed.payload.success === false,
    });
    return true;
  }

  if (parsed.payload?.type === 'user_message') {
    const text = extractNormalizedStructuredText(parsed.payload.message);
    if (!text) return true;
    records.push({
      signature,
      type: 'message',
      role: 'user',
      content: text,
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (parsed.payload?.type === 'task_complete') {
    records.push({
      signature,
      type: 'task_complete',
      role: 'assistant',
      content: extractNormalizedStructuredText(parsed.payload.last_agent_message),
      timestamp,
      turnId: parsed.payload.turn_id || '',
    });
    return true;
  }

  return false;
}

function pushDesktopMirrorResponseRecord(
  records: DesktopMirrorRecord[],
  parsed: SessionMessageLine,
  rawLine: string,
  activeTurnId: string | null,
  activeSpecialCallIds: Set<string>,
): boolean {
  const signature = createDesktopEventSignature(rawLine);
  const timestamp = parsed.timestamp || '';

  if (isIgnoredMirrorLineKind(parsed)) {
    return true;
  }

  if (parsed.payload?.type === 'reasoning') {
    const text = extractReasoningSummary(parsed.payload);
    if (!text) return true;
    records.push({
      signature,
      type: 'reasoning',
      content: text,
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (parsed.payload?.type === 'message' && parsed.payload.role === 'assistant') {
    const text = extractDesktopMessageText(parsed);
    if (!text) return true;
    records.push({
      signature,
      type: 'message',
      role: parsed.payload.phase === 'commentary' ? 'commentary' : 'assistant',
      content: parsed.payload.phase === 'commentary' ? text.replace(/^\[commentary\]\n/, '') : text,
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (parsed.payload?.type === 'tool_search_call') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    records.push({
      signature,
      type: 'tool_started',
      content: '',
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      toolName: 'tool_search',
    });
    return true;
  }

  if (parsed.payload?.type === 'tool_search_output') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    const status = extractNormalizedFreeText(parsed.payload.status).toLowerCase();
    records.push({
      signature,
      type: 'tool_finished',
      content: summarizeToolSearchOutput(parsed.payload.tools),
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      toolName: 'tool_search',
      isError: status === 'failed',
    });
    return true;
  }

  if (parsed.payload?.type === 'function_call') {
    const toolName = formatDesktopToolName(parsed.payload.namespace, parsed.payload.name);
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    if (!toolName) return true;
    if (toolName === 'update_plan') {
      const tasks = parseUpdatePlanTasks(parsed.payload.arguments);
      activeSpecialCallIds.add(toolId);
      records.push({
        signature,
        type: 'plan_update',
        content: '',
        timestamp,
        ...(activeTurnId ? { turnId: activeTurnId } : {}),
        tasks,
      });
      return true;
    }
    records.push({
      signature,
      type: 'tool_started',
      content: '',
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      toolName,
    });
    return true;
  }

  if (parsed.payload?.type === 'custom_tool_call') {
    const toolName = formatDesktopToolName(parsed.payload.namespace, parsed.payload.name);
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    if (!toolName) return true;
    if (toolName === 'update_plan') {
      const tasks = parseUpdatePlanTasks(typeof parsed.payload.input === 'string' ? parsed.payload.input : undefined);
      activeSpecialCallIds.add(toolId);
      records.push({
        signature,
        type: 'plan_update',
        content: '',
        timestamp,
        ...(activeTurnId ? { turnId: activeTurnId } : {}),
        tasks,
      });
      return true;
    }
    records.push({
      signature,
      type: 'tool_started',
      content: '',
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      toolName,
    });
    return true;
  }

  if (parsed.payload?.type === 'function_call_output') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    if (activeSpecialCallIds.has(toolId)) {
      activeSpecialCallIds.delete(toolId);
      return true;
    }
    records.push({
      signature,
      type: 'tool_finished',
      content: extractToolOutputText(parsed.payload.output),
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      isError: parsed.payload.is_error === true,
    });
    return true;
  }

  if (parsed.payload?.type === 'custom_tool_call_output') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    if (activeSpecialCallIds.has(toolId)) {
      activeSpecialCallIds.delete(toolId);
      return true;
    }
    records.push({
      signature,
      type: 'tool_finished',
      content: extractToolOutputText(parsed.payload.output),
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      isError: parsed.payload.is_error === true,
    });
    return true;
  }

  return false;
}

function parseDesktopSessionEventText(
  content: string,
  leadingText = '',
  flushTrailingText = false,
): DesktopSessionEventDelta {
  const combined = `${leadingText}${content}`;
  if (!combined) {
    return {
      events: [],
      nextOffset: 0,
      trailingText: '',
    };
  }

  const hasTrailingNewline = combined.endsWith('\n') || combined.endsWith('\r');
  const rawLines = combined.split(/\r?\n/);
  let trailingText = hasTrailingNewline ? '' : (rawLines.pop() || '');
  if (flushTrailingText && trailingText) {
    rawLines.push(trailingText);
    trailingText = '';
  }
  const events: DesktopSessionEvent[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: SessionMessageLine | SessionEventLine;
    try {
      parsed = JSON.parse(trimmed) as SessionMessageLine | SessionEventLine;
    } catch {
      continue;
    }

    pushDesktopSessionEvent(events, parsed, trimmed);
  }

  return {
    events,
    nextOffset: 0,
    trailingText,
  };
}

function parseDesktopMirrorRecordText(
  content: string,
  leadingText = '',
  flushTrailingText = false,
  initialTurnId: string | null = null,
  initialSpecialCallIds: Iterable<string> = [],
): DesktopMirrorRecordDelta {
  const combined = `${leadingText}${content}`;
  if (!combined) {
    return {
      records: [],
      nextOffset: 0,
      trailingText: '',
      nextTurnId: initialTurnId,
      nextSpecialCallIds: [],
      unknownKinds: [],
    };
  }

  const hasTrailingNewline = combined.endsWith('\n') || combined.endsWith('\r');
  const rawLines = combined.split(/\r?\n/);
  let trailingText = hasTrailingNewline ? '' : (rawLines.pop() || '');
  if (flushTrailingText && trailingText) {
    rawLines.push(trailingText);
    trailingText = '';
  }
  const records: DesktopMirrorRecord[] = [];
  let activeTurnId = initialTurnId;
  const activeSpecialCallIds = new Set(initialSpecialCallIds);
  const unknownKinds = new Set<string>();

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: SessionMessageLine | SessionEventLine | TurnContextLine;
    try {
      parsed = JSON.parse(trimmed) as SessionMessageLine | SessionEventLine | TurnContextLine;
    } catch {
      continue;
    }

    if (isTurnContextLine(parsed)) {
      activeTurnId = parsed.payload?.turn_id || activeTurnId;
      continue;
    }

    if (isSessionEventLine(parsed) && parsed.payload?.type === 'task_started') {
      const eventPayload = parsed.payload as SessionEventLine['payload'];
      activeTurnId = eventPayload?.turn_id || activeTurnId;
    }

    const handled = pushDesktopMirrorRecord(records, parsed, trimmed, activeTurnId, activeSpecialCallIds);
    if (!handled) {
      const unknownKind = describeUnhandledMirrorLineKind(parsed);
      if (unknownKind) unknownKinds.add(unknownKind);
    }

    if (
      isSessionEventLine(parsed)
      && (parsed.payload?.type === 'task_complete' || parsed.payload?.type === 'turn_aborted')
    ) {
      const eventPayload = parsed.payload as SessionEventLine['payload'];
      const completedTurnId = eventPayload?.turn_id || activeTurnId;
      if (!completedTurnId || completedTurnId === activeTurnId) {
        activeTurnId = null;
      }
      activeSpecialCallIds.clear();
    }
  }

  return {
    records,
    nextOffset: 0,
    trailingText,
    nextTurnId: activeTurnId,
    nextSpecialCallIds: Array.from(activeSpecialCallIds),
    unknownKinds: Array.from(unknownKinds),
  };
}

export interface DesktopSessionJsonlHistoryEntry {
  signature: string;
  role: 'user' | 'assistant' | 'commentary' | 'system' | 'tool' | 'other';
  kind: string;
  content: string;
  timestamp: string;
  rawJsonl: string;
}

function safeJsonPretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function classifySessionJsonlRole(
  parsed: SessionMetaLine | SessionMessageLine | SessionEventLine | TurnContextLine,
): DesktopSessionJsonlHistoryEntry['role'] {
  if (isTurnContextLine(parsed as TurnContextLine)) return 'system';

  if (isSessionMessageLine(parsed as SessionMessageLine)) {
    const msg = parsed as SessionMessageLine;
    const payloadType = typeof msg.payload?.type === 'string' ? msg.payload.type.trim() : '';
    if (payloadType === 'message') {
      const role = typeof msg.payload?.role === 'string' ? msg.payload.role.trim() : '';
      if (role === 'user') return 'user';
      if (role === 'assistant') return msg.payload?.phase === 'commentary' ? 'commentary' : 'assistant';
      if (role === 'system') return 'system';
      if (role === 'tool') return 'tool';
      return 'assistant';
    }
    if (payloadType === 'reasoning') return 'commentary';
    if (
      payloadType === 'function_call'
      || payloadType === 'function_call_output'
      || payloadType === 'custom_tool_call'
      || payloadType === 'custom_tool_call_output'
      || payloadType === 'tool_search_call'
      || payloadType === 'tool_search_output'
      || payloadType === 'web_search_call'
    ) {
      return 'tool';
    }
    return 'system';
  }

  if (isSessionEventLine(parsed as SessionEventLine)) {
    const evt = parsed as SessionEventLine;
    const payloadType = typeof evt.payload?.type === 'string' ? evt.payload.type.trim() : '';
    if (payloadType === 'user_message') return 'user';
    if (payloadType === 'agent_message') return evt.payload?.phase === 'commentary' ? 'commentary' : 'assistant';
    if (payloadType === 'context_compacted' || payloadType === 'agent_reasoning') return 'commentary';
    if (
      payloadType === 'exec_command_end'
      || payloadType === 'patch_apply_end'
      || payloadType === 'mcp_tool_call_end'
      || payloadType === 'web_search_end'
      || payloadType === 'dynamic_tool_call_request'
      || payloadType === 'dynamic_tool_call_response'
    ) {
      return 'tool';
    }
    return 'system';
  }

  return 'system';
}

function buildSessionJsonlKindLabel(
  parsed: SessionMetaLine | SessionMessageLine | SessionEventLine | TurnContextLine,
): string {
  const topType = typeof parsed.type === 'string' ? parsed.type.trim() : '';
  const payloadType = typeof (parsed as SessionMessageLine | SessionEventLine).payload?.type === 'string'
    ? String((parsed as SessionMessageLine | SessionEventLine).payload?.type).trim()
    : '';
  const top = topType || 'jsonl';
  return payloadType ? `${top}:${payloadType}` : top;
}

function parseFixedToolOutput(text: string): { exitCode?: number; wallTime?: string; output?: string } {
  const normalized = String(text || '');
  const exitMatch = normalized.match(/\bProcess exited with code\s+(\d+)\b/i);
  const exitCode = exitMatch ? Number(exitMatch[1]) : undefined;
  
  const wallTimeMatch = normalized.match(/\bWall time:\s*([\d.]+)\s*s/i);
  const wallTime = wallTimeMatch ? wallTimeMatch[1] : undefined;
  
  const marker = normalized.indexOf('\nOutput:\n');
  const output = marker >= 0 ? normalized.slice(marker + '\nOutput:\n'.length).trim() : '';
  return {
    exitCode: Number.isFinite(exitCode) ? exitCode : undefined,
    wallTime,
    output: output || undefined,
  };
}

function formatTokenCountSummary(info: unknown): string {
  if (!info || typeof info !== 'object') return '';
  const obj = info as {
    total_token_usage?: Record<string, unknown>;
    last_token_usage?: Record<string, unknown>;
    model_context_window?: unknown;
  };

  const windowSize = typeof obj.model_context_window === 'number' ? obj.model_context_window : null;

  const readUsage = (usage: Record<string, unknown> | undefined) => {
    if (!usage) return null;
    const n = (k: string) => (typeof usage[k] === 'number' ? (usage[k] as number) : null);
    return {
      input: n('input_tokens'),
      cached: n('cached_input_tokens'),
      output: n('output_tokens'),
      reasoning: n('reasoning_output_tokens'),
      total: n('total_tokens'),
    };
  };

  const last = readUsage(obj.last_token_usage);
  const total = readUsage(obj.total_token_usage);

  const lines: string[] = [];
  if (windowSize != null) {
    let windowLine = `Context window: ${windowSize.toLocaleString()}`;
    if (last && last.input != null) {
      const pct = Math.round((last.input / windowSize) * 100);
      windowLine += ` (last input: ${pct}%)`;
    }
    lines.push(windowLine);
  }
  if (last) {
    const parts: string[] = [];
    if (last.input != null) parts.push(`input ${last.input.toLocaleString()}` + (last.cached != null ? ` (cached ${last.cached.toLocaleString()})` : ''));
    if (last.output != null) parts.push(`output ${last.output.toLocaleString()}` + (last.reasoning != null ? ` (reasoning ${last.reasoning.toLocaleString()})` : ''));
    if (last.total != null) parts.push(`total ${last.total.toLocaleString()}`);
    if (parts.length) lines.push(`Last: ${parts.join(', ')}`);
  }
  if (total) {
    const parts: string[] = [];
    if (total.input != null) parts.push(`input ${total.input.toLocaleString()}` + (total.cached != null ? ` (cached ${total.cached.toLocaleString()})` : ''));
    if (total.output != null) parts.push(`output ${total.output.toLocaleString()}` + (total.reasoning != null ? ` (reasoning ${total.reasoning.toLocaleString()})` : ''));
    if (total.total != null) parts.push(`total ${total.total.toLocaleString()}`);
    if (parts.length) lines.push(`Total: ${parts.join(', ')}`);
  }

  return lines.join('\n');
}

function extractSessionJsonlPrimaryText(
  parsed: SessionMetaLine | SessionMessageLine | SessionEventLine | TurnContextLine,
): string {
  if (isTurnContextLine(parsed as TurnContextLine)) {
    const turnId = (parsed as TurnContextLine).payload?.turn_id?.trim();
    return turnId ? `turn_id: ${turnId}` : '';
  }

  if (isSessionMessageLine(parsed as SessionMessageLine)) {
    const msg = parsed as SessionMessageLine;
    const payloadType = typeof msg.payload?.type === 'string' ? msg.payload.type.trim() : '';
    if (payloadType === 'message') {
      return extractDesktopMessageText(msg);
    }
    if (payloadType === 'reasoning') {
      return extractReasoningSummary(msg.payload as any);
    }
    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      const toolName = formatDesktopToolName(msg.payload?.namespace, msg.payload?.name) || 'tool';
      const args = typeof msg.payload?.arguments === 'string'
        ? msg.payload.arguments
        : typeof msg.payload?.input === 'string'
          ? msg.payload.input
          : '';
      
      if (toolName === 'exec_command' && args && args.trim().startsWith('{')) {
        try {
          const parsedArgs = JSON.parse(args.trim());
          const command = typeof parsedArgs.command === 'string' ? parsedArgs.command.trim() : '';
          if (command) {
            return `${toolName}\n\n\`\`\`sh\n${command}\n\`\`\``;
          }
        } catch {
          // fallback to original format
        }
      }
      return args ? `${toolName}\n\n${args}` : toolName;
    }
    if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
      const rawOutput = extractToolOutputText(msg.payload?.output);
      const parsedOutput = parseFixedToolOutput(rawOutput);
      const lines: string[] = [];
      
      const statusParts: string[] = [];
      if (parsedOutput.wallTime) {
        if (parsedOutput.exitCode === 0) {
          statusParts.push(`✓ Succeeded in ${parsedOutput.wallTime}s`);
        } else if (parsedOutput.exitCode != null) {
          statusParts.push(`✗ Exited with code ${parsedOutput.exitCode} in ${parsedOutput.wallTime}s`);
        } else {
          statusParts.push(`⏱️ Completed in ${parsedOutput.wallTime}s`);
        }
      } else if (parsedOutput.exitCode === 0) {
        statusParts.push('✓ Succeeded');
      } else if (parsedOutput.exitCode != null) {
        statusParts.push(`✗ Exited with code ${parsedOutput.exitCode}`);
      }
      if (statusParts.length) lines.push(statusParts.join(' '));
      
      const body = parsedOutput.output || rawOutput.trim();
      if (body) {
        if (lines.length) lines.push('');
        lines.push('```');
        lines.push(body);
        lines.push('```');
      }
      return lines.join('\n');
    }
    if (payloadType === 'tool_search_call') {
      return '工具调用: tool_search';
    }
    if (payloadType === 'tool_search_output') {
      const summary = summarizeToolSearchOutput(msg.payload?.tools);
      return summary ? `工具输出:\n\n${summary}` : '';
    }
    return '';
  }

  if (isSessionEventLine(parsed as SessionEventLine)) {
    const evt = parsed as SessionEventLine;
    const payloadType = typeof evt.payload?.type === 'string' ? evt.payload.type.trim() : '';
    if (payloadType === 'task_started') {
      const turnId = typeof evt.payload?.turn_id === 'string' ? evt.payload.turn_id.trim() : '';
      return turnId ? `任务开始 (turn_id: ${turnId})` : '任务开始';
    }
    if (payloadType === 'turn_aborted') {
      const reason = extractNormalizedStructuredText(evt.payload?.reason);
      return reason ? `任务中止\n\n${reason}` : '任务中止';
    }
    if (payloadType === 'task_complete') {
      const finalMessage = extractNormalizedStructuredText(evt.payload?.last_agent_message);
      return finalMessage || '任务完成';
    }
    if (payloadType === 'context_compacted') {
      return CONTEXT_COMPACTED_NOTICE;
    }
    if (payloadType === 'token_count') {
      return formatTokenCountSummary((evt.payload as any)?.info);
    }
    if (payloadType === 'user_message') {
      return extractNormalizedStructuredText(evt.payload?.message);
    }
    if (payloadType === 'agent_message') {
      return extractNormalizedStructuredText(evt.payload?.message);
    }
    if (payloadType === 'agent_reasoning') {
      return extractNormalizedStructuredText(evt.payload?.text);
    }
    if (payloadType === 'exec_command_end') {
      const exitCode = typeof (evt.payload as any)?.exit_code === 'number' ? (evt.payload as any).exit_code : null;
      const wallTime = typeof (evt.payload as any)?.duration_seconds === 'number' ? String((evt.payload as any).duration_seconds) : null;
      const output = extractToolOutputText(
        evt.payload?.aggregated_output
          ?? evt.payload?.formatted_output
          ?? evt.payload?.stdout
          ?? evt.payload?.stderr
          ?? evt.payload?.command,
      ).trim();
      
      const lines: string[] = [];
      const statusParts: string[] = [];
      if (wallTime) {
        if (exitCode === 0) {
          statusParts.push(`✓ Succeeded in ${wallTime}s`);
        } else if (exitCode != null) {
          statusParts.push(`✗ Exited with code ${exitCode} in ${wallTime}s`);
        } else {
          statusParts.push(`⏱️ Completed in ${wallTime}s`);
        }
      } else if (exitCode === 0) {
        statusParts.push('✓ Succeeded');
      } else if (exitCode != null) {
        statusParts.push(`✗ Exited with code ${exitCode}`);
      }
      if (statusParts.length) lines.push(statusParts.join(' '));
      
      if (output) {
        if (lines.length) lines.push('');
        lines.push('```');
        lines.push(output);
        lines.push('```');
      }
      return lines.join('\n');
    }
    if (payloadType === 'patch_apply_end') {
      const status = extractNormalizedFreeText(evt.payload?.status).toLowerCase();
      const output = summarizePatchChanges(evt.payload?.changes)
        || extractToolOutputText(evt.payload?.stdout ?? evt.payload?.stderr).trim();
      const lines: string[] = [];
      if (status) lines.push(`Status: ${status}`);
      if (output) {
        if (lines.length) lines.push('');
        lines.push(output);
      }
      return lines.join('\n');
    }
    if (payloadType === 'mcp_tool_call_end') {
      const server = extractNormalizedFreeText(evt.payload?.invocation?.server);
      const tool = extractNormalizedFreeText(evt.payload?.invocation?.tool);
      const name = server && tool ? `mcp__${server}__${tool}` : 'mcp_tool_call';
      return `工具调用完成: ${name}`;
    }
    if (payloadType === 'web_search_end') {
      const query = extractNormalizedStructuredText(evt.payload?.query);
      return query ? `Web Search\n\n${query}` : 'Web Search';
    }
    if (payloadType === 'dynamic_tool_call_request') {
      const toolName = extractNormalizedFreeText(evt.payload?.tool) || 'tool';
      return `工具调用开始: ${toolName}`;
    }
    if (payloadType === 'dynamic_tool_call_response') {
      const toolName = extractNormalizedFreeText(evt.payload?.tool) || 'tool';
      const output = extractToolOutputText(evt.payload?.content_items ?? evt.payload?.error).trim();
      return output ? `工具调用完成: ${toolName}\n\n${output}` : `工具调用完成: ${toolName}`;
    }
    return '';
  }

  const payload = parsed.payload;
  if (payload && typeof payload === 'object') {
    const cwd = typeof (payload as any).cwd === 'string' ? String((payload as any).cwd).trim() : '';
    const originator = typeof (payload as any).originator === 'string' ? String((payload as any).originator).trim() : '';
    const source = typeof (payload as any).source === 'string' ? String((payload as any).source).trim() : '';
    const cliVersion = typeof (payload as any).cli_version === 'string' ? String((payload as any).cli_version).trim() : '';
    const summaryParts = [
      cwd ? `cwd: ${cwd}` : '',
      originator ? `originator: ${originator}` : '',
      source ? `source: ${source}` : '',
      cliVersion ? `cli: ${cliVersion}` : '',
    ].filter(Boolean);
    return summaryParts.length ? summaryParts.join('\n') : '';
  }

  return '';
}

function formatSessionJsonlEntryContent(
  parsed: SessionMetaLine | SessionMessageLine | SessionEventLine | TurnContextLine,
): string {
  return extractSessionJsonlPrimaryText(parsed).trim();
}

export function parseDesktopSessionJsonlHistoryText(content: string): DesktopSessionJsonlHistoryEntry[] {
  if (!content) return [];
  const hasTrailingNewline = content.endsWith('\n') || content.endsWith('\r');
  const rawLines = content.split(/\r?\n/);
  if (!hasTrailingNewline) {
    const trailing = rawLines.pop();
    if (trailing && trailing.trim()) rawLines.push(trailing);
  }

  const entries: DesktopSessionJsonlHistoryEntry[] = [];
  for (const rawLine of rawLines) {
    if (!rawLine) continue;
    const normalized = rawLine.replace(/\r$/, '');
    const signature = createDesktopEventSignature(normalized);
    let parsed: SessionMetaLine | SessionMessageLine | SessionEventLine | TurnContextLine | null = null;
    try {
      parsed = JSON.parse(normalized) as SessionMetaLine | SessionMessageLine | SessionEventLine | TurnContextLine;
    } catch {
      entries.push({
        signature,
        role: 'other',
        kind: 'jsonl:unparsed',
        content: normalized,
        timestamp: '',
        rawJsonl: normalized,
      });
      continue;
    }

    const timestamp = (
      typeof (parsed as { timestamp?: unknown }).timestamp === 'string' ? (parsed as { timestamp?: string }).timestamp : ''
    )
      || (typeof (parsed as { payload?: { timestamp?: unknown } }).payload?.timestamp === 'string'
        ? String((parsed as { payload?: { timestamp?: string } }).payload?.timestamp)
        : '');
    const role = classifySessionJsonlRole(parsed);
    const kind = buildSessionJsonlKindLabel(parsed);
    const contentText = formatSessionJsonlEntryContent(parsed);
    entries.push({
      signature,
      role,
      kind,
      content: contentText || '(无可展示内容)',
      timestamp,
      rawJsonl: normalized,
    });
  }
  return entries;
}

export function readDesktopSessionJsonlHistoryStreamByFilePath(filePath: string): DesktopSessionJsonlHistoryEntry[] {
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  return parseDesktopSessionJsonlHistoryText(content);
}

export function desktopJsonlHistoryEntriesToBridgeMessages(
  entries: DesktopSessionJsonlHistoryEntry[],
  limit = 8,
): BridgeMessage[] {
  const messages: BridgeMessage[] = [];

  for (const entry of entries) {
    const content = entry.content.trim();
    if (!content || content === '(无可展示内容)') continue;

    let message: BridgeMessage | null = null;
    if (entry.role === 'user') {
      message = { role: 'user', content };
    } else if (entry.role === 'assistant') {
      message = { role: 'assistant', content };
    } else if (entry.role === 'commentary') {
      message = { role: 'assistant', content: `[commentary]\n${content}` };
    } else if (entry.kind === 'event_msg:task_complete') {
      message = { role: 'assistant', content };
    }

    if (!message) continue;

    const previous = messages[messages.length - 1];
    if (previous?.role === message.role && previous.content === message.content) {
      continue;
    }

    messages.push(message);
  }

  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 8;
  return messages.slice(-safeLimit);
}

export function readDesktopSessionMessagesByFilePath(filePath: string, limit = 8): BridgeMessage[] {
  return desktopJsonlHistoryEntriesToBridgeMessages(
    readDesktopSessionJsonlHistoryStreamByFilePath(filePath),
    limit,
  );
}

export function readDesktopSessionMessages(threadId: string, limit = 8): BridgeMessage[] {
  const session = getDesktopSessionByThreadId(threadId);
  return session ? readDesktopSessionMessagesByFilePath(session.filePath, limit) : [];
}

export function readDesktopSessionEventStreamByFilePath(filePath: string): DesktopSessionEvent[] {
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  return parseDesktopSessionEventText(content, '', true).events;
}

export function readDesktopSessionEventDeltaByFilePath(
  filePath: string,
  startOffset: number,
  endOffset: number,
  trailingText = '',
): DesktopSessionEventDelta {
  let content = '';
  try {
    content = readFileUtf8Range(filePath, startOffset, endOffset);
  } catch {
    return {
      events: [],
      nextOffset: startOffset,
      trailingText,
    };
  }

  const parsed = parseDesktopSessionEventText(content, trailingText);
  return {
    events: parsed.events,
    nextOffset: Math.max(startOffset, endOffset),
    trailingText: parsed.trailingText,
  };
}

export function readDesktopSessionMirrorRecordStreamByFilePath(filePath: string): DesktopMirrorRecord[] {
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  return parseDesktopMirrorRecordText(content, '', true, null, []).records;
}

export function readDesktopSessionMirrorRecordDeltaByFilePath(
  filePath: string,
  startOffset: number,
  endOffset: number,
  trailingText = '',
  currentTurnId: string | null = null,
  currentSpecialCallIds: Iterable<string> = [],
): DesktopMirrorRecordDelta {
  let content = '';
  try {
    content = readFileUtf8Range(filePath, startOffset, endOffset);
  } catch {
    return {
      records: [],
      nextOffset: startOffset,
      trailingText,
      nextTurnId: currentTurnId,
      nextSpecialCallIds: Array.from(currentSpecialCallIds),
      unknownKinds: [],
    };
  }

  const parsed = parseDesktopMirrorRecordText(content, trailingText, false, currentTurnId, currentSpecialCallIds);
  return {
    records: parsed.records,
    nextOffset: Math.max(startOffset, endOffset),
    trailingText: parsed.trailingText,
    nextTurnId: parsed.nextTurnId,
    nextSpecialCallIds: parsed.nextSpecialCallIds,
    unknownKinds: parsed.unknownKinds,
  };
}

export function readDesktopSessionEventStream(threadId: string): DesktopSessionEvent[] {
  const session = getDesktopSessionByThreadId(threadId);
  if (!session) return [];
  return readDesktopSessionEventStreamByFilePath(session.filePath);
}
