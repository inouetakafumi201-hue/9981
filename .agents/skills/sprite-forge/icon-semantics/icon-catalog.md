# 词条图标语义库（canonical icon semantics）

> **来源**：`src/svg-game-icons/`（game-icons.net 开源集，304 个单色 `currentColor` SVG）
> **性质**：全项目唯一「符号词汇表」——词条图标、素材类别图标、HUD 状态图标、编辑器图层图标等
> 一切抽象符号需求，都从本表取「语义最近」的图标，不另造、不混用。
> **权威**：`docs/表现系统/01_图形化与UI.md`（语义色/视觉定律）、`docs/v0-dev-material-library-spec.md`（素材库/词条槽）
> **配套**：`tools/token-icon-beautify.ts`（统一上色/高光/光晕后处理）

## 三条铁律

1. **泛化不取本义**：图标选入必有丰富内涵。例：`wireframe-globe`=全球化/全局范围，`winchester-rifle`=泛化到所有猎枪，`abstract-018`=世界观物品「锚定导流仪」。绝不用「文件名本义」框死用法。
2. **选最近不造名**：词条/素材/UI 需要图标时，只能从本表选语义最近的「定论语义名」；找不到就换一个接近的，不允许自由发挥新名字或新含义。
3. **颜色随品级不随语义**：图标源保持黑色/`currentColor`，上色由 `token-icon-beautify.ts` 统一做——语义定「用哪个符号」，品级定「上什么色」（灰白1/绿2/蓝3/银4/金5）。

## 受控大类

| 大类 | 用途域 | 对应游戏系统 |
|---|---|---|
| `combat` 战斗 | 近战/远程/重火力/爆炸 | 武器、攻击动作、伤害 |
| `defense` 防御 | 护甲/护盾/屏障 | 防御词条槽、防护素材 |
| `mobility` 机动 | 移动/跳跃/闪避/加速 | 机动词条槽、位移 |
| `status` 状态 | 异常/增益减益/感官 | 状态词条槽、buff/debuff |
| `attribute` 属性 | 力量/体型/智力/感知 | 属性词条槽、角色成长 |
| `resource` 资源 | 货币/物资/战利品 | 局外经济、素材收集 |
| `consumable` 消耗品 | 药剂/食物/燃料 | 背包、消耗动作 |
| `tool` 工具 | 开锁/维修/采集 | 工具素材、交互动作 |
| `device` 装置 | 科技/设备/终端 | 装置类素材、设备实体 |
| `medical` 医疗 | 治疗/急救/诊断 | 急救包/绷带、治疗 |
| `clue` 线索 | 侦查/痕迹/观测 | 线索类素材、调查 |
| `hazard` 危险 | 陷阱/火区/毒素 | 危险标记、致命区域 |
| `environment` 环境 | 建筑/遮挡/地形 | 陈设/遮挡类素材、地图结构 |
| `social` 社交 | 交流/合作/身份 | 对话、组队、UGC 来源 |
| `relation` 关系 | 约束/占领/同盟 | 网关、条件约束、阵营 |
| `dream` 梦境 | 超现实/记忆/世界观 | 梦核、记忆载体、仪式 |
| `check` 检定 | 骰子/随机/命中 | 检定、投点、概率 |
| `time` 时间 | 进度/持续/冷却 | 回合、状态持续、进度条 |
| `info` 信息 | 通讯/信号/档案 | 对讲、广播、资料库 |
| `energy` 能量 | 充能/电力/燃料 | SP/AP 相关、充能装置 |
| `quality` 品级 | 稀有/成就/传说 | 品级表现、荣誉 |
| `action` 操作 | 保存/回收/展开 | 通用 UI 操作 |

---

## 全表（304）

