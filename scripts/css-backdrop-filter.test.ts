import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { transform } from "lightningcss";

// The production renderer CSS is minified by lightningcss (electron.vite.config.ts, cssMinify).
// Given `backdrop-filter: x; -webkit-backdrop-filter: x;` in one rule, lightningcss keeps only the
// last declaration, the -webkit- one, which Chromium (and so Electron) ignores. That silently
// removed every CSS blur in packaged builds (New Tab sidebar card, popovers, palette, notices).
// Electron never needs the prefix, so the sources carry the unprefixed property only.

const rendererDirectory = resolve(import.meta.dir, "../src/renderer");

function cssFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith(".css") ? [path] : [];
  });
}

const files = cssFiles(rendererDirectory);
const blurring = files.filter((file) =>
  /(^|[^-])backdrop-filter:\s*(?!none)/m.test(readFileSync(file, "utf8")),
);

describe("renderer CSS backdrop-filter survives minification", () => {
  test("there are blurring stylesheets to check", () => {
    expect(blurring.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const name = relative(rendererDirectory, file);
    test(`${name}: no -webkit-backdrop-filter in the source`, () => {
      expect(readFileSync(file, "utf8")).not.toContain(
        "-webkit-backdrop-filter",
      );
    });
  }

  for (const file of blurring) {
    const name = relative(rendererDirectory, file);
    test(`${name}: minified output keeps the unprefixed backdrop-filter blur`, () => {
      const source = readFileSync(file, "utf8");
      const code = transform({
        filename: name,
        code: Buffer.from(source),
        minify: true,
      }).code.toString();
      const sourceBlurs = (
        source.match(/(^|[^-])backdrop-filter:\s*(?!none)[^;]*blur/gm) ?? []
      ).length;
      const outputBlurs = (
        code.match(/(^|[^-])backdrop-filter:(?!none)[^;}]*blur/g) ?? []
      ).length;
      expect(outputBlurs).toBeGreaterThan(0);
      // Minification may merge identical rules, never drop a blur outright.
      expect(outputBlurs).toBeGreaterThanOrEqual(Math.min(sourceBlurs, 1));
      expect(code).not.toMatch(/-webkit-backdrop-filter:(?!none)[^;}]*blur/);
    });
  }
});
