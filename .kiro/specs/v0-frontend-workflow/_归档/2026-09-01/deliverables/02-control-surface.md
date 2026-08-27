# 偷师前端 · 设计定稿 02：控制面板模型 / Prompt Pack 合同

> 归属：`.kiro/specs/v0-frontend-workflow` · 交付物
> 依据：requirements §3/§4/§7/§9/§12；G-01 至 G-08
> 状态：结构同步（2026-08-20）

## 一、ControlPanelModel

控制面板是唯一稳定的切换面、演示面和抽取面。它只改变 UI surface 或视觉播放，不执行玩法。

### 1.1 类别筛选

| categoryId | 覆盖页面 |
|---|---|
| `cat-menu` | `menu-title`、`menu-pause`、`startup-loading` |
| `cat-hud` | `hud-main` |
| `cat-residence` | `residence-main`、`utility-match` |
| `cat-narrative` | `dialog-line`、`dialog-options`、`quest-log`、`objective-tracker` |
| `cat-transition` | `transition-dream`、`transition-battle-intro`、`transition-result`、`location-title` |
| `cat-notice` | `notice-broadcast`、`notice-toast`、`tutorial-help`、`notification-history` |
| `cat-control` | `control-panel-main` |
| `cat-utility` | `utility-settings`、`utility-inventory`、`utility-safe`、`stats`、`achievements`、`codex`、`recap` |

筛选只作用于呈现；被隐藏的页面不卸载权威状态，也不创建第二套路由中心。

### 1.2 页面切换

PageCatalog 的基础页与扩展页均可通过 `control-panel-main` 挂载。切换是 UI surface 替换/呈现切换，不得渲染为角色移动、地图遍历、节点跳转或玩法推进。

### 1.3 变体切换

| pageId | 变体 |
|---|---|
| `hud-main` | `standard` / `solo` / `minimal` |
| `dialog-line`、`dialog-options` | `with-portrait` / `no-portrait` |
| `transition-dream` | `enter-dream` / `return-home` |
| `menu-title`、`menu-pause` | `title` / `pause` |
| `quest-log` | `list` / `detail` |
| `notification-history` | `today` / `yesterday` / `earlier` |
| `stats`、`achievements`、`codex`、`recap` | archive tab variants |

变体是呈现变体，不是玩法变体；切换不改规则状态。

### 1.4 动画播放

| action kind | 触发 | 示例 |
|---|---|---|
| `play-state-transition` | 已确认 UI 状态变化 | 启动加载完成、匹配完成、入梦、返回、任务投影重排 |
| `play-click` | 用户点击/Enter/手柄确认 | 按钮回弹、选项选择、滑块推动、关闭反馈 |

两类播放必须有独立演示入口，展示 event id、semantic id、当前阶段、fallback 和 settled 结果；演示不改规则投影。

## 二、动作约束

| actionId | kind | visualResponse | nonTargetBehavior |
|---|---|---|---|
| `act-page-title` | switch-page | 标题场景从黑幕/环境层中显现，入口逐项落位 | 不写启动或存档事实 |
| `act-page-startup-loading` | switch-page | 加载层轮廓和状态文字显现 | 不伪造连接成功 |
| `act-page-hud` | switch-page | HUD 从目标方向进入，旧 surface 余辉回收 | 不移动实体、不推进回合 |
| `act-page-quest-log` | switch-page | 任务日志从 `J`/触发点进入 | 不创建或完成任务 |
| `act-page-archive` | switch-page | archive tab 局部切换并保留焦点 | 不写统计、成就或图鉴 |
| `act-variant-solo` | switch-variant | HUD 重排为单行呈现 | 不改变玩法模式 |
| `act-filter-hud` | filter-category | 仅显示 HUD 类页面 | 其他页面不卸载状态 |
| `act-play-state-transition` | play-state-transition | 控制面板播放指定状态演出 | 不结算、不提交规则 |
| `act-click-pulse` | play-click | 当前控件短促高光和回弹 | 不把 click 当业务确认 |

所有可见控件必须具备 hover/focus/active/disabled/return。placeholder-only 交互只更新本地呈现；真实交互只提交显式 intent，并等待 `accepted/rejected/stale/timeout`。

## 三、抽取边界

1. 每个 PageSurface 由 `control-panel-main` 统一挂载；页面不持有全局导航。
2. 页面导出稳定签名：`pageId` + `variantId` + `stateId` + `projectionRevision`。
3. 动画命令由控制面板/`MotionCoordinator` 统一分发，不散落为隐藏规则回调。
4. 抽取时只替换 fixture provider 和 intent adapter；组件树、命名、五态、失败态和动效入口保持稳定。
5. `editor`、`research-bench`、`material-library`、`computer` 不得作为正常页面或导航项进入抽取结果。

