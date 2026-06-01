import type { BridgeMessage } from '../../lib/bridge/host.js';
import {
  formatContextUsageSummary,
  parseContextUsageInfo,
} from '../../lib/bridge/context-usage.js';
import {
  createCodexEventSignature,
  extractCodexMessageText,
  extractNormalizedFreeText,
  extractNormalizedStructuredText,
  extractReasoningSummary,
  extractToolOutputText,
  formatCodexToolName,
  isSessionEventLine,
  isSessionMessageLine,
  isTurnContextLine,
  summarizePatchChanges,
  summarizeToolSearchOutput,
  type CodexSessionJsonlHistoryEntry,
  type SessionEventLine,
  type SessionMessageLine,
  type SessionMetaLine,
  type TurnContextLine,
} from './jsonl-types.js';

const CONTEXT_COMPACTED_NOTICE = '上下文已压缩，后续回复会基于压缩后的上下文继续。';

function classifySessionJsonlRole(
  parsed: SessionMetaLine | SessionMessageLine | SessionEventLine | TurnContextLine,
): CodexSessionJsonlHistoryEntry['role'] {
  if (isTurnContextLine(parsed as TurnContextLine)) return 'system';

  if (isSessionMessageLine(parsed as SessionMessageLine)) {
    const msg = parsed as SessionMessageLine;
    const payloadType = typeof msg.payload?.type === 'string' ? msg.payload.type.trim() : '';
    if (payloadType === 'message') {
      const role = typeof msg.payload?.role === 'string' ? msg.payload.role.trim() : '';
      if (role === 'user') return 'user';
      if (role === 'assistant') return msg.payload?.phase === 'commentary' ? 'commentary' : 'assistant';
      if (role === 'system') return 'system';
      if (role === 'tool') return 'tool';
      return 'assistant';
    }
    if (payloadType === 'reasoning') return 'commentary';
    if (
      payloadType === 'function_call'
      || payloadType === 'function_call_output'
      || payloadType === 'custom_tool_call'
      || payloadType === 'custom_tool_call_output'
      || payloadType === 'tool_search_call'
      || payloadType === 'tool_search_output'
      || payloadType === 'web_search_call'
    ) {
      return 'tool';
    }
    return 'system';
  }

  if (isSessionEventLine(parsed as SessionEventLine)) {
    const evt = parsed as SessionEventLine;
    const payloadType = typeof evt.payload?.type === 'string' ? evt.payload.type.trim() : '';
    if (payloadType === 'user_message') return 'user';
    if (payloadType === 'agent_message') return evt.payload?.phase === 'commentary' ? 'commentary' : 'assistant';
    if (payloadType === 'context_compacted' || payloadType === 'agent_reasoning') return 'commentary';
    if (
      payloadType === 'exec_command_end'
      || payloadType === 'patch_apply_end'
      || payloadType === 'mcp_tool_call_end'
      || payloadType === 'web_search_end'
      || payloadType === 'dynamic_tool_call_request'
      || payloadType === 'dynamic_tool_call_response'
    ) {
      return 'tool';
    }
    return 'system';
  }

  return 'system';
}

function buildSessionJsonlKindLabel(
  parsed: SessionMetaLine | SessionMessageLine | SessionEventLine | TurnContextLine,
): string {
  const topType = typeof parsed.type === 'string' ? parsed.type.trim() : '';
  const payloadType = typeof (parsed as SessionMessageLine | SessionEventLine).payload?.type === 'string'
    ? String((parsed as SessionMessageLine | SessionEventLine).payload?.type).trim()
    : '';
  const top = topType || 'jsonl';
  return payloadType ? `${top}:${payloadType}` : top;
}

