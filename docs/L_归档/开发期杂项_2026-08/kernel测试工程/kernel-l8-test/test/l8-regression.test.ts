/**
 * L8 回归钉：每条对应一个**实测确认**的缺陷。
 *
 * 这些用例的价值不在"现在是绿的"，而在"缺陷回来时必然变红"。
 * 每条都注明原行为，便于后来者判断改动是否在复活旧缺陷。
 *
 * 前七条是产品缺陷（BUG L8#1..#7），最后一条是**测试自身**的缺陷
 * （删除类 op 全程不可达），它同样要钉住——否则重建成果会被下一次
 * "顺手改一下生成器"悄悄抹掉。
 */
import { describe, it, expect } from 'vitest';
import { RelationSystem } from '../src/relation';
import type { AttachmentDef } from '../src/relation';

const att = (over: Partial<AttachmentDef> = {}): AttachmentDef => ({
  id: 'a1', type: 'aura', target: 't1', grantedBy: 'g1', effects: [], deps: [], ...over,
});

describe('BUG L8#1: createEntity 用已存在的 id 会静默孤立旧关系', () => {
  /**
   * 原行为：`this.entities.set(id, e)` 无条件覆盖。
   * 旧 stub 连同它的 out/in 索引一起被丢弃，而 relations 主表里那些关系还在，
   * 于是主表与索引脱钩——checkInvariants 会报 E_INV_ASYMMETRIC，
   * 但这个状态是**一次合法的公开 API 调用**造成的，不是外部注入的损坏。
   * 引擎层不能有"正常调用即破坏不变量"的入口。
   */
  it('重复 id 抛 E_ENTITY_EXISTS，且旧关系与索引完好', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2');

    expect(() => sys.createEntity('e1')).toThrow('E_ENTITY_EXISTS');

    // 失败的调用不得留下任何痕迹
    expect(sys.get('relation', 'r1')).toBeDefined();
    expect(sys.checkInvariants()).toEqual([]);
    const e1 = sys.get('entity', 'e1') as any;
    expect([...e1.rel.out.get('ally')]).toEqual(['r1']);
  });

  it('抛错后系统仍可继续正常使用（不是半损状态）', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    try { sys.createEntity('e1'); } catch { /* 预期 */ }
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    expect(sys.checkInvariants()).toEqual([]);
  });
});

describe('BUG L8#2: 检查器单向——索引里的残留项不可见', () => {
  /**
   * 原行为：checkInvariants 只从 relations 出发问"索引里有它吗"，
   * 从不从索引出发问"这些都还在主表里吗"。
   * 后果：把 relation_del 里清索引的两行删掉，原有 10 项测试全绿。
   */
  it('主表已删、索引残留 → E_INV_STALE_INDEX', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2');

    // 模拟"清索引那两行被删掉"的效果：只从主表删
    (sys as unknown as { relations: Map<string, unknown> }).relations.delete('r1');

    const codes = sys.checkInvariants().map((v) => v.code);
    expect(codes).toContain('E_INV_STALE_INDEX');
    // 两侧索引各报一条
    expect(codes.filter((c) => c === 'E_INV_STALE_INDEX')).toHaveLength(2);
  });

  it('索引项的 from 端与所在 entity 不符 → E_INV_STALE_INDEX', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.createEntity('e3');
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    // e3 的 out 桶里伪造一条属于 e1 的关系
    (sys as unknown as { entities: Map<string, any> }).entities
      .get('e3')!.rel.out.set('ally', ['r1']);

    expect(sys.checkInvariants().map((v) => v.code)).toContain('E_INV_STALE_INDEX');
  });

  it('relation_del 后索引两侧都干净（正向确认删除路径本身正确）', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    sys.relation_del('r1');

    const e1 = sys.get('entity', 'e1') as any;
    const e2 = sys.get('entity', 'e2') as any;
    expect([...(e1.rel.out.get('ally') ?? [])]).toEqual([]);
    expect([...(e2.rel.in.get('ally') ?? [])]).toEqual([]);
    expect(sys.checkInvariants()).toEqual([]);
  });
});

