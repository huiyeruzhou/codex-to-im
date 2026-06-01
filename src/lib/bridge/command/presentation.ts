import type { BridgeSession } from '../host.js';
import type { OutboundCardActionButton, OutboundRichCard } from '../types.js';
import { buildCommandCallbackData } from '../command-callbacks.js';
import { buildFencedCodeBlock } from '../markdown/fence.js';
import type { CodexSessionSummary } from '../../../codex/session-index.js';
import { MAX_CODEX_THREAD_LIST_LIMIT, parseListIndex } from './aliases.js';
import { formatCreatorBadge, resolveCreatorKind } from '../display/session-creator.js';
import {
  buildThreadActionCallbackData,
  buildThreadCardUpdateKey,
  THREAD_SELECT_CALLBACK_PREFIX,
} from '../command-callbacks.js';
export { formatBindingChatLabel } from '../display/channel-label.js';
export { getSessionDisplayName, stripLegacySessionPrefix } from '../display/session-title.js';
export { toUserVisibleBindingError, toUserVisibleCommandError } from '../command-errors.js';
export {
  THREAD_SELECT_ACTION_CALLBACK_PREFIX,
  THREAD_SELECT_CALLBACK_PREFIX,
  type ThreadCardScope,
} from '../command-callbacks.js';

const BOUND_THREADS_CARD_MAX_ITEMS = 20;
const THREAD_CARD_ACTIONS_PER_ROW = 3;

export interface CodexThreadCardBindingState {
  threadId: string;
  bindingId: string;
  active: boolean;
  title?: string;
}

export interface BoundThreadCardItem {
  title: string;
  cwd: string;
  lastActiveAt?: string;
  threadId: string;
  bridgeSessionId?: string;
  bindingId: string;
  active: boolean;
  originator?: string;
}

export interface ThreadCommandTableRow {
  index: string;
  title: string;
  cwd: string;
  lastActiveAt: string;
  bindingId: string;
  threadId: string;
  creator: string;
  command: string;
  active?: boolean;
  selected?: boolean;
}

type ThreadCommandTableColumnKey = Exclude<keyof ThreadCommandTableRow, 'active' | 'selected'>;

interface ThreadCommandTableColumn {
  key: ThreadCommandTableColumnKey;
  name: string;
  displayName: string;
  width: string;
  dataType?: 'text' | 'lark_md' | 'markdown' | 'number';
  horizontalAlign?: 'left' | 'center' | 'right';
}

const THREAD_COMMAND_TABLE_COLUMNS: ThreadCommandTableColumn[] = [
  { key: 'index', name: 'index', displayName: '#', width: '90px', dataType: 'lark_md', horizontalAlign: 'center' },
  { key: 'title', name: 'title', displayName: '标题', width: '260px', dataType: 'lark_md' },
  { key: 'cwd', name: 'cwd', displayName: '目录', width: '340px', dataType: 'lark_md' },
  { key: 'lastActiveAt', name: 'last_active', displayName: '上一次活动', width: '180px', dataType: 'lark_md' },
  { key: 'bindingId', name: 'binding_id', displayName: 'binding_id', width: '150px', dataType: 'lark_md' },
  { key: 'threadId', name: 'thread_id', displayName: 'thread_id', width: '260px', dataType: 'lark_md' },
  { key: 'creator', name: 'creator', displayName: 'Creator', width: '140px', dataType: 'lark_md' },
  { key: 'command', name: 'command', displayName: '命令', width: '180px', dataType: 'lark_md' },
];

export function resolveByIndexOrPrefix<T>(
  raw: string,
  items: T[],
  getId: (item: T) => string,
): { match: T | null; ambiguous: boolean; index?: number } {
  const token = raw.trim().toLowerCase();
  if (!token) return { match: null, ambiguous: false };

  const index = parseListIndex(token);
  if (index !== null) {
    return { match: items[index - 1] ?? null, ambiguous: false, index };
  }

  const exact = items.find((item) => getId(item).toLowerCase() === token);
  if (exact) return { match: exact, ambiguous: false };

  const prefixMatches = items.filter((item) => getId(item).toLowerCase().startsWith(token));
  if (prefixMatches.length === 1) {
    return { match: prefixMatches[0], ambiguous: false };
  }
  if (prefixMatches.length > 1) {
    return { match: null, ambiguous: true };
  }

  return { match: null, ambiguous: false };
}

