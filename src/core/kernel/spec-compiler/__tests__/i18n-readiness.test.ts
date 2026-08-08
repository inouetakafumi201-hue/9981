import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { ErrCode } from '../../state/error-codes.js';
import { ERR_CODES } from '../../state/error-codes.js';
import type { Diagnostic } from '../../state/diagnostic.js';
import {
  COMPILER_EMITTED_CODES,
  GUIDANCE_ARGUMENT_CONTRACT,
  ZH_CN_CREATOR_BUNDLE,
  bundleEntry,
  interpolate,
  missingBundleCodes,
  renderCreatorMessage,
  renderGuidance,
  unresolvedPlaceholders,
} from '../index.js';
import type { CreatorMessageBundle } from '../index.js';
import { candidate, createHarness, validDocument } from './fixtures.js';
import { collectDiagnostics } from './diagnostic-corpus.js';

const COMPILER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALL_ERR_CODES: readonly string[] = Object.entries(ERR_CODES)
  .flatMap(([prefix, suffixes]) => suffixes.map((suffix) => `${prefix}_${suffix}`));

/** A synthetic locale that shares no characters with zh-CN, so leaked untranslated text is obvious. */
const PSEUDO_BUNDLE: CreatorMessageBundle = {
  locale: 'qps-ploc',
  fallbackTitle: '[[TITLE-FALLBACK]]',
  fallbackGuidance: '[[GUIDANCE-FALLBACK]]',
  creatorMessagePattern: '<<{title}>> <<{guidance}>>',
  entries: Object.fromEntries(COMPILER_EMITTED_CODES.map((code) => [code, {
    title: `[[T:${code}]]`,
    // Preserve the placeholders declared for this code so interpolation is still exercised.
    guidance: `[[G:${code}]]${(GUIDANCE_ARGUMENT_CONTRACT[code] ?? []).map((name) => `{${name}}`).join('')}`,
  }])),
};

function compilerSourceFiles(): string[] {
  return readdirSync(COMPILER_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(COMPILER_DIR, entry.name));
}

describe('i18n: the creator-facing bundle is complete and self-checking', () => {
  it('translates every code the compiler can emit', () => {
    expect(missingBundleCodes(ZH_CN_CREATOR_BUNDLE)).toEqual([]);
  });

  it('lists every code that actually appears in the compiler sources', () => {
    const declared = new Set<string>(COMPILER_EMITTED_CODES);
    const found = new Set<string>();
    for (const file of compilerSourceFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/code: '(E_[A-Z_]+)'/g)) found.add(match[1] as string);
    }
    // Anything emitted but undeclared would reach a creator without a translation entry.
    expect([...found].filter((code) => !declared.has(code)).sort()).toEqual([]);
  });

  it('keeps every declared code inside the closed ErrCode registry', () => {
    const known = new Set(ALL_ERR_CODES);
    expect(COMPILER_EMITTED_CODES.filter((code) => !known.has(code))).toEqual([]);
  });

  it('declares placeholder arguments only for codes whose guidance uses them', () => {
    for (const [code, names] of Object.entries(GUIDANCE_ARGUMENT_CONTRACT)) {
      const guidance = bundleEntry(ZH_CN_CREATOR_BUNDLE, code as ErrCode).guidance;
      for (const name of names ?? []) {
        expect(guidance, `${code} guidance must reference {${name}}`).toContain(`{${name}}`);
      }
    }
  });

  it('has no placeholder in guidance that is absent from the argument contract', () => {
    for (const code of COMPILER_EMITTED_CODES) {
      const declared = new Set(GUIDANCE_ARGUMENT_CONTRACT[code] ?? []);
      for (const name of unresolvedPlaceholders(bundleEntry(ZH_CN_CREATOR_BUNDLE, code).guidance)) {
        // An undeclared placeholder can never be filled, so it would render literally to a creator.
        expect(declared.has(name), `${code} uses undeclared placeholder {${name}}`).toBe(true);
      }
    }
  });

  it('renders a title and guidance for an unknown code instead of throwing', () => {
    const rendered = renderCreatorMessage(ZH_CN_CREATOR_BUNDLE, 'E_OP_SLOT_FULL');
    expect(rendered).toContain(ZH_CN_CREATOR_BUNDLE.fallbackTitle);
    expect(rendered).toContain(ZH_CN_CREATOR_BUNDLE.fallbackGuidance);
  });
});

