import './test-setup.js';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer } from 'ws';

import { CodexProvider } from '../codex/provider.js';
import { getSessionIndexPath } from '../codex/session-index/paths.js';
import { getCodexSessionByThreadIdSafe } from '../lib/bridge/bridge-session-support.js';
import { _testOnly, registerAdapter } from '../lib/bridge/bridge-manager.js';
import {
  initBridgeTestContext,
  inboundMessage,
  makeBridgeSettings,
  RecordingAdapter,
  resetBridgeTestState,
} from './test-bridge-utils.js';

const execFileAsync = promisify(execFile);

interface RecordedResponsesRequest {
  method: string;
  url: string;
  body: unknown;
  rawBody: string;
}

async function commandAvailable(command: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(command, args);
    return true;
  } catch {
    return false;
  }
}

async function waitForCondition(condition: () => boolean, timeoutMs: number, intervalMs = 250): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return condition();
}

function removeLineFromJsonl(filePath: string, predicate: (value: unknown, raw: string) => boolean): void {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
  const kept: string[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      kept.push(line);
      continue;
    }
    if (!predicate(parsed, line)) kept.push(line);
  }
  fs.writeFileSync(filePath, kept.length > 0 ? `${kept.join('\n')}\n` : '', 'utf-8');
}

function cleanupCodexThreadArtifacts(threadId: string, filePath: string): void {
  if (filePath) {
    fs.rmSync(filePath, { force: true });
  }
  removeLineFromJsonl(getSessionIndexPath(), (value, raw) => {
    if (raw.includes(threadId)) return true;
    return typeof value === 'object'
      && value !== null
      && (value as { id?: unknown }).id === threadId;
  });
}

function createResponsesEventStreamPayload(model: string): string {
  const now = Math.floor(Date.now() / 1000);
  const responseId = `resp_cti_${now}`;
  const itemId = `msg_cti_${now}`;
  const text = 'cti local proxy response';
  const events: Array<[string, unknown]> = [
    ['response.created', {
      type: 'response.created',
      response: { id: responseId, object: 'response', created_at: now, status: 'in_progress', model, output: [] },
    }],
    ['response.output_item.added', {
      type: 'response.output_item.added',
      output_index: 0,
      item: { id: itemId, type: 'message', status: 'in_progress', role: 'assistant', content: [] },
    }],
    ['response.content_part.added', {
      type: 'response.content_part.added',
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text: '' },
    }],
    ['response.output_text.delta', {
      type: 'response.output_text.delta',
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      delta: text,
    }],
    ['response.output_text.done', {
      type: 'response.output_text.done',
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      text,
    }],
    ['response.content_part.done', {
      type: 'response.content_part.done',
      item_id: itemId,
      output_index: 0,
      content_index: 0,
      part: { type: 'output_text', text },
    }],
    ['response.output_item.done', {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        id: itemId,
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [{ type: 'output_text', text }],
      },
    }],
    ['response.completed', {
      type: 'response.completed',
      response: {
        id: responseId,
        object: 'response',
        created_at: now,
        status: 'completed',
        model,
        output: [{
          id: itemId,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        }],
        usage: {
          input_tokens: 1,
          output_tokens: 4,
          total_tokens: 5,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    }],
  ];
  return events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('') + 'data: [DONE]\n\n';
}

