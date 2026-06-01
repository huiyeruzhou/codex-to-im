import type {
  InboundMessage,
  OutboundAttachment,
  StreamingPreviewState,
} from '../types.js';
import type { BaseChannelAdapter, StructuredStreamingUiSnapshot } from '../channel-adapter.js';
import * as engine from './sdk-conversation-engine.js';
import {
  assembleCodexFinalResponse,
  stripFinalOnlyBlocksForStreaming,
} from '../turns/response-assembler.js';
import type { ActiveBridgeTurn } from '../turns/turn-types.js';
import {
  deliverFinalResponse,
} from '../turns/delivery-pipeline.js';
import { createInteractiveStreamUiController } from './stream-ui-controller.js';
import { createExternalTerminalFinalizationController } from './terminal-finalization-controller.js';
import { createInteractiveSdkStreamEventsController } from './sdk-stream-events-controller.js';
import {
  buildExternalTerminalFinalResponsePlan,
  buildProcessFinalResponsePlan,
} from './final-response-plan.js';
import {
  createStreamState,
  formatStreamRuntimeStatus,
} from '../turns/stream-state.js';
import {
  buildInteractiveStreamCardMetadata,
  buildStaleTaskCompletionNotice,
  type InteractiveStreamConfig,
  type ListInteractiveTurnBindings,
  type ResolveInteractiveTurnEnvironment,
  type ResolveInteractiveTurnRuntimeSettings,
  type ResolveInteractiveTurnDisplayInfo,
} from './turn-environment.js';
import { maskSecrets } from '../../../logger.js';
import { sanitizeInput } from '../security/validators.js';

/** Generate a non-zero random 31-bit integer for use as draft_id. */
function generateDraftId(): number {
  return (Math.floor(Math.random() * 0x7FFFFFFE) + 1);
}

const DEFAULT_ATTACHMENT_PROMPT = '简单地描述文件';

function formatStreamingErrorForCard(
  message: string,
  context: {
    bridgeSessionId: string;
    codexThreadId?: string | null;
    workingDirectory?: string | null;
  },
): string {
  const masked = maskSecrets((message || '').trim());
  const extraLines: string[] = [];
  if (context.bridgeSessionId && !masked.includes('bridge_session_id')) {
    extraLines.push(`bridge_session_id: ${context.bridgeSessionId}`);
  }
  if (context.codexThreadId && !masked.includes('codex_thread_id')) {
    extraLines.push(`codex_thread_id: ${context.codexThreadId}`);
  }
  if (context.workingDirectory && !masked.includes('cwd:')) {
    extraLines.push(`cwd: ${context.workingDirectory}`);
  }
  const combined = [
    masked,
    extraLines.length > 0 ? `\n\n${extraLines.join('\n')}` : '',
  ].join('').trim();
  const { text, truncated } = sanitizeInput(combined || 'Unknown error', 3500);
  const suffix = truncated ? '\n\n（内容过长已截断）' : '';
  return `**Error**\n\n\`\`\`text\n${text.trim()}\n\`\`\`${suffix}`;
}

function logInteractiveTaskError(params: {
  kind: 'sdk' | 'external_terminal';
  message: string;
  bridgeSessionId: string;
  channelType: string;
  chatId: string;
  codexThreadId?: string | null;
  workingDirectory?: string | null;
}): void {
  const masked = maskSecrets((params.message || '').trim());
  const { text, truncated } = sanitizeInput(masked || 'Unknown error', 2000);
  console.error('[interactive-turn/runner] Task error:', {
    kind: params.kind,
    bridge_session_id: params.bridgeSessionId,
    channel_type: params.channelType,
    chat_id: params.chatId,
    codex_thread_id: params.codexThreadId || null,
    cwd: params.workingDirectory || null,
    error: text,
    truncated,
  });
}

function flushPreview(
  adapter: BaseChannelAdapter,
  state: StreamingPreviewState,
  config: InteractiveStreamConfig,
): void {
  if (state.degraded || !adapter.sendPreview) return;

  const text = state.pendingText.length > config.maxChars
    ? state.pendingText.slice(0, config.maxChars) + '...'
    : state.pendingText;

  state.lastSentText = text;
  state.lastSentAt = Date.now();

  adapter.sendPreview(state.chatId, text, state.draftId).then((result) => {
    if (result === 'degrade') state.degraded = true;
  }).catch(() => {});
}