describe('BUG L8#3: 检查器单向——attachment 未登记在 target 上不可见', () => {
  /**
   * 原行为：只查"entity.attachments 里的 id 在 map 里吗"，
   * 不查"map 里的 att 登记在它 target 上了吗"。
   * 后果：attachment_add 里 `.attachments.add(...)` 那行删掉也能全绿。
   */
  it('map 有 att 但 target 未登记 → E_INV_INCONSISTENT', () => {
    const sys = new RelationSystem();
    sys.createEntity('t1');
    sys.createEntity('g1');
    sys.attachment_add(att());

    (sys as unknown as { entities: Map<string, any> }).entities
      .get('t1')!.attachments.delete('a1');

    const vs = sys.checkInvariants();
    expect(vs.map((v) => v.code)).toEqual(['E_INV_INCONSISTENT']);
    expect(vs[0]!.detail).toContain('未登记');
  });
});

describe('BUG L8#4: 索引桶内重复 id 不可见', () => {
  /**
   * 原行为：relation_del 用 filter 一次性滤掉所有同 id 项，
   * 掩盖了"索引里本就不该有重复"这条约束。若某处改成 push 两次，
   * 单向检查的 `includes` 依然为真，重复项就成了幽灵。
   */
  it('同一桶内重复 relId → E_INV_DUPLICATE_INDEX', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    (sys as unknown as { entities: Map<string, any> }).entities
      .get('e1')!.rel.out.get('ally')!.push('r1');

    expect(sys.checkInvariants().map((v) => v.code)).toContain('E_INV_DUPLICATE_INDEX');
  });

  it('同一对 entity 的多条同类型关系不算重复（不得误报）', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2');
    sys.relation_add('r2', 'ally', 'e1', 'e2');
    expect(sys.checkInvariants()).toEqual([]);
  });
});

describe('BUG L8#5: attachment_add 按引用存 def', () => {
  /**
   * 原行为：`this.attachments.set(def.id, def)` 直接存调用方的对象。
   * 前置校验校验的是"入参当时的样子"，调用方事后改 def 就能绕过全部校验，
   * 把库里那份改成悬空引用。deps/effects 是数组，必须逐层拷。
   */
  it('调用方事后改 deps 不影响库内那份', () => {
    const sys = new RelationSystem();
    sys.createEntity('t1');
    sys.createEntity('g1');
    const def = att({ deps: [] });
    sys.attachment_add(def);

    def.deps.push('不存在的实体');

    expect((sys.get('attachment', 'a1') as any).deps).toEqual([]);
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('调用方事后改 target 不影响库内那份', () => {
    const sys = new RelationSystem();
    sys.createEntity('t1');
    sys.createEntity('g1');
    const def = att();
    sys.attachment_add(def);

    def.target = '不存在的实体';

    expect((sys.get('attachment', 'a1') as any).target).toBe('t1');
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('调用方事后改 effects 不影响库内那份', () => {
    const sys = new RelationSystem();
    sys.createEntity('t1');
    sys.createEntity('g1');
    const def = att({ effects: [] });
    sys.attachment_add(def);

    def.effects.push({ op: 'x', args: {} });

    expect((sys.get('attachment', 'a1') as any).effects).toHaveLength(0);
  });

  it('返回值也是副本：改返回值不影响库内那份', () => {
    const sys = new RelationSystem();
    sys.createEntity('t1');
    sys.createEntity('g1');
    const ret = sys.attachment_add(att());
    ret.target = '不存在的实体';
    ret.deps.push('也不存在');

    expect((sys.get('attachment', 'a1') as any).target).toBe('t1');
    expect(sys.checkInvariants()).toEqual([]);
  });
});

describe('BUG L8#6: relation_add 按引用存 attrs / 返回内部对象', () => {
  it('调用方事后改 attrs 不影响库内那份', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    const attrs: Record<string, unknown> = { w: 1 };
    sys.relation_add('r1', 'ally', 'e1', 'e2', attrs);

    attrs.w = 999;
    attrs.injected = true;

    expect((sys.get('relation', 'r1') as any).attrs).toEqual({ w: 1 });
  });

  it('改返回值的 from 不影响库内那份（原实现可借此让索引脱钩）', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.createEntity('e3');
    const ret = sys.relation_add('r1', 'ally', 'e1', 'e2');

    ret.from = 'e3';
    ret.attrs.injected = true;

    const stored = sys.get('relation', 'r1') as any;
    expect(stored.from).toBe('e1');
    expect(stored.attrs).toEqual({});
    expect(sys.checkInvariants()).toEqual([]);
  });
});

describe('BUG L8#7: get 交出内部对象，可绕过 Op 边界改坏索引', () => {
  /**
   * 原行为：get 返回内部 stub / def 本体。
   * 于是 `(get('entity','e1') as any).rel.out.get('ally').push('伪造')`
   * 就能在不经任何 Op 的情况下伪造索引项——等于没有 Op 边界。
   */
  it('改 get 到的 entity stub 不影响库内索引', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2');

    const e1 = sys.get('entity', 'e1') as any;
    e1.rel.out.get('ally').push('伪造的relId');
    e1.attachments.add('伪造的attId');
    e1.rel.in.set('enemy', ['也是伪造的']);

    expect(sys.checkInvariants()).toEqual([]);
  });

  it('改 get 到的 relation 不影响库内那份', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2');

    const r = sys.get('relation', 'r1') as any;
    r.type = '改过的';
    r.to = '不存在';

    expect(sys.checkInvariants()).toEqual([]);
    expect((sys.get('relation', 'r1') as any).type).toBe('ally');
  });

  it('改 get 到的 attachment 不影响库内那份', () => {
    const sys = new RelationSystem();
    sys.createEntity('t1');
    sys.createEntity('g1');
    sys.createEntity('d1');
    sys.attachment_add(att({ deps: ['d1'] }));

    const a = sys.get('attachment', 'a1') as any;
    a.deps.push('不存在');
    a.grantedBy = '也不存在';

    expect(sys.checkInvariants()).toEqual([]);
    expect((sys.get('attachment', 'a1') as any).deps).toEqual(['d1']);
  });

  it('get 不存在的 id 返回 undefined（不是抛错，也不是空对象）', () => {
    const sys = new RelationSystem();
    expect(sys.get('entity', '无')).toBeUndefined();
    expect(sys.get('relation', '无')).toBeUndefined();
    expect(sys.get('attachment', '无')).toBeUndefined();
  });
});

