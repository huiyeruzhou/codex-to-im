import type { BridgeSession } from '../host.js';
import type { OutboundRichCard } from '../types.js';
import type { AutoTask } from '../auto-tasks.js';
import { buildCommandCallbackData } from '../command-callbacks.js';
import {
  AUTO_TASK_SELECT_CALLBACK_PREFIX,
  buildAutoTaskActionCallbackData,
  buildThreadCardUpdateKey,
} from '../command-callbacks.js';
import { buildFencedCodeBlock } from '../markdown/fence.js';
import {
  formatCommandDateTime,
  formatCommandPath,
  getSessionDisplayName,
} from './presentation.js';

const AUTO_TASK_CARD_MAX_ITEMS = 20;

interface AutoTaskCommandRow {
  index: string;
  sessionTitle: string;
  scriptPath: string;
  createdAt: string;
  triggeredCount: string;
  lastTriggeredAt: string;
  times: string;
  codexThreadId: string;
  command: string;
}

type AutoTaskCommandColumnKey = keyof AutoTaskCommandRow;

interface AutoTaskCommandColumn {
  key: AutoTaskCommandColumnKey;
  name: string;
  displayName: string;
  width: string;
  dataType?: 'text' | 'lark_md' | 'markdown' | 'number';
  horizontalAlign?: 'left' | 'center' | 'right';
}

const AUTO_TASK_COLUMNS: AutoTaskCommandColumn[] = [
  { key: 'index', name: 'index', displayName: '#', width: '80px', dataType: 'lark_md', horizontalAlign: 'center' },
  { key: 'sessionTitle', name: 'session_title', displayName: 'Session', width: '220px', dataType: 'lark_md' },
  { key: 'scriptPath', name: 'script_path', displayName: '脚本路径', width: '360px', dataType: 'lark_md' },
  { key: 'createdAt', name: 'created_at', displayName: '创建时间', width: '180px', dataType: 'lark_md' },
  { key: 'triggeredCount', name: 'triggered_count', displayName: '已触发', width: '100px', dataType: 'lark_md', horizontalAlign: 'center' },
  { key: 'lastTriggeredAt', name: 'last_triggered_at', displayName: '上一次触发', width: '180px', dataType: 'lark_md' },
  { key: 'times', name: 'times', displayName: '总次数', width: '100px', dataType: 'lark_md', horizontalAlign: 'center' },
  { key: 'codexThreadId', name: 'codex_id', displayName: 'session codex-id', width: '260px', dataType: 'lark_md' },
  { key: 'command', name: 'command', displayName: '命令', width: '160px', dataType: 'lark_md' },
];

export function buildAutoTaskCommandRows(
  tasks: AutoTask[],
  sessionsById: Map<string, BridgeSession>,
): AutoTaskCommandRow[] {
  return tasks.map((task, index) => ({
    index: `${index + 1}`,
    sessionTitle: formatTaskSessionTitle(task, sessionsById.get(task.bridgeSessionId)),
    scriptPath: formatCommandPath(task.scriptPath),
    createdAt: formatCommandDateTime(task.createdAt),
    triggeredCount: `${task.triggeredCount}`,
    lastTriggeredAt: formatCommandDateTime(task.lastTriggeredAt),
    times: `${task.times}`,
    codexThreadId: sessionsById.get(task.bridgeSessionId)?.codex_thread_id || '-',
    command: `/auto rm ${index + 1}`,
  }));
}

export function buildAutoTasksCommandResponse(
  tasks: AutoTask[],
  sessionsById: Map<string, BridgeSession>,
  markdown: boolean,
): string {
  if (tasks.length === 0) {
    return '当前聊天没有自动化任务。';
  }

  const title = `当前聊天自动化任务（${tasks.length}）`;
  const rows = buildAutoTaskCommandRows(tasks, sessionsById);
  const table = buildAutoTaskCommandTableText(rows);
  const footer = [
    '`/auto new <scriptpath> <times>` 为当前 bridge session 创建自动化任务。',
    '`/auto rm <序号>` 删除自动化任务；序号来自当前列表。',
    '`/auto set <序号> <times>` 重置已触发次数并设置新的总次数；`0` 表示暂停。',
    '`/auto skill install` 安装自动脚本创建 skill，`/auto skill uninstall` 删除该 skill。',
  ];

  if (markdown) {
    return [
      `**${title}**`,
      '',
      buildFencedCodeBlock(table, 'text'),
      '',
      ...footer.map((line) => `- ${line}`),
    ].join('\n').trim();
  }

  return [title, '', table, '', ...footer].join('\n').trim();
}

