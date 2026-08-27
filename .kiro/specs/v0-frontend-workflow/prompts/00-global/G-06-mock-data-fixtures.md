# G-06 UI Mock 数据与状态 Fixture

## 1 页面定位

给 AI 一组可直接渲染的展示数据。所有对象都是 `mock`，用于构建组件、状态和交互，不代表后端规则。

## 2 权威来源（只写 attachmentId / provenance）

- `frontend-port-contract` / `00-global/G-03-ui-port-contract.md`：字段来源和 intent 结果。
- `hud-visual-baseline` / `references/assets/A-201-hud-refined2.png`：HUD 空间参考。
- `rpg-guidance` / `presentation-rpg-07`：信息页面类别。

## 3 当前决策

Fixture 必须显式包含 `source: "mock"`；数值只用于视觉展示。玩家可见资源值遵守 1–5，实体数/回合号等结构值可例外。

## 4 状态机

每个 fixture 带 `screenState`，示例状态：`idle`、`loading`、`empty`、`ready`、`pending`、`rejected`、`timeout`、`error`、`safe-return`。

## 5 组件树

Fixture 按 `menu`、`residence`、`hud`、`dialog`、`notice`、`settings`、`utility`、`rpg` 分组，组件只读取自身所需子树。

## 6 只读数据

```typescript
const mockFixture = {
  source: 'mock' as const,
  revision: 1,
  menu: { hasSave: false, selected: 'new-game' },
  player: { id: 'p1', name: '玩家A', hp: 5, sp: 3, ap: 2 },
  turnOrder: [{ id: 'p1', rank: 1, hp: 5, sp: 3, acted: false }, { id: 'p2', rank: 2, hp: 4, sp: 5, acted: true }],
  actions: [
    { id: 'action-move', label: '移动', cost: 1, costKind: 'AP', available: true, reason: null, intent: 'battle.select-action' },
    { id: 'action-inspect', label: '检查', cost: 0, costKind: 'AP', available: true, reason: null, intent: 'battle.select-action' },
    { id: 'action-blocked', label: '攻击', cost: 2, costKind: 'AP', available: false, reason: '当前状态不可用', intent: 'battle.select-action' }
  ],
  targets: [{ id: 'target-a', label: '目标A', intent: 'hostile-interaction', available: true }, { id: 'target-b', label: '目标B', intent: 'hostile-interaction', available: false, reason: '不可见' }],
  residence: { matchedMode: 'competitive', bedA: 'ready', bedB: 'deferred', bedC: 'self-test-only', matching: 'idle' },
  dialog: { speaker: 'e:npc_001', displayName: '？？？', text: '这是展示用文本。', imageRef: 'asset:portrait-placeholder', voiceRef: null },
  notifications: [{ id: 'notice-1', type: 'system', priority: 'normal', title: '系统提示', body: '展示用通知。', read: false }],
  settings: { displayScale: 1, fullscreen: true, masterVolume: 0.8, musicVolume: 0.6, effectsVolume: 0.7, voiceVolume: 0.8, uiVolume: 0.7, reducedMotion: false, subtitles: true, highContrast: false, language: 'zh-CN', quality: 'balanced' }
};
```

## 7 动作意图

Fixture 中的 `intent` 只是 UI 绑定名；点击后生成 request，不直接修改 fixture。示例：`menu.new-game`、`settings.preview`、`residence.start-match`、`battle.select-target`、`dialog.choose`。

## 8 本地 UI 状态

允许对 fixture 做筛选/排序/展开/分页的视图变换；禁止把视图变换写回 mock 规则字段。

## 9 视觉令牌

按 G-02；不可用对象同时显示 icon/text reason，不只变灰。

## 10 动效绑定

fixture 状态变更触发 state-transition；点击触发 click-play；pending/rejected/timeout 使用不同但可读的反馈。

## 11 输入无障碍

每个 fixture 控件配 label、description、shortcut 和 disabled reason；同一数据可由鼠标、键盘和手柄操作。

## 12 加载错误超时

附带 fixtures：`loading`、`empty`、`error`、`retrying`、`safe-return`，供 AI 生成完整路径。

## 13 明确不做

不从 mock 数值推导伤害、路径、AP 结算、AI 决策或真实经济。

## 14 依赖交接

接线时只替换 fixture provider 和 intent adapter；组件树、字段名、状态视觉保持稳定。

## 15 验收条件

所有主要页面至少有 ready、empty、error 和 pending fixture；数据源标签可见/可审计；没有写规则的回调。