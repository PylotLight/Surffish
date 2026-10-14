/**
 * Certificates: what the toolbar knows about the active page's connection, the certificate
 * details the site-info viewer shows, and the per-session "proceed anyway" exceptions.
 * Pure (no Node or Electron imports), so the renderer can use the types and helpers too.
 */

/**
 * How the active page's HTTPS connection was trusted.
 * - `secure`: Chromium's verifier accepted the certificate.
 * - `os-trusted`: Chromium said the issuer is unknown, but the operating system's trust store
 *   (macOS Keychain: admin / MDM / user-trusted roots) trusts the chain for this host.
 * - `bypassed`: the certificate is not valid and the user chose "Proceed" for this session.
 */
export type PageCertificateLevel = 'secure' | 'os-trusted' | 'bypassed'

/** Published with the active tab's state (small: details are fetched when the viewer opens). */
export interface BrowserPageSecurity {
  level: PageCertificateLevel
  host: string
  /** `ERR_CERT_…` name Chromium reported (only for `bypassed` / `os-trusted`). */
  error: string | null
}

export interface DistinguishedName {
  commonName: string | null
  organization: string | null
  organizationalUnit: string | null
  locality: string | null
  state: string | null
  country: string | null
}

export interface CertificatePublicKey {
  /** `rsa`, `ec`, `ed25519`… */
  type: string
  /** Modulus length for RSA/DSA. */
  bits: number | null
  /** Named curve for EC keys. */
  curve: string | null
}

/** One certificate of a chain, as the viewer shows it. */
export interface CertificateDetails {
  subject: DistinguishedName
  issuer: DistinguishedName
  /** Raw one-line forms (`CN=…, O=…`) for copying. */
  subjectText: string
  issuerText: string
  /** ISO 8601 timestamps. */
  validFrom: string
  validTo: string
  serialNumber: string
  /** Colon-separated upper-case hex. */
  fingerprintSha256: string
  fingerprintSha1: string
  /** `DNS:example.com`, `IP Address:192.168.1.1`, … */
  subjectAltNames: string[]
  publicKey: CertificatePublicKey | null
  keyUsage: string[]
  isCA: boolean
  selfSigned: boolean
  pem: string
}

export type SiteCertificateStatus = PageCertificateLevel | 'error'

/** What the certificate viewer / "Advanced" panel shows for the active tab. */
export interface SiteCertificateInfo {
  host: string
  url: string
  status: SiteCertificateStatus
  /** `ERR_CERT_…` (error / bypassed / os-trusted). */
  error: string | null
  /** Leaf first, then issuers as the server sent them. */
  chain: CertificateDetails[]
  /** The interstitial may offer "Proceed" (there is a captured failing certificate). */
  canProceed: boolean
  /** "Show in macOS…" (dialog.showCertificateTrustDialog) is available. */
  nativeViewer: boolean
}

/** `net::ERR_CERT_AUTHORITY_INVALID` / `ERR_CERT_AUTHORITY_INVALID` / `(-202)` → the bare name. */
export function certificateErrorName(error: string | null | undefined): string | null {
  if (typeof error !== 'string') return null
  const match = /\b(ERR_[A-Z0-9_]+)\b/.exec(error)
  return match ? match[1] ?? null : null
}

/** Chromium net error codes for certificate failures live in -200…-299. */
export function isCertificateErrorCode(code: number | null | undefined): boolean {
  return typeof code === 'number' && code <= -200 && code > -300
}

/** The one failure the OS-trust fallback may override: "issuer not trusted by Chromium". */
export const NET_ERR_CERT_AUTHORITY_INVALID = -202

/** Hosts compare case-insensitively, without brackets or a trailing dot. */
export function normalizeCertificateHost(host: string): string {
  let value = host.trim().toLowerCase()
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1)
  while (value.endsWith('.')) value = value.slice(0, -1)
  return value
}

export function hostOfUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'wss:') return null
    return normalizeCertificateHost(parsed.hostname) || null
  } catch {
    return null
  }
}

