/**
 * The explanation projection publishes only what the play layer declares, and
 * never a reference the viewer cannot see even when the key is declared.
 */
import { describe, expect, it } from 'vitest';
import { projectAIExplanation, type AIExplanationPolicy } from '../explanation';
import type { AICandidate, AIDecisionResult, BeliefSlice } from '../types';

const HIDDEN = 'e:hidden-target';

const slice: BeliefSlice = {
  agent: { $: 'g:player' },
  visibleFacts: {},
  knownFacts: {},
  visibleRefs: [{ $: 'e:player' }, { $: 'n:room' }],
  policyContext: {},
};

const candidate: AICandidate = {
  actor: { $: 'e:player' },
  legalAction: {
    action: 'a:move',
    bindings: { destination: { $: 'n:room' }, secretTarget: { $: HIDDEN }, stance: 'ready' },
    cost: [{ pool: 'ap', amount: 2 }],
  },
  rationale: [
    { kind: 'legal-action', summary: 'internal wording', visibleRefs: [{ $: 'e:player' }] },
    { kind: 'policy-rule', summary: `chasing ${HIDDEN}`, visibleRefs: [{ $: HIDDEN }] },
  ],
  score: 4,
  scoreStatus: 'evaluated',
  rootKnowledgeVersion: 'knowledge:1',
  rootActionVersion: 'actions:1',
};

const result: AIDecisionResult = { status: 'recommended', candidate, diagnostics: [] };

describe('play-declared explanation disclosure', () => {
  it('publishes nothing beyond the action id when no policy is declared', () => {
    const projection = projectAIExplanation(result, slice);
    expect(projection.recommendation?.action).toBe('a:move');
    expect(projection.recommendation?.bindings).toEqual({});
    expect(projection.recommendation?.cost).toEqual([]);
    expect(JSON.stringify(projection)).not.toContain(HIDDEN);
  });

  it('publishes declared binding keys, declared cost and play-authored wording', () => {
    const policy: AIExplanationPolicy = {
      publishableBindingKeys: ['destination', 'stance'],
      publishCost: true,
      summaries: { 'legal-action': '这一步现在可以执行。' },
    };
    const projection = projectAIExplanation(result, slice, policy);
    expect(projection.recommendation?.bindings).toEqual({ destination: { $: 'n:room' }, stance: 'ready' });
    expect(projection.recommendation?.cost).toEqual([{ pool: 'ap', amount: 2 }]);
    expect(projection.reasons[0]?.summary).toBe('这一步现在可以执行。');
  });

  it('withholds a declared key whose value references something the viewer cannot see', () => {
    const projection = projectAIExplanation(result, slice, {
      publishableBindingKeys: ['destination', 'secretTarget'],
    });
    expect(projection.recommendation?.bindings).toEqual({ destination: { $: 'n:room' } });
    expect(JSON.stringify(projection)).not.toContain(HIDDEN);
  });

  it('drops a rationale node that cites an invisible reference regardless of policy', () => {
    const projection = projectAIExplanation(result, slice, {
      summaries: { 'policy-rule': 'a policy rule applied' },
    });
    expect(projection.reasons.map((reason) => reason.kind)).toEqual(['legal-action']);
  });
});
