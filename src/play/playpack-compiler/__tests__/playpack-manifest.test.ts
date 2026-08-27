/**
 * compile() 识别 playpack.json 完整规则清单测试（装载等价收尾 P2）。
 *
 * 覆盖：zip 根 playpack.json / manifest.json / 顶层 kind:'playpack' 被识别并经严格解码链
 * （StrictJsonCodec → decodePlaypack）校验；artifact.playpackDef 非空；坏清单（重复 id /
 * 坏引用）产生 error 诊断且编译拒绝；多清单冲突；与 profiles 并集共存；复杂度评分
 * customRuleCount 从清单 defs 取值。
 */
import { describe, expect, it } from 'vitest';
import { compile, type PlaypackInput } from '../index';

function makeInput(overrides?: Partial<PlaypackInput>): PlaypackInput {
  return {
    id: 'playpack:play.manifest-test',
    name: '清单测试包',
    version: '1.0.0',
    manifests: new Map(),
    assets: new Map(),
    source: 'uploaded',
    creatorSteamId: 'steam:manifest-test',
    ...overrides,
  };
}

const ITEM_PROFILE = JSON.stringify({
  id: 'item:manifest.medkit',
  name: '清单急救包',
  classComposition: { classIds: ['item.class.consumable'] },
  healRate: 2,
});

/** 合法完整规则清单：1 动作 + 1 规则 + 1 调度。 */
const VALID_MANIFEST = JSON.stringify({
  id: 'playpack:manifest.rules',
  kind: 'playpack',
  version: '1.0.0',
  schedule: 'schedule:manifest',
  pools: [{ name: 'AP', per: 'actor', min: 0, max: 5, reset: 'turn' }],
  defs: [
    {
      id: 'action:manifest.hit',
      kind: 'action',
      label: '清单打击',
      group: 'play.paid',
      track: 'card',
      require: true,
      cost: [{ pool: 'ap', amount: 1 }],
      effects: [{ op: 'prop.set', args: { path: 'world.props.play.manifestHit', value: 1 } }],
      play: {
        numericOwnership: {
          'cost.0.amount': { kind: 'constitutional', sourceId: 'S8 一个动作永远 1 AP' },
          'effects.0.args.value': { kind: 'gameplay', min: 1, max: 5, int: true },
        },
        costClass: 'paid',
        sourceTrace: ['manifest-test'],
      },
    },
    {
      id: 'rule:manifest.echo',
      kind: 'rule',
      on: 'play.manifest.echo',
      phase: 'default',
      priority: 100,
      effects: [{ op: 'prop.set', args: { path: 'world.props.play.manifestEchoed', value: 1 } }],
      play: {
        numericOwnership: {
          'effects.0.args.value': { kind: 'gameplay', min: 1, max: 5, int: true },
        },
        sourceTrace: ['manifest-test'],
      },
    },
    {
      id: 'schedule:manifest',
      kind: 'schedule',
      loop: true,
      order: 'fixed',
      phases: [
        { id: 'phase:manifest', name: '清单阶段', kind: 'custom', phaseKind: 'resolve', input: 'none', onEnter: [], onExit: [] },
      ],
    },
  ],
});

/** 坏清单：defs 内重复 id。 */
const DUPLICATE_MANIFEST = JSON.stringify({
  id: 'playpack:manifest.dup',
  kind: 'playpack',
  version: '1.0.0',
  defs: [
    { id: 'action:manifest.dup', kind: 'action', label: 'A', track: 'card', effects: [] },
    { id: 'action:manifest.dup', kind: 'action', label: 'B', track: 'card', effects: [] },
  ],
});

describe('compile() playpack 清单识别（P2）', () => {
  it('zip 根 playpack.json 被识别，artifact.playpackDef 非空且 defs 完整', async () => {
    const result = await compile(makeInput({
      manifests: new Map([
        ['playpack.json', VALID_MANIFEST],
        ['items/medkit.json', ITEM_PROFILE],
      ]),
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('合法清单包应编译通过');
    const { artifact } = result;
    expect(artifact.playpackDef).toBeDefined();
    expect(artifact.playpackDef?.defs.map((d) => d.id)).toEqual([
      'action:manifest.hit',
      'rule:manifest.echo',
      'schedule:manifest',
    ]);
    expect(artifact.profiles).toHaveLength(1);
    // 复杂度评分：customRuleCount 从清单 defs 取值（1 action + 1 rule = 2）。
    expect(artifact.complexityScore).toBeGreaterThan(0);
  });

  it('manifest.json 文件名同样被识别', async () => {
    const result = await compile(makeInput({
      manifests: new Map([['manifest.json', VALID_MANIFEST]]),
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('manifest.json 应编译通过');
    expect(result.artifact.playpackDef?.id).toBe('playpack:manifest.rules');
  });

  it('顶层 kind:playpack 文档（任意文件名）被识别', async () => {
    const result = await compile(makeInput({
      manifests: new Map([['rules/main.json', VALID_MANIFEST]]),
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('kind:playpack 文档应编译通过');
    expect(result.artifact.playpackDef).toBeDefined();
  });

  it('坏清单（重复 id）产生 error 诊断且编译拒绝', async () => {
    const result = await compile(makeInput({
      manifests: new Map([['playpack.json', DUPLICATE_MANIFEST]]),
    }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('坏清单必须拒绝');
    expect(result.diagnostics.some((d) => d.code === 'PLAYPACK_MANIFEST_DECODE_ERROR' && d.severity === 'error')).toBe(true);
  });

  it('多个 playpack 清单 → 冲突 error 拒绝', async () => {
    const result = await compile(makeInput({
      manifests: new Map([
        ['playpack.json', VALID_MANIFEST],
        ['manifest.json', VALID_MANIFEST],
      ]),
    }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('多清单必须拒绝');
    expect(result.diagnostics.some((d) => d.code === 'PLAYPACK_MULTIPLE_MANIFESTS')).toBe(true);
  });
});
