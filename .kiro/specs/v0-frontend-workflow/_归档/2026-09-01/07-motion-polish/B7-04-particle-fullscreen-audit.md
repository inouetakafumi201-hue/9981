# B7-04 粒子与全屏演出排查补全（Audit & Complete）

## 1 页面定位

这是 B7 的彩色粒子与全屏演出专项排查补全 brief。它对照 `03_动画灵感索.md` 的粒子穷举与 D-026/D-032 全屏定案，逐项排查现有前端的粒子效果与全屏演出实现，并把所有非完整项补齐到位。已知现状：粒子只做了极少量且几乎全是淡白色，语义色粒子（红血、橙火、蓝光、金硬币、珊瑚招架光）几乎为零；全屏演出要么缺失要么退化成普通淡入淡出，没有「一张高冲击画面闪过」的张力。本命令使命有两段，缺一不可：

1. **排查**：对照 §9 视觉令牌（彩色粒子全集）与 §10 动效绑定（全屏演出全集），逐项检查现有前端，输出「已实现 ✅ / 降级实现 🟡 / 错误实现 🔴 / 完全缺失 ⬛」四态清单。
2. **补全**：对所有非 ✅ 条目按本文件规格完整补全——不是修补，是整规格实现。排查完成后立即补全，不需要等待确认。

本命令可独立执行，无需 Batch 0、前序批次或对话记忆。执行 AI 必须先检查现有前端项目的全部实现，把现状当事实：优先复用与修改既有挂载边界；缺失挂载点时在既有架构内做最小补齐。不创建隔离 demo、第二壳层或平行状态树。配方只消费已确认 `resultSnapshot`/projection，动画失败、跳过、超时、资源缺失都收敛到同一 `settled` 结果。

## 2 权威来源

- `attachmentId: "presentation-animation-feedback-02"`
  `provenance: "docs/表现系统/02_动画音效与反馈.md；最小高价值粒子集、粒子不承载唯一结果、全屏四仪式 D-026/D-032、fallback 与性能策略"`
- `attachmentId: "presentation-motion-index-03"`
  `provenance: "docs/表现系统/03_动画灵感索.md；§四粒子穷举（伤害类型配色/命中点/环境弥漫/氛围）、§三全屏四项与世界级演出、§十·五终局结算"`
- `attachmentId: "presentation-motion-checklist-12"`
  `provenance: "docs/表现系统/12_动态图形化设计清单（V0迁移准备）.md；§2.8 全屏动画规格（时长/暗化/可跳过）、§2.9 结算"`
- `attachmentId: "presentation-completion-report-10"`
  `provenance: "docs/表现系统/10_动态图形化补全设计报告.md；终局梦醒/货币入账/金色蓝色双货币粒子"`
- `attachmentId: "global-motion-audio-fallback"`
  `provenance: "prompts/00-global/G-05-motion-audio-fallback.md；9 母题之外的粒子/全屏约束、skip 与 fallback 契约"`

## 3 当前决策

- **全屏演出的定义（本项目口径）**：一张富有视觉张力的主画面 + 闪过的动态过场效果。主画面是漫画式特写（高冲击构图），动态是短促的进入/离开变换（白闪、震动、缩放冲击、扫光、色差、斜切）。全页淡入淡出不叫全屏演出——普通过渡归 9 大母题，全屏只留给仪式。
- 全屏数量纪律：对局内仅 D-026/D-032 定案四项（翻窗/跳窗/令其长眠/招架）+ 世界级演出（出生/入梦/返回/入睡/影子大厅/过载）+ 终局结算（梦醒/胜/败/淘汰）。其余一律禁止全屏。
- **粒子色彩纪律**：语义色来自 `01_图形化与UI.md` 视觉定律 1，不得发明新色。禁止把一切粒子做成淡白——淡白只属于梦境边界家族；伤害红、枪口橙、长眠蓝、胜利金、招架珊瑚各自独立存在。
- 粒子不承载唯一结果信息：关键结果必须同时有文字/图标/音频等价。粒子是叠加调味，盖在曲线/帧/全屏之上。
- 招架静默失效（远程/不可招架命中）零动画零提示；不通过预加载/音效/震动泄露。
- 每个粒子与全屏演出在三档 Profile（standard / reduced-motion / low）都有确定策略。
- `+3` 保持 deferred 不可选；selection/trigger effects 保留。

