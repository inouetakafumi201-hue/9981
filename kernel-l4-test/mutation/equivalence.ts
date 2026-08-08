/**
 * L4 等价变异体差分模糊器
 *
 * 标注 expectEquivalent 的变异体"存活"是正确结果，但"我推理它等价"不是证据。
 * 本工具把每个这类变异体写成独立源文件，与原实现跑完全相同的随机操作序列，
 * 每一步都比对：抛出的错误、执行轨迹、结构快照、不变量输出。
 * 出现任何一处分歧即判定为"非等价"——那说明标注错了，它本该被测试杀死。
 *
 * 覆盖面要求：差分序列必须真正走到变异点所在的代码路径，否则"无分歧"只是
 * 没跑到而已。故场景同时包含全局 Hook 与实体物品规则（覆盖排序的
 * containerIndex/slotIndex/defId 各级）、反应队列、重入、深度、抛错。
 */
import fs from 'node:fs';
import path from 'node:path';
import { MUTANTS } from './mutants';
import { HookPhase, createEntity } from '../src/hook.js';
import type { Context, Entity, HookDef, PreventResult } from '../src/hook.js';

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const RESULT = path.join(ROOT, 'mutation', 'equivalence-result.json');

const SEQS = Number(process.env.EQUIV_SEQS ?? 3_000);
const OPS = Number(process.env.EQUIV_OPS ?? 30);
/** 哨兵只需证明"能被发现"，不必跑满；发现即提前退出。 */
const SENTINEL_SEQS = Number(process.env.EQUIV_SENTINEL_SEQS ?? 300);

/** mulberry32：确定性 PRNG，保证原实现与变异体收到逐位相同的操作序列。 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = ['A', 'B', 'C'];
const IDS = ['h1', 'h2'];
/**
 * 必须与 IDS 取值重叠。
 *
 * 全局 Hook 的 meta.defId 取 hook.id，物品规则的 meta.defId 取 item.def。
 * 两池若不相交，全局与物品在 defId 级永远分出胜负，末级 order 键便永远
 * 得不到表决机会——order 的排序贡献对差分不可见（M13 正因此漏检）。
 * 池重叠后，全局(0,0,id,registrationOrder) 与 hand 首槽物品(0,0,def,ruleIndex)
 * 可在前五级全部并列，而两者的 order 处于不同计数空间，可与收集序冲突。
 */
const DEFS = [...IDS];
const CONTAINERS = ['hand', 'backpack', 'belt'];
const PHASES: HookPhase[] = [
  HookPhase.Before,
  HookPhase.Modify,
  HookPhase.Instead,
  HookPhase.After,
];

type Action =
  | { kind: 'noop' }
  | { kind: 'emit'; target: string }
  | { kind: 'react'; target: string }
  | { kind: 'preventAll' }
  | { kind: 'preventExcept'; types: string[] }
  | { kind: 'throw' }
  /**
   * 把 ctx.result 抄进外部 sink。
   * Context 是 dispatch 内部现造后丢弃的，从系统外部无法观测；
   * 没有这个动作，"默认处理器返回值是否写入 ctx.result"这类契约对差分不可见。
   */
  | { kind: 'readResult' };

/** 一条 Hook 规范。全局 Hook 与物品规则共用，保证两侧构造完全一致。 */
interface RuleSpec {
  id: string;
  on: string;
  phase: HookPhase;
  priority: number | undefined;
  when: boolean;
  action: Action;
}

interface ItemSpec {
  id: string;
  def: string;
  destroyed: boolean;
  rules: RuleSpec[];
}

interface EntitySpec {
  /** 按 CONTAINERS 顺序给出每个容器的物品 */
  slots: ItemSpec[][];
}

type Step =
  | { kind: 'register'; rule: RuleSpec }
  | { kind: 'registerDefault'; type: string }
  | { kind: 'emit'; type: string; withEntity: boolean }
  | { kind: 'emitNull'; type: string }
  | { kind: 'collect'; type: string; withEntity: boolean }
  | { kind: 'check' };

interface Plan {
  entity: EntitySpec;
  steps: Step[];
}

