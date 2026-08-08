/**
 * L2 Validation: 天然场景、微型场景、过渡与车辆生命周期规则。
 *
 * 对应 Requirements 7.1–7.13、8.7–8.9 与 Property 13。
 *
 * 铁律：
 * - 天然场景不创建具体地图节点；连接上限只有带权威来源才作为 Structural_Bound。
 * - 微型场景恰有一个天然场景父级；lifecycle 由 valid-parent + occupancy 决定；
 *   props.creator 不可变、不承担归属/生命周期；owner 字段被拒绝。
 * - 小场景暴露共享 Micro_Scene 能力并排除个人空地。
 * - 过渡声明端点/方向/通行/阻挡。
 * - 车辆是 Entity；邻接与门目标是独立组合输入。
 * - Q-04 不擅自裁决载具内部微型场景边界。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { NODE_CONNECTION_BOUND } from '../model/constitution.js';
import { joinJsonPath } from '../model/ids.js';
import type { CandidateDefinition } from '../model/definition.js';
import type {
  MicroSceneContract,
  NaturalSceneContract,
  TransitionContract,
} from '../model/family-contracts.js';
import type { DiagnosticCollector, ValidationContext } from './context.js';
import { defError } from './helpers.js';

export function validateNaturalScene(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const contract = definition.familyContract;
  if (contract?.contractKind !== 'natural-scene') {
    return;
  }
  const scene: NaturalSceneContract = contract;
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');

  // 违规检测面：具体地图节点（Requirements 7.1）。
  if (scene.concreteMapNodeIds !== undefined && scene.concreteMapNodeIds.length > 0) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SPACE_CONCRETE_MAP_NODE,
        reason: `天然场景 ${definition.id} 声明了具体地图节点 [${scene.concreteMapNodeIds.join('、')}]。`,
        correctionSuggestion: '天然场景只区分大/中/小 Type_Identity，不创建具体地图节点；节点排布归玩法层（Requirements 7.1）。',
        jsonPath: joinJsonPath(base, 'concreteMapNodeIds'),
      }),
    );
  }

  // 连接上限：只有带权威来源才作为 Structural_Bound（Requirements 7.2）。
  if (scene.connectionBound !== undefined) {
    if (scene.connectionBound.value > NODE_CONNECTION_BOUND) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.SPACE_CONNECTION_BOUND_UNSOURCED,
          reason:
            `天然场景 ${definition.id} 的连接上限 ${scene.connectionBound.value} ` +
            `超过 L0 拓扑铁律的五并列上限 ${NODE_CONNECTION_BOUND}。`,
          correctionSuggestion: '节点连接数不超过 5（L0 拓扑铁律）。',
          jsonPath: joinJsonPath(base, 'connectionBound', 'value'),
        }),
      );
    }
  }

  // 小场景：必须暴露共享 Micro_Scene 能力，且排除个人空地（Requirements 7.10）。
  if (scene.scale === 'small') {
    if (scene.sharedMicroSceneCapabilityRef === undefined) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.SPACE_SMALL_SCENE_MISSING_SHARED_MICRO_SCENE,
          reason: `小场景 ${definition.id} 未暴露共享 Micro_Scene 能力。`,
          correctionSuggestion: '小场景必须暴露共享 Micro_Scene 能力（Requirements 7.10）。',
          jsonPath: joinJsonPath(base, 'sharedMicroSceneCapabilityRef'),
        }),
      );
    }
    if (scene.personalVacantGroundMicroSceneRefs.length > 0) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.SPACE_SMALL_SCENE_PERSONAL_VACANT_GROUND,
          reason: `小场景 ${definition.id} 声明了个人空地 Micro_Scene。`,
          correctionSuggestion: '小场景排除个人空地 Micro_Scene（Requirements 7.10）。',
          jsonPath: joinJsonPath(base, 'personalVacantGroundMicroSceneRefs'),
        }),
      );
    }
  }
}

export function validateMicroScene(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const contract = definition.familyContract;
  if (contract?.contractKind !== 'micro-scene') {
    return;
  }
  const micro: MicroSceneContract = contract;
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');

  // 唯一父级：parent 必须存在（引用解析阶段校验可解析性；此处校验声明存在）。
  if (micro.parent.refId.trim().length === 0) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_PARENT_MISSING,
        reason: `微型场景 ${definition.id} 未声明天然场景父级。`,
        correctionSuggestion: '微型场景必须声明恰好一个天然场景父级（Requirements 7.3）。',
        jsonPath: joinJsonPath(base, 'parent'),
      }),
    );
  }

  // owner 字段被拒绝（Requirements 7.6）。
  if (micro.ownerField !== undefined) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_OWNER_SEMANTICS,
        reason: `微型场景 ${definition.id} 使用 owner 字段「${micro.ownerField}」作为归属/生命周期依据。`,
        correctionSuggestion:
          '微型场景不使用 owner；parent 表示附属关系，props.creator 仅为不可变溯源，生命周期由有效父级与占用状态决定（Requirements 7.6、7.7）。',
        jsonPath: joinJsonPath(base, 'ownerField'),
      }),
    );
  }

  // creator 必须不可变（Requirements 7.4）。
  if (!micro.creator.immutable) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SPACE_CREATOR_MUTABLE,
        reason: `微型场景 ${definition.id} 的 props.creator 被声明为可变。`,
        correctionSuggestion: 'props.creator 是不可变溯源信息，不承担归属或生命周期（Requirements 7.4）。',
        jsonPath: joinJsonPath(base, 'creator', 'immutable'),
      }),
    );
  }

  // 生命周期资格由 valid-parent 与 occupancy 共同决定（Requirements 7.5）。
  const determinants = new Set(micro.lifecycleDeterminants);
  if (!determinants.has('valid-parent') || !determinants.has('occupancy')) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SPACE_MICRO_SCENE_MISSING_OCCUPANCY,
        reason: `微型场景 ${definition.id} 的生命周期依据不完整（需同时含 valid-parent 与 occupancy）。`,
        correctionSuggestion: '微型场景生命周期资格由有效父级与当前占用契约共同决定（Requirements 7.5）。',
        jsonPath: joinJsonPath(base, 'lifecycleDeterminants'),
      }),
    );
  }
}

export function validateTransition(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  const contract = definition.familyContract;
  if (contract?.contractKind !== 'transition') {
    return;
  }
  const transition: TransitionContract = contract;
  const base = joinJsonPath(definition.jsonPath ?? '', 'familyContract');

  if (transition.endpoints.length !== 2) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.SPACE_TRANSITION_MISSING_FIELD,
        reason: `过渡 ${definition.id} 必须恰好声明两个端点，实际 ${transition.endpoints.length} 个。`,
        correctionSuggestion: '过渡连接两个天然场景端点（Requirements 7.7）。',
        jsonPath: joinJsonPath(base, 'endpoints'),
      }),
    );
  }
}

/** 4.6 总入口。 */
export function validateSpatial(
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void {
  validateNaturalScene(definition, context, collector);
  validateMicroScene(definition, context, collector);
  validateTransition(definition, context, collector);
}
