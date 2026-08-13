// Feature: wakeup-ui-animation, Reverse Test 10.1: 直接改写语义状态的尝试被拒绝
// 对已验证投影与描述符的任意深度字段执行写入尝试，断言返回结构化拒绝且上游语义状态指纹不变

import { describe, it, expect } from 'vitest';

describe('Reverse Test 10.1: 直接改写语义状态的尝试被拒绝', () => {
  it('尝试修改深冻结投影的顶层字段时被拒绝', () => {
    const projection = Object.freeze({
      entities: Object.freeze([]),
      revision: Object.freeze({ sequence: 1, fingerprint: 'abc' }),
    });

    const originalFingerprint = projection.revision.fingerprint;

    // 尝试写入应该失败（严格模式下抛出错误）
    expect(() => {
      // @ts-expect-error - 故意尝试写入只读对象
      projection.revision = { sequence: 2, fingerprint: 'xyz' };
    }).toThrow();

    // 指纹未改变
    expect(projection.revision.fingerprint).toBe(originalFingerprint);
  });

  it('尝试修改深冻结投影的嵌套字段时被拒绝', () => {
    const projection = Object.freeze({
      entities: Object.freeze([
        Object.freeze({ id: 'e:1', props: Object.freeze({ hp: 10 }) }),
      ]),
      revision: Object.freeze({ sequence: 1, fingerprint: 'abc' }),
    });

    const originalFingerprint = projection.revision.fingerprint;
    const originalHp = projection.entities[0]!.props.hp;

    // 尝试修改嵌套属性应该失败
    expect(() => {
      // @ts-expect-error - 故意尝试写入只读对象
      projection.entities[0]!.props.hp = 999;
    }).toThrow();

    // 原始值未改变
    expect(projection.entities[0]!.props.hp).toBe(originalHp);
    expect(projection.revision.fingerprint).toBe(originalFingerprint);
  });

  it('尝试向深冻结数组添加元素时被拒绝', () => {
    const projection = Object.freeze({
      entities: Object.freeze([
        Object.freeze({ id: 'e:1', props: Object.freeze({}) }),
      ]),
      revision: Object.freeze({ sequence: 1, fingerprint: 'abc' }),
    });

    const originalLength = projection.entities.length;
    const originalFingerprint = projection.revision.fingerprint;

    // 尝试添加元素应该失败
    expect(() => {
      // @ts-expect-error - 故意尝试修改只读数组
      projection.entities.push(Object.freeze({ id: 'e:2', props: Object.freeze({}) }));
    }).toThrow();

    // 数组长度未改变
    expect(projection.entities.length).toBe(originalLength);
    expect(projection.revision.fingerprint).toBe(originalFingerprint);
  });

  it('尝试删除深冻结结构的属性时被拒绝', () => {
    const projection = Object.freeze({
      entities: Object.freeze([]),
      revision: Object.freeze({ sequence: 1, fingerprint: 'abc' }),
      metadata: Object.freeze({ source: 'test' }),
    });

    const originalFingerprint = projection.revision.fingerprint;

    // 尝试删除属性应该失败
    expect(() => {
      // @ts-expect-error - 故意尝试删除只读对象的属性
      delete projection.metadata;
    }).toThrow();

    // 属性仍然存在
    expect(projection).toHaveProperty('metadata');
    expect(projection.revision.fingerprint).toBe(originalFingerprint);
  });

  it('尝试通过 Object.defineProperty 修改深冻结结构时被拒绝', () => {
    const projection = Object.freeze({
      entities: Object.freeze([]),
      revision: Object.freeze({ sequence: 1, fingerprint: 'abc' }),
    });

    const originalFingerprint = projection.revision.fingerprint;

    // 尝试重新定义属性应该失败
    expect(() => {
      Object.defineProperty(projection, 'revision', {
        value: { sequence: 999, fingerprint: 'hacked' },
      });
    }).toThrow();

    // 指纹未改变
    expect(projection.revision.fingerprint).toBe(originalFingerprint);
  });

  it('尝试通过 Object.setPrototypeOf 修改深冻结结构时被拒绝', () => {
    const projection = Object.freeze({
      entities: Object.freeze([]),
      revision: Object.freeze({ sequence: 1, fingerprint: 'abc' }),
    });

    const maliciousProto = {
      get revision() {
        return { sequence: 999, fingerprint: 'hacked' };
      },
    };

    // 尝试修改原型应该失败
    expect(() => {
      Object.setPrototypeOf(projection, maliciousProto);
    }).toThrow();

    // 原型未改变，值保持原样
    expect(projection.revision.fingerprint).toBe('abc');
  });
});
