/**
 * 规范文档纪律守卫（文档侧）。
 *
 * ## 为什么需要这个文件
 *
 * 术语纪律与来源追踪纪律，**代码侧早已有门禁，文档侧一直没有**：
 *
 * - 代码侧：`src/class/__tests__/architecture-terminology.test.ts` 扫描整棵 `src/`，禁止
 *   `内容层`、单独的 `Layer 1/2/3`、含 `Template` 的标识符、`templateId`/`templateVersion`、
 *   单独的「模板」、以及文件名含 `template`。仓库里的废用词字典（`src/l2/model/constitution.ts`、
 *   `src/core/kernel/spec-compiler/validator.ts`、`src/play/core-mechanics/ownership.ts`）
 *   刻意把废用词写成 `\uXXXX` 转义，正是为了不被那条守卫命中——可见它确实在生效。
 * - 文档侧：`.kiro/specs/**` 与 `docs/**` **不在任何扫描范围内**。于是 L0 术语铁律对文档
 *   只是"写着"，没有任何东西在执行它。本文件补上这一侧。
 *
 * 由 `docs/L_审查报告/wakeup-ai-覆盖率审计.md` 的补测清单 B-19（术语）与 B-20（来源追踪）提出。
 *
 * ## 为什么文档侧只禁「无歧义复合词」，不禁单独的「模板」
 *
 * 单独的「模板」在文档里存在**合法的其他义项**，一律硬禁会制造大量假阳性，逼人绕过检查：
 *
 * - `docs/L1_引擎层/元机制内核Spec_v1.md`：消息模板 / hint 模板（i18n 文案模板）
 * - `docs/00_并行作战手册.md` §六：派发 Prompt 标准模板（文档模板）
 * - `docs/L2_基类层/10_技术栈.md`：「逻辑/模板/样式不分文件」（Vue template）
 * - `docs/访谈决策记录.md`：决策条目模板（文档模板）
 *
 * 因此文档侧只硬禁**在中文里没有别的意思**的复合词，取自 L0 规范宪法 §一 术语铁律的废用别名列，
 * 与 `.kiro/specs/l2-base-layer-spec/requirements.md` 要求 1.7 点名的五词一致
 * （其中「对象」因同样的歧义原因排除：`目标对象` 之类的普通行文不该被拒）。
 * 单独的「模板」在**代码侧**仍是硬禁——那里没有 i18n 文案与文档模板的语境。
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 被扫描的两棵活跃文档树。 */
const SCANNED_ROOTS = ['.kiro/specs', 'docs'] as const;

/**
 * 排除的历史档案目录（相对仓库根，正斜杠，含结尾斜杠）。
 *
 * 这些目录**已被文档自己声明为历史档案**，其中的过期措辞是史料而非现行规范：
 * - `docs/L_归档/`：归档目录。
 * - `docs/L1_引擎层/并行审查Prompt/`：59 份历史审查 Prompt，其 `00_状态基线.md` 明确写"非活动路线图"。
 * - `.kiro/specs/_归档/`：已废弃的 spec（其中 `wakeup-content_废弃_2026-08-05` 单文件就有 60+ 处废用词，
 *   目录名本身即为废用术语的产物）。
 */
const ARCHIVE_PREFIXES = [
  'docs/L_归档/',
  'docs/L1_引擎层/并行审查Prompt/',
  '.kiro/specs/_归档/',
] as const;

/** 归一化成仓库相对、正斜杠路径。 */
function toRepoRelative(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).split(sep).join('/');
}

/** 递归收集一棵树下的 Markdown 文件，跳过历史档案目录与 `node_modules`。 */
function collectMarkdownFiles(treeRoot: string): string[] {
  const collected: string[] = [];
  const pending: string[] = [resolve(REPO_ROOT, treeRoot)];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') {
          continue;
        }
        if (ARCHIVE_PREFIXES.some((prefix) => `${toRepoRelative(fullPath)}/`.startsWith(prefix))) {
          continue;
        }
        pending.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        collected.push(fullPath);
      }
    }
  }

  return collected.sort((left, right) => left.localeCompare(right, 'en'));
}

/** 统计某个词在文本中出现的次数。中文没有词边界，因此是纯子串计数。 */
function countOccurrences(text: string, term: string): number {
  let count = 0;
  let index = text.indexOf(term);
  while (index !== -1) {
    count += 1;
    index = text.indexOf(term, index + term.length);
  }
  return count;
}

/**
 * 硬禁的废用复合词。用 `\uXXXX` 转义书写：直接写字面量会让本守卫成为自己的命中项，
 * 与 `src/l2/model/constitution.ts`、`src/play/core-mechanics/ownership.ts` 采用同一手法。
 */
type DeprecatedCompoundId = 'base-content' | 'base-pattern' | 'base-pattern-kind' | 'play-package';

interface DeprecatedCompound {
  readonly id: DeprecatedCompoundId;
  readonly term: string;
  readonly canonical: string;
}

