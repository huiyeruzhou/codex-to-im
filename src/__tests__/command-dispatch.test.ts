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

function installFakeTmux(): { binDir: string; logPath: string } {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-fake-tmux-'));
  const logPath = path.join(binDir, 'tmux.log');
  const tmuxPath = path.join(binDir, 'tmux');
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
        text: '/status',
        messageId: 'incoming-prebound-status',
      } as any,
      '/status',
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

  it('binds a tmux session, sends mixed literal and special keys, and returns a capture', async () => {
    const store = initTestContext();
    const fakeTmux = installFakeTmux();
    const oldPath = process.env.PATH || '';
    const oldFakeLog = process.env.TMUX_FAKE_LOG;
    process.env.PATH = `${fakeTmux.binDir}${path.delimiter}${oldPath}`;
    process.env.TMUX_FAKE_LOG = fakeTmux.logPath;

    try {
      const sent: string[] = [];
      const adapter: any = {
        channelType: 'feishu',
        send: async (message: { text: string }) => {
          sent.push(message.text);
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
      assert.match(sent.at(-1) || '', /tmux capture-pane -t alpha -p -S -80/);

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
      assert.match(screenLog, /capture-pane -t alpha -p -S -120/);
      assert.doesNotMatch(screenLog, /send-keys/);

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
});
