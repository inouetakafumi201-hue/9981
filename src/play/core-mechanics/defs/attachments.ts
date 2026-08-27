/**
 * 离散状态的承载结构（tasks.md 任务 3.1 / design.md 3.9-3.14、5.1）。
 *
 * 三条硬约束：
 * 1. 一切离散状态与中间状态都由 `AttachmentDef` 承载，**不用 `props` 布尔字段私自表达状态**
 *    （design.md 1.2 的禁止用法）。`tags` 上的同名标记是**派生索引**，不是状态本体：
 *    它存在的唯一理由见下方"为什么每个状态都配一个 tag"。
 * 2. `stackStrategy` 只允许 `'unique' | 'count' | 'independent'`；**禁止**引擎层的 `'refresh'`
 *    （design.md 3.12：引擎层 `'refresh'` 会 `stack+1` 并直接覆盖 `expiresAt`，与本 Spec
 *    "刷新保留较长剩余时间、不叠加强度"相反）。
 * 3. 每个 `AttachmentDef` 携带 `PlayDefExtension`（`numericOwnership` + `sourceTrace`）。
 *
 * ## 为什么每个状态都配一个 tag（不是冗余）
 *
 * `ActionDef.require` 的求值上下文**没有 `stateAccess`**（见 `expr.ts` 顶部的表），因此
 * `hasAttachment` 恒为 `false`，`{q:...}` 也不可用（`require` 没有 `runQuery`）。`require` 里
 * 唯一能读到的"别人身上的东西"是 `refGet`，而 Entity 上可被 `refGet` 读到的、能表达"是否处于
 * 某状态"的字段只有 `tags`（结构区一等字段）与 `props`。约束 1 排除了 `props`，因此答案是
 * `tags`：Attachment 是状态本体与生命周期，tag 是它在 `require` 里的可读投影。
 *
 * 两者不会漂移，因为 tag 的增删只发生在 `onAdd` / `onRemove` 生命周期效果里——没有任何其它
 * 效果被允许直接增删这些标记。
 */
import type { AttachmentDef } from '../../../core/kernel/attachment/types';
import { playExt } from '../ownership';
import { refId, tagEffects, varOf } from './expr';
import {
  ATT_BLOCKING,
  ATT_BOOST_COMMITMENT,
  ATT_CONCEALED,
  ATT_DOWNED_ZERO,
  ATT_KNOCKED_DOWN,
  ATT_OVERLOADED,
  ATT_PERMANENT_EXIT,
  ATT_PRECISE_INTERACTION,
  ATT_SLEEPING,
  ATT_TRANSIT,
  PATH_SCRATCH_REF,
  TAG_BLOCKING,
  TAG_CONCEALED,
  TAG_DOWNED_ZERO,
  TAG_KNOCKED_DOWN,
  TAG_OVERLOADED,
  TAG_PERMANENT_EXIT,
  TAG_PRECISE_IN_PROGRESS,
  TAG_ROLL_PARTICIPANT,
  TAG_SLEEPING,
  TAG_TRANSIT_IN_PROGRESS,
} from './ids';

/** `attach.add` / `attach.del` 生命周期效果里，被挂载对象由引擎层绑定到 `target` 变量。 */
const TARGET = varOf('target');

/** 生命周期效果：进入状态时补上 tag 索引。 */
const addTag = (tag: string) => tagEffects('add', 'entities', PATH_SCRATCH_REF, refId(TARGET), tag);

/** 生命周期效果：离开状态时撤掉 tag 索引。 */
const delTag = (tag: string) => tagEffects('del', 'entities', PATH_SCRATCH_REF, refId(TARGET), tag);

/**
 * 零血倒地（Requirement 11.3）。条件持续：只能由权威规则移除，回合结束不自动移除。
 *
 * 生命字段的删除由 `play.damage.request` 的 `default` 阶段规则在同一事务内完成，不在这里做：
 * `onAdd` 只负责状态自身的索引，不负责别的资源字段，否则"谁删了生命字段"会有两个答案。
 */
export const downedZeroAttachment: AttachmentDef = {
  id: ATT_DOWNED_ZERO,
  kind: 'attachment',
  stackStrategy: 'unique',
  onAdd: addTag(TAG_DOWNED_ZERO),
  onRemove: delTag(TAG_DOWNED_ZERO),
  play: playExt({
    sourceTrace: ['Req 11.3', 'S5 生命值与倒地系统', 'S0 四·4.2'],
  }),
};

