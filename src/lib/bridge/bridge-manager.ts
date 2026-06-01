/**
 * Bridge Manager — singleton orchestrator for the multi-IM bridge system.
 *
 * Manages adapter lifecycles, routes inbound messages through the
 * conversation engine, and coordinates permission handling.
 *
 * Uses globalThis to survive Next.js HMR in development.
 */

import type {
  ChannelAddress,
  BridgeStatus,
  ChannelBinding,
  InboundMessage,
  OutboundRichCard,
} from './types.js';
import type { BaseChannelAdapter } from './channel-adapter.js';
import type { BridgeSession, PermissionLinkRecord } from './host.js';
import { inspect } from 'node:util';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
// Side-effect import: triggers self-registration of all adapter factories
import './adapters/index.js';
import * as router from './channel-router.js';
import * as broker from './permission-broker.js';
import { getBridgeContext } from './context.js';
import type { CodexMirrorRecord } from '../../codex/session-index.js';
import {
  sanitizeInput,
} from './security/validators.js';
import {
  normalizeReasoningEffort,
  normalizeSandboxMode,
} from '../../runtime-options.js';
import {
  resolveCommandAlias,
  isBridgeCommandText,
  toModelPromptText,
  handleBridgeCommand,
  buildGlobalStatusResponse,
} from './command.js';
import {
  toUserVisibleCommandError,
} from './command-errors.js';
import {
  buildCommandCallbackData,
  parseCommandCallbackData,
  AUTO_TASK_ACTION_CALLBACK_PREFIX,
  AUTO_TASK_SELECT_CALLBACK_PREFIX,
  type AutoTaskCardAction,
  type ThreadCardAction,
  THREAD_SELECT_ACTION_CALLBACK_PREFIX,
  THREAD_SELECT_CALLBACK_PREFIX,
} from './command-callbacks.js';
import {
  appendMirrorTimeoutNotice,
  buildInteractiveStreamKey,
  buildMirrorStreamKey,
  buildMirrorTitle,
  formatMirrorMessage,
  formatMirrorUserText,
} from './mirror-formatters.js';
import {
  consumeBufferedMirrorTurns as consumeBufferedMirrorTurnsBase,
  consumeMirrorRecords as consumeMirrorRecordsBase,
  flushTimedOutMirrorTurn as flushTimedOutMirrorTurnBase,
  hasPendingMirrorWork as hasPendingMirrorWorkBase,
  type FinalizedCodexMirrorTurn,
} from './mirror-turns.js';
import {
  abortMirrorSuppression as abortMirrorSuppressionBase,
  beginMirrorSuppression as beginMirrorSuppressionBase,
  filterSuppressedMirrorRecords as filterSuppressedMirrorRecordsBase,
  isMirrorSuppressed as isMirrorSuppressedBase,
  settleMirrorSuppression as settleMirrorSuppressionBase,
  type MirrorSuppressionConfig,
  type MirrorSuppressionState,
  type MirrorSuppressionStore,
} from './mirror-suppression.js';
import { type CodexMirrorSubscription } from './mirror-subscription-state.js';
import {
  buildAdapterConfigFingerprint,
} from './adapter-sync-plan.js';
import {
  createAdapterRuntime,
  type BridgeAdapterRuntimeState,
} from './bridge-adapter-runtime.js';
import {
  formatBindingChatLabel,
} from './bridge-channel-runtime.js';
import {
  formatDisplayedModel,
  getCodexSessionByThreadIdSafe,
  resolveDisplayedModel,
  resolveNewWorkingDirectory,
  resolveNewSessionWorkingDirectory,
} from './bridge-session-support.js';
import { ThreadDisplayService } from './thread-display-resolver.js';
import {
  runInteractiveMessage,
} from './interactive-turn/runner.js';
import {
  resolveInteractiveTurnEnvironment as resolveInteractiveTurnEnvironmentBase,
  resolveInteractiveTurnRuntimeSettings,
} from './interactive-turn/turn-environment.js';
import {
  getAutoTask,
  listAutoTasks,
  pauseAutoTasksForSession,
  updateAutoTask,
  type AutoTask,
} from './auto-tasks.js';
import {
  createInteractiveRuntime,
  type BridgeInteractiveRuntimeState,
} from './interactive-runtime.js';
import { createMirrorRuntime } from './mirror-runtime.js';
import {
  createMirrorFeedbackController,
  type MirrorStructuredStreamStatusConfig,
} from './mirror-feedback-controller.js';
import { probeCodexThreadProcess } from './session-health-process.js';
import { createSessionHealthRuntime } from './session-health-runtime.js';
import { deliverBridgeNotice, deliverResponse } from './feedback-delivery.js';
import { routeCodexRecords } from './turns/local-codex-terminal-router.js';
import { createTurnCoordinator } from './turns/turn-coordinator.js';
import type { BridgeTurnTerminalRecord } from './turns/turn-types.js';
import { consumeSseEvents } from './sse-stream-decoder.js';

const GLOBAL_KEY = '__bridge_manager__';
const DANGLING_MIRROR_THREAD_RETRY_LIMIT = 3;
const MIRROR_FAILURE_SUSPEND_MS = 60_000;
const MIRROR_FAILURE_SUSPEND_THRESHOLD = 3;
const MIRROR_POLL_INTERVAL_MS = 2_500;
const MIRROR_WATCH_DEBOUNCE_MS = 350;
const MIRROR_EVENT_BATCH_LIMIT = 8;
const MIRROR_SUPPRESSION_WINDOW_MS = 4_000;
const MIRROR_PROMPT_MATCH_GRACE_MS = 120_000;
// When IM drives a Codex thread, Codex task_complete is the canonical
// final source. If the SDK stream finishes first, wait for the terminal JSONL
// record before falling back to the SDK response.
const DESKTOP_TERMINAL_FINALIZATION_TIMEOUT_MS = 30_000;
const MIRROR_STREAM_STATUS_IDLE_START_MS = 180_000;
const MIRROR_STREAM_STATUS_HEARTBEAT_MS = 10_000;
const TMUX_SCREEN_STOP_CALLBACK_PREFIX = 'tmux-screen:stop:';
// Timeout after the last Codex event before we flush a buffered mirror turn
// without seeing task_complete. This is an internal mirror buffer guard, not an
// IM idle reminder. Active streaming turns never use this fallback timeout.
const MIRROR_TURN_BUFFER_TIMEOUT_MS = 10 * 60_000;
const STARTUP_NOTICE_TITLE = 'Bridge 已启动';
const STARTUP_NOTICE_CARD_TEMPLATE = 'turquoise';
const AUTO_SCRIPT_OUTPUT_LIMIT = 64_000;

