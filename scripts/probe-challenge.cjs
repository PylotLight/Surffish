// Why does the Cloudflare Turnstile challenge fail in Surffish but pass in Orion? (v4: csp-patch on the tab's session + full Safari fingerprint + worker/srcdoc observation)
//
// Loads the TorBox login in the production app (throwaway profile, direct route), restarts the
// challenge with a clean reload, and observes it for 75s, capturing:
//   - every console message (the abort: "Cannot determine Turnstile's embedded location…") and
//     a snapshot the moment the abort fires: top page state + the cross-origin challenge frame
//     (CDP execution contexts on *cloudflare.com), incl. its fetch/XHR calls (hooked at document
//     start via Page.addScriptToEvaluateOnNewDocument) and its resource-timing table;
//   - in-app load tests for the worker names from the challenge's CSP (brunhild, hagen) and the
//     dnstest canary hosts, plus controls; the egress IP; session.resolveProxy; the UA;
//   - whether any of our ad-block layers put CSS into the challenge frame (sheet rule counts).
//
// A/B switches:
//   --adblock-off   seed the throwaway profile with the per-site ad-block switch OFF for
//                   torbox.app (disables every layer: network, frame injection, cosmetic hiding)
//   --ua <preset>   one of: safari (Orion's identity, exactly its UA string),
//                   chrome141 (a real, existing Chrome with matching client-hints metadata)
//   --no-hint       with --ua: skip the CDP client-hints override (navigator.userAgentData
//                   stays the built-in Chromium one) — isolates UA-string branching from
//                   client-hints branching
//   --no-cdp        no debugger attach at all (no hook, no frame inspection)
//   --csp-patch     install a handler on the login tab's session: challenge-platform
//                   responses get `data:` added to every connect-src (meta + header), so the
//                   document's own fetch("data:,") self-probe is allowed; every other https
//                   response falls through the Node fetch + a hand-rolled cookie jar
//   --pqc-legacy    hide post-quantum WebCrypto (X25519MLKEM768, ML-KEM/ML-DSA, ...) in every
//                   document, so a capability branch in the challenge falls back to the
//                   pre-PQC (legacy) round flavor; always logs a native capability probe
//
//   ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/probe-challenge.cjs [--adblock-off] [--ua safari|chrome141] [--no-hint] [--no-cdp] [--csp-patch]
const { app, BaseWindow, webContents } = require("electron");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const { mkdirSync, writeFileSync } = require("node:fs");
const { pathToFileURL } = require("node:url");

const smoke = require("./smoke-harness.cjs");

const argv = process.argv.slice(2);
const adblockOff = argv.includes("--adblock-off");
const noCdp = argv.includes("--no-cdp");
const noHint = argv.includes("--no-hint");
const cspPatch = argv.includes("--csp-patch");
const pqcLegacy = argv.includes("--pqc-legacy");
const uaFlagIndex = argv.indexOf("--ua");
const uaPreset = uaFlagIndex >= 0 ? argv[uaFlagIndex + 1] : null;

// Presets: the UA string + matching client-hints metadata (Emulation.setUserAgentOverride).
// The challenge's JS branches on navigator.userAgent AND navigator.userAgentData, so both
// must be set consistently, or the bot checks see a spoof.
const UA_PRESETS = {
  safari: {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    metadata: {
      brands: [],
      fullVersionList: [],
      mobile: false,
      platform: "MacOS",
      platformVersion: "",
      architecture: "",
      bitness: "",
      models: [],
      formFactor: "Desktop",
    },
  },
  chrome141: {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    metadata: {
      brands: [
        { brand: "Chromium", version: "141" },
        { brand: "Google Chrome", version: "141" },
        { brand: "Not_A Brand", version: "24" },
      ],
      fullVersionList: [
        { brand: "Chromium", full_version: "141.0.7390.47" },
        { brand: "Google Chrome", full_version: "141.0.7390.47" },
        { brand: "Not_A Brand", full_version: "24.0.0.0" },
      ],
      mobile: false,
      platform: "MacOS",
      platformVersion: "15.5.0",
      architecture: "arm",
      bitness: "64",
      models: [],
      formFactor: "Desktop",
    },
  },
};

// --csp-patch: the challenge document's CSP connect-src lacks `data:`, so the document's own
// self-probe fetch("data:,") is blocked in Chromium (Safari evidently allows it, which is why
// Orion passes with the identical document). A meta CSP can only be widened by rewriting the
// document body, which means intercepting the fetches of the session the tab loads in —
// run 2 proved the scope: pages load in `persist:surffish-browser`, NOT the app-level default
// session, so an app-level handler never saw the login page or the challenge document.
//
// This Electron build (46.0.0-alpha.3) has no protocol.getDefaultHandler, and net.fetch
// re-enters the handler (measured: same URL, unbounded recursion), so every response falls
// through via the Node fetch with a hand-rolled cookie jar: the hand-rolled fetch never
// touches the session's cookie store, so the jar keeps the Set-Cookie round trip (cf_clearance
// and friends) alive for the life of the probe. The upstream fetch also re-applies the
// identity (UA, no sec-ch-ua*, no zstd) that the webRequest strip does for the real stack,
// since a handler-routed request skips webRequest entirely.
const CHALLENGE_DOC_RE =
  /^https:\/\/([a-z0-9-]+\.)?challenges\.cloudflare\.com\/cdn-cgi\/challenge-platform\//i;

