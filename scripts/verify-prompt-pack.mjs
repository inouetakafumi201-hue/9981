import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const packRoot = path.resolve(root, '.kiro', 'specs', 'v0-frontend-workflow', 'prompts');
const errors = [];
const fail = (message) => errors.push(message);
const read = (file) => fs.readFileSync(file, 'utf8');
const relative = (file) => path.relative(root, path.resolve(file)).replaceAll('\\', '/');
const isWithin = (parent, candidate) => {
  const relativePath = path.relative(path.resolve(parent), path.resolve(candidate));
  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
};
const resolveWithin = (parent, target) => {
  if (typeof target !== 'string' || target.length === 0) return null;
  const resolvedParent = path.resolve(parent);
  const resolvedTarget = path.resolve(resolvedParent, target);
  return isWithin(resolvedParent, resolvedTarget) ? resolvedTarget : null;
};
const resolvePackPath = (relativePath) => resolveWithin(packRoot, relativePath);
const exists = (relativePath) => {
  const resolvedPath = resolvePackPath(relativePath);
  return resolvedPath !== null && fs.existsSync(resolvedPath);
};
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const hasHeading = (content, heading, numbered) => {
  const label = escapeRegExp(heading);
  const pattern = numbered
    ? `^##\\s+\\d+\\.?\\s+${label}(?:（[^\\n]*）)?\\s*$`
    : `^##\\s+(?:\\d+\\.?\\s+)?${label}(?:（[^\\n]*）)?\\s*$`;
  return new RegExp(pattern, 'm').test(content);
};

const hasExecutableForbiddenCall = (content) => content.split('\n').some((line) =>
  (line.includes('OpRegistry.invoke') || line.includes('submitAction(')) &&
  !/(不调用|禁止|不得|不要|不应|never|do not|must not)/i.test(line),
);

const entryHeadings = [
  'Project Positioning', 'Scope List', 'Reference Materials', 'Technical Constraints',
  'Naming Rules', 'Interaction Rules', 'Explicit Exclusions', 'Batch Objective',
  'Batch Dependencies', 'Acceptance Checks', 'Attached AI-readable packet',
];
const briefHeadings = [
  '页面定位', '权威来源', '当前决策', '状态机', '组件树', '只读数据',
  '动作意图', '本地 UI 状态', '视觉令牌', '动效绑定', '输入无障碍',
  '加载错误超时', '明确不做', '依赖交接', '验收条件',
];

