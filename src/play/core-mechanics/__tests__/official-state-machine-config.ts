/**
 * 官方测试配置：M10 完整状态机靶的装载合法 config（BATCH M10 交付物）。
 *
 * 作用：给 `loadCoreMechanics` 一份"已冻结、装载合法"的配置，把 7.3 交接项里
 * `defaultCoreMechanicsConfig()` 的 false 兜底（enableRandomRoll:false + hookWiringAccepted:false
 * + damageAmountSources 缺省）全部翻正，使五阶段回合循环能真实推进、攻击/睡下/起床/站起动作
 * 能在真实 queryActions + effects + Hook 链路上执行。
 *
 * 冻结依据（这些项此前是 7.3.1/7.3.2 的"结构性阻塞"，现已裁决为可提供引用）：
 * - U-001 投点策略：enableRandomRoll:true + baseTierPolicyRef/boostBoundaryPolicyRef 齐备，则
 *   `validateConfigUnresolvedRefs` 不再报 E_LOAD_UNRESOLVED_CONTRACT，`collectBlockedCapabilities`
 *   不登记 standard-random-roll / power-die-settlement，roll 阶段 onEnter 的 U-001 守卫放行。
 * - D-037 AP 档位、D-040 掩体结构、D-055 过载结构均已冻结；仅 T-001/T-002 数值部分待定。
 * - hookWiringAccepted:true：Requirement 2.8 门禁放行（本靶确实构造了真实 Hook 链路）。
 * - damageAmountSources: 指向一个"玩家可见伤害数值"的已冻结来源 ref。该 ref 由装载入口
 *   `prop.set` 写到 `world.props.play.damageAmountRef`，`attackAction` 首条守卫
 *   `notNull(pathOf(PATH_DAMAGE_AMOUNT_REF))` 据此放行（否则攻击在写入前被拒）。
 *
 * 状态机语义（M10）都由 `core-mechanics` 的既有定义承载，本文件只提供"能让它们真正跑起来"的
 * 合法输入，不新增任何 state 语义、不复制任何判断：
 * - 睡下→起床：`sleepDownAction` 加 ATT_SLEEPING 中间状态，`wakeUpAction` 删除并回满体力。
 * - 过载剔除：`status_overloaded`（基类层语义）承载；本包不为其登记第二套判断。
 * - 倒地→站起：`damageDefaultRule` 在零血时 prop.del vitality + attach.add ATT_DOWNED_ZERO，
 *   `standUpAction` 走 ATT_KNOCKED_DOWN 的普通倒地路径（M10 要求"倒地→站起"发生在玩家可见尺度）。
 */
import { defaultCoreMechanicsConfig, type CoreMechanicsConfig } from '../load';
import { STAMINA_MAX } from '../defs/ids';

/** 攻击伤害数值的"已冻结"来源 ref（由装载/测试预置到 world.props.play.damageAmountRef）。
 *  这是测试靶声明的开发期值，不混入玩法层基类默认伤害表（T-001 未冻结的只有那张表本身）。 */
export const FIXED_DAMAGE_AMOUNT_REF = 'd:damage-amount.real';

/** 基础等级生成策略 ref（U-001 冻结标记；指向一个装载期内可解析的已审批策略）。 */
export const BASE_TIER_POLICY_REF = 'd:base-tier.policy';
/** 修正后边界策略 ref。 */
export const BOOST_BOUNDARY_POLICY_REF = 'd:boost-boundary.policy';

/**
 * 官方测试配置：投点开放 + Hook 门禁放行 + （攻击伤害源由装载后注入）。
 *
 * 这是唯一能让五阶段状态机真实跑通的 config 基准；其余字段沿用 default 的合法值
 * （overload 结构、npcBudget:null、无网关、无外部恢复来源）。
 *
 * 伤害数值的诚实处理（T-001 冻结契约的边界，已在交接与文档登记）：
 * 攻击动作的首条守卫读 `PATH_DAMAGE_AMOUNT_REF`（`world.props.play.damageAmountRef`），装载后
 * 由 `state-machine-load-driver.ts` 用一次 `prop.set` 写入一个**已裁决的测试伤害值**
 * （ATTACK_DAMAGE_VALUE）。这里的职责与"T-001 那张待定枪械基础伤害表"不同：本靶注入的是开发期
 * 测试值，不是把未冻结数值当作默认暴露。因此 `damageAmountSources` 保持**空数组**（非 null 的
 * amountRef 会被 `validateConfigUnresolvedRefs` 以 E_LOAD_UNRESOLVED_CONTRACT 整体拒绝，见
 * `ownership.ts:719`），攻击数值最终从装载后的 `world.props.play.damageAmountRef` 读取。
 */
export function officialCoreMechanicsConfig(): CoreMechanicsConfig {
  return {
    ...defaultCoreMechanicsConfig(),
    // U-001：打开随机投点并引用已审批的双策略 → roll 阶段守卫放行（否则标准回合从投点整体阻塞）。
    rollPolicy: {
      enableRandomRoll: true,
      baseTierPolicyRef: BASE_TIER_POLICY_REF,
      boostBoundaryPolicyRef: BOOST_BOUNDARY_POLICY_REF,
    },
    // D-037 / D-055：AP 档位与过载结构已冻结，rollPolicyReady 为 true 即走真实分配。
    // Requirement 2.8：真实 Hook 链路已接线，放行 end-to-end 门禁。
    hookWiringAccepted: true,
    // damageAmountSources 保持为空数组——见上方诚实处理说明。
  } satisfies CoreMechanicsConfig;
}

/** 攻击一次对敌方造成的固定伤害量（Internal_Metric 测试常量，落在 1-5 内的伤害刻度）。 */
export const ATTACK_DAMAGE_VALUE = 1;

/** 清理阶段每回合自然恢复的体力，与 `schedule.ts` 的 NATURAL_STAMINA_RECOVERY 对齐。 */
export const NATURAL_STAMINA_RECOVERY = 1;

/** 体力上限（与 `ids.ts` STAMINA_MAX 对齐；起床回满即回到此值）。 */
export const STAMINA_FULL = STAMINA_MAX;
