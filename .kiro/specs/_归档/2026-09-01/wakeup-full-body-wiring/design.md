# WakeUp 全身接线

## 概述

本设计把 `game-ui-shell-15` 定位为渲染交互层，把地图、表现、元状态和电脑 UI 的权威能力留在稳定端口之后。接线层不重写 V0 视觉组件，不把规则写入 React store，也不让任何单一页面成为跨层事实源。

设计采用四个可验证边界：

1. `ShellJourneyHost`：唯一产品旅程状态、页面转移、overlay 和焦点恢复。
2. `UiSystemPorts` / 专项 Computer Ports：只读 projection、事件、合法动作查询、revision、动作提交和 pending convergence。
3. `MapDocAdapter`：MapDoc 与 Canonical MapData 的纯形状转换；校验和发布仍由 `src/play/map` 契约桶负责。
4. `PresentationGateway`：将 `after:*` 语义事件转换为空间投影更新和 `RenderCommandApi` 演出命令；渲染壳只消费其输出。

接线工程分为平台适配、权威投影、表现空间、壳接线、创作界面、运行期演出和验证收束几个阶段。每个阶段发布端口和测试，后续阶段不得绕过前置端口。

## 架构

```text
┌──────────────────────────────────────────────────────────────┐
│ game-ui-shell-15 / ProductShell                              │
│ 标题·驻地·HUD·暂停·素材库·研究台·绘制器·电脑 UI              │
│ 只消费 projection / event / adapter，不写规则事实             │
├──────────────────────────────────────────────────────────────┤
│ ShellJourneyHost + ShellRoute + Overlay/Focus                 │
│ 唯一 page state、intent 生命周期、safe return、revision       │
├───────────────┬──────────────────────┬───────────────────────┤
│ 创作接线层     │ 运行期表现接线层       │ 元状态/电脑 UI 接线层  │
│ MapDocAdapter │ PresentationGateway  │ ComputerState/Action   │
│ Editor Ports  │ SpatialProjection    │ Material/Bench actions │
│ Library/Bench│ RenderCommandApi      │ Pending Convergence    │
├───────────────┴──────────────────────┴───────────────────────┤
│ UiSystemPorts：projection / events / actionQuery / revision    │
│ actions / pendingContracts / diagnostics                       │
├──────────────────────────────────────────────────────────────┤
│ map-contracts / loading-runtime / meta-kernel / playpack      │
└──────────────────────────────────────────────────────────────┘
```

### 设计决策

- 产品入口使用 `ProductShell`；控制面保留为 development-demo，不参与产品验收。
- `shell-route.ts` 是 root route runner；`b6-journey` 和 `journey-runner` 只能作为开发演示或迁移参考。
- `src/play/map/**`、`src/ui/ports/**` 和已批准 Spec 交付物默认只读。接线实现放在 `src/devboard` 的 adapter、host 和 wiring 目录，表现算法只有在既有 presentation Spec 开放时才进入 `src/ui/presentation`。
- MapDoc 的富编辑字段与 Canonical MapData 的发布字段分离保存；不能为了 canonical 形状删除编辑体验字段。
- 未汇合能力统一返回 `Pending Convergence`，不能用空数组、零值或随机 fixture 伪装成功。
- 所有写入通过 ActionPort、ComputerActionPort 或既有玩法 Op；视觉命令只重演事实，不写事实。
- 视觉组件保持现有结构和动效。接线只注入 adapter、projection、事件和动作，不以删除视觉层解决逻辑问题。

## 组件和接口

### 1. ShellJourneyHost

位置建议：`src/devboard/wiring/shell-journey-host.ts`。

```ts
interface ShellJourneyHost {
  readonly page: ShellPageState;
  readonly overlay: OverlaySnapshot;
  readonly revision: number;
  dispatch(intent: ShellIntentRequest): Promise<ShellIntentResult>;
  transition(request: ShellRouteRequest): Promise<ShellRouteResult>;
  safeReturn(reason: string): void;
  cancel(requestId: string): void;
  subscribe(listener: () => void): () => void;
}
```

