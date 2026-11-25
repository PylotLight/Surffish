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
  assert.match(
    buildScript,
    /\/Applications\/Xcode\*\.app\/Contents\/Developer/,
  );
  assert.match(buildScript, /export DEVELOPER_DIR/);
  assert.match(buildScript, /SDKROOT/);
  assert.match(buildScript, /compile_swift\(\)/);
  assert.match(buildScript, /xcrun swiftc -sdk "\$\{SDKROOT\}" "\$@"/);
  assert.match(buildScript, /xcrun swiftc "\$@"/);
  assert.doesNotMatch(buildScript, /SWIFT_SDK_FLAGS\[@\]/);
  assert.match(buildScript, /-sdk/);
  assert.match(buildScript, /SwiftUIMacros plugin/);
  assert.match(buildScript, /Install full Xcode/);
  assert.match(buildScript, /set SDKROOT/);
});
