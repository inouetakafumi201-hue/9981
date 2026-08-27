import recipes from '../motion-recipes.json'

export type MotionRecipeKey = keyof typeof recipes.motionRecipes
export type MotionRecipe = (typeof recipes.motionRecipes)[MotionRecipeKey]

export type ProceduralMoveState = {
  tiltDeg: number
  triggeredSquash: boolean
  triggeredFrame: boolean
  springProgress: number
  progress: number
}

const cubicOut = (t: number) => 1 - (1 - t) ** 3

/** Pure projection helper: it describes motion and never mutates gameplay state. */
export function applyProceduralMove(
  recipeKey: MotionRecipeKey,
  elapsedMs: number,
  overrides: Partial<{ durationMs: number; arcHeightRatio: number; rotationAmplitude: number; squashOnImpact: number }> = {},
): ProceduralMoveState {
  const recipe = recipes.motionRecipes[recipeKey]
  if (!recipe || typeof recipe.durationMs !== 'number') {
    return { tiltDeg: 0, triggeredSquash: false, triggeredFrame: false, springProgress: 0, progress: 0 }
  }

  const durationMs = overrides.durationMs ?? recipe.durationMs
  const progress = Math.min(1, Math.max(0, elapsedMs / durationMs))
  const amplitude = overrides.rotationAmplitude ?? ('rotationAmplitude' in recipe && typeof recipe.rotationAmplitude === 'number' ? recipe.rotationAmplitude : 0)
  const threshold = recipes.frameThresholdDegrees
  let tiltDeg = 0

  if (progress < 1 / 3) tiltDeg = cubicOut(progress * 3) * amplitude
  else if (progress < 2 / 3) tiltDeg = amplitude - ((progress - 1 / 3) * 3) * 3 * amplitude
  else tiltDeg = -2 * amplitude + ((progress - 2 / 3) * 3) * 3 * amplitude

  const squashWindowStart = 0.85
  const triggeredSquash = progress >= squashWindowStart && progress < 1
  const springProgress = progress >= squashWindowStart ? Math.min(1, (progress - squashWindowStart) / 0.15) : 0

  return {
    tiltDeg,
    triggeredSquash,
    triggeredFrame: Math.abs(tiltDeg) >= threshold,
    springProgress,
    progress,
  }
}

export function getMotionRecipe(key: MotionRecipeKey) {
  return recipes.motionRecipes[key]
}

export { recipes }
