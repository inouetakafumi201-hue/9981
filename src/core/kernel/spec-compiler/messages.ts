import type { ErrCode } from '../state/error-codes.js';
import type { DiagnosticArgument } from '../state/diagnostic.js';

/**
 * Creator-facing message catalogue.
 *
 * Diagnostics carry three separable layers so that the human-readable layer can be swapped for another
 * language without touching compiler logic:
 *
 * - `code` / `messageKey`: stable machine identity. Never translated, never reworded.
 * - `messageArgs`: structured, locale-neutral values (numbers stay numbers, identifiers stay verbatim).
 * - this bundle: the only place where creator-facing prose lives.
 *
 * `message` on a Diagnostic remains a technical English string for maintainers and logs. It is
 * deliberately *not* part of the localisable surface, so hosts must render creator text from
 * `messageKey` + `messageArgs` + a bundle rather than from `message`.
 */
export interface CreatorMessageEntry {
  /** Short problem label, phrased as an observation rather than a compiler term. */
  readonly title: string;
  /** What to do next. May reference `messageArgs` with `{name}` placeholders. */
  readonly guidance: string;
}

export interface CreatorMessageBundle {
  /** BCP 47 tag. Only used for host bookkeeping; no behaviour depends on it. */
  readonly locale: string;
  /** Applied when a code has no entry, so a missing translation degrades instead of throwing. */
  readonly fallbackTitle: string;
  readonly fallbackGuidance: string;
  /** Assembles the one-line creator message. Supports `{title}` and `{guidance}`. */
  readonly creatorMessagePattern: string;
  readonly entries: Readonly<Partial<Record<ErrCode, CreatorMessageEntry>>>;
}

/**
 * Every code the specification compiler can attach to a creator-facing diagnostic.
 *
 * A test scans the compiler sources and fails when an emitted code is absent here, so this list cannot
 * silently drift behind the implementation and leave a creator with an untranslated diagnostic.
 */
export const COMPILER_EMITTED_CODES: readonly ErrCode[] = Object.freeze([
  'E_LOAD_BASELINE_STALE',
  'E_LOAD_CACHE_ROLLBACK_FAILED',
  'E_LOAD_CANONICAL_AMBIGUOUS',
  'E_LOAD_COMMIT_RECHECK_FAILED',
  'E_LOAD_COMPOSITION_CONFLICT',
  'E_LOAD_CROSS_FIELD_CONSTRAINT',
  'E_LOAD_CYCLE_DEP',
  'E_LOAD_DECISION_ID_REUSED',
  'E_LOAD_DEF_KIND',
  'E_LOAD_DEPRECATED_MECHANIC',
  'E_LOAD_DIAGNOSTIC_FAILURE',
  'E_LOAD_DUPLICATE_ID',
  'E_LOAD_DUPLICATE_MEMBER',
  'E_LOAD_EQUAL_PRECEDENCE_CONFLICT',
  'E_LOAD_FIELD_TYPE',
  'E_LOAD_GAMEPLAY_VALUE_RANGE',
  'E_LOAD_IDENTIFIER_INVALID',
  'E_LOAD_IDENTITY_CONFLICT',
  'E_LOAD_INHERITANCE_CYCLE',
  'E_LOAD_INPUT_TRUNCATED',
  'E_LOAD_JSON_SYNTAX',
  'E_LOAD_LAYER_OWNERSHIP',
  'E_LOAD_LINT',
  'E_LOAD_MIGRATED_SOURCE_REBASED',
  'E_LOAD_NORMATIVE_WITHOUT_PROVENANCE',
  'E_LOAD_NUMERIC_OWNERSHIP',
  'E_LOAD_ORDER_UNDECLARED',
  'E_LOAD_OUTPUT_WRITE_FAILED',
  'E_LOAD_OVERRIDE_INVALID',
  'E_LOAD_PARTIAL_ACTIVATION',
  'E_LOAD_PRESENTATION_FALLBACK',
  'E_LOAD_PROHIBITED_CONSTRUCT',
  'E_LOAD_REQUIRED_FIELD',
  'E_LOAD_SCHEMA_CONTRACT',
  'E_LOAD_SCHEMA_VERSION',
  'E_LOAD_SEMANTIC_FIELD_DAMAGED',
  'E_LOAD_SOURCE_DISPLACED',
  'E_LOAD_SOURCE_INVALID',
  'E_LOAD_SOURCE_MAP_LOST',
  'E_LOAD_SOURCE_STATUS_PROMOTION',
  'E_LOAD_TERM_NONCANONICAL',
  'E_LOAD_UNDEFINED_REF',
  'E_LOAD_UNKNOWN_FIELD',
  'E_LOAD_UNRESOLVED_NORMATIVE',
  'E_MIG_AMBIGUOUS_PATH',
  'E_MIG_CYCLE',
  'E_MIG_FAILED',
  'E_MIG_NEWER_SAVE',
  'E_MIG_NO_PATH',
  'E_QUOTA_ARRAY_ELEMENTS',
  'E_QUOTA_AST_NODES',
  'E_QUOTA_DEFINITIONS',
  'E_QUOTA_DIAGNOSTICS',
  'E_QUOTA_INPUT_BYTES',
  'E_QUOTA_NESTING_DEPTH',
  'E_QUOTA_OBJECT_MEMBERS',
  'E_QUOTA_OUTPUT_BYTES',
  'E_QUOTA_REFERENCE_EDGES',
  'E_QUOTA_TRAVERSAL_WORK',
  'E_REF_ABSTRACT',
  'E_REF_KIND',
  'E_REF_MISSING',
  'E_REF_PROVIDER_CONTRACT',
] as const satisfies readonly ErrCode[]);

