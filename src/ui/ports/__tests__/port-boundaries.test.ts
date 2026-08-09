import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { importSpecifiers, scanUiSources } from '../../__tests__/support/source-scan.js';
import { converged, pendingConvergence, convergenceDiagnostic } from '../convergence.js';
import { isAccepted, type SubmissionOutcome } from '../action-port.js';
import type { StateRevision } from '../../model/revision.js';

const UI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT_SOURCES = scanUiSources(UI_ROOT).filter((source) => source.path.startsWith('ports/'));

/** tasks.md 任务 2.1 点名的四个端口文件。 */
const FOUR_PORTS = [
  'ports/projection-port.ts',
  'ports/event-port.ts',
  'ports/action-query-port.ts',
  'ports/revision-port.ts',
] as const;

describe('端口边界（tasks.md 任务 2.1）', () => {
  it('四个端口文件确实存在', () => {
    expect(PORT_SOURCES.map((source) => source.path)).toEqual(
      expect.arrayContaining([...FOUR_PORTS]),
    );
  });

  it('端口文件不 import src/l2 与 src/core', () => {
    const violations: string[] = [];
    for (const source of PORT_SOURCES) {
      for (const specifier of importSpecifiers(source.code)) {
        if (/(^|\/)(l2|core)\//u.test(specifier)) violations.push(`${source.path}: ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('四个端口文件只声明类型，不含任何实现', () => {
    const violations: string[] = [];
    for (const source of PORT_SOURCES.filter((item) =>
      (FOUR_PORTS as readonly string[]).includes(item.path),
    )) {
      for (const pattern of [/\bfunction\b/u, /\bclass\b/u, /\bnew\s+[A-Z]/u]) {
        if (pattern.test(source.code)) violations.push(`${source.path}: ${pattern.source}`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('查询端口不暴露裸 Query（J-23）', () => {
  it('action-query-port 中不存在独立的 Query 标识符', () => {
    const source = PORT_SOURCES.find((item) => item.path === 'ports/action-query-port.ts');
    expect(source).toBeDefined();
    expect(/\bQuery\b/u.test(source?.code ?? '')).toBe(false);
  });

  it('作用域查询声明里没有 visibleTo 字段：可见性谓词是端口实现的义务', () => {
    const source = PORT_SOURCES.find((item) => item.path === 'ports/action-query-port.ts');
    expect(/\bvisibleTo\b/u.test(source?.code ?? '')).toBe(false);
  });
});

describe('提交结果三分支不可混淆（tasks.md 任务 2.2）', () => {
  const revision: StateRevision = { sequence: 3, fingerprint: 'fp-3' };

  it('accepted 与 stale / rejected 在类型层互斥', () => {
    const accepted: SubmissionOutcome = { kind: 'accepted', committedRevision: revision };
    const stale: SubmissionOutcome = {
      kind: 'stale',
      rejection: { rejected: true, diagnostics: [], displayText: '状态已变化' },
    };
    expect(isAccepted(accepted)).toBe(true);
    expect(isAccepted(stale)).toBe(false);

    // @ts-expect-error accepted 分支没有 rejection 字段
    const confusedAccepted: SubmissionOutcome = { kind: 'accepted', rejection: stale.rejection };
    // @ts-expect-error stale 分支没有 committedRevision 字段
    const confusedStale: SubmissionOutcome = { kind: 'stale', committedRevision: revision };
    expect(confusedAccepted).toBeTruthy();
    expect(confusedStale).toBeTruthy();
  });

  it('端口代码中不出现写入通道标识符', () => {
    const forbidden = [/\bOpRegistry\b/u, /\bprop\.set\b/u, /\bprop\.add\b/u, /\binvokeInline\b/u];
    for (const source of PORT_SOURCES) {
      for (const pattern of forbidden) {
        expect(pattern.test(source.code), `${source.path}: ${pattern.source}`).toBe(false);
      }
    }
  });
});

describe('待汇合契约的显式失败（tasks.md 任务 2.3）', () => {
  it('汇合失败列出缺失能力，且不存在返回空映射或默认值的分支', () => {
    const failed = pendingConvergence<string>(['unavailability-reason-mapping-key']);
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error('unreachable');
    expect(failed.code).toBe('PENDING_CONVERGENCE_CONTRACT');
    expect(failed.missing).toEqual(['unavailability-reason-mapping-key']);
  });

  it('缺失能力列表按码点序规范化，使诊断确定性', () => {
    const failed = pendingConvergence<number>(['zeta', 'alpha']);
    if (failed.ok) throw new Error('unreachable');
    expect(failed.missing).toEqual(['alpha', 'zeta']);
  });

  it('成功分支携带取值，且结果被冻结', () => {
    const okResult = converged(7);
    expect(okResult.ok).toBe(true);
    expect(Object.isFrozen(okResult)).toBe(true);
  });

  it('汇合失败可翻译为 error 级结构化诊断', () => {
    const diagnostic = convergenceDiagnostic(['core-phase-semantics'], 'presentation/hud');
    expect(diagnostic.code).toBe('PENDING_CONVERGENCE_CONTRACT');
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.reason).toContain('core-phase-semantics');
  });

  it('三个待汇合端口不含任何具体字段名常量', () => {
    const source = PORT_SOURCES.find((item) => item.path === 'ports/pending-contracts.ts');
    expect(source).toBeDefined();
    // 端口文件里不应出现字符串字面量常量声明——那正是"给待汇合字段定名"的形态。
    expect(/=\s*['"][^'"]+['"]/u.test(source?.code ?? '')).toBe(false);
  });
});

describe('待汇合契约的显式失败（tasks.md 任务 2.3）', () => {
  it('汇合失败列出缺失能力，且不存在返回空映射或默认值的分支', () => {
    const failed = pendingConvergence<string>(['unavailability-reason-mapping-key']);
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error('unreachable');
    expect(failed.code).toBe('PENDING_CONVERGENCE_CONTRACT');
    expect(failed.missing).toEqual(['unavailability-reason-mapping-key']);
  });

  it('缺失能力列表按码点序规范化，使诊断确定性', () => {
    const failed = pendingConvergence<number>(['zeta', 'alpha']);
    if (failed.ok) throw new Error('unreachable');
    expect(failed.missing).toEqual(['alpha', 'zeta']);
  });

  it('成功分支携带取值，且结果被冻结', () => {
    const okResult = converged(7);
    expect(okResult.ok).toBe(true);
    expect(Object.isFrozen(okResult)).toBe(true);
  });

  it('汇合失败可翻译为 error 级结构化诊断', () => {
    const diagnostic = convergenceDiagnostic(['core-phase-semantics'], 'presentation/hud');
    expect(diagnostic.code).toBe('PENDING_CONVERGENCE_CONTRACT');
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.reason).toContain('core-phase-semantics');
  });

  it('三个待汇合端口不含任何具体字段名常量', () => {
    const source = PORT_SOURCES.find((item) => item.path === 'ports/pending-contracts.ts');
    expect(source).toBeDefined();
    // 端口文件里不应出现字符串字面量常量声明——那正是"给待汇合字段定名"的形态。
    expect(/=\s*['"][^'"]+['"]/u.test(source?.code ?? '')).toBe(false);
  });
});
