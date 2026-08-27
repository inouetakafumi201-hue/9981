# V0.dev 投喂规范模板

> 本模板用于所有交给 V0.dev 生成的前端界面，确保投喂信息完整、接线可控。
>
> **输出口径对齐**：本模板与 `v0-frontend-workflow` requirements §2 的批次输出口径一一对应——
>
> | requirements §2 批次章节 | 本模板落点 |
> |---|---|
> | project positioning | 一、界面基本信息 + 附录 |
> | scope list | 一、所属模块 + 二、功能清单 |
> | reference materials | 一、参考图路径 |
> | technical constraints | 三、视觉规范（色彩/布局/动效库） |
> | naming rules | 四、组件层级（组件名） |
> | interaction rules | 六、交互逻辑 + 二、功能清单 |
> | explicit exclusions | 2.3 明确不做 + 一、所属模块排除注记 |
> | batch objective | 批次 Prompt 的 batch objective 字段 |
> | batch dependencies | 批次 Prompt 的 batch dependencies 字段 |
> | acceptance checks | 八、验收标准 |

---

## 一、界面基本信息

- **界面名称**：[中文名 / 英文标识]
- **所属模块**：[对局HUD / 驻地 / 叙事 / 设置]
  - 注：`editor` / `research-bench` / `material-library` / `computer` 不在本偷师前端范围内，任何界面都不得挂到这四个模块下。
- **优先级**：P0 / P1 / P2
- **参考图路径**：`run/ui-mockup/[界面名]/`

---

## 二、功能清单（不可遗漏）

### 2.1 核心功能（必须实现）

列出所有**用户可见的交互元素**，每个功能写明：

- [ ] **功能 1**：[用户做什么] → [界面响应什么]
  - 触发条件：[什么时候出现]
  - 视觉状态：[正常/悬停/禁用/激活]
  - 数据来源：[硬编码占位 / 后端端口名]

- [ ] **功能 2**：...

### 2.2 次要功能（可选但需标注）

- [ ] **功能 X**：[如果时间不够可以先不做，但必须预留接口]

### 2.3 明确不做（防止 V0 自由发挥）

- ❌ **不做 A**：[V0 可能会加，但我们不需要]
- ❌ **不做 B**：...

### 2.4 HUD 爆发档位冻结（仅 battle HUD 投喂时必填）

- 爆发选择器 MVP 只开放 `0 / 1 / 2` 三档。
- ❌ **不做**：`+3极限爆发` 不作为可选档位出现；该档位仅保留为未来评估文本（若有预留视觉位，必须标为不可选）。
- ✅ **必须做**：档位选择过程的选择特效（selection effect）与确认/触发时的触发特效（trigger effect）都要实现。

---

## 三、视觉规范（强制约束）

### 3.1 色彩

