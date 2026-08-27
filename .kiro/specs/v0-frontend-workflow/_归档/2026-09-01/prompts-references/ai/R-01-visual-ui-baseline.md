# R-01 视觉与 UI 基线重写 brief

## 1 页面定位

为 WakeUp 的标题、驻地、对局 HUD、过渡和信息面板提供统一的可生成视觉基线。生成的是可运行的 UI 壳层，不是后端、规则模拟器或地图编辑器。目标画面为 1920×1080，最低适配 1280×720；以高辨识像素前景叠加暖/冷的半透明全息投影光层，保持游戏界面感，不做 SaaS 仪表盘或卡片墙。

视角只在需要表达地图实体、角色或静态承载物时使用 `front-top axonometric view, elevated camera directly in front, top face and front face visible, side and rear faces hidden, fixed conventional elevated angle, orthographic projection.`。不使用等距侧视、纯正上方平面图、三分之四侧面或露出侧/后立面。UI 平面本身保持正交，素材可成为场景空间的一部分，而非只贴在卡片上。

## 2 权威来源（attachmentId/provenance）

- `G-01-project-and-scope-contract`：UI-only、mock/projection、素材允许、+3 不可选、排除系统边界。
- `G-02-visual-token-contract`：分辨率、像素前景+全息背景、颜色语义、层级、视角和材质。
- `G-04-interaction-accessibility`：五态、同屏选择上限、输入等价和焦点。
- `presentation-ui-01` / `references/source/presentation-ui-01.md`：表现层视觉定律、轮次栏、实体视角、响应式与素材使用。
- `decision-d083`：背景升级为全息投影光层。
- `A-201-hud-refined2` / `references/assets/A-201-hud-refined2.png`：当前 HUD 空间参考，directToAi。
- `A-202-hud-refined` / `references/assets/A-202-hud-refined.png`：HUD 备选参考，directToAi。
- `A-203-hud-v3-legacy-tier-reference` / `references/assets/A-203-hud-v3-legacy-tier-reference.png`：历史层级参考，只可对照，不得恢复旧档位。

## 3 当前决策

- 颜色是语义通道：红=生命损失/危险，蓝=清醒/体力/科技，黄=感官/警戒，橙=AP/进行中，绿=安全/免费/完成，紫=关系约束/远程，珊瑚=近战，青=社交/UGC，灰=冷却/延迟，灰白=受制但仍可交互，纯白/奶白=梦境边界和过载，金银只做少量品级或成就高光。
- 交互层级为环境层 → 实体与表现层 → 事件层 → HUD/面板层 → 仪式/错误覆盖层；不要把每层变成一条网页栏。
- 可点击对象用边缘发光、凸起、材质高光和文字/图标表示；不可点击对象扁平、无高光并给出原因。灰色不单独承担不可用语义。
- 允许登记的 PNG、纹理、光效、立绘、角色和静态组件素材。缺少素材时保留组件位置，用语义占位、轮廓、图标和文本降级，不以“零素材”作为目标。
- HUD 参考图中的 0/1/2 档可以生成；`+3极限爆发`只能作为 disabled 的 future 注记，不能成为滑块或按钮的可选值。选择特效与触发特效仍要留出表现位。

## 4 状态机

- 页面：`hidden → entering → ready → interacting → leaving → hidden`。
- 控件：`base → hover | focus → active → return`，不可用为 `disabled`，提交为 `pending → accepted | rejected | stale | timeout`。
- 仪式层：`hidden → playing → result → hidden`；缺资源、跳过或 reduced motion 都直接收敛到同一个 result。
- 素材：`loading → ready | fallback | error`；fallback 只替换内容，不删除结构。

## 5 组件树

`AppShell → EnvironmentLayer → EntityLayer → EventLayer → HudLayer → OverlayStack → FeedbackLayer`。

HUD 参考结构：`HudLayer → TurnOrderBar → TurnFrameList`、`ActionSurface`、`ResourceBlocks`、`StatusBadges`、`ContextMenu`、`FocusScope`、`LiveRegion`。所有组件通过 props 接收 `assetRef/iconRef/portraitRef/textureRef`，不把素材路径或业务事实写死在组件内。

## 6 只读数据

生成 AI 使用带 `source: "mock"` 的展示快照。只读字段包括 `screen`、`phase`、`entities`、`resources`、`notices`、`revision`、控件 label、disabled reason、当前选择、assetRef、iconRef、portraitRef。玩家可见资源块按 1–5 离散段展示；回合号、实体数、加载时间等内部度量不冒充玩家资源。视觉层不得从颜色推断 HP、AP、伤害、目标有效性或规则结果。

