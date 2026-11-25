// Global test mock for the `electron` package, registered for every test file via
// `bunfig.toml` `[test] setupFiles`.
//
// The dev `electron` stub (`node_modules/electron`) exports the binary *path* as a
// bare string (`module.exports = getElectronPath()`), so a runtime
// `import { app } from "electron"` — used by main-process modules — cannot resolve
// the named export `app`, and bun canary throws
// "Export named 'app' not found in module '…/node_modules/electron/index.js'". Under
// `bun test --parallel=4` that surfaces as an intermittent unhandled error between
// tests (one main module gets loaded into a worker and its named import is checked).
//
// This mock provides a permissive stub for any named export, so loading a main
// module that does `import { app } from "electron"` no longer throws. Type-only
// imports (`import type { … } from "electron"`) are erased at runtime and are
// unaffected. Test files that need real electron behaviour (e.g. shutdown.test.ts)
// register their own `mock.module("electron", …)`, which overrides this one.

import { mock } from "bun:test";

const noop = (): unknown => ({});

const apiStub: unknown = new Proxy(noop, {
  get(_target, prop) {
    if (prop === "then" || prop === "catch" || prop === "finally")
      return undefined;
    if (prop === Symbol.toPrimitive) return () => "";
    if (prop === Symbol.iterator) return undefined;
    if (
      prop === Symbol.for("nodejs.util.inspect.custom") ||
      prop === "inspect" ||
      prop === "toString"
    )
      return () => "electron (mock)";
    if (typeof prop === "symbol") return undefined;
    // Any other property is itself a stub: callable, constructable, with stubbed
    // methods, so `app.getPath(...)`, `browserWindow.getAllWindows()`, etc. no-op.
    return new Proxy(noop, {
      get(_subTarget, subProp) {
        if (subProp === "then" || subProp === "catch" || subProp === "finally")
          return undefined;
        if (subProp === Symbol.toPrimitive) return () => "";
        if (subProp === Symbol.iterator) return undefined;
        if (typeof subProp === "symbol") return undefined;
        if (subProp === "inspect" || subProp === "toString")
          return () => "electron (mock)";
        return noop;
      },
      apply: noop,
      construct: () => ({}),
    });
  },
  apply: noop,
  construct: () => ({}),
});

mock.module("electron", () => apiStub);
