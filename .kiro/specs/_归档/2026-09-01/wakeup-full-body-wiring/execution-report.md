# 全身接线执行报告

日期：2026-08-26
规范：`.kiro/specs/wakeup-full-body-wiring/`

## 本批次完成

### 壳根 owner 注入

新增：

```text
src/meta-state/demo-fixture.ts
src/devboard/editor-shell/components/meta-state-provider.tsx
src/devboard/wiring/meta-state-shell-binding.ts
```

`editor-shell/app/page.tsx` 已挂载 `MetaStateProvider`。当前 provider 使用明确标记的 `demo-fixture` owner，生命周期内绑定素材库/研究台 store，卸载时解除绑定。真实 owner 替换点已固定，不把 demo projection 冒充为持久化或后端事实。

### MetaState 与素材模型

新增并实现：

```text
src/meta-state/types.ts
src/meta-state/asset-ref.ts
src/meta-state/actor-binding.ts
src/meta-state/profile-refs.ts
src/meta-state/revision.ts
src/meta-state/store.ts
src/meta-state/projection.ts
src/meta-state/material-availability.ts
src/meta-state/actions/result.ts
src/meta-state/actions/material-actions.ts
src/meta-state/actions/bench-actions.ts
src/meta-state/actions/facade.ts
src/meta-state/index.ts
```

能力：

- MaterialIdentity / MaterialMeta 分离。
- 简介、描述、可选 icon、必填 texture、品级、展示分类。
- RuntimeEntityKind 与 DisplayCategory 分离。
- player / ai-player / npc / unbound 控制身份。
- AI 不作为素材或可单独放置实例。
- AssetRef、视图方向和 SHA-256 校验形状。
- profile 引用只读校验，不复制玩法 profile。
- 深冻结 projection、revision、subscription、stale 检查。
- 星标、快捷栏、贴图、提取 pending、锻造、合成提交、成品 ID、收下、塑形。
- availability 的拥有/限免/不存在判断。

### 前端素材库/研究台接线边界

新增：

```text
src/devboard/editor-shell/lib/material-adapter.ts
src/devboard/wiring/meta-state-view.ts
src/devboard/wiring/meta-state-shell-binding.ts
```

现有 UI store 已增加可注入 owner：

- `library-store.ts` 的 toggleStar、quickBarSet、quickBarClear、materialSetTexture 在绑定 MetaState 后走权威 actions。
- `bench-store.ts` 的 forgeSave、startExtract、moldingSet 在绑定 MetaState 后走权威 actions/pending。
- 未绑定 owner 时保留明确的 demo fallback，以便旧视觉壳不崩溃；fallback 不得被报告为真实元状态。
- 视觉组件、CSS、角色漫游、comic beat、粒子和转场未删除或降级。

### 终局结果投影

新增：

```text
src/play/loading-runtime/result-projection.ts
```

该 adapter 只读取 `MatchShell`：

```text
running → reward unavailable/pending
ended + outcome → reward projection available
```

UI 不再需要自行猜测终局。`createLoadedMatch` 的 `evaluateAndRecord` 已改为优先使用实际 active playpack 的 outcomes，再回退官方 outcomes。

## 验证

本批次执行：

```text
11 个测试文件
37 个测试
全部通过
```

覆盖：

- MetaState 类型、资产、角色和 profile 引用。
- store projection/revision。
- 素材 actions、研究台 actions。
- 旧素材 ID 适配。
- 素材库 owner binding。
- running/ended 结果 projection。
- 自定义玩法包和终局相关装载回归。

门禁：

```text
新增范围 TypeScript 检查：通过
新增范围 ESLint：通过
npm run verify:docs：通过
npm run verify:prompt-pack：通过
```

## 尚未完成且没有虚报

- `game-ui-shell-15` 的独立 Next 壳根尚未正式创建 MetaState owner 并调用 `bindMetaStateShell`；binding/facade 已完成，正式入口注入仍需壳运行方式接线。
- 素材库/研究台 React 组件仍有部分直接读取旧 mock data；下一步应逐组件切换到 projection adapter，但不能在缺少壳 alias/build 的情况下伪造完成。
- 真实 MetaState 持久化 owner、提取白名单、LLM 合成结果、蓝本熟悉度来源和角色 sprite 自动注册尚未接入。
- 表现层 SpatialProjection、CollisionRegistry、Pathfinding、ORCA、Move/Attack/Standoff choreography 和 RenderCommandApi 具体实现仍属于后续设计工程。
- 根项目完整 typecheck 仍受独立 game-ui-shell-10/15 Next 依赖和 alias 环境阻断；本批次新增核心代码已独立检查通过。
