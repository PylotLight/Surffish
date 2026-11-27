import { createHmac } from "node:crypto";

export const BRAMBLE_BIOMETRICS_SECRET_BYTES = 32;
export const BRAMBLE_BIOMETRICS_CREDENTIAL_ID_BYTES = 16;
export const BRAMBLE_BIOMETRICS_MAX_SALT_BYTES = 4096;

export interface StoredBrambleBiometrics {
  v: 1;
  encryptedSecret: string;
}

export type BrambleBiometricsCreateResult =
  | { ok: true; credentialId: string; hmacSecret: string }
  | { ok: false; error: string };

export type BrambleBiometricsGetResult =
  { ok: true; hmacSecret: string } | { ok: false; error: string };

/** Decode and bound-check a base64 PRF salt from Bramble's extension UI. */
export function parseBrambleBiometricsSalt(input: unknown): Buffer | null {
  if (typeof input !== "string" || input.length === 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input) || input.length % 4 !== 0)
    return null;
  const decoded = Buffer.from(input, "base64");
  if (
    decoded.length === 0 ||
    decoded.length > BRAMBLE_BIOMETRICS_MAX_SALT_BYTES
  )
    return null;
  return decoded;
}

/** Derive the deterministic WebAuthn PRF output from the device-bound Keychain secret. */
export function computeBrambleBiometricsHmac(
  secret: Buffer,
  salt: Buffer,
): Buffer {
  return createHmac("sha256", secret).update(salt).digest();
}

export function parseStoredBrambleBiometrics(
  raw: unknown,
): StoredBrambleBiometrics | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (
    record["v"] !== 1 ||
    typeof record["encryptedSecret"] !== "string" ||
    record["encryptedSecret"].length === 0
  )
    return null;
  return { v: 1, encryptedSecret: record["encryptedSecret"] };
}

/**
 * Main-world WebAuthn PRF polyfill for Bramble's extension pages.
 * Delegates platform-authenticator + PRF requests to Surffish's Touch ID + safeStorage bridge.
 */
