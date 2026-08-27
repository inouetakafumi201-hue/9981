/**
 * 基类层目录装载入口。
 *
 * 这里只做两件事：
 * 1. 用内核严格 JSON 解析器读取正式数据（拒绝重复成员、危险键与越额输入）；
 * 2. 把统一形状的目录交给 `class-contract.ts` 做结构性契约校验，并返回深冻结结果。
 *
 * 语义护栏（数值归属、层级归属、伪子类型、跨目录引用）不在此处内联，
 * 而是由 `class-contract.ts` 的纯函数提供，便于对人造反例单独运行。
 */

import { StrictJsonCodec } from '../core/kernel/codec/index';
import type { JsonValue } from '../core/kernel/spec-compiler/types';
import { DEFAULT_TECHNICAL_QUOTAS } from '../core/kernel/security/index';
import { ClassCatalogContractError, deepFreeze } from './json-contract';
import { type ClassCatalog, parseClassCatalog } from './class-contract';
import type { ItemClassCatalog } from './items/item-types';

export { ClassCatalogContractError } from './json-contract';

/** 使用内核严格 JSON 解析器读取正式数据，拒绝重复成员、危险键和越额输入。 */
export function parseStrictDataJson(
  sourceText: string,
  sourceId: string,
  owningLayer: '基类层' | '玩法层',
): JsonValue {
  const parsed = new StrictJsonCodec().parse({
    sourceId,
    documentUri: sourceId,
    sourcePackage: owningLayer === '基类层' ? 'wakeup-class-catalog' : 'wakeup-play-profile',
    sourceText,
    precedence: 0,
    owningLayer,
    normativeStatus: 'normative',
  }, DEFAULT_TECHNICAL_QUOTAS);
  return deepFreeze(parsed.value) as JsonValue;
}

/** 使用严格数据解析链读取基类目录。 */
export function parseClassJson(sourceText: string, sourceId: string): JsonValue {
  return parseStrictDataJson(sourceText, sourceId, '基类层');
}

/**
 * 严格解析并运行时校验统一形状的基类目录，使 JSON 与 TypeScript 契约处于同一条链路。
 *
 * 适用于 actions、gateways、scenes、skills、movement、attachments、containers 与 items。
 * 其余目录保留各自的族特有结构，由测试中的族专用校验器覆盖。
 */
export function loadClassCatalog(sourceText: string, sourceId: string): ClassCatalog {
  return parseClassCatalog(parseClassJson(sourceText, sourceId), sourceId);
}

/** 严格解析并运行时校验物品基类目录。 */
export function parseItemClassCatalog(
  sourceText: string,
  sourceId = 'items/index.json',
): ItemClassCatalog {
  const catalog = loadClassCatalog(sourceText, sourceId);
  if (catalog.category !== 'items') {
    throw new ClassCatalogContractError('/category', 'must equal items');
  }
  return catalog as ItemClassCatalog;
}
