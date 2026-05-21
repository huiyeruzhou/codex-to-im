import type { TaskProgressInfo, ToolCallInfo } from '../types.js';
import { buildFencedCodeBlock } from './fence.js';

/**
 * Feishu-specific Markdown processing.
 *
 * Rendering strategy (aligned with Openclaw):
 * - Code blocks / tables → interactive card (schema 2.0 markdown)
 * - Other text → post (msg_type: 'post') with md tag
 *
 * Schema 2.0 cards render code blocks, tables, bold, italic, links properly.
 * Post messages with md tag render bold, italic, inline code, links.
 */

/**
 * Detect complex markdown (code blocks / tables).
 * Used by send() to decide between card and post rendering.
 */
export function hasComplexMarkdown(text: string): boolean {
  // Fenced code blocks
  if (/```[\s\S]*?```/.test(text)) return true;
  // Tables: header row followed by separator row with pipes and dashes
  if (/\|.+\|[\r\n]+\|[-:| ]+\|/.test(text)) return true;
  return false;
}

/**
 * Preprocess markdown for Feishu rendering.
 * Only ensures code fences have a newline before them.
 * Does NOT touch the text after ``` to preserve language tags like ```python.
 */
export function preprocessFeishuMarkdown(text: string): string {
  // Ensure ``` has newline before it (unless at start of text)
  return text.replace(/([^\n])```/g, '$1\n```');
}

/**
 * Build Feishu interactive card content (schema 2.0 markdown).
 * Renders code blocks, tables, bold, italic, links, inline code properly.
 * Aligned with Openclaw's buildMarkdownCard().
 */
export function buildCardContent(text: string): string {
  return JSON.stringify({
    schema: '2.0',
    config: {
      wide_screen_mode: true,
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: text,
        },
      ],
    },
  });
}

/**
 * Build Feishu post message content (msg_type: 'post') with md tag.
 * Used for simple text without code blocks or tables.
 * Aligned with Openclaw's buildFeishuPostMessagePayload().
 */
export function buildPostContent(text: string): string {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: 'md', text }]],
    },
  });
}

/**
 * Convert simple HTML (from command responses) to markdown for Feishu.
 * Handles common tags: <b>, <i>, <code>, <br>, entities.
 */
