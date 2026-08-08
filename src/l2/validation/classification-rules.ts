/**
 * L2 Validation: 层级边界、术语、Def kind、抽象实例化与语义族规则。
 *
 * 对应 Requirements 1.6–1.8、2.1–2.8、4.1–4.6、4.8、16.3、16.7–16.8 与 Property 2。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { isL1DefKind } from '../model/def-kind.js';
import { REJECTED_LAYER_TERMS, DEPRECATED_TERM_REPLACEMENTS, TERMINOLOGY_SOURCE } from '../model/constitution.js';
import { isKnownSemanticFamilyId, FAMILY_CONTRACT_KIND_BY_FAMILY } from '../model/family-contracts.js';
import { joinJsonPath } from '../model/ids.js';
import type { CandidateDefinition } from '../model/definition.js';
import { qualifyProposedFamily } from '../compiler/source-classifier.js';
import { findDeprecatedMechanicsInText, deprecationSourceRecord } from '../compiler/deprecated-mechanics.js';
import type { DiagnosticCollector, ValidationContext } from './context.js';
import { defError } from './helpers.js';

/** 校验合法 Def kind（Requirements 2.2、4.1）。 */
export function validateDefKind(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  if (!isL1DefKind(definition.defKind)) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.DEF_INVALID_DEF_KIND,
        reason: `定义 ${definition.id} 的 defKind「${String(definition.defKind)}」不是合法的 L1 Def kind。`,
        correctionSuggestion:
          '每个 L2 定义必须映射到一个合法 L1 Def kind：entity/item/node/link/attachment/action/rule/playpack/decision/prefab/expr/schedule/policy。',
        jsonPath: joinJsonPath(definition.jsonPath ?? '', 'defKind'),
      }),
    );
  }
}

/** 拒绝重定义 L1 独占机制（Requirements 2.3，代码类别 LAYER_L1_OWNERSHIP）。 */
export function validateNoL1Mechanism(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  for (const mechanism of definition.declaredL1Mechanisms ?? []) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.LAYER_L1_OWNERSHIP,
        reason: `定义 ${definition.id} 声明要引入/重定义 L1 独占机制「${mechanism}」。`,
        correctionSuggestion:
          '引擎层机制（Ref 前缀、事务、Op 分发、Expr 求值、Hook 调度、持久化、随机流、搜索）归 L1，L2 只能引用不能重定义。',
        jsonPath: joinJsonPath(definition.jsonPath ?? '', 'declaredL1Mechanisms'),
      }),
    );
  }
}

/** 拒绝越层玩法规则（Requirements 2.4、10.5，代码类别 LAYER_L3_OWNERSHIP）。 */
export function validateNoGameplaySpecificRule(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  for (const rule of definition.gameplaySpecificRules ?? []) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.LAYER_L3_OWNERSHIP,
        reason: `定义 ${definition.id} 声明了具体玩法规则「${rule.kind}」：${rule.detail}`,
        correctionSuggestion:
          '具体地图、胜负条件、生成分布、玩法序列、巡逻路线、玩法专属状态机与 NPC 实例耦合归玩法层，不能出现在基类层定义。',
        ...(rule.jsonPath === undefined ? {} : { jsonPath: rule.jsonPath }),
      }),
    );
  }
}

/** 拒绝未分类的玩法数值（Requirements 2.5，代码类别 VALUE_L3_OWNERSHIP）。 */
export function validateNoUnclassifiedGameplayValue(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  for (let index = 0; index < (definition.gameplayValues ?? []).length; index += 1) {
    const assignment = definition.gameplayValues![index]!;
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.VALUE_L3_OWNERSHIP,
        reason:
          `定义 ${definition.id} 直接为字段「${assignment.field}」赋玩法数值，` +
          '基类层实例不得携带具体玩法数值。',
        correctionSuggestion:
          '把具体玩法数值交给玩法层 Profile 提供；基类层只声明参数 Schema 接口。',
        jsonPath: joinJsonPath(definition.jsonPath ?? '', 'gameplayValues', index),
      }),
    );
  }
}

