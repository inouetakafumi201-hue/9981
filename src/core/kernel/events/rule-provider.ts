/**
 * L4 Events/Hooks: RuleProvider — 当前生效 RuleDef 集合的纯读查询器（design.md 3.5节 / 需求23.8-23.9）。
 *
 * 设计判断：需求23.9 要求同一个 RuleDef 结构在 PlaypackDef（全局常驻）、AttachmentDef.rules
 * （状态存续期间生效）、attach.add(world,mod)（运行期开关）三种挂载方式下具有不同生命周期，
 * 但"结构不分叉"——events/__tests__/rule-lifecycle.test.ts 已经验证 HookDispatcher 本身
 * 对三种来源一视同仁（只要 RuleDef 出现在传入的 candidates 数组里就同等参与调度）。
 *
 * RuleProvider 是这条纪律在"谁来收集 candidates"这一层的体现：它不关心某条 RuleDef 是从
 * PlaypackDef 常驻声明来的、还是某个 Attachment 存续期间贡献的、还是运行期 attach.add 临时
 * 打开的——它只维护"当前时刻生效的 RuleDef 全集"这一份数据（由调用方通过 add/remove 维护，
 * 三种挂载来源各自决定何时调用 add/remove，RuleProvider 本身不区分来源），并按事件类型
 * （RuleDef.on 是否包含该类型）现查出匹配的候选集合。
 */
import type { OpContext } from '../ops/registry';
import type { RuleDef } from './types';
import type { HookCandidate } from './dispatcher';

export type DynamicRuleResolver = (ctx: OpContext) => readonly RuleDef[];

export class RuleProvider {
  private readonly rules = new Map<string, RuleDef>();
  private dynamicResolver?: DynamicRuleResolver;

  /** 挂载一条规则（三种挂载来源都通过这一个方法添加，来源差异体现在调用时机，不体现在此方法本身）。 */
  add(rule: RuleDef): void {
    this.rules.set(rule.id, rule);
  }

  /** 卸载一条规则（Attachment 失效、attach.del、运行期关闭 mod 等场景调用）。 */
  remove(ruleId: string): void {
    this.rules.delete(ruleId);
  }

  has(ruleId: string): boolean {
    return this.rules.has(ruleId);
  }

  get(ruleId: string): RuleDef | undefined {
    return this.rules.get(ruleId);
  }

  setDynamicResolver(resolver: DynamicRuleResolver | undefined): void {
    this.dynamicResolver = resolver;
  }

  /** 按事件类型现查当前生效的候选集合（需求23.9：不维护派生索引，每次现查，与微型场景占用者判断同一手法）。 */
  candidatesFor(eventType: string, ctx?: OpContext): HookCandidate[] {
    const merged = new Map(this.rules);
    if (ctx && this.dynamicResolver) {
      for (const rule of this.dynamicResolver(ctx)) merged.set(rule.id, rule);
    }
    const result: HookCandidate[] = [];
    for (const rule of merged.values()) {
      const onList = Array.isArray(rule.on) ? rule.on : [rule.on];
      if (onList.includes(eventType)) {
        result.push({ rule });
      }
    }
    return result;
  }

  allRuleIds(): string[] {
    return [...this.rules.keys()];
  }
}
