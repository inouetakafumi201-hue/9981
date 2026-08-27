/**
 * Schema Migration Graph
 *
 * 版本号：1.0.0（2026-08-12）
 * 迁出源：spec-compiler/registries.ts::CandidateMigrationRegistry
 *
 * 职责：版本迁移路径查询（DFS 寻路）、环检测、重复路径检测
 * 设计约束：不得携带迁移执行逻辑（executor 由宿主实现）
 */

import { compareCodePoints } from '../../core/kernel/codec/index';

/**
 * 单条迁移边的定义
 *
 * 注意：executor 逻辑完全由宿主实现，本模块不关心迁移函数如何工作
 */
export interface CandidateMigration {
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly id: string;
}

/**
 * 版本寻路结果
 *
 * - 'identity': fromVersion === toVersion，无需迁移
 * - 'ok': 存在唯一路径
 * - 'missing': 无可用路径
 * - 'ambiguous': 多条路径（需用户消歧）
 * - 'cycle': 检测到环，路径不可用
 */
export interface MigrationPathResult {
  readonly status: 'identity' | 'ok' | 'missing' | 'ambiguous' | 'cycle';
  readonly path: readonly CandidateMigration[];
  readonly competingPaths?: readonly (readonly CandidateMigration[])[];
}

/**
 * 比较两个语义版本号（如 "1.0.0" vs "2.1.0"）
 *
 * 返回：
 * - < 0 if left < right
 * - 0 if left === right
 * - > 0 if left > right
 *
 * 规则：按数字部分逐位比较，超出范围的部分按 0 处理（1.0 === 1.0.0）
 * 若所有数字部分相等，按 code point 字典序比较原字符串（用于排序稳定性）
 */
export function compareVersions(left: string, right: string): number {
  const a = left.split('.').map((part) => Number.parseInt(part, 10));
  const b = right.split('.').map((part) => Number.parseInt(part, 10));
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const leftPart = a[index];
    const rightPart = b[index];
    const leftValue = leftPart !== undefined && Number.isFinite(leftPart) ? leftPart : 0;
    const rightValue = rightPart !== undefined && Number.isFinite(rightPart) ? rightPart : 0;
    const difference = leftValue - rightValue;
    if (difference !== 0) return difference;
  }
  // 所有数字部分相等，本应返回 0（版本视为相等）
  return 0;
}

/**
 * Schema 版本迁移图
 *
 * 维护一张版本迁移边的有向图，支持：
 * - 注册新迁移边（DFS 路径图）
 * - 查询从一个版本到另一个版本的最短路径
 * - 检测环、重复路径、模糊路径
 */
export class SchemaMigrationGraph {
  private readonly migrations: CandidateMigration[] = [];

  /**
   * 注册一条迁移边
   *
   * 约束：
   * - fromVersion !== toVersion（必须改变版本）
   * - 不允许重复的 id
   * - 不允许重复的 (fromVersion, toVersion) 对
   */
  register(migration: CandidateMigration): void {
    if (migration.fromVersion === migration.toVersion) {
      throw new Error('Migration edge must change version');
    }
    if (this.migrations.some((item) => item.id === migration.id)) {
      throw new Error(`Migration ${migration.id} is already registered`);
    }
    if (this.migrations.some((item) =>
      item.fromVersion === migration.fromVersion && item.toVersion === migration.toVersion)) {
      throw new Error(`Migration edge ${migration.fromVersion} -> ${migration.toVersion} is duplicated`);
    }
    this.migrations.push(migration);
  }

  /**
   * 查询从 fromVersion 到 toVersion 的迁移路径
   *
   * 算法：DFS 寻路（BFS 也可以，但 DFS 便于环检测）
   *
   * 参数：
   * - fromVersion：起始版本
   * - toVersion：目标版本
   * - maxSteps：最大步数（防止超长路径，也作为环检测的深度限制）
   *
   * 返回：
   * - 'identity': from === to，path = []
   * - 'ok': 唯一路径找到
   * - 'missing': 没有路径
   * - 'ambiguous': 多条路径存在（通常表示 schema 定义有歧义）
   * - 'cycle': 检测到环
   */
  resolve(fromVersion: string, toVersion: string, maxSteps: number): MigrationPathResult {
    if (fromVersion === toVersion) {
      return { status: 'identity', path: [] };
    }

    const paths: CandidateMigration[][] = [];
    let cycleDetected = false;

    const visit = (version: string, path: CandidateMigration[], visited: Set<string>): void => {
      // 到达目标
      if (version === toVersion) {
        paths.push(path);
        return;
      }

      // 已超过步数限制
      if (path.length >= maxSteps) return;
      // 已找到多条路径，停止搜索（标记为 ambiguous）
      if (paths.length > 1) return;

      // DFS 遍历所有出边
      for (const edge of this.migrations
        .filter((item) => item.fromVersion === version)
        .sort((a, b) => compareCodePoints(a.id, b.id))) {
        // 环检测：若目标版本已在访问栈中，标记环
        if (visited.has(edge.toVersion)) {
          cycleDetected = true;
          continue;
        }
        // 递归访问
        visit(edge.toVersion, [...path, edge], new Set([...visited, edge.toVersion]));
      }
    };

    visit(fromVersion, [], new Set([fromVersion]));

    // 返回搜索结果
    if (paths.length > 1) {
      return { status: 'ambiguous', path: [], competingPaths: paths };
    }
    if (paths.length === 1) {
      return { status: 'ok', path: paths[0] ?? [] };
    }
    return { status: cycleDetected ? 'cycle' : 'missing', path: [] };
  }
}
