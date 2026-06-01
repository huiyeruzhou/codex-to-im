import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { LLMProvider, StreamChatParams } from '../lib/bridge/host.js';
import type { CodexReasoningEffort, CodexSandboxMode } from '../config.js';
import {
  getCodexSessionsRoot,
  readCodexSessionMirrorRecordDeltaByFilePath,
  type CodexMirrorRecord,
} from './session-index.js';
import { sseEvent } from '../sse-utils.js';
import {
  normalizeSandboxMode,
  parseReasoningEffort,
} from '../runtime-options.js';
import {
  buildShellSnapshotLaunchCommand,
  ensureShellSnapshot,
} from './shell-snapshot.js';
import { tmuxCore } from '../lib/bridge/tmux/core.js';

const DEFAULT_TMUX_PROMPT_DELAY_MS = 1_200;
const DEFAULT_TMUX_POLL_INTERVAL_MS = 500;
const DEFAULT_TMUX_SESSION_FILE_TIMEOUT_MS = 30_000;
const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

interface SessionFileSnapshotEntry {
  size: number;
  mtimeMs: number;
}

type SessionFileSnapshot = Map<string, SessionFileSnapshotEntry>;

interface TmuxRunContext {
  sessionName: string;
  targetPane: string;
  bridgeSessionId: string;
  threadId?: string;
  sessionFilePath?: string;
  nextOffset: number;
  trailingText: string;
  nextTurnId: string | null;
  nextSpecialCallIds: string[];
  emittedToolStarts: Set<string>;
  emittedRecordSignatures: Set<string>;
  lastAssistantText: string;
  terminalSeen: boolean;
  hasError: boolean;
}

interface SessionMetaPreview {
  threadId: string;
  cwd: string;
  originator: string;
  source: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parsePositiveIntEnv(name: string, fallback: number, minValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= minValue) return Math.floor(parsed);
  return fallback;
}

export function isTruthyEnv(value: string | undefined): boolean {
  const normalized = (value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function shouldUseCodexTmuxTui(): boolean {
  return isTruthyEnv(process.env.CTI_CODEX_USE_TMUX_TUI)
    || isTruthyEnv(process.env.CTI_CODEX_TMUX_TUI)
    || isTruthyEnv(process.env.CTI_CODEX_TUI);
}

function isDebugTmuxKeepAlive(): boolean {
  return isTruthyEnv(process.env.CTI_DEBUG);
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function commandPreview(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(' ');
}

function tmuxSessionName(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_.-]/g, '-').slice(0, 80) || 'session';
  return `cti-${process.pid}-${Date.now()}-${safe}`;
}

export function buildCodexTuiEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  if (env.CTI_CODEX_API_KEY && !env.CODEX_API_KEY) {
    env.CODEX_API_KEY = env.CTI_CODEX_API_KEY;
  }
  if ((env.CODEX_API_KEY || env.CTI_CODEX_API_KEY) && !env.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = env.CODEX_API_KEY || env.CTI_CODEX_API_KEY;
  }
  return env;
}

export function buildCodexTuiShellCommand(command: string, args: string[], env: Record<string, string>): string {
  const snapshot = ensureShellSnapshot(env);
  return buildShellSnapshotLaunchCommand(command, args, snapshot);
}

function toApprovalPolicy(permissionMode?: string): string {
  switch (permissionMode) {
    case 'never': return 'never';
    case 'acceptEdits': return 'on-request';
    case 'plan': return 'on-request';
    case 'default': return 'on-request';
    default: return 'on-request';
  }
}

function isYoloMode(params: StreamChatParams): boolean {
  return params.codexMode === 'yolo' || params.permissionMode === 'never';
}

function shouldSkipGitRepoCheck(params: StreamChatParams): boolean {
  return params.skipGitRepoCheck === true || process.env.CTI_CODEX_SKIP_GIT_REPO_CHECK === 'true';
}

