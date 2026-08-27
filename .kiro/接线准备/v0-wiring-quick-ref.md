# V0 前端接线准备 · 快速参考卡

> 为接线执行者提供的精简速查手册，完整清单见 `v0-frontend-wiring-readiness.md`

---

## 一、接线铁律

### 1.1 三不原则

- ❌ **不改 v0 前端结构**：组件名/层级/props/样式类名原样保留
- ❌ **不用 v0 占位数据**：硬编码数据/假状态/占位回调全部替换
- ❌ **不偏离权威术语**：所有 UI 文字对照术语映射表纠正

### 1.2 三必须

- ✅ **必须学习 v0 代码风格**：Tailwind 用法/Framer Motion 模式/组件命名习惯
- ✅ **必须走真实端口**：数据从投影读，写操作走动作通道
- ✅ **必须过门禁**：tsc 0 / vitest 全绿 / lint 0 / verify:docs 通过

---

## 二、三界面快速定位

| 界面 | 目录 | 根组件 | 核心职责 | 关键图元/交互 |
|---|---|---|---|---|
| **地图编辑器** | `editor-shell/` | `EditorApp` | 涂鸦式构建地图 | 场景框涂鸦合并、高光点拖拽拉边、Catmull-Rom 样条、五模式 |
| **素材库** | `library-shell/` | `MaterialLibraryApp` | 检索优先创作资源入口 | 双 tab、星标置顶、限免不可拖入快捷栏、词条徽章点击切研究台 |
| **研究台** | `bench-shell/` | `BenchApp` | 素材级加工工作台 | 词条库五类、锻造 5 槽底图感、合成仪式全屏演出、塑形 5 格 |

---

## 三、高频术语映射

| v0 可能写的 | 项目权威术语 | 英文标识 |
|---|---|---|
| 节点/房间 | 场景 | Scene / MapNode |
| 障碍物/阻挡 | 遮挡框 | Obstruction（视觉/物理） |
| 传送门/门 | 过渡窗口 | Transition Window |
| 连接/路径 | 边/连线 | Edge |
| 技能/天赋 | 词条 | Token |
| 物品/道具 | 素材 | Material |
| 强化/升级 | 锻造 | Forge |
| 炼金/制作 | 合成 | Synthesis |
| 背包/装备栏 | 塑形备选栏 | Molding Strip |
| 收藏/喜欢 | 星标 | Starred |
| 蓝图/模板 | 蓝本 | Blueprint |

---

## 四、核心端口速查

### 4.1 地图编辑器

```typescript
// 地图数据
import { loadMap, exportMap } from 'src/devboard/editor/workspace-state';
// 图层
import { layers } from 'src/devboard/layers/layer-shapes';
// 编辑行为
import { placeNode, drawEdge } from 'src/devboard/app/editor-state';
// 撤销/重做
import { undo, redo } from 'src/devboard/app/editor-history';
// 诊断
import { runPlaytest } from 'src/devboard/verify/playtest';
// 素材快捷栏（共享）
import { projection } from 'src/meta-state/';
const quickBar = projection.quickBar();
```

### 4.2 素材库

```typescript
// 元状态投影（只读）
import { projection } from 'src/meta-state/';
const materials = projection.allVisible();          // 全部（含限免）
const owned = projection.ownedMaterials();          // 我的素材
const detail = projection.materialDetail(id);       // 素材详情
const tokens = projection.equippedTokensOf(id);     // 词条挂载 5 槽
const badges = projection.badgeStateOf(id);         // 角标状态
const blueprints = projection.blueprintList();      // 蓝本列表
const quickBar = projection.quickBar();             // 快捷栏（共享）

// 动作通道（写）
import { actions } from 'src/meta-state/';
actions.toggleStar(id);                             // 星标切换
actions.quickBarSet(index, materialId);             // 快捷栏配置（拒绝限免）

// 三界面切换
switchToBench(materialId, opts?);                   // 去研究台
switchToEditor();                                   // 回编辑器
```

### 4.3 研究台

```typescript
// 元状态投影（只读）
import { projection } from 'src/meta-state/';
const tokens = projection.tokens();                 // 词条库（五大类分组）
const material = projection.materialDetail(baseId); // 锻造基体
const equipped = projection.equippedTokensOf(baseId); // 锻造槽位
const queue = projection.synthesisQueue();          // 合成队列
const molding = projection.moldingBar();            // 塑形备选栏
const quickBar = projection.quickBar();             // 素材快捷栏（共享）

// 动作通道（写）
import { actions } from 'src/meta-state/';
actions.extractToken(materialId, focusAttr);        // 提取（第一环消耗，不可逆）
actions.forgeModify(materialId, slots, {mode});     // 锻造保存/派生
actions.synthesizeSubmit(baseId, tokenIds);         // 合成投料
actions.synthesizeClaim(jobId);                     // 收下成品
actions.synthesizeRush(jobId);                      // 加急（花记忆碎片插队）
actions.moldingSet(slotIndex, materialId);          // 塑形栏配置
actions.toggleStar(tokenId);                        // 词条星标

// 三界面切换
switchToLibrary();                                  // 回素材库
```

