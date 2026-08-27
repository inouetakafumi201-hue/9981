/**
 * 基类层 · 空间与物品领域：未决目录 `U-SPACE-001` ~ `U-SPACE-007`。
 *
 * 对应要求 13.1–13.9、14.5 与 design.md「未决边界」。
 *
 * ## 冻结状态按现行 requirements.md 分级（不是"七项全未决"）
 *
 * design.md 的顶部横幅与要求 13 现行文本已同步为**部分冻结**：
 * - `U-SPACE-002` 掩体：**结构已由 D-040 冻结并应当实现**（二维正交模型），仅**数值**随 T-001 未决；
 * - `U-SPACE-005` 载具内部：**载具不建模为微型场景已由 D-038 关闭**，仅"车内外互相攻击判定"未决；
 * - `U-SPACE-007` 丢弃物品依附时机：**已由 D-042 关闭**（零费菜单），不再有可默认化的面。
 *
 * 因此 `forbiddenSurfaces` 按各项**实际仍未冻结的部分**收窄。把已冻结部分继续当作"未决"拒绝，
 * 会违反要求 14.5 最后一句（不得再以"未冻结"为由拒绝引用已关闭部分的配置）。
 *
 * 目录恒为七项：编号是稳定的追踪标识，关闭的项保留在册以便溯源，只是禁止面为空。
 */

import type { DecisionId, HumanReadableText, JsonPath } from './ids';
import type { SourceRecord } from './source';
import type { ErrCode } from '../../core/kernel/state/error-codes';
import type {
  DomainDiagnosticCategory,
  UnresolvedItemId,
} from './space-items-diagnostic-categories';
import { codeOf } from './space-items-diagnostic-categories';
import { compareStrings } from './ordering';
import { deepFreeze } from './immutable';

export type { UnresolvedItemId } from './space-items-diagnostic-categories';

/** 未决项的冻结状态（要求 13、14.5）。 */
export const UNRESOLVED_FREEZE_STATUSES = Object.freeze([
  'fully-unresolved',
  'structure-frozen-numeric-unresolved',
  'partially-frozen',
  'closed',
] as const);

export type UnresolvedFreezeStatus = (typeof UNRESOLVED_FREEZE_STATUSES)[number];

/** 未决目录条目。 */
export interface UnresolvedItemRecord {
  readonly id: UnresolvedItemId;
  readonly freezeStatus: UnresolvedFreezeStatus;
  /** 上游追踪编号：T-001 / T-002 / D-017 / D-018 / Q-01 … Q-05。 */
  readonly upstreamIds: readonly DecisionId[];
  /** 已把该项部分或全部关闭的控制决策编号。 */
  readonly closingDecisionIds: readonly DecisionId[];
  readonly unresolvedContent: HumanReadableText;
  /** 已冻结、应当实现且不得再以"未冻结"为由拒绝的部分。 */
  readonly frozenContent?: HumanReadableText;
  readonly retainedInterface: HumanReadableText;
  /** 出现即拒绝的字段面（相对定义根的 JSON 路径片段）。 */
  readonly forbiddenSurfaces: readonly JsonPath[];
  readonly rejectionCategory: DomainDiagnosticCategory;
  readonly rejectionCode: ErrCode;
  readonly sourceRecords: readonly SourceRecord[];
}

const CONSTITUTION_FILE = 'docs/L0_规范宪法.md';
const DECISION_FILE = 'docs/访谈决策记录.md';
const REVIEW_FILE = 'docs/审查状态综合报告.md';

function unresolvedSource(section: string, decisionId: DecisionId, fingerprint: string): SourceRecord {
  return Object.freeze({
    sourceFile: CONSTITUTION_FILE,
    sourceLocation: { sourceFile: CONSTITUTION_FILE, section },
    precedence: 'unresolved-l2-content',
    decisionId,
    classification: 'Unresolved_Item',
    owningLayer: '基类层',
    statementFingerprint: fingerprint,
  });
}

