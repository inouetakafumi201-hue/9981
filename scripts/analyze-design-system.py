from PIL import Image

img = Image.open('run/ui-mockup/开发板/5f2a6147-f127-4810-b75f-24a62ab30466.png')
w, h = img.size

print('=== 设计系统解构分析 ===\n')
print(f'画布尺寸: {w} × {h}px (16:9)\n')

# 1. 布局网格
print('## 一、布局结构\n')

def scan_vertical_edge(x_range, y, threshold=15):
    for x in range(x_range[0], x_range[1]):
        p1 = img.getpixel((x, y))
        p2 = img.getpixel((x + 1, y))
        diff = abs(p1[0] - p2[0]) + abs(p1[1] - p2[1]) + abs(p1[2] - p2[2])
        if diff > threshold:
            return x + 1
    return None

def scan_horizontal_edge(x, y_range, threshold=15):
    for y in range(y_range[0], y_range[1]):
        p1 = img.getpixel((x, y))
        p2 = img.getpixel((x, y + 1))
        diff = abs(p1[0] - p2[0]) + abs(p1[1] - p2[1]) + abs(p1[2] - p2[2])
        if diff > threshold:
            return y + 1
    return None

# 人工测量固定值（从参考图直接读取）
topbar_bottom = 66
left_panel_right = 270
right_panel_left = 1510
toolbar_bottom = 135
bottom_top = 685

print(f'顶栏: 0 → {topbar_bottom}px (高 {topbar_bottom}px)')
print(f'左栏: 0 → {left_panel_right}px (宽 {left_panel_right}px)')
print(f'右栏: {right_panel_left}px → {w}px (宽 {w - right_panel_left}px)')
print(f'工具栏: {topbar_bottom}px → {toolbar_bottom}px (高 {toolbar_bottom - topbar_bottom}px)')
print(f'底栏: {bottom_top}px → {h}px (高 {h - bottom_top}px)')
print(f'画布: {left_panel_right} → {right_panel_left}px × {toolbar_bottom} → {bottom_top}px')
print(f'  尺寸: {right_panel_left - left_panel_right} × {bottom_top - toolbar_bottom}px\n')

print('布局嵌套 (Flex/Grid):')
print('body (Flex垂直)')
print('├─ .topbar (Grid 3列: 245px | flex-1 | auto)')
print('│   ├─ .brand (Flex横向: W标42px + 文字)')
print('│   ├─ .map-title (Flex: input + 副标)')
print('│   └─ .top-actions (Flex gap:8)')
print('├─ .workspace (Grid 3列: 244px | flex-1 | 310px)')
print('│   ├─ .left-panel (Flex垂直, 独立滚动)')
print('│   ├─ .main-area (Flex垂直)')
print('│   │   ├─ .toolbar (Flex横向)')
print('│   │   └─ svg.canvas (flex-1)')
print('│   └─ .right-panel (Flex垂直, 独立滚动)')
print('└─ .bottom-panel (Flex垂直)\n')

# 2. 色彩系统
print('## 二、色彩系统\n')

samples = {
    '【背景层】': [
        ('顶栏', 200, 30),
        ('左栏', 50, 250),
        ('画布', 600, 400),
        ('右栏', 1350, 300),
        ('工具栏', 600, 100),
        ('底栏', 600, 750),
    ],
    '【主色-青色】': [
        ('W标记', 42, 32),
        ('连线', 620, 230),
        ('主按钮', 1350, 32),
    ],
    '【辅助色】': [
        ('黄-选中', 755, 285),
        ('蓝-折点', 595, 350),
        ('红-错误', 1270, 730),
        ('绿-通过', 1115, 765),
    ],
    '【卡片层】': [
        ('图层卡', 140, 215),
        ('素材卡', 1225, 250),
        ('输入框', 1120, 225),
    ],
    '【文字】': [
        ('白-主', 565, 32),
        ('灰-次', 90, 287),
    ],
}

def rgb_to_hsl(r, g, b):
    r, g, b = r/255, g/255, b/255
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    if mx == mn:
        h = s = 0
    else:
        d = mx - mn
        s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
        if mx == r:
            h = ((g - b) / d + (6 if g < b else 0)) / 6
        elif mx == g:
            h = ((b - r) / d + 2) / 6
        else:
            h = ((r - g) / d + 4) / 6
    return f'({int(h*360)}, {int(s*100)}%, {int(l*100)}%)'

for category, points in samples.items():
    print(category)
    for name, x, y in points:
        px = img.getpixel((x, y))
        r, g, b = px[:3]
        hex_c = f'#{r:02x}{g:02x}{b:02x}'
        hsl = rgb_to_hsl(r, g, b)
        print(f'  {name:8} {hex_c:8}  rgb({r:3},{g:3},{b:3})  HSL{hsl}')
    print()

