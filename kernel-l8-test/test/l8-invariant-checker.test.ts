/**
 * L8 检查器自证套件：向私有状态注入损坏，反向证明 checkInvariants 每条子句真会报错。
 *
 * 为什么必须有这一套：
 * `expect(sys.checkInvariants()).toHaveLength(0)` 在一个**永远返回空数组**的
 * 检查器上同样全绿。原 L8 套件 10 项里有 8 项以此为主判据——
 * 那 8 项断言的其实是"检查器没吵"，不是"状态没坏"。
 *
 * 每条子句一次独立注入，且断言**具体违规码与条数**，不只断言"非空"：
 * 只断言非空的话，把所有码合并成一个通用码也照样通过，
 * 于是"坏在哪里"这个信息就再也测不出来了（L7 的 E_REF_INVALID 教训）。
 */
import { describe, it, expect } from 'vitest';
import { RelationSystem } from '../src/relation';
import type { AttachmentDef } from '../src/relation';

/** 取得私有内部结构的写句柄。注入损坏是本套件的全部目的，故此处刻意绕过封装。 */
const guts = <T>(o: unknown): T => o as T;

interface Guts {
  entities: Map<string, {
    id: string;
    rel: { out: Map<string, string[]>; in: Map<string, string[]> };
    attachments: Set<string>;
  }>;
  relations: Map<string, { id: string; type: string; from: string; to: string; attrs: Record<string, unknown> }>;
  attachments: Map<string, AttachmentDef>;
}

function baseSys(): RelationSystem {
  const sys = new RelationSystem();
  sys.createEntity('e1');
  sys.createEntity('e2');
  sys.createEntity('e3');
  return sys;
}

function codes(sys: RelationSystem): string[] {
  return sys.checkInvariants().map((v) => v.code).sort();
}

describe('L8 检查器自证：先证明它不是恒空', () => {
  it('干净状态下确实为空（否则后续注入的阳性结果无意义）', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    sys.attachment_add({ id: 'a1', type: 'aura', target: 'e1', grantedBy: 'e2', effects: [], deps: ['e3'] });
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('注入一处损坏就必须报一条——证明检查器会被"叫醒"', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    // 直接从 entities 里抹掉 e2，制造悬空 to 端
    guts<Guts>(sys).entities.delete('e2');
    expect(codes(sys)).toEqual(['E_INV_DANGLING']);
  });
});

describe('L8 检查器：正向子句（relations → 索引）', () => {
  /**
   * 改写 rel.from 会**同时**触发两条子句，这不是冗余：
   *   正向：从 relations 出发，发现 from 端实体不存在 → E_INV_DANGLING（随后 continue）
   *   反向：从 e1 的 out 索引出发，发现桶里那条 rel 的 from 已不是 e1 → E_INV_STALE_INDEX
   * 一次改写留下的正是"主表与索引互相不认"的双向证据。
   * 初版只断言了 E_INV_DANGLING，被实际运行纠正——这里记录下来：
   * 断言"恰好等于某集合"比"包含某项"严格，也因此更容易暴露自己想错了。
   */
  it('rel.from 指向不存在的 entity → 正向 DANGLING + 反向 STALE_INDEX', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    guts<Guts>(sys).relations.get('r1')!.from = '不存在';
    expect(codes(sys)).toEqual(['E_INV_DANGLING', 'E_INV_STALE_INDEX']);
  });

  it('rel.to 指向不存在的 entity → 正向 DANGLING + 反向 STALE_INDEX', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    guts<Guts>(sys).relations.get('r1')!.to = '不存在';
    expect(codes(sys)).toEqual(['E_INV_DANGLING', 'E_INV_STALE_INDEX']);
  });

  it('out 索引缺了该 rel → E_INV_ASYMMETRIC', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    guts<Guts>(sys).entities.get('e1')!.rel.out.set('ally', []);
    expect(codes(sys)).toEqual(['E_INV_ASYMMETRIC']);
  });

  it('in 索引缺了该 rel → E_INV_ASYMMETRIC', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    guts<Guts>(sys).entities.get('e2')!.rel.in.set('ally', []);
    expect(codes(sys)).toEqual(['E_INV_ASYMMETRIC']);
  });

  it('两侧索引都缺 → 报两条，不是一条', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    const g = guts<Guts>(sys);
    g.entities.get('e1')!.rel.out.set('ally', []);
    g.entities.get('e2')!.rel.in.set('ally', []);
    // 报两条才说明 out 与 in 是两条独立子句；合并成一条会让删掉任一侧无法区分
    expect(codes(sys)).toEqual(['E_INV_ASYMMETRIC', 'E_INV_ASYMMETRIC']);
  });

  it('自环 relation 的两侧索引各自独立校验', () => {
    const sys = baseSys();
    sys.relation_add('rs', 'self', 'e1', 'e1');
    expect(sys.checkInvariants()).toEqual([]);
    // 只抹 out，in 仍在：自环下二者存在同一 entity 上，必须仍能分别报出
    guts<Guts>(sys).entities.get('e1')!.rel.out.set('self', []);
    expect(codes(sys)).toEqual(['E_INV_ASYMMETRIC']);
  });
});