const DEPRECATED_COMPOUNDS: readonly DeprecatedCompound[] = [
  { id: 'base-content', term: '\u5185\u5bb9\u5c42', canonical: '基类层' },
  { id: 'base-pattern', term: '\u6a21\u677f\u5c42', canonical: '基类层' },
  { id: 'base-pattern-kind', term: '\u6a21\u677f\u7c7b\u578b', canonical: '基类' },
  { id: 'play-package', term: '\u73a9\u6cd5\u5305\u5c42', canonical: '玩法层' },
];

/**
 * 声明禁令或保存裁决原文的位置契约。
 *
 * 这不是整文件豁免：每个 context 以稳定文本锚点定位一组声明行，并逐词种断言精确次数。
 * 因此新增词种、增加次数、把合法声明删掉后在同文件其他位置补入同词，都会失败。
 */
interface DeclarationContextBaseline {
  readonly anchor: string;
  readonly counts: Readonly<Partial<Record<DeprecatedCompoundId, number>>>;
}

interface DeclarationFileBaseline {
  readonly reason: string;
  readonly contexts: readonly DeclarationContextBaseline[];
}

const DECLARATION_FILES: ReadonlyMap<string, DeclarationFileBaseline> = new Map([
  ['docs/L0_规范宪法.md', {
    reason: '宪法术语铁律本体必须列出废用别名',
    contexts: [
      { anchor: '| **基类层** |', counts: { 'base-content': 1, 'base-pattern': 1 } },
      { anchor: '| **玩法层** |', counts: { 'play-package': 1 } },
      { anchor: '| **基类** |', counts: { 'base-pattern-kind': 1 } },
    ],
  }],
  ['docs/访谈决策记录.md', {
    reason: 'D-001/D-022 的裁决原文按新术语重述，不再包含旧层名',
    contexts: [],
  }],
  ['docs/L1_引擎层/引擎层职责边界.md', {
    reason: '文件头记录 2026-08-05 术语迁移',
    contexts: [
      { anchor: '> **术语更新**', counts: { 'base-content': 1 } },
    ],
  }],
  ['docs/L_审查报告/spec-compiler-缺口审计.md', {
    reason: 'B-7 审计逐项比较需求与 NON_CANONICAL_TERMS',
    contexts: [
      {
        anchor: '需求 1.7 点名',
        counts: { 'base-content': 2, 'base-pattern': 2, 'base-pattern-kind': 2, 'play-package': 2 },
      },
    ],
  }],
  ['.kiro/specs/l2-base-layer-spec/requirements.md', {
    reason: '要求 1.7 定义 Definition_Validator 必须拒绝的词',
    contexts: [
      {
        anchor: '7. IF a normative definition replaces',
        counts: { 'base-content': 1, 'base-pattern': 1, 'base-pattern-kind': 1, 'play-package': 1 },
      },
    ],
  }],
  ['.kiro/specs/l2-base-layer-spec/tasks.md', {
    reason: '任务计划记录术语纪律的依据、实现与验收标准',
    contexts: [
      { anchor: '`内容层/模板/Layer 1/2/3` 作规范概念即拒', counts: { 'base-content': 1 } },
      { anchor: '源码不含 `内容层/模板/Layer N` 等废用标签', counts: { 'base-content': 1 } },
    ],
  }],
  ['.kiro/specs/wakeup-core-mechanics/design.md', {
    reason: '设计正文与自检表明确术语纪律',
    contexts: [
      { anchor: '禁用术语（不得作为规范概念出现）', counts: { 'base-content': 1 } },
      { anchor: '| 术语漂移 |', counts: { 'base-content': 1 } },
    ],
  }],
  ['.kiro/specs/wakeup-core-mechanics/tasks.md', {
    reason: 'validateTerminology 任务必须点名拒绝输入',
    contexts: [
      { anchor: '`validateTerminology(def)`', counts: { 'base-content': 1 } },
    ],
  }],
  ['.kiro/specs/wakeup-space-items/requirements.md', {
    reason: '要求 7 的废用术语与废案清单',
    contexts: [
      { anchor: '本领域的废用术语与废案至少包括', counts: { 'base-content': 1 } },
    ],
  }],
  ['.kiro/specs/wakeup-content-taxonomy-and-runtime-residency/design.md', {
    reason: '"内容层"是该 spec 自身的第四类内容范畴命名（与基类层/玩法层/表现系统并列的 taxonomy 设计概念），非 L0 废用别名"base-content"（"内容层/模板"的 archive 含义）',
    contexts: [
      { anchor: '### 内容层关系', counts: { 'base-content': 1 } },
    ],
  }],
  ['.kiro/specs/wakeup-ui-animation/requirements.md', {
    reason: '要求 7 的废用术语清单',
    contexts: [
      { anchor: '本 Spec 的废用术语至少包括', counts: { 'base-content': 1 } },
    ],
  }],
  ['.kiro/specs/meta-mechanism-kernel/design.md', {
    reason: '文档按历史原名引用被元机制 Spec 取代的旧架构',
    contexts: [
      { anchor: '旧三层架构', counts: { 'play-package': 1 } },
    ],
  }],
]);

