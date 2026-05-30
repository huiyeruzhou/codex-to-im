import type { BridgeSession, BridgeStore } from '../host.js';
import type { InboundMessage, OutboundRichCard } from '../types.js';
import type { ThreadCardScope } from '../command-callbacks.js';
import {
  createAutoTask,
  deleteAutoTask,
  installAutoScriptSkill,
  listAutoTasks,
  resolveAutoScriptPath,
  setAutoTaskTimes,
  uninstallAutoScriptSkill,
  validateAutoScriptPath,
} from '../auto-tasks.js';
import {
  buildAutoTasksCommandCard,
  buildAutoTasksCommandResponse,
} from './auto-presentation.js';
import { parseListIndex } from './aliases.js';
import {
  buildCommandFields,
  formatCommandDateTime,
  formatCommandPath,
  getSessionDisplayName,
} from './presentation.js';

export interface AutoCommandDeps {
  startAutoTask?(taskId: string): void;
  stopAutoTask?(taskId: string): void;
  selectedAutoTaskId?: string | null;
  selectedAutoTaskAction?: 'rm' | 'set1' | null;
}

export interface AutoCommandResult {
  response: string;
  richCard?: OutboundRichCard;
  threadTableCardScope?: ThreadCardScope;
}

export function handleAutoCommand(options: {
  msg: InboundMessage;
  args: string;
  session: BridgeSession | null;
  store: BridgeStore;
  deps: AutoCommandDeps;
  markdown: boolean;
}): AutoCommandResult {
  const parts = options.args.trim().split(/\s+/).filter(Boolean);
  const subcommand = (parts[0] || 'ls').toLowerCase();
  const subArgs = options.args.trim().slice((parts[0] || '').length).trim();

  if (subcommand === 'ls' || subcommand === 'list') {
    const session = requireCurrentSession(options.session);
    if (!session.ok) return { response: session.message };
    const tasks = listVisibleAutoTasks(options.msg);
    const sessionsById = buildAutoTaskSessionMap(tasks, options.store);
    const richCard = buildAutoTasksCommandCard(tasks, sessionsById, {
      selectedTaskId: options.deps.selectedAutoTaskId,
      channelType: options.msg.address.channelType,
      chatId: options.msg.address.chatId,
    }) || undefined;
    return {
      response: buildAutoTasksCommandResponse(tasks, sessionsById, options.markdown),
      richCard,
      threadTableCardScope: richCard ? 'auto' : undefined,
    };
  }

  if (subcommand === 'new') {
    const session = requireCurrentSession(options.session);
    if (!session.ok) return { response: session.message };
    const parsed = parseNewAutoTaskArgs(subArgs, session.session.working_directory);
    if (!parsed.ok) return { response: parsed.message };
    const task = createAutoTask({
      bridgeSessionId: session.session.id,
      address: options.msg.address,
      scriptPath: parsed.scriptPath,
      times: parsed.times,
    });
    options.deps.startAutoTask?.(task.id);
    return {
      response: buildCommandFields(
        '已创建自动化任务',
        [
          ['Session', getSessionDisplayName(session.session, session.session.working_directory)],
          ['脚本路径', formatCommandPath(task.scriptPath)],
          ['创建时间', formatCommandDateTime(task.createdAt)],
          ['触发次数', `${task.times}`],
          ['session codex-id', session.session.codex_thread_id || '-'],
        ],
        [
          '任务已归属到当前 bridge session；后续即使当前聊天切换线程，也会继续恢复这个 session。',
          '发送 `/auto ls` 查看任务，发送 `/auto rm <序号>` 删除任务，发送 `/auto set <序号> <次数>` 重置触发次数。',
        ],
        options.markdown,
      ),
    };
  }

  if (subcommand === 'rm' || subcommand === 'remove') {
    const session = requireCurrentSession(options.session);
    if (!session.ok) return { response: session.message };
    const tasks = listVisibleAutoTasks(options.msg);
    const selectedTaskId = options.deps.selectedAutoTaskId?.trim() || '';
    const selected = selectedTaskId
      ? tasks.find((task) => task.id === selectedTaskId)
      : selectAutoTaskByIndex(subArgs, tasks);
    if (!selected) {
      return {
        response: selectedTaskId
          ? '选择的自动化任务已经不存在，请刷新 `/auto ls` 后重试。'
          : buildAutoRmUsage(subArgs, tasks.length),
      };
    }
    deleteAutoTask(selected.id);
    options.deps.stopAutoTask?.(selected.id);
    return {
      response: buildCommandFields(
        '已删除自动化任务',
        [
          ['脚本路径', formatCommandPath(selected.scriptPath)],
          ['已触发', `${selected.triggeredCount}`],
          ['总次数', `${selected.times}`],
        ],
        ['任务记录已删除；如果后台循环正在等待脚本或 Codex 响应，会尽快中止。'],
        options.markdown,
      ),
    };
  }

  if (subcommand === 'set') {
    const session = requireCurrentSession(options.session);
    if (!session.ok) return { response: session.message };
    const tasks = listVisibleAutoTasks(options.msg);
    const selectedTaskId = options.deps.selectedAutoTaskId?.trim() || '';
    const parsed = options.deps.selectedAutoTaskAction === 'set1'
      ? { ok: true as const, indexRaw: '', times: 1 }
      : parseAutoSetArgs(subArgs);
    if (!parsed.ok) return { response: parsed.message };
    const selected = selectedTaskId
      ? tasks.find((task) => task.id === selectedTaskId)
      : selectAutoTaskByIndex(parsed.indexRaw, tasks);
    if (!selected) {
      return {
        response: selectedTaskId
          ? '选择的自动化任务已经不存在，请刷新 `/auto ls` 后重试。'
          : buildAutoSelectionUsage(parsed.indexRaw, tasks.length, 'set'),
      };
    }
    const updated = setAutoTaskTimes(selected.id, parsed.times);
    if (!updated) return { response: '自动化任务已经不存在，请刷新 `/auto ls` 后重试。' };
    if (parsed.times > 0) {
      options.deps.startAutoTask?.(updated.id);
    } else {
      options.deps.stopAutoTask?.(updated.id);
    }
    return {
      response: buildCommandFields(
        '已更新自动化任务次数',
        [
          ['脚本路径', formatCommandPath(updated.scriptPath)],
          ['已触发', `${updated.triggeredCount}`],
          ['总次数', `${updated.times}`],
          ['状态', updated.status],
        ],
        [updated.times > 0 ? '已重置已触发次数，任务可重新触发。' : '次数为 0，任务已暂停且不会自动触发。'],
        options.markdown,
      ),
    };
  }

  if (subcommand === 'skill') {
    const action = (parts[1] || '').toLowerCase();
    if (action === 'install') {
      const result = installAutoScriptSkill();
      return {
        response: buildCommandFields(
          result.method === 'existing' ? '自动脚本 skill 已存在' : '已安装自动脚本 skill',
          [['目标目录', result.targetDir], ['处理方式', result.method]],
          [],
          options.markdown,
        ),
      };
    }
    if (action === 'uninstall') {
      const result = uninstallAutoScriptSkill();
      return {
        response: buildCommandFields(
          result.method === 'missing' ? '自动脚本 skill 未安装' : '已删除自动脚本 skill',
          [['目标目录', result.targetDir], ['处理方式', result.method]],
          [],
          options.markdown,
        ),
      };
    }
    return { response: '用法：/auto skill <install|uninstall>。' };
  }

  return { response: '用法：/auto ls、/auto new <scriptpath> <times>、/auto rm <序号>、/auto set <序号> <times>、/auto skill <install|uninstall>。' };
}

