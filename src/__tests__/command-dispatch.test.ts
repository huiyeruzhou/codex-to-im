import './test-setup.js';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { CONFIG_PATH, CONFIG_V2_PATH, CTI_HOME, loadConfig } from '../config.js';
import { JsonFileStore } from '../store.js';
import { initBridgeContext } from '../lib/bridge/context.js';
import { handleBridgeCommand } from '../lib/bridge/command.js';
import { buildCommandCallbackData, parseCommandCallbackData } from '../lib/bridge/command-callbacks.js';
import * as router from '../lib/bridge/channel-router.js';
import { getThreadTableMessageRecord } from '../lib/bridge/command/thread-table-message-pins.js';
import { listAutoTasks } from '../lib/bridge/auto-tasks.js';
import {
  buildCodexSandboxArgs,
  detectCodexSandboxCliStyleFromHelp,
  parseShellCommandArgs,
  resolveCodexCliExecutable,
} from '../lib/bridge/command/shell.js';
import { writeCodexSessionJsonlFixture } from './test-bridge-utils.js';
import type { OutboundRichCard } from '../lib/bridge/types.js';
import type { HotUpdateRunRequest } from '../lib/bridge/command/hot-update.js';

const DATA_DIR = path.join(CTI_HOME, 'data');

function makeSettings(): Map<string, string> {
  return new Map([
    ['remote_bridge_enabled', 'true'],
    ['bridge_default_model', 'test-model'],
    ['bridge_default_mode', 'code'],
    ['bridge_channel_instances_json', JSON.stringify([
      { id: 'feishu', provider: 'feishu', enabled: true, alias: '飞书', config: {} },
      { id: 'feishu-default', provider: 'feishu', enabled: true, alias: '飞书', config: {} },
    ])],
  ]);
}

const noopLlm = {
  streamChat(): ReadableStream<string> {
    return new ReadableStream({
      start(controller) {
        controller.close();
      },
    });
  },
};

function initTestContext(options: { dynamicSettings?: boolean } = {}): JsonFileStore {
  const store = new JsonFileStore(makeSettings(), { dynamicSettings: options.dynamicSettings });
  initBridgeContext({
    store,
    llm: noopLlm,
    permissions: { resolvePendingPermission: () => false },
    lifecycle: {},
  });
  return store;
}

function readAuditSummaries(): string[] {
  const auditPath = path.join(DATA_DIR, 'audit.json');
  if (!fs.existsSync(auditPath)) return [];
  const parsed = JSON.parse(fs.readFileSync(auditPath, 'utf-8')) as Array<{ summary?: string }>;
  return parsed.map((entry) => entry.summary || '');
}

function installFakeTmux(): { binDir: string; logPath: string } {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-fake-tmux-'));
  const logPath = path.join(binDir, 'tmux.log');
  const tmuxPath = path.join(binDir, 'tmux');
  fs.writeFileSync(logPath, '', 'utf-8');
  fs.writeFileSync(tmuxPath, `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TMUX_FAKE_LOG"
case "$1" in
  list-sessions)
    printf 'alpha\\t1\\t0\\t0\\t0\\n'
    printf 'beta\\t2\\t1\\t0\\t0\\n'
    exit 0
    ;;
  has-session)
    target="$3"
    if [[ "$target" == "alpha" || "$target" == "beta" ]]; then
      exit 0
    fi
    exit 1
    ;;
  new-session)
    exit 0
    ;;
  send-keys)
    exit 0
    ;;
  capture-pane)
    printf 'alpha-screen\\n$ pwd\\n/repo\\n'
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`, 'utf-8');
  fs.chmodSync(tmuxPath, 0o755);
  return { binDir, logPath };
}

