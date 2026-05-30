import path from 'node:path';

import type { CodexSessionSummary } from '../../../codex/session-index.js';
import { stripLegacySessionPrefix } from './session-title.js';
import type { BridgeSession, BridgeStore } from '../host.js';
import {
  formatCreatorBadge,
  resolveCreatorKind,
  type CodexSourceSummary,
  type CreatorKind,
} from './session-creator.js';
import type { ChannelBinding } from '../types.js';

export interface SessionDisplaySummary {
  kind: 'bridge' | 'codex';
  bridgeSessionId?: string;
  sessionId?: string;
  codexThreadId: string;
  threadId: string;
  displayTitle: string;
  title: string;
  codexTitle: string;
  cwd: string;
  mode: string;
  executionProvider: string;
  codexProvider: string;
  creatorKind: CreatorKind;
  creatorLabel: string;
  creatorClass: string;
  codexSource?: CodexSourceSummary;
  originator: string;
  source: string;
  lastEventAt: string;
}

export interface SessionDisplayCounts {
  codexPhysical: number;
  bridgeStored: number;
  bridgeWithoutCodexThread: number;
  bridgeCodexLinked: number;
  dedupedBridgeRows: number;
  totalDisplayable: number;
  displayed: number;
}

export interface SessionDisplayListPayload {
  root: string;
  sessions: SessionDisplaySummary[];
  counts: SessionDisplayCounts;
}

export interface BindingDisplaySummary {
  bindingId: string;
  bridgeSessionId: string;
  codexThreadId: string;
  displayTitle: string;
  codexTitle: string;
  cwd: string;
  executionProvider: string;
  creatorKind: CreatorKind;
  codexSource?: CodexSourceSummary;
}

export function getBridgeSessionCodexThreadId(session: Pick<BridgeSession, 'codex_thread_id'>): string {
  return session.codex_thread_id?.trim() || '';
}

export function isVisibleBridgeSession(session: BridgeSession): boolean {
  return session.hidden !== true && session.session_type !== 'draft';
}

export function getBridgeSessionDisplayTitle(session: BridgeSession): string {
  if (session.name?.trim()) return stripLegacySessionPrefix(session.name);
  if (session.codex_title?.trim()) return stripLegacySessionPrefix(session.codex_title);
  if (session.working_directory) {
    const parts = session.working_directory.split(/[\\/]+/).filter(Boolean);
    return parts[parts.length - 1] || session.id.slice(0, 8);
  }
  return session.id.slice(0, 8);
}

export function bridgeSessionMode(session: BridgeSession | null | undefined): string {
  return session?.preferred_mode === 'yolo' ? 'yolo' : 'normal';
}

export function bridgeSessionExecutionProvider(session: BridgeSession | null | undefined): string {
  return session?.codex_provider || 'default';
}

export function findVisibleBridgeSessionByCodexThread(
  store: Pick<BridgeStore, 'listSessions'>,
  codexThreadId: string,
): BridgeSession | undefined {
  if (!codexThreadId) return undefined;
  return store.listSessions().find((session) => (
    isVisibleBridgeSession(session)
    && getBridgeSessionCodexThreadId(session) === codexThreadId
  ));
}

export function buildBridgeSessionDisplaySummary(session: BridgeSession): SessionDisplaySummary {
  const codexThreadId = getBridgeSessionCodexThreadId(session);
  const title = getBridgeSessionDisplayTitle(session);
  const executionProvider = bridgeSessionExecutionProvider(session);
  const creatorBadge = formatCreatorBadge('bridge');
  return {
    kind: 'bridge',
    bridgeSessionId: session.id,
    sessionId: session.id,
    codexThreadId,
    threadId: codexThreadId,
    displayTitle: title,
    title,
    codexTitle: session.codex_title || '',
    cwd: session.working_directory || '',
    mode: bridgeSessionMode(session),
    executionProvider,
    codexProvider: executionProvider,
    creatorKind: 'bridge',
    creatorLabel: creatorBadge.label,
    creatorClass: creatorBadge.className,
    originator: 'Bridge / IM',
    source: 'bridge',
    lastEventAt: session.updated_at || session.created_at || '',
  };
}

