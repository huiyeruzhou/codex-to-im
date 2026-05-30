import {
  resolveCommandAlias,
} from './aliases.js';
import { getBridgeContext } from '../context.js';
import { deliverBridgeNotice } from '../feedback-delivery.js';
import * as router from '../channel-router.js';
import type { BaseChannelAdapter, StructuredStreamingUiActionButton } from '../channel-adapter.js';
import type { ChannelBinding, InboundMessage, OutboundRichCard } from '../types.js';
import { isDangerousInput } from '../security/validators.js';
import {
  getFeedbackParseMode,
} from '../bridge-channel-runtime.js';
import {
  handleCatCommand,
  handleCurrentCommand,
  handleFileCommand,
  handleHealthCommand,
  handleHistoryCommand,
} from './diagnostics.js';
import {
  handlePermissionCommand,
  handleStopCommand,
} from './control.js';
import { buildHelpCommandResponse } from './help.js';
import {
  buildStartCommandResponse,
  handleCodexThreadsCommand,
  handleNewSessionCommand,
  handleThreadBindingCommand,
  handleThreadSwitchCommand,
} from './session-thread.js';
import {
  handleModeCommand,
  handleModelCommand,
  handleNetworkCommand,
  handleProviderCommand,
  handleReasoningCommand,
  handleSandboxCommand,
  handleUiCommand,
} from './runtime-settings.js';
import { buildGlobalStatusResponse } from './status.js';
import {
  CommandThreadDisplay,
  type ThreadCardScope,
} from './thread-display.js';
import { persistAndPinLatestThreadTableMessage } from './thread-table-message-pins.js';
import {
  handleTmuxBridgeCommand,
} from './tmux.js';
import {
  handleAutoCommand,
} from './auto.js';
import type { AutoTaskCardAction } from '../command-callbacks.js';
import {
  finalizeStreamFeedback,
  pushStreamFeedbackActions,
  pushStreamFeedbackStatus,
  pushStreamFeedbackText,
  type StreamFeedbackTarget,
} from '../stream-feedback-controller.js';

const TMUX_SCREEN_STOP_CALLBACK_PREFIX = 'tmux-screen:stop:';

export interface BridgeCommandDispatchDeps {
  getActiveTask(sessionId: string): { abortController: AbortController } | undefined;
  forceStopSession?(sessionId: string, detail?: string): Promise<boolean>;
  recordInteractiveHealthEnd?(sessionId: string, outcome: 'completed' | 'failed' | 'aborted', detail?: string): void;
  reconcileMirrorSubscriptions?(): Promise<void>;
  diagnoseSessionHealth(sessionId: string): Promise<import('../session-health-runtime.js').SessionHealthDiagnosis | null>;
  diagnoseAllActiveSessions(): Promise<import('../session-health-runtime.js').SessionHealthDiagnosis[]>;
  scopedBinding?: ChannelBinding | null;
  threadCardRefreshScope?: ThreadCardScope | null;
  threadCardSelectedId?: string | null;
  selectedAutoTaskId?: string | null;
  selectedAutoTaskAction?: AutoTaskCardAction | null;
  startAutoTask?(taskId: string): void;
  stopAutoTask?(taskId: string): void;
  onBindingRemoved?(binding: ChannelBinding): void;
}