export function formatInteractiveRuntimeStatus(
  elapsedMs: number,
  lastResponseAgeMs?: number | null,
  statusNote?: string | null,
): string {
  return formatStreamRuntimeStatus(elapsedMs, lastResponseAgeMs, statusNote);
}

export interface InteractiveTaskState {
  id: string;
  abortController: AbortController;
  adapter: BaseChannelAdapter;
  address: InboundMessage['address'];
  requestMessageId: string;
  streamKey: string;
  sessionId: string;
  hasStreamingCards: boolean;
  structuredStreamUiActive: boolean;
  lastActivityAt: number;
  lastResponseAt?: number | null;
  lastContentResponseAt?: number | null;
  streamFinalized: boolean;
  uiEnded: boolean;
  mirrorSuppressionId: string | null;
  finalizeFromExternalTerminal?(
    outcome: 'completed' | 'failed' | 'aborted',
    detail?: string,
    finalText?: string,
  ): Promise<boolean>;
  forceStop?(detail?: string): Promise<boolean>;
}

export type ForwardPermissionRequest = (
  adapter: BaseChannelAdapter,
  address: InboundMessage['address'],
  permissionRequestId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  sessionId?: string,
  suggestions?: unknown[],
  replyToMessageId?: string,
) => Promise<void>;

export type BuildStopCallbackData = (sessionId: string) => string;

export interface RunInteractiveMessageDeps {
  registerInteractiveTask(task: InteractiveTaskState): void;
  registerBridgeTurn?(turn: ActiveBridgeTurn): void;
  resetMirrorSessionForInteractiveRun(sessionId: string): void;
  isCurrentInteractiveTask(sessionId: string, taskId: string): boolean;
  touchInteractiveTask(sessionId: string, taskId: string): void;
  recordInteractiveHealthStart(sessionId: string, detail?: string): void;
  recordInteractiveHealthProgress(sessionId: string, type: 'text' | 'permission_wait', detail?: string): void;
  recordInteractiveHealthTool(sessionId: string, toolId: string, toolName: string, status: 'running' | 'complete' | 'error'): void;
  recordInteractiveStreamUiSnapshot?(sessionId: string, snapshot: StructuredStreamingUiSnapshot): void;
  recordInteractiveHealthEnd(sessionId: string, outcome: 'completed' | 'failed' | 'aborted', detail?: string): void;
  beginMirrorSuppression(sessionId: string, promptText: string): string;
  abortMirrorSuppression(sessionId: string, suppressionId?: string | null): void;
  settleMirrorSuppression(sessionId: string, suppressionId?: string | null): void;
  releaseInteractiveTask(sessionId: string, taskId: string): void;
  releaseBridgeTurn?(sessionId: string, taskId: string): void;
  deliverResponse(
    adapter: BaseChannelAdapter,
    address: InboundMessage['address'],
    responseText: string,
    sessionId: string,
    replyToMessageId?: string,
    attachments?: OutboundAttachment[],
  ): Promise<unknown>;
  persistCodexThreadUpdate(
    sessionId: string,
    codexThreadId: string | null | undefined,
    hasError: boolean,
    errorMessage?: string | null,
  ): void;
  processMessageImpl?: typeof engine.processMessage;
  resolveSdkConversationRuntime?: () => engine.SdkConversationRuntime;
  resolveInteractiveTurnEnvironment: ResolveInteractiveTurnEnvironment;
  resolveInteractiveTurnRuntimeSettings: ResolveInteractiveTurnRuntimeSettings;
  forwardPermissionRequest?: ForwardPermissionRequest;
  buildStopCallbackData?: BuildStopCallbackData;
  resolveInteractiveTurnDisplayInfo?: ResolveInteractiveTurnDisplayInfo;
  listInteractiveTurnBindings?: ListInteractiveTurnBindings;
  nowMs?(): number;
  setIntervalFn?(callback: () => void, intervalMs: number): unknown;
  clearIntervalFn?(handle: unknown): void;
  streamStatusIdleDetectionStartMs?: number;
  streamStatusHeartbeatMs?: number;
  codexTerminalFinalizationTimeoutMs?: number;
}