export function buildCodexTuiArgs(params: StreamChatParams, imagePaths: string[]): string[] {
  const args: string[] = [];
  const yoloMode = isYoloMode(params);
  const sandboxMode = yoloMode ? 'danger-full-access' : normalizeSandboxMode(params.sandboxMode) as CodexSandboxMode;
  const modelReasoningEffort = parseReasoningEffort(params.modelReasoningEffort) as CodexReasoningEffort | undefined;

  if (params.forceModel && params.model) args.push('--model', params.model);
  if (yoloMode) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  } else if (sandboxMode) {
    args.push('--sandbox', sandboxMode);
  }
  if (params.workingDirectory) args.push('--cd', params.workingDirectory);
  if (shouldSkipGitRepoCheck(params)) {
    args.push('--config', 'skip_git_repo_check=true');
  }
  if (!yoloMode) {
    args.push('--ask-for-approval', toApprovalPolicy(params.permissionMode));
  }
  if (modelReasoningEffort) {
    args.push('--config', `model_reasoning_effort="${modelReasoningEffort}"`);
  }
  if (typeof params.networkAccessEnabled === 'boolean') {
    args.push('--config', `sandbox_workspace_write.network_access=${params.networkAccessEnabled}`);
  }
  if (process.env.CTI_CODEX_BASE_URL) {
    args.push('--config', `openai_base_url="${process.env.CTI_CODEX_BASE_URL}"`);
  }
  for (const imagePath of imagePaths) {
    args.push('--image', imagePath);
  }
  if (params.codexThreadId) {
    args.push('resume', params.codexThreadId);
  }
  return args;
}

export async function injectPromptIntoTmuxPane(targetPane: string, prompt: string): Promise<void> {
  const lines = prompt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  console.log('[codex-tmux] Prompt inject start:', {
    target_pane: targetPane,
    prompt_chars: prompt.length,
    lines: lines.length,
    newline_key: 'M-Enter',
    submit_key: 'Enter',
  });
  const result = await tmuxCore.injectPromptIntoPane(targetPane, prompt);
  console.log('[codex-tmux] Prompt inject tmux commands:', {
    target_pane: targetPane,
    commands: result.commands,
  });
  console.log('[codex-tmux] Prompt inject submitted:', {
    target_pane: targetPane,
    prompt_chars: prompt.length,
    lines: lines.length,
  });
}

function walkJsonlFiles(dirPath: string, target: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walkJsonlFiles(entryPath, target);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      target.push(entryPath);
    }
  }
}

function snapshotSessionFiles(): SessionFileSnapshot {
  const files: string[] = [];
  walkJsonlFiles(getCodexSessionsRoot(), files);
  const snapshot: SessionFileSnapshot = new Map();
  for (const filePath of files) {
    try {
      const stat = fs.statSync(filePath);
      snapshot.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      // Ignore races with Codex moving or rotating files.
    }
  }
  return snapshot;
}

function readFirstLine(filePath: string): string {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const chunks: Buffer[] = [];
    const buffer = Buffer.alloc(4096);
    let offset = 0;
    while (offset < 1024 * 1024) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, offset);
      if (bytesRead <= 0) break;
      const slice = Buffer.from(buffer.subarray(0, bytesRead));
      chunks.push(slice);
      offset += bytesRead;
      if (slice.includes(0x0a)) break;
    }
    const combined = Buffer.concat(chunks).toString('utf-8');
    return combined.split(/\r?\n/, 1)[0] || '';
  } catch {
    return '';
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
  }
}

function parseSessionMeta(filePath: string): SessionMetaPreview | null {
  const firstLine = readFirstLine(filePath);
  if (!firstLine) return null;
  try {
    const parsed = JSON.parse(firstLine) as {
      type?: string;
      payload?: {
        id?: unknown;
        cwd?: unknown;
        originator?: unknown;
        source?: unknown;
      };
    };
    if (parsed.type !== 'session_meta' || typeof parsed.payload?.id !== 'string') return null;
    return {
      threadId: parsed.payload.id,
      cwd: typeof parsed.payload.cwd === 'string' ? parsed.payload.cwd : '',
      originator: typeof parsed.payload.originator === 'string' ? parsed.payload.originator : '',
      source: typeof parsed.payload.source === 'string' ? parsed.payload.source : '',
    };
  } catch {
    return null;
  }
}