function installCspPatch(sess, presetUa) {
  // `${name}|${domain}|${path}` -> { name, value, domain, path, secure, expires }
  const jar = new Map();

  function remember(url, headers) {
    const raws =
      typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : headers.get("set-cookie")
          ? headers.get("set-cookie").split(", ")
          : [];
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }
    for (const raw of raws) {
      const parts = raw.split(";");
      const eq = parts[0] ? parts[0].indexOf("=") : -1;
      if (eq < 1) continue;
      const name = parts[0].slice(0, eq).trim();
      const value = parts[0].slice(eq + 1);
      let domain = host;
      let path = "/";
      let expires = null;
      let secure = false;
      for (const attr of parts.slice(1)) {
        const a = attr.trim().toLowerCase();
        if (a.startsWith("domain="))
          domain = attr.trim().slice(7).replace(/^\./, "").toLowerCase();
        else if (a.startsWith("path=")) path = attr.trim().slice(5) || "/";
        else if (a.startsWith("max-age=")) {
          const n = Number(attr.trim().slice(8));
          if (Number.isFinite(n)) expires = n <= 0 ? 0 : Date.now() + n * 1000;
        } else if (a.startsWith("expires=")) {
          const t = Date.parse(attr.trim().slice(8));
          if (!Number.isNaN(t)) expires = t;
        } else if (a === "secure") secure = true;
      }
      const key = `${name}|${domain}|${path}`;
      if (expires === 0) jar.delete(key);
      else jar.set(key, { name, value, domain, path, secure, expires });
    }
  }

  function cookieHeader(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return "";
    }
    const picked = [];
    for (const c of jar.values()) {
      if (c.expires !== null && c.expires < Date.now()) continue;
      if (c.secure && u.protocol !== "https:") continue;
      if (u.hostname !== c.domain && !u.hostname.endsWith(`.${c.domain}`))
        continue;
      if (!u.pathname.startsWith(c.path)) continue;
      picked.push(`${c.name}=${c.value}`);
    }
    return picked.join("; ");
  }

  sess.protocol.handle("https", async (request) => {
    const url = request.url;
    const isChallenge = CHALLENGE_DOC_RE.test(url);
    const headers = new Headers(request.headers);
    if (presetUa) headers.set("user-agent", presetUa);
    for (const key of [...headers.keys()])
      if (/^sec-ch-ua/i.test(key)) headers.delete(key);
    // Real Safari sends "gzip, deflate, br" and never zstd; the Node fetch can't decode zstd.
    headers.set("accept-encoding", "gzip, deflate, br");
    const jarCookie = cookieHeader(url);
    if (jarCookie)
      headers.set(
        "cookie",
        [headers.get("cookie"), jarCookie].filter(Boolean).join("; "),
      );
    console.log(
      `(${isChallenge ? "csp-patch" : "proto"}: ${request.method} ${url.slice(0, 96)}${jarCookie ? ` cookie=${jarCookie.length}b` : ""})`,
    );
    let upstream;
    try {
      upstream = await fetch(url, {
        method: request.method,
        headers,
        body: request.body || undefined,
        // undici requires this for a stream body (renderer POSTs, challenge proofs)
        ...(request.body ? { duplex: "half" } : {}),
        redirect: request.redirect,
        referrer: request.referrer || undefined,
        referrerPolicy: request.referrerPolicy || undefined,
      });
    } catch (error) {
      console.log(
        `(proto: fetch failed for ${url.slice(0, 90)}: ${error.message})`,
      );
      throw error;
    }
    remember(url, upstream.headers);
    if (isChallenge) {
      let body = await upstream.text();
      // v4: the fo (proof) response carries the challenge's next-step instructions —
      // dump it so we can see exactly what the server tells this client to do.
      if (/\/fo\//.test(url) && body.length < 4000)
        console.log(
          `(csp-patch fo body: ${body.replace(/\s+/g, " ").slice(0, 500)})`,
        );
      // v5: does the document itself name the PQC hosts/algorithms, or does the client pick?
      const kws = body.match(
        /(brunhild|hagen|dnstest|alg13|mldsa44|x25519[a-z0-9]*|ml-?kem[-a-z0-9]*|ml-?dsa[-a-z0-9]*|kyber|dilithium|fpjs\.io|fingerprintjs)/gi,
      );
      if (kws && kws.length) {
        const counts = {};
        for (const k of kws)
          counts[k.toLowerCase()] = (counts[k.toLowerCase()] || 0) + 1;
        console.log(
          `(csp-patch doc keywords: ${Object.entries(counts)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ")})`,
        );
      }
      // v5: the 401 from the pat (proof-validation) step — dump the reason.
      if (/\/pat\//.test(url) && upstream.status === 401)
        console.log(
          `(csp-patch pat 401 body: ${body.replace(/\s+/g, " ").slice(0, 300)})`,
        );
      // The meta uses HTML entities for the quotes (&#39;), so match both forms. Scoped to the
      // <meta> tag so JS string literals in the document's scripts stay untouched.
      const QUOTE = "(?:'|&#0*39;|&apos;|&#x[02]*7;|&#X[02]*7;)";
      let changed = false;
      const metaRe = /<meta[^>]*content-security-policy[^>]*>/gi;
      body = body.replace(metaRe, (tag) =>
        tag.replace(
          // \2 backreference: the closing quote must be the same form as the opening one
          new RegExp(`(connect-src\\s+)(${QUOTE})self\\2(?=\\s|")`, "gi"),
          (m) => {
            changed = true;
            return m + " data:";
          },
        ),
      );
      const outHeaders = new Headers(upstream.headers);
      // The Node fetch already decoded the body; decoding it twice would garble the document.
      outHeaders.delete("content-encoding");
      outHeaders.delete("content-length");
      const headerCsp = upstream.headers.get("content-security-policy");
      if (headerCsp)
        outHeaders.set(
          "content-security-policy",
          headerCsp.replace(
            new RegExp(`(connect-src\\s+)(${QUOTE})self\\2(?=\\s|")`, "gi"),
            (m) => m + " data:",
          ),
        );
      console.log(
        `(csp-patch: ${upstream.status} ${url.slice(0, 90)} type=${upstream.headers.get("content-type") || "?"} bodyPatch=${changed} headerCsp=${headerCsp ? "yes" : "no"})`,
      );
      return new Response(body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: outHeaders,
      });
    }
    // The Node fetch already decoded the body; decode it twice would garble the document.
    // (undici's response Headers are immutable, so rebuild rather than mutate.)
    const plainHeaders = new Headers(upstream.headers);
    plainHeaders.delete("content-encoding");
    plainHeaders.delete("content-length");
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: plainHeaders,
    });
  });
  console.log(
    "=== csp-patch: handler installed on the login tab's session (challenge-platform responses patched; everything else falls through the Node fetch + cookie jar)",
  );
}

const LOGIN_URL = "https://www.torbox.app/login";
const LOGIN_ORIGIN = "https://www.torbox.app";
const CHALLENGE_WINDOW_MS = 75_000;
const userData = join(
  tmpdir(),
  `surffish-challenge-${process.pid}${adblockOff ? "-adblock-off" : ""}`,
);

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
async function waitFor(predicate, description, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}

