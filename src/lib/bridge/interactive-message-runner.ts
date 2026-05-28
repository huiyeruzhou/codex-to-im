import path from 'node:path';
import type {
  ChannelBinding,
  InboundMessage,
  OutboundAttachment,
  StreamingPreviewState,
  TaskProgressInfo,
  ToolCallInfo,
} from './types.js';
import type { BaseChannelAdapter, StructuredStreamingUiSnapshot } from './channel-adapter.js';
import * as router from './channel-router.js';
import * as engine from './conversation-engine.js';
import * as broker from './permission-broker.js';
import { getBridgeContext } from './context.js';
import {
  assembleDesktopFinalResponse,
  assembleSdkFinalResponse,
  hasFinalResponsePayload,
  mergeFinalResponses,
  stripFinalOnlyBlocksForStreaming,
} from './turns/response-assembler.js';
import { buildInteractiveStreamKey } from './mirror-formatters.js';
import {
  pushStreamFeedbackStatus,
  pushStreamFeedbackTasks,
  pushStreamFeedbackText,
  pushStreamFeedbackTools,
} from './stream-feedback-controller.js';
import { getExplicitDesktopThreadId } from './turns/turn-classifier.js';
import type { ActiveBridgeTurn } from './turns/turn-types.js';
import {
  deliverFinalResponse,
  finalizeStreamingUi,
} from './turns/delivery-pipeline.js';
import {
  buildStreamRuntimeStatus,
  createStreamState,
  formatStreamRuntimeStatus,
  getStreamLastContentResponseAgeMs,
  getVisibleStreamLastContentResponseAgeMs,
  recordStreamActivity,
  recordStreamContentResponse,
  shouldShowStreamLastContentResponseAge,
  updateStreamStatusNote,
} from './turns/stream-state.js';
import { maskSecrets } from '../../logger.js';
import { sanitizeInput } from './security/validators.js';

/** Generate a non-zero random 31-bit integer for use as draft_id. */
function generateDraftId(): number {
  return (Math.floor(Math.random() * 0x7FFFFFFE) + 1);
}

export interface StreamConfig {
  intervalMs: number;
  minDeltaChars: number;
  maxChars: number;
}