生命周期：

```text
idle → pending → accepted → projection-committed → route-completed
                  ↘ rejected/stale/timeout/cancelled/disconnected
```

`accepted` 不得直接成为最终页面状态。Host 需要等待 projection 条件或明确 mock projection commit，再调用 route runner。

### 2. UiSystemBridge

位置建议：`src/devboard/wiring/ui-system-bridge.ts`。

```ts
interface UiSystemBridge {
  readonly system: UiSystem;
  readonly revision: RevisionPort;
  snapshot<T>(request: ProjectionRequest): ConvergenceResult<Readonly<T>>;
  subscribe(listener: (event: RuleEventProjection) => void): () => void;
  submit(intent: InteractionIntent): SubmissionOutcome;
}
```

Bridge 只组合既有 `UiSystemPorts`，不复制 projection 类型，不产生新的事实字段。

### 3. MapDocAdapter

位置建议：`src/devboard/wiring/map-doc-adapter.ts`。

```ts
interface MapDocAdapter {
  canonicalToDoc(canonical: CanonicalMapData): MapDoc;
  docToCanonical(doc: MapDoc): CanonicalMapData;
}
```

适配规则：

- `edges.from/to` 与 canonical `a/b` 互转。
- v0 单点 `transitionWindow` 包装为 canonical control 数组。
- `semanticAnchor` 的 `highland/lowland` 映射到 canonical `high/low`。
- 编辑态 `obstructions` 折叠到 edge 的 `visualObstruction` / `physicalObstruction`。
- 编辑态 `terrains` 保留在 MapDoc；canonical 无对应字段时在发布诊断中显式说明。
- placement 的编辑坐标留在 MapDoc，canonical 使用宿主节点和素材 def。
- 适配器不调用校验，不推断边 def，不创建玩法规则。

### 4. MaterialWiringAdapter

```ts
interface MaterialWiringAdapter {
  allVisible(): ConvergenceResult<readonly MaterialMeta[]>;
  ownedMaterials(): ConvergenceResult<readonly MaterialMeta[]>;
  detail(id: string): ConvergenceResult<MaterialDetail>;
  blueprints(): ConvergenceResult<readonly BlueprintMeta[]>;
  equippedTokensOf(id: string): ConvergenceResult<readonly string[]>;
  submit(action: MaterialAction): Promise<SubmissionOutcome>;
}
```

素材库 store 保留 tab、detail、hover、过场等纯 UI 状态；目录、拥有、收藏、快捷栏、贴图和蓝本来自 projection/actions。

### 5. ResearchBenchWiringAdapter

```ts
interface ResearchBenchWiringAdapter {
  tokens(): ConvergenceResult<readonly TokenProjection[]>;
  synthesisQueue(): ConvergenceResult<readonly SynthesisJobProjection[]>;
  moldingBar(): ConvergenceResult<MoldingProjection>;
  submit(action: BenchAction): Promise<BenchActionResult>;
}
```

合成结果由 action 结果提供 `resultMaterialId`，前端不得随机决定结果；白名单缺失时 action 保持不可用。

### 6. ComputerWiringAdapter

```ts
interface ComputerWiringAdapter {
  state(): ConvergenceResult<ComputerState>;
  logs(request: { from: number; to: number }): ConvergenceResult<readonly string[]>;
  submit(operation: ComputerOperation): Promise<UiResult<void>>;
  reset(): Promise<UiResult<void>>;
}
```

`ComputerState` 字段必须由元状态 owner 映射；若 `cpuLevel`、进程或存储没有权威来源，返回 pending 或安全解释，不在电脑 UI 侧生成。

### 7. PresentationGateway

位置建议：`src/devboard/wiring/presentation-gateway.ts`，或在既有 presentation Spec 开放后迁入对应目录。