## 4 状态机

```text
not-audited
  -> audit-running
  -> audit-recorded          （四态清单已输出）
  -> completing              （按清单逐项补全）
  -> completed | partial-with-handoff
  -> acceptance-verified
```

- `audit-running` 只读检查现状，不改代码；每条目必须落到四态之一，不允许「大概有」。
- `audit-recorded` 后立即进入 `completing`，不等待人工确认。
- `completing` 中每补全一条目即回填「补全后状态」，与排查行形成前后对照。
- 无法在本批补全的（如需外部素材生产）标 `partial-with-handoff`，写清交接项与临时 fallback，不得静默留缺。
- 全屏播放自身沿用 B7-01 状态机：`idle → triggered → playing → completed | skipped | failed → settled`；skip/失败/超时/素材缺失都渲染同一 `resultSnapshot`。

## 5 组件树

```text
ParticleAndCeremonialAuditRoot
├─ AuditChecklistPanel            （四态排查清单 UI，开发演示用）
├─ ParticleRecipeLayer
│  ├─ DamageParticleSet           （9 种伤害类型粒子，按 semanticType 分发）
│  ├─ CombatParticleSet           （枪口/扇形/爆炸/冲击波/招架光）
│  ├─ StatusParticleSet           （buff/debuff/解除/清醒回填/货币）
│  ├─ EnvironmentParticleSet      （落地尘/拖痕/碎玻璃/弥散/出生尘/影子）
│  └─ ParticlePool                （对象池，同屏 ≤50 实例，屏幕外暂停）
├─ CeremonialRecipeLayer
│  ├─ CombatCeremonySet           （FS-CLIMB / FS-JUMP / FS-SLEEP / FS-PARRY）
│  ├─ WorldCeremonySet            （FS-SPAWN / FS-ENTER / FS-RETURN / FS-SLEEPIN / FS-SHADOW / FS-OVERLOAD）
│  └─ ResultCeremonySet           （FS-RESULT / FS-WIN / FS-LOSE / FS-ELIMINATED）
├─ CeremonialTimelineDriver       （声明式关键帧 + blockingUntil skip）
├─ FallbackLayer                  （四级 fallback）
└─ PresentationLiveRegion         （skip/playing/settled 播报）
```

每层可独立缺失；补全时在既有架构内挂载，不建第二套全局层。

## 6 只读数据

```ts
interface ParticleCeremonialProjection {
  readonly eventId: string;
  readonly semanticId: string;          // 如 damage:fire / ceremony:climb-window
  readonly trigger: 'state-transition' | 'click-play';
  readonly visibility: 'public' | 'local' | 'related-only';
  readonly resultSnapshot: Readonly<Record<string, unknown>>;
  readonly revision: string;
  readonly source: 'mock' | 'projection';
  readonly assetRefs: readonly string[];  // 全屏主画面张力图引用
  readonly audioRefs: readonly string[];
  readonly hapticRefs: readonly string[];
  readonly reducedMotion: boolean;
  readonly performanceProfile: 'standard' | 'reduced-motion' | 'low';
  readonly skipAllowed: boolean;
}
```

粒子与全屏配方不读取规则内部对象、伤害数值计算、AI 决策或隐藏字段；伤害类型、命中点、目标位置来自权威事件的语义字段。素材缺失时进入明确 fallback，不阻塞。

## 7 动作意图

```ts
interface ParticleCeremonialIntent {
  readonly kind:
    | 'presentation.play-demo'     // 控制面板演示某个粒子/全屏配方
    | 'presentation.skip';         // 全屏演出跳过，仅收敛播放
  readonly eventId: string;
  readonly requestId: string;
}
```

