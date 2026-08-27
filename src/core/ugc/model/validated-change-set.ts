/**
 * 不可伪造验证产物的**类型**（design.md「Validated artifact and atomic activation」/ 需求 13.1-13.4）。
 *
 * 两道锁：
 * 1. 编译期：`validatedChangeSetBrand` 是 `declare const` 的 unique symbol，从不导出运行时值，
 *    因此模块外的对象字面量无法满足该接口，只能靠 `as` 强转。
 * 2. 运行期：`activation/validated-change-set.ts` 维护一个模块私有 WeakSet，只有工厂铸造过的实例
 *    才在集合内。`as` 强转出来的对象通不过运行期 guard，因此强转无法换来激活资格。
 *
 * 工厂本身不从公共导出根暴露（见 `src/core/ugc/index.ts`）。
 */
import type { Diagnostic } from '../../kernel/state/diagnostic';
import type { ChangeRequestBinding } from './binding';
import type { TargetOwnership } from './candidate';
import type { PresentationFallbackDecision } from './presentation';
import type { UpstreamResolvedReferenceGraph, UpstreamValidatedCandidate } from './upstream';

declare const validatedChangeSetBrand: unique symbol;

export interface ValidatedChangeSet {
  readonly [validatedChangeSetBrand]: true;
  /** 仅由规范化内容派生。 */
  readonly candidateFingerprint: string;
  /** 由完整请求绑定派生；提交前必须从 `changeRequestBinding` 重算并逐字段核对。 */
  readonly changeRequestFingerprint: string;
  readonly changeRequestBinding: ChangeRequestBinding;
  readonly baselineFingerprint: string;
  readonly targetOwnership: TargetOwnership;
  readonly upstreamValidated: UpstreamValidatedCandidate;
  readonly resolvedReferences: UpstreamResolvedReferenceGraph;
  readonly presentationDecisions: readonly PresentationFallbackDecision[];
  /** 只允许 warn/info 级诊断。任何 error/fatal 都不可能到达这里。 */
  readonly warnings: readonly Diagnostic[];
}
