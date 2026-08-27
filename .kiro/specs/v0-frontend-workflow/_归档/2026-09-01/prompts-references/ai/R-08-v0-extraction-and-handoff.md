# R-08 V0 抽取与 mock→port 交接重写 brief

## 1 页面定位

定义从前端生成 AI 产物中抽取控制面板/效果组件/页面壳层，并将 mock 数据交接到稳定 UI port 的方法。目标不是再次生成游戏逻辑，而是让生成结果能作为可运行、可审计、可替换的展示层：保留组件结构和视觉手感，替换数据和动作来源。

控制面板是开发期的指令集中转站/效果展示入口，不是玩家产品页面；它只能触发已登记的 presentation 或导航 demo，不展示后端规则、AI 决策、地图几何或内部编辑工具 UI。抽取后的组件必须能在没有后端时用 fixture 演示，在接入真实 projection 后不改变组件树。

## 2 权威来源（attachmentId/provenance）

- `G-01-project-and-scope-contract`：UI-only、完整壳层、素材允许和后端排除。
- `G-03-ui-port-contract`：`UiPorts`、snapshot、intent/result 和 mock→projection 替换。
- `G-04-interaction-accessibility`：统一输入 intent、焦点和读屏。
- `G-05-motion-audio-fallback`：表现事件和 fallback 交接。
- `G-06-mock-data-fixtures`：`source: mock`、状态 fixture、1–5 可见数值。
- `G-07-conflict-register`：当前裁决、旧内容只作 heritage、+3 和旧主菜单冲突处理。
- `G-08-page-and-batch-index`：页面、批次、路由和依赖交接。
- `governance-v0-shell-10` / `references/source/governance-v0-shell-10.md`：V0 生成→接线→验收三阶段、7 条接线铁律和四张清单。
- `governance-v0-system-12` / `references/source/governance-v0-system-12.md`：偷师板、偷师前端、命名抽取、完全阉割逻辑和转换脚本。
- `frontend-workflow-design` / `.kiro/specs/v0-frontend-workflow/design.md`：页面/批次/PromptPacket 设计边界。

## 3 当前决策

- 接线原则是“结构保留，逻辑替换”：保留组件名、树、props、样式语言、动效和焦点顺序；将硬编码数据、fake state、placeholder callback 全部换成 provider/ports。
- UI 仅读 `StatePort`，通过 `ActionPort` 提交 intent，通过 `CadencePort` 获取刷新；组件不调用 `OpRegistry`、不直接写 store、不读后端路径。
- mock fixture 是可运行展示输入，必须带 `source: "mock"`、revision 和完整 ready/empty/error/pending/timeout/safe-return；mock 数据不等于规则事实。
- 生成 AI 不实现 Canvas/SVG 地图几何、镜头高频 lerp、图层透明度、ORCA、寻路、规则状态机、AI 决策或后端 API。需要这些能力时，通过只读投影或端口交接。
- 控制面板抽取按稳定命名执行，例如 `OutcomeReveal`、`CurrencyPop`、`WhiteFlash` 等 presentation effect；名称对应组件而非业务规则。面板按钮触发演示事件/导航 intent，不能绑定业务计算。
- 真实标题 PNG 不存在时交接状态必须是 pending；遗留 A-203、legacy 文档和旧主菜单/旧 burst 只用于迁移识别，不得进入当前实现。

## 4 状态机

抽取流水线：`source-package → inventory → isolate → fixture-run → contract-check → port-ready → handoff`；失败进入 `diagnostic → fix | defer`。

组件数据：`mock snapshot → render → intent pending → accepted | rejected | stale | timeout → next snapshot`。

效果：`registered → triggered → playing → settled`；资源失败/跳过直接 fallback/settled。

接线：`unwired → adapter-ready → connected → verified`；接口不兼容为 `blocked → safe-return`，不得偷偷改变签名。

## 5 组件树

`ExtractionHost → ControlPanelShell → CategoryNav → CommandList → CommandPreview → PagePreview → FeedbackRegion`。

抽取后的实际页面保持 `PortProvider → PageSurface → ProjectionView + IntentControls + FeedbackRegion`。效果组件保持独立根：`EffectPlayer → SemanticEvent → VisualEffect + AudioCue + Fallback`。控制面板不持有第二个 `AppRouter`、规则 store、地图 canvas 或后端 adapter。

每个抽取单元配套 `ComponentManifest`，登记 `componentId`、`pageId`、`batch`、`props`、`intentIds`、`assetRefs`、`fallback`、`source` 和 `status`，方便人工/脚本检查。

## 6 只读数据

端口最小形状：

```ts
interface StateSnapshot {
  screen: string;
  phase: string;
  entities: readonly Record<string, unknown>[];
  resources: readonly Record<string, unknown>[];
  notices: readonly Record<string, unknown>[];
  source: 'mock' | 'projection';
  revision: number;
}
interface IntentRequest { intentId: string; payload: Record<string, unknown>; requestId: string; }
interface IntentResult { requestId: string; status: 'accepted'|'rejected'|'stale'|'timeout'; reason?: string; nextRevision?: number; }
interface UiPorts {
  state: { getSnapshot(): StateSnapshot };
  action: { submit(request: IntentRequest): Promise<IntentResult> };
  cadence: { subscribe(listener: (snapshot: StateSnapshot) => void): () => void };
}
```

