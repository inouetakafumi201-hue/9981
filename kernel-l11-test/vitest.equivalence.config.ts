import { defineConfig } from 'vitest/config';

/**
 * 等价性模糊器专用配置。
 *
 * 单独一个配置而不是并入 vitest.config.ts：模糊器的时间预算是分钟级，
 * 而单元套件是秒级；更要紧的是变异驱动器每杀一个变异体都会跑一遍套件，
 * 模糊器一旦混进去，116 个变异体的总时长会失控。
 *
 * 默认规模压到可日常跑的量级；要加压直接给环境变量，
 * 例如 `EQUIV_SEQS=2000 EQUIV_SENTINEL_SEQS=300 npm run test:equiv`。
 * 规模只影响信心强度，不影响结论方向——哨兵抓不到就是抓不到，加压也救不了。
 */
export default defineConfig({
  test: {
    include: ['mutation/equivalence.test.ts'],
    testTimeout: 20 * 60 * 1000,
    globals: false,
    env: {
      EQUIV_SEQS: process.env.EQUIV_SEQS ?? '2000',
      EQUIV_SENTINEL_SEQS: process.env.EQUIV_SENTINEL_SEQS ?? '300',
      EQUIV_OPS: process.env.EQUIV_OPS ?? '16',
    },
  },
});
