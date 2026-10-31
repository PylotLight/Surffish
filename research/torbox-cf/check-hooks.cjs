// Throwaway validation: extract the generated hook/snapshot sources from
// scripts/probe-challenge.cjs and run them against minimal fakes.
// Catches the class of bug where a bad injected string breaks the challenge itself.
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const file = resolve(process.argv[2] || "scripts/probe-challenge.cjs");
const src = readFileSync(file, "utf8");
const start = src.indexOf("function hookSource");
const end = src.indexOf("function attachInspector");
if (start < 0 || end < 0) throw new Error("could not locate hook section");
const chunk = src.slice(start, end);

const factory = new Function(
  "uaPreset",
  "pqcLegacy",
  chunk +
    "\nreturn { hookSafari: hookSource(true, true, false), hookPqc: hookSource(true, true, true), WORKER_HOOK_SOURCE, WORKER_SNAPSHOT_EXPR, TOP_SNAPSHOT_EXPR, FRAME_SNAPSHOT_EXPR };",
);
const out = factory("safari", false);

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
};
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// --- parse checks ---------------------------------------------------------
for (const [name, expr] of Object.entries(out))
  check(`parse ${name}`, () => new Function(expr));

// --- fakes ----------------------------------------------------------------
function makeSubtle() {
  const proto = {
    generateKey: async (alg) => ({ kind: "key", name: alg && alg.name }),
    deriveBits: async () => new Uint8Array(32),
    deriveKey: async () => ({}),
    sign: async () => new Uint8Array(4),
    verify: async () => true,
    encrypt: async () => new Uint8Array(4),
    decrypt: async () => new Uint8Array(4),
    importKey: async () => ({}),
  };
  return Object.assign(Object.create(proto), {});
}
function makeEnv() {
  const window = {
    fetch: async (u) => ({
      status: 200,
      ok: true,
      clone: () => ({ text: async () => "ok-body" }),
    }),
    addEventListener: () => {},
    chrome: { runtime: {} },
  };
  const navigator = {
    vendor: "Google Inc.",
    userAgent: "Mozilla/5.0 Safari-test",
  };
  const document = {
    documentElement: {},
    styleSheets: [],
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {},
    readyState: "complete",
    body: null,
  };
  const location = { href: "https://challenges.cloudflare.com/chal" };
  const performance = { now: () => 123 };
  const XMLHttpRequest = { prototype: { open() {} } };
  class MutationObserver {
    constructor(cb) {
      this.cb = cb;
      envHasObserver = true;
    }
    observe() {}
  }
  return {
    window,
    navigator,
    document,
    location,
    performance,
    fetch: async () => ({}),
    XMLHttpRequest,
    MutationObserver,
    crypto: { subtle: makeSubtle() },
  };
}
let envHasObserver = false;
function runFrameHook(expression, env) {
  return new Function(
    "window",
    "navigator",
    "document",
    "location",
    "performance",
    "fetch",
    "XMLHttpRequest",
    "MutationObserver",
    "crypto",
    expression,
  )(
    env.window,
    env.navigator,
    env.document,
    env.location,
    env.performance,
    env.fetch,
    env.XMLHttpRequest,
    env.MutationObserver,
    env.crypto,
  );
}

