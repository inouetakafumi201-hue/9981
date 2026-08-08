import { defineConfig } from 'vitest/config';

// 变异测试用的快速配置：只跑不依赖硬编码 numRuns 的三个套件。
// 属性测试轮数由 L7_RUNS 环境变量压低，单个变异体应在数秒内出结论。
export default defineConfig({
  test: {
    include: [
      'test/l7-model.test.ts',
      'test/l7-regression.test.ts',
      'test/l7-invariant-checker.test.ts'
    ],
    bail: 1,
    reporters: ['dot']
  }
});
