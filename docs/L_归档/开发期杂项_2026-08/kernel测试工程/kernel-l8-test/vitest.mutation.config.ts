import { defineConfig } from 'vitest/config';

/**
 * 变异测试专用配置。
 *
 * **刻意排除 l8-property.test.ts**。理由不是它慢（虽然它确实是 22 万次），
 * 而是它的规模写死在文件里（numRuns: 100000 硬编码），收缩不了；
 * 若把它纳入，每个变异体都要跑满 22 万次，一轮 96 个变异体不可接受。
 *
 * 代价是诚实的：只被原套件杀掉、新套件杀不掉的变异体会显示为**存活**。
 * 这正是想要的读数——本轮衡量的是**重建后的三个套件**有多少判别力，
 * 而不是"总有人能杀掉它"。原套件保持原样、独立跑（npm test 里仍全量执行）。
 *
 * 超时留短（20s）：破坏幂等一类的变异体会让级联互相递归，
 * 超时本身就是"测试发现了问题"的一种形式，但不能拖垮整轮。
 */
export default defineConfig({
  test: {
    include: [
      'test/l8-shadow.test.ts',
      'test/l8-invariant-checker.test.ts',
      'test/l8-regression.test.ts',
    ],
    testTimeout: 20_000,
    globals: false,
    reporters: ['basic'],
  },
});
