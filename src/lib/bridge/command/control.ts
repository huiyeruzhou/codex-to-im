import {
  buildCommandFields,
} from './presentation.js';
import * as broker from '../permission-broker.js';
import * as router from '../channel-router.js';
import type { BridgeSession, BridgeStore } from '../host.js';
import { sendTmuxInterrupt } from '../tmux/runtime.js';
import type { CommandThreadDisplay } from './thread-display.js';
import type { ChannelBinding, InboundMessage } from '../types.js';

const RUNNING_HEALTH_STATUSES = new Set([
  'running_active',
  'waiting_tool',
  'slow_observed',
  'suspected_stall',
  'suspected_stream_ui_stall',
  'suspected_detached',
]);

export interface StopCommandDeps {
  getActiveTask(sessionId: string): { abortController: AbortController } | undefined;
  forceStopSession?(sessionId: string, detail?: string): Promise<boolean>;
  recordInteractiveHealthEnd?(sessionId: string, outcome: 'completed' | 'failed' | 'aborted', detail?: string): void;
}

function sessionLooksRunning(session: BridgeSession | null | undefined): boolean {
  return session?.runtime_status === 'running'
    || session?.runtime_status === 'queued'
    || RUNNING_HEALTH_STATUSES.has(session?.health_status || '');
}

function shouldMapStopToTmuxInterrupt(session: BridgeSession | null | undefined): session is BridgeSession & { tmux_session_name: string } {
  return session?.codex_provider === 'tmux'
    && Boolean(session.tmux_session_name)
    && session.mirror_status === 'watching'
    && sessionLooksRunning(session);
}

export async function handleStopCommand(options: {
  msg: InboundMessage;
  binding: ChannelBinding | null;
  store: BridgeStore;
  deps: StopCommandDeps;
  threadDisplay: CommandThreadDisplay;
  markdown: boolean;
}): Promise<string> {
  const binding = options.binding || router.resolve(options.msg.address);
  const session = options.store.getSession(binding.bridgeSessionId);
  const task = options.deps.getActiveTask(binding.bridgeSessionId);
  const looksRunning = sessionLooksRunning(session);
  if (!task && shouldMapStopToTmuxInterrupt(session)) {
    const command = await sendTmuxInterrupt(session.tmux_session_name);
    return buildCommandFields(
      '已发送停止按键',
      [
        ['Provider', 'tmux'],
        ['tmux session', session.tmux_session_name],
      ],
      [
        '当前会话处于 tmux Provider，且 mirror 显示任务仍在输出；`/stop` 已映射为向 Codex TUI 发送 `C-c`。',
        `底层命令：\`${command}\``,
      ],
      options.markdown,
    );
  }
  if (task || looksRunning) {
    const taskName = options.threadDisplay.binding(binding).title;
    const detail = '用户执行 /stop，已停止当前任务。';
    if (options.deps.forceStopSession) {
      await options.deps.forceStopSession(binding.bridgeSessionId, detail);
    } else if (task) {
      task.abortController.abort();
    }
    options.deps.recordInteractiveHealthEnd?.(binding.bridgeSessionId, 'aborted', detail);
    return `旧会话「${taskName}」任务已停止，可继续发送消息恢复该线程。`;
  }
  return '当前没有正在运行的任务。';
}

export function handlePermissionCommand(options: {
  args: string;
  chatId: string;
  currentBinding: ChannelBinding | null;
  store: BridgeStore;
}): string {
  const permParts = options.args.split(/\s+/);
  const permAction = permParts[0];
  const permId = permParts.slice(1).join(' ');
  if (!permAction || !permId || !['allow', 'allow_session', 'deny'].includes(permAction)) {
    return '用法：/perm allow|allow_session|deny <permission_id>';
  }
  const link = options.store.getPermissionLink(permId);
  if (!link) {
    return '没有找到对应权限，或该权限已处理。';
  }
  if (
    options.currentBinding?.bridgeSessionId
    && link.sessionId
    && link.sessionId !== options.currentBinding.bridgeSessionId
  ) {
    return '这条权限请求不属于当前会话。请先切回对应会话，再处理该权限。';
  }
  const callbackData = `perm:${permAction}:${permId}`;
  const handled = broker.handlePermissionCallback(callbackData, options.chatId);
  return handled
    ? `已记录权限操作：${permAction}`
    : '没有找到对应权限，或该权限已处理。';
}
