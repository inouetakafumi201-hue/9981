/**
 * 玩法层 profile 契约审计。
 *
 * 每个 `audit*` 函数返回诊断列表，空列表表示通过。判定依据集中在这里，测试只负责断言"结果为空"
 * 或"结果等于已登记的例外集合"，从而让每条约束都有一个能证伪它的入口。
 *
 * 约束来源：
 *  - 宪法四·4.2（玩家可见数值 1-5）与四·4.3（五并列原则）
 *  - 宪法四·4.1（唯一写入通道 OpRegistry.invoke；所有行为必须映射到 Op）
 *  - `.kiro/specs/l2-base-layer-spec/requirements.md` 需求 6.2/6.4（Paid_Action 单 AP、多步序列）
 *  - 同上 需求 12.1-12.4（引用在装载前必须全部解析且类型匹配）
 */
import type { JsonValue } from '../../core/kernel/spec-compiler/types.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CAS_FIELD_GAP_CODE, caSFieldMatches } from '../../l2/model/cas-field-alignment.js';
import { alignCapabilityToComponentContract } from '../../l2/model/component-alignment.js';
import {
  COMPOSITION_REGISTRY,
  compileFamilyComponentShapeIndex,
} from '../../l2/model/family-component-shapes.js';
import {
  CLASS_ROOT,
  familyFor,
  type ClassEntry,
  type ClassFamily,
  type ClassLayerIndex,
  type ParameterSpec,
  type PlayProfile,
} from './catalog.js';
import { auditNumericOwnership, type NumericFinding } from '../types/numeric-classification.js';

/** 一条审计诊断。 */
export interface Finding {
  /** 稳定诊断码，便于在报告与测试之间对齐。 */
  readonly code: string;
  readonly sourceId: string;
  readonly jsonPath: string;
  readonly reason: string;
}

function finding(code: string, sourceId: string, jsonPath: string, reason: string): Finding {
  return { code, sourceId, jsonPath, reason };
}

function sortFindings(findings: readonly Finding[]): readonly Finding[] {
  return [...findings].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId, 'en')
    || left.jsonPath.localeCompare(right.jsonPath, 'en')
    || left.code.localeCompare(right.code, 'en'));
}

function optionalArray(
  owner: Readonly<Record<string, JsonValue>>,
  field: string,
): readonly JsonValue[] {
  const value = owner[field];
  return Array.isArray(value) ? value : [];
}

function optionalObject(
  owner: Readonly<Record<string, JsonValue>>,
  field: string,
): Readonly<Record<string, JsonValue>> | undefined {
  const value = owner[field];
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') {
    return undefined;
  }
  return value;
}

function stringsOf(
  owner: Readonly<Record<string, JsonValue>>,
  field: string,
): readonly string[] {
  return optionalArray(owner, field).filter((entry): entry is string => typeof entry === 'string');
}

/** 把任意 JsonValue 收窄为对象，非对象返回 undefined。 */
function asRecord(value: JsonValue | undefined): Readonly<Record<string, JsonValue>> | undefined {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') {
    return undefined;
  }
  return value;
}

/** profile 内所有承载动作定义的字段名。武器与物品用 `actions`，载具用 `grantedActions`。 */
const ACTION_FIELDS = ['actions', 'grantedActions'] as const;

/** 逐个访问 profile 内的动作定义。 */
function forEachAction(
  profile: PlayProfile,
  visit: (action: Readonly<Record<string, JsonValue>>, jsonPath: string) => void,
): void {
  for (const field of ACTION_FIELDS) {
    optionalArray(profile.document, field).forEach((entry, index) => {
      const action = asRecord(entry);
      if (action !== undefined) visit(action, `/${field}/${index}`);
    });
  }
}

// ---------------------------------------------------------------------------
// 1. 数值归属
// ---------------------------------------------------------------------------

/** 把数值归属诊断转成统一 Finding 形态。 */
export function auditNumericValues(profiles: readonly PlayProfile[]): readonly Finding[] {
  const findings: Finding[] = [];
  for (const profile of profiles) {
    for (const item of auditNumericOwnership(profile.document) as readonly NumericFinding[]) {
      findings.push(finding(
        item.classification === 'Unclassified' ? 'PLAY-NUM-UNCLASSIFIED' : 'PLAY-NUM-OUT-OF-RANGE',
        profile.sourceId,
        item.path,
        item.reason,
      ));
    }
  }
  return sortFindings(findings);
}

// ---------------------------------------------------------------------------
// 2. 基类层引用完整性
// ---------------------------------------------------------------------------

function checkMember(
  registry: ReadonlySet<string>,
  value: JsonValue | undefined,
  code: string,
  sourceId: string,
  jsonPath: string,
  family: string,
  findings: Finding[],
): void {
  if (value === undefined) return;
  if (typeof value !== 'string') {
    findings.push(finding(code, sourceId, jsonPath, `引用必须是字符串，实际为 ${JSON.stringify(value)}`));
    return;
  }
  if (!registry.has(value)) {
    findings.push(finding(code, sourceId, jsonPath, `${family} 未登记 id ${value}`));
  }
}


/**
 * 校验每个 profile 的 `classComposition` 只引用基类层已登记的语义 id，且组合关系被显式声明。
 * 缺少 `classComposition` 本身就是一条诊断——玩法层实例必须说明自己组合了哪些基类。
 */
export function auditClassLayerReferences(
  profiles: readonly PlayProfile[],
  index: ClassLayerIndex,
): readonly Finding[] {
  const findings: Finding[] = [];

  for (const profile of profiles) {
    const { sourceId, document } = profile;
    const composition = optionalObject(document, 'classComposition');
    if (composition === undefined) {
      findings.push(finding(
        'PLAY-REF-NO-COMPOSITION',
        sourceId,
        '/classComposition',
        '玩法层实例必须显式声明与基类层的组合关系',
      ));
      continue;
    }

    const family = familyFor(index, profile.category);
    const contract = family.contract;

    const classIds = referencedIds(composition, contract.classField);
    if (contract.classField === undefined) {
      findings.push(finding('PLAY-REF-NO-CONTRACT', sourceId, '/classComposition',
        `基类层 ${profile.category} 目录没有声明 classReferenceField，无法校验类引用`));
    } else if (classIds.length === 0) {
      findings.push(finding('PLAY-REF-CONTRACT-FIELD', sourceId,
        `/classComposition/${contract.classField}`,
        `基类层组合契约要求用 classComposition.${contract.classField} 声明类引用，`
        + `实际存在的字段是 ${Object.keys(composition).join(', ')}`));
    }
    for (const [position, classId] of classIds.entries()) {
      if (!family.classes.has(classId)) {
        findings.push(finding('PLAY-REF-CLASS-DANGLING', sourceId,
          `/classComposition/${String(contract.classField)}${classIds.length > 1 ? `/${position}` : ''}`,
          `${profile.category} 类目录未登记 id ${classId}`));
      }
    }

    const capabilityField = contract.capabilityField ?? 'capabilityIds';
    const capabilityIds = referencedIds(composition, capabilityField);
    for (const [position, capabilityId] of capabilityIds.entries()) {
      if (!family.capabilities.has(capabilityId)) {
        findings.push(finding('PLAY-REF-CAPABILITY-DANGLING', sourceId,
          `/classComposition/${capabilityField}/${position}`,
          `${profile.category} 能力目录未登记 id ${capabilityId}`));
      }
    }

    auditCapabilityScope(profile, family, classIds, capabilityIds, capabilityField, findings);
    auditKernelOpsAlignment(profile, family, capabilityIds, capabilityField, findings);
    // T-CaS-03：组合能力的 compositionKind/familyId/参数/kernelOps 与 ECS 组件契约单一源机器对齐。
    // 真实组合路径（classComposition 组合的能力）是生产态入口；ECS 未绑定该能力时为空操作。
    const ecsAlignment = auditCapabilityComponentContract(profile, family, capabilityIds, capabilityField,
      familyShapeIndex());
    findings.push(...ecsAlignment);

    if (profile.category === 'weapons') {
      auditWeaponComposition(profile, composition, contract, index, findings);
    }
    if (profile.category === 'statuses') continue;
  }
  return sortFindings(findings);
}

