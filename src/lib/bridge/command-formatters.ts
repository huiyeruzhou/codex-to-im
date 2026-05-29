import path from 'node:path';

import type { BridgeSession } from './host.js';
import type { ChannelBinding, OutboundRichCard } from './types.js';
import { buildCommandCallbackData } from './command-callbacks.js';
import type { DesktopSessionSummary } from '../../desktop-sessions.js';
import {
  DEFAULT_DESKTOP_THREAD_LIST_LIMIT,
  MAX_DESKTOP_THREAD_LIST_LIMIT,
  parseListIndex,
} from './command-aliases.js';

const DESKTOP_THREADS_CARD_MAX_ITEMS = 20;
export const THREAD_SELECT_CALLBACK_PREFIX = 'cti-thread-select:';
export const THREAD_SELECT_ACTION_CALLBACK_PREFIX = 'cti-thread-action:';

export interface DesktopThreadCardBindingState {
  threadId: string;
  bindingId: string;
  active: boolean;
  title?: string;
}

export interface BoundThreadCardItem {
  title: string;
  cwd: string;
  threadId: string;
  bindingId: string;
  active: boolean;
  originator?: string;
}

export type ThreadCardScope = 'global' | 'bound';

function buildThreadCardUpdateKey(scope: ThreadCardScope, channelType: string, chatId: string): string {
  return `thread-card:${scope}:${channelType}:${chatId}`;
}

function buildThreadActionCallbackData(scope: ThreadCardScope, action: 'bind' | 'rm' | 'use'): string {
  return `${THREAD_SELECT_ACTION_CALLBACK_PREFIX}${scope}:${action}`;
}

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

export function getSessionDisplayName(session: BridgeSession | null | undefined, fallbackDirectory?: string): string {
  if (session?.name?.trim()) return stripDesktopSessionPrefix(session.name);
  const cwd = session?.working_directory || fallbackDirectory || '';
  if (cwd) return path.basename(cwd) || cwd;
  if (session?.id) return session.id.slice(0, 8);
  return '未命名会话';
}

