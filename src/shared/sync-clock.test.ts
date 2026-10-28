import assert from "node:assert/strict";
import test from "node:test";
import {
  HybridLogicalClock,
  compareHlc,
  formatHlc,
  isUuid,
  parseHlc,
  uuidv7,
} from "./sync-clock.ts";

test("uuidv7 is a valid v7 UUID that sorts by time", () => {
  const a = uuidv7(1_700_000_000_000);
  const b = uuidv7(1_700_000_000_001);
  assert.ok(isUuid(a));
  assert.equal(a[14], "7");
  assert.ok("89ab".includes(a[19]!));
  assert.ok(a < b);
  assert.equal(a.slice(0, 13), "018bcfe5-6800");
});

test("hlc stamps are fixed width, parse back, and compare as strings", () => {
  const stamp = formatHlc({ wall: 5, counter: 255, deviceId: "dev" });
  assert.equal(stamp, "0000000000005:00ff:dev");
  assert.deepEqual(parseHlc(stamp), { wall: 5, counter: 255, deviceId: "dev" });
  assert.equal(parseHlc("nope"), null);
  assert.equal(compareHlc("0000000000005:0000:a", "0000000000005:0001:a"), -1);
  assert.equal(compareHlc("0000000000006:0000:a", "0000000000005:ffff:z"), 1);
});

test("clock is monotonic when the wall clock stalls or goes backwards", () => {
  let now = 1000;
  const clock = new HybridLogicalClock("dev", () => now);
  const first = clock.tick();
  const second = clock.tick();
  now = 900;
  const third = clock.tick();
  assert.ok(first < second && second < third);
  assert.equal(parseHlc(third)!.wall, 1000);
  now = 2000;
  assert.equal(parseHlc(clock.tick())!.counter, 0);
});

test("clock follows a remote stamp ahead of it, ignores absurd drift, and resumes from a saved stamp", () => {
  const now = 1000;
  const clock = new HybridLogicalClock("a", () => now);
  assert.equal(
    clock.receive(formatHlc({ wall: 5000, counter: 3, deviceId: "b" })),
    true,
  );
  const after = parseHlc(clock.tick())!;
  assert.deepEqual([after.wall, after.counter, after.deviceId], [5000, 4, "a"]);
  assert.equal(
    clock.receive(
      formatHlc({
        wall: now + 3 * 24 * 3600 * 1000,
        counter: 0,
        deviceId: "b",
      }),
    ),
    false,
  );
  const resumed = new HybridLogicalClock("a", () => 10, clock.last());
  assert.ok(resumed.tick() > clock.last());
});

test("clock advances past a higher remote counter on the same wall time", () => {
  const clock = new HybridLogicalClock("local", () => 1000);
  assert.equal(
    clock.receive(formatHlc({ wall: 1000, counter: 8, deviceId: "remote" })),
    true,
  );

  const next = parseHlc(clock.tick());
  assert.deepEqual(next, { wall: 1000, counter: 9, deviceId: "local" });

  // Receiving an older counter at the same wall time must not move the clock back.
  assert.equal(
    clock.receive(formatHlc({ wall: 1000, counter: 4, deviceId: "other" })),
    true,
  );
  assert.deepEqual(parseHlc(clock.tick()), {
    wall: 1000,
    counter: 10,
    deviceId: "local",
  });
});

test("counter exhaustion borrows the next wall millisecond", () => {
  const clock = new HybridLogicalClock(
    "local",
    () => 1000,
    formatHlc({ wall: 1000, counter: 0xffff, deviceId: "local" }),
  );

  assert.deepEqual(parseHlc(clock.tick()), {
    wall: 1001,
    counter: 0,
    deviceId: "local",
  });
});
