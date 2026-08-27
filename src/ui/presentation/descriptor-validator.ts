/**
 * 描述符语义字段校验（design.md §5.2、§10.1，tasks.md 任务 4.1）。
 *
 * 三条纪律：
 *
 * 1. 语义只从**显式字段**读取。本文件没有任何字段名匹配、颜色推断、文件名推断或标签推断
 *    （Requirement 2.4、9.2）。闭合取值域直接取 L2 的常量表，不在此处复制一份。
 * 2. 拒绝即**撤除由该描述符派生的全部交互入口**，不存在"部分渲染"中间态：被拒绝的动作
 *    不会产出任何 `UiActionView`，因此它的标识不会出现在视图、选项集合或菜单面中。
 * 3. `posture` 按**开放字符串**透传，不做枚举校验（J-15）。把姿态当闭合枚举会导致基类层
 *    新增姿态时 UI 直接拒绝渲染。
 */

import {
  ACTION_CARD_COLOR_THEMES,
  ACTION_COST_CATEGORIES,
  CARD_INTERACTION_MODES,
  INTERACTION_INTENTS,
  RESOURCE_SEMANTIC_ROLES,
} from '../../l2/model/family-contracts';
import {
  UI_DIAGNOSTIC_CODES,
  uiDiagnostic,
  uiOk,
  uiRejected,
  type UiDiagnostic,
  type UiDiagnosticCode,
  type UiResult,
} from '../model/diagnostic';
import type {
  ActionCardColorTheme,
  ActionCostCategory,
  CardInteractionMode,
  InteractionIntent,
  ResourceSemanticRole,
  UiActionView,
  UiBinding,
  UiCardPresentation,
  UiResourceView,
  UiTargetView,
} from '../model/view';
import { resolveAccessibleLabel } from './accessibility';
import { makeGameplayValue } from './gameplay-value';

/** 当前受支持的描述符版本。缺省视为该版本（上游尚未声明版本，§14.4 第 4 项）。 */
export const SUPPORTED_DESCRIPTOR_VERSIONS = ['1'] as const;
export type SupportedDescriptorVersion = (typeof SUPPORTED_DESCRIPTOR_VERSIONS)[number];

export function isSupportedDescriptorVersion(version: string | undefined): boolean {
  return version === undefined || (SUPPORTED_DESCRIPTOR_VERSIONS as readonly string[]).includes(version);
}

function semanticDiagnostic(
  code: UiDiagnosticCode,
  presentationLocation: string,
  reason: string,
): UiDiagnostic {
  return uiDiagnostic({
    code,
    presentationLocation,
    reason,
    correctionSuggestion: '语义字段必须由上游描述符显式给出；UI 不从标签、图标或素材名推导语义',
  });
}

function missing(location: string, field: string): UiDiagnostic {
  return semanticDiagnostic(
    UI_DIAGNOSTIC_CODES.DESCRIPTOR_SEMANTIC_FIELD_MISSING,
    location,
    `必填语义字段 ${field} 缺失或类型不兼容`,
  );
}

function damaged(location: string, field: string): UiDiagnostic {
  return semanticDiagnostic(
    UI_DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED,
    location,
    `语义字段 ${field} 的取值越出闭合取值域`,
  );
}

function readRecord(candidate: unknown): Readonly<Record<string, unknown>> | undefined {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  return candidate as Readonly<Record<string, unknown>>;
}