### abstract 站位组（已由项目所有者定论）

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `abstract-005` | 珍宝/馈赠 | 双手捧宝石——被珍视的持有物；用于「稀有素材」「守护之物」「馈赠/祝福」语义 |
| `abstract-010` | 体制齿轮 | 齿轮中的人——被系统裹挟的个体；用于「规则/体制」「身不由己」「轮转中的身份」语义 |
| `abstract-018` | 锚定导流仪 | 未来登记机——**世界观物品**（与现实锚定/导流相关）；用于梦境装置、锚定物 |
| `abstract-021` | 轮转 | 轮子——循环推进；用于「循环」「驱动」「进程」语义 |
| `abstract-024` | 梦境漩涡 | 迷幻连环圈——梦境循环/漩涡；用于「循环梦境」「侵蚀加深」「螺旋下坠」 |
| `abstract-030` | 锁定瞄准 | 四条准星——精确瞄准；用于「锁定目标」「精确打击」「聚焦」 |
| `abstract-045` | 中转转换 | 方套圆中转仪——分流/转换站；用于「转换」「中转」「分流」语义 |
| `abstract-055` | 梦境录像带 | 胶卷带圆圈——梦境记忆载体；用于「梦境记录」「记忆」「回溯」 |
| `abstract-084` | 天文观测 | 向天雷达——天文观测/扫描；用于「探测」「观测」「监听」语义 |
| `abstract-114` | 知识书库 | 书堆——知识积累；用于「知识」「学习」「资料库」语义 |
| `abstract-117` | 梦境破坏器 | 手提收音机——**世界观高能武器**（破坏梦境）；用于「唤醒」「梦境瓦解」「清除」 |

### combat 战斗

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `3d-hammer` | 锤击 | 近战重击、敲击动作 |
| `ancient-sword` | 古剑 | 古老近战武器、传说武器 |
| `axe-swing` | 挥斧 | 斧类近战、重劈 |
| `bayonet` | 刺刀 | 枪械近战、突刺 |
| `chainsaw` | 电锯 | 破坏性近战、切割 |
| `crossed-swords` | 对决 | 战斗遭遇、PVP、决斗 |
| `gladius` | 短剑 | 短兵近战 |
| `high-kick` | 高踢 | 踢击技能 |
| `high-punch` | 重拳 | 重拳技能 |
| `punch` | 拳击 | 基础近战 |
| `punch-blast` | 拳风 | 范围近战、气浪 |
| `quick-slash` | 快斩 | 快速连击、先手攻击 |
| `shield-bash` | 盾击 | 盾牌攻击 |
| `sword-clash` | 兵刃交击 | 格挡、招架 |
| `sword-break` | 断刃 | 武器损坏、缴械 |
| `sword-in-stone` | 石中剑 | 天命、传说、拔剑 |
| `sword-smithing` | 铸剑 | 锻造、打造武器 |
| `wind-slap` | 风掌 | 推离、气浪控制 |
| `deadly-strike` | 致命一击 | 暴击、处决 |
| `blast` | 爆轰 | 爆炸伤害、冲击 |
| `cluster-bomb` | 集束炸弹 | 范围轰炸、多段伤害 |
| `dynamite` | 炸药 | 爆破、拆墙 |
| `fire-bomb` | 燃烧弹 | 范围燃烧、纵火 |
| `fire-zone` | 火区 | 燃烧区域、持续火焰伤害 |
| `stick-grenade` | 手雷 | 投掷爆炸物 |
| `stun-grenade` | 眩晕弹 | 范围眩晕、控场 |
| `flash-grenade` | 闪光弹 | 致盲、干扰 |
| `explosive-materials` | 易爆物 | 危险物标记、弹药原料 |
| `artillery-shell` | 炮弹 | 重型轰击、支援火力 |
| `gunshot` | 枪伤 | 射击伤害、命中结算 |
| `heavy-lightning` | 重雷 | 雷电重击、天罚 |
| `power-lightning` | 雷击 | 雷电技能、充能放电 |
| `nuclear` | 核爆 | 终极威胁、末日级 |
| `disintegrate` | 湮灭 | 即死、分解、消除 |
| `decapitation` | 斩首 | 处决、致命终结 |
| `amputation` | 截肢 | 致残、永久损伤 |
| `pierced-body` | 穿刺 | 贯穿伤害、破甲 |
| `death-zone` | 死亡区 | 致命区域、禁区 |
| `quick-slash` | （见上） | — |
| `fire` | 烈焰 | 火焰、燃烧状态 |
| `apc` | 重装载具 | 泛化：装甲运兵、重装运输、铁壁冲锋 |
| `air-force` | 空中支援 | 泛化：制空权、空袭、高空威胁 |

