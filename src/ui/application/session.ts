import MarkdownIt from 'markdown-it';

import {
  SessionDisplayQuery,
  buildBridgeSessionDisplaySummary,
  buildCodexThreadDisplaySummary,
  findVisibleBridgeSessionByCodexThread,
  getBridgeSessionCodexThreadId,
  getBridgeSessionDisplayTitle,
  type SessionDisplayListPayload,
  type SessionDisplaySummary,
} from '../../lib/bridge/display/session-display-query.js';
import { stripLegacySessionPrefix } from '../../lib/bridge/display/session-title.js';
import type { BridgeSession } from '../../lib/bridge/host.js';
import type { JsonFileStore } from '../../store.js';
import {
  createUiSessionRegistry,
  defaultUiSessionCodexSource,
  type UiSessionCodexSource,
} from './session-source.js';

export type UiSessionSummary = SessionDisplaySummary;
export type UiSessionListPayload = SessionDisplayListPayload;

export interface UiSessionIdentity {
  bridgeSessionId?: string;
  codexThreadId?: string;
}

export interface UiSessionHistoryMessage {
  role: string;
  kind: string;
  content: string;
  renderedContent: string;
  timestamp: string;
  rawJsonl: string;
}

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
});

function renderHistoryMarkdown(content: string): string {
  return markdownRenderer.render(content || '');
}

function uiHistoryMessage(
  role: string,
  kind: string,
  content: string,
  timestamp: string,
  rawJsonl?: string,
): UiSessionHistoryMessage {
  const raw = typeof rawJsonl === 'string' && rawJsonl.length > 0
    ? rawJsonl
    : JSON.stringify({ role, kind, content, timestamp });
  return {
    role,
    kind,
    content,
    renderedContent: renderHistoryMarkdown(content),
    timestamp,
    rawJsonl: raw,
  };
}

function uiCodexHistoryMessages(codexSource: UiSessionCodexSource, threadId: string): UiSessionHistoryMessage[] {
  const entries = codexSource.readJsonlHistory(threadId);
  return entries.map((entry) => uiHistoryMessage(entry.role, entry.kind, entry.content, entry.timestamp, entry.rawJsonl));
}

function getBridgeSessionTitle(session: BridgeSession): string {
  return getBridgeSessionDisplayTitle(session);
}

function getStoredCodexThreadId(session: Pick<BridgeSession, 'codex_thread_id'>): string {
  return getBridgeSessionCodexThreadId(session);
}

function findBridgeSessionByCodexThread(store: JsonFileStore, threadId: string): BridgeSession | undefined {
  return findVisibleBridgeSessionByCodexThread(store, threadId);
}

function bridgeSessionToSummary(session: BridgeSession): UiSessionSummary {
  return buildBridgeSessionDisplaySummary(session);
}

function codexSessionToSummary(codexSource: UiSessionCodexSource, threadId: string, store?: JsonFileStore): UiSessionSummary | null {
  const session = codexSource.getThread(threadId);
  if (!session) return null;
  const linked = store ? findBridgeSessionByCodexThread(store, threadId) : undefined;
  return buildCodexThreadDisplaySummary(session, linked);
}

function sanitizeSessionConfig(payload: Record<string, unknown>): Partial<BridgeSession> {
  const updates: Partial<BridgeSession> = {};
  if (typeof payload.name === 'string') {
    updates.name = payload.name.trim() || undefined;
  }
  if (typeof payload.workingDirectory === 'string') {
    updates.working_directory = payload.workingDirectory.trim() || process.cwd();
  }
  if (typeof payload.model === 'string') {
    updates.model = payload.model.trim();
  }
  if (payload.preferredMode === 'yolo' || payload.preferredMode === 'normal' || payload.preferredMode === 'code') {
    updates.preferred_mode = payload.preferredMode === 'yolo' ? 'yolo' : 'normal';
  }
  if (payload.codexProvider === 'sdk' || payload.codexProvider === 'tmux' || payload.codexProvider === '') {
    updates.codex_provider = payload.codexProvider ? payload.codexProvider : undefined;
  }
  if (typeof payload.systemPrompt === 'string') {
    updates.system_prompt = payload.systemPrompt.trim() || undefined;
  }
  if (
    payload.reasoningEffort === 'minimal'
    || payload.reasoningEffort === 'low'
    || payload.reasoningEffort === 'medium'
    || payload.reasoningEffort === 'high'
    || payload.reasoningEffort === 'xhigh'
    || payload.reasoningEffort === ''
  ) {
    updates.reasoning_effort = payload.reasoningEffort ? payload.reasoningEffort : undefined;
  }
  if (
    payload.codexSandboxMode === 'read-only'
    || payload.codexSandboxMode === 'workspace-write'
    || payload.codexSandboxMode === 'danger-full-access'
    || payload.codexSandboxMode === ''
  ) {
    updates.codex_sandbox_mode = payload.codexSandboxMode ? payload.codexSandboxMode : undefined;
  }
  if (payload.codexNetworkAccess === true || payload.codexNetworkAccess === false) {
    updates.codex_network_access = payload.codexNetworkAccess;
  }
  return updates;
}

