/**
 * 玩法包编译器主逻辑。
 *
 * 统一出口头：把分散的编译器（profile-audit、map-compile）组合成一条管线，
 * 接受 LLM 生成或玩家上传的 zip 包，返回结构化诊断。
 *
 * 阶段：
 *  1. 解析 JSON 清单（失败即终止）
 *  2. 分类 profile 与地图
 *  3. 调用现有编译器（profile-audit、map-compile）
 *  4. 计算复杂度评分
 *  5. 汇总诊断
 */
import { parseStrictDataJson } from '../../class/catalog-loader.js';
import type { JsonValue } from '../../core/kernel/spec-compiler/types.js';
import { auditNumericValues, type Finding } from '../profiles/audit.js';
import type { PlayProfile } from '../profiles/catalog.js';
import { auditNumericOwnership, type NumericFinding } from '../types/numeric-classification.js';
import { compileMap } from '../map/compile.js';
import { validateMapStructure, type MapDiagnostic } from '../map/validate.js';
import type { MapData } from '../map/types.js';
import { calculateComplexityScore } from './complexity.js';
import type {
  CompileOptions,
  CompiledPlaypack,
  ParsedMap,
  ParsedProfile,
  PlaypackCompileResult,
  PlaypackDiagnostic,
  PlaypackInput,
  PlaypackSource,
} from './types.js';

/**
 * 编译并验证一个玩法包。
 *
 * @param input - 玩法包输入
 * @param options - 编译选项
 * @returns 编译结果：成功则返回编译产物，失败则返回诊断列表
 */