### ranged 远程（并入 combat）

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `aerodynamic-harpoon` | 鱼叉 | 远程投掷、捕获 |
| `archer` | 弓手 | 弓箭远程 |
| `arrow-flights` | 箭羽 | 远程弹药、追踪 |
| `arrow-wings` | 箭翼 | 疾射、加速箭 |
| `autogun` | 自动炮 | 自动火力、炮塔 |
| `blunderbuss` | 火铳 | 霰弹枪类、散射 |
| `bolter-gun` | 爆弹枪 | 重口径枪械 |
| `bowman` | 弓手 | 远程射手 |
| `bullets` | 弹药 | 弹药储备 |
| `bullseye` | 靶心 | 精确命中、弱点击中 |
| `on-target` | 命中 | 命中判定、瞄准完成 |
| `heavy-bullets` | 重弹 | 高伤弹药、破甲弹 |
| `ammo-box` | 弹药箱 | 弹药补给 |
| `machine-gun` | 机枪 | 持续火力、压制 |
| `machine-gun-magazine` | 弹匣 | 换弹、弹药量 |
| `minigun` | 迷你炮 | 重型连射 |
| `missile-launcher` | 导弹发射器 | 远程重火力 |
| `musket` | 火枪 | 旧式步枪、单发 |
| `panzerfaust` | 铁拳 | 反装甲武器 |
| `revolver` | 左轮手枪 | 手枪、备用武器 |
| `silenced` | 消音 | 隐蔽射击、无声行动 |
| `switch-weapon` | 切换武器 | 换武器动作 |
| `gun-stock` | 枪托 | 枪械部件、改装 |
| `winchester-rifle` | 猎枪 | **泛化：一切猎枪/步枪类** |
| `lee-enfield` | 栓动步枪 | 步枪类、远射 |
| `colt-m1911` | 柯尔特手枪 | 手枪类、速射 |
| `cz-skorpion` | 蝎式冲锋枪 | 冲锋枪类 |
| `ak47` | 突击步枪 | 突击火力 |
| `ak47u` | 突击步枪·短款 | 突击火力、紧凑型 |
| `ak47` / `ak47u` | 突击步枪 | 突击火力 |
| `anti-aircraft-gun` | 防空炮 | 对空反制 |
| `silenced` | （见上） | — |

### defense 防御

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `abdominal-armor` | 腹甲 | 部位防护 |
| `armor-cuisses` | 腿甲 | 腿部防护 |
| `armor-upgrade` | 护甲升级 | 强化防御 |
| `armored-pants` | 装甲裤 | 下身防护 |
| `attached-shield` | 持盾 | 持盾防御 |
| `barrier` | 屏障 | 阻挡、隔离 |
| `belt-armor` | 腰带甲 | 腰部防护 |
| `broken-shield` | 破盾 | 防御失效 |
| `healing-shield` | 治疗护盾 | 护盾+回复 |
| `kevlar-vest` | 防弹衣 | 弹道防护 |
| `leg-armor` | 腿甲 | 腿部防护 |
| `shield-bounces` | 盾反弹 | 防御反击 |
| `shield-disabled` | 护盾失效 | 破防状态 |
| `arrows-shield` | 箭盾 | 防远程 |
| `protection-glasses` | 护目镜 | 眼部防护 |
| `hazmat-suit` | 防护服 | 环境防护 |
| `antibody` | 抗体 | 免疫、抗性 |
| `american-football-helmet` | 头盔 | 头部防护 |
| `gas-mask` | 防毒面具 | 毒气防护 |

