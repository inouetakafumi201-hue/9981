# B3-02 Match Shadow Lobby Brief

## 1 页面定位

- 本 brief 定义锚定导流仪的竞技匹配体验与 `residence-main` 内的影子大厅叠加。
- 匹配是异步、可见、可取消的状态，不是等待页面；匹配期间玩家继续在出租屋漫游和使用非冲突端口。
- 匹配完成不加载独立大厅场景，而在原出租屋中展示已就绪玩家的半透明影子；只读中继投影决定影子是否存在。
- MVP 只服务床A竞技。床B不参与匹配，床C仅自测、不参与匹配或正式入局。

## 2 权威来源（只写 attachmentId/provenance）

- attachmentId: `ops-residence-flow-03`
  provenance: `anchor-device-match-ready-shadow-lobby-no-scene-reload-and-bed-gate`
- attachmentId: `ops-outside-growth-01`
  provenance: `async-match-do-not-lock-roaming-visible-cancellable-ready-prompt`
- attachmentId: `presentation-implementation-09`
  provenance: `match-state-bed-highlight-shadow-overlay-and-residence-motion`
- attachmentId: `presentation-animation-feedback-02`
  provenance: `authority-projection-presentation-only-and-resource-fallback`
- attachmentId: `user-residence-mvp-gate-20260820`
  provenance: `competitive-bed-a-only-match-target-and-no-bed-b-c-match`

## 3 当前决策

- 锚定导流仪的 MVP 模式列表只有「竞技」；不呈现可选择的联机副本、房主、开房或其他模式。
- `start-competitive-match` 提交后显示 `matching`，玩家仍可在出租屋走动；取消入口始终可见且可访问。
- 匹配完成只点亮对应床。在 MVP 的唯一合法目标是床A，匹配完成绝不点亮床B或床C。
- 影子大厅不重载场景、不生成统一集体大厅、不把玩家搬离当前出租屋；其他就绪玩家作为半透明影子出现在原场景。匹配完成后床前就绪交接给 `return-home` 对称的装载/返回链。
- 影子只表现权威中继快照；本地不伪造玩家名称、准备状态、队伍人数或匹配成功。
- 影子大厅的表现允许素材：影子角色可使用角色管线资产并由代码降低不透明度、加轮廓和粒子，不得用“无素材”作为设计目标。

## 4 状态机

```text
anchor-idle
  -> anchor-panel-open
  -> matching
  -> matching-roaming
  -> match-complete
  -> target-bed-a-lit
  -> shadow-lobby-visible
  -> bed-front-ready

matching -> match-cancelled -> anchor-idle
matching -> match-timeout -> anchor-idle
matching -> match-failed -> anchor-error
shadow-lobby-visible -> shadow-lobby-stale -> shadow-lobby-visible
```

- `matching-roaming` 是匹配状态与漫游状态的并集，不是页面跳转。
- `match-complete` 只有在投影明确给出竞技匹配完成且 `targetBed === 'bed-a'` 时才进入。
- `targetBed !== 'bed-a'` 的快照在 MVP 中进入诊断/拒绝分支，不得点亮其他床。
- 影子中继过期只影响影子可见性和提示，不撤销已确认的床A就绪事实；具体权威撤销由外部投影给出。

## 5 组件树

```text
MatchShadowLobbyRoot
├─ AnchorDevicePanel
│  ├─ CompetitiveModeOnlyRow
│  ├─ MatchRuleSummaryMock
│  ├─ MatchStateIndicator
│  ├─ StartMatchIntentButton
│  └─ CancelMatchIntentButton
├─ ResidenceRoamPassthrough
├─ MatchStatusOverlay
│  ├─ MatchingRibbon
│  ├─ MatchTimeoutNotice
│  └─ MatchErrorNotice
├─ ShadowLobbyOverlay
│  ├─ ShadowParticipantLayer
│  │  └─ ShadowParticipantSprite
│  ├─ ReadyPresenceLabels
│  ├─ RelayFreshnessIndicator
│  └─ ShadowLobbyNotice
└─ TargetBedHighlight
   └─ BedAReadyBeacon
```

