// Integration smoke for page-made blob:/data: links (URL.createObjectURL PDFs, CSV exports, ...).
// Chrome behaviour, checked against the production build:
//   - target=_blank blob link → a new tab in the opener's session that renders the blob (text, PDF viewer)
//   - window.open(blobUrl) → same
//   - plain blob link → navigates the tab itself
//   - <a download="name"> blob / data: link → a download with that filename, no stray tab
//   - data: non-renderable link (no download attr) → a download (Chrome allows these)
//   - data:text/html link → blocked (Chromium blocks page-initiated top-level data: documents)
// `bun run build && bun run test:electron-blob-links`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-blob-links-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { basename, join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BaseWindow,
  session,
  webContents: allWebContents,
} = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-blob-links-smoke-${process.pid}`);
const downloadDirectory = join(userData, "blob-downloads");
const PDF_VIEWER_ORIGIN =
  "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/";

// A one-page PDF built in the page (so the blob really is page-made).
const FIXTURE = `<!doctype html><meta charset="utf-8"><title>Blob fixture</title>
<body style="font:16px system-ui;padding:24px">
<h1>Blob fixture</h1>
<p id="links"></p>
<script>
  function pdfBytes(text) {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      null,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ]
    const stream = 'BT /F1 18 Tf 20 100 Td (' + text + ') Tj ET'
    objects[3] = '<< /Length ' + stream.length + ' >>\\nstream\\n' + stream + '\\nendstream'
    let out = '%PDF-1.4\\n'
    const offsets = []
    objects.forEach((body, i) => { offsets.push(out.length); out += (i + 1) + ' 0 obj\\n' + body + '\\nendobj\\n' })
    const xref = out.length
    out += 'xref\\n0 ' + (objects.length + 1) + '\\n0000000000 65535 f \\n'
    for (const offset of offsets) out += String(offset).padStart(10, '0') + ' 00000 n \\n'
    out += 'trailer\\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\\nstartxref\\n' + xref + '\\n%%EOF\\n'
    return out
  }
  const pdfUrl = URL.createObjectURL(new Blob([pdfBytes('Blob PDF fixture')], { type: 'application/pdf' }))
  const textUrl = URL.createObjectURL(new Blob(['Blob text fixture: hello from a blob'], { type: 'text/plain' }))
  const csvUrl = URL.createObjectURL(new Blob(['a,b\\n1,2\\n'], { type: 'text/csv' }))
  const binUrl = URL.createObjectURL(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/octet-stream' }))
  window.fixture = { pdfUrl, textUrl, csvUrl, binUrl }
  const link = (id, href, attrs = {}) => {
    const a = document.createElement('a')
    a.id = id
    a.href = href
    a.textContent = id
    for (const [key, value] of Object.entries(attrs)) a.setAttribute(key, value)
    document.querySelector('#links').append(a, ' ')
  }
  link('text-tab', textUrl, { target: '_blank' })
  link('pdf-tab', pdfUrl, { target: '_blank' })
  link('csv-download', csvUrl, { download: 'export-report.csv' })
  link('csv-download-tab', csvUrl, { download: 'export-tab.csv', target: '_blank' })
  link('bin-tab', binUrl, { target: '_blank' })
  link('data-download', 'data:text/plain;charset=utf-8,data%20download%20fixture', { download: 'data-fixture.txt' })
  link('data-octet', 'data:application/octet-stream;base64,AQIDBA==')
  link('data-html', 'data:text/html,<h1>phish</h1>')
  link('text-same', textUrl)
</script>`;

const server = createServer((request, response) => {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(
    (request.url || "/").startsWith("/blob")
      ? FIXTURE
      : "<!doctype html><title>Start</title><h1>Start</h1>",
  );
});

let mainWindow;
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

function surfaceFor(view) {
  try {
    return new URL(view.webContents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
}

const views = () =>
  mainWindow.contentView.children.filter(
    (view) => view.webContents && !view.webContents.isDestroyed(),
  );
const surface = (name) => views().find((view) => surfaceFor(view) === name);
const pageContents = (predicate) =>
  allWebContents
    .getAllWebContents()
    .find(
      (contents) =>
        !contents.isDestroyed() &&
        contents.getType() !== "remote" &&
        predicate(contents.getURL(), contents),
    );

async function run() {
  app.setPath("userData", userData);
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  mkdirSync(downloadDirectory, { recursive: true, mode: 0o700 });
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
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fixtureUrl = `${origin}/blob`;
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({ version: 1, tabs: [fixtureUrl], activeIndex: 0 }),
  );

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const downloads = [];
  session
    .fromPartition("persist:surffish-browser")
    .on("will-download", (_event, item) => {
      const record = {
        filename: item.getFilename(),
        url: item.getURL(),
        state: "progressing",
        path: join(
          downloadDirectory,
          `${downloads.length}-${basename(item.getFilename())}`,
        ),
      };
      downloads.push(record);
      item.setSavePath(record.path);
      item.once("done", (_doneEvent, state) => {
        record.state = state;
      });
    });

  mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1100, height: 760 });
  await waitFor(
    () => surface("content") && surface("toolbar") && surface("sidebar"),
    "the renderer surfaces",
  );
  const toolbar = surface("toolbar");
  await waitFor(
    () =>
      smoke.evaluate(
        toolbar.webContents,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  const state = () =>
    smoke.evaluate(toolbar.webContents, "window.api.browser.state()");
  const tabs = () =>
    smoke.evaluate(toolbar.webContents, "window.api.browser.tabs.get()");
  const activate = (id) =>
    smoke.evaluate(
      toolbar.webContents,
      `window.api.browser.tabs.activate(${JSON.stringify(id)})`,
    );
  const closeTab = (id) =>
    smoke.evaluate(
      toolbar.webContents,
      `window.api.browser.tabs.close(${JSON.stringify(id)})`,
    );

  await waitFor(async () => {
    const current = await state();
    return current.url === fixtureUrl && !current.loading;
  }, "the fixture page");
  const fixture = await waitFor(
    () => pageContents((url) => url === fixtureUrl),
    "the fixture page contents",
  );
  await waitFor(
    () =>
      smoke.evaluate(
        fixture,
        'Boolean(window.fixture && document.querySelector("#text-same"))',
      ),
    "the fixture blobs",
  );
  const urls = await smoke.evaluate(fixture, "window.fixture");
  assert.match(urls.textUrl, /^blob:http:\/\/127\.0\.0\.1:\d+\//);
  const fixtureTabId = (await tabs()).find((tab) => tab.active).id;
  // Clicks run as a user gesture, like a real click on the link.
  const click = (id) =>
    fixture.executeJavaScript(
      `document.getElementById(${JSON.stringify(id)}).click()`,
      true,
    );
  const backToFixture = async () => {
    await activate(fixtureTabId);
    await waitFor(
      async () => (await state()).url === fixtureUrl,
      "the fixture tab to be active again",
    );
  };
  const openedTab = async (url, description) => {
    const tab = await waitFor(
      async () =>
        (await tabs()).find(
          (candidate) => candidate.url === url && candidate.active,
        ),
      description,
    );
    const contents = await waitFor(
      () => pageContents((candidate) => candidate === url),
      `${description} (contents)`,
    );
    return { tab, contents };
  };

  // --- target=_blank blob text → new active tab rendering the blob, in the opener's session
  smoke.step("target=_blank blob text link");
  await click("text-tab");
  const textTab = await openedTab(
    urls.textUrl,
    "a new tab for the blob text link",
  );
  const body = await waitFor(
    () =>
      smoke.evaluate(
        textTab.contents,
        'document.readyState === "complete" && document.body?.innerText',
      ),
    "the blob text to render",
  );
  assert.match(body, /hello from a blob/);
  assert.equal(
    textTab.contents.session,
    fixture.session,
    "the blob tab runs in the opener session",
  );
  assert.equal((await state()).error, null);
  await closeTab(textTab.tab.id);
  await backToFixture();

  // --- target=_blank blob PDF → new tab with the built-in PDF viewer
  smoke.step("target=_blank blob PDF link");
  await click("pdf-tab");
  const pdfTab = await openedTab(
    urls.pdfUrl,
    "a new tab for the blob PDF link",
  );
  await waitFor(
    () =>
      pdfTab.contents.mainFrame.frames.some((frame) =>
        frame.url.startsWith(PDF_VIEWER_ORIGIN),
      ),
    "the PDF viewer in the blob PDF tab",
  );
  await waitFor(
    async () => (await state()).pdf === "viewer",
    "the toolbar to know the tab shows a PDF",
  );
  await closeTab(pdfTab.tab.id);
  await backToFixture();

  // --- window.open(blobUrl)
  smoke.step("window.open(blob)");
  await fixture.executeJavaScript(
    "void window.open(window.fixture.textUrl)",
    true,
  );
  const openedByScript = await openedTab(
    urls.textUrl,
    "a new tab for window.open(blob)",
  );
  await waitFor(
    () =>
      smoke.evaluate(
        openedByScript.contents,
        'document.body?.innerText.includes("hello from a blob")',
      ),
    "window.open blob to render",
  );
  await closeTab(openedByScript.tab.id);
  await backToFixture();

  // --- download attribute (same tab and target=_blank) → downloads with the page's filename, no new tab
  smoke.step("download-attribute blob links");
  const tabCount = (await tabs()).length;
  await click("csv-download");
  await click("csv-download-tab");
  await click("data-download");
  const named = async (filename) =>
    waitFor(
      () =>
        downloads.find(
          (entry) => entry.filename === filename && entry.state === "completed",
        ),
      `the ${filename} download to complete`,
    );
  const csv = await named("export-report.csv");
  assert.equal(readFileSync(csv.path, "utf8"), "a,b\n1,2\n");
  assert.match(csv.url, /^blob:/);
  await named("export-tab.csv");
  const dataFile = await named("data-fixture.txt");
  assert.equal(readFileSync(dataFile.path, "utf8"), "data download fixture");
  const history = await waitFor(async () => {
    const entries = await smoke.evaluate(
      toolbar.webContents,
      "window.api.browser.downloads.get()",
    );
    return entries.some(
      (entry) =>
        entry.filename === "export-report.csv" && entry.state === "completed",
    )
      ? entries
      : null;
  }, "the blob download in Surffish download history");
  assert.equal(
    history.find((entry) => entry.filename === "export-report.csv").source,
    "127.0.0.1",
  );
  await delay(300);
  assert.equal(
    (await tabs()).length,
    tabCount,
    "download links open no extra tab",
  );
  assert.equal(
    (await state()).url,
    fixtureUrl,
    "download links leave the page where it was",
  );

  // --- non-renderable blob in target=_blank, and a data: octet-stream link: downloads (Chrome
  // drops the empty tab a target=_blank download opened)
  smoke.step("non-renderable blob/data links");
  const before = downloads.length;
  await click("bin-tab");
  await click("data-octet");
  await waitFor(
    () =>
      downloads.slice(before).filter((entry) => entry.state === "completed")
        .length >= 2,
    "the non-renderable blob/data downloads",
  );
  await waitFor(
    async () => (await tabs()).length === tabCount,
    "the empty tab a target=_blank download opened to close",
  );
  await backToFixture();

  // --- page-initiated top-level data:text/html stays blocked (Chromium's anti-phishing rule)
  smoke.step("data:text/html link stays blocked");
  await click("data-html");
  await delay(800);
  assert.equal(
    (await state()).url,
    fixtureUrl,
    "a page cannot open a data: document at top level",
  );
  assert.ok(
    !pageContents((url) => url.startsWith("data:text/html,<h1>phish")),
    "no tab shows the data: document",
  );

  // --- a plain blob link navigates the tab itself
  smoke.step("same-tab blob link");
  await click("text-same");
  await waitFor(
    async () => (await state()).url === urls.textUrl,
    "the tab to navigate to the blob",
  );
  await waitFor(
    () =>
      smoke.evaluate(
        fixture,
        'document.body?.innerText.includes("hello from a blob")',
      ),
    "the same-tab blob to render",
  );
  assert.equal((await state()).error, null);

  assert.ok(
    existsSync(downloadDirectory) && readdirSync(downloadDirectory).length >= 5,
  );
  console.log("Blob links smoke passed.");
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
