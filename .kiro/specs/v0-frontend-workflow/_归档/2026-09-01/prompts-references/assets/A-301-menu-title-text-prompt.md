# 标题画面（开始菜单）UI 样图提示词

> **目标**：风格统一、抓眼、定调全局 UI 基调。不追求零素材渲染，可用成品素材/纹理/光效强化视觉冲击力。

---

## 提示词（中文版）

一张完整的游戏标题画面 UI 样图，**1920×1080 分辨率**，**深度克制的赛博朋克心理惊悚风格**，强调**梦境侵蚀与记忆破碎**的视觉母题。

### 背景层（占据全屏，视觉冲击核心）

- **主背景**：低饱和度、高对比的**全息投影式抽象几何光层**——深邃的**午夜蓝到墨黑渐变**（#0A0E27 → #050508），叠加**半透明的青色与冰蓝色光束**（#22D3EE / #38BDF8）从画面左上斜切扫过，形成**不规则的多边形光栅区块**。
- **纹理与细节**：
  - 背景深处有**极细的扫描线纹理**（1px 横向，间距 3-4px，不透明度 8%），营造 CRT 显示器与老旧监视器的氛围。
  - **微弱的噪点粒子层**（grain noise, 不透明度 12%），增加胶片质感与不安感。
  - **破碎玻璃/裂纹纹理**局部叠加于光层交界处（不透明度 15%），暗示**记忆碎片与梦境侵蚀**。
- **光效**：
  - 画面中心偏左有一个**巨大的冷光源光晕**（径向渐变，中心接近纯白 #FCFCFC，外围快速衰减到透明），模拟**梦境入口 / 意识深渊**的视觉隐喻。
  - **边缘暗角**（vignette）明显，四角压暗 30%，将视线聚焦到中央标题与菜单区。

### 标题字（画面上部 1/3 处，视觉焦点）

- **文字内容**：`WakeUp`（英文）或 `觉醒协议`（中文，根据版本选择；建议英文为主）。
- **字体风格**：**几何无衬线粗体**（类似 Neue Haas Grotesk / Sora / Orbitron），**字重 700-900**，极强存在感。
- **视觉处理**：
  - 字体颜色为**冰冷的青白色**（#E0F7FA），带有**强烈的外发光**（outer glow, 颜色 #22D3EE，扩散半径 40-60px，不透明度 80%），模拟**冷光全息投影质感**。
  - 字体边缘有**细微的色差/色散效果**（chromatic aberration），红/青通道微错位（±2px），增强**电子故障与不稳定感**。
  - 标题字下方有一条**细长的装饰性扫描线**（宽 2px，长度约为标题宽度的 120%，青色 #22D3EE，两端淡出），缓慢左右平移（可选动画提示）。
- **额外装饰**：
  - 标题字左上角有一组**小型几何 UI 装饰元素**（如：小方块、线框、角标，颜色 #38BDF8 / #F97316，不透明度 60%），模拟**扫描界面/诊断界面**的信息窗口。

### 菜单区（画面中央偏下，垂直排列四入口）

- **布局**：四个菜单项垂直居中对齐，间距均匀（建议每项高度 60-80px，间距 20-30px）。
- **菜单项文字**：`新游戏` / `继续` / `选项` / `退出`（或对应英文 `NEW GAME` / `CONTINUE` / `OPTIONS` / `QUIT`）。
- **字体**：同标题字体家族，但字重降到 500-600，字号约为标题的 1/3。
- **默认态（未悬停）**：
  - 文字颜色为**冷灰白**（#B0BEC5），不透明度 85%。
  - 左侧有一条**极细的装饰线**（宽 2px，长度 30-40px，颜色 #546E7A，不透明度 50%），与文字左对齐。
  - **无背景填充**，保持半透明，让背景光层透出。
- **悬停态（hover，视觉重点）**：
  - 文字颜色切换到**明亮的青色**（#22D3EE），不透明度 100%。
  - 左侧装饰线**延长**（→80-100px）并**加粗**（→4px），颜色变为**明亮的橙色**（#F97316），模拟**激活/就绪**状态。
  - 文字本身**轻微右移**（translateX +8px），并出现**微弱的边缘发光**（text-shadow: 0 0 12px #22D3EE）。
  - 菜单项后方（右侧）出现一个**半透明的角标装饰**（如三角形 / 箭头 / 小方块，颜色 #F97316，不透明度 60%），增强可点击感。
