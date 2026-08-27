# B3-01 Residence Node and Input Brief

## 1 页面定位

- 本 brief 定义 `residence-main` 的出租屋实体层、节点职责、漫游输入和交互命中区域。
- 房间是可移动的现实地图，也是主界面。实体承载入口职责，不能被改造成导航图标、四按钮菜单或 dashboard 卡片墙。
- 节点只提交 action intent；本地 UI 只读运营投影，不执行装载、匹配、规则、拓扑或对局结算。
- 重点交付：床A竞技入口、床B后置禁用、床C自测入口、锚定导流仪和其他承载物端口，以及键鼠/键盘/辅助技术输入等价。

## 2 权威来源（只写 attachmentId/provenance）

- attachmentId: `ops-residence-flow-03`
  provenance: `residence-real-map-main-interface-entity-responsibility-three-beds-and-anchor-gate`
- attachmentId: `ops-outside-growth-01`
  provenance: `nodes-as-outside-menu-async-match-and-low-ui-residence`
- attachmentId: `presentation-implementation-09`
  provenance: `residence-static-entity-assets-hover-glow-and-layered-rendering`
- attachmentId: `user-residence-mvp-gate-20260820`
  provenance: `bed-a-only-competitive-bed-b-deferred-bed-c-self-test-only`

## 3 当前决策

- 节点职责固定：床A=主线/竞技装载入口，但 MVP 只开放竞技；床B=联机副本入口，后置不可点；床C=自己建好的梦的自测入口，不可入局。
- 锚定导流仪位于床旁，负责竞技模式、匹配状态和规则准备摘要；床负责床前就绪，不把两者合并成一个按钮。
- 锚定导流仪未完成交互前，床A、床B、床C都不作为可入局交互目标。床C的自测说明可采用单独开发期端口，但不可绕过门控进入正式对局。
- 匹配期间玩家可继续移动并使用非冲突节点；输入焦点不能被异步匹配状态强制锁死。匹配完成后影子大厅仍叠加在原出租屋，不改变节点输入空间。
- 其他实体只显示入口端口或被动内容：研究台、造梦舱、电脑、书架、保险箱、电视、门缝均不实现内部系统。
- 节点层把床前就绪交接给装载层；装载失败或返回时由 `return-home` 过渡将玩家交回原位置。
- 允许真实素材和已登记素材资产参与实体渲染；每个实体需要稳定的 `assetId`，不使用无语义占位方块代替素材承载物。

## 4 状态机

```text
node-idle
  -> node-hover
  -> node-focused
  -> node-intent-submitted
  -> node-return

bed-a: locked -> lit-after-match -> front-ready -> loading
bed-b: deferred-disabled (terminal for MVP)
bed-c: self-test-available -> self-test-open -> self-test-return
anchor: idle -> focused -> panel-open -> matching -> complete/error
roam: keyboard/pointer/gamepad -> walking-visual -> focus-restored
```

- 床A只有 `match.state === complete` 且 `targetBed === bed-a` 时可进入 `front-ready`。
- 床B不能从任何输入路径离开 `deferred-disabled`。
- 床C的状态机不能产生 `start-load` 或 `start-match`。
- 节点 hover/focus 不等于可用；不可用节点必须保留清晰原因。

## 5 组件树

```text
ResidenceNodeInputRoot
├─ ResidenceSceneCanvas
│  ├─ RoomBackdropAsset
│  ├─ BedACompetitiveNode
│  ├─ BedBDeferredNode
│  ├─ BedCSelfTestNode
│  ├─ AnchorDeviceNode
│  ├─ ResearchBenchPort
│  ├─ DreamCabinPort
│  ├─ ComputerPort
│  ├─ TelevisionPort
│  ├─ BookshelfPort
│  ├─ SafePort
│  └─ DoorSlitNarrativeSurface
├─ RoamController
│  ├─ KeyboardRoamInput
│  ├─ PointerFocusInput
│  ├─ GamepadInputAdapter
│  └─ ReducedMotionPositionFeedback
├─ NodeFocusLayer
│  ├─ NodeLabel
│  ├─ NodeStatusBadge
│  └─ NodeTooltip
└─ NodeIntentAnnouncer
   └─ ResidenceLiveRegion
```

