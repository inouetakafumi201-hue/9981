import { describe, expect, it } from 'vitest';
import { StrictJsonCodec } from '../../spec-compiler/json-codec.js';
import { DEFAULT_TECHNICAL_QUOTAS } from '../../spec-compiler/types.js';
import type { ParsedCandidateDocument } from '../../spec-compiler/types.js';
import type { Def } from '../../state/def.js';
import { decodePlaypack } from '../playpack-codec.js';
import { downedZeroAttachment } from '../../../../play/core-mechanics/defs/attachments.js';
import { CoreMechanicsPlaypack } from '../../../../play/core-mechanics/defs/playpack.js';
import {
  GAMEPLAY_VALUE_MAX,
  playExtensionOf,
  validateGameplayValueRange,
  validateNumericOwnership,
  validateProvenance,
} from '../../../../play/core-mechanics/ownership.js';

/**
 * 官方 TS 包的 Def 会被 `DefRegistry` 的 deepClone 之类工具复制，其 `play` 扩展是普通对象。
 * 序列化前转成 JSON-safe 形态：只保留被引擎层使用的可枚举自有字段（`Def` 的索引签名
 * `[key: string]: unknown` 保证 play 作为普通字段放行），不保留原型链。
 */
function toJson(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function parsed(value: unknown): ParsedCandidateDocument {
  return new StrictJsonCodec().parse({
    sourceId: 'playpack:test:play-extension',
    documentUri: 'file:///playpack.play-extension.test.json',
    sourcePackage: 'playpack.test.play-extension',
    sourceText: JSON.stringify(value),
    precedence: 1,
    owningLayer: '玩法层',
    normativeStatus: 'normative',
  }, DEFAULT_TECHNICAL_QUOTAS);
}

/** 携带完整 `play` 扩展的合法 Def（覆盖 PlayDefExtension 的全部可选字段）。 */
function fullPlayDef(): Record<string, unknown> {
  return {
    id: 'action:full-play',
    kind: 'action',
    label: 'Full play extension action',
    cost: [{ pool: 'actor-ap', amount: 1 }],
    effects: [{ emit: 'full.play', data: 5 }],
    play: {
      numericOwnership: {
        'cost.0.amount': { kind: 'gameplay', min: 1, max: GAMEPLAY_VALUE_MAX, int: true },
        'effects.0.data': { kind: 'internal', note: '测试内部计数' },
      },
      costClass: 'paid',
      parentActions: ['action:parent', 'action:other'],
      triggerPoint: 'beforeParentEffects',
      requireRef: 'expr:guard',
      onFailure: 'rejectWholeAction',
      sourceTrace: ['Req 3.1', 'S0 四·4.2', 'D-037'],
      unresolvedGuards: ['T-001', 'U-002'],
      presentation: { labelKey: 'full.play.label', iconKey: 'full.play.icon' },
    },
  };
}

function validPlaypack(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pp:play-extension',
    kind: 'playpack',
    version: '1.0.0',
    defs: [fullPlayDef()],
    ...overrides,
  };
}

function expectFailure(value: unknown, code: string, path?: string): void {
  const result = decodePlaypack(parsed(value));
  expect(result.ok).toBe(false);
  if (!result.ok) {
    const diagnostic = result.diagnostics.find((item) => item.code === code && (path === undefined || item.path === path));
    expect(diagnostic, `${code}${path ? ` at ${path}` : ''}`).toBeDefined();
  }
}

