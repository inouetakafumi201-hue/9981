/**
 * Feature: wakeup-base-layer-ecs, Property 8: 只读投影不写语义状态
 *
 * Validates: Requirements 4.1, 4.2
 *
 * 对于任何只读语义投影，其不能改写语义状态，任何写入只经 L1 允许的写通道。
 *
 * Requirement 4.1：只读投影不写语义状态。
 * Requirement 4.2：组件承载项写入的通道契约 —— 任何写入只经 `OpRegistry.invoke`。
 *
 * 本属性把该守则落实到组件契约形状层：
 * - 每个组件的 `writeChannelContract` 恒为 `{ channel: 'OpRegistry.invoke', alternateChannels: 'none' }`
 *   （EMPTY_WRITE_CHANNEL_CONTRACT），即唯一写通道是 OpRegistry，没有任何备用通道；
 * - `static` 组件是 L2 不内嵌值的验证面：它只声明字段形状（values 由 L3/UGC 填），
 *   因此其 `parameters` 不携带默认值，避免 L2 把语义值写死进组件。
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { ALL_FAMILY_SHAPES } from '../../../src/l2/model/family-component-shapes.js';
import { COMPOSITION_REGISTRY } from '../../../src/l2/model/family-component-shapes.js';

describe('Property 8: 只读投影不写语义状态', () => {
  it('每个组件的写通道契约唯一且恒为 OpRegistry.invoke，无备用通道', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_FAMILY_SHAPES.flatMap((s) => s.components)),
        (component) => {
          const wc = component.writeChannelContract;
          expect(wc).toBeDefined();
          expect(wc!.channel).toBe('OpRegistry.invoke');
          expect(wc!.alternateChannels).toBe('none');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('static 组件只声明形状、不内嵌默认值（值由 L3/UGC 填）', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_FAMILY_SHAPES.flatMap((s) => s.components)),
        (component) => {
          if (component.compositionKind !== 'static') {
            return; // 只对 static 验证面断言：static 描述其 L2 不内嵌值。
          }
          // L2 不内嵌语义值：parameters 只有形状接口（dataType/required/classification），
          // 不携带 defaultValue / 具体 enum value 当作语义载荷。
          for (const field of component.parameters) {
            expect('defaultValue' in field).toBe(false);
          }
          // 写通道守则对 static 同样成立。
          expect(component.writeChannelContract!.channel).toBe('OpRegistry.invoke');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('写入只经注册表可解析的唯一写通道，无其它落盘通道裸露', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (recheck) => {
          const all = COMPOSITION_REGISTRY.listComponents();
          for (const component of all) {
            const wc = component.writeChannelContract;
            expect(wc).toBeDefined();
            expect(wc!.channel).toBe('OpRegistry.invoke');
          }
          if (recheck) {
            // 可重复读取：写通道契约在只读场景下稳定（不因查询而翻转）。
            expect(COMPOSITION_REGISTRY.listComponents().length).toBe(all.length);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
