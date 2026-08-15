import { defineConfig } from 'vitest/config';

/**
 * 变异测试专用配置：只跑 numRuns 可通过 L4_RUNS 收缩的套件。
 * 排除 l4-property.test.ts —— 它的 numRuns 是硬编码的 10 万，
 * 且其断言已被证明空转，放进变异循环只会拖慢而不增加判别力。
 */
export default defineConfig({
  test: {
    include: [
      'test/l4-order-model.test.ts',
      'test/l4-dispatch-model.test.ts',
      'test/l4-invariant-checker.test.ts',
      'test/l4-regression.test.ts',
    ],
    testTimeout: 120000,
    globals: false,
    bail: 1,
    reporters: ['dot'],
  },
});
