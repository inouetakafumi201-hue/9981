# B7 Motion Polish Prompt Pack
<!-- prompt-pack: command-entry batch=B7 execution=independent-command -->

## 0. Independent Execution Contract

This command is independently executable together with every numbered brief in this directory. Batch 0, earlier batches, and prior conversation context are not prerequisites. The AI must inspect the entire existing frontend project and treat it as the current implementation fact: reuse and modify existing code and mount boundaries first; when a required mount point is missing, add only the smallest compatible piece within the existing architecture. Do not create an isolated demo, second shell, route center, state authority, or parallel world scene.

Do not duplicate, regress, or break existing functionality. Modify only the current B7 responsibility range and do not wait for a prerequisite batch. Global hard-constraint summary: UI-only; read-only `mock`/projection data; explicit intents only; materials are allowed and existing `assetRef`/manifest slots must remain, with no zero-materials criterion; the internal UI of `editor`, `research-bench`, `material-library`, and `computer` is out of scope; show no more than five simultaneous items; `+3` is deferred and non-selectable, while its selection/trigger effects and later handoff slot remain.

## 1. Project Positioning

WakeUp 的前端是声明式 React + TypeScript UI 壳层：它呈现标题、驻地、入梦/返回、对局 HUD、叙事覆盖层、暂停、通知、错误恢复、结算和控制面板。B7 是全旅程的动效、声音、reduced motion、性能与视觉验收收束包，不新增页面，不拥有规则状态。

本批次只消费宿主提供的只读投影和已确认结果。动画、声音、震动、粒子、遮罩和列表布局只能重演结果，不推进回合、不提交规则、不计算伤害/目标/成本、不写存档。动画失败、跳过、超时或资源缺失都必须落到与正常播放相同的结果状态。

## 2. Scope List

In scope：

- 将全旅程统一接入 9 个动效母题：慢白幕、闪白幕、黑幕收束、余辉淡出、轮廓显影、语义高亮、震动回弹、列表重排、颗粒化消失。
- 明确 `state-transition` 与 `click-play` 两个播放入口，并可在控制面板分别演示。
- 覆盖纯白 `enter-dream` / `return-home`、加载、错误、超时、资源缺失 fallback、可跳过仪式、声音通道和触觉降级。
- 为标准档、reduced-motion 档和低性能档建立确定性表现策略，目标为正常档 60fps。
- 完成视觉连续性、空间来源/路径/落点、console 错误、资产错误和关键结果可读性验收。
- 保留 `+3` deferred 特效：`+3` 不进入可选交互，但 selection/trigger effects 仍存在，作为后续接线保留位。

Out of scope：

- 新增页面、玩法、规则、路由、数据写入或第二套全局状态树。
- 地图节点、拓扑、ORCA、寻路、路径成本、AI 决策、伤害、AP/HP/SP、目标判定和结算计算。
- `editor`、`research-bench`、`material-library`、`computer` 内部页面。
- 把动画、音频、粒子、震动或预加载当成隐藏信息通道。

## 3. Reference Materials

- `G-01-project-and-scope-contract.md`：全局项目边界、只读投影与 intent 纪律。
- `G-02-visual-token-contract.md`：像素前景 + 全息背景、空间层级、语义色与视觉状态。
- `G-03-ui-port-contract.md`：`StatePort`、`ActionPort`、`CadencePort` 与结果态。
- `G-04-interaction-accessibility.md`：五态控件、输入等价、焦点和 reduced-motion 要求。
- `G-05-motion-audio-fallback.md`：表现状态机、9 个母题、声音/粒子/fallback 与性能契约。
- `docs/表现系统/02_动画音效与反馈.md`：规则与表现解耦、声音通道、资源降级、性能策略和验收不变量。
- `docs/表现系统/03_动画灵感索.md`：全局过渡母题、纯白显形、粒子分工与复用配方。
- `docs/表现系统/12_动态图形化设计清单（V0迁移准备）.md`：全流程动效清单、纯白往返、错误状态与 reduced motion。
- B1–B6 当前 Prompt Pack：页面、状态、路由、覆盖层层级和已有动作意图的实际落点。

