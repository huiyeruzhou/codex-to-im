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
} from './types.js';
import type { BaseChannelAdapter } from './channel-adapter.js';
import type { BridgeSession, PermissionLinkRecord } from './host.js';
import { inspect } from 'node:util';
// Side-effect import: triggers self-registration of all adapter factories
import './adapters/index.js';
import * as router from './channel-router.js';
import * as broker from './permission-broker.js';
import { getBridgeContext } from './context.js';
import type { DesktopMirrorRecord } from '../../desktop-sessions.js';
import {
  sanitizeInput,
} from './security/validators.js';
import {
  buildDesktopThreadsCommandResponse,
  formatCommandDateTime,
  formatMirrorStatus,
  formatRuntimeStatus,
  normalizeReasoningEffort,
  parseDesktopThreadListArgs,
  resolveCommandAlias,
  THREAD_SELECT_ACTION_CALLBACK_PREFIX,
  THREAD_SELECT_CALLBACK_PREFIX,
  isBridgeCommandText,
  toModelPromptText,
  toUserVisibleBindingError,
  toUserVisibleCommandError,
} from './command-helpers.js';
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
  type FinalizedDesktopMirrorTurn,
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
import { type DesktopMirrorSubscription } from './mirror-subscription-state.js';
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
import { parseCommandCallbackData } from './command-callbacks.js';
import {
  formatDisplayedModel,
  getDesktopSessionByThreadIdSafe,
  resolveDisplayedModel,
  resolveNewWorkingDirectory,
  resolveNewSessionWorkingDirectory,
} from './bridge-session-support.js';
import { buildGlobalStatusResponse, handleBridgeCommand } from './command-dispatch.js';
import { ThreadDisplayService } from './thread-display-resolver.js';
import {
  runInteractiveMessage,
} from './interactive-message-runner.js';
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
import { routeDesktopRecords } from './turns/desktop-terminal-router.js';
import { createTurnCoordinator } from './turns/turn-coordinator.js';
import type { BridgeTurnTerminalRecord } from './turns/turn-types.js';

const GLOBAL_KEY = '__bridge_manager__';
const DANGLING_MIRROR_THREAD_RETRY_LIMIT = 3;
const MIRROR_FAILURE_SUSPEND_MS = 60_000;
const MIRROR_FAILURE_SUSPEND_THRESHOLD = 3;
const MIRROR_POLL_INTERVAL_MS = 2_500;
const MIRROR_WATCH_DEBOUNCE_MS = 350;
const MIRROR_EVENT_BATCH_LIMIT = 8;
const MIRROR_SUPPRESSION_WINDOW_MS = 4_000;
const MIRROR_PROMPT_MATCH_GRACE_MS = 120_000;
// When IM drives a Desktop thread, Desktop task_complete is the canonical
// final source. If the SDK stream finishes first, wait for the terminal JSONL
// record before falling back to the SDK response.
const DESKTOP_TERMINAL_FINALIZATION_TIMEOUT_MS = 30_000;
const MIRROR_STREAM_STATUS_IDLE_START_MS = 180_000;
const MIRROR_STREAM_STATUS_HEARTBEAT_MS = 10_000;
const TMUX_SCREEN_STOP_CALLBACK_PREFIX = 'tmux-screen:stop:';
// Timeout after the last desktop event before we flush a buffered mirror turn
// without seeing task_complete. This is an internal mirror buffer guard, not an
// IM idle reminder. Active streaming turns never use this fallback timeout.
const MIRROR_TURN_BUFFER_TIMEOUT_MS = 10 * 60_000;
const STARTUP_NOTICE_TITLE = 'Bridge 已启动';

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
  mirrorSubscriptions: Map<string, DesktopMirrorSubscription>;
  mirrorSyncInFlight: boolean;
  mirrorSuppressUntil: Map<string, MirrorSuppressionState[]>;
  mirrorIgnoredTurnIds: Map<string, Map<string, number>>;
  threadCardSelections: Map<string, string>;
  autoStartChecked: boolean;
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
  if (!Object.prototype.hasOwnProperty.call(g[GLOBAL_KEY], 'mirrorSyncInFlight')) {
    g[GLOBAL_KEY].mirrorSyncInFlight = false;
  }
  return g[GLOBAL_KEY];
}

