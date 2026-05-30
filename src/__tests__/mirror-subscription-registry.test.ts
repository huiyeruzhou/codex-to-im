import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildMirrorSubscriptionRegistryPlan } from '../lib/bridge/mirror-subscription-registry.js';

describe('mirror-subscription-registry', () => {
  it('keeps bindings that have a running channel and resolve to a Codex thread even when inactive', () => {
    const bindings = [
      {
        id: 'ignore-bridge-sdk-thread',
        channelType: 'feishu-default',
        bridgeSessionId: 'session-1',
      },
      {
        id: 'keep-from-session',
        channelType: 'feishu-default',
        bridgeSessionId: 'session-2',
      },
      {
        id: 'inactive',
        channelType: 'feishu-default',
        bridgeSessionId: 'session-3',
        active: false,
      },
      {
        id: 'missing-channel',
        channelType: 'weixin-default',
        bridgeSessionId: 'session-4',
      },
      {
        id: 'missing-thread',
        channelType: 'feishu-default',
        bridgeSessionId: 'session-5',
      },
    ];

    const plan = buildMirrorSubscriptionRegistryPlan(
      bindings,
      ['feishu-default'],
      [],
      (sessionId) => {
        if (sessionId === 'session-1') {
          return {};
        }
        if (sessionId === 'session-2') {
          return { codex_thread_id: 'thread-2' };
        }
        if (sessionId === 'session-3') {
          return { codex_thread_id: 'thread-3' };
        }
        if (sessionId === 'session-5') {
          return { codex_thread_id: '' };
        }
        return null;
      },
    );

    assert.deepEqual(
      plan.upsertBindings.map((binding) => binding.id),
      ['keep-from-session', 'inactive'],
    );
    assert.deepEqual(plan.removeBindingIds, []);
  });

  it('removes subscriptions that are no longer desired', () => {
    const plan = buildMirrorSubscriptionRegistryPlan(
      [
        {
          id: 'binding-1',
          channelType: 'feishu-default',
          bridgeSessionId: 'session-1',
        },
      ],
      ['feishu-default'],
      ['binding-1', 'binding-2', 'binding-3'],
      () => ({ codex_thread_id: 'thread-1' }),
    );

    assert.deepEqual(plan.upsertBindings.map((binding) => binding.id), ['binding-1']);
    assert.deepEqual(plan.removeBindingIds, ['binding-2', 'binding-3']);
  });
});
