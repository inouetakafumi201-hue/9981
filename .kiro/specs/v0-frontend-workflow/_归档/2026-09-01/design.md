# 偷师前端前置设计 Design

## 概述

本设计把 WakeUp UI Prompt Pack 固化为可审计的独立命令合同：每个 `B{n}-00` 与同目录 numbered briefs 是可单独执行的命令包；`Batch 0`、`G-*`、`R-*` 和参考资产只是可选深度附件。它消费权威文档、用户裁决、AI-readable briefs、现有前端项目和参考资产 manifest，生成供 V0.dev 或其他前端生成 AI 直接使用的 UI 壳层合同。它不生成玩法、后端、地图拓扑或规则状态。

允许素材进入壳层；素材缺失只触发确定性、可追踪的语义降级。`editor`、`research-bench`、`material-library`、`computer` 内部 UI 仍 out-of-scope，驻地仅保留入口占位。

## 输入与交付边界

### 输入层

1. 用户裁决与本 spec：决定范围、标题/暂停、HUD 档位、素材口径和完整旅程。
2. B1-B7 各自的 `B{n}-00` 独立命令入口和同目录 numbered briefs：页面的 AI-readable 细节、失败态、意图和交接。
3. 可选深度附件：Batch 0 的 G-01 至 G-08、`R-*`、参考资产 manifest 及 checksum/provenance。
4. 现有前端项目：可读取、复用并在当前命令写锁内直接修改的代码基线。
5. source provenance：只用于追溯、冲突登记和人工复核，不是 AI 隐式依赖或对话记忆。

### 只读/写入边界

- Prompt Pack 目录是只读参考区；本次同步只更新本 spec 允许的五个结构文档。
- UI 生成 AI 以当前 `B{n}-00` 与同目录 briefs 为最小输入，可读取整个现有前端项目，复用已有代码并直接修改；`Batch 0`、`G-*`、`R-*`、参考资产和前序批次输出均是可选深度附件。
- 每个 B 命令拥有独立的命令范围写边界；跨批次依赖以非阻塞交接项表达，不直接修改其他命令交付物。

## 架构

```text
用户裁决 + authority docs + legacy evidence
                    │
                    ▼
       B{n}-00 + same-directory briefs (minimum command packet)
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
  existing UI    optional     handoff refs
  project read   deep docs    (dependsOn)
        │       Batch 0/G/R/assets  (non-blocking)
        └───────────┬───────────┘
                    ▼
          reuse + minimal mount-point completion
                    │
                    ▼
           scoped UI shell change + change report
                    │
                    ▼
       ControlPanelExtractionBoundary → UI ports
```

`dependsOn` is an auditable handoff edge, not an input gate. `executionMode` determines whether a packet can start independently; every `B{n}-00` uses `independent-command`.

### 批次拓扑

```text
B1-00 ──┐
B2-00 ──┤
B3-00 ──┤  independent-command：可单独执行
B4-00 ──┤
B5-00 ──┤
B6-00 ──┤
B7-00 ──┘
  ⋮
dependsOn 仅记录能力交接顺序/参考输出，不阻塞命令启动
  ⋮
Batch 0 / G-* / R-* / assets（可选深度附件）
```

每个 B-00 都以自身入口和同目录 briefs 作为最小投喂包。命令可读取整个现有前端项目，在本命令范围写锁内复用已有代码；缺少挂载点时只做最小补齐，并在改动报告中列明。前序批次的输出只作为非阻塞参考或后续交接，不得变成隐式对话记忆或启动前置。

## 核心组件与接口

### 1. ScopeRegistry

职责：维护 in-scope、out-of-scope、heritage-only 和 source role。

```ts
type ScopeStatus = 'in-scope' | 'out-of-scope' | 'heritage-only';
type SourceRole = 'normative' | 'support' | 'boundary';

interface ScopeEntry {
  readonly id: string;
  readonly status: ScopeStatus;
  readonly reason: string;
  readonly sourceAttachmentIds: readonly string[];
}
```

排除项不能被 PageCatalog、BatchSpec 或 PromptPacket 重新提升为产品页面。

