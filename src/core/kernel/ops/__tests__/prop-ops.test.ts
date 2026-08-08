import { describe, it, expect } from 'vitest';
import { OpRegistry } from '../registry.js';
import { WorldStateHolder } from '../transaction.js';
import { createEmptyWorldState } from '../../state/world-state.js';
import { registerPropOps } from '../prop-ops.js';
import { createEntityShape } from '../../state/entity.js';
import { DefRegistry } from '../../state/def.js';

function setup() {
  const defRegistry = new DefRegistry();
  defRegistry.register({ id: 'd:human', kind: 'entity', clamp: { hp: { min: 0, max: 100 } } });
  let state = createEmptyWorldState('sched:1');
  const e = { ...createEntityShape('e:1', 'd:human'), props: { hp: 50 } };
  state = { ...state, entities: { 'e:1': e } };
  const holder = new WorldStateHolder(state);
  const registry = new OpRegistry(holder);
  registerPropOps(registry, defRegistry);
  return { holder, registry };
}

describe('属性类 Op（需求16.5）', () => {
  it('prop.set 写入 props 自由区', () => {
    const { holder, registry } = setup();
    const result = registry.invoke('prop.set', { path: 'entities.e:1.props.hp', value: 30 });
    expect(result.ok).toBe(true);
    expect(holder.getState().entities['e:1']?.props.hp).toBe(30);
  });

  it('prop.set 拒绝写入结构区字段', () => {
    const { registry } = setup();
    const result = registry.invoke('prop.set', { path: 'entities.e:1.node', value: 'n:1' });
    expect(result.ok).toBe(false);
  });

  it('prop.set 拒绝 NaN/Infinity（需求1.4）', () => {
    const { registry } = setup();
    const result = registry.invoke('prop.set', { path: 'entities.e:1.props.hp', value: NaN });
    expect(result.ok).toBe(false);
  });

  it('prop.del 删除 props 字段', () => {
    const { holder, registry } = setup();
    registry.invoke('prop.del', { path: 'entities.e:1.props.hp' });
    expect(holder.getState().entities['e:1']?.props.hp).toBeUndefined();
  });

  it('prop.add 尊重 clamp 上下限', () => {
    const { holder, registry } = setup();
    const result = registry.invoke('prop.add', { path: 'entities.e:1.props.hp', delta: 1000 });
    expect(result.ok).toBe(true);
    expect(holder.getState().entities['e:1']?.props.hp).toBe(100); // clamp max
  });

  it('prop.add 下限 clamp', () => {
    const { holder, registry } = setup();
    registry.invoke('prop.add', { path: 'entities.e:1.props.hp', delta: -1000 });
    expect(holder.getState().entities['e:1']?.props.hp).toBe(0);
  });

  it('list.insert / list.remove', () => {
    const { holder, registry } = setup();
    registry.invoke('prop.set', { path: 'entities.e:1.props.list', value: [1, 2, 3] });
    registry.invoke('list.insert', { path: 'entities.e:1.props.list', value: 99, index: 1 });
    expect(holder.getState().entities['e:1']?.props.list).toEqual([1, 99, 2, 3]);
    registry.invoke('list.remove', { path: 'entities.e:1.props.list', index: 0 });
    expect(holder.getState().entities['e:1']?.props.list).toEqual([99, 2, 3]);
  });

  it('list.move 在同一自由区列表中重排且保持元素守恒', () => {
    const { holder, registry } = setup();
    registry.invoke('prop.set', { path: 'entities.e:1.props.queue', value: ['a', 'b', 'c'] });
    const result = registry.invoke('list.move', { path: 'entities.e:1.props.queue', from: 2, to: 0 });
    expect(result.ok).toBe(true);
    expect(holder.getState().entities['e:1']?.props.queue).toEqual(['c', 'a', 'b']);

    const invalid = registry.invoke('list.move', { path: 'entities.e:1.props.queue', from: 3, to: 0 });
    expect(invalid.ok).toBe(false);
    expect(holder.getState().entities['e:1']?.props.queue).toEqual(['c', 'a', 'b']);
  });

  it('tag.add / tag.del', () => {
    const { holder, registry } = setup();
    registry.invoke('tag.add', { ref: { collection: 'entities', id: 'e:1' }, tag: 'flammable' });
    expect(holder.getState().entities['e:1']?.tags).toContain('flammable');
    registry.invoke('tag.del', { ref: { collection: 'entities', id: 'e:1' }, tag: 'flammable' });
    expect(holder.getState().entities['e:1']?.tags).not.toContain('flammable');
  });
});
