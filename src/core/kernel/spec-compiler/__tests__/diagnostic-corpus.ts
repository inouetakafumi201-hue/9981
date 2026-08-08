import { createHash } from 'node:crypto';
import type { Diagnostic, SourceRecord } from '../../state/diagnostic.js';
import type {
  CandidateDocumentInput, CompilationResult, CompilerMode, TechnicalQuotas,
} from '../index.js';
import type { CreatorMessageBundle } from '../index.js';
import { candidate, createHarness } from './fixtures.js';
import type { Harness } from './fixtures.js';

export interface CorpusCase {
  /** Stable label used in assertion messages so a failure names the scenario. */
  readonly label: string;
  /** Candidate text handed to the compiler. */
  readonly text: string;
  readonly overrides?: Partial<CandidateDocumentInput>;
  /** Prepares registry state (for example an already-activated generation). */
  readonly prepare?: (harness: Harness) => Promise<void>;
  readonly quotas?: Partial<TechnicalQuotas>;
  readonly versions?: readonly string[];
  readonly mode?: CompilerMode;
}

/** Provenance for a host-registered migration edge; not creator input, so a zero-width span is correct. */
export function hostSourceRecord(id: string): SourceRecord {
  return {
    sourceId: id,
    documentUri: `file:///${id}.json`,
    sourcePackage: 'pkg.host',
    contentHash: createHash('sha256').update('', 'utf8').digest('hex'),
    precedence: 500,
    owningLayer: '引擎层',
    normativeStatus: 'normative',
    span: {
      file: `file:///${id}.json`,
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
      sourceSliceHash: createHash('sha256').update('', 'utf8').digest('hex'),
    },
  };
}

function doc(body: Record<string, unknown>): string {
  return JSON.stringify({ schemaVersion: '1.0.0', targetLayer: '基类层', definitions: [], ...body });
}

function withDefinitions(definitions: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ schemaVersion: '1.0.0', targetLayer: '基类层', definitions });
}

/**
 * Scenario corpus covering every creator-facing failure family the compiler reports.
 *
 * It exists so the i18n, UGC-friendliness and property suites all assert against the *same* broad set of
 * real diagnostics rather than a handful of hand-picked happy cases. Adding a new diagnostic family here
 * automatically strengthens all three suites.
 */
export const DIAGNOSTIC_CORPUS: readonly CorpusCase[] = [
  { label: 'trailing comma', text: '{ "schemaVersion": "1.0.0", }' },
  { label: 'truncated document', text: '{"schemaVersion":"1.0.0"' },
  { label: 'unquoted field name', text: '{schemaVersion:"1.0.0"}' },
  { label: 'missing colon', text: '{"schemaVersion" "1.0.0"}' },
  { label: 'control character in string', text: doc({ s: 'a\u0001b' }) },
  { label: 'duplicate member', text: '{"schemaVersion":"1.0.0","schemaVersion":"1.0.0","targetLayer":"基类层","definitions":[]}' },
  { label: 'prohibited executable key', text: doc({ $eval: 'x' }) },
  { label: 'root is not an object', text: '[]' },
  { label: 'missing schemaVersion', text: '{"targetLayer":"基类层","definitions":[]}' },
  { label: 'unsupported schemaVersion', text: '{"schemaVersion":"9.9.9","targetLayer":"基类层","definitions":[]}' },
  { label: 'missing targetLayer', text: '{"schemaVersion":"1.0.0","definitions":[]}' },
  { label: 'illegal targetLayer', text: '{"schemaVersion":"1.0.0","targetLayer":"引擎层","definitions":[]}' },
  { label: 'unknown top-level field', text: doc({ unexpected: 1 }) },
  { label: 'definitions is not an array', text: '{"schemaVersion":"1.0.0","targetLayer":"基类层","definitions":{}}' },
];

