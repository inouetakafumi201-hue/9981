# R-07 排除系统边界重写 brief

## 1 页面定位

本 brief 只定义前端生成 AI 必须如何处理四类内部系统边界：`editor`、`research-bench`、`material-library`、`computer`。它们不是本次产品 UI 的可生成页面，而是驻地里的入口语义、只读摘要和安全返回边界。生成 AI 可以渲染一个入口节点/占位、状态标签或“进入独立界面”的 intent，但禁止投喂、复制或推断这些系统的内部 UI。

本边界与驻地、journey、控制面板抽取的壳层相容：用户仍能知道有这些入口、它们承担什么职责、为什么当前不可进入，但生成结果不得出现三栏编辑器、词条/锻造、素材卡库检索、电脑应用港湾或任何内部字段。

## 2 权威来源（attachmentId/provenance）

- `G-01-project-and-scope-contract`：四类内部页面 out of scope，驻地只留入口占位。
- `G-02-visual-token-contract`：视觉基线和素材允许，不得用错误风格补齐内部页面。
- `G-03-ui-port-contract`：只读摘要、intent callback 和 adapter 边界。
- `G-04-interaction-accessibility`：占位入口仍需可聚焦、可读和可取消。
- `G-05-motion-audio-fallback`：入口反馈和资源缺失 fallback。
- `operations-residence-03` / `references/source/operations-residence-03.md`：研究台/造梦舱/电脑/书架职责与驻地入口。
- `operations-safe-library-04` / `references/source/operations-safe-library-04.md`：书架/保险箱/门缝分工。
- `operations-narrative-evidence-05` / `references/source/operations-narrative-evidence-05.md`：电脑承载应用、证据入口但内部机制边界。
- `bench-v0` / `references/source/bench-v0.md`：历史/遗留研究台内部需求，provenance only，不能 directToAi。
- `material-library-v0` / `references/source/material-library-v0.md`：历史/遗留素材库内部需求，provenance only，不能 directToAi。
- `map-editor-iteration-v2` / `references/source/map-editor-iteration-v2.md`：历史/遗留编辑器内部需求，provenance only，不能 directToAi。
- `pixel-painter-v0` / `references/source/pixel-painter-v0.md`：独立像素绘制器历史/专项边界，不能因引用而进入本 brief。

## 3 当前决策

| 入口 | 只允许在产品 UI 表达 | 严禁生成/投喂 |
|---|---|---|
| `editor` / 造梦舱 | 节点名称“地图编辑器”、职责摘要、可用/不可用、进入/返回 intent | 三栏工作台、SVG 画布、场景框/连线、诊断列表、MapData 字段、编辑工具、路径几何 |
| `research-bench` / 研究台 | 节点名称“研究台”、素材级加工职责摘要、状态、进入/返回 intent | 词条库、5 槽锻造、合成仪式、塑形栏、合成队列、LLM 处理细节、内部资产字段 |
| `material-library` / 书架 | 节点名称“梦境素材库”、创作资源检索职责摘要、状态、进入/返回 intent | 素材卡片网格、搜索/筛选、蓝本 tab、快捷栏、拥有权、词条详情、绘制贴图 |
| `computer` / 电脑 | 节点名称“梦核多应用台”、查看/管理元状态职责摘要、应用入口占位、状态、进入/返回 intent | 套餐、活动领取、个人面板、证据提交 VR、LLM 采访、账号/经济字段、应用内部页面 |

研究台、素材库、编辑器三界面是后续的独立全屏切换链；电脑是独立应用港湾。它们职责两两不可混同，生成 AI 不用“万能工具”“后台工作台”“仓库”统称。

## 4 状态机

占位入口：`visible → focused → opened-intent → pending → accepted | rejected | unavailable | timeout → safe-return`。

- `placeholderOnly=true` 时，接受只意味着请求外部独立页面，当前 shell 不展开内部组件。
- 入口不可用：`visible → disabled → reason`，不进入内部 mock。
- 安全返回：`external-pending/error → safe-return → source-page`。
- 若真实接线暂缺：`unwired → explanatory-placeholder → retry | back`。

## 5 组件树

`ResidenceOrJourneySurface → ExcludedSystemEntryGroup → ExcludedSystemEntry → EntryStatusBadge + ResponsibilitySummary + AvailabilityReason + OpenExternalButton + BackButton`。

可选 `ExcludedSystemNotice` 是统一的说明 overlay；它只呈现职责、当前状态、接线情况和下一步，不呈现内部字段。四类入口共享一个组件，不为每个系统复制一份“简化内部页”。

## 6 只读数据

```ts
interface ExcludedEntryView {
  id: 'editor' | 'research-bench' | 'material-library' | 'computer';
  displayName: string;
  responsibility: string;
  availability: 'available' | 'disabled' | 'unwired' | 'error';
  disabledReason?: string;
  placeholderOnly: true;
  source: 'mock' | 'projection';
  revision: number;
}
```

