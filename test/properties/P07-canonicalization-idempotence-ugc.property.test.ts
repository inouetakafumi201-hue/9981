// Feature: l2-base-layer-spec, Property 7: 规范化幂等与统一 UGC 验证
//
// 性质原文（design.md「Correctness Properties / Property 7」）：
//   For any Equivalent_Definition, 首次规范化后的再次及后续规范化必须生成完全相同的 canonical
//   JSON；同一候选声明经 UGC 与手写入口进入时，必须经过同一验证路径并得到等价的验证结果。表现字段
//   损坏只能生成类型兼容回退及 Warning_Diagnostic，绝不改变语义字段。
//
// Validates: Requirements 11.7
// Additional coverage: Requirements 11.8–11.9, 11.11–11.12, 13.5, 13.11, 14.9, 15.11
//
// 状态：✅ 运行中。
//
// 编写历史说明（须知）：本文件最初编写时 `src/l2/ugc/ugc-adapter.ts` 与
// `src/l2/validation/validator.ts` 均不存在，整体标记为 SKIPPED。复核时发现两个模块均已落地
// （`fromUgc` 无条件复用 `parsePackage`；`validatePackage` 是全部定义级规则的统一编排入口），
// 因此把 `loadUgcAdapter()` 从"抛出阻塞原因"改为真实适配器。断言体本身未作任何改动或放宽。
//
// 被测实现：src/l2/ugc/ugc-adapter.ts、src/l2/validation/validator.ts、src/l2/codec/json-codec.ts

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parsePackage, SUPPORTED_SCHEMA_VERSIONS } from '../../src/l2/codec/json-codec.js';
import { canonicalize, canonicalizeValue } from '../../src/l2/codec/json-canonicalizer.js';
import { DIAGNOSTIC_CODES } from '../../src/l2/model/diagnostic-codes.js';
import { isWarningDiagnostic } from '../../src/l2/model/diagnostic.js';
import type { Diagnostic } from '../../src/l2/model/diagnostic.js';
import { isOk, isRejection, ok } from '../../src/l2/model/result.js';
import type { Result } from '../../src/l2/model/result.js';
import { diagnosticSetsEquivalent, structuredRejection } from '../../src/l2/model/diagnostic-factory.js';
import { fingerprint } from '../../src/l2/model/ordering.js';
import type { JsonObject, JsonValue } from '../../src/l2/model/json.js';
import type { DefinitionPackage } from '../../src/l2/model/definition.js';
import { fromUgc } from '../../src/l2/ugc/ugc-adapter.js';
import { validatePackage, buildValidationContext } from '../../src/l2/validation/validator.js';

export interface UgcAdapterPort {
  /** 把编辑器 / 自然语言状态转换为候选声明式 JSON 文本。 */
  fromUgc(editorState: JsonObject): Result<string>;
  /** 手写与 UGC 两条路径共用的验证入口，返回诊断列表。 */
  validatePackageDiagnostics(pkg: DefinitionPackage): readonly Diagnostic[];
}

/**
 * 真实适配器：直接调用 `ugc/ugc-adapter.ts` 的 `fromUgc` 与 `validation/validator.ts` 的
 * `validatePackage`。
 *
 * `UgcAdapterPort.fromUgc` 接收"编辑器状态"（`JsonObject`）而不是文本——这模拟真实场景中
 * 上游图形化编辑器/自然语言转换器把内部状态序列化为 JSON 文本这一步（那一步不属于
 * `ugc-adapter.ts` 的职责，它只接收已序列化的 `candidateJson`）。这里用 `JSON.stringify`
 * 完成该序列化，然后把结果原样交给真实的 `fromUgc`；若通过守卫扫描，返回的正是这段未加工的
 * 候选文本本身（`fromUgc` 不改写文本，只解析并验证它），从而让后续断言真正比较
 * "同一文本经两条入口解析/规范化"的结果，而不是比较测试自造的派生文本。
 */
class RealUgcAdapterPort implements UgcAdapterPort {
  fromUgc(editorState: JsonObject): Result<string> {
    const candidateJson = JSON.stringify(editorState);
    const result = fromUgc({
      candidateJson,
      sourceLocation: PARSE_OPTIONS.sourceLocation,
      packageId: PARSE_OPTIONS.packageId,
    });
    if (isRejection(result)) {
      return structuredRejection(result.diagnostics);
    }
    return ok(candidateJson, result.warnings);
  }

  validatePackageDiagnostics(pkg: DefinitionPackage): readonly Diagnostic[] {
    const context = buildValidationContext({ package: pkg });
    return validatePackage(context).diagnostics;
  }
}

const SCHEMA_VERSION = [...SUPPORTED_SCHEMA_VERSIONS][0]!;
const SOURCE_FILE = 'docs/generated/p07-normalization.md';
const PARSE_OPTIONS = {
  sourceLocation: { sourceFile: SOURCE_FILE, section: 'generated-package' },
  packageId: 'pkg-p07-generated',
} as const;

