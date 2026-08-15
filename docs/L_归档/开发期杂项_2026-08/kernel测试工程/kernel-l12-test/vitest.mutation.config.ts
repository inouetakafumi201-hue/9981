import { defineConfig } from 'vitest/config';

/**
 * 变异测试专用配置：套件要跑上百遍，属性测试规模由 L12_RUNS 收缩。
 *
 * 超时刻意留短（20s）：去掉 visited 之类的变异体会让链查找爆炸式增长，
 * 超时本身就是"测试发现了问题"的一种形式，但不能拖垮整轮。
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    globals: false,
    reporters: ['basic'],
  },
});