## 6 只读数据

```ts
interface ResidenceNodeProjectionMock {
  readonly nodes: ReadonlyArray<{
    readonly id: 'bed-a' | 'bed-b' | 'bed-c' | 'anchor-device' | 'bench' | 'dream-cabin' | 'computer' | 'tv' | 'bookshelf' | 'safe' | 'door-slit';
    readonly label: string;
    readonly role: 'competitive-load' | 'deferred-co-op' | 'self-test' | 'match-setup' | 'port' | 'notice' | 'narrative';
    readonly availability: 'locked' | 'available' | 'deferred' | 'port-only';
    readonly assetId: string;
    readonly mock: true;
  }>;
  readonly playerPosition: { readonly x: number; readonly y: number; readonly anchor: string; readonly mock: true };
  readonly anchorState: 'idle' | 'matching' | 'complete' | 'error';
  readonly targetBed: 'bed-a' | null;
}
```

Mock 样例：`bed-a` = `{ label: '床A·竞技', availability: 'locked', assetId: 'asset:bed-a-blue', mock: true }`；`bed-b` = `{ label: '床B·后置', availability: 'deferred', assetId: 'asset:bed-b-coral', mock: true }`；`bed-c` = `{ label: '床C·自测', availability: 'available', assetId: 'asset:bed-c-cyan', mock: true }`。`bed-c` 的 `available` 只表示自测端口可用，不表示可入局。

## 7 动作意图

- `focus-node(nodeId)`：显示节点名、职责、可用性和素材状态。
- `open-anchor-panel`：打开锚定导流仪竞技面板。
- `start-competitive-match`：提交竞技匹配意图，继续允许漫游。
- `cancel-match`：提交取消匹配意图，回到待机呈现。
- `ready-at-bed-a`：匹配完成且玩家在床A命中区时提交床前就绪意图。
- `open-bed-c-self-test`：查看自建梦自测端口，显示「不可入局」。
- `open-residence-port(portId)`：打开研究台/造梦舱/电脑/书架/保险箱的入口占位说明。
- `dismiss-node-overlay`：关闭节点说明并回收焦点。
- `roam-to(positionId)`：提交视觉漫游输入，不写玩法拓扑。

## 8 本地 UI 状态

- 节点统一维护 `idle / hover / focus / active / disabled / return` 五态；五态是视觉状态闭包，不得遗漏 return。
- 床A `locked` 显示灰色扁平材质和「先在锚定导流仪完成竞技匹配」；`lit` 才显示蓝色边缘光和「前往床A就绪」。
- 床B `deferred` 显示珊瑚色实体的低饱和版本、后置角标和不可操作说明；不响应 Enter、Space、点击或游戏手柄确认。
- 床C `self-test` 显示青色实体、开发期自测提示和明确「不可入局」文案；可打开/关闭自测说明。
- 端口节点点击只打开一次性职责说明浮层；浮层关闭时焦点回到原节点。
- 漫游时当前焦点节点可有轻微轮廓高光；异步匹配状态不覆盖玩家移动输入。

## 9 视觉令牌

- 蓝 `--semantic-competitive` 只用于床A的竞技可用态和科技清醒语义；珊瑚用于床B的后置联机语义；青用于床C的自测/UGC来源语义。
- 灰用于锁定、延迟和后置；橙用于匹配进行中；绿用于竞技匹配已完成/可就绪；红用于错误；纯白只用于梦境边界和仪式，不用于普通节点底色。
- 实体层使用素材帧、阴影、遮挡、局部光和空间比例区分职责；节点标签和浮层保持半透明，避免遮住出租屋。
- 素材可见且可挂载：床、锚定导流仪、书架、保险箱、电视、门缝和房间底板应使用已登记或后续登记的 `assetId`，代码只叠加交互反馈。
- 不使用统一的四角圆卡片包裹所有节点，不使用网页侧栏导航或滚动条。

## 10 动效绑定

