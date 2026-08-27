/** 独立开发板入口：Vite 挂载 v0 壳。 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ShellPage from './editor-shell/app/page';
import './editor-shell/app/globals.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

createRoot(container).render(
  <StrictMode>
    <ShellPage />
  </StrictMode>,
);
