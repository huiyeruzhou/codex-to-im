import crypto from 'node:crypto';

import {
  isSupportedChannelProvider,
  type ChannelInstance,
  type Config,
} from '../../config.js';
import { listSelectableCodexModels, readConfiguredCodexModel } from '../../codex/models.js';

const availableCodexModels = listSelectableCodexModels();
const availableCodexModelSlugs = new Set(availableCodexModels.map((model) => model.slug));

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }
  return undefined;
}

function clampHistoryMessageLimit(value: unknown, fallback: number): number {
  const parsed = asPositiveInt(value);
  const base = parsed ?? fallback;
  return Math.min(Math.max(base, 1), 20);
}

function generateAccessToken(): string {
  return crypto.randomBytes(18).toString('base64url');
}

export function channelToPayload(channel: ChannelInstance) {
  return {
    id: channel.id,
    alias: channel.alias,
    provider: channel.provider,
    enabled: channel.enabled,
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    config: { ...channel.config },
  };
}

export function configToPayload(config: Config) {
  return {
    runtime: config.runtime,
    defaultWorkspaceRoot: config.defaultWorkspaceRoot || '',
    defaultModel: config.defaultModel || '',
    defaultProvider: config.defaultProvider || '',
    codexDefaultModel: readConfiguredCodexModel() || '',
    availableModels: availableCodexModels,
    defaultMode: config.defaultMode,
    historyMessageLimit: config.historyMessageLimit ?? 8,
    streamStatusIdleStartSeconds: config.streamStatusIdleStartSeconds ?? 180,
    streamStatusCheckIntervalSeconds: config.streamStatusCheckIntervalSeconds ?? 10,
    codexSkipGitRepoCheck: config.codexSkipGitRepoCheck === true,
    codexSandboxMode: config.codexSandboxMode || 'workspace-write',
    codexNetworkAccess: config.codexNetworkAccess !== false,
    codexReasoningEffort: config.codexReasoningEffort || 'medium',
    sdkToolCallDetailsInText: config.sdkToolCallDetailsInText !== false,
    uiAllowLan: config.uiAllowLan === true,
    uiAccessToken: config.uiAccessToken || '',
    channels: (config.channels || [])
      .filter((channel) => isSupportedChannelProvider(channel.provider))
      .map(channelToPayload),
  };
}

export function mergeConfig(current: Config, payload: Record<string, unknown>): Config {
  const rawDefaultModel = typeof payload.defaultModel === 'string'
    ? payload.defaultModel.trim()
    : undefined;
  const rawDefaultProvider = typeof payload.defaultProvider === 'string'
    ? payload.defaultProvider.trim().toLowerCase()
    : undefined;
  const uiAllowLan = payload.uiAllowLan === true;
  const requestedUiAccessToken = asString(payload.uiAccessToken);
  const uiAccessToken = requestedUiAccessToken
    || current.uiAccessToken
    || (uiAllowLan ? generateAccessToken() : undefined);

  return {
    ...current,
    runtime: 'codex',
    enabledChannels: current.enabledChannels,
    defaultWorkspaceRoot: asString(payload.defaultWorkspaceRoot),
    defaultModel: rawDefaultModel === undefined
      ? current.defaultModel
      : rawDefaultModel === ''
        ? undefined
        : availableCodexModelSlugs.has(rawDefaultModel)
          ? rawDefaultModel
          : current.defaultModel,
    defaultProvider: rawDefaultProvider === undefined
      ? current.defaultProvider
      : rawDefaultProvider === 'sdk' || rawDefaultProvider === 'tmux'
        ? rawDefaultProvider
        : undefined,
    defaultMode: payload.defaultMode === 'yolo' ? 'yolo' : 'normal',
    historyMessageLimit: clampHistoryMessageLimit(payload.historyMessageLimit, current.historyMessageLimit || 8),
    streamStatusIdleStartSeconds: asPositiveInt(payload.streamStatusIdleStartSeconds)
      || current.streamStatusIdleStartSeconds
      || 180,
    streamStatusCheckIntervalSeconds: asPositiveInt(payload.streamStatusCheckIntervalSeconds)
      || current.streamStatusCheckIntervalSeconds
      || 10,
    codexSkipGitRepoCheck: payload.codexSkipGitRepoCheck === true,
    codexSandboxMode: payload.codexSandboxMode === 'read-only'
      || payload.codexSandboxMode === 'workspace-write'
      || payload.codexSandboxMode === 'danger-full-access'
      ? payload.codexSandboxMode
      : 'workspace-write',
    codexNetworkAccess: payload.codexNetworkAccess !== false,
    codexReasoningEffort: payload.codexReasoningEffort === 'minimal'
      || payload.codexReasoningEffort === 'low'
      || payload.codexReasoningEffort === 'high'
      || payload.codexReasoningEffort === 'xhigh'
      ? payload.codexReasoningEffort
      : 'medium',
    sdkToolCallDetailsInText: payload.sdkToolCallDetailsInText !== false,
    uiAllowLan,
    uiAccessToken,
    channels: current.channels,
  };
}