/**
 * 普通倒地（Requirement 12.1-12.4）。**只由显式声明的玩法效果触发**，不得由生命耗尽隐式触发。
 * 触发源集合可以为空数组（格斗系统已按 D-010 降级为可选内容），空是合法且诚实的状态。
 */
export const knockedDownAttachment: AttachmentDef = {
  id: ATT_KNOCKED_DOWN,
  kind: 'attachment',
  stackStrategy: 'unique',
  onAdd: addTag(TAG_KNOCKED_DOWN),
  onRemove: delTag(TAG_KNOCKED_DOWN),
  play: playExt({
    sourceTrace: ['Req 12.1', 'Req 12.4', 'D-010', 'S5 普通倒地'],
  }),
};

/**
 * 格挡（Requirement 14.1-14.3）。**条件持续**：持续到受击或主动取消，回合结束不自动移除。
 * 装载期校验会强制其 `StatusBinding.duration.kind === 'condition'`（见 load.ts 的玩法层 Linter）。
 */
export const blockingAttachment: AttachmentDef = {
  id: ATT_BLOCKING,
  kind: 'attachment',
  stackStrategy: 'unique',
  onAdd: addTag(TAG_BLOCKING),
  onRemove: delTag(TAG_BLOCKING),
  play: playExt({
    sourceTrace: ['Req 14.1', 'Req 14.2', 'D-009', 'S5 格挡与隐蔽状态'],
  }),
};

/**
 * 隐蔽（Requirement 14.5-14.7）。条件持续；移动后由 `after:entity.place` 规则移除。
 * "只在大场景语义中生效"由施加时的场景类型判定负责，本定义不重新实现空间语义。
 */
export const concealedAttachment: AttachmentDef = {
  id: ATT_CONCEALED,
  kind: 'attachment',
  stackStrategy: 'unique',
  onAdd: addTag(TAG_CONCEALED),
  onRemove: delTag(TAG_CONCEALED),
  play: playExt({
    sourceTrace: ['Req 14.5', 'Req 14.6', 'Req 14.7', 'D-015'],
  }),
};

/**
 * 精密交互中间状态（Requirement 9.1-9.3）。
 *
 * `props` 由发起动作在 `attach.add` 之后逐字段 `prop.set` 写入：`kind`、`targetRef`、
 * `beganAtPhase`。为什么不写在 `attach.add` 的 `props` 参数里：映射型参数的嵌套值不会被求值
 * （见 ids.ts 的 DEVIATION-04），静态字面量之外的内容必须用 `prop.set` 落地。
 *
 * `targetRef` 使"另一目标的完成动作复用同一中间状态"在前置条件层面不可能成立
 * （完成动作的 `require` 要求 `中间状态.props.targetRef === bindings.target`）。
 */
export const preciseInteractionAttachment: AttachmentDef = {
  id: ATT_PRECISE_INTERACTION,
  kind: 'attachment',
  stackStrategy: 'unique',
  onAdd: addTag(TAG_PRECISE_IN_PROGRESS),
  onRemove: delTag(TAG_PRECISE_IN_PROGRESS),
  play: playExt({
    sourceTrace: ['Req 9.1', 'Req 9.2', 'Req 9.3', 'S5 精密交互'],
  }),
};

/**
 * 多步移动的过渡中间状态（Requirement 9.6-9.7）。
 * 与精密交互分开是因为两者的中断规则与前置重检对象不同（空间/负重 vs 目标/工具）。
 */
export const transitAttachment: AttachmentDef = {
  id: ATT_TRANSIT,
  kind: 'attachment',
  stackStrategy: 'unique',
  onAdd: addTag(TAG_TRANSIT_IN_PROGRESS),
  onRemove: delTag(TAG_TRANSIT_IN_PROGRESS),
  play: playExt({
    sourceTrace: ['Req 9.6', 'Req 9.7', 'Req 4.3'],
  }),
};