## 4. Technical Constraints

- 使用项目已登记的 Framer Motion（`AnimatePresence`、`layout`/`layoutId`、variants、`useSpring`、`useAnimate`、`motionValue`）组织空间连续性；Radix 负责可访问覆盖层，Zustand 只保存允许的本地 UI 状态，Howler 通过音频端口消费声音。
- 动效不是 hover 装饰库。每次演出必须说明对象、来源、路径、方向、落点和结果；环境层先稳定，实体层再出现，事件层最后响应，HUD 只在关联对象附近变化。
- 9 个母题只换语义色、方向和强弱，不重造骨架。禁止所有页面同时淡入、所有卡片统一弹跳、永久呼吸、线性 opacity 堆叠、普通 UI 整屏遮死世界。
- 变换优先使用 `transform`/`opacity`，粒子只在短时爆发/充能/消失位触发并池化；屏幕外粒子暂停；不常驻装饰粒子。正常档以 60fps 为验收目标。
- 纯白显形是低频仪式：`enter-dream` 与 `return-home` 使用统一纯白语汇但方向、层次和落点不同；床等固定实体不得在动画中消失。失败/跳过直接收敛到结果。
- 声音分为 UI、对局动作、环境、语音、音乐和触觉通道；每个结果音效必须来自语义描述符和只读事件。关键音效必须有字幕或可视等价提示，缺少声音不能阻塞 UI。
- `prefers-reduced-motion` 或用户设置开启时，保留顺序、来源、目标、状态文字、焦点和结果，移除非必要位移、闪烁、拖尾、粒子和震动；不可退化成所有内容同时淡入。
- 低性能档关闭装饰粒子、屏幕震动、余辉拖尾、非关键过渡和远景刷新，保留关键结果的文字、图标、语义色和焦点反馈。若预算超限按显著性降级，不阻塞投影消费。
- 允许 `assetRef`/`audioRef` 缺失。fallback 顺序固定为：指定配方 → 同语义类别默认配方 → 通用程序化反馈 → 图标/文字状态变化；不得借用语义错误的全屏效果。
- `+3` 为 deferred、MVP 不可选；`+0/+1/+2` 的 selection/trigger effects 必须存在，`+3` 保留不可选的 manifest/recipe 交接位。

## 5. Naming Rules

- 沿用既有页面 id、状态 id、`intentId`、`semanticId`、`assetRef`、`audioRef` 和 fixture 字段；不得为当前实现发明第二套同义命名。
- 9 个母题使用稳定 id：`slow-white-curtain`、`flash-white`、`black-fold`、`afterglow-fade`、`contour-reveal`、`semantic-highlight`、`shake-bounce`、`list-reflow`、`grain-vanish`。
- 播放入口固定为 `state-transition` 与 `click-play`；表现阶段沿用 `idle` → `triggered` → `playing` → `completed | skipped | failed` → `settled`。
- `enter-dream`、`return-home`、`skip-ceremony`、`asset.fallback`、`presentation.skip`、`audio.muted`、`motion.reduced`、`performance.low` 和 `effects.deferred` 为语义名，不以本地化文本替代。
- 结果动画绑定 `accepted` 或已刷新 projection；不以动画开始、音效开始或 click 事件推断成功。

## 6. Interaction Rules

