import fs from 'node:fs';
import path from 'node:path';

import { loadConfig, saveConfig } from '../../../config.js';
import { readConfiguredCodexModel } from '../../../codex/models.js';
import {
  readCodexSessionMessagesByFilePath,
} from '../../../codex/session-index.js';
import { listBindingsForChat } from '../session-registry.js';
import {
  buildCommandFields,
  formatCommandPath,
  formatHistoryRole,
  formatMirrorStatus,
  formatReasoningEffort,
  formatRuntimeStatus,
  formatStoredMessageContent,
  truncateHistoryContent,
} from './presentation.js';
import {
  buildHealthCommandResponse,
  buildHealthListResponse,
} from './diagnostics-presentation.js';
import { deliverResponse } from '../feedback-delivery.js';
import type { BaseChannelAdapter } from '../channel-adapter.js';
import type { BridgeSession, BridgeStore } from '../host.js';
import { buildFencedCodeBlock } from '../markdown/fence.js';
import { sanitizeInput } from '../security/validators.js';
import type { CommandThreadDisplay } from './thread-display.js';
import { getCodexThreadId } from '../turns/turn-classifier.js';
import type { ChannelBinding, InboundMessage, OutboundAttachment } from '../types.js';
import {
  formatDisplayedModel,
  getCodexSessionByThreadIdSafe,
  getHistoryMessageLimit,
  resolveDisplayedModel,
  resolveEffectiveNetworkAccess,
  resolveEffectiveReasoningEffort,
  resolveEffectiveSandboxMode,
} from '../bridge-session-support.js';
import {
  formatNetworkAccess,
  formatSessionCodexProvider,
  formatSessionMode,
  resolveLocalCodexThreadId,
} from './runtime-settings.js';
import { stripLegacySessionPrefix } from '../display/session-title.js';

export interface DiagnosticsCommandDeps {
  diagnoseSessionHealth(sessionId: string): Promise<import('../session-health-runtime.js').SessionHealthDiagnosis | null>;
  diagnoseAllActiveSessions(): Promise<import('../session-health-runtime.js').SessionHealthDiagnosis[]>;
}

function parseHistoryLimitArg(raw: string): number | null {
  const token = raw.trim();
  if (!/^\d+$/.test(token)) return null;
  const parsed = Number(token);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 20) return null;
  return parsed;
}

