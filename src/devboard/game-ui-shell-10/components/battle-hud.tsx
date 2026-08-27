'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { AnimatePresence, motion, type Transition } from 'framer-motion'
import { createIntent, submitIntent, type IntentStatus } from '@/lib/b1-contract'
import {
  LogOut,
  Settings,
  Sword,
  Swords,
  Shield,
  ShieldPlus,
  Eye,
  Footprints,
  Flame,
  Megaphone,
  Repeat,
  Sparkles,
  Flag,
  Skull,
  Zap,
} from 'lucide-react'

type HudVariant = 'Default' | 'Compact' | 'Cinematic'
type Faction = 'goblin' | 'cultist' | 'beast' | 'player'

type RailUnit = {
  index: number
  name: string
  faction: Faction
  hpPips: number
  hpMax: number
  resourcePips: number
  resourceMax: number
  pos: { x: number; y: number }
  active?: boolean
}

type RollBar = { index: number; value: number; max: number; tone: 'green' | 'amber' | 'red' | 'gray' }

type ActionTheme = 'crimson' | 'red' | 'blue' | 'teal' | 'green' | 'amber' | 'violet'
type ActionIcon =
  | 'slash'
  | 'cleave'
  | 'guard'
  | 'focus'
  | 'quickstep'
  | 'rally'
  | 'fireball'
  | 'retreat'
  | 'taunt'
  | 'execute'
  | 'brace'
  | 'secondwind'
type ReqKind = 'sword' | 'burst' | 'shield'
type TargetKind = 'none' | 'hostile' | 'ally'

type ActionCard = {
  id: string
  name: string
  theme: ActionTheme
  icon: ActionIcon
  reqIcons: ReqKind[]
  effect: string
  effectValue: string
  tag: string
  cost: number
  target: TargetKind
  description: string
}

const PORTRAITS: Record<Faction, string> = {
  goblin: '/games/hud/portrait-goblin.png',
  cultist: '/games/hud/portrait-cultist.png',
  beast: '/games/hud/portrait-beast.png',
  player: '/games/hud/portrait-player.png',
}

const railUnits: RailUnit[] = [
  { index: 1, name: 'Goblin Scout', faction: 'goblin', hpPips: 5, hpMax: 6, resourcePips: 2, resourceMax: 6, pos: { x: 20, y: 28 } },
  { index: 2, name: 'Cult Acolyte', faction: 'cultist', hpPips: 6, hpMax: 6, resourcePips: 2, resourceMax: 6, pos: { x: 33, y: 21 } },
  { index: 3, name: 'Goblin Brute', faction: 'goblin', hpPips: 6, hpMax: 6, resourcePips: 2, resourceMax: 6, pos: { x: 47, y: 30 } },
  { index: 4, name: 'Wolf', faction: 'beast', hpPips: 5, hpMax: 6, resourcePips: 2, resourceMax: 6, pos: { x: 60, y: 22 } },
  { index: 5, name: 'Player A', faction: 'player', hpPips: 8, hpMax: 8, resourcePips: 8, resourceMax: 8, pos: { x: 50, y: 78 }, active: true },
  { index: 6, name: 'Goblin Shaman', faction: 'goblin', hpPips: 6, hpMax: 6, resourcePips: 2, resourceMax: 6, pos: { x: 72, y: 26 } },
  { index: 7, name: 'Cultist', faction: 'cultist', hpPips: 6, hpMax: 6, resourcePips: 2, resourceMax: 6, pos: { x: 84, y: 32 } },
]

const rollBars: RollBar[] = [
  { index: 1, value: 11, max: 11, tone: 'green' },
  { index: 2, value: 6, max: 11, tone: 'amber' },
  { index: 3, value: 3, max: 11, tone: 'red' },
  { index: 4, value: 8, max: 11, tone: 'green' },
  { index: 5, value: 1, max: 11, tone: 'gray' },
  { index: 6, value: 10, max: 11, tone: 'amber' },
  { index: 7, value: 5, max: 11, tone: 'red' },
]

// Available AP this turn — drives the three-tier card material language:
// cost < AP → fully available (bright edge light); cost === AP → limited (dimmer
// accent, still playable); cost > AP → unavailable (flat, no highlight, disabled).
const AVAILABLE_AP = 4

const actionCards: ActionCard[] = [
  { id: 'slash', name: 'Slash', theme: 'crimson', icon: 'slash', reqIcons: ['sword', 'sword'], effect: 'Damage', effectValue: '2', tag: 'Melee 2', cost: 1, target: 'hostile', description: 'A quick sword strike aimed at an adjacent target. Requires 2 Sword symbols on your roll.' },
  { id: 'cleave', name: 'Cleave', theme: 'red', icon: 'cleave', reqIcons: ['sword', 'burst'], effect: 'Damage', effectValue: '3', tag: 'Melee 2', cost: 2, target: 'hostile', description: 'A wide arcing swing that hits harder but demands both a Sword and a Burst symbol.' },
  { id: 'guard', name: 'Guard', theme: 'blue', icon: 'guard', reqIcons: ['shield'], effect: 'Gain 3', effectValue: 'Block', tag: 'Self', cost: 1, target: 'none', description: 'Raise your shield, gaining Block that absorbs incoming damage until your next turn.' },
  { id: 'focus', name: 'Focus', theme: 'teal', icon: 'focus', reqIcons: ['burst'], effect: 'Gain 1', effectValue: 'Insight', tag: 'Self', cost: 1, target: 'none', description: 'Steady your mind, gaining Insight that improves the outcome of your next roll.' },
  { id: 'quick-step', name: 'Quick Step', theme: 'green', icon: 'quickstep', reqIcons: ['burst'], effect: 'Move', effectValue: '2', tag: 'Slow Move', cost: 1, target: 'none', description: 'Reposition across the battlefield. Counts as a Slow Move and can be interrupted.' },
  { id: 'rally', name: 'Rally', theme: 'amber', icon: 'rally', reqIcons: ['burst', 'shield'], effect: 'Gain 2', effectValue: 'Focus', tag: 'Ally', cost: 2, target: 'ally', description: 'Shout a battle cry, granting an ally 2 Focus they can spend on their next action.' },
  { id: 'taunt', name: 'Taunt', theme: 'blue', icon: 'taunt', reqIcons: ['shield', 'burst'], effect: 'Gain 2', effectValue: 'Threat', tag: 'Self', cost: 1, target: 'none', description: 'Draw the attention of nearby enemies, forcing them to prioritize you as a target.' },
  { id: 'retreat', name: 'Retreat', theme: 'green', icon: 'retreat', reqIcons: ['shield'], effect: 'Move', effectValue: '3', tag: 'Disengage', cost: 1, target: 'none', description: 'Break away from melee range without provoking a free attack from your target.' },
  { id: 'fireball', name: 'Fireball', theme: 'violet', icon: 'fireball', reqIcons: ['burst', 'burst'], effect: 'Damage', effectValue: '4', tag: 'Ranged 3 · AoE', cost: 4, target: 'hostile', description: 'Hurl a mote of fire that explodes on impact, scorching every target in the blast radius.' },
  { id: 'execute', name: 'Execute', theme: 'crimson', icon: 'execute', reqIcons: ['sword', 'burst'], effect: 'Damage', effectValue: '6', tag: 'Finisher', cost: 5, target: 'hostile', description: 'A finishing blow reserved for staggered enemies. Costs more AP than you have this turn.' },
  { id: 'brace', name: 'Brace', theme: 'teal', icon: 'brace', reqIcons: ['shield'], effect: 'Gain 1', effectValue: 'Block', tag: 'Self · Free', cost: 0, target: 'none', description: 'A reflexive half-step that shrugs off a sliver of incoming damage at no AP cost.' },
  { id: 'second-wind', name: 'Second Wind', theme: 'amber', icon: 'secondwind', reqIcons: ['burst'], effect: 'Gain 1', effectValue: 'Insight', tag: 'Self · Free', cost: 0, target: 'none', description: 'A steadying breath between actions, sharpening your next roll for nothing.' },
]