function decisionSource(section: string, decisionId: DecisionId, fingerprint: string): SourceRecord {
  return Object.freeze({
    sourceFile: DECISION_FILE,
    sourceLocation: { sourceFile: DECISION_FILE, section },
    precedence: 'confirmed-interview-decision',
    decisionId,
    classification: 'Normative_Contract',
    owningLayer: '基类层',
    statementFingerprint: fingerprint,
  });
}

function reviewSource(section: string, decisionId: DecisionId, fingerprint: string): SourceRecord {
  return Object.freeze({
    sourceFile: REVIEW_FILE,
    sourceLocation: { sourceFile: REVIEW_FILE, section },
    precedence: 'unresolved-l2-content',
    decisionId,
    classification: 'Unresolved_Item',
    owningLayer: '基类层',
    statementFingerprint: fingerprint,
  });
}

function record(entry: UnresolvedItemRecord): UnresolvedItemRecord {
  return deepFreeze({
    ...entry,
    upstreamIds: entry.upstreamIds.slice(),
    closingDecisionIds: entry.closingDecisionIds.slice(),
    forbiddenSurfaces: [...entry.forbiddenSurfaces].sort(compareStrings),
    sourceRecords: entry.sourceRecords.slice(),
  }) as UnresolvedItemRecord;
}

const U001: UnresolvedItemRecord = record({
  id: 'U-SPACE-001',
  freezeStatus: 'fully-unresolved',
  upstreamIds: ['T-001', 'D-018', 'Q-03'],
  closingDecisionIds: [],
  unresolvedContent: '枪械基础伤害表及其与 AP 经济学的平衡验证。',
  retainedInterface:
    '只保留武器组合角色的 damage-reference 与伤害契约的 damageTypeRef / settlementPipelineRefs；' +
    '基础伤害、默认伤害、替代伤害、平衡结论与推断规则一律不提供。',
  forbiddenSurfaces: [
    '/domainContract/baseDamageTable',
    '/domainContract/concreteDamageValue',
    '/domainContract/concreteHitThreshold',
    '/domainContract/amount',
    '/domainContract/critIncrement',
    '/domainContract/damageTable',
  ],
  rejectionCategory: 'UNRESOLVED_ITEM_DEFAULTING',
  rejectionCode: codeOf('UNRESOLVED_ITEM_DEFAULTING', 'default-value'),
  sourceRecords: [
    unresolvedSource('七、待访谈确认事项 / Q-03', 'Q-03', 'l0:q-03:firearm-damage-table-ap-balance'),
    reviewSource('T-001 枪械伤害与 AP 经济学', 'T-001', 'review:t-001:firearm-damage-unresolved'),
  ],
});

const U002: UnresolvedItemRecord = record({
  id: 'U-SPACE-002',
  freezeStatus: 'structure-frozen-numeric-unresolved',
  upstreamIds: ['T-002', 'D-017'],
  closingDecisionIds: ['D-040', 'D-038'],
  unresolvedContent: '掩体的减伤量与命中修正的具体数值（随 T-001 处理）。',
  frozenContent:
    '掩体的二维正交模型已由 D-040 冻结并应当实现：按作用对象分「对玩家生效 / 对场景生效」，' +
    '按赋予者分「实体赋予 / 场景固有」，四象限均合法。载具半掩体（D-038）属「实体赋予 + 对玩家生效」' +
    '象限：乘员受益、站在车旁者不受益、载具摧毁则撤销所有乘员的该状态。',
  retainedInterface:
    '保留掩体象限声明面（作用对象 × 赋予者）与状态撤销引用；不暴露任何减伤量或命中修正字段。',
  forbiddenSurfaces: [
    '/domainContract/coverMitigationValue',
    '/domainContract/coverHitModifier',
    '/domainContract/concealmentModifier',
    '/domainContract/rangedDamagePenalty',
  ],
  rejectionCategory: 'UNRESOLVED_ITEM_DEFAULTING',
  rejectionCode: codeOf('UNRESOLVED_ITEM_DEFAULTING', 'default-value'),
  sourceRecords: [
    decisionSource('D-040 掩体二维正交模型', 'D-040', 'decision:d-040:cover-two-axis-orthogonal-model'),
    reviewSource('T-002 掩体机制', 'T-002', 'review:t-002:cover-numeric-unresolved'),
  ],
});