function resolveHistorySessionFile(
  session: BridgeSession | null,
  binding: ChannelBinding,
): { filePath: string; fileName: string; threadId: string; title: string | null } | null {
  const candidates = [
    getCodexThreadId(session, binding),
  ].filter((value): value is string => !!value?.trim());
  const uniqueThreadIds = Array.from(new Set(candidates));

  for (const threadId of uniqueThreadIds) {
    const codexSession = getCodexSessionByThreadIdSafe(threadId, 'history lookup');
    if (!codexSession?.filePath) continue;
    try {
      const stat = fs.statSync(codexSession.filePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    return {
      filePath: codexSession.filePath,
      fileName: path.basename(codexSession.filePath),
      threadId,
      title: session?.codex_title || codexSession.title || null,
    };
  }

  return null;
}

function buildHistoryMessagesCard(
  messages: Array<{ role: string; content: string }>,
  options: {
    title: string;
    source: string;
    limit: number;
    markdown: boolean;
  },
): string {
  const header = buildCommandFields(
    '最近对话（msg）',
    [
      ['标题', options.title],
      ['来源', options.source],
      ['返回条数', `${messages.length} / 配置 ${options.limit}`],
    ],
    ['`/his raw` 查看解析后的纯文本视图；`/his json` 直接发送原始 session JSONL 文件；`/his limit 12` 修改返回条数。'],
    options.markdown,
  );

  const body = messages.map((message, index) => {
    const role = formatHistoryRole(message.role);
    const content = truncateHistoryContent(formatStoredMessageContent(message.content));
    if (options.markdown) {
      return `### ${index + 1}. ${role}\n\n${buildFencedCodeBlock(content, 'text')}`;
    }
    return `${index + 1}. ${role}\n${content}`;
  }).join('\n\n');

  return [header, body].join('\n\n').trim();
}

export async function handleHealthCommand(options: {
  args: string;
  binding: ChannelBinding | null;
  deps: DiagnosticsCommandDeps;
  markdown: boolean;
}): Promise<string> {
  const args = options.args.trim();
  if (args === 'all') {
    const diagnoses = await options.deps.diagnoseAllActiveSessions();
    return diagnoses.length > 0
      ? buildHealthListResponse(diagnoses, options.markdown)
      : '当前没有检测到运行中的会话。';
  }

  const explicitTargetSessionId = args;
  const targetSessionId = explicitTargetSessionId || options.binding?.bridgeSessionId;
  if (!targetSessionId) {
    return '当前聊天还没有绑定会话。先发送消息创建会话，或先用 `/t 1` 接管本地 Codex 会话。';
  }
  const diagnosis = await options.deps.diagnoseSessionHealth(targetSessionId);
  if (!diagnosis) {
    return `没有找到会话 ${targetSessionId}。`;
  }
  return buildHealthCommandResponse(
    explicitTargetSessionId ? '指定会话健康检查' : '当前会话健康检查',
    diagnosis,
    options.markdown,
  );
}

export function handleCurrentCommand(options: {
  msg: InboundMessage;
  binding: ChannelBinding | null;
  store: BridgeStore;
  threadDisplay: CommandThreadDisplay;
  markdown: boolean;
}): string {
  const binding = options.binding;
  if (!binding) {
    return buildCommandFields(
      '当前会话',
      [],
      ['当前聊天还没有绑定会话。可先发送 `/t` 查看最近本地 Codex 会话，再用 `/t 1` 接管；或发送 `/new proj1` / `/new 绝对路径` 创建项目会话。'],
      options.markdown,
    );
  }

  const session = options.store.getSession(binding.bridgeSessionId);
  if (!session) {
    return buildCommandFields(
      '当前会话',
      [
        ['Session', binding.bridgeSessionId],
        ['codex-thread-id', '-'],
        ['目录', formatCommandPath(binding.workingDirectory)],
      ],
      ['当前聊天绑定的会话已经不存在。可用 `/t` 接管本地 Codex 会话，或用 `/new proj1` / `/new 绝对路径` 创建新会话。'],
      options.markdown,
    );
  }

  const codexThreadId = getCodexThreadId(session, binding);
  const localCodexThreadId = resolveLocalCodexThreadId(session, binding, 'current command');
  const threadInfo = options.threadDisplay.binding(binding);
  const codexTitle = session.codex_title?.trim()
    || (codexThreadId ? getCodexSessionByThreadIdSafe(codexThreadId, 'current codex title')?.title : '')
    || '';
  const sessionName = session.name?.trim() ? stripLegacySessionPrefix(session.name) : '';
  const sandboxMode = resolveEffectiveSandboxMode(session);
  const networkAccess = resolveEffectiveNetworkAccess(session);
  const reasoningEffort = resolveEffectiveReasoningEffort(session);
  const currentModel = resolveDisplayedModel(
    binding,
    session,
    options.store.getSetting('default_model'),
    readConfiguredCodexModel(),
  );
  const chatBindingCount = listBindingsForChat(options.store, options.msg.address.channelType, options.msg.address.chatId).length;
  const sessionKind = session?.session_type === 'draft'
    ? '临时草稿线程'
    : '普通会话';
  return buildCommandFields(
    '当前会话',
    [
      ['标题', threadInfo.title],
      ['name', sessionName || '-'],
      ['codex_title', codexTitle || '-'],
      ['codex-thread-id', codexThreadId || '-'],
      ['当前 binding', options.threadDisplay.bindingShortId(binding)],
      ['聊天绑定数', `${chatBindingCount}`],
      ['目录', formatCommandPath(binding.workingDirectory)],
      ['模式', formatSessionMode(binding, session)],
      ['Provider', formatSessionCodexProvider(session)],
      ['当前模型', formatDisplayedModel(currentModel)],
      ['类型', sessionKind],
      ['运行状态', formatRuntimeStatus(session)],
      ['共享镜像', formatMirrorStatus(session)],
      ['文件系统权限', sandboxMode],
      ['网络访问', formatNetworkAccess(networkAccess)],
      ['思考级别', formatReasoningEffort(reasoningEffort)],
    ],
    [
      localCodexThreadId
        ? '当前聊天已绑定到一条共享会话，直接发送消息即可继续。'
        : session?.session_type === 'draft'
          ? '当前聊天正在使用临时草稿线程（等同 `/t 0`）。可直接发送消息，或用 `/t` / `/new proj1` / `/new 绝对路径` 切换到正式会话。'
          : '当前聊天正在使用 IM 会话。可直接发送消息继续；如需接管本地 Codex 会话，可先发送 `/t`，再用 `/t 1` 接管。',
      '发送 `/t ls` 可查看这个聊天绑定的全部线程。',
    ],
    options.markdown,
  );
}

export async function handleHistoryCommand(options: {
  adapter: BaseChannelAdapter;
  msg: InboundMessage;
  args: string;
  binding: ChannelBinding | null;
  store: BridgeStore;
  threadDisplay: CommandThreadDisplay;
  markdown: boolean;
}): Promise<string> {
  const historyParts = options.args.trim().split(/\s+/).filter(Boolean);
  const historyArg = (historyParts[0] || '').toLowerCase();
  if (historyArg === 'limit' || historyArg === 'n') {
    const nextLimit = parseHistoryLimitArg(historyParts[1] || '');
    if (!nextLimit || historyParts.length > 2) {
      return [
        '用法：/his limit <1-20>',
        '示例：/his limit 12',
        `当前配置：${getHistoryMessageLimit()}`,
      ].join('\n');
    }
    try {
      const currentConfig = loadConfig();
      saveConfig({ ...currentConfig, historyMessageLimit: nextLimit });
      return `已将 /his msg 返回条数限制设置为 ${nextLimit}。`;
    } catch (error) {
      return `修改失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  if (!options.binding) {
    return '当前聊天还没有绑定会话。先发送消息创建会话，或先用 `/t 1` 接管本地 Codex 会话。';
  }

  if (historyArg && historyArg !== 'msg' && historyArg !== 'raw' && historyArg !== 'json' && historyArg !== 'file') {
    return [
      '用法：/his [msg|raw|json|limit <1-20>]',
      '示例：',
      '- /his msg',
      '- /his',
      '- /his raw',
      '- /his json',
      '- /his limit 12',
    ].join('\n');
  }

  const limit = getHistoryMessageLimit();
  const session = options.store.getSession(options.binding.bridgeSessionId);
  const sessionFile = resolveHistorySessionFile(session, options.binding);

  if (historyArg === 'json' || historyArg === 'file') {
    if (!sessionFile) {
      return '当前会话没有可直接发送的 Codex session JSONL 文件。只有已落盘到 Codex session 文件的线程才能使用 `/his json`。';
    }
    const attachment: OutboundAttachment = {
      kind: 'file',
      path: sessionFile.filePath,
      name: sessionFile.fileName,
    };
    const result = await deliverResponse(
      options.adapter,
      options.msg.address,
      '',
      options.binding.bridgeSessionId,
      options.msg.messageId,
      [attachment],
    );
    return result.ok ? '' : `发送失败：${result.error || '未知错误'}`;
  }

  const codexMessages = sessionFile
    ? readCodexSessionMessagesByFilePath(sessionFile.filePath, limit)
    : [];
  const { messages: storedMessages } = options.store.getMessages(options.binding.bridgeSessionId, { limit });
  const messages = codexMessages.length > 0 ? codexMessages : storedMessages;
  if (messages.length === 0) {
    return '当前会话还没有历史消息。';
  }
  const threadTitle = options.threadDisplay.binding(options.binding).title;
  const messageSource = codexMessages.length > 0 ? 'Codex session JSONL' : 'Bridge 缓存';

  if (historyArg === 'msg') {
    return buildHistoryMessagesCard(messages, {
      title: threadTitle,
      source: messageSource,
      limit,
      markdown: options.markdown,
    });
  }

  const header = buildCommandFields(
    '最近对话（解析文本）',
    [
      ['标题', threadTitle],
      ['来源', messageSource],
      ['返回条数', `${messages.length} / 配置 ${limit}`],
    ],
    historyArg === 'raw'
      ? []
      : ['`/his msg` 查看卡片版消息；`/his raw` 查看解析后的纯文本视图；`/his json` 直接发送原始 session JSONL 文件；`/his limit 12` 修改返回条数。'],
    options.markdown,
  );
  const body = messages.map((message, index) => {
    if (options.markdown) {
      return `${index + 1}. **${formatHistoryRole(message.role)}**\n\n${truncateHistoryContent(formatStoredMessageContent(message.content))}`;
    }
    return `${index + 1}. ${formatHistoryRole(message.role)}\n${truncateHistoryContent(formatStoredMessageContent(message.content))}`;
  }).join('\n\n');
  return [header, body].join('\n\n').trim();
}

export function handleCatCommand(options: {
  args: string;
  binding: ChannelBinding;
  markdown: boolean;
}): string {
  const parts = options.args.split(/\s+/).filter(Boolean);
  const rawPath = parts[0] || '';
  if (!rawPath) {
    return '用法：/cat <path> [start_line] [end_line]\n示例：/cat README.md 1 200';
  }
  const hasAbs = path.isAbsolute(rawPath) || path.win32.isAbsolute(rawPath);
  if (!hasAbs && !options.binding.workingDirectory) {
    return '当前会话没有工作目录，请使用绝对路径。';
  }
  const resolvedPath = hasAbs ? rawPath : path.resolve(options.binding.workingDirectory, rawPath);
  let startLine = 1;
  let endLine = 200;
  const maybeStart = parts[1];
  const maybeEnd = parts[2];
  if (maybeStart && /^\d+$/.test(maybeStart) && maybeEnd && /^\d+$/.test(maybeEnd)) {
    startLine = Math.max(1, parseInt(maybeStart, 10));
    endLine = Math.max(startLine, parseInt(maybeEnd, 10));
  } else if (maybeStart && /^\d+$/.test(maybeStart)) {
    endLine = Math.max(1, parseInt(maybeStart, 10));
  }
  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      return '目标不是文件。';
    }
    const raw = fs.readFileSync(resolvedPath, 'utf-8');
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    const slice = lines.slice(startLine - 1, endLine);
    const slicedText = slice.join('\n');
    const { text: safeText, truncated } = sanitizeInput(slicedText, 12_000);
    const suffix = truncated || lines.length > endLine ? '\n\n（内容过长已截断）' : '';
    return options.markdown
      ? `**${path.basename(resolvedPath)}**\n\n${buildFencedCodeBlock(safeText, 'text')}${suffix}`
      : `${path.basename(resolvedPath)}\n\n${safeText}${suffix}`;
  } catch (error) {
    return `读取文件失败：${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function handleFileCommand(options: {
  adapter: BaseChannelAdapter;
  msg: InboundMessage;
  args: string;
  binding: ChannelBinding;
}): Promise<string> {
  const rawPath = options.args.trim();
  if (!rawPath) {
    return '用法：/file <path>\n示例：/file report.txt';
  }
  const hasAbs = path.isAbsolute(rawPath) || path.win32.isAbsolute(rawPath);
  if (!hasAbs && !options.binding.workingDirectory) {
    return '当前会话没有工作目录，请使用绝对路径。';
  }
  const resolvedPath = hasAbs ? rawPath : path.resolve(options.binding.workingDirectory, rawPath);
  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile()) {
      return '目标不是文件。';
    }
    if (stat.size > 20 * 1024 * 1024) {
      return `文件过大（${stat.size} bytes），暂不支持通过 /file 发送。`;
    }
    const attachment: OutboundAttachment = {
      kind: 'file',
      path: resolvedPath,
      name: path.basename(resolvedPath),
    };
    const result = await deliverResponse(
      options.adapter,
      options.msg.address,
      '',
      options.binding.bridgeSessionId,
      options.msg.messageId,
      [attachment],
    );
    return result.ok ? `已发送文件：${path.basename(resolvedPath)}` : `发送失败：${result.error || '未知错误'}`;
  } catch (error) {
    return `读取文件失败：${error instanceof Error ? error.message : String(error)}`;
  }
}