// ── Streaming preview helpers ──────────────────────────────────

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`;
  }
  if (error === null) return 'null';
  if (typeof error === 'undefined') return 'undefined';
  if (typeof error === 'object') {
    const ctor = (error as { constructor?: { name?: string } })?.constructor?.name;
    const rendered = inspect(error, {
      depth: 4,
      breakLength: Infinity,
      compact: true,
    });
    return ctor && ctor !== 'Object' ? `${ctor} ${rendered}` : rendered;
  }
  return String(error);
}

function nowIso(): string {
  return new Date().toISOString();
}

function getPendingPermissionLinksForCurrentSession(
  chatId: string,
  sessionId?: string,
): PermissionLinkRecord[] {
  const { store } = getBridgeContext();
  const pending = store.listPendingPermissionLinksByChat(chatId);
  if (!sessionId) return pending;
  return pending.filter((link) => !link.sessionId || link.sessionId === sessionId);
}

function channelAddressFromBinding(binding: {
  channelType: string;
  channelProvider?: string;
  channelAlias?: string;
  chatId: string;
  chatUserId?: string;
  chatDisplayName?: string;
}): ChannelAddress {
  return {
    channelType: binding.channelType,
    channelProvider: binding.channelProvider,
    channelAlias: binding.channelAlias,
    chatId: binding.chatId,
    userId: binding.chatUserId,
    displayName: binding.chatDisplayName,
  };
}


/**
 * Check if a message looks like a numeric permission shortcut (1/2/3) for
 * Feishu/Weixin channels WITH at least one pending permission in that chat.
 *
 * This is used by the adapter loop to route these messages to the inline
 * (non-session-locked) path, avoiding deadlock: the session is blocked
 * waiting for the permission to be resolved, so putting "1" behind the
 * session lock would deadlock.
 */
function isNumericPermissionShortcut(channelType: string, rawText: string, chatId: string): boolean {
  if (channelType !== 'feishu' && channelType !== 'weixin') return false;
  const normalized = rawText.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!/^[123]$/.test(normalized)) return false;
  const { store } = getBridgeContext();
  const pending = store.listPendingPermissionLinksByChat(chatId);
  return pending.length > 0; // any pending → route to inline path
}

interface BridgeManagerState extends BridgeAdapterRuntimeState, BridgeInteractiveRuntimeState {
  startedAt: string | null;
  reconcileTimer: NodeJS.Timeout | null;
  mirrorPollTimer: NodeJS.Timeout | null;
  mirrorWakeTimer: NodeJS.Timeout | null;
  mirrorSubscriptions: Map<string, CodexMirrorSubscription>;
  mirrorSyncInFlight: boolean;
  mirrorSuppressUntil: Map<string, MirrorSuppressionState[]>;
  mirrorIgnoredTurnIds: Map<string, Map<string, number>>;
  threadCardSelections: Map<string, string>;
  autoTaskSelections: Map<string, string>;
  autoTaskRuntimes: Map<string, AutoTaskRuntimeState>;
  autoStartChecked: boolean;
}

interface AutoTaskRuntimeState {
  abortController: AbortController;
  bridgeSessionId: string;
  child: ChildProcessWithoutNullStreams | null;
}

function getState(): BridgeManagerState {
  const g = globalThis as unknown as Record<string, BridgeManagerState>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      adapters: new Map(),
      adapterMeta: new Map(),
      invalidAdapters: new Map(),
      running: false,
      startedAt: null,
      loopAborts: new Map(),
      reconcileTimer: null,
      mirrorPollTimer: null,
      mirrorWakeTimer: null,
      activeTasks: new Map(),
      mirrorSubscriptions: new Map(),
      mirrorSyncInFlight: false,
      mirrorSuppressUntil: new Map(),
      mirrorIgnoredTurnIds: new Map(),
      threadCardSelections: new Map(),
      autoTaskSelections: new Map(),
      autoTaskRuntimes: new Map(),
      queuedCounts: new Map(),
      sessionLocks: new Map(),
      autoStartChecked: false,
    };
  }
  // Backfill sessionLocks for states created before this field existed
  if (!g[GLOBAL_KEY].sessionLocks) {
    g[GLOBAL_KEY].sessionLocks = new Map();
  }
  if (!g[GLOBAL_KEY].mirrorSubscriptions) {
    g[GLOBAL_KEY].mirrorSubscriptions = new Map();
  }
  if (!g[GLOBAL_KEY].invalidAdapters) {
    g[GLOBAL_KEY].invalidAdapters = new Map();
  }
  if (!g[GLOBAL_KEY].queuedCounts) {
    g[GLOBAL_KEY].queuedCounts = new Map();
  }
  if (!g[GLOBAL_KEY].mirrorSuppressUntil) {
    g[GLOBAL_KEY].mirrorSuppressUntil = new Map();
  }
  if (!g[GLOBAL_KEY].mirrorIgnoredTurnIds) {
    g[GLOBAL_KEY].mirrorIgnoredTurnIds = new Map();
  }
  if (!g[GLOBAL_KEY].threadCardSelections) {
    g[GLOBAL_KEY].threadCardSelections = new Map();
  }
  if (!g[GLOBAL_KEY].autoTaskSelections) {
    g[GLOBAL_KEY].autoTaskSelections = new Map();
  }
  if (!g[GLOBAL_KEY].autoTaskRuntimes) {
    g[GLOBAL_KEY].autoTaskRuntimes = new Map();
  }
  if (!Object.prototype.hasOwnProperty.call(g[GLOBAL_KEY], 'mirrorSyncInFlight')) {
    g[GLOBAL_KEY].mirrorSyncInFlight = false;
  }
  return g[GLOBAL_KEY];
}

const INTERACTIVE_RUNTIME = createInteractiveRuntime(getState, {
  getStore: () => getBridgeContext().store,
  nowIso,
});

function formatCodexTerminalDetail(terminal: BridgeTurnTerminalRecord): string {
  if (terminal.outcome === 'aborted') {
    return '检测到 Codex thread已停止当前任务。';
  }
  if (terminal.outcome === 'failed') {
    return '检测到 Codex thread当前任务执行失败。';
  }
  return '检测到 Codex thread已完成当前任务。';
}

const TURN_COORDINATOR = createTurnCoordinator({
  finalizeTerminalTurn: (turn, terminal) => INTERACTIVE_RUNTIME.finalizeTerminalActiveTask(
    turn.sessionId,
    terminal.outcome,
    formatCodexTerminalDetail(terminal),
    terminal.text,
  ),
});

const SESSION_HEALTH_RUNTIME = createSessionHealthRuntime({
  getStore: () => getBridgeContext().store,
  nowIso,
  probeThreadProcess: (threadId) => probeCodexThreadProcess(threadId),
});

const MIRROR_SUPPRESSION_CONFIG: MirrorSuppressionConfig = {
  suppressionWindowMs: MIRROR_SUPPRESSION_WINDOW_MS,
  promptMatchGraceMs: MIRROR_PROMPT_MATCH_GRACE_MS,
};

function getMirrorSuppressionStore(): MirrorSuppressionStore {
  const state = getState();
  return {
    suppressions: state.mirrorSuppressUntil,
    ignoredTurnIds: state.mirrorIgnoredTurnIds,
  };
}

function beginMirrorSuppression(sessionId: string, promptText: string): string {
  return beginMirrorSuppressionBase(getMirrorSuppressionStore(), sessionId, promptText);
}

function abortMirrorSuppression(
  sessionId: string,
  suppressionId?: string | null,
): void {
  abortMirrorSuppressionBase(
    getMirrorSuppressionStore(),
    sessionId,
    MIRROR_SUPPRESSION_CONFIG,
    suppressionId,
  );
}

function settleMirrorSuppression(
  sessionId: string,
  suppressionId?: string | null,
  durationMs = MIRROR_SUPPRESSION_WINDOW_MS,
): void {
  settleMirrorSuppressionBase(
    getMirrorSuppressionStore(),
    sessionId,
    MIRROR_SUPPRESSION_CONFIG,
    suppressionId,
    durationMs,
  );
}

function isMirrorSuppressed(sessionId: string): boolean {
  return isMirrorSuppressedBase(getMirrorSuppressionStore(), sessionId);
}

function filterSuppressedMirrorRecords(
  sessionId: string,
  records: CodexMirrorRecord[],
): CodexMirrorRecord[] {
  return filterSuppressedMirrorRecordsBase(
    getMirrorSuppressionStore(),
    sessionId,
    records,
    MIRROR_SUPPRESSION_CONFIG,
  );
}

function syncMirrorSessionState(sessionId: string): void {
  const { store } = getBridgeContext();
  const session = store.getSession(sessionId);
  if (!session) return;

  const subscriptions = Array.from(getState().mirrorSubscriptions.values())
    .filter((item) => item.sessionId === sessionId);
  const mirrorStatus: BridgeSession['mirror_status'] = subscriptions.length === 0
    ? 'inactive'
    : subscriptions.some((item) => item.status === 'watching')
      ? 'watching'
      : subscriptions.some((item) => item.status === 'stale')
        ? 'stale'
        : 'inactive';

  const deliveredAt = subscriptions
    .map((item) => item.lastDeliveredAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) || session.mirror_last_event_at;

  if (
    session.mirror_status === mirrorStatus
    && session.mirror_last_event_at === deliveredAt
  ) {
    return;
  }

  store.updateSession(sessionId, {
    mirror_status: mirrorStatus,
    mirror_last_event_at: deliveredAt,
  });
}

function syncMirrorSessionStateSafe(sessionId: string, context: string): void {
  try {
    syncMirrorSessionState(sessionId);
  } catch (error) {
    console.error(
      `[bridge-manager] Failed to sync mirror session state for ${sessionId} during ${context}:`,
      describeUnknownError(error),
    );
  }
}

function getMirrorStructuredStreamStatusConfig(): {
  idleStartMs: number;
  heartbeatMs: number;
} {
  const { store } = getBridgeContext();
  const idleStartSeconds = parseInt(store.getSetting('bridge_stream_status_idle_start_seconds') || '', 10);
  const heartbeatSeconds = parseInt(store.getSetting('bridge_stream_status_check_interval_seconds') || '', 10);
  return {
    idleStartMs: Math.max(
      0,
      (Number.isFinite(idleStartSeconds) && idleStartSeconds > 0 ? idleStartSeconds : MIRROR_STREAM_STATUS_IDLE_START_MS / 1000) * 1000,
    ),
    heartbeatMs: Math.max(
      1_000,
      (Number.isFinite(heartbeatSeconds) && heartbeatSeconds > 0 ? heartbeatSeconds : MIRROR_STREAM_STATUS_HEARTBEAT_MS / 1000) * 1000,
    ),
  };
}

function getMirrorThreadTitle(threadId: string, sessionId?: string): string | null {
  const { store } = getBridgeContext();
  const session = sessionId ? store.getSession(sessionId) : null;
  const codexSession = getCodexSessionByThreadIdSafe(threadId, 'mirror title');
  if (!session && !codexSession) return null;
  return new ThreadDisplayService(store).thread(threadId, sessionId, { stripInternalPrefix: true }).title;
}

const MIRROR_FEEDBACK = createMirrorFeedbackController({
  getAdapter: (channelType) => getState().adapters.get(channelType) || null,
  getThreadTitle: getMirrorThreadTitle,
  getStructuredStreamStatusConfig: getMirrorStructuredStreamStatusConfig,
  nowIso,
  eventBatchLimit: MIRROR_EVENT_BATCH_LIMIT,
  deliverResponse,
});

function refreshMirrorStreamingStatus(
  subscription: CodexMirrorSubscription,
  nowMs = Date.now(),
  config: MirrorStructuredStreamStatusConfig = getMirrorStructuredStreamStatusConfig(),
): void {
  MIRROR_FEEDBACK.refreshMirrorStreamingStatus(subscription, nowMs, config);
}

function refreshActiveMirrorStreamingStatuses(nowMs = Date.now()): void {
  for (const subscription of getState().mirrorSubscriptions.values()) {
    refreshMirrorStreamingStatus(subscription, nowMs);
  }
}

function stopMirrorStreaming(
  subscription: CodexMirrorSubscription,
  status: 'completed' | 'interrupted' = 'interrupted',
): void {
  MIRROR_FEEDBACK.stopMirrorStreaming(subscription, status);
}

async function deliverMirrorTurns(
  subscription: CodexMirrorSubscription,
  turns: FinalizedCodexMirrorTurn[],
): Promise<{ deliveredCount: number; error?: unknown }> {
  return MIRROR_FEEDBACK.deliverMirrorTurns(subscription, turns);
}

const MIRROR_TURN_HOOKS = MIRROR_FEEDBACK.hooks;

function consumeMirrorRecords(
  subscription: CodexMirrorSubscription,
  records: CodexMirrorRecord[],
): FinalizedCodexMirrorTurn[] {
  return consumeMirrorRecordsBase(subscription, records, MIRROR_TURN_HOOKS);
}

function flushTimedOutMirrorTurn(
  subscription: CodexMirrorSubscription,
  nowMs = Date.now(),
): FinalizedCodexMirrorTurn | null {
  if (subscription.pendingTurn?.streamStarted) {
    return null;
  }
  return flushTimedOutMirrorTurnBase(subscription, MIRROR_TURN_BUFFER_TIMEOUT_MS, nowMs);
}

function hasPendingMirrorWork(subscription: CodexMirrorSubscription): boolean {
  return hasPendingMirrorWorkBase(subscription);
}

function consumeBufferedMirrorTurns(
  subscription: CodexMirrorSubscription,
  nowMs = Date.now(),
): FinalizedCodexMirrorTurn[] {
  const timeoutMs = subscription.pendingTurn?.streamStarted
    ? Number.POSITIVE_INFINITY
    : MIRROR_TURN_BUFFER_TIMEOUT_MS;
  return consumeBufferedMirrorTurnsBase(subscription, timeoutMs, nowMs, MIRROR_TURN_HOOKS);
}

const MIRROR_RUNTIME = createMirrorRuntime(getState, {
  watchDebounceMs: MIRROR_WATCH_DEBOUNCE_MS,
  danglingThreadRetryLimit: DANGLING_MIRROR_THREAD_RETRY_LIMIT,
  failureSuspendThreshold: MIRROR_FAILURE_SUSPEND_THRESHOLD,
  failureSuspendMs: MIRROR_FAILURE_SUSPEND_MS,
}, {
  nowIso,
  describeUnknownError,
  listChannelBindings: () => getBridgeContext().store.listChannelBindings(),
  getSession: (sessionId) => getBridgeContext().store.getSession(sessionId),
  clearSessionCodexThreadId: (sessionId) => {
    getBridgeContext().store.updateSessionCodexThreadId(sessionId, '');
  },
  getCodexSessionByThreadIdSafe,
  syncMirrorSessionStateSafe,
  filterSuppressedMirrorRecords,
  observeSessionHealthRecords: (sessionId, threadId, records) => {
    SESSION_HEALTH_RUNTIME.observeCodexMirrorRecords(sessionId, threadId, records);
  },
  routeCodexRecords: (sessionId, threadId, records) => routeCodexRecords(
    sessionId,
    threadId,
    records,
    TURN_COORDINATOR,
  ),
  consumeMirrorRecords,
  flushTimedOutMirrorTurn: (subscription) => flushTimedOutMirrorTurn(subscription),
  hasPendingMirrorWork,
  consumeBufferedMirrorTurns: (subscription) => consumeBufferedMirrorTurns(subscription),
  stopMirrorStreaming,
  deliverMirrorTurns,
});

function resetMirrorSessionForInteractiveRun(sessionId: string): void {
  MIRROR_RUNTIME.resetMirrorSessionForInteractiveRun(sessionId);
}

async function reconcileMirrorSubscriptions(): Promise<void> {
  await MIRROR_RUNTIME.reconcileMirrorSubscriptions();
  refreshActiveMirrorStreamingStatuses();
}

function clearMirrorSubscriptions(): void {
  MIRROR_RUNTIME.clearMirrorSubscriptions();
}

const ADAPTER_RUNTIME = createAdapterRuntime(getState, {
  notifyAdapterSetChanged: (channelTypes) => {
    const { lifecycle } = getBridgeContext();
    lifecycle.onBridgeAdaptersChanged?.(channelTypes);
  },
  handleMessage,
  processWithSessionLock: (sessionId, fn) => INTERACTIVE_RUNTIME.processWithSessionLock(sessionId, fn),
  isNumericPermissionShortcut,
  resolveSessionIdForMessage: (msg) => router.resolve(msg.address).bridgeSessionId,
});

/**
 * Start the bridge system.
 * Checks feature flags, registers enabled adapters, starts polling loops.
 */
export async function start(): Promise<void> {
  const state = getState();
  if (state.running) return;

  const { store, lifecycle } = getBridgeContext();

  const bridgeEnabled = store.getSetting('remote_bridge_enabled') === 'true';
  if (!bridgeEnabled) {
    console.log('[bridge-manager] Bridge not enabled (remote_bridge_enabled != true)');
    return;
  }

  INTERACTIVE_RUNTIME.resetPersistedInteractiveRuntimeState();
  await ADAPTER_RUNTIME.syncConfiguredAdapters({ startLoops: false });
  const startedCount = state.adapters.size;

  // Only mark as running if at least one adapter started successfully
  if (startedCount === 0) {
    console.warn('[bridge-manager] No adapters started successfully, bridge not activated');
    state.adapters.clear();
    state.adapterMeta.clear();
    return;
  }

  // Mark running BEFORE starting consumer loops — runAdapterLoop checks
  // state.running in its while-condition, so it must be true first.
  state.running = true;
  state.startedAt = new Date().toISOString();

  // Notify host that bridge is starting (e.g., suppress competing polling)
  lifecycle.onBridgeStart?.();

  // Now start the consumer loops (state.running is already true)
  for (const [, adapter] of state.adapters) {
    if (adapter.isRunning()) {
      ADAPTER_RUNTIME.runAdapterLoop(adapter);
    }
  }

  state.reconcileTimer = setInterval(() => {
    void ADAPTER_RUNTIME.syncConfiguredAdapters({ startLoops: true }).catch((err) => {
      console.error('[bridge-manager] Adapter reconcile failed:', err);
    });
    try {
      SESSION_HEALTH_RUNTIME.reconcileSessionHealth();
    } catch (err) {
      console.error('[bridge-manager] Session health reconcile failed:', describeUnknownError(err));
    }
    void INTERACTIVE_RUNTIME.reconcileTerminalSessionRuntimeState().catch((err) => {
      console.error('[bridge-manager] Terminal interactive reconcile failed:', describeUnknownError(err));
    });
  }, 5_000);

  state.mirrorPollTimer = setInterval(() => {
    void reconcileMirrorSubscriptions().catch((err) => {
      console.error('[bridge-manager] Mirror reconcile failed:', describeUnknownError(err));
    });
  }, MIRROR_POLL_INTERVAL_MS);
  void reconcileMirrorSubscriptions().catch((err) => {
    console.error('[bridge-manager] Initial mirror reconcile failed:', describeUnknownError(err));
  });
  startPersistedAutoTasks();

  console.log(`[bridge-manager] Bridge started with ${startedCount} adapter(s)`);
  void deliverStartupNotifications().catch((err) => {
    console.error('[bridge-manager] Startup notification failed:', describeUnknownError(err));
  });
}

/**
 * Stop the bridge system gracefully.
 */
export async function stop(): Promise<void> {
  const state = getState();
  if (!state.running) return;

  const { lifecycle } = getBridgeContext();

  state.running = false;

  if (state.reconcileTimer) {
    clearInterval(state.reconcileTimer);
    state.reconcileTimer = null;
  }
  if (state.mirrorPollTimer) {
    clearInterval(state.mirrorPollTimer);
    state.mirrorPollTimer = null;
  }
  if (state.mirrorWakeTimer) {
    clearTimeout(state.mirrorWakeTimer);
    state.mirrorWakeTimer = null;
  }

  // Abort all event loops
  for (const [, abort] of state.loopAborts) {
    abort.abort();
  }
  state.loopAborts.clear();

  const activeSessionIds = Array.from(state.activeTasks.keys());
  for (const task of state.activeTasks.values()) {
    task.abortController.abort();
  }
  state.activeTasks.clear();
  stopAllAutoTasks();
  state.mirrorSuppressUntil.clear();
  state.mirrorIgnoredTurnIds.clear();
  state.queuedCounts.clear();
  state.invalidAdapters.clear();
  ADAPTER_RUNTIME.clearWarningCache();
  for (const sessionId of activeSessionIds) {
    INTERACTIVE_RUNTIME.syncSessionRuntimeState(sessionId);
  }
  clearMirrorSubscriptions();

  // Stop all adapters
  for (const type of Array.from(state.adapters.keys())) {
    await ADAPTER_RUNTIME.stopAdapterInstance(type);
  }

  state.startedAt = null;

  // Notify host that bridge stopped
  lifecycle.onBridgeStop?.();

  console.log('[bridge-manager] Bridge stopped');
}

/**
 * Lazy auto-start: checks bridge_auto_start setting once and starts if enabled.
 * Called from POST /api/bridge with action 'auto-start' (triggered by Electron on startup).
 */
export function tryAutoStart(): void {
  const state = getState();
  if (state.autoStartChecked) return;
  state.autoStartChecked = true;

  if (state.running) return;

  const { store } = getBridgeContext();
  const autoStart = store.getSetting('bridge_auto_start');
  if (autoStart !== 'true') return;

  start().catch(err => {
    console.error('[bridge-manager] Auto-start failed:', err);
  });
}

/**
 * Get the current bridge status.
 */
export function getStatus(): BridgeStatus {
  const state = getState();
  return {
    running: state.running,
    startedAt: state.startedAt,
    adapters: Array.from(state.adapters.entries()).map(([type, adapter]) => {
      const meta = state.adapterMeta.get(type);
      return {
        channelType: adapter.channelType,
        channelProvider: adapter.provider,
        channelAlias: adapter.alias,
        running: adapter.isRunning(),
        connectedAt: state.startedAt,
        lastMessageAt: meta?.lastMessageAt ?? null,
        error: meta?.lastError ?? null,
      };
    }),
  };
}

async function deliverStartupNotifications(): Promise<void> {
  const state = getState();
  const { store } = getBridgeContext();
  const activeBindings = store
    .listChannelBindings()
    .filter((binding) => binding.active !== false);
  const seen = new Set<string>();
  const tasks: Array<Promise<unknown>> = [];

  for (const binding of activeBindings) {
    const adapter = state.adapters.get(binding.channelType);
    if (!adapter?.isRunning()) continue;
    const key = `${binding.channelType}:${binding.chatId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const statusText = buildGlobalStatusResponse(store, binding, true);
    const text = `${STARTUP_NOTICE_TITLE}\n\n${statusText}`;
    const richCard = buildStartupNoticeRichCard(statusText);
    tasks.push(deliverBridgeNotice(
      adapter,
      channelAddressFromBinding(binding),
      text,
      {
        sessionId: binding.bridgeSessionId,
        audit: false,
        richCard,
      },
    ).catch((err) => {
      console.error('[bridge-manager] Failed to send startup notification:', {
        channel_type: binding.channelType,
        chat_id: binding.chatId,
        error: describeUnknownError(err),
      });
    }));
  }

  await Promise.all(tasks);
}