function findSessionFileByThreadId(threadId: string): string | null {
  const files: string[] = [];
  walkJsonlFiles(getCodexSessionsRoot(), files);
  const candidates = files
    .filter((filePath) => path.basename(filePath).includes(threadId))
    .sort((left, right) => {
      try {
        return fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs;
      } catch {
        return 0;
      }
    });
  return candidates[0] || null;
}

function isLikelyTuiSession(meta: SessionMetaPreview, params: StreamChatParams): boolean {
  const originator = meta.originator.toLowerCase();
  const source = meta.source.toLowerCase();
  if (params.workingDirectory && meta.cwd) {
    const expected = path.resolve(params.workingDirectory).replace(/[\\/]+$/, '').toLowerCase();
    const actual = path.resolve(meta.cwd).replace(/[\\/]+$/, '').toLowerCase();
    if (expected !== actual) return false;
  }
  return originator.includes('codex-tui') || source === 'cli' || !originator;
}

function findUpdatedSessionFile(
  before: SessionFileSnapshot,
  params: StreamChatParams,
  startedAtMs: number,
): { filePath: string; threadId: string; startOffset: number } | null {
  if (params.codexThreadId) {
    const resumed = findSessionFileByThreadId(params.codexThreadId);
    if (resumed) {
      return {
        filePath: resumed,
        threadId: params.codexThreadId,
        startOffset: before.get(resumed)?.size || 0,
      };
    }
  }

  const files: string[] = [];
  walkJsonlFiles(getCodexSessionsRoot(), files);
  const candidates = files
    .map((filePath) => {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(filePath);
      } catch {
        return null;
      }
      const previous = before.get(filePath);
      const changed = !previous || stat.size !== previous.size || stat.mtimeMs !== previous.mtimeMs;
      if (!changed && stat.mtimeMs < startedAtMs - 5_000) return null;
      const meta = parseSessionMeta(filePath);
      if (!meta || !isLikelyTuiSession(meta, params)) return null;
      return {
        filePath,
        threadId: meta.threadId,
        mtimeMs: stat.mtimeMs,
        startOffset: previous ? previous.size : 0,
      };
    })
    .filter((item): item is { filePath: string; threadId: string; mtimeMs: number; startOffset: number } => Boolean(item))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return candidates[0]
    ? {
        filePath: candidates[0].filePath,
        threadId: candidates[0].threadId,
        startOffset: candidates[0].startOffset,
      }
    : null;
}

function recordToolName(record: CodexMirrorRecord): string {
  return record.toolName || 'tool';
}

function enqueueRecordAsSse(
  controller: ReadableStreamDefaultController<string>,
  context: TmuxRunContext,
  record: CodexMirrorRecord,
): void {
  if (context.emittedRecordSignatures.has(record.signature)) return;
  context.emittedRecordSignatures.add(record.signature);

  switch (record.type) {
    case 'task_started':
      context.terminalSeen = false;
      break;

    case 'reasoning':
      if (record.content) {
        controller.enqueue(sseEvent('status', { reasoning: record.content }));
      }
      break;

    case 'plan_update':
      controller.enqueue(sseEvent('task_update', {
        session_id: context.bridgeSessionId,
        codex_thread_id: context.threadId,
        tasks: record.tasks || [],
        todos: record.tasks || [],
      }));
      break;

    case 'context_usage':
      if (record.contextUsage) {
        controller.enqueue(sseEvent('context_usage', record.contextUsage));
      }
      break;

    case 'tool_started': {
      const toolId = record.toolId || record.signature;
      if (!context.emittedToolStarts.has(toolId)) {
        context.emittedToolStarts.add(toolId);
        controller.enqueue(sseEvent('tool_use', {
          id: toolId,
          name: recordToolName(record),
          input: {},
        }));
      }
      break;
    }

    case 'tool_finished': {
      const toolId = record.toolId || record.signature;
      if (!context.emittedToolStarts.has(toolId)) {
        context.emittedToolStarts.add(toolId);
        controller.enqueue(sseEvent('tool_use', {
          id: toolId,
          name: recordToolName(record),
          input: {},
        }));
      }
      controller.enqueue(sseEvent('tool_result', {
        tool_use_id: toolId,
        content: record.content || 'Done',
        is_error: record.isError === true,
      }));
      break;
    }

    case 'message':
      if (record.role === 'assistant' && record.content) {
        context.lastAssistantText = record.content;
        controller.enqueue(sseEvent('text', record.content));
      } else if (record.role === 'commentary' && record.content) {
        controller.enqueue(sseEvent('status', { reasoning: record.content }));
      }
      break;

    case 'task_complete':
      if (record.content && record.content !== context.lastAssistantText) {
        context.lastAssistantText = record.content;
        controller.enqueue(sseEvent('text', record.content));
      }
      context.terminalSeen = true;
      controller.enqueue(sseEvent('result', {
        ...(context.threadId ? { session_id: context.threadId } : {}),
      }));
      break;

    case 'task_aborted':
      context.terminalSeen = true;
      context.hasError = true;
      controller.enqueue(sseEvent('error', record.content || 'Codex task aborted.'));
      break;
  }
}

