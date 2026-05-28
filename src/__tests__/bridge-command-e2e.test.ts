import './test-setup.js';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import fs from 'node:fs';
import { loadConfig } from '../config.js';
import { _testOnly } from '../lib/bridge/bridge-manager.js';
import {
  initBridgeTestContext,
  inboundMessage,
  makeBridgeSettings,
  RecordingAdapter,
  resetBridgeTestState,
  writeDesktopSessionJsonlFixture,
} from './test-bridge-utils.js';

function installFakeTmux(): { binDir: string; logPath: string; statePath: string } {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-e2e-fake-tmux-'));
  const logPath = path.join(binDir, 'tmux.log');
  const statePath = path.join(binDir, 'sessions.txt');
  const tmuxPath = path.join(binDir, 'tmux');
  fs.writeFileSync(logPath, '', 'utf-8');
  fs.writeFileSync(statePath, '', 'utf-8');
  fs.writeFileSync(tmuxPath, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TMUX_FAKE_LOG"
state="$TMUX_FAKE_STATE"
case "$1" in
  has-session)
    target="$3"
    if grep -Fx -- "$target" "$state" >/dev/null 2>&1; then
      exit 0
    fi
    exit 1
    ;;
  new-session)
    name=""
    prev=""
    for arg in "$@"; do
      if [[ "$prev" == "-s" ]]; then
        name="$arg"
        break
      fi
      prev="$arg"
    done
    if [[ -n "$name" ]] && ! grep -Fx -- "$name" "$state" >/dev/null 2>&1; then
      printf '%s\\n' "$name" >> "$state"
    fi
    exit 0
    ;;
  kill-session)
    target="$3"
    tmp="\${state}.tmp"
    grep -Fxv -- "$target" "$state" > "$tmp" 2>/dev/null || true
    mv "$tmp" "$state"
    exit 0
    ;;
  send-keys)
    exit 0
    ;;
  capture-pane)
    printf 'fake tmux screen\\n'
    exit 0
    ;;
  list-sessions)
    while IFS= read -r name; do
      [[ -n "$name" ]] && printf '%s\\t1\\t0\\t0\\t0\\n' "$name"
    done < "$state"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`, 'utf-8');
  fs.chmodSync(tmuxPath, 0o755);
  return { binDir, logPath, statePath };
}

describe('bridge command e2e', () => {
  beforeEach(() => {
    resetBridgeTestState({ cleanCodexHome: true });
    _testOnly.resetStateForTests();
  });

  it('handles /new, /his limit, and /his msg through the bridge manager entrypoint', async () => {
    const store = initBridgeTestContext({ dynamicSettings: true });
    const adapter = new RecordingAdapter();
    const address = { channelType: 'feishu', chatId: 'chat-history-e2e' } as const;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-history-e2e-'));

    await _testOnly.handleMessage(adapter, inboundMessage(address, `/new ${workDir}`, 'incoming-new'));
    const binding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(binding);
    assert.equal(binding.workingDirectory, workDir);

    store.addMessage(binding.codepilotSessionId, 'user', '端到端用户消息');
    store.addMessage(binding.codepilotSessionId, 'assistant', '端到端助手回复');

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/his limit 12', 'incoming-limit'));
    assert.equal(loadConfig().historyMessageLimit, 12);

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/ui off', 'incoming-ui-detail-off'));
    assert.equal(loadConfig().sdkToolCallDetailsInText, false);
    assert.match(adapter.sent.at(-1)?.text || '', /已更新 UI 显示设置/);
    assert.match(adapter.sent.at(-1)?.text || '', /只显示工具名、状态和正文/);

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/ui on', 'incoming-ui-detail-on'));
    assert.equal(loadConfig().sdkToolCallDetailsInText, true);
    assert.match(adapter.sent.at(-1)?.text || '', /显示工具输入输出/);

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/his msg', 'incoming-history-msg'));

    const lastText = adapter.sent.at(-1)?.text || '';
    assert.match(lastText, /最近对话（msg）/);
    assert.match(lastText, /返回条数.*2 \/ 配置 12/s);
    assert.match(lastText, /端到端用户消息/);
    assert.match(lastText, /端到端助手回复/);
  });

  it('starts tmux provider with current permissions and routes tmux-provider messages through the bridge entrypoint', async () => {
    const store = initBridgeTestContext({
      dynamicSettings: true,
      settings: makeBridgeSettings(),
    });
    const fakeTmux = installFakeTmux();
    const oldPath = process.env.PATH || '';
    const oldFakeLog = process.env.TMUX_FAKE_LOG;
    const oldFakeState = process.env.TMUX_FAKE_STATE;
    process.env.PATH = `${fakeTmux.binDir}${path.delimiter}${oldPath}`;
    process.env.TMUX_FAKE_LOG = fakeTmux.logPath;
    process.env.TMUX_FAKE_STATE = fakeTmux.statePath;

    const adapter = new RecordingAdapter();
    const address = { channelType: 'feishu', chatId: 'chat-runtime-e2e' } as const;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-runtime-e2e-'));

    try {
      await _testOnly.handleMessage(adapter, inboundMessage(address, `/new ${workDir}`, 'incoming-runtime-new'));
      const binding = store.getChannelBinding(address.channelType, address.chatId);
      assert.ok(binding);
      const normalThreadId = '019e46bc-f466-71d3-a186-a2ce89051958';
      const normalTmuxSession = `codex-${normalThreadId}`;
      store.updateSdkSessionId(binding.codepilotSessionId, normalThreadId);

      await _testOnly.handleMessage(adapter, inboundMessage(address, '/sandbox read-only', 'incoming-runtime-sandbox'));
      await _testOnly.handleMessage(adapter, inboundMessage(address, '/network on', 'incoming-runtime-network'));
      await _testOnly.handleMessage(adapter, inboundMessage(address, '/r high', 'incoming-runtime-reasoning'));
      await _testOnly.handleMessage(adapter, inboundMessage(address, '/provider tmux', 'incoming-runtime-provider'));

      const tmuxSession = store.getSession(binding.codepilotSessionId);
      assert.equal(tmuxSession?.codex_provider, 'tmux');
      assert.equal(tmuxSession?.tmux_session_name, normalTmuxSession);
      assert.equal(tmuxSession?.tmux_auto_enter, true);
      assert.equal(tmuxSession?.desktop_thread_id, normalThreadId);
      assert.equal(tmuxSession?.thread_origin, 'desktop');

      const startLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      assert.match(startLog, new RegExp(`has-session -t ${normalTmuxSession}`));
      assert.match(startLog, new RegExp(`new-session -d -s ${normalTmuxSession}`));
      assert.match(startLog, /-- env .* codex --sandbox read-only/);
      assert.doesNotMatch(startLog, / new-session .* -e /);
      assert.match(startLog, new RegExp(`--cd ${workDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.match(startLog, /--ask-for-approval on-request/);
      assert.match(startLog, /--config 'model_reasoning_effort="high"'/);
      assert.match(startLog, /--config sandbox_workspace_write.network_access=true/);
      assert.match(startLog, new RegExp(`resume ${normalThreadId}`));

      const beforeRestartLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      await _testOnly.handleMessage(adapter, inboundMessage(address, '/provider tmux', 'incoming-runtime-provider-restart'));
      const restartResponse = adapter.sent.at(-1)?.text || '';
      const restartLog = fs.readFileSync(fakeTmux.logPath, 'utf-8').slice(beforeRestartLog.length);
      assert.match(restartResponse, /同名 tmux session 已存在/);
      assert.match(restartResponse, /销毁并重新启动/);
      assert.match(restartLog, new RegExp(`has-session -t ${normalTmuxSession}`));
      assert.match(restartLog, new RegExp(`kill-session -t ${normalTmuxSession}`));
      assert.match(restartLog, new RegExp(`new-session -d -s ${normalTmuxSession}`));
      assert.match(restartLog, new RegExp(`resume ${normalThreadId}`));

      await _testOnly.handleMessage(adapter, inboundMessage(address, '普通消息', 'incoming-runtime-plain'));
      await _testOnly.handleMessage(adapter, inboundMessage(address, '/goal 检查权限', 'incoming-runtime-unknown-command'));
      await _testOnly.handleMessage(adapter, inboundMessage(address, '//plan 下一步', 'incoming-runtime-escaped-command'));
      await _testOnly.handleMessage(adapter, inboundMessage(address, '/tmux /compact', 'incoming-runtime-tmux-command'));

      const routedLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      assert.match(routedLog, new RegExp(`send-keys -t ${normalTmuxSession} -l 普通消息`));
      assert.match(routedLog, new RegExp(`send-keys -t ${normalTmuxSession} -l /goal 检查权限`));
      assert.match(routedLog, new RegExp(`send-keys -t ${normalTmuxSession} -l /plan 下一步`));
      assert.match(routedLog, new RegExp(`send-keys -t ${normalTmuxSession} -l /compact`));
      assert.ok((routedLog.match(new RegExp(`send-keys -t ${normalTmuxSession} Enter`, 'g')) || []).length >= 4);

      await _testOnly.handleMessage(adapter, inboundMessage(address, '/mode yolo', 'incoming-runtime-block-mode'));
      assert.match(adapter.sent.at(-1)?.text || '', /当前是 tmux Provider/);
      assert.match(adapter.sent.at(-1)?.text || '', /先发送 \/provider sdk/);
      assert.notEqual(store.getChannelBinding(address.channelType, address.chatId)?.mode, 'yolo');
      assert.notEqual(store.getSession(binding.codepilotSessionId)?.preferred_mode, 'yolo');

      await _testOnly.handleMessage(adapter, inboundMessage(address, '/net off', 'incoming-runtime-block-network'));
      assert.match(adapter.sent.at(-1)?.text || '', /当前是 tmux Provider/);
      assert.match(adapter.sent.at(-1)?.text || '', /Codex TUI 里使用内置 slash 命令/);
      assert.equal(store.getSession(binding.codepilotSessionId)?.codex_network_access, true);

      await _testOnly.handleMessage(adapter, inboundMessage(address, '/provider sdk', 'incoming-runtime-provider-sdk'));
      assert.equal(store.getSession(binding.codepilotSessionId)?.codex_provider, 'sdk');

      await _testOnly.handleMessage(adapter, inboundMessage(address, '/m yolo', 'incoming-runtime-mode-yolo'));
      assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.mode, 'yolo');
      assert.equal(store.getSession(binding.codepilotSessionId)?.preferred_mode, 'yolo');

      const yoloThreadId = '019e46bc-f466-71d3-a186-a2ce89051959';
      const yoloTmuxSession = `codex-${yoloThreadId}`;
      store.updateSdkSessionId(binding.codepilotSessionId, yoloThreadId);
      const beforeYoloLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      await _testOnly.handleMessage(adapter, inboundMessage(address, '/provider tmux', 'incoming-runtime-provider-tmux-yolo'));
      const yoloLog = fs.readFileSync(fakeTmux.logPath, 'utf-8').slice(beforeYoloLog.length);
      assert.match(yoloLog, new RegExp(`new-session -d -s ${yoloTmuxSession}`));
      assert.match(yoloLog, /-- env .* codex --dangerously-bypass-approvals-and-sandbox/);
      assert.doesNotMatch(yoloLog, / new-session .* -e /);
      assert.doesNotMatch(yoloLog, /--sandbox/);
      assert.doesNotMatch(yoloLog, /--ask-for-approval/);
      assert.match(yoloLog, new RegExp(`resume ${yoloThreadId}`));

      await _testOnly.handleMessage(adapter, inboundMessage(address, '/', 'incoming-runtime-status'));
      const statusText = adapter.sent.at(-1)?.text || '';
      assert.match(statusText, /当前会话/);
      assert.match(statusText, /yolo/);
      assert.match(statusText, /tmux/);
      assert.match(statusText, /read-only/);
      assert.match(statusText, /enabled/);
      assert.match(statusText, /当前聊天已绑定到一条共享会话/);
      assert.doesNotMatch(statusText, /还没有绑定桌面会话/);
    } finally {
      process.env.PATH = oldPath;
      if (oldFakeLog === undefined) delete process.env.TMUX_FAKE_LOG;
      else process.env.TMUX_FAKE_LOG = oldFakeLog;
      if (oldFakeState === undefined) delete process.env.TMUX_FAKE_STATE;
      else process.env.TMUX_FAKE_STATE = oldFakeState;
      fs.rmSync(fakeTmux.binDir, { recursive: true, force: true });
    }
  });

  it('falls back to bridge cached messages for /his when the session has no desktop JSONL file', async () => {
    const store = initBridgeTestContext({ dynamicSettings: true });
    const adapter = new RecordingAdapter();
    const address = { channelType: 'feishu', chatId: 'chat-history-raw-e2e' } as const;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-history-raw-e2e-'));

    await _testOnly.handleMessage(adapter, inboundMessage(address, `/new ${workDir}`, 'incoming-new-raw'));
    const binding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(binding);

    store.addMessage(binding.codepilotSessionId, 'user', 'Bridge 缓存用户消息');
    store.addMessage(binding.codepilotSessionId, 'assistant', 'Bridge 缓存助手回复');

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/his', 'incoming-history-raw'));

    const lastText = adapter.sent.at(-1)?.text || '';
    assert.match(lastText, /最近对话（解析文本）/);
    assert.match(lastText, /来源.*Bridge 缓存/s);
    assert.match(lastText, /Bridge 缓存用户消息/);
    assert.match(lastText, /Bridge 缓存助手回复/);
  });

  it('prefers desktop JSONL messages over bridge cached messages for /his msg after /t binding', async () => {
    const store = initBridgeTestContext({ dynamicSettings: true });
    const adapter = new RecordingAdapter();
    const address = { channelType: 'feishu', chatId: 'chat-history-desktop-msg-e2e' } as const;
    const threadId = '11111111111111111111111111111111';
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-desktop-msg-e2e-'));
    writeDesktopSessionJsonlFixture({
      threadId,
      workDir,
      lines: [
        {
          timestamp: '2026-05-28T00:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: threadId,
            timestamp: '2026-05-28T00:00:00.000Z',
            cwd: workDir,
            originator: 'Codex CLI',
          },
        },
        {
          timestamp: '2026-05-28T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: '桌面 JSONL 用户消息' },
        },
        {
          timestamp: '2026-05-28T00:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: '桌面 JSONL 助手回复' },
        },
        {
          timestamp: '2026-05-28T00:00:02.001Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '桌面 JSONL 助手回复' }],
          },
        },
      ],
    });

    await _testOnly.handleMessage(adapter, inboundMessage(address, `/t ${threadId}`, 'incoming-thread-msg'));
    const binding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(binding);
    store.addMessage(binding.codepilotSessionId, 'assistant', 'Bridge 缓存不应优先展示');

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/his msg', 'incoming-history-desktop-msg'));

    const lastText = adapter.sent.at(-1)?.text || '';
    assert.match(lastText, /最近对话（msg）/);
    assert.match(lastText, /来源.*Codex session JSONL/s);
    assert.match(lastText, /桌面 JSONL 用户消息/);
    assert.match(lastText, /桌面 JSONL 助手回复/);
    assert.equal((lastText.match(/桌面 JSONL 助手回复/g) || []).length, 1);
    assert.doesNotMatch(lastText, /Bridge 缓存不应优先展示/);
  });

  it('renders task_complete-only final answers from desktop JSONL through /his msg', async () => {
    initBridgeTestContext({ dynamicSettings: true });
    const adapter = new RecordingAdapter();
    const address = { channelType: 'feishu', chatId: 'chat-history-task-complete-e2e' } as const;
    const threadId = '22222222222222222222222222222222';
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-task-complete-e2e-'));
    writeDesktopSessionJsonlFixture({
      threadId,
      workDir,
      lines: [
        {
          timestamp: '2026-05-28T00:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: threadId,
            timestamp: '2026-05-28T00:00:00.000Z',
            cwd: workDir,
            originator: 'Codex CLI',
          },
        },
        {
          timestamp: '2026-05-28T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: '请给最终答案' },
        },
        {
          timestamp: '2026-05-28T00:00:02.000Z',
          type: 'event_msg',
          payload: {
            type: 'task_complete',
            last_agent_message: '只有 task_complete 里的最终答案',
          },
        },
      ],
    });

    await _testOnly.handleMessage(adapter, inboundMessage(address, `/t ${threadId}`, 'incoming-thread-task-complete'));
    await _testOnly.handleMessage(adapter, inboundMessage(address, '/his msg', 'incoming-history-task-complete'));

    const lastText = adapter.sent.at(-1)?.text || '';
    assert.match(lastText, /最近对话（msg）/);
    assert.match(lastText, /请给最终答案/);
    assert.match(lastText, /只有 task_complete 里的最终答案/);
  });

  it('sends the original desktop session JSONL file through /his json after /t binding', async () => {
    initBridgeTestContext({ dynamicSettings: true });
    const adapter = new RecordingAdapter();
    const address = { channelType: 'feishu', chatId: 'chat-history-json-e2e' } as const;
    const threadId = '0123456789abcdef0123456789abcdef';
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-desktop-e2e-'));
    const { sessionPath, rawJsonl } = writeDesktopSessionJsonlFixture({
      threadId,
      workDir,
      lines: [
        {
          timestamp: '2026-05-28T00:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: threadId,
            timestamp: '2026-05-28T00:00:00.000Z',
            cwd: workDir,
            originator: 'Codex CLI',
          },
        },
        {
          timestamp: '2026-05-28T00:00:01.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: '原始 JSONL 端到端内容' },
        },
      ],
    });

    await _testOnly.handleMessage(adapter, inboundMessage(address, `/t ${threadId}`, 'incoming-thread'));
    await _testOnly.handleMessage(adapter, inboundMessage(address, '/his json', 'incoming-history-json'));

    const attachmentMessage = adapter.sent.find((message) =>
      Array.isArray(message.attachments) && message.attachments.length === 1);
    assert.ok(attachmentMessage);
    assert.equal(attachmentMessage.attachments?.[0]?.path, sessionPath);
    assert.equal(fs.readFileSync(attachmentMessage.attachments![0].path, 'utf-8'), rawJsonl);
  });
});