export function formatReasoningEffort(reasoning: string): string {
  switch (reasoning) {
    case 'minimal':
      return 'minimal (1)';
    case 'low':
      return 'low (2)';
    case 'medium':
      return 'medium (3)';
    case 'high':
      return 'high (4)';
    case 'xhigh':
      return 'xhigh (5)';
    default:
      return reasoning;
  }
}

export function minimalReasoningWebSearchWarning(reasoning: string): string | null {
  return reasoning === 'minimal'
    ? '`minimal` 思考级别会禁用 web search；需要联网搜索时请切换到 `low` 或更高。'
    : null;
}

export function buildCommandFields(
  title: string,
  fields: Array<[string, string | null | undefined]>,
  notes: string[] = [],
  markdown = false,
): string {
  const normalizedFields = fields.filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '');
  const normalizedNotes = notes.filter((note) => note.trim().length > 0);

  if (markdown) {
    const lines = [`**${title}**`, ''];
    for (const [label, value] of normalizedFields) {
      lines.push(`- **${label}**：${value}`);
    }
    if (normalizedNotes.length > 0) {
      lines.push('', '**说明**');
      for (const note of normalizedNotes) {
        lines.push(`- ${note}`);
      }
    }
    return lines.join('\n').trim();
  }

  return [
    title,
    '',
    ...normalizedFields.map(([label, value]) => `${label}: ${value}`),
    ...(normalizedNotes.length > 0 ? ['', ...normalizedNotes] : []),
  ].join('\n').trim();
}

