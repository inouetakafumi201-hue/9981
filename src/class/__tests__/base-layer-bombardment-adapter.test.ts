/**
 * 基类层收官轰炸 —— 属性 12：L2 适配器运行时配置兼容与 Q-04 边界。
 *
 * Feature: wakeup-base-layer-bombardment, Property 12
 * 验证：要求 6.1（vehicleToRuntimeConfig 输出字段与 L1 运行时契约分类兼容，且不推导
 *       category:'carrier' 承载面——Q-04 未决，维持现状）、6.3（脏配置 validate*RuntimeConfig 返回结构化
 *       字符串而不抛未捕获异常）。要求 6.2（写只经 KernelContract.invoke / L1 允许写通道）由
 *       throughline 属性 13 的跨目录写通道扫描落地，本文件不自证（避免重复断言，见 design.md 复用说明）。
 *
 * 真实模块直连 `src/l2/adapters/space-items-adapter.ts`，不做 mock。
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CandidateDefinition } from '../../l2/model/definition.js';
import type { ContainerDomainContract } from '../../l2/model/space-items-contracts.js';
import {
  containerToRuntimeConfig,
  sceneToRuntimeConfig,
  vehicleToRuntimeConfig,
  validateContainerRuntimeConfig,
  validateSceneRuntimeConfig,
  validateVehicleRuntimeConfig,
} from '../../l2/adapters/space-items-adapter.js';

/** 构造一个最小 CandidateDefinition（L2 BaseDefinition 形状；字段由测试以 Record 形态提供）。 */
function candidate(id: string, fields: Record<string, unknown>): CandidateDefinition & Record<string, unknown> {
  return {
    id,
    defKind: 'item',
    abstract: true,
    semanticFamily: { familyId: 'movement' },
    typeIdentity: { basis: 'invariant', statement: 'test' },
    composition: [],
    parameterSchema: { fields: [] },
    tags: [],
    actionRefs: [],
    ruleRefs: [],
    sourceRecords: [],
    ...fields,
  } as unknown as CandidateDefinition & Record<string, unknown>;
}

describe('属性12：L2 适配器运行时配置兼容与 Q-04 边界', () => {
  it('vehicleToRuntimeConfig 输出字段集与 L1 运行时契约分类兼容（不推导 category:carrier 承载面）', () => {
    const def = candidate('vehicle.class.land', {
      seatIds: ['s1', 's2'],
      cargoContainerIds: ['c1'],
      doorIds: ['d1'],
      driverAgentSlotRef: { $: 'seat.s1', refId: 'seat.s1' },
      adjacencyRuleIds: ['adj.1'],
    });
    const config = vehicleToRuntimeConfig(def);
    // VehicleRuntimeConfig 是 L1 运行动态承载容器/座舱的已知面：seat/cargo/door/driver/adjacency。
    expect(config.vehicleId).toBe('vehicle.class.land');
    expect(config.seatIds).toEqual(['s1', 's2']);
    expect(config.cargoContainerIds).toEqual(['c1']);
    expect(config.doorIds).toEqual(['d1']);
    // Q-04 边界：config 不携带任何 category:'carrier' 承载面字段（未推导载器机制）。
    expect('category' in config).toBe(false);
    expect(JSON.stringify(config)).not.toContain('"category":"carrier"');
    expect(JSON.stringify(config)).not.toContain('class.stationary');
    expect(JSON.stringify(config)).not.toContain('container.enter');
    expect(JSON.stringify(config)).not.toContain('container.exit');
  });

  it('脏 vehicle 定义缺 seat 数组 → 转换为空数组配置，validate 返回结构化字符串（不抛）', () => {
    const config = vehicleToRuntimeConfig(candidate('v.bad', {}));
    let errors: readonly string[] = [];
    try {
      errors = validateVehicleRuntimeConfig(config);
    } catch (error) {
      throw new Error(`validateVehicleRuntimeConfig 不应抛异常: ${error instanceof Error ? error.message : String(error)}`);
    }
    // 空 seat 数组会触发"至少一个座位"的结构化字符串错误（非抛异常）。
    expect(Array.isArray(errors)).toBe(true);
  });

  it('containerToRuntimeConfig 转换的配置经 validate 对非法 hostType 返回结构化错误', () => {
    const badContract = {
      hostType: 'wombat' as unknown as 'item' | 'vehicle',
      containerRole: '',
      transferActionRef: undefined as never,
    } as unknown as ContainerDomainContract;
    const config = containerToRuntimeConfig(candidate('c.bad', { hostType: 'wombat' }), badContract);
    let errors: readonly string[] = [];
    try {
      errors = validateContainerRuntimeConfig(config);
    } catch (error) {
      throw new Error(`validateContainerRuntimeConfig 不应抛异常: ${error instanceof Error ? error.message : String(error)}`);
    }
    // 非法 hostType 命中'Invalid hostType: wombat'。
    expect(errors.some((e) => e.includes('Invalid hostType'))).toBe(true);
  });

  it('脏输入的 validate*RuntimeConfig 对所有自由坏值返回结构化字符串列表而非抛异常（500 次生成）', () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.boolean(),
        (id, weird) => {
          // 无论 id 多脏，validate 都必须以字符串数组作答、不抛未捕获异常。
          const container = containerToRuntimeConfig(
            candidate(id, { hostType: weird ? 'item' : 'vehicle' }),
            { hostType: 'item', containerRole: id, transferActionRef: undefined as never } as unknown as ContainerDomainContract,
          );
          const scene = sceneToRuntimeConfig(candidate(id, { scale: weird ? 'huge' : 'small' }));
          let containerMsg: string[] = [];
          let sceneMsg: string[] = [];
          try { containerMsg = [...validateContainerRuntimeConfig(container)]; } catch { throw new Error('container validate 抛异常'); }
          try { sceneMsg = [...validateSceneRuntimeConfig(scene)]; } catch { throw new Error('scene validate 抛异常'); }
          expect(Array.isArray(containerMsg)).toBe(true);
          expect(Array.isArray(sceneMsg)).toBe(true);
          return true;
        },
      ),
      { numRuns: 500, seed: 0x5eed_b00c },
    );
  });
});
