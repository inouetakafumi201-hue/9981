// Feature: l2-base-layer-spec, Property 6: JSON 语义往返
//
// 性质原文（design.md「Correctness Properties / Property 6」）：
//   For any valid versioned Declarative_JSON definition, `parse → canonicalize → parse` 必须产生
//   Equivalent_Definition，并保持全部 Semantic_Field；编码器输出必须是语法有效的纯声明式 JSON，
//   而可执行构造、缺失语义字段和损坏语义字段必须被拒绝而不被补造。
//
// Validates: Requirements 11.1
// Additional coverage: Requirements 11.2–11.6, 11.10, 15.3, 15.10
//
// 被测实现：src/l2/codec/{json-codec,json-canonicalizer,json-scanner,prohibited-constructs,
//           definition-decoder,schema-decoder}.ts
// 状态：运行中（JSON_Codec 已完整实现）。

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { parsePackage, SUPPORTED_SCHEMA_VERSIONS } from '../../src/l2/codec/json-codec.js';
import {
  canonicalize,
  canonicalizeValue,
  parseCanonical,
} from '../../src/l2/codec/json-canonicalizer.js';
import { scanJson } from '../../src/l2/codec/json-scanner.js';
import { detectProhibitedConstructs } from '../../src/l2/codec/prohibited-constructs.js';
import { DIAGNOSTIC_CODES } from '../../src/l2/model/diagnostic-codes.js';
import { isValidStructuredRejection } from '../../src/l2/model/diagnostic.js';
import { isOk, isRejection } from '../../src/l2/model/result.js';
import { fingerprint } from '../../src/l2/model/ordering.js';
import { L1_DEF_KINDS } from '../../src/l2/model/def-kind.js';
import type { L1DefKind } from '../../src/l2/model/def-kind.js';
import { DECLARED_TYPES, PARAMETER_CLASSIFICATIONS } from '../../src/l2/model/schema.js';
import type { DeclaredType, ParameterClassification } from '../../src/l2/model/schema.js';
import { COMPOSITION_ROLES, REFERENCE_ROLES } from '../../src/l2/model/reference.js';
import { KNOWN_SEMANTIC_FAMILY_IDS } from '../../src/l2/model/family-contracts.js';
import {
  OWNING_LAYERS,
  SOURCE_CLASSIFICATION_KINDS,
  SOURCE_PRECEDENCE_ORDER,
} from '../../src/l2/model/source.js';
import type { OwningLayer, SourceClassificationKind, SourcePrecedence } from '../../src/l2/model/source.js';
import type { JsonObject, JsonValue } from '../../src/l2/model/json.js';
import type { DefinitionPackage } from '../../src/l2/model/definition.js';

const SCHEMA_VERSION = [...SUPPORTED_SCHEMA_VERSIONS][0]!;
const SOURCE_FILE = 'docs/generated/p06-roundtrip.md';
const PARSE_OPTIONS = {
  sourceLocation: { sourceFile: SOURCE_FILE, section: 'generated-package' },
  packageId: 'pkg-p06-generated',
} as const;

interface FieldSpec {
  readonly nameOrdinal: number;
  readonly dataType: DeclaredType;
  readonly classification: ParameterClassification;
  readonly required: boolean;
}

interface DefinitionSpec {
  readonly idOrdinal: number;
  readonly defKind: L1DefKind;
  readonly abstract: boolean;
  readonly familyIndex: number;
  readonly capabilityOrdinal: number;
  readonly fields: readonly FieldSpec[];
  readonly componentRoleIndex: number;
  readonly refRoleIndex: number;
  readonly precedence: SourcePrecedence;
  readonly classification: SourceClassificationKind;
  readonly owningLayer: OwningLayer;
  readonly withPresentation: boolean;
}

function fieldJson(spec: FieldSpec): JsonObject {
  return {
    name: `generated-field-${spec.nameOrdinal}`,
    dataType: spec.dataType,
    required: spec.required,
    classification: spec.classification,
    description: 'generated field description',
  };
}