/**
 * ECS System 接线对齐（PT-12）：对每个组合的基类层能力，校验它声明的 `kernelOps`
 * 引用的参数是否落在该能力的 `parameters` 槽位（同一通路，闭合 CaS 缝隙）。
 *
 * 目的：基类层目录说"这个能力由哪些 Op 读写"，玩法层组合它时这些 Op 读写的字段名
 * 必须能映射到该能力声明的可配置参数。字段名既不能写到能力未声明的槽位（漏网），
 * 也不能引用了不存在的参数。它是把 ECS 的"原子 System 接线"承诺延伸到玩法层组合路径上，
 * 与既有 `auditVehicleParameterBacking` 的能力参数支撑校验互补。
 */
function auditKernelOpsAlignment(
  profile: PlayProfile,
  family: ClassFamily,
  capabilityIds: readonly string[],
  capabilityField: string,
  findings: Finding[],
): void {
  for (const [position, capabilityId] of capabilityIds.entries()) {
    const capability = family.capabilities.get(capabilityId);
    if (capability === undefined) continue;
    const { kernelOps, parameterNames, parameters } = capability;
    // 基类层可选：允许能力不声明 kernelOps（未限定接线），此时没有字段名可对齐。
    if (kernelOps.size === 0) continue;
    // valueShape 可能把参数声明为"字段名引用"，而 kernelOps 操作数才是真正会被 System 读写的字段。
    // 本校验对齐 ECS 语义：`kernelOps` 引用的字段名应落回该能力 `parameters` 声明的槽位。
    const declared = new Set([...parameterNames, ...parameters.map((p) => p.key)]);
    for (const scopeField of kernelOps) {
      // `scopeField` 形态：`prop.set(hp)` 这类携带字段名的接线、或裸 `prop.set`。
      const openParen = scopeField.indexOf('(');
      const opName = openParen === -1 ? scopeField : scopeField.slice(0, openParen);
      // 单一权威判定（wakeup-cas-gap-closure Req 1.1/1.2/1.5）：字段↔参数名同轨、裸 Op 不适用。
      // 由 `src/l2/model/cas-field-alignment.ts::caSFieldMatches` 收敛，禁止再在各处内联一套。
      if (caSFieldMatches(scopeField, declared) !== 'no-match') continue;
      const fieldHint = scopeField.slice(openParen + 1, -1);
      findings.push(finding(CAS_FIELD_GAP_CODE, profile.sourceId,
        `/classComposition/${capabilityField}/${position}/kernelOps`,
        `能力 ${capabilityId} 的 ECS 接线 ${opName} 引用字段 ${fieldHint}，但该能力未在 parameters 声明这个槽位（CaS 缝隙）。`
        + `在基类层能力 parameters 补声明，或在玩法层对应字段改名对齐。`));
    }
  }
}

/**
 * T-CaS-03 / T-CaS-04：组合能力的 `compositionKind`/`familyId`/`componentId`/参数/kernelOps
 * 与 ECS 组件契约单一源（`COMPOSITION_REGISTRY` + `family-component-shapes` 族形状）交叉核对，
 * 并把 profile 顶层实际写到的字段对齐到「ECS 组件参数 ∪ 玩法层归属字段单一源」。
 *
 * 仅在能力同时声明了 `familyId` 且该族在单一源可解析时做完整对齐；能力未声明 familyId
 * （既有目录能力不绑定 ECS 形状）或 ECS 族未登记 → 空操作，向后兼容。
 * `ECS_ALIGN_FIELD_NOT_OWNED` 归属半环以 `COMPOSITION_REGISTRY.listShapes()` 的
 * `playLayerOwnedFieldNames` 为唯一权威（T-CaS-04 收敛后的单一源）。
 */
export function auditCapabilityComponentContract(
  profile: PlayProfile,
  family: ClassFamily,
  capabilityIds: readonly string[],
  capabilityField: string,
  familyShapeIndex: ReturnType<typeof compileFamilyComponentShapeIndex>,
): readonly Finding[] {
  const findings: Finding[] = [];
  const profileFields = profileFieldNames(profile);

  for (const capabilityId of capabilityIds) {
    const cap = family.capabilities.get(capabilityId);
    if (cap === undefined) continue;
    // 从目录读取的 ClassEntry 只有 id/参数/kernelOps；compositionKind/familyId/componentId 须从原始目录取。
    const rawCap = rawCapabilityEntry(profile, family, capabilityId);
    if (rawCap === undefined) continue;
    const familyId = rawCap['familyId'] as string | undefined;
    const componentId = rawCap['componentId'] as string | undefined;
    const compositionKind = rawCap['compositionKind'] as
      | 'static' | 'transient' | 'modified-explicit' | 'modified-capability' | undefined;

    const result = alignCapabilityToComponentContract(
      {
        capabilityId,
        familyId,
        componentId,
        compositionKind,
        declaredParameterSlots: new Set<string>([...cap.parameterNames, ...cap.parameters.map((p) => p.key)]),
        declaredKernelOps: new Set(cap.kernelOps),
      },
      (fid) => familyShapeIndex.get(fid) ?? null,
    );
    if (!result.ok) {
      for (const issue of result.issues) {
        findings.push(finding(
          issue.code,
          profile.sourceId,
          `/classComposition/${capabilityField}`,
          issue.reason,
        ));
      }
    }

    // 归属自洽（T-CaS-04 的 play 侧半环）：能力声明该族、且 ECS 族有 playLayerOwnedFieldNames 时，
    // profile 顶层实际写到的字段必须落在「ECS 组件参数 ∪ ECS 单一源 playLayerOwnedFieldNames」内。
    if (familyId !== undefined) {
      const sourceFamily = familyShapeIndex.get(familyId);
      const singleSourceOwned = new Set<string>();
      // 单一源登记的第一优先：CompositionShape.playLayerOwnedFieldNames（T-CaS-04 收敛后的唯一权威）。
      for (const shape of COMPOSITION_REGISTRY.listShapes()) {
        if (shape.familyId !== familyId) continue;
        for (const field of shape.playLayerOwnedFieldNames) singleSourceOwned.add(field);
      }
      if (sourceFamily !== undefined) {
        const owned = new Set<string>();
        for (const component of sourceFamily.components) {
          for (const field of component.parameters) owned.add(field.name);
        }
        // 组件参数集始终并入：ECS 组件的可配置字段由组件契约声明，与归属字段名正交；
        // 类目录 compositionContract.playLayerOwnedFieldNames 作为兼容回退一并并入。
        const combined = new Set([...owned, ...family.contract.playLayerOwnedFields, ...singleSourceOwned]);
        for (const field of profileFields) {
          if (field === 'classComposition' || field === 'id' || field === 'name' || field === 'description') continue;
          if (combined.has(field)) continue;
          // 非归属字段但显式被能力参数声明的也放行（参数本身就是可配置槽位）。
          if (cap.parameterNames.has(field) || cap.parameters.some((p) => p.key === field)) continue;
          findings.push(finding('ECS_ALIGN_FIELD_NOT_OWNED', profile.sourceId, `/${field}`,
            `字段 ${field} 既不在 ECS 组件 ${sourceFamily.components.map((c) => c.id).join(', ')} 的参数集，`
            + `也不在玩法层归属字段集（ECS 单一源 CompositionShape.playLayerOwnedFieldNames）内，无法由任何已组合能力支撑。`));
        }
      }
    }
  }

  return findings;
}