export function htmlToFeishuMarkdown(html: string): string {
  return html
    .replace(/<b>(.*?)<\/b>/gi, '**$1**')
    .replace(/<strong>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<i>(.*?)<\/i>/gi, '*$1*')
    .replace(/<em>(.*?)<\/em>/gi, '*$1*')
    .replace(/<code>(.*?)<\/code>/gi, '`$1`')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Build tool progress markdown lines.
 * Tools are grouped by name so repeated shell/apply_patch calls
 * do not flood the card. The icon reflects the highest-priority live state:
 * running > error > complete.
 */
export type FinalCardTerminalStatus = 'completed' | 'interrupted' | 'error';

interface ProgressRenderOptions {
  terminalStatus?: FinalCardTerminalStatus | null;
}

function normalizeToolStatusForRender(
  status: ToolCallInfo['status'],
  options: ProgressRenderOptions,
): ToolCallInfo['status'] {
  if (status !== 'running' || !options.terminalStatus) return status;
  return options.terminalStatus === 'completed' ? 'complete' : 'error';
}

export function buildToolProgressMarkdown(
  tools: ToolCallInfo[],
  options: ProgressRenderOptions = {},
): string {
  if (tools.length === 0) return '';

  const normalized = tools.map((tool) => ({
    ...tool,
    status: normalizeToolStatusForRender(tool.status, options),
  }));

  const maxItems = 5;
  const slice = normalized.length > maxItems ? normalized.slice(-maxItems) : normalized;
  const hiddenCount = normalized.length - slice.length;

  const blocks: string[] = [];
  if (hiddenCount > 0) {
    blocks.push(`… 还有 ${hiddenCount} 个工具调用已折叠`);
  }

  for (const tool of slice) {
    const statusLabel = tool.status === 'running' ? '运行中' : tool.status === 'error' ? '异常' : '完成';
    const icon = tool.status === 'running' ? '🔄' : tool.status === 'error' ? '❌' : '✅';
    const header = `#### ${icon} \`${tool.name || 'tool'}\`（${statusLabel}）`;
    const details: string[] = [];
    const isEditTool = /^edit$/i.test(tool.name || '');
    const isBashTool = /^(bash|shell_command)$/i.test(tool.name || '');
    if (!isEditTool && tool.input && tool.input.trim()) {
      details.push(`输入：\n${buildFencedCodeBlock(tool.input.trim(), isBashTool ? 'bash' : 'json')}`);
    }
    if (tool.output && tool.output.trim()) {
      details.push(`输出：\n${buildFencedCodeBlock(tool.output.trim(), 'text')}`);
    }
    blocks.push(details.length > 0 ? `${header}\n\n${details.join('\n\n')}` : header);
  }

  return blocks.join('\n\n');
}

function getTaskProgressPresentation(
  task: TaskProgressInfo,
  options: ProgressRenderOptions,
): { icon: string; label: string } {
  if (!options.terminalStatus) {
    return task.status === 'completed'
      ? { icon: '✅', label: '已完成' }
      : task.status === 'in_progress'
        ? { icon: '🔄', label: '执行中' }
        : { icon: '⏳', label: '等待中' };
  }

  if (task.status === 'completed') {
    return { icon: '✅', label: '已完成' };
  }

  if (options.terminalStatus === 'completed') {
    return { icon: '✅', label: '已结束' };
  }
  if (options.terminalStatus === 'interrupted') {
    return task.status === 'pending'
      ? { icon: '⚠️', label: '未执行' }
      : { icon: '⚠️', label: '已停止' };
  }
  return task.status === 'pending'
    ? { icon: '❌', label: '未执行' }
    : { icon: '❌', label: '已中断' };
}

export function buildTaskProgressMarkdown(
  tasks: TaskProgressInfo[],
  options: ProgressRenderOptions = {},
): string {
  if (tasks.length === 0) return '';
  return tasks
    .map((task) => {
      const { icon, label } = getTaskProgressPresentation(task, options);
      return `${icon} ${task.text}（${label}）`;
    })
    .join('\n');
}

/**
 * Format elapsed time for card footer.
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const remSec = Math.floor(sec % 60);
  return `${min}m ${remSec}s`;
}

/**
 * Build the body text for the primary streaming content region.
 */
export function buildStreamingTextContent(text: string): string {
  return text || '💭 Thinking...';
}

/**
 * Build the tool-only markdown content for the dedicated streaming tools region.
 */
export function buildStreamingToolsContent(tools: ToolCallInfo[]): string {
  return buildToolProgressMarkdown(tools);
}

export function buildStreamingTaskContent(tasks: TaskProgressInfo[]): string {
  return buildTaskProgressMarkdown(tasks);
}

/**
 * Build the final card JSON (schema 2.0) with text, tool progress, and footer.
 */
export function buildFinalCardJson(
  text: string,
  tasks: TaskProgressInfo[],
  tools: ToolCallInfo[],
  footer: { status: string; elapsed: string } | null,
  terminalStatus?: FinalCardTerminalStatus,
): string {
  const elements: Array<Record<string, unknown>> = [];

  // Main text content
  const content = preprocessFeishuMarkdown(text);
  const renderOptions = { terminalStatus };
  const taskMd = buildTaskProgressMarkdown(tasks, renderOptions);
  const toolMd = buildToolProgressMarkdown(tools, renderOptions);

  if (content) {
    elements.push({
      tag: 'markdown',
      content,
      text_align: 'left',
      text_size: 'normal',
    });
  }

  if (taskMd) {
    if (elements.length > 0) {
      elements.push({ tag: 'hr' });
    }
    elements.push({
      tag: 'markdown',
      content: taskMd,
      text_align: 'left',
      text_size: 'normal',
    });
  }

  if (toolMd) {
    if (elements.length > 0) {
      elements.push({ tag: 'hr' });
    }
    elements.push({
      tag: 'markdown',
      content: toolMd,
      text_align: 'left',
      text_size: 'normal',
    });
  }

  // Footer
  if (footer) {
    const parts: string[] = [];
    if (footer.status) parts.push(footer.status);
    if (footer.elapsed) parts.push(footer.elapsed);
    if (parts.length > 0) {
      if (elements.length > 0) {
        elements.push({ tag: 'hr' });
      }
      elements.push({
        tag: 'markdown',
        content: parts.join(' · '),
        text_size: 'notation',
      });
    }
  }

  return JSON.stringify({
    schema: '2.0',
    config: { wide_screen_mode: true },
    body: { elements },
  });
}

/**
 * Build a permission card with real action buttons (column_set layout).
 * Structure aligned with CodePilot's working Feishu outbound implementation.
 * Returns the card JSON string for msg_type: 'interactive'.
 */
export function buildPermissionButtonCard(
  text: string,
  permissionRequestId: string,
  chatId?: string,
): string {
  const buttons = [
    { label: 'Allow', type: 'primary', action: 'allow' },
    { label: 'Allow Session', type: 'default', action: 'allow_session' },
    { label: 'Deny', type: 'danger', action: 'deny' },
  ];

  const buttonColumns = buttons.map((btn) => ({
    tag: 'column',
    width: 'auto',
    elements: [{
      tag: 'button',
      text: { tag: 'plain_text', content: btn.label },
      type: btn.type,
      size: 'medium',
      value: { callback_data: `perm:${btn.action}:${permissionRequestId}`, ...(chatId ? { chatId } : {}) },
    }],
  }));

  return JSON.stringify({
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Permission Required' },
      template: 'blue',
      icon: { tag: 'standard_icon', token: 'lock-chat_filled' },
      padding: '12px 12px 12px 12px',
    },
    body: {
      elements: [
        { tag: 'markdown', content: text, text_size: 'normal' },
        { tag: 'markdown', content: '⏱ This request will expire in 5 minutes', text_size: 'notation' },
        { tag: 'hr' },
        {
          tag: 'column_set',
          flex_mode: 'none',
          horizontal_align: 'left',
          columns: buttonColumns,
        },
        { tag: 'hr' },
        {
          tag: 'markdown',
          content: 'Or reply: `1` Allow · `2` Allow Session · `3` Deny',
          text_size: 'notation',
        },
      ],
    },
  });
}