允许读取入口 label、职责摘要、状态、错误原因、`returnPageId` 和 `externalRouteKey`。禁止读取/显示内部列表、字段路径、真实资产拥有权、诊断细节、账号经济、MapData、TokenData、BlueprintData 或任何后端类名/目录。

## 7 动作意图

统一使用 `excluded.open`，payload 为 `{entryId, returnPageId}`；回退使用 `navigate.back`；不可用入口使用 `excluded.explain`；重试使用 `excluded.retry`。进入内部系统后由独立宿主处理，不在当前组件写 `switchScene` 的内部实现或假装成功。

占位入口可以产生 `requestId`，结果只有 `accepted`（外部路由已接管）、`rejected`、`unwired`、`timeout`。不要用按钮 onClick 直接把内部 UI 渲染到当前页面，也不要用本地状态推断可用性。

## 8 本地 UI 状态

允许 hover、focus、selected、entryNoticeOpen、pendingRequestId、returnPageId、animationPhase、reducedMotion 和 errorExpanded。禁止本地持有系统内数据、编辑草稿、素材拥有量、套餐余额、证据提交结果、地图诊断或账号状态。入口摘要不能因本地点击改成“已完成/已拥有”。

## 9 视觉令牌

- 四个入口遵循驻地全局语义：editor/research-bench/material-library/computer 均是创作/工具/管理相关，但不使用新主色；可用青色边缘光表示创作/交流来源，locked/disabled 用灰白扁平+锁/原因。
- 每个入口用一个静态承载物或登记素材的轮廓/剪影，加名称和职责；不做四个内部界面截图拼贴。
- `placeholderOnly` 明确显示为入口占位、外部页面或待接线；不使用“正在编辑”“库已加载”“账户余额”等内部假数据。
- 避免 SaaS dashboard、工程 IDE、仓库网格和多应用窗口，保留像素前景+全息驻地氛围。

## 10 动效绑定

- 入口 hover/focus 只做边缘高光、局部反光、轻微上浮；点击只显示 pending/transition。
- 外部页面切换由宿主选择页面级淡入/侧滑；当前占位组件不播放合成、编译、搜索、诊断或保存成功演出。
- rejected/unwired/timeout 使用震动回弹、红/灰白提示和回到触发入口，不播成功动画。
- reduced motion 保留入口名称、职责、状态和返回路径，去除位移/闪烁/粒子。

## 11 输入无障碍

入口必须是语义按钮/链接，不用不可访问的 div。Tab 顺序为入口名称→职责/状态→打开→返回；Enter/Space 打开或确认，Esc 关闭说明 overlay，手柄/触控有等价操作。屏幕阅读器读出“内部页面不在当前壳层”“可用/不可用”“原因”“将打开独立页面”等状态。颜色之外用文字、图标和形状表达。

## 12 加载错误超时

外部切换请求显示“正在打开独立页面”；超时给重试/返回。入口数据缺失显示通用“状态未连接”并保留名称/职责，不把空数据渲染成内部页面。静态入口素材缺失用轮廓/图标/文字占位；不删除入口位。接线不兼容时安全返回来源页。

## 13 明确不做

不做 editor 的画布/图层/场景/诊断，不做 research-bench 的词条/锻造/合成/塑形，不做 material-library 的检索/详情/蓝本/快捷栏，不做 computer 的套餐/活动/证据/LLM/账号应用。禁止从 `references/source` 历史正文复制内部 UI；禁止把 source 文档中的实现路径、TypeScript 接口、后端字段投喂给生成 AI。禁止把占位入口扩成可工作的伪系统。

## 14 依赖交接

各系统 owner 只需提供稳定的 `ExcludedEntryView`、`excluded.open` intent 和外部 route adapter；内部系统用自己的专项 brief、端口和素材管线交接。当前壳层只维护 entry identity、责任摘要、availability、returnPageId。需要改变入口职责时先更新边界契约和索引，不在本 brief 里偷改内部页面。

## 15 验收条件

- 四类入口都可见、可聚焦、可读、可显示 available/disabled/unwired/error，并能安全返回。
- 当前生成结果中没有三栏编辑器、研究台槽位、素材网格、电脑应用、诊断、MapData、TokenData、经济或账号内部 UI。
- source 文档只登记 provenance，`directToAi=false`；AI brief 自身能够解释边界而无需读取 source。
- 入口只发声明式 intent；切换/错误/超时不会在当前页面伪造内部成功状态。
- 颜色、素材、动画和 fallback 遵循 G-01..G-05；reduced motion、键盘、手柄、触控和屏幕阅读器均可用。
