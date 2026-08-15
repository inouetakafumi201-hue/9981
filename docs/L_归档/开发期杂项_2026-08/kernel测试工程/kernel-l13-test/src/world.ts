export interface RuleCircuitEntry {
  readonly windowErrors: number[];
  readonly disabled: boolean;
}

export interface MiniWorldState {
  readonly ruleCircuitState: Record<string, RuleCircuitEntry>;
  readonly entities: Record<string, unknown>;
  readonly attachments: Record<string, unknown>;
  readonly rules: Record<string, unknown>;
}

export function createEmptyWorldState(): MiniWorldState {
  return { ruleCircuitState: {}, entities: {}, attachments: {}, rules: {} };
}