/**
 * 已知违规基线（**目标值是 0，不是豁免**）。
 *
 * 这些活跃文档把废用别名当作层名在用，按 L0 §一 术语铁律应改写为规范术语。
 * 它们不在本轮任务的白名单内（分属文档所有者/其他线），因此登记为交接项而不是就地改掉
 * ——"不跨 Spec 改别人的交付物"。
 *
 * 采用"基线棘轮"形态（与 `src/play/__tests__/doc-alignment.test.ts` 同一手法）：断言**精确条数**。
 * 新增违规会失败；**修好违规也会失败**并强制更新本表——这样数字永远是真的，
 * 不会出现"登记表说还有 23 处、其实早就改完了"的漂移。
 */
const KNOWN_VIOLATIONS: ReadonlyMap<string, { readonly count: number; readonly owner: string }> = new Map([
]);

/** 已修好的历史违规被移出本表（棘轮只登记"本轮无权改动的既有违规"，目标状态是空表）。 */
const KNOWN_VIOLATIONS_RETIRED: readonly string[] = [
  'docs/L_归档/审查状态综合报告_历史.md',
  'docs/L_归档/12_根基完备性审查_v2_历史.md',
  'docs/L_归档/AI完备性与文档对齐分析_历史.md',
  'docs/L1_引擎层/05_底层引擎架构.md',
  'docs/工程治理/02_技术栈与开发流程.md',
  'docs/L_审查报告/PT-09_UI投影完成报告.md',
  'docs/并行作战/PT-09_执行完成总结.md',
];

interface DocumentTermHit {
  readonly file: string;
  readonly term: string;
  readonly canonical: string;
  readonly count: number;
}

/** 扫描全部活跃 Markdown，返回每个文件每个废用复合词的命中数（>0 才返回）。 */
function scanDeprecatedCompounds(): DocumentTermHit[] {
  const hits: DocumentTermHit[] = [];
  for (const treeRoot of SCANNED_ROOTS) {
    for (const absolutePath of collectMarkdownFiles(treeRoot)) {
      const text = readFileSync(absolutePath, 'utf8');
      for (const { term, canonical } of DEPRECATED_COMPOUNDS) {
        const count = countOccurrences(text, term);
        if (count > 0) {
          hits.push({ file: toRepoRelative(absolutePath), term, canonical, count });
        }
      }
    }
  }
  return hits;
}

