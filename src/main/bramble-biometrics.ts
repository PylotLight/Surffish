import { app, safeStorage, systemPreferences } from "electron";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BRAMBLE_BIOMETRICS_CREDENTIAL_ID_BYTES,
  BRAMBLE_BIOMETRICS_SECRET_BYTES,
  computeBrambleBiometricsHmac,
  parseBrambleBiometricsSalt,
  parseStoredBrambleBiometrics,
  type BrambleBiometricsCreateResult,
  type BrambleBiometricsGetResult,
} from "../shared/bramble-biometrics";
import { writeJsonAtomic } from "./extension-staging";

const BIOMETRICS_FILE = "bramble-biometrics.json";

function storagePath(): string {
  return join(app.getPath("userData"), BIOMETRICS_FILE);
}

export async function isBrambleBiometricsAvailable(): Promise<boolean> {
  if (process.platform !== "darwin" || !systemPreferences.canPromptTouchID())
    return false;
  try {
    return await safeStorage.isAsyncEncryptionAvailable();
  } catch {
    return false;
  }
}

async function readDeviceSecret(): Promise<Buffer | null> {
  try {
    const raw = JSON.parse(readFileSync(storagePath(), "utf8")) as unknown;
    const parsed = parseStoredBrambleBiometrics(raw);
    if (!parsed) return null;
    const { result } = await safeStorage.decryptStringAsync(
      Buffer.from(parsed.encryptedSecret, "base64"),
    );
    const secret = Buffer.from(result, "base64");
    return secret.length === BRAMBLE_BIOMETRICS_SECRET_BYTES ? secret : null;
  } catch {
    return null;
  }
}

async function getOrCreateDeviceSecret(): Promise<Buffer> {
  const existing = await readDeviceSecret();
  if (existing) return existing;
  const secret = randomBytes(BRAMBLE_BIOMETRICS_SECRET_BYTES);
  const encrypted = (
    await safeStorage.encryptStringAsync(secret.toString("base64"))
  ).toString("base64");
  writeJsonAtomic(storagePath(), { v: 1, encryptedSecret: encrypted });
  return secret;
}

async function promptTouchId(
  reason: string,
  setBlurHold?: (hold: boolean) => void,
): Promise<boolean> {
  setBlurHold?.(true);
  try {
    await systemPreferences.promptTouchID(reason);
    return true;
  } catch {
    return false;
  } finally {
    setBlurHold?.(false);
  }
}

export async function createBrambleBiometricsCredential(
  saltInput: unknown,
  setBlurHold?: (hold: boolean) => void,
): Promise<BrambleBiometricsCreateResult> {
  if (!(await isBrambleBiometricsAvailable())) {
    return { ok: false, error: "Touch ID is not available." };
  }
  const salt = parseBrambleBiometricsSalt(saltInput);
  if (!salt) return { ok: false, error: "Invalid PRF salt." };

  const verified = await promptTouchId(
    "register Touch ID for Bramble Vault",
    setBlurHold,
  );
  if (!verified) {
    return { ok: false, error: "Touch ID registration was cancelled." };
  }

  const secret = await getOrCreateDeviceSecret();
  const hmac = computeBrambleBiometricsHmac(secret, salt);
  const credentialId = randomBytes(BRAMBLE_BIOMETRICS_CREDENTIAL_ID_BYTES);
  return {
    ok: true,
    credentialId: credentialId.toString("base64"),
    hmacSecret: hmac.toString("base64"),
  };
}

export async function getBrambleBiometricsAssertion(
  saltInput: unknown,
  setBlurHold?: (hold: boolean) => void,
): Promise<BrambleBiometricsGetResult> {
  if (!(await isBrambleBiometricsAvailable())) {
    return { ok: false, error: "Touch ID is not available." };
  }
  const salt = parseBrambleBiometricsSalt(saltInput);
  if (!salt) return { ok: false, error: "Invalid PRF salt." };

  const secret = await readDeviceSecret();
  if (!secret) {
    return { ok: false, error: "No Touch ID secret is stored for Bramble." };
  }

  const verified = await promptTouchId(
    "unlock Bramble Vault with Touch ID",
    setBlurHold,
  );
  if (!verified) {
    return { ok: false, error: "Touch ID unlock was cancelled." };
  }

  const hmac = computeBrambleBiometricsHmac(secret, salt);
  return {
    ok: true,
    hmacSecret: hmac.toString("base64"),
  };
}
