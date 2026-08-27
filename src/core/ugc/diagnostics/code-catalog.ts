/**
 * 诊断代码目录（design.md「Diagnostics」/ 需求 14.1-14.2、14.13；tasks.md 1.3、2.3）。
 *
 * 三件事：
 * 1. 把 (类别, 条件) 解析到唯一已登记 `ErrCode`；未映射即失败关闭，绝不生成自由字符串代码。
 * 2. 由共享 `ERR_CODES` + `HINT_TEMPLATES` 判定 severity 与 hint；缺 hint 即视为契约不完整。
 * 3. 由**内容**派生 `version`，使任何错误码或 hint 变化都让旧 Validation Baseline 过期。
 */
import { ERR_CODES, isFatalCode, isInfrastructureFatalCode } from '../../kernel/state/error-codes';
import type { ErrCode } from '../../kernel/state/error-codes';
import type { Severity } from '../../kernel/state/diagnostic';
import { HINT_TEMPLATES } from '../../kernel/safety/safety';
import type { StableFingerprintGateway } from '../model/fingerprint';
import { compareCodePoints, encodeFingerprintPayload } from '../model/fingerprint';
import { CODE_MAP, UGC_DIAGNOSTIC_CATEGORIES } from './code-map';
import type { UGCDiagnosticCategory } from './code-map';

/**
 * 非 error severity 的显式例外集合。
 *
 * 需求 14.10/14.11 规定 warning 只能用于非语义建议或显式表现回退，因此这里是**封闭白名单**：
 * 不在表内的代码一律是 error（或按 fatal 规则升级），不存在"看起来不严重就降级"的通道。
 */
const NON_ERROR_SEVERITY: Readonly<Partial<Record<ErrCode, Severity>>> = {
  E_LOAD_PRESENTATION_FALLBACK: 'warn',
  E_LOAD_MIGRATED_SOURCE_REBASED: 'warn',
};

export interface DiagnosticCodeCatalog {
  readonly version: string;
  /** 解析代码。未映射的 (类别, 条件) 返回 `null`，调用方必须失败关闭而不是编造代码。 */
  resolve(category: UGCDiagnosticCategory, condition: string): ErrCode | null;
  severity(code: ErrCode): Severity;
  hint(code: ErrCode): string | null;
  /** 全部启用条件都能解析到有 hint 的封闭代码时为空数组（对应质量门禁 6）。 */
  incompleteEntries(): readonly string[];
}

function severityOf(code: ErrCode): Severity {
  if (isFatalCode(code) || isInfrastructureFatalCode(code)) return 'fatal';
  return NON_ERROR_SEVERITY[code] ?? 'error';
}

/**
 * 由内容派生目录版本。
 *
 * 设计判断（记录于实施基线 §1.3.5）：不使用手写版本常量。手写常量会在有人增删错误码或 hint 时忘记同步，
 * 使基线失效检测静默失灵。由内容派生可保证"错误码集合、hint 集合或 UGC 映射表任何变化都使旧基线过期"。
 */
function computeCatalogVersion(gateway: StableFingerprintGateway): string {
  const errCodeEntries = Object.entries(ERR_CODES)
    .map(([prefix, suffixes]) => `${prefix}=${[...suffixes].sort(compareCodePoints).join(',')}`)
    .sort(compareCodePoints);
  const hintKeys = Object.keys(HINT_TEMPLATES).sort(compareCodePoints);
  const mapEntries = UGC_DIAGNOSTIC_CATEGORIES.flatMap((category) =>
    Object.entries(CODE_MAP[category])
      .map(([condition, code]) => `${category}/${condition}=${String(code)}`)
      .sort(compareCodePoints),
  );
  const payload = encodeFingerprintPayload('ugc.diagnostic-catalog.v1', [
    { label: 'errCodes', value: errCodeEntries.join('|') },
    { label: 'hintKeys', value: hintKeys.join('|') },
    { label: 'ugcCodeMap', value: mapEntries.join('|') },
  ]);
  return `dcat-${gateway.fingerprintText(payload)}`;
}

export function createDiagnosticCodeCatalog(gateway: StableFingerprintGateway): DiagnosticCodeCatalog {
  const version = computeCatalogVersion(gateway);

  const resolve = (category: UGCDiagnosticCategory, condition: string): ErrCode | null => {
    const table = CODE_MAP[category] as Readonly<Record<string, ErrCode | undefined>>;
    return table[condition] ?? null;
  };

  const hint = (code: ErrCode): string | null => HINT_TEMPLATES[code] ?? null;

  const incompleteEntries = (): readonly string[] => {
    const problems: string[] = [];
    for (const category of UGC_DIAGNOSTIC_CATEGORIES) {
      for (const condition of Object.keys(CODE_MAP[category])) {
        const code = resolve(category, condition);
        if (code === null) {
          problems.push(`${category}/${condition}: unmapped`);
          continue;
        }
        if (hint(code) === null) {
          problems.push(`${category}/${condition}: ${code} has no hint`);
        }
      }
    }
    return Object.freeze(problems.sort(compareCodePoints));
  };

  return Object.freeze({ version, resolve, severity: severityOf, hint, incompleteEntries });
}
