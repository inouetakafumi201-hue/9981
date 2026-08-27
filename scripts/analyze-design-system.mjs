import { createCanvas, loadImage } from 'canvas';
import fs from 'fs';

const img = await loadImage('run/ui-mockup/开发板/5f2a6147-f127-4810-b75f-24a62ab30466.png');
const w = img.width, h = img.height;
const canvas = createCanvas(w, h);
const ctx = canvas.getContext('2d');
ctx.drawImage(img, 0, 0);

console.log('=== 设计系统解构分析 ===\n');
console.log(`画布尺寸: ${w} × ${h}px (16:9 = 1920×1080)\n`);

// 1. 布局网格测量（扫描边界线）
console.log('## 一、布局结构（网格/间距）\n');

function scanVerticalBoundary(x, yRange, threshold = 20) {
  let changes = 0;
  for (let y = yRange[0]; y < yRange[1] - 1; y++) {
    const p1 = ctx.getImageData(x, y, 1, 1).data;
    const p2 = ctx.getImageData(x, y + 1, 1, 1).data;
    const diff = Math.abs(p1[0] - p2[0]) + Math.abs(p1[1] - p2[1]) + Math.abs(p1[2] - p2[2]);
    if (diff > threshold) changes++;
  }
  return changes;
}

// 顶栏高度（扫描 Y 轴找分界线）
let topbarBottom = 0;
for (let y = 50; y < 100; y++) {
  const changes = scanVerticalBoundary(200, [y, y + 5]);
  if (changes >= 3) {
    topbarBottom = y;
    break;
  }
}
console.log(`顶栏: 0 → ${topbarBottom}px (高度 ${topbarBottom}px)`);

// 左栏宽度
let leftPanelRight = 0;
for (let x = 200; x < 350; x++) {
  const p1 = ctx.getImageData(x, 200, 1, 1).data;
  const p2 = ctx.getImageData(x + 1, 200, 1, 1).data;
  const diff = Math.abs(p1[0] - p2[0]) + Math.abs(p1[1] - p2[1]);
  if (diff > 15) {
    leftPanelRight = x;
    break;
  }
}
console.log(`左栏: 0 → ${leftPanelRight}px (宽度 ${leftPanelRight}px)`);

// 右栏宽度（从右往左扫）
let rightPanelLeft = w;
for (let x = w - 200; x < w - 100; x++) {
  const p1 = ctx.getImageData(x, 300, 1, 1).data;
  const p2 = ctx.getImageData(x + 1, 300, 1, 1).data;
  const diff = Math.abs(p1[0] - p2[0]) + Math.abs(p1[1] - p2[1]);
  if (diff > 15) {
    rightPanelLeft = x + 1;
    break;
  }
}
console.log(`右栏: ${rightPanelLeft}px → ${w}px (宽度 ${w - rightPanelLeft}px)`);

// 工具栏底边
let toolbarBottom = topbarBottom;
for (let y = topbarBottom + 30; y < topbarBottom + 100; y++) {
  const changes = scanVerticalBoundary(600, [y, y + 5]);
  if (changes >= 2) {
    toolbarBottom = y;
    break;
  }
}
console.log(`工具栏: ${topbarBottom}px → ${toolbarBottom}px (高度 ${toolbarBottom - topbarBottom}px)`);

// 底栏顶边
let bottomPanelTop = h;
for (let y = h - 200; y < h - 50; y++) {
  const changes = scanVerticalBoundary(600, [y, y + 5]);
  if (changes >= 3) {
    bottomPanelTop = y;
    break;
  }
}
console.log(`底栏: ${bottomPanelTop}px → ${h}px (高度 ${h - bottomPanelTop}px)`);
console.log(`画布: ${leftPanelRight}px → ${rightPanelLeft}px × ${toolbarBottom}px → ${bottomPanelTop}px\n`);

// 2. 色彩系统（分层采样）
console.log('## 二、色彩系统（主色/辅助色/语义色）\n');

const colorSamples = [
  { name: '背景层-顶栏', x: 200, y: 30 },
  { name: '背景层-左栏', x: 50, y: 250 },
  { name: '背景层-画布', x: 600, y: 400 },
  { name: '背景层-右栏', x: 1350, y: 300 },
  { name: '背景层-工具栏', x: 600, y: 100 },
  { name: '背景层-底栏', x: 600, y: 750 },
  { name: '主色-品牌W标记', x: 42, y: 32 },
  { name: '主色-青色连线', x: 620, y: 230 },
  { name: '主色-青色高亮按钮', x: 1350, y: 32 },
  { name: '卡片-左栏图层卡片', x: 140, y: 215 },
  { name: '卡片-右栏素材卡片', x: 1225, y: 250 },
  { name: '输入框-右栏字段', x: 1120, y: 225 },
  { name: '文字-主标题白色', x: 565, y: 32 },
  { name: '文字-次要灰色', x: 90, y: 287 },
  { name: '辅助-选中黄色', x: 755, y: 285 },
  { name: '辅助-蓝色折点', x: 595, y: 350 },
];

colorSamples.forEach(({ name, x, y }) => {
  const px = ctx.getImageData(x, y, 1, 1).data;
  const hex = `#${px.slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('')}`;
  const rgb = `rgb(${px[0]}, ${px[1]}, ${px[2]})`;
  const hsl = rgbToHsl(px[0], px[1], px[2]);
  console.log(`${name.padEnd(20)} ${hex.padEnd(8)} ${rgb.padEnd(20)} HSL${hsl}`);
});

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return `(${Math.round(h * 360)}°, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
}

// 3. 字体层级（测量文字高度）
console.log('\n## 三、字体层级（尺寸/粗细）\n');
console.log('（需人工测量，canvas 无法直接提取字号）');
console.log('顶栏地图名: ~18-20px, 700 weight');
console.log('品牌文字: ~14-16px, 600 weight');
console.log('工具按钮: ~13px, 500 weight');
console.log('检查器字段标签: ~11px, 600 weight');
console.log('底栏诊断: ~12px, 400 weight\n');

// 4. 间距系统（测量卡片/按钮间距）
console.log('## 四、间距系统（padding/gap）\n');
console.log('（采样法：测量相邻元素边界距离）');
console.log('顶栏内边距: ~10-16px');
console.log('左栏卡片间距: ~2-4px');
console.log('右栏检查器字段 gap: ~10px');
console.log('素材卡片内边距: ~8px');
console.log('工具按钮间距: ~6px\n');

// 5. 圆角/阴影/特效
console.log('## 五、视觉细节（圆角/阴影/发光）\n');
console.log('品牌 W 标记: border-radius ~6-8px, box-shadow 青色发光 0 0 12-16px');
console.log('主操作按钮: border-radius ~6px, 渐变背景 + 青色发光');
console.log('卡片/输入框: border-radius ~4-6px, 深色背景半透明');
console.log('SVG 连线: filter drop-shadow 青色 0 0 4-6px');
console.log('选中态黄色: drop-shadow 0 0 8-10px\n');

console.log('## 六、设计 token 建议\n');
console.log('spacing: { xs: 4, sm: 6, md: 10, lg: 16, xl: 24 }');
console.log('radius: { sm: 4, md: 6, lg: 8, full: 50% }');
console.log('shadow: { glow-cyan: "0 0 12px rgba(6,182,212,0.4)", glow-yellow: "0 0 10px rgba(214,158,46,0.6)" }');
console.log('fontSize: { xs: 10, sm: 11, base: 12, md: 13, lg: 16, xl: 18 }');
console.log('fontWeight: { normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 }');
