/**
 * L2 Model: 家族目录收敛为组件形状（spec Task 5 / 任务3）。
 *
 * 对应 `.kiro/specs/wakeup-base-layer-ecs` design.md 四项结构动作之二：
 * 把家族目录（family-contracts.ts / space-items-contracts.ts）声明的
 * 8 个语义族的`可配置字段`收敛成 `component.<family>.<name>` 前缀的组件形状，
 * 并经 `CompositionShapeRegistry` 集中登记。
 *
 * 收敛原则（Requirements 7）：
 * - 组件 id 一律 `component.*` 前缀，是组件契约单一源的登记键；
 * - `parameters` 只声明形状接口（值由 L3/UGC 填），L2 不赋值；
 * - `kernelOps` 声明读写该组件的 System 接线（Op 名），与既有家族契约的
 *   op/机制引用对齐；
 * - `compositionKind` 按 Requirements 7.3–7.5 显式声明承载物被改写的方式：
 *   `static`（只描述形状）或 `modified-explicit`（明确列出被改写字段）。
 *
 * 本文件是 Task 3 的收敛产物（registry-only，本线不做目录重写 —— 目录重写
 * 属 H-ECS-05 交接项，由后续线执行）。
 */

import {
  CompositionRegistry,
  type ComponentContract,
  EMPTY_WRITE_CHANNEL_CONTRACT,
} from './composition-registry.js';
import { CompositionShapeRegistry, type FamilyShape } from './composition-shape.js';
import type { FieldName, OpId, SemanticFamilyId } from './ids.js';
import type { ParameterField } from './schema.js';

// ---------------------------------------------------------------------------
// 组件形状建造辅助
// ---------------------------------------------------------------------------

function parameter(
  name: FieldName,
  overrides: Partial<Omit<ParameterField, 'name'>> = {},
): ParameterField {
  return {
    name,
    dataType: 'string', // 值由 L3 填；本线只声明字段形状接口
    required: false,
    classification: 'Gameplay_Value',
    playerVisible: true,
    ...overrides,
  };
}

/** 单一原语组件：以字段名清单构造 `component.*` 形状。 */
function buildComponent(
  id: string,
  familyId: SemanticFamilyId,
  fieldNames: readonly FieldName[],
  kernelOps: readonly OpId[],
  compositionKind: ComponentContract['compositionKind'],
): ComponentContract {
  return {
    id,
    familyId,
    parameters: Object.freeze(fieldNames.map((name) => parameter(name))) as readonly ParameterField[],
    kernelOps: Object.freeze([...kernelOps]),
    compositionKind,
    writeChannelContract: EMPTY_WRITE_CHANNEL_CONTRACT,
    reason: '家族目录收敛为组件形状（spec Task 5）',
  };
}

/** 族形状：组件字段名与家族目录一致，保留既有指纹。 */
function shape(familyId: SemanticFamilyId, components: readonly ComponentContract[]): FamilyShape {
  return {
    familyId,
    components,
    shapeIds: Object.freeze([]) as readonly string[],
    preservesFingerprint: true, // 组件字段名与家族目录一致，保留既有指纹
    requiresShape: false,
  };
}

// ---------------------------------------------------------------------------
// 8 个语义族的组件形状（字段名与家族目录可配置字段一一对应，不新造词汇）
// ---------------------------------------------------------------------------

const FAMILY_SHAPES: readonly FamilyShape[] = Object.freeze([
  // action：apCost/目标/效果经 System 接线承载修正（Requirements 7.8）
  shape(
    'action',
    Object.freeze([
      buildComponent(
        'component.action.cost',
        'action',
        ['apCost', 'target', 'effects', 'actorRequirements', 'targetRequirements', 'interruptionConditionRefs'],
        ['agent.spendAp', 'op.dispatch', 'actor.require', 'target.require'],
        'modified-explicit',
      ),
    ]),
  ),

  // container：入/出舱经固定槽 Slot 承载（static 只描述插槽形状，Values 不内嵌）
  // 收敛 ContainerDomainContract（Requirements 7.2）：
  // - 可配置字段与 space-items-contracts.ts 契约一一对应，不新造词汇；
  // - concreteSlotCount / concreteCapacity 是违规检测面（越层声明证据），
  //   只是契约接口字段，不进入组件 `parameters`（值由 L3/UGC 填，L2 不声明）；
  // - D-059 死亡容器义务：depositDisabledMechanismRef 是**可替换的机制引用**
  //   （非字面量 `before-item-move-veto`），depositMarkTiming 恒为
  //   `'after-infusion-commit'`，contentSource 恒为 `'deceased-entity-transaction'`。
  shape(
    'container',
    Object.freeze([
      buildComponent(
        'component.container.deposit',
        'container',
        ['hostType', 'containerRole', 'slotAcceptancePredicateRef', 'accessibilityCapabilityRefs', 'depositAllowedField', 'withdrawAllowedField', 'transferActionRef'],
        ['container.deposit', 'container.withdraw', 'agent.bind', 'agent.unbind'],
        'static',
      ),
      buildComponent(
        'component.container.deathObligation',
        'container',
        ['depositDisabledMechanismRef', 'depositMarkTiming', 'contentSource'],
        ['item.move', 'stack.merge'],
        'static',
      ),
    ]),
  ),

  // damage：结算数量经 System 改写，基类层不内嵌伤害取值（Requirements 7.3）
  shape(
    'damage',
    Object.freeze([
      buildComponent(
        'component.damage.delivery',
        'damage',
        ['damageCategory', 'sourceRequirements', 'targetRequirements', 'settlementPipelineRefs', 'amount', 'spectrum', 'resolutionPolicy'],
        ['prop.add', 'prop.set', 'settlement.resolve'],
        'modified-explicit',
      ),
    ]),
  ),

  // movement：跨越承载项（action-rewritten）逐字段显式改写（Requirements 7.4）
  shape(
    'movement',
    Object.freeze([
      buildComponent(
        'component.movement.traversal',
        'movement',
        ['traversal', 'costField', 'speedField', 'rangeField', 'terrainModifierField', 'collisionEffectRefs'],
        ['agent.move', 'agent.teleport', 'agent.bind', 'agent.unbind'],
        'modified-explicit',
      ),
    ]),
  ),

  // status：host-state 逐字段显式改写（Requirements 7.5）
  shape(
    'status',
    Object.freeze([
      buildComponent(
        'component.status.hostState',
        'status',
        ['durationMode', 'stackMode', 'triggerRefs', 'interruptionRefs', 'effectRefs', 'interactions'],
        ['status.apply', 'status.refresh', 'status.stack', 'status.expire'],
        'modified-explicit',
      ),
    ]),
  ),

  // attachment：宿主挂接经 attach.* 接线改写（Requirements 7.6）
  shape(
    'attachment',
    Object.freeze([
      buildComponent(
        'component.attachment.host',
        'attachment',
        ['hostType', 'sourceType', 'durationMode', 'stackBehavior', 'grantedRuleRefs', 'cleanupBehavior'],
        ['attach.add', 'attach.detach', 'attach.deplete'],
        'modified-explicit',
      ),
    ]),
  ),

  // skill：激活/触发/冷却经 System 接线承载（static：只描述激活形状）
  shape(
    'skill',
    Object.freeze([
      buildComponent(
        'component.skill.activation',
        'skill',
        ['activation', 'costFields', 'cooldownFields', 'triggerConditionRefs', 'effectRefs'],
        ['skill.activate', 'skill.trigger', 'skill.cooldown'],
        'static',
      ),
    ]),
  ),

  // shield：持盾/格挡/碎裂经 System 接线承载（static：只描述持盾形状）
  shape(
    'shield',
    Object.freeze([
      buildComponent(
        'component.shield.holding',
        'shield',
        ['holdingRequirementRefs', 'blockingActionRef', 'depletionRuleRefs', 'breakConditionRefs'],
        ['shield.hold', 'shield.block', 'shield.break'],
        'static',
      ),
    ]),
  ),
]);

