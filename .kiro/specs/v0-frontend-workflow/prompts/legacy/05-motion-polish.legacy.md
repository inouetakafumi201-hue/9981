# V0.dev 投喂 Prompt · batch-5：高密度动效收束

## 1. Project Positioning

本项目是一个「WakeUp前端」UI 壳层：用一套声明式 React 界面，把整个游戏的 UI 表面全部做出来（对局 HUD、驻地、叙事对话框、过渡屏、系统通知、控制面板、次面板），供开发期演示、抽取与后续接线。**本壳层只表达视觉与交互手感，不实现任何玩法规则。**

本批次是壳层的最后一块：把 batch-2/3/4 已经落地的页面接入统一动效母题与反馈语义，补齐空状态、错误反馈与 reduced motion 降级，并做全流程动效走查。**动效是规则结果的视觉重演，动画失败/跳过/资源缺失不得改变任何状态。**

## 2. Scope List

**In scope（本批次）：**
- 全页面的动效母题接入：慢白幕、闪白幕、黑幕收束、余辉淡出、轮廓显影、语义高亮、震动回弹、列表重排、颗粒化消失。
- 空状态与错误反馈语义。
- reduced motion 降级。
- 全流程动效走查与调优（60fps）。

**Out of scope（本批次及全项目）：**
- 新增页面或新玩法功能。
- 地图节点/拓扑/ORCA/寻路/路径成本/玩法规则。
- `editor` / `research-bench` / `material-library` / `computer` 内部界面。

## 3. Reference Materials

- 动效母题来源：`docs/表现系统/03_动画灵感索.md`、`docs/表现系统/12_动态图形化设计清单（V0迁移准备）.md`。
- 各页面既有草图/文字布局（沿用 batch-2/3/4 基线）。

## 4. Technical Constraints

- 动效：Framer Motion（`AnimatePresence` / `useAnimate` / `useSpring`）；粒子：tsparticles（仅爆发/充能位）；图标 lucide-react；可访问 Radix；状态 Zustand；音效 Howler（可接 UI 音）。
- 基准 1920×1080，最小 1280×720。
- 语义色 token 同前；动效用色沿用语义，不用装饰色。
- 动效纪律：
  - 曲线动效是主力；帧动画与全屏动画克制使用。
  - 全屏动画只用于低频仪式性动作（纯白显形、结算）。
  - 动画失败/跳过/资源缺失 = 直接显示结果状态，不改规则结果。
  - 过渡母题可复用；新机制优先复用既有配方。

### 4.1 反网页感动效硬门禁（不可妥协）

- 本批次不是给网页组件补 hover 动效，而是把界面变成有空间连续性的游戏演出。动效必须回答“谁在动、从哪里来、经过什么路径、停在哪里”，不能只回答“透明度从 0 变 1”。
- 禁止所有页面同时淡入、所有卡片统一弹跳、所有按钮只变色、所有面板永久呼吸，以及 `opacity` 线性过渡堆叠。这些结果即使流畅，也仍是网页感。
- 必须用 `AnimatePresence`、`layout`/`layoutId`、`useSpring`、`useAnimate`、`motionValue` 和 variants 组织空间重排、层级迁移、局部反光、事件生长与结果落地；Framer Motion 是演出编排器，不是 hover 装饰库。
- 每个母题都要绑定一个明确的视觉承载物：白幕作用于场景阈值，语义高亮作用于当前对象，列表重排保留对象位置连续性，颗粒化消失作用于离场对象。不得把同一个通用 fade 套到所有页面。
- 动效错峰：环境层先稳定，实体层再出现，事件层最后响应，HUD 只在相关对象附近变化。低频仪式才允许全屏覆盖，普通 UI 状态不得遮死游戏世界。
- 使用半透明材质、遮挡、局部阴影、边缘光和像素前景与全息背景的层次；动效要改变空间关系或材质状态，不用彩色渐变和边框闪烁替代演出。
- reduced motion 不是退回网页淡入：保留对象顺序、来源、目标和结果，只缩短位移、减少闪烁并降低粒子数量。

