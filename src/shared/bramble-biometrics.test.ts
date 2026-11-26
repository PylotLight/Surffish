import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import {
  BRAMBLE_BIOMETRICS_POLYFILL_SOURCE,
  computeBrambleBiometricsHmac,
  parseBrambleBiometricsSalt,
  parseStoredBrambleBiometrics,
} from "./bramble-biometrics";

test("parseBrambleBiometricsSalt validates base64 and bounds", () => {
  const valid = Buffer.from("hello-bramble-salt").toString("base64");
  expect(parseBrambleBiometricsSalt(valid)?.toString()).toBe(
    "hello-bramble-salt",
  );
  expect(parseBrambleBiometricsSalt("")).toBeNull();
  expect(parseBrambleBiometricsSalt(123)).toBeNull();
  expect(parseBrambleBiometricsSalt("not!base64")).toBeNull();
  const oversized = Buffer.alloc(4097, 1).toString("base64");
  expect(parseBrambleBiometricsSalt(oversized)).toBeNull();
});

test("computeBrambleBiometricsHmac is deterministic per secret and salt", () => {
  const secret = Buffer.alloc(32, 0xaa);
  const saltA = Buffer.from("salt-a");
  const saltB = Buffer.from("salt-b");
  const h1 = computeBrambleBiometricsHmac(secret, saltA);
  const h2 = computeBrambleBiometricsHmac(secret, saltA);
  const h3 = computeBrambleBiometricsHmac(secret, saltB);
  expect(h1.length).toBe(32);
  expect(h1.equals(h2)).toBe(true);
  expect(h1.equals(h3)).toBe(false);
});

test("parseStoredBrambleBiometrics validates schema", () => {
  expect(
    parseStoredBrambleBiometrics({ v: 1, encryptedSecret: "abc==" }),
  ).toEqual({ v: 1, encryptedSecret: "abc==" });
  expect(
    parseStoredBrambleBiometrics({ v: 2, encryptedSecret: "abc" }),
  ).toBeNull();
  expect(
    parseStoredBrambleBiometrics({ v: 1, encryptedSecret: "" }),
  ).toBeNull();
  expect(parseStoredBrambleBiometrics(null)).toBeNull();
});

test("WebAuthn PRF polyfill handles create, get (eval & evalByCredential), and fallback", async () => {
  let available = true;
  let lastAction = "";
  let lastSalt = "";
  const origCreate = async () => ({ id: "orig-create" });
  const origGet = async () => ({ id: "orig-get" });

  class FakeDOMException extends Error {
    constructor(message: string, name: string) {
      super(message);
      this.name = name;
    }
  }

  const context: Record<string, unknown> = {
    atob: (b64: string) => Buffer.from(b64, "base64").toString("binary"),
    btoa: (bin: string) => Buffer.from(bin, "binary").toString("base64"),
    crypto: {
      getRandomValues: (arr: Uint8Array) => arr.fill(7),
    },
    DOMException: FakeDOMException,
    PublicKeyCredential: {
      isUserVerifyingPlatformAuthenticatorAvailable: async () => false,
      getClientCapabilities: async () => ({
        userVerifyingPlatformAuthenticator: false,
      }),
    },
    navigator: {
      credentials: {
        create: origCreate,
        get: origGet,
      },
    },
  };

  const biometrics = {
    available: async () => available,
    create: async (salt: string) => {
      lastAction = "create";
      lastSalt = salt;
      return {
        ok: true,
        credentialId: Buffer.from("cred-id-123").toString("base64"),
        hmacSecret: Buffer.alloc(32, 9).toString("base64"),
      };
    },
    get: async (salt: string) => {
      lastAction = "get";
      lastSalt = salt;
      return {
        ok: true,
        hmacSecret: Buffer.alloc(32, 5).toString("base64"),
      };
    },
  };

  const installer = runInNewContext(
    `(${BRAMBLE_BIOMETRICS_POLYFILL_SOURCE})`,
    context,
  ) as (b: typeof biometrics) => void;
  installer(biometrics);

  const pkc = context["PublicKeyCredential"] as {
    isUserVerifyingPlatformAuthenticatorAvailable: () => Promise<boolean>;
    getClientCapabilities: () => Promise<Record<string, boolean>>;
  };
  const creds = (
    context["navigator"] as {
      credentials: {
        create: (opts: unknown) => Promise<Record<string, unknown>>;
        get: (opts: unknown) => Promise<Record<string, unknown>>;
      };
    }
  ).credentials;

  expect(await pkc.isUserVerifyingPlatformAuthenticatorAvailable()).toBe(true);
  expect(
    (await pkc.getClientCapabilities())["userVerifyingPlatformAuthenticator"],
  ).toBe(true);

  const salt = new Uint8Array([1, 2, 3, 4]);
  const created = await creds.create({
    publicKey: {
      authenticatorSelection: { authenticatorAttachment: "platform" },
      extensions: { prf: { eval: { first: salt } } },
    },
  });
  expect(lastAction).toBe("create");
  expect(lastSalt).toBe(Buffer.from(salt).toString("base64"));
  const createExt = (
    created["getClientExtensionResults"] as () => {
      prf: { enabled: boolean; results: { first: ArrayBuffer } };
    }
  )();
  expect(createExt.prf.enabled).toBe(true);
  expect(new Uint8Array(createExt.prf.results.first)[0]).toBe(9);

  const got = await creds.get({
    publicKey: {
      extensions: {
        prf: { evalByCredential: { "cred-1": { first: salt } } },
      },
    },
  });
  expect(lastAction).toBe("get");
  expect(lastSalt).toBe(Buffer.from(salt).toString("base64"));
  const getExt = (
    got["getClientExtensionResults"] as () => {
      prf: { results: { first: ArrayBuffer } };
    }
  )();
  expect(new Uint8Array(getExt.prf.results.first)[0]).toBe(5);

  available = false;
  expect(await pkc.isUserVerifyingPlatformAuthenticatorAvailable()).toBe(false);
  expect(
    await creds.create({
      publicKey: { extensions: { prf: { eval: { first: salt } } } },
    }),
  ).toEqual({ id: "orig-create" });
  expect(
    await creds.get({
      publicKey: { extensions: { prf: { eval: { first: salt } } } },
    }),
  ).toEqual({ id: "orig-get" });
});