export function buildIndexedCommandList(
  title: string,
  items: Array<{ heading: string; details: string[] }>,
  footer: string[] = [],
  markdown = false,
): string {
  if (markdown) {
    const lines = [`**${title}**`, ''];
    items.forEach((item, index) => {
      const marker = `${index + 1}.`;
      const childIndent = ' '.repeat(marker.length + 1);
      lines.push(`${marker} **${item.heading}**`);
      item.details.filter(Boolean).forEach((detail) => lines.push(`${childIndent}- ${detail}`));
      lines.push('');
    });
    footer.filter(Boolean).forEach((line) => lines.push(`- ${line}`));
    return lines.join('\n').trim();
  }

  const lines = [title, ''];
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.heading}`);
    item.details.filter(Boolean).forEach((detail) => lines.push(`   ${detail}`));
    lines.push('');
  });
  footer.filter(Boolean).forEach((line) => lines.push(line));
  return lines.join('\n').trim();
}

export function formatCommandPath(cwd: string | undefined | null): string {
  return cwd?.trim() || '~';
}

function formatThreadActivityTime(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return '-';

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;

  return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function normalizeThreadCommandTableCell(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || '-';
}

function threadCommandTableRowValue(row: ThreadCommandTableRow, key: ThreadCommandTableColumnKey): string {
  return normalizeThreadCommandTableCell(row[key]);
}

function formatBoundThreadIndex(index: number, active: boolean): string {
  return active ? `* ${index} 当前` : `* ${index}`;
}

const ACTIVE_THREAD_CARD_NUMBER_COLOR = 'green-350';
const INACTIVE_THREAD_CARD_COLOR = 'grey-500';
const SELECTED_THREAD_CARD_NUMBER_COLOR = 'grey-500';

function formatThreadCardNumberTag(index: string, kind: 'selected' | 'active'): string {
  const backgroundColor = kind === 'active' ? ACTIVE_THREAD_CARD_NUMBER_COLOR : SELECTED_THREAD_CARD_NUMBER_COLOR;
  return `<number_tag background_color='${backgroundColor}' font_color='white'>${index}</number_tag>`;
}

function formatInactiveThreadCardCell(value: string): string {
  return `<font color='${INACTIVE_THREAD_CARD_COLOR}'>${value}</font>`;
}

function formatActiveThreadCardCellValue(value: string): string {
  return `**${value}**`;
}

function formatActiveThreadCardCell(row: ThreadCommandTableRow, key: ThreadCommandTableColumnKey): string {
  const value = threadCommandTableRowValue(row, key);
  if (key === 'index') {
    const index = value.match(/\d+/)?.[0] || value.trim() || '-';
    return formatThreadCardNumberTag(index, 'active');
  }
  return value;
}

function formatSelectedThreadCardCell(row: ThreadCommandTableRow, key: ThreadCommandTableColumnKey): string {
  const value = threadCommandTableRowValue(row, key);
  if (key === 'index') {
    const index = value.match(/\d+/)?.[0] || value.trim() || '-';
    return formatThreadCardNumberTag(index, 'selected');
  }
  return value;
}

function buildThreadCommandTableCardRows(rows: ThreadCommandTableRow[]): Array<Record<string, string>> {
  return rows.map((row) => Object.fromEntries(THREAD_COMMAND_TABLE_COLUMNS.map((column) => [
    column.name,
    row.active
      ? formatActiveThreadCardCellValue(formatActiveThreadCardCell(row, column.key))
      : row.selected
        ? formatSelectedThreadCardCell(row, column.key)
        : formatInactiveThreadCardCell(threadCommandTableRowValue(row, column.key)),
  ])));
}

export function buildThreadCommandTableText(rows: ThreadCommandTableRow[]): string {
  const tableRows = [
    THREAD_COMMAND_TABLE_COLUMNS.map((column) => column.displayName),
    ...rows.map((row) => THREAD_COMMAND_TABLE_COLUMNS.map((column) => threadCommandTableRowValue(row, column.key))),
  ];
  const widths = THREAD_COMMAND_TABLE_COLUMNS.map((_, columnIndex) => (
    Math.max(...tableRows.map((row) => row[columnIndex].length))
  ));
  return tableRows
    .map((row) => row.map((cell, columnIndex) => cell.padEnd(widths[columnIndex])).join('  '))
    .join('\n');
}

function buildThreadCommandTableResponse(
  title: string,
  rows: ThreadCommandTableRow[],
  footer: string[],
  markdown: boolean,
): string {
  const table = buildThreadCommandTableText(rows);
  if (markdown) {
    return [
      `**${title}**`,
      '',
      buildFencedCodeBlock(table, 'text'),
      ...(footer.length > 0 ? ['', ...footer.map((line) => `- ${line}`)] : []),
    ].join('\n').trim();
  }

  return [
    title,
    '',
    table,
    ...(footer.length > 0 ? ['', ...footer] : []),
  ].join('\n').trim();
}

export function buildCodexThreadCommandTableRows(
  codexSessions: CodexSessionSummary[],
  bindingStates: CodexThreadCardBindingState[] = [],
  options: { startIndex?: number; globalCommandIndex?: boolean } = {},
): ThreadCommandTableRow[] {
  const bindingByThreadId = new Map(bindingStates.map((state) => [state.threadId, state]));
  const startIndex = options.startIndex ?? 1;
  return codexSessions.map((session, index) => {
    const binding = bindingByThreadId.get(session.threadId);
    const displayIndex = startIndex + index;
    return {
      index: binding?.active
        ? formatBoundThreadIndex(displayIndex, true)
        : binding
          ? formatBoundThreadIndex(displayIndex, false)
          : `${displayIndex}`,
      title: binding?.title || session.title || '未命名线程',
      cwd: formatCommandPath(session.cwd),
      lastActiveAt: formatThreadActivityTime(session.lastEventAt),
      bindingId: binding ? binding.bindingId.slice(0, 8) : '-',
      threadId: session.threadId || '-',
      creator: formatCreatorBadge(resolveCreatorKind({
        source: session.source,
        originator: session.originator,
      })).label,
      command: options.globalCommandIndex ? `/t ${displayIndex}` : binding ? `/t use ${binding.bindingId.slice(0, 8)}` : `/t ${displayIndex}`,
      active: binding?.active || false,
      selected: Boolean(binding),
    };
  });
}

export function buildBoundThreadCommandTableRows(
  bindings: BoundThreadCardItem[],
  options: { startIndex?: number; globalCommandIndex?: boolean } = {},
): ThreadCommandTableRow[] {
  const startIndex = options.startIndex ?? 1;
  return bindings.map((binding, index) => {
    const displayIndex = startIndex + index;
    const commandTarget = binding.bindingId || binding.threadId || binding.bridgeSessionId || `${displayIndex}`;
    return {
      index: formatBoundThreadIndex(displayIndex, binding.active),
      title: binding.title || '未命名线程',
      cwd: formatCommandPath(binding.cwd),
      lastActiveAt: formatThreadActivityTime(binding.lastActiveAt),
      bindingId: binding.bindingId ? binding.bindingId.slice(0, 8) : '-',
      threadId: binding.threadId || '-',
      creator: binding.originator || '当前聊天',
      command: options.globalCommandIndex ? `/t ${displayIndex}` : `/t use ${commandTarget.slice(0, 8)}`,
      active: binding.active,
      selected: true,
    };
  });
}

function buildThreadCommandCardTable(rows: ThreadCommandTableRow[]) {
  return {
    pageSize: 10,
    rowHeight: 'low' as const,
    freezeFirstColumn: false,
    columns: THREAD_COMMAND_TABLE_COLUMNS.map((column) => ({
      name: column.name,
      displayName: column.displayName,
      width: column.width,
      ...(column.dataType ? { dataType: column.dataType } : {}),
      ...(column.horizontalAlign ? { horizontalAlign: column.horizontalAlign } : {}),
    })),
    rows: buildThreadCommandTableCardRows(rows),
  };
}

function buildThreadCardActionRows(buttons: OutboundCardActionButton[]): OutboundCardActionButton[][] {
  const rows: OutboundCardActionButton[][] = [];
  for (let index = 0; index < buttons.length; index += THREAD_CARD_ACTIONS_PER_ROW) {
    rows.push(buttons.slice(index, index + THREAD_CARD_ACTIONS_PER_ROW));
  }
  return rows;
}

export function buildBoundThreadsCommandResponse(
  bindings: BoundThreadCardItem[],
  markdown: boolean,
): string {
  return buildThreadCommandTableResponse(
    '当前聊天绑定',
    buildBoundThreadCommandTableRows(bindings),
    [
      '`/t use <序号|binding-id|thread-id|名称>` 切换当前线程；`/t detach <序号|binding-id|thread-id|名称>` 移除绑定；`/t rename <名称>` 重命名当前线程。',
      '`/t use` 和 `/t detach` 的序号来自 `/t ls` 的局部绑定表；`/t` 和 `/t attach` 的序号来自全局本地 Codex 会话表。',
    ],
    markdown,
  );
}

function hasReachedCodexThreadDisplayLimit(actualCount: number, limit: number | undefined): boolean {
  return limit === MAX_CODEX_THREAD_LIST_LIMIT && actualCount >= MAX_CODEX_THREAD_LIST_LIMIT;
}

export function buildCodexThreadLimitNotice(actualCount: number, limit: number | undefined): string | null {
  if (!hasReachedCodexThreadDisplayLimit(actualCount, limit)) return null;
  return `已达到 ${MAX_CODEX_THREAD_LIST_LIMIT} 条显示上限，可能还有更多本地 Codex 会话未显示；可用 \`/t n 100\` 或名称/thread id 缩小范围。`;
}

