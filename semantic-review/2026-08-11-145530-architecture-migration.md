# Document architecture restructuring: 表现系统 migration to orthogonal domain

Migration of presentation system from L2 基类层 to standalone orthogonal domain, implementing clean separation between semantic base classes and presentation contracts.

The change successfully removes presentation concerns (UI, graphics, dev roadmap, tech stack, quality) from the L2 base layer specification, transferring ownership to appropriate orthogonal domains while maintaining system coherence through structured handoff items. **Watch for:** potential ownership gaps in `Presentation_Descriptor` contract definition, and incomplete cross-domain coordination through the handoff mechanism.

## High-level view

The migration cleanly separates L2 semantic responsibilities from presentation concerns. L2 now exclusively owns reusable semantic base classes and provides only read-only projection interfaces, while the presentation system takes full ownership of UI contracts and visual semantics. The three-layer architecture gains conceptual clarity by removing cross-cutting concerns from the base layer. 

Engineering governance files (roadmap, tech stack, quality) properly migrated to dedicated domain, avoiding scope creep in semantic specifications. Cross-domain coordination managed through explicit handoff items rather than implicit dependencies, following the decoupling principles. The `Presentation_Descriptor` ownership transfer represents a significant interface contract change that requires careful validation.

<details>
<summary>Issues (3)</summary>

1. **Presentation contract ownership gap** (**confirmed**) — L2 transfers `Presentation_Descriptor` ownership to presentation system but the receiving contract definition is not yet established, creating a temporary authority vacuum.

2. **Cross-domain handoff validation** (**likely**) — Handoff items H-L2-01, H-L2-02, H-L2-03 lack completion verification mechanism, risking incomplete migration if receiving domains don't acknowledge responsibility.

3. **Reference integrity during transition** (**possible**) — Historical references to old L2 UI paths in interview decisions and constitutional documents may create stale dependency chains during the ownership transition period.

</details>

<details><summary>Details</summary>

## Clean ownership transfer through handoff mechanism

The migration implements clean architectural separation by removing four document categories from L2 authoritative sources: `08_图形化与UI.md`, `09_开发路线图.md`, `10_技术栈.md`, `11_测试与质量.md`. These were properly reclassified as orthogonal domain concerns rather than base layer semantic contracts.

The handoff items (H-L2-01 through H-L2-03) follow the architectural decision principle of not modifying other specs' deliverables directly. Instead of cross-spec changes, the migration creates explicit coordination tasks for receiving domains. This maintains clear ownership boundaries and prevents architectural coupling during transitions.

The engineering governance files successfully migrated to `docs/工程治理/` with proper naming conventions (01_开发路线图.md, 02_技术栈与开发流程.md, 03_测试与质量.md), demonstrating complete removal from L2 scope.

## L2 semantic responsibility refinement

The L2 specification now focuses exclusively on base classes, reusable instances, composition rules, parameter schemas, and semantic adapter contracts. The removal of presentation concerns strengthens the three-layer model by eliminating cross-cutting concerns that previously blurred L2's semantic boundaries.

L2 retains only "通用只读语义投影接口" for UI consumption, establishing a clear read-only boundary. The UI_Adapter remains in L2 scope as a semantic projection interface, but `Presentation_Descriptor` ownership transfers completely to the presentation system. This creates proper separation between semantic state projection and presentation contract definition.

The migration preserves all core L2 contracts (gateway families, action families, item families, etc.) while removing only the presentation layer concerns. This surgical separation maintains L2's reusability value while reducing architectural scope creep.

## Presentation system domain establishment

The presentation system gains full authority over UI contracts, visual semantics, and user interaction patterns. The migration of `docs/表现系统/01_图形化与UI.md` establishes presentation as a first-class orthogonal domain with its own specification scope.

The `.kiro/specs/wakeup-ui-animation/requirements.md` correctly references the new presentation system path in S-06, demonstrating proper cross-spec dependency management. The presentation domain now has clear ownership of visual style, animation contracts, and user interface semantics.

However, the `Presentation_Descriptor` ownership transfer (H-L2-02) represents a significant interface contract gap. L2 surrenders definition authority but the presentation system has not yet established the replacement contract specification. This creates a temporary authority vacuum where UI consuming systems lack a definitive schema.

## Reference integrity challenges  

The migration leaves historical references to old L2 UI paths in several constitutional documents and interview decisions. Files like `docs/访谈决策记录.md` and `docs/L0_规范宪法.md` contain direct path references to `docs/L2_基类层/08_图形化与UI.md` that now point to migrated content.

These stale references don't break system functionality since the content exists at the new location, but they create potential confusion about authoritative source location. The constitutional documents should ideally be updated to reference the new presentation system paths, or establish path redirection mechanisms.

The migration successfully removed all actual file instances of the old paths, confirming clean filesystem separation. The `.kiro/specs/wakeup-ui-animation/requirements.md` properly updates its authoritative source reference to the new path, demonstrating correct cross-domain dependency management.

## Cross-domain coordination mechanism

The handoff items establish explicit coordination contracts between domains, but lack completion verification mechanisms. H-L2-01 requires presentation system to confirm document authority, H-L2-02 requires presentation system to define `Presentation_Descriptor` schema, and H-L2-03 requires engineering governance to confirm file locations.

Without completion tracking, these handoff items could remain indefinitely pending, creating ongoing architectural uncertainty. A more robust approach would include acknowledgment deadlines, completion validation, or automated verification that receiving domains have assumed their responsibilities.

The handoff mechanism itself follows sound architectural principles by avoiding cross-spec modifications and establishing explicit coordination contracts. However, the lack of enforced completion could undermine the migration's effectiveness if receiving domains don't promptly assume ownership.

</details>

<details>
<summary>File map</summary>

**Modified:**
- `.kiro/specs/l2-base-layer-spec/requirements.md` — Removed 4 presentation documents from authoritative sources, updated Presentation_Descriptor glossary to note ownership migration, added 3 handoff items for cross-domain coordination

**Migrated files (confirmed by filesystem inspection):**
- `docs/L2_基类层/08_图形化与UI.md` → `docs/表现系统/01_图形化与UI.md`
- `docs/L2_基类层/09_开发路线图.md` → `docs/工程治理/01_开发路线图.md`
- `docs/L2_基类层/10_技术栈.md` → `docs/工程治理/02_技术栈与开发流程.md`
- `docs/L2_基类层/11_测试与质量.md` → `docs/工程治理/03_测试与质量.md`

**Referenced but unchanged:**
- `.kiro/specs/wakeup-ui-animation/requirements.md` — Already correctly references new presentation system path in S-06

View full diff at: `git log --oneline -5` to see recent migration commits

</details>