import { describe, expect, it } from 'vitest';
import { StrictJsonCodec } from '../../spec-compiler/json-codec';
import { DEFAULT_TECHNICAL_QUOTAS } from '../../spec-compiler/types';
import type { ParsedCandidateDocument } from '../../spec-compiler/types';
import { decodePlaypack } from '../playpack-codec';

function parsed(value: unknown): ParsedCandidateDocument {
  return new StrictJsonCodec().parse({
    sourceId: 'playpack:test',
    documentUri: 'file:///playpack.test.json',
    sourcePackage: 'playpack.test',
    sourceText: JSON.stringify(value),
    precedence: 1,
    owningLayer: '玩法层',
    normativeStatus: 'normative',
  }, DEFAULT_TECHNICAL_QUOTAS);
}

function validPlaypack(): Record<string, unknown> {
  return {
    id: 'pp:strict',
    kind: 'playpack',
    version: '1.0.0',
    extends: ['pp:base'],
    abstract: false,
    tags: ['test'],
    props: { enabled: true, nested: [1, null, { safe: 'json' }] },
    rules: ['rule:turn'],
    schedule: 'schedule:main',
    pools: [
      { name: 'world-ap', per: 'world', max: { op: 'add', args: [2, 3] }, reset: 'phase' },
      { name: 'actor-ap', per: 'actor', reset: { call: 'expr:reset', args: { actor: { var: 'actor' } } } },
    ],
    conflicts: ['pp:legacy'],
    visibility: 'expr:visibility',
    logRetention: { phases: 5, max: 100 },
    outcomes: [{
      name: 'victory',
      when: { q: { from: 'entities', where: { op: 'eq', args: [{ path: 'props.hp' }, 0] }, limit: 1 } },
      scope: 'game',
      rank: 1,
      onReach: [{ emit: 'game.victory', data: { path: 'winner' } }],
      ends: true,
    }],
    evaluate: { call: 'expr:evaluate' },
    policies: ['policy:default'],
    entry: [{ op: 'world.start', args: { seed: 1 }, result: 'started' }],
    requires: ['pp:base'],
    hookOrder: ['rule:turn'],
    overrides: { 'expr:old': 'expr:new' },
    defs: [
      {
        id: 'action:complete',
        kind: 'action',
        label: 'Complete action',
        track: 'card',
        targets: [{
          name: 'target',
          query: { from: 'entities', visibleTo: { var: 'viewer' }, orderBy: { path: 'id' }, desc: false },
          range: { min: 1, max: 5, step: 1 },
          count: { min: 1, max: 2 },
          optional: false,
        }],
        require: true,
        visible: { path: 'visible' },
        reason: 'available',
        cost: [
          { pool: 'actor-ap', amount: 1 },
          { items: { q: { from: 'items', in: { var: 'actor' } } } },
          { attach: 'attachment:marker' },
          { custom: [{ emit: 'cost.paid' }] },
        ],
        group: 'main',
        effects: [
          { op: 'prop.set', args: { target: { $: 'e:1' }, value: 1 }, result: 'changed' },
          { let: 'selected', be: { var: 'target' } },
          { if: true, then: [{ emit: 'yes' }], else: [{ emit: 'no' }] },
          { forEach: [1, 2], as: 'item', do: [{ emit: 'each', data: { var: 'item' } }] },
          { while: { path: 'running' }, do: [{ emit: 'tick' }], maxIter: 5 },
          { emit: 'plain' },
          { after: 1, do: [{ emit: 'later' }] },
          { at: 3, do: [{ emit: 'scheduled' }] },
          { try: [{ emit: 'attempt' }], catch: [{ emit: 'recover' }] },
          { abort: 'finished' },
        ],
      },
      {
        id: 'rule:turn',
        kind: 'rule',
        on: ['turn.start', 'turn.resume'],
        phase: 'before',
        when: true,
        priority: 1,
        effects: [{ emit: 'rule.fired' }],
        once: false,
      },
      {
        id: 'attachment:marker',
        kind: 'attachment',
        stackStrategy: 'refresh',
        maxStack: 1,
        aura: { deps: ['expr:visibility'], compute: { path: 'owner' } },
        onAdd: [{ emit: 'attachment.added' }],
        onExpire: [{ emit: 'attachment.expired' }],
        onRemove: [{ emit: 'attachment.removed' }],
      },
      {
        id: 'schedule:main',
        kind: 'schedule',
        phases: [{
          id: 'phase:submit',
          name: 'Submit',
          label: 'Submit phase',
          kind: 'action',
          phaseKind: 'submit',
          actors: { from: 'agents', where: true },
          input: 'all',
          reactionRounds: 1,
          duration: 1,
          timeLimit: 5,
          onEnter: [{ emit: 'phase.enter' }],
          onExit: [{ emit: 'phase.exit' }],
          timeoutSeconds: 30,
        }],
        loop: true,
        order: 'initiative',
        initiativeExpr: { path: 'initiative' },
        resolveOrder: { op: 'sort', args: [{ path: 'actors' }] },
        onConflict: [{ emit: 'schedule.conflict' }],
        roundEnd: [{ emit: 'round.end' }],
      },
      { id: 'expr:evaluate', kind: 'expr', params: ['state'], body: { var: 'state' }, pure: true },
      { id: 'entity:open', kind: 'entity', customData: { any: ['JSON', 2, false] } },
    ],
  };
}

