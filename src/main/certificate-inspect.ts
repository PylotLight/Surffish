/**
 * Lazy chunk (loaded the first time a certificate needs a closer look): turns PEM chains into
 * what the certificate viewer shows, and checks a chain against the operating system's trust
 * store for the OS-trust fallback (certificates.ts). Node crypto only, no Electron imports, so it
 * is unit-testable under bun.
 */
import { X509Certificate } from 'node:crypto'
import { isIP } from 'node:net'
import { getCACertificates } from 'node:tls'
import { readFileSync } from 'node:fs'
import { distinguishedNameText, type CertificateDetails, type CertificatePublicKey, type DistinguishedName } from '../shared/certificates'

const EKU_NAMES: Record<string, string> = {
  '1.3.6.1.5.5.7.3.1': 'TLS Web Server Authentication',
  '1.3.6.1.5.5.7.3.2': 'TLS Web Client Authentication',
  '1.3.6.1.5.5.7.3.3': 'Code Signing',
  '1.3.6.1.5.5.7.3.4': 'Email Protection',
  '1.3.6.1.5.5.7.3.8': 'Time Stamping',
  '1.3.6.1.5.5.7.3.9': 'OCSP Signing',
  '2.5.29.37.0': 'Any Extended Key Usage'
}
const SERVER_AUTH = '1.3.6.1.5.5.7.3.1'
const ANY_EKU = '2.5.29.37.0'
const MAX_CHAIN = 10

function parseX509(pem: string): X509Certificate | null {
  try {
    return new X509Certificate(pem)
  } catch {
    return null
  }
}

/** Node prints names one `KEY=value` per line (multi-valued RDNs repeat the key). */
export function parseDistinguishedName(text: string): DistinguishedName {
  const values = new Map<string, string[]>()
  for (const line of text.split('\n')) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    const key = line.slice(0, index).trim().toUpperCase()
    const value = line.slice(index + 1).trim()
    if (!value) continue
    values.set(key, [...(values.get(key) ?? []), value])
  }
  const pick = (...keys: string[]): string | null => {
    for (const key of keys) {
      const found = values.get(key)
      if (found?.length) return found.join(', ')
    }
    return null
  }
  return {
    commonName: pick('CN'),
    organization: pick('O'),
    organizationalUnit: pick('OU'),
    locality: pick('L'),
    state: pick('ST', 'S'),
    country: pick('C')
  }
}

function publicKeyOf(cert: X509Certificate): CertificatePublicKey | null {
  try {
    const key = cert.publicKey
    const details = key.asymmetricKeyDetails ?? {}
    return {
      type: key.asymmetricKeyType ?? 'unknown',
      bits: typeof details.modulusLength === 'number' ? details.modulusLength : null,
      curve: typeof details.namedCurve === 'string' ? details.namedCurve : null
    }
  } catch {
    return null
  }
}

function isoDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

function splitAltNames(value: string | undefined): string[] {
  if (!value) return []
  // `DNS:a.example, IP Address:1.2.3.4`; quoted entries may contain commas (rare): keep it simple.
  return value.split(/,\s*(?=[A-Za-z ]+:)/).map((part) => part.trim()).filter(Boolean)
}

export function certificateDetailsFromPem(pem: string): CertificateDetails | null {
  const cert = parseX509(pem)
  if (!cert) return null
  const subject = parseDistinguishedName(cert.subject)
  const issuer = parseDistinguishedName(cert.issuer)
  return {
    subject,
    issuer,
    subjectText: distinguishedNameText(subject) || cert.subject.replace(/\n/g, ', '),
    issuerText: distinguishedNameText(issuer) || cert.issuer.replace(/\n/g, ', '),
    validFrom: isoDate(cert.validFrom),
    validTo: isoDate(cert.validTo),
    serialNumber: cert.serialNumber.toUpperCase().match(/.{1,2}/g)?.join(':') ?? cert.serialNumber,
    fingerprintSha256: cert.fingerprint256,
    fingerprintSha1: cert.fingerprint,
    subjectAltNames: splitAltNames(cert.subjectAltName),
    publicKey: publicKeyOf(cert),
    keyUsage: (cert.keyUsage ?? []).map((oid) => EKU_NAMES[oid] ?? oid),
    isCA: cert.ca,
    selfSigned: cert.subject === cert.issuer && safeVerify(cert, cert),
    pem: cert.toString()
  }
}