/** 从 profile 的 classComposition 出发解析当前族目录中该能力条目的原始声明。 */
function rawCapabilityEntry(
  profile: PlayProfile,
  family: ClassFamily,
  capabilityId: string,
): Readonly<Record<string, JsonValue>> | undefined {
  // catalog.ts 已把 capabilities 读成 ClassEntry（去掉 compositionKind/familyId/componentId）。
  // 这里直接读原始 class/*/index.json 的能力条目，避免改动 catalog.ts 的读取契约。
  const raw = profileRawCatalogEntry(profile.sourceId);
  if (raw === undefined) return undefined;
  const caps = raw['capabilities'];
  if (!Array.isArray(caps)) return undefined;
  for (const entry of caps) {
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      const record = entry as Record<string, JsonValue>;
      if (record['id'] === capabilityId) return record;
    }
  }
  return undefined;
}

/** 读一份原始 class 目录的 index.json（只读，读入内存后即弃，不改磁盘数据）。 */
function profileRawCatalogEntry(sourceId: string): Readonly<Record<string, JsonValue>> | undefined {
  // sourceId 形如 `weapons/wp_fists.json`，前半段是目录名。
  const slash = sourceId.indexOf('/');
  const dir = slash === -1 ? sourceId : sourceId.slice(0, slash);
  try {
    const text = readFileSync(join(CLASS_ROOT, dir, 'index.json'), 'utf8');
    return JSON.parse(text) as Readonly<Record<string, JsonValue>>;
  } catch {
    return undefined;
  }
}

/** profile 文档顶层的全部字段名（含 classComposition 本身，后续按字段排除）。 */
function profileFieldNames(profile: PlayProfile): ReadonlySet<string> {
  return new Set(Object.keys(profile.document));
}

/** ECS 组件契约单一源的族形状索引（compileFamilyComponentShapeIndex 的确定性快照，惰性缓存）。 */
let cachedFamilyShapeIndex: ReturnType<typeof compileFamilyComponentShapeIndex> | undefined;
function familyShapeIndex(): ReturnType<typeof compileFamilyComponentShapeIndex> {
  cachedFamilyShapeIndex ??= compileFamilyComponentShapeIndex();
  return cachedFamilyShapeIndex;
}

