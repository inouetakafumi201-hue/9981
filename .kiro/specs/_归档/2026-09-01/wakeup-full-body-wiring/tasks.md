# WakeUp 全身接线

## 概述

本任务清单将 `requirements.md` 与 `design.md` 转换为可执行的 TypeScript 接线工程。任务按强顺序分为基线与边界、平台与唯一宿主、地图与创作数据、元状态与电脑 UI、表现层与运行期、视觉壳接线、验证与交付收束七个阶段。

实现纪律：

- 只在任务声明的独占文件或目录写入；既有权威端口和其他 Spec 交付物默认只读。
- 不修改 `src/play/map/**`、`src/ui/ports/**` 或已批准 Spec 交付物来绕过契约缺口；冲突写入交接项和决策记录。
- 保留 `game-ui-shell-15` 的视觉层、角色漫游、comic beat、动画、粒子、转场、焦点和无障碍；接线不得通过删除或静态化视觉实现来关闭任务。
- 所有未汇合能力必须使用 Pending Convergence，禁止空集合、零值、随机结果或默认成功。
- 每项任务完成后运行其声明的局部验证；检查点不通过时先修复再进入下一阶段。
- 实现语言：TypeScript + React，测试使用 Vitest 与 fast-check；属性测试至少 100 次迭代。

## 任务

### 阶段 A：基线、边界与工程门禁

- [ ] 1. 建立全身接线基线与并行写入锁
  - 读取并登记 `game-ui-shell-15`、`src/ui/index.ts`、`src/ui/ports/**`、`src/play/map/**`、`wakeup-presentation-layer` 和 `meta-mechanism-kernel` 的权威入口。
  - 创建接线范围清单，声明每个后续任务的独占目录、只读参考区、输入产物和交接条件。
  - 记录当前产品入口、控制面、页面 ID、素材 ID、地图 ID、元状态端口和版本信息。
  - 建立 `src/devboard/wiring/` 作为壳外接线层；不把接线逻辑散落到视觉组件。
  - _要求：15.1-15.6，13.3-13.5_

- [ ] 2. 补齐工程可执行门禁
  - 为接线工程提供 `typecheck`、`test`、`lint`、`build` 和相关 integration 命令。
  - 确认 fast-check、Vitest 和浏览器验证脚本的实际入口；缺失依赖记录为环境阻断，不伪造通过。
  - 将历史验证、当前验证、环境阻断和未实现能力分开记录。
  - _要求：14.1，13.4-13.5_

- [ ]* 2.1 建立门禁自检测试
  - 为脚本存在性、测试发现、配置加载和报告命令生成最小自动检查。
  - _属性：Feature: wakeup-full-body-wiring, Property 14: 工程门禁可执行_
  - _验证：要求 14.1、13.4_

- [ ] 3. 记录旧实现和重复权威的退役计划
  - 标记 `b6-journey`、`journey-runner`、legacy intent contract 和旧 EditorApp 的使用者。
  - 不直接删除仍被其他 Spec 使用的文件；建立 development-demo/legacy-only 迁移标记和交接记录。
  - _要求：2.6，15.1-15.4_

- [ ] 检查点 A：基线门禁
  - 执行类型检查、现有相关测试、lint、文档校验和 shell build（若环境可用）。
  - 交付当前基线报告，列出所有失败和环境限制；未形成可复现基线不得进入阶段 B。
  - _要求：13.4-13.5，14.1_

### 阶段 B：唯一产品宿主、Intent 与路由

- [ ] 4. 实现唯一 `ShellJourneyHost`
  - 在 `src/devboard/wiring/shell-journey-host.ts` 实现唯一产品节点状态、overlay、revision、pending request、safe return 和订阅。
  - 接入现有 `ProductShell`，保留原页面视觉组件和页面 ID。
  - 将控制面明确限制为 development-demo，禁止 debug jump 改变产品验收状态。
  - _要求：1.1-1.5，2.1，15.2_

- [ ] 5. 统一 Intent 生命周期和 projection commit
  - 在 `src/devboard/wiring/intent-bridge.ts` 组合现有 intent adapter，注入 ID 生成器、clock、timeout 和取消机制。
  - 独立表示 accepted、projection committed 和 route completed。
  - 支持 rejected、stale、timeout、cancelled、disconnected、reconnecting，并保留安全返回。
  - 旧 adapter 仅作为 legacy/demo 适配，不得拥有产品状态写入权。
  - _要求：2.2-2.5，8.2，11.1-11.5_

- [ ] 6. 实现统一 overlay、Escape 和焦点恢复桥
  - 将 ProductShell、暂停、确认、设置、素材库、研究台、电脑 UI 接入统一 overlay stack。
  - 实现 focus trap、trigger focus return、重复挂载清理和 Escape 优先级。
  - 不改变当前视觉层级和过渡演出。
  - _要求：10.1-10.5，1.5_