function requireCurrentSession(session: BridgeSession | null): { ok: true; session: BridgeSession } | { ok: false; message: string } {
  if (session) return { ok: true, session };
  return {
    ok: false,
    message: '当前聊天还没有 bridge session。请先用 `/t 1` 接管本地 Codex 会话，或用 `/new <目录>` 创建会话。',
  };
}

function parseNewAutoTaskArgs(raw: string, cwd: string): { ok: true; scriptPath: string; times: number } | { ok: false; message: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.*)\s+(\d+)$/);
  if (!match) {
    return { ok: false, message: '用法：/auto new <scriptpath> <times>。例如：/auto new /abs/path/check-exp-progress.sh 5' };
  }
  const scriptPath = resolveAutoScriptPath(match[1], cwd);
  const times = Number(match[2]);
  if (!Number.isInteger(times) || times < 1) {
    return { ok: false, message: 'times 必须是大于 0 的整数。' };
  }
  const scriptValidation = validateAutoScriptPath(scriptPath);
  if (!scriptValidation.ok) return scriptValidation;
  return { ok: true, scriptPath, times };
}

function parseAutoSetArgs(raw: string): { ok: true; indexRaw: string; times: number } | { ok: false; message: string } {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length !== 2) {
    return { ok: false, message: '用法：/auto set <序号> <times>。例如：/auto set 1 3；times 为 0 表示暂停。' };
  }
  const times = Number(parts[1]);
  if (!Number.isInteger(times) || times < 0) {
    return { ok: false, message: 'times 必须是大于等于 0 的整数；0 表示暂停。' };
  }
  return { ok: true, indexRaw: parts[0], times };
}

function selectAutoTaskByIndex(raw: string, tasks: ReturnType<typeof listAutoTasks>) {
  const index = parseListIndex(raw.trim());
  if (index === null) return null;
  return tasks[index - 1] || null;
}

function buildAutoRmUsage(raw: string, taskCount: number): string {
  return buildAutoSelectionUsage(raw, taskCount, 'rm');
}

function buildAutoSelectionUsage(raw: string, taskCount: number, action: 'rm' | 'set'): string {
  const index = parseListIndex(raw.trim());
  const command = action === 'rm' ? 'rm <序号>' : 'set <序号> <times>';
  if (index !== null) {
    return `当前聊天只有 ${taskCount} 个自动化任务，没有第 ${index} 个。发送 \`/auto ls\` 查看列表。`;
  }
  return `用法：/auto ${command}。序号来自 \`/auto ls\`。`;
}

function listVisibleAutoTasks(msg: InboundMessage) {
  return listAutoTasks({
    channelType: msg.address.channelType,
    chatId: msg.address.chatId,
    includeCompleted: true,
  });
}

function buildAutoTaskSessionMap(tasks: ReturnType<typeof listAutoTasks>, store: BridgeStore): Map<string, BridgeSession> {
  const sessionsById = new Map<string, BridgeSession>();
  for (const task of tasks) {
    if (sessionsById.has(task.bridgeSessionId)) continue;
    const session = store.getSession(task.bridgeSessionId);
    if (session) sessionsById.set(task.bridgeSessionId, session);
  }
  return sessionsById;
}