### 2. PageCatalog

职责：登记“基础页目录 + 扩展页目录”的完整 UI surface。目录必须覆盖 G-08，不再用旧的 16 页总数作为完整性判断。

```ts
type PageCatalogTier = 'base' | 'extended';

type UiFamily =
  | 'main-menu'
  | 'battle-hud'
  | 'residence'
  | 'narrative-dialog'
  | 'transition-screen'
  | 'system-notice'
  | 'control-panel'
  | 'utility-panel';

interface PageCatalogEntry {
  readonly id: string;
  readonly tier: PageCatalogTier;
  readonly family: UiFamily;
  readonly batchIds: readonly string[];
  readonly states: readonly string[];
  readonly variantIds: readonly string[];
  readonly sourceAttachmentIds: readonly string[];
  readonly referenceAssetIds: readonly string[];
  readonly baselineStatus: 'available' | 'text-only' | 'pending';
  readonly scopeStatus: 'in-scope';
}
```

基础页至少包括：`menu-title`、`menu-pause`、`hud-main`、`residence-main`、`dialog-line`、`dialog-options`、`transition-dream`、`transition-battle-intro`、`transition-result`、`notice-broadcast`、`notice-toast`、`control-panel-main`、`utility-settings`、`utility-inventory`、`utility-safe`、`utility-match`。

扩展页至少包括：`startup-loading`、`quest-log`、`objective-tracker`、`tutorial-help`、`location-title`、`notification-history`、`stats`、`achievements`、`codex`、`recap`。

`control-panel-main` 是所有页面唯一稳定的切换和抽取入口；PageCatalog 记录页面，不创建第二套路由/导航中心。

### 3. ReferenceAssetManifest

职责：登记可直接投喂和可追溯的参考资产，防止旧视觉或缺失素材被误判为当前合同。

```ts
interface ReferenceAssetManifestEntry {
  readonly assetId: string;
  readonly path: string;
  readonly kind: 'image' | 'text-prompt' | 'audio' | 'other';
  readonly directToAi: boolean;
  readonly pageIds: readonly string[];
  readonly batchIds: readonly string[];
  readonly status: 'available' | 'pending' | 'legacy-reference' | 'missing';
  readonly sourceAttachmentIds: readonly string[];
  readonly usageConstraints: readonly string[];
  readonly checksum: { readonly algorithm: 'sha256'; readonly status: 'verified' | 'pending' | 'mismatch' };
}
```

当前最小 manifest 必须包含 `A-201`、`A-202`、`A-203` 和 `A-301`。A-203 只做 legacy layout 对照并受 0/1/2 文字覆盖；A-301 是标题画面文字提示，标题截图仍 pending。

### 4. AttachmentRegistry 与 Provenance

职责：确保批次入口列出的附件自包含、可解析、可追溯。

```ts
interface AttachmentRecord {
  readonly attachmentId: string;
  readonly path: string;
  readonly directToAi: boolean;
  readonly purpose: string;
  readonly sourceAttachmentIds: readonly string[];
  readonly provenance: readonly ProvenanceRecord[];
}

interface ProvenanceRecord {
  readonly source: string;
  readonly role: SourceRole;
  readonly coveredScopes: readonly string[];
  readonly treatment: 'current-contract' | 'supporting-evidence' | 'boundary-only' | 'heritage-only';
}
```

source copy 不可替代 AI-readable 内容。只给后端路径、类名或内部实现位置的附件不合格。

### 5. BriefSchema

所有 G-* 和 B*-xx brief 共用同一 schema。入口 Prompt 与 numbered brief 都是 15 节完整 brief，不再允许 10 节或 11 节旧模板。