- 演示入口允许逐条触发 §9/§10 的每个配方（这是排查验收的手段）。
- Skip 只发送 `presentation.skip`，不发送任何规则 intent；跳过直接渲染最终 projection。
- 结果类全屏（处决/结算）只在 `accepted` 或新 revision 后播放；`click-play` 不播放未确认成功。

## 8 本地 UI 状态

允许保存：排查清单四态标记、补全回填状态、`animationPhase`、`activeRecipeId`、`fallbackRecipeId`、粒子池引用、`assetLoadState`、`audioLoadState`、`skipRequested`、Profile 与焦点。

不得保存或推断：规则结果、伤害数值、回合推进、资源扣除、目标判定或任何从粒子效果反推的规则事实。`settled` 始终以 projection 为准。

## 9 视觉令牌（彩色粒子全集）

> 语义色不可覆盖：红=伤害、蓝=清醒/处决、金=贵重、珊瑚=近战。同屏粒子 ≤50 实例；快速重复事件合并/限频；屏幕外不更新；短时 burst 后回收。

### 9.1 伤害类型粒子（命中点短促爆发，按 semanticType 分发）

| ID | 粒子 | hex | 形状 | 数量 | 寿命 | 运动 |
|---|---|---|---|---|---|---|
| P-BLOOD | 血液飞溅 | `#E23B3B` | 圆点 3-5px | 6-10 | 200-400ms | 放射溅出+重力下坠 |
| P-FIRE | 火焰 | `#FF6B35` | 圆点渐小 | 8-12 | 300-500ms | 向上飘散 |
| P-ICE | 冰霜碎晶 | `#BFE3F2` | 菱形碎片 | 6-8 | 300-500ms | 放射+下坠 |
| P-POISON | 毒雾 | `#4CAF50` | 雾团（模糊圆） | 3-5 | 800-1200ms | 缓慢扩散消散 |
| P-ELECTRIC | 电光 | `#FFEE32` | 线段/星形 | 4-6 | 100-200ms | 折线跳闪 |
| P-RADIATION | 辐射绿眩 | `#7FA653` | 圆点 | 5-8 | 400-600ms | 无序漂移 |
| P-DECAY | 凋零灰粒 | `#8A8A8A` | 小圆点 | 6-8 | 400-600ms | 缓慢下沉 |
| P-CORRODE | 侵蚀白粒 | `#F0F0F0` | 小圆点 | 6-8 | 300-500ms | 放射 |
| P-MENTAL | 精神波纹 | `#8A2BE2` | 扩散圆环 | 2-3 环 | 500-800ms | 由内向外扩散 |

### 9.2 战斗通用粒子

| ID | 粒子 | hex | 规格 | 触发 |
|---|---|---|---|---|
| P-MUZZLE | 枪口火焰 | `#FFA500` | 一帧火苗 10px+少量烟，80-120ms | 每次射击 |
| P-MUZZLE-HEAVY | 步枪连焰 | `#FFB833` | 连续火焰+烟轨迹 | 连发/扫射每发 |
| P-SCATTER | 散弹扇形 | `#FFA500`→`#FFD08A` | 60° 扇形 12-16 粒 | 霰弹枪 |
| P-EXPLODE | 爆炸火球 | `#FFA500`→`#FF4500`→`#8B0000` | 火球 30-50+碎片 10-15+冲击波 1-2 环，1200-1500ms | 殉爆/爆炸物 |
| P-SHOCKWAVE | 冲击波圈 | `#FFFFFF` | 扩张圆环描边 2-3px | 爆炸/重击 |
| P-PARRY-GLOW | 招架微光 | `#FF7F50` | 挡下瞬间一道短光 | 招架触发 |

### 9.3 状态与资源粒子

