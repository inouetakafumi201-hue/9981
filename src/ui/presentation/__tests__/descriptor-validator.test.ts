import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { stripComments } from '../../__tests__/support/source-scan.js';
import type { UiBinding } from '../../model/view.js';
import {
  isSupportedDescriptorVersion,
  validateActionDescriptor,
  validatePresentationDescriptor,
  validateResourceDescriptor,
  validateTargetDescriptor,
} from '../descriptor-validator.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BINDINGS: readonly UiBinding[] = Object.freeze([{ key: 'to', value: 'n1' }]);

function rawAction(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
  return {
    actionId: 'act.move',
    costCategory: 'paid',
    interactionIntent: 'traversal',
    available: true,
    accessibleLabel: '移动',
    assetRefs: ['asset.move'],
    targets: [],
    ...overrides,
  };
}

function validate(overrides: Readonly<Record<string, unknown>> = {}, bindings = BINDINGS) {
  return validateActionDescriptor(rawAction(overrides), {
    presentationLocation: 'presentation/test',
    bindings,
  });
}

describe('动作描述符语义字段校验（tasks.md 任务 4.1）', () => {
  it('完整描述符被接受，语义字段原样透传', () => {
    const result = validate();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.actionId).toBe('act.move');
    expect(result.value.costCategory).toBe('paid');
    expect(result.value.interactionIntent).toBe('traversal');
    expect(result.value.bindings).toEqual([{ key: 'to', value: 'n1' }]);
  });

  it('逐个删除必填语义字段都导致拒绝', () => {
    for (const field of ['actionId', 'costCategory', 'available', 'assetRefs', 'targets']) {
      const result = validate({ [field]: undefined });
      expect(result.ok, field).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 'error'), field).toBe(true);
    }
  });

  it('缺失与损坏用不同的码：缺失是 MISSING，越界是 DAMAGED', () => {
    expect(validate({ costCategory: undefined }).diagnostics[0]?.code).toBe(
      'DESCRIPTOR_SEMANTIC_FIELD_MISSING',
    );
    expect(validate({ costCategory: 'free' }).diagnostics[0]?.code).toBe('JSON_SEMANTIC_FIELD_DAMAGED');
    expect(validate({ interactionIntent: 'teleport' }).diagnostics[0]?.code).toBe(
      'JSON_SEMANTIC_FIELD_DAMAGED',
    );
  });

  it('interactionIntent 缺省是合法的：上游契约里它本就是可选字段', () => {
    const result = validate({ interactionIntent: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.interactionIntent).toBeUndefined();
  });

  it('posture 按开放字符串透传，不做枚举校验（J-15）', () => {
    for (const posture of ['crouch', 'prone', '未来新增姿态']) {
      const result = validate({ posture });
      expect(result.ok, posture).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.value.posture).toBe(posture);
    }
    expect(validate({ posture: 42 }).ok).toBe(false);
  });

  it('目标绑定未解析（bindings 为 undefined）判为 UI_DESCRIPTOR_TARGET_UNRESOLVED', () => {
    // 直接调用而不走 validate()：后者有默认参数，传 undefined 会被默认值顶掉。
    const result = validateActionDescriptor(rawAction(), {
      presentationLocation: 'presentation/test',
      bindings: undefined,
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'UI_DESCRIPTOR_TARGET_UNRESOLVED',
    );
  });

  it('空绑定数组表示"确实不需要绑定"，是合法输入', () => {
    expect(validate({}, []).ok).toBe(true);
  });

  it('绑定取值不是投影中出现过的标识或值时被拒绝', () => {
    const result = validateActionDescriptor(rawAction(), {
      presentationLocation: 'presentation/test',
      bindings: [{ key: 'to', value: Number.NaN as unknown as number }],
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      'UI_DESCRIPTOR_TARGET_UNRESOLVED',
    );
  });

  it('拒绝即撤除全部派生交互：被拒绝的动作不产出任何部分视图', () => {
    const result = validate({ actionId: undefined });
    expect(result.ok).toBe(false);
    expect('value' in result).toBe(false);
  });
});