describe('BUG L8#8（测试缺陷）: 删除类 op 曾全程不可达', () => {
  /**
   * 原生成器用 `fc.uuid()` 造 relation/attachment 的 id，
   * 而 relation_del / attachment_del 从**另一个固定池**（REL_POOL / ATT_POOL）取 id。
   * 两个池永不相交 ⇒ 删除永远删不到东西：实测 0/2000 次生效。
   * 于是 10 万次 fuzz 里，六种 op 有三种是死的。
   *
   * 这条钉子确认：同池取 id 时，删除确实能命中。
   * 它不测产品，测的是"测试还有没有在做事"。
   */
  it('同池取 id 时 relation_del 确实删得到', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.relation_add('r0', 'ally', 'e1', 'e2');
    expect(sys.get('relation', 'r0')).toBeDefined();
    sys.relation_del('r0');
    expect(sys.get('relation', 'r0')).toBeUndefined();
  });

  it('同池取 id 时 attachment_del 确实删得到', () => {
    const sys = new RelationSystem();
    sys.createEntity('t1');
    sys.createEntity('g1');
    sys.attachment_add(att({ id: 'a0' }));
    expect(sys.get('attachment', 'a0')).toBeDefined();
    sys.attachment_del('a0');
    expect(sys.get('attachment', 'a0')).toBeUndefined();
  });

  it('uuid 造的 entity 无法被后续 op 引用（原生成器的第二处空转）', () => {
    // 原 create_entity 用 fc.uuid() 造 id，而所有引用类 op 都从 ENTITY_POOL 取端点。
    // 于是这些 entity 一旦造出就再也碰不到，等于纯增计数。
    const sys = new RelationSystem();
    const uuidLike = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    sys.createEntity(uuidLike);
    sys.createEntity('e1');
    // 从固定池取端点时，uuid 实体永远不是任何关系的端点
    expect(() => sys.relation_add('r1', 'ally', 'e1', 'e2')).toThrow('E_REF_INVALID');
    expect(sys.get('entity', uuidLike)).toBeDefined();
  });
});

