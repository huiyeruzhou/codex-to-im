import './test-setup.js';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { UiSessionApplication } from '../ui/application/session.js';
import type { UiSessionCodexSource } from '../ui/application/session-source.js';
import { JsonFileStore } from '../store.js';
import { makeBridgeSettings, resetBridgeTestState } from './test-bridge-utils.js';

describe('UiSessionApplication', () => {
  beforeEach(() => {
    resetBridgeTestState();
  });

  it('uses one injected Codex source for list, history, import, and archive use cases', () => {
    const store = new JsonFileStore(makeBridgeSettings());
    const archivedThreadIds: string[] = [];
    const thread = {
      threadId: 'codex-thread-ui-source',
      filePath: '/tmp/codex-thread-ui-source.jsonl',
      cwd: '/tmp/codex-ui-source',
      originator: 'Codex CLI',
      source: 'cli',
      firstSeenAt: '2026-05-30T00:00:00.000Z',
      lastEventAt: '2026-05-30T00:00:01.000Z',
      title: 'Codex UI Source',
      activeEstimate: false,
    };
    const codexSource: UiSessionCodexSource = {
      listSessions: () => [thread],
      getSessionsRoot: () => '/tmp/codex-sessions',
      getThread: (codexThreadId) => (codexThreadId === thread.threadId ? thread : null),
      readJsonlHistory: (codexThreadId) => (codexThreadId === thread.threadId ? [{
        signature: 'history-1',
        role: 'user',
        kind: 'codex:user_message',
        content: 'hello **session**',
        timestamp: '2026-05-30T00:00:02.000Z',
        rawJsonl: '{"type":"event_msg"}',
      }] : []),
      archiveThread(codexThreadId) {
        archivedThreadIds.push(codexThreadId);
        return codexThreadId === thread.threadId;
      },
      readDefaultModel: () => 'model-from-ui-source',
      defaultWorkingDirectory: () => '/tmp/default-ui-source',
    };
    const app = new UiSessionApplication(store, codexSource);

    const list = app.listSessions();
    assert.equal(list.root, '/tmp/codex-sessions');
    assert.equal(list.sessions[0]?.codexThreadId, thread.threadId);

    const history = app.getHistory({ codexThreadId: thread.threadId });
    assert.equal(history.source, 'codex');
    assert.equal(history.messages[0]?.rawJsonl, '{"type":"event_msg"}');
    assert.match(history.messages[0]?.renderedContent || '', /<strong>session<\/strong>/);

    const imported = app.importCodexThread(thread.threadId);
    assert.equal(imported.config.model, 'model-from-ui-source');
    assert.equal(store.getSession(imported.bridgeSessionId)?.codex_thread_id, thread.threadId);

    const deleted = app.deleteSession({ codexThreadId: thread.threadId });
    assert.deepEqual(archivedThreadIds, [thread.threadId]);
    assert.deepEqual(deleted.deletedBridgeSessionIds, [imported.bridgeSessionId]);
  });
});
