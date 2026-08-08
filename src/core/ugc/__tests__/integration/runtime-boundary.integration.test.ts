/**
 * 任务 11.6：运行时边界与兼容转交。
 *
 * 验证 UGC 公共 API 不暴露 WorldState/OpRegistry/Hook/事务/journal/checkpoint/持久化写入器；
 * 运行时兼容声明只触发已有 gateway；newer-save 与 active-match replacement 的拒绝原样保留；
 * 候选不能声明可执行迁移转换。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from '../harness.js';
import { requestFrom, validCandidateText } from '../../testing/generators.js';

const UGC_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('Feature: wakeup-ugc, Task 11.6: runtime boundary and compatibility forwarding', () => {
  it('does not call the runtime compatibility gateway for a candidate that declares nothing', () => {
    const harness = createHarness();
    harness.facade.validate(requestFrom(validCandidateText(), 'hand-authored'));
    expect(harness.runtime.calls.playpack).toBe(0);
    expect(harness.runtime.calls.activeMatch).toBe(0);
  });

  it('forwards a playpack/save compatibility declaration exactly once', () => {
    const harness = createHarness();
    const text = JSON.stringify({ schemaVersion: '1.0.0', id: 'w:a', compatibility: { savedVersion: '2.0.0' } });
    harness.facade.validate(requestFrom(text, 'hand-authored'));
    expect(harness.runtime.calls.playpack).toBe(1);
  });

  it('preserves the upstream refusal of an active-match replacement without downgrading it', () => {
    const harness = createHarness();
    const text = JSON.stringify({ schemaVersion: '1.0.0', id: 'w:a', replaceActivePlaypack: { id: 'pp:1' } });
    const report = harness.facade.validate(requestFrom(text, 'hand-authored'));
    expect(harness.runtime.calls.activeMatch).toBe(1);
    const refusal = report.diagnostics.find((entry) => entry.code === 'E_MIG_NEWER_SAVE');
    expect(refusal?.severity).toBe('error');
    expect(report.status).toBe('rejected');
  });

  it('the public UGC surface references no runtime-write identifier in production source', () => {
    // 静态扫描生产源码（排除测试与端口接口的类型注释），确认无运行时写入能力被引用。
    const forbidden = ['OpRegistry', 'WorldState', 'takeSnapshot', 'applyMigration', 'CheckpointStore', 'new Journal', 'DefRegistry'];
    const files = [
      'index.ts',
      'facade/ugc-ingress-facade.ts',
      'validation/coordinator.ts',
      'activation/atomic-activation-coordinator.ts',
      'activation/validated-change-set.ts',
    ];
    for (const relative of files) {
      const source = readFileSync(join(UGC_ROOT, relative), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
      for (const identifier of forbidden) {
        expect(code.includes(identifier), `${relative} must not reference ${identifier}`).toBe(false);
      }
    }
  });

  it('a candidate cannot declare an executable migration transform', () => {
    // 迁移边只能来自可信宿主的 SchemaMigrationGateway；候选 JSON 里的 "migration"/"transform" 字段
    // 只是普通数据，绝不会被当作可执行转换。这里断言带这类字段的候选仍走普通验证，不触发任何执行。
    const harness = createHarness();
    const text = JSON.stringify({
      schemaVersion: '1.0.0',
      id: 'w:a',
      migration: { transform: 'return state', from: '1.0.0', to: '2.0.0' },
    });
    const report = harness.facade.validate(requestFrom(text, 'hand-authored'));
    // 该字段是否合法由上游 Schema 裁定；这里只断言它没有被执行、没有触发迁移网关。
    expect(report.status === 'validated' || report.status === 'rejected').toBe(true);
    expect(harness.runtime.calls.playpack).toBe(0);
  });
});
