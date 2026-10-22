/**
 * Certificate handling for page sessions:
 *
 * - Captures each host's certificate chain and verdict (setCertificateVerifyProc), so the site-info
 *   popover can say "Connection is secure" and open a viewer with the full chain.
 * - OS-trust fallback (macOS): when Chromium rejects a chain only because it doesn't know the issuer
 *   (ERR_CERT_AUTHORITY_INVALID), check it against the system trust store (Keychain: admin, MDM
 *   and user-trusted roots) and accept it if the OS trusts it for this host. Cached per
 *   host + fingerprint; the check itself lives in a lazy chunk (certificate-inspect.ts).
 * - "Proceed anyway" exceptions from the certificate interstitial: per page-session partition,
 *   host and certificate fingerprint, memory only (cleared on quit; the private partition's are
 *   cleared when its session ends). Honoured through app's `certificate-error` callback(true).
 *
 * No browser.ts import (it imports this): IPC that needs tabs is wired in ipc.ts.
 */
import { app, dialog, type Certificate, type WebContents } from "electron";
import {
  CertificateExceptions,
  LruMap,
  NET_ERR_CERT_AUTHORITY_INVALID,
  certificateErrorName,
  hostOfUrl,
  normalizeCertificateHost,
  type BrowserPageSecurity,
  type PageCertificateLevel,
  type SiteCertificateInfo,
} from "../shared/certificates";
import { onPageSessionCreated, pageSessionInfoFor } from "./browser-session";

type RecordLevel = PageCertificateLevel | "error";

interface HostRecord {
  level: RecordLevel;
  /** `ERR_CERT_…` Chromium reported, or null when it accepted the chain. */
  error: string | null;
  certificate: Certificate;
}

interface MainFrameCertificateError {
  url: string;
  host: string;
  partition: string;
  error: string | null;
  certificate: Certificate;
}

const records = new LruMap<string, HostRecord>(256);
const osTrust = new LruMap<string, boolean>(256);
const exceptions = new CertificateExceptions();
/** The last main-frame certificate failure per tab WebContents (what "Proceed" and "Advanced" use). */
const mainFrameErrors = new Map<number, MainFrameCertificateError>();
const watchedContents = new Set<number>();
const listeners = new Set<() => void>();

let inspectModule: Promise<typeof import("./certificate-inspect")> | null =
  null;
const inspect = (): Promise<typeof import("./certificate-inspect")> =>
  (inspectModule ??= import("./certificate-inspect"));

const recordKey = (partition: string, host: string): string =>
  `${partition}\n${normalizeCertificateHost(host)}`;

function notify(): void {
  for (const listener of listeners) listener();
}

/** Hear when a page's certificate state changes in a way the toolbar shows (a bypass). */
export function onCertificateStateChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Leaf first, following issuerCert (Electron stops at the last certificate the server sent). */
export function certificatePemChain(
  certificate: Certificate | null | undefined,
): string[] {
  const pems: string[] = [];
  const seen = new Set<string>();
  let current: Certificate | undefined | null = certificate;
  while (current && pems.length < 10) {
    if (!current.data || seen.has(current.fingerprint)) break;
    seen.add(current.fingerprint);
    pems.push(current.data);
    current = current.issuerCert;
  }
  return pems;
}

function osTrustFallbackEnabled(): boolean {
  if (process.platform === "darwin") return true;
  // Smoke tests exercise the fallback on Linux with their own anchor (never in a packaged app).
  return !app.isPackaged && Boolean(process.env.SURFFISH_TEST_TRUST_ANCHORS);
}

async function trustedByOs(
  host: string,
  certificate: Certificate,
): Promise<boolean> {
  const key = `${normalizeCertificateHost(host)}\n${certificate.fingerprint}`;
  const cached = osTrust.get(key);
  if (cached !== undefined) return cached;
  let trusted = false;
  try {
    const module = await inspect();
    trusted = module.chainTrustedByAnchors(
      certificatePemChain(certificate),
      host,
      module.systemTrustAnchors(!app.isPackaged),
    );
  } catch (error) {
    console.warn("[certificates] OS trust check failed:", error);
  }
  osTrust.set(key, trusted);
  return trusted;
}

function installVerifyProc(target: Electron.Session, partition: string): void {
  target.setCertificateVerifyProc((request, callback) => {
    const host = normalizeCertificateHost(request.hostname);
    const key = recordKey(partition, host);
    const error =
      request.errorCode === 0
        ? null
        : (certificateErrorName(request.verificationResult) ??
          `Error ${request.errorCode}`);
    if (request.errorCode === 0) {
      records.set(key, {
        level: "secure",
        error: null,
        certificate: request.certificate,
      });
      callback(-3);
      return;
    }
    if (
      request.errorCode === NET_ERR_CERT_AUTHORITY_INVALID &&
      osTrustFallbackEnabled()
    ) {
      void trustedByOs(host, request.certificate).then((trusted) => {
        records.set(key, {
          level: trusted ? "os-trusted" : "error",
          error,
          certificate: request.certificate,
        });
        callback(trusted ? 0 : -3);
      });
      return;
    }
    records.set(key, {
      level: "error",
      error,
      certificate: request.certificate,
    });
    callback(-3);
  });
}

function rememberMainFrameError(
  contents: WebContents,
  value: MainFrameCertificateError,
): void {
  mainFrameErrors.set(contents.id, value);
  if (watchedContents.has(contents.id)) return;
  watchedContents.add(contents.id);
  const id = contents.id;
  contents.once("destroyed", () => {
    mainFrameErrors.delete(id);
    watchedContents.delete(id);
  });
}