/** Leaf first. Unparseable entries are skipped. */
export function certificateChainDetails(pems: readonly string[]): CertificateDetails[] {
  return pems.map(certificateDetailsFromPem).filter((details): details is CertificateDetails => details !== null)
}

function safeVerify(cert: X509Certificate, issuer: X509Certificate): boolean {
  try {
    return cert.checkIssued(issuer) && cert.verify(issuer.publicKey)
  } catch {
    return false
  }
}

function inValidity(cert: X509Certificate, now: Date): boolean {
  const from = new Date(cert.validFrom).getTime()
  const to = new Date(cert.validTo).getTime()
  const t = now.getTime()
  return Number.isFinite(from) && Number.isFinite(to) && from <= t && t <= to
}

function matchesHost(cert: X509Certificate, host: string): boolean {
  const target = host.replace(/^\[|\]$/g, '')
  try {
    // Like Chromium: SAN only, never the subject CN.
    if (isIP(target)) return cert.checkIP(target) !== undefined
    return cert.checkHost(target, { subject: 'never', wildcards: true, partialWildcards: false }) !== undefined
  } catch {
    return false
  }
}

function allowsServerAuth(cert: X509Certificate): boolean {
  const usages = cert.keyUsage
  return !usages || usages.length === 0 || usages.includes(SERVER_AUTH) || usages.includes(ANY_EKU)
}

/**
 * Does the presented chain (leaf first) lead to one of `anchors` for `host`? Checks the leaf's
 * name (SAN) and server-auth usage, every validity period, signatures, and that intermediates are
 * CAs. No revocation or CT (the OS / Chromium already had their say; this only answers "is the
 * issuer trusted by this computer?").
 */
export function chainTrustedByAnchors(pems: readonly string[], host: string, anchors: readonly X509Certificate[], now = new Date()): boolean {
  const chain = pems.map(parseX509).filter((cert): cert is X509Certificate => cert !== null)
  const leaf = chain[0]
  if (!leaf || anchors.length === 0) return false
  if (!inValidity(leaf, now) || !matchesHost(leaf, host) || !allowsServerAuth(leaf)) return false
  const anchorPrints = new Set(anchors.map((anchor) => anchor.fingerprint256))
  let current = leaf
  const used = new Set<string>([leaf.fingerprint256])
  for (let depth = 0; depth < MAX_CHAIN; depth += 1) {
    // The certificate itself is a trusted anchor (e.g. a user-trusted self-signed leaf).
    if (anchorPrints.has(current.fingerprint256)) return true
    const anchor = anchors.find((candidate) => inValidity(candidate, now) && safeVerify(current, candidate))
    if (anchor) return true
    const next = chain.find((candidate) => !used.has(candidate.fingerprint256) && candidate.ca && inValidity(candidate, now) && safeVerify(current, candidate))
    if (!next) return false
    used.add(next.fingerprint256)
    current = next
  }
  return false
}

let systemAnchors: X509Certificate[] | null = null

/**
 * Roots this computer trusts. macOS: Node reads the Keychain trust settings (system, admin and
 * user domains, so MDM / enterprise-pushed and locally trusted roots are in). Smoke tests on an
 * unpackaged build can add PEM anchors with SURFFISH_TEST_TRUST_ANCHORS (a file path).
 */
export function systemTrustAnchors(allowTestAnchors: boolean): X509Certificate[] {
  if (systemAnchors) return systemAnchors
  const pems: string[] = []
  try {
    pems.push(...getCACertificates('system'))
  } catch (error) {
    console.warn('[certificates] could not read the system trust store:', error)
  }
  const testFile = allowTestAnchors ? process.env.SURFFISH_TEST_TRUST_ANCHORS : undefined
  if (testFile) {
    try {
      const text = readFileSync(testFile, 'utf8')
      pems.push(...(text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? []))
    } catch (error) {
      console.warn('[certificates] could not read SURFFISH_TEST_TRUST_ANCHORS:', error)
    }
  }
  systemAnchors = pems.map(parseX509).filter((cert): cert is X509Certificate => cert !== null)
  return systemAnchors
}

/** Tests: forget the cached anchors. */
export function resetSystemTrustAnchors(): void {
  systemAnchors = null
}