describe('command-dispatch', () => {
  beforeEach(() => {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
    fs.rmSync(CONFIG_PATH, { force: true });
    fs.rmSync(CONFIG_V2_PATH, { force: true });
  });

  it('round-trips interactive command callback data', () => {
    const callbackData = buildCommandCallbackData('/stop', 'session-1');
    assert.deepEqual(parseCommandCallbackData(callbackData), {
      commandText: '/stop',
      scopeSessionId: 'session-1',
    });
    assert.equal(parseCommandCallbackData('perm:allow:1'), undefined);
    assert.equal(parseCommandCallbackData('cti-command::not-a-command'), null);
  });

  it('dispatches /hot-update through the project script dry-run without touching the live bridge', async () => {
    initTestContext();
    const sent: string[] = [];
    const capturedRuns: HotUpdateRunRequest[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-hot-update-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-hot-update' } as const;
    const env = {
      ...process.env,
      CTI_HOT_UPDATE_TEST_MARKER: 'from-current-bridge-env',
    };

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/hot-update --dry-run --pull --skip-tests',
        messageId: 'incoming-hot-update',
      } as any,
      '/hot-update --dry-run --pull --skip-tests',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
        hotUpdateCwd: path.join(process.cwd(), 'src', '__tests__'),
        hotUpdateEnv: env,
        hotUpdateRunner: async (request) => {
          capturedRuns.push(request);
          assert.equal(request.env.CTI_HOT_UPDATE_TEST_MARKER, 'from-current-bridge-env');
          assert.equal(request.scriptPath, path.join(request.cwd, 'scripts', 'hot-update-bridge.sh'));
          assert.equal(fs.existsSync(request.scriptPath), true);
          assert.equal(JSON.parse(fs.readFileSync(path.join(request.cwd, 'package.json'), 'utf-8')).name, 'codex-to-im');
          assert.deepEqual(request.args, ['--dry-run', '--pull', '--skip-tests']);
          return {
            stdout: [
              '[hot-update] dry-run: yes',
              `[hot-update] project: ${request.cwd}`,
              `[hot-update] pwd: ${request.cwd}`,
              '[hot-update] node: v24.12.0',
              '[hot-update] worker args: --run --pull --skip-tests',
              '[hot-update] git pull: planned',
              '[hot-update] npm run build: planned',
              '[hot-update] npm test: skipped',
              '[hot-update] restart: planned',
            ].join('\n'),
            stderr: '',
          };
        },
      },
    );

    assert.equal(capturedRuns.length, 1);
    assert.match(sent.at(-1) || '', /热更新 dry-run 通过/);
    assert.match(sent.at(-1) || '', /命令：bash scripts\/hot-update-bridge\.sh --dry-run --pull --skip-tests/);
    assert.match(sent.at(-1) || '', /node: v24\.12\.0/);
    assert.match(sent.at(-1) || '', /worker args: --run --pull --skip-tests/);
    assert.match(sent.at(-1) || '', /npm test: skipped/);
  });

  it('updates /hot-update log in a regular rich card after dispatch', async () => {
    initTestContext();
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-hot-update-log-'));
    const hotUpdateLog = path.join(logDir, 'hot-update.log');
    const bridgeLog = path.join(logDir, 'bridge.log');
    fs.writeFileSync(hotUpdateLog, [
      '[hot-update] started 2026-05-31T23:43:00+08:00',
      '[hot-update] npm run build',
    ].join('\n'), 'utf-8');

    const sent: Array<{
      text: string;
      richCard?: OutboundRichCard;
      richCardUpdateMessageId?: string;
    }> = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      supportsStructuredStreamingUi: () => true,
      onStreamText: () => {
        throw new Error('/hot-update should not use streaming text cards');
      },
      onStreamStatus: () => {
        throw new Error('/hot-update should not use streaming status cards');
      },
      onStreamEnd: async () => {
        throw new Error('/hot-update should not finalize streaming cards');
      },
      send: async (message: { text: string; richCard?: OutboundRichCard; richCardUpdateMessageId?: string }) => {
        sent.push({
          text: message.text,
          richCard: message.richCard,
          richCardUpdateMessageId: message.richCardUpdateMessageId,
        });
        return { ok: true, messageId: `reply-hot-update-card-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-hot-update-stream' } as const;

    try {
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/hot-update --skip-tests',
          messageId: 'incoming-hot-update-stream',
        } as any,
        '/hot-update --skip-tests',
        {
          getActiveTask: () => undefined,
          diagnoseSessionHealth: async () => null,
          diagnoseAllActiveSessions: async () => [],
          hotUpdateCwd: process.cwd(),
          hotUpdateLogRefreshIntervalMs: 5,
          hotUpdateRunner: async (request) => ({
            stdout: [
              'Dispatched Codex-to-IM hot update.',
              'PID: 12345',
              `Hot update log: ${hotUpdateLog}`,
              `Bridge log: ${bridgeLog}`,
              'Pull requested: no',
              'Tests skipped: yes',
              `cwd: ${request.cwd}`,
            ].join('\n'),
            stderr: '',
          }),
        },
      );

      assert.equal(sent.length, 1);
      assert.match(sent[0].text, /已派发 Codex-to-IM 热更新/);
      assert.equal(sent[0].richCard?.title, 'Codex-to-IM 热更新日志');
      assert.match(sent[0].richCard?.updateKey || '', /^hot-update-log:/);
      assert.equal(sent[0].richCard?.updateTtlMs, null);
      assert.match(sent[0].richCard?.subtitle || '', /不使用流式“处理中”卡片/);
      assert.match(sent[0].richCard?.sections[2]?.code?.text || '', /npm run build/);

      fs.appendFileSync(hotUpdateLog, '\n[hot-update] completed 2026-05-31T23:43:10+08:00\n', 'utf-8');
      await new Promise((resolve) => setTimeout(resolve, 25));

      assert.ok(sent.length >= 2);
      assert.equal(sent[1].richCardUpdateMessageId, 'reply-hot-update-card-1');
      assert.equal(sent[1].richCard?.updateKey, sent[0].richCard?.updateKey);
      assert.equal(sent[1].richCard?.title, 'Codex-to-IM 热更新完成');
      assert.match(sent[1].richCard?.sections[2]?.code?.text || '', /\[hot-update\] completed/);
    } finally {
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });

  it('stops /hot-update log updates when the dispatched worker pid exits without completion', async () => {
    initTestContext();
    const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-hot-update-exited-'));
    const hotUpdateLog = path.join(logDir, 'hot-update.log');
    const bridgeLog = path.join(logDir, 'bridge.log');
    const exitedPid = 999_999_999;
    fs.writeFileSync(hotUpdateLog, [
      '[hot-update] started 2026-06-01T00:17:00+08:00',
      '[hot-update] npm run build',
    ].join('\n'), 'utf-8');

    const sent: Array<{
      text: string;
      richCard?: OutboundRichCard;
      richCardUpdateMessageId?: string;
    }> = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string; richCard?: OutboundRichCard; richCardUpdateMessageId?: string }) => {
        sent.push({
          text: message.text,
          richCard: message.richCard,
          richCardUpdateMessageId: message.richCardUpdateMessageId,
        });
        return { ok: true, messageId: `reply-hot-update-exited-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-hot-update-exited' } as const;

    try {
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/hot-update',
          messageId: 'incoming-hot-update-exited',
        } as any,
        '/hot-update',
        {
          getActiveTask: () => undefined,
          diagnoseSessionHealth: async () => null,
          diagnoseAllActiveSessions: async () => [],
          hotUpdateCwd: process.cwd(),
          hotUpdateLogRefreshIntervalMs: 5,
          hotUpdateRunner: async () => ({
            stdout: [
              'Dispatched Codex-to-IM hot update.',
              `PID: ${exitedPid}`,
              `Hot update log: ${hotUpdateLog}`,
              `Bridge log: ${bridgeLog}`,
              'Pull requested: no',
              'Tests skipped: no',
            ].join('\n'),
            stderr: '',
          }),
        },
      );

      assert.equal(sent.length, 1);
      assert.equal(sent[0].richCard?.title, 'Codex-to-IM 热更新日志');

      await new Promise((resolve) => setTimeout(resolve, 35));

      assert.equal(sent.length, 2);
      assert.equal(sent[1].richCardUpdateMessageId, 'reply-hot-update-exited-1');
      assert.equal(sent[1].richCard?.title, 'Codex-to-IM 热更新异常');
      assert.match(sent[1].richCard?.footer?.join('\n') || '', /PID 999999999 已退出/);

      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.equal(sent.length, 2);
    } finally {
      fs.rmSync(logDir, { recursive: true, force: true });
    }
  });

  it('rejects /hot-update --run from IM commands before invoking the script', async () => {
    initTestContext();
    const sent: string[] = [];
    let invoked = false;
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-hot-update-reject-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-hot-update-reject' } as const;

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/hot-update --run',
        messageId: 'incoming-hot-update-run',
      } as any,
      '/hot-update --run',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
        hotUpdateRunner: async () => {
          invoked = true;
          return { stdout: '', stderr: '' };
        },
      },
    );

    assert.equal(invoked, false);
    assert.match(sent.at(-1) || '', /不能通过 IM 命令传 `--run`/);
  });

  it('runs /shell through codex sandbox independent of yolo mode', async () => {
    const store = initTestContext();
    const address = { channelType: 'feishu', chatId: 'chat-shell-run' } as const;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-shell-run-'));
    const binding = router.createBinding(address, workDir);
    const session = store.getSession(binding.bridgeSessionId);
    assert.ok(session);
    store.updateSession(session.id, { codex_sandbox_mode: 'danger-full-access' });
    router.updateBinding(binding.id, { mode: 'yolo' });

    const sent: string[] = [];
    const requests: Array<{
      command: string;
      cwd: string;
      networkAccess: boolean;
      refreshIntervalSeconds: number | undefined;
      sandboxMode: string;
      shell: string;
    }> = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-shell-${sent.length}` };
      },
    };

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/shell echo ok',
        messageId: 'incoming-shell-run',
      } as any,
      '/shell echo ok',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
        shellRunner: async (request) => {
          requests.push({
            command: request.command,
            cwd: request.cwd,
            networkAccess: request.networkAccess,
            refreshIntervalSeconds: request.refreshIntervalSeconds,
            sandboxMode: request.sandboxMode,
            shell: request.shell,
          });
          return { exitCode: 0, stdout: 'ok\n', stderr: '' };
        },
      },
    );

    assert.deepEqual(requests, [{
      command: 'echo ok',
      cwd: workDir,
      networkAccess: true,
      refreshIntervalSeconds: 5,
      sandboxMode: 'workspace-write',
      shell: process.env.SHELL || '/bin/bash',
    }]);
    assert.match(sent.at(-1) || '', /\/shell 执行完成/);
    assert.match(sent.at(-1) || '', /Codex sandbox.*workspace-write/s);
    assert.match(sent.at(-1) || '', /网络.*on/s);
    assert.match(sent.at(-1) || '', /ok/);
  });

  it('unwraps transported markdown links for /shell commands', async () => {
    initTestContext();
    const address = { channelType: 'feishu', chatId: 'chat-shell-markdown-link' } as const;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-shell-markdown-link-'));
    router.createBinding(address, workDir);

    const sent: string[] = [];
    const commands: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-shell-md-${sent.length}` };
      },
    };

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/shell curl [baidu.com](http://baidu.com/)',
        messageId: 'incoming-shell-md-link',
      } as any,
      '/shell curl [baidu.com](http://baidu.com/)',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
        shellRunner: async (request) => {
          commands.push(request.command);
          return { exitCode: 0, stdout: 'ok\n', stderr: '' };
        },
      },
    );

    assert.deepEqual(commands, ['curl baidu.com']);
    assert.match(sent.at(-1) || '', /curl baidu\.com/);
    assert.doesNotMatch(sent.at(-1) || '', /http:\/\/baidu\.com/);
  });

  it('streams /shell progress to a structured card and floors refresh interval to 5 seconds', async () => {
    initTestContext();
    const address = { channelType: 'feishu', chatId: 'chat-shell-stream' } as const;
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-shell-stream-'));
    router.createBinding(address, workDir);

    const sent: string[] = [];
    const streamTexts: string[] = [];
    const streamStatuses: string[] = [];
    const streamEnds: Array<{ status: string; text: string }> = [];
    const requestedIntervals: Array<number | undefined> = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      supportsStructuredStreamingUi: () => true,
      onStreamText: (_chatId: string, text: string) => {
        streamTexts.push(text);
      },
      onStreamStatus: (_chatId: string, text: string) => {
        streamStatuses.push(text);
      },
      onStreamEnd: async (_chatId: string, status: string, text: string) => {
        streamEnds.push({ status, text });
        return true;
      },
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-shell-stream-${sent.length}` };
      },
    };

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/shell 2 echo streamed',
        messageId: 'incoming-shell-stream',
      } as any,
      '/shell 2 echo streamed',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
        shellRunner: async (request) => {
          requestedIntervals.push(request.refreshIntervalSeconds);
          request.onProgress?.({ stdout: 'partial\n', stderr: '' });
          return { exitCode: 0, stdout: 'partial\nfinal\n', stderr: '' };
        },
      },
    );

    assert.deepEqual(requestedIntervals, [5]);
    assert.deepEqual(sent, []);
    assert.ok(streamTexts.some((text) => /partial/.test(text)));
    assert.ok(streamTexts.some((text) => /final/.test(text)));
    assert.ok(streamStatuses.some((text) => /refresh 5s/.test(text)));
    assert.deepEqual(streamEnds.map((entry) => entry.status), ['completed']);
    assert.match(streamEnds[0].text, /\/shell 执行完成/);
  });

  it('parses /shell refresh interval from the leading numeric argument', () => {
    const defaultArgs = parseShellCommandArgs('echo default');
    assert.ok(!('error' in defaultArgs));
    assert.equal(defaultArgs.command, 'echo default');
    assert.equal(defaultArgs.refreshIntervalSeconds, 5);

    const flooredArgs = parseShellCommandArgs('2 echo floored');
    assert.ok(!('error' in flooredArgs));
    assert.equal(flooredArgs.command, 'echo floored');
    assert.equal(flooredArgs.refreshIntervalSeconds, 5);

    const explicitArgs = parseShellCommandArgs('--sandbox read-only 12 echo slow');
    assert.ok(!('error' in explicitArgs));
    assert.equal(explicitArgs.command, 'echo slow');
    assert.equal(explicitArgs.refreshIntervalSeconds, 12);
    assert.equal(explicitArgs.sandboxMode, 'read-only');
  });

  it('builds /shell codex sandbox args with default network access', () => {
    const request = {
      command: 'curl baidu.com',
      cwd: '/tmp/cti-shell',
      networkAccess: true,
      sandboxMode: 'workspace-write',
      shell: '/bin/bash',
      timeoutMs: 60_000,
    } as const;
    const args = buildCodexSandboxArgs(request);

    assert.deepEqual(args, [
      'sandbox',
      '-c',
      'permissions.cti_shell_workspace_network.extends=":workspace"',
      '-c',
      'permissions.cti_shell_workspace_network.network.enabled=true',
      '-c',
      'permissions.cti_shell_workspace_network.network.mode="full"',
      '--permissions-profile',
      'cti_shell_workspace_network',
      '--cd',
      '/tmp/cti-shell',
      '/bin/bash',
      '-lc',
      'curl baidu.com',
    ]);

    assert.deepEqual(buildCodexSandboxArgs(request, 'linux-subcommand'), [
      'sandbox',
      'linux',
      '-c',
      'permissions.cti_shell_workspace_network.extends=":workspace"',
      '-c',
      'permissions.cti_shell_workspace_network.network.enabled=true',
      '-c',
      'permissions.cti_shell_workspace_network.network.mode="full"',
      '--permissions-profile',
      'cti_shell_workspace_network',
      '--cd',
      '/tmp/cti-shell',
      '/bin/bash',
      '-lc',
      'curl baidu.com',
    ]);
  });

  it('detects new and legacy codex sandbox CLI help forms', () => {
    assert.equal(detectCodexSandboxCliStyleFromHelp([
      'Usage: codex sandbox [OPTIONS] [COMMAND]...',
      '',
      'Options:',
      '      --permissions-profile <NAME>',
    ].join('\n')), 'top-level');

    assert.equal(detectCodexSandboxCliStyleFromHelp([
      'Usage: codex sandbox [OPTIONS] <COMMAND>',
      '',
      'Commands:',
      '  macos    Run a command under Seatbelt',
      '  linux    Run a command under the Linux sandbox',
      '  windows  Run a command under Windows restricted token',
    ].join('\n')), 'linux-subcommand');
  });

  it('prefers a global codex executable over node_modules for /shell', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-codex-path-'));
    const projectBin = path.join(tempDir, 'project', 'node_modules', '.bin');
    const globalBin = path.join(tempDir, 'global-bin');
    fs.mkdirSync(projectBin, { recursive: true });
    fs.mkdirSync(globalBin, { recursive: true });
    const projectCodex = path.join(projectBin, 'codex');
    const globalCodex = path.join(globalBin, 'codex');
    fs.writeFileSync(projectCodex, '#!/usr/bin/env sh\nexit 0\n', 'utf-8');
    fs.writeFileSync(globalCodex, '#!/usr/bin/env sh\nexit 0\n', 'utf-8');
    fs.chmodSync(projectCodex, 0o755);
    fs.chmodSync(globalCodex, 0o755);

    try {
      assert.equal(
        resolveCodexCliExecutable({ PATH: `${projectBin}${path.delimiter}${globalBin}` }),
        globalCodex,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('runs real /shell commands for listing, workspace write, and invalid directory write failure', async () => {
    initTestContext();
    const address = { channelType: 'feishu', chatId: 'chat-shell-real' } as const;
    const cwd = fs.mkdtempSync(path.join(process.cwd(), '.tmp-cti-shell-real-'));
    fs.writeFileSync(path.join(cwd, 'visible.txt'), 'ok\n', 'utf-8');
    const outsideDir = fs.mkdtempSync(path.join(os.homedir(), '.cti-shell-outside-'));
    const outsidePath = path.join(outsideDir, 'blocked.txt');
    router.createBinding(address, cwd);

    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-shell-real-${sent.length}` };
      },
    };
    const deps = {
      getActiveTask: () => undefined,
      diagnoseSessionHealth: async () => null,
      diagnoseAllActiveSessions: async () => [],
    };

    try {
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/shell ls',
          messageId: 'incoming-shell-real-ls',
        } as any,
        '/shell ls',
        deps,
      );
      assert.match(sent.at(-1) || '', /\/shell 执行完成/);
      assert.match(sent.at(-1) || '', /退出码[\s\S]*0/);
      assert.match(sent.at(-1) || '', /visible\.txt/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/shell echo shell-ok > temp.txt',
          messageId: 'incoming-shell-real-write',
        } as any,
        '/shell echo shell-ok > temp.txt',
        deps,
      );
      assert.match(sent.at(-1) || '', /退出码[\s\S]*0/);
      assert.equal(fs.readFileSync(path.join(cwd, 'temp.txt'), 'utf-8'), 'shell-ok\n');

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: `/shell echo nope > ${outsidePath}`,
          messageId: 'incoming-shell-real-invalid-dir',
        } as any,
        `/shell echo nope > ${outsidePath}`,
        deps,
      );
      assert.match(sent.at(-1) || '', /退出码[\s\S]*[1-9]/);
      assert.equal(fs.existsSync(outsidePath), false);
    } finally {
      fs.rmSync(cwd, { recursive: true, force: true });
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('allows /shell to connect to localhost when sandbox network is enabled', async () => {
    initTestContext();
    const address = { channelType: 'feishu', chatId: 'chat-shell-localhost' } as const;
    const cwd = fs.mkdtempSync(path.join(process.cwd(), '.tmp-cti-shell-localhost-'));
    router.createBinding(address, cwd);

    const server = net.createServer((socket) => {
      socket.end('cti-localhost-ok\n');
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const addressInfo = server.address();
    assert.ok(addressInfo && typeof addressInfo === 'object');

    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-shell-localhost-${sent.length}` };
      },
    };

    try {
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: `/shell bash -lc 'exec 3<>/dev/tcp/127.0.0.1/${addressInfo.port}; cat <&3'`,
          messageId: 'incoming-shell-localhost',
        } as any,
        `/shell bash -lc 'exec 3<>/dev/tcp/127.0.0.1/${addressInfo.port}; cat <&3'`,
        {
          getActiveTask: () => undefined,
          diagnoseSessionHealth: async () => null,
          diagnoseAllActiveSessions: async () => [],
        },
      );
      assert.match(sent.at(-1) || '', /退出码[\s\S]*0/);
      assert.match(sent.at(-1) || '', /cti-localhost-ok/);
    } finally {
      server.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('audits /shell high-risk and malformed commands before running', async () => {
    initTestContext();
    const address = { channelType: 'feishu', chatId: 'chat-shell-audit' } as const;
    router.createBinding(address, fs.mkdtempSync(path.join(os.tmpdir(), 'cti-shell-audit-')));

    const sent: string[] = [];
    let runnerCalls = 0;
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-shell-audit-${sent.length}` };
      },
    };
    const deps = {
      getActiveTask: () => undefined,
      diagnoseSessionHealth: async () => null,
      diagnoseAllActiveSessions: async () => [],
      shellRunner: async () => {
        runnerCalls += 1;
        return { exitCode: 0, stdout: 'forced\n', stderr: '' };
      },
    };

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/shell rm -rf dist',
        messageId: 'incoming-shell-rm',
      } as any,
      '/shell rm -rf dist',
      deps,
    );
    assert.equal(runnerCalls, 0);
    assert.match(sent.at(-1) || '', /\/shell 需要确认/);
    assert.match(sent.at(-1) || '', /--force/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/shell / tmp',
        messageId: 'incoming-shell-slash',
      } as any,
      '/shell / tmp',
      deps,
    );
    assert.equal(runnerCalls, 0);
    assert.match(sent.at(-1) || '', /\/shell 已拒绝执行/);
    assert.match(sent.at(-1) || '', /绝对路径被空格拆开/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/shell --sandbox danger-full-access echo no',
        messageId: 'incoming-shell-danger-sandbox',
      } as any,
      '/shell --sandbox danger-full-access echo no',
      deps,
    );
    assert.equal(runnerCalls, 0);
    assert.match(sent.at(-1) || '', /不允许 danger-full-access/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/shell --force rm -rf dist',
        messageId: 'incoming-shell-force',
      } as any,
      '/shell --force rm -rf dist',
      deps,
    );
    assert.equal(runnerCalls, 1);
    assert.match(sent.at(-1) || '', /已确认高风险操作/);
    assert.match(sent.at(-1) || '', /forced/);
  });

  it('switches /thread 0 into the hidden draft session and keeps normal mode', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-1' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-draft' } as const;

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/thread 0',
        messageId: 'incoming-1',
      } as any,
      '/thread 0',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );
    const binding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(binding);
    assert.equal(binding?.mode, 'normal');
    const session = binding ? store.getSession(binding.bridgeSessionId) : null;
    assert.equal(session?.session_type, 'draft');
    assert.match(sent[0] || '', /已切换到临时草稿线程/);
  });

  it('applies channel prebinding before running the first session-scoped slash command', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu-default',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-prebound-history' };
      },
    };
    const address = { channelType: 'feishu-default', chatId: 'chat-prebound-status', displayName: 'Prebound Chat' } as const;
    const session = store.createSession('prebound-session', 'test-model', undefined, '/tmp/prebound-status');
    store.updateSession(session.id, {
      codex_thread_id: 'codex-thread-prebound',
    });
    store.upsertChannelDefaultTarget({
      channelType: 'feishu-default',
      channelProvider: 'feishu',
      channelAlias: '飞书',
      bridgeSessionId: session.id,
    });

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/',
        messageId: 'incoming-prebound-status',
      } as any,
      '/',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const binding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(binding);
    assert.equal(binding?.bridgeSessionId, session.id);
    assert.equal(store.getChannelDefaultTarget(address.channelType), null);
    assert.match(sent[0] || '', /当前会话/);
    assert.match(sent[0] || '', /prebound-session/);
    assert.match(sent[0] || '', /codex-thread-id/);
    assert.match(sent[0] || '', /codex-thread-prebound/);
  });

  it('renders /check health diagnostics for the current session', async () => {
    initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-3' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-health' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\health');

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/check',
        messageId: 'incoming-3',
      } as any,
      '/check',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async (sessionId) => ({
          sessionId,
          checkedAt: null,
          runtimeStatus: 'running',
          healthStatus: 'slow_observed',
          healthReason: '近期没有新的执行进展，先标记为待观察。',
          lastProgressAt: '2026-04-13T12:00:00.000Z',
          lastProgressType: 'tool_running',
          activeToolName: 'shell_command',
          activeToolStartedAt: '2026-04-13T11:50:00.000Z',
          lastToolFinishedAt: null,
          lastStreamUiAttemptAt: null,
          lastStreamUiUpdateAt: null,
          streamUiFlushStartedAt: null,
          lastStreamUiErrorAt: null,
          lastStreamUiError: null,
          streamUiConsecutiveFailures: 0,
          codexThreadId: null,
          processProbe: null,
        }),
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const response = sent[0] || '';
    assert.match(response, /当前会话健康检查/);
    assert.doesNotMatch(response, /检查时间/);
    assert.match(response, new RegExp(binding.bridgeSessionId));
    assert.match(response, /长时运行，待观察/);
    assert.match(response, /shell_command/);
  });

  it('renders /check diagnostics for an explicit session id', async () => {
    initTestContext();
    const sent: string[] = [];
    const requestedSessionIds: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-health-explicit' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-health-explicit' } as const;
    router.createBinding(address, 'D:\\workspace\\health-current');
    const explicitSessionId = 'fbfa3ff0-6226-4f79-99b5-7704754433fb';

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: `/check ${explicitSessionId}`,
        messageId: 'incoming-health-explicit',
      } as any,
      `/check ${explicitSessionId}`,
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async (sessionId) => {
          requestedSessionIds.push(sessionId);
          return {
            sessionId,
            checkedAt: null,
            runtimeStatus: 'idle',
            healthStatus: 'completed',
            healthReason: '任务已完成。',
            lastProgressAt: '2026-04-13T12:00:00.000Z',
            lastProgressType: 'task_completed',
            activeToolName: null,
            activeToolStartedAt: null,
            lastToolFinishedAt: null,
            lastStreamUiAttemptAt: null,
            lastStreamUiUpdateAt: null,
            streamUiFlushStartedAt: null,
            lastStreamUiErrorAt: null,
            lastStreamUiError: null,
            streamUiConsecutiveFailures: 0,
            codexThreadId: null,
            processProbe: null,
          };
        },
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.deepEqual(requestedSessionIds, [explicitSessionId]);
    const response = sent[0] || '';
    assert.match(response, /指定会话健康检查/);
    assert.match(response, new RegExp(explicitSessionId));
    assert.doesNotMatch(response, /检查时间/);
  });

  it('renders /status as global bridge status without creating a session or binding for an unbound chat', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-status-1' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-status-draft' } as const;

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/status',
        messageId: 'incoming-status-1',
      } as any,
      '/status',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const response = sent[0] || '';
    assert.match(response, /全局状态/);
    assert.match(response, /Bridge/);
    assert.match(response, /Bridge PID/);
    assert.match(response, /当前聊天绑定.*未绑定/s);
    assert.equal(store.getChannelBinding(address.channelType, address.chatId), null);
    assert.equal(store.listSessions().length, 0);
    assert.deepEqual(readAuditSummaries(), []);
  });

  it('renders /check without creating a session or binding for an unbound chat', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    let diagnoseCalls = 0;
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-health-unbound' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-health-unbound' } as const;

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/check',
        messageId: 'incoming-health-unbound',
      } as any,
      '/check',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => {
          diagnoseCalls += 1;
          return null;
        },
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const response = sent[0] || '';
    assert.match(response, /还没有绑定会话/);
    assert.equal(diagnoseCalls, 0);
    assert.equal(store.getChannelBinding(address.channelType, address.chatId), null);
    assert.equal(store.listSessions().length, 0);
    assert.deepEqual(readAuditSummaries(), []);
  });

  it('creates a new IM session with /new and points the binding at the requested directory', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-new-1' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-new-command' } as const;

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/new D:\\workspace\\common-flow',
        messageId: 'incoming-new-1',
      } as any,
      '/new D:\\workspace\\common-flow',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const binding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(binding);
    assert.equal(binding?.workingDirectory, path.resolve('D:\\workspace\\common-flow'));
    assert.match(sent[0] || '', /已新建会话/);
    assert.match(sent[0] || '', /common-flow/);
    assert.doesNotMatch(sent[0] || '', /旧任务在运行/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/new set',
        messageId: 'incoming-new-name-only',
      } as any,
      '/new set',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const namedOnlyBinding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(namedOnlyBinding);
    assert.equal(namedOnlyBinding?.workingDirectory, path.resolve('D:\\workspace\\common-flow'));
    assert.equal(store.getSession(namedOnlyBinding!.bridgeSessionId)?.name, 'set');
    assert.match(sent.at(-1) || '', /标题.*set/s);

    const bindingCountBeforeDuplicate = store.listChannelBindings(address.channelType)
      .filter((binding) => binding.chatId === address.chatId).length;
    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/new set',
        messageId: 'incoming-new-duplicate-name',
      } as any,
      '/new set',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.match(sent.at(-1) || '', /会话名已存在/);
    assert.equal(
      store.listChannelBindings(address.channelType).filter((binding) => binding.chatId === address.chatId).length,
      bindingCountBeforeDuplicate,
    );

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/new RenamedSession D:\\workspace\\named-flow',
        messageId: 'incoming-new-2',
      } as any,
      '/new RenamedSession D:\\workspace\\named-flow',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const renamedBinding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(renamedBinding);
    assert.equal(renamedBinding?.workingDirectory, path.resolve('D:\\workspace\\named-flow'));
    assert.equal(store.getSession(renamedBinding!.bridgeSessionId)?.name, 'RenamedSession');
    assert.match(sent.at(-1) || '', /标题.*RenamedSession/s);
    assert.match(sent.at(-1) || '', /\/new <name>/);
    assert.match(sent.at(-1) || '', /\.\/hi/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/new bad/name D:\\workspace\\bad-name',
        messageId: 'incoming-new-invalid-name',
      } as any,
      '/new bad/name D:\\workspace\\bad-name',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );
    assert.match(sent.at(-1) || '', /会话名不能包含路径分隔符/);
  });

  it('views and updates global non-channel config with /set and applies it to /new', async () => {
    const store = initTestContext({ dynamicSettings: true });
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-set-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-set-command' } as const;
    const deps = {
      getActiveTask: () => undefined,
      diagnoseSessionHealth: async () => null,
      diagnoseAllActiveSessions: async () => [],
    };
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-set-workspace-'));

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/set',
        messageId: 'incoming-set-show',
      } as any,
      '/set',
      deps,
    );
    assert.match(sent.at(-1) || '', /全局配置/);
    assert.match(sent.at(-1) || '', /defaultWorkspaceRoot/);
    assert.match(sent.at(-1) || '', /defaultProvider/);
    assert.match(sent.at(-1) || '', /codexNetworkAccess/);
    assert.doesNotMatch(sent.at(-1) || '', /channels/);
    assert.equal(store.getChannelBinding(address.channelType, address.chatId), null);
    assert.equal(store.listSessions().length, 0);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: `/set defaultWorkspaceRoot ${workspaceRoot}`,
        messageId: 'incoming-set-workspace',
      } as any,
      `/set defaultWorkspaceRoot ${workspaceRoot}`,
      deps,
    );
    assert.match(sent.at(-1) || '', /已更新全局配置/);
    assert.match(sent.at(-1) || '', /defaultWorkspaceRoot/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/set defaultMode yolo',
        messageId: 'incoming-set-mode',
      } as any,
      '/set defaultMode yolo',
      deps,
    );
    assert.match(sent.at(-1) || '', /默认模式.*yolo/s);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/set defaultProvider tmux',
        messageId: 'incoming-set-provider',
      } as any,
      '/set defaultProvider tmux',
      deps,
    );
    assert.match(sent.at(-1) || '', /默认 Codex Provider.*tmux/s);
    assert.equal(loadConfig().defaultProvider, 'tmux');

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/set defualtProvider sdk',
        messageId: 'incoming-set-provider-typo-alias',
      } as any,
      '/set defualtProvider sdk',
      deps,
    );
    assert.match(sent.at(-1) || '', /默认 Codex Provider.*sdk/s);
    assert.equal(loadConfig().defaultProvider, 'sdk');

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/set codexNetworkAccess off',
        messageId: 'incoming-set-network',
      } as any,
      '/set codexNetworkAccess off',
      deps,
    );
    assert.match(sent.at(-1) || '', /Codex 网络访问.*off/s);
    assert.equal(loadConfig().codexNetworkAccess, false);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/set codexReasoningEffort minimal',
        messageId: 'incoming-set-reasoning-minimal',
      } as any,
      '/set codexReasoningEffort minimal',
      deps,
    );
    assert.match(sent.at(-1) || '', /Codex 思考级别.*minimal/s);
    assert.match(sent.at(-1) || '', /禁用 web search/);
    assert.equal(loadConfig().codexReasoningEffort, 'minimal');

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/set historyMessageLimit 12',
        messageId: 'incoming-set-history',
      } as any,
      '/set historyMessageLimit 12',
      deps,
    );
    assert.equal(loadConfig().historyMessageLimit, 12);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/set defaultMode impossible',
        messageId: 'incoming-set-invalid',
      } as any,
      '/set defaultMode impossible',
      deps,
    );
    assert.match(sent.at(-1) || '', /配置未更新/);
    assert.match(sent.at(-1) || '', /normal 或 yolo/);
    assert.equal(loadConfig().defaultMode, 'yolo');

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/new ./set-proj',
        messageId: 'incoming-new-after-set',
      } as any,
      '/new ./set-proj',
      deps,
    );
    const binding = store.getChannelBinding(address.channelType, address.chatId);
    assert.ok(binding);
    assert.equal(binding?.workingDirectory, path.join(workspaceRoot, 'set-proj'));
    assert.equal(binding?.mode, 'yolo');
    assert.equal(store.getSession(binding!.bridgeSessionId)?.preferred_mode, 'yolo');
  });

  it('blocks thread switching while the current task is running unless forced', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-switch-running' } as const;
    const initialBinding = router.createBinding(address, 'D:\\workspace\\running-old');
    const activeTask = { abortController: new AbortController() };

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/thread 0',
        messageId: 'incoming-switch-running-1',
      } as any,
      '/thread 0',
      {
        getActiveTask: (sessionId) => sessionId === initialBinding.bridgeSessionId ? activeTask : undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.match(sent.at(-1) || '', /当前会话仍在运行/);
    assert.match(sent.at(-1) || '', /--force/);
    assert.equal(
      store.getChannelBinding(address.channelType, address.chatId)?.bridgeSessionId,
      initialBinding.bridgeSessionId,
    );

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/thread 0 --force',
        messageId: 'incoming-switch-running-2',
      } as any,
      '/thread 0 --force',
      {
        getActiveTask: (sessionId) => sessionId === initialBinding.bridgeSessionId ? activeTask : undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const forcedBinding = store.getChannelBinding(address.channelType, address.chatId);
    assert.notEqual(forcedBinding?.bridgeSessionId, initialBinding.bridgeSessionId);
    assert.equal(forcedBinding?.mode, 'normal');
    assert.match(sent.at(-1) || '', /已切换到临时草稿线程/);
    assert.ok(readAuditSummaries().some((summary) => (
      summary.includes('Binding change: action=switch_draft')
      && summary.includes('reason=forced')
    )));
  });

  it('force-stops a stale running session even when no active task remains in memory', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const forcedStops: Array<{ sessionId: string; detail?: string }> = [];
    const healthEnds: Array<{ sessionId: string; outcome: string; detail?: string }> = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-stop-stale' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-stop-stale' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\stop-stale');
    store.updateSession(binding.bridgeSessionId, {
      runtime_status: 'idle',
      health_status: 'suspected_stream_ui_stall',
      health_reason: '任务仍在继续，但流式 UI 刷新请求已长时间未完成，疑似卡住。',
    });

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/stop',
        messageId: 'incoming-stop-stale',
      } as any,
      '/stop',
      {
        getActiveTask: () => undefined,
        forceStopSession: async (sessionId, detail) => {
          forcedStops.push({ sessionId, detail });
          return false;
        },
        recordInteractiveHealthEnd: (sessionId, outcome, detail) => {
          healthEnds.push({ sessionId, outcome, detail });
        },
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.deepEqual(forcedStops, [{
      sessionId: binding.bridgeSessionId,
      detail: '用户执行 /stop，已停止当前任务。',
    }]);
    assert.deepEqual(healthEnds, [{
      sessionId: binding.bridgeSessionId,
      outcome: 'aborted',
      detail: '用户执行 /stop，已停止当前任务。',
    }]);
    assert.match(sent[0] || '', /旧会话「Bridge: chat-stop-stale」任务已停止/);
  });

  it('lists, switches, and removes multiple bindings with /t subcommands', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const richCards: OutboundRichCard[] = [];
    const richCardUpdateMessageIds: Array<string | undefined> = [];
    const pinned: string[] = [];
    const unpinned: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string; richCard?: OutboundRichCard; richCardUpdateMessageId?: string }) => {
        sent.push(message.text);
        if (message.richCard) richCards.push(message.richCard);
        richCardUpdateMessageIds.push(message.richCardUpdateMessageId);
        return { ok: true, messageId: `reply-t-${sent.length}` };
      },
      pinMessage: async (_chatId: string, messageId: string) => {
        pinned.push(messageId);
        return { ok: true, messageId };
      },
      unpinMessage: async (_chatId: string, messageId: string) => {
        unpinned.push(messageId);
        return { ok: true, messageId };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-t-multi' } as const;
    const first = router.createBinding(address, 'D:\\workspace\\first');
    const second = router.createBinding(address, 'D:\\workspace\\second');

    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, second.id);
    assert.equal(store.listChannelBindings().filter((binding) => binding.chatId === address.chatId).length, 2);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t ls',
        messageId: 'incoming-t-ls',
      } as any,
      '/t ls',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );
    assert.equal(richCardUpdateMessageIds.at(-1), undefined);
    assert.match(sent.at(-1) || '', /当前聊天绑定/);
    assert.match(sent.at(-1) || '', /#\s+标题\s+目录\s+上一次活动\s+binding_id\s+thread_id\s+Creator\s+命令/);
    assert.match(sent.at(-1) || '', /first/);
    assert.match(sent.at(-1) || '', /second/);
    assert.equal(richCards.at(-1)?.title, '当前聊天绑定（2）');
    assert.deepEqual(richCards.at(-1)?.table?.columns.map((column) => column.name), [
      'index',
      'title',
      'cwd',
      'last_active',
      'binding_id',
      'thread_id',
      'creator',
      'command',
    ]);
    assert.deepEqual(
      richCards.at(-1)?.actions?.flat().map((action) => action.text),
      ['解绑', '归档', '激活', '刷新'],
    );
    assert.deepEqual(
      richCards.at(-1)?.actions?.map((row) => row.map((action) => action.text)),
      [['解绑', '归档', '激活'], ['刷新']],
    );
    assert.equal(richCards.at(-1)?.table?.columns[0]?.horizontalAlign, 'center');
    assert.equal(richCards.at(-1)?.table?.rows[0]?.index, "<number_tag background_color='grey-500' font_color='white'>1</number_tag>");
    assert.doesNotMatch(String(richCards.at(-1)?.table?.rows[0]?.title || ''), /^<font color=/);
    assert.equal(richCards.at(-1)?.table?.rows[1]?.index, "**<number_tag background_color='green-350' font_color='white'>2</number_tag>**");
    assert.match(String(richCards.at(-1)?.table?.rows[1]?.title || ''), /^\*\*.+\*\*$/);
    assert.deepEqual(pinned, ['reply-t-1']);
    assert.deepEqual(unpinned, []);
    assert.deepEqual(getThreadTableMessageRecord(address), {
      channelType: 'feishu',
      chatId: 'chat-t-multi',
      scope: 'bound',
      messageId: 'reply-t-1',
      pinnedMessageId: 'reply-t-1',
      updatedAt: getThreadTableMessageRecord(address)?.updatedAt,
    });

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t ls',
        messageId: 'incoming-t-ls-2',
      } as any,
      '/t ls',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );
    assert.equal(richCardUpdateMessageIds.at(-1), 'reply-t-1');
    assert.deepEqual(pinned, ['reply-t-1', 'reply-t-2']);
    assert.deepEqual(unpinned, ['reply-t-1']);
    assert.equal(getThreadTableMessageRecord(address)?.messageId, 'reply-t-2');
    assert.equal(getThreadTableMessageRecord(address)?.pinnedMessageId, 'reply-t-2');

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t use 1',
        messageId: 'incoming-t-use',
      } as any,
      '/t use 1',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, first.id);
    assert.match(sent.at(-1) || '', /当前线程已切换/);
    assert.equal(richCards.length, 2);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t detach 2',
        messageId: 'incoming-t-rm',
      } as any,
      '/t detach 2',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );
    const remaining = store.listChannelBindings().filter((binding) => binding.chatId === address.chatId);
    assert.deepEqual(remaining.map((binding) => binding.id), [first.id]);
    assert.ok(store.getSession(second.bridgeSessionId));
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, first.id);
    assert.match(sent.at(-1) || '', /已脱离绑定线程/);
    assert.equal(richCards.length, 2);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t detach 1',
        messageId: 'incoming-t-remove',
      } as any,
      '/t detach 1',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );
    assert.equal(store.listChannelBindings().filter((binding) => binding.chatId === address.chatId).length, 0);
    assert.match(sent.at(-1) || '', /已脱离绑定线程/);
    assert.equal(richCards.length, 2);
  });

  it('keeps /t text fallback at 10 rows while the rich card shows up to 200 rows', async () => {
    initTestContext();
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'sessions'), { recursive: true, force: true });
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'session_index.jsonl'), { force: true });

    for (let index = 0; index < 200; index += 1) {
      const padded = String(index + 1).padStart(3, '0');
      const timestamp = new Date(Date.UTC(2026, 4, 28, 0, 0, index)).toISOString();
      writeCodexSessionJsonlFixture({
        threadId: `thread-${padded}`,
        workDir: `/tmp/project-${padded}`,
        lines: [
          {
            timestamp,
            type: 'session_meta',
            payload: {
              id: `thread-${padded}`,
              timestamp,
              cwd: `/tmp/project-${padded}`,
              originator: 'Codex CLI',
            },
          },
        ],
      });
    }

    const sent: Array<{ text: string; richCard?: OutboundRichCard }> = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string; richCard?: OutboundRichCard }) => {
        sent.push(message);
        return { ok: true, messageId: `reply-t-default-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-t-default' } as const;

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t',
        messageId: 'incoming-t-default',
      } as any,
      '/t',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    const message = sent.at(-1);
    assert.match(message?.text || '', /Codex会话（本地会话10 \+ 未绑定的Bridge0）/);
    assert.match(message?.text || '', /已达到 200 条显示上限/);
    assert.equal(message?.richCard?.title, 'Codex会话（本地会话200 + 未绑定的Bridge0）');
    assert.equal(message?.richCard?.table?.rows.length, 200);
    assert.equal(message?.richCard?.selects?.[0]?.options.length, 200);
    assert.deepEqual(
      message?.richCard?.actions?.map((row) => row.map((action) => action.text)),
      [['绑定', '解绑', '归档'], ['激活', '新建', '刷新']],
    );
    assert.equal(message?.richCard?.actions?.every((row) => row.length <= 3), true);
    assert.match(message?.richCard?.footer?.[0] || '', /已达到 200 条显示上限/);

    fs.rmSync(path.join(process.env.CODEX_HOME!, 'sessions'), { recursive: true, force: true });
  });

  it('archives the current Codex thread with /t archive and unbinds the chat', async () => {
    const store = initTestContext();
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'sessions'), { recursive: true, force: true });
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'archived_sessions'), { recursive: true, force: true });
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'session_index.jsonl'), { force: true });

    const { sessionPath } = writeCodexSessionJsonlFixture({
      threadId: '019e7d66-0000-7000-8000-000000000001',
      workDir: '/tmp/archive-current',
    });
    const address = { channelType: 'feishu', chatId: 'chat-t-archive-current' } as const;
    const binding = router.bindToCodexThread(address, '019e7d66-0000-7000-8000-000000000001', {
      workingDirectory: '/tmp/archive-current',
      codexTitle: 'Archive current',
    });
    assert.ok(binding);

    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-t-archive-current-${sent.length}` };
      },
    };

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t archive',
        messageId: 'incoming-t-archive-current',
      } as any,
      '/t archive',
      {
        getActiveTask: () => ({ abortController: new AbortController() }),
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.match(sent.at(-1) || '', /已归档本地 Codex 会话/);
    assert.match(sent.at(-1) || '', /解除绑定.*1/s);
    assert.equal(fs.existsSync(sessionPath), false);
    const archivedEntries = fs.readdirSync(path.join(process.env.CODEX_HOME!, 'archived_sessions'));
    assert.equal(archivedEntries.length, 1);
    assert.match(archivedEntries[0] || '', /019e7d66-0000-7000-8000-000000000001\.jsonl$/);
    assert.equal(store.getChannelBinding(address.channelType, address.chatId), null);
    assert.equal(store.listChannelBindings().some((item) => item.bridgeSessionId === binding.bridgeSessionId), false);
    assert.equal(store.getSession(binding.bridgeSessionId), null);

    fs.rmSync(path.join(process.env.CODEX_HOME!, 'sessions'), { recursive: true, force: true });
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'archived_sessions'), { recursive: true, force: true });
  });

  it('archives a selected Codex thread with /t archive using the global list index', async () => {
    const store = initTestContext();
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'sessions'), { recursive: true, force: true });
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'archived_sessions'), { recursive: true, force: true });
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'session_index.jsonl'), { force: true });

    const older = writeCodexSessionJsonlFixture({
      threadId: '019e7d66-0000-7000-8000-000000000101',
      workDir: '/tmp/archive-index-old',
      lines: [{
        timestamp: '2026-05-28T00:00:01.000Z',
        type: 'session_meta',
        payload: {
          id: '019e7d66-0000-7000-8000-000000000101',
          timestamp: '2026-05-28T00:00:01.000Z',
          cwd: '/tmp/archive-index-old',
          originator: 'Codex CLI',
        },
      }],
    });
    const newer = writeCodexSessionJsonlFixture({
      threadId: '019e7d66-0000-7000-8000-000000000102',
      workDir: '/tmp/archive-index-new',
      lines: [{
        timestamp: '2026-05-28T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: '019e7d66-0000-7000-8000-000000000102',
          timestamp: '2026-05-28T00:00:00.000Z',
          cwd: '/tmp/archive-index-new',
          originator: 'Codex CLI',
        },
      }],
    });
    const address = { channelType: 'feishu', chatId: 'chat-t-archive-index' } as const;
    router.bindToCodexThread(address, '019e7d66-0000-7000-8000-000000000101', {
      workingDirectory: '/tmp/archive-index-old',
      codexTitle: 'Archive index old',
    });

    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-t-archive-index-${sent.length}` };
      },
    };

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t archive 1',
        messageId: 'incoming-t-archive-index',
      } as any,
      '/t archive 1',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.match(sent.at(-1) || '', /019e7d66-0000-7000-8000-000000000101/);
    assert.equal(fs.existsSync(older.sessionPath), false);
    assert.equal(fs.existsSync(newer.sessionPath), true);
    assert.equal(store.getChannelBinding(address.channelType, address.chatId), null);
    const archivedEntries = fs.readdirSync(path.join(process.env.CODEX_HOME!, 'archived_sessions'));
    assert.equal(archivedEntries.length, 1);
    assert.match(archivedEntries[0] || '', /019e7d66-0000-7000-8000-000000000101\.jsonl$/);

    fs.rmSync(path.join(process.env.CODEX_HOME!, 'sessions'), { recursive: true, force: true });
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'archived_sessions'), { recursive: true, force: true });
  });

  it('archives a bound Codex thread with /t archive using the binding id', async () => {
    const store = initTestContext();
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'sessions'), { recursive: true, force: true });
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'archived_sessions'), { recursive: true, force: true });
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'session_index.jsonl'), { force: true });

    const { sessionPath } = writeCodexSessionJsonlFixture({
      threadId: '019e7d66-0000-7000-8000-000000000201',
      workDir: '/tmp/archive-binding-id',
      lines: [{
        timestamp: '2026-05-28T00:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: '019e7d66-0000-7000-8000-000000000201',
          timestamp: '2026-05-28T00:00:00.000Z',
          cwd: '/tmp/archive-binding-id',
          originator: 'Codex CLI',
        },
      }],
    });
    const address = { channelType: 'feishu', chatId: 'chat-t-archive-binding-id' } as const;
    const binding = router.bindToCodexThread(address, '019e7d66-0000-7000-8000-000000000201', {
      workingDirectory: '/tmp/archive-binding-id',
      codexTitle: 'Archive binding id',
    });

    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-t-archive-binding-${sent.length}` };
      },
    };

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: `/t archive ${binding.id.slice(0, 8)}`,
        messageId: 'incoming-t-archive-binding',
      } as any,
      `/t archive ${binding.id.slice(0, 8)}`,
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.match(sent.at(-1) || '', /已归档本地 Codex 会话/);
    assert.match(sent.at(-1) || '', /archive-binding-id/);
    assert.equal(fs.existsSync(sessionPath), false);
    assert.equal(store.getChannelBinding(address.channelType, address.chatId), null);
    const archivedEntries = fs.readdirSync(path.join(process.env.CODEX_HOME!, 'archived_sessions'));
    assert.equal(archivedEntries.length, 1);
    assert.match(archivedEntries[0] || '', /019e7d66-0000-7000-8000-000000000201\.jsonl$/);

    fs.rmSync(path.join(process.env.CODEX_HOME!, 'sessions'), { recursive: true, force: true });
    fs.rmSync(path.join(process.env.CODEX_HOME!, 'archived_sessions'), { recursive: true, force: true });
  });

  it('renders actionable rich cards for empty /t ls and /auto ls tables', async () => {
    initTestContext();
    const richCards: OutboundRichCard[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string; richCard?: OutboundRichCard }) => {
        if (message.richCard) richCards.push(message.richCard);
        return { ok: true, messageId: `reply-empty-${richCards.length}` };
      },
    };
    const emptyAddress = { channelType: 'feishu', chatId: 'chat-empty-t' } as const;

    await handleBridgeCommand(
      adapter,
      {
        address: emptyAddress,
        text: '/t ls',
        messageId: 'incoming-empty-t-ls',
      } as any,
      '/t ls',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.equal(richCards.at(-1)?.title, '当前聊天绑定（0）');
    assert.equal(richCards.at(-1)?.table?.rows.length, 0);
    assert.equal(richCards.at(-1)?.selects, undefined);
    assert.deepEqual(richCards.at(-1)?.actions?.flat().map((action) => action.text), ['新建', '刷新']);

    const autoAddress = { channelType: 'feishu', chatId: 'chat-empty-auto' } as const;
    router.createBinding(autoAddress, 'D:\\workspace\\empty-auto');
    await handleBridgeCommand(
      adapter,
      {
        address: autoAddress,
        text: '/auto ls',
        messageId: 'incoming-empty-auto-ls',
      } as any,
      '/auto ls',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.equal(richCards.at(-1)?.title, '当前聊天自动化任务（0）');
    assert.equal(richCards.at(-1)?.template, 'green');
    assert.equal(richCards.at(-1)?.table?.rows.length, 0);
    assert.equal(richCards.at(-1)?.selects, undefined);
    assert.deepEqual(richCards.at(-1)?.actions?.flat().map((action) => action.text), ['安装skill', '刷新']);
  });

  it('resolves /t bound-thread targets by unique name and rejects duplicate names', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-t-name-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-t-name' } as const;
    const first = router.createBinding(address, 'D:\\workspace\\first-name');
    const second = router.createBinding(address, 'D:\\workspace\\second-name');
    store.updateSession(first.bridgeSessionId, { name: '前端修复' });
    store.updateSession(second.bridgeSessionId, { name: '后端修复' });

    const deps = {
      getActiveTask: () => undefined,
      diagnoseSessionHealth: async () => null,
      diagnoseAllActiveSessions: async () => [],
    };

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t use 前端修复',
        messageId: 'incoming-t-use-name',
      } as any,
      '/t use 前端修复',
      deps,
    );

    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, first.id);
    assert.match(sent.at(-1) || '', /当前线程已切换/);

    store.updateSessionCodexThreadId(second.bridgeSessionId, first.id);
    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t use 后端修复',
        messageId: 'incoming-t-use-second-name',
      } as any,
      '/t use 后端修复',
      deps,
    );
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, second.id);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: `/t use ${first.id}`,
        messageId: 'incoming-t-use-binding-id-priority',
      } as any,
      `/t use ${first.id}`,
      deps,
    );
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, first.id);
    assert.match(sent.at(-1) || '', /当前线程已切换/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t 后端修复',
        messageId: 'incoming-t-direct-name',
      } as any,
      '/t 后端修复',
      deps,
    );
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, second.id);
    assert.match(sent.at(-1) || '', /当前线程已切换/);

    const codexTitleOnly = router.createBinding(address, 'D:\\workspace\\codex-title-only');
    store.updateSession(codexTitleOnly.bridgeSessionId, { name: '', codex_title: '标题回退' });

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t use 标题回退',
        messageId: 'incoming-t-use-codex-title-fallback',
      } as any,
      '/t use 标题回退',
      deps,
    );
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, codexTitleOnly.id);
    assert.match(sent.at(-1) || '', /当前线程已切换/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t detach 标题回退',
        messageId: 'incoming-t-rm-codex-title-fallback',
      } as any,
      '/t detach 标题回退',
      deps,
    );
    assert.equal(store.listChannelBindings().some((binding) => binding.id === codexTitleOnly.id), false);
    assert.match(sent.at(-1) || '', /已脱离绑定线程/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: `/t ${first.id}`,
        messageId: 'incoming-t-direct-binding-id-priority',
      } as any,
      `/t ${first.id}`,
      deps,
    );
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, first.id);
    assert.match(sent.at(-1) || '', /当前线程已切换/);

    store.updateSessionCodexThreadId(second.bridgeSessionId, '546754');
    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t use 546754',
        messageId: 'incoming-t-use-numeric-thread-id-fallback',
      } as any,
      '/t use 546754',
      deps,
    );
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, second.id);
    assert.match(sent.at(-1) || '', /当前线程已切换/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: `/t ${first.id}`,
        messageId: 'incoming-t-direct-binding-id-before-numeric-thread',
      } as any,
      `/t ${first.id}`,
      deps,
    );
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, first.id);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t 546754',
        messageId: 'incoming-t-direct-numeric-thread-id-fallback',
      } as any,
      '/t 546754',
      deps,
    );
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, second.id);
    assert.match(sent.at(-1) || '', /当前线程已切换/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t detach 后端修复',
        messageId: 'incoming-t-rm-name',
      } as any,
      '/t detach 后端修复',
      deps,
    );

    assert.equal(store.listChannelBindings().filter((binding) => binding.chatId === address.chatId).length, 1);
    assert.match(sent.at(-1) || '', /已脱离绑定线程/);

    const duplicate = router.createBinding(address, 'D:\\workspace\\duplicate-name');
    store.updateSession(duplicate.bridgeSessionId, { name: '前端修复' });

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t use 前端修复',
        messageId: 'incoming-t-use-duplicate-name',
      } as any,
      '/t use 前端修复',
      deps,
    );

    assert.match(sent.at(-1) || '', /匹配到多个绑定线程/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t 前端修复',
        messageId: 'incoming-t-direct-duplicate-name',
      } as any,
      '/t 前端修复',
      deps,
    );

    assert.match(sent.at(-1) || '', /匹配到多个/);
  });

  it('creates, lists, and removes /auto tasks on the current bridge session', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const richCards: OutboundRichCard[] = [];
    const started: string[] = [];
    const stopped: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string; richCard?: OutboundRichCard }) => {
        sent.push(message.text);
        if (message.richCard) richCards.push(message.richCard);
        return { ok: true, messageId: `reply-auto-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-auto' } as const;
    const first = router.createBinding(address, 'D:\\workspace\\auto-first');
    const second = router.createBinding(address, 'D:\\workspace\\auto-second');
    const scriptDir = path.join(process.env.CODEX_HOME!, 'auto-scripts');
    fs.mkdirSync(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, `cti-auto-${Date.now()}.sh`);
    fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\nprintf "check progress\\n"\n', 'utf-8');
    fs.chmodSync(scriptPath, 0o755);

    const deps = {
      getActiveTask: () => undefined,
      diagnoseSessionHealth: async () => null,
      diagnoseAllActiveSessions: async () => [],
      startAutoTask: (taskId: string) => { started.push(taskId); },
      stopAutoTask: (taskId: string) => { stopped.push(taskId); },
    };

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: `/auto new ${scriptPath} 3`,
        messageId: 'incoming-auto-new',
      } as any,
      `/auto new ${scriptPath} 3`,
      deps,
    );

    const secondTasks = listAutoTasks({ bridgeSessionId: second.bridgeSessionId, includeCompleted: true });
    assert.equal(secondTasks.length, 1);
    assert.equal(secondTasks[0].bridgeSessionId, second.bridgeSessionId);
    assert.equal((secondTasks[0] as any).bindingId, undefined);
    assert.deepEqual(started, [secondTasks[0].id]);
    assert.match(sent.at(-1) || '', /已创建自动化任务/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/auto ls',
        messageId: 'incoming-auto-ls',
      } as any,
      '/auto ls',
      deps,
    );

    assert.match(sent.at(-1) || '', /当前聊天自动化任务/);
    assert.match(sent.at(-1) || '', /session codex-id/);
    assert.equal(richCards.at(-1)?.template, 'green');
    assert.equal(richCards.at(-1)?.title, '当前聊天自动化任务（1）');
    assert.equal(richCards.at(-1)?.updateKey, `thread-card:auto:${address.channelType}:${address.chatId}`);
    assert.equal(richCards.at(-1)?.updateTtlMs, null);
    assert.equal(getThreadTableMessageRecord(address, 'auto')?.messageId, 'reply-auto-2');
    assert.deepEqual(richCards.at(-1)?.table?.columns.map((column) => column.name), [
      'index',
      'session_title',
      'script_path',
      'created_at',
      'triggered_count',
      'last_triggered_at',
      'times',
      'codex_id',
      'command',
    ]);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t use 1',
        messageId: 'incoming-auto-switch',
      } as any,
      '/t use 1',
      deps,
    );
    assert.equal(store.getChannelBinding(address.channelType, address.chatId)?.id, first.id);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/auto ls',
        messageId: 'incoming-auto-ls-first',
      } as any,
      '/auto ls',
      deps,
    );
    assert.match(sent.at(-1) || '', /当前聊天自动化任务/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/auto set 1 2',
        messageId: 'incoming-auto-set',
      } as any,
      '/auto set 1 2',
      deps,
    );
    assert.match(sent.at(-1) || '', /已更新自动化任务次数/);
    assert.equal(listAutoTasks({ bridgeSessionId: second.bridgeSessionId, includeCompleted: true })[0].times, 2);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t use 2',
        messageId: 'incoming-auto-switch-back',
      } as any,
      '/t use 2',
      deps,
    );
    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/auto rm 1',
        messageId: 'incoming-auto-rm',
      } as any,
      '/auto rm 1',
      deps,
    );

    assert.equal(listAutoTasks({ bridgeSessionId: second.bridgeSessionId, includeCompleted: true }).length, 0);
    assert.deepEqual(stopped, [secondTasks[0].id]);
    assert.match(sent.at(-1) || '', /已删除自动化任务/);
  });

  it('rejects /auto scripts outside Codex home', async () => {
    initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-auto-outside-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-auto-outside' } as const;
    router.createBinding(address, 'D:\\workspace\\auto-outside');
    const scriptPath = path.join(os.tmpdir(), `cti-auto-outside-${Date.now()}.sh`);
    fs.writeFileSync(scriptPath, '#!/usr/bin/env bash\nprintf "check progress\\n"\n', 'utf-8');
    fs.chmodSync(scriptPath, 0o755);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: `/auto new ${scriptPath} 1`,
        messageId: 'incoming-auto-outside-new',
      } as any,
      `/auto new ${scriptPath} 1`,
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.match(sent.at(-1) || '', /自动化脚本必须位于 Codex home 下/);
  });

  it('maps /stop to C-c for a running tmux provider mirror turn', async () => {
    const store = initTestContext();
    const fakeTmux = installFakeTmux();
    const oldPath = process.env.PATH || '';
    const oldFakeLog = process.env.TMUX_FAKE_LOG;
    process.env.PATH = `${fakeTmux.binDir}${path.delimiter}${oldPath}`;
    process.env.TMUX_FAKE_LOG = fakeTmux.logPath;
    const sent: string[] = [];
    const forcedStops: Array<{ sessionId: string; detail?: string }> = [];
    const adapter: any = {
      channelType: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-stop-tmux-provider' };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-stop-tmux-provider' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\stop-tmux-provider');
    store.updateSession(binding.bridgeSessionId, {
      codex_provider: 'tmux',
      tmux_session_name: 'alpha',
      mirror_status: 'watching',
      runtime_status: 'running',
      health_status: 'running_active',
    });

    try {
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/stop',
          messageId: 'incoming-stop-tmux-provider',
        } as any,
        '/stop',
        {
          getActiveTask: () => undefined,
          forceStopSession: async (sessionId, detail) => {
            forcedStops.push({ sessionId, detail });
            return false;
          },
          diagnoseSessionHealth: async () => null,
          diagnoseAllActiveSessions: async () => [],
        },
      );

      const log = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      assert.match(log, /send-keys -t alpha C-c/);
      assert.deepEqual(forcedStops, []);
      assert.match(sent[0] || '', /已发送停止按键/);
      assert.match(sent[0] || '', /tmux send-keys -t alpha C-c/);
    } finally {
      process.env.PATH = oldPath;
      if (oldFakeLog === undefined) {
        delete process.env.TMUX_FAKE_LOG;
      } else {
        process.env.TMUX_FAKE_LOG = oldFakeLog;
      }
      fs.rmSync(fakeTmux.binDir, { recursive: true, force: true });
    }
  });

  it('renames the current /t binding and rejects ambiguous identifier-like names', async () => {
    const store = initTestContext();
    const sent: string[] = [];
    const richCards: OutboundRichCard[] = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string; richCard?: OutboundRichCard }) => {
        sent.push(message.text);
        if (message.richCard) richCards.push(message.richCard);
        return { ok: true, messageId: `reply-rename-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu', chatId: 'chat-rename' } as const;
    const binding = router.createBinding(address, 'D:\\workspace\\rename');

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t rename 12345',
        messageId: 'incoming-rename-1',
      } as any,
      '/t rename 12345',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.equal(store.getSession(binding.bridgeSessionId)?.name, 'Bridge: chat-rename');
    assert.match(sent[0] || '', /名称不能是纯数字/);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/t rename 前端修复',
        messageId: 'incoming-rename-2',
      } as any,
      '/t rename 前端修复',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.equal(store.getSession(binding.bridgeSessionId)?.name, '前端修复');
    assert.match(sent[1] || '', /当前线程已重命名/);
    assert.match(sent[1] || '', /binding_id/);
    assert.equal(richCards.length, 0);
    assert.equal(fs.existsSync(path.join(DATA_DIR, 'ui-session-meta.json')), false);
  });

  it('prints file content with /cat and escapes embedded fences', async () => {
    initTestContext();
    const sent: string[] = [];
    const adapter: any = {
      channelType: 'feishu-default',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: 'reply-cat' };
      },
    };
    const address = { channelType: 'feishu-default', chatId: 'chat-cat' } as const;
    const tempRoot = fs.mkdtempSync(path.join(DATA_DIR, 'cti-cat-'));
    const filePath = path.join(tempRoot, 'demo.md');
    fs.writeFileSync(filePath, ['line1', '```', 'line3'].join('\n'), 'utf-8');
    router.createBinding(address, tempRoot);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/cat demo.md',
        messageId: 'incoming-cat',
      } as any,
      '/cat demo.md',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.match(sent[0] || '', /````text/);
  });

  it('sends a local file with /file', async () => {
    initTestContext();
    const sent: any[] = [];
    const adapter: any = {
      channelType: 'feishu-default',
      provider: 'feishu',
      send: async (message: any) => {
        sent.push(message);
        return { ok: true, messageId: `reply-${sent.length}` };
      },
    };
    const address = { channelType: 'feishu-default', chatId: 'chat-file' } as const;
    const tempRoot = fs.mkdtempSync(path.join(DATA_DIR, 'cti-file-'));
    const filePath = path.join(tempRoot, 'hello.txt');
    fs.writeFileSync(filePath, 'hello', 'utf-8');
    router.createBinding(address, tempRoot);

    await handleBridgeCommand(
      adapter,
      {
        address,
        text: '/file hello.txt',
        messageId: 'incoming-file',
      } as any,
      '/file hello.txt',
      {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      },
    );

    assert.ok(sent.some((m) => Array.isArray(m.attachments) && m.attachments.length === 1));
    assert.match(String(sent.at(-1)?.text || ''), /已发送文件/);
  });

  it('binds a tmux session, sends literal text and tmux-key special keys, and returns a capture', async () => {
    const store = initTestContext();
    const fakeTmux = installFakeTmux();
    const oldPath = process.env.PATH || '';
    const oldFakeLog = process.env.TMUX_FAKE_LOG;
    process.env.PATH = `${fakeTmux.binDir}${path.delimiter}${oldPath}`;
    process.env.TMUX_FAKE_LOG = fakeTmux.logPath;

    try {
      const sent: string[] = [];
      const richCards: any[] = [];
      const adapter: any = {
        channelType: 'feishu',
        send: async (message: { text: string; richCard?: any }) => {
          sent.push(message.text);
          if (message.richCard) richCards.push(message.richCard);
          return { ok: true, messageId: `reply-tmux-${sent.length}` };
        },
      };
      const address = { channelType: 'feishu', chatId: 'chat-tmux' } as const;
      const deps = {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      };

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-switch',
          messageId: 'incoming-tmux-switch',
        } as any,
        '/tmux-switch',
        deps,
      );
      assert.match(sent.at(-1) || '', /alpha/);
      assert.match(sent.at(-1) || '', /\/tmux-attach <session>|\/tmux-attach &lt;session&gt;/);
      assert.match(sent.at(-1) || '', /真实 tmux 底层命令/);
      assert.match(sent.at(-1) || '', /tmux list-sessions -F/);
      assert.equal(richCards.at(-1)?.title, 'tmux session 选择');
      assert.deepEqual(
        richCards.at(-1)?.table?.columns?.map((column: any) => column.name),
        ['session', 'windows', 'attached', 'command'],
      );
      assert.equal(richCards.at(-1)?.table?.freezeFirstColumn, false);
      assert.equal(richCards.at(-1)?.table?.rows?.[0]?.session, 'alpha');
      assert.match(richCards.at(-1)?.table?.rows?.[0]?.command || '', /^\/tmux-attach /);
      assert.equal(richCards.at(-1)?.selects?.[0]?.options?.[0]?.text, 'alpha');
      assert.match(richCards.at(-1)?.selects?.[0]?.options?.[0]?.callbackData || '', /^cti-command:/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-attach alpha',
          messageId: 'incoming-tmux-attach',
        } as any,
        '/tmux-attach alpha',
        deps,
      );
      const binding = store.getChannelBinding(address.channelType, address.chatId);
      assert.ok(binding);
      const session = binding ? store.getSession(binding.bridgeSessionId) : null;
      assert.equal(session?.tmux_session_name, 'alpha');
      assert.match(sent.at(-1) || '', /已绑定 tmux session/);
      assert.match(sent.at(-1) || '', /```sh/);
      assert.match(sent.at(-1) || '', /alpha-screen/);
      assert.match(sent.at(-1) || '', /tmux has-session -t alpha/);
      assert.match(sent.at(-1) || '', /tmux capture-pane -t alpha -p -S -0/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-set lines 120',
          messageId: 'incoming-tmux-set',
        } as any,
        '/tmux-set lines 120',
        deps,
      );
      const updatedSession = binding ? store.getSession(binding.bridgeSessionId) : null;
      assert.equal(updatedSession?.tmux_capture_lines, 120);
      assert.doesNotMatch(sent.at(-1) || '', /真实 tmux 底层命令/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-set enter on',
          messageId: 'incoming-tmux-set-enter-on',
        } as any,
        '/tmux-set enter on',
        deps,
      );
      const autoEnterSession = binding ? store.getSession(binding.bridgeSessionId) : null;
      assert.equal(autoEnterSession?.tmux_auto_enter, true);
      assert.match(sent.at(-1) || '', /自动回车.*on/s);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux echo auto',
          messageId: 'incoming-tmux-auto-enter',
        } as any,
        '/tmux echo auto',
        deps,
      );
      const autoEnterResponse = sent.at(-1) || '';
      assert.match(autoEnterResponse, /tmux send-keys -t alpha -l 'echo auto'/);
      assert.match(autoEnterResponse, /tmux send-keys -t alpha Enter/);

      const beforeExplicitEnterLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      const beforeExplicitEnterCount = (beforeExplicitEnterLog.match(/send-keys -t alpha Enter/g) || []).length;
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux echo <literal>',
          messageId: 'incoming-tmux-auto-enter-explicit',
        } as any,
        '/tmux echo <literal>',
        deps,
      );
      const afterExplicitEnterLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      const afterExplicitEnterCount = (afterExplicitEnterLog.match(/send-keys -t alpha Enter/g) || []).length;
      assert.equal(afterExplicitEnterCount - beforeExplicitEnterCount, 1);
      const explicitEnterLogDelta = afterExplicitEnterLog.slice(beforeExplicitEnterLog.length);
      assert.match(explicitEnterLogDelta, /send-keys -t alpha -l echo <literal>/);

      const beforeKeyOnlyLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux <C-c>',
          messageId: 'incoming-tmux-direct-key-only',
        } as any,
        '/tmux <C-c>',
        deps,
      );
      const keyOnlyResponse = sent.at(-1) || '';
      assert.match(keyOnlyResponse, /tmux send-keys -t alpha C-c/);
      assert.doesNotMatch(keyOnlyResponse, /tmux send-keys -t alpha -l '<C-c>'/);
      const keyOnlyLogDelta = fs.readFileSync(fakeTmux.logPath, 'utf-8').slice(beforeKeyOnlyLog.length);
      assert.match(keyOnlyLogDelta, /send-keys -t alpha C-c/);
      assert.doesNotMatch(keyOnlyLogDelta, /send-keys -t alpha Enter/);
      assert.doesNotMatch(keyOnlyLogDelta, /send-keys -t alpha -l <C-c>/);

      const beforeKeySequenceLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux <C-c><Enter>',
          messageId: 'incoming-tmux-direct-key-sequence',
        } as any,
        '/tmux <C-c><Enter>',
        deps,
      );
      const keySequenceResponse = sent.at(-1) || '';
      assert.match(keySequenceResponse, /tmux send-keys -t alpha C-c/);
      assert.match(keySequenceResponse, /tmux send-keys -t alpha Enter/);
      assert.doesNotMatch(keySequenceResponse, /tmux send-keys -t alpha -l '<C-c><Enter>'/);
      const keySequenceLogDelta = fs.readFileSync(fakeTmux.logPath, 'utf-8').slice(beforeKeySequenceLog.length);
      assert.match(keySequenceLogDelta, /send-keys -t alpha C-c/);
      assert.match(keySequenceLogDelta, /send-keys -t alpha Enter/);
      assert.doesNotMatch(keySequenceLogDelta, /send-keys -t alpha -l <C-c><Enter>/);

      const beforeMixedDirectLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux <C-c> hello',
          messageId: 'incoming-tmux-direct-mixed-falls-back-literal',
        } as any,
        '/tmux <C-c> hello',
        deps,
      );
      const mixedDirectResponse = sent.at(-1) || '';
      assert.match(mixedDirectResponse, /tmux send-keys -t alpha -l '<C-c> hello'/);
      assert.match(mixedDirectResponse, /tmux send-keys -t alpha Enter/);
      const mixedDirectLogDelta = fs.readFileSync(fakeTmux.logPath, 'utf-8').slice(beforeMixedDirectLog.length);
      assert.match(mixedDirectLogDelta, /send-keys -t alpha -l <C-c> hello/);
      assert.doesNotMatch(mixedDirectLogDelta, /send-keys -t alpha C-c/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-set enter off',
          messageId: 'incoming-tmux-set-enter-off',
        } as any,
        '/tmux-set enter off',
        deps,
      );
      const autoEnterOffSession = binding ? store.getSession(binding.bridgeSessionId) : null;
      assert.equal(autoEnterOffSession?.tmux_auto_enter, false);

      const beforeAutoEnterOffLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux echo off',
          messageId: 'incoming-tmux-auto-enter-off',
        } as any,
        '/tmux echo off',
        deps,
      );
      const autoEnterOffResponse = sent.at(-1) || '';
      assert.match(autoEnterOffResponse, /tmux send-keys -t alpha -l 'echo off'/);
      assert.doesNotMatch(autoEnterOffResponse, /tmux send-keys -t alpha Enter/);
      const afterAutoEnterOffLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      const autoEnterOffLogDelta = afterAutoEnterOffLog.slice(beforeAutoEnterOffLog.length);
      assert.match(autoEnterOffLogDelta, /send-keys -t alpha -l echo off/);
      assert.doesNotMatch(autoEnterOffLogDelta, /send-keys -t alpha Enter/);

      const beforeScreenLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen',
          messageId: 'incoming-screen',
        } as any,
        '/tmux-screen',
        deps,
      );
      const screenResponse = sent.at(-1) || '';
      assert.match(screenResponse, /tmux 当前屏幕状态/);
      assert.match(screenResponse, /```sh/);
      assert.match(screenResponse, /alpha-screen/);
      assert.match(screenResponse, /真实 tmux 底层命令/);
      assert.match(screenResponse, /tmux capture-pane -t alpha -p -S -120/);
      const screenLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      const screenLogDelta = screenLog.slice(beforeScreenLog.length);
      assert.match(screenLogDelta, /capture-pane -t alpha -p -S -120/);
      assert.doesNotMatch(screenLogDelta, /send-keys/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen 42',
          messageId: 'incoming-screen-lines',
        } as any,
        '/tmux-screen 42',
        deps,
      );
      const tempLinesResponse = sent.at(-1) || '';
      assert.match(tempLinesResponse, /展示行数.*42/s);
      assert.match(tempLinesResponse, /tmux capture-pane -t alpha -p -S -42/);
      const afterTempLinesSession = binding ? store.getSession(binding.bridgeSessionId) : null;
      assert.equal(afterTempLinesSession?.tmux_capture_lines, 120);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen 5s',
          messageId: 'incoming-screen-watch-default-lines',
        } as any,
        '/tmux-screen 5s',
        deps,
      );
      const defaultLinesWatchResponse = sent.at(-1) || '';
      assert.match(defaultLinesWatchResponse, /展示行数.*120/s);
      assert.match(defaultLinesWatchResponse, /定时刷新.*5s/s);
      assert.match(defaultLinesWatchResponse, /tmux capture-pane -t alpha -p -S -120/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen 30 1s',
          messageId: 'incoming-screen-watch',
        } as any,
        '/tmux-screen 30 1s',
        deps,
      );
      const watchResponse = sent.at(-1) || '';
      assert.match(watchResponse, /展示行数.*30/s);
      assert.match(watchResponse, /定时刷新.*3s/s);
      assert.match(watchResponse, /\/tmux-screen stop/);
      assert.match(watchResponse, /tmux capture-pane -t alpha -p -S -30/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen lines 120 every 5s',
          messageId: 'incoming-screen-invalid-legacy',
        } as any,
        '/tmux-screen lines 120 every 5s',
        deps,
      );
      assert.match(sent.at(-1) || '', /tmux 屏幕用法/);
      assert.doesNotMatch(sent.at(-1) || '', /lines 120 every/);
      assert.doesNotMatch(sent.at(-1) || '', /真实 tmux 底层命令/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen stop',
          messageId: 'incoming-screen-stop',
        } as any,
        '/tmux-screen stop',
        deps,
      );
      assert.match(sent.at(-1) || '', /已停止 tmux 屏幕定时刷新/);
      assert.doesNotMatch(sent.at(-1) || '', /真实 tmux 底层命令/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-key /goal 分析一下这个仓库<Enter>',
          messageId: 'incoming-tmux-slash-send',
        } as any,
        '/tmux-key /goal 分析一下这个仓库<Enter>',
        deps,
      );

      const slashResponse = sent.at(-1) || '';
      assert.match(slashResponse, /真实 tmux 底层命令/);
      assert.match(slashResponse, /tmux send-keys -t alpha -l '\/goal 分析一下这个仓库'/);
      assert.match(slashResponse, /tmux send-keys -t alpha Enter/);
      assert.doesNotMatch(slashResponse, /Option\/Alt/);

      const slashCommandLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      assert.match(slashCommandLog, /send-keys -t alpha -l \/goal 分析一下这个仓库/);
      assert.match(slashCommandLog, /send-keys -t alpha Enter/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-key <Cmd+Backspace>',
          messageId: 'incoming-tmux-delete-line',
        } as any,
        '/tmux-key <Cmd+Backspace>',
        deps,
      );
      const deleteLineResponse = sent.at(-1) || '';
      assert.match(deleteLineResponse, /tmux send-keys -t alpha C-u/);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-key pwd<Enter><Cmd+C>',
          messageId: 'incoming-tmux-send',
        } as any,
        '/tmux-key pwd<Enter><Cmd+C>',
        deps,
      );

      const response = sent.at(-1) || '';
      assert.match(response, /```sh/);
      assert.match(response, /alpha-screen/);
      assert.match(response, /真实 tmux 底层命令/);
      assert.match(response, /tmux send-keys -t alpha -l pwd/);
      assert.match(response, /tmux send-keys -t alpha Enter/);
      assert.match(response, /tmux send-keys -t alpha C-c/);
      assert.doesNotMatch(response, /Option\/Alt/);

      const log = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      assert.match(log, /send-keys -t alpha -l pwd/);
      assert.match(log, /send-keys -t alpha -l echo auto/);
      assert.match(log, /send-keys -t alpha -l echo <literal>/);
      assert.match(log, /send-keys -t alpha -l <C-c> hello/);
      assert.match(log, /send-keys -t alpha -l echo off/);
      assert.match(log, /send-keys -t alpha Enter/);
      assert.match(log, /send-keys -t alpha C-c/);
      assert.match(log, /send-keys -t alpha C-u/);
      assert.match(log, /capture-pane -t alpha -p -S -120/);
      assert.match(log, /capture-pane -t alpha -p -S -42/);
      assert.match(log, /capture-pane -t alpha -p -S -30/);
    } finally {
      process.env.PATH = oldPath;
      if (oldFakeLog === undefined) {
        delete process.env.TMUX_FAKE_LOG;
      } else {
        process.env.TMUX_FAKE_LOG = oldFakeLog;
      }
      fs.rmSync(fakeTmux.binDir, { recursive: true, force: true });
    }
  });

  it('routes /tmux angle-bracket stories as all-key or all-literal commands', async () => {
    initTestContext();
    const fakeTmux = installFakeTmux();
    const oldPath = process.env.PATH || '';
    const oldFakeLog = process.env.TMUX_FAKE_LOG;
    process.env.PATH = `${fakeTmux.binDir}${path.delimiter}${oldPath}`;
    process.env.TMUX_FAKE_LOG = fakeTmux.logPath;

    try {
      const sent: string[] = [];
      const adapter: any = {
        channelType: 'feishu',
        send: async (message: { text: string }) => {
          sent.push(message.text);
          return { ok: true, messageId: `reply-tmux-story-${sent.length}` };
        },
      };
      const address = { channelType: 'feishu', chatId: 'chat-tmux-angle-story' } as const;
      const deps = {
        getActiveTask: () => undefined,
        diagnoseSessionHealth: async () => null,
        diagnoseAllActiveSessions: async () => [],
      };

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-attach alpha',
          messageId: 'incoming-tmux-story-attach',
        } as any,
        '/tmux-attach alpha',
        deps,
      );

      const beforeStoryLog = fs.readFileSync(fakeTmux.logPath, 'utf-8');
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux 命令1：使用<qaq>',
          messageId: 'incoming-tmux-story-literal-1',
        } as any,
        '/tmux 命令1：使用<qaq>',
        deps,
      );
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux <C-c>',
          messageId: 'incoming-tmux-story-key',
        } as any,
        '/tmux <C-c>',
        deps,
      );
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux 忽略刚才的命令，转而使用<waw>',
          messageId: 'incoming-tmux-story-literal-2',
        } as any,
        '/tmux 忽略刚才的命令，转而使用<waw>',
        deps,
      );

      const storyLog = fs.readFileSync(fakeTmux.logPath, 'utf-8').slice(beforeStoryLog.length);
      assert.match(storyLog, /send-keys -t alpha -l 命令1：使用<qaq>/);
      assert.match(storyLog, /send-keys -t alpha C-c/);
      assert.match(storyLog, /send-keys -t alpha -l 忽略刚才的命令，转而使用<waw>/);
      assert.doesNotMatch(storyLog, /send-keys -t alpha qaq/);
      assert.doesNotMatch(storyLog, /send-keys -t alpha waw/);

      assert.match(sent.at(-3) || '', /tmux send-keys -t alpha -l '命令1：使用<qaq>'/);
      assert.match(sent.at(-2) || '', /tmux send-keys -t alpha C-c/);
      assert.doesNotMatch(sent.at(-2) || '', /tmux send-keys -t alpha -l '<C-c>'/);
      assert.match(sent.at(-1) || '', /tmux send-keys -t alpha -l '忽略刚才的命令，转而使用<waw>'/);
    } finally {
      process.env.PATH = oldPath;
      if (oldFakeLog === undefined) {
        delete process.env.TMUX_FAKE_LOG;
      } else {
        process.env.TMUX_FAKE_LOG = oldFakeLog;
      }
      fs.rmSync(fakeTmux.binDir, { recursive: true, force: true });
    }
  });

  it('updates a streaming card for timed tmux screen refresh when supported', async () => {
    const store = initTestContext();
    const fakeTmux = installFakeTmux();
    const oldPath = process.env.PATH || '';
    const oldFakeLog = process.env.TMUX_FAKE_LOG;
    process.env.PATH = `${fakeTmux.binDir}${path.delimiter}${oldPath}`;
    process.env.TMUX_FAKE_LOG = fakeTmux.logPath;

    const address = { channelType: 'feishu', chatId: 'chat-tmux-card' } as const;
    const sent: string[] = [];
    const cardTexts: Array<{ chatId: string; text: string; streamKey?: string }> = [];
    const cardStatuses: Array<{ chatId: string; text: string; streamKey?: string }> = [];
    const cardActions: Array<{ chatId: string; actions: any[][]; streamKey?: string }> = [];
    const cardEnds: Array<{ chatId: string; status: string; text: string; streamKey?: string }> = [];
    const adapter: any = {
      channelType: 'feishu',
      provider: 'feishu',
      send: async (message: { text: string }) => {
        sent.push(message.text);
        return { ok: true, messageId: `reply-tmux-card-${sent.length}` };
      },
      supportsStructuredStreamingUi: () => true,
      onStreamText: (chatId: string, text: string, streamKey?: string) => {
        cardTexts.push({ chatId, text, streamKey });
      },
      onStreamStatus: (chatId: string, text: string, streamKey?: string) => {
        cardStatuses.push({ chatId, text, streamKey });
      },
      onStreamActions: (chatId: string, actions: any[][], streamKey?: string) => {
        cardActions.push({ chatId, actions, streamKey });
      },
      onStreamEnd: async (chatId: string, status: string, text: string, streamKey?: string) => {
        cardEnds.push({ chatId, status, text, streamKey });
        return true;
      },
    };
    const deps = {
      getActiveTask: () => undefined,
      diagnoseSessionHealth: async () => null,
      diagnoseAllActiveSessions: async () => [],
    };
    let monitorStarted = false;

    try {
      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-attach alpha',
          messageId: 'incoming-tmux-card-attach',
        } as any,
        '/tmux-attach alpha',
        deps,
      );
      sent.length = 0;

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen 5s',
          messageId: 'incoming-tmux-card-screen',
        } as any,
        '/tmux-screen 5s',
        deps,
      );
      monitorStarted = true;

      assert.equal(sent.length, 0);
      assert.equal(cardTexts.length, 1);
      assert.equal(cardTexts[0].chatId, address.chatId);
      assert.match(cardTexts[0].streamKey || '', /^tmux-screen:/);
      assert.match(cardTexts[0].text, /tmux 当前屏幕状态/);
      assert.match(cardTexts[0].text, /alpha-screen/);
      assert.match(cardTexts[0].text, /定时刷新.*5s/s);
      assert.doesNotMatch(cardTexts[0].text, /真实 tmux 底层命令/);
      assert.equal(cardStatuses.length, 1);
      assert.match(cardStatuses[0].text, /tmux alpha/);
      assert.match(cardStatuses[0].text, /every 5s/);
      assert.equal(cardActions.length, 1);
      assert.equal(cardActions[0].chatId, address.chatId);
      assert.equal(cardActions[0].streamKey, cardTexts[0].streamKey);
      assert.equal(cardActions[0].actions[0][0].text, '停止');
      assert.match(cardActions[0].actions[0][0].callbackData, /^tmux-screen:stop:/);
      assert.equal(cardActions[0].actions[0][0].type, 'danger');
      assert.equal(cardActions[0].actions[0][0].disabled, false);

      await handleBridgeCommand(
        adapter,
        {
          address,
          text: '/tmux-screen stop',
          messageId: 'incoming-tmux-card-stop',
        } as any,
        '/tmux-screen stop',
        deps,
      );
      monitorStarted = false;

      assert.match(sent.at(-1) || '', /已停止 tmux 屏幕定时刷新/);
      assert.equal(cardActions.length, 2);
      assert.equal(cardActions[1].actions[0][0].text, '已停止');
      assert.equal(cardActions[1].actions[0][0].disabled, true);
      assert.equal(cardEnds.length, 1);
      assert.equal(cardEnds[0].chatId, address.chatId);
      assert.equal(cardEnds[0].status, 'interrupted');
      assert.match(cardEnds[0].text, /已停止 tmux 屏幕定时刷新/);
      assert.equal(cardEnds[0].streamKey, cardTexts[0].streamKey);
    } finally {
      if (monitorStarted) {
        await handleBridgeCommand(
          adapter,
          {
            address,
            text: '/tmux-screen stop',
            messageId: 'incoming-tmux-card-cleanup',
          } as any,
          '/tmux-screen stop',
          deps,
        );
      }
      process.env.PATH = oldPath;
      if (oldFakeLog === undefined) {
        delete process.env.TMUX_FAKE_LOG;
      } else {
        process.env.TMUX_FAKE_LOG = oldFakeLog;
      }
      fs.rmSync(fakeTmux.binDir, { recursive: true, force: true });
    }
  });
});
