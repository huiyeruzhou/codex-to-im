import type { BridgeSession } from '../host.js';
import type { ChannelBinding } from '../types.js';
import type { BridgeTurnClassification } from './turn-types.js';

export type CodexThreadLookup = (threadId: string) => boolean;

type SessionLike = Pick<
  BridgeSession,
  'id' | 'codex_thread_id'
>;

type BindingLike = Pick<ChannelBinding, 'bridgeSessionId'>;

function normalizeThreadId(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export function getCodexThreadId(
  session: SessionLike | null | undefined,
  _binding?: BindingLike | null,
): string | undefined {
  return normalizeThreadId(session?.codex_thread_id);
}

export function classifyInteractiveTurn(
  binding: BindingLike,
  session: SessionLike | null | undefined,
  codexThreadLookup?: CodexThreadLookup,
): BridgeTurnClassification {
  const sessionId = session?.id || binding.bridgeSessionId;
  const codexThreadId = getCodexThreadId(session, binding);
  if (codexThreadId) {
    const codexThreadAvailable = codexThreadLookup ? codexThreadLookup(codexThreadId) : false;
    if (codexThreadAvailable) {
      return {
        kind: 'im_codex_reuse',
        sessionId,
        codexThreadId,
        codexThreadAvailable,
        reason: 'codex_thread',
      };
    }
    return {
      kind: 'im_sdk',
      sessionId,
      codexThreadId,
      codexThreadAvailable: false,
      reason: 'bridge_thread',
    };
  }

  return {
    kind: 'im_sdk',
    sessionId,
    codexThreadId,
    codexThreadAvailable: false,
    reason: codexThreadId ? 'bridge_thread' : 'new_bridge_thread',
  };
}
