# B4-02 设置生命周期与无障碍（含显示/声音/输入/无障碍/语言/图形六分类）

## 1 页面定位

- 本 brief 定义 `utility-settings` 与设置生命周期：从暂停或标题进入、六个分类的全部 mock 调项、本地 preview、保存、取消、恢复默认、保存失败、重试、pending、拒绝与焦点归还。
- 本 brief 逐条遵守 G-01..G-08 的 UI-only、intent-only、素材允许、不用零素材口径、同屏不超过 5、不得写库或实现规则约束。
- 设置是悬浮面板，覆盖层级的悬浮面板，不做独立全屏场景；六分类固定为 display、sound、input、accessibility、language、graphics 全部调项 mock 可编辑。
- 界面只消费只读投影中的允许值范围、当前值和默认值，只提交 intent；真正写入设置由稳定端口承接，UI 不写库。

## 2 权威来源

- attachmentId: `frontend-global-g03`
  provenance: `G-03-ui-port-contract.md；settings.preview/save 的 request/result 生命周期`
- attachmentId: `frontend-global-g04`
  provenance: `G-04-interaction-accessibility.md；Tabs、Slider、Select、焦点归还、输入等价`
- attachmentId: `frontend-global-g06`
  provenance: `G-06-mock-data-fixtures.md；settings 字段：displayScale、fullscreen、masterVolume/musicVolume/effectsVolume/voiceVolume/uiVolume、reducedMotion、subtitles、highContrast、language、quality`
- attachmentId: `frontend-global-g05`
  provenance: `G-05-motion-audio-fallback.md；preview、reduced motion、音频槽`
- attachmentId: `frontend-settings-ruling`
  provenance: `presentation-ui-01；可调文字、焦点放大不裁切、关键控制不被放大截断`
- attachmentId: `frontend-global-g02`
  provenance: `G-02-visual-token-contract.md；语义色、面板材质、五态`

## 3 当前决策

- 六分类固定且不得漏项：`display` 包含 `displayScale`、`fullscreen`；`sound` 包含 `masterVolume`、`musicVolume`、`effectsVolume`、`voiceVolume`、`uiVolume`；`input` 包含快捷键/输入映射 mock 调项；`accessibility` 包含 `reducedMotion`、`subtitles`、`highContrast`；`language` 包含 `language`；`graphics` 包含 `quality`。这些是当前全部设置分类和调项，不新增第七类或隐藏调项。
- 每个调项：进入本地 preview → 提交 `settings.preview` → 仅在 accepted 后应用视觉暂存；`保存` 统一提交 `settings.save`，`取消` 丢弃本地编辑并回到触发点，`恢复默认` 提交恢复默认 intent。
- 保存失败不丢弃编辑值，显示原因和重试/取消；保存成功可选择关闭面板或停留在 preview 回显。
- 关闭面板焦点总回归打开它的入口（暂停菜单或标题选项）；键盘、手柄、读屏均可完成六分类切换与所有调项。
- 音量类调项使用 `mock` 分贝/百分比带、颜色和当前值；可静音、可听逐字说明、可看字幕倾向；真实混音由 audio 端口处理。
- 无障碍分类必须提供显示设置与辅助设置的可见项，与视觉令牌独立；reduced-motion、字幕、低对比度/高对比度作为可调项存在。

## 4 状态机

```text
closed
  └─ open-settings-intent → loading
loading → ready
ready
  ├─ switch-category → ready (view change)
  ├─ edit-field → preview-local
  ├─ settings.preview → intent-pending → accepted | rejected | timeout | stale
  ├─ settings.save → saving
  │   ├─ accepted → saved → ready/close
  │   ├─ rejected → error-recoverable (keep edits)
  │   ├─ timeout → stale-or-retry
  │   └─ resync → loading
  ├─ cancel-changes → discard-local → closed
  └─ restore-defaults → restore-pending → accepted | rejected
error-recoverable → retry-save | close-and-return-focus
```

- `preview` 的本地暂存可以回退到打开前的假值；`save` 的 accepted 才代表设置真正更新。
- 恢复默认只在确认后提交；取消恢复默认回到 ready，并保留当前本地编辑。
- 所有 pending 都可取消/可重试；不把本地滑动/输入视为已保存。

## 5 组件树

```text
SettingsLifecyclePanel
├─ SettingsTabs            (display/sound/input/accessibility/language/graphics)
├─ SettingsFormFieldGroup
│  ├─ NumberRangeField      (volume / scale / quality)
│  ├─ ToggleField           (subtitles / reducedMotion / highContrast / fullscreen)
│  ├─ SelectField           (language / quality)
│  └─ KeybindingRow         (input 分类可编辑键位, mock)
├─ PreviewPill              (本地 preview 标记)
├─ SettingsActions          (保存 / 取消 / 恢复默认)
├─ SaveResultRegion         (pending / accepted / rejected / timeout)
└─ FocusReturnBoundary      (关闭后把焦点还给入口)
```

## 6 只读数据

```ts
interface SettingsProjection {
  readonly source: 'mock' | 'projection';
  readonly revision: number;
  readonly categories: readonly ['display','sound','input','accessibility','language','graphics'];
  readonly current: SettingsValues;
  readonly defaults: SettingsValues;
  readonly allowedIntents: readonly string[];
}
interface SettingsValues {
  readonly displayScale: number;   // mock 1..n
  readonly fullscreen: boolean;
  readonly masterVolume: number;   // mock
  readonly musicVolume: number;
  readonly effectsVolume: number;
  readonly voiceVolume: number;
  readonly uiVolume: number;
  readonly reducedMotion: boolean;
  readonly subtitles: boolean;
  readonly highContrast: boolean;
  readonly language: string;
  readonly quality: string;
}
```

