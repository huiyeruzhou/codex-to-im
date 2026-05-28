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
  RecordingAdapter,
  resetBridgeTestState,
  writeDesktopSessionJsonlFixture,
} from './test-bridge-utils.js';

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

  it('updates runtime command settings and reports them through /status at the bridge manager entrypoint', async () => {
    const store = initBridgeTestContext({ dynamicSettings: true });
    const adapter = new RecordingAdapter();
    const address = { channelType: 'feishu', chatId: 'chat-runtime-e2e' } as const;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-runtime-e2e-'));

    await _testOnly.handleMessage(adapter, inboundMessage(address, `/new ${workDir}`, 'incoming-runtime-new'));
    const binding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(binding);

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/m yolo', 'incoming-runtime-mode'));
    await _testOnly.handleMessage(adapter, inboundMessage(address, '/provider tmux', 'incoming-runtime-provider'));
    await _testOnly.handleMessage(adapter, inboundMessage(address, '/sandbox danger-full-access', 'incoming-runtime-sandbox'));
    await _testOnly.handleMessage(adapter, inboundMessage(address, '/network on', 'incoming-runtime-network'));
    await _testOnly.handleMessage(adapter, inboundMessage(address, '/m ask', 'incoming-runtime-invalid-mode'));
    await _testOnly.handleMessage(adapter, inboundMessage(address, '/status', 'incoming-runtime-status'));

    const session = store.getSession(binding.codepilotSessionId);
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.mode, 'yolo');
    assert.equal(session?.preferred_mode, 'yolo');
    assert.equal(session?.codex_provider, 'tmux');
    assert.equal(session?.codex_sandbox_mode, 'danger-full-access');
    assert.equal(session?.codex_network_access, true);

    const invalidModeText = adapter.sent.at(-2)?.text || '';
    assert.match(invalidModeText, /模式用法/);
    assert.match(invalidModeText, /normal\|yolo/);

    const statusText = adapter.sent.at(-1)?.text || '';
    assert.match(statusText, /当前会话/);
    assert.match(statusText, /yolo/);
    assert.match(statusText, /tmux/);
    assert.match(statusText, /danger-full-access/);
    assert.match(statusText, /enabled/);
    assert.match(statusText, /当前聊天正在使用 IM 会话/);
    assert.doesNotMatch(statusText, /还没有绑定桌面会话/);
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