```ts
interface PresentationGateway {
  spatial(revision: number): ConvergenceResult<Readonly<SpatialProjection>>;
  onEvent(event: RuleEventProjection): readonly RenderCommand[];
  subscribe(listener: (command: RenderCommand) => void): () => void;
}
```

`RenderCommandApi` 只接受表现命令：

```ts
spawn | move | attack | effect | standoff | fullscreen |
hitFeedback | toast | audio | layerFocus | glow | outcome | turnOrder
```

命令可跳过、可降级、可重放，但不提交 AP、伤害、奖励、归属或位置事实。

### 8. Asset / Transport / Storage

```ts
interface AssetAdapter {
  resolve(assetId: string): Promise<AssetResult>;
  preload(assetIds: readonly string[]): Promise<readonly AssetResult[]>;
  cancel(requestId: string): void;
}

interface TransportAdapter {
  request(request: TransportRequest): Promise<TransportResult>;
  cancel(requestId: string): void;
}

interface StorageAdapter {
  read<T>(key: string): Promise<StorageResult<T>>;
  write<T>(key: string, value: T, version: number): Promise<StorageResult<void>>;
  remove(key: string): Promise<StorageResult<void>>;
  reset(): Promise<StorageResult<void>>;
}
```

Storage key allowlist 必须排除 gameplay fact。所有 adapter 结果携带 requestId、revision、timeout、cancel 和 fallback 信息。

## 数据模型

```ts
type ShellIntentOutcome =
  | 'accepted' | 'rejected' | 'stale' | 'timeout'
  | 'cancelled' | 'disconnected' | 'reconnecting';

interface ShellIntentRequest {
  intentId: string;
  requestId: string;
  sourcePageId: string;
  targetPageId?: string;
  parameters: Readonly<Record<string, unknown>>;
  revision: number;
  mock: boolean;
  safeReturnTarget: string;
}

interface ShellIntentResult {
  requestId: string;
  outcome: ShellIntentOutcome;
  accepted: boolean;
  projectionCommitted: boolean;
  projectionRevision?: number;
  diagnostic?: UiDiagnostic;
}

interface ShellRouteRequest {
  sourcePageId: string;
  targetPageId: string;
  requestId: string;
  revision: number;
  safeReturnTarget: string;
}

interface MapDoc {
  schemaVersion: '2.0';
  layers: readonly MapDocLayer[];
  nodes: readonly MapDocNode[];
  edges: readonly MapDocEdge[];
  obstructions: readonly MapDocObstruction[];
  terrains: readonly MapDocTerrain[];
  placements: readonly MapDocPlacement[];
}

interface CanonicalMapData {
  schemaVersion: '2.0';
  layers: readonly CanonicalLayer[];
  nodes: readonly CanonicalNode[];
  edges: readonly CanonicalEdge[];
  placements: readonly CanonicalPlacement[];
}

interface PendingConvergence<T> {
  status: 'pending-convergence';
  capability: 'core' | 'spaceItems' | 'ai' | 'meta-state' | 'transport' | 'asset';
  revision: number;
  retryable: boolean;
  fallback?: T;
}

interface PresentationRevision {
  sequence: number;
  source: 'projection' | 'event' | 'mock';
  committedAt: number;
}

interface ComicBeatContract {
  actorId: string;
  beatId: string;
  lane: 'far-right' | 'upper-right' | 'lower-right' | 'outer-ring';
  trigger: 'timer' | 'signal-pulse' | 'menu-focus';
  durationMs: number;
  reducedMotion: 'static-pose' | 'disabled';
  cleanup: 'timer-cleared' | 'raf-cancelled' | 'unmounted';
  advancesJourney: false;
}
```

## 正确性属性

正确性属性用于表达对所有输入都应成立的不变量；每项属性应由一个 fast-check 测试实现，至少运行 100 次迭代，并使用 `Feature: wakeup-full-body-wiring, Property N: ...` 标记。

**属性 1：产品路由单调且失败不前进**

*对于任何* 产品节点和任一非 accepted Intent 结果，route runner SHALL 保留源节点或进入声明的 safe-return 节点，且 SHALL 不进入源节点之后的成功节点。

