import './test-setup.js';
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import fs from 'node:fs';
import { loadConfig } from '../config.js';
import { _testOnly, registerAdapter } from '../lib/bridge/bridge-manager.js';
import type { LLMProvider, StreamChatParams } from '../lib/bridge/host.js';
import {
  initBridgeTestContext,
  inboundMessage,
  makeBridgeSettings,
  RecordingAdapter,
  resetBridgeTestState,
  writeDesktopSessionJsonlFixture,
} from './test-bridge-utils.js';

interface RecordedLlmCall {
  sessionId: string;
  sdkSessionId: string;
  prompt: string;
}

interface ControlledLlmCall extends RecordedLlmCall {
  controller: ReadableStreamDefaultController<string>;
}

function waitForCondition(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error('Timed out waiting for condition.'));
        return;
      }
      setTimeout(poll, 5);
    };
    poll();
  });
}

function createRecordingLlm(calls: RecordedLlmCall[]): LLMProvider {
  return {
    streamChat(params: StreamChatParams): ReadableStream<string> {
      calls.push({
        sessionId: params.sessionId,
        sdkSessionId: params.sdkSessionId || '',
        prompt: params.prompt,
      });
      return new ReadableStream({
        start(controller) {
          controller.enqueue(`data: ${JSON.stringify({ type: 'text', data: `回复：${params.prompt}` })}\n`);
          controller.enqueue(`data: ${JSON.stringify({ type: 'result', data: JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }) })}\n`);
          controller.close();
        },
      });
    },
  };
}

function createControlledLlm(calls: ControlledLlmCall[]): LLMProvider {
  return {
    streamChat(params: StreamChatParams): ReadableStream<string> {
      return new ReadableStream({
        start(controller) {
          calls.push({
            sessionId: params.sessionId,
            sdkSessionId: params.sdkSessionId || '',
            prompt: params.prompt,
            controller,
          });
        },
      });
    },
  };
}

function finishControlledCall(call: ControlledLlmCall, responseText: string): void {
  call.controller.enqueue(`data: ${JSON.stringify({ type: 'text', data: responseText })}\n`);
  call.controller.enqueue(`data: ${JSON.stringify({ type: 'result', data: JSON.stringify({ usage: { input_tokens: 1, output_tokens: 1 } }) })}\n`);
  call.controller.close();
}

