/**
 * L1 State: Tag 机制（design.md 3.1节 / 需求4.1-4.4）。
 * 内核不维护任何固定分类枚举；hasTag 是标签判定的唯一真相源纯函数，由 L2 ExprEngine 的
 * hasTag 内置算子（内联对象分支）直接复用，不各自重写一份判定逻辑。
 */

export interface Taggable {
  readonly tags: string[];
}

/** hasTag 表达式算子的纯函数实现（需求4.3），供 ExprEngine 的内置算子表调用。 */
export function hasTag(subject: Taggable | { tags?: string[] } | null | undefined, tag: string): boolean {
  if (!subject || !Array.isArray(subject.tags)) return false;
  return subject.tags.includes(tag);
}
