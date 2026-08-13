/**
 * 方案 A 端口契约与跨 Spec 装配缝门禁。
 *
 * 1. 运行期检查抓出缺方法、缺层、身份混用和共享 registry；
 * 2. `integration/` 到 `src/l2` 只允许一个经审计的稳定导出 import，禁止内部形状扩散。
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiagnosticCodeCatalog } from '../../diagnostics/code-catalog.js';
import { createDiagnosticFactory } from '../../diagnostics/factory.js';
import { sha256FingerprintGateway } from '../../ports/sha256-fingerprint-gateway.js';
import {
  createUnavailableDefinitionRegistryGateway,
  createUnavailableDefinitionValidationGateway,
  createUnavailableReferenceResolutionGateway,
} from '../../ports/unavailable.js';
import {
  L2PortBundleContractError,
  assertL2PortBundle,
  inspectL2PortBundle,
  isL2PortBundleReady,
} from '../l2-port-contract.js';

const factory = createDiagnosticFactory(createDiagnosticCodeCatalog(sha256FingerprintGateway));
const INTEGRATION_DIR = dirname(fileURLToPath(import.meta.url)).replace(/__tests__$/, '');
const STABLE_L2_IMPORT = '../../../l2/ugc/ports/index.js';

function completeBundle() {
  return {
    validation: createUnavailableDefinitionValidationGateway(factory),
    resolution: createUnavailableReferenceResolutionGateway(factory, 'pkg-1'),
    registries: {
      'base-layer': createUnavailableDefinitionRegistryGateway(factory, 'base-layer', 'pkg-1'),
      'play-layer': createUnavailableDefinitionRegistryGateway(factory, 'play-layer', 'pkg-1'),
    },
  };
}

describe('Feature: wakeup-ugc, plan A: l2 port contract gate', () => {
  it('accepts and asserts a structurally complete, identity-consistent bundle', () => {
    const bundle = completeBundle();
    expect(inspectL2PortBundle(bundle)).toEqual([]);
    expect(isL2PortBundleReady(bundle)).toBe(true);
    expect(assertL2PortBundle(bundle)).toBe(bundle);
  });

  it('rejects a bundle missing a gateway method', () => {
    const bundle = { ...completeBundle(), validation: {} };
    const problems = inspectL2PortBundle(bundle);
    expect(problems.some((problem) => problem.port === 'validation')).toBe(true);
  });

  it('rejects a bundle missing a target-layer registry', () => {
    const bundle = completeBundle();
    const problems = inspectL2PortBundle({
      ...bundle,
      registries: { 'base-layer': bundle.registries['base-layer'] },
    });
    expect(problems.some((problem) => problem.port === 'registries.play-layer')).toBe(true);
  });

  it('rejects a registry whose declared target layer is not self-consistent', () => {
    const bundle = completeBundle();
    const problems = inspectL2PortBundle({
      ...bundle,
      registries: {
        'base-layer': createUnavailableDefinitionRegistryGateway(factory, 'play-layer', 'pkg-1'),
        'play-layer': bundle.registries['play-layer'],
      },
    });
    expect(problems.some((problem) => problem.port === 'registries.base-layer')).toBe(true);
  });

  it('rejects provider or version mixing across adjacent ports', () => {
    const bundle = completeBundle();
    const problems = inspectL2PortBundle({
      ...bundle,
      validation: { ...bundle.validation, providerId: 'foreign-provider', version: 'foreign-version' },
    });
    expect(problems.some((problem) => problem.port === 'providerId')).toBe(true);
    expect(problems.some((problem) => problem.port === 'version')).toBe(true);
  });

  it('rejects one registry object reused for both target layers', () => {
    const bundle = completeBundle();
    const shared = bundle.registries['base-layer'];
    const problems = inspectL2PortBundle({
      ...bundle,
      registries: { 'base-layer': shared, 'play-layer': shared },
    });
    expect(problems.some((problem) => problem.port === 'registries')).toBe(true);
  });

  it('fails closed with a typed assembly error for an absent bundle', () => {
    expect(isL2PortBundleReady(undefined)).toBe(false);
    expect(isL2PortBundleReady({})).toBe(false);
    expect(() => assertL2PortBundle(undefined)).toThrow(L2PortBundleContractError);
  });

  it('allows exactly one audited import from the stable l2 port export', () => {
    const files: string[] = [];
    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const absolute = join(directory, entry);
        if (statSync(absolute).isDirectory()) {
          walk(absolute);
          continue;
        }
        if (entry.endsWith('.ts')) files.push(absolute);
      }
    };
    walk(INTEGRATION_DIR);
    expect(files.length).toBeGreaterThan(0);

    const l2Imports: { readonly file: string; readonly specifier: string }[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const imports = [...text.matchAll(/from\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
      for (const specifier of imports) {
        if (specifier.replace(/\\/g, '/').includes('/l2/')) {
          l2Imports.push({
            file: relative(INTEGRATION_DIR, file).replace(/\\/g, '/'),
            specifier,
          });
        }
      }
    }

    expect(l2Imports).toEqual([
      { file: 'l2-adapter.ts', specifier: STABLE_L2_IMPORT },
    ]);
  });
});