/**
 * Codes whose guidance interpolates `messageArgs`. Each of these has exactly one emission site, so the
 * argument contract is verifiable by inspection and enforced by tests; codes emitted from many places
 * keep placeholder-free guidance so a forgotten argument can never surface as a raw `{name}` to a creator.
 */
export const GUIDANCE_ARGUMENT_CONTRACT: Readonly<Partial<Record<ErrCode, readonly string[]>>> = Object.freeze({
  E_LOAD_GAMEPLAY_VALUE_RANGE: ['value', 'minimum', 'maximum'],
  E_LOAD_SOURCE_STATUS_PROMOTION: ['declaredStatus', 'documentStatus'],
  E_LOAD_DECISION_ID_REUSED: ['decisionId', 'variantCount'],
  E_LOAD_MIGRATED_SOURCE_REBASED: ['fromVersion', 'toVersion'],
  E_QUOTA_TRAVERSAL_WORK: ['limit'],
});

export const ZH_CN_CREATOR_BUNDLE: CreatorMessageBundle = Object.freeze({
  locale: 'zh-CN',
  fallbackTitle: '内容未通过检查',
  fallbackGuidance: '请查看标记位置，按提示调整后重新编译。',
  creatorMessagePattern: '【{title}】{guidance}',
  entries: Object.freeze({
    // ---- Reading the file ----
    E_LOAD_JSON_SYNTAX: {
      title: '这里的写法不符合 JSON 格式',
      guidance: '请检查标记位置附近的括号、引号和逗号是否成对、是否多写或漏写。',
    },
    E_LOAD_INPUT_TRUNCATED: {
      title: '文件没有写完整',
      guidance: '文件在中途就结束了。请补齐剩余内容，确认最外层的括号已经闭合。',
    },
    E_LOAD_DUPLICATE_MEMBER: {
      title: '同一个设置写了两次',
      guidance: '请只保留一处，并确认保留下来的那一处就是你想要的值。',
    },
    E_LOAD_PROHIBITED_CONSTRUCT: {
      title: '这里不能放可执行内容',
      guidance: '这份文件只能描述"是什么"，不能包含代码、命令或动态求值。请改用已支持的设置字段。',
    },

    // ---- Version and migration ----
    E_LOAD_SCHEMA_VERSION: {
      title: '文件版本无法识别',
      guidance: '请把版本号改成当前支持的版本，或先把文件升级到支持的版本。',
    },
    E_MIG_NEWER_SAVE: {
      title: '文件来自更新的版本',
      guidance: '这份文件比当前程序更新，无法向下兼容。请升级程序，或改用当前版本重新导出。',
    },
    E_MIG_NO_PATH: {
      title: '找不到升级这份旧文件的方法',
      guidance: '当前程序没有从该版本升级的步骤。请先用能读取它的旧版本另存为较新版本。',
    },
    E_MIG_AMBIGUOUS_PATH: {
      title: '升级路线不唯一',
      guidance: '存在多条升级路线，系统无法替你选择。请指定要走的升级序列。',
    },
    E_MIG_CYCLE: {
      title: '升级步骤绕回了自己',
      guidance: '升级步骤形成了循环。这需要维护者修正升级配置，不是你的文件的问题。',
    },
    E_MIG_FAILED: {
      title: '文件升级没有成功',
      guidance: '升级过程中出错，已保持你的原文件不变。请记录本次提示并联系维护者。',
    },
    E_LOAD_MIGRATED_SOURCE_REBASED: {
      title: '文件已自动升级',
      guidance: '文件已从 {fromVersion} 升级到 {toVersion}。之后提示里的行号列号对应升级后的内容，请按升级后的内容核对位置，不要按原始文件找。',
    },

    // ---- Field-level shape ----
    E_LOAD_REQUIRED_FIELD: {
      title: '缺少必填设置',
      guidance: '请在标记位置补上这个设置。',
    },
    E_LOAD_UNKNOWN_FIELD: {
      title: '系统不认识这个设置',
      guidance: '请检查拼写，或删掉这个设置。它不在当前支持的字段列表里。',
    },
    E_LOAD_FIELD_TYPE: {
      title: '这个值的写法不对',
      guidance: '请把值改成提示要求的类型，例如文字要加引号、数字不要加引号。',
    },
    E_LOAD_IDENTIFIER_INVALID: {
      title: '内容编号不符合规则',
      guidance: '请把编号改成只包含字母、数字和 . _ : - ，并以字母或数字开头。',
    },
    E_LOAD_DUPLICATE_ID: {
      title: '两个内容用了同一个编号',
      guidance: '请给其中一个换一个编号。同一份文件里编号必须唯一。',
    },
    E_LOAD_DEF_KIND: {
      title: '这个内容类别不存在',
      guidance: '请改用已登记的类别。可用类别由当前 Schema 决定。',
    },
    E_LOAD_CROSS_FIELD_CONSTRAINT: {
      title: '这些设置不能这样搭配',
      guidance: '这几个设置单独看都没问题，但组合起来互相矛盾。请按提示同时调整它们。',
    },
    E_LOAD_DEPRECATED_MECHANIC: {
      title: '这项机制已经停用',
      guidance: '请改用提示中给出的替代设置。',
    },
    E_LOAD_PRESENTATION_FALLBACK: {
      title: '外观资源已使用替代项',
      guidance: '这里没有填外观资源，系统先用了安全的替代项。内容可以正常使用，补上后会更贴合你的设计。',
    },
    E_LOAD_CANONICAL_AMBIGUOUS: {
      title: '这份内容存在多种等价写法',
      guidance: '集合里的项目缺少唯一编号，系统无法确定顺序。请为每一项补上唯一编号。',
    },

    // ---- Layer and numeric ownership ----
    E_LOAD_LAYER_OWNERSHIP: {
      title: '这项设置放错了层级',
      guidance: '请把它移到负责它的层级：可复用的能力放基类层，具体数值放玩法层。',
    },
    E_LOAD_NUMERIC_OWNERSHIP: {
      title: '系统不知道这个数字代表什么',
      guidance: '请在 Schema 里声明这个数字的用途，系统才能判断它该受哪种范围限制。',
    },
    E_LOAD_GAMEPLAY_VALUE_RANGE: {
      title: '玩法数值超出允许范围',
      guidance: '这里填的是 {value}，玩家可见数值必须在 {minimum} 到 {maximum} 之间。请调整到这个范围内。',
    },
    E_LOAD_TERM_NONCANONICAL: {
      title: '用了已经改名的术语',
      guidance: '请改用当前的正式名称，旧名称已经停止使用。',
    },
    E_LOAD_SEMANTIC_FIELD_DAMAGED: {
      title: '规则内容已损坏',
      guidance: '关键内容在处理过程中丢失了。编译已停止，请联系维护者，不要使用本次结果。',
    },

    // ---- References and composition ----
    E_REF_MISSING: {
      title: '引用的内容不存在',
      guidance: '请检查编号拼写，或先创建被引用的内容。',
    },
    E_REF_KIND: {
      title: '引用了错误类别的内容',
      guidance: '这个位置需要另一种类别的内容。请换成正确类别的编号。',
    },
    E_REF_ABSTRACT: {
      title: '这个基类不能直接使用',
      guidance: '它只作为共同基础存在。请引用它下面的具体内容。',
    },
    E_REF_PROVIDER_CONTRACT: {
      title: '缺少提供这项能力的系统契约',
      guidance: '当前环境没有提供这项能力。请确认所需的扩展已经启用。',
    },
    E_LOAD_INHERITANCE_CYCLE: {
      title: '继承关系绕回了自己',
      guidance: '沿着继承链会回到起点。请去掉其中一条继承关系。',
    },
    E_LOAD_COMPOSITION_CONFLICT: {
      title: '组合进来的能力互相冲突',
      guidance: '两个组件对同一项给出了不同结果。请去掉其中一个，或明确写出这一项该采用哪个值。',
    },
    E_LOAD_ORDER_UNDECLARED: {
      title: '继承来的同一项有两个不同来源',
      guidance: '两条继承线对同一项给出了不同结果，先后顺序没有写明。请写清这一项采用哪一方，或只保留一条继承线。',
    },
    E_LOAD_IDENTITY_CONFLICT: {
      title: '这个子类型和父类型是同一种东西',
      guidance: '继承要表达本质差异：所需能力、可参与的关系、必须满足的约束或可替换范围至少有一项不同。'
        + '若只是配置或数值不同，请改用组合。',
    },
    E_LOAD_UNDEFINED_REF: {
      title: '这次改动会让别处的引用落空',
      guidance: '仍有内容指向你要删除或替换的东西。请在同一次提交里一起处理：删掉那处引用，或改指向别的内容。',
    },
    E_LOAD_CYCLE_DEP: {
      title: '依赖关系绕回了自己',
      guidance: '几份内容互相依赖形成了闭环。请去掉其中一条依赖，改由共同的基础部分提供共享内容。',
    },
    E_LOAD_SCHEMA_CONTRACT: {
      title: '这个语义族不能这样用',
      guidance: '请改用已登记的语义族并确认它接受当前类别，或按可枚举、可组合、不含具体玩法语义三条判据登记新族并写明理由。',
    },
    E_LOAD_LINT: {
      title: '有一处写法可以简化',
      guidance: '这项声明当前没有实际作用。请删掉它，避免以后误以为某个问题已经处理过。',
    },
    E_LOAD_OVERRIDE_INVALID: {
      title: '替换声明无效',
      guidance: '要修改已经生效的内容，必须明确写出你要替换的就是同一个编号。',
    },

    // ---- Authority and precedence ----
    E_LOAD_SOURCE_DISPLACED: {
      title: '这条规则没有生效',
      guidance: '它被更高优先级的来源接管，或本身被标记为历史材料。请查看提示中列出的来源。',
    },
    E_LOAD_EQUAL_PRECEDENCE_CONFLICT: {
      title: '两份同等有效的规则互相矛盾',
      guidance: '系统不能替你选边。请先确定采用哪一条，再把另一条标记为历史材料。',
    },
    E_LOAD_SOURCE_INVALID: {
      title: '这条规则声明的效力超过了它所在的文件',
      guidance: '规则的效力不能高于所在文件本身。请把效力数值改成不超过文件的效力，或把规则移到效力更高的文件里。',
    },
    E_LOAD_SOURCE_STATUS_PROMOTION: {
      title: '这条规则的效力被抬高了',
      guidance: '所在文件是 {documentStatus} 材料，其中的规则不能声明为 {declaredStatus}。请把规则移到正式文件里。',
    },
    E_LOAD_DECISION_ID_REUSED: {
      title: '同一个决策编号用在了不同内容上',
      guidance: '编号 {decisionId} 对应了 {variantCount} 种不同写法，系统已全部保留、不会替你合并。请核对编号。',
    },
    E_LOAD_UNRESOLVED_NORMATIVE: {
      title: '这项规则还没有最终决定',
      guidance: '它已被完整保留，但在决定之前不会生效。请先确定采用哪一条，再把结论写成正式规则并附上决策依据。',
    },
    E_LOAD_NORMATIVE_WITHOUT_PROVENANCE: {
      title: '正式规则找不到依据',
      guidance: '请补上这条规则的决策来源，否则无法确认它的效力。',
    },

    // ---- Limits ----
    E_QUOTA_INPUT_BYTES: {
      title: '文件太大',
      guidance: '请拆成多个文件，或删掉不需要的内容。',
    },
    E_QUOTA_NESTING_DEPTH: {
      // 措辞避免出现"内容"+"层"相邻：术语守卫按子串匹配废用词，相邻时会误报。
      title: '嵌套层级太深',
      guidance: '请把深层结构拆出来单独定义，再用编号互相引用。',
    },
    E_QUOTA_OBJECT_MEMBERS: {
      title: '设置项太多',
      guidance: '请把这份内容拆成几份，或删掉重复的设置。',
    },
    E_QUOTA_ARRAY_ELEMENTS: {
      title: '列表项目太多',
      guidance: '请拆分这个列表，或减少项目数量。',
    },
    E_QUOTA_AST_NODES: {
      title: '内容结构太复杂',
      guidance: '请拆分这份文件，降低单份文件的复杂度。',
    },
    E_QUOTA_DEFINITIONS: {
      title: '一次提交的内容条数太多',
      guidance: '请分批提交。',
    },
    E_QUOTA_REFERENCE_EDGES: {
      title: '相互引用太多',
      guidance: '请简化引用关系，或拆分成多份内容。',
    },
    E_QUOTA_TRAVERSAL_WORK: {
      title: '检查工作量超出上限',
      guidance: '这份内容的组合与依赖过于复杂，检查工作量超过 {limit}。请拆分后重试。',
    },
    E_QUOTA_OUTPUT_BYTES: {
      title: '生成结果太大',
      guidance: '请拆分内容，或减少重复数据。',
    },
    E_QUOTA_DIAGNOSTICS: {
      title: '问题太多，已安全停止',
      guidance: '先修好已经列出的问题，再重新编译。剩下的问题会在下一次显示。',
    },

    // ---- Activation and system-side ----
    E_LOAD_BASELINE_STALE: {
      title: '验证结果已经过期',
      guidance: '检查期间已生效内容发生了变化。请重新编译一次。',
    },
    E_LOAD_COMMIT_RECHECK_FAILED: {
      title: '启用前的最后检查没通过',
      guidance: '已保持原有内容不变。请重新编译，并留意提示中的其他问题。',
    },
    E_LOAD_PARTIAL_ACTIVATION: {
      title: '检测到内容只启用了一部分',
      guidance: '请停止使用当前结果，从上一个完整版本恢复后联系维护者。',
    },
    E_LOAD_OUTPUT_WRITE_FAILED: {
      title: '结果写入失败',
      guidance: '原有内容仍然有效，未发布任何东西。请检查磁盘空间和权限后重试。',
    },
    E_LOAD_CACHE_ROLLBACK_FAILED: {
      title: '临时文件没能清理干净',
      guidance: '相关文件已被隔离，不会被误用。请记录本次提示后联系维护者。',
    },
    E_LOAD_SOURCE_MAP_LOST: {
      title: '系统丢失了位置信息',
      guidance: '编译已安全停止，未发布任何内容。这是系统内部问题，请联系维护者。',
    },
    E_LOAD_DIAGNOSTIC_FAILURE: {
      title: '提示系统本身出错',
      guidance: '编译已安全停止，未发布任何内容。这是系统内部问题，请联系维护者。',
    },
  }),
});

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

