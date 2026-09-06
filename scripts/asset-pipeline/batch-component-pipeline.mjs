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
  'weapon-melee',
  'weapon-ranged',
  'weapon-firearm',
  'item-consumable',
  'item-tool',
  'item-equipment',
  'device',
  'environment',
];

/** 每种类别的默认透视与上下文 */
export const CATEGORY_SPECS = {
  'weapon-melee': { context: 'ui', perspective: 'axonometric', defaultStates: ['single', 'equipped'] },
  'weapon-ranged': { context: 'ui', perspective: 'axonometric', defaultStates: ['single', 'equipped'] },
  'weapon-firearm': { context: 'ui', perspective: 'axonometric', defaultStates: ['single', 'equipped'] },
  'item-consumable': { context: 'ui', perspective: 'front', defaultStates: ['single', 'consumed'] },
  'item-tool': { context: 'ui', perspective: 'front', defaultStates: ['single', 'active'] },
  'item-equipment': { context: 'ui', perspective: 'front', defaultStates: ['single', 'equipped'] },
  'device': { context: 'map', perspective: 'axonometric', defaultStates: ['idle', 'active', 'broken'] },
  'environment': { context: 'map', perspective: 'axonometric', defaultStates: ['closed', 'open', 'broken'] },
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
    version: 2,
    defaults: {
      context: 'map',
      cell: 64,
      colors: 32,
    },
    entries: [
      {
        name: 'wp-iron-knife',
        type: 'weapon-melee',
        desc: 'heavy steel combat knife',
        states: ['single', 'equipped'],
        context: 'ui',
      },
      {
        name: 'wp-hunting-bow',
        type: 'weapon-ranged',
        desc: 'reinforced composite hunting bow',
        states: ['single', 'equipped'],
        context: 'ui',
      },
      {
        name: 'wp-service-revolver',
        type: 'weapon-firearm',
        desc: 'service revolver caliber 38',
        states: ['single', 'equipped'],
        context: 'ui',
      },
      {
        name: 'item-field-bandage',
        type: 'item-consumable',
        desc: 'sterile medical compression bandage',
        states: ['single'],
        context: 'ui',
      },
      {
        name: 'tool-lockpick-set',
        type: 'item-tool',
        desc: 'mechanical tension wrench lockpick set',
        states: ['single', 'active'],
        context: 'ui',
      },
      {
        name: 'eq-tactical-vest',
        type: 'item-equipment',
        desc: 'tactical body armor plate carrier vest',
        states: ['single', 'equipped'],
        context: 'ui',
      },
      {
        name: 'dev-power-generator',
        type: 'device',
        desc: 'portable fuel electric generator',
        states: ['idle', 'active', 'broken'],
        context: 'map',
      },
      {
        name: 'env-storage-crate',
        type: 'environment',
        desc: 'reinforced wooden supply container',
        states: ['closed', 'open', 'broken'],
        context: 'map',
      },
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
        profileType: entry.type.startsWith('weapon') ? 'weapon' : entry.type.startsWith('item') ? 'item' : 'scene',
      },
    };

    writeFileSync(join(entryDir, 'manifest.json'), JSON.stringify(componentManifest, null, 2), 'utf8');
    indexEntries.push(componentManifest);
  }

  const catalog = {
    kind: 'wakeup-component-catalog',
    version: 2,
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
