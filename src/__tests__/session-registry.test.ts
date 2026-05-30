import './test-setup.js';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SessionRegistryService } from '../lib/bridge/session-registry.js';
import { JsonFileStore } from '../store.js';
import { makeBridgeSettings, resetBridgeTestState } from './test-bridge-utils.js';

describe('SessionRegistryService', () => {
  beforeEach(() => {
    resetBridgeTestState();
  });

  it('binds a chat to a BridgeSession using canonical service vocabulary', () => {
    const store = new JsonFileStore(makeBridgeSettings());
    const registry = new SessionRegistryService(store);
    const session = store.createSession('Bridge target', 'test-model', undefined, '/tmp/bridge-target');

    const binding = registry.bindChatToBridgeSession({
      channelType: 'feishu',
      chatId: 'chat-bridge',
      userId: 'ou_bridge',
      displayName: 'Bridge User',
    }, session.id);

    assert.ok(binding);
    assert.equal(binding.bridgeSessionId, session.id);
    assert.equal(binding.chatUserId, 'ou_bridge');
    assert.equal(binding.chatDisplayName, 'Bridge User');
  });

  it('imports a Codex thread into a BridgeSession before binding the chat', () => {
    const store = new JsonFileStore(makeBridgeSettings());
    const registry = new SessionRegistryService(store);

    const binding = registry.importCodexThreadForChat({
      channelType: 'feishu',
      chatId: 'chat-codex-thread',
      displayName: 'Thread User',
    }, 'codex-thread-registry', {
      workingDirectory: '/tmp/codex-thread',
      displayName: 'Imported Codex Thread',
    });
    const session = store.getSession(binding.bridgeSessionId);

    assert.ok(session);
    assert.equal(session.codex_thread_id, 'codex-thread-registry');
    assert.equal(session.name, '');
    assert.equal(session.codex_title, 'Imported Codex Thread');
    assert.equal(binding.workingDirectory, '/tmp/codex-thread');
    assert.equal(binding.chatDisplayName, 'Thread User');
  });

  it('materializes, renames, configures, and deletes BridgeSessions by canonical id', () => {
    const store = new JsonFileStore(makeBridgeSettings());
    const registry = new SessionRegistryService(store, {
      codexThreads: {
        getThread: (codexThreadId) => ({
          codexThreadId,
          title: 'Local Codex Thread',
          cwd: '/tmp/local-codex-thread',
        }),
      },
      readDefaultModel: () => 'model-from-port',
    });

    const materialized = registry.materializeCodexThread('codex-thread-materialized');
    assert.equal(materialized.codex_thread_id, 'codex-thread-materialized');
    assert.equal(materialized.name, '');
    assert.equal(materialized.codex_title, 'Local Codex Thread');
    assert.equal(materialized.model, 'model-from-port');

    const renamed = registry.renameBridgeSession(materialized.id, 'Renamed BridgeSession');
    assert.equal(renamed.name, 'Renamed BridgeSession');

    const configured = registry.updateBridgeSessionConfig(materialized.id, {
      preferred_mode: 'yolo',
      codex_provider: 'tmux',
    });
    assert.equal(configured.preferred_mode, 'yolo');
    assert.equal(configured.codex_provider, 'tmux');

    const deleted = registry.deleteBridgeSession(materialized.id);
    assert.equal(deleted.deleted.id, materialized.id);
    assert.deepEqual(deleted.deletedBridgeSessionIds, [materialized.id]);
    assert.equal(store.getSession(materialized.id), null);
  });

  it('archives a Codex thread and deletes linked BridgeSessions', () => {
    const store = new JsonFileStore(makeBridgeSettings());
    let archivedThreadId = '';
    const registry = new SessionRegistryService(store, {
      codexThreads: {
        getThread: (codexThreadId) => ({
          codexThreadId,
          title: 'Archive target',
          cwd: '/tmp/archive-target',
        }),
        archiveThread: (codexThreadId) => {
          archivedThreadId = codexThreadId;
          return true;
        },
      },
      readDefaultModel: () => 'test-model',
    });
    const first = registry.materializeCodexThread('codex-thread-archive');
    const second = store.createSession('linked duplicate', 'test-model', undefined, '/tmp/archive-target');
    store.updateSessionCodexThreadId(second.id, 'codex-thread-archive');

    const result = registry.archiveCodexThread('codex-thread-archive');

    assert.equal(archivedThreadId, 'codex-thread-archive');
    assert.deepEqual(result.deletedBridgeSessionIds.sort(), [first.id, second.id].sort());
    assert.equal(store.getSession(first.id), null);
    assert.equal(store.getSession(second.id), null);
  });

  it('sets channel default targets by BridgeSession id', () => {
    const store = new JsonFileStore(makeBridgeSettings());
    const registry = new SessionRegistryService(store);
    const session = store.createSession('Default target', 'test-model', undefined, '/tmp/default-target');

    const defaultTarget = registry.setChannelDefaultBridgeSession('feishu', session.id);

    assert.equal(defaultTarget.bridgeSessionId, session.id);
    assert.equal(defaultTarget.targetSessionId, session.id);
    registry.removeChannelDefaultTarget('feishu');
    assert.equal(store.getChannelDefaultTarget('feishu'), null);
  });
});