function expectFailure(value: unknown, code: string, path?: string): void {
  const document = parsed(value);
  const result = decodePlaypack(document);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  const diagnostic = result.diagnostics.find((item) => item.code === code && (path === undefined || item.path === path));
  expect(diagnostic, `${code}${path ? ` at ${path}` : ''}`).toBeDefined();
  if (diagnostic?.path && document.locations.has(diagnostic.path)) {
    expect(diagnostic.sourceSpan).toEqual(document.locations.get(diagnostic.path)?.span);
  }
}

describe('pure JSON Playpack strict decoder', () => {
  it('decodes all playpack sections, key Def kinds, recursive Expr/Query, and all ten Effect forms', () => {
    const result = decodePlaypack(parsed(validPlaypack()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.id).toBe('pp:strict');
    expect(result.value.defs).toHaveLength(6);
    expect(result.value.entry).toEqual([{ op: 'world.start', args: { seed: 1 }, result: 'started' }]);
  });

  it('rejects a non-object root', () => {
    expectFailure([], 'E_LOAD_FIELD_TYPE', '');
  });

  it.each([
    ['id'],
    ['version'],
    ['defs'],
  ])('rejects missing required field %s', (field) => {
    const value = validPlaypack();
    delete value[field];
    expectFailure(value, 'E_LOAD_REQUIRED_FIELD', `/${field}`);
  });

  it('rejects a root whose kind is not playpack', () => {
    const value = validPlaypack();
    value['kind'] = 'action';
    expectFailure(value, 'E_LOAD_DEF_KIND', '/kind');
  });

  it('rejects an unrecognized Effect shape', () => {
    const value = validPlaypack();
    value['entry'] = [{ unknownEffect: true }];
    expectFailure(value, 'E_FLOW_UNKNOWN_EFFECT', '/entry/0');
  });

  it('rejects while Effect without maxIter using the dedicated flow error', () => {
    const value = validPlaypack();
    value['entry'] = [{ while: true, do: [] }];
    expectFailure(value, 'E_FLOW_NO_MAXITER', '/entry/0/maxIter');
  });

  it('explicitly rejects linter in a pure JSON playpack', () => {
    const value = validPlaypack();
    value['linter'] = 'not executable';
    expectFailure(value, 'E_LOAD_PROHIBITED_CONSTRUCT', '/linter');
  });

  it('rejects an invalid pool enum', () => {
    const value = validPlaypack();
    value['pools'] = [{ name: 'bad', per: 'team', reset: 'turn' }];
    expectFailure(value, 'E_LOAD_CROSS_FIELD_CONSTRAINT', '/pools/0/per');
  });

  it('rejects an invalid schedule phase enum', () => {
    const value = validPlaypack();
    value['defs'] = [{
      id: 'schedule:bad',
      kind: 'schedule',
      phases: [{ id: 'phase:bad', phaseKind: 'planning' }],
    }];
    expectFailure(value, 'E_LOAD_CROSS_FIELD_CONSTRAINT', '/defs/0/phases/0/phaseKind');
  });

  it('strictly rejects malformed recursive Expr and Query nodes', () => {
    const malformedExpr = validPlaypack();
    malformedExpr['evaluate'] = { op: 'add', args: { not: 'an array' } };
    expectFailure(malformedExpr, 'E_LOAD_FIELD_TYPE', '/evaluate/args');

    const malformedQuery = validPlaypack();
    malformedQuery['evaluate'] = { q: { from: 'unknown-source' } };
    expectFailure(malformedQuery, 'E_LOAD_CROSS_FIELD_CONSTRAINT', '/evaluate/q/from');
  });

  it('rejects invalid nested Effects and a non-string op result', () => {
    const nested = validPlaypack();
    nested['entry'] = [{ if: true, then: [{ invalid: true }] }];
    expectFailure(nested, 'E_FLOW_UNKNOWN_EFFECT', '/entry/0/then/0');

    const badResult = validPlaypack();
    badResult['entry'] = [{ op: 'world.start', args: {}, result: 1 }];
    expectFailure(badResult, 'E_LOAD_FIELD_TYPE', '/entry/0/result');
  });

  it('defensively rejects non-finite numbers even when a caller bypasses the JSON parser', () => {
    const document = parsed(validPlaypack());
    const unsafeDocument = {
      ...document,
      value: { ...validPlaypack(), evaluate: Number.POSITIVE_INFINITY },
    } as unknown as ParsedCandidateDocument;
    const result = decodePlaypack(unsafeDocument);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics.some((item) => item.code === 'E_INV_NAN_OR_INFINITY')).toBe(true);
  });

  it('attributes nested playpack diagnostics to the deepest containing definition', () => {
    const value = validPlaypack();
    value['defs'] = [{
      id: 'pp:nested',
      kind: 'playpack',
      version: '1.0.0',
      defs: [{ id: 'action:nested', kind: 'action', label: 'Nested', track: 'card', effects: [{ while: true, do: [] }] }],
    }];
    const result = decodePlaypack(parsed(value));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diagnostic = result.diagnostics.find((item) => item.code === 'E_FLOW_NO_MAXITER');
    expect(diagnostic?.path).toBe('/defs/0/defs/0/effects/0/maxIter');
    expect(diagnostic?.at?.def).toBe('action:nested');
  });
});