/** 契约声明的字段既可能是单个 id，也可能是 id 数组；两种形态都归一成数组。 */
function referencedIds(
  composition: Readonly<Record<string, JsonValue>>,
  field: string | undefined,
): readonly string[] {
  if (field === undefined) return [];
  const value = composition[field];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

/**
 * 所选类决定了可组合的能力边界：`requiredCapabilityIds` 必须全部组合，
 * 组合的每个能力必须落在 required ∪ optional 之内。越过这条边界等于绕过组合契约。
 */
function auditCapabilityScope(
  profile: PlayProfile,
  family: ClassFamily,
  classIds: readonly string[],
  capabilityIds: readonly string[],
  capabilityField: string,
  findings: Finding[],
): void {
  const required = new Set<string>();
  const allowed = new Set<string>();
  for (const classId of classIds) {
    const entry = family.classes.get(classId);
    if (entry === undefined) continue;
    for (const capability of entry.requiredCapabilityIds) {
      required.add(capability);
      allowed.add(capability);
    }
    for (const capability of entry.optionalCapabilityIds) allowed.add(capability);
  }
  if (allowed.size === 0) return;

  capabilityIds.forEach((capability, position) => {
    if (!allowed.has(capability)) {
      findings.push(finding('PLAY-REF-CAPABILITY-SCOPE', profile.sourceId,
        `/classComposition/${capabilityField}/${position}`,
        `能力 ${capability} 不在所选类允许的能力集合内`));
    }
  });

  const composed = new Set(capabilityIds);
  const missing = [...required].filter((capability) => !composed.has(capability)).sort();
  if (missing.length > 0) {
    findings.push(finding('PLAY-REF-CAPABILITY-REQUIRED', profile.sourceId,
      `/classComposition/${capabilityField}`,
      `所选类要求必须组合的能力尚未声明: ${missing.join(', ')}`));
  }
}

/**
 * 武器还要校验伤害结算类，以及重量与射程档位的 token。
 * 2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）：谱型类（攻击形状/形状轴）校验已删除，
 * 判定为冗余设计，已被武器属性（散射/扫射/连发，走通用能力校验 `auditCapabilityScope`）完全覆盖。
 * 详见 docs/L0_规范宪法.md、docs/L2_基类层/基类层定义.md §4.3 最新权威内容。
 */
function auditWeaponComposition(
  profile: PlayProfile,
  composition: Readonly<Record<string, JsonValue>>,
  contract: ClassFamily['contract'],
  index: ClassLayerIndex,
  findings: Finding[],
): void {
  const { sourceId, document } = profile;
  const damageField = contract.damageClassField ?? 'damageClassId';
  checkMember(index.damageClasses, composition[damageField], 'PLAY-REF-DAMAGE-CLASS',
    sourceId, `/classComposition/${damageField}`, '伤害结算类目录', findings);

  const tiers: readonly (readonly [string, ReadonlySet<string>, string])[] = [
    ['weightClass', index.weightTierTokens, '重量档位'],
    ['rangeClass', index.rangeTierTokens, '射程档位'],
  ];
  for (const [field, tokens, label] of tiers) {
    const value = document[field];
    if (typeof value === 'string' && !tokens.has(value)) {
      findings.push(finding('PLAY-REF-TIER-TOKEN', sourceId, `/${field}`,
        `${label}目录没有 token 为 ${value} 的档位`));
    }
  }
}

// ---------------------------------------------------------------------------
// 3. 玩法层内部实例与状态引用完整性
// ---------------------------------------------------------------------------

/** 一处指向玩法层实例或状态语义的引用。 */
interface ReferenceSite {
  readonly jsonPath: string;
  readonly value: string;
}

function collectStatusReferences(profile: PlayProfile): readonly ReferenceSite[] {
  const sites: ReferenceSite[] = [];
  const { document } = profile;

  optionalArray(document, 'grantedStates').forEach((entry, index) => {
    if (typeof entry === 'string') {
      sites.push({ jsonPath: `/grantedStates/${index}`, value: entry });
      return;
    }
    const record = asRecord(entry);
    if (record === undefined) return;
    const id = record['id'];
    if (typeof id === 'string') sites.push({ jsonPath: `/grantedStates/${index}/id`, value: id });
  });

  const breakCondition = asRecord(document['breakCondition']);
  if (breakCondition !== undefined && typeof breakCondition['status'] === 'string') {
    sites.push({ jsonPath: '/breakCondition/status', value: breakCondition['status'] });
  }

  optionalArray(document, 'breakConditions').forEach((entry, index) => {
    const record = asRecord(entry);
    const status = record?.['status'];
    if (typeof status === 'string') {
      sites.push({ jsonPath: `/breakConditions/${index}/status`, value: status });
    }
  });

  optionalArray(document, 'interactionMatrix').forEach((entry, index) => {
    const record = asRecord(entry);
    const other = record?.['with'];
    if (typeof other === 'string') {
      sites.push({ jsonPath: `/interactionMatrix/${index}/with`, value: other });
    }
  });

  const prerequisiteState = (action: Readonly<Record<string, JsonValue>>): string | undefined => {
    const prerequisite = asRecord(action['prerequisite']);
    const state = prerequisite?.['state'];
    return typeof state === 'string' ? state : undefined;
  };

  forEachAction(profile, (action, actionPath) => {
    const state = prerequisiteState(action);
    if (state !== undefined) sites.push({ jsonPath: `${actionPath}/prerequisite/state`, value: state });

    optionalArray(action, 'effects').forEach((entry, effectIndex) => {
      const effect = asRecord(entry);
      if (effect === undefined) return;
      const effectPath = `${actionPath}/effects/${effectIndex}`;
      for (const field of ['def', 'status', 'attachmentClassId'] as const) {
        const value = effect[field];
        if (typeof value === 'string') sites.push({ jsonPath: `${effectPath}/${field}`, value });
      }
    });
  });

  return sites;
}

/**
 * 校验状态引用全部落在基类层状态语义目录内，实例引用全部落在玩法层已登记实例内。
 * 已在 `known-divergences.ts` 登记的悬空引用会被单独返回，供测试与登记表做等值比较。
 */
export interface ReferenceAuditResult {
  /** 未登记的悬空引用。 */
  readonly dangling: readonly Finding[];
  /** 实际检测到的悬空实例引用键，形如 `npcs/x.json/initialEquipment/0=weapon_claws`。 */
  readonly danglingInstanceKeys: readonly string[];
}

function instanceReferenceKey(sourceId: string, jsonPath: string, value: string): string {
  return `${sourceId}${jsonPath}=${value}`;
}

export function auditProfileReferences(
  profiles: readonly PlayProfile[],
  index: ClassLayerIndex,
  instanceIds: ReadonlySet<string>,
): ReferenceAuditResult {
  const dangling: Finding[] = [];
  const danglingInstanceKeys: string[] = [];

  for (const profile of profiles) {
    for (const site of collectStatusReferences(profile)) {
      if (!index.statuses.classes.has(site.value)) {
        dangling.push(finding('PLAY-REF-STATUS-DANGLING', profile.sourceId, site.jsonPath,
          `状态语义目录未登记 ${site.value}`));
      }
    }

    stringsOf(profile.document, 'initialEquipment').forEach((reference, position) => {
      const jsonPath = `/initialEquipment/${position}`;
      if (instanceIds.has(reference)) return;
      danglingInstanceKeys.push(instanceReferenceKey(profile.sourceId, jsonPath, reference));
      dangling.push(finding('PLAY-REF-INSTANCE-DANGLING', profile.sourceId, jsonPath,
        `玩法层没有登记 id 为 ${reference} 的实例`));
    });
  }

  return {
    dangling: sortFindings(dangling),
    danglingInstanceKeys: [...danglingInstanceKeys].sort((left, right) => left.localeCompare(right, 'en')),
  };
}

// ---------------------------------------------------------------------------
// 4. 引擎 Op 声明一致性
// ---------------------------------------------------------------------------

/** profile 级别声明已用 Op 的字段名。载具沿用既有的 `kernelTopologyOps`。 */
export function declaredOpsField(category: PlayProfile['category']): string {
  return category === 'vehicles' ? 'kernelTopologyOps' : 'kernelOps';
}

/**
 * 已声明但尚未由任何 effect 落地的 Op 放在该字段。
 *
 * 这是本次审计引入的字段（自主设计，见审计报告）：消耗品的 `list.remove`、装备的 `tag.add`
 * 原先混在 `kernelOps` 里，使"声明的 Op 必须与 effects 完全一致"这条不变量无法成立；
 * 直接删掉又会抹掉"消耗与装备打标签仍待建模"这一已知意图。拆成独立字段后两者都能保留：
 * `kernelOps` 严格等于 effects 实际使用的 Op，`pendingKernelOps` 记录尚未建模的 Op。
 */
export const PENDING_OPS_FIELD = 'pendingKernelOps';

interface OpSite {
  readonly jsonPath: string;
  readonly op: string;
}

function collectActionOpSites(
  action: Readonly<Record<string, JsonValue>>,
  actionPath: string,
): readonly OpSite[] {
  const sites: OpSite[] = [];
  optionalArray(action, 'effects').forEach((entry, index) => {
    const effect = asRecord(entry);
    const op = effect?.['op'];
    if (typeof op === 'string') sites.push({ jsonPath: `${actionPath}/effects/${index}/op`, op });
  });
  return sites;
}

/** 状态 profile 的效果按钩子名分组，形如 `effects.onTurnEnd.op`。 */
function collectStatusOpSites(profile: PlayProfile): readonly OpSite[] {
  const sites: OpSite[] = [];
  const effects = optionalObject(profile.document, 'effects');
  if (effects === undefined) return sites;
  for (const [hook, value] of Object.entries(effects)) {
    const record = asRecord(value);
    const op = record?.['op'];
    if (typeof op === 'string') sites.push({ jsonPath: `/effects/${hook}/op`, op });
  }
  return sites;
}

/** profile 内所有 effect 实际引用的 Op 位置。 */
export function collectUsedOpSites(profile: PlayProfile): readonly OpSite[] {
  const sites: OpSite[] = [...collectStatusOpSites(profile)];
  forEachAction(profile, (action, actionPath) => {
    sites.push(...collectActionOpSites(action, actionPath));
  });
  return sites;
}

function sortedUnique(values: Iterable<string>): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}

function describeSetDifference(label: string, values: readonly string[]): string {
  return `${label}: ${values.join(', ')}`;
}

/**
 * 校验三件事：
 *  1. 每个动作必须用 `kernelOps` 数组声明 Op，且该集合与 effects 实际使用的 Op 完全一致；
 *  2. profile 级声明的 Op 集合等于全部 effects 使用的 Op 集合，`pendingKernelOps` 与之不相交；
 *  3. 声明与使用的每个 Op 名都已在引擎注册表登记（宪法四·4.1 唯一写入通道）。
 */