/**
 * 术语校验（Requirements 1.6–1.7）。
 * 扫描定义标识、标签、能力名与 Type_Identity 中是否出现废用层级/建模术语。
 * 不扫描表现文本（描述、显示名），避免把散文里的字样误判。
 */
export function validateTerminology(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const targets: { readonly text: string; readonly where: string }[] = [
    { text: definition.id, where: 'id' },
    { text: definition.semanticFamily.familyId, where: 'semanticFamily/familyId' },
    ...definition.tags.map((tag, index) => ({ text: tag, where: `tags/${index}` })),
    ...definition.typeIdentity.requiredCapabilities.map((capability, index) => ({
      text: capability,
      where: `typeIdentity/requiredCapabilities/${index}`,
    })),
  ];

  for (const target of targets) {
    for (const term of REJECTED_LAYER_TERMS) {
      if (target.text.includes(term)) {
        const replacement = DEPRECATED_TERM_REPLACEMENTS.get(term) ?? '规范术语';
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.TERM_DEPRECATED_LAYER_TERM,
            reason: `定义 ${definition.id} 在 ${target.where} 使用了废用词「${term}」。`,
            correctionSuggestion: `改用规范术语「${replacement}」（L0 术语铁律、Requirements 1.7）。`,
            jsonPath: joinJsonPath(definition.jsonPath ?? '', target.where),
            relatedSources: [TERMINOLOGY_SOURCE],
          }),
        );
      }
    }
  }
}

/** 拒绝复述废案清单中的禁止机制（Requirements 16.7–16.8）。 */
export function validateNoDeprecatedMechanic(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  // 只扫描结构性标识（id、tags、能力），不扫描表现文本。
  const scanText = [
    definition.id,
    ...definition.tags,
    ...definition.typeIdentity.requiredCapabilities,
    ...(definition.gameplaySpecificRules ?? []).map((rule) => rule.detail),
  ].join(' \u0001 ');
  for (const entry of findDeprecatedMechanicsInText(scanText)) {
    if (entry.status !== 'vetoed') {
      continue;
    }
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SOURCE_DEPRECATED_MECHANIC,
        reason: `定义 ${definition.id} 以基类层标准契约重新引入了废案机制「${entry.mechanic}」：${entry.vetoReason}`,
        correctionSuggestion: '废案机制禁止作为 L2 标准契约重新引入（Requirements 16.8）。',
        relatedSources: [deprecationSourceRecord(entry)],
      }),
    );
  }
}

/**
 * 语义族规则（Requirements 4.2–4.4、4.6、16.3）。
 *
 * - 已知族：直接通过；若声明了 familyContract，其 contractKind 必须与族一致。
 * - 未知族：必须随定义提交三判据证据（`semanticFamily.registration`）并通过三判据。
 * - 组合实例伪装成基类：带专用契约的定义若其 typeIdentity 为空且 familyId 是组合产物名，
 *   由 inheritance 规则与本规则共同拒绝（此处拒绝"未登记且无三判据证据"的族）。
 */
