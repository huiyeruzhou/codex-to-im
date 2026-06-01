import type { BaseChannelAdapter } from './channel-adapter.js';
import { deliver } from './delivery-layer.js';
import {
  getChannelProviderKey,
  getFeedbackParseMode,
  renderFeedbackText,
} from './bridge-channel-runtime.js';
import {
  appendMirrorTimeoutNotice,
  buildMirrorTitle,
  formatMirrorMessage,
} from './mirror-formatters.js';
import type {
  CodexMirrorTurnState,
  FinalizedCodexMirrorTurn,
  MirrorTurnHooks,
} from './mirror-turns.js';
import type { CodexMirrorSubscription } from './mirror-subscription-state.js';
import { appendContextUsageCompactText } from './context-usage.js';
import {
  stripOutboundArtifactBlocksForStreaming,
} from './outbound-artifacts.js';
import {
  finalizeStreamFeedback,
  pushStreamFeedbackStatus,
  pushStreamFeedbackTasks,
  pushStreamFeedbackText,
  pushStreamFeedbackTools,
} from './stream-feedback-controller.js';
import { buildStreamContextTags } from './streaming-metadata.js';
import {
  assembleCodexFinalResponse,
} from './turns/response-assembler.js';
import {
  deliverFinalResponse,
  type DeliverResponseImpl,
} from './turns/delivery-pipeline.js';
import {
  formatStreamRuntimeStatus,
  getStreamLastContentResponseAgeMs,
  getVisibleStreamLastContentResponseAgeMs,
  shouldShowStreamLastContentResponseAge,
} from './turns/stream-state.js';

export interface MirrorStructuredStreamStatusConfig {
  idleStartMs: number;
  heartbeatMs: number;
}

export interface MirrorFeedbackControllerDeps {
  getAdapter(channelType: string): BaseChannelAdapter | null | undefined;
  getThreadTitle(threadId: string, sessionId?: string, bindingId?: string): string | null | undefined;
  getStructuredStreamStatusConfig?(): MirrorStructuredStreamStatusConfig;
  getShowToolCallDetails?(): boolean;
  nowIso(): string;
  eventBatchLimit: number;
  deliverResponse: DeliverResponseImpl;
}

export interface MirrorFeedbackController {
  hooks: MirrorTurnHooks<CodexMirrorSubscription>;
  refreshMirrorStreamingStatus(
    subscription: CodexMirrorSubscription,
    nowMs?: number,
    config?: MirrorStructuredStreamStatusConfig,
  ): void;
  stopMirrorStreaming(
    subscription: CodexMirrorSubscription,
    status?: 'completed' | 'interrupted',
  ): void;
  deliverMirrorTurns(
    subscription: CodexMirrorSubscription,
    turns: FinalizedCodexMirrorTurn[],
  ): Promise<{ deliveredCount: number; error?: unknown }>;
}

function createMirrorStreamFeedbackTarget(
  subscription: CodexMirrorSubscription,
  turnState: CodexMirrorTurnState,
  adapter: BaseChannelAdapter,
  startMirrorStreaming: (subscription: CodexMirrorSubscription, turnState: CodexMirrorTurnState) => void,
) {
  return {
    adapter,
    channelType: subscription.channelType,
    chatId: subscription.chatId,
    streamKey: turnState.streamKey,
    ensureStarted: () => {
      startMirrorStreaming(subscription, turnState);
    },
  };
}

