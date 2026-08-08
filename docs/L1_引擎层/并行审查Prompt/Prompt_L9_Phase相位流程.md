# L9层：Phase + Flow — 属性测试任务

> **文件性质：历史执行 Prompt（方案 C — 属性实测轴，即工程验收的权威层编号）。已执行完毕。**
> 交付物：`kernel-l9-test`（11 项命名测试 / 220,008 次检查，PASS；修复 1 处缺陷：lock/unlock/nextReactionRound 未做 `E_FLOW_NOT_RUNNING` 哨兵检查）。
> 13 层总体结果与层编号映射见 [`00_状态基线.md`](00_状态基线.md) §2.1 与 §3.2；
> 分发依据见 [`EXECUTE_ALL_TESTS.md`](EXECUTE_ALL_TESTS.md)。
> **注意**：各子项目内部使用的错误码（如 `E_INTENT_*`/`E_PHASE_*`）是测试工程本地命名，
> 不等于内核封闭注册表 `src/core/kernel/state/error-codes.ts` 的成员；两者对账属未执行的跨层门禁，
> 见 [`00_开放事项跟踪.md`](00_开放事项跟踪.md) **T-03**。

## 任务目标

**用代码说话，不要推理。**

实现L9层相位/流程系统（Phase状态机、回合推进）+ 编写10万次属性测试 + 修复所有Bug + 提交报告。

---

## Step 1: 环境搭建

```bash
mkdir -p kernel-l9-test
cd kernel-l9-test
npm init -y
npm install fast-check typescript @types/node tsx vitest
npx tsc --init
```

---

## Step 2: 实现相位系统

