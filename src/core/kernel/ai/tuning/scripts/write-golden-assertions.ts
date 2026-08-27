/**
 * 生成 golden 断言 JSON 文件（Task 7 的磁盘落地 + skill 强制加载项）。
 *
 * 镜像 golden-scenarios.test.ts 的 GOLDEN_SCENARIOS（同一批 combat-first 语义场景）：
 * 对每个 golden spec 构造世界 → snapshotWorldState 得 stateHash+serialized → 组装成
 * BehaviorAssertion JSON。产出写到 `src/core/kernel/ai/tuning/assertions/*.json`，
 * 供 skill 强制加载清单校验（恰好 ≥10 条 golden）。
 *
 * 注意：golden-scenarios.test.ts 里的 GOLDEN_SCENARIOS 是本文件的事实源。若测试场景演变，
 * 需同步此文件（两者语义必须一致，属性 5/7 的回归测试会校验序列化往返）。
 */
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotWorldState } from '../snapshot';
import { createEmptyWorldState } from '../../../state/world-state';
import type { WorldState } from '../../../state/world-state';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'assertions');

function combatWorld(heroVitality: number, enemyVitality: number, opts: { downed?: boolean } = {}): string {
  const state: WorldState = createEmptyWorldState('sched:round');
  state.world.props.hiddenRefs = [] as never;
  state.world.props.aiCombatDamageRef = 1 as never;
  state.world.agents['g:ai'] = { ...(state.world.agents['g:ai'] ?? { kind: 'ai', knowledgeVersion: 'ks:ai' }) } as never;
  state.entities['e:hero'] = {
    def: 'd:fighter', kind: 'entity', node: 'n:hero-a', props: { vitality: heroVitality, initiative: 3 },
  } as never;
  state.entities['e:enemy'] = {
    def: 'd:fighter', kind: 'entity', node: 'n:enemy-a', props: { vitality: enemyVitality, initiative: opts.downed ? 0 : 2 },
    ...(opts.downed ? { tags: ['tag:downed'] } : {}),
  } as never;
  state.nodes['n:hero-a'] = { def: 'd:room', kind: 'node' } as never;
  state.nodes['n:enemy-a'] = { def: 'd:room', kind: 'node' } as never;
  state.nodes['n:far-a'] = { def: 'd:room' } as never;
  return JSON.stringify(state);
}

const GOLDEN_SCENARIOS = [
  { id: 'golden-sustain-001', category: 'sustain', description: '自身残血（1，致死窗口）→ 应优先保命', expectedAction: 'a:heal', build: () => combatWorld(1, 4), shouldNotSelect: [] },
  { id: 'golden-sustain-002', category: 'sustain', description: '自身残血（2）→ 绝不走自杀路径', expectedAction: 'a:heal', build: () => combatWorld(2, 4), shouldNotSelect: [] },
  { id: 'golden-aggro-001', category: 'aggro', description: '满血(5) + 残血敌(2) → 该补刀（进攻）', expectedAction: 'a:attack', build: () => combatWorld(5, 2), shouldNotSelect: [] },
  { id: 'golden-aggro-002', category: 'aggro', description: '满血(5) + 满血敌(4) → 攻击是正收益', expectedAction: 'a:attack', build: () => combatWorld(5, 4), shouldNotSelect: [] },
  { id: 'golden-defeat-001', category: 'defeat', description: '敌零血倒地未终结 → 令其长眠', expectedAction: 'a:eternal-sleep', build: () => combatWorld(5, 0, { downed: true }), shouldNotSelect: [] },
  { id: 'golden-defeat-002', category: 'defeat', description: '敌零血倒地：绝不再攻击一具尸体', expectedAction: 'a:eternal-sleep', build: () => combatWorld(5, 0, { downed: true }), shouldNotSelect: [] },
  { id: 'golden-resource-001', category: 'resource', description: 'AP>0 时不压零自断后路', expectedAction: '', build: () => combatWorld(4, 3), shouldNotSelect: ['a:overcharge'] },
  { id: 'golden-planning-001', category: 'planning', description: '我方残血(1) + 满血敌(3) → 不鲁莽（至少不送死）', expectedAction: '', build: () => combatWorld(1, 3), shouldNotSelect: ['a:attack'] },
  { id: 'golden-sustain-003', category: 'sustain', description: '血 3 在致死窗口 → 优先保命动作', expectedAction: 'a:heal', build: () => combatWorld(3, 4), shouldNotSelect: [] },
  { id: 'golden-aggro-003', category: 'aggro', description: '满血(5) + 敌方残血(1) → 补刀当量最高', expectedAction: 'a:attack', build: () => combatWorld(5, 1), shouldNotSelect: [] },
];

const assertions = GOLDEN_SCENARIOS.map((spec) => {
  const serialized = spec.build();
  const world = JSON.parse(serialized) as never;
  const snap = snapshotWorldState(world);
  return {
    id: spec.id,
    category: spec.category,
    description: spec.description,
    setup: { stateHash: snap.stateHash, serialized: snap.serialized },
    expect: {
      ...(spec.expectedAction === '' ? {} : { shouldSelect: spec.expectedAction }),
      ...(spec.shouldNotSelect.length > 0 ? { shouldNotSelect: spec.shouldNotSelect } : {}),
    },
    isGolden: true,
    source: 'initial',
  };
});

mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) {
  if (f.endsWith('.json')) unlinkSync(join(outDir, f));
}
for (const a of assertions) {
  writeFileSync(join(outDir, `${a.id}.json`), `${JSON.stringify(a, null, 2)}\n`, 'utf8');
}
console.log(`Wrote ${assertions.length} golden assertion files to ${outDir}`);
