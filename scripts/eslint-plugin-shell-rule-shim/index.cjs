// V0 壳层 ESLint 规则垫片（ESLint 8 的 legacy 内联注释与 plugin 缺席组合的
// 已知边界：config 里置 off 的规则若插件未装，disable 注释所在行仍报
// "Definition for rule ... was not found"。壳层按 V0 原文保留这些注释，
// 这里注册一个 no-op 规则定义，让注释与 config 的 off 都成立。
'use strict';

const rule = {
  meta: { type: 'problem', schema: [] },
  create() {
    return {};
  },
};

module.exports = {
  rules: {
    'react-hooks/exhaustive-deps': rule,
  },
};
