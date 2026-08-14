# 实施计划：基类层 ECS 收敛

## 概述

为把既有基类层交付物（`src/l2/**`、`src/class/*/index.json`）收拢到 ECS 形状，通过「组件契约单一源 → 家族目录收敛 → 原子 System 接线 → vehicle 降级 → 守卫与验证」方法，实现结构收敛。实施将创建必要的组件，以执行收敛规则、验证目录并产出可回归的 PBT。

实现语言 TypeScript，测试库 fast-check（PBT 均 ≥100 次生成，带 `Feature: wakeup-base-layer-ecs, Property N` 注释）。收敛只改白名单目录（`src/l2/model/**`、`src/l2/validation/**`、`.kiro/specs/wakeup-base-layer-ecs/**`），不跨 Spec 改他人交付物。

## 任务

- [ ] 1. 设置项目结构和核心接口
- 创建 `src/l2/model/composition-registry.ts` 目录结构
- 定义 `ComponentContract`、`CompositionTemplate`、`CompositionRegistry` 核心接口
- 设置测试框架，包括单元测试和基于属性的测试
- _要求：1.1、1.2_

- [ ] 2. 实施 Composition_Registry
- [ ] 2.1 实施组件单源登记
   - 以 `component.*` 前缀集中登记组件
   - 实现组件去重：两个族声明相同可配置字段时提取共享组件
   - 实现组件解析与列出
   - _要求：1.2、2.2_

- [ ]* 2.2 编写组件契约单一源的属性测试
   - **属性 1：组件契约单一源**
   - **验证：要求 1.1、1.2**

- [ ] 2.3 实施跨族去重
   - 实现相同可配置字段的共享组件提取
   - 创建跨族去重报告
   - _要求：2.2_

- [ ]* 2.4 编写组件跨族去重的属性测试
   - **属性 4：组件跨族去重**
   - **验证：要求 2.2**

- [ ] 3. 实施 Canonical_Snapshot 确定性
- [ ] 3.1 实施快照确定性
   - 类 id、能力 id、组件 id 与模板 id 的顺序确定
   - 引用 `ordering.ts` 的规则获得不变快照
   - _要求：1.3、1.4_

- [ ]* 3.2 编写 Canonical_Snapshot 确定性的属性测试
   - **属性 2：Canonical_Snapshot 确定性**
   - **验证：要求 1.3、1.4**

- [ ] 3.3 实施转换失败原子性
   - 转换失败时归还最后有效的已激活状态
   - 返回含 CodeAndReason 的 Structured_Rejection
   - 检测依赖证据失效
   - _要求：1.5、1.6_

- [ ]* 3.4 编写转换失败原子性的属性测试
   - **属性 3：转换失败原子性**
   - **验证：要求 1.5、1.6**

- [ ] 4. 检查点 - 组件契约单一源与快照
- 确保 Composition_Registry 与快照确定性协同工作
- 使用目录样本进行测试
- 询问用户是否对收敛规则有疑问

- [ ] 5. 收敛家族目录为组件形状
- [ ] 5.1 收敛 action 家族
   - `action.` 族级组件形状
   - 保留动作契约字段指纹
   - _要求：7.1_

- [ ] 5.2 收敛 container 家族
   - 把 `space-items-contracts.ts` 的 `ContainerDomainContract` 收敛为组件形状
   - 沿用 D-059 等已确认裁决
   - _要求：7.2_

- [ ] 5.3 收敛 damage 家族
   - `damage.` 族级组件形状
   - 可能 `health` 组件承载项标明 `modified-explicit`
   - _要求：7.3_

- [ ] 5.4 收敛 movement 家族
   - `movement.` 族级组件形状
   - 可能由动作改写的承载项标明 `modified-explicit`
   - _要求：7.4_

- [ ] 5.5 收敛 status 家族
   - `status.` 族级组件形状
   - 对宿主状态的改写在组件声明中显式化
   - _要求：7.5_

- [ ] 5.6 收敛 attachment 家族
   - `attachment.` 族级组件形状
   - 集合组件标记为非语义壳
   - _要求：7.6_

- [ ] 5.7 收敛 skill 与 shield 家族
   - `skill.` 与 `shield.` 族级组件形状
   - 元素子类在 `valueSets` 中有 token 级差异化
   - _要求：7.7_

- [ ]* 5.8 编写元素子类差异化的属性测试
   - **属性 7：PSEUDO_SUBTYPE 差异化**
   - **验证：要求 7.7**

- [ ] 6. 实施原子 System 接线验证器
- [ ] 6.1 实施 kernelOps 接线校验
   - 校验 `kernelOps` 引用的字段名与 `parameters[*].key` 落在同一通路（闭合 CaS 缝隙）
   - 校验 `kernelOps` 引用的 Op 存在且被许可
   - _要求：3.2、3.3_

- [ ]* 6.2 编写 System 接线闭合的属性测试
   - **属性 5：System 接线闭合**
   - **验证：要求 3.2、3.3**

- [ ] 6.3 实施 compositionKind 四形校验
   - 取 `static`、`transient`、`modified-explicit`、`modified-capability` 四形之一
   - 否则返回 `COMPOSITION_KIND_*` 系 Structured_Rejection
   - _要求：5.1、5.2_

