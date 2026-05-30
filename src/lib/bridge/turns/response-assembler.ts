import type { OutboundAttachment } from '../types.js';
import {
  parseOutboundArtifacts,
  stripOutboundArtifactBlocksForStreaming,
} from '../outbound-artifacts.js';
import type {
  BridgeTurnFinalSource,
  FinalizedBridgeResponse,
} from './turn-types.js';

export interface AssembleFinalResponseInput {
  text?: string | null;
  attachments?: OutboundAttachment[];
  hasError?: boolean;
  errorMessage?: string;
}

export interface FinalResponseArtifactParseResult {
  text: string;
  attachments: OutboundAttachment[];
}

function attachmentKey(attachment: OutboundAttachment): string {
  return [
    attachment.kind,
    attachment.path,
    attachment.caption || '',
    attachment.name || '',
  ].join('\0');
}

export function dedupeOutboundAttachments(
  attachments: OutboundAttachment[],
): OutboundAttachment[] {
  const seen = new Set<string>();
  const deduped: OutboundAttachment[] = [];
  for (const attachment of attachments) {
    const key = attachmentKey(attachment);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(attachment);
  }
  return deduped;
}

export function collectFinalResponseArtifacts(
  text?: string | null,
  attachments: OutboundAttachment[] = [],
): FinalResponseArtifactParseResult {
  const parsed = parseOutboundArtifacts(text || '');
  return {
    text: parsed.cleanText,
    attachments: dedupeOutboundAttachments([
      ...attachments,
      ...parsed.attachments,
    ]),
  };
}

function assembleFinalResponse(
  source: BridgeTurnFinalSource,
  input: AssembleFinalResponseInput,
): FinalizedBridgeResponse {
  const parsed = collectFinalResponseArtifacts(input.text, input.attachments);
  return {
    text: parsed.text,
    attachments: parsed.attachments,
    hasError: input.hasError,
    errorMessage: input.errorMessage,
    source,
  };
}

export function assembleSdkFinalResponse(
  input: AssembleFinalResponseInput,
): FinalizedBridgeResponse {
  return assembleFinalResponse('sdk_result', input);
}

export function assembleCodexFinalResponse(
  input: AssembleFinalResponseInput,
): FinalizedBridgeResponse {
  return assembleFinalResponse('codex_task_complete', input);
}

export function hasFinalResponsePayload(response: FinalizedBridgeResponse): boolean {
  return Boolean(response.text || response.attachments.length > 0);
}

export function mergeFinalResponses(
  primary: FinalizedBridgeResponse,
  fallback: FinalizedBridgeResponse,
): FinalizedBridgeResponse {
  return {
    text: primary.text || fallback.text,
    attachments: dedupeOutboundAttachments([
      ...fallback.attachments,
      ...primary.attachments,
    ]),
    hasError: primary.hasError ?? fallback.hasError,
    errorMessage: primary.errorMessage || fallback.errorMessage,
    source: primary.source,
  };
}

export function stripFinalOnlyBlocksForStreaming(text: string): string {
  return stripOutboundArtifactBlocksForStreaming(text);
}
