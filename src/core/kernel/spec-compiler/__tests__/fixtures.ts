import { createHash } from 'node:crypto';
import type { DefKind } from '../../state/def';
import type { SourceRecord } from '../../state/diagnostic';
import { InMemoryEmergencySink } from '../../safety/fatal-boundary';
import {
  CandidateMigrationRegistry,
  InMemoryArtifactStore,
  InMemorySpecificationRegistry,
  SchemaRegistry,
  SemanticFamilyRegistry,
  SpecificationCompiler,
} from '../index';
import type {
  BoundProvenance,
  CandidateDocumentInput,
  CreatorMessageBundle,
  DefinitionSchema,
  SchemaVersion,
  TechnicalQuotas,
} from '../index';
import { DEFAULT_TECHNICAL_QUOTAS } from '../index';

/**
 * Provenance for a bound the test host declares as structural.
 *
 * A structural bound is a normative statement about type structure, so the schema has to say where it
 * comes from. The fixture models a real host: it names a source, an owning layer, the fields the bound
 * governs and why the bound is structural rather than a balance choice.
 */
function structuralBound(fields: readonly string[], rationale: string, statementKey?: string): BoundProvenance {
  return {
    sourceId: 'doc:test-host-contract',
    owningLayer: '基类层',
    affectedFields: [...fields],
    rationale,
    ...(statementKey ? { statementKey } : {}),
  };
}

export const WEAPON_SCHEMA: DefinitionSchema = {
  kind: 'item',
  semanticFamily: 'weapon',
  fields: {
    displayName: { type: 'string', presentation: true },
    iconRef: { type: 'string', presentation: true, required: true, fallback: 'icon:placeholder' },
    damageProfile: { type: 'string', semantic: true, reference: { kinds: ['rule'] } },
    damage: { type: 'number', semantic: true, numericOwnership: 'gameplay-value' },
    slotCount: {
      type: 'number', semantic: true, numericOwnership: 'structural-bound', integer: true,
      boundProvenance: structuralBound(['slotCount'], '槽位数量决定容器结构，不随玩法平衡变化。'),
    },
    connectionLimit: {
      type: 'number', semantic: true, numericOwnership: 'structural-bound', integer: true,
      boundProvenance: structuralBound(['connectionLimit'], '连接数上限是拓扑结构约束。', 'topology.connectionLimit'),
    },
    turnIndex: { type: 'number', semantic: true, numericOwnership: 'internal-metric', integer: true },
    volumeClass: { type: 'string', deprecated: true, replacement: 'slotCount' },
    accessories: { type: 'array', unordered: true, identityField: 'id', item: { type: 'object', openProperties: true } },
    // An open object that *does* classify its members: numbers inside it are internal metrics, which is how
    // a host declares free-form data without reopening the unclassified-number hole.
    payload: {
      type: 'object', openProperties: true,
      defaultProperty: {
        type: ['number', 'string', 'boolean', 'object', 'array', 'null'],
        numericOwnership: 'internal-metric', integer: true,
      },
    },
    traits: { type: 'array', item: { type: 'string' } },
    term: { type: 'string' },
  },
};

/**
 * A kind with a required *semantic* field.
 *
 * The other fixture schemas only require a presentation field, so a missing-required-field path could not
 * be told apart from a presentation fallback. `parentScene` makes that distinction testable, and it also
 * exercises a required field satisfied through inheritance rather than through a local declaration.
 */
export const NODE_SCHEMA: DefinitionSchema = {
  kind: 'node',
  semanticFamily: 'micro-scene',
  fields: {
    displayName: { type: 'string', presentation: true },
    iconRef: { type: 'string', presentation: true, fallback: 'icon:placeholder' },
    parentScene: { type: 'string', semantic: true, required: true },
    payload: { type: 'object', openProperties: true },
  },
};

export const RULE_SCHEMA: DefinitionSchema = {
  kind: 'rule',
  semanticFamily: 'damage',
  fields: {
    displayName: { type: 'string', presentation: true },
    iconRef: { type: 'string', presentation: true },
    payload: { type: 'object', openProperties: true },
  },
};

