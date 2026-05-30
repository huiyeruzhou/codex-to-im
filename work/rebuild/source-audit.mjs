import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..', '..');
const srcRoot = path.join(root, 'src');
const outDir = path.join(root, 'work', 'rebuild');

function walk(dir, target = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, target);
    } else if (entry.isFile() && /\.ts$/.test(entry.name)) {
      target.push(fullPath);
    }
  }
  return target;
}

function toRel(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function stripJsExtension(target) {
  return target.replace(/\.(mjs|cjs|js)$/i, '');
}

function resolveLocalImport(fromFile, rawTarget) {
  if (!rawTarget.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), rawTarget);
  const withoutJsExtension = stripJsExtension(base);
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

function stringLiteralText(node) {
  return ts.isStringLiteral(node) ? node.text : null;
}

function parseImports(sourceFile) {
  const imports = [];

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const target = stringLiteralText(node.moduleSpecifier);
      if (target) {
        const symbols = [];
        const clause = node.importClause;
        if (clause?.name) symbols.push(clause.name.text);
        const namedBindings = clause?.namedBindings;
        if (namedBindings && ts.isNamespaceImport(namedBindings)) {
          symbols.push(`* as ${namedBindings.name.text}`);
        }
        if (namedBindings && ts.isNamedImports(namedBindings)) {
          for (const element of namedBindings.elements) symbols.push(element.name.text);
        }
        imports.push({
          kind: clause ? 'static' : 'side-effect',
          typeOnly: Boolean(clause?.isTypeOnly),
          target,
          symbols: Array.from(new Set(symbols)).sort(),
        });
      }
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const target = stringLiteralText(node.moduleSpecifier);
      if (target) {
        const symbols = [];
        const exportClause = node.exportClause;
        if (exportClause && ts.isNamespaceExport(exportClause)) {
          symbols.push(`* as ${exportClause.name.text}`);
        }
        if (exportClause && ts.isNamedExports(exportClause)) {
          for (const element of exportClause.elements) symbols.push(element.name.text);
        }
        imports.push({
          kind: 're-export',
          typeOnly: Boolean(node.isTypeOnly),
          target,
          symbols: Array.from(new Set(symbols)).sort(),
        });
      }
    }

    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length > 0
      && ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push({
        kind: 'dynamic',
        typeOnly: false,
        target: node.arguments[0].text,
        symbols: [],
      });
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return imports;
}

function hasModifier(node, kind) {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

function isExportedNode(node) {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function parseExports(sourceFile) {
  const exports = [];

  const visit = (node) => {
    if (
      isExportedNode(node)
      && (
        ts.isFunctionDeclaration(node)
        || ts.isClassDeclaration(node)
        || ts.isInterfaceDeclaration(node)
        || ts.isTypeAliasDeclaration(node)
        || ts.isEnumDeclaration(node)
      )
      && node.name
    ) {
      exports.push(node.name.text);
    }

    if (ts.isVariableStatement(node) && isExportedNode(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) exports.push(declaration.name.text);
      }
    }

    if (ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const element of node.exportClause.elements) exports.push(element.name.text);
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return Array.from(new Set(exports)).sort();
}

function propertyNameText(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) || ts.isPrivateIdentifier(name)) {
    return name.text;
  }
  return null;
}

function lineAt(sourceFile, position) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
}

function createFunctionBlock(sourceFile, relPath, functions, name, kind, node, bodyNode, owner) {
  const displayName = owner ? `${owner}.${name}` : name;
  let uniqueName = displayName;
  let suffix = 2;
  while (functions.some((item) => item.name === uniqueName)) {
    uniqueName = `${displayName}#${suffix}`;
    suffix += 1;
  }
  const startLine = lineAt(sourceFile, node.getStart(sourceFile));
  const endLine = lineAt(sourceFile, node.end);
  const bodyStart = bodyNode ? lineAt(sourceFile, bodyNode.getStart(sourceFile)) : startLine;
  const bodyEnd = bodyNode ? lineAt(sourceFile, bodyNode.end) : endLine;
  functions.push({
    id: `${relPath}#${uniqueName}`,
    name: uniqueName,
    localName: name,
    owner,
    kind,
    startLine,
    endLine,
    bodyLineCount: Math.max(1, bodyEnd - bodyStart),
    node,
    bodyNode,
  });
}

function parseFunctionLikeBlocks(sourceFile, relPath) {
  const functions = [];

  const visit = (node, owner) => {
    if (ts.isClassDeclaration(node)) {
      const className = node.name?.text || 'anonymous-class';
      for (const member of node.members) {
        if (ts.isConstructorDeclaration(member) && member.body) {
          createFunctionBlock(sourceFile, relPath, functions, 'constructor', 'constructor', member, member.body, className);
        } else if ((ts.isMethodDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) && member.body) {
          const methodName = propertyNameText(member.name);
          if (methodName) {
            createFunctionBlock(sourceFile, relPath, functions, methodName, 'method', member, member.body, className);
          }
        }
      }
      ts.forEachChild(node, (child) => {
        if (!node.members.includes(child)) visit(child, className);
      });
      return;
    }

    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      createFunctionBlock(sourceFile, relPath, functions, node.name.text, 'function', node, node.body, owner);
    }

    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        createFunctionBlock(sourceFile, relPath, functions, node.name.text, 'arrow', node, node.initializer.body, owner);
      }
    }

    ts.forEachChild(node, (child) => visit(child, owner));
  };
  visit(sourceFile, undefined);

  return functions.sort((left, right) => left.startLine - right.startLine || left.name.localeCompare(right.name));
}

function basenameWithoutTest(relPath) {
  return path.basename(relPath, '.ts').replace(/\.test$/, '');
}

function aggregateOf(relPath) {
  if (relPath.startsWith('src/__tests__/')) return 'Test Coverage';
  if (relPath === 'src/lib/bridge/command.ts') return 'Command Application';
  if (relPath.startsWith('src/lib/bridge/command/')) return 'Command Application';
  if (relPath === 'src/lib/bridge/session-registry.ts' || relPath.startsWith('src/lib/bridge/session-registry/')) return 'Session Registry';
  if (relPath.startsWith('src/lib/bridge/display/')) return 'Display Query / Presentation Model';
  if (relPath.startsWith('src/lib/bridge/tmux/')) return 'Tmux Runtime';
  if (relPath.startsWith('src/lib/bridge/interactive-turn/')) return 'Interactive Turn Runtime';
  if (relPath.startsWith('src/lib/bridge/turns/')) return 'Interactive Turn Runtime';
  if (relPath.startsWith('src/lib/bridge/markdown/')) return 'Markdown Rendering';
  if (relPath.startsWith('src/lib/bridge/security/')) return 'Security / Validation';
  if (relPath.startsWith('src/lib/bridge/adapters/feishu-adapter.ts')) return 'Feishu Adapter';
  if (relPath === 'src/lib/bridge/adapters/weixin-adapter.ts' || relPath.startsWith('src/lib/bridge/adapters/weixin/')) return 'Weixin Adapter';
  if (relPath.startsWith('src/lib/bridge/adapters/')) return 'Channel Delivery and Adapters';
  if (relPath.startsWith('src/weixin/')) return 'Weixin Support';
  if (relPath.startsWith('src/codex/session-index') || relPath === 'src/codex/session-index.ts') return 'Local Codex Session Index';
  if (relPath === 'src/codex/session-mirror.ts' || relPath.includes('mirror-')) return 'Mirror Runtime';
  if (relPath === 'src/internal-sessions.ts' || relPath.includes('binding')) return 'Session Registry';
  if (relPath === 'src/store.ts' || relPath === 'src/storage-migrations.ts' || relPath.includes('store')) return 'Store / Persistence';
  if (relPath.startsWith('src/ui/') || relPath.startsWith('src/ui-') || relPath === 'src/ui-server.ts' || relPath === 'src/ui-assets.ts') return 'Local UI and Service Management';
  if (relPath === 'src/config.ts' || relPath === 'src/service-manager.ts' || relPath === 'src/runtime-options.ts' || relPath === 'src/logger.ts') return 'Configuration / Service Management';
  if (
    relPath === 'src/codex/models.ts'
    || relPath === 'src/codex/provider.ts'
    || relPath === 'src/codex/routing-provider.ts'
    || relPath === 'src/codex/tmux-provider.ts'
  ) return 'Execution Providers';
  if (relPath === 'src/main.ts' || relPath === 'src/cli.ts' || relPath === 'src/bridge-instance-lock.ts' || relPath === 'src/qrcode.d.ts') return 'Composition Roots';
  if (relPath.startsWith('src/lib/bridge/mirror') || relPath.includes('mirror')) return 'Mirror Runtime';
  if (relPath.startsWith('src/lib/bridge/session-health')) return 'Session Health Runtime';
  if (relPath.startsWith('src/lib/bridge/')) return 'Bridge Host / Runtime Contracts';
  return 'Domain / Shared Root';
}

