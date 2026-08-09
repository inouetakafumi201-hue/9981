import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { stripComments } from '../../__tests__/support/source-scan.js';
import { makeInternalMetric } from '../../presentation/gameplay-value.js';
import {
  CONFIRMED_DECISION_IDS,
  SALIENCE_TIERS,
  findSalienceTierEntry,
  freezePresentationProfile,
  isConfirmedDecisionId,
  isSalienceTier,
  type PresentationProfile,
  type SalienceTierEntry,
} from '../profile.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const PROFILE: PresentationProfile = {
  version: '1.1.0',
  visualDirection: {
    interactionComponents: 'pixel-art',
    mapBackground: 'sketch',
    compositing: 'separated-foreground-background',
    authoritativeSource: 'D-024',
  },
  ceremonialActionSemantics: [{ actionSemanticId: 'vault-window', authoritativeSource: 'D-026' }],
  salienceTiers: [
    { stateSemanticId: 'weakness', tier: 'public-persistent', renderer: 'above-head-icon', authoritativeSource: 'D-031' },
    { stateSemanticId: 'parry-ready', tier: 'hidden', renderer: null, authoritativeSource: 'D-032' },
  ],
  turnOrderBar: {
    edge: 'left',
    persistent: true,
    entryFields: ['portrait', 'name', 'health', 'stamina'],
    spentEntryTreatment: 'desaturate',
    rollAnimationAnchor: 'beside-entry',
    authoritativeSource: 'D-035, D-036',
  },
  endTurnCountdown: {
    seconds: makeInternalMetric(3, 's'),
    cancellable: true,
    authoritativeSource: 'D-042',
  },
  safeFieldWhitelist: [],
  safeUnavailabilityReasons: {},
  eventBufferTimeout: makeInternalMetric(2_000, 'ms'),
};

describe('Presentation_Profile schema', () => {
  it('分层是三档闭合枚举', () => {
    expect(SALIENCE_TIERS).toEqual(['public-persistent', 'public-on-inspect', 'hidden']);
    expect(isSalienceTier('team-only')).toBe(false);
  });

  it('tier 与 authoritativeSource 为必填', () => {
    // @ts-expect-error 缺少 tier 的分层声明在类型层不可构造
    const missingTier: SalienceTierEntry = { stateSemanticId: 's', renderer: null, authoritativeSource: 'D-031' };
    // @ts-expect-error 缺少 authoritativeSource 的分层声明在类型层不可构造
    const missingSource: SalienceTierEntry = { stateSemanticId: 's', tier: 'hidden', renderer: null };
    expect(missingTier).toBeTruthy();
    expect(missingSource).toBeTruthy();
  });

  it('集合字段是只读类型：就地修改在类型层被拒绝', () => {
    // 下面三行的断言就是"它们无法通过类型检查"本身：若某天类型被放宽成可变，
    // 期待错误的编译指示会因为"没有错误可期待"而让 npm run typecheck 失败。
    // 运行期不可变性是另一件事，由下一个用例在冻结后的 profile 上断言
    //（TypeScript 的 readonly 只在编译期生效，光靠类型无法阻止运行期写入）。
    const typeLevelChecks = (profile: PresentationProfile): void => {
      // @ts-expect-error 仪式集合是只读数组
      profile.ceremonialActionSemantics.push({ actionSemanticId: 'x', authoritativeSource: 'D-026' });
      // @ts-expect-error 白名单是只读数组
      profile.safeFieldWhitelist.push('leak');
      // @ts-expect-error profile 顶层字段是只读的
      profile.version = '2.0.0';
    };
    // 刻意不调用：这些语句的价值在于通不过类型检查，而不是在运行期抛错。
    expect(typeof typeLevelChecks).toBe('function');
  });

  it('冻结后的 profile 在运行期拒绝写入', () => {
    const frozen = freezePresentationProfile(PROFILE);
    expect(() => {
      (frozen as { version: string }).version = '2.0.0';
    }).toThrow(TypeError);
    expect(() => {
      (frozen.safeFieldWhitelist as string[]).push('leak');
    }).toThrow(TypeError);
    expect(frozen.version).toBe('1.1.0');
  });

  it('freezePresentationProfile 深冻结全部集合与嵌套记录', () => {
    const frozen = freezePresentationProfile(PROFILE);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.ceremonialActionSemantics)).toBe(true);
    expect(Object.isFrozen(frozen.ceremonialActionSemantics[0])).toBe(true);
    expect(Object.isFrozen(frozen.salienceTiers)).toBe(true);
    expect(Object.isFrozen(frozen.salienceTiers[0])).toBe(true);
    expect(Object.isFrozen(frozen.turnOrderBar)).toBe(true);
    expect(Object.isFrozen(frozen.turnOrderBar.entryFields)).toBe(true);
    expect(Object.isFrozen(frozen.endTurnCountdown)).toBe(true);
    expect(Object.isFrozen(frozen.endTurnCountdown.seconds)).toBe(true);
    expect(Object.isFrozen(frozen.safeFieldWhitelist)).toBe(true);
    expect(Object.isFrozen(frozen.safeUnavailabilityReasons)).toBe(true);
    expect(Object.isFrozen(frozen.eventBufferTimeout)).toBe(true);
  });

  it('hidden 档的 renderer 为 null，且查不到的分层返回 undefined', () => {
    expect(findSalienceTierEntry(PROFILE, 'parry-ready')?.renderer).toBeNull();
    expect(findSalienceTierEntry(PROFILE, 'not-declared')).toBeUndefined();
  });
});