function definitionJson(spec: DefinitionSpec): JsonObject {
  const familyId = KNOWN_SEMANTIC_FAMILY_IDS[spec.familyIndex % KNOWN_SEMANTIC_FAMILY_IDS.length]!;
  const componentRole = COMPOSITION_ROLES[spec.componentRoleIndex % COMPOSITION_ROLES.length]!;
  const refRole = REFERENCE_ROLES[spec.refRoleIndex % REFERENCE_ROLES.length]!;
  const definition: Record<string, JsonValue> = {
    id: `gen-definition-${spec.idOrdinal}`,
    defKind: spec.defKind,
    abstract: spec.abstract,
    semanticFamily: { familyId },
    typeIdentity: {
      requiredCapabilities: [`generated-capability-${spec.capabilityOrdinal}`],
      legalRelationships: [],
      invariants: [],
      substitutionCompatibility: [],
    },
    composition: [
      {
        componentId: `generated-component-${spec.idOrdinal}`,
        role: componentRole,
        optional: true,
        typeDefining: false,
        dependsOn: [],
        reason: 'generated composition reason',
      },
    ],
    parameterSchema: {
      fields: spec.fields.map((field) => fieldJson(field)),
      crossFieldConstraints: [],
    },
    tags: [`generated-tag-${spec.idOrdinal}`],
    actionRefs: [
      {
        refId: `gen-action-${spec.idOrdinal}`,
        role: 'action',
        expected: { allowAbstract: false, defKind: 'action' },
        required: true,
      },
    ],
    ruleRefs: [],
    otherRefs: [
      {
        refId: `gen-other-${spec.idOrdinal}`,
        role: refRole,
        expected: { allowAbstract: true },
        required: false,
      },
    ],
    sourceRecords: [
      {
        sourceFile: SOURCE_FILE,
        sourceLocation: { sourceFile: SOURCE_FILE, section: `generated-record-${spec.idOrdinal}` },
        precedence: spec.precedence,
        classification: spec.classification,
        owningLayer: spec.owningLayer,
        statementFingerprint: `generated-fingerprint-${spec.idOrdinal}`,
      },
    ],
  };
  if (spec.withPresentation) {
    definition['presentation'] = {
      displayName: `生成的展示名 ${spec.idOrdinal}`,
      description: 'presentation only text; never affects rule outcome',
      assetRefs: [`asset/generated-${spec.idOrdinal}.png`],
    };
  }
  return definition as JsonObject;
}

function packageJson(specs: readonly DefinitionSpec[]): JsonObject {
  return {
    packageId: PARSE_OPTIONS.packageId,
    schemaVersion: SCHEMA_VERSION,
    dependencies: [{ packageId: 'pkg-p06-dependency', versionConstraint: '1.x' }],
    sourceRecords: [
      {
        sourceFile: SOURCE_FILE,
        sourceLocation: { sourceFile: SOURCE_FILE, section: 'generated-package-record' },
        precedence: 'finalized-l2-contract',
        classification: 'Normative_Contract',
        owningLayer: '基类层',
        statementFingerprint: 'generated-package-fingerprint',
      },
    ],
    definitions: specs.map((spec) => definitionJson(spec)),
  };
}

/**
 * 以确定性旋转打乱对象键序并施加不同缩进，构造"语义等价但表示不同"的输入文本。
 * 数组元素顺序**不**打乱：集合元素顺序参与 JSON 路径，属于语义可观察量。
 */
