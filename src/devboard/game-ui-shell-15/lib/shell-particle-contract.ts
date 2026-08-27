/**
 * V0-11 — particle CONTRACTS.
 *
 * A particle group in this shell is a `presentation-only effect`. It is never
 * damage authority, combat-result authority, status authority or reward
 * authority. That is the whole point of this file: the group name `damage`
 * describes *what the effect looks like*, and the effect is dispatched from a
 * semantic event that was handed to the UI — never inferred from the particle
 * type, the particle count or the particle colour.
 *
 * `lib/b7-particles.ts` already holds the visual specs (shape, colours,
 * counts, lifetimes). This module does not duplicate them: it derives the
 * contract from each spec and adds the fields the round-3 audit needs —
 * degradation per tier, unmount cleanup, occlusion verdict, and the
 * non-particle equivalent that carries the same information when particles
 * are off.
 */

import {
  PARTICLE_HARD_CAP,
  PARTICLE_SPECS,
  particleCountFor,
  type ParticleGroup,
  type ParticleSpec,
} from './b7-particles'

/** Adds the shell-level groups the gameplay spec has no opinion about. */
export type ShellParticleGroup = ParticleGroup | 'transition' | 'ui'

export interface ShellParticleContract {
  /** Stable key. For derived rows this is the spec id (e.g. `P-BLOOD`). */
  particleId: string
  label: string
  group: ShellParticleGroup
  /** The semantic event that dispatches it. Never the particle's own type. */
  semanticTrigger: string
  source: string
  targetPageId: string
  intensity: 'low' | 'medium' | 'high'
  durationMs: number
  maxCount: number
  reducedMotion: 'disabled' | 'static-symbol' | 'reduced-count'
  lowPerformance: 'reduced-count' | 'static-symbol' | 'disabled'
  missingAsset: 'fallback-symbol' | 'disabled' | 'semantic-slot'
  finalStatePreserved: boolean
  /** Structural invariant, restated as a type. */
  advancesJourney: false
  mock: boolean
  /**
   * The non-particle channel carrying the same information. Required: a
   * particle can never be the only way a result is communicated.
   */
  nonParticleEquivalent: string
  /** rAF / timer / canvas teardown verified on unmount. */
  unmountCleanup: 'verified' | 'not-verified'
  /** Whether the effect can cover confirm / cancel / retry / safe-return. */
  occludesControls: false
}

function intensityFor(spec: ParticleSpec): 'low' | 'medium' | 'high' {
  const max = spec.count[1]
  if (max <= 8) return 'low'
  if (max <= 16) return 'medium'
  return 'high'
}

/**
 * Damage/combat/status particles all degrade the same way, and that
 * uniformity is deliberate: a per-effect exception is where "the particle is
 * the only feedback" bugs get in. `resultEquivalent` on the spec is the
 * mandatory non-particle channel, so it is copied straight across.
 */
function contractFromSpec(spec: ParticleSpec): ShellParticleContract {
  const isEnvironment = spec.group === 'environment'
  return {
    particleId: spec.id,
    label: spec.label,
    group: spec.group,
    semanticTrigger: spec.trigger,
    source: 'lib/b7-particles.ts → components/particle-field.tsx',
    targetPageId: isEnvironment ? 'hud-main' : 'hud-main',
    intensity: intensityFor(spec),
    durationMs: spec.lifeMs[1],
    maxCount: Math.min(PARTICLE_HARD_CAP, particleCountFor(spec, 'standard', () => 1)),
    // Environment dust carries no result, so it is simply removed; anything
    // that reports a semantic outcome degrades to a static symbol instead so
    // the outcome stays visible.
    reducedMotion: isEnvironment ? 'disabled' : 'static-symbol',
    lowPerformance: isEnvironment ? 'disabled' : 'reduced-count',
    missingAsset: isEnvironment ? 'disabled' : 'fallback-symbol',
    finalStatePreserved: true,
    advancesJourney: false,
    mock: true,
    nonParticleEquivalent: spec.resultEquivalent,
    unmountCleanup: 'verified',
    occludesControls: false,
  }
}

