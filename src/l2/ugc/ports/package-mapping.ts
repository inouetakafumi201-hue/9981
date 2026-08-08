/**
 * L2 → wakeup-ugc 端口：`decodedValue` → `DefinitionPackage` 映射与覆盖授权核对。
 *
 * ## 为什么以 `canonicalJson` 作为解析输入
 * wakeup-ugc 的 canonicalizer 证实 `decodedValue` 就是 `JSON.parse(canonicalJson)` 的结果
 * （见 `src/core/ugc/canonical/canonicalizer.ts`）。两者语义等价，但 `canonicalJson` 多一样东西：
 * **文本**。l2 的诊断定位（行/列）与禁止构造扫描都建立在文本之上，若改用 `decodedValue` 再由 l2
 * 自行序列化，报出的位置就会指向一份只有 l2 见过的文本。因此这里用 `canonicalJson` 喂给 l2 唯一的
 * 解析入口 `parsePackage`，并**显式核对**它与 `decodedValue` 语义一致；不一致即失败关闭。
 *
 * 这不是「绕过契约」：契约给出的是同一个候选的两种表示，端口消费其中带位置信息的那一种，
 * 并对另一种做一致性断言。任何一侧被篡改都会在这里暴露，而不是在激活时才炸。
 *
 * ## 为什么覆盖授权在这里判定
 * 「这次变更是否被授权覆盖既有定义」需要同时看两样东西：wakeup-ugc 封存的
 * `binding.operation` / `expectedTargetId`（授权），与 l2 文档里声明的 `overrideIntent` / `removals`
 * （声明）。前者只存在于端口边界，l2 自己的 `activate()` 路径看不到。因此这是端口的固有职责，
 * 不是把 l2 的验证职责搬了一份过来。诊断复用 l2 早已保留的
 * `REF_OVERRIDE_NOT_DECLARED` / `REF_REMOVAL_TARGET_MISSING` / `REF_OVERRIDE_TARGET_MISSING` 代码，
 * 使它们与其他 l2 诊断走完全相同的投影与排序路径。
 */

import type { Diagnostic as KernelDiagnostic } from '../../../core/kernel/state/diagnostic.js';
import type { UGCDiagnosticFactory } from '../../../core/ugc/diagnostics/factory.js';
import type { ValidationStage } from '../../../core/ugc/model/stage.js';
import type { CanonicalizedChangeRequest } from '../../../core/ugc/model/canonical-types.js';
import { DIAGNOSTIC_CODES } from '../../model/diagnostic-codes.js';
import type { Diagnostic as L2Diagnostic } from '../../model/diagnostic.js';
import { errorDiagnostic } from '../../model/diagnostic-factory.js';
import { canonicalSort, compareDiagnostics, compareStrings, stableStringify } from '../../model/ordering.js';
import { joinJsonPath, ROOT_JSON_PATH } from '../../model/ids.js';
import type { DefinitionPackage } from '../../model/definition.js';
import { parsePackage } from '../../codec/json-codec.js';
import type { SourceIndex } from './source-index.js';

export interface CandidateMappingInput {
  readonly request: CanonicalizedChangeRequest;
  /** 目标注册表当前的活动定义标识集合，用于覆盖/删除授权核对。 */
  readonly activeDefinitionIds: ReadonlySet<string>;
  readonly factory: UGCDiagnosticFactory;
  readonly stage: ValidationStage;
  readonly index: SourceIndex;
}

export interface CandidateMappingResult {
  /** 仅在无任何错误级发现时非 null。 */
  readonly package: DefinitionPackage | null;
  /** l2 形状的诊断（解析 + 覆盖授权），由调用方统一投影，保证与其他 l2 诊断同路径。 */
  readonly l2Diagnostics: readonly L2Diagnostic[];
  /** 端口自身完整性诊断，已是内核形状（无对应 l2 代码，属端口/上游契约违约）。 */
  readonly portDiagnostics: readonly KernelDiagnostic[];
}

/**
 * 定义标识 → 该定义在候选文档中的锚点 JSON path。
 *
 * 优先使用解码器写入的 `jsonPath`；缺省时回落到按声明序推导的 `/definitions/{index}`。
 * 两者都是文档内真实存在的位置，不是编造的字段路径。
 */
