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

function legacyTableMessageKey(address: ChannelAddress): string {
  return `${address.channelType}:${address.chatId}`;
}

function tableMessageKey(address: ChannelAddress, scope: ThreadCardScope): string {
  return `${legacyTableMessageKey(address)}:${scope}`;
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

export function getThreadTableMessageRecord(
  address: ChannelAddress,
  scope?: ThreadCardScope,
): ThreadTableMessageRecord | null {
  const records = readThreadTableMessages();
  if (scope) {
    const scoped = records[tableMessageKey(address, scope)];
    if (scoped) return scoped;
    const legacy = records[legacyTableMessageKey(address)];
    return legacy?.scope === scope ? legacy : null;
  }

  const candidates = [
    records[legacyTableMessageKey(address)],
    records[tableMessageKey(address, 'global')],
    records[tableMessageKey(address, 'bound')],
  ].filter((record): record is ThreadTableMessageRecord => Boolean(record));
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] || null;
}

export function saveThreadTableMessageRecord(
  address: ChannelAddress,
  scope: ThreadCardScope,
  messageId: string,
  pinnedMessageId?: string,
): void {
  const records = readThreadTableMessages();
  records[tableMessageKey(address, scope)] = {
    channelType: address.channelType,
    channelProvider: address.channelProvider,
    channelAlias: address.channelAlias,
    chatId: address.chatId,
    scope,
    messageId,
    pinnedMessageId,
    updatedAt: new Date().toISOString(),
  };
  const legacyKey = legacyTableMessageKey(address);
  if (records[legacyKey]?.scope === scope) {
    delete records[legacyKey];
  }
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

  const previous = getThreadTableMessageRecord(address, scope);
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
