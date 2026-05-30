import test from 'node:test';
import assert from 'node:assert/strict';

import { buildStreamContextTags } from '../lib/bridge/streaming-metadata.js';

test('buildStreamContextTags emits binding identity and stream mode tags', () => {
  assert.deepEqual(buildStreamContextTags({
    bindingId: 'binding-123456789',
    bridgeSessionId: 'bridge-session-123456789',
    codexThreadId: 'codex-thread-123456789',
    executionProvider: 'tmux',
    creatorKind: 'vscode',
    source: 'sdk',
  }), [
    'binding_id:binding-',
    'sdk',
  ]);
});
