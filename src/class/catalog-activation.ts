/**
 * 基类层统一形状目录 → 规范编译器 的通用装载桥（tasks.md D-5）。
 *
 * 这是 `scene-catalog-activation.ts` 的泛化：任何由 `parseClassCatalog` 解析出的 `ClassCatalog`
 * （统一形状目录：actions/attachments/containers/gateways/items/movement/scenes/skills）都能经
 * `SpecificationCompiler.compileAndActivate`（targetLayer: '基类层'）走真实的原子激活/回滚管线。
 *
 * 支持把**多个目录合并为一次装载**，从而让跨目录的组合引用（一个目录的类引用另一个目录的能力）
 * 在同一个工作集里解析——这正是"整个基类层作为一次原子变更装载"的形态。
 *
 * 切片边界（实事求是）：
 *   - 只搬运"类 + 能力 + 类到能力的组合边"。类的 requiredCapabilityIds 与 optionalCapabilityIds
 *     合并映射为编译器 `components`（组合边），能力映射为 prefab 定义。
 *   - 结构边界数值归属（P3）、值集合、过渡端点/跨目录类引用作为具体引用、禁令（校验规则）、
 *     玩法层参数绑定，均**不在本切片**。
 *   - 只覆盖 8 个统一形状目录；5 个族特有目录（damage-types/npcs/statuses/vehicles/
 *     vulnerability-types/weapons）需各自的族专用解析，未接入。
 *
 * 两处自主映射判断（需人工复核）：
 *   A. 能力在编译器模型里统一登记为 `prefab` 定义、语义族 `l2.capability`（目录本身不给能力分配
 *      Def kind 与族）。
 *   B. 类的必需能力与可选能力合并为一条 `components` 组合边；required/optional 的区分不在本切片
 *      建模（属玩法层能力边界审计 C.3 的关注点）。
 *
 * 该文件只消费 spec-compiler 的公开 API 与 class-contract 的解析结果，不修改任一方交付物。
 */

import { createHash } from 'node:crypto';
import type { DefKind } from '../core/kernel/state/def';
import type { SourceRecord } from '../core/kernel/state/diagnostic';
import { InMemoryEmergencySink } from '../core/kernel/safety/fatal-boundary';
import {
  InMemoryArtifactStore,
  InMemorySpecificationRegistry,
  SchemaRegistry,
  SemanticFamilyRegistry,
  SpecificationCompiler,
} from '../core/kernel/spec-compiler/index';
import type {
  CandidateDocumentInput,
  CompilationResult,
  DefinitionSchema,
  FieldRule,
  SchemaVersion,
} from '../core/kernel/spec-compiler/index';
import type { ClassCatalog } from './class-contract';

/** 编译器 schema 契约版本；与目录数据版本（catalog.version）是两个独立的版本号。 */
export const CATALOG_COMPILER_SCHEMA_VERSION = '1.0.0';

/** 映射判断 A：全部能力统一登记为的语义族。 */
export const CATALOG_CAPABILITY_FAMILY = 'l2.capability';

/** 映射判断 A：能力映射到的 Def kind。 */
const CAPABILITY_DEF_KIND: DefKind = 'prefab';

/** 一个可被 JSON.stringify 的定义（测试可克隆并注入违规后再编译）。 */
export interface CatalogDefinitionDocument {
  readonly id: string;
  readonly kind: string;
  readonly abstract: boolean;
  readonly semanticFamily: string;
  readonly components?: readonly string[];
}

/** 可被 JSON.stringify 为 `sourceText` 的完整候选文档。 */
export interface CatalogDocument {
  readonly schemaVersion: string;
  readonly targetLayer: '基类层';
  readonly definitions: readonly CatalogDefinitionDocument[];
}

export interface CatalogCompilerHost {
  readonly compiler: SpecificationCompiler;
  readonly registry: InMemorySpecificationRegistry;
  readonly artifactStore: InMemoryArtifactStore;
  readonly schemaRegistry: SchemaRegistry;
}

/** 主机溯源来源：不是创作者输入，因此用零宽 span。形状与 spec-compiler 测试夹具一致。 */
function bridgeSource(): SourceRecord {
  const empty = createHash('sha256').update('', 'utf8').digest('hex');
  return {
    sourceId: 'src:catalog-bridge',
    documentUri: 'file:///src/class/catalog-activation.ts',
    sourcePackage: 'wakeup-class-catalog',
    contentHash: empty,
    precedence: 500,
    owningLayer: '基类层',
    normativeStatus: 'normative',
    span: {
      file: 'file:///src/class/catalog-activation.ts',
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
      sourceSliceHash: empty,
    },
  };
}

/**
 * 从若干目录派生语义族登记表。
 *
 * 类族的允许 Def kind 由声明它的类跨目录并集推导；能力族固定映射到 prefab。三判据一律取真——
 * 这不是臆断：统一目录的 `classificationEvidence` 三项已由 `class-contract.ts` 的加载器强制为
 * 全真，否则加载即失败。
 */