function buildStartupNoticeRichCard(statusText: string): OutboundRichCard {
  return {
    title: STARTUP_NOTICE_TITLE,
    subtitle: 'Bridge 已连接并开始接收消息。',
    template: STARTUP_NOTICE_CARD_TEMPLATE,
    sections: [{
      markdown: statusText,
    }],
  };
}

function startPersistedAutoTasks(): void {
  const tasks = listAutoTasks({ includeCompleted: false })
    .filter((task) => task.status === 'running' && task.triggeredCount < task.times);
  for (const task of tasks) {
    startAutoTask(task.id);
  }
}

function startAutoTask(taskId: string): void {
  const state = getState();
  if (state.autoTaskRuntimes.has(taskId)) return;
  const task = getAutoTask(taskId);
  if (!task || task.status !== 'running' || task.triggeredCount >= task.times) return;

  const abortController = new AbortController();
  state.autoTaskRuntimes.set(taskId, {
    abortController,
    bridgeSessionId: task.bridgeSessionId,
    child: null,
  });
  void runAutoTaskLoop(taskId, abortController).finally(() => {
    state.autoTaskRuntimes.delete(taskId);
  });
}

function stopAutoTask(taskId: string): void {
  const runtime = getState().autoTaskRuntimes.get(taskId);
  if (!runtime) return;
  runtime.abortController.abort();
  runtime.child?.kill();
  void INTERACTIVE_RUNTIME.forceStopSession(
    runtime.bridgeSessionId,
    '自动化任务已删除，正在中止后台触发。',
  ).catch((error) => {
    console.error('[bridge-manager] Failed to stop auto task interactive turn:', describeUnknownError(error));
  });
}