**验证：要求 1.1、1.2、2.4、11.3**

**属性 2：Accepted、Projection 和 Route 阶段不混淆**

*对于任何* Intent 结果序列，route runner 只有在 accepted 且 projection committed 条件满足后才能产生 route-completed，单独 accepted 不得产生 route-completed。

**验证：要求 2.3、12.4**

**属性 3：陈旧修订永不覆盖新修订**

*对于任何* 按任意顺序到达的 projection 或 event 序列，系统最终状态的 revision 等于已接收最大有效 revision，低 revision 输入不得修改当前状态。

**验证：要求 2.5、7.4、12.2、12.3**

**属性 4：MapDoc 与 Canonical 拓扑往返等价**

*对于任何* 满足适配边界的 MapDoc，`canonicalToDoc(docToCanonical(doc))` SHALL 保持节点 ID、边端点拓扑、方向性、语义锚点和放置宿主等价。

**验证：要求 3.1、3.2、3.7**

**属性 5：适配器不执行校验和规则裁决**

*对于任何* MapDoc，形状适配器的输出只由输入字段转换决定，适配器不新增规则诊断、不改变合法性、不生成门户代价。

**验证：要求 3.3、3.6**

**属性 6：未汇合能力保持显式 Pending Convergence**

*对于任何* 未提供 core、spaceItems、ai 或 meta-state 投影的端口集合，UI 查询结果 SHALL 是对应 Pending Convergence，且 SHALL 不等价于空数组、零值或成功投影。

**验证：要求 4.4、5.5、7.3、11.2**

**属性 7：表现命令不写规则事实**

*对于任何* PresentationGateway 生成的 RenderCommand 序列，执行命令前后规则投影、行动点、伤害、奖励、实体归属和地图位置事实保持不变。

**验证：要求 4.2、4.3、4.5、4.6**

**属性 8：Storage 不能承载玩法事实**

*对于任何* StorageAdapter 写入 key，非 allowlist key 或包含 gameplay fact 的写入 SHALL 被拒绝，允许的设置、草稿和 mock session 写入可成功。

**验证：要求 8.3、8.5**

**属性 9：视觉降级保持语义终态**

*对于任何* 动画或粒子效果及 normal、skip、timeout、asset-missing、load-failed、reduced-motion、low-performance outcome，最终画面 SHALL 保持标题、焦点、状态、操作反馈和可读语义，且 SHALL 不推进旅程。

**验证：要求 9.1-9.7、10.5**

**属性 10：演出资源全部清理**

*对于任何* 页面挂载、触发、快速卸载和重复挂载序列，活跃 RAF、timer、interval、canvas、listener 和 particle instance 数量 SHALL 在卸载后回到零，且旧实例不得修改新页面状态。

**验证：要求 1.5、2.5、9.5、14.6**

**属性 11：动作提交单通道**

*对于任何* UI action，动作结果只能通过 ActionPort 或 ComputerActionPort 产生，UI 直接修改 projection 或规则事实的路径数量 SHALL 为零。

**验证：要求 5.2、6.2、7.2、12.4**

**属性 12：电脑 UI 只读快照与安全动作**

*对于任何* ComputerStatePort 快照和 ComputerActionPort 操作，电脑 UI 只显示端口提供的字段，操作只提交显式 ComputerOperation，且不扩展隐藏 AI 状态。

**验证：要求 7.1-7.5**

**属性 13：资源与通信请求可取消且不会陈旧回写**

*对于任何* 资源或 Transport 请求序列，取消、超时或断开后的结果不得覆盖更高 revision 的页面或投影状态，并 SHALL 产生声明的 fallback 或安全错误状态。

**验证：要求 8.1、8.2、8.4、8.6、11.4**

**属性 14：完整旅程不依赖控制面**

*对于任何* 从默认 ProductShell 开始的合法操作序列，产品成功路径只使用页面 intent、projection 和 route runner，不使用 control-panel debug jump。

