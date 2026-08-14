/**
 * 文档与实现之间的分歧登记表。
 *
 * 两类内容：
 *  1. `UNRESOLVED_INSTANCE_REFERENCES`——玩法层内部指向不存在实例的引用。这些引用无法在不新增
 *     玩法内容或不替玩家做取舍的前提下修复，因此保留原值并登记，而不是删除或猜一个目标。
 *  2. `DOC_DIVERGENCES`——`docs/L3_玩法层/01_行动轮与体力博弈系统.md` 与 `src/play` 实现之间
 *     的差异。未裁决的差异只记录，不单方面改文档结论、也不单方面改实现语义。
 *
 * 登记表的作用是让分歧**可被证伪**：契约测试会实际检测每条 `detectable` 条目的当前状态。
 * 若某条分歧被修好、或有人引入新分歧，测试失败并要求同步更新本表——而不是让分歧静默漂移。
 *
 * 条目有两种状态，断言方向相反：
 *  - **无 `resolution`**：分歧仍然成立，测试断言它**依然存在**。
 *  - **有 `resolution`**：已被权威裁决且实现已落地，测试断言它**确实不再成立**。
 *
 * 已裁决的条目留在表内而不是删除，且编号不回收。裁决本身是这张表最有价值的内容：删掉它，
 * 「d5 改成 d6 是 D-054 的裁决结果」这条线索就没了，日后有人把它改回去也不会有任何东西报警。
 */

/** 玩法层内部无法解析的实例引用。 */
export interface UnresolvedInstanceReference {
  /** profile 的 sourceId，如 `npcs/zombie_common.json`。 */
  readonly sourceId: string;
  /** 引用所在的 JSON 路径。 */
  readonly jsonPath: string;
  /** 引用的目标 id 原值，保持不变。 */
  readonly reference: string;
  readonly issue: string;
  /** 为什么不能就地修复。 */
  readonly blockedBy: string;
}

export const UNRESOLVED_INSTANCE_REFERENCES: readonly UnresolvedInstanceReference[] = [
  {
    sourceId: 'npcs/guard_elite.json',
    jsonPath: '/initialEquipment/0',
    reference: 'weapon_pistol',
    issue: '玩法层没有 id 为 weapon_pistol 的武器实例。',
    blockedBy:
      '存在两个候选实例（wp_pistol_standard 制式手枪、wp_pistol_quickdraw 快拔手枪），'
      + '选择哪一个属于精英守卫的配装取舍，不能由审计代为裁决。',
  },
  {
    sourceId: 'npcs/zombie_common.json',
    jsonPath: '/initialEquipment/0',
    reference: 'weapon_claws',
    issue: '玩法层没有 id 为 weapon_claws 的武器实例，且没有任何近似候选。',
    blockedBy:
      '修复需要新增一个"爪击"武器实例并为其设定伤害、体积等玩法数值，'
      + '属于新增玩法内容而非引用修正。',
  },
  {
    sourceId: 'npcs/zombie_rusher.json',
    jsonPath: '/initialEquipment/0',
    reference: 'weapon_claws',
    issue: '玩法层没有 id 为 weapon_claws 的武器实例，且没有任何近似候选。',
    blockedBy:
      '修复需要新增一个"爪击"武器实例并为其设定伤害、体积等玩法数值，'
      + '属于新增玩法内容而非引用修正。',
  },
];

/**
 * 基类层要求必须组合、而玩法层尚未声明的能力。
 *
 * 曾经的形态：基类层武器目录重写后为 `weapon-class.*` 新增了 `requiredCapabilityIds`
 * （攻击谱型组合、伤害引用、目标上限、操作手感，枪械另加弹药绑定），而 11 份武器 profile 都还没有
 * `classComposition.capabilityIds`，全部缺这批能力。
 *
 * 现状：**已全部补齐**。11 份 profile 都声明了所选武器类的 requiredCapabilityIds，并在
 * `weaponParameters` 里按能力 id 分组绑定了参数（`field-name` 形态只写字段名，不复制取值）。
 * 保留这个接口与空数组、而不是整段删掉，是为了让"缺失集合恰好等于登记集合"这条等值断言继续生效：
 * 将来基类层再新增必需能力时，检测结果会立刻与空登记表不符而失败，从而强制同步。
 */
