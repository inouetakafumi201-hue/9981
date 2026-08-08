"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DecisionSystem = void 0;
class DecisionSystem {
    constructor() {
        this.decisions = new Map();
        this.currentTime = Date.now();
    }
    tick(deltaMs) {
        this.currentTime += deltaMs;
        this.checkTimeouts();
    }
    open(def) {
        const optionsArray = Array.isArray(def.options)
            ? def.options
            : Object.keys(def.options);
        if (optionsArray.length === 0) {
            throw new Error('E_DEC_INVALID');
        }
        const minCount = def.minCount ?? 1;
        let maxCount = def.maxCount ?? 1;
        // Multi-select: default maxCount to number of options (capped at 100)
        if (def.multiSelect && def.maxCount === undefined) {
            maxCount = Math.min(optionsArray.length, 100);
        }
        if (minCount > maxCount) {
            throw new Error('E_DEC_INVALID');
        }
        if (def.defaultAnswer) {
            for (const choice of def.defaultAnswer) {
                if (!optionsArray.includes(choice)) {
                    throw new Error('E_DEC_INVALID_ANSWER');
                }
            }
        }
        if (this.decisions.has(def.id)) {
            throw new Error('E_DEC_DUPLICATE');
        }
        const decision = {
            id: def.id,
            options: def.options,
            answer: [],
            status: 'open',
            createdAt: this.currentTime,
            minCount,
            maxCount,
            multiSelect: def.multiSelect ?? false,
            ttl: def.ttl ?? null,
            defaultAnswer: def.defaultAnswer ?? []
        };
        this.decisions.set(def.id, decision);
        return def.id;
    }
    answer(id, choice) {
        const decision = this.decisions.get(id);
        if (!decision) {
            throw new Error('E_REF_INVALID');
        }
        // DEC-4: Check timeout before answering
        this.checkTimeouts();
        if (decision.status === 'resolved') {
            throw new Error('E_DEC_ALREADY_RESOLVED');
        }
        const optionsArray = Array.isArray(decision.options)
            ? decision.options
            : Object.keys(decision.options);
        if (!optionsArray.includes(choice)) {
            throw new Error('E_DEC_INVALID_ANSWER');
        }
        // DEC-5: Check duplicate
        if (decision.answer.includes(choice)) {
            throw new Error('E_DEC_DUPLICATE');
        }
        // Single-select mode: cannot answer again after first answer
        if (!decision.multiSelect && decision.answer.length > 0) {
            throw new Error('E_DEC_DUPLICATE');
        }
        // DEC-3: Check maxCount
        if (decision.answer.length >= decision.maxCount) {
            throw new Error('E_DEC_COUNT_MISMATCH');
        }
        decision.answer.push(choice);
        // Check if answered (reached minCount)
        if (decision.answer.length >= decision.minCount) {
            decision.status = 'answered';
        }
    }
    resolve(id, ctx = {}) {
        const decision = this.decisions.get(id);
        if (!decision) {
            throw new Error('E_REF_INVALID');
        }
        if (decision.status === 'resolved') {
            throw new Error('E_DEC_ALREADY_RESOLVED');
        }
        // DEC-3: a timeout may mark a partial defaultAnswer as answered;
        // resolving still requires the configured minimum number of selections.
        if (decision.answer.length < decision.minCount) {
            throw new Error('E_DEC_UNANSWERED');
        }
        // minCount=0 permits resolving an otherwise open decision with no answer.
        if (decision.status === 'open' && decision.minCount === 0) {
            decision.status = 'answered';
        }
        else if (decision.status !== 'answered') {
            throw new Error('E_DEC_UNANSWERED');
        }
        // DEC-6: Trigger effects
        if (!Array.isArray(decision.options)) {
            for (const choice of decision.answer) {
                const optionDef = decision.options[choice];
                if (optionDef?.effect) {
                    optionDef.effect(ctx);
                }
            }
        }
        decision.status = 'resolved';
    }
    checkTimeouts() {
        for (const decision of this.decisions.values()) {
            if (decision.status !== 'open')
                continue;
            if (decision.ttl === null)
                continue;
            const elapsed = this.currentTime - decision.createdAt;
            if (elapsed >= decision.ttl) {
                if (decision.defaultAnswer.length > 0) {
                    decision.answer = [...decision.defaultAnswer];
                    decision.status = 'answered';
                    // Auto-resolve
                    try {
                        this.resolve(decision.id);
                    }
                    catch (e) {
                        // defaultAnswer may not satisfy minCount, leave as answered
                    }
                }
            }
        }
    }
    get(id) {
        return this.decisions.get(id);
    }
}
exports.DecisionSystem = DecisionSystem;
//# sourceMappingURL=decision-system.js.map