/** Definition-scoped and semantic failures, appended so the list above stays readable. */
export const DEFINITION_CORPUS: readonly CorpusCase[] = [
  { label: 'unknown definition kind', text: withDefinitions([{ id: 'x.a', kind: 'nonesuch' }]) },
  { label: 'invalid identifier', text: withDefinitions([{ id: '!bad id', kind: 'item', iconRef: 'i' }]) },
  { label: 'missing identifier', text: withDefinitions([{ kind: 'item', iconRef: 'i' }]) },
  {
    label: 'duplicate identifier',
    text: withDefinitions([
      { id: 'item.a', kind: 'item', iconRef: 'i' },
      { id: 'item.a', kind: 'item', iconRef: 'i' },
    ]),
  },
  { label: 'unknown field on definition', text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 'i', bogus: 1 }]) },
  // A *semantic* field of the wrong type. A presentation field of the wrong type degrades to its registered
  // fallback instead, which is a separate case below.
  { label: 'wrong field type', text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 'i', damageProfile: 5 }]) },
  { label: 'damaged presentation field', text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 5 }]) },
  {
    label: 'damaged presentation field without a registered fallback',
    text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 'i', displayName: 5 }]),
  },
  {
    label: 'unclassified number in an open region',
    text: withDefinitions([{ id: 'rule.a', kind: 'rule', iconRef: 'i', payload: { damageTable: 3 } }]),
  },
  { label: 'abstract flag not boolean', text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 'i', abstract: 'yes' }]) },
  { label: 'deprecated field', text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 'i', volumeClass: 'big' }]) },
  { label: 'non-integer structural bound', text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 'i', slotCount: 1.5 }]) },
  {
    label: 'gameplay value outside 1-5 in class layer',
    text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 'i', damage: 9 }]),
  },
  {
    label: 'gameplay value in play layer but out of range',
    text: JSON.stringify({
      schemaVersion: '1.0.0', targetLayer: '玩法层',
      definitions: [{ id: 'item.a', kind: 'item', iconRef: 'i', damage: 42 }],
    }),
  },
  // `node` is the only fixture kind with a required semantic field, so this is the one case that can produce
  // a genuine missing-required-field rejection rather than a presentation fallback warning.
  { label: 'missing required field', text: withDefinitions([{ id: 'node.a', kind: 'node' }]) },
  { label: 'reference to missing definition', text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 'i', damageProfile: 'rule.ghost' }]) },
  {
    label: 'reference to wrong kind',
    text: withDefinitions([
      { id: 'item.b', kind: 'item', iconRef: 'i' },
      { id: 'item.a', kind: 'item', iconRef: 'i', damageProfile: 'item.b' },
    ]),
  },
  { label: 'parent does not exist', text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 'i', extends: ['item.ghost'] }]) },
  {
    label: 'inheritance cycle',
    text: withDefinitions([
      { id: 'item.a', kind: 'item', iconRef: 'i', extends: ['item.b'] },
      { id: 'item.b', kind: 'item', iconRef: 'i', extends: ['item.a'] },
    ]),
  },
  { label: 'extends is not a string array', text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 'i', extends: [1] }]) },
  { label: 'unordered collection without identity', text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 'i', accessories: [{ name: 'scope' }] }]) },
  { label: 'non-canonical terminology', text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 'i', term: '\u6a21\u677f' }]) },
];

const ACTIVATED_DOCUMENT = withDefinitions([{ id: 'item.shotgun', kind: 'item', iconRef: 'icon:shotgun' }]);