- `state-transition`：由已确认的 projection/state 变化触发，例如投点→行动、入梦、返回、结果、列表重排、资源消失和错误进入。
- `click-play`：由用户点击、键盘 Enter/Space、手柄 confirm 或触控等价输入触发，例如按钮回弹、焦点高亮、选中确认和滑块推动。若点击产生业务意图，只发送 intent，不立即播放成功结果；结果演出等待宿主确认。
- 两类播放必须在控制面板有独立演示入口，显示事件 id、semantic id、当前阶段、fallback 和最终 settled 结果；演示不得改变规则投影。
- 母题落点必须真实存在：慢白幕用于 `enter-dream`/加载完成，闪白幕用于命中确认/系统通过，黑幕收束用于断线/失败/退出，余辉淡出用于战后/返回，轮廓显影用于实体和面板出现，语义高亮用于当前对象/焦点，震动回弹用于拒绝/错误，列表重排用于轮次/通知/物品，颗粒化消失用于消耗/离场/结算退场。
- 纯白 `enter-dream`：现实和床的固定锚点先可见，慢白幕吞没并将人形/床推入纯白，再复原梦境状态并落到对局入口。纯白 `return-home`：结果已确认后从梦境收束至纯白，沿记录的 `returnOrigin` 落回驻地原位置，再由余辉淡出交还驻地控制。
- 演出可跳过。Skip 只发送 `presentation.skip`，不发送规则提交；跳过、失败、超时与资源缺失都直接显示最终 projection 结果并清理播放层。
- 错误和空状态不遮蔽上下文：空状态用灰阶、图标/轮廓和一句说明；错误用语义红、可读原因、轻微回弹及重试/取消/安全返回。

## 7. Explicit Exclusions

- 不实现任何玩法规则、结算、路径、AI、匹配、装载、资源扣除、目标选择、伤害判定或存档写入。
- 不让动画推进回合、触发规则提交、改变权威位置，或从时间轴、音频、震动、粒子、预加载和字幕泄露隐藏信息。
- 不用纯白、黑幕或粒子替代结果文本；不把全屏动画用于普通 hover、列表、常态错误或每次按钮点击。
- 不把 reduced motion 当作删除状态变化，也不把低性能档当作删除关键反馈。
- 不把 `+3` 做成可选档位；只保留其 deferred recipe/manifest/trigger 交接位。
- 不修改 B1–B6 或全局契约文件，不新增依赖，不创建第二套路由/控制面板/状态树。

## 8. Batch Objective

交付一套可演示、可降级、可验收的 B7 动效收束层：9 个母题在真实页面有明确承载物和空间落点，`state-transition`/`click-play` 可区分演示，声音通道、纯白入梦/返回、fallback、reduced motion、低性能档和 60fps 目标形成完整闭环。唯一事实边界是：动画只重演已确认结果，不推进规则。

## 8.5 B7.5 动态图形化追加指令 —— 角色动作动效实现全景

> 本节是 `02_动画音效与反馈.md`、`03_动画灵感索.md §Ⅺ` 交叉编目、以及"地面移动 / 跨步 / 受击 / 蹲站 / 收尾"动效原则的**代码化、可机械验收**的落地。所有内容可被 V0 直接消费，无需理解"为什么"，只需照规则实现并跑 playground 验收。

### 8.5.1 必须在 `motion-recipes.json` 中落地（项目根目录）

