/**
 * Kernel-bound AI integration adapters.
 *
 * These modules are the only place where the AI subsystem is wired to real
 * kernel services. They are consumed by the composition root and depend on the
 * AI contracts in `../types.js`; the AI decision path never depends on them.
 */
export * from './state-read.js';
export * from './read-adapter.js';
export * from './commit-adapter.js';
export * from './simulation-adapter.js';
export * from './presentation-silencer.js';
export * from './behavior-adapter.js';
export * from './search-session.js';
export * from './participant-order.js';
export * from './policy-bridge.js';