- 节点 hover/focus 使用 Framer Motion 的小幅 `scale`、边缘光和材质反射，不能用 CSS 线性淡入承担主交互动效。
- 锚定导流仪打开面板时，使用局部聚焦/遮挡和半透明层，不把整个房间切成等待页面。
- 床A从 locked 到 lit 使用 `AnimatePresence` 和色彩/轮廓显影；床B/C不发生连带点亮。
- 床前就绪使用玩家移动到床边的短促空间反馈；床本身始终可见并保持固定实体。
- 自测浮层使用轻量入场和关闭回弹；减少动效时保留焦点、文字和状态变化。

## 11 输入无障碍

- 节点使用语义化 button 或等价可访问目标；场景装饰素材不抢占 Tab 顺序。
- Tab 顺序按空间职责：锚定导流仪 → 床A（根据门控禁用）→ 床C自测 → 其他端口；床B以 disabled 语义存在但不可操作聚焦。
- 键盘：方向键/WASD 漫游，Tab/Shift+Tab 切节点，Enter/Space 提交可用意图，Esc 关闭浮层；所有鼠标动作有键盘等价。
- 使用 `aria-label`、`aria-describedby`、`aria-disabled` 与 live region；不能只靠蓝/珊瑚/青/灰颜色表达状态。
- 对焦到床B时可宣读「床B，后置内容，目前不可用」；对焦到床C时宣读「床C，自测入口，不可入局」。
- 支持 reduced motion、焦点不丢失、文字反馈不依赖音效。

## 12 加载错误超时

- 节点素材加载失败时，保留节点的语义名称、职责和错误标记，显示 `assetId` 对应的可读诊断；不得静默换成另一实体素材。
- 漫游输入无响应超过 UI 阈值时显示一次「当前位置暂不可达（mock）」提示，并回到最近确认位置；不得创建路径或移动规则状态。
- 锚定导流仪匹配超时显示「匹配超时（mock）」并提供重试/取消；房间输入仍可用。
- 节点端口打开失败显示职责说明和「暂不可用（mock）」；不展开内部界面。
- 错误 live region 不抢夺持续输入焦点；Esc 或关闭动作能恢复节点焦点。

## 13 明确不做

- 不实现床B联机副本、不实现床C正式入局、不实现主线/竞技之外的模式选择。
- 不把驻地节点转换成地图节点拓扑、路径成本、ORCA 或寻路系统。
- 不实现研究台、造梦舱、电脑、书架、保险箱内部 UI。
- 不以按钮矩阵替代出租屋空间，不以无素材方块替代可见实体素材。
- 不让 disabled 节点通过键盘、鼠标、触摸或快捷键绕过门控。
- 不在本地写入匹配、装载、结算、玩家位置或游戏规则。

## 14 依赖交接

- 依赖 B3-00 的页面范围、状态命名、intent 命名和床A/B/C门控。
- 依赖 B1 的 AppShell、路由挂载、全局视觉令牌和可访问原语。
- 向 B3-02 交接 `open-anchor-panel`、`start-competitive-match`、`cancel-match`、`targetBed`、`shadow-lobby` 状态槽。
- 向 B3-03 交接 `ready-at-bed-a`、`returnOrigin`、`assetId`、`skip-ceremony` 与装载失败分支。
- 素材由既定素材管线生成/登记；本 brief 只消费稳定 `assetId` 与 manifest，不修改素材管线或其他目录。

## 15 验收条件

- [ ] 出租屋首先呈现空间和真实实体素材，节点提示是叠加层而不是网页导航。
- [ ] 锚定导流仪、床A、床B、床C及端口职责清楚可读。
- [ ] 锚定导流仪完成前三床不能进入正式流程；完成竞技匹配后只有床A变为可用。
- [ ] 床B所有输入均被拒绝并说明后置；床C可自测但明确不可入局。
- [ ] 匹配中可用键盘/指针/手柄在房间继续漫游，且焦点不丢失。
- [ ] 节点有五态、键盘等价、非颜色状态信息和错误 live region。
- [ ] 任一素材加载错误都保留实体语义和可追踪 assetId；没有“零素材”验收捷径。
- [ ] `npx tsc --noEmit`、相关 `npx vitest run`、`npm run lint` 按项目门禁执行并通过。