export async function compile(
  input: PlaypackInput,
  options: CompileOptions = {},
): Promise<PlaypackCompileResult> {
  const { fullAudit = true, allowUnpublishedMaps = false, targetEnv = 'both' } = options;
  const diagnostics: PlaypackDiagnostic[] = [];

  // ---- 阶段 1：解析 JSON 清单 ----
  const parsedManifests = new Map<string, JsonValue>();
  for (const [path, content] of input.manifests) {
    try {
      // 使用基类层的严格解析器：拒绝注释、尾逗号、重复键
      const parsed = parseStrictDataJson(content, path, '玩法层');
      parsedManifests.set(path, parsed);
    } catch (err) {
      diagnostics.push({
        code: 'PLAYPACK_JSON_PARSE_ERROR',
        severity: 'error',
        file: path,
        message: `JSON 解析失败：${err instanceof Error ? err.message : String(err)}`,
        correction: '检查 JSON 语法（逗号、引号、括号、重复键）。不允许注释和尾逗号。',
        autoFixable: false,
      });
    }
  }

  // 解析失败即终止
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  // ---- 阶段 2：分类 profile 与地图 ----
  const profiles: ParsedProfile[] = [];
  const maps: ParsedMap[] = [];

  for (const [path, document] of parsedManifests) {
    // 推断类型：路径前缀或顶层字段
    if (isProfilePath(path) || isProfileDocument(document)) {
      const category = inferProfileCategory(path, document);
      if (category === null) {
        diagnostics.push({
          code: 'PLAYPACK_UNKNOWN_DOCUMENT_TYPE',
          severity: 'warning',
          file: path,
          message: `无法推断文档类型，路径也不匹配 profile 类别`,
          correction: '确保 profile 文件在正确的子目录下（items/ npcs/ statuses/ vehicles/ weapons/）',
          autoFixable: false,
        });
        continue;
      }
      const recordDoc = asRecord(document);
      if (recordDoc === null) {
        diagnostics.push({
          code: 'PLAYPACK_INVALID_PROFILE_SHAPE',
          severity: 'error',
          file: path,
          message: `Profile 必须是一个对象，但这个文件不是`,
          correction: '确保文件是一个 JSON 对象（{}），而不是数组或其他类型',
          autoFixable: false,
        });
        continue;
      }
      profiles.push({
        path,
        category,
        document: deepFreeze(recordDoc),
      });
    } else if (isMapDocument(document)) {
      // 地图：必须有 schemaVersion、nodes、edges
      maps.push({
        path,
        data: deepFreeze(document),
        prefab: null as any, // 稍后填充
      });
    } else {
      diagnostics.push({
        code: 'PLAYPACK_UNKNOWN_DOCUMENT_TYPE',
        severity: 'warning',
        file: path,
        message: '文档类型未知（既不是 profile 也不是地图）',
        correction: '检查文档结构是否符合 profile 或 MapData 约定',
        autoFixable: false,
      });
    }
  }

  // ---- 阶段 3：调用现有编译器 ----
  // 3.1 Profile 审计（数值归属）
  if (fullAudit && profiles.length > 0) {
    const playProfiles: PlayProfile[] = profiles.map((p) => ({
      sourceId: p.path,
      category: p.category,
      document: p.document,
    }));

    // 先收集原始的数值诊断（包含 value 字段）
    const rawNumericFindings = new Map<string, NumericFinding>();
    for (const profile of playProfiles) {
      for (const nf of auditNumericOwnership(profile.document) as readonly NumericFinding[]) {
        const key = `${profile.sourceId}${nf.path}`;
        rawNumericFindings.set(key, nf);
      }
    }

    // 再调用统一的 Finding 转换器
    const numericFindings = auditNumericValues(playProfiles);
    diagnostics.push(...numericFindings.map((f) => {
      const key = `${f.sourceId}${f.jsonPath}`;
      const raw = rawNumericFindings.get(key);
      return findingToDiagnostic(f, raw);
    }));
  }

  // 3.2 地图编译
  const compiledMaps: ParsedMap[] = [];
  for (const mapEntry of maps) {
    const mapData = mapEntry.data as MapData;

    // 先跑结构校验
    const structureFindings = validateMapStructure(mapData);
    diagnostics.push(...structureFindings.map((d) => mapDiagnosticToPlaypackDiagnostic(d, mapEntry.path)));

    // 有 error 就不编译
    if (structureFindings.some((d) => d.severity === 'error')) {
      continue;
    }

    // 编译
    const compileResult = compileMap(mapData);
    if (compileResult.ok) {
      compiledMaps.push({
        path: mapEntry.path,
        data: mapEntry.data,
        prefab: deepFreeze(compileResult.prefab),
      });
      // warning 也要收集
      diagnostics.push(
        ...compileResult.warnings.map((d) => mapDiagnosticToPlaypackDiagnostic(d, mapEntry.path)),
      );
    } else {
      diagnostics.push(
        ...compileResult.diagnostics.map((d) => mapDiagnosticToPlaypackDiagnostic(d, mapEntry.path)),
      );
    }
  }

  // ---- 阶段 4：计算复杂度评分 ----
  const complexityScore = calculateComplexityScore({
    profileCount: profiles.length,
    mapCount: compiledMaps.length,
    customRuleCount: 0, // 暂未实现规则系统
  });

  // ---- 阶段 5：收集引用的基类 id（供审核系统使用） ----
  const referencedClassIds = new Set<string>();
  for (const profile of profiles) {
    collectClassReferences(profile.document, referencedClassIds);
  }

  // ---- 阶段 6：高级判定（L-06, D-077）----
  // 可达性静态扫描：凡含引擎层引用即标 advanced。含地图定义只带地图 tag，不构成高级判据。
  // 命中式而非显式声明：判定看产物的可达内容，不看来源/声明 tag。
  const { advanced, advancedReason } = classifyAdvanced(profiles, compiledMaps);

  // ---- 阶段 7：LLM 包地图独立激活拒绝（L-05/D-076，要求7.4/8.7）----
  // LLM 生成的包不能携带能独立激活的地图：地图是唯一装载锚点，LLM 包携带的地图
  // 不得独立生效、不得通过编译（尤其是那些在阶段6被判定为非高级、却还带着地图的包）。
  if (input.source === 'llm-generated' && compiledMaps.length > 0) {
    diagnostics.push({
      code: 'E_LOAD_LLM_MAP_INDEPENDENT',
      severity: 'error',
      file: compiledMaps[0]?.path,
      message:
        `LLM 生成的玩法包携带了 ${compiledMaps.length} 张地图定义，地图作为唯一装载锚点在 LLM 包内不能独立激活。`,
      correction: '把地图定义从 LLM 包中拆出，或用玩家上传/官方方式单独交付地图。',
      autoFixable: false,
    });
  }

  // ---- 阶段 8：汇总结果 ----
  if (diagnostics.some((d) => d.severity === 'error')) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    artifact: {
      input,
      profiles,
      maps: compiledMaps,
      referencedClassIds,
      diagnostics,
      complexityScore,
      advanced,
      // L-06：高级判定理由——命中来源（map-only 恒 false，extra 恒 undefined）。
      advancedReason,
      // L-07/D-079 上传两态辨形：无地图→可插拔普通包（态一）；带地图→按地图切口子（态二）。
      // 判定看编译产物地图数量，不看来源声明（来源不带特权）。
      deliveryForm: deliveryFormOf(input.source, compiledMaps.length),
    },
  };
}