### mobility 机动

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `acrobatic` | 杂技 | 灵活、闪转 |
| `anticlockwise-rotation` | 逆旋 | 逆转、回退 |
| `cycle` | 循环 | 循环、周期 |
| `dodging` | 闪避 | 闪避、规避 |
| `jump-across` | 跳跃 | 跨越、跳跃 |
| `move` | 移动 | 移动动作 |
| `parachute` | 降落伞 | 缓降、空降 |
| `pull` | 拉拽 | 牵引、拉近 |
| `push` | 推 | 推动、推开 |
| `twister` | 旋风 | 旋转位移、旋风攻击 |
| `walk` | 行走 | 步行移动 |
| `wingfoot` | 神行 | 加速、疾行 |
| `winged-leg` | 飞腿 | 机动强化 |
| `falling` | 坠落 | 坠落、失足 |
| `nailed-foot` | 钉足 | 定身、困足 |
| `quicksand` | 流沙 | 减速、困陷 |
| `aero-bike` | 飞行载具 | 快速载具、飞行 |
| `airplane-arrival` | 到达 | 泛化：抵达、登陆、传送落点 |
| `airplane-departure` | 出发 | 泛化：启程、出发、传送起点 |

### status 状态

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `burning-dot` | 灼烧 | 持续灼烧 |
| `coma` | 昏迷 | 失能、长昏迷 |
| `despair` | 绝望 | 士气崩溃、负面心智 |
| `hearing-disabled` | 失聪 | 感官丧失 |
| `invisible` | 隐形 | 隐匿、潜行 |
| `frozen-block` | 冰冻 | 冻结、无法行动 |
| `half-dead` | 濒死 | 濒死状态 |
| `ice-cube` | 冰块 | 冰霜状态 |
| `fangs` | 獠牙 | 撕咬、野兽威胁 |
| `wrapped-heart` | 缠绕之心 | 牵挂、执念束缚 |
| `chewed-heart` | 噬心 | 侵蚀、被吞噬 |
| `shining-heart` | 闪光之心 | 勇气、真心 |
| `overdose` | 过量 | 药物过量、副作用 |
| `muscle-fat` | 肥胖 | **泛化：体型/笨重/负重**（字面=脂肪） |
| `pyromaniac` | 纵火狂 | 火焰狂热、自燃倾向 |
| `arm-sling` | 吊臂带 | 泛化：伤后束缚、恢复中、行动受限 |
| `invisible` | （见上） | — |

### attribute 属性

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `anatomy` | 解剖 | 体质、弱点分析 |
| `biceps` | 力量 | 力量属性 |
| `brute` | 蛮力 | 蛮力、莽撞 |
| `giant` | 体型 | 大体型、压制 |
| `growth` | 成长 | 成长、发育 |
| `inner-self` | 内在自我 | 心智、真我 |
| `muscle-up` | 强化 | 强化、提升 |
| `skills` | 技能 | 技能属性 |
| `wisdom` | 智慧 | 智慧、洞察 |
| `achievement` | 成就 | 成就、里程碑 |
| `trophy-cup` | 奖杯 | 胜利、荣誉 |
| `amplitude` | 波形 | **泛化：波/信号/波动**——音波、心电、传感 |
| `aerial-signal` | 空中信号 | 信号、呼叫、联络 |

### resource 资源

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `banknote` | 钞票 | 货币 |
| `credits-currency` | 信用货币 | 信用、交易 |
| `expense` | 支出 | 消耗、花费 |
| `money-stack` | 钱堆 | 财富、储备 |
| `pay-money` | 付款 | 支付、购买 |
| `shiny-purse` | 钱包 | 随身财富 |
| `hand-bag` | 手提包 | 随身物资 |
| `briefcase` | 公文包 | 任务物品、文件 |
| `apple-core` | 果核 | 残余、消耗品残余 |
| `wine-bottle` | 酒瓶 | 饮品、酒类消耗 |
| `steak` | 食物 | 食物、补给 |
| `cannister` | 罐 | 容器、储罐 |
| `barrel` | 木桶 | 容器、遮挡 |
| `oil-drum` | 油桶 | 燃料、易爆容器 |
| `battery-0` | 电量空 | 能源耗尽 |
| `battery-100` | 电量满 | 能源充足 |
| `battery-pack` | 电池组 | 能源储备 |
| `boarding-pass` | 通行凭证 | 通行权、许可 |
| `envelope` | 信封 | 信息、信件 |
| `open-folder` | 档案 | 资料、档案 |
| `jigsaw-piece` | 拼图块 | 碎片、部件、拼合 |
| `light-backpack` | 轻背包 | 携带、轻装 |
| `chest` | 宝箱 | 战利品、收藏 |
| `open-treasure-chest` | 开启的宝箱 | 已获取、奖励已开 |
| `strongbox` | 保险箱 | 安全存放、贵重 |
| `rope-coil` | 绳圈 | 绳索、捆绑、攀登 |
| `battle-gear` | 战斗装备 | 武装、出征准备 |
| `belt` | 腰带 | 装备挂载 |

