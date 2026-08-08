/**
 * 端口契约门禁测试（方案 A）。
 *
 * 两件事：
 * 1. 证明契约校验能抓出不完整的端口集合（缺方法、缺层、层标记不自洽）；
 * 2. 证明 wakeup-ugc 此刻**零 l2 耦合**——`integration/` 下没有任何 `src/l2` import。
 *    这是"解耦优先"裁决的可执行守卫：一旦有人提前耦合到 l2 不稳定内部，本测试立即失败。
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
import { inspectL2PortBundle, isL2PortBundleReady } from '../l2-port-contract.js';

const factory = createDiagnosticFactory(createDiagnosticCodeCatalog(sha256FingerprintGateway));
const INTEGRATION_DIR = dirname(fileURLToPath(import.meta.url)).replace(/__tests__$/, '');

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
  it('accepts a structurally complete bundle', () => {
    expect(inspectL2PortBundle(completeBundle())).toEqual([]);
    expect(isL2PortBundleReady(completeBundle())).toBe(true);
  });

  it('rejects a bundle missing a gateway method', () => {
    const bundle = { ...completeBundle(), validation: {} };
    const problems = inspectL2PortBundle(bundle);
    expect(problems.some((problem) => problem.port === 'validation')).toBe(true);
  });

  it('rejects a bundle missing a target-layer registry', () => {
    const bundle = completeBundle();
    const problems = inspectL2PortBundle({ ...bundle, registries: { 'base-layer': bundle.registries['base-layer'] } });
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

  it('rejects a completely absent bundle instead of assuming readiness', () => {
    expect(isL2PortBundleReady(undefined)).toBe(false);
    expect(isL2PortBundleReady({})).toBe(false);
  });

  it('has zero coupling to src/l2 while the base layer is unfrozen', () => {
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

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const imports = [...text.matchAll(/from\s*['"]([^'"]+)['"]/g)].map((match) => match[1] ?? '');
      for (const specifier of imports) {
        expect(
          specifier.replace(/\\/g, '/').includes('/l2/'),
          `${relative(INTEGRATION_DIR, file)} must not import src/l2 until the ports are frozen`,
        ).toBe(false);
      }
    }
  });
});
