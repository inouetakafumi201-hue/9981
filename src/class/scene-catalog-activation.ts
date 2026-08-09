/**
 * 基类层空间目录 → 规范编译器 的装载桥（tasks.md D-5 的 scenes 切片）。
 *
 * 目的：证明 `src/class/scenes/index.json` 能经 `SpecificationCompiler.compileAndActivate`
 * （targetLayer: '基类层'）走真实的原子激活/回滚管线，从而享有：
 *   - P8 引用图完整性与确定性拒绝（悬空组合引用 → 确定性 Structured_Rejection）；
 *   - P10 包激活、覆盖、删除的原子性与回滚（任一 Error → 零候选变更、快照不变）。
 *
 * 明确的切片边界（实事求是，避免"看起来做了全部"的误导）：
 *   - 本桥只搬运"空间类 + 能力 + 类到能力的组合边"这一张组合图。空间类的
 *     requiredCapabilityIds 与 optionalCapabilityIds 一并映射为编译器的 `components`（组合边），
 *     能力映射为 prefab 定义。
 *   - 结构边界（structuralBounds 的数值归属，P3）、值集合（valueSets）、过渡端点作为具体引用、
 *     禁令（prohibitions，属校验规则）、以及玩法层参数绑定，均**不在本切片**内，属后续工作。
 *   - 其余 12 个基类层目录（actions/gateways/items/weapons/...）也**不在本切片**，D-5 全量仍未完成。
 *
 * 两处映射判断（需人工复核，见下方注释）：
 *   A. 能力在编译器模型里登记为 `prefab` 定义（目录本身不给能力分配 Def kind）。
 *   B. 类的必需能力与可选能力合并为一条 `components` 组合边列表；required/optional 的区分
 *      不在本切片建模（那属于玩法层能力边界审计 C.3 的关注点）。
 *
 * 该文件只消费 spec-compiler 的公开 API 与 class-contract 的解析结果，不修改任一方交付物。
 */

import { createHash } from 'node:crypto';
import type { DefKind } from '../core/kernel/state/def.js';
import type { SourceRecord } from '../core/kernel/state/diagnostic.js';
import { InMemoryEmergencySink } from '../core/kernel/safety/fatal-boundary.js';
import {
  InMemoryArtifactStore,
  InMemorySpecificationRegistry,
  SchemaRegistry,
  SemanticFamilyRegistry,
  SpecificationCompiler,
} from '../core/kernel/spec-compiler/index.js';
import type {
  CandidateDocumentInput,
  CompilationResult,
  DefinitionSchema,
  FieldRule,
  SchemaVersion,
} from '../core/kernel/spec-compiler/index.js';
import type { ClassCatalog } from './class-contract.js';

/** 编译器 schema 契约版本；与目录数据版本（catalog.version）是两个独立的版本号。 */
export const SCENE_COMPILER_SCHEMA_VERSION = '1.0.0';

/** 映射判断 A：能力在编译器模型中登记为的语义族（目录本身不给能力分配族）。 */
export const SCENE_CAPABILITY_FAMILY = 'scene-capability';

/** 映射判断 A：能力在编译器模型中映射到的 Def kind。 */
const CAPABILITY_DEF_KIND: DefKind = 'prefab';

/** 一个可被 JSON.stringify 的场景定义（测试可克隆并注入违规后再编译）。 */
export interface SceneDefinitionDocument {
  readonly id: string;
  readonly kind: string;
  readonly abstract: boolean;
  readonly semanticFamily: string;
  readonly components?: readonly string[];
}

/** 可被 JSON.stringify 为 `sourceText` 的完整候选文档。 */
export interface SceneCatalogDocument {
  readonly schemaVersion: string;
  readonly targetLayer: '基类层';
  readonly definitions: readonly SceneDefinitionDocument[];
}

export interface SceneCompilerHost {
  readonly compiler: SpecificationCompiler;
  readonly registry: InMemorySpecificationRegistry;
  readonly artifactStore: InMemoryArtifactStore;
  readonly schemaRegistry: SchemaRegistry;
}

/**
 * 主机溯源来源：不是创作者输入，因此用零宽 span。
 * 形状与 spec-compiler 测试夹具的 `familySource()` 一致。
 */
function bridgeSource(): SourceRecord {
  const empty = createHash('sha256').update('', 'utf8').digest('hex');
  return {
    sourceId: 'src:scene-bridge',
    documentUri: 'file:///src/class/scene-catalog-activation.ts',
    sourcePackage: 'wakeup-class-catalog',
    contentHash: empty,
    precedence: 500,
    owningLayer: '基类层',
    normativeStatus: 'normative',
    span: {
      file: 'file:///src/class/scene-catalog-activation.ts',
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 },
      sourceSliceHash: empty,
    },
  };
}

/**
 * 从目录派生语义族登记表。
 *
 * 空间族（natural-scene / micro-scene / transition）的允许 Def kind 由声明它的类推导；
 * 能力族固定映射到 prefab。三判据一律取真——这不是臆断：scenes 目录的
 * `classificationEvidence` 三项已由 `class-contract.ts` 的加载器强制为全真，否则加载即失败。
 */
