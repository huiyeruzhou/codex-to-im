import type {
  OutboundCardActionSelect,
  OutboundRichCard,
  OutboundRichCardSection,
  OutboundRichCardTable,
  TaskProgressInfo,
  ToolCallInfo,
} from '../types.js';
import type { StructuredStreamingUiMetadata } from '../channel-adapter.js';
import { buildFencedCodeBlock } from './fence.js';

export interface FeishuCardActionButton {
  text: string;
  callbackData: string;
  type?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
}

function resolveTitleTagColor(
  tag: string,
  defaultColor: NonNullable<StructuredStreamingUiMetadata['tagColor']>,
): NonNullable<StructuredStreamingUiMetadata['tagColor']> {
  const normalized = tag.trim().toLowerCase();
  if (normalized === 'sdk' || normalized === 'source:sdk') return 'green';
  if (normalized === 'mirror' || normalized === 'source:mirror') return 'yellow';
  return defaultColor;
}

export function buildCardTitleHeader(
  metadata: StructuredStreamingUiMetadata = {},
  options: { tagElementPrefix?: string } = {},
): Record<string, unknown> | undefined {
  const title = metadata.title?.trim();
  const tags = (metadata.tags || []).map((tag) => tag.trim()).filter(Boolean).slice(0, 3);
  if (!title && tags.length === 0) return undefined;
  const tagElementPrefix = options.tagElementPrefix || 'title_tag';
  const defaultTagColor = metadata.tagColor || 'blue';
  return {
    title: {
      tag: 'plain_text',
      content: title || 'Codex',
    },
    template: metadata.template || 'blue',
    ...(tags.length > 0
      ? {
          text_tag_list: tags.map((tag, index) => ({
            tag: 'text_tag',
            element_id: `${tagElementPrefix}_${index + 1}`,
            text: {
              tag: 'plain_text',
              content: tag,
            },
            color: resolveTitleTagColor(tag, defaultTagColor),
          })),
        }
      : {}),
  };
}

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

const DEFAULT_RICH_CARD_MAX_SECTIONS = 12;
const RICH_CARD_TITLE_LIMIT = 120;
const RICH_CARD_TEXT_LIMIT = 600;
const RICH_CARD_FIELD_LIMIT = 140;
const RICH_CARD_INLINE_FIELD_LIMIT = 3;
const RICH_CARD_SELECT_OPTION_LIMIT = 60;

function normalizeCardLine(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function compactCardText(value: string | null | undefined, maxLength: number): string {
  const normalized = normalizeCardLine(value);
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 1) return '…';
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildRichCardSectionMarkdown(section: OutboundRichCardSection): string {
  const blocks: string[] = [];
  const title = compactCardText(section.title, RICH_CARD_TITLE_LIMIT);
  if (title) blocks.push(`#### ${title}`);
  const text = compactCardText(section.text, RICH_CARD_TEXT_LIMIT);
  if (text) blocks.push(text);

  const tableRows = (section.fields || [])
    .map(([label, value]) => [normalizeCardLine(label), compactCardText(value, RICH_CARD_FIELD_LIMIT)] as const)
    .filter(([, value]) => value);
  if (tableRows.length > 0) {
    blocks.push(tableRows.map(([label, value]) => `**${label}**\n${value}`).join('\n\n'));
  }

  if (section.code?.text.trim()) {
    blocks.push(buildFencedCodeBlock(section.code.text.trim(), section.code.language || 'text'));
  }
  return blocks.join('\n').trim();
}

function buildCardButtonColumn(button: FeishuCardActionButton, chatId?: string): Record<string, unknown> | null {
  if (!button.text || !button.callbackData) return null;
  return {
    tag: 'column',
    width: 'auto',
    elements: [{
      tag: 'button',
      text: { tag: 'plain_text', content: button.text },
      type: button.type || 'default',
      size: 'medium',
      disabled: Boolean(button.disabled),
      value: { callback_data: button.callbackData, ...(chatId ? { chatId } : {}) },
      behaviors: [{
        type: 'callback',
        value: { callback_data: button.callbackData, ...(chatId ? { chatId } : {}) },
      }],
    }],
  };
}

function normalizeSelectElementId(id: string | undefined, index: number): string {
  const normalized = String(id || `command_select_${index + 1}`)
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/^[^A-Za-z]+/, '');
  return (normalized || `command_select_${index + 1}`).slice(0, 20);
}

function buildRichCardSelectElement(
  select: OutboundCardActionSelect,
  index: number,
  chatId?: string,
): Record<string, unknown> | null {
  const seenValues = new Set<string>();
  const options = (select.options || [])
    .map((option) => ({
      text: compactCardText(option.text, RICH_CARD_SELECT_OPTION_LIMIT),
      value: String(option.callbackData || '').trim(),
    }))
    .filter((option) => {
      if (!option.text || !option.value || seenValues.has(option.value)) return false;
      seenValues.add(option.value);
      return true;
    })
    .map((option) => {
      return {
        text: { tag: 'plain_text', content: option.text },
        value: option.value,
      };
    });

  if (options.length === 0) return null;

  return {
    tag: 'select_static',
    element_id: normalizeSelectElementId(select.id, index),
    placeholder: {
      tag: 'plain_text',
      content: compactCardText(select.placeholder || '请选择', RICH_CARD_SELECT_OPTION_LIMIT),
    },
    type: 'default',
    width: 'fill',
    disabled: false,
    behaviors: [{
      type: 'callback',
      value: { select_id: normalizeSelectElementId(select.id, index), ...(chatId ? { chatId } : {}) },
    }],
    options,
  };
}