```typescript
// src/phase.ts

export type PhaseStatus = 'inactive' | 'open' | 'locked' | 'resolved';

export interface PhaseDef {
  id: string;
  label: string;
  transitions: string[];     // 可以流转到的下一个PhaseId
  autoAdvance?: boolean;      // 没有Intent时是否自动推进
  reactionRounds?: number;    // 最大反应轮数
  ttl?: number | null;
}

export interface PhaseState {
  id: string;
  status: PhaseStatus;
  round: number;              // 当前反应轮
  openedAt: number;
  intents: string[];          // 本Phase内收集的Intent ID
}

export interface FlowDef {
  id: string;
  phases: PhaseDef[];
  initial: string;            // 起始PhaseId
}

export class FlowSystem {
  private flows: Map<string, FlowDef> = new Map();
  private currentFlow: string | null = null;
  private currentPhase: string | null = null;
  private phaseStates: Map<string, PhaseState> = new Map();
  private time: number = 0;

  registerFlow(def: FlowDef): void {
    // 验证：initial在phases中
    if (!def.phases.find(p => p.id === def.initial)) {
      throw new Error('E_FLOW_INVALID_INITIAL');
    }
    // 验证：transitions中的目标Phase都存在
    const phaseIds = new Set(def.phases.map(p => p.id));
    for (const p of def.phases) {
      for (const t of p.transitions) {
        if (!phaseIds.has(t)) throw new Error(`E_FLOW_INVALID_TRANSITION: ${p.id}→${t}`);
      }
    }
    this.flows.set(def.id, def);
  }

  startFlow(flowId: string): void {
    const flow = this.flows.get(flowId);
    if (!flow) throw new Error('E_REF_INVALID');
    if (this.currentFlow) throw new Error('E_FLOW_ALREADY_RUNNING');

    this.currentFlow = flowId;
    this.enterPhase(flow.initial);
  }

  private enterPhase(phaseId: string): void {
    const flow = this.flows.get(this.currentFlow!)!;
    const phaseDef = flow.phases.find(p => p.id === phaseId);
    if (!phaseDef) throw new Error('E_REF_INVALID');

    // 关闭上一个Phase
    if (this.currentPhase) {
      const prev = this.phaseStates.get(this.currentPhase);
      if (prev) prev.status = 'resolved';
    }

    this.currentPhase = phaseId;
    this.phaseStates.set(phaseId, {
      id: phaseId,
      status: 'open',
      round: 0,
      openedAt: this.time,
      intents: []
    });
  }

  // 推进到下一个Phase
  advance(toPhaseId?: string): void {
    if (!this.currentFlow || !this.currentPhase) throw new Error('E_FLOW_NOT_RUNNING');

    const flow = this.flows.get(this.currentFlow)!;
    const phaseDef = flow.phases.find(p => p.id === this.currentPhase)!;
    const state = this.phaseStates.get(this.currentPhase)!;

    // 只有open状态才能推进
    if (state.status !== 'open') throw new Error('E_PHASE_NOT_OPEN');

    // 验证目标Phase是合法transition
    if (toPhaseId) {
      if (!phaseDef.transitions.includes(toPhaseId)) {
        throw new Error('E_PHASE_INVALID_TRANSITION');
      }
      this.enterPhase(toPhaseId);
    } else {
      // 自动取第一个transition
      if (phaseDef.transitions.length === 0) {
        // 末端Phase：结束流程
        state.status = 'resolved';
        this.currentFlow = null;
        this.currentPhase = null;
      } else {
        this.enterPhase(phaseDef.transitions[0]);
      }
    }
  }

  // 锁定当前Phase（收集Intent阶段完成，进入解算）
  lockPhase(): void {
    const state = this.phaseStates.get(this.currentPhase!);
    if (!state || state.status !== 'open') throw new Error('E_PHASE_NOT_OPEN');
    state.status = 'locked';
  }

  unlockPhase(): void {
    const state = this.phaseStates.get(this.currentPhase!);
    if (!state || state.status !== 'locked') throw new Error('E_PHASE_NOT_LOCKED');
    state.status = 'open';
  }

  // 反应轮推进
  nextReactionRound(): void {
    const flow = this.flows.get(this.currentFlow!)!;
    const phaseDef = flow.phases.find(p => p.id === this.currentPhase)!;
    const state = this.phaseStates.get(this.currentPhase!)!;

    const maxRounds = phaseDef.reactionRounds ?? Infinity;
    if (state.round >= maxRounds) {
      throw new Error('E_FLOW_REACTION_LIMIT');
    }
    state.round++;
  }

  tick(deltaMs: number): void {
    this.time += deltaMs;
    this.checkTtl();
  }

  private checkTtl(): void {
    if (!this.currentPhase) return;
    const flow = this.flows.get(this.currentFlow!)!;
    const phaseDef = flow.phases.find(p => p.id === this.currentPhase)!;
    const state = this.phaseStates.get(this.currentPhase)!;

    if (phaseDef.ttl == null) return;
    const elapsed = this.time - state.openedAt;
    if (elapsed >= phaseDef.ttl) {
      // 自动推进
      try { this.advance(); } catch {}
    }
  }

  // 不变量检查
  checkInvariants(): Violation[] {
    const violations: Violation[] = [];

    // 最多一个Phase处于open状态
    const openPhases = [...this.phaseStates.values()].filter(s => s.status === 'open');
    if (openPhases.length > 1) {
      violations.push({ code: 'E_PHASE_MULTI_OPEN', detail: openPhases.map(p => p.id).join(',') });
    }

    // currentPhase必须在phaseStates中且为open或locked
    if (this.currentPhase) {
      const state = this.phaseStates.get(this.currentPhase);
      if (!state) {
        violations.push({ code: 'E_INV_DANGLING', detail: `currentPhase=${this.currentPhase} not in states` });
      } else if (state.status === 'resolved') {
        violations.push({ code: 'E_PHASE_CURRENT_RESOLVED', detail: this.currentPhase });
      }
    }

    // round不能超过reactionRounds
    if (this.currentFlow && this.currentPhase) {
      const flow = this.flows.get(this.currentFlow)!;
      const phaseDef = flow.phases.find(p => p.id === this.currentPhase);
      const state = this.phaseStates.get(this.currentPhase);
      if (phaseDef && state && phaseDef.reactionRounds != null) {
        if (state.round > phaseDef.reactionRounds) {
          violations.push({ code: 'E_FLOW_REACTION_OVERFLOW', detail: `round=${state.round} > max=${phaseDef.reactionRounds}` });
        }
      }
    }

    return violations;
  }

  getCurrentPhase() { return this.currentPhase; }
  getPhaseState(id: string) { return this.phaseStates.get(id); }
  isRunning() { return this.currentFlow != null; }
}

interface Violation { code: string; detail: string; }
```

