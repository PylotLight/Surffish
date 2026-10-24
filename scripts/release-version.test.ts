import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dependencyDifferences,
  draftReleaseNotes,
  isPrereleaseVersion,
  latestVersionTag,
  plistString,
  resolveFromTagVersion,
  resolveReleaseVersion,
  setPackageVersion,
} from "./release-version.ts";

test("bumps patch, minor and major from the latest tag", () => {
  assert.equal(resolveReleaseVersion("patch", "0.1.1", "v0.1.1"), "0.1.2");
  assert.equal(resolveReleaseVersion("minor", "0.1.1", "v0.1.1"), "0.2.0");
  assert.equal(resolveReleaseVersion("major", "0.1.1", "v0.1.1"), "1.0.0");
});

test("bumps from whichever of package.json and the tag is newer", () => {
  assert.equal(resolveReleaseVersion("patch", "0.1.0", "v0.1.3"), "0.1.4");
  assert.equal(resolveReleaseVersion("patch", "0.2.0", "v0.1.3"), "0.2.1");
  assert.equal(resolveReleaseVersion("patch", "0.1.0", null), "0.1.1");
});

test("current re-uses an untagged package.json version", () => {
  assert.equal(resolveReleaseVersion("current", "0.1.2", "v0.1.1"), "0.1.2");
  assert.throws(
    () => resolveReleaseVersion("current", "0.1.1", "v0.1.1"),
    /isn't newer/,
  );
});

test("explicit versions must be newer than the latest tag and plain semver", () => {
  assert.equal(resolveReleaseVersion("0.3.0", "0.1.1", "v0.1.1"), "0.3.0");
  assert.throws(
    () => resolveReleaseVersion("0.1.0", "0.1.1", "v0.1.1"),
    /isn't newer/,
  );
  assert.throws(
    () => resolveReleaseVersion("banana", "0.1.1", "v0.1.1"),
    /X\.Y\.Z/,
  );
});

test("explicit pre-releases resolve and must be newer than the latest tag", () => {
  assert.equal(
    resolveReleaseVersion("0.2.0-beta.1", "0.1.35", "v0.1.35"),
    "0.2.0-beta.1",
  );
  assert.equal(
    resolveReleaseVersion("v0.2.0-beta.1", "0.1.35", "v0.1.35"),
    "0.2.0-beta.1",
  );
  assert.equal(
    resolveReleaseVersion("0.2.0-beta.2", "0.2.0-beta.1", "v0.2.0-beta.1"),
    "0.2.0-beta.2",
  );
  assert.equal(isPrereleaseVersion("0.2.0-beta.1"), true);
  assert.equal(isPrereleaseVersion("v0.2.0-beta.1"), true);
  assert.equal(isPrereleaseVersion("0.2.0"), false);
  assert.equal(isPrereleaseVersion("0.1.35"), false);
  assert.throws(
    () => resolveReleaseVersion("0.2.0-beta", "0.2.0-beta.1", "v0.2.0-beta.1"),
    /isn't newer/,
  );
});

test("latestVersionTag sorts numerically and skips junk", () => {
  assert.equal(
    latestVersionTag(["v0.1.9", "v0.1.10", "v0.2.0-beta", "nightly", "v0.1.2"]),
    "v0.1.10",
  );
  assert.equal(latestVersionTag([]), null);
});

test("setPackageVersion only touches the top-level version", () => {
  const json =
    '{\n  "name": "surffish",\n  "version": "0.1.1",\n  "dependencies": { "x": { "version": "9.9.9" } }\n}\n';
  assert.equal(
    setPackageVersion(json, "0.1.2"),
    json.replace('"version": "0.1.1"', '"version": "0.1.2"'),
  );
});

test("draft notes list commits and drop release chores", () => {
  const notes = draftReleaseNotes("0.1.2", [
    "fix(tabs): thing (#44)",
    "chore(tap): update Surffish Cask to v0.1.1",
    "chore: release v0.1.1",
  ]);
  assert.match(notes, /^# Surffish v0\.1\.2/);
  assert.match(notes, /- fix\(tabs\): thing \(#44\)/);
  assert.doesNotMatch(notes, /Cask to v0\.1\.1/);
});

test("--from-tag takes an explicit, already-tagged version", () => {
  const tags = ["v0.1.0", "v0.1.1", "v0.1.2"];
  assert.equal(resolveFromTagVersion("0.1.2", tags), "0.1.2");
  assert.equal(resolveFromTagVersion("v0.1.2", tags), "0.1.2");
  assert.throws(() => resolveFromTagVersion("patch", tags), /X\.Y\.Z/);
  assert.throws(() => resolveFromTagVersion("0.1.3", tags), /no v0\.1\.3 tag/);
});

test("dependencyDifferences ignores scripts and lists changed dependency fields", () => {
  const base = {
    name: "x",
    version: "0.1.2",
    scripts: { test: "a" },
    dependencies: { a: "1" },
    devDependencies: { b: "2" },
  };
  const scriptsOnly = {
    ...base,
    version: "0.1.3",
    scripts: { test: "b", perf: "c" },
  };
  assert.deepEqual(
    dependencyDifferences(
      JSON.stringify(base),
      JSON.stringify(scriptsOnly, null, 2),
    ),
    [],
  );
  const newDep = {
    ...base,
    devDependencies: { b: "2", c: "3" },
    trustedDependencies: ["electron"],
  };
  assert.deepEqual(
    dependencyDifferences(JSON.stringify(base), JSON.stringify(newDep)),
    ["devDependencies", "trustedDependencies"],
  );
});

test("plistString reads a string key from an XML plist", () => {
  const xml = `<?xml version="1.0"?><plist><dict>\n  <key>CFBundleName</key>\n  <string>Surffish</string>\n  <key>CFBundleShortVersionString</key>\n  <string>0.1.2</string>\n</dict></plist>`;
  assert.equal(plistString(xml, "CFBundleShortVersionString"), "0.1.2");
  assert.equal(plistString(xml, "CFBundleName"), "Surffish");
  assert.equal(plistString(xml, "CFBundleVersion"), null);
});
