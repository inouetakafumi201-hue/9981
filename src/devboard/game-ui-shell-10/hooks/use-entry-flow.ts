'use client'

import { useCallback, useEffect, useReducer } from 'react'

// The full closed loop this hook orchestrates:
//   title -> residence -> entering-dream -> battle-intro -> battle
//         -> battle-result -> exiting-dream -> residence
// Every stage past `title` is reachable in two ways: (a) the gallery in
// app/page.tsx can jump straight to any one of them to inspect it in
// isolation (that's what the rest of the file already does for every other
// mock page), or (b) a full run started from `title` walks them in order.
// `origin` is what tells a stage which of those two contexts it's in, since
// a couple of choices (what "skip" resolves to, whether finishing a stage
// auto-advances) depend on it.
export type FlowStage =
  | 'title'
  | 'residence'
  | 'entering-dream'
  | 'battle-intro'
  | 'battle'
  | 'battle-result'
  | 'exiting-dream'

export type MatchState = 'idle' | 'searching' | 'found'
export type ResidenceOrigin = { x: number; y: number }

type FlowState = {
  stage: FlowStage
  origin: 'gallery' | 'full-run'
  hasMockSave: boolean
  anchorLinked: boolean
  matchState: MatchState
  reducedMotion: boolean
  // the player's residence position at the moment they readied at Bed A —
  // return-home must land here, never at a default spawn point.
  returnOrigin: ResidenceOrigin | null
}

type FlowAction =
  | { type: 'goto'; stage: FlowStage; origin?: 'gallery' | 'full-run' }
  | { type: 'start-full-run' }
  | { type: 'link-anchor' }
  | { type: 'set-match'; value: MatchState }
  | { type: 'new-game' }
  | { type: 'continue-game' }
  | { type: 'advance' } // move to the next stage in the fixed sequence
  | { type: 'set-reduced-motion'; value: boolean }
  | { type: 'set-return-origin'; value: ResidenceOrigin }

const SEQUENCE: FlowStage[] = [
  'title',
  'residence',
  'entering-dream',
  'battle-intro',
  'battle',
  'battle-result',
  'exiting-dream',
]

function nextStage(stage: FlowStage): FlowStage {
  const i = SEQUENCE.indexOf(stage)
  // exiting-dream's "next" loops back to residence rather than falling off
  // the end of the array — it's a closed loop, not a linear sequence.
  if (stage === 'exiting-dream') return 'residence'
  return SEQUENCE[Math.min(i + 1, SEQUENCE.length - 1)]
}

function reducer(state: FlowState, action: FlowAction): FlowState {
  switch (action.type) {
    case 'goto':
      return { ...state, stage: action.stage, origin: action.origin ?? 'gallery' }
    case 'start-full-run':
      return { ...state, stage: 'title', origin: 'full-run', anchorLinked: false, matchState: 'idle' }
    case 'new-game':
      return { ...state, stage: 'residence', hasMockSave: true }
    case 'continue-game':
      return state.hasMockSave ? { ...state, stage: 'residence' } : state
    case 'link-anchor':
      return { ...state, anchorLinked: true }
    case 'set-match':
      return { ...state, matchState: action.value }
    case 'advance':
      return { ...state, stage: nextStage(state.stage) }
    case 'set-reduced-motion':
      return { ...state, reducedMotion: action.value }
    case 'set-return-origin':
      return { ...state, returnOrigin: action.value }
    default:
      return state
  }
}

export function useEntryFlow() {
  const [state, dispatch] = useReducer(reducer, {
    stage: 'title',
    origin: 'gallery',
    hasMockSave: false,
    anchorLinked: false,
    matchState: 'idle',
    reducedMotion: false,
    returnOrigin: null,
  })

  // Reflect the OS-level reduced-motion preference once on mount, and keep it
  // live — every ceremony stage (dream transitions especially) reads this to
  // collapse its multi-phase sequence down to a instant cut instead.
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    dispatch({ type: 'set-reduced-motion', value: query.matches })
    const onChange = (e: MediaQueryListEvent) => dispatch({ type: 'set-reduced-motion', value: e.matches })
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const goto = useCallback((stage: FlowStage) => dispatch({ type: 'goto', stage, origin: 'gallery' }), [])
  const startFullRun = useCallback(() => dispatch({ type: 'start-full-run' }), [])
  const newGame = useCallback(() => dispatch({ type: 'new-game' }), [])
  const continueGame = useCallback(() => dispatch({ type: 'continue-game' }), [])
  const linkAnchor = useCallback(() => dispatch({ type: 'link-anchor' }), [])
  const setMatchState = useCallback((value: MatchState) => dispatch({ type: 'set-match', value }), [])
  const advance = useCallback(() => dispatch({ type: 'advance' }), [])
  const setReturnOrigin = useCallback((value: ResidenceOrigin) => dispatch({ type: 'set-return-origin', value }), [])

  return {
    ...state,
    goto,
    startFullRun,
    newGame,
    continueGame,
    linkAnchor,
    setMatchState,
    advance,
    setReturnOrigin,
  }
}
