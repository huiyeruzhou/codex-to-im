import './test-setup.js';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CONFIG_V2_PATH, CTI_HOME } from '../config.js';
import { JsonFileStore } from '../store.js';
import { initBridgeContext } from '../lib/bridge/context.js';
import { resolve } from '../lib/bridge/channel-router.js';

const DATA_DIR = path.join(CTI_HOME, 'data');

function makeSettings(): Map<string, string> {
  return new Map([
    ['remote_bridge_enabled', 'true'],
    ['bridge_default_model', 'test-model'],
    ['bridge_default_mode', 'code'],
  ]);
}

const noopLlm = {
  streamChat(): ReadableStream<string> {
    return new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
  },
};

describe('channel-router default targets', () => {
  let configBackup: string | null = null;

  beforeEach(() => {
    configBackup = fs.existsSync(CONFIG_V2_PATH) ? fs.readFileSync(CONFIG_V2_PATH, 'utf-8') : null;
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(CONFIG_V2_PATH, { force: true });
    fs.mkdirSync(path.dirname(CONFIG_V2_PATH), { recursive: true });
    fs.writeFileSync(CONFIG_V2_PATH, JSON.stringify({
      schemaVersion: 2,
      runtime: {
        provider: 'codex',
        defaultMode: 'code',
      },
      channels: [
        {
          id: 'feishu-default',
          alias: '飞书',
          provider: 'feishu',
          enabled: true,
          createdAt: '2026-03-01T00:00:00.000Z',
          updatedAt: '2026-03-01T00:00:00.000Z',
          config: {},
        },
      ],
    }, null, 2));
  });

  afterEach(() => {
    fs.rmSync(CONFIG_V2_PATH, { force: true });
    if (configBackup !== null) {
      fs.writeFileSync(CONFIG_V2_PATH, configBackup);
    }
  });

  it('routes the next new chat to the configured default session target', () => {
    const store = new JsonFileStore(makeSettings());
    initBridgeContext({
      store,
      llm: noopLlm,
      permissions: { resolvePendingPermission: () => false },
      lifecycle: {},
    });

    const session = store.createSession('prebound', 'test-model', undefined, '/tmp/prebound');
    store.upsertChannelDefaultTarget({
      channelType: 'feishu-default',
      channelProvider: 'feishu',
      channelAlias: '飞书',
      targetKey: `session:${session.id}`,
    });

    const binding = resolve({
      channelType: 'feishu-default',
      chatId: 'oc_prebound',
      userId: 'ou_123',
      displayName: '张乐',
    });

    assert.equal(binding.codepilotSessionId, session.id);
    assert.equal(binding.chatDisplayName, '张乐');
    assert.equal(store.getChannelDefaultTarget('feishu-default'), null);
  });
});