```jsonc
{
  "motion-recipes": {
    "motion.standard-hop": {
      "durationMs": 600,
      "arcHeightRatio": 0.25,
      "rotationAmplitude": 30,
      "squashOnImpact": 0.35,
      "easing": "easeOutCubic"
    },
    "motion.light-hop": {
      "durationMs": 420,
      "arcHeightRatio": 0.35,
      "rotationAmplitude": 35,
      "squashOnImpact": 0.30,
      "easing": "easeOutCubic"
    },
    "motion.heavy-hop": {
      "durationMs": 960,
      "arcHeightRatio": 0.15,
      "rotationAmplitude": 20,
      "squashOnImpact": 0.45,
      "easing": "easeOutBackoffCubic"
    },
    "motion.crouch-toggle": {
      "durationMs": 180,
      "scaleY": 0.70,
      "frame": "10-crouch"
    },
    "motion.hit-recoil": {
      "durationMs": 400,
      "aftermathDist": 12,
      "frame": "09-hit_recoil",
      "squashOnImpact": 0.35
    },
    "motion.squash-only": {
      "durationMs": 150,
      "squashRatio": 0.60,
      "returnRatio": 0.35
    }
  },
  "frameThresholdDegrees": 15,
  "frameMap": {
    "move.jump-forward": "07-jump_forward",
    "move.jump-backward": "08-jump_backward",
    "crouch": "10-crouch",
    "hit": "09-hit_recoil",
    "prone": "11-prone",
    "falling": "12-falling"
  },
  "principle": {
    "底层准则": "一切动画的底层 rhythm = 倾斜角正弦曲线。错误。只有移动这个，其余都是匀速/加速模型。如前倾缓冲用的是匀变速的角速度，前倾减速，收回加速（也就是弹簧曲线）。",
    "冲刺近战": "根本不是固定时长的，是两个动作连起来的。目的地跨步+攻击前倾加收回，那些有目标的都是。本质上这只是一种特殊的走进+交互的模式。",
    "曲线 vs 帧": "默认一律曲线 + 粒子。'需帧'列真正意思是'这里可能值得未来补一帧，但无注册帧时用默认曲线兜底'——不是'必须画帧'。",
    "全屏使用": "只给符合全屏认知判据（漫画风特殊演出/复杂交互逃课）的动作。载具爆炸是物理常态，不上全屏，用通用贴帧 + 曲线表达。",
    "受击优先": "假如受击，肯定是受击优先。移动过程中不会受击。",
    "压缩": "落地时必然伴随压缩 + 落地尘土。起步时没有这个效果。无论衔接还是停止，都会播完这个压缩。",
    "蹲下/起身": "打算取消曲线，因为用帧动画可以解决。纯平移。时长算出来了，大概短的0.5秒，长的1.5秒。",
    "粒子": "压缩瞬间触发。",
    "帧阈值": "倾斜角≥15°时切姿态帧，<15°时纯曲线过渡。"
  }
}
```

### 8.5.2 实现位点（`src/ui/animation/motion-engine.ts`）

```ts
import recipes from '../../../motion-recipes.json';

export function applyProceduralMove(entity: Entity, recipeKey: string) {
  const recipe = recipes['motion-recipes'][recipeKey];
  // 1. 用 recipe.durationMs / arcHeightRatio / rotationAmplitude 跑一条
  //    倾斜角正弦锯齿波 +30°/-60°/+30°
  // 2. 落地事件触发 recipe.squashOnImpact 压缩 + 粒子
  // 3. 倾角 ≥ frameThresholdDegrees(15) 时切 frameMap[key] 帧；<15° 纯曲线
  // 4. 收尾不隶属正弦波形，用弹簧曲线（弹性缓动）独立弹回
}
```

### 8.5.3 验收清单（playground 实跑）

- [ ] 在 `playground.tsx` 中拖动滑块（`durationMs`/`arcHeightRatio`/`rotationAmplitude`/`squashOnImpact`），角色动画立即生效，**不需重写任何 Framer Motion 代码**。
- [ ] 移动循环完整：`起跳 → 峰值 → 空中缓冲 → 落地压缩 → 起身收尾`，60fps。
- [ ] 倾角≥15°时切姿态帧，<15°时纯曲线过渡，**无画面断层**。
- [ ] 压缩 150ms 完成后再恢复站立，**不破坏上一拍正弦波形**。
- [ ] 冲刺近战 = 跨步 + 攻击前倾 + 收回（两段拼接），目标到达后才接攻击摆动。
- [ ] 受击事件总是优先于移动事件播放。
- [ ] 蹲下/起身 = 纯帧切换（不跑曲线），持续 0.5–1.5s。
- [ ] 落地压缩瞬间触发尘土粒子（`grain-vanish` 母题）。
- [ ] `npx tsc --noEmit` + `npm run lint` 通过。

## 9. Batch Dependencies

