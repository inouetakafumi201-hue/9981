/**
 * FROZEN NOTICE (2026-08-12)
 *
 * 本模块被判为与 src/l2 重复实现（D-061 架构裁决），执行状态为冻结。
 *
 * 冻结政策：
 * - ✅ 已完成：引擎层基础设施迁出（Phase 1，src/core/kernel/codec|state|security）
 * - ✅ 已完成：9 个独有缺口识别与迁移方案（src/l2/ & 引擎层）
 * - 🔒 冻结：此文件不再接受新功能或优化
 * - ⏳ 等待：其他规范确认已消费 src/l2 端口后才执行物理删除（Wave 3）
 * 
 * 新功能必须：
 * 1. 优先落 src/l2/（语义层）
 * 2. 其次落 src/core/kernel/（引擎基础设施）
 * 3. 严禁直接改本文件
 *
 * 依据：
 * - docs/L_审查报告/D-061_spec-compiler_L2_功能差集审计.md（完整对比）
 * - docs/L_审查报告/Wave1.2_缺口迁移并行Prompt.md（迁移方案）
 * - .kiro/steering/结构收敛执行计划.md（Wave 1-4 执行波次）
 *
 * 联系：若需绕过冻结，请在架构评审会上讨论修订 D-061。
 */

import type { CompilationStage, Diagnostic, DiagnosticArgument, SourceRecord } from '../state/diagnostic.js';
import type { ErrCode } from '../state/error-codes.js';
import { CompilationHaltedError, FatalErrorBoundary } from '../safety/fatal-boundary.js';
import type { EmergencyCode, EmergencySink } from '../safety/fatal-boundary.js';
import { DiagnosticFactory, sortDiagnostics } from './diagnostic-factory.js';
import { JsonCodecError, StrictJsonCodec, canonicalStringify, compareCodePoints } from './json-codec.js';
import { CandidateMigrationRegistry, InMemorySpecificationRegistry, SchemaRegistry } from './registries.js';
import type { RegistrySnapshot } from './registries.js';
import { OutputLease, OutputLeaseError, hashBytes } from './output-lease.js';
import type { ArtifactStore } from './output-lease.js';
import { SpecificationValidator } from './validator.js';
import { checkDiagnosticClosure } from './closure.js';
import { findSemanticFieldDamage } from './integrity.js';
import { modelToJson, provenanceToJson } from './model-json.js';
import { ZH_CN_CREATOR_BUNDLE, bundleEntry, interpolate } from './messages.js';
import type { CreatorMessageBundle } from './messages.js';
import { createSourceRecord } from '../state/source-record.js';
import { DEFAULT_TECHNICAL_QUOTAS, validateTechnicalQuotas } from './types.js';
import type {
  CandidateDocumentInput,
  CompilationRejection,
  CompilationResult,
  CompiledModel,
  CompilerMode,
  JsonValue,
  ParsedCandidateDocument,
  SchemaVersion,
  TechnicalQuotas,
  ValidationBaseline,
} from './types.js';

export interface CompilerHostOptions {
  readonly schemaRegistry: SchemaRegistry;
  readonly registry: InMemorySpecificationRegistry;
  readonly artifactStore: ArtifactStore;
  readonly emergencySink: EmergencySink;
  readonly migrationRegistry?: CandidateMigrationRegistry;
  readonly quotas?: TechnicalQuotas;
  /**
   * Creator-facing message catalogue. Defaults to zh-CN. Swapping it changes only the human-readable
   * layer: codes, severities, spans and the canonical artifact must stay byte-identical.
   */
  readonly messageBundle?: CreatorMessageBundle;
}

interface StageContext {
  readonly compilationId: string;
  readonly mode: CompilerMode;
  readonly baseline: ValidationBaseline;
  readonly activeSnapshot: RegistrySnapshot;
  readonly boundary: FatalErrorBoundary;
  readonly factory: DiagnosticFactory;
  readonly sourceTexts: Map<string, string>;
  readonly quotas: TechnicalQuotas;
}

