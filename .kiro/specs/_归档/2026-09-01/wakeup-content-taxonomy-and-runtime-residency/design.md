# WakeUp 内容分类与运行期驻留设计

## 概述

本设计将内容语义与传输形态分离：ContentKind 描述内容职责，ContentManifest 描述可校验集合，目录/对象/zip 只是载体。玩法层提供可复用逻辑定义，玩法文件负责一次玩法编排，地图包负责地图数据与地图表现资产，带地图玩法包负责 UGC/扩展集合。

运行期采用“清单先行、正文分阶段、引用保护、无引用释放”的驻留策略。逻辑定义、视觉资产和运行期对象分别统计驻留；装载器拥有释放裁决，UI 和表现层不能释放逻辑内容。

现有代码已具备 PlaypackDef codec、PlaypackCompiler、CompiledPlaypack.playpackDef 和 `loadCoreMechanics({ playpack })` 路径；本设计将这些能力统一到 ContentManifest 语义下，并保留当前独立 `map?: MapDataDocument` 作为兼容迁移输入，直至地图包入口完成正式替换。

## 架构

```text
Content carrier (directory / object / zip)
        │ parse + checksum
ContentManifest + ContentIndex
        │ dependency / compatibility / policy
ContentLoader ───────────────┐
  index-only                 │
  eager                       ├─ LogicalResidency
  deferred                    ├─ VisualResidency
                              └─ RuntimeObjectResidency
        │
PlayFile / MapData / MapPlayFile / PlaypackDef
        │
Core loader + Map compiler + Presentation Gateway
```

### 内容层关系

```text
PlayLayerDefinition ──referenced by──> PlayFile
MapDataFile ──────────contained in───> MapBundle
MapVisualAsset ───────referenced by──> MapBundle / PlayFile
MapPlayFile ──────────binds──────────> PlayLayerDefinition + MapDataFile
MapBundle ────────────referenced by──> MapBoundPlaypack
PlayFile ─────────────contained in───> MapBoundPlaypack or standalone carrier
```

### 设计决策

1. “玩法包”保留为集合/传输泛称；机器接口使用 `contentKind`，禁止根据 zip 名称判断语义。
2. 官方地图包和 UGC 带地图玩法包使用同一 manifest 解析和依赖校验，但权限、来源和可激活入口由安全策略区分。
3. `CompiledPlaypack.playpackDef` 是当前运行期规则装载的正式输入；`CompiledPlaypack.maps` 仍作为地图编译产物，不能静默丢失。
4. `map?: MapDataDocument` 暂时保留为兼容 API；新入口通过 `MapBundle` 追踪 map data、map play 和 visual assets 的关系。
5. index-only 不解析正文；deferred 首次需求载入；eager 当前阶段载入。活动引用阻止释放。
6. 逻辑驻留和视觉驻留独立管理；表现层只能请求资源，不能释放规则定义。

## 组件和接口

### ContentManifest

```ts
export type ContentKind =
  | 'play-layer'
  | 'play-file'
  | 'map-data'
  | 'map-visual-asset'
  | 'map-play-file'
  | 'map-bundle'
  | 'map-bound-playpack'
  | 'content-manifest';

export type LoadPolicy = 'eager' | 'deferred' | 'index-only';

export interface ContentDependency {
  readonly contentId: string;
  readonly versionRange: string;
  readonly required: boolean;
  readonly loadPolicy: LoadPolicy;
}

export interface ContentEntry {
  readonly entryId: string;
  readonly kind: ContentKind;
  readonly path: string;
  readonly format: 'json' | 'image' | 'audio' | 'animation' | 'binary';
  readonly loadPolicy: LoadPolicy;
  readonly checksum: { readonly algorithm: 'sha256'; readonly value: string };
}

export interface ContentManifest {
  readonly schemaVersion: string;
  readonly contentId: string;
  readonly contentKind: ContentKind;
  readonly version: string;
  readonly compatibility: { readonly engine: string; readonly ui?: string };
  readonly dependencies: readonly ContentDependency[];
  readonly entries: readonly ContentEntry[];
  readonly security: { readonly source: 'official' | 'ugc' | 'llm-generated' | 'player-uploaded'; readonly executableCode: false };
}
```