---

## 五、关键交互规则速查

### 5.1 地图编辑器

- **高光点** = 场景锚点（最大距离矩形中心），**拖拽高光点 = 进入拉边流程**
- **涂鸦式合并**：同类型矩形重叠 → 自动合并，选中任一成员 = 选中整个聚合
- **空洞全填**：场景框围成封闭区域 → 空洞半透明填充，视为场景一部分
- **粘连拒绝**：一次拖拽同时碰到两个不同场景 → 整个操作拒绝 + 提示
- **Catmull-Rom 样条**：绝对穿过每个必经点，不是贝塞尔控制点在外拉
- **双击空白不创建节点**：创建必须按 N 或右键菜单

### 5.2 素材库

- **限免素材**（绿角标）：可见、可摆图，**但不可拖入快捷栏**（落点红闪）
- **UGC 素材**（青角标）：在快捷栏中**灰显、不可拖**，提示「去研究台处理」
- **星标置顶**：同筛选栏内排首，不是全局置顶
- **词条徽章可点击** → 切研究台并定位到该词条

### 5.3 研究台

- **底图感**：槽位可能预先印有默认词条，拖新词条 = 盖上去（替换）
- **只替换、不删除**：拖新词条 = 替换；把词条拖回词条库/快捷栏 = 默认值恢复
- **研究台没有词条快捷栏**：词条从左侧词条库直接拖入锻造槽位
- **组合预览无强度条**：用词条语义清单展示机制，不做火力/射程数值栏
- **合成结果由动作通道返回**，前端**不得**本地随机生成

---

## 六、已知冲突与处置

| 冲突 | 界面 | 处置 |
|---|---|---|
| v0 用 Canvas 渲染地图 | 编辑器 | 保留现有 SVG `CanvasView.tsx`，v0 组件只负责布局交互 |
| v0 用贝塞尔曲线 | 编辑器 | 替换为 Catmull-Rom（穿过所有必经点） |
| v0 漏掉高光点 | 编辑器 | 补充：高光点 = 场景锚点，拖拽 = 拉边 |
| v0 发明 4 角控制点拖拽 | 编辑器 | 不做，只保留涂鸦式阴影选中 + 整体移动/旋转/删除 |
| v0 把快捷栏展开态做成本地状态 | 素材库 | 展开态从投影读 `quickBar.materialExpanded` |
| v0 把限免当成可购买展示 | 素材库 | 限免 = 摆图可用、不进拥有库，「我的素材」只列 `owned:true` |
| v0 把合成结果做成前端随机 | 研究台 | 合成结果由动作通道返回（LLM 裁决），前端只做演出 |
| v0 发明「清空槽位」按钮 | 研究台 | 不做，只替换；拖回词条库/快捷栏 = 恢复默认 |
| v0 加入玩家文本输入 | 研究台 | 合成台 LLM 零输入，无玩家描述需求的文本框 |
| v0 加「词条快捷栏」或强度数值栏 | 研究台 | 不做：词条从词条库直拖，无火力/射程强度条 |

---

## 七、接线执行检查清单

### 7.1 导入阶段
- [ ] v0 代码已完整导入对应 shell 目录
- [ ] 组件树结构已识别并记录
- [ ] v0 使用的库已确认（Framer Motion / Radix / lucide-react / tsparticles）

### 7.2 替换阶段
- [ ] 所有 `mock*` 占位数据已替换为真实端口
- [ ] 所有假回调已替换为动作通道调用或注入回调
- [ ] 所有 UI 文字已对照术语映射表纠正
- [ ] 限免/UGC 拖拽拒绝规则已实现（交互红闪 + 数据层双保险）
- [ ] 三界面切换回调已注入（回编辑器/去研究台/回素材库）

### 7.3 验证阶段
- [ ] `npx tsc --noEmit` 0 error
- [ ] `npx vitest run src/devboard` 全绿
- [ ] `npm run lint` 0 error
- [ ] `npm run verify:docs` 通过
- [ ] `npm run devboard` 可启动并打开
- [ ] 三界面布局正常显示
- [ ] 核心交互可用（放置/拉边/拖拽/星标/锻造/合成）

### 7.4 交付阶段
- [ ] 多余项目清单已形成（v0 实现了但后端不需要的 UI 元素）
- [ ] 缺失设计清单已形成（后端有但 v0 没实现的功能）
- [ ] 术语映射表已更新
- [ ] 占位素材清单已记录

---

**状态**：准备就绪，等待 v0 代码导入后开始接线。
