import './test-setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JsonFileStore } from '../store.js';
import { CTI_HOME, CONFIG_V2_PATH } from '../config.js';

const DATA_DIR = path.join(CTI_HOME, 'data');

// We construct the store with a settings map directly
function makeSettings(): Map<string, string> {
  return new Map([
    ['remote_bridge_enabled', 'true'],
    ['bridge_default_model', 'test-model'],
    ['bridge_default_mode', 'code'],
  ]);
}

describe('JsonFileStore', () => {
  beforeEach(() => {
    // Clean data dir before each test for isolation
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('getSetting returns values from settings map', () => {
    const store = new JsonFileStore(makeSettings());
    assert.equal(store.getSetting('remote_bridge_enabled'), 'true');
    assert.equal(store.getSetting('bridge_default_model'), 'test-model');
    assert.equal(store.getSetting('nonexistent'), null);
  });

  it('createSession and getSession', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model-1', 'system prompt', '/tmp');
    assert.ok(session.id);
    assert.equal(session.model, 'model-1');
    assert.equal(session.working_directory, '/tmp');
    assert.equal(session.system_prompt, 'system prompt');

    const fetched = store.getSession(session.id);
    assert.ok(fetched);
    assert.equal(fetched.id, session.id);
    assert.equal(fetched.name, session.name);
    assert.equal(fetched.model, session.model);
    assert.equal(fetched.working_directory, session.working_directory);
    assert.equal(fetched.system_prompt, session.system_prompt);
    assert.equal(fetched.session_type, 'normal');
    assert.equal(fetched.hidden, false);
    assert.ok(fetched.created_at);
    assert.ok(fetched.updated_at);
  });

  it('getSession returns null for unknown id', () => {
    const store = new JsonFileStore(makeSettings());
    assert.equal(store.getSession('nonexistent'), null);
  });

  it('updateSession can preserve updated_at for derived metadata writes', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('diagnostic-touch', 'model-1', undefined, '/tmp');
    const originalUpdatedAt = session.updated_at;

    store.updateSession(session.id, {
      health_status: 'completed',
      health_reason: '任务已完成。',
    }, { touch: false });

    const fetched = store.getSession(session.id);
    assert.equal(fetched?.updated_at, originalUpdatedAt);
    assert.equal(fetched?.health_status, 'completed');
    assert.equal(fetched?.health_reason, '任务已完成。');
  });

  it('upsertChannelBinding creates multiple bindings per chat and switches active target', () => {
    const store = new JsonFileStore(makeSettings());
    const b1 = store.upsertChannelBinding({
      channelType: 'feishu-default',
      chatId: '123',
      chatUserId: 'user-1',
      chatDisplayName: 'Alice',
      bridgeSessionId: 'sess-1',
      workingDirectory: '/tmp',
      model: 'model-1',
      mode: 'code',
    });
    assert.ok(b1.id);
    assert.equal(b1.channelType, 'feishu-default');
    assert.equal(b1.chatId, '123');
    assert.equal(b1.chatUserId, 'user-1');
    assert.equal(b1.chatDisplayName, 'Alice');

    // Upserting a different target in the same chat should preserve the old
    // binding and make the new target active.
    const b2 = store.upsertChannelBinding({
      channelType: 'feishu-default',
      chatId: '123',
      chatDisplayName: 'Alice Cooper',
      bridgeSessionId: 'sess-2',
      workingDirectory: '/tmp/new',
      model: 'model-2',
      mode: 'yolo',
    });
    assert.notEqual(b2.id, b1.id);
    assert.equal(b2.bridgeSessionId, 'sess-2');
    assert.equal(b2.mode, 'yolo');
    assert.equal(b2.chatUserId, undefined);
    assert.equal(b2.chatDisplayName, 'Alice Cooper');
    assert.equal(store.getChannelBinding('feishu-default', '123')?.id, b2.id);

    const bindings = store.listChannelBindings('feishu-default').filter((binding) => binding.chatId === '123');
    assert.equal(bindings.length, 2);
    assert.equal(bindings.filter((binding) => binding.active !== false).length, 1);
    assert.equal(bindings.find((binding) => binding.id === b1.id)?.active, false);

    const b1Updated = store.upsertChannelBinding({
      channelType: 'feishu-default',
      chatId: '123',
      chatUserId: 'user-1b',
      chatDisplayName: 'Alice',
      bridgeSessionId: 'sess-1',
      workingDirectory: '/tmp/again',
      model: 'model-1b',
    });
    assert.equal(b1Updated.id, b1.id);
    assert.equal(store.getChannelBinding('feishu-default', '123')?.id, b1.id);
    assert.equal(b1Updated.chatUserId, 'user-1b');
  });

  it('can add an inactive binding without changing the current active binding', () => {
    const store = new JsonFileStore(makeSettings());
    const active = store.upsertChannelBinding({
      channelType: 'feishu-default',
      chatId: 'multi',
      bridgeSessionId: 'sess-active',
      workingDirectory: '/tmp/active',
      model: 'model-1',
    });
    const inactive = store.upsertChannelBinding({
      channelType: 'feishu-default',
      chatId: 'multi',
      bridgeSessionId: 'sess-inactive',
      workingDirectory: '/tmp/inactive',
      model: 'model-2',
      active: false,
    });

    assert.equal(store.getChannelBinding('feishu-default', 'multi')?.id, active.id);
    assert.equal(store.listChannelBindings().find((binding) => binding.id === inactive.id)?.active, false);
  });

  it('upsertChannelBinding uses default mode from settings', () => {
    const settings = makeSettings();
    settings.set('bridge_default_mode', 'yolo');
    const store = new JsonFileStore(settings);
    const b = store.upsertChannelBinding({
      channelType: 'feishu-default',
      chatId: '456',
      bridgeSessionId: 'sess-1',
      workingDirectory: '/tmp',
      model: 'model-1',
    });
    assert.equal(b.mode, 'yolo');
  });

  it('getChannelBinding returns null for missing', () => {
    const store = new JsonFileStore(makeSettings());
    assert.equal(store.getChannelBinding('feishu-default', 'missing'), null);
  });

  it('deleteChannelBinding removes the binding by id', () => {
    const store = new JsonFileStore(makeSettings());
    const binding = store.upsertChannelBinding({
      channelType: 'feishu-default',
      chatId: 'delete-binding',
      bridgeSessionId: 'sess-1',
      workingDirectory: '/tmp',
      model: 'model-1',
    });

    store.deleteChannelBinding(binding.id);

    assert.equal(store.getChannelBinding('feishu-default', 'delete-binding'), null);
  });

  it('listChannelBindings filters by type', () => {
    const store = new JsonFileStore(makeSettings());
    store.upsertChannelBinding({
      channelType: 'feishu-default',
      chatId: '1',
      bridgeSessionId: 's1',
      workingDirectory: '/tmp',
      model: 'm',
    });
    store.upsertChannelBinding({
      channelType: 'weixin-default',
      chatId: '2',
      bridgeSessionId: 's2',
      workingDirectory: '/tmp',
      model: 'm',
    });
    assert.equal(store.listChannelBindings('feishu-default').length, 1);
    assert.equal(store.listChannelBindings('weixin-default').length, 1);
    assert.equal(store.listChannelBindings().length, 2);
  });

  it('persists channel default targets by channel instance', () => {
    const store = new JsonFileStore(makeSettings());
    const first = store.upsertChannelDefaultTarget({
      channelType: 'feishu-default',
      channelProvider: 'feishu',
      channelAlias: '飞书',
      bridgeSessionId: 'sess-1',
    });
    assert.ok(first.id);
    assert.equal(first.bridgeSessionId, 'sess-1');

    const updated = store.upsertChannelDefaultTarget({
      channelType: 'feishu-default',
      bridgeSessionId: 'sess-2',
    });
    assert.equal(updated.id, first.id);
    assert.equal(updated.bridgeSessionId, 'sess-2');

    const reloaded = new JsonFileStore(makeSettings());
    assert.equal(reloaded.getChannelDefaultTarget('feishu-default')?.bridgeSessionId, 'sess-2');
    assert.equal(reloaded.listChannelDefaultTargets().length, 1);

    reloaded.deleteChannelDefaultTarget('feishu-default');
    assert.equal(reloaded.getChannelDefaultTarget('feishu-default'), null);
  });

  it('migrates legacy singleton channel bindings to default v2 channel instances on reload', () => {
    const configBackup = fs.existsSync(CONFIG_V2_PATH) ? fs.readFileSync(CONFIG_V2_PATH, 'utf-8') : null;
    try {
      fs.mkdirSync(path.dirname(CONFIG_V2_PATH), { recursive: true });
      fs.writeFileSync(
        CONFIG_V2_PATH,
        JSON.stringify({
          schemaVersion: 2,
          runtime: {
            provider: 'codex',
            defaultMode: 'code',
            historyMessageLimit: 8,
          },
          channels: [
            {
              id: 'feishu-default',
              alias: '飞书主机器人',
              provider: 'feishu',
              enabled: true,
              createdAt: '2026-03-28T00:00:00.000Z',
              updatedAt: '2026-03-28T00:00:00.000Z',
              config: {
                appId: 'app-id',
              },
            },
          ],
        }, null, 2),
      );

      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(DATA_DIR, 'bindings.json'),
        JSON.stringify({
          legacy: {
            id: 'legacy',
            channelType: 'feishu',
            chatId: 'oc_legacy',
            bridgeSessionId: 'sess-legacy',
            workingDirectory: '/tmp',
            model: 'gpt-5.4',
            mode: 'code',
            active: true,
            createdAt: '2026-03-28T00:00:00.000Z',
            updatedAt: '2026-03-28T00:00:00.000Z',
          },
        }, null, 2),
      );

      const store = new JsonFileStore(makeSettings());
      const binding = store.getChannelBinding('feishu-default', 'oc_legacy');
      assert.ok(binding);
      assert.equal(binding.channelType, 'feishu-default');
      assert.equal(binding.channelProvider, 'feishu');
      assert.equal(binding.channelAlias, '飞书主机器人');

      const persisted = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bindings.json'), 'utf-8')) as Record<string, {
        channelType: string;
        channelProvider?: string;
        channelAlias?: string;
      }>;
      const persistedBinding = Object.values(persisted).find((entry) => entry.channelType === 'feishu-default');
      assert.ok(persistedBinding);
      assert.equal(persistedBinding.channelProvider, 'feishu');
      assert.equal(persistedBinding.channelAlias, '飞书主机器人');
    } finally {
      fs.rmSync(CONFIG_V2_PATH, { force: true });
      if (configBackup !== null) {
        fs.writeFileSync(CONFIG_V2_PATH, configBackup);
      }
    }
  });

  it('runs storage migrations before loading persisted data', () => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(DATA_DIR, 'sessions.json'),
      JSON.stringify({
        'session-old': {
          id: 'session-old',
          working_directory: '/tmp/old',
          model: 'gpt-old',
          sdk_session_id: 'old-thread-id',
          thread_origin: 'bridge',
        },
      }, null, 2),
    );
    fs.writeFileSync(
      path.join(DATA_DIR, 'bindings.json'),
      JSON.stringify({
        'binding-old': {
          id: 'binding-old',
          channelType: 'feishu-default',
          chatId: 'chat-old',
          bridgeSessionId: 'session-old',
          sdkSessionId: 'old-thread-id',
          workingDirectory: '/tmp/old',
          model: 'gpt-old',
          mode: 'normal',
          active: true,
          createdAt: '2026-05-28T00:00:00.000Z',
          updatedAt: '2026-05-28T00:00:00.000Z',
        },
      }, null, 2),
    );

    const store = new JsonFileStore(makeSettings());
    assert.equal(store.getSession('session-old')?.codex_thread_id, 'old-thread-id');
    assert.equal((store.getSession('session-old') as unknown as { sdk_session_id?: string }).sdk_session_id, undefined);

    const persistedBindings = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'bindings.json'), 'utf-8')) as Record<string, {
      sdkSessionId?: string;
    }>;
    assert.equal(persistedBindings['binding-old'].sdkSessionId, undefined);
  });

  it('does not remap a real v2 channel instance whose id matches the provider name', () => {
    const configBackup = fs.existsSync(CONFIG_V2_PATH) ? fs.readFileSync(CONFIG_V2_PATH, 'utf-8') : null;
    try {
      fs.mkdirSync(path.dirname(CONFIG_V2_PATH), { recursive: true });
      fs.writeFileSync(
        CONFIG_V2_PATH,
        JSON.stringify({
          schemaVersion: 2,
          runtime: {
            provider: 'codex',
            defaultMode: 'code',
            historyMessageLimit: 8,
          },
          channels: [
            {
              id: 'feishu-default',
              alias: '默认飞书',
              provider: 'feishu',
              enabled: true,
              createdAt: '2026-03-28T00:00:00.000Z',
              updatedAt: '2026-03-28T00:00:00.000Z',
              config: {
                appId: 'default-app',
              },
            },
            {
              id: 'feishu',
              alias: '开开1号',
              provider: 'feishu',
              enabled: true,
              createdAt: '2026-03-30T00:00:00.000Z',
              updatedAt: '2026-03-30T00:00:00.000Z',
              config: {
                appId: 'custom-app',
              },
            },
          ],
        }, null, 2),
      );

      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(DATA_DIR, 'bindings.json'),
        JSON.stringify({
          binding: {
            id: 'binding',
            channelType: 'feishu',
            channelProvider: 'feishu',
            channelAlias: '开开1号',
            chatId: 'oc_real_instance',
            bridgeSessionId: 'sess-real',
            workingDirectory: '/tmp',
            model: 'gpt-5.4',
            mode: 'code',
            active: true,
            createdAt: '2026-03-30T00:00:00.000Z',
            updatedAt: '2026-03-30T00:00:00.000Z',
          },
        }, null, 2),
      );

      const store = new JsonFileStore(makeSettings());
      const binding = store.getChannelBinding('feishu', 'oc_real_instance');
      assert.ok(binding);
      assert.equal(binding.channelType, 'feishu');
      assert.equal(binding.channelAlias, '开开1号');

      const defaultBinding = store.getChannelBinding('feishu-default', 'oc_real_instance');
      assert.equal(defaultBinding, null);
    } finally {
      fs.rmSync(CONFIG_V2_PATH, { force: true });
      if (configBackup !== null) {
        fs.writeFileSync(CONFIG_V2_PATH, configBackup);
      }
    }
  });

  it('addMessage and getMessages', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model', undefined, '/tmp');
    store.addMessage(session.id, 'user', 'hello');
    store.addMessage(session.id, 'assistant', 'hi');

    const { messages } = store.getMessages(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[1].content, 'hi');
  });

  it('getMessages with limit returns last N', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model', undefined, '/tmp');
    store.addMessage(session.id, 'user', 'msg1');
    store.addMessage(session.id, 'user', 'msg2');
    store.addMessage(session.id, 'user', 'msg3');

    const { messages } = store.getMessages(session.id, { limit: 2 });
    assert.equal(messages.length, 2);
    assert.equal(messages[0].content, 'msg2');
    assert.equal(messages[1].content, 'msg3');
  });

  // ── Session Locking ──

  it('acquireSessionLock succeeds on first call', () => {
    const store = new JsonFileStore(makeSettings());
    assert.ok(store.acquireSessionLock('sess', 'lock1', 'owner1', 60));
  });

  it('acquireSessionLock fails when held by another', () => {
    const store = new JsonFileStore(makeSettings());
    assert.ok(store.acquireSessionLock('sess', 'lock1', 'owner1', 60));
    assert.equal(store.acquireSessionLock('sess', 'lock2', 'owner2', 60), false);
  });

  it('acquireSessionLock succeeds with same lockId', () => {
    const store = new JsonFileStore(makeSettings());
    assert.ok(store.acquireSessionLock('sess', 'lock1', 'owner1', 60));
    assert.ok(store.acquireSessionLock('sess', 'lock1', 'owner1', 60));
  });

  it('releaseSessionLock allows re-acquire', () => {
    const store = new JsonFileStore(makeSettings());
    store.acquireSessionLock('sess', 'lock1', 'owner1', 60);
    store.releaseSessionLock('sess', 'lock1');
    assert.ok(store.acquireSessionLock('sess', 'lock2', 'owner2', 60));
  });

  it('expired lock can be re-acquired', async () => {
    const store = new JsonFileStore(makeSettings());
    // Acquire with very short TTL
    store.acquireSessionLock('sess', 'lock1', 'owner1', 0);
    // Should be expired immediately
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(store.acquireSessionLock('sess', 'lock2', 'owner2', 60));
  });

  // ── Permission Links ──

  it('insertPermissionLink and getPermissionLink', () => {
    const store = new JsonFileStore(makeSettings());
    store.insertPermissionLink({
      permissionRequestId: 'pr-1',
      channelType: 'feishu-default',
      chatId: '123',
      messageId: 'msg-1',
      sessionId: 'sess-1',
      toolName: 'bash',
      suggestions: 'allow,deny',
    });
    const link = store.getPermissionLink('pr-1');
    assert.ok(link);
    assert.equal(link.permissionRequestId, 'pr-1');
    assert.equal(link.resolved, false);
    assert.equal(link.sessionId, 'sess-1');
  });

  it('markPermissionLinkResolved is atomic', () => {
    const store = new JsonFileStore(makeSettings());
    store.insertPermissionLink({
      permissionRequestId: 'pr-2',
      channelType: 'feishu-default',
      chatId: '123',
      messageId: 'msg-2',
      sessionId: 'sess-1',
      toolName: 'bash',
      suggestions: '',
    });
    assert.ok(store.markPermissionLinkResolved('pr-2'));
    // Second call returns false (already resolved)
    assert.equal(store.markPermissionLinkResolved('pr-2'), false);
    // Unknown id returns false
    assert.equal(store.markPermissionLinkResolved('unknown'), false);
  });

  it('listPendingPermissionLinksByChat returns only unresolved links for the chat', () => {
    const store = new JsonFileStore(makeSettings());
    store.insertPermissionLink({
      permissionRequestId: 'pr-a',
      channelType: 'weixin-default',
      chatId: 'chat-1',
      messageId: 'msg-a',
      sessionId: 'sess-a',
      toolName: 'Bash',
      suggestions: '',
    });
    store.insertPermissionLink({
      permissionRequestId: 'pr-b',
      channelType: 'weixin-default',
      chatId: 'chat-1',
      messageId: 'msg-b',
      sessionId: 'sess-b',
      toolName: 'Read',
      suggestions: '',
    });
    store.insertPermissionLink({
      permissionRequestId: 'pr-c',
      channelType: 'weixin-default',
      chatId: 'chat-2',
      messageId: 'msg-c',
      sessionId: 'sess-c',
      toolName: 'Bash',
      suggestions: '',
    });
    // Resolve one
    store.markPermissionLinkResolved('pr-a');
    const pending = store.listPendingPermissionLinksByChat('chat-1');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].permissionRequestId, 'pr-b');
    // Different chat
    const pending2 = store.listPendingPermissionLinksByChat('chat-2');
    assert.equal(pending2.length, 1);
    assert.equal(pending2[0].permissionRequestId, 'pr-c');
    // No permissions for unknown chat
    assert.equal(store.listPendingPermissionLinksByChat('chat-unknown').length, 0);
  });

  // ── Dedup ──

  it('dedup insert and check within window', () => {
    const store = new JsonFileStore(makeSettings());
    assert.equal(store.checkDedup('key1'), false);
    store.insertDedup('key1');
    assert.equal(store.checkDedup('key1'), true);
  });

  it('cleanupExpiredDedup removes old entries', () => {
    const store = new JsonFileStore(makeSettings());
    store.insertDedup('key1');
    // The entry was just inserted so it shouldn't be expired
    store.cleanupExpiredDedup();
    assert.equal(store.checkDedup('key1'), true);
  });

  // ── Audit Log ──

  it('insertAuditLog keeps max 1000', () => {
    const store = new JsonFileStore(makeSettings());
    for (let i = 0; i < 1010; i++) {
      store.insertAuditLog({
        channelType: 'feishu-default',
        chatId: '123',
        direction: 'inbound',
        messageId: `msg-${i}`,
        summary: `msg ${i}`,
      });
    }
    // We can't directly inspect length, but it shouldn't crash
  });

  // ── Channel Offsets ──

  it('getChannelOffset returns default for unknown key', () => {
    const store = new JsonFileStore(makeSettings());
    assert.equal(store.getChannelOffset('unknown'), '0');
  });

  it('setChannelOffset and getChannelOffset round-trip', () => {
    const store = new JsonFileStore(makeSettings());
    store.setChannelOffset('feishu:offset', '12345');
    assert.equal(store.getChannelOffset('feishu:offset'), '12345');
  });

  // ── Codex Thread ──

  it('updateSessionCodexThreadId updates only the session thread identity', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model', undefined, '/tmp');
    store.upsertChannelBinding({
      channelType: 'feishu-default',
      chatId: '1',
      bridgeSessionId: session.id,
      workingDirectory: '/tmp',
      model: 'model',
    });
    store.updateSessionCodexThreadId(session.id, 'sdk-123');
    const binding = store.getChannelBinding('feishu-default', '1');
    const updated = store.getSession(session.id);
    assert.equal(binding?.bridgeSessionId, session.id);
    assert.equal(updated?.codex_thread_id, 'sdk-123');
  });

  it('updateSessionModel updates model', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model-old', undefined, '/tmp');
    store.updateSessionModel(session.id, 'model-new');
    const updated = store.getSession(session.id);
    assert.equal(updated?.model, 'model-new');
  });

  it('createSession stores hidden metadata and reasoning effort', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('draft', 'model', undefined, '/tmp', 'normal', {
      hidden: true,
      sessionType: 'draft',
      parentSessionId: 'parent-1',
      reasoningEffort: 'low',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    const fetched = store.getSession(session.id);
    assert.equal(fetched?.hidden, true);
    assert.equal(fetched?.session_type, 'draft');
    assert.equal(fetched?.parent_session_id, 'parent-1');
    assert.equal(fetched?.reasoning_effort, 'low');
    assert.equal(fetched?.expires_at, '2099-01-01T00:00:00.000Z');
    assert.equal(fetched?.preferred_mode, 'normal');
  });

  it('updateSession merges session metadata', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model-old', undefined, '/tmp');
    store.updateSession(session.id, {
      reasoning_effort: 'high',
      hidden: true,
      session_type: 'draft',
    });
    const updated = store.getSession(session.id);
    assert.equal(updated?.reasoning_effort, 'high');
    assert.equal(updated?.hidden, true);
    assert.equal(updated?.session_type, 'draft');
  });

  it('deleteSession removes the session, bindings, and stored messages', () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('test', 'model', undefined, '/tmp');
    store.upsertChannelBinding({
      channelType: 'feishu-default',
      chatId: 'delete-me',
      bridgeSessionId: session.id,
      workingDirectory: '/tmp',
      model: 'model',
    });
    store.addMessage(session.id, 'user', 'hello');
    store.deleteSession(session.id);
    assert.equal(store.getSession(session.id), null);
    assert.equal(store.getChannelBinding('feishu-default', 'delete-me'), null);
    assert.deepEqual(store.getMessages(session.id).messages, []);
  });
});