export function createMirrorFeedbackController(
  deps: MirrorFeedbackControllerDeps,
): MirrorFeedbackController {
  function getMirrorStreamingAdapter(subscription: CodexMirrorSubscription): BaseChannelAdapter | null {
    const adapter = deps.getAdapter(subscription.channelType);
    if (!adapter || !adapter.isRunning()) return null;
    if (getChannelProviderKey(subscription.channelType) !== 'feishu') return null;
    if (typeof adapter.onStreamText !== 'function' || typeof adapter.onStreamEnd !== 'function') {
      return null;
    }
    return adapter;
  }

  function getMirrorStreamingText(
    subscription: CodexMirrorSubscription,
    turnState: CodexMirrorTurnState,
  ): string {
    const baseTitle = deps.getThreadTitle(subscription.threadId, subscription.sessionId, subscription.bindingId)?.trim() || 'Codex thread';
    const markdown = getFeedbackParseMode(subscription.channelType) === 'Markdown';
    const rendered = formatMirrorMessage(
      baseTitle,
      turnState.userText,
      stripOutboundArtifactBlocksForStreaming(turnState.streamedText),
      markdown,
      true,
      false,
    );
    return rendered || buildMirrorTitle(baseTitle, markdown);
  }

  function getMirrorStreamMetadata(subscription: CodexMirrorSubscription) {
    return {
      title: deps.getThreadTitle(subscription.threadId, subscription.sessionId, subscription.bindingId)?.trim() || 'Codex thread',
      tags: buildStreamContextTags({
        bindingId: subscription.bindingId,
        fallbackId: subscription.sessionId,
        bridgeSessionId: subscription.sessionId,
        codexThreadId: subscription.threadId,
        creatorKind: 'desktop',
        source: 'mirror',
      }),
    };
  }

  function getMirrorPlainTextTitle(subscription: CodexMirrorSubscription, baseTitle: string): string {
    const tags = buildStreamContextTags({
      bindingId: subscription.bindingId,
      fallbackId: subscription.sessionId,
      bridgeSessionId: subscription.sessionId,
      codexThreadId: subscription.threadId,
      creatorKind: 'desktop',
      source: 'mirror',
    });
    return tags.length > 0 ? `${baseTitle}  ${tags.join(' ')}` : baseTitle;
  }

  function startMirrorStreaming(
    subscription: CodexMirrorSubscription,
    turnState: CodexMirrorTurnState,
  ): void {
    const adapter = getMirrorStreamingAdapter(subscription);
    if (!adapter || turnState.streamStarted) return;

    try {
      adapter.onStreamMetadata?.(subscription.chatId, getMirrorStreamMetadata(subscription), turnState.streamKey);
      adapter.onMirrorStreamStart?.(subscription.chatId, turnState.streamKey);
      if (!adapter.onMirrorStreamStart) {
        adapter.onStreamText?.(subscription.chatId, '', turnState.streamKey);
      }
      turnState.streamStarted = true;
    } catch {
      // Non-critical best effort only.
    }
  }

  function createStreamTarget(
    subscription: CodexMirrorSubscription,
    turnState: CodexMirrorTurnState,
    adapter: BaseChannelAdapter,
  ) {
    return createMirrorStreamFeedbackTarget(subscription, turnState, adapter, startMirrorStreaming);
  }

  function pushMirrorStreamingStatus(
    subscription: CodexMirrorSubscription,
    turnState: CodexMirrorTurnState,
    options: {
      nowMs?: number;
      lastResponseAgeMs?: number | null;
      minIntervalMs?: number;
    } = {},
  ): void {
    const adapter = getMirrorStreamingAdapter(subscription);
    if (!adapter || typeof adapter.onStreamStatus !== 'function') return;
    if (!(adapter.supportsStructuredStreamingUi?.(subscription.chatId) ?? true)) return;

    const startedAtMs = Date.parse(turnState.startedAt);
    if (!Number.isFinite(startedAtMs)) return;

    const nowMs = options.nowMs ?? Date.now();
    const minIntervalMs = Math.max(0, options.minIntervalMs ?? 0);
    if (minIntervalMs > 0 && turnState.lastStatusAt > 0 && nowMs - turnState.lastStatusAt < minIntervalMs) {
      return;
    }

    const lastContentResponseAtMs = turnState.lastContentResponseAt
      ? Date.parse(turnState.lastContentResponseAt)
      : turnState.lastResponseAt
        ? Date.parse(turnState.lastResponseAt)
        : null;
    const streamState = {
      startedAtMs,
      lastContentResponseAtMs: Number.isFinite(lastContentResponseAtMs) ? lastContentResponseAtMs : null,
    };
    const statusConfig = deps.getStructuredStreamStatusConfig?.();
    const effectiveLastResponseAgeMs = Object.prototype.hasOwnProperty.call(options, 'lastResponseAgeMs')
      ? options.lastResponseAgeMs
      : statusConfig
        ? getVisibleStreamLastContentResponseAgeMs(streamState, nowMs, statusConfig)
        : null;
    const statusText = formatStreamRuntimeStatus(
      Math.max(0, nowMs - startedAtMs),
      effectiveLastResponseAgeMs,
      turnState.statusNote,
      turnState.contextUsage,
    );
    if (turnState.lastStatusText === statusText) return;

    const pushed = pushStreamFeedbackStatus(
      createStreamTarget(subscription, turnState, adapter),
      statusText,
    );
    if (!pushed) return;
    turnState.lastStatusText = statusText;
    turnState.lastStatusAt = nowMs;
  }

  function refreshMirrorStreamingStatus(
    subscription: CodexMirrorSubscription,
    nowMs = Date.now(),
    config: MirrorStructuredStreamStatusConfig,
  ): void {
    const pendingTurn = subscription.pendingTurn;
    if (!pendingTurn?.streamStarted) return;

    const startedAtMs = Date.parse(pendingTurn.startedAt);
    if (!Number.isFinite(startedAtMs)) return;

    const lastContentResponseAtMs = pendingTurn.lastContentResponseAt
      ? Date.parse(pendingTurn.lastContentResponseAt)
      : pendingTurn.lastResponseAt
        ? Date.parse(pendingTurn.lastResponseAt)
        : null;
    const streamState = {
      startedAtMs,
      lastContentResponseAtMs: Number.isFinite(lastContentResponseAtMs) ? lastContentResponseAtMs : null,
    };
    if (!shouldShowStreamLastContentResponseAge(streamState, nowMs, config)) return;

    pushMirrorStreamingStatus(subscription, pendingTurn, {
      nowMs,
      lastResponseAgeMs: getStreamLastContentResponseAgeMs(streamState, nowMs),
      minIntervalMs: config.heartbeatMs,
    });
  }

  function updateMirrorStreaming(
    subscription: CodexMirrorSubscription,
    turnState: CodexMirrorTurnState,
  ): void {
    const adapter = getMirrorStreamingAdapter(subscription);
    if (!adapter) return;
    pushStreamFeedbackText(
      createStreamTarget(subscription, turnState, adapter),
      getMirrorStreamingText(subscription, turnState),
    );
    pushMirrorStreamingStatus(subscription, turnState);
  }

  function updateMirrorToolProgress(
    subscription: CodexMirrorSubscription,
    turnState: CodexMirrorTurnState,
  ): void {
    const adapter = getMirrorStreamingAdapter(subscription);
    if (!adapter) return;
    pushStreamFeedbackTools(
      createStreamTarget(subscription, turnState, adapter),
      Array.from(turnState.toolCalls.values()),
    );
    pushMirrorStreamingStatus(subscription, turnState);
  }

  function updateMirrorTaskProgress(
    subscription: CodexMirrorSubscription,
    turnState: CodexMirrorTurnState,
  ): void {
    const adapter = getMirrorStreamingAdapter(subscription);
    if (!adapter) return;
    pushStreamFeedbackTasks(
      createStreamTarget(subscription, turnState, adapter),
      turnState.taskItems,
    );
    pushMirrorStreamingStatus(subscription, turnState);
  }

  function updateMirrorStatusProgress(
    subscription: CodexMirrorSubscription,
    turnState: CodexMirrorTurnState,
  ): void {
    const adapter = getMirrorStreamingAdapter(subscription);
    if (!adapter) return;
    pushMirrorStreamingStatus(subscription, turnState);
  }

  function stopMirrorStreaming(
    subscription: CodexMirrorSubscription,
    status: 'completed' | 'interrupted' = 'interrupted',
  ): void {
    const adapter = getMirrorStreamingAdapter(subscription);
    const pendingTurn = subscription.pendingTurn;
    if (!adapter || !pendingTurn?.streamStarted) return;
    void finalizeStreamFeedback(
      createStreamTarget(subscription, pendingTurn, adapter),
      status,
      getMirrorStreamingText(subscription, pendingTurn),
    );
  }

  async function deliverMirrorTurn(
    subscription: CodexMirrorSubscription,
    turn: FinalizedCodexMirrorTurn,
  ): Promise<void> {
    const adapter = deps.getAdapter(subscription.channelType);
    if (!adapter || !adapter.isRunning()) return;

    const baseTitle = deps.getThreadTitle(subscription.threadId, subscription.sessionId, subscription.bindingId)?.trim() || 'Codex thread';
    const plainTextTitle = getMirrorPlainTextTitle(subscription, baseTitle);
    const responseParseMode = getFeedbackParseMode(subscription.channelType);
    const markdown = responseParseMode === 'Markdown';
    const rawFinalResponse = assembleCodexFinalResponse({ text: turn.text });
    const attachments = rawFinalResponse.attachments;
    const cleanTurnText = rawFinalResponse.text;
    const finalTurnText = turn.status === 'completed'
      ? appendContextUsageCompactText(cleanTurnText, turn.contextUsage)
      : cleanTurnText;
    const renderedTextBase = formatMirrorMessage(plainTextTitle, turn.userText, finalTurnText, markdown);
    const renderedStreamTextBase = formatMirrorMessage(baseTitle, turn.userText, finalTurnText, markdown, true, false);
    const renderedText = turn.timedOut
      ? appendMirrorTimeoutNotice(renderedTextBase || buildMirrorTitle(plainTextTitle, markdown), markdown)
      : renderedTextBase;
    const renderedStreamText = turn.timedOut
      ? appendMirrorTimeoutNotice(renderedStreamTextBase || buildMirrorTitle(baseTitle, markdown), markdown)
      : renderedStreamTextBase;
    const text = renderedText ? renderFeedbackText(renderedText, responseParseMode) : '';
    const streamText = renderedStreamText || buildMirrorTitle(baseTitle, markdown);
    const address = {
      channelType: subscription.channelType,
      chatId: subscription.chatId,
    };

    if (getChannelProviderKey(subscription.channelType) === 'feishu' && typeof adapter.onStreamEnd === 'function') {
      try {
        const finalized = await finalizeStreamFeedback(
          {
            adapter,
            channelType: subscription.channelType,
            chatId: subscription.chatId,
            streamKey: turn.streamKey,
          },
          turn.status,
          streamText,
        );
        if (finalized) {
          if (attachments.length > 0) {
            const attachmentResult = await deliverFinalResponse(
              {
                adapter,
                address,
                sessionId: subscription.sessionId,
                deliverResponse: deps.deliverResponse,
              },
              assembleCodexFinalResponse({ attachments }),
              { skipText: true },
            );
            if (!attachmentResult.ok) {
              throw new Error(attachmentResult.error || 'mirror attachment delivery failed');
            }
          }
          subscription.lastDeliveredAt = turn.timestamp || deps.nowIso();
          return;
        }
      } catch (error) {
        console.warn('[bridge-manager] Mirror stream finalize failed:', error instanceof Error ? error.message : error);
      }
    }

    const finalResponse = assembleCodexFinalResponse({
      text,
      attachments,
    });

    if (!finalResponse.text && finalResponse.attachments.length === 0) return;

    const response = await deliverFinalResponse({
      adapter,
      address,
      sessionId: subscription.sessionId,
      deliverResponse: deps.deliverResponse,
      deliverText: async (messageText) => deliver(adapter, {
        address,
        text: messageText,
        parseMode: responseParseMode,
      }, {
        sessionId: subscription.sessionId,
        dedupKey: `mirror:${subscription.bindingId}:${turn.signature}`,
      }),
    }, finalResponse);

    if (!response.ok) {
      throw new Error(response.error || 'mirror delivery failed');
    }

    subscription.lastDeliveredAt = turn.timestamp || deps.nowIso();
  }

  async function deliverMirrorTurns(
    subscription: CodexMirrorSubscription,
    turns: FinalizedCodexMirrorTurn[],
  ): Promise<{ deliveredCount: number; error?: unknown }> {
    let deliveredCount = 0;
    for (const turn of turns.slice(0, deps.eventBatchLimit)) {
      try {
        await deliverMirrorTurn(subscription, turn);
        deliveredCount += 1;
      } catch (error) {
        return { deliveredCount, error };
      }
    }
    return { deliveredCount };
  }

  return {
    hooks: {
      onStreamText: updateMirrorStreaming,
      onStatusProgress: updateMirrorStatusProgress,
      onTaskProgress: updateMirrorTaskProgress,
      onToolProgress: updateMirrorToolProgress,
      get showToolCallDetails() {
        return deps.getShowToolCallDetails?.() === true;
      },
    },
    refreshMirrorStreamingStatus,
    stopMirrorStreaming,
    deliverMirrorTurns,
  };
}
