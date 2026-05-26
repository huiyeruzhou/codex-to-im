import './test-setup.js';
import { describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  buildCodexTuiArgs,
  injectPromptIntoTmuxPane,
  isTruthyEnv,
  parsePositiveIntEnv,
  shouldUseCodexTmuxTui,
} from '../codex-tmux-provider.js';

const execFileAsync = promisify(execFile);

async function tmuxAvailable(): Promise<boolean> {
  try {
    await execFileAsync('tmux', ['-V']);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

async function waitForFile(filePath: string, timeoutMs = 5_000): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (fs.existsSync(filePath)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

describe('codex-tmux-provider', () => {
  it('parses truthy env values for the tmux TUI switch', () => {
    assert.equal(isTruthyEnv('true'), true);
    assert.equal(isTruthyEnv('1'), true);
    assert.equal(isTruthyEnv('yes'), true);
    assert.equal(isTruthyEnv('on'), true);
    assert.equal(isTruthyEnv('false'), false);
    assert.equal(isTruthyEnv(undefined), false);
  });

  it('uses env fallbacks when optional integer values are unset or empty', () => {
    const oldValue = process.env.CTI_TEST_INT;
    try {
      delete process.env.CTI_TEST_INT;
      assert.equal(parsePositiveIntEnv('CTI_TEST_INT', 1200, 0), 1200);

      process.env.CTI_TEST_INT = '';
      assert.equal(parsePositiveIntEnv('CTI_TEST_INT', 1200, 0), 1200);

      process.env.CTI_TEST_INT = '0';
      assert.equal(parsePositiveIntEnv('CTI_TEST_INT', 1200, 0), 0);

      process.env.CTI_TEST_INT = '2500';
      assert.equal(parsePositiveIntEnv('CTI_TEST_INT', 1200, 0), 2500);
    } finally {
      if (oldValue === undefined) delete process.env.CTI_TEST_INT;
      else process.env.CTI_TEST_INT = oldValue;
    }
  });

  it('enables the tmux TUI provider path from supported env aliases', () => {
    const oldUseTmux = process.env.CTI_CODEX_USE_TMUX_TUI;
    const oldTmuxTui = process.env.CTI_CODEX_TMUX_TUI;
    const oldTui = process.env.CTI_CODEX_TUI;
    try {
      delete process.env.CTI_CODEX_USE_TMUX_TUI;
      delete process.env.CTI_CODEX_TMUX_TUI;
      delete process.env.CTI_CODEX_TUI;
      assert.equal(shouldUseCodexTmuxTui(), false);

      process.env.CTI_CODEX_USE_TMUX_TUI = 'true';
      assert.equal(shouldUseCodexTmuxTui(), true);

      delete process.env.CTI_CODEX_USE_TMUX_TUI;
      process.env.CTI_CODEX_TMUX_TUI = '1';
      assert.equal(shouldUseCodexTmuxTui(), true);

      delete process.env.CTI_CODEX_TMUX_TUI;
      process.env.CTI_CODEX_TUI = 'yes';
      assert.equal(shouldUseCodexTmuxTui(), true);
    } finally {
      if (oldUseTmux === undefined) delete process.env.CTI_CODEX_USE_TMUX_TUI;
      else process.env.CTI_CODEX_USE_TMUX_TUI = oldUseTmux;
      if (oldTmuxTui === undefined) delete process.env.CTI_CODEX_TMUX_TUI;
      else process.env.CTI_CODEX_TMUX_TUI = oldTmuxTui;
      if (oldTui === undefined) delete process.env.CTI_CODEX_TUI;
      else process.env.CTI_CODEX_TUI = oldTui;
    }
  });

  it('builds TUI args for resume without the exec-only skip-git flag', () => {
    const oldSkipGit = process.env.CTI_CODEX_SKIP_GIT_REPO_CHECK;
    const oldBaseUrl = process.env.CTI_CODEX_BASE_URL;
    try {
      process.env.CTI_CODEX_SKIP_GIT_REPO_CHECK = 'true';
      process.env.CTI_CODEX_BASE_URL = 'https://codex.example.test/v1';

      const args = buildCodexTuiArgs({
        prompt: 'hello',
        sessionId: 'bridge-session',
        sdkSessionId: '019e46bc-f466-71d3-a186-a2ce89051958',
        model: 'gpt-5-codex',
        forceModel: true,
        sandboxMode: 'workspace-write',
        networkAccessEnabled: true,
        modelReasoningEffort: 'high',
        workingDirectory: '/tmp/work',
        permissionMode: 'acceptEdits',
      }, ['/tmp/a.png']);

      assert.deepEqual(args.slice(0, 6), [
        '--model',
        'gpt-5-codex',
        '--sandbox',
        'workspace-write',
        '--cd',
        '/tmp/work',
      ]);
      assert.equal(args.includes('--skip-git-repo-check'), false);
      assert.ok(args.includes('skip_git_repo_check=true'));
      assert.ok(args.includes('sandbox_workspace_write.network_access=true'));
      assert.ok(args.includes('model_reasoning_effort="high"'));
      assert.ok(args.includes('openai_base_url="https://codex.example.test/v1"'));
      assert.deepEqual(args.slice(-4), [
        '--image',
        '/tmp/a.png',
        'resume',
        '019e46bc-f466-71d3-a186-a2ce89051958',
      ]);
    } finally {
      if (oldSkipGit === undefined) delete process.env.CTI_CODEX_SKIP_GIT_REPO_CHECK;
      else process.env.CTI_CODEX_SKIP_GIT_REPO_CHECK = oldSkipGit;
      if (oldBaseUrl === undefined) delete process.env.CTI_CODEX_BASE_URL;
      else process.env.CTI_CODEX_BASE_URL = oldBaseUrl;
    }
  });

  it('builds TUI args for yolo mode with the dangerous bypass flag', () => {
    const args = buildCodexTuiArgs({
      prompt: 'hello',
      sessionId: 'bridge-session',
      sandboxMode: 'workspace-write',
      workingDirectory: '/tmp/work',
      permissionMode: 'never',
      codexMode: 'yolo',
    }, []);

    assert.ok(args.includes('--dangerously-bypass-approvals-and-sandbox'));
    assert.equal(args.includes('--ask-for-approval'), false);
    assert.equal(args.includes('--sandbox'), false);
  });

  it('injects prompt into a real tmux pane with Option+Enter newlines and Enter submit', async (t: TestContext) => {
    if (!(await tmuxAvailable())) {
      t.skip('tmux is not available');
      return;
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-tmux-inject-'));
    const sessionName = `cti-test-${process.pid}-${Date.now()}`;
    const readyPath = path.join(tempDir, 'ready');
    const outputPath = path.join(tempDir, 'output.hex');
    const scriptPath = path.join(tempDir, 'capture-stdin.cjs');
    const expectedHex = Buffer.from('hello').toString('hex') + '1b0d' + Buffer.from('world').toString('hex') + '0d';
    const expectedLength = expectedHex.length / 2;

    fs.writeFileSync(scriptPath, [
      "const fs = require('node:fs');",
      `const readyPath = ${JSON.stringify(readyPath)};`,
      `const outputPath = ${JSON.stringify(outputPath)};`,
      `const expectedLength = ${expectedLength};`,
      'const chunks = [];',
      'process.stdin.setRawMode(true);',
      'process.stdin.resume();',
      "fs.writeFileSync(readyPath, '1');",
      "process.stdin.on('data', (chunk) => {",
      '  chunks.push(...chunk);',
      '  if (chunks.length >= expectedLength) {',
      "    fs.writeFileSync(outputPath, Buffer.from(chunks).toString('hex'));",
      '    process.exit(0);',
      '  }',
      '});',
      'setTimeout(() => {',
      "  fs.writeFileSync(outputPath, Buffer.from(chunks).toString('hex'));",
      '  process.exit(2);',
      '}, 5000);',
      '',
    ].join('\n'), 'utf-8');

    try {
      await execFileAsync('tmux', [
        'new-session',
        '-d',
        '-s',
        sessionName,
        '--',
        `${shellQuote(process.execPath)} ${shellQuote(scriptPath)}`,
      ]);

      assert.equal(await waitForFile(readyPath), true, 'capture process should become ready');
      await injectPromptIntoTmuxPane(`${sessionName}:0.0`, 'hello\nworld');
      assert.equal(await waitForFile(outputPath), true, 'capture process should write received bytes');

      const receivedHex = fs.readFileSync(outputPath, 'utf-8').trim();
      assert.equal(receivedHex, expectedHex);
    } finally {
      await execFileAsync('tmux', ['kill-session', '-t', sessionName]).catch(() => undefined);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
