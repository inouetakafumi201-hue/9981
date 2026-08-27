/**
 * Kernel-bound AI integration adapters.
 *
 * These modules are the only place where the AI subsystem is wired to real
 * kernel services. They are consumed by the composition root and depend on the
 * AI contracts in `../types.js`; the AI decision path never depends on them.
 */
export * from './state-read';
export * from './read-adapter';
export * from './commit-adapter';
export * from './simulation-adapter';
export * from './presentation-silencer';
export * from './behavior-adapter';
export * from './search-session';
export * from './participant-order';
export * from './policy-bridge';