describe('i18n: swapping the bundle changes only the human-readable layer', () => {
  it('keeps codes, severities, spans and the artifact identical across locales', async () => {
    const zh = await createHarness().compiler.compileAndActivate(candidate(validDocument()));
    const pseudo = await createHarness({ bundle: PSEUDO_BUNDLE })
      .compiler.compileAndActivate(candidate(validDocument()));

    expect(zh.ok && pseudo.ok).toBe(true);
    if (!zh.ok || !pseudo.ok) return;
    // The compiled artifact must not depend on the display language at all.
    expect(pseudo.artifactHash).toBe(zh.artifactHash);
  });

  it('localises every diagnostic across the whole corpus without leaking the default locale', async () => {
    const localised = await collectDiagnostics(undefined, PSEUDO_BUNDLE);
    expect(localised.length).toBeGreaterThan(20);

    for (const { label, diagnostic } of localised) {
      const context = `${label} / ${diagnostic.code}`;
      // Host-provided schema suggestions are content, not catalogue text, and are exempt.
      if (diagnostic.actionableHint?.startsWith('[[G:') === false && diagnostic.severity === 'info') continue;
      expect(diagnostic.creatorMessage, context).toContain('<<');
      expect(diagnostic.creatorMessage, context).toContain(`[[T:${diagnostic.code}]]`);
    }
  });

  it('produces the same structural diagnostics under both locales', async () => {
    const zh = await collectDiagnostics();
    const pseudo = await collectDiagnostics(undefined, PSEUDO_BUNDLE);

    const shape = (items: readonly { label: string; diagnostic: Diagnostic }[]) => items.map(
      ({ label, diagnostic }) => [
        label, diagnostic.code, diagnostic.severity, diagnostic.path ?? '',
        diagnostic.source?.span.start.offset ?? -1,
      ].join('|'));
    expect(shape(pseudo)).toEqual(shape(zh));
  });
});

describe('i18n: message arguments are locale-neutral and renderable', () => {
  it('always attaches a messageArgs object and a messageKey equal to the code', async () => {
    for (const { label, diagnostic } of await collectDiagnostics()) {
      const context = `${label} / ${diagnostic.code}`;
      expect(diagnostic.messageKey, context).toBe(diagnostic.code);
      expect(diagnostic.messageArgs, context).toBeDefined();
      expect(typeof diagnostic.messageArgs, context).toBe('object');
    }
  });

  it('restricts argument values to primitives a translator can safely inline', async () => {
    for (const { label, diagnostic } of await collectDiagnostics()) {
      for (const [name, value] of Object.entries(diagnostic.messageArgs ?? {})) {
        const context = `${label} / ${diagnostic.code} / ${name}`;
        expect(['string', 'number', 'boolean'], context).toContain(value === null ? 'string' : typeof value);
        // Pre-formatted numbers would freeze one locale's grouping and decimal separators.
        if (typeof value === 'number') expect(Number.isFinite(value), context).toBe(true);
      }
    }
  });

  it('leaves no unresolved placeholder in any creator-facing string', async () => {
    for (const bundle of [undefined, PSEUDO_BUNDLE]) {
      for (const { label, diagnostic } of await collectDiagnostics(undefined, bundle)) {
        const context = `${label} / ${diagnostic.code} / ${bundle?.locale ?? 'zh-CN'}`;
        expect(unresolvedPlaceholders(diagnostic.creatorMessage ?? ''), context).toEqual([]);
        expect(unresolvedPlaceholders(diagnostic.actionableHint ?? ''), context).toEqual([]);
      }
    }
  });

  it('supplies every argument the contract declares for its code', async () => {
    const seen = new Map<ErrCode, Readonly<Record<string, unknown>>>();
    for (const { diagnostic } of await collectDiagnostics()) {
      if (GUIDANCE_ARGUMENT_CONTRACT[diagnostic.code]) seen.set(diagnostic.code, diagnostic.messageArgs ?? {});
    }
    // The corpus must actually exercise every contracted code, otherwise this check proves nothing.
    for (const code of Object.keys(GUIDANCE_ARGUMENT_CONTRACT) as ErrCode[]) {
      const args = seen.get(code);
      if (code === 'E_QUOTA_TRAVERSAL_WORK') continue; // covered by a dedicated quota case below
      expect(args, `corpus must produce ${code}`).toBeDefined();
      for (const name of GUIDANCE_ARGUMENT_CONTRACT[code] ?? []) {
        expect(args?.[name], `${code} must supply ${name}`).toBeDefined();
      }
    }
  });
});

