import './test-setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  handleUiWeixinLoginApiRoute,
  handleUiWeixinLoginPageRoute,
} from '../ui/routes/weixin-login.js';
import type { Config, WeixinChannelConfig } from '../config.js';

function createResponse(): ServerResponse & { body: string; statusCodeWritten?: number } {
  return {
    body: '',
    writeHead(statusCode: number) {
      this.statusCodeWritten = statusCode;
      return this;
    },
    end(chunk?: unknown) {
      if (typeof chunk === 'string') this.body += chunk;
      else if (chunk instanceof Uint8Array) this.body += Buffer.from(chunk).toString('utf-8');
      return this;
    },
  } as ServerResponse & { body: string; statusCodeWritten?: number };
}

function createJsonRequest(body: unknown): IncomingMessage {
  return Object.assign(Readable.from([JSON.stringify(body)]), {
    method: 'POST',
  }) as IncomingMessage;
}

const baseConfig: Config = {
  runtime: 'codex',
  defaultMode: 'normal',
  enabledChannels: ['weixin'],
  channels: [{
    id: 'weixin-ops',
    alias: 'Ops',
    provider: 'weixin',
    enabled: true,
    createdAt: '2026-05-30T00:00:00.000Z',
    updatedAt: '2026-05-30T00:00:00.000Z',
    config: {
      baseUrl: 'https://weixin.example',
      cdnBaseUrl: 'https://cdn.example',
      mediaEnabled: true,
      feedbackMarkdownEnabled: true,
    },
  }],
};

function cloneConfig(config: Config): Config {
  return JSON.parse(JSON.stringify(config)) as Config;
}

describe('handleUiWeixinLoginPageRoute', () => {
  it('renders the popup page for authenticated access', () => {
    const response = createResponse();
    const handled = handleUiWeixinLoginPageRoute({
      request: { method: 'GET' } as IncomingMessage,
      response,
      url: new URL('http://localhost/weixin-login/session-123'),
      localRequest: false,
      allowLan: true,
      authenticated: true,
      renderAccessDeniedHtml: () => 'denied',
      renderLoginHtml: () => 'login',
    });

    assert.equal(handled, true);
    assert.equal(response.statusCodeWritten, 200);
    assert.match(response.body, /微信扫码登录/);
    assert.match(response.body, /session-123/);
  });

  it('asks unauthenticated remote users to log in', () => {
    const response = createResponse();
    const handled = handleUiWeixinLoginPageRoute({
      request: { method: 'GET' } as IncomingMessage,
      response,
      url: new URL('http://localhost/weixin-login/session-123'),
      localRequest: false,
      allowLan: true,
      authenticated: false,
      renderAccessDeniedHtml: () => 'denied',
      renderLoginHtml: () => 'login',
    });

    assert.equal(handled, true);
    assert.equal(response.body, 'login');
  });
});

describe('handleUiWeixinLoginApiRoute', () => {
  it('starts a web login session and stores the confirmed account on the channel', async () => {
    let config = cloneConfig(baseConfig);
    const response = createResponse();

    const handled = await handleUiWeixinLoginApiRoute({
      request: createJsonRequest({ channelId: 'weixin-ops' }),
      response,
      url: new URL('http://localhost/api/channels/weixin-login/start'),
      readConfig: () => config,
      writeConfig: (next) => {
        config = next;
      },
      startWebSession: async (options) => {
        const webOptions = options || {};
        await webOptions.onConfirmed?.('wx-account-1');
        return {
          id: 'session-123',
          channelId: webOptions.channelId,
          status: 'confirmed',
          startedAt: 1,
          refreshCount: 0,
          updatedAt: 2,
          qrSvg: '<svg></svg>',
          message: 'ok',
          accountId: 'wx-account-1',
        };
      },
    });

    assert.equal(handled, true);
    assert.equal(response.statusCodeWritten, 200);
    const weixin = config.channels?.[0]?.config as WeixinChannelConfig;
    assert.equal(weixin.accountId, 'wx-account-1');
    assert.equal(weixin.baseUrl, 'https://weixin.example');
    const body = JSON.parse(response.body) as { sessionId?: string; popupUrl?: string };
    assert.equal(body.sessionId, 'session-123');
    assert.equal(body.popupUrl, '/weixin-login/session-123');
  });

  it('returns confirmed session status with the latest config payload', async () => {
    const response = createResponse();
    const handled = await handleUiWeixinLoginApiRoute({
      request: { method: 'GET' } as IncomingMessage,
      response,
      url: new URL('http://localhost/api/channels/weixin-login/session-123'),
      readConfig: () => baseConfig,
      writeConfig: () => undefined,
      getWebSession: () => ({
        id: 'session-123',
        status: 'confirmed',
        startedAt: 1,
        refreshCount: 0,
        updatedAt: 2,
        qrSvg: '<svg></svg>',
        message: 'ok',
        accountId: 'wx-account-1',
      }),
    });

    assert.equal(handled, true);
    assert.equal(response.statusCodeWritten, 200);
    const body = JSON.parse(response.body) as { ok?: boolean; config?: { channels?: unknown[] } };
    assert.equal(body.ok, true);
    assert.equal(body.config?.channels?.length, 1);
  });

  it('preserves the legacy blocking login endpoint', async () => {
    let config = cloneConfig(baseConfig);
    const response = createResponse();

    const handled = await handleUiWeixinLoginApiRoute({
      request: createJsonRequest({ channelId: 'weixin-ops' }),
      response,
      url: new URL('http://localhost/api/channels/weixin-login'),
      readConfig: () => config,
      writeConfig: (next) => {
        config = next;
      },
      runLogin: async () => ({ accountId: 'wx-account-2', htmlPath: '/tmp/weixin-login.html' }),
    });

    assert.equal(handled, true);
    assert.equal(response.statusCodeWritten, 200);
    const weixin = config.channels?.[0]?.config as WeixinChannelConfig;
    assert.equal(weixin.accountId, 'wx-account-2');
    const body = JSON.parse(response.body) as { htmlPath?: string };
    assert.equal(body.htmlPath, '/tmp/weixin-login.html');
  });

  it('ignores routes owned by other UI modules', async () => {
    const response = createResponse();
    const handled = await handleUiWeixinLoginApiRoute({
      request: { method: 'GET' } as IncomingMessage,
      response,
      url: new URL('http://localhost/api/config'),
      readConfig: () => baseConfig,
      writeConfig: () => undefined,
    });

    assert.equal(handled, false);
    assert.equal(response.body, '');
  });
});