describe('T1: 活跃规范文档的废用术语纪律（L0 §一 术语铁律的文档侧执行）', () => {
  it('扫描确实覆盖到了两棵文档树，断言不是在空集上空转', () => {
    for (const treeRoot of SCANNED_ROOTS) {
      expect(
        collectMarkdownFiles(treeRoot).length,
        `${treeRoot} 下没有收集到任何 .md 文件，遍历逻辑或仓库结构已变`,
      ).toBeGreaterThan(0);
    }
    // 历史档案确实被排除：`.kiro/specs/_归档/` 下那份废弃 spec 有 60+ 处废用词，若未排除必然出现在命中里。
    const hits = scanDeprecatedCompounds();
    expect(hits.some((hit) => hit.file.startsWith('.kiro/specs/_归档/'))).toBe(false);
    // 反向自检：命中集合非空，否则下面"没有意外文件"的断言会因扫描失效而假通过。
    expect(hits.length).toBeGreaterThan(0);
  });

  it('除「声明位置契约」与「已知违规基线」之外，没有活跃文档使用废用复合词', () => {
    const unexpected = scanDeprecatedCompounds()
      .filter((hit) => !DECLARATION_FILES.has(hit.file) && !KNOWN_VIOLATIONS.has(hit.file))
      .map((hit) => `${hit.file}: ${hit.count} 处 ${hit.term}（应改用「${hit.canonical}」）`)
      .sort();

    expect(
      unexpected,
      '这些活跃规范文档使用了 L0 §一 术语铁律列为废用别名的复合词。'
        + '若确属"声明禁令 / 记录裁决原文"的用法，请加入 DECLARATION_FILES 并登记精确位置契约；'
        + '若是真实误用，请改成规范术语——**不要**把它塞进 KNOWN_VIOLATIONS 了事，'
        + '那张表只登记本轮无权改动的既有违规，目标值是 0。',
    ).toEqual([]);
  });

  it('声明位置契约逐词种精确匹配，禁止整文件宽泛豁免与位置补位', () => {
    const drift: string[] = [];

    for (const [file, baseline] of DECLARATION_FILES) {
      let text: string;
      try {
        text = readFileSync(resolve(REPO_ROOT, file), 'utf8');
      } catch {
        drift.push(`${file}: 文件不存在（理由：${baseline.reason}）`);
        continue;
      }

      const duplicateAnchors = baseline.contexts
        .map((context) => context.anchor)
        .filter((anchor, index, all) => all.indexOf(anchor) !== index);
      if (duplicateAnchors.length > 0) {
        drift.push(`${file}: 位置契约含重复锚点 ${duplicateAnchors.join(', ')}`);
      }

      const lines = text.split(/\r?\n/);
      for (const [lineIndex, line] of lines.entries()) {
        const occurrences = DEPRECATED_COMPOUNDS.reduce(
          (sum, compound) => sum + countOccurrences(line, compound.term),
          0,
        );
        if (occurrences === 0) continue;

        const matchingContexts = baseline.contexts.filter((context) => line.includes(context.anchor));
        if (matchingContexts.length !== 1) {
          drift.push(
            `${file}:${lineIndex + 1}: ${occurrences} 处声明命中必须且只能属于一个位置契约，`
              + `实际匹配 ${matchingContexts.length} 个`,
          );
        }
      }

      for (const context of baseline.contexts) {
        const contextLines = lines.filter((line) => line.includes(context.anchor));
        if (contextLines.length === 0) {
          drift.push(`${file}: 位置锚点已消失：${context.anchor}`);
          continue;
        }
        for (const compound of DEPRECATED_COMPOUNDS) {
          const actual = contextLines.reduce(
            (sum, line) => sum + countOccurrences(line, compound.term),
            0,
          );
          const expected = context.counts[compound.id] ?? 0;
          if (actual !== expected) {
            drift.push(
              `${file} / ${context.anchor} / ${compound.id}: 基线 ${expected}，实测 ${actual}`,
            );
          }
        }
      }
    }

    expect(
      drift.sort(),
      '声明文件不是整文件豁免。每个命中必须位于唯一的已登记语义行，且每个位置的每个词种次数须精确匹配。'
        + '若合法声明被修订，请同步收紧位置契约；若是其他位置新增误用，请改回规范术语。',
    ).toEqual([]);
  });

  it('已知违规基线的条数精确匹配现实（改多了或改少了都必须更新本表）', () => {
    const hits = scanDeprecatedCompounds();
    const actual = new Map<string, number>();
    for (const hit of hits) {
      actual.set(hit.file, (actual.get(hit.file) ?? 0) + hit.count);
    }

    const drift: string[] = [];
    for (const [file, baseline] of KNOWN_VIOLATIONS) {
      const now = actual.get(file) ?? 0;
      if (now !== baseline.count) {
        drift.push(`${file}: 基线 ${baseline.count} 处，实测 ${now} 处（归属：${baseline.owner}）`);
      }
    }
    // 已移出本表（已修好）的文件不得复现旧层名——若再现就必须重新登记，而不是悄悄回到未点名状态。
    for (const file of KNOWN_VIOLATIONS_RETIRED) {
      if ((actual.get(file) ?? 0) > 0) {
        drift.push(`${file}: 已修好并移出基线表，但实测又出现 ${actual.get(file)} 处旧层名，需重新登记或改回规范术语`);
      }
    }

    expect(
      drift.sort(),
      '已知违规的条数变了。若是**修好了**，请把该文件从 KNOWN_VIOLATIONS 移除（或下调条数）——'
        + '这是好事，只需同步这张表；若是**新增了**，请改回规范术语。'
        + '本表的目标状态是空表。',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// T2：来源追踪完备性（审计清单 B-20 / wakeup-ai 要求 12.1）
// ---------------------------------------------------------------------------

/**
 * 「来源追踪」约定的采纳状态。
 *
 * 各 spec 并未统一采纳这一约定，因此不能一刀切要求所有 spec 都有；但**最坏的状态是"部分采纳"**
 * ——一半需求写了来源、一半没写，读者无法判断"没写"是遗漏还是不需要。因此本守卫只强制三件事：
 *
 * 1. `fully-adopted` 的 spec 必须**保持 100%**：新增需求若漏写来源追踪，立刻失败。
 *    这正是 `wakeup-ai` 要求 12.1「每一条需求都应包含来源追踪」的机器化形式。
 * 2. `not-adopted` 的 spec 必须**保持 0**：防止悄悄滑向"部分采纳"。若要采纳，就一次采纳到底
 *    并把状态改为 `fully-adopted`。
 * 3. `partially-adopted` 的 spec 断言**精确条数**，并在 `note` 里写明目标；它是需要收敛的欠债，
 *    不是可接受的稳态。
 *
 * 刻意**不**断言「要求小节总数」：那会让任何一条新增需求都撞红这张表，把守卫变成绊脚石。
 * 上面三条不变量在小节数变化时依然成立。
 */
type AdoptionState = 'fully-adopted' | 'not-adopted' | 'partially-adopted';

interface AdoptionBaseline {
  readonly state: AdoptionState;
  /** 仅 `partially-adopted` 使用：当前已写来源追踪的要求小节数。 */
  readonly withSourceTracing?: number;
  readonly note: string;
}

const SOURCE_TRACING_ADOPTION: ReadonlyMap<string, AdoptionBaseline> = new Map([
  ['.kiro/specs/wakeup-ai/requirements.md', {
    state: 'fully-adopted',
    note: '12/12 要求小节均带「来源追踪」。这是 PT-04 审计里要求 12.1 的机器化承载点',
  }],
  ['.kiro/specs/wakeup-core-mechanics/requirements.md', {
    state: 'fully-adopted',
    note: '19/19，采用 `### Requirement N` 标题式',
  }],
  ['.kiro/specs/wakeup-ugc/requirements.md', {
    state: 'fully-adopted',
    note: '16/16',
  }],
  ['.kiro/specs/wakeup-space-items/requirements.md', {
    state: 'fully-adopted',
    note: '14/14。本 spec 采用「可追踪来源：」四字加粗标签而非其他 spec 的「来源追踪：」三字标签，'
      + '两者是同一约定的不同措辞（均为逐条要求末尾的来源引用footer），故纳入同一检测视为已采纳',
  }],
  ['.kiro/specs/l2-base-layer-spec/requirements.md', {
    state: 'not-adopted',
    note: '16 条要求，0 采纳。该 spec 用 S-0x 来源表而非逐条「来源追踪」段',
  }],
  ['.kiro/specs/meta-mechanism-kernel/requirements.md', {
    state: 'not-adopted',
    note: '44 条要求，0 采纳',
  }],
  ['.kiro/specs/wakeup-ui-animation/requirements.md', {
    state: 'not-adopted',
    note: '18 条要求，0 采纳',
  }],
  ['.kiro/specs/wakeup-engine-layer/requirements.md', {
    state: 'not-adopted',
    note: '12 条要求，0 采纳。2026-08-14 引擎层增量审查与载器专项 Spec；the requirements use the same acceptance-criteria body style with a References section instead of per-requirement 来源追踪 footer',
  }],
  ['.kiro/specs/wakeup-engine-bombardment/requirements.md', {
    state: 'not-adopted',
    note: '11 条要求，0 采纳。2026-08-14 引擎层收官属性与压力测试 Spec（测试/验收规格）；接受标准体 + 要求子句回溯，无逐条来源追踪 footer',
  }],
  ['.kiro/specs/wakeup-base-layer-ecs/requirements.md', {
    state: 'not-adopted',
    note: '10 条要求，0 采纳。保持 not-adopted 的原因：本 spec 用「接受标准体 + 要求子句回溯」而非逐条「来源追踪」footer，不能改 fully-adopted（改 fully 会让守卫要求每节恰一个来源 footer而立即撞红）。2026-08-14 基类层 ECS 收敛专项（收束专项）PT-11 已完成实施且门禁全绿（tsc0/vitest3125/lint0err/verify:docs/verify:data/spec-document-discipline 8 绿）；产出=composition-registry.ts（component.* 集中登记）+ family-component-shapes.ts（8 族组件形状）+ composition-alignment-rules.ts（COMPOSITION_KIND_*/SYSTEM_BINDING_*）+ 10 属性测试（test/l2/properties/ecs-*）。基类层↔玩法层对接未闭合，登记为交接项 H-ECS-06/07。结构规则规范：组件契约单一源、家族目录收敛为组件形状、原子 System 接线、vehicle 降级为组合型组件族；接受标准体 + 要求子句回溯，无逐条来源追踪 footer',
  }],
  ['.kiro/specs/wakeup-base-layer-bombardment/requirements.md', {
    state: 'not-adopted',
    note: '属性/验收计数，0 采纳。2026-08-15 基类层收官属性+压力轰炸专项 Spec（测试/验收规格，非逐条来源追踪风格）。保持 not-adopted 的原因与 wakeup-base-layer-ecs 相同：用「接受标准体 + 要求子句回溯」而非逐条「来源追踪」footer。产出=src/class/__tests__/base-layer-bombardment-*.test.ts（6 文件）+ harness + composition-alignment-rules.ts 接线注。执行报告登记于本 spec 目录 execution-report.md。kernelOps↔OpRegistry.listOpNames 机械闭环升格；npcs/weapons 族特有待裁决未注册 Op 名登记为 KNOWN_FAMILY_PENDING_OPS',
  }],
  ['.kiro/specs/wakeup-cas-gap-closure/requirements.md', {
    state: 'not-adopted',
    note: '5 条要求。2026-08-15 CaS 缝隙闭合专项：把「组件字段名↔System 参数名同碰」的机器闭合从两条并列、规则不同、无单一依赖的实现收敛为单一权威判定函数 caSFieldMatches（src/l2/model/cas-field-alignment.ts）+ 单一诊断码 CAS_FIELD_GAP（入 src/l2/model/diagnostic-codes.ts）+ 生产态组合路径（src/play/profiles/audit.ts）可观察入口。保持 not-adopted 的原因与 wakeup-base-layer-ecs 相同：用「接受标准体 + 要求子句回溯」而非逐条「来源追踪」footer。涉及 src/play/**、src/class/** 的跨线交付物写权放开后落地，未授权则登记 T-CaS-04 交接；combat-first 阶段2 红测归 AI 并行线 T-CaS-03',
  }],
  ['.kiro/specs/wakeup-content-taxonomy-and-runtime-residency/requirements.md', {
    state: 'not-adopted',
    note: '内容分类与运行期驻留专项。design.md §"内容层关系"用「内容层」一词是该 spec 自身的概念命名（与「基类层/玩法层/表现系统」三架构层并列的第四类内容范畴），非 L0 废用别名；本 spec 用「接受标准体 + 要求子句回溯」而非逐条「来源追踪」footer，保持 not-adopted',
  }],
  ['.kiro/specs/wakeup-map-editor-devboard/requirements.md', {
    state: 'not-adopted',
    note: '地图编辑器开发板专项 requirements（并行产出，未采纳）。2026-08-15 开发板 web 应用 spec：Vite+React+TS 从零搭建的独立 web 应用（src/devboard/）。保持 not-adopted 的原因与 wakeup-base-layer-ecs 相同：接受标准体，非逐条「来源追踪」footer。此条为本会话维护 T2 门禁健壮性登记（守卫要求每个活跃 requirements.md 都显式选择状态，不得静默漏检）；其业务实现与 src/devboard/** 均属外部并行线交付物，不在本 AI 线审计范围',
  }],
  ['.kiro/specs/wakeup-full-body-wiring/requirements.md', {
    state: 'not-adopted',
    note: '全身接线专项（game-ui-shell-15 ↔ 地图/表现/元状态/电脑UI/素材/运行期事件/统一UI 端口全面接线工程）。保持 not-adopted 的原因与 wakeup-base-layer-ecs 相同：接受标准体 + 要求子句回溯，非逐条「来源追踪」footer',
  }],
  ['.kiro/specs/wakeup-map-editor-graffiti/requirements.md', {
    state: 'not-adopted',
    note: '开发板编辑器「涂鸦式交互」专项 requirements（2026-08-16 从 wakeup-map-editor-devboard 全面调研后重写的子集 spec，取代 devboard 的编辑内核章）。R1~R16：拉边拖拽描线/样条塑形/框选/全局输入过渡窗口/遮挡框/校验反馈/视觉零新增，全逐字落实 §八+§九（docs/创作系统/01_创作工具与产权.md）。保持 not-adopted 的原因与 wakeup-base-layer-ecs 相同：接受标准体 + 要求子句回溯，非逐条「来源追踪」footer。实现全部落 src/devboard/**（Vite+React+TS），不碰 src/play/map/** 契约；为此条维护 T2 门禁健壮性登记',
  }],
  ['.kiro/specs/wakeup-core-mechanics-exhaustive/requirements.md', {
    state: 'fully-adopted',
    note: '12/12（Requirement 20~31），采用 `### Requirement N` 标题式，每节恰一个「来源追踪：」footer。专项 CEME 玩法层彻查：结局种类/参与者资格/round 终局/出生规则/胜负结算/AI 接入/OVERLOAD_GAP 归属 + 额外扫描与交接项。编号从 20 起紧接 wakeup-core-mechanics 的 1~19，不重复已定义内容',
  }],
  ['.kiro/specs/wakeup-ai-tuning/requirements.md', {
    state: 'not-adopted',
    note: 'AI 调参器专项（2026-08-16 并行产出）：设计货币估值的调参/黄金场景/快照断言（src/core/kernel/ai/tuning/**）。保持 not-adopted 的原因与 wakeup-base-layer-ecs 相同：接受标准体 + 要求子句回溯，非逐条「来源追踪」footer。此条为维护 T2 门禁健壮性登记（守卫要求每个活跃 requirements.md 都显式选择状态，不得静默漏检）；其实现与 src/core/kernel/ai/tuning/** 均属并行线交付物，不在专项 B 审计范围',
  }],
  ['.kiro/specs/wakeup-loading-runtime/requirements.md', {
    state: 'fully-adopted',
    note: '12/12（Requirement 32~41），采用 `### Requirement N` 标题式，每节恰一个「来源追踪：」footer。专项 B 整合层装载运行期：生产组合根 createLoadedMatch、门禁面、对局外壳 MatchShell、生产加载驱动 driveMatch、演员面、UI 宿主 7 端口、LoadedMatch 门面、事件出口单次语义、门禁对齐与收账。编号从 32 起紧接 CEME 的 20~31；整合专项 A（CEME）/专项 D（注册表桥）承载面与已落地 loading-runtime 实现，收账含 OVERLOAD_GAP 归属（随 CEME Requirement 28 收束）、legacy ui-adapter 处置、04 规划文档归档 L_归档、主状态板入账',
  }],
  ['.kiro/specs/wakeup-mapdata-floor-layers/requirements.md', {
    state: 'not-adopted',
    note: 'MapData floor→layers 契约扩展独立专项（2026-08-18 新建）：使用接受标准体与 requirements/design/tasks 三件套承载，不采用逐条「来源追踪」footer；透明度口径与 legacy 兼容由该 spec 自身定义，当前保持 not-adopted 以匹配文档风格。',
  }],
  ['.kiro/specs/wakeup-orca-movement/requirements.md', {
    state: 'not-adopted',
    note: 'ORCA 寻路与移动系统独立专项（2026-08-19 并行产出）：使用需求陈述体（Rxxx When/then/验收标准），不采用逐条「来源追踪」footer；本条目为维护 T2 门禁健壮性登记（守卫要求每个活跃 requirements.md 都显式选择状态，不得静默漏检），实现属外部并行线交付物，不在装载等价专项审计范围',
  }],
  ['.kiro/specs/v0-frontend-workflow/requirements.md', {
    state: 'not-adopted',
    note: '偷师前端前置设计专项（2026-08-19 新建）：只收口 UI 壳层/状态切换/动效/提示词口径的 V0.dev 前置设计要求（作用域切分、输出口径、批次顺序、控制面板抽取边界），采用「要求 + 验收标准」体而非逐条「来源追踪」footer，保持 not-adopted 以匹配文档风格；内容为投喂 V0.dev 的提示词合同，不承接玩法规则/ORCA/地图拓扑',
  }],
  ['.kiro/specs/wakeup-material-library/requirements.md', {
    state: 'not-adopted',
    note: '素材库与研究台图形化与人机交互专项（2026-08-19 立项）：三设计需求化（创作/02 对接 R1 / 元状态层数据模型+状态转换 R2-R3 / UI 数据接口 R4 / 三界面切换 R5 / 两界面人机交互 R6-R7 / 图形化提取与 V0 投喂产物 R8 / 明确不做 R9），采用接受标准体 + 要求子句回溯，无逐条「来源追踪」footer，保持 not-adopted 以匹配文档风格；产出含 V0 投喂 MD（docs/v0-dev-material-library-spec.md、docs/v0-dev-bench-spec.md、docs/v0-dev-pixel-painter-spec.md）与 PLT-03/04 UI 草稿图提示词，实现（src/meta-state/** 等）列入该 spec tasks.md 批次 B/C',
  }],
  ['.kiro/specs/wakeup-presentation-layer/requirements.md', {
    state: 'not-adopted',
    note: '表现层架构独立专项（2026-08-19 新建）：四块架构（节点关系/空间/算法/端口面）+ ORCA 段1/段2 + 编排，采用需求陈述体（R001-Rxxx When/验收标准）而非逐条「来源追踪」footer，保持 not-adopted 以匹配文档风格；本条目为维护 T2 门禁健壮性登记（守卫要求每个活跃 requirements.md 都显式选择状态，不得静默漏检），实现属外部并行线交付物，不在素材库专项审计范围',
  }],
]);

/** 逐条要求的标题行：中文「要求 N」、「Requirement N」与「R\d+」三种标题式在本仓库并存。 */
const REQUIREMENT_HEADER_PATTERN = /^### (?:要求\s*\d+|Requirement\s*\d+|R\d+).*$/gm;

/**
 * not-adopted 的 spec 被扫描「要求小节」时，须能识别出至少一个要求小节。
 * 个别 spec 用「### N. 名称」序号标题式（无 Requirement/要求/R 前缀），扫描不到标题
 * 但确有要求实体；这类 spec 在此显式登记一个宽松标题锚，让 T2 守卫仍能扫到小节。
 * 无登记锚的 spec 照旧按 REQUIREMENT_HEADER_PATTERN 扫描。
 */
const NOT_ADOPTED_HEADER_ANCHORS: ReadonlyMap<string, RegExp> = new Map([
  ['.kiro/specs/v0-frontend-workflow/requirements.md', /^### \d+\.\s+/gm],
]);

/**
 * 「来源追踪」约定的两种等价措辞：多数 spec 用三字标签「来源追踪：」，
 * `wakeup-space-items` 用四字标签「可追踪来源：」——同一约定的不同措辞，须一并识别，
 * 否则会把它误判为 `not-adopted`。
 */
const SOURCE_TRACING_LABEL_PATTERN = /\*\*(?:来源追踪|可追踪来源)：\*\*/g;

interface RequirementSection {
  readonly heading: string;
  readonly sourceTracingLabels: number;
}

interface SourceTracingCount {
  readonly totalRequirements: number;
  /** 至少包含一个来源 footer 的要求小节数，而不是整份文件里的标签总数。 */
  readonly withSourceTracing: number;
  readonly sections: readonly RequirementSection[];
  /** 不属于任何要求小节的来源标签；这类标签不能证明任何要求可追踪。 */
  readonly orphanLabels: number;
}

function countLabels(text: string): number {
  return text.match(SOURCE_TRACING_LABEL_PATTERN)?.length ?? 0;
}

function countSourceTracing(relativePath: string): SourceTracingCount {
  const text = readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
  const headerPattern = NOT_ADOPTED_HEADER_ANCHORS.get(relativePath) ?? REQUIREMENT_HEADER_PATTERN;
  const headings = [...text.matchAll(headerPattern)];
  const sections = headings.map((heading, index): RequirementSection => {
    const start = heading.index;
    const end = headings[index + 1]?.index ?? text.length;
    return {
      heading: heading[0],
      sourceTracingLabels: countLabels(text.slice(start, end)),
    };
  });
  const firstRequirementStart = headings[0]?.index ?? text.length;

  return {
    totalRequirements: sections.length,
    withSourceTracing: sections.filter((section) => section.sourceTracingLabels > 0).length,
    sections,
    orphanLabels: countLabels(text.slice(0, firstRequirementStart)),
  };
}

function collectActiveRequirementFiles(): string[] {
  return collectMarkdownFiles('.kiro/specs')
    .map(toRepoRelative)
    .filter((file) => /^\.kiro\/specs\/[^/]+\/requirements\.md$/.test(file))
    .sort();
}

describe('T2: 来源追踪采纳状态守卫（审计清单 B-20 / wakeup-ai 要求 12.1 的文档侧执行）', () => {
  it('自动发现的每个活跃 requirements.md 都登记了采纳状态，且登记中没有失效路径', () => {
    const discovered = collectActiveRequirementFiles();
    const registered = [...SOURCE_TRACING_ADOPTION.keys()].sort();
    expect(
      registered,
      '活跃 requirements.md 与 SOURCE_TRACING_ADOPTION 不一致。新增 Spec 必须明确选择 fully-adopted、'
        + 'not-adopted 或 partially-adopted；不得静默漏检。',
    ).toEqual(discovered);
  });

  it('fully-adopted 的 spec 每个要求小节恰有一个来源 footer', () => {
    const regressions: string[] = [];
    for (const [file, baseline] of SOURCE_TRACING_ADOPTION) {
      if (baseline.state !== 'fully-adopted') continue;
      const result = countSourceTracing(file);
      if (result.totalRequirements === 0) {
        regressions.push(`${file}: 未识别到要求小节`);
      }
      if (result.orphanLabels > 0) {
        regressions.push(`${file}: 要求小节外有 ${result.orphanLabels} 个来源标签`);
      }
      for (const section of result.sections) {
        if (section.sourceTracingLabels !== 1) {
          regressions.push(
            `${file} / ${section.heading}: ${section.sourceTracingLabels} 个来源 footer（应恰有 1 个）`,
          );
        }
      }
    }
    expect(
      regressions,
      '这些已标记 fully-adopted 的 spec 没有做到逐要求小节恰有一个来源 footer。'
        + '不能用某一小节聚集多个标签来弥补另一小节缺失。',
    ).toEqual([]);
  });

  it('not-adopted 的 spec 每个要求小节保持 0 个来源 footer', () => {
    const regressions: string[] = [];
    for (const [file, baseline] of SOURCE_TRACING_ADOPTION) {
      if (baseline.state !== 'not-adopted') continue;
      const result = countSourceTracing(file);
      if (result.totalRequirements === 0) {
        regressions.push(`${file}: 未识别到要求小节`);
      }
      if (result.orphanLabels > 0) {
        regressions.push(`${file}: 要求小节外有 ${result.orphanLabels} 个来源标签`);
      }
      for (const section of result.sections) {
        if (section.sourceTracingLabels !== 0) {
          regressions.push(`${file} / ${section.heading}: 实测 ${section.sourceTracingLabels} 个（基线 0）`);
        }
      }
    }
    expect(
      regressions,
      '这些 spec 已标记 not-adopted，但检测到来源 footer。若确要采纳，请一次性采纳到底'
        + '并把状态改为 fully-adopted；不要停留在部分采纳。',
    ).toEqual([]);
  });

  it('partially-adopted 的 spec 逐节无重复，且带来源的小节数精确匹配基线', () => {
    const drift: string[] = [];
    for (const [file, baseline] of SOURCE_TRACING_ADOPTION) {
      if (baseline.state !== 'partially-adopted') continue;
      const result = countSourceTracing(file);
      const expected = baseline.withSourceTracing;
      if (expected === undefined) {
        drift.push(`${file}: partially-adopted 缺少 withSourceTracing 基线`);
      } else if (result.withSourceTracing !== expected) {
        drift.push(`${file}: 基线 ${expected}，实测 ${result.withSourceTracing}`);
      }
      if (result.totalRequirements === 0) {
        drift.push(`${file}: 未识别到要求小节`);
      }
      if (result.orphanLabels > 0) {
        drift.push(`${file}: 要求小节外有 ${result.orphanLabels} 个来源标签`);
      }
      for (const section of result.sections) {
        if (section.sourceTracingLabels > 1) {
          drift.push(`${file} / ${section.heading}: 重复 ${section.sourceTracingLabels} 个来源 footer`);
        }
      }
    }
    expect(
      drift,
      '部分采纳 spec 的来源追踪基线或逐节结构变了。改善后请更新条数或升为 fully-adopted；'
        + '变差时请补回来源 footer。',
    ).toEqual([]);
  });
});
