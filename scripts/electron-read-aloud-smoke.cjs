// Integration smoke for Read Aloud (Settings → Integrations → Read Aloud, experimental, off by default).
//   1. Off at launch: no Cmd+K entries, the control IPC answers "read aloud disabled", no engine
//      window, nothing downloaded.
//   2. Settings: the section is its own Integrations tab (not under General → Features).
//   3. Download on enable (CI: SURFFISH_READ_ALOUD_TEST_MANIFEST points the download at small fixture
//      files on a local server, with their own hashes and a fake `phonon-tts` runtime): turning the
//      switch on starts it with a progress bar; Cancel, a failure + Retry, then "Ready · …". Turning it
//      off keeps the files (Delete offered), on again re-checks them and downloads nothing.
//   4. One "Voice" section (engine, voice, speed, levers, sample, Play, stats; no separate tester
//      engine): the voice list comes from a mocked voices.jsonl (English only, grouped, searchable),
//      speed presets go to 3x, Play with the system voice (Linux runners usually have none: "No system
//      voices are available." is accepted) and with the (fake) Phonon runtime, which reports the
//      timings and records the options it was given (duration_delta, rewrites, temperature, seed).
//   5. A page without an article reports "No article found" in the player.
//   6. Delete download, then read an article from Reader view's Listen button: the player shows the
//      download progress and the reading starts once it's done. The hidden engine window runs on
//      surffish-tts://engine/ and is cross-origin isolated (wasm threads).
//   7. Navigating the tab stops the reading; the idle engine window closes (SURFFISH_READ_ALOUD_IDLE_MS
//      shortens the 3 minutes) and the next reading opens it again.
//   8. On the live page (no Reader view): the page menu's one "Read Aloud" submenu, "Read from Here"
//      starts mid-article, the spoken sentence is highlighted with the CSS Custom Highlight API (the
//      DOM isn't touched), Pause/Stop while reading; a Reading List item's Listen reads its saved copy.
//  8b. PDFs (pdf.js text in the engine page): Cmd+K Read Aloud on a PDF in the built-in viewer reads
//      its text without the repeated header, the page numbers or the hyphenation; a paused reading
//      stops on its own (SURFFISH_READ_ALOUD_PAUSE_STOP_MS shortens the 10 minutes); the menu's
//      "Read from This Page" starts at the page the viewer shows; a PDF without text (scanned) says so.
//   9. The Cmd/Ctrl+Shift+U app-menu item exists only while on. Turning the feature off closes the
//      engine window.
// READ_ALOUD_SMOKE_PHONON=1 skips the fixtures and downloads the real Phonon runtime + model (~71 MB)
// into the temp profile, and checks real speech: playing, pause/resume, next, the Reader highlight.
// Runs the production build: `bun run build && bun run test:electron-read-aloud`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-read-aloud-smoke.cjs`).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { createHash } = require("node:crypto");
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { gzipSync } = require("node:zlib");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow, BrowserWindow, Menu } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const PHONON = process.env.READ_ALOUD_SMOKE_PHONON === "1";
const IDLE_MS = 4000;
process.env.SURFFISH_READ_ALOUD_IDLE_MS = String(IDLE_MS);
const PAUSE_STOP_MS = 2500;
process.env.SURFFISH_READ_ALOUD_PAUSE_STOP_MS = String(PAUSE_STOP_MS);
// Context menus are captured instead of shown (the smoke picks items and clicks them).
let menus = [];
const buildFromTemplate = Menu.buildFromTemplate.bind(Menu);
Menu.buildFromTemplate = (template) => {
  const menu = buildFromTemplate(template);
  menus.push(template);
  menu.popup = () => undefined;
  return menu;
};
/** The item at a "Parent › Child" label path in a captured template. */
function menuItem(template, path) {
  const [head, ...rest] = path.split(" › ");
  const item = (template || []).find((candidate) => candidate.label === head);
  if (!item || rest.length === 0) return item;
  return Array.isArray(item.submenu)
    ? menuItem(item.submenu, rest.join(" › "))
    : undefined;
}
/** Resident memory (MB) of the app's processes, and of the engine window's renderer when it's open. */
function memoryMb() {
  const metrics = app.getAppMetrics();
  const engine = BrowserWindow.getAllWindows().find(
    (win) =>
      !win.isDestroyed() &&
      win.webContents.getURL().startsWith("surffish-tts://"),
  );
  const pid = engine ? engine.webContents.getOSProcessId() : -1;
  const mb = (kb) => Math.round(kb / 1024);
  return {
    total: mb(
      metrics.reduce(
        (sum, metric) => sum + (metric.memory.workingSetSize || 0),
        0,
      ),
    ),
    engine: mb(
      metrics.find((metric) => metric.pid === pid)?.memory.workingSetSize ?? 0,
    ),
  };
}
const menuLabels = (template) =>
  (template || []).map((item) =>
    item.type === "separator" ? "—" : item.label,
  );
const root = join(tmpdir(), `surffish-read-aloud-smoke-${process.pid}`);
const userData =
  process.env.READ_ALOUD_SMOKE_PROFILE || join(root, "user-data");
const paragraphs = [
  "Surffish can read this article out loud. The voice runs on this computer, so nothing is sent anywhere.",
  "Dr. Smith tested it on Monday at 9 a.m. with a cup of coffee. It cost $4.50, which was fine.",
  "The third paragraph is here so the reading has a few sentences to skip through. Skipping works per sentence.",
  "Readers like short sentences. They are easy to follow. They also make the highlight jump often.",
];