// ---------------------------------------------------------------------------
// 集中登记与导出
// ---------------------------------------------------------------------------

/**
 * 八个语义族的组件形状在一张 registry / shapeRegistry 上集中登记。
 * 两个 registry 独立（组件契约单一源与族形状索引分离），但由本模块统一装配。
 */
export const COMPOSITION_REGISTRY: CompositionRegistry = new CompositionRegistry();
const shapeRegistry = new CompositionShapeRegistry();

// 各语义族在类目录 `compositionContract.playLayerOwnedFieldNames` 中声明的玩法层归属字段名
// （T-CaS-04 单一源登记；与 src/class/{action,attachment,container,movement,skill,status}/index.json 逐项一致）。
const FAMILY_PLAY_LAYER_OWNED_FIELD_NAMES: Readonly<Record<SemanticFamilyId, readonly string[]>> = {
  action: ['apCost', 'target', 'effects', 'kernelOp', 'kernelOps'],
  attachment: ['duration', 'durationUnit', 'stacking', 'stackBehavior', 'priority'],
  container: ['capacity', 'accessibleApCost', 'unlockConditions', 'volume'],
  movement: ['cost', 'speed', 'range', 'terrainModifier', 'collisionEffect', 'apCost'],
  skill: ['cost', 'cooldownTurns', 'duration', 'amount'],
  status: ['duration', 'durationUnit', 'stacking', 'stackBehavior', 'priority', 'effects', 'breakConditions', 'interactionMatrix', 'icon', 'color'],
  shield: [],
  damage: [],
};

for (const familyShape of FAMILY_SHAPES) {
  for (const component of familyShape.components) {
    COMPOSITION_REGISTRY.registerComponent(component);
  }
  shapeRegistry.register(familyShape);
  // T-CaS-04：族级归属字段名登记进 CompositionShape 单一源（按族一次）。
  COMPOSITION_REGISTRY.registerShape({
    id: `compositionShape.${familyShape.familyId}`,
    classIds: familyShape.components.map((component) => component.id),
    capabilityIds: familyShape.components.map((component) => component.id),
    compositionKind: familyShape.components[0]?.compositionKind ?? 'static',
    playLayerOwnedFieldNames: Object.freeze([...FAMILY_PLAY_LAYER_OWNED_FIELD_NAMES[familyShape.familyId] ?? []]),
    familyId: familyShape.familyId,
  });
}

/** 全部 8 族组件形状，集中导出供下游消费。 */
export const ALL_FAMILY_SHAPES: readonly FamilyShape[] = Object.freeze([...FAMILY_SHAPES]);

/** 解析某族组件形状，`familyId` 未登记时返回 null。 */
export function resolveFamilyComponentShape(familyId: SemanticFamilyId): FamilyShape | null {
  return shapeRegistry.resolveFamilyShape(familyId);
}

/**
 * 族形状索引（familyId → FamilyShape）的确定性快照。
 *
 * 供 class-contract 的 ECS 对齐校验器一次性取全（T-CaS-01）：避免对每条能力重复做
 * O(n) 线性查找，同时保持输出语义与 `resolveFamilyComponentShape` 完全一致。
 */
export function compileFamilyComponentShapeIndex(): ReadonlyMap<SemanticFamilyId, FamilyShape> {
  return new Map(FAMILY_SHAPES.map((shape) => [shape.familyId, shape]));
}
