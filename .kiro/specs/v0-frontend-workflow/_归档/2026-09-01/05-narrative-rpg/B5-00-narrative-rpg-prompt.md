# B5-00 Narrative RPG Batch Entry Prompt
<!-- prompt-pack: command-entry batch=B5 execution=independent-command -->

## 0. Independent Execution Contract

This command is independently executable together with every numbered brief in this directory. Batch 0, earlier batches, and prior conversation context are not prerequisites. The AI must inspect the entire existing frontend project and treat it as the current implementation fact: reuse and modify existing code and mount boundaries first; when a required mount point is missing, add only the smallest compatible piece within the existing architecture. Do not create an isolated demo, second shell, route center, state authority, or parallel world scene.

Do not duplicate, regress, or break existing functionality. Modify only the current B5 responsibility range and do not wait for a prerequisite batch. Global hard-constraint summary: UI-only; read-only `mock`/projection data; explicit intents only; materials are allowed and existing `assetRef`/manifest slots must remain, with no zero-materials criterion; the internal UI of `editor`, `research-bench`, `material-library`, and `computer` is out of scope; show no more than five simultaneous items; `+3` is deferred and non-selectable, while its selection/trigger effects and later handoff slot remain.

This is the batch entry prompt for the WakeUp v0 narrative-RPG frontend package. Treat it as the authoritative entry boundary for the numbered B5 briefs listed below. Build a declarative React + TypeScript presentation shell for narrative dialogue, quests and objectives, tutorials and help, location titles, notifications and history, statistics, achievements, codex, and recap. The shell consumes read-only projections, presents local UI state, and emits explicit intents through stable host ports. It must not implement gameplay rules, progression, rewards, relationships, statistics writes, navigation, or save writes.

## Project Positioning

- This package is the narrative RPG presentation family inside the WakeUp frontend workflow, not a second route-switching center or an independent gameplay system.
- The control panel or existing shell remains the page switching and extraction boundary. Narrative surfaces must mount into that boundary and must not create another one.
- Pages preserve the world layer, character or registered-material visibility, and spatial hierarchy through dark translucent overlays, rather than becoming white-background SaaS panels, browser chrome, or a uniform card wall.
- The package covers dialog and portraits, quest log and objective tracker, tutorial and help, location-title presentation, notification priority and history, stats, achievements, codex, and recap.
- UI-visible lists, comparisons, option groups, and notification stacks show at most five simultaneous items. Larger projections use pagination, scrolling, or grouping without showing more than five at once.

## Scope List

In scope:

- Narrative overlay layer: dialog and portrait surface, quest log and objective tracker, tutorial/help and location title, notification and history surface.
- Progress/archive layer: stats surface, achievements surface, codex surface, and recap surface.
- World presentation layer and intent-status region required to preserve context and announce projection or intent outcomes.
- Read-only projection loading, asset fallback, stale/retry, rejection, timeout, and resynchronization presentation.
- Stable intent dispatch for opening, closing, advancing, tracking, replaying, filtering, selecting, and other explicitly exposed narrative UI actions.

Numbered briefs in this batch directory:

- `B5-01-dialog-and-portrait-fallback.md` — dialog hierarchy, display names, portraits, voice, subtitles, and fallback behavior.
- `B5-02-quest-log-objective-tracker.md` — quest log, objective tracking, intent status, and bounded list presentation.
- `B5-03-tutorial-help-location-title.md` — tutorial/help surfaces and spatially continuous location-name演出.
- `B5-04-notification-priority-and-history.md` — notification priority, queue behavior, history, and readable status.
- `B5-05-stats-achievements-codex-recap.md` — statistics, achievements, codex, and story recap/archive views.

## Reference Materials

Use the following traceable attachments as the authority set. Attachment IDs and provenance are the reference contract; do not rely on repository paths alone.

- `attachmentId: narrative-dialog-system`
  `provenance: dialog-hierarchy-displayName-voice-subtitles-fallback-and-default-no-pause-semantics`
- `attachmentId: rpg-narrative-guidance-overview`
  `provenance: quest-objective-tutorial-notice-location-statistics-achievement-codex-and-recap-semantics`
- `attachmentId: frontend-rendering-toolchain`
  `provenance: Framer-Motion-Radix-Zustand-Howler-and-lucide-implementation-responsibilities`
- `attachmentId: frontend-visual-implementation`
  `provenance: narrative-module-assets-layering-animation-and-handoff-constraints`