/**
 * "Proceed anyway" exceptions: per page-session partition, per host, per certificate fingerprint.
 * Memory only (gone on quit); the private partition's set is cleared when its session ends. A
 * different certificate on the same host needs a new decision, like Chrome.
 */
export class CertificateExceptions {
  private readonly partitions = new Map<string, Map<string, Set<string>>>()

  allow(partition: string, host: string, fingerprint: string): void {
    const key = normalizeCertificateHost(host)
    if (!key || !fingerprint) return
    let hosts = this.partitions.get(partition)
    if (!hosts) {
      hosts = new Map()
      this.partitions.set(partition, hosts)
    }
    let prints = hosts.get(key)
    if (!prints) {
      prints = new Set()
      hosts.set(key, prints)
    }
    prints.add(fingerprint)
  }

  has(partition: string, host: string, fingerprint: string): boolean {
    return this.partitions.get(partition)?.get(normalizeCertificateHost(host))?.has(fingerprint) ?? false
  }

  /** Any exception for the host (the address bar shows "Not secure" for it). */
  hasHost(partition: string, host: string): boolean {
    return (this.partitions.get(partition)?.get(normalizeCertificateHost(host))?.size ?? 0) > 0
  }

  clear(partition?: string): void {
    if (partition === undefined) this.partitions.clear()
    else this.partitions.delete(partition)
  }

  hosts(partition: string): string[] {
    return [...(this.partitions.get(partition)?.keys() ?? [])]
  }
}

/** Small LRU map (Map keeps insertion order; re-set moves an entry to the end). */
export class LruMap<K, V> {
  private readonly map = new Map<K, V>()
  constructor(private readonly limit: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) {
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }

  peek(key: K): V | undefined {
    return this.map.get(key)
  }

  set(key: K, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    while (this.map.size > this.limit) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      this.map.delete(oldest.value)
    }
  }

  delete(key: K): void {
    this.map.delete(key)
  }

  deleteWhere(predicate: (key: K) => boolean): void {
    for (const key of [...this.map.keys()]) if (predicate(key)) this.map.delete(key)
  }

  get size(): number {
    return this.map.size
  }
}

/** Human copy for a certificate error name (interstitial "Advanced" and the viewer). */
export function describeCertificateError(name: string | null): string {
  switch (name) {
    case 'ERR_CERT_AUTHORITY_INVALID': return 'The certificate isn’t issued by an authority this computer trusts (self-signed, a private CA, or traffic interception).'
    case 'ERR_CERT_COMMON_NAME_INVALID': return 'The certificate is for a different address than this one.'
    case 'ERR_CERT_DATE_INVALID': return 'The certificate has expired or isn’t valid yet. Check your computer’s clock too.'
    case 'ERR_CERT_REVOKED': return 'The certificate was revoked by its issuer.'
    case 'ERR_CERT_WEAK_SIGNATURE_ALGORITHM': return 'The certificate is signed with a weak algorithm.'
    case 'ERR_CERT_WEAK_KEY': return 'The certificate uses a key that is too weak.'
    case 'ERR_CERT_INVALID': return 'The certificate is malformed.'
    case 'ERR_CERT_VALIDITY_TOO_LONG': return 'The certificate is valid for longer than browsers allow.'
    case 'ERR_CERT_SYMANTEC_LEGACY': return 'The certificate is from a distrusted legacy authority.'
    case 'ERR_CERT_KNOWN_INTERCEPTION_BLOCKED': return 'The certificate is from known interception software.'
    case 'ERR_CERTIFICATE_TRANSPARENCY_REQUIRED': return 'The certificate wasn’t publicly logged (Certificate Transparency).'
    default: return 'The site’s security certificate isn’t valid.'
  }
}

/** `AB:CD:…` from hex (Node's fingerprint format already is; this normalises other inputs). */
export function formatFingerprint(hex: string): string {
  const clean = hex.replace(/[^0-9a-f]/gi, '').toUpperCase()
  return clean.match(/.{1,2}/g)?.join(':') ?? ''
}

