import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let createdTempHome: string | null = null;

function isManagedTestHome(value: string | undefined): boolean {
  if (!value) return false;
  const resolved = path.resolve(value);
  const tmpRoot = path.resolve(os.tmpdir());
  return resolved.startsWith(tmpRoot)
    && path.basename(resolved).startsWith('codex-to-im-test-');
}

if (
  !process.env.CTI_HOME
  || (
    process.env.CTI_TEST_ALLOW_EXTERNAL_HOME !== '1'
    && !isManagedTestHome(process.env.CTI_HOME)
  )
) {
  createdTempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-to-im-test-'));
  process.env.CTI_HOME = createdTempHome;
}

process.env.CTI_DISABLE_OUTBOUND_RATE_LIMIT = process.env.CTI_DISABLE_OUTBOUND_RATE_LIMIT || '1';

if (!process.env.CODEX_HOME) {
  const codexHome = path.join(process.env.CTI_HOME!, 'codex-home');
  fs.mkdirSync(codexHome, { recursive: true });
  process.env.CODEX_HOME = codexHome;
  try {
    fs.writeFileSync(path.join(codexHome, 'models_cache.json'), JSON.stringify({
      models: [
        { slug: 'gpt-5.4', display_name: 'gpt-5.4', visibility: 'list', supported_in_api: true },
        { slug: 'gpt-5.3-codex-spark', display_name: 'gpt-5.3-codex-spark', visibility: 'list', supported_in_api: false },
      ],
    }), 'utf-8');
  } catch {}
}

if (createdTempHome) {
  process.on('exit', () => {
    try {
      fs.rmSync(createdTempHome!, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures in tests
    }
  });
}
