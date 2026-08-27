import type { DefKind } from '../state/def';
import type { SourceRecord } from '../state/diagnostic';
import { compareCodePoints } from './json-codec';
import type { SemanticFamilyCriteria, SemanticFamilyRegistration } from './types';

/** Host misconfiguration. A candidate can never reach this path; only a host register call can. */
export class SemanticFamilyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SemanticFamilyError';
  }
}

/**
 * Extensible register of semantic families.
 *
 * The register is open by construction. A family qualifies when it is enumerable, composable and
 * independent of any specific gameplay profile; the known families are an initial listing rather than a
 * closed enumeration, so a qualifying new concept is accepted as long as it records the three-criteria
 * judgement and the source that justifies the classification.
 */
export class SemanticFamilyRegistry {
  private readonly families = new Map<string, SemanticFamilyRegistration>();

  register(registration: SemanticFamilyRegistration): void {
    const failed = failedCriteria(registration.criteria);
    if (failed.length > 0) {
      throw new SemanticFamilyError(
        `Family ${registration.id} fails the class-layer criteria: ${failed.join(', ')}`);
    }
    if (registration.classificationReason.trim().length === 0) {
      throw new SemanticFamilyError(`Family ${registration.id} has no classification reason`);
    }
    if (registration.allowedKinds.length === 0) {
      throw new SemanticFamilyError(`Family ${registration.id} declares no allowed Def kind`);
    }
    const existing = this.families.get(registration.id);
    if (existing) {
      throw new SemanticFamilyError(`Family ${registration.id} is already registered`);
    }
    this.families.set(registration.id, Object.freeze({
      ...registration,
      allowedKinds: Object.freeze([...registration.allowedKinds].sort(compareCodePoints)),
      criteria: Object.freeze({ ...registration.criteria }),
    }));
  }

  get(id: string): SemanticFamilyRegistration | null {
    return this.families.get(id) ?? null;
  }

  /** Deterministic view for the host, ordered by identifier code point. */
  toMap(): ReadonlyMap<string, SemanticFamilyRegistration> {
    const ordered = new Map<string, SemanticFamilyRegistration>();
    for (const id of [...this.families.keys()].sort(compareCodePoints)) {
      const registration = this.families.get(id);
      if (registration) ordered.set(id, registration);
    }
    return ordered;
  }
}

/** Names the criteria a proposal fails, so the rejection can say which judgement was not met. */
export function failedCriteria(criteria: SemanticFamilyCriteria): readonly string[] {
  const failed: string[] = [];
  if (!criteria.enumerable) failed.push('enumerable');
  if (!criteria.composable) failed.push('composable');
  if (!criteria.gameplayIndependent) failed.push('gameplayIndependent');
  return failed;
}

/** True when every one of the three criteria holds. */
export function satisfiesClassLayerCriteria(criteria: SemanticFamilyCriteria): boolean {
  return failedCriteria(criteria).length === 0;
}

interface KnownFamily {
  readonly id: string;
  readonly allowedKinds: readonly DefKind[];
  readonly reason: string;
}

/**
 * Families already identified as class-layer semantics.
 *
 * This is the initial listing named by the specification, not a ceiling: `SemanticFamilyRegistry`
 * accepts further families, and a definition may declare any registered family. The entries carry no
 * gameplay values and no gameplay rules, only the Def kinds each family may legally map onto.
 */
export const KNOWN_SEMANTIC_FAMILIES: readonly KnownFamily[] = Object.freeze([
  { id: 'action', allowedKinds: ['action'], reason: '动作契约可枚举、可与效果引用组合，且不绑定具体玩法。' },
  { id: 'gateway', allowedKinds: ['rule', 'action'], reason: '资源转换、检定与条件三类网关可枚举、可组合。' },
  { id: 'natural-scene', allowedKinds: ['node'], reason: '大中小天然场景类型可枚举、可与微型场景能力组合。' },
  { id: 'micro-scene', allowedKinds: ['node'], reason: '微型场景附属于天然场景，可枚举、可组合。' },
  { id: 'transition', allowedKinds: ['link'], reason: '过渡连接声明端点与通行条件接口，可枚举、可组合。' },
  { id: 'item', allowedKinds: ['item'], reason: '物品能力接口可枚举、可组合，不含具体玩法数值。' },
  { id: 'weapon', allowedKinds: ['item'], reason: '近战、非枪械远程与枪械类型可枚举，谱型经组合表达。' },
  { id: 'vehicle', allowedKinds: ['entity'], reason: '载具作为实体暴露座位与门引用接口，可枚举、可组合。' },
  { id: 'damage', allowedKinds: ['rule'], reason: '伤害类别与结算管线引用可枚举、可组合，不含伤害量。' },
  { id: 'status', allowedKinds: ['attachment', 'rule'], reason: '状态持续与叠加模式可枚举、可组合。' },
  { id: 'skill', allowedKinds: ['action', 'rule'], reason: '主动、被动与触发技能按激活语义可枚举、可组合。' },
  { id: 'movement', allowedKinds: ['action'], reason: '地面、载具与传送移动按通行语义可枚举、可组合。' },
  { id: 'attachment', allowedKinds: ['attachment'], reason: '附件宿主、来源与回收接口可枚举、可组合。' },
  { id: 'ai-behavior', allowedKinds: ['policy', 'decision'], reason: '行为状态与感知参数 Schema 可枚举、可组合。' },
]);

/**
 * Build a register seeded with the known families.
 *
 * The caller supplies the source record, because provenance belongs to the host that decided to adopt
 * the listing; the compiler must not invent a source for content it did not read.
 */
export function createSemanticFamilyRegistry(source: SourceRecord): SemanticFamilyRegistry {
  const registry = new SemanticFamilyRegistry();
  for (const family of KNOWN_SEMANTIC_FAMILIES) {
    registry.register({
      id: family.id,
      allowedKinds: family.allowedKinds,
      criteria: { enumerable: true, composable: true, gameplayIndependent: true },
      classificationReason: family.reason,
      source,
    });
  }
  return registry;
}