type PreparedDocument =
  | { readonly ok: true; readonly document: ParsedCandidateDocument; readonly sourceText: string;
      readonly schema: SchemaVersion; readonly diagnostics: readonly Diagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

interface CanonicalOutput {
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly hash: string;
}

const ARTIFACT_NAME = 'model.canonical.json';
const PROVENANCE_NAME = 'model.provenance.json';

const STAGE_ORDER: readonly CompilationStage[] = [
  'intake', 'parse', 'schema', 'semantic', 'precedence', 'reference', 'composition',
  'migration', 'canonicalization', 'commit-recheck', 'staging-write', 'publish', 'rollback',
];

const EMERGENCY_CODE_MAP: Readonly<Record<EmergencyCode, ErrCode>> = Object.freeze({
  DIAGNOSTIC_BUILD_FAILED: 'E_LOAD_DIAGNOSTIC_FAILURE',
  SOURCE_MAPPING_FAILED: 'E_LOAD_SOURCE_MAP_LOST',
  DIAGNOSTIC_BUDGET_EXHAUSTED: 'E_QUOTA_DIAGNOSTICS',
  ROLLBACK_FAILED: 'E_LOAD_CACHE_ROLLBACK_FAILED',
  OUTPUT_ISOLATION_FAILED: 'E_LOAD_OUTPUT_WRITE_FAILED',
});

export class SpecificationCompiler {
  private readonly codec = new StrictJsonCodec();
  private readonly validator = new SpecificationValidator();
  private readonly quotas: TechnicalQuotas;
  private readonly bundle: CreatorMessageBundle;

  constructor(private readonly host: CompilerHostOptions) {
    this.quotas = host.quotas ?? DEFAULT_TECHNICAL_QUOTAS;
    // Checked at construction, not per compilation: a quota that cannot bound a countdown turns every
    // traversal limit into undefined behaviour, and that is a host defect to surface before any input is read.
    validateTechnicalQuotas(this.quotas);
    this.bundle = host.messageBundle ?? ZH_CN_CREATOR_BUNDLE;
  }

  /**
   * Compile one candidate document and publish it only when it is fully valid.
   * Every failure path leaves the active registry and the committed artifact chain untouched.
   */
  async compileAndActivate(input: CandidateDocumentInput): Promise<CompilationResult> {
    return this.compile(input, 'PRODUCTION');
  }

  /**
   * Validate a candidate without any possibility of publishing it. Returns the model that PRODUCTION
   * would have published so the creator can preview it.
   */
  async compileDraft(input: CandidateDocumentInput): Promise<CompilationResult> {
    return this.compile(input, 'SAFE_DRAFT');
  }

  async compile(input: CandidateDocumentInput, mode: CompilerMode): Promise<CompilationResult> {
    const boundary = new FatalErrorBoundary(this.host.emergencySink);
    const activeSnapshot = this.host.registry.getSnapshot();
    const context: StageContext = {
      compilationId: boundary.compilationId,
      mode,
      baseline: this.host.registry.createBaseline(this.host.schemaRegistry),
      activeSnapshot,
      boundary,
      factory: new DiagnosticFactory(boundary, this.bundle),
      sourceTexts: new Map([[input.sourceId, input.sourceText]]),
      quotas: this.quotas,
    };

    let lease: OutputLease | null = null;
    try {
      // A draft never acquires a write capability at all: publication is impossible by construction,
      // not merely skipped by a conditional later in the pipeline.
      if (mode === 'PRODUCTION') {
        lease = boundary.run('intake', 'OUTPUT_ISOLATION_FAILED', () =>
          new OutputLease(context.compilationId, context.baseline.id, this.host.artifactStore));
      }
      return await this.runPipeline(input, context, lease);
    } catch (error) {
      // Halt paths and unexpected throws are both treated as infrastructure failure, never as a pass.
      const cacheFailed = this.releaseLease(lease, boundary.incidentId);
      if (error instanceof CompilationHaltedError) {
        return this.infrastructureRejection(context, error.envelope.stage, error.envelope.emergencyCode, cacheFailed);
      }
      return this.haltAsInfrastructure(context, 'intake', 'DIAGNOSTIC_BUILD_FAILED', cacheFailed);
    }
  }

  private async runPipeline(
    input: CandidateDocumentInput,
    context: StageContext,
    lease: OutputLease | null,
  ): Promise<CompilationResult> {
    const prepared = this.prepareDocument(input, context);
    if (!prepared.ok) return this.candidateRejection(context, lease, prepared.diagnostics);

    const validation = this.validator.validate({
      document: prepared.document,
      sourceText: prepared.sourceText,
      schema: prepared.schema,
      baseline: context.baseline,
      activeSnapshot: context.activeSnapshot,
      quotas: context.quotas,
      compilationId: context.compilationId,
      fatalBoundary: context.boundary,
      messageBundle: this.bundle,
    });
    const diagnostics: Diagnostic[] = [...prepared.diagnostics, ...validation.diagnostics];
    if (!validation.model) return this.candidateRejection(context, lease, diagnostics);

    // The model passed validation, but that only says the input was legal. This asks whether the pipeline
    // carried the input through without losing any of it, which the creator can neither see nor fix.
    const damage = findSemanticFieldDamage(prepared.document.value, validation.model, prepared.schema);
    if (damage.length > 0) {
      return this.haltAsInfrastructure(context, 'canonicalization', 'OUTPUT_ISOLATION_FAILED',
        this.releaseLease(lease, context.boundary.incidentId), 'E_LOAD_SEMANTIC_FIELD_DAMAGED');
    }

    const canonical = this.canonicalizeAndVerify(validation.model, context);
    if (canonical.bytes.byteLength > context.quotas.outputBytes) {
      diagnostics.push(this.report(context, prepared.document.source, prepared.sourceText, {
        code: 'E_QUOTA_OUTPUT_BYTES',
        stage: 'canonicalization',
        message: `Canonical output ${canonical.bytes.byteLength} bytes exceeds ${context.quotas.outputBytes}`,
      }));
      return this.candidateRejection(context, lease, diagnostics);
    }

    if (context.mode === 'SAFE_DRAFT' || !lease) {
      return this.draftSuccess(context, validation.model, canonical, diagnostics);
    }

    return await this.host.registry.withCommitLock(() =>
      this.commitUnderLock(context, lease, prepared, validation.model as CompiledModel, canonical, diagnostics));
  }

  /**
   * Terminal result for a draft. The closure gate still runs, because a draft that reports unusable
   * diagnostics is just as broken as a release that does.
   */
  private draftSuccess(
    context: StageContext,
    model: CompiledModel,
    canonical: CanonicalOutput,
    diagnostics: readonly Diagnostic[],
  ): CompilationResult {
    const sorted = sortDiagnostics(diagnostics);
    const closure = checkDiagnosticClosure(sorted, context.sourceTexts, { requireRejection: false });
    if (closure.length > 0) {
      return this.haltAsInfrastructure(context, 'canonicalization', 'DIAGNOSTIC_BUILD_FAILED', false);
    }
    return {
      ok: true,
      mode: context.mode,
      compilationId: context.compilationId,
      baselineId: context.baseline.id,
      snapshotId: null,
      artifactHash: canonical.hash,
      // SAFE_DRAFT activates nothing, so this is the pre-compilation view unchanged. Returning it lets the
      // caller verify "a draft publishes nothing" instead of taking the compiler's word for it.
      canonicalSnapshot: this.host.registry.canonicalSnapshot(),
      draftModel: model,
      diagnostics: sorted,
    };
  }

  private commitUnderLock(
    context: StageContext,
    lease: OutputLease,
    prepared: Extract<PreparedDocument, { ok: true }>,
    model: CompiledModel,
    canonical: CanonicalOutput,
    diagnostics: Diagnostic[],
  ): CompilationResult {
    const current = this.host.registry.getSnapshot();
    const currentBaseline = this.host.registry.createBaseline(this.host.schemaRegistry);
    if (currentBaseline.id !== context.baseline.id || current.id !== context.activeSnapshot.id) {
      diagnostics.push(this.report(context, prepared.document.source, prepared.sourceText, {
        code: 'E_LOAD_BASELINE_STALE',
        stage: 'commit-recheck',
        message: `Baseline ${context.baseline.id} is stale; the active snapshot is now ${current.id}`,
      }));
      return this.candidateRejection(context, lease, diagnostics);
    }

    const recheck = this.validator.validate({
      document: prepared.document,
      sourceText: prepared.sourceText,
      schema: prepared.schema,
      baseline: currentBaseline,
      activeSnapshot: current,
      quotas: context.quotas,
      compilationId: context.compilationId,
      fatalBoundary: context.boundary,
      messageBundle: this.bundle,
    });
    // Judge by whether a diagnostic actually blocks, not by excluding one known-good severity: an
    // allowlist keyed on 'warn' silently turns every newly introduced non-blocking severity into a
    // spurious commit failure.
    if (!recheck.model || recheck.diagnostics.some(isBlocking)) {
      diagnostics.push(this.report(context, prepared.document.source, prepared.sourceText, {
        code: 'E_LOAD_COMMIT_RECHECK_FAILED',
        stage: 'commit-recheck',
        message: 'Commit-time recheck rejected the previously validated candidate',
      }));
      return this.candidateRejection(context, lease, diagnostics);
    }

    return this.publish(context, lease, current, model, canonical, diagnostics);
  }

  private prepareDocument(input: CandidateDocumentInput, context: StageContext): PreparedDocument {
    let document: ParsedCandidateDocument;
    try {
      document = this.codec.parse(input, context.quotas);
    } catch (error) {
      if (!(error instanceof JsonCodecError)) throw error;
      return { ok: false, diagnostics: [this.reportParseError(context, input, error)] };
    }

    const root = document.value;
    const declared = isRecord(root) && typeof root['schemaVersion'] === 'string' ? root['schemaVersion'] : null;
    if (declared === null) {
      return { ok: false, diagnostics: [this.report(context, document.source, input.sourceText, {
        code: 'E_LOAD_SCHEMA_VERSION',
        stage: 'schema',
        message: 'Candidate does not declare a string schemaVersion',
        path: '/schemaVersion',
      })] };
    }

    const direct = this.host.schemaRegistry.get(declared);
    if (direct) return { ok: true, document, sourceText: input.sourceText, schema: direct, diagnostics: [] };

    const supported = this.host.schemaRegistry.listVersions();
    const target = supported[supported.length - 1];
    const targetSchema = target ? this.host.schemaRegistry.get(target) : null;
    if (!target || !targetSchema) {
      return { ok: false, diagnostics: [this.report(context, document.source, input.sourceText, {
        code: 'E_LOAD_SCHEMA_VERSION',
        stage: 'schema',
        message: 'No schema version is registered in the host',
        path: '/schemaVersion',
      })] };
    }
    if (compareVersionStrings(declared, target) > 0) {
      return { ok: false, diagnostics: [this.report(context, document.source, input.sourceText, {
        code: 'E_MIG_NEWER_SAVE',
        stage: 'migration',
        message: `Candidate version ${declared} is newer than the supported range (up to ${target})`,
        path: '/schemaVersion',
      })] };
    }
    return this.migrateDocument(input, context, document, declared, target, targetSchema);
  }

  private migrateDocument(
    input: CandidateDocumentInput,
    context: StageContext,
    document: ParsedCandidateDocument,
    fromVersion: string,
    toVersion: string,
    targetSchema: SchemaVersion,
  ): PreparedDocument {
    const registry = this.host.migrationRegistry;
    const fail = (code: ErrCode, message: string): PreparedDocument => ({
      ok: false,
      diagnostics: [this.report(context, document.source, input.sourceText, {
        code, stage: 'migration', message, path: '/schemaVersion',
      })],
    });
    if (!registry) return fail('E_MIG_NO_PATH', `No migration registry is available for ${fromVersion}`);

    const resolved = registry.resolve(fromVersion, toVersion, context.quotas.migrationSteps);
    if (resolved.status === 'ambiguous') {
      return fail('E_MIG_AMBIGUOUS_PATH', `Multiple migration paths exist from ${fromVersion} to ${toVersion}`);
    }
    if (resolved.status === 'cycle') {
      return fail('E_MIG_CYCLE', `The migration graph from ${fromVersion} contains a cycle`);
    }
    if (resolved.status === 'missing') {
      return fail('E_MIG_NO_PATH', `No migration path from ${fromVersion} to ${toVersion}`);
    }

    // Migration runs on an isolated value; the original document and registry are never mutated.
    let migrated: JsonValue = deepFreezeClone(document.value);
    for (const step of resolved.path) {
      try {
        migrated = step.transform(deepFreezeClone(migrated));
      } catch (error) {
        return fail('E_MIG_FAILED', `Migration ${step.id} failed: ${describe(error)}`);
      }
    }
    if (!isRecord(migrated)) return fail('E_MIG_FAILED', 'Migration produced a non-object candidate');

    // Serialization can legitimately reject a migration result (for example a non-finite number produced
    // by a transform). That is a migration defect the creator can act on, so it must not escape as an
    // unhandled throw and be reclassified as an infrastructure incident by the outer boundary.
    let migratedText: string;
    try {
      migratedText = canonicalStringify({ ...migrated, schemaVersion: toVersion });
    } catch (error) {
      return fail('E_MIG_FAILED', `Migration result cannot be serialized: ${describe(error)}`);
    }

    const migratedInput: CandidateDocumentInput = { ...input, sourceText: migratedText };
    // Every later diagnostic resolves positions against the migrated text, so the closure gate must
    // validate source records against that text rather than the original bytes.
    context.sourceTexts.set(input.sourceId, migratedText);
    try {
      const reparsed = this.codec.parse(migratedInput, context.quotas);
      // Reported line/column numbers no longer match the file the creator wrote. Saying so is the
      // difference between a confusing position and an explainable one.
      const rebased = this.report(context, reparsed.source, migratedText, {
        code: 'E_LOAD_MIGRATED_SOURCE_REBASED',
        stage: 'migration',
        message: `Source positions were rebased from ${fromVersion} onto the migrated ${toVersion} document`,
        path: '/schemaVersion',
        informational: true,
        messageArgs: { fromVersion, toVersion },
      });
      return { ok: true, document: reparsed, sourceText: migratedText, schema: targetSchema, diagnostics: [rebased] };
    } catch (error) {
      if (!(error instanceof JsonCodecError)) throw error;
      return { ok: false, diagnostics: [this.reportParseError(context, migratedInput, error)] };
    }
  }

  /**
   * Serialize the model, then prove determinism and round-trip equivalence before anything is staged.
   * A mismatch here is a compiler defect, not a creator error, so it halts the session.
   */
  private canonicalizeAndVerify(model: CompiledModel, context: StageContext): CanonicalOutput {
    return context.boundary.run('canonicalization', 'DIAGNOSTIC_BUILD_FAILED', () => {
      const modelJson = modelToJson(model);
      const first = canonicalStringify(modelJson);
      const second = canonicalStringify(modelToJson(model));
      if (first !== second) context.boundary.halt('canonicalization', 'OUTPUT_ISOLATION_FAILED');

      const reparsed = this.codec.parse({
        sourceId: `${context.compilationId}:canonical`,
        documentUri: `memory://${context.compilationId}/${ARTIFACT_NAME}`,
        sourcePackage: 'compiler',
        sourceText: first,
        precedence: 0,
        owningLayer: '引擎层',
        normativeStatus: 'normative',
      }, context.quotas);
      if (canonicalStringify(reparsed.value) !== first) {
        context.boundary.halt('canonicalization', 'OUTPUT_ISOLATION_FAILED');
      }

      const bytes = new Uint8Array(Buffer.from(first, 'utf8'));
      return { text: first, bytes, hash: hashBytes(bytes) };
    });
  }

  private publish(
    context: StageContext,
    lease: OutputLease,
    current: RegistrySnapshot,
    model: CompiledModel,
    canonical: CanonicalOutput,
    diagnostics: Diagnostic[],
  ): CompilationResult {
    const sorted = sortDiagnostics(diagnostics);
    const closure = checkDiagnosticClosure(sorted, context.sourceTexts, { requireRejection: false });
    if (closure.length > 0) {
      return this.haltAsInfrastructure(context, 'publish', 'DIAGNOSTIC_BUILD_FAILED',
        this.releaseLease(lease, context.boundary.incidentId));
    }

    try {
      lease.write(ARTIFACT_NAME, canonical.bytes);
      lease.write(PROVENANCE_NAME, new Uint8Array(Buffer.from(canonicalStringify(provenanceToJson(model)), 'utf8')));
      lease.verifyStaged();
    } catch (error) {
      void error;
      return this.haltAsInfrastructure(context, 'staging-write', 'OUTPUT_ISOLATION_FAILED',
        this.releaseLease(lease, context.boundary.incidentId));
    }

    const committed = this.host.registry.commit(current.id, model, canonical.hash);
    if (!committed) {
      return this.haltAsInfrastructure(context, 'commit-recheck', 'OUTPUT_ISOLATION_FAILED',
        this.releaseLease(lease, context.boundary.incidentId));
    }

    try {
      lease.publish(current.generation + 1, committed.id, canonical.hash);
    } catch (error) {
      void error;
      // Publication failed: restore the previous snapshot so no half-activated state survives.
      this.host.registry.restore(current);
      return this.haltAsInfrastructure(context, 'publish', 'OUTPUT_ISOLATION_FAILED',
        this.releaseLease(lease, context.boundary.incidentId));
    }

    const manifest = this.host.artifactStore.readCommittedManifest();
    if (!manifest || manifest.generation !== current.generation + 1 ||
        manifest.artifactHash !== canonical.hash || manifest.snapshotId !== committed.id) {
      // The lease reported success but the committed manifest disagrees with what was published, so part
      // of the change may be visible while the rest is not. That is a distinct failure from a plain write
      // error and must be reported as such: the operator has to restore, not simply retry.
      this.host.registry.restore(current);
      return this.haltAsInfrastructure(context, 'publish', 'OUTPUT_ISOLATION_FAILED', false,
        'E_LOAD_PARTIAL_ACTIVATION');
    }

    return {
      ok: true,
      mode: context.mode,
      compilationId: context.compilationId,
      baselineId: context.baseline.id,
      snapshotId: committed.id,
      artifactHash: canonical.hash,
      // Taken after commit and publish both succeeded, so it describes the generation just published.
      canonicalSnapshot: this.host.registry.canonicalSnapshot(),
      diagnostics: sorted,
    };
  }
  private candidateRejection(
    context: StageContext,
    lease: OutputLease | null,
    diagnostics: readonly Diagnostic[],
  ): CompilationResult {
    const sorted = sortDiagnostics(diagnostics);
    const closure = checkDiagnosticClosure(sorted, context.sourceTexts, { requireRejection: true });
    const cacheFailed = this.releaseLease(lease, context.boundary.incidentId);
    if (closure.length > 0) {
      return this.haltAsInfrastructure(context, 'rollback', 'DIAGNOSTIC_BUILD_FAILED', cacheFailed);
    }
    if (cacheFailed) {
      return this.haltAsInfrastructure(context, 'rollback', 'ROLLBACK_FAILED', true);
    }
    if (this.host.registry.getSnapshot().id !== context.activeSnapshot.id) {
      return this.haltAsInfrastructure(context, 'rollback', 'OUTPUT_ISOLATION_FAILED', false);
    }
    return {
      ok: false,
      mode: context.mode,
      halted: 'candidate',
      compilationId: context.compilationId,
      baselineId: context.baseline.id,
      diagnostics: sorted,
      unchangedState: true,
      // Evidence for `unchangedState`. The identity check above proves the snapshot id is unmoved; this
      // gives the caller the full view so it can diff against what it held before the attempt.
      canonicalSnapshot: this.host.registry.canonicalSnapshot(),
    };
  }

  /** Convert a halt request into a terminal rejection without re-entering the diagnostic factory. */
  private haltAsInfrastructure(
    context: StageContext,
    stage: CompilationStage,
    code: EmergencyCode,
    cacheFailed: boolean,
    reportedCode?: ErrCode,
  ): CompilationRejection {
    const effective = cacheFailed ? 'ROLLBACK_FAILED' : code;
    try {
      context.boundary.halt(cacheFailed ? 'rollback' : stage, effective);
    } catch (error) {
      if (!(error instanceof CompilationHaltedError)) throw error;
      return this.infrastructureRejection(
        context, error.envelope.stage, error.envelope.emergencyCode, cacheFailed, reportedCode);
    }
    return this.infrastructureRejection(context, stage, effective, cacheFailed, reportedCode);
  }

  /**
   * Turn a halt into a terminal rejection.
   *
   * `reportedCode` exists so a failure that is more specific than its emergency envelope keeps its own
   * identity. A partial activation and an ordinary write failure both isolate output, but they ask the
   * operator for different actions, so they must not collapse into one code.
   */
  private infrastructureRejection(
    context: StageContext,
    stage: CompilationStage,
    code: EmergencyCode,
    cacheFailed: boolean,
    reportedCode?: ErrCode,
  ): CompilationRejection {
    const errCode = cacheFailed
      ? 'E_LOAD_CACHE_ROLLBACK_FAILED'
      : reportedCode ?? EMERGENCY_CODE_MAP[code];
    // Built inline on purpose: the ordinary factory may be exactly what failed.
    const diagnostic: Diagnostic = Object.freeze({
      code: errCode,
      severity: 'fatal',
      haltClass: 'infrastructure',
      scope: 'host',
      message: `Compilation halted at ${stage} (${code})`,
      messageKey: errCode,
      // Always an object, exactly like every factory-built diagnostic: a host rendering a localised
      // bundle must never have to special-case the infrastructure path.
      messageArgs: {},
      creatorMessage: interpolate(this.bundle.creatorMessagePattern, {
        title: bundleEntry(this.bundle, errCode).title,
        guidance: bundleEntry(this.bundle, errCode).guidance,
      }),
      hint: bundleEntry(this.bundle, errCode).guidance,
      actionableHint: bundleEntry(this.bundle, errCode).guidance,
      phase: STAGE_ORDER.indexOf(stage),
      stage,
      compilationId: context.compilationId,
      baselineId: context.baseline.id,
    });
    return {
      ok: false,
      mode: context.mode,
      halted: 'infrastructure',
      compilationId: context.compilationId,
      baselineId: context.baseline.id,
      diagnostics: [diagnostic],
      unchangedState: true,
      // Read after any `registry.restore(...)` the failing path performed, so it reflects the state the
      // caller is actually left with rather than the state the compiler intended to leave.
      canonicalSnapshot: this.host.registry.canonicalSnapshot(),
      incidentId: context.boundary.incidentId,
    };
  }

  /** Returns true when the staging area could not be cleaned up and had to be quarantined. */
  private releaseLease(lease: OutputLease | null, incidentId: string): boolean {
    if (!lease || lease.getState() !== 'open') return false;
    try {
      lease.revoke(incidentId);
      return false;
    } catch (error) {
      return error instanceof OutputLeaseError;
    }
  }

  private report(
    context: StageContext,
    source: SourceRecord,
    sourceText: string,
    input: {
      readonly code: ErrCode;
      readonly stage: CompilationStage;
      readonly message: string;
      readonly path?: string;
      readonly warning?: boolean;
      readonly informational?: boolean;
      readonly messageArgs?: Readonly<Record<string, DiagnosticArgument>>;
    },
  ): Diagnostic {
    return context.factory.build({
      code: input.code,
      stage: input.stage,
      phase: STAGE_ORDER.indexOf(input.stage),
      technicalMessage: input.message,
      source,
      sourceText,
      path: input.path,
      warning: input.warning,
      informational: input.informational,
      messageArgs: input.messageArgs,
      compilationId: context.compilationId,
      baselineId: context.baseline.id,
    });
  }

  private reportParseError(
    context: StageContext,
    input: CandidateDocumentInput,
    error: JsonCodecError,
  ): Diagnostic {
    // Parse failures may have no definition id at all, so the document span is the only safe anchor.
    const source = createSourceRecordForRange(input, error.startCharIndex, error.endCharIndex);
    return context.factory.build({
      code: error.code,
      stage: error.code.startsWith('E_QUOTA') ? 'intake' : 'parse',
      phase: STAGE_ORDER.indexOf('parse'),
      technicalMessage: error.message,
      source,
      sourceText: input.sourceText,
      path: error.path,
      messageArgs: error.details,
      compilationId: context.compilationId,
      baselineId: context.baseline.id,
    });
  }
}

function createSourceRecordForRange(
  input: CandidateDocumentInput,
  startCharIndex: number,
  endCharIndex: number,
): SourceRecord {
  const clampedStart = Math.min(Math.max(0, startCharIndex), input.sourceText.length);
  const clampedEnd = Math.min(Math.max(clampedStart, endCharIndex), input.sourceText.length);
  return createSourceRecord({ ...input, startCharIndex: clampedStart, endCharIndex: clampedEnd });
}

/** A diagnostic blocks activation when it is an error, a fatal, or declares a halt class. */
function isBlocking(diagnostic: Diagnostic): boolean {
  return diagnostic.severity === 'error' ||
    diagnostic.severity === 'fatal' ||
    diagnostic.haltClass !== undefined;
}

function isRecord(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFreezeClone(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(deepFreezeClone);
  const clone: Record<string, JsonValue> = {};
  for (const [key, member] of Object.entries(value)) clone[key] = deepFreezeClone(member);
  return clone;
}

function compareVersionStrings(left: string, right: string): number {
  const a = left.split('.').map((part) => Number.parseInt(part, 10));
  const b = right.split('.').map((part) => Number.parseInt(part, 10));
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const leftPart = Number.isFinite(a[index]) ? (a[index] as number) : 0;
    const rightPart = Number.isFinite(b[index]) ? (b[index] as number) : 0;
    if (leftPart !== rightPart) return leftPart - rightPart;
  }
  return compareCodePoints(left, right);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
