import { isCliOnlyCodexModel, readConfiguredCodexModel } from '../../../codex/models.js';
import {
  loadConfig,
  saveConfig,
  type CodexReasoningEffort,
  type CodexSandboxMode,
} from '../../../config.js';
import { parseSandboxMode } from '../../../runtime-options.js';
import * as router from '../channel-router.js';
import {
  normalizeReasoningEffort,
} from './aliases.js';
import {
  buildCommandFields,
  formatReasoningEffort,
} from './presentation.js';
import {
  formatDisplayedModel,
  getAvailableModelChoicesText,
  getCodexSessionByThreadIdSafe,
  getSelectableCodexModel,
  resolveDisplayedModel,
  resolveEffectiveNetworkAccess,
  resolveEffectiveReasoningEffort,
  resolveEffectiveSandboxMode,
} from '../bridge-session-support.js';
import type { BridgeSession, BridgeStore } from '../host.js';
import { parseMode } from '../security/validators.js';
import {
  codexTmuxSessionName,
  startCodexResumeTmuxSession,
} from '../tmux/runtime.js';
import { getCodexThreadId } from '../turns/turn-classifier.js';
import type { ChannelBinding, InboundMessage } from '../types.js';

const MODE_OPTIONS_TEXT = '可选：`normal`（普通执行，默认） `yolo`（跳过审批和沙箱）。兼容：`code` 等同于 `normal`。';
const CODEX_PROVIDER_OPTIONS_TEXT = '可选：`sdk`（默认 SDK 路径） `tmux`（Codex TUI/tmux 路径）';
const REASONING_OPTIONS_TEXT = '可选：`1=minimal` `2=low` `3=medium` `4=high` `5=xhigh`';
const SANDBOX_OPTIONS_TEXT = '可选：`read-only` `workspace-write` `danger-full-access` `default`（回到全局默认）';
const NETWORK_OPTIONS_TEXT = '可选：`on`/`true` 开启网络，`off`/`false` 关闭网络，`default` 回到全局默认。';
const UI_DETAIL_OPTIONS_TEXT = '可选：`on` 显示 SDK 工具输入输出，`off` 只显示工具名和状态、正文更接近 mirror；兼容 `/ui detail on|off`。';

export interface RuntimeSettingsCommandDeps {
  reconcileMirrorSubscriptions?(): Promise<void>;
}

function parseUiDetailArg(raw: string): boolean | null {
  const token = raw.trim().toLowerCase();
  if (!token) return null;
  if (token === 'on' || token === 'true' || token === '1' || token === 'yes' || token === 'detail' || token === 'details' || token === 'verbose') {
    return true;
  }
  if (token === 'off' || token === 'false' || token === '0' || token === 'no' || token === 'compact' || token === 'brief') {
    return false;
  }
  return null;
}

function formatUiDetailMode(enabled: boolean): string {
  return enabled ? '显示工具输入输出' : '只显示工具名、状态和正文';
}

function parseUiArgs(raw: string): { action: 'show' } | { action: 'set-details'; enabled: boolean } | null {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { action: 'show' };

  // Compatibility for the short-lived /tools on|off command: /tools resolves
  // here with only the on/off token as args.
  if (parts.length === 1) {
    const direct = parseUiDetailArg(parts[0]);
    if (direct !== null) return { action: 'set-details', enabled: direct };
  }

  const topic = parts[0]?.toLowerCase();
  if (
    topic === 'detail'
    || topic === 'details'
    || topic === 'tool'
    || topic === 'tools'
    || topic === 'sdk'
  ) {
    const enabled = parseUiDetailArg(parts.slice(1).join(' '));
    return enabled === null ? null : { action: 'set-details', enabled };
  }

  return null;
}

function parseNetworkAccessArg(raw: string): boolean | 'default' | null {
  const token = raw.trim().toLowerCase();
  if (!token) return null;
  if (token === 'default' || token === 'reset') return 'default';
  if (token === 'on' || token === 'true' || token === '1' || token === 'yes' || token === 'enable' || token === 'enabled') {
    return true;
  }
  if (token === 'off' || token === 'false' || token === '0' || token === 'no' || token === 'disable' || token === 'disabled') {
    return false;
  }
  return null;
}

export function formatNetworkAccess(enabled: boolean): string {
  return enabled ? 'enabled' : 'disabled';
}

function parseCodexProviderArg(raw: string): 'sdk' | 'tmux' | null {
  const token = raw.trim().toLowerCase();
  if (token === 'sdk' || token === 'tmux') return token;
  return null;
}

