import {
  createCodexEventSignature,
  extractCodexMessageText,
  extractNormalizedFreeText,
  extractNormalizedStructuredText,
  extractReasoningSummary,
  extractToolOutputText,
  formatCodexToolName,
  getDynamicToolCallId,
  isSessionEventLine,
  isSessionMessageLine,
  isTurnContextLine,
  parseUpdatePlanTasks,
  summarizePatchChanges,
  summarizeToolSearchOutput,
  type CodexMirrorRecord,
  type CodexMirrorRecordDelta,
  type CodexSessionEvent,
  type CodexSessionEventDelta,
  type SessionEventLine,
  type SessionMessageLine,
  type TurnContextLine,
} from './jsonl-types.js';
import {
  parseContextUsageInfo,
} from '../../lib/bridge/context-usage.js';

const IGNORED_EVENT_MSG_TYPES = new Set([
  'thread_name_updated',
  'thread_rolled_back',
]);

const CONTEXT_COMPACTED_NOTICE = '上下文已压缩，后续回复会基于压缩后的上下文继续。';

const IGNORED_RESPONSE_ITEM_TYPES = new Set([
  'web_search_call',
]);

function isIgnoredMirrorLineKind(line: SessionMessageLine | SessionEventLine | TurnContextLine): boolean {
  if (isSessionEventLine(line)) {
    const payloadType = typeof line.payload?.type === 'string' ? line.payload.type.trim() : '';
    return IGNORED_EVENT_MSG_TYPES.has(payloadType);
  }
  if (isSessionMessageLine(line)) {
    const payloadType = typeof line.payload?.type === 'string' ? line.payload.type.trim() : '';
    return IGNORED_RESPONSE_ITEM_TYPES.has(payloadType);
  }
  return false;
}

function describeUnhandledMirrorLineKind(
  line: SessionMessageLine | SessionEventLine | TurnContextLine,
): string | null {
  if (isIgnoredMirrorLineKind(line)) return null;
  if (isSessionEventLine(line)) {
    const payloadType = typeof line.payload?.type === 'string' ? line.payload.type.trim() : '';
    return `event_msg:${payloadType || '<unknown>'}`;
  }
  if (isSessionMessageLine(line)) {
    const payloadType = typeof line.payload?.type === 'string' ? line.payload.type.trim() : '';
    return `response_item:${payloadType || '<unknown>'}`;
  }
  return null;
}

function pushCodexSessionEvent(
  events: CodexSessionEvent[],
  parsed: SessionMessageLine | SessionEventLine,
  rawLine: string,
): void {
  if (isSessionEventLine(parsed) && parsed.payload?.type === 'context_compacted') {
    events.push({
      signature: createCodexEventSignature(rawLine),
      role: 'commentary',
      content: CONTEXT_COMPACTED_NOTICE,
      timestamp: parsed.timestamp || '',
    });
    return;
  }

  if (isSessionEventLine(parsed) && parsed.payload?.type === 'user_message') {
    const text = extractNormalizedStructuredText(parsed.payload.message);
    if (!text) return;
    events.push({
      signature: createCodexEventSignature(rawLine),
      role: 'user',
      content: text,
      timestamp: parsed.timestamp || '',
    });
    return;
  }

  if (isSessionEventLine(parsed) && parsed.payload?.type === 'agent_message') {
    const text = extractNormalizedStructuredText(parsed.payload.message);
    if (!text) return;
    const role = parsed.payload.phase === 'commentary' ? 'commentary' : 'assistant';
    const lastEvent = events[events.length - 1];
    if (lastEvent?.role === role && lastEvent.content === text) return;
    events.push({
      signature: createCodexEventSignature(rawLine),
      role,
      content: text,
      timestamp: parsed.timestamp || '',
    });
    return;
  }

  if (isSessionEventLine(parsed) && parsed.payload?.type === 'task_complete') {
    const text = extractNormalizedStructuredText(parsed.payload.last_agent_message);
    if (!text) return;

    const lastEvent = events[events.length - 1];
    if (lastEvent?.role === 'assistant' && lastEvent.content === text) {
      return;
    }

    events.push({
      signature: createCodexEventSignature(rawLine),
      role: 'assistant',
      content: text,
      timestamp: parsed.timestamp || '',
    });
    return;
  }

  if (isSessionMessageLine(parsed) && parsed.payload?.type === 'message' && parsed.payload.role === 'assistant') {
    const text = extractCodexMessageText(parsed);
    if (!text) return;
    const role = parsed.payload.phase === 'commentary' ? 'commentary' : 'assistant';
    const content = parsed.payload.phase === 'commentary' ? text.replace(/^\[commentary\]\n/, '') : text;
    const lastEvent = events[events.length - 1];
    if (lastEvent?.role === role && lastEvent.content === content) return;
    events.push({
      signature: createCodexEventSignature(rawLine),
      role,
      content,
      timestamp: parsed.timestamp || '',
    });
  }
}

