import { cloneState, isWellFormedVersion } from './persistence.js';
import type { WorldState } from './persistence.js';

export { isWellFormedVersion };

export interface MigrationEffect {
  apply: (s: WorldState) => WorldState;
}

export interface MigrationDef {
  id: string;
  from: string;
  to: string;
  effects: MigrationEffect[];
  onFail: 'reject' | 'bestEffort';
}

export interface Diagnostic {
  code: string;
  detail: string;
}

export interface LoadResult {
  ok: boolean;
  state?: WorldState;
  diagnostics: Diagnostic[];
}

/**
 * 装载期诊断码。
 *
 * 每种失败模式必须有独立的码：若多种失败共用一个码，
 * 测试只能断言"失败了"而无法断言"为何失败"，
 * 删掉任一前置守卫都无法被区分（L7 层的 E_REF_INVALID 教训）。
 */
export const MIG_CODES = {
  /** 存档版本高于当前版本，一律拒绝 */
  NEWER_SAVE: 'E_MIG_NEWER_SAVE',
  /** 存档较旧但找不到迁移链 */
  NO_PATH: 'E_MIG_NO_PATH',
  /** reject 模式下 effect 抛错，整体回滚 */
  FAILED: 'E_MIG_FAILED',
  /** bestEffort 模式下某跳被跳过：非致命，但必须报告 */
  SKIPPED: 'W_MIG_SKIPPED',
  /** 迁移链跑完但最终版本仍不等于当前版本 */
  INCOMPLETE: 'E_MIG_INCOMPLETE',
  /** 版本号不是 major.minor.patch 形式的十进制数字，无法可靠比较 */
  BAD_VERSION: 'E_MIG_BAD_VERSION',
} as const;

/**
 * 版本号合法性校验：必须是三段十进制非负整数。
 *
 * 为什么不让 compareVersions 直接抛错：它是比较器，
 * 必须对任意输入给出全序（自反、反对称），抛错会破坏这个契约。
 * 校验因此独立成函数，由 loadSnapshot 在比较之前调用。
 *
 * 为什么必须校验：存档是可能损坏的外部输入。
 * `parseInt('abc') || 0` 会把畸形版本静默当作 0.0.0，
 * 于是"损坏的存档"被判定为"很旧的存档"并尝试迁移——
 * 这与 D8（未达目标版本却报 ok）是同一类错误：用沉默换取虚假的成功。
 */
// isWellFormedVersion 现由 persistence 层提供并在本文件顶部转出：
// 状态自检（checkWorldState）与装载校验（loadSnapshot）必须共用同一判据，
// 两份正则会静默漂移出互相矛盾的结论。

/**
 * compareVersions: semver-lite (major.minor.patch) 比较。
 * <0: a<b, 0: a==b, >0: a>b
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * 装载期版本比对与迁移。需求38.2-38.6四分支：
 * - 存档版本 == 当前版本：直接恢复
 * - 存档版本 < 当前版本 且存在适用迁移链：事务式执行effects，失败整体回滚
 * - 存档版本 < 当前版本 且无适用迁移链：按onFail处理，默认拒绝
 * - 存档版本 > 当前版本：一律拒绝
 */
export function loadSnapshot(
  savedState: WorldState,
  currentVersion: string,
  migrations: readonly MigrationDef[],
): LoadResult {
  // 畸形版本号必须在比较之前拒绝。compareVersions 把无法解析的段折成 0，
  // 于是 "abc" 与 "0.0.0" 相等——存档里的乱码会被当成"最古老的合法版本"
  // 而进入迁移分支，最坏情况下静默装载一份根本没读懂的存档。
  for (const [label, version] of [
    ['saved', savedState.version],
    ['current', currentVersion],
  ] as const) {
    if (!isWellFormedVersion(version)) {
      return {
        ok: false,
        diagnostics: [{
          code: MIG_CODES.BAD_VERSION,
          detail: `${label} version ${JSON.stringify(version)} is not major.minor.patch`,
        }],
      };
    }
  }

  const cmp = compareVersions(savedState.version, currentVersion);

  if (cmp === 0) {
    // 克隆：装载结果不得与调用方持有的存档共享引用，
    // 否则调用方对返回状态的原地修改会回写进"存档"。
    return { ok: true, state: cloneState(savedState), diagnostics: [] };
  }

  if (cmp > 0) {
    return {
      ok: false,
      diagnostics: [{
        code: MIG_CODES.NEWER_SAVE,
        detail: `saved=${savedState.version} current=${currentVersion}`,
      }],
    };
  }

  // cmp < 0: 存档较旧，寻找from==savedState.version的迁移链（单跳，链式由多个MigrationDef拼接）
  const chain = findMigrationChain(savedState.version, currentVersion, migrations);
  if (!chain) {
    return {
      ok: false,
      diagnostics: [{
        code: MIG_CODES.NO_PATH,
        detail: `no migration chain from ${savedState.version} to ${currentVersion}`,
      }],
    };
  }

  // 事务式执行：任一 migration 的 effects 失败，按 onFail 决定回滚或跳过。
  const diagnostics: Diagnostic[] = [];
  let state = savedState;
  for (const migration of chain) {
    try {
      let next = state;
      for (const effect of migration.effects) {
        next = effect.apply(next);
      }
      state = { ...next, version: migration.to };
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      if (migration.onFail === 'bestEffort') {
        // bestEffort：跳过该 migration，保留执行前状态，继续下一个。
        // 必须留下诊断——跳过意味着该跳的数据变换从未执行，
        // 而后续 migration 仍会把 version 推进到自己的 to，
        // 于是状态会被标记为新版本却缺少这一跳的变换。
        // 静默返回 ok:true 等于让调用方在毫不知情的情况下装载了残缺存档。
        diagnostics.push({
          code: MIG_CODES.SKIPPED,
          detail: `migration ${migration.id} (${migration.from}->${migration.to}) skipped: ${reason}`,
        });
        continue;
      }
      // reject（默认）：整体回滚到原始savedState
      return {
        ok: false,
        diagnostics: [...diagnostics, { code: MIG_CODES.FAILED, detail: reason }],
      };
    }
  }

  // 链跑完仍未到达目标版本（例如最后一跳被 bestEffort 跳过）时，
  // 不能报 ok:true：那会让调用方以为拿到了当前版本的状态。
  if (compareVersions(state.version, currentVersion) !== 0) {
    return {
      ok: false,
      state: cloneState(state),
      diagnostics: [...diagnostics, {
        code: MIG_CODES.INCOMPLETE,
        detail: `chain ended at ${state.version}, expected ${currentVersion}`,
      }],
    };
  }

  // state 已是链内 spread 产生的新对象；仍克隆一次，
  // 保证"零跳链"等退化情形下也不会把 savedState 直接交出去。
  return { ok: true, state: cloneState(state), diagnostics };
}

function findMigrationChain(
  from: string,
  to: string,
  migrations: readonly MigrationDef[],
): MigrationDef[] | null {
  // BFS：找from到to的迁移链（假设无环，MigrationDef.from/to构成DAG）
  const visited = new Set<string>();
  const queue: Array<{ version: string; path: MigrationDef[] }> = [{ version: from, path: [] }];

  while (queue.length > 0) {
    const { version, path } = queue.shift()!;
    if (version === to) return path;
    if (visited.has(version)) continue;
    visited.add(version);

    for (const m of migrations) {
      if (m.from === version) {
        queue.push({ version: m.to, path: [...path, m] });
      }
    }
  }
  return null;
}