- `current`、`defaults` 和允许值范围来自只读投影；本地不缓存或推断真实保存状态。
- 字段均示例，标注 `source: "mock"`；真实接线只替换 provider 与 intent adapter。

## 7 动作意图

```ts
type SettingsUiIntent =
  | { readonly kind: 'settings.open' }
  | { readonly kind: 'settings.close' }
  | { readonly kind: 'settings.category'; readonly category: string }
  | { readonly kind: 'settings.preview'; readonly patch: Partial<SettingsValues> }
  | { readonly kind: 'settings.save' }
  | { readonly kind: 'settings.cancel' }
  | { readonly kind: 'settings.restore-defaults' }
  | { readonly kind: 'settings.confirm-restore' }
  | { readonly kind: 'settings.retry'; readonly requestId: string };
```

- preview、save、cancel、restore 都走同一 intent 端口；`onSelect`/滑杆 onChange 不得直接写配置或持久化。
- 键位编辑在 input 分类只提交 `input.rebind` 类 intent 的 mock 结果，不做全局冲突裁决以外的改键实现。

## 8 本地 UI 状态

- 允许的本地状态：当前分类、每个字段的本地编辑值（preview）、`pendingRequestId`、保存中/失败中的视觉阶段、恢复默认确认态、焦点索引、reduced-motion 偏好、高对比度预览开关。
- 不允许的本地状态：把 preview 当成已保存、从本地推断默认值、把失败伪装成成功、持有超越投影的授权值。
- 关闭或失败后丢弃过期本地编辑，除非明确保留编辑值用于重试。

## 9 视觉令牌

- 面板使用半透明暗调、断边/斜切、局部阴影和语义色边缘光；分类 tab 当前项用滑块/线条提示。
- 状态色：preview 橙色进行中、rejected/error 红色、stale 灰白/黄说明、accepted 绿色/语义结果；保存成功可短暂绿闪。
- 音量、缩放、质量等量化调项显示数值刻度和当前值标签，不只靠滑块；颜色不是唯一信息。
- 允许程序化光层和既有素材进入面板背景；不使用白底表单、SaaS 设置页或浏览器风格。

## 10 动效绑定

- 分类切换、调项 preview、保存成功、保存失败分别有入场/确认/回弹母题；使用 Framer Motion `AnimatePresence`/`layout`/spring。
- 保存成功后播放确认动画只在该 save 被 accepted 后；保存失败播放回弹和错误提示，不播放成功演出。
- 恢复默认从 defaults 微光回到分类对应字段；reduced-motion 下保留顺序、数值和焦点。
- 动画只重演设置投影结果；本地滑杆移动不代表规则已生效。

## 11 输入无障碍

- 六分类用 Tabs 提供键盘导航；每个分类场可通过 Tab 到达，Enter/Space 激活，关闭/取消用 Esc。
- 滑块用 Radix Slider 支持方向键微调并读出数值；Select 支持方向键与 Enter；开关保持可读开/关和说明。
- 关闭后焦点归还原触发入口；打开时焦点进入当前分类首字段。屏幕阅读器可读出每项 label、当前值、默认值、状态和保存结果。
- 色彩、音量、对比度和字幕都不作为唯一信息源；支持键盘、手柄、触控、读屏、reduced-motion、低闪烁和高对比度。

## 12 加载错误超时

- 设置投影加载中显示带标题 skeleton 和「正在加载设置（mock）」，不伪造当前值。
- preview/save/restore 失败显示明确原因与重试/取消；重试只重发对应 intent，不重复执行写入。
- 保存超时标记 stale，提供重试和「返回并保留待保存编辑」；不把超时当成保存成功。
- resync 或版本过期时丢弃过期分类字段，重新读取 revision，并保留可恢复的本地编辑用于下一步保存。

## 13 明确不做

- 不写库、不持久化、不计算存档权限、不实现真实混音/输入重映射/字体渲染的写入。
- 不新建第二套设置面板、不增加第七分类、不把设置做成网页后台或独立浏览器标签页。
- 不实现编辑器/研究台/素材库/电脑内部 UI；不实现地图、拓扑、寻路、ORCA 或路径成本。
- 不以零素材为验收口径；不删除素材位；不本地推断默认值或保存成功。

## 14 依赖交接

- 依赖 B1/B3 的 `utility-settings` 挂载点、暂停/标题打开入口和焦点归还协议。
- 向 B4-00/overlay stack 交接设置面板的 z-index 与输入仲裁。
- 向 B4-01 交接从设置关闭后回暂停菜单的交换；向 B6 交接全旅程路由的保存失败与安全返回分支。
- 音频/显示/输入的真实端口在接线时实现 provider 与 adapter；本 brief 只传 mock 字段。

## 15 验收条件

- [ ] display/sound/input/accessibility/language/graphics 六个分类与全部 mock 调项可查看、可编辑、可分类切换。
- [ ] preview、保存、取消、恢复默认、保存失败、pending、拒绝、超时和重试均有可演示路径。
- [ ] 保存失败不丢编辑值且保留原因；确认式恢复默认；关闭后焦点归还原入口。
- [ ] 键盘、手柄、读屏可完成六分类和全部调项；焦点陷阱与归还正确。
- [ ] 设置面板为悬浮覆盖层，不使用白底表单/网页后台/第二套路由；零素材不作为验收目标。
- [ ] 相关 TypeScript、Vitest、lint 和文档术语门禁按仓库要求可运行。