import './test-setup.js';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CONFIG_PATH, CONFIG_V2_PATH, CTI_HOME, loadConfig } from '../config.js';
import { JsonFileStore } from '../store.js';
import { initBridgeContext } from '../lib/bridge/context.js';
import { handleBridgeCommand } from '../lib/bridge/command-dispatch.js';
import * as router from '../lib/bridge/channel-router.js';

const DATA_DIR = path.join(CTI_HOME, 'data');

function makeSettings(): Map<string, string> {
  return new Map([
    ['remote_bridge_enabled', 'true'],
    ['bridge_default_model', 'test-model'],
    ['bridge_default_mode', 'code'],
    ['bridge_channel_instances_json', JSON.stringify([
      { id: 'feishu', provider: 'feishu', enabled: true, alias: '飞书', config: {} },
      { id: 'feishu-default', provider: 'feishu', enabled: true, alias: '飞书', config: {} },
    ])],
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

function initTestContext(): JsonFileStore {
  const store = new JsonFileStore(makeSettings());
  initBridgeContext({
    store,
    llm: noopLlm,
    permissions: { resolvePendingPermission: () => false },
    lifecycle: {},
  });
  return store;
}

function readAuditSummaries(): string[] {
  const auditPath = path.join(DATA_DIR, 'audit.json');
  if (!fs.existsSync(auditPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(auditPath, 'utf-8')) as Array<{ summary?: string }>;
  return parsed.map((entry) => entry.summary || '');
}

describe('command-dispatch', () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(CONFIG_PATH, { force: true });
    fs.rmSync(CONFIG_V2_PATH, { force: true });
  });

  it('switches /thread 0 into the hidden draft session and keeps normal mode', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-1' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-draft' } as const;

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/thread 0',
        messageId: 'incoming-1',
      } as any,
      '/thread 0',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );
    const binding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(binding);
    assert.equal(binding?.mode, 'normal');
    const session = binding ? store.getSession(binding.codepilotSessionId) : null;
    assert.equal(session?.session_type, 'draft');
    assert.match(sent[0] || '', /已切换到临时草稿线程/);
  });

  it('renders /history from bridge-cached messages when no desktop thread is bound', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-2' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-history', displayName: 'History Chat' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\history');
    store.addMessage(binding.codepilotSessionId, 'user', '第一条用户消息');
    store.addMessage(binding.codepilotSessionId, 'assistant', '第一条助手回复');

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/history',
        messageId: 'incoming-2',
      } as any,
      '/history',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const response = sent[0] || '';
    assert.match(response, /最近对话（raw）/);
    assert.match(response, /Bridge 缓存/);
    assert.match(response, /第一条用户消息/);
    assert.match(response, /第一条助手回复/);
  });

  it('renders /history msg as a markdown card body', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-history-msg' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-history-msg' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\history-msg');
    store.addMessage(binding.codepilotSessionId, 'user', '卡片用户消息');
    store.addMessage(binding.codepilotSessionId, 'assistant', '卡片助手回复');

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/history msg',
        messageId: 'incoming-history-msg',
      } as any,
      '/history msg',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const response = sent[0] || '';
    assert.match(response, /最近对话（msg）/);
    assert.match(response, /```text/);
    assert.match(response, /卡片用户消息/);
    assert.match(response, /卡片助手回复/);
  });

  it('applies channel prebinding before running the first session-scoped slash command', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu-default',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-prebound-history' };
      },
    };
    const address = { channelType: 'feishu-default', chatId: 'chat-prebound-history', displayName: 'Prebound Chat' } as const;
    const session = store.createSession('prebound-session', 'test-model', undefined, '/tmp/prebound-history');
    store.addMessage(session.id, 'user', '预绑定历史消息');
    store.upsertChannelDefaultTarget({
      channelType: 'feishu-default',
      channelProvider: 'feishu',
      channelAlias: '飞书',
      targetKey: `session:${session.id}`,
    });

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/history',
        messageId: 'incoming-prebound-history',
      } as any,
      '/history',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const binding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(binding);
    assert.equal(binding?.codepilotSessionId, session.id);
    assert.equal(store.getChannelDefaultTarget(address.channelType), null);
    assert.match(sent[0] || '', /最近对话（raw）/);
    assert.match(sent[0] || '', /预绑定历史消息/);
  });

  it('sends /history json as the original session file attachment', async () => {
    const store = initTestContext();
    const sent: any[] = [];
    const adapter: any = {
      channelType: 'feishu-default',
      provider: 'feishu',
      send: async (message: any) => {
        sent.push(message);
        return { ok: true, messageId: `reply-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu-default', chatId: 'chat-history-json' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\history-json');
    const threadId = 'thread-history-json';
    const sessionDir = path.join(process.env.CODEX_HOME!, 'sessions', '2026', '05', '28');
    fs.mkdirSync(sessionDir, { recursive: true });
    const sessionPath = path.join(sessionDir, `rollout-${threadId}.jsonl`);
    const rawJsonl = [
      JSON.stringify({
        timestamp: '2026-05-28T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: threadId,
          timestamp: '2026-05-28T00:00:00.000Z',
          cwd: 'D:\\workspace\\history-json',
          originator: 'Codex CLI',
        },
      }),
      JSON.stringify({
        timestamp: '2026-05-28T00:00:01.000Z',
        type: 'event_msg',
        payload: { type: 'user_message', message: '原始 JSONL 内容' },
      }),
    ].join('\n') + '\n';
    fs.writeFileSync(sessionPath, rawJsonl, 'utf-8');
    store.updateSession(binding.codepilotSessionId, {
      desktop_thread_id: threadId,
      thread_origin: 'desktop',
      sdk_session_id: threadId,
    });

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/history json',
        messageId: 'incoming-history-json',
      } as any,
      '/history json',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const attachmentMessage = sent.find((m) => Array.isArray(m.attachments) && m.attachments.length === 1);
    assert.ok(attachmentMessage);
    assert.equal(attachmentMessage.attachments[0].path, sessionPath);
    assert.equal(attachmentMessage.attachments[0].name, path.basename(sessionPath));
    assert.equal(fs.readFileSync(attachmentMessage.attachments[0].path, 'utf-8'), rawJsonl);
    assert.equal(sent.some((m) => /已发送历史 JSON/.test(String(m.text || ''))), false);
  });

  it('updates /history message limit with a slash command', async () => {
    initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-history-limit' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-history-limit' } as const;

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/history limit 12',
        messageId: 'incoming-history-limit',
      } as any,
      '/history limit 12',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.match(sent[0] || '', /设置为 12/);
    assert.equal(loadConfig().historyMessageLimit, 12);
  });

  it('updates session sandbox and network overrides with slash commands', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-runtime-options' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\runtime-options');

    const deps = {
      getActiveTask: () => undefined,
      diagnoseSessionHealth: async () => null,
      diagnoseAllActiveSessions: async () => [],
    };

    await handleBridgeCommand(adapter, {
      address,
      text: '/sandbox danger-full-access',
      messageId: 'incoming-sandbox',
    } as any, '/sandbox danger-full-access', deps);
    await handleBridgeCommand(adapter, {
      address,
      text: '/net on',
      messageId: 'incoming-network',
    } as any, '/net on', deps);

    const session = store.getSession(binding.codepilotSessionId);
    assert.equal(session?.codex_sandbox_mode, 'danger-full-access');
    assert.equal(session?.codex_network_access, true);
    assert.match(sent[0] || '', /已更新 Codex 沙箱/);
    assert.match(sent[1] || '', /已更新 Codex 网络/);
  });

  it('maps /m code to normal and rejects removed legacy modes', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-mode-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-mode' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\mode');

    const deps = {
      getActiveTask: () => undefined,
      diagnoseSessionHealth: async () => null,
      diagnoseAllActiveSessions: async () => [],
    };

    await handleBridgeCommand(adapter, {
      address,
      text: '/m code',
      messageId: 'incoming-mode-code',
    } as any, '/m code', deps);
    await handleBridgeCommand(adapter, {
      address,
      text: '/m ask',
      messageId: 'incoming-mode-ask',
    } as any, '/m ask', deps);

    const updated = store.getChannelBinding(address.channelType, address.chatId);
    assert.equal(updated?.mode, 'normal');
    assert.equal(store.getSession(binding.codepilotSessionId)?.preferred_mode, 'normal');
    assert.match(sent[0] || '', /已切换模式/);
    assert.match(sent[0] || '', /normal/);
    assert.match(sent[1] || '', /模式用法/);
    assert.match(sent[1] || '', /normal\|yolo/);
  });

  it('updates the session Codex provider with /provider', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-provider-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-provider' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\provider');

    await handleBridgeCommand(adapter, {
      address,
      text: '/provider tmux',
      messageId: 'incoming-provider',
    } as any, '/provider tmux', {
      getActiveTask: () => undefined,
      diagnoseSessionHealth: async () => null,
      diagnoseAllActiveSessions: async () => [],
    });

    assert.equal(store.getSession(binding.codepilotSessionId)?.codex_provider, 'tmux');
    assert.match(sent[0] || '', /已切换 Codex Provider/);
    assert.match(sent[0] || '', /tmux/);
  });

  it('renders /status with current mode and provider', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-status-mode-provider-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-status-mode-provider' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\status-mode-provider');
    store.updateSession(binding.codepilotSessionId, {
      preferred_mode: 'yolo',
      codex_provider: 'tmux',
    });
    router.updateBinding(binding.id, { mode: 'yolo' });

    await handleBridgeCommand(adapter, {
      address,
      text: '/status',
      messageId: 'incoming-status-mode-provider',
    } as any, '/status', {
      getActiveTask: () => undefined,
      diagnoseSessionHealth: async () => null,
      diagnoseAllActiveSessions: async () => [],
    });

    const response = sent[0] || '';
    assert.match(response, /模式/);
    assert.match(response, /yolo/);
    assert.match(response, /Provider/);
    assert.match(response, /tmux/);
  });

  it('renders /check health diagnostics for the current session', async () => {
    initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-3' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-health' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\health');

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/check',
        messageId: 'incoming-3',
      } as any,
      '/check',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async (sessionId) => ({
          sessionId,
          checkedAt: null,
          runtimeStatus: 'running',
          healthStatus: 'slow_observed',
          healthReason: '近期没有新的执行进展，先标记为待观察。',
          lastProgressAt: '2026-04-13T12:00:00.000Z',
          lastProgressType: 'tool_running',
          activeToolName: 'shell_command',
          activeToolStartedAt: '2026-04-13T11:50:00.000Z',
          lastToolFinishedAt: null,
          lastStreamUiAttemptAt: null,
          lastStreamUiUpdateAt: null,
          streamUiFlushStartedAt: null,
          lastStreamUiErrorAt: null,
          lastStreamUiError: null,
          streamUiConsecutiveFailures: 0,
          sdkSessionId: null,
          processProbe: null,
        }),
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const response = sent[0] || '';
    assert.match(response, /当前会话健康检查/);
    assert.doesNotMatch(response, /检查时间/);
    assert.match(response, new RegExp(binding.codepilotSessionId));
    assert.match(response, /长时运行，待观察/);
    assert.match(response, /shell_command/);
  });

  it('renders /check diagnostics for an explicit session id', async () => {
    initTestContext();
    const sent: string[] = [];
    const requestedSessionIds: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-health-explicit' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-health-explicit' } as const;
    router.createBinding(address, 'D:\\workspace\\health-current');
    const explicitSessionId = 'fbfa3ff0-6226-4f79-99b5-7704754433fb';

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: `/check ${explicitSessionId}`,
        messageId: 'incoming-health-explicit',
      } as any,
      `/check ${explicitSessionId}`,
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async (sessionId) => {
          requestedSessionIds.push(sessionId);
          return {
            sessionId,
            checkedAt: null,
            runtimeStatus: 'idle',
            healthStatus: 'completed',
            healthReason: '任务已完成。',
            lastProgressAt: '2026-04-13T12:00:00.000Z',
            lastProgressType: 'task_completed',
            activeToolName: null,
            activeToolStartedAt: null,
            lastToolFinishedAt: null,
            lastStreamUiAttemptAt: null,
            lastStreamUiUpdateAt: null,
            streamUiFlushStartedAt: null,
            lastStreamUiErrorAt: null,
            lastStreamUiError: null,
            streamUiConsecutiveFailures: 0,
            sdkSessionId: null,
            processProbe: null,
          };
        },
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.deepEqual(requestedSessionIds, [explicitSessionId]);
    const response = sent[0] || '';
    assert.match(response, /指定会话健康检查/);
    assert.match(response, new RegExp(explicitSessionId));
    assert.doesNotMatch(response, /检查时间/);
  });

  it('renders /status without creating a session or binding for an unbound chat', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-status-1' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-status-draft' } as const;

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/status',
        messageId: 'incoming-status-1',
      } as any,
      '/status',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const response = sent[0] || '';
    assert.match(response, /当前会话/);
    assert.match(response, /还没有绑定会话/);
    assert.equal(store.getChannelBinding(address.channelType, address.chatId), null);
    assert.equal(store.listSessions().length, 0);
    assert.deepEqual(readAuditSummaries(), []);
  });

  it('renders /check without creating a session or binding for an unbound chat', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    let diagnoseCalls = 0;
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-health-unbound' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-health-unbound' } as const;

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/check',
        messageId: 'incoming-health-unbound',
      } as any,
      '/check',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => {
          diagnoseCalls += 1;
          return null;
        },
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const response = sent[0] || '';
    assert.match(response, /还没有绑定会话/);
    assert.equal(diagnoseCalls, 0);
    assert.equal(store.getChannelBinding(address.channelType, address.chatId), null);
    assert.equal(store.listSessions().length, 0);
    assert.deepEqual(readAuditSummaries(), []);
  });

  it('creates a new IM session with /new and points the binding at the requested directory', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-new-1' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-new-command' } as const;

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/new D:\\workspace\\common-flow',
        messageId: 'incoming-new-1',
      } as any,
      '/new D:\\workspace\\common-flow',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const binding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(binding);
    assert.equal(binding?.workingDirectory, path.resolve('D:\\workspace\\common-flow'));
    assert.match(sent[0] || '', /已新建会话/);
    assert.match(sent[0] || '', /common-flow/);
  });

  it('blocks thread switching while the current task is running unless forced', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-switch-running' } as const;
    const initialBinding = router.createBinding(address, 'D:\\workspace\\running-old');
    const activeTask = { abortController: new AbortController() };

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/thread 0',
        messageId: 'incoming-switch-running-1',
      } as any,
      '/thread 0',
      {
        getActiveTask: (sessionId) => sessionId === initialBinding.codepilotSessionId ? activeTask : undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.match(sent.at(-1) || '', /当前会话仍在运行/);
    assert.match(sent.at(-1) || '', /--force/);
    assert.equal(
      store.getChannelBinding(address.channelType, address.chatId)?.codepilotSessionId,
      initialBinding.codepilotSessionId,
    );

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/thread 0 --force',
        messageId: 'incoming-switch-running-2',
      } as any,
      '/thread 0 --force',
      {
        getActiveTask: (sessionId) => sessionId === initialBinding.codepilotSessionId ? activeTask : undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const forcedBinding = store.getChannelBinding(address.channelType, address.chatId);
    assert.notEqual(forcedBinding?.codepilotSessionId, initialBinding.codepilotSessionId);
    assert.equal(forcedBinding?.mode, 'normal');
    assert.match(sent.at(-1) || '', /已切换到临时草稿线程/);
    assert.ok(readAuditSummaries().some((summary) => (
      summary.includes('Binding change: action=switch_draft')
      && summary.includes('reason=forced')
    )));
  });

  it('force-stops a stale running session even when no active task remains in memory', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const forcedStops: Array<{ sessionId: string; detail?: string }> = [];
    const healthEnds: Array<{ sessionId: string; outcome: string; detail?: string }> = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-stop-stale' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-stop-stale' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\stop-stale');
    store.updateSession(binding.codepilotSessionId, {
      runtime_status: 'idle',
      health_status: 'suspected_stream_ui_stall',
      health_reason: '任务仍在继续，但流式 UI 刷新请求已长时间未完成，疑似卡住。',
    });

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/stop',
        messageId: 'incoming-stop-stale',
      } as any,
      '/stop',
      {
        getActiveTask: () => undefined,
        forceStopSession: async (sessionId, detail) => {
          forcedStops.push({ sessionId, detail });
          return false;
        },
        recordInteractiveHealthEnd: (sessionId, outcome, detail) => {
          healthEnds.push({ sessionId, outcome, detail });
        },
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.deepEqual(forcedStops, [{
      sessionId: binding.codepilotSessionId,
      detail: '用户执行 /stop，已停止当前任务。',
    }]);
    assert.deepEqual(healthEnds, [{
      sessionId: binding.codepilotSessionId,
      outcome: 'aborted',
      detail: '用户执行 /stop，已停止当前任务。',
    }]);
    assert.match(sent[0] || '', /旧会话「Bridge: chat-stop-stale」任务已停止/);
  });

  it('removes the current binding on /unbind', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-unbind-1' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-unbind' } as const;
    router.createBinding(address, 'D:\\workspace\\unbind');

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/unbind',
        messageId: 'incoming-unbind-1',
      } as any,
      '/unbind',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.equal(store.getChannelBinding(address.channelType, address.chatId), null);
    assert.match(sent[0] || '', /已解绑当前聊天/);
    assert.match(sent[0] || '', /自动进入新的临时草稿线程/);
  });

  it('prints file content with /cat and escapes embedded fences', async () => {
    initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu-default',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-cat' };
      },
    };
    const address = { channelType: 'feishu-default', chatId: 'chat-cat' } as const;
    const tempRoot = fs.mkdtempSync(path.join(DATA_DIR, 'cti-cat-'));
    const filePath = path.join(tempRoot, 'demo.md');
    fs.writeFileSync(filePath, ['line1', '```', 'line3'].join('\n'), 'utf-8');
    router.createBinding(address, tempRoot);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/cat demo.md',
        messageId: 'incoming-cat',
      } as any,
      '/cat demo.md',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.match(sent[0] || '', /````text/);
  });

  it('sends a local file with /file', async () => {
    initTestContext();
    const sent: any[] = [];
    const adapter: any = {
      channelType: 'feishu-default',
      provider: 'feishu',
      send: async (message: any) => {
        sent.push(message);
        return { ok: true, messageId: `reply-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu-default', chatId: 'chat-file' } as const;
    const tempRoot = fs.mkdtempSync(path.join(DATA_DIR, 'cti-file-'));
    const filePath = path.join(tempRoot, 'hello.txt');
    fs.writeFileSync(filePath, 'hello', 'utf-8');
    router.createBinding(address, tempRoot);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/file hello.txt',
        messageId: 'incoming-file',
      } as any,
      '/file hello.txt',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.ok(sent.some((m) => Array.isArray(m.attachments) && m.attachments.length === 1));
    assert.match(String(sent.at(-1)?.text || ''), /已发送文件/);
  });
});