### consumable 消耗品

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `pill` | 药丸 | 药物、胶囊 |
| `miracle-medecine` | 神药 | 奇迹治疗、珍稀药品 |
| `medical-pack` | 医疗包 | 治疗包 |
| `first-aid-kit` | 急救箱 | 急救 |
| `drink-me` | 药水 | 变身药水、神秘饮品 |
| `bubbling-flask` | 炼金瓶 | 炼金药剂、实验 |
| `hypodermic-test` | 注射器 | 注射、实验 |
| `match-head` | 火柴 | 火源、点燃 |
| `wine-bottle` | （见上） | — |

### tool 工具

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `key` | 钥匙 | 解锁 |
| `skeleton-key` | 万能钥匙 | 通用解锁 |
| `car-key` | 载具钥匙 | 启动载具 |
| `padlock` | 挂锁 | 锁定 |
| `padlock-open` | 开锁 | 解锁动作 |
| `bolt-cutter` | 断线钳 | 破坏锁具 |
| `swiss-army-knife` | 瑞士军刀 | 多功能工具 |
| `monkey-wrench` | 扳手 | 维修、调整 |
| `paint-roller` | 油漆滚筒 | 涂装、覆盖、重绘 |
| `fishing-net` | 渔网 | 捕捉、困住 |
| `ladder` | 梯子 | 攀爬、架设 |
| `magnet` | 磁铁 | 吸引、吸附 |
| `metal-detector` | 金属探测器 | 探测 |
| `microscope` | 显微镜 | 微观观察 |
| `telescope` | 望远镜 | 远视、观察 |
| `miner` | 采集 | 采集、挖矿 |
| `anvil` | 铁砧 | 锻造、打造 |
| `match-head` | （见上） | — |

### device 装置

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `3d-glasses` | 立体视镜 | 透视、增强视觉 |
| `alligator-clip` | 鳄鱼夹 | 连接、夹持 |
| `audio-cassette` | 磁带 | 录音、记忆载体 |
| `film-strip` | 胶片 | 影像、记录 |
| `flashlight` | 手电筒 | 照明、侦查 |
| `gamepad` | 手柄 | 控制、操纵 |
| `gas-stove` | 燃气灶 | 火源、烹饪 |
| `gps` | 定位 | 导航、追踪 |
| `laptop` | 终端 | 信息终端 |
| `microchip` | 芯片 | 科技核心 |
| `steering-wheel` | 方向盘 | 驾驶、掌控 |
| `stethoscope` | 听诊器 | 诊断、检测 |
| `vr-headset` | 虚拟头盔 | 沉浸、虚拟 |
| `walkie-talkie` | 对讲机 | 短距通讯 |
| `wireframe-globe` | 全球范围 | **泛化：全球化/全局范围/全图** |
| `encrypted-channel` | 加密信道 | 秘密通讯、保密 |
| `anti-aircraft-gun` | （见上） | — |
| `abstract-018` | 锚定导流仪 | （见 abstract 组） |

### medical 医疗

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `caduceus` | 医杖 | 医疗、治愈 |
| `first-aid-kit` | 急救箱 | 急救、包扎 |
| `medical-pack` | 医疗包 | 治疗补给 |
| `stethoscope` | 听诊器 | 诊断、评估 |
| `antibody` | 抗体 | 免疫、抗性 |

### clue 线索

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `all-seeing-eye` | 全视之眼 | 全域侦查、洞察 |
| `footprint` | 足迹 | 痕迹、追踪 |
| `finger-print` | 指纹 | 身份、痕迹 |
| `magnifying-glass` | 放大镜 | 调查、观察 |
| `on-sight` | 目击 | 发现、目睹 |
| `acoustic-megaphone` | 噪音源 | 声响、警报、吸引注意 |
| `hazard-sign` | 危险标志 | 警告、禁区 |
| `abstract-084` | 天文观测 | 探测、观测、监听 |
| `microscope` | 显微镜 | （见 tool） |

