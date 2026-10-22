// Integration smoke: one user agent everywhere a page can see or send one.
// Bot checks (Cloudflare Turnstile / "Checking your browser") read navigator.userAgent in the page,
// in blob: workers inside the cross-site challenges.cloudflare.com iframe, and in service workers,
// and compare them with the User-Agent request header. Electron gives sessions our clean Chrome UA
// but service workers and cross-site-iframe workers use app.userAgentFallback, which still said
// `Electron/x Surffish/x` - the challenge saw two browsers and never passed.
// Checked against the production build, in a real tab:
//   - page, blob worker, script worker, service worker, cross-site iframe and its blob worker all
//     report the same navigator.userAgent, equal to app.userAgentFallback and the session UA
//   - it is plain Chrome (no Electron/app token, reduced Chrome/<major>.0.0.0 version)
//   - every request the server sees (page, iframe, workers, worker fetches) carries that same UA
// `bun run build && bun run test:electron-user-agent`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-user-agent-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BaseWindow,
  session,
  webContents: allWebContents,
} = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-user-agent-smoke-${process.pid}`);
const seen = [];

const WORKER_SOURCE = (reportTo) => `
  const report = { ua: navigator.userAgent, brands: navigator.userAgentData ? navigator.userAgentData.brands.map((b) => b.brand) : null }
  fetch(${JSON.stringify(reportTo)}).catch(() => {}).finally(() => postMessage(report))`;

// The iframe is served from the other loopback name, so it is cross-site (its own process), like
// the Turnstile frame on challenges.cloudflare.com.
const FRAME = (
  origin,
) => `<!doctype html><meta charset="utf-8"><title>frame</title><script>
  const src = ${JSON.stringify(WORKER_SOURCE(`${origin}/from-frame-blob-worker`))}
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))
  worker.onmessage = (event) => parent.postMessage({ frame: navigator.userAgent, frameBlobWorker: event.data }, '*')
</script>`;

const PAGE = (
  frameOrigin,
) => `<!doctype html><meta charset="utf-8"><title>User agent fixture</title><body><script>
  const out = { page: navigator.userAgent, brands: navigator.userAgentData ? navigator.userAgentData.brands.map((b) => b.brand) : null, webdriver: navigator.webdriver }
  const fromWorker = (worker) => new Promise((done) => { worker.onmessage = (event) => done(event.data); worker.onerror = (event) => done({ error: String(event.message) }) })
  const src = ${JSON.stringify(WORKER_SOURCE("PLACEHOLDER"))}.replace('"PLACEHOLDER"', JSON.stringify(location.origin + '/from-blob-worker'))
  const frameDone = new Promise((done) => addEventListener('message', (event) => { if (event.data && event.data.frame) done(event.data) }))
  const frame = document.createElement('iframe')
  frame.src = ${JSON.stringify(`${frameOrigin}/frame`)}
  document.body.append(frame)
  Promise.all([
    fromWorker(new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })))),
    fromWorker(new Worker('/worker.js')),
    navigator.serviceWorker.register('/sw.js').then(() => navigator.serviceWorker.ready).then((registration) => new Promise((done) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = (event) => done(event.data)
      registration.active.postMessage('report', [channel.port2])
    })),
    frameDone
  ]).then(([blobWorker, scriptWorker, serviceWorker, frameReport]) => {
    window.userAgentReport = { ...out, blobWorker, scriptWorker, serviceWorker, frame: frameReport.frame, frameBlobWorker: frameReport.frameBlobWorker }
  }, (error) => { window.userAgentReport = { error: String(error) } })
</script>`;

let port = 0;
const server = createServer((request, response) => {
  seen.push({
    host: request.headers.host,
    url: request.url,
    ua: request.headers["user-agent"] ?? "",
  });
  const js = (body) => {
    response.writeHead(200, {
      "content-type": "text/javascript",
      "cache-control": "no-store",
    });
    response.end(body);
  };
  const html = (body) => {
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
  };
  const origin = `http://${request.headers.host}`;
  if (request.url === "/worker.js")
    return js(WORKER_SOURCE(`${origin}/from-script-worker`));
  if (request.url === "/sw.js") {
    return js(`self.addEventListener('install', () => self.skipWaiting())
      self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
      self.addEventListener('message', (event) => {
        const report = { ua: navigator.userAgent, brands: navigator.userAgentData ? navigator.userAgentData.brands.map((b) => b.brand) : null }
        event.waitUntil(fetch(${JSON.stringify(`${origin}/from-service-worker`)}).catch(() => {}).finally(() => event.ports[0].postMessage(report)))
      })`);
  }
  if (request.url === "/frame") return html(FRAME(origin));
  if (request.url === "/ua") return html(PAGE(`http://localhost:${port}`));
  response.writeHead(204);
  response.end();
});

