import './test-setup.js';
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { CTI_HOME } from '../config.js';
import { runStartupStorageMigrations } from '../storage-migrations.js';

const DATA_DIR = path.join(CTI_HOME, 'data');
const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
const BINDINGS_PATH = path.join(DATA_DIR, 'bindings.json');
const CHANNEL_DEFAULT_TARGETS_PATH = path.join(DATA_DIR, 'channel-default-targets.json');
const UI_SESSION_META_PATH = path.join(DATA_DIR, 'ui-session-meta.json');

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

describe('runStartupStorageMigrations', () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.mkdirSync(DATA_DIR, { recursive: true });
  });

  it('migrates retired session thread fields to codex_thread_id', () => {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify({
      'session-1': {
        id: 'session-1',
        working_directory: '/tmp/old',
        model: 'gpt-old',
        sdk_session_id: 'sdk-thread-1',
        desktop_thread_id: 'codex-thread-1',
        thread_origin: 'desktop',
      },
      'session-2': {
        id: 'session-2',
        working_directory: '/tmp/current',
        model: 'gpt-current',
        codex_thread_id: 'codex-current',
        sdkSessionId: 'sdk-ignored',
      },
    }, null, 2));
    fs.writeFileSync(BINDINGS_PATH, JSON.stringify({}, null, 2));

    const result = runStartupStorageMigrations({
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      logger: false,
    });

    assert.equal(result.changed, true);
    const sessions = readJson(SESSIONS_PATH);
    assert.equal(sessions['session-1'].codex_thread_id, 'codex-thread-1');
    assert.equal(sessions['session-1'].sdk_session_id, undefined);
    assert.equal(sessions['session-1'].desktop_thread_id, undefined);
    assert.equal(sessions['session-1'].thread_origin, undefined);
    assert.equal(sessions['session-2'].codex_thread_id, 'codex-current');
    assert.equal(sessions['session-2'].sdkSessionId, undefined);
  });

  it('moves old binding thread identity onto the referenced session', () => {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify({
      'session-1': {
        id: 'session-1',
        working_directory: '/tmp/session',
        model: 'gpt-session',
      },
    }, null, 2));
    fs.writeFileSync(BINDINGS_PATH, JSON.stringify({
      'binding-1': {
        id: 'binding-1',
        channelType: 'feishu-default',
        chatId: 'chat-1',
        bridgeSessionId: 'session-1',
        sdkSessionId: 'thread-from-binding',
        workingDirectory: '/tmp/binding',
        model: 'gpt-binding',
        mode: 'normal',
        active: true,
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
      },
    }, null, 2));

    const result = runStartupStorageMigrations({ logger: false });

    assert.equal(result.changed, true);
    const sessions = readJson(SESSIONS_PATH);
    const bindings = readJson(BINDINGS_PATH);
    assert.equal(sessions['session-1'].codex_thread_id, 'thread-from-binding');
    assert.equal(bindings['binding-1'].bridgeSessionId, 'session-1');
    assert.equal(bindings['binding-1'].sdkSessionId, undefined);
    assert.equal(bindings['binding-1'].codex_thread_id, undefined);
  });

  it('creates a bridge session for old bindings that only stored a thread id', () => {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify({}, null, 2));
    fs.writeFileSync(BINDINGS_PATH, JSON.stringify({
      legacy: {
        id: 'legacy',
        channelType: 'feishu-default',
        chatId: 'chat-legacy',
        chatDisplayName: 'Legacy Chat',
        sdkSessionId: 'legacy-thread',
        workingDirectory: '/tmp/legacy',
        model: 'gpt-legacy',
        mode: 'yolo',
        active: true,
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
      },
    }, null, 2));

    const result = runStartupStorageMigrations({
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      logger: false,
    });

    assert.equal(result.createdSessions, 1);
    const sessions = readJson(SESSIONS_PATH);
    const bindings = readJson(BINDINGS_PATH);
    const sessionId = bindings.legacy.bridgeSessionId;
    assert.equal(typeof sessionId, 'string');
    assert.equal(sessions[sessionId].codex_thread_id, 'legacy-thread');
    assert.equal(sessions[sessionId].working_directory, '/tmp/legacy');
    assert.equal(sessions[sessionId].model, 'gpt-legacy');
    assert.equal(sessions[sessionId].preferred_mode, 'yolo');
    assert.equal(bindings.legacy.sdkSessionId, undefined);
  });

  it('is idempotent after the first migration pass', () => {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify({
      'session-1': {
        id: 'session-1',
        working_directory: '/tmp/session',
        model: 'gpt-session',
        sdk_session_id: 'thread-1',
      },
    }, null, 2));
    fs.writeFileSync(BINDINGS_PATH, JSON.stringify({}, null, 2));

    assert.equal(runStartupStorageMigrations({ logger: false }).changed, true);
    assert.equal(runStartupStorageMigrations({ logger: false }).changed, false);
  });

  it('folds ui-session-meta names into sessions and removes the old file', () => {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify({
      'session-1': {
        id: 'session-1',
        working_directory: '/tmp/session',
        model: 'gpt-session',
      },
      'session-2': {
        id: 'session-2',
        working_directory: '/tmp/codex',
        model: 'gpt-codex',
        codex_thread_id: 'codex-thread-1',
      },
    }, null, 2));
    fs.writeFileSync(BINDINGS_PATH, JSON.stringify({}, null, 2));
    fs.writeFileSync(UI_SESSION_META_PATH, JSON.stringify({
      'session:session-1': { name: 'Session Name' },
      'desktop:codex-thread-1': { name: 'Codex Name' },
      'desktop:codex-thread-2': { name: 'Codex Only Name' },
    }, null, 2));

    const result = runStartupStorageMigrations({
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      logger: false,
    });

    assert.equal(result.changed, true);
    assert.equal(result.migratedUiSessionNames, 1);
    assert.equal(result.createdSessions, 0);
    assert.equal(fs.existsSync(UI_SESSION_META_PATH), false);

    const sessions = readJson(SESSIONS_PATH);
    assert.equal(sessions['session-1'].name, 'Session Name');
    assert.equal(sessions['session-2'].name, undefined);
    const codexOnly = Object.values(sessions).find((session: any) => session.codex_thread_id === 'codex-thread-2') as any;
    assert.equal(codexOnly, undefined);
  });

  it('keeps only canonical channel default targets with bridgeSessionId', () => {
    fs.writeFileSync(SESSIONS_PATH, JSON.stringify({
      'session-1': {
        id: 'session-1',
        working_directory: '/tmp/session',
        model: 'gpt-session',
      },
      'session-2': {
        id: 'session-2',
        working_directory: '/tmp/codex',
        model: 'gpt-codex',
        codex_thread_id: 'codex-thread-1',
      },
    }, null, 2));
    fs.writeFileSync(BINDINGS_PATH, JSON.stringify({}, null, 2));
    fs.writeFileSync(CHANNEL_DEFAULT_TARGETS_PATH, JSON.stringify({
      'feishu-default': {
        id: 'default-1',
        channelType: 'feishu-default',
        bridgeSessionId: 'session-1',
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
      },
      'weixin-default': {
        id: 'default-2',
        channelType: 'weixin-default',
        createdAt: '2026-05-28T00:00:00.000Z',
        updatedAt: '2026-05-28T00:00:00.000Z',
      },
    }, null, 2));

    const result = runStartupStorageMigrations({
      now: () => new Date('2026-05-29T00:00:00.000Z'),
      logger: false,
    });

    assert.equal(result.changed, true);
    assert.equal(result.migratedChannelDefaultTargets, 1);
    assert.equal(result.createdSessions, 0);

    const targets = readJson(CHANNEL_DEFAULT_TARGETS_PATH);
    assert.equal(targets['feishu-default'].bridgeSessionId, 'session-1');
    assert.equal(targets['weixin-default'], undefined);
  });
});