function stopAllAutoTasks(): void {
  for (const taskId of Array.from(getState().autoTaskRuntimes.keys())) {
    stopAutoTask(taskId);
  }
  getState().autoTaskRuntimes.clear();
}

async function runAutoTaskLoop(taskId: string, abortController: AbortController): Promise<void> {
  while (!abortController.signal.aborted) {
    const task = getAutoTask(taskId);
    if (!task || task.status !== 'running') return;
    if (task.triggeredCount >= task.times) {
      updateAutoTask(task.id, { status: 'completed' });
      return;
    }

    const session = getBridgeContext().store.getSession(task.bridgeSessionId);
    if (!session) {
      updateAutoTask(task.id, {
        status: 'failed',
        lastError: `Bridge session 不存在：${task.bridgeSessionId}`,
      });
      return;
    }

    let scriptResult: AutoScriptRunResult;
    try {
      scriptResult = await runAutoScript(task, session, abortController);
    } catch (error) {
      if (abortController.signal.aborted) return;
      const detail = describeUnknownError(error);
      updateAutoTask(task.id, { status: 'failed', lastError: detail });
      await deliverAutoTaskNotice(task, `自动化脚本执行失败：\n\n${detail}`);
      return;
    }

    if (abortController.signal.aborted) return;
    if (scriptResult.exitCode !== 0) {
      const detail = [
        `exit_code: ${scriptResult.exitCode}`,
        scriptResult.stderr.trim() ? `stderr:\n${scriptResult.stderr.trim()}` : null,
      ].filter(Boolean).join('\n\n');
      updateAutoTask(task.id, { status: 'failed', lastError: detail });
      await deliverAutoTaskNotice(task, `自动化脚本执行失败：\n\n${detail}`);
      return;
    }

    const rawPrompt = scriptResult.stdout.trim();
    if (!rawPrompt) {
      updateAutoTask(task.id, { status: 'failed', lastError: '脚本没有输出 stdout，无法构造 Codex prompt。' });
      await deliverAutoTaskNotice(task, '自动化脚本没有输出 stdout，无法构造 Codex prompt。');
      return;
    }

    const { text: prompt, truncated } = sanitizeInput(rawPrompt, AUTO_SCRIPT_OUTPUT_LIMIT);
    const nextTriggeredCount = task.triggeredCount + 1;
    updateAutoTask(task.id, {
      triggeredCount: nextTriggeredCount,
      lastTriggeredAt: nowIso(),
      lastError: truncated ? '脚本 stdout 过长，已截断后发送给 Codex。' : undefined,
    });

    try {
      await runAutoTaskPrompt(task, session, prompt, nextTriggeredCount, abortController);
    } catch (error) {
      if (abortController.signal.aborted) return;
      const detail = describeUnknownError(error);
      updateAutoTask(task.id, { status: 'failed', lastError: detail });
      await deliverAutoTaskNotice(task, `自动化任务触发 Codex 失败：\n\n${detail}`);
      return;
    }

    if (abortController.signal.aborted) return;
    if (nextTriggeredCount >= task.times) {
      updateAutoTask(task.id, { status: 'completed' });
      return;
    }
  }
}

interface AutoScriptRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