/**
 * 以下五组由**变异测试的存活名单**倒推出来，不是读代码想出来的。
 * 首轮 92.31%，7 个存活；其中 5 个是真盲区，各自对应下面一组。
 * 记录来源是为了让后来者知道：这些用例不是补充说明，是判别力的补丁。
 */
describe('BUG L8#9: createEntity 的返回值也是内部 stub（M03 倒推）', () => {
  /**
   * 全套件没有一处使用 createEntity 的返回值，于是"它交出什么"完全无人看守。
   * 而创建者天然持有这个句柄，最容易顺手当自己的对象改——
   * 比 get() 那条更容易被踩到。
   */
  it('改 createEntity 返回的 stub 不影响库内索引', () => {
    const sys = new RelationSystem();
    const stub = sys.createEntity('e1') as any;
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2');

    stub.rel.out.set('ally', ['伪造']);
    stub.rel.in.set('enemy', ['也伪造']);
    stub.attachments.add('无此att');

    expect(sys.checkInvariants()).toEqual([]);
    const fresh = sys.get('entity', 'e1') as any;
    expect([...fresh.rel.out.get('ally')]).toEqual(['r1']);
  });

  it('createEntity 返回的 stub 与后续 get 的不是同一对象', () => {
    const sys = new RelationSystem();
    const a = sys.createEntity('e1');
    const b = sys.get('entity', 'e1');
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('BUG L8#10: get 的兜底分支返回空对象也无人看守（M77 倒推）', () => {
  /**
   * `get` 末尾的 `return undefined` 是"type 参数不在三者之内"的兜底。
   * 联合类型让它在类型内不可达，于是测试从不覆盖——
   * 但引擎层的读接口会被上层用字符串动态调用，兜底分支必须是 undefined，
   * 不能是空对象：空对象会让调用方的 `if (result)` 判成"查到了"。
   */
  it('未知 type 返回 undefined，而不是空对象', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    const dyn = sys.get as unknown as (t: string, id: string) => unknown;
    expect(dyn('bogus', 'e1')).toBeUndefined();
    expect(dyn('', 'e1')).toBeUndefined();
    expect(dyn('Entity', 'e1')).toBeUndefined(); // 大小写敏感
  });
});

describe('BUG L8#11: dump 交出 attrs 引用（M83 倒推）', () => {
  /**
   * dump 是影子对照的观测面。若它交出内部引用，
   * "快照"就不是快照——对照过程本身可以改变被对照的状态。
   */
  it('改 dump 结果里的 attrs 不影响库内那份', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2', { w: 1 });

    const snap = sys.dump();
    snap.relations['r1']!.attrs['w'] = 999;
    snap.relations['r1']!.attrs['injected'] = true;

    expect(sys.dump().relations['r1']!.attrs).toEqual({ w: 1 });
    expect((sys.get('relation', 'r1') as any).attrs).toEqual({ w: 1 });
  });

  it('两次 dump 互不共享容器', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2', { w: 1 });

    const s1 = sys.dump();
    const s2 = sys.dump();
    expect(s1.relations['r1']!.attrs).not.toBe(s2.relations['r1']!.attrs);
    expect(s1.index['e1']!.out['ally']).not.toBe(s2.index['e1']!.out['ally']);
  });
});

describe('BUG L8#12: cloneAttachment 未拷 effects 内层 args（M88 倒推）', () => {
  /**
   * 逐层拷必须真的逐层。拷了 effects 数组但共享每个 EffectDef 的 args，
   * 调用方仍能改到库里的 effect 参数——只是多绕一层。
   * 变异测试把"拷一层"和"拷到底"区分开了，人眼审阅通常不会。
   */
  it('改返回值的 effect.args 不影响库内那份', () => {
    const sys = new RelationSystem();
    sys.createEntity('t1');
    sys.createEntity('g1');
    const ret = sys.attachment_add(att({ effects: [{ op: 'dmg', args: { n: 1 } }] }));

    ret.effects[0]!.args['n'] = 999;
    ret.effects[0]!.args['injected'] = true;

    const stored = sys.get('attachment', 'a1') as any;
    expect(stored.effects[0].args).toEqual({ n: 1 });
  });

  it('改入参的 effect.args 不影响库内那份', () => {
    const sys = new RelationSystem();
    sys.createEntity('t1');
    sys.createEntity('g1');
    const def = att({ effects: [{ op: 'dmg', args: { n: 1 } }] });
    sys.attachment_add(def);

    def.effects[0]!.args['n'] = 999;

    expect((sys.get('attachment', 'a1') as any).effects[0].args).toEqual({ n: 1 });
  });

  it('两次 get 的 effect.args 不是同一对象', () => {
    const sys = new RelationSystem();
    sys.createEntity('t1');
    sys.createEntity('g1');
    sys.attachment_add(att({ effects: [{ op: 'dmg', args: { n: 1 } }] }));

    const a1 = sys.get('attachment', 'a1') as any;
    const a2 = sys.get('attachment', 'a1') as any;
    expect(a1.effects[0].args).not.toBe(a2.effects[0].args);
  });
});

describe('BUG L8#13: cloneEntityStub 的 in 索引桶共享（M92 倒推）', () => {
  /**
   * out 桶有测试守着、in 桶没有——这是"对称代码只测一半"的典型。
   * 双向索引的两侧必须各自被断言，不能因为写法对称就认为覆盖对称。
   */
  it('改 get 到的 in 索引桶不影响库内那份', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2');

    const e2 = sys.get('entity', 'e2') as any;
    e2.rel.in.get('ally').push('伪造');

    expect(sys.checkInvariants()).toEqual([]);
    expect([...(sys.get('entity', 'e2') as any).rel.in.get('ally')]).toEqual(['r1']);
  });

  it('两次 get 的 in 桶不是同一数组', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.createEntity('e2');
    sys.relation_add('r1', 'ally', 'e1', 'e2');

    // 注意断言的是**桶数组**，不只是外层 Map。
    // 只比 `a.rel.in !== b.rel.in` 是恒真的：Map 每次都新建，
    // 共享发生在桶数组这一层。初版就只比了 Map，手动打上 M92 时它没红——
    // 这正是"未验证的区分性断言"，靠跑变异体才暴露。
    const a = sys.get('entity', 'e1') as any;
    const b = sys.get('entity', 'e1') as any;
    expect(a.rel.out.get('ally')).not.toBe(b.rel.out.get('ally'));
    expect((sys.get('entity', 'e2') as any).rel.in.get('ally'))
      .not.toBe((sys.get('entity', 'e2') as any).rel.in.get('ally'));
    expect(a.attachments).not.toBe(b.attachments);
  });
});

