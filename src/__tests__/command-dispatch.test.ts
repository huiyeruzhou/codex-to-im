import './test-setup.js';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CONFIG_PATH, CONFIG_V2_PATH, CTI_HOME } from '../config.js';
import { JsonFileStore } from '../store.js';
import { initBridgeContext } from '../lib/bridge/context.js';
import { handleBridgeCommand } from '../lib/bridge/command-dispatch.js';
import { buildCommandCallbackData, parseCommandCallbackData } from '../lib/bridge/command-callbacks.js';
import * as router from '../lib/bridge/channel-router.js';
import { getThreadTableMessageRecord } from '../lib/bridge/thread-table-message-pins.js';
import type { OutboundRichCard } from '../lib/bridge/types.js';

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

function installFakeTmux(): { binDir: string; logPath: string } {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-fake-tmux-'));
  const logPath = path.join(binDir, 'tmux.log');
  const tmuxPath = path.join(binDir, 'tmux');
  fs.writeFileSync(logPath, '', 'utf-8');
  fs.writeFileSync(tmuxPath, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TMUX_FAKE_LOG"
case "$1" in
  list-sessions)
    printf 'alpha\\t1\\t0\\t0\\t0\\n'
    printf 'beta\\t2\\t1\\t0\\t0\\n'
    exit 0
    ;;
  has-session)
    target="$3"
    if [[ "$target" == "alpha" || "$target" == "beta" ]]; then
      exit 0
    fi
    exit 1
    ;;
  new-session)
    exit 0
    ;;
  send-keys)
    exit 0
    ;;
  capture-pane)
    printf 'alpha-screen\\n$ pwd\\n/repo\\n'
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`, 'utf-8');
  fs.chmodSync(tmuxPath, 0o755);
  return { binDir, logPath };
}

describe('command-dispatch', () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(CONFIG_PATH, { force: true });
    fs.rmSync(CONFIG_V2_PATH, { force: true });
  });

  it('round-trips interactive command callback data', () => {
    const callbackData = buildCommandCallbackData('/stop', 'session-1');
    assert.deepEqual(parseCommandCallbackData(callbackData), {
      commandText: '/stop',
      scopeSessionId: 'session-1',
    });
    assert.equal(parseCommandCallbackData('perm:allow:1'), undefined);
    assert.equal(parseCommandCallbackData('cti-command::not-a-command'), null);
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
    const address = { channelType: 'feishu-default', chatId: 'chat-prebound-status', displayName: 'Prebound Chat' } as const;
    const session = store.createSession('prebound-session', 'test-model', undefined, '/tmp/prebound-status');
    store.updateSession(session.id, {
      sdk_session_id: 'codex-thread-prebound',
      codex_thread_id: 'codex-thread-prebound',
    });
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
        text: '/',
        messageId: 'incoming-prebound-status',
      } as any,
      '/',
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
    assert.match(sent[0] || '', /当前会话/);
    assert.match(sent[0] || '', /prebound-session/);
    assert.match(sent[0] || '', /codex-thread-id/);
    assert.match(sent[0] || '', /codex-thread-prebound/);
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

  it('renders /status as global bridge status without creating a session or binding for an unbound chat', async () => {
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
    assert.match(response, /全局状态/);
    assert.match(response, /Bridge/);
    assert.match(response, /Bridge PID/);
    assert.match(response, /当前聊天绑定.*未绑定/s);
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
    assert.doesNotMatch(sent[0] || '', /旧任务在运行/);
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

  it('lists, switches, and removes multiple bindings with /t subcommands', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const richCards: OutboundRichCard[] = [];
    const pinned: string[] = [];
    const unpinned: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string; richCard?: OutboundRichCard }) => {
        sent.push(message.text);
        if (message.richCard) richCards.push(message.richCard);
        return { ok: true, messageId: `reply-t-${sent.length}` };
      },
      pinMessage: async (_chatId: string, messageId: string) => {
        pinned.push(messageId);
        return { ok: true, messageId };
      },
      unpinMessage: async (_chatId: string, messageId: string) => {
        unpinned.push(messageId);
        return { ok: true, messageId };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-t-multi' } as const;
    const first = router.createBinding(address, 'D:\\workspace\\first');
    const second = router.createBinding(address, 'D:\\workspace\\second');

    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, second.id);
    assert.equal(store.listChannelBindings().filter((binding) => binding.chatId === address.chatId).length, 2);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t ls',
        messageId: 'incoming-t-ls',
      } as any,
      '/t ls',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );
    assert.match(sent.at(-1) || '', /当前聊天绑定/);
    assert.match(sent.at(-1) || '', /#\s+标题\s+目录\s+上一次活动\s+binding_id\s+thread_id\s+source\s+命令/);
    assert.match(sent.at(-1) || '', /first/);
    assert.match(sent.at(-1) || '', /second/);
    assert.equal(richCards.at(-1)?.title, '当前聊天绑定（2）');
    assert.deepEqual(richCards.at(-1)?.table?.columns.map((column) => column.name), [
      'index',
      'title',
      'cwd',
      'last_active',
      'binding_id',
      'thread_id',
      'source',
      'command',
    ]);
    assert.deepEqual(
      richCards.at(-1)?.actions?.flat().map((action) => action.text),
      ['解绑', '激活', '刷新'],
    );
    assert.equal(richCards.at(-1)?.table?.columns[0]?.horizontalAlign, 'center');
    assert.equal(richCards.at(-1)?.table?.rows[0]?.index, "<number_tag background_color='grey-500' font_color='white'>1</number_tag>");
    assert.doesNotMatch(String(richCards.at(-1)?.table?.rows[0]?.title || ''), /^<font color=/);
    assert.equal(richCards.at(-1)?.table?.rows[1]?.index, "**<number_tag background_color='green-350' font_color='white'>2</number_tag>**");
    assert.match(String(richCards.at(-1)?.table?.rows[1]?.title || ''), /^\*\*.+\*\*$/);
    assert.deepEqual(pinned, ['reply-t-1']);
    assert.deepEqual(unpinned, []);
    assert.deepEqual(getThreadTableMessageRecord(address), {
      channelType: 'feishu',
      chatId: 'chat-t-multi',
      scope: 'bound',
      messageId: 'reply-t-1',
      pinnedMessageId: 'reply-t-1',
      updatedAt: getThreadTableMessageRecord(address)?.updatedAt,
    });

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t ls',
        messageId: 'incoming-t-ls-2',
      } as any,
      '/t ls',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );
    assert.deepEqual(pinned, ['reply-t-1', 'reply-t-2']);
    assert.deepEqual(unpinned, ['reply-t-1']);
    assert.equal(getThreadTableMessageRecord(address)?.messageId, 'reply-t-2');
    assert.equal(getThreadTableMessageRecord(address)?.pinnedMessageId, 'reply-t-2');

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t use 1',
        messageId: 'incoming-t-use',
      } as any,
      '/t use 1',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, first.id);
    assert.match(sent.at(-1) || '', /当前线程已切换/);
    assert.equal(richCards.length, 2);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t rm 2',
        messageId: 'incoming-t-rm',
      } as any,
      '/t rm 2',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );
    const remaining = store.listChannelBindings().filter((binding) => binding.chatId === address.chatId);
    assert.deepEqual(remaining.map((binding) => binding.id), [first.id]);
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, first.id);
    assert.match(sent.at(-1) || '', /已移除绑定线程/);
    assert.equal(richCards.length, 2);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t remove 1',
        messageId: 'incoming-t-remove',
      } as any,
      '/t remove 1',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );
    assert.equal(store.listChannelBindings().filter((binding) => binding.chatId === address.chatId).length, 0);
    assert.match(sent.at(-1) || '', /已移除绑定线程/);
    assert.equal(richCards.length, 2);
  });

  it('resolves /t bound-thread targets by unique name and rejects duplicate names', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-t-name-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-t-name' } as const;
    const first = router.createBinding(address, 'D:\\workspace\\first-name');
    const second = router.createBinding(address, 'D:\\workspace\\second-name');
    store.updateSession(first.codepilotSessionId, { name: '前端修复' });
    store.updateSession(second.codepilotSessionId, { name: '后端修复' });

    const deps = {
      getActiveTask: () => undefined,
      diagnoseSessionHealth: async () => null,
      diagnoseAllActiveSessions: async () => [],
    };

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t use 前端修复',
        messageId: 'incoming-t-use-name',
      } as any,
      '/t use 前端修复',
      deps,
    );

    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, first.id);
    assert.match(sent.at(-1) || '', /当前线程已切换/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t rm 后端修复',
        messageId: 'incoming-t-rm-name',
      } as any,
      '/t rm 后端修复',
      deps,
    );

    assert.equal(store.listChannelBindings().filter((binding) => binding.chatId === address.chatId).length, 1);
    assert.match(sent.at(-1) || '', /已移除绑定线程/);

    const duplicate = router.createBinding(address, 'D:\\workspace\\duplicate-name');
    store.updateSession(duplicate.codepilotSessionId, { name: '前端修复' });

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t use 前端修复',
        messageId: 'incoming-t-use-duplicate-name',
      } as any,
      '/t use 前端修复',
      deps,
    );

    assert.match(sent.at(-1) || '', /匹配到多个绑定线程/);
  });

  it('maps /stop to C-c for a running tmux provider mirror turn', async () => {
    const store = initTestContext();
    const fakeTmux = installFakeTmux();
    const oldPath = process.env.PATH || '';
    const oldFakeLog = process.env.TMUX_FAKE_LOG;
    process.env.PATH = `${fakeTmux.binDir}${path.delimiter}${oldPath}`;
    process.env.TMUX_FAKE_LOG = fakeTmux.logPath;
    const sent: string[] = [];
    const forcedStops: Array<{ sessionId: string; detail?: string }> = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-stop-tmux-provider' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-stop-tmux-provider' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\stop-tmux-provider');
    store.updateSession(binding.codepilotSessionId, {
      codex_provider: 'tmux',
      tmux_session_name: 'alpha',
      mirror_status: 'watching',
      runtime_status: 'running',
      health_status: 'running_active',
    });

    try {
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/stop',
          messageId: 'incoming-stop-tmux-provider',
        } as any,
        '/stop',
        {
          getActiveTask: () => undefined,
          forceStopSession: async (sessionId, detail) => {
            forcedStops.push({ sessionId, detail });
            return false;
          },
          diagnoseSessionHealth: async () => null,
          diagnoseAllActiveSessions: async () => [],
        },
      );

      const log = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      assert.match(log, /send-keys -t alpha C-c/);
      assert.deepEqual(forcedStops, []);
      assert.match(sent[0] || '', /已发送停止按键/);
      assert.match(sent[0] || '', /tmux send-keys -t alpha C-c/);
    } finally {
      process.env.PATH = oldPath;
      if (oldFakeLog === undefined) {
        delete process.env.TMUX_FAKE_LOG;
      } else {
        process.env.TMUX_FAKE_LOG = oldFakeLog;
      }
      fs.rmSync(fakeTmux.binDir, { recursive: true, force: true });
    }
  });

  it('renames the current /t binding and rejects ambiguous identifier-like names', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const richCards: OutboundRichCard[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string; richCard?: OutboundRichCard }) => {
        sent.push(message.text);
        if (message.richCard) richCards.push(message.richCard);
        return { ok: true, messageId: `reply-rename-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-rename' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\rename');

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t rename 12345',
        messageId: 'incoming-rename-1',
      } as any,
      '/t rename 12345',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.equal(store.getSession(binding.codepilotSessionId)?.name, 'Bridge: chat-rename');
    assert.match(sent[0] || '', /名称不能是纯数字/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t rename 前端修复',
        messageId: 'incoming-rename-2',
      } as any,
      '/t rename 前端修复',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.equal(store.getSession(binding.codepilotSessionId)?.name, '前端修复');
    assert.match(sent[1] || '', /当前线程已重命名/);
    assert.match(sent[1] || '', /binding_id/);
    assert.equal(richCards.length, 0);
    const meta = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ui-session-meta.json'), 'utf-8'));
    assert.equal(meta[`session:${binding.codepilotSessionId}`]?.name, '前端修复');
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

  it('binds a tmux session, sends mixed literal and special keys, and returns a capture', async () => {
    const store = initTestContext();
    const fakeTmux = installFakeTmux();
    const oldPath = process.env.PATH || '';
    const oldFakeLog = process.env.TMUX_FAKE_LOG;
    process.env.PATH = `${fakeTmux.binDir}${path.delimiter}${oldPath}`;
    process.env.TMUX_FAKE_LOG = fakeTmux.logPath;

    try {
      const sent: string[] = [];
      const richCards: any[] = [];
      const adapter: any = {
        channelType: 'feishu',
        send: async (message: { text: string; richCard?: any }) => {
          sent.push(message.text);
          if (message.richCard) richCards.push(message.richCard);
          return { ok: true, messageId: `reply-tmux-${sent.length}` };
        },
      };
      const address = { channelType: 'feishu', chatId: 'chat-tmux' } as const;
      const deps = {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      };

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-switch',
          messageId: 'incoming-tmux-switch',
        } as any,
        '/tmux-switch',
        deps,
      );
      assert.match(sent.at(-1) || '', /alpha/);
      assert.match(sent.at(-1) || '', /\/tmux-attach <session>|\/tmux-attach &lt;session&gt;/);
      assert.match(sent.at(-1) || '', /真实 tmux 底层命令/);
      assert.match(sent.at(-1) || '', /tmux list-sessions -F/);
      assert.equal(richCards.at(-1)?.title, 'tmux session 选择');
      assert.deepEqual(
        richCards.at(-1)?.table?.columns?.map((column: any) => column.name),
        ['session', 'windows', 'attached', 'command'],
      );
      assert.equal(richCards.at(-1)?.table?.freezeFirstColumn, false);
      assert.equal(richCards.at(-1)?.table?.rows?.[0]?.session, 'alpha');
      assert.match(richCards.at(-1)?.table?.rows?.[0]?.command || '', /^\/tmux-attach /);
      assert.equal(richCards.at(-1)?.selects?.[0]?.options?.[0]?.text, 'alpha');
      assert.match(richCards.at(-1)?.selects?.[0]?.options?.[0]?.callbackData || '', /^cti-command:/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-attach alpha',
          messageId: 'incoming-tmux-attach',
        } as any,
        '/tmux-attach alpha',
        deps,
      );
      const binding = store.getChannelBinding(address.channelType, address.chatId);
      assert.ok(binding);
      const session = binding ? store.getSession(binding.codepilotSessionId) : null;
      assert.equal(session?.tmux_session_name, 'alpha');
      assert.match(sent.at(-1) || '', /已绑定 tmux session/);
      assert.match(sent.at(-1) || '', /```sh/);
      assert.match(sent.at(-1) || '', /alpha-screen/);
      assert.match(sent.at(-1) || '', /tmux has-session -t alpha/);
      assert.match(sent.at(-1) || '', /tmux capture-pane -t alpha -p -S -0/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-set lines 120',
          messageId: 'incoming-tmux-set',
        } as any,
        '/tmux-set lines 120',
        deps,
      );
      const updatedSession = binding ? store.getSession(binding.codepilotSessionId) : null;
      assert.equal(updatedSession?.tmux_capture_lines, 120);
      assert.doesNotMatch(sent.at(-1) || '', /真实 tmux 底层命令/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-set enter on',
          messageId: 'incoming-tmux-set-enter-on',
        } as any,
        '/tmux-set enter on',
        deps,
      );
      const autoEnterSession = binding ? store.getSession(binding.codepilotSessionId) : null;
      assert.equal(autoEnterSession?.tmux_auto_enter, true);
      assert.match(sent.at(-1) || '', /自动回车.*on/s);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux echo auto',
          messageId: 'incoming-tmux-auto-enter',
        } as any,
        '/tmux echo auto',
        deps,
      );
      const autoEnterResponse = sent.at(-1) || '';
      assert.match(autoEnterResponse, /tmux send-keys -t alpha -l 'echo auto'/);
      assert.match(autoEnterResponse, /tmux send-keys -t alpha Enter/);

      const beforeExplicitEnterLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      const beforeExplicitEnterCount = (beforeExplicitEnterLog.match(/send-keys -t alpha Enter/g) || []).length;
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux echo once<Enter>',
          messageId: 'incoming-tmux-auto-enter-explicit',
        } as any,
        '/tmux echo once<Enter>',
        deps,
      );
      const afterExplicitEnterLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      const afterExplicitEnterCount = (afterExplicitEnterLog.match(/send-keys -t alpha Enter/g) || []).length;
      assert.equal(afterExplicitEnterCount - beforeExplicitEnterCount, 1);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-set enter off',
          messageId: 'incoming-tmux-set-enter-off',
        } as any,
        '/tmux-set enter off',
        deps,
      );
      const autoEnterOffSession = binding ? store.getSession(binding.codepilotSessionId) : null;
      assert.equal(autoEnterOffSession?.tmux_auto_enter, false);

      const beforeAutoEnterOffLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux echo off',
          messageId: 'incoming-tmux-auto-enter-off',
        } as any,
        '/tmux echo off',
        deps,
      );
      const autoEnterOffResponse = sent.at(-1) || '';
      assert.match(autoEnterOffResponse, /tmux send-keys -t alpha -l 'echo off'/);
      assert.doesNotMatch(autoEnterOffResponse, /tmux send-keys -t alpha Enter/);
      const afterAutoEnterOffLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      const autoEnterOffLogDelta = afterAutoEnterOffLog.slice(beforeAutoEnterOffLog.length);
      assert.match(autoEnterOffLogDelta, /send-keys -t alpha -l echo off/);
      assert.doesNotMatch(autoEnterOffLogDelta, /send-keys -t alpha Enter/);

      const beforeScreenLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen',
          messageId: 'incoming-screen',
        } as any,
        '/tmux-screen',
        deps,
      );
      const screenResponse = sent.at(-1) || '';
      assert.match(screenResponse, /tmux 当前屏幕状态/);
      assert.match(screenResponse, /```sh/);
      assert.match(screenResponse, /alpha-screen/);
      assert.match(screenResponse, /真实 tmux 底层命令/);
      assert.match(screenResponse, /tmux capture-pane -t alpha -p -S -120/);
      const screenLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      const screenLogDelta = screenLog.slice(beforeScreenLog.length);
      assert.match(screenLogDelta, /capture-pane -t alpha -p -S -120/);
      assert.doesNotMatch(screenLogDelta, /send-keys/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen 42',
          messageId: 'incoming-screen-lines',
        } as any,
        '/tmux-screen 42',
        deps,
      );
      const tempLinesResponse = sent.at(-1) || '';
      assert.match(tempLinesResponse, /展示行数.*42/s);
      assert.match(tempLinesResponse, /tmux capture-pane -t alpha -p -S -42/);
      const afterTempLinesSession = binding ? store.getSession(binding.codepilotSessionId) : null;
      assert.equal(afterTempLinesSession?.tmux_capture_lines, 120);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen 5s',
          messageId: 'incoming-screen-watch-default-lines',
        } as any,
        '/tmux-screen 5s',
        deps,
      );
      const defaultLinesWatchResponse = sent.at(-1) || '';
      assert.match(defaultLinesWatchResponse, /展示行数.*120/s);
      assert.match(defaultLinesWatchResponse, /定时刷新.*5s/s);
      assert.match(defaultLinesWatchResponse, /tmux capture-pane -t alpha -p -S -120/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen 30 1s',
          messageId: 'incoming-screen-watch',
        } as any,
        '/tmux-screen 30 1s',
        deps,
      );
      const watchResponse = sent.at(-1) || '';
      assert.match(watchResponse, /展示行数.*30/s);
      assert.match(watchResponse, /定时刷新.*3s/s);
      assert.match(watchResponse, /\/tmux-screen stop/);
      assert.match(watchResponse, /tmux capture-pane -t alpha -p -S -30/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen lines 120 every 5s',
          messageId: 'incoming-screen-invalid-legacy',
        } as any,
        '/tmux-screen lines 120 every 5s',
        deps,
      );
      assert.match(sent.at(-1) || '', /tmux 屏幕用法/);
      assert.doesNotMatch(sent.at(-1) || '', /lines 120 every/);
      assert.doesNotMatch(sent.at(-1) || '', /真实 tmux 底层命令/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen stop',
          messageId: 'incoming-screen-stop',
        } as any,
        '/tmux-screen stop',
        deps,
      );
      assert.match(sent.at(-1) || '', /已停止 tmux 屏幕定时刷新/);
      assert.doesNotMatch(sent.at(-1) || '', /真实 tmux 底层命令/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux /goal 分析一下这个仓库<Enter>',
          messageId: 'incoming-tmux-slash-send',
        } as any,
        '/tmux /goal 分析一下这个仓库<Enter>',
        deps,
      );

      const slashResponse = sent.at(-1) || '';
      assert.match(slashResponse, /真实 tmux 底层命令/);
      assert.match(slashResponse, /tmux send-keys -t alpha -l '\/goal 分析一下这个仓库'/);
      assert.match(slashResponse, /tmux send-keys -t alpha Enter/);
      assert.doesNotMatch(slashResponse, /Option\/Alt/);

      const slashCommandLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      assert.match(slashCommandLog, /send-keys -t alpha -l \/goal 分析一下这个仓库/);
      assert.match(slashCommandLog, /send-keys -t alpha Enter/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux <Cmd+Backspace>',
          messageId: 'incoming-tmux-delete-line',
        } as any,
        '/tmux <Cmd+Backspace>',
        deps,
      );
      const deleteLineResponse = sent.at(-1) || '';
      assert.match(deleteLineResponse, /tmux send-keys -t alpha C-u/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux pwd<Enter><Cmd+C>',
          messageId: 'incoming-tmux-send',
        } as any,
        '/tmux pwd<Enter><Cmd+C>',
        deps,
      );

      const response = sent.at(-1) || '';
      assert.match(response, /```sh/);
      assert.match(response, /alpha-screen/);
      assert.match(response, /真实 tmux 底层命令/);
      assert.match(response, /tmux send-keys -t alpha -l pwd/);
      assert.match(response, /tmux send-keys -t alpha Enter/);
      assert.match(response, /tmux send-keys -t alpha C-c/);
      assert.doesNotMatch(response, /Option\/Alt/);

      const log = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      assert.match(log, /send-keys -t alpha -l pwd/);
      assert.match(log, /send-keys -t alpha -l echo auto/);
      assert.match(log, /send-keys -t alpha -l echo once/);
      assert.match(log, /send-keys -t alpha -l echo off/);
      assert.match(log, /send-keys -t alpha Enter/);
      assert.match(log, /send-keys -t alpha C-c/);
      assert.match(log, /send-keys -t alpha C-u/);
      assert.match(log, /capture-pane -t alpha -p -S -120/);
      assert.match(log, /capture-pane -t alpha -p -S -42/);
      assert.match(log, /capture-pane -t alpha -p -S -30/);
    } finally {
      process.env.PATH = oldPath;
      if (oldFakeLog === undefined) {
        delete process.env.TMUX_FAKE_LOG;
      } else {
        process.env.TMUX_FAKE_LOG = oldFakeLog;
      }
      fs.rmSync(fakeTmux.binDir, { recursive: true, force: true });
    }
  });

  it('updates a streaming card for timed tmux screen refresh when supported', async () => {
    const store = initTestContext();
    const fakeTmux = installFakeTmux();
    const oldPath = process.env.PATH || '';
    const oldFakeLog = process.env.TMUX_FAKE_LOG;
    process.env.PATH = `${fakeTmux.binDir}${path.delimiter}${oldPath}`;
    process.env.TMUX_FAKE_LOG = fakeTmux.logPath;

    const address = { channelType: 'feishu', chatId: 'chat-tmux-card' } as const;
    const sent: string[] = [];
    const cardTexts: Array<{ chatId: string; text: string; streamKey?: string }> = [];
    const cardStatuses: Array<{ chatId: string; text: string; streamKey?: string }> = [];
    const cardActions: Array<{ chatId: string; actions: any[][]; streamKey?: string }> = [];
    const cardEnds: Array<{ chatId: string; status: string; text: string; streamKey?: string }> = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-tmux-card-${sent.length}` };
      },
      supportsStructuredStreamingUi: () => true,
      onStreamText: (chatId: string, text: string, streamKey?: string) => {
        cardTexts.push({ chatId, text, streamKey });
      },
      onStreamStatus: (chatId: string, text: string, streamKey?: string) => {
        cardStatuses.push({ chatId, text, streamKey });
      },
      onStreamActions: (chatId: string, actions: any[][], streamKey?: string) => {
        cardActions.push({ chatId, actions, streamKey });
      },
      onStreamEnd: async (chatId: string, status: string, text: string, streamKey?: string) => {
        cardEnds.push({ chatId, status, text, streamKey });
        return true;
      },
    };
    const deps = {
      getActiveTask: () => undefined,
      diagnoseSessionHealth: async () => null,
      diagnoseAllActiveSessions: async () => [],
    };
    let monitorStarted = false;

    try {
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-attach alpha',
          messageId: 'incoming-tmux-card-attach',
        } as any,
        '/tmux-attach alpha',
        deps,
      );
      sent.length = 0;

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen 5s',
          messageId: 'incoming-tmux-card-screen',
        } as any,
        '/tmux-screen 5s',
        deps,
      );
      monitorStarted = true;

      assert.equal(sent.length, 0);
      assert.equal(cardTexts.length, 1);
      assert.equal(cardTexts[0].chatId, address.chatId);
      assert.match(cardTexts[0].streamKey || '', /^tmux-screen:/);
      assert.match(cardTexts[0].text, /tmux 当前屏幕状态/);
      assert.match(cardTexts[0].text, /alpha-screen/);
      assert.match(cardTexts[0].text, /定时刷新.*5s/s);
      assert.doesNotMatch(cardTexts[0].text, /真实 tmux 底层命令/);
      assert.equal(cardStatuses.length, 1);
      assert.match(cardStatuses[0].text, /tmux alpha/);
      assert.match(cardStatuses[0].text, /every 5s/);
      assert.equal(cardActions.length, 1);
      assert.equal(cardActions[0].chatId, address.chatId);
      assert.equal(cardActions[0].streamKey, cardTexts[0].streamKey);
      assert.equal(cardActions[0].actions[0][0].text, '停止');
      assert.match(cardActions[0].actions[0][0].callbackData, /^tmux-screen:stop:/);
      assert.equal(cardActions[0].actions[0][0].type, 'danger');
      assert.equal(cardActions[0].actions[0][0].disabled, false);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen stop',
          messageId: 'incoming-tmux-card-stop',
        } as any,
        '/tmux-screen stop',
        deps,
      );
      monitorStarted = false;

      assert.match(sent.at(-1) || '', /已停止 tmux 屏幕定时刷新/);
      assert.equal(cardActions.length, 2);
      assert.equal(cardActions[1].actions[0][0].text, '已停止');
      assert.equal(cardActions[1].actions[0][0].disabled, true);
      assert.equal(cardEnds.length, 1);
      assert.equal(cardEnds[0].chatId, address.chatId);
      assert.equal(cardEnds[0].status, 'interrupted');
      assert.match(cardEnds[0].text, /已停止 tmux 屏幕定时刷新/);
      assert.equal(cardEnds[0].streamKey, cardTexts[0].streamKey);
    } finally {
      if (monitorStarted) {
        await handleBridgeCommand(
          adapter,
          {
            address,
            text: '/tmux-screen stop',
            messageId: 'incoming-tmux-card-cleanup',
          } as any,
          '/tmux-screen stop',
          deps,
        );
      }
      process.env.PATH = oldPath;
      if (oldFakeLog === undefined) {
        delete process.env.TMUX_FAKE_LOG;
      } else {
        process.env.TMUX_FAKE_LOG = oldFakeLog;
      }
      fs.rmSync(fakeTmux.binDir, { recursive: true, force: true });
    }
  });
});