function isLoginContents(contents) {
  try {
    return !contents.isDestroyed() && contents.getURL().includes("torbox.app");
  } catch {
    return false;
  }
}

/** Load `url` in a throwaway web contents; report the outcome with the exact net error. */
async function loadOutcome(url, timeoutMs = 15_000) {
  const wc = webContents.create({});
  try {
    const outcome = new Promise((done) => {
      wc.once("did-fail-load", (_e, code, description, failUrl, _main) =>
        done(`FAILED ${code} (${description}) for ${failUrl || url}`),
      );
      wc.once("did-finish-load", () => done(`loaded ${wc.getURL()}`));
      wc.loadURL(url).catch((error) =>
        done(`loadURL rejected: ${error.message}`),
      );
    });
    const timeout = new Promise((done) =>
      setTimeout(
        () =>
          done(
            `TIMED OUT (still loading after ${Math.round(timeoutMs / 1000)}s)`,
          ),
        timeoutMs,
      ),
    );
    return await Promise.race([outcome, timeout]);
  } finally {
    if (!wc.isDestroyed()) wc.destroy();
  }
}

// Runs at document start in every frame of the observed tab (CDP; exempt from the page's CSP,
// including the challenge's trusted-types policy). Records what the page itself fetches.
// NOTE: plain function bodies, never arrows — arrows have no `arguments`, and the original
// bug (every fetch in every frame throwing "arguments is not defined") broke the challenge
// itself and turned the failure into a different one.
function hookSource(hideUaData, safariFingerprint, pqcLegacy) {
  return [
    "(() => {",
    // The safari preset must look like Safari, where navigator.userAgentData does not exist
    // (an empty CDP metadata override still leaves the object defined, just empty).
    ...(hideUaData
      ? [
          "  try { Object.defineProperty(navigator, 'userAgentData', { value: undefined, configurable: true }); } catch (e) {}",
          "  try { delete Navigator.prototype.userAgentData; } catch (e) {}",
        ]
      : []),
    // v4: CDP's Emulation.setUserAgentOverride fails in this Electron build, so the UA string
    // comes from the session override while navigator.vendor / window.chrome still report
    // Chromium. The challenge's fingerprint sees that mismatch. Shim both to Safari's values.
    ...(safariFingerprint
      ? [
          "  try { Object.defineProperty(navigator, 'vendor', { get: () => 'Apple Computer, Inc.', configurable: true }); } catch (e) { try { Object.defineProperty(Navigator.prototype, 'vendor', { get: () => 'Apple Computer, Inc.', configurable: true }); } catch (e2) {} }",
          "  try { if ('chrome' in window) { try { delete window.chrome; } catch (e2) { Object.defineProperty(window, 'chrome', { get: () => undefined, configurable: true }); } } } catch (e) {}",
        ]
      : []),
    "  if (window.__surffishProbe) return;",
    "  const log = (window.__surffishProbe = []);",
    "  const t0 = performance.now();",
    "  const stamp = () => Math.round(performance.now() - t0);",
    "  const push = (m) => { log.push(m); if (log.length > 200) log.splice(0, log.length - 200); };",
    // v5: PQC WebCrypto capability probe (native state), then — with --pqc-legacy — hide the
    // post-quantum algorithms. The round keeps routing this client to the PQC hosts (brunhild:
    // NXDOMAIN, hagen: TLS hang); a pre-PQC capability surface should force the legacy flavor.
    // v5.1: capture the NATIVE generateKey reference before installing the patch — the probe
    // calls are deferred (microtasks) and would otherwise measure the patched object.
    "  const PQC_NAMES = ['X25519MLKEM768', 'X25519', 'ML-KEM-512', 'ML-KEM-768', 'ML-KEM-1024', 'ML-DSA-44', 'ML-DSA-65', 'ML-DSA-87', 'Kyber768', 'Dilithium3', 'ECDH', 'AES-GCM'];",
    "  try {",
    "    const st = crypto.subtle;",
    "    const nativeGen = st.generateKey;",
    "    for (const n of PQC_NAMES) {",
    "      Promise.allSettled([",
    "        Promise.resolve().then(() => nativeGen.call(st, { name: n, namedCurve: n === 'ECDH' ? 'P-256' : undefined }, true, ['deriveBits'])),",
    "        Promise.resolve().then(() => nativeGen.call(st, { name: n }, true, ['sign'])),",
    "      ]).then((rs) => {",
    "        const f = (r) => (r.status === 'fulfilled' ? 'ok' : ((r.reason && r.reason.name) + '|' + ((r.reason && r.reason.message) || '').slice(0, 40)));",
    "        push('pqc-probe ' + n + ' derive=' + f(rs[0]) + ' sign=' + f(rs[1]));",
    "      });",
    "    }",
    "  } catch (e) { push('pqc-probe-failed ' + String(e)); }",
    ...(pqcLegacy
      ? [
          "  try {",
          "    const st = crypto.subtle;",
          "    const SP = Object.getPrototypeOf(st);",
          "    const PQC_RE = /^(?:x?2?5?5?19|ml-[kd]|kyber|dilithium|ntru|sphincs|falcon|sntrup|bicf)/i;",
          "    const isPqc = (a) => { try { const n = typeof a === 'string' ? a : (a && (a.name || (a.algorithm && a.algorithm.name))); return !!(n && PQC_RE.test(String(n))); } catch (e) { return false; } };",
          "    const rej = () => Promise.reject(new DOMException('Operation error.', 'OperationError'));",
          "    for (const m of ['generateKey', 'deriveBits', 'deriveKey', 'sign', 'verify', 'encrypt', 'decrypt', 'importKey']) {",
          "      let o = null;",
          "      try { o = SP[m]; } catch (e) {}",
          "      if (typeof o !== 'function') continue;",
          "      const w = function (...args) { try { if (isPqc(args[0]) || (m === 'importKey' && isPqc(args[2]))) return rej(); } catch (e) {} return o.apply(this, args); };",
          "      try { Object.defineProperty(SP, m, { value: w, writable: true, configurable: true }); } catch (e) { try { Object.defineProperty(st, m, { value: w, configurable: true }); } catch (e2) { push('pqc-patch-' + m + '-failed ' + e.message); } }",
          "    }",
          "    push('pqc-patch installed');",
          "  } catch (e) { push('pqc-patch-failed ' + String(e)); }",
        ]
      : []),
    "  try {",
    "    const of = window.fetch;",
    "    window.fetch = function (input, init) {",
    "      let url = '?';",
    "      try { url = typeof input === 'string' ? input : (input && input.url) || String(input); } catch (e) {}",
    "      const p = of.apply(this, arguments);",
    "      const note = (kind, extra) => push(kind + ' ' + stamp() + 'ms ' + url.slice(0, 140) + ' ' + extra);",
    "      try { Promise.resolve(p).then(",
    "        (r) => { var x = 'status=' + r.status;",
    "          if (/cdn-cgi|data:|challenge/i.test(url)) {",
    "            try { r.clone().text().then((t) => note('fetch OK', x + ' body=' + t.slice(0, 200)), () => note('fetch OK', x)); } catch (e) { note('fetch OK', x); }",
    "          } else { note('fetch OK', x); }",
    "        },",
    "        (e) => note('fetch ERR', String((e && e.message) || e)),",
    "      ); } catch (e) {}",
    "      return p;",
    "    };",
    "  } catch (e) { push('hook-fetch-failed ' + String(e)); }",
    "  try {",
    "    const oo = XMLHttpRequest.prototype.open;",
    "    XMLHttpRequest.prototype.open = function (method, url) {",
    "      try { this.__probeUrl = String(url); push('xhr OPEN ' + stamp() + 'ms ' + this.__probeUrl.slice(0, 140)); } catch (e) {}",
    "      try { this.addEventListener('loadend', function () {",
    "        try {",
    "          var u = this.__probeUrl || '';",
    "          var b = '';",
    "          if (/cdn-cgi|challenge|captcha|dnstest|data:|hagen|brunhild|stun/i.test(u)) { try { b = ' body=' + String(this.responseText).replace(/\\s+/g, ' ').slice(0, 220); } catch (e2) { b = ' body=(unreadable)'; } }",
    "          push('xhr DONE ' + stamp() + 'ms ' + this.status + ' ' + u.slice(0, 100) + b);",
    "        } catch (e3) {}",
    "      }); } catch (e) {}",
    "      return oo.apply(this, arguments);",
    "    };",
    "  } catch (e) { push('hook-xhr-failed ' + String(e)); }",
    "  try { window.addEventListener('error', (e) => push('pageerror ' + stamp() + 'ms ' + ((e.message || (e.error && e.error.message) || 'empty') + ' @' + (e.filename || '').slice(-60) + ' ' + ((e.error && e.error.stack) || '').split('\\n')[0]).slice(0, 220)), true); } catch (e) {}",
    "  try { window.addEventListener('securitypolicyviolation', (e) => push('csp-violation ' + stamp() + 'ms blocked=' + (e.blockedURI || e.validatedDirective || '?') + ' dir=' + e.effectiveDirective + ' ' + ((e.originPolicy || e.policy || '') + ' ' + (e.blockedURI || '')).slice(0, 160)), true); } catch (e) {}",
    "  try { window.addEventListener('unhandledrejection', (e) => push('unhandledrejection ' + stamp() + 'ms ' + String(e.reason && (e.reason.message || e.reason) || e.reason).slice(0, 160))); } catch (e) {}",
    // v4: the challenge may advance via inserted <script>/<link>/<img> tags, which the
    // fetch/XHR hooks cannot see — log resource-tag insertions to learn which host the
    // document asks the loader for (a passive observer is invisible to DOM tamper checks).
    "  try {",
    "    const mo = new MutationObserver((muts) => {",
    "      for (const m of muts) for (const n of m.addedNodes) {",
    "        if (n.nodeType === 1 && /^(SCRIPT|LINK|IMG|IFRAME|OBJECT|EMBED)$/i.test(n.nodeName)) {",
    "          let ref = '';",
    "          try { ref = n.getAttribute('src') || n.getAttribute('href') || ''; } catch (e) {}",
    "          push('dom-tag ' + stamp() + 'ms <' + n.nodeName.toLowerCase() + '>' + (ref ? ' ' + ref.slice(0, 130) : ''));",
    "        }",
    "      }",
    "    });",
    "    mo.observe(document.documentElement || document, { childList: true, subtree: true });",
    "  } catch (e) { push('dom-tag-observer-failed ' + String(e)); }",
    "  push('hooked ' + stamp() + 'ms at ' + location.href.slice(0, 120));",
    "})()",
  ].join("\n");
}
// Wired to the same flags as the CDP path (attachInspector builds its own copy); currently
// unused, but kept consistent so a future non-CDP injection route gets the same identity.
const HOOK_SOURCE = hookSource(
  uaPreset === "safari",
  uaPreset === "safari",
  pqcLegacy,
);

