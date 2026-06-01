import './test-setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BaseChannelAdapter, type StructuredStreamingUiMetadata } from '../lib/bridge/channel-adapter.js';
import { initBridgeContext } from '../lib/bridge/context.js';
import { createMirrorFeedbackController } from '../lib/bridge/mirror-feedback-controller.js';
import { createMirrorSubscription } from '../lib/bridge/mirror-subscription-state.js';
import { consumeMirrorRecords } from '../lib/bridge/mirror-turns.js';
import type { InboundMessage, OutboundMessage, SendResult, TaskProgressInfo, ToolCallInfo } from '../lib/bridge/types.js';
import { JsonFileStore } from '../store.js';

class FakeMirrorFeishuAdapter extends BaseChannelAdapter {
  readonly channelType = 'feishu-default';
  readonly provider = 'feishu';
  readonly texts: string[] = [];
  readonly statuses: string[] = [];
  readonly streamEnds: Array<{ status: 'completed' | 'interrupted' | 'error'; text: string }> = [];
  readonly tools: ToolCallInfo[][] = [];
  readonly tasks: TaskProgressInfo[][] = [];
  readonly metadata: Array<{ chatId: string; streamKey?: string; metadata: StructuredStreamingUiMetadata }> = [];
  private active = false;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  isRunning(): boolean { return true; }
  consumeOne(): Promise<InboundMessage | null> { return Promise.resolve(null); }
  send(_message: OutboundMessage): Promise<SendResult> { return Promise.resolve({ ok: true }); }
  validateConfig(): string | null { return null; }
  isAuthorized(): boolean { return true; }

  supportsStructuredStreamingUi(): boolean {
    return true;
  }

  hasActiveStreamingUi(): boolean {
    return this.active;
  }

  onMirrorStreamStart(): void {
    this.active = true;
  }

  onStreamMetadata(chatId: string, metadata: StructuredStreamingUiMetadata, streamKey?: string): void {
    this.metadata.push({ chatId, streamKey, metadata });
  }

  onStreamText(_chatId: string, text: string): void {
    this.active = true;
    this.texts.push(text);
  }

  onStreamStatus(_chatId: string, statusText: string): void {
    this.active = true;
    this.statuses.push(statusText);
  }

  onToolEvent(_chatId: string, tools: ToolCallInfo[]): void {
    this.tools.push(tools.map((tool) => ({ ...tool })));
  }

  onTaskEvent(_chatId: string, tasks: TaskProgressInfo[]): void {
    this.tasks.push(tasks.map((task) => ({ ...task })));
  }

  onStreamEnd(_chatId: string, status: 'completed' | 'interrupted' | 'error', text: string): Promise<boolean> {
    this.streamEnds.push({ status, text });
    this.active = false;
    return Promise.resolve(true);
  }
}