function buildRichCardSelectElements(
  selects: OutboundCardActionSelect[] = [],
  chatId?: string,
): Array<Record<string, unknown>> {
  return selects
    .map((select, index) => buildRichCardSelectElement(select, index, chatId))
    .filter((element): element is Record<string, unknown> => Boolean(element));
}

function buildRichCardFieldColumn(label: string, value: string): Record<string, unknown> {
  return {
    tag: 'column',
    width: 'weighted',
    weight: 1,
    elements: [{
      tag: 'markdown',
      content: `**${label}**\n${value}`,
      text_align: 'left',
      text_size: 'notation',
    }],
  };
}

function buildRichCardSectionElements(
  section: OutboundRichCardSection,
  chatId?: string,
): Array<Record<string, unknown>> {
  const elements: Array<Record<string, unknown>> = [];
  const title = compactCardText(section.title, RICH_CARD_TITLE_LIMIT);
  const text = compactCardText(section.text, RICH_CARD_TEXT_LIMIT);
  const fields = (section.fields || [])
    .map(([label, value]) => [normalizeCardLine(label), compactCardText(value, RICH_CARD_FIELD_LIMIT)] as const)
    .filter(([label, value]) => label && value);
  const inlineFields = fields.slice(0, RICH_CARD_INLINE_FIELD_LIMIT);
  const foldedFields = fields.slice(inlineFields.length);
  const [firstActionRow = [], ...restActionRows] = section.actions || [];

  const columns: Array<Record<string, unknown>> = [];
  const mainBlocks: string[] = [];
  if (title) mainBlocks.push(`#### ${title}`);
  if (text) mainBlocks.push(text);
  if (foldedFields.length > 0) {
    mainBlocks.push(`已压缩 ${foldedFields.length} 项：${foldedFields.map(([label]) => label).join('、')}`);
  }
  const mainContent = mainBlocks.join('\n').trim();
  if (mainContent) {
    columns.push({
      tag: 'column',
      width: 'weighted',
      weight: 3,
      elements: [{
        tag: 'markdown',
        content: preprocessFeishuMarkdown(mainContent),
        text_align: 'left',
        text_size: 'normal',
      }],
    });
  }
  inlineFields.forEach(([label, value]) => {
    columns.push(buildRichCardFieldColumn(label, value));
  });
  firstActionRow
    .map((button) => buildCardButtonColumn(button, chatId))
    .filter((column): column is Record<string, unknown> => Boolean(column))
    .forEach((column) => columns.push(column));

  if (columns.length > 0) {
    elements.push({
      tag: 'column_set',
      flex_mode: 'stretch',
      horizontal_align: 'left',
      columns,
    });
  }

  if (section.code?.text.trim()) {
    elements.push({
      tag: 'markdown',
      content: preprocessFeishuMarkdown(buildFencedCodeBlock(section.code.text.trim(), section.code.language || 'text')),
      text_align: 'left',
      text_size: 'normal',
    });
  }

  if (columns.length === 0) {
    const fallback = buildRichCardSectionMarkdown(section);
    if (fallback) {
      elements.push({
        tag: 'markdown',
        content: preprocessFeishuMarkdown(fallback),
        text_align: 'left',
        text_size: 'normal',
      });
    }
  }

  const restActions = buildCardActionElements(restActionRows, chatId);
  if (restActions.length > 0) {
    elements.push(...restActions);
  }
  return elements;
}

function clampTablePageSize(value: number | undefined): number {
  if (!Number.isFinite(value || 0)) return 10;
  return Math.min(10, Math.max(1, Math.trunc(value || 10)));
}

function normalizeTableColumnWidth(value: string | undefined): string {
  const width = String(value || 'auto').trim();
  if (!width || width === 'auto') return 'auto';

  const pixelMatch = /^(\d+)px$/.exec(width);
  if (pixelMatch) {
    const pixels = Number(pixelMatch[1]);
    return `${Math.min(600, Math.max(80, pixels))}px`;
  }

  const percentMatch = /^(\d+)%$/.exec(width);
  if (percentMatch) {
    const percent = Number(percentMatch[1]);
    return `${Math.min(100, Math.max(1, percent))}%`;
  }

  return 'auto';
}

function normalizeTableRowHeight(value: OutboundRichCardTable['rowHeight']): string {
  const rowHeight = String(value || 'low').trim();
  if (rowHeight === 'low' || rowHeight === 'middle' || rowHeight === 'high' || rowHeight === 'auto') {
    return rowHeight;
  }
  if (rowHeight === 'medium') return 'middle';

  const pixelMatch = /^(\d+)px$/.exec(rowHeight);
  if (pixelMatch) {
    const pixels = Number(pixelMatch[1]);
    return `${Math.min(124, Math.max(32, pixels))}px`;
  }

  return 'low';
}

