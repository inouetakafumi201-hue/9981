# WakeUp 内容分类与运行期驻留

## 概述

本清单冻结内容分类后，按“契约 → 编解码 → 运行期驻留 → 地图/玩法关联 → 验证”顺序实施。任务不得通过删除地图兼容入口、复制玩法规则或把视觉资源当作规则事实来关闭缺口。

## 任务

- [ ] 1. 建立内容类型和术语唯一来源
  - 新建 `ContentKind`、`LoadPolicy`、`ContentManifest`、`ContentDependency` 和 `ContentEntry` 类型。
  - 建立玩法层、玩法文件、地图原数据、地图表现资产、地图玩法文件、地图包和带地图玩法包的术语映射。
  - 将“玩法包”标记为集合/传输泛称，zip 仅作为 carrier。
  - _要求：1.1-1.6，2.3，3.1-3.2_

- [ ] 2. 实现内容清单解析、校验和依赖索引
  - 校验 contentId、contentKind、version、compatibility、dependencies、entries 和 sha256。
  - 构造依赖图并在正文解析前完成必选依赖检查。
  - 拒绝可执行代码、非法格式、版本不兼容和校验失败内容。
  - _要求：2.4，3.1-3.5，6.5_

- [ ]* 2.1 添加清单与依赖属性测试
  - **属性 1：内容类型职责不交叉**
  - **属性 2：清单依赖顺序稳定**
  - 使用 fast-check，至少 100 次迭代。
  - _验证：要求 1.1-1.6、3.1-3.4、6.1-6.5_

- [ ] 3. 实现分阶段内容驻留管理器
  - 实现 manifest、index、match-setup、active-phase、presentation-window、release 阶段。
  - 分别记录逻辑内容、视觉资产和运行期对象驻留。
  - 实现 eager、deferred、index-only、retain、release、cancel 和失败终态。
  - 活动执行栈、投影和资源请求持有的内容不得释放。
  - _要求：4.1-4.8，6.3_

- [ ]* 3.1 添加驻留属性测试
  - **属性 3：index-only 不解析正文**
  - **属性 4：deferred 首次需求才载入**
  - **属性 5：活动引用阻止释放**
  - **属性 6：逻辑、视觉和运行对象驻留分离**
  - **属性 9：内容取消不会陈旧回写**
  - 每项至少 100 次迭代。
  - _验证：要求 4.1-4.8、7.3-7.4_

- [ ] 4. 统一 PlaypackCompiler 与内容清单
  - 将 `PlaypackInput`、`CompiledPlaypack`、`playpackDef`、maps、profiles 和 deliveryForm 映射到内容类型。
  - 保留官方、uploaded、player-uploaded、llm-generated 来源差异和安全诊断。
  - 明确 maps 是 MapBundle/MapData 输入，不把 zip 名称当作语义。
  - _要求：2.1-2.5，3.1-3.5，5.4-5.5_

- [ ] 5. 修正运行期玩法包装载入口
  - 让 `LoadedMatchOptions.playpack` 接受 `PlaypackDef` 或等价编译产物入口。
  - `createLoadedMatch` 将自定义包传给 `loadCoreMechanics`，并使用实际包 ID 激活。
  - 缺省输入继续使用官方默认包。
  - 保留独立 `map?: MapDataDocument` 兼容入口，同时记录其迁移边界。
  - _要求：5.1-5.5_

- [ ]* 5.1 添加官方与自定义包装载集成测试
  - 验证自定义包的 defs、rules、outcomes、schedule 和激活 ID 不被官方默认包替换。
  - **属性 7：自定义玩法包经过统一装载**
  - _验证：要求 5.1-5.3、14.2_

- [ ] 6. 定义 PlayFile、MapPlayFile 与 MapBundle 关系
  - 为流程、阶段、触发器、生命周期、地图节点绑定、表现绑定和结果组合建立声明式 schema。
  - MapBundle 追踪 map data、visual assets、map play 和入口节点。
  - MapBoundPlaypack 支持玩法文件、地图包引用、局部定义和表现覆盖。
  - 多地图 entry-by-map 只保留明确的入口关系，不暗示已完成运行期隔离。
  - _要求：1.3、2.1-2.2、5.4_

- [ ] 7. 收敛地图 canonical/legacy 边界
  - legacy v1 只在导入边界 normalize 为 canonical v2。
  - 表现投影统一消费 layers/layerId，不以 floors/parent 作为 canonical 默认来源。
  - 对 parent、edge.def、weight、placement runtime binding 的未决项建立跨 Spec 交接，不静默补规则。
  - _要求：3.4，7.1-7.4_

- [ ]* 7.1 添加地图包入口关系测试
  - **属性 8：地图入口关系可追踪**
  - 验证 MapBundle、MapData、MapPlayFile 和 entry node 的关系不会丢失。
  - _验证：要求 2.1-2.5、5.4_

- [ ] 8. 接通 PlayFile 到运行期和表现事件的安全调用面
  - PlayFile 只能引用玩法层、运行期和表现层端口。
  - 禁止直接写 WorldState、计算碰撞/距离、读取隐藏 AI 状态或加载贴图 URL。
  - 为生命周期、结果评估和 `after:*` 事件保留稳定引用。
  - _要求：6.1-6.4，5.5_

- [ ]* 8.1 添加玩法文件边界属性测试
  - **属性 10：玩法文件不直接写规则事实**
  - 验证解析/执行只产生声明式端口调用。
  - _验证：要求 6.2、6.4_

- [ ] 9. 建立内容、地图和玩法包可追溯报告
  - 记录 contentId、kind、version、source、revision、checksum、loadPolicy、驻留状态和失败诊断。
  - 区分官方内容、UGC 内容、地图包、带地图玩法包、mock 和真实能力。
  - _要求：3.5，7.4_

- [ ] 10. 完成验证和交接
  - 执行类型检查、Vitest、lint、verify:docs 和相关 UGC/地图/装载集成测试。
  - 记录 environment blocker，不把历史结果当当前结果。
  - 输出 parent、edge weight、PrefabDef、表现层命令和多地图隔离的交接项。
  - _要求：4.8、5.1-5.5、7.3-7.4_

## 备注

1. 本 Spec 先于全面 UI 接线和表现层完整实现；它冻结术语与装载边界，不要求一次完成全部表现算法。
2. `CompiledPlaypack.playpackDef` 已是当前规则装载输入；运行期不得再次固定激活官方 ID。
3. `map?: MapDataDocument` 在迁移期间保留，直到 MapBundle 入口和地图玩法文件装载关系完成契约化。
4. 逻辑内容、视觉资产和运行期对象的驻留不能共用一个无区分缓存。
5. 不允许为了让测试通过而给未决字段补默认规则；未决内容必须返回诊断、pending 或交接项。