- [ ]* 6.1 添加 Intent 与路由属性测试
  - 使用 fast-check 生成节点和结果序列，验证失败不前进、stale 不覆盖、accepted 不等于 route completed。
  - 至少 100 次迭代，测试注释必须使用规定标签。
  - **属性 1：产品路由单调且失败不前进**
  - **属性 2：Accepted、Projection 和 Route 阶段不混淆**
  - **属性 3：陈旧修订永不覆盖新修订**
  - _验证：要求 2.3-2.5，11.3-11.4，12.2-12.3_

- [ ] 7. 将默认入口接入完整产品旅程
  - 让 `app/page.tsx` 默认挂载正式 ProductShell 和 ShellJourneyHost。
  - 实现启动、标题、驻地、匹配/漫游、影子大厅、床位、战斗介绍、入梦、HUD、暂停、结算、奖励、返回驻地的成功与失败入口。
  - 每个节点保留失败、取消、超时和安全返回的视觉终态。
  - _要求：1.1-1.4，11.1-11.5_

- [ ]* 7.1 添加默认入口完整旅程集成测试
  - 从 ProductShell 开始，禁止使用控制面 debug jump，走完成功路径和至少一条失败安全返回路径。
  - _验证：要求 1.1、1.3、14.5_

- [ ] 检查点 B：产品宿主
  - 验证默认入口、暂停、设置、返回标题、重新开始、safe return、focus return 和重复进入。
  - 核对 ProductShell 与报告一致；未接入页面必须显式标记 pending，不得报告为完成。
  - _要求：1.1-2.6，10.1-11.5_

### 阶段 C：地图编辑态、Canonical MapData 与发布

- [ ] 8. 实现 MapDoc ↔ Canonical MapData 形状适配器
  - 在 `src/devboard/wiring/map-doc-adapter.ts` 实现 `canonicalToDoc` 和 `docToCanonical`。
  - 处理图层、节点、边端点、边 def、方向性、过渡窗口、语义锚点、遮挡、放置宿主和编辑态地形边界。
  - 适配器只做转换，不导入 map 小路径、不复制校验和玩法规则。
  - _要求：3.1-3.7，15.1-15.2_

- [ ] 9. 接通地图加载、编辑保存和发布门禁
  - 加载既有 canonical 地图并生成富编辑态 MapDoc。
  - 本地草稿保存 MapDoc；发布导出使用 canonical 序列化和既有 map-contracts 校验。
  - 保留编辑器即时诊断；发布前叠加权威地图诊断。
  - 对 terrains、编辑坐标和缺失边 def 生成明确交接诊断。
  - _要求：3.1-3.6，13.1_

- [ ]* 9.1 添加地图往返与发布属性测试
  - 生成合法 MapDoc，验证拓扑、方向性、语义锚点和放置宿主往返等价。
  - 单独验证编辑态 terrains/坐标保留，不声称 canonical 往返保留不存在字段。
  - **属性 4：MapDoc 与 Canonical 拓扑往返等价**
  - **属性 5：适配器不执行校验和规则裁决**
  - _验证：要求 3.3、3.7、14.2-14.4_

- [ ] 10. 统一地图与素材 ID
  - 将编辑器快捷素材、素材库 MaterialMeta、MapData placement def 和 sprite manifest 对齐到稳定素材 ID。
  - 保留批量注册入口，拒绝组件内硬编码第二套素材事实。
  - _要求：3.6，5.1，12.5，13.2_

- [ ] 检查点 C：地图接线
  - 执行 canonical 校验、发布序列化、MapDoc 往返、素材 ID 和已有地图加载测试。
  - 对 canonical 不支持的地形、坐标和边 def 形成缺失设计清单，不偷偷扩展契约。
  - _要求：3.1-3.7，13.1，14.2_

### 阶段 D：元状态、素材库、研究台、像素绘制器与电脑 UI

- [ ] 11. 建立元状态接线宿主和 Pending Convergence 映射
  - 在壳外建立 meta-state wiring，不将元状态事实写进 shell store。
  - 将 core、spaceItems、ai、meta-state 的未汇合结果统一映射为 Pending Convergence。
  - 为 revision、after:* 事件和 diagnostics 建立可观察桥。
  - _要求：7.3-7.5，11.1-11.5，12.1-12.5_

- [ ] 12. 接入素材库 projection/actions
  - 将目录、拥有、详情、蓝本、equipped tokens、badge、star、quickbar 和 texture 从 demo store 替换为 projection/actions。
  - 保留本地 UI 过场、筛选、详情和 hover 状态。
  - 实现限免、未拥有、非合成物贴图拒绝和词条待接线禁用原因。
  - _要求：5.1-5.6，8.5_