- **禁用态（如无存档时的 `继续`）**：
  - 文字颜色降到**深灰**（#37474F），不透明度 40%。
  - 左侧装饰线完全隐藏或变为虚线。
  - **扁平、无发光、无高光**，与可交互项形成强烈对比。

### 底部装饰与版本信息（画面底部）

- **版本号**：右下角显示小字版本信息（如 `v0.1.0 alpha` / `Build 2026.08.19`），字体极小（12-14px），颜色 #546E7A，不透明度 50%。
- **底部装饰线**：屏幕底部有一条**水平的细扫描线**（宽 1px，颜色 #22D3EE，不透明度 30%），从左到右贯穿，两端淡出。

### 整体氛围与色彩约束

- **主色调**：深邃的**午夜蓝/墨黑**（背景）+ **冰蓝/青色**（交互高光）+ **橙色**（激活状态）。
- **禁止**：鲜艳的粉色、紫色、绿色；温暖的黄色（除橙色外）；任何柔和/可爱/梦幻风格的配色。
- **氛围关键词**：冷峻、克制、电子、侵蚀、不安、深度、记忆碎片、全息投影、扫描界面、心理惊悚、赛博朋克、CRT 显示器。

### 可选增强元素（如需更强视觉冲击）

- **粒子/光点**：背景中有少量缓慢漂浮的**小光点**（直径 2-4px，颜色 #22D3EE / #38BDF8，不透明度 30-60%），模拟**数据流 / 记忆碎片**，增加动态感（静态图可用模糊暗示运动轨迹）。
- **角落信息 UI**：左上角或右上角可添加**小型诊断界面装饰框**（矩形线框 + 内部伪代码文本 + 小进度条，颜色 #38BDF8，不透明度 40%），模拟**系统监控/梦境诊断**界面，增强沉浸感。
- **破碎立绘剪影**（可选）：背景最深处（Z 轴最后）可放置一个**极淡的人物剪影**（不透明度 8-12%，仅轮廓，无细节），暗示**主角 / 入梦者**，但不能抢占标题与菜单的视觉焦点。

---

## 提示词（英文版 / English Version）

A complete game title screen UI mockup, **1920×1080 resolution**, in a **deeply restrained cyberpunk psychological thriller style**, emphasizing the visual motif of **dream erosion and shattered memory**.

### Background Layer (Full-screen, Visual Impact Core)

