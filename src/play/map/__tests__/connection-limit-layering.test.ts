/**
 * 连接数上限的两层分工契约。
 *
 * 基类层 `src/class/scenes/index.json` 只登记五并列原则给出的**天花板** 5，因为只有 L0 支撑这个数；
 * `docs/L2_基类层/03_空间系统.md` 按尺度收紧到 5/4/3 的那张更严的表属于地图编排规则，落在玩法层
 * `CONNECTION_LIMIT` 并由 `validateMapStructure` 强制。
 *
 * 这条分工必须被机械钉死，否则会朝两个方向退化：
 * - 玩法层某一档被放宽到超过天花板 → 一张地图能过玩法层校验却违反基类层结构边界；
 * - 玩法层三档全等于天花板 → 「天花板 + 收紧」退化成重复登记同一个数，03 号文档的空间性格丢失。
 *
 * 依赖方向是玩法层 → 基类层，与三层架构一致；反向断言（基类层 import 玩法层）不允许。
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseClassJson } from '../../../class/catalog-loader.js';
import { parseClassCatalog } from '../../../class/class-contract.js';
import { CONNECTION_LIMIT, type SceneScale } from '../types.js';

const SCALES: readonly SceneScale[] = ['large', 'medium', 'small'];
const CEILING_BOUND_ID = 'structural-bound.scene.connection_limit';

function sceneCatalog(): ReturnType<typeof parseClassCatalog> {
  const classRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'class');
  const path = join(classRoot, 'scenes', 'index.json');
  return parseClassCatalog(parseClassJson(readFileSync(path, 'utf8'), 'scenes/index.json'), 'scenes/index.json');
}

describe('connection limit layering between the base layer ceiling and the play layer table', () => {
  it('registers exactly one L0-sourced ceiling in the base layer', () => {
    const bounds = sceneCatalog().structuralBounds.filter((bound) => bound.id === CEILING_BOUND_ID);
    expect(bounds).toHaveLength(1);
    const ceiling = bounds[0]!;
    expect(ceiling.value).toBe(5);
    expect(ceiling.classification).toBe('Structural_Bound');
    expect(ceiling.precedence).toBe('l0-constitution');
    expect(ceiling.authoritativeSourceSection).toContain('五并列原则');
  });

  it('keeps every play-layer per-scale limit within the base-layer ceiling', () => {
    const ceiling = sceneCatalog().structuralBounds.find((bound) => bound.id === CEILING_BOUND_ID)?.value;
    expect(ceiling).toBe(5);
    for (const scale of SCALES) {
      expect(CONNECTION_LIMIT[scale], scale).toBeGreaterThanOrEqual(1);
      expect(CONNECTION_LIMIT[scale], scale).toBeLessThanOrEqual(ceiling as number);
    }
  });

  it('keeps the play-layer table strictly tighter than the ceiling for at least one scale', () => {
    const ceiling = sceneCatalog().structuralBounds.find((bound) => bound.id === CEILING_BOUND_ID)?.value as number;
    expect(SCALES.some((scale) => CONNECTION_LIMIT[scale] < ceiling)).toBe(true);
  });

  it('matches the per-scale table stated by the space-system document', () => {
    expect(CONNECTION_LIMIT).toEqual({ large: 5, medium: 4, small: 3 });
  });

  it('keeps every scale referencing the single base-layer ceiling instead of inventing its own bound', () => {
    const catalog = sceneCatalog();
    const boundIds = new Set(catalog.structuralBounds.map((bound) => bound.id));
    for (const scale of SCALES) {
      const entry = catalog.classes.find((candidate) => candidate.id === `scene.class.${scale}`);
      expect(entry, scale).toBeDefined();
      expect(entry?.structuralBoundRefs, scale).toContain(CEILING_BOUND_ID);
      for (const reference of entry?.structuralBoundRefs ?? []) {
        expect(boundIds.has(reference), `${scale} -> ${reference}`).toBe(true);
      }
    }
  });
});