// v4: a worker-safe sibling of the frame hook (a worker's global is `self`, not `window`).
// Workers (blob:, per the challenge's worker-src) are not reached by
// Page.addScriptToEvaluateOnNewDocument, so this is injected via Runtime.evaluate on the
// worker's CDP context; idempotent via the marker.
const WORKER_HOOK_SOURCE = [
  "(() => {",
  "  if (self.__surffishWorkerProbe) return;",
  "  self.__surffishWorkerProbe = true;",
  "  const log = (self.__surffishProbe = self.__surffishProbe || []);",
  "  const t0 = performance.now();",
  "  const stamp = () => Math.round(performance.now() - t0);",
  "  const push = (m) => { log.push(m); if (log.length > 200) log.splice(0, log.length - 200); };",
  "  try {",
  "    const of = self.fetch;",
  "    self.fetch = function (input, init) {",
  "      let url = '?';",
  "      try { url = typeof input === 'string' ? input : (input && input.url) || String(input); } catch (e) {}",
  "      const p = of.apply(this, arguments);",
  "      try { Promise.resolve(p).then(",
  "        (r) => push('wfetch OK ' + stamp() + 'ms ' + url.slice(0, 140) + ' status=' + r.status),",
  "        (e) => push('wfetch ERR ' + stamp() + 'ms ' + url.slice(0, 120) + ' ' + String((e && e.message) || e).slice(0, 140)),",
  "      ); } catch (e) {}",
  "      return p;",
  "    };",
  "  } catch (e) { push('wfetch-hook-failed ' + String(e)); }",
  "  try { self.addEventListener('error', (e) => push('wpageerror ' + stamp() + 'ms ' + ((e.message || (e.error && e.error.message) || 'empty') + ' @' + (e.filename || '').slice(-60))), true); } catch (e) {}",
  "  try { self.addEventListener('unhandledrejection', (e) => push('wunhandledrejection ' + stamp() + 'ms ' + String(e.reason && (e.reason.message || e.reason) || e.reason).slice(0, 160))); } catch (e) {}",
  "  push('worker-hooked ' + stamp() + 'ms at ' + location.href.slice(0, 120));",
  "})()",
].join("\n");

