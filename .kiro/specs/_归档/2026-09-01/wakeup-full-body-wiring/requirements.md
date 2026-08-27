# WakeUp 全身接线

## 简介

本规范定义 `game-ui-shell-15` 与 WakeUp 地图、表现层、元状态、电脑 UI、素材管线、运行期事件和统一 UI 端口的全面接线工程。工程目标不是增加一组孤立页面，而是将视觉演示壳接入可验证的项目权威契约，使玩家流程、创作流程、素材流程、研究流程、地图表现流程和电脑 UI 流程共享明确的只读投影、显式动作、修订、待汇合和失败回退边界。

本规范保留 `game-ui-shell-15` 的视觉系统、空间构图、角色漫游、动画、粒子、转场、无障碍和交互质感。接线不得以删除、静态化、隐藏或降低视觉表现为代价。真实玩法规则、元状态事实、地图规则和宿主持久化由各自权威层提供；壳层只消费投影并提交显式 intent。

本工程采用分阶段交付，但最终范围覆盖全身接线。阶段之间必须保留机器可校验的端口和回退，不得以 MVP 或临时默认值替代未完成能力。

## 术语表

- **游戏 UI 壳**：`src/devboard/game-ui-shell-15` 中承载标题、驻地、过场、HUD、暂停、结算、素材库、研究台、像素绘制器和开发控制面的视觉前端。
- **产品旅程**：从启动、标题、驻地、匹配、装载、入梦、HUD、暂停、结算、奖励到返回驻地的玩家可操作流程。
- **控制面**：只用于调试、页面检查、失败注入和开发验证的控制面板，不属于产品主流程。
- **唯一旅程状态源**：负责产品页面节点、成功推进、失败落点、安全返回、请求修订和转移状态的唯一状态机。
- **Intent**：UI 向权威能力提交的显式动作请求。
- **Projection**：权威能力向 UI 提供的只读、带修订的状态快照。
- **Projection committed**：权威层已将动作结果写入可读投影的状态。
- **Route transition**：壳层在 intent accepted 且投影条件满足后执行的页面转移。
- **Pending Convergence**：依赖能力尚未汇合时的显式待定状态；该状态不得用空集合、零值或猜测替代。
- **MapDoc**：编辑器富编辑态地图模型，保留坐标、遮挡框、地形和编辑历史等创作信息。
- **Canonical MapData**：`src/play/map` 定义的发布、校验和装载权威地图契约。
- **形状适配器**：只负责两个已定义数据形状之间的字段转换，不负责规则校验或事实裁决。
- **表现层**：消费空间投影和语义事件，输出画面、动画、粒子、音频和转场的只读重演层。
- **RenderProjectionPort**：提供图层、节点、边、实体、集群、瓦片和空间修订的只读端口。
- **RenderCommandApi**：表现层唯一的演出命令出口，不提交玩法规则事实。
- **UiSystemPorts**：由 `src/ui/index.ts` 组合的 projection、events、actionQuery、revision、actions、pendingContracts 和 diagnostics 端口集合。
- **元状态**：跨对局、电脑 UI、素材、研究和玩家长期进展所需的权威状态；UI 不直接修改元状态事实。
- **电脑 UI**：消费 `ComputerStatePort` 只读快照并通过 `ComputerActionPort` 提交显式操作的操作系统式界面。
- **素材适配器**：负责素材解析、预加载、取消、超时、缺失和 fallback 的壳层边界。
- **Transport 适配器**：负责请求、取消、超时、断开、重连和 stale 结果的可替换通信边界。
- **Storage 适配器**：负责设置、临时草稿和 mock session 的版本化存取，不承载玩法事实。
- **视觉终态**：动画、粒子或转场正常结束、跳过、失败、超时或降级后仍可读、可操作的静态状态。
- **Comic beat**：封面角色在不抢夺主视觉的前提下执行的低频、确定性、轻度荒诞表现行为。
- **接线批次**：具有独占可写边界和明确输入输出的实施阶段。

## 要求

### 要求 1：产品旅程统一接入

**用户故事：**作为玩家，我想从默认入口完成完整游戏 UI 旅程，以便不依赖开发控制面即可体验从启动到返回驻地的连续流程。

#### 验收标准

