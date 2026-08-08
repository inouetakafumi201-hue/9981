import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FixedBudgetLedger } from '../budget.js';
import { ValidatedBehaviorGateway, UnavailableBehaviorValidationGateway } from '../behavior-validation.js';
import { createAIDiagnostic, unavailableContract } from '../diagnostics.js';
import { RestrictedAIReadGateway, UnavailableAIReadGateway } from '../read-gateway.js';
import type {
  AIRecommendationRequest,
  AIDecisionRequest,
  PlayerRecommendationRequest,
  ValidatedAIBehaviorBinding,
} from '../types.js';

type Assert<T extends true> = T;
type PlayerCannotAct = Extract<PlayerRecommendationRequest, { mode: 'act' }> extends never ? true : false;
const playerCannotAct: Assert<PlayerCannotAct> = true;

const playerRequest: AIRecommendationRequest = {
  category: 'player-assistance',
  mode: 'recommend',
  agent: { $: 'g:player' },
  controlledEntity: { $: 'e:player' },
  policy: { $: 'd:assist' },
  behaviorBinding: { $: 'd:assist-behavior' },
  tier: 'exact',
  budget: { decisionPoints: 2, simulations: 1, evaluationCalls: 2 },
  correlationId: 'corr-player',
};

const npcRequest: AIDecisionRequest = {
  category: 'npc-behavior',
  mode: 'act',
  agent: { $: 'g:npc' },
  controlledEntity: { $: 'e:npc' },
  policy: { $: 'd:npc-policy' },
  behaviorBinding: { $: 'd:npc-behavior' },
  tier: 'exact',
  budget: { decisionPoints: 2, simulations: 1, evaluationCalls: 2 },
  correlationId: 'corr-npc',
};

function validBinding(overrides: Partial<ValidatedAIBehaviorBinding> = {}): ValidatedAIBehaviorBinding {
  return {
    family: { $: 'd:family' },
    policy: { $: 'd:npc-policy' },
    category: 'npc-behavior',
    parameters: [{
      path: 'vision',
      value: 3,
      schema: { $: 'd:vision-schema' },
      owner: 'play-configuration',
      playerVisible: true,
      internalMetric: false,
    }],
    ...overrides,
  };
}