const WORKER_SNAPSHOT_EXPR = `(() => { try {
  return {
    href: (location.href || "").slice(0, 140),
    probe: (self.__surffishProbe || []).slice(-60),
  };
} catch (e) { return { error: String(e) }; } })()`;

// Evaluated in the top frame (CDP, with an executeJavaScript fallback).
const TOP_SNAPSHOT_EXPR = `(() => { try {
  const frames = [...document.querySelectorAll("iframe")].map((f) => ({ src: (f.src || "").slice(0, 150), w: f.width, h: f.height }));
  const c = document.querySelector('.cf-turnstile, [class*="turnstile"], [class*="Turnstile"]');
  const container = c ? (() => { const cs = getComputedStyle(c); return { cls: String(c.className).slice(0, 90), d: cs.display, v: cs.visibility, o: cs.opacity, w: c.offsetWidth, h: c.offsetHeight }; })() : null;
  let token = null;
  try { const t = document.querySelector('input[name="cf-turnstile-response"], input[id$="_response"]'); if (t && t.value) token = t.value.slice(0, 60) + "…(" + t.value.length + " chars)"; } catch (e) {}
  let uaData = "undefined";
  try { if (navigator.userAgentData) uaData = JSON.stringify(navigator.userAgentData); } catch (e) { uaData = "error " + e.message; }
  return {
    href: location.href,
    isTop: window === window.top,
    ready: document.readyState,
    title: document.title,
    bodyText: document.body ? document.body.innerText.replace(/\\s+/g, " ").slice(0, 200) : null,
    frames,
    container,
    token,
    ua: navigator.userAgent,
    uaData,
    chrome: (() => { try { return typeof window.chrome; } catch (e) { return "error " + e.message; } })(),
    vendor: (() => { try { return navigator.vendor; } catch (e) { return "error " + e.message; } })(),
    probe: (window.__surffishProbe || []).slice(-80),
  };
} catch (e) { return { error: String(e) }; } })()`;

const FRAME_SNAPSHOT_EXPR = `(() => { try {
  const resources = performance.getEntriesByType("resource")
    .map((r) => ({ n: r.name.slice(0, 140), b: r.transferSize, ms: Math.round(r.duration) }))
    .filter((r) => /cloudflare|dnstest|data:|captcha|challenge|torbox/i.test(r.n))
    .slice(-25);
  let sheets = null;
  try { sheets = [...document.styleSheets].map((s) => { try { return s.cssRules.length; } catch { return -1; } }); } catch {}
  let csp = null;
  try { csp = [...document.querySelectorAll("meta")].filter((x) => (x.getAttribute("http-equiv") || "").toLowerCase() === "content-security-policy").map((x) => x.content.slice(0, 420)).join(" || "); } catch {}
  // v4: the in-page identity as the frame itself sees it (shims applied at document start).
  let vendor = null;
  try { vendor = navigator.vendor; } catch (e) { vendor = "error " + e.message; }
  let chrome = null;
  try { chrome = typeof window.chrome; } catch (e) { chrome = "error " + e.message; }
  let ua = null;
  try { ua = navigator.userAgent.slice(0, 90); } catch (e) { ua = "error " + e.message; }
  return {
    href: location.href.slice(0, 180),
    vendor,
    chrome,
    ua,
    title: document.title,
    ready: document.readyState,
    bodyText: document.body ? document.body.innerText.replace(/\\s+/g, " ").slice(0, 200) : null,
    bodyStyle: document.body ? { d: getComputedStyle(document.body).display, v: getComputedStyle(document.body).visibility, o: getComputedStyle(document.body).opacity, w: document.body.offsetWidth, h: document.body.offsetHeight } : null,
    sheetRuleCounts: sheets,
    csp,
    iframes: [...document.querySelectorAll("iframe")].map((f) => (f.src || "").slice(0, 150)).slice(0, 8),
    probe: (window.__surffishProbe || []).slice(-60),
    resources,
  };
} catch (e) { return { error: String(e) }; } })()`;

const CHALLENGE_ORIGIN =
  /^https:\/\/([a-z0-9-]+\.)*(challenges\.cloudflare\.com|cloudflarecaptcha\.com|dnstest\.dev)/;