function readNonEmptyString(candidate: unknown): string | undefined {
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function readBindingValue(candidate: unknown): string | number | boolean | undefined {
  if (typeof candidate === 'string' || typeof candidate === 'boolean') return candidate;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  return undefined;
}

/** 校验单个目标描述符。任一字段不合法即整条不可解析。 */
export function validateTargetDescriptor(raw: unknown, location: string): UiResult<UiTargetView> {
  const record = readRecord(raw);
  const targetId = readNonEmptyString(record?.['targetId']);
  const intent = record?.['intent'];
  const executable = record?.['executable'];
  const label = resolveAccessibleLabel({
    label: record?.['accessibleLabel'],
    stableIdentifier: targetId,
    essential: true,
    presentationLocation: location,
  });
  const problems: UiDiagnostic[] = [];
  if (targetId === undefined) problems.push(missing(location, 'targetId'));
  if (typeof intent !== 'string' || !(INTERACTION_INTENTS as readonly string[]).includes(intent)) {
    problems.push(damaged(location, 'intent'));
  }
  if (typeof executable !== 'boolean') problems.push(missing(location, 'executable'));
  if (label.kind === 'rejected') problems.push(...label.diagnostics);
  if (problems.length > 0) {
    return uiRejected([
      semanticDiagnostic(
        UI_DIAGNOSTIC_CODES.UI_DESCRIPTOR_TARGET_UNRESOLVED,
        location,
        '目标描述符无法解析',
      ),
      ...problems,
    ]);
  }
  return uiOk(
    Object.freeze({
      targetId: targetId as string,
      intent: intent as InteractionIntent,
      executable: executable as boolean,
      accessibleLabel: label.text,
    }),
    label.diagnostics,
  );
}

/**
 * 校验卡片元数据对象（双轨制 P2）。
 * 全部字段可缺省（缺省 → 使用前端默认基线值）；但若出现则必须符合类型约束。
 */
export function validateCardPresentation(
  raw: unknown,
  location: string,
): UiResult<UiCardPresentation> {
  const record = readRecord(raw);
  if (record === null || record === undefined) {
    return uiRejected([damaged(location, 'cardPresentation')]);
  }
  const problems: UiDiagnostic[] = [];

  const iconRef = record['iconRef'];
  if (iconRef !== undefined && typeof iconRef !== 'string') {
    problems.push(damaged(`${location}.iconRef`, 'iconRef'));
  }

  const colorTheme = record['colorTheme'];
  if (
    colorTheme !== undefined &&
    (typeof colorTheme !== 'string' || !(ACTION_CARD_COLOR_THEMES as readonly string[]).includes(colorTheme))
  ) {
    problems.push(damaged(`${location}.colorTheme`, 'colorTheme'));
  }

  const effectText = record['effectText'];
  if (effectText !== undefined && typeof effectText !== 'string') {
    problems.push(damaged(`${location}.effectText`, 'effectText'));
  }

  const interactionMode = record['interactionMode'];
  if (
    interactionMode !== undefined &&
    (typeof interactionMode !== 'string' ||
      !(CARD_INTERACTION_MODES as readonly string[]).includes(interactionMode))
  ) {
    problems.push(damaged(`${location}.interactionMode`, 'interactionMode'));
  }

  if (problems.length > 0) return uiRejected(problems);

  return uiOk(
    Object.freeze({
      iconRef: (iconRef as string | undefined) ?? '',
      colorTheme: (colorTheme as ActionCardColorTheme | undefined) ?? 'neutral',
      effectText: (effectText as string | undefined) ?? '',
      interactionMode: (interactionMode as CardInteractionMode | undefined) ?? 'instant',
    }),
    [],
  );
}

/**
 * 校验资源描述符。
 *
 * `ResourceDescriptor` 由契约构造即为玩家可见的资源呈现（它承载 `role` 与 `accessibleLabel`，
 * 是 HUD 的资源条来源），因此归属分类固定为 `resource` 且 `playerVisible: true`。
 * 越界或非有限取值走 `GAMEPLAY_VALUE_OUT_OF_RANGE`，**不**在此处夹取或换算。
 */
export function validateResourceDescriptor(raw: unknown, location: string): UiResult<UiResourceView> {
  const record = readRecord(raw);
  const entityId = readNonEmptyString(record?.['entityId']);
  const role = record?.['role'];
  const problems: UiDiagnostic[] = [];
  if (entityId === undefined) problems.push(missing(location, 'entityId'));
  if (typeof role !== 'string' || !(RESOURCE_SEMANTIC_ROLES as readonly string[]).includes(role)) {
    problems.push(
      semanticDiagnostic(
        UI_DIAGNOSTIC_CODES.UI_UNKNOWN_RESOURCE_ROLE,
        location,
        `资源语义角色 ${String(role)} 不在闭合取值域内`,
      ),
    );
  }
  const label = resolveAccessibleLabel({
    label: record?.['accessibleLabel'],
    stableIdentifier: entityId,
    essential: true,
    presentationLocation: location,
  });
  if (label.kind === 'rejected') problems.push(...label.diagnostics);
  if (problems.length > 0) return uiRejected(problems);

  const amount = makeGameplayValue(
    record?.['value'],
    { category: 'resource', playerVisible: true, role: role as ResourceSemanticRole },
    location,
  );
  if (!amount.ok) return uiRejected(amount.diagnostics);
  return uiOk(
    Object.freeze({
      entityId: entityId as string,
      role: role as ResourceSemanticRole,
      amount: amount.value,
      accessibleLabel: label.text,
    }),
    [...label.diagnostics, ...amount.diagnostics],
  );
}

export interface ActionValidationContext {
  readonly presentationLocation: string;
  /**
   * 目标绑定来源（`LegalAction.bindings`，见 J-24）。
   *
   * `undefined` 表示"该动作的目标绑定尚未解析"——这是显式的缺失状态，直接判为
   * `UI_DESCRIPTOR_TARGET_UNRESOLVED`；空数组表示"该动作确实不需要绑定"，是合法输入。
   * 二者刻意分开，避免用"空数组"同时表达"没有"和"不需要"。
   */
  readonly bindings: readonly UiBinding[] | undefined;
  readonly descriptorVersion?: string;
  /** 已安全化的不可用原因文案（由 `unavailability-reason.ts` 产出）。 */
  readonly unavailabilityText?: string;
}

/** 校验动作描述符。任一语义字段不合法即拒绝整条，不产出部分视图。 */
export function validateActionDescriptor(
  raw: unknown,
  context: ActionValidationContext,
): UiResult<UiActionView> {
  const location = context.presentationLocation;
  if (!isSupportedDescriptorVersion(context.descriptorVersion)) {
    return uiRejected([
      semanticDiagnostic(
        UI_DIAGNOSTIC_CODES.JSON_SCHEMA_VERSION_UNSUPPORTED,
        location,
        `描述符版本 ${String(context.descriptorVersion)} 超出受支持范围`,
      ),
    ]);
  }

  const record = readRecord(raw);
  const problems: UiDiagnostic[] = [];
  const warnings: UiDiagnostic[] = [];

  const actionId = readNonEmptyString(record?.['actionId']);
  if (actionId === undefined) problems.push(missing(location, 'actionId'));

  const costCategory = record?.['costCategory'];
  if (costCategory === undefined) problems.push(missing(location, 'costCategory'));
  else if (
    typeof costCategory !== 'string' ||
    !(ACTION_COST_CATEGORIES as readonly string[]).includes(costCategory)
  ) {
    problems.push(damaged(location, 'costCategory'));
  }

  // 双轨制 P2：track 字段为闭合域（'highlight' | 'card'）。
  const track = record?.['track'];
  if (track === undefined) {
    problems.push(missing(location, 'track'));
  } else if (typeof track !== 'string' || (track !== 'highlight' && track !== 'card')) {
    problems.push(damaged(location, 'track'));
  }

  // 双轨制 P2：cardPresentation 嵌套对象，仅在 track === 'card' 时应当存在；缺省为合法（用前端默认基线值）。
  const rawCardPresentation = record?.['cardPresentation'];
  let cardPresentation: UiCardPresentation | undefined;
  if (rawCardPresentation !== undefined) {
    const validatedCard = validateCardPresentation(rawCardPresentation, `${location}#cardPresentation`);
    if (!validatedCard.ok) {
      problems.push(...validatedCard.diagnostics);
    } else {
      cardPresentation = validatedCard.value;
    }
  }

  const available = record?.['available'];
  if (typeof available !== 'boolean') problems.push(missing(location, 'available'));

  const interactionIntent = record?.['interactionIntent'];
  if (
    interactionIntent !== undefined &&
    (typeof interactionIntent !== 'string' ||
      !(INTERACTION_INTENTS as readonly string[]).includes(interactionIntent))
  ) {
    problems.push(damaged(location, 'interactionIntent'));
  }

  const posture = record?.['posture'];
  if (posture !== undefined && typeof posture !== 'string') problems.push(damaged(location, 'posture'));

  const rawAssetRefs = record?.['assetRefs'];
  if (!Array.isArray(rawAssetRefs) || rawAssetRefs.some((item) => typeof item !== 'string')) {
    problems.push(missing(location, 'assetRefs'));
  }

  if (context.bindings === undefined) {
    problems.push(
      semanticDiagnostic(
        UI_DIAGNOSTIC_CODES.UI_DESCRIPTOR_TARGET_UNRESOLVED,
        location,
        '目标绑定未解析：合法动作查询未给出该动作的绑定',
      ),
    );
  } else if (context.bindings.some((binding) => readBindingValue(binding.value) === undefined)) {
    problems.push(
      semanticDiagnostic(
        UI_DIAGNOSTIC_CODES.UI_DESCRIPTOR_TARGET_UNRESOLVED,
        location,
        '目标绑定取值不是投影中出现过的标识或值',
      ),
    );
  }

  const targets: UiTargetView[] = [];
  const rawTargets = record?.['targets'];
  if (!Array.isArray(rawTargets)) problems.push(missing(location, 'targets'));
  else {
    rawTargets.forEach((rawTarget, index) => {
      const validated = validateTargetDescriptor(rawTarget, `${location}#target[${String(index)}]`);
      if (validated.ok) {
        targets.push(validated.value);
        warnings.push(...validated.diagnostics);
      } else {
        problems.push(...validated.diagnostics);
      }
    });
  }

  const label = resolveAccessibleLabel({
    label: record?.['accessibleLabel'],
    stableIdentifier: actionId,
    essential: true,
    presentationLocation: location,
  });
  if (label.kind === 'rejected') problems.push(...label.diagnostics);
  else warnings.push(...label.diagnostics);

  if (problems.length > 0) return uiRejected(problems);

  return uiOk(
    Object.freeze({
      actionId: actionId as string,
      costCategory: costCategory as ActionCostCategory,
      track: track as 'highlight' | 'card',
      ...(interactionIntent === undefined
        ? {}
        : { interactionIntent: interactionIntent as InteractionIntent }),
      ...(posture === undefined ? {} : { posture: posture as string }),
      available: available as boolean,
      ...(context.unavailabilityText === undefined
        ? {}
        : { unavailabilityText: context.unavailabilityText }),
      accessibleLabel: label.text,
      assetRefs: Object.freeze([...(rawAssetRefs as readonly string[])]),
      bindings: Object.freeze([...(context.bindings ?? [])]),
      targets: Object.freeze(targets),
      ...(cardPresentation === undefined ? {} : { cardPresentation }),
    }),
    warnings,
  );
}

export interface DescriptorValidation {
  readonly actions: readonly UiActionView[];
  readonly resources: readonly UiResourceView[];
  /** 被拒绝的动作标识。它们的交互入口必须全部撤除。 */
  readonly rejectedActionIds: readonly string[];
  readonly diagnostics: readonly UiDiagnostic[];
}

export interface PresentationDescriptorValidationInput {
  readonly descriptor: unknown;
  readonly descriptorVersion?: string;
  /** 按动作标识提供的目标绑定来源。缺该键即表示该动作的绑定未解析。 */
  readonly bindingsByActionId: Readonly<Record<string, readonly UiBinding[]>>;
  readonly unavailabilityTextByActionId?: Readonly<Record<string, string>>;
}

/**
 * 校验整份表现描述符。
 *
 * 版本不受支持时拒绝**该**描述符，其余兼容投影仍然渲染（Requirement 14.8）——
 * 因此本函数按单份描述符工作，调用方逐份调用，一份被拒不影响其他份。
 */
export function validatePresentationDescriptor(
  input: PresentationDescriptorValidationInput,
): DescriptorValidation {
  const record = readRecord(input.descriptor);
  const scopeId = readNonEmptyString(record?.['scopeId']);
  const location = `presentation/${scopeId ?? 'unknown-scope'}`;

  if (!isSupportedDescriptorVersion(input.descriptorVersion)) {
    return Object.freeze({
      actions: Object.freeze([]),
      resources: Object.freeze([]),
      rejectedActionIds: Object.freeze([]),
      diagnostics: Object.freeze([
        semanticDiagnostic(
          UI_DIAGNOSTIC_CODES.JSON_SCHEMA_VERSION_UNSUPPORTED,
          location,
          `描述符版本 ${String(input.descriptorVersion)} 超出受支持范围，已拒绝整份描述符`,
        ),
      ]),
    });
  }
  if (record === undefined || scopeId === undefined) {
    return Object.freeze({
      actions: Object.freeze([]),
      resources: Object.freeze([]),
      rejectedActionIds: Object.freeze([]),
      diagnostics: Object.freeze([
        semanticDiagnostic(
          UI_DIAGNOSTIC_CODES.PROJECTION_SCOPE_VIOLATION,
          location,
          '描述符缺少 scopeId，无法确定可见性范围',
        ),
      ]),
    });
  }

  const diagnostics: UiDiagnostic[] = [];
  const resources: UiResourceView[] = [];
  const rawResources = record['resources'];
  if (Array.isArray(rawResources)) {
    rawResources.forEach((rawResource, index) => {
      const validated = validateResourceDescriptor(rawResource, `${location}#resource[${String(index)}]`);
      diagnostics.push(...validated.diagnostics);
      if (validated.ok) resources.push(validated.value);
    });
  } else {
    diagnostics.push(missing(location, 'resources'));
  }

  const actions: UiActionView[] = [];
  const rejectedActionIds: string[] = [];
  for (const bucket of ['paidActions', 'attachedActions'] as const) {
    const rawBucket = record[bucket];
    if (!Array.isArray(rawBucket)) {
      diagnostics.push(missing(location, bucket));
      continue;
    }
    rawBucket.forEach((rawAction, index) => {
      const actionId = readNonEmptyString(readRecord(rawAction)?.['actionId']);
      const validated = validateActionDescriptor(rawAction, {
        presentationLocation: `${location}#${bucket}[${String(index)}]`,
        bindings: actionId === undefined ? undefined : input.bindingsByActionId[actionId],
        ...(input.descriptorVersion === undefined ? {} : { descriptorVersion: input.descriptorVersion }),
        ...(actionId === undefined || input.unavailabilityTextByActionId?.[actionId] === undefined
          ? {}
          : { unavailabilityText: input.unavailabilityTextByActionId[actionId] }),
      });
      diagnostics.push(...validated.diagnostics);
      if (validated.ok) actions.push(validated.value);
      else if (actionId !== undefined) rejectedActionIds.push(actionId);
    });
  }

  return Object.freeze({
    actions: Object.freeze(actions),
    resources: Object.freeze(resources),
    rejectedActionIds: Object.freeze([...new Set(rejectedActionIds)].sort()),
    diagnostics: Object.freeze(diagnostics),
  });
}
