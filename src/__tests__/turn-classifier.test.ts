import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyInteractiveTurn,
  getCodexThreadId,
} from '../lib/bridge/turns/turn-classifier.js';
import type { BridgeSession } from '../lib/bridge/host.js';
import type { ChannelBinding } from '../lib/bridge/types.js';

function binding(overrides: Partial<ChannelBinding> = {}): ChannelBinding {
  return {
    id: 'binding-1',
    channelType: 'feishu-default',
    chatId: 'chat-1',
    bridgeSessionId: 'session-1',
    workingDirectory: '/tmp/project',
    model: 'gpt-test',
    mode: 'code',
    active: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<BridgeSession> = {}): BridgeSession {
  return {
    id: 'session-1',
    name: 'session',
    working_directory: '/tmp/project',
    model: 'gpt-test',
    ...overrides,
  };
}

describe('turn-classifier', () => {
  it('classifies pure IM SDK sessions even when a codex thread id exists', () => {
    const currentSession = session({
      codex_thread_id: 'codex-thread-1',
    });
    const result = classifyInteractiveTurn(
      binding(),
      currentSession,
      () => false,
    );

    assert.equal(result.kind, 'im_sdk');
    assert.equal(result.reason, 'bridge_thread');
    assert.equal(result.codexThreadId, 'codex-thread-1');
    assert.equal(result.codexThreadAvailable, false);
  });

  it('classifies sessions with a locally visible Codex thread as IM Codex reuse', () => {
    const currentSession = session({
      codex_thread_id: 'codex-thread-1',
    });
    const result = classifyInteractiveTurn(
      binding(),
      currentSession,
      (threadId) => threadId === 'codex-thread-1',
    );

    assert.equal(result.kind, 'im_codex_reuse');
    assert.equal(result.reason, 'codex_thread');
    assert.equal(result.codexThreadId, 'codex-thread-1');
    assert.equal(result.codexThreadAvailable, true);
  });

  it('treats sessions with missing local Codex thread files as plain SDK turns', () => {
    const currentSession = session({
      codex_thread_id: 'codex-missing',
    });
    const result = classifyInteractiveTurn(
      binding(),
      currentSession,
      () => false,
    );

    assert.equal(result.kind, 'im_sdk');
    assert.equal(result.reason, 'bridge_thread');
    assert.equal(result.codexThreadId, 'codex-missing');
    assert.equal(result.codexThreadAvailable, false);
  });

  it('does not read legacy thread fields from bindings or session fallbacks', () => {
    const currentSession = session({
      codex_thread_id: 'codex-thread-only',
    });

    assert.equal(getCodexThreadId(currentSession), 'codex-thread-only');
  });
});
