/**
 * L2 Compiler: 废案清单（禁止的规范输入）。
 *
 * 对应 Requirements 16.7–16.8。条目摘自 `docs/_术语表与废案清单.md`
 * 「二、废案清单（禁止再写入文档）」与「降级为可选内容的机制」两节，
 * 以该文档为唯一事实来源；本文件不新增、不删改任何废案判定。
 */

import type { DecisionId, SourceFileId } from '../model/ids';
import type { HumanReadableText } from '../model/ids';
import type { SourceLocation, SourceRecord } from '../model/source';
import { GLOSSARY_FILE } from './decision-catalog';

export const DEPRECATION_SOURCE_FILE: SourceFileId = GLOSSARY_FILE;

const VETOED_SECTION = '二、废案清单（禁止再写入文档）/ 已明确否决的机制';
const DEMOTED_SECTION = '二、废案清单 / 降级为可选内容的机制';

/** 废案条目状态。 */
export const DEPRECATION_STATUSES = ['vetoed', 'demoted-to-optional'] as const;
export type DeprecationStatus = (typeof DEPRECATION_STATUSES)[number];

export interface DeprecatedMechanicEntry {
  readonly mechanic: string;
  readonly status: DeprecationStatus;
  readonly vetoReason: HumanReadableText;
  readonly section: string;
  readonly decisionId?: DecisionId;
}

export const DEPRECATED_MECHANICS: readonly DeprecatedMechanicEntry[] = Object.freeze([
  {
    mechanic: '死后化床',
    status: 'vetoed',
    vetoReason: '与出生点床冲突，破坏床的神圣性，无端增加实体。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '多米诺长眠',
    status: 'vetoed',
    vetoReason: '击倒传导太反常识，连锁击败超标。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '霸体',
    status: 'vetoed',
    vetoReason: '来源方自认为坏点子。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '感知衰减表',
    status: 'vetoed',
    vetoReason: '过于复杂，改用场景类型影响衰减程度。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '噪音残影',
    status: 'vetoed',
    vetoReason: '无效设计。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '尸体系统',
    status: 'vetoed',
    vetoReason: '搜尸与拖拽尸体全部改为死亡背包实体。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '护甲增加抗伤害值',
    status: 'vetoed',
    vetoReason: '隐性心智负担。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '耐久系统',
    status: 'vetoed',
    vetoReason: '如无必要，勿增属性。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '体积分类',
    status: 'vetoed',
    vetoReason: '三档体积分类被废弃，改为占 1 格 / 占 2 格二分。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '口袋槽位',
    status: 'vetoed',
    vetoReason: '删除，改为初始背包 2 格。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '已发现关系系统',
    status: 'vetoed',
    vetoReason: '"找到"不是关系，而是进入微型场景。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '回合外反击',
    status: 'vetoed',
    vetoReason: '违反回合制纯洁性。',
    section: VETOED_SECTION,
  },
  {
    mechanic: 'Overwatch',
    status: 'vetoed',
    vetoReason: '违反回合制纯洁性。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '意图机作为顶层决策',
    status: 'vetoed',
    vetoReason: '改为搜索 + 随机选择器；意图只是宏动作生成器。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '曼哈顿距离',
    status: 'vetoed',
    vetoReason: '节点非网格，不存在坐标系。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '接敌面',
    status: 'vetoed',
    vetoReason: '多余设计；正确的承担者是过渡场景阻挡机制。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '通用AI适配器',
    status: 'vetoed',
    vetoReason: '已被估值服务完全覆盖，无需重复实现。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '13号文档命令式API体系',
    status: 'vetoed',
    vetoReason: '命令式 API 与内核 Op/Expr/Effect 架构不兼容，已归档。',
    section: VETOED_SECTION,
  },
  {
    mechanic: '格斗系统',
    status: 'demoted-to-optional',
    vetoReason: '在 MVP 中降级为可选内容，不进入核心标配。',
    section: DEMOTED_SECTION,
    decisionId: 'D-010',
  },
  {
    mechanic: '盾牌特殊交互',
    status: 'demoted-to-optional',
    vetoReason: '扔盾 / 盾击等随格斗系统一并降级为可选内容，不进入 MVP 标配。',
    section: DEMOTED_SECTION,
    decisionId: 'D-015',
  },
] as const satisfies readonly DeprecatedMechanicEntry[]);

const BY_MECHANIC: ReadonlyMap<string, DeprecatedMechanicEntry> = new Map(
  DEPRECATED_MECHANICS.map((entry) => [entry.mechanic, entry] as const),
);

export function findDeprecatedMechanic(mechanic: string): DeprecatedMechanicEntry | undefined {
  return BY_MECHANIC.get(mechanic);
}

/**
 * 在任意文本中查找废案机制名。
 *
 * 用于对来源陈述与候选定义做确定性扫描。匹配是**精确子串**匹配，
 * 不做模糊/近似匹配 —— 近似匹配会把合法内容误判为废案。
 */
export function findDeprecatedMechanicsInText(text: string): readonly DeprecatedMechanicEntry[] {
  return DEPRECATED_MECHANICS.filter((entry) => text.includes(entry.mechanic));
}

export function deprecationSourceLocation(entry: DeprecatedMechanicEntry): SourceLocation {
  return { sourceFile: DEPRECATION_SOURCE_FILE, section: entry.section };
}

/** 构造废案条目对应的控制性 Source_Record（Requirements 16.8 要求诊断引用它）。 */
export function deprecationSourceRecord(entry: DeprecatedMechanicEntry): SourceRecord {
  const location = deprecationSourceLocation(entry);
  const record: SourceRecord = {
    sourceFile: DEPRECATION_SOURCE_FILE,
    sourceLocation: location,
    precedence: 'confirmed-interview-decision',
    classification: 'Historical_Example',
    owningLayer: '基类层',
    statementFingerprint: `deprecated:${entry.mechanic}`,
    ...(entry.decisionId === undefined ? {} : { decisionId: entry.decisionId }),
  };
  return Object.freeze(record);
}