export function formatSessionMode(binding: ChannelBinding | null | undefined, session?: BridgeSession | null): string {
  return parseMode(binding?.mode || session?.preferred_mode || '') || 'normal';
}

export function formatSessionCodexProvider(session?: BridgeSession | null): string {
  return session?.codex_provider || 'default';
}

function isTmuxProviderSession(session?: BridgeSession | null): boolean {
  return session?.codex_provider === 'tmux';
}

function buildTmuxProviderModeBlockedResponse(markdown: boolean): string {
  return buildCommandFields(
    '当前是 tmux Provider',
    [],
    [
      '`/mode` 无法影响已经启动的 Codex TUI 终端。',
      '如需切换 yolo，请先发送 `/provider sdk` 退出 tmux Provider，再发送 `/m yolo`，然后重新发送 `/provider tmux`。',
    ],
    markdown,
  );
}

function buildTmuxProviderRuntimeOptionBlockedResponse(commandLabel: string, markdown: boolean): string {
  return buildCommandFields(
    '当前是 tmux Provider',
    [['命令', commandLabel]],
    [
      '这个设置无法影响已经启动的 Codex TUI 终端。',
      '请在 Codex TUI 里使用内置 slash 命令调整，或发送 `/provider sdk` 退出后重新配置再进入 tmux Provider。',
    ],
    markdown,
  );
}

async function reconcileMirrorSubscriptionsBestEffort(
  deps: RuntimeSettingsCommandDeps,
  context: string,
): Promise<void> {
  if (!deps.reconcileMirrorSubscriptions) return;
  try {
    await deps.reconcileMirrorSubscriptions();
  } catch (error) {
    console.error(`[runtime-settings-command] Mirror reconcile failed during ${context}:`, error);
  }
}

export function resolveLocalCodexThreadId(
  session: BridgeSession | null,
  binding: ChannelBinding,
  context: string,
): string | undefined {
  const threadId = getCodexThreadId(session, binding);
  if (!threadId) return undefined;
  return getCodexSessionByThreadIdSafe(threadId, context) ? threadId : undefined;
}

export function handleReasoningCommand(options: {
  args: string;
  binding: ChannelBinding | null;
  store: BridgeStore;
  markdown: boolean;
}): string {
  if (!options.binding) {
    return '当前聊天还没有绑定会话。先发送消息创建会话，或先用 `/t 1` 接管本地 Codex 会话。';
  }
  const session = options.store.getSession(options.binding.bridgeSessionId);
  if (!session) {
    return '当前会话不存在。';
  }
  if (!options.args) {
    return buildCommandFields(
      '当前思考级别',
      [['级别', formatReasoningEffort(resolveEffectiveReasoningEffort(session))]],
      [REASONING_OPTIONS_TEXT, '发送 `/r 4` 或 `/r high` 可切换。'],
      options.markdown,
    );
  }
  const reasoning = normalizeReasoningEffort(options.args);
  if (!reasoning) {
    return buildCommandFields(
      '思考级别用法',
      [['命令', '`/reasoning minimal|low|medium|high|xhigh`']],
      ['也支持完整命令：`/reasoning 1|2|3|4|5`', REASONING_OPTIONS_TEXT],
      options.markdown,
    );
  }
  options.store.updateSession(session.id, {
    reasoning_effort: reasoning as BridgeSession['reasoning_effort'],
  });
  return buildCommandFields(
    '已更新思考级别',
    [['级别', formatReasoningEffort(reasoning)]],
    [REASONING_OPTIONS_TEXT],
    options.markdown,
  );
}

export function handleModeCommand(options: {
  msg: InboundMessage;
  args: string;
  currentBinding: ChannelBinding | null;
  store: BridgeStore;
  markdown: boolean;
}): string {
  const binding = options.currentBinding || router.resolve(options.msg.address);
  const session = options.store.getSession(binding.bridgeSessionId);
  const mode = formatSessionMode(binding, session);
  if (!options.args) {
    return buildCommandFields(
      '当前模式',
      [
        ['模式', mode],
        ['Provider', formatSessionCodexProvider(session)],
      ],
      [MODE_OPTIONS_TEXT, '发送 `/m normal` 或 `/m yolo` 切换。完整命令也兼容：`/mode normal`。'],
      options.markdown,
    );
  }
  if (isTmuxProviderSession(session)) {
    return buildTmuxProviderModeBlockedResponse(options.markdown);
  }
  const requestedMode = parseMode(options.args);
  if (!requestedMode) {
    return buildCommandFields(
      '模式用法',
      [['命令', '`/mode normal|yolo`']],
      [MODE_OPTIONS_TEXT],
      options.markdown,
    );
  }
  if (session) {
    options.store.updateSession(session.id, {
      preferred_mode: requestedMode,
    });
  }
  router.updateBinding(binding.id, { mode: requestedMode });
  return buildCommandFields(
    '已切换模式',
    [
      ['模式', requestedMode],
      ['Provider', formatSessionCodexProvider(session)],
    ],
    [MODE_OPTIONS_TEXT],
    options.markdown,
  );
}

