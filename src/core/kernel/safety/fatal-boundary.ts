import { randomUUID } from 'node:crypto';
import type { CompilationStage } from '../state/diagnostic.js';

/** Fixed emergency codes do not share the ordinary Diagnostic allocation/formatting path. */
export type EmergencyCode =
  | 'DIAGNOSTIC_BUILD_FAILED'
  | 'SOURCE_MAPPING_FAILED'
  | 'DIAGNOSTIC_BUDGET_EXHAUSTED'
  | 'ROLLBACK_FAILED'
  | 'OUTPUT_ISOLATION_FAILED';

export interface FatalEnvelope {
  readonly kind: 'COMPILATION_FATAL';
  readonly compilationId: string;
  readonly incidentId: string;
  readonly stage: CompilationStage;
  readonly emergencyCode: EmergencyCode;
}

export interface EmergencySink {
  /** Implementations must be bounded and must not call the ordinary diagnostic formatter. */
  writeFixed(envelope: FatalEnvelope): void;
}

export class InMemoryEmergencySink implements EmergencySink {
  private readonly entries: FatalEnvelope[] = [];

  constructor(private readonly capacity = 32) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError('Emergency sink capacity must be a positive safe integer');
    }
  }

  writeFixed(envelope: FatalEnvelope): void {
    if (this.entries.length < this.capacity) this.entries.push(envelope);
  }

  getAll(): readonly FatalEnvelope[] {
    return this.entries;
  }
}

export class CompilationHaltedError extends Error {
  constructor(readonly envelope: FatalEnvelope) {
    super(`Compilation halted: ${envelope.emergencyCode} (${envelope.incidentId})`);
    this.name = 'CompilationHaltedError';
  }
}

const STAGES: readonly CompilationStage[] = [
  'intake',
  'parse',
  'schema',
  'semantic',
  'precedence',
  'reference',
  'composition',
  'migration',
  'canonicalization',
  'commit-recheck',
  'staging-write',
  'publish',
  'rollback',
];

const EMERGENCY_CODES: readonly EmergencyCode[] = [
  'DIAGNOSTIC_BUILD_FAILED',
  'SOURCE_MAPPING_FAILED',
  'DIAGNOSTIC_BUDGET_EXHAUSTED',
  'ROLLBACK_FAILED',
  'OUTPUT_ISOLATION_FAILED',
];

/**
 * Session-scoped fail-closed boundary. Every possible envelope is allocated when the session starts,
 * before untrusted input is parsed. The failure path only performs a map lookup and a bounded write.
 */
export class FatalErrorBoundary {
  readonly compilationId: string;
  readonly incidentId: string;
  private readonly envelopes = new Map<string, FatalEnvelope>();
  private haltedEnvelope: FatalEnvelope | null = null;

  constructor(
    private readonly emergencySink: EmergencySink,
    compilationId = randomUUID(),
    incidentId = randomUUID(),
  ) {
    this.compilationId = compilationId;
    this.incidentId = incidentId;
    for (const stage of STAGES) {
      for (const emergencyCode of EMERGENCY_CODES) {
        this.envelopes.set(`${stage}:${emergencyCode}`, Object.freeze({
          kind: 'COMPILATION_FATAL',
          compilationId,
          incidentId,
          stage,
          emergencyCode,
        }));
      }
    }
  }

  isHalted(): boolean {
    return this.haltedEnvelope !== null;
  }

  getHaltedEnvelope(): FatalEnvelope | null {
    return this.haltedEnvelope;
  }

  halt(stage: CompilationStage, emergencyCode: EmergencyCode): never {
    const envelope = this.envelopes.get(`${stage}:${emergencyCode}`);
    if (!envelope) {
      // STAGES and EMERGENCY_CODES are closed sets; this branch indicates local program corruption.
      throw new Error('Fatal envelope registry is incomplete');
    }
    this.haltedEnvelope = envelope;
    try {
      this.emergencySink.writeFixed(envelope);
    } catch {
      // Emergency logging is best effort. Compilation termination must not depend on logging success.
    }
    throw new CompilationHaltedError(envelope);
  }

  run<T>(
    stage: CompilationStage,
    emergencyCode: EmergencyCode,
    operation: () => T,
    rollback?: () => void,
  ): T {
    if (this.haltedEnvelope) throw new CompilationHaltedError(this.haltedEnvelope);
    try {
      return operation();
    } catch (error) {
      if (error instanceof CompilationHaltedError) throw error;
      if (rollback) {
        try {
          rollback();
        } catch {
          return this.halt('rollback', 'ROLLBACK_FAILED');
        }
      }
      return this.halt(stage, emergencyCode);
    }
  }
}
