import type { Ref } from '../../core/kernel/state/ids.js';

/**
 * 载具运行时状态的只读视图。所有变更必须由动作提交器解析后经 OpRegistry.invoke 完成。
 */
export interface VehicleRuntimeState {
  readonly profileId: string;
  readonly instanceId: Ref;
  /** 运行时资源可达到耗尽值。 */
  readonly hp: number;
  readonly speedModifier: number;
  readonly tireStatus: 'normal' | 'flat';
  readonly locked: boolean;
  readonly node: Ref;
  readonly seats: ReadonlyMap<number, Ref | null>;
  readonly cargo: readonly Ref[];
  readonly damageState: string;
}
