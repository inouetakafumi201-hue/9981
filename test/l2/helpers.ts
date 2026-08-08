/**
 * L2 测试辅助：构造验证上下文、运行验证与激活的便捷封装。
 * 只经统一入口调用 L2 模块，不绕过任何边界。
 */

import type { DefinitionPackage } from '../../src/l2/model/definition.js';
import type { ValidationResult } from '../../src/l2/model/diagnostic.js';
import { buildValidationContext, validatePackage } from '../../src/l2/validation/validator.js';
import { validateFullPackage } from '../../src/l2/validation/package-validation.js';
import {
  activate,
  emptyRegistry,
  type ActiveRegistry,
} from '../../src/l2/registry/definition-registry.js';
import type { Result } from '../../src/l2/model/result.js';
import type { ActivationSuccess } from '../../src/l2/registry/definition-registry.js';

/** 只跑结构验证（不含引用图/解析）。 */
export function validateStructure(pkg: DefinitionPackage): ValidationResult {
  const context = buildValidationContext({ package: pkg });
  return validatePackage(context);
}

/** 全量验证（结构 + 引用图 + 解析 + 依赖重验证），空活动集。 */
export function validateFresh(pkg: DefinitionPackage) {
  return validateFullPackage({
    package: pkg,
    activeNodes: new Map(),
    activeInbound: new Map(),
  });
}

/** 在空注册表上激活一个包。 */
export function activateFresh(pkg: DefinitionPackage): Result<ActivationSuccess> {
  return activate(emptyRegistry(), pkg);
}

/** 判断诊断集合中是否含指定代码。 */
export function hasCode(diagnostics: readonly { readonly code: string }[], code: string): boolean {
  return diagnostics.some((diagnostic) => diagnostic.code === code);
}

/** 空活动注册表。 */
export function freshRegistry(): ActiveRegistry {
  return emptyRegistry();
}