function attachInspector(contents, enabled = true, uaPreset = null) {
  const state = {
    ok: false,
    contexts: [], // {id, origin, auxData, sessionId}
    workerSessions: new Set(), // CDP sessions of attached worker targets (v4)
    evaluate: null,
    close: () => {},
  };
  if (!enabled) return state;
  try {
    contents.debugger.attach("1.3");
  } catch (error) {
    console.log(
      `(cdp: debugger attach failed: ${error.message}; challenge-frame inspection disabled)`,
    );
    return state;
  }
  state.ok = true;
  // "Safari" appears in every Chrome UA too; the distinguishing token is "Version/" without
  // "Chrome". Drives the in-page fingerprint shims — CDP's UA override fails in this build,
  // so the injected hooks are the only way to correct navigator.* / window.chrome in-page.
  const isSafari = !!(
    uaPreset &&
    /Version\/[\d.]+[^\s]*\s+Safari/.test(uaPreset.ua) &&
    !/Chrome/.test(uaPreset.ua)
  );
  const hook = hookSource(isSafari, isSafari, pqcLegacy);
  const sendHint = uaPreset && !noHint;
  const sendTo = (method, params, sessionId) =>
    contents.debugger
      .sendCommand(method, params, sessionId)
      .catch((error) =>
        console.log(
          `(cdp: ${method}${sessionId ? ` [${sessionId}]` : ""} failed: ${error.message})`,
        ),
      );

  const childSessions = new Set();
  const onMessage = (event, method, params, sessionId) => {
    // Flattened child-session events (OOPIFs) carry a sessionId; primary ones don't.
    const session = sessionId || undefined;
    if (method === "Target.attachedToTarget" && !session) {
      const type = params.targetInfo && params.targetInfo.type;
      const url = params.targetInfo && params.targetInfo.url;
      console.log(
        `(cdp: child target attached: type=${type} url=${String(url).slice(0, 120)} session=${params.sessionId})`,
      );
      childSessions.add(params.sessionId);
      if (type === "worker") {
        // v4: workers have no Page domain, but Runtime works — enable it so the worker's
        // execution context is announced; the probe is injected on context creation.
        state.workerSessions.add(params.sessionId);
        sendTo("Runtime.enable", {}, params.sessionId);
      }
      // Only page-ish child targets (OOPIFs) have the Page/Emulation domains;
      // workers and other types reject them.
      if (type === "page" || type === "iframe") {
        sendTo("Runtime.enable", {}, params.sessionId);
        sendTo("Page.enable", {}, params.sessionId);
        sendTo(
          "Page.addScriptToEvaluateOnNewDocument",
          { source: hook },
          params.sessionId,
        );
        if (sendHint)
          sendTo(
            "Emulation.setUserAgentOverride",
            { userAgent: uaPreset.ua, userAgentMetadata: uaPreset.metadata },
            params.sessionId,
          );
      }
    } else if (method === "Target.detachedFromTarget" && !session) {
      childSessions.delete(params.sessionId);
      state.workerSessions.delete(params.sessionId);
      state.contexts = state.contexts.filter(
        (c) => c.sessionId !== params.sessionId,
      );
    } else if (method === "Runtime.executionContextCreated") {
      state.contexts.push({ ...params.context, sessionId: session });
      if (state.contexts.length > 50)
        state.contexts.splice(0, state.contexts.length - 50);
      // v4: inject the worker probe into worker contexts (idempotent via its marker).
      if (session && state.workerSessions.has(session))
        sendTo(
          "Runtime.evaluate",
          {
            expression: WORKER_HOOK_SOURCE,
            contextId: params.context.id,
            returnByValue: true,
          },
          params.sessionId,
        );
    } else if (method === "Runtime.executionContextDestroyed") {
      state.contexts = state.contexts.filter(
        (c) => !(c.id === params.executionContextId && c.sessionId === session),
      );
    } else if (method === "Network.requestWillBeSent") {
      const u = params.request && params.request.url;
      if (u && /cdn-cgi|challenge-platform/i.test(u)) {
        const h = params.request.headers || {};
        const get = (re) => {
          for (const k of Object.keys(h)) if (re.test(k)) return h[k];
          return undefined;
        };
        const ch = get(/^sec-ch-ua$/i);
        console.log(
          `(net${session ? ` [${String(session).slice(0, 8)}]` : ""}: ${String(u).slice(0, 110)} | ua=${String(get(/^user-agent$/i) || "").slice(0, 55)} | sec-ch-ua=${ch ? String(ch).slice(0, 90) : "(none)"})`,
        );
      }
    }
  };
  contents.debugger.on("message", onMessage);
  sendTo("Runtime.enable");
  sendTo("Page.enable");
  sendTo("Network.enable");
  sendTo("Page.addScriptToEvaluateOnNewDocument", { source: hook });
  if (sendHint)
    sendTo("Emulation.setUserAgentOverride", {
      userAgent: uaPreset.ua,
      userAgentMetadata: uaPreset.metadata,
    });
  sendTo("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  state.evaluate = (expression, context, sessionId = undefined) =>
    contents.debugger
      .sendCommand(
        "Runtime.evaluate",
        {
          expression,
          contextId: context.id,
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId,
      )
      .then(
        (result) => {
          if (result && result.exceptionDetails)
            return `exception: ${JSON.stringify(result.exceptionDetails).slice(0, 200)}`;
          return JSON.stringify(
            (result && result.result && result.result.value) ?? result,
          ).slice(0, 8000);
        },
        (error) => `cdp error: ${error.message}`,
      );
  state.close = () => {
    try {
      contents.debugger.removeListener("message", onMessage);
      contents.debugger.detach();
    } catch {
      /* already gone */
    }
  };
  return state;
}

function challengeContexts(inspector) {
  // Document worlds on challenge hosts (not workers; their scope has no document).
  return inspector.contexts.filter(
    (c) =>
      c.auxData &&
      c.auxData.type === "default" &&
      CHALLENGE_ORIGIN.test(c.origin || ""),
  );
}

function topContext(inspector) {
  // The page's own default world — prefer the tab's origin (the challenge frame is also a
  // default context on a different origin).
  const defaults = inspector.contexts.filter(
    (c) => c.auxData && c.auxData.type === "default",
  );
  for (let i = defaults.length - 1; i >= 0; i--)
    if ((defaults[i].origin || "").includes("torbox.app")) return defaults[i];
  return defaults[0] || null;
}

async function evalTop(contents, inspector) {
  // executeJavaScript always targets the real top frame (topContext() can pick a
  // hidden same-origin about:blank iframe whose CDP context inherits the parent
  // origin — that made the "success" heuristic fire on a blank frame). CDP is the
  // fallback; it stays the only way to reach cross-origin challenge frames.
  try {
    return await contents.executeJavaScript(TOP_SNAPSHOT_EXPR);
  } catch (error) {
    if (inspector.ok) {
      const ctx = topContext(inspector);
      if (ctx) {
        const raw = await inspector.evaluate(
          TOP_SNAPSHOT_EXPR,
          ctx,
          ctx.sessionId,
        );
        try {
          return JSON.parse(raw);
        } catch {
          return {
            error: `top eval returned non-JSON: ${String(raw).slice(0, 250)}`,
          };
        }
      }
    }
    return { error: `executeJavaScript rejected: ${error.message}` };
  }
}

async function takeSnapshot(contents, inspector, label) {
  const top = await evalTop(contents, inspector);
  const frames = [];
  const workers = [];
  if (inspector.ok)
    for (const context of challengeContexts(inspector).slice(-3)) {
      frames.push(
        await inspector.evaluate(
          FRAME_SNAPSHOT_EXPR,
          context,
          context.sessionId,
        ),
      );
    }
  // v4: worker contexts live on their own CDP sessions; snapshot whatever they logged.
  if (inspector.ok)
    for (const context of inspector.contexts.filter(
      (c) => c.sessionId && inspector.workerSessions.has(c.sessionId),
    ))
      workers.push(
        await inspector.evaluate(
          WORKER_SNAPSHOT_EXPR,
          context,
          context.sessionId,
        ),
      );
  return { label, top, frames, workers };
}

function printSnapshot(snapshot) {
  console.log(`\n--- snapshot [${snapshot.label}]`);
  const top = snapshot.top;
  if (typeof top === "string") {
    console.log("  top: " + top.slice(0, 700));
  } else if (top && !top.error) {
    const { probe, ...rest } = top;
    console.log("  top: " + JSON.stringify(rest).slice(0, 700));
    for (const line of (probe || []).slice(-15))
      console.log("  top-probe: " + line);
  } else {
    console.log("  top: " + JSON.stringify(top).slice(0, 700));
  }
  for (const frame of snapshot.frames) {
    let s = String(frame);
    let probeOut = "";
    try {
      const parsed = JSON.parse(s);
      if (parsed && Array.isArray(parsed.probe)) {
        probeOut = parsed.probe
          .slice(-40)
          .map((p) => "  cf-frame-probe: " + p)
          .join("\n");
        delete parsed.probe;
        s = JSON.stringify(parsed);
      }
    } catch {
      /* not JSON (cdp error / exception) — print as-is */
    }
    console.log("  cf-frame: " + s.slice(0, 1200));
    if (probeOut) console.log(probeOut);
    // The frame JSON is re-serialized with sorted keys, so a raw slice could cut
    // `sheetRuleCounts` — pull the ad-block sheet probe out explicitly.
    const m = s.match(/"sheetRuleCounts":(\[[^\]]*\]|null)/);
    if (m) console.log("  cf-frame adblock sheets: " + m[1]);
  }
  for (const worker of snapshot.workers || [])
    console.log("  worker: " + String(worker).slice(0, 900));
}

app.setPath("userData", userData);
mkdirSync(userData, { recursive: true, mode: 0o700 });
writeFileSync(
  join(userData, "browser-session.json"),
  JSON.stringify({ version: 1, tabs: [LOGIN_URL], activeIndex: 0 }),
  { mode: 0o600 },
);
writeFileSync(
  join(userData, "new-tab-photo-cache.json"),
  `${JSON.stringify({ version: 1, updatedAt: Date.now(), lastAttemptAt: Date.now(), backgrounds: [] })}\n`,
);
if (adblockOff)
  writeFileSync(
    join(userData, "browser-preferences.json"),
    JSON.stringify({
      version: 1,
      siteSettings: {
        [LOGIN_ORIGIN]: { origin: LOGIN_ORIGIN, blockAds: false },
      },
    }),
    { mode: 0o600 },
  );

console.log(
  `=== probe v5: adblock ${adblockOff ? "OFF for torbox.app" : "ON (default)"}; UA ${uaPreset ? `preset "${uaPreset}"` : "default (Electron Chrome)"}; cdp ${noCdp ? "off" : "on"}; csp-patch ${cspPatch ? "on" : "off"}; pqc-legacy ${pqcLegacy ? "on" : "off"}`,
);
console.log(`    profile: ${userData}`);

const consoleMessages = [];
const frameEvents = []; // every frame navigation/redirect/failure, in order
const snapshots = [];
let abortSeen = false;
let successSeen = false;

smoke.step("loading the login (direct route, no proxy set)");
import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href)
  .then(() => app.whenReady())
  .then(() => waitFor(() => BaseWindow.getAllWindows()[0], "the main window"))
  .then(() =>
    waitFor(
      () => webContents.getAllWebContents().find(isLoginContents),
      "the login tab",
    ),
  )
  .then(async (contents) => {
    const preset = uaPreset ? UA_PRESETS[uaPreset] : null;
    if (!uaPreset || !preset)
      console.log(
        `(ua preset "${uaPreset}" not found; continuing with the default)`,
      );
    if (preset) {
      contents.session.setUserAgent(preset.ua);
      contents.setUserAgent(preset.ua);
      console.log(`=== user agent override: ${contents.getUserAgent()}`);
    }
    if (preset && preset.ua.includes("Safari")) {
      // Real Safari sends no client hints. Chromium sends sec-ch-ua: "Chromium";v="158" on
      // every request even when the UA string is overridden (and this Electron build rejects
      // the CDP metadata override), so CF's edge sees a mismatched/spoofed identity. Strip
      // the sec-ch-ua* headers to match Orion's HTTP-level identity exactly.
      contents.session.webRequest.onBeforeSendHeaders((details, callback) => {
        const headers = { ...details.requestHeaders };
        for (const key of Object.keys(headers))
          if (/^sec-ch-ua/i.test(key)) delete headers[key];
        callback({ requestHeaders: headers });
      });
      console.log(
        "=== sec-ch-ua* request headers stripped (Safari sends none)",
      );
    }
    if (cspPatch) installCspPatch(contents.session, preset ? preset.ua : null);

    const t0 = Date.now();
    const cfOnly = (url) => {
      try {
        return /cloudflare\.com|challenges\./i.test(new URL(url).hostname);
      } catch {
        return false;
      }
    };

    const inspector = attachInspector(contents, !noCdp, preset);

    contents.on("console-message", (_event, _level, message) => {
      consoleMessages.push(message);
      if (!abortSeen && /aborting clearance redemption/i.test(message)) {
        abortSeen = true;
        takeSnapshot(
          contents,
          inspector,
          `ABORT at t+${Date.now() - t0}ms`,
        ).then((snapshot) => {
          snapshots.push(snapshot);
          printSnapshot(snapshot);
        });
      }
    });
    contents.on(
      "did-frame-navigate",
      (e, url, isMainFrame, processId, routingId) => {
        if (cfOnly(url) || isMainFrame)
          frameEvents.push(
            `t+${Date.now() - t0} frame-navigate main=${isMainFrame} p${processId}#${routingId} ${url}`,
          );
      },
    );
    contents.on("did-redirect-navigation", (e, url, httpStatusCode) => {
      if (cfOnly(url))
        frameEvents.push(
          `t+${Date.now() - t0} redirect ${httpStatusCode} ${url}`,
        );
    });
    contents.on(
      "did-fail-load",
      (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (errorCode !== -3)
          frameEvents.push(
            `t+${Date.now() - t0} FAIL ${errorCode} ${errorDescription} main=${isMainFrame} ${validatedURL}`,
          );
      },
    );

    // Clean observation round: reload so every frame re-navigates (the CDP hook then applies
    // to all of them, and the challenge restarts from scratch).
    contents.reload();
    await delay(2_000);

    console.log(
      `=== observing the challenge for ${Math.round(CHALLENGE_WINDOW_MS / 1000)}s (abortSeen=${abortSeen}) ===`,
    );
    const deadline = Date.now() + CHALLENGE_WINDOW_MS;
    let lastTopLog = 0;
    let evalFails = 0;
    while (Date.now() < deadline) {
      await delay(1_000);
      if (successSeen) break;
      if (Date.now() - lastTopLog > 5_000) {
        lastTopLog = Date.now();
        const top = await evalTop(contents, inspector);
        console.log(
          `  [t+${Date.now() - t0}ms] top: ${JSON.stringify(top).slice(0, 300)}${top.error ? ` (evalFails=${++evalFails})` : ""}`,
        );
        if (!top.error) {
          if (top.token || /success/i.test(top.bodyText || "")) {
            successSeen = true;
            takeSnapshot(
              contents,
              inspector,
              `SUCCESS? at t+${Date.now() - t0}ms`,
            ).then((snapshot) => {
              snapshots.push(snapshot);
              printSnapshot(snapshot);
            });
            break;
          }
        }
      }
    }
    if (evalFails)
      console.log(`  (top-page eval failed ${evalFails}x during the window)`);

    const finalSnapshot = await takeSnapshot(
      contents,
      inspector,
      `end at t+${Date.now() - t0}ms`,
    );
    snapshots.push(finalSnapshot);
    printSnapshot(finalSnapshot);
    console.log(
      `\n=== cdp: ${inspector.ok ? "attached" : "NOT attached"}; live contexts: ${inspector.contexts.length}`,
    );
    for (const c of inspector.contexts.slice(0, 25))
      console.log(
        `  ctx${c.id} [${c.sessionId || "primary"}] origin=${c.origin || "(none)"} aux=${JSON.stringify(c.auxData || {})}`,
      );
    inspector.close();

    console.log(
      `\n=== verdict so far: abortSeen=${abortSeen} successSeen=${successSeen}`,
    );

    console.log(
      "\n=== in-app load tests (a real navigation: exact Chromium net error) ===",
    );
    const randTag = () =>
      Math.random()
        .toString(36)
        .slice(2, 8)
        .replace(/[^a-z0-9]/g, "x");
    for (const [label, url, timeoutMs] of [
      [
        "brunhild worker (v6-only name)",
        "https://brunhild.challenges.cloudflare.com/",
      ],
      ["hagen worker", "https://hagen.challenges.cloudflare.com/"],
      ["base challenges", "https://challenges.cloudflare.com/"],
      ["torbox itself", "https://www.torbox.app/"],
      ["dnstest.dev (CSP-listed)", "https://dnstest.dev/", 10_000],
      [
        "alg13 dnstest (base)",
        "https://alg13.dnstest.challenges.cloudflare.com/",
        10_000,
      ],
      [
        "alg13 dnstest (random subdomain)",
        `https://${randTag()}.alg13.dnstest.challenges.cloudflare.com/`,
        10_000,
      ],
      [
        "mldsa44 dnstest (random subdomain)",
        `https://${randTag()}.mldsa44.dnstest.challenges.cloudflare.com/`,
        10_000,
      ],
    ]) {
      const outcome = await loadOutcome(url, timeoutMs);
      console.log(`  ${label}: ${outcome}`);
    }
    // v4: hagen resolves but the in-app load hangs 15s. A full page load can hang on
    // pending subresources, so also probe a bare no-cors fetch through the same native
    // Chromium stack: opaque-ok = the network path works, fetch error = it does not.
    {
      const wc = webContents.create({});
      try {
        const fetchProbe = await new Promise((done) => {
          const timer = setTimeout(
            () => done("TIMED OUT after 15s (connected, no response)"),
            15_000,
          );
          const finish = (v) => {
            clearTimeout(timer);
            done(v);
          };
          wc.once("did-finish-load", () => {
            wc.executeJavaScript(
              `(async () => { try { const r = await fetch("https://hagen.challenges.cloudflare.com/", { method: "HEAD", mode: "no-cors" }); return "opaque-ok type=" + r.type + " status=" + r.status; } catch (e) { return "fetch error: " + e.message; } })()`,
            )
              .then((v) => finish(String(v)))
              .catch((error) => finish("eval error: " + error.message));
          });
          wc.once("did-fail-load", (_e, code, description, failUrl, _main) =>
            finish(
              `FAILED ${code} (${description}) for ${failUrl || "about:blank"}`,
            ),
          );
          wc.loadURL("about:blank").catch((error) =>
            finish("loadURL rejected: " + error.message),
          );
        });
        console.log(
          `  hagen bare fetch (native Chromium stack): ${fetchProbe}`,
        );
      } finally {
        if (!wc.isDestroyed()) wc.destroy();
      }
    }
    const egress = await contents
      .executeJavaScript(
        `(async () => { try { return (await (await fetch("https://api.ipify.org")).text()).trim(); } catch (e) { return "egress error: " + e.message; } })()`,
      )
      .catch((error) => `eval error: ${error.message}`);
    console.log(`  egress IP as seen from the app: ${egress}`);

    console.log("\n=== session.resolveProxy (what Chromium will route to) ===");
    for (const url of [
      "https://brunhild.challenges.cloudflare.com/",
      "https://challenges.cloudflare.com/",
      "https://www.torbox.app/",
    ]) {
      let routed = "?";
      try {
        routed = await contents.session.resolveProxy(url);
      } catch (error) {
        routed = `error: ${error.message}`;
      }
      console.log(`  ${url} -> ${routed}`);
    }
    console.log(`\n=== page user agent ===\n  ${contents.getUserAgent()}`);

    console.log("\n=== frame events (CF hosts + main frame, in order) ===");
    for (const line of frameEvents.slice(0, 50)) console.log("  " + line);

    const interesting = consoleMessages.filter((m) =>
      /cloudflare|turnstile|challenge|ERR_|aborting|clearance|data:|CSP/i.test(
        m,
      ),
    );
    console.log(
      `\n=== console (${consoleMessages.length} total, ${interesting.length} interesting) ===`,
    );
    for (const m of interesting.slice(0, 25))
      console.log("  " + m.slice(0, 220));

    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