describe('profile 类型不承载规则语义或玩家可见数值', () => {
  it('schema 源文件里没有规则语义字段名，也没有玩法数值类型', () => {
    // 扫描剥离注释后的代码：文档注释需要引用 `GameplayValue` 来解释"为什么它不在这里"，
    // 把注释一起匹配会让"越把边界写清楚、越触发违规"。
    const source = stripComments(readFileSync(resolve(HERE, '../profile.ts'), 'utf8'));
    const forbiddenFieldNames = [
      'damage',
      'apCost',
      'hitBonus',
      'dc',
      'forceVisible',
      'alwaysEnabled',
      'legality',
      'randomStream',
    ];
    for (const name of forbiddenFieldNames) {
      expect(new RegExp(`readonly\\s+${name}\\b`, 'u').test(source), name).toBe(false);
    }
    expect(/\bGameplayValue\b/u.test(source)).toBe(false);
  });

  it('profile 中唯一的数字字段都是 Internal_Metric', () => {
    expect(PROFILE.endTurnCountdown.seconds.__brand).toBe('InternalMetric');
    expect(PROFILE.eventBufferTimeout.__brand).toBe('InternalMetric');
  });
});

describe('已确认决策目录与权威文档一致', () => {
  it('目录中的每个编号在访谈决策记录中都标记为已确认', () => {
    const document = readFileSync(resolve(HERE, '../../../../docs/访谈决策记录.md'), 'utf8');
    const confirmed = new Set<string>();
    for (const block of document.split(/^### /mu)) {
      const id = /^(D-\d+)/u.exec(block)?.[1];
      if (id === undefined) continue;
      if (/状态\*\*：已确认/u.test(block)) confirmed.add(id);
    }
    expect(confirmed.size).toBeGreaterThan(0);
    const notConfirmed = CONFIRMED_DECISION_IDS.filter((id) => !confirmed.has(id));
    expect(notConfirmed).toEqual([]);
  });

  it('目录判定是精确匹配，不接受未列入的编号', () => {
    expect(isConfirmedDecisionId('D-032')).toBe(true);
    expect(isConfirmedDecisionId('D-061')).toBe(false);
    expect(isConfirmedDecisionId('D-999')).toBe(false);
  });
});