async function runAutoScript(
  task: AutoTask,
  session: BridgeSession,
  abortController: AbortController,
): Promise<AutoScriptRunResult> {
  return await new Promise((resolve, reject) => {
    const runtime = getState().autoTaskRuntimes.get(task.id);
    const child = spawn(task.scriptPath, [], {
      cwd: session.working_directory || process.cwd(),
      env: process.env,
      windowsHide: true,
    });
    if (runtime) runtime.child = child;

    let stdout = '';
    let stderr = '';
    const onAbort = () => {
      child.kill();
    };
    const cleanup = () => {
      abortController.signal.removeEventListener('abort', onAbort);
      if (runtime) runtime.child = null;
    };
    const appendLimited = (current: string, chunk: Buffer): string => (
      (current + chunk.toString('utf-8')).slice(-AUTO_SCRIPT_OUTPUT_LIMIT)
    );
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on('error', (error) => {
      cleanup();
      reject(error);
    });
    child.on('close', (code) => {
      cleanup();
      resolve({ stdout, stderr, exitCode: code });
    });

    abortController.signal.addEventListener('abort', onAbort, { once: true });
    if (abortController.signal.aborted) {
      onAbort();
    }
  });
}

async function runAutoTaskPrompt(
  task: AutoTask,
  session: BridgeSession,
  prompt: string,
  triggeredCount: number,
  abortController: AbortController,
): Promise<void> {
  const adapter = getState().adapters.get(task.channelType);
  if (!adapter?.isRunning()) {
    updateAutoTask(task.id, {
      status: 'failed',
      lastError: `通道未运行：${task.channelType}`,
    });
    return;
  }

  const address = autoTaskAddress(task);
  const syntheticBinding = buildAutoTaskBinding(task, session);
  const messageId = `auto:${task.id}:${triggeredCount}`;
  const msg: InboundMessage = {
    address,
    text: prompt,
    messageId,
    timestamp: Date.now(),
  };
  const displayService = new ThreadDisplayService(getBridgeContext().store);

  await runInteractiveMessage(adapter, msg, prompt, undefined, {
    registerInteractiveTask: (taskState) => INTERACTIVE_RUNTIME.registerInteractiveTask(taskState),
    registerBridgeTurn: (turn) => TURN_COORDINATOR.registerInteractiveTurn(turn),
    resetMirrorSessionForInteractiveRun,
    isCurrentInteractiveTask: (sessionId, taskStateId) => INTERACTIVE_RUNTIME.isCurrentInteractiveTask(sessionId, taskStateId),
    touchInteractiveTask: (sessionId, taskStateId) => INTERACTIVE_RUNTIME.touchInteractiveTask(sessionId, taskStateId),
    recordInteractiveHealthStart: (sessionId, detail) => SESSION_HEALTH_RUNTIME.recordInteractiveStart(sessionId, detail),
    recordInteractiveHealthProgress: (sessionId, type, detail) => SESSION_HEALTH_RUNTIME.recordInteractiveProgress(sessionId, type, detail),
    recordInteractiveHealthTool: (sessionId, toolId, toolName, status) => {
      SESSION_HEALTH_RUNTIME.recordToolState(sessionId, toolId, toolName, status);
    },
    recordInteractiveStreamUiSnapshot: (sessionId, snapshot) => {
      SESSION_HEALTH_RUNTIME.recordStructuredStreamUi(sessionId, snapshot);
    },
    recordInteractiveHealthEnd: (sessionId, outcome, detail) => SESSION_HEALTH_RUNTIME.recordInteractiveEnd(sessionId, outcome, detail),
    beginMirrorSuppression,
    abortMirrorSuppression,
    settleMirrorSuppression,
    releaseInteractiveTask: (sessionId, taskStateId) => INTERACTIVE_RUNTIME.releaseInteractiveTask(sessionId, taskStateId),
    releaseBridgeTurn: (sessionId, taskStateId) => TURN_COORDINATOR.releaseSessionTurn(sessionId, taskStateId),
    deliverResponse: (targetAdapter, targetAddress, responseText, sessionId, _replyToMessageId, attachments) => (
      deliverResponse(targetAdapter, targetAddress, responseText, sessionId, undefined, attachments)
    ),
    persistCodexThreadUpdate,
    resolveSdkConversationRuntime: () => ({
      store: getBridgeContext().store,
      llm: getBridgeContext().llm,
      consumeSseEvents,
      normalizeSandboxMode,
      normalizeReasoningEffort,
    }),
    resolveInteractiveTurnEnvironment: (_address, targetMessageId) => (
      resolveInteractiveTurnEnvironmentBase(address, targetMessageId, {
        resolveBinding: () => syntheticBinding,
        getBridgeSession: (sessionId) => getBridgeContext().store.getSession(sessionId),
        codexThreadExists: () => false,
      })
    ),
    resolveInteractiveTurnRuntimeSettings: (channelType) => resolveInteractiveTurnRuntimeSettings(
      channelType,
      (key) => getBridgeContext().store.getSetting(key),
    ),
    forwardPermissionRequest: broker.forwardPermissionRequest,
    buildStopCallbackData: (sessionId) => buildCommandCallbackData('/stop', sessionId),
    resolveInteractiveTurnDisplayInfo: () => displayService.binding(syntheticBinding, { stripInternalPrefix: true }),
    listInteractiveTurnBindings: (channelType) => getBridgeContext().store.listChannelBindings(channelType),
    codexTerminalFinalizationTimeoutMs: DESKTOP_TERMINAL_FINALIZATION_TIMEOUT_MS,
    nowMs: () => Date.now(),
  });

  if (abortController.signal.aborted) {
    await INTERACTIVE_RUNTIME.forceStopSession(
      task.bridgeSessionId,
      '自动化任务已中止。',
    );
  }
}

function buildAutoTaskBinding(task: AutoTask, session: BridgeSession): ChannelBinding {
  const timestamp = nowIso();
  return {
    id: `auto:${task.id}`,
    channelType: task.channelType,
    channelProvider: task.channelProvider,
    channelAlias: task.channelAlias,
    chatId: task.chatId,
    chatUserId: task.chatUserId,
    chatDisplayName: task.chatDisplayName,
    bridgeSessionId: task.bridgeSessionId,
    workingDirectory: session.working_directory,
    model: session.model,
    mode: session.preferred_mode || 'normal',
    active: true,
    createdAt: task.createdAt || timestamp,
    updatedAt: timestamp,
  };
}

function autoTaskAddress(task: AutoTask): ChannelAddress {
  return {
    channelType: task.channelType,
    channelProvider: task.channelProvider,
    channelAlias: task.channelAlias,
    chatId: task.chatId,
    userId: task.chatUserId,
    displayName: task.chatDisplayName,
  };
}

async function deliverAutoTaskNotice(task: AutoTask, text: string): Promise<void> {
  const adapter = getState().adapters.get(task.channelType);
  if (!adapter?.isRunning()) return;
  await deliverBridgeNotice(adapter, autoTaskAddress(task), text, {
    sessionId: task.bridgeSessionId,
    audit: true,
  });
}

function handleBindingRemovedForAutoTasks(binding: ChannelBinding): void {
  const paused = pauseAutoTasksForSession(binding.bridgeSessionId);
  for (const task of paused) {
    stopAutoTask(task.id);
  }
}

/**
 * Register a channel adapter.
 */
export function registerAdapter(adapter: BaseChannelAdapter): void {
  const state = getState();
  state.adapters.set(adapter.channelType, adapter);
  state.adapterMeta.set(adapter.channelType, {
    lastMessageAt: null,
    lastError: null,
    configFingerprint: '',
  });
}

function parseTmuxScreenStopCallback(callbackData: string): string | null | undefined {
  if (!callbackData.startsWith(TMUX_SCREEN_STOP_CALLBACK_PREFIX)) return undefined;
  const encodedSessionId = callbackData.slice(TMUX_SCREEN_STOP_CALLBACK_PREFIX.length);
  if (!encodedSessionId) return null;
  try {
    return decodeURIComponent(encodedSessionId);
  } catch {
    return null;
  }
}

function findBindingForCallbackSession(
  channelType: string,
  chatId: string,
  sessionId: string,
): ChannelBinding | null {
  const { store } = getBridgeContext();
  return store.listChannelBindings(channelType).find((binding) => (
    binding.chatId === chatId && binding.bridgeSessionId === sessionId
  )) || null;
}

function threadSelectionKey(msg: InboundMessage): string {
  return [
    msg.address.channelType,
    msg.address.chatId,
    msg.address.userId || '',
    msg.callbackMessageId || msg.messageId || '',
  ].join(':');
}

function autoTaskSelectionKey(msg: InboundMessage): string {
  return [
    msg.address.channelType,
    msg.address.chatId,
    msg.address.userId || '',
    msg.callbackMessageId || msg.messageId || '',
  ].join(':');
}