### 内容集合

```ts
export interface MapBundle {
  readonly manifest: ContentManifest;
  readonly mapData: { readonly entryId: string };
  readonly visualAssets: readonly { readonly entryId: string }[];
  readonly mapPlay?: { readonly entryId: string };
}

export interface MapBoundPlaypack {
  readonly manifest: ContentManifest;
  readonly playFiles: readonly { readonly entryId: string }[];
  readonly mapBundles?: readonly { readonly entryId: string }[];
  readonly visualOverrides?: readonly { readonly entryId: string }[];
}
```

### ContentLoader

```ts
export interface ContentLoader {
  loadIndex(manifest: ContentManifest): Promise<ContentIndexResult>;
  loadEntry<T>(entryId: string, reason: string): Promise<ContentLoadResult<T>>;
  retain(entryId: string, owner: string): void;
  release(entryId: string, owner: string): boolean;
  residency(): Readonly<ContentResidencySnapshot>;
  cancel(requestId: string): void;
}

export interface ContentResidencySnapshot {
  readonly logical: readonly ResidencyEntry[];
  readonly visual: readonly ResidencyEntry[];
  readonly runtimeObject: readonly ResidencyEntry[];
}
```

### 现有运行期接线

`createLoadedMatch` 接受 `playpack?: PlaypackDef`，传入 `loadCoreMechanics`；加载后使用同一 `activePlaypack.id` 激活。当前独立地图仍按 `normalizeMapDocument → compileMap → prefab.spawn` 装载。后续 MapBundle 适配器负责把 manifest entry 解析为这两个稳定输入，并保留地图入口追踪信息。

### PlayFile 约束

```ts
export interface PlayFile {
  readonly playFileId: string;
  readonly requires: readonly { readonly contentId: string; readonly versionRange: string }[];
  readonly mapBinding?: { readonly mapBundleId: string; readonly entryNodeId: string };
  readonly scheduleId: string;
  readonly phaseBindings: readonly { readonly phaseId: string; readonly triggers: readonly string[] }[];
  readonly presentations: readonly { readonly eventId: string; readonly semanticId: string }[];
  readonly outcomes: readonly { readonly outcomeId: string; readonly ruleRef: string }[];
  readonly lifecycle: readonly { readonly event: string; readonly actionRef: string }[];
}
```

PlayFile 只引用规则和表现能力，不直接写 WorldState、距离、碰撞、贴图 URL 或隐藏 AI 状态。

## 数据模型

### 驻留状态

```ts
export interface ResidencyEntry {
  readonly entryId: string;
  readonly kind: ContentKind;
  readonly policy: LoadPolicy;
  readonly state: 'indexed' | 'loading' | 'resident' | 'failed' | 'released';
  readonly refCount: number;
  readonly requestId?: string;
  readonly revision: number;
  readonly failureCode?: string;
}
```

### 运行期阶段

```ts
export type ResidencyPhase =
  | 'manifest'
  | 'index'
  | 'match-setup'
  | 'active-phase'
  | 'presentation-window'
  | 'release';
```

阶段规则：

- `manifest`：解析清单、格式、checksum、来源和兼容性。
- `index`：建立依赖图；index-only 内容停在 indexed。
- `match-setup`：载入本局地图原数据、玩法文件和初始规则定义。
- `active-phase`：只载入当前 schedule/phase 所需 deferred 条目。
- `presentation-window`：独立 preload 视觉资产，不能改变逻辑驻留。
- `release`：只释放 refCount 为零且没有活动执行栈、投影或请求的条目。

## 正确性属性

**属性 1：内容类型职责不交叉**

*对于任何* ContentEntry，entry 的 contentKind、format 和依赖关系必须符合对应职责，地图表现资产不得成为规则定义，地图原数据不得直接成为胜利或奖励事实。

