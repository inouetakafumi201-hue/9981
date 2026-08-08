/**
 * 变异体集：严格 JSON 解码器（tasks.md 3.2）。
 *
 * 每个变异体都对应一条"实现里必须成立、否则安全性或正确性失效"的判断。
 * 若某个变异体存活，说明对应断言空转，必须补强测试而不是删掉变异体。
 */
export const target = 'src/core/ugc/codec/strict-json-decoder.ts';
export const test = 'src/core/ugc/codec/__tests__/strict-json-decoder.test.ts';

export const mutants = [
  {
    name: '不检测重复成员（让后值静默覆盖前值）',
    from: '    const firstSpan = frame.seen.get(parsed.value);',
    to: '    const firstSpan = undefined as SourceSpan | undefined;',
  },
  {
    name: '不拒绝非有限数字',
    from: '    if (!Number.isFinite(value)) {',
    to: '    if (false as boolean) {',
  },
  {
    name: '不拒绝前导零',
    from: '      if (next !== null && DIGITS.has(next)) {',
    to: '      if (false as boolean) {',
  },
  {
    name: '不拒绝未转义控制字符',
    from: '      if (codePoint < 0x20) {',
    to: '      if (false as boolean) {',
  },
  {
    name: '接受任意转义序列',
    from: "      if (escape !== 'u') {",
    to: '      if (false as boolean) {',
  },
  {
    name: '不校验落单高位代理项',
    from: "      if (this.cursor.peekChar() !== '\\\\' || this.cursor.peekCharAt(1) !== 'u') {",
    to: '      if (false as boolean) {',
  },
  // 下面两个是"宽松化"变异：不是删掉检查后让输入在别处报错，而是直接放行、把落单代理项
  // 收进解码结果。这才是重构时真正会犯的错（"顺手 append 一下就好了"），
  // 也是只有输出不变量能抓、诊断文案断言抓不到的一类。
  {
    name: '放行落单低位代理项（收进解码结果）',
    from: "        return reject(this.syntax('落单的低位代理项，必须先出现高位代理项'));",
    to: '        value += String.fromCharCode(unit);\n        continue;',
  },
  {
    name: '放行落单高位代理项（收进解码结果）',
    from: "        return reject(this.syntax('落单的高位代理项，必须紧跟 \\\\uDC00-\\\\uDFFF 低位代理项'));",
    to: '        value += String.fromCharCode(unit);\n        continue;',
  },
  {
    name: '不拒绝顶层值后的多余内容',
    from: '        if (!this.cursor.atEnd()) {',
    to: '        if (false as boolean) {',
  },
  {
    name: '字符串扫描不计工作量（长字符串绕过 traversalWork）',
    from: '      const workViolation = this.work();\n      if (workViolation !== null) return reject(workViolation);',
    to: '      const workViolation = null;\n      if (workViolation !== null) return reject(workViolation);',
  },
  {
    name: '不消耗深度配额',
    from: '    const depthViolation = this.depthTracker.enter(this.stack.length + 1, { sourceSpan: anchor });',
    to: '    const depthViolation = null;',
  },
  {
    name: '不消耗 inputBytes 配额',
    from: "      const inputViolation = budget.consume('inputBytes', document.utf8.length, {\n        sourceSpan: documentAnchorSpan(file),\n      });",
    to: '      const inputViolation = null;',
  },
  {
    name: '缺少 schemaVersion 时默认一个版本',
    from: "  if (member === undefined) {\n    return reject(ast.span, `候选文档的顶层对象缺少必需成员 \"${SCHEMA_VERSION_MEMBER}\"。`);\n  }",
    to: "  if (member === undefined) {\n    return { ok: true, value: '1.0.0' };\n  }",
  },
  {
    name: '跳过 UTF-8 校验',
    from: '      const utf8Violation = findFirstUtf8Violation(document.utf8);',
    to: '      const utf8Violation = null;',
  },
  {
    name: '字面量只比前缀首字符',
    from: '      if (this.cursor.peekChar() !== literal.charAt(offset)) {',
    to: '      if (offset === 0 && this.cursor.peekChar() !== literal.charAt(0)) {',
  },
];
