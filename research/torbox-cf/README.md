# TorBox Cloudflare Turnstile — research

Getting Cloudflare's "Verify you are human" challenge to pass in Surffish
(Electron 46.0.0-alpha.3 / Chromium) while completing the TorBox login
(`https://torbox.app/login`). Investigation ran 2026-10-30 → 31 on a Korean
mobile egress box.

**State: mechanism identified via ground truth; fix candidate identified; one
experiment pending.** Everything below is evidence-backed; no guesswork in the
closed branches.

## TL;DR

- **Orion (a WebKit browser) passes the challenge and logs in.** Captured live
  2026-10-31 13:21–13:24 (see `evidence/`): the _entire_ challenge ran over a
  single persistent **HTTP/3 (QUIC)** connection to `challenges.cloudflare.com`
  — no `hagen`, no `brunhild`, no other round hosts, ever.
- **Our Electron/Chromium client is routed, every run, to a round whose asset
  host is dead:** `brunhild.challenges.cloudflare.com` = **NXDOMAIN** (system
  resolvers, 1.1.1.1, 8.8.8.8) and the sibling `hagen.challenges.cloudflare.com`
  connects but **TLS-hangs** (no response, even native Chromium). The round can
  never complete; the widget retries forever (5 document loads in 75s).
- **All in-page JS branch points are ruled out** by controlled probe runs
  (browser identity, adblock state, PQC WebCrypto capability). Round _flavor_
  is assigned server-side, keyed on something page JS cannot observe or change —
  the client's **network-stack class** (TLS fingerprint, HTTP version).
- **Fix candidate (pending experiment 1 below):** in a Cloudflare-scoped
  net hook, rewrite challenge subresource requests addressed to the dead hosts
  onto `challenges.cloudflare.com` (the host the passing client uses). If the
  CF edge serves the round assets under the platform host, the widget gets a
  token and the login proceeds. Reference implementation: the `csp-patch` arm
  of `scripts/probe-challenge.cjs`.

## The challenge flow (decoded by probe v4+)

Sequence observed in the Turnstile iframe (`challenges.cloudflare.com` doc):

1. inline `<script>` executes @ ~2 ms
2. `fo` POST → 200, encrypted blob — **round assignment lives here**
3. `ci` = a PNG loaded via `<link rel=...>`
4. `pat` GET → **401** (1-char body `J`) — unexplained, consistent across runs
5. `i/<roundId>/<asset>` GET → **`brunhild.challenges.cloudflare.com`** →
   `getaddrinfo ENOTFOUND` → `pageerror` (empty) → `data:` self-probe 200 → retry
6. loop 5–6 until the 75s observation window closes

Round ids rotate every run (`a52e7abc…`, `a52ed5a7…`, `a52ed8e1…`,
`a52f0652…`, `a52f06ab…`, `a52f0713…`, `a52f0769…`; `rch` token
`45ki3 → ftf8i → nibdc → Ck2IFM…`) — **but every round so far has targeted
`brunhild`**. Round selection is a live per-client decision, not a static A/B.

## Host map (dig-verified 2026-10-31)

| host                                          | resolves to                                    | status                                               |
| --------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| `challenges.cloudflare.com`                   | 104.18.95.41 / .94.41                          | **works** — the passing client's only challenge host |
| `hagen.challenges.cloudflare.com`             | 104.18.8.208 / 104.18.9.208                    | connects, **TLS hang** (no response)                 |
| `brunhild.challenges.cloudflare.com`          | **NXDOMAIN** (10.250.0.1/.2, 1.1.1.1, 8.8.8.8) | dead                                                 |
| `ca2-cdn-cfchl.cloudflarechallenges.com`      | **NXDOMAIN**                                   | dead                                                 |
| `*.alg13.dnstest.challenges.cloudflare.com`   | 188.114.96/97.0 (Hetzner)                      | base loads (30x→dnstest.dev)                         |
| `*.mldsa44.dnstest.challenges.cloudflare.com` | 188.114.96/97.0 (Hetzner)                      | same                                                 |
| `dnstest.dev`                                 | 104.18.6/7.197                                 | loads                                                |
| `torbox.app`                                  | 172.66.170.114 / 104.20.28.56                  | works                                                |

