/**
 * Bounded AI public surface.
 *
 * AI is an immutable read consumer and canonical lifecycle client. This barrel
 * deliberately exports no WorldState-taking search, arbitrary action callback,
 * direct state writer, or legacy slice/tiering API.
 */
export * from './types';
export * from './budget';
export * from './diagnostics';
export * from './read-gateway';
export * from './behavior-validation';
export * from './candidate-planner';
export * from './evaluation';
export * from './design-currency';
export * from './commit-gateway';
export * from './planner-registry';
export * from './simulation';
export * from './sequential-search';
export * from './explanation';
export * from './ugc';
export * from './facade';