export function definitionAnchorsOf(pkg: DefinitionPackage): ReadonlyMap<string, string> {
  const anchors = new Map<string, string>();
  pkg.definitions.forEach((definition, index) => {
    const declared = definition.jsonPath;
    const anchor =
      declared === undefined || declared === ROOT_JSON_PATH
        ? joinJsonPath(ROOT_JSON_PATH, 'definitions', index)
        : declared;
    if (!anchors.has(definition.id)) {
      anchors.set(definition.id, anchor);
    }
  });
  return anchors;
}

/** 端口完整性诊断：`canonicalJson` 与 `decodedValue` 不是同一个语义值。 */
function roundtripMismatch(input: CandidateMappingInput, detail: string): KernelDiagnostic {
  return input.factory.document({
    selector: { category: 'ATOMIC_ACTIVATION', condition: 'roundtrip-mismatch' },
    stage: input.stage,
    sourcePackage: input.request.binding.sourcePackageId,
    message: `canonicalJson and decodedValue disagree: ${detail}`,
    reason:
      '端口收到的规范化文本与规范化值不是同一个语义值，无法确定该以哪一个为准。' +
      `差异：${detail}`,
    correctionSuggestion:
      '这是上游规范化环节的契约违约，不是创作内容问题；请重新从原始候选执行规范化后再提交。',
    sourceSpan: input.index.anchor(),
    messageArgs: Object.freeze({ detail }),
    rootCauseId: 'l2-port/canonical-roundtrip-mismatch',
  });
}

type StableForm = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly error: string };