```ts
const REQUIRED_BRIEF_SECTIONS = [
  '页面定位',
  '权威来源（attachmentId / provenance）',
  '当前决策',
  '状态机',
  '组件树',
  '只读数据',
  '动作意图',
  '本地 UI 状态',
  '视觉令牌',
  '动效绑定',
  '输入无障碍',
  '加载错误超时',
  '明确不做',
  '依赖交接',
  '验收条件',
] as const;

interface AiReadableBrief {
  readonly id: string;
  readonly batchId: 'Batch 0' | 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7';
  readonly sections: readonly (typeof REQUIRED_BRIEF_SECTIONS[number])[];
  readonly attachmentIds: readonly string[];
  readonly referenceAssetIds: readonly string[];
  readonly failureStates: readonly ('loading' | 'empty' | 'error' | 'timeout' | 'retry' | 'cancel' | 'safe-return')[];
  readonly selfContained: boolean;
}
```

校验器必须拒绝缺节、乱序、重复 id、空章节、未列附件、孤儿页面、重复页面和未登记 asset id。

### 6. ControlPanelModel 与 UI ports

控制面板支持：

- `switch-page`
- `switch-variant`
- `filter-category`
- `play-state-transition`
- `play-click`

所有动作只改变 UI surface 或播放演示。组件消费 `StatePort`/`UiPorts` 的只读 snapshot，通过 `ActionPort` 提交显式 intent，并等待 `accepted | rejected | stale | timeout` 和下一次 projection。页面本地可以持有 focus、expanded、filter、pagination、animationPhase、reducedMotion、pendingRequestId，但不能持有规则事实。

### 7. BatchPlanner

```ts
interface PromptPacket {
  readonly commandId: string;
  readonly batchId: 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7';
  readonly executionMode: 'independent-command';
  readonly globalSummary: string;
  readonly reuseGuidance: readonly string[];
  readonly writeBoundary: string;
  readonly minimalMountPointCompletion: readonly string[];
  readonly entryPromptPath: string;
  readonly numberedBriefPaths: readonly string[];
  readonly optionalAttachmentIds: readonly string[];
  readonly referenceAssetIds: readonly string[];
  readonly changeReportFields: readonly string[];
}

interface BatchSpec {
  readonly id: 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7';
  readonly objective: string;
  /** Non-blocking capability handoff order; never a command-start prerequisite. */
  readonly dependsOn: readonly string[];
  readonly executionMode: 'independent-command';
  readonly pageIds: readonly string[];
  readonly entryPromptPath: string;
  readonly numberedBriefPaths: readonly string[];
  readonly optionalAttachmentIds: readonly string[];
  readonly referenceAssetIds: readonly string[];
  readonly failureCoverage: readonly string[];
  readonly writeBoundary: string;
  readonly minimalMountPointCompletion: readonly string[];
  readonly acceptanceChecks: readonly string[];
}
```

`PromptPacket` 的最小必备字段让入口在无对话记忆时仍可执行：短全局摘要、已有代码复用、范围写锁、缺失挂载点最小补齐和改动报告均为显式合同字段。`dependsOn` 与 `executionMode` 必须分开校验。

### 8. FullJourneyContract

```ts
interface JourneyNode {
  readonly id: string;
  readonly successNext?: string;
  readonly failureNext: string;
  readonly failureStates: readonly string[];
  readonly safeReturn?: string;
}
```

权威旅程必须覆盖：启动加载失败和安全退出、无存档继续 disabled、匹配取消/超时/失败、影子 relay stale/unavailable、床前就绪取消、装载错误重试/安全返回、intro/enter/return 跳过、断线/重连、结果/奖励错误和原位置缺失。所有转场失败必须回到上下文中的可恢复 surface，不能落到普通 spinner 或无上下文错误页。

## 数据不变量与正确性属性

### 属性 1：独立命令完备与交接无环

Prompt Pack 有 B1-B7 七个独立命令；每个命令均可只用自身入口和同目录 briefs 启动。`dependsOn` 记录能力交接顺序，图无环但不构成命令阻塞；`executionMode` 固定为 `independent-command`。

### 属性 2：brief 15 节闭包

每一份 G-* 和 B*-xx brief 的章节集合严格等于 `REQUIRED_BRIEF_SECTIONS`，顺序、编号和非空性均通过校验。

### 属性 3：自包含附件

每个入口列出的附件路径存在、attachmentId 唯一、`directToAi` 与入口用途一致；source provenance 可追溯但不承担 AI 隐式输入。

### 属性 4：PageCatalog 与 G-08 一致