export function buildCodexThreadsCommandResponse(
  codexSessions: CodexSessionSummary[],
  markdown: boolean,
  showAll: boolean,
  limit?: number,
  bindingStates: CodexThreadCardBindingState[] = [],
  bridgeBindings: BoundThreadCardItem[] = [],
  extraFooter: string[] = [],
): string {
  const actualCount = codexSessions.length;
  const title = `Codex会话（本地会话${actualCount} + 未绑定的Bridge${bridgeBindings.length}）`;
  const limitNotice = buildCodexThreadLimitNotice(actualCount, limit);
  return buildThreadCommandTableResponse(
    title,
    [
      ...buildBoundThreadCommandTableRows(bridgeBindings, { startIndex: 1, globalCommandIndex: true }),
      ...buildCodexThreadCommandTableRows(codexSessions, bindingStates, { startIndex: bridgeBindings.length + 1, globalCommandIndex: true }),
    ],
    [
      ...(limitNotice ? [limitNotice] : []),
      ...extraFooter,
      ...(showAll
      ? [
          bridgeBindings.length
            ? '按序号操作 Bridge / Codex 会话；也可用 thread_id、binding_id 或名称。'
            : '发送 `/t 1` 可接管第 1 条本地 Codex 会话。',
          `卡片默认显示最多 ${MAX_CODEX_THREAD_LIST_LIMIT} 条本地 Codex 会话；文本 fallback 默认显示 10 条。`,
          `发送 \`/t n 100\` 可只看最近 100 条本地 Codex 会话（最多 ${MAX_CODEX_THREAD_LIST_LIMIT} 条）。`,
        ]
      : [
          bridgeBindings.length
            ? '按序号操作 Bridge / Codex 会话；也可用 thread_id、binding_id 或名称。'
            : '发送 `/t 1` 可接管第 1 条本地 Codex 会话。',
          `发送 \`/t\` 或 \`/t all\` 可查看最多 ${MAX_CODEX_THREAD_LIST_LIMIT} 条本地 Codex 会话。`,
        ]),
    ],
    markdown,
  );
}

