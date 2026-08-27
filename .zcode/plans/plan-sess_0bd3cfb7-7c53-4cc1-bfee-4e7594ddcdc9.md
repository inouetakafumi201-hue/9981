## 目标

在不实现未设计的表现层算法、不改变 `src/play/map/**`、`src/ui/ports/**` 权威契约的前提下，完成素材/角色/实体/词条/AI 控制配置的代码实现，并把 game-ui-shell-15 的素材库、研究台、地图编辑器素材入口切换到统一的 MetaState projection/actions。完成后只剩表现层本身（空间投影算法、碰撞、寻路、ORCA、演出编排和 RenderCommandApi 实现）作为后续设计工程。

## 已确认的现状

- `src/meta-state/` 当前不存在。
- `editor-shell/lib/materials.ts`、`library-data.ts`、`bench-data.ts` 是前端演示数据，不能继续作为权威。
- `library-store.ts`、`bench-store.ts` 当前直接修改星标、快捷栏、贴图、锻造、合成和塑形状态。
- `src/ui/ports` 已提供 projection、action、revision、event、convergence 的可复用边界。
- `src/play/profiles/catalog.ts` 及 `src/play/profiles/{items,npcs,statuses,vehicles,weapons}` 是玩法 profile 权威目录。
- `docs/L2_基类层/07_AI系统.md` 已明确玩家 AI、AI 玩家、NPC AI 的算法和行动轮边界。
- 角色 sprite manifest 和 shell asset manifest 是表现资产权威候选，但尚未与素材身份和玩法 profile 建立统一引用。

## 阶段 1：冻结代码契约与引用模型

独占写入：`src/meta-state/**`、`src/devboard/wiring/**` 新增文件、对应测试。

1. 新建 `src/meta-state/types.ts`，定义并区分：
   - `MaterialIdentity`：id、name、introduction、description、iconAssetRef、textureAssetRef、quality、displayCategory、runtimeEntityRef、actorBinding。
   - `DisplayCategory`：装置、照明、陈设、交互、线索、遮挡、物品、武器、载具、生物、角色、机制、氛围、蓝本。
   - `RuntimeEntityKind`：item、weapon、vehicle、npc、character、interactive、environment。
   - `ActorBinding`：player、ai-player、npc、unbound，以及可选 controllerRef。
   - `TokenMeta`：五类词条、ID 引用、拥有状态、品质、星标和收集时间。
   - `BlueprintMeta`：地图/梦境内容 ID、熟悉度、解锁状态、来源和派生引用。
   - 元状态身份字段与展示投影字段分离。

2. 新建 `src/meta-state/asset-ref.ts`，定义 `AssetRef` 与验证：
   - icon、world-top-down、item-front、portrait、sprite-sheet 视图。
   - manifestId、entryId、SHA-256、状态和 fallback。
   - 不允许用 `tile` 作为唯一资产身份；保留旧 atlas 兼容字段但不进入权威身份。

3. 新建 `src/meta-state/actor-binding.ts`，定义角色实体绑定和控制器引用：
   - 真实玩家、AI 玩家、NPC、无控制表现四种身份。
   - AI 玩家只引用 PlayerAI policy/difficulty 配置。
   - NPC 只引用 NpcAI behavior/perception/target/action 配置。
   - AI 本身不作为素材或可单独放置实例。

4. 为旧 frontend mock 建立明确的 `demo-fixture` 转换层，不能把旧 mock 直接导出为 MetaState。

## 阶段 2：实现唯一 MetaState store、projection 和 revision

独占写入：`src/meta-state/store.ts`、`src/meta-state/projection.ts`、`src/meta-state/revision.ts`、相关测试。

1. 采用项目已有的模块级可变状态 + `useSyncExternalStore` 模式，但 store 不暴露直接 setter。
2. 初始数据只作为经过标记的 demo fixture 注入，所有 fixture 必须通过新类型验证。
3. projection 输出深冻结的只读快照：
   - materials、tokens、blueprints、quickBar、moldingBar、synthesisQueue。
   - 名称、描述、资产引用和 runtimeRef 都从统一目录读取。
   - equippedTokens 和 weakness 使用 TokenId，不嵌套 TokenMeta。
