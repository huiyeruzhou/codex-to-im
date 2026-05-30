import {
  feishuSiteToApiBaseUrl,
  findChannelInstance,
  isSupportedChannelProvider,
  normalizeFeishuSite,
  type ChannelInstance,
  type ChannelProvider,
  type Config,
  type FeishuChannelConfig,
  type FeishuSite,
  type WeixinChannelConfig,
} from '../../config.js';
import { normalizeChannelId } from '../../runtime-options.js';

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseCsv(value: unknown): string[] | undefined {
  const text = asString(value);
  if (!text) return undefined;
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeChannelAlias(value: string | undefined, provider: ChannelProvider): string {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  return provider === 'feishu' ? '飞书' : '微信';
}

function buildChannelId(provider: ChannelProvider, alias: string, takenIds: Set<string>, currentId?: string): string {
  const base = normalizeChannelId(`${provider}-${alias}`);
  if (!takenIds.has(base) || base === currentId) return base;
  let suffix = 2;
  while (takenIds.has(`${base}-${suffix}`) && `${base}-${suffix}` !== currentId) {
    suffix += 1;
  }
  return `${base}-${suffix}`;
}

function cloneChannel(channel: ChannelInstance): ChannelInstance {
  return {
    ...channel,
    config: { ...channel.config } as ChannelInstance['config'],
  };
}

function getWeixinAccountConflict(
  config: Config,
  accountId: string,
  currentChannelId?: string,
): ChannelInstance | undefined {
  return (config.channels || []).find((channel) => (
    channel.provider === 'weixin'
    && channel.id !== currentChannelId
    && (channel.config as WeixinChannelConfig).accountId === accountId
  ));
}

function assertWeixinAccountAvailable(
  config: Config,
  accountId: string | undefined,
  currentChannelId?: string,
): void {
  if (!accountId) return;
  const conflict = getWeixinAccountConflict(config, accountId, currentChannelId);
  if (!conflict) return;
  throw new Error(`微信账号 ${accountId} 已被通道 ${getChannelLabel(conflict)} 使用，请先解绑或改用其他账号。`);
}

export function getChannelLabel(channel: Pick<ChannelInstance, 'alias' | 'provider'>): string {
  const providerLabel = channel.provider === 'weixin' ? '微信' : '飞书';
  return channel.alias?.trim() ? `${channel.alias} · ${providerLabel}` : providerLabel;
}

export function getFeishuSite(channel: ChannelInstance): FeishuSite {
  const feishu = channel.config as FeishuChannelConfig;
  return normalizeFeishuSite(feishu.site);
}

export function getFeishuDomain(channel: ChannelInstance): string {
  return feishuSiteToApiBaseUrl(getFeishuSite(channel));
}

export function mergeChannelInstance(
  payload: Record<string, unknown>,
  current: Config,
): { config: Config; channel: ChannelInstance } {
  const provider = isSupportedChannelProvider(payload.provider) ? payload.provider : undefined;
  if (!provider) {
    throw new Error('通道提供方只能是飞书或微信。');
  }

  const existingId = asString(payload.id);
  const existing = existingId ? findChannelInstance(existingId, current) : undefined;
  const alias = normalizeChannelAlias(asString(payload.alias), provider);
  const baseChannels = (current.channels || []).map(cloneChannel);
  const takenIds = new Set(baseChannels.map((channel) => channel.id));
  const channelId = existing?.id || buildChannelId(provider, alias, takenIds);
  const now = new Date().toISOString();

  let nextConfig: FeishuChannelConfig | WeixinChannelConfig;
  if (provider === 'feishu') {
    nextConfig = {
      appId: asString(payload.appId),
      appSecret: asString(payload.appSecret),
      site: normalizeFeishuSite(asString(payload.site) || asString(payload.domain)),
      allowedUsers: parseCsv(payload.allowedUsers),
      streamingEnabled: payload.streamingEnabled !== false,
      feedbackMarkdownEnabled: payload.feedbackMarkdownEnabled !== false,
    };
  } else {
    const accountId = asString(payload.accountId);
    assertWeixinAccountAvailable(current, accountId, existing?.id);
    nextConfig = {
      accountId,
      baseUrl: asString(payload.baseUrl),
      cdnBaseUrl: asString(payload.cdnBaseUrl),
      mediaEnabled: payload.mediaEnabled === true,
      feedbackMarkdownEnabled: payload.feedbackMarkdownEnabled === true,
    };
  }

  const nextChannel: ChannelInstance = {
    id: channelId,
    alias,
    provider,
    enabled: payload.enabled !== false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    config: nextConfig,
  };

  const nextChannels = existing
    ? baseChannels.map((channel) => channel.id === existing.id ? nextChannel : channel)
    : [...baseChannels, nextChannel];

  return {
    config: {
      ...current,
      channels: nextChannels,
      enabledChannels: Array.from(new Set(nextChannels.filter((channel) => channel.enabled).map((channel) => channel.provider))),
    },
    channel: nextChannel,
  };
}

export function deleteChannelInstance(current: Config, channelId: string): Config {
  const channels = current.channels || [];
  const nextChannels = channels.filter((channel) => channel.id !== channelId);
  if (nextChannels.length === channels.length) {
    throw new Error('指定的通道不存在。');
  }

  return {
    ...current,
    channels: nextChannels,
    enabledChannels: Array.from(new Set(nextChannels.filter((channel) => channel.enabled).map((channel) => channel.provider))),
  };
}

export function mergeWeixinLoginAccount(
  current: Config,
  channel: ChannelInstance,
  accountId: string,
): { config: Config; channel: ChannelInstance } {
  if (channel.provider !== 'weixin') {
    throw new Error('指定的微信通道不存在。');
  }

  const weixin = channel.config as WeixinChannelConfig;
  return mergeChannelInstance({
    id: channel.id,
    provider: channel.provider,
    alias: channel.alias,
    enabled: channel.enabled,
    accountId,
    baseUrl: weixin.baseUrl,
    cdnBaseUrl: weixin.cdnBaseUrl,
    mediaEnabled: weixin.mediaEnabled === true,
    feedbackMarkdownEnabled: weixin.feedbackMarkdownEnabled === true,
  }, current);
}

export async function validateFeishuCredentials(channel: ChannelInstance): Promise<{ ok: boolean; message: string }> {
  const feishu = channel.config as FeishuChannelConfig;
  if (!feishu.appId || !feishu.appSecret) {
    return { ok: false, message: 'Feishu App ID / App Secret 不能为空。' };
  }

  const domain = getFeishuDomain(channel);
  const response = await fetch(`${domain}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: feishu.appId,
      app_secret: feishu.appSecret,
    }),
  });

  const data = await response.json() as { code?: number; msg?: string; tenant_access_token?: string };
  if (response.ok && data.code === 0 && data.tenant_access_token) {
    return { ok: true, message: '飞书凭据校验成功，tenant_access_token 已获取。' };
  }

  return {
    ok: false,
    message: `${getChannelLabel(channel)} 校验失败：${data.msg || `HTTP ${response.status}`}`,
  };
}