- `attachmentId: frontend-workflow-design`
  `provenance: prompt-package-control-panel-and-read-only-presentation-boundary`
- `attachmentId: b5-numbered-brief-set`
  `provenance: narrative-dialog-quest-tutorial-notification-and-archive-subtasks-listed-in-this-batch-entry`

## Technical Constraints

- Use the existing shell and control-panel mount boundary; do not add a second routing or extraction center.
- Consume a read-only projection equivalent to `NarrativeRpgProjection` with `surfaceId`, `revision`, `mode`, bounded narrative items, available intents, asset references, warnings, and explicit mock markers where applicable.
- Components may read props or stable ports only. Do not read internal entities, rule objects, ledgers, navigation graphs, callback closures, or another page's business store.
- Use explicit intent objects and a stable dispatcher. Each request must expose pending, accepted, rejected, timeout, or resync-required outcomes; request dispatch is not a confirmed business result.
- Keep all simultaneous UI lists, comparison groups, option groups, and notification stacks at five items or fewer. Use pagination, scrolling, or grouping for larger projections.
- Use Framer Motion, `AnimatePresence`, `layout`, and declarative spring sequences for entry, exit, reorder, confirmation, and hierarchy changes. Effects bind only to local UI state or host-confirmed results.
- Use Radix dialog behavior for modal dialog and tutorial surfaces: focus trap, Esc, `aria-modal`, title, description, and focus return.
- Use Zustand only for discardable UI state if needed; it must not become a gameplay, progression, archive, or save store. Use Howler through the audio port for voice/effects and subtitles; the UI does not own global mixing rules.
- Preserve registered material slots through `assetRef` or an equivalent read-only reference. On failure, retain the semantic container and provide an accessible fallback rather than deleting the slot or claiming that no materials exist.
- Inherit global semantic tokens: red danger/failure, blue clarity/information, yellow reminder, orange in progress, green complete/safe, purple constraint, cyan social/communication, gray cooldown/unavailable, milk-white or pure white dream boundary, and gold/silver achievement or collection highlight.
- Respect reduced motion by shortening or removing displacement while retaining state changes, focus, and semantic color or text.

## Naming Rules

- Preserve the root and layer names `NarrativeRpgSurface`, `WorldPresentationLayer`, `NarrativeOverlayLayer`, `ProgressArchiveSurface`, and `IntentStatusRegion`.
- Preserve component names `DialogAndPortraitSurface`, `QuestLogAndObjectiveTracker`, `TutorialHelpAndLocationTitle`, `NotificationAndHistorySurface`, `StatsSurface`, `AchievementsSurface`, `CodexSurface`, and `RecapSurface`.
- Use the projection names `NarrativeRpgProjection` and `ReadonlyNarrativeItem`; keep `surfaceId`, `revision`, `mode`, `items`, `availableIntents`, `assetRefs`, and `warnings` as read-only concepts.
- Use the intent names `surface.open`, `surface.close`, `dialog.advance`, `quest.track`, `tutorial.replay`, `notice.history.open`, and `archive.select` where those actions are exposed.
- Use status names `closed`, `open-requested`, `loading`, `projection-ready`, `asset-missing`, `projection-error`, `timeout`, `stale-or-retry`, `presenting`, `presenting-with-fallback`, `focused`, `intent-pending`, `accepted`, `acknowledged`, `rejected`, `error-recoverable`, `resync-required`, and `closing`.
- Mark development-only projection values with `mock`; use `assetRef` for material references and `revision` for freshness.

## Interaction Rules

- Opening, closing, advancing, tracking, replaying, filtering, expanding, selecting, and replaying narrative surfaces create UI intents only. They never directly write quests, relationships, rewards, statistics, achievements, codex entries, story progress, or saves.
- Route every intent through a stable host dispatcher and render its pending, accepted, rejected, timeout, or resync-required result. Do not interpret a local click, `onSelect`, animation start, or optimistic label as rule success.
- Dialogue defaults to not pausing the game. Pause policy belongs to the host projection and a separate stable port; narrative UI must not pause the world on its own.
- Dialog and tutorial modals use Radix behavior. Closing returns focus to the triggering control. Esc closes the local surface where permitted without fabricating a host result.
- Keyboard users can reach all controls with Tab, activate with Enter/Space, and move one item at a time through lists. Unavailable items state why they are unavailable. All dynamic content uses appropriate live regions without repeatedly stealing focus.
- Keep notification priority visible and bounded: high-priority notices receive readable announcement without continuous repetition, while subtitles and low-priority notices do not steal focus.
- Keep world context and registered assets visible through overlays. Missing assets show a semantic fallback with a readable name and retain the asset container.
- Handle stale revisions by discarding stale local selection and requesting fresh projection data. Do not preserve a local choice as if it were persistent progress.
- All interactive controls provide `hover`, `focus`, `active`, `disabled`, and `return` presentation states. Hover is only visual feedback and never a submission signal.
- Color is never the sole state channel; pair it with text, icon, shape, or an accessible label. Respect reduced-motion preferences.