const manifestPath = path.resolve(packRoot, '00-prompt-pack-manifest.json');
if (!fs.existsSync(manifestPath)) {
  fail('missing 00-prompt-pack-manifest.json');
} else {
  let manifest;
  try {
    manifest = JSON.parse(read(manifestPath));
  } catch (error) {
    fail(`manifest is not valid JSON: ${error.message}`);
  }
  if (manifest) {
    if (manifest.executionModel !== 'independent-batch-command') {
      fail('manifest executionModel must be independent-batch-command');
    }
    const globalAttachments = new Map((manifest.globalAttachments ?? []).map((item) => [item.id, item]));
    for (const id of ['G-01', 'G-02', 'G-03', 'G-04', 'G-05', 'G-06', 'G-07', 'G-08']) {
      const item = globalAttachments.get(id);
      if (!item) fail(`manifest missing global attachment ${id}`);
      else if (!exists(item.path)) fail(`${id} points to missing file ${item.path}`);
    }
    const batches = Array.isArray(manifest.batches) ? manifest.batches : [];
    if (batches.length !== 7 || batches.map((item) => item.id).join(',') !== 'B1,B2,B3,B4,B5,B6,B7') {
      fail('manifest batches must be ordered B1 through B7');
    }
    for (const batch of batches) {
      if (!batch || typeof batch !== 'object') {
        fail('manifest contains an invalid batch entry');
        continue;
      }
      if (typeof batch.commandEntry !== 'string' || batch.commandEntry.length === 0) {
        fail(`${batch.id} must define commandEntry`);
      }
      if (!Array.isArray(batch.sameDirectoryAttachments)) {
        fail(`${batch.id} must define sameDirectoryAttachments`);
      }
      if (batch.canRunStandalone !== true) fail(`${batch.id} canRunStandalone must be true`);
      if (batch.dependsOnConversationMemory !== false) fail(`${batch.id} dependsOnConversationMemory must be false`);

      const directory = resolvePackPath(batch.directory);
      if (!directory || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
        fail(`${batch.id} directory is missing: ${batch.directory}`);
        continue;
      }

      const commandEntry = resolvePackPath(batch.commandEntry);
      const commandEntryName = commandEntry ? path.basename(commandEntry) : '';
      if (!commandEntry || !fs.existsSync(commandEntry) || !fs.statSync(commandEntry).isFile()) {
        fail(`${batch.id} commandEntry is missing: ${batch.commandEntry}`);
      } else if (!isWithin(directory, commandEntry)) {
        fail(`${batch.id} commandEntry must be inside batch.directory`);
      } else if (
        !commandEntryName.startsWith(`${batch.id}-00-`) ||
        !commandEntryName.endsWith('.md')
      ) {
        fail(`${batch.id} commandEntry filename must be its ${batch.id}-00 entry prompt`);
      }

      for (const attachment of batch.sameDirectoryAttachments ?? []) {
        const attachmentPath = resolvePackPath(attachment);
        if (!attachmentPath || !isWithin(directory, attachmentPath) || !fs.existsSync(attachmentPath)) {
          fail(`${batch.id} sameDirectoryAttachments points outside or to a missing file: ${attachment}`);
        }
      }

      const files = fs.readdirSync(directory).filter((file) => file.endsWith('.md')).sort();
      const entry = commandEntry && isWithin(directory, commandEntry) ? path.basename(commandEntry) : '';
      if (!entry || !files.includes(entry)) fail(`${batch.id} is missing its -00 entry prompt`);
      for (const file of files) {
        const filePath = path.resolve(directory, file);
        const content = read(filePath);
        const isEntry = file.startsWith(`${batch.id}-00-`);
        const required = isEntry ? entryHeadings : briefHeadings;
        for (const heading of required) {
          if (!hasHeading(content, heading, !isEntry)) fail(`${relative(filePath)} missing section: ${heading}`);
        }
        if (isEntry && file === entry) {
          const expectedComment = `<!-- prompt-pack: command-entry batch=${batch.id} execution=independent-command -->`;
          const lines = content.split(/\r?\n/);
          const commentCount = lines.filter((line) => line === expectedComment).length;
          if (commentCount !== 1 || lines[1] !== expectedComment) {
            fail(`${relative(filePath)} command-entry comment must exactly match its batch`);
          }
        }
        if (!/Acceptance Checks|15\.?\s+验收条件/.test(content)) fail(`${relative(filePath)} has no acceptance checks`);
        if (/请(?:直接)?(?:读取|参考)\s*[`']?(?:src|docs)[/\\]/i.test(content)) fail(`${relative(filePath)} contains path-only AI instruction`);
        if (hasExecutableForbiddenCall(content)) fail(`${relative(filePath)} contains executable forbidden gameplay submission API`);
        if (/\+3极限爆发[^\n]*(?:可选|选择|selectable).*?(?:true|开放|启用)/i.test(content)) fail(`${relative(filePath)} exposes deferred +3 as selectable`);
      }
    }
  }
}

const aiDirectory = path.resolve(packRoot, 'references', 'ai');
if (!fs.existsSync(aiDirectory)) fail('missing references/ai directory');
else {
  const files = fs.readdirSync(aiDirectory).filter((file) => file.endsWith('.md')).sort();
  if (files.length === 0) fail('references/ai has no rewritten AI-readable briefs');
  for (const file of files) {
    const filePath = path.resolve(aiDirectory, file);
    const content = read(filePath);
    for (const heading of briefHeadings) if (!hasHeading(content, heading, true)) fail(`${relative(filePath)} missing section: ${heading}`);
    if (/请(?:直接)?(?:读取|参考)\s*[`']?(?:src|docs)[/\\]/i.test(content)) fail(`${relative(filePath)} contains path-only AI instruction`);
  }
}

const indexPath = path.resolve(packRoot, 'references', 'REFERENCE-INDEX.md');
if (!fs.existsSync(indexPath)) fail('missing references/REFERENCE-INDEX.md');
const assetManifestPath = path.resolve(packRoot, 'references', 'assets', 'asset-manifest.json');
if (!fs.existsSync(assetManifestPath)) fail('missing references/assets/asset-manifest.json');
else {
  try {
    const manifest = JSON.parse(read(assetManifestPath));
    for (const asset of manifest.assets ?? []) {
      for (const field of ['assetId', 'fileName', 'batch', 'status']) if (!asset[field]) fail(`asset entry missing ${field}`);
      if (asset.fileName) {
        const assetPath = resolveWithin(path.resolve(packRoot, 'references', 'assets'), asset.fileName);
        if (!assetPath || !fs.existsSync(assetPath)) fail(`asset points to missing file ${asset.fileName}`);
      }
    }
  } catch (error) {
    fail(`asset manifest is not valid JSON: ${error.message}`);
  }
}

if (errors.length > 0) {
  console.error(`Prompt Pack verification failed with ${errors.length} error(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log('Prompt Pack verification passed.');
}