1. WHEN 玩家从默认入口启动，THE 游戏 UI 壳 SHALL 按照 `startup-loading → menu-title → residence-main → utility-match/residence-roaming → shadow-lobby → bed-front-ready → transition-battle-intro → transition-dream(enter) → hud-main → menu-pause → transition-result → reward → transition-dream(return-home) → residence-original-position` 的节点顺序提供可操作入口。
2. WHEN 产品旅程推进，THE 游戏 UI 壳 SHALL 通过唯一旅程状态源执行页面转移。
3. WHEN 控制面被打开，THE 游戏 UI 壳 SHALL 将控制面标记为 development-demo，并 SHALL 不把控制面跳转计入产品旅程验收。
4. WHEN 任一产品节点缺少真实能力，THE 游戏 UI 壳 SHALL 展示显式 mock、pending 或 fallback 状态，并 SHALL 保留后续接线所需的稳定 pageId、intentId 和 projection 槽位。
5. WHEN 玩家重复进入或离开任一产品节点，THE 游戏 UI 壳 SHALL 保持页面状态、焦点状态和演出实例不产生重复叠加。

### 要求 2：唯一状态、Intent、Projection 与路由边界

**用户故事：**作为接线工程师，我想使用单一的动作和路由边界，以便真实宿主接入时不会维护多套相互冲突的前端事实。

#### 验收标准

1. THE 系统 SHALL 使用一个唯一旅程状态源管理产品节点、成功落点、失败落点、安全返回、请求修订和 route transition 状态。
2. WHEN UI 提交动作，THE Intent 端口 SHALL 为请求提供稳定 `intentId`、唯一 `requestId`、来源、目标、参数、mock 标记和 revision。
3. WHEN Intent 返回 `accepted`，THE 系统 SHALL 独立记录 request accepted、projection committed 和 route transition completed 三个阶段。
4. WHEN Intent 返回 `rejected`、`stale`、`timeout`、`cancelled` 或 `disconnected`，THE 系统 SHALL 保留源页面或声明的安全返回页面，并 SHALL 不推进产品旅程。
5. WHEN 页面卸载或请求被取消，THE 系统 SHALL 阻止旧请求、旧 timer、旧 RAF 和旧异步结果写入当前页面状态。
6. THE 系统 SHALL 将 `b6-journey`、`journey-runner` 和 legacy contract 标记为 development-demo 或 legacy-only，且 SHALL 不让这些组件成为产品旅程权威。

### 要求 3：地图编辑态与 Canonical MapData 接线

**用户故事：**作为地图创作者，我想编辑、加载、校验和发布地图，以便编辑体验与游戏装载契约保持一致。

#### 验收标准

1. WHEN 编辑器加载已发布地图，THE 地图接线层 SHALL 将 Canonical MapData 转换为 MapDoc，并 SHALL 保留编辑器需要的图层、节点、边、遮挡、地形、放置、方向性、过渡窗口和语义锚点信息。
2. WHEN 编辑器导出或发布地图，THE 地图接线层 SHALL 将 MapDoc 转换为 Canonical MapData，并 SHALL 通过既有 map-contracts 校验和发布序列化门禁。
3. THE 形状适配器 SHALL 只执行形状转换，并 SHALL 不复制地图规则、类别校验或发布裁决。
4. WHEN 编辑态遮挡框导出，THE 地图接线层 SHALL 将可发布的视觉遮挡和物理遮挡折叠到对应边的 canonical 字段。
5. WHEN 编辑态地形没有 Canonical MapData 对应字段，THE 地图接线层 SHALL 保留地形作为编辑态信息，并 SHALL 在发布报告中明确记录该字段未进入 canonical 契约。
6. WHEN 地图包含边，THE 编辑器 SHALL 为边提供稳定的 `def` 占位或真实定义接入口，并 SHALL 不在 UI 内自创门户代价、通行规则或玩法规则。
7. WHEN MapDoc 完成 canonical 往返转换，THE 接线层 SHALL 保持节点拓扑、边拓扑、方向性、语义锚点和放置宿主语义等价。

### 要求 4：地图表现层接入

**用户故事：**作为玩家，我想看到地图、图层、实体和语义事件被稳定表现，以便编辑地图和运行期游戏共享同一发布数据。

#### 验收标准

1. WHEN 表现层收到 Canonical MapData 或其只读投影，THE 表现层 SHALL 通过 RenderProjectionPort 消费图层、节点、边、实体、集群、瓦片和空间修订。
2. WHEN 表现层收到 `after:*` 语义事件，THE 表现层 SHALL 通过 RenderCommandApi 重演移动、攻击、效果、对峙、迁移、图层聚焦和全屏演出。
3. THE 表现层 SHALL 不计算距离、容量、阻挡、合法性、行动点、伤害、奖励或胜负事实。
4. WHEN `spaceItems` 或 `ai` 能力尚未汇合，THE 表现层 SHALL 展示 Pending Convergence，并 SHALL 不使用空集合、零值或默认实体替代未汇合投影。
5. WHEN 发生静默迁移，THE 表现层 SHALL 只发出 `presentation:immovable-relocatable` 表现事件，并 SHALL 不改写实体归属或规则位置。
6. THE 表现层 SHALL 保持朝向、遮挡、图层和演出状态为表现语义，并 SHALL 不将表现朝向或粒子结果写回规则层。