export function buildAutoTasksCommandCard(
  tasks: AutoTask[],
  sessionsById: Map<string, BridgeSession>,
  options: {
    selectedTaskId?: string | null;
    channelType?: string;
    chatId?: string;
  } = {},
): OutboundRichCard | null {
  if (tasks.length > AUTO_TASK_CARD_MAX_ITEMS) return null;
  const selectedCallbackData = options.selectedTaskId
    ? `${AUTO_TASK_SELECT_CALLBACK_PREFIX}${encodeURIComponent(options.selectedTaskId)}`
    : undefined;

  const card: OutboundRichCard = {
    title: `当前聊天自动化任务（${tasks.length}）`,
    subtitle: '这张表显示当前聊天可见的自动化任务；任务仍归属各自 bridge session。',
    template: 'green',
    table: {
      pageSize: 10,
      rowHeight: 'low',
      freezeFirstColumn: false,
      columns: AUTO_TASK_COLUMNS.map((column) => ({
        name: column.name,
        displayName: column.displayName,
        width: column.width,
        ...(column.dataType ? { dataType: column.dataType } : {}),
        ...(column.horizontalAlign ? { horizontalAlign: column.horizontalAlign } : {}),
      })),
      rows: buildAutoTaskCommandTableCardRows(buildAutoTaskCommandRows(tasks, sessionsById)),
    },
    sections: [],
    ...(tasks.length > 0
      ? {
          selects: [{
            id: 'auto_task_select',
            placeholder: '选择自动化任务',
            selectedCallbackData,
            options: tasks.map((task, index) => ({
              text: `${index + 1}. ${task.scriptPath}`,
              callbackData: `${AUTO_TASK_SELECT_CALLBACK_PREFIX}${encodeURIComponent(task.id)}`,
            })),
          }],
        }
      : {}),
    actions: tasks.length > 0
      ? [
          [
            {
              text: '删除',
              callbackData: buildAutoTaskActionCallbackData('rm'),
              type: 'danger',
            },
            {
              text: '设为1次',
              callbackData: buildAutoTaskActionCallbackData('set1'),
              type: 'primary',
            },
            {
              text: '刷新',
              callbackData: buildCommandCallbackData('/auto ls'),
              type: 'default',
            },
          ],
        ]
      : [
          [
            {
              text: '安装skill',
              callbackData: buildCommandCallbackData('/auto skill install'),
              type: 'primary',
            },
            {
              text: '刷新',
              callbackData: buildCommandCallbackData('/auto ls'),
              type: 'default',
            },
          ],
        ],
    footer: [
      tasks.length > 0
        ? '纯文本命令：`/auto rm 1` 删除第 1 个自动化任务，`/auto set 1 3` 重置为触发 3 次。'
        : '还没有任务。先安装 skill，让 Codex 创建脚本；脚本创建后发送 `/auto new <scriptpath> <times>`。',
      `超过 ${AUTO_TASK_CARD_MAX_ITEMS} 条时只发送文本列表，避免卡片过长。`,
    ],
  };
  if (options.channelType && options.chatId) {
    card.updateKey = buildThreadCardUpdateKey('auto', options.channelType, options.chatId);
    card.updateTtlMs = null;
  }
  return card;
}

function formatTaskSessionTitle(task: AutoTask, session: BridgeSession | undefined): string {
  if (!session) return task.bridgeSessionId.slice(0, 8);
  return getSessionDisplayName(session, session.working_directory);
}

function buildAutoTaskCommandTableText(rows: AutoTaskCommandRow[]): string {
  const tableRows = [
    AUTO_TASK_COLUMNS.map((column) => column.displayName),
    ...rows.map((row) => AUTO_TASK_COLUMNS.map((column) => normalizeCell(row[column.key]))),
  ];
  const widths = AUTO_TASK_COLUMNS.map((_, columnIndex) => (
    Math.max(...tableRows.map((row) => row[columnIndex].length))
  ));
  return tableRows
    .map((row) => row.map((cell, columnIndex) => cell.padEnd(widths[columnIndex])).join('  '))
    .join('\n');
}

function buildAutoTaskCommandTableCardRows(rows: AutoTaskCommandRow[]): Array<Record<string, string>> {
  return rows.map((row) => Object.fromEntries(AUTO_TASK_COLUMNS.map((column) => {
    const value = normalizeCell(row[column.key]);
    return [
      column.name,
      column.key === 'index'
        ? `<number_tag background_color='green-350' font_color='white'>${value}</number_tag>`
        : value,
    ];
  })));
}

function normalizeCell(value: string): string {
  return value.replace(/\s+/g, ' ').trim() || '-';
}
