export const NETWORK_ONLY_CONFIG = {
  loadNetworkFilters: true,
  loadCosmeticFilters: false,
  loadCSPFilters: false,
  enableHtmlFiltering: false,
  enableMutationObserver: false,
  loadExtendedSelectors: false,
  loadGenericCosmeticsFilters: false
} as const

type FilterConfiguration = {
  loadNetworkFilters: boolean
  loadCosmeticFilters: boolean
  loadCSPFilters: boolean
  enableHtmlFiltering: boolean
  enableMutationObserver: boolean
  loadExtendedSelectors: boolean
  loadGenericCosmeticsFilters: boolean
}

export function isNetworkOnlyConfig(config: FilterConfiguration): boolean {
  return config.loadNetworkFilters &&
    !config.loadCosmeticFilters &&
    !config.loadCSPFilters &&
    !config.enableHtmlFiltering &&
    !config.enableMutationObserver &&
    !config.loadExtendedSelectors &&
    !config.loadGenericCosmeticsFilters
}

export function isProtectedVideoDeliveryUrl(value: string | undefined): boolean {
  if (!value) return false
  try {
    const host = new URL(value).hostname
    return host === 'googlevideo.com' || host.endsWith('.googlevideo.com')
  } catch {
    return false
  }
}