| ID | 粒子 | hex | 规格 | 触发 |
|---|---|---|---|---|
| P-BUFF | 正面附加 | `#3ECC6E` | 柔和光点 4-6 缓升 | 正面状态 |
| P-DEBUFF | 负面附加 | `#E23B3B`/`#8A2BE2` | 压抑下沉粒 | 负面状态 |
| P-OVERLOAD | 过载白爆 | `#FFFFFF` | 爆闪粒+全屏白幕配合 | 体力爆条 |
| P-CURE-ICE | 冰解碎晶 | `#BFE3F2` | 碎晶散落（仅相关者可见） | 火解冰 |
| P-CURE-SMOKE | 火灭烟 | `#BBBBBB` | 一缕烟上升（仅相关者可见） | 灭火 |
| P-CURE-POISON | 毒散绿雾 | `#8FD19E` | 雾团消散（仅相关者可见） | 毒解除 |
| P-STAMINA | 清醒回填 | `#4C9EE8` | 蓝光粒流向攻击者清醒条 | 令其长眠 |
| P-COIN | 美元佣金 | `#FFD700` | 硬币粒弹跳飞向货币栏 | 结算入账 |
| P-SHARD | 记忆碎片 | `#5B9BD5` | 晶片粒飞入 | 结算入账 |
| P-VICTORY | 胜利金雨 | `#FFD700` | 金粒上浮飘散 15-20 | 胜利结算板 |

### 9.4 环境与移动粒子

| ID | 粒子 | hex | 规格 | 触发 |
|---|---|---|---|---|
| P-DUST-LAND | 落地灰尘 | `#8B7355` | 3-5 粒（重物 8-10） | 落地压缩瞬间 |
| P-DUST-RUN | 奔跑扬尘 | `#8B7355` | 淡尘尾随 | 奔跑状态 |
| P-DRAG-TRAIL | 爬行拖痕 | `#9E9E9E` | 身后淡痕渐隐 | 爬行 |
| P-WHEEL-DUST | 轮下扬尘 | `#8B7355` | 8-12 粒 | 载具行驶 |
| P-BREAK-GLASS | 碎玻璃 | `#D6EDF5` | 不规则碎片 12-20，600ms | 翻窗/跳窗/破窗 |
| P-BREAK-METAL | 破盾碎屑 | `#C8C8C8` | 碎片 8-12 | 盾/防具破损 |
| P-DREAM-WHITE | 梦境弥散 | `#FFF8F0` | 低密度雾粒 | 梦境侵蚀/传送 |
| P-SPAWN-RING | 出生白尘 | `#F5F5F0` | 一圈淡尘 | 起床/褪色完成 |
| P-SHADOW | 影子轮廓 | `#AAAAAA` 半透明 | 淡粒子描边 | 影子大厅 |
| P-BLUE-PLUG | 长眠蓝光 | `#4C9EE8` | 导流光效扩散至 500px | 令其长眠全屏内 |

## 10 动效绑定（全屏演出全集）

> 每个全屏演出 = 主画面（张力图）+ 闪过动态（进/出）+ 语义色 + 粒子叠加 + 音/触 + 可跳过，六要素齐全；缺任一项记 🟡。主画面可为静态张力图+局部动效（扫光/呼吸/光流），不要求视频，但必须有可辨识的漫画式构图，不是色块渐变。全部 Space/Esc 可跳过；跳过/失败/超时/素材缺失直接渲染最终 projection。

### 10.1 对局四仪式（D-026/D-032 唯一定案）