/** Called after app ready and before page content loads. */
export function initializeCertificateHandling(): void {
  void onPageSessionCreated((target, info) =>
    installVerifyProc(target, info.partition),
  );
  app.on(
    "certificate-error",
    (event, contents, url, error, certificate, callback, isMainFrame) => {
      const info = pageSessionInfoFor(contents.session);
      const host = hostOfUrl(url);
      if (!info || !host) return;
      const name = certificateErrorName(error);
      if (isMainFrame)
        rememberMainFrameError(contents, {
          url,
          host,
          partition: info.partition,
          error: name,
          certificate,
        });
      const key = recordKey(info.partition, host);
      if (exceptions.has(info.partition, host, certificate.fingerprint)) {
        event.preventDefault();
        const wasBypassed = records.peek(key)?.level === "bypassed";
        records.set(key, { level: "bypassed", error: name, certificate });
        callback(true);
        if (!wasBypassed) notify();
        return;
      }
      // Chromium coalesces parallel verifications of one host; a joined request can surface the raw
      // authority error even though the verify proc accepted it through the OS trust store.
      if (
        osTrust.peek(`${host}\n${certificate.fingerprint}`) === true &&
        name === "ERR_CERT_AUTHORITY_INVALID"
      ) {
        event.preventDefault();
        callback(true);
      }
      // Otherwise leave the default (reject): the tab shows the certificate interstitial.
    },
  );
}

/** What the address bar / site-info popover show for a tab's current page. */
export function pageSecurityFor(
  contents: WebContents | null | undefined,
): BrowserPageSecurity | null {
  if (!contents || contents.isDestroyed()) return null;
  const host = hostOfUrl(contents.getURL());
  const info = host ? pageSessionInfoFor(contents.session) : null;
  if (!host || !info) return null;
  const record = records.peek(recordKey(info.partition, host));
  if (!record) return null;
  if (
    record.level === "bypassed" ||
    (record.level === "error" && exceptions.hasHost(info.partition, host))
  )
    return { level: "bypassed", host, error: record.error };
  if (record.level === "error") return null;
  return {
    level: record.level,
    host,
    error: record.level === "os-trusted" ? record.error : null,
  };
}

/** Full certificate info for the viewer and the interstitial's "Advanced" panel. */
export async function certificateInfoFor(
  contents: WebContents | null | undefined,
  tabHasError: boolean,
): Promise<SiteCertificateInfo | null> {
  if (!contents || contents.isDestroyed()) return null;
  const info = pageSessionInfoFor(contents.session);
  if (!info) return null;
  const url = contents.getURL();
  const host = hostOfUrl(url);
  const failure = mainFrameErrors.get(contents.id);
  const showFailure = Boolean(
    failure && tabHasError && (!host || failure.host === host),
  );
  let status: SiteCertificateInfo["status"];
  let error: string | null;
  let certificate: Certificate;
  let pageUrl = url;
  let pageHost = host;
  if (showFailure && failure) {
    status = "error";
    error = failure.error;
    certificate = failure.certificate;
    pageUrl = failure.url;
    pageHost = failure.host;
  } else {
    const record = host
      ? records.peek(recordKey(info.partition, host))
      : undefined;
    if (!record || !host) return null;
    const security = pageSecurityFor(contents);
    status = security?.level ?? "error";
    error = record.error;
    certificate = record.certificate;
  }
  const module = await inspect();
  return {
    host: pageHost ?? "",
    url: pageUrl,
    status,
    error,
    chain: module.certificateChainDetails(certificatePemChain(certificate)),
    canProceed: status === "error" && showFailure,
    nativeViewer: process.platform === "darwin",
  };
}

/**
 * "Proceed to <host> (unsafe)": allow the failing certificate for this host in the tab's session,
 * and return the URL to load again (null when there is nothing to proceed past).
 */
export function proceedPastCertificateError(
  contents: WebContents | null | undefined,
): string | null {
  if (!contents || contents.isDestroyed()) return null;
  const failure = mainFrameErrors.get(contents.id);
  if (!failure) return null;
  exceptions.allow(
    failure.partition,
    failure.host,
    failure.certificate.fingerprint,
  );
  mainFrameErrors.delete(contents.id);
  return failure.url;
}

/** "Show in macOS…": the system certificate sheet for the page's certificate. */
export async function showNativeCertificate(
  contents: WebContents | null | undefined,
  tabHasError: boolean,
): Promise<boolean> {
  if (process.platform !== "darwin" || !contents || contents.isDestroyed())
    return false;
  const info = pageSessionInfoFor(contents.session);
  const failure = mainFrameErrors.get(contents.id);
  const host = hostOfUrl(contents.getURL());
  const certificate =
    tabHasError && failure
      ? failure.certificate
      : info && host
        ? records.peek(recordKey(info.partition, host))?.certificate
        : undefined;
  if (!certificate) return false;
  await dialog.showCertificateTrustDialog({
    certificate,
    message: `Certificate for ${tabHasError && failure ? failure.host : host}`,
  });
  return true;
}

/** A page session ended (last private tab closed) or is being wiped: drop its exceptions and records. */
export function forgetCertificateState(partition: string): void {
  exceptions.clear(partition);
  records.deleteWhere((key) => key.startsWith(`${partition}\n`));
  for (const [id, failure] of mainFrameErrors)
    if (failure.partition === partition) mainFrameErrors.delete(id);
  notify();
}