function parseThreadSelectCallback(callbackData: string): string | null | undefined {
  if (!callbackData.startsWith(THREAD_SELECT_CALLBACK_PREFIX)) return undefined;
  try {
    return decodeURIComponent(callbackData.slice(THREAD_SELECT_CALLBACK_PREFIX.length)).trim() || null;
  } catch {
    return null;
  }
}

function parseAutoTaskSelectCallback(callbackData: string): string | null | undefined {
  if (!callbackData.startsWith(AUTO_TASK_SELECT_CALLBACK_PREFIX)) return undefined;
  try {
    return decodeURIComponent(callbackData.slice(AUTO_TASK_SELECT_CALLBACK_PREFIX.length)).trim() || null;
  } catch {
    return null;
  }
}

function parseAutoTaskActionCallback(callbackData: string): AutoTaskCardAction | null | undefined {
  if (!callbackData.startsWith(AUTO_TASK_ACTION_CALLBACK_PREFIX)) return undefined;
  const raw = callbackData.slice(AUTO_TASK_ACTION_CALLBACK_PREFIX.length).trim();
  return raw === 'rm' || raw === 'set1' ? raw : null;
}

function parseThreadSelectActionCallback(callbackData: string): {
  scope: 'global' | 'bound';
  action: ThreadCardAction;
} | null | undefined {
  if (!callbackData.startsWith(THREAD_SELECT_ACTION_CALLBACK_PREFIX)) return undefined;
  const raw = callbackData.slice(THREAD_SELECT_ACTION_CALLBACK_PREFIX.length).trim();
  const parts = raw.split(':').filter(Boolean);
  const scope = parts.length === 2 ? parts[0] : 'global';
  const action = parts.length === 2 ? parts[1] : parts[0];
  if (
    (scope !== 'global' && scope !== 'bound')
    || (action !== 'bind' && action !== 'rm' && action !== 'use' && action !== 'archive')
  ) {
    return null;
  }
  return { scope, action };
}

function threadCardRefreshScopeForCommand(commandText: string): 'global' | 'bound' | null {
  const trimmed = commandText.trim();
  const commandToken = trimmed.split(/\s+/)[0] || '';
  const rawCommand = commandToken.split('@')[0].toLowerCase();
  const args = trimmed.slice(commandToken.length).trim();
  const resolvedCommand = resolveCommandAlias(rawCommand, args);
  if (resolvedCommand === '/threads' || resolvedCommand === '/thread') return 'global';
  if (resolvedCommand !== '/t') return null;
  const subcommand = args.split(/\s+/).filter(Boolean)[0]?.toLowerCase();
  return subcommand === 'ls' ? 'bound' : null;
}

/**
 * Handle a single inbound message.
 */