function buildTempImageFiles(params: StreamChatParams, tempFiles: string[]): string[] {
  const imageFiles = params.files?.filter((file) => file.type.startsWith('image/')) || [];
  const imagePaths: string[] = [];
  for (const file of imageFiles) {
    if (file.filePath && fs.existsSync(file.filePath)) {
      imagePaths.push(file.filePath);
      continue;
    }
    const ext = MIME_EXT[file.type] || '.png';
    const tmpPath = path.join(os.tmpdir(), `cti-tui-img-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    fs.writeFileSync(tmpPath, Buffer.from(file.data, 'base64'));
    tempFiles.push(tmpPath);
    imagePaths.push(tmpPath);
  }
  return imagePaths;
}

async function launchTmuxCodexSession(
  sessionName: string,
  params: StreamChatParams,
  imagePaths: string[],
): Promise<void> {
  const env = buildCodexTuiEnv();
  const codexArgs = buildCodexTuiArgs(params, imagePaths);
  const command = buildCodexTuiShellCommand('codex', codexArgs, env);

  console.log('[codex-tmux] Codex TUI start:', {
    bridge_session_id: params.sessionId,
    tmux_session: sessionName,
    command: commandPreview('codex', codexArgs.map((arg) => imagePaths.includes(arg) ? '<image-path:redacted>' : arg)),
    prompt_chars: params.prompt.length,
    cwd: params.workingDirectory || null,
    resume_thread_id: params.codexThreadId || null,
    debug_keep_tmux: isDebugTmuxKeepAlive(),
  });

  await tmuxCore.ensureDetachedSession({
    name: sessionName,
    cwd: params.workingDirectory,
    command,
    recreate: true,
  });
}

async function pollSessionFile(
  controller: ReadableStreamDefaultController<string>,
  params: StreamChatParams,
  context: TmuxRunContext,
  before: SessionFileSnapshot,
  startedAtMs: number,
): Promise<void> {
  const pollIntervalMs = parsePositiveIntEnv('CTI_CODEX_TMUX_POLL_INTERVAL_MS', DEFAULT_TMUX_POLL_INTERVAL_MS, 100);
  const fileTimeoutMs = parsePositiveIntEnv('CTI_CODEX_TMUX_SESSION_FILE_TIMEOUT_MS', DEFAULT_TMUX_SESSION_FILE_TIMEOUT_MS, 1_000);
  let sessionFileDeadline = Date.now() + fileTimeoutMs;

  while (!context.terminalSeen) {
    if (params.abortController?.signal.aborted) {
      break;
    }

    if (!context.sessionFilePath) {
      const found = findUpdatedSessionFile(before, params, startedAtMs);
      if (found) {
        context.sessionFilePath = found.filePath;
        context.threadId = found.threadId;
        context.nextOffset = found.startOffset;
        sessionFileDeadline = Date.now() + fileTimeoutMs;
        controller.enqueue(sseEvent('status', { session_id: found.threadId }));
      } else if (Date.now() > sessionFileDeadline) {
        throw new Error('Timed out waiting for Codex TUI session jsonl file.');
      }
    }

    if (context.sessionFilePath) {
      let size = context.nextOffset;
      try {
        size = fs.statSync(context.sessionFilePath).size;
      } catch {
        size = context.nextOffset;
      }
      if (size > context.nextOffset) {
        const delta = readCodexSessionMirrorRecordDeltaByFilePath(
          context.sessionFilePath,
          context.nextOffset,
          size,
          context.trailingText,
          context.nextTurnId,
          context.nextSpecialCallIds,
        );
        context.nextOffset = delta.nextOffset;
        context.trailingText = delta.trailingText;
        context.nextTurnId = delta.nextTurnId;
        context.nextSpecialCallIds = delta.nextSpecialCallIds;
        if (delta.unknownKinds.length > 0) {
          console.warn('[codex-tmux] Unhandled Codex TUI jsonl kinds:', delta.unknownKinds.join(', '));
        }
        for (const record of delta.records) {
          enqueueRecordAsSse(controller, context, record);
        }
      }
    }

    if (context.terminalSeen) break;
    if (!(await tmuxCore.hasSession(context.sessionName)).exists) {
      if (!context.hasError) {
        controller.enqueue(sseEvent('result', {
          ...(context.threadId ? { session_id: context.threadId } : {}),
        }));
      }
      break;
    }
    await sleep(pollIntervalMs);
  }
}

export function streamCodexTmuxTui(params: StreamChatParams): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      (async () => {
        const tempFiles: string[] = [];
        const sessionName = tmuxSessionName(params.sessionId);
        const targetPane = `${sessionName}:0.0`;
        const before = snapshotSessionFiles();
        const startedAtMs = Date.now();
        const context: TmuxRunContext = {
          sessionName,
          targetPane,
          bridgeSessionId: params.sessionId,
          threadId: params.codexThreadId,
          sessionFilePath: params.codexThreadId ? findSessionFileByThreadId(params.codexThreadId) || undefined : undefined,
          nextOffset: 0,
          trailingText: '',
          nextTurnId: null,
          nextSpecialCallIds: [],
          emittedToolStarts: new Set(),
          emittedRecordSignatures: new Set(),
          lastAssistantText: '',
          terminalSeen: false,
          hasError: false,
        };
        if (context.sessionFilePath) {
          context.nextOffset = before.get(context.sessionFilePath)?.size || 0;
        }

        try {
          const imagePaths = buildTempImageFiles(params, tempFiles);
          await launchTmuxCodexSession(sessionName, params, imagePaths);
          const promptDelayMs = parsePositiveIntEnv('CTI_CODEX_TMUX_PROMPT_DELAY_MS', DEFAULT_TMUX_PROMPT_DELAY_MS, 0);
          if (promptDelayMs > 0) await sleep(promptDelayMs);
          await injectPromptIntoTmuxPane(targetPane, params.prompt);
          await pollSessionFile(controller, params, context, before, startedAtMs);
          controller.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[codex-tmux] Error:', error instanceof Error ? error.stack || error.message : error);
          try {
            controller.enqueue(sseEvent('error', message || 'Codex TUI execution failed.'));
            controller.close();
          } catch {
            // Controller may already be closed.
          }
        } finally {
          for (const tmp of tempFiles) {
            try { fs.unlinkSync(tmp); } catch { /* ignore */ }
          }
          if (!isDebugTmuxKeepAlive()) {
            try { await tmuxCore.killSession(sessionName, { ignoreMissing: true }); } catch { /* best-effort cleanup */ }
          } else {
            console.log(`[codex-tmux] CTI_DEBUG is enabled; tmux session kept: ${sessionName}`);
          }
        }
      })();
    },
  });
}

export class CodexTmuxProvider implements LLMProvider {
  streamChat(params: StreamChatParams): ReadableStream<string> {
    return streamCodexTmuxTui(params);
  }
}