- [ ] 13. 接入研究台 projection/actions
  - 将 token、forge、molding、synthesis queue、提取、保存、派生、合成、收下和加急接入 actions。
  - 结果必须来自 action 返回的 resultMaterialId，禁止前端随机结果。
  - 白名单缺失、pending、失败、超时和取消保持可读状态。
  - _要求：6.1-6.7，11.1-11.5_

- [ ] 14. 接入像素绘制 connector
  - 保持 pixel painter 为纯视觉组件，由唯一 connector 提交素材贴图 action。
  - 接通保存、丢弃、失败、取消和返回素材详情；禁止绘制器直接写元状态。
  - _要求：6.5，8.5，12.4_

- [ ] 15. 接入 ComputerStatePort 与 ComputerActionPort
  - 以电脑端口读取状态和日志，以 ComputerActionPort 提交 compute、scan、analyze、decrypt、hack、abort、reset。
  - 将产品化 CPU、内存、存储、进程字段映射到权威元状态 projection；无来源字段保持 pending 或安全解释。
  - 处理 after:* revision、stale、失败和安全返回。
  - _要求：7.1-7.5，11.1-11.5_

- [ ]* 15.1 添加元状态动作属性测试
  - 验证素材、研究、绘制和电脑 UI 的写入只通过 action port，projection 不被 UI 直接修改。
  - **属性 6：未汇合能力保持显式 Pending Convergence**
  - **属性 11：动作提交单通道**
  - **属性 12：电脑 UI 只读快照与安全动作**
  - _验证：要求 5.2、5.5、6.2、7.2-7.4、11.2、12.4_

- [ ] 检查点 D：创作与电脑 UI
  - 验证编辑器→素材库→研究台→像素绘制器→素材详情的页面闭环。
  - 验证电脑 UI 的快照、日志、动作、revision、stale 和 pending convergence。
  - 不将无权威字段或后端未交付能力伪装成完成。
  - _要求：5.1-7.5，11.1-12.5_

### 阶段 E：空间表现层、事件编排与运行期接线

- [ ] 16. 修正和冻结空间投影的 canonical 输入边界
  - 通过统一 canonical 适配层消费 layers/layerId，不直接依赖 legacy floors/parent 假设。
  - 明确 LayerView、NodeView、EdgeView、EntityView、ClusterView、TileView 的只读深冻结契约。
  - 缺少 canonical 字段时返回诊断或 pending，不默认生成规则数据。
  - _要求：4.1、4.4、12.1-12.3_

- [ ] 17. 实现表现空间状态和算法接入
  - 在批准的 presentation 目录实现 CollisionRegistry、ClusterStore、spatialStore、facingStore、glowStore。
  - 接入 TraversableComputer、canTraverse、PathfindingService、OrcaEngine、StandoffAlgorithm 和 ContagionScheduler。
  - 表现算法只消费地图几何和只读运行期投影，不写规则事实。
  - _要求：4.1、4.3、4.6；依赖 wakeup-presentation-layer 既有设计_

- [ ] 18. 实现 PresentationGateway 与 RenderCommandApi 编排
  - 将 after:entity.place、after:attack、after:turn-end 等语义事件映射为 move、attack、effect、standoff、fullscreen、hitFeedback、layerFocus 等命令。
  - 实现交权硬同步、不可动静默迁移桥和演出完成/跳过/失败终态。
  - 命令不能改 AP、伤害、奖励、归属、位置或胜负事实。
  - _要求：4.2-4.6，9.3、9.7_

- [ ]* 18.1 添加表现层契约与不变量测试
  - 验证投影深冻结、pending convergence、命令不写规则事实、迁移事件不改归属和事件编排序列。
  - **属性 7：表现命令不写规则事实**
  - **属性 14：完整旅程不依赖控制面**
  - _验证：要求 4.1-4.6、14.2、14.5_

- [ ] 检查点 E：表现层
  - 执行空间投影契约、算法预算、after:* 事件编排、RenderCommandApi、交权同步和迁移桥测试。
  - 核对表现层没有导入玩法规则或写入事实。
  - _要求：4.1-4.6，12.1-12.4_

### 阶段 F：Asset/Transport/Storage 与视觉壳保真

- [ ] 19. 统一 AssetAdapter
  - 将 shell manifest、sprite frame、HUD、地图表现资源和 fallback 接入统一 asset adapter。
  - 支持 resolve、preload、cancel、timeout、missing、failure、fallback 和 asset revision。
  - 保留封面信号、角色漫游、comic beat、HUD 和过场视觉；不得用占位资源替代已交付成品。
  - _要求：8.1、8.4、9.1-9.3、13.2_