### 4.2 动效交付前视觉验收

- [ ] 关闭所有动画后，页面仍不是三栏 dashboard、卡片墙或普通网页表单。
- [ ] 每个母题至少有一个明确对象、方向和落点，且不会让无关区域一起运动。
- [ ] 列表重排、面板开合、页面切换和仪式演出都保持空间连续，不通过整页闪现完成。
- [ ] 没有统一圆角卡片的同时入场、永久呼吸或线性淡入淡出堆叠；动效仍让环境、实体、事件和 HUD 分层可读。

## 5. Naming Rules

- 沿用既有页面/组件/状态 id，不新增自由命名。
- 动效母题名：`slow-white-curtain` / `flash-white` / `black-fold` / `afterglow-fade` / `contour-reveal` / `semantic-highlight` / `shake-bounce` / `list-reflow` / `grain-vanish`。

## 6. Interaction Rules

### 6.1 母题落点（每项至少接入一处真实页面）

| 母题 | 落点示例 |
|---|---|
| 慢白幕（slow-white-curtain） | `transition-dream` 入梦显影；`transition-battle-intro` 开场 |
| 闪白幕（flash-white） | 纯白显形核心帧；过载视觉 |
| 黑幕收束（black-fold） | `transition-result` 结算淡出 → 返回驻地 |
| 余辉淡出（afterglow-fade） | 页面切换旧页退出；对话框消失 |
| 轮廓显影（contour-reveal） | 控制面板打开时的面板轮廓浮现 |
| 语义高亮（semantic-highlight） | 当前行动者反光高亮；可交互边缘发光 |
| 震动回弹（shake-bounce） | 投点结果行；错误 toast 出现 |
| 列表重排（list-reflow） | 轮次栏排名重排；选项列表 |
| 颗粒化消失（grain-vanish） | 结算/离场时的粒子退场 |

### 6.2 状态切换 vs 点击播放

- 状态切换播放（state-transition）：状态变化驱动的过渡（投点→行动、入梦显影、对话框出现/消失）。
- 点击播放（click-play）：用户点击触发的反馈（按钮回弹、选项悬停/选中、滑块推动充能）。
- 两类播放必须能在控制面板里分别演示。

### 6.3 空状态与错误反馈

- 空状态：无动作（空手进场）、空背包、空列表、匹配中空位——用灰阶 + 一句说明文字，不装饰。
- 错误反馈：toast error 用红语义 + 轻微震动回弹；错误不掩盖上下文。

### 6.4 reduced motion

- 遵循系统 `prefers-reduced-motion`：关闭非必要位移/闪烁，保留状态变化与可读性（淡入淡出替代滑入滑出）。

### 6.5 性能纪律

- 全程 GPU 合成（transform/opacity）；页面切换 <100ms；动效 60fps。
- 粒子只在爆发/充能位一次性触发，不常驻。

## 7. Explicit Exclusions

- ❌ 不新增页面、不新增玩法功能、不接规则。
- ❌ 不做地图节点/拓扑/ORCA/寻路/路径成本。
- ❌ 动画不得反推伤害、目标、成本或规则结果。
- ❌ 不引入第 4 节之外的新依赖。

## 8. Batch Objective

把全部页面接入统一动效母题与反馈语义，补齐空状态、错误反馈与 reduced motion 降级，完成全流程动效走查。**唯一主目标：动效收束与表现一致性。**

## 9. Batch Dependencies

依赖 `batch-2` / `batch-3` / `batch-4`（全部页面先落地，再收束动效）。

## 10. Acceptance Checks

- [ ] 9 个母题每个至少接入一处真实页面，可通过控制面板演示。
- [ ] state-transition 与 click-play 两类播放分别可演示。
- [ ] 空状态、错误反馈、reduced motion 降级全部生效。
- [ ] 页面切换 <100ms，动效流畅 60fps（无卡顿）。
- [ ] 动画失败/跳过不改变任何状态（演示时可验证）。
- [ ] `npx tsc --noEmit` 0 error；`npm run lint` 0 error。
