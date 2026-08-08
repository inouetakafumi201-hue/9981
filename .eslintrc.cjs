/**
 * 分层依赖方向规则（design.md 第2章）：L(n) 不得 import L(n+1..13)。
 * 层号映射：state/topology=1, expr=2, ops=3, events=4, flow=5, actions=6,
 * decision=7, attachment=8, schedule=9, random=10, knowledge=11, persistence=12, safety=13。
 */
const LAYER_ORDER = [
  ['state', 'topology'],
  ['expr'],
  ['ops'],
  ['events'],
  ['flow'],
  ['actions'],
  ['decision'],
  ['attachment'],
  ['schedule'],
  ['random'],
  ['knowledge'],
  ['persistence'],
  ['safety'],
];

function higherLayers(dirName) {
  const idx = LAYER_ORDER.findIndex((group) => group.includes(dirName));
  if (idx === -1) return [];
  return LAYER_ORDER.slice(idx + 1).flat();
}

const overrides = LAYER_ORDER.flat().map((dir) => {
  const forbidden = higherLayers(dir);
  return {
    files: [`src/core/kernel/${dir}/**/*.ts`],
    rules: {
      'no-restricted-imports': forbidden.length
        ? [
            'error',
            {
              patterns: forbidden.map((f) => ({
                group: [`**/kernel/${f}/**`, `**/kernel/${f}`],
                message: `分层依赖违规：kernel/${dir} (L) 不得 import kernel/${f}（更高层）。`,
              })),
            },
          ]
        : 'off',
    },
  };
});

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'import'],
  extends: ['eslint:recommended'],
  env: { es2022: true, node: true },
  rules: {
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
    ],
    // while(true) 扫描循环通过 return/throw 退出，不是真正的死循环。
    'no-constant-condition': ['error', { checkLoops: false }],
  },
  overrides: [
    ...overrides,
    {
      // 渲染层禁止 import kernel/ops、kernel/state 的可写接口（design.md 3.15节，需求40.5）
      files: ['src/scene/**/*.ts', 'src/scene/**/*.tsx', 'src/components/**/*.ts', 'src/components/**/*.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/kernel/ops/**', '**/kernel/ops', '**/kernel/state/**', '**/kernel/state'],
                message: '渲染层禁止直接 import kernel/ops 或 kernel/state 的可写接口，只能通过 PresentationGateway。',
              },
            ],
          },
        ],
      },
    },
    {
      // 玩法层禁止依赖编辑器（docs/L3_玩法层/06_创作系统与产权.md）。
      // 创作工具的产物是玩法层数据，但玩法层运行期不得反向依赖工具——否则发布出去的
      // 玩法包会拖着一整套编辑器 UI，且"没有编辑器也能跑"这条就不再成立。
      // 两者共用的纯计算（如 map/curve.ts 的折线简化）放在 src/play 下，由编辑器 import。
      files: ['src/play/**/*.ts', 'src/play/**/*.tsx'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/editor/**', '**/editor'],
                message:
                  '玩法层禁止 import 编辑器：编辑器产出玩法层数据，玩法层运行期不得反向依赖它。'
                  + '两者共用的纯计算请放在 src/play/map/ 下。',
              },
            ],
          },
        ],
      },
    },
  ],
};
