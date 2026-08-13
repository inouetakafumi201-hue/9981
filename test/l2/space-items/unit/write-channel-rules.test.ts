/**
 * 空间与物品写入通道校验规则测试。
 *
 * 验证 space-items-write-channel-rules.ts 对以下违规的检测：
 * - 直接写世界状态/容器数组/关系索引
 * - 新增独立转移 Op（非 item.move）
 * - 重写容器与槽位结构
 * - Op 名命名规范
 */

import { describe, it, expect } from 'vitest';
import { validateWriteChannel } from '../../../../src/l2/validation/space-items-write-channel-rules.js';
import { DiagnosticCollector } from '../../../../src/l2/validation/context.js';
import { buildValidationContext } from '../../../../src/l2/validation/validator.js';
import { baseDefinition, capabilityIdentity, singleDefinitionPackage } from '../../../../src/l2/testing/builders.js';
import type { CandidateDefinition } from '../../../../src/l2/model/definition.js';
import { DIAGNOSTIC_CODES } from '../../../../src/l2/model/diagnostic-codes.js';

/**
 * 执行单条定义规则并返回收集到的诊断。
 * 规则走 DefinitionRule 形态（collector 回填），用临时上下文 + DiagnosticCollector 同步执行。
 */
function runRule(definition: object) {
  const def = definition as unknown as CandidateDefinition;
  const pkg = singleDefinitionPackage(
    String((definition as { id?: unknown }).id ?? 'test.def'),
    def,
  );
  const context = buildValidationContext({ package: pkg });
  const collector = new DiagnosticCollector();
  validateWriteChannel(def, context, collector);
  return collector.all();
}

describe('Feature: wakeup-space-items, Write Channel Rules', () => {
  it('拒绝直接写乘员或货舱状态', () => {
    const definition = {
      ...baseDefinition({
        id: 'bad.vehicle',
        defKind: 'item',
        semanticFamily: { familyId: 'vehicle', registration: undefined },
        typeIdentity: capabilityIdentity('vehicle-cap'),
      }),
      directOccupantStateWrite: true, // 违规字段
    } as any;

    const diagnostics = runRule(definition);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.OP_BYPASS_FORBIDDEN)).toBe(true);
    expect(diagnostics.some((d) => d.reason?.includes('directOccupantStateWrite'))).toBe(true);
  });

  it('拒绝重写容器结构', () => {
    const definition = {
      ...baseDefinition({
        id: 'bad.container',
        defKind: 'item',
        semanticFamily: { familyId: 'container', registration: undefined },
        typeIdentity: capabilityIdentity('container-cap'),
      }),
      containerStructureOverride: { slots: 5 }, // 违规字段
    } as any;

    const diagnostics = runRule(definition);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.OP_BYPASS_FORBIDDEN)).toBe(true);
    expect(diagnostics.some((d) => d.reason?.includes('containerStructureOverride'))).toBe(true);
  });

  it('拒绝非 item.move 的物品转移 Op', () => {
    const definition = {
      ...baseDefinition({
        id: 'bad.transfer',
        defKind: 'action',
        semanticFamily: { familyId: 'action', registration: undefined },
        typeIdentity: capabilityIdentity('transfer-cap'),
      }),
      itemTransferOpId: 'item.pickup', // 违规：不是 item.move
    } as any;

    const diagnostics = runRule(definition);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.OP_BYPASS_FORBIDDEN)).toBe(true);
    expect(diagnostics.some((d) => d.reason?.includes('item.move'))).toBe(true);
  });

  it('拒绝独立转移 Op 声明', () => {
    const definition = {
      ...baseDefinition({
        id: 'bad.independent',
        defKind: 'action',
        semanticFamily: { familyId: 'action', registration: undefined },
        typeIdentity: capabilityIdentity('independent-cap'),
      }),
      independentTransferOps: ['item.pickup', 'item.drop'], // 违规
    } as any;

    const diagnostics = runRule(definition);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.some((d) => d.code === DIAGNOSTIC_CODES.OP_BYPASS_FORBIDDEN)).toBe(true);
  });

  it('拒绝非法格式的 Op 名', () => {
    const definition = {
      ...baseDefinition({
        id: 'bad.opname',
        defKind: 'action',
        semanticFamily: { familyId: 'action', registration: undefined },
        typeIdentity: capabilityIdentity('opname-cap'),
      }),
      operationChannels: ['.invalid', 'nonamespace', 'trailing.'], // 违规格式
    } as any;

    const diagnostics = runRule(definition);

    expect(diagnostics.length).toBeGreaterThanOrEqual(3); // 3个非法名字
    expect(diagnostics.filter((d) => d.code === DIAGNOSTIC_CODES.OP_BYPASS_FORBIDDEN).length).toBeGreaterThanOrEqual(3);
  });

  it('接受合法的 item.move 转移 Op', () => {
    const definition = {
      ...baseDefinition({
        id: 'good.transfer',
        defKind: 'action',
        semanticFamily: { familyId: 'action', registration: undefined },
        typeIdentity: capabilityIdentity('good-transfer-cap'),
      }),
      itemTransferOpId: 'item.move', // 合法
    } as any;

    const diagnostics = runRule(definition);

    // 不应该有关于 itemTransferOpId 的诊断
    expect(diagnostics.filter((d) => d.reason?.includes('itemTransferOpId')).length).toBe(0);
  });

  it('接受合法格式的 Op 名', () => {
    const definition = {
      ...baseDefinition({
        id: 'good.opnames',
        defKind: 'action',
        semanticFamily: { familyId: 'action', registration: undefined },
        typeIdentity: capabilityIdentity('good-opnames-cap'),
      }),
      operationChannels: ['item.move', 'prop.add', 'relation.set'], // 合法格式
    } as any;

    const diagnostics = runRule(definition);

    // 不应该有关于 operationChannels 格式的诊断
    expect(diagnostics.filter((d) => d.reason?.includes('namespace.operation')).length).toBe(0);
  });
});
