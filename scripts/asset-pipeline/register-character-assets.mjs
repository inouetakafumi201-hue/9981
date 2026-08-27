#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
export const DEFAULT_SOURCE = resolve(ROOT, 'run/精灵图管线/1-成品');
export const DEFAULT_OUTPUT = resolve(ROOT, 'run/assets/characters');
const FRAME_NAMES = Array.from({ length: 16 }, (_, i) => `f${String(i + 1).padStart(2, '0')}.png`);

function pngInfo(file) {
  const data = readFileSync(file);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (data.length < 24 || !data.subarray(0, 8).equals(signature) || data.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`invalid PNG: ${file}`);
  }
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), colorType: data[25] };
}

export function slugify(name) {
  const slug = name.normalize('NFKC').trim().toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'character';
}

function posixPath(value) {
  return value.split('\\').join('/');
}

function assertInside(root, target) {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  const rel = relative(rootPath, targetPath);
  if (rel.startsWith('..') || rel.includes(`..${'/'}`) || rel.includes(`..\\`) || resolve(rootPath, rel) !== targetPath) {
    throw new Error(`path escapes root: ${target}`);
  }
}

function readRole(sourceRoot, roleDir) {
  const rolePath = join(sourceRoot, roleDir);
  const metaPath = join(rolePath, 'meta.json');
  if (!existsSync(metaPath)) throw new Error(`${roleDir}: missing meta.json`);
  let meta;
  try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch { throw new Error(`${roleDir}: invalid meta.json`); }
  const frames = FRAME_NAMES.map((name) => {
    const file = join(rolePath, 'frames', name);
    if (!existsSync(file)) throw new Error(`${roleDir}: missing ${name}`);
    return { name, ...pngInfo(file) };
  });
  const sheetPath = join(rolePath, 'sheet.png');
  if (!existsSync(sheetPath)) throw new Error(`${roleDir}: missing sheet.png`);
  pngInfo(sheetPath);
  const purified = readdirSync(rolePath).find((name) => name.toLowerCase().endsWith('-purified.png'));
  if (purified) pngInfo(join(rolePath, purified));
  return { name: roleDir, meta, frames, sheet: 'sheet.png', purified };
}

export function discoverCharacters(sourceRoot = DEFAULT_SOURCE) {
  const dirs = readdirSync(sourceRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  const errors = [];
  const records = [];
  const ids = new Map();
  for (const name of dirs) {
    try {
      const id = slugify(name);
      if (ids.has(id)) throw new Error(`slug collision with ${ids.get(id)}: ${id}`);
      ids.set(id, name);
      records.push({ id, ...readRole(sourceRoot, name) });
    } catch (error) { errors.push(error.message); }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

function manifestFor(record, sourceRoot) {
  const base = `characters/${record.id}`;
  return {
    kind: 'wakeup-character-sprite-set',
    version: 1,
    id: record.id,
    displayName: record.name,
    sourceDir: posixPath(relative(ROOT, join(sourceRoot, record.name))),
    frameCount: record.frames.length,
    framePattern: 'frames/fNN.png',
    frames: record.frames.map((frame) => ({ path: `${base}/frames/${frame.name}`, width: frame.width, height: frame.height, colorType: frame.colorType })),
    sheet: `${base}/sheet.png`,
    ...(record.purified ? { purified: `${base}/${record.purified}` } : {}),
    meta: `${base}/meta.json`,
  };
}

export function registerCharacters({ source = DEFAULT_SOURCE, output = DEFAULT_OUTPUT, dryRun = false } = {}) {
  const sourceRoot = resolve(source);
  const outputRoot = resolve(output);
  if (!existsSync(sourceRoot)) throw new Error(`source directory not found: ${sourceRoot}`);
  const records = discoverCharacters(sourceRoot);
  const manifests = records.map((record) => manifestFor(record, sourceRoot));
  const registry = { kind: 'wakeup-character-registry', version: 1, frameCount: 16, entries: manifests };
  if (dryRun) return { records, registry };
  mkdirSync(outputRoot, { recursive: true });
  for (const record of records) {
    const roleOut = join(outputRoot, record.id);
    assertInside(outputRoot, roleOut);
    mkdirSync(join(roleOut, 'frames'), { recursive: true });
    for (const frame of record.frames) copyFileSync(join(sourceRoot, record.name, 'frames', frame.name), join(roleOut, 'frames', frame.name));
    copyFileSync(join(sourceRoot, record.name, 'sheet.png'), join(roleOut, 'sheet.png'));
    copyFileSync(join(sourceRoot, record.name, 'meta.json'), join(roleOut, 'meta.json'));
    if (record.purified) copyFileSync(join(sourceRoot, record.name, record.purified), join(roleOut, record.purified));
    writeFileSync(join(roleOut, 'manifest.json'), `${JSON.stringify(manifests.find((item) => item.id === record.id), null, 2)}\n`);
  }
  writeFileSync(join(outputRoot, 'registry.json'), `${JSON.stringify(registry, null, 2)}\n`);
  return { records, registry };
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const source = args.find((arg) => arg.startsWith('--source='))?.slice(9) ?? DEFAULT_SOURCE;
  const output = args.find((arg) => arg.startsWith('--output='))?.slice(9) ?? DEFAULT_OUTPUT;
  const result = registerCharacters({ source, output, dryRun });
  console.log(`[asset-pipeline] registered ${result.records.length} characters${dryRun ? ' (dry-run)' : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`[asset-pipeline] ${error.message}`); process.exitCode = 1; }
}
