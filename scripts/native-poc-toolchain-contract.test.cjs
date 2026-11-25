const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const buildScript = fs.readFileSync(
  path.join(root, "scripts/build-native-poc.sh"),
  "utf8",
);

test("native build avoids the missing SwiftUIMacros plugin on CLT-only SDK 27", () => {
  assert.match(buildScript, /xcode-select -p/);
  assert.match(buildScript, /CommandLineTools/);
  assert.match(buildScript, /MacOSX26\*\.sdk/);
  assert.match(buildScript, /SDKROOT/);
  assert.match(buildScript, /SWIFT_SDK_FLAGS=\(\)/);
  assert.match(buildScript, /-sdk/);
  assert.match(buildScript, /SwiftUIMacros plugin/);
  assert.match(buildScript, /Install\/select full Xcode/);
});