export function bundleEntry(bundle: CreatorMessageBundle, code: ErrCode): CreatorMessageEntry {
  return bundle.entries[code] ?? { title: bundle.fallbackTitle, guidance: bundle.fallbackGuidance };
}

/** Substitutes `{name}` from `args`. Unknown placeholders are left verbatim so tests can detect them. */
export function interpolate(text: string, args: Readonly<Record<string, DiagnosticArgument>>): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const value = args[name];
    return value === undefined ? whole : String(value);
  });
}

export function renderGuidance(
  bundle: CreatorMessageBundle,
  code: ErrCode,
  args: Readonly<Record<string, DiagnosticArgument>> = {},
): string {
  return interpolate(bundleEntry(bundle, code).guidance, args);
}

export function renderCreatorMessage(
  bundle: CreatorMessageBundle,
  code: ErrCode,
  args: Readonly<Record<string, DiagnosticArgument>> = {},
): string {
  const entry = bundleEntry(bundle, code);
  return interpolate(bundle.creatorMessagePattern, {
    title: entry.title,
    guidance: interpolate(entry.guidance, args),
  });
}

/** Codes the compiler can emit but this bundle does not translate. */
export function missingBundleCodes(bundle: CreatorMessageBundle): ErrCode[] {
  return COMPILER_EMITTED_CODES.filter((code) => bundle.entries[code] === undefined);
}

/** Placeholder names left unresolved after interpolation. Empty means the text is creator-ready. */
export function unresolvedPlaceholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
}