function parseFixedToolOutput(text: string): { exitCode?: number; wallTime?: string; output?: string } {
  const normalized = String(text || '');
  const exitMatch = normalized.match(/\bProcess exited with code\s+(\d+)\b/i);
  const exitCode = exitMatch ? Number(exitMatch[1]) : undefined;

  const wallTimeMatch = normalized.match(/\bWall time:\s*([\d.]+)\s*s/i);
  const wallTime = wallTimeMatch ? wallTimeMatch[1] : undefined;

  const marker = normalized.indexOf('\nOutput:\n');
  const output = marker >= 0 ? normalized.slice(marker + '\nOutput:\n'.length).trim() : '';
  return {
    exitCode: Number.isFinite(exitCode) ? exitCode : undefined,
    wallTime,
    output: output || undefined,
  };
}

function formatTokenCountSummary(info: unknown): string {
  return formatContextUsageSummary(parseContextUsageInfo(info));
}

function extractSessionJsonlPrimaryText(
  parsed: SessionMetaLine | SessionMessageLine | SessionEventLine | TurnContextLine,
): string {
  if (isTurnContextLine(parsed as TurnContextLine)) {
    const turnId = (parsed as TurnContextLine).payload?.turn_id?.trim();
    return turnId ? `turn_id: ${turnId}` : '';
  }

  if (isSessionMessageLine(parsed as SessionMessageLine)) {
    const msg = parsed as SessionMessageLine;
    const payloadType = typeof msg.payload?.type === 'string' ? msg.payload.type.trim() : '';
    if (payloadType === 'message') {
      return extractCodexMessageText(msg);
    }
    if (payloadType === 'reasoning') {
      return extractReasoningSummary(msg.payload as any);
    }
    if (payloadType === 'function_call' || payloadType === 'custom_tool_call') {
      const toolName = formatCodexToolName(msg.payload?.namespace, msg.payload?.name) || 'tool';
      const args = typeof msg.payload?.arguments === 'string'
        ? msg.payload.arguments
        : typeof msg.payload?.input === 'string'
          ? msg.payload.input
          : '';

      if (toolName === 'exec_command' && args && args.trim().startsWith('{')) {
        try {
          const parsedArgs = JSON.parse(args.trim());
          const command = typeof parsedArgs.command === 'string' ? parsedArgs.command.trim() : '';
          if (command) {
            return `${toolName}\n\n\`\`\`sh\n${command}\n\`\`\``;
          }
        } catch {
          // fallback to original format
        }
      }
      return args ? `${toolName}\n\n${args}` : toolName;
    }
    if (payloadType === 'function_call_output' || payloadType === 'custom_tool_call_output') {
      const rawOutput = extractToolOutputText(msg.payload?.output);
      const parsedOutput = parseFixedToolOutput(rawOutput);
      const lines: string[] = [];

      const statusParts: string[] = [];
      if (parsedOutput.wallTime) {
        if (parsedOutput.exitCode === 0) {
          statusParts.push(`✓ Succeeded in ${parsedOutput.wallTime}s`);
        } else if (parsedOutput.exitCode != null) {
          statusParts.push(`✗ Exited with code ${parsedOutput.exitCode} in ${parsedOutput.wallTime}s`);
        } else {
          statusParts.push(`⏱️ Completed in ${parsedOutput.wallTime}s`);
        }
      } else if (parsedOutput.exitCode === 0) {
        statusParts.push('✓ Succeeded');
      } else if (parsedOutput.exitCode != null) {
        statusParts.push(`✗ Exited with code ${parsedOutput.exitCode}`);
      }
      if (statusParts.length) lines.push(statusParts.join(' '));

      const body = parsedOutput.output || rawOutput.trim();
      if (body) {
        if (lines.length) lines.push('');
        lines.push('```');
        lines.push(body);
        lines.push('```');
      }
      return lines.join('\n');
    }
    if (payloadType === 'tool_search_call') {
      return '工具调用: tool_search';
    }
    if (payloadType === 'tool_search_output') {
      const summary = summarizeToolSearchOutput(msg.payload?.tools);
      return summary ? `工具输出:\n\n${summary}` : '';
    }
    return '';
  }

  if (isSessionEventLine(parsed as SessionEventLine)) {
    const evt = parsed as SessionEventLine;
    const payloadType = typeof evt.payload?.type === 'string' ? evt.payload.type.trim() : '';
    if (payloadType === 'task_started') {
      const turnId = typeof evt.payload?.turn_id === 'string' ? evt.payload.turn_id.trim() : '';
      return turnId ? `任务开始 (turn_id: ${turnId})` : '任务开始';
    }
    if (payloadType === 'turn_aborted') {
      const reason = extractNormalizedStructuredText(evt.payload?.reason);
      return reason ? `任务中止\n\n${reason}` : '任务中止';
    }
    if (payloadType === 'task_complete') {
      const finalMessage = extractNormalizedStructuredText(evt.payload?.last_agent_message);
      return finalMessage || '任务完成';
    }
    if (payloadType === 'context_compacted') {
      return CONTEXT_COMPACTED_NOTICE;
    }
    if (payloadType === 'token_count') {
      return formatTokenCountSummary((evt.payload as any)?.info);
    }
    if (payloadType === 'user_message') {
      return extractNormalizedStructuredText(evt.payload?.message);
    }
    if (payloadType === 'agent_message') {
      return extractNormalizedStructuredText(evt.payload?.message);
    }
    if (payloadType === 'agent_reasoning') {
      return extractNormalizedStructuredText(evt.payload?.text);
    }
    if (payloadType === 'exec_command_end') {
      const exitCode = typeof (evt.payload as any)?.exit_code === 'number' ? (evt.payload as any).exit_code : null;
      const wallTime = typeof (evt.payload as any)?.duration_seconds === 'number' ? String((evt.payload as any).duration_seconds) : null;
      const output = extractToolOutputText(
        evt.payload?.aggregated_output
          ?? evt.payload?.formatted_output
          ?? evt.payload?.stdout
          ?? evt.payload?.stderr
          ?? evt.payload?.command,
      ).trim();

      const lines: string[] = [];
      const statusParts: string[] = [];
      if (wallTime) {
        if (exitCode === 0) {
          statusParts.push(`✓ Succeeded in ${wallTime}s`);
        } else if (exitCode != null) {
          statusParts.push(`✗ Exited with code ${exitCode} in ${wallTime}s`);
        } else {
          statusParts.push(`⏱️ Completed in ${wallTime}s`);
        }
      } else if (exitCode === 0) {
        statusParts.push('✓ Succeeded');
      } else if (exitCode != null) {
        statusParts.push(`✗ Exited with code ${exitCode}`);
      }
      if (statusParts.length) lines.push(statusParts.join(' '));

      if (output) {
        if (lines.length) lines.push('');
        lines.push('```');
        lines.push(output);
        lines.push('```');
      }
      return lines.join('\n');
    }
    if (payloadType === 'patch_apply_end') {
      const status = extractNormalizedFreeText(evt.payload?.status).toLowerCase();
      const output = summarizePatchChanges(evt.payload?.changes)
        || extractToolOutputText(evt.payload?.stdout ?? evt.payload?.stderr).trim();
      const lines: string[] = [];
      if (status) lines.push(`Status: ${status}`);
      if (output) {
        if (lines.length) lines.push('');
        lines.push(output);
      }
      return lines.join('\n');
    }
    if (payloadType === 'mcp_tool_call_end') {
      const server = extractNormalizedFreeText(evt.payload?.invocation?.server);
      const tool = extractNormalizedFreeText(evt.payload?.invocation?.tool);
      const name = server && tool ? `mcp__${server}__${tool}` : 'mcp_tool_call';
      return `工具调用完成: ${name}`;
    }
    if (payloadType === 'web_search_end') {
      const query = extractNormalizedStructuredText(evt.payload?.query);
      return query ? `Web Search\n\n${query}` : 'Web Search';
    }
    if (payloadType === 'dynamic_tool_call_request') {
      const toolName = extractNormalizedFreeText(evt.payload?.tool) || 'tool';
      return `工具调用开始: ${toolName}`;
    }
    if (payloadType === 'dynamic_tool_call_response') {
      const toolName = extractNormalizedFreeText(evt.payload?.tool) || 'tool';
      const output = extractToolOutputText(evt.payload?.content_items ?? evt.payload?.error).trim();
      return output ? `工具调用完成: ${toolName}\n\n${output}` : `工具调用完成: ${toolName}`;
    }
    return '';
  }

  const payload = parsed.payload;
  if (payload && typeof payload === 'object') {
    const cwd = typeof (payload as any).cwd === 'string' ? String((payload as any).cwd).trim() : '';
    const originator = typeof (payload as any).originator === 'string' ? String((payload as any).originator).trim() : '';
    const source = typeof (payload as any).source === 'string' ? String((payload as any).source).trim() : '';
    const cliVersion = typeof (payload as any).cli_version === 'string' ? String((payload as any).cli_version).trim() : '';
    const summaryParts = [
      cwd ? `cwd: ${cwd}` : '',
      originator ? `originator: ${originator}` : '',
      source ? `source: ${source}` : '',
      cliVersion ? `cli: ${cliVersion}` : '',
    ].filter(Boolean);
    return summaryParts.length ? summaryParts.join('\n') : '';
  }

  return '';
}

