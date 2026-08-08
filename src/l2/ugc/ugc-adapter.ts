/**
 * L2 UGC: UGC_Adapter — 把创作者输入转换为候选声明式 JSON，并复用统一验证路径。
 *
 * 对应 Requirements 11.8–11.12、13.5、13.11、16.2–16.5 与 Property 7。
 *
 * 铁律：
 * - UGC 输出只能是候选声明式 JSON，绝不产生可执行代码（Requirements 11.8）。
 * - 候选必经与手写 JSON **同一** `parsePackage` 解析入口（Requirements 11.9）。
 * - Semantic_Field 缺失/损坏 → 拒绝，绝不猜测（Requirements 11.10、13.10）。
 * - Presentation_Field 缺失/损坏 → 类型兼容回退 + Warning（Requirements 11.11、14.9）。
 *
 * 本适配器不实现独立的 UGC 规则引擎：所有语义判定都委托给 JSON Codec 与 Definition_Validator。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { errorDiagnostic, structuredRejection } from '../model/diagnostic-factory.js';
import type { Result } from '../model/result.js';
import type { PackageId } from '../model/ids.js';
import type { SourceLocation } from '../model/source.js';
import type { DefinitionPackage } from '../model/definition.js';
import { detectProhibitedConstructs } from '../codec/prohibited-constructs.js';
import { scanJson } from '../codec/json-scanner.js';
import { parsePackage, type ParseOptions } from '../codec/json-codec.js';

/**
 * UGC 输入。
 *
 * `candidateJson` 是编辑器/自然语言转换器产生的**候选声明式 JSON 文本**。
 * 适配器不负责"自然语言 → JSON"的语言模型转换（那是上游工具的职责），
 * 它负责保证：无论候选从哪来，都只能是纯声明式 JSON，且走同一验证入口。
 */
export interface UgcInput {
  readonly candidateJson: string;
  readonly sourceLocation: SourceLocation;
  readonly packageId?: PackageId;
  /** 上游转换器的标识，用于诊断溯源。 */
  readonly authoringTool?: string;
}

/**
 * 把 UGC 输入转换为候选定义包。
 *
 * 先做一次"可执行输出"守卫扫描（Requirements 11.8）：若候选文本中含禁止构造，
 * 立即以 `UGC_EXECUTABLE_OUTPUT` 拒绝，且不进入解析——这样即使上游工具出错，
 * 可执行内容也不会被当作声明式数据处理。随后无条件复用 `parsePackage`。
 */
export function fromUgc(input: UgcInput): Result<DefinitionPackage> {
  const options: ParseOptions = {
    sourceLocation: input.sourceLocation,
    ...(input.packageId === undefined ? {} : { packageId: input.packageId }),
  };

  const scan = scanJson(input.candidateJson);
  if (scan.ok) {
    const prohibited = detectProhibitedConstructs(scan.root);
    if (prohibited.length > 0) {
      const first = prohibited[0]!;
      return structuredRejection([
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.UGC_EXECUTABLE_OUTPUT,
          reason:
            `UGC 候选（工具 ${input.authoringTool ?? '未知'}）产生了可执行/命令式构造（${first.kind}）：${first.detail}。`,
          correctionSuggestion:
            'UGC 只能产生纯声明式 JSON；上游转换器不得输出可执行代码或命令式构造（Requirements 11.8）。',
          jsonPath: first.jsonPath,
          sourceLocation: { ...input.sourceLocation, line: first.line, column: first.column },
          ...(input.packageId === undefined ? {} : { sourcePackage: input.packageId }),
        }),
      ]);
    }
  }

  // 无条件复用手写 JSON 的同一解析 + 语义保留路径（Requirements 11.9）。
  // parsePackage 已负责：语法错误定位、禁止构造、Schema 版本、语义缺失/损坏拒绝、
  // 表现字段损坏降级为 Warning。UGC 不引入任何额外语义分支。
  return parsePackage(input.candidateJson, options);
}