export function validateSemanticFamily(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const familyId = definition.semanticFamily.familyId;
  const known = isKnownSemanticFamilyId(familyId);
  const registeredInContext = context.registeredFamilies.has(familyId);
  const registration = definition.semanticFamily.registration;

  if (!known && !registeredInContext && registration === undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.FAMILY_UNREGISTERED,
        reason: `定义 ${definition.id} 使用了未登记的语义族「${familyId}」，且未随定义提交三判据登记证据。`,
        correctionSuggestion:
          '新语义族必须在 semanticFamily.registration 中提供可枚举、可组合、不含具体玩法语义的三判据证据与 Source_Record。',
        jsonPath: joinJsonPath(definition.jsonPath ?? '', 'semanticFamily'),
      }),
    );
    return;
  }

  if (registration !== undefined) {
    const verdict = qualifyProposedFamily(registration.eligibility);
    if (!verdict.accepted) {
      const codeByCriterion = {
        enumerable: DIAGNOSTIC_CODES.FAMILY_NOT_ENUMERABLE,
        composable: DIAGNOSTIC_CODES.FAMILY_NOT_COMPOSABLE,
        gameplayIndependent: DIAGNOSTIC_CODES.FAMILY_GAMEPLAY_DEPENDENT,
      } as const;
      for (const criterion of verdict.failedCriteria) {
        collector.add(
          defError(context, definition, {
            code: codeByCriterion[criterion],
            reason: `定义 ${definition.id} 提议的语义族「${familyId}」未通过三判据（${criterion}）。`,
            correctionSuggestion: '三判据必须同时成立；否则该概念归玩法层，或应作为已有基类的组合实例。',
            jsonPath: joinJsonPath(definition.jsonPath ?? '', 'semanticFamily', 'registration'),
          }),
        );
      }
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.FAMILY_COMBINATION_INSTANCE_AS_BASE,
          reason: `定义 ${definition.id} 试图把不满足三判据的概念「${familyId}」登记为基类语义族。`,
          correctionSuggestion:
            '像"霰弹枪"这样的组合实例应由枪械类型 + 散射谱型 + 伤害接口组合产生，而不是登记为新基类族。',
          jsonPath: joinJsonPath(definition.jsonPath ?? '', 'semanticFamily', 'registration'),
        }),
      );
    } else if (registration.sourceRecords.length === 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.DEF_MISSING_SOURCE_RECORD,
          reason: `定义 ${definition.id} 的新语义族登记缺少 Source_Record。`,
          correctionSuggestion: '为新语义族登记至少一条权威 Source_Record（Requirements 4.3）。',
          jsonPath: joinJsonPath(definition.jsonPath ?? '', 'semanticFamily', 'registration'),
        }),
      );
    }
  }

  // 已知族的 familyContract 一致性。
  const contract = definition.familyContract;
  if (contract !== undefined && known) {
    const expected = FAMILY_CONTRACT_KIND_BY_FAMILY.get(familyId);
    if (expected !== undefined && contract.contractKind !== expected && contract.contractKind !== 'generic') {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.FAMILY_UNREGISTERED,
          reason:
            `定义 ${definition.id} 的语义族「${familyId}」期望契约 kind「${expected}」，` +
            `但 familyContract.contractKind 为「${contract.contractKind}」。`,
          correctionSuggestion: '使 familyContract.contractKind 与语义族一致。',
          jsonPath: joinJsonPath(definition.jsonPath ?? '', 'familyContract', 'contractKind'),
        }),
      );
    }
  }
}

/** 抽象实例化检查（Requirements 4.5–4.6）。 */
export function validateAbstractInstantiation(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  // 非抽象实例不得携带 gameplayValues/gameplaySpecificRules（Reusable_Instance 铁律，Requirements 2.1）。
  if (!definition.abstract) {
    if ((definition.gameplayValues ?? []).length > 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.DEF_INSTANCE_CARRIES_GAMEPLAY_VALUE,
          reason: `可复用实例 ${definition.id} 携带了玩法数值赋值。`,
          correctionSuggestion: '可复用实例不含玩法数值；具体数值由玩法层 Profile 提供。',
          jsonPath: joinJsonPath(definition.jsonPath ?? '', 'gameplayValues'),
        }),
      );
    }
    if ((definition.gameplaySpecificRules ?? []).length > 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.DEF_INSTANCE_CARRIES_GAMEPLAY_RULE,
          reason: `可复用实例 ${definition.id} 携带了具体玩法规则。`,
          correctionSuggestion: '可复用实例不含具体玩法规则；玩法规则归玩法层。',
          jsonPath: joinJsonPath(definition.jsonPath ?? '', 'gameplaySpecificRules'),
        }),
      );
    }
  }
}