describe('资源与目标描述符', () => {
  it('未知资源语义角色产出 UI_UNKNOWN_RESOURCE_ROLE', () => {
    const result = validateResourceDescriptor(
      { entityId: 'e1', role: 'mana', value: 3, accessibleLabel: '法力' },
      'presentation/test',
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain('UI_UNKNOWN_RESOURCE_ROLE');
  });

  it('资源数值越界产出 GAMEPLAY_VALUE_OUT_OF_RANGE，且不夹取取值', () => {
    for (const value of [0, 6, 2.5, Number.NaN]) {
      const result = validateResourceDescriptor(
        { entityId: 'e1', role: 'hp', value, accessibleLabel: '生命' },
        'presentation/test',
      );
      expect(result.ok, String(value)).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'GAMEPLAY_VALUE_OUT_OF_RANGE',
      );
    }
  });

  it('合法资源描述符产出 1—5 的玩法数值', () => {
    const result = validateResourceDescriptor(
      { entityId: 'e1', role: 'hp', value: 5, accessibleLabel: '生命' },
      'presentation/test',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.amount.value).toBe(5);
    expect(result.value.amount.ownership.role).toBe('hp');
  });

  it('目标描述符任一字段不合法即整条不可解析', () => {
    for (const overrides of [
      { targetId: '' },
      { intent: 'unknown-intent' },
      { executable: 'yes' },
    ]) {
      const result = validateTargetDescriptor(
        { targetId: 't1', intent: 'traversal', executable: true, accessibleLabel: '目标', ...overrides },
        'presentation/test',
      );
      expect(result.ok, JSON.stringify(overrides)).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        'UI_DESCRIPTOR_TARGET_UNRESOLVED',
      );
    }
  });
});

describe('整份描述符校验与版本处置', () => {
  function rawDescriptor(overrides: Readonly<Record<string, unknown>> = {}): Readonly<Record<string, unknown>> {
    return {
      scopeId: 'scope.a',
      resources: [{ entityId: 'e1', role: 'hp', value: 3, accessibleLabel: '生命' }],
      paidActions: [rawAction()],
      attachedActions: [rawAction({ actionId: 'act.drop', costCategory: 'attached', accessibleLabel: '丢弃' })],
      provenanceLabels: [],
      warnings: [],
      ...overrides,
    };
  }

  it('付费与零费动作都被收集，标识不重复', () => {
    const validation = validatePresentationDescriptor({
      descriptor: rawDescriptor(),
      bindingsByActionId: { 'act.move': BINDINGS, 'act.drop': [] },
    });
    expect(validation.actions.map((action) => action.actionId).sort()).toEqual(['act.drop', 'act.move']);
    expect(validation.rejectedActionIds).toEqual([]);
    expect(validation.resources).toHaveLength(1);
  });

  it('单个动作被拒绝时其标识进入 rejectedActionIds，其余动作照常渲染', () => {
    const validation = validatePresentationDescriptor({
      descriptor: rawDescriptor({
        paidActions: [rawAction(), rawAction({ actionId: 'act.broken', costCategory: 'free' })],
      }),
      bindingsByActionId: { 'act.move': BINDINGS, 'act.broken': BINDINGS, 'act.drop': [] },
    });
    expect(validation.rejectedActionIds).toEqual(['act.broken']);
    expect(validation.actions.map((action) => action.actionId)).not.toContain('act.broken');
    expect(validation.actions.map((action) => action.actionId)).toContain('act.move');
  });

  it('版本不受支持时拒绝该份描述符，其余描述符仍渲染', () => {
    const unsupported = validatePresentationDescriptor({
      descriptor: rawDescriptor(),
      descriptorVersion: '99',
      bindingsByActionId: { 'act.move': BINDINGS, 'act.drop': [] },
    });
    expect(unsupported.actions).toEqual([]);
    expect(unsupported.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      'JSON_SCHEMA_VERSION_UNSUPPORTED',
    ]);

    const compatible = validatePresentationDescriptor({
      descriptor: rawDescriptor({ scopeId: 'scope.b' }),
      bindingsByActionId: { 'act.move': BINDINGS, 'act.drop': [] },
    });
    expect(compatible.actions).toHaveLength(2);
  });

  it('缺省版本视为当前受支持版本', () => {
    expect(isSupportedDescriptorVersion(undefined)).toBe(true);
    expect(isSupportedDescriptorVersion('1')).toBe(true);
    expect(isSupportedDescriptorVersion('2')).toBe(false);
  });
});

describe('不存在启发式推导', () => {
  it('校验器源码中不出现颜色、素材名或标签启发式', () => {
    const source = stripComments(readFileSync(resolve(HERE, '../descriptor-validator.ts'), 'utf8'));
    for (const pattern of [/\bcolor\b/iu, /\bfileName\b/iu, /\bendsWith\b/u, /\bincludes\('/u, /\btag\b/iu]) {
      expect(pattern.test(source), pattern.source).toBe(false);
    }
  });
});