| ID | 演出 | 时长 | 主画面 | 闪过动态 | 语义色 | 粒子 | 音/触 |
|---|---|---|---|---|---|---|---|
| FS-CLIMB | 翻窗 | 800ms | 角色正对窗台、单手撑框、半身已越的漫画特写；背景 backdrop-blur(4px)+brightness(0.6) | 进：白闪 80ms+主画面右侧斜切撞入（skewX -8°，spring 过冲）；出：向左加速甩出+碎玻璃爆开 | 灰白窗框+珊瑚动势线 | P-BREAK-GLASS | 玻璃碎音；中触觉 |
| FS-JUMP | 跳窗 | 600ms | 高处向下俯冲一格：俯视镜头、下坠姿态、地面逼近的速度线 | 进：下坠缩放（scale 1.3→1.0）；出：落地白闪 60ms+震屏 200ms | 白速度线+落点橙光 | P-DUST-LAND+P-SHOCKWAVE | 风声+闷响；重触觉 |
| FS-SLEEP | 令其长眠 | 500ms | 蓝色「导流/插头」仪式图：手掌抵住倒地目标、蓝光沿臂导出的高对比特写 | 进：纯黑 100ms→蓝光中心炸开（径向 500px）；出：蓝光收束成点+清醒条绿光刷入 | 蓝 `#4C9EE8`+绿 `#3ECC6E` | P-BLUE-PLUG+P-STAMINA | 嗡鸣→清脆确认；轻触觉 |
| FS-PARRY | 招架触发 | 1000ms | 擒拿定格：武器被格挡瞬间剪影、双方力量对峙线 | 进：凝滞 150ms→珊瑚冲击闪 100ms+scale 1.0→1.15→1.0；出：紫约束边缘收拢退场 | 珊瑚 `#FF7F50`+紫 `#8A2BE2` | P-PARRY-GLOW | 金属交鸣；中触觉 |

招架静默：被远程/不可招架命中零动画零提示，不播放不预载。「令其长眠」默认可跳过；Profile 可标记本局不可跳。

### 10.2 世界级演出

| ID | 演出 | 时长 | 主画面 | 闪过动态 | 粒子 |
|---|---|---|---|---|---|
| FS-SPAWN | 出生/起床 | 1200ms | 床与人形整体纯白高调画面，轮廓清晰 | 慢白幕吞没→纯白停留 200ms→颜色从床向外滚动恢复→`get_up_mid` 起身跳下 | P-SPAWN-RING |
| FS-ENTER | 入梦 | 1000ms | 床锚点先可见→慢白幕将人形/床推入纯白→梦境显影 | 有方向的边缘吞没→纯白内载入→轮廓显影吐出对局入口 | P-DREAM-WHITE |
| FS-RETURN | 返回 | 800ms | 梦境收束成纯白，`returnOrigin` 落回驻地原位 | 纯白收束→沿 returnOrigin 复原人形/床→余辉淡出交还控制 | P-DREAM-WHITE |
| FS-SLEEPIN | 入睡就绪 | 800ms | 床侧安睡仪式图（锚定导流仪就绪后才播） | 慢白幕轻覆→融入睡眠态 | P-DREAM-WHITE 极低密度 |
| FS-SHADOW | 影子大厅 | 循环至匹配 | 驻地站桩+他方玩家半透明剪影（60%） | 剪影 ±2px 浮动（2s 周期）；就绪者变实（100%） | P-SHADOW |
| FS-OVERLOAD | 过载白爆 | 300ms | 纯白闪光弹式全幅过载 | 瞬白→余辉 200ms 退回；之后站立摇晃 | P-OVERLOAD |

### 10.3 终局结算

| ID | 演出 | 时长 | 主画面 | 闪过动态 | 粒子 |
|---|---|---|---|---|---|
| FS-RESULT | 梦醒结算 | 800-1200ms | 纯白涌出/聚拢→结果板（胜负平大字+排名+摘要） | 纯白梦醒语汇→结果板斜切滑入（skewX+spring(300,30)） | 无（克制） |
| FS-WIN | 胜利 | 板后 | 金色高光结果板 | 金粒上浮+边缘金光扫过 | P-VICTORY |
| FS-LOSE | 失败 | 600ms | 黑幕从四周收束 | 压黑→原因文字淡入 | 无 |
| FS-ELIMINATED | 淘汰转观战 | 500ms | 被淘汰者视角淡出推离梦境 | 淡出+镜头切观战；不做悲壮演出 | 轮次栏条目缩出淡出 |

### 10.4 排查输出格式（补全前必须先交）

对 §9、§10 每一条目输出：`| ID | 四态 | 现状（文件/组件/颜色/数量） | 缺口 | 补全方案 |`；补全后回填前后对照。

## 11 输入无障碍

