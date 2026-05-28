import './test-setup.js';
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CONFIG_PATH,
  CONFIG_V2_PATH,
  loadConfig,
  maskSecret,
  saveConfig,
  configToSettings,
  type Config,
} from '../config.js';

describe('maskSecret', () => {
  it('masks short values and preserves the last four characters for longer values', () => {
    assert.equal(maskSecret(''), '****');
    assert.equal(maskSecret('abc'), '****');
    assert.equal(maskSecret('abcd'), '****');
    assert.equal(maskSecret('12345'), '*2345');
    assert.equal(maskSecret('12345678'), '****5678');
    assert.equal(maskSecret('secret-token-abcd'), '*************abcd');
  });
});

// ── configToSettings ──

describe('configToSettings', () => {
  const base: Config = {
    runtime: 'codex',
    channels: [],
    enabledChannels: [],
    defaultMode: 'normal',
  };

  it('maps feishu config', () => {
    const m = configToSettings({
      ...base,
      channels: [
        {
          id: 'feishu-default',
          alias: '飞书',
          provider: 'feishu',
          enabled: true,
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:00.000Z',
          config: {
            appId: 'app-id',
            appSecret: 'app-secret',
            site: 'lark',
            allowedUsers: ['fu1'],
            streamingEnabled: false,
            feedbackMarkdownEnabled: true,
          },
        },
      ],
    });
    assert.equal(m.get('bridge_feishu_app_id'), 'app-id');
    assert.equal(m.get('bridge_feishu_app_secret'), 'app-secret');
    assert.equal(m.get('bridge_feishu_site'), 'lark');
    assert.equal(m.get('bridge_feishu_allowed_users'), 'fu1');
    assert.equal(m.get('bridge_feishu_streaming_enabled'), 'false');
    assert.equal(m.get('bridge_feishu_command_markdown_enabled'), 'true');
  });

  it('maps weixin settings', () => {
    const m = configToSettings({
      ...base,
      channels: [
        {
          id: 'weixin-default',
          alias: '微信',
          provider: 'weixin',
          enabled: true,
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:00.000Z',
          config: {
            baseUrl: 'https://example.weixin.test',
            cdnBaseUrl: 'https://cdn.weixin.test',
            mediaEnabled: true,
            feedbackMarkdownEnabled: false,
          },
        },
      ],
    });
    assert.equal(m.get('bridge_weixin_enabled'), 'true');
    assert.equal(m.get('bridge_weixin_base_url'), 'https://example.weixin.test');
    assert.equal(m.get('bridge_weixin_cdn_base_url'), 'https://cdn.weixin.test');
    assert.equal(m.get('bridge_weixin_media_enabled'), 'true');
    assert.equal(m.get('bridge_weixin_command_markdown_enabled'), 'false');
  });

  it('maps runtime defaults and scalar overrides', () => {
    const m = configToSettings(base);
    assert.equal(m.get('remote_bridge_enabled'), 'true');
    assert.equal(m.has('bridge_default_model'), false);
    assert.equal(m.has('default_model'), false);
    assert.equal(m.get('bridge_default_mode'), 'normal');
    assert.equal(m.get('bridge_history_message_limit'), '8');
    assert.equal(m.get('bridge_stream_status_idle_start_seconds'), '180');
    assert.equal(m.get('bridge_stream_status_check_interval_seconds'), '10');
    assert.equal(m.get('bridge_sdk_tool_call_details_in_text'), 'true');

    const configured = configToSettings({
      ...base,
      defaultModel: 'gpt-4o',
      defaultWorkspaceRoot: '/tmp/workspace',
      historyMessageLimit: 12,
      streamStatusIdleStartSeconds: 240,
      streamStatusCheckIntervalSeconds: 15,
      codexSkipGitRepoCheck: true,
      codexSandboxMode: 'danger-full-access',
      codexNetworkAccess: true,
      codexReasoningEffort: 'xhigh',
      sdkToolCallDetailsInText: false,
      defaultMode: 'yolo',
    });
    assert.equal(configured.get('bridge_default_model'), 'gpt-4o');
    assert.equal(configured.get('default_model'), 'gpt-4o');
    assert.equal(configured.get('bridge_default_workspace_root'), '/tmp/workspace');
    assert.equal(configured.get('bridge_history_message_limit'), '12');
    assert.equal(configured.get('bridge_stream_status_idle_start_seconds'), '240');
    assert.equal(configured.get('bridge_stream_status_check_interval_seconds'), '15');
    assert.equal(configured.get('bridge_codex_skip_git_repo_check'), 'true');
    assert.equal(configured.get('bridge_codex_sandbox_mode'), 'danger-full-access');
    assert.equal(configured.get('bridge_codex_network_access'), 'true');
    assert.equal(configured.get('bridge_codex_reasoning_effort'), 'xhigh');
    assert.equal(configured.get('bridge_sdk_tool_call_details_in_text'), 'false');
    assert.equal(configured.get('bridge_default_mode'), 'yolo');
  });

  it('omits optional fields when not set', () => {
    const m = configToSettings(base);
    assert.equal(m.has('bridge_feishu_app_id'), false);
  });

  it('omits unsupported channel providers from runtime settings', () => {
    const m = configToSettings({
      ...base,
      channels: [
        {
          id: 'feishu-default',
          alias: '飞书',
          provider: 'feishu',
          enabled: true,
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:00.000Z',
          config: {},
        },
        {
          id: 'telegram-old',
          alias: 'Telegram',
          provider: 'telegram',
          enabled: true,
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:00.000Z',
          config: {},
        } as never,
      ],
    });

    const channels = JSON.parse(m.get('bridge_channel_instances_json') || '[]') as Array<{ provider: string }>;
    assert.deepEqual(channels.map((channel) => channel.provider), ['feishu']);
  });
});