## 7 动作意图

所有按钮、卡片、菜单、拖拽确认和快捷键调用统一 intent builder，提交 `{intentId, payload, requestId}`。可用意图示例：`navigate.page`、`settings.preview`、`battle.select-action`、`battle.select-target`、`pause.resume`、`asset.fallback`。payload 只描述用户意图和显式选择，不携带 UI 本地计算的 AP、伤害、路径或命中结论。收到结果前不要把 pending 画成 accepted。

## 8 本地 UI 状态

仅允许保存 hover、focus、active、selected、expanded、filter、pageIndex、pendingRequestId、animationPhase、assetLoaded、reducedMotion、muted 和面板透明度。不要本地保存或推导 HP、AP、伤害、路径、匹配事实、任务完成、库存拥有权或玩家权限。响应式只重排位置和密度，不改变动作权限、成本或结果。

## 9 视觉令牌

- 画布：1920×1080 基准，1280×720 最低；保留安全区和焦点环，文字放大时重排而不是截断。
- 背景：低饱和半透明暖/冷全息光层、局部噪声、边缘光和阴影；创作侧偏暖琥珀，对局棋盘可偏冷暗。
- 前景：硬边像素轮廓、可读剪影、接地阴影和局部高光；素材尺寸优先 32×32 或 64×64。
- 交互：白/灰白中性可通行，语义色沿全局表；金银不能取代主语义色。
- 同一视口同屏并列选择最多 5 个。超过 5 个用分页、滚动或分组。

## 10 动效绑定

- hover/focus：短促边缘发光、轻微上浮和材质反光；active：轻压缩再回弹；列表变化使用空间连续的 `list-reflow`。
- 页面切换可用 `afterglow-fade`、`contour-reveal`、`slow-white-curtain`、`black-fold`，但纯白显形必须保留给入梦/返回等梦境阈值。
- 状态变化先显示投影结果，再播放 `semantic-highlight`、`shake-bounce`、`grain-vanish` 等反馈；动画不能推进规则。
- 使用已登记参考图指导布局，不能把 A-203 的历史 tier 当成当前交互，也不能把四档爆发恢复为可选项。

## 11 输入无障碍

鼠标 hover/click、键盘 Tab/Shift+Tab/Enter/Space/Esc/方向键、手柄焦点/确认、触控 tap/long-press 和屏幕阅读器必须走相同 intent。弹层打开时焦点进入弹层，关闭后回到触发控件；焦点环不能被裁切。颜色必须同时有文字、图标、形状或材质通道；动画和音频不作为唯一信息。

## 12 加载错误超时

资源加载显示结构化 loading，超过阈值显示“重试/取消/安全返回”，不留无限 spinner。PNG、纹理、立绘或光效失败时按指定资源 → 同语义默认 → 程序化反馈 → 图标/文字占位的顺序降级，保留结果与组件位。端口拒绝、stale 或 timeout 显示原因，不伪造成功。

## 13 明确不做

不实现后端、规则引擎、AI 决策、地图拓扑、ORCA、寻路、AP/HP 计算、伤害判定、存档写入或第二套路由树。不使用霓虹彩虹、暗黑科技终端、统一圆角卡片汤、浏览器 chrome、纯素材缺失白屏。`editor`、`research-bench`、`material-library`、`computer` 的内部 UI 不从本 brief 生成。

## 14 依赖交接

生成壳层只需要一个 mock provider 和三个端口形状：`StatePort.getSnapshot()`、`ActionPort.submit(request)`、`CadencePort.subscribe(listener)`。后续接线方替换 provider/adapter，不改组件树、语义 label、intentId、焦点顺序或视觉状态。素材方按 manifest 提供 `assetRef`，缺失由表现层 fallback 处理。

## 15 验收条件

- 画面在 1920×1080 和 1280×720 安全区内保持层级清晰，不是后台仪表盘。
- 颜色、材质、图标和文字共同表达状态；同屏选择不超过 5 个。
- A-201/A-202 可作为 HUD 空间参考，A-203 被标为历史且不引入旧 tier；没有标题 PNG 时显示 pending 而不是伪造截图。
- 所有控件具备 hover/focus/active/disabled/return，键盘、手柄、触控和屏幕阅读路径等价。
- mock 与 projection 仅替换数据源，动画跳过、素材失败、reduced motion 和错误都落到同一结果。