/** 取语义稳定形式。`stableStringify` 对非有限数字与不可序列化值抛错，这里转成结构化结果。 */
function stableFormOf(value: unknown): StableForm {
  try {
    return { ok: true, text: stableStringify(value) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 核对 `canonicalJson` 与 `decodedValue` 的语义一致性。
 *
 * `canonicalJson` 无法 `JSON.parse` 时**不**在此报错：那是语法问题，`parsePackage` 会给出带行列的
 * 精确诊断，这里再报一条只会制造重复。
 */
function checkCanonicalAgreement(input: CandidateMappingInput): readonly KernelDiagnostic[] {
  let reparsed: unknown;
  try {
    reparsed = JSON.parse(input.request.candidate.canonicalJson);
  } catch {
    return Object.freeze([]);
  }
  const fromText = stableFormOf(reparsed);
  const fromValue = stableFormOf(input.request.candidate.decodedValue);
  if (!fromText.ok) {
    return Object.freeze([roundtripMismatch(input, `canonicalJson 无法稳定序列化：${fromText.error}`)]);
  }
  if (!fromValue.ok) {
    return Object.freeze([roundtripMismatch(input, `decodedValue 无法稳定序列化：${fromValue.error}`)]);
  }
  if (fromText.text !== fromValue.text) {
    return Object.freeze([
      roundtripMismatch(
        input,
        `稳定序列化结果长度 ${fromText.text.length} vs ${fromValue.text.length}，内容不相同`,
      ),
    ]);
  }
  return Object.freeze([]);
}

/**
 * 覆盖 / 删除授权核对（`authorized-override` 能力）。
 *
 * 三条独立判据，全部违反都会被报出（不遇错即停，符合 error-aggregation）：
 * 1. **未声明覆盖**：候选定义的标识已在活动集中，但包里没有对应 `overrideIntent`。
 * 2. **授权与声明不符**：`binding.operation` 与文档声明的覆盖/删除意图矛盾，
 *    或 `expectedTargetId` 不在被覆盖/被删除的目标里。
 * 3. **删除目标不存在**：`removals` 指向活动集中不存在的定义。
 */
function checkChangeAuthorization(input: CandidateMappingInput, pkg: DefinitionPackage): readonly L2Diagnostic[] {
  const diagnostics: L2Diagnostic[] = [];
  const pkgId = pkg.packageId;
  const { operation, expectedTargetId } = input.request.binding;
  const declaredOverrides = new Set((pkg.overrideIntent ?? []).map((intent) => intent.targetId));
  const declaredRemovals = new Set((pkg.removals ?? []).map((removal) => removal.targetId));

  // 1. 未声明覆盖。
  const collisions = pkg.definitions
    .map((definition) => definition.id)
    .filter((id) => input.activeDefinitionIds.has(id) && !declaredOverrides.has(id))
    .sort(compareStrings);
  for (const id of collisions) {
    diagnostics.push(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.REF_OVERRIDE_NOT_DECLARED,
        reason: `候选定义 ${id} 与活动注册表中已有定义同名，但本次变更没有声明对它的覆盖意图。`,
        correctionSuggestion:
          '若确实要替换既有定义，请在包的 overrideIntent 中声明该目标并给出理由；' +
          '若想新增定义，请改用一个未被占用的标识。',
        definitionId: id,
        sourcePackage: pkgId,
      }),
    );
  }

  // 2. 授权与声明不符。
  if (operation === 'add' && (declaredOverrides.size > 0 || declaredRemovals.size > 0)) {
    diagnostics.push(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.REF_OVERRIDE_NOT_DECLARED,
        reason:
          `变更请求的操作为 add，但候选包声明了 ${declaredOverrides.size} 项覆盖意图与 ` +
          `${declaredRemovals.size} 项删除意图。add 不授权修改既有定义。`,
        correctionSuggestion: '把变更请求的操作改为 replace（覆盖）或 remove（删除），或移除文档中的覆盖/删除声明。',
        sourcePackage: pkgId,
      }),
    );
  }
  if (operation === 'replace') {
    if (declaredOverrides.size === 0 && declaredRemovals.size === 0) {
      diagnostics.push(
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.REF_OVERRIDE_TARGET_MISSING,
          reason: '变更请求的操作为 replace，但候选包没有声明任何覆盖或删除意图。',
          correctionSuggestion: '在包的 overrideIntent 中声明被替换的定义，或把操作改为 add。',
          sourcePackage: pkgId,
        }),
      );
    }
    if (expectedTargetId !== null && !declaredOverrides.has(expectedTargetId) && !declaredRemovals.has(expectedTargetId)) {
      diagnostics.push(
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.REF_OVERRIDE_TARGET_MISSING,
          reason: `变更请求声明预期目标 ${expectedTargetId}，但候选包的覆盖/删除意图里没有它。`,
          correctionSuggestion: '使 expectedTargetId 与文档声明的覆盖或删除目标一致。',
          sourcePackage: pkgId,
        }),
      );
    }
  }
  if (operation === 'remove') {
    if (declaredRemovals.size === 0) {
      diagnostics.push(
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.REF_REMOVAL_TARGET_MISSING,
          reason: '变更请求的操作为 remove，但候选包没有声明任何删除意图。',
          correctionSuggestion: '在包的 removals 中声明被删除的定义标识与理由。',
          sourcePackage: pkgId,
        }),
      );
    }
    if (expectedTargetId !== null && !declaredRemovals.has(expectedTargetId)) {
      diagnostics.push(
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.REF_REMOVAL_TARGET_MISSING,
          reason: `变更请求声明预期删除目标 ${expectedTargetId}，但候选包的 removals 里没有它。`,
          correctionSuggestion: '使 expectedTargetId 与文档声明的删除目标一致。',
          sourcePackage: pkgId,
        }),
      );
    }
  }

  // 3. 删除目标不存在于活动集。
  for (const targetId of [...declaredRemovals].sort(compareStrings)) {
    if (!input.activeDefinitionIds.has(targetId)) {
      diagnostics.push(
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.REF_REMOVAL_TARGET_MISSING,
          reason: `删除意图指向 ${targetId}，但活动注册表中不存在该定义。`,
          correctionSuggestion: '确认删除目标标识；删除一个不存在的定义没有可观察结果，因此按错误处理而不是静默忽略。',
          sourcePackage: pkgId,
        }),
      );
    }
  }

  return diagnostics;
}

/**
 * 把封存的规范化变更请求映射为 l2 候选定义包。
 *
 * 失败关闭：任何错误级发现都让 `package` 为 null，调用方不得继续解析或激活。
 */
export function mapCandidatePackage(input: CandidateMappingInput): CandidateMappingResult {
  const portDiagnostics = [...checkCanonicalAgreement(input)];
  const source = input.request.candidate.source;
  const parsed = parsePackage(input.request.candidate.canonicalJson, {
    sourceLocation: { sourceFile: source.documentId, section: source.sourceName },
    packageId: input.request.binding.sourcePackageId,
  });

  if (parsed.rejected) {
    return {
      package: null,
      l2Diagnostics: canonicalSort(parsed.diagnostics, compareDiagnostics),
      portDiagnostics: Object.freeze(portDiagnostics),
    };
  }

  const authorization = checkChangeAuthorization(input, parsed.value);
  const l2Diagnostics = canonicalSort([...parsed.warnings, ...authorization], compareDiagnostics);
  const blocked = authorization.length > 0 || portDiagnostics.length > 0;
  return {
    package: blocked ? null : parsed.value,
    l2Diagnostics,
    portDiagnostics: Object.freeze(portDiagnostics),
  };
}
