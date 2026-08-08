/**
 * L11 起点探针：不读代码推断，直接测量既有属性测试的**有效样本空间**。
 * 逐条复刻 l11-property.test.ts 的生成器，统计每类分支实际命中次数。
 */
import fc from 'fast-check';
import { DiagnosticCollector, CODE_REGISTRY } from '../../src/diagnostic.ts';
import type { Diagnostic } from '../../src/diagnostic.ts';

const ALL_CODES = [...CODE_REGISTRY.keys()];
console.log(`注册码总数 = ${ALL_CODES.length}`);

// ——— 属性 1：任意 emit 序列 ———
// 关注点：causedBy 链能不能长到触发 E_DIAG_CHAIN_TOO_DEEP（maxDepth=64）？
//         emit 有没有真的抛过异常（catch 块是不是死代码）？
{
  let maxChainLen = 0;
  let throwCount = 0;
  let emitCount = 0;
  let linkedCount = 0;
  let violationCount = 0;
  const N = 2000;

  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          code: fc.constantFrom(...ALL_CODES),
          layer: fc.constantFrom('kernel', 'class', 'play'),
          opName: fc.constantFrom('stack.split', 'entity.place', 'hook.emit', 'expr.eval'),
          entityId: fc.uuid(),
          linkPrev: fc.boolean(),
          prevIdx: fc.integer({ min: 0, max: 40 }),
        }),
        { minLength: 1, maxLength: 40 }
      ),
      (ops) => {
        const col = new DiagnosticCollector();
        const emitted: Diagnostic[] = [];
        for (const op of ops) {
          try {
            const causedBy =
              op.linkPrev && emitted.length > 0 ? emitted[op.prevIdx % emitted.length] : undefined;
            if (causedBy) linkedCount++;
            const d = col.emit(
              op.code,
              { layer: op.layer, op: op.opName, entityId: op.entityId },
              undefined,
              causedBy
            );
            emitCount++;
            emitted.push(d);
            // 实测这条诊断的链长
            let n = 0;
            let cur: Diagnostic | undefined = d;
            while (cur) {
              n++;
              cur = cur.causedBy;
            }
            if (n > maxChainLen) maxChainLen = n;
          } catch {
            throwCount++;
          }
        }
        violationCount += col.checkInvariants().length;
        return true;
      }
    ),
    { numRuns: N }
  );

  console.log(`\n[属性1] ${N} 次序列：`);
  console.log(`  emit 成功 = ${emitCount}，抛出 = ${throwCount}  ← catch 块是否死代码`);
  console.log(`  带 causedBy 的 emit = ${linkedCount}`);
  console.log(`  实测最长因果链 = ${maxChainLen}（maxDepth=64，需 >64 才能触发 TOO_DEEP）`);
  console.log(`  累计违规数 = ${violationCount}`);
}

// ——— 属性 2 / 属性 4：输入空间就是注册码集合 ———
console.log(`\n[属性2] 输入空间 = fc.constantFrom(...ALL_CODES) = ${ALL_CODES.length} 个取值`);
console.log(`  跑 100000 次 → 平均每个取值重复 ${Math.round(100000 / ALL_CODES.length)} 次`);
console.log(`[属性4] 同上，且 source 恒为 { layer: '' }，输入空间同样是 ${ALL_CODES.length}`);

// ——— 属性 3：随机字符串撞不撞注册码 ———
{
  let preFail = 0;
  let total = 0;
  const shapes = new Map<string, number>();
  fc.assert(
    fc.property(fc.string({ minLength: 1, maxLength: 30 }), (s) => {
      total++;
      if (CODE_REGISTRY.has(s)) preFail++;
      // 归类：随机串长什么样
      const shape = s.startsWith('E_') ? 'E_前缀' : /^[A-Za-z_]+$/.test(s) ? '纯字母下划线' : '含其他字符';
      shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
      return true;
    }),
    { numRuns: 5000 }
  );
  console.log(`\n[属性3] 5000 个随机串：撞上注册码 = ${preFail} 次（fc.pre 拦下的比例）`);
  console.log(`  形状分布：${[...shapes].map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`  ← 若"E_前缀"极少，说明"前缀合法但未注册"这一类几乎测不到`);
}

// ——— 属性 5：链长分布 vs maxDepth 边界 ———
{
  const hits = { under: 0, exact64: 0, exact65: 0, over: 0 };
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 200 }), (n) => {
      if (n < 64) hits.under++;
      else if (n === 64) hits.exact64++;
      else if (n === 65) hits.exact65++;
      else hits.over++;
      return true;
    }),
    { numRuns: 10000 }
  );
  console.log(`\n[属性5] 10000 次：<64=${hits.under}, =64=${hits.exact64}, =65=${hits.exact65}, >65=${hits.over}`);
  console.log(`  ← 边界 64/65 是否被稳定命中，还是靠概率碰`);
}

// ——— 属性 6：sealed 与 fatal 的关系是否可能不成立 ———
{
  const fatalCodes = ALL_CODES.filter((c) => CODE_REGISTRY.get(c)!.severity === 'fatal');
  console.log(`\n[属性6] fatal 码 = ${fatalCodes.length}/${ALL_CODES.length}：${fatalCodes.join(', ')}`);
  console.log(`  fatals 与 sealed 都由 spec.severity 推出 → 断言 isSealed===hasFatal 的独立性存疑`);
}

// ——— checkInvariants 的每条子句：合法 API 能不能触发？———
{
  const clauses = [
    'UNREGISTERED',
    'SEVERITY_MISMATCH',
    'BAD_PREFIX',
    'NO_ATTRIBUTION',
    'FATAL_RECOVERABLE',
    'CHAIN',
    'NON_MONOTONIC_TS',
    'FATAL_NOT_SEALED',
  ];
  const seen = new Set<string>();
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom(...ALL_CODES), { minLength: 1, maxLength: 30 }),
      fc.array(fc.boolean(), { minLength: 1, maxLength: 30 }),
      (codes, links) => {
        const col = new DiagnosticCollector();
        const em: Diagnostic[] = [];
        codes.forEach((c, i) => {
          const cb = links[i] && em.length ? em[em.length - 1] : undefined;
          em.push(col.emit(c, { layer: 'kernel' }, undefined, cb));
        });
        for (const v of col.checkInvariants()) {
          for (const cl of clauses) if (v.startsWith(cl)) seen.add(cl);
        }
        return true;
      }
    ),
    { numRuns: 3000 }
  );
  console.log(`\n[检查器子句] 3000 次合法序列命中的子句 = ${seen.size ? [...seen].join(', ') : '（无）'}`);
  console.log(`  未命中 = ${clauses.filter((c) => !seen.has(c)).join(', ')}`);
  console.log(`  ← 合法状态下每条子句都返回空，删掉任一条都不可观测（L8 已证的第七种空转）`);
}
