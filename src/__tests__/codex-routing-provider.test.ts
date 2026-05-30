import './test-setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { CodexRoutingProvider } from '../codex/routing-provider.js';

function streamWithText(text: string): ReadableStream<string> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(text);
      controller.close();
    },
  });
}

async function readStream(stream: ReadableStream<string>): Promise<string> {
  let output = '';
  for await (const chunk of stream) {
    output += chunk;
  }
  return output;
}

describe('CodexRoutingProvider', () => {
  it('routes each request by the per-session provider choice', async () => {
    const provider = new CodexRoutingProvider(undefined, 'sdk') as any;
    const routed: string[] = [];
    provider.sdkProvider = {
      streamChat() {
        routed.push('sdk');
        return streamWithText('sdk-stream');
      },
    };
    provider.tmuxProvider = {
      streamChat() {
        routed.push('tmux');
        return streamWithText('tmux-stream');
      },
    };

    const sdkOutput = await readStream(provider.streamChat({
      prompt: 'hello',
      sessionId: 'session-sdk',
      codexProvider: 'sdk',
    }));
    const tmuxOutput = await readStream(provider.streamChat({
      prompt: 'hello',
      sessionId: 'session-tmux',
      codexProvider: 'tmux',
    }));
    const defaultOutput = await readStream(provider.streamChat({
      prompt: 'hello',
      sessionId: 'session-default',
    }));

    assert.deepEqual(routed, ['sdk', 'tmux', 'sdk']);
    assert.equal(sdkOutput, 'sdk-stream');
    assert.equal(tmuxOutput, 'tmux-stream');
    assert.equal(defaultOutput, 'sdk-stream');
  });
});
