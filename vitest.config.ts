import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // src/** 覆盖 L1 内核既有测试；test/l2/** 覆盖基类层规范测试；
    // test/properties/** 覆盖 design.md 的 14 个正确性性质（一性质一文件）；
    // test/toolchain/** 覆盖工具链自身的门禁范围不变量（PT-06 守卫，见 gate-coverage.test.ts）。
    include: [
      'src/**/*.test.ts',
      'test/l2/**/*.test.ts',
      'test/properties/**/*.test.ts',
      'test/toolchain/**/*.test.ts',
    ],
    testTimeout: 20000,
    globals: false,
  },
});