- 每个全屏演出有可访问名称、Skip 按钮（aria-label+焦点环）与 live region；读屏器可播报 playing/skipped/failed/settled。
- Skip 同时支持 Space/Esc/手柄/触控等价；跳过后焦点回到触发点或结果区域。
- 颜色不是唯一信息：粒子/全屏的关键结果必须有文字/图标/形状/ARIA 辅助；灰度模式下仍可读出结果。
- reduced-motion：全屏直接呈现主画面+一次性亮度/颜色变化，取消震动/闪频/粒子；保留顺序、来源、结果文字。粒子全部取消时轮廓/透明度收束替代。
- 关键音效有字幕或可视等价；设备不支持触觉静默降级。

## 12 加载错误超时

- 全屏主画面素材缺失：四级 fallback——指定配方→同语义默认→通用程序化反馈（如 FS-CLIMB 缺图降级为窗框线稿+白闪）→图标/文字；显示 `asset.fallback` 可读原因，不得借用语义错误的其他全屏（如用黑幕代替梦醒）。
- 粒子配方缺失：跳过粒子层，结果由文字/图标承载，不报错不阻塞。
- 音频缺失只关闭该 cue；触觉不可用静默降级。
- 演出超时/runtime error 进入 `failed → settled`，清理 overlay/粒子/音频实例，渲染权威 resultSnapshot。
- 低性能档预算超限按显著性降级：装饰粒子→远景→非关键过渡；关键结果不删。同屏 ≤50 粒子实例；全屏期间无长帧，正常档 60fps。

## 13 明确不做

- 不把普通 hover、列表重排、通知、错误、按钮点击做成全屏；不用纯白/黑幕/粒子替代结果文本。
- 不发明语义色之外的新颜色；不把所有粒子做成淡白。
- 不让粒子承载唯一结果信息；不从粒子/时间轴/预加载泄露隐藏信息（招架静默、暗押不可见、克制解除仅相关者可见）。
- 不给载具爆炸上全屏（物理常态，用通用爆炸贴帧+破坏后残骸帧）；不复活残影/拖尾。
- 不新增页面、玩法、规则、路由或第二套状态树；不修改 B1-B6 契约文件；不把 `+3` 做成可选。

## 14 依赖交接

- B7-01 提供 9 母题 recipe id、状态机与 fallback 顺序；本 brief 在其上叠加粒子与全屏专项，不改其契约。
- B7-02 提供三档 Profile 策略；粒子/全屏的降级并入其预算闸门。
- 资产端口解析全屏主画面 `assetRef`（张力图）；缺失返回 fallback 标识，本层不生产素材、不改 manifest 所有权。
- 音频端口提供通道/mute/字幕；触觉端口提供能力检测。
- 宿主提供 `revision`、`resultSnapshot`、`visibility`、skip 能力与 Profile。
- 需外部素材生产的张力图若未就绪，登记 `partial-with-handoff`：先落程序化 fallback 版本，素材到位后替换 `assetRef`，不改配方 ID。

## 15 验收条件

- [ ] §9 全部 30+ 粒子条目四态排查完毕并输出清单；非 ✅ 项全部补全，颜色符合语义色表。
- [ ] §10 全部 16 项全屏演出四态排查完毕；补全后六要素（主画面/闪过动态/语义色/粒子/音触/可跳过）齐全。
- [ ] 对局四仪式真实可演示：漫画式张力主画面、进出场动态、Space/Esc 跳过、跳过后落到正确最终态。
- [ ] 彩色粒子抽查：血液红、枪口橙、长眠蓝、胜利金、招架珊瑚至少各一处真实触发点，颜色与令牌一致。
- [ ] 招架静默可验证：远程/不可招架命中零动画零提示。
- [ ] 素材/粒子缺失走四级 fallback；无 broken image、无空白死区、无语义错借。
- [ ] reduced-motion 与 low 档：粒子/全屏均有确定降级且保留结果、顺序、焦点、文字。
- [ ] 同屏 ≤50 粒子实例；全屏期间无长帧；正常档关键路径 60fps。
- [ ] console 无 error/warning；asset/audio/promise 错误均已处理。
- [ ] `npx tsc --noEmit`、相关 `npx vitest run`、`npm run lint` 通过。
