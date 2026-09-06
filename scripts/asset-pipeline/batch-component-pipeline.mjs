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
    }

    if (!entry.desc || typeof entry.desc !== 'string') {
      errors.push(`${tag}: desc 必须是非空描述`);
    }
  });

  return { ok: errors.length === 0, errors };
}

/**
 * 生成默认样例素材清单（覆盖全 8 类）
 */
export function generateSampleRegistry() {
  return {
    kind: 'wakeup-batch-manifest',
    version: 3,
    defaults: {
      context: 'map',
      cell: 64,
      colors: 32,
    },
    entries: [
      { name: 'actor-dream-guard', type: 'ai-unit', desc: 'autonomous dream guard', context: 'map' },
      { name: 'npc-night-clerk', type: 'npc', desc: 'interactive night clerk', context: 'map' },
      { name: 'vehicle-service-cart', type: 'vehicle', desc: 'small service vehicle', context: 'map' },
      { name: 'container-storage-crate', type: 'container', desc: 'reinforced storage container', context: 'map' },
      { name: 'item-field-bandage', type: 'item', desc: 'sterile field bandage', context: 'ui' },
      { name: 'device-power-generator', type: 'device', desc: 'portable power generator', context: 'map' },
      { name: 'decoration-bench', type: 'decoration', desc: 'weathered station bench', context: 'map' },
      { name: 'transition-carriage-door', type: 'transition-scene', desc: 'carriage door endpoint scene', context: 'map' },
    ],
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
    if (manifestData.version !== 3) {
      manifestData = generateSampleRegistry();
      writeFileSync(registryPath, JSON.stringify(manifestData, null, 2), 'utf8');
      console.log(`[AssetPipeline] 已把旧分类清单迁移到 D-088 八类: ${registryPath}`);
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
      name: entry.name,
      type: entry.type,
      desc: entry.desc,
      perspective: spec.perspective,
      context: entry.context || spec.context,
      states,
      cell: entry.cell || manifestData.defaults.cell || 64,
      colors: entry.colors || manifestData.defaults.colors || 32,
      runtimeBinding: {
        selectableInEditor: true,
        presentationMount: entry.context === 'map' ? 'scene-object' : 'inventory-icon',
        profileType: entry.type,
      },
    };

    writeFileSync(join(entryDir, 'manifest.json'), JSON.stringify(componentManifest, null, 2), 'utf8');
    indexEntries.push(componentManifest);
  }

  const catalog = {
    kind: 'wakeup-component-catalog',
    version: 3,
    count: indexEntries.length,
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