function buildPlan(rand: () => number): Plan {
  const pick = <T,>(items: T[]): T => items[Math.floor(rand() * items.length)];

  const randomAction = (): Action => {
    const roll = rand();
    if (roll < 0.32) return { kind: 'noop' };
    if (roll < 0.44) return { kind: 'emit', target: pick(TYPES) };
    if (roll < 0.64) return { kind: 'react', target: pick(TYPES) };
    if (roll < 0.72) return { kind: 'preventAll' };
    if (roll < 0.84) {
      const count = Math.floor(rand() * 3);
      return {
        kind: 'preventExcept',
        types: Array.from({ length: count }, () => pick(TYPES)),
      };
    }
    if (roll < 0.94) return { kind: 'readResult' };
    return { kind: 'throw' };
  };

  const randomRule = (): RuleSpec => ({
    id: pick(IDS),
    on: pick(TYPES),
    phase: pick(PHASES),
    // undefined 用于考验 `priority ?? 0` 的缺省契约
    priority: rand() < 0.25 ? undefined : Math.floor(rand() * 3) - 1,
    when: rand() < 0.85,
    action: randomAction(),
  });

  // 实体：每个容器 0-2 个物品，每个物品 0-2 条规则。
  // 这让排序的 containerIndex / slotIndex / defId / order 各级都有并列机会。
  const slots: ItemSpec[][] = CONTAINERS.map((_, containerIndex) => {
    const itemCount = Math.floor(rand() * 3);
    return Array.from({ length: itemCount }, (_unused, slotIndex) => ({
      id: `i${containerIndex}${slotIndex}`,
      def: pick(DEFS),
      destroyed: rand() < 0.12,
      rules: Array.from({ length: Math.floor(rand() * 3) }, randomRule),
    }));
  });

  const steps: Step[] = [];
  for (let index = 0; index < OPS; index++) {
    const roll = rand();
    if (roll < 0.3) {
      steps.push({ kind: 'register', rule: randomRule() });
    } else if (roll < 0.38) {
      steps.push({ kind: 'registerDefault', type: pick(TYPES) });
    } else if (roll < 0.72) {
      steps.push({ kind: 'emit', type: pick(TYPES), withEntity: rand() < 0.6 });
    } else if (roll < 0.78) {
      steps.push({ kind: 'emitNull', type: pick(TYPES) });
    } else if (roll < 0.9) {
      steps.push({ kind: 'collect', type: pick(TYPES), withEntity: rand() < 0.7 });
    } else {
      steps.push({ kind: 'check' });
    }
  }

  return { entity: { slots }, steps };
}

/**
 * 观测器。
 *
 * `sink` 记录 Hook 内部可见但系统外部不可见的事件（执行顺序、ctx.result）。
 * `tags` 给每个 HookDef 一个唯一身份标签，且该标签不参与任何排序键。
 *
 * 为什么必须有 tags：排序末级 order 生效时，前几级键必然全部并列——这意味着
 * 参与比较的 id、defId、priority 都相等。此时若观测 hook.id，两个候选的观测串
 * 逐字节相同，顺序翻转对差分不可见（M13 正是这样漏检的）。唯一标签是唯一
 * 能让末级 tiebreak 可观测的手段。
 */
interface Recorder {
  sink: string[];
  tags: Map<HookDef, string>;
}

function makeEffect(
  action: Action,
  recorder: Recorder,
  tag: string,
): (ctx: Context) => void | PreventResult {
  return (ctx) => {
    // 进入即记录：sink 因此同时是"带唯一身份的执行顺序"记录。
    recorder.sink.push(`${tag}@${ctx.event}`);
    switch (action.kind) {
      case 'emit':
        ctx.emit(action.target);
        return undefined;
      case 'react':
        ctx.react(action.target);
        return undefined;
      case 'preventAll':
        return { preventAll: true };
      case 'preventExcept':
        return { preventExcept: [...action.types] };
      case 'readResult':
        recorder.sink.push(`${tag}:result=${JSON.stringify(ctx.result ?? null)}`);
        return undefined;
      case 'throw':
        throw new Error('boom');
      default:
        return undefined;
    }
  };
}