export interface UnresolvedCapabilityGap {
  readonly sourceId: string;
  readonly classId: string;
  readonly missingCapabilityIds: readonly string[];
  readonly blockedBy: string;
}

export const UNRESOLVED_CAPABILITY_GAPS: readonly UnresolvedCapabilityGap[] = [];

/**
 * 基类层要求必填、但取值需要玩法裁决才能给出的参数绑定。
 *
 * **2026-08-08 权威变更（本次会话裁决，已获项目所有者授权）**：原登记的两条（霰弹枪、机枪的
 * `target_limit.maxTargetsField` 缺数值）已随"攻击形状/形状轴"设计一并废除而消解——散射与扫射
 * 现在是独立的武器属性（`scatter_attribute`/`sweep_attribute`），二者**不组合**
 * `weapon.capability.target_limit`：命中范围内全部目标，不设固定人数上限，命中数由拓扑与场景
 * 占用情况天然决定（受宪法五并列原则的连接数 ≤5 约束）。因此不再需要一个"缺失的数值"，
 * 问题本身不成立。保留本接口与空数组，是为了让"检测到的缺失恰好等于登记集合"这条等值断言
 * 继续生效：若将来又有必填参数缺值，会立刻与空登记表不符而失败。
 * 详见 `docs/L0_规范宪法.md`、`docs/L2_基类层/基类层定义.md` §4.3 最新权威内容。
 */
export interface UnresolvedParameterBinding {
  readonly sourceId: string;
  readonly capabilityId: string;
  readonly parameterKey: string;
  readonly issue: string;
  readonly blockedBy: string;
}

/** 载具能力参数绑定的结构性未决项（VEHICLE-COMPOSITE-FIELD-BACKING）。 */
export const VEHICLE_PARAMETER_BINDING_GAP: UnresolvedParameterBinding = {
  sourceId: 'vehicles/*（5 份载具 profile）',
  capabilityId: 'vehicle.capability.*（drive/destruction_sequence 等全部载具能力）',
  parameterKey: 'speed/moveApCost/occupantDisposition/cargoDisposition 等 field-name 槽',
  issue:
    '基类层 `src/class/vehicles/index.json` 为各载具能力声明的 `parameters[]` 是「字段名」槽'
    + '（drive → speed/moveApCost、destruction_sequence → occupantDisposition/cargoDisposition 等），'
    + '但这些字段名指向的是 profile 上**不存在的顶层键**：实际数据以嵌套块 `cargo`/`moveEffect` 承接，'
    + '且多个能力要求的 occupantDisposition（载具损毁时乘员去向）、cargoDisposition（货舱去向）在'
    + '玩法层根本没有对应顶层槽。若硬补齐绑定要么改基类层参数声明（carries 语义），要么在玩法层'
    + '新增冗余顶层字段——二者都越出本线（玩法层数据契约线）的白名单/职责。',
  blockedBy:
    '需由 L2 基类层线裁决载具能力的参数承载面（是把 speed/moveApCost 等改判给 playLayerOwnedFieldNames、'
    + '还是把 occupantDisposition/cargoDisposition 移出必填），裁决后才能按契约补齐绑定或登记消解。'
    + '裁决落地前，载具不参与能力参数绑定校验，其玩法参数改由 `auditVehicleParameterBacking` 覆盖：'
    + '见 `audit.ts` PARAMETER_BINDING_FIELD[vehicles] 空值注释与 VEHICLE_META_FIELDS。',
};

export const UNRESOLVED_PARAMETER_BINDINGS: readonly UnresolvedParameterBinding[] = [
  VEHICLE_PARAMETER_BINDING_GAP,
];

