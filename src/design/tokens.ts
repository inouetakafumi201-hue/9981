import type { CSSProperties } from 'react';

/**
 * Design Tokens —— 表现层唯一美学真相源。
 *
 * 这里的颜色与 `docs/表现系统/01_图形化与UI.md` 五条视觉定律的颜色语义映射一一对应；
 * tailwind.config.cjs 把本文件（CJS 镜像 tokens.cjs）挂进 Tailwind（颜色名 = 语义名，
 * 如 `bg-damage` / `text-social`）。代码里禁止出现 tokens 之外的裸色值
 * （见 `docs/工程治理/02_技术栈与开发流程.md` §4.1）。改动颜色先改这里，再同步 tokens.cjs。
 */
export const colors = {
  // —— 五条视觉定律的语义色 ——
  damage: '#e53e3e', // 红：生命减损、伤害、致命危险
  stamina: '#3182ce', // 蓝：清醒度、体力（清醒值/SP）、科技、处决
  alert: '#d69e2e', // 黄：感官、注意、警戒
  action: '#dd6b20', // 橙：行动点 / AP、行动消耗及进度
  safe: '#38a169', // 绿：安全、正面交互、免费与让利
  constraint: '#805ad5', // 紫：关系约束、局部菜单替换、远程
  melee: '#ed64a6', // 珊瑚：近战、格斗、攻击性行为、暴力
  social: '#06b6d4', // 青：社交、交流、UGC/创意工坊来源与创作物
  cooldown: '#718096', // 灰：冷却、延迟、不会立刻生效
  interactive: '#f3f4f6', // 灰白：可交互但受制于当前状态（高光/材质）
  dream: '#ffffff', // 纯白/奶白：梦境边界与过载概念色
  gold: '#d4af37', // 金：区别性品级高光
  silver: '#a8b2bd', // 银：区别性品级高光
  ink: '#0d1824',
  muted: '#627383',
  panel: '#f8fbfd',
  border: '#cfdae2',
  canvas: '#e7eff3',
} as const;

export type SemanticColor = keyof typeof colors;

/** 映射成 CSS 变量（devboard 现有消费方式，保留兼容）。 */
export const cssVars: CSSProperties = Object.fromEntries(
  Object.entries(colors).map(([name, value]) => [`--${name}`, value]),
) as CSSProperties;