### 要求 5：素材库接入元状态 Projection 与 Actions

**用户故事：**作为创作者，我想在素材库看到权威素材并执行收藏、快捷栏和贴图操作，以便创作资源和游戏状态保持一致。

#### 验收标准

1. WHEN 素材库请求目录，THE 素材库 SHALL 从 projection 读取 allVisible、ownedMaterials、materialDetail、equippedTokens、badgeState、blueprintList、starred 和 quickBar 数据。
2. WHEN 玩家收藏或取消收藏素材，THE 素材库 SHALL 通过 actions.toggleStar 提交动作，并 SHALL 根据动作结果更新投影或显示失败状态。
3. WHEN 玩家修改快捷栏，THE 素材库 SHALL 通过 quickBarSet 或 quickBarClear 提交动作，并 SHALL 保留限免、未拥有和不可放置素材的不可用解释。
4. WHEN 玩家保存素材贴图，THE 素材库 SHALL 通过 materialSetTexture 提交动作，并 SHALL 将非合成物拒绝结果显示为明确的不可用状态。
5. WHEN 素材投影未汇合，THE 素材库 SHALL 展示 Pending Convergence，并 SHALL 不将静态 demo 目录伪装为权威素材目录。
6. WHEN 素材详情请求词条定位但目标端口未提供，THE 素材库 SHALL 保持入口禁用并显示待接线原因。

### 要求 6：研究台与像素绘制器接入

**用户故事：**作为创作者，我想使用研究台提取、锻造、合成和绘制成品，以便研究结果通过权威动作产生并能回到素材流程。

#### 验收标准

1. WHEN 研究台打开，THE 研究台 SHALL 从 projection 读取 tokens、materialDetail、equippedTokens、synthesisQueue 和 moldingBar。
2. WHEN 玩家提交提取、保存、派生、塑形、合成、收下或加急动作，THE 研究台 SHALL 通过对应 actions 端口提交显式 intent。
3. WHEN 玩家提交合成，THE 研究台 SHALL 展示 actions 返回的结果材料 ID，并 SHALL 不使用前端随机数确定结果。
4. WHEN 提取白名单尚未提供，THE 研究台 SHALL 将提取操作保持禁用并显示待白名单原因。
5. WHEN 玩家保存像素绘制结果，THE 像素绘制器 SHALL 通过唯一 connector 将贴图提交到素材 actions，并 SHALL 不直接修改元状态。
6. WHEN 研究台收下成品，THE 研究台 SHALL 使用权威 resultMaterialId 打开素材详情或像素绘制入口，并 SHALL 不把 baseMaterialId 伪装为成品 ID。
7. WHEN 研究动作处于 pending、失败或超时状态，THE 研究台 SHALL 保留当前可读状态并提供重试、取消或安全返回。

### 要求 7：电脑 UI 与元状态端口接线

**用户故事：**作为玩家，我想通过电脑 UI 查看和操作元状态，以便游戏内操作系统成为真实状态的只读窗口和显式动作入口。

#### 验收标准

1. WHEN 电脑 UI 请求状态，THE 电脑 UI SHALL 通过 ComputerStatePort.fetchState 和 fetchLogs 获取只读快照。
2. WHEN 玩家执行 compute、scan、analyze、decrypt、hack 或 abort 操作，THE 电脑 UI SHALL 通过 ComputerActionPort 提交显式动作，并 SHALL 不直接修改元状态事实。
3. WHEN 元状态或 AI 投影未汇合，THE 电脑 UI SHALL 展示 Pending Convergence 或安全解释标签，并 SHALL 不自行扩展隐藏 AI 字段。
4. WHEN 电脑 UI 收到 `after:*` 事件，THE 电脑 UI SHALL 按 revision 更新只读快照，并 SHALL 丢弃 stale 快照。
5. THE 电脑 UI SHALL 将 CPU、内存、存储、进程和日志等产品字段映射到已裁决的元状态 projection 契约，并 SHALL 不在 UI 中自创权威字段。

### 要求 8：素材、Transport 与 Storage 适配边界

