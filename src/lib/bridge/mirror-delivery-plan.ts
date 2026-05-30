import type { CodexMirrorRecord } from '../../codex/session-index.js';
import type { FinalizedCodexMirrorTurn } from './mirror-turns.js';

export interface MirrorDeliveryPlanSubscription {
  sessionId: string;
  bufferedRecords: CodexMirrorRecord[];
}

export interface BuildMirrorDeliveryPlanOptions<
  TSubscription extends MirrorDeliveryPlanSubscription,
> {
  blocked: boolean;
  filterSuppressedRecords: (sessionId: string, records: CodexMirrorRecord[]) => CodexMirrorRecord[];
  flushTimedOutTurn: (subscription: TSubscription) => FinalizedCodexMirrorTurn | null;
  consumeBufferedTurns: (subscription: TSubscription) => FinalizedCodexMirrorTurn[];
}

export interface MirrorDeliveryPlan {
  syncReason:
    | 'mirror reconcile active task'
    | 'mirror reconcile no finalized turns'
    | 'mirror reconcile delivered turns';
  finalizedTurns: FinalizedCodexMirrorTurn[];
}

export function buildMirrorDeliveryPlan<TSubscription extends MirrorDeliveryPlanSubscription>(
  subscription: TSubscription,
  deliverableRecords: CodexMirrorRecord[],
  options: BuildMirrorDeliveryPlanOptions<TSubscription>,
): MirrorDeliveryPlan {
  if (deliverableRecords.length > 0) {
    const filteredRecords = options.filterSuppressedRecords(subscription.sessionId, deliverableRecords);
    if (filteredRecords.length > 0) {
      subscription.bufferedRecords.push(...filteredRecords);
    }
  }

  const timedOutTurn = options.flushTimedOutTurn(subscription);
  if (options.blocked) {
    return {
      syncReason: 'mirror reconcile active task',
      finalizedTurns: timedOutTurn ? [timedOutTurn] : [],
    };
  }

  const finalizedTurns = timedOutTurn ? [timedOutTurn] : [];
  finalizedTurns.push(...options.consumeBufferedTurns(subscription));
  if (finalizedTurns.length === 0) {
    return {
      syncReason: 'mirror reconcile no finalized turns',
      finalizedTurns: [],
    };
  }

  return {
    syncReason: 'mirror reconcile delivered turns',
    finalizedTurns,
  };
}
