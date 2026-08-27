# B3-00 Residence Flow Batch Entry Prompt
<!-- prompt-pack: command-entry batch=B3 execution=independent-command -->

## 0. Independent Execution Contract

本命令可独立执行。已有项目是当前实现事实；AI 必须先检查现有前端并在其基础上修改，不能另起孤立 demo。缺失挂载点时，在现有架构内最小补齐；已存在功能不得重复/破坏。只修改当前批次职责范围，不要等待前置批次，也不要求记住 Batch 0 或前一批次对话。

全局硬约束摘要：UI-only；只读 mock/projection；所有交互使用显式 intent，不执行玩法或业务规则。允许使用并挂载登记素材与可替换 `assetId`/`assetRef`；不用“零素材”口径作为完成标准，缺失素材保留语义挂载位和 fallback。四类内部 UI out-of-scope：`editor`、`research-bench`、`material-library`、`computer`，只能保留入口/挂载位，不实现内部页面。同屏并列可操作选项 ≤5，超出时分页、滚动、分组或分步。`+3极限爆发` deferred/future-evaluation-only，MVP 不可选，但保留必要的预留表现槽位。

This is the batch entry prompt for the WakeUp v0 residence-flow frontend package. Treat it as the authoritative entry boundary for the numbered B3 briefs listed below. Build a declarative React + TypeScript presentation shell that renders the residence and transition experience from read-only projections. The shell may create local UI state and action intents, but it must not execute gameplay, matchmaking, loading, settlement, or position rules.

## Project Positioning

- `residence-main` is a spatial residence entry flow, not a homepage, dashboard, card wall, or uniform button grid.
- The experience covers the room, lighting, occlusion, residence entities, anchor-device matchmaking, three-bed gating, asynchronous roaming, shadow lobby, bed-front readiness, match loading, battle introduction, result, and return-home ceremony.
- The shell must preserve the room as the visual context while overlays provide only sparse guidance and confirmed projection status.
- The covered page IDs are `residence-main`, `transition-battle-intro`, `transition-dream`, and `transition-result`.
- Rules, matchmaking facts, loading facts, settlement facts, and the return position come from read-only projections. Every local control emits an action intent through a stable host port.

## Scope List

In scope:

- Residence scene layer: room backdrop, residence entities, player, and shadow layer.
- Residence inputs: node focus, bed-front readiness target, and roam surface.
- Residence overlays: anchor mode panel, match-status ribbon, shadow-lobby overlay, bed-front-ready prompt, and residence notices.
- Ceremony layer: battle introduction, multi-stage pure-white `enter-dream`, result continuation, and multi-stage pure-white `return-home`.
- Entity ports for Bed A competitive, Bed B deferred, Bed C self-test, anchor device, research bench, dream cabin, computer, television notice, bookshelf, safe, and door-slit narrative entry. Only the explicitly permitted Bed A and Bed C behaviors are interactive in this batch.

Numbered briefs in this batch directory:

- `B3-01-residence-node-and-input.md` — residence nodes, focus, roaming, and input equivalence.
- `B3-02-match-shadow-lobby.md` — asynchronous matchmaking, Bed A lighting, and in-room shadow lobby.
- `B3-03-dream-load-return-transition.md` — readiness, loading, battle introduction, dream transitions, result, and original-position return.
- `B3-04-residence-empty-error-states.md` — empty, timeout, missing-asset, relay, loading-failure, retry, and cancellation states.

## Reference Materials

Use the following traceable attachments as the authority set. Attachment IDs and provenance are the reference contract; do not replace them with a repository-path-only citation.

- `attachmentId: ops-residence-flow-03`
  `provenance: three-bed-roles-anchor-gate-shadow-lobby-white-manifestation-original-position-return`
- `attachmentId: ops-outside-growth-01`
  `provenance: async-matchmaking-roaming-and-operation-boundary`
- `attachmentId: presentation-implementation-09`
  `provenance: residence-entity-assets-layering-and-motion-library-mapping`
- `attachmentId: presentation-animation-feedback-02`
  `provenance: presentation-rule-separation-fallback-and-skippable-ceremony`
- `attachmentId: user-residence-mvp-gate-20260820`
  `provenance: bed-a-competitive-only-bed-b-deferred-bed-c-self-test-only-load-failure-return-home`
- `attachmentId: b3-numbered-brief-set`
  `provenance: residence-flow-node-match-transition-and-error-subtasks-listed-in-this-batch-entry`

## Technical Constraints