export function auditKernelOpDeclarations(
  profiles: readonly PlayProfile[],
  registeredOps: ReadonlySet<string>,
): readonly Finding[] {
  const findings: Finding[] = [];

  for (const profile of profiles) {
    const { sourceId, document } = profile;

    forEachAction(profile, (action, actionPath) => {
      if (typeof action['kernelOp'] === 'string') {
        findings.push(finding('PLAY-OP-SINGULAR-FIELD', sourceId, `${actionPath}/kernelOp`,
          '动作必须用 kernelOps 数组声明全部 Op；单数 kernelOp 只能记录一个，会漏掉其余 effect 的 Op'));
      }
      const used = sortedUnique(collectActionOpSites(action, actionPath).map((site) => site.op));
      const declaredValue = action['kernelOps'];
      if (used.length === 0 && declaredValue === undefined) return;
      if (!Array.isArray(declaredValue)) {
        findings.push(finding('PLAY-OP-ACTION-UNDECLARED', sourceId, `${actionPath}/kernelOps`,
          `动作使用了 Op ${used.join(', ')} 但没有 kernelOps 声明`));
        return;
      }
      const declared = sortedUnique(stringsOf(action, 'kernelOps'));
      const missing = used.filter((op) => !declared.includes(op));
      const extra = declared.filter((op) => !used.includes(op));
      if (missing.length > 0 || extra.length > 0) {
        findings.push(finding('PLAY-OP-ACTION-MISMATCH', sourceId, `${actionPath}/kernelOps`,
          `动作 kernelOps 必须与 effects 使用的 Op 完全一致；`
          + `${describeSetDifference('缺少', missing)}；${describeSetDifference('多余', extra)}`));
      }
    });

    const usedSites = collectUsedOpSites(profile);
    const used = sortedUnique(usedSites.map((site) => site.op));
    const field = declaredOpsField(profile.category);
    const declaredValue = document[field];
    const pending = sortedUnique(stringsOf(document, PENDING_OPS_FIELD));

    if (used.length > 0 && !Array.isArray(declaredValue)) {
      findings.push(finding('PLAY-OP-PROFILE-UNDECLARED', sourceId, `/${field}`,
        `profile 使用了 Op ${used.join(', ')} 但没有 ${field} 声明`));
    } else if (Array.isArray(declaredValue)) {
      const declared = sortedUnique(stringsOf(document, field));
      const missing = used.filter((op) => !declared.includes(op));
      const extra = declared.filter((op) => !used.includes(op));
      if (missing.length > 0 || extra.length > 0) {
        findings.push(finding('PLAY-OP-PROFILE-MISMATCH', sourceId, `/${field}`,
          `${field} 必须等于全部 effects 使用的 Op 集合；`
          + `${describeSetDifference('缺少', missing)}；`
          + `${describeSetDifference('多余（若属尚未建模的 Op，请移入 ' + PENDING_OPS_FIELD + '）', extra)}`));
      }
    }

    const overlapping = pending.filter((op) => used.includes(op));
    if (overlapping.length > 0) {
      findings.push(finding('PLAY-OP-PENDING-OVERLAP', sourceId, `/${PENDING_OPS_FIELD}`,
        `${PENDING_OPS_FIELD} 只能列尚未被任何 effect 使用的 Op；`
        + `${describeSetDifference('已被使用', overlapping)}`));
    }

    for (const site of usedSites) {
      if (!registeredOps.has(site.op)) {
        findings.push(finding('PLAY-OP-UNREGISTERED', sourceId, site.jsonPath,
          `引擎注册表没有 Op ${site.op}；玩法层不得引用未注册的写入通道`));
      }
    }
    const declarationSites: readonly OpSite[] = [
      ...sortedUnique(stringsOf(document, field)).map((op) => ({ jsonPath: `/${field}`, op })),
      ...pending.map((op) => ({ jsonPath: `/${PENDING_OPS_FIELD}`, op })),
    ];
    for (const site of declarationSites) {
      if (!registeredOps.has(site.op)) {
        findings.push(finding('PLAY-OP-UNREGISTERED', sourceId, site.jsonPath,
          `引擎注册表没有 Op ${site.op}；玩法层不得声明未注册的写入通道`));
      }
    }
  }

  return sortFindings(findings);
}

// ---------------------------------------------------------------------------
// 5. 动作成本契约（Paid_Action 单 AP）
// ---------------------------------------------------------------------------

/**
 * L2 需求 6.2 与 6.4：一个 Paid_Action 只消耗一个 AP 单位；需要多个 AP 的交互必须表达为
 * 有序的多步 Paid_Action 序列，并给出显式的中间状态。因此玩法层动作的 `apCost` 只能是 1，
 * 而序列的后续步骤用 `prerequisite` 声明它依赖的中间状态。
 */
export function auditActionCosts(profiles: readonly PlayProfile[]): readonly Finding[] {
  const findings: Finding[] = [];
  for (const profile of profiles) {
    forEachAction(profile, (action, actionPath) => {
      const apCost = action['apCost'];
      if (apCost === undefined) {
        findings.push(finding('PLAY-ACTION-NO-COST', profile.sourceId, `${actionPath}/apCost`,
          '动作必须声明 apCost；零 AP 的附属动作也要显式写出 0 并声明其依附的 Paid_Action'));
        return;
      }
      if (typeof apCost !== 'number' || !Number.isInteger(apCost)) {
        findings.push(finding('PLAY-ACTION-COST-SHAPE', profile.sourceId, `${actionPath}/apCost`,
          `apCost 必须是整数，实际为 ${JSON.stringify(apCost)}`));
        return;
      }
      if (apCost > 1) {
        findings.push(finding('PLAY-ACTION-MULTI-AP', profile.sourceId, `${actionPath}/apCost`,
          `apCost=${apCost} 把多个 AP 打包成一次原子动作；按 L2 需求 6.4 必须拆成有序的多步 `
          + `1 AP 动作，并用 prerequisite 声明中间状态`));
      }
    });
  }
  return sortFindings(findings);
}

// ---------------------------------------------------------------------------
// 6. 五并列原则
// ---------------------------------------------------------------------------

/** 宪法四·4.3：玩家同时面对的选项不超过 5。 */
export const PARALLEL_LIMIT = 5;

/**
 * 动作的"面对上下文"。同一载具的动作并不同时出现在一个玩家的选项里——车外的人看不到下车，
 * 驾驶者看不到上车。按前置条件把动作归入互斥上下文后再计数，才是这条原则真正约束的对象。
 */
type ActionContext = 'inside-driver' | 'inside-occupant' | 'outside' | 'unscoped';

const OUTSIDE_PRECONDITIONS = new Set([
  'adjacent_to_vehicle',
  'target_vehicle_adjacent',
  'character_not_in_vehicle',
  'vehicle_has_seat_available',
]);

const INSIDE_PRECONDITIONS = new Set([
  'in_vehicle',
  'in_medical_bay_seat',
  'target_in_same_vehicle',
]);

function actionContext(action: Readonly<Record<string, JsonValue>>): ActionContext {
  const types = optionalArray(action, 'preconditions')
    .map((entry) => asRecord(entry)?.['type'])
    .filter((value): value is string => typeof value === 'string');
  if (types.length === 0) return 'unscoped';
  // 车外条件优先：`vehicle_pull_out` 同时带 target_in_vehicle 与 adjacent_to_vehicle，
  // 发起者站在车外，因此归入车外上下文。
  if (types.some((type) => OUTSIDE_PRECONDITIONS.has(type))) return 'outside';
  if (types.some((type) => type === 'seat_role')) return 'inside-driver';
  if (types.some((type) => INSIDE_PRECONDITIONS.has(type))) return 'inside-occupant';
  return 'unscoped';
}

