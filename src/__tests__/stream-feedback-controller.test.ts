import './test-setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { pushStreamFeedbackActions } from '../lib/bridge/stream-feedback-controller.js';

describe('stream-feedback-controller', () => {
  it('stores action rows before starting structured stream UI', () => {
    const calls: string[] = [];
    const adapter = {
      onStreamActions() {
        calls.push('actions');
      },
    };

    const ok = pushStreamFeedbackActions({
      adapter: adapter as any,
      channelType: 'feishu',
      chatId: 'chat-1',
      streamKey: 'stream-1',
      ensureStarted() {
        calls.push('start');
      },
    }, [[{
      text: '停止',
      callbackData: 'cti-command:session-1:%2Fstop',
      type: 'danger',
    }]]);

    assert.equal(ok, true);
    assert.deepEqual(calls, ['actions', 'start']);
  });
});
