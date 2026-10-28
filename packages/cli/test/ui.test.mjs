import { describe, expect, test } from "bun:test";
import {
  createUI,
  detectMode,
  progressLine,
  rotationLines,
} from "../lib/ui.mjs";

const sink = (isTTY) => {
  const out = {
    chunks: [],
    isTTY,
    columns: 100,
    write(s) {
      out.chunks.push(s);
      return true;
    },
  };
  return out;
};
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[`);

describe("mode detection", () => {
  test("TTY is interactive with colour", () => {
    expect(detectMode({ isTTY: true }, {})).toEqual({
      interactive: true,
      color: true,
    });
  });
  test("NO_COLOR keeps the bar but drops colour", () => {
    expect(detectMode({ isTTY: true }, { NO_COLOR: "" })).toEqual({
      interactive: true,
      color: false,
    });
  });
  test("CI, dumb terminals and pipes are plain", () => {
    expect(detectMode({ isTTY: true }, { CI: "true" }).interactive).toBe(false);
    expect(detectMode({ isTTY: true }, { TERM: "dumb" }).interactive).toBe(
      false,
    );
    expect(detectMode({ isTTY: false }, {}).interactive).toBe(false);
  });
});

describe("non-TTY output", () => {
  test("plain lines, no ANSI, progress every 10%", () => {
    const out = sink(false);
    let t = 0;
    const ui = createUI({ stream: out, env: {}, now: () => t });
    ui.header("Surffish v0.1.22");
    const bar = ui.progress({
      rotation: ["a", "b"],
      label: "downloading https://x/y.zip",
    });
    for (let i = 1; i <= 100; i++) {
      t += 50;
      bar.update(i * 1024 * 1024, 100 * 1024 * 1024);
    }
    bar.done();
    ui.step("downloaded 100.0 MB");
    ui.spinner("unpacking")();
    ui.next("launching Surffish");
    ui.restore();
    const text = out.chunks.join("");
    expect(text).not.toMatch(ANSI);
    expect(text).not.toContain("\r");
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe("Surffish v0.1.22");
    expect(lines[1]).toBe("downloading https://x/y.zip");
    expect(lines.filter((l) => l.startsWith("download ")).length).toBe(10);
    expect(lines).toContain("download 50% (50.0 MB / 100.0 MB)");
    expect(lines).toContain("ok: downloaded 100.0 MB");
    expect(lines).toContain("unpacking...");
    expect(lines.at(-1)).toBe("-> launching Surffish");
  });
  test("CI on a TTY is still plain", () => {
    const out = sink(true);
    createUI({ stream: out, env: { CI: "1" } }).step("x");
    expect(out.chunks.join("")).toBe("ok: x\n");
  });
});

describe("interactive output", () => {
  test("draws in place, rotates, and restores the cursor", () => {
    const out = sink(true);
    let t = 0;
    const ui = createUI({ stream: out, env: {}, now: () => t, rotateMs: 1e9 });
    const bar = ui.progress({ rotation: ["Fetching Surffish"], label: "" });
    t += 1000;
    bar.update(50 * 1024 * 1024, 100 * 1024 * 1024);
    bar.done();
    ui.step("downloaded");
    ui.restore();
    const text = out.chunks.join("");
    expect(text).toContain("\x1b[?25l");
    expect(text).toContain("\x1b[?25h");
    expect(text).toContain("Fetching Surffish");
    expect(text).toContain(" 50%");
    expect(text).toContain("✓");
  });
  test("long rotating lines are clipped, never wrapped", () => {
    const out = sink(true);
    out.columns = 50;
    const ui = createUI({ stream: out, env: { NO_COLOR: "1" }, rotateMs: 1e9 });
    ui.progress({ rotation: ["x".repeat(200)], label: "" }).done();
    const tipLine = out.chunks
      .join("")
      .split(/[\r\n]/)
      .find((l) => l.includes("› "));
    expect(
      tipLine.replace(
        new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g"),
        "",
      ).length,
    ).toBeLessThanOrEqual(50);
    expect(tipLine).toContain("…");
  });
});

describe("progress line", () => {
  test("percent, sizes, speed and ETA", () => {
    const { stats, pct, bar } = progressLine({
      received: 60 * 1048576,
      total: 120 * 1048576,
      elapsedMs: 5000,
    });
    expect(pct).toBe(50);
    expect(stats).toBe(" 50%  60.0 MB / 120.0 MB  12.0 MB/s  ETA 5s");
    expect(bar).toMatch(/^█+░+$/);
  });
  test("unknown size", () => {
    expect(
      progressLine({ received: 2 * 1048576, total: NaN, elapsedMs: 1000 })
        .stats,
    ).toBe("2.0 MB  2.0 MB/s");
  });
  test("rotation interleaves explainers and tips", () => {
    expect(rotationLines(["e0", "e1", "e2"], ["t0"])).toEqual([
      "e0",
      "t0",
      "e1",
      "e2",
    ]);
  });
});