async function startLocalResponsesProxy(): Promise<{
  baseUrl: string;
  requests: RecordedResponsesRequest[];
  close(): Promise<void>;
}> {
  const requests: RecordedResponsesRequest[] = [];
  const server = http.createServer((req, res) => {
    let rawBody = '';
    req.setEncoding('utf-8');
    req.on('data', (chunk) => {
      rawBody += chunk;
    });
    req.on('end', () => {
      let body: unknown = null;
      if (rawBody) {
        try {
          body = JSON.parse(rawBody) as unknown;
        } catch {
          body = rawBody;
        }
      }
      requests.push({
        method: req.method || '',
        url: req.url || '',
        body,
        rawBody,
      });

      if (req.method === 'POST' && req.url?.includes('/responses')) {
        const model = typeof body === 'object'
          && body !== null
          && typeof (body as { model?: unknown }).model === 'string'
          ? (body as { model: string }).model
          : 'gpt-5';
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.end(createResponsesEventStreamPayload(model));
        return;
      }

      if (req.method === 'GET' && req.url?.includes('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'gpt-5', object: 'model' }] }));
        return;
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not found' } }));
    });
  });
  const wss = new WebSocketServer({ server, path: '/v1/responses' });
  wss.on('connection', (ws, req) => {
    ws.on('message', (data) => {
      const rawBody = data.toString();
      let body: unknown = rawBody;
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        // keep raw body
      }
      requests.push({
        method: 'WS',
        url: req.url || '/v1/responses',
        body,
        rawBody,
      });
      const model = typeof body === 'object'
        && body !== null
        && typeof (body as { model?: unknown }).model === 'string'
        ? (body as { model: string }).model
        : 'gpt-5.4';
      const streamPayload = createResponsesEventStreamPayload(model)
        .split(/\n\n/)
        .map((chunk) => chunk.trim())
        .filter(Boolean);
      for (const chunk of streamPayload) {
        const dataLine = chunk.split(/\n/).find((line) => line.startsWith('data: '));
        if (!dataLine || dataLine === 'data: [DONE]') continue;
        ws.send(dataLine.slice('data: '.length));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () => new Promise((resolve, reject) => {
      wss.close(() => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }),
  };
}

describe('real codex tmux provider e2e', () => {
  it('routes a real multi-binding user story by /t ls active-time order', { timeout: 120_000 }, async (t: TestContext) => {
    if (process.env.CTI_REAL_CODEX_USER_STORY_E2E !== '1') {
      t.skip('set CTI_REAL_CODEX_USER_STORY_E2E=1 to run the real Codex multi-binding user story');
      return;
    }
    if (!(await commandAvailable('codex', ['--version']))) {
      t.skip('codex CLI is not available');
      return;
    }

    const previousEnv = {
      CODEX_HOME: process.env.CODEX_HOME,
      CTI_CODEX_BASE_URL: process.env.CTI_CODEX_BASE_URL,
      CTI_CODEX_API_KEY: process.env.CTI_CODEX_API_KEY,
      CODEX_API_KEY: process.env.CODEX_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      CTI_CODEX_SKIP_GIT_REPO_CHECK: process.env.CTI_CODEX_SKIP_GIT_REPO_CHECK,
    };
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-real-codex-home-'));
    const proxy = await startLocalResponsesProxy();
    process.env.CODEX_HOME = codexHome;
    process.env.CTI_CODEX_BASE_URL = proxy.baseUrl;
    process.env.CTI_CODEX_API_KEY = 'cti-local-proxy-key';
    process.env.CODEX_API_KEY = 'cti-local-proxy-key';
    process.env.OPENAI_API_KEY = 'cti-local-proxy-key';
    process.env.CTI_CODEX_SKIP_GIT_REPO_CHECK = 'true';

    resetBridgeTestState({ cleanCodexHome: true });
    _testOnly.resetStateForTests();

    const workDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-real-multi-a-'));
    const workDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-real-multi-b-'));
    const model = process.env.CTI_REAL_CODEX_USER_STORY_E2E_MODEL || 'gpt-5.4';
    const settings = makeBridgeSettings({
      bridge_default_provider: 'sdk',
      bridge_default_model: model,
      bridge_codex_reasoning_effort: 'low',
    });
    const store = initBridgeTestContext({
      settings,
      llm: new CodexProvider(),
    });
    const adapter = new RecordingAdapter();
    registerAdapter(adapter);
    const bridgeState = (globalThis as unknown as Record<string, any>).__bridge_manager__;
    bridgeState.running = true;
    const address = { channelType: 'feishu', chatId: `chat-real-multi-${process.pid}-${Date.now()}` } as const;
    const generatedThreadIds = new Set<string>();

    try {
      await _testOnly.handleMessage(adapter, inboundMessage(address, `/new real-a ${workDirA}`, 'incoming-real-multi-new-a'));
      const bindingA = store.getChannelBinding(address.channelType, address.chatId);
      assert.ok(bindingA);
      await _testOnly.handleMessage(adapter, inboundMessage(address, 'Reply with exactly: cti real multi A', 'incoming-real-multi-a-1'));
      await waitForCondition(() => proxy.requests.filter((request) => request.url.includes('/responses')).length >= 1, 30_000, 500);
      const threadA = store.getSession(bindingA.bridgeSessionId)?.codex_thread_id?.trim() || '';
      assert.match(threadA, /^[0-9a-f-]{20,}$/i);
      generatedThreadIds.add(threadA);

      await _testOnly.handleMessage(adapter, inboundMessage(address, `/new real-b ${workDirB}`, 'incoming-real-multi-new-b'));
      const bindingB = store.getChannelBinding(address.channelType, address.chatId);
      assert.ok(bindingB);
      assert.notEqual(bindingB.id, bindingA.id);
      await _testOnly.handleMessage(adapter, inboundMessage(address, 'Reply with exactly: cti real multi B', 'incoming-real-multi-b-1'));
      await waitForCondition(() => proxy.requests.filter((request) => request.url.includes('/responses')).length >= 2, 30_000, 500);
      const threadB = store.getSession(bindingB.bridgeSessionId)?.codex_thread_id?.trim() || '';
      assert.match(threadB, /^[0-9a-f-]{20,}$/i);
      generatedThreadIds.add(threadB);

      await _testOnly.handleMessage(adapter, inboundMessage(address, '/t ls', 'incoming-real-multi-ls'));
      const listText = adapter.sent.at(-1)?.text || '';
      assert.match(listText, /当前聊天绑定/);
      assert.ok(listText.indexOf('real-b') < listText.indexOf('real-a'));

      await _testOnly.handleMessage(adapter, inboundMessage(address, '/t use 2', 'incoming-real-multi-use-a'));
      assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, bindingA.id);
      await _testOnly.handleMessage(adapter, inboundMessage(address, 'Reply with exactly: cti real multi A again', 'incoming-real-multi-a-2'));
      await waitForCondition(() => proxy.requests.filter((request) => request.url.includes('/responses')).length >= 3, 30_000, 500);

      await _testOnly.handleMessage(adapter, inboundMessage(address, '/t ls', 'incoming-real-multi-ls-after-a'));
      const listAfterA = adapter.sent.at(-1)?.text || '';
      assert.ok(listAfterA.indexOf('real-a') < listAfterA.indexOf('real-b'));

      await _testOnly.handleMessage(adapter, inboundMessage(address, '/t use 2', 'incoming-real-multi-use-b'));
      assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, bindingB.id);

      const responseRequests = proxy.requests.filter((request) => request.url.includes('/responses'));
      assert.equal(responseRequests.some((request) => {
        const body = request.body as { model?: unknown };
        return body.model === model;
      }), true);
      assert.equal(responseRequests.some((request) => request.rawBody.includes('cti real multi A again')), true);
    } finally {
      for (const threadId of generatedThreadIds) {
        const filePath = getCodexSessionByThreadIdSafe(threadId, 'real multi-binding cleanup lookup')?.filePath || '';
        cleanupCodexThreadArtifacts(threadId, filePath);
      }
      fs.rmSync(workDirA, { recursive: true, force: true });
      fs.rmSync(workDirB, { recursive: true, force: true });
      fs.rmSync(codexHome, { recursive: true, force: true });
      await proxy.close().catch(() => undefined);
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      _testOnly.resetStateForTests();
    }
  });

  it('keeps the real bootstrapped Codex thread after tmux provider startup and mirror reconcile', { timeout: 120_000 }, async (t: TestContext) => {
    if (process.env.CTI_REAL_CODEX_TMUX_E2E !== '1') {
      t.skip('set CTI_REAL_CODEX_TMUX_E2E=1 to run the real Codex/tmux smoke test');
      return;
    }
    if (!(await commandAvailable('tmux', ['-V']))) {
      t.skip('tmux is not available');
      return;
    }
    if (!(await commandAvailable('codex', ['--version']))) {
      t.skip('codex CLI is not available');
      return;
    }

    const previousEnv = {
      CODEX_HOME: process.env.CODEX_HOME,
      CTI_CODEX_BASE_URL: process.env.CTI_CODEX_BASE_URL,
      CTI_CODEX_API_KEY: process.env.CTI_CODEX_API_KEY,
      CODEX_API_KEY: process.env.CODEX_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      CTI_CODEX_SKIP_GIT_REPO_CHECK: process.env.CTI_CODEX_SKIP_GIT_REPO_CHECK,
    };
    const codexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-real-codex-home-'));
    const proxy = await startLocalResponsesProxy();
    process.env.CODEX_HOME = codexHome;
    process.env.CTI_CODEX_BASE_URL = proxy.baseUrl;
    process.env.CTI_CODEX_API_KEY = 'cti-local-proxy-key';
    process.env.CODEX_API_KEY = 'cti-local-proxy-key';
    process.env.OPENAI_API_KEY = 'cti-local-proxy-key';
    process.env.CTI_CODEX_SKIP_GIT_REPO_CHECK = 'true';

    resetBridgeTestState({ cleanCodexHome: true });
    _testOnly.resetStateForTests();

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-real-tmux-provider-'));
    const model = process.env.CTI_REAL_CODEX_TMUX_E2E_MODEL || 'gpt-5.4';
    const settings = makeBridgeSettings({
      bridge_default_provider: 'tmux',
      bridge_default_model: model,
      bridge_codex_reasoning_effort: 'low',
    });
    const store = initBridgeTestContext({
      settings,
      llm: new CodexProvider(),
    });
    const adapter = new RecordingAdapter();
    registerAdapter(adapter);
    const bridgeState = (globalThis as unknown as Record<string, any>).__bridge_manager__;
    bridgeState.running = true;
    const address = { channelType: 'feishu', chatId: `chat-real-tmux-${process.pid}-${Date.now()}` } as const;
    let tmuxSessionName = '';
    let generatedThreadId = '';
    let generatedThreadFilePath = '';

    try {
      await _testOnly.handleMessage(adapter, inboundMessage(address, `/new ${workDir}`, 'incoming-real-new'));
      await _testOnly.handleMessage(adapter, inboundMessage(address, '/tmux-set enter on', 'incoming-real-enter-on'));
      await _testOnly.handleMessage(adapter, inboundMessage(address, 'Reply with exactly: cti real tmux smoke', 'incoming-real-first'));

      const binding = store.getChannelBinding(address.channelType, address.chatId);
      assert.ok(binding);
      const session = store.getSession(binding.bridgeSessionId);
      const threadId = session?.codex_thread_id?.trim() || '';
      generatedThreadId = threadId;
      tmuxSessionName = session?.tmux_session_name || '';
      assert.match(threadId, /^[0-9a-f-]{20,}$/i);
      assert.equal(tmuxSessionName, `codex_${threadId}`);

      await execFileAsync('tmux', ['has-session', '-t', tmuxSessionName]);

      const becameVisible = await waitForCondition(
        () => Boolean(getCodexSessionByThreadIdSafe(threadId, 'real tmux provider e2e')),
        15_000,
        500,
      );
      assert.equal(becameVisible, true, 'real Codex session JSONL should become visible');
      generatedThreadFilePath = getCodexSessionByThreadIdSafe(threadId, 'real tmux provider cleanup lookup')?.filePath || '';

      for (let i = 0; i < 3; i += 1) {
        await _testOnly.reconcileMirrorSubscriptions();
        assert.equal(store.getSession(binding.bridgeSessionId)?.codex_thread_id, threadId);
        await new Promise((resolve) => setTimeout(resolve, 2_500));
      }

      assert.equal(store.getSession(binding.bridgeSessionId)?.codex_thread_id, threadId);
      assert.equal(bridgeState.mirrorSubscriptions.get(binding.id)?.threadId, threadId);

      const sawModelRequest = await waitForCondition(
        () => proxy.requests.some((request) => request.url.includes('/responses')),
        20_000,
        500,
      );
      assert.equal(sawModelRequest, true, 'local Responses proxy should receive a real Codex model request');
      const responseRequests = proxy.requests.filter((request) => (
        request.url.includes('/responses')
      ));
      assert.equal(responseRequests.some((request) => {
        const body = request.body as { model?: unknown };
        return body.model === model;
      }), true);
      assert.equal(responseRequests.some((request) => {
        const body = request.body as { reasoning?: { effort?: unknown } };
        return body.reasoning?.effort === 'low';
      }), true);
      assert.equal(responseRequests.some((request) => (
        request.rawBody.includes('Initialize this Codex session and wait for the next instruction.')
      )), true);
    } finally {
      if (tmuxSessionName) {
        await execFileAsync('tmux', ['kill-session', '-t', tmuxSessionName]).catch(() => undefined);
      }
      if (generatedThreadId) {
        cleanupCodexThreadArtifacts(generatedThreadId, generatedThreadFilePath);
      }
      fs.rmSync(workDir, { recursive: true, force: true });
      fs.rmSync(codexHome, { recursive: true, force: true });
      await proxy.close().catch(() => undefined);
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      _testOnly.resetStateForTests();
    }
  });
});