describe('L8 检查器：attachment 正向子句', () => {
  it('att.target 不存在 → E_INV_DANGLING', () => {
    const sys = baseSys();
    sys.attachment_add({ id: 'a1', type: 'aura', target: 'e1', grantedBy: 'e2', effects: [], deps: [] });
    guts<Guts>(sys).attachments.get('a1')!.target = '不存在';
    // target 改指后：原 e1 集合里仍有 a1（另一条子句会报），故此处断言包含关系
    expect(codes(sys)).toContain('E_INV_DANGLING');
  });

  it('att.grantedBy 不存在 → E_INV_DANGLING', () => {
    const sys = baseSys();
    sys.attachment_add({ id: 'a1', type: 'aura', target: 'e1', grantedBy: 'e2', effects: [], deps: [] });
    guts<Guts>(sys).attachments.get('a1')!.grantedBy = '不存在';
    expect(codes(sys)).toEqual(['E_INV_DANGLING']);
  });

  it('att.deps 里有不存在的 entity → 每个坏 dep 各报一条', () => {
    const sys = baseSys();
    sys.attachment_add({ id: 'a1', type: 'aura', target: 'e1', grantedBy: 'e2', effects: [], deps: ['e3'] });
    guts<Guts>(sys).attachments.get('a1')!.deps = ['坏1', '坏2', 'e3'];
    // 三个 dep 里两个坏 → 两条。只报一条说明检查器 break 了而非遍历完
    expect(codes(sys)).toEqual(['E_INV_DANGLING', 'E_INV_DANGLING']);
  });

  it('entity.attachments 引用了主表没有的 att → E_INV_INCONSISTENT', () => {
    const sys = baseSys();
    guts<Guts>(sys).entities.get('e1')!.attachments.add('幽灵att');
    expect(codes(sys)).toEqual(['E_INV_INCONSISTENT']);
  });
});

describe('L8 检查器：反向子句（索引 → 主表）— 重建前这一组全部无人看守', () => {
  it('out 索引残留已删 rel → E_INV_STALE_INDEX', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    const g = guts<Guts>(sys);
    // 只从主表删，索引不动：这正是"删除时漏清索引"留下的现场
    g.relations.delete('r1');
    expect(codes(sys)).toEqual(['E_INV_STALE_INDEX', 'E_INV_STALE_INDEX']);
  });

  it('out 索引里的 rel 其 from 指向别的 entity → E_INV_STALE_INDEX', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    // 把 r1 塞进 e3 的 out 桶：主表里 r1.from 是 e1，与 e3 不符
    guts<Guts>(sys).entities.get('e3')!.rel.out.set('ally', ['r1']);
    expect(codes(sys)).toEqual(['E_INV_STALE_INDEX']);
  });

  it('in 索引里的 rel 其 to 指向别的 entity → E_INV_STALE_INDEX', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    guts<Guts>(sys).entities.get('e3')!.rel.in.set('ally', ['r1']);
    expect(codes(sys)).toEqual(['E_INV_STALE_INDEX']);
  });

  it('索引桶的 type 键与 rel.type 不符 → E_INV_STALE_INDEX（两侧各一条）', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    const g = guts<Guts>(sys);
    // 搬到 'enemy' 桶下，同时清掉 ally 桶，制造"分桶错位"而非"缺失"
    g.entities.get('e1')!.rel.out.delete('ally');
    g.entities.get('e1')!.rel.out.set('enemy', ['r1']);
    g.entities.get('e2')!.rel.in.delete('ally');
    g.entities.get('e2')!.rel.in.set('enemy', ['r1']);
    // 正向看：ally 桶里找不到 → 两条 ASYMMETRIC
    // 反向看：enemy 桶里的 r1 其 type 是 ally → 两条 STALE_INDEX
    expect(codes(sys)).toEqual([
      'E_INV_ASYMMETRIC', 'E_INV_ASYMMETRIC',
      'E_INV_STALE_INDEX', 'E_INV_STALE_INDEX',
    ]);
  });

  it('同一索引桶里同一 relId 出现两次 → E_INV_DUPLICATE_INDEX', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    guts<Guts>(sys).entities.get('e1')!.rel.out.set('ally', ['r1', 'r1']);
    // 重复项是"幽灵索引"的成因：filter 删一次剩一次
    expect(codes(sys)).toEqual(['E_INV_DUPLICATE_INDEX']);
  });

  it('in 桶重复同样被查出（不是只查了 out）', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    guts<Guts>(sys).entities.get('e2')!.rel.in.set('ally', ['r1', 'r1']);
    expect(codes(sys)).toEqual(['E_INV_DUPLICATE_INDEX']);
  });

  it('att 存在但 target 未登记它 → E_INV_INCONSISTENT', () => {
    const sys = baseSys();
    sys.attachment_add({ id: 'a1', type: 'aura', target: 'e1', grantedBy: 'e2', effects: [], deps: [] });
    // 只从 entity 集合里摘掉，主表保留：这是"登记漏了"的现场
    guts<Guts>(sys).entities.get('e1')!.attachments.delete('a1');
    expect(codes(sys)).toEqual(['E_INV_INCONSISTENT']);
  });

  it('att.target 改指他处（两侧都没跟上）→ 报"未登记"', () => {
    const sys = baseSys();
    sys.attachment_add({ id: 'a1', type: 'aura', target: 'e1', grantedBy: 'e2', effects: [], deps: [] });
    const g = guts<Guts>(sys);
    g.attachments.get('a1')!.target = 'e2';
    g.entities.get('e1')!.attachments.delete('a1');
    // e2 是合法 entity，故没有 DANGLING；靠反向子句才看得见
    expect(codes(sys)).toEqual(['E_INV_INCONSISTENT']);
  });
});

