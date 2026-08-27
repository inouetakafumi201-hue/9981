import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DefRegistry, type Def } from '../def';

function baseDef(id: string, extendsIds?: string[], props?: Record<string, unknown>): Def {
  return {
    id,
    kind: 'entity',
    extends: extendsIds,
    props: (props ?? {}) as Def['props'],
  };
}

describe('DefRegistry: 继承展开与环检测', () => {
  it('单个 Def 无继承时直接注册成功', () => {
    const reg = new DefRegistry();
    const r = reg.register(baseDef('d:base', undefined, { hp: 10 }));
    expect(r.ok).toBe(true);
    expect(reg.resolve('d:base')?.props).toEqual({ hp: 10 });
  });

  it('多重 extends 按声明顺序合并，后覆盖前（需求3.2）', () => {
    const reg = new DefRegistry();
    reg.register(baseDef('d:a', undefined, { hp: 10, mp: 5 }));
    reg.register(baseDef('d:b', undefined, { hp: 20, atk: 3 }));
    const r = reg.register(baseDef('d:child', ['d:a', 'd:b'], { speed: 1 }));
    expect(r.ok).toBe(true);
    // d:b 覆盖 d:a 的 hp，child 自己的字段最终覆盖
    expect(reg.resolve('d:child')?.props).toEqual({ hp: 20, mp: 5, atk: 3, speed: 1 });
  });

  it('检测到继承环时拒绝注册并产出诊断（需求3.4）', () => {
    const reg = new DefRegistry();
    reg.register(baseDef('d:x', ['d:y']));
    const r = reg.register(baseDef('d:y', ['d:x']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('E_LOAD_CYCLE_DEP');
    }
  });

  it('abstract Def 不得被直接实例化（需求3.5）：标记保留在 resolved 结果里供上层拒绝实例化', () => {
    const reg = new DefRegistry();
    reg.register({ id: 'd:abs', kind: 'entity', abstract: true });
    expect(reg.resolve('d:abs')?.abstract).toBe(true);
  });

  it('abstract 不是可继承的数据字段：具体子类继承自 abstract 父类后，子类自身应为非 abstract（真实缺陷修正，见 决策与风险记录.md）', () => {
    const reg = new DefRegistry();
    reg.register({ id: 'd:baseCreature', kind: 'entity', abstract: true, props: { canMove: true } });
    reg.register({ id: 'd:goblin', kind: 'entity', extends: ['d:baseCreature'] });
    // 子类继承了父类的 props，但不应继承 abstract 标记
    expect(reg.resolve('d:goblin')?.abstract).toBe(false);
    expect(reg.resolve('d:goblin')?.props).toEqual({ canMove: true });
    // 父类自身的 abstract 标记不受影响
    expect(reg.resolve('d:baseCreature')?.abstract).toBe(true);
  });

  it('子类可以显式重新声明 abstract:true，覆盖"默认非 abstract"的规则（抽象链：abstract 继承自 abstract，中间层仍是抽象）', () => {
    const reg = new DefRegistry();
    reg.register({ id: 'd:base', kind: 'entity', abstract: true });
    reg.register({ id: 'd:middle', kind: 'entity', extends: ['d:base'], abstract: true });
    reg.register({ id: 'd:leaf', kind: 'entity', extends: ['d:middle'] });
    expect(reg.resolve('d:middle')?.abstract).toBe(true); // 显式声明保留
    expect(reg.resolve('d:leaf')?.abstract).toBe(false); // 未声明则默认具体，即使父链是抽象的
  });

  it('未声明 abstract 字段的普通 Def，resolve 结果应为 abstract:false（而非 undefined），供 checkInstantiable 做严格布尔判断', () => {
    const reg = new DefRegistry();
    reg.register({ id: 'd:plain', kind: 'entity' });
    expect(reg.resolve('d:plain')?.abstract).toBe(false);
  });

  it('defIsA 沿继承链判断归属', () => {
    const reg = new DefRegistry();
    reg.register(baseDef('d:animal'));
    reg.register(baseDef('d:dog', ['d:animal']));
    expect(reg.defIsA('d:dog', 'd:animal')).toBe(true);
    expect(reg.defIsA('d:dog', 'd:dog')).toBe(true);
    expect(reg.defIsA('d:animal', 'd:dog')).toBe(false);
  });

  it('Property: 对于任意无环的 extends 链，resolve() 结果应与手动逐层合并一致（需求3.2）', () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ hp: fc.integer(), tag: fc.string({ maxLength: 5 }) }), { minLength: 1, maxLength: 5 }),
        (layers) => {
          const reg = new DefRegistry();
          const ids: string[] = [];
          layers.forEach((layer, i) => {
            const id = `d:layer${i}`;
            ids.push(id);
            const extendsArr = i === 0 ? undefined : [ids[i - 1] as string];
            reg.register(baseDef(id, extendsArr, layer as Record<string, unknown>));
          });
          // 手动逐层合并
          let manual: Record<string, unknown> = {};
          for (const layer of layers) manual = { ...manual, ...layer };
          const lastId = ids[ids.length - 1] as string;
          expect(reg.resolve(lastId)?.props).toEqual(manual);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('Property: 对于任意构造出的环，register 应返回 ok:false（需求3.4）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 6 }), (n) => {
        const reg = new DefRegistry();
        const ids = Array.from({ length: n }, (_, i) => `d:cyc${i}`);
        // 先注册 0..n-2 各自 extends 下一个（不形成环）
        for (let i = 0; i < n - 1; i++) {
          reg.register(baseDef(ids[i] as string, [ids[i + 1] as string]));
        }
        // 最后一个 extends 回到第一个，形成环
        const r = reg.register(baseDef(ids[n - 1] as string, [ids[0] as string]));
        expect(r.ok).toBe(false);
      }),
      { numRuns: 50 },
    );
  });
});