**验证：要求 1.1-1.6、6.1-6.5**

**属性 2：清单依赖顺序稳定**

*对于任何* 依赖图，装载器必须先完成清单和依赖校验，再解析正文；缺失必选依赖不得进入正文驻留。

**验证：要求 3.1-3.4**

**属性 3：index-only 不解析正文**

*对于任何* index-only 条目，装载完成后条目状态为 indexed，正文解析次数为零。

**验证：要求 4.1-4.2**

**属性 4：deferred 首次需求才载入**

*对于任何* deferred 条目，在没有需求前正文解析次数为零；首次有效需求后最多产生一次有效正文驻留。

**验证：要求 4.3-4.4**

**属性 5：活动引用阻止释放**

*对于任何* 被活动流程、执行栈、投影或资源请求持有的条目，release 操作不得将其状态变为 released。

**验证：要求 4.5-4.6**

**属性 6：逻辑、视觉和运行对象驻留分离**

*对于任何* 驻留快照，释放视觉资产不得释放仍被逻辑流程引用的定义，释放运行期对象不得删除仍在规则状态中的定义引用。

**验证：要求 4.7、6.3**

**属性 7：自定义玩法包经过统一装载**

*对于任何* 合法 PlaypackDef，`loadCoreMechanics({ playpack })` 装载和激活的包 ID 等于输入包 ID，缺省输入才使用官方默认包。

**验证：要求 5.1-5.3**

**属性 8：地图入口关系可追踪**

*对于任何* 包含地图入口的 MapBoundPlaypack，装载结果保留 map bundle、map data、map play 和入口节点之间的对应关系。

**验证：要求 2.1-2.5、5.4-5.5**

**属性 9：内容取消不会陈旧回写**

*对于任何* 取消、超时或失败的内容请求，其结果不得覆盖更高 revision 的驻留或运行期状态。

**验证：要求 4.8、7.3-7.4**

**属性 10：玩法文件不直接写规则事实**

*对于任何* PlayFile，解析和执行过程只能产生对玩法层、运行期和表现层端口的声明式调用，不得直接修改 WorldState。

**验证：要求 6.2、6.4**

## 错误处理

- manifest schema/version/checksum 失败：拒绝内容集合，报告结构化诊断。
- 必选依赖缺失：阻止正文解析；可选依赖进入显式 unavailable 状态。
- deferred 超时或取消：保持 indexed/failed，不用默认规则替代。
- 活动内容释放请求：拒绝释放并记录持有者。
- PlaypackDef linter 失败：原子拒绝，不改变活动注册表。
- MapData canonical 校验失败：不执行 prefab.spawn，保留地图错误诊断。
- legacy v1 地图：只在导入边界 normalize 为 v2，并记录来源。
- UGC 可执行代码或不允许的 entry format：安全拒绝。
- 版本不兼容：返回 compatibility diagnostic，不进入 active-phase。

## 测试策略

### 单元测试

- ContentKind、manifest、依赖图和 checksum。
- index-only、eager、deferred 的解析和驻留。
- retain/release 引用保护。
- PlayFile 引用白名单。
- MapBundle 与 MapBoundPlaypack 入口映射。
- `createLoadedMatch` 自定义 playpack 输入和默认包回退。

### 属性测试

使用 TypeScript `fast-check`，每项属性一个测试，至少 100 次迭代，标签格式：

```text
Feature: wakeup-content-taxonomy-and-runtime-residency, Property N: ...
```

### 集成测试

- 官方玩法层默认装载。
- 自定义 `CompiledPlaypack.playpackDef` 装载和激活。
- 带地图玩法包：manifest → map data → map play → playpack。
- 多地图 entry-by-map 的入口追踪和隔离。
- index-only 不解析正文。
- deferred 首次触发、取消、超时和释放。
- 逻辑内容与视觉资产独立释放。
- 地图编译、prefab.spawn、运行期事件和表现层入口。

### 门禁

```bash
npx tsc --noEmit
npx vitest run
npm run lint
npm run verify:docs
npm run verify:prompt-pack
```
