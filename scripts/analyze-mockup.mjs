import fs from 'fs';
import { createCanvas, loadImage } from 'canvas';

const img = await loadImage('run/ui-mockup/开发板/5f2a6147-f127-4810-b75f-24a62ab30466.png');
const canvas = createCanvas(img.width, img.height);
const ctx = canvas.getContext('2d');
ctx.drawImage(img, 0, 0);

// 采样关键区块的主色
const samples = {
  'topbar-bg': { x: 200, y: 30 },
  'left-panel-bg': { x: 50, y: 200 },
  'canvas-bg': { x: 600, y: 400 },
  'right-panel-bg': { x: 1350, y: 300 },
  'toolbar-bg': { x: 600, y: 95 },
  'bottom-panel-bg': { x: 600, y: 730 },
  'cyan-accent': { x: 30, y: 30 }, // W 标记
  'cyan-line': { x: 615, y: 220 }, // 青色连线
  'active-tool-bg': { x: 1312, y: 570 }, // 运行测试按钮
  'material-card-bg': { x: 1225, y: 250 },
  'selected-box': { x: 435, y: 240 }, // 月台场景框内部
};

console.log('=== 参考图色值提取 ===\n');
for (const [name, {x, y}] of Object.entries(samples)) {
  const px = ctx.getImageData(x, y, 1, 1).data;
  const rgb = `rgb(${px[0]}, ${px[1]}, ${px[2]})`;
  const hex = `#${px[0].toString(16).padStart(2,'0')}${px[1].toString(16).padStart(2,'0')}${px[2].toString(16).padStart(2,'0')}`;
  const rgba = `rgba(${px[0]}, ${px[1]}, ${px[2]}, ${(px[3]/255).toFixed(2)})`;
  console.log(`${name.padEnd(20)} @ (${x},${y}): ${hex.padEnd(8)} ${rgba}`);
}

console.log('\n=== 布局结构 (宽高) ===');
console.log(`总宽高: ${img.width} × ${img.height}`);
console.log(`顶栏: 0-65px`);
console.log(`左栏: 0-270px × 65-685px`);
console.log(`右栏: 1200-1429px × 65-685px`);
console.log(`工具栏: 270-1200px × 65-135px`);
console.log(`画布: 270-1200px × 135-685px`);
console.log(`底栏: 0-1429px × 685-800px`);
