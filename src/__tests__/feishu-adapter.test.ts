import './test-setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FeishuAdapter, _testOnly } from '../lib/bridge/adapters/feishu-adapter.js';

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('feishu-adapter structured streaming regions', () => {
  it('passes an HTTPS proxy agent to the Feishu WS client options', () => {
    const httpInstance = {} as any;
    const options = _testOnly.buildWsClientOptions(
      'app-id',
      'app-secret',
      'https://open.feishu.cn',
      'feishu',
      { HTTPS_PROXY: 'http://proxy.example.test:8118' },
      httpInstance,
    );

    assert.equal(options.appId, 'app-id');
    assert.equal(options.appSecret, 'app-secret');
    assert.equal(options.httpInstance, httpInstance);
    assert.ok(options.agent, 'expected WS proxy agent');
    assert.equal(typeof (options.agent as { addRequest?: unknown }).addRequest, 'function');
  });

  it('respects NO_PROXY per Feishu proxy target', () => {
    const env = {
      HTTPS_PROXY: 'http://proxy.example.test:8118',
      NO_PROXY: 'open.feishu.cn',
    };

    assert.equal(_testOnly.getProxyUrlForUrl('https://open.feishu.cn/open-apis/bot/v3/info', env), undefined);
    assert.equal(
      _testOnly.getProxyUrlForUrl('wss://pbbot-ws.feishu.cn/ws', env),
      'http://proxy.example.test:8118',
    );
  });

  it('respects wildcard NO_PROXY when resolving the Feishu WS proxy', () => {
    const proxyUrl = _testOnly.getWsProxyUrl('feishu', {
      HTTPS_PROXY: 'http://proxy.example.test:8118',
      NO_PROXY: '.feishu.cn',
    });

    assert.equal(proxyUrl, undefined);
  });

  it('prefers WSS_PROXY for Feishu websocket targets', () => {
    const proxyUrl = _testOnly.getWsProxyUrl('feishu', {
      HTTPS_PROXY: 'http://https-proxy.example.test:8118',
      WSS_PROXY: 'http://wss-proxy.example.test:8118',
    });

    assert.equal(proxyUrl, 'http://wss-proxy.example.test:8118');
  });

  it('adds proxy agents to Feishu SDK HTTP requests', async () => {
    const requests: Array<Record<string, any>> = [];
    const baseHttpInstance = {
      request: async (options: Record<string, any>) => {
        requests.push(options);
        return { ok: true };
      },
    } as any;
    const httpInstance = _testOnly.buildHttpInstanceWithEnvProxy(
      'feishu',
      { HTTPS_PROXY: 'http://proxy.example.test:8118' },
      baseHttpInstance,
    );

    await httpInstance.request({
      method: 'post',
      url: 'https://open.feishu.cn/callback/ws/endpoint',
      data: {},
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].proxy, false);
    assert.equal(typeof requests[0].httpsAgent?.addRequest, 'function');
  });

  it('does not add HTTP proxy agents when NO_PROXY matches the request target', async () => {
    const requests: Array<Record<string, any>> = [];
    const baseHttpInstance = {
      request: async (options: Record<string, any>) => {
        requests.push(options);
        return { ok: true };
      },
    } as any;
    const httpInstance = _testOnly.buildHttpInstanceWithEnvProxy(
      'feishu',
      {
        HTTPS_PROXY: 'http://proxy.example.test:8118',
        NO_PROXY: '.feishu.cn',
      },
      baseHttpInstance,
    );

    await httpInstance.request({
      method: 'post',
      url: 'https://open.feishu.cn/callback/ws/endpoint',
      data: {},
    });

    assert.equal(requests.length, 1);
    assert.equal(requests[0].proxy, undefined);
    assert.equal(requests[0].httpsAgent, undefined);
  });

  it('masks proxy credentials in logs', () => {
    assert.equal(
      _testOnly.maskProxyUrl('http://user:secret@proxy.example.test:8118/path?token=abc'),
      'http://***:***@proxy.example.test:8118/path?token=abc',
    );
  });

  it('preserves Feishu post code blocks as fenced markdown', () => {
    const parsed = _testOnly.parseFeishuPostContent(JSON.stringify({
      title: '',
      content: [
        [{ tag: 'text', text: 'before', style: [] }],
        [{ tag: 'code_block', language: 'rust', text: 'KEY=AHAHAHAH' }],
        [{ tag: 'text', text: 'after', style: [] }],
      ],
    }));

    assert.equal(parsed.imageKeys.length, 0);
    assert.equal(parsed.warnings.length, 0);
    assert.match(parsed.extractedText, /before/);
    assert.match(parsed.extractedText, /```rust\nKEY=AHAHAHAH\n```/);
    assert.match(parsed.extractedText, /after/);
  });

  it('renders Feishu post titles as markdown H1 headings', () => {
    const parsed = _testOnly.parseFeishuPostContent(JSON.stringify({
      title: '标题',
      content: [
        [{ tag: 'text', text: 'bridge已启动那句，能不能带个标题', style: [] }],
      ],
    }));

    assert.equal(parsed.imageKeys.length, 0);
    assert.equal(parsed.warnings.length, 0);
    assert.equal(parsed.extractedText, '# 标题\n\nbridge已启动那句，能不能带个标题');
  });

  it('keeps unsupported Feishu post elements visible and reports parse warnings', () => {
    const parsed = _testOnly.parseFeishuPostContent(JSON.stringify({
      title: '',
      content: [
        [{ tag: 'text', text: 'before', style: [] }],
        [{ tag: 'unsupported_widget', value: 'secret' }],
      ],
    }));

    assert.match(parsed.extractedText, /before/);
    assert.match(parsed.extractedText, /\[unsupported Feishu post element: unsupported_widget\]/);
    assert.deepEqual(parsed.warnings, ['暂不支持飞书富文本元素：unsupported_widget']);
  });

  it('replies with a user-visible notice for unsupported Feishu message types', async () => {
    const replies: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {},
    });
    (adapter as any).restClient = {
      im: {
        message: {
          reply: async (payload: Record<string, any>) => {
            replies.push(payload);
            return { data: { message_id: 'notice-1' } };
          },
        },
      },
    };

    await (adapter as any).processIncomingEvent({
      sender: {
        sender_type: 'user',
        sender_id: { open_id: 'user-1' },
      },
      message: {
        message_id: 'msg-sticker-1',
        chat_id: 'chat-1',
        chat_type: 'p2p',
        message_type: 'sticker',
        content: '{"sticker_key":"sticker-1"}',
        create_time: '1780209968114',
      },
    });

    assert.equal(replies.length, 1);
    assert.equal(replies[0].path.message_id, 'msg-sticker-1');
    assert.equal(replies[0].data.msg_type, 'text');
    const content = JSON.parse(replies[0].data.content);
    assert.match(content.text, /暂不支持飞书消息类型：sticker/);
    assert.match(content.text, /不会转发给 Codex/);
    assert.equal(await adapter.consumeOne(), null);
  });

  it('does not add typing reactions while starting or ending a stream', async () => {
    const reactionCreateCalls: Array<Record<string, any>> = [];
    const reactionDeleteCalls: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).lastIncomingMessageId.set('chat-1', 'incoming-1');
    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async () => ({ data: { card_id: 'card-1' } }),
            settings: async () => ({}),
            update: async () => ({}),
          },
          cardElement: {
            content: async () => ({}),
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'card-message-1' } }),
          reply: async () => ({ data: { message_id: 'card-message-1' } }),
        },
        messageReaction: {
          create: async (payload: Record<string, any>) => {
            reactionCreateCalls.push(payload);
            return { data: { reaction_id: `reaction-${reactionCreateCalls.length}` } };
          },
          delete: async (payload: Record<string, any>) => {
            reactionDeleteCalls.push(payload);
            return {};
          },
        },
      },
    };

    adapter.onMessageStart('chat-1', 'stream-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    adapter.onMessageEnd('chat-1', 'stream-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(reactionCreateCalls.length, 0);
    assert.equal(reactionDeleteCalls.length, 0);
  });

  it('adds a completed reaction to the finalized streaming card message', async () => {
    const reactionCreateCalls: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async () => ({ data: { card_id: 'card-1' } }),
            settings: async () => ({}),
            update: async () => ({}),
          },
          cardElement: {
            content: async () => ({}),
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'card-message-1' } }),
          reply: async () => ({ data: { message_id: 'card-message-1' } }),
        },
        messageReaction: {
          create: async (payload: Record<string, any>) => {
            reactionCreateCalls.push(payload);
            return {};
          },
        },
      },
    };

    await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    const finalized = await adapter.onStreamEnd('chat-1', 'completed', '最终回复', 'stream-1');

    assert.equal(finalized, true);
    assert.deepEqual(reactionCreateCalls, [{
      path: { message_id: 'card-message-1' },
      data: { reaction_type: { emoji_type: 'DONE' } },
    }]);
  });

  it('adds an error reaction to the finalized streaming card message on failure', async () => {
    const reactionCreateCalls: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async () => ({ data: { card_id: 'card-1' } }),
            settings: async () => ({}),
            update: async () => ({}),
          },
          cardElement: {
            content: async () => ({}),
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'card-message-1' } }),
          reply: async () => ({ data: { message_id: 'card-message-1' } }),
        },
        messageReaction: {
          create: async (payload: Record<string, any>) => {
            reactionCreateCalls.push(payload);
            return {};
          },
        },
      },
    };

    await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    const finalized = await adapter.onStreamEnd('chat-1', 'error', '执行失败', 'stream-1');

    assert.equal(finalized, true);
    assert.deepEqual(reactionCreateCalls, [{
      path: { message_id: 'card-message-1' },
      data: { reaction_type: { emoji_type: 'WAIL' } },
    }]);
  });

  it('creates the streaming card with dedicated content, tasks, tools, and status elements', async () => {
    const createdCards: Array<Record<string, any>> = [];
    const createCalls: Array<Record<string, any>> = [];
    const replyCalls: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async ({ data }: { data: { data: string } }) => {
              const parsed = JSON.parse(data.data);
              createdCards.push(parsed);
              return { data: { card_id: 'card-1' } };
            },
            settings: async () => ({}),
            update: async () => ({}),
          },
          cardElement: {
            content: async () => ({}),
          },
        },
      },
      im: {
        message: {
          create: async (payload: Record<string, any>) => {
            createCalls.push(payload);
            return { data: { message_id: 'msg-1' } };
          },
          reply: async (payload: Record<string, any>) => {
            replyCalls.push(payload);
            return { data: { message_id: 'msg-1' } };
          },
        },
      },
    };

    const created = await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    assert.equal(created, true);
    assert.equal(createCalls.length, 0);
    assert.equal(replyCalls.length, 1);
    assert.deepEqual(replyCalls[0]?.path, { message_id: 'reply-1' });

    const elements = createdCards[0]?.body?.elements || [];
    assert.equal(elements.length, 4);
    assert.equal(elements[0]?.element_id, 'streaming_content');
    assert.equal(elements[1]?.element_id, 'streaming_tasks');
    assert.equal(elements[1]?.content, '');
    assert.equal(elements[2]?.element_id, 'streaming_tools');
    assert.equal(elements[2]?.content, '');
    assert.equal(elements[3]?.element_id, 'streaming_status');
    assert.equal(elements[3]?.content, '处理中');
  });

  it('updates the dedicated status element without mutating the main content area', async () => {
    const elementUpdates: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async () => ({ data: { card_id: 'card-1' } }),
            settings: async () => ({}),
            update: async () => ({}),
          },
          cardElement: {
            content: async (payload: Record<string, any>) => {
              elementUpdates.push(payload);
              return {};
            },
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'msg-1' } }),
          reply: async () => ({ data: { message_id: 'msg-1' } }),
        },
      },
    };

    await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    adapter.onStreamStatus('chat-1', '已运行 10秒，上次响应距今 10秒', 'stream-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(elementUpdates.some((update) =>
      update.path?.element_id === 'streaming_status'
      && update.data?.content === '已运行 10秒，上次响应距今 10秒'));
    assert.ok(elementUpdates.every((update) =>
      update.path?.element_id !== 'streaming_content'
      && update.path?.element_id !== 'streaming_tools'));
  });

  it('periodically refreshes the whole streaming card without sending a new message', async () => {
    const elementUpdates: Array<Record<string, any>> = [];
    const cardUpdateCalls: Array<Record<string, any>> = [];
    const createCalls: Array<Record<string, any>> = [];
    const replyCalls: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).cardFullRefreshIntervalMs = 1;
    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async () => ({ data: { card_id: 'card-1' } }),
            settings: async () => ({}),
            update: async (payload: Record<string, any>) => {
              cardUpdateCalls.push(payload);
              return {};
            },
          },
          cardElement: {
            content: async (payload: Record<string, any>) => {
              elementUpdates.push(payload);
              return {};
            },
          },
        },
      },
      im: {
        message: {
          create: async (payload: Record<string, any>) => {
            createCalls.push(payload);
            return { data: { message_id: 'msg-1' } };
          },
          reply: async (payload: Record<string, any>) => {
            replyCalls.push(payload);
            return { data: { message_id: 'msg-1' } };
          },
        },
      },
    };

    await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    const state = (adapter as any).activeCards.get('stream-1');
    state.lastFullRefreshAttemptAt = Date.now() - 10;

    adapter.onStreamStatus('chat-1', '已运行 5分，上次响应距今 2分', 'stream-1');
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(createCalls.length, 0);
    assert.equal(replyCalls.length, 1);
    assert.equal(cardUpdateCalls.length, 1);
    assert.equal(elementUpdates.length, 0);

    const body = JSON.parse(cardUpdateCalls[0]?.data?.card?.data || '{}');
    const elements = body.body?.elements || [];
    assert.equal(body.config?.streaming_mode, true);
    assert.equal(elements[3]?.element_id, 'streaming_status');
    assert.equal(elements[3]?.content, '已运行 5分，上次响应距今 2分');
    assert.equal(state.renderedStatusText, '已运行 5分，上次响应距今 2分');
  });

  it('falls back to element updates when periodic whole-card refresh fails', async () => {
    const elementUpdates: Array<Record<string, any>> = [];
    const cardUpdateCalls: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).cardFullRefreshIntervalMs = 1;
    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async () => ({ data: { card_id: 'card-1' } }),
            settings: async () => ({}),
            update: async (payload: Record<string, any>) => {
              cardUpdateCalls.push(payload);
              throw new Error('whole-card refresh failed');
            },
          },
          cardElement: {
            content: async (payload: Record<string, any>) => {
              elementUpdates.push(payload);
              return {};
            },
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'msg-1' } }),
          reply: async () => ({ data: { message_id: 'msg-1' } }),
        },
      },
    };

    await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    const state = (adapter as any).activeCards.get('stream-1');
    state.lastFullRefreshAttemptAt = Date.now() - 10;

    adapter.onStreamStatus('chat-1', '已运行 5分，上次响应距今 2分', 'stream-1');
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(cardUpdateCalls.length, 1);
    assert.ok(elementUpdates.some((update) =>
      update.path?.element_id === 'streaming_status'
      && update.data?.content === '已运行 5分，上次响应距今 2分'));
    assert.equal(state.renderedStatusText, '已运行 5分，上次响应距今 2分');
  });

  it('updates tool calls in the dedicated tools region instead of the main content area', async () => {
    const elementUpdates: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async () => ({ data: { card_id: 'card-1' } }),
            settings: async () => ({}),
            update: async () => ({}),
          },
          cardElement: {
            content: async (payload: Record<string, any>) => {
              elementUpdates.push(payload);
              return {};
            },
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'msg-1' } }),
          reply: async () => ({ data: { message_id: 'msg-1' } }),
        },
      },
    };

    await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    adapter.onToolEvent('chat-1', [{ id: 'tool-1', name: 'shell_command', status: 'running' }], 'stream-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(elementUpdates.some((update) =>
      update.path?.element_id === 'streaming_tools'
      && String(update.data?.content || '').includes('shell_command')));
    assert.ok(elementUpdates.every((update) =>
      update.path?.element_id !== 'streaming_content'
      && update.path?.element_id !== 'streaming_status'));
  });

  it('updates task progress in the dedicated tasks region instead of the main content area', async () => {
    const elementUpdates: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async () => ({ data: { card_id: 'card-1' } }),
            settings: async () => ({}),
            update: async () => ({}),
          },
          cardElement: {
            content: async (payload: Record<string, any>) => {
              elementUpdates.push(payload);
              return {};
            },
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'msg-1' } }),
          reply: async () => ({ data: { message_id: 'msg-1' } }),
        },
      },
    };

    await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    adapter.onTaskEvent('chat-1', [
      { text: '拆分 bridge manager', status: 'in_progress' },
      { text: '补一期回归测试', status: 'pending' },
    ], 'stream-1');
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.ok(elementUpdates.some((update) =>
      update.path?.element_id === 'streaming_tasks'
      && String(update.data?.content || '').includes('拆分 bridge manager')));
    assert.ok(elementUpdates.every((update) =>
      update.path?.element_id !== 'streaming_content'
      && update.path?.element_id !== 'streaming_status'));
  });

  it('continues updating later regions when one element update fails', async () => {
    const elementUpdates: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async () => ({ data: { card_id: 'card-1' } }),
            settings: async () => ({}),
            update: async () => ({}),
          },
          cardElement: {
            content: async (payload: Record<string, any>) => {
              elementUpdates.push(payload);
              if (payload.path?.element_id === 'streaming_tools') {
                throw new Error('tools failed');
              }
              return {};
            },
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'msg-1' } }),
          reply: async () => ({ data: { message_id: 'msg-1' } }),
        },
      },
    };

    await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    const state = (adapter as any).activeCards.get('stream-1');
    state.toolCalls = [{ id: 'tool-1', name: 'shell_command', status: 'running' }];
    state.pendingStatusText = '已运行 10秒，上次响应距今 10秒';

    await (adapter as any).flushCardUpdate('stream-1');

    assert.deepEqual(
      elementUpdates.map((update) => update.path?.element_id),
      ['streaming_tools', 'streaming_status'],
    );
    assert.equal(state.renderedToolsText, '');
    assert.equal(state.renderedStatusText, '已运行 10秒，上次响应距今 10秒');
  });

  it('releases the flush queue after a timed-out update so later refreshes can continue', async () => {
    const elementUpdates: Array<Record<string, any>> = [];
    const blocked = createDeferred<Record<string, any>>();
    let callCount = 0;
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).cardRequestTimeoutMs = 5;
    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async () => ({ data: { card_id: 'card-1' } }),
            settings: async () => ({}),
            update: async () => ({}),
          },
          cardElement: {
            content: async (payload: Record<string, any>) => {
              elementUpdates.push(payload);
              callCount += 1;
              if (callCount === 1) {
                return blocked.promise;
              }
              return {};
            },
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'msg-1' } }),
          reply: async () => ({ data: { message_id: 'msg-1' } }),
        },
      },
    };

    await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    adapter.onStreamText('chat-1', '第一段输出', 'stream-1');
    await new Promise((resolve) => setTimeout(resolve, 20));

    adapter.onStreamStatus('chat-1', '已运行 0分20秒', 'stream-1');
    await new Promise((resolve) => setTimeout(resolve, 20));

    const state = (adapter as any).activeCards.get('stream-1');
    assert.equal(Boolean(state.flushInFlight), false);
    assert.ok(elementUpdates.some((update) =>
      update.path?.element_id === 'streaming_status'
      && update.data?.content === '已运行 0分20秒'));
    assert.equal(state.lastFlushError, null);
    assert.equal(state.consecutiveFlushFailures, 0);

    blocked.resolve({});
  });

  it('finalizes a streaming card instead of hanging behind a stuck flush', async () => {
    const blocked = createDeferred<Record<string, any>>();
    const cardSettingsCalls: Array<Record<string, any>> = [];
    const cardUpdateCalls: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).cardRequestTimeoutMs = 5;
    (adapter as any).cardFinalizeFlushWaitExtraMs = 5;
    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async () => ({ data: { card_id: 'card-1' } }),
            settings: async (payload: Record<string, any>) => {
              cardSettingsCalls.push(payload);
              return {};
            },
            update: async (payload: Record<string, any>) => {
              cardUpdateCalls.push(payload);
              return {};
            },
          },
          cardElement: {
            content: async () => ({}),
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'msg-1' } }),
          reply: async () => ({ data: { message_id: 'msg-1' } }),
        },
      },
    };

    await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    const state = (adapter as any).activeCards.get('stream-1');
    state.flushInFlight = blocked.promise;
    state.flushQueued = true;

    const finalized = await adapter.onStreamEnd('chat-1', 'interrupted', '用户执行 /stop，已停止当前任务。', 'stream-1');

    assert.equal(finalized, true);
    assert.equal(cardSettingsCalls.length, 1);
    assert.equal(cardUpdateCalls.length, 1);
    assert.equal((adapter as any).activeCards.has('stream-1'), false);

    blocked.resolve({});
  });

  it('renders action buttons on streaming cards and keeps them disabled after finalization', async () => {
    const cardCreateCalls: Array<Record<string, any>> = [];
    const cardUpdateCalls: Array<Record<string, any>> = [];
    const logs: unknown[][] = [];
    const oldLog = console.log;
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    console.log = (...args: unknown[]) => {
      logs.push(args);
      oldLog(...args);
    };
    try {
      (adapter as any).restClient = {
        cardkit: {
          v1: {
            card: {
              create: async (payload: Record<string, any>) => {
                cardCreateCalls.push(payload);
                return { data: { card_id: 'card-1' } };
              },
              settings: async () => ({}),
              update: async (payload: Record<string, any>) => {
                cardUpdateCalls.push(payload);
                return {};
              },
            },
            cardElement: {
              content: async () => ({}),
            },
          },
        },
        im: {
          message: {
            create: async () => ({ data: { message_id: 'msg-1' } }),
            reply: async () => ({ data: { message_id: 'msg-1' } }),
          },
        },
      };

      adapter.onStreamActions('chat-1', [[{
        text: '停止',
        callbackData: 'tmux-screen:stop:session-1',
        type: 'danger',
      }]], 'stream-1');
      await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');

      const initialCardJson = String(cardCreateCalls[0]?.data?.data || '');
      const initialCard = JSON.parse(initialCardJson);
      const initialButton = initialCard.body?.elements?.[5]?.columns?.[0]?.elements?.[0];
      assert.match(initialCardJson, /"tag":"button"/);
      assert.match(initialCardJson, /"content":"停止"/);
      assert.match(initialCardJson, /"callback_data":"tmux-screen:stop:session-1"/);
      assert.equal(initialButton?.behaviors?.[0]?.type, 'callback');
      assert.equal(initialButton?.behaviors?.[0]?.value?.callback_data, 'tmux-screen:stop:session-1');

      adapter.onStreamActions('chat-1', [[{
        text: '已停止',
        callbackData: 'tmux-screen:stop:session-1',
        type: 'default',
        disabled: true,
      }]], 'stream-1');

      const finalized = await adapter.onStreamEnd('chat-1', 'interrupted', '已停止 tmux 屏幕定时刷新。', 'stream-1');
      const finalCardJson = String(cardUpdateCalls.at(-1)?.data?.card?.data || '');
      const finalCard = JSON.parse(finalCardJson);
      const finalButton = finalCard.body?.elements?.at(-1)?.columns?.[0]?.elements?.[0];

      assert.equal(finalized, true);
      assert.match(finalCardJson, /"content":"已停止"/);
      assert.match(finalCardJson, /"callback_data":"tmux-screen:stop:session-1"/);
      assert.match(finalCardJson, /"disabled":true/);
      assert.equal(finalButton?.behaviors?.[0]?.type, 'callback');
      assert.equal(finalButton?.behaviors?.[0]?.value?.callback_data, 'tmux-screen:stop:session-1');
      assert.ok(logs.some((entry) => entry[0] === '[feishu-adapter] Streaming card actions updated:'));
      assert.ok(logs.some((entry) => entry[0] === '[feishu-adapter] Creating streaming card with actions:'));
      assert.ok(logs.some((entry) => entry[0] === '[feishu-adapter] Streaming card full refresh included actions:'));
    } finally {
      console.log = oldLog;
    }
  });

  it('applies stream actions that arrive while the thinking card is being created', async () => {
    const cardCreateCalls: Array<Record<string, any>> = [];
    const cardUpdateCalls: Array<Record<string, any>> = [];
    const createBlocked = createDeferred<{ data: { card_id: string } }>();
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async (payload: Record<string, any>) => {
              cardCreateCalls.push(payload);
              return createBlocked.promise;
            },
            update: async (payload: Record<string, any>) => {
              cardUpdateCalls.push(payload);
              return {};
            },
          },
          cardElement: {
            content: async () => ({}),
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'msg-1' } }),
          reply: async () => ({ data: { message_id: 'msg-1' } }),
        },
      },
    };

    const createPromise = (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    await Promise.resolve();
    adapter.onStreamActions('chat-1', [[{
      text: '停止',
      callbackData: 'cti-command:session-1:%2Fstop',
      type: 'danger',
    }]], 'stream-1');
    createBlocked.resolve({ data: { card_id: 'card-1' } });

    assert.equal(await createPromise, true);
    const initialCardJson = String(cardCreateCalls[0]?.data?.data || '');
    assert.doesNotMatch(initialCardJson, /"content":"停止"/);

    const state = (adapter as any).activeCards.get('stream-1');
    assert.ok(state?.flushInFlight);
    await state.flushInFlight;

    const refreshCardJson = String(cardUpdateCalls.at(-1)?.data?.card?.data || '');
    assert.match(refreshCardJson, /"content":"停止"/);
    assert.match(refreshCardJson, /"callback_data":"cti-command:session-1:%2Fstop"/);
  });

  it('renders final cards without waiting tasks or running tools after completion', async () => {
    const cardUpdateCalls: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async () => ({ data: { card_id: 'card-1' } }),
            settings: async () => ({}),
            update: async (payload: Record<string, any>) => {
              cardUpdateCalls.push(payload);
              return {};
            },
          },
          cardElement: {
            content: async () => ({}),
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'msg-1' } }),
          reply: async () => ({ data: { message_id: 'msg-1' } }),
        },
      },
    };

    await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    adapter.onTaskEvent('chat-1', [
      { text: '读取日志', status: 'completed' },
      { text: '补测试', status: 'pending' },
    ], 'stream-1');
    adapter.onToolEvent('chat-1', [
      { id: 'tool-1', name: 'shell_command', status: 'running' },
    ], 'stream-1');

    const finalized = await adapter.onStreamEnd('chat-1', 'completed', '最终回复', 'stream-1');
    const finalCardJson = String(cardUpdateCalls[0]?.data?.card?.data || '');

    assert.equal(finalized, true);
    assert.doesNotMatch(finalCardJson, /等待中|运行中/);
    assert.match(finalCardJson, /补测试（已结束）/);
    assert.match(finalCardJson, /`shell_command`/);
  });

  it('releases a timed-out card creation attempt so a later retry can recreate the stream card', async () => {
    const blocked = createDeferred<Record<string, any>>();
    let createCallCount = 0;
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).cardRequestTimeoutMs = 5;
    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async () => {
              createCallCount += 1;
              if (createCallCount === 1) {
                return blocked.promise;
              }
              return { data: { card_id: `card-${createCallCount}` } };
            },
            settings: async () => ({}),
            update: async () => ({}),
          },
          cardElement: {
            content: async () => ({}),
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'msg-1' } }),
          reply: async () => ({ data: { message_id: 'msg-1' } }),
        },
      },
    };

    const first = await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    assert.equal(first, false);
    assert.equal((adapter as any).cardCreatePromises.size, 0);

    const second = await (adapter as any).createStreamingCard('chat-1', 'reply-1', 'stream-1');
    assert.equal(second, true);
    assert.equal(createCallCount, 2);
    assert.equal((adapter as any).activeCards.has('stream-1'), true);

    blocked.resolve({});
  });

  it('sends the first updatable rich command card as a reply', async () => {
    const cardCreateCalls: Array<Record<string, any>> = [];
    const messageCreateCalls: Array<Record<string, any>> = [];
    const messageReplyCalls: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
      },
    });

    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            create: async (payload: Record<string, any>) => {
              cardCreateCalls.push(payload);
              return { data: { card_id: 'card-rich-1' } };
            },
            update: async () => ({}),
          },
        },
      },
      im: {
        message: {
          create: async (payload: Record<string, any>) => {
            messageCreateCalls.push(payload);
            return { data: { message_id: 'msg-rich-create' } };
          },
          reply: async (payload: Record<string, any>) => {
            messageReplyCalls.push(payload);
            return { data: { message_id: 'msg-rich-reply' } };
          },
        },
      },
    };

    const result = await adapter.send({
      address: { channelType: 'feishu', chatId: 'chat-1' },
      text: '最近本地 Codex 会话',
      parseMode: 'Markdown',
      replyToMessageId: 'incoming-1',
      richCard: {
        title: '最近 1 条本地 Codex 会话',
        sections: [],
        updateKey: 'thread-card:global:feishu:chat-1',
        updateTtlMs: null,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(cardCreateCalls.length, 1);
    assert.equal(messageCreateCalls.length, 0);
    assert.equal(messageReplyCalls.length, 1);
    assert.deepEqual(messageReplyCalls[0]?.path, { message_id: 'incoming-1' });
    assert.equal(messageReplyCalls[0]?.data?.msg_type, 'interactive');
  });

  it('recovers an updatable rich command card by callback message id before updating it', async () => {
    const idConvertCalls: Array<Record<string, any>> = [];
    const cardUpdateCalls: Array<Record<string, any>> = [];
    const messageCreateCalls: Array<Record<string, any>> = [];
    const messageReplyCalls: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
      },
    });

    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            idConvert: async (payload: Record<string, any>) => {
              idConvertCalls.push(payload);
              return { data: { card_id: 'card-recovered' } };
            },
            create: async () => {
              throw new Error('should not create a new card');
            },
            update: async (payload: Record<string, any>) => {
              cardUpdateCalls.push(payload);
              return {};
            },
          },
        },
      },
      im: {
        message: {
          create: async (payload: Record<string, any>) => {
            messageCreateCalls.push(payload);
            return { data: { message_id: 'msg-create' } };
          },
          reply: async (payload: Record<string, any>) => {
            messageReplyCalls.push(payload);
            return { data: { message_id: 'msg-reply' } };
          },
        },
      },
    };

    const result = await adapter.send({
      address: { channelType: 'feishu', chatId: 'chat-1' },
      text: '当前线程已切换',
      parseMode: 'Markdown',
      replyToMessageId: 'card-message-1',
      richCardUpdateMessageId: 'card-message-1',
      richCard: {
        title: '当前聊天绑定（1）',
        sections: [],
        updateKey: 'thread-card:bound:feishu:chat-1',
        updateTtlMs: null,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.messageId, 'card-message-1');
    assert.deepEqual(idConvertCalls[0]?.data, { message_id: 'card-message-1' });
    assert.equal(cardUpdateCalls.length, 1);
    assert.deepEqual(cardUpdateCalls[0]?.path, { card_id: 'card-recovered' });
    assert.equal(messageCreateCalls.length, 0);
    assert.equal(messageReplyCalls.length, 0);
  });

  it('keeps /t rich card update state eligible when local TTL is disabled', async () => {
    const idConvertCalls: Array<Record<string, any>> = [];
    const cardUpdateCalls: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
      },
    });
    (adapter as any).richCardUpdates.set('thread-card:bound:feishu:chat-1', {
      cardId: 'card-old',
      messageId: 'card-message-1',
      lastInteractionAt: Date.now() - 24 * 60 * 60_000,
      sequence: 3,
    });

    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            idConvert: async (payload: Record<string, any>) => {
              idConvertCalls.push(payload);
              return { data: { card_id: 'card-recovered' } };
            },
            create: async () => {
              throw new Error('should not create a new card');
            },
            update: async (payload: Record<string, any>) => {
              cardUpdateCalls.push(payload);
              return {};
            },
          },
        },
      },
      im: {
        message: {
          create: async () => ({ data: { message_id: 'msg-create' } }),
          reply: async () => ({ data: { message_id: 'msg-reply' } }),
        },
      },
    };

    const result = await adapter.send({
      address: { channelType: 'feishu', chatId: 'chat-1' },
      text: '当前线程已切换',
      parseMode: 'Markdown',
      replyToMessageId: 'card-message-1',
      richCardUpdateMessageId: 'card-message-1',
      richCard: {
        title: '当前聊天绑定（1）',
        sections: [],
        updateKey: 'thread-card:bound:feishu:chat-1',
        updateTtlMs: null,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.messageId, 'card-message-1');
    assert.equal(idConvertCalls.length, 0);
    assert.equal(cardUpdateCalls.length, 1);
    assert.deepEqual(cardUpdateCalls[0]?.path, { card_id: 'card-old' });
  });

  it('does not create a replacement /t rich card when callback card recovery fails', async () => {
    const cardCreateCalls: Array<Record<string, any>> = [];
    const messageCreateCalls: Array<Record<string, any>> = [];
    const messageReplyCalls: Array<Record<string, any>> = [];
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
      },
    });

    (adapter as any).restClient = {
      cardkit: {
        v1: {
          card: {
            idConvert: async () => ({ data: {} }),
            create: async (payload: Record<string, any>) => {
              cardCreateCalls.push(payload);
              return { data: { card_id: 'new-card' } };
            },
            update: async () => ({}),
          },
        },
      },
      im: {
        message: {
          create: async (payload: Record<string, any>) => {
            messageCreateCalls.push(payload);
            return { data: { message_id: 'msg-create' } };
          },
          reply: async (payload: Record<string, any>) => {
            messageReplyCalls.push(payload);
            return { data: { message_id: 'msg-reply' } };
          },
        },
      },
    };

    const result = await adapter.send({
      address: { channelType: 'feishu', chatId: 'chat-1' },
      text: '当前线程已切换',
      parseMode: 'Markdown',
      replyToMessageId: 'card-message-1',
      richCardUpdateMessageId: 'card-message-1',
      richCard: {
        title: '当前聊天绑定（1）',
        sections: [],
        updateKey: 'thread-card:bound:feishu:chat-1',
        updateTtlMs: null,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(cardCreateCalls.length, 0);
    assert.equal(messageCreateCalls.length, 0);
    assert.equal(messageReplyCalls.length, 1);
    assert.equal(messageReplyCalls[0]?.data?.msg_type, 'post');
    assert.deepEqual(messageReplyCalls[0]?.path, { message_id: 'card-message-1' });
  });

  it('returns an error instead of hanging forever when plain text sending times out', async () => {
    const blocked = createDeferred<Record<string, any>>();
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
        streamingEnabled: true,
      },
    });

    (adapter as any).cardRequestTimeoutMs = 5;
    (adapter as any).restClient = {
      im: {
        message: {
          create: async () => blocked.promise,
        },
      },
    };

    const result = await (adapter as any).sendAsPlainText('chat-1', 'hello');
    assert.equal(result.ok, false);
    assert.match(result.error || '', /timeout/i);

    blocked.resolve({});
  });

  it('extracts the original Feishu resource filename from message content', () => {
    const info = _testOnly.extractFeishuResourceInfo(JSON.stringify({
      file_key: 'file_v3_abc',
      file_name: '需求说明 2026.pdf',
    }));

    assert.deepEqual(info, {
      fileKey: 'file_v3_abc',
      name: '需求说明 2026.pdf',
    });
  });

  it('preserves the original filename for downloaded Feishu file messages', async () => {
    const adapter = new FeishuAdapter({
      id: 'feishu-default',
      provider: 'feishu',
      enabled: true,
      alias: '飞书',
      config: {
        appId: 'app-id',
        appSecret: 'app-secret',
      },
    });

    (adapter as any).restClient = {
      im: {
        messageResource: {
          get: async () => ({
            getReadableStream: async function* () {
              yield Buffer.from('hello');
            },
          }),
        },
      },
    };

    const attachment = await (adapter as any).downloadResource(
      'message-1',
      'file_v3_abc',
      'file',
      '需求说明 2026.pdf',
    );

    assert.ok(attachment);
    assert.equal(attachment.name, '需求说明 2026.pdf');
    assert.equal(attachment.type, 'application/octet-stream');
    assert.equal(attachment.data, Buffer.from('hello').toString('base64'));
  });
});