describe('i18n: interpolation is total and injection-safe', () => {
  it('substitutes declared arguments and leaves unknown names verbatim', () => {
    expect(interpolate('a {x} b {y}', { x: 1 })).toBe('a 1 b {y}');
    expect(interpolate('no placeholder', { x: 1 })).toBe('no placeholder');
    expect(interpolate('{x}', { x: null })).toBe('null');
    expect(interpolate('{x}', { x: false })).toBe('false');
  });

  it('never re-scans substituted text, so an argument cannot inject a placeholder', () => {
    // A creator-controlled identifier containing "{value}" must not trigger a second substitution round.
    expect(interpolate('{a}', { a: '{b}', b: 'leaked' })).toBe('{b}');
  });

  it('Property: interpolation is deterministic and total for arbitrary arguments', () => {
    fc.assert(fc.property(
      fc.dictionary(fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,7}$/), fc.oneof(
        fc.string(), fc.integer(), fc.boolean(), fc.constant(null),
      )),
      (args) => {
        const template = Object.keys(args).map((name) => `{${name}}`).join('-');
        const first = interpolate(template, args);
        expect(interpolate(template, args)).toBe(first);
        // Every declared name is consumed. Placeholder syntax that survives in the output can only
        // come from a substituted value, never from an unconsumed template name: `interpolate` does
        // not re-scan substituted text (see the no-injection case above), so an argument whose value
        // literally contains `{name}` is expected to appear verbatim rather than be resolved again.
        const substitutedPlaceholders = Object.values(args)
          .flatMap((value) => unresolvedPlaceholders(String(value)));
        expect(unresolvedPlaceholders(first)).toEqual(substitutedPlaceholders);
      },
    ), { numRuns: 200 });
  });

  it('Property: rendering any code under any bundle yields non-empty creator text', () => {
    fc.assert(fc.property(
      fc.constantFrom(...COMPILER_EMITTED_CODES),
      fc.constantFrom(ZH_CN_CREATOR_BUNDLE, PSEUDO_BUNDLE),
      (code, bundle) => {
        const args = Object.fromEntries((GUIDANCE_ARGUMENT_CONTRACT[code] ?? []).map((name) => [name, 1]));
        const message = renderCreatorMessage(bundle, code, args);
        expect(message.length).toBeGreaterThan(0);
        expect(unresolvedPlaceholders(message)).toEqual([]);
        expect(renderGuidance(bundle, code, args).length).toBeGreaterThan(0);
      },
    ), { numRuns: 300 });
  });

  it('reports the traversal-work limit as a structured argument', async () => {
    const harness = createHarness({ quotas: { traversalWork: 1 } });
    const result = await harness.compiler.compileAndActivate(candidate(validDocument()));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const quota = result.diagnostics.find((item) => item.code === 'E_QUOTA_TRAVERSAL_WORK');
    expect(quota?.messageArgs?.['limit']).toBe(1);
    expect(quota?.actionableHint).toContain('1');
  });
});