interface NormalizationCase {
  readonly definitionCount: number;
  readonly capabilityOrdinal: number;
  /** 表现字段损坏方式。 */
  readonly presentationDamage: 'none' | 'wrong-type-scalar' | 'wrong-type-container' | 'not-an-object';
  readonly rotate: number;
  readonly indentWidth: number;
}

function definitionJson(ordinal: number, testCase: NormalizationCase): JsonObject {
  const definition: Record<string, JsonValue> = {
    id: `gen-definition-${ordinal}`,
    defKind: 'item',
    abstract: true,
    semanticFamily: { familyId: 'item' },
    typeIdentity: {
      requiredCapabilities: [`generated-capability-${testCase.capabilityOrdinal}`],
      legalRelationships: [],
      invariants: [],
      substitutionCompatibility: [],
    },
    composition: [],
    parameterSchema: {
      fields: [
        {
          name: `generated-field-${ordinal}`,
          dataType: 'integer',
          required: true,
          classification: 'Internal_Metric',
          internalMetricSchema: { metric: `generated-metric-${ordinal}`, integral: true },
        },
      ],
      crossFieldConstraints: [],
    },
    tags: [`generated-tag-${ordinal}`],
    actionRefs: [],
    ruleRefs: [],
    sourceRecords: [
      {
        sourceFile: SOURCE_FILE,
        sourceLocation: { sourceFile: SOURCE_FILE, section: `generated-record-${ordinal}` },
        precedence: 'finalized-l2-contract',
        classification: 'Normative_Contract',
        owningLayer: '基类层',
        statementFingerprint: `generated-fingerprint-${ordinal}`,
      },
    ],
  };
  definition['presentation'] = presentationJson(ordinal, testCase.presentationDamage);
  return definition as JsonObject;
}

function presentationJson(ordinal: number, damage: NormalizationCase['presentationDamage']): JsonValue {
  switch (damage) {
    case 'wrong-type-scalar':
      // displayName 应为 string，此处给数字：只能触发类型兼容回退 + Warning。
      return { displayName: ordinal, description: 'generated presentation description' };
    case 'wrong-type-container':
      // assetRefs 应为数组，此处给对象。
      return { displayName: `生成的展示名 ${ordinal}`, assetRefs: { broken: true } };
    case 'not-an-object':
      return 'presentation-should-be-an-object';
    case 'none':
    default:
      return { displayName: `生成的展示名 ${ordinal}`, description: 'generated presentation description' };
  }
}

function packageJson(testCase: NormalizationCase): JsonObject {
  return {
    packageId: PARSE_OPTIONS.packageId,
    schemaVersion: SCHEMA_VERSION,
    dependencies: [],
    sourceRecords: [],
    definitions: Array.from({ length: testCase.definitionCount }, (_, ordinal) =>
      definitionJson(ordinal, testCase),
    ),
  };
}

