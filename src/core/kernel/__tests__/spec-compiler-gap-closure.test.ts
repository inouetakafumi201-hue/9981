import { describe, expect, it } from 'vitest';
import { TechnicalQuotaError } from '../spec-compiler/index';
import type { CompilationResult } from '../spec-compiler/index';
import type { Diagnostic } from '../state/diagnostic';
import { candidate, createHarness } from '../spec-compiler/__tests__/fixtures';
import type { Harness } from '../spec-compiler/__tests__/fixtures';

/**
 * Closure cases for the gaps found while auditing the compiler against the base-layer specification.
 *
 * Every case here is written to fail against the behaviour that existed before the corresponding fix, so
 * a regression shows up as a failing assertion rather than as a quietly weaker guarantee. Each block names
 * the requirement it defends.
 */
function doc(body: Record<string, unknown>, targetLayer = '基类层'): string {
  return JSON.stringify({ schemaVersion: '1.0.0', targetLayer, definitions: [], ...body });
}

function withDefinitions(definitions: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ schemaVersion: '1.0.0', targetLayer: '基类层', definitions });
}

function codesOf(result: CompilationResult): readonly string[] {
  return result.diagnostics.map((item) => item.code);
}

function diagnosticAt(result: CompilationResult, code: string): Diagnostic | undefined {
  return result.diagnostics.find((item) => item.code === code);
}

async function activate(harness: Harness, text: string): Promise<CompilationResult> {
  return await harness.compiler.compileAndActivate(candidate(text));
}

