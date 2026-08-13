/**
 * L2 验证：载具与乘员规则。
 * 对应要求 10（座位/货舱/门/邻接/锁定/驾驶/碰撞/损毁）。
 */

import type { CandidateDefinition } from '../model/definition.js';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes.js';
import { joinJsonPath, ROOT_JSON_PATH } from '../model/ids.js';
import type { DiagnosticCollector, DefinitionRule, ValidationContext } from './context.js';
import { defError } from './helpers.js';

export const validateVehicleRules: DefinitionRule = (
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void => {
  const def = definition as unknown as Record<string, unknown>;
  const defIndex = context.candidateDefinitions.indexOf(definition);

  // 要求 10.1：seatIds 必须为引用
  const seatIds = def.seatIds;
  if (Array.isArray(seatIds)) {
    for (let i = 0; i < seatIds.length; i++) {
      const seatId = seatIds[i];
      if (typeof seatId === 'string' && !seatId.startsWith('seat.')) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.VEHICLE_SEAT_REFERENCE_INVALID,
            reason: `座位引用 ${seatId} 不符合格式 \`seat.<name>\`（要求 10.1）。`,
            correctionSuggestion: '改为有效的座位引用格式。',
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'seatIds', i),
          }),
        );
      }
    }
  }

  // 要求 10.2：cargoContainerIds 必须为 `container.<name>` 格式
  const cargoContainerIds = def.cargoContainerIds;
  if (Array.isArray(cargoContainerIds)) {
    for (let i = 0; i < cargoContainerIds.length; i++) {
      const cargoCid = cargoContainerIds[i];
      if (typeof cargoCid === 'string' && !cargoCid.startsWith('container.')) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.VEHICLE_CARGO_REFERENCE_INVALID,
            reason: `货舱引用 ${cargoCid} 不符合格式 \`container.<name>\`（要求 10.2）。`,
            correctionSuggestion: '改为有效的货舱引用格式。',
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'cargoContainerIds', i),
          }),
        );
      }
    }
  }

  // 要求 10.3：检测直接写乘员/货舱状态的字段
  const directWriteFields = ['directOccupantStateWrite', 'directCargoStateWrite', 'occupantMutationBypass'];
  for (const field of directWriteFields) {
    if (field in def && def[field]) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.OP_BYPASS_FORBIDDEN,
          reason: `字段 ${field} 试图绕过 Op 通道直接改写乘员或货舱状态（要求 10.3 禁止）。`,
          correctionSuggestion: '移除该字段。使用标准 Op（`agent.bind` / `agent.unbind` / `item.move`）表达该行为。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, field),
        }),
      );
    }
  }

  // 要求 10.4：doorIds 必须为 `door.<name>` 格式
  const doorIds = def.doorIds;
  if (Array.isArray(doorIds)) {
    for (let i = 0; i < doorIds.length; i++) {
      const doorId = doorIds[i];
      if (typeof doorId === 'string' && !doorId.startsWith('door.')) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.VEHICLE_DOOR_REFERENCE_INVALID,
            reason: `车门引用 ${doorId} 不符合格式 \`door.<name>\`（要求 10.4）。`,
            correctionSuggestion: '改为有效的车门引用格式。',
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'doorIds', i),
          }),
        );
      }
    }
  }

  // 要求 10.5：adjacencyRuleIds 引用格式检查
  const adjacencyRuleIds = def.adjacencyRuleIds;
  if (Array.isArray(adjacencyRuleIds)) {
    for (let i = 0; i < adjacencyRuleIds.length; i++) {
      const ruleId = adjacencyRuleIds[i];
      if (typeof ruleId === 'string' && !ruleId.startsWith('adjacency-rule.')) {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.VEHICLE_ADJACENCY_REFERENCE_INVALID,
            reason: `邻接规则引用 ${ruleId} 不符合格式 \`adjacency-rule.<name>\`（要求 10.5）。`,
            correctionSuggestion: '改为有效的邻接规则引用格式。',
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'adjacencyRuleIds', i),
          }),
        );
      }
    }
  }

  // 要求 10.6：检测试图硬编码锁定逻辑的字段
  const lockingFields = [
    'concreteLockingRules',
    'vehicleLockingByStatusTag',
    'seatLockingByStatusTag',
    'doorLockingByStatusTag',
  ];
  for (const field of lockingFields) {
    if (field in def && def[field] !== undefined && def[field] !== null) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.VEHICLE_LOCKING_HARDCODED,
          reason: `字段 ${field} 试图硬编码锁定逻辑（要求 10.6 禁止）。锁定由状态标签与引擎层条件判定导出。`,
          correctionSuggestion: '移除该字段。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, field),
        }),
      );
    }
  }

  // 要求 10.7：driverAgentSlotRef 必须为座位引用
  const driverSlot = def.driverAgentSlotRef;
  if (typeof driverSlot === 'string' && !driverSlot.startsWith('seat.')) {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.VEHICLE_DRIVER_SLOT_INVALID,
        reason: `驾驶员座位引用 ${driverSlot} 必须是座位（格式 \`seat.<name>\`，要求 10.7）。`,
        correctionSuggestion: '改为有效的座位引用。',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'driverAgentSlotRef'),
      }),
    );
  }

  // 要求 10.8：检测试图硬编码碰撞与伤害逻辑的字段
  const collisionFields = ['concreteCollisionRules', 'collisionDamageTable', 'vehicleDamageByCollisionType'];
  for (const field of collisionFields) {
    if (field in def && def[field] !== undefined && def[field] !== null) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.VEHICLE_COLLISION_HARDCODED,
          reason: `字段 ${field} 试图硬编码碰撞伤害逻辑（要求 10.8 禁止）。碰撞伤害由玩法层决策。`,
          correctionSuggestion: '移除该字段。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, field),
        }),
      );
    }
  }

  // 要求 10.9：检测试图硬编码损毁状态转移的字段
  const destructionFields = [
    'concreteDestructionRules',
    'destructionStateTransitionByHealth',
    'destructionTriggerCondition',
  ];
  for (const field of destructionFields) {
    if (field in def && def[field] !== undefined && def[field] !== null) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.VEHICLE_DESTRUCTION_HARDCODED,
          reason: `字段 ${field} 试图硬编码损毁状态转移（要求 10.9 禁止）。损毁由玩法层决策。`,
          correctionSuggestion: '移除该字段。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, field),
        }),
      );
    }
  }

};