4. projection 带统一 revision；不允许 UI 自增伪造权威 revision。
5. 提供 subscription 和 stale projection 拒绝行为。
6. 未提供真实 owner 时，返回显式 `Pending Convergence`，不得把 demo fixture 误标成真实权威投影。

## 阶段 3：实现 MetaState actions 和产权边界

独占写入：`src/meta-state/actions/**`、`src/meta-state/material-availability.ts`、相关测试。

实现以下动作，全部通过统一 action result 返回 accepted/rejected/stale 与 committedRevision：

1. `toggleStar(materialId)`。
2. `quickBarSet/quickBarClear(materialId, slot)`，统一拒绝未拥有、限免和不可放置内容。
3. `materialSetTexture(materialId, assetRef)`，只允许符合素材身份和视图要求的贴图；非合成物拒绝按权威设计执行。
4. `extractToken(materialId, focusAttr)`，白名单未汇合时返回 pending/rejected，不猜测。
5. `forgeModify(materialId, slots, mode)`。
6. `synthesizeSubmit`，提交时由 action/owner 提供结果，不使用前端随机；结果必须有独立 `resultMaterialId`。
7. `synthesizeClaim/synthesizeRush`。
8. `moldingSet`。
9. `blueprintFamiliarity` 和解锁动作，来源必须可追踪。
10. `material-availability.ts` 改为 MetaState owner 的只读实现；开发者全放行只保留显式 dev adapter，不再作为默认权威。

动作实现只修改 MetaState，通过统一 revision 发布 projection；UI 不直接写 store。

## 阶段 4：接入玩法 profile 与角色/AI 配置

独占写入：`src/meta-state/profile-refs.ts`、必要的 profile adapter 和测试；`src/play/profiles/**` 只读。

1. 建立 `runtimeEntityRef` 到 `src/play/profiles/catalog.ts` 的解析器，只引用 profile，不复制 profile 内容。
2. 建立角色视觉 manifest 到 `visualMaterialId/AssetRef` 的解析器；角色视觉资源和运行时 profile 分开校验。
3. 建立 `CharacterEntityBinding`：
   - `player`：真实玩家控制。
   - `ai-player`：PlayerAI 控制，使用玩家实体属性和玩家行动轮。
   - `npc`：NpcAI 控制，使用 NPC profile 和 NPC 阶段。
   - `unbound`：仅肖像、对话、回顾或背景演出。
4. 为 NPC 校验 `behaviorRef`、`perceptionRef`、`targetPolicyRef`、`actionRefs`、AP/SP/生命配置来源。
5. 为 AI 玩家校验 `policyRef`、`difficultyRef`、searchDepth/risk/information/tie-break 参数来源。
6. 禁止素材库直接编辑 AI 参数、NPC FSM、搜索树、隐藏评估或行动轮字段。

## 阶段 5：统一旧前端素材目录和 ID 迁移

独占写入：`src/devboard/editor-shell/lib/material-adapter.ts`、必要的 wiring 文件和测试；视觉组件结构保持不变。

1. 建立旧 `materials.ts` ID 到 canonical material/profile ID 的一次性迁移表。
2. 让 `materials.ts` 的旧 API 从统一 registry 派生，仅保留 `materialById`、旧筛选和 atlas 兼容能力。
3. 让 `library-data.ts` 成为 demo fixture/投影 adapter，不再作为权威数据源。
4. 让 `bench-data.ts` 的 token/job fixture 通过新 projection 形状生成，不再拥有第二套 token 目录。
5. 修改 `map-bridge` 的 placement resolver，使 placement `def` 使用稳定 material definition ID；未知 ID 返回诊断，不静默丢失。
6. 修改 editor right-panel、library tile、canvas 字符显示，统一通过 registry resolver，不再解析旧 ID 字符串格式。
7. 保留视觉布局、贴图、动画和交互手感，不减少现有 UI 能力。