// --- frame hook: safari + pqc-legacy ---------------------------------------
{
  const env = makeEnv();
  const subtle = env.crypto.subtle;
  const origGenerateKey = Object.getPrototypeOf(subtle).generateKey;
  runFrameHook(out.hookPqc, env);
  check("frame hook executes (pqc variant)", () => {
    const probe = env.window.__surffishProbe;
    if (!probe || !probe.some((m) => m.startsWith("hooked ")))
      throw new Error(`probe=${JSON.stringify(probe)}`);
  });
  check("vendor shimmed", () => {
    if (env.navigator.vendor !== "Apple Computer, Inc.")
      throw new Error("vendor=" + env.navigator.vendor);
  });
  check("window.chrome removed", () => {
    if (typeof env.window.chrome !== "undefined")
      throw new Error("still present");
  });
  check("MutationObserver constructed", () => {
    if (!envHasObserver) throw new Error("no observer");
  });
  const xhr = {
    addEventListener(t, cb) {
      if (t === "loadend") xhr.__loadend = cb;
    },
    status: 200,
    responseText: "INSTRUCTIONS-FO-BODY",
  };
  env.XMLHttpRequest.prototype.open.call(
    xhr,
    "POST",
    "/cdn-cgi/challenge-platform/h/g/fo/x/Cia",
  );
  if (xhr.__loadend) xhr.__loadend();
  env.window.fetch("https://brunhild.challenges.cloudflare.com/x");
  env.window.fetch("https://x");
  setTimeout(async () => {
    const probe = env.window.__surffishProbe;
    const probeStr = JSON.stringify(probe);
    if (!probe.some((m) => m.startsWith("xhr OPEN"))) failures++;
    else console.log("PASS xhr OPEN logged");
    if (
      !probe.some(
        (m) => m.startsWith("xhr DONE") && m.includes("INSTRUCTIONS-FO-BODY"),
      )
    ) {
      failures++;
      console.log("FAIL xhr DONE: " + probeStr);
    } else console.log("PASS xhr DONE logged");
    if (
      !probe.some((m) => m.startsWith("fetch OK") && m.includes("brunhild"))
    ) {
      failures++;
      console.log("FAIL fetch wrapper: " + probeStr);
    } else console.log("PASS fetch wrapper logs");
    if (!probe.some((m) => m.startsWith("pqc-probe "))) {
      failures++;
      console.log("FAIL no pqc-probe entries: " + probeStr);
    } else {
      console.log(
        "PASS pqc-probe entries: " +
          probe.filter((m) => m.startsWith("pqc-probe ")).length,
      );
      console.log(
        "   sample: " +
          probe
            .filter((m) => m.startsWith("pqc-probe X25519"))
            .slice(0, 2)
            .join(" | "),
      );
    }
    if (!probe.some((m) => m === "pqc-patch installed")) {
      failures++;
      console.log("FAIL pqc-patch not installed: " + probeStr);
    } else console.log("PASS pqc-patch installed");
    const patched = Object.getPrototypeOf(subtle).generateKey;
    if (patched === origGenerateKey) {
      failures++;
      console.log("FAIL proto not patched");
    } else console.log("PASS proto generateKey replaced");
    try {
      await subtle.generateKey({ name: "X25519MLKEM768" }, true, [
        "deriveBits",
      ]);
      failures++;
      console.log("FAIL PQC generateKey not rejected");
    } catch (e) {
      console.log(`PASS PQC generateKey rejected (${e.name})`);
    }
    try {
      const k = await subtle.generateKey(
        { name: "ECDH", namedCurve: "P-256" },
        true,
        ["deriveBits"],
      );
      if (!k) throw new Error("no key");
      console.log("PASS classic ECDH passes through");
    } catch (e) {
      failures++;
      console.log("FAIL classic ECDH rejected: " + e.message);
    }
    try {
      await subtle.importKey("raw", new Uint8Array(32), { name: "ML-DSA-65" });
      failures++;
      console.log("FAIL PQC importKey not rejected");
    } catch (e) {
      console.log(`PASS PQC importKey rejected (${e.name})`);
    }
    // non-pqc variant must NOT patch
    const env2 = makeEnv();
    const origGen2 = Object.getPrototypeOf(env2.crypto.subtle).generateKey;
    runFrameHook(out.hookSafari, env2);
    const sub2 = env2.crypto.subtle;
    if (Object.getPrototypeOf(sub2).generateKey !== origGen2) {
      failures++;
      console.log("FAIL plain variant patched the proto");
    } else console.log("PASS plain variant leaves proto untouched");
    process.exit(failures ? 1 : 0);
  }, 50);
}
