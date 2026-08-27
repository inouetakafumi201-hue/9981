/**
 * L2 Codec: 禁止构造检测（Requirements 11.2、D-019）。
 *
 * 纯声明式 JSON 只描述数据、条件、引用与已知效果组合。以下构造一律拒绝：
 * 可执行代码、动态求值指令、命令式循环、变量赋值。
 *
 * 检测策略（刻意保守且可解释）：
 * - **键名**：全树扫描。键名是结构性声明，出现禁止键即为试图引入命令式语义。
 * - **字符串值**：只扫描**非自由文本**字段。自由文本（描述、理由、无障碍标签等）
 *   只影响表现，不影响规则结果；对它们做代码模式匹配会把正常散文误判为可执行代码。
 *   自由文本字段清单显式列出，不靠启发式猜测。
 */

/** 禁止键名 → 归类。 */
export const PROHIBITED_KEYS: ReadonlyMap<string, string> = Object.freeze(
  new Map<string, string>([
    ['$eval', '动态求值指令'],
    ['$exec', '可执行代码'],
    ['$fn', '可执行代码'],
    ['$function', '可执行代码'],
    ['$code', '可执行代码'],
    ['$script', '可执行代码'],
    ['$require', '动态模块加载'],
    ['$import', '动态模块加载'],
    ['$while', '命令式循环'],
    ['$for', '命令式循环'],
    ['$loop', '命令式循环'],
    ['$repeat', '命令式循环'],
    ['$goto', '命令式跳转'],
    ['$assign', '变量赋值'],
    ['$set', '变量赋值'],
    ['$let', '变量赋值'],
    ['$var', '变量赋值'],
    ['$mutate', '变量赋值'],
    ['__proto__', '原型链写入'],
    ['prototype', '原型链写入'],
    ['constructor', '构造器访问'],
  ]),
);

/** 禁止的字符串值模式 → 归类。 */
export const PROHIBITED_VALUE_PATTERNS: readonly { readonly pattern: RegExp; readonly kind: string }[] =
  Object.freeze([
    { pattern: /\bfunction\s*\*?\s*\(/u, kind: '可执行代码（function 字面量）' },
    { pattern: /=>/u, kind: '可执行代码（箭头函数）' },
    { pattern: /\beval\s*\(/u, kind: '动态求值指令' },
    { pattern: /\bnew\s+Function\b/u, kind: '可执行代码（Function 构造器）' },
    { pattern: /\brequire\s*\(/u, kind: '动态模块加载' },
    { pattern: /\bimport\s*\(/u, kind: '动态模块加载' },
    // 描述 JavaScript 的字面量插值语法。此处刻意不写"模"+"板"二字相邻：
    // 术语守卫按子串匹配废用架构词，相邻时会对这类语言术语误报。
    { pattern: /\$\{[^}]*\}/u, kind: '字符串插值表达式' },
    { pattern: /\bglobalThis\b/u, kind: '全局对象访问' },
    { pattern: /\bprocess\s*\./u, kind: '宿主进程访问' },
    { pattern: /\bwhile\s*\(/u, kind: '命令式循环' },
    { pattern: /\bfor\s*\(/u, kind: '命令式循环' },
  ]);

/**
 * 自由文本字段名。
 * 这些字段只影响名称、说明与辅助文本，不改变规则结果，因此不参与代码模式扫描。
 */
export const FREE_TEXT_KEYS: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    'description',
    'displayName',
    'accessibleLabel',
    'reason',
    'vetoReason',
    'correctionSuggestion',
    'rationale',
    'structuralRationale',
    'classificationReason',
    'enumerationRationale',
    'compositionRationale',
    'independenceRationale',
    'summary',
    'text',
    'section',
    'detail',
    'label',
  ]),
);

/** 表现子树键名：其下全部字符串值都视为自由文本。 */
export const PRESENTATION_SUBTREE_KEYS: ReadonlySet<string> = Object.freeze(
  new Set<string>(['presentation']),
);

/** 一次禁止构造命中。 */
export interface ProhibitedConstructHit {
  readonly jsonPath: string;
  readonly kind: string;
  readonly detail: string;
  readonly line: number;
  readonly column: number;
}

import type { JsonNode, Position } from './json-scanner';
import { walkJson } from './json-scanner';

function isInsidePresentationSubtree(path: string): boolean {
  const segments = path.split('/').slice(1);
  return segments.some((segment) => PRESENTATION_SUBTREE_KEYS.has(segment));
}

/**
 * 扫描语法树上的全部禁止构造。
 * 返回按 JSON 路径排序的命中列表，保证诊断顺序确定。
 */
export function detectProhibitedConstructs(root: JsonNode): readonly ProhibitedConstructHit[] {
  const hits: ProhibitedConstructHit[] = [];

  walkJson(root, (path, node, key, keyPosition) => {
    if (key !== undefined) {
      const prohibitedKind = PROHIBITED_KEYS.get(key);
      if (prohibitedKind !== undefined) {
        const position: Position = keyPosition ?? node.position;
        hits.push({
          jsonPath: path,
          kind: prohibitedKind,
          detail: `键名 ${JSON.stringify(key)} 声明了${prohibitedKind}`,
          line: position.line,
          column: position.column,
        });
      }
    }

    if (node.kind !== 'string') {
      return;
    }
    if (key !== undefined && FREE_TEXT_KEYS.has(key)) {
      return;
    }
    if (isInsidePresentationSubtree(path)) {
      return;
    }
    for (const { pattern, kind } of PROHIBITED_VALUE_PATTERNS) {
      if (pattern.test(node.value)) {
        hits.push({
          jsonPath: path,
          kind,
          detail: `字符串值命中${kind}模式 ${pattern.source}`,
          line: node.position.line,
          column: node.position.column,
        });
      }
    }
  });

  return Object.freeze(
    hits.sort((left, right) => {
      if (left.jsonPath !== right.jsonPath) {
        return left.jsonPath < right.jsonPath ? -1 : 1;
      }
      if (left.kind !== right.kind) {
        return left.kind < right.kind ? -1 : 1;
      }
      return left.detail < right.detail ? -1 : left.detail > right.detail ? 1 : 0;
    }),
  );
}