describe('级联删除语义（原有测试已覆盖，此处补全组合情形）', () => {
  it('target 与 grantedBy 是同一实体时只删一次，不抛错', () => {
    const sys = new RelationSystem();
    sys.createEntity('x');
    sys.attachment_add(att({ target: 'x', grantedBy: 'x' }));
    sys.destroyEntity('x');
    expect(sys.get('attachment', 'a1')).toBeUndefined();
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('一个实体同时是 A 的 target 和 B 的 dep 时两者都删', () => {
    const sys = new RelationSystem();
    sys.createEntity('t1');
    sys.createEntity('g1');
    sys.createEntity('shared');
    sys.attachment_add(att({ id: 'a1', target: 'shared', grantedBy: 'g1' }));
    sys.attachment_add(att({ id: 'a2', target: 't1', grantedBy: 'g1', deps: ['shared'] }));

    sys.destroyEntity('shared');

    expect(sys.get('attachment', 'a1')).toBeUndefined();
    expect(sys.get('attachment', 'a2')).toBeUndefined();
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('自环关系的 destroyEntity 不留残索引', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    sys.relation_add('rSelf', 'self', 'e1', 'e1');
    sys.destroyEntity('e1');
    expect(sys.get('relation', 'rSelf')).toBeUndefined();
    expect(sys.checkInvariants()).toEqual([]);
  });

  it('destroyEntity 不存在的实体抛 E_REF_INVALID 且不改变状态', () => {
    const sys = new RelationSystem();
    sys.createEntity('e1');
    const before = JSON.stringify(sys.dump());
    expect(() => sys.destroyEntity('无')).toThrow('E_REF_INVALID');
    expect(JSON.stringify(sys.dump())).toBe(before);
  });
});
