import { randomUUID } from "node:crypto";
import { safeStorage } from "electron";
import {
  addSavedSignature,
  parseSavedSignatures,
  sanitizeNewSignature,
  type SavedSignature,
} from "../shared/pdf-signatures";
import { readUserJson, writeUserJson } from "./user-json";

/**
 * Saved PDF signatures / initials (pdf-signatures.json in userData, 0600). The whole list is one
 * safeStorage-encrypted blob (OS keychain / DPAPI / libsecret), like weather-keys.json. Without OS
 * encryption nothing is written: signatures then last only for this run (the editor says so), since a
 * signature in plain text on disk is worse than retyping it.
 */
const FILE = "pdf-signatures.json";

let cache: SavedSignature[] | null = null;
let memoryOnly = false;

async function encryptionAvailable(): Promise<boolean> {
  try {
    return await safeStorage.isAsyncEncryptionAvailable();
  } catch {
    return false;
  }
}

async function load(): Promise<SavedSignature[]> {
  if (cache) return cache;
  const stored = readUserJson(FILE) as {
    encrypted?: unknown;
    value?: unknown;
  } | null;
  let list: SavedSignature[] = [];
  if (stored && stored.encrypted === true && typeof stored.value === "string") {
    try {
      const { result } = await safeStorage.decryptStringAsync(
        Buffer.from(stored.value, "base64"),
      );
      list = parseSavedSignatures(JSON.parse(result));
    } catch {
      // Keychain changed (new machine, reset profile): the saved signatures are unreadable; start over.
      list = [];
    }
  }
  cache = list;
  return list;
}

async function persist(list: SavedSignature[]): Promise<void> {
  cache = list;
  if (!(await encryptionAvailable())) {
    memoryOnly = true;
    return;
  }
  memoryOnly = false;
  const encrypted = await safeStorage.encryptStringAsync(
    JSON.stringify({ signatures: list }),
  );
  writeUserJson(FILE, {
    version: 1,
    encrypted: true,
    value: encrypted.toString("base64"),
  });
}

export interface SavedSignaturesResult {
  signatures: SavedSignature[];
  /** False when the OS offers no encryption, so saved signatures last only until quit. */
  persistent: boolean;
}

export async function listSavedSignatures(): Promise<SavedSignaturesResult> {
  const signatures = await load();
  return {
    signatures,
    persistent: !memoryOnly && (await encryptionAvailable()),
  };
}

export async function addSignature(
  value: unknown,
): Promise<SavedSignaturesResult> {
  const clean = sanitizeNewSignature(value);
  if (!clean) throw new Error("That signature could not be saved.");
  const list = addSavedSignature(await load(), {
    id: randomUUID(),
    createdAt: Date.now(),
    ...clean,
  });
  await persist(list);
  return listSavedSignatures();
}

export async function removeSignature(
  id: unknown,
): Promise<SavedSignaturesResult> {
  if (typeof id !== "string") throw new Error("Unknown signature.");
  const list = (await load()).filter((entry) => entry.id !== id);
  await persist(list);
  return listSavedSignatures();
}