export function buildCodexThreadDisplaySummary(
  session: CodexSessionSummary,
  linkedBridgeSession?: BridgeSession,
): SessionDisplaySummary {
  const linkedWithCodexTitle = linkedBridgeSession && !linkedBridgeSession.codex_title?.trim()
    ? { ...linkedBridgeSession, codex_title: session.title }
    : linkedBridgeSession;
  const title = linkedWithCodexTitle ? getBridgeSessionDisplayTitle(linkedWithCodexTitle) : session.title;
  const codexSource: CodexSourceSummary = {
    originator: session.originator || undefined,
    source: session.source || undefined,
    cliVersion: session.cliVersion || undefined,
  };
  const executionProvider = linkedBridgeSession ? bridgeSessionExecutionProvider(linkedBridgeSession) : 'unknown';
  const creatorKind = resolveCreatorKind(codexSource);
  const creatorBadge = formatCreatorBadge(creatorKind);
  return {
    kind: 'codex',
    bridgeSessionId: linkedBridgeSession?.id,
    sessionId: linkedBridgeSession?.id,
    codexThreadId: session.threadId,
    threadId: session.threadId,
    displayTitle: title,
    title,
    codexTitle: linkedBridgeSession?.codex_title || session.title || '',
    cwd: session.cwd,
    mode: linkedBridgeSession ? bridgeSessionMode(linkedBridgeSession) : '-',
    executionProvider,
    codexProvider: linkedBridgeSession ? executionProvider : '-',
    creatorKind,
    creatorLabel: creatorBadge.label,
    creatorClass: creatorBadge.className,
    codexSource,
    originator: session.originator || 'Codex Native',
    source: session.source || 'codex',
    lastEventAt: session.lastEventAt,
  };
}

export function buildBindingDisplaySummary(
  store: Pick<BridgeStore, 'getSession'>,
  binding: ChannelBinding,
): BindingDisplaySummary {
  const session = store.getSession(binding.bridgeSessionId);
  const codexThreadId = session ? getBridgeSessionCodexThreadId(session) : '';
  const displayTitle = session
    ? getBridgeSessionDisplayTitle(session)
    : (binding.workingDirectory ? path.basename(binding.workingDirectory) : binding.bridgeSessionId.slice(0, 8));
  return {
    bindingId: binding.id,
    bridgeSessionId: binding.bridgeSessionId,
    codexThreadId,
    displayTitle,
    codexTitle: session?.codex_title || '',
    cwd: binding.workingDirectory || session?.working_directory || '',
    executionProvider: bridgeSessionExecutionProvider(session),
    creatorKind: session ? 'bridge' : 'native',
  };
}

export class SessionDisplayQuery {
  constructor(private readonly store: BridgeStore) {}

  bridgeSession(session: BridgeSession): SessionDisplaySummary {
    return buildBridgeSessionDisplaySummary(session);
  }

  codexThread(session: CodexSessionSummary): SessionDisplaySummary {
    return buildCodexThreadDisplaySummary(
      session,
      findVisibleBridgeSessionByCodexThread(this.store, session.threadId),
    );
  }

  binding(binding: ChannelBinding): BindingDisplaySummary {
    return buildBindingDisplaySummary(this.store, binding);
  }

  listSessions(
    codexRawSessions: CodexSessionSummary[],
    options: { root: string; limit?: number },
  ): SessionDisplayListPayload {
    const codexThreadIds = new Set(codexRawSessions.map((session) => session.threadId));
    const bridgeRawSessions = this.store.listSessions()
      .filter(isVisibleBridgeSession)
      .sort((left, right) => (
        (right.updated_at || right.created_at || '').localeCompare(left.updated_at || left.created_at || '')
      ));
    const bridgeByCodexThreadId = new Map<string, BridgeSession>();
    for (const session of bridgeRawSessions) {
      const threadId = getBridgeSessionCodexThreadId(session);
      if (threadId && !bridgeByCodexThreadId.has(threadId)) {
        bridgeByCodexThreadId.set(threadId, session);
      }
    }

    let dedupedBridgeRows = 0;
    const seenThreadIds = new Set(codexThreadIds);
    const bridgeSessions: SessionDisplaySummary[] = [];
    for (const session of bridgeRawSessions) {
      const threadId = getBridgeSessionCodexThreadId(session);
      if (threadId) {
        if (seenThreadIds.has(threadId)) {
          dedupedBridgeRows += 1;
          continue;
        }
        seenThreadIds.add(threadId);
      }
      bridgeSessions.push(buildBridgeSessionDisplaySummary(session));
    }

    const codexSessions = codexRawSessions.map((session) => (
      buildCodexThreadDisplaySummary(session, bridgeByCodexThreadId.get(session.threadId))
    ));

    const combined = [...bridgeSessions, ...codexSessions]
      .sort((left, right) => (right.lastEventAt || '').localeCompare(left.lastEventAt || ''));

    const sessions = typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
      ? combined.slice(0, Math.floor(options.limit))
      : combined;

    const bridgeWithoutCodexThread = bridgeRawSessions
      .filter((session) => !getBridgeSessionCodexThreadId(session))
      .length;

    return {
      root: options.root,
      sessions,
      counts: {
        codexPhysical: codexRawSessions.length,
        bridgeStored: bridgeRawSessions.length,
        bridgeWithoutCodexThread,
        bridgeCodexLinked: bridgeRawSessions.length - bridgeWithoutCodexThread,
        dedupedBridgeRows,
        totalDisplayable: combined.length,
        displayed: sessions.length,
      },
    };
  }
}