**验证：要求 1.1、1.3、14.5**

## 错误处理

| 错误 | 检测 | 系统处理 | 不允许的处理 |
|---|---|---|---|
| projection 未汇合 | `PendingContractPorts` 返回 pending | 显示 Pending Convergence、重试和安全返回 | 空集合或默认成功 |
| intent 超时 | adapter deadline 到期 | 留在源页，显示 timeout，可重试 | 直接 route |
| stale projection | revision 低于当前 | 丢弃并记录 diagnostics | 覆盖新状态 |
| transport 断开 | transport outcome | 显示 disconnected/reconnecting，保留视觉终态 | 假装 accepted |
| 素材缺失 | AssetAdapter missing | fallback 资源、文字和静态终态 | 永久 loading |
| MapDoc 发布失败 | map-contracts 诊断 | 保留编辑态，显示发布诊断 | 适配器自行修规则 |
| canonical 字段无编辑映射 | adapter boundary diagnostic | 保留可编辑字段并记录交接项 | 静默丢弃而不报告 |
| resultMaterialId 缺失 | synthesis action result | 保持研究台失败态，禁止打开成品 | 用 baseMaterialId 冒充 |
| 电脑字段无权威来源 | convergence pending | 显示安全解释标签 | UI 自算 CPU/AI 状态 |
| 快速卸载 | host lifecycle | cancel timers/RAF/listeners/requests | 旧异步结果回写 |
| 视觉资源或动画失败 | motion/particle outcome | 落入可读语义终态 | 用动画完成推进旅程 |

## 测试策略

### 单元测试

- `MapDocAdapter`：字段转换、遮挡折叠、锚点映射、边端点、placement 宿主。
- `ShellJourneyHost`：成功、失败、取消、超时、stale、safe-return 和 revision。
- `UiSystemBridge`：冻结 projection、事件订阅、动作单通道。
- `PendingConvergence`：core、spaceItems、ai、meta-state 的显式 pending。
- `AssetAdapter`、`TransportAdapter`、`StorageAdapter`：timeout、cancel、failure、fallback 和 allowlist。
- `PresentationGateway`：after:* 到 RenderCommand 的映射，命令不写规则事实。
- `ComputerWiringAdapter`：快照字段、日志、操作和 stale 丢弃。

### 属性测试

使用 TypeScript `fast-check`，每个属性一个测试实现，至少 100 次迭代。测试名称必须包含：

```text
Feature: wakeup-full-body-wiring, Property N: ...
```

MapDoc 往返测试不得承诺 canonical 中不存在的 terrains/编辑坐标往返；该部分单独断言 MapDoc 富编辑态保留。

### 集成测试

- 从默认 ProductShell 走完整成功旅程。
- 从 HUD 打开暂停、设置、重新开始、返回标题并验证 route runner。
- 素材库 → 详情 → 研究台 → 合成 → 成品 → 像素绘制器 → 保存。
- 编辑器加载 Canonical MapData → 编辑 → 校验 → 发布。
- after:* 事件 → PresentationGateway → RenderCommandApi → 视觉壳。
- 电脑 UI snapshot → operation → after:* → 新 revision。
- Pending Convergence、断线、重连和安全返回。

### 视觉与生命周期测试

- 浏览器人工检查和截图 artifact：封面信号、角色漫游、comic beat、菜单焦点、暂停冻结、过场、HUD、结算和返回驻地。
- reduced-motion、low-performance、asset missing、快速切页和重复挂载。
- overlay Escape stack、focus trap、focus return。
- RAF/timer/interval/canvas/particle cleanup。

### 门禁

```bash
npx tsc --noEmit
npx vitest run
npm run lint
npm run verify:docs
npm run verify:prompt-pack
npm run build
```

独立壳目录如有自己的 package script，必须提供可复现的 `typecheck`、`test`、`lint`、`build`。报告必须区分当前执行、历史结果、环境阻断和未实现的真实宿主能力。
