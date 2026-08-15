# WakeUp UI 设计图生成指南

## 第三稿提示词位置

完整的 V3 设计图提示词已保存在：`docs/表现系统/ui_design_v3_prompt.txt`

## 如何生成设计图

### 方法一：使用在线 AI 图像生成服务

将 `ui_design_v3_prompt.txt` 中的完整提示词复制粘贴到以下任一服务：

1. **Midjourney** (推荐，质量最高)
   - 访问：https://www.midjourney.com
   - 在 Discord 频道中使用 `/imagine` 命令
   - 粘贴提示词

2. **DALL-E 3** (通过 ChatGPT Plus)
   - 访问：https://chat.openai.com
   - 直接粘贴提示词，要求生成图像

3. **Stable Diffusion Web UI** (本地部署)
   - 使用 Automatic1111 或 ComfyUI
   - 粘贴提示词到 Prompt 框
   - 设置尺寸为 1920×1080

4. **Leonardo.AI**
   - 访问：https://leonardo.ai
   - 选择 "Image Generation"
   - 粘贴提示词

5. **Hugging Face Spaces**
   - FLUX.1-schnell: https://huggingface.co/spaces/black-forest-labs/FLUX.1-schnell
   - Stable Diffusion: https://huggingface.co/spaces/stabilityai/stable-diffusion

### 方法二：使用项目现有的 sprite-forge skill

如果需要像素风格的界面元素：

```bash
# 使用 sprite-forge skill 生成像素组件
# (需要配置 GEMINI_API_KEY 或 OPENAI_API_KEY)
```

## V3 设计要点总结

本次 V3 稿整合了 2026-08-15 的所有核心修订：

### 关键特性

1. **推挡滑块 4 档** (0/1/2/3，下标 0/1/2/2)
   - "审美强过逻辑"
   - 第 3/4 档距离近，"极限档"视觉暗示

2. **骰子悬空系统**
   - 只在当前行动者右侧出现
   - 左侧序号方块 1-5
   - 横条三段式生长动画

3. **轮次框反光高光**
   - Glossy reflective shine
   - 玩家框大约一骰宽

4. **动作菱形 AP**
   - "太性感了"
   - 橙色 ◆ = AP，蓝色 💧 = 体力

5. **8 人容量规划**
   - 轮次栏必须能纵向容纳 8 个框

### 视觉风格

- 像素风 + 简笔画叠加
- Front-facing cabinet/cavalier projection (front oblique, D-025: 规范名称"正面斜投影")
- 严格的颜色语义系统（红=HP，蓝=SP，橙=AP）
- 边缘发光交互
- 1920×1080 分辨率

## 生成后的验证

生成的设计图应包含：

- ✓ 左侧轮次栏（8 人容量，带反光高光）
- ✓ 骰子悬空系统（横条三段式生长）
- ✓ 中央地图视图（简笔画背景 + 像素前景）
- ✓ 右下动作面板（菱形 AP 指示器）
- ✓ 上方投点面板（4 档推挡滑块）
- ✓ 所有元素符合颜色语义系统

## 文档状态

- **创建日期**：2026-08-15
- **关联文档**：
  - `docs/表现系统/00_创作指导.md` - 画风基调与动态图形化原则
  - `docs/表现系统/01_图形化与UI.md` - UI 详细设计
  - `docs/表现系统/03_动画灵感索.md` - 动画配方库