describe('numeric classification cannot be escaped through an unclassified region (R5.7, R2.5, R8.4)', () => {
  it('refuses a number inside an open object the schema does not classify', async () => {
    const harness = createHarness();
    // `rule.payload` is an open object with no member rule, so nothing classifies what goes inside it.
    // Before the fix the compiler never descended here and a concrete damage table activated cleanly.
    const result = await activate(harness, withDefinitions([
      { id: 'rule.a', kind: 'rule', iconRef: 'i', payload: { damageTable: 3 } },
    ]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result)).toContain('E_LOAD_NUMERIC_OWNERSHIP');
    expect(diagnosticAt(result, 'E_LOAD_NUMERIC_OWNERSHIP')?.path).toBe('/definitions/0/payload/damageTable');
    expect(harness.registry.getSnapshot().generation).toBe(0);
  });

  it('reaches a number nested several levels inside an unclassified region', async () => {
    const result = await activate(createHarness(), withDefinitions([
      { id: 'rule.a', kind: 'rule', iconRef: 'i', payload: { table: { head: [1, 'x'] } } },
    ]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(diagnosticAt(result, 'E_LOAD_NUMERIC_OWNERSHIP')?.path).toBe('/definitions/0/payload/table/head/0');
  });

  it('reaches a number inside an array element the schema leaves open', async () => {
    const result = await activate(createHarness(), withDefinitions([
      { id: 'item.a', kind: 'item', iconRef: 'i', accessories: [{ id: 'scope', power: 3 }] },
    ]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(diagnosticAt(result, 'E_LOAD_NUMERIC_OWNERSHIP')?.path).toBe('/definitions/0/accessories/0/power');
  });

  it('accepts an open region whose members the schema does classify', async () => {
    const harness = createHarness();
    // `item.payload` declares a member rule classifying numbers as internal metrics, which is how a host
    // permits free-form data without reopening the hole.
    const result = await activate(harness, withDefinitions([
      { id: 'item.a', kind: 'item', iconRef: 'i', payload: { ticks: 7, label: 'x' } },
    ]));

    expect(result.ok).toBe(true);
    expect(harness.registry.getSnapshot().generation).toBe(1);
  });

  it('still enforces the declared classification inside a governed open region', async () => {
    const result = await activate(createHarness(), withDefinitions([
      { id: 'item.a', kind: 'item', iconRef: 'i', payload: { ticks: 1.5 } },
    ]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // The member rule declares an integer internal metric, so a fractional value is refused there too.
    expect(diagnosticAt(result, 'E_LOAD_FIELD_TYPE')?.path).toBe('/definitions/0/payload/ticks');
  });
});

describe('a registered semantic family cannot be silently redefined (R4.2, R4.3)', () => {
  const proposal = (over: Record<string, unknown>): string => doc({
    semanticFamilies: [{
      id: 'weapon', allowedKinds: ['item'], classificationReason: '武器类型可枚举、可与谱型组合，且不绑定具体玩法。',
      criteria: { enumerable: true, composable: true, gameplayIndependent: true }, ...over,
    }],
  });

  it('refuses a proposal that widens an already registered family', async () => {
    const harness = createHarness();
    // Before the fix this overwrote the host registration, so every family-typed reference downstream was
    // judged against a contract the host never agreed to.
    const result = await activate(harness, proposal({ allowedKinds: ['item', 'rule'] }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result)).toContain('E_LOAD_SCHEMA_CONTRACT');
    expect(harness.registry.getSnapshot().generation).toBe(0);
  });

  it('refuses a proposal that keeps the identifier but changes the classification reason', async () => {
    const result = await activate(createHarness(), proposal({ classificationReason: '换个说法。' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result)).toContain('E_LOAD_SCHEMA_CONTRACT');
  });

  it('accepts an identical re-declaration, so re-stating the listing is idempotent', async () => {
    const harness = createHarness();
    const result = await activate(harness, proposal({}));

    expect(result.ok).toBe(true);
    expect(codesOf(result)).not.toContain('E_LOAD_SCHEMA_CONTRACT');
    expect(harness.registry.getSnapshot().model?.semanticFamilies['weapon']?.allowedKinds).toEqual(['item']);
  });

  it('still accepts a genuinely new family that meets the three criteria', async () => {
    const harness = createHarness();
    const result = await activate(harness, doc({
      semanticFamilies: [{
        id: 'container', allowedKinds: ['item'], classificationReason: '容器能力可枚举、可组合，不含具体玩法。',
        criteria: { enumerable: true, composable: true, gameplayIndependent: true },
      }],
    }));

    expect(result.ok).toBe(true);
    expect(harness.registry.getSnapshot().model?.semanticFamilies['container']).toBeDefined();
  });
});

describe('decided statements and open items survive the next activation (R1.4, R1.5, R16.9)', () => {
  it('keeps a statement decided by an earlier package', async () => {
    const harness = createHarness();
    expect((await activate(harness, doc({ statements: [{ key: 'gateway.kinds', value: 'three' }] }))).ok).toBe(true);

    // A second package that says nothing about the key must not erase it. Before the fix the model was
    // rebuilt from the current document alone, so every previously decided contract silently vanished.
    const second = await activate(harness, withDefinitions([{ id: 'rule.a', kind: 'rule', iconRef: 'i' }]));

    expect(second.ok).toBe(true);
    const model = harness.registry.getSnapshot().model;
    expect(model?.normativeStatements['gateway.kinds']?.value).toBe('three');
    expect(model?.definitions['rule.a']).toBeDefined();
  });

  it('keeps an unresolved item open across activations', async () => {
    const harness = createHarness();
    expect((await activate(harness, doc({
      statements: [
        { key: 'topology.connectionLimit', value: 5 },
        { key: 'topology.connectionLimit', value: 4 },
      ],
    }))).ok).toBe(true);
    expect(harness.registry.getSnapshot().model?.unresolvedItems.map((item) => item.key))
      .toEqual(['topology.connectionLimit']);

    const second = await activate(harness, withDefinitions([{ id: 'rule.a', kind: 'rule', iconRef: 'i' }]));
    expect(second.ok).toBe(true);
    expect(harness.registry.getSnapshot().model?.unresolvedItems.map((item) => item.key))
      .toEqual(['topology.connectionLimit']);
  });

  it('keeps withholding a bound that cites an item an earlier package left undecided', async () => {
    const harness = createHarness();
    expect((await activate(harness, doc({
      statements: [
        { key: 'topology.connectionLimit', value: 5 },
        { key: 'topology.connectionLimit', value: 4 },
      ],
    }))).ok).toBe(true);

    // The bound arrives in a later package that does not restate the conflict. It must still be refused,
    // otherwise an undecided question becomes usable simply because the next document stayed silent.
    const second = await activate(harness, withDefinitions([
      { id: 'item.a', kind: 'item', iconRef: 'i', connectionLimit: 5 },
    ]));

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(codesOf(second)).toContain('E_LOAD_UNRESOLVED_NORMATIVE');
    expect(harness.registry.getSnapshot().generation).toBe(1);
  });

  it('lets an authoritative decision close a carried-over open item', async () => {
    const harness = createHarness();
    await activate(harness, doc({
      statements: [
        { key: 'topology.connectionLimit', value: 5 },
        { key: 'topology.connectionLimit', value: 4 },
      ],
    }));

    const decided = await activate(harness, doc({
      statements: [{ key: 'topology.connectionLimit', value: 5, decisionId: 'D-021' }],
    }));

    expect(decided.ok).toBe(true);
    const model = harness.registry.getSnapshot().model;
    expect(model?.unresolvedItems).toEqual([]);
    expect(model?.normativeStatements['topology.connectionLimit']?.value).toBe(5);
  });
});

describe('an activated statement cannot be rewritten without a decision (R16.11)', () => {
  it('refuses a different value with no decision identifier and keeps the old one', async () => {
    const harness = createHarness();
    expect((await activate(harness, doc({ statements: [{ key: 'k', value: 'a' }] }))).ok).toBe(true);

    const rewrite = await activate(harness, doc({ statements: [{ key: 'k', value: 'b' }] }));

    expect(rewrite.ok).toBe(false);
    if (rewrite.ok) return;
    expect(codesOf(rewrite)).toContain('E_LOAD_NORMATIVE_WITHOUT_PROVENANCE');
    expect(harness.registry.getSnapshot().model?.normativeStatements['k']?.value).toBe('a');
  });

  it('accepts a different value when a decision identifier is recorded', async () => {
    const harness = createHarness();
    await activate(harness, doc({ statements: [{ key: 'k', value: 'a' }] }));
    const rewrite = await activate(harness, doc({ statements: [{ key: 'k', value: 'b', decisionId: 'D-022' }] }));

    expect(rewrite.ok).toBe(true);
    expect(harness.registry.getSnapshot().model?.normativeStatements['k']?.value).toBe('b');
  });

  it('treats an identical re-statement as a no-op', async () => {
    const harness = createHarness();
    await activate(harness, doc({ statements: [{ key: 'k', value: 'a' }] }));
    const again = await activate(harness, doc({ statements: [{ key: 'k', value: 'a' }] }));

    expect(again.ok).toBe(true);
    expect(codesOf(again)).not.toContain('E_LOAD_NORMATIVE_WITHOUT_PROVENANCE');
  });
});

describe('a required field may be satisfied by inheritance or composition (R3.6, R3.2)', () => {
  it('accepts a child that inherits the required field from its parent', async () => {
    const harness = createHarness();
    // Before the fix presence was checked on the raw definition, so a correct child that inherits the
    // field was rejected as incomplete.
    const result = await activate(harness, withDefinitions([
      { id: 'node.base', kind: 'node', parentScene: 'scene.town', typeIdentity: { invariants: ['b'] } },
      { id: 'node.child', kind: 'node', extends: ['node.base'], typeIdentity: { invariants: ['c'] } },
    ]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codesOf(result)).not.toContain('E_LOAD_REQUIRED_FIELD');
    expect(harness.registry.getSnapshot().model?.resolvedDefinitions['node.child']?.fields['parentScene'])
      .toBe('scene.town');
  });

  it('accepts a host that receives the required field from a component', async () => {
    const result = await activate(createHarness(), withDefinitions([
      { id: 'node.part', kind: 'node', parentScene: 'scene.town' },
      { id: 'node.host', kind: 'node', components: ['node.part'] },
    ]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(codesOf(result)).not.toContain('E_LOAD_REQUIRED_FIELD');
  });

  it('still refuses a definition where nothing supplies the required field', async () => {
    const harness = createHarness();
    const result = await activate(harness, withDefinitions([{ id: 'node.a', kind: 'node' }]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(diagnosticAt(result, 'E_LOAD_REQUIRED_FIELD')?.path).toBe('/definitions/0/parentScene');
    expect(harness.registry.getSnapshot().generation).toBe(0);
  });

  it('does not shadow an inherited presentation value with a fallback', async () => {
    const harness = createHarness();
    const result = await activate(harness, withDefinitions([
      { id: 'item.base', kind: 'item', iconRef: 'icon:parent', typeIdentity: { invariants: ['b'] } },
      { id: 'item.child', kind: 'item', extends: ['item.base'], typeIdentity: { invariants: ['c'] } },
    ]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Announcing a fallback here would be wrong twice: nothing is missing, and writing the placeholder onto
    // the child would override the icon the parent actually declares.
    expect(codesOf(result)).not.toContain('E_LOAD_PRESENTATION_FALLBACK');
    expect(harness.registry.getSnapshot().model?.resolvedDefinitions['item.child']?.fields['iconRef'])
      .toBe('icon:parent');
  });
});

describe('a damaged presentation field degrades, a damaged semantic field does not (R11.11, R13.11, R14.9)', () => {
  it('degrades a wrongly typed presentation field to the registered fallback and activates', async () => {
    const harness = createHarness();
    // Before the fix this was a hard schema error, which contradicts the error-handling contract: a
    // presentation defect must not block a release when a type-compatible fallback exists.
    const result = await activate(harness, withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 5 }]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const fallback = diagnosticAt(result, 'E_LOAD_PRESENTATION_FALLBACK');
    expect(fallback?.severity).toBe('warn');
    expect(fallback?.path).toBe('/definitions/0/iconRef');
    expect(codesOf(result)).not.toContain('E_LOAD_FIELD_TYPE');
    // The announced fallback is the value actually published, not just a message.
    expect(harness.registry.getSnapshot().model?.definitions['item.a']?.value['iconRef'])
      .toBe('icon:placeholder');
  });

  it('publishes the fallback for a required presentation field that is absent', async () => {
    const harness = createHarness();
    const result = await activate(harness, withDefinitions([{ id: 'item.a', kind: 'item' }]));

    expect(result.ok).toBe(true);
    expect(harness.registry.getSnapshot().model?.definitions['item.a']?.value['iconRef'])
      .toBe('icon:placeholder');
  });

  it('refuses a damaged presentation field that has no registered fallback', async () => {
    const harness = createHarness();
    // `displayName` is presentation but has no fallback, so there is nothing type-compatible to degrade to
    // and inventing one would be the silent repair the contract forbids.
    const result = await activate(harness, withDefinitions([
      { id: 'item.a', kind: 'item', iconRef: 'i', displayName: 5 },
    ]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(diagnosticAt(result, 'E_LOAD_FIELD_TYPE')?.path).toBe('/definitions/0/displayName');
    expect(harness.registry.getSnapshot().generation).toBe(0);
  });

  it('never degrades a semantic field, whatever fallback exists elsewhere', async () => {
    const harness = createHarness();
    const result = await activate(harness, withDefinitions([
      { id: 'item.a', kind: 'item', iconRef: 'i', damageProfile: 5 },
    ]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(diagnosticAt(result, 'E_LOAD_FIELD_TYPE')?.path).toBe('/definitions/0/damageProfile');
    expect(codesOf(result)).not.toContain('E_LOAD_PRESENTATION_FALLBACK');
  });
});

describe('lineage resolution stays affordable on a shared-ancestor lattice (R3.10)', () => {
  it('resolves a wide diamond lattice instead of re-expanding every path', async () => {
    // Each definition extends the previous two, so the number of *paths* to the root grows like Fibonacci.
    // Without a memo the walk visits every path: at 44 definitions that is on the order of 10^9 visits and
    // the compiler hangs instead of answering. With one shared memo the work is linear in the edges.
    const definitions: Record<string, unknown>[] = [
      { id: 'item.d0', kind: 'item', iconRef: 'i', typeIdentity: { invariants: ['i0'] } },
      { id: 'item.d1', kind: 'item', extends: ['item.d0'], typeIdentity: { invariants: ['i1'] } },
    ];
    for (let index = 2; index < 44; index++) {
      definitions.push({
        id: `item.d${index}`, kind: 'item',
        extends: [`item.d${index - 1}`, `item.d${index - 2}`],
        typeIdentity: { invariants: [`i${index}`] },
      });
    }

    const harness = createHarness();
    const result = await activate(harness, withDefinitions(definitions));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lineage = harness.registry.getSnapshot().model?.resolvedDefinitions['item.d43']?.lineage ?? [];
    // Every ancestor appears exactly once, and the root comes first.
    expect(lineage.length).toBe(44);
    expect(new Set(lineage).size).toBe(44);
    expect(lineage[0]).toBe('item.d0');
    expect(lineage[lineage.length - 1]).toBe('item.d43');
  }, 20_000);
});

describe('an unsearchable dependency graph is refused, not declared cycle-free (R12.5)', () => {
  const selfDependent = JSON.stringify({
    schemaVersion: '1.0.0', targetLayer: '基类层', definitions: [], dependencies: ['pkg.main'],
  });

  async function activateBase(harness: Harness): Promise<void> {
    await activate(harness, withDefinitions([{ id: 'rule.a', kind: 'rule', iconRef: 'i' }]));
  }

  it('reports the cycle when the search budget is sufficient', async () => {
    const harness = createHarness();
    await activateBase(harness);
    const result = await activate(harness, selfDependent);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codesOf(result)).toContain('E_LOAD_CYCLE_DEP');
  });

  it('refuses the same document when the budget runs out mid-search', async () => {
    const harness = createHarness({ quotas: { packageDependencyEdges: 1 } });
    await activateBase(harness);
    const result = await activate(harness, selfDependent);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Before the fix the walk returned quietly and the cycle went unreported, so a graph too large to
    // search was published as if it were acyclic.
    expect(codesOf(result)).toContain('E_QUOTA_TRAVERSAL_WORK');
    expect(harness.registry.getSnapshot().generation).toBe(1);
  });
});

describe('an unusable quota set is a host defect surfaced before any input is read (R5.12)', () => {
  const broken: readonly { readonly label: string; readonly quotas: Record<string, number> }[] = [
    { label: 'zero traversal work', quotas: { traversalWork: 0 } },
    { label: 'negative definition count', quotas: { definitions: -1 } },
    { label: 'fractional nesting depth', quotas: { nestingDepth: 1.5 } },
    { label: 'non-finite output budget', quotas: { outputBytes: Number.POSITIVE_INFINITY } },
    { label: 'not a number at all', quotas: { diagnostics: Number.NaN } },
  ];

  for (const { label, quotas } of broken) {
    it(`refuses to construct a compiler with ${label}`, () => {
      // A quota that cannot bound a countdown makes every traversal limit undefined behaviour, so this has
      // to fail loudly at construction rather than produce a compiler that stops for unexplainable reasons.
      expect(() => createHarness({ quotas })).toThrow(TechnicalQuotaError);
    });
  }

  it('accepts the default quota set', () => {
    expect(() => createHarness()).not.toThrow();
  });
});

/**
 * The deprecated terms are written as escapes on purpose.
 *
 * A repository-wide scan rejects these words appearing literally in source, which is what keeps them from
 * creeping back into the architecture vocabulary. Spelling them out here would trip that scan, so the test
 * carries the same escaped form the rejection dictionary uses.
 */
const DEPRECATED_TERMS: readonly string[] = Object.freeze([
  '\u5185\u5bb9\u5c42',
  '\u6a21\u677f',
  '\u6a21\u677f\u5c42',
  '\u6a21\u677f\u7c7b\u578b',
  '\u73a9\u6cd5\u5305\u5c42',
  '\u5bf9\u8c61',
]);

describe('deprecated architecture terms are refused as modelling terms (R1.7)', () => {
  for (const term of DEPRECATED_TERMS) {
    it(`refuses ${term} in a normative definition`, async () => {
      const harness = createHarness();
      const result = await activate(harness, withDefinitions([
        { id: 'item.a', kind: 'item', iconRef: 'i', term },
      ]));

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(codesOf(result)).toContain('E_LOAD_TERM_NONCANONICAL');
      expect(harness.registry.getSnapshot().generation).toBe(0);
    });
  }

  it('accepts the canonical terms', async () => {
    for (const term of ['引擎层', '基类层', '玩法层', '实例', '基类']) {
      const result = await activate(createHarness(), withDefinitions([
        { id: 'item.a', kind: 'item', iconRef: 'i', term },
      ]));
      expect(result.ok, term).toBe(true);
    }
  });
});

describe('a rejection hands back the evidence that nothing changed (R13.4, R15.17)', () => {
  it('returns a canonical snapshot equal to the one held before the attempt', async () => {
    const harness = createHarness();
    expect((await activate(harness, withDefinitions([{ id: 'rule.a', kind: 'rule', iconRef: 'i' }]))).ok).toBe(true);
    const before = harness.registry.canonicalSnapshot();

    const rejected = await activate(harness, '{"schemaVersion":"1.0.0",}');

    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.canonicalSnapshot).toEqual(before);
  });

  it('returns the newly published snapshot on success', async () => {
    const harness = createHarness();
    const result = await activate(harness, withDefinitions([{ id: 'rule.a', kind: 'rule', iconRef: 'i' }]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.canonicalSnapshot).toEqual(harness.registry.canonicalSnapshot());
    expect(result.canonicalSnapshot.generation).toBe(1);
  });

  it('returns the unchanged snapshot from a draft, which publishes nothing', async () => {
    const harness = createHarness();
    const before = harness.registry.canonicalSnapshot();
    const draft = await harness.compiler.compileDraft(
      candidate(withDefinitions([{ id: 'rule.a', kind: 'rule', iconRef: 'i' }])));

    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.canonicalSnapshot).toEqual(before);
  });
});
