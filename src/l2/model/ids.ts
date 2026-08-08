/**
 * L2 Model: 标识符地址空间。
 *
 * 与 L1 `src/core/kernel/state/ids.ts` 保持同一约定：标识符是普通字符串类型别名，
 * 由校验函数而不是名义类型（branded type）保证形状。理由记录于
 * `src/l2/决策与风险记录.md`（D-L2-001）：候选定义来自手写 JSON / UGC 解析结果，
 * 全部标识符在进入模型前都是 `string`，用 branded type 会在每个解析边界产生大量
 * 无语义的强制转换，反而削弱"校验是唯一真相源"这一原则。
 *
 * 本文件不含任何具体玩法数值、玩法规则或 L1 运行时机制。
 */

/** 定义标识符：L2 基类与可复用实例的唯一标识。 */
export type DefinitionId = string;

/** 语义族标识符（动作、网关、天然场景、物品、武器……可扩展登记表的键）。 */
export type SemanticFamilyId = string;

/** Definition_Package 标识符。 */
export type PackageId = string;

/** 标签标识符。 */
export type TagId = string;

/** 单位标识符（参数 Schema 声明的量纲，例如 `ap`、`node-count`）。 */
export type UnitId = string;

/** 字段名。 */
export type FieldName = string;

/** 决策编号（D-006、D-019、Q-01……）。 */
export type DecisionId = string;

/** 来源文件标识（相对仓库根的文档路径）。 */
export type SourceFileId = string;

/** JSON 路径（RFC 6901 风格，形如 `/definitions/0/parameterSchema/fields/2`）。 */
export type JsonPath = string;

/** 稳定诊断代码。 */
export type StableDiagnosticCode = string;

/** 人类可读文本。 */
export type HumanReadableText = string;

/** 稳定指纹：对来源陈述规范化后的确定性摘要，用于识别"同一语义主张"。 */
export type StableFingerprint = string;

/** L1 Op 标识符（L2 只引用，不定义 Op 语义）。 */
export type OpId = string;

/** L1 表达式定义标识符。 */
export type ExprId = string;

/** 动作标识符（Action_Family 定义的 DefinitionId 的语义别名）。 */
export type ActionId = DefinitionId;

/** AI 策略标识符。 */
export type AiPolicyId = DefinitionId;

/** 门标识符（车辆等实体上稳定可寻址的门引用）。 */
export type DoorId = string;

/** 座位角色标识符。 */
export type SeatRoleId = string;

/** 容器标识符。 */
export type ContainerId = string;

/** 槽位标识符。 */
export type SlotId = string;

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/u;

/**
 * 标识符合法形状：首字符为字母，其余为字母、数字、`_`、`.`、`:`、`-`。
 *
 * 该形状是 `Structural_Bound`（保证标识符可作为规范化排序键、可嵌入 JSON 路径），
 * 不是玩法数值；它不限制长度——长度上限没有权威来源支持，按 Requirements 5.12
 * 不得作为规范常量引入。
 */
export function isWellFormedId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/**
 * JSON 路径拼接。段中的 `~` 与 `/` 按 RFC 6901 转义，保证路径可逆、可稳定排序。
 */
export function joinJsonPath(base: JsonPath, ...segments: readonly (string | number)[]): JsonPath {
  let path = base;
  for (const segment of segments) {
    const token = typeof segment === 'number' ? String(segment) : segment.replace(/~/gu, '~0').replace(/\//gu, '~1');
    path = `${path}/${token}`;
  }
  return path;
}

/** 根 JSON 路径。 */
export const ROOT_JSON_PATH: JsonPath = '';
