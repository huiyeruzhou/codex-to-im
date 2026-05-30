import './test-setup.js';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..', '..');
const schemasDir = path.join(rootDir, 'schemas');

function listJsonFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsonFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.json') ? [fullPath] : [];
  });
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

describe('published JSON schemas', () => {
  it('are valid JSON documents', () => {
    const files = listJsonFiles(schemasDir);
    assert.ok(files.length > 0);
    for (const file of files) {
      assert.doesNotThrow(() => readJson(file), path.relative(rootDir, file));
    }
  });

  it('has a manifest whose schema entries point to files in the package', () => {
    const manifest = readJson(path.join(schemasDir, 'manifest.json')) as {
      files?: Array<{ id?: string; schema?: string; current?: boolean }>;
    };
    assert.ok(Array.isArray(manifest.files));
    assert.ok(manifest.files.length > 0);

    for (const entry of manifest.files) {
      assert.equal(typeof entry.id, 'string');
      assert.equal(entry.current, true);
      const schemaPath = entry.schema;
      if (typeof schemaPath !== 'string') {
        assert.fail(`manifest entry ${entry.id || '(unknown)'} is missing schema`);
      }
      assert.ok(fs.existsSync(path.join(rootDir, schemaPath)));
    }

    const pkg = readJson(path.join(rootDir, 'package.json')) as { files?: string[] };
    assert.ok(pkg.files?.includes('schemas/'));
  });

  it('documents the retired thread identity fields', () => {
    const manifest = readJson(path.join(schemasDir, 'manifest.json')) as {
      upgradePolicy?: { forbiddenThreadIdentityFields?: string[] };
    };
    assert.deepEqual(
      manifest.upgradePolicy?.forbiddenThreadIdentityFields,
      [
        'sdk_session_id',
        'sdkSessionId',
        'desktop_thread_id',
        'desktopThreadId',
        'thread_origin',
        'threadOrigin',
        'thread_id',
        'threadId',
      ],
    );

    const bindingsSchema = fs.readFileSync(path.join(schemasDir, 'data', 'bindings.v2.schema.json'), 'utf-8');
    assert.match(bindingsSchema, /desktop_thread_id/);
    assert.match(bindingsSchema, /sdkSessionId/);
    assert.match(bindingsSchema, /desktopThreadId/);
    assert.match(bindingsSchema, /codepilotSessionId/);
  });
});
