#!/usr/bin/env node
/* =========================================================================
   WakeUp 8类素材组件原生管线 (Node/ESM)
   - 验证并生成 8 大类素材登记清单 (batch-registry.json)
   - 检查素材的完整挂载定义（美术资源/状态帧 + 表现层配置 + 规则 Profile）
   - 输出统一资产清单供编辑器、素材库与表现层直接装载消费
   ========================================================================= */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '../..');
export const DEFAULT_REGISTRY_PATH = resolve(ROOT, 'run/assets/batch-registry.json');
export const DEFAULT_OUTPUT_DIR = resolve(ROOT, 'run/assets/components');

/** 8大标准素材类别契约 */
export const COMPONENT_CATEGORIES = [
  'ai-unit',
  'npc',
  'vehicle',
  'container',
  'item',
  'device',
  'decoration',
  'transition-scene',
];

export const STANDARD_COUNTS = Object.freeze({
  'ai-unit': 6,
  npc: 6,
  vehicle: 4,
  container: 6,
  item: 12,
  device: 6,
  decoration: 6,
  'transition-scene': 2,
});

/** D-088 唯一八类逻辑身份。武器/装备/消耗品仅作为 item 能力或展示标签。 */
export const CATEGORY_SPECS = {
  'ai-unit': { context: 'map', perspective: 'axonometric', defaultStates: ['idle', 'alert', 'downed'] },
  npc: { context: 'map', perspective: 'axonometric', defaultStates: ['idle', 'talk', 'active'] },
  vehicle: { context: 'map', perspective: 'axonometric', defaultStates: ['idle', 'active', 'broken'] },
  container: { context: 'map', perspective: 'axonometric', defaultStates: ['closed', 'open', 'broken'] },
  item: { context: 'ui', perspective: 'front', defaultStates: ['single', 'active'] },
  device: { context: 'map', perspective: 'axonometric', defaultStates: ['idle', 'active', 'broken'] },
  decoration: { context: 'map', perspective: 'axonometric', defaultStates: ['idle'] },
  'transition-scene': { context: 'map', perspective: 'axonometric', defaultStates: ['idle', 'active'] },
};

/**
 * 校验素材登记清单结构与类别合法性
 */
export function validateBatchRegistry(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['清单根对象必须是非空 Object'] };
  }
  if (data.kind !== 'wakeup-batch-manifest') {
    errors.push(`kind 必须为 "wakeup-batch-manifest"，实际为: ${data.kind}`);
  }
  if (!Array.isArray(data.entries) || data.entries.length === 0) {
    errors.push('entries 必须是非空数组');
    return { ok: false, errors };
  }

  const seen = new Set();
  const counts = Object.fromEntries(COMPONENT_CATEGORIES.map((category) => [category, 0]));
  data.entries.forEach((entry, idx) => {
    const tag = `entries[${idx}]`;
    if (!entry.name || typeof entry.name !== 'string' || !entry.name.trim()) {
      errors.push(`${tag}: name 必须是非空字符串`);
    } else if (seen.has(entry.name)) {
      errors.push(`${tag}: 重复的素材名称 "${entry.name}"`);
    } else {
      seen.add(entry.name);
    }

    if (!COMPONENT_CATEGORIES.includes(entry.type)) {
      errors.push(`${tag}: type "${entry.type}" 不在 8 大类别中: ${COMPONENT_CATEGORIES.join(', ')}`);
    } else {
      counts[entry.type] += 1;
    }

    if (!entry.id || typeof entry.id !== 'string') {
      errors.push(`${tag}: id 必须是稳定的非空字符串`);
    }
    if (!Array.isArray(entry.states) || entry.states.length === 0) {
      errors.push(`${tag}: states 必须是非空数组`);
    }
    if (!Array.isArray(entry.capabilities) || entry.capabilities.length === 0) {
      errors.push(`${tag}: capabilities 必须是非空数组`);
    }
    if (!entry.desc || typeof entry.desc !== 'string') {
      errors.push(`${tag}: desc 必须是非空描述`);
    }
  });

  for (const category of COMPONENT_CATEGORIES) {
    if (counts[category] !== STANDARD_COUNTS[category]) {
      errors.push(`${category}: 需要 ${STANDARD_COUNTS[category]} 件，实际 ${counts[category]} 件`);
    }
  }
  if (data.entries.length !== 48) errors.push(`entries: 标准批次必须恰好 48 件，实际 ${data.entries.length} 件`);

  return { ok: errors.length === 0, errors };
}