function buildSceneFamilies(catalog: ClassCatalog): SemanticFamilyRegistry {
  const registry = new SemanticFamilyRegistry();
  const source = bridgeSource();
  const criteria = { enumerable: true, composable: true, gameplayIndependent: true } as const;

  const kindsByFamily = new Map<string, Set<DefKind>>();
  for (const cls of catalog.classes) {
    const kinds = kindsByFamily.get(cls.semanticFamily) ?? new Set<DefKind>();
    kinds.add(cls.defKind);
    kindsByFamily.set(cls.semanticFamily, kinds);
  }
  for (const [family, kinds] of [...kindsByFamily.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    registry.register({
      id: family,
      allowedKinds: [...kinds].sort(),
      criteria: { ...criteria },
      classificationReason: `空间族 ${family} 的可枚举、可组合、不含玩法语义三判据由 scenes 目录的 classificationEvidence 佐证。`,
      source,
    });
  }
  registry.register({
    id: SCENE_CAPABILITY_FAMILY,
    allowedKinds: [CAPABILITY_DEF_KIND],
    criteria: { ...criteria },
    classificationReason: '空间能力可枚举、可与空间类组合、且不含具体玩法取值，作为可复用组合单元登记。',
    source,
  });
  return registry;
}

/** 某个 Def kind 的默认语义族：能力 kind → 能力族；其余取声明该 kind 的首个类的族。 */
function defaultFamilyForKind(kind: DefKind, catalog: ClassCatalog): string {
  if (kind === CAPABILITY_DEF_KIND) return SCENE_CAPABILITY_FAMILY;
  const cls = catalog.classes.find((entry) => entry.defKind === kind);
  return cls ? cls.semanticFamily : SCENE_CAPABILITY_FAMILY;
}

/**
 * 为 scenes 目录构建编译器 `SchemaVersion`。
 *
 * 每个用到的 Def kind 声明一份 `DefinitionSchema`，字段集刻意最小：只有一个可选的 `title`
 * 表现字段。语义内容全部走基础字段（`components` 组合边、`semanticFamily`、`abstract`），
 * 因此本切片不引入任何数值字段，也就不触发数值归属校验（P3 不在本切片）。
 */
export function buildSceneSchemaVersion(catalog: ClassCatalog): SchemaVersion {
  const families = buildSceneFamilies(catalog);
  // 空字段集：本切片的语义内容全部走基础字段（components 组合边、semanticFamily、abstract）。
  // 刻意不声明任何可组合字段——组合会把组件的 value 字段并入宿主，若能力与类都带同名字段
  // （例如 title），一个类组合多个能力时就会触发 E_LOAD_COMPOSITION_CONFLICT。让能力只贡献
  // 组合"边"而不贡献任何字段，组合图才干净，P8/P10 才聚焦在引用完整性与原子性本身。
  const fields: Readonly<Record<string, FieldRule>> = {};

  const definitionSchemas = new Map<DefKind, DefinitionSchema>();
  const kinds = new Set<DefKind>([CAPABILITY_DEF_KIND, ...catalog.classes.map((cls) => cls.defKind)]);
  for (const kind of [...kinds].sort()) {
    definitionSchemas.set(kind, {
      kind,
      semanticFamily: defaultFamilyForKind(kind, catalog),
      fields,
    });
  }
  return {
    version: SCENE_COMPILER_SCHEMA_VERSION,
    definitionSchemas,
    integrationContracts: new Map(),
    semanticFamilies: families.toMap(),
  };
}

/**
 * 把已解析目录转成编译器候选文档对象。
 *
 * 返回纯数据对象而非文本，方便测试克隆并注入违规（悬空引用、重复标识、非法 kind……）后再序列化。
 * 能力先于类排列只为可读性；编译器内部按标识规范化排序，文档内顺序不影响产物字节。
 */
export function buildSceneDocument(catalog: ClassCatalog): SceneCatalogDocument {
  const definitions: SceneDefinitionDocument[] = [];
  for (const capability of catalog.capabilities) {
    definitions.push({
      id: capability.id,
      kind: CAPABILITY_DEF_KIND,
      abstract: true,
      semanticFamily: SCENE_CAPABILITY_FAMILY,
    });
  }
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
  return { schemaVersion: SCENE_COMPILER_SCHEMA_VERSION, targetLayer: '基类层', definitions };
}

/** 把候选文档对象包装成编译器输入（序列化为纯声明式 JSON 文本）。 */
export function sceneDocumentInput(
  document: SceneCatalogDocument,
  overrides: Partial<CandidateDocumentInput> = {},
): CandidateDocumentInput {
  return {
    sourceId: 'src:class/scenes/index.json',
    documentUri: 'file:///src/class/scenes/index.json',
    sourcePackage: 'wakeup-class-catalog',
    sourceText: JSON.stringify(document, null, 2),
    precedence: 100,
    owningLayer: '基类层',
    normativeStatus: 'normative',
    ...overrides,
  };
}

/** 组装一个隔离的编译器主机（新的注册表、产物存储、应急汇）。 */
export function createSceneCompilerHost(catalog: ClassCatalog): SceneCompilerHost {
  const schemaRegistry = new SchemaRegistry();
  schemaRegistry.register(buildSceneSchemaVersion(catalog));
  const registry = new InMemorySpecificationRegistry();
  const artifactStore = new InMemoryArtifactStore();
  const emergencySink = new InMemoryEmergencySink();
  const compiler = new SpecificationCompiler({ schemaRegistry, registry, artifactStore, emergencySink });
  return { compiler, registry, artifactStore, schemaRegistry };
}

/** 便捷入口：在全新主机上把 scenes 目录经生产模式原子激活。 */
export function activateSceneCatalog(catalog: ClassCatalog): Promise<CompilationResult> {
  const host = createSceneCompilerHost(catalog);
  return host.compiler.compileAndActivate(sceneDocumentInput(buildSceneDocument(catalog)));
}