function responsibilityOf(relPath, aggregate) {
  if (aggregate === 'Test Coverage') return `Test coverage for ${basenameWithoutTest(relPath)}.`;
  if (relPath === 'src/lib/bridge/command.ts') return 'Public facade for command application APIs consumed by bridge runtime.';
  if (relPath.startsWith('src/lib/bridge/command/')) {
    return `Slash command ${basenameWithoutTest(relPath)} handler, catalog, or presentation.`;
  }
  if (relPath === 'src/lib/bridge/session-registry.ts') {
    return 'Session registry facade for session, binding, default target, and local Codex thread materialization use cases.';
  }
  if (relPath.startsWith('src/lib/bridge/session-registry/')) {
    return `Session registry ${basenameWithoutTest(relPath)} owner for binding/default target rules and summaries.`;
  }
  if (relPath.startsWith('src/lib/bridge/display/')) {
    return `Display query and label/title rules for ${basenameWithoutTest(relPath)}.`;
  }
  if (relPath.startsWith('src/codex/session-index') || relPath === 'src/codex/session-index.ts') {
    return `Local Codex session index ${basenameWithoutTest(relPath)} responsibility.`;
  }
  if (relPath.startsWith('src/lib/bridge/interactive-turn/') || relPath.startsWith('src/lib/bridge/turns/')) {
    return `Interactive turn runtime ${basenameWithoutTest(relPath)} responsibility.`;
  }
  if (relPath.startsWith('src/lib/bridge/markdown/')) {
    return `Markdown parsing/rendering ${basenameWithoutTest(relPath)} responsibility.`;
  }
  if (relPath.includes('mirror')) return `Mirror runtime ${basenameWithoutTest(relPath)} responsibility.`;
  if (relPath.includes('weixin')) return `Weixin adapter ${basenameWithoutTest(relPath)} responsibility.`;
  if (relPath.includes('feishu')) return `Feishu adapter ${basenameWithoutTest(relPath)} responsibility.`;
  if (relPath.includes('binding') || relPath.includes('session-registry')) {
    return `Session and channel binding registry ${basenameWithoutTest(relPath)} responsibility.`;
  }
  if (relPath.startsWith('src/ui')) return `Local UI ${basenameWithoutTest(relPath)} route, shell, or application responsibility.`;
  if (relPath.includes('provider') || relPath.includes('tmux')) return `Execution provider ${basenameWithoutTest(relPath)} responsibility.`;
  if (relPath.includes('store') || relPath.includes('storage')) return `Persistence and migration ${basenameWithoutTest(relPath)} responsibility.`;
  if (relPath.includes('config') || relPath.includes('service')) return `Configuration/service management ${basenameWithoutTest(relPath)} responsibility.`;
  if (relPath.startsWith('src/lib/bridge/')) return `Bridge runtime contract or orchestration ${basenameWithoutTest(relPath)} responsibility.`;
  return `${aggregate} ${basenameWithoutTest(relPath)} responsibility.`;
}

function isPublicFacade(relPath) {
  return [
    'src/codex/session-index.ts',
    'src/lib/bridge/channel-adapter.ts',
    'src/lib/bridge/command.ts',
    'src/lib/bridge/context.ts',
    'src/lib/bridge/delivery-layer.ts',
    'src/lib/bridge/display/session-display-query.ts',
    'src/lib/bridge/host.ts',
    'src/lib/bridge/session-registry.ts',
    'src/lib/bridge/types.ts',
    'src/logger.ts',
    'src/runtime-options.ts',
    'src/config.ts',
    'src/store.ts',
  ].includes(relPath);
}

function sharedRuleRisk(record) {
  const risks = [];
  if (record.aggregate !== 'Command Application' && record.localImports.some((item) => item.to.startsWith('src/lib/bridge/command/'))) {
    risks.push('non-command code imports command presentation/application');
  }
  if (record.aggregate !== 'Display Query / Presentation Model' && record.file.startsWith('src/lib/bridge/display/')) {
    risks.push('display file classified outside display');
  }
  if (record.aggregate === 'Local UI and Service Management' && record.localImports.some((item) => item.to === 'src/store.ts' || item.to === 'src/codex/session-index.ts' || item.to.startsWith('src/codex/session-index/'))) {
    risks.push('UI route/application directly reaches store or local Codex index');
  }
  if (record.aggregate === 'Bridge Host / Runtime Contracts' && record.localImports.some((item) => item.to.startsWith('src/lib/bridge/command/'))) {
    risks.push('bridge runtime reaches command layer');
  }
  if (record.lines >= 800) {
    risks.push('large file needs explicit aggregate-owner decision before further split');
  }
  return risks;
}

function recommendationFor(record) {
  if (record.aggregate === 'Test Coverage') return 'Keep as verification coverage; update when production boundaries move.';
  if (record.sharedRuleRisks.length > 0 || record.riskyCrossAggregateImports.length > 0) {
    return 'Review in the next module-boundary phase; move cross-aggregate access behind a facade or port before splitting further.';
  }
  if (record.lines >= 500) {
    return 'Keep as aggregate owner for now; split only along internal responsibilities with tests.';
  }
  return `Keep inside ${record.aggregate}; no immediate structural change from first-pass audit.`;
}

function mdList(items, max = 4) {
  if (items.length === 0) return '';
  const shown = items.slice(0, max).join('<br>');
  return items.length > max ? `${shown}<br>... +${items.length - max}` : shown;
}

function parentDirectory(relPath) {
  return path.dirname(relPath);
}

function addWeightedEdge(graph, from, to, weight) {
  if (from === to || weight <= 0) return;
  if (!graph.has(from)) graph.set(from, new Map());
  if (!graph.has(to)) graph.set(to, new Map());
  graph.get(from).set(to, (graph.get(from).get(to) || 0) + weight);
  graph.get(to).set(from, (graph.get(to).get(from) || 0) + weight);
}

function pathAffinity(left, right) {
  const leftParts = left.split('/');
  const rightParts = right.split('/');
  let shared = 0;
  for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index += 1) {
    if (leftParts[index] !== rightParts[index]) break;
    shared += 1;
  }
  if (parentDirectory(left) === parentDirectory(right)) return 2.5;
  if (shared >= 4) return 1.2;
  if (shared >= 3) return 0.4;
  return 0;
}

function importWeight(edge) {
  let weight = edge.typeOnly ? 1.2 : 3;
  if (edge.kind === 're-export') weight += 2;
  if (edge.symbols.length >= 3) weight += 0.8;
  weight += pathAffinity(edge.from, edge.to);
  return weight;
}