function buildRichCardTableElement(table: OutboundRichCardTable): Record<string, unknown> | null {
  const columns = table.columns
    .filter((column) => column.name && column.displayName)
    .map((column) => ({
      name: column.name,
      display_name: column.displayName,
      width: normalizeTableColumnWidth(column.width),
      data_type: column.dataType || 'text',
      vertical_align: column.verticalAlign || 'top',
      horizontal_align: column.horizontalAlign || 'left',
    }));
  if (columns.length === 0 || table.rows.length === 0) return null;

  const allowedColumnNames = new Set(columns.map((column) => String(column.name)));
  const rows = table.rows.map((row) => {
    const normalized: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(row)) {
      if (!allowedColumnNames.has(key) || value === null || value === undefined) continue;
      normalized[key] = typeof value === 'number' ? value : compactCardText(value, 500);
    }
    return normalized;
  });

  return {
    tag: 'table',
    page_size: clampTablePageSize(table.pageSize),
    row_height: normalizeTableRowHeight(table.rowHeight),
    freeze_first_column: Boolean(table.freezeFirstColumn),
    columns,
    rows,
  };
}

export function buildRichCardContent(card: OutboundRichCard, chatId?: string): string {
  const elements: Array<Record<string, unknown>> = [];

  if (card.subtitle?.trim()) {
    elements.push({
      tag: 'markdown',
      content: card.subtitle.trim(),
      text_size: 'notation',
    });
  }

  if (card.table) {
    const tableElement = buildRichCardTableElement(card.table);
    if (tableElement) {
      if (elements.length > 0) elements.push({ tag: 'hr' });
      elements.push(tableElement);
    }
  }

  const selectElements = buildRichCardSelectElements(card.selects || [], chatId);
  if (selectElements.length > 0) {
    if (elements.length > 0) elements.push({ tag: 'hr' });
    elements.push(...selectElements);
  }

  const maxSections = Math.max(0, card.maxSections ?? DEFAULT_RICH_CARD_MAX_SECTIONS);
  const visibleSections = card.sections.slice(0, maxSections);
  const hiddenSectionCount = card.sections.length - visibleSections.length;

  visibleSections.forEach((section) => {
    const sectionElements = buildRichCardSectionElements(section, chatId);
    if (sectionElements.length === 0) return;
    if (elements.length > 0) elements.push({ tag: 'hr' });
    elements.push(...sectionElements);
  });

  const cardActions = buildCardActionElements(card.actions || [], chatId);
  if (cardActions.length > 0) {
    if (elements.length > 0) elements.push({ tag: 'hr' });
    elements.push(...cardActions);
  }

  const footer = [
    ...(hiddenSectionCount > 0
      ? [`已压缩显示前 ${visibleSections.length} 条，折叠 ${hiddenSectionCount} 条；发送纯文本命令可查看完整列表。`]
      : []),
    ...(card.footer || []),
  ].map((line) => line.trim()).filter(Boolean);
  if (footer.length > 0) {
    if (elements.length > 0) elements.push({ tag: 'hr' });
    elements.push({
      tag: 'markdown',
      content: footer.join('\n'),
      text_size: 'notation',
    });
  }
  if (elements.length === 0) {
    elements.push({ tag: 'markdown', content: '无内容', text_size: 'normal' });
  }

  return JSON.stringify({
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: card.title },
      template: card.template || 'blue',
    },
    body: { elements },
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

export function buildCardActionElements(
  actionRows: FeishuCardActionButton[][] = [],
  chatId?: string,
): Array<Record<string, unknown>> {
  const elements: Array<Record<string, unknown>> = [];
  for (const row of actionRows) {
    const columns = row
      .filter((button) => button.text && button.callbackData)
      .map((button) => buildCardButtonColumn(button, chatId))
      .filter((column): column is Record<string, unknown> => Boolean(column));
    if (columns.length === 0) continue;
    elements.push({
      tag: 'column_set',
      flex_mode: 'none',
      horizontal_align: 'left',
      columns,
    });
  }
  return elements;
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
  actionRows: FeishuCardActionButton[][] = [],
  chatId?: string,
  metadata: StructuredStreamingUiMetadata = {},
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

  const actionElements = buildCardActionElements(actionRows, chatId);
  if (actionElements.length > 0) {
    if (elements.length > 0) {
      elements.push({ tag: 'hr' });
    }
    elements.push(...actionElements);
  }

  const header = buildCardTitleHeader(metadata);
  return JSON.stringify({
    schema: '2.0',
    config: { wide_screen_mode: true },
    ...(header ? { header } : {}),
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
      behaviors: [{
        type: 'callback',
        value: { callback_data: `perm:${btn.action}:${permissionRequestId}`, ...(chatId ? { chatId } : {}) },
      }],
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