/**
 * 强力骰承诺标记（Requirement 6.3-6.6）。
 *
 * 承诺本体是一个 `Intent`（提交与解算分离，冻结体力由 `freezeCost` 完成）；这个 Attachment 是
 * 承诺在投点阶段的**可读记录**，供"进入随机投点后不得撤销或变更"的守卫与结算阶段读取。
 * `props.staminaCost` 与 `props.tierModifier` 由承诺动作写入（1↔+1 / 2↔+2 两档，无第三档）。
 */
export const boostCommitmentAttachment: AttachmentDef = {
  id: ATT_BOOST_COMMITMENT,
  kind: 'attachment',
  stackStrategy: 'unique',
  play: playExt({
    sourceTrace: ['Req 6.3', 'Req 6.4', 'Req 6.5', 'D-007'],
  }),
};

/**
 * 永久退出（观战 / 退出，Requirement 11.6）。
 *
 * **单向不可逆**：`onAdd` 同时撤掉投点参与者标记，且**刻意不声明 `onRemove`**——
 * 若声明一个"恢复参战"的 `onRemove`，就等于给"自行恢复为参战状态"留了一条路径，
 * 而 Requirement 11.6 明确禁止。装载期校验也禁止任何效果对该状态调用 `attach.del`。
 */
export const permanentExitAttachment: AttachmentDef = {
  id: ATT_PERMANENT_EXIT,
  kind: 'attachment',
  stackStrategy: 'unique',
  onAdd: [
    ...tagEffects('add', 'entities', PATH_SCRATCH_REF, refId(TARGET), TAG_PERMANENT_EXIT),
    ...tagEffects('del', 'entities', PATH_SCRATCH_REF, refId(TARGET), TAG_ROLL_PARTICIPANT),
  ],
  play: playExt({
    sourceTrace: ['Req 11.6', 'Req 11.4'],
  }),
};

/**
 * 睡下中间状态（Requirement 6.11、15.4）。
 *
 * 合法睡眠流程是"睡下（1 AP）→ 起床（1 AP）"两个付费动作，**只有起床动作完成时**才恢复体力至 5。
 * 仅完成睡下不产生任何恢复；也不叠加 S8 已被置换的"睡眠每回合恢复 1"。
 */
export const sleepingAttachment: AttachmentDef = {
  id: ATT_SLEEPING,
  kind: 'attachment',
  stackStrategy: 'unique',
  onAdd: addTag(TAG_SLEEPING),
  onRemove: delTag(TAG_SLEEPING),
  play: playExt({
    sourceTrace: ['Req 6.11', 'Req 15.4', 'S5 体力恢复途径'],
  }),
};

/**
 * 过载（D-055 / Requirement 6.16-6.22）。CEME C-7 把权威从 legacy action-turn 收束到本包。
 * 条件持续：由过载规则显式移除，清理自然恢复不得触发本状态。
 */
export const overloadedAttachment: AttachmentDef = {
  id: ATT_OVERLOADED,
  kind: 'attachment',
  stackStrategy: 'unique',
  // 过载期间退出投点参与者谓词，避免结算再把过载者写进 playerQueue；归队时恢复资格。
  onAdd: [...addTag(TAG_OVERLOADED), ...delTag(TAG_ROLL_PARTICIPANT)],
  onRemove: [...delTag(TAG_OVERLOADED), ...addTag(TAG_ROLL_PARTICIPANT)],
  play: playExt({
    sourceTrace: ['Req 6.16', 'Req 6.18', 'Req 6.20', 'Req 28.1', 'D-055', 'S3 C-7'],
  }),
};

/** 本模块声明的全部 `AttachmentDef`，按 Id 稳定排序（装载顺序不影响结果，但顺序稳定便于比对）。 */
export const CORE_ATTACHMENT_DEFS: readonly AttachmentDef[] = [
  blockingAttachment,
  boostCommitmentAttachment,
  concealedAttachment,
  downedZeroAttachment,
  knockedDownAttachment,
  overloadedAttachment,
  permanentExitAttachment,
  preciseInteractionAttachment,
  sleepingAttachment,
  transitAttachment,
].sort((left, right) => left.id.localeCompare(right.id, 'en'));

/**
 * 本 Spec 禁止玩法层使用的引擎层叠加策略（design.md 3.12 的裁决）。
 * 玩法层的"刷新"语义映射到 `'unique'`，剩余时间在 `play.status.apply` 的 `modify` 阶段取较长者。
 */
export const FORBIDDEN_STACK_STRATEGY = 'refresh' as const;