function buildNaturalClusterGraph(records, edges) {
  const productionFiles = new Set(records
    .filter((record) => record.aggregate !== 'Test Coverage')
    .map((record) => record.file));
  const graph = new Map();
  for (const file of productionFiles) graph.set(file, new Map());

  for (const edge of edges) {
    if (!productionFiles.has(edge.from) || !productionFiles.has(edge.to)) continue;
    addWeightedEdge(graph, edge.from, edge.to, importWeight(edge));
  }

  const byDirectory = new Map();
  for (const file of productionFiles) {
    const dir = parentDirectory(file);
    byDirectory.set(dir, [...(byDirectory.get(dir) || []), file]);
  }
  for (const filesInDirectory of byDirectory.values()) {
    if (filesInDirectory.length > 18) continue;
    for (let leftIndex = 0; leftIndex < filesInDirectory.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < filesInDirectory.length; rightIndex += 1) {
        addWeightedEdge(graph, filesInDirectory[leftIndex], filesInDirectory[rightIndex], 1.1);
      }
    }
  }

  return graph;
}

function chooseBestLabel(scores, currentLabel) {
  let bestLabel = currentLabel;
  let bestScore = scores.get(currentLabel) || 0;
  for (const [label, score] of scores.entries()) {
    if (
      score > bestScore
      || (score === bestScore && label < bestLabel)
    ) {
      bestLabel = label;
      bestScore = score;
    }
  }
  return bestLabel;
}

