import { maskSecrets } from '../../logger.js';
import { sanitizeInput } from './security/validators.js';

export function summarizeToolDetailValue(value: unknown, maxChars: number): string {
  if (value == null) return '';
  if (typeof value === 'object' && value) {
    const record = value as Record<string, unknown>;
    const commandValue = record.command;
    if (typeof commandValue === 'string' && commandValue.trim()) {
      const trimmedCommand = commandValue.trim();
      const bashPrefix = '/bin/bash -lc "';
      const extracted = trimmedCommand.startsWith(bashPrefix) && trimmedCommand.endsWith('"')
        ? trimmedCommand.slice(bashPrefix.length, -1)
        : trimmedCommand;
      const masked = maskSecrets(extracted);
      const { text, truncated } = sanitizeInput(masked, maxChars);
      return truncated ? `${text}\n...(truncated)` : text;
    }
  }
  const raw = typeof value === 'string'
    ? value
    : (() => {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    })();
  const masked = maskSecrets(raw);
  const { text, truncated } = sanitizeInput(masked, maxChars);
  return truncated ? `${text}\n...(truncated)` : text;
}
