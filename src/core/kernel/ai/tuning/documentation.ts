/**
 * 表自述生成器（Task 12）——把费目表翻译成面向资深玩家的 Markdown。
 *
 * 目标读者可能不是程序员（可能是资深玩家的调试者），所以要把 `e:enemy.vitality` 式
 * 术语翻译成贴近玩家的语言（见 readableFieldName），并对单位当量、触发场景、调参历史、
 * ±0.5 影响做「模拟」说明。design.md §6「表自述生成器」+ §7「浅出输出」。
 */
import type { DesignCurrencyConfig, DesignCurrencyChargeConfig } from './config-design-currency.js';
import { readableFieldName } from './trace.js';
import type { ParameterTuningRecord } from './tuner.js';

/** 字段 → 玩家语言的映射（与 trace.readableFieldName 同源，避免重复维护）。 */
export { readableFieldName };

/** 一个费目的自述文档。 */
export interface FeeItemDocumentation {
  readonly feeItem: string;
  readonly markdown: string;
}

/** 面向玩家解释「单位当量」的词。 */
function unitMeaning(charge: DesignCurrencyChargeConfig): string {
  if (charge.field === 'E') return `越高表示它在激发攻击这一点上越重要；当前内部定价 ${charge.unit}。`;
  return `当前内部定价 ${charge.unit}（单位当量）。`;
}

/** 描述触发场景与分水岭/稀缺性。 */
function triggerScenario(charge: DesignCurrencyChargeConfig): string {
  const lines: string[] = [];
  if (charge.adjustment !== undefined) {
    lines.push(`- 触发专门修正：当观测值满足「${charge.adjustment.when}」时，直接加成 ${charge.adjustment.value} 分（覆盖常规当量）。`);
  }
  if (charge.scarcity !== undefined) {
    const s = charge.scarcity;
    lines.push(`- 稀缺性：真实值 ${s.floor}–${s.ceiling} 区间内越低，权重越高（最多上浮 ${Math.round(s.coefficient * 100)}%）。`);
  }
  if (charge.defeated !== undefined) {
    lines.push(`- 倒地威胁：当倒地标记满足「${charge.defeated.when}」时，给死亡锚的绝对惩罚（悬着未终结）。`);
  }
  if (lines.length === 0) lines.push('- 常规线性定价，不触发修正。');
  return lines.join('\n');
}

/**
 * 对单个费目生成人类可读 Markdown。
 * 会借上下文（可选）提供调参历史与正则谓词；缺上下文时输出独立的基础文档。
 */
export function generateFeeItemDocumentation(
  feeItem: string,
  config: DesignCurrencyConfig,
  history: readonly ParameterTuningRecord[] = [],
): FeeItemDocumentation {
  const charge = config.charges.find((c) => c.field === feeItem);
  const name = readableFieldName(feeItem);

  if (charge === undefined) {
    return {
      feeItem,
      markdown: [
        `## ${feeItem}`,
        '',
        `「${feeItem}」不在当前费目表里，无法生成自述。你可能是想描述一个新机制——这属于玩法级需求，应交人类裁决，不允许 agent 发明新费目。`,
      ].join('\n'),
    };
  }

  const records = history.filter((r) => r.change.feeItem === feeItem);
  const historyLines = records.length === 0
    ? '- 尚无针对此费目的调参记录。'
    : records.map((r) => {
        const dir = r.change.direction === 'increase' ? '提高' : '降低';
        const state = r.decision === 'accepted' ? '已接受' : r.decision === 'reverted' ? '已回滚' : '未确认';
        return `- ${dir}了 ${Math.abs(r.change.magnitude).toFixed(1)} 点（从 ${r.change.before} 到 ${r.change.after}，${state}）。依据：${r.change.reasoning || '未记录'}`;
      }).join('\n');

  // ±0.5 影响模拟：展示「临时提高/降低一步」后评分变化上界的一种解释。
  const sim = simulateHalfStep(charge);

  const markdown = [
    `## 「${name}」(${feeItem})`,
    '',
    charge.description,
    '',
    `**当前状态**：${unitMeaning(charge)}`,
    `- 可调范围 ${charge.tunableRange[0]}–${charge.tunableRange[1]}，步长 ${charge.step}`,
    `- 玩家可见：${charge.playerVisible ? '是 → 禁碰，agent 不得修改' : '否'}`,
    '',
    '### 触发场景',
    triggerScenario(charge),
    '',
    '### ±0.5 的影响模拟',
    `把这块定价临时调高或调低 ${charge.step}，本费目在每个候选的贡献大约会变 ${charge.step} 分（上下），`,
    `从而改变「值不值得选」的对比。例如在这费目拿 ${charge.unit} 分时，调高一步会变成约 ${sim.afterIncrease}，调低一步约 ${sim.afterDecrease}。`,
    '',
    '### 调整历史',
    historyLines,
  ].join('\n');

  return { feeItem, markdown };
}

/** 计算 ±step 后贡献的近似值（含稀缺不变、触发修正不在步进模拟内的保守说明）。 */
function simulateHalfStep(charge: DesignCurrencyChargeConfig): { afterIncrease: number; afterDecrease: number } {
  const step = charge.step;
  // 触发修正分支会直接覆盖当量，步进不改变它；这里只展示常规当量的近似。
  const ratioFor = (u: number): number => (charge.scarcity !== undefined ? u : u);
  return { afterIncrease: ratioFor(charge.unit + step), afterDecrease: ratioFor(Math.max(charge.tunableRange[0], charge.unit - step)) };
}

/** 生成整张费目表的简述（供 skill/文档开头概览）。 */
export function generateConfigOverview(config: DesignCurrencyConfig): string {
  const header = [
    '# 设计货币费目表（agent 可调）',
    '',
    `版本 ${config.version}`,
    '',
    '## 铁律（锁死，禁碰）',
    `- 死亡锚（死亡即最大惩罚）：${config.principles.deathAnchor}`,
    `- 致死窗口（值 ≤ 此值触发死亡锚）：${config.principles.lethalWindow}`,
    `- 资源耗尽锚（关键资源压零）：${config.principles.exhaustionAnchor}`,
    '',
    '## 费目',
    '',
  ];
  const rows = config.charges.map((c) => `- **${readableFieldName(c.field)}**（\`${c.field}\`）：${c.description}${c.playerVisible ? ' 【禁碰】' : ''}`);
  return [...header, ...rows, ''].join('\n');
}
