/**
 * L2 Codec: 声明式 JSON 解析入口（Requirements 11.1–11.4、11.10）。
 *
 * 流程：扫描（含位置与重复检测）→ 禁止构造检测 → 顶层对象与 Schema 版本校验 →
 * 解码为候选定义包。任何失败返回带来源位置与原因的结构化拒绝；
 * 语义字段永不补造，表现字段损坏降级为 Warning。
 */

import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import type { Diagnostic } from '../model/diagnostic.js';
import { isWarningDiagnostic } from '../model/diagnostic.js';
import { errorDiagnostic } from '../model/diagnostic-factory.js';
import { structuredRejection } from '../model/diagnostic-factory.js';
import type { Result } from '../model/result.js';
import { ok } from '../model/result.js';
import { canonicalSort, compareDiagnostics } from '../model/ordering.js';
import type { PackageId } from '../model/ids.js';
import { ROOT_JSON_PATH } from '../model/ids.js';
import type { SourceLocation } from '../model/source.js';
import type { DefinitionPackage } from '../model/definition.js';
import { scanJson, type JsonNode } from './json-scanner.js';
import { detectProhibitedConstructs } from './prohibited-constructs.js';
import { createDecodeContext, decodePackage } from './definition-decoder.js';

/** 支持的声明式 JSON Schema 版本。 */
export const SUPPORTED_SCHEMA_VERSIONS: ReadonlySet<string> = Object.freeze(new Set(['l2-declarative/1']));

export interface ParseOptions {
  readonly sourceLocation: SourceLocation;
  readonly packageId?: PackageId;
}

function rootObjectOf(node: JsonNode): Record<string, unknown> | undefined {
  if (node.kind !== 'object') {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const member of node.members) {
    out[member.key] = nodeValue(member.value);
  }
  return out;
}

function nodeValue(node: JsonNode): unknown {
  switch (node.kind) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const member of node.members) {
        out[member.key] = nodeValue(member.value);
      }
      return out;
    }
    case 'array':
      return node.elements.map((element) => nodeValue(element));
    case 'string':
      return node.value;
    case 'number':
      return node.value;
    case 'boolean':
      return node.value;
    case 'null':
      return null;
    default: {
      const exhaustive: never = node;
      return exhaustive;
    }
  }
}

/**
 * 解析手写声明式 JSON 为候选定义包。
 */