print('色彩语义:')
print('- 青色 #06b6d4 = 品牌/主操作/交互 (唯一高饱和)')
print('- 黄色 #d69e2e = 选中/警告')
print('- 蓝色 #3182ce = 辅助交互/折点')
print('- 红色 #e53e3e = 错误/危险')
print('- 绿色 #38a169 = 成功/安全')
print('- 深色分层: 左#1d2a39(最亮) > 画布#161d28(最暗)\n')

# 3. 字体层级
print('## 三、字体层级\n')
print('| 层级  | 字号  | 粗细 | 用途           |')
print('|------|------|------|----------------|')
print('| xl   | 18px | 700  | 顶栏地图名      |')
print('| lg   | 16px | 600  | 品牌主标       |')
print('| md   | 13px | 500  | 工具/主按钮    |')
print('| base | 12px | 400  | 正文/卡片      |')
print('| sm   | 11px | 600  | 字段标签       |')
print('| xs   | 10px | 400  | 副标/提示      |')
print()

# 4. 间距
print('## 四、间距系统\n')
print('xs: 2px   (图层卡间距)')
print('sm: 6px   (工具按钮间距)')
print('md: 10px  (检查器字段gap)')
print('lg: 16px  (顶栏/面板内边距)')
print('xl: 24px  (区块间距)\n')

# 5. 圆角/阴影
print('## 五、视觉细节\n')
print('圆角:')
print('- 品牌W/按钮/卡片: 6px')
print('- 输入框: 4px')
print('- 素材图标: 50% (圆形)')
print()
print('阴影/发光:')
print('- 品牌标记: 0 0 12px rgba(6,182,212,0.4)')
print('- 主按钮: 0 0 16px rgba(6,182,212,0.35)')
print('- SVG连线: drop-shadow(0 0 4px rgba(6,182,212,0.4))')
print('- 选中黄: drop-shadow(0 0 10px rgba(214,158,46,0.6))')
print()
print('边框:')
print('- 面板分隔: 1px solid rgba(0,0,0,0.3)')
print('- 顶栏底: 1px solid rgba(6,182,212,0.2)')
print('- 卡片/输入: 1px solid rgba(207,218,226,0.1)\n')

# 6. 质感差距分析
print('## 六、关键质感差距 (为什么像网页)\n')
print('1. 原生滚动条 → 需自定义深色半透明 8px宽')
print('2. 扁平按钮 → 缺渐变+内阴影高光(inset 0 1px 0 白10%)')
print('3. 硬边框 → 卡片需半透明叠加+backdrop-filter:blur(8px)')
print('4. 无过渡 → 所有交互需transition 200ms cubic-bezier')
print('5. 文字无层次 → 状态文字需text-shadow发光')
print('6. SVG线条平淡 → 必须用filter:drop-shadow (非box-shadow)')
print('7. 输入框像表单 → 深色bg + focus青色发光外框')
print('8. 卡片无深度 → 多层(渐变+边缘光+hover抬升)\n')

# 7. Design Tokens
print('## 七、设计Token汇总\n')
print('export const designTokens = {')
print('  colors: {')
print('    bg: {')
print('      topbar: "#1d202c",')
print('      leftPanel: "#1d2a39",')
print('      canvas: "#161d28",')
print('      rightPanel: "#131823",')
print('      toolbar: "#141a26",')
print('      bottom: "#161c25",')
print('      card: "#191d28",')
print('      input: "#1a1e29",')
print('    },')
print('    accent: {')
print('      cyan: "#06b6d4",')
print('      yellow: "#d69e2e",')
print('      blue: "#3182ce",')
print('      red: "#e53e3e",')
print('      green: "#38a169",')
print('    },')
print('    text: {')
print('      primary: "#d1d9e0",')
print('      secondary: "#6b7580",')
print('    },')
print('  },')
print('  spacing: { xs: 2, sm: 6, md: 10, lg: 16, xl: 24 },')
print('  radius: { sm: 4, md: 6, lg: 8, full: "50%" },')
print('  shadow: {')
print('    glowCyan: "0 0 12px rgba(6,182,212,0.4)",')
print('    glowCyanStrong: "0 0 16px rgba(6,182,212,0.5)",')
print('    glowYellow: "0 0 10px rgba(214,158,46,0.6)",')
print('    insetHighlight: "inset 0 1px 0 rgba(255,255,255,0.1)",')
print('  },')
print('  fontSize: { xs: 10, sm: 11, base: 12, md: 13, lg: 16, xl: 18 },')
print('  fontWeight: { normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800 },')
print('  transition: "all 200ms cubic-bezier(0.4, 0, 0.2, 1)",')
print('};')