fixture 中字段须有来源标签；端口 adapter 可投影页面专属 subset。抽取过程检查是否有 `mock`、`fake`、`placeholder` 硬编码、业务 callback、直接 store 写入和隐藏规则字段。发现后记录到清单，不用测试特例掩盖。

## 7 动作意图

所有控件生成统一 `IntentRequest`，包括导航、设置、dialog、battle、residence、effect skip、control-panel preview。按钮不能直接调用规则函数或 mutate snapshot。控制面板允许 `presentation.play`、`presentation.skip`、`navigate.page`、`settings.preview` 等开发期意图；禁止 `battle.resolve`、`ai.decide`、`map.compile`、`store.write` 之类伪业务命令。

接线 adapter 将旧回调映射为 intent builder；若旧组件使用 `onSelect`，抽取层改成显式 `intentId/payload/requestId`，但不改视觉组件层级。结果只通过 `IntentResult` 和下一个 snapshot 返回。

## 8 本地 UI 状态

允许组件内部持有 focus、selection、expanded、filter、pageIndex、drag preview、pendingRequestId、animationPhase、toast queue、reducedMotion 和演示参数。禁止持有 authoritative snapshot 的派生副本、AP/HP/伤害/路径/AI 选择、任务完成、match facts、inventory truth、result rewards 或路由业务事实。乐观视觉只能标 `pending`，不能冒充 accepted。

## 9 视觉令牌

- 抽取产物保持原页面的像素前景+全息光层、语义色和层级，不因接线改成后台表格。
- 控制面板自身可简洁、清晰、开发期可审计，使用同一 token：分类、命令、状态、fallback、来源标签可读；不使用暗黑终端或内部调试热力图。
- 组件效果素材从 manifest 的 `assetRef` 读取；允许 PNG/纹理/立绘/光效。缺失时用语义占位，不删除组件位或退化为“零素材”宣传。
- focus、disabled、pending、rejected、stale、accepted 使用图标/文字/材质配合颜色；同屏命令或选项 ≤5，长列表分页/滚动。

## 10 动效绑定

- 控制面板 preview 调用已登记的语义效果；`OutcomeReveal` 只演示 outcome snapshot，不决定胜负；`CurrencyPop` 只演示已给出的 reward projection；`WhiteFlash` 只演示 transition，不改变 route。
- 抽取时保留 Framer Motion/既有动效组件的命名和 stage；动画完成不是业务成功回调。
- 页面切换、列表重排、错误回弹、跳过和 reduced motion 的行为由 brief/manifest 记录，不能在接线中临时重写。
- 结果动画必须由 accepted/projection update 触发；rejected/stale/timeout 使用错误/回弹，旧动画必须取消或收敛到新 snapshot。

## 11 输入无障碍

抽取不得丢失原组件的 aria label、role、description、shortcut、disabled reason、focus order、live region 和焦点归还。按钮、菜单、拖拽、快捷键和控制面板命令都使用同一个 intent builder。键盘/手柄/触控/读屏等价；拖拽提供“选来源→选目标→确认”键盘替代。动画可跳过，reduced motion 保留顺序/结果。

## 12 加载错误超时

provider 未接通、asset 加载失败、action pending、stale、timeout、版本不兼容和 manifest 缺项都必须有确定的状态。显示连接中、重试、取消或安全返回；不能静默回退成规则成功。抽取的效果有默认配方和 fallback；音频/粒子失败转文字/图标，图片失败转轮廓/占位。测试 fixture 要覆盖 ready/empty/error/pending/timeout/safe-return。

## 13 明确不做

不重构 V0 产物、不引入新架构、不把后端路径/类名写进生成 prompt、不直接修改后端或跨 Spec 目录、不绕过 port contract、不把控制面板发布为玩家 UI、不生成四类排除系统内部 UI。不为让测试通过硬编码输入，不创建第二套 action callback，不伪造真实资产、标题 PNG、规则成功、经济余额或 AI 决策证据。

## 14 依赖交接

交付四张可审计清单：

1. 多余项目：生成了但不属于当前 UI 范围的组件/按钮，标记隐藏、禁用或后置。
2. 缺失设计：投影有而壳层没有的可见 surface，标记补充或待裁决。
3. 术语映射：生成文字 → WakeUp 术语 → pageId/intentId/port 字段。
4. 占位素材：assetId/assetRef、来源、status、fallback、待生成/待替换。

真实接线方实现 `UiPorts` 或等价 adapter；素材方按 `asset-manifest.json` 提供文件和 provenance；页面方保持组件 props、pageId、intentId、aria 和 fixture shape。冲突先登记到交接项，不跨 Spec 改对方交付物。

## 15 验收条件

- 抽取组件能独立用 mock fixtures 演示 ready/empty/error/pending/timeout/safe-return，且切换 projection 不改组件树。
- 所有动作都有 intentId/payload/requestId 和结果态；无直接 store write、后端路径、OpRegistry、规则回调或业务计算。
- 控制面板只触发已登记 presentation/navigation preview；不会生成四类内部 UI、AI 决策、地图几何或规则结果。
- 组件名、manifest、assetId、pageId、batch 和状态可自动/人工核对；标题 PNG pending、A-203 legacy、+3 disabled 等历史信息没有被误激活。
- 键盘/手柄/触控/屏幕阅读器、reduced motion、素材/音频失败和超时均有等价、可恢复行为；提交的交接清单完整。
