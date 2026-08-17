import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // src/** 覆盖 L1 内核既有测试；test/l2/** 覆盖基类层规范测试；
    // test/properties/** 覆盖 design.md 的 14 个正确性性质（一性质一文件）；
    // test/toolchain/** 覆盖工具链自身的门禁范围不变量（PT-06 守卫，见 gate-coverage.test.ts）；
    // test/play/** 覆盖玩法层/整合层契约测试（专项 B loading-runtime 契约测试落此目录）。
    // test/ai-tuning/** 覆盖自学习迭代系统「实际迭代 AI 参数当用例测试」的真实调参闭环 e2e。
    include: [
      'src/**/*.test.ts',
      'test/l2/**/*.test.ts',
      'test/play/**/*.test.ts',
      'test/properties/**/*.test.ts',
      'test/toolchain/**/*.test.ts',
      'test/ai-tuning/**/*.test.ts',
    ],
    testTimeout: 20000,
    globals: false,
  },
});