/** `CN=a, O=b` style one-liner for a distinguished name, skipping empty parts. */
export function distinguishedNameText(name: DistinguishedName): string {
  const parts: string[] = []
  if (name.commonName) parts.push(`CN=${name.commonName}`)
  if (name.organizationalUnit) parts.push(`OU=${name.organizationalUnit}`)
  if (name.organization) parts.push(`O=${name.organization}`)
  if (name.locality) parts.push(`L=${name.locality}`)
  if (name.state) parts.push(`ST=${name.state}`)
  if (name.country) parts.push(`C=${name.country}`)
  return parts.join(', ')
}

/** Short label for a chain entry (CN, else O, else the raw text). */
export function certificateLabel(details: Pick<CertificateDetails, 'subject' | 'subjectText'>): string {
  return details.subject.commonName || details.subject.organization || details.subjectText || 'Certificate'
}

/** One-line verdict and a sentence on who trusts the certificate (shared with the site menu). */
export function certificateVerdict(info: { status: SiteCertificateStatus; error: string | null }): { valid: boolean; title: string; detail: string } {
  switch (info.status) {
    case 'secure': return { valid: true, title: 'Certificate is valid', detail: 'Issued by an authority Surffish trusts.' }
    case 'os-trusted': return { valid: true, title: 'Certificate is valid', detail: 'Trusted by this computer’s system keychain (an enterprise, MDM or locally installed root), not by Surffish’s built-in list.' }
    case 'bypassed': return { valid: false, title: 'Certificate is not valid', detail: `${describeCertificateError(info.error)} You chose to proceed for this session.` }
    default: return { valid: false, title: 'Certificate is not valid', detail: describeCertificateError(info.error) }
  }
}

export interface SiteConnectionSummary {
  kind: 'secure' | 'not-secure' | 'local'
  title: string
  detail: string
  /** Label of the row that opens the certificate viewer (null: no certificate to show). */
  certificateRow: string | null
}

function isLoopbackPageHost(host: string): boolean {
  const value = normalizeCertificateHost(host)
  return value === 'localhost' || value.endsWith('.localhost') || value === '::1' || /^127\./.test(value)
}

/**
 * The site menu's Connection section for the active page. `certificateError` is set when the tab
 * shows a certificate error page for `url`.
 */
export function siteConnectionSummary(url: string, security: BrowserPageSecurity | null | undefined, certificateError: string | null = null): SiteConnectionSummary | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol === 'https:') {
    if (certificateError !== null) return { kind: 'not-secure', title: 'Connection is not private', detail: describeCertificateError(certificateError), certificateRow: 'Certificate is not valid' }
    if (security?.level === 'bypassed') return { kind: 'not-secure', title: 'Connection is not secure', detail: `The certificate isn’t valid${security.error ? ` (${security.error})` : ''}. You chose to proceed, so don’t enter passwords or payment details here.`, certificateRow: 'Certificate is not valid' }
    if (security?.level === 'os-trusted') return { kind: 'secure', title: 'Connection is secure', detail: 'Trusted through this computer’s system keychain (an enterprise or locally installed root).', certificateRow: 'Certificate is valid' }
    // Chromium only shows an https page whose certificate it accepted (or the user bypassed, above).
    return { kind: 'secure', title: 'Connection is secure', detail: 'Information you send to this site is private.', certificateRow: security ? 'Certificate is valid' : 'Certificate' }
  }
  if (parsed.protocol === 'http:') {
    if (isLoopbackPageHost(parsed.hostname)) return { kind: 'local', title: 'Local page', detail: 'This page is served from this computer over plain HTTP.', certificateRow: null }
    return { kind: 'not-secure', title: 'Connection is not secure', detail: 'This site uses plain HTTP: anyone on the network path can read or change what you send.', certificateRow: null }
  }
  return null
}
