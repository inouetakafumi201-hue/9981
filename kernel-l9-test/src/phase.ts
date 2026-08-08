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

export interface Violation { code: string; detail: string; }

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
    if (!this.currentPhase) throw new Error('E_FLOW_NOT_RUNNING');
    const state = this.phaseStates.get(this.currentPhase);
    if (!state || state.status !== 'open') throw new Error('E_PHASE_NOT_OPEN');
    state.status = 'locked';
  }

  unlockPhase(): void {
    if (!this.currentPhase) throw new Error('E_FLOW_NOT_RUNNING');
    const state = this.phaseStates.get(this.currentPhase);
    if (!state || state.status !== 'locked') throw new Error('E_PHASE_NOT_LOCKED');
    state.status = 'open';
  }

  // 反应轮推进
  nextReactionRound(): void {
    if (!this.currentFlow || !this.currentPhase) throw new Error('E_FLOW_NOT_RUNNING');
    const flow = this.flows.get(this.currentFlow)!;
    const phaseDef = flow.phases.find(p => p.id === this.currentPhase)!;
    const state = this.phaseStates.get(this.currentPhase)!;

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
      try { this.advance(); } catch { /* noop: 状态非open时忽略 */ }
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
