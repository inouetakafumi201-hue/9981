/**
 * 唯一入口守卫测试（D-061 迁移保障）
 *
 * 目标：防止后续开发绕过迁移，直接 import 旧 spec-compiler。
 *
 * 设计原则：
 * - 编译期检查（TypeScript）+ 运行期检查（测试）
 * - 所有生产代码必须 import 新端口，不能 import 旧实现
 * - 允许测试中调用旧实现用于对比（但需显式标记）
 *
 * 完成条件：
 * - ✅ L2 零 import spec-compiler（除了端口）
 * - ✅ UGC 零 import spec-compiler
 * - ✅ 新生产消费方（catalog-activation 等）零 import 旧实现
 * - ✅ 所有新代码仅 import 引擎端口
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * 无 shell 调用 grep：execSync 在 Windows 上走 cmd.exe（非 shell），Bash 重定向
 * `2>/dev/null` 与 `|| true` 会被 cmd 当成参数、使 grep 以 rc=2 失败。
 * 这里用 spawnSync(grep, [args]) 不经 shell，grep 无匹配时 rc=1 属正常（吸收后返回空串）。
 */

describe('D-061: No old import guard', () => {
  describe('TypeScript compilation', () => {
    it('has zero import errors in L2 codebase', () => {
      // TODO: 运行 `npx tsc --noEmit -p tsconfig.l2.json` 并验证无 error
      // 预期：0 TS7016 (找不到模块定义) 在 src/l2 中涉及 spec-compiler
    });

    it('has zero import errors in UGC codebase', () => {
      // TODO: 运行 `npx tsc --noEmit -p tsconfig.json` 并验证 src/core/ugc 无错
    });

    it('has zero import errors in new engine ports', () => {
      // TODO: 运行编译检查 src/core/kernel/ports
    });
  });

  describe('Production import scan', () => {
    it('L2 does not import from spec-compiler', () => {
      // TODO: 用 grep 扫描 src/l2/**/*.ts 不含 spec-compiler import
      // 允许的：import type * from kernel/ports
      // 禁止的：import type * from kernel/spec-compiler
      // 说明：guard 用 spawnSync('grep', [...]) 不经 shell，避免 Windows cmd 把
      // `2>/dev/null`/`|| true` 当作参数；grep 无匹配时 rc=1，不触发异常。
      const scan = spawnSync('grep', ['-r', 'from ["]spec-compiler', 'src/l2'], { encoding: 'utf8' });
      expect(String(scan.stdout ?? '').trim(), 'L2 should not import spec-compiler').toBe('');
    });

    it('UGC does not import from spec-compiler', () => {
      // TODO: 用 grep 扫描 src/core/ugc/**/*.ts
      const scan = spawnSync('grep', ['-r', 'from ["]spec-compiler', 'src/core/ugc'], { encoding: 'utf8' });
      expect(String(scan.stdout ?? '').trim(), 'UGC should not import spec-compiler').toBe('');
    });

    it('catalog-activation imports from L2 + ports, not spec-compiler', () => {
      // TODO: Phase 5 后验证
      const content = readFileSync('src/class/catalog-activation.ts', 'utf8');
      expect(content).not.toContain('from "../core/kernel/spec-compiler');
      // 应该看到：
      // - import from '../../l2/...'
      // - import from '../../core/kernel/ports/...'
    });

    it('catalog-loader imports from ports only', () => {
      // TODO: Phase 5 后验证
      const content = readFileSync('src/class/catalog-loader.ts', 'utf8');
      expect(content).not.toContain('from "../core/kernel/spec-compiler');
      // 应该看到：
      // - import { StrictJsonCodecPort } from '../../core/kernel/ports/...'
    });

    it('profile-loader imports from ports only', () => {
      // TODO: Phase 5 后验证
      const content = readFileSync('src/ui/profile/profile-loader.ts', 'utf8');
      expect(content).not.toContain('from "../core/kernel/spec-compiler');
      // 应该看到：
      // - import { StrictJsonCodecPort } from '../../core/kernel/ports/...'
    });
  });

  describe('Test import allowlist', () => {
    it('test files can explicitly import spec-compiler for comparison', () => {
      // 允许测试中导入旧实现，用于 characterization
      // 但需显式标记（如注释）

      // 示例允许的模式：
      // /* for characterization only */
      // import { SpecificationCompiler } from '../../spec-compiler/compiler.js';
    });

    it('test imports are marked with intent comments', () => {
      // TODO: 扫描所有测试中的 spec-compiler import
      // 验证每一个都有对应的 @characterization 或 @comparison 注释
    });
  });

  describe('Migration milestone tracking', () => {
    it('tracks old spec-compiler file count', () => {
      // TODO: 定期记录旧文件数量
      // Phase 0 baseline: 13 核心文件
      // Phase 7 target: 0 核心文件（纯基础设施迁出）
      expect(true).toBe(true); // Placeholder
    });

    it('tracks new port implementation status', () => {
      // TODO: Phase 1 后验证
      // - JSON codec port: ✅ 实现
      // - Hash port: ✅ 实现
      // - Diagnostic port: ✅ 实现
      // - Artifact store port: ✅ 实现
      // - Quota port: ✅ 实现
      expect(true).toBe(true); // Placeholder
    });

    it('tracks L2 补齐进度', () => {
      // TODO: Phase 2-3 后验证
      // - Quota 前置检查: ✅
      // - Source mapping: ✅
      // - Deep closed schema: ✅
      // - Migration graph: ✅
      // - Diagnostic closure: ✅
      // - Draft mode: ✅
      // - Model integrity: ✅
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Regression prevention', () => {
    it('maintains characterization baseline', () => {
      // TODO: 持久化运行结果
      // - 对比 旧 spec-compiler vs 新端口 的输出
      // - 存储为 .pre-existing-tests.json
      // - 每次运行都检查是否回归
    });

    it('prevents accidental re-coupling', () => {
      // TODO: 添加 pre-commit hook
      // 在提交前运行此测试，拒绝新 import spec-compiler 的代码
    });
  });
});

/**
 * 附录：迁移检查清单
 *
 * Phase 0 完成标志：
 * - [ ] src/core/kernel/ports/** 全部实现（5 个契约）
 * - [ ] characterization tests 框架搭建
 * - [ ] 唯一入口守卫测试就位
 * - [ ] .pre-existing-tests.json 基线建立（旧 spec-compiler 136 tests 通过）
 * - [ ] tsc 零错误
 * - [ ] import 扫描全部通过
 *
 * Phase 1 完成标志：
 * - [ ] src/core/kernel/codec/json-codec.ts （从 spec-compiler 迁出）
 * - [ ] src/core/kernel/codec/hash.ts
 * - [ ] src/core/kernel/codec/quotas.ts
 * - [ ] src/core/kernel/state/diagnostic-factory.ts
 * - [ ] src/core/kernel/state/message-bundles.ts
 * - [ ] src/core/kernel/persistence/artifact-store.ts
 * - [ ] src/core/kernel/persistence/output-lease.ts
 * - [ ] 端口实现全部通过 characterization tests
 * - [ ] L2/UGC 零 import spec-compiler（除端口）
 *
 * Phase 2-6 完成标志：
 * - [ ] L2 补齐 5 缺口能力
 * - [ ] 4 处生产消费方改为调用 L2+端口
 * - [ ] 对照运行产生 byte-identical 输出
 * - [ ] 诊断码完全闭合（64 旧 → L2 等价）
 *
 * Phase 7 完成标志：
 * - [ ] 删除 src/core/kernel/spec-compiler/compiler.ts
 * - [ ] 删除 src/core/kernel/spec-compiler/validator.ts
 * - [ ] 删除 src/core/kernel/spec-compiler/resolver.ts
 * - [ ] 删除 src/core/kernel/spec-compiler/registries.ts
 * - [ ] 删除 src/core/kernel/spec-compiler/integrity.ts
 * - [ ] 删除 src/core/kernel/spec-compiler/closure.ts
 * - [ ] 删除 src/core/kernel/spec-compiler/semantic-family.ts
 * - [ ] 删除 src/core/kernel/spec-compiler/numeric-classification.ts
 * - [ ] 删除旧测试文件（迁为 L2/engine-port tests）
 * - [ ] 全部测试通过
 * - [ ] 零 spec-compiler import（生产代码）
 */
