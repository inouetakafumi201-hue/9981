/**
 * L2 Compiler: 固定决策地位目录与未决事项目录。
 *
 * 这些地位由 requirements.md 直接规定（1.8–1.13、9.11–9.12、16.6）与 L0「七、待访谈确认事项」，
 * 不是本实现的推断。分类器用它们校验来源自称的分类，冲突时以本目录为准并产生
 * `SOURCE_CLASSIFICATION_MISMATCH` 诊断。
 *
 * 同一决策编号可以有多个条目（D-009、D-010 在 L0 与访谈记录中含义不同）。
 * 目录以 (decisionId, sourceFile) 为键区分变体，**绝不按编号合并**（Requirements 1.10–1.12）。
 */

import type { DecisionId, SourceFileId } from '../model/ids';
import type {
  OwningLayer,
  SourceClassificationKind,
  SourcePrecedence,
} from '../model/source';

export const L0_FILE: SourceFileId = 'docs/L0_规范宪法.md';
export const INTERVIEW_FILE: SourceFileId = 'docs/访谈决策记录.md';
export const GLOSSARY_FILE: SourceFileId = 'docs/_术语表与废案清单.md';

/** 一条固定决策地位。 */
export interface DecisionStatusEntry {
  readonly decisionId: DecisionId;
  /** 同一编号下的变体键：用于区分 L0 条目与访谈记录条目。 */
  readonly variantKey: string;
  readonly sourceFile: SourceFileId;
  readonly section: string;
  readonly precedence: SourcePrecedence;
  readonly classification: SourceClassificationKind;
  readonly owningLayer: OwningLayer;
  readonly summary: string;
  /** 需求条款编号，便于诊断回溯。 */
  readonly requirementRefs: readonly string[];
}

export const DECISION_STATUS_CATALOG: readonly DecisionStatusEntry[] = Object.freeze([
  {
    decisionId: 'D-006',
    variantKey: 'D-006@three-gateways',
    sourceFile: INTERVIEW_FILE,
    section: 'D-006 三种网关',
    precedence: 'confirmed-interview-decision',
    classification: 'Normative_Contract',
    owningLayer: '基类层',
    summary: '资源转换网关、检定网关、条件网关三类契约属于基类层规范契约。',
    requirementRefs: ['1.8', '6.5'],
  },
  {
    decisionId: 'D-019',
    variantKey: 'D-019@declarative-json',
    sourceFile: INTERVIEW_FILE,
    section: 'D-019 纯声明式 JSON',
    precedence: 'confirmed-interview-decision',
    classification: 'Normative_Contract',
    owningLayer: '基类层',
    summary: '基类定义使用纯声明式 JSON，禁止可执行代码与命令式构造。',
    requirementRefs: ['1.8', '11.1'],
  },
  {
    decisionId: 'D-007',
    variantKey: 'D-007@stamina-limit',
    sourceFile: INTERVIEW_FILE,
    section: 'D-007 体力上限',
    precedence: 'confirmed-interview-decision',
    classification: 'L3_Profile',
    owningLayer: '玩法层',
    summary: '具体体力上限是标准大逃杀玩法规则；基类层只提供参数接口。',
    requirementRefs: ['1.9', '5.9'],
  },
  {
    decisionId: 'D-008',
    variantKey: 'D-008@tie-order',
    sourceFile: INTERVIEW_FILE,
    section: 'D-008 同分随机顺序',
    precedence: 'confirmed-interview-decision',
    classification: 'L3_Profile',
    owningLayer: '玩法层',
    summary: '同分顺序行为是玩法层 schedule-policy 选择；基类层只暴露 policy Schema。',
    requirementRefs: ['1.9', '5.10'],
  },
  {
    decisionId: 'D-009',
    variantKey: 'D-009@l0-terminology',
    sourceFile: L0_FILE,
    section: '决策索引 D-009（锁定术语）',
    precedence: 'l0-constitution',
    classification: 'Normative_Contract',
    owningLayer: '基类层',
    summary: 'L0 的 D-009 是锁定术语条目，按基类层规范契约处理。',
    requirementRefs: ['1.10'],
  },
  {
    decisionId: 'D-009',
    variantKey: 'D-009@interview-blocking-hiding',
    sourceFile: INTERVIEW_FILE,
    section: 'D-009（格挡 / 隐蔽规则）',
    precedence: 'confirmed-interview-decision',
    classification: 'L3_Profile',
    owningLayer: '玩法层',
    summary: '访谈记录的 D-009 是格挡与隐蔽玩法规则，归玩法层，不是基类层默认。',
    requirementRefs: ['1.10', '9.11'],
  },
  {
    decisionId: 'D-010',
    variantKey: 'D-010@l0-composition',
    sourceFile: L0_FILE,
    section: '决策索引 D-010（组合原则）',
    precedence: 'l0-constitution',
    classification: 'Normative_Contract',
    owningLayer: '基类层',
    summary: 'L0 的 D-010 是组合原则条目，按基类层规范契约处理。',
    requirementRefs: ['1.11'],
  },
  {
    decisionId: 'D-010',
    variantKey: 'D-010@interview-optional-combat',
    sourceFile: INTERVIEW_FILE,
    section: 'D-010（格斗系统可选范围）',
    precedence: 'confirmed-interview-decision',
    classification: 'L3_Profile',
    owningLayer: '玩法层',
    summary: '访谈记录的 D-010 是格斗系统可选内容，属可选玩法层内容，不是基类层核心契约。',
    requirementRefs: ['1.11', '9.12'],
  },
  {
    decisionId: 'D-017',
    variantKey: 'D-017@cover-rule-details',
    sourceFile: INTERVIEW_FILE,
    section: 'D-017 掩体规则细节',
    precedence: 'unresolved-l2-content',
    classification: 'Unresolved_Item',
    owningLayer: '玩法层',
    summary: '掩体规则细节尚未裁决，保留为未决项。',
    requirementRefs: ['16.6'],
  },
  {
    decisionId: 'D-018',
    variantKey: 'D-018@firearm-base-damage',
    sourceFile: INTERVIEW_FILE,
    section: 'D-018 枪械基础伤害值',
    precedence: 'unresolved-l2-content',
    classification: 'Unresolved_Item',
    owningLayer: '玩法层',
    summary: '枪械基础伤害值尚未裁决，保留为未决项。',
    requirementRefs: ['16.6'],
  },
  {
    decisionId: 'D-030',
    variantKey: 'D-030@vehicle-passenger-interaction',
    sourceFile: INTERVIEW_FILE,
    section: 'D-030 载具乘员交互',
    precedence: 'confirmed-interview-decision',
    classification: 'L3_Profile',
    owningLayer: '玩法层',
    summary: '载具乘员交互是具体玩法规则；基类层只定义车辆邻接、门索引与乘员引用接口。',
    requirementRefs: ['1.13', '8.10'],
  },
] as const satisfies readonly DecisionStatusEntry[]);

