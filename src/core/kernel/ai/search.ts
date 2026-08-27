/**
 * Bounded sequential-search export.
 *
 * The former state-taking aiSearch API is intentionally removed. Search is
 * performed only through SearchDecisionContext, SearchSession and the
 * SimulationAdapter-backed canonical lifecycle.
 */
export { SequentialSearchPlanner, isSearchPlanner } from './sequential-search';
export type { SearchDecisionContext, SearchPlanner, SearchSession } from './types';