const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function waitFor(predicate, description, timeout = smoke.waitMs) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(50);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}

const pageContents = (predicate) =>
  allWebContents
    .getAllWebContents()
    .find(
      (contents) =>
        !contents.isDestroyed() && predicate(contents.getURL(), contents),
    );

async function run() {
  app.setPath("userData", userData);
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  const blocker = ElectronBlocker.parse(
    "||surffish-smoke-never-match.invalid^",
    smoke.ADBLOCK_CONFIG,
  );
  writeFileSync(join(userData, smoke.ADBLOCK_CACHE_FILE), blocker.serialize(), {
    mode: 0o600,
  });
  const now = Date.now();
  writeFileSync(
    join(userData, "new-tab-photo-cache.json"),
    `${JSON.stringify({ version: 1, updatedAt: now, lastAttemptAt: now, backgrounds: [] })}\n`,
  );
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  port = server.address().port;
  const fixtureUrl = `http://127.0.0.1:${port}/ua`;
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({ version: 1, tabs: [fixtureUrl], activeIndex: 0 }),
  );

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  await waitFor(() => BaseWindow.getAllWindows()[0], "the main window");

  smoke.step("fixture page reports every context");
  const fixture = await waitFor(
    () => pageContents((url) => url === fixtureUrl),
    "the fixture page contents",
  );
  const report = await waitFor(
    () => smoke.evaluate(fixture, "window.userAgentReport"),
    "the user agent report from the page, workers and iframe",
  );
  assert.equal(report.error, undefined, `fixture failed: ${report.error}`);

  // What the tab session sends; every other context must match it.
  const expected = fixture.session.getUserAgent();
  console.log(`Tab session UA: ${expected}`);
  assert.doesNotMatch(
    expected,
    /Electron|surffish/i,
    "tab session UA still has Electron/app tokens",
  );
  assert.match(
    expected,
    /^Mozilla\/5\.0 \([^)]+\) AppleWebKit\/537\.36 \(KHTML, like Gecko\) Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/,
  );
  assert.equal(
    session.fromPartition("persist:surffish-browser").getUserAgent(),
    expected,
    "profile session UA equals the tab session UA",
  );

  smoke.step("navigator.userAgent matches in every context");
  const contexts = {
    page: report.page,
    "blob: worker": report.blobWorker?.ua,
    "script worker": report.scriptWorker?.ua,
    "service worker": report.serviceWorker?.ua,
    "cross-site iframe": report.frame,
    "cross-site iframe blob: worker": report.frameBlobWorker?.ua,
  };
  const wrong = Object.entries(contexts)
    .filter(([, ua]) => ua !== expected)
    .map(([name, ua]) => `${name}: ${ua}`);
  assert.deepEqual(
    wrong,
    [],
    "navigator.userAgent differs from the tab session UA",
  );
  assert.equal(report.webdriver, false, "navigator.webdriver");
  // Brands (Sec-CH-UA) must agree between the page and its workers, whatever they are.
  for (const name of ["blobWorker", "serviceWorker"])
    assert.deepEqual(
      report[name]?.brands,
      report.brands,
      `userAgentData.brands in the ${name}`,
    );

  smoke.step("every request carries the same User-Agent header");
  for (const path of [
    "/from-blob-worker",
    "/from-script-worker",
    "/from-service-worker",
    "/from-frame-blob-worker",
  ]) {
    await waitFor(
      () => seen.some((entry) => entry.url === path),
      `the ${path} request`,
    );
  }
  const mismatched = seen.filter((entry) => entry.ua !== expected);
  assert.deepEqual(
    mismatched,
    [],
    "requests sent with a different User-Agent header",
  );
  // Service workers and cross-site-iframe workers read this app-wide fallback.
  assert.equal(
    app.userAgentFallback,
    expected,
    "app.userAgentFallback equals the tab session UA",
  );
  console.log(
    `User agent smoke passed (${seen.length} requests, ${Object.keys(contexts).length} contexts).`,
  );
}

run()
  .then(() => {
    server.close();
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    server.close();
    app.exit(1);
  });
