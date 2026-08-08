import { Diagnostic } from './diagnostic.js';

export type DefKind = 'entity' | 'attachment' | 'rule' | 'action' | 'expr' | 'other';

export interface Def {
  readonly id: string;
  readonly kind: DefKind;
  readonly extends?: string[];
  readonly effects?: unknown[];
}

export interface LintResult {
  ok: boolean;
  diagnostics: Diagnostic[];
}

export interface LinterOpts {
  allDefs: Def[];
  customLinter?: (defs: Def[]) => Diagnostic[];
  quotas?: { maxEntities?: number; maxAttachments?: number; maxRules?: number };
}

function mkDiag(code: string, severity: Diagnostic['severity'], message: string, defId?: string): Diagnostic {
  return { code, severity, message, at: defId ? { def: defId } : undefined, phase: 0 };
}

export class Linter {
  run(opts: LinterOpts): LintResult {
    const diagnostics: Diagnostic[] = [];
    const defMap = new Map(opts.allDefs.map((d) => [d.id, d]));

    // 1. 引用存在性
    for (const def of opts.allDefs) {
      for (const parentId of def.extends ?? []) {
        if (!defMap.has(parentId)) {
          diagnostics.push(mkDiag('E_LOAD_UNDEFINED_REF', 'error', `Def ${def.id} extends 引用了不存在的 ${parentId}`, def.id));
        }
      }
    }

    // 2. while/maxIter 检查（effects 可能嵌套 do/then/else）
    function checkEffects(defId: string, effects: unknown[]): void {
      for (const eff of effects) {
        if (typeof eff !== 'object' || eff === null) continue;
        const e = eff as Record<string, unknown>;
        if ('while' in e && (e['maxIter'] === undefined || e['maxIter'] === null)) {
          diagnostics.push(mkDiag('E_FLOW_NO_MAXITER', 'error', `Def ${defId} 的 while effect 缺少 maxIter`, defId));
        }
        for (const branchKey of ['do', 'then', 'else'] as const) {
          if (branchKey in e && Array.isArray(e[branchKey])) checkEffects(defId, e[branchKey] as unknown[]);
        }
      }
    }
    for (const def of opts.allDefs) {
      if (Array.isArray(def.effects)) checkEffects(def.id, def.effects);
    }

    // 5. 继承环检测
    for (const def of opts.allDefs) {
      if (hasCycle(def.id, defMap, new Set())) {
        diagnostics.push(mkDiag('E_LOAD_CYCLE_DEP', 'fatal', `Def ${def.id} 存在继承环`, def.id));
      }
    }

    // 8. 自定义 linter
    if (opts.customLinter) {
      diagnostics.push(...opts.customLinter(opts.allDefs));
    }

    // 9. 配额检查
    if (opts.quotas) {
      const entityCount = opts.allDefs.filter((d) => d.kind === 'entity').length;
      const attachCount = opts.allDefs.filter((d) => d.kind === 'attachment').length;
      const ruleCount = opts.allDefs.filter((d) => d.kind === 'rule').length;
      if (opts.quotas.maxEntities !== undefined && entityCount > opts.quotas.maxEntities)
        diagnostics.push(mkDiag('E_QUOTA_ENTITIES', 'error', `Entity Def 数量 ${entityCount} 超出配额 ${opts.quotas.maxEntities}`));
      if (opts.quotas.maxAttachments !== undefined && attachCount > opts.quotas.maxAttachments)
        diagnostics.push(mkDiag('E_QUOTA_ATTACHMENTS', 'error', `Attachment Def 数量 ${attachCount} 超出配额 ${opts.quotas.maxAttachments}`));
      if (opts.quotas.maxRules !== undefined && ruleCount > opts.quotas.maxRules)
        diagnostics.push(mkDiag('E_QUOTA_RULES', 'error', `Rule Def 数量 ${ruleCount} 超出配额 ${opts.quotas.maxRules}`));
    }

    return {
      ok: !diagnostics.some((d) => d.severity === 'error' || d.severity === 'fatal'),
      diagnostics,
    };
  }
}

function hasCycle(id: string, defMap: Map<string, Def>, visiting: Set<string>): boolean {
  if (visiting.has(id)) return true;
  const def = defMap.get(id);
  if (!def || !def.extends) return false;
  visiting.add(id);
  for (const parentId of def.extends) {
    if (hasCycle(parentId, defMap, new Set(visiting))) return true;
  }
  return false;
}
