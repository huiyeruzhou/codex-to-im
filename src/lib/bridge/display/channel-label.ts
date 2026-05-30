import type { ChannelBinding } from '../types.js';

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
