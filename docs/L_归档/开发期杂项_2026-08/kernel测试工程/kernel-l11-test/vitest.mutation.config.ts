import { defineConfig } from 'vitest/config';

/**
 * 变异测试专用配置：只跑本轮重建新增的三个文件。
 *
 * **刻意排除 l11-property.test.ts。** 理由不是它慢，而是它的规模写死在文件里
 * （四个 `numRuns: 100000` 硬编码），收缩不了；一个变异体就要跑 42 万次，
 * 96 个变异体不可能在合理时间内跑完。
 *
 * 代价是诚实的：只被原套件杀掉、新套件杀不掉的变异体会显示为**存活**。
 * 这是想要的方向——原套件的 42 万次已被探针证明有大片空转
 * （8 条检查器子句 0 命中、两条属性输入空间 29、catch 块 0 次触发），
 * 让新套件独立承担判别力才能量出它自己的水平。
 */
export default defineConfig({
  test: {
    include: [
      'test/l11-shadow.test.ts',
      'test/l11-invariant-checker.test.ts',
      'test/l11-regression.test.ts',
    ],
    testTimeout: 20_000,
    globals: false,
  },
});