export async function handleBridgeCommand(
  adapter: BaseChannelAdapter,
  msg: InboundMessage,
  text: string,
  deps: BridgeCommandDispatchDeps,
): Promise<void> {
  const { store } = getBridgeContext();
  const threadDisplay = new CommandThreadDisplay(store);

  const trimmedText = text.trim();
  const commandToken = trimmedText.split(/\s+/)[0] || '';
  const rawCommand = commandToken.split('@')[0].toLowerCase();
  const args = trimmedText.slice(commandToken.length).trim();
  const command = resolveCommandAlias(rawCommand, args);

  const isTmuxKeystrokeCommand = command === '/tmux'
    || command === '/tmux-switch'
    || command === '/tmux-attach'
    || command === '/tmux-new'
    || command === '/tmux-status'
    || command === '/tmux-screen'
    || command === '/tmux-set';
  const dangerCheck = isTmuxKeystrokeCommand
    ? { dangerous: text.includes('\0') || text.length > 64_000, reason: text.includes('\0') ? 'null byte detected' : 'excessively long input' }
    : isDangerousInput(text);
  if (dangerCheck.dangerous) {
    store.insertAuditLog({
      channelType: adapter.channelType,
      chatId: msg.address.chatId,
      direction: 'inbound',
      messageId: msg.messageId,
      summary: `[BLOCKED] Dangerous input detected: ${dangerCheck.reason}`,
    });
    console.warn(`[bridge-manager] Blocked dangerous command input from chat ${msg.address.chatId}: ${dangerCheck.reason}`);
    await deliverBridgeNotice(adapter, msg.address, '命令被拒绝：检测到无效输入。', {
      replyToMessageId: msg.messageId,
    });
    return;
  }

  let response = '';
  let responseRichCard: OutboundRichCard | undefined;
  let responseParseMode: 'Markdown' | 'plain' = getFeedbackParseMode(adapter.channelType);
  let auditResponse = true;
  let threadTableCardScope: ThreadCardScope | undefined;
  const currentBinding = deps.scopedBinding || store.getChannelBinding(msg.address.channelType, msg.address.chatId);
  const shouldApplyDefaultTargetForCommand = !new Set(['/status', '/threads', '/t']).has(command);
  const commandBinding = !shouldApplyDefaultTargetForCommand
    ? currentBinding
    : currentBinding || (store.getChannelDefaultTarget(msg.address.channelType) ? router.resolve(msg.address) : null);

  switch (command) {
    case '/start':
      response = buildStartCommandResponse();
      break;

    case '/new': {
      const result = handleNewSessionCommand({
        msg,
        args,
        commandBinding,
        store,
        deps,
        threadDisplay,
        markdown: responseParseMode === 'Markdown',
      });
      response = result.response;
      responseRichCard = result.richCard;
      threadTableCardScope = result.threadTableCardScope;
      break;
    }

    case '/t': {
      const result = await handleThreadBindingCommand({
        msg,
        args,
        store,
        deps,
        threadDisplay,
        markdown: responseParseMode === 'Markdown',
      });
      response = result.response;
      responseRichCard = result.richCard;
      threadTableCardScope = result.threadTableCardScope;
      break;
    }

    case '/thread': {
      const result = await handleThreadSwitchCommand({
        msg,
        args,
        currentBinding,
        commandBinding,
        store,
        deps,
        threadDisplay,
        markdown: responseParseMode === 'Markdown',
      });
      response = result.response;
      responseRichCard = result.richCard;
      threadTableCardScope = result.threadTableCardScope;
      break;
    }

    case '/threads': {
      const result = handleCodexThreadsCommand({
        msg,
        args,
        threadDisplay,
        markdown: responseParseMode === 'Markdown',
      });
      response = result.response;
      responseRichCard = result.richCard;
      threadTableCardScope = result.threadTableCardScope;
      break;
    }

    case '/tmux':
    case '/tmux-switch':
    case '/tmux-attach':
    case '/tmux-new':
    case '/tmux-status':
    case '/tmux-screen':
    case '/tmux-set': {
      const binding = currentBinding || router.resolve(msg.address);
      const session = store.getSession(binding.bridgeSessionId);
      if (!session) {
        response = '当前会话不存在，无法维护 tmux 状态。';
        break;
      }
      const tmuxScreenKey = `tmux-screen:${msg.address.channelType}:${msg.address.chatId}:${binding.bridgeSessionId}`;
      const tmuxScreenTarget: StreamFeedbackTarget = {
        adapter,
        channelType: adapter.channelType,
        chatId: msg.address.chatId,
        streamKey: tmuxScreenKey,
      };
      const tmuxScreenCard = (
        command === '/tmux-screen'
        && adapter.supportsStructuredStreamingUi?.(msg.address.chatId)
        && typeof adapter.onStreamText === 'function'
      )
        ? {
            update: (text: string, statusText: string) => {
              pushStreamFeedbackText(tmuxScreenTarget, text);
              pushStreamFeedbackStatus(tmuxScreenTarget, statusText);
            },
            actions: (actions: StructuredStreamingUiActionButton[][]) => {
              pushStreamFeedbackActions(tmuxScreenTarget, actions);
            },
            finish: (status: 'completed' | 'interrupted' | 'error', text: string) => (
              finalizeStreamFeedback(tmuxScreenTarget, status, text)
            ),
          }
        : undefined;
      response = await handleTmuxBridgeCommand({
        command,
        args,
        store,
        binding,
        session,
        markdown: responseParseMode === 'Markdown',
        screenMonitor: command === '/tmux-screen'
          ? {
              key: `${msg.address.channelType}:${msg.address.chatId}:${binding.bridgeSessionId}`,
              stopCallbackData: `${TMUX_SCREEN_STOP_CALLBACK_PREFIX}${encodeURIComponent(binding.bridgeSessionId)}`,
              card: tmuxScreenCard,
              deliver: async (text) => {
                await deliverBridgeNotice(adapter, msg.address, text, {
                  sessionId: binding.bridgeSessionId,
                  audit: true,
                });
              },
            }
          : undefined,
        richCard: (card) => {
          responseRichCard = card;
        },
      });
      break;
    }

    case '/reasoning': {
      response = handleReasoningCommand({
        args,
        binding: commandBinding,
        store,
        markdown: responseParseMode === 'Markdown',
      });
      break;
    }

    case '/cwd': {
      response = '当前版本已不支持 /cwd。请使用 /new 新建会话，或使用 /t 切换到已有本地 Codex 会话。';
      break;
    }

    case '/mode': {
      response = handleModeCommand({
        msg,
        args,
        currentBinding,
        store,
        markdown: responseParseMode === 'Markdown',
      });
      break;
    }

    case '/provider': {
      response = await handleProviderCommand({
        msg,
        args,
        currentBinding,
        store,
        deps,
        markdown: responseParseMode === 'Markdown',
      });
      break;
    }

    case '/sandbox': {
      response = handleSandboxCommand({
        msg,
        args,
        currentBinding,
        store,
        markdown: responseParseMode === 'Markdown',
      });
      break;
    }

    case '/network': {
      response = handleNetworkCommand({
        msg,
        args,
        currentBinding,
        store,
        markdown: responseParseMode === 'Markdown',
      });
      break;
    }

    case '/ui': {
      response = handleUiCommand({
        args,
        markdown: responseParseMode === 'Markdown',
      });
      break;
    }

    case '/model': {
      response = handleModelCommand({
        msg,
        args,
        currentBinding,
        store,
        markdown: responseParseMode === 'Markdown',
      });
      break;
    }

    case '/auto': {
      const session = commandBinding ? store.getSession(commandBinding.bridgeSessionId) : null;
      const result = handleAutoCommand({
        msg,
        args,
        session,
        store,
        deps: {
          selectedAutoTaskId: deps.selectedAutoTaskId,
          selectedAutoTaskAction: deps.selectedAutoTaskAction,
          startAutoTask: deps.startAutoTask,
          stopAutoTask: deps.stopAutoTask,
        },
        markdown: responseParseMode === 'Markdown',
      });
      response = result.response;
      responseRichCard = result.richCard;
      threadTableCardScope = result.threadTableCardScope;
      break;
    }

    case '/status': {
      auditResponse = false;
      response = buildGlobalStatusResponse(
        store,
        currentBinding,
        responseParseMode === 'Markdown',
      );
      break;
    }

    case '/current': {
      auditResponse = false;
      response = handleCurrentCommand({
        msg,
        binding: commandBinding,
        store,
        threadDisplay,
        markdown: responseParseMode === 'Markdown',
      });
      break;
    }

    case '/health': {
      auditResponse = false;
      response = await handleHealthCommand({
        args,
        binding: commandBinding,
        deps,
        markdown: responseParseMode === 'Markdown',
      });
      break;
    }

    case '/history': {
      response = await handleHistoryCommand({
        adapter,
        msg,
        args,
        binding: commandBinding,
        store,
        threadDisplay,
        markdown: responseParseMode === 'Markdown',
      });
      break;
    }

    case '/cat': {
      const binding = currentBinding || router.resolve(msg.address);
      response = handleCatCommand({
        args,
        binding,
        markdown: responseParseMode === 'Markdown',
      });
      break;
    }

    case '/file': {
      const binding = currentBinding || router.resolve(msg.address);
      response = await handleFileCommand({
        adapter,
        msg,
        args,
        binding,
      });
      break;
    }

    case '/stop': {
      response = await handleStopCommand({
        msg,
        binding: commandBinding,
        store,
        deps,
        threadDisplay,
        markdown: responseParseMode === 'Markdown',
      });
      break;
    }

    case '/perm': {
      response = handlePermissionCommand({
        args,
        chatId: msg.address.chatId,
        currentBinding,
        store,
      });
      break;
    }

    case '/help':
      responseParseMode = getFeedbackParseMode(adapter.channelType);
      response = buildHelpCommandResponse();
      break;

    default:
      response = `未知命令：${rawCommand}\n发送 /h 或 /help 查看可用命令。`;
  }

  if (response) {
    const result = await deliverBridgeNotice(adapter, msg.address, response, {
      replyToMessageId: msg.messageId,
      audit: auditResponse,
      richCard: responseRichCard,
      richCardUpdateMessageId: msg.callbackMessageId,
    });
    if (result.ok && threadTableCardScope && result.messageId) {
      await persistAndPinLatestThreadTableMessage(adapter, msg.address, threadTableCardScope, result.messageId);
    }
  }
}
