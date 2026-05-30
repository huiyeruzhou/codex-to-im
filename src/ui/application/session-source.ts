import { readConfiguredCodexModel } from '../../codex/models.js';
import {
  archiveCodexSession,
  type CodexSessionJsonlHistoryEntry,
  type CodexSessionSummary,
  getCodexSessionByThreadId,
  getCodexSessionsRoot,
  listCodexSessions,
  readCodexSessionJsonlHistoryStreamByFilePath,
} from '../../codex/session-index.js';
import { SessionRegistryService } from '../../lib/bridge/session-registry.js';
import type { JsonFileStore } from '../../store.js';

export interface UiSessionCodexSource {
  listSessions(): CodexSessionSummary[];
  getSessionsRoot(): string;
  getThread(codexThreadId: string): CodexSessionSummary | null;
  readJsonlHistory(codexThreadId: string): CodexSessionJsonlHistoryEntry[];
  archiveThread(codexThreadId: string): boolean;
  readDefaultModel(): string | null | undefined;
  defaultWorkingDirectory(): string;
}

export const defaultUiSessionCodexSource: UiSessionCodexSource = {
  listSessions: listCodexSessions,
  getSessionsRoot: getCodexSessionsRoot,
  getThread: getCodexSessionByThreadId,
  readJsonlHistory(codexThreadId) {
    const session = getCodexSessionByThreadId(codexThreadId);
    return session ? readCodexSessionJsonlHistoryStreamByFilePath(session.filePath) : [];
  },
  archiveThread(codexThreadId) {
    return Boolean(archiveCodexSession(codexThreadId));
  },
  readDefaultModel: readConfiguredCodexModel,
  defaultWorkingDirectory: () => process.cwd(),
};

export function createUiSessionRegistry(
  store: JsonFileStore,
  codexSource: UiSessionCodexSource = defaultUiSessionCodexSource,
): SessionRegistryService {
  return new SessionRegistryService(store, {
    codexThreads: {
      getThread(codexThreadId) {
        const session = codexSource.getThread(codexThreadId);
        return session
          ? { codexThreadId: session.threadId, title: session.title, cwd: session.cwd }
          : null;
      },
      archiveThread: (codexThreadId) => codexSource.archiveThread(codexThreadId),
    },
    readDefaultModel: () => codexSource.readDefaultModel(),
    defaultWorkingDirectory: () => codexSource.defaultWorkingDirectory(),
  });
}
