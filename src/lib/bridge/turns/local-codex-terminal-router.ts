import type { CodexMirrorRecord } from '../../../codex/session-index.js';
import type { TurnCoordinator } from './turn-coordinator.js';
import type { BridgeTurnTerminalRecord } from './turn-types.js';

export interface CodexRecordRouteResult {
  claimed: CodexMirrorRecord[];
  unclaimed: CodexMirrorRecord[];
  terminalClaimed: boolean;
}

function isTerminalRecord(record: CodexMirrorRecord): boolean {
  return record.type === 'task_complete' || record.type === 'task_aborted';
}

function toTerminalRecord(
  sessionId: string,
  codexThreadId: string,
  record: CodexMirrorRecord,
): BridgeTurnTerminalRecord {
  return {
    sessionId,
    codexThreadId,
    turnId: record.turnId,
    text: record.content,
    outcome: record.type === 'task_aborted' ? 'aborted' : 'completed',
    timestamp: record.timestamp,
  };
}

export async function routeCodexRecords(
  sessionId: string,
  codexThreadId: string,
  records: CodexMirrorRecord[],
  coordinator: Pick<TurnCoordinator, 'claimCodexTerminal'>,
): Promise<CodexRecordRouteResult> {
  let terminalRecord: CodexMirrorRecord | null = null;
  for (let index = records.length - 1; index >= 0; index -= 1) {
    if (!isTerminalRecord(records[index])) continue;
    terminalRecord = records[index];
    break;
  }

  if (!terminalRecord) {
    return {
      claimed: [],
      unclaimed: records,
      terminalClaimed: false,
    };
  }

  const claim = await coordinator.claimCodexTerminal(
    toTerminalRecord(sessionId, codexThreadId, terminalRecord),
  );
  if (!claim.claimed) {
    return {
      claimed: [],
      unclaimed: records,
      terminalClaimed: false,
    };
  }

  const claimedTurnId = terminalRecord.turnId;
  const claimed = claimedTurnId
    ? records.filter((record) => record.turnId === claimedTurnId)
    : [terminalRecord];
  const claimedSet = new Set(claimed.map((record) => record.signature));

  return {
    claimed,
    unclaimed: records.filter((record) => !claimedSet.has(record.signature)),
    terminalClaimed: true,
  };
}
