/** @type {import('tailwindcss').Config} */
// 从 src/design/tokens.ts 读语义色（唯一真相源，见 工程治理/02 §4.1）。
// tokens.ts 是 ESM+TS，Vite 可直接 import；config 本体保持 .cjs 避免 ts-node 依赖。
const { colors } = require('./src/design/tokens.cjs');

module.exports = {
  content: [
    './src/devboard/**/*.{ts,tsx,html}',
    './src/ui/**/*.{ts,tsx,html}',
    './src/components/**/*.{ts,tsx,html}',
    './src/scene/**/*.{ts,tsx,html}',
  ],
  theme: {
    extend: {
      colors,
      fontFamily: {
        pixel: ['"Press Start 2P"', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
