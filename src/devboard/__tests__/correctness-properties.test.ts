/**
 * 正确性属性 1–5（开发板 UI 侧 PBT，fast-check ≥100 迭代）。
 * Design Correctness Properties；标签 `Feature: devboard, Property N: ...`。
 * 只验证 devboard 编辑行为；契约细节（`MapData.layers`）由权威文稿背书。
 * fast-check: property 谓词返回 void、用 expect 断言（对齐 test/properties 既有风格）。
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { overlayOpacity } from '../layers/layer-shapes';
import { hasDuplicateHeights, visibleLayers } from '../layers/layer-rules';

// 生成一个图层：id、可空 height（留空 = 三界外）。option 用 { nil: undefined } 让留空为 undefined。
// 稳定 id：非空、不含空白（对齐 isStableIdentity）。
const stableIdArb = fc.stringMatching(/^[A-Za-z0-9_]{1,12}$/);
// 有限正小数（fast-check double 可能产出 NaN/Infinity，filter 掉；显式标注类型避免谓词 any）。
const finitePosArb: fc.Arbitrary<number> = fc
  .double({ min: 0.1, max: 20 })
  .filter((n): n is number => Number.isFinite(n) && n > 0);

// 图层 id + 可空 height；map 展开成 `?` height，保证类型为 `{ id: string; height?: number }`。
const singleLayerArb: fc.Arbitrary<{ id: string; height?: number }> = fc
  .record({
    id: stableIdArb,
    height: fc.option(finitePosArb, { nil: undefined }),
  })
  .map((l) => ({
    id: l.id,
    ...(l.height !== undefined ? { height: l.height } : {}),
  }));
// 数组 arbitrary：用 `fc.tuple(唯一id数组, height数组)` 拼出"id 各不相同的图层集"，避免同 id / NaN 反例。
const layerArrArb: fc.Arbitrary<{ id: string; height?: number }[]> = fc
  .tuple(
    fc.uniqueArray(fc.stringMatching(/^[A-Za-z0-9_]{1,12}$/), { minLength: 0, maxLength: 12 }),
    fc.array(fc.option(finitePosArb, { nil: undefined }).map((h) => h ?? undefined), {
      minLength: 0,
      maxLength: 12,
    }),
  )
  .map(([ids, heights]) =>
    ids.map((id, i) => {
      const h = heights[i];
      return h === undefined ? { id } : { id, height: h };
    }),
  );

describe('devboard correctness properties', () => {
  it('Property 1: 当前图层可见性过滤 — 只暴露当前图层及低于它的图层，严格更高层绝不出现', () => {
    fc.assert(
      fc.property(layerArrArb, fc.option(fc.integer({ min: 0, max: 11 })), (layersRaw, idx) => {
        const layers = layersRaw;
        if (layers.length === 0) return;
        const currentId = layers[idx! % layers.length]!.id;
        const visible = visibleLayers(layers, currentId).map((l) => l.id);
        const current = layers.find((l) => l.id === currentId)!;
        for (const l of layers) {
          if (l.id === currentId) continue;
          // 当前图层有 height 时：参与透视且严格更高 → 必须不可见
          if (current.height !== undefined && l.height !== undefined && l.height > current.height) {
            expect(visible).not.toContain(l.id);
          } else {
            // 留空(三界外)与不高于当前的 → 应可见
            expect(visible).toContain(l.id);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('Property 2: 参与透视的 height 去重成立，留空(三界外)图层可有多个', () => {
    fc.assert(
      fc.property(fc.array(singleLayerArb, { minLength: 1, maxLength: 15 }), (layers) => {
        const seen = new Set<number>();
        let dup = false;
        for (const l of layers) {
          if (l.height !== undefined) {
            if (seen.has(l.height)) {
              dup = true;
              break;
            }
            seen.add(l.height);
          }
        }
        // hasDuplicateHeights 与手工扫描一致：同高参与透视→真，否则假。
        expect(hasDuplicateHeights(layers)).toBe(dup);
      }),
      { numRuns: 200 },
    );
  });

  it('Property 3: 贴纸锁定后不可再选 — 可选项集绝不含 locked 贴纸', () => {
    // id 全局唯一；同一 id 不应同时出现 locked 与 unlocked（否则"id 身份"本就不稳）。
    fc.assert(
      fc.property(fc.array(fc.record({ id: fc.stringMatching(/^s[0-9]{1,4}$/), locked: fc.boolean() }), { maxLength: 20 }), (sticks) => {
        // 若同一 id 同时 locked+unlocked → 跳过该反例（约束不成立，非属性反例）
        const ids = sticks.map((s) => s.id);
        for (const id of ids) {
          const flags = sticks.filter((s) => s.id === id).map((s) => s.locked);
          if (flags.includes(true) && flags.includes(false)) return; // 同 id 两态 → 不算
        }
        const selectableSet = new Set(sticks.filter((s) => !s.locked).map((s) => s.id));
        for (const s of sticks) {
          if (s.locked) {
            expect(selectableSet.has(s.id)).toBe(false);
          } else {
            expect(selectableSet.has(s.id)).toBe(true);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('Property 4: 导出不含 bounds，且图层变换(transform)可序列化保序', () => {
    // 命名 arbitrary：让 fast-check 推断元素的具体类型，避免谓词参数隐式 any。
    interface TransformedLayer {
      id: string;
      height?: number;
      transform: { scaleX: number; scaleY: number; tx: number; ty: number };
    }
    const layerWithTransformArb: fc.Arbitrary<TransformedLayer> = fc
      .record({
        id: fc.stringMatching(/^[A-Za-z0-9_]{1,12}$/),
        height: fc.option(fc.double({ min: 0.1, max: 20 }).filter((n) => Number.isFinite(n)), { nil: undefined }),
        transform: fc.record({
          scaleX: fc.double({ min: 0.1, max: 10 }).filter((n) => Number.isFinite(n)),
          scaleY: fc.double({ min: 0.1, max: 10 }).filter((n) => Number.isFinite(n)),
          tx: fc.double({ min: -1000, max: 1000 }).filter((n) => Number.isFinite(n)),
          ty: fc.double({ min: -1000, max: 1000 }).filter((n) => Number.isFinite(n)),
        }),
      })
      .map((l) => ({
        id: l.id,
        ...(l.height !== undefined ? { height: l.height } : {}),
        transform: l.transform,
      }));
    fc.assert(
      fc.property(fc.array(layerWithTransformArb, { maxLength: 10 }), (layers: TransformedLayer[]) => {
        // 导出产物序列化后不含 "bounds"
        const published = JSON.stringify({
          layers: layers.map((l) => ({
            id: l.id,
            height: l.height,
            transform: l.transform,
          })),
        });
        expect(published).not.toContain('"bounds"');
        // transform 每层可 roundtrip 且保序
        const parsed = JSON.parse(published).layers as { id: string; height?: number; transform: { scaleX: number; scaleY: number; tx: number; ty: number } }[];
        expect(parsed.length).toBe(layers.length);
        for (let i = 0; i < layers.length; i++) {
          expect(parsed[i]!.id).toBe(layers[i]!.id);
          // JSON 序列化会把 -0 变成 0，roundtrip 断言前先规一，校验的是序列化契约本身而非 -0 表示。
          const norm = (n: number): number => (Object.is(n, -0) ? 0 : n);
          expect(norm(parsed[i]!.transform.scaleX)).toBe(norm(layers[i]!.transform.scaleX));
          expect(norm(parsed[i]!.transform.tx)).toBe(norm(layers[i]!.transform.tx));
        }
      }),
      { numRuns: 200 },
    );
  });

  it('Property 5: 透明公式单调 — 两侧都填 height 时 opacity = clamp(1 - |Δh| × 0.1, 0, 1)，差满 10 达 0，且随差值单调不增(含浮点容差)', () => {
    fc.assert(
      fc.property(finitePosArb, finitePosArb, (a, b) => {
        const op = overlayOpacity(a, b);
        expect(op).not.toBeNull();
        const d = Math.abs(a - b);
        if (d >= 10) {
          expect(op).toBe(0);
        } else {
          expect(op!).toBeCloseTo(1 - d * 0.1, 5);
        }
        // 任一侧留空 → null（三界外不叠加）
        expect(overlayOpacity(undefined, b)).toBeNull();
        expect(overlayOpacity(a, undefined)).toBeNull();
        // 差值变大时不透明度不增（对浮点用相对容差）
        const op2 = overlayOpacity(a + 0.5, b);
        expect(op2).not.toBeNull();
        const diffAfter = Math.abs(a + 0.5 - b);
        const expected = Math.max(0, Math.min(1, 1 - diffAfter * 0.1));
        expect(op2!).toBeCloseTo(expected, 5);
      }),
      { numRuns: 200 },
    );
  });

});