/** 文档与实现之间仍未消解的差异。 */
export interface DocDivergence {
  readonly code: string;
  /** `docs/L3_玩法层/01_行动轮与体力博弈系统.md` 内的条目位置。 */
  readonly docSection: string;
  /** 文档怎么写的。 */
  readonly documented: string;
  /** 实现怎么做的。 */
  readonly implemented: string;
  /** 实现所在位置。 */
  readonly location: string;
  /**
   * 是否可被机械检测。可检测的分歧由契约测试实际验证其当前状态；
   * 不可检测的分歧只作为审计记录，不参与断言。
   */
  readonly detectable: boolean;
  readonly note: string;
  /**
   * 裁决记录。存在即表示该分歧已消解，`documented`/`implemented` 描述的是**消解前**的状态。
   *
   * 缺省表示仍未裁决。这个字段是可选的而不是布尔标记：消解一条分歧必须交出裁决编号与依据，
   * 否则「已解决」和「有人悄悄改掉了」在表里长得一模一样。
   */
  readonly resolution?: DivergenceResolution;
}

/** 一条分歧的消解依据。 */
export interface DivergenceResolution {
  /** 裁决编号，如 `D-054`、`U-002`。 */
  readonly decisionId: string;
  /** 裁决结论，以及实现现在的实际行为。 */
  readonly outcome: string;
  /** 裁决记录在哪里可以查到。 */
  readonly recordedAt: string;
}

export const DOC_DIVERGENCES: readonly DocDivergence[] = [
  {
    code: 'L3-DIV-01',
    docSection: '§3.4 过载机制 / §9.3 过载玩家的处理',
    documented: '过载后「下下回合重新加入投点」，即跳过一次投点，第二次投点时归队。',
    implemented:
      'statuses/status_overloaded.json 的解除条件写 3 回合；'
      + 'action-turn/playpack.json 的 attachment:overloaded 用 remainingRolls=2 每次投点递减。',
    location: 'src/play/profiles/statuses/status_overloaded.json、src/play/action-turn/playpack.json',
    detectable: true,
    note: '同一机制在玩法层内部有两个不同数值（3 与 2），且都无法直接对应文档的自然语言描述。'
      + '2026-08-13 已裁决：过载语义定为「跳过一次投点、下下回合归队」，status_overloaded 改用 rollsSkipped=1，'
      + 'playpack 的 remainingRolls=2 投点递减表达同一天数，两侧已对齐。',
  },
  {
    code: 'L3-DIV-02',
    docSection: '§3.4 与 §9.3',
    documented:
      '§3.4 写「失去本回合行动权（如果还未行动）」；§9.3 同时写「本回合行动权保留（如果还未行动）」'
      + '与「如果过载时还未行动：跳过本回合」。',
    implemented: '玩法包按「未行动者跳过本回合」实现，并把「保留」解释为保留观察与被交互身份。',
    location: 'src/play/action-turn/playpack.json rule:overload-on-pool-overflow',
    detectable: false,
    note: '文档自身相互矛盾。玩法包的采用理由已记录在 src/play/action-turn/决策与风险记录.md 第二章，但文档本身未修订。',
  },
  {
    code: 'L3-DIV-03',
    docSection: '§9.1 投点阶段',
    documented: '「所有玩家同时投 d6」。',
    implemented: '玩法包曾使用 d5（sides=5），因为宪法四·4.2 限制玩家可见数值为 1-5。',
    location: 'src/play/action-turn/playpack.json phase:initiative-roll',
    detectable: true,
    note:
      '原始分歧是「文档 d6」与「宪法 1-5」的正面冲突，玩法层单方面无权取舍，因此当时压到 d5 并登记。'
      + '裁决把骰点重新归类为内部量，冲突随之消失——不是把宪法放宽，也不是把文档改掉。',
    resolution: {
      decisionId: 'D-054',
      outcome:
        '投点固定 1d6，与文档一致。原始骰点被判定为 Internal_Metric（仅作为 allocateAp 的输入，'
        + '不作为玩家可见数值持久展示），玩家可见产出是 AP 与行动顺序，均落在 1-5 内，故不触及宪法四·4.2。',
      recordedAt: 'src/play/action-turn/playpack.json props.resolutionPolicy.initiativeDie',
    },
  },
];