export function buildCodexThreadsCommandCard(
  codexSessions: CodexSessionSummary[],
  showAll: boolean,
  limit?: number,
  bindingStates: CodexThreadCardBindingState[] = [],
  bridgeBindings: BoundThreadCardItem[] = [],
  options: {
    channelType?: string;
    chatId?: string;
    selectedThreadId?: string | null;
  } = {},
): OutboundRichCard | null {
  const actualCount = codexSessions.length;
  const title = `Codex会话（本地会话${actualCount} + 未绑定的Bridge${bridgeBindings.length}）`;
  const limitNotice = buildCodexThreadLimitNotice(actualCount, limit);
  const selectedCallbackData = options.selectedThreadId
    ? `${THREAD_SELECT_CALLBACK_PREFIX}${encodeURIComponent(options.selectedThreadId)}`
    : undefined;
  const tableRows = [
    ...buildBoundThreadCommandTableRows(bridgeBindings, { startIndex: 1, globalCommandIndex: true }),
    ...buildCodexThreadCommandTableRows(codexSessions, bindingStates, { startIndex: bridgeBindings.length + 1, globalCommandIndex: true }),
  ];
  const card: OutboundRichCard = {
    title,
    subtitle: bridgeBindings.length
      ? '按序号选择 Bridge / Codex 会话；也可用 thread_id、binding_id 或名称。'
      : '`binding_id` 非 `-` 表示已绑定。点击按钮会执行对应命令，也可以继续发送纯文本命令。',
    template: 'blue',
    table: buildThreadCommandCardTable(tableRows),
    sections: [],
    selects: [{
      id: 'codex_select',
      placeholder: bridgeBindings.length ? '选择 Bridge / Codex 会话' : '选择本地 Codex 会话',
      selectedCallbackData,
      options: [
        ...bridgeBindings.map((binding, index) => ({
          text: `${index + 1}. ${binding.title || binding.cwd || '未命名线程'}`,
          callbackData: `${THREAD_SELECT_CALLBACK_PREFIX}${encodeURIComponent(binding.bridgeSessionId || binding.bindingId)}`,
        })),
        ...codexSessions.map((session, index) => ({
          text: `${bridgeBindings.length + index + 1}. ${session.title || session.cwd || '未命名线程'}`,
          callbackData: `${THREAD_SELECT_CALLBACK_PREFIX}${encodeURIComponent(session.threadId)}`,
        })),
      ],
    }],
    actions: buildThreadCardActionRows([
      {
        text: '绑定',
        callbackData: buildThreadActionCallbackData('global', 'attach'),
        type: 'primary',
      },
      {
        text: '解绑',
        callbackData: buildThreadActionCallbackData('global', 'detach'),
        type: 'danger',
      },
      {
        text: '归档',
        callbackData: buildThreadActionCallbackData('global', 'archive'),
        type: 'danger',
      },
      {
        text: '激活',
        callbackData: buildThreadActionCallbackData('global', 'use'),
        type: 'default',
      },
      {
        text: '新建',
        callbackData: buildCommandCallbackData('/new'),
        type: 'primary',
      },
      {
        text: '刷新',
        callbackData: buildCommandCallbackData(showAll ? '/t all' : '/t'),
        type: 'default',
      },
    ]),
    footer: showAll
      ? [
          ...(limitNotice ? [limitNotice] : []),
          bridgeBindings.length
            ? '纯文本命令：用 `/t 1`、`/t attach 1`、`/t archive 1` 操作这张全局表里的对应序号。'
            : '纯文本命令：`/t 1` 接管第 1 条，`/t attach 1` 绑定但不激活，`/t archive 1` 归档第 1 条。',
          '`/t`、`/t attach` 和 `/t archive` 的序号来自这张全局 Bridge / Codex 会话表；`/t use` 和 `/t detach` 的序号来自 `/t ls` 的局部绑定表。',
        ]
      : [
          ...(limitNotice ? [limitNotice] : []),
          bridgeBindings.length
            ? '纯文本命令：用 `/t 1`、`/t attach 1`、`/t archive 1` 操作这张全局表里的对应序号。'
            : '纯文本命令：`/t 1` 接管第 1 条，`/t attach 1` 绑定但不激活。',
          '`/t`、`/t attach` 和 `/t archive` 的序号来自这张全局 Bridge / Codex 会话表；`/t use` 和 `/t detach` 的序号来自 `/t ls` 的局部绑定表。',
          `更多：\`/t\` 或 \`/t all\` 最多 ${MAX_CODEX_THREAD_LIST_LIMIT} 条。`,
        ],
  };
  if (options.channelType && options.chatId) {
    card.updateKey = buildThreadCardUpdateKey('global', options.channelType, options.chatId);
    card.updateTtlMs = null;
  }
  return card;
}

