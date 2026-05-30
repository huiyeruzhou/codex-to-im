import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  findChannelInstance,
  loadConfig,
  saveConfig,
  type Config,
  type WeixinChannelConfig,
} from '../../config.js';
import {
  buildWeixinLoginPopupHtml,
  getWeixinLoginWebSession,
  runWeixinLogin,
  startWeixinLoginWebSession,
  type WeixinLoginWebSessionState,
} from '../../weixin/login.js';
import {
  renderUiAccessDeniedHtml,
  renderUiLoginHtml,
} from './auth.js';
import { configToPayload } from '../application/config.js';
import { mergeWeixinLoginAccount } from '../application/channel.js';

type RunWeixinLogin = (config?: WeixinChannelConfig) => Promise<{ accountId: string; htmlPath: string }>;
type StartWeixinLoginWebSession = typeof startWeixinLoginWebSession;
type GetWeixinLoginWebSession = (sessionId: string) => WeixinLoginWebSessionState | undefined;

function json(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(body);
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8').trim();
  return raw ? JSON.parse(raw) as T : {} as T;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function getPathSuffix(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(prefix)) return undefined;
  const suffix = pathname.slice(prefix.length);
  return suffix ? decodeURIComponent(suffix) : undefined;
}

function saveWeixinLoginAccount(options: {
  readConfig: () => Config;
  writeConfig: (config: Config) => void;
  channelId: string;
  accountId: string;
}): void {
  const current = options.readConfig();
  const channel = findChannelInstance(options.channelId, current);
  if (!channel || channel.provider !== 'weixin') return;
  const merged = mergeWeixinLoginAccount(current, channel, options.accountId);
  options.writeConfig(merged.config);
}

export function handleUiWeixinLoginPageRoute(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  localRequest: boolean;
  allowLan: boolean;
  authenticated: boolean;
  renderAccessDeniedHtml?: () => string;
  renderLoginHtml?: () => string;
}): boolean {
  const {
    request,
    response,
    url,
    localRequest,
    allowLan,
    authenticated,
    renderAccessDeniedHtml = renderUiAccessDeniedHtml,
    renderLoginHtml = renderUiLoginHtml,
  } = options;

  const sessionId = request.method === 'GET'
    ? getPathSuffix(url.pathname, '/weixin-login/')
    : undefined;
  if (!sessionId) return false;

  if (!localRequest) {
    if (!allowLan) {
      html(response, renderAccessDeniedHtml());
      return true;
    }
    if (!authenticated) {
      html(response, renderLoginHtml());
      return true;
    }
  }

  html(response, buildWeixinLoginPopupHtml(sessionId));
  return true;
}

export async function handleUiWeixinLoginApiRoute(options: {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  readConfig?: () => Config;
  writeConfig?: (config: Config) => void;
  runLogin?: RunWeixinLogin;
  startWebSession?: StartWeixinLoginWebSession;
  getWebSession?: GetWeixinLoginWebSession;
}): Promise<boolean> {
  const {
    request,
    response,
    url,
    readConfig = loadConfig,
    writeConfig = saveConfig,
    runLogin = runWeixinLogin,
    startWebSession = startWeixinLoginWebSession,
    getWebSession = getWeixinLoginWebSession,
  } = options;

  if (request.method === 'POST' && url.pathname === '/api/channels/weixin-login') {
    const payload = await readJsonBody<Record<string, unknown>>(request);
    const channelId = asString(payload.channelId);
    const current = readConfig();
    const channel = channelId ? findChannelInstance(channelId, current) : undefined;
    const loginConfig = channel?.provider === 'weixin'
      ? channel.config as WeixinChannelConfig
      : {};
    const result = await runLogin(loginConfig);

    if (channelId && channel && channel.provider === 'weixin') {
      const merged = mergeWeixinLoginAccount(current, channel, result.accountId);
      writeConfig(merged.config);
    }

    json(response, 200, {
      ok: true,
      message: `微信扫码成功，账号 ${result.accountId} 已保存。`,
      htmlPath: result.htmlPath,
      config: configToPayload(readConfig()),
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/channels/weixin-login/start') {
    const payload = await readJsonBody<Record<string, unknown>>(request);
    const channelId = asString(payload.channelId);
    if (!channelId) {
      json(response, 400, { error: 'channelId 不能为空。' });
      return true;
    }

    const current = readConfig();
    const channel = findChannelInstance(channelId, current);
    if (!channel || channel.provider !== 'weixin') {
      json(response, 404, { error: '指定的微信通道不存在。' });
      return true;
    }

    const session = await startWebSession({
      channelId: channel.id,
      config: channel.config as WeixinChannelConfig,
      onConfirmed: async (accountId) => {
        saveWeixinLoginAccount({
          readConfig,
          writeConfig,
          channelId: channel.id,
          accountId,
        });
      },
    });

    json(response, 200, {
      ok: true,
      sessionId: session.id,
      popupUrl: `/weixin-login/${encodeURIComponent(session.id)}`,
      message: '微信扫码窗口已打开，请在弹窗中完成扫码。',
    });
    return true;
  }

  const statusSessionId = request.method === 'GET'
    ? getPathSuffix(url.pathname, '/api/channels/weixin-login/')
    : undefined;
  if (statusSessionId) {
    const session = getWebSession(statusSessionId);
    if (!session) {
      json(response, 404, { error: '微信扫码会话不存在或已过期。' });
      return true;
    }

    json(response, 200, {
      ok: true,
      session,
      config: session.status === 'confirmed' ? configToPayload(readConfig()) : undefined,
    });
    return true;
  }

  return false;
}