- [ ] 20. 统一 TransportAdapter 与 StorageAdapter
  - mock transport 仅模拟协议结果；真实 transport 保留可替换边界。
  - storage 仅允许设置、临时草稿和 mock session key；拒绝 gameplay fact。
  - 支持 timeout、cancel、disconnected、reconnecting、fallback 和 reset。
  - _要求：8.2-8.6，13.3_

- [ ] 21. 视觉演出生命周期收束
  - 对封面信号、角色漫游/comic beat、菜单、暂停、过场、HUD、粒子、音频和 overlay 做定向视觉自审。
  - 修复 reduced-motion、low-performance、快速重复触发、快速切换、卸载和重复挂载问题。
  - 保持主视觉层级、角色安全区、标题可读性、焦点反馈和视觉终态。
  - _要求：9.1-9.7，10.1-10.5_

- [ ]* 21.1 添加视觉生命周期与资源失败测试
  - 验证 RAF/timer/interval/canvas/listener/particle cleanup、动画终态、asset failure、reduced-motion、low-performance 和 overlay focus。
  - **属性 9：视觉降级保持语义终态**
  - **属性 10：演出资源全部清理**
  - **属性 13：资源与通信请求可取消且不会陈旧回写**
  - _验证：要求 8.1-8.4、9.3-9.6、10.2-10.5、14.6_

- [ ] 检查点 F：视觉保真
  - 使用浏览器或等价可视化环境保存封面、漫游、comic beat、暂停、转场、HUD、结算、错误、reduced-motion 和 low-performance artifact。
  - 对照 game-ui-shell-15 基线，任何视觉降级必须返工，不得以逻辑通过替代视觉验收。
  - _要求：9.1-9.7，13.3-13.5_

### 阶段 G：全量验证、报告与交付

- [ ] 22. 建立全身集成测试套件
  - 覆盖默认产品旅程、暂停、地图加载/发布、素材库、研究台、像素绘制器、电脑 UI、表现事件、adapter 失败和 safe return。
  - 禁止用 control-panel debug jump 替代产品入口测试。
  - _要求：1.1、5.1-7.5、14.2、14.5_

- [ ] 23. 完成属性测试和反例记录
  - 为设计中的 14 条属性各建立一个 fast-check 测试，至少 100 次迭代。
  - 失败时记录反例分类，不自行修改需求绕过失败。
  - _要求：14.2-14.4_

- [ ] 24. 完成三命令及文档门禁
  - 执行 `npx tsc --noEmit`、`npx vitest run`、`npm run lint`、`npm run verify:docs`、`npm run verify:prompt-pack`、`npm run build`。
  - 独立壳和接线层命令必须记录真实输出；环境缺失如实记录。
  - _要求：13.4-13.5，14.1_

- [ ] 25. 更新接线执行报告和缺失设计清单
  - 在 `EXTRACTION-REPORT.md` 或接线专属报告中记录当前验证、历史验证、环境阻断、mock-only 能力、真实宿主待接线项、视觉回归结果和版本身份。
  - 列出多余项目、缺失设计、契约冲突和未完成后端能力。
  - _要求：13.3-13.5，15.5_

- [ ] 26. 全身交付检查点
  - 逐项核对 requirements 1-15、design 属性 1-14 和本 tasks 全部任务。
  - 确认默认入口不依赖控制面、所有写入走合法端口、所有 pending 显式、视觉未降级、所有报告可复现。
  - _要求：1.1-15.6_

## 备注

1. 任务 1-3 完成后才能建立实现分支；任务 4-7 完成后才能接创作界面；任务 8-10 完成后才能接地图运行期表现；任务 11-15 完成后才能接电脑 UI 和研究数据；任务 16-18 完成后才能把真实空间事件接入视觉壳。
2. 任务 17-18 受 `wakeup-presentation-layer` 既有 Spec 的开放边界约束。若该 Spec 尚未开放写入，创建交接项，不直接修改其交付物。
3. 旧 EditorApp、B6Journey 和 JourneyRunner 不得在未核对引用前删除；先隔离 authority，再由独立退役任务处理。
4. MapDoc↔Canonical 往返不承诺 canonical 不存在的 terrains 和编辑坐标；这些字段只在富编辑态报告保留。
5. 真实元状态、网络、存储、匹配、战斗、AI 和奖励由权威层提供。接线任务只能消费 projection、事件和 action result，不得在 UI 侧补规则。
6. 所有属性测试必须使用唯一标签格式：`Feature: wakeup-full-body-wiring, Property N: ...`，每项至少 100 次迭代。
7. 所有检查点必须记录：完成项、未完成项、视觉回归、契约风险、环境阻断和下一阶段输入。