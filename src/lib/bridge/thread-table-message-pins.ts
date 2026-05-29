import fs from 'node:fs';
import path from 'node:path';

import { CTI_HOME } from '../../config.js';
import type { BaseChannelAdapter } from './channel-adapter.js';
import type { ChannelAddress } from './types.js';
import type { ThreadCardScope } from './command-formatters.js';

interface ThreadTableMessageRecord {
  channelType: string;
  channelProvider?: string;
  channelAlias?: string;
  chatId: string;
  scope: ThreadCardScope;
  messageId: string;
  pinnedMessageId?: string;
  updatedAt: string;
}

type ThreadTableMessageStore = Record<string, ThreadTableMessageRecord>;

const THREAD_TABLE_MESSAGES_PATH = path.join(CTI_HOME, 'data', 'thread-table-messages.json');

function tableMessageKey(address: ChannelAddress): string {
  return `${address.channelType}:${address.chatId}`;
}

function readThreadTableMessages(): ThreadTableMessageStore {
  try {
    return JSON.parse(fs.readFileSync(THREAD_TABLE_MESSAGES_PATH, 'utf-8')) as ThreadTableMessageStore;
  } catch {
    return {};
  }
}

function writeThreadTableMessages(records: ThreadTableMessageStore): void {
  fs.mkdirSync(path.dirname(THREAD_TABLE_MESSAGES_PATH), { recursive: true });
  fs.writeFileSync(THREAD_TABLE_MESSAGES_PATH, JSON.stringify(records, null, 2));
}

export function getThreadTableMessageRecord(address: ChannelAddress): ThreadTableMessageRecord | null {
  return readThreadTableMessages()[tableMessageKey(address)] || null;
}

export function saveThreadTableMessageRecord(
  address: ChannelAddress,
  scope: ThreadCardScope,
  messageId: string,
  pinnedMessageId?: string,
): void {
  const records = readThreadTableMessages();
  records[tableMessageKey(address)] = {
    channelType: address.channelType,
    channelProvider: address.channelProvider,
    channelAlias: address.channelAlias,
    chatId: address.chatId,
    scope,
    messageId,
    pinnedMessageId,
    updatedAt: new Date().toISOString(),
  };
  writeThreadTableMessages(records);
}

export async function persistAndPinLatestThreadTableMessage(
  adapter: BaseChannelAdapter,
  address: ChannelAddress,
  scope: ThreadCardScope,
  messageId: string | null | undefined,
): Promise<void> {
  const trimmedMessageId = messageId?.trim();
  if (!trimmedMessageId) return;

  const previous = getThreadTableMessageRecord(address);
  let pinnedMessageId = previous?.pinnedMessageId;

  if (adapter.pinMessage) {
    const pinResult = await adapter.pinMessage(address.chatId, trimmedMessageId);
    if (pinResult.ok) {
      pinnedMessageId = trimmedMessageId;
      const previousPinnedId = previous?.pinnedMessageId || previous?.messageId;
      if (
        previousPinnedId
        && previousPinnedId !== trimmedMessageId
        && adapter.unpinMessage
      ) {
        const unpinResult = await adapter.unpinMessage(address.chatId, previousPinnedId);
        if (!unpinResult.ok) {
          console.warn('[thread-table-pins] Failed to unpin previous thread table:', unpinResult.error || previousPinnedId);
        }
      }
    } else {
      console.warn('[thread-table-pins] Failed to pin latest thread table:', pinResult.error || trimmedMessageId);
    }
  }

  saveThreadTableMessageRecord(address, scope, trimmedMessageId, pinnedMessageId);
}
