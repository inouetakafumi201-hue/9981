/**
 * Bounded AI public surface.
 *
 * AI is an immutable read consumer and canonical lifecycle client. This barrel
 * deliberately exports no WorldState-taking search, arbitrary action callback,
 * direct state writer, or legacy slice/tiering API.
 */
export * from './types.js';
export * from './budget.js';
export * from './diagnostics.js';
export * from './read-gateway.js';
export * from './behavior-validation.js';
export * from './candidate-planner.js';
export * from './evaluation.js';
export * from './design-currency.js';
export * from './commit-gateway.js';
export * from './planner-registry.js';
export * from './simulation.js';
export * from './sequential-search.js';
export * from './explanation.js';
export * from './ugc.js';
export * from './facade.js';