// --- Download fixtures (CI): a fake phonon-tts runtime that "speaks" silence, and model files.
const FAKE_RUNTIME = `
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
// What the engine page asked for, for the smoke to read back (engine window: globalThis.__phonon).
const record = (globalThis.__phonon ??= { loads: [], streams: [], voices: [] })
export const PhononTTS = {
  async load(options) {
    record.loads.push({ rewrites: options.rewrites, device: options.device, threads: options.threads, conditions: options.conditions })
    await sleep(30)
    return {
      sampleRate: 24000, voices: ['default'], threads: 1, threadsReason: 'fixture threads', device: 'cpu', deviceReason: 'fixture device',
      async addVoice(name, source) { record.voices.push(name); const response = await fetch(source); if (!response.ok) throw new Error('voice ' + response.status); this.voices.push(name) },
      stream(text, options = {}) {
        record.streams.push({ voice: options.voice, temperature: options.temperature, seed: options.seed, text: String(text) })
        let cancelled = false
        const chunks = Math.max(2, Math.min(8, Math.ceil(String(text).length / 20)))
        return {
          done: Promise.resolve({ firstAudioMs: 5, cancelled: false }),
          cancel() { cancelled = true },
          async *[Symbol.asyncIterator]() {
            for (let i = 0; i < chunks && !cancelled && !(options.signal && options.signal.aborted); i += 1) {
              await sleep(10)
              yield new Float32Array(2400)
            }
          }
        }
      },
      dispose() {}
    }
  }
}
`;
function tarEntry(name, body) {
  const data = Buffer.from(body);
  const header = Buffer.alloc(512);
  header.write(`package/${name}`, 0);
  header.write(data.length.toString(8).padStart(11, "0"), 124);
  header.write("0", 156);
  header.write("ustar", 257);
  return [
    header,
    Buffer.concat([data, Buffer.alloc((512 - (data.length % 512)) % 512)]),
  ];
}
const fixtures = {
  "runtime.tgz": gzipSync(
    Buffer.concat([
      ...tarEntry("index.js", FAKE_RUNTIME),
      ...tarEntry("worker.js", "// fixture"),
      Buffer.alloc(1024),
    ]),
  ),
  "model.q8.gguf": Buffer.alloc(3 * 1024 * 1024, 7),
  "tokenizer.json": Buffer.from('{"fixture":true}'),
  "config.json": Buffer.from(
    JSON.stringify({
      fixture: true,
      conditioners: [
        {
          type: "lut",
          lut: {
            n_bins: 31,
            dim: 16,
            tokenizer: "noop",
            possible_values: ["0", "1", "2"],
          },
          name: "num_speakers",
        },
        {
          type: "continuous",
          continuous: { scale_factor: 1000, dim: 128, max_period: 10000 },
          name: "duration_delta",
        },
      ],
    }),
  ),
  "default-voice.safetensors": Buffer.alloc(4096, 1),
};
// A mocked phonon-voices catalog: English (US, UK, a character) plus a German voice that must not show.
const CATALOG = [
  {
    voice_id: "usZoey00000000a1",
    name: "Zoey",
    language: "en",
    locale: "en-us",
    gender: "female",
    age: "Adult",
    description: "Playful and upbeat American voice.",
  },
  {
    voice_id: "usMiles0000000a2",
    name: "Miles",
    language: "en",
    locale: "en-us",
    gender: "male",
    age: "Adult",
    description: "Calm and low.",
  },
  {
    voice_id: "4SZHfMpw-p46Ywgs",
    name: "Harper",
    language: "en",
    locale: "en-us",
    gender: "female",
    age: "Young Adult",
    description: "Bright narrator.",
  },
  {
    voice_id: "ukFreya0000000b1",
    name: "Freya",
    language: "en",
    locale: "en-gb",
    gender: "female",
    age: "Adult",
    description: "Crisp British English.",
  },
  {
    voice_id: "ukHugh00000000b2",
    name: "Hugh",
    language: "en",
    locale: "en-gb",
    gender: "male",
    age: "Middle-age",
    description: "Warm British storyteller.",
  },
  {
    voice_id: "chCaptain00000c1",
    name: "Captain Silas",
    language: "en",
    locale: "characters",
    gender: null,
    age: null,
    description: "An old pirate captain.",
  },
  {
    voice_id: "deNele00000000d1",
    name: "Nele",
    language: "de",
    locale: "de-de",
    gender: "female",
    age: "Adult",
    description: "German.",
  },
].map((voice) => ({
  ...voice,
  filename: `voices/${voice.voice_id}.safetensors`,
}));
const ENGLISH = CATALOG.filter((voice) => voice.language === "en");
fixtures["voices.jsonl"] = Buffer.from(
  CATALOG.map((voice) => JSON.stringify(voice)).join("\n"),
);
CATALOG.forEach((voice, index) => {
  fixtures[`voices/${voice.voice_id}.safetensors`] = Buffer.alloc(
    2048,
    index + 2,
  );
});
const MODEL_FIXTURES = [
  "runtime.tgz",
  "model.q8.gguf",
  "tokenizer.json",
  "config.json",
  "default-voice.safetensors",
];
// PDFs for 8b (pdf-lib, made in run()): three pages with a repeated header, "Page N of 3" footers and
// a word hyphenated across a line break; and a "scanned" one with no text at all.
const PDF_SENTENCES = [
  "Read Aloud PDF Smoke",
  "This PDF is read by Surffish with an extraordinary amount of care.",
  "Headers and footers are left out.",
  "Second page begins here.",
  "It has its own sentences to read.",
  "The second page ends with a sentence.",
  "Third page is the last one.",
  "Reading stops after it.",
];
const pdfFixtures = {};
async function makePdfFixtures() {
  const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");
  const document = await PDFDocument.create();
  document.setTitle("Read Aloud PDF Smoke");
  const font = await document.embedFont(StandardFonts.Helvetica);
  const pages = [
    [
      "This PDF is read by Surffish with an extra-",
      "ordinary amount of care. Headers and footers are left out.",
    ],
    [
      "Second page begins here. It has its own sentences to read.",
      "The second page ends with a sentence.",
    ],
    ["Third page is the last one. Reading stops after it."],
  ];
  pages.forEach((lines, index) => {
    const page = document.addPage([612, 792]);
    page.drawText("Surffish PDF Smoke Header", {
      x: 72,
      y: 760,
      size: 9,
      font,
    });
    if (index === 0)
      page.drawText("Read Aloud PDF Smoke", { x: 72, y: 700, size: 20, font });
    lines.forEach((line, row) =>
      page.drawText(line, { x: 72, y: 660 - row * 14, size: 11, font }),
    );
    page.drawText(`Page ${index + 1} of ${pages.length}`, {
      x: 280,
      y: 30,
      size: 9,
      font,
    });
  });
  pdfFixtures["/read-aloud.pdf"] = Buffer.from(await document.save());
  const scanned = await PDFDocument.create();
  scanned.addPage([612, 792]).drawRectangle({
    x: 50,
    y: 50,
    width: 500,
    height: 690,
    color: rgb(0.8, 0.8, 0.8),
  });
  pdfFixtures["/scanned.pdf"] = Buffer.from(await scanned.save());
}
const fixtureHits = [];
const fixtureMode = { slow: false, fail: false };
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/2026/read-aloud-article") {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(
      `<!doctype html><html lang="en"><head><title>Read Aloud Smoke Article</title></head><body><nav><a href="/">Home</a></nav><article><h1>Read Aloud Smoke Article</h1><p class="byline">By Smoke Test</p>${paragraphs.map((text) => `<p>${text} ${"Padding words keep Readability happy about the length of this paragraph. ".repeat(3)}</p>`).join("")}</article></body></html>`,
    );
    return;
  }
  if (pdfFixtures[url.pathname]) {
    response.writeHead(200, {
      "Content-Type": "application/pdf",
      "Cache-Control": "private, max-age=60",
    });
    response.end(pdfFixtures[url.pathname]);
    return;
  }
  if (url.pathname.startsWith("/fixture/")) {
    const name = url.pathname.slice("/fixture/".length);
    const body = fixtures[name];
    fixtureHits.push(name);
    if (!body) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (fixtureMode.fail && name === "model.q8.gguf") {
      response.writeHead(503);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": body.length,
    });
    // Slow mode: 32 KB every 40 ms (~4 s for the "weights"), so progress and Cancel can be seen.
    let offset = 0;
    const step = () => {
      if (response.destroyed) return;
      if (offset >= body.length) {
        response.end();
        return;
      }
      const size = fixtureMode.slow ? 32 * 1024 : 1024 * 1024;
      response.write(body.subarray(offset, offset + size));
      offset += size;
      setTimeout(step, fixtureMode.slow ? 40 : 0);
    };
    step();
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  if (url.pathname === "/empty") {
    response.end("<!doctype html><title></title><body></body>");
    return;
  }
  response.end("<!doctype html><title>Plain</title><p>hi</p>");
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
    await delay(80);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}

