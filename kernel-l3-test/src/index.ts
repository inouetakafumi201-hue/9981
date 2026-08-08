export { World } from './world.js';
export type {
  Attachment,
  Container,
  Decision,
  Entity,
  Id,
  Item,
  ItemDef,
  Link,
  Node,
  Ref,
  RelationSlice,
  Result,
  Slot,
  WorldSnapshot,
} from './world.js';
export { Transaction } from './transaction.js';
export type { Violation } from './transaction.js';
export { OpRegistry, OpTransaction } from './registry.js';
export type { OpArgsMap, OpName, OpResultMap } from './registry.js';
export { stackSplit, stackMerge, stackAdjust } from './ops/stack.js';
export { entityPlace } from './ops/entity.js';
export { freeze, resolve, voidFreeze } from './ops/cost.js';
export {
  ALL_INVARIANT_CHECKS,
  InvariantChecker,
  checkAllInvariants,
  checkINV_1_ReferenceIntegrity,
  checkINV_2_SingleContainment,
  checkINV_3_SingleLocation,
  checkINV_4_LocationMutex,
  checkINV_5_NoContainmentCycle,
  checkINV_6_TopologyConsistency,
  checkINV_7_ParentChild,
  checkINV_8_RelationSymmetry,
  checkINV_9_ContainerBidirectional,
  checkINV_10_SlotIndexContinuity,
  checkINV_11_StackConservation,
  checkINV_12_CostConservation,
  checkINV_13_AttachmentConsistency,
  checkINV_14_StackBounded,
  checkINV_15_DecisionTermination,
  checkINV_16_NumericBounded,
} from './invariants.js';
export type { CheckFn, InvariantContext } from './invariants.js';