function toHook(spec: RuleSpec, recorder: Recorder, tag: string): HookDef {
  const hook: HookDef = {
    id: spec.id,
    on: spec.on,
    phase: spec.phase,
    when: () => spec.when,
    effect: makeEffect(spec.action, recorder, tag),
  };
  // priority 为 undefined 时不设该键，才能真正走到 `?? 0` 分支
  if (spec.priority !== undefined) hook.priority = spec.priority;
  recorder.tags.set(hook, tag);
  return hook;
}

/** 每次执行都重建实体，避免两侧共享可变状态。 */
function buildEntity(spec: EntitySpec, recorder: Recorder): Entity {
  const entity = createEntity('e', [...CONTAINERS]);
  spec.slots.forEach((items, containerIndex) => {
    const container = entity.containers[CONTAINERS[containerIndex]];
    items.forEach((item, slotIndex) => {
      container.addItem({
        id: item.id,
        def: item.def,
        destroyed: item.destroyed,
        rules: item.rules.map((rule, ruleIndex) =>
          toHook(rule, recorder, `c${containerIndex}s${slotIndex}r${ruleIndex}`),
        ),
      });
    });
  });
  return entity;
}

/** 任何 HookSystem 实现（原始或变异）都满足的最小结构约束。 */
interface AnySystem {
  registerHook(hook: HookDef): void;
  registerDefaultHandler(type: string, handler: (ctx: Context) => unknown): void;
  emit(type: string, data?: unknown): void;
  collectAndSortInstead(type: string, data?: unknown): HookDef[];
  checkInvariants(idle?: boolean): string[];
  snapshot(): unknown;
  startRecording(): void;
  takeTrace(): Array<Record<string, unknown>>;
}

type SystemCtor = new () => AnySystem;

/**
 * 按计划执行，返回每一步的规范化观测串。
 *
 * 观测内容刻意做到"过度充分"：错误信息、轨迹、完整结构快照、不变量输出。
 * 任何被变异点影响到的可见状态都会落在其中某一项里。
 */
function execute(Ctor: SystemCtor, plan: Plan): string[] {
  const system = new Ctor();
  system.startRecording();
  const recorder: Recorder = { sink: [], tags: new Map() };
  const entity = buildEntity(plan.entity, recorder);
  const observations: string[] = [];
  let registered = 0;

  for (const step of plan.steps) {
    // 每步只观测本步产生的 sink 增量，避免观测串随步数二次膨胀。
    recorder.sink.length = 0;
    let outcome = '';
    try {
      switch (step.kind) {
        case 'register':
          system.registerHook(toHook(step.rule, recorder, `g${registered++}`));
          outcome = 'registered';
          break;
        case 'registerDefault':
          // 返回非 undefined 值，才能走到"写入 ctx.result"分支；
          // 返回 undefined 会让该契约对差分永久不可见。
          system.registerDefaultHandler(step.type, (ctx) => `default:${ctx.event}`);
          outcome = 'default-registered';
          break;
        case 'emit':
          system.emit(step.type, step.withEntity ? { target: entity } : {});
          outcome = 'emitted';
          break;
        case 'emitNull':
          system.emit(step.type, null);
          outcome = 'emitted-null';
          break;
        case 'collect':
          // 观测唯一标签而非 hook.id：末级 tiebreak 生效时 id 必然并列，
          // 观测 id 会让顺序翻转不可见。
          outcome = `collected:${system
            .collectAndSortInstead(step.type, step.withEntity ? { target: entity } : {})
            .map((hook) => recorder.tags.get(hook) ?? '<untagged>')
            .join(',')}`;
          break;
        case 'check':
          outcome = `invariants:${system.checkInvariants().join('|')}`;
          break;
        default: {
          const exhaustive: never = step;
          void exhaustive;
        }
      }
    } catch (caught) {
      outcome = `threw:${(caught as Error).name}:${(caught as Error).message}`;
    }

    const trace = system
      .takeTrace()
      .map((e) => `${e.kind}:${e.type}:${e.phase}:${e.hookId}:${e.depth}`)
      .join(';');

    observations.push(
      [
        step.kind,
        outcome,
        `trace=${trace}`,
        `sink=${recorder.sink.join(',')}`,
        `snap=${JSON.stringify(system.snapshot())}`,
        `inv=${system.checkInvariants().join('|')}`,
      ].join('|'),
    );
  }

  return observations;
}

