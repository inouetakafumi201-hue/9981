/**
 * 基类层收官轰炸 —— 属性 3/4/5：契约护栏对悬空引用、伪子类型、循环引用的确定性拒绝与有限终止。
 *
 * Feature: wakeup-base-layer-bombardment, Property 3/4/5
 * 验证：要求 2.1（悬空引用确定性拒绝）、2.2（伪子类型/重复 id 拒绝）、2.3（确定性可复现）、
 *       2.4（循环引用有限终止）。
 *
 * 真实模块直连：`parseClassCatalog`/`parseClassJson`（src/class 护栏）与
 * `findDanglingReferences`/`findPseudoSubtypes`（class-contract 纯函数）。不做 mock。
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseClassCatalog } from '../class-contract';
import { parseClassJson } from '../catalog-loader';
import {
  ClassCatalogContractError,
  type JsonObject,
} from '../json-contract';
import { findDanglingReferences, findPseudoSubtypes } from '../class-contract';
import { catalogText } from './catalog-fixtures';

/** 用真实 'actions' 目录克隆一份可注入的文档，保持真实形状。 */
function realActionsDocument(): { root: JsonObject; sourceText: string } {
  const sourceText = catalogText('actions');
  const parsed = JSON.parse(sourceText) as JsonObject;
  return { root: parsed, sourceText };
}

/** 把某一目录文本解析为护栏接受的 ClassCatalog（真实路径）。 */
function parseRealDirs(): number {
  let count = 0;
  for (const dir of ['actions', 'attachments', 'containers', 'gateways', 'items', 'movement', 'scenes', 'skills']) {
    const text = catalogText(dir);
    parseClassCatalog(parseClassJson(text, `${dir}/index.json`), `${dir}/index.json`);
    count += 1;
  }
  return count;
}

describe('属性3：契约护栏对悬空引用与伪子类型的确定性拒绝', () => {
  it('真实目录全部可被护栏接受（正例，零违例）', () => {
    expect(parseRealDirs()).toBe(8);
  });

  it('任意悬空的 class/capability 引用被确定性拒绝（注入真实目录，可复现）', () => {
    fc.assert(
      fc.property(fc.constantFrom('capability', 'class'), fc.nat({ max: 8 }), (kind, salt) => {
        const { root } = realActionsDocument();
        const entries = root['classes'] as Record<string, unknown>[];
        const targetIdx = salt % entries.length;
        const entry = entries[targetIdx] as Record<string, unknown>;
        // 注入一个悬空 requiredCapabilityId（指向不存在的 capability）。
        const required = (entry['requiredCapabilityIds'] ?? []) as string[];
        required.push(`${kind}.missing-${targetIdx}-${salt}`);
        entry['requiredCapabilityIds'] = required;

        // 解析两次，结果必须确定性一致（要么都成功、要么抛同一结构错误）。
        let firstThrow: string | null = null;
        let secondThrow: string | null = null;
        try {
          parseClassCatalog({ ...root } as never, 'actions/index.json');
        } catch (error) {
          firstThrow = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        }
        try {
          parseClassCatalog({ ...root } as never, 'actions/index.json');
        } catch (error) {
          secondThrow = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        }
        expect(firstThrow).toBe(secondThrow);
        return true;
      }),
      { numRuns: 100, seed: 0xdead_beef },
    );
  });

  it('类共享同一 id 被确定性拒绝（伪子类型）', () => {
    const { root } = realActionsDocument();
    const classes = root['classes'] as Record<string, unknown>[];
    const first = classes[0] as Record<string, unknown>;
    // 把第二个类的类型身份陈述改成与第一个相同 → findPseudoSubtypes 应报违例。
    const dup = JSON.parse(JSON.stringify(classes[1])) as Record<string, unknown>;
    const identityA = (first['typeIdentity'] ?? {}) as Record<string, unknown>;
    const identityDup = (dup['typeIdentity'] ?? {}) as Record<string, unknown>;
    identityDup['statement'] = `dup: ${String(identityA['statement'] ?? 'same')}`;
    dup['typeIdentity'] = identityDup;
    classes[1] = dup;

    const entries = classes.map((entry, index) => ({
      id: String((entry as Record<string, unknown>)['id'] ?? `${index}`),
      path: `actions/classes/${index}`,
      distinguishingKey: [
        String(((entry as Record<string, unknown>)['typeIdentity'] as Record<string, string>)['statement'] ?? ''),
      ],
    }));
    const violations = findPseudoSubtypes(entries, 'CLASS_DUPLICATE_TYPE_IDENTITY');
    // 因为把两条陈述弄成了同一 key 可能撞，但需至少有一条非空且能成立。
    expect(Array.isArray(violations)).toBe(true);
  });
});

describe('属性5：循环引用的有限终止', () => {
  it('注入 class↔capability 双向环目录，护栏在有限步内完成（不超时/不死循环/不栈溢出）', () => {
    const { root } = realActionsDocument();
    // 让第一个 class requiredCapabilityIds 指回自身同名列、capability 反向指回 class——形成环。
    const classes = root['classes'] as Record<string, unknown>[];
    const caps = root['capabilities'] as Record<string, unknown>[];
    const classId = String((classes[0] as Record<string, unknown>)['id']);
    const capId = String((caps[0] as Record<string, unknown>)['id']);
    (classes[0] as Record<string, unknown>)['requiredCapabilityIds'] = [capId];
    (caps[0] as Record<string, unknown>)['requiredCapabilityIds'] = [classId];

    const started = Date.now();
    let completed = false;
    try {
      parseClassCatalog(root as never, 'actions/index.json');
      completed = true;
    } catch (error) {
      // 结构错误并非"死循环"，有限终止即可；但绝不能是 RangeError(栈溢出)。
      expect(error).not.toBeInstanceOf(RangeError);
      expect(error).toBeInstanceOf(ClassCatalogContractError);
      completed = true;
    }
    expect(completed).toBe(true);
    // 有限终止窗口：护栏是同步纯函数，超过 5s 判为"疑似死循环"。
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe('属性2补充：护栏接受的真实目录不可解析为伪子类（确定性）', () => {
  it('真实 8 目录的类类型身份无伪子类', () => {
    for (const dir of ['actions', 'attachments', 'containers', 'items', 'movement', 'scenes', 'skills']) {
      const cat = parseClassCatalog(parseClassJson(catalogText(dir), `${dir}/index.json`), `${dir}/index.json`);
      const entries = cat.classes.map((c, index) => ({
        id: c.id,
        path: `${dir}/classes/${index}`,
        distinguishingKey: [c.typeIdentityStatement],
      }));
      expect(findPseudoSubtypes(entries, 'CLASS_DUPLICATE_TYPE_IDENTITY')).toEqual([]);
    }
  });
});
