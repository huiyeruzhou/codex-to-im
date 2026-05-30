import './test-setup.js';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CTI_HOME, type Config } from '../config.js';
import { JsonFileStore } from '../store.js';
import { buildUiBindingsPayload } from '../ui/application/chat-display.js';

const DATA_DIR = path.join(CTI_HOME, 'data');

function makeSettings(): Map<string, string> {
  return new Map([
    ['remote_bridge_enabled', 'true'],
    ['bridge_default_model', 'test-model'],
    ['bridge_default_mode', 'code'],
  ]);
}

function makeConfig(channelId: string): Config {
  return {
    runtime: 'codex',
    defaultMode: 'normal',
    enabledChannels: ['feishu'],
    channels: [{
      id: channelId,
      alias: 'Ops',
      provider: 'feishu',
      enabled: true,
      createdAt: '2026-05-30T00:00:00.000Z',
      updatedAt: '2026-05-30T00:00:00.000Z',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        site: 'feishu',
      },
    }],
  };
}

describe('UI binding application query', () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it('enriches Feishu binding display names and persists the resolved chat metadata', async () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('ops', 'test-model', undefined, '/tmp/ops');
    const channelId = 'feishu-ui-binding-display';
    const binding = store.upsertChannelBinding({
      channelType: channelId,
      channelProvider: 'feishu',
      channelAlias: 'Ops',
      chatId: 'oc_ui_binding_display',
      bridgeSessionId: session.id,
      workingDirectory: '/tmp/ops',
      model: 'test-model',
      mode: 'normal',
    });

    const seenUrls: string[] = [];
    const payload = await buildUiBindingsPayload(store, makeConfig(channelId), {
      fetchImpl: async (input) => {
        const url = String(input);
        seenUrls.push(url);
        if (url.includes('/tenant_access_token/internal')) {
          return Response.json({ code: 0, tenant_access_token: 'tenant-token', expire: 7200 });
        }
        if (url.includes('/im/v1/chats/')) {
          return Response.json({
            code: 0,
            data: {
              name: 'Ops Chat',
              owner_id: 'ou_owner',
            },
          });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    assert.equal(seenUrls.length, 2);
    assert.equal(payload.bindings[0]?.chatDisplayName, 'Ops Chat');
    assert.equal(payload.bindings[0]?.chatUserId, 'ou_owner');
    const persisted = store.listChannelBindings(channelId).find((item) => item.id === binding.id);
    assert.equal(persisted?.chatDisplayName, 'Ops Chat');
    assert.equal(persisted?.chatUserId, 'ou_owner');
  });

  it('keeps existing binding metadata when Feishu lookup fails', async () => {
    const store = new JsonFileStore(makeSettings());
    const session = store.createSession('ops', 'test-model', undefined, '/tmp/ops');
    const channelId = 'feishu-ui-binding-display-fallback';
    store.upsertChannelBinding({
      channelType: channelId,
      channelProvider: 'feishu',
      channelAlias: 'Ops',
      chatId: 'oc_ui_binding_display_fallback',
      chatUserId: 'ou_existing',
      chatDisplayName: 'Existing Chat',
      bridgeSessionId: session.id,
      workingDirectory: '/tmp/ops',
      model: 'test-model',
      mode: 'normal',
    });

    const payload = await buildUiBindingsPayload(store, makeConfig(channelId), {
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes('/tenant_access_token/internal')) {
          return Response.json({ code: 999, msg: 'denied' }, { status: 200 });
        }
        throw new Error(`Unexpected URL ${url}`);
      },
    });

    assert.equal(payload.bindings[0]?.chatDisplayName, 'Existing Chat');
    assert.equal(payload.bindings[0]?.chatUserId, 'ou_existing');
  });
});
