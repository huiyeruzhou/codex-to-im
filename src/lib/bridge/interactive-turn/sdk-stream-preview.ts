import { maskSecrets } from '../../../logger.js';
import { buildFencedCodeBlock } from '../markdown/fence.js';
import { sanitizeInput } from '../security/validators.js';

export function appendStreamPreviewChunk(
  current: string,
  chunk: string,
  separateBeforeChunk: boolean,
): string {
  if (!separateBeforeChunk || !current.trim() || !chunk.trim()) {
    return current + chunk;
  }
  const separator = current.endsWith('\n\n') ? '' : (current.endsWith('\n') ? '\n' : '\n\n');
  return `${current}${separator}${chunk}`;
}

function stringifyToolValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summarizeToolInputForInline(input: unknown): string {
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    const commandValue = record.command;
    if (typeof commandValue === 'string' && commandValue.trim()) {
      const trimmedCommand = commandValue.trim();
      const bashPrefix = '/bin/bash -lc "';
      return trimmedCommand.startsWith(bashPrefix) && trimmedCommand.endsWith('"')
        ? trimmedCommand.slice(bashPrefix.length, -1)
        : trimmedCommand;
    }
  }
  return stringifyToolValue(input);
}

export function buildInlineToolBlock(params: {
  name: string;
  status?: 'running' | 'complete' | 'error';
  input?: unknown;
  output?: string;
  isError?: boolean;
}): string {
  const status = params.status || (params.isError ? 'error' : (typeof params.output === 'string' ? 'complete' : 'running'));
  const statusLabel = status === 'running' ? '运行中' : status === 'error' ? '异常' : '完成';
  const icon = status === 'running' ? '🔧' : status === 'error' ? '❌' : '✅';
  const title = `#### ${icon} \`${params.name || 'tool'}\`（${statusLabel}）`;
  const sections: string[] = [title];

  const isEditTool = /^edit$/i.test(params.name || '');
  const isBashTool = /^(bash|shell_command)$/i.test(params.name || '');

  if (!isEditTool && typeof params.input !== 'undefined') {
    const inputText = summarizeToolInputForInline(params.input);
    const masked = maskSecrets(inputText);
    const { text } = sanitizeInput(masked, 1200);
    if (text.trim()) {
      sections.push(`输入：\n${buildFencedCodeBlock(text.trim(), isBashTool ? 'bash' : 'json')}`);
    }
  }

  if (typeof params.output === 'string') {
    const masked = maskSecrets(params.output);
    const { text } = sanitizeInput(masked, 1800);
    if (text.trim()) {
      sections.push(`输出：\n${buildFencedCodeBlock(text.trim(), 'text')}`);
    }
  }

  return sections.join('\n\n').trim();
}

export function buildReasoningPreviewNote(note: string): string {
  const masked = maskSecrets(note);
  const { text } = sanitizeInput(masked, 1200);
  return text.trim() ? `> ${text.trim().replace(/\n/g, '\n> ')}` : '';
}
