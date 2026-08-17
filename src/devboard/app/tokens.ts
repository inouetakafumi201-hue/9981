import type { CSSProperties } from 'react';
import { colors } from '../../design/tokens.js';

/**
 * devboard 呈现层令牌：直接把 `src/design/tokens.ts`（表现层唯一美学真相源）映射成 CSS 变量，
 * 供编辑器使用。与 tailwind 的 `--color-*` 语义同源，保证编辑器 UI 与游戏 HUD 用同一色板。
 */
export const cssVars: CSSProperties = Object.fromEntries(
  Object.entries(colors).map(([name, value]) => [`--${name}`, value]),
) as CSSProperties;

export { colors };