/** 未决事项目录（L0「七、待访谈确认事项」）。 */
export interface UnresolvedQuestionEntry {
  readonly decisionId: DecisionId;
  readonly sourceFile: SourceFileId;
  readonly section: string;
  readonly summary: string;
  /** 设计中允许保留的接口面 —— 只保留引用与 Schema，不推导机制。 */
  readonly retainedInterface: string;
}

export const UNRESOLVED_QUESTION_CATALOG: readonly UnresolvedQuestionEntry[] = Object.freeze([
  {
    decisionId: 'Q-01',
    sourceFile: L0_FILE,
    section: '七、待访谈确认事项 Q-01',
    summary: '武器谱型中"特殊"档的机制框架尚未确定。',
    retainedInterface: '只保留可扩展谱型引用与验证接口。',
  },
  {
    decisionId: 'Q-02',
    sourceFile: L0_FILE,
    section: '七、待访谈确认事项 Q-02',
    summary: '远程武器两步与枪械一步的并列表述尚未裁决。',
    retainedInterface: '只保留动作序列与动作类别 Schema。',
  },
  {
    decisionId: 'Q-03',
    sourceFile: L0_FILE,
    section: '七、待访谈确认事项 Q-03',
    summary: '枪械伤害表与 AP 经济学的平衡验证尚未完成。',
    retainedInterface: '伤害、成本与平衡赋值归玩法层。',
  },
  {
    decisionId: 'Q-04',
    sourceFile: L0_FILE,
    section: '七、待访谈确认事项 Q-04',
    summary: '载具内部微型场景与外部交互点的边界尚未裁决。',
    retainedInterface: '只保留车辆邻接、门引用与微型场景父级契约。',
  },
  {
    decisionId: 'Q-05',
    sourceFile: L0_FILE,
    section: '七、待访谈确认事项 Q-05',
    summary: '盾牌 MVP 标配范围（扔盾 / 盾击是否保留）尚未裁决。',
    retainedInterface: '只保留防具、动作与能力组合接口。',
  },
] as const satisfies readonly UnresolvedQuestionEntry[]);

const CATALOG_BY_KEY: ReadonlyMap<string, DecisionStatusEntry> = new Map(
  DECISION_STATUS_CATALOG.map((entry) => [`${entry.decisionId}::${entry.sourceFile}`, entry] as const),
);

const UNRESOLVED_BY_ID: ReadonlyMap<string, UnresolvedQuestionEntry> = new Map(
  UNRESOLVED_QUESTION_CATALOG.map((entry) => [entry.decisionId, entry] as const),
);

/** 按 (decisionId, sourceFile) 查询固定地位。 */
export function findDecisionStatus(
  decisionId: DecisionId | undefined,
  sourceFile: SourceFileId,
): DecisionStatusEntry | undefined {
  if (decisionId === undefined) {
    return undefined;
  }
  return CATALOG_BY_KEY.get(`${decisionId}::${sourceFile}`);
}

/** 查询某编号在目录中的全部变体（用于编号复用追踪）。 */
export function findDecisionVariants(decisionId: DecisionId): readonly DecisionStatusEntry[] {
  return DECISION_STATUS_CATALOG.filter((entry) => entry.decisionId === decisionId);
}

/** 查询未决事项。 */
export function findUnresolvedQuestion(
  decisionId: DecisionId | undefined,
): UnresolvedQuestionEntry | undefined {
  if (decisionId === undefined) {
    return undefined;
  }
  return UNRESOLVED_BY_ID.get(decisionId);
}

/** 是否为未决事项编号。 */
export function isUnresolvedQuestionId(decisionId: DecisionId | undefined): boolean {
  return findUnresolvedQuestion(decisionId) !== undefined;
}