// Deterministic pseudo-random floating motes (fixed at module scope so server
// and client render the same markup — no hydration mismatch from Math.random).
const MOTES = Array.from({ length: 16 }, (_, i) => ({
  x: (i * 37 + 5) % 100,
  y: (i * 53 + 12) % 88,
  delay: (i % 7) * 0.45,
  dur: 7 + ((i * 3) % 6),
  size: 2 + (i % 3),
}))

function ReqGlyph({ kind }: { kind: ReqKind }) {
  if (kind === 'sword') return <Sword className="bh-req-glyph" aria-hidden="true" />
  if (kind === 'shield') return <Shield className="bh-req-glyph" aria-hidden="true" />
  return <Sparkles className="bh-req-glyph" aria-hidden="true" />
}

function PipDots({ filled, total }: { filled: number; total: number }) {
  return (
    <div className="bh-pip-dots bh-pip-hp" aria-label={`${filled} of ${total} health`}>
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={i < filled ? 'bh-pip-dot is-filled' : 'bh-pip-dot'} />
      ))}
    </div>
  )
}

const DIE_PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[30, 30], [70, 70]],
  3: [[30, 30], [50, 50], [70, 70]],
  4: [[30, 30], [70, 30], [30, 70], [70, 70]],
  5: [[30, 30], [70, 30], [50, 50], [30, 70], [70, 70]],
  6: [[30, 25], [70, 25], [30, 50], [70, 50], [30, 75], [70, 75]],
}

function DieFace({ className = 'bh-die-svg', face = 5 }: { className?: string; face?: number }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" shapeRendering="crispEdges">
      <rect x="3" y="3" width="26" height="26" fill="#f4efe3" />
      <rect x="3" y="3" width="26" height="4" fill="#fff" />
      <rect x="3" y="25" width="26" height="4" fill="#d8d1c0" />
      <rect x="3" y="3" width="26" height="26" fill="none" stroke="#2b2620" strokeWidth="2" />
      {DIE_PIPS[face].map(([cx, cy], i) => (
        <rect key={i} x={(cx / 100) * 32 - 2.4} y={(cy / 100) * 32 - 2.4} width="4.8" height="4.8" fill="#2b2620" />
      ))}
    </svg>
  )
}

function GearNode({ active = false }: { active?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="bh-gear-svg" aria-hidden="true">
      <g className={active ? 'bh-gear-spin' : undefined} style={{ transformOrigin: '12px 12px' }}>
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <rect key={a} x="10.4" y="0.5" width="3.2" height="5.5" rx="0.6" transform={`rotate(${a} 12 12)`} fill="currentColor" />
        ))}
        <circle cx="12" cy="12" r="8" fill="currentColor" />
      </g>
      <circle cx="12" cy="12" r="3.2" className="bh-gear-hole" />
    </svg>
  )
}

const ACTION_ICONS: Record<ActionIcon, typeof Sword> = {
  slash: Sword,
  cleave: Swords,
  guard: Shield,
  focus: Eye,
  quickstep: Footprints,
  rally: Megaphone,
  fireball: Flame,
  retreat: Repeat,
  taunt: Flag,
  execute: Skull,
  brace: ShieldPlus,
  secondwind: Zap,
}

function ActionGlyph({ kind }: { kind: ActionIcon }) {
  const Icon = ACTION_ICONS[kind]
  return <Icon className="bh-card-icon-svg" strokeWidth={2.2} aria-hidden="true" />
}

const springTransition: Transition = { type: 'spring', stiffness: 300, damping: 28 }

// Kards/Hearthstone-style hand-fan geometry: cards arc slightly with the outer
// cards rotated and dropped, and the middle riding highest.
//
// Stacking order is intentionally STATIC and monotonic by index (earlier card
// always on top of the next one), never a function of which card is hovered.
// Cards overlap left-to-right, so with this order each card's LEFT portion is
// covered by its more-central-side neighbor and its RIGHT edge strip (width
// fanStep) is always the one guaranteed-visible sliver — that's where the name
// label lives. Previously z-index favored whichever card was closer to center
// AND neighbors were pushed sideways to "make room" for a hovered card; both
// of those made the stacking order hover-dependent, so a cursor sitting in an
// overlap zone could flip which card was on top mid-hover, re-triggering
// mouseenter/mouseleave on alternating cards in a tight loop. With a fixed
// order (and no sideways neighbor push — the hovered card only lifts in
// place), the pixel under the cursor always belongs to exactly one element,
// independent of hover state, so it can no longer flicker.
// Pure resting-fan geometry only — index/total in, per-card rotation/drop/
// stacking out. Nothing about hover lives here anymore: opening a card is a
// discrete state (see .bh-hand-card.is-hovered in globals.css, which snaps
// open instantly and eases closed on leave via an asymmetric CSS transition),
// and the extra float while open is a separate, directly-set pointer offset
// applied one layer further in (see handLiftPx). Mixing either of those into
// this per-frame-recomputed geometry was the root cause of every stutter/
// bounce/lag report so far: this function's output must only ever change when
// `index`/`total` change (i.e. cards are added/removed), never on hover or
// pointer movement.
function fanGeometry(index: number, total: number) {
  const center = (total - 1) / 2
  const d = index - center
  const step = total > 8 ? 2.1 : total > 5 ? 3.2 : 4.5
  return {
    rotate: d * step,
    y: Math.pow(d, 2) * 0.55,
    zIndex: total - index,
  }
}

