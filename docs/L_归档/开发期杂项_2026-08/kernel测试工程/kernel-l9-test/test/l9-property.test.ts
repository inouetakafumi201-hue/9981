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
          try { sys.startFlow('battle'); } catch { /* 已在运行时忽略 */ }

          for (const op of ops) {
            try { execFlowOp(sys, op); } catch { /* 非法操作被拒绝，符合预期 */ }
          }

          const v = sys.checkInvariants();
          if (v.length) console.error(v);
          return v.length === 0;
        }
      ),
      { numRuns: 100_000 }
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
      { numRuns: 100_000 }
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
      { numRuns: 10_000 }
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
      { numRuns: 10_000 }
    );
  });

  // 边界测试：nextReactionRound在无Flow运行时不应崩溃(TypeError)，必须抛出明确错误
  it('E_FLOW_NOT_RUNNING: 无Flow运行时nextReactionRound抛出明确错误而非崩溃', () => {
    const sys = new FlowSystem();
    expect(() => sys.nextReactionRound()).toThrow('E_FLOW_NOT_RUNNING');
  });

  // 边界测试：lockPhase/unlockPhase在无Flow运行时抛出明确错误
  it('E_FLOW_NOT_RUNNING: 无Flow运行时lockPhase/unlockPhase抛出明确错误', () => {
    const sys = new FlowSystem();
    expect(() => sys.lockPhase()).toThrow('E_FLOW_NOT_RUNNING');
    expect(() => sys.unlockPhase()).toThrow('E_FLOW_NOT_RUNNING');
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
    fc.record({ type: fc.constant('advance' as const), target: fc.constantFrom('start', 'plan', 'response', 'resolve', 'end') }),
    fc.record({ type: fc.constant('lock' as const) }),
    fc.record({ type: fc.constant('unlock' as const) }),
    fc.record({ type: fc.constant('nextRound' as const) }),
    fc.record({ type: fc.constant('tick' as const), delta: fc.integer({ min: 1, max: 10_000 }) })
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
  const order = ['start', 'plan', 'resolve', 'end'];
  for (const id of order) {
    if (id === targetId) break;
    try { sys.advance(order[order.indexOf(id) + 1]); } catch { /* 中途失败不影响后续尝试 */ }
  }
}