---

## Step 3: 编写属性测试

```typescript
// test/l9-property.test.ts
import fc from 'fast-check';
import { FlowSystem, FlowDef } from '../src/phase';
import { describe, it, expect } from 'vitest';

// 共用Flow定义
const SAMPLE_FLOW: FlowDef = {
  id: 'battle',
  phases: [
    { id: 'start',    label: '开始',   transitions: ['plan'],    reactionRounds: 0 },
    { id: 'plan',     label: '计划',   transitions: ['response', 'resolve'], reactionRounds: 3 },
    { id: 'response', label: '响应',   transitions: ['plan', 'resolve'],     reactionRounds: 3 },
    { id: 'resolve',  label: '结算',   transitions: ['end'],     reactionRounds: 0 },
    { id: 'end',      label: '结束',   transitions: [] }
  ],
  initial: 'start'
};

describe('L9: Phase + Flow', () => {

  // 属性测试1：任意advance序列后无多个open Phase（10万次）
  it('任意advance序列后最多一个Phase处于open', () => {
    fc.assert(
      fc.property(
        fc.array(genRandomFlowOp(), { minLength: 1, maxLength: 20 }),
        (ops) => {
          const sys = new FlowSystem();
          sys.registerFlow(SAMPLE_FLOW);
          try { sys.startFlow('battle'); } catch {}

          for (const op of ops) {
            try { execFlowOp(sys, op); } catch {}
          }

          const v = sys.checkInvariants();
          if (v.length) console.error(v);
          return v.length === 0;
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试2：非法transition被拒绝（10万次）
  it('E_PHASE_INVALID_TRANSITION: 非法目标Phase被拒绝', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('start', 'plan', 'resolve', 'end'),
        fc.constantFrom('start', 'plan', 'response', 'resolve', 'end', 'nonexist'),
        (currentPhaseId, targetPhaseId) => {
          const phase = SAMPLE_FLOW.phases.find(p => p.id === currentPhaseId)!;
          const isValid = phase.transitions.includes(targetPhaseId);

          const sys = new FlowSystem();
          sys.registerFlow(SAMPLE_FLOW);
          sys.startFlow('battle');

          // 推进到目标Phase
          try {
            advanceToPhase(sys, currentPhaseId);
            sys.advance(targetPhaseId);

            // 若没抛异常，必须是合法transition
            return isValid;
          } catch (e: any) {
            // 若抛异常，必须是非法transition
            return !isValid && e.message === 'E_PHASE_INVALID_TRANSITION';
          }
        }
      ),
      { numRuns: 100000 }
    );
  });

  // 属性测试3：reactionRounds上限（1万次）
  it('E_FLOW_REACTION_LIMIT: round超限被拒绝', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }),
        (maxRounds) => {
          const flow: FlowDef = {
            id: 'test',
            phases: [
              { id: 'A', label: 'A', transitions: ['B'], reactionRounds: maxRounds },
              { id: 'B', label: 'B', transitions: [] }
            ],
            initial: 'A'
          };

          const sys = new FlowSystem();
          sys.registerFlow(flow);
          sys.startFlow('test');

          // 尝试超过maxRounds轮
          let roundsPassed = 0;
          for (let i = 0; i < maxRounds + 2; i++) {
            try {
              sys.nextReactionRound();
              roundsPassed++;
            } catch (e: any) {
              if (e.message === 'E_FLOW_REACTION_LIMIT') {
                // 必须恰好在第maxRounds+1次时报错
                return roundsPassed === maxRounds;
              }
              return false;
            }
          }
          return false; // 应该在某处报错
        }
      ),
      { numRuns: 10000 }
    );
  });

  // 边界测试：Flow注册时initial不在phases中
  it('E_FLOW_INVALID_INITIAL: initial不在phases中', () => {
    const sys = new FlowSystem();
    expect(() => sys.registerFlow({
      id: 'bad',
      phases: [{ id: 'A', label: 'A', transitions: [] }],
      initial: 'nonexist'
    })).toThrow('E_FLOW_INVALID_INITIAL');
  });

  // 边界测试：Flow注册时transition目标不存在
  it('E_FLOW_INVALID_TRANSITION: transition指向不存在的Phase', () => {
    const sys = new FlowSystem();
    expect(() => sys.registerFlow({
      id: 'bad',
      phases: [{ id: 'A', label: 'A', transitions: ['nonexist'] }],
      initial: 'A'
    })).toThrow('E_FLOW_INVALID_TRANSITION');
  });

  // 边界测试：末端Phase（transitions=[]）advance后Flow结束
  it('末端Phase advance后Flow结束', () => {
    const sys = new FlowSystem();
    sys.registerFlow(SAMPLE_FLOW);
    sys.startFlow('battle');

    advanceToPhase(sys, 'end');
    sys.advance();

    expect(sys.isRunning()).toBe(false);
  });

  // 边界测试：Phase locked时不能再advance
  it('locked Phase不能advance', () => {
    const sys = new FlowSystem();
    sys.registerFlow(SAMPLE_FLOW);
    sys.startFlow('battle');
    advanceToPhase(sys, 'plan');
    sys.lockPhase();

    expect(() => sys.advance('response')).toThrow('E_PHASE_NOT_OPEN');
  });

  // 边界测试：同时启动两个Flow
  it('E_FLOW_ALREADY_RUNNING: 不能同时启动两个Flow', () => {
    const sys = new FlowSystem();
    sys.registerFlow(SAMPLE_FLOW);
    sys.startFlow('battle');
    expect(() => sys.startFlow('battle')).toThrow('E_FLOW_ALREADY_RUNNING');
  });

  // 属性测试4：ttl超时自动advance（1万次）
  it('ttl过期后自动推进到下一Phase', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 100, max: 5000 }),
        (ttl) => {
          const flow: FlowDef = {
            id: 'timed',
            phases: [
              { id: 'A', label: 'A', transitions: ['B'], ttl },
              { id: 'B', label: 'B', transitions: [] }
            ],
            initial: 'A'
          };

          const sys = new FlowSystem();
          sys.registerFlow(flow);
          sys.startFlow('timed');

          expect(sys.getCurrentPhase()).toBe('A');

          sys.tick(ttl + 1);

          return sys.getCurrentPhase() === 'B' || !sys.isRunning();
        }
      ),
      { numRuns: 10000 }
    );
  });
});

// ---- 辅助 ----
type FlowOp =
  | { type: 'advance'; target: string }
  | { type: 'lock' }
  | { type: 'unlock' }
  | { type: 'nextRound' }
  | { type: 'tick'; delta: number };

function genRandomFlowOp() {
  return fc.oneof(
    fc.record({ type: fc.constant('advance' as const), target: fc.constantFrom('start','plan','response','resolve','end') }),
    fc.record({ type: fc.constant('lock' as const) }),
    fc.record({ type: fc.constant('unlock' as const) }),
    fc.record({ type: fc.constant('nextRound' as const) }),
    fc.record({ type: fc.constant('tick' as const), delta: fc.integer({ min: 1, max: 10000 }) })
  );
}

function execFlowOp(sys: FlowSystem, op: FlowOp) {
  switch (op.type) {
    case 'advance':   sys.advance(op.target); break;
    case 'lock':      sys.lockPhase(); break;
    case 'unlock':    sys.unlockPhase(); break;
    case 'nextRound': sys.nextReactionRound(); break;
    case 'tick':      sys.tick(op.delta); break;
  }
}

function advanceToPhase(sys: FlowSystem, targetId: string): void {
  const path: Record<string, string> = {
    start: 'start', plan: 'plan', response: 'response', resolve: 'resolve', end: 'end'
  };
  const order = ['start','plan','resolve','end'];
  for (const id of order) {
    if (id === targetId) break;
    try { sys.advance(order[order.indexOf(id) + 1]); } catch {}
  }
}
```

---

## Step 4 & 5: 执行 + 报告

```bash
npx vitest run
```

报告格式同L3。**开始执行。用代码说话，不要推理。**
