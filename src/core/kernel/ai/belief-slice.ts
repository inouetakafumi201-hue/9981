/**
 * Compatibility module for the bounded belief-slice contract.
 *
 * Constructing a slice is owned by AIReadGateway. There is intentionally no
 * state-taking sliceFor function: the public AI surface must not accept an
 * unfiltered WorldState alias.
 */
export type { BeliefSlice, KnownFact } from './types.js';
export { RestrictedAIReadGateway, UnavailableAIReadGateway } from './read-gateway.js';
export type { AIReadAdapter, AIReadVersions, ReadAuthority } from './read-gateway.js';
