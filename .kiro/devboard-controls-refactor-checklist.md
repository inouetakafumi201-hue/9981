# 开发板原生控件重构清单

**目标**：将所有原生 HTML 控件替换为独立游戏 UI 风格（Radix Primitives + Framer Motion + 自绘）

**范式转换**：
- ❌ 网页思维：用原生 `<input>` / `<select>` / 浏览器滚动条 + CSS 美化
- ✅ 独立游戏思维：Radix headless 组件 + 完全自定义渲染 + Framer Motion 动效

---

## 一、按钮类 (Button)

### 当前实现
- 原生 `<button>` + CSS 类名（`.primary` / `.icon-button` / `.map-list-item` 等）
- CSS transition 做 hover

### 目标实现
- **Framer Motion `<motion.button>`** 包裹
- **动效**：
  - hover: `scale: 1.02` + `y: -1px` 弹性缓动
  - press: `scale: 0.98`
  - 主操作按钮点击：tsparticles 青色粒子爆炸 + Howler 音效
- **视觉**：
  - 渐变背景 `linear-gradient(135deg, #06b6d4, #0891b2)`
  - 内阴影高光 `inset 0 1px 0 rgba(255,255,255,0.1)`
  - 外发光 `box-shadow: 0 0 16px rgba(6,182,212,0.5)`
  - 边缘光在 hover 时加强

### 涉及位置
- 顶栏操作按钮（撤销/重做/新建/校验导出）x6
- 左栏图层按钮（地图列表项/图层行）xN
- 工具栏五工具按钮 x5
- 右栏素材卡片按钮 x7~70
- 右栏运行测试按钮 x1
- 底栏诊断项按钮 xN

### 优先级：🔴 P0（最影响质感）

---

## 二、文本输入框 (Text Input)

### 当前实现
- 原生 `<input type="text">` / `<input type="number">`
- CSS 背景色 + border

### 目标实现
- **自绘深色框** + **青色发光 focus 动画**
- **Framer Motion 包裹**：
  - focus: `boxShadow` 从无到 `0 0 0 2px rgba(6,182,212,0.5)` 动画 200ms
  - blur: 反向动画
- **视觉**：
  - 深色背景 `#1a1e29`
  - 半透明边框 `1px solid rgba(207,218,226,0.1)`
  - 圆角 4px
  - 内边距 `8px 12px`
  - 字体 12px / 400 weight / #d1d9e0

### 涉及位置
- 顶栏地图名输入框 x1
- 左栏图层高度输入框 xN
- 右栏检查器字段（名称/X/Y/楼层/Def/过渡窗口X/Y）x7+
- 右栏素材搜索框 x1

### 优先级：🟡 P1（focus 发光是关键质感）

---

## 三、下拉选择 (Select / Dropdown)

### 当前实现
- 原生 `<select>` + `<option>`
- 浏览器默认下拉样式（无法自定义）

### 目标实现
- **Radix Select** (headless)
- **完全自定义弹出层**：
  - 触发按钮：深色背景 + 右侧下箭头图标
  - 弹出层：深色面板 `#191d28` + 半透明 backdrop `rgba(0,0,0,0.5)`
  - 选项 hover：青色背景 `rgba(6,182,212,0.15)` + 左侧青色边框
  - 选中项：青色圆点标记
- **Framer Motion**：
  - 弹出层进入：`initial={{ opacity: 0, y: -8 }}` → `animate={{ opacity: 1, y: 0 }}`
  - 退出：反向动画

### 涉及位置
- 检查器场景尺度 (SceneScale) x1
- 检查器边方向性 (directionality) x1
- 检查器语义锚点 (semanticAnchor) x1

### 优先级：🟡 P1（原生 select 是"网页感"的重灾区）

---

## 四、复选框 (Checkbox)

### 当前实现
- 原生 `<input type="checkbox">`
- 浏览器默认样式

### 目标实现
- **Radix Checkbox** (headless)
- **自绘开关**：
  - 未选中：深色方框 `#1a1e29` + 边框
  - 选中：青色填充 `#06b6d4` + 白色勾号（lucide Check 图标）
  - 动画：勾号从 `scale: 0` → `scale: 1` + `rotate: -5deg` 弹性出现
- **Framer Motion**：
  - 点击：整个框 `scale: 0.9` → `1.1` → `1` 弹性反馈

### 涉及位置
- 过渡窗口开关 x1

### 优先级：🟢 P2（使用频率低）

---

## 五、滚动条 (Scrollbar)

### 当前实现
- 原生浏览器滚动条
- `::-webkit-scrollbar` 伪元素美化（但仍是浏览器原生渲染）

### 目标实现
- **Radix ScrollArea** (完全自定义)
- **视觉**：
  - 轨道：透明或极深色 `rgba(0,0,0,0.2)`
  - 滑块：深灰半透明 `rgba(107,117,128,0.3)` 宽 8px 圆角 4px
  - hover：滑块变 `rgba(107,117,128,0.5)`
  - 拖拽中：青色高亮 `rgba(6,182,212,0.3)`