export function buildBoundThreadsCommandCard(
  bindings: BoundThreadCardItem[],
  options: {
    channelType?: string;
    chatId?: string;
    selectedBindingId?: string | null;
  } = {},
): OutboundRichCard | null {
  if (bindings.length > BOUND_THREADS_CARD_MAX_ITEMS) return null;
  const selectedCallbackData = options.selectedBindingId
    ? `${THREAD_SELECT_CALLBACK_PREFIX}${encodeURIComponent(options.selectedBindingId)}`
    : undefined;
  const card: OutboundRichCard = {
    title: `当前聊天绑定（${bindings.length}）`,
    subtitle: '这张表只显示当前聊天已绑定线程；命令列里的序号只用于 `/t use` 和 `/t detach`。',
    template: 'blue',
    table: buildThreadCommandCardTable(buildBoundThreadCommandTableRows(bindings)),
    sections: [],
    ...(bindings.length > 0
      ? {
          selects: [{
            id: 'bound_select',
            placeholder: '选择绑定线程',
            selectedCallbackData,
            options: bindings.map((binding, index) => ({
              text: `${index + 1}. ${binding.title || binding.cwd || '未命名线程'}`,
              callbackData: `${THREAD_SELECT_CALLBACK_PREFIX}${encodeURIComponent(binding.bridgeSessionId || binding.bindingId)}`,
            })),
          }],
        }
      : {}),
    actions: buildThreadCardActionRows(bindings.length > 0
      ? [
          {
            text: '解绑',
            callbackData: buildThreadActionCallbackData('bound', 'detach'),
            type: 'danger',
          },
          {
            text: '归档',
            callbackData: buildThreadActionCallbackData('bound', 'archive'),
            type: 'danger',
          },
          {
            text: '激活',
            callbackData: buildThreadActionCallbackData('bound', 'use'),
            type: 'primary',
          },
          {
            text: '刷新',
            callbackData: buildCommandCallbackData('/t ls'),
            type: 'default',
          },
        ]
      : [
          {
            text: '新建',
            callbackData: buildCommandCallbackData('/new'),
            type: 'primary',
          },
          {
            text: '刷新',
            callbackData: buildCommandCallbackData('/t ls'),
            type: 'default',
          },
        ]),
    footer: [
      '纯文本命令：`/t use 1` 激活第 1 个绑定线程，`/t detach 1` 移除第 1 个绑定线程。',
      '`/t use` 和 `/t detach` 的序号来自这张局部绑定表；`/t` 和 `/t attach` 的序号来自全局本地 Codex 会话表。',
    ],
  };
  if (options.channelType && options.chatId) {
    card.updateKey = buildThreadCardUpdateKey('bound', options.channelType, options.chatId);
    card.updateTtlMs = null;
  }
  return card;
}