export async function runInteractiveMessage(
  adapter: BaseChannelAdapter,
  msg: InboundMessage,
  text: string,
  attachments: InboundMessage['attachments'] | undefined,
  deps: RunInteractiveMessageDeps,
): Promise<void> {
  const turnEnvironment = deps.resolveInteractiveTurnEnvironment(msg.address, msg.messageId);
  const {
    binding,
    initialSession,
    classification: turnClassification,
    codexThreadId,
    streamKey,
  } = turnEnvironment;
  const nowMs = deps.nowMs ?? (() => Date.now());
  const setIntervalFn = deps.setIntervalFn ?? ((callback: () => void, intervalMs: number) => setInterval(callback, intervalMs));
  const clearIntervalFn = deps.clearIntervalFn ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
  const processMessageImpl = deps.processMessageImpl ?? engine.processMessage;
  const resolveDisplayInfo = deps.resolveInteractiveTurnDisplayInfo;
  const runtimeSettings = deps.resolveInteractiveTurnRuntimeSettings(adapter.provider);
  const showToolCallDetails = runtimeSettings.showToolCallDetails;
  const streamStatusIdleDetectionStartMs = Math.max(
    0,
    deps.streamStatusIdleDetectionStartMs ?? runtimeSettings.statusTiming.idleStartMs,
  );
  const streamStatusHeartbeatMs = Math.max(
    1_000,
    deps.streamStatusHeartbeatMs ?? runtimeSettings.statusTiming.heartbeatMs,
  );

  let messageStartCalled = false;
  const ensureMessageStarted = () => {
    if (messageStartCalled) return;
    adapter.onMessageStart?.(msg.address.chatId, streamKey);
    messageStartCalled = true;
  };
  ensureMessageStarted();

  const taskAbort = new AbortController();
  const taskId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const taskStartedAt = nowMs();
  const streamState = createStreamState(taskStartedAt);
  const externalTerminal = createExternalTerminalFinalizationController({
    abortSignal: taskAbort.signal,
    hasCodexThread: () => Boolean(codexThreadId),
    isCurrentTask: () => deps.isCurrentInteractiveTask(binding.bridgeSessionId, taskId),
    isAborted: () => taskAbort.signal.aborted,
    abortTask: () => taskAbort.abort(),
    finalizationTimeoutMs: deps.codexTerminalFinalizationTimeoutMs,
  });
  deps.resetMirrorSessionForInteractiveRun(binding.bridgeSessionId);
  const taskState: InteractiveTaskState = {
    id: taskId,
    abortController: taskAbort,
    adapter,
    address: msg.address,
    requestMessageId: msg.messageId,
    streamKey,
    sessionId: binding.bridgeSessionId,
    hasStreamingCards: false,
    structuredStreamUiActive: false,
    lastActivityAt: taskStartedAt,
    lastResponseAt: null,
    lastContentResponseAt: null,
    streamFinalized: false,
    uiEnded: false,
    mirrorSuppressionId: null,
    finalizeFromExternalTerminal: async (outcome, detail, finalText) => {
      return externalTerminal.finalize(outcome, detail, finalText);
    },
  };
  deps.registerInteractiveTask(taskState);
  deps.registerBridgeTurn?.({
    id: taskId,
    sessionId: binding.bridgeSessionId,
    kind: turnClassification.kind,
    origin: 'im',
    progressSource: 'sdk_stream',
    finalSource: turnClassification.kind === 'im_codex_reuse' ? 'codex_task_complete' : 'sdk_result',
    codexThreadId: turnClassification.codexThreadId,
    requestMessageId: msg.messageId,
    streamKey,
    startedAt: taskStartedAt,
  });
  deps.recordInteractiveHealthStart(binding.bridgeSessionId);

  let previewState: StreamingPreviewState | null = null;
  const caps = adapter.getPreviewCapabilities?.(msg.address.chatId) ?? null;
  if (caps?.supported) {
    previewState = {
      draftId: generateDraftId(),
      chatId: msg.address.chatId,
      lastSentText: '',
      lastSentAt: 0,
      degraded: false,
      throttleTimer: null,
      pendingText: '',
    };
  }

  const streamCfg = previewState ? runtimeSettings.stream : null;
  const previewOnPartialText = (previewState && streamCfg) ? (fullText: string) => {
    const ps = previewState!;
    const cfg = streamCfg!;
    if (ps.degraded) return;
    const sanitizedText = stripFinalOnlyBlocksForStreaming(fullText);

    ps.pendingText = sanitizedText.length > cfg.maxChars
      ? sanitizedText.slice(0, cfg.maxChars) + '...'
      : sanitizedText;

    const delta = ps.pendingText.length - ps.lastSentText.length;
    const elapsed = Date.now() - ps.lastSentAt;

    if (delta < cfg.minDeltaChars && ps.lastSentAt > 0) {
      if (!ps.throttleTimer) {
        ps.throttleTimer = setTimeout(() => {
          ps.throttleTimer = null;
          if (!ps.degraded) flushPreview(adapter, ps, cfg);
        }, cfg.intervalMs);
      }
      return;
    }

    if (elapsed < cfg.intervalMs && ps.lastSentAt > 0) {
      if (!ps.throttleTimer) {
        ps.throttleTimer = setTimeout(() => {
          ps.throttleTimer = null;
          if (!ps.degraded) flushPreview(adapter, ps, cfg);
        }, cfg.intervalMs - elapsed);
      }
      return;
    }

    if (ps.throttleTimer) {
      clearTimeout(ps.throttleTimer);
      ps.throttleTimer = null;
    }
    flushPreview(adapter, ps, cfg);
  } : undefined;

  const cardMetadata = buildInteractiveStreamCardMetadata(binding, resolveDisplayInfo);

  let previewEnded = false;
  const endPreviewOnce = () => {
    if (previewEnded) return;
    previewEnded = true;
    if (!previewState) return;
    if (previewState.throttleTimer) {
      clearTimeout(previewState.throttleTimer);
      previewState.throttleTimer = null;
    }
    adapter.endPreview?.(msg.address.chatId, previewState.draftId);
  };

  const streamUi = createInteractiveStreamUiController({
    adapter,
    channelType: adapter.channelType,
    chatId: msg.address.chatId,
    streamKey,
    sessionId: binding.bridgeSessionId,
    streamState,
    taskState,
    statusTiming: {
      idleStartMs: streamStatusIdleDetectionStartMs,
      heartbeatMs: streamStatusHeartbeatMs,
    },
    stopCallbackData: deps.buildStopCallbackData?.(binding.bridgeSessionId),
    nowMs,
    setIntervalFn,
    clearIntervalFn,
    ensureStarted: ensureMessageStarted,
    isCurrentTask: () => deps.isCurrentInteractiveTask(binding.bridgeSessionId, taskId),
    isAborted: () => taskAbort.signal.aborted,
    endPreview: endPreviewOnce,
    normalizeFinalText: (finalText) => assembleCodexFinalResponse({ text: finalText }).text,
    recordSnapshot: deps.recordInteractiveStreamUiSnapshot,
  });
  taskState.hasStreamingCards = streamUi.hasStreamingCards;
  streamUi.pushMetadata(cardMetadata);
  const sdkStreamEvents = createInteractiveSdkStreamEventsController({
    sessionId: binding.bridgeSessionId,
    taskId,
    streamState,
    taskState,
    streamUi,
    streamFeedback: streamUi.feedback,
    showToolCallDetails,
    nowMs,
    isCurrentTask: deps.isCurrentInteractiveTask,
    touchTask: deps.touchInteractiveTask,
    recordHealthProgress: deps.recordInteractiveHealthProgress,
    recordHealthTool: deps.recordInteractiveHealthTool,
    previewOnPartialText,
  });

  const finalizeStreamUiOnce = async (
    status: 'completed' | 'interrupted' | 'error',
    responseText: string,
  ): Promise<boolean> => {
    return streamUi.finalizeOnce(status, responseText);
  };

  const shouldSkipTextDelivery = (): boolean => {
    return streamUi.shouldSkipTextDelivery();
  };
  const endMessageUiOnce = () => {
    if (taskState.uiEnded) return;
    adapter.onMessageEnd?.(msg.address.chatId, streamKey);
    taskState.uiEnded = true;
  };

  streamUi.startStatusHeartbeat();

  let finalOutcome: 'completed' | 'failed' | 'aborted' = 'failed';
  let finalOutcomeDetail: string | undefined;
  let shouldRecordHealthEnd = true;
  let forceStopStarted = false;

  taskState.forceStop = async (detail = '任务已收到停止请求。') => {
    if (forceStopStarted) return true;
    forceStopStarted = true;
    finalOutcome = 'aborted';
    finalOutcomeDetail = detail;
    taskAbort.abort();
    streamUi.stopStatusUpdates();
    try {
      await finalizeStreamUiOnce('interrupted', detail);
    } catch {
      // Force stop must release the session even if remote UI cleanup fails.
    }
    endMessageUiOnce();
    return true;
  };

  try {
    const promptText = text || (attachments && attachments.length > 0 ? DEFAULT_ATTACHMENT_PROMPT : '');

    const processPromise = processMessageImpl(
      binding,
      promptText,
      async (perm) => {
        if (!deps.forwardPermissionRequest) {
          throw new Error('Interactive turn permission forwarding port is not configured');
        }
        await deps.forwardPermissionRequest(
          adapter,
          msg.address,
          perm.permissionRequestId,
          perm.toolName,
          perm.toolInput,
          binding.bridgeSessionId,
          perm.suggestions,
          msg.messageId,
        );
        sdkStreamEvents.onPermissionWait(perm.toolName);
      },
      taskAbort.signal,
      attachments && attachments.length > 0 ? attachments : undefined,
      sdkStreamEvents.onPartialText,
      sdkStreamEvents.onToolEvent,
      sdkStreamEvents.onTaskEvent,
      sdkStreamEvents.onStatusNote,
      (preparedPrompt) => {
        if (turnClassification.kind === 'im_codex_reuse') {
          externalTerminal.expectCodexTerminalFinal();
        }
        if (codexThreadId && !taskState.mirrorSuppressionId) {
          taskState.mirrorSuppressionId = deps.beginMirrorSuppression(binding.bridgeSessionId, preparedPrompt);
        }
      },
      {
        expandToolCalls: showToolCallDetails,
        streamPreview: {
          includeToolSnippets: showToolCallDetails && !streamUi.hasStreamingCards,
        },
        onContextUsage: sdkStreamEvents.onContextUsage,
      },
      deps.resolveSdkConversationRuntime?.(),
    );
    const raced = await externalTerminal.raceProcess(processPromise);

    if (raced.kind === 'external') {
      processPromise.catch(() => {});
      finalOutcome = raced.terminal.outcome;
      finalOutcomeDetail = raced.terminal.detail;
      const streamEndStatus = raced.terminal.outcome === 'completed'
        ? 'completed'
        : raced.terminal.outcome === 'aborted'
          ? 'interrupted'
          : 'error';
      if (streamEndStatus === 'error' && !taskAbort.signal.aborted) {
        logInteractiveTaskError({
          kind: 'external_terminal',
          message: raced.terminal.detail || 'External terminal failed',
          bridgeSessionId: binding.bridgeSessionId,
          channelType: msg.address.channelType,
          chatId: msg.address.chatId,
          codexThreadId: initialSession?.codex_thread_id || null,
          workingDirectory: binding.workingDirectory || null,
        });
      }
      const staleTaskNotice = buildStaleTaskCompletionNotice(msg.address, binding, {
        listChannelBindings: deps.listInteractiveTurnBindings,
        resolveDisplayInfo,
      });
      const finalResponsePlan = buildExternalTerminalFinalResponsePlan({
        terminal: raced.terminal,
        staleTaskNotice,
        aborted: taskAbort.signal.aborted,
        formatErrorCard: (message) => formatStreamingErrorForCard(message, {
          bridgeSessionId: binding.bridgeSessionId,
          codexThreadId: initialSession?.codex_thread_id || null,
          workingDirectory: binding.workingDirectory || null,
        }),
      });
      sdkStreamEvents.pushFinalCardText(finalResponsePlan.cardText);
      const cardFinalized = await finalizeStreamUiOnce(
        finalResponsePlan.streamEndStatus,
        finalResponsePlan.cardText,
      );
      if (finalResponsePlan.deliveryResponse) {
        await deliverFinalResponse({
          adapter,
          address: msg.address,
          sessionId: binding.bridgeSessionId,
          replyToMessageId: msg.messageId,
          deliverResponse: deps.deliverResponse,
        }, finalResponsePlan.deliveryResponse, {
          skipText: shouldSkipTextDelivery() || (
            finalResponsePlan.skipTextWhenCardFinalized && cardFinalized
          ),
        });
      }
      return;
    }

    const result = raced.result;
    externalTerminal.markProcessSettled();
    if (streamUi.hasStreamingCards && result.codexThreadId) {
      streamUi.pushMetadata(buildInteractiveStreamCardMetadata(binding, resolveDisplayInfo));
    }

    if (!deps.isCurrentInteractiveTask(binding.bridgeSessionId, taskId)) {
      shouldRecordHealthEnd = false;
      return;
    }

    const terminalAfterProcess = await externalTerminal.waitAfterProcess();
    if (!taskAbort.signal.aborted && result.hasError) {
      logInteractiveTaskError({
        kind: 'sdk',
        message: result.errorMessage,
        bridgeSessionId: binding.bridgeSessionId,
        channelType: msg.address.channelType,
        chatId: msg.address.chatId,
        codexThreadId: result.codexThreadId || initialSession?.codex_thread_id || null,
        workingDirectory: binding.workingDirectory || null,
      });
    }
    let cardFinalized = false;
    const staleTaskNotice = buildStaleTaskCompletionNotice(msg.address, binding, {
      listChannelBindings: deps.listInteractiveTurnBindings,
      resolveDisplayInfo,
    });
    const finalResponsePlan = buildProcessFinalResponsePlan({
      result,
      terminal: terminalAfterProcess,
      staleTaskNotice,
      aborted: taskAbort.signal.aborted,
      formatErrorCard: (message) => formatStreamingErrorForCard(message, {
        bridgeSessionId: binding.bridgeSessionId,
        codexThreadId: result.codexThreadId || initialSession?.codex_thread_id || null,
        workingDirectory: binding.workingDirectory || null,
      }),
    });
    if (streamUi.hasStreamingCards) {
      sdkStreamEvents.pushFinalCardText(finalResponsePlan.cardText);
      cardFinalized = await finalizeStreamUiOnce(
        finalResponsePlan.streamEndStatus,
        finalResponsePlan.cardText,
      );
    }

    if (finalResponsePlan.deliveryResponse) {
      await deliverFinalResponse({
        adapter,
        address: msg.address,
        sessionId: binding.bridgeSessionId,
        replyToMessageId: msg.messageId,
        deliverResponse: deps.deliverResponse,
      }, finalResponsePlan.deliveryResponse, {
        skipText: shouldSkipTextDelivery() || (
          finalResponsePlan.skipTextWhenCardFinalized && cardFinalized
        ),
      });
    }

    try {
      deps.persistCodexThreadUpdate(
        binding.bridgeSessionId,
        result.codexThreadId,
        result.hasError,
        result.errorMessage,
      );
    } catch {
      // best effort
    }
    finalOutcome = terminalAfterProcess?.outcome || (result.hasError ? 'failed' : 'completed');
    finalOutcomeDetail = terminalAfterProcess?.detail || (result.hasError
      ? (result.errorMessage?.trim() || undefined)
      : undefined);
  } finally {
    await finalizeStreamUiOnce(
      taskAbort.signal.aborted
        ? 'interrupted'
        : finalOutcome === 'completed'
          ? 'completed'
          : 'error',
      '',
    );

    if (taskState.mirrorSuppressionId) {
      if (finalOutcome === 'aborted') {
        deps.abortMirrorSuppression(binding.bridgeSessionId, taskState.mirrorSuppressionId);
      } else {
        deps.settleMirrorSuppression(binding.bridgeSessionId, taskState.mirrorSuppressionId);
      }
      taskState.mirrorSuppressionId = null;
    }
    if (shouldRecordHealthEnd) {
      if (taskAbort.signal.aborted && !externalTerminal.current) {
        finalOutcome = 'aborted';
        finalOutcomeDetail = finalOutcomeDetail || '任务已收到停止请求。';
      }
      deps.recordInteractiveHealthEnd(binding.bridgeSessionId, finalOutcome, finalOutcomeDetail);
    }
    deps.releaseInteractiveTask(binding.bridgeSessionId, taskId);
    deps.releaseBridgeTurn?.(binding.bridgeSessionId, taskId);
    endMessageUiOnce();
    externalTerminal.settleCompletion(taskState.streamFinalized || !streamUi.hasStreamingCards);
  }
}
