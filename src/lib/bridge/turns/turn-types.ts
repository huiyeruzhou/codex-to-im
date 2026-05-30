import type { OutboundAttachment } from '../types.js';

export type BridgeTurnKind =
  | 'im_sdk'
  | 'im_codex_reuse'
  | 'codex_mirror';

export type BridgeTurnOrigin = 'im' | 'codex';
export type BridgeTurnProgressSource = 'sdk_stream' | 'codex_jsonl';
export type BridgeTurnFinalSource = 'sdk_result' | 'codex_task_complete';

export interface ActiveBridgeTurn {
  id: string;
  sessionId: string;
  kind: BridgeTurnKind;
  origin: BridgeTurnOrigin;
  progressSource: BridgeTurnProgressSource;
  finalSource: BridgeTurnFinalSource;
  codexThreadId?: string;
  requestMessageId?: string;
  streamKey?: string;
  startedAt: number;
}

export interface BridgeTurnClassification {
  kind: BridgeTurnKind;
  sessionId: string;
  codexThreadId?: string;
  codexThreadAvailable: boolean;
  reason:
    | 'codex_thread'
    | 'codex_thread_missing'
    | 'bridge_thread'
    | 'new_bridge_thread';
}

export interface FinalizedBridgeResponse {
  text: string;
  attachments: OutboundAttachment[];
  hasError?: boolean;
  errorMessage?: string;
  source: BridgeTurnFinalSource;
}

export interface BridgeTurnTerminalRecord {
  turnId?: string;
  sessionId: string;
  codexThreadId: string;
  text: string;
  outcome: 'completed' | 'failed' | 'aborted';
  timestamp: string;
}