export function formatCommandMessageId(id: string | undefined | null): string {
  if (!id) return '未共享';
  return id;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatCommandDateTime(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return '-';

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return trimmed;

  return [
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`,
  ].join(' ');
}

function stripStoredAttachmentMarker(content: string): string {
  return content.replace(/\n?<!--files:[\s\S]*?-->$/u, '').trim();
}

export function formatStoredMessageContent(content: string): string {
  const stripped = stripStoredAttachmentMarker(content);
  if (!stripped) return '[empty]';

  try {
    const parsed = JSON.parse(stripped);
    if (!Array.isArray(parsed)) return stripped;

    const lines: string[] = [];
    for (const block of parsed) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        lines.push(block.text.trim());
        continue;
      }
      if (block.type === 'tool_use' && typeof block.name === 'string') {
        lines.push(`[tool] ${block.name}`);
        continue;
      }
      if (block.type === 'tool_result') {
        const suffix = block.is_error === true ? ' error' : '';
        if (typeof block.content === 'string' && block.content.trim()) {
          lines.push(`[tool_result${suffix}] ${block.content.trim()}`);
        } else {
          lines.push(`[tool_result${suffix}]`);
        }
      }
    }
    return lines.length > 0 ? lines.join('\n') : stripped;
  } catch {
    return stripped;
  }
}

export function truncateHistoryContent(content: string, maxChars = 800): string {
  const trimmed = content.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars)}...`;
}

export function formatHistoryRole(role: string): string {
  if (role === 'user') return 'User';
  if (role === 'assistant') return 'Codex';
  return role || 'unknown';
}

export function formatRuntimeStatus(session: BridgeSession | null | undefined): string {
  const status = session?.runtime_status || 'idle';
  const queuedCount = session?.queued_count && session.queued_count > 0
    ? session.queued_count
    : 0;

  if (status === 'queued') {
    return queuedCount > 0 ? `排队中（${queuedCount}）` : '排队中';
  }
  if (status === 'running') {
    return '运行中';
  }
  return '空闲';
}

export function formatMirrorStatus(session: BridgeSession | null | undefined): string {
  if (session?.mirror_status === 'watching') {
    return session.mirror_last_event_at
      ? `监听中 · 最近同步 ${formatCommandDateTime(session.mirror_last_event_at)}`
      : '监听中';
  }
  if (session?.mirror_status === 'stale') {
    return '待恢复（暂时没定位到本地 Codex thread 文件）';
  }
  return '未监听';
}