/** 由 `prerequisite` 门控的动作是多步序列的后续步骤，它替换前一步而不是新增一个并列选项。 */
function isSequenceContinuation(action: Readonly<Record<string, JsonValue>>): boolean {
  return asRecord(action['prerequisite']) !== undefined;
}

export function auditFiveParallel(profiles: readonly PlayProfile[]): readonly Finding[] {
  const findings: Finding[] = [];

  for (const profile of profiles) {
    const { sourceId, document } = profile;

    const seats = optionalArray(document, 'seats');
    if (seats.length > PARALLEL_LIMIT) {
      findings.push(finding('PLAY-PARALLEL-SEATS', sourceId, '/seats',
        `座位数 ${seats.length} 超过五并列上限 ${PARALLEL_LIMIT}`));
    }

    // 2026-08-08 权威变更：谱型组合数（形状轴）的五并列检查已删除，攻击形状/形状轴判定为冗余
    // 设计，已被武器属性完全覆盖，武器属性走能力组合校验而非独立数组，见 auditCapabilityScope。

    const perContext = new Map<ActionContext, number>();
    forEachAction(profile, (action) => {
      if (isSequenceContinuation(action)) return;
      const context = actionContext(action);
      perContext.set(context, (perContext.get(context) ?? 0) + 1);
    });
    for (const [context, count] of [...perContext].sort(([left], [right]) => left.localeCompare(right, 'en'))) {
      if (count > PARALLEL_LIMIT) {
        findings.push(finding('PLAY-PARALLEL-ACTIONS', sourceId, `/actions[${context}]`,
          `${context} 上下文同时提供 ${count} 个动作，超过五并列上限 ${PARALLEL_LIMIT}`));
      }
    }

    const interactionsByType = new Map<string, number>();
    optionalArray(document, 'interactions').forEach((entry) => {
      const type = asRecord(entry)?.['type'];
      const key = typeof type === 'string' ? type : 'untyped';
      interactionsByType.set(key, (interactionsByType.get(key) ?? 0) + 1);
    });
    for (const [type, count] of [...interactionsByType]
      .sort(([left], [right]) => left.localeCompare(right, 'en'))) {
      if (count > PARALLEL_LIMIT) {
        findings.push(finding('PLAY-PARALLEL-INTERACTIONS', sourceId, `/interactions[${type}]`,
          `${type} 类交互点提供 ${count} 个并列目标，超过五并列上限 ${PARALLEL_LIMIT}`));
      }
    }
  }

  return sortFindings(findings);
}

// ---------------------------------------------------------------------------
// 7. 载具参数与所组合能力的对应关系
// ---------------------------------------------------------------------------

/** 身份与表现字段，不由任何能力声明，也不参与参数支撑校验。 */
const VEHICLE_META_FIELDS = new Set([
  'id',
  'name',
  'description',
  'tags',
  'classComposition',
  'metadata',
  'kernelTopologyOps',
  'pendingKernelOps',
  'pendingKernelOpsNote',
  'unresolvedIssues',
  // D-038 裁决：载具内部不建模为微型场景（interior.isMicroScene 固定为 false）。
  // interior 块是架构声明字段（isMicroScene/interactionModel/note），不是玩法参数，
  // 因此不受能力支撑校验约束——同 metadata/description/tags 同类处理。
  'interior',
  // 驾驶移动效果块与特殊能力列表：二者是玩法层的整块布局配置，不逐能力叶判归属。
  // `moveEffect`（apCost/range/description）与 `specialAbilities`（特殊行为 id 清单）在载具
  // profile 里是组合多个能力的统一承载面；基类层把移动收敛为 `drive` 的 speed/moveApCost、
  // 把特殊行为并入各能力的 configurableParameters。因此免去逐叶能力支撑。归属争议（是否把这两块
  // 补入基类层 compositionContract.playLayerOwnedFieldNames）登记在 known-divergences 的
  // VEHICLE-COMPOSITE-FIELD-BACKING，交由 L2 线决策，不在此越权修改基类层。
  'moveEffect',
  'specialAbilities',
]);

/** 纯说明性子字段；出现在任何层级都不需要能力支撑。 */
const PRESENTATION_LEAVES = new Set(['description', 'note', 'label', 'notes']);

/**
 * 显式声明"不具备该能力"的取值。`canLock: false`（电瓶车不能上锁）与
 * `cargo.accessibleFrom: "none"`（装甲车没有货舱）都是在声明能力缺席，而不是在配置能力；
 * 因此不要求组合对应能力。把这条写成通用规则而不是逐个例外，才能让约束继续对新 profile 生效。
 */
function declaresAbsence(value: JsonValue | undefined): boolean {
  return value === false || value === 'none';
}

/**
 * 校验载具 profile 设置的每个参数都有对应的已组合类或能力声明它可配置。
 * 这条约束把"组合关系"从一份 id 清单变成真正的配置权限边界：没有组合 `cargo` 能力就不能填货舱，
 * 没有组合 `armor` 能力就不能填装甲评级。
 */
export function auditVehicleParameterBacking(
  profiles: readonly PlayProfile[],
  index: ClassLayerIndex,
): readonly Finding[] {
  const findings: Finding[] = [];

  for (const profile of profiles.filter((candidate) => candidate.category === 'vehicles')) {
    const { sourceId, document } = profile;
    const composition = optionalObject(document, 'classComposition');
    if (composition === undefined) continue;

    const family = index.vehicles;
    const allowed = new Set<string>(family.contract.playLayerOwnedFields);
    for (const classId of referencedIds(composition, family.contract.classField ?? 'classIds')) {
      for (const parameter of family.classes.get(classId)?.parameterNames ?? []) allowed.add(parameter);
    }
    for (const capabilityId of referencedIds(composition, family.contract.capabilityField ?? 'capabilityIds')) {
      for (const parameter of family.capabilities.get(capabilityId)?.parameterNames ?? []) {
        allowed.add(parameter);
      }
    }

    for (const [field, value] of Object.entries(document)) {
      if (VEHICLE_META_FIELDS.has(field)) continue;
      if (allowed.has(field)) continue;
      if (declaresAbsence(value)) continue;

      const nested = asRecord(value);
      if (nested !== undefined) {
        for (const [child, childValue] of Object.entries(nested)) {
          if (PRESENTATION_LEAVES.has(child)) continue;
          if (allowed.has(`${field}.${child}`) || allowed.has(field)) continue;
          if (declaresAbsence(childValue)) continue;
          findings.push(finding('PLAY-VEHICLE-PARAM-UNBACKED', sourceId, `/${field}/${child}`,
            `参数 ${field}.${child} 没有任何已组合的载具类或能力声明它可配置`));
        }
        continue;
      }

      findings.push(finding('PLAY-VEHICLE-PARAM-UNBACKED', sourceId, `/${field}`,
        `参数 ${field} 没有任何已组合的载具类或能力声明它可配置`));
    }
  }

  return sortFindings(findings);
}

export type { Finding as AuditFinding };

/**
 * 2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）：`auditSpectrumAxes` 已删除。
 * 攻击形状/形状轴（含 exactly-one 形状轴基数约束）判定为冗余设计，已被武器属性
 * （散射/扫射/连发，走通用能力组合校验 `auditCapabilityScope`）完全覆盖，不再需要独立的
 * 轴基数校验。详见 `docs/L0_规范宪法.md`、`docs/L2_基类层/基类层定义.md` §4.3 最新权威内容。
 */