function buildFamilies(catalogs: readonly ClassCatalog[]): SemanticFamilyRegistry {
  const registry = new SemanticFamilyRegistry();
  const source = bridgeSource();
  const criteria = { enumerable: true, composable: true, gameplayIndependent: true } as const;

  const kindsByFamily = new Map<string, Set<DefKind>>();
  for (const catalog of catalogs) {
    for (const cls of catalog.classes) {
      const kinds = kindsByFamily.get(cls.semanticFamily) ?? new Set<DefKind>();
      kinds.add(cls.defKind);
      kindsByFamily.set(cls.semanticFamily, kinds);
    }
  }
  for (const [family, kinds] of [...kindsByFamily.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    registry.register({
      id: family,
      allowedKinds: [...kinds].sort(),
      criteria: { ...criteria },
      classificationReason: `基类族 ${family} 的可枚举、可组合、不含玩法语义三判据由目录 classificationEvidence 佐证。`,
      source,
    });
  }
  registry.register({
    id: CATALOG_CAPABILITY_FAMILY,
    allowedKinds: [CAPABILITY_DEF_KIND],
    criteria: { ...criteria },
    classificationReason: '可复用能力：可枚举、可与类组合、且不含具体玩法取值，作为可复用组合单元登记。',
    source,
  });
  return registry;
}

/** 为一组目录构建编译器 `SchemaVersion`。字段集刻意为空（语义内容全部走基础字段与组合边）。 */
export function buildCatalogSchemaVersion(catalogs: readonly ClassCatalog[]): SchemaVersion {
  const families = buildFamilies(catalogs);
  // 空字段集：组合会把组件 value 字段并入宿主，若能力与类都带同名字段，一个类组合多个能力就会
  // 触发 E_LOAD_COMPOSITION_CONFLICT。让能力只贡献组合"边"而不贡献字段，组合图才干净。
  const fields: Readonly<Record<string, FieldRule>> = {};

  const kinds = new Set<DefKind>([CAPABILITY_DEF_KIND]);
  for (const catalog of catalogs) {
    for (const cls of catalog.classes) kinds.add(cls.defKind);
  }
  const definitionSchemas = new Map<DefKind, DefinitionSchema>();
  for (const kind of [...kinds].sort()) {
    definitionSchemas.set(kind, { kind, semanticFamily: defaultFamilyForKind(kind, catalogs), fields });
  }
  return {
    version: CATALOG_COMPILER_SCHEMA_VERSION,
    definitionSchemas,
    integrationContracts: new Map(),
    semanticFamilies: families.toMap(),
  };
}

/** 某个 Def kind 的默认语义族：能力 kind → 能力族；其余取声明该 kind 的首个类的族。 */
function defaultFamilyForKind(kind: DefKind, catalogs: readonly ClassCatalog[]): string {
  if (kind === CAPABILITY_DEF_KIND) return CATALOG_CAPABILITY_FAMILY;
  for (const catalog of catalogs) {
    const cls = catalog.classes.find((entry) => entry.defKind === kind);
    if (cls) return cls.semanticFamily;
  }
  return CATALOG_CAPABILITY_FAMILY;
}

/**
 * 把若干已解析目录合并成一份编译器候选文档对象。
 *
 * 能力先于类排列只为可读性；编译器内部按标识规范化排序，文档内顺序不影响产物字节。
 * 全部定义的标识在基类层全局唯一（由 canonicalClassIds 保证），因此合并不产生重复标识。
 */
export function buildCatalogDocument(catalogs: readonly ClassCatalog[]): CatalogDocument {
  const definitions: CatalogDefinitionDocument[] = [];
  for (const catalog of catalogs) {
    for (const capability of catalog.capabilities) {
      definitions.push({
        id: capability.id,
        kind: CAPABILITY_DEF_KIND,
        abstract: true,
        semanticFamily: CATALOG_CAPABILITY_FAMILY,
      });
    }
  }
  for (const catalog of catalogs) {
    for (const cls of catalog.classes) {
      definitions.push({
        id: cls.id,
        kind: cls.defKind,
        abstract: true,
        semanticFamily: cls.semanticFamily,
        // 映射判断 B：必需能力与可选能力都表达为组合组件（组合承载能力）。
        components: [...cls.requiredCapabilityIds, ...cls.optionalCapabilityIds],
      });
    }
  }
  return { schemaVersion: CATALOG_COMPILER_SCHEMA_VERSION, targetLayer: '基类层', definitions };
}

/** 把候选文档对象包装成编译器输入（序列化为纯声明式 JSON 文本）。 */
export function catalogDocumentInput(
  document: unknown,
  overrides: Partial<CandidateDocumentInput> = {},
): CandidateDocumentInput {
  return {
    sourceId: 'src:class/catalog',
    documentUri: 'file:///src/class/catalog.json',
    sourcePackage: 'wakeup-class-catalog',
    sourceText: JSON.stringify(document, null, 2),
    precedence: 100,
    owningLayer: '基类层',
    normativeStatus: 'normative',
    ...overrides,
  };
}

/** 组装一个隔离的编译器主机（新的注册表、产物存储、应急汇）。 */
export function createCatalogCompilerHost(catalogs: readonly ClassCatalog[]): CatalogCompilerHost {
  const schemaRegistry = new SchemaRegistry();
  schemaRegistry.register(buildCatalogSchemaVersion(catalogs));
  const registry = new InMemorySpecificationRegistry();
  const artifactStore = new InMemoryArtifactStore();
  const emergencySink = new InMemoryEmergencySink();
  const compiler = new SpecificationCompiler({ schemaRegistry, registry, artifactStore, emergencySink });
  return { compiler, registry, artifactStore, schemaRegistry };
}

/** 便捷入口：在全新主机上把若干目录合并为一次生产模式原子激活。 */
export function activateCatalogs(catalogs: readonly ClassCatalog[]): Promise<CompilationResult> {
  const host = createCatalogCompilerHost(catalogs);
  return host.compiler.compileAndActivate(catalogDocumentInput(buildCatalogDocument(catalogs)));
}