/** 以确定性旋转打乱对象键序并施加不同缩进（数组顺序保持不变：它参与 JSON 路径）。 */
function emitWithRotatedKeys(value: JsonValue, rotate: number, indentWidth: number, depth = 0): string {
  const pad = (level: number): string => (indentWidth === 0 ? '' : ' '.repeat(indentWidth * level));
  const lineBreak = indentWidth === 0 ? '' : '\n';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = value
      .map((element) => `${pad(depth + 1)}${emitWithRotatedKeys(element, rotate, indentWidth, depth + 1)}`)
      .join(`,${lineBreak}`);
    return `[${lineBreak}${inner}${lineBreak}${pad(depth)}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, JsonValue>;
    const keys = Object.keys(record);
    if (keys.length === 0) return '{}';
    const shift = (rotate + depth) % keys.length;
    const ordered = [...keys.slice(shift), ...keys.slice(0, shift)];
    const inner = ordered
      .map(
        (key) =>
          `${pad(depth + 1)}${JSON.stringify(key)}:${indentWidth === 0 ? '' : ' '}${emitWithRotatedKeys(record[key]!, rotate, indentWidth, depth + 1)}`,
      )
      .join(`,${lineBreak}`);
    return `{${lineBreak}${inner}${lineBreak}${pad(depth)}}`;
  }
  return JSON.stringify(value);
}

/** 语义投影：不含任何表现字段，用于断言"表现回退绝不改变语义字段"。 */
function semanticOnly(pkg: DefinitionPackage): unknown {
  return pkg.definitions.map((definition) => ({
    id: definition.id,
    defKind: definition.defKind,
    abstract: definition.abstract,
    familyId: definition.semanticFamily.familyId,
    capabilities: [...definition.typeIdentity.requiredCapabilities],
    fields: definition.parameterSchema.fields.map((field) => [field.name, field.dataType, field.classification]),
    tags: [...definition.tags],
  }));
}

const arbNormalizationCase: fc.Arbitrary<NormalizationCase> = fc.record({
  definitionCount: fc.integer({ min: 1, max: 3 }),
  capabilityOrdinal: fc.integer({ min: 0, max: 4 }),
  presentationDamage: fc.constantFrom<NormalizationCase['presentationDamage']>(
    'none',
    'wrong-type-scalar',
    'wrong-type-container',
    'not-an-object',
  ),
  rotate: fc.integer({ min: 0, max: 7 }),
  indentWidth: fc.constantFrom(0, 2, 4),
});

/** 完整断言体，驱动真实 `ugc-adapter.ts` + `validator.ts` 实现。 */
export function runCanonicalizationAndUgcProperty(makeAdapter: () => UgcAdapterPort): void {
  fc.assert(
    fc.property(arbNormalizationCase, (testCase) => {
      const adapter = makeAdapter();
      const root = packageJson(testCase);
      const authored = emitWithRotatedKeys(root, testCase.rotate, testCase.indentWidth);

      // ── 子句 1：规范化幂等（首次规范化后字节完全稳定） ────────────────────────
      const first = canonicalize(authored);
      expect(isOk(first)).toBe(true);
      if (!isOk(first)) return;
      const second = canonicalize(first.value);
      expect(isOk(second)).toBe(true);
      if (!isOk(second)) return;
      expect(second.value).toBe(first.value);
      const third = canonicalize(second.value);
      expect(isOk(third)).toBe(true);
      if (isOk(third)) {
        expect(third.value).toBe(first.value);
      }
      // 与"直接对等价值规范化"的结果也必须字节一致。
      expect(first.value).toBe(canonicalizeValue(root));

      // ── 子句 3：表现字段损坏只产生类型兼容回退 + Warning，语义字段不变 ─────────
      const parsedAuthored = parsePackage(authored, PARSE_OPTIONS);
      expect(isOk(parsedAuthored)).toBe(true);
      if (!isOk(parsedAuthored)) return;

      const presentationWarnings = parsedAuthored.warnings.filter(
        (diagnostic) => diagnostic.code === DIAGNOSTIC_CODES.PRESENTATION_FALLBACK_APPLIED,
      );
      if (testCase.presentationDamage === 'none') {
        expect(presentationWarnings).toHaveLength(0);
      } else {
        expect(presentationWarnings.length).toBeGreaterThan(0);
        expect(presentationWarnings.every(isWarningDiagnostic)).toBe(true);
      }

      // 用未损坏表现字段的同一包做基线：语义投影必须完全一致。
      const pristine = packageJson({ ...testCase, presentationDamage: 'none' });
      const parsedPristine = parsePackage(
        emitWithRotatedKeys(pristine, testCase.rotate, testCase.indentWidth),
        PARSE_OPTIONS,
      );
      expect(isOk(parsedPristine)).toBe(true);
      if (isOk(parsedPristine)) {
        expect(semanticOnly(parsedAuthored.value)).toEqual(semanticOnly(parsedPristine.value));
      }

      // ── 子句 2：UGC 入口与手写入口经过同一验证路径且验证结果等价 ──────────────
      const ugcOutput = adapter.fromUgc(root);
      expect(isOk(ugcOutput)).toBe(true);
      if (!isOk(ugcOutput)) return;

      // UGC 只能输出候选声明式 JSON：其输出必须能被同一 codec 解析，且规范化结果与手写一致。
      const parsedUgc = parsePackage(ugcOutput.value, PARSE_OPTIONS);
      expect(isOk(parsedUgc)).toBe(true);
      if (!isOk(parsedUgc)) return;
      expect(fingerprint(parsedUgc.value)).toBe(fingerprint(parsedAuthored.value));
      const canonicalUgc = canonicalize(ugcOutput.value);
      expect(isOk(canonicalUgc)).toBe(true);
      if (isOk(canonicalUgc)) {
        expect(canonicalUgc.value).toBe(first.value);
      }

      // 两条入口必须得到等价验证结果（同一 Definition_Validator，无 UGC 专用规则引擎）。
      const authoredDiagnostics = adapter.validatePackageDiagnostics(parsedAuthored.value);
      const ugcDiagnostics = adapter.validatePackageDiagnostics(parsedUgc.value);
      expect(diagnosticSetsEquivalent(authoredDiagnostics, ugcDiagnostics)).toBe(true);

      // 语义字段损坏时两条入口都必须拒绝，且都不猜测语义内容。
      const damagedRoot = JSON.parse(JSON.stringify(root)) as Record<string, unknown>;
      const damagedDefinitions = damagedRoot['definitions'] as Record<string, unknown>[];
      delete damagedDefinitions[0]!['semanticFamily'];
      const damagedAuthored = parsePackage(JSON.stringify(damagedRoot), PARSE_OPTIONS);
      expect(isRejection(damagedAuthored)).toBe(true);
      const damagedUgc = adapter.fromUgc(damagedRoot as JsonObject);
      if (isOk(damagedUgc)) {
        expect(isRejection(parsePackage(damagedUgc.value, PARSE_OPTIONS))).toBe(true);
      } else {
        expect(damagedUgc.diagnostics.some((d) => d.severity === 'Error')).toBe(true);
      }
    }),
    { numRuns: 100 },
  );
}

function loadUgcAdapter(): UgcAdapterPort {
  return new RealUgcAdapterPort();
}

describe('Property 7: 规范化幂等与统一 UGC 验证', () => {
  it('规范化幂等、UGC 统一验证、表现回退不改语义（fast-check，100 次生成）', () => {
    runCanonicalizationAndUgcProperty(loadUgcAdapter);
  });
});
