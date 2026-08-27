// Audio slot — a deliberate no-op placeholder for the eventual sound layer.
// The project ships zero audio assets right now, so wiring in a real player
// (Howler, native <audio>, etc.) before there is anything to play would just
// be dead code with a fake dependency attached to it. This keeps every call
// site (menus, transitions, HUD) already shaped exactly like the real thing
// will be shaped, so swapping in playback later is a one-file change here —
// nothing that calls playSfx needs to know or care that it isn't wired yet.
export type SfxId =
  | 'ui-hover'
  | 'ui-focus'
  | 'ui-confirm'
  | 'ui-cancel'
  | 'ui-toggle'
  | 'menu-open'
  | 'menu-close'
  | 'bed-locked'
  | 'bed-select'
  | 'matchmaking-tick'
  | 'matchmaking-found'
  | 'dream-enter'
  | 'dream-exit'
  | 'battle-intro'
  | 'battle-result'
  | 'dialogue-advance'
  | 'dialogue-skip'
  | 'option-select'
  | 'toast-info'
  | 'toast-error'
  | 'item-pickup'
  | 'item-drop'
  | 'item-invalid'
  | 'item-action'
  | 'safe-open'
  | 'match-ready'
  | 'match-cancel'
  // B7 动效收束端口：母题四类语义 + 通道/降级/收尾，以及动作目录四个实体动作
  | 'b7-mask-sweep'
  | 'b7-glow-bloom'
  | 'b7-kinetic-hit'
  | 'b7-dissolve-scatter'
  | 'b7-channel-open'
  | 'b7-settle'
  | 'b7-skip'
  | 'b7-fail'
  | 'b7-catalog-jump'
  | 'b7-catalog-melee'
  | 'b7-catalog-ranged'
  | 'b7-catalog-dice'

export function playSfx(id: SfxId) {
  if (process.env.NODE_ENV !== 'production') {
    console.log('[v0] audio-slot: playSfx (no-op)', id)
  }
}