## 6 只读数据

```ts
interface MatchProjectionMock {
  readonly mode: 'competitive';
  readonly state: 'idle' | 'matching' | 'complete' | 'cancelled' | 'timeout' | 'failed';
  readonly matchId: string | null;
  readonly targetBed: 'bed-a' | null;
  readonly readyParticipants: ReadonlyArray<{
    readonly id: string;
    readonly displayName: string;
    readonly positionId: string;
    readonly ready: boolean;
    readonly shadowAssetId: string;
    readonly mock: true;
  }>;
  readonly relay: { readonly state: 'fresh' | 'stale' | 'unavailable'; readonly updatedAt: number; readonly mock: true };
}
```

Mock 样例：`{ mode: 'competitive', state: 'matching', matchId: 'mock-match-01', targetBed: null, readyParticipants: [], relay: { state: 'fresh', updatedAt: 0, mock: true } }`；完成样例为 `targetBed: 'bed-a'`、两名 `ready: true` 的半透明影子参与者。

- `displayName`、`ready`、位置和时间戳均是只读 mock 投影，不能在本地点击中直接改写。
- 匹配规则摘要可展示，但不把规则执行细节、队伍权限或算法伪装成已实现功能。

## 7 动作意图

- `open-anchor-panel`：聚焦锚定导流仪并显示竞技模式。
- `start-competitive-match`：提交竞技匹配请求。
- `cancel-match`：提交取消请求。
- `continue-roaming`：关闭非阻塞提示，保持出租屋漫游输入。
- `inspect-match-status`：打开当前匹配/中继摘要。
- `focus-shadow-participant(participantId)`：显示影子玩家的 mock 名称和就绪状态。
- `ready-at-bed-a`：从床A亮起状态进入床前就绪。
- `retry-match`：匹配超时或失败后提交重试意图。
- `dismiss-shadow-notice`：关闭提示，不删除影子投影。

## 8 本地 UI 状态

- 锚定导流仪：`closed`、`open`、`matching`、`complete`、`cancel-pending`、`error`。
- 匹配提示：`quiet`、`visible`、`timeout`、`failure`；可关闭但不停止匹配，停止必须明确使用取消意图。
- 漫游通道：`available` 在 `matching` 期间保持可用；`blocked` 仅在真实装载过渡开始后出现。
- 影子：`hidden`、`present`、`participant-focused`、`stale`、`unavailable`；`stale` 不得伪装成 fresh。
- 床A：匹配完成时 `locked -> lit`；床B继续 `deferred-disabled`，床C继续 `self-test-only`。
- 五态适用于按钮、节点、影子焦点标签和状态条；影子本身不是可提交玩法动作。

## 9 视觉令牌

- 匹配进行中使用橙色进行中语义；成功和床A可就绪使用绿色/蓝色组合；错误使用红色；延迟/中继过期使用灰；影子轮廓使用纯白/灰白低不透明度。
- 锚定导流仪保留黑色科技机箱素材和局部彩色投影 UI，房间背景与实体仍可见。
- 床A完成后只出现蓝色高光、可读轮廓和床前提示；床B不得出现同类高光；床C保留青色自测识别但不得出现「可入局」视觉。
- 影子参与者使用合法角色素材的半透明版本、柔和白轮廓和低密度粒子；素材缺失显示带 assetId 的诊断，不使用另一角色冒充。
- 不用统一大厅墙、房间列表、队伍卡片墙或独立网页式 matchmaking screen。

## 10 动效绑定

- 打开锚定导流仪用局部聚焦和半透明投影层；匹配中用低频呼吸、状态条脉冲和短促确认反馈。
- 匹配中关闭面板或走开时，状态条可缩为房间内小提示，漫游继续；不能使用全屏遮罩锁住画面。
- 匹配完成用状态条收束、床A局部光显影和一条短提示；只更新 `targetBed` 对应实体。
- 影子进入使用 `AnimatePresence`、低幅度透明度/位置收敛和轮廓粒子；影子离开以淡出和位置回收表达，不切换场景。
- 中继 stale 使用减弱轮廓、短暂诊断条和无障碍文字，不用闪烁制造紧急感。
- `reduced-motion` 关闭粒子和大幅脉冲，保留色彩、文字、声音字幕和床A最终高亮。

