import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as AI from '../index';

describe('AI migration regression', () => {
  it('exposes the bounded facade and removes the legacy state-taking entry points', () => {
    expect(AI.BoundedAIDecisionFacade).toBeTypeOf('function');
    expect(AI.SequentialSearchPlanner).toBeTypeOf('function');
    expect('aiSearch' in AI).toBe(false);
    expect('sliceFor' in AI).toBe(false);
    expect('createTiering' in AI).toBe(false);
    expect('evaluateGuard' in AI).toBe(false);
  });

  it('contains no legacy global-state search implementation or gameplay-field score heuristic', () => {
    const sourceFiles = ['../index.ts', '../search.ts', '../belief-slice.ts', '../tiering.ts', '../evaluate-guard.ts'];
    for (const relativePath of sourceFiles) {
      const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
      expect(source).not.toMatch(/\baiSearch\s*\(/);
      expect(source).not.toMatch(/\bsliceFor\s*\(/);
      expect(source).not.toMatch(/\bcreateTiering\s*\(/);
      expect(source).not.toMatch(/\balphaBeta\b/);
      expect(source).not.toMatch(/props\?\.\[['"](?:hp|maxHp|damage)['"]\]/);
      expect(source).not.toMatch(/from ['"][^'"]*world-state/);
    }
  });

  it('keeps only a SearchDecisionContext-based public search contract', () => {
    const searchSource = readFileSync(fileURLToPath(new URL('../search.ts', import.meta.url)), 'utf8');
    expect(searchSource).toContain('SearchDecisionContext');
    expect(searchSource).toContain('SearchSession');
    expect(searchSource).toContain('SequentialSearchPlanner');
  });
});