No PTR records on any CF edge IP (forward resolution is the attribution tool).
The Turnstile doc's CSP `connect-src` lists exactly: `hagen`, `brunhild`,
`*.alg13.dnstest…`, `*.mldsa44.dnstest…`, `dnstest.dev`, `ca2-…` — and `data:`
is absent natively (the passing client's `data:` self-probe suggests CF serves
client-differentiated documents/CSPs). **Zero PQC algorithm names appear in the
doc's JS** (keyword census: `hagen=1 brunhild=1 alg13=1 dnstest=3 mldsa44=1`,
all in the CSP meta).

## Closed branches (controlled runs)

| branch                   | test                                                                                                                                                                                                                                | result                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| in-page JS identity      | probe v4: full Safari fingerprint — `navigator.vendor` instance-patched, `window.chrome` deleted, UA Safari, `uaData` hidden — verified in-page **and** in cf-frame snapshots (`chrome:"undefined"`, vendor "Apple Computer, Inc.") | round **still brunhild** → CF does not branch on in-page JS identity                                              |
| adblock                  | v4 adblock ON vs OFF (runs 5/6)                                                                                                                                                                                                     | cf-frame CSS sheets `[203,1]` in both = the challenge's own CSS; our layers never touch the frame → **no effect** |
| PQC WebCrypto capability | v5 `--pqc-legacy`: reject `X25519MLKEM768`/ML-KEM/ML-DSA/Kyber/Dilithium via `SubtleCrypto.prototype` patch, classic algorithms pass; doc keyword census shows no PQC names in JS                                                   | round **still brunhild** → no client-side PQC branch                                                              |

Caveat: run 7's `pqc-probe` capability numbers measured the _patched_ crypto
(deferred microtask calls hit the wrapper) — v5.1 captures the native
`generateKey` reference pre-patch; future runs are valid. The verdict
(server-side round choice) is unaffected.

## Ground truth: the passing client (Orion capture, the breakthrough)

- `/Applications/Orion.app` is a **WebKit** app (WebKit.framework XPC; sockets
  live in `com.apple.WebKit.Networking`, pid 25593).
- While the user completed the TorBox login, `scripts/capture-client.sh`
  sampled every 2 s for 150 s: `lsof` external sockets for all Orion pids +
  full-screen `screencapture` (screen-recording permission enabled).
- **Network: exactly two long-lived connections for the whole window, both
  `UDP:443` = HTTP/3 (QUIC)** — `104.20.28.56` (torbox.app) and
  `104.18.94.41` (challenges.cloudflare.com). Nothing else. No `hagen`, no new
  round-host sockets, no failures.
- **Widget: "Success!"** green check (first frame, `evidence/orion-success-first-frame.jpg`);
  the user then typed credentials and submitted the login
  (`evidence/orion-login-submitted.jpg`).

**Conclusion:** a passing WebKit client completes the entire challenge within a
single QUIC connection to `challenges.cloudflare.com` — its round's `i/`
assets are served **from the platform host itself**. Our Chromium client's round
routes `i/` to `brunhild` (dead). Two flavors, keyed on client class.

## Next experiments (in priority order)

1. **Authority rewrite — the fix candidate.** In the probe's `csp-patch` arm
   (session `protocol.handle` → undici, which already intercepts every request
   the challenge doc makes and already rewrites its CSP for `data:`): rewrite
   request URLs whose host ∈ {`brunhild…`, `hagen…`, `ca2-…`, `*.dnstest…`}
   to the same path on `challenges.cloudflare.com` (undici sets Host/SNI from
   the URL). Ensure the delivered doc's CSP `connect-src` allows
   `challenges.cloudflare.com`. Watch: do `i/` GETs now 200? widget badge →
   "Success!"? token issued? then the post-challenge login POST.
   - If the PQC-flavored round assets 404 under the platform host → dead end, go 2/3.
