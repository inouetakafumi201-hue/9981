export type Severity = 'fatal' | 'error' | 'warn' | 'info';

export interface Diagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly at?: { def?: string; field?: string; playpack?: string };
  readonly phase: number;
}

/** 需求39.6：E_INV_* 永远是运行时不变量 fatal；玩法包不可覆盖。 */
export const FATAL_PREFIXES = ['E_INV'] as const;

export function isFatalCode(code: string): boolean {
  return FATAL_PREFIXES.some((prefix) => code.startsWith(prefix));
}

export function diagnosticDedupKey(diag: Diagnostic): string {
  return [diag.code, diag.severity, diag.at?.def ?? '', diag.at?.field ?? '', diag.phase].join('::');
}
