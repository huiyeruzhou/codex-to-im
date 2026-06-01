import type { CodexMirrorRecord } from '../../codex/session-index.js';
import type { ToolCallInfo } from './types.js';
import { summarizeToolDetailValue } from './tool-call-details.js';

export type CodexTurnEvent =
  | {
      type: 'tool';
      toolId: string;
      toolName?: string;
      status: ToolCallInfo['status'];
      input?: unknown;
      output?: unknown;
    };

export function applyCodexTurnEventToTools(
  tools: Map<string, ToolCallInfo>,
  event: CodexTurnEvent,
  options: { showToolCallDetails: boolean },
): void {
  if (event.type !== 'tool') return;

  const existing = tools.get(event.toolId);
  const next: ToolCallInfo = {
    id: event.toolId,
    name: event.toolName || existing?.name || 'tool',
    status: event.status,
    input: existing?.input ?? null,
    output: existing?.output ?? null,
  };

  if (options.showToolCallDetails) {
    if (typeof event.input !== 'undefined') {
      next.input = summarizeToolDetailValue(event.input, 900);
    }
    if (typeof event.output !== 'undefined') {
      const output = summarizeToolDetailValue(event.output, 1400);
      next.output = output.trim() ? output : existing?.output ?? null;
    }
  }

  tools.set(event.toolId, next);
}

export function codexTurnEventFromSdkToolEvent(
  toolId: string,
  toolName: string,
  status: ToolCallInfo['status'],
  detail?: { input?: unknown; output?: string },
): CodexTurnEvent {
  return {
    type: 'tool',
    toolId,
    ...(toolName ? { toolName } : {}),
    status,
    ...(detail && typeof detail.input !== 'undefined' ? { input: detail.input } : {}),
    ...(detail && typeof detail.output === 'string' ? { output: detail.output } : {}),
  };
}

export function codexTurnEventFromMirrorRecord(record: CodexMirrorRecord): CodexTurnEvent | null {
  if (record.type === 'tool_started') {
    return {
      type: 'tool',
      toolId: record.toolId || record.signature,
      toolName: record.toolName,
      status: 'running',
      ...(typeof record.toolInput !== 'undefined' ? { input: record.toolInput } : {}),
    };
  }
  if (record.type === 'tool_finished') {
    return {
      type: 'tool',
      toolId: record.toolId || record.signature,
      toolName: record.toolName,
      status: record.isError ? 'error' : 'complete',
      ...(typeof record.toolInput !== 'undefined' ? { input: record.toolInput } : {}),
      ...(record.content.trim() ? { output: record.content } : {}),
    };
  }
  return null;
}