## 11 输入无障碍

- 锚定导流仪面板使用可访问的单选模式，只有「竞技」可选；所有 mock 规则摘要可被读屏读取。
- 匹配开始后焦点回到房间输入或状态条，不停留在隐藏的面板控件；取消按钮可随时通过 Tab/快捷键访问。
- live region 宣布「竞技匹配已开始」「匹配仍在进行，可继续漫游」「床A已点亮」「影子大厅中继暂不可见」。
- 影子参与者标签提供文本名称和 ready 状态；不能只通过透明度区分影子或只靠颜色表达目标床。
- Escape 关闭状态详情而不隐式取消匹配；取消必须由有标签的 cancel action 提交。
- 所有按钮具备 hover/focus/active/disabled/return，焦点环在低饱和场景上保持足够对比。

## 12 加载错误超时

- 匹配超时 mock：显示「匹配超时」，保留重试和取消；不自动点亮床A。
- 匹配失败 mock：显示失败原因和重新打开锚定导流仪意图；不创建影子、不显示成功。
- 中继 stale：显示最后一次更新时间和「影子状态暂不可确认」；不以空列表代替明确的不可用状态。
- 影子资产加载失败：单个参与者显示语义化轮廓/名称与 assetId 错误，其他影子不被错误替换；不影响已确认的床A点亮。
- 任何异常不重载出租屋、不阻塞漫游、不写本地匹配事实；服务器/权威侧恢复后由新投影刷新。

## 13 明确不做

- 不做真实匹配算法、房间协议、队伍权限、房主开房、统一大厅场景或真实网络中继。
- 不显示床B可匹配入口，不显示床C正式入局入口，不允许通过手动改 URL/快捷键绕过目标床门控。
- 不锁住等待界面，不强制玩家原地站在锚定导流仪旁等待。
- 不用本地计时器宣称匹配成功，不本地生成参与者，不把影子状态写回规则层。
- 不创建网页化的玩家列表/卡片墙，不以纯色圆点替代可见素材影子。

## 14 依赖交接

- 从 B3-01 接收节点输入、漫游通道、`anchor-device`、`bed-a`/`bed-b`/`bed-c` 的稳定命名和 `assetId`。
- 向 B3-03 交接 `targetBed: 'bed-a'`、`matchId`、`readyParticipants`、`returnOrigin` 和 `ready-at-bed-a` intent。
- 向 B3-04 交接 `timeout`、`failed`、`relay.stale/unavailable`、影子素材错误等 UI 状态和错误文案。
- 依赖 B1 的状态 store/控制面板挂载、Radix 可访问原语、Framer Motion 和全局语义 token。
- 依赖运营侧的只读匹配与中继端口；不要求任何内部匹配数据形状或直接写入。

## 15 验收条件

- [ ] 锚定导流仪只显示竞技模式，开始匹配后仍可在出租屋漫游。
- [ ] 匹配中有可取消、可聚焦、可读屏的状态提示，不出现阻塞式等待页面。
- [ ] 完成投影只点亮床A；床B仍后置不可点，床C仍只可自测。
- [ ] 匹配完成不重载场景，能在原房间看到合法素材渲染的半透明影子大厅。
- [ ] 中继 fresh/stale/unavailable、匹配超时、失败和影子素材加载错误均有明确呈现。
- [ ] 影子信息来自只读 mock 投影，不能通过本地点击伪造参与者或匹配结果。
- [ ] 五态、键盘操作、live region、reduced-motion 和非颜色状态提示可验证。
- [ ] 相关 TypeScript、Vitest 和 lint 门禁通过；实现不修改本 brief 以外的目录。