async function handleMessage(
  adapter: BaseChannelAdapter,
  msg: InboundMessage,
): Promise<void> {
  const { store } = getBridgeContext();

  // Update lastMessageAt for this adapter
  const adapterState = getState();
  const meta = adapterState.adapterMeta.get(adapter.channelType) || { lastMessageAt: null, lastError: null, configFingerprint: '' };
  meta.lastMessageAt = new Date().toISOString();
  adapterState.adapterMeta.set(adapter.channelType, meta);

  // Acknowledge the update offset after processing completes (or fails).
  // This ensures the adapter only advances its committed offset once the
  // message has been fully handled, preventing message loss on crash.
  const ack = () => {
    if (msg.updateId != null && adapter.acknowledgeUpdate) {
      adapter.acknowledgeUpdate(msg.updateId);
    }
  };

  // Handle callback queries (permission buttons and interactive command cards)
  if (msg.callbackData) {
    const selectedAutoTaskId = parseAutoTaskSelectCallback(msg.callbackData);
    if (selectedAutoTaskId !== undefined) {
      if (!selectedAutoTaskId) {
        await deliverBridgeNotice(adapter, msg.address, '这个下拉选项无效，请刷新后重试。');
      } else {
        getState().autoTaskSelections.set(autoTaskSelectionKey(msg), selectedAutoTaskId);
        await adapter.answerCallback?.(msg.messageId, '已选择');
      }
      ack();
      return;
    }

    const autoTaskAction = parseAutoTaskActionCallback(msg.callbackData);
    if (autoTaskAction !== undefined) {
      if (!autoTaskAction) {
        await deliverBridgeNotice(adapter, msg.address, '这个按钮的操作无效，请刷新后重试。');
        ack();
        return;
      }
      const taskId = getState().autoTaskSelections.get(autoTaskSelectionKey(msg));
      if (!taskId) {
        await deliverBridgeNotice(adapter, msg.address, '请先在下拉列表中选择一个自动化任务，再点击操作按钮。');
        ack();
        return;
      }
      const commandText = autoTaskAction === 'set1' ? '/auto set' : '/auto rm';
      await handleCommand(
        adapter,
        { ...msg, text: commandText, callbackData: undefined },
        commandText,
        { selectedAutoTaskId: taskId, selectedAutoTaskAction: autoTaskAction },
      );
      ack();
      return;
    }

    const selectedThreadId = parseThreadSelectCallback(msg.callbackData);
    if (selectedThreadId !== undefined) {
      if (!selectedThreadId) {
        await deliverBridgeNotice(adapter, msg.address, '这个下拉选项无效，请刷新后重试。');
      } else {
        getState().threadCardSelections.set(threadSelectionKey(msg), selectedThreadId);
        await adapter.answerCallback?.(msg.messageId, '已选择');
      }
      ack();
      return;
    }

    const threadAction = parseThreadSelectActionCallback(msg.callbackData);
    if (threadAction !== undefined) {
      if (!threadAction) {
        await deliverBridgeNotice(adapter, msg.address, '这个按钮的操作无效，请刷新后重试。');
        ack();
        return;
      }
      const threadId = getState().threadCardSelections.get(threadSelectionKey(msg));
      if (!threadId) {
        await deliverBridgeNotice(adapter, msg.address, '请先在下拉列表中选择一个线程，再点击绑定、解绑、归档或激活。');
        ack();
        return;
      }
      const commandText = threadAction.scope === 'global'
        ? threadAction.action === 'bind'
          ? `/t add ${threadId}`
          : threadAction.action === 'rm'
            ? `/t rm ${threadId}`
            : threadAction.action === 'archive'
              ? `/t archive ${threadId}`
              : `/t ${threadId}`
        : threadAction.action === 'rm'
          ? `/t rm ${threadId}`
          : threadAction.action === 'archive'
            ? `/t archive ${threadId}`
            : `/t use ${threadId}`;
      await handleCommand(
        adapter,
        { ...msg, text: commandText, callbackData: undefined },
        commandText,
        { threadCardRefreshScope: threadAction.scope, threadCardSelectedId: threadId },
      );
      ack();
      return;
    }

    const commandCallback = parseCommandCallbackData(msg.callbackData);
    if (commandCallback !== undefined) {
      if (!commandCallback) {
        await deliverBridgeNotice(adapter, msg.address, '这个按钮的命令数据无效，请改用纯文本命令。');
        ack();
        return;
      }
      const scopedBinding = commandCallback.scopeSessionId
        ? findBindingForCallbackSession(msg.address.channelType, msg.address.chatId, commandCallback.scopeSessionId)
        : null;
      if (commandCallback.scopeSessionId && !scopedBinding) {
        await deliverBridgeNotice(adapter, msg.address, '这个按钮对应的会话已不再绑定到当前聊天，请改用纯文本命令确认当前状态。');
        ack();
        return;
      }
      await handleCommand(
        adapter,
        { ...msg, text: commandCallback.commandText, callbackData: undefined },
        commandCallback.commandText,
        {
          scopedBinding,
          threadCardRefreshScope: threadCardRefreshScopeForCommand(commandCallback.commandText),
          threadCardSelectedId: getState().threadCardSelections.get(threadSelectionKey(msg)) || null,
        },
      );
      ack();
      return;
    }

    const tmuxScreenSessionId = parseTmuxScreenStopCallback(msg.callbackData);
    if (tmuxScreenSessionId !== undefined) {
      const binding = tmuxScreenSessionId
        ? findBindingForCallbackSession(msg.address.channelType, msg.address.chatId, tmuxScreenSessionId)
        : store.getChannelBinding(msg.address.channelType, msg.address.chatId);
      if (!binding) {
        await deliverBridgeNotice(adapter, msg.address, '这个停止按钮对应的会话已不再绑定到当前聊天，无法停止 tmux 屏幕定时刷新。');
      } else {
        await handleCommand(
          adapter,
          { ...msg, text: '/tmux-screen stop', callbackData: undefined },
          '/tmux-screen stop',
          { scopedBinding: binding },
        );
      }
      ack();
      return;
    }
    const handled = broker.handlePermissionCallback(msg.callbackData, msg.address.chatId, msg.callbackMessageId);
    if (handled) {
      await deliverBridgeNotice(adapter, msg.address, 'Permission response recorded.');
    }
    ack();
    return;
  }

  const rawText = msg.text.trim();
  const hasAttachments = msg.attachments && msg.attachments.length > 0;

  // Handle attachment-only download failures — surface error to user instead of silently dropping
  if (!rawText && !hasAttachments) {
    const rawData = msg.raw as {
      imageDownloadFailed?: boolean;
      attachmentDownloadFailed?: boolean;
      failedCount?: number;
      failedLabel?: string;
      userVisibleError?: string;
    } | undefined;
    if (rawData?.userVisibleError) {
      await deliverBridgeNotice(adapter, msg.address, rawData.userVisibleError, {
        replyToMessageId: msg.messageId,
      });
    } else if (rawData?.imageDownloadFailed || rawData?.attachmentDownloadFailed) {
      const failureLabel = rawData.failedLabel || (rawData.imageDownloadFailed ? 'image(s)' : 'attachment(s)');
      await deliverBridgeNotice(adapter, msg.address, `Failed to download ${rawData.failedCount ?? 1} ${failureLabel}. Please try sending again.`, {
        replyToMessageId: msg.messageId,
      });
    }
    ack();
    return;
  }

  // ── Numeric shortcut for permission replies (feishu/weixin only) ──
  // On mobile, typing `/perm allow <uuid>` is painful.
  // If the user sends "1", "2", or "3" and there is exactly one pending
  // permission for this chat, map it: 1→allow, 2→allow_session, 3→deny.
  //
  // Input normalization: mobile keyboards / IM clients may send fullwidth
  // digits (１２３), digits with zero-width joiners, or other Unicode
  // variants. NFKC normalization folds them all to ASCII 1/2/3.
  if (
          adapter.provider === 'feishu'
          || adapter.provider === 'weixin'
  ) {
    // eslint-disable-next-line no-control-regex
    const normalized = rawText.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    if (/^[123]$/.test(normalized)) {
      const currentBinding = store.getChannelBinding(msg.address.channelType, msg.address.chatId);
      const pendingLinks = getPendingPermissionLinksForCurrentSession(
        msg.address.chatId,
        currentBinding?.bridgeSessionId,
      );
      if (pendingLinks.length === 1) {
        const actionMap: Record<string, string> = { '1': 'allow', '2': 'allow_session', '3': 'deny' };
        const action = actionMap[normalized];
        const permId = pendingLinks[0].permissionRequestId;
        const callbackData = `perm:${action}:${permId}`;
        const handled = broker.handlePermissionCallback(callbackData, msg.address.chatId);
        const label = normalized === '1' ? 'Allow' : normalized === '2' ? 'Allow Session' : 'Deny';
        if (handled) {
          await deliverBridgeNotice(adapter, msg.address, `${label}: recorded.`, {
            replyToMessageId: msg.messageId,
          });
        } else {
          await deliverBridgeNotice(adapter, msg.address, 'Permission not found or already resolved.', {
            replyToMessageId: msg.messageId,
          });
        }
        ack();
        return;
      }
      if (pendingLinks.length > 1) {
        // Multiple pending permissions — numeric shortcut is ambiguous.
        await deliverBridgeNotice(adapter, msg.address, `当前有 ${pendingLinks.length} 条待处理权限，数字快捷回复会有歧义。请使用完整命令：\n/perm allow|allow_session|deny <id>`, {
          replyToMessageId: msg.messageId,
        });
        ack();
        return;
      }
      // pendingLinks.length === 0: no pending permissions, fall through as normal message
    } else if (rawText !== normalized && /^[123]$/.test(rawText) === false) {
      // Log when normalization changed the text — helps diagnose encoding issues
      const codePoints = [...rawText].map(c => 'U+' + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'));
      console.log(`[bridge-manager] Shortcut candidate raw codepoints: ${codePoints.join(' ')} → normalized: "${normalized}"`);
    }
  }

  const modelText = toModelPromptText(rawText);

  const tmuxProviderBinding = store.getChannelBinding(msg.address.channelType, msg.address.chatId);
  const tmuxProviderSession = tmuxProviderBinding ? store.getSession(tmuxProviderBinding.bridgeSessionId) : null;
  if (tmuxProviderSession?.codex_provider === 'tmux') {
    if (rawText.trim().toLowerCase() === '//clear') {
      await deliverBridgeNotice(adapter, msg.address, '当前处于 tmux Provider，不能通过 `//clear` 清空上下文。请通过 codex-to-im 手动创建新会话。', {
        replyToMessageId: msg.messageId,
      });
      ack();
      return;
    }
    if (hasAttachments) {
      await deliverBridgeNotice(adapter, msg.address, '当前处于 tmux Provider，普通附件不会自动转发到 Codex TUI。请先发送 `/provider sdk`，或在 Codex TUI 内自行读取本地文件。', {
        replyToMessageId: msg.messageId,
      });
      ack();
      return;
    }
    if (isBridgeCommandText(rawText)) {
      try {
        await handleCommand(adapter, msg, rawText);
      } catch (error) {
        const commandToken = rawText.trim().split(/\s+/)[0] || '';
        const rawCommand = commandToken.split('@')[0].toLowerCase();
        const args = rawText.trim().slice(commandToken.length).trim();
        const resolvedCommand = resolveCommandAlias(rawCommand, args);
        console.error(`[bridge-manager] tmux provider command failed: ${resolvedCommand}`, error);
        await deliverBridgeNotice(adapter, msg.address, toUserVisibleCommandError(resolvedCommand, error), {
          replyToMessageId: msg.messageId,
        });
      }
      ack();
      return;
    }
    const { text, truncated } = sanitizeInput(modelText);
    if (truncated) {
      console.warn(`[bridge-manager] tmux provider input truncated from ${modelText.length} to ${text.length} chars for chat ${msg.address.chatId}`);
      store.insertAuditLog({
        channelType: adapter.channelType,
        chatId: msg.address.chatId,
        direction: 'inbound',
        messageId: msg.messageId,
        summary: `[TRUNCATED] tmux provider input truncated from ${modelText.length} chars`,
      });
    }
    if (text) {
      try {
        await handleCommand(adapter, msg, `/tmux ${text}`);
      } catch (error) {
        console.error('[bridge-manager] tmux provider command forwarding failed: /tmux', error);
        await deliverBridgeNotice(adapter, msg.address, toUserVisibleCommandError('/tmux', error), {
          replyToMessageId: msg.messageId,
        });
      }
    }
    ack();
    return;
  }

  // Check for IM commands (before sanitization — commands are validated individually).
  // A leading double slash escapes one slash so users can send model prompts
  // that intentionally begin with "/" without invoking bridge commands.
  if (isBridgeCommandText(rawText)) {
    const parts = modelText.split(/\s+/);
    const rawCommand = parts[0].split('@')[0].toLowerCase();
    const args = parts.slice(1).join(' ').trim();
    const resolvedCommand = resolveCommandAlias(rawCommand, args);
    try {
      await handleCommand(adapter, msg, modelText);
    } catch (error) {
      console.error(`[bridge-manager] Command failed: ${resolvedCommand}`, error);
      await deliverBridgeNotice(adapter, msg.address, toUserVisibleCommandError(resolvedCommand, error), {
        replyToMessageId: msg.messageId,
      });
    }
    ack();
    return;
  }

  // Sanitize general message text before routing to conversation engine
  const { text, truncated } = sanitizeInput(modelText);
  if (truncated) {
    console.warn(`[bridge-manager] Input truncated from ${modelText.length} to ${text.length} chars for chat ${msg.address.chatId}`);
    store.insertAuditLog({
      channelType: adapter.channelType,
      chatId: msg.address.chatId,
      direction: 'inbound',
      messageId: msg.messageId,
      summary: `[TRUNCATED] Input truncated from ${modelText.length} chars`,
    });
  }

  if (!text && !hasAttachments) { ack(); return; }

  try {
    const displayService = new ThreadDisplayService(store);
    await runInteractiveMessage(adapter, msg, text, hasAttachments ? msg.attachments : undefined, {
      registerInteractiveTask: (task) => INTERACTIVE_RUNTIME.registerInteractiveTask(task),
      registerBridgeTurn: (turn) => TURN_COORDINATOR.registerInteractiveTurn(turn),
      resetMirrorSessionForInteractiveRun,
      isCurrentInteractiveTask: (sessionId, taskId) => INTERACTIVE_RUNTIME.isCurrentInteractiveTask(sessionId, taskId),
      touchInteractiveTask: (sessionId, taskId) => INTERACTIVE_RUNTIME.touchInteractiveTask(sessionId, taskId),
      recordInteractiveHealthStart: (sessionId, detail) => SESSION_HEALTH_RUNTIME.recordInteractiveStart(sessionId, detail),
      recordInteractiveHealthProgress: (sessionId, type, detail) => SESSION_HEALTH_RUNTIME.recordInteractiveProgress(sessionId, type, detail),
      recordInteractiveHealthTool: (sessionId, toolId, toolName, status) => {
        SESSION_HEALTH_RUNTIME.recordToolState(sessionId, toolId, toolName, status);
      },
      recordInteractiveStreamUiSnapshot: (sessionId, snapshot) => {
        SESSION_HEALTH_RUNTIME.recordStructuredStreamUi(sessionId, snapshot);
      },
      recordInteractiveHealthEnd: (sessionId, outcome, detail) => SESSION_HEALTH_RUNTIME.recordInteractiveEnd(sessionId, outcome, detail),
      beginMirrorSuppression,
      abortMirrorSuppression,
      settleMirrorSuppression,
      releaseInteractiveTask: (sessionId, taskId) => INTERACTIVE_RUNTIME.releaseInteractiveTask(sessionId, taskId),
      releaseBridgeTurn: (sessionId, taskId) => TURN_COORDINATOR.releaseSessionTurn(sessionId, taskId),
      deliverResponse,
      persistCodexThreadUpdate,
      resolveSdkConversationRuntime: () => ({
        store,
        llm: getBridgeContext().llm,
        consumeSseEvents,
        normalizeSandboxMode,
        normalizeReasoningEffort,
      }),
      resolveInteractiveTurnEnvironment: (address, messageId) => {
        return resolveInteractiveTurnEnvironmentBase(address, messageId, {
          resolveBinding: (targetAddress) => router.resolve(targetAddress),
          getBridgeSession: (sessionId) => store.getSession(sessionId),
          codexThreadExists: (threadId) => Boolean(getCodexSessionByThreadIdSafe(threadId, 'interactive turn classify')),
        });
      },
      resolveInteractiveTurnRuntimeSettings: (channelType) => resolveInteractiveTurnRuntimeSettings(
        channelType,
        (key) => store.getSetting(key),
      ),
      forwardPermissionRequest: broker.forwardPermissionRequest,
      buildStopCallbackData: (sessionId) => buildCommandCallbackData('/stop', sessionId),
      resolveInteractiveTurnDisplayInfo: (binding) => displayService.binding(binding, { stripInternalPrefix: true }),
      listInteractiveTurnBindings: (channelType) => store.listChannelBindings(channelType),
      codexTerminalFinalizationTimeoutMs: DESKTOP_TERMINAL_FINALIZATION_TIMEOUT_MS,
    });
  } finally {
    ack();
  }
}

/**
 * Handle IM slash commands.
 */
async function handleCommand(
  adapter: BaseChannelAdapter,
  msg: InboundMessage,
  text: string,
  options: {
    scopedBinding?: ChannelBinding | null;
    threadCardRefreshScope?: 'global' | 'bound' | null;
    threadCardSelectedId?: string | null;
    selectedAutoTaskId?: string | null;
    selectedAutoTaskAction?: AutoTaskCardAction | null;
  } = {},
): Promise<void> {
  await handleBridgeCommand(adapter, msg, text, {
    getActiveTask: (sessionId) => INTERACTIVE_RUNTIME.getActiveTask(sessionId),
    forceStopSession: (sessionId, detail) => INTERACTIVE_RUNTIME.forceStopSession(sessionId, detail),
    recordInteractiveHealthEnd: (sessionId, outcome, detail) => SESSION_HEALTH_RUNTIME.recordInteractiveEnd(sessionId, outcome, detail),
    reconcileMirrorSubscriptions,
    diagnoseSessionHealth: (sessionId) => SESSION_HEALTH_RUNTIME.diagnoseSessionHealth(sessionId),
    diagnoseAllActiveSessions: () => SESSION_HEALTH_RUNTIME.diagnoseAllActiveSessions(),
    scopedBinding: options.scopedBinding,
    threadCardRefreshScope: options.threadCardRefreshScope,
    threadCardSelectedId: options.threadCardSelectedId,
    selectedAutoTaskId: options.selectedAutoTaskId,
    selectedAutoTaskAction: options.selectedAutoTaskAction,
    startAutoTask,
    stopAutoTask,
    onBindingRemoved: handleBindingRemovedForAutoTasks,
  });
}

// ── Codex Thread Update Logic ────────────────────────────────

/**
 * Compute the codex_thread_id value to persist after a conversation result.
 * Returns the new value to write, or null if no update is needed.
 *
 * Rules:
   * - If result has a Codex thread id AND no error → save the new ID
 * - If result has a transient Codex resume/process-exit error → keep the
 *   current ID so the next turn stays in the same Codex thread.
   * - If result has another error (regardless of Codex thread id) → clear to empty string
 * - Otherwise → no update needed
 */
export function computeCodexThreadUpdate(
  codexThreadId: string | null | undefined,
  hasError: boolean,
  errorMessage?: string | null,
): string | null {
  if (codexThreadId && !hasError) {
    return codexThreadId;
  }
  if (hasError) {
    if (isTransientCodexResumeError(errorMessage)) {
      return null;
    }
    return '';
  }
  return null;
}

function isTransientCodexResumeError(message: string | null | undefined): boolean {
  const normalized = (message || '').toLowerCase();
  return normalized.includes('上一轮执行进程未正常退出')
    || normalized.includes('timeout waiting for child process to exit')
    || normalized.includes('reconnecting...');
}

function persistCodexThreadUpdate(
  sessionId: string,
  codexThreadId: string | null | undefined,
  hasError: boolean,
  errorMessage?: string | null,
): void {
  const update = computeCodexThreadUpdate(codexThreadId, hasError, errorMessage);
  if (update === null) {
    return;
  }
  const { store } = getBridgeContext();
  store.updateSessionCodexThreadId(sessionId, update);
  if (update) {
    const codexSession = getCodexSessionByThreadIdSafe(update, 'persist codex title');
    if (codexSession?.title) {
      store.updateSession(sessionId, { codex_title: codexSession.title }, { touch: false });
    }
  }
}

function resetStateForTests(): void {
  const state = getState();
  state.running = false;
  state.startedAt = null;
  state.adapters.clear();
  state.adapterMeta.clear();
  state.invalidAdapters.clear();
  ADAPTER_RUNTIME.clearWarningCache();
  state.loopAborts.clear();
  state.activeTasks.clear();
  stopAllAutoTasks();
  state.autoTaskSelections.clear();
  clearMirrorSubscriptions();
  state.mirrorSuppressUntil.clear();
  state.mirrorIgnoredTurnIds.clear();
  state.queuedCounts.clear();
  state.sessionLocks.clear();
  TURN_COORDINATOR.clear();
  state.mirrorSyncInFlight = false;
  if (state.reconcileTimer) {
    clearInterval(state.reconcileTimer);
    state.reconcileTimer = null;
  }
  if (state.mirrorPollTimer) {
    clearInterval(state.mirrorPollTimer);
    state.mirrorPollTimer = null;
  }
  if (state.mirrorWakeTimer) {
    clearTimeout(state.mirrorWakeTimer);
    state.mirrorWakeTimer = null;
  }
}

// ── Test-only export ─────────────────────────────────────────
// Exposed so integration tests can exercise handleMessage directly
// without wiring up the full adapter loop.
/** @internal */
export const _testOnly = {
  handleMessage,
  syncConfiguredAdapters: (options: { startLoops: boolean }) => ADAPTER_RUNTIME.syncConfiguredAdapters(options),
  reconcileMirrorSubscriptions,
  resolveNewWorkingDirectory,
  resolveNewSessionWorkingDirectory,
  resolveCommandAlias,
  isBridgeCommandText,
  toModelPromptText,
  resolveDisplayedModel,
  formatDisplayedModel,
  formatBindingChatLabel,
  formatMirrorUserText,
  formatMirrorMessage,
  buildInteractiveStreamKey,
  buildMirrorStreamKey,
  appendMirrorTimeoutNotice,
  buildAdapterConfigFingerprint,
  consumeMirrorRecords,
  consumeBufferedMirrorTurns,
  deliverMirrorTurns,
  flushTimedOutMirrorTurn,
  refreshMirrorStreamingStatus,
  filterSuppressedMirrorRecords,
  isMirrorSuppressed,
  reconcileTerminalSessionRuntimeState: () => INTERACTIVE_RUNTIME.reconcileTerminalSessionRuntimeState(),
  beginMirrorSuppression,
  abortMirrorSuppression,
  settleMirrorSuppression,
  persistCodexThreadUpdate,
  computeCodexThreadUpdate,
  deliverStartupNotifications,
  resetStateForTests,
};
