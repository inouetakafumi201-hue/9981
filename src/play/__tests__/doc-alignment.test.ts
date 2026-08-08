/**
 * 行动轮与体力系统的文档对齐契约。
 *
 * `docs/L3_玩法层/01_行动轮与体力博弈系统.md` 与 `src/play` 之间存在若干仍未消解的差异。按任务
 * 约束，这些差异只能记录、不能单方面裁决。但"只记录"很容易变成漂移：分歧被悄悄改掉、或新分歧
 * 被悄悄引入，都不会有人发现。
 *
 * 因此本文件对每条**可机械检测**的分歧实际断言它当前的状态。任何一条被修好或被改变形态，
 * 断言就会失败，从而强制同步更新 `known-divergences.ts`——而不是让登记表与实现各说各话。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseStrictDataJson } from '../../class/catalog-loader.js';
import type { JsonValue } from '../../core/kernel/spec-compiler/types.js';
import { loadPlayProfiles } from '../profiles/catalog.js';
import { allDocDivergences, type DocDivergence } from '../profiles/known-divergences.js';
import { classifyNumericField } from '../types/numeric-classification.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const PLAYPACK_PATH = resolve(TEST_DIR, '..', 'action-turn', 'playpack.json');

const playpack = parseStrictDataJson(
  readFileSync(PLAYPACK_PATH, 'utf8'),
  'action-turn/playpack.json',
  '玩法层',
) as Readonly<Record<string, JsonValue>>;

const playpackText = JSON.stringify(playpack);
const profiles = loadPlayProfiles();

function documentOf(sourceId: string): Readonly<Record<string, JsonValue>> {
  const found = profiles.find((profile) => profile.sourceId === sourceId);
  if (found === undefined) throw new Error(`profile ${sourceId} 不存在`);
  return found.document;
}

/** 取某条分歧的裁决记录；未裁决则抛错，避免测试把"没裁决"当成通过。 */
function divergenceResolution(code: string): NonNullable<DocDivergence['resolution']> {
  const entry = allDocDivergences().find((item) => item.code === code);
  if (entry === undefined) throw new Error(`分歧登记表没有 ${code}`);
  if (entry.resolution === undefined) throw new Error(`${code} 尚未登记裁决记录`);
  return entry.resolution;
}

/** 在玩法包的 `defs` 里按 id 取定义。 */
function playpackDef(id: string): Readonly<Record<string, JsonValue>> {
  const defs = playpack['defs'];
  if (!Array.isArray(defs)) throw new Error('playpack.defs 不是数组');
  for (const entry of defs) {
    if (entry !== null && !Array.isArray(entry) && typeof entry === 'object' && entry['id'] === id) {
      return entry;
    }
  }
  throw new Error(`playpack 没有定义 ${id}`);
}

