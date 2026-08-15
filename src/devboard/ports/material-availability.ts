/**
 * 素材可用性钩子（Design Components 3，要求 4）。
 *
 * 开发板判定「某素材是否可在当前编辑器使用」的统一端口；**当前实现为全放行**（开发者权限、
 * 所有已加载内容可见）。真实可用性判定属「素材库元状态」层（`docs/运营系统/04` §3.6），
 * devboard 不实现判定逻辑，只消费此布尔决策。保留接口给 demo：后续玩家模式传入受限素材集
 * （MVP 玩家素材有限，仅不能进自家地图/带图匹配，不禁止其编辑地图）。
 */
export interface MaterialAvailabilityHook {
  /** 某素材当前是否可用。 */
  isAvailable(materialId: string): boolean;
  /** 返回可见的「已注册素材 id 集合」；开发板用它驱动右侧快捷栏与全量矩阵。 */
  registeredMaterials(): readonly string[];
}

/** 开发板（开发者权限）的默认实现：全放行、全部已加载内容可见。 */
export const developerGate: MaterialAvailabilityHook = {
  isAvailable: () => true,
  registeredMaterials: () => [],
};

/** 便捷工厂：返回一个「全放行」的钩子（供 devboard 组装注入）。 */
export function createDeveloperHook(registered: readonly string[] = []): MaterialAvailabilityHook {
  return {
    isAvailable: () => true,
    registeredMaterials: () => registered,
  };
}