function detectNaturalClusterLabels(records, edges) {
  const graph = buildNaturalClusterGraph(records, edges);
  const nodes = Array.from(graph.keys()).sort();
  const labels = new Map(nodes.map((file) => [file, file]));

  for (let pass = 0; pass < 24; pass += 1) {
    let changed = false;
    const ordered = pass % 2 === 0 ? nodes : [...nodes].reverse();
    for (const file of ordered) {
      const scores = new Map();
      for (const [neighbor, weight] of graph.get(file).entries()) {
        const label = labels.get(neighbor);
        scores.set(label, (scores.get(label) || 0) + weight);
      }
      const bestLabel = chooseBestLabel(scores, labels.get(file));
      if (bestLabel !== labels.get(file)) {
        labels.set(file, bestLabel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const compact = new Map();
  for (const file of nodes) {
    const label = labels.get(file);
    compact.set(label, [...(compact.get(label) || []), file]);
  }
  const sortedClusters = Array.from(compact.values())
    .map((filesInCluster) => filesInCluster.sort())
    .sort((left, right) => right.length - left.length || left[0].localeCompare(right[0]));
  const clusterByFile = new Map();
  sortedClusters.forEach((filesInCluster, index) => {
    const id = `cluster-${String(index + 1).padStart(2, '0')}`;
    for (const file of filesInCluster) clusterByFile.set(file, id);
  });
  return clusterByFile;
}

function dominantDirectory(filesInCluster) {
  const counts = new Map();
  for (const file of filesInCluster) {
    const dir = parentDirectory(file);
    counts.set(dir, (counts.get(dir) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || '';
}

function inferNaturalClusterName(filesInCluster) {
  const dirs = new Set(filesInCluster.map(parentDirectory));
  const has = (needle) => filesInCluster.some((file) => file.includes(needle));
  const all = (needle) => filesInCluster.every((file) => file.includes(needle));

  if (all('/command/') || filesInCluster.includes('src/lib/bridge/command.ts')) return 'Command Application';
  if (all('/display/')) return 'Display Query';
  if (all('/interactive-turn/')) return 'Interactive Turn Runtime';
  if (all('/turns/')) return 'Interactive Turn Runtime';
  if (has('/interactive-turn/')) return 'Interactive Turn Runtime';
  if (all('/tmux/')) return 'Tmux Runtime';
  if (has('src/codex/session-index')) return 'Local Codex Session Index';
  if (has('mirror')) return 'Mirror Runtime';
  if (has('session-health')) return 'Session Health Runtime';
  if (has('weixin')) return 'Weixin Adapter';
  if (has('feishu')) return 'Feishu Adapter';
  if (has('ui-server') || Array.from(dirs).some((dir) => dir.startsWith('src/ui'))) return 'Local UI';
  if (has('internal-sessions') || has('session-registry') || has('binding')) return 'Session Registry';
  if (has('/adapters/') || has('delivery') || has('channel-adapter')) return 'Channel Delivery';
  if (has('config') || has('service-manager') || has('runtime-options')) return 'Configuration and Service Management';
  if (has('main.ts') || has('cli.ts')) return 'Composition Root';

  return dominantDirectory(filesInCluster)
    .replace(/^src\/lib\/bridge\/?/, 'Bridge ')
    .replace(/^src\//, '')
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/-/g, ' '))
    .join(' / ') || 'Unclassified Cluster';
}

function shortAggregateName(aggregate) {
  return aggregate
    .replace('Bridge Host / Runtime Contracts', 'Bridge Host')
    .replace('Local UI and Service Management', 'Local UI')
    .replace('Configuration / Service Management', 'Config / Service')
    .replace('Display Query / Presentation Model', 'Display Query')
    .replace('Channel Delivery and Adapters', 'Channel Delivery')
    .replace('Local Codex Session Index', 'Codex Session Index')
    .replace('Weixin Support', 'Weixin Support');
}

function hasFile(cluster, pattern) {
  return cluster.files.some((file) => file.includes(pattern));
}

function topAggregateNames(cluster, max = 4) {
  return cluster.aggregateComposition
    .slice(0, max)
    .map((item) => `${shortAggregateName(item.aggregate)} ${item.lines}/${item.files}`)
    .join('; ');
}

function antiCompositionGuidance(cluster) {
  if (hasFile(cluster, 'bridge-manager.ts') || hasFile(cluster, 'interactive-turn/runner.ts')) {
    return '禁止再造 composition/factory 依赖堆；应把状态机规则移到真实 owner，或把外部事实读取收成小而具体的端口。';
  }
  if (hasFile(cluster, 'ui/') || hasFile(cluster, 'config.ts') || hasFile(cluster, 'store.ts')) {
    return '禁止让 UI application 直接读取 config/store/local Codex 细节；应通过明确 query/source/service，而不是万能 app context。';
  }
  if (hasFile(cluster, 'src/lib/bridge/command/')) {
    return '禁止用空 facade 掩盖 command 出边；只有当命令用户故事入口更稳定、registry/display/codex owner 更清楚时才移动或拆分。';
  }
  if (hasFile(cluster, 'session-registry') || hasFile(cluster, 'binding')) {
    return '禁止把 registry 变成薄包装转发层；binding uniqueness、default target、materialize 规则应留在 registry owner 内。';
  }
  return '禁止用空 facade 掩盖依赖；只有当 owner 规则更集中、调用入口更稳定时才移动或拆分。';
}

function proposeAggregationForCluster(cluster, mixedAudit) {
  let potential = '保持当前自然簇观察，不急于移动文件。';
  let nextStep = '先审计最大外聚函数和热点边，再选择能减少跨层读取的一刀。';
  let targetShape = cluster.mixed
    ? `不要直接把混合簇命名成新模块；先按 ${topAggregateNames(cluster)} 拆出真实 owner。`
    : `可作为 ${cluster.name} 聚合或聚合内部模块继续收紧。`;

  if (hasFile(cluster, 'src/lib/bridge/bridge-manager.ts') || hasFile(cluster, 'src/lib/bridge/adapters/feishu-adapter.ts')) {
    potential = 'Bridge Host、平台 adapter、mirror feedback 仍被运行时编排和卡片更新耦在一起；潜在聚合应是 Bridge Host orchestration、Platform Adapter implementation、Mirror Runtime 三块，而不是一个更大的 bridge module。';
    targetShape = 'Bridge Host 保留启动/路由/生命周期入口；adapter 只拥有平台协议；mirror runtime 拥有 cursor/suppression/delivery 状态。';
    nextStep = '优先审计 bridge-manager 与 mirror/adapter 的双向边，寻找真实状态 owner；不要新建 bridge-composition 之类的大参数对象。';
  } else if (hasFile(cluster, 'src/service-manager.ts') || hasFile(cluster, 'src/config.ts') || hasFile(cluster, 'src/store.ts')) {
    potential = 'Local UI、config/service、store/persistence 混在 cluster-02；潜在聚合应拆为 Operator UI application、Configuration/Service Management、Persistence、Session Registry。';
    targetShape = 'UI 只编排 operator workflow；config/service 负责守护进程和配置；store/persistence 只负责数据读写和迁移；registry 拥有会话/绑定/default target 规则。';
    nextStep = '继续把 UI route 对 store/config 的直接读取改为 query/source/service；避免创建全局 UiComposition 或万能 context。';
  } else if (hasFile(cluster, 'src/lib/bridge/command/')) {
    potential = 'Command Application 是 use-case switchboard；潜在聚合应按命令用户故事族和 rendering 分层，而不是每条命令单独碎片化。若它和 Execution Providers / Session Registry 被聚到一起，应优先收窄 command 对 provider、registry、display 的直接边。';
    targetShape = 'command execution、thread/session commands、diagnostics、presentation 分清边界；对 registry/display/codex 走窄接口。';
    nextStep = '先收窄 command 对 registry bindings 和 local Codex index 的直接 import，再考虑内部命名。';
  } else if (hasFile(cluster, 'src/lib/bridge/session-registry') || hasFile(cluster, 'binding')) {
    potential = 'Session Registry 现在是明确候选聚合；bindings、registry service、UI binding mutation 可以共享一个 owner，但 display query 和 command presentation 不应反向塞进 registry。';
    targetShape = 'Session Registry 负责 BridgeSession/ChannelBinding/default target mutation 和 summaries；对 UI/command 暴露 use-case/query API。';
    nextStep = '下一步审计 UI chat-display 是否应通过 registry query facade 读取 summaries，而不是直接 import bindings internals。';
  } else if (hasFile(cluster, 'src/lib/bridge/interactive-turn/')) {
    potential = 'Interactive Turn Runtime 已较集中；潜在聚合是 inbound IM turn application flow，而不是继续拆小 controller。';
    targetShape = 'runner 应保留流程入口，SDK conversation、stream UI、terminal finalization、response assembly 各自拥有真实状态规则。';
    nextStep = '优先审计 runner 仍依赖 Bridge Host 的边，按具体端口收窄，不新增 composition facade。';
  } else if (hasFile(cluster, 'src/codex/session-index')) {
    potential = 'Local Codex Session Index 是基础设施聚合；应保持胖而紧凑，对外只暴露 list/get/history/mirror/archive 等稳定 API。';
    targetShape = '内部可继续按 JSONL parser、discovery、archive、workspace filter 分层；外部不应 import 内部文件。';
    nextStep = '检查外部是否 import `src/codex/session-index/*` 内部路径，若有则改走 `src/codex/session-index.ts` facade。';
  }

  return {
    clusterId: cluster.id,
    currentName: cluster.name,
    mixed: cluster.mixed,
    fileCount: cluster.fileCount,
    lineCount: cluster.lineCount,
    internalEdgeCount: cluster.internalEdgeCount,
    outboundEdgeCount: cluster.outboundEdgeCount,
    inboundEdgeCount: cluster.inboundEdgeCount,
    aggregateComposition: cluster.aggregateComposition,
    potential,
    targetShape,
    nextStep,
    antiPattern: antiCompositionGuidance(cluster),
    evidence: [
      `top aggregates: ${topAggregateNames(cluster)}`,
      `hot files: ${cluster.topFiles.slice(0, 4).join('; ')}`,
      mixedAudit ? `internal cross-aggregate edges: ${mixedAudit.crossAggregateInternalEdgeCount}` : `boundary assessment: ${cluster.boundaryAssessment}`,
    ],
  };
}

function summarizePotentialAggregations(naturalClusters, mixedClusterBoundaryAudits) {
  const auditByClusterId = new Map(mixedClusterBoundaryAudits.map((audit) => [audit.clusterId, audit]));
  return naturalClusters
    .filter((cluster) => (
      cluster.mixed
      || cluster.outboundEdgeCount + cluster.inboundEdgeCount >= Math.max(12, cluster.fileCount * 2)
      || cluster.fileCount >= 5
    ))
    .slice(0, 14)
    .map((cluster) => proposeAggregationForCluster(cluster, auditByClusterId.get(cluster.id)));
}

function aggregateCompositionFor(fileRecords) {
  const byAggregate = new Map();
  for (const record of fileRecords) {
    const current = byAggregate.get(record.aggregate) || { aggregate: record.aggregate, files: 0, lines: 0 };
    current.files += 1;
    current.lines += record.lines;
    byAggregate.set(record.aggregate, current);
  }
  return Array.from(byAggregate.values())
    .sort((left, right) => right.lines - left.lines || right.files - left.files || left.aggregate.localeCompare(right.aggregate));
}

function assessClusterBoundary(baseName, aggregateComposition, fileCount, lineCount, outboundEdgeCount, inboundEdgeCount) {
  const top = aggregateComposition[0];
  const topShare = top ? top.lines / Math.max(1, lineCount) : 0;
  const mixed = fileCount > 3 && topShare < 0.72;
  const highCoupling = outboundEdgeCount + inboundEdgeCount > Math.max(12, fileCount * 2);
  const name = mixed
    ? `Mixed: ${aggregateComposition.slice(0, 3).map((item) => shortAggregateName(item.aggregate)).join(' / ')}`
    : baseName;
  const assessment = mixed
    ? '混合簇：当前依赖把多个职责聚在一起，应作为下一阶段拆边界的候选，不应直接命名为目标模块。'
    : highCoupling
      ? '高耦合簇：职责相对集中，但与其他聚类交互很多，下一步应先定义对外端口。'
      : '候选自然边界：职责和依赖相对集中，可作为目标聚合或聚合内部模块。';
  return { name, mixed, topShare, highCoupling, assessment };
}

function summarizeNaturalClusters(records, edges) {
  const recordByFile = new Map(records.map((record) => [record.file, record]));
  const productionClusterByFile = detectNaturalClusterLabels(records, edges);
  const clustersById = new Map();
  for (const [file, clusterId] of productionClusterByFile.entries()) {
    clustersById.set(clusterId, [...(clustersById.get(clusterId) || []), file]);
  }

  const testClusterCoverage = new Map();
  for (const record of records.filter((item) => item.aggregate === 'Test Coverage')) {
    const covered = new Map();
    for (const edge of record.localImports) {
      const clusterId = productionClusterByFile.get(edge.to);
      if (!clusterId) continue;
      covered.set(clusterId, (covered.get(clusterId) || 0) + 1);
    }
    const primaryClusterId = Array.from(covered.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || null;
    if (primaryClusterId) {
      testClusterCoverage.set(primaryClusterId, [...(testClusterCoverage.get(primaryClusterId) || []), record.file]);
    }
    record.naturalClusterId = primaryClusterId || 'tests-unmapped';
    record.naturalClusterRole = 'test-coverage';
  }

  const clusterSummaries = Array.from(clustersById.entries()).map(([id, filesInCluster]) => {
    const fileSet = new Set(filesInCluster);
    const fileRecords = filesInCluster.map((file) => recordByFile.get(file)).filter(Boolean);
    const internalEdges = edges.filter((edge) => fileSet.has(edge.from) && fileSet.has(edge.to));
    const outboundEdges = edges.filter((edge) => fileSet.has(edge.from) && !fileSet.has(edge.to));
    const inboundEdges = edges.filter((edge) => !fileSet.has(edge.from) && fileSet.has(edge.to));
    const neighborCounts = new Map();
    for (const edge of [...outboundEdges, ...inboundEdges]) {
      const otherFile = fileSet.has(edge.from) ? edge.to : edge.from;
      const otherCluster = productionClusterByFile.get(otherFile);
      if (!otherCluster || otherCluster === id) continue;
      neighborCounts.set(otherCluster, (neighborCounts.get(otherCluster) || 0) + 1);
    }
    const aggregateComposition = aggregateCompositionFor(fileRecords);
    const baseName = inferNaturalClusterName(filesInCluster);
    const boundary = assessClusterBoundary(
      baseName,
      aggregateComposition,
      filesInCluster.length,
      fileRecords.reduce((sum, record) => sum + record.lines, 0),
      outboundEdges.length,
      inboundEdges.length,
    );
    const name = boundary.name;
    for (const file of filesInCluster) {
      const record = recordByFile.get(file);
      if (record) {
        record.naturalClusterId = id;
        record.naturalClusterName = name;
        record.naturalClusterRole = 'production';
      }
    }
    return {
      id,
      name,
      mixed: boundary.mixed,
      boundaryAssessment: boundary.assessment,
      topAggregateLineShare: Number(boundary.topShare.toFixed(3)),
      aggregateComposition,
      dominantDirectory: dominantDirectory(filesInCluster),
      files: filesInCluster,
      fileCount: filesInCluster.length,
      lineCount: fileRecords.reduce((sum, record) => sum + record.lines, 0),
      internalEdgeCount: internalEdges.length,
      outboundEdgeCount: outboundEdges.length,
      inboundEdgeCount: inboundEdges.length,
      testFiles: testClusterCoverage.get(id) || [],
      topFiles: fileRecords
        .toSorted((left, right) => right.lines - left.lines || left.file.localeCompare(right.file))
        .slice(0, 8)
        .map((record) => `${record.file} (${record.lines})`),
      neighborClusters: Array.from(neighborCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([clusterId, count]) => ({ clusterId, count })),
    };
  }).sort((left, right) => right.lineCount - left.lineCount || left.id.localeCompare(right.id));

  const remappedIds = new Map();
  clusterSummaries.forEach((cluster, index) => {
    const newId = `cluster-${String(index + 1).padStart(2, '0')}`;
    remappedIds.set(cluster.id, newId);
    cluster.id = newId;
  });
  for (const cluster of clusterSummaries) {
    cluster.neighborClusters = cluster.neighborClusters.map((item) => ({
      clusterId: remappedIds.get(item.clusterId) || item.clusterId,
      count: item.count,
    }));
  }
  for (const record of records) {
    if (record.naturalClusterId && remappedIds.has(record.naturalClusterId)) {
      record.naturalClusterId = remappedIds.get(record.naturalClusterId);
    }
  }

  return clusterSummaries;
}

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));
}

function summarizeFileHotspots(edgesForAudit, recordByFile) {
  const counts = new Map();
  for (const edge of edgesForAudit) {
    counts.set(edge.from, (counts.get(edge.from) || 0) + 1);
    counts.set(edge.to, (counts.get(edge.to) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 16)
    .map(([file, count]) => ({
      file,
      count,
      aggregate: recordByFile.get(file)?.aggregate || '',
      lines: recordByFile.get(file)?.lines || 0,
    }));
}

function summarizeAggregateBoundaryCandidates(filesInCluster, internalEdges, recordByFile) {
  const byAggregate = new Map();
  for (const file of filesInCluster) {
    const record = recordByFile.get(file);
    if (!record) continue;
    const current = byAggregate.get(record.aggregate) || {
      aggregate: record.aggregate,
      files: [],
      lineCount: 0,
    };
    current.files.push(file);
    current.lineCount += record.lines;
    byAggregate.set(record.aggregate, current);
  }

  return Array.from(byAggregate.values())
    .map((candidate) => {
      const fileSet = new Set(candidate.files);
      const ownInternalEdges = internalEdges.filter((edge) => fileSet.has(edge.from) && fileSet.has(edge.to));
      const boundaryEdges = internalEdges.filter((edge) => fileSet.has(edge.from) !== fileSet.has(edge.to));
      const peerCounts = countBy(boundaryEdges, (edge) => {
        const peerFile = fileSet.has(edge.from) ? edge.to : edge.from;
        return recordByFile.get(peerFile)?.aggregate || 'Unknown';
      });
      return {
        aggregate: candidate.aggregate,
        fileCount: candidate.files.length,
        lineCount: candidate.lineCount,
        internalEdgeCount: ownInternalEdges.length,
        boundaryEdgeCount: boundaryEdges.length,
        topFiles: candidate.files
          .map((file) => recordByFile.get(file))
          .filter(Boolean)
          .toSorted((left, right) => right.lines - left.lines || left.file.localeCompare(right.file))
          .slice(0, 8)
          .map((record) => `${record.file} (${record.lines})`),
        peerAggregates: peerCounts.slice(0, 8),
      };
    })
    .sort((left, right) => right.boundaryEdgeCount - left.boundaryEdgeCount || right.lineCount - left.lineCount || left.aggregate.localeCompare(right.aggregate));
}

function summarizeMixedClusterBoundaries(records, edges, naturalClusters) {
  const recordByFile = new Map(records.map((record) => [record.file, record]));
  const productionEdges = edges.filter((edge) => (
    recordByFile.get(edge.from)?.aggregate !== 'Test Coverage'
    && recordByFile.get(edge.to)?.aggregate !== 'Test Coverage'
  ));

  return naturalClusters
    .filter((cluster) => cluster.mixed)
    .map((cluster) => {
      const fileSet = new Set(cluster.files);
      const internalEdges = productionEdges.filter((edge) => fileSet.has(edge.from) && fileSet.has(edge.to));
      const crossAggregateEdges = internalEdges.filter((edge) => (
        recordByFile.get(edge.from)?.aggregate !== recordByFile.get(edge.to)?.aggregate
      ));
      const outboundEdges = productionEdges.filter((edge) => fileSet.has(edge.from) && !fileSet.has(edge.to));
      const inboundEdges = productionEdges.filter((edge) => !fileSet.has(edge.from) && fileSet.has(edge.to));
      return {
        clusterId: cluster.id,
        name: cluster.name,
        fileCount: cluster.fileCount,
        lineCount: cluster.lineCount,
        internalEdgeCount: internalEdges.length,
        crossAggregateInternalEdgeCount: crossAggregateEdges.length,
        outboundEdgeCount: outboundEdges.length,
        inboundEdgeCount: inboundEdges.length,
        crossAggregatePairs: countBy(crossAggregateEdges, (edge) => (
          `${recordByFile.get(edge.from)?.aggregate || 'Unknown'} -> ${recordByFile.get(edge.to)?.aggregate || 'Unknown'}`
        )).slice(0, 16),
        internalHotFiles: summarizeFileHotspots(crossAggregateEdges, recordByFile),
        aggregateBoundaryCandidates: summarizeAggregateBoundaryCandidates(cluster.files, internalEdges, recordByFile),
        outboundClusters: countBy(outboundEdges, (edge) => recordByFile.get(edge.to)?.naturalClusterId || 'unknown').slice(0, 10),
        inboundClusters: countBy(inboundEdges, (edge) => recordByFile.get(edge.from)?.naturalClusterId || 'unknown').slice(0, 10),
        sampleCrossAggregateEdges: crossAggregateEdges.slice(0, 40).map((edge) => ({
          from: edge.from,
          fromAggregate: recordByFile.get(edge.from)?.aggregate || '',
          to: edge.to,
          toAggregate: recordByFile.get(edge.to)?.aggregate || '',
          symbols: edge.symbols,
        })),
      };
    });
}

function isFunctionLikeNode(node) {
  return ts.isFunctionDeclaration(node)
    || ts.isFunctionExpression(node)
    || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node);
}

function isDeclarationName(node) {
  const parent = node.parent;
  if (!parent) return false;
  return (
    (ts.isVariableDeclaration(parent) && parent.name === node)
    || (ts.isFunctionDeclaration(parent) && parent.name === node)
    || (ts.isClassDeclaration(parent) && parent.name === node)
    || (ts.isParameter(parent) && parent.name === node)
    || (ts.isMethodDeclaration(parent) && parent.name === node)
    || (ts.isPropertyDeclaration(parent) && parent.name === node)
    || (ts.isImportSpecifier(parent) && parent.name === node)
    || (ts.isImportClause(parent) && parent.name === node)
    || (ts.isNamespaceImport(parent) && parent.name === node)
  );
}

function shouldSkipAstUsageNode(node) {
  return (
    (typeof ts.isTypeNode === 'function' && ts.isTypeNode(node))
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isImportDeclaration(node)
    || ts.isExportDeclaration(node)
  );
}

function collectFunctionBodyFacts(block) {
  const usedIdentifiers = new Set();
  const callTargets = [];
  const visit = (node, isRoot = false) => {
    if (!isRoot && isFunctionLikeNode(node)) return;
    if (shouldSkipAstUsageNode(node)) return;

    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      if (ts.isIdentifier(expression)) {
        callTargets.push({ localName: expression.text });
      } else if (ts.isPropertyAccessExpression(expression)) {
        const receiver = expression.expression;
        if (receiver.kind === ts.SyntaxKind.ThisKeyword && block.owner) {
          callTargets.push({ owner: block.owner, localName: expression.name.text });
        } else if (ts.isIdentifier(receiver)) {
          callTargets.push({ owner: receiver.text, localName: expression.name.text });
        }
      }
    }

    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isPropertyName = parent && ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!isPropertyName && !isDeclarationName(node)) {
        usedIdentifiers.add(node.text);
      }
    }

    ts.forEachChild(node, (child) => visit(child));
  };

  if (block.bodyNode) visit(block.bodyNode, true);
  return { usedIdentifiers, callTargets };
}

function importedLocalSymbolName(symbol) {
  return symbol.startsWith('* as ') ? symbol.slice('* as '.length) : symbol;
}

function summarizeFunctionDependencies(records, functionBlocksByFile) {
  const recordByFile = new Map(records.map((record) => [record.file, record]));
  const functionRecords = [];
  const functionEdges = [];
  const functionById = new Map();

  for (const record of records) {
    const blocks = functionBlocksByFile.get(record.file) || [];
    const exportedNames = new Set(record.exports);
    const functionByName = new Map();
    const functionByOwnerAndName = new Map();
    for (const block of blocks) {
      functionByName.set(block.localName, [...(functionByName.get(block.localName) || []), block]);
      if (block.owner) functionByOwnerAndName.set(`${block.owner}.${block.localName}`, block);
    }

    for (const block of blocks) {
      const functionRecord = {
        id: block.id,
        file: record.file,
        aggregate: record.aggregate,
        naturalClusterId: record.naturalClusterId || '',
        naturalClusterName: record.naturalClusterName || '',
        name: block.name,
        localName: block.localName,
        owner: block.owner,
        kind: block.kind,
        startLine: block.startLine,
        endLine: block.endLine,
        bodyLineCount: block.bodyLineCount,
        exported: exportedNames.has(block.localName) || exportedNames.has(block.owner || ''),
        cohesiveDegree: 0,
        outwardDegree: 0,
        totalDependencyDegree: 0,
        dependencySummary: [],
      };
      functionRecords.push(functionRecord);
      functionById.set(block.id, functionRecord);
    }

    const edgeKeys = new Set();
    const pushFunctionEdge = (edge) => {
      const key = `${edge.from}|${edge.to}|${edge.kind}|${edge.symbols.join(',')}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      functionEdges.push(edge);
    };

    for (const block of blocks) {
      const facts = collectFunctionBodyFacts(block);
      for (const callTarget of facts.callTargets) {
        const targets = callTarget.owner
          ? [functionByOwnerAndName.get(`${callTarget.owner}.${callTarget.localName}`)].filter(Boolean)
          : functionByName.get(callTarget.localName) || [];
        for (const target of targets) {
          if (target.id === block.id) continue;
          pushFunctionEdge({
            from: block.id,
            to: target.id,
            kind: 'local-call',
            cohesion: 'inner',
            fromFile: record.file,
            toFile: record.file,
            fromAggregate: record.aggregate,
            toAggregate: record.aggregate,
            fromNaturalClusterId: record.naturalClusterId || '',
            toNaturalClusterId: record.naturalClusterId || '',
            symbols: [target.localName],
          });
        }
      }

      for (const item of record.localImports) {
        if (item.kind === 'side-effect') continue;
        const usedSymbols = item.symbols
          .map(importedLocalSymbolName)
          .filter((symbol) => facts.usedIdentifiers.has(symbol));
        if (usedSymbols.length === 0) continue;
        const targetRecord = recordByFile.get(item.to);
        const cohesion = targetRecord?.aggregate === record.aggregate ? 'inner' : 'outer';
        pushFunctionEdge({
          from: block.id,
          to: item.to,
          kind: 'import-use',
          cohesion,
          fromFile: record.file,
          toFile: item.to,
          fromAggregate: record.aggregate,
          toAggregate: targetRecord?.aggregate || item.toAggregate,
          fromNaturalClusterId: record.naturalClusterId || '',
          toNaturalClusterId: targetRecord?.naturalClusterId || '',
          symbols: usedSymbols,
        });
      }
    }
  }

  for (const edge of functionEdges) {
    const source = functionById.get(edge.from);
    if (!source) continue;
    source.totalDependencyDegree += 1;
    if (edge.cohesion === 'inner') source.cohesiveDegree += 1;
    else source.outwardDegree += 1;
  }

  for (const functionRecord of functionRecords) {
    functionRecord.dependencySummary = functionEdges
      .filter((edge) => edge.from === functionRecord.id)
      .slice(0, 10)
      .map((edge) => {
        const target = functionById.get(edge.to);
        const targetLabel = target ? `${target.file}#${target.name}` : edge.to;
        return `${edge.cohesion}:${targetLabel}${edge.symbols.length > 0 ? ` (${edge.symbols.slice(0, 4).join(', ')})` : ''}`;
      });
  }

  const aggregateFunctionSummary = {};
  for (const functionRecord of functionRecords) {
    aggregateFunctionSummary[functionRecord.aggregate] ||= {
      functions: 0,
      bodyLines: 0,
      cohesiveDegree: 0,
      outwardDegree: 0,
      totalDependencyDegree: 0,
    };
    const item = aggregateFunctionSummary[functionRecord.aggregate];
    item.functions += 1;
    item.bodyLines += functionRecord.bodyLineCount;
    item.cohesiveDegree += functionRecord.cohesiveDegree;
    item.outwardDegree += functionRecord.outwardDegree;
    item.totalDependencyDegree += functionRecord.totalDependencyDegree;
  }

  const topOutwardFunctions = functionRecords
    .filter((item) => item.outwardDegree > 0)
    .toSorted((left, right) => (
      right.outwardDegree - left.outwardDegree
      || right.totalDependencyDegree - left.totalDependencyDegree
      || right.bodyLineCount - left.bodyLineCount
      || left.id.localeCompare(right.id)
    ))
    .slice(0, 80);

  const topLargeFunctions = functionRecords
    .toSorted((left, right) => right.bodyLineCount - left.bodyLineCount || right.outwardDegree - left.outwardDegree || left.id.localeCompare(right.id))
    .slice(0, 80);

  return {
    functionCount: functionRecords.length,
    functionDependencyEdgeCount: functionEdges.length,
    cohesiveEdgeCount: functionEdges.filter((edge) => edge.cohesion === 'inner').length,
    outwardEdgeCount: functionEdges.filter((edge) => edge.cohesion === 'outer').length,
    aggregateFunctionSummary,
    topOutwardFunctions,
    topLargeFunctions,
    functions: functionRecords,
    functionEdges,
  };
}

const files = walk(srcRoot).sort();
const fileByRel = new Map(files.map((file) => [toRel(file), file]));
const records = [];
const edges = [];
const functionBlocksByFile = new Map();

for (const file of files) {
  const rel = toRel(file);
  const content = fs.readFileSync(file, 'utf-8');
  const sourceFile = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const functionBlocks = parseFunctionLikeBlocks(sourceFile, rel);
  functionBlocksByFile.set(rel, functionBlocks);
  const imports = parseImports(sourceFile);
  const localImports = [];
  const externalImports = [];
  for (const item of imports) {
    const resolved = resolveLocalImport(file, item.target);
    if (resolved && resolved.startsWith(srcRoot)) {
      const to = toRel(resolved);
      localImports.push({
        target: item.target,
        to,
        toAggregate: aggregateOf(to),
        symbols: item.symbols,
        typeOnly: item.typeOnly,
        kind: item.kind,
      });
      edges.push({
        from: rel,
        to,
        fromAggregate: aggregateOf(rel),
        toAggregate: aggregateOf(to),
        symbols: item.symbols,
        typeOnly: item.typeOnly,
        kind: item.kind,
      });
    } else {
      externalImports.push({
        target: item.target,
        symbols: item.symbols,
        typeOnly: item.typeOnly,
        kind: item.kind,
      });
    }
  }
  records.push({
    file: rel,
    directory: path.dirname(rel),
    lines: content.split(/\r?\n/).length,
    aggregate: aggregateOf(rel),
    responsibility: responsibilityOf(rel, aggregateOf(rel)),
    localImports,
    externalImports,
    exports: parseExports(sourceFile),
    functions: functionBlocks.map((block) => ({
      id: block.id,
      name: block.name,
      localName: block.localName,
      owner: block.owner,
      kind: block.kind,
      startLine: block.startLine,
      endLine: block.endLine,
      bodyLineCount: block.bodyLineCount,
    })),
  });
}

const inbound = new Map();
const outbound = new Map();
for (const edge of edges) {
  inbound.set(edge.to, (inbound.get(edge.to) || 0) + 1);
  outbound.set(edge.from, (outbound.get(edge.from) || 0) + 1);
}

for (const record of records) {
  record.inbound = inbound.get(record.file) || 0;
  record.outbound = outbound.get(record.file) || 0;
  record.crossAggregateImports = record.localImports.filter((item) => item.toAggregate !== record.aggregate);
  record.riskyCrossAggregateImports = record.crossAggregateImports.filter((item) => !isPublicFacade(item.to) && record.aggregate !== 'Test Coverage');
  record.mainDependencies = [
    ...record.localImports.slice(0, 6).map((item) => `${item.to}${item.symbols.length > 0 ? ` (${item.symbols.slice(0, 4).join(', ')})` : ''}`),
    ...record.externalImports.slice(0, 4).map((item) => `${item.target}${item.symbols.length > 0 ? ` (${item.symbols.slice(0, 4).join(', ')})` : ''}`),
  ];
  record.sharedRuleRisks = sharedRuleRisk(record);
  record.recommendation = recommendationFor(record);
}

const naturalClusters = summarizeNaturalClusters(records, edges);
const mixedClusterBoundaryAudits = summarizeMixedClusterBoundaries(records, edges, naturalClusters);
const potentialAggregations = summarizePotentialAggregations(naturalClusters, mixedClusterBoundaryAudits);
const functionAudit = summarizeFunctionDependencies(records, functionBlocksByFile);

const aggregateSummary = {};
const directorySummary = {};
for (const record of records) {
  aggregateSummary[record.aggregate] ||= { files: 0, lines: 0, inbound: 0, outbound: 0, riskyCrossAggregateImports: 0 };
  aggregateSummary[record.aggregate].files += 1;
  aggregateSummary[record.aggregate].lines += record.lines;
  aggregateSummary[record.aggregate].inbound += record.inbound;
  aggregateSummary[record.aggregate].outbound += record.outbound;
  aggregateSummary[record.aggregate].riskyCrossAggregateImports += record.riskyCrossAggregateImports.length;

  directorySummary[record.directory] ||= { files: 0, lines: 0 };
  directorySummary[record.directory].files += 1;
  directorySummary[record.directory].lines += record.lines;
}

const aggregateEdges = new Map();
for (const edge of edges) {
  const key = `${edge.fromAggregate} -> ${edge.toAggregate}`;
  aggregateEdges.set(key, (aggregateEdges.get(key) || 0) + 1);
}

const report = {
  generatedAt: new Date().toISOString(),
  fileCount: records.length,
  productionFileCount: records.filter((record) => record.aggregate !== 'Test Coverage').length,
  testFileCount: records.filter((record) => record.aggregate === 'Test Coverage').length,
  localImportEdgeCount: edges.length,
  aggregateSummary,
  directorySummary,
  aggregateEdges: Array.from(aggregateEdges.entries())
    .map(([edge, count]) => ({ edge, count }))
    .sort((left, right) => right.count - left.count || left.edge.localeCompare(right.edge)),
  naturalClusters,
  mixedClusterBoundaryAudits,
  potentialAggregations,
  functionAudit,
  hotFiles: records
    .toSorted((left, right) => right.lines - left.lines || right.inbound - left.inbound || left.file.localeCompare(right.file))
    .slice(0, 60)
    .map((record) => ({
      file: record.file,
      aggregate: record.aggregate,
      lines: record.lines,
      inbound: record.inbound,
      outbound: record.outbound,
      riskyCrossAggregateImports: record.riskyCrossAggregateImports.length,
    })),
  riskyFiles: records
    .filter((record) => record.riskyCrossAggregateImports.length > 0 || record.sharedRuleRisks.length > 0)
    .toSorted((left, right) => (
      right.riskyCrossAggregateImports.length - left.riskyCrossAggregateImports.length
      || right.lines - left.lines
      || left.file.localeCompare(right.file)
    ))
    .map((record) => ({
      file: record.file,
      aggregate: record.aggregate,
      lines: record.lines,
      inbound: record.inbound,
      outbound: record.outbound,
      risks: [...record.sharedRuleRisks, ...record.riskyCrossAggregateImports.map((item) => `imports ${item.to}`)],
      recommendation: record.recommendation,
    })),
  files: records,
  edges,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'source-file-audit.json'), `${JSON.stringify(report, null, 2)}\n`);