function formatSessionJsonlEntryContent(
  parsed: SessionMetaLine | SessionMessageLine | SessionEventLine | TurnContextLine,
): string {
  return extractSessionJsonlPrimaryText(parsed).trim();
}

export function parseCodexSessionJsonlHistoryText(content: string): CodexSessionJsonlHistoryEntry[] {
  if (!content) return [];
  const hasTrailingNewline = content.endsWith('\n') || content.endsWith('\r');
  const rawLines = content.split(/\r?\n/);
  if (!hasTrailingNewline) {
    const trailing = rawLines.pop();
    if (trailing && trailing.trim()) rawLines.push(trailing);
  }

  const entries: CodexSessionJsonlHistoryEntry[] = [];
  for (const rawLine of rawLines) {
    if (!rawLine) continue;
    const normalized = rawLine.replace(/\r$/, '');
    const signature = createCodexEventSignature(normalized);
    let parsed: SessionMetaLine | SessionMessageLine | SessionEventLine | TurnContextLine | null = null;
    try {
      parsed = JSON.parse(normalized) as SessionMetaLine | SessionMessageLine | SessionEventLine | TurnContextLine;
    } catch {
      entries.push({
        signature,
        role: 'other',
        kind: 'jsonl:unparsed',
        content: normalized,
        timestamp: '',
        rawJsonl: normalized,
      });
      continue;
    }

    const timestamp = (
      typeof (parsed as { timestamp?: unknown }).timestamp === 'string' ? (parsed as { timestamp?: string }).timestamp : ''
    )
      || (typeof (parsed as { payload?: { timestamp?: unknown } }).payload?.timestamp === 'string'
        ? String((parsed as { payload?: { timestamp?: string } }).payload?.timestamp)
        : '');
    const role = classifySessionJsonlRole(parsed);
    const kind = buildSessionJsonlKindLabel(parsed);
    const contentText = formatSessionJsonlEntryContent(parsed);
    entries.push({
      signature,
      role,
      kind,
      content: contentText || '(无可展示内容)',
      timestamp,
      rawJsonl: normalized,
    });
  }
  return entries;
}

export function codexJsonlHistoryEntriesToBridgeMessages(
  entries: CodexSessionJsonlHistoryEntry[],
  limit = 8,
): BridgeMessage[] {
  const messages: BridgeMessage[] = [];

  for (const entry of entries) {
    const content = entry.content.trim();
    if (!content || content === '(无可展示内容)') continue;

    let message: BridgeMessage | null = null;
    if (entry.role === 'user') {
      message = { role: 'user', content };
    } else if (entry.role === 'assistant') {
      message = { role: 'assistant', content };
    } else if (entry.role === 'commentary') {
      message = { role: 'assistant', content: `[commentary]\n${content}` };
    } else if (entry.kind === 'event_msg:task_complete') {
      message = { role: 'assistant', content };
    }

    if (!message) continue;

    const previous = messages[messages.length - 1];
    if (previous?.role === message.role && previous.content === message.content) {
      continue;
    }

    messages.push(message);
  }

  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 8;
  return messages.slice(-safeLimit);
}