/**
 * 上传两态辨形（D-077 主梁4 / D-079）。
 *
 * 玩法包经上传取得最强装载能力（能引用引擎层、能带地图）。编译产物据此分两态：
 * - 无地图 → `'ordinary'`（态一：可插拔普通玩法包，带 UGC 角标，可自建房/探索匹配）；
 * - 含地图 → `'entry-by-map'`（态二：按地图切成多个隔离口子，进图装载整个包，禁跨口）。
 *
 * 非上传来源（llm-generated / player-uploaded / official）不产生态辨形，返回 undefined——
 * 只有 `uploaded` 语义专门化才走此辨形；判定看产物地图数，不看来源（来源不带特权，呼应
 * `CandidateSourceKind.kind` 不改变 Schema/配额/severity）。
 */
function deliveryFormOf(source: PlaypackSource, mapCount: number): 'ordinary' | 'entry-by-map' | undefined {
  if (source !== 'uploaded') return undefined;
  return mapCount > 0 ? 'entry-by-map' : 'ordinary';
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function isProfilePath(path: string): boolean {
  const segments = path.split('/');
  if (segments.length < 2) return false;
  const category = segments[0];
  return ['items', 'npcs', 'statuses', 'vehicles', 'weapons'].includes(category ?? '');
}

function isProfileDocument(doc: JsonValue): boolean {
  const record = asRecord(doc);
  if (record === null) return false;
  // profile 通常有这些字段之一
  return 'classComposition' in record || 'actions' in record || 'grantedActions' in record;
}

function isMapDocument(doc: JsonValue): boolean {
  const record = asRecord(doc);
  if (record === null) return false;
  // MapData 的必填字段
  return 'schemaVersion' in record && 'nodes' in record && 'edges' in record;
}

function inferProfileCategory(
  path: string,
  doc: JsonValue,
): 'items' | 'npcs' | 'statuses' | 'vehicles' | 'weapons' | null {
  // 优先从路径推断
  const segments = path.split('/');
  const firstSegment = segments[0];
  if (
    firstSegment === 'items' ||
    firstSegment === 'npcs' ||
    firstSegment === 'statuses' ||
    firstSegment === 'vehicles' ||
    firstSegment === 'weapons'
  ) {
    return firstSegment;
  }

  // 从文档内容推断（启发式）
  const record = asRecord(doc);
  if (record === null) return null;

  if ('vehicleType' in record) return 'vehicles';
  if ('behaviorClassId' in record) return 'npcs';
  if ('statusType' in record) return 'statuses';
  // items 和 weapons 较难区分，默认 items
  return 'items';
}

function asRecord(value: JsonValue): Readonly<Record<string, JsonValue>> | null {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== 'object') {
    return null;
  }
  return value;
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const value of Object.values(obj as any)) {
    deepFreeze(value);
  }
  return obj;
}

function collectClassReferences(doc: Readonly<Record<string, JsonValue>>, refs: Set<string>): void {
  // 递归收集所有形如 "xxx.class.yyy" 的字符串
  for (const value of Object.values(doc)) {
    if (typeof value === 'string' && value.includes('.class.')) {
      refs.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.includes('.class.')) {
          refs.add(item);
        } else if (item !== null && typeof item === 'object') {
          collectClassReferences(item as Readonly<Record<string, JsonValue>>, refs);
        }
      }
    } else if (value !== null && typeof value === 'object') {
      collectClassReferences(value as Readonly<Record<string, JsonValue>>, refs);
    }
  }
}

// ---- L-06: 高级判定——引擎层引用可达性扫描（D-077）----

