/**
 * L9 PolicyDef.fallback 转向（需求34.1 fallback 字段 / 34.6 无合法着法时转向 fallback）。
 *
 * 本次修补前 PolicyDef 没有 fallback 字段，PolicyEvaluator 也没有转向逻辑——需求34.6 完全未实现。
 * 现在 decide() 按 mode 求结果，得不出合法着法时沿 fallback 链继续（环守卫、链尽头返回 null）。
 */
import { describe, it, expect } from 'vitest';
import { PolicyEvaluator } from '../policy.js';
import type { PolicyDef, PolicyDecideDeps } from '../policy.js';

function deps(policies: Record<string, PolicyDef>, condTrue: boolean): PolicyDecideDeps {
  return {
    resolvePolicy: (id) => policies[id] ?? null,
    evalCondition: () => condTrue,
    ctx: { state: null, agentId: 'a:1' },
  };
}

describe('PolicyDef.fallback 转向（需求34.6）', () => {
  it('主策略得出着法时不触发 fallback', () => {
    const primary: PolicyDef = {
      id: 'pol:primary', kind: 'policy', mode: 'rules',
      policyRules: [{ condition: true, action: 'act:main', priority: 1 }],
      fallback: 'pol:backup',
    };
    const backup: PolicyDef = { id: 'pol:backup', kind: 'policy', mode: 'rules', policyRules: [{ condition: true, action: 'act:backup' }] };
    const ev = new PolicyEvaluator();
    const decision = ev.decide(primary, deps({ 'pol:primary': primary, 'pol:backup': backup }, true));
    expect(decision).toEqual({ kind: 'action', action: 'act:main', policy: 'pol:primary' });
  });

  it('主策略无合法着法时转向 fallback', () => {
    // rules 条件恒 false → 主策略得不出着法 → 转 fallback（其 scripted 脚本非空）
    const primary: PolicyDef = {
      id: 'pol:primary', kind: 'policy', mode: 'rules',
      policyRules: [{ condition: false, action: 'act:main' }],
      fallback: 'pol:backup',
    };
    const backup: PolicyDef = { id: 'pol:backup', kind: 'policy', mode: 'scripted', script: [{ emit: 'idle' }] };
    const ev = new PolicyEvaluator();
    const decision = ev.decide(primary, deps({ 'pol:primary': primary, 'pol:backup': backup }, false));
    expect(decision).toEqual({ kind: 'script', script: [{ emit: 'idle' }], policy: 'pol:backup' });
  });

  it('多级 fallback 链逐级转向直到得出结果', () => {
    const a: PolicyDef = { id: 'pol:a', kind: 'policy', mode: 'rules', policyRules: [], fallback: 'pol:b' };
    const b: PolicyDef = { id: 'pol:b', kind: 'policy', mode: 'rules', policyRules: [], fallback: 'pol:c' };
    const c: PolicyDef = { id: 'pol:c', kind: 'policy', mode: 'rules', policyRules: [{ condition: true, action: 'act:c' }] };
    const ev = new PolicyEvaluator();
    const decision = ev.decide(a, deps({ 'pol:a': a, 'pol:b': b, 'pol:c': c }, true));
    expect(decision).toEqual({ kind: 'action', action: 'act:c', policy: 'pol:c' });
  });

  it('fallback 链成环时安全终止返回 null（不卡死，需求34.7）', () => {
    const a: PolicyDef = { id: 'pol:a', kind: 'policy', mode: 'rules', policyRules: [], fallback: 'pol:b' };
    const b: PolicyDef = { id: 'pol:b', kind: 'policy', mode: 'rules', policyRules: [], fallback: 'pol:a' };
    const ev = new PolicyEvaluator();
    const decision = ev.decide(a, deps({ 'pol:a': a, 'pol:b': b }, false));
    expect(decision).toBeNull();
  });

  it('链尽头仍无结果返回 null', () => {
    const a: PolicyDef = { id: 'pol:a', kind: 'policy', mode: 'rules', policyRules: [] };
    const ev = new PolicyEvaluator();
    expect(ev.decide(a, deps({ 'pol:a': a }, false))).toBeNull();
  });

  it('search 模式无 resolver 时返回 null 并转向 fallback', () => {
    const primary: PolicyDef = { id: 'pol:s', kind: 'policy', mode: 'search', searchDepth: 3, fallback: 'pol:safe' };
    const safe: PolicyDef = { id: 'pol:safe', kind: 'policy', mode: 'scripted', script: [{ emit: 'flee' }] };
    const ev = new PolicyEvaluator(); // no search resolver injected
    const decision = ev.decide(primary, deps({ 'pol:s': primary, 'pol:safe': safe }, false));
    expect(decision).toEqual({ kind: 'script', script: [{ emit: 'flee' }], policy: 'pol:safe' });
  });
});