/** Statement, authority and activation failures, including cases that need pre-existing state. */
export const STATEFUL_CORPUS: readonly CorpusCase[] = [
  { label: 'statements is not an array', text: doc({ statements: {} }) },
  { label: 'statement without key', text: doc({ statements: [{ value: 1 }] }) },
  {
    label: 'equal precedence conflict',
    text: doc({ statements: [{ key: 'k', value: 'a' }, { key: 'k', value: 'b' }] }),
  },
  {
    label: 'displaced lower precedence statement',
    text: doc({ statements: [{ key: 'k', value: 'a', precedence: 100 }, { key: 'k', value: 'b', precedence: 50 }] }),
  },
  {
    label: 'historical statement carries no effect',
    text: doc({ statements: [{ key: 'k', value: 'a', status: 'historical' }] }),
  },
  {
    label: 'unresolved statement',
    text: doc({ statements: [{ key: 'k', value: 'a', status: 'unresolved' }] }),
  },
  {
    label: 'statement authority promotion',
    text: doc({ statements: [{ key: 'k', value: 'a', status: 'normative' }] }),
    overrides: { normativeStatus: 'historical' },
  },
  {
    label: 'statement claims more precedence than its document',
    text: doc({ statements: [{ key: 'k', value: 'a', precedence: 100000 }] }),
  },
  {
    label: 'reused decision identifier',
    text: doc({ statements: [{ key: 'k1', value: 'a', decisionId: 'Q-1' }, { key: 'k2', value: 'b', decisionId: 'Q-1' }] }),
  },
  {
    label: 'redefining an active id without override',
    text: ACTIVATED_DOCUMENT,
    prepare: async (harness) => { await harness.compiler.compileAndActivate(candidate(ACTIVATED_DOCUMENT)); },
  },
  { label: 'newer schema than supported', text: '{"schemaVersion":"0.0.1","targetLayer":"基类层","definitions":[]}' },
  {
    label: 'successful migration rebases reported positions',
    versions: ['1.0.0', '2.0.0'],
    text: '{"schemaVersion":"0.9.0","targetLayer":"基类层","definitions":[]}',
    prepare: async (harness) => {
      harness.migrationRegistry.register({
        id: 'mig.corpus',
        fromVersion: '0.9.0',
        toVersion: '2.0.0',
        source: hostSourceRecord('migration'),
        transform: (value) => ({ ...(value as Record<string, unknown>), schemaVersion: '2.0.0' } as never),
      });
    },
  },
  {
    label: 'migration path is missing',
    versions: ['1.0.0', '2.0.0'],
    text: '{"schemaVersion":"0.5.0","targetLayer":"基类层","definitions":[]}',
  },
];

const IDENTITY = { requiredCapabilities: ['fire'] };

/**
 * Inheritance, composition, family and change-set failures.
 *
 * These are the diagnostics a creator meets while restructuring content rather than while typing it, and
 * they are the easiest ones to leave unreadable, so the corpus covers them alongside the syntax cases.
 */