// Detects CJK script (Han/Hiragana/Katakana/Hangul) so the sliver name label
// can switch to vertical text — everything else (Latin words) stacks
// horizontally instead, one word per line.
function isCJKText(text: string) {
  return /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text)
}

// The sliver label lives in the one strip of a hand card that overlap can
 // never hide (see fanGeometry comment above), so it's the only text safe to
// show in the collapsed card. Long English words are never wrapped — they are
// allowed to run past the strip and get quietly clipped by the neighboring
// card on top, which reads better than a mid-word line break at this size.
function CardSliverName({ name }: { name: string }) {
  if (isCJKText(name)) {
    return <span className="bh-hand-card-sliver-name is-cjk">{name}</span>
  }
  return (
    <span className="bh-hand-card-sliver-name">
      {name.split(' ').map((word, i) => (
        <span key={i} className="bh-hand-card-sliver-word">
          {word}
        </span>
      ))}
    </span>
  )
}

const HAND_CARD_WIDTH = 128
const HAND_CARD_HEIGHT = 92 // must match .bh-hand-card-slot's CSS height and .bh-hand-card-face's base height
const HAND_MAX_STEP = 66 // comfortable spacing when the hand has room to spare
const HAND_MIN_STEP = 38 // heaviest allowed overlap before we'd rather clip than shrink further

