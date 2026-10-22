import { describe, expect, test } from "bun:test";
import {
  parseWakeSnapshotManifest,
  planWakeSnapshotDisk,
  serializeWakeSnapshotManifest,
  WAKE_SNAPSHOT_DISK_MAX_AGE_MS,
  WAKE_SNAPSHOT_DISK_VERSION,
  wakeSnapshotUrlKey,
  type WakeSnapshotDiskEntry,
} from "./wake-snapshot-disk";

const key = (n: number): string => n.toString(16).padStart(32, "0");
const entry = (
  n: number,
  savedAt: number,
  bytes = 100,
  url = `https://site${n}.test/page`,
): WakeSnapshotDiskEntry => ({
  key: key(n),
  url,
  width: 1200,
  height: 800,
  bytes,
  savedAt,
});

describe("wakeSnapshotUrlKey", () => {
  test("drops the fragment, keeps the query", () => {
    expect(wakeSnapshotUrlKey("https://a.test/x?q=1#top")).toBe(
      "https://a.test/x?q=1",
    );
    expect(wakeSnapshotUrlKey("https://a.test/x#a")).toBe(
      wakeSnapshotUrlKey("https://a.test/x#b"),
    );
  });
  test("only http(s) pages", () => {
    expect(wakeSnapshotUrlKey("file:///etc/passwd")).toBeNull();
    expect(wakeSnapshotUrlKey("surffish://settings")).toBeNull();
    expect(wakeSnapshotUrlKey("not a url")).toBeNull();
  });
});

describe("manifest", () => {
  test("round-trips, newest first", () => {
    const entries = [entry(1, 10), entry(2, 30), entry(3, 20)];
    const parsed = parseWakeSnapshotManifest(
      JSON.parse(JSON.stringify(serializeWakeSnapshotManifest(entries))),
    );
    expect(parsed.map((e) => e.savedAt)).toEqual([30, 20, 10]);
  });
  test("malformed, other versions and bad keys read as nothing", () => {
    expect(parseWakeSnapshotManifest(null)).toEqual([]);
    expect(
      parseWakeSnapshotManifest({
        version: WAKE_SNAPSHOT_DISK_VERSION + 1,
        entries: [entry(1, 1)],
      }),
    ).toEqual([]);
    const bad = [
      { ...entry(1, 1), key: "../../evil" },
      { ...entry(2, 1), url: "file:///x" },
      { ...entry(3, 1), bytes: 0 },
      entry(4, 1),
      entry(4, 2),
    ];
    expect(
      parseWakeSnapshotManifest({
        version: WAKE_SNAPSHOT_DISK_VERSION,
        entries: bad,
      }).map((e) => e.key),
    ).toEqual([key(4)]);
  });
});

describe("planWakeSnapshotDisk", () => {
  const now = 1_000_000_000_000;
  test("keeps the newest within the byte cap", () => {
    const { keep, drop } = planWakeSnapshotDisk(
      [entry(1, now - 3), entry(2, now - 1), entry(3, now - 2)],
      { now, maxTotalBytes: 250 },
    );
    expect(keep.map((e) => e.key)).toEqual([key(2), key(3)]);
    expect(drop.map((e) => e.key)).toEqual([key(1)]);
  });
  test("drops expired and future pictures", () => {
    const { keep, drop } = planWakeSnapshotDisk(
      [
        entry(1, now - WAKE_SNAPSHOT_DISK_MAX_AGE_MS - 1),
        entry(2, now + 10 * 60_000),
        entry(3, now),
      ],
      { now },
    );
    expect(keep.map((e) => e.key)).toEqual([key(3)]);
    expect(drop).toHaveLength(2);
  });
  test("only the pages asked for", () => {
    const { keep, drop } = planWakeSnapshotDisk(
      [entry(1, now), entry(2, now)],
      { now, keepKeys: new Set([key(1)]) },
    );
    expect(keep.map((e) => e.key)).toEqual([key(1)]);
    expect(drop.map((e) => e.key)).toEqual([key(2)]);
  });
});
