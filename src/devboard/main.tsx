/**
 * 开发板入口（Vite + React + TS 壳）。
 *
 * 独立 Web 应用，游戏运行时零依赖（除 devboard 自有 + 只读消费 src/play/map 契约）。
 * 由 `npm run devboard` / `npm run devboard:build` 启动/构建；入口由 vite.config.ts 指向本目录。
 */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createDeveloperHook } from './ports/material-availability.js';

function DevBoardApp(): JSX.Element {
  const [currentLayerId, setCurrentLayerId] = useState<string | null>(null);
  const hook = createDeveloperHook();
  const layerCount = currentLayerId ? 1 : 0;

  return (
    <div>
      <h1>WakeUp 开发板</h1>
      <p>当前图层：{currentLayerId ?? '（无图层）'}</p>
      <p>素材可用判定：{hook.isAvailable('*') ? '全放行（开发者权限）' : '受限'}</p>
      <button onClick={() => setCurrentLayerId('layer:0')}>切换到 layer:0</button>
      <p>图层计数：{layerCount}</p>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <DevBoardApp />
    </StrictMode>,
  );
}