const STREAM_DEFAULTS: Record<string, StreamConfig> = {
  default: { intervalMs: 1000, minDeltaChars: 30, maxChars: 4000 },
};

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
  console.error('[interactive-message-runner] Task error:', {
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

function summarizeToolValue(value: unknown, maxChars: number): string {
  if (value == null) return '';
  if (typeof value === 'object' && value) {
    const record = value as Record<string, unknown>;
    const commandValue = record.command;
    if (typeof commandValue === 'string' && commandValue.trim()) {
      const trimmedCommand = commandValue.trim();
      const bashPrefix = '/bin/bash -lc "';
      const extracted = trimmedCommand.startsWith(bashPrefix) && trimmedCommand.endsWith('"')
        ? trimmedCommand.slice(bashPrefix.length, -1)
        : trimmedCommand;
      const masked = maskSecrets(extracted);
      const { text, truncated } = sanitizeInput(masked, maxChars);
      return truncated ? `${text}\n…(truncated)` : text;
    }
  }
  const raw = typeof value === 'string'
    ? value
    : (() => {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    })();
  const masked = maskSecrets(raw);
  const { text, truncated } = sanitizeInput(masked, maxChars);
  return truncated ? `${text}\n…(truncated)` : text;
}
const STREAM_STATUS_IDLE_START_MS = 180_000;
const STREAM_STATUS_HEARTBEAT_MS = 10_000;

function getStreamConfig(channelType = 'default'): StreamConfig {
  const { store } = getBridgeContext();
  const defaults = STREAM_DEFAULTS[channelType] || STREAM_DEFAULTS.default;
  const prefix = `bridge_${channelType}_stream_`;
  const intervalMs = parseInt(store.getSetting(`${prefix}interval_ms`) || '', 10) || defaults.intervalMs;
  const minDeltaChars = parseInt(store.getSetting(`${prefix}min_delta_chars`) || '', 10) || defaults.minDeltaChars;
  const maxChars = parseInt(store.getSetting(`${prefix}max_chars`) || '', 10) || defaults.maxChars;
  return { intervalMs, minDeltaChars, maxChars };
}

function getStructuredStreamStatusConfig(): {
  idleStartMs: number;
  heartbeatMs: number;
} {
  const { store } = getBridgeContext();
  const idleStartSeconds = parseInt(store.getSetting('bridge_stream_status_idle_start_seconds') || '', 10);
  const heartbeatSeconds = parseInt(store.getSetting('bridge_stream_status_check_interval_seconds') || '', 10);
  return {
    idleStartMs: Math.max(
      0,
      (Number.isFinite(idleStartSeconds) && idleStartSeconds > 0 ? idleStartSeconds : STREAM_STATUS_IDLE_START_MS / 1000) * 1000,
    ),
    heartbeatMs: Math.max(
      1_000,
      (Number.isFinite(heartbeatSeconds) && heartbeatSeconds > 0 ? heartbeatSeconds : STREAM_STATUS_HEARTBEAT_MS / 1000) * 1000,
    ),
  };
}

function shouldWriteSdkToolDetailsInText(): boolean {
  const { store } = getBridgeContext();
  return store.getSetting('bridge_sdk_tool_call_details_in_text') !== 'false';
}

function flushPreview(
  adapter: BaseChannelAdapter,
  state: StreamingPreviewState,
  config: StreamConfig,
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

function pathBaseName(value: string): string {
  return value.includes('\\') ? path.win32.basename(value) : path.basename(value);
}

function stripInternalSessionPrefix(value: string): string {
  return value.replace(/^(Bridge|Desktop):\s*/i, '').trim() || value;
}

function formatTaskDisplayName(binding: ChannelBinding): string {
  const { store } = getBridgeContext();
  const session = store.getSession(binding.codepilotSessionId);
  if (session?.name?.trim()) return stripInternalSessionPrefix(session.name.trim());
  const cwd = session?.working_directory || binding.workingDirectory || '';
  if (cwd) return pathBaseName(cwd) || cwd;
  return binding.codepilotSessionId.slice(0, 8);
}

function buildStaleTaskCompletionNotice(
  address: InboundMessage['address'],
  binding: ChannelBinding,
): string | null {
  const { store } = getBridgeContext();
  const current = store.getChannelBinding(address.channelType, address.chatId);
  if (current?.codepilotSessionId === binding.codepilotSessionId) return null;
  const taskName = formatTaskDisplayName(binding);
  return `旧会话「${taskName}」任务已结束，但当前聊天已切换到其他会话，回复已跳过。`;
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
  persistSdkSessionUpdate(
    sessionId: string,
    sdkSessionId: string | null | undefined,
    hasError: boolean,
  ): void;
  processMessageImpl?: typeof engine.processMessage;
  forwardPermissionRequestImpl?: typeof broker.forwardPermissionRequest;
  nowMs?(): number;
  setIntervalFn?(callback: () => void, intervalMs: number): unknown;
  clearIntervalFn?(handle: unknown): void;
  streamStatusIdleDetectionStartMs?: number;
  streamStatusHeartbeatMs?: number;
  desktopTerminalFinalizationTimeoutMs?: number;
}

export async function runInteractiveMessage(
  adapter: BaseChannelAdapter,
  msg: InboundMessage,
  text: string,
  attachments: InboundMessage['attachments'] | undefined,
  deps: RunInteractiveMessageDeps,
): Promise<void> {
  const binding = router.resolve(msg.address);
  const initialSession = getBridgeContext().store.getSession(binding.codepilotSessionId);
  const desktopThreadId = getExplicitDesktopThreadId(initialSession);
  const streamKey = buildInteractiveStreamKey(binding.codepilotSessionId, msg.messageId);
  const nowMs = deps.nowMs ?? (() => Date.now());
  const setIntervalFn = deps.setIntervalFn ?? ((callback: () => void, intervalMs: number) => setInterval(callback, intervalMs));
  const clearIntervalFn = deps.clearIntervalFn ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
  const processMessageImpl = deps.processMessageImpl ?? engine.processMessage;
  const forwardPermissionRequestImpl = deps.forwardPermissionRequestImpl ?? broker.forwardPermissionRequest;
  const structuredStreamStatusConfig = getStructuredStreamStatusConfig();
  const showSdkToolDetails = shouldWriteSdkToolDetailsInText();
  const streamStatusIdleDetectionStartMs = Math.max(
    0,
    deps.streamStatusIdleDetectionStartMs ?? structuredStreamStatusConfig.idleStartMs,
  );
  const streamStatusHeartbeatMs = Math.max(
    1_000,
    deps.streamStatusHeartbeatMs ?? structuredStreamStatusConfig.heartbeatMs,
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
  type ExternalTerminalFinalization = {
    outcome: 'completed' | 'failed' | 'aborted';
    detail?: string;
    finalText?: string;
  };
  let externalTerminalRequest: ExternalTerminalFinalization | null = null;
  let desktopTerminalFinalExpected = false;
  let resolveExternalTerminal: ((request: ExternalTerminalFinalization) => void) | null = null;
  const externalTerminalPromise = new Promise<ExternalTerminalFinalization>((resolve) => {
    resolveExternalTerminal = resolve;
  });
  let processResultSettled = false;
  let resolveExternalTerminalCompletion: ((finalized: boolean) => void) | null = null;
  let externalTerminalCompletionSettled = false;
  const externalTerminalCompletion = new Promise<boolean>((resolve) => {
    resolveExternalTerminalCompletion = resolve;
  });
  const settleExternalTerminalCompletion = (finalized: boolean) => {
    if (!externalTerminalRequest || externalTerminalCompletionSettled) return;
    externalTerminalCompletionSettled = true;
    resolveExternalTerminalCompletion?.(finalized);
  };
  deps.resetMirrorSessionForInteractiveRun(binding.codepilotSessionId);
  const taskState: InteractiveTaskState = {
    id: taskId,
    abortController: taskAbort,
    adapter,
    address: msg.address,
    requestMessageId: msg.messageId,
    streamKey,
    sessionId: binding.codepilotSessionId,
    hasStreamingCards: false,
    structuredStreamUiActive: false,
    lastActivityAt: taskStartedAt,
    lastResponseAt: null,
    lastContentResponseAt: null,
    streamFinalized: false,
    uiEnded: false,
    mirrorSuppressionId: null,
    finalizeFromExternalTerminal: async (outcome, detail, finalText) => {
      if (externalTerminalRequest) return externalTerminalCompletion;
      if (!deps.isCurrentInteractiveTask(binding.codepilotSessionId, taskId)) return false;
      externalTerminalRequest = { outcome, detail, finalText };
      resolveExternalTerminal?.(externalTerminalRequest);
      if (!processResultSettled && !taskAbort.signal.aborted) {
        taskAbort.abort();
      }
      return externalTerminalCompletion;
    },
  };
  deps.registerInteractiveTask(taskState);
  deps.registerBridgeTurn?.({
    id: taskId,
    sessionId: binding.codepilotSessionId,
    kind: desktopThreadId ? 'im_desktop_reuse' : 'im_sdk',
    origin: 'im',
    progressSource: 'sdk_stream',
    finalSource: desktopThreadId ? 'desktop_task_complete' : 'sdk_result',
    codexThreadId: binding.sdkSessionId || initialSession?.codex_thread_id || initialSession?.sdk_session_id || undefined,
    desktopThreadId,
    requestMessageId: msg.messageId,
    streamKey,
    startedAt: taskStartedAt,
  });
  deps.recordInteractiveHealthStart(binding.codepilotSessionId);

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

  const streamCfg = previewState ? getStreamConfig(adapter.provider) : null;
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

  const hasStreamingCards = typeof adapter.onStreamText === 'function';
  taskState.hasStreamingCards = hasStreamingCards;
  const toolCallTracker = new Map<string, ToolCallInfo>();
  const streamFeedbackTarget = {
    adapter,
    channelType: adapter.channelType,
    chatId: msg.address.chatId,
    streamKey,
    ensureStarted: () => {
      ensureMessageStarted();
    },
  };
  const supportsPersistentStreamStatus = hasStreamingCards
    && adapter.provider === 'feishu'
    && typeof adapter.onStreamStatus === 'function';
  const supportsStructuredStreamUi = supportsPersistentStreamStatus
    && (adapter.supportsStructuredStreamingUi?.(msg.address.chatId) ?? true);
  let latestTasks: TaskProgressInfo[] = [];
  const syncStructuredStreamUiState = () => {
    if (!supportsStructuredStreamUi || taskState.structuredStreamUiActive) return;
    if (adapter.hasActiveStreamingUi?.(msg.address.chatId, streamKey)) {
      taskState.structuredStreamUiActive = true;
    }
  };
  const syncStructuredStreamUiSnapshot = () => {
    if (!supportsStructuredStreamUi) return;
    syncStructuredStreamUiState();
    const snapshot = adapter.getStructuredStreamingUiSnapshot?.(msg.address.chatId, streamKey);
    if (!snapshot) return;
    deps.recordInteractiveStreamUiSnapshot?.(binding.codepilotSessionId, snapshot);
  };
  const getVisibleLastResponseAgeMs = () => getVisibleStreamLastContentResponseAgeMs(
    streamState,
    nowMs(),
    {
      idleStartMs: streamStatusIdleDetectionStartMs,
      heartbeatMs: streamStatusHeartbeatMs,
    },
  );
  const pushRunningStatus = (lastResponseAgeMs?: number | null) => {
    if (!supportsStructuredStreamUi || streamStatusUpdatesClosed) return;
    const effectiveLastResponseAgeMs = lastResponseAgeMs === undefined
      ? getVisibleLastResponseAgeMs()
      : lastResponseAgeMs;
    pushStreamFeedbackStatus(
      streamFeedbackTarget,
      effectiveLastResponseAgeMs == null
        ? buildStreamRuntimeStatus(streamState, nowMs())
        : formatStreamRuntimeStatus(nowMs() - taskStartedAt, effectiveLastResponseAgeMs, streamState.statusNote),
    );
    syncStructuredStreamUiSnapshot();
  };
  const markActivity = () => {
    const now = nowMs();
    recordStreamActivity(streamState, now);
    taskState.lastActivityAt = streamState.lastActivityAtMs;
    deps.touchInteractiveTask(binding.codepilotSessionId, taskId);
  };
  const markContentResponse = () => {
    const now = nowMs();
    recordStreamContentResponse(streamState, now);
    taskState.lastActivityAt = streamState.lastActivityAtMs;
    taskState.lastResponseAt = streamState.lastContentResponseAtMs;
    taskState.lastContentResponseAt = streamState.lastContentResponseAtMs;
    deps.touchInteractiveTask(binding.codepilotSessionId, taskId);
  };

  let streamStatusHeartbeat: unknown = null;
  let streamStatusUpdatesClosed = false;
  const clearStreamStatusHeartbeat = () => {
    if (streamStatusHeartbeat == null) return;
    clearIntervalFn(streamStatusHeartbeat);
    streamStatusHeartbeat = null;
  };
  const stopStructuredStreamStatusUpdates = () => {
    streamStatusUpdatesClosed = true;
    clearStreamStatusHeartbeat();
  };
  let structuredStreamInactiveRecorded = false;
  const recordStructuredStreamInactiveOnce = () => {
    if (structuredStreamInactiveRecorded) return;
    structuredStreamInactiveRecorded = true;
    taskState.structuredStreamUiActive = false;
    deps.recordInteractiveStreamUiSnapshot?.(binding.codepilotSessionId, { active: false });
  };
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
  let streamUiFinalizeAttempted = false;
  const finalizeStreamUiOnce = async (
    status: 'completed' | 'interrupted' | 'error',
    responseText: string,
  ): Promise<boolean> => {
    stopStructuredStreamStatusUpdates();
    recordStructuredStreamInactiveOnce();
    endPreviewOnce();
    if (hasStreamingCards && !streamUiFinalizeAttempted) {
      streamUiFinalizeAttempted = true;
      taskState.streamFinalized = await finalizeStreamingUi(
        streamFeedbackTarget,
        status,
        assembleDesktopFinalResponse({ text: responseText }),
      );
    }
    return taskState.streamFinalized;
  };

  const shouldSkipTextDelivery = (): boolean => {
    if (!hasStreamingCards) return false;
    if (taskState.structuredStreamUiActive) return true;
    if (adapter.hasActiveStreamingUi?.(msg.address.chatId, streamKey)) return true;
    return false;
  };
  const endMessageUiOnce = () => {
    if (taskState.uiEnded) return;
    adapter.onMessageEnd?.(msg.address.chatId, streamKey);
    taskState.uiEnded = true;
  };

  const onStreamCardText = hasStreamingCards ? (fullText: string) => {
    if (!deps.isCurrentInteractiveTask(binding.codepilotSessionId, taskId)) return;
    pushStreamFeedbackText(
      streamFeedbackTarget,
      stripFinalOnlyBlocksForStreaming(fullText),
    );
  } : undefined;

  const onToolEvent = (
    toolId: string,
    toolName: string,
    status: 'running' | 'complete' | 'error',
    detail?: { input?: unknown; output?: string; isError?: boolean },
  ) => {
    if (!deps.isCurrentInteractiveTask(binding.codepilotSessionId, taskId)) return;
    markActivity();
    deps.recordInteractiveHealthTool(binding.codepilotSessionId, toolId, toolName, status);
    if (toolName) {
      const existing = toolCallTracker.get(toolId);
      toolCallTracker.set(toolId, {
        id: toolId,
        name: toolName,
        status,
        input: existing?.input ?? null,
        output: existing?.output ?? null,
      });
    } else {
      const existing = toolCallTracker.get(toolId);
      if (existing) {
        existing.status = status;
      } else {
        toolCallTracker.set(toolId, { id: toolId, name: 'tool', status, input: null, output: null });
      }
    }
    if (detail && showSdkToolDetails) {
      const existing = toolCallTracker.get(toolId);
      if (existing) {
        if (typeof detail.input !== 'undefined') {
          existing.input = summarizeToolValue(detail.input, 900);
        }
        if (typeof detail.output === 'string') {
          existing.output = summarizeToolValue(detail.output, 1400);
        }
      }
    }
    if (hasStreamingCards) {
      pushStreamFeedbackTools(streamFeedbackTarget, Array.from(toolCallTracker.values()));
    }
    pushRunningStatus();
    syncStructuredStreamUiSnapshot();
  };

  const onTaskEvent = (tasks: TaskProgressInfo[]) => {
    if (!deps.isCurrentInteractiveTask(binding.codepilotSessionId, taskId)) return;
    markActivity();
    latestTasks = tasks;
    if (hasStreamingCards) {
      pushStreamFeedbackTasks(streamFeedbackTarget, latestTasks);
    }
    pushRunningStatus();
    syncStructuredStreamUiSnapshot();
  };

  const onStatusNote = (note: string | null) => {
    if (!deps.isCurrentInteractiveTask(binding.codepilotSessionId, taskId)) return;
    updateStreamStatusNote(streamState, note, nowMs());
    if (streamState.statusNote) markActivity();
    pushRunningStatus();
    syncStructuredStreamUiSnapshot();
  };

  const onPartialText = (fullText: string) => {
    if (!deps.isCurrentInteractiveTask(binding.codepilotSessionId, taskId)) return;
    if (fullText.trim()) {
      markContentResponse();
    }
    deps.recordInteractiveHealthProgress(binding.codepilotSessionId, 'text');
    previewOnPartialText?.(fullText);
    onStreamCardText?.(fullText);
    pushRunningStatus();
    syncStructuredStreamUiSnapshot();
  };

  const waitForDesktopTerminalFinalization = async (): Promise<ExternalTerminalFinalization | null> => {
    if (externalTerminalRequest) return externalTerminalRequest;
    const timeoutMs = Math.max(0, deps.desktopTerminalFinalizationTimeoutMs ?? 0);
    if (!desktopThreadId || !desktopTerminalFinalExpected || timeoutMs <= 0) return null;
    if (taskAbort.signal.aborted) return null;

    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (terminal: ExternalTerminalFinalization | null) => {
        if (settled) return;
        settled = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        taskAbort.signal.removeEventListener('abort', onAbort);
        resolve(terminal);
      };
      const onAbort = () => finish(null);

      timer = setTimeout(() => finish(null), timeoutMs);
      taskAbort.signal.addEventListener('abort', onAbort, { once: true });
      externalTerminalPromise.then((terminal) => {
        finish(terminal);
      }, () => {
        finish(null);
      });
    });
  };

  if (supportsStructuredStreamUi) {
    pushRunningStatus(null);
    streamStatusHeartbeat = setIntervalFn(() => {
      if (streamStatusUpdatesClosed) {
        clearStreamStatusHeartbeat();
        return;
      }
      if (!deps.isCurrentInteractiveTask(binding.codepilotSessionId, taskId) || taskAbort.signal.aborted) {
        clearStreamStatusHeartbeat();
        return;
      }
      const elapsedMs = nowMs() - taskStartedAt;
      const showLastResponseAge = shouldShowStreamLastContentResponseAge(streamState, nowMs(), {
        idleStartMs: streamStatusIdleDetectionStartMs,
        heartbeatMs: streamStatusHeartbeatMs,
      })
        ? getStreamLastContentResponseAgeMs(streamState, nowMs())
        : null;
      pushRunningStatus(showLastResponseAge);
      syncStructuredStreamUiSnapshot();
    }, streamStatusHeartbeatMs);
  }

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
    stopStructuredStreamStatusUpdates();
    endPreviewOnce();
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
        await forwardPermissionRequestImpl(
          adapter,
          msg.address,
          perm.permissionRequestId,
          perm.toolName,
          perm.toolInput,
          binding.codepilotSessionId,
          perm.suggestions,
          msg.messageId,
        );
        deps.recordInteractiveHealthProgress(
          binding.codepilotSessionId,
          'permission_wait',
          `当前正在等待工具 ${perm.toolName} 的权限确认。`,
        );
        markActivity();
        pushRunningStatus();
        syncStructuredStreamUiSnapshot();
      },
      taskAbort.signal,
      attachments && attachments.length > 0 ? attachments : undefined,
      onPartialText,
      onToolEvent,
      onTaskEvent,
      onStatusNote,
      (preparedPrompt) => {
        if (desktopThreadId) {
          desktopTerminalFinalExpected = true;
        }
        if (desktopThreadId && !taskState.mirrorSuppressionId) {
          taskState.mirrorSuppressionId = deps.beginMirrorSuppression(binding.codepilotSessionId, preparedPrompt);
        }
      },
      {
        expandToolCalls: showSdkToolDetails,
        streamPreview: {
          includeToolSnippets: showSdkToolDetails && !hasStreamingCards,
        },
      },
    );
    let raced: {
      kind: 'process';
      result: Awaited<ReturnType<typeof processMessageImpl>>;
    } | {
      kind: 'external';
      terminal: ExternalTerminalFinalization;
    };
    try {
      raced = await Promise.race([
        processPromise.then((result) => ({ kind: 'process' as const, result })),
        externalTerminalPromise.then((terminal) => ({ kind: 'external' as const, terminal })),
      ]);
    } catch (error) {
      if (!externalTerminalRequest) throw error;
      raced = { kind: 'external', terminal: externalTerminalRequest };
    }

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
          bridgeSessionId: binding.codepilotSessionId,
          channelType: msg.address.channelType,
          chatId: msg.address.chatId,
          codexThreadId: binding.sdkSessionId || null,
          workingDirectory: binding.workingDirectory || null,
        });
      }
      const staleTaskNotice = buildStaleTaskCompletionNotice(msg.address, binding);
      const terminalResponse = assembleDesktopFinalResponse({
        text: staleTaskNotice || raced.terminal.finalText || '',
      });
      const cardText = streamEndStatus === 'error' && !taskAbort.signal.aborted
        ? (() => {
          const detail = formatStreamingErrorForCard(raced.terminal.detail || 'External terminal failed', {
            bridgeSessionId: binding.codepilotSessionId,
            codexThreadId: binding.sdkSessionId || null,
            workingDirectory: binding.workingDirectory || null,
          });
          return terminalResponse.text.trim() ? `${terminalResponse.text.trim()}\n\n${detail}` : detail;
        })()
        : terminalResponse.text;
      if (hasStreamingCards && cardText.trim()) {
        pushStreamFeedbackText(streamFeedbackTarget, cardText);
        syncStructuredStreamUiSnapshot();
      }
      const cardFinalized = await finalizeStreamUiOnce(streamEndStatus, cardText);
      if (hasFinalResponsePayload(terminalResponse)) {
        await deliverFinalResponse({
          adapter,
          address: msg.address,
          sessionId: binding.codepilotSessionId,
          replyToMessageId: msg.messageId,
          deliverResponse: deps.deliverResponse,
        }, terminalResponse, { skipText: shouldSkipTextDelivery() || cardFinalized });
      }
      return;
    }

    const result = raced.result;
    processResultSettled = true;

    if (!deps.isCurrentInteractiveTask(binding.codepilotSessionId, taskId)) {
      shouldRecordHealthEnd = false;
      return;
    }

    const terminalAfterProcess = await waitForDesktopTerminalFinalization();
    if (!taskAbort.signal.aborted && result.hasError) {
      logInteractiveTaskError({
        kind: 'sdk',
        message: result.errorMessage,
        bridgeSessionId: binding.codepilotSessionId,
        channelType: msg.address.channelType,
        chatId: msg.address.chatId,
        codexThreadId: result.sdkSessionId || binding.sdkSessionId || null,
        workingDirectory: binding.workingDirectory || null,
      });
    }
    const terminalResponse = terminalAfterProcess?.outcome === 'completed'
      ? assembleDesktopFinalResponse({ text: terminalAfterProcess.finalText || '' })
      : null;
    const sdkResponse = assembleSdkFinalResponse({
      text: result.responseText,
      attachments: result.outboundAttachments,
      hasError: result.hasError,
      errorMessage: result.errorMessage,
    });
    const terminalHasFinalPayload = Boolean(
      terminalResponse && hasFinalResponsePayload(terminalResponse),
    );
    const effectiveResponse = terminalResponse && terminalHasFinalPayload
      ? mergeFinalResponses(terminalResponse, sdkResponse)
      : sdkResponse;

    let cardFinalized = false;
    const staleTaskNotice = buildStaleTaskCompletionNotice(msg.address, binding);
    const staleResponse = staleTaskNotice
      ? assembleDesktopFinalResponse({ text: staleTaskNotice })
      : null;
    if (hasStreamingCards) {
      const streamEndStatus = terminalAfterProcess
        ? terminalAfterProcess.outcome === 'completed'
          ? 'completed'
          : terminalAfterProcess.outcome === 'aborted'
            ? 'interrupted'
            : 'error'
        : taskAbort.signal.aborted
          ? 'interrupted'
          : result.hasError ? 'error' : 'completed';
      const baseCardText = staleResponse?.text || (streamEndStatus === 'interrupted' ? '' : effectiveResponse.text);
      const cardText = streamEndStatus === 'error' && !taskAbort.signal.aborted
        ? (() => {
          const detail = formatStreamingErrorForCard(result.errorMessage, {
            bridgeSessionId: binding.codepilotSessionId,
            codexThreadId: result.sdkSessionId || binding.sdkSessionId || null,
            workingDirectory: binding.workingDirectory || null,
          });
          return baseCardText.trim() ? `${baseCardText.trim()}\n\n${detail}` : detail;
        })()
        : baseCardText;
      if (cardText.trim()) {
        pushStreamFeedbackText(streamFeedbackTarget, cardText);
        syncStructuredStreamUiSnapshot();
      }
      cardFinalized = await finalizeStreamUiOnce(streamEndStatus, cardText);
    }

    if (staleResponse) {
      await deliverFinalResponse({
        adapter,
        address: msg.address,
        sessionId: binding.codepilotSessionId,
        replyToMessageId: msg.messageId,
        deliverResponse: deps.deliverResponse,
      }, staleResponse, { skipText: shouldSkipTextDelivery() || cardFinalized });
    } else if (hasFinalResponsePayload(effectiveResponse)) {
      await deliverFinalResponse({
        adapter,
        address: msg.address,
        sessionId: binding.codepilotSessionId,
        replyToMessageId: msg.messageId,
        deliverResponse: deps.deliverResponse,
      }, effectiveResponse, { skipText: shouldSkipTextDelivery() || cardFinalized });
    } else if (result.hasError && !taskAbort.signal.aborted) {
      const fallbackErrorText = formatStreamingErrorForCard(result.errorMessage, {
        bridgeSessionId: binding.codepilotSessionId,
        codexThreadId: result.sdkSessionId || binding.sdkSessionId || null,
        workingDirectory: binding.workingDirectory || null,
      });
      if (hasStreamingCards && fallbackErrorText.trim()) {
        pushStreamFeedbackText(streamFeedbackTarget, fallbackErrorText);
        syncStructuredStreamUiSnapshot();
      }
      await deliverFinalResponse({
          adapter,
          address: msg.address,
          sessionId: binding.codepilotSessionId,
          replyToMessageId: msg.messageId,
          deliverResponse: deps.deliverResponse,
        },
        assembleSdkFinalResponse({
          text: fallbackErrorText,
          hasError: true,
          errorMessage: result.errorMessage,
        }),
        { skipText: shouldSkipTextDelivery() },
      );
    }

    try {
      deps.persistSdkSessionUpdate(binding.codepilotSessionId, result.sdkSessionId, result.hasError);
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
        deps.abortMirrorSuppression(binding.codepilotSessionId, taskState.mirrorSuppressionId);
      } else {
        deps.settleMirrorSuppression(binding.codepilotSessionId, taskState.mirrorSuppressionId);
      }
      taskState.mirrorSuppressionId = null;
    }
    if (shouldRecordHealthEnd) {
      if (taskAbort.signal.aborted && !externalTerminalRequest) {
        finalOutcome = 'aborted';
        finalOutcomeDetail = finalOutcomeDetail || '任务已收到停止请求。';
      }
      deps.recordInteractiveHealthEnd(binding.codepilotSessionId, finalOutcome, finalOutcomeDetail);
    }
    deps.releaseInteractiveTask(binding.codepilotSessionId, taskId);
    deps.releaseBridgeTurn?.(binding.codepilotSessionId, taskId);
    endMessageUiOnce();
    settleExternalTerminalCompletion(taskState.streamFinalized || !hasStreamingCards);
  }
}
