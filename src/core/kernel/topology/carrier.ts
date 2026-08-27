/**
 * L1 Topology: 载器（Carrier）—— 容器家族中「承载活体」的特化形态
 *（design.md「载器承载面」节 / 需求 1.1-1.7, 2.1-2.6, 5.1-5.4）。
 *
 * 容器（Container）是引擎层唯一通用承载基元；载器是对「容器内部槽承载活体（与物品）
 * 且内部无场景」这一家族形态的明确命名与约束特化。载器不新增平行结构，不改
 * `Container`/`Slot` 形式——它复用既有 `Container`/`Slot`，用 `category:'carrier'`
 * 标记该承载面的「可承载活体」语义。
 *
 * 机制底座已在：`Slot.holds: Ref` 类型层本就支持指向 Item（`i:`）或 Entity（`e:`），
 * `checkSingleContainment`/`checkNoContainmentCycle`/`checkContainerBidirectional`
 * 均对实体/物品一体适用。本模块只补齐承载面的具名声明与判定。
 */
import type { Id } from '../state/ids';
import type { Expr } from '../state/expr-types';
import type { Container, Slot } from './types';
import { createContainerShape, createSlotShape } from './types';
import { nextId } from '../state/ids';
import { insertSlot } from './container';

/**
 * 容器承载活体的具名特化形态。结构上就是 `Container`，多一个 `category` 标记。
 * `slots` 复用 `Container.Slot`，`holds` 可指向 `e:` 或 `i:`（类型层原生支持）。
 */
export interface ContainerCarryingLiveSurface extends Container {
  readonly category: 'carrier';
  readonly capacity?: number;
  readonly acceptsForLiving?: Expr;
}

/**
 * 引擎层判定一个容器是否为「可承载活体的载器承载面」的唯一依据。
 * 读 `category === 'carrier'`；不解释玩法语义。
 */
export function isCarrierSurface(container: Container | undefined): boolean {
  if (!container) return false;
  return (container as ContainerCarryingLiveSurface).category === 'carrier';
}

/**
 * 创建一个载器承载面（复用 `createContainerShape`，附加 `category:'carrier'` 标记）。
 * caller 传入预分配的 `Id`（沿用 `c:` 前缀，因为载器承载面本质就是容器）。
 */
export function createCarrierSurface(
  id: Id,
  owner: Id,
  name: string,
  insert: 'fixed' | 'shift',
  opts?: { capacity?: number; acceptsForLiving?: Expr },
): ContainerCarryingLiveSurface {
  const base = createContainerShape(id, owner, name, insert);
  return {
    ...base,
    category: 'carrier',
    capacity: opts?.capacity,
    acceptsForLiving: opts?.acceptsForLiving,
  };
}

/**
 * 为载器承载面追加承载槽（复用 `createSlotShape` + `insertSlot`）。
 * 不引入平行槽结构——生成的 `Slot.holds` 为 `undefined`，待 `container.enter` 写入。
 */
export function addCarrierSlot(
  surface: ContainerCarryingLiveSurface,
  slot?: Slot,
): ContainerCarryingLiveSurface {
  const s = slot ?? createSlotShape(nextId('s'));
  const next = insertSlot(surface, s);
  return { ...next, category: 'carrier', capacity: surface.capacity, acceptsForLiving: surface.acceptsForLiving };
}
