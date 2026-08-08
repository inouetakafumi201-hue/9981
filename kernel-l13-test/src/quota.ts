import { MiniWorldState } from './world.js';

export interface QuotaLimits {
  maxEntities?: number;
  maxAttachments?: number;
  maxRules?: number;
}

export class QuotaEnforcer {
  constructor(private readonly limits: QuotaLimits) {}

  checkEntityQuota(state: MiniWorldState): { ok: boolean; message?: string } {
    const count = Object.keys(state.entities).length;
    if (this.limits.maxEntities !== undefined && count >= this.limits.maxEntities)
      return { ok: false, message: `Entity 数量 ${count} 已达配额上限 ${this.limits.maxEntities}` };
    return { ok: true };
  }

  checkAttachmentQuota(state: MiniWorldState): { ok: boolean; message?: string } {
    const count = Object.keys(state.attachments).length;
    if (this.limits.maxAttachments !== undefined && count >= this.limits.maxAttachments)
      return { ok: false, message: `Attachment 数量 ${count} 已达配额上限 ${this.limits.maxAttachments}` };
    return { ok: true };
  }

  checkRuleQuota(state: MiniWorldState): { ok: boolean; message?: string } {
    const count = Object.keys(state.rules).length;
    if (this.limits.maxRules !== undefined && count >= this.limits.maxRules)
      return { ok: false, message: `Rule 数量 ${count} 已达配额上限 ${this.limits.maxRules}` };
    return { ok: true };
  }
}