function appendDesktopMirrorTurn(filePath: string, params: {
  timestampPrefix: string;
  turnId: string;
  userText: string;
  assistantText: string;
}): void {
  fs.appendFileSync(filePath, [
    {
      timestamp: `${params.timestampPrefix}:01.000Z`,
      type: 'event_msg',
      payload: {
        type: 'task_started',
        turn_id: params.turnId,
      },
    },
    {
      timestamp: `${params.timestampPrefix}:02.000Z`,
      type: 'event_msg',
      payload: {
        type: 'user_message',
        message: params.userText,
      },
    },
    {
      timestamp: `${params.timestampPrefix}:03.000Z`,
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: params.assistantText }],
      },
    },
    {
      timestamp: `${params.timestampPrefix}:04.000Z`,
      type: 'event_msg',
      payload: {
        type: 'task_complete',
        turn_id: params.turnId,
        last_agent_message: params.assistantText,
      },
    },
  ].map((line) => JSON.stringify(line)).join('\n') + '\n', 'utf-8');
}

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

  afterEach(() => {
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

  it('routes normal messages to the active binding across a user multi-binding flow', async () => {
    const llmCalls: RecordedLlmCall[] = [];
    const store = initBridgeTestContext({
      dynamicSettings: true,
      llm: createRecordingLlm(llmCalls),
    });
    const adapter = new RecordingAdapter();
    const address = { channelType: 'feishu', chatId: 'chat-multi-binding-e2e' } as const;
    const workDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-multi-a-'));
    const workDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-multi-b-'));

    await _testOnly.handleMessage(adapter, inboundMessage(address, `/new ${workDirA}`, 'incoming-new-a'));
    const bindingA = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(bindingA);
    assert.equal(bindingA.workingDirectory, workDirA);
    assert.match(adapter.sent.at(-1)?.text || '', /已新建会话/);

    await _testOnly.handleMessage(adapter, inboundMessage(address, 'A 的第一条普通消息', 'incoming-a-1'));
    assert.equal(llmCalls.length, 1);
    assert.equal(llmCalls[0].sessionId, bindingA.codepilotSessionId);
    assert.equal(llmCalls[0].prompt, 'A 的第一条普通消息');

    await _testOnly.handleMessage(adapter, inboundMessage(address, `/new ${workDirB}`, 'incoming-new-b'));
    const bindingB = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(bindingB);
    assert.notEqual(bindingB.id, bindingA.id);
    assert.equal(bindingB.workingDirectory, workDirB);
    assert.match(adapter.sent.at(-1)?.text || '', /已新建会话/);

    const afterNewBindings = store.listChannelBindings().filter((binding) => (
      binding.channelType === address.channelType && binding.chatId === address.chatId
    ));
    assert.equal(afterNewBindings.length, 2);
    assert.equal(afterNewBindings.find((binding) => binding.id === bindingA.id)?.active, false);
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, bindingB.id);

    await _testOnly.handleMessage(adapter, inboundMessage(address, 'B 的第一条普通消息', 'incoming-b-1'));
    assert.equal(llmCalls.length, 2);
    assert.equal(llmCalls[1].sessionId, bindingB.codepilotSessionId);
    assert.equal(llmCalls[1].prompt, 'B 的第一条普通消息');

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/t ls', 'incoming-ls'));
    const listText = adapter.sent.at(-1)?.text || '';
    assert.match(listText, /当前聊天绑定/);
    assert.match(listText, new RegExp(bindingA.id.slice(0, 8)));
    assert.match(listText, new RegExp(bindingB.id.slice(0, 8)));

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/t use 1', 'incoming-use-a'));
    const activeBindingA = store.getChannelBinding(address.channelType, address.chatId);
    assert.equal(activeBindingA?.id, bindingA.id);
    assert.match(adapter.sent.at(-1)?.text || '', /当前线程已切换/);

    await _testOnly.handleMessage(adapter, inboundMessage(address, '切回 A 后的普通消息', 'incoming-a-2'));
    assert.equal(llmCalls.length, 3);
    assert.equal(llmCalls[2].sessionId, bindingA.codepilotSessionId);
    assert.equal(llmCalls[2].prompt, '切回 A 后的普通消息');

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/t use 2', 'incoming-use-b'));
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, bindingB.id);

    await _testOnly.handleMessage(adapter, inboundMessage(address, '再切回 B 后的普通消息', 'incoming-b-2'));
    assert.equal(llmCalls.length, 4);
    assert.equal(llmCalls[3].sessionId, bindingB.codepilotSessionId);
    assert.equal(llmCalls[3].prompt, '再切回 B 后的普通消息');

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/t rm 2', 'incoming-rm-b'));
    assert.equal(store.listChannelBindings().filter((binding) => binding.chatId === address.chatId).length, 1);
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, bindingA.id);
    assert.match(adapter.sent.at(-1)?.text || '', /已移除绑定线程/);
  });

  it('applies desktop thread card buttons to the currently selected dropdown option', async () => {
    const store = initBridgeTestContext({ dynamicSettings: true });
    const adapter = new RecordingAdapter();
    const address = { channelType: 'feishu', chatId: 'chat-thread-card-actions' } as const;
    const threadId = '33333333-3333-4333-8333-333333333333';
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-thread-card-'));
    writeDesktopSessionJsonlFixture({
      threadId,
      workDir,
      lines: [{
        timestamp: '2026-05-28T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: threadId,
          timestamp: '2026-05-28T00:00:00.000Z',
          cwd: workDir,
          originator: 'Codex CLI',
        },
      }],
    });

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/t', 'incoming-thread-card-list'));
    const card = adapter.sent.at(-1)?.richCard;
    assert.ok(card);
    assert.match(card.updateKey || '', /^thread-card:global:/);
    assert.equal(card.updateTtlMs, null);
    const selectCallback = card.selects?.[0]?.options?.[0]?.callbackData;
    const bindCallback = card.actions?.[0]?.[0]?.callbackData;
    assert.ok(selectCallback);
    assert.ok(bindCallback);

    await _testOnly.handleMessage(adapter, {
      ...inboundMessage(address, '', 'reply-1'),
      callbackData: selectCallback,
      callbackMessageId: 'reply-1',
    });
    await _testOnly.handleMessage(adapter, {
      ...inboundMessage(address, '', 'reply-1'),
      callbackData: bindCallback,
      callbackMessageId: 'reply-1',
    });

    const binding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(binding);
    assert.equal(binding.sdkSessionId, threadId);
    assert.match(adapter.sent.at(-1)?.text || '', /已添加并激活线程/);
    assert.ok(adapter.sent.at(-1)?.richCard);
    assert.match(adapter.sent.at(-1)?.richCard?.updateKey || '', /^thread-card:global:/);
    assert.equal(adapter.sent.at(-1)?.richCard?.updateTtlMs, null);
    assert.equal(adapter.sent.at(-1)?.richCardUpdateMessageId, 'reply-1');
    assert.equal(adapter.sent.at(-1)?.richCard?.selects?.[0]?.selectedCallbackData, selectCallback);
  });

  it('keeps renamed thread titles identical in /current and /t dropdown surfaces', async () => {
    initBridgeTestContext({ dynamicSettings: true });
    const adapter = new RecordingAdapter();
    const address = { channelType: 'feishu', chatId: 'chat-thread-title-sync' } as const;
    const threadId = '44444444-4444-4444-8444-444444444444';
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-title-sync-'));
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
          payload: { type: 'user_message', message: '原始桌面标题' },
        },
      ],
    });

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/t 1', 'incoming-title-bind'));
    await _testOnly.handleMessage(adapter, inboundMessage(address, '/t rename 统一后的标题', 'incoming-title-rename'));
    await _testOnly.handleMessage(adapter, inboundMessage(address, '/', 'incoming-title-current'));

    assert.match(adapter.sent.at(-1)?.text || '', /标题.*统一后的标题/s);

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/t', 'incoming-title-list'));
    const listMessage = adapter.sent.at(-1);
    assert.match(listMessage?.text || '', /统一后的标题/);
    assert.doesNotMatch(listMessage?.text || '', /原始桌面标题/);
    assert.equal(listMessage?.richCard?.table?.rows?.[0]?.title, '**统一后的标题**');
    assert.equal(String(listMessage?.richCard?.table?.rows?.[0]?.title || '').replace(/\*/g, ''), '统一后的标题');
    assert.equal(listMessage?.richCard?.selects?.[0]?.options?.[0]?.text, '1. 统一后的标题');
  });

  it('keeps SDK output from an inactive binding alive after /t use switches away', async () => {
    const llmCalls: ControlledLlmCall[] = [];
    const store = initBridgeTestContext({
      dynamicSettings: true,
      llm: createControlledLlm(llmCalls),
    });
    const adapter = new RecordingAdapter();
    const address = { channelType: 'feishu', chatId: 'chat-concurrent-sdk-e2e' } as const;
    const workDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-concurrent-a-'));
    const workDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-concurrent-b-'));

    await _testOnly.handleMessage(adapter, inboundMessage(address, `/new ${workDirA}`, 'incoming-concurrent-new-a'));
    const bindingA = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(bindingA);
    await _testOnly.handleMessage(adapter, inboundMessage(address, `/new ${workDirB}`, 'incoming-concurrent-new-b'));
    const bindingB = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(bindingB);

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/t use 1', 'incoming-concurrent-use-a'));
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, bindingA.id);

    const firstTurn = _testOnly.handleMessage(adapter, inboundMessage(address, 'A 长任务', 'incoming-concurrent-a'));
    await waitForCondition(() => llmCalls.length === 1);
    assert.equal(llmCalls[0].sessionId, bindingA.codepilotSessionId);

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/t use 2', 'incoming-concurrent-use-b'));
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, bindingB.id);
    assert.doesNotMatch(adapter.sent.at(-1)?.text || '', /当前会话仍在运行/);

    const secondTurn = _testOnly.handleMessage(adapter, inboundMessage(address, 'B 长任务', 'incoming-concurrent-b'));
    await waitForCondition(() => llmCalls.length === 2);
    assert.equal(llmCalls[1].sessionId, bindingB.codepilotSessionId);

    finishControlledCall(llmCalls[0], 'A 完成');
    finishControlledCall(llmCalls[1], 'B 完成');
    await Promise.all([firstTurn, secondTurn]);

    const sentText = adapter.sent.map((message) => message.text).join('\n\n');
    assert.match(sentText, /A 完成/);
    assert.match(sentText, /B 完成/);
    assert.doesNotMatch(sentText, /回复已跳过/);
  });

  it('keeps Feishu mirror output active for multiple bound desktop threads after /t use switches away', async () => {
    const store = initBridgeTestContext({ dynamicSettings: true });
    const adapter = new RecordingAdapter();
    registerAdapter(adapter);
    const bridgeState = (globalThis as unknown as Record<string, any>).__bridge_manager__;
    bridgeState.running = true;
    const address = { channelType: 'feishu', chatId: 'chat-concurrent-mirror-e2e' } as const;
    const threadA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const threadB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const workDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-mirror-a-'));
    const workDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-mirror-b-'));
    const fixtureA = writeDesktopSessionJsonlFixture({
      threadId: threadA,
      workDir: workDirA,
      lines: [{
        timestamp: '2026-05-28T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: threadA,
          timestamp: '2026-05-28T00:00:00.000Z',
          cwd: workDirA,
          originator: 'Codex CLI',
        },
      }],
    });
    const fixtureB = writeDesktopSessionJsonlFixture({
      threadId: threadB,
      workDir: workDirB,
      lines: [{
        timestamp: '2026-05-28T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: threadB,
          timestamp: '2026-05-28T00:00:00.000Z',
          cwd: workDirB,
          originator: 'Codex CLI',
        },
      }],
    });

    await _testOnly.handleMessage(adapter, inboundMessage(address, `/t ${threadA}`, 'incoming-mirror-bind-a'));
    const bindingA = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(bindingA);

    await _testOnly.handleMessage(adapter, inboundMessage(address, `/t add ${threadB}`, 'incoming-mirror-add-b'));
    const bindingsAfterAdd = store.listChannelBindings().filter((binding) => binding.chatId === address.chatId);
    const bindingB = bindingsAfterAdd.find((binding) => binding.sdkSessionId === threadB);
    assert.ok(bindingB);
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, bindingA.id);
    assert.equal(bindingB.active, false);

    await _testOnly.reconcileMirrorSubscriptions();
    assert.deepEqual(
      Array.from(bridgeState.mirrorSubscriptions.keys()).sort(),
      [bindingA.id, bindingB.id].sort(),
    );

    await _testOnly.handleMessage(adapter, inboundMessage(address, '/t use 2', 'incoming-mirror-use-b'));
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, bindingB.id);

    appendDesktopMirrorTurn(fixtureA.sessionPath, {
      timestampPrefix: '2026-05-28T00:01',
      turnId: 'turn-mirror-a',
      userText: 'A 桌面问题',
      assistantText: 'A mirror final',
    });
    appendDesktopMirrorTurn(fixtureB.sessionPath, {
      timestampPrefix: '2026-05-28T00:02',
      turnId: 'turn-mirror-b',
      userText: 'B 桌面问题',
      assistantText: 'B mirror final',
    });

    await _testOnly.reconcileMirrorSubscriptions();

    const sentText = adapter.sent.map((message) => message.text).join('\n\n');
    assert.match(sentText, /A 桌面问题/);
    assert.match(sentText, /A mirror final/);
    assert.match(sentText, /B 桌面问题/);
    assert.match(sentText, /B mirror final/);
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

      const beforeRoutingLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      await _testOnly.handleMessage(adapter, inboundMessage(address, '普通消息', 'incoming-runtime-plain'));
      await _testOnly.handleMessage(adapter, inboundMessage(address, '/goal 检查权限', 'incoming-runtime-unknown-command'));
      await _testOnly.handleMessage(adapter, inboundMessage(address, '//plan 下一步', 'incoming-runtime-escaped-command'));
      await _testOnly.handleMessage(adapter, inboundMessage(address, '/tmux /compact', 'incoming-runtime-tmux-command'));

      const unknownCommandResponse = adapter.sent.find((message) => message.text.includes('未知命令：/goal'))?.text || '';
      assert.match(unknownCommandResponse, /未知命令：\/goal/);
      const routedLog = fs.readFileSync(fakeTmux.logPath, 'utf-8').slice(beforeRoutingLog.length);
      assert.match(routedLog, new RegExp(`send-keys -t ${normalTmuxSession} -l 普通消息`));
      assert.doesNotMatch(routedLog, new RegExp(`send-keys -t ${normalTmuxSession} -l /goal 检查权限`));
      assert.match(routedLog, new RegExp(`send-keys -t ${normalTmuxSession} -l /plan 下一步`));
      assert.match(routedLog, new RegExp(`send-keys -t ${normalTmuxSession} -l /compact`));
      assert.ok((routedLog.match(new RegExp(`send-keys -t ${normalTmuxSession} Enter`, 'g')) || []).length >= 3);

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
    const threadId = '11111111-1111-4111-8111-111111111111';
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
    const threadId = '22222222-2222-4222-8222-222222222222';
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