export const DOC_DIVERGENCES_CONTINUED: readonly DocDivergence[] = [
  {
    code: 'L3-DIV-04',
    docSection: '§2.2 按人数裁剪档位（D-037）',
    documented:
      '投点 AP 分配存在 0~3 AP 档位；场上仅 2 人或 1 人时取消 3 AP 档，单人自然落到 2 AP。'
      + '文档明确写出「实现要求：AP 结算需读取当前存活参与人数作为档位上限参数」。',
    implemented:
      '玩法包的投点阶段曾直接把骰点（含强力骰加成）钳制到 1-5 作为 AP，'
      + '既没有 0~3 档位模型，也没有读取存活参与人数。',
    location: 'src/play/action-turn/playpack.json phase:initiative-roll',
    detectable: true,
    note:
      '原始分歧是 D-037 整条未实现，补齐需要先定下「唯一领先且优势 ≥2 得 3 AP」的完整判定算法。'
      + '算法由 wakeup-core-mechanics Requirement 5 给出后才落地。'
      + '单人档位经 U-002 由项目所有者于 2026-08-13 显式消解：维持 D-037，单人按差值分配算法自然得 2 AP，'
      + '既非特例分支也非 abort 阻塞。01 文档对该陈述的旧解释被取代；若将来结论再变，回到本条更新而非另开新编号。',
    resolution: {
      decisionId: 'D-037 / U-002',
      outcome:
        '档位模型已落地：apParticipantCount 读取投点队列人数，apTier/apMaxTier/apLead 按最高点差距分配 AP——'
        + '2 人局最高者 2AP、差 1 得 1AP、差 ≥2 未分配且不产生 3AP；3+ 人局唯一最高且领先 ≥2 得 3AP、'
        + '并列最高或领先不足 2 得 2AP、差 1 得 1AP、差 ≥2 未分配。'
        + '单人局按 U-002（D-037 维持）自然落 2 AP 档；abort 写法已废止，不再注入结构化拒绝或默认推断。',
      recordedAt:
        'src/play/action-turn/playpack.json props.resolutionPolicy.apAllocation 与 .singleParticipant',
    },
  },
  {
    code: 'L3-DIV-05',
    docSection: '§2.3 逆转 / §3.5 体力流博弈示例 / §十一 术语对照',
    documented: '旧：规则正文与术语表写常规逆转成本 1 AP；§3.5 示例写「逆转消耗 2AP」。',
    implemented:
      '玩法包 `action:reverse` 已改为消耗 SP 1（常规逆转不用 AP），`action:super-reverse` 仍为 SP 2。',
    location: 'src/play/action-turn/playpack.json action:reverse',
    detectable: true,
    note:
      '2026-08-13 项目所有者裁决：逆转消耗的是 SP（清醒值）而非 AP，代价来源错写。'
      + '常规逆转 SP 1、超逆转 SP 2；二者与强力骰互斥（同一 windowChoice 槽位）。',
  },
  {
    code: 'L3-DIV-06',
    docSection: '§5.4 弱点攻击与举盾 / §6.2 失衡效果',
    documented: '[失衡] 破除举盾、防御、招架等准备动作状态，且这是盾牌被破解的唯一路径。',
    implemented:
      'statuses/status_blocking.json 的 breakConditions 与 interactionMatrix 已补 status_staggered 条目，'
      + '格挡状态在 profile 层面会被失衡破除。',
    location: 'src/play/profiles/statuses/status_blocking.json',
    detectable: true,
    note:
      '玩法包侧的失衡本来就能破除以 AttachmentDef 表达的准备态（rule:staggered-block-preparation 阻止失衡者举盾），'
      + '格挡 profile 此前缺这条解除条件。经审计确认文档 §5.4/§6.2 明确"失衡会破除举盾"且为盾牌被破解的唯一路径，'
      + '遂补上 breakConditions 与 interactionMatrix 条目标记——这与已在 status_aiming.json 落地的口径一致，'
      + '不引入新裁决。',
  },
  {
    code: 'L3-DIV-07',
    docSection: '§5.1 招架动作',
    documented: '「必须在最后一个 AP 使用（可选限制）」。',
    implemented: '未实现该限制；action:parry 没有对应 require。',
    location: 'src/play/action-turn/playpack.json action:parry',
    detectable: true,
    note: '文档自身标注为「可选限制」，因此未实现不构成违规，但需要明确该限制是否启用。',
  },
  {
    code: 'L3-DIV-08',
    docSection: '§4.4.2 弱点效果',
    documented: '效果表只列装备脱落、体力 +1、行动轮 -1 三项，未列失衡；§5.4 与 §6.4 把失衡列为弱点必然结果。',
    implemented: '玩法包按「弱点命中必然施加失衡」实现。',
    location: 'src/play/action-turn/playpack.json rule:weakness-hit',
    detectable: true,
    note: '文档内部冲突；采用理由已记录在决策与风险记录，文档本身未修订。',
  },
];

