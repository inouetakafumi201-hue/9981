/**
 * WakeUp 基类层物品类型定义。
 *
 * 物品目录已与其他语义族统一为同一份目录形状，因此这里的类型是
 * `class-contract.ts` 通用目录类型的具名视图，而不是第二套平行定义——
 * 平行定义会让 JSON 契约与 TypeScript 契约各走一条链路并逐渐漂移。
 *
 * 此处只表达可组合的物品类、能力形状和配置槽位。
 * 具体物品、玩法数值、动作成本、效果参数及生成规则由玩法 profile 配置。
 */

import type {
  ClassCatalog,
  ClassCatalogCapability,
  ClassCatalogClassEntry,
  ClassCatalogParameter,
} from '../class-contract';

/** 可序列化、可扩展的能力配置。 */
export type ItemConfiguration = Readonly<Record<string, unknown>>;

/** 能力参数槽位的结构说明，不规定具体玩法取值。 */
export type ItemParameterShape = ClassCatalogParameter;

/** 物品类：声明引擎层定义种类、语义族、类型身份判据与必需/可选能力集合。 */
export type ItemClass = ClassCatalogClassEntry;

/** 可被物品类或玩法实例组合的能力形状。 */
export type ItemCapabilityShape = ClassCatalogCapability;

/** 玩法实例对基类层物品类和能力的组合引用。 */
export interface ItemClassComposition {
  /** 被组合的物品类标识。 */
  readonly classIds: ReadonlyArray<string>;
  /** 被组合的能力标识。 */
  readonly capabilityIds: ReadonlyArray<string>;
}

/** 基类层物品目录。 */
export interface ItemClassCatalog extends ClassCatalog {
  readonly category: 'items';
}
