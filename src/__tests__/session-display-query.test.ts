import './test-setup.js';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { CodexSessionSummary } from '../codex/session-index.js';
import { SessionDisplayQuery } from '../lib/bridge/display/session-display-query.js';
import { JsonFileStore } from '../store.js';
import { makeBridgeSettings, resetBridgeTestState } from './test-bridge-utils.js';

function codexSessionSummary(overrides: Partial<CodexSessionSummary>): CodexSessionSummary {
  return {
    threadId: 'thread-default',
    filePath: '/tmp/thread-default.jsonl',
    cwd: '/tmp/default',
    originator: 'Codex Desktop',
    source: 'desktop',
    firstSeenAt: '2026-05-29T00:00:00.000Z',
    lastEventAt: '2026-05-29T00:00:00.000Z',
    title: 'Codex thread',
    activeEstimate: false,
    ...overrides,
  };
}

describe('SessionDisplayQuery', () => {
  beforeEach(() => {
    resetBridgeTestState();
  });

  it('builds UI-compatible summaries with canonical identity, CodexSource, and Creator fields', () => {
    const store = new JsonFileStore(makeBridgeSettings());
    const linked = store.createSession('Desktop: Linked workspace', 'test-model', undefined, '/repo/linked');
    store.updateSession(linked.id, { codex_provider: 'tmux', preferred_mode: 'yolo' });
    store.updateSessionCodexThreadId(linked.id, 'thread-linked');
    const bridgeOnly = store.createSession('Bridge only', 'test-model', undefined, '/repo/bridge');

    const payload = new SessionDisplayQuery(store).listSessions([
      codexSessionSummary({
        threadId: 'thread-linked',
        cwd: '/repo/codex-linked',
        title: 'Raw Codex title',
        originator: 'Codex Desktop',
        source: 'vscode',
        cliVersion: '1.2.3',
        lastEventAt: '2026-05-29T01:00:00.000Z',
      }),
      codexSessionSummary({
        threadId: 'thread-unlinked',
        cwd: '/repo/unlinked',
        title: 'Unlinked Codex',
        originator: 'Codex CLI',
        source: 'cli',
        lastEventAt: '2026-05-29T00:30:00.000Z',
      }),
    ], { root: '/codex-root' });

    assert.equal(payload.root, '/codex-root');
    assert.equal(payload.counts.codexPhysical, 2);
    assert.equal(payload.counts.bridgeStored, 2);
    assert.equal(payload.counts.bridgeWithoutCodexThread, 1);
    assert.equal(payload.counts.dedupedBridgeRows, 1);
    assert.equal(payload.counts.totalDisplayable, 3);

    const linkedRow = payload.sessions.find((session) => session.codexThreadId === 'thread-linked');
    assert.ok(linkedRow);
    assert.equal(linkedRow.kind, 'bridge');
    assert.equal(linkedRow.bridgeSessionId, linked.id);
    assert.equal(linkedRow.sessionId, linked.id);
    assert.equal(linkedRow.displayTitle, 'Linked workspace');
    assert.equal(linkedRow.title, 'Linked workspace');
    assert.equal(linkedRow.codexTitle, 'Raw Codex title');
    assert.equal(linkedRow.cwd, '/repo/linked');
    assert.equal(linkedRow.mode, 'yolo');
    assert.equal(linkedRow.executionProvider, 'tmux');
    assert.equal(linkedRow.codexProvider, 'tmux');
    assert.equal(linkedRow.creatorKind, 'bridge');
    assert.equal(linkedRow.creatorLabel, 'Bridge');
    assert.equal(linkedRow.creatorClass, 'bridge');
    assert.equal(linkedRow.codexSource, undefined);

    const bridgeOnlyRow = payload.sessions.find((session) => session.bridgeSessionId === bridgeOnly.id);
    assert.ok(bridgeOnlyRow);
    assert.equal(bridgeOnlyRow.kind, 'bridge');
    assert.equal(bridgeOnlyRow.codexThreadId, '');
    assert.equal(bridgeOnlyRow.creatorKind, 'bridge');
    assert.equal(bridgeOnlyRow.creatorLabel, 'Bridge');
    assert.equal(bridgeOnlyRow.creatorClass, 'bridge');

    const unlinkedRow = payload.sessions.find((session) => session.codexThreadId === 'thread-unlinked');
    assert.ok(unlinkedRow);
    assert.equal(unlinkedRow.bridgeSessionId, undefined);
    assert.equal(unlinkedRow.creatorKind, 'tui_cli');
    assert.equal(unlinkedRow.creatorLabel, 'TUI / CLI');
    assert.equal(unlinkedRow.creatorClass, 'tui');
    assert.equal(unlinkedRow.executionProvider, 'unknown');
    assert.equal(unlinkedRow.codexTitle, 'Unlinked Codex');
  });

  it('uses BridgeSession codex_title for linked Codex rows when name is not set', () => {
    const store = new JsonFileStore(makeBridgeSettings());
    const linked = store.createSession('', 'test-model', undefined, '/repo/linked');
    store.updateSession(linked.id, { codex_title: 'Stored Codex Title' });
    store.updateSessionCodexThreadId(linked.id, 'thread-linked');

    const payload = new SessionDisplayQuery(store).listSessions([
      codexSessionSummary({
        threadId: 'thread-linked',
        cwd: '/repo/codex-linked',
        title: 'Raw Codex title',
      }),
    ], { root: '/codex-root' });

    const linkedRow = payload.sessions.find((session) => session.codexThreadId === 'thread-linked');
    assert.ok(linkedRow);
    assert.equal(linkedRow.displayTitle, 'Stored Codex Title');
    assert.equal(linkedRow.title, 'Stored Codex Title');
    assert.equal(linkedRow.codexTitle, 'Stored Codex Title');
  });
});
