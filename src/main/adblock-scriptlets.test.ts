import assert from "node:assert/strict";
import test from "node:test";
import { Resources } from "@ghostery/adblocker-electron";
import {
  bundleScriptlets,
  parseAssembledScriptlet,
  SCRIPTLET_PRELUDE,
  SCRIPTLET_SHARE_SAFE_SELF,
  type ScriptletResources,
} from "./adblock-scriptlets.ts";

const resources: ScriptletResources = {
  scriptlets: [
    {
      name: "safe-self.fn",
      aliases: [],
      body: "function safeSelf() { return safeSelf.safe || (safeSelf.safe = {}) }",
      dependencies: [],
    },
    {
      name: "a.js",
      aliases: [],
      body: "function a(x) { window.a = x }",
      dependencies: ["safe-self.fn"],
    },
    {
      name: "b.js",
      aliases: [],
      body: "function b(x) { window.b = x }",
      dependencies: ["safe-self.fn"],
    },
  ],
};

const assemble = (body: string, deps: string[], arg: string): string =>
  [
    SCRIPTLET_PRELUDE,
    ...deps,
    SCRIPTLET_SHARE_SAFE_SELF,
    `(${body})(...['${arg}'])`,
  ].join(";");

test("pinned Ghostery assembleScript format still parses", () => {
  // The real Resources class: if Ghostery changes how it assembles scriptlets this fails, and
  // bundleScriptlets would silently fall back to unbundled scripts.
  const real = Resources.parse(
    JSON.stringify({ redirects: [], scriptlets: resources.scriptlets }),
    { checksum: "x" },
  );
  const script = real.getScriptlet("a.js");
  assert.ok(script);
  const parsed = parseAssembledScriptlet(
    script,
    real as unknown as ScriptletResources,
  );
  assert.ok(parsed, "real assembled scriptlet parses");
  assert.deepEqual(parsed.dependencies, [resources.scriptlets[0]!.body]);
  assert.match(parsed.invocation, /^\(function a/);
});

test("bundles shared helpers once and keeps each invocation isolated", () => {
  const safeSelf = resources.scriptlets[0]!.body;
  const scripts = [
    assemble(resources.scriptlets[1]!.body, [safeSelf], "1"),
    assemble(resources.scriptlets[2]!.body, [safeSelf], "2"),
  ];
  const { scripts: out, scriptletCount } = bundleScriptlets(scripts, resources);
  assert.equal(scriptletCount, 2);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.split("function safeSelf()").length - 1, 1);
  const window: Record<string, unknown> = {};
  new Function("window", `{\n${out[0]}\n}`)(window);
  assert.deepEqual([window.a, window.b], ["1", "2"]);
});

test("passes through anything it cannot parse, and single scriptlets", () => {
  const safeSelf = resources.scriptlets[0]!.body;
  const one = assemble(resources.scriptlets[1]!.body, [safeSelf], "1");
  assert.deepEqual(bundleScriptlets([one], resources), {
    scripts: [one],
    scriptletCount: 1,
  });
  const surrogate = "window.surrogate = true";
  const unknownDep = assemble(
    resources.scriptlets[2]!.body,
    ["function notInResources() {}"],
    "2",
  );
  const out = bundleScriptlets(
    [
      one,
      surrogate,
      assemble(resources.scriptlets[2]!.body, [safeSelf], "3"),
      unknownDep,
    ],
    resources,
  );
  assert.equal(out.scriptletCount, 4);
  assert.equal(out.scripts.length, 3);
  assert.deepEqual(out.scripts.slice(1), [surrogate, unknownDep]);
  assert.equal(bundleScriptlets([one, one], null).scripts.length, 2);
});

test("falls back to separate scripts when helpers would collide", () => {
  const clash: ScriptletResources = {
    scriptlets: [
      { name: "x.fn", aliases: [], body: "const helper = 1", dependencies: [] },
      { name: "y.fn", aliases: [], body: "const helper = 2", dependencies: [] },
      {
        name: "p.js",
        aliases: [],
        body: "function p() {}",
        dependencies: ["x.fn"],
      },
      {
        name: "q.js",
        aliases: [],
        body: "function q() {}",
        dependencies: ["y.fn"],
      },
    ],
  };
  const scripts = [
    assemble("function p() {}", ["const helper = 1"], ""),
    assemble("function q() {}", ["const helper = 2"], ""),
  ];
  assert.deepEqual(bundleScriptlets(scripts, clash).scripts, scripts);
});