2. **Protocol sniff of `fo`.** Log the negotiated HTTP version of the _first_
   CF request in the native arm (does Electron 46 negotiate H3 on
   challenges.cloudflare.com on this box?). If WebKit=H3 and Electron=H2, try
   undici H3 in the csp-patch arm and see whether the assigned round flips to
   the legacy flavor (in which case _no_ rewrite is needed — just the protocol).
3. **Report to Cloudflare** if the flavor is a pure function of TLS-library
   class and no client switch exists: the PQC-flavor round is broken on CF's
   side (`brunhild` NXDOMAIN globally, `hagen` TLS-hang) yet still assigned to
   Chromium/Node-class clients. Evidence pack = this doc + `logs/`.

## App-port spec (pending experiment 1)

Main-process, session-scoped net hook (Cloudflare challenge origins only):
(a) rewrite dead-host authorities → `challenges.cloudflare.com`; (b) patch the
challenge doc CSP `connect-src` (+= `data:`, += platform host); (c) verbose
logging. Scope gate: only URLs under `challenges.cloudflare.com` /
`*.dnstest…` / `ca2-…` / `hagen` / `brunhild` — zero effect on other traffic.
The probe's `csp-patch` arm is the reference implementation to lift.
Validate the post-challenge login step afterward (token verify is server-side:
if the widget passes in the probe, it should in the app).

## Environment quirks (affect any client equally — not branch points)

- Egress `203.22.33.9` (Korean mobile); Tailscale CGNAT `100.65.254.220`
  visible in resolver results. Machine resolver flaky for _some_ names
  (`fpx.io` timeout; `use1-turn.fpjs.io` −105 in-app while `dig` OK).
- Electron 46.0.0-alpha.3: CDP `Emulation.setUserAgentOverride` rejects with
  "Invalid parameters". Working identity path: session `setUserAgent` +
  webRequest `sec-ch-ua` strip; in-page `navigator.userAgent` then reads Safari.
- The challenge also runs FingerprintJS (WebRTC/TURN checks fail on this
  machine for everyone).

## Artifacts

- `scripts/probe-challenge.cjs` (v5.1) — main probe: standalone Electron, temp
  profile. Flags: `--ua safari|chrome`, `--adblock on|off`, `--csp-patch
on|off`, `--pqc-legacy`, `--cdp`. Arms: csp-patch (protocol.handle+undici+
  cookie jar; dumps `fo` body / doc keywords / `pat`-401), Safari identity
  shim, XHR `loadend` body logging, DOM resource-tag MutationObserver, worker
  CDP observation, frame identity snapshots, 75 s observation, verdict banner.
- `scripts/capture-client.sh <outdir> <pid> [pid… ...] [ival=2] [dur=120]` —
  background lsof+screencapture for _any_ client (built for the Orion run).
- `scripts/probe-torbox.cjs`, `scripts/probe-webdriver.cjs`,
  `scripts/probe-torbox-engine.ts` — earlier engine/driver probes.
- `research/torbox-cf/check-hooks.cjs` — sandbox validator for generated hook
  sources (20 checks, incl. PQC-patch semantics).
- `research/torbox-cf/logs/` — all probe runs (csppatch 1–7, fixed 1–2, tunnel).
- `research/torbox-cf/evidence/` — Orion capture: `orion-net.log` (59 samples),
  `orion-ips.log`, two frames (widget "Success!"; login submitted).

## How to resume (fresh session)

1. `git fetch && git checkout research/torbox-cf-challenge`
2. Re-verify probe builds: `bun build scripts/probe-challenge.cjs --no-bundle`
3. Run the pending experiment 1:
   `./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/probe-challenge.cjs --ua safari > /tmp/probe-rewrite8.log 2>&1`
   (~5 min; adblock default ON is fine — that branch is closed).
4. If it passes: port per the spec above, then validate the post-challenge
   login. Gates before any app PR: `bun lint` (canary), `bun run
format:check`, `bun run typecheck`, `bun run test`.

## Parked (unrelated)

Sidebar 10px-left-inset corner fix — state in OpenChamber project knowledge
note `35f52813`; lives on `dev` (WIP `72f9de5`), untouched by this branch.