## Explicit Exclusions

- Do not implement quest creation, completion, failure, rewards, relationship changes, statistics writes, achievement unlocking, codex unlocking, story progression, or save persistence.
- Do not make a control's direct `onSelect`, click handler, or keyboard handler execute business logic or mutate a domain store.
- Do not implement maps, nodes, topology, pathfinding, route cost, editors, research benches, material libraries, or computer internals.
- Do not turn quest logs, notification history, codex, or collections into freely editable repositories; do not add unauthorized discard, packing, or editing operations.
- Do not create a second control panel, route center, global audio mixer, or gameplay pause mechanism.
- Do not use an unbounded card wall, white-background web template, or missing-materials premise as the visual solution.
- Do not infer a confirmed business state from local booleans, mock data, animation, request dispatch, or a stale projection.

## Batch Objective

Deliver a complete narrative RPG presentation package that can open and close each covered surface, render dialog and portraits with voice/subtitle and fallback semantics, present bounded quest and objective views, replay tutorial/help and location titles, queue and review notifications, and browse stats, achievements, codex, and recap. Every surface must preserve world context, registered asset slots, keyboard and screen-reader access, reduced-motion behavior, and explicit intent outcome states. The result must be demonstrable with mock projections while remaining structurally ready for host-confirmed live projections and never implementing gameplay or progression rules.

## Batch Dependencies

- B1–B4 capabilities are non-blocking context: if the existing project already has the AppShell, control panel, page mounts, extraction boundary, focus handling, projections, and ports, reuse them; if any are missing, add only the smallest compatible mount point required by this command and its numbered briefs within the existing architecture. Batch 0, prior-batch, and prior-conversation context are not required.
- Existing narrative/guidance projections, asset ports, and audio ports should be reused when present. If a required boundary is missing, establish only the smallest stable read-only projection or explicit-intent port needed for the current B5 scope; never depend on internal domain shapes or create a parallel authority.
- Framer Motion, Radix, Zustand, Howler, and lucide retain their declared presentation, accessibility, discardable-local-state, audio-port, and icon responsibilities wherever those integrations already exist.
- B6/B7 are handoff notes only: later work may consume B5's stable projection names, intent names, five-item bound, control states, focus-return behavior, asset fallback, and no-business-logic rules. B5 does not wait for, implement, or modify later-batch responsibilities.

## Acceptance Checks

- [ ] All five numbered B5 briefs are listed and treated as subtask references without reproducing their former 15-section brief structure.
- [ ] Every surface consumes read-only projection data, shows mock status where applicable, and submits explicit intents through a stable port.
- [ ] Dialog, quests, tutorials, notifications, and archive surfaces show no more than five simultaneous comparable items; larger data has pagination, scrolling, or grouping.
- [ ] Dialogue defaults to no pause, and every registered asset reference has a readable fallback that preserves its material slot.
- [ ] Radix dialog accessibility, Framer Motion transitions, Zustand local-state boundaries, Howler audio-port boundaries, and lucide icon semantics are all preserved.
- [ ] Loading, asset-missing, projection-error, rejected, timeout, stale/retry, and resync-required states are demonstrable without presenting fabricated completion.
- [ ] Keyboard navigation, visible focus, focus return, live-region announcements, non-color state cues, and reduced-motion behavior work across covered surfaces.
- [ ] No direct `onSelect` business logic, gameplay mutation, progression write, archive mutation, route-center duplication, or global pause mechanism is introduced.
- [ ] The package retains the world presentation layer and registered asset containers instead of using a zero-materials or generic web-card completion criterion.

## Attached AI-readable packet

本命令必读本文件+同目录 numbered briefs；G-* 和 R-* 是可选补充，正文摘要已足够执行。