- **Main Background**: Low-saturation, high-contrast **holographic abstract geometric light layers** — a deep **midnight blue to ink-black gradient** (#0A0E27 → #050508), overlaid with **semi-transparent cyan and ice-blue light beams** (#22D3EE / #38BDF8) sweeping diagonally from the upper left, forming **irregular polygonal raster blocks**.
- **Texture & Details**:
  - **Ultra-fine scanline texture** in the background depth (1px horizontal, 3-4px spacing, 8% opacity), evoking CRT monitors and old surveillance screens.
  - **Subtle grain noise layer** (12% opacity) to add film texture and unease.
  - **Shattered glass / crack texture** locally overlaid at light layer boundaries (15% opacity), hinting at **memory fragments and dream erosion**.
- **Light Effects**:
  - A **massive cold light halo** (radial gradient, center near pure white #FCFCFC, rapidly fading to transparent outward) in the center-left, simulating the visual metaphor of **dream portal / consciousness abyss**.
  - **Strong edge vignette**, corners darkened by 30%, focusing the eye on the central title and menu area.

### Title Text (Upper 1/3, Visual Focus)

- **Text Content**: `WakeUp` (English) or `觉醒协议` (Chinese, version-dependent; English recommended as primary).
- **Font Style**: **Geometric sans-serif bold** (like Neue Haas Grotesk / Sora / Orbitron), **weight 700-900**, extremely strong presence.
- **Visual Treatment**:
  - Font color: **icy cyan-white** (#E0F7FA), with **strong outer glow** (color #22D3EE, spread 40-60px, 80% opacity), simulating **cold holographic projection texture**.
  - Font edges have **subtle chromatic aberration**, red/cyan channels slightly offset (±2px), enhancing **electronic glitch and instability**.
  - Below the title, a **thin decorative scanline** (2px wide, ~120% of title width, cyan #22D3EE, fading at ends), slowly panning left-right (optional animation hint).
- **Additional Decoration**:
  - Upper-left of title has a cluster of **small geometric UI decorative elements** (e.g., small squares, wireframes, corner marks, colors #38BDF8 / #F97316, 60% opacity), simulating **scan interface / diagnostic interface** info windows.

### Menu Area (Center-bottom, Four Vertically Stacked Entries)

- **Layout**: Four menu items vertically centered, evenly spaced (recommended 60-80px height per item, 20-30px spacing).
- **Menu Item Text**: `新游戏` / `继续` / `选项` / `退出` (or English equivalents: `NEW GAME` / `CONTINUE` / `OPTIONS` / `QUIT`).
- **Font**: Same title font family, weight reduced to 500-600, size ~1/3 of title.
- **Default State (Non-hover)**:
  - Text color: **cold gray-white** (#B0BEC5), 85% opacity.
  - Left side has an **ultra-thin decorative line** (2px wide, 30-40px length, color #546E7A, 50% opacity), aligned with text left edge.
  - **No background fill**, keep semi-transparent to let background light layers show through.
- **Hover State (Visual Highlight)**:
  - Text color switches to **bright cyan** (#22D3EE), 100% opacity.
  - Left decorative line **extends** (→80-100px) and **thickens** (→4px), color changes to **bright orange** (#F97316), simulating **activated / ready** state.
  - Text itself **shifts slightly right** (translateX +8px), with **subtle edge glow** (text-shadow: 0 0 12px #22D3EE).
  - A **semi-transparent corner mark** (e.g., triangle / arrow / small square, color #F97316, 60% opacity) appears on the right side behind the menu item, enhancing clickability.
- **Disabled State (e.g., `CONTINUE` with no save)**:
  - Text color drops to **deep gray** (#37474F), 40% opacity.
  - Left decorative line completely hidden or changed to dashed.
  - **Flat, no glow, no highlight**, strong contrast with interactive items.

### Bottom Decoration & Version Info

- **Version Number**: Bottom-right corner shows small version text (e.g., `v0.1.0 alpha` / `Build 2026.08.19`), tiny font (12-14px), color #546E7A, 50% opacity.
- **Bottom Decorative Line**: A **horizontal thin scanline** (1px wide, color #22D3EE, 30% opacity) spans from left to right across the bottom, fading at ends.

### Overall Atmosphere & Color Constraints

- **Primary Palette**: Deep **midnight blue / ink-black** (background) + **ice-blue / cyan** (interactive highlights) + **orange** (activated state).
- **Forbidden**: Vivid pink, purple, green; warm yellow (except orange); any soft / cute / dreamy style palettes.
- **Atmosphere Keywords**: Cold, restrained, electronic, erosion, unease, depth, memory fragments, holographic projection, scan interface, psychological thriller, cyberpunk, CRT monitor.

### Optional Enhancement Elements (For Stronger Visual Impact)

- **Particles / Light Dots**: Sparse slowly floating **small light dots** (2-4px diameter, colors #22D3EE / #38BDF8, 30-60% opacity) in the background, simulating **data streams / memory fragments**, adding dynamic feel (static image can use blur to suggest motion trails).
- **Corner Info UI**: Top-left or top-right can add a **small diagnostic interface decoration frame** (rectangular wireframe + internal pseudo-code text + small progress bar, color #38BDF8, 40% opacity), simulating **system monitoring / dream diagnosis** interface, enhancing immersion.
- **Shattered Portrait Silhouette (Optional)**: In the deepest background layer (furthest Z-axis), place an **extremely faint character silhouette** (8-12% opacity, outline only, no detail), hinting at **protagonist / dreamer**, but must not steal visual focus from title and menu.

---

## 使用说明

1. **目标工具**：可投喂给 Midjourney / DALL·E / Stable Diffusion / 或 V0.dev 的图像生成模型。建议 Midjourney v6 或 FLUX.1 以获得最佳细节与氛围控制。
2. **关键参数建议**（Midjourney）：
   - `--ar 16:9`（强制 1920×1080 比例）
   - `--style raw`（避免过度艺术化）
   - `--s 200-400`（风格化强度，保持克制）
3. **后期微调**：生成后可用 Photoshop / Figma 微调文字位置、调整不透明度、补充扫描线与色差效果。
4. **草图级定位**：本提示词产出的是 **layout 与氛围基线**，不是像素级最终实现——V0.dev 后续会按自己的 UI 组件重构，这张图只做风格参考与视觉定调。

---

## 输出路径

- 生成后的图像文件存放至：`D:\coding\WakeUp\run\ui-mockup\menu-title\`
- 建议命名：`menu-title-v1.png` / `menu-title-v2.png`（多版本迭代）