export const BRAMBLE_BIOMETRICS_POLYFILL_SOURCE = `((biometrics) => {
  if (!biometrics || typeof biometrics.available !== 'function' || globalThis.__brambleBiometricsInstalled) return;
  globalThis.__brambleBiometricsInstalled = true;

  function base64ToUint8(base64) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  function uint8ToBase64(bytes) {
    let bin = '';
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength || bytes.length);
    for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
    return btoa(bin);
  }

  function toUint8Array(val) {
    if (!val) return new Uint8Array(0);
    if (val instanceof Uint8Array) return val;
    if (val instanceof ArrayBuffer) return new Uint8Array(val);
    if (val.buffer instanceof ArrayBuffer) return new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
    return new Uint8Array(val);
  }

  function extractPrfSalt(prf) {
    if (!prf) return null;
    if (prf.eval && prf.eval.first) return toUint8Array(prf.eval.first);
    if (prf.evalByCredential && typeof prf.evalByCredential === 'object') {
      for (const key of Object.keys(prf.evalByCredential)) {
        const entry = prf.evalByCredential[key];
        if (entry && entry.first) return toUint8Array(entry.first);
      }
    }
    return null;
  }

  const PublicKeyCred = globalThis.PublicKeyCredential;
  if (PublicKeyCred) {
    const origIsUvpaa = typeof PublicKeyCred.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
      ? PublicKeyCred.isUserVerifyingPlatformAuthenticatorAvailable.bind(PublicKeyCred)
      : async () => false;
    PublicKeyCred.isUserVerifyingPlatformAuthenticatorAvailable = async () => {
      try {
        if (await biometrics.available()) return true;
      } catch {}
      return origIsUvpaa();
    };
    if (typeof PublicKeyCred.getClientCapabilities === 'function') {
      const origCapabilities = PublicKeyCred.getClientCapabilities.bind(PublicKeyCred);
      PublicKeyCred.getClientCapabilities = async () => {
        try {
          if (await biometrics.available()) {
            return {
              conditionalCreate: true,
              conditionalGet: true,
              hybridTransport: true,
              passkeyPlatformAuthenticator: true,
              userVerifyingPlatformAuthenticator: true,
              relatedOrigins: true
            };
          }
        } catch {}
        return origCapabilities();
      };
    }
  }

  const creds = globalThis.navigator && globalThis.navigator.credentials;
  if (!creds) return;
  const origCreate = typeof creds.create === 'function' ? creds.create.bind(creds) : null;
  const origGet = typeof creds.get === 'function' ? creds.get.bind(creds) : null;

  const customCreate = async function (options) {
    const pubKey = options && options.publicKey;
    const isPlatform = Boolean(
      (pubKey && pubKey.authenticatorSelection && pubKey.authenticatorSelection.authenticatorAttachment === 'platform') ||
      (pubKey && pubKey.extensions && pubKey.extensions.prf != null)
    );
    if (!isPlatform || !(await biometrics.available())) {
      if (origCreate) return origCreate(options);
      throw new DOMException('CredentialsContainer.create unavailable.', 'NotSupportedError');
    }
    const saltBytes = extractPrfSalt(pubKey && pubKey.extensions && pubKey.extensions.prf) ||
      globalThis.crypto.getRandomValues(new Uint8Array(32));
    const res = await biometrics.create(uint8ToBase64(saltBytes));
    if (!res || !res.ok) {
      throw new DOMException((res && res.error) || 'The operation either timed out or was not allowed.', 'NotAllowedError');
    }
    const rawId = base64ToUint8(res.credentialId).buffer;
    const hmac = base64ToUint8(res.hmacSecret).buffer;
    return {
      id: res.credentialId,
      rawId,
      type: 'public-key',
      response: {
        clientDataJSON: new Uint8Array([123, 125]).buffer,
        attestationObject: new Uint8Array([160]).buffer,
        getAuthenticatorData: () => new Uint8Array(37).buffer
      },
      getClientExtensionResults: () => ({
        prf: {
          enabled: true,
          results: { first: hmac }
        }
      })
    };
  };

  const customGet = async function (options) {
    const pubKey = options && options.publicKey;
    const hasPrf = Boolean(pubKey && pubKey.extensions && pubKey.extensions.prf != null);
    if (!hasPrf || !(await biometrics.available())) {
      if (origGet) return origGet(options);
      throw new DOMException('CredentialsContainer.get unavailable.', 'NotSupportedError');
    }
    const saltBytes = extractPrfSalt(pubKey.extensions.prf) || new Uint8Array(32);
    const res = await biometrics.get(uint8ToBase64(saltBytes));
    if (!res || !res.ok) {
      throw new DOMException((res && res.error) || 'Unlock was cancelled or timed out.', 'NotAllowedError');
    }
    const hmac = base64ToUint8(res.hmacSecret).buffer;
    const credId = (pubKey.allowCredentials && pubKey.allowCredentials[0] && pubKey.allowCredentials[0].id) || new Uint8Array(16).buffer;
    return {
      id: typeof credId === 'string' ? credId : 'touchid',
      rawId: credId instanceof ArrayBuffer ? credId : (credId.buffer || new Uint8Array(16).buffer),
      type: 'public-key',
      response: {
        clientDataJSON: new Uint8Array([123, 125]).buffer,
        authenticatorData: new Uint8Array(37).buffer,
        signature: new Uint8Array(64).buffer,
        userHandle: new Uint8Array(16).buffer
      },
      getClientExtensionResults: () => ({
        prf: {
          results: { first: hmac }
        }
      })
    };
  };

  try {
    Object.defineProperty(creds, 'create', { configurable: true, writable: true, value: customCreate });
    Object.defineProperty(creds, 'get', { configurable: true, writable: true, value: customGet });
  } catch {
    creds.create = customCreate;
    creds.get = customGet;
  }
})`;