function emitWithRotatedKeys(value: JsonValue, rotate: number, indentWidth: number, depth = 0): string {
  const pad = (level: number): string => (indentWidth === 0 ? '' : ' '.repeat(indentWidth * level));
  const lineBreak = indentWidth === 0 ? '' : '\n';
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const inner = value
      .map((element) => `${pad(depth + 1)}${emitWithRotatedKeys(element, rotate, indentWidth, depth + 1)}`)
      .join(`,${lineBreak}`);
    return `[${lineBreak}${inner}${lineBreak}${pad(depth)}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, JsonValue>;
    const keys = Object.keys(record);
    if (keys.length === 0) {
      return '{}';
    }
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

function cloneRoot(root: JsonObject): Record<string, unknown> {
  return JSON.parse(JSON.stringify(root)) as Record<string, unknown>;
}

function firstDefinitionOf(root: Record<string, unknown>): Record<string, unknown> {
  return (root['definitions'] as Record<string, unknown>[])[0]!;
}

/** 从解析结果投影出全部 Semantic_Field（不含表现字段）。 */
function semanticProjection(pkg: DefinitionPackage): unknown {
  return {
    packageId: pkg.packageId,
    schemaVersion: pkg.schemaVersion,
    dependencies: pkg.dependencies.map((dependency) => dependency.packageId),
    definitions: pkg.definitions.map((definition) => ({
      id: definition.id,
      defKind: definition.defKind,
      abstract: definition.abstract,
      familyId: definition.semanticFamily.familyId,
      capabilities: [...definition.typeIdentity.requiredCapabilities],
      components: definition.composition.map((component) => [
        component.componentId,
        component.role,
        component.optional,
        component.typeDefining,
      ]),
      fields: definition.parameterSchema.fields.map((field) => [
        field.name,
        field.dataType,
        field.required,
        field.classification,
      ]),
      tags: [...definition.tags],
      actionRefs: definition.actionRefs.map((ref) => [ref.refId, ref.role, ref.required]),
      otherRefs: (definition.otherRefs ?? []).map((ref) => [ref.refId, ref.role, ref.required]),
      sourceRecords: definition.sourceRecords.map((record) => [
        record.sourceFile,
        record.precedence,
        record.classification,
        record.owningLayer,
        record.statementFingerprint,
      ]),
    })),
  };
}

/** 直接从输入 JSON 读出期望的 Semantic_Field 投影，用于验证"解码不丢字段、不改字段"。 */
function expectedProjection(root: JsonObject): unknown {
  const raw = root as unknown as Record<string, unknown>;
  const definitions = raw['definitions'] as Record<string, unknown>[];
  const dependencies = raw['dependencies'] as Record<string, unknown>[];
  return {
    packageId: raw['packageId'],
    schemaVersion: raw['schemaVersion'],
    dependencies: dependencies.map((dependency) => dependency['packageId']),
    definitions: definitions.map((definition) => {
      const typeIdentity = definition['typeIdentity'] as Record<string, unknown>;
      const schema = definition['parameterSchema'] as Record<string, unknown>;
      const family = definition['semanticFamily'] as Record<string, unknown>;
      return {
        id: definition['id'],
        defKind: definition['defKind'],
        abstract: definition['abstract'],
        familyId: family['familyId'],
        capabilities: [...(typeIdentity['requiredCapabilities'] as string[])],
        components: (definition['composition'] as Record<string, unknown>[]).map((component) => [
          component['componentId'],
          component['role'],
          component['optional'],
          component['typeDefining'],
        ]),
        fields: (schema['fields'] as Record<string, unknown>[]).map((field) => [
          field['name'],
          field['dataType'],
          field['required'],
          field['classification'],
        ]),
        tags: [...(definition['tags'] as string[])],
        actionRefs: (definition['actionRefs'] as Record<string, unknown>[]).map((ref) => [
          ref['refId'],
          ref['role'],
          ref['required'],
        ]),
        otherRefs: (definition['otherRefs'] as Record<string, unknown>[]).map((ref) => [
          ref['refId'],
          ref['role'],
          ref['required'],
        ]),
        sourceRecords: (definition['sourceRecords'] as Record<string, unknown>[]).map((record) => [
          record['sourceFile'],
          record['precedence'],
          record['classification'],
          record['owningLayer'],
          record['statementFingerprint'],
        ]),
      };
    }),
  };
}

const arbFieldSpec: fc.Arbitrary<FieldSpec> = fc.record({
  nameOrdinal: fc.integer({ min: 0, max: 5 }),
  dataType: fc.constantFrom<DeclaredType>(...DECLARED_TYPES),
  classification: fc.constantFrom<ParameterClassification>(...PARAMETER_CLASSIFICATIONS),
  required: fc.boolean(),
});

const arbDefinitionSpec: fc.Arbitrary<DefinitionSpec> = fc.record({
  idOrdinal: fc.integer({ min: 0, max: 4 }),
  defKind: fc.constantFrom<L1DefKind>(...L1_DEF_KINDS),
  abstract: fc.boolean(),
  familyIndex: fc.nat({ max: 32 }),
  capabilityOrdinal: fc.integer({ min: 0, max: 4 }),
  fields: fc.array(arbFieldSpec, { minLength: 0, maxLength: 3 }),
  componentRoleIndex: fc.nat({ max: 64 }),
  refRoleIndex: fc.nat({ max: 64 }),
  precedence: fc.constantFrom<SourcePrecedence>(...SOURCE_PRECEDENCE_ORDER),
  classification: fc.constantFrom<SourceClassificationKind>(...SOURCE_CLASSIFICATION_KINDS),
  owningLayer: fc.constantFrom<OwningLayer>(...OWNING_LAYERS),
  withPresentation: fc.boolean(),
});

/** 定义标识必须互不相同，否则包内出现重复标识（那是 Property 8 的验证对象，不是本性质）。 */
const arbDefinitionSpecs: fc.Arbitrary<readonly DefinitionSpec[]> = fc
  .array(arbDefinitionSpec, { minLength: 1, maxLength: 3 })
  .map((specs) => specs.map((spec, index) => ({ ...spec, idOrdinal: index })));

function codesOf(result: ReturnType<typeof parsePackage>): readonly string[] {
  return isRejection(result) ? result.diagnostics.map((diagnostic) => diagnostic.code) : [];
}

function expectStructuredRejection(result: ReturnType<typeof parsePackage>, code: string): void {
  expect(isRejection(result)).toBe(true);
  expect(codesOf(result)).toContain(code);
  if (isRejection(result)) {
    // 拒绝必须是合法结构化拒绝，且不产生任何候选定义（绝不补造语义内容）。
    expect(isValidStructuredRejection(result)).toBe(true);
    expect('value' in result).toBe(false);
  }
}

describe('Property 6: JSON 语义往返', () => {
  it('parse→canonicalize→parse 等价、语义字段保留、非法输入一律拒绝（fast-check，100 次生成）', () => {
    fc.assert(
      fc.property(
        arbDefinitionSpecs,
        fc.integer({ min: 0, max: 7 }),
        fc.integer({ min: 0, max: 7 }),
        (specs, rotateA, rotateB) => {
          const root = packageJson(specs);
          const textA = emitWithRotatedKeys(root, rotateA, 0);
          const textB = emitWithRotatedKeys(root, rotateB + 1, 4);

          const parsedA = parsePackage(textA, PARSE_OPTIONS);
          const parsedB = parsePackage(textB, PARSE_OPTIONS);
          expect(isOk(parsedA)).toBe(true);
          expect(isOk(parsedB)).toBe(true);
          if (!isOk(parsedA) || !isOk(parsedB)) {
            return;
          }

          // 键序与缩进是非语义表示差异：两种写法必须解析出等价定义。
          expect(fingerprint(parsedB.value)).toBe(fingerprint(parsedA.value));

          const canonicalA = canonicalize(textA);
          const canonicalB = canonicalize(textB);
          expect(isOk(canonicalA)).toBe(true);
          expect(isOk(canonicalB)).toBe(true);
          if (!isOk(canonicalA) || !isOk(canonicalB)) {
            return;
          }
          // 规范化输出与输入表示无关，且与直接对值规范化的结果字节一致。
          expect(canonicalB.value).toBe(canonicalA.value);
          expect(canonicalA.value).toBe(canonicalizeValue(root));

          // 编码器输出必须是语法有效的纯声明式 JSON。
          const scan = scanJson(canonicalA.value);
          expect(scan.ok).toBe(true);
          if (scan.ok) {
            expect(scan.duplicates).toHaveLength(0);
            expect(detectProhibitedConstructs(scan.root)).toHaveLength(0);
          }
          expect(isOk(parseCanonical(canonicalA.value))).toBe(true);

          // parse → canonicalize → parse 产生 Equivalent_Definition。
          const parsedC = parsePackage(canonicalA.value, PARSE_OPTIONS);
          expect(isOk(parsedC)).toBe(true);
          if (!isOk(parsedC)) {
            return;
          }
          expect(fingerprint(parsedC.value)).toBe(fingerprint(parsedA.value));

          // 全部 Semantic_Field 原样保留，供验证器审查（Requirements 11.4）。
          expect(semanticProjection(parsedA.value)).toEqual(expectedProjection(root));
          expect(semanticProjection(parsedC.value)).toEqual(expectedProjection(root));

          // ── 非法输入必须被拒绝且不被补造 ────────────────────────────────────
          const withProhibitedConstruct = cloneRoot(root);
          firstDefinitionOf(withProhibitedConstruct)['$eval'] = 'runtimeValue + 1';
          expectStructuredRejection(
            parsePackage(JSON.stringify(withProhibitedConstruct), PARSE_OPTIONS),
            DIAGNOSTIC_CODES.JSON_PROHIBITED_CONSTRUCT,
          );

          const withMissingSemanticField = cloneRoot(root);
          delete firstDefinitionOf(withMissingSemanticField)['abstract'];
          expectStructuredRejection(
            parsePackage(JSON.stringify(withMissingSemanticField), PARSE_OPTIONS),
            DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_MISSING,
          );

          const withDamagedSemanticField = cloneRoot(root);
          firstDefinitionOf(withDamagedSemanticField)['abstract'] = 'yes';
          expectStructuredRejection(
            parsePackage(JSON.stringify(withDamagedSemanticField), PARSE_OPTIONS),
            DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED,
          );

          const withoutSchemaVersion = cloneRoot(root);
          delete withoutSchemaVersion['schemaVersion'];
          expectStructuredRejection(
            parsePackage(JSON.stringify(withoutSchemaVersion), PARSE_OPTIONS),
            DIAGNOSTIC_CODES.JSON_SCHEMA_VERSION_MISSING,
          );

          const withUnsupportedSchemaVersion = cloneRoot(root);
          withUnsupportedSchemaVersion['schemaVersion'] = 'l2-declarative/unsupported';
          expectStructuredRejection(
            parsePackage(JSON.stringify(withUnsupportedSchemaVersion), PARSE_OPTIONS),
            DIAGNOSTIC_CODES.JSON_SCHEMA_VERSION_UNSUPPORTED,
          );

          const syntacticallyBroken = `${canonicalA.value},`;
          const brokenResult = parsePackage(syntacticallyBroken, PARSE_OPTIONS);
          expectStructuredRejection(brokenResult, DIAGNOSTIC_CODES.JSON_PARSE_ERROR);
          if (isRejection(brokenResult)) {
            // 语法错误必须带来源位置（Requirements 11.3）。
            const parseDiagnostic = brokenResult.diagnostics.find(
              (diagnostic) => diagnostic.code === DIAGNOSTIC_CODES.JSON_PARSE_ERROR,
            );
            expect(parseDiagnostic?.sourceLocation?.sourceFile).toBe(SOURCE_FILE);
            expect(typeof parseDiagnostic?.sourceLocation?.line).toBe('number');
          }

          // 重复成员不得被静默丢弃：语义字段取值歧义必须拒绝。
          const withDuplicateMember = `{${JSON.stringify('schemaVersion')}:${JSON.stringify(SCHEMA_VERSION)},${textA.slice(1)}`;
          expectStructuredRejection(
            parsePackage(withDuplicateMember, PARSE_OPTIONS),
            DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED,
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