## 四、Prompt Pack 与附件合同

### 4.1 Batch 0 全局附件

每个 B1-B7 入口第一组附件固定为：

- `G-01-project-and-scope-contract.md`
- `G-02-visual-token-contract.md`
- `G-03-ui-port-contract.md`
- `G-04-interaction-accessibility.md`
- `G-05-motion-audio-fallback.md`
- `G-06-mock-data-fixtures.md`
- `G-07-conflict-register.md`
- `G-08-page-and-batch-index.md`

入口还必须列该批次 numbered briefs、直接 AI-readable 附件、参考资产和失败态覆盖。source provenance 只作为 `attachmentId` + provenance 记录，不要求 AI 读取 source copy。

### 4.2 自包含性检查

每项附件至少提供：

```ts
interface PromptAttachmentCheck {
  readonly attachmentId: string;
  readonly path: string;
  readonly directToAi: boolean;
  readonly purpose: string;
  readonly sourceRole: 'normative' | 'support' | 'boundary';
  readonly checksumStatus: 'verified' | 'pending' | 'mismatch';
  readonly pathStatus: 'exists' | 'missing';
}
```

缺路径、重复 attachmentId、只给 backend path、缺用途、缺 source role 或 checksum 未登记时，批次不得报告为 complete。

### 4.3 固定 15 节 brief

所有 G-* 和 B*-xx（入口 Prompt 与 numbered brief）严格使用以下 15 节，编号和顺序不可改变：

1. 页面定位
2. 权威来源（attachmentId / provenance）
3. 当前决策
4. 状态机
5. 组件树
6. 只读数据
7. 动作意图
8. 本地 UI 状态
9. 视觉令牌
10. 动效绑定
11. 输入无障碍
12. 加载错误超时
13. 明确不做
14. 依赖交接
15. 验收条件

任何入口或 numbered brief 缺一节、章节为空、章节顺序漂移，均标记 incomplete。

## 五、HUD 爆发档位

```ts
const burstSelector = {
  mvpTiers: [0, 1, 2] as const,
  deferredTier: {
    id: '+3极限爆发',
    status: 'deferred' as const,
    selectableInMvp: false,
    futureEvaluationOnly: true,
  },
  selectionEffect: 'burst-selection-effect',
  triggerEffect: 'burst-trigger-effect',
  selectionMode: 'discrete' as const,
};
```

- `+3极限爆发` 不进入可选列表、不响应确认、不提交 intent；如保留槽位，显示 deferred/不可选。
- selection effect：0 静置灰白，1 轻微充能，2 粒子残影与色浓度递增。
- trigger effect：确认投掷时爆闪、一次性粒子爆发和横条生长；只在宿主允许的视觉演示中播放。
- `A-203` 的旧 4 档视觉只作 layout/legacy reference，不覆盖上述文字合同。

## 六、完整旅程失败态合同

控制面板演示或 B6 集成必须覆盖以下节点和回退：

| 节点 | 成功 | 必须可见的失败/恢复 |
|---|---|---|
| `startup-loading` | 进入标题 | loading 超时、连接错误、retry、safe-return |
| `menu-title` | 新游戏/继续进入驻地 | 无存档 continue disabled、退出确认、启动错误 |
| `residence-main` | 打开锚定导流仪/入口 | 空状态、端口不可用、素材错误、关闭回焦点 |
| `utility-match` | matching → ready/shadow | cancel、timeout、failed、relay stale/unavailable、retry |
| `bed-front-ready` | 确认床A装载 | cancel、门控拒绝、目标床错误 |
| `transition-battle-intro` | 进入入梦 | load-failed、asset missing、skip、return |
| `transition-dream` | enter-dream / return-home | timeout、skip、asset fallback、origin missing |
| `hud-main` overlays | pause/settings/narrative/notice | disconnect、reconnect、intent rejected/timeout |
| `transition-result`/reward | continue → return-home | result/reward projection error、retry、safe-return |
| `residence-main` return | 原位置落地 | returnOrigin missing、recoverable return point |

错误/空态要保留环境、实体和触发上下文；不能退化为普通 spinner、网页 404、无上下文技术日志或错误素材拼贴。

## 七、无障碍与素材原则

- 所有控件支持鼠标、触控、键盘、手柄和读屏的等价 intent 路径。
- Radix 或等价原语管理 Dialog、Menu、Tooltip、FocusScope、Toast 和 live region；焦点关闭后回到触发源。
- 同屏选择、通知栈和错误动作组不超过 5；超出分页、滚动或分组。
- 颜色不是唯一语义；状态同时提供文字、图标、形状或 aria 描述。
- 允许 assetRef/assetId 挂接实际资产。失败时保留语义位置、名称和诊断，按同语义 fallback；不以“零素材”作为实现或验收叙事。