// ---------------------------------------------------------------------------
// 9. 能力参数绑定
// ---------------------------------------------------------------------------

/** 基类层为各语义族声明的参数绑定字段名（`compositionContract.parameterBindingField`）。 */
const PARAMETER_BINDING_FIELD: Readonly<Record<PlayProfile['category'], string>> = {
  weapons: 'weaponParameters',
  items: 'itemParameters',
  npcs: 'behaviorParameters',
  // 载具不参与能力参数绑定校验。依据：基类层 `src/class/vehicles/index.json` 的载具能力用
  // `parameters[]` 声明的是「字段名」槽（hp/maxHp/cargoCapacity/moveApCost 等），但这些字段名
  // 指向的是 profile 上**不存在**的顶层键（实际数据以嵌套块 cargo/moveEffect 承载），也缺少
  // 多个能力所需的 occupantDisposition/cargoDisposition 等必填字段名。把这些绑定补齐要么需要
  // 改基类层参数声明（carries 语义），要么需要在玩法层新增冗余字段。二者都超出本线
  // （玩法层数据契约线）的白名单/职责，故载具的玩法参数改用 `auditVehicleParameterBacking`
  // 覆盖「组合了的能力能支撑其顶层参数」，能力参数绑定契约对载具暂不强制。
  vehicles: '',
  statuses: 'statusParameters',
};

/** 解析 `reference<xxx>` 形态的绑定值应落在哪个登记表。 */
function referenceRegistry(
  valueShape: string,
  index: ClassLayerIndex,
): { readonly registry: ReadonlySet<string>; readonly label: string } | undefined {
  const match = /^(?:array<)?reference<([a-z-]+)>/.exec(valueShape);
  switch (match?.[1]) {
    case 'damage-class': return { registry: index.damageClasses, label: '伤害结算类目录' };
    case 'damage-type': return { registry: index.damageTypes, label: '伤害类别目录' };
    case 'item-class': return { registry: index.itemClasses, label: '物品类目录' };
    case 'weight-tier': return { registry: new Set(index.weightTierIdByToken.values()), label: '负重档目录' };
    case 'range-tier': return { registry: new Set(index.rangeTierIdByToken.values()), label: '射程档目录' };
    default: return undefined;
  }
}

function bindingValues(value: JsonValue | undefined): readonly string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
  return [];
}

/**
 * 校验每个已组合能力的参数绑定：
 *  1. 必填参数必须出现在参数绑定字段里；
 *  2. 不得出现该能力未声明的参数键；
 *  3. `reference<...>` 形态的值必须解析到对应登记表；
 *  4. `field-name` 形态的值必须指向 profile 上真实存在的字段。
 *
 * 第 4 条是这套契约的关键：基类层用「字段名」而不是「取值」表达伤害量、射程、弹药消耗等，
 * 正是为了让取值留在玩法层。若字段名指向不存在的字段，取值就无处可寻，绑定形同虚设。
 */
export function auditCapabilityParameterBindings(
  profiles: readonly PlayProfile[],
  index: ClassLayerIndex,
): readonly Finding[] {
  const findings: Finding[] = [];

  for (const profile of profiles) {
    const { sourceId, document } = profile;
    const family = familyFor(index, profile.category);
    const composition = optionalObject(document, 'classComposition');
    if (composition === undefined) continue;

    const capabilityField = family.contract.capabilityField ?? 'capabilityIds';
    const capabilityIds = stringsOf(composition, capabilityField);
    if (capabilityIds.length === 0) continue;

    const bindingField = PARAMETER_BINDING_FIELD[profile.category];
    // 载具的 bindingField 为空（见 PARAMETER_BINDING_FIELD 注释）：载具参数改用
    // `auditVehicleParameterBacking` 覆盖，不强制能力参数绑定。此处直接短路，避免读到空字段名后
    // 对每个能力都报「缺少绑定分组」。
    if (bindingField === '' || bindingField === undefined) continue;
    const bindings = optionalObject(document, bindingField) ?? {};
    const composedIds = new Set(capabilityIds);

    for (const capabilityId of capabilityIds) {
      const capability = family.capabilities.get(capabilityId);
      if (capability === undefined || capability.parameters.length === 0) continue;
      const group = optionalObject(bindings, capabilityId);
      const groupPath = `/${bindingField}/${capabilityId}`;

      if (group === undefined) {
        const missing = capability.parameters.filter((parameter) => parameter.required);
        if (missing.length > 0) {
          findings.push(finding('PLAY-BIND-MISSING', sourceId, groupPath,
            `能力 ${capabilityId} 没有参数绑定分组；缺必填参数 `
            + `${missing.map((parameter) => parameter.key).join(', ')}`));
        }
        continue;
      }

      const declaredKeys = new Set(capability.parameters.map((parameter) => parameter.key));
      for (const parameter of capability.parameters) {
        const bound = group[parameter.key];
        if (bound === undefined) {
          if (parameter.required) {
            findings.push(finding('PLAY-BIND-MISSING', sourceId, `${groupPath}/${parameter.key}`,
              `能力 ${capabilityId} 的必填参数 ${parameter.key} 没有绑定`));
          }
          continue;
        }
        if (parameter.key === OPERATION_PARAMETER) {
          auditOperationBinding(profile, capabilityId, capability, groupPath, bound, findings);
          continue;
        }
        auditBindingValue(profile, groupPath, parameter, bound, index, findings);
      }
      for (const key of Object.keys(group)) {
        if (!declaredKeys.has(key)) {
          findings.push(finding('PLAY-BIND-UNDECLARED', sourceId, `${groupPath}/${key}`,
            `参数 ${key} 不属于能力 ${capabilityId} 声明的参数槽`));
        }
      }
    }

    for (const key of Object.keys(bindings)) {
      if (!composedIds.has(key)) {
        findings.push(finding('PLAY-BIND-UNDECLARED', sourceId, `/${bindingField}/${key}`,
          `${key} 不是本 profile 已组合的能力 id；参数绑定必须按能力 id 分组`));
      }
    }
  }

  return sortFindings(findings);
}

/** 校验单个绑定值：引用要能解析，字段名要指向真实存在的字段。 */
function auditBindingValue(
  profile: PlayProfile,
  groupPath: string,
  parameter: ParameterSpec,
  bound: JsonValue,
  index: ClassLayerIndex,
  findings: Finding[],
): void {
  const jsonPath = `${groupPath}/${parameter.key}`;
  const shape = parameter.valueShape;
  if (shape === undefined) return;

  const reference = referenceRegistry(shape, index);
  if (reference !== undefined) {
    const values = bindingValues(bound);
    if (values.length === 0) {
      findings.push(finding('PLAY-BIND-SHAPE', profile.sourceId, jsonPath,
        `参数 ${parameter.key} 需要 ${shape} 形态的引用，实际为 ${JSON.stringify(bound)}`));
      return;
    }
    for (const value of values) {
      if (!reference.registry.has(value)) {
        findings.push(finding('PLAY-BIND-REFERENCE', profile.sourceId, jsonPath,
          `${reference.label}未登记 ${value}`));
      }
    }
    return;
  }

  if (shape === 'field-name') {
    if (typeof bound !== 'string') {
      findings.push(finding('PLAY-BIND-SHAPE', profile.sourceId, jsonPath,
        `参数 ${parameter.key} 需要字段名，实际为 ${JSON.stringify(bound)}`));
      return;
    }
    if (profile.document[bound] === undefined) {
      findings.push(finding('PLAY-BIND-FIELD-MISSING', profile.sourceId, jsonPath,
        `参数 ${parameter.key} 指向字段 ${bound}，但该 profile 没有这个字段——`
        + `取值将无处可寻，绑定形同虚设`));
    }
  }

  if (shape === 'integer') {
    if (typeof bound !== 'number' || !Number.isInteger(bound)) {
      findings.push(finding('PLAY-BIND-SHAPE', profile.sourceId, jsonPath,
        `参数 ${parameter.key} 需要整数，实际为 ${JSON.stringify(bound)}`));
    }
  }
}

