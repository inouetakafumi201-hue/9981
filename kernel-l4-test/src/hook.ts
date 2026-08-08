export const HookPhase = {
  Before: 'before',
  Modify: 'modify',
  Instead: 'instead',
  After: 'after',
} as const;

export type HookPhase = (typeof HookPhase)[keyof typeof HookPhase];

export interface PreventResult {
  preventAll?: boolean;
  preventExcept?: string[];
}

export interface Context {
  event: string;
  data: any;
  entity?: Entity;
  result?: unknown;
  emit: (type: string, data?: any) => void;
  /** 将事件放入下一反应轮；最多执行八轮。 */
  react: (type: string, data?: any) => void;
}

export interface HookDef {
  id: string;
  on: string;
  phase: HookPhase;
  priority?: number;
  when?: (ctx: Context) => boolean;
  effect: (ctx: Context) => void | PreventResult;
}

export interface Item {
  id: string;
  def: string;
  rules: HookDef[];
  destroyed?: boolean;
}

export class Container {
  readonly items: Item[] = [];

  constructor(readonly id: string) {}

  addItem(item: Item): void {
    this.items.push(item);
  }

  removeItem(itemId: string): Item | undefined {
    const index = this.items.findIndex((item) => item.id === itemId);
    if (index < 0) return undefined;
    return this.items.splice(index, 1)[0];
  }
}

export interface Entity {
  id: string;
  containers: Record<string, Container>;
  containerOrder: string[];
}

export function createEntity(
  id = 'entity',
  containerOrder: string[] = ['hand', 'backpack', 'belt'],
): Entity {
  return {
    id,
    containerOrder: [...containerOrder],
    containers: Object.fromEntries(
      containerOrder.map((name) => [name, new Container(name)]),
    ),
  };
}

export interface HookMeta {
  containerIndex: number;
  slotIndex: number;
  defId: string;
  order: number;
}

export const HOOK_ERRORS = {
  DEPTH_EXCEEDED: 'E_HOOK_DEPTH_EXCEEDED',
  REENTRY: 'E_HOOK_REENTRY',
} as const;

export class HookDepthExceededError extends Error {
  constructor() {
    super(HOOK_ERRORS.DEPTH_EXCEEDED);
    this.name = 'HookDepthExceededError';
  }
}

export class HookReentryError extends Error {
  constructor() {
    super(HOOK_ERRORS.REENTRY);
    this.name = 'HookReentryError';
  }
}