PageCatalog 至少覆盖 G-08 的全部页面，基础/扩展分层明确；页面 id 无重复、无孤儿，所有页面均映射至少一个批次和一个入口/brief。

### 属性 5：排除域隔离

任何 PageCatalog、BatchSpec、Brief 或 Attachment 都不得把四个 out-of-scope 内部系统、地图拓扑或玩法规则当作正常页面或产品语义。

### 属性 6：控制动作纯呈现

页面、变体、筛选和播放动作只改变 UI 状态；所有业务意图经 port 发送，UI 不直接修改规则事实。

### 属性 7：交互状态闭包

每个可见控件都有 hover/focus/active/disabled/return；错误、拒绝、超时、取消和安全返回均有文字、焦点和可访问反馈。

### 属性 8：HUD 档位冻结

`mvpTiers = [0, 1, 2]`；`+3极限爆发` deferred 且 `selectableInMvp = false`；selection 和 trigger effects 均存在。

### 属性 9：完整旅程失败闭包

完整 route 的每个加载/等待/转场/提交节点均有适用的 loading/empty/error/timeout/retry/cancel/safe-return 分支；成功和失败均不丢失原页面上下文。

### 属性 10：素材 manifest 可追溯

A-201/A-202/A-203/A-301 均登记用途、状态、约束、source provenance 和 checksum 状态；pending/legacy 不得被报告为当前成品基线。

## 错误处理

1. **命令缺件**：缺少某个 B-00 入口或其同目录 numbered brief 时，该命令报告 incomplete，不猜测补齐；缺少可选 Batch 0/G-*/R-*/资产只报告深度附件未挂载，不阻塞命令。
2. **15 节漂移**：章节缺失、乱序、重复或空内容时，入口和 brief 校验失败。
3. **附件不可解析**：路径不存在、attachmentId 重复、directToAi 冲突或只有 backend path 时，报告 attachment error。
4. **来源冲突**：记录 conflict/open 或 resolved-for-prompt；不得静默使用 legacy 版本。
5. **PageCatalog 漂移**：G-08 新页面未登记、旧“16 页”仍作为全量声明或页面没有 batch/brief 映射时，报告 catalog error。
6. **旅程失败态缺失**：节点无 retry/cancel/safe-return 或失败路径脱离上下文时，报告 journey coverage gap。
7. **HUD 档位泄漏**：+3 可选或 selection/trigger 缺一时，battle HUD 批次 incomplete。
8. **素材缺失**：保留 assetId、语义容器和可读诊断，使用正确类别 fallback；不得借用错误素材或以零素材完成。
9. **门禁失败**：任何 tsc、vitest、lint、verify:docs 或静态 Pack 校验失败，都必须在 execution-report.md 写实际结果和阻塞项。

## 测试与门禁策略

### 静态 Prompt Pack 校验

建议校验器覆盖：

- 每个 `B{n}-00` 的 `PromptPacket` 字段：`globalSummary`、`reuseGuidance`、`writeBoundary`、`minimalMountPointCompletion`、`changeReportFields` 和 `executionMode`，并校验它们非空。
- `dependsOn` 只校验为非阻塞交接引用，不得校验为命令启动前必须投喂的附件。
- 每个 B-00 入口的同目录 numbered briefs 和可选附件清单；若投喂 Batch 0/G-*/R-*/资产，则校验其路径、ID、directToAi、provenance 和 checksum。
- PageCatalog 与 G-08 的页面 id、batch、family 和失败态映射。
- 参考资产 manifest 的路径、状态、directToAi、provenance 和 checksum 状态。
- out-of-scope 词汇泄漏、旧 4 档恢复、+3 可选、zero-material framing 和 backend-only reference。
- 完整旅程成功/失败/重试/取消/安全返回闭包。

### 代码与项目门禁

本次文档同步不修改 `src/`，但收尾仍应按项目纪律报告：

```bash
npx tsc --noEmit
npx vitest run
npm run lint
npm run verify:docs
```

若环境或现有工作树导致命令未能运行，execution-report.md 必须如实记录；不能把历史执行结果冒充本次结果。
