/** 独立开发板入口：只消费 `src/play/map` 契约，不被游戏运行时反向依赖。 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorApp } from './app/EditorApp.js';
import './app/index.css';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <EditorApp />
    </StrictMode>,
  );
}
