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
      colors: {
        ...colors,
        // 壳层语义色映射（对接 editor-shell/app/globals.css :root 变量）
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        panel: 'var(--panel)',
        'panel-raised': 'var(--panel-raised)',
        'panel-inset': 'var(--panel-inset)',
        card: 'var(--card)',
        'card-foreground': 'var(--card-foreground)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        muted: 'var(--muted)',
        'muted-foreground': 'var(--muted-foreground)',
        primary: 'var(--primary)',
        'primary-foreground': 'var(--primary-foreground)',
        'primary-dim': 'var(--primary-dim)',
        edge: 'var(--edge)',
        'edge-selected': 'var(--edge-selected)',
        'box-mask': 'var(--box-mask)',
        'box-physics': 'var(--box-physics)',
        transition: 'var(--transition)',
        success: 'var(--success)',
        warning: 'var(--warning)',
      },
      fontFamily: {
        pixel: ['"Press Start 2P"', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