/**
 * 生成默认样例素材清单（覆盖全 8 类）
 */
export function generateSampleRegistry() {
  const entries = COMPONENT_CATEGORIES.flatMap((type) =>
    Array.from({ length: STANDARD_COUNTS[type] }, (_, index) => ({
      id: `${type}-sample-${index + 1}`,
      name: `${type}-sample-${index + 1}`,
      type,
      desc: `standard ${type} component ${index + 1}`,
      context: type === 'item' ? 'ui' : 'map',
      states: CATEGORY_SPECS[type].defaultStates,
      capabilities: ['readable'],
    })),
  );
  return {
    kind: 'wakeup-batch-manifest',
    version: 4,
    policy: { assetStatus: 'pending-human-review', sourceStatus: 'design-fragment-only', topologyIndependent: true },
    defaults: { context: 'map', cell: 64, colors: 32 },
    entries,
  };
}

/**
 * 生成/同步登记清单并在本地目录构建 Manifest 与挂载结构
 */
export function buildComponentsManifest(registryPath = DEFAULT_REGISTRY_PATH, outDir = DEFAULT_OUTPUT_DIR) {
  let manifestData;
  if (!existsSync(registryPath)) {
    manifestData = generateSampleRegistry();
    mkdirSync(dirname(registryPath), { recursive: true });
    writeFileSync(registryPath, JSON.stringify(manifestData, null, 2), 'utf8');
    console.log(`[AssetPipeline] 已生成默认 8 类登记清单: ${registryPath}`);
  } else {
    manifestData = JSON.parse(readFileSync(registryPath, 'utf8'));
    if (manifestData.version !== 4) {
      throw new Error(`[AssetPipeline] 仅接受 version=4 的 D-088 标准 48 件清单，实际为 ${manifestData.version}`);
    }
  }

  const validation = validateBatchRegistry(manifestData);
  if (!validation.ok) {
    throw new Error(`[AssetPipeline] 清单校验失败:\n  - ${validation.errors.join('\n  - ')}`);
  }

  mkdirSync(outDir, { recursive: true });
  const indexEntries = [];

  for (const entry of manifestData.entries) {
    const entryDir = join(outDir, entry.name);
    mkdirSync(entryDir, { recursive: true });

    const spec = CATEGORY_SPECS[entry.type] || { context: 'map', perspective: 'axonometric', defaultStates: ['single'] };
    const states = entry.states && entry.states.length > 0 ? entry.states : spec.defaultStates;

    const componentManifest = {
      id: entry.id,
      name: entry.name,
      type: entry.type,
      desc: entry.desc,
      perspective: spec.perspective,
      context: entry.context || spec.context,
      states,
      capabilities: entry.capabilities,
      cell: entry.cell || manifestData.defaults.cell || 64,
      colors: entry.colors || manifestData.defaults.colors || 32,
      assets: {
        sourceRaw: null,
        sheet: null,
        frames: [],
      },
      qc: { status: 'pending-human-review', automated: false, checksum: null },
      provenance: { source: manifestData.policy?.sourceStatus ?? 'design-fragment-only', topologyIndependent: manifestData.policy?.topologyIndependent === true },
      runtimeBinding: {
        selectableInEditor: true,
        presentationMount: entry.context === 'map' ? 'scene-object' : 'inventory-icon',
        profileType: entry.type,
        entityRef: `material:${entry.id}`,
      },
    };

    writeFileSync(join(entryDir, 'manifest.json'), JSON.stringify(componentManifest, null, 2), 'utf8');
    indexEntries.push(componentManifest);
  }

  const catalog = {
    kind: 'wakeup-component-catalog',
    version: 4,
    count: indexEntries.length,
    status: 'pending-human-review',
    categories: STANDARD_COUNTS,
    components: indexEntries,
    updatedAt: new Date().toISOString(),
  };

  writeFileSync(join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2), 'utf8');
  console.log(`[AssetPipeline] 成功装载并构建 8 类组件目录 (${indexEntries.length} 项) -> ${join(outDir, 'catalog.json')}`);
  return catalog;
}

// CLI 执行
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    buildComponentsManifest();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
