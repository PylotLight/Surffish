import { app } from "electron";
import { join } from "node:path";
import type { BrowserPreferences } from "../shared/persistence";
import { cancelDeferredWrite, deferWrite } from "./deferred-writes";
import { getProfileDatabase, reportStoreWriteError } from "./store";
import { databaseCopyIsCurrent, settleDualWrite } from "./store/legacy-json";
import { PreferencesTable } from "./store/preferences-store";

/**
 * Where browser preferences are read from and written to (browser-persistence.ts keeps the model).
 *
 * - Startup reads surffish.db (`settings`, store/preferences-store.ts) when it has a saved copy and
 *   browser-preferences.json is gone or unchanged since Surffish wrote it. Otherwise the JSON wins
 *   (a `SURFFISH_STORE=json` run or an older build changed it) and is imported ~1.5 s later.
 * - A change writes the changed rows to the database right away (as the JSON write was), and
 *   browser-preferences.json follows at most every 30 s and at quit as the fallback/downgrade copy.
 * - Privacy deletes (Forget this site, Clear browsing data → permissions/zoom) hard-delete the
 *   per-site rows, rewrite the JSON copy immediately and truncate the WAL.
 * - No database (or a failed write): browser-preferences.json only, written immediately, as before.
 */

const PREFERENCES_FILE = "browser-preferences.json";
const JSON_MIRROR_DELAY_MS = 30_000;

let table: PreferencesTable | null | undefined;

function sqlTable(): PreferencesTable | null {
  if (table !== undefined) return table;
  const db = getProfileDatabase();
  table = db ? new PreferencesTable(db) : null;
  return table;
}

function preferencesPath(): string {
  return join(app.getPath("userData"), PREFERENCES_FILE);
}

function saveToDatabase(preferences: BrowserPreferences): boolean {
  const target = sqlTable();
  if (!target) return false;
  try {
    target.save(preferences);
    return true;
  } catch (error) {
    reportStoreWriteError(
      "Could not save preferences to the database (browser-preferences.json still has them):",
      error,
    );
    table = null;
    return false;
  }
}

/** The raw preferences to parse: the database copy when current, else the JSON file (imported later). */
export function loadPreferencesSource(
  readJsonFile: () => unknown,
  current: () => BrowserPreferences,
): unknown {
  const db = getProfileDatabase();
  const target = sqlTable();
  if (db && target) {
    try {
      if (
        databaseCopyIsCurrent(
          db,
          PREFERENCES_FILE,
          preferencesPath(),
          target.hasSavedCopy(),
        )
      ) {
        const saved = target.load();
        if (saved) return saved;
      }
    } catch (error) {
      console.error(
        "Could not read preferences from the database; using browser-preferences.json:",
        error,
      );
    }
  }
  const raw = readJsonFile();
  if (sqlTable()) {
    deferWrite(
      "preferences-import",
      () => {
        const saved = saveToDatabase(current());
        // The file holds what was just read, so it matches the database now.
        settleDualWrite(
          getProfileDatabase(),
          PREFERENCES_FILE,
          preferencesPath(),
          saved,
          saved,
        );
      },
      1500,
    );
  }
  return raw;
}

/** Persist the current preferences to the database now and the JSON copy now or on the slow timer. */
export function savePreferencesCopies(
  current: () => BrowserPreferences,
  writeJsonFile: () => boolean,
  privacy: boolean,
): void {
  if (!sqlTable()) {
    writeJsonFile();
    return;
  }
  cancelDeferredWrite("preferences-import");
  const db = getProfileDatabase();
  if (!saveToDatabase(current())) {
    // The database just failed: the JSON file is the only copy again, so write it now.
    cancelDeferredWrite("preferences:json");
    settleDualWrite(db, PREFERENCES_FILE, preferencesPath(), false, false);
    writeJsonFile();
    return;
  }
  const writeBoth = (): void => {
    const jsonSaved = writeJsonFile();
    const hadTable = sqlTable() !== null;
    const databaseSaved = saveToDatabase(current());
    if (hadTable)
      settleDualWrite(
        getProfileDatabase(),
        PREFERENCES_FILE,
        preferencesPath(),
        databaseSaved,
        jsonSaved,
      );
  };
  if (privacy) {
    cancelDeferredWrite("preferences:json");
    writeBoth();
    sqlTable()?.checkpoint();
    return;
  }
  deferWrite("preferences:json", writeBoth, JSON_MIRROR_DELAY_MS);
}