**用户故事：**作为后端接线工程师，我想使用可替换的资源、通信和存储端口，以便真实能力接入时无需修改视觉组件和页面协议。

#### 验收标准

1. THE 系统 SHALL 通过 AssetAdapter 处理素材 resolve、preload、cancel、timeout、missing、failure 和 fallback。
2. THE 系统 SHALL 通过 TransportAdapter 处理 request、cancel、timeout、disconnected、reconnecting、accepted、rejected 和 stale。
3. THE 系统 SHALL 通过 StorageAdapter 处理版本化设置、临时草稿和 mock session，并 SHALL 拒绝将 gameplay fact 写入 UI 存储。
4. WHEN 任一 adapter 失败，THE 游戏 UI 壳 SHALL 保留可读视觉终态、失败诊断和安全返回入口。
5. THE 页面组件 SHALL 不散落业务 fetch、存储调用、私有 DTO 或后端规则解释。
6. THE 适配器 SHALL 为每个请求提供 requestId、revision、timeout、cancel 和 fallback 信息。

### 要求 9：视觉演出保真与性能降级

**用户故事：**作为玩家，我想在接线后继续看到完整的封面、角色漫游、动画和粒子质感，以便逻辑接入不会把游戏 UI 降级为网页。

#### 验收标准

1. THE 系统 SHALL 保留信号核心、标题主视觉、菜单焦点轨道、角色空中漫游和低频 comic beat。
2. WHEN 角色漫游或 comic beat 运行，THE 表现层 SHALL 将角色限制在标题、菜单、信号核心、确认层和错误层之外。
3. WHEN 动画或粒子正常结束、跳过、超时、资源缺失或加载失败，THE 表现层 SHALL 落入同一可读视觉终态，并 SHALL 不推进玩法旅程。
4. WHEN reduced-motion 或 low-performance 生效，THE 表现层 SHALL 降低运动和粒子数量，并 SHALL 保留标题、焦点、状态、语义和操作反馈。
5. WHEN 页面卸载或快速切换，THE 表现层 SHALL 清理 RAF、timer、interval、canvas、事件监听和粒子实例。
6. THE 粒子系统 SHALL 遵守声明的最大数量、分组、触发语义和性能预算。
7. WHEN 动画或粒子显示战斗、伤害、状态或奖励反馈，THE 表现层 SHALL 只消费 presentation event，并 SHALL 不从视觉效果推导规则事实。

### 要求 10：统一无障碍与交互协议

**用户故事：**作为不同输入方式和动效偏好的玩家，我想使用键盘、鼠标、手柄等价操作所有页面，以便视觉演出不会阻断可访问性。

#### 验收标准

1. THE 系统 SHALL 为产品页面、菜单、研究台、素材库、电脑 UI 和 overlay 提供键盘、鼠标和手柄等价的焦点与确认语义。
2. WHEN overlay 打开，THE 系统 SHALL 按 `blocking-error → confirm → child-overlay → parent-overlay → pause → page` 顺序消费 Escape。
3. WHEN overlay 关闭，THE 系统 SHALL 将焦点恢复到触发该 overlay 的可操作控件。
4. WHEN 控件不可用，THE 系统 SHALL 显示稳定的不可用原因，并 SHALL 不只使用颜色表达状态。
5. WHEN reduced-motion 生效，THE 系统 SHALL 保持信息层级、文本可读性和操作焦点。

### 要求 11：错误、Pending Convergence 与安全返回

**用户故事：**作为接线和验收人员，我想复现每类失败并安全恢复，以便未完成的后端能力不会伪装成成功或破坏玩家流程。

#### 验收标准

1. THE 系统 SHALL 为启动、素材、地图、投影、匹配、加载、通信、研究、保存、重启和返回等能力提供 pending、rejected、stale、timeout、cancelled、disconnected 和 safe-return 状态槽位。
2. WHEN 依赖端口未提供能力，THE 系统 SHALL 展示 Pending Convergence，并 SHALL 不返回空映射、默认值或伪造 accepted。
3. WHEN 失败发生，THE 系统 SHALL 将页面停留在源页面或声明的安全返回页面，并 SHALL 提供可读诊断。
4. WHEN 玩家重试，THE 系统 SHALL 创建新的 requestId 和 revision，并 SHALL 不复用过期结果。
5. WHEN 失败状态被恢复，THE 系统 SHALL 只在新 projection 或新 Intent 结果确认后清除失败状态。

### 要求 12：全身数据流与事件修订

