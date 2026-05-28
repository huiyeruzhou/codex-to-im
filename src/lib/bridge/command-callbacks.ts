const COMMAND_CALLBACK_PREFIX = 'cti-command:';

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
