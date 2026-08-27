/**
 * 引擎层状态与诊断原语（稳定导出）
 *
 * 版本：1.0.0（2026-08-11）
 *
 * 消费方：
 * - src/l2/** （基类层）
 * - src/core/ugc/** （UGC 集成）
 * - src/play/** （玩法层）
 *
 * 维护规则（v1.1+ 只能扩展）：
 * - 可新增诊断代码
 * - 可新增消息 bundle
 * - 不能删除现有导出
 * - 不能改变诊断代码的严重程度分类
 */

export { DiagnosticFactory, sortDiagnostics } from './diagnostic-factory';
export type { DiagnosticBuildInput } from './diagnostic-factory';
export {
  ZH_CN_CREATOR_BUNDLE,
  COMPILER_EMITTED_CODES,
  GUIDANCE_ARGUMENT_CONTRACT,
  bundleEntry,
  interpolate,
  renderGuidance,
  renderCreatorMessage,
  missingBundleCodes,
  unresolvedPlaceholders,
} from './message-bundles';
export type { CreatorMessageEntry, CreatorMessageBundle } from './message-bundles';
