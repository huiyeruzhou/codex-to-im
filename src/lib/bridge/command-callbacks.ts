const COMMAND_CALLBACK_PREFIX = 'cti-command:';
export const THREAD_SELECT_CALLBACK_PREFIX = 'cti-thread-select:';
export const THREAD_SELECT_ACTION_CALLBACK_PREFIX = 'cti-thread-action:';
export const AUTO_TASK_SELECT_CALLBACK_PREFIX = 'cti-auto-select:';
export const AUTO_TASK_ACTION_CALLBACK_PREFIX = 'cti-auto-action:';

export type AutoTaskCardAction = 'rm' | 'set1';
export type ThreadCardScope = 'global' | 'bound' | 'auto';
export type ThreadCardAction = 'attach' | 'detach' | 'use' | 'archive';

export interface ParsedCommandCallback {
  commandText: string;
  scopeSessionId: string | null;
}

export function buildCommandCallbackData(commandText: string, scopeSessionId?: string | null): string {
  return [
    COMMAND_CALLBACK_PREFIX,
    encodeURIComponent(scopeSessionId || ''),
    ':',
    encodeURIComponent(commandText),
  ].join('');
}

export function parseCommandCallbackData(callbackData: string): ParsedCommandCallback | undefined | null {
  if (!callbackData.startsWith(COMMAND_CALLBACK_PREFIX)) return undefined;
  const rest = callbackData.slice(COMMAND_CALLBACK_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator < 0) return null;

  try {
    const scopeSessionId = decodeURIComponent(rest.slice(0, separator)).trim() || null;
    const commandText = decodeURIComponent(rest.slice(separator + 1)).trim();
    if (!commandText.startsWith('/') || commandText.startsWith('//') || commandText.length > 1000 || commandText.includes('\0')) {
      return null;
    }
    return { commandText, scopeSessionId };
  } catch {
    return null;
  }
}

export function buildThreadCardUpdateKey(scope: ThreadCardScope, channelType: string, chatId: string): string {
  return `thread-card:${scope}:${channelType}:${chatId}`;
}

export function buildThreadActionCallbackData(scope: ThreadCardScope, action: ThreadCardAction): string {
  return `${THREAD_SELECT_ACTION_CALLBACK_PREFIX}${scope}:${action}`;
}

export function buildAutoTaskActionCallbackData(action: AutoTaskCardAction): string {
  return `${AUTO_TASK_ACTION_CALLBACK_PREFIX}${action}`;
}
