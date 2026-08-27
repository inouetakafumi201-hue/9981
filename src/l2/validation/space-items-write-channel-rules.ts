/**
 * L2 验证：空间与物品写入通道校验规则。
 *
 * 对应 requirements.md 要求 3.3、3.4、7.3、10.3：
 * - 3.3：拒绝直接写世界状态、容器数组、关系索引或绕过事务的定义
 * - 3.4：拒绝新增拾取/丢弃/装备/卸下等独立写入原语；物品转移必须恰为 `item.move`
 * - 7.3：容器与槽位结构由引擎层拥有，只可引用不可重写
 * - 10.3：座位/货舱/门必须使用引擎层容器、槽位、引用与动作契约；不得自建车内存储
 */

import type { CandidateDefinition } from '../model/definition';
import { DIAGNOSTIC_CODES } from '../model/diagnostic-codes';
import { joinJsonPath, ROOT_JSON_PATH } from '../model/ids';
import type { DiagnosticCollector, DefinitionRule, ValidationContext } from './context';
import { defError } from './helpers';

export const validateWriteChannel: DefinitionRule = (
  definition: CandidateDefinition,
  context: ValidationContext,
  collector: DiagnosticCollector,
): void => {
  const def = definition as unknown as Record<string, unknown>;
  const defIndex = context.candidateDefinitions.indexOf(definition);

  // 检测禁用字段（要求 10.3）
  const directWriteFields = ['directOccupantStateWrite', 'directCargoStateWrite'];
  for (const fieldName of directWriteFields) {
    if (fieldName in def && def[fieldName]) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.OP_BYPASS_FORBIDDEN,
          reason: `字段 ${fieldName} 试图绕过 Op 通道直接改写乘员或货舱状态（要求 10.3）。`,
          correctionSuggestion:
            '通过 `agent.bind` / `agent.unbind`（乘员）或 `item.move`（货舱）等标准 Op 表达该行为。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, fieldName),
        }),
      );
    }
  }

  // 检测试图重写容器结构的迹象（要求 7.3）
  const containerStructureFields = [
    'containerStructureOverride',
    'slotOrderOverride',
    'insertionStrategyOverride',
    'defaultSlotSelection',
    'capacityCheckOverride',
    'movementFailureSemanticsOverride',
  ];
  for (const fieldName of containerStructureFields) {
    if (fieldName in def && def[fieldName] !== undefined) {
      collector.add(
        defError(context, definition, {
          code: DIAGNOSTIC_CODES.OP_BYPASS_FORBIDDEN,
          reason: `字段 ${fieldName} 试图重写容器与槽位结构（要求 7.3）。容器结构由引擎层拥有，基类层只可引用。`,
          correctionSuggestion: '移除该字段。容器配置应仅包含能力引用与参数名，不包含结构重写。',
          jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, fieldName),
        }),
      );
    }
  }

  // 检测物品转移 Op 的合法性（要求 3.4）
  const transferOpId = def.itemTransferOpId;
  if (typeof transferOpId === 'string' && transferOpId !== 'item.move') {
    collector.add(
      defError(context, definition, {
        code: DIAGNOSTIC_CODES.OP_BYPASS_FORBIDDEN,
        reason: `物品转移操作声明为 ${transferOpId}，但要求 3.4 要求必须恰为 \`item.move\`。`,
        correctionSuggestion: '改为 `item.move`，或通过其他 Op 映射在动作中表达该行为。',
        jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'itemTransferOpId'),
      }),
    );
  }

  // 检测声明了多个独立转移 Op（要求 3.4）
  const transferOps = def.independentTransferOps;
  if (Array.isArray(transferOps) && transferOps.length > 0) {
    for (const op of transferOps) {
      if (typeof op === 'string') {
        collector.add(
          defError(context, definition, {
            code: DIAGNOSTIC_CODES.OP_BYPASS_FORBIDDEN,
            reason: `声明了独立转移 Op：${op}（要求 3.4 禁止）。所有物品转移必须经唯一 Op \`item.move\`。`,
            correctionSuggestion: '移除独立转移 Op 声明。',
            jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'independentTransferOps'),
          }),
        );
      }
    }
  }

  // 校验引用的 Op 名是否在引擎层已注册（任务 4.2 DoD）
  // 注意：这个检查需要 KernelContract 的 hasOp 方法，但当前 ValidationContext 不包含 kernel 引用
  // 因此这个检查应该在集成测试中通过 registry 的 listOpNames() 机械比对完成
  // 这里只做基本的命名规范检查
  const opReferences = def.operationChannels ?? def.kernelOps;
  if (Array.isArray(opReferences)) {
    for (const opName of opReferences) {
      if (typeof opName === 'string') {
        // 基本命名规范检查：Op 名应该是 "namespace.operation" 格式
        if (!opName.includes('.') || opName.startsWith('.') || opName.endsWith('.')) {
          collector.add(
            defError(context, definition, {
              code: DIAGNOSTIC_CODES.OP_BYPASS_FORBIDDEN,
              reason: `Op 名 ${opName} 不符合命名规范（应为 "namespace.operation"）。`,
              correctionSuggestion: '使用合法的 Op 名格式，如 "item.move"、"prop.add" 等。',
              jsonPath: joinJsonPath(ROOT_JSON_PATH, 'definitions', defIndex, 'operationChannels'),
            }),
          );
        }
      }
    }
  }
};