export const DOC_DIVERGENCES_PROFILE_LOCAL: readonly DocDivergence[] = [
  {
    code: 'L3-DIV-09',
    docSection: '§3.2 体力消耗途径（医疗包成本在 02/04 两处冲突）',
    documented: '医疗包使用成本在来源文档中同时出现 0 AP 与 1 AP 两种写法。',
    implemented: 'items/item_medkit.json 采用 1 AP。',
    location: 'src/play/profiles/items/item_medkit.json',
    detectable: true,
    note:
      'src/play/action-turn/决策与风险记录.md §5.3 声明该冲突记录在本 profile 的 unresolvedIssues；'
      + '本次审计补上了缺失的记录条目，取值本身仍未裁决。',
  },
  {
    code: 'L3-DIV-10',
    docSection: '（迁移前基类目录说明）守卫五状态范式',
    documented: '守卫被描述为「五状态守卫范式」。',
    implemented: 'guard_standard 与 guard_elite 的 FSM 实际只有 patrolling、listening、chasing、attacking 四个状态。',
    location: 'src/play/profiles/npcs/guard_standard.json、src/play/profiles/npcs/guard_elite.json',
    detectable: true,
    note: '两个 profile 的 unresolvedIssues 已登记 NPC-GUARD-STATE-NAMING，保持四状态不擅自补齐。',
  },
  {
    code: 'L3-DIV-11',
    docSection: '（profile 自述与自身配置不一致）',
    documented: 'statuses/status_slowed.json 旧 description 写「所有动作消耗 +1 AP」，effects 却只配置 move/attack 两类。',
    implemented:
      '已按 AP 铁律重写：迟缓表达为「离开任何天然场景需一次中间状态」（transition），'
      + '去除 apModifier/actionModifiers 加价字段；description 改为「需要中间状态」。',
    location: 'src/play/profiles/statuses/status_slowed.json',
    detectable: true,
    note:
      '原「所有动作 vs 两类动作」的分歧已在宪法·单动作原则（projects 2026-08-13）下消解：'
      + '迟缓本就不该以加 AP 表达，改为过渡态是唯一正确形态，描述与实现随之一致。',
  },
];

/** 全部已登记文档分歧，按编号稳定排序。 */
export function allDocDivergences(): readonly DocDivergence[] {
  return [...DOC_DIVERGENCES, ...DOC_DIVERGENCES_CONTINUED, ...DOC_DIVERGENCES_PROFILE_LOCAL]
    .sort((left, right) => left.code.localeCompare(right.code, 'en'));
}
