import type { CSSProperties } from 'react';

export const colors = {
  ink: '#0d1824',
  muted: '#627383',
  panel: '#f8fbfd',
  border: '#cfdae2',
  canvas: '#e7eff3',
  cyan: '#027f92',
  blue: '#3182ce',
  yellow: '#d69e2e',
  red: '#d74343',
  green: '#208860',
} as const;

export const cssVars: CSSProperties = {
  '--ink': colors.ink,
  '--muted': colors.muted,
  '--panel': colors.panel,
  '--border': colors.border,
  '--canvas': colors.canvas,
  '--cyan': colors.cyan,
  '--blue': colors.blue,
  '--yellow': colors.yellow,
  '--red': colors.red,
  '--green': colors.green,
} as CSSProperties;