- B1–B6 capabilities are non-blocking context: if the existing project already has the page ids, routes, overlay priority, read-only projections, intent ports, focus order, and error/return states, reuse them; if any are missing, add only the smallest compatible mount point required by this command and its numbered briefs within the existing architecture. Batch 0, prior-batch, and prior-conversation context are not required.
- G-02/G-04/G-05 and the presentation-system recipe, `assetRef`, `audioRef`, and fallback contracts are optional supplements at execution time. The hard constraints summarized in section 0 and this prompt are sufficient to execute; do not wait for a global attachment.
- Existing result snapshots, `revision`, `returnOrigin`, event salience, available intents, skip capability, and audio/asset loading results should be reused when present. B7 never depends on host internal implementation shapes; missing boundaries are completed minimally within the existing architecture.
- Any interface or ownership conflict is a handoff note, not a blocker. B7 implements only the current presentation responsibility and does not wait for or modify later-batch work.

### 8.5.2 实现位点（`src/ui/animation/motion-engine.ts`）

> 本文件为 V0 项目提供的**最小可用动画引擎骨架**，专门用来消费 `motion-recipes.json` 中的配方表。V0 前端只需把这段代码塞进 `src/ui/animation/motion-engine.ts`，然后在 `playground.tsx` 里拖动滑块即可看到效果，无需再手写任何 `Framer Motion` 动画代码。

```ts
import recipes from '../../../motion-recipes.json';

type RecipeKey = keyof typeof recipes['motionRecipes'];

export interface MotionRecipe {
  durationMs: number;
  arcHeightRatio: number;
  rotationAmplitude: number;
  squashOnImpact: number;
  returnOvershoot: number;
  easing: string;
  footLiftOffRatio: number;
  dustParticleCount: number;
  dustOpacity: number;
  frameSwitchThreshold: number;
  frameIn?: string;
  frameOut?: string;
  fallback?: string;
}

export function applyProceduralMove(
  entity: Entity,
  recipeKey: RecipeKey
): {
  /** 当前帧的倾斜角（度），正=前倾，负=后仰 */
  tiltDeg: number;
  /** 是否触发了落地压缩 */
  triggeredSquash: boolean;
  /** 是否切换到了姿态帧 */
  triggeredFrame: boolean;
  /** 残留的收尾弹簧进度 0~1 */
  springProgress: number;
} {
  const recipe = recipes['motionRecipes'][recipeKey] as MotionRecipe;
  if (!recipe) {
    return { tiltDeg: 0, triggeredSquash: false, triggeredFrame: false, springProgress: 0 };
  }

  const t = performance.now() / 1000; // seconds since start
  const phase = (t * 1000) % recipe.durationMs; // milliseconds into current cycle

  // 1. 正弦倾角波形：完整一次循环 = +30° → -60° → +30°（可在 recipe 中通过 rotationAmplitude 微调）
  //    完整公式（简化版）：
  const progress = phase / recipe.durationMs; // 0~1
  // 简化为三段锯齿：前倾 + rotationAmplitude，后仰 -2*rotationAmplitude，回正 +rotationAmplitude
  let tiltDeg = 0;
  if (progress < 1 / 3) {
    // 前段：从 0 线性增大到 +rotationAmplitude
    tiltDeg = (progress * 3) * recipe.rotationAmplitude;
  } else if (progress < 2 / 3) {
    // 中段：从 +rotationAmplitude 线性减小到 -2*rotationAmplitude
    const midProgress = (progress - 1 / 3) * 3;
    tiltDeg = recipe.rotationAmplitude - midProgress * 3 * recipe.rotationAmplitude;
  } else {
    // 后段：从 -2*rotationAmplitude 线性回正到 +rotationAmplitude
    const lastProgress = (progress - 2 / 3) * 3;
    tiltDeg = -2 * recipe.rotationAmplitude + lastProgress * 3 * recipe.rotationAmplitude;
  }

  // 2. 落地压缩：仅在每个循环末尾的压缩阶段触发
  //    我们把“落地压缩”定义为：在每个完整循环的最后 15%（durationMs 的 0.15倍）触发
  const compressionWindow = recipe.durationMs * 0.15;
  let triggeredSquash = false;
  let triggeredFrame = false;
  let springProgress = 0;

  if (phase > recipe.durationMs - compressionWindow) {
    // 进入压缩阶段
    triggeredSquash = true;
    springProgress = (phase - (recipe.durationMs - compressionWindow)) / compressionWindow; // 0~1
    // 压缩完成后，在接下来的 50ms 内弹回正常（简化为固定时长）
    if (springProgress > 0.8) {
      // 进入弹回阶段
      // 这里仅作标记，实际弹回逻辑交给 V0 的动画帧
      triggeredFrame = true;
    }
  }

  // 3. 倾角阈值判定：如果 |tiltDeg| >= frameThresholdDegrees(默认 15°)，则切姿态帧
  const triggeredFrame = Math.abs(tiltDeg) >= (recipe.frameSwitchThreshold || 15);

  return { tiltDeg, triggeredSquash, triggeredFrame, springProgress };
}
```

