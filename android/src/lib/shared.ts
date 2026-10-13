/**
 * Pure TS reused from the desktop app (../src/shared). Only platform-free modules: no Electron,
 * no Node. Metro watches ../src/shared (see metro.config.js).
 */
export { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES, isSearchEngineId, getSearchHomepage, resolveNavigationTarget } from '../../../src/shared/navigation'
export { buildAddressSuggestions, type AddressSuggestion } from '../../../src/shared/autocomplete'
export { DEFAULT_CUSTOM_SEARCH_ENGINES, parseKeywordSearch } from '../../../src/shared/search-keywords'
export { cleanLinkUrl } from '../../../src/shared/clean-link'
export type { SearchEngineId } from '../../../src/shared/types'