/** Host provenance for the adopted family listing. Not creator input, so a zero-width span is correct. */
export function familySource(): SourceRecord {
  const empty = createHash('sha256').update('', 'utf8').digest('hex');
  return {
    sourceId: 'src:families',
    documentUri: 'file:///families.json',
    sourcePackage: 'pkg.host',
    contentHash: empty,
    precedence: 500,
    owningLayer: '基类层',
    normativeStatus: 'normative',
    span: {
      file: 'file:///families.json',
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
      sourceSliceHash: empty,
    },
  };
}

export function buildSchemaVersion(version: string): SchemaVersion {
  const definitionSchemas = new Map<DefKind, DefinitionSchema>([
    ['item', WEAPON_SCHEMA],
    ['rule', RULE_SCHEMA],
    ['node', NODE_SCHEMA],
  ]);
  const families = new SemanticFamilyRegistry();
  const source = familySource();
  families.register({
    id: 'weapon', allowedKinds: ['item'],
    criteria: { enumerable: true, composable: true, gameplayIndependent: true },
    classificationReason: '武器类型可枚举、可与谱型组合，且不绑定具体玩法。', source,
  });
  families.register({
    id: 'damage', allowedKinds: ['rule'],
    criteria: { enumerable: true, composable: true, gameplayIndependent: true },
    classificationReason: '伤害类别与结算引用可枚举、可组合，不含伤害量。', source,
  });
  families.register({
    id: 'micro-scene', allowedKinds: ['node'],
    criteria: { enumerable: true, composable: true, gameplayIndependent: true },
    classificationReason: '微型场景附属于天然场景，可枚举、可组合，不含具体地图排布。', source,
  });
  return {
    version,
    definitionSchemas,
    integrationContracts: new Map(),
    semanticFamilies: families.toMap(),
  };
}

export interface Harness {
  readonly compiler: SpecificationCompiler;
  readonly schemaRegistry: SchemaRegistry;
  readonly registry: InMemorySpecificationRegistry;
  readonly artifactStore: InMemoryArtifactStore;
  readonly emergencySink: InMemoryEmergencySink;
  readonly migrationRegistry: CandidateMigrationRegistry;
}

export function createHarness(options: {
  readonly versions?: readonly string[];
  readonly quotas?: Partial<TechnicalQuotas>;
  /** Swaps the creator-facing message bundle so localisation can be exercised end to end. */
  readonly bundle?: CreatorMessageBundle;
} = {}): Harness {
  const schemaRegistry = new SchemaRegistry();
  for (const version of options.versions ?? ['1.0.0']) {
    schemaRegistry.register(buildSchemaVersion(version));
  }
  const registry = new InMemorySpecificationRegistry();
  const artifactStore = new InMemoryArtifactStore();
  const emergencySink = new InMemoryEmergencySink();
  const migrationRegistry = new CandidateMigrationRegistry();
  const compiler = new SpecificationCompiler({
    schemaRegistry,
    registry,
    artifactStore,
    emergencySink,
    migrationRegistry,
    quotas: { ...DEFAULT_TECHNICAL_QUOTAS, ...options.quotas },
    ...(options.bundle ? { messageBundle: options.bundle } : {}),
  });
  return { compiler, schemaRegistry, registry, artifactStore, emergencySink, migrationRegistry };
}

export function candidate(sourceText: string, overrides: Partial<CandidateDocumentInput> = {}): CandidateDocumentInput {
  return {
    sourceId: 'src:main',
    documentUri: 'file:///main.spec.json',
    sourcePackage: 'pkg.main',
    sourceText,
    precedence: 100,
    owningLayer: '基类层',
    normativeStatus: 'normative',
    ...overrides,
  };
}

export function validDocument(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schemaVersion: '1.0.0',
    targetLayer: '基类层',
    definitions: [
      { id: 'rule.damage.basic', kind: 'rule', iconRef: 'icon:rule' },
      { id: 'item.shotgun', kind: 'item', iconRef: 'icon:shotgun', damageProfile: 'rule.damage.basic', slotCount: 2 },
    ],
    ...extra,
  }, null, 2);
}
