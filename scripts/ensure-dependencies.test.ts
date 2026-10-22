import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ensureDependencies } from "./ensure-dependencies.ts";

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), "surffish-dependency-check-"));
  writeFileSync(join(root, ".bun-version"), "1.4.3\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { react: "^19.0.0" } }),
  );
  writeFileSync(join(root, "bun.lock"), "initial lockfile\n");
  return root;
}

test("installs only when dependency inputs change", (t) => {
  const root = makeProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  let installs = 0;
  const install = () => {
    installs += 1;
    return true;
  };
  const quiet = () => {};

  assert.equal(ensureDependencies(root, install, quiet), true);
  assert.equal(installs, 1);
  assert.equal(ensureDependencies(root, install, quiet), true);
  assert.equal(installs, 1);

  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ dependencies: { react: "^19.1.0" } }),
  );
  assert.equal(ensureDependencies(root, install, quiet), true);
  assert.equal(installs, 2);
  assert.equal(ensureDependencies(root, install, quiet), true);
  assert.equal(installs, 2);

  writeFileSync(join(root, "bun.lock"), "updated lockfile\n");
  assert.equal(ensureDependencies(root, install, quiet), true);
  assert.equal(installs, 3);
  assert.match(
    readFileSync(
      join(root, "node_modules", ".surffish-dependency-state"),
      "utf8",
    ),
    /^[a-f0-9]{64}\n$/,
  );
});

test("does not cache a failed install, so the next dev run retries", (t) => {
  const root = makeProject();
  t.after(() => rmSync(root, { recursive: true, force: true }));

  assert.equal(
    ensureDependencies(
      root,
      () => false,
      () => {},
    ),
    false,
  );
  assert.equal(
    ensureDependencies(
      root,
      () => true,
      () => {},
    ),
    true,
  );
  assert.equal(
    ensureDependencies(
      root,
      () => {
        assert.fail(
          "a successful install should have cached the current dependency state",
        );
      },
      () => {},
    ),
    true,
  );
});
