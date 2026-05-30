import fs from 'node:fs';

import type {
  CodexMirrorRecord,
  CodexSessionSummary,
} from '../../codex/session-index.js';
import type { BaseChannelAdapter } from './channel-adapter.js';
import {
  enqueuePendingMirrorDeliveries,
  removePendingMirrorDeliveries,
  selectPendingMirrorDeliveries,
  type FinalizedCodexMirrorTurn,
} from './mirror-turns.js';
import type { CodexMirrorSubscription } from './mirror-subscription-state.js';
import {
  clearMirrorSubscriptionFailure,
  createMirrorSubscription,
  recordMirrorSubscriptionFailure,
  updateMirrorSubscription,
} from './mirror-subscription-state.js';
import {
  isMirrorSnapshotUnchanged,
  markMirrorSnapshotMissing,
  readMirrorDeliverableRecords,
  refreshMirrorSubscriptionSource,
  statMirrorFile,
} from './mirror-reconcile-core.js';
import { buildMirrorDeliveryPlan } from './mirror-delivery-plan.js';
import { buildMirrorSubscriptionRegistryPlan } from './mirror-subscription-registry.js';
import { runMirrorReconcileBatch, type MirrorReconcileStatus } from './mirror-reconcile-batch.js';

export interface BridgeMirrorRuntimeState {
  running: boolean;
  adapters: Map<string, BaseChannelAdapter>;
  mirrorSubscriptions: Map<string, CodexMirrorSubscription>;
  mirrorWakeTimer: NodeJS.Timeout | null;
  mirrorSyncInFlight: boolean;
  activeTasks: Map<string, unknown>;
}

export interface MirrorRuntimeBinding {
  id: string;
  channelType: string;
  chatId: string;
  bridgeSessionId: string;
}

export interface MirrorRuntimeSession {
  codex_thread_id?: string | null;
  mirror_last_event_at?: string | null;
}

export interface CreateMirrorRuntimeOptions {
  watchDebounceMs: number;
  danglingThreadRetryLimit: number;
  failureSuspendThreshold: number;
  failureSuspendMs: number;
}

export interface CreateMirrorRuntimeDeps {
  nowIso(): string;
  describeUnknownError(error: unknown): string;
  listChannelBindings(): MirrorRuntimeBinding[];
  getSession(sessionId: string): MirrorRuntimeSession | null | undefined;
  clearSessionCodexThreadId(sessionId: string): void;
  getCodexSessionByThreadIdSafe(threadId: string, context: string): CodexSessionSummary | null;
  syncMirrorSessionStateSafe(sessionId: string, context: string): void;
  filterSuppressedMirrorRecords(sessionId: string, records: CodexMirrorRecord[]): CodexMirrorRecord[];
  observeSessionHealthRecords(sessionId: string, threadId: string, records: CodexMirrorRecord[]): void;
  routeCodexRecords?(
    sessionId: string,
    threadId: string,
    records: CodexMirrorRecord[],
  ): Promise<{ claimed: CodexMirrorRecord[]; unclaimed: CodexMirrorRecord[]; terminalClaimed: boolean }>;
  consumeMirrorRecords(subscription: CodexMirrorSubscription, records: CodexMirrorRecord[]): FinalizedCodexMirrorTurn[];
  flushTimedOutMirrorTurn(subscription: CodexMirrorSubscription): FinalizedCodexMirrorTurn | null;
  hasPendingMirrorWork(subscription: CodexMirrorSubscription): boolean;
  consumeBufferedMirrorTurns(subscription: CodexMirrorSubscription): FinalizedCodexMirrorTurn[];
  stopMirrorStreaming(
    subscription: CodexMirrorSubscription,
    status?: 'completed' | 'interrupted',
  ): void;
  deliverMirrorTurns(
    subscription: CodexMirrorSubscription,
    turns: FinalizedCodexMirrorTurn[],
  ): Promise<{ deliveredCount: number; error?: unknown }>;
}

export interface MirrorRuntime {
  resetMirrorSessionForInteractiveRun(sessionId: string): void;
  reconcileMirrorSubscriptions(): Promise<void>;
  clearMirrorSubscriptions(): void;
}