describe('mirror-feedback-controller', () => {
  it('builds mirror stream card title and tags from subscription metadata', () => {
    initBridgeContext({
      store: new JsonFileStore(new Map([
        ['bridge_channel_instances_json', JSON.stringify([
          { id: 'feishu-default', provider: 'feishu', alias: 'Feishu', enabled: true, config: {} },
        ])],
      ])),
      llm: {
        streamChat() {
          return new ReadableStream({
            start(controller) {
              controller.close();
            },
          });
        },
      },
      permissions: {
        resolvePendingPermission: () => false,
      },
      lifecycle: {},
    });

    const adapter = new FakeMirrorFeishuAdapter();
    const baseMs = Date.parse('2026-05-14T00:00:00.000Z');
    const controller = createMirrorFeedbackController({
      getAdapter: () => adapter,
      getThreadTitle: () => 'Mirror Thread',
      nowIso: () => new Date(baseMs).toISOString(),
      eventBatchLimit: 10,
      deliverResponse: async () => ({ ok: true }),
    });
    const subscription = createMirrorSubscription({
      bindingId: 'binding-123456789',
      sessionId: 'session-123456789',
      channelType: 'feishu-default',
      chatId: 'chat-1',
      threadId: 'thread-123456789',
      filePath: 'rollout.jsonl',
      lastDeliveredAt: null,
    });

    consumeMirrorRecords(subscription, [
      {
        signature: 'message-1',
        type: 'message',
        role: 'assistant',
        content: '第一段输出',
        timestamp: new Date(baseMs).toISOString(),
        turnId: 'turn-1',
      },
    ], controller.hooks);

    assert.equal(adapter.metadata.length, 1);
    assert.equal(adapter.metadata[0]?.chatId, 'chat-1');
    assert.equal(adapter.metadata[0]?.streamKey, 'mirror:session-123456789:turn-1');
    assert.equal(adapter.metadata[0]?.metadata.title, 'Mirror Thread');
    assert.deepEqual(adapter.metadata[0]?.metadata.tags, [
      'binding_id:binding-',
      'mirror',
    ]);
  });

  it('keeps last response age visible when mirror tool progress updates the status area', () => {
    initBridgeContext({
      store: new JsonFileStore(new Map([
        ['bridge_channel_instances_json', JSON.stringify([
          { id: 'feishu-default', provider: 'feishu', alias: 'Feishu', enabled: true, config: {} },
        ])],
      ])),
      llm: {
        streamChat() {
          return new ReadableStream({
            start(controller) {
              controller.close();
            },
          });
        },
      },
      permissions: {
        resolvePendingPermission: () => false,
      },
      lifecycle: {},
    });

    const adapter = new FakeMirrorFeishuAdapter();
    const baseMs = Date.parse('2026-05-14T00:00:00.000Z');
    let nowMs = baseMs;
    const originalDateNow = Date.now;
    Date.now = () => nowMs;

    try {
      const controller = createMirrorFeedbackController({
        getAdapter: () => adapter,
        getThreadTitle: () => '测试线程',
        getStructuredStreamStatusConfig: () => ({
          idleStartMs: 10_000,
          heartbeatMs: 10_000,
        }),
        nowIso: () => new Date(nowMs).toISOString(),
        eventBatchLimit: 10,
        deliverResponse: async () => ({ ok: true }),
      });
      const subscription = createMirrorSubscription({
        bindingId: 'binding-1',
        sessionId: 'session-1',
        channelType: 'feishu-default',
        chatId: 'chat-1',
        threadId: 'thread-1',
        filePath: 'rollout.jsonl',
        lastDeliveredAt: null,
      });

      consumeMirrorRecords(subscription, [
        {
          signature: 'start-1',
          type: 'task_started',
          content: '',
          timestamp: new Date(baseMs).toISOString(),
          turnId: 'turn-1',
        },
        {
          signature: 'message-1',
          type: 'message',
          role: 'assistant',
          content: '第一段输出',
          timestamp: new Date(baseMs).toISOString(),
          turnId: 'turn-1',
        },
      ], controller.hooks);

      nowMs = baseMs + 15_000;
      consumeMirrorRecords(subscription, [
        {
          signature: 'tool-1',
          type: 'tool_started',
          content: '',
          timestamp: new Date(nowMs).toISOString(),
          turnId: 'turn-1',
          toolId: 'tool-1',
          toolName: 'Bash',
        },
      ], controller.hooks);

      assert.equal(adapter.statuses.at(-1), '已运行 15秒，上次响应距今 15秒');
    } finally {
      Date.now = originalDateNow;
    }
  });

  it('passes the global tool detail setting into mirror tool rendering', () => {
    initBridgeContext({
      store: new JsonFileStore(new Map([
        ['bridge_channel_instances_json', JSON.stringify([
          { id: 'feishu-default', provider: 'feishu', alias: 'Feishu', enabled: true, config: {} },
        ])],
      ])),
      llm: {
        streamChat() {
          return new ReadableStream({
            start(controller) {
              controller.close();
            },
          });
        },
      },
      permissions: {
        resolvePendingPermission: () => false,
      },
      lifecycle: {},
    });

    const adapter = new FakeMirrorFeishuAdapter();
    let showToolCallDetails = true;
    const baseMs = Date.parse('2026-05-14T00:00:00.000Z');
    const controller = createMirrorFeedbackController({
      getAdapter: () => adapter,
      getThreadTitle: () => '测试线程',
      getShowToolCallDetails: () => showToolCallDetails,
      nowIso: () => new Date(baseMs).toISOString(),
      eventBatchLimit: 10,
      deliverResponse: async () => ({ ok: true }),
    });
    const subscription = createMirrorSubscription({
      bindingId: 'binding-1',
      sessionId: 'session-1',
      channelType: 'feishu-default',
      chatId: 'chat-1',
      threadId: 'thread-1',
      filePath: 'rollout.jsonl',
      lastDeliveredAt: null,
    });

    consumeMirrorRecords(subscription, [
      {
        signature: 'tool-start-1',
        type: 'tool_started',
        content: '',
        timestamp: new Date(baseMs).toISOString(),
        turnId: 'turn-1',
        toolId: 'tool-1',
        toolName: 'Bash',
        toolInput: { command: 'pwd' },
      },
      {
        signature: 'tool-end-1',
        type: 'tool_finished',
        content: '/tmp/project',
        timestamp: new Date(baseMs + 1000).toISOString(),
        turnId: 'turn-1',
        toolId: 'tool-1',
      },
    ], controller.hooks);

    assert.equal(adapter.tools.at(-1)?.[0]?.input, 'pwd');
    assert.equal(adapter.tools.at(-1)?.[0]?.output, '/tmp/project');

    showToolCallDetails = false;
    const hiddenSubscription = createMirrorSubscription({
      bindingId: 'binding-2',
      sessionId: 'session-2',
      channelType: 'feishu-default',
      chatId: 'chat-1',
      threadId: 'thread-2',
      filePath: 'rollout.jsonl',
      lastDeliveredAt: null,
    });
    consumeMirrorRecords(hiddenSubscription, [
      {
        signature: 'tool-start-2',
        type: 'tool_started',
        content: '',
        timestamp: new Date(baseMs).toISOString(),
        turnId: 'turn-1',
        toolId: 'tool-1',
        toolName: 'Bash',
        toolInput: { command: 'pwd' },
      },
      {
        signature: 'tool-end-2',
        type: 'tool_finished',
        content: '/tmp/project',
        timestamp: new Date(baseMs + 1000).toISOString(),
        turnId: 'turn-1',
        toolId: 'tool-1',
      },
    ], controller.hooks);

    assert.equal(adapter.tools.at(-1)?.[0]?.input, null);
    assert.equal(adapter.tools.at(-1)?.[0]?.output, null);
  });

  it('shows mirror context and turn token usage in the stream status area and final card', async () => {
    initBridgeContext({
      store: new JsonFileStore(new Map([
        ['bridge_channel_instances_json', JSON.stringify([
          { id: 'feishu-default', provider: 'feishu', alias: 'Feishu', enabled: true, config: {} },
        ])],
      ])),
      llm: {
        streamChat() {
          return new ReadableStream({
            start(controller) {
              controller.close();
            },
          });
        },
      },
      permissions: {
        resolvePendingPermission: () => false,
      },
      lifecycle: {},
    });

    const adapter = new FakeMirrorFeishuAdapter();
    const baseMs = Date.parse('2026-05-14T00:00:00.000Z');
    const controller = createMirrorFeedbackController({
      getAdapter: () => adapter,
      getThreadTitle: () => '测试线程',
      nowIso: () => new Date(baseMs).toISOString(),
      eventBatchLimit: 10,
      deliverResponse: async () => ({ ok: true }),
    });
    const subscription = createMirrorSubscription({
      bindingId: 'binding-1',
      sessionId: 'session-1',
      channelType: 'feishu-default',
      chatId: 'chat-1',
      threadId: 'thread-1',
      filePath: 'rollout.jsonl',
      lastDeliveredAt: null,
    });

    const finalized = consumeMirrorRecords(subscription, [
      {
        signature: 'start-1',
        type: 'task_started',
        content: '',
        timestamp: new Date(baseMs).toISOString(),
        turnId: 'turn-1',
      },
      {
        signature: 'usage-1',
        type: 'context_usage',
        content: '',
        timestamp: new Date(baseMs + 1000).toISOString(),
        turnId: 'turn-1',
        contextUsage: {
          modelContextWindow: 200_000,
          lastTokenUsage: {
            inputTokens: 125_300,
            outputTokens: 4_600,
          },
        },
      },
      {
        signature: 'complete-1',
        type: 'task_complete',
        content: '最终回答',
        timestamp: new Date(baseMs + 2000).toISOString(),
        turnId: 'turn-1',
      },
    ], controller.hooks);

    assert.match(adapter.statuses.at(-1) || '', /125k\(63%\)/);
    assert.match(adapter.statuses.at(-1) || '', /↑125k ↓4\.6k/);
    await controller.deliverMirrorTurns(subscription, finalized);
    assert.equal(adapter.streamEnds[0]?.status, 'completed');
    assert.match(adapter.streamEnds[0]?.text || '', /最终回答/);
    assert.match(adapter.streamEnds[0]?.text || '', /Context: 125k\(63%\) · ↑125k ↓4\.6k/);
  });
});
