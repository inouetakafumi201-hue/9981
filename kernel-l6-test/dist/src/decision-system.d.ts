import { Decision, DecisionDef, Context } from './decision';
export declare class DecisionSystem {
    private decisions;
    private currentTime;
    tick(deltaMs: number): void;
    open(def: DecisionDef): string;
    answer(id: string, choice: string): void;
    resolve(id: string, ctx?: Context): void;
    private checkTimeouts;
    get(id: string): Decision | undefined;
}