export async function handleProviderCommand(options: {
  msg: InboundMessage;
  args: string;
  currentBinding: ChannelBinding | null;
  store: BridgeStore;
  deps: RuntimeSettingsCommandDeps;
  markdown: boolean;
}): Promise<string> {
  const binding = options.currentBinding || router.resolve(options.msg.address);
  const session = options.store.getSession(binding.bridgeSessionId);
  if (!session) {
    return '当前会话不存在。';
  }
  if (!options.args) {
    return buildCommandFields(
      '当前 Codex Provider',
      [
        ['模式', formatSessionMode(binding, session)],
        ['Provider', formatSessionCodexProvider(session)],
      ],
      [CODEX_PROVIDER_OPTIONS_TEXT, '发送 `/provider sdk` 或 `/provider tmux` 切换；修改从下一轮 Codex 请求开始生效。'],
      options.markdown,
    );
  }
  const requestedProvider = parseCodexProviderArg(options.args);
  if (!requestedProvider) {
    return buildCommandFields(
      'Codex Provider 用法',
      [['命令', '`/provider sdk|tmux`']],
      [CODEX_PROVIDER_OPTIONS_TEXT],
      options.markdown,
    );
  }
  if (requestedProvider === 'sdk') {
    options.store.updateSession(session.id, {
      codex_provider: 'sdk',
    });
    await reconcileMirrorSubscriptionsBestEffort(options.deps, 'provider sdk switch');
    return buildCommandFields(
      '已切换 Codex Provider',
      [
        ['模式', formatSessionMode(binding, options.store.getSession(session.id))],
        ['Provider', 'sdk'],
      ],
      ['之后的普通消息会回到 SDK Provider；tmux 会话不会自动关闭。'],
      options.markdown,
    );
  }

  const threadId = getCodexThreadId(session, binding);
  if (!threadId) {
    return buildCommandFields(
      '无法进入 tmux Provider',
      [],
      ['当前会话还没有 codex_thread_id。请先用 SDK Provider 发送一条普通消息创建 Codex thread，再发送 `/provider tmux`。'],
      options.markdown,
    );
  }
  const mode = formatSessionMode(binding, session);
  const tmuxSessionName = codexTmuxSessionName(threadId);
  const startResult = await startCodexResumeTmuxSession({
    sessionName: tmuxSessionName,
    threadId,
    bridgeSessionId: session.id,
    workingDirectory: binding.workingDirectory || session.working_directory,
    sandboxMode: resolveEffectiveSandboxMode(session) as CodexSandboxMode,
    networkAccessEnabled: resolveEffectiveNetworkAccess(session),
    modelReasoningEffort: resolveEffectiveReasoningEffort(session) as CodexReasoningEffort,
    skipGitRepoCheck: (options.store.getSetting('bridge_codex_skip_git_repo_check') || '').toLowerCase() === 'true',
    codexMode: mode === 'yolo' ? 'yolo' : 'normal',
    permissionMode: mode === 'yolo' ? 'never' : 'acceptEdits',
  });
  options.store.updateSessionCodexThreadId(session.id, threadId);
  options.store.updateSession(session.id, {
    codex_provider: 'tmux',
    tmux_session_name: tmuxSessionName,
    tmux_auto_enter: true,
    codex_thread_id: threadId,
  });
  await reconcileMirrorSubscriptionsBestEffort(options.deps, 'provider tmux switch');
  return buildCommandFields(
    '已切换 Codex Provider',
    [
      ['模式', mode],
      ['Provider', 'tmux'],
      ['codex_thread_id', threadId],
      ['tmux session', tmuxSessionName],
      ['自动回车', 'on'],
    ],
    [
      startResult.existed
        ? '同名 tmux session 已存在，已先销毁并重新启动 Codex TUI。'
        : '已启动 Codex TUI 并 resume 当前 thread。',
      '之后普通消息会发送到这个 tmux session；回复由 mirror 机制从 Codex session JSONL 自动同步。',
    ],
    options.markdown,
  );
}