// ---------------------------------------------------------------------------
// 10. 目标绑定与禁用内容
// ---------------------------------------------------------------------------

/**
 * 远程攻击的目标选择必须由 `range` 与 effect 里的目标绑定共同表达，而不是再加一个 `target` 字段：
 * 用 `{target}` 的单体攻击不写 `target`（射程 + 单体绑定已经确定选择），
 * 用 `{targets}` 的多目标攻击必须写 `target: "area"`。
 */
export function auditTargetBinding(profiles: readonly PlayProfile[]): readonly Finding[] {
  const findings: Finding[] = [];

  for (const profile of profiles.filter((candidate) => candidate.category === 'weapons')) {
    const { sourceId, document } = profile;
    const range = document['range'];
    if (document['category'] !== 'firearm' || typeof range !== 'number' || range <= 1) continue;

    forEachAction(profile, (action, actionPath) => {
      const paths = optionalArray(action, 'effects')
        .map((entry) => asRecord(entry)?.['path'])
        .filter((value): value is string => typeof value === 'string');

      if (paths.some((path) => path.includes('{target}')) && action['target'] !== undefined) {
        findings.push(finding('PLAY-TARGET-REDUNDANT', sourceId, `${actionPath}/target`,
          '单体远程攻击不应再声明 target：射程与 {target} 绑定已经确定目标选择'));
      }
      if (paths.some((path) => path.includes('{targets}')) && action['target'] !== 'area') {
        findings.push(finding('PLAY-TARGET-AREA-MISSING', sourceId, `${actionPath}/target`,
          '使用 {targets} 多目标绑定的动作必须声明 target 为 area'));
      }
    });
  }

  return sortFindings(findings);
}

/**
 * 废用术语，写成转义码点：写成字面量会让本检测器成为仓库级术语守卫自己的命中项
 * （同 `src/play/core-mechanics/ownership.ts` 的处理）。
 * `\u6a21\u677f` = 废用的实例说法；`\u5185\u5bb9\u5c42` = 废用的基类层说法。
 */
const OBSOLETE_ARCHITECTURE_TERMS = new RegExp('\u6a21\u677f|\u5185\u5bb9\u5c42');

/** 已被裁决消解、不应再作为未决项留在 profile 里的主张。 */
const RESOLVED_CLAIM = /再次结算|重复结算/;

function visitStrings(
  value: JsonValue,
  path: string,
  visitor: (value: string, path: string) => void,
): void {
  if (typeof value === 'string') {
    visitor(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitStrings(entry, `${path}/${index}`, visitor));
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) visitStrings(child, `${path}/${key}`, visitor);
}

/**
 * 禁用内容检查：
 *  1. 玩法层不得用 `emit.*` 充当写入通道——行为必须映射到已注册的结构化 Op（宪法四·4.1）；
 *  2. 已裁决消解的主张不得继续挂在 `unresolvedIssues` 里冒充未决项；
 *  3. 不得出现废用架构术语（宪法一·术语铁律）。
 */
export function auditProhibitedContent(profiles: readonly PlayProfile[]): readonly Finding[] {
  const findings: Finding[] = [];

  for (const profile of profiles) {
    visitStrings(profile.document, '', (value, path) => {
      if (/\/op$/.test(path) && /^emit(?:\.|$)/.test(value)) {
        findings.push(finding('PLAY-CONTENT-EMIT-OP', profile.sourceId, path,
          `${value} 不是结构化 Op；玩法层的行为必须映射到已注册 Op，事件只能是 Op 的产物`));
      }
      if (path.includes('/unresolvedIssues/') && RESOLVED_CLAIM.test(value)) {
        findings.push(finding('PLAY-CONTENT-RESOLVED-CLAIM', profile.sourceId, path,
          `该主张已被裁决消解，不应继续作为未决项留存: ${value}`));
      }
      if (OBSOLETE_ARCHITECTURE_TERMS.test(value)) {
        findings.push(finding('PLAY-CONTENT-OBSOLETE-TERM', profile.sourceId, path,
          `出现废用架构术语: ${value}`));
      }
    });
  }

  return sortFindings(findings);
}

/** 各能力用同名参数 `operation` 声明"执行该能力结果的引擎层 Op"。 */
const OPERATION_PARAMETER = 'operation';

/**
 * `operation` 绑定的双向校验，这是整套参数绑定里最有价值的一条：
 *  - 必须落在**基类层为该能力声明的 kernelOps 白名单**内——否则玩法层就在用能力不允许的通道写入；
 *  - 必须落在**该 profile 自己声明的 Op 集合**（`kernelOps` ∪ `pendingKernelOps`）内——否则
 *    绑定声称要用某个 Op，而 profile 的 Op 清单里根本没有它，两份声明互相矛盾。
 *
 * 允许落在 `pendingKernelOps` 是有意的：护甲破损销毁本体、盾牌格挡扣耐久这类写入尚未建模，
 * 但能力契约已经要求指出将由哪个 Op 承担。指向一个已登记为"待建模"的 Op 是准确的描述。
 */
function auditOperationBinding(
  profile: PlayProfile,
  capabilityId: string,
  capability: ClassEntry,
  groupPath: string,
  bound: JsonValue,
  findings: Finding[],
): void {
  const jsonPath = `${groupPath}/${OPERATION_PARAMETER}`;
  if (typeof bound !== 'string') {
    findings.push(finding('PLAY-BIND-SHAPE', profile.sourceId, jsonPath,
      `operation 必须是单个 Op 名，实际为 ${JSON.stringify(bound)}`));
    return;
  }

  const allowed = capability.kernelOps;
  if (allowed.size > 0 && !allowed.has(bound)) {
    findings.push(finding('PLAY-BIND-OPERATION-NOT-ALLOWED', profile.sourceId, jsonPath,
      `能力 ${capabilityId} 只允许用 ${[...allowed].sort().join(', ')} 执行结果，绑定却是 ${bound}`));
  }

  const field = declaredOpsField(profile.category);
  const declared = new Set([
    ...stringsOf(profile.document, field),
    ...stringsOf(profile.document, PENDING_OPS_FIELD),
  ]);
  if (!declared.has(bound)) {
    findings.push(finding('PLAY-BIND-OPERATION-UNDECLARED', profile.sourceId, jsonPath,
      `绑定声称用 ${bound} 执行，但该 profile 的 ${field} 与 ${PENDING_OPS_FIELD} 都没有声明它`));
  }
}
