import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface HotUpdateRunRequest {
  cwd: string;
  scriptPath: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export type HotUpdateRunner = (request: HotUpdateRunRequest) => Promise<{
  stdout: string;
  stderr: string;
}>;

function usage(): string {
  return [
    '用法：/hot-update [--pull] [--skip-tests] [--dry-run]',
    '默认只派发 detached hot update，不 pull、不跳过测试。',
    '`--pull` 会让 hot update worker 先执行 git pull。',
    '`--skip-tests` 会跳过 hot update worker 中的 npm test。',
    '`--dry-run` 只校验和打印计划，不派发 worker、不重启 bridge。',
  ].join('\n');
}

function parseHotUpdateArgs(rawArgs: string): { ok: true; args: string[]; summary: string; dryRun: boolean } | { ok: false; message: string } {
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
  const args: string[] = [];
  let pull = false;
  let skipTests = false;
  let dryRun = false;

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (normalized === 'help' || normalized === '--help' || normalized === '-h') {
      return { ok: false, message: usage() };
    }
    if (normalized === 'pull' || normalized === '--pull') {
      if (!pull) args.push('--pull');
      pull = true;
      continue;
    }
    if (normalized === 'skip-tests' || normalized === '--skip-tests' || normalized === 'skip') {
      if (!skipTests) args.push('--skip-tests');
      skipTests = true;
      continue;
    }
    if (normalized === 'dry-run' || normalized === '--dry-run' || normalized === 'dryrun') {
      if (!dryRun) args.push('--dry-run');
      dryRun = true;
      continue;
    }
    if (normalized === '--run') {
      return { ok: false, message: '不能通过 IM 命令传 `--run`。热更新必须由脚本默认入口派发 detached worker。' };
    }
    return { ok: false, message: [`未知参数：${token}`, usage()].join('\n') };
  }

  return {
    ok: true,
    args,
    summary: `pull: ${pull ? 'yes' : 'no'}；skip tests: ${skipTests ? 'yes' : 'no'}；dry-run: ${dryRun ? 'yes' : 'no'}`,
    dryRun,
  };
}

function isCodexToImProjectDir(dir: string): boolean {
  const scriptPath = path.join(dir, 'scripts', 'hot-update-bridge.sh');
  const packagePath = path.join(dir, 'package.json');
  if (!fs.existsSync(scriptPath) || !fs.existsSync(packagePath)) return false;

  try {
    const parsed = JSON.parse(fs.readFileSync(packagePath, 'utf-8')) as { name?: unknown };
    return parsed.name === 'codex-to-im';
  } catch {
    return false;
  }
}

function findProjectDir(startCwd: string): string | null {
  let current = path.resolve(startCwd);
  while (true) {
    if (isCodexToImProjectDir(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const defaultHotUpdateRunner: HotUpdateRunner = async (request) => {
  const result = await execFileAsync('bash', [request.scriptPath, ...request.args], {
    cwd: request.cwd,
    env: request.env,
    timeout: 30_000,
    maxBuffer: 256 * 1024,
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
};

function formatCommand(scriptPath: string, args: string[]): string {
  const relativeScriptPath = path.join('scripts', path.basename(scriptPath));
  return ['bash', relativeScriptPath, ...args].join(' ');
}

export async function handleHotUpdateCommand(options: {
  args: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  runner?: HotUpdateRunner;
}): Promise<string> {
  const parsedArgs = parseHotUpdateArgs(options.args);
  if (!parsedArgs.ok) return parsedArgs.message;

  const projectDir = findProjectDir(options.cwd || process.cwd());
  if (!projectDir) {
    return '热更新派发失败：当前路径不是 codex-to-im 项目，也没有在父目录中找到 `scripts/hot-update-bridge.sh`。';
  }

  const scriptPath = path.join(projectDir, 'scripts', 'hot-update-bridge.sh');
  try {
    const runner = options.runner || defaultHotUpdateRunner;
    const result = await runner({
      cwd: projectDir,
      scriptPath,
      args: parsedArgs.args,
      env: options.env || process.env,
    });
    const output = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');
    return [
      parsedArgs.dryRun ? 'Codex-to-IM 热更新 dry-run 通过。' : '已派发 Codex-to-IM 热更新。',
      `执行目录：${projectDir}`,
      `命令：${formatCommand(scriptPath, parsedArgs.args)}`,
      `参数：${parsedArgs.summary}`,
      output ? ['', output].join('\n') : '',
    ].filter(Boolean).join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      '热更新派发失败。',
      `执行目录：${projectDir}`,
      `命令：${formatCommand(scriptPath, parsedArgs.args)}`,
      `错误：${message}`,
    ].join('\n');
  }
}
