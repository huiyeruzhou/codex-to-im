import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const srcRoot = path.join(root, 'src');
const outDir = path.join(root, 'work', 'analysis');

function walk(dir, target = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, target);
    } else if (entry.isFile() && /\.(ts|tsx|mts|cts)$/.test(entry.name)) {
      target.push(fullPath);
    }
  }
  return target;
}

function toRel(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function layerOf(relPath) {
  if (relPath.startsWith('src/__tests__/')) return 'tests';
  if (relPath.startsWith('src/lib/bridge/adapters/')) return 'bridge/adapters';
  if (relPath.startsWith('src/lib/bridge/turns/')) return 'bridge/turns';
  if (relPath.startsWith('src/lib/bridge/markdown/')) return 'bridge/markdown';
  if (relPath.startsWith('src/lib/bridge/security/')) return 'bridge/security';
  if (relPath.startsWith('src/lib/bridge/')) return 'bridge/core';
  if (relPath.startsWith('src/adapters/weixin/')) return 'weixin/infra';
  if (relPath.startsWith('src/adapters/')) return 'adapters';
  if (relPath.startsWith('src/ui')) return 'ui';
  if (relPath.startsWith('src/desktop')) return 'desktop';
  if (relPath.includes('codex')) return 'codex';
  if (relPath.includes('config')) return 'config';
  if (relPath.includes('store') || relPath.includes('storage')) return 'storage';
  if (relPath.includes('service')) return 'service';
  if (relPath.includes('session-bindings') || relPath.includes('internal-sessions')) return 'sessions';
  if (relPath.includes('weixin')) return 'weixin';
  return 'root';
}

function stripImportTarget(raw) {
  if (!raw.startsWith('.')) return null;
  return raw;
}

function resolveImport(fromFile, rawTarget) {
  const target = stripImportTarget(rawTarget);
  if (!target) return null;
  const base = path.resolve(path.dirname(fromFile), target);
  const withoutJsExtension = base.replace(/\.(mjs|cjs|js)$/i, '');
  const candidates = [
    base,
    withoutJsExtension,
    `${withoutJsExtension}.ts`,
    `${withoutJsExtension}.tsx`,
    `${withoutJsExtension}.mts`,
    `${withoutJsExtension}.cts`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    path.join(base, 'index.ts'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

function parseImports(content) {
  const imports = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      imports.push(match[1]);
    }
  }
  return imports;
}

const files = walk(srcRoot).sort();
const fileStats = [];
const edges = [];
const layerEdges = new Map();

for (const file of files) {
  const rel = toRel(file);
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split(/\r?\n/).length;
  const layer = layerOf(rel);
  const rawImports = parseImports(content);
  const localImports = [];
  for (const rawTarget of rawImports) {
    const resolved = resolveImport(file, rawTarget);
    if (!resolved || !resolved.startsWith(srcRoot)) continue;
    const to = toRel(resolved);
    const toLayer = layerOf(to);
    localImports.push(to);
    edges.push({ from: rel, to, fromLayer: layer, toLayer });
    const key = `${layer} -> ${toLayer}`;
    layerEdges.set(key, (layerEdges.get(key) || 0) + 1);
  }
  fileStats.push({
    file: rel,
    layer,
    lines,
    localImportCount: localImports.length,
  });
}

const inbound = new Map();
const outbound = new Map();
for (const edge of edges) {
  inbound.set(edge.to, (inbound.get(edge.to) || 0) + 1);
  outbound.set(edge.from, (outbound.get(edge.from) || 0) + 1);
}

const hotFiles = fileStats
  .map((item) => ({
    ...item,
    inbound: inbound.get(item.file) || 0,
    outbound: outbound.get(item.file) || 0,
  }))
  .sort((left, right) => (
    right.lines - left.lines
    || right.inbound - left.inbound
    || left.file.localeCompare(right.file)
  ));

const layerSummary = {};
for (const item of fileStats) {
  layerSummary[item.layer] ||= { files: 0, lines: 0, importsOut: 0, importsIn: 0 };
  layerSummary[item.layer].files += 1;
  layerSummary[item.layer].lines += item.lines;
}
for (const edge of edges) {
  layerSummary[edge.fromLayer].importsOut += 1;
  layerSummary[edge.toLayer].importsIn += 1;
}

const adjacency = new Map();
for (const item of fileStats) adjacency.set(item.file, []);
for (const edge of edges) adjacency.get(edge.from)?.push(edge.to);

let nextIndex = 0;
const stack = [];
const onStack = new Set();
const indexByFile = new Map();
const lowlinkByFile = new Map();
const components = [];

function strongConnect(file) {
  indexByFile.set(file, nextIndex);
  lowlinkByFile.set(file, nextIndex);
  nextIndex += 1;
  stack.push(file);
  onStack.add(file);

  for (const next of adjacency.get(file) || []) {
    if (!indexByFile.has(next)) {
      strongConnect(next);
      lowlinkByFile.set(file, Math.min(lowlinkByFile.get(file), lowlinkByFile.get(next)));
    } else if (onStack.has(next)) {
      lowlinkByFile.set(file, Math.min(lowlinkByFile.get(file), indexByFile.get(next)));
    }
  }

  if (lowlinkByFile.get(file) === indexByFile.get(file)) {
    const component = [];
    while (stack.length > 0) {
      const next = stack.pop();
      onStack.delete(next);
      component.push(next);
      if (next === file) break;
    }
    components.push(component.sort());
  }
}

for (const item of fileStats) {
  if (!indexByFile.has(item.file)) strongConnect(item.file);
}

const cyclicComponents = components
  .filter((component) => component.length > 1)
  .map((component) => ({
    size: component.length,
    files: component,
    layers: Array.from(new Set(component.map(layerOf))).sort(),
  }))
  .sort((left, right) => right.size - left.size || left.files[0].localeCompare(right.files[0]));

const report = {
  generatedAt: new Date().toISOString(),
  fileCount: files.length,
  edgeCount: edges.length,
  layerSummary,
  layerEdges: Array.from(layerEdges.entries())
    .map(([edge, count]) => ({ edge, count }))
    .sort((left, right) => right.count - left.count || left.edge.localeCompare(right.edge)),
  cyclicComponents,
  hotFiles,
  edges,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'dependency-report.json'), JSON.stringify(report, null, 2));

const markdown = [
  '# 依赖报告',
  '',
  `生成时间：${report.generatedAt}`,
  '',
  `文件数：${report.fileCount}`,
  `本地 import 边数：${report.edgeCount}`,
  '',
  '## 最大/最连接的文件',
  '',
  '| 文件 | 层 | 行数 | 入边 | 出边 |',
  '| --- | --- | ---: | ---: | ---: |',
  ...hotFiles.slice(0, 40).map((item) => (
    `| \`${item.file}\` | ${item.layer} | ${item.lines} | ${item.inbound} | ${item.outbound} |`
  )),
  '',
  '## 层摘要',
  '',
  '| 层 | 文件数 | 行数 | import 入边 | import 出边 |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...Object.entries(layerSummary)
    .sort((left, right) => right[1].lines - left[1].lines || left[0].localeCompare(right[0]))
    .map(([layer, item]) => `| ${layer} | ${item.files} | ${item.lines} | ${item.importsIn} | ${item.importsOut} |`),
  '',
  '## 最常见层间依赖',
  '',
  '| 依赖边 | 次数 |',
  '| --- | ---: |',
  ...report.layerEdges.slice(0, 50).map((item) => `| ${item.edge} | ${item.count} |`),
  '',
  '## 循环依赖分量',
  '',
  cyclicComponents.length === 0
    ? '未发现多文件 import 循环。'
    : cyclicComponents.slice(0, 20).flatMap((component, index) => [
      `### 循环 ${index + 1}：${component.size} 个文件`,
      '',
      `层：${component.layers.join(', ')}`,
      '',
      ...component.files.map((file) => `- \`${file}\``),
      '',
    ]).join('\n'),
  '',
].join('\n');

fs.writeFileSync(path.join(outDir, 'dependency-report.md'), markdown);
console.log(`已写入 ${path.relative(root, path.join(outDir, 'dependency-report.json'))}`);
console.log(`已写入 ${path.relative(root, path.join(outDir, 'dependency-report.md'))}`);