- [ ]* 6.4 编写 compositionKind 四形的属性测试
   - **属性 6：compositionKind 四形**
   - **验证：要求 5.1、5.2**

- [ ] 6.5 实施只读投影与写通道守则
   - 只读投影不写语义状态
   - 静态组件承载项只读投影可无障碍读取
   - 任何写入只经 L1 允许的写通道
   - _要求：4.1、4.2、4.3_

- [ ]* 6.6 编写只读投影不写语义状态的属性测试
   - **属性 8：只读投影不写语义状态**
   - **验证：要求 4.1、4.2**

- [ ] 7. 检查点 - System 接线与只读投影
- 确保接线验证器与目录协同工作
- 测试 compositionKind 与只读投影守则
- 询问用户是否对接线规则有疑问

- [ ] 8. 实施 vehicle 降级为组合型组件族
- [ ] 8.1 取消 vehicle.class.land 的 entity 基类资格
   - 取消 `defKind:"entity"` 与抽象基类资格
   - 改为「由哪些标准组件拼装」的组合模板含义
   - 保留 vehicle adjacency 与 door-target 两个独立组合输入（交互分离契约）
   - _要求：6.1、6.2、6.6_

- [ ] 8.2 让载具组件各自作为原语能力组件组合
   - 座位 `seat_binding`、货舱 cargo、驾驶 drive、碰撞 collision、损毁处置 destruction_sequence 等
   - 每个组件声明 `kernelOps` 与 `compositionKind`
   - _要求：6.3、6.4_

- [ ] 8.3 校验载具组合模板引用
   - 校验引用的每个组件 id 存在且属于允许的能力族
   - _要求：6.5_

- [ ]* 8.4 编写 vehicle 组合模板的属性测试
   - **属性 7：vehicle 组合模板**
   - **验证：要求 6.2、6.5**

- [ ] 9. 实施多轴正交与派生目录形状
- [ ] 9.1 实施多轴正交校验
   - 语义轴（继承与类型身份）与承载轴（组件字段与 System 参数位置）不正交时返回拒绝
   - 组件不依赖某特定 L3 payload 形状
   - 为某玩法特化所绑定的组件返回 `VALUE_L3_OWNERSHIP`
   - _要求：8.1、8.2、8.3_

- [ ]* 9.2 编写多轴正交的属性测试
   - **属性 9：多轴正交**
   - **验证：要求 8.1、8.2**

- [ ] 9.3 实施派生目录形状与归属
   - 派生目录拥有与既有目录相同的 `CLASS_ENTRY_KEYS` 与 `CAPABILITY_ENTRY_KEYS`
   - 组合模板表达为 `compositionContract.classIds` / `compositionContract.capabilityIds`
   - 玩法数值下沉到玩法层结构
   - 重叠 id 校验为同一语义，否则收回既有目录之前一个已激活状态
   - _要求：10.1、10.3、10.5_

- [ ]* 9.4 编写派生目录形状与归属的属性测试
   - **属性 10：派生目录形状与归属**
   - **验证：要求 10.1、10.2**

- [x] 10. 实施目录与诊断门禁
- [x] 10.1 遵守数值铁律与文档纪律守卫
   - 玩家可见数值局限于 1-5
   - 转换产物无废用复合词、无未登记诊断名
   - 与 Q-01/Q-04/Q-05 关联，不解决不裁决
   - _要求：9.1、9.2、9.3_

- [x] 10.2 登记来源追踪采纳状态
   - 本 spec 在 `SOURCE_TRACING_ADOPTION` 登记明确状态，与自动发现要求标题一致
   - 既有 `l2-base-layer-spec` 保持 `not-adopted`
   - _要求：9.4、9.5_

- [ ]* 10.3 编写文档纪律守卫回归测试
   - 验证转换产物无废用复合词、无未登记诊断名
   - _要求：9.2_

- [ ] 11. 集成和接线
- [ ] 11.1 将所有组件连接在一起
   - 连接 Composition_Registry → 族契约收敛 → System 接线验证器
   - 将 vehicle 组合模板与目录集成
   - 将只读投影与写通道路径集成
   - _要求：1.1-1.7、3.1-3.7、4.1-4.5、6.1-6.6_

- [ ]* 11.2 编写集成测试
   - 测试完整的收敛工作流程
   - 验证跨组件通信
   - 测试错误恢复场景
   - _要求：所有集成要求_

- [ ] 12. 最终检查点 - 完成系统验证
- 运行所有单元和属性测试（`npx tsc --noEmit`、`npx vitest run`、`npm run lint`）
- 验证目录与文档纪律守卫
- 确保实现满足所有要求
- 在收束前请用户进行最终批准

## 备注

- 标有 `*` 的任务是可选的，可以跳过可加速收敛（但 PBT 是完备性交付物的一部分，建议保留）
- 每项任务都引用了特定的可追溯性要求
- 检查点确保增量验证
- 属性测试验证通用正确性属性
- 单元测试验证特定示例和边缘情况
- 实现语言 TypeScript（已确定）
- 只改白名单目录（`src/l2/model/**`、`src/l2/validation/**`、`.kiro/specs/wakeup-base-layer-ecs/**`），不跨 Spec 改他人交付物