export function handleSandboxCommand(options: {
  msg: InboundMessage;
  args: string;
  currentBinding: ChannelBinding | null;
  store: BridgeStore;
  markdown: boolean;
}): string {
  const binding = options.currentBinding || router.resolve(options.msg.address);
  const session = options.store.getSession(binding.bridgeSessionId);
  if (!session) {
    return '当前会话不存在。';
  }
  if (!options.args) {
    return buildCommandFields(
      '当前 Codex 沙箱',
      [
        ['沙箱', resolveEffectiveSandboxMode(session)],
        ['来源', session.codex_sandbox_mode ? '当前会话' : '全局默认'],
      ],
      [SANDBOX_OPTIONS_TEXT, '发送 `/sandbox workspace-write` 可切换；修改从下一轮 Codex 请求开始生效。'],
      options.markdown,
    );
  }
  if (isTmuxProviderSession(session)) {
    return buildTmuxProviderRuntimeOptionBlockedResponse('`/sandbox`', options.markdown);
  }
  const requestedSandbox = options.args.trim().toLowerCase();
  if (requestedSandbox === 'default' || requestedSandbox === 'reset') {
    options.store.updateSession(session.id, { codex_sandbox_mode: undefined });
    return buildCommandFields(
      '已恢复默认 Codex 沙箱',
      [['沙箱', resolveEffectiveSandboxMode(options.store.getSession(session.id))]],
      ['当前会话将继续使用 Web 配置里的全局默认值；下一轮 Codex 请求生效。'],
      options.markdown,
    );
  }
  const sandboxMode = parseSandboxMode(requestedSandbox);
  if (!sandboxMode) {
    return buildCommandFields(
      'Codex 沙箱用法',
      [['命令', '`/sandbox read-only|workspace-write|danger-full-access|default`']],
      [SANDBOX_OPTIONS_TEXT],
      options.markdown,
    );
  }
  options.store.updateSession(session.id, { codex_sandbox_mode: sandboxMode });
  return buildCommandFields(
    '已更新 Codex 沙箱',
    [['沙箱', sandboxMode]],
    ['修改从下一轮 Codex 请求开始生效；正在运行的任务请先 `/stop` 后重发。'],
    options.markdown,
  );
}

export function handleNetworkCommand(options: {
  msg: InboundMessage;
  args: string;
  currentBinding: ChannelBinding | null;
  store: BridgeStore;
  markdown: boolean;
}): string {
  const binding = options.currentBinding || router.resolve(options.msg.address);
  const session = options.store.getSession(binding.bridgeSessionId);
  if (!session) {
    return '当前会话不存在。';
  }
  if (!options.args) {
    return buildCommandFields(
      '当前 Codex 网络',
      [
        ['网络', formatNetworkAccess(resolveEffectiveNetworkAccess(session))],
        ['来源', typeof session.codex_network_access === 'boolean' ? '当前会话' : '全局默认'],
      ],
      [NETWORK_OPTIONS_TEXT, '这个开关会传给 `sandbox_workspace_write.network_access`；下一轮 Codex 请求生效。'],
      options.markdown,
    );
  }
  if (isTmuxProviderSession(session)) {
    return buildTmuxProviderRuntimeOptionBlockedResponse('`/network`', options.markdown);
  }
  const networkAccess = parseNetworkAccessArg(options.args);
  if (networkAccess === null) {
    return buildCommandFields(
      'Codex 网络用法',
      [['命令', '`/network on|off|default`']],
      [NETWORK_OPTIONS_TEXT],
      options.markdown,
    );
  }
  if (networkAccess === 'default') {
    options.store.updateSession(session.id, { codex_network_access: undefined });
    return buildCommandFields(
      '已恢复默认 Codex 网络',
      [['网络', formatNetworkAccess(resolveEffectiveNetworkAccess(options.store.getSession(session.id)))]],
      ['当前会话将继续使用 Web 配置里的全局默认值；下一轮 Codex 请求生效。'],
      options.markdown,
    );
  }
  options.store.updateSession(session.id, { codex_network_access: networkAccess });
  return buildCommandFields(
    '已更新 Codex 网络',
    [['网络', formatNetworkAccess(networkAccess)]],
    ['修改从下一轮 Codex 请求开始生效；正在运行的任务请先 `/stop` 后重发。'],
    options.markdown,
  );
}