const markdown = [
  '# 全源文件审计',
  '',
  `生成时间：${report.generatedAt}`,
  '',
  `文件数：${report.fileCount}（生产 ${report.productionFileCount}，测试 ${report.testFileCount}）`,
  `本地 import / re-export 边数：${report.localImportEdgeCount}`,
  '',
  '## 业务聚合摘要',
  '',
  '| 聚合 | 文件数 | 行数 | 入边 | 出边 | 风险跨聚合 import |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...Object.entries(report.aggregateSummary)
    .sort((left, right) => right[1].lines - left[1].lines || left[0].localeCompare(right[0]))
    .map(([aggregate, item]) => `| ${aggregate} | ${item.files} | ${item.lines} | ${item.inbound} | ${item.outbound} | ${item.riskyCrossAggregateImports} |`),
  '',
  '## 目录聚合统计',
  '',
  '| 目录 | 文件数 | 行数 |',
  '| --- | ---: | ---: |',
  ...Object.entries(report.directorySummary)
    .sort((left, right) => right[1].lines - left[1].lines || left[0].localeCompare(right[0]))
    .map(([directory, item]) => `| \`${directory}\` | ${item.files} | ${item.lines} |`),
  '',
  '## 最常见聚合依赖',
  '',
  '| 依赖边 | 次数 |',
  '| --- | ---: |',
  ...report.aggregateEdges.slice(0, 50).map((item) => `| ${item.edge} | ${item.count} |`),
  '',
  '## 自然聚类候选',
  '',
  '自然聚类以生产文件 import / re-export 图为主，叠加同目录弱亲和；测试文件不参与聚类计算，只映射到它主要覆盖的生产聚类。',
  '',
  '| 聚类 | 候选边界 | 主目录 | 文件数 | 行数 | 内部边 | 出边 | 入边 | 测试文件 | 代表文件 | 邻接聚类 |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
  ...report.naturalClusters.map((cluster) => `| ${cluster.id} | ${cluster.name} | \`${cluster.dominantDirectory}\` | ${cluster.fileCount} | ${cluster.lineCount} | ${cluster.internalEdgeCount} | ${cluster.outboundEdgeCount} | ${cluster.inboundEdgeCount} | ${cluster.testFiles.length} | ${mdList(cluster.topFiles, 4)} | ${mdList(cluster.neighborClusters.map((item) => `${item.clusterId} (${item.count})`), 4)} |`),
  '',
  '## 自然聚类解读',
  '',
  '| 聚类 | 聚合构成（按行数） | 判断 |',
  '| --- | --- | --- |',
  ...report.naturalClusters.map((cluster) => `| ${cluster.id} | ${mdList(cluster.aggregateComposition.map((item) => `${shortAggregateName(item.aggregate)} ${item.lines}/${item.files}`), 5)} | ${cluster.boundaryAssessment} |`),
  '',
  '## 混合簇边界审计',
  '',
  '| 聚类 | 内部跨聚合边 | 出边 | 入边 | 主要跨聚合方向 | 热点文件 | 候选拆分边界 |',
  '| --- | ---: | ---: | ---: | --- | --- | --- |',
  ...report.mixedClusterBoundaryAudits.map((audit) => `| ${audit.clusterId} | ${audit.crossAggregateInternalEdgeCount} | ${audit.outboundEdgeCount} | ${audit.inboundEdgeCount} | ${mdList(audit.crossAggregatePairs.map((item) => `${item.key} (${item.count})`), 5)} | ${mdList(audit.internalHotFiles.map((item) => `${item.file} (${item.count})`), 5)} | ${mdList(audit.aggregateBoundaryCandidates.map((item) => `${shortAggregateName(item.aggregate)} ${item.fileCount} files / boundary ${item.boundaryEdgeCount}`), 5)} |`),
  '',
  '## 潜在聚合分析',
  '',
  '本节是依赖图后的工程判断，不把混合簇直接合理化成新模块。建议优先选择能集中真实业务规则、减少跨层读取、降低“要改用户故事先看哪里”不确定性的切片；明确避免大而空的 composition/factory 依赖堆叠。',
  '',
  '| 聚类 | 当前形态 | 潜在聚合可能 | 目标形态 | 下一步 | 明确规避 | 证据 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...report.potentialAggregations.map((item) => `| ${item.clusterId} | ${item.currentName}<br>${item.fileCount} files / ${item.lineCount} lines | ${item.potential} | ${item.targetShape} | ${item.nextStep} | ${item.antiPattern} | ${mdList(item.evidence, 3)} |`),
  '',
  '## 函数级依赖审计',
  '',
  '函数级审计使用 TypeScript AST 解析 import/export、命名函数、函数表达式、箭头函数和 class method。函数体内调用同文件函数，或使用本地 import 符号，都会形成函数依赖边；同聚合边标为内聚边，跨聚合边标为外聚边。',
  '',
  `函数节点数：${report.functionAudit.functionCount}`,
  `函数依赖边数：${report.functionAudit.functionDependencyEdgeCount}（内聚 ${report.functionAudit.cohesiveEdgeCount}，外聚 ${report.functionAudit.outwardEdgeCount}）`,
  '',
  '### 函数级聚合摘要',
  '',
  '| 聚合 | 函数数 | 函数体行数 | 内聚度 | 外聚度 | 总依赖度 |',
  '| --- | ---: | ---: | ---: | ---: | ---: |',
  ...Object.entries(report.functionAudit.aggregateFunctionSummary)
    .sort((left, right) => right[1].outwardDegree - left[1].outwardDegree || right[1].bodyLines - left[1].bodyLines || left[0].localeCompare(right[0]))
    .map(([aggregate, item]) => `| ${aggregate} | ${item.functions} | ${item.bodyLines} | ${item.cohesiveDegree} | ${item.outwardDegree} | ${item.totalDependencyDegree} |`),
  '',
  '### 外聚函数热点',
  '',
  '| 函数 | 文件 | 聚合 | 行号 | 函数体行数 | 内聚度 | 外聚度 | 主要依赖 |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |',
  ...report.functionAudit.topOutwardFunctions.slice(0, 40).map((item) => `| \`${item.name}\` | \`${item.file}\` | ${item.aggregate} | ${item.startLine} | ${item.bodyLineCount} | ${item.cohesiveDegree} | ${item.outwardDegree} | ${mdList(item.dependencySummary, 5)} |`),
  '',
  '### 大函数热点',
  '',
  '| 函数 | 文件 | 聚合 | 行号 | 函数体行数 | 内聚度 | 外聚度 |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: |',
  ...report.functionAudit.topLargeFunctions.slice(0, 40).map((item) => `| \`${item.name}\` | \`${item.file}\` | ${item.aggregate} | ${item.startLine} | ${item.bodyLineCount} | ${item.cohesiveDegree} | ${item.outwardDegree} |`),
  '',
  '## 最大/最高连接文件',
  '',
  '| 文件 | 聚合 | 行数 | 入边 | 出边 | 风险跨聚合 import |',
  '| --- | --- | ---: | ---: | ---: | ---: |',
  ...report.hotFiles.map((item) => `| \`${item.file}\` | ${item.aggregate} | ${item.lines} | ${item.inbound} | ${item.outbound} | ${item.riskyCrossAggregateImports} |`),
  '',
  '## 第一批风险文件',
  '',
  '| 文件 | 聚合 | 行数 | 风险摘要 | 建议 |',
  '| --- | --- | ---: | --- | --- |',
  ...report.riskyFiles.slice(0, 80).map((item) => `| \`${item.file}\` | ${item.aggregate} | ${item.lines} | ${mdList(item.risks, 3)} | ${item.recommendation} |`),
  '',
  '## 逐文件审计表',
  '',
  '| 文件 | 聚合 | 自然聚类 | 行数 | 入边 | 出边 | 职责 | 主要依赖 | 对外暴露 | 重构建议 |',
  '| --- | --- | --- | ---: | ---: | ---: | --- | --- | --- | --- |',
  ...records.map((record) => (
    `| \`${record.file}\` | ${record.aggregate} | ${record.naturalClusterId || ''} | ${record.lines} | ${record.inbound} | ${record.outbound} | ${record.responsibility} | ${mdList(record.mainDependencies, 5)} | ${mdList(record.exports, 5)} | ${record.recommendation} |`
  )),
  '',
].join('\n');

fs.writeFileSync(path.join(outDir, 'source-file-audit.md'), markdown);

console.log(`Wrote ${path.relative(root, path.join(outDir, 'source-file-audit.json'))}`);
console.log(`Wrote ${path.relative(root, path.join(outDir, 'source-file-audit.md'))}`);