### hazard 危险

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `achilles-heel` | 弱点 | 致命弱点、突破口 |
| `cut-palm` | 割掌 | 献祭、创伤 |
| `mantrap` | 捕人陷阱 | 陷阱、伏击 |
| `quicksand` | 流沙 | 困陷、减益地形 |
| `fire-zone` | 火区 | 燃烧区域 |
| `death-zone` | 死亡区 | 致命区域 |
| `nuclear` | 核爆 | 末日威胁 |
| `aerosol` | 喷雾/毒雾 | 泛化：气雾攻击、雾化药剂、毒雾区域 |
| `broken-arrow` | 断箭 | 泛化：任务中断、信号丢失、计划失败 |
| `poison`（无） | — | 用 `cobra`/`fangs` 替代 |

### environment 环境

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `3d-stairs` | 阶梯 | 层级、上升通道 |
| `ancient-ruins` | 遗迹 | 远古、探索地 |
| `car-door` | 车门 | 载具入口、车辆 |
| `curling-vines` | 藤蔓 | 缠绕、自然生长 |
| `entry-door` | 入口门 | 通道、入口 |
| `fallout-shelter` | 避难所 | 安全区、庇护 |
| `house` | 房屋 | 建筑、驻地 |
| `locked-door` | 锁门 | 封锁、未解锁 |
| `mountaintop` | 山顶 | 制高点、目标点 |
| `magic-portal` | 传送门 | 传送、梦境门 |
| `ent-mouth` | 树人 | 自然古老存在 |
| `shadow-follower` | 影随者 | 潜行跟随、暗影 |
| `anchor` | 锚定 | 锚点、固定、绑定 |
| `expansion`（无） | — | 用 `expand` 替代 |

### social 社交

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `all-for-one` | 万众一心 | 团队协同 |
| `allied-star` | 同盟 | 友军、同盟 |
| `convince` | 说服 | 交涉、劝服 |
| `discussion` | 讨论 | 交流、商量 |
| `shaking-hands` | 握手 | 合作、协议 |
| `vote` | 表决 | 投票、决议 |
| `basketball-jersey` | 球队身份 | 团队、阵营身份 |
| `drama-masks` | 面具 | 伪装、表演、身份 |
| `prayer` | 祈祷 | 仪式、信仰 |
| `confrontation` | 对峙 | 遭遇、摊牌 |

### relation 关系

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `arrest` | 拘禁 | 控制、逮捕 |
| `handcuffs` | 手铐 | 束缚、拘禁 |
| `encirclement` | 包围 | 围困、合围 |
| `oppression` | 压迫 | 压制、高压 |
| `occupy` | 占领 | 占据、控制 |
| `snatch` | 抢夺 | 夺取、抢走 |
| `bandit` | 强盗 | 劫掠者、敌人 |
| `robber-mask` | 劫匪面罩 | 伪装、犯罪 |
| `police-officer-head` | 执法者 | 秩序、权威 |
| `sergeant` | 指挥者 | 军官、指挥 |
| `bully-minion` | 爪牙 | 喽啰、走狗 |
| `wanted-reward` | 悬赏 | 通缉、报酬 |
| `anarchy` | 混乱 | 失序、无政府 |
| `all-for-one` | （见上） | — |

### dream 梦境

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `alien-skull` | 异星骸 | 异质存在、未知威胁 |
| `android-mask` | 机械面具 | 机械、伪装 |
| `angel-wings` | 天使之翼 | 祝福、庇护 |
| `anubis` | 审判 | 死亡、审判 |
| `batwing-emblem` | 蝠翼徽章 | 黑暗象征、夜 |
| `cobra` | 毒蛇 | 毒、潜伏威胁 |
| `crucifix` | 十字架 | 信仰、庇护 |
| `evil-book` | 魔典 | 禁忌知识 |
| `kenku-head` | 鸦人 | 情报、信使 |
| `yin-yang` | 阴阳 | 平衡、对立统一 |
| `ace` | 王牌 | 顶级、关键牌 |
| `abstract-005` | 珍宝 | （见 abstract 组） |
| `abstract-024` | 梦境漩涡 | （见 abstract 组） |
| `abstract-055` | 梦境录像带 | （见 abstract 组） |
| `abstract-117` | 梦境破坏器 | （见 abstract 组） |