function sessionConfigPayload(session: BridgeSession) {
  return {
    id: session.id,
    bridgeSessionId: session.id,
    name: session.name ? stripLegacySessionPrefix(session.name) : '',
    codexTitle: session.codex_title || '',
    title: getBridgeSessionTitle(session),
    workingDirectory: session.working_directory || '',
    model: session.model || '',
    preferredMode: session.preferred_mode === 'yolo' ? 'yolo' : 'normal',
    codexProvider: session.codex_provider || '',
    systemPrompt: session.system_prompt || '',
    reasoningEffort: session.reasoning_effort || '',
    codexSandboxMode: session.codex_sandbox_mode || '',
    codexNetworkAccess: session.codex_network_access,
  };
}

export class UiSessionApplication {
  constructor(
    private readonly store: JsonFileStore,
    private readonly codexSource: UiSessionCodexSource = defaultUiSessionCodexSource,
  ) {}

  private createSessionRegistry() {
    return createUiSessionRegistry(this.store, this.codexSource);
  }

  listSessions(limit?: number): UiSessionListPayload {
    const codexRawSessions = this.codexSource.listSessions();
    return new SessionDisplayQuery(this.store).listSessions(codexRawSessions, {
      root: this.codexSource.getSessionsRoot(),
      limit,
    });
  }

  getHistory(identity: UiSessionIdentity): {
    session: UiSessionSummary;
    source: string;
    messages: UiSessionHistoryMessage[];
  } {
    if (identity.bridgeSessionId) {
      const session = this.store.getSession(identity.bridgeSessionId);
      if (!session || session.hidden === true || session.session_type === 'draft') {
        throw new Error('指定的 Bridge 会话不存在。');
      }

      const codexThreadId = getStoredCodexThreadId(session);
      if (codexThreadId) {
        const codexSummary = codexSessionToSummary(this.codexSource, codexThreadId, this.store);
        return {
          session: codexSummary || bridgeSessionToSummary(session),
          source: 'codex',
          messages: uiCodexHistoryMessages(this.codexSource, codexThreadId),
        };
      }

      const { messages } = this.store.getMessages(session.id);
      return {
        session: bridgeSessionToSummary(session),
        source: 'bridge',
        messages: messages.map((message) => uiHistoryMessage(message.role, 'bridge:message', message.content, message.timestamp || '')),
      };
    }

    if (identity.codexThreadId) {
      const summary = codexSessionToSummary(this.codexSource, identity.codexThreadId, this.store);
      if (!summary) {
        throw new Error('指定的 Codex 会话不存在。');
      }

      return {
        session: summary,
        source: 'codex',
        messages: uiCodexHistoryMessages(this.codexSource, identity.codexThreadId),
      };
    }

    throw new Error('不支持的会话目标。');
  }

  getConfig(bridgeSessionId: string) {
    const session = this.createSessionRegistry().getVisibleBridgeSession(bridgeSessionId);
    return sessionConfigPayload(session);
  }

  importCodexThread(codexThreadId: string) {
    const session = this.createSessionRegistry().materializeCodexThread(codexThreadId);
    return {
      bridgeSessionId: session.id,
      session: bridgeSessionToSummary(session),
      config: sessionConfigPayload(session),
    };
  }

  renameSession(identity: UiSessionIdentity, name: string | undefined) {
    const registry = this.createSessionRegistry();
    const updated = identity.bridgeSessionId
      ? registry.renameBridgeSession(identity.bridgeSessionId, name)
      : registry.renameCodexThread(identity.codexThreadId!, name);
    return sessionConfigPayload(updated);
  }

  updateConfig(bridgeSessionId: string, payload: Record<string, unknown>) {
    const registry = this.createSessionRegistry();
    const updates = sanitizeSessionConfig(payload);
    const updated = registry.updateBridgeSessionConfig(bridgeSessionId, updates);
    return sessionConfigPayload(updated);
  }

  deleteSession(identity: UiSessionIdentity): { deleted: UiSessionSummary; deletedBridgeSessionIds: string[] } {
    if (identity.bridgeSessionId) {
      const registry = this.createSessionRegistry();
      const session = registry.getVisibleBridgeSession(identity.bridgeSessionId);
      const summary = bridgeSessionToSummary(session);
      registry.deleteBridgeSession(session.id);
      return { deleted: summary, deletedBridgeSessionIds: [session.id] };
    }

    if (identity.codexThreadId) {
      const summary = codexSessionToSummary(this.codexSource, identity.codexThreadId, this.store);
      if (!summary) {
        throw new Error('指定的 Codex 会话不存在。');
      }

      const result = this.createSessionRegistry().archiveCodexThread(identity.codexThreadId);
      return { deleted: summary, deletedBridgeSessionIds: result.deletedBridgeSessionIds };
    }

    throw new Error('不支持的会话目标。');
  }
}