## 阶段 6：将素材库、研究台、像素绘制器接到 projection/actions

独占写入：壳外 adapter 和指定 UI 接线文件；不改变既有视觉组件的布局设计。

1. 素材库目录、详情、徽章、快捷栏和蓝本消费 MetaState projection。
2. 星标、快捷栏和纹理保存通过 MetaState actions。
3. 研究台 token、forge、molding、synthesis queue 消费 projection。
4. 提取、锻造、合成、收下、加急、塑形通过 actions。
5. 像素绘制器只通过 connector 提交贴图 action。
6. 所有 pending、rejected、stale、timeout、cancelled 均保留当前视觉终态和可读原因。
7. `game-ui-shell-15` 的标题、暂停、HUD、角色漫游、粒子和转场不在本阶段修改。

## 阶段 7：本地终局事实到 UI 的闭环

独占写入：`src/play/loading-runtime/**` 允许的组合根接线文件、UI projection adapter 和测试；不改规则定义。

1. 使用已有 `evaluateOutcomes`、`recordOutcome`、`match-shell` 作为终局事实来源。
2. 明确连接：终局评估 → outcome 写入 → `after:*`/projection → transition-result → reward projection → return-home。
3. `transition-result` 不自行判定胜负，reward 不由 UI 生成。
4. 失败、重复终局、终局后提交和安全返回均有测试。
5. 保持 `game-ui-shell-15` 视觉终态，仅替换数据来源和 transition 触发来源。

## 阶段 8：表现层边界冻结，不实现未设计部分

只读审查并形成交接文档，不实现 ORCA/A*/碰撞等尚未完成设计：

1. 列出当前 `RenderProjectionPort` 的 legacy `floors/parent` 假设。
2. 列出 `RenderCommandApi` 只有接口、没有具体宿主实现的事实。
3. 列出 `PresentationGateway` 与 `after:*` 事件的实际生产接线点。
4. 将表现层下一阶段输入冻结为：
   ```text
   Canonical MapData
   → SpatialProjection
   → CollisionRegistry / ClusterStore
   → Traversable / Pathfinding / ORCA
   → Move / Attack / Standoff
   → PresentationGateway
   → RenderCommandApi
   → game-ui-shell
   ```
5. 不把表现层缺口伪装成素材/前端接线问题。

## 阶段 9：验证与报告

每阶段执行局部测试，最终执行：

```bash
npx tsc --noEmit
npx vitest run
npm run lint
npm run verify:docs
npm run verify:prompt-pack
```

新增测试至少覆盖：

- MaterialIdentity 字段和资产视图约束。
- DisplayCategory 与 RuntimeEntityKind 分离。
- `player` / `ai-player` / `npc` / `unbound` 控制身份。
- AI 玩家和 NPC 的行动轮差异。
- MetaState projection 深冻结和 revision。
- action 单通道、stale、rejected、pending convergence。
- 旧 material ID 迁移和 map placement resolver。
- token ID 引用不嵌套 TokenMeta。
- 合成结果独立 `resultMaterialId`。
- 蓝本 Map/Content 引用。
- 终局事实到 result/reward UI projection。
- 视觉资产加载失败和素材缺失 fallback。

执行报告必须区分：

```text
已完成代码
已完成设计
mock-only
待真实 owner
表现层交接
环境阻断
未实现后端事实
```

## 不触碰的内容

- 不修改已批准的表现层算法契约来迁就素材库。
- 不把 AI、NPC FSM、难度参数、隐藏评估写入素材 MetaState。
- 不让 UI store 成为素材拥有权、品级、合成结果或蓝本解锁的事实源。
- 不删除 game-ui-shell-15 的任何视觉层、角色漫游、comic beat、粒子或转场。
- 不实现尚未完成设计的 ORCA、A*、碰撞和完整 RenderCommandApi。
- 不把测试通过、fixture 存在或 adapter 文件存在当成真实后端接线完成。