/** 引擎层原语前缀/标识：命中任一即触发 advanced 标签。 */
const ENGINE_LAYER_INDICATORS = [
  'd:link',
  'd:prefab',
  'd:node',
  'd:playpack',
  'd:rule',
  'd:expr',
  'd:schedule',
  'd:policy',
  'e:',
  'n:',
  'l:',
  'c:',
  's:',
  'a:',
  'g:',
  'container.enter',
  'container.exit',
  'item.move',
  'entity.create',
  'entity.destroy',
  'entity.place',
  'node.create',
  'link.create',
  'slot.add',
  'slot.del',
  'prefab.spawn',
] as const;

/**
 * 高级判定与理由（L-06）。返回 `{ advanced, advancedReason }`：
 * - `advanced = true` 当且仅当某个 profile 命中引擎层原语（可达性静态扫描，命中式）。
 * - 含地图定义只带地图 tag，不构成高级判据——地图本身不触发 advanced。
 * - `advancedReason` 记录命中来源，供装载体/审核系统向创作者解释为何被标高级。
 */
function classifyAdvanced(
  profiles: readonly ParsedProfile[],
  _maps: readonly ParsedMap[],
): { advanced: boolean; advancedReason?: string } {
  for (const profile of profiles) {
    const hit = firstEngineRef(profile.document);
    if (hit !== undefined) {
      return { advanced: true, advancedReason: `${profile.path} 含引擎层原语「${hit}」` };
    }
  }
  // 地图定义不触发高级——只带地图 tag。
  return { advanced: false, advancedReason: undefined };
}

/** 返回命中引擎层指示词的第一个字符串；未命中返回 undefined。 */
function firstEngineRef(doc: Readonly<Record<string, JsonValue>>): string | undefined {
  for (const value of Object.values(doc)) {
    if (typeof value === 'string') {
      const hit = ENGINE_LAYER_INDICATORS.find((ind) => value === ind || value.startsWith(ind));
      if (hit !== undefined) return value;
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          const hit = ENGINE_LAYER_INDICATORS.find((ind) => item === ind || item.startsWith(ind));
          if (hit !== undefined) return item;
        } else if (item !== null && typeof item === 'object') {
          const nested = firstEngineRef(item as Readonly<Record<string, JsonValue>>);
          if (nested !== undefined) return nested;
        }
      }
    } else if (value !== null && typeof value === 'object') {
      const nested = firstEngineRef(value as Readonly<Record<string, JsonValue>>);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

function findingToDiagnostic(finding: Finding, numericFinding?: NumericFinding): PlaypackDiagnostic {
  return {
    code: finding.code,
    severity: finding.code.includes('OUT-OF-RANGE') ? 'error' : 'warning',
    file: finding.sourceId,
    path: finding.jsonPath,
    message: finding.reason,
    correction: suggestCorrection(finding),
    autoFixable: isAutoFixable(finding),
    suggestedFix: finding.code.includes('OUT-OF-RANGE') && numericFinding
      ? suggestNumericFix(numericFinding.value)
      : undefined,
  };
}

function mapDiagnosticToPlaypackDiagnostic(
  diag: MapDiagnostic,
  filePath: string,
): PlaypackDiagnostic {
  return {
    code: diag.code,
    severity: diag.severity,
    file: filePath,
    path: diag.path,
    message: diag.message,
    correction: diag.correction,
    autoFixable: false, // 地图问题通常不可自动修正（涉及拓扑结构）
  };
}

function suggestCorrection(finding: Finding): string {
  if (finding.code === 'PLAY-NUM-OUT-OF-RANGE') {
    return '将数值调整到 1-5 范围内';
  }
  if (finding.code === 'PLAY-NUM-UNCLASSIFIED') {
    return '为数值添加归属分类（damage / cost / health 等）';
  }
  return '请参考错误原因修正';
}

function isAutoFixable(finding: Finding): boolean {
  // 数值越界可自动修正（限幅到 1-5）
  return finding.code === 'PLAY-NUM-OUT-OF-RANGE';
}

function suggestNumericFix(value: number): number {
  const magnitude = Math.abs(value);
  // 限幅到 1-5
  if (magnitude < 1) return value < 0 ? -1 : 1;
  if (magnitude > 5) return value < 0 ? -5 : 5;
  return value;
}
