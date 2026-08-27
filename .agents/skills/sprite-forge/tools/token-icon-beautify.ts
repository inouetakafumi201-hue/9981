/**
 * 词条图标统一美化函数 · WakeUp 项目专用
 * 
 * 用途：给简笔 SVG 图标加上统一的高光、光晕、上色、边缘发光，保证全项目词条图标风格一致。
 * 不走 AI 生成，只做后处理——你可以从任何 SVG 图标库拿来源，这个函数负责把它变成 WakeUp 风格。
 * 
 * 核心约束（来自 docs/表现系统/01_图形化与UI.md 与 docs/v0-dev-material-library-spec.md）：
 * - 语义色映射：青/绿/黄/橙/红/紫/珊瑚/蓝/灰/金银
 * - 边缘发光：可交互物体必须有边缘发光，颜色对应语义
 * - 方形容器：固定尺寸（32×32 或 64×64），固定留白，固定居中
 * - 高光与阴影：顶部 45° 高光渐变 + 底部暗区，模拟左上光源
 * - 光晕：可选的外发光层（glow），用于强调态或激活态
 * 
 * 依赖：无外部依赖，纯 canvas 操作（浏览器环境）或 node-canvas（Node 环境）
 */

// ---------------------------------------------------------------- 颜色语义表 ----

/**
 * WakeUp 全局颜色语义映射（权威来源：docs/表现系统/01_图形化与UI.md §1）
 * 每种词条类型映射到一个主色 + 可选的次要高光色
 */
export const TOKEN_SEMANTIC_COLORS = {
  // 属性词条（attribute）：青色（社交/交流/UGC）
  attribute: { primary: '#06b6d4', glow: '#22d3ee', shadow: '#0e7490' },
  
  // 技能词条（skill）：橙色（行动/AP）
  skill: { primary: '#dd6b20', glow: '#f97316', shadow: '#9a3412' },
  
  // 状态词条（status）：黄色（感官/警戒）
  status: { primary: '#d69e2e', glow: '#f59e0b', shadow: '#92400e' },
  
  // 防御词条（defense）：绿色（安全/正面）
  defense: { primary: '#38a169', glow: '#10b981', shadow: '#065f46' },
  
  // 机动词条（mobility）：紫色（关系约束/远程）
  mobility: { primary: '#9333ea', glow: '#a855f7', shadow: '#581c87' },
  
  // 伤害词条（damage）：红色（生命减损/伤害）
  damage: { primary: '#e53e3e', glow: '#ef4444', shadow: '#991b1b' },
  
  // 近战词条（melee）：珊瑚色（近战/格斗）
  melee: { primary: '#f56565', glow: '#fb7185', shadow: '#9f1239' },
  
  // 体力词条（stamina）：蓝色（清醒度/体力）
  stamina: { primary: '#3b82f6', glow: '#60a5fa', shadow: '#1e3a8a' },
  
  // 高级/稀有词条：金色高光
  legendary: { primary: '#d4af37', glow: '#fbbf24', shadow: '#78350f' },
  
  // 中立/通用词条：灰白（可交互但受制于状态）
  neutral: { primary: '#f3f4f6', glow: '#ffffff', shadow: '#6b7280' },
} as const;

export type TokenType = keyof typeof TOKEN_SEMANTIC_COLORS;

// ---------------------------------------------------------------- 美化配置 ----

export interface BeautifyConfig {
  /** 词条类型（决定语义色） */
  type: TokenType;
  
  /** 输出尺寸（像素） */
  size: 32 | 64;
  
  /** 是否添加边缘发光（默认 false，悬停/激活时 true） */
  withGlow: boolean;
  
  /** 光晕强度（0-1，默认 0.6） */
  glowIntensity: number;
  
  /** 高光强度（0-1，默认 0.4） */
  highlightIntensity: number;
  
  /** 阴影强度（0-1，默认 0.3） */
  shadowIntensity: number;
  
  /** 图标留白比例（0-1，默认 0.15 = 图标占 70% 中心区） */
  padding: number;
  
  /** 背景色（默认透明） */
  backgroundColor: string | null;
}

export const DEFAULT_CONFIG: BeautifyConfig = {
  type: 'neutral',
  size: 64,
  withGlow: false,
  glowIntensity: 0.6,
  highlightIntensity: 0.4,
  shadowIntensity: 0.3,
  padding: 0.15,
  backgroundColor: null,
};

// ---------------------------------------------------------------- 核心函数 ----

/**
 * 美化 SVG 图标 → 带高光、光晕、语义色的成品 tile
 * 
 * @param sourceSvg - 源 SVG 字符串或 data URL
 * @param config - 美化配置
 * @returns Promise<string> - data URL（PNG）
 */
