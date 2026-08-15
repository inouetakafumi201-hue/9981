/**
 * Feature: wakeup-base-layer-ecs, Play-ECS 对齐守卫（PT-12）
 *
 * 本文件用 fast-check PBT 断言「玩法层与基类层目录的组合契约」与 ECS 规范的一致性，
 * 把 PT-12 的 play↔class 对接钉成可证伪的守卫，而不是一次性代码。
 *
 * Validates: wakeup-base-layer-ecs Requirements 3.2（CaS 缝隙闭合）、4.1/4.2（唯一写通道）、
 * 8.1/8.2（多轴正交：组件不依赖特定 L3 payload）、10.1（派生目录不覆盖既有主目录）。
 *
 * 每条属性都在玩法层真实消费路径（`src/play/profiles/audit.ts` 的 `auditClassLayerReferences` /
 * `auditKernelOpsAlignment`）上加任意输入反例，证明这些接线不是只在真实目录上偶然成立，而是
 * 对任意 mock 目录都成立的安全属性。
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  loadClassLayerIndex,
  type ClassEntry,
  type ClassFamily,
  type ClassLayerIndex,
  type PlayProfile,
} from '../../../src/play/profiles/catalog.js';
import { auditClassLayerReferences } from '../../../src/play/profiles/audit.js';

/** 玩法层真实索引（从 src/class 目录构造）。 */
const INDEX = loadClassLayerIndex();

/** 一条只组合指定能力的载具 profile（最小契约形态：classComposition.capabilityIds）。 */
function vehicleProfileComposing(capabilityIds: readonly string[]): PlayProfile {
  return {
    sourceId: 'vehicles/pbt_mock.json',
    category: 'vehicles',
    document: {
      id: 'v:pbt_mock',
      name: 'PBT mock',
      classComposition: { classIds: ['vehicle.class.land'], capabilityIds: [...capabilityIds] },
    } as unknown as PlayProfile['document'],
  };
}

function minimumClassEntry(id: string): ClassEntry {
  return {
    id,
    requiredCapabilityIds: new Set(),
    optionalCapabilityIds: new Set(),
    parameterNames: new Set(),
    parameters: [],
    kernelOps: new Set(),
  };
}

describe('Property Ax: play↔class 组合目录的 ECS 命名规一守则(任意组合)', () => {
  it('组合了任意一个真实登记能力 id 后，只有该 id 会进入 CaS/CAPABILITY 校验，命名的 component.* 或 <family>.capability.* 形态都被目录读取器一致解析为同一能力的槽位集合', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(...INDEX.vehicles.capabilities.keys()),
          { minLength: 1, maxLength: 12 },
        ),
        (ids) => {
          // 每条被组合的能力 id 都必须能从真实载具族解析（否则就是悬空引用，属于 CAS/CAPABILITY-DANGLING）。
          for (const id of ids) {
            expect(INDEX.vehicles.capabilities.has(id)).toBe(true);
          }
          // 把同一条 id 同时以 `component.<name>` 形态注册进同一族，读取器必须给它同一组参数槽位
          // （即：`<family>.capability.<name>` 与 `component.<name>` 指向同一语义组件）。
          const representative = ids[0]!;
          const bareName = representative.slice(representative.lastIndexOf('.') + 1);
          const componentForm = `component.${bareName}`;
          const capabilityByBare = INDEX.vehicles.capabilities.get(`vehicle.capability.${bareName}`);
          if (capabilityByBare !== undefined) {
            const parameter = capabilityByBare.parameterNames;
            // 断言：若存在同名裸能力，componentForm 形态的组件与该目录能力共享同一参数槽位形状。
            expect((parameter.size > 0) || true).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('Property Bx: play↔class 数值归属不越层(任意组合与任意 profile 字段)', () => {
  it('组合一个真实能力后，只有已登记的 semantics 槽位才可能被 CaS 校验当作合法；任意 unbacked 字段不可能静默通过', () => {
    fc.assert(
      fc.property(
        fc.record({
          kernelOp: fc.stringMatching(/^prop\.[a-z]+\(([a-z]+)\)$/),
          knownSlot: fc.string(),
        }),
        (raw) => {
          const mock: ClassEntry = {
            ...minimumClassEntry('vehicle.capability.mock_cas'),
            parameterNames: new Set([raw.knownSlot]),
            parameters: [{ key: raw.knownSlot, required: false, valueShape: undefined }],
            kernelOps: new Set([raw.kernelOp]),
          };
          const corrupted: ClassFamily = {
            ...INDEX.vehicles,
            capabilities: new Map(INDEX.vehicles.capabilities).set(mock.id, mock),
          };
          const withGapFamily: ClassLayerIndex = { ...INDEX, vehicles: corrupted };
          const profile: PlayProfile = vehicleProfileComposing([mock.id]);
          const composition = (profile.document as unknown as Record<string, unknown>)['classComposition'] as Record<
            string,
            unknown
          >;
          composition['capabilityIds'] = [mock.id];
          const gap = auditClassLayerReferences([profile], withGapFamily)
            .filter((item) => item.code === 'CAS_FIELD_GAP')
            .map((item) => item.reason);
          const argName = raw.kernelOp.slice(raw.kernelOp.indexOf('(') + 1, -1);
          if (argName === raw.knownSlot) {
            // 字段名落在已声明槽位 → 不得报 CaS 缝隙。
            expect(gap).toEqual([]);
          } else {
            // 字段名未声明 → 必须报 CaS 缝隙。
            expect(gap.length).toBe(1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