export function BattleHud({ variant = 'Default' }: { variant?: HudVariant }) {
  const activeUnit = useMemo(() => railUnits.find((u) => u.active) ?? railUnits[0], [])
  const [selectedIndex, setSelectedIndex] = useState(activeUnit.index)
  const [rollStage, setRollStage] = useState<'idle' | 'charge' | 'flash' | 'reveal'>('idle')
  const [powerTier, setPowerTier] = useState<0 | 1 | 2>(1)
  const [reversalTier, setReversalTier] = useState<0 | 1 | 2>(1)
  const [rollPending, setRollPending] = useState(false)
  const [intentFeedback, setIntentFeedback] = useState<{ status: IntentStatus; message: string } | null>(null)
  const [intentPending, setIntentPending] = useState(false)
  const [spectatorMode, setSpectatorMode] = useState(false)

  // Hand-of-cards interaction state: hover shows detail in place, click either
  // plays a no-target card immediately (fly-to-caster) or arms cursor-targeting
  // for a targeted card (ghost card follows the pointer until a valid token or
  // empty space is clicked).
  const [handHoverId, setHandHoverId] = useState<string | null>(null)
  // Two curves, both driven by the same single input — how far the pointer
  // has moved up since hovering started — that together produce "expands in
  // place with no angle change, THEN as you move up the fan angle eases back
  // to straight, THEN further up becomes pure vertical float, decelerating
  // toward a cap":
  //   - handRotateMul: 1 at the top of the hover (full resting fan angle,
  //     untouched) decaying toward 0 (fully straight) as the pointer moves
  //     up. Actually multiplies the card's own resting rotation, so at
  //     up=0 nothing has changed yet — the "expand in place" the first
  //     moment of hover needs.
  //   - handLiftPx: 0 at up=0, rising toward MAX_LIFT as the pointer moves up
  //     further, via a saturating curve (not a straight line): lift =
  //     MAX_LIFT * (1 - e^(-up / LIFT_SOFTNESS)). Its slope starts under 1
  //     and keeps shrinking as it nears the cap, so the card's own speed is
  //     always at or below the pointer's and can never cross the ceiling.
  // Giving rotation a much smaller softness than lift means rotation resolves
  // to (near) 0 well before lift has made much progress, which is what turns
  // "one continuous curve" into the requested two visually distinct phases —
  // straighten first, rise second — without any fixed-duration animation or
  // hand-authored phase boundary. Both are pure functions of *distance
  // moved*, not of *time*, so neither has velocity to store and neither can
  // overshoot: every fast shake is still followed immediately, just
  // compressed by the same curve, so it never outruns the pointer.
  const [handLiftPx, setHandLiftPx] = useState(0)
  const [handRotateMul, setHandRotateMul] = useState(1)
  // Viewport Y at the moment the pointer entered this hover session — the
  // zero point that "how far up has the pointer moved" is measured from.
  // Deliberately NOT derived from any element's rect (that was the source of
  // an earlier bug where a container's own padding silently shifted the zero
  // point); it is just "wherever the cursor was when hovering started."
  const handLiftEntryY = useRef(0)
  const handLiftFrame = useRef<number | null>(null)
  const handLiftPending = useRef(0)
  const handRotatePending = useRef(1)
  const HAND_LIFT_MAX = 190 // hard ceiling the float curve can approach but never reach
  const HAND_LIFT_SOFTNESS = 420 // px of upward pointer travel to reach ~63% of the ceiling; larger = more damped/smoother
  const HAND_ROTATE_SOFTNESS = 70 // px of upward pointer travel to resolve most of the way to straight; kept well under HAND_LIFT_SOFTNESS so straightening finishes before lift has risen much
  // One requestAnimationFrame-batched write per frame, carrying whatever the
  // most recent raw pointer sample was — not an interpolated/eased value.
  // mousemove/pointermove can fire many times between two paints; without
  // this, each of those would trigger its own React re-render for no visual
  // benefit. Because the curves themselves (not this batching) supply the
  // damping, there is no added lag: the frame always paints both curves'
  // values for the very latest pointer position.
  const updateHandLift = (pointerY: number | null) => {
    const up = pointerY === null ? 0 : Math.max(0, handLiftEntryY.current - pointerY)
    handLiftPending.current = HAND_LIFT_MAX * (1 - Math.exp(-up / HAND_LIFT_SOFTNESS))
    handRotatePending.current = Math.exp(-up / HAND_ROTATE_SOFTNESS)
    if (handLiftFrame.current !== null) return
    handLiftFrame.current = requestAnimationFrame(() => {
      handLiftFrame.current = null
      setHandLiftPx(handLiftPending.current)
      setHandRotateMul(handRotatePending.current)
    })
  }
  const [targetingCard, setTargetingCard] = useState<ActionCard | null>(null)
  const [playedCardIds, setPlayedCardIds] = useState<string[]>([])
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(null)
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null)
  const [resolveFlash, setResolveFlash] = useState<{ unitIndex: number; tone: ActionTheme } | null>(null)
  const [castFlight, setCastFlight] = useState<{
    card: ActionCard
    from: { x: number; y: number }
    to: { x: number; y: number }
  } | null>(null)
  const tokenRefs = useRef<Record<number, HTMLButtonElement | null>>({})

  const paidCards = useMemo(() => actionCards.filter((c) => c.cost > 0), [])
  const freeCards = useMemo(() => actionCards.filter((c) => c.cost === 0), [])

  // Keep sampling viewport coordinates after the visual card leaves its small
  // static slot. Without this window listener, moving through the expanded
  // portion would stop producing pointer events and the card would feel stuck.
  useEffect(() => {
    if (!handHoverId) return
    const onPointerMove = (event: PointerEvent) => updateHandLift(event.clientY)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    return () => window.removeEventListener('pointermove', onPointerMove)
  }, [handHoverId])

  // The fan lane is a flex:1 child, so its clientWidth reflects the exact space
  // left after the free-action cluster and roll-settings offset — we shrink card
  // overlap (never card width) to guarantee the whole hand always fits without
  // spilling behind neighboring panels, only falling back to hard-clip overlap
  // if there are more cards than HAND_MIN_STEP can fit.
  const fanLaneRef = useRef<HTMLDivElement>(null)
  const [fanStep, setFanStep] = useState(HAND_MAX_STEP)
  useEffect(() => {
    function recalc() {
      const available = fanLaneRef.current?.clientWidth
      const n = paidCards.length
      if (!available || n <= 1) return
      const idealTotal = HAND_CARD_WIDTH + (n - 1) * HAND_MAX_STEP
      if (idealTotal <= available) {
        setFanStep(HAND_MAX_STEP)
        return
      }
      const fitStep = (available - HAND_CARD_WIDTH) / (n - 1)
      setFanStep(Math.max(HAND_MIN_STEP, fitStep))
    }
    recalc()
    window.addEventListener('resize', recalc)
    return () => window.removeEventListener('resize', recalc)
  }, [paidCards.length])

  useEffect(() => {
    if (!targetingCard) return
    const onMove = (e: PointerEvent) => setPointerPos({ x: e.clientX, y: e.clientY })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTargetingCard(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('keydown', onKey)
    }
  }, [targetingCard])

  async function sendBattleIntent(intentId: Parameters<typeof createIntent>[0], payload: Record<string, unknown>) {
    if (intentPending) return 'timeout' as IntentStatus
    setIntentPending(true)
    setIntentFeedback({ status: 'accepted', message: `${intentId} pending…` })
    try {
      const result = await submitIntent(createIntent(intentId, payload, 'hud'))
      setIntentFeedback({ status: result.status, message: result.reason ?? `${intentId} accepted` })
      return result.status
    } finally {
      setIntentPending(false)
    }
  }

  async function selectBurst(kind: 'power' | 'reversal', tier: 0 | 1 | 2) {
    if (spectatorMode || rollPending) return
    if (kind === 'power') setPowerTier(tier)
    else setReversalTier(tier)
    const status = await sendBattleIntent(kind === 'power' ? 'battle.select-power-die-tier' : 'battle.select-reversal-tier', { tier })
    if (status === 'accepted' && !spectatorMode) {
      await confirmRoll()
    }
  }

  function handleTierKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, kind: 'power' | 'reversal', tier: 0 | 1 | 2) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowDown' && event.key !== 'ArrowRight' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : Math.max(0, Math.min(2, tier + (event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1)))
    void selectBurst(kind, next as 0 | 1 | 2)
  }

  async function confirmRoll() {
    if (spectatorMode || rollPending || intentPending) return
    setRollPending(true)
    const status = await sendBattleIntent('battle.confirm-roll', { powerTier, reversalTier })
    if (status === 'accepted') {
      setRollStage('charge')
      window.setTimeout(() => setRollStage('flash'), 420)
      window.setTimeout(() => setRollStage('reveal'), 560)
    }
    setRollPending(false)
  }

  function flashResolve(unitIndex: number, tone: ActionTheme) {
    setResolveFlash({ unitIndex, tone })
    window.setTimeout(() => setResolveFlash((r) => (r?.unitIndex === unitIndex ? null : r)), 640)
  }

  async function handleCardPlay(card: ActionCard, el: HTMLElement) {
    if (spectatorMode || card.cost > AVAILABLE_AP || intentPending) return
    const actionStatus = await sendBattleIntent('battle.select-action', { actionId: card.id, source: card.cost === 0 ? 'free' : 'paid', intentId: card.target === 'none' ? 'none' : 'executable-target' })
    if (actionStatus !== 'accepted') return
    if (card.target === 'none') {
      const originRect = el.getBoundingClientRect()
      const targetEl = tokenRefs.current[selectedUnit.index]
      const targetRect = targetEl?.getBoundingClientRect()
      setHandHoverId(null)
      updateHandLift(null)
      setPlayedCardIds((ids) => (ids.includes(card.id) ? ids : [...ids, card.id]))
      setCastFlight({
        card,
        from: { x: originRect.left + originRect.width / 2, y: originRect.top + originRect.height / 2 },
        to: targetRect
          ? { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 }
          : { x: originRect.left, y: originRect.top - 120 },
      })
      flashResolve(selectedUnit.index, card.theme)
      window.setTimeout(() => setCastFlight(null), 560)
    } else {
      const rect = el.getBoundingClientRect()
      const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      setHandHoverId(null)
      updateHandLift(null)
      setDragOrigin(origin)
      setPointerPos(origin)
      setTargetingCard(card)
    }
  }

  async function handleTokenActivate(unit: RailUnit) {
    if (targetingCard) {
      const valid =
        (targetingCard.target === 'hostile' && unit.faction !== 'player') ||
        (targetingCard.target === 'ally' && unit.faction === 'player')
      if (valid && !intentPending) {
        const card = targetingCard
        setTargetingCard(null)
        const status = await sendBattleIntent('battle.select-target', { actionId: card.id, targetId: String(unit.index) })
        if (status === 'accepted') {
          flashResolve(unit.index, card.theme)
          setPlayedCardIds((ids) => (ids.includes(card.id) ? ids : [...ids, card.id]))
        }
      }
      setTargetingCard(null)
    } else {
      setSelectedIndex(unit.index)
    }
  }

  function handleWorldBackgroundClick() {
    if (targetingCard) setTargetingCard(null)
  }

  const selectedUnit = useMemo(
    () => railUnits.find((u) => u.index === selectedIndex) ?? activeUnit,
    [selectedIndex, activeUnit],
  )
  const targetUnit = railUnits.find((u) => u.faction !== 'player') ?? railUnits[0]
  const playerUnit = railUnits.find((u) => u.faction === 'player') ?? railUnits[0]

  useEffect(() => {
    setPlayedCardIds([])
  }, [selectedIndex])

  useEffect(() => {
    const reduceMotion =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      setRollStage('reveal')
      return
    }
    setRollStage('charge')
    const t1 = setTimeout(() => setRollStage('flash'), 420)
    const t2 = setTimeout(() => setRollStage('reveal'), 560)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [selectedIndex])

  return (
    <div className={`battle-hud bh-variant-${variant.toLowerCase()}`}>
      <button className="bh-leave-entry" aria-label="Leave battle" onClick={() => void sendBattleIntent('menu.quit', { source: 'battle-hud' })}>
        <LogOut size={13} />
      </button>
      <button className="bh-settings-entry" aria-label="Battle settings" onClick={() => setIntentFeedback({ status: 'accepted', message: 'Settings surface requested · focus returns here' })}>
        <Settings size={13} />
      </button>
      <button className={`bh-spectator-entry ${spectatorMode ? 'is-active' : ''}`} aria-pressed={spectatorMode} aria-label="Toggle spectator readonly" onClick={() => { setSpectatorMode((value) => !value); setIntentFeedback({ status: 'accepted', message: spectatorMode ? 'Player controls restored' : 'Spectator readonly mode' }) }}>
        <Eye size={13} />
      </button>

      {/* WORLD LAYER — full-bleed battlefield populated with entity tokens and a target line.
          Clicking empty space here cancels an armed targeted card. */}
      <div className={`bh-world ${targetingCard ? 'is-targeting' : ''}`} onClick={handleWorldBackgroundClick}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/games/hud/battlefield.png" alt="Battlefield" className="bh-world-img" />
        <div className="bh-world-tint" aria-hidden="true" />
        <div className="bh-light-pool bh-light-pool-a" aria-hidden="true" />
        <div className="bh-light-pool bh-light-pool-b" aria-hidden="true" />
        {MOTES.map((m, i) => (
          <span
            key={i}
            className="bh-mote"
            aria-hidden="true"
            style={{
              left: `${m.x}%`,
              top: `${m.y}%`,
              width: m.size,
              height: m.size,
              animationDelay: `${m.delay}s`,
              animationDuration: `${m.dur}s`,
            }}
          />
        ))}
        <svg className="bh-target-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <motion.line
            x1={activeUnit.pos.x}
            y1={activeUnit.pos.y}
            x2={targetUnit.pos.x}
            y2={targetUnit.pos.y}
            stroke="var(--gold)"
            strokeWidth="0.35"
            strokeDasharray="1.6 1.4"
            vectorEffect="non-scaling-stroke"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 0.65 }}
            transition={{ duration: 1, delay: 0.4, ease: 'easeOut' }}
          />
        </svg>
        {railUnits.map((unit) => {
          const isCandidate = targetingCard
            ? (targetingCard.target === 'hostile' && unit.faction !== 'player') ||
              (targetingCard.target === 'ally' && unit.faction === 'player')
            : false
          const isDimmed = Boolean(targetingCard) && !isCandidate
          return (
            <button
              key={unit.index}
              type="button"
              ref={(el) => {
                tokenRefs.current[unit.index] = el
              }}
              className={`bh-token bh-faction-${unit.faction} ${unit.index === selectedIndex ? 'is-selected' : ''} ${
                isCandidate ? `is-target-candidate bh-theme-${targetingCard!.theme}` : ''
              } ${isDimmed ? 'is-target-dimmed' : ''}`}
              style={{ left: `${unit.pos.x}%`, top: `${unit.pos.y}%` }}
              onClick={(e) => {
                e.stopPropagation()
                handleTokenActivate(unit)
              }}
              aria-label={unit.name}
            >
              <span className="bh-token-shadow" />
              <span className="bh-token-ring" />
              <span className="bh-token-dot" />
              <AnimatePresence>
                {resolveFlash?.unitIndex === unit.index && (
                  <motion.span
                    key="flash"
                    className={`bh-token-resolve-flash bh-theme-${resolveFlash.tone}`}
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: [0, 1, 0], scale: [0.4, 1.9, 2.5] }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                  />
                )}
              </AnimatePresence>
            </button>
          )
        })}
      </div>

      {/* TURN INSIGNIA — floating notched badge, top-center */}
      <div className="bh-turn-insignia">
        <span className="bh-turn-num">Turn 5</span>
        <span className="bh-turn-sep" aria-hidden="true" />
        <span className="bh-turn-phase">Player Action Phase</span>
        <span className="bh-turn-sep" aria-hidden="true" />
        <span className="bh-turn-active">Player A&apos;s Turn</span>
      </div>

      {/* LEFT COLUMN — spine and instrument cluster share one flex column so they
          never overlap regardless of content height */}
      <div className="bh-left-column">
      <div className="bh-spine" role="list" aria-label="Initiative order">
        <span className="bh-spine-conduit" aria-hidden="true" />
        {railUnits.map((unit) => {
          const isSelected = unit.index === selectedIndex
          return (
            <motion.button
              key={unit.index}
              type="button"
              layout
              transition={springTransition}
              onClick={() => setSelectedIndex(unit.index)}
              aria-pressed={isSelected}
              aria-label={unit.name}
              className={`bh-spine-node bh-faction-${unit.faction} ${isSelected ? 'is-active' : ''}`}
            >
              <motion.span layout className="bh-medallion" transition={springTransition}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={PORTRAITS[unit.faction] || '/placeholder.svg'} alt="" className="bh-medallion-img" />
                <svg className="bh-medallion-ring" viewBox="0 0 40 40" aria-hidden="true">
                  <circle cx="20" cy="20" r="17.5" fill="none" stroke="rgba(0,0,0,.5)" strokeWidth="3" />
                  <circle
                    cx="20"
                    cy="20"
                    r="17.5"
                    fill="none"
                    strokeWidth="3"
                    strokeLinecap="round"
                    className="bh-medallion-ring-fill"
                    style={{ strokeDasharray: `${(unit.hpPips / unit.hpMax) * 110} 110` }}
                  />
                </svg>
                <span className="bh-medallion-index">{unit.index}</span>
                <span className="bh-medallion-stat bh-medallion-hp" aria-hidden="true">{unit.hpPips} / {unit.hpMax} HP</span>
                <span className="bh-medallion-stat bh-medallion-sp" aria-hidden="true">{unit.resourcePips} / {unit.resourceMax} SP</span>
              </motion.span>
              <AnimatePresence>
                {isSelected && (
                  <motion.span
                    className="bh-nameplate"
                    initial={{ opacity: 0, x: -6, scale: 0.9 }}
                    animate={{ opacity: 1, x: 0, scale: 1 }}
                    exit={{ opacity: 0, x: -6, scale: 0.9 }}
                    transition={springTransition}
                  >
                    {unit.faction === 'player' && <span className="bh-nameplate-glyph" aria-hidden="true" />}
                    {unit.name}
                  </motion.span>
                )}
              </AnimatePresence>
              {!isSelected && <PipDots filled={unit.hpPips} total={unit.hpMax} />}
            </motion.button>
          )
        })}
      </div>

      {/* INSTRUMENT CLUSTER — power/reversal gears merged with the AP meter */}
      <div className="bh-instrument">
        <span className="bh-instrument-label">Roll Settings</span>
        <div className="bh-rs-track bh-rs-power">
          <span className="bh-rs-track-label">Power</span>
          <div className="bh-rs-gears">
            <span className="bh-rs-rod" aria-hidden="true" />
            {[0, 1, 2, null].map((v, index) => {
              const isExtension = v === null
              return (
                <button key={isExtension ? 'extension' : v} type="button" className={`bh-rs-node ${v === 2 ? 'is-tier-two' : ''} ${powerTier === v ? 'is-active' : ''}`} aria-label={isExtension ? 'Power die tier 3 future expansion' : `Power die tier ${v}`} aria-disabled={isExtension} aria-pressed={!isExtension && powerTier === v} disabled={isExtension} onKeyDown={(event) => { if (!isExtension) handleTierKeyDown(event, 'power', v as 0 | 1 | 2) }} onClick={() => { if (!isExtension) void selectBurst('power', v as 0 | 1 | 2) }}>
                  <span className="bh-rs-gear"><GearNode active={!isExtension && powerTier === v} /></span>
                  {!isExtension && <span className="bh-rs-node-val">{v}</span>}
                </button>
              )
            })}
          </div>
        </div>
        <div className="bh-rs-track bh-rs-reversal">
          <span className="bh-rs-track-label">Reversal</span>
          <div className="bh-rs-gears">
            <span className="bh-rs-rod" aria-hidden="true" />
            {[0, 1, 2, null].map((v) => {
              const isExtension = v === null
              return (
                <button key={isExtension ? 'extension' : v} type="button" className={`bh-rs-node ${v === 2 ? 'is-tier-two' : ''} ${reversalTier === v ? 'is-active' : ''}`} aria-label={isExtension ? 'Reversal tier 3 future expansion' : `Reversal tier ${v}`} aria-disabled={isExtension} aria-pressed={!isExtension && reversalTier === v} disabled={isExtension} onKeyDown={(event) => { if (!isExtension) handleTierKeyDown(event, 'reversal', v as 0 | 1 | 2) }} onClick={() => { if (!isExtension) void selectBurst('reversal', v as 0 | 1 | 2) }}>
                  <span className="bh-rs-gear"><GearNode active={!isExtension && reversalTier === v} /></span>
                  {!isExtension && <span className="bh-rs-node-val">{v}</span>}
                </button>
              )
            })}
          </div>
        </div>
        <span className="bh-instrument-divider" aria-hidden="true" />
        <div className="bh-instrument-vital bh-vital-hp">
          <span className="bh-vital-label">HP</span>
          <div className="bh-vital-cells" role="img" aria-label={`Health ${playerUnit.hpPips} of ${playerUnit.hpMax}`}>
            {Array.from({ length: playerUnit.hpMax }).map((_, i) => (
              <span key={i} className={i < playerUnit.hpPips ? 'bh-vital-cell is-filled' : 'bh-vital-cell'} />
            ))}
          </div>
          <span className="bh-vital-readout">{playerUnit.hpPips}/{playerUnit.hpMax}</span>
        </div>
        <div className="bh-instrument-vital bh-vital-sp">
          <span className="bh-vital-label">SP</span>
          <div className="bh-vital-cells" role="img" aria-label={`Stamina ${playerUnit.resourcePips} of ${playerUnit.resourceMax}`}>
            {Array.from({ length: playerUnit.resourceMax }).map((_, i) => (
              <span key={i} className={i < playerUnit.resourcePips ? 'bh-vital-cell is-filled' : 'bh-vital-cell'} />
            ))}
          </div>
          <span className="bh-vital-readout">{playerUnit.resourcePips}/{playerUnit.resourceMax}</span>
        </div>
        <span className="bh-instrument-divider" aria-hidden="true" />
        <div className="bh-instrument-ap">
          <span className="bh-ap-label">AP</span>
          <div className="bh-ap-diamonds">
            {Array.from({ length: 5 }).map((_, i) => (
              <span key={i} className={i < 4 ? 'bh-ap-diamond is-filled' : 'bh-ap-diamond'} />
            ))}
          </div>
          <span className="bh-ap-readout">4 / 5</span>
        </div>
      </div>
      </div>

      {/* ROLL PREVIEW — floats over the world beside the spine, runs a 3-stage roll ceremony */}
      <AnimatePresence mode="wait">
        <motion.div
          key={selectedUnit.index}
          className="bh-roll-preview"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.25 }}
        >
          <motion.span
            className="bh-die"
            animate={rollStage === 'charge' ? { scale: [1, 1.16, 1], rotate: [0, 8, -8, 0] } : { scale: 1, rotate: 0 }}
            transition={{ duration: 0.42 }}
          >
            <DieFace />
          </motion.span>
          <div className="bh-roll-bars">
            {rollBars.map((bar) => (
              <div key={bar.index} className="bh-roll-line">
                <span className={`bh-roll-index bh-tone-${bar.tone}`}>{bar.index}</span>
                <span className="bh-roll-track">
                  <motion.span
                    className={`bh-roll-fill bh-tone-${bar.tone}`}
                    initial={{ width: 0 }}
                    animate={{ width: rollStage === 'reveal' ? `${(bar.value / bar.max) * 100}%` : 0 }}
                    transition={{ duration: 0.6, delay: 0.05 + bar.index * 0.05, ease: [0.16, 1, 0.3, 1] }}
                  />
                </span>
                <span className={`bh-roll-value bh-tone-${bar.tone}`}>{bar.value}</span>
              </div>
            ))}
          </div>
          <AnimatePresence>
            {rollStage === 'flash' && (
              <motion.span
                className="bh-roll-flash"
                aria-hidden="true"
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.85 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
              />
            )}
          </AnimatePresence>
        </motion.div>
      </AnimatePresence>

      {/* ACTION HAND — a Kards-style fanned hand of cards, bottom-right. Hover lifts
          a card clear of the arc and expands its detail in place (no popup); click
          plays a self-target card instantly (it flies to the caster) or arms
          cursor-targeting for a targeted card. Free (0 AP) actions live in a
          physically separate badge cluster so the paid/free split reads at a
          glance instead of relying on color alone. */}
        <div className="bh-hand" onMouseLeave={() => { setHandHoverId(null); updateHandLift(null) }}>
        <div className="bh-hand-free" role="list" aria-label="Free actions">
          {freeCards.map((card, i) => {
            const isHovered = handHoverId === card.id
            return (
              <motion.div
                // See the paid-hand key comment below — remounting on
                // selectedIndex replays the deal-in animation every round.
                key={`${card.id}-${selectedIndex}`}
                className="bh-free-slot"
                initial={{ opacity: 0, y: 14, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.5 + i * 0.06, ...springTransition }}
              >
                <motion.button
                  type="button"
                  className={`bh-free-badge bh-theme-${card.theme}`}
                  onMouseEnter={() => setHandHoverId(card.id)}
                  onFocus={() => setHandHoverId(card.id)}
                  onBlur={() => setHandHoverId((h) => (h === card.id ? null : h))}
                  onClick={(e) => handleCardPlay(card, e.currentTarget)}
                  whileHover={{ scale: 1.14, y: -4 }}
                  whileTap={{ scale: 0.94 }}
                  aria-label={`${card.name} — free action`}
                >
                  <ActionGlyph kind={card.icon} />
                </motion.button>
                <AnimatePresence>
                  {isHovered && (
                    <motion.div
                      className="bh-free-detail"
                      initial={{ opacity: 0, y: 8, scale: 0.94 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.94 }}
                      transition={{ duration: 0.15 }}
                    >
                      <span className="bh-free-detail-name">{card.name}</span>
                      <span className="bh-free-detail-effect">
                        {card.effect} {card.effectValue && <strong>{card.effectValue}</strong>}
                      </span>
                      <p className="bh-free-detail-desc">{card.description}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>

        <span className="bh-hand-divider" aria-hidden="true" />

        <div className="bh-hand-fan" role="list" aria-label="Actions" ref={fanLaneRef}>
          <AnimatePresence>
          {paidCards.filter((card) => !playedCardIds.includes(card.id)).map((card, i) => {
            const isHovered = handHoverId === card.id
            const isPlayed = playedCardIds.includes(card.id)
            const g = fanGeometry(i, paidCards.length)
            const tier = card.cost > AVAILABLE_AP ? 'unavailable' : card.cost === AVAILABLE_AP ? 'limited' : 'available'
            return (
              // Static hit-box: fixed size/position, only ever changes z-index.
              // Pointer/focus listeners live here — NOT on the animated inner
              // layer — so lifting/scaling a hovered card can never carry its
              // own hit area out from under the cursor. See the .bh-hand-card-slot
              // comment in globals.css for why that split matters.
              <motion.div
                key={`${card.id}-${selectedIndex}`}
                className="bh-hand-card-slot"
                exit={{ opacity: 0, y: -140, scale: 0.85, transition: { duration: 0.42, ease: [0.4, 0, 0.2, 1] } }}
                style={{ zIndex: isPlayed ? 70 : isHovered ? 65 : g.zIndex, marginLeft: i === 0 ? 0 : -(HAND_CARD_WIDTH - fanStep), pointerEvents: isPlayed ? 'none' : 'auto' }}
                onMouseEnter={(event) => {
                  setHandHoverId(card.id)
                  // Zero point for this hover session's 1:1 float mapping —
                  // wherever the cursor happened to be the instant it entered.
                  handLiftEntryY.current = event.clientY
                  updateHandLift(event.clientY)
                }}
                onMouseMove={(event) => {
                  if (handHoverId !== card.id) return
                  updateHandLift(event.clientY)
                }}
                onFocus={(event) => {
                  setHandHoverId(card.id)
                  handLiftEntryY.current = event.currentTarget.getBoundingClientRect().top
                  updateHandLift(null)
                }}
                onBlur={() => {
                  setHandHoverId((h) => (h === card.id ? null : h))
                  updateHandLift(null)
                }}
              >
                <motion.div
                  // Keying on selectedIndex (the active unit) remounts every card
                  // whenever a new action-selection round starts, so the deal-in
                  // "initial" animation below replays instead of only firing once
                  // on first mount. This element ONLY ever plays that one-shot
                  // deal-in — opening/closing on hover lives one level down, as a
                  // plain CSS class toggle, so the two never fight over the same
                  // transform.
                  key={`${card.id}-${selectedIndex}`}
                  className="bh-hand-card-mount"
                  initial={{ opacity: 0, y: 36 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.03 * i, ...springTransition }}
                >
                <div
                  className={`bh-hand-card bh-theme-${card.theme} bh-tier-${tier} ${isHovered ? 'is-hovered' : ''}`}
                  // This element's rest transform is the resting-fan geometry
                  // (--fan-rotate/--fan-y). isHovered by itself changes
                  // nothing here — only .bh-hand-card-face's height and this
                  // element's own `scale` (see .is-hovered in the CSS) react
                  // immediately, so a card expands strictly in place with its
                  // fan angle untouched the moment the pointer enters it.
                  // Straightening and rising both live in these two inline
                  // overrides instead, driven by the SAME up-the-pointer-has-
                  // moved input at two different softnesses (see
                  // updateHandLift): handRotateMul multiplies away the
                  // resting rotate (1 = untouched, 0 = fully straight, and it
                  // resolves quickly), while handLiftPx subtracts from the
                  // resting y (0 = untouched, rising slowly toward a capped
                  // max). Because `translate` is always resolved before
                  // `rotate` in the standalone-property order (spec-defined,
                  // not declaration-order), that subtraction is always a true
                  // vertical rise in screen space regardless of the card's
                  // current tilt — never "extended along the tilted axis".
                  // At up=0 both multipliers are neutral (1 and 0), so they
                  // reproduce the exact resting transform with zero jump.
                  // While hovered the transition is switched off so every
                  // pointer sample lands with no extra lag on top of what the
                  // curves already supply; the moment hover ends, the base
                  // rule's own transition (see CSS) takes back over and eases
                  // whatever was showing back to the resting fan geometry.
                  style={{
                    '--fan-rotate': `${g.rotate}deg`,
                    '--fan-y': `${g.y}px`,
                    ...(isHovered
                      ? {
                          translate: `0 ${g.y - handLiftPx}px`,
                          rotate: `${g.rotate * handRotateMul}deg`,
                          transition: 'translate 0s, rotate 0s',
                        }
                      : {}),
                  } as CSSProperties}
                >
                  <button
                    type="button"
                    className="bh-hand-card-face"
                    disabled={spectatorMode || tier === 'unavailable'}
                    aria-expanded={isHovered}
                    onClick={(e) => {
                      // One click commits the card. Hover/focus still expands the
                      // readable detail without introducing a second confirmation tap.
                      void handleCardPlay(card, e.currentTarget)
                    }}
                  >
                    {/* Persistent, never fades — stays anchored top-right in both
                        states so the cost is always readable regardless of overlap. */}
                    <span className="bh-hand-card-cost">{card.cost}</span>
                    {/* Collapsed state: icon + name live inside the one strip
                        (this card's right edge) that a static, monotonic stacking
                        order guarantees is never covered by a neighbor — see the
                        fanGeometry comment. This is what makes every card's name
                        readable at a glance without needing to hover. Hides
                        instantly on hover-in, fades back in on hover-out — see
                        .bh-hand-card-compact in globals.css. */}
                    <div className="bh-hand-card-compact">
                      <span className="bh-hand-card-icon">
                        <ActionGlyph kind={card.icon} />
                      </span>
                      <CardSliverName name={card.name} />
                    </div>
                    <AnimatePresence>
                      {isHovered && (
                        <motion.div
                          className="bh-hand-card-detail"
                          initial={{ opacity: 1 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.22, ease: 'easeOut' }}
                        >
                          <span className="bh-hand-card-detail-icon">
                            <ActionGlyph kind={card.icon} />
                          </span>
                          <span className="bh-hand-card-name">{card.name}</span>
                          <div className="bh-hand-card-reqs">
                            {card.reqIcons.map((kind, j) => (
                              <ReqGlyph key={j} kind={kind} />
                            ))}
                          </div>
                          <span className="bh-hand-card-effect">
                            {card.effect} {card.effectValue && <strong>{card.effectValue}</strong>}
                          </span>
                          <p className="bh-hand-card-desc">{card.description}</p>
                          <div className="bh-hand-card-meta">
                            <span className="bh-hand-card-tag">{card.tag}</span>
                            <span className="bh-hand-card-target">
                              {card.target === 'none' ? 'Self' : card.target === 'hostile' ? 'Target enemy' : 'Target ally'}
                            </span>
                          </div>
                          {tier === 'unavailable' && <span className="bh-hand-card-warn">Not enough AP</span>}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </button>
                </div>
                </motion.div>
              </motion.div>
            )
          })}
          </AnimatePresence>
        </div>
      </div>

      {/* TARGETING HINT — appears only while a targeted card is armed */}
      <AnimatePresence>
        {targetingCard && (
          <motion.div
            className="bh-targeting-hint"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            Choose a target for <strong>{targetingCard.name}</strong> · Esc or click empty space to cancel
          </motion.div>
        )}
      </AnimatePresence>

      {/* GHOST CARD — the armed card detaches from the hand and chases the cursor
          with a soft spring until a valid target token or empty space is clicked */}
      <AnimatePresence>
        {targetingCard && pointerPos && dragOrigin && (
          <motion.div
            className={`bh-ghost-card bh-theme-${targetingCard.theme}`}
            initial={{ opacity: 0, scale: 0.7, x: dragOrigin.x - 46, y: dragOrigin.y - 68 }}
            animate={{ opacity: 1, scale: 1, x: pointerPos.x - 46, y: pointerPos.y - 68, rotate: -6 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: 'spring', stiffness: 480, damping: 34 }}
          >
            <span className="bh-ghost-card-icon">
              <ActionGlyph kind={targetingCard.icon} />
            </span>
            <span className="bh-ghost-card-name">{targetingCard.name}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CAST FLIGHT — no-target actions fly straight from the hand to the acting
          unit and burst, so a single click reads as an immediate, resolved play */}
      <AnimatePresence>
        {castFlight && (
          <motion.div
            className={`bh-cast-flight bh-theme-${castFlight.card.theme}`}
            initial={{ opacity: 1, scale: 1, x: castFlight.from.x - 18, y: castFlight.from.y - 18 }}
            animate={{ opacity: 0, scale: 0.4, x: castFlight.to.x - 18, y: castFlight.to.y - 18 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
          >
            <ActionGlyph kind={castFlight.card.icon} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {spectatorMode && <motion.div className="bh-spectator-badge" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}><Eye size={13} /> SPECTATOR READONLY</motion.div>}
      </AnimatePresence>

      {/* post-processing: scanlines + grain + vignette to seat the UI in the game world */}
      <div className="bh-post-scanlines" aria-hidden="true" />
      <div className="bh-post-grain" aria-hidden="true" />
      <div className="bh-post-vignette" aria-hidden="true" />
    </div>
  )
}