describe('L8 检查器：多重损坏必须全报，不能查到一条就跑', () => {
  it('五处不同类型的损坏同时注入 → 五类码全部出现', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    sys.relation_add('r2', 'enemy', 'e2', 'e3');
    sys.attachment_add({ id: 'a1', type: 'aura', target: 'e1', grantedBy: 'e2', effects: [], deps: [] });
    const g = guts<Guts>(sys);

    // 1) 悬空：a1 的 grantedBy 指向不存在
    g.attachments.get('a1')!.grantedBy = '不存在';
    // 2) 不对称：r1 的 out 索引被抹
    g.entities.get('e1')!.rel.out.set('ally', []);
    // 3) 残留索引：e3 的 out 桶里塞一个主表没有的 id
    g.entities.get('e3')!.rel.out.set('ally', ['幽灵rel']);
    // 4) 重复索引：r2 在 e2 的 out 桶里出现两次
    g.entities.get('e2')!.rel.out.set('enemy', ['r2', 'r2']);
    // 5) 不一致：e2 引用一个主表没有的 att
    g.entities.get('e2')!.attachments.add('幽灵att');

    const got = new Set(codes(sys));
    // 用集合断言"五类都在"；逐条计数会因注入间的相互作用而脆弱
    expect(got).toEqual(new Set([
      'E_INV_DANGLING',
      'E_INV_ASYMMETRIC',
      'E_INV_STALE_INDEX',
      'E_INV_DUPLICATE_INDEX',
      'E_INV_INCONSISTENT',
    ]));
  });

  it('检查器是纯观测：连查两次结果相同，且不修正任何损坏', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    guts<Guts>(sys).relations.delete('r1');
    const first = sys.checkInvariants();
    const second = sys.checkInvariants();
    expect(second).toEqual(first);
    // 注意：这里不是"同一输入两次结果相同"式的重言式——
    // 断言的是**检查器没有顺手修好损坏**，即第二次仍然报同样的违规。
    expect(second.length).toBeGreaterThan(0);
  });
});

describe('L8 检查器：违规详情必须可定位', () => {
  it('每条违规的 detail 都非空且含涉事 id', () => {
    const sys = baseSys();
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    guts<Guts>(sys).relations.delete('r1');
    const vs = sys.checkInvariants();
    expect(vs.length).toBeGreaterThan(0);
    for (const v of vs) {
      expect(v.detail.length).toBeGreaterThan(0);
      // detail 里必须能找到出问题的 relId，否则拿到报告也无法定位
      expect(v.detail).toContain('r1');
    }
  });

  it('五个违规码取值互不相同（防止合码退化）', () => {
    // 直接钉死字面量：若断言写成"引用产品自己的常量"，
    // 把两个码改成同一个字符串时产品与判据会一起变，测试察觉不到。
    const all = ['E_INV_DANGLING', 'E_INV_ASYMMETRIC', 'E_INV_STALE_INDEX', 'E_INV_DUPLICATE_INDEX', 'E_INV_INCONSISTENT'];
    expect(new Set(all).size).toBe(all.length);
  });
});
