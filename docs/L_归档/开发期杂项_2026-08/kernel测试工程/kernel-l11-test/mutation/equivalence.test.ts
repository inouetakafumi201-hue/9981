/**
 * 等价性模糊器的 vitest 入口。
 *
 * 为什么要一个 test 文件而不是脚本：本仓库没装 tsx / ts-node，
 * `.ts` 只能经 vitest 的转译管线执行。这也顺带解决了变体的动态 import——
 * `.tmp/v*.ts` 由 vite-node 转译，不需要额外的 loader。
 *
 * **不要把这个文件放进 test/ 目录。** 两个原因：
 *   - `vitest.config.ts` 的 include 是 `test/**\/*.test.ts`，放进去就会被
 *     `npm test` 带上，而模糊器的规模远超单元测试的时间预算；
 *   - 变异驱动器每杀一个变异体都要跑一遍套件，把模糊器混进去会让
 *     116 个变异体的运行时间失控。
 * 它只由 `npm run test:equiv`（vitest.equivalence.config.ts）驱动。
 */
import { afterAll, expect, it } from 'vitest';
import { cleanupVariants, runEquivalence } from './equivalence.ts';

// 变体目录必须清掉：残留文件会让下一次的 v<N>_<tag>.ts 命名撞上已存在的模块 id，
// 那时 import 拿到的是上一轮的缓存实例，注册表隔离随之失效。
afterAll(() => {
  cleanupVariants();
});

it(
  '等价性声明成立，且模糊器对同一条语句具备分辨力',
  async () => {
    const { lines, failures } = await runEquivalence();
    // 观测规模与哨兵命中情况始终打印：一次"通过"若不附带规模，
    // 与"什么都没跑"在输出上无法区分。
    for (const l of lines) console.log(l);
    expect(failures.join('\n\n'), failures.join('\n\n')).toBe('');
    // 防空转：至少要有"哨兵已抓到 ×2 + 等价体无分歧 ×1 + 规模行"这几条。
    expect(lines.length).toBeGreaterThanOrEqual(4);
  },
  20 * 60 * 1000,
);
