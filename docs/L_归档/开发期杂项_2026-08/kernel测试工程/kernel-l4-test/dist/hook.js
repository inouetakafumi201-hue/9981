"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HookReentryError = exports.HookDepthExceededError = exports.HOOK_ERRORS = exports.Container = exports.HookPhase = void 0;
exports.createEntity = createEntity;
exports.HookPhase = {
    Before: 'before',
    Modify: 'modify',
    Instead: 'instead',
    After: 'after',
};
class Container {
    id;
    items = [];
    constructor(id) {
        this.id = id;
    }
    addItem(item) {
        this.items.push(item);
    }
    removeItem(itemId) {
        const index = this.items.findIndex((item) => item.id === itemId);
        if (index < 0)
            return undefined;
        return this.items.splice(index, 1)[0];
    }
}
exports.Container = Container;
function createEntity(id = 'entity', containerOrder = ['hand', 'backpack', 'belt']) {
    return {
        id,
        containerOrder: [...containerOrder],
        containers: Object.fromEntries(containerOrder.map((name) => [name, new Container(name)])),
    };
}
exports.HOOK_ERRORS = {
    DEPTH_EXCEEDED: 'E_HOOK_DEPTH_EXCEEDED',
    REENTRY: 'E_HOOK_REENTRY',
};
class HookDepthExceededError extends Error {
    constructor() {
        super(exports.HOOK_ERRORS.DEPTH_EXCEEDED);
        this.name = 'HookDepthExceededError';
    }
}
exports.HookDepthExceededError = HookDepthExceededError;
class HookReentryError extends Error {
    constructor() {
        super(exports.HOOK_ERRORS.REENTRY);
        this.name = 'HookReentryError';
    }
}
exports.HookReentryError = HookReentryError;
//# sourceMappingURL=hook.js.map