- Use the existing app shell, route mount points, global semantic tokens, and stable host ports. Do not create a second residence topology or a second route-switching center.
- Consume a read-only `ResidenceFlowSnapshotMock`-compatible projection. Projection fields include page identity, player position, bed states and `assetId`s, anchor state, match state, target bed, and `returnOrigin`; mark all mock values with `mock`.
- UI projection fields are not writable gameplay state. Do not deduct resources, advance turns, fabricate match success, mutate settlement, or write player position in the presentation layer.
- Asset fields are mounting contracts, not rule facts. Retain explicit `assetId` mounting points and show a named, semantic fallback when an asset is missing. Do not use zero-materials or meaningless placeholder blocks as the completion criterion.
- Use Framer Motion, `AnimatePresence`, `layout`, spring, or another declarative sequence for spatial transitions. Do not substitute a single CSS linear fade or a generic loading page for the ceremony.
- Keep the room visible during matchmaking and represent the shadow lobby as an in-room overlay. Do not reload an independent collective-lobby scene.
- Apply the existing semantic color tokens: blue for Bed A competitive/clear technology, coral for deferred Bed B, cyan for Bed C self-test, gray for unavailable or delayed, orange for in progress, green for success/continue, red for errors, pure white for dream boundaries, and gold for result highlights.
- Preserve reduced-motion behavior: reduce displacement, particles, and flashes while retaining status text, focus movement, and the final spatial landing.

## Naming Rules

- Preserve the page IDs exactly: `residence-main`, `transition-battle-intro`, `transition-dream`, and `transition-result`.
- Preserve state names exactly where used: `residence-idle`, `anchor-open`, `matching`, `residence-roaming-while-matching`, `match-complete-bed-a-lit`, `bed-a-front-ready`, `battle-hud`, `result-continue`, `residence-original-position`, `deferred-disabled`, `self-test-preview`, `loading`, and `load-failed`.
- Use the entity names `BedACompetitive`, `BedBDeferred`, `BedCSelfTest`, and `AnchorDevice`; Bed A, Bed B, and Bed C labels must remain unambiguous in visible and accessible text.
- Use the intent names `open-anchor`, `start-competitive-match`, `cancel-match`, `roam-residence`, `ready-at-bed-a`, `open-bed-c-self-test`, `continue-result`, `skip-ceremony`, and `retry-load`.
- Keep asset references explicit as `assetId`; keep mock projection values visibly marked `mock`; call the saved return location `returnOrigin`.
- Keep component ownership under `ResidenceFlowRoot`, with `ResidenceSceneLayer`, `ResidenceInputLayer`, `ResidenceOverlayLayer`, and `CeremonyLayer` as the main presentation layers.

## Interaction Rules

- The MVP has one formal entry mode: the anchor device exposes competitive mode only.
- Bed A is the only competitive load entry. It is locked before a confirmed match, lights only after the projection says the match is complete, and then supports the bed-front ready flow.
- Bed B is deferred content. It remains coral, visibly labeled as deferred, permanently disabled, excluded from the actionable tab order, and unable to start matchmaking or loading.
- Bed C is self-test only. It may open a self-test preview or explanation and must return to `residence-idle`; it must never enter matchmaking, a competitive match, or formal loading.
- Until the anchor interaction is complete, all three beds are gated and must not look like direct lie-down entry points. After MVP match completion, only Bed A is lit.
- While matching, the player may roam the residence and use non-conflicting ports. Do not show a blocking waiting page.
- After matching, show ready players as translucent shadows layered into the original room. This is an overlay state, not a new scene or route.
- The player must reach Bed A and confirm readiness before the battle introduction, `enter-dream`, battle, result, and `return-home` sequence. `continue-result` must return to the saved `returnOrigin`, not the default spawn point.
- Every visible control supports `hover`, `focus`, `active`, `disabled`, and `return` presentation states. Keyboard activation uses Enter/Space; Esc closes an overlay or cancels the local floating surface; roaming has an equivalent focusable interaction.
- Use readable names, `aria-disabled`, `aria-describedby`, visible focus rings, and live-region announcements for matching, Bed A lighting, loading failure, and return status. Do not communicate gating by color alone.
- `skip-ceremony` may converge only to the current legal presentation endpoint. It cannot alter loading or settlement facts. Retry and cancel remain intents whose confirmed outcomes come from the host port.

## Explicit Exclusions

- Do not implement Bed B co-op content, Bed C formal entry, room hosting, party permissions, matchmaking algorithms, or a real server protocol.
- Do not implement a unified lobby scene, a blocking matchmaking wait screen, or a second residence topology.
- Do not implement the internal pages of the research bench, dream cabin, computer, bookshelf, safe, or other residence ports; retain them as entry ports only.
- Do not implement real saves, real settlement, AP/HP/SP, pathfinding, ORCA, map nodes, or gameplay rules.
- Do not replace spatial ceremony with a one-frame white screen, ordinary loading page, browser scrollbar, or pure button-card wall.
- Do not silently substitute a semantically wrong asset, remove an asset-bearing entity, or claim completion with zero visual materials.
- Do not treat a local mock flag, animation start, request dispatch, or optimistic label as a confirmed rule result.

## Batch Objective

Deliver a complete, demonstrable residence-to-battle-to-return presentation shell. Starting from `residence-idle`, the user can open the anchor device, select the only available competitive mode, start asynchronous matching without losing room roaming, observe only Bed A light on confirmed completion, see the in-room shadow lobby, walk to Bed A and ready, pass through the battle introduction and pure-white dream boundary, reach the result, and continue through pure-white `return-home` to the recorded original position. The shell must also demonstrate Bed B deferred gating, Bed C self-test-only behavior, matching timeout, asset failure, relay staleness, load failure, retry, cancellation, keyboard equivalence, focus return, mock labels, and reduced-motion fallback without implementing gameplay rules.

## Batch Dependencies

- 前批次 B1：若项目已有 AppShell、驻地与过渡路由挂载点、ControlPanel 抽取边界、全局 token 和稳定页面切换则复用；若没有，按本命令约定在现有架构内补齐；不要求记住 Batch 0 或前一批次对话。
- 当前批次约定：本文件与同目录 numbered briefs 已包含可执行的驻地、过渡、素材挂载、状态和门禁摘要；其他附件均为可选补充，不构成阻塞依赖。
- 后续交接说明：B2 可通过稳定的 battle-entry 与 result intent/projection 端口接入 HUD；本批次提供 `start-load`、`continue-result` 等稳定 intent，不依赖 HUD 内部实现。
- 后续接线说明：素材生产继续使用既定管线；运营侧通过只读 projection 与端口提供匹配、加载、结算结果和 `returnOrigin`，不要求本批次读取内部数据形状。

## Acceptance Checks

- [ ] From residence idle, the anchor exposes competitive mode only; before anchor completion no bed is presented as direct entry.
- [ ] On confirmed MVP matchmaking completion, only Bed A lights; Bed B stays deferred and disabled; Bed C opens self-test only and cannot enter a formal match.
- [ ] Matching permits residence roaming and non-conflicting ports without a blocking wait page.
- [ ] The completed match renders an in-room translucent shadow lobby without an independent scene reload.
- [ ] The Bed A front-ready action leads through battle introduction, `enter-dream`, battle, result, and `return-home` in the declared order.
- [ ] Continuing from result uses pure-white `return-home` and lands at the saved `returnOrigin`.
- [ ] Matching timeout, cancellation, asset failure, shadow relay staleness, load failure, retry, and return-home error states are visible and never claim unconfirmed success.
- [ ] Room entities retain semantic asset mounting points, visible gate labels, and mock markers; no zero-materials criterion is used.
- [ ] All visible controls expose the five presentation states, keyboard-equivalent actions, focus return, live status text, and reduced-motion fallback.
- [ ] The implementation remains a presentation shell: no local gameplay, matchmaking, settlement, save, or position mutation is introduced.

## Attached AI-readable packet

本命令必读本文件+同目录 numbered briefs；G-* 和 R-* 是可选补充，正文摘要已经足够执行。以下 YAML 仅作为可选的机器可读补充包，不构成阻塞依赖。

```yaml
schema: wakeup.frontend.batch-entry.v1
batchId: B3-00
family: residence-flow
pageIds: [residence-main, transition-battle-intro, transition-dream, transition-result]
sourcePolicy: attachmentId-and-provenance
authority:
  - attachmentId: ops-residence-flow-03
    provenance: three-bed-roles-anchor-gate-shadow-lobby-white-manifestation-original-position-return
  - attachmentId: ops-outside-growth-01
    provenance: async-matchmaking-roaming-and-operation-boundary
  - attachmentId: presentation-implementation-09
    provenance: residence-entity-assets-layering-and-motion-library-mapping
  - attachmentId: presentation-animation-feedback-02
    provenance: presentation-rule-separation-fallback-and-skippable-ceremony
  - attachmentId: user-residence-mvp-gate-20260820
    provenance: bed-a-competitive-only-bed-b-deferred-bed-c-self-test-only-load-failure-return-home
numberedBriefs:
  - B3-01-residence-node-and-input.md
  - B3-02-match-shadow-lobby.md
  - B3-03-dream-load-return-transition.md
  - B3-04-residence-empty-error-states.md
hardGates:
  anchorMode: competitive-only
  bedA: competitive-load-entry
  bedB: deferred-disabled
  bedC: self-test-only
  matchmaking: non-blocking-residence-roaming
  lobby: in-room-shadow-overlay
  return: pure-white-return-home-to-returnOrigin
portsOnly: true
readOnlyProjection: true
forbidden: [gameplay-rules, matchmaking-algorithm, real-save, real-settlement, second-residence-topology]
requiredEvidence: [assetId-mounts, mock-labels, timeout, load-failure, retry, cancel, keyboard-equivalence, reduced-motion]
```
