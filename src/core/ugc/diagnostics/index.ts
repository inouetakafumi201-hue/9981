/**
 * UGC 诊断体系导出根。
 */
export type { UGCDiagnosticCategory, ConditionOf, DiagnosticSelector, CodeMap } from './code-map';
export { CODE_MAP, UGC_DIAGNOSTIC_CATEGORIES } from './code-map';

export type { DiagnosticCodeCatalog } from './code-catalog';
export { createDiagnosticCodeCatalog } from './code-catalog';

export type {
  ChangeSetDiagnosticInput,
  DefinitionDiagnosticInput,
  DiagnosticCommonInput,
  DocumentDiagnosticInput,
  HostDiagnosticInput,
  RegistryDiagnosticInput,
  UGCDiagnosticFactory,
} from './factory';
export {
  UnmappedDiagnosticError,
  createDiagnosticFactory,
  documentAnchorSpan,
  messageKeyFor,
} from './factory';

export type { DiagnosticEquivalenceProjection } from './sort';
export {
  compareDiagnostics,
  diagnosticsEquivalent,
  projectForEquivalence,
  sortDiagnostics,
} from './sort';