describe('分歧登记表本身的完整性', () => {
  it('每条分歧都写明了文档位置、文档说法、实现说法、实现位置与说明', () => {
    const divergences = allDocDivergences();
    expect(divergences.length).toBeGreaterThan(0);
    for (const item of divergences) {
      expect(item.code, JSON.stringify(item)).toMatch(/^L3-DIV-\d{2}$/);
      expect(item.docSection.length, item.code).toBeGreaterThan(0);
      expect(item.documented.length, item.code).toBeGreaterThan(10);
      expect(item.implemented.length, item.code).toBeGreaterThan(10);
      expect(item.location.length, item.code).toBeGreaterThan(0);
      expect(item.note.length, item.code).toBeGreaterThan(10);
    }
  });

  it('编号唯一且连续，避免登记表出现空洞或重号', () => {
    const codes = allDocDivergences().map((item) => item.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toEqual(codes.map((_, index) => `L3-DIV-${String(index + 1).padStart(2, '0')}`));
  });

  it('已消解的条目必须交出裁决编号与可查位置，否则"已裁决"与"被人悄悄改掉"无从区分', () => {
    const resolved = allDocDivergences().filter((item) => item.resolution !== undefined);
    // 这条断言本身要有约束力：如果一条都没有，下面的循环空转，测试会变成一句空话。
    expect(resolved.length, '登记表里应当至少有一条已消解条目').toBeGreaterThan(0);
    for (const item of resolved) {
      const resolution = item.resolution;
      if (resolution === undefined) throw new Error(`${item.code} 过滤后仍无 resolution`);
      expect(resolution.decisionId, item.code).toMatch(/^[DU]-\d{3}/);
      expect(resolution.outcome.length, item.code).toBeGreaterThan(10);
      expect(resolution.recordedAt.length, item.code).toBeGreaterThan(0);
    }
  });
});

describe('L3-DIV-01 过载持续时长在玩法层内部就有两个数值', () => {
  it('status_overloaded 写 3 回合，玩法包写 2 次投点，两者仍不一致', () => {
    const breakConditions = documentOf('statuses/status_overloaded.json')['breakConditions'];
    expect(Array.isArray(breakConditions)).toBe(true);
    const turnCondition = (breakConditions as readonly JsonValue[])
      .map((entry) => (entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry : undefined))
      .find((entry) => entry?.['type'] === 'turn');
    expect(turnCondition?.['turns']).toBe(3);

    const rule = playpackDef('rule:overload-on-pool-overflow');
    expect(JSON.stringify(rule)).toContain('"remainingRolls":2');
  });
});

describe('L3-DIV-03 已由 D-054 消解：骰面数回到文档的 d6', () => {
  it('所有投点用骰都是 6 面，不再有残留的 d5', () => {
    const rolls = [...playpackText.matchAll(/"sides":(\d+)/g)].map((match) => Number(match[1]));
    expect(rolls.length).toBeGreaterThan(0);
    expect(new Set(rolls)).toEqual(new Set([6]));
  });

  it('裁决依据写在玩法包内，且点明骰点是内部量而非玩家可见数值', () => {
    // 只断言 sides=6 是不够的：d6 之所以不违反宪法四·4.2，靠的是"骰点不作为玩家可见数值"
    // 这条重分类。若哪天有人删掉这条依据、只留下 6 面骰，宪法冲突就悄悄回来了。
    const policy = (playpack['props'] as Readonly<Record<string, JsonValue>>)['resolutionPolicy'];
    const die = String((policy as Readonly<Record<string, JsonValue>>)['initiativeDie']);
    expect(die).toContain('D-054');
    expect(die).toContain('Internal_Metric');
  });

  it('骰点本身不进 AP 池：玩家可见的 AP 由档位分配给出，最大 3', () => {
    const apValues = [...playpackText.matchAll(/"let":"apValue","be":(\d+)/g)].map((m) => Number(m[1]));
    expect(apValues.length).toBeGreaterThan(0);
    expect(Math.max(...apValues)).toBe(3);
    expect(Math.min(...apValues)).toBe(0);
  });
});

describe('L3-DIV-04 已由 D-037/U-002 消解：按人数裁剪的档位模型已落地', () => {
  it('AP 结算读取投点参与人数作为档位参数', () => {
    expect(playpackText).toContain('"let":"apParticipantCount"');
    expect(playpackText).toContain('"let":"apMaxTier"');
    expect(playpackText).toContain('"let":"apLead"');
  });

  it('2 人局不产生 3 AP 档，3+ 人局唯一领先 ≥2 才得 3 AP', () => {
    // 断言分配算法的形状，而不只是"字段存在"：档位字段齐全但分支写错，是最容易漏掉的情形。
    expect(playpackText).toContain('"args":[{"var":"apParticipantCount"},2]');
    expect(playpackText).toContain('"args":[{"var":"apCountAtMax"},1]');
    expect(playpackText).toContain('{"op":"gte","args":[{"var":"apLead"},2]}');
  });

  it('单人局按 U-002 abort，不推断默认 AP', () => {
    expect(playpackText).toContain('"args":[{"var":"apParticipantCount"},1]');
    expect(playpackText).toContain('U-002');
    const policy = (playpack['props'] as Readonly<Record<string, JsonValue>>)['resolutionPolicy'];
    expect(String((policy as Readonly<Record<string, JsonValue>>)['singleParticipant'])).toContain('abort');
  });

  it('AP 仍然写入 AP 池，投点随机流未被改名', () => {
    expect(playpackText).toContain('"pool":"AP"');
    expect(playpackText).toContain('"stream":"action-turn.initiative"');
  });
});

describe('L3-DIV-05 常规逆转成本：规则正文 1 AP 与 §3.5 示例的 2 AP', () => {
  it('玩法包按规则正文取 1 AP', () => {
    expect(playpackDef('action:reverse')['cost']).toEqual([{ pool: 'AP', amount: 1 }]);
  });

  it('超逆转按文档取 2 SP', () => {
    expect(playpackDef('action:super-reverse')['cost']).toEqual([{ pool: 'SP', amount: 2 }]);
  });
});

describe('L3-DIV-06 失衡破除举盾在格挡 profile 里没有落地', () => {
  it('status_blocking 的解除条件与交互矩阵都不含 status_staggered', () => {
    const blocking = documentOf('statuses/status_blocking.json');
    expect(JSON.stringify(blocking['breakConditions'])).not.toContain('status_staggered');
    expect(JSON.stringify(blocking['interactionMatrix'])).not.toContain('status_staggered');
  });

  it('对照：瞄准 profile 已经写了被失衡打断，说明这不是"整套机制都没做"', () => {
    const aiming = documentOf('statuses/status_aiming.json');
    expect(JSON.stringify(aiming['breakConditions'])).toContain('status_staggered');
  });
});

describe('L3-DIV-07 招架"必须在最后一个 AP 使用"未实现', () => {
  it('action:parry 没有任何 require 前置条件', () => {
    expect(playpackDef('action:parry')['require']).toBeUndefined();
  });

  it('对照：窗口期动作确实带 require，说明缺失不是机制不支持', () => {
    expect(playpackDef('action:reverse')['require']).toBeDefined();
  });
});

describe('L3-DIV-08 弱点是否必然施加失衡', () => {
  it('玩法包按 §5.4/§6.4 实现为必然施加失衡', () => {
    expect(JSON.stringify(playpackDef('rule:weakness-hit'))).toContain('attachment:staggered');
  });

  it('弱点效果不改动伤害数值，与 D-049「弱点不使伤害翻倍」一致', () => {
    const rule = JSON.stringify(playpackDef('rule:weakness-hit'));
    expect(rule).not.toContain('damagePath');
    expect(rule).not.toContain('"mul"');
  });
});

describe('L3-DIV-09 医疗包 AP 成本冲突', () => {
  it('profile 取 1 AP，并在 unresolvedIssues 里留下未裁决记录', () => {
    const medkit = documentOf('items/item_medkit.json');
    const actions = medkit['actions'];
    expect(Array.isArray(actions)).toBe(true);
    const first = (actions as readonly JsonValue[])[0];
    expect(first !== null && typeof first === 'object' && !Array.isArray(first) ? first['apCost'] : undefined)
      .toBe(1);
    expect(JSON.stringify(medkit['unresolvedIssues'])).toContain('ITEM-MEDKIT-AP-COST');
  });
});

describe('L3-DIV-10 守卫"五状态范式"与实际四状态', () => {
  it('两个守卫 profile 的 FSM 都只有四个状态，并各自登记了未裁决记录', () => {
    for (const sourceId of ['npcs/guard_standard.json', 'npcs/guard_elite.json']) {
      const fsm = documentOf(sourceId)['fsm'];
      const states = fsm !== null && typeof fsm === 'object' && !Array.isArray(fsm) ? fsm['states'] : undefined;
      const names = states !== null && states !== undefined && typeof states === 'object' && !Array.isArray(states)
        ? Object.keys(states).sort()
        : [];
      expect(names, sourceId).toEqual(['attacking', 'chasing', 'listening', 'patrolling']);
      expect(JSON.stringify(documentOf(sourceId)['unresolvedIssues']), sourceId)
        .toContain('NPC-GUARD-STATE-NAMING');
    }
  });
});

describe('L3-DIV-11 迟缓的自述范围宽于其实际配置', () => {
  it('description 说"所有动作"，actionModifiers 只覆盖 move 与 attack', () => {
    const slowed = documentOf('statuses/status_slowed.json');
    expect(String(slowed['description'])).toContain('所有动作');

    const effects = slowed['effects'];
    const modifiers = effects !== null && typeof effects === 'object' && !Array.isArray(effects)
      ? effects['actionModifiers']
      : undefined;
    expect(Array.isArray(modifiers)).toBe(true);
    const covered = (modifiers as readonly JsonValue[])
      .map((entry) => (entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? entry['actionType']
        : undefined))
      .sort();
    expect(covered).toEqual(['attack', 'move']);
  });
});

describe('D-052 NPC 资源配置已按文档补齐', () => {
  const npcs = profiles.filter((profile) => profile.category === 'npcs');

  it('每个 NPC 都声明了 AP、体力上限、开局体力与是否主动使用体力', () => {
    expect(npcs.length).toBe(6);
    for (const npc of npcs) {
      const resources = npc.document['resources'];
      expect(resources !== null && typeof resources === 'object' && !Array.isArray(resources), npc.sourceId)
        .toBe(true);
      const record = resources as Readonly<Record<string, JsonValue>>;
      expect(record['actionPoints'], npc.sourceId).toBe(1);
      expect(record['staminaMax'], npc.sourceId).toBe(3);
      expect(record['initialStamina'], npc.sourceId).toBe(0);
      expect(record['usesStaminaActively'], npc.sourceId).toBe(false);
    }
  });

  it('NPC 不参与行动轮，且体力不可用于抢轮次（§9b.1 与 §9b.4 的硬性限制）', () => {
    for (const npc of npcs) {
      const record = npc.document['resources'] as Readonly<Record<string, JsonValue>>;
      expect(record['participatesInActionTurn'], npc.sourceId).toBe(false);
      expect(record['canSpendStaminaOnInitiative'], npc.sourceId).toBe(false);
    }
  });

  it('NPC 体力上限严格低于玩家的 5，才能让玩家在 PVE 里把它压到过载', () => {
    const playerCap = (playpack['pools'] as readonly JsonValue[])
      .map((entry) => (entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry : undefined))
      .find((entry) => entry?.['name'] === 'SP');
    expect(playerCap?.['max']).toBe(5);
    for (const npc of npcs) {
      const record = npc.document['resources'] as Readonly<Record<string, JsonValue>>;
      expect(Number(record['staminaMax']), npc.sourceId).toBeLessThan(Number(playerCap?.['max']));
    }
  });
});

describe('裁决记录的完整性', () => {
  const resolved = allDocDivergences().filter((item) => item.resolution !== undefined);

  it('每条已消解的分歧都交出了裁决编号、结论与记录位置', () => {
    expect(resolved.length).toBeGreaterThan(0);
    for (const item of resolved) {
      const resolution = divergenceResolution(item.code);
      expect(resolution.decisionId.length, item.code).toBeGreaterThan(0);
      expect(resolution.outcome.length, item.code).toBeGreaterThan(20);
      expect(resolution.recordedAt.length, item.code).toBeGreaterThan(0);
    }
  });

  it('裁决记录指向的位置真实存在，且能在那里找到裁决编号', () => {
    for (const item of resolved) {
      const resolution = divergenceResolution(item.code);
      const [path] = resolution.recordedAt.split(/\s/);
      if (path === undefined || !path.startsWith('src/')) continue;
      const filePath = path.split(/[ 与]/)[0]!.replace(/\.json.*$/, '.json');
      const text = readFileSync(resolve(TEST_DIR, '..', '..', '..', filePath), 'utf8');
      const primaryId = resolution.decisionId.split(/[ /]/)[0]!;
      expect(text.includes(primaryId), `${item.code} -> ${filePath} 应能找到 ${primaryId}`).toBe(true);
    }
  });

  it('D-054 把骰点归为内部量这一结论，与玩法层数值归属登记表保持一致', () => {
    const outcome = divergenceResolution('L3-DIV-03').outcome;
    expect(outcome).toContain('Internal_Metric');
    expect(classifyNumericField({
      key: 'sides', parent: undefined, path: '/actions/0/effects/0/sides', value: 6,
    })?.classification).toBe('Internal_Metric');
  });

  it('未消解的分歧不得声称有裁决编号', () => {
    for (const item of allDocDivergences()) {
      if (item.resolution !== undefined) continue;
      expect(JSON.stringify(item), item.code).not.toContain('decisionId');
    }
  });
});