- 主色调：[暖奶白 #F7F4EF / 暗调冷灰]
- 语义色：严格使用 tokens 定义（见 `docs/表现系统/01`）
  - 红 = 致命/生命
  - 蓝 = 清醒/体力
  - 橙 = AP/行动
  - 青 = UGC/交流
  - 紫 = 约束/反制
  - 金 = 稀有/高价值
  - 灰白 = 中性/冷却

### 3.2 布局

- 整体布局：[三栏 / 居中卡片 / 全屏覆盖]
- 关键尺寸：[顶栏高度 / 侧栏宽度 / 间距规范]
- 响应式：[1920×1080 基准，最小支持 1280×720]

### 3.3 动效库（硬性要求）

- ✅ **必须用 Framer Motion**：所有入场/出场/过渡动画
- ✅ **必须用 lucide-react**：所有图标
- ✅ **必须用 Radix**：所有可访问行为（对话框/下拉/tooltip）
- ❌ **禁止手写 CSS transition 做 UI 动效**（只允许 hover 微状态）

### 3.4 风格关键词

[简笔画质感 / 克制暗调 / 边缘发光高亮 / 扁平无高光=禁用态]

---

## 四、组件层级与状态管理

### 4.1 组件树（预期结构）

```
<界面根容器>
  ├─ <顶栏>
  │   ├─ 标题
  │   └─ 快捷操作
  ├─ <主体区>
  │   ├─ 左栏（可选）
  │   ├─ 中央内容
  │   └─ 右栏（可选）
  └─ <底栏>（可选）
```

### 4.2 状态管理方式

- [ ] 本地 useState（简单 UI 状态）
- [ ] Zustand store（跨组件共享）
- [ ] Props drilling（父传子）

**注明哪些状态是占位、哪些需要接真实端口。**

---

## 五、数据接口（接线清单）

### 5.1 硬编码占位数据（V0 生成时用）

列出所有假数据的形状：

```typescript
// 占位：玩家列表
const mockPlayers = [
  { id: 'p1', name: '玩家A', hp: 5, sp: 3, ap: 2 },
  { id: 'p2', name: '玩家B', hp: 4, sp: 5, ap: 1 },
];

// 占位：动作卡列表（双轨制 P1：ActionView with track + cardPresentation）
const mockActionViews: ActionView[] = [
  {
    actionId: 'act:move',
    label: '移动',
    track: 'card',                        // 'card' | 'highlight'
    costCategory: 'paid',
    cost: 1,
    cardPresentation: {
      icon: 'icons/action/move.svg',
      colorTheme: 'neutral',
      effectText: '移动至相邻节点',
      interactionMode: 'target',
      tags: ['movement'],
    },
    requires: { targets: 1, targetKind: '节点', ref: { $: 'varOf(\'node\')' } },
    disabled: false,
  },
];
```

### 5.2 真实端口映射（接线时替换）

| 占位数据 | 真实端口路径 | 数据类型 |
|---|---|---|
| `mockPlayers` | `src/play/loading-runtime/ui-host.ts` 的 `TurnOrderProjection` | `readonly Player[]` |
| `mockActionViews` | `src/play/loading-runtime/ui-host.ts` 的 `availableActions` | `readonly ActionView[]`（含 `track` + `cardPresentation` 字段） |
| `mockHighlightViews` | `src/play/loading-runtime/ui-host.ts` 的 `availableActions`（过滤 `track === 'highlight'`） | `readonly ActionView[]` |

> **双轨制 P1 说明**：动作现在按 `track` 分流。BattleHud 渲染时：
> - `track === 'card'` + `costCategory === 'paid'` → 渲染进 paid 动作卡区
> - `track === 'card'` + `costCategory === 'zero-cost'` → 渲染进 0费池（底部 tab 切换）
> - `track === 'highlight'` → 渲染进地图 HUD 层（实体点击触发，不消耗 AP）

---

## 六、交互逻辑（伪代码）

用伪代码描述所有交互，V0 按此实现。**注意：本偷师前端是 UI 壳层，所有交互只改变呈现，不提交玩法动作、不结算规则、不写游戏状态。**

```typescript
// 点击动作卡（placeholder-only：只改变呈现，不提交玩法动作）
function onActionCardClick(actionId: string) {
  // 1. 高亮选中状态（视觉层）
  setSelectedAction(actionId);

  // 2. 需要目标选择时进入目标选取态（视觉层，标记 mock）
  if (mockActionRequiresTarget(actionId)) {
    enterTargetMode(actionId);
  }

  // 3. 不调用任何规则提交 / 结算 / 状态写入
  //    后续接线时由 ui-host 的只读投影 + 动作端口替换
}
```

---

## 七、键盘/无障碍（必须支持）

- [ ] Tab 键可遍历所有交互元素
- [ ] Enter/Space 激活按钮
- [ ] Esc 关闭弹窗
- [ ] 数字键快捷选择（如果有列表）
- [ ] 屏幕阅读器可读（Radix 自带）

---

## 八、验收标准（接线后检查）

### 8.1 视觉一致性

- [ ] 色彩符合 tokens 语义
- [ ] 图标全部来自 lucide-react
- [ ] 动效全部用 Framer Motion
- [ ] 无手写 CSS transition（除 hover）

### 8.2 功能完整性

- [ ] 功能清单 §二 的所有项都可交互
- [ ] 占位数据已替换为真实端口
- [ ] 硬编码逻辑已替换为真实业务逻辑

### 8.3 门禁通过

- [ ] `npx tsc --noEmit` 0 error
- [ ] `npm run lint` 0 error
- [ ] 相关测试全绿
- [ ] `npm run devboard`（或对应启动命令）可打开

---

## 九、风险与兜底

### 9.1 已知冲突

列出与后端设计可能冲突的点：

- **冲突 1**：V0 可能用 7 种场景尺度，但后端只有 3 种
  - 处置方案：后端扩展到 7 种（优先）或前端改成 3 种

### 9.2 技术债登记

- **债务 1**：V0 可能用 `<select>` 原生下拉，需后续替换为 Radix `dropdown-menu`
- **债务 2**：...

---

## 附录：投喂检查清单

投喂前必须确认：

- [x] 参考图已产出并放在 `run/ui-mockup/[界面名]/`
- [x] 功能清单无遗漏（逐项对照设计文档）
- [x] 视觉规范明确（色彩/布局/动效库）
- [x] 硬编码占位数据的形状已写清
- [x] 真实端口映射表已填写
- [x] 明确标注了"不做什么"（防止 V0 自由发挥）
- [ ] （battle HUD）`+3极限爆发` 未作为可选档位出现，选择特效与触发特效均已写入
