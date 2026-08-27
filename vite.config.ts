import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发板独立构建（Vite）。与游戏运行时(零渲染内核)解耦；
// 入口是 src/devboard/index.html，只编译 devboard + 它只读消费的 src/play/map。
// 运行：npm run devboard  构建：npm run devboard:build
export default defineConfig({
  root: 'src/devboard',
  plugins: [react()],
  build: {
    outDir: '../../dist/devboard',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/devboard/editor-shell', import.meta.url)),
      '@map': fileURLToPath(new URL('./src/play/map', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
