/**
 * 玩法包编译器统一导出。
 *
 * 这是 LLM 工具、玩家上传、审核系统的共同入口。
 */
export { compile } from './compile.js';
export { compileToPlaypackDef } from './assemble.js';
export { calculateComplexityScore, suggestPriceTier } from './complexity.js';
export type {
  CompileOptions,
  CompiledPlaypack,
  ComplexityMetrics,
  ParsedMap,
  ParsedProfile,
  PlaypackCompileResult,
  PlaypackDiagnostic,
  PlaypackInput,
  PlaypackSource,
} from './types.js';