- **Framer Motion**：
  - 滑块出现/消失：`opacity` + `scaleX` 动画

### 涉及位置
- 左栏面板滚动 x1
- 右栏面板滚动 x1
- 右栏素材展开后滚动 x1
- 底栏诊断列表滚动 x1

### 优先级：🟡 P1（原生滚动条是"网页感"标志）

---

## 六、数字滑块 (Slider / Range)

### 当前实现
- 无（当前用 `<input type="number">`，未来可能需要滑块）

### 目标实现（预留）
- **Radix Slider** (headless)
- **自绘轨道 + 手柄**：
  - 轨道：深色 `#1a1e29` 高 4px 圆角
  - 已填充部分：青色渐变 `#06b6d4`
  - 手柄：圆形 16px 白色 + 青色外发光 `0 0 8px rgba(6,182,212,0.6)`
- **Framer Motion**：
  - 拖拽中：手柄 `scale: 1.2`
  - 释放：弹回 `scale: 1`

### 涉及位置
- 暂无（预留给未来数值调整需求，如透明度/缩放滑块）

### 优先级：🔵 P3（暂无使用场景）

---

## 七、拖拽反馈 (Drag & Drop)

### 当前实现
- 原生 `draggable` + `onDragStart`
- 无视觉反馈（只有浏览器默认半透明拖影）

### 目标实现
- **Framer Motion `drag` + `dragConstraints`**
- **视觉**：
  - 拖拽中：原卡片 `opacity: 0.5` + 鼠标跟随幽灵卡片（完整渲染）
  - 幽灵卡片：青色边框 `2px solid #06b6d4` + 外发光
  - 投放目标高亮：画布背景闪烁青色脉冲
- **音效**：
  - 拾取：Howler 播放"拾取"音效
  - 投放成功：Howler 播放"确认"音效

### 涉及位置
- 素材卡片拖拽到画布 x7~70

### 优先级：🟡 P1（拖拽是核心交互）

---

## 八、特效/粒子 (Particles)

### 当前实现
- 无

### 目标实现
- **tsparticles**
- **场景**：
  1. 主操作按钮点击（校验导出/运行测试）：青色粒子从按钮中心向外爆炸
  2. 错误提示：红色粒子闪烁
  3. 成功反馈：绿色粒子上升消散

### 优先级：🟢 P2（锦上添花，不影响核心功能）

---

## 九、音效同步 (Sound Effects)

### 当前实现
- 无

### 目标实现
- **Howler.js**
- **音效映射**：
  - 按钮 hover：轻微"滴"声
  - 按钮点击：确认"咔"声
  - 拖拽拾取："拾取"音效
  - 拖拽投放："放置"音效
  - 错误提示：警告音
  - 成功反馈：成功音

### 优先级：🔵 P3（需要音效资源，暂无素材）

---

## 十、工具栏工具按钮特殊处理

### 当前问题
- 五工具按钮（选择/放置/拉边/取样/测试）激活态只有青色背景，无动效

### 目标增强
- **激活切换动画**：
  - 从旧工具到新工具：旧工具 `scale: 1` → `0.95` 淡出，新工具 `scale: 0.95` → `1` + 青色发光扩散
  - 快捷键字母（V/N/E/I/P）：激活时 `rotate: -5deg` → `5deg` 摇摆
- **粒子**：切换工具时青色粒子从按钮边缘向中心汇聚

### 优先级：🟡 P1（工具切换是高频交互）

---

## 重构策略

### Phase 1: 基础组件库（P0/P1）
1. **按钮组件**（`<GameButton>`）— Framer Motion + 三种变体（primary/ghost/icon）
2. **文本输入**（`<GameInput>`）— focus 青色发光动画
3. **下拉选择**（`<GameSelect>`）— Radix Select + 自定义渲染
4. **滚动容器**（`<GameScrollArea>`）— Radix ScrollArea + 自定义滑块

### Phase 2: 替换 EditorApp（P0/P1）
- 逐个替换当前原生控件为新组件
- 保持功能零变化（props/事件完全兼容）

### Phase 3: 增强效果（P2/P3）
- tsparticles 粒子效果
- Howler 音效同步
- 复选框/滑块等低频控件

---

## 技术债务标记

- [ ] 原生 `<input>` 在移动端会触发虚拟键盘（独立游戏不需要）
- [ ] 原生 `<select>` 在不同浏览器样式不一致（Safari/Firefox 差异大）
- [ ] 原生滚动条在 Windows/Mac 表现不同（Mac 自动隐藏，Windows 常驻）
- [ ] 拖拽用原生 API 无法做幽灵元素实时跟随（浏览器限制）

---

## 参考资料

- 08 技术栈文档：`docs/工程治理/02_技术栈与开发流程.md`
- Design Tokens 分析：`scripts/analyze-design-system.py` 输出
- Radix Primitives: https://www.radix-ui.com/primitives
- Framer Motion: https://www.framer.com/motion/
- tsparticles: https://particles.js.org/
- Howler.js: https://howlerjs.com/
