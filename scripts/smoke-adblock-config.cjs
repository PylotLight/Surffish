// File name and filter config for the never-matching adblock engine the smokes seed into their
// throwaway profile. Both must match what the app reads as its cache (src/main/adblock-policy.ts:
// ADBLOCK_CACHE_FILE, isFullFilterConfig) or the app ignores the seed and downloads the real filter
// lists at launch (slow, flaky, network-dependent, and noisy through the smokes' fake proxies).
// smoke-harness.test.ts keeps them in sync.
"use strict";

module.exports = {
  ADBLOCK_CACHE_FILE: "adblock-engine-v2.bin",
  ADBLOCK_CONFIG: Object.freeze({
    loadNetworkFilters: true,
    loadCosmeticFilters: true,
    loadCSPFilters: true,
    enableHtmlFiltering: false,
    enableMutationObserver: true,
    loadExtendedSelectors: false,
    loadGenericCosmeticsFilters: true,
    loadPreprocessors: true,
    enableCompression: true,
    enableOptimizations: true,
  }),
};
