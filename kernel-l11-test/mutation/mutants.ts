/**
 * L11 变异体清单。
 *
 * 两条硬判据，来自前两层的实测教训：
 *
 * 1. **替换物不得偶然重建被删掉的安全性质。** 想删环保护就彻底删，
 *    不要换成一个自带上限的写法——那样变异体与原实现等价，存活证明不了任何盲区
 *    （L12 称之为"去牙变异体"）。
 * 2. **标 `expectEquivalent` 必须在 `desc` 里写下理由和前提。** 等价结论不是永久的，
 *    是有前提的；前提不写下来，后人无法判断它还成不成立（L8 的 M14 教训）。
 *
 * 另外：`find` 必须在源码中恰好命中 1 次，否则驱动器记为 INVALID 并排除出得分——
 * 防止"改了个不存在的字符串"被静默算成击杀。
 */
export interface Mutant {
  id: string;
  file: string;
  desc: string;
  find: string;
  replace: string;
  /** 标注为语义等价：存活才是正确结果，不计入得分。必须在 desc 写明前提。 */
  expectEquivalent?: boolean;
}

export const MUTANTS: Mutant[] = [
  // ——— reg() / 注册表构造（M01~M08）———
  {
    id: 'M01', file: 'diagnostic.ts',
    desc: 'reg：prefix 取三段而非两段',
    find: "const prefix = code.split('_').slice(0, 2).join('_');",
    replace: "const prefix = code.split('_').slice(0, 3).join('_');",
  },
  {
    id: 'M02', file: 'diagnostic.ts',
    desc: 'reg：prefix 只取第一段',
    find: "const prefix = code.split('_').slice(0, 2).join('_');",
    replace: "const prefix = code.split('_')[0]!;",
  },
  {
    id: 'M03', file: 'diagnostic.ts',
    desc: 'reg：recoverable 恒 true（fatal 也可恢复）',
    find: "recoverable: severity !== 'fatal',",
    replace: 'recoverable: true,',
  },
  {
    id: 'M04', file: 'diagnostic.ts',
    desc: 'reg：recoverable 恒 false',
    find: "recoverable: severity !== 'fatal',",
    replace: 'recoverable: false,',
  },
  {
    id: 'M05', file: 'diagnostic.ts',
    desc: 'reg：recoverable 判据反向（把 fatal 当可恢复、其余当不可恢复）',
    find: "recoverable: severity !== 'fatal',",
    replace: "recoverable: severity === 'fatal',",
  },
  {
    id: 'M06', file: 'diagnostic.ts',
    desc: 'reg：不冻结 spec（severity 与 recoverable 可被改到脱钩）',
    find: `  CODE_REGISTRY.set(
    code,
    Object.freeze({
      code,
      severity,
      prefix,
      recoverable: severity !== 'fatal',
    })
  );`,
    replace: `  CODE_REGISTRY.set(code, {
    code,
    severity,
    prefix,
    recoverable: severity !== 'fatal',
  } as CodeSpec);`,
  },
  {
    id: 'M07', file: 'diagnostic.ts',
    desc: 'reg：spec.code 写成 prefix（键与 code 不一致）',
    find: `    Object.freeze({
      code,
      severity,`,
    replace: `    Object.freeze({
      code: prefix,
      severity,`,
  },
  {
    id: 'M08', file: 'diagnostic.ts',
    desc: 'VALID_PREFIXES：去掉 E_INV（最常用前缀落在白名单外）',
    find: "    'E_INV', 'E_COST', 'E_OP', 'E_HOOK', 'E_EXPR',",
    replace: "    'E_COST', 'E_OP', 'E_HOOK', 'E_EXPR',",
  },

  // ——— sealRegistry（M09~M13）———
  {
    id: 'M09', file: 'diagnostic.ts',
    desc: 'sealRegistry：整体不生效（注册表写入面敞开）',
    find: 'sealRegistry();',
    replace: 'void sealRegistry;',
  },
  {
    id: 'M10', file: 'diagnostic.ts',
    desc: 'sealRegistry：只封 set，delete/clear 仍可用',
    find: `  m['set'] = deny('set');
  m['delete'] = deny('delete');
  m['clear'] = deny('clear');`,
    replace: `  m['set'] = deny('set');`,
  },
  {
    id: 'M11', file: 'diagnostic.ts',
    desc: 'sealRegistry：只封 delete/clear，set 仍可用（能注册任意码）',
    find: `  m['set'] = deny('set');
  m['delete'] = deny('delete');`,
    replace: `  m['delete'] = deny('delete');`,
  },
  {
    id: 'M12', file: 'diagnostic.ts',
    desc: 'sealRegistry：clear 未封',
    find: `  m['clear'] = deny('clear');`,
    replace: '',
  },
  {
    id: 'M13', file: 'diagnostic.ts',
    desc: 'sealRegistry：deny 改为静默 no-op（写入不报错但也不生效）',
    find: `  const deny = (op: string) => () => {
    throw new Error(\`E_DIAG_REGISTRY_SEALED:\${op}\`);
  };`,
    replace: `  const deny = (_op: string) => () => CODE_REGISTRY;`,
  },

  // ——— emit：入口校验（M14~M22）———
  {
    id: 'M14', file: 'diagnostic.ts',
    desc: 'emit：未注册码不再抛出（改为静默按 error 处理）',
    find: `    const spec = CODE_REGISTRY.get(code);
    if (!spec) {
      throw new Error(\`E_DIAG_UNREGISTERED_CODE:\${code}\`);
    }`,
    replace: `    const spec = CODE_REGISTRY.get(code) ?? { code, severity: 'error' as Severity, prefix: 'E_OP', recoverable: true };`,
  },
  {
    id: 'M15', file: 'diagnostic.ts',
    desc: 'emit：未注册码抛出但错误码退化为通用 Error（测试只断言"抛错"就能过）',
    find: 'throw new Error(`E_DIAG_UNREGISTERED_CODE:${code}`);',
    replace: "throw new Error('E_DIAG_ERROR');",
  },
  {
    id: 'M16', file: 'diagnostic.ts',
    desc: 'emit：未注册码的错误消息不带 code（无法定位是哪个码）',
    find: 'throw new Error(`E_DIAG_UNREGISTERED_CODE:${code}`);',
    replace: "throw new Error('E_DIAG_UNREGISTERED_CODE');",
  },
  {
    id: 'M17', file: 'diagnostic.ts',
    desc: 'emit：改为按前缀放行（前缀合法即接受，未注册也收）',
    find: `    const spec = CODE_REGISTRY.get(code);
    if (!spec) {
      throw new Error(\`E_DIAG_UNREGISTERED_CODE:\${code}\`);
    }`,
    replace: `    const pfx = code.split('_').slice(0, 2).join('_');
    const spec = CODE_REGISTRY.get(code)
      ?? (VALID_PREFIXES.has(pfx)
        ? { code, severity: 'error' as Severity, prefix: pfx, recoverable: true }
        : undefined);
    if (!spec) {
      throw new Error(\`E_DIAG_UNREGISTERED_CODE:\${code}\`);
    }`,
  },
  {
    id: 'M18', file: 'diagnostic.ts',
    desc: 'emit：归因校验去掉（layer 为空也接受）',
    find: `    if (!source || !source.layer) {
      throw new Error('E_DIAG_MISSING_ATTRIBUTION');
    }`,
    replace: '',
  },
  {
    id: 'M19', file: 'diagnostic.ts',
    desc: 'emit：归因只查 source 存在、不查 layer 非空',
    find: 'if (!source || !source.layer) {',
    replace: 'if (!source) {',
  },
  {
    id: 'M20', file: 'diagnostic.ts',
    desc: 'emit：归因只查 layer、不查 source 本身（source 为 null 时 TypeError）',
    find: 'if (!source || !source.layer) {',
    replace: 'if (!source.layer) {',
  },
  {
    id: 'M21', file: 'diagnostic.ts',
    desc: 'emit：归因错误码退化为通用 Error',
    find: "throw new Error('E_DIAG_MISSING_ATTRIBUTION');",
    replace: "throw new Error('E_DIAG_ERROR');",
  },
  {
    id: 'M22', file: 'diagnostic.ts',
    desc: 'emit：校验顺序颠倒（先查归因后查注册）',
    find: `    const spec = CODE_REGISTRY.get(code);
    if (!spec) {
      throw new Error(\`E_DIAG_UNREGISTERED_CODE:\${code}\`);
    }
    if (!source || !source.layer) {
      throw new Error('E_DIAG_MISSING_ATTRIBUTION');
    }`,
    replace: `    if (!source || !source.layer) {
      throw new Error('E_DIAG_MISSING_ATTRIBUTION');
    }
    const spec = CODE_REGISTRY.get(code);
    if (!spec) {
      throw new Error(\`E_DIAG_UNREGISTERED_CODE:\${code}\`);
    }`,
  },

  // ——— emit：causedBy 成员校验（M23~M28）———
  {
    id: 'M23', file: 'diagnostic.ts',
    desc: 'emit：去掉 causedBy 成员校验（跨 collector/伪造/跨世代的因全部放行）',
    find: `    if (causedBy !== undefined && !this.members.has(causedBy)) {
      throw new Error('E_DIAG_FOREIGN_CAUSE');
    }`,
    replace: '',
  },
  {
    id: 'M24', file: 'diagnostic.ts',
    desc: 'emit：成员校验改为结构相似性（有 code 字段就算合法因）',
    find: 'if (causedBy !== undefined && !this.members.has(causedBy)) {',
    replace: "if (causedBy !== undefined && typeof causedBy.code !== 'string') {",
  },
  {
    id: 'M25', file: 'diagnostic.ts',
    desc: 'emit：成员校验改查 diags 数组（clear 后仍在 members 泄漏时行为不同）',
    find: 'if (causedBy !== undefined && !this.members.has(causedBy)) {',
    replace: 'if (causedBy !== undefined && !this.diags.includes(causedBy)) {',
    // 注意这不是"改了也行"：它依赖 members 与 diags 始终一一对应这一前提，
    // 而该前提正是 MEMBERS_SIZE_MISMATCH 子句要检查的东西。
    // 两者在合法路径上等价，损坏注入下不等价——由等价差分判定，不在此预判。
  },
  {
    id: 'M26', file: 'diagnostic.ts',
    desc: 'emit：成员校验取反（只接受非成员）',
    find: 'if (causedBy !== undefined && !this.members.has(causedBy)) {',
    replace: 'if (causedBy !== undefined && this.members.has(causedBy)) {',
  },
  {
    id: 'M27', file: 'diagnostic.ts',
    desc: 'emit：FOREIGN_CAUSE 错误码退化为通用 Error',
    find: "throw new Error('E_DIAG_FOREIGN_CAUSE');",
    replace: "throw new Error('E_DIAG_ERROR');",
  },
  {
    id: 'M28', file: 'diagnostic.ts',
    desc: 'emit：用 != null 代替 !== undefined（causedBy 传 null 时行为不同）',
    find: 'if (causedBy !== undefined && !this.members.has(causedBy)) {',
    replace: 'if (causedBy != null && !this.members.has(causedBy)) {',
    expectEquivalent: true,
    // 前提：`causedBy?: Diagnostic` 的类型面不允许 null，且新套件不构造 null。
    // 若将来放开为 `Diagnostic | null`，等价立即失效——那时 null 会绕过校验后
    // 走到 `if (causedBy !== undefined) d.causedBy = causedBy`，写入一个 null 因。
  },

  // ——— emit：构造诊断对象（M29~M40）———
  {
    id: 'M29', file: 'diagnostic.ts',
    desc: 'emit：severity 不取注册表、写死 error',
    find: 'severity: spec.severity,',
    replace: "severity: 'error',",
  },
  {
    id: 'M30', file: 'diagnostic.ts',
    desc: 'emit：source 按引用存（事后改调用方对象会追改已发诊断）',
    find: 'source: { ...source },',
    replace: 'source,',
  },
  {
    id: 'M31', file: 'diagnostic.ts',
    desc: 'emit：source 复制但丢掉 op 字段',
    find: 'source: { ...source },',
    replace: 'source: { layer: source.layer, entityId: source.entityId },',
  },
  {
    id: 'M32', file: 'diagnostic.ts',
    desc: 'emit：source 只留 layer',
    find: 'source: { ...source },',
    replace: 'source: { layer: source.layer },',
  },
  {
    id: 'M33', file: 'diagnostic.ts',
    desc: 'emit：message 退回 `??`（空串被保留，留下无描述的诊断）',
    find: "message: message !== undefined && message.trim() !== '' ? message : code,",
    replace: 'message: message ?? code,',
  },
  {
    id: 'M34', file: 'diagnostic.ts',
    desc: 'emit：message 用 `||`（"0" 会被误判为空而退回 code）',
    find: "message: message !== undefined && message.trim() !== '' ? message : code,",
    replace: 'message: message || code,',
  },
  {
    id: 'M35', file: 'diagnostic.ts',
    desc: 'emit：message 被 trim（前后空格丢失）',
    find: "message: message !== undefined && message.trim() !== '' ? message : code,",
    replace: "message: message !== undefined && message.trim() !== '' ? message.trim() : code,",
  },
  {
    id: 'M36', file: 'diagnostic.ts',
    desc: 'emit：message 恒为 code（传入的描述被丢弃）',
    find: "message: message !== undefined && message.trim() !== '' ? message : code,",
    replace: 'message: code,',
  },
  {
    id: 'M37', file: 'diagnostic.ts',
    desc: 'emit：timestamp 用后自增改为先自增（首条 ts 从 1 开始）',
    find: 'timestamp: this.time++,',
    replace: 'timestamp: ++this.time,',
  },
  {
    id: 'M38', file: 'diagnostic.ts',
    desc: 'emit：timestamp 不自增（所有诊断同 ts）',
    find: 'timestamp: this.time++,',
    replace: 'timestamp: this.time,',
  },
  {
    id: 'M39', file: 'diagnostic.ts',
    desc: 'emit：timestamp 用 diags.length（clear 后与旧世代重号）',
    find: 'timestamp: this.time++,',
    replace: 'timestamp: this.diags.length,',
  },
  {
    id: 'M40', file: 'diagnostic.ts',
    desc: 'emit：恒写 causedBy 键（无因时也写入 undefined）',
    find: `    if (causedBy !== undefined) d.causedBy = causedBy;`,
    replace: `    d.causedBy = causedBy;`,
  },

  // ——— emit：登记与封印（M41~M47）———
  {
    id: 'M41', file: 'diagnostic.ts',
    desc: 'emit：不登记 members（合法因全部被判为 FOREIGN）',
    find: `    this.diags.push(d);
    this.members.add(d);`,
    replace: `    this.diags.push(d);`,
  },
  {
    id: 'M42', file: 'diagnostic.ts',
    desc: 'emit：不 push diags（只登记 members）',
    find: `    this.diags.push(d);
    this.members.add(d);`,
    replace: `    this.members.add(d);`,
  },
  {
    id: 'M43', file: 'diagnostic.ts',
    desc: 'emit：push 改 unshift（顺序反转，时间戳与排列不符）',
    find: 'this.diags.push(d);',
    replace: 'this.diags.unshift(d);',
  },
  {
    id: 'M44', file: 'diagnostic.ts',
    desc: 'emit：fatal 不置 sealed',
    find: "if (spec.severity === 'fatal') this.sealed = true;",
    replace: '',
  },
  {
    id: 'M45', file: 'diagnostic.ts',
    desc: 'emit：任何诊断都置 sealed',
    find: "if (spec.severity === 'fatal') this.sealed = true;",
    replace: 'this.sealed = true;',
  },
  {
    id: 'M46', file: 'diagnostic.ts',
    desc: 'emit：sealed 判据看 recoverable 而非 severity',
    find: "if (spec.severity === 'fatal') this.sealed = true;",
    replace: 'if (!spec.recoverable) this.sealed = true;',
    // expectEquivalent 已移除：l11-invariant-checker.test.ts 用 Map.prototype.set.bind 绕过
    // sealRegistry，直接篡改 spec，使 recoverable 与 severity 失同步——前提条件被测试本身违反，
    // 两条判据在测试现场不等价。驱动器实测：M46 被杀死。
  },
  {
    id: 'M47', file: 'diagnostic.ts',
    desc: 'emit：返回克隆而非本体（因果链身份断裂）',
    find: `    if (spec.severity === 'fatal') this.sealed = true;
    return d;`,
    replace: `    if (spec.severity === 'fatal') this.sealed = true;
    return { ...d };`,
  },

  // ——— getter（M48~M55）———
  {
    id: 'M48', file: 'diagnostic.ts',
    desc: 'all：返回内部数组本体（外泄，调用方可清空 collector）',
    find: 'return [...this.diags];',
    replace: 'return this.diags;',
  },
  {
    id: 'M49', file: 'diagnostic.ts',
    desc: 'all：返回排序后的副本（emit 顺序被抹掉）',
    find: 'return [...this.diags];',
    replace: 'return [...this.diags].sort((a, b) => a.code.localeCompare(b.code));',
  },
  {
    id: 'M50', file: 'diagnostic.ts',
    desc: 'all：深克隆元素（因果链身份断裂）',
    find: 'return [...this.diags];',
    replace: 'return this.diags.map((d) => ({ ...d }));',
  },
  {
    id: 'M51', file: 'diagnostic.ts',
    desc: 'fatals：筛选条件改为 error',
    find: "return this.diags.filter((d) => d.severity === 'fatal');",
    replace: "return this.diags.filter((d) => d.severity === 'error');",
  },
  {
    id: 'M52', file: 'diagnostic.ts',
    desc: 'fatals：改用注册表的 severity 而非诊断自身的（篡改 severity 时不再被检出）',
    find: "return this.diags.filter((d) => d.severity === 'fatal');",
    replace: "return this.diags.filter((d) => CODE_REGISTRY.get(d.code)?.severity === 'fatal');",
  },
  {
    id: 'M53', file: 'diagnostic.ts',
    desc: 'errors：筛选条件改为非 fatal（把 warn/info 也算进 error）',
    find: "return this.diags.filter((d) => d.severity === 'error');",
    replace: "return this.diags.filter((d) => d.severity !== 'fatal');",
  },
  {
    id: 'M54', file: 'diagnostic.ts',
    desc: 'isSealed：返回"有 fatal"而非 sealed 位（掩盖两者失同步）',
    find: `  get isSealed(): boolean {
    return this.sealed;`,
    replace: `  get isSealed(): boolean {
    return this.fatals.length > 0;`,
  },
  {
    id: 'M55', file: 'diagnostic.ts',
    desc: 'isSealed：取反',
    find: `  get isSealed(): boolean {
    return this.sealed;`,
    replace: `  get isSealed(): boolean {
    return !this.sealed;`,
  },

  // ——— chainOf（M56~M64）———
  {
    id: 'M56', file: 'diagnostic.ts',
    desc: 'chainOf：去掉 maxDepth 合法性校验（0 会报成 CHAIN_TOO_DEEP）',
    find: `    if (!Number.isInteger(maxDepth) || maxDepth < 1) {`,
    replace: `    if (false) {`,
  },
  {
    id: 'M57', file: 'diagnostic.ts',
    desc: 'chainOf：maxDepth 校验只查整数、不查下界',
    find: 'if (!Number.isInteger(maxDepth) || maxDepth < 1) {',
    replace: 'if (!Number.isInteger(maxDepth)) {',
  },
  {
    id: 'M58', file: 'diagnostic.ts',
    desc: 'chainOf：maxDepth 下界写成 < 0（0 被放行）',
    find: 'if (!Number.isInteger(maxDepth) || maxDepth < 1) {',
    replace: 'if (!Number.isInteger(maxDepth) || maxDepth < 0) {',
  },
  {
    id: 'M59', file: 'diagnostic.ts',
    desc: 'chainOf：非法 maxDepth 错误码退化为通用 Error',
    find: "throw new Error('E_DIAG_INVALID_MAXDEPTH');",
    replace: "throw new Error('E_DIAG_ERROR');",
  },
  {
    id: 'M60', file: 'diagnostic.ts',
    desc: 'chainOf：去掉环检测（环图上无限循环直至预算耗尽，报 TOO_DEEP 而非 CYCLE）',
    find: `      if (seen.has(cur)) throw new Error('E_DIAG_CAUSAL_CYCLE');
      seen.add(cur);
      chain.push(cur);`,
    replace: `      chain.push(cur);`,
  },
  {
    id: 'M61', file: 'diagnostic.ts',
    desc: 'chainOf：环检测错误码退化为通用 Error',
    find: "if (seen.has(cur)) throw new Error('E_DIAG_CAUSAL_CYCLE');",
    replace: "if (seen.has(cur)) throw new Error('E_DIAG_ERROR');",
  },
  {
    id: 'M62', file: 'diagnostic.ts',
    desc: 'chainOf：预算边界改为 <=（多展开一节）',
    find: 'while (cur && chain.length < maxDepth) {',
    replace: 'while (cur && chain.length <= maxDepth) {',
  },
  {
    id: 'M63', file: 'diagnostic.ts',
    desc: 'chainOf：超预算不报错、静默截断',
    find: `    if (cur) throw new Error('E_DIAG_CHAIN_TOO_DEEP');`,
    replace: '',
  },
  {
    id: 'M64', file: 'diagnostic.ts',
    desc: 'chainOf：超预算错误码退化为通用 Error',
    find: "if (cur) throw new Error('E_DIAG_CHAIN_TOO_DEEP');",
    replace: "if (cur) throw new Error('E_DIAG_ERROR');",
  },

  // ——— walkChainForCheck（M65~M71）———
  {
    id: 'M65', file: 'diagnostic.ts',
    desc: 'walkChainForCheck：改用 chainOf（回归 C01——合法长链被判数据损坏）',
    find: `      const w = this.walkChainForCheck(d);
      if (w.err) violations.push(\`CHAIN:\${d.code}:\${w.err}\`);`,
    replace: `      try {
        this.chainOf(d);
      } catch (e) {
        violations.push(\`CHAIN:\${d.code}:\${(e as Error).message}\`);
      }`,
  },
  {
    id: 'M66', file: 'diagnostic.ts',
    desc: 'walkChainForCheck：去掉环检测（环图上死循环）',
    find: `      if (seen.has(cur)) return { len, err: 'E_DIAG_CAUSAL_CYCLE' };
      seen.add(cur);`,
    replace: '',
  },
  {
    id: 'M67', file: 'diagnostic.ts',
    desc: 'walkChainForCheck：上界改为写死 64（长链假警报）',
    find: 'const cap = this.diags.length + 1;',
    replace: 'const cap = 64;',
  },
  {
    id: 'M68', file: 'diagnostic.ts',
    desc: 'walkChainForCheck：上界少 1（满员长链假警报）',
    find: 'const cap = this.diags.length + 1;',
    replace: 'const cap = this.diags.length;',
  },
  {
    id: 'M69', file: 'diagnostic.ts',
    desc: 'walkChainForCheck：上界改为 Infinity（外来长链不再被检出）',
    find: 'const cap = this.diags.length + 1;',
    replace: 'const cap = Number.POSITIVE_INFINITY;',
  },
  {
    id: 'M70', file: 'diagnostic.ts',
    desc: 'walkChainForCheck：超上界不报错',
    find: "      if (len > cap) return { len, err: 'E_DIAG_CHAIN_EXCEEDS_MEMBERSHIP' };",
    replace: '',
  },
  {
    id: 'M71', file: 'diagnostic.ts',
    desc: 'walkChainForCheck：环与超深共用同一错误码（无法区分两种损坏）',
    find: "if (seen.has(cur)) return { len, err: 'E_DIAG_CAUSAL_CYCLE' };",
    replace: "if (seen.has(cur)) return { len, err: 'E_DIAG_CHAIN_EXCEEDS_MEMBERSHIP' };",
  },

  // ——— clear（M72~M75）———
  {
    id: 'M72', file: 'diagnostic.ts',
    desc: 'clear：不清 members（旧世代诊断仍算合法因）',
    find: '    this.members.clear();',
    replace: '',
  },
  {
    id: 'M73', file: 'diagnostic.ts',
    desc: 'clear：不复位 sealed',
    find: `    this.diags = [];
    this.sealed = false;`,
    replace: `    this.diags = [];`,
  },
  {
    id: 'M74', file: 'diagnostic.ts',
    desc: 'clear：不清 diags（只复位 sealed）',
    find: `    this.diags = [];
    this.sealed = false;`,
    replace: `    this.sealed = false;`,
  },
  {
    id: 'M75', file: 'diagnostic.ts',
    desc: 'clear：重置 time（跨世代 timestamp 重号）',
    find: `    this.members.clear();`,
    replace: `    this.members.clear();
    this.time = 0;`,
  },

  // ——— checkInvariants：正向子句（M76~M87）———
  {
    id: 'M76', file: 'diagnostic.ts',
    desc: 'checkInvariants：去掉 UNREGISTERED 子句',
    find: `      if (!spec) {
        violations.push(\`UNREGISTERED:\${d.code}\`);
        continue;
      }`,
    replace: `      if (!spec) {
        continue;
      }`,
  },
  {
    id: 'M77', file: 'diagnostic.ts',
    desc: 'checkInvariants：UNREGISTERED 不带 code',
    find: 'violations.push(`UNREGISTERED:${d.code}`);',
    replace: "violations.push('UNREGISTERED');",
  },
  {
    id: 'M78', file: 'diagnostic.ts',
    desc: 'checkInvariants：UNREGISTERED 后不 continue（后续子句对 undefined spec 取属性）',
    find: `        violations.push(\`UNREGISTERED:\${d.code}\`);
        continue;`,
    replace: `        violations.push(\`UNREGISTERED:\${d.code}\`);`,
  },
  {
    id: 'M79', file: 'diagnostic.ts',
    desc: 'checkInvariants：去掉 SEVERITY_MISMATCH 子句',
    find: `      if (spec.severity !== d.severity) {
        violations.push(\`SEVERITY_MISMATCH:\${d.code} reg=\${spec.severity} got=\${d.severity}\`);
      }`,
    replace: '',
  },
  {
    id: 'M80', file: 'diagnostic.ts',
    desc: 'checkInvariants：SEVERITY_MISMATCH 的 reg/got 写反',
    find: 'violations.push(`SEVERITY_MISMATCH:${d.code} reg=${spec.severity} got=${d.severity}`);',
    replace: 'violations.push(`SEVERITY_MISMATCH:${d.code} reg=${d.severity} got=${spec.severity}`);',
  },
  {
    id: 'M81', file: 'diagnostic.ts',
    desc: 'checkInvariants：去掉 BAD_PREFIX 子句',
    find: `      if (!VALID_PREFIXES.has(spec.prefix)) {
        violations.push(\`BAD_PREFIX:\${d.code} prefix=\${spec.prefix}\`);
      }`,
    replace: '',
  },
  {
    id: 'M82', file: 'diagnostic.ts',
    desc: 'checkInvariants：BAD_PREFIX 判据取反',
    find: 'if (!VALID_PREFIXES.has(spec.prefix)) {',
    replace: 'if (VALID_PREFIXES.has(spec.prefix)) {',
  },
  {
    id: 'M83', file: 'diagnostic.ts',
    desc: 'checkInvariants：去掉 NO_ATTRIBUTION 子句',
    find: `      if (!d.source || !d.source.layer) {
        violations.push(\`NO_ATTRIBUTION:\${d.code}\`);
      }`,
    replace: '',
  },
  {
    id: 'M84', file: 'diagnostic.ts',
    desc: 'checkInvariants：NO_ATTRIBUTION 只查 source 存在、不查 layer',
    find: 'if (!d.source || !d.source.layer) {',
    replace: 'if (!d.source) {',
  },
  {
    id: 'M85', file: 'diagnostic.ts',
    desc: 'checkInvariants：去掉 FATAL_RECOVERABLE 子句',
    find: `      if (d.severity === 'fatal' && spec.recoverable) {
        violations.push(\`FATAL_RECOVERABLE:\${d.code}\`);
      }`,
    replace: '',
  },
  {
    id: 'M86', file: 'diagnostic.ts',
    desc: 'checkInvariants：FATAL_RECOVERABLE 判据看 spec.severity 而非 d.severity',
    find: "if (d.severity === 'fatal' && spec.recoverable) {",
    replace: "if (spec.severity === 'fatal' && spec.recoverable) {",
  },
  {
    id: 'M87', file: 'diagnostic.ts',
    desc: 'checkInvariants：FATAL_RECOVERABLE 的两个条件改为或',
    find: "if (d.severity === 'fatal' && spec.recoverable) {",
    replace: "if (d.severity === 'fatal' || spec.recoverable) {",
  },

  // ——— checkInvariants：因果子句（M88~M93）———
  {
    id: 'M88', file: 'diagnostic.ts',
    desc: 'checkInvariants：去掉 CAUSE_NOT_EARLIER 子句',
    find: `      if (d.causedBy && d.causedBy.timestamp >= d.timestamp) {
        violations.push(\`CAUSE_NOT_EARLIER:\${d.code} cause=\${d.causedBy.timestamp} effect=\${d.timestamp}\`);
      }`,
    replace: '',
  },
  {
    id: 'M89', file: 'diagnostic.ts',
    desc: 'checkInvariants：CAUSE_NOT_EARLIER 用 > 而非 >=（同 ts 被放行）',
    find: 'if (d.causedBy && d.causedBy.timestamp >= d.timestamp) {',
    replace: 'if (d.causedBy && d.causedBy.timestamp > d.timestamp) {',
  },
  {
    id: 'M90', file: 'diagnostic.ts',
    desc: 'checkInvariants：CAUSE_NOT_EARLIER 方向反（要求因晚于果）',
    find: 'if (d.causedBy && d.causedBy.timestamp >= d.timestamp) {',
    replace: 'if (d.causedBy && d.causedBy.timestamp <= d.timestamp) {',
  },
  {
    id: 'M91', file: 'diagnostic.ts',
    desc: 'checkInvariants：CAUSE_NOT_EARLIER 的 cause/effect 取值写反',
    find: 'violations.push(`CAUSE_NOT_EARLIER:${d.code} cause=${d.causedBy.timestamp} effect=${d.timestamp}`);',
    replace: 'violations.push(`CAUSE_NOT_EARLIER:${d.code} cause=${d.timestamp} effect=${d.causedBy.timestamp}`);',
  },
  {
    id: 'M92', file: 'diagnostic.ts',
    desc: 'checkInvariants：去掉 FOREIGN_CAUSE 子句',
    find: `      if (d.causedBy && !this.members.has(d.causedBy)) {
        violations.push(\`FOREIGN_CAUSE:\${d.code} cause=\${d.causedBy.code}\`);
      }`,
    replace: '',
  },
  {
    id: 'M93', file: 'diagnostic.ts',
    desc: 'checkInvariants：FOREIGN_CAUSE 判据改查 diags（O(n²) 且与 members 失同步时不同）',
    find: 'if (d.causedBy && !this.members.has(d.causedBy)) {',
    replace: 'if (d.causedBy && !this.diags.includes(d.causedBy)) {',
  },

  // ——— checkInvariants：单调性与封印（M94~M101）———
  {
    id: 'M94', file: 'diagnostic.ts',
    desc: 'checkInvariants：去掉 NON_MONOTONIC_TS 子句',
    find: `      if (curr!.timestamp <= prev!.timestamp) {
        violations.push(\`NON_MONOTONIC_TS at \${i}\`);
      }`,
    replace: '',
  },
  {
    id: 'M95', file: 'diagnostic.ts',
    desc: 'checkInvariants：单调性用 < 而非 <=（相邻同 ts 被放行）',
    find: 'if (curr!.timestamp <= prev!.timestamp) {',
    replace: 'if (curr!.timestamp < prev!.timestamp) {',
  },
  {
    id: 'M96', file: 'diagnostic.ts',
    desc: 'checkInvariants：单调性循环从 0 起（prev 为 undefined）',
    find: 'for (let i = 1; i < this.diags.length; i++) {',
    replace: 'for (let i = 0; i < this.diags.length; i++) {',
  },
  {
    id: 'M97', file: 'diagnostic.ts',
    desc: 'checkInvariants：单调性只查最后一对',
    find: 'for (let i = 1; i < this.diags.length; i++) {',
    replace: 'for (let i = Math.max(1, this.diags.length - 1); i < this.diags.length; i++) {',
  },
  {
    id: 'M98', file: 'diagnostic.ts',
    desc: 'checkInvariants：去掉 FATAL_NOT_SEALED 子句',
    find: `    if (this.fatals.length > 0 && !this.sealed) {
      violations.push('FATAL_NOT_SEALED');
    }`,
    replace: '',
  },
  {
    id: 'M99', file: 'diagnostic.ts',
    desc: 'checkInvariants：去掉 SEALED_WITHOUT_FATAL 反向子句（回归 C05）',
    find: `    if (this.fatals.length === 0 && this.sealed) {
      violations.push('SEALED_WITHOUT_FATAL');
    }`,
    replace: '',
  },
  {
    id: 'M100', file: 'diagnostic.ts',
    desc: 'checkInvariants：两个封印子句共用同一诊断串（无法区分方向）',
    find: "      violations.push('SEALED_WITHOUT_FATAL');",
    replace: "      violations.push('FATAL_NOT_SEALED');",
  },
  {
    id: 'M101', file: 'diagnostic.ts',
    desc: 'checkInvariants：封印子句合并为 !==（两个方向报同一条）',
    find: `    if (this.fatals.length > 0 && !this.sealed) {
      violations.push('FATAL_NOT_SEALED');
    }`,
    replace: `    if ((this.fatals.length > 0) !== this.sealed) {
      violations.push('FATAL_NOT_SEALED');
    }`,
  },

  // ——— checkInvariants：members 与 ts 唯一性（M102~M108）———
  {
    id: 'M102', file: 'diagnostic.ts',
    desc: 'checkInvariants：去掉 MEMBERS_SIZE_MISMATCH 子句',
    find: `    if (this.members.size !== this.diags.length) {
      violations.push(\`MEMBERS_SIZE_MISMATCH members=\${this.members.size} diags=\${this.diags.length}\`);
    }`,
    replace: '',
  },
  {
    id: 'M103', file: 'diagnostic.ts',
    desc: 'checkInvariants：MEMBERS_SIZE 只查 members 少于 diags（多出项漏检）',
    find: 'if (this.members.size !== this.diags.length) {',
    replace: 'if (this.members.size < this.diags.length) {',
  },
  {
    id: 'M104', file: 'diagnostic.ts',
    desc: 'checkInvariants：去掉 MEMBERS_MISSING 逐条子句',
    find: `    for (const d of this.diags) {
      if (!this.members.has(d)) {
        violations.push(\`MEMBERS_MISSING:\${d.code}@\${d.timestamp}\`);
      }
    }`,
    replace: '',
  },
  {
    id: 'M105', file: 'diagnostic.ts',
    desc: 'checkInvariants：MEMBERS_MISSING 不带 timestamp（同码多条无法定位）',
    find: 'violations.push(`MEMBERS_MISSING:${d.code}@${d.timestamp}`);',
    replace: 'violations.push(`MEMBERS_MISSING:${d.code}`);',
  },
  {
    id: 'M106', file: 'diagnostic.ts',
    desc: 'checkInvariants：去掉 DUPLICATE_TS 子句（非相邻重号漏检）',
    find: `    const tsSeen = new Set<number>();
    for (const d of this.diags) {
      if (tsSeen.has(d.timestamp)) violations.push(\`DUPLICATE_TS:\${d.timestamp}\`);
      tsSeen.add(d.timestamp);
    }`,
    replace: '',
  },
  {
    id: 'M107', file: 'diagnostic.ts',
    desc: 'checkInvariants：DUPLICATE_TS 的 add 提到判断之前（永不触发）',
    find: `      if (tsSeen.has(d.timestamp)) violations.push(\`DUPLICATE_TS:\${d.timestamp}\`);
      tsSeen.add(d.timestamp);`,
    replace: `      tsSeen.add(d.timestamp);
      if (tsSeen.has(d.timestamp)) violations.push(\`DUPLICATE_TS:\${d.timestamp}\`);`,
  },
  {
    id: 'M108', file: 'diagnostic.ts',
    desc: 'checkInvariants：整体返回空数组（检查器彻底失效）',
    find: '    return violations;\n  }\n\n  /**\n   * 注册表自洽性检查',
    replace: '    return [];\n  }\n\n  /**\n   * 注册表自洽性检查',
  },

  // ——— checkRegistry（M109~M116）———
  {
    id: 'M109', file: 'diagnostic.ts',
    desc: 'checkRegistry：去掉 REG_KEY_MISMATCH 子句',
    find: 'if (key !== spec.code) violations.push(`REG_KEY_MISMATCH:${key} vs ${spec.code}`);',
    replace: '',
  },
  {
    id: 'M110', file: 'diagnostic.ts',
    desc: 'checkRegistry：去掉 REG_BAD_PREFIX 子句',
    find: 'if (!VALID_PREFIXES.has(spec.prefix)) violations.push(`REG_BAD_PREFIX:${key} prefix=${spec.prefix}`);',
    replace: '',
  },
  {
    id: 'M111', file: 'diagnostic.ts',
    desc: 'checkRegistry：去掉 REG_PREFIX_NOT_DERIVED 子句',
    find: `      if (spec.prefix !== key.split('_').slice(0, 2).join('_')) {
        violations.push(\`REG_PREFIX_NOT_DERIVED:\${key} prefix=\${spec.prefix}\`);
      }`,
    replace: '',
  },
  {
    id: 'M112', file: 'diagnostic.ts',
    desc: 'checkRegistry：REG_PREFIX_NOT_DERIVED 取三段',
    find: "if (spec.prefix !== key.split('_').slice(0, 2).join('_')) {",
    replace: "if (spec.prefix !== key.split('_').slice(0, 3).join('_')) {",
  },
  {
    id: 'M113', file: 'diagnostic.ts',
    desc: 'checkRegistry：去掉 REG_FATAL_RECOVERABLE 子句',
    find: "      if (spec.severity === 'fatal' && spec.recoverable) violations.push(`REG_FATAL_RECOVERABLE:${key}`);",
    replace: '',
  },
  {
    id: 'M114', file: 'diagnostic.ts',
    desc: 'checkRegistry：去掉 REG_NONFATAL_UNRECOVERABLE 反向子句（回归 C08）',
    find: "      if (spec.severity !== 'fatal' && !spec.recoverable) violations.push(`REG_NONFATAL_UNRECOVERABLE:${key}`);",
    replace: '',
  },
  {
    id: 'M115', file: 'diagnostic.ts',
    desc: 'checkRegistry：两个 recoverable 子句共用同一诊断串',
    find: 'violations.push(`REG_NONFATAL_UNRECOVERABLE:${key}`);',
    replace: 'violations.push(`REG_FATAL_RECOVERABLE:${key}`);',
  },
  {
    id: 'M116', file: 'diagnostic.ts',
    desc: 'checkRegistry：去掉 REG_SPEC_MUTABLE 子句',
    find: 'if (!Object.isFrozen(spec)) violations.push(`REG_SPEC_MUTABLE:${key}`);',
    replace: '',
  },
];