describe('bounded AI public contracts', () => {
  it('uses a discriminated request union: player assistance cannot act', () => {
    expect(playerCannotAct).toBe(true);
    expect(playerRequest.mode).toBe('recommend');
    expect(npcRequest.mode).toBe('act');
  });

  it('creates diagnostics with all mandatory correlation fields', () => {
    const diagnostic = createAIDiagnostic(npcRequest, {
      code: 'AI_CANDIDATE_ILLEGAL',
      severity: 'warn',
      phase: 'revalidate',
      candidateAction: { $: 'a:move' },
      reason: 'The target is no longer visible.',
      upstreamContract: 'ActionCatalog.queryActions',
      hint: 'Open a fresh read scope and select a currently legal action.',
    });
    expect(diagnostic).toMatchObject({
      category: 'npc-behavior',
      agent: { $: 'g:npc' },
      controlledEntity: { $: 'e:npc' },
      policy: { $: 'd:npc-policy' },
      correlationId: 'corr-npc',
      candidateAction: { $: 'a:move' },
      phase: 'revalidate',
    });

    const unavailable = unavailableContract(
      npcRequest,
      'submit',
      'Action→Decision/Intent→Op adapter',
      'No canonical submission adapter has been frozen.',
      'Install the owning kernel adapter.',
    );
    expect(unavailable.code).toBe('AI_CONTRACT_UNAVAILABLE');
    expect(unavailable.upstreamContract).toContain('Action');
  });

  it('keeps budget finite and rejects exhausted work deterministically', () => {
    const ledger = new FixedBudgetLedger({ decisionPoints: 1, simulations: 0, evaluationCalls: 1 });
    expect(ledger.consume('decisionPoints').ok).toBe(true);
    const exhausted = ledger.consume('decisionPoints');
    expect(exhausted).toEqual({ ok: false, code: 'AI_BUDGET_EXHAUSTED', detail: 'AI decisionPoints budget is exhausted.' });
    expect(ledger.exhausted()).toBe(true);
    expect(() => new FixedBudgetLedger({ decisionPoints: -1, simulations: 0, evaluationCalls: 0 })).toThrow();
  });

  it('uses an adapter-filtered immutable read scope and rejects uncontrolled actors', () => {
    let visibleQueryCalls = 0;
    const gateway = new RestrictedAIReadGateway({
      readAuthority: (agent) => ({ ok: true, value: { agent, controlledEntities: [{ $: 'e:npc' }], omniscient: false } }),
      versions: () => ({ ok: true, value: { knowledge: 'knowledge:1', actions: 'actions:1' } }),
      isCurrent: (_authority, versions) => versions.knowledge === 'knowledge:1' && versions.actions === 'actions:1',
      buildBeliefSlice: (authority) => ({
        ok: true,
        value: {
          agent: authority.agent,
          visibleFacts: { public: 'only' },
          knownFacts: {},
          visibleRefs: [{ $: 'e:npc' }],
          policyContext: {},
        },
      }),
      queryVisible: () => {
        visibleQueryCalls++;
        return { ok: true, value: [{ $: 'e:npc' }] };
      },
      queryActions: () => ({ ok: true, value: [{ action: 'a:move', bindings: {}, cost: [] }] }),
    });
    const opened = gateway.openReadScope({ $: 'g:npc' });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const slice = opened.value.beliefSlice();
    expect(slice.ok).toBe(true);
    if (slice.ok) {
      expect(slice.value.visibleRefs).toEqual([{ $: 'e:npc' }]);
      expect(Object.isFrozen(slice.value.visibleFacts)).toBe(true);
    }
    expect(opened.value.queryActions({ $: 'e:other' })).toMatchObject({ ok: false, code: 'AI_CANDIDATE_ILLEGAL' });
    expect(opened.value.queryActions({ $: 'e:npc' })).toMatchObject({ ok: true });
    expect(opened.value.query({ from: 'entities' })).toMatchObject({
      ok: false,
      code: 'AI_CONTRACT_UNAVAILABLE',
    });
    expect(visibleQueryCalls).toBe(0);
    expect(opened.value.query({ from: 'entities', visibleTo: true })).toMatchObject({
      ok: true,
      value: [{ $: 'e:npc' }],
    });
    expect(visibleQueryCalls).toBe(1);
  });

  it('deeply clones and freezes slice/action output so adapter aliases cannot become read or write side channels', () => {
    const adapterSlice = {
      agent: { $: 'g:npc' },
      visibleFacts: { public: { nested: ['safe'] } },
      knownFacts: {
        memory: {
          value: { lastKnown: { $: 'n:old' } },
          observedAt: 3,
          certainty: 'historical' as const,
        },
      },
      visibleRefs: [{ $: 'e:npc' }],
      policyContext: { mode: { labels: ['guard'] } },
    };
    const adapterActions = [{
      action: 'a:move',
      bindings: { target: { $: 'n:visible' }, route: ['n:visible'] },
      cost: [],
    }];
    const gateway = new RestrictedAIReadGateway({
      readAuthority: (agent) => ({ ok: true, value: { agent, controlledEntities: [{ $: 'e:npc' }], omniscient: false } }),
      versions: () => ({ ok: true, value: { knowledge: 'knowledge:deep', actions: 'actions:deep' } }),
      isCurrent: () => true,
      buildBeliefSlice: () => ({ ok: true, value: adapterSlice }),
      queryVisible: () => ({ ok: true, value: [{ $: 'e:npc' }] }),
      queryActions: () => ({ ok: true, value: adapterActions }),
    });
    const opened = gateway.openReadScope({ $: 'g:npc' });
    if (!opened.ok) throw new Error(opened.detail);
    const slice = opened.value.beliefSlice();
    const actions = opened.value.queryActions({ $: 'e:npc' });
    if (!slice.ok) throw new Error(slice.detail);
    if (!actions.ok) throw new Error(actions.detail);

    expect(Object.isFrozen(slice.value.visibleFacts['public'])).toBe(true);
    expect(Object.isFrozen((slice.value.visibleFacts['public'] as { nested: unknown }).nested)).toBe(true);
    expect(Object.isFrozen(slice.value.knownFacts['memory']?.value)).toBe(true);
    expect(Object.isFrozen(actions.value[0]?.bindings['target'])).toBe(true);
    expect(Object.isFrozen(actions.value[0]?.bindings['route'])).toBe(true);

    (adapterSlice.visibleFacts.public.nested as string[]).push('adapter-mutated');
    (adapterActions[0]!.bindings.route as string[]).push('n:hidden');
    expect(slice.value.visibleFacts['public']).toEqual({ nested: ['safe'] });
    expect(actions.value[0]?.bindings['route']).toEqual(['n:visible']);
  });

  it('rejects malformed provenance, duplicate refs and adapter exceptions instead of publishing an unsafe slice', () => {
    const malformed = new RestrictedAIReadGateway({
      readAuthority: (agent) => ({ ok: true, value: { agent, controlledEntities: [{ $: 'e:npc' }], omniscient: false } }),
      versions: () => ({ ok: true, value: { knowledge: 'k:1', actions: 'a:1' } }),
      isCurrent: () => true,
      buildBeliefSlice: (authority) => ({
        ok: true,
        value: {
          agent: authority.agent,
          visibleFacts: {},
          knownFacts: { leaked: { value: 'secret' } },
          visibleRefs: [{ $: 'e:npc' }, { $: 'e:npc' }],
          policyContext: {},
        } as never,
      }),
      queryVisible: () => {
        throw new Error('visibility adapter failed');
      },
      queryActions: () => ({ ok: true, value: [] }),
    });
    const opened = malformed.openReadScope({ $: 'g:npc' });
    if (!opened.ok) throw new Error(opened.detail);
    expect(opened.value.beliefSlice()).toMatchObject({ ok: false, code: 'AI_CONTRACT_UNAVAILABLE' });
    expect(opened.value.query({ from: 'entities', visibleTo: true })).toMatchObject({
      ok: false,
      code: 'AI_CONTRACT_UNAVAILABLE',
    });
  });

  it('Property: private Intent, container and foreign Knowledge markers never appear unless the validated adapter projects them', () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1, maxLength: 24 }),
      (secret) => {
        const privateSource = {
          hiddenIntent: `intent:${secret}`,
          opponentContainerItem: `item:${secret}`,
          foreignKnowledge: `knowledge:${secret}`,
        };
        const gateway = new RestrictedAIReadGateway({
          readAuthority: (agent) => ({ ok: true, value: { agent, controlledEntities: [{ $: 'e:npc' }], omniscient: false } }),
          versions: () => ({ ok: true, value: { knowledge: 'knowledge:scoped', actions: 'actions:scoped' } }),
          isCurrent: () => true,
          buildBeliefSlice: (authority) => {
            // The owning adapter can inspect its private source only to perform projection;
            // the bounded gateway receives no alias to it.
            void privateSource;
            return {
              ok: true,
              value: {
                agent: authority.agent,
                visibleFacts: { stance: 'ready' },
                knownFacts: {
                  lastSeen: { value: { $: 'n:old' }, observedAt: 1, certainty: 'historical' },
                },
                visibleRefs: [{ $: 'e:npc' }, { $: 'n:old' }],
                policyContext: {},
              },
            };
          },
          queryVisible: () => ({ ok: true, value: [{ $: 'e:npc' }] }),
          queryActions: () => ({ ok: true, value: [{ action: 'a:wait', bindings: {}, cost: [] }] }),
        });
        const opened = gateway.openReadScope({ $: 'g:npc' });
        if (!opened.ok) throw new Error(opened.detail);
        const slice = opened.value.beliefSlice();
        const actions = opened.value.queryActions({ $: 'e:npc' });
        if (!slice.ok) throw new Error(slice.detail);
        if (!actions.ok) throw new Error(actions.detail);
        const published = JSON.stringify({ slice: slice.value, actions: actions.value });
        expect(published).not.toContain(privateSource.hiddenIntent);
        expect(published).not.toContain(privateSource.opponentContainerItem);
        expect(published).not.toContain(privateSource.foreignKnowledge);
      },
    ), { numRuns: 200 });
  });

  it('fails closed when the owner has not frozen the read or behavior contract', () => {
    expect(new UnavailableAIReadGateway('missing visibility versioning').openReadScope({ $: 'g:npc' }))
      .toEqual({ ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'missing visibility versioning' });
    expect(new UnavailableBehaviorValidationGateway('missing base validator').resolveValidatedBinding({ $: 'd:behavior' }))
      .toEqual({ ok: false, code: 'AI_CONTRACT_UNAVAILABLE', detail: 'missing base validator' });
  });

  it('validates provenance and player-visible values without constraining internal metrics', () => {
    const acceptsInternal = new ValidatedBehaviorGateway(() => ({
      ok: true,
      value: validBinding({
        parameters: [{
          path: 'search.maxNodes',
          value: 99,
          schema: { $: 'd:budget' },
          owner: 'play-configuration',
          playerVisible: false,
          internalMetric: true,
        }],
      }),
    }));
    expect(acceptsInternal.resolveValidatedBinding({ $: 'd:behavior' }).ok).toBe(true);

    const rejectsOutOfRange = new ValidatedBehaviorGateway(() => ({
      ok: true,
      value: validBinding({ parameters: [{ ...validBinding().parameters[0]!, value: 6 }] }),
    }));
    expect(rejectsOutOfRange.resolveValidatedBinding({ $: 'd:behavior' }))
      .toMatchObject({ ok: false, code: 'AI_PLAY_CONFIGURATION_REQUIRED' });

    const rejectsAmbiguous = new ValidatedBehaviorGateway(() => ({
      ok: true,
      value: validBinding({ parameters: [{ ...validBinding().parameters[0]!, internalMetric: true }] }),
    }));
    expect(rejectsAmbiguous.resolveValidatedBinding({ $: 'd:behavior' }))
      .toMatchObject({ ok: false, code: 'AI_POLICY_BINDING_INVALID' });
  });

  it('does not place full-state or write-channel types in the formal public API', () => {
    const publicFiles = ['../types.ts', '../read-gateway.ts', '../behavior-validation.ts'];
    for (const relativePath of publicFiles) {
      const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
      expect(source).not.toMatch(/from ['"][^'"]*(?:world-state|ops\/registry|ops\/transaction)/);
      expect(source).not.toMatch(/\bsetState\s*\(|\binvoke\s*\(/);
      expect(source).not.toMatch(/listLegalActions/);
    }
  });
});