**用户故事：**作为系统维护者，我想让地图、元状态、UI、表现和电脑 UI 共享修订与事件边界，以便跨层数据流可追踪且不会产生陈旧覆盖。

#### 验收标准

1. THE 系统 SHALL 通过 `src/ui/index.ts` 组合的 UiSystemPorts 暴露 projection、events、actionQuery、revision、actions、pendingContracts 和 diagnostics。
2. WHEN 任一权威投影变化，THE 系统 SHALL 发布带 revision 的只读快照或 `after:*` 事件。
3. WHEN UI 收到低于当前 revision 的快照或事件，THE 系统 SHALL 丢弃该陈旧输入。
4. WHEN UI 提交动作，THE 系统 SHALL 通过 action port 或专项 ComputerActionPort 提交，并 SHALL 不直接写 projection。
5. THE 系统 SHALL 为地图编辑、素材库、研究台、像素绘制器、游戏 UI、表现层和电脑 UI 保持稳定的跨层 ID 体系。

### 要求 13：发布、资产和版本可追溯

**用户故事：**作为交付维护者，我想追踪地图、素材、壳版本和构建结果，以便接线后可以复现每个视觉和数据状态。

#### 验收标准

1. THE 系统 SHALL 为发布地图提供 canonical 序列化结果、校验诊断和发布 revision。
2. THE 系统 SHALL 为素材提供稳定 assetId、manifest、加载状态和 fallback 记录。
3. THE 系统 SHALL 为 game-ui-shell 记录版本名、源 revision、构建时间、资源清单和验证命令结果。
4. WHEN 交付报告声称构建、类型检查、lint、测试或浏览器审查通过，THE 报告 SHALL 提供可复现命令或交付物内的验证证据。
5. THE 系统 SHALL 分离历史验证结果、当前验证结果、环境阻断和未实现的真实后端能力。

### 要求 14：测试门禁与属性验证

**用户故事：**作为接线工程师，我想用自动测试验证全身数据流，以便大范围改动不会依赖人工猜测。

#### 验收标准

1. THE 工程 SHALL 提供可执行的 typecheck、lint、unit test、property test、integration test 和 build 命令。
2. THE 工程 SHALL 为地图 MapDoc↔Canonical 转换、Intent 生命周期、revision 丢弃、route failure、Pending Convergence、资源 fallback、存储规则和视觉生命周期提供单元测试。
3. THE 工程 SHALL 为每个声明的正确性属性提供一个基于 fast-check 的测试，并 SHALL 至少运行 100 次迭代。
4. WHEN 属性测试失败，THE 工程 SHALL 记录反例并将反例归类为测试错误、实现错误或规范缺口。
5. THE 工程 SHALL 通过产品入口测试完整旅程，并 SHALL 不以控制面跳转替代产品流程测试。
6. THE 工程 SHALL 通过 reduced-motion、low-performance、快速切换、卸载和 overlay stack 测试。

### 要求 15：跨 Spec 边界、批次和交付纪律

**用户故事：**作为多个 Spec 的协作者，我想按独占边界推进接线，以便全身改造不会踩踏既有权威交付物。

#### 验收标准

1. THE 工程 SHALL 将 `src/play/map/**`、`src/ui/ports/**`、`src/ui/presentation/**` 和既有 Spec 交付物视为只读权威，除非对应 Spec 明确开放修改。
2. THE 工程 SHALL 将壳外适配器、元状态实现、表现编排和入口接线放入明确的接线目录，并 SHALL 不把后端规则写入视觉组件。
3. THE 工程 SHALL 为每个并行批次声明独占可写文件、只读参考区、输入产物和交接条件。
4. WHEN 发现职责重复或契约冲突，THE 工程 SHALL 先登记结构冲突并裁决所有权，再实现适配。
5. THE 工程 SHALL 在每个阶段检查点记录已完成项、未完成项、视觉回归、契约风险、环境阻断和下一阶段输入。
6. THE 工程 SHALL 不以 MVP、占位默认值或删除视觉能力的方式关闭未完成项。

## 范围外事项

以下事项不属于本规范的实现范围，但必须保留接线端口或交接项：

- 具体战斗规则、伤害公式、AI 搜索树和隐藏评估。
- 真实网络服务、账号体系、联机协议和生产部署。
- 真实持久化存档中的玩法事实写入。
- 修改 `src/play/map` 和 `src/ui/ports` 的既有权威契约。
- 重新设计已交付的 game-ui-shell-15 视觉系统；本规范只允许保真、修复和提升。
- 将控制面板变成第二套产品导航。
- 用视觉动画、粒子数量或 mock accepted 推导规则事实。