describe('pure JSON playpack play extension gate', () => {
  it('keeps a complete play extension after StrictJsonCodec -> decodePlaypack and passes the play layer linter', () => {
    const document = parsed(validPlaypack());
    const result = decodePlaypack(document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const def = result.value.defs[0] as Def;
    expect(def.id).toBe('action:full-play');
    expect(def.play).toEqual(fullPlayDef()['play']);

    const ext = playExtensionOf(def);
    expect(ext).not.toBeNull();
    expect(ext?.numericOwnership).toEqual({
      'cost.0.amount': { kind: 'gameplay', min: 1, max: GAMEPLAY_VALUE_MAX, int: true },
      'effects.0.data': { kind: 'internal', note: '测试内部计数' },
    });
    expect(ext?.costClass).toBe('paid');
    expect(ext?.parentActions).toEqual(['action:parent', 'action:other']);
    expect(ext?.triggerPoint).toBe('beforeParentEffects');
    expect(ext?.requireRef).toBe('expr:guard');
    expect(ext?.onFailure).toBe('rejectWholeAction');
    expect(ext?.sourceTrace).toEqual(['Req 3.1', 'S0 四·4.2', 'D-037']);
    expect(ext?.unresolvedGuards).toEqual(['T-001', 'U-002']);
    expect(ext?.presentation).toEqual({ labelKey: 'full.play.label', iconKey: 'full.play.icon' });

    // 逐 Def 校验器按同一扩展读取，证明"codec 放行的形状就是玩法层 Linter 需要的形状"。
    expect(validateNumericOwnership(def)).toEqual([]);
    expect(validateGameplayValueRange(def)).toEqual([]);
    expect(validateProvenance(def)).toEqual([]);
  });

  it('allows a play extension on the playpack root itself', () => {
    const result = decodePlaypack(parsed(validPlaypack({
      play: {
        numericOwnership: {
          'pools.1.min': { kind: 'structural', rationale: '资源下限 0' },
          'pools.1.max': { kind: 'constitutional', sourceId: 'S0 四·4.2' },
        },
        sourceTrace: ['Req 4.1', 'D-007'],
      },
    })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.play).toEqual({
      numericOwnership: {
        'pools.1.min': { kind: 'structural', rationale: '资源下限 0' },
        'pools.1.max': { kind: 'constitutional', sourceId: 'S0 四·4.2' },
      },
      sourceTrace: ['Req 4.1', 'D-007'],
    });
  });

  it('rejects a numericOwnership that is not an object', () => {
    const value = validPlaypack();
    value['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: ['Req 1.1'], numericOwnership: 'not-an-object' } }];
    expectFailure(value, 'E_LOAD_FIELD_TYPE', '/defs/0/play/numericOwnership');
  });

  it('rejects a non-object numericOwnership entry', () => {
    const value = validPlaypack();
    value['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: ['Req 1.1'], numericOwnership: { 'cost.0.amount': 5 } } }];
    expectFailure(value, 'E_LOAD_FIELD_TYPE', '/defs/0/play/numericOwnership/cost.0.amount');
  });

  it('rejects a sourceTrace that is not a string array', () => {
    const value = validPlaypack();
    value['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: 'Req 1.1' } }];
    expectFailure(value, 'E_LOAD_FIELD_TYPE', '/defs/0/play/sourceTrace');
  });

  it('rejects an unknown costClass enum value', () => {
    const value = validPlaypack();
    value['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: ['Req 1.1'], costClass: 'free' } }];
    expectFailure(value, 'E_LOAD_CROSS_FIELD_CONSTRAINT', '/defs/0/play/costClass');
  });

  it('rejects an unknown triggerPoint enum value', () => {
    const value = validPlaypack();
    value['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: ['Req 1.1'], triggerPoint: 'duringParentEffects' } }];
    expectFailure(value, 'E_LOAD_CROSS_FIELD_CONSTRAINT', '/defs/0/play/triggerPoint');
  });

  it('rejects an unknown onFailure enum value', () => {
    const value = validPlaypack();
    value['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: ['Req 1.1'], onFailure: 'rollback' } }];
    expectFailure(value, 'E_LOAD_CROSS_FIELD_CONSTRAINT', '/defs/0/play/onFailure');
  });

  it('rejects a play extension that is not an object', () => {
    const value = validPlaypack();
    value['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: 'not-an-object' }];
    expectFailure(value, 'E_LOAD_FIELD_TYPE', '/defs/0/play');
  });

  it('rejects a missing sourceTrace as the required play extension field', () => {
    const value = validPlaypack();
    value['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { numericOwnership: {} } }];
    expectFailure(value, 'E_LOAD_REQUIRED_FIELD', '/defs/0/play/sourceTrace');
  });

  it('rejects non-string members of parentActions / unresolvedGuards / sourceTrace', () => {
    const parentActions = validPlaypack();
    parentActions['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: ['Req 1.1'], parentActions: ['action:parent', 5] } }];
    expectFailure(parentActions, 'E_LOAD_FIELD_TYPE', '/defs/0/play/parentActions/1');

    const unresolvedGuards = validPlaypack();
    unresolvedGuards['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: ['Req 1.1'], unresolvedGuards: ['T-001', false] } }];
    expectFailure(unresolvedGuards, 'E_LOAD_FIELD_TYPE', '/defs/0/play/unresolvedGuards/1');
  });

  it('rejects a bare string for the array-typed parentActions / unresolvedGuards fields', () => {
    // PlayDefExtension 声明这两个字段为数组；玩法层 Linter 按数组读（lintParallelism 逐项计数、
    // validateUnresolvedGuards 调 forEach），裸字符串会以字符为单位迭代或直接崩溃。JSON 包必须
    // 与官方 TS 包一致写数组，否则等于"能解码、不能装载"的假装载等价。
    const parentActions = validPlaypack();
    parentActions['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: ['Req 1.1'], parentActions: 'action:parent' } }];
    expectFailure(parentActions, 'E_LOAD_FIELD_TYPE', '/defs/0/play/parentActions');

    const unresolvedGuards = validPlaypack();
    unresolvedGuards['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: ['Req 1.1'], unresolvedGuards: 'T-001' } }];
    expectFailure(unresolvedGuards, 'E_LOAD_FIELD_TYPE', '/defs/0/play/unresolvedGuards');
  });

  it('rejects a non-string requireRef', () => {
    const value = validPlaypack();
    value['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: ['Req 1.1'], requireRef: 42 } }];
    expectFailure(value, 'E_LOAD_FIELD_TYPE', '/defs/0/play/requireRef');
  });

  it('rejects an unknown play extension field', () => {
    const value = validPlaypack();
    value['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: ['Req 1.1'], customGovernance: 'nope' } }];
    expectFailure(value, 'E_LOAD_UNKNOWN_FIELD', '/defs/0/play/customGovernance');
  });

  it('rejects a malformed presentation (non-object / non-string keys)', () => {
    const nonObject = validPlaypack();
    nonObject['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: ['Req 1.1'], presentation: 'full.play' } }];
    expectFailure(nonObject, 'E_LOAD_FIELD_TYPE', '/defs/0/play/presentation');

    const badKey = validPlaypack();
    badKey['defs'] = [{ id: 'action:bad', kind: 'action', label: 'Bad', effects: [], play: { sourceTrace: ['Req 1.1'], presentation: { labelKey: 5 } } }];
    expectFailure(badKey, 'E_LOAD_FIELD_TYPE', '/defs/0/play/presentation/labelKey');
  });

  it('keeps the executable-check gate: linter stays rejected in a pure JSON playpack', () => {
    const value = validPlaypack();
    value['defs'] = [{ id: 'action:ok', kind: 'action', label: 'Ok', effects: [], play: { sourceTrace: ['Req 1.1'], numericOwnership: {} } }];
    value['linter'] = 'not executable';
    expectFailure(value, 'E_LOAD_PROHIBITED_CONSTRUCT', '/linter');
  });

  it('keeps the recursion safety: JSON-unsafe values inside play are rejected', () => {
    const document = parsed(validPlaypack());
    const unsafeDocument = {
      ...document,
      value: {
        ...validPlaypack(),
        defs: [{ id: 'action:unsafe', kind: 'action', label: 'Unsafe', effects: [], play: { sourceTrace: ['Req 1.1'], numericOwnership: { 'x.y': { kind: 'internal', note: 'n' } } } }],
      },
    } as unknown as ParsedCandidateDocument;
    // 安全防线的对象：把 numericOwnership 的一个值替换成循环对象（绕过 JSON 解析器）。
    const cyclic: Record<string, unknown> = { kind: 'internal', note: 'cycle' };
    cyclic['self'] = cyclic;
    (unsafeDocument.value as { defs: unknown[] })['defs'] = [{
      id: 'action:unsafe', kind: 'action', label: 'Unsafe', effects: [],
      play: { sourceTrace: ['Req 1.1'], numericOwnership: { 'x.y': cyclic } },
    }];
    const result = decodePlaypack(unsafeDocument);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.some((item) => item.code === 'E_INV_UNSUPPORTED_TYPE')).toBe(true);
  });

  it('round-trips an official TS def: downedZeroAttachment serialized as JSON feeds through the codec with its play metadata intact', () => {
    const def = toJson(downedZeroAttachment);
    const result = decodePlaypack(parsed(validPlaypack({ defs: [def] })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const decoded = result.value.defs[0] as Def;
    expect(decoded.id).toBe('attachment:play.downed-zero');
    expect(decoded.kind).toBe('attachment');
    expect(decoded.play).toEqual(def['play']);
    expect(decoded.play).toEqual(toJson(downedZeroAttachment)['play']);

    // 玩法层 Linter 的逐 Def 校验器按同一形状读取，证明装载等价成立。
    expect(validateNumericOwnership(decoded)).toEqual([]);
    expect(validateGameplayValueRange(decoded)).toEqual([]);
    expect(validateProvenance(decoded)).toEqual([]);
  });

  it('round-trips a full official TS def set: CoreMechanicsPlaypack.defs serialized as JSON feeds through the codec', () => {
    const result = decodePlaypack(parsed(validPlaypack({ defs: CoreMechanicsPlaypack.defs.map(toJson) })));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defs).toHaveLength(CoreMechanicsPlaypack.defs.length);
    // 至少覆盖一个携带完整可选字段的附着动作 Def，证明所有 play 字段形态都被放行。
    const attached = CoreMechanicsPlaypack.defs.find((candidate) => playExtensionOf(candidate)?.costClass === 'attached');
    expect(attached).toBeDefined();
    const decoded = result.value.defs.find((candidate) => candidate.id === attached?.id) as Def;
    expect(decoded.play).toEqual(toJson(attached)['play']);
  });
});