const surfaceFor = (view) => {
  try {
    return new URL(view.webContents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
};
const views = () =>
  mainWindow.contentView.children.filter(
    (view) => view.webContents && !view.webContents.isDestroyed(),
  );
const surface = (name) => views().find((view) => surfaceFor(view) === name);
const viewWithUrl = (prefix) =>
  views().find((view) => view.webContents.getURL().startsWith(prefix));
const engineWindow = () =>
  BrowserWindow.getAllWindows().find(
    (win) =>
      !win.isDestroyed() &&
      win.webContents.getURL().startsWith("surffish-tts://"),
  );

async function evaluate(view, expression) {
  try {
    return await view.webContents.executeJavaScript(expression);
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`, {
      cause: error,
    });
  }
}

function writeTestManifest(origin) {
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const file = (name) => ({
    url: `${origin}/fixture/${name}`,
    bytes: fixtures[name].length,
    sha256: sha256(fixtures[name]),
  });
  const manifest = {
    runtime: {
      label: "Phonon runtime",
      url: `${origin}/fixture/runtime.tgz`,
      bytes: fixtures["runtime.tgz"].length,
      integrity: `sha512-${createHash("sha512").update(fixtures["runtime.tgz"]).digest("base64")}`,
    },
    model: {
      "model.q8.gguf": { ...file("model.q8.gguf"), label: "Model weights" },
      "tokenizer.json": file("tokenizer.json"),
      "config.json": file("config.json"),
      "default-voice.safetensors": file("default-voice.safetensors"),
    },
    catalog: {
      url: `${origin}/fixture/voices.jsonl`,
      sha256: sha256(fixtures["voices.jsonl"]),
      bytes: fixtures["voices.jsonl"].length,
      base: `${origin}/fixture`,
      voiceBytes: 2048,
      hashes: Object.fromEntries(
        CATALOG.map((voice) => [
          voice.voice_id,
          sha256(fixtures[`voices/${voice.voice_id}.safetensors`]),
        ]),
      ),
    },
  };
  const path = join(root, "read-aloud-manifest.json");
  writeFileSync(path, JSON.stringify(manifest));
  process.env.SURFFISH_READ_ALOUD_TEST_MANIFEST = path;
  return MODEL_FIXTURES.reduce((sum, name) => sum + fixtures[name].length, 0);
}

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
  await makePdfFixtures();
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  const fixtureBytes = PHONON ? 0 : writeTestManifest(origin);
  const downloadDir = join(userData, "read-aloud");

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1200, height: 860 });
  await waitFor(
    () => surface("content") && surface("toolbar") && surface("sidebar"),
    "the renderer surfaces",
  );
  const toolbar = surface("toolbar");
  const content = surface("content");
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  const commandIds = async () =>
    (
      await evaluate(toolbar, "window.api.browser.commands.list()")
    ).commands.map((command) => command.id);
  const state = () =>
    evaluate(toolbar, "window.api.browser.readAloud.getState()");
  const download = () =>
    evaluate(toolbar, "window.api.browser.readAloud.downloadInfo()");
  const page = (expression) => evaluate(content, expression);
  const modelRow = () =>
    page(
      'document.querySelector(".read-aloud-model-row")?.dataset.status ?? null',
    );
  const modelText = () =>
    page(
      'document.querySelector(".read-aloud-model-row .read-aloud-model-status")?.textContent ?? ""',
    );
  const clickButton = (scope, label) =>
    page(
      `(() => { const button = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find((b) => b.textContent.trim() === ${JSON.stringify(label)}); if (!button) return false; button.click(); return true })()`,
    );
  const setSelect = (label, value) =>
    page(
      `(() => { const select = document.querySelector('select[aria-label=${JSON.stringify(label)}]'); if (!select) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(value)}); select.dispatchEvent(new Event('change', { bubbles: true })); return true })()`,
    );
  const openSettings = async (mode) => {
    await evaluate(
      toolbar,
      `window.api.browser.chrome.set({ sidebarMode: ${JSON.stringify(mode)} })`,
    );
    await waitFor(
      () => page('Boolean(document.querySelector(".settings-view"))'),
      `the ${mode} settings page`,
    );
  };

  // --- 1. Off at launch
  smoke.step("off at launch");
  assert.equal(
    (await evaluate(toolbar, "window.api.browser.readAloud.getSettings()"))
      .enabled,
    false,
    "Read Aloud is off by default",
  );
  assert.equal(
    (await commandIds()).some((id) => id.startsWith("readAloud.")),
    false,
    "no Cmd+K entries while off",
  );
  assert.deepEqual(
    await evaluate(toolbar, 'window.api.browser.readAloud.control("stop")'),
    { ok: false, error: "read aloud disabled" },
  );
  assert.deepEqual(
    await evaluate(
      toolbar,
      'window.api.browser.readAloud.test({ engine: "system" })',
    ),
    { ok: false, error: "read aloud disabled" },
  );
  assert.equal((await state()).status, "idle");
  assert.equal((await download()).status, "absent");
  assert.equal(engineWindow(), undefined, "no engine window while off");

  // --- 2. Settings → Integrations → Read Aloud (not General → Features)
  smoke.step("settings location");
  await openSettings("settings");
  await waitFor(
    () =>
      page(
        'Boolean(document.querySelector("#settings-category-features, [data-category=\\"features\\"]")) || document.querySelector(".settings-view")?.textContent.includes("Spellcheck")',
      ),
    "General → Features",
  );
  assert.equal(
    await page(
      'document.querySelector(".settings-view").textContent.includes("Enable Read Aloud")',
    ),
    false,
    "Read Aloud is no longer under General → Features",
  );
  await openSettings("readaloud");
  await waitFor(
    () =>
      page(
        'Boolean(document.querySelector(".read-aloud-settings [aria-label=\\"Enable Read Aloud\\"]"))',
      ),
    "the Read Aloud settings (lazy chunk)",
  );
  assert.equal(
    await page(
      'document.querySelector(".settings-page-header h1").textContent',
    ),
    "Integrations",
  );
  assert.equal(
    await page(
      'document.querySelector(".integrations-tabs [aria-selected=\\"true\\"]").textContent',
    ),
    "Read Aloud",
    "its own Integrations tab",
  );
  assert.deepEqual(
    await page(
      '[...document.querySelectorAll(".integrations-tabs button")].map((b) => b.textContent)',
    ),
    ["Extensions", "Feeds", "Read Aloud"],
  );
  assert.equal(
    await page('Boolean(document.querySelector(".read-aloud-tester"))'),
    false,
    "no tester while off",
  );

  // --- 3. Download on enable
  smoke.step("download on enable");
  if (!PHONON) fixtureMode.slow = true;
  await page(
    'document.querySelector(".read-aloud-settings [aria-label=\\"Enable Read Aloud\\"]").click(); true',
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.readAloud.getSettings()"))
        .enabled,
    "Read Aloud to turn on",
  );
  await waitFor(
    async () => (await commandIds()).includes("readAloud.page"),
    "the Read Aloud command",
  );
  if (!PHONON) {
    await waitFor(
      async () =>
        (await modelRow()) === "downloading" && /\d+%/.test(await modelText()),
      "the download to start with a progress bar",
    );
    const first = await download();
    assert.equal(first.status, "downloading");
    assert.equal(
      first.total,
      fixtureBytes,
      "progress counts every missing file",
    );
    await waitFor(
      async () => (await download()).loaded > first.loaded,
      "progress to move",
    );
    await waitFor(
      () =>
        page(
          '(document.querySelector(".read-aloud-model-row progress")?.value ?? 0) > 0',
        ),
      "the progress bar to fill",
    );
    assert.match(
      await modelText(),
      /of .* · \d+%/,
      "MB done / total and percent",
    );
    // Cancel
    assert.equal(await clickButton(".read-aloud-model-row", "Cancel"), true);
    await waitFor(
      async () => (await modelRow()) === "cancelled",
      "Cancel to stop the download",
    );
    assert.equal(existsSync(join(downloadDir, "ready.json")), false);
    // A failure, then Retry
    fixtureMode.fail = true;
    assert.equal(await clickButton(".read-aloud-model-row", "Download"), true);
    await waitFor(
      async () => (await modelRow()) === "error",
      "the failed download",
    );
    assert.match(await modelText(), /HTTP 503/);
    fixtureMode.fail = false;
    fixtureMode.slow = false;
    assert.equal(await clickButton(".read-aloud-model-row", "Retry"), true);
    await waitFor(
      async () => (await modelRow()) === "ready",
      "Retry to finish the download",
    );
    assert.match(await modelText(), /^Ready · \d/, '"Ready · <size>"');
    assert.equal(existsSync(join(downloadDir, "ready.json")), true);
    // Off keeps the files; on again re-checks them and fetches nothing.
    smoke.step("cache across off/on");
    // Model files only: the Voice section may fetch voices.jsonl once the model is ready.
    const modelHits = () =>
      fixtureHits.filter((name) => MODEL_FIXTURES.includes(name)).length;
    const hits = modelHits();
    await page(
      'document.querySelector(".read-aloud-settings [aria-label=\\"Enable Read Aloud\\"]").click(); true',
    );
    await waitFor(
      async () =>
        !(await evaluate(toolbar, "window.api.browser.readAloud.getSettings()"))
          .enabled,
      "Read Aloud to turn off",
    );
    await waitFor(
      () =>
        page(
          'Boolean(document.querySelector("[aria-label=\\"Delete the downloaded voice model\\"]"))',
        ),
      "Delete download offered while off",
    );
    assert.equal(
      existsSync(join(downloadDir, "ready.json")),
      true,
      "turning off keeps the download",
    );
    await page(
      'document.querySelector(".read-aloud-settings [aria-label=\\"Enable Read Aloud\\"]").click(); true',
    );
    await waitFor(
      async () =>
        (await download()).status === "ready" && (await modelRow()) === "ready",
      "the cached model to be ready again",
    );
    assert.equal(modelHits(), hits, "nothing downloaded again");
  } else {
    await waitFor(
      async () => (await download()).status === "ready",
      "the real model download",
      8 * 60_000,
    );
  }

  // --- 4. The one Voice section: engine, voice (catalog), speed, levers, sample, Play, stats
  smoke.step("voice section: unified, no separate tester engine");
  const settingsNow = () =>
    evaluate(toolbar, "window.api.browser.readAloud.getSettings()");
  const options = (label) =>
    page(
      `[...document.querySelectorAll('select[aria-label=${JSON.stringify(label)}] option')].map((o) => o.value)`,
    );
  const testState = () =>
    evaluate(toolbar, "window.api.browser.readAloud.getTestState()");
  const playTest = async (description, timeout = smoke.waitMs * 2) => {
    assert.equal(await clickButton(".read-aloud-voice-section", "Play"), true);
    return waitFor(
      async () => {
        const value = await testState();
        return (
          (value.status === "finished" || value.status === "error") && value
        );
      },
      description,
      timeout,
    );
  };
  await waitFor(
    () => page('Boolean(document.querySelector(".read-aloud-voice-section"))'),
    "the Voice section",
  );
  assert.equal(
    await page(
      'document.querySelectorAll("select[aria-label=\\"Read Aloud voice engine\\"]").length',
    ),
    1,
    "one engine select",
  );
  assert.equal(
    await page(
      'Boolean(document.querySelector("select[aria-label=\\"Voice tester engine\\"]"))',
    ),
    false,
    "no separate tester engine row",
  );
  assert.equal(
    await page('Boolean(document.querySelector(".read-aloud-tester"))'),
    false,
    "the old tester group is gone",
  );
  assert.equal(
    await page(
      'document.querySelector(".read-aloud-test-text textarea").value.length > 20',
    ),
    true,
    "a default sample sentence",
  );

  smoke.step("voice catalog from voices.jsonl");
  if (!PHONON) {
    await waitFor(
      async () =>
        (await options("Read Aloud voice")).length === ENGLISH.length + 1,
      `the catalog voices (${ENGLISH.length} English + the model voice)`,
    );
    const listed = await options("Read Aloud voice");
    assert.ok(listed.includes("default"), "the model voice");
    assert.deepEqual(
      listed.filter((id) => id !== "default").sort(),
      ENGLISH.map((voice) => voice.voice_id).sort(),
      "English only (no German voice), each once",
    );
    // A few recommended picks first (Harper here), each voice listed once.
    assert.deepEqual(
      await page(
        '[...document.querySelectorAll("select[aria-label=\\"Read Aloud voice\\"] optgroup")].map((g) => g.label)',
      ),
      [
        "Recommended",
        "Model voice",
        "American English",
        "British English",
        "Characters",
      ],
    );
    assert.equal(
      await page(
        'document.querySelector("select[aria-label=\\"Read Aloud voice\\"] optgroup[label=\\"Recommended\\"] option").textContent',
      ),
      "Harper · American, female",
    );
    assert.equal(
      await page(
        '[...document.querySelectorAll("select[aria-label=\\"Read Aloud voice\\"] option")].some((o) => o.textContent.includes("✓"))',
      ),
      false,
      "no downloaded ticks",
    );
    assert.equal(
      fixtureHits.includes("voices.jsonl"),
      true,
      "voices.jsonl fetched",
    );
    assert.equal(
      fixtureHits.some((name) => name.startsWith("voices/")),
      false,
      "no voice file fetched until one is picked",
    );
    // Search narrows the list (the current voice stays so the select can show it).
    await page(
      `(() => { const input = document.querySelector('input[aria-label="Search voices"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'british'); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
    );
    await waitFor(
      async () => (await options("Read Aloud voice")).length === 3,
      "the search to narrow to the British voices (+ the current one)",
    );
    assert.deepEqual((await options("Read Aloud voice")).slice(1).sort(), [
      "ukFreya0000000b1",
      "ukHugh00000000b2",
    ]);
    await page(
      `(() => { const input = document.querySelector('input[aria-label="Search voices"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ''); input.dispatchEvent(new Event('input', { bubbles: true })); return true })()`,
    );
  } else {
    await waitFor(
      async () => (await options("Read Aloud voice")).length >= 30,
      "the real catalog (37 English voices)",
      60_000,
    );
  }

  smoke.step("speed presets up to 3x");
  assert.deepEqual(
    await page(
      '[...document.querySelectorAll(".read-aloud-speed-presets button")].map((b) => b.textContent)',
    ),
    ["0.75×", "1×", "1.25×", "1.5×", "1.75×", "2×", "2.5×", "3×"],
  );
  assert.equal(await clickButton(".read-aloud-speed-presets", "2.5×"), true);
  await waitFor(
    async () => (await settingsNow()).speed === 2.5,
    "the 2.5x preset to save",
  );
  assert.equal(
    await page(
      'document.querySelector(".read-aloud-speed-presets [aria-pressed=\\"true\\"]").textContent',
    ),
    "2.5×",
  );
  assert.equal(
    await page(
      'document.querySelector("input[aria-label=\\"Reading speed\\"]").max',
    ),
    "3",
  );

  smoke.step("Phonon levers and Advanced");
  assert.equal(
    await page(
      'Boolean(document.querySelector("input[aria-label=\\"Expressiveness\\"]"))',
    ),
    true,
  );
  assert.equal(
    await page(
      'Boolean(document.querySelector("input[aria-label=\\"Vary each read\\"]"))',
    ),
    true,
  );
  assert.deepEqual(await options("Text normalization"), [
    "all",
    "default",
    "none",
  ]);
  assert.equal(await setSelect("Text normalization", "all"), true);
  await waitFor(
    async () => (await settingsNow()).rewrites === "all",
    "rewrites to save",
  );
  assert.equal(
    await page(
      'document.querySelector("[data-disclosure=\\"read-aloud-advanced\\"]")?.open',
    ),
    false,
    "Advanced starts collapsed",
  );
  await page(
    'document.querySelector("[data-disclosure=\\"read-aloud-advanced\\"] summary").click(); true',
  );
  await waitFor(
    () =>
      page(
        'Boolean(document.querySelector("[aria-label=\\"Phonon device\\"]")) && Boolean(document.querySelector("select[aria-label=\\"Phonon threads\\"]"))',
      ),
    "device and threads in Advanced",
  );
  if (!PHONON)
    await waitFor(
      () =>
        page(
          'Boolean(document.querySelector("select[aria-label=\\"Conditioner num_speakers\\"]"))',
        ),
      "the checkpoint’s other conditioner (num_speakers), read from config.json",
    );
  assert.equal(
    await page(
      'Boolean(document.querySelector("[aria-label=\\"Conditioner duration_delta\\"]"))',
    ),
    false,
    "duration_delta is the speed setting, not a raw lever",
  );

  smoke.step("Play: system voice");
  assert.equal(await setSelect("Read Aloud voice engine", "system"), true);
  await waitFor(
    async () => (await settingsNow()).engine === "system",
    "the engine to switch (it is the real setting)",
  );
  await waitFor(
    () =>
      page(
        '!document.querySelector("select[aria-label=\\"Read Aloud voice\\"]")',
      ),
    "the voice picker to hide for the system engine",
  );
  const systemTest = await playTest(
    "the system-voice test to finish (or fail)",
  );
  console.log(`system voice test: ${JSON.stringify(systemTest)}`);
  assert.equal(systemTest.engine, "system");
  if (systemTest.status === "error")
    assert.equal(
      systemTest.error,
      "No system voices are available.",
      "no voices on this runner, said plainly",
    );
  else
    assert.ok(
      systemTest.stats && systemTest.stats.firstAudioMs !== null,
      "first-audio time measured",
    );
  await waitFor(
    () => page('Boolean(document.querySelector(".read-aloud-test-result"))'),
    "the result line",
  );
  const engineWin0 = engineWindow();
  assert.ok(
    engineWin0 && !engineWin0.isVisible(),
    "the tester runs in the hidden engine window",
  );
  assert.equal(
    await engineWin0.webContents.executeJavaScript(
      "self.crossOriginIsolated === true",
    ),
    true,
    "the engine page is cross-origin isolated (wasm threads)",
  );

  smoke.step("Play: Phonon at 2.5x with a catalog voice");
  assert.equal(await setSelect("Read Aloud voice engine", "phonon"), true);
  await waitFor(
    () =>
      page(
        'Boolean(document.querySelector("select[aria-label=\\"Read Aloud voice\\"]"))',
      ),
    "the voice picker",
  );
  const pickedVoice = PHONON ? "GgfEkEJtxZR7gnpy" : "ukFreya0000000b1";
  await waitFor(
    async () => (await options("Read Aloud voice")).includes(pickedVoice),
    "the voice to be listed",
  );
  assert.equal(await setSelect("Read Aloud voice", pickedVoice), true);
  await waitFor(
    async () => (await settingsNow()).voice === pickedVoice,
    "the picked voice to become Read Aloud’s voice",
  );
  const phononTest = await playTest(
    "the Phonon test to finish",
    PHONON ? 3 * 60_000 : smoke.waitMs * 2,
  );
  console.log(`phonon test: ${JSON.stringify(phononTest)}`);
  assert.equal(
    phononTest.status,
    "finished",
    `the Phonon test finished (${phononTest.error})`,
  );
  assert.equal(phononTest.engine, "phonon");
  assert.equal(phononTest.speed, 2.5);
  assert.equal(phononTest.voice, pickedVoice);
  assert.equal(
    phononTest.fallbackReason,
    "",
    "no fallback to the system voice",
  );
  assert.ok(
    phononTest.stats.loadMs !== null &&
      phononTest.stats.firstAudioMs !== null &&
      phononTest.stats.audioSeconds > 0 &&
      phononTest.stats.generateMs !== null,
    "load, first audio and real-time factor measured",
  );
  assert.equal(phononTest.stats.device, "cpu");
  await waitFor(
    () =>
      page(
        '/\\d/.test(document.querySelector("[data-stat=\\"rtf\\"]")?.textContent ?? "") && /ms|s/.test(document.querySelector("[data-stat=\\"first-audio\\"]")?.textContent ?? "") && document.querySelector("[data-stat=\\"device\\"]")?.textContent === "CPU" && /\\d/.test(document.querySelector("[data-stat=\\"threads\\"]")?.textContent ?? "")',
      ),
    "the timings, device and threads on screen",
  );
  if (!PHONON) {
    assert.equal(
      fixtureHits.includes(`voices/${pickedVoice}.safetensors`),
      true,
      "the picked voice was fetched once",
    );
    const recorded = await engineWindow().webContents.executeJavaScript(
      "JSON.parse(JSON.stringify(globalThis.__phonon))",
    );
    const load = recorded.loads.at(-1);
    // 2.5x = Phonon at 1.25x (duration_delta -0.4) × a 2x pitch-preserving stretch.
    assert.equal(
      load.conditions.duration_delta,
      -0.4,
      "model-native part of the speed",
    );
    assert.equal(
      load.rewrites,
      "all",
      "the rewrites setting reaches PhononTTS.load",
    );
    assert.equal(load.device, "cpu");
    assert.equal(load.threads, 2, "2 threads by default");
    const stream = recorded.streams.at(-1);
    assert.equal(stream.voice, pickedVoice);
    assert.equal(stream.temperature, 0.3, "expressiveness → temperature");
    assert.equal(
      stream.seed,
      4242424242424242,
      'fixed seed while "vary each read" is off',
    );
    assert.ok(
      recorded.voices.includes(pickedVoice),
      "the catalog voice was added to the engine",
    );
    // Phonon's fixture audio at 2x stretch: about half of what it generated.
    const generated = recorded.streams.length;
    assert.ok(generated > 0);
  }
  // Back to the defaults for the reading below.
  await evaluate(
    toolbar,
    'window.api.browser.readAloud.setSettings({ voice: "default", speed: 1, rewrites: "default" })',
  );

  // --- 5. A page without an article
  smoke.step("no article");
  await evaluate(
    toolbar,
    `window.api.browser.navigate(${JSON.stringify(`${origin}/empty`)})`,
  );
  await waitFor(() => viewWithUrl(`${origin}/empty`), "the empty page");
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).loading === false,
    "the empty page to load",
  );
  assert.equal(
    await evaluate(
      toolbar,
      'window.api.browser.commands.run("readAloud.page")',
    ),
    true,
  );
  const failed = await waitFor(async () => {
    const value = await state();
    return value.status === "error" && value;
  }, "the no-article error");
  assert.equal(failed.error, "No article found on this page.");
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'Boolean(document.querySelector(".read-aloud-button.is-error"))',
      ),
    "the player button to show the problem",
  );
  await evaluate(toolbar, 'window.api.browser.readAloud.control("stop")');
  await waitFor(
    async () => (await state()).status === "idle",
    "dismissing the error",
  );
  await waitFor(
    () => evaluate(toolbar, '!document.querySelector(".read-aloud-button")'),
    "the player button to go away when idle",
  );

  // --- 6. Reading before the download is done: progress in the player, then it starts.
  smoke.step("read an article while the model downloads");
  if (!PHONON) {
    await evaluate(toolbar, "window.api.browser.readAloud.deleteDownloads()");
    assert.equal(
      existsSync(downloadDir),
      false,
      "Delete download removes the files",
    );
    assert.equal((await download()).status, "absent");
    fixtureMode.slow = true;
  }
  await evaluate(
    toolbar,
    `window.api.browser.navigate(${JSON.stringify(`${origin}/2026/read-aloud-article`)})`,
  );
  await waitFor(
    () => viewWithUrl(`${origin}/2026/read-aloud-article`),
    "the article page",
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).reader ===
      "available",
    "Reader view to be available",
  );
  await evaluate(toolbar, "window.api.browser.toggleReader()");
  const reader = await waitFor(
    () => viewWithUrl("surffish-reader://reader/"),
    "the reader view",
  );
  await waitFor(
    () =>
      evaluate(
        reader,
        'Boolean(document.querySelector(".reader-title")) && !document.getElementById("listen").hidden',
      ),
    "the Listen button in Reader view",
  );
  await evaluate(reader, 'document.getElementById("listen").click(); true');
  if (!PHONON) {
    const waiting = await waitFor(async () => {
      const value = await state();
      return (
        value.status === "downloading" &&
        value.download &&
        value.download.loaded > 0 &&
        value.download.total === fixtureBytes &&
        value
      );
    }, "the player to show the download progress");
    console.log(
      `player while downloading: ${JSON.stringify(waiting.download)}`,
    );
    fixtureMode.slow = false;
  }
  const timeout = PHONON ? Math.max(smoke.waitMs, 3 * 60_000) : smoke.waitMs;
  const started = await waitFor(
    async () => {
      const value = await state();
      return (value.status === "playing" || value.status === "error") && value;
    },
    "the reading to start once the model is ready",
    timeout,
  );
  console.log(
    `reading started: ${JSON.stringify({ status: started.status, engine: started.engine, total: started.total, error: started.error, fallbackReason: started.fallbackReason })}`,
  );
  assert.equal(
    started.status,
    "playing",
    `the reading started (${started.error})`,
  );
  assert.equal(started.engine, "phonon");
  assert.equal(started.fallbackReason, "", "Phonon, no fallback");
  assert.ok(
    started.total >= paragraphs.length,
    `the article was split into sentences (${started.total})`,
  );
  const engineWin = engineWindow();
  assert.ok(engineWin, "the hidden engine window is open");
  await delay(PHONON ? 3000 : 300);
  const readingMemory = memoryMb();
  console.log(`memory while reading (MB): ${JSON.stringify(readingMemory)}`);
  assert.equal(
    engineWin.isVisible(),
    false,
    "the engine window is never shown",
  );
  assert.equal(
    await engineWin.webContents.executeJavaScript(
      "self.crossOriginIsolated === true",
    ),
    true,
  );
  await waitFor(
    () => evaluate(reader, 'CSS.highlights.has("read-aloud")'),
    "the spoken sentence highlight in Reader view",
  );
  await evaluate(toolbar, 'window.api.browser.readAloud.control("pause")');
  await waitFor(async () => (await state()).status === "paused", "pause");
  await evaluate(toolbar, 'window.api.browser.readAloud.control("resume")');
  await waitFor(async () => (await state()).status === "playing", "resume");
  // The player popover: the same speeds (to 3x) and the catalog voices, grouped.
  await evaluate(
    toolbar,
    'document.querySelector(".read-aloud-button").click(); true',
  );
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'Boolean(document.querySelector("#read-aloud-popover select[aria-label=\\"Reading speed\\"]"))',
      ),
    "the player popover",
  );
  assert.deepEqual(
    await evaluate(
      toolbar,
      '[...document.querySelectorAll("#read-aloud-popover select[aria-label=\\"Reading speed\\"] option")].map((o) => o.textContent)',
    ),
    ["0.75×", "1×", "1.25×", "1.5×", "1.75×", "2×", "2.5×", "3×"],
  );
  if (!PHONON)
    await waitFor(
      async () =>
        (await evaluate(
          toolbar,
          'document.querySelectorAll("#read-aloud-popover select[aria-label=\\"Voice\\"] option").length',
        )) ===
        ENGLISH.length + 1,
      "the catalog voices in the player",
    );
  await evaluate(
    toolbar,
    'document.querySelector(".read-aloud-button").click(); true',
  );
  const before = (await state()).index;
  await evaluate(toolbar, 'window.api.browser.readAloud.control("next")');
  await waitFor(async () => {
    const value = await state();
    return value.index > before || value.status === "idle";
  }, "skip to the next sentence");

  // --- 7. Navigating the tab stops the reading.
  smoke.step("navigate away");
  if ((await state()).status !== "idle") {
    await evaluate(toolbar, "window.api.browser.toggleReader()");
    await evaluate(
      toolbar,
      `window.api.browser.navigate(${JSON.stringify(`${origin}/plain`)})`,
    );
    await waitFor(
      async () => (await state()).status === "idle",
      "navigation to stop the reading",
    );
  }

  // --- 7b. The idle engine closes (memory freed), the next reading opens it again.
  smoke.step("idle engine closes");
  await waitFor(
    () => engineWindow() === undefined,
    "the idle engine window to close",
    IDLE_MS + smoke.waitMs,
  );
  await delay(1000);
  const idleMemory = memoryMb();
  console.log(
    `memory after the idle engine closed (MB): ${JSON.stringify(idleMemory)}; freed ≈ ${readingMemory.total - idleMemory.total} MB (engine renderer was ${readingMemory.engine} MB)`,
  );

  // --- 8. The live page: Read Aloud submenu, Read from Here, highlight without DOM changes.
  smoke.step("live page: read from here + highlight");
  await evaluate(
    toolbar,
    `window.api.browser.navigate(${JSON.stringify(`${origin}/2026/read-aloud-article`)})`,
  );
  const live = await waitFor(
    () => viewWithUrl(`${origin}/2026/read-aloud-article`),
    "the article page again",
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).loading === false,
    "the article to load",
  );
  const elementCount = await evaluate(
    live,
    'document.querySelectorAll("*").length',
  );
  const rightClick = async (expression) => {
    const point = await evaluate(
      live,
      `(() => { const r = ${expression}.getBoundingClientRect(); return { x: Math.round(r.x + 8), y: Math.round(r.y + r.height / 2) } })()`,
    );
    menus = [];
    live.webContents.emit(
      "context-menu",
      { preventDefault() {} },
      {
        ...point,
        pageURL: live.webContents.getURL(),
        editFlags: { canSelectAll: true },
      },
    );
    return waitFor(
      () => menus.find((template) => menuItem(template, "Read Aloud")),
      "the page menu with Read Aloud",
      3000,
    );
  };
  let pageMenu = await rightClick('document.querySelectorAll("article p")[3]');
  console.log(`page menu: ${JSON.stringify(menuLabels(pageMenu))}`);
  assert.deepEqual(
    menuLabels(menuItem(pageMenu, "Read Aloud").submenu),
    ["Read from Here", "Read Page"],
    "one Read Aloud submenu (no selection: no Read Selection)",
  );
  for (const old of [
    "Read Selection Aloud",
    "Stop Reading Aloud",
    "Watch This Page for Changes…",
    "Copy Clean Link",
  ])
    assert.equal(
      menuLabels(pageMenu).includes(old),
      false,
      `${old} is not top-level any more`,
    );
  menuItem(pageMenu, "Read Aloud › Read from Here").click();
  const fromHere = await waitFor(
    async () => {
      const value = await state();
      return (value.status === "playing" || value.status === "error") && value;
    },
    "Read from Here to start (the engine opens again)",
    smoke.waitMs * 2,
  );
  assert.equal(
    fromHere.status,
    "playing",
    `Read from Here started (${fromHere.error})`,
  );
  assert.ok(engineWindow(), "the engine window opened again");
  assert.ok(
    fromHere.index > 2,
    `started mid-article (sentence ${fromHere.index} of ${fromHere.total})`,
  );
  const highlighted = () =>
    evaluate(live, 'CSS.highlights.has("surffish-read-aloud")');
  await waitFor(
    highlighted,
    "the spoken sentence highlighted on the live page",
  );
  const highlightText = await evaluate(
    live,
    '[...CSS.highlights.get("surffish-read-aloud")][0]?.toString() ?? ""',
  );
  console.log(`live highlight: ${JSON.stringify(highlightText.slice(0, 80))}`);
  assert.ok(highlightText.length > 3, "the highlight covers a sentence");
  assert.equal(
    await evaluate(live, 'document.querySelectorAll("*").length'),
    elementCount,
    "the page DOM is untouched",
  );
  pageMenu = await rightClick('document.querySelector("article h1")');
  assert.deepEqual(
    menuLabels(menuItem(pageMenu, "Read Aloud").submenu),
    ["Pause", "Stop", "—", "Read from Here", "Read Page"],
    "Pause and Stop while reading",
  );
  menuItem(pageMenu, "Read Aloud › Stop").click();
  await waitFor(
    async () => (await state()).status === "idle",
    "Stop from the menu",
  );
  await waitFor(
    async () => !(await highlighted()),
    "the live highlight cleared",
  );

  smoke.step("reading list: Listen reads the saved copy");
  const added = await evaluate(
    toolbar,
    "window.api.browser.readingList.addTab()",
  );
  assert.equal(added.ok, true, `saved to the Reading List (${added.error})`);
  const savedItem = async () =>
    (
      await evaluate(toolbar, "window.api.browser.readingList.get()")
    ).items.find((entry) => entry.url.includes("read-aloud-article"));
  // The offline Reader copy is saved in the background (and only with the SQLite store); without it Listen opens the live page in Reader view.
  await waitFor(
    async () => (await savedItem())?.hasSnapshot,
    "the offline Reader copy",
    3000,
  ).catch(() => undefined);
  const saved = await savedItem();
  assert.ok(saved, "the article is in the Reading List");
  console.log(`reading list item: hasSnapshot ${saved.hasSnapshot}`);
  await evaluate(
    toolbar,
    `window.api.browser.navigate(${JSON.stringify(`${origin}/plain`)})`,
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).loading === false,
    "another page",
  );
  assert.equal(
    (
      await evaluate(
        toolbar,
        `window.api.browser.readingList.open(${JSON.stringify(saved.id)}, { listen: true })`,
      )
    ).ok,
    true,
  );
  await waitFor(
    () => viewWithUrl("surffish-reader://reader/"),
    "Reader view with the saved copy",
  );
  const listening = await waitFor(
    async () => {
      const value = await state();
      return (value.status === "playing" || value.status === "error") && value;
    },
    "Listen to start reading",
    smoke.waitMs * 2,
  );
  assert.equal(
    listening.status,
    "playing",
    `Listen started (${listening.error})`,
  );
  assert.equal(listening.title, "Read Aloud Smoke Article");
  await evaluate(toolbar, 'window.api.browser.readAloud.control("stop")');
  await waitFor(async () => (await state()).status === "idle", "stop");

  // --- 8b. PDFs: pdf.js text from the built-in viewer's document.
  smoke.step(
    "PDF: read the text, auto-stop while paused, read from this page, scanned PDF",
  );
  const openPdf = async (path) => {
    await evaluate(
      toolbar,
      `window.api.browser.navigate(${JSON.stringify(`${origin}${path}`)})`,
    );
    await waitFor(
      async () =>
        (await evaluate(toolbar, "window.api.browser.state()")).pdf ===
        "viewer",
      `the PDF viewer for ${path}`,
    );
    return viewWithUrl(`${origin}${path.split("#")[0]}`);
  };
  const spokenSince = async (from) =>
    PHONON
      ? []
      : (
          await engineWindow().webContents.executeJavaScript(
            "globalThis.__phonon.streams.map((stream) => stream.text)",
          )
        ).slice(from);
  const streamCount = async () =>
    PHONON || !engineWindow()
      ? 0
      : engineWindow().webContents.executeJavaScript(
          "globalThis.__phonon?.streams.length ?? 0",
        );
  await openPdf("/read-aloud.pdf");
  const pdfCommandEnabled = (
    await evaluate(toolbar, "window.api.browser.commands.list()")
  ).commands.find((command) => command.id === "readAloud.page");
  assert.equal(
    pdfCommandEnabled?.enabled,
    true,
    "Cmd+K Read Aloud is offered on a PDF",
  );
  let streamsBefore = await streamCount();
  assert.equal(
    await evaluate(
      toolbar,
      'window.api.browser.commands.run("readAloud.page")',
    ),
    true,
  );
  const pdfReading = await waitFor(
    async () => {
      const value = await state();
      return (value.status === "playing" || value.status === "error") && value;
    },
    "the PDF reading to start",
    smoke.waitMs * 2,
  );
  console.log(
    `PDF reading: ${JSON.stringify({ status: pdfReading.status, title: pdfReading.title, total: pdfReading.total, error: pdfReading.error })}`,
  );
  assert.equal(
    pdfReading.status,
    "playing",
    `the PDF reading started (${pdfReading.error})`,
  );
  assert.equal(
    pdfReading.title,
    "Read Aloud PDF Smoke",
    "the PDF title from its metadata",
  );
  assert.equal(
    pdfReading.total,
    PDF_SENTENCES.length,
    "header, footers and page numbers are not read",
  );
  if (!PHONON) {
    const spoken = await waitFor(async () => {
      const texts = await spokenSince(streamsBefore);
      return texts.length >= 2 && texts;
    }, "the first PDF sentences to be generated");
    console.log(`PDF sentences spoken: ${JSON.stringify(spoken.slice(0, 3))}`);
    assert.deepEqual(
      spoken.slice(0, 2),
      PDF_SENTENCES.slice(0, 2),
      "the hyphenated word is joined, the header is skipped",
    );
  }
  // The follow-up: a paused reading stops on its own, so the engine can close.
  await evaluate(toolbar, 'window.api.browser.readAloud.control("pause")');
  await waitFor(
    async () => (await state()).status === "paused",
    "pause the PDF reading",
  );
  const pausedAt = Date.now();
  await waitFor(
    async () => (await state()).status === "idle",
    "the paused reading to stop on its own",
    PAUSE_STOP_MS + smoke.waitMs,
  );
  console.log(
    `paused reading stopped by itself after ${Date.now() - pausedAt} ms`,
  );
  // pausedAt is taken once the poll sees the pause, so allow for the polling and IPC lag.
  assert.ok(
    Date.now() - pausedAt >= PAUSE_STOP_MS / 2,
    "not long before the pause timeout",
  );

  const pdfView = await openPdf("/read-aloud.pdf?again=1#page=2");
  await delay(800);
  menus = [];
  pdfView.webContents.emit(
    "context-menu",
    { preventDefault() {} },
    {
      x: 300,
      y: 300,
      pageURL: pdfView.webContents.getURL(),
      editFlags: { canSelectAll: true },
    },
  );
  const pdfMenu = await waitFor(
    () => menus.find((template) => menuItem(template, "Read Aloud")),
    "the PDF page menu with Read Aloud",
    3000,
  );
  assert.deepEqual(menuLabels(menuItem(pdfMenu, "Read Aloud").submenu), [
    "Read from This Page",
    "Read Page",
  ]);
  streamsBefore = await streamCount();
  menuItem(pdfMenu, "Read Aloud › Read from This Page").click();
  const fromPage = await waitFor(
    async () => {
      const value = await state();
      return (value.status === "playing" || value.status === "error") && value;
    },
    "Read from This Page to start",
    smoke.waitMs * 2,
  );
  assert.equal(
    fromPage.status,
    "playing",
    `Read from This Page started (${fromPage.error})`,
  );
  assert.equal(
    fromPage.index,
    PDF_SENTENCES.indexOf("Second page begins here."),
    "starts at the first sentence of page 2",
  );
  if (!PHONON) {
    const spoken = await waitFor(async () => {
      const texts = await spokenSince(streamsBefore);
      return texts.length >= 1 && texts;
    }, "page 2 to be spoken");
    assert.equal(spoken[0], "Second page begins here.");
  }
  await evaluate(toolbar, 'window.api.browser.readAloud.control("stop")');
  await waitFor(
    async () => (await state()).status === "idle",
    "stop the PDF reading",
  );

  // The same PDF open in the PDF editor reads too.
  assert.equal(
    await evaluate(
      toolbar,
      'window.api.browser.commands.run("pdf.toggleEditor")',
    ),
    true,
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).pdf === "editor",
    "the PDF editor",
  );
  assert.equal(
    await evaluate(
      toolbar,
      'window.api.browser.commands.run("readAloud.page")',
    ),
    true,
  );
  const fromEditor = await waitFor(
    async () => {
      const value = await state();
      return (value.status === "playing" || value.status === "error") && value;
    },
    "reading from the PDF editor",
    smoke.waitMs * 2,
  );
  assert.equal(
    fromEditor.status,
    "playing",
    `reading from the PDF editor started (${fromEditor.error})`,
  );
  assert.equal(fromEditor.total, PDF_SENTENCES.length);
  await evaluate(toolbar, 'window.api.browser.readAloud.control("stop")');
  await waitFor(
    async () => (await state()).status === "idle",
    "stop the PDF editor reading",
  );
  await evaluate(
    toolbar,
    'window.api.browser.commands.run("pdf.toggleEditor")',
  );
  await waitFor(
    async () =>
      (await evaluate(toolbar, "window.api.browser.state()")).pdf === "viewer",
    "back to the PDF viewer",
  );

  await openPdf("/scanned.pdf");
  assert.equal(
    await evaluate(
      toolbar,
      'window.api.browser.commands.run("readAloud.page")',
    ),
    true,
  );
  const scanned = await waitFor(
    async () => {
      const value = await state();
      return value.status === "error" && value;
    },
    "the no-text error for a scanned PDF",
    smoke.waitMs * 2,
  );
  assert.equal(
    scanned.error,
    "This PDF has no readable text (it may be scanned images).",
  );
  await evaluate(toolbar, 'window.api.browser.readAloud.control("stop")');
  await waitFor(
    async () => (await state()).status === "idle",
    "dismissing the scanned PDF error",
  );

  smoke.step("shortcut in the app menu");
  const appMenuItems = (menu) =>
    menu.items.flatMap((item) => [
      item,
      ...(item.submenu ? appMenuItems(item.submenu) : []),
    ]);
  const shortcutItem = () =>
    appMenuItems(Menu.getApplicationMenu()).find(
      (item) => item.accelerator === "CmdOrCtrl+Shift+U",
    );
  assert.ok(
    shortcutItem(),
    "Read Aloud / Pause (Cmd/Ctrl+Shift+U) in the View menu while on",
  );

  // --- Off again: the engine window closes, entries hide, the download stays.
  smoke.step("turn off");
  await evaluate(
    toolbar,
    "window.api.browser.readAloud.setSettings({ enabled: false })",
  );
  await waitFor(
    () => engineWindow() === undefined,
    "the engine window to close",
  );
  assert.equal(
    (await commandIds()).some((id) => id.startsWith("readAloud.")),
    false,
  );
  assert.equal(
    (await download()).status,
    "ready",
    "turning off keeps the download",
  );
  await waitFor(
    () => !shortcutItem(),
    "the shortcut to leave the app menu (pages keep the keys)",
  );
  console.log("Electron Read Aloud smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron Read Aloud smoke failed:", error);
    app.exit(1);
  },
);