export function parsePackage(input: string, options: ParseOptions): Result<DefinitionPackage> {
  const base = options.sourceLocation;

  const scan = scanJson(input);
  if (!scan.ok) {
    return structuredRejection([
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.JSON_PARSE_ERROR,
        reason: `JSON 解析失败（行 ${scan.position.line} 列 ${scan.position.column}）：${scan.message}`,
        correctionSuggestion: '修正 JSON 语法错误；纯声明式 JSON 不接受注释、尾随逗号、单引号或非有限数字。',
        sourceLocation: { ...base, line: scan.position.line, column: scan.position.column },
        ...(options.packageId === undefined ? {} : { sourcePackage: options.packageId }),
      }),
    ]);
  }

  const diagnostics: Diagnostic[] = [];

  // 重复成员：每个语义字段都必须保留，重复即为语义歧义（Requirements 11.4）。
  for (const duplicate of scan.duplicates) {
    diagnostics.push(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_DAMAGED,
        reason:
          `对象成员 ${JSON.stringify(duplicate.key)} 在 ${duplicate.jsonPath || '/'} 重复出现` +
          `（首次在行 ${duplicate.firstPosition.line}，重复在行 ${duplicate.duplicatePosition.line}）。`,
        correctionSuggestion: '删除重复成员；重复会使语义字段的取值不确定，解析器不会静默丢弃其一。',
        jsonPath: duplicate.jsonPath,
        sourceLocation: { ...base, line: duplicate.duplicatePosition.line, column: duplicate.duplicatePosition.column },
        ...(options.packageId === undefined ? {} : { sourcePackage: options.packageId }),
      }),
    );
  }

  // 禁止构造。
  for (const hit of detectProhibitedConstructs(scan.root)) {
    diagnostics.push(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.JSON_PROHIBITED_CONSTRUCT,
        reason: `检测到禁止构造（${hit.kind}）：${hit.detail}。`,
        correctionSuggestion: '纯声明式 JSON 只描述数据、条件、引用与已知效果组合，移除该可执行/命令式构造（D-019）。',
        jsonPath: hit.jsonPath,
        sourceLocation: { ...base, line: hit.line, column: hit.column },
        ...(options.packageId === undefined ? {} : { sourcePackage: options.packageId }),
      }),
    );
  }

  const rootObject = rootObjectOf(scan.root);
  if (rootObject === undefined) {
    diagnostics.push(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.JSON_ROOT_NOT_OBJECT,
        reason: '声明式定义包的顶层必须是 JSON 对象。',
        correctionSuggestion: '把顶层包装为对象，至少包含 packageId、schemaVersion 与 definitions。',
        jsonPath: ROOT_JSON_PATH,
        sourceLocation: base,
        ...(options.packageId === undefined ? {} : { sourcePackage: options.packageId }),
      }),
    );
    return structuredRejection(canonicalSort(diagnostics, compareDiagnostics));
  }

  // Schema 版本（Requirements 11.1）。
  const schemaVersion = rootObject['schemaVersion'];
  if (schemaVersion === undefined) {
    diagnostics.push(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.JSON_SCHEMA_VERSION_MISSING,
        reason: '声明式定义包缺少显式 schemaVersion。',
        correctionSuggestion: `声明 schemaVersion，例如 ${[...SUPPORTED_SCHEMA_VERSIONS][0]}。`,
        jsonPath: `${ROOT_JSON_PATH}/schemaVersion`,
        sourceLocation: base,
        ...(options.packageId === undefined ? {} : { sourcePackage: options.packageId }),
      }),
    );
  } else if (typeof schemaVersion !== 'string' || !SUPPORTED_SCHEMA_VERSIONS.has(schemaVersion)) {
    diagnostics.push(
      errorDiagnostic({
        code: DIAGNOSTIC_CODES.JSON_SCHEMA_VERSION_UNSUPPORTED,
        reason: `不支持的 schemaVersion：${JSON.stringify(schemaVersion)}。`,
        correctionSuggestion: `使用受支持的版本之一：${[...SUPPORTED_SCHEMA_VERSIONS].join('、')}。`,
        jsonPath: `${ROOT_JSON_PATH}/schemaVersion`,
        sourceLocation: base,
        ...(options.packageId === undefined ? {} : { sourcePackage: options.packageId }),
      }),
    );
  }

  const ctx = createDecodeContext(scan.root, base, options.packageId);
  const pkg = decodePackage(ctx, scan.root, rootObject);
  diagnostics.push(...ctx.diagnostics);

  const sorted = canonicalSort(diagnostics, compareDiagnostics);
  if (pkg === undefined || sorted.some((diagnostic) => diagnostic.severity === 'Error')) {
    // 保证至少一个 Error（若只有 warning 但 pkg 缺失，补一条解码失败错误）。
    if (!sorted.some((diagnostic) => diagnostic.severity === 'Error')) {
      return structuredRejection([
        ...sorted,
        errorDiagnostic({
          code: DIAGNOSTIC_CODES.JSON_SEMANTIC_FIELD_MISSING,
          reason: '定义包缺少必需的顶层语义字段，无法解码。',
          correctionSuggestion: '补全 packageId、schemaVersion 与 definitions。',
          jsonPath: ROOT_JSON_PATH,
          sourceLocation: base,
          ...(options.packageId === undefined ? {} : { sourcePackage: options.packageId }),
        }),
      ]);
    }
    return structuredRejection(sorted);
  }

  return ok(pkg, sorted.filter(isWarningDiagnostic));
}
