#!/usr/bin/env node
/**
 * MapData → Mermaid 图（开发期可视化检查）。
 *
 * 「编辑器后置」前提下的最低成本可视化：把 `MapData` 归一化坐标拍平成一个 mermaid
 * flowchart，节点按 scale/锚点配色、边标注方向 token 与遮挡/过渡窗口。产出纯文本，
 * 可在任意支持 mermaid 的渲染器（GitHub、VS Code、CI markdown）里看，零 UI 维护。
 *
 * 这不是正式地图编辑器——它只解决「数据契约这条链路通没通时，肉眼能否检查」的问题。
 * 编辑器 UI 留到后置排期（D-072 编辑器=可选 、数据契约=必需）。
 *
 * node scripts/asset-pipeline/map-to-mermaid.mjs [mapJsonPath]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = resolve(fileURLToPath(new URL('.', import.meta.url)));
const ROOT = resolve(here, '../..');

const SCALE_COLOR = {
  large: '#7A8B99', // 中性灰
  medium: '#4A90D9', // 蓝：精确/可执行
  small: '#3FAE7A', // 绿：通行/可走
};
const DIR_LABEL = {
  bidirectional: '<->',
  unidirectional: '->',
  'one-way-down': 'down↓',
  'one-way-up': 'up↑',
};

/** 图元颜色映射（对照 D-074 / 编辑域图元穷举）用于边框标注。 */
export function figColors(node) {
  return node.semanticAnchor === 'high' ? '{"color":"#274B2A"}'
    : node.semanticAnchor === 'low' ? '{"color":"#7FAE5A"}'
    : '';
}

/** 把一张 MapData 转成 mermaid flowchart 文本。 */
export function toMermaid(map) {
  const lines = ['```mermaid', 'flowchart LR'];
  const idOf = (raw) => raw.replace(/[^a-zA-Z0-9]/g, '_');

  // 节点：名称 + scale 颜色 + 语义锚点角标。
  for (const node of map.nodes) {
    const scale = SCALE_COLOR[node.scale] ?? SCALE_COLOR.medium;
    const anchor = node.parent ? ` / p:${node.parent}` : '';
    const label = `${node.name ?? node.id} (${node.scale})${anchor}`;
    const style = figColors(node) ? `:::${node.semanticAnchor}` : '';
    lines.push(`  ${idOf(node.id)}["${label}"]${style}`);
  }

  // 边：方向 token + 遮挡/过渡标注。
  for (const edge of map.edges) {
    const dir = DIR_LABEL[edge.directionality] ?? edge.directionality;
    const marks = [];
    if (edge.visualObstruction) marks.push('👁视觉遮挡');
    if (edge.physicalObstruction) marks.push('🧱物理遮挡');
    if (edge.transitionWindow) marks.push('🚪过渡窗');
    const portal = edge.def?.split('/').pop() ?? 'link';
    const label = `${dir} ${portal}${marks.length ? ' [' + marks.join(', ') + ']' : ''}`;
    lines.push(`  ${idOf(edge.a)} -- "${label.trim()}" --> ${idOf(edge.b)}`);
  }

  // 图例（配色说明，供无美术经验者一眼看懂）。
  lines.push('  classDef high stroke:#274B2A,fill:#A5C8A5');
  lines.push('  classDef low stroke:#7FAE5A,fill:#DCEFCE');
  lines.push('```');
  return lines.join('\n');
}

function main() {
  const file = process.argv[2] ?? 'tmp/asset-pipeline/maps/sample-sleeper.json';
  const map = JSON.parse(readFileSync(resolve(ROOT, file), 'utf8'));
  process.stdout.write(`${toMermaid(map)}\n`);
}

if ((() => {
  const entry = process.argv[1];
  if (!entry) return false;
  const entryUrl = new URL(`file://${entry.startsWith('/') ? entry : `/${entry.replace(/\\/g, '/')}`}`).href;
  return import.meta.url === entryUrl;
})()) {
  main();
}
