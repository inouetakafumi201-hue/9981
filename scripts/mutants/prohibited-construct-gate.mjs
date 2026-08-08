/**
 * 变异体集：禁止执行构造门禁（tasks.md 3.3）。
 *
 * 每个变异体都对应一条"实现里必须成立、否则安全性失效"的判断。
 * 若某个变异体存活，说明对应断言空转，必须补强测试而不是删掉变异体。
 */
export const target = 'src/core/ugc/codec/prohibited-construct-gate.ts';
export const test = 'src/core/ugc/codec/__tests__/prohibited-construct-gate.test.ts';

export const mutants = [
  {
    name: '丢弃位置信息（所有成员都按根路径裁定）',
    from: "      const verdict = contract.classifyMember(path === '' ? '/' : path, member.key);",
    to: "      const verdict = contract.classifyMember('/', member.key);",
  },
  {
    name: '把成员名当作路径传入（参数错位）',
    from: "      const verdict = contract.classifyMember(path === '' ? '/' : path, member.key);",
    to: '      const verdict = contract.classifyMember(member.key, member.key);',
  },
  {
    name: '契约不可用时放行（不失败关闭）',
    from: "      if (contract.providerId === UNAVAILABLE_PROVIDER_ID) {",
    to: '      if (false as boolean) {',
  },
  {
    name: '不报告未登记表达式语言',
    from: "      if (verdict.kind === 'execution-request' || verdict.kind === 'unregistered-expression-language') {",
    to: "      if (verdict.kind === 'execution-request') {",
  },
  {
    name: '不报告执行请求（只报表达式语言）',
    from: "      if (verdict.kind === 'execution-request' || verdict.kind === 'unregistered-expression-language') {",
    to: "      if (verdict.kind === 'unregistered-expression-language') {",
  },
  {
    name: '自由文本区域也按效果契约解读（引入误报）',
    from: '      if (contract.isFreeTextRegion(memberPath)) continue;',
    to: '      if (false as boolean) continue;',
  },
  {
    name: '把整棵自由文本子树之外的成员也跳过（引入漏报）',
    from: '      if (contract.isFreeTextRegion(memberPath)) continue;',
    to: '      if (!contract.isFreeTextRegion(memberPath)) continue;',
  },
  {
    name: '首个发现即返回（漏报后续违规）',
    from: '        findings.push({ verdict, memberName: member.key, jsonPath: memberPath, span: member.keySpan });\n        continue;',
    to: '        return { ok: true, value: Object.freeze([{ verdict, memberName: member.key, jsonPath: memberPath, span: member.keySpan }]) };',
  },
  {
    name: '不消耗 traversalWork 配额（可被恶意嵌套拖死）',
    from: "    if (budget.consume('traversalWork', 1) !== null) {",
    to: '    if (false as boolean) {',
  },
  {
    name: '配额耗尽时返回"候选干净"',
    from: "      return { ok: false, violationKind: 'traversalWork' };",
    to: '      return { ok: true, value: Object.freeze(findings) };',
  },
  {
    name: '不遍历数组元素（数组内的违规全部漏报）',
    from: '      for (let index = node.elements.length - 1; index >= 0; index -= 1) {',
    to: '      for (let index = -1; index >= 0; index -= 1) {',
  },
  {
    name: '不下降到成员值（嵌套违规漏报）',
    from: '      stack.push({ node: member.value, path: memberPath });',
    to: '      void memberPath;',
  },
  {
    name: 'span 取值节点而非成员名（定位漂移）',
    from: '        findings.push({ verdict, memberName: member.key, jsonPath: memberPath, span: member.keySpan });',
    to: '        findings.push({ verdict, memberName: member.key, jsonPath: memberPath, span: member.value.span });',
  },
  {
    name: 'JSON Pointer 不做转义（含 / 的成员名产生歧义路径）',
    from: "  return token.replace(/~/g, '~0').replace(/\\//g, '~1');",
    to: '  return token;',
  },
];
