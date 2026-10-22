import { assignPositions } from "../../shared/fractional-index";
import type { SpacesSettings } from "../../shared/spaces";
import type { SurffishDatabase } from "./database";
import { RowMirror, type DesiredRow } from "./row-mirror";

/**
 * Spaces (browser-spaces.json) in surffish.db: one `spaces` row per Space (keyed by its id, so
 * `default` is the same row on every device), ordered by a fractional-index `position`, plus the
 * "Enable Spaces" switch as the `spaces.enabled` settings row. Renaming or reordering a Space writes
 * one row. A deleted Space is tombstoned with its name, icon and proxy blanked.
 *
 * Returned in the browser-spaces.json shape so parseSpacesSettings validates it the same way.
 */

const SAVED_KEY = "store:spaces:saved_at";
const ENABLED_KEY = "spaces.enabled";

export class SpacesTable {
  private readonly spaces: RowMirror;
  private readonly enabled: RowMirror;

  constructor(private readonly db: SurffishDatabase) {
    this.spaces = new RowMirror(db, {
      table: "spaces",
      columns: [
        "name",
        "icon",
        "color",
        "position",
        "separate_storage",
        "proxy",
        "extra",
      ],
      blankOnDelete: { name: "", icon: null, proxy: null },
    });
    this.enabled = new RowMirror(db, {
      table: "settings",
      columns: ["value", "scope"],
      owns: (key) => key === ENABLED_KEY,
    });
  }

  hasSavedCopy(): boolean {
    return this.db.getMeta(SAVED_KEY) !== null;
  }

  load(): Record<string, unknown> | null {
    if (!this.hasSavedCopy()) return null;
    const rows = this.spaces.loadLive().sort((a, b) => {
      const left = String(a.values.position);
      const right = String(b.values.position);
      return left < right
        ? -1
        : left > right
          ? 1
          : a.key < b.key
            ? -1
            : a.key > b.key
              ? 1
              : 0;
    });
    const enabled = this.enabled.loadLive()[0]?.values.value === "true";
    return {
      version: 1,
      enabled,
      spaces: rows.map((row) => {
        let proxy: unknown = "inherit";
        try {
          proxy = row.values.proxy
            ? JSON.parse(String(row.values.proxy))
            : "inherit";
        } catch {
          /* parse falls back to inherit */
        }
        return {
          id: row.key,
          name: row.values.name,
          icon: row.values.icon ?? "",
          color: row.values.color,
          partitioned: row.values.separate_storage === 1,
          proxy,
        };
      }),
    };
  }

  save(settings: SpacesSettings): { upserted: number; tombstoned: number } {
    const ids = settings.spaces.map((space) => space.id);
    const previous = new Map<string, string>();
    for (const id of ids) {
      const position = this.spaces.current(id)?.position;
      if (typeof position === "string") previous.set(id, position);
    }
    const positions = assignPositions(ids, previous);
    const desired = new Map<string, DesiredRow>(
      settings.spaces.map((space) => [
        space.id,
        {
          values: {
            name: space.name,
            icon: space.icon || null,
            color: space.color,
            position: positions.get(space.id)!,
            separate_storage: space.partitioned ? 1 : 0,
            proxy: JSON.stringify(space.proxy),
            extra: null,
          },
        },
      ]),
    );
    try {
      return this.db.transaction(() => {
        const spaces = this.spaces.sync(desired);
        const enabled = this.enabled.sync(
          new Map([
            [
              ENABLED_KEY,
              {
                values: {
                  value: settings.enabled ? "true" : "false",
                  scope: "synced",
                },
              },
            ],
          ]),
        );
        if (!this.hasSavedCopy())
          this.db.setMeta(SAVED_KEY, String(Date.now()));
        return {
          upserted: spaces.upserted + enabled.upserted,
          tombstoned: spaces.tombstoned,
        };
      });
    } catch (error) {
      this.spaces.reset();
      this.enabled.reset();
      throw error;
    }
  }
}