### check 检定

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `dice-twenty-faces-twenty` | D20 | 大型检定、命运骰 |
| `inverted-dice-1` | 骰点1 | 低点、失败 |
| `inverted-dice-2` | 骰点2 | 检定点数 |
| `inverted-dice-3` | 骰点3 | 检定点数 |
| `inverted-dice-4` | 骰点4 | 检定点数 |
| `inverted-dice-5` | 骰点5 | 检定点数 |
| `inverted-dice-6` | 骰点6 | 高点、成功 |
| `perspective-dice-six-faces-random` | 透视骰 | 随机、未知结果 |
| `rolling-dices` | 掷骰 | 检定开始 |
| `poker-hand` | 手牌 | 手牌、赌局 |
| `on-target` | （见上） | — |

### time 时间

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `alarm-clock` | 闹钟 | 定时、预警 |
| `duration` | 持续 | 状态持续、时长 |
| `extra-time` | 加时 | 延长时间、额外回合 |
| `hourglass` | 沙漏 | 时间流逝、倒计时 |
| `progression` | 进度 | 进度、推进 |
| `fast-backward-button` | 快退 | 回退、撤销 |
| `fast-forward-button` | 快进 | 加速、跳过 |
| `pause-button` | 暂停 | 暂停、中断 |
| `stop-sign` | 停止 | 禁止、停下 |

### info 信息

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `acoustic-megaphone` | 噪音源 | 声响、广播 |
| `aerial-signal` | 信号 | 呼叫、联络 |
| `encrypted-channel` | 加密信道 | 保密通讯 |
| `walkie-talkie` | 对讲机 | 通讯 |
| `envelope` | 信件 | 信息传递 |
| `open-folder` | 档案 | 资料、档案 |
| `laptop` | 终端 | 信息终端 |
| `wireframe-globe` | 全局 | 全球化、全图范围 |
| `amplitude` | 波形 | 信号、波动 |

### energy 能量

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `energise` | 充能 | 恢复能量 |
| `embrassed-energy` | 拥抱能量 | **泛化：汲取/吸收/接纳能量**（字面=拥抱能量） |
| `battery-0` | 电量空 | 能源耗尽 |
| `battery-100` | 电量满 | 能源充足 |
| `battery-pack` | 电池组 | 能源储备 |
| `heavy-lightning` | 重雷 | 雷电能量 |
| `power-lightning` | 雷击 | 放电 |

### quality 品级

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `ace` | 王牌 | 顶级、T0 |
| `achievement` | 成就 | 荣誉、里程碑 |
| `trophy-cup` | 奖杯 | 胜利、冠军 |
| `allied-star` | 星标 | 置顶、收藏 |
| `wanted-reward` | 悬赏 | 高价值目标 |

### action 操作

| id | 定论语义名 | 泛化/游戏内用法 |
|---|---|---|
| `auto-repair` | 自动修复 | 修复、恢复 |
| `expand` | 展开 | 展开、扩展 |
| `recycle` | 回收 | 回收、再利用 |
| `save-arrow` | 保存 | 保存、存档 |
| `upgrade` | 升级 | 升级、强化 |
| `sword-smithing` | 铸造 | 锻造、打造 |
| `stop-sign` | 停止 | 停止、禁止 |
| `switch-weapon` | 切换 | 切换、更换 |

---

## 使用规则（AI / 迭代者）

1. **先查表再生成**：需要任何抽象符号时，先在本表按「泛化语义」找；找到就用对应 `id` 指向的 `src/svg-game-icons/game-icons--<id>.svg`。
2. **找不到就换接近的**：本表是受控词汇表，不做开放性命名。宁可语义稍远也不自造新名字。
3. **上色统一走后处理**：源 SVG 保持黑色/`currentColor`，用 `tools/token-icon-beautify.ts` 按品级或类别上色 + 高光 + 光晕。
4. **新图标入表流程**：新增图标先由项目所有者定论语义名（与 abstract 组同流程），再补进本表，之后才能被引用。