function mutatedSource(file: string, find: string, replace: string, id: string): string {
  const original = fs.readFileSync(path.join(SRC, file), 'utf8');
  const occurrences = original.split(find).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${id}: find 命中 ${occurrences} 次（要求恰好 1 次）`);
  }
  return original.replace(find, replace);
}

interface DiffOutcome {
  equivalent: boolean;
  firstDivergence: string | null;
  comparedSteps: number;
}

/**
 * 对一个变异体跑差分。返回是否未找到反例。
 *
 * 变异体源码引用 ./hook.js，必须与 src/ 同级才能解析相对导入，
 * 故写入 src/ 内的临时文件，跑完立刻删除（finally + 兜底 cleanup 双重保障）。
 */
async function diff(
  mutant: { id: string; file: string; find: string; replace: string },
  OriginalCtor: SystemCtor,
  sequences: number,
): Promise<DiffOutcome> {
  const tempName = `__equiv_${mutant.id}.ts`;
  const tempPath = path.join(SRC, tempName);
  fs.writeFileSync(
    tempPath,
    mutatedSource(mutant.file, mutant.find, mutant.replace, mutant.id),
    'utf8',
  );

  let equivalent = true;
  let firstDivergence: string | null = null;
  let comparedSteps = 0;

  try {
    const mutated = await import(`../src/${tempName}`);
    const MutantCtor = (mutated as { HookSystem: SystemCtor }).HookSystem;

    for (let seq = 0; seq < sequences && equivalent; seq++) {
      const plan = buildPlan(mulberry32(seq + 1));
      const left = execute(OriginalCtor, plan);
      const right = execute(MutantCtor, plan);

      for (let step = 0; step < left.length; step++) {
        comparedSteps++;
        if (left[step] !== right[step]) {
          equivalent = false;
          firstDivergence = [
            `seed=${seq + 1} 第 ${step + 1} 步分歧`,
            `步骤=${JSON.stringify(plan.steps[step])}`,
            `原始=${left[step]}`,
            `变异=${right[step]}`,
          ].join('\n     ');
          break;
        }
      }
    }
  } finally {
    fs.rmSync(tempPath, { force: true });
  }

  return { equivalent, firstDivergence, comparedSteps };
}

interface MutantReport {
  id: string;
  desc: string;
  equivalent: boolean;
  sequences: number;
  operations: number;
  comparedSteps: number;
  firstDivergence: string | null;
}

/**
 * 自检哨兵：这些变异体确定不等价。
 *
 * 若差分模糊对它们也报"等价"，说明模糊器本身没走到对应代码路径——
 * 那么它对 expectEquivalent 变异体给出的"等价"结论同样不可信。
 * 哨兵覆盖：排序各级、收集过滤、阶段顺序、prevent 语义、深度、重入、反应、默认处理器。
 */
const SENTINELS = [
  // 与 M15（排序不复制数组）同处排序路径
  'M01', // priority 排序方向
  'M09', // defId 级 tiebreak
  'M13', // order 级 tiebreak
  'M17', // 收集过滤
  'M33', // 阶段顺序
  // 与 M44（instead 恒不阻止）同处 prevent 路径
  'M40', // preventAll 语义
  'M43', // preventExcept 语义
  // 与 M50（depth 归零不清栈）同处 dispatch 的 finally 块
  'M49', // depth 递减被移除
  'M51', // 抛错时不复原 depth
  'M52', // 重入检测
  // 与 M61 / M64（反应队列清理）同处反应路径
  'M57', // 反应轮上限
  'M67', // 默认处理器返回值
];

/**
 * 刻意不作哨兵的变异体及原因（记录在案，避免日后误以为是遗漏）：
 *
 * - M46/M47/M48（depth 上限边界）：需要构造 32 层嵌套 dispatch，而重入锁在
 *   TYPES×IDS = 6 个不同 (type, hookId) 帧处即拦截，随机搜索到不了该边界。
 *   这是随机差分的固有覆盖上限，只能由确定性用例覆盖——它们已被
 *   l4-dispatch-model / l4-regression 中的确定性深度用例杀死，不依赖本工具。
 *   同一 finally 块改用 M49/M51 作哨兵，对 M50 的判定力反而更强。
 */

async function main(): Promise<boolean> {
  const targets = MUTANTS.filter((mutant) => mutant.expectEquivalent);
  if (targets.length === 0) {
    process.stdout.write('没有标注 expectEquivalent 的变异体，无需差分。\n');
    return true;
  }

  const original = await import('../src/hook-system.js');
  const OriginalCtor = (original as unknown as { HookSystem: SystemCtor }).HookSystem;

  // ---- 第 1 步：自检。模糊器必须先证明自己能发现分歧 ----
  const sentinelMutants = SENTINELS.map((id) => {
    const found = MUTANTS.find((mutant) => mutant.id === id);
    if (!found) throw new Error(`自检哨兵 ${id} 不在变异体清单中`);
    if (found.expectEquivalent) throw new Error(`自检哨兵 ${id} 被标注为等价，不能作哨兵`);
    return found;
  });

  process.stdout.write(
    `第 1 步 自检：${sentinelMutants.length} 个已知不等价的哨兵必须全部被差分发现\n\n`,
  );

  const blindSentinels: string[] = [];
  for (const mutant of sentinelMutants) {
    const outcome = await diff(mutant, OriginalCtor, SENTINEL_SEQS);
    if (outcome.equivalent) {
      blindSentinels.push(mutant.id);
      process.stdout.write(`  ${mutant.id} 漏检!!  ${mutant.desc}\n`);
    } else {
      process.stdout.write(
        `  ${mutant.id} 已发现  ${mutant.desc}\n     ↳ ${outcome.comparedSteps} 步内出现分歧\n`,
      );
    }
  }

  if (blindSentinels.length > 0) {
    process.stdout.write(
      `\n自检失败：哨兵 ${blindSentinels.join(', ')} 未被发现。\n` +
        '模糊器覆盖不到这些路径，因此它给出的任何"等价"结论都不成立。\n',
    );
    fs.writeFileSync(
      RESULT,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          selfTestPassed: false,
          blindSentinels,
          report: [],
        },
        null,
        2,
      ),
      'utf8',
    );
    return false;
  }

  process.stdout.write('\n自检通过：模糊器对以上各条路径均有区分能力。\n\n');

  // ---- 第 2 步：对标注为等价的变异体求反例 ----
  process.stdout.write(
    `第 2 步 差分：${targets.length} 个待证变异体 × ${SEQS} 条序列 × ${OPS} 操作\n\n`,
  );

  const report: MutantReport[] = [];
  let allEquivalent = true;

  for (const mutant of targets) {
    const outcome = await diff(mutant, OriginalCtor, SEQS);
    if (!outcome.equivalent) allEquivalent = false;
    report.push({
      id: mutant.id,
      desc: mutant.desc,
      equivalent: outcome.equivalent,
      sequences: SEQS,
      operations: OPS,
      comparedSteps: outcome.comparedSteps,
      firstDivergence: outcome.firstDivergence,
    });

    process.stdout.write(
      outcome.equivalent
        ? `  ${mutant.id} 等价      ${mutant.desc}\n     ↳ ${outcome.comparedSteps.toLocaleString('en-US')} 步观测逐字节一致，未找到反例\n`
        : `  ${mutant.id} 非等价!!  ${mutant.desc}\n     ↳ ${outcome.firstDivergence}\n`,
    );
  }

  fs.writeFileSync(
    RESULT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        selfTestPassed: true,
        sentinels: SENTINELS,
        sequences: SEQS,
        operations: OPS,
        allEquivalent,
        report,
      },
      null,
      2,
    ),
    'utf8',
  );

  process.stdout.write(
    allEquivalent
      ? '\n全部标注为等价的变异体均已由差分模糊证明：其存活不是测试漏洞。\n'
      : '\n存在标注错误的变异体：它并非等价，本该被测试杀死。\n',
  );
  return allEquivalent;
}

/** 兜底清理：任何路径退出都不留临时变异体源文件。 */
function cleanup(): void {
  for (const entry of fs.readdirSync(SRC)) {
    if (entry.startsWith('__equiv_')) fs.rmSync(path.join(SRC, entry), { force: true });
  }
}

main()
  .then((ok) => {
    cleanup();
    process.exit(ok ? 0 : 1);
  })
  .catch((error) => {
    cleanup();
    console.error(error);
    process.exit(1);
  });