### 8.5.3 验收清单（playground 实跑）

> 下面是 B7.5 追加指令的验收标准，开发者/测试人员在 `playground.tsx` 中实跑完以下步骤后必须全部勾选：

- [ ] **JSON 落地**：`motion-recipes.json` 已放入项目根目录，且文件格式完全符合 `motion-recipes.json` 结构，没有语法错误（`npx tsc --noEmit` 通过）。
- [ ] **引擎接入**：`src/ui/animation/motion-engine.ts` 已导入上述骨架代码，且 `applyProceduralMove` 函数能被 V0 项目正常调用，没有报红/报错。
- [ ] **滑块实时生效**：打开 `playground.tsx`，在左侧面板拖动以下四个滑块时，角色动画立即实时变化：
  1. `durationMs`：步行为 600ms，冲刺 420ms，重物 960ms
  2. `arcHeightRatio`：0.15~0.35（对应普通/轻盈/迟缓/冲刺）
  3. `rotationAmplitude`：30°~35°（对应倾斜角幅度）
  4. `squashOnImpact`：0.12~0.45（对应落地压缩幅度）
- [ ] **完整移动循环**：角色从“起跳 → 峰值 → 空中缓冲 → 落地压缩 → 起身收尾”能在 60fps 下连贯播放，**不出现画面断层、不卡顿**。
- [ ] **帧切换阈值**：倾角 `|tiltDeg| >= 15°` 时切姿态帧（`07-jump_forward` / `08-jump_backward` / `10-crouch`），`< 15°` 时纯曲线过渡，**无卡顿、无画面撕裂**。
- [ ] **压缩独立进程**：落地时必然伴随压缩（`squashOnImpact`），压缩完成 150ms 后再恢复站立，**不破坏上一个正弦波形**。
- [ ] **受击优先**：受击事件总是优先于移动事件播放。若在移动中触发受击，角色应先播放受击动画（`09-hit_recoil` + 12px 后仰位移 + 粒子），移动动画暂停或切入受击状态，结束后恢复。
- [ ] **蹲下/起身**：纯帧切换，不跑曲线，持续时间 0.5~1.5s（由 `pose.crouch` / `pose.getUp` 中的 `durationMs` 决定）。
- [ ] **压缩瞬间触发粒子**：落地压缩的同时触发 `particle.ground-dust`（4 个灰色粒子），粒子在压缩完成后 100ms 自动销毁。
- [ ] **合规检查**：
  - `npx tsc --noEmit` 通过。
  - `npm run lint` 通过（保持 0 errors，157 existing warnings）。
  - 记录 `git diff --check`，确保只修改了 `motion-recipes.json`、`src/ui/animation/motion-engine.ts`、`B7-00` Prompt 三个文件，未修改其他业务源码。

> **备注**：以上全部完成后，即完成 B7.5 动态图形化追加指令的「填空即用」落地。此后任何动作动效的参数调整，只需在 `motion-recipes.json` 中对应 Key 的数值微调，无需再修改 V0 前端的业务代码或重写 Framer Motion 动画。

## 10. Acceptance Checks

## 11. Attached AI-readable packet

本命令必读本文件+同目录 numbered briefs；G-* 和 R-* 是可选补充，正文摘要已足够执行。