export function handleUiCommand(options: {
  args: string;
  markdown: boolean;
}): string {
  const currentConfig = loadConfig();
  const parsedUi = parseUiArgs(options.args);
  if (!parsedUi) {
    return buildCommandFields(
      'UI 显示设置用法',
      [['命令', '`/ui on|off`']],
      [UI_DETAIL_OPTIONS_TEXT],
      options.markdown,
    );
  }

  if (parsedUi.action === 'show') {
    return buildCommandFields(
      'UI 显示设置',
      [['SDK 工具详情', formatUiDetailMode(currentConfig.sdkToolCallDetailsInText !== false)]],
      [
        UI_DETAIL_OPTIONS_TEXT,
        '这是全局设置，会影响 SDK 对话文本预览/history，以及流式工具区是否展示工具输入输出；mirror 仍按 Codex JSONL 展示。',
      ],
      options.markdown,
    );
  }

  saveConfig({ ...currentConfig, sdkToolCallDetailsInText: parsedUi.enabled });
  return buildCommandFields(
    '已更新 UI 显示设置',
    [['SDK 工具详情', formatUiDetailMode(parsedUi.enabled)]],
    ['修改从下一轮 Codex 请求开始生效；正在运行的任务请先 `/stop` 后重发。'],
    options.markdown,
  );
}

export function handleModelCommand(options: {
  msg: InboundMessage;
  args: string;
  currentBinding: ChannelBinding | null;
  store: BridgeStore;
  markdown: boolean;
}): string {
  const binding = options.currentBinding || router.resolve(options.msg.address);
  const session = options.store.getSession(binding.bridgeSessionId);
  if (!session) {
    return '当前会话不存在。';
  }

  if (!options.args) {
    const codexThreadId = resolveLocalCodexThreadId(session, binding, 'model command');
    const currentModel = resolveDisplayedModel(
      binding,
      session,
      options.store.getSetting('default_model'),
      readConfiguredCodexModel(),
    );
    return buildCommandFields(
      '当前模型',
      [['模型', formatDisplayedModel(currentModel)]],
      [
        getAvailableModelChoicesText(),
        codexThreadId
          ? '当前是共享Codex thread，只支持查看模型；如需切换，请先用 `/new` 新建一个 IM 会话线程。'
          : '发送 `/model gpt-5.4` 可切换；发送 `/model default` 可回退到默认模型。',
        '模型切换只影响后续从 IM 发起的 Codex CLI 请求。',
      ],
      options.markdown,
    );
  }

  if (resolveLocalCodexThreadId(session, binding, 'model command update')) {
    return '当前是共享Codex thread，不支持直接切换模型。请先用 `/new` 新建一个线程，再执行 `/model ...`。';
  }

  const requestedModel = options.args.trim();
  if (requestedModel === 'default') {
    options.store.updateSessionModel(session.id, '');
    router.updateBinding(binding.id, { model: '' });
    const updatedBinding = router.resolve(options.msg.address);
    const updatedSession = options.store.getSession(updatedBinding.bridgeSessionId);
    const currentModel = resolveDisplayedModel(
      updatedBinding,
      updatedSession,
      options.store.getSetting('default_model'),
      readConfiguredCodexModel(),
    );
    return buildCommandFields(
      '已恢复默认模型',
      [['模型', formatDisplayedModel(currentModel)]],
      ['后续从 IM 发起的 Codex CLI 请求会跟随默认模型。'],
      options.markdown,
    );
  }

  const selectedModel = getSelectableCodexModel(requestedModel);
  if (!selectedModel) {
    return buildCommandFields(
      '模型用法',
      [['命令', '`/model <slug>`']],
      [
        getAvailableModelChoicesText(),
        '发送 `/model default` 可回退到默认模型。',
      ],
      options.markdown,
    );
  }

  options.store.updateSessionModel(session.id, selectedModel.slug);
  router.updateBinding(binding.id, { model: selectedModel.slug });
  return buildCommandFields(
    '已更新模型',
    [['模型', formatDisplayedModel(selectedModel.slug)]],
    [
      '后续从 IM 发起的 Codex CLI 请求会使用这个模型。',
      ...(isCliOnlyCodexModel(selectedModel)
        ? ['这是仅 IM/CLI 模型，只能在 IM -> Codex CLI 调用中使用，Codex Native 不支持。']
        : []),
    ],
    options.markdown,
  );
}
