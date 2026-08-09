/**
 * PT-02 端口交付测试：证明 l2 侧交付的端口集合满足 wakeup-ugc 的 `L2PortBundle` 目标形状，
 * 并验证三个端口的核心行为契约。
 *
 * 本测试**允许** import `src/core/ugc/integration/l2-port-contract.ts`：那是 UGC 侧的校验器，
 * 由消费方（l2）调用它来自证端口完整——与 UGC 侧「integration 目录零 l2 耦合」的守卫方向相反且不冲突。
 */
import { describe, expect, it } from 'vitest';
import { inspectL2PortBundle, isL2PortBundleReady } from '../../../../core/ugc/integration/l2-port-contract.js';
import { MANDATORY_VALIDATION_CAPABILITIES } from '../../../../core/ugc/ports/definition-ports.js';
import { createL2PortBundle } from '../port-bundle.js';
import { L2_PORT_PROVIDER_ID } from '../port-common.js';
import { budget, makeRequest, makeValidationContext, validPackageJson } from './fixtures.js';

describe('PT-02: l2 交付满足 L2PortBundle 目标形状', () => {
  it('装配出的端口集合通过 inspectL2PortBundle / isL2PortBundleReady', () => {
    const bundle = createL2PortBundle();
    expect(inspectL2PortBundle(bundle)).toEqual([]);
    expect(isL2PortBundleReady(bundle)).toBe(true);
  });

  it('两个注册表端口各自自证目标层', () => {
    const bundle = createL2PortBundle();
    expect(bundle.registries['base-layer'].targetOwnership).toBe('base-layer');
    expect(bundle.registries['play-layer'].targetOwnership).toBe('play-layer');
  });

  it('三个端口共享同一 providerId', () => {
    const bundle = createL2PortBundle();
    expect(bundle.validation.providerId).toBe(L2_PORT_PROVIDER_ID);
    expect(bundle.resolution.providerId).toBe(L2_PORT_PROVIDER_ID);
    expect(bundle.registries['base-layer'].providerId).toBe(L2_PORT_PROVIDER_ID);
  });
});

describe('PT-02: DefinitionValidationGateway 行为', () => {
  it('合法候选通过验证，validated 非 null 且覆盖全部强制验证能力', () => {
    const bundle = createL2PortBundle();
    const active = bundle.registryHandles['base-layer'].readSnapshot();
    const request = makeRequest({ canonicalJson: validPackageJson() });
    const result = bundle.validation.validate(request, makeValidationContext(active), budget());

    expect(result.validated).not.toBeNull();
    expect(result.diagnostics.filter((d) => d.severity === 'error' || d.severity === 'fatal')).toEqual([]);
    for (const capability of MANDATORY_VALIDATION_CAPABILITIES) {
      expect(result.coveredCapabilities).toContain(capability);
    }
    expect(result.validated?.definitionIds).toEqual(['dmg-basic']);
  });

  it('未声明的顶层字段被拒绝（closed-schema）', () => {
    const bundle = createL2PortBundle();
    const active = bundle.registryHandles['base-layer'].readSnapshot();
    const withTypo = JSON.parse(validPackageJson()) as Record<string, unknown>;
    withTypo['tpyo'] = 1;
    const request = makeRequest({ canonicalJson: JSON.stringify(withTypo) });
    const result = bundle.validation.validate(request, makeValidationContext(active), budget());

    expect(result.validated).toBeNull();
    expect(result.diagnostics.some((d) => d.code === 'E_LOAD_UNKNOWN_FIELD')).toBe(true);
  });

  it('候选与绑定目标层不一致时被拒绝（mixed-layer）', () => {
    const bundle = createL2PortBundle();
    const active = bundle.registryHandles['base-layer'].readSnapshot();
    // 候选声明 play-layer，但送进 base-layer 的活动快照上下文。
    const request = makeRequest({ canonicalJson: validPackageJson(), targetOwnership: 'play-layer' });
    const result = bundle.validation.validate(request, makeValidationContext(active), budget());

    expect(result.validated).toBeNull();
    expect(result.diagnostics.some((d) => d.code === 'E_LOAD_LAYER_OWNERSHIP')).toBe(true);
  });

  it('活动快照不是本提供方铸造时失败关闭', () => {
    const bundle = createL2PortBundle();
    const foreignSnapshot = {
      registryVersion: 'x',
      snapshotFingerprint: 'x',
      targetOwnership: 'base-layer' as const,
      activeDefinitionIds: [],
      payload: { kind: 'someone-else', providerId: 'other' },
    };
    const request = makeRequest({ canonicalJson: validPackageJson() });
    const result = bundle.validation.validate(request, makeValidationContext(foreignSnapshot), budget());
    expect(result.validated).toBeNull();
    expect(result.coveredCapabilities).toEqual([]);
  });
});
