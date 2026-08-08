/**
 * 两种容忍度边界的专项验收测试（design.md 3.1节 / 需求3.3-3.5, 39.11）。
 *
 * 用户原话："载入模组时，尽可能地模糊，并使其能够跑通...但是一旦兼容成功，在跑的过程中，
 * 底层引擎肯定是非常严厉的...想载入先完备，但是完备了之后，就不容忍任何模糊。"
 *
 * 本文件把这句话转成可验证的对照实验：同一组"模糊"输入（前向引用、abstract Def、尚未解析的
 * 继承链），在装载期（DefRegistry.register）必须被容忍并成功；一旦装载完成，任何试图
 * 实例化（而非仅仅声明）这些对象的运行期调用，必须被 checkInstantiable 零容忍地拒绝。
 * 这不是同一段代码的两次调用，是两个不同的容忍度阶段对同一批 Def 的不同处理——
 * 这正是"两种容忍度"边界本身，不是测试装载或测试运行期各自的正确性（那些已在别处覆盖）。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DefRegistry } from '../../state/def.js';
import { OpRegistry } from '../registry.js';
import { WorldStateHolder } from '../transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { resetIdCounters } from '../../state/ids.js';
import { registerStructuralOps, makeItemMove } from '../structural-ops.js';
import { ExprEngine, makeDefaultEvalContext } from '../../expr/engine.js';

describe('两种容忍度边界：装载期模糊兼容 vs 运行期零容忍', () => {
  beforeEach(() => resetIdCounters());

  it('装载期容忍前向引用：子 Def 先于父 Def 注册应成功（不因父尚未到达而拒绝）', () => {
    const registry = new DefRegistry();
    // 子先注册，父的 extends 目标此刻在 raw map 里还不存在
    const childResult = registry.register({ id: 'd:child', kind: 'entity', extends: ['d:parent'] });
    expect(childResult.ok).toBe(true); // 装载期：容忍

    const parentResult = registry.register({ id: 'd:parent', kind: 'entity', props: { baseHp: 10 } });
    expect(parentResult.ok).toBe(true);

    // 父到达后，子的继承展开应能追溯生效（惰性重新展开）
    const resolved = registry.resolve('d:child');
    expect(resolved?.props).toEqual({ baseHp: 10 });
  });

  it('装载期容忍 abstract Def 的注册本身：abstract:true 的 Def 可以被声明、被继承，只是不能被实例化', () => {
    const registry = new DefRegistry();
    const abstractResult = registry.register({ id: 'd:baseCreature', kind: 'entity', abstract: true, props: { canMove: true } });
    expect(abstractResult.ok).toBe(true); // 装载期：容忍 abstract Def 的存在

    // 具体子类继承自 abstract 父类，装载期同样容忍
    const concreteResult = registry.register({ id: 'd:goblin', kind: 'entity', extends: ['d:baseCreature'] });
    expect(concreteResult.ok).toBe(true);
    expect(registry.resolve('d:goblin')?.props).toEqual({ canMove: true });
  });

  it('装载期容忍"暂时无法验证"的引用完整性：Def 引用一个从未到达的父 Id，register 本身仍成功（引用存在性是 L13 Linter 的职责，不是 register 的职责——design.md 3.1节明确分工）', () => {
    const registry = new DefRegistry();
    const result = registry.register({ id: 'd:orphan', kind: 'entity', extends: ['d:neverArrives'] });
    expect(result.ok).toBe(true); // register 本身不因引用不存在而拒绝
    // 但 resolve 会诚实地反映"无法完全展开"（返回 null，不是静默返回不完整的结果）
    expect(registry.resolve('d:orphan')).toBeNull();
  });

  it('运行期零容忍：同一个 abstract Def，装载完全成功后，尝试实例化必须被拒绝——装载成功不代表运行期会通融', () => {
    const defRegistry = new DefRegistry();
    // 完整装载：父子链、abstract 标记都成功注册，装载期视角下这批 Def "完备"了
    expect(defRegistry.register({ id: 'd:baseCreature', kind: 'entity', abstract: true }).ok).toBe(true);
    expect(defRegistry.register({ id: 'd:goblin', kind: 'entity', extends: ['d:baseCreature'] }).ok).toBe(true);
    expect(defRegistry.resolve('d:goblin')).not.toBeNull(); // 装载期确认：具体子类完备可用

    // 运行期：试图直接实例化 abstract 父类——即便它在 DefRegistry 里"存在且合法注册"，
    // 也必须被 entity.create 拒绝，因为需求3.5 是运行期实例化边界，不是装载期存在性边界
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const opRegistry = new OpRegistry(holder);
    const exprEngine = new ExprEngine();
    const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
    registerStructuralOps(opRegistry, { itemMove, defLookup: (id) => defRegistry.resolve(id) });

    const before = holder.getState();
    const abstractResult = opRegistry.invoke('entity.create', { def: 'd:baseCreature' });
    expect(abstractResult.ok).toBe(false);
    expect((abstractResult as { code: string }).code).toBe('E_REF_ABSTRACT');
    expect(holder.getState()).toBe(before); // 零容忍：不产生任何状态改动

    // 而具体子类（同样装载完成）实例化必须成功——证明拒绝的原因精确是"abstract"，
    // 不是"这批 Def 整体有问题"
    const concreteResult = opRegistry.invoke('entity.create', { def: 'd:goblin' });
    expect(concreteResult.ok).toBe(true);
  });

  it('运行期零容忍：装载期"容忍"的前向引用悬空（父 Def 从未真正到达），运行期实例化子类时必须被拒绝，不能因为 register 曾经返回 ok:true 就被当作可用', () => {
    const defRegistry = new DefRegistry();
    // 装载期：容忍注册一个引用了永不会到达的父 Def 的子 Def
    expect(defRegistry.register({ id: 'd:orphan', kind: 'entity', extends: ['d:neverArrives'] }).ok).toBe(true);

    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const opRegistry = new OpRegistry(holder);
    const exprEngine = new ExprEngine();
    const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
    // defLookup 用 resolve()（已展开继承的最终形态），因为 d:orphan 的父链不完整，
    // resolve 应返回 null——checkInstantiable 据此判定"不存在"（对运行期而言，一个无法
    // 完整展开的 Def 等价于不可用，即便 raw 层面的 register 调用曾经"成功"过）。
    registerStructuralOps(opRegistry, { itemMove, defLookup: (id) => defRegistry.resolve(id) });

    const result = opRegistry.invoke('entity.create', { def: 'd:orphan' });
    expect(result.ok).toBe(false);
    expect((result as { code: string }).code).toBe('E_REF_MISSING');
  });

  it('运行期零容忍：kind 被 extends 链意外改写的边界情形——继承展开只应改写 props 等自由字段，不应改写 kind；即便如此，checkInstantiable 仍应以最终 kind 为准，不因继承来源而放宽', () => {
    const defRegistry = new DefRegistry();
    defRegistry.register({ id: 'd:itemBase', kind: 'item', props: { weight: 1 } });
    // 声明一个 entity kind 的 Def 继承自 item kind 的 Def（design.md 未禁止跨 kind 继承，
    // 但 DefRegistry.tryExpand 强制保留子 Def 自己的 kind，不被父 kind 覆盖——见 def.ts
    // tryExpand 内 `merged['kind'] = d.kind` 这一行）
    defRegistry.register({ id: 'd:hybrid', kind: 'entity', extends: ['d:itemBase'] });
    const resolved = defRegistry.resolve('d:hybrid');
    expect(resolved?.kind).toBe('entity'); // kind 未被父类污染

    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const opRegistry = new OpRegistry(holder);
    const exprEngine = new ExprEngine();
    const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
    registerStructuralOps(opRegistry, { itemMove, defLookup: (id) => defRegistry.resolve(id) });

    // 以 entity 身份实例化应成功（kind 正确）
    expect(opRegistry.invoke('entity.create', { def: 'd:hybrid' }).ok).toBe(true);
    // 以 item 身份实例化应被拒绝（尽管它继承自一个 item，最终 kind 仍是 entity）
    const wrongKindResult = opRegistry.invoke('item.create', { def: 'd:hybrid' });
    expect(wrongKindResult.ok).toBe(false);
    expect((wrongKindResult as { code: string }).code).toBe('E_REF_KIND');
  });

  it('对照组：同一份 Def 集合，用同一个 defLookup，装载期查询（resolve）与运行期查询（checkInstantiable）对"是否可用"给出不同答案是符合设计的，不是不一致', () => {
    const defRegistry = new DefRegistry();
    defRegistry.register({ id: 'd:base', kind: 'entity', abstract: true });

    // 装载期视角：这个 Def "存在且已正确展开"——resolve 返回非 null，这是"装载完备"的证据
    expect(defRegistry.resolve('d:base')).not.toBeNull();

    // 运行期视角：同一个 Def 通过 checkInstantiable 判定"不可实例化"——这不是矛盾，
    // 是"存在性"（装载期问题）与"可实例化性"（运行期问题）本就是两个不同的问题，
    // abstract Def 应该对第一个问题回答"是"、对第二个问题回答"否"。
    const holder = new WorldStateHolder(createEmptyWorldState('sched:1'));
    const opRegistry = new OpRegistry(holder);
    const exprEngine = new ExprEngine();
    const itemMove = makeItemMove({ exprEngine, evalCtxForSlotAccepts: () => makeDefaultEvalContext() });
    registerStructuralOps(opRegistry, { itemMove, defLookup: (id) => defRegistry.resolve(id) });
    const result = opRegistry.invoke('entity.create', { def: 'd:base' });
    expect(result.ok).toBe(false);
  });
});