export const RESOLUTION_CORPUS: readonly CorpusCase[] = [
  {
    label: 'child repeats the parent type identity',
    text: withDefinitions([
      { id: 'item.base', kind: 'item', iconRef: 'i', typeIdentity: IDENTITY },
      { id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.base'], typeIdentity: IDENTITY },
    ]),
  },
  {
    label: 'child declares no type identity at all',
    text: withDefinitions([
      { id: 'item.base', kind: 'item', iconRef: 'i', typeIdentity: IDENTITY },
      { id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.base'] },
    ]),
  },
  {
    label: 'two inherited branches claim one field',
    text: withDefinitions([
      { id: 'item.left', kind: 'item', iconRef: 'i', typeIdentity: { invariants: ['a'] }, traits: ['x'] },
      { id: 'item.right', kind: 'item', iconRef: 'i', typeIdentity: { invariants: ['b'] }, traits: ['y'] },
      {
        id: 'item.child', kind: 'item', iconRef: 'i', extends: ['item.left', 'item.right'],
        typeIdentity: { invariants: ['c'] },
      },
    ]),
  },
  {
    label: 'two components claim one field',
    text: withDefinitions([
      { id: 'item.left', kind: 'item', iconRef: 'i', traits: ['x'] },
      { id: 'item.right', kind: 'item', iconRef: 'i', traits: ['y'] },
      { id: 'item.host', kind: 'item', iconRef: 'i', components: ['item.left', 'item.right'] },
    ]),
  },
  {
    label: 'merge rule resolves nothing',
    text: withDefinitions([
      { id: 'item.host', kind: 'item', iconRef: 'i', mergeRules: { traits: { strategy: 'prefer', source: 'item.host' } } },
    ]),
  },
  {
    label: 'unregistered semantic family',
    text: withDefinitions([{ id: 'item.a', kind: 'item', iconRef: 'i', semanticFamily: 'not-registered' }]),
  },
  {
    label: 'semantic family coupled to one gameplay profile',
    text: JSON.stringify({
      schemaVersion: '1.0.0', targetLayer: '基类层', definitions: [],
      semanticFamilies: [{
        id: 'battle-royale-zone', allowedKinds: ['item'], classificationReason: '只服务一种玩法。',
        criteria: { enumerable: true, composable: true, gameplayIndependent: false },
      }],
    }),
  },
  {
    label: 'package dependency is not activated',
    text: JSON.stringify({
      schemaVersion: '1.0.0', targetLayer: '基类层', definitions: [], dependencies: ['pkg.absent'],
    }),
  },
  {
    label: 'removal leaves an inbound reference',
    text: JSON.stringify({
      schemaVersion: '1.0.0', targetLayer: '基类层', definitions: [], removals: ['rule.damage.basic'],
    }),
    prepare: async (harness) => {
      await harness.compiler.compileAndActivate(candidate(withDefinitions([
        { id: 'rule.damage.basic', kind: 'rule', iconRef: 'icon:rule' },
        { id: 'item.shotgun', kind: 'item', iconRef: 'i', damageProfile: 'rule.damage.basic' },
      ])));
    },
  },
  {
    label: 'bound cites a statement nobody decided',
    text: JSON.stringify({
      schemaVersion: '1.0.0', targetLayer: '基类层',
      definitions: [{ id: 'item.a', kind: 'item', iconRef: 'i', connectionLimit: 5 }],
      statements: [
        { key: 'topology.connectionLimit', value: 5 },
        { key: 'topology.connectionLimit', value: 4 },
      ],
    }),
  },
  {
    label: 'undecided statement promoted without a decision',
    text: doc({ statements: [{ key: 'k', value: 'a' }] }),
    prepare: async (harness) => {
      await harness.compiler.compileAndActivate(candidate(
        doc({ statements: [{ key: 'k', value: 'a', status: 'unresolved' }] })));
    },
  },
  {
    label: 'change set switches the owning layer',
    text: JSON.stringify({ schemaVersion: '1.0.0', targetLayer: '玩法层', definitions: [] }),
    prepare: async (harness) => {
      await harness.compiler.compileAndActivate(candidate(withDefinitions([
        { id: 'rule.a', kind: 'rule', iconRef: 'i' },
      ])));
    },
  },
];

export const FULL_CORPUS: readonly CorpusCase[] = [
  ...DIAGNOSTIC_CORPUS,
  ...DEFINITION_CORPUS,
  ...STATEFUL_CORPUS,
  ...RESOLUTION_CORPUS,
];

export interface CorpusOutcome {
  readonly label: string;
  readonly result: CompilationResult;
  readonly harness: Harness;
}

/** Runs one scenario and returns both the result and the harness so state can be asserted afterwards. */
export async function runCase(item: CorpusCase, bundle?: CreatorMessageBundle): Promise<CorpusOutcome> {
  const harness = createHarness({
    ...(item.versions ? { versions: item.versions } : {}),
    ...(item.quotas ? { quotas: item.quotas } : {}),
    ...(bundle ? { bundle } : {}),
  });
  await item.prepare?.(harness);
  const input = candidate(item.text, item.overrides ?? {});
  const result = item.mode === 'SAFE_DRAFT'
    ? await harness.compiler.compileDraft(input)
    : await harness.compiler.compileAndActivate(input);
  return { label: item.label, result, harness };
}

/** Every diagnostic produced by the whole corpus, flattened for corpus-wide invariants. */
export async function collectDiagnostics(
  cases: readonly CorpusCase[] = FULL_CORPUS,
  bundle?: CreatorMessageBundle,
): Promise<readonly { readonly label: string; readonly diagnostic: Diagnostic }[]> {
  const collected: { label: string; diagnostic: Diagnostic }[] = [];
  for (const item of cases) {
    const outcome = await runCase(item, bundle);
    for (const diagnostic of outcome.result.diagnostics) {
      collected.push({ label: outcome.label, diagnostic });
    }
  }
  return collected;
}
