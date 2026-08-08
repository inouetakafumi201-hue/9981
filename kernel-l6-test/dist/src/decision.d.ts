export interface DecisionDef {
    id: string;
    options: string[] | Record<string, OptionDef>;
    minCount?: number;
    maxCount?: number;
    multiSelect?: boolean;
    ttl?: number | null;
    defaultAnswer?: string[];
}
export interface OptionDef {
    effect?: (ctx: Context) => void;
}
export interface Decision {
    id: string;
    options: string[] | Record<string, OptionDef>;
    answer: string[];
    status: 'open' | 'answered' | 'resolved';
    createdAt: number;
    minCount: number;
    maxCount: number;
    multiSelect: boolean;
    ttl: number | null;
    defaultAnswer: string[];
}
export interface Context {
    entity?: any;
    [key: string]: any;
}