// ── Config file parsing (loadConfig/saveConfig round-trip) ──

describe('loadConfig/saveConfig round-trip', () => {
  let tmpDir: string;
  let origHome: string;
  let configBackup: string | null;
  let configV2Backup: string | null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-config-test-'));
    origHome = process.env.HOME || '';
    configBackup = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, 'utf-8') : null;
    configV2Backup = fs.existsSync(CONFIG_V2_PATH) ? fs.readFileSync(CONFIG_V2_PATH, 'utf-8') : null;
    fs.rmSync(CONFIG_PATH, { force: true });
    fs.rmSync(CONFIG_V2_PATH, { force: true });
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(CONFIG_PATH, { force: true });
    fs.rmSync(CONFIG_V2_PATH, { force: true });
    if (configBackup !== null) {
      fs.writeFileSync(CONFIG_PATH, configBackup);
    }
    if (configV2Backup !== null) {
      fs.writeFileSync(CONFIG_V2_PATH, configV2Backup);
    }
  });

  it('configToSettings returns correct defaults', () => {
    const m = configToSettings({
      runtime: 'codex',
      channels: [],
      enabledChannels: [],
      defaultMode: 'normal',
    });
    assert.equal(m.get('bridge_feishu_enabled'), 'false');
    assert.equal(m.get('bridge_weixin_enabled'), 'false');
  });

  it('migrates legacy env config into config.v2.json default channel instances', () => {
    fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
    fs.writeFileSync(
      CONFIG_PATH,
      [
        'CTI_RUNTIME=codex',
        'CTI_ENABLED_CHANNELS=feishu,weixin',
        'CTI_FEISHU_APP_ID=app-id',
        'CTI_FEISHU_APP_SECRET=app-secret',
        'CTI_FEISHU_DOMAIN=lark',
        'CTI_FEISHU_ALLOWED_USERS=u1,u2',
        'CTI_WEIXIN_BASE_URL=https://wx.example.test',
        'CTI_WEIXIN_CDN_BASE_URL=https://cdn.example.test',
        'CTI_WEIXIN_MEDIA_ENABLED=true',
      ].join('\n'),
    );

    const loaded = loadConfig();
    assert.equal(loaded.schemaVersion, 2);
    assert.ok(fs.existsSync(CONFIG_V2_PATH));
    assert.deepEqual(
      loaded.channels?.map((channel) => ({
        id: channel.id,
        alias: channel.alias,
        provider: channel.provider,
        enabled: channel.enabled,
        config: channel.provider === 'feishu' ? (channel.config as any).site : undefined,
      })),
      [
        {
          id: 'feishu-default',
          alias: '飞书',
          provider: 'feishu',
          enabled: true,
          config: 'lark',
        },
        {
          id: 'weixin-default',
          alias: '微信',
          provider: 'weixin',
          enabled: true,
          config: undefined,
        },
      ],
    );
  });

  it('applies a newer config.env overlay and imports unmatched channel config as a new channel', () => {
    fs.mkdirSync(path.dirname(CONFIG_V2_PATH), { recursive: true });
    fs.writeFileSync(
      CONFIG_V2_PATH,
      JSON.stringify({
        schemaVersion: 2,
        runtime: {
          provider: 'codex',
          defaultModel: 'old-model',
          defaultMode: 'normal',
          historyMessageLimit: 8,
          codexSandboxMode: 'workspace-write',
          sdkToolCallDetailsInText: true,
        },
        channels: [
          {
            id: 'feishu-rd',
            alias: '研发飞书',
            provider: 'feishu',
            enabled: true,
            createdAt: '2026-03-28T00:00:00.000Z',
            updatedAt: '2026-03-28T00:00:00.000Z',
            config: {
              appId: 'old-app',
              appSecret: 'old-secret',
            },
          },
          {
            id: 'feishu-cs',
            alias: '客服飞书',
            provider: 'feishu',
            enabled: false,
            createdAt: '2026-03-28T00:00:00.000Z',
            updatedAt: '2026-03-28T00:00:00.000Z',
            config: {
              appId: 'cs-app',
            },
          },
        ],
      }, null, 2),
    );
    fs.writeFileSync(
      CONFIG_PATH,
      [
        'CTI_DEFAULT_MODEL=new-model',
        'CTI_HISTORY_MESSAGE_LIMIT=15',
        'CTI_CODEX_SANDBOX_MODE=danger-full-access',
        'CTI_SDK_TOOL_CALL_DETAILS_IN_TEXT=false',
        'CTI_FEISHU_APP_ID=env-app',
      ].join('\n'),
    );
    const past = new Date(Date.now() - 10_000);
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(CONFIG_V2_PATH, past, past);
    fs.utimesSync(CONFIG_PATH, future, future);

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    let loaded: Config;
    try {
      loaded = loadConfig();
    } finally {
      console.warn = originalWarn;
    }
    assert.equal(loaded.defaultModel, 'new-model');
    assert.equal(loaded.historyMessageLimit, 15);
    assert.equal(loaded.codexSandboxMode, 'danger-full-access');
    assert.equal(loaded.sdkToolCallDetailsInText, true);
    assert.deepEqual(
      loaded.channels?.map((channel) => ({
        id: channel.id,
        enabled: channel.enabled,
        appId: (channel.config as { appId?: string }).appId,
      })),
      [
        { id: 'feishu-rd', enabled: true, appId: 'old-app' },
        { id: 'feishu-cs', enabled: false, appId: 'cs-app' },
        { id: 'feishu-env', enabled: false, appId: 'env-app' },
      ],
    );
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /没有匹配到现有通道/);
    assert.match(warnings[0], /feishu-env/);
    assert.match(warnings[1], /config\.env 已更新/);
    assert.match(warnings[1], /config\.v2\.json/);

    const persisted = JSON.parse(fs.readFileSync(CONFIG_V2_PATH, 'utf-8')) as any;
    assert.equal(persisted.runtime.defaultModel, 'new-model');
    assert.equal(persisted.runtime.sdkToolCallDetailsInText, true);
    assert.equal(persisted.channels[0].config.appId, 'old-app');
    assert.equal(persisted.channels[2].config.appId, 'env-app');
  });

  it('updates an existing channel when config.env matches its channel identity', () => {
    fs.mkdirSync(path.dirname(CONFIG_V2_PATH), { recursive: true });
    fs.writeFileSync(
      CONFIG_V2_PATH,
      JSON.stringify({
        schemaVersion: 2,
        runtime: {
          provider: 'codex',
          defaultMode: 'normal',
        },
        channels: [
          {
            id: 'feishu-rd',
            alias: '研发飞书',
            provider: 'feishu',
            enabled: true,
            createdAt: '2026-03-28T00:00:00.000Z',
            updatedAt: '2026-03-28T00:00:00.000Z',
            config: {
              appId: 'same-app',
              appSecret: 'old-secret',
            },
          },
        ],
      }, null, 2),
    );
    fs.writeFileSync(
      CONFIG_PATH,
      [
        'CTI_FEISHU_APP_ID=same-app',
        'CTI_FEISHU_APP_SECRET=new-secret',
      ].join('\n'),
    );
    const past = new Date(Date.now() - 10_000);
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(CONFIG_V2_PATH, past, past);
    fs.utimesSync(CONFIG_PATH, future, future);

    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => {
      warnings.push(String(message));
    };
    let loaded: Config;
    try {
      loaded = loadConfig();
    } finally {
      console.warn = originalWarn;
    }
    assert.deepEqual(
      loaded.channels?.map((channel) => ({
        id: channel.id,
        appId: (channel.config as { appId?: string }).appId,
        appSecret: (channel.config as { appSecret?: string }).appSecret,
      })),
      [
        { id: 'feishu-rd', appId: 'same-app', appSecret: 'new-secret' },
      ],
    );
    assert.deepEqual(warnings, ['[codex-to-im] 检测到 config.env 已更新，已同步写入 config.v2.json。']);
  });

  it('ignores a newer config.env when it still matches the generated snapshot', () => {
    const config: Config = {
      runtime: 'codex',
      defaultMode: 'normal',
      historyMessageLimit: 8,
      enabledChannels: ['feishu'],
      channels: [
        {
          id: 'feishu-rd',
          alias: '研发飞书',
          provider: 'feishu',
          enabled: true,
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:00.000Z',
          config: {
            appId: 'rd-app',
          },
        },
        {
          id: 'feishu-cs',
          alias: '客服飞书',
          provider: 'feishu',
          enabled: false,
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:00.000Z',
          config: {
            appId: 'cs-app',
          },
        },
      ],
    };
    saveConfig(config);
    const future = new Date(Date.now() + 10_000);
    fs.utimesSync(CONFIG_PATH, future, future);

    const loaded = loadConfig();
    assert.deepEqual(
      loaded.channels?.map((channel) => ({
        id: channel.id,
        enabled: channel.enabled,
        appId: (channel.config as { appId?: string }).appId,
      })),
      [
        { id: 'feishu-rd', enabled: true, appId: 'rd-app' },
        { id: 'feishu-cs', enabled: false, appId: 'cs-app' },
      ],
    );
  });

  it('filters unsupported providers from config.v2.json on load', () => {
    fs.mkdirSync(path.dirname(CONFIG_V2_PATH), { recursive: true });
    fs.writeFileSync(
      CONFIG_V2_PATH,
      JSON.stringify({
        schemaVersion: 2,
        runtime: {
          provider: 'codex',
          defaultMode: 'normal',
        },
        channels: [
          {
            id: 'feishu-default',
            alias: '飞书',
            provider: 'feishu',
            enabled: true,
            createdAt: '2026-03-28T00:00:00.000Z',
            updatedAt: '2026-03-28T00:00:00.000Z',
            config: {},
          },
          {
            id: 'telegram-old',
            alias: 'Telegram',
            provider: 'telegram',
            enabled: true,
            createdAt: '2026-03-28T00:00:00.000Z',
            updatedAt: '2026-03-28T00:00:00.000Z',
            config: {},
          },
        ],
      }, null, 2),
    );

    const loaded = loadConfig();
    assert.deepEqual(loaded.channels?.map((channel) => channel.provider), ['feishu']);
    assert.deepEqual(loaded.enabledChannels, ['feishu']);
  });

  it('preserves custom v2 channel instances when saving runtime settings', () => {
    fs.mkdirSync(path.dirname(CONFIG_V2_PATH), { recursive: true });
    fs.writeFileSync(
      CONFIG_V2_PATH,
      JSON.stringify({
        schemaVersion: 2,
        runtime: {
          provider: 'codex',
          defaultMode: 'normal',
          historyMessageLimit: 8,
          streamStatusIdleStartSeconds: 180,
          streamStatusCheckIntervalSeconds: 10,
        },
        channels: [
          {
            id: 'feishu-rd',
            alias: '研发飞书',
            provider: 'feishu',
            enabled: true,
            createdAt: '2026-03-28T00:00:00.000Z',
            updatedAt: '2026-03-28T00:00:00.000Z',
            config: {
              appId: 'rd-app',
              appSecret: 'rd-secret',
              feedbackMarkdownEnabled: true,
            },
          },
          {
            id: 'feishu-cs',
            alias: '客服飞书',
            provider: 'feishu',
            enabled: true,
            createdAt: '2026-03-28T00:00:00.000Z',
            updatedAt: '2026-03-28T00:00:00.000Z',
            config: {
              appId: 'cs-app',
              appSecret: 'cs-secret',
              feedbackMarkdownEnabled: false,
            },
          },
        ],
      }, null, 2),
    );

    const loaded = loadConfig();
    saveConfig({
      ...loaded,
      defaultMode: 'yolo',
      historyMessageLimit: 12,
      streamStatusIdleStartSeconds: 240,
      streamStatusCheckIntervalSeconds: 15,
      sdkToolCallDetailsInText: false,
    });

    const reloaded = loadConfig();
    assert.deepEqual(
      reloaded.channels?.map((channel) => ({
        id: channel.id,
        alias: channel.alias,
        provider: channel.provider,
        appId: (channel.config as { appId?: string }).appId,
      })),
      [
        {
          id: 'feishu-rd',
          alias: '研发飞书',
          provider: 'feishu',
          appId: 'rd-app',
        },
        {
          id: 'feishu-cs',
          alias: '客服飞书',
          provider: 'feishu',
          appId: 'cs-app',
        },
      ],
    );
    assert.equal(reloaded.defaultMode, 'yolo');
    assert.equal(reloaded.historyMessageLimit, 12);
    assert.equal(reloaded.streamStatusIdleStartSeconds, 240);
    assert.equal(reloaded.streamStatusCheckIntervalSeconds, 15);
    assert.equal(reloaded.sdkToolCallDetailsInText, false);
    assert.doesNotMatch(fs.readFileSync(CONFIG_PATH, 'utf-8'), /CTI_SDK_TOOL_CALL_DETAILS_IN_TEXT/);
  });
});
