import {
  getCodexSessionByThreadId,
  listCodexSessions,
  type CodexSessionSummary,
} from '../../../codex/session-index.js';
import { validateSessionId } from '../security/validators.js';

export type { CodexSessionSummary };

export function listCommandCodexThreads(limit: number): CodexSessionSummary[] | null {
  try {
    return listCodexSessions(limit);
  } catch (error) {
    console.error('[command-session-source] Failed to list Codex sessions:', error);
    return null;
  }
}

export function getCommandCodexThreadByIdSafe(
  rawThreadId: string,
  context: string,
): { threadId?: string; thread?: CodexSessionSummary } {
  const threadId = rawThreadId.trim();
  if (!validateSessionId(threadId)) return {};

  try {
    return {
      threadId,
      thread: getCodexSessionByThreadId(threadId) || undefined,
    };
  } catch (error) {
    console.error(
      `[command-session-source] Failed to load Codex thread ${threadId} during ${context}:`,
      error,
    );
    return { threadId };
  }
}
