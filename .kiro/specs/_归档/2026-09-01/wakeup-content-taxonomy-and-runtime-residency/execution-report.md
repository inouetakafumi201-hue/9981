# 内容分类与运行期驻留执行报告

日期：2026-08-26
规范：`.kiro/specs/wakeup-content-taxonomy-and-runtime-residency/`

## 已完成

- 冻结玩法层、玩法文件、地图原数据、地图表现资产、地图玩法文件、地图包、带地图玩法包和“玩法包”泛称的边界。
- 新增 `src/play/content/content-manifest.ts`：ContentKind、ContentManifest、依赖、entry、loadPolicy 和安全清单校验。
- 新增 `src/play/content/content-residency.ts`：logical / visual / runtimeObject 三类驻留、index-only、deferred 请求、retain/release、失败状态和 revision。
- 新增 `src/play/content/play-file.ts`：PlayFile、MapBundle、MapBoundPlaypack 和禁止直接写 WorldState 的边界校验。
- `LoadedMatchOptions.playpack` 已接入 `createLoadedMatch` → `loadCoreMechanics`；实际玩法包 ID 被激活，缺省才使用官方包。
- README 的玩法层和运营系统定义已从“玩法层包含地图数据”修正为内容类型分离。

## 验证

```text
content-taxonomy-residency.test.ts：2/2 通过
play-file-boundary.test.ts：2/2 通过
ugc-load-chain.test.ts：6/6 通过
ugc-full-rule-chain.test.ts：5/5 通过
load-equivalence.e2e.test.ts：8/8 通过
总计：23/23 通过
verify:docs：通过
verify:prompt-pack：通过
```

## 当前仍未完成

- ContentManifest 尚未接入 zip/目录/网络 carrier 的统一读取器。
- residency manager 目前是纯内存状态管理器，尚未接入真实正文解析、引用图和卸载调度。
- MapBundle、MapPlayFile、MapBoundPlaypack 尚未进入 `createLoadedMatch` 的统一包入口；独立 `map?: MapDataDocument` 作为兼容路径保留。
- 玩法文件尚未形成完整执行器；当前只完成边界类型和安全校验。
- `parent`、edge portal `def/weight`、PrefabDef 运行期保留和多地图入口隔离仍属于跨 Spec 设计交接项。
- 表现层空间投影、算法、编排和 RenderCommandApi 具体实现不在本阶段继续猜测。

## 明确交接给表现层阶段

表现层下一阶段需要在 canonical MapData v2 边界冻结后设计并实现：

```text
Canonical MapData
→ SpatialProjection（layers/layerId）
→ CollisionRegistry / ClusterStore
→ Traversable / Pathfinding / ORCA
→ Move / Attack / Standoff choreography
→ PresentationGateway
→ RenderCommandApi
→ game-ui-shell
```

本阶段没有把 legacy `floors/parent` 投影继续扩散，也没有把表现动画或视觉资源推导成规则事实。
