/**
 * L12 变异体清单。
 *
 * 每个 find 必须在目标文件中**恰好命中一次**，否则驱动器记为 INVALID 并
 * 排除出得分——避免"改了个不存在的字符串"被静默算成击杀。
 *
 * 变异体必须语法合法。若删掉一段留下语法错误，"击杀"来自编译器而非任何
 * 测试，那是假击杀，会掩盖真实盲区（L4 的 M51 就是这么被发现的）。
 *
 * expectEquivalent=true 表示该变异在当前契约下确实不可观测，存活为正确结论；
 * 这类变异体不计入得分，但必须由差分模糊器独立证明其等价性。
 */
export interface Mutant {
  id: string;
  file: 'persistence.ts' | 'migration.ts';
  desc: string;
  find: string;
  replace: string;
  expectEquivalent?: boolean;
}

export const MUTANTS: Mutant[] = [
  // ---------- cloneState 与别名 ----------
  {
    id: 'M01', file: 'persistence.ts', desc: 'cloneState 不再深拷贝 props（浅拷贝）',
    find: '  return { ...s, props: { ...s.props } };',
    replace: '  return { ...s };',
  },
  {
    id: 'M02', file: 'persistence.ts', desc: 'cloneState 直接返回入参（完全不拷贝）',
    find: 'export function cloneState(s: WorldState): WorldState {\n  return { ...s, props: { ...s.props } };\n}',
    replace: 'export function cloneState(s: WorldState): WorldState {\n  return s;\n}',
  },
  {
    id: 'M03', file: 'persistence.ts', desc: 'takeSnapshot 按引用持有状态',
    find: '    return { id: `snap:${seq}`, state: cloneState(state), createdAt: seq };',
    replace: '    return { id: `snap:${seq}`, state, createdAt: seq };',
  },
  {
    id: 'M04', file: 'persistence.ts', desc: 'checkpoint 存入时不拷贝',
    find: '    this.checkpoints.set(label, cloneState(state));',
    replace: '    this.checkpoints.set(label, state);',
  },
  {
    id: 'M05', file: 'persistence.ts', desc: 'restore 返回内部引用',
    find: "    if (!s) throw new Error('E_PERSIST_CHECKPOINT_NOT_FOUND');\n    return cloneState(s);",
    replace: "    if (!s) throw new Error('E_PERSIST_CHECKPOINT_NOT_FOUND');\n    return s;",
  },
  {
    id: 'M06', file: 'persistence.ts', desc: 'markBoundary 存入活引用',
    find: '    this.snapshots.push(cloneState(state));',
    replace: '    this.snapshots.push(state);',
  },
  {
    id: 'M07', file: 'persistence.ts', desc: 'rewind 返回内部引用',
    find: '    return cloneState(this.snapshots[idx]!);',
    replace: '    return this.snapshots[idx]!;',
  },
  {
    id: 'M08', file: 'persistence.ts', desc: 'replay 直接以 seed 起步（不克隆）',
    find: '  let state = cloneState(seed);',
    replace: '  let state = seed;',
  },

  // ---------- 发号器 ----------
  {
    id: 'M09', file: 'persistence.ts', desc: '快照编号从 0 起（后置递增）',
    find: '    const seq = ++this.counter;',
    replace: '    const seq = this.counter++;',
  },
  {
    id: 'M10', file: 'persistence.ts', desc: '快照编号不递增，恒为 1',
    find: '    const seq = ++this.counter;',
    replace: '    const seq = this.counter + 1;',
  },
  {
    id: 'M11', file: 'persistence.ts', desc: 'createdAt 与编号脱钩，恒为 0',
    find: 'state: cloneState(state), createdAt: seq };',
    replace: 'state: cloneState(state), createdAt: 0 };',
  },
  {
    id: 'M12', file: 'persistence.ts', desc: 'count 返回 0',
    find: '  count(): number {\n    return this.counter;\n  }',
    replace: '  count(): number {\n    return 0;\n  }',
  },
  {
    id: 'M13', file: 'persistence.ts', desc: 'resetSnapshotCounter 变成空操作',
    find: '  (defaultSnapshotStore as unknown as { counter: number }).counter = 0;',
    replace: '  /* no-op */',
  },

  // ---------- 版本判据 ----------
  {
    id: 'M14', file: 'persistence.ts', desc: '版本正则去掉起始锚',
    find: 'export const VERSION_PATTERN = /^\\d+\\.\\d+\\.\\d+$/;',
    replace: 'export const VERSION_PATTERN = /\\d+\\.\\d+\\.\\d+$/;',
  },
  {
    id: 'M15', file: 'persistence.ts', desc: '版本正则去掉结束锚',
    find: 'export const VERSION_PATTERN = /^\\d+\\.\\d+\\.\\d+$/;',
    replace: 'export const VERSION_PATTERN = /^\\d+\\.\\d+\\.\\d+/;',
  },
  {
    id: 'M16', file: 'persistence.ts', desc: '版本正则只要两段',
    find: 'export const VERSION_PATTERN = /^\\d+\\.\\d+\\.\\d+$/;',
    replace: 'export const VERSION_PATTERN = /^\\d+\\.\\d+$/;',
  },
  {
    id: 'M17', file: 'persistence.ts', desc: '版本校验恒为真',
    find: '  return VERSION_PATTERN.test(v);',
    replace: '  return true;',
  },
  {
    id: 'M18', file: 'persistence.ts', desc: '版本正则允许任意字符段',
    find: 'export const VERSION_PATTERN = /^\\d+\\.\\d+\\.\\d+$/;',
    replace: 'export const VERSION_PATTERN = /^.+\\..+\\..+$/;',
  },

  // ---------- checkWorldState 判据 ----------
  {
    id: 'M19', file: 'persistence.ts', desc: 'checkWorldState 恒返回空（自检失效）',
    find: 'export function checkWorldState(s: WorldState, where = \'state\'): string[] {\n  const v: string[] = [];',
    replace: 'export function checkWorldState(s: WorldState, where = \'state\'): string[] {\n  const v: string[] = [];\n  if (s) return v;',
  },
  {
    id: 'M20', file: 'persistence.ts', desc: '不再校验 version',
    find: '  if (typeof s.version !== \'string\' || !isWellFormedVersion(s.version)) {',
    replace: '  if (false) {',
  },
  {
    id: 'M21', file: 'persistence.ts', desc: '不再校验 playpackId 空串',
    find: '  if (typeof s.playpackId !== \'string\' || s.playpackId.length === 0) {',
    replace: '  if (typeof s.playpackId !== \'string\') {',
  },
  {
    id: 'M22', file: 'persistence.ts', desc: 'phaseIndex 允许负数',
    find: '  if (!Number.isInteger(s.phaseIndex) || s.phaseIndex < 0) {',
    replace: '  if (!Number.isInteger(s.phaseIndex)) {',
  },
  {
    id: 'M23', file: 'persistence.ts', desc: 'phaseIndex 允许非整数',
    find: '  if (!Number.isInteger(s.phaseIndex) || s.phaseIndex < 0) {',
    replace: '  if (s.phaseIndex < 0) {',
  },
  {
    id: 'M24', file: 'persistence.ts', desc: 'randomCounter 允许负数',
    find: '  if (!Number.isInteger(s.randomCounter) || s.randomCounter < 0) {',
    replace: '  if (!Number.isInteger(s.randomCounter)) {',
  },
  {
    id: 'M25', file: 'persistence.ts', desc: 'props 非对象不再报错',
    find: '  if (s.props === null || typeof s.props !== \'object\') {',
    replace: '  if (false) {',
  },
  {
    id: 'M26', file: 'persistence.ts', desc: 'props 内非有限数不再报错',
    find: '      if (typeof n !== \'number\' || !Number.isFinite(n)) {',
    replace: '      if (typeof n !== \'number\') {',
  },
  {
    /**
     * 等价：Number.isFinite 不做类型转换，对字符串 / null / 对象一律返回 false，
     * 故 typeof 前置判断是冗余的。与 M26 的差别在于 M26 删掉的是 isFinite
     * 本身（NaN/Infinity 就漏过去了），那一条确实可观测。
     */
    id: 'M27', file: 'persistence.ts', desc: 'props 内非数字不再报错（typeof 前置判断冗余）',
    find: '      if (typeof n !== \'number\' || !Number.isFinite(n)) {',
    replace: '      if (!Number.isFinite(n)) {',
    expectEquivalent: true,
  },
  {
    id: 'M28', file: 'persistence.ts', desc: '违规只报第一条就返回',
    find: '  return v;\n}\n\n/**\n * 快照发号器。',
    replace: '  return v.slice(0, 1);\n}\n\n/**\n * 快照发号器。',
  },
  {
    id: 'M29', file: 'persistence.ts', desc: 'where 参数被忽略（定位信息丢失）',
    find: 'export function checkWorldState(s: WorldState, where = \'state\'): string[] {',
    replace: 'export function checkWorldState(s: WorldState, whereIn = \'state\'): string[] {\n  const where = \'state\';\n  void whereIn;',
  },

  // ---------- Journal ----------
  {
    id: 'M30', file: 'persistence.ts', desc: 'append 使用后置递增，首条 seq 为 0',
    find: '    this.records.push({ seq: ++this.seq, op });',
    replace: '    this.records.push({ seq: this.seq++, op });',
  },
  {
    id: 'M31', file: 'persistence.ts', desc: 'append 不递增发号器（全部同号）',
    find: '    this.records.push({ seq: ++this.seq, op });',
    replace: '    this.records.push({ seq: this.seq, op });',
  },
  {
    id: 'M32', file: 'persistence.ts', desc: 'since 用 >= 而非 >（多返回一条）',
    find: '    return this.records.filter((r) => r.seq > seq);',
    replace: '    return this.records.filter((r) => r.seq >= seq);',
  },
  {
    id: 'M33', file: 'persistence.ts', desc: 'trim 保留最前 N 条而非最后 N 条',
    find: '      this.records = this.records.slice(this.records.length - maxRecords);',
    replace: '      this.records = this.records.slice(0, maxRecords);',
  },
  {
    /**
     * 等价：maxRecords=0 时落到下面的 `slice(length - 0)` = `slice(length)` = []，
     * 与提前清空同结果；负数在两种写法下都进清空分支。
     * 提前返回只是省了一次 slice，不改变可观测行为。
     */
    id: 'M34', file: 'persistence.ts', desc: 'trim(0) 由提前清空改为落入 slice 分支',
    find: '    if (maxRecords <= 0) {\n      this.records = [];\n      return;\n    }',
    replace: '    if (maxRecords < 0) {\n      this.records = [];\n      return;\n    }',
    expectEquivalent: true,
  },
  {
    /**
     * 等价：length === maxRecords 时 `slice(length - maxRecords)` = `slice(0)`，
     * 得到的是同内容的整份副本。多做一次拷贝，不改变可观测内容。
     */
    id: 'M35', file: 'persistence.ts', desc: 'trim 边界用 >=（相等时多做一次整份 slice）',
    find: '    if (this.records.length > maxRecords) {',
    replace: '    if (this.records.length >= maxRecords) {',
    expectEquivalent: true,
  },
  {
    id: 'M36', file: 'persistence.ts', desc: 'clear 不重置发号器',
    find: '  clear(): void {\n    this.records = [];\n    this.seq = 0;\n  }',
    replace: '  clear(): void {\n    this.records = [];\n  }',
  },
  {
    id: 'M37', file: 'persistence.ts', desc: 'Journal 自检不查严格递增',
    find: '      if (r.seq <= prev) v.push(`记录 seq 非严格递增: ${prev} 之后出现 ${r.seq}`);',
    replace: '      if (r.seq < prev) v.push(`记录 seq 非严格递增: ${prev} 之后出现 ${r.seq}`);',
  },
  {
    id: 'M38', file: 'persistence.ts', desc: 'Journal 自检不查发号器回退',
    find: '    if (this.seq < max) {',
    replace: '    if (false) {',
  },
  {
    id: 'M39', file: 'persistence.ts', desc: 'Journal 自检不查 op 合法性',
    find: '      if (r.op === null || typeof r.op !== \'object\' || typeof r.op.apply !== \'function\') {',
    replace: '      if (false) {',
  },
  {
    id: 'M40', file: 'persistence.ts', desc: 'Journal 自检不查 seq 整数性',
    find: '      if (!Number.isInteger(r.seq)) v.push(`记录 seq 非整数: ${r.seq}`);',
    replace: '      if (false) v.push(`记录 seq 非整数: ${r.seq}`);',
  },

  // ---------- CheckpointStore ----------
  {
    id: 'M41', file: 'persistence.ts', desc: 'checkpoint 每次都往 order 追加（重复标签）',
    find: '    if (!this.checkpoints.has(label)) this.order.push(label);',
    replace: '    this.order.push(label);',
  },
  {
    id: 'M42', file: 'persistence.ts', desc: 'checkpoint 从不登记 order',
    find: '    if (!this.checkpoints.has(label)) this.order.push(label);',
    replace: '    if (false) this.order.push(label);',
  },
  {
    id: 'M43', file: 'persistence.ts', desc: 'restore 缺失时返回 undefined 而非抛错',
    find: "    if (!s) throw new Error('E_PERSIST_CHECKPOINT_NOT_FOUND');",
    replace: '    if (!s) return undefined as unknown as WorldState;',
  },
  {
    id: 'M44', file: 'persistence.ts', desc: 'list 返回内部数组引用',
    find: '  list(): string[] {\n    return [...this.order];\n  }',
    replace: '  list(): string[] {\n    return this.order;\n  }',
  },
  {
    id: 'M45', file: 'persistence.ts', desc: 'remove 不清理 order',
    find: '    const idx = this.order.indexOf(label);\n    if (idx !== -1) this.order.splice(idx, 1);',
    replace: '    /* order 不清理 */',
  },
  {
    id: 'M46', file: 'persistence.ts', desc: 'remove 不删除状态',
    find: '    this.checkpoints.delete(label);\n    const idx = this.order.indexOf(label);',
    replace: '    const idx = this.order.indexOf(label);',
  },
  {
    id: 'M47', file: 'persistence.ts', desc: '检查点自检不查 order 与集合一致',
    find: '      if (!this.checkpoints.has(label)) {',
    replace: '      if (false) {',
  },
  {
    id: 'M48', file: 'persistence.ts', desc: '检查点自检不查重复标签',
    find: '      if (seen.has(label)) v.push(`order 内标签重复: ${JSON.stringify(label)}`);',
    replace: '      if (false) v.push(`order 内标签重复: ${JSON.stringify(label)}`);',
  },
  {
    id: 'M49', file: 'persistence.ts', desc: '检查点自检不查未登记的检查点',
    find: '      if (!seen.has(label)) v.push(`检查点未登记进 order: ${JSON.stringify(label)}`);',
    replace: '      if (false) v.push(`检查点未登记进 order: ${JSON.stringify(label)}`);',
  },
  {
    id: 'M50', file: 'persistence.ts', desc: '检查点自检不递归校验状态良构性',
    find: '    for (const [label, s] of this.checkpoints) {\n      v.push(...checkWorldState(s, `检查点[${JSON.stringify(label)}]`));\n    }',
    replace: '    /* 不递归校验 */',
  },

  // ---------- PhaseBoundaryLog ----------
  {
    id: 'M51', file: 'persistence.ts', desc: 'rewind 下标偏移 1（回退错一格）',
    find: '    const idx = this.snapshots.length - 1 - n;',
    replace: '    const idx = this.snapshots.length - n;',
  },
  {
    id: 'M52', file: 'persistence.ts', desc: 'rewind 允许 n=0',
    find: "    if (n <= 0) throw new Error('E_PERSIST_REWIND_INVALID');",
    replace: "    if (n < 0) throw new Error('E_PERSIST_REWIND_INVALID');",
  },
  {
    id: 'M53', file: 'persistence.ts', desc: 'rewind 越界不抛错（下标钳到 0）',
    find: "    if (idx < 0) throw new Error('E_PERSIST_REWIND_OUT_OF_RANGE');",
    replace: '    if (idx < 0) return cloneState(this.snapshots[0]!);',
  },
  {
    id: 'M54', file: 'persistence.ts', desc: '边界日志自检恒返回空',
    find: '    this.snapshots.forEach((s, i) => v.push(...checkWorldState(s, `边界[${i}]`)));',
    replace: '    /* 不校验 */',
  },
  {
    id: 'M55', file: 'persistence.ts', desc: 'PhaseBoundaryLog.count 返回下标而非条数',
    find: '  count(): number {\n    return this.snapshots.length;\n  }',
    replace: '  count(): number {\n    return this.snapshots.length - 1;\n  }',
  },

  // ---------- compareVersions ----------
  {
    id: 'M56', file: 'migration.ts', desc: '比较只看首段（次段末段永不表决）',
    find: '  for (let i = 0; i < len; i++) {\n    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);\n    if (diff !== 0) return diff;\n  }\n  return 0;',
    replace: '  const diff = (pa[0] ?? 0) - (pb[0] ?? 0);\n  void len;\n  return diff;',
  },
  {
    id: 'M57', file: 'migration.ts', desc: '比较结果取反',
    find: '    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);',
    replace: '    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);',
  },
  {
    id: 'M58', file: 'migration.ts', desc: '比较恒返回 0（一切版本视为相同）',
    find: '    if (diff !== 0) return diff;',
    replace: '    if (false) return diff;',
  },
  {
    id: 'M59', file: 'migration.ts', desc: '段数取 min 而非 max',
    find: '  const len = Math.max(pa.length, pb.length);',
    replace: '  const len = Math.min(pa.length, pb.length);',
    expectEquivalent: true,
  },
  {
    id: 'M60', file: 'migration.ts', desc: 'parseInt 去掉 || 0 兜底',
    find: '  const pa = a.split(\'.\').map((n) => parseInt(n, 10) || 0);',
    replace: '  const pa = a.split(\'.\').map((n) => parseInt(n, 10));',
    expectEquivalent: true,
  },

  // ---------- loadSnapshot 前置校验 ----------
  {
    id: 'M61', file: 'migration.ts', desc: '删除畸形版本前置校验',
    find: '    if (!isWellFormedVersion(version)) {',
    replace: '    if (false) {',
  },
  {
    id: 'M62', file: 'migration.ts', desc: '只校验存档版本，放过目标版本',
    find: "    ['saved', savedState.version],\n    ['current', currentVersion],",
    replace: "    ['saved', savedState.version],",
  },
  {
    id: 'M63', file: 'migration.ts', desc: '只校验目标版本，放过存档版本',
    find: "    ['saved', savedState.version],\n    ['current', currentVersion],",
    replace: "    ['current', currentVersion],",
  },

  // ---------- loadSnapshot 分支 ----------
  {
    id: 'M64', file: 'migration.ts', desc: '同版本分支返回入参引用',
    find: '    return { ok: true, state: cloneState(savedState), diagnostics: [] };',
    replace: '    return { ok: true, state: savedState, diagnostics: [] };',
  },
  {
    id: 'M65', file: 'migration.ts', desc: '同版本判定改为 <=（旧存档也走直接恢复）',
    find: '  if (cmp === 0) {',
    replace: '  if (cmp <= 0) {',
  },
  {
    id: 'M66', file: 'migration.ts', desc: '更新存档不再拒绝',
    find: '  if (cmp > 0) {',
    replace: '  if (false) {',
  },
  {
    id: 'M67', file: 'migration.ts', desc: '无迁移链时不再拒绝（当作空链继续）',
    find: '  if (!chain) {',
    replace: '  if (false) {',
  },

  // ---------- 事务与 bestEffort ----------
  {
    id: 'M68', file: 'migration.ts', desc: 'effects 逐个落盘（失败留下部分应用状态）',
    find: '      let next = state;\n      for (const effect of migration.effects) {\n        next = effect.apply(next);\n      }\n      state = { ...next, version: migration.to };',
    replace: '      for (const effect of migration.effects) {\n        state = effect.apply(state);\n      }\n      state = { ...state, version: migration.to };',
  },
  {
    id: 'M69', file: 'migration.ts', desc: '成功跳不推进版本',
    find: '      state = { ...next, version: migration.to };',
    replace: '      state = next;',
  },
  {
    id: 'M70', file: 'migration.ts', desc: '版本推进到 from 而非 to',
    find: '      state = { ...next, version: migration.to };',
    replace: '      state = { ...next, version: migration.from };',
  },
  {
    id: 'M71', file: 'migration.ts', desc: 'bestEffort 跳过时不留诊断',
    find: '        diagnostics.push({\n          code: MIG_CODES.SKIPPED,',
    replace: '        if (false) diagnostics.push({\n          code: MIG_CODES.SKIPPED,',
  },
  {
    id: 'M72', file: 'migration.ts', desc: 'bestEffort 用 break 而非 continue（中断整链）',
    find: '        continue;\n      }\n      // reject（默认）：整体回滚到原始savedState',
    replace: '        break;\n      }\n      // reject（默认）：整体回滚到原始savedState',
  },
  {
    id: 'M73', file: 'migration.ts', desc: 'reject 分支丢弃已积累的诊断',
    find: '        diagnostics: [...diagnostics, { code: MIG_CODES.FAILED, detail: reason }],',
    replace: '        diagnostics: [{ code: MIG_CODES.FAILED, detail: reason }],',
  },
  {
    id: 'M74', file: 'migration.ts', desc: 'reject 分支改为跳过（不回滚）',
    find: '      // reject（默认）：整体回滚到原始savedState\n      return {\n        ok: false,',
    replace: '      // reject（默认）：整体回滚到原始savedState\n      if (false) return {\n        ok: false,',
  },
  {
    id: 'M75', file: 'migration.ts', desc: 'reject 分支交出部分应用状态',
    find: '      return {\n        ok: false,\n        diagnostics: [...diagnostics, { code: MIG_CODES.FAILED, detail: reason }],\n      };',
    replace: '      return {\n        ok: false,\n        state: cloneState(state),\n        diagnostics: [...diagnostics, { code: MIG_CODES.FAILED, detail: reason }],\n      };',
  },

  // ---------- INCOMPLETE 守卫 ----------
  {
    id: 'M76', file: 'migration.ts', desc: '删除未达目标版本守卫（虚假成功）',
    find: '  if (compareVersions(state.version, currentVersion) !== 0) {',
    replace: '  if (false) {',
  },
  {
    id: 'M77', file: 'migration.ts', desc: 'INCOMPLETE 仍报 ok:true',
    find: '    return {\n      ok: false,\n      state: cloneState(state),\n      diagnostics: [...diagnostics, {\n        code: MIG_CODES.INCOMPLETE,',
    replace: '    return {\n      ok: true,\n      state: cloneState(state),\n      diagnostics: [...diagnostics, {\n        code: MIG_CODES.INCOMPLETE,',
  },
  {
    id: 'M78', file: 'migration.ts', desc: 'INCOMPLETE 分支丢弃已积累诊断',
    find: '      diagnostics: [...diagnostics, {\n        code: MIG_CODES.INCOMPLETE,',
    replace: '      diagnostics: [{\n        code: MIG_CODES.INCOMPLETE,',
  },
  {
    /**
     * 初标 expectEquivalent 有误，实测被杀。
     * 理由：零 effect 的链（migration.effects 为空数组）不产生新 props 对象，
     * state.props 仍与 savedState.props 同引用，这次 cloneState 是承重的。
     * 记录在案：判断等价必须靠差分证明，不能靠"看起来只是多拷一次"。
     */
    id: 'M79', file: 'migration.ts', desc: '成功路径返回未克隆状态',
    find: '  return { ok: true, state: cloneState(state), diagnostics };',
    replace: '  return { ok: true, state, diagnostics };',
  },
  {
    id: 'M80', file: 'migration.ts', desc: '成功路径丢弃诊断（跳过记录消失）',
    find: '  return { ok: true, state: cloneState(state), diagnostics };',
    replace: '  return { ok: true, state: cloneState(state), diagnostics: [] };',
  },

  // ---------- findMigrationChain ----------
  {
    id: 'M81', file: 'migration.ts', desc: '命中判定移到 visited 之后（起点等于终点时失效）',
    find: '    if (version === to) return path;\n    if (visited.has(version)) continue;\n    visited.add(version);',
    replace: '    if (visited.has(version)) continue;\n    visited.add(version);\n    if (version === to) return path;',
    expectEquivalent: true,
  },
  {
    id: 'M82', file: 'migration.ts', desc: '改用栈（DFS），不再保证最短链',
    find: '    const { version, path } = queue.shift()!;',
    replace: '    const { version, path } = queue.pop()!;',
  },
  {
    /**
     * 初版把 visited 换成 `if (path.length > 8) continue;`——那是个**去牙变异体**：
     * 长度上限自己就恢复了终止性，于是变异体与原实现行为等价，
     * 它的存活证明不了任何测试盲区。判据：替换物不得偶然重建被删掉的安全性质。
     *
     * 现版彻底删除环保护。环图上队列无界增长：
     * 要么超时，要么 OOM。二者都是**正当的击杀信号**——
     * "跑不完"与"跑出错"对契约而言同样是违约。
     * 故本变异体依赖 vitest.mutation.config.ts 的 testTimeout，
     * 且必须有一个能构造出环的用例，否则它照样存活。
     */
    id: 'M83', file: 'migration.ts', desc: '去掉 visited（环图上队列无界增长）',
    find: '    if (visited.has(version)) continue;\n    visited.add(version);',
    replace: '    /* 环保护已移除 */',
  },
  {
    id: 'M84', file: 'migration.ts', desc: '邻接判定用 m.to 而非 m.from',
    find: '      if (m.from === version) {',
    replace: '      if (m.to === version) {',
  },
  {
    id: 'M85', file: 'migration.ts', desc: '入队时丢弃已走路径（返回空链）',
    find: '        queue.push({ version: m.to, path: [...path, m] });',
    replace: '        queue.push({ version: m.to, path: [m] });',
  },
  {
    id: 'M86', file: 'migration.ts', desc: '找不到链时返回空数组而非 null',
    find: '  return null;\n}',
    replace: '  return [];\n}',
  },
  {
    id: 'M87', file: 'migration.ts', desc: '起点直接入队为 to（链恒为空）',
    find: '  const queue: Array<{ version: string; path: MigrationDef[] }> = [{ version: from, path: [] }];',
    replace: '  const queue: Array<{ version: string; path: MigrationDef[] }> = [{ version: to, path: [] }];',
  },

  // ---------- 诊断码 ----------
  {
    id: 'M88', file: 'migration.ts', desc: 'SKIPPED 与 FAILED 共用同一码（无法区分失败原因）',
    find: "  SKIPPED: 'W_MIG_SKIPPED',",
    replace: "  SKIPPED: 'E_MIG_FAILED',",
  },
  {
    id: 'M89', file: 'migration.ts', desc: 'INCOMPLETE 与 NO_PATH 共用同一码',
    find: "  INCOMPLETE: 'E_MIG_INCOMPLETE',",
    replace: "  INCOMPLETE: 'E_MIG_NO_PATH',",
  },
  {
    id: 'M90', file: 'migration.ts', desc: 'BAD_VERSION 与 NEWER_SAVE 共用同一码',
    find: "  BAD_VERSION: 'E_MIG_BAD_VERSION',",
    replace: "  BAD_VERSION: 'E_MIG_NEWER_SAVE',",
  },
  {
    id: 'M91', file: 'migration.ts', desc: '诊断 detail 置空（失败原因不可读）',
    find: '          detail: `${label} version ${JSON.stringify(version)} is not major.minor.patch`,',
    replace: "          detail: '',",
  },
];