const INTERACTIVE_RUNTIME = createInteractiveRuntime(getState, {
  getStore: () => getBridgeContext().store,
  nowIso,
});

function formatDesktopTerminalDetail(terminal: BridgeTurnTerminalRecord): string {
  if (terminal.outcome === 'aborted') {
    return '检测到桌面线程已停止当前任务。';
  }
  if (terminal.outcome === 'failed') {
    return '检测到桌面线程当前任务执行失败。';
  }
  return '检测到桌面线程已完成当前任务。';
}

const TURN_COORDINATOR = createTurnCoordinator({
  finalizeTerminalTurn: (turn, terminal) => INTERACTIVE_RUNTIME.finalizeTerminalActiveTask(
    turn.sessionId,
    terminal.outcome,
    formatDesktopTerminalDetail(terminal),
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
  records: DesktopMirrorRecord[],
): DesktopMirrorRecord[] {
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
  const desktop = getDesktopSessionByThreadIdSafe(threadId, 'mirror title');
  if (!session && !desktop) return null;
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
  subscription: DesktopMirrorSubscription,
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
  subscription: DesktopMirrorSubscription,
  status: 'completed' | 'interrupted' = 'interrupted',
): void {
  MIRROR_FEEDBACK.stopMirrorStreaming(subscription, status);
}

async function deliverMirrorTurns(
  subscription: DesktopMirrorSubscription,
  turns: FinalizedDesktopMirrorTurn[],
): Promise<{ deliveredCount: number; error?: unknown }> {
  return MIRROR_FEEDBACK.deliverMirrorTurns(subscription, turns);
}

const MIRROR_TURN_HOOKS = MIRROR_FEEDBACK.hooks;

function consumeMirrorRecords(
  subscription: DesktopMirrorSubscription,
  records: DesktopMirrorRecord[],
): FinalizedDesktopMirrorTurn[] {
  return consumeMirrorRecordsBase(subscription, records, MIRROR_TURN_HOOKS);
}

function flushTimedOutMirrorTurn(
  subscription: DesktopMirrorSubscription,
  nowMs = Date.now(),
): FinalizedDesktopMirrorTurn | null {
  if (subscription.pendingTurn?.streamStarted) {
    return null;
  }
  return flushTimedOutMirrorTurnBase(subscription, MIRROR_TURN_BUFFER_TIMEOUT_MS, nowMs);
}

function hasPendingMirrorWork(subscription: DesktopMirrorSubscription): boolean {
  return hasPendingMirrorWorkBase(subscription);
}

function consumeBufferedMirrorTurns(
  subscription: DesktopMirrorSubscription,
  nowMs = Date.now(),
): FinalizedDesktopMirrorTurn[] {
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
  getDesktopSessionByThreadIdSafe,
  syncMirrorSessionStateSafe,
  filterSuppressedMirrorRecords,
  observeSessionHealthRecords: (sessionId, threadId, records) => {
    SESSION_HEALTH_RUNTIME.observeDesktopMirrorRecords(sessionId, threadId, records);
  },
  routeDesktopRecords: (sessionId, threadId, records) => routeDesktopRecords(
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
  resolveSessionIdForMessage: (msg) => router.resolve(msg.address).codepilotSessionId,
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
    tasks.push(deliverBridgeNotice(
      adapter,
      channelAddressFromBinding(binding),
      text,
      {
        sessionId: binding.codepilotSessionId,
        audit: false,
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
    binding.chatId === chatId && binding.codepilotSessionId === sessionId
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

function parseThreadSelectCallback(callbackData: string): string | null | undefined {
  if (!callbackData.startsWith(THREAD_SELECT_CALLBACK_PREFIX)) return undefined;
  try {
    return decodeURIComponent(callbackData.slice(THREAD_SELECT_CALLBACK_PREFIX.length)).trim() || null;
  } catch {
    return null;
  }
}

function parseThreadSelectActionCallback(callbackData: string): {
  scope: 'global' | 'bound';
  action: 'bind' | 'rm' | 'use';
} | null | undefined {
  if (!callbackData.startsWith(THREAD_SELECT_ACTION_CALLBACK_PREFIX)) return undefined;
  const raw = callbackData.slice(THREAD_SELECT_ACTION_CALLBACK_PREFIX.length).trim();
  const parts = raw.split(':').filter(Boolean);
  const scope = parts.length === 2 ? parts[0] : 'global';
  const action = parts.length === 2 ? parts[1] : parts[0];
  if ((scope !== 'global' && scope !== 'bound') || (action !== 'bind' && action !== 'rm' && action !== 'use')) {
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
        await deliverBridgeNotice(adapter, msg.address, '请先在下拉列表中选择一个桌面会话，再点击绑定、解绑或激活。');
        ack();
        return;
      }
      const commandText = threadAction.scope === 'global'
        ? threadAction.action === 'bind'
          ? `/t add ${threadId}`
          : threadAction.action === 'rm'
            ? `/t rm ${threadId}`
            : `/t ${threadId}`
        : threadAction.action === 'rm'
          ? `/t rm ${threadId}`
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
        currentBinding?.codepilotSessionId,
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
  const tmuxProviderSession = tmuxProviderBinding ? store.getSession(tmuxProviderBinding.codepilotSessionId) : null;
  if (tmuxProviderSession?.codex_provider === 'tmux') {
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
      persistSdkSessionUpdate,
      desktopTerminalFinalizationTimeoutMs: DESKTOP_TERMINAL_FINALIZATION_TIMEOUT_MS,
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
  options: { scopedBinding?: ChannelBinding | null; threadCardRefreshScope?: 'global' | 'bound' | null; threadCardSelectedId?: string | null } = {},
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
  });
}

// ── SDK Session Update Logic ─────────────────────────────────

/**
 * Compute the sdkSessionId value to persist after a conversation result.
 * Returns the new value to write, or null if no update is needed.
 *
 * Rules:
 * - If result has sdkSessionId AND no error → save the new ID
 * - If result has a transient Codex resume/process-exit error → keep the
 *   current ID so the next turn stays in the same Codex thread.
 * - If result has another error (regardless of sdkSessionId) → clear to empty string
 * - Otherwise → no update needed
 */
export function computeSdkSessionUpdate(
  sdkSessionId: string | null | undefined,
  hasError: boolean,
  errorMessage?: string | null,
): string | null {
  if (sdkSessionId && !hasError) {
    return sdkSessionId;
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

function persistSdkSessionUpdate(
  sessionId: string,
  sdkSessionId: string | null | undefined,
  hasError: boolean,
  errorMessage?: string | null,
): void {
  const update = computeSdkSessionUpdate(sdkSessionId, hasError, errorMessage);
  if (update === null) {
    return;
  }
  getBridgeContext().store.updateSdkSessionId(sessionId, update);
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
  parseDesktopThreadListArgs,
  buildDesktopThreadsCommandResponse,
  formatCommandDateTime,
  toUserVisibleBindingError,
  toUserVisibleCommandError,
  normalizeReasoningEffort,
  resolveDisplayedModel,
  formatDisplayedModel,
  formatBindingChatLabel,
  formatRuntimeStatus,
  formatMirrorStatus,
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
  persistSdkSessionUpdate,
  computeSdkSessionUpdate,
  deliverStartupNotifications,
  resetStateForTests,
};