export async function beautifyTokenIcon(
  sourceSvg: string,
  config: Partial<BeautifyConfig> = {}
): Promise<string> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const colors = TOKEN_SEMANTIC_COLORS[cfg.type];
  const { size, padding } = cfg;
  
  // 创建离屏 canvas
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  
  // 1. 背景层
  if (cfg.backgroundColor) {
    ctx.fillStyle = cfg.backgroundColor;
    ctx.fillRect(0, 0, size, size);
  }
  
  // 2. 外发光层（可选）
  if (cfg.withGlow) {
    drawGlow(ctx, size, colors.glow, cfg.glowIntensity);
  }
  
  // 3. 加载并绘制源 SVG（应用语义色）
  const iconSize = size * (1 - padding * 2);
  const iconOffset = size * padding;
  await drawSvgWithColor(ctx, sourceSvg, iconOffset, iconOffset, iconSize, colors.primary);
  
  // 4. 顶部高光层
  drawHighlight(ctx, iconOffset, iconOffset, iconSize, cfg.highlightIntensity);
  
  // 5. 底部阴影层
  drawShadow(ctx, iconOffset, iconOffset, iconSize, colors.shadow, cfg.shadowIntensity);
  
  // 6. 边缘描边（语义色）
  if (cfg.withGlow) {
    drawEdgeStroke(ctx, iconOffset, iconOffset, iconSize, colors.primary);
  }
  
  return canvas.toDataURL('image/png');
}

/**
 * 绘制外发光层（径向渐变）
 */
function drawGlow(
  ctx: CanvasRenderingContext2D,
  size: number,
  glowColor: string,
  intensity: number
): void {
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, size * 0.2,
    size / 2, size / 2, size * 0.6
  );
  
  gradient.addColorStop(0, `${glowColor}${Math.round(intensity * 0.8 * 255).toString(16).padStart(2, '0')}`);
  gradient.addColorStop(0.5, `${glowColor}${Math.round(intensity * 0.4 * 255).toString(16).padStart(2, '0')}`);
  gradient.addColorStop(1, `${glowColor}00`);
  
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
}

/**
 * 加载 SVG 并绘制，应用语义色
 */
async function drawSvgWithColor(
  ctx: CanvasRenderingContext2D,
  svgSource: string,
  x: number,
  y: number,
  size: number,
  color: string
): Promise<void> {
  // 如果是 data URL 或 URL，直接加载；否则当作 SVG 字符串
  const svgUrl = svgSource.startsWith('data:') || svgSource.startsWith('http')
    ? svgSource
    : `data:image/svg+xml;base64,${btoa(svgSource)}`;
  
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // 应用语义色（通过 globalCompositeOperation）
      ctx.save();
      ctx.drawImage(img, x, y, size, size);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = color;
      ctx.fillRect(x, y, size, size);
      ctx.restore();
      resolve();
    };
    img.onerror = reject;
    img.src = svgUrl;
  });
}

/**
 * 绘制顶部高光（45° 线性渐变，左上到右下）
 */
function drawHighlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  intensity: number
): void {
  const gradient = ctx.createLinearGradient(x, y, x + size * 0.5, y + size * 0.5);
  gradient.addColorStop(0, `rgba(255, 255, 255, ${intensity})`);
  gradient.addColorStop(0.5, `rgba(255, 255, 255, ${intensity * 0.3})`);
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, size, size);
  ctx.restore();
}

/**
 * 绘制底部阴影（暗色渐变，右下到左上）
 */
function drawShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  shadowColor: string,
  intensity: number
): void {
  const gradient = ctx.createLinearGradient(x + size, y + size, x + size * 0.5, y + size * 0.5);
  
  // 解析 shadowColor 的 RGB
  const r = parseInt(shadowColor.slice(1, 3), 16);
  const g = parseInt(shadowColor.slice(3, 5), 16);
  const b = parseInt(shadowColor.slice(5, 7), 16);
  
  gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${intensity})`);
  gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${intensity * 0.3})`);
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, size, size);
  ctx.restore();
}

/**
 * 绘制边缘描边（语义色，细线）
 */
function drawEdgeStroke(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  strokeColor: string
): void {
  ctx.save();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.8;
  ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
  ctx.restore();
}

// ---------------------------------------------------------------- 批量生成辅助 ----

/**
 * 批量美化图标：给一组 SVG 源应用相同配置
 */
export async function beautifyBatch(
  sources: Array<{ id: string; svg: string; type: TokenType }>,
  baseConfig: Partial<BeautifyConfig> = {}
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  
  for (const { id, svg, type } of sources) {
    const dataUrl = await beautifyTokenIcon(svg, { ...baseConfig, type });
    results.set(id, dataUrl);
  }
  
  return results;
}

// ---------------------------------------------------------------- 使用示例 ----

/*
// 示例 1：单个图标美化（交互态）
const interactiveIcon = await beautifyTokenIcon(simpleSvgString, {
  type: 'skill',
  size: 64,
  withGlow: true, // 悬停或激活态
  glowIntensity: 0.7,
});

// 示例 2：批量生成词条图标
const tokenSources = [
  { id: 'strength', svg: '<svg>...</svg>', type: 'attribute' },
  { id: 'fireball', svg: '<svg>...</svg>', type: 'skill' },
  { id: 'poisoned', svg: '<svg>...</svg>', type: 'status' },
];

const beautified = await beautifyBatch(tokenSources, { size: 64, withGlow: false });

// 示例 3：从外部 SVG 图标库加载
const externalSvgUrl = 'https://example.com/icons/sword.svg';
const beautifiedSword = await beautifyTokenIcon(externalSvgUrl, {
  type: 'melee',
  size: 32,
});
*/
