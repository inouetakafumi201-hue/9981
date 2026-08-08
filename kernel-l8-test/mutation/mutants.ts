/**
 * L8 变异体清单。
 *
 * 每个变异体是对 src/relation.ts 的一处**唯一命中**的字符串替换。
 * 驱动器要求 find 恰好命中 1 次，否则记为 INVALID 并排除出得分——
 * 防止"改了个不存在的字符串"被静默算成击杀。
 *
 * 两条硬判据（前几层踩过的坑，写在这里当护栏）：
 *
 * 1. **替换物不得偶然重建被删掉的安全性质**（"去牙变异体"）。
 *    L12 的 M83 初版把 visited 换成 `path.length > 8`，长度上限自己就
 *    恢复了终止性，于是变异体与原实现行为等价，它的存活证明不了任何盲区。
 *
 * 2. **标注 expectEquivalent 必须有理由，且理由写在 desc 里**。
 *    真正的等价变异体存活是正确结果；把杀不掉的变异体随手标成等价
 *    是把盲区改名叫特性。
 */
export interface Mutant {
  id: string;
  file: string;
  desc: string;
  find: string;
  replace: string;
  /** 语义等价：存活是正确结果，不计入分母。 */
  expectEquivalent?: boolean;
}

export const MUTANTS: Mutant[] = [
  // ══════════════════════════════════════════════════════════════════
  // createEntity —— 重复 id 守卫 + 返回副本
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'M01', file: 'relation.ts',
    desc: '去掉重复 id 守卫（回到静默覆盖，孤立旧关系）',
    find: "    if (this.entities.has(id)) throw new Error('E_ENTITY_EXISTS');",
    replace: '',
  },
  {
    id: 'M02', file: 'relation.ts',
    desc: '重复 id 守卫取反（首次创建就抛错）',
    find: '    if (this.entities.has(id)) throw',
    replace: '    if (!this.entities.has(id)) throw',
  },
  {
    id: 'M03', file: 'relation.ts',
    desc: 'createEntity 返回内部 stub（调用方可绕过 Op 改索引）',
    find: '    return cloneEntityStub(e);\n  }\n\n  destroyEntity',
    replace: '    return e;\n  }\n\n  destroyEntity',
  },
  {
    id: 'M04', file: 'relation.ts',
    desc: 'createEntity 抛错前先写入（失败调用留下痕迹）',
    find: "    if (this.entities.has(id)) throw new Error('E_ENTITY_EXISTS');\n    const e: EntityStub",
    replace: "    if (this.entities.has(id)) { this.entities.set(id, { id, rel: { out: new Map(), in: new Map() }, attachments: new Set() }); throw new Error('E_ENTITY_EXISTS'); }\n    const e: EntityStub",
  },

  // ══════════════════════════════════════════════════════════════════
  // destroyEntity —— 存在性校验 + 四路级联
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'M05', file: 'relation.ts',
    desc: 'destroyEntity 不存在时静默返回（不抛 E_REF_INVALID）',
    find: "    if (!entity) throw new Error('E_REF_INVALID');",
    replace: '    if (!entity) return;',
  },
  {
    id: 'M06', file: 'relation.ts',
    desc: '级联只收 out 边（in 边留下悬空关系）',
    find: '      ...Array.from(entity.rel.out.values()).flat(),\n      ...Array.from(entity.rel.in.values()).flat()',
    replace: '      ...Array.from(entity.rel.out.values()).flat()',
  },
  {
    id: 'M07', file: 'relation.ts',
    desc: '级联只收 in 边（out 边留下悬空关系）',
    find: '      ...Array.from(entity.rel.out.values()).flat(),\n      ...Array.from(entity.rel.in.values()).flat()',
    replace: '      ...Array.from(entity.rel.in.values()).flat()',
  },
  {
    id: 'M08', file: 'relation.ts',
    desc: '完全不级联删关系（INV-6 失效）',
    find: '    for (const relId of relIds) {\n      this.relation_del(relId);\n    }',
    replace: '',
  },
  {
    id: 'M09', file: 'relation.ts',
    desc: '不级联删 target 为该实体的 attachment（INV-13 失效）',
    find: '    for (const attId of [...entity.attachments]) {\n      this.attachment_del(attId);\n    }',
    replace: '',
  },
  {
    id: 'M10', file: 'relation.ts',
    desc: '不级联删 grantedBy 为该实体的 attachment',
    find: "      if (att.grantedBy === id) {\n        this.attachment_del(att.id);\n      }",
    replace: '',
  },
  {
    id: 'M11', file: 'relation.ts',
    desc: 'grantedBy 级联判据取反（删错对象）',
    find: '      if (att.grantedBy === id) {',
    replace: '      if (att.grantedBy !== id) {',
  },
  {
    id: 'M12', file: 'relation.ts',
    desc: '不做 dep 级联（dep 被销毁后 attachment 悬空）',
    find: '    this.cascadeOnDepDestroy(id);',
    replace: '',
  },
  {
    id: 'M13', file: 'relation.ts',
    desc: 'destroyEntity 末尾不从 entities 删除（实体删不掉）',
    find: '    this.entities.delete(id);\n  }\n\n  // — Relation —',
    replace: '  }\n\n  // — Relation —',
  },
  {
    id: 'M14', file: 'relation.ts',
    desc: '等价：先删实体再级联——被删实体自己的索引无人再读，另一端仍被清理',
    /**
     * 首轮存活，经差分模糊器判定为**真等价**（3,000 条序列，14 哨兵自检通过）。
     * 理由：`entity` 局部变量已持有 stub，relIds 照常收齐；
     * `relation_del` 里 `this.entities.get(rel.from)` 变 undefined 时
     * 只跳过**被删实体自己**那侧的索引清理，而它整个 stub 随即消失，
     * 那份索引再无人读取；另一端仍然活着，仍被正常清理。
     * `attachment_del` 的 `?.` 同理。末尾 delete 成为 no-op。
     * 故最终可观测状态逐字段相同。
     *
     * 注意这不是"改了也行"——它依赖"被删实体的索引不再被任何人读"这一前提。
     * 若将来 destroyEntity 之后还要读该 stub（例如返回被删内容），等价即失效。
     */
    find: '    // INV-6: 删除所有以该Entity为端点的Relation\n    const relIds = [',
    replace: '    this.entities.delete(id);\n    // INV-6: 删除所有以该Entity为端点的Relation\n    const relIds = [',
    expectEquivalent: true,
  },
  {
    id: 'M15', file: 'relation.ts',
    desc: '等价：级联时不快照 attachments——循环内只删当前元素，Set 迭代对此安全',
    /**
     * 首轮存活，经差分模糊器判定为**真等价**。
     * 理由：`attachment_del(attId)` 只从该 target 的集合里删掉 attId 本身，
     * 即当前正在访问的元素；JS 的 Set 迭代器允许删当前元素并继续。
     * 它不会删到**尚未访问**的元素——grantedBy 与 dep 两种级联是各自独立的
     * 后续循环，且都另有快照。故遍历不会漏项。
     *
     * 观测面里 p.multi（同一 target 挂 5 个 attachment 后销毁）与
     * p.chain（4 个 attachment 共享同一 dep）专为这条而设：
     * 若"边删边遍历"真的漏项，剩余 attachment 会留在 dump 里。
     */
    find: '    for (const attId of [...entity.attachments]) {',
    replace: '    for (const attId of entity.attachments) {',
    expectEquivalent: true,
  },

  // ══════════════════════════════════════════════════════════════════
  // relation_add —— 引用校验 / 去重 / 双向索引 / 拷贝语义
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'M16', file: 'relation.ts',
    desc: 'relation_add 不校验 from 存在',
    find: "    if (!this.entities.has(from)) throw new Error('E_REF_INVALID');",
    replace: '',
  },
  {
    id: 'M17', file: 'relation.ts',
    desc: 'relation_add 不校验 to 存在',
    find: "    if (!this.entities.has(to)) throw new Error('E_REF_INVALID');",
    replace: '',
  },
  {
    id: 'M18', file: 'relation.ts',
    desc: 'from 校验取反（合法端点被拒）',
    find: '    if (!this.entities.has(from)) throw',
    replace: '    if (this.entities.has(from)) throw',
  },
  {
    id: 'M19', file: 'relation.ts',
    desc: '同 id 重复添加时不先清旧（旧索引项残留）',
    find: '    if (this.relations.has(id)) {\n      this.relation_del(id);\n    }',
    replace: '',
  },
  {
    id: 'M20', file: 'relation.ts',
    desc: 'attrs 按引用存（调用方事后可绕过校验改内部状态）',
    find: '    const rel: RelationDef = { id, type, from, to, attrs: { ...attrs } };',
    replace: '    const rel: RelationDef = { id, type, from, to, attrs };',
  },
  {
    id: 'M21', file: 'relation.ts',
    desc: 'relation_add 返回内部对象（可改 from 让索引脱钩）',
    find: '    return cloneRelation(rel);',
    replace: '    return rel;',
  },
  {
    id: 'M22', file: 'relation.ts',
    desc: '不写 out 索引（单向索引）',
    find: '    const outList = fromEnt.rel.out.get(type) ?? [];\n    outList.push(id);\n    fromEnt.rel.out.set(type, outList);',
    replace: '',
  },
  {
    id: 'M23', file: 'relation.ts',
    desc: '不写 in 索引（单向索引）',
    find: '    const inList = toEnt.rel.in.get(type) ?? [];\n    inList.push(id);\n    toEnt.rel.in.set(type, inList);',
    replace: '',
  },
  {
    id: 'M24', file: 'relation.ts',
    desc: 'out 索引用 unshift（桶内顺序反转，get 可观测）',
    find: '    outList.push(id);',
    replace: '    outList.unshift(id);',
  },
  {
    id: 'M25', file: 'relation.ts',
    desc: 'out 索引写死 type 键（按类型查询错位）',
    find: '    fromEnt.rel.out.set(type, outList);',
    replace: "    fromEnt.rel.out.set('*', outList);",
  },
  {
    id: 'M26', file: 'relation.ts',
    desc: 'out/in 索引写到同一端（from 端写两次）',
    find: '    const toEnt = this.entities.get(to)!;',
    replace: '    const toEnt = this.entities.get(from)!;',
  },
  {
    id: 'M27', file: 'relation.ts',
    desc: '索引里存 type 而不是 id（反向校验应发现主表查不到）',
    find: '    inList.push(id);',
    replace: '    inList.push(type);',
  },

  // ══════════════════════════════════════════════════════════════════
  // relation_del —— 幂等 + 双向清索引
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'M28', file: 'relation.ts',
    desc: 'relation_del 对不存在的 id 抛错（破坏幂等；自环级联会二次调用）',
    find: '    if (!rel) return; // 幂等',
    replace: "    if (!rel) throw new Error('E_REF_INVALID');",
  },
  {
    id: 'M29', file: 'relation.ts',
    desc: 'relation_del 不清 out 索引（残留索引项）',
    find: '      const outList = fromEnt.rel.out.get(rel.type) ?? [];\n      fromEnt.rel.out.set(rel.type, outList.filter(x => x !== id));',
    replace: '',
  },
  {
    id: 'M30', file: 'relation.ts',
    desc: 'relation_del 不清 in 索引（残留索引项）',
    find: '      const inList = toEnt.rel.in.get(rel.type) ?? [];\n      toEnt.rel.in.set(rel.type, inList.filter(x => x !== id));',
    replace: '',
  },
  {
    id: 'M31', file: 'relation.ts',
    desc: 'relation_del 不从主表删除（主表残留，索引已清）',
    find: '    this.relations.delete(id);\n  }\n\n  // — Attachment —',
    replace: '  }\n\n  // — Attachment —',
  },
  {
    id: 'M32', file: 'relation.ts',
    desc: '清 out 索引时过滤条件取反（删掉所有其他项，留下自己）',
    find: '      fromEnt.rel.out.set(rel.type, outList.filter(x => x !== id));',
    replace: '      fromEnt.rel.out.set(rel.type, outList.filter(x => x === id));',
  },
  {
    id: 'M33', file: 'relation.ts',
    desc: '清索引时用错类型键（清了别的桶）',
    find: '      const inList = toEnt.rel.in.get(rel.type) ?? [];',
    replace: "      const inList = toEnt.rel.in.get('*') ?? [];",
  },

  // ══════════════════════════════════════════════════════════════════
  // attachment_add —— 三重引用校验 / 去重 / 登记 / 拷贝语义
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'M34', file: 'relation.ts',
    desc: 'attachment_add 不校验 target 存在',
    find: "    if (!this.entities.has(def.target)) throw new Error('E_REF_INVALID');",
    replace: '',
  },
  {
    id: 'M35', file: 'relation.ts',
    desc: 'attachment_add 不校验 grantedBy 存在',
    find: "    if (!this.entities.has(def.grantedBy)) throw new Error('E_REF_INVALID');",
    replace: '',
  },
  {
    id: 'M36', file: 'relation.ts',
    desc: 'attachment_add 不校验 deps 存在',
    find: "    for (const dep of def.deps) {\n      if (!this.entities.has(dep)) throw new Error('E_REF_INVALID');\n    }",
    replace: '',
  },
  {
    id: 'M37', file: 'relation.ts',
    desc: 'deps 校验只看第一个（后续 dep 不校验）',
    find: '    for (const dep of def.deps) {',
    replace: '    for (const dep of def.deps.slice(0, 1)) {',
  },
  {
    id: 'M38', file: 'relation.ts',
    desc: '同 id 重复 add 时不先清旧（登记与主表脱钩）',
    find: '    if (this.attachments.has(def.id)) {\n      this.attachment_del(def.id);\n    }',
    replace: '',
  },
  {
    id: 'M39', file: 'relation.ts',
    desc: 'attachment 按引用入库（事后改 deps/target 可绕过校验）',
    find: '    const stored = cloneAttachment(def);',
    replace: '    const stored = def;',
  },
  {
    id: 'M40', file: 'relation.ts',
    desc: 'attachment_add 返回内部对象',
    find: '    return cloneAttachment(stored);',
    replace: '    return stored;',
  },
  {
    id: 'M41', file: 'relation.ts',
    desc: '不在 target 上登记 attachment（反向校验应发现）',
    find: '    this.entities.get(stored.target)!.attachments.add(stored.id);',
    replace: '',
  },
  {
    id: 'M42', file: 'relation.ts',
    desc: '登记到 grantedBy 而不是 target',
    find: '    this.entities.get(stored.target)!.attachments.add(stored.id);',
    replace: '    this.entities.get(stored.grantedBy)!.attachments.add(stored.id);',
  },

  // ══════════════════════════════════════════════════════════════════
  // attachment_del / cascadeOnDepDestroy
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'M43', file: 'relation.ts',
    desc: 'attachment_del 对不存在的 id 抛错（破坏幂等）',
    find: '    if (!att) return;',
    replace: "    if (!att) throw new Error('E_REF_INVALID');",
  },
  {
    id: 'M44', file: 'relation.ts',
    desc: 'attachment_del 不从 target 的集合里注销（entity 残留 attId）',
    find: '    this.entities.get(att.target)?.attachments.delete(id);',
    replace: '',
  },
  {
    id: 'M45', file: 'relation.ts',
    desc: 'attachment_del 不从主表删除',
    find: '    this.attachments.delete(id);\n  }',
    replace: '  }',
  },
  {
    id: 'M46', file: 'relation.ts',
    desc: 'dep 级联判据取反（删掉不含该 dep 的 attachment）',
    find: '      if (att.deps.includes(depId)) {',
    replace: '      if (!att.deps.includes(depId)) {',
  },
  {
    id: 'M47', file: 'relation.ts',
    desc: 'dep 级联只看第一个 dep',
    find: '      if (att.deps.includes(depId)) {',
    replace: '      if (att.deps[0] === depId) {',
  },

  // ══════════════════════════════════════════════════════════════════
  // checkInvariants —— 正向子句
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'M48', file: 'relation.ts',
    desc: '不报 from 端悬空',
    find: "      if (!fromEnt) {\n        violations.push({ code: 'E_INV_DANGLING', detail: `rel ${rel.id} from=${rel.from} missing` });\n        continue;\n      }",
    replace: '      if (!fromEnt) continue;',
  },
  {
    id: 'M49', file: 'relation.ts',
    desc: '不报 to 端悬空',
    find: "      if (!toEnt) {\n        violations.push({ code: 'E_INV_DANGLING', detail: `rel ${rel.id} to=${rel.to} missing` });\n        continue;\n      }",
    replace: '      if (!toEnt) continue;',
  },
  {
    id: 'M50', file: 'relation.ts',
    desc: 'hasOut 判据取反（对称的报不对称）',
    find: '      if (!hasOut) violations.push',
    replace: '      if (hasOut) violations.push',
  },
  {
    id: 'M51', file: 'relation.ts',
    desc: '不报 out 索引缺失',
    find: "      if (!hasOut) violations.push({ code: 'E_INV_ASYMMETRIC', detail: `rel ${rel.id} missing in out-index` });",
    replace: '',
  },
  {
    id: 'M52', file: 'relation.ts',
    desc: '不报 in 索引缺失',
    find: "      if (!hasIn)  violations.push({ code: 'E_INV_ASYMMETRIC', detail: `rel ${rel.id} missing in in-index` });",
    replace: '',
  },
  {
    id: 'M53', file: 'relation.ts',
    desc: 'hasOut 忽略类型（跨桶也算命中）',
    find: '      const hasOut = (fromEnt.rel.out.get(rel.type) ?? []).includes(rel.id);',
    replace: '      const hasOut = [...fromEnt.rel.out.values()].flat().includes(rel.id);',
  },
  {
    id: 'M54', file: 'relation.ts',
    desc: '不报 att.target 悬空',
    find: "      if (!this.entities.has(att.target)) {\n        violations.push({ code: 'E_INV_DANGLING', detail: `att ${att.id} target=${att.target} missing` });\n      }",
    replace: '',
  },
  {
    id: 'M55', file: 'relation.ts',
    desc: '不报 att.grantedBy 悬空',
    find: "      if (!this.entities.has(att.grantedBy)) {\n        violations.push({ code: 'E_INV_DANGLING', detail: `att ${att.id} grantedBy=${att.grantedBy} missing` });\n      }",
    replace: '',
  },
  {
    id: 'M56', file: 'relation.ts',
    desc: '不报 dep 悬空',
    find: "      for (const dep of att.deps) {\n        if (!this.entities.has(dep)) {\n          violations.push({ code: 'E_INV_DANGLING', detail: `att ${att.id} dep=${dep} missing` });\n        }\n      }",
    replace: '',
  },
  {
    id: 'M57', file: 'relation.ts',
    desc: '不报 entity 引用了不存在的 att',
    find: "      for (const attId of ent.attachments) {\n        if (!this.attachments.has(attId)) {\n          violations.push({ code: 'E_INV_INCONSISTENT', detail: `entity ${ent.id} refs att ${attId} not in map` });\n        }\n      }",
    replace: '',
  },

  // ══════════════════════════════════════════════════════════════════
  // checkInvariants —— 反向子句（重建前这一组全部无人看守）
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'M58', file: 'relation.ts',
    desc: '反向 out 索引校验整段删除（回到单向检查）',
    find: "          if (!rel) {\n            violations.push({ code: 'E_INV_STALE_INDEX', detail: `entity ${ent.id} out[${type}] 残留 rel ${relId}（主表已无）` });\n            continue;\n          }",
    replace: '          if (!rel) continue;',
  },
  {
    id: 'M59', file: 'relation.ts',
    desc: '不校验 out 索引项的 from 端是否为所在 entity',
    find: "          if (rel.from !== ent.id) {\n            violations.push({ code: 'E_INV_STALE_INDEX', detail: `entity ${ent.id} out[${type}] 含 rel ${relId}，但其 from=${rel.from}` });\n          }",
    replace: '',
  },
  {
    id: 'M60', file: 'relation.ts',
    desc: 'out 索引 from 端校验取反',
    find: '          if (rel.from !== ent.id) {',
    replace: '          if (rel.from === ent.id) {',
  },
  {
    id: 'M61', file: 'relation.ts',
    desc: '不校验 out 索引项的 type 是否与桶键一致',
    find: "          if (rel.type !== type) {\n            violations.push({ code: 'E_INV_STALE_INDEX', detail: `entity ${ent.id} out[${type}] 含 rel ${relId}，但其 type=${rel.type}` });\n          }",
    replace: '',
  },
  {
    id: 'M62', file: 'relation.ts',
    desc: '不校验 out 桶内重复',
    find: "        if (new Set(list).size !== list.length) {\n          violations.push({ code: 'E_INV_DUPLICATE_INDEX', detail: `entity ${ent.id} out[${type}] 存在重复 relId: ${JSON.stringify(list)}` });\n        }",
    replace: '',
  },
  {
    id: 'M63', file: 'relation.ts',
    desc: 'out 桶重复判据取反（无重复时误报）',
    find: '        if (new Set(list).size !== list.length) {\n          violations.push({ code: \'E_INV_DUPLICATE_INDEX\', detail: `entity ${ent.id} out[${type}] 存在重复 relId',
    replace: '        if (new Set(list).size === list.length) {\n          violations.push({ code: \'E_INV_DUPLICATE_INDEX\', detail: `entity ${ent.id} out[${type}] 存在重复 relId',
  },
  {
    id: 'M64', file: 'relation.ts',
    desc: '反向 in 索引不校验主表存在',
    find: "          if (!rel) {\n            violations.push({ code: 'E_INV_STALE_INDEX', detail: `entity ${ent.id} in[${type}] 残留 rel ${relId}（主表已无）` });\n            continue;\n          }",
    replace: '          if (!rel) continue;',
  },
  {
    id: 'M65', file: 'relation.ts',
    desc: '不校验 in 索引项的 to 端是否为所在 entity',
    find: "          if (rel.to !== ent.id) {\n            violations.push({ code: 'E_INV_STALE_INDEX', detail: `entity ${ent.id} in[${type}] 含 rel ${relId}，但其 to=${rel.to}` });\n          }",
    replace: '',
  },
  {
    id: 'M66', file: 'relation.ts',
    desc: '不校验 in 桶内重复',
    find: "        if (new Set(list).size !== list.length) {\n          violations.push({ code: 'E_INV_DUPLICATE_INDEX', detail: `entity ${ent.id} in[${type}] 存在重复 relId: ${JSON.stringify(list)}` });\n        }",
    replace: '',
  },
  {
    id: 'M67', file: 'relation.ts',
    desc: '反向 attachment 登记校验整段删除',
    find: "      if (target && !target.attachments.has(att.id)) {\n        violations.push({ code: 'E_INV_INCONSISTENT', detail: `att ${att.id} 的 target ${att.target} 未登记该 att` });\n      }",
    replace: '',
  },
  {
    id: 'M68', file: 'relation.ts',
    desc: '反向 attachment 登记校验取反',
    find: '      if (target && !target.attachments.has(att.id)) {',
    replace: '      if (target && target.attachments.has(att.id)) {',
  },

  // ══════════════════════════════════════════════════════════════════
  // 诊断码可区分性（自指判据的反面：码被换掉必须有人喊）
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'M69', file: 'relation.ts',
    desc: 'STALE_INDEX 报成 ASYMMETRIC（两类问题混为一谈）',
    find: "            violations.push({ code: 'E_INV_STALE_INDEX', detail: `entity ${ent.id} out[${type}] 残留 rel ${relId}（主表已无）` });",
    replace: "            violations.push({ code: 'E_INV_ASYMMETRIC', detail: `entity ${ent.id} out[${type}] 残留 rel ${relId}（主表已无）` });",
  },
  {
    id: 'M70', file: 'relation.ts',
    desc: 'DANGLING 报成 INCONSISTENT',
    find: "        violations.push({ code: 'E_INV_DANGLING', detail: `rel ${rel.id} from=${rel.from} missing` });",
    replace: "        violations.push({ code: 'E_INV_INCONSISTENT', detail: `rel ${rel.id} from=${rel.from} missing` });",
  },
  {
    id: 'M71', file: 'relation.ts',
    desc: 'DUPLICATE_INDEX 报成 STALE_INDEX',
    find: "          violations.push({ code: 'E_INV_DUPLICATE_INDEX', detail: `entity ${ent.id} out[${type}] 存在重复 relId: ${JSON.stringify(list)}` });",
    replace: "          violations.push({ code: 'E_INV_STALE_INDEX', detail: `entity ${ent.id} out[${type}] 存在重复 relId: ${JSON.stringify(list)}` });",
  },
  {
    id: 'M72', file: 'relation.ts',
    desc: 'detail 抹掉定位信息（只留码，无法定位）',
    find: 'detail: `att ${att.id} 的 target ${att.target} 未登记该 att`',
    replace: "detail: '违规'",
  },
  {
    id: 'M73', file: 'relation.ts',
    desc: 'checkInvariants 恒返回空（检查器彻底失效）',
    find: '    const violations: Violation[] = [];',
    replace: '    const violations: Violation[] = []; if (1 as number) return violations;',
  },

  // ══════════════════════════════════════════════════════════════════
  // get —— 一律副本
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'M74', file: 'relation.ts',
    desc: 'get entity 交出内部 stub',
    find: '      return e === undefined ? undefined : cloneEntityStub(e);',
    replace: '      return e;',
  },
  {
    id: 'M75', file: 'relation.ts',
    desc: 'get relation 交出内部对象',
    find: '      return r === undefined ? undefined : cloneRelation(r);',
    replace: '      return r;',
  },
  {
    id: 'M76', file: 'relation.ts',
    desc: 'get attachment 交出内部对象',
    find: '      return a === undefined ? undefined : cloneAttachment(a);',
    replace: '      return a;',
  },
  {
    id: 'M77', file: 'relation.ts',
    desc: 'get 不存在时返回空对象而非 undefined',
    find: "    return undefined;\n  }",
    replace: '    return {} as never;\n  }',
  },

  // ══════════════════════════════════════════════════════════════════
  // dump —— 观测面本身的正确性
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'M78', file: 'relation.ts',
    desc: 'dump 对索引桶排序（抹掉可观测的插入顺序）',
    find: '      for (const [t, list] of e.rel.out) if (list.length > 0) out[t] = [...list];',
    replace: '      for (const [t, list] of e.rel.out) if (list.length > 0) out[t] = [...list].sort();',
  },
  {
    id: 'M79', file: 'relation.ts',
    desc: 'dump 保留空桶（删除留下的空数组伪装成状态差异）',
    find: '      for (const [t, list] of e.rel.in) if (list.length > 0) inn[t] = [...list];',
    replace: '      for (const [t, list] of e.rel.in) inn[t] = [...list];',
  },
  {
    id: 'M80', file: 'relation.ts',
    desc: 'dump 的 entities 不排序（顺序随插入变化）',
    find: '    const entities = [...this.entities.keys()].sort();',
    replace: '    const entities = [...this.entities.keys()];',
  },
  {
    id: 'M81', file: 'relation.ts',
    desc: 'dump 漏掉 attachments 索引字段',
    find: '      idx[id] = { out, in: inn, attachments: [...e.attachments] };',
    replace: '      idx[id] = { out, in: inn, attachments: [] };',
  },
  {
    id: 'M82', file: 'relation.ts',
    desc: 'dump 的 effectCount 恒为 0',
    find: '        deps: [...a.deps], effectCount: a.effects.length,',
    replace: '        deps: [...a.deps], effectCount: 0,',
  },
  {
    id: 'M83', file: 'relation.ts',
    desc: 'dump 交出 attrs 引用（快照可被事后篡改）',
    find: '      rel[r.id] = { type: r.type, from: r.from, to: r.to, attrs: { ...r.attrs } };',
    replace: '      rel[r.id] = { type: r.type, from: r.from, to: r.to, attrs: r.attrs };',
  },
  {
    id: 'M84', file: 'relation.ts',
    desc: 'dump 漏掉 in 索引',
    find: '      idx[id] = { out, in: inn,',
    replace: '      idx[id] = { out, in: {},',
  },

  // ══════════════════════════════════════════════════════════════════
  // 拷贝助手 —— 逐层拷的每一层
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'M85', file: 'relation.ts',
    desc: 'cloneRelation 浅拷 attrs（仍共享同一对象）',
    find: '  return { id: r.id, type: r.type, from: r.from, to: r.to, attrs: { ...r.attrs } };',
    replace: '  return { id: r.id, type: r.type, from: r.from, to: r.to, attrs: r.attrs };',
  },
  {
    id: 'M86', file: 'relation.ts',
    desc: 'cloneAttachment 不拷 deps 数组',
    find: '    deps: [...a.deps],\n  };',
    replace: '    deps: a.deps,\n  };',
  },
  {
    id: 'M87', file: 'relation.ts',
    desc: 'cloneAttachment 不拷 effects 数组',
    find: '    effects: a.effects.map((e) => ({ op: e.op, args: { ...e.args } })),',
    replace: '    effects: a.effects,',
  },
  {
    id: 'M88', file: 'relation.ts',
    desc: 'cloneAttachment 拷 effects 但不拷每个 args（浅一层不够）',
    find: '    effects: a.effects.map((e) => ({ op: e.op, args: { ...e.args } })),',
    replace: '    effects: a.effects.map((e) => ({ op: e.op, args: e.args })),',
  },
  {
    id: 'M89', file: 'relation.ts',
    desc: 'cloneEntityStub 复用原 Map（索引可被外部改）',
    find: '  const out = new Map<string, string[]>();\n  for (const [t, list] of e.rel.out) out.set(t, [...list]);',
    replace: '  const out = e.rel.out;',
  },
  {
    id: 'M90', file: 'relation.ts',
    desc: 'cloneEntityStub 拷 Map 但桶内数组共享',
    find: '  for (const [t, list] of e.rel.out) out.set(t, [...list]);',
    replace: '  for (const [t, list] of e.rel.out) out.set(t, list);',
  },
  {
    id: 'M91', file: 'relation.ts',
    desc: 'cloneEntityStub 复用原 attachments Set',
    find: '  return { id: e.id, rel: { out, in: inn }, attachments: new Set(e.attachments) };',
    replace: '  return { id: e.id, rel: { out, in: inn }, attachments: e.attachments };',
  },
  {
    id: 'M92', file: 'relation.ts',
    desc: 'cloneEntityStub 复用原 in Map',
    find: '  for (const [t, list] of e.rel.in) inn.set(t, [...list]);',
    replace: '  for (const [t, list] of e.rel.in) inn.set(t, list);',
  },

  // ══════════════════════════════════════════════════════════════════
  // 预期等价（存活即正确；理由写在 desc 里）
  // ══════════════════════════════════════════════════════════════════
  {
    id: 'M93', file: 'relation.ts',
    desc: '等价：attrs 默认值去掉——展开 undefined 得空对象，行为不变',
    find: '  relation_add(id: string, type: string, from: string, to: string, attrs: Record<string, any> = {}): RelationDef {',
    replace: '  relation_add(id: string, type: string, from: string, to: string, attrs?: Record<string, any>): RelationDef {',
    expectEquivalent: true,
  },
  {
    id: 'M94', file: 'relation.ts',
    desc: '等价：dump 内 relations 遍历改用 entries——同一迭代顺序',
    find: '    for (const r of this.relations.values()) {',
    replace: '    for (const [, r] of this.relations.entries()) {',
    expectEquivalent: true,
  },
  {
    id: 'M95', file: 'relation.ts',
    desc: '等价：grantedBy 级联的快照数组换成 Array.from——同语义',
    find: '    for (const att of [...this.attachments.values()]) {\n      if (att.grantedBy === id) {',
    replace: '    for (const att of Array.from(this.attachments.values())) {\n      if (att.grantedBy === id) {',
    expectEquivalent: true,
  },
  {
    id: 'M96', file: 'relation.ts',
    desc: '等价：hasIn 的多余空格删掉——纯格式',
    find: '      if (!hasIn)  violations.push',
    replace: '      if (!hasIn) violations.push',
    expectEquivalent: true,
  },
];