export function createMirrorRuntime(
  getState: () => BridgeMirrorRuntimeState,
  options: CreateMirrorRuntimeOptions,
  deps: CreateMirrorRuntimeDeps,
): MirrorRuntime {
  function closeMirrorWatcher(subscription: CodexMirrorSubscription): void {
    if (subscription.watcher) {
      try {
        subscription.watcher.close();
      } catch {
        // best effort
      }
    }
    subscription.watcher = null;
    subscription.watcherTarget = null;
  }

  function scheduleMirrorWake(delayMs = options.watchDebounceMs): void {
    const state = getState();
    if (!state.running) return;
    if (state.mirrorWakeTimer) return;

    state.mirrorWakeTimer = setTimeout(() => {
      state.mirrorWakeTimer = null;
      void reconcileMirrorSubscriptions().catch((err) => {
        console.error('[bridge-manager] Mirror wake reconcile failed:', deps.describeUnknownError(err));
      });
    }, delayMs);
  }

  function watchMirrorFile(subscription: CodexMirrorSubscription, filePath: string | null): void {
    if (!filePath) {
      closeMirrorWatcher(subscription);
      return;
    }
    if (subscription.watcherTarget === filePath && subscription.watcher) {
      return;
    }

    closeMirrorWatcher(subscription);
    try {
      subscription.watcher = fs.watch(filePath, () => {
        subscription.dirty = true;
        scheduleMirrorWake();
      });
      subscription.watcherTarget = filePath;
    } catch {
      subscription.watcher = null;
      subscription.watcherTarget = null;
    }
  }

  function removeMirrorSubscription(bindingId: string): void {
    const state = getState();
    const existing = state.mirrorSubscriptions.get(bindingId);
    if (!existing) return;
    deps.stopMirrorStreaming(existing);
    closeMirrorWatcher(existing);
    state.mirrorSubscriptions.delete(bindingId);
    deps.syncMirrorSessionStateSafe(existing.sessionId, 'mirror subscription removal');
  }

  function clearDanglingMirrorThread(subscription: CodexMirrorSubscription, reason: string): void {
    const session = deps.getSession(subscription.sessionId);
    const currentThreadId = session?.codex_thread_id?.trim() || subscription.threadId;
    console.warn(
      `[bridge-manager] Clearing dangling Codex thread ${currentThreadId} for session ${subscription.sessionId}: ${reason}`,
    );
    deps.clearSessionCodexThreadId(subscription.sessionId);
    removeMirrorSubscription(subscription.bindingId);
  }

  function upsertMirrorSubscription(binding: MirrorRuntimeBinding): void {
    const state = getState();
    const session = deps.getSession(binding.bridgeSessionId);
    if (!session) {
      removeMirrorSubscription(binding.id);
      return;
    }

    const threadId = session.codex_thread_id?.trim() || '';
    if (!threadId) {
      removeMirrorSubscription(binding.id);
      return;
    }

    const codexSession = deps.getCodexSessionByThreadIdSafe(threadId, 'mirror subscription sync');
    const filePath = codexSession?.filePath || null;
    const existing = state.mirrorSubscriptions.get(binding.id);

    if (!existing) {
      const created = createMirrorSubscription({
        bindingId: binding.id,
        sessionId: binding.bridgeSessionId,
        channelType: binding.channelType,
        chatId: binding.chatId,
        threadId,
        filePath,
        lastDeliveredAt: session.mirror_last_event_at || null,
      });
      watchMirrorFile(created, filePath);
      state.mirrorSubscriptions.set(binding.id, created);
      deps.syncMirrorSessionStateSafe(binding.bridgeSessionId, 'mirror subscription create');
      return;
    }

    const { previousSessionId, threadChanged, filePathChanged } = updateMirrorSubscription(existing, {
      sessionId: binding.bridgeSessionId,
      channelType: binding.channelType,
      chatId: binding.chatId,
      threadId,
      filePath,
      lastDeliveredAt: session.mirror_last_event_at || null,
    });
    if (threadChanged || filePathChanged) {
      deps.stopMirrorStreaming(existing);
    }
    watchMirrorFile(existing, filePath);
    if (previousSessionId !== binding.bridgeSessionId) {
      deps.syncMirrorSessionStateSafe(previousSessionId, 'mirror subscription rebind previous session');
    }
    deps.syncMirrorSessionStateSafe(binding.bridgeSessionId, 'mirror subscription upsert');
  }

  function syncMirrorSubscriptionSet(): void {
    const state = getState();
    const plan = buildMirrorSubscriptionRegistryPlan(
      deps.listChannelBindings(),
      state.adapters.keys(),
      state.mirrorSubscriptions.keys(),
      deps.getSession,
    );

    for (const binding of plan.upsertBindings) {
      try {
        upsertMirrorSubscription(binding);
      } catch (error) {
        console.error(
          `[bridge-manager] Failed to sync mirror subscription for binding ${binding.id}:`,
          error,
        );
      }
    }

    for (const bindingId of plan.removeBindingIds) {
      removeMirrorSubscription(bindingId);
    }
  }

  async function reconcileMirrorSubscription(
    subscription: CodexMirrorSubscription,
  ): Promise<MirrorReconcileStatus> {
    const session = deps.getSession(subscription.sessionId);
    if (!session) {
      removeMirrorSubscription(subscription.bindingId);
      return 'processed';
    }

    if (subscription.suspendedUntil && Date.now() < subscription.suspendedUntil) {
      deps.syncMirrorSessionStateSafe(subscription.sessionId, 'mirror suspension');
      return 'suspended';
    }
    if (subscription.suspendedUntil) {
      subscription.suspendedUntil = null;
    }

    const codexSession = deps.getCodexSessionByThreadIdSafe(subscription.threadId, 'mirror reconcile');
    if (!codexSession) {
      subscription.missingThreadPolls += 1;
      if (subscription.missingThreadPolls >= options.danglingThreadRetryLimit) {
        clearDanglingMirrorThread(subscription, 'Codex thread no longer exists locally');
        return 'processed';
      }
    } else {
      subscription.missingThreadPolls = 0;
    }
    refreshMirrorSubscriptionSource(subscription, codexSession?.filePath || null, deps.nowIso());
    watchMirrorFile(subscription, subscription.filePath);

    if (!subscription.filePath) {
      deps.syncMirrorSessionStateSafe(subscription.sessionId, 'mirror reconcile without file');
      return 'processed';
    }

    const snapshot = statMirrorFile(subscription.filePath);
    if (!snapshot) {
      markMirrorSnapshotMissing(subscription);
      deps.syncMirrorSessionStateSafe(subscription.sessionId, 'mirror reconcile missing snapshot');
      return 'processed';
    }

    const unchanged = isMirrorSnapshotUnchanged(subscription, snapshot);
    if (unchanged && !deps.hasPendingMirrorWork(subscription)) {
      deps.syncMirrorSessionStateSafe(subscription.sessionId, 'mirror reconcile unchanged snapshot');
      return 'processed';
    }

    const readResult = readMirrorDeliverableRecords(subscription, snapshot);
    const deliverableRecords = readResult.records;
    for (const kind of readResult.unknownKinds) {
      if (subscription.unknownMirrorKindsSeen.has(kind)) continue;
      subscription.unknownMirrorKindsSeen.add(kind);
      console.warn(
        `[bridge-manager] Unhandled Codex mirror event for thread ${subscription.threadId}: ${kind}`,
      );
    }
    const routeResult = deliverableRecords.length > 0 && deps.routeCodexRecords
      ? await deps.routeCodexRecords(subscription.sessionId, subscription.threadId, deliverableRecords)
      : { claimed: [], unclaimed: deliverableRecords, terminalClaimed: false };
    const mirrorRecords = routeResult.unclaimed;

    if (mirrorRecords.length > 0) {
      deps.observeSessionHealthRecords(subscription.sessionId, subscription.threadId, mirrorRecords);
    }
    const blocked = getState().activeTasks.has(subscription.sessionId);
    const deliveryPlan = buildMirrorDeliveryPlan(subscription, mirrorRecords, {
      blocked,
      filterSuppressedRecords: deps.filterSuppressedMirrorRecords,
      flushTimedOutTurn: (currentSubscription) => deps.flushTimedOutMirrorTurn(currentSubscription),
      consumeBufferedTurns: (currentSubscription) => deps.consumeBufferedMirrorTurns(currentSubscription),
    });

    if (deliveryPlan.finalizedTurns.length > 0) {
      enqueuePendingMirrorDeliveries(subscription, deliveryPlan.finalizedTurns);
    }

    const turnsToAttempt = selectPendingMirrorDeliveries(subscription, blocked);
    if (turnsToAttempt.length > 0) {
      const deliveryResult = await deps.deliverMirrorTurns(subscription, turnsToAttempt);
      if (deliveryResult.deliveredCount > 0) {
        removePendingMirrorDeliveries(subscription, turnsToAttempt.slice(0, deliveryResult.deliveredCount));
      }
      if (deliveryResult.error) {
        const error = deliveryResult.error;
        console.warn('[bridge-manager] Mirror delivery failed:', error instanceof Error ? error.message : error);
      }
    }

    deps.syncMirrorSessionStateSafe(subscription.sessionId, deliveryPlan.syncReason);
    return 'processed';
  }

  async function handleMirrorSubscriptionReconcileFailure(
    subscription: CodexMirrorSubscription,
    error: unknown,
  ): Promise<void> {
    try {
      deps.stopMirrorStreaming(subscription, 'interrupted');
      const suspended = recordMirrorSubscriptionFailure(
        subscription,
        options.failureSuspendThreshold,
        options.failureSuspendMs,
      );
      if (suspended) {
        console.warn(
          `[bridge-manager] Mirror subscription for thread ${subscription.threadId} is suspended for ${Math.round(options.failureSuspendMs / 1000)}s after ${subscription.consecutiveFailures} consecutive failures`,
        );
      }
      console.error(
        `[bridge-manager] Mirror reconcile failed for thread ${subscription.threadId}:`,
        deps.describeUnknownError(error),
      );
      deps.syncMirrorSessionStateSafe(subscription.sessionId, 'mirror reconcile failure');
    } catch (recoveryError) {
      console.error(
        `[bridge-manager] Mirror reconcile recovery failed for thread ${subscription.threadId}:`,
        deps.describeUnknownError(recoveryError),
      );
      console.error(
        `[bridge-manager] Original mirror reconcile error for thread ${subscription.threadId}:`,
        deps.describeUnknownError(error),
      );
    }
  }

  async function reconcileMirrorSubscriptions(): Promise<void> {
    const state = getState();
    if (!state.running || state.mirrorSyncInFlight) return;
    state.mirrorSyncInFlight = true;

    try {
      await runMirrorReconcileBatch({
        syncSubscriptionSet: syncMirrorSubscriptionSet,
        getSubscriptions: () => Array.from(state.mirrorSubscriptions.values()),
        reconcileSubscription: reconcileMirrorSubscription,
        clearFailureState: clearMirrorSubscriptionFailure,
        handleFailure: handleMirrorSubscriptionReconcileFailure,
        logBatchError: (stage, error) => {
          console.error(
            `[bridge-manager] Mirror reconcile failed during ${stage}:`,
            deps.describeUnknownError(error),
          );
        },
      });
    } finally {
      state.mirrorSyncInFlight = false;
    }
  }

  function clearMirrorSubscriptions(): void {
    const state = getState();
    for (const bindingId of Array.from(state.mirrorSubscriptions.keys())) {
      removeMirrorSubscription(bindingId);
    }
  }

  function resetMirrorSessionForInteractiveRun(sessionId: string): void {
    const state = getState();
    for (const subscription of state.mirrorSubscriptions.values()) {
      if (subscription.sessionId !== sessionId) continue;
      deps.stopMirrorStreaming(subscription, 'interrupted');
      if (subscription.pendingTurn) {
        subscription.pendingTurn.streamStarted = false;
      }
    }
  }

  return {
    resetMirrorSessionForInteractiveRun,
    reconcileMirrorSubscriptions,
    clearMirrorSubscriptions,
  };
}
