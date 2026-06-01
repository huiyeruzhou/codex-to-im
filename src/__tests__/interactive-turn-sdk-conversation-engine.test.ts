import './test-setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  processMessage,
  type SdkConversationRuntime,
} from '../lib/bridge/interactive-turn/sdk-conversation-engine.js';
import {
  buildConversationPromptText,
  buildLocalAttachmentPromptSupplement,
} from '../lib/bridge/interactive-turn/sdk-attachments.js';
import { appendStreamPreviewChunk } from '../lib/bridge/interactive-turn/sdk-stream-preview.js';
import { sseEvent } from '../sse-utils.js';
import { consumeSseEvents } from '../lib/bridge/sse-stream-decoder.js';
import {
  normalizeReasoningEffort,
  normalizeSandboxMode,
} from '../runtime-options.js';
import {
  initBridgeTestContext,
  makeBridgeSettings,
  resetBridgeTestState,
} from './test-bridge-utils.js';
import type { BridgeStore, LLMProvider } from '../lib/bridge/host.js';

function toolOnlyLlm(): LLMProvider {
  return {
    streamChat(): ReadableStream<string> {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(sseEvent('tool_use', {
            id: 'tool-1',
            name: 'Bash',
            input: { command: 'pwd' },
          }));
          controller.enqueue(sseEvent('tool_result', {
            tool_use_id: 'tool-1',
            content: '/tmp/project',
            is_error: false,
          }));
          controller.close();
        },
      });
    },
  };
}

function createTestSdkConversationRuntime(store: BridgeStore, llm: LLMProvider): SdkConversationRuntime {
  return {
    store,
    llm,
    consumeSseEvents,
    normalizeSandboxMode,
    normalizeReasoningEffort,
  };
}

describe('buildLocalAttachmentPromptSupplement', () => {
  it('returns an empty string when only images are present', () => {
    const result = buildLocalAttachmentPromptSupplement([
      {
        id: 'img-1',
        name: 'screenshot.png',
        type: 'image/png',
        size: 2048,
        filePath: 'D:\\work\\.codepilot-uploads\\screenshot.png',
      },
    ]);

    assert.equal(result, '');
  });

  it('includes local file paths for non-image attachments', () => {
    const result = buildLocalAttachmentPromptSupplement([
      {
        id: 'pdf-1',
        name: 'report.pdf',
        type: 'application/pdf',
        size: 40960,
        filePath: 'D:\\work\\.codepilot-uploads\\report.pdf',
      },
      {
        id: 'video-1',
        name: 'demo.mp4',
        type: 'video/mp4',
        size: 5 * 1024 * 1024,
        filePath: 'D:\\work\\.codepilot-uploads\\demo.mp4',
      },
    ]);

    assert.match(result, /Attached local files:/);
    assert.match(result, /report\.pdf/);
    assert.match(result, /application\/pdf/);
    assert.match(result, /D:\\work\\\.codepilot-uploads\\report\.pdf/);
    assert.match(result, /demo\.mp4/);
    assert.match(result, /video\/mp4/);
    assert.match(result, /extract frames or audio only when needed/i);
  });

  it('builds the effective conversation prompt including non-image attachment guidance', () => {
    const result = buildConversationPromptText('请帮我总结附件', [
      {
        id: 'pdf-1',
        name: 'report.pdf',
        type: 'application/pdf',
        size: 40960,
        filePath: 'D:\\work\\.codepilot-uploads\\report.pdf',
      },
    ]);

    assert.match(result, /^请帮我总结附件\n\nAttached local files:/);
    assert.match(result, /report\.pdf/);
    assert.match(result, /D:\\work\\\.codepilot-uploads\\report\.pdf/);
  });
});

describe('appendStreamPreviewChunk', () => {
  it('starts a new paragraph when text resumes after tool progress', () => {
    const result = appendStreamPreviewChunk('先检查文件', '然后继续说明', true);
    assert.equal(result, '先检查文件\n\n然后继续说明');
  });

  it('does not add an extra paragraph for continuous text chunks', () => {
    const result = appendStreamPreviewChunk('先检查', '文件', false);
    assert.equal(result, '先检查文件');
  });
});

describe('interactive-turn sdk-conversation-engine tool expansion', () => {
  it('can keep SDK tool calls out of persisted assistant content and stream preview', async () => {
    resetBridgeTestState();
    const llm = toolOnlyLlm();
    const store = initBridgeTestContext({
      settings: makeBridgeSettings({
        bridge_show_tool_call_details: 'false',
      }),
      llm,
    });
    const session = store.createSession('tool-expansion-test', '', undefined, '', 'normal');
    const binding = store.upsertChannelBinding({
      channelType: 'feishu',
      chatId: 'chat-tool-expansion',
      bridgeSessionId: session.id,
      workingDirectory: '',
      model: '',
      mode: 'normal',
    });

    const previews: string[] = [];
    const result = await processMessage(
      binding,
      'run a tool',
      undefined,
      undefined,
      undefined,
      (text) => previews.push(text),
      undefined,
      undefined,
      undefined,
      undefined,
      {
        expandToolCalls: false,
        streamPreview: {
          includeToolSnippets: true,
        },
      },
      createTestSdkConversationRuntime(store, llm),
    );

    assert.equal(result.responseText, '');
    assert.deepEqual(previews, []);

    const { messages } = store.getMessages(session.id);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.role, 'user');
  });

  it('expands SDK tool calls by default', async () => {
    resetBridgeTestState();
    const llm = toolOnlyLlm();
    const store = initBridgeTestContext({
      settings: makeBridgeSettings(),
      llm,
    });
    const session = store.createSession('tool-expansion-default-test', '', undefined, '', 'normal');
    const binding = store.upsertChannelBinding({
      channelType: 'feishu',
      chatId: 'chat-tool-expansion-default',
      bridgeSessionId: session.id,
      workingDirectory: '',
      model: '',
      mode: 'normal',
    });

    const previews: string[] = [];
    const result = await processMessage(
      binding,
      'run a tool',
      undefined,
      undefined,
      undefined,
      (text) => previews.push(text),
      undefined,
      undefined,
      undefined,
      undefined,
      {
        streamPreview: {
          includeToolSnippets: true,
        },
      },
      createTestSdkConversationRuntime(store, llm),
    );

    assert.equal(result.responseText, '');
    assert.match(previews.join('\n'), /Bash/);
    assert.match(previews.join('\n'), /pwd/);
    assert.match(previews.join('\n'), /\/tmp\/project/);

    const { messages } = store.getMessages(session.id);
    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.role, 'assistant');
    assert.match(messages[1]?.content || '', /"type":"tool_use"/);
    assert.match(messages[1]?.content || '', /"type":"tool_result"/);
  });
});
