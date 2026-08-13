import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { actionView } from '../../__tests__/support/fixtures.js';
import { stripComments } from '../../__tests__/support/source-scan.js';
import type { UiActionView } from '../../model/view.js';
import { activeFaceActions, buildMenuFaces, toggleFace } from '../menu-faces.js';

const HERE = dirname(fileURLToPath(import.meta.url));

const PAID = actionView({ actionId: 'act.move', costCategory: 'paid' });
const PAID_TWO = actionView({ actionId: 'act.attack', costCategory: 'paid' });
const ZERO = actionView({ actionId: 'act.drop', costCategory: 'attached' });
const ZERO_TWO = actionView({ actionId: 'act.shout', costCategory: 'attached' });

function all(): readonly UiActionView[] {
  return [PAID, PAID_TWO, ZERO, ZERO_TWO];
}

describe('两个菜单面互斥且完整（tasks.md 任务 5.5、Property 14）', () => {
  it('交集为空、并集等于全部可用动作', () => {
    const faces = buildMenuFaces(all());
    const paidIds = faces.paid.map((action) => action.actionId);
    const zeroIds = faces.zeroCost.map((action) => action.actionId);
    expect(paidIds.filter((id) => zeroIds.includes(id))).toEqual([]);
    expect([...paidIds, ...zeroIds].sort()).toEqual(
      all()
        .map((action) => action.actionId)
        .sort(),
    );
  });

  it('分面只依据 costCategory，不引入第二套分类', () => {
    const faces = buildMenuFaces(all());
    expect(faces.paid.every((action) => action.costCategory === 'paid')).toBe(true);
    expect(faces.zeroCost.every((action) => action.costCategory === 'attached')).toBe(true);
  });

  it('不可用动作不进入任何面', () => {
    const faces = buildMenuFaces([
      ...all(),
      actionView({ actionId: 'act.unavailable', costCategory: 'paid', available: false }),
    ]);
    expect([...faces.paid, ...faces.zeroCost].map((action) => action.actionId)).not.toContain(
      'act.unavailable',
    );
  });

  it('分面内容按动作标识排序，因此确定性', () => {
    expect(buildMenuFaces(all())).toStrictEqual(buildMenuFaces([...all()].reverse()));
  });
});

describe('零费面不受回合末限制（Requirement 5.10、5.11）', () => {
  it('预算充足时零费动作也可执行', () => {
    const faces = buildMenuFaces(all());
    expect(faces.paidSurfaceEmpty).toBe(false);
    expect(faces.zeroCost.map((action) => action.actionId)).toEqual(['act.drop', 'act.shout']);
    expect(faces.zeroCostAlwaysAvailable).toBe(true);
  });

  it('预算耗尽只表现为付费面为空，零费面与结束回合按键保留', () => {
    const exhausted = buildMenuFaces([
      actionView({ actionId: 'act.move', costCategory: 'paid', available: false }),
      actionView({ actionId: 'act.attack', costCategory: 'paid', available: false }),
      ZERO,
      ZERO_TWO,
    ]);
    expect(exhausted.paid).toEqual([]);
    expect(exhausted.paidSurfaceEmpty).toBe(true);
    expect(exhausted.zeroCost).toHaveLength(2);
    expect(exhausted.endTurnAvailable).toBe(true);
  });

  it('不存在"预算耗尽才可用"的分支：源码里不读取任何预算', () => {
    const source = stripComments(readFileSync(resolve(HERE, '../menu-faces.ts'), 'utf8'));
    for (const pattern of [/\bbudget\b/iu, /\bremaining\b/iu, /\bapLeft\b/iu, /\bexhaust/iu]) {
      expect(pattern.test(source), pattern.source).toBe(false);
    }
  });

  it('切换分面是纯表现偏好，不产生任何交互意图', () => {
    expect(toggleFace('paid')).toBe('zero-cost');
    expect(toggleFace('zero-cost')).toBe('paid');
    const source = stripComments(readFileSync(resolve(HERE, '../menu-faces.ts'), 'utf8'));
    expect(/\bInteractionIntent\b/u.test(source)).toBe(false);
    expect(/\bsubmit\b/u.test(source)).toBe(false);
  });

  it('默认显示付费面，切换后呈现零费面', () => {
    const faces = buildMenuFaces(all());
    expect(faces.activeFace).toBe('paid');
    expect(activeFaceActions(faces).map((action) => action.actionId)).toEqual([
      'act.attack',
      'act.move',
    ]);
    const toggled = buildMenuFaces(all(), 'zero-cost');
    expect(activeFaceActions(toggled).map((action) => action.actionId)).toEqual([
      'act.drop',
      'act.shout',
    ]);
  });

  it('空动作集时两面都为空但结束回合仍保留', () => {
    const faces = buildMenuFaces([]);
    expect(faces.paid).toEqual([]);
    expect(faces.zeroCost).toEqual([]);
    expect(faces.endTurnAvailable).toBe(true);
  });
});