function pushCodexMirrorRecord(
  records: CodexMirrorRecord[],
  parsed: SessionMessageLine | SessionEventLine | TurnContextLine,
  rawLine: string,
  activeTurnId: string | null,
  activeSpecialCallIds: Set<string>,
): boolean {
  if (isSessionEventLine(parsed)) {
    return pushCodexMirrorEventRecord(records, parsed, rawLine, activeTurnId);
  }
  if (isSessionMessageLine(parsed)) {
    return pushCodexMirrorResponseRecord(records, parsed, rawLine, activeTurnId, activeSpecialCallIds);
  }
  return false;
}

function pushCodexMirrorEventRecord(
  records: CodexMirrorRecord[],
  parsed: SessionEventLine,
  rawLine: string,
  activeTurnId: string | null,
): boolean {
  const signature = createCodexEventSignature(rawLine);
  const timestamp = parsed.timestamp || '';

  if (parsed.payload?.type === 'task_started') {
    records.push({
      signature,
      type: 'task_started',
      content: '',
      timestamp,
      turnId: parsed.payload.turn_id || '',
    });
    return true;
  }

  if (parsed.payload?.type === 'turn_aborted') {
    records.push({
      signature,
      type: 'task_aborted',
      content: extractNormalizedStructuredText(parsed.payload.reason),
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (parsed.payload?.type === 'context_compacted') {
    records.push({
      signature,
      type: 'message',
      role: 'commentary',
      content: CONTEXT_COMPACTED_NOTICE,
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (parsed.payload?.type === 'token_count') {
    const contextUsage = parseContextUsageInfo((parsed.payload as Record<string, unknown>).info);
    if (contextUsage) {
      records.push({
        signature,
        type: 'context_usage',
        content: '',
        timestamp,
        ...(activeTurnId ? { turnId: activeTurnId } : {}),
        contextUsage,
      });
    }
    return true;
  }

  if (isIgnoredMirrorLineKind(parsed)) {
    return true;
  }

  if (parsed.payload?.type === 'agent_message') {
    const text = extractNormalizedStructuredText(parsed.payload.message);
    if (!text) return true;
    records.push({
      signature,
      type: 'message',
      role: parsed.payload.phase === 'commentary' ? 'commentary' : 'assistant',
      content: text,
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (parsed.payload?.type === 'agent_reasoning') {
    const text = extractNormalizedStructuredText(parsed.payload.text);
    if (!text) return true;
    records.push({
      signature,
      type: 'reasoning',
      content: text,
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (parsed.payload?.type === 'web_search_end') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    records.push({
      signature,
      type: 'tool_finished',
      content: extractNormalizedStructuredText(parsed.payload.query),
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      toolName: 'Web Search',
    });
    return true;
  }

  if (parsed.payload?.type === 'mcp_tool_call_end') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    const server = extractNormalizedFreeText(parsed.payload.invocation?.server);
    const tool = extractNormalizedFreeText(parsed.payload.invocation?.tool);
    const toolName = server && tool ? `mcp__${server}__${tool}` : 'mcp_tool_call';
    records.push({
      signature,
      type: 'tool_finished',
      content: '',
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      toolName,
      isError: false,
    });
    return true;
  }

  if (parsed.payload?.type === 'exec_command_end') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    const exitCode = typeof parsed.payload.exit_code === 'number' ? parsed.payload.exit_code : null;
    const status = extractNormalizedFreeText(parsed.payload.status).toLowerCase();
    const commandInput = Array.isArray(parsed.payload.command)
      ? parsed.payload.command.join(' ')
      : parsed.payload.command;
    records.push({
      signature,
      type: 'tool_finished',
      content: extractToolOutputText(
        parsed.payload.aggregated_output
          ?? parsed.payload.formatted_output
          ?? parsed.payload.stdout
          ?? parsed.payload.stderr
          ?? parsed.payload.command,
      ),
      timestamp,
      ...(parsed.payload.turn_id || activeTurnId ? { turnId: parsed.payload.turn_id || activeTurnId || undefined } : {}),
      toolId,
      toolName: 'Bash',
      toolInput: commandInput,
      isError: status === 'failed' || (exitCode != null && exitCode !== 0),
    });
    return true;
  }

  if (parsed.payload?.type === 'patch_apply_end') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    const status = extractNormalizedFreeText(parsed.payload.status).toLowerCase();
    records.push({
      signature,
      type: 'tool_finished',
      content: summarizePatchChanges(parsed.payload.changes)
        || extractToolOutputText(parsed.payload.stdout ?? parsed.payload.stderr),
      timestamp,
      ...(parsed.payload.turn_id || activeTurnId ? { turnId: parsed.payload.turn_id || activeTurnId || undefined } : {}),
      toolId,
      toolName: 'apply_patch',
      isError: parsed.payload.success === false || status === 'failed',
    });
    return true;
  }

  if (parsed.payload?.type === 'dynamic_tool_call_request') {
    const toolId = getDynamicToolCallId(parsed.payload) || signature;
    const toolName = extractNormalizedFreeText(parsed.payload.tool) || 'tool';
    records.push({
      signature,
      type: 'tool_started',
      content: '',
      timestamp,
      ...(parsed.payload.turnId || activeTurnId ? { turnId: parsed.payload.turnId || activeTurnId || undefined } : {}),
      toolId,
      toolName,
      toolInput: parsed.payload.arguments,
    });
    return true;
  }

  if (parsed.payload?.type === 'dynamic_tool_call_response') {
    const toolId = getDynamicToolCallId(parsed.payload) || signature;
    const toolName = extractNormalizedFreeText(parsed.payload.tool) || 'tool';
    records.push({
      signature,
      type: 'tool_finished',
      content: extractToolOutputText(parsed.payload.content_items ?? parsed.payload.error),
      timestamp,
      ...(parsed.payload.turn_id || activeTurnId ? { turnId: parsed.payload.turn_id || activeTurnId || undefined } : {}),
      toolId,
      toolName,
      isError: parsed.payload.success === false,
    });
    return true;
  }

  if (parsed.payload?.type === 'user_message') {
    const text = extractNormalizedStructuredText(parsed.payload.message);
    if (!text) return true;
    records.push({
      signature,
      type: 'message',
      role: 'user',
      content: text,
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (parsed.payload?.type === 'task_complete') {
    records.push({
      signature,
      type: 'task_complete',
      role: 'assistant',
      content: extractNormalizedStructuredText(parsed.payload.last_agent_message),
      timestamp,
      turnId: parsed.payload.turn_id || '',
    });
    return true;
  }

  return false;
}

function pushCodexMirrorResponseRecord(
  records: CodexMirrorRecord[],
  parsed: SessionMessageLine,
  rawLine: string,
  activeTurnId: string | null,
  activeSpecialCallIds: Set<string>,
): boolean {
  const signature = createCodexEventSignature(rawLine);
  const timestamp = parsed.timestamp || '';

  if (isIgnoredMirrorLineKind(parsed)) {
    return true;
  }

  if (parsed.payload?.type === 'reasoning') {
    const text = extractReasoningSummary(parsed.payload);
    if (!text) return true;
    records.push({
      signature,
      type: 'reasoning',
      content: text,
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (parsed.payload?.type === 'message' && parsed.payload.role === 'assistant') {
    const text = extractCodexMessageText(parsed);
    if (!text) return true;
    records.push({
      signature,
      type: 'message',
      role: parsed.payload.phase === 'commentary' ? 'commentary' : 'assistant',
      content: parsed.payload.phase === 'commentary' ? text.replace(/^\[commentary\]\n/, '') : text,
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
    });
    return true;
  }

  if (parsed.payload?.type === 'tool_search_call') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    records.push({
      signature,
      type: 'tool_started',
      content: '',
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      toolName: 'tool_search',
      toolInput: parsed.payload.arguments,
    });
    return true;
  }

  if (parsed.payload?.type === 'tool_search_output') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    const status = extractNormalizedFreeText(parsed.payload.status).toLowerCase();
    records.push({
      signature,
      type: 'tool_finished',
      content: summarizeToolSearchOutput(parsed.payload.tools),
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      toolName: 'tool_search',
      isError: status === 'failed',
    });
    return true;
  }

  if (parsed.payload?.type === 'function_call') {
    const toolName = formatCodexToolName(parsed.payload.namespace, parsed.payload.name);
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    if (!toolName) return true;
    if (toolName === 'update_plan') {
      const tasks = parseUpdatePlanTasks(parsed.payload.arguments);
      activeSpecialCallIds.add(toolId);
      records.push({
        signature,
        type: 'plan_update',
        content: '',
        timestamp,
        ...(activeTurnId ? { turnId: activeTurnId } : {}),
        tasks,
      });
      return true;
    }
    records.push({
      signature,
      type: 'tool_started',
      content: '',
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      toolName,
      toolInput: parsed.payload.arguments,
    });
    return true;
  }

  if (parsed.payload?.type === 'custom_tool_call') {
    const toolName = formatCodexToolName(parsed.payload.namespace, parsed.payload.name);
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    if (!toolName) return true;
    if (toolName === 'update_plan') {
      const tasks = parseUpdatePlanTasks(typeof parsed.payload.input === 'string' ? parsed.payload.input : undefined);
      activeSpecialCallIds.add(toolId);
      records.push({
        signature,
        type: 'plan_update',
        content: '',
        timestamp,
        ...(activeTurnId ? { turnId: activeTurnId } : {}),
        tasks,
      });
      return true;
    }
    records.push({
      signature,
      type: 'tool_started',
      content: '',
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      toolName,
      toolInput: parsed.payload.input,
    });
    return true;
  }

  if (parsed.payload?.type === 'function_call_output') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    if (activeSpecialCallIds.has(toolId)) {
      activeSpecialCallIds.delete(toolId);
      return true;
    }
    records.push({
      signature,
      type: 'tool_finished',
      content: extractToolOutputText(parsed.payload.output),
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      isError: parsed.payload.is_error === true,
    });
    return true;
  }

  if (parsed.payload?.type === 'custom_tool_call_output') {
    const toolId = extractNormalizedFreeText(parsed.payload.call_id) || signature;
    if (activeSpecialCallIds.has(toolId)) {
      activeSpecialCallIds.delete(toolId);
      return true;
    }
    records.push({
      signature,
      type: 'tool_finished',
      content: extractToolOutputText(parsed.payload.output),
      timestamp,
      ...(activeTurnId ? { turnId: activeTurnId } : {}),
      toolId,
      isError: parsed.payload.is_error === true,
    });
    return true;
  }

  return false;
}

export function parseCodexSessionEventText(
  content: string,
  leadingText = '',
  flushTrailingText = false,
): CodexSessionEventDelta {
  const combined = `${leadingText}${content}`;
  if (!combined) {
    return {
      events: [],
      nextOffset: 0,
      trailingText: '',
    };
  }

  const hasTrailingNewline = combined.endsWith('\n') || combined.endsWith('\r');
  const rawLines = combined.split(/\r?\n/);
  let trailingText = hasTrailingNewline ? '' : (rawLines.pop() || '');
  if (flushTrailingText && trailingText) {
    rawLines.push(trailingText);
    trailingText = '';
  }
  const events: CodexSessionEvent[] = [];

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: SessionMessageLine | SessionEventLine;
    try {
      parsed = JSON.parse(trimmed) as SessionMessageLine | SessionEventLine;
    } catch {
      continue;
    }

    pushCodexSessionEvent(events, parsed, trimmed);
  }

  return {
    events,
    nextOffset: 0,
    trailingText,
  };
}

export function parseCodexMirrorRecordText(
  content: string,
  leadingText = '',
  flushTrailingText = false,
  initialTurnId: string | null = null,
  initialSpecialCallIds: Iterable<string> = [],
): CodexMirrorRecordDelta {
  const combined = `${leadingText}${content}`;
  if (!combined) {
    return {
      records: [],
      nextOffset: 0,
      trailingText: '',
      nextTurnId: initialTurnId,
      nextSpecialCallIds: [],
      unknownKinds: [],
    };
  }

  const hasTrailingNewline = combined.endsWith('\n') || combined.endsWith('\r');
  const rawLines = combined.split(/\r?\n/);
  let trailingText = hasTrailingNewline ? '' : (rawLines.pop() || '');
  if (flushTrailingText && trailingText) {
    rawLines.push(trailingText);
    trailingText = '';
  }
  const records: CodexMirrorRecord[] = [];
  let activeTurnId = initialTurnId;
  const activeSpecialCallIds = new Set(initialSpecialCallIds);
  const unknownKinds = new Set<string>();

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: SessionMessageLine | SessionEventLine | TurnContextLine;
    try {
      parsed = JSON.parse(trimmed) as SessionMessageLine | SessionEventLine | TurnContextLine;
    } catch {
      continue;
    }

    if (isTurnContextLine(parsed)) {
      activeTurnId = parsed.payload?.turn_id || activeTurnId;
      continue;
    }

    if (isSessionEventLine(parsed) && parsed.payload?.type === 'task_started') {
      const eventPayload = parsed.payload as SessionEventLine['payload'];
      activeTurnId = eventPayload?.turn_id || activeTurnId;
    }

    const handled = pushCodexMirrorRecord(records, parsed, trimmed, activeTurnId, activeSpecialCallIds);
    if (!handled) {
      const unknownKind = describeUnhandledMirrorLineKind(parsed);
      if (unknownKind) unknownKinds.add(unknownKind);
    }

    if (
      isSessionEventLine(parsed)
      && (parsed.payload?.type === 'task_complete' || parsed.payload?.type === 'turn_aborted')
    ) {
      const eventPayload = parsed.payload as SessionEventLine['payload'];
      const completedTurnId = eventPayload?.turn_id || activeTurnId;
      if (!completedTurnId || completedTurnId === activeTurnId) {
        activeTurnId = null;
      }
      activeSpecialCallIds.clear();
    }
  }

  return {
    records,
    nextOffset: 0,
    trailingText,
    nextTurnId: activeTurnId,
    nextSpecialCallIds: Array.from(activeSpecialCallIds),
    unknownKinds: Array.from(unknownKinds),
  };
}