const U003: UnresolvedItemRecord = record({
  id: 'U-SPACE-003',
  freezeStatus: 'fully-unresolved',
  upstreamIds: ['Q-01'],
  closingDecisionIds: [],
  unresolvedContent: '武器谱型「特殊」档的机制框架。',
  retainedInterface:
    '只保留 profileTierRef 这一可扩展引用与谱型契约的 spectrumClassRef；' +
    '不得用任一既有 spectrum-class.* 充当「特殊」档，也不得内嵌该档机制。',
  forbiddenSurfaces: ['/domainContract/specialTierMechanism'],
  rejectionCategory: 'UNRESOLVED_ITEM_DEFAULTING',
  rejectionCode: codeOf('UNRESOLVED_ITEM_DEFAULTING', 'default-flow'),
  sourceRecords: [
    unresolvedSource('七、待访谈确认事项 / Q-01', 'Q-01', 'l0:q-01:weapon-profile-special-tier'),
  ],
});

const U004: UnresolvedItemRecord = record({
  id: 'U-SPACE-004',
  freezeStatus: 'fully-unresolved',
  upstreamIds: ['Q-02', 'D-014'],
  closingDecisionIds: [],
  unresolvedContent: '远程武器多阶段流程与枪械流程的跨文档精确对齐。',
  retainedInterface:
    '只暴露组合角色 action-sequence 与过渡契约的 paidActionSequence / intermediateStatusRefs；' +
    '阶段数、反应窗口与命中逻辑一律由玩法层配置，本领域不写默认值。',
  forbiddenSurfaces: [
    '/domainContract/defaultPhaseCount',
    '/domainContract/defaultReactionWindow',
    '/domainContract/defaultHitLogic',
  ],
  rejectionCategory: 'UNRESOLVED_ITEM_DEFAULTING',
  rejectionCode: codeOf('UNRESOLVED_ITEM_DEFAULTING', 'default-flow'),
  sourceRecords: [
    unresolvedSource('七、待访谈确认事项 / Q-02', 'Q-02', 'l0:q-02:ranged-two-step-versus-firearm-one-step'),
  ],
});

const U005: UnresolvedItemRecord = record({
  id: 'U-SPACE-005',
  freezeStatus: 'partially-frozen',
  upstreamIds: ['Q-04'],
  closingDecisionIds: ['D-038', 'D-030'],
  unresolvedContent: '车内外**互相攻击**的判定细则（D-038 第 6 条保留为独立实现逻辑）。',
  frozenContent:
    '载具是实体，乘员处于「在实体内」的状态，载具内部**不建模为微型场景**（D-038）——该歧义已关闭。' +
    '交互范围按 D-030：站在车辆旁边即可对车内任意乘员发起交互，不区分具体哪扇门；' +
    '两个门索引仅在「针对性破坏车门」等场景下有区分意义。',
  retainedInterface:
    '保留座位、货舱、门寻址、邻接判定与门特定目标五个独立组合面；不推断车内外互攻判定。',
  forbiddenSurfaces: ['/domainContract/interiorExteriorAttackRule'],
  rejectionCategory: 'UNRESOLVED_ITEM_DEFAULTING',
  rejectionCode: codeOf('UNRESOLVED_ITEM_DEFAULTING', 'default-flow'),
  sourceRecords: [
    decisionSource('D-038 载具是实体 / 半掩体授予玩家', 'D-038', 'decision:d-038:vehicle-is-entity-not-micro-scene'),
    unresolvedSource('七、待访谈确认事项 / Q-04', 'Q-04', 'l0:q-04:vehicle-interior-micro-scene-boundary'),
  ],
});

