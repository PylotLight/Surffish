/**
 * Hosts Surffish's ad blocker must never block because an installed extension depends on them
 * (e.g. extensionpay.com for ExtPay-based extensions). Kept in its own module so the ad blocker
 * and the extension installer do not import each other.
 */
let exemptHosts: ReadonlySet<string> = new Set()

export function setExtensionAdblockExemptHosts(hosts: Iterable<string>): void {
  exemptHosts = new Set([...hosts].map((host) => host.toLowerCase()))
}

export function getExtensionAdblockExemptHosts(): ReadonlySet<string> {
  return exemptHosts
}
