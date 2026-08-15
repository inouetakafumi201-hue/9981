export declare const HookPhase: {
    readonly Before: 'before';
    readonly Modify: 'modify';
    readonly Instead: 'instead';
    readonly After: 'after';
};
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
export declare class Container {
    readonly id: string;
    readonly items: Item[];
    constructor(id: string);
    addItem(item: Item): void;
    removeItem(itemId: string): Item | undefined;
}
export interface Entity {
    id: string;
    containers: Record<string, Container>;
    containerOrder: string[];
}
export declare function createEntity(id?: string, containerOrder?: string[]): Entity;
export interface HookMeta {
    containerIndex: number;
    slotIndex: number;
    defId: string;
    order: number;
}
export declare const HOOK_ERRORS: {
    readonly DEPTH_EXCEEDED: 'E_HOOK_DEPTH_EXCEEDED';
    readonly REENTRY: 'E_HOOK_REENTRY';
};
export declare class HookDepthExceededError extends Error {
    constructor();
}
export declare class HookReentryError extends Error {
    constructor();
}
//# sourceMappingURL=hook.d.ts.map