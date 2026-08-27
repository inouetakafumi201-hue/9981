# EXTRACTION-REPORT — Project Echo UI Shell

Audit scope: the ten product pages reachable from `control-panel-main`
(`01 控制面板`, `03 标题菜单` family, `05 驻地主场景`, `06 对局 HUD`, `07 对话·单行`,
`08 对话·选项`, plus `objective-tracker` / `location-title` / `stats` /
`achievements` / `codex` / `recap`), checked against the seven-state matrix
(`idle / loading / empty / error / pending / stale / cancelled` as expressed
through this shell's shared mock-intent vocabulary: `idle`, `pending`,
`accepted`, `rejected`, `stale`, `timeout`, `cancelled`), and the six control
capabilities `control-panel-main` is required to expose.

## 1. Seven-state matrix audit

| Page | Idle | Loading/Pending | Empty | Error (rejected/timeout) | Stale | Cancelled | Notes |
|---|---|---|---|---|---|---|---|
| objective-tracker | ✅ | ✅ | ✅ | ✅ (fixed) | ✅ | ✅ (fixed) | `progress-surfaces.tsx` lacked a cancel affordance on pending; fixed alongside the shared hook. |
| location-title | ✅ | ✅ | n/a (static) | ✅ | ✅ | ✅ | Uses `PageStateFrame` degrade paths; no gaps found. |
| stats | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Empty/error states verified via `PageStateFrame`; no gaps found. |
| achievements | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | No gaps found. |
| codex | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | No gaps found. |
| recap | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | No gaps found. |
| dialog-line | ✅ | n/a | n/a | n/a | n/a | n/a | Pure playback surface — no host intent round trip is dispatched, so pending/error/stale/cancelled do not apply. |
| **dialog-options** | ✅ | ✅ | n/a | ✅ (fixed) | ✅ (fixed) | ✅ (fixed) | Two defects found and fixed — see §2. |
| control-panel-main | ✅ | n/a | n/a | n/a | n/a | n/a | Shell-level page; does not itself dispatch a mock intent. |
| hud-main | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | No gaps found. |

## 2. Defects found and fixed

### 2.1 Legacy intent hook had no retry/cancel affordance
`lib/use-intent.ts` (`useIntentChannel`, backing `dialog-options`,
`dialog-portrait`, `objective-tracker`/`progress-surfaces`, `quest-log`,
`tutorial-help`) only exposed `dispatch` and `reset`. A `rejected`/`timeout`/
`stale` result had no way to retry, and a `pending` request had no way to be
cancelled locally — both real, user-facing dead ends.

**Fix:** added `retry()` (re-submits the last dispatched intent under a new
request id) and `cancel()` (locally discards a pending request without
applying its eventual reply) to `useIntentChannel`, and wired matching
retry/cancel/safe-return buttons with icons into the `dialog-options` and
`dialog-portrait` feedback banners (`components/dialog-options.tsx`,
`components/dialog-portrait.tsx`, `components/objective-tracker.tsx`,
`components/progress-surfaces.tsx`).

### 2.2 Control panel's global "强制结果" override did not reach the legacy adapter
`control-panel-main`'s `INTENT OUTCOME` block claims "所有页面共用同一个 mock
intent 适配器，任何失败分支都可在此复现" (every page shares one mock adapter;
any failure branch can be reproduced here). In practice the global override
(`getForcedIntentOutcome` / `setForcedIntentOutcome` in `lib/shell-intent.ts`)
was only read by `submitShellIntent`. The legacy adapter's `submitIntent`
(`lib/b1-contract.ts`) only reacted to a per-call `payload.demoFailure` field
that nothing in the UI ever set — so for `dialog-options` and every other
legacy-adapter page, the control panel's selector was a no-op and every
choice silently resolved `accepted`, regardless of the selected forced
outcome.

**Fix:** `submitIntent` now reads the same shared `getForcedIntentOutcome()`
override before falling back to `payload.demoFailure`, and now also honors
`stale` and `cancelled` (previously only `rejected`/`timeout` were possible).
Verified in-browser end to end on `dialog-options`: forcing `TIMEOUT` and
choosing an option renders "请求超时 · MOCK_TIMEOUT..." with working 重试/安全返回
controls; retrying while the override is still active correctly stays failed;
clearing the override and retrying correctly recovers to "宿主已确认".

### 2.3 Motion registry had undeclared coverage gaps
`lib/motion-registry.ts` allowed a motion record to omit outcomes without
flagging it. Added `motionCoverageGaps()` and a dev-only console audit in
`app/page.tsx` so any of the six motion outcomes that is neither implemented
nor explicitly declared not-applicable (`notApplicableOutcomes`) is a loud,
visible gap in the `MOTION REGISTRY` control-panel block rather than a silent
omission.

## 3. Control panel — six control capabilities confirmed present

1. **Page select** — the 36-item page list/navigation (`PAGE SELECT` block).
2. **Category/kind + family filter** — `kindFilter` / `familyFilter`.
3. **Variant select** — `VARIANT` block, per-page preset switching.
4. **State driver** — `STATE DRIVER` block, drives `effectiveState` per page.
5. **Global overrides** — reduced motion, asset-load-failure toggle, forced
   intent outcome, B6 port scenario, and click-to-replay (`playToken`).
6. **Reset** — full reset of navigation/filters/session/override state.

All six were exercised directly in the running preview; no capability was
missing or dead.

## 4. Final verification

- `pnpm exec tsc --noEmit` — clean, no errors, across all fixes in this pass.
- Browser regression (via `agent-browser`) on `dialog-options`: pending →
  accepted happy path, forced `TIMEOUT` → error banner → retry (still forced,
  stays failed) → clear override → retry → recovers to accepted; cancel
  during pending; safe-return from every terminal failure state. All
  confirmed visually and via accessibility snapshot.
- Control panel capabilities (page select, filters, variant, state driver,
  global overrides, reset) exercised directly in the preview.

## 5. Outstanding / out of scope

- `dialog-portrait.tsx` is the legacy, non-product "32 Legacy · 立绘对话台 B5
  非产品" surface. It received the same retry/cancel affordance fix for
  consistency (it shares `useIntentChannel`), but it is not one of the ten
  audited product pages and was not part of the seven-state acceptance
  matrix.
- `dialog-line` and `control-panel-main` do not dispatch a mock intent by
  design, so `pending`/`rejected`/`stale`/`cancelled` are marked `n/a` rather
  than failing — this reflects their actual surface, not a gap.