const U006: UnresolvedItemRecord = record({
  id: 'U-SPACE-006',
  freezeStatus: 'fully-unresolved',
  upstreamIds: ['Q-05', 'D-015'],
  closingDecisionIds: [],
  unresolvedContent: '盾牌 MVP 标配范围（扔盾 / 盾击等特殊互动是否保留）。',
  retainedInterface:
    '只保留持有要求、格挡动作、损耗规则、破损条件与**可选**互动能力引用；' +
    '不设定任何可选互动的默认可用性。',
  forbiddenSurfaces: [
    '/domainContract/mvpDefaultInteractionIds',
    '/domainContract/defaultEnabledInteractionIds',
  ],
  rejectionCategory: 'UNRESOLVED_ITEM_DEFAULTING',
  rejectionCode: codeOf('UNRESOLVED_ITEM_DEFAULTING', 'default-availability'),
  sourceRecords: [
    unresolvedSource('七、待访谈确认事项 / Q-05', 'Q-05', 'l0:q-05:shield-mvp-standard-scope'),
  ],
});

const U007: UnresolvedItemRecord = record({
  id: 'U-SPACE-007',
  freezeStatus: 'closed',
  upstreamIds: [],
  closingDecisionIds: ['D-042'],
  unresolvedContent: '（已关闭）不再有未决内容。',
  frozenContent:
    '丢弃物品等零费动作归入**零费菜单**（D-042）：正常情况下显示有费用的菜单并提供切换按钮切到零费菜单；' +
    '所有行动结束后只保留零费菜单 + 结束回合按键（该按键直接进入 3 秒倒计时）。' +
    '铁律「0 AP 动作不得与 1 AP 动作同处一个菜单」仍然成立，但零费动作**不限于回合末执行**。' +
    '此前"部分附赠限次"的设想不再采用。',
  retainedInterface:
    '保留「依附动作必须绑定付费动作宿主」这一接口约束；零费菜单归属已冻结，可被玩法层配置直接引用，' +
    '不得再以"未冻结"为由拒绝。',
  forbiddenSurfaces: [],
  rejectionCategory: 'UNRESOLVED_ITEM_DEFAULTING',
  rejectionCode: codeOf('UNRESOLVED_ITEM_DEFAULTING', 'default-action'),
  sourceRecords: [
    decisionSource('D-042 零费菜单常驻', 'D-042', 'decision:d-042:zero-cost-menu-always-available'),
  ],
});

/** 未决目录：恒为七项，按编号规范化排序。 */
export const UNRESOLVED_ITEM_CATALOG: readonly UnresolvedItemRecord[] = Object.freeze(
  [U001, U002, U003, U004, U005, U006, U007].sort((left, right) =>
    compareStrings(left.id, right.id),
  ),
);

export function findUnresolvedItem(id: UnresolvedItemId): UnresolvedItemRecord | undefined {
  return UNRESOLVED_ITEM_CATALOG.find((item) => item.id === id);
}

export function forbiddenSurfacesOf(id: UnresolvedItemId): readonly JsonPath[] {
  return findUnresolvedItem(id)?.forbiddenSurfaces ?? Object.freeze([]);
}

/** 全部禁止面（去重、排序），供门禁与集成契约机械枚举。 */
export function allForbiddenSurfaces(): readonly JsonPath[] {
  const surfaces = new Set<JsonPath>();
  for (const item of UNRESOLVED_ITEM_CATALOG) {
    for (const surface of item.forbiddenSurfaces) {
      surfaces.add(surface);
    }
  }
  return Object.freeze([...surfaces].sort(compareStrings));
}

/** 仍有未决部分的项（`closed` 之外的全部）。 */
export function stillUnresolvedItems(): readonly UnresolvedItemRecord[] {
  return Object.freeze(UNRESOLVED_ITEM_CATALOG.filter((item) => item.freezeStatus !== 'closed'));
}

/** 已冻结、必须可被引用而不得拒绝的部分（要求 14.5）。 */
export function frozenPortions(): readonly UnresolvedItemRecord[] {
  return Object.freeze(UNRESOLVED_ITEM_CATALOG.filter((item) => item.frozenContent !== undefined));
}
