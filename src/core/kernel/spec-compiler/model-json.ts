import type { SourceRecord } from '../state/diagnostic';
import { compareCodePoints } from './json-codec';
import type {
  CandidateDefinition,
  CompiledModel,
  JsonValue,
  ResolvedDefinition,
  SemanticFamilyRegistration,
} from './types';

/**
 * Semantic identity of the activated model.
 *
 * Source spans are deliberately excluded: two candidates that differ only in whitespace or key order must
 * produce byte-identical canonical output, and span offsets would break that. Provenance is published
 * separately by `provenanceToJson`, so nothing is lost, it is just not part of the identity.
 */
export function modelToJson(model: CompiledModel): JsonValue {
  return {
    schemaVersion: model.schemaVersion,
    targetLayer: model.targetLayer,
    packages: mapRecord(model.packages, (record) => ({
      packageId: record.packageId,
      dependencies: [...record.dependencies],
    })),
    semanticFamilies: mapRecord(model.semanticFamilies, familyToJson),
    definitions: mapRecord(model.definitions, definitionToJson),
    resolvedDefinitions: mapRecord(model.resolvedDefinitions, resolvedToJson),
    normativeStatements: mapRecord(model.normativeStatements, (statement) => ({
      key: statement.key, value: statement.value,
    })),
    unresolvedItems: model.unresolvedItems.map((item) => ({
      key: item.key,
      statements: item.statements.map((statement) => ({ key: statement.key, value: statement.value })),
    })),
    dependencyGraph: mapRecord(model.dependencyGraph, (edges) => [...edges]),
    inboundGraph: mapRecord(model.inboundGraph, (edges) => [...edges]),
  };
}

function mapRecord<T>(
  source: Readonly<Record<string, T>>,
  project: (value: T) => JsonValue,
): JsonValue {
  const output: Record<string, JsonValue> = {};
  for (const key of Object.keys(source).sort(compareCodePoints)) {
    const value = source[key];
    if (value !== undefined) output[key] = project(value);
  }
  return output;
}

function definitionToJson(definition: CandidateDefinition): JsonValue {
  return {
    id: definition.id,
    kind: definition.kind,
    abstract: definition.abstract,
    semanticFamily: definition.semanticFamily,
    extends: [...definition.extends],
    components: [...definition.components],
    typeDefining: definition.typeDefining,
    typeIdentity: identityToJson(definition.typeIdentity),
    value: definition.value as unknown as JsonValue,
  };
}

function resolvedToJson(resolved: ResolvedDefinition): JsonValue {
  return {
    id: resolved.id,
    kind: resolved.kind,
    abstract: resolved.abstract,
    semanticFamily: resolved.semanticFamily,
    lineage: [...resolved.lineage],
    components: [...resolved.components],
    typeIdentity: identityToJson(resolved.typeIdentity),
    fields: resolved.fields as unknown as JsonValue,
  };
}

function identityToJson(identity: {
  readonly requiredCapabilities: readonly string[];
  readonly legalRelations: readonly string[];
  readonly invariants: readonly string[];
  readonly substitutes: readonly string[];
}): JsonValue {
  return {
    requiredCapabilities: [...identity.requiredCapabilities],
    legalRelations: [...identity.legalRelations],
    invariants: [...identity.invariants],
    substitutes: [...identity.substitutes],
  };
}

function familyToJson(registration: SemanticFamilyRegistration): JsonValue {
  return {
    id: registration.id,
    allowedKinds: [...registration.allowedKinds],
    criteria: {
      enumerable: registration.criteria.enumerable,
      composable: registration.criteria.composable,
      gameplayIndependent: registration.criteria.gameplayIndependent,
    },
    classificationReason: registration.classificationReason,
  };
}

/** Full provenance sidecar. Published atomically with the model but excluded from semantic identity. */
export function provenanceToJson(model: CompiledModel): JsonValue {
  return {
    schemaVersion: model.schemaVersion,
    definitions: mapRecord(model.definitions, (definition) => sourceToJson(definition.source)),
    semanticFamilies: mapRecord(model.semanticFamilies, (family) => sourceToJson(family.source)),
    normativeStatements: mapRecord(model.normativeStatements, (statement) => sourceToJson(statement.source)),
    unresolvedItems: model.unresolvedItems.map((item) => ({
      key: item.key,
      sources: item.statements.map((statement) => sourceToJson(statement.source)),
    })),
    sourceRecords: model.sourceRecords.map(sourceToJson),
  };
}

export function sourceToJson(source: SourceRecord): JsonValue {
  return {
    sourceId: source.sourceId,
    documentUri: source.documentUri,
    sourcePackage: source.sourcePackage,
    contentHash: source.contentHash,
    precedence: source.precedence,
    decisionId: source.decisionId ?? null,
    owningLayer: source.owningLayer,
    normativeStatus: source.normativeStatus,
    span: {
      file: source.span.file,
      start: { line: source.span.start.line, column: source.span.start.column, offset: source.span.start.offset },
      end: { line: source.span.end.line, column: source.span.end.column, offset: source.span.end.offset },
      sourceSliceHash: source.span.sourceSliceHash ?? null,
    },
  };
}
