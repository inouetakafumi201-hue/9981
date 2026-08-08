import { Diagnostic, Severity, diagnosticDedupKey, isFatalCode } from './diagnostic.js';

export interface DiagnosticSinkOpts {
  onFatal?: (diag: Diagnostic) => void;
  maxCapacity?: number;
  dedup?: boolean;
}

export class DiagnosticHaltError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(`${diagnostic.code}: ${diagnostic.message}`);
    this.name = 'DiagnosticHaltError';
  }
}

export class DiagnosticSink {
  private readonly log: Diagnostic[] = [];
  private readonly opts: Required<DiagnosticSinkOpts>;
  private readonly seen = new Set<string>();
  private halted = false;
  private droppedCount = 0;

  constructor(opts: DiagnosticSinkOpts = {}) {
    const maxCapacity = opts.maxCapacity ?? 500;
    if (!Number.isSafeInteger(maxCapacity) || maxCapacity < 1) {
      throw new RangeError('DiagnosticSink maxCapacity 必须是正安全整数');
    }
    this.opts = {
      onFatal: opts.onFatal ?? (() => {}),
      maxCapacity,
      dedup: opts.dedup ?? true,
    };
  }

  private halt(diag: Diagnostic): never {
    this.halted = true;
    try {
      this.opts.onFatal(diag);
    } finally {
      throw new DiagnosticHaltError(diag);
    }
  }

  emit(diag: Diagnostic): void {
    if (this.halted) throw new DiagnosticHaltError(diag);

    const mustHalt = diag.severity === 'fatal' || isFatalCode(diag.code);
    const key = diagnosticDedupKey(diag);

    if (mustHalt) {
      if (!this.opts.dedup || !this.seen.has(key)) this.record(diag, key);
      this.halt(diag);
    }

    if (this.opts.dedup && this.seen.has(key)) return;
    this.record(diag, key);
  }

  private record(diag: Diagnostic, key: string): void {
    if (this.log.length >= this.opts.maxCapacity) {
      const evictionIndex = findEvictionIndex(this.log);
      if (evictionIndex >= 0) {
        const [evicted] = this.log.splice(evictionIndex, 1);
        if (this.opts.dedup && evicted !== undefined) this.seen.delete(diagnosticDedupKey(evicted));
        this.droppedCount++;
      }
    }
    this.log.push(diag);
    if (this.opts.dedup) this.seen.add(key);
  }

  getAll(): readonly Diagnostic[] {
    return this.log;
  }

  getBySeverity(severity: Severity): Diagnostic[] {
    return this.log.filter((d) => d.severity === severity);
  }

  hasFatal(): boolean {
    return this.halted || this.log.some((d) => d.severity === 'fatal' || isFatalCode(d.code));
  }

  isHalted(): boolean {
    return this.halted;
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }

  clear(): void {
    this.log.length = 0;
    this.seen.clear();
    this.halted = false;
    this.droppedCount = 0;
  }
}

function findEvictionIndex(log: readonly Diagnostic[]): number {
  const infoIndex = log.findIndex((diag) => diag.severity === 'info');
  return infoIndex >= 0 ? infoIndex : log.findIndex((diag) => diag.severity === 'warn');
}