export function stripDesktopSessionPrefix(value: string): string {
  const trimmed = value.trim();
  return trimmed.replace(/^Desktop:\s*/i, '').trim() || trimmed;
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

export function buildDesktopThreadsCommandResponse(
  desktopSessions: DesktopSessionSummary[],
  markdown: boolean,
  showAll: boolean,
  _limit = DEFAULT_DESKTOP_THREAD_LIST_LIMIT,
): string {
  const actualCount = desktopSessions.length;
  const title = showAll
    ? `桌面会话（当前显示 ${actualCount} 条，最多 ${MAX_DESKTOP_THREAD_LIST_LIMIT} 条）`
    : `最近 ${actualCount} 条桌面会话`;
  return buildIndexedCommandList(
    title,
    desktopSessions.map((session) => ({
      heading: session.title || '未命名线程',
      details: [
        `目录：${formatCommandPath(session.cwd)}`,
        `来源：${session.originator || 'Codex Desktop'}`,
      ],
    })),
    showAll
      ? [
          '发送 `/t 1` 可接管第 1 条桌面会话。',
          `发送 \`/t\` 可只看最近 ${DEFAULT_DESKTOP_THREAD_LIST_LIMIT} 条。`,
        ]
      : [
          '发送 `/t 1` 可接管第 1 条桌面会话。',
          `发送 \`/t all\` 可查看最多 ${MAX_DESKTOP_THREAD_LIST_LIMIT} 条桌面会话。`,
          `发送 \`/t n 100\` 可查看最近 100 条桌面会话（最多 ${MAX_DESKTOP_THREAD_LIST_LIMIT} 条）。`,
        ],
    markdown,
  );
}

export function buildDesktopThreadsCommandCard(
  desktopSessions: DesktopSessionSummary[],
  showAll: boolean,
  _limit = DEFAULT_DESKTOP_THREAD_LIST_LIMIT,
  bindingStates: DesktopThreadCardBindingState[] = [],
  options: {
    channelType?: string;
    chatId?: string;
  } = {},
): OutboundRichCard | null {
  if (desktopSessions.length > DESKTOP_THREADS_CARD_MAX_ITEMS) return null;
  const actualCount = desktopSessions.length;
  const title = showAll
    ? `桌面会话（${actualCount}/${MAX_DESKTOP_THREAD_LIST_LIMIT}）`
    : `最近 ${actualCount} 条桌面会话`;
  const bindingByThreadId = new Map(bindingStates.map((state) => [state.threadId, state]));
  const card: OutboundRichCard = {
    title,
    subtitle: '第一列 `*` 表示已绑定；当前激活线程显示为 `* **序号**`。点击按钮会执行对应命令，也可以继续发送纯文本命令。',
    template: 'blue',
    table: {
      pageSize: 10,
      rowHeight: 'low',
      freezeFirstColumn: true,
      columns: [
        { name: 'index', displayName: '#', width: '90px', horizontalAlign: 'center', dataType: 'lark_md' },
        { name: 'title', displayName: '标题', width: '260px' },
        { name: 'cwd', displayName: '目录', width: '340px' },
        { name: 'binding', displayName: 'binding', width: '120px' },
        { name: 'originator', displayName: '来源', width: '140px' },
        { name: 'command', displayName: '命令', width: '180px' },
      ],
      rows: desktopSessions.map((session, index) => {
        const binding = bindingByThreadId.get(session.threadId);
        const marker = binding?.active
          ? `* **${index + 1}**`
          : binding
            ? `* ${index + 1}`
            : `${index + 1}`;
        return {
          index: marker,
          title: binding?.title || session.title || '未命名线程',
          cwd: formatCommandPath(session.cwd),
          binding: binding ? binding.bindingId.slice(0, 8) : '-',
          originator: session.originator || 'Codex Desktop',
          command: binding ? `/t use ${binding.bindingId.slice(0, 8)}` : `/t ${index + 1}`,
        };
      }),
    },
    sections: [],
    selects: [{
      id: 'desktop_select',
      placeholder: '选择桌面会话',
      options: desktopSessions.map((session, index) => ({
        text: `${index + 1}. ${session.title || session.cwd || '未命名线程'}`,
        callbackData: `${THREAD_SELECT_CALLBACK_PREFIX}${encodeURIComponent(session.threadId)}`,
      })),
    }],
    actions: [
      [
        {
          text: '绑定',
          callbackData: buildThreadActionCallbackData('global', 'bind'),
          type: 'primary',
        },
        {
          text: '解绑',
          callbackData: buildThreadActionCallbackData('global', 'rm'),
          type: 'danger',
        },
        {
          text: '激活',
          callbackData: buildThreadActionCallbackData('global', 'use'),
          type: 'default',
        },
      ],
      [{
        text: '刷新',
        callbackData: buildCommandCallbackData(showAll ? '/t all' : '/t'),
        type: 'default',
      }],
    ],
    footer: showAll
      ? [
          '纯文本命令：`/t 1` 接管第 1 条，`/t add 1` 添加但不激活，`/t` 返回最近列表。',
          '`/t` 和 `/t add` 的序号来自这张全局桌面会话表；`/t use` 和 `/t rm` 的序号来自 `/t ls` 的局部绑定表。',
          `超过 ${DESKTOP_THREADS_CARD_MAX_ITEMS} 条时只发送文本列表，避免卡片过长。`,
        ]
      : [
          '纯文本命令：`/t 1` 接管第 1 条，`/t add 1` 添加但不激活。',
          '`/t` 和 `/t add` 的序号来自这张全局桌面会话表；`/t use` 和 `/t rm` 的序号来自 `/t ls` 的局部绑定表。',
          `更多：\`/t all\` 最多 ${MAX_DESKTOP_THREAD_LIST_LIMIT} 条，\`/t n 100\` 查看最近 100 条。`,
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
  } = {},
): OutboundRichCard | null {
  if (bindings.length === 0 || bindings.length > DESKTOP_THREADS_CARD_MAX_ITEMS) return null;
  const card: OutboundRichCard = {
    title: `当前聊天绑定（${bindings.length}）`,
    subtitle: '第一列 `*` 表示已绑定；当前激活线程显示为 `* **序号**`。这张表的序号只用于 `/t use` 和 `/t rm`。',
    template: 'blue',
    table: {
      pageSize: 10,
      rowHeight: 'low',
      freezeFirstColumn: true,
      columns: [
        { name: 'index', displayName: '#', width: '90px', horizontalAlign: 'center', dataType: 'lark_md' },
        { name: 'title', displayName: '标题', width: '260px' },
        { name: 'cwd', displayName: '目录', width: '340px' },
        { name: 'binding', displayName: 'binding', width: '120px' },
        { name: 'originator', displayName: '来源', width: '140px' },
        { name: 'command', displayName: '命令', width: '180px' },
      ],
      rows: bindings.map((binding, index) => ({
        index: binding.active ? `* **${index + 1}**` : `* ${index + 1}`,
        title: binding.title || '未命名线程',
        cwd: formatCommandPath(binding.cwd),
        binding: binding.bindingId.slice(0, 8),
        originator: binding.originator || '当前聊天',
        command: binding.active ? `/t use ${index + 1}` : `/t use ${index + 1}`,
      })),
    },
    sections: [],
    selects: [{
      id: 'bound_select',
      placeholder: '选择绑定线程',
      options: bindings.map((binding, index) => ({
        text: `${index + 1}. ${binding.title || binding.cwd || '未命名线程'}`,
        callbackData: `${THREAD_SELECT_CALLBACK_PREFIX}${encodeURIComponent(binding.bindingId)}`,
      })),
    }],
    actions: [
      [
        {
          text: '解绑',
          callbackData: buildThreadActionCallbackData('bound', 'rm'),
          type: 'danger',
        },
        {
          text: '激活',
          callbackData: buildThreadActionCallbackData('bound', 'use'),
          type: 'primary',
        },
      ],
      [{
        text: '刷新',
        callbackData: buildCommandCallbackData('/t ls'),
        type: 'default',
      }],
    ],
    footer: [
      '纯文本命令：`/t use 1` 激活第 1 个绑定线程，`/t rm 1` 移除第 1 个绑定线程。',
      '`/t use` 和 `/t rm` 的序号来自这张局部绑定表；`/t` 和 `/t add` 的序号来自全局桌面会话表。',
    ],
  };
  if (options.channelType && options.chatId) {
    card.updateKey = buildThreadCardUpdateKey('bound', options.channelType, options.chatId);
    card.updateTtlMs = null;
  }
  return card;
}

export function toUserVisibleBindingError(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message?.trim();
    if (message) return message;
  }
  return fallback;
}

export function formatBindingChatLabel(
  binding: Pick<ChannelBinding, 'channelType' | 'channelProvider' | 'channelAlias' | 'chatId' | 'chatDisplayName'>,
  resolvedAlias?: string,
): string {
  const channelLabel = binding.channelAlias
    || resolvedAlias
    || (binding.channelProvider === 'feishu'
      ? '飞书'
      : binding.channelProvider === 'weixin'
        ? '微信'
        : binding.channelType);
  const chatLabel = binding.chatDisplayName?.trim() || binding.chatId;
  return `${channelLabel} 聊天 ${chatLabel}`;
}

export function toUserVisibleCommandError(command: string, error: unknown): string {
  if (error instanceof Error) {
    const message = error.message?.trim();
    if (message && /一个会话只能绑定一个聊天|已绑定到/.test(message)) {
      return message;
    }
  }

  if (command === '/history') {
    return '读取历史记录失败，请稍后重试。';
  }
  if (command === '/new') {
    return '新建会话失败。请检查目录是否可写，或改用 /new 绝对路径。';
  }
  return `${command} 执行失败，请稍后重试。`;
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
    return '待恢复（暂时没定位到桌面 thread 文件）';
  }
  return '未监听';
}
