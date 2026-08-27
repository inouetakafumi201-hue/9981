# 研究台前端壳层（bench-shell）

> **来源**：v0.dev 生成的研究台（素材级工作台）前端壳子  
> **需求文档**：`docs/v0-dev-bench-spec.md`  
> **接线清单**：`.kiro/接线准备/v0-frontend-wiring-readiness.md` §四

---

## 目录结构（预期）

```
bench-shell/
├── components/                    # v0 生成的组件
│   ├── BenchTopBar/              # 顶栏：W 徽标 + 分区切换 + 回素材库
│   │   ├── WBadge/               # 青发光 W 方块 + 标题
│   │   ├── SectionTabs/          # 词条库/锻造台 分区切换
│   │   └── SwitchToLibraryButton/ # 回素材库
│   ├── TokenLibraryPanel/        # 左栏词条库（材料收集册）
│   │   ├── CategoryTabs/         # 五大类标签（属性/技能/状态/防御/机动）
│   │   ├── CollectProgress/      # 收集进度（5/22 已收集）
│   │   └── TokenCardGrid/        # 词条卡片网格
│   │       └── TokenCard/        # 已收集亮起 + 品质描边；未收集剪影 + 「?」；星标；拖拽源
│   ├── ForgeBench/               # 中央锻造工作台
│   │   ├── BaseMaterialView/    # 基体大图标 + 名称
│   │   ├── ForgeSlotRow/         # 5 槽排
│   │   │   └── ForgeSlot/        # 单个槽位（底图印字/空槽「+」；拖入替换/拖回恢复默认）
│   │   ├── ComboPreview/         # 右侧组合预览（当前挂载词条语义清单）
│   │   ├── ExtractButton/        # 提取按钮
│   │   ├── ForgeResultActions/   # 保存/派生按钮
│   │   └── SynthesizeButton/     # 合成按钮（青主按钮）
│   ├── MaterialQuickBar/         # 右栏素材快捷栏（与素材库/编辑器共享）
│   │   ├── QuickBarSlots/        # 7 格折叠
│   │   └── ExpandedMatrix/       # 7×10 展开 + 筛选
│   ├── MoldingStrip/             # 底部塑形备选栏
│   │   └── MoldingSlot/          # 5 格（解锁亮/锁定灰+🔒；拖入替换）
│   ├── ExtractRitual/            # 提取演出覆盖层
│   ├── SynthesisQueueBar/        # 合成队列条（1 进行中 + N 排队 + 加急）
│   └── SynthesisRitual/          # 全屏合成仪式覆盖层
│       ├── ForgeGate/            # 发光锻造门/闸口
│       ├── ThreeStations/        # 三个台子（左熔炼/中主锻造/右铭刻）
│       ├── ResultRevealPanel/    # 高光爆发 + 成品浮现 + 收下
│       └── FailurePanel/         # 成品变灰 + 解释 + 确定
├── styles/                       # v0 样式（如有）
├── types/                        # v0 类型定义（如有）
├── utils/                        # v0 工具函数（如有）
└── index.ts                      # 壳层统一出口

README.md                         # 本文件
```

---

## 接线规则

### 保留项（v0 原样）

- 组件名、层级、props 接口、样式类名
- 布局结构（顶栏 + 左栏词条库 + 中央锻造台 + 右栏快捷栏 + 底部塑形栏）
- 视觉效果（动效、发光、仪式感、粒子）
- Framer Motion / Radix / lucide-react / tsparticles 使用方式

### 替换项（接线时改）

| v0 占位数据 | 真实端口 | 来源 |
|---|---|---|
| `mockTokensByCategory` | `projection.tokens()` + 五大类分组 | 元状态投影 |
| 锻造槽位 | `projection.materialDetail(baseId)` + `equippedTokensOf(baseId)` | 元状态投影 |
| 素材快捷栏（右栏共享） | `projection.quickBar()` | 元状态投影 |
| `mockSynthesisQueue` | `projection.synthesisQueue()` | 元状态投影 |
| `mockMoldingBar` | `projection.moldingBar()` | 元状态投影 |
| 提取 | `actions.extractToken(materialId, focusAttr)` | 动作通道 |
| 合成投料/收下/加急 | `actions.synthesizeSubmit / synthesizeClaim / synthesizeRush` | 动作通道 |
| 锻造保存/派生 | `actions.forgeModify(materialId, slots[], {mode})` | 动作通道 |
| 塑形栏配置 | `actions.moldingSet(slotIndex, materialId)` | 动作通道 |
| 词条星标 | `actions.toggleStar(tokenId)` | 动作通道 |
| 回素材库 | `switchToLibrary()` | 三界面切换注入回调 |

### 关键交互规则

- **底图感**：锻造槽位可能预先印有默认词条（素材自带），拖新词条 = 盖上去（替换）
- **只替换、不删除**：拖新词条 = 替换；把词条**拖回词条库/快捷栏** = 默认值自动恢复
- **合成结果由动作通道返回**，前端**不得**本地随机生成
- **研究台没有词条快捷栏**（2026-08-19 定案）：词条从左侧词条库直接拖入锻造槽位
- **组合预览无火力/射程强度条**（2026-08-19 定案）：用词条语义清单展示机制，不模仿普通改枪数值栏
- **合成仪式演出**：动画是规则结果的视觉重演，不改变结算、不提交状态、不泄露 LLM 细节

### 术语纠正

| v0 可能写的 | 项目权威术语 |
|---|---|
| 技能/天赋/属性 | 词条（Token） |
| 装备/武器/物品 | 素材（Material） |
| 强化/升级 | 锻造（Forge） |
| 炼金/制作/合成 | 合成（Synthesis） |
| 背包/装备栏 | 塑形备选栏（Molding Strip） |

### 风险与冲突（务必注意）

- **冲突 1**：v0 可能把合成结果做成前端随机/动画假结果  
  **处置**：合成结果由动作通道返回（LLM 裁决 + 品级公式），前端只做演出与展示；演出阶段机不产生任何数据

- **冲突 2**：v0 可能发明「清空槽位」按钮（违背底图感 = 只替换）  
  **处置**：明确不做；「恢复默认」的唯一动作是把词条拖回词条库/快捷栏

- **冲突 3**：v0 可能把词条库当成仓库（展示拥有量管理主界面）  
  **处置**：词条库是「材料收集册」（收集进度 + 未收集剪影 + 拖拽源），不做批量整理/删除

- **冲突 4**：v0 可能加入玩家文本输入（描述想要什么）  
  **处置**：合成台 LLM 零输入（防提示词攻击），本界面没有任何给玩家描述需求的文本框

- **冲突 5**：v0 可能按旧认知加「词条快捷栏」或改枪式强度数值栏  
  **处置**：明确不做：研究台没有词条快捷栏（词条从词条库直拖），没有火力/射程强度条（用组合预览展示词条语义）

---

## 导入说明

把 v0 导出的研究台前端代码放入本目录：
- 如果 v0 导出的是 `app/` 目录，把其中的 `components/` / `styles/` / `utils/` 内容放进来
- 不要与地图编辑器、素材库代码混在一起

接线后，`BenchApp` 根组件将从这里导出，由三界面切换路由挂载。
