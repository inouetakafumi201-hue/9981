# EXTRACTION REPORT — Project Echo Product Journey

Date: 2026-08-23

## Delivered

The root route now opens a single player-facing journey instead of the extraction workbench. `components/product-shell.tsx` owns product presentation while `lib/shell-route.ts`, `lib/shell-journey.ts`, and `lib/shell-intent.ts` remain the only route, journey, and intent authorities.

The implemented loop is:

`boot.startup → boot.restore-loading → menu.title → residence.arrival → residence.roaming → residence.matching → residence.shadow-lobby → residence.bed-front-ready → transition.battle-intro → transition.dream-enter → session.hud → menu.pause → transition.result → transition.reward → transition.dream-return → residence.original-position`.

Every product advance is player-operated. Intent acceptance, mock projection commit, and route completion remain distinct phases; pending requests expose progress, terminal failures retain retry/safe-return handling, and route revisions prevent stale replies from committing after cancellation or supersession.

## Integrated surfaces

- Startup restore projection and explicit title entry.
- Title signal spectacle with new-game/continue routes.
- Residence roaming scene with deterministic journey dock and restored-origin projection.
- Battle intro and dream transitions with reduced-motion support and settled-motion notification.
- Full HUD with explicit pause and mock settlement controls.
- Pause → settings → pause round trip, resume, title, and safe restart handling.
- Result and reward projections followed by dream return and original-position restoration.
- Existing extraction workbench remains available in source as a non-authoritative exported component.
- Root product journey now exposes an always-visible control-panel trigger with live 16-node progress, F2 / backtick shortcuts, node-by-node debug jumps, and a restart inspection action. Debug jumps are explicitly marked and remain excluded from journey acceptance.

## Verification evidence

- `pnpm exec tsc --noEmit` — passed.
- `pnpm run build` — passed under Next.js 16.3.0; `/` prerendered successfully.
- Browser verification at 1560×1063, dark mode — completed the full root-route journey.
- Confirmed pause → settings → pause → HUD round trip.
- Confirmed result → reward → return transition → `residence.original-position`.
- Browser console contained no runtime errors; only intentional `[v0] audio-slot` no-op diagnostics.

Screenshots captured outside the project at:

- `/tmp/agent-browser/journey-startup.png`
- `/tmp/agent-browser/journey-residence-settled.png`
- `/tmp/agent-browser/journey-battle-intro.png`
- `/tmp/agent-browser/journey-hud.png`
- `/tmp/agent-browser/journey-original-position.png`

## Boundary notes

All persistence, matchmaking, battle settlement, rewards, and audio remain explicitly labeled mock projections. No UI path claims external writes or host confirmation beyond the local adapter contract. If origin data is absent, the route uses the declared safe residence fallback rather than fabricating a successful external restore.
