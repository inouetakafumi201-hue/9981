/**
 * UGC 诊断体系导出根。
 */
export type { UGCDiagnosticCategory, ConditionOf, DiagnosticSelector, CodeMap } from './code-map.js';
export { CODE_MAP, UGC_DIAGNOSTIC_CATEGORIES } from './code-map.js';

export type { DiagnosticCodeCatalog } from './code-catalog.js';
export { createDiagnosticCodeCatalog } from './code-catalog.js';

export type {
  ChangeSetDiagnosticInput,
  DefinitionDiagnosticInput,
  DiagnosticCommonInput,
  DocumentDiagnosticInput,
  HostDiagnosticInput,
  RegistryDiagnosticInput,
  UGCDiagnosticFactory,
} from './factory.js';
export {
  UnmappedDiagnosticError,
  createDiagnosticFactory,
  documentAnchorSpan,
  messageKeyFor,
} from './factory.js';

export type { DiagnosticEquivalenceProjection } from './sort.js';
export {
  compareDiagnostics,
  diagnosticsEquivalent,
  projectForEquivalence,
  sortDiagnostics,
} from './sort.js';
