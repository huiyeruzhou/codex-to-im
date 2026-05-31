export const REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const;
export const DEFAULT_CODEX_THREAD_LIST_LIMIT = 10;
export const MAX_CODEX_THREAD_LIST_LIMIT = 200;

export function parseListIndex(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

export function resolveCommandAlias(rawCommand: string, args: string): string {
  switch (rawCommand) {
    case '/check':
      return '/health';
    case '/':
      return '/current';
    case '/h':
      return '/help';
    case '/t':
      return /^(ls|add|archive|use|rm|remove|rename)\b/i.test(args.trim())
        ? '/t'
        : !args
        ? '/threads'
        : /^(all|n\b)/i.test(args.trim())
          ? '/threads'
          : '/thread';
    case '/n':
      return '/new';
    case '/m':
      return '/mode';
    case '/p':
      return '/provider';
    case '/r':
      return '/reasoning';
    case '/sb':
      return '/sandbox';
    case '/net':
      return '/network';
    case '/ui':
      return '/ui';
    case '/tool':
    case '/tools':
      return '/ui';
    case '/his':
      return '/history';
    case '/hotupdate':
      return '/hot-update';
    default:
      return rawCommand;
  }
}

const KNOWN_BRIDGE_COMMANDS = new Set([
  '/start',
  '/new',
  '/thread',
  '/threads',
  '/t',
  '/tmux',
  '/tmux-key',
  '/tmux-switch',
  '/tmux-attach',
  '/tmux-new',
  '/tmux-status',
  '/tmux-screen',
  '/tmux-set',
  '/set',
  '/auto',
  '/reasoning',
  '/cwd',
  '/mode',
  '/provider',
  '/sandbox',
  '/network',
  '/ui',
  '/model',
  '/status',
  '/current',
  '/health',
  '/history',
  '/hot-update',
  '/shell',
  '/cat',
  '/file',
  '/stop',
  '/perm',
  '/help',
]);

export function isKnownBridgeCommand(rawCommand: string, args = ''): boolean {
  return KNOWN_BRIDGE_COMMANDS.has(resolveCommandAlias(rawCommand.toLowerCase(), args));
}

export function isEscapedSlashPrompt(rawText: string): boolean {
  return rawText.trim().startsWith('//');
}

export function isBridgeCommandText(rawText: string): boolean {
  const trimmed = rawText.trim();
  return trimmed.startsWith('/') && !trimmed.startsWith('//');
}

export function toModelPromptText(rawText: string): string {
  const trimmed = rawText.trim();
  return trimmed.startsWith('//') ? trimmed.slice(1) : trimmed;
}

export function parseCodexThreadListArgs(args: string): { showAll: boolean; limit: number } | null {
  const trimmed = args.trim().toLowerCase();
  if (!trimmed) {
    return { showAll: false, limit: DEFAULT_CODEX_THREAD_LIST_LIMIT };
  }
  if (trimmed === 'all') {
    return { showAll: true, limit: MAX_CODEX_THREAD_LIST_LIMIT };
  }
  const match = trimmed.match(/^n\s+(\d+)$/);
  if (!match) return null;
  const requestedLimit = Number(match[1]);
  const limit = Math.min(requestedLimit, MAX_CODEX_THREAD_LIST_LIMIT);
  if (!Number.isInteger(limit) || limit < 1) return null;
  return { showAll: false, limit };
}

export function normalizeReasoningEffort(raw: string): typeof REASONING_LEVELS[number] | null {
  const token = raw.trim().toLowerCase();
  if (!token) return null;
  if (REASONING_LEVELS.includes(token as typeof REASONING_LEVELS[number])) {
    return token as typeof REASONING_LEVELS[number];
  }

  switch (token) {
    case '1':
      return 'minimal';
    case '2':
      return 'low';
    case '3':
      return 'medium';
    case '4':
      return 'high';
    case '5':
      return 'xhigh';
    default:
      return null;
  }
}