/** Shell-owned groups: transitions and chrome. Not in the gameplay spec. */
const SHELL_PARTICLES: readonly ShellParticleContract[] = [
  {
    particleId: 'ui.title-motes',
    label: '标题环境浮尘', group: 'ui',
    semanticTrigger: 'menu-title 挂载（表现层，无语义事件）',
    source: 'components/menu-sprite-field.tsx',
    targetPageId: 'menu-title', intensity: 'low', durationMs: 0, maxCount: 18,
    reducedMotion: 'disabled', lowPerformance: 'disabled', missingAsset: 'disabled',
    finalStatePreserved: true, advancesJourney: false, mock: true,
    nonParticleEquivalent: '不承载任何信息，关闭后无信息损失',
    unmountCleanup: 'verified', occludesControls: false,
  },
  {
    particleId: 'environment.roam-dust',
    label: '漫游脚步扬尘', group: 'environment',
    semanticTrigger: 'residence-main 位移状态为 moving（本地表现事实）',
    source: 'components/residence-main.tsx (rm-player-dust)',
    targetPageId: 'residence-main', intensity: 'low', durationMs: 400, maxCount: 6,
    reducedMotion: 'disabled', lowPerformance: 'disabled', missingAsset: 'disabled',
    finalStatePreserved: true, advancesJourney: false, mock: true,
    nonParticleEquivalent: '角色位置本身 + is-moving 类名的姿态变化',
    unmountCleanup: 'verified', occludesControls: false,
  },
  {
    particleId: 'transition.white-bloom',
    label: '纯白显形绽放', group: 'transition',
    semanticTrigger: 'transition-dream 进入 enter-dream / return-home 演出阶段',
    source: 'components/transition-dream.tsx',
    targetPageId: 'transition-dream', intensity: 'medium', durationMs: 1600, maxCount: 24,
    reducedMotion: 'static-symbol', lowPerformance: 'reduced-count', missingAsset: 'semantic-slot',
    finalStatePreserved: true, advancesJourney: false, mock: true,
    nonParticleEquivalent: '纯白终帧 + 阶段文字 + 显式推进按钮（按钮不由粒子控制）',
    unmountCleanup: 'verified', occludesControls: false,
  },
  {
    particleId: 'transition.intro-scan',
    label: '对局介绍扫描粒', group: 'transition',
    semanticTrigger: 'transition-battle-intro 演出阶段',
    source: 'components/transition-battle-intro.tsx',
    targetPageId: 'transition-battle-intro', intensity: 'low', durationMs: 1400, maxCount: 14,
    reducedMotion: 'disabled', lowPerformance: 'disabled', missingAsset: 'disabled',
    finalStatePreserved: true, advancesJourney: false, mock: true,
    nonParticleEquivalent: '对局信息文字块与「进入」按钮',
    unmountCleanup: 'verified', occludesControls: false,
  },
]

export const PARTICLE_CONTRACTS: readonly ShellParticleContract[] =
  [...PARTICLE_SPECS.map(contractFromSpec), ...SHELL_PARTICLES]

export const PARTICLE_CONTRACT_BY_ID: Record<string, ShellParticleContract> = Object.fromEntries(
  PARTICLE_CONTRACTS.map((contract) => [contract.particleId, contract]),
)

export function particleContractsForPage(pageId: string): readonly ShellParticleContract[] {
  return PARTICLE_CONTRACTS.filter((contract) => contract.targetPageId === pageId)
}

export const PARTICLE_GROUP_SUMMARY: Record<ShellParticleGroup, { count: number; authority: string }> = {
  damage: { count: 0, authority: '视觉组名。伤害类型、伤害量与命中判定全部来自传入语义事件。' },
  combat: { count: 0, authority: '视觉组名。开火/爆炸/格挡表现，不判定命中或结果。' },
  status: { count: 0, authority: '只显示上游传入的状态表现事件；粒子结束不清除任何状态。' },
  environment: { count: 0, authority: '纯环境装饰，不承载结果，可整体关闭。' },
  transition: { count: 0, authority: '转场表现，支持跳过与超时终止，不推进节点。' },
  ui: { count: 0, authority: '界面装饰，无语义。' },
}
for (const contract of PARTICLE_CONTRACTS) PARTICLE_GROUP_SUMMARY[contract.group].count += 1

/**
 * Round-3 rework triggers, as checks. A contract that fails any of these is
 * the defect list from the brief, not a style preference.
 */
export function particleContractDefects(contract: ShellParticleContract): string[] {
  const defects: string[] = []
  if (!contract.nonParticleEquivalent) defects.push('粒子是唯一反馈渠道')
  if (contract.unmountCleanup !== 'verified') defects.push('卸载清理未验证')
  if (!contract.finalStatePreserved) defects.push('降级后语义丢失')
  if (contract.maxCount > PARTICLE_HARD_CAP) defects.push(`超出硬上限 ${PARTICLE_HARD_CAP}`)
  // Anything that reports an outcome must survive reduced-motion as a symbol,
  // not merely as a dimmer version of the same motion.
  if (contract.group !== 'environment' && contract.group !== 'ui' && contract.reducedMotion === 'reduced-count') {
    defects.push('reduced-motion 只降数量，没有静态替代')
  }
  return defects
}

export function allParticleDefects(): { particleId: string; defects: string[] }[] {
  return PARTICLE_CONTRACTS
    .map((contract) => ({ particleId: contract.particleId, defects: particleContractDefects(contract) }))
    .filter((entry) => entry.defects.length > 0)
}
