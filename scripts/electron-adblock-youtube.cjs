// Live ad-blocking harness: real uBO/EasyList lists, production engine wiring
// (out/main/adblock-engine.js) and the real frame preload. Run `bun run build` first.
//
//   bun run test:electron-youtube              YouTube watch pages (default)
//   bun run test:electron-youtube -- --baseline   same pages with no blocking, for comparison
//   bun run test:electron-adblock-sites        public adblock test pages, with screenshots
//
// Env: SURFFISH_HARNESS_PROXY=socks5://127.0.0.1:1080 to test through the SOCKS proxy,
//      SURFFISH_HARNESS_SECONDS=45 to watch each video longer,
//      SURFFISH_HARNESS_VIDEOS=id1,id2 to pick videos,
//      SURFFISH_OFFSCREEN=1 for headless Linux (with --ozone-platform=headless --disable-gpu).
// Screenshots and a JSON report land in ./adblock-harness-output/.
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, session } = require("electron");

const root = resolve(__dirname, "..");
const enginePath = join(root, "out/main/adblock-engine.js");
const preloadPath = join(root, "out/preload/adblock-frame.cjs");
const outputDirectory = join(root, "adblock-harness-output");
const argv = new Set(process.argv.slice(2));
const baseline = argv.has("--baseline");
const sitesMode = argv.has("--sites");
const watchSeconds = Number(process.env.SURFFISH_HARNESS_SECONDS || 30);
const VIDEOS = (
  process.env.SURFFISH_HARNESS_VIDEOS ||
  "dQw4w9WgXcQ,kJQP7kiw5Fk,JGwWNGJdvx8,9bZkp7q19f0"
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
const TEST_SITES = [
  {
    id: "d3ward-toolz",
    url: "https://d3ward.github.io/toolz/adblock.html",
    waitMs: 20000,
  },
  { id: "adblock-tester", url: "https://adblock-tester.com/", waitMs: 25000 },
  {
    id: "canyoublockit-extreme",
    url: "https://canyoublockit.com/extreme-test/",
    waitMs: 15000,
  },
];

const PLAYER_STATE = `(() => {
  const player = document.querySelector('#movie_player')
  let response = null
  try { response = player && player.getPlayerResponse ? player.getPlayerResponse() : null } catch {}
  if (!response) response = window.ytInitialPlayerResponse || null
  const count = (value) => Array.isArray(value) ? value.length : 0
  let time = null
  try { time = player && player.getCurrentTime ? player.getCurrentTime() : null } catch {}
  return {
    url: location.href,
    hasPlayer: Boolean(player),
    adPlacements: count(response && response.adPlacements),
    playerAds: count(response && response.playerAds),
    adSlots: count(response && response.adSlots),
    adShowing: Boolean(player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))),
    adBadge: Boolean(document.querySelector('.ytp-ad-player-overlay, .ytp-ad-preview-container, .ytp-ad-text, .ytp-ad-module *')),
    feedAds: document.querySelectorAll('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer').length,
    visibleFeedAds: [...document.querySelectorAll('ytd-ad-slot-renderer, ytd-in-feed-ad-layout-renderer, ytd-promoted-sparkles-web-renderer')].filter((node) => node.offsetParent !== null).length,
    enforcement: Boolean(document.querySelector('ytd-enforcement-message-view-model')),
    playability: response && response.playabilityStatus ? response.playabilityStatus.status : null,
    time
  }
})()`;

let window;
let detach;
let latestOffscreenFrame = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function harnessFetch(browserSession, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await browserSession.fetch(url, {
      signal: controller.signal,
    });
    const body = await response.text();
    return new Response(body, { status: response.status });
  } finally {
    clearTimeout(timer);
  }
}

async function screenshot(name) {
  try {
    const image =
      latestOffscreenFrame && !latestOffscreenFrame.isEmpty()
        ? latestOffscreenFrame
        : await window.webContents.capturePage();
    writeFileSync(join(outputDirectory, `${name}.png`), image.toPNG());
  } catch (error) {
    console.warn("screenshot failed", name, error.message);
  }
}

async function acceptConsentIfShown() {
  await window.webContents
    .executeJavaScript(
      `(() => {
    const button = [...document.querySelectorAll('button, tp-yt-paper-button')].find((b) => /accept all|reject all/i.test(b.textContent || b.getAttribute('aria-label') || ''))
    if (button) { button.click(); return true }
    return false
  })()`,
    )
    .catch(() => false);
}

async function watch(label, counters) {
  const samples = [];
  for (let second = 0; second < watchSeconds; second += 1) {
    const state = await window.webContents
      .executeJavaScript(PLAYER_STATE)
      .catch((error) => ({ error: error.message }));
    samples.push(state);
    if (second === 0) {
      // Muted autoplay; nudge playback if the player waits for a click.
      await window.webContents
        .executeJavaScript(
          `(() => { const p = document.querySelector('#movie_player'); try { p && p.mute && p.mute(); p && p.playVideo && p.playVideo() } catch {} })()`,
        )
        .catch(() => {});
    }
    if (second === 5) await screenshot(`${label}-5s`);
    await sleep(1000);
  }
  const last = samples[samples.length - 1] || {};
  const adSeen = samples.some((s) => s.adShowing || s.adBadge);
  const result = {
    label,
    url: last.url,
    playerFound: samples.some((s) => s.hasPlayer),
    adShowingSeen: adSeen,
    maxAdPlacements: Math.max(0, ...samples.map((s) => s.adPlacements || 0)),
    maxPlayerAds: Math.max(0, ...samples.map((s) => s.playerAds || 0)),
    maxAdSlots: Math.max(0, ...samples.map((s) => s.adSlots || 0)),
    visibleFeedAds: last.visibleFeedAds || 0,
    enforcementWall: samples.some((s) => s.enforcement),
    playability: last.playability,
    playedSeconds: last.time,
    pageFixesInjected: counters.pageFixes,
    blockedRequests: counters.blocked,
  };
  await screenshot(`${label}-end`);
  return result;
}

async function runYouTube(counters) {
  const results = [];
  for (const [index, id] of VIDEOS.entries()) {
    counters.pageFixes = 0;
    counters.blocked = 0;
    await window
      .loadURL(`https://www.youtube.com/watch?v=${id}`)
      .catch((error) => console.warn("load failed", id, error.message));
    await sleep(1500);
    await acceptConsentIfShown();
    results.push(await watch(`youtube-${index + 1}-${id}`, counters));

    if (index === 0) {
      // In-app (SPA) navigation to a related video: no new document, so this
      // exercises the fetch/XHR scriptlets rather than the initial page data.
      counters.pageFixes = 0;
      counters.blocked = 0;
      const clicked = await window.webContents
        .executeJavaScript(
          `(() => {
        const link = [...document.querySelectorAll('a[href^="/watch"]')].find((a) => a.offsetParent !== null && !a.href.includes('${id}'))
        if (link) { link.click(); return true }
        return false
      })()`,
        )
        .catch(() => false);
      if (clicked) {
        await sleep(3000);
        results.push(await watch("youtube-spa-navigation", counters));
      }
    }
  }
  return results;
}

async function runSites(counters) {
  const results = [];
  for (const site of TEST_SITES) {
    counters.pageFixes = 0;
    counters.blocked = 0;
    await window
      .loadURL(site.url)
      .catch((error) => console.warn("load failed", site.url, error.message));
    await sleep(site.waitMs);
    const text = await window.webContents
      .executeJavaScript('document.body ? document.body.innerText : ""')
      .catch(() => "");
    const title = await window.webContents
      .executeJavaScript("document.title")
      .catch(() => "");
    // adblock-tester.com renders its live score here; other sites report null.
    const score = await window.webContents
      .executeJavaScript(
        `(() => { const v = document.querySelector('.final-score-value'); return v ? Number(v.textContent.trim()) : null })()`,
      )
      .catch(() => null);
    const percentages = [...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s?%/g)]
      .map((m) => m[0])
      .slice(0, 6);
    const scores = [...text.matchAll(/(\d{1,3})\s*(?:\/|out of)\s*(\d{2,3})/gi)]
      .map((m) => m[0])
      .slice(0, 6);
    await screenshot(`site-${site.id}`);
    results.push({
      site: site.id,
      url: site.url,
      title,
      textLength: text.length,
      score,
      percentages,
      scores,
      blockedRequests: counters.blocked,
      pageFixesInjected: counters.pageFixes,
    });
  }
  return results;
}

async function run() {
  for (const file of [enginePath, preloadPath]) {
    if (!existsSync(file))
      throw new Error(`Missing ${file}; run \`bun run build\` first.`);
  }
  mkdirSync(outputDirectory, { recursive: true });
  app.setPath(
    "userData",
    mkdtempSync(join(tmpdir(), "surffish-adblock-harness-")),
  );
  await app.whenReady();

  const browserSession = session.fromPartition("surffish-adblock-harness");
  if (process.env.SURFFISH_HARNESS_PROXY)
    await browserSession.setProxy({
      proxyRules: process.env.SURFFISH_HARNESS_PROXY,
    });

  const counters = { blocked: 0, pageFixes: 0 };
  let listInfo = {
    loadedLists: [],
    failedLists: [],
    networkFilters: 0,
    cosmeticFilters: 0,
  };
  if (!baseline) {
    const engineModule = await import(pathToFileURL(enginePath).href);
    const started = Date.now();
    const built = await engineModule.buildFilterEngine((url) =>
      harnessFetch(browserSession, url),
    );
    const filters = built.engine.getFilters();
    listInfo = {
      loadedLists: built.loadedLists,
      failedLists: built.failedLists,
      networkFilters: filters.networkFilters.length,
      cosmeticFilters: filters.cosmeticFilters.length,
      buildMs: Date.now() - started,
    };
    console.log("Filter engine ready:", JSON.stringify(listInfo));
    detach = engineModule.attachAdblockToSession(
      browserSession,
      {
        getEngine: () => built.engine,
        pageUrlForRequest: (details) =>
          details.resourceType === "mainFrame"
            ? details.url
            : details.referrer || "",
        isBlockingDisabledForPage: () => false,
        onRequest: (_details, response) => {
          if (response.cancel || response.redirectURL) counters.blocked += 1;
        },
        onFrameStart: (payload) => {
          counters.pageFixes += payload.scripts.length;
        },
      },
      preloadPath,
    );
  }

  window = new BrowserWindow({
    show:
      process.env.SURFFISH_OFFSCREEN !== "1" &&
      process.env.SURFFISH_HARNESS_SHOW === "1",
    width: 1280,
    height: 860,
    webPreferences: {
      session: browserSession,
      contextIsolation: true,
      sandbox: true,
      nodeIntegrationInSubFrames: true,
      autoplayPolicy: "no-user-gesture-required",
      offscreen: process.env.SURFFISH_OFFSCREEN === "1",
    },
  });
  window.webContents.setAudioMuted(true);
  if (process.env.SURFFISH_OFFSCREEN === "1") {
    window.webContents.setFrameRate(5);
    window.webContents.on("paint", (_event, _dirty, image) => {
      latestOffscreenFrame = image;
    });
  }

  const results = sitesMode
    ? await runSites(counters)
    : await runYouTube(counters);
  const report = {
    mode: sitesMode ? "sites" : "youtube",
    baseline,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    at: new Date().toISOString(),
    lists: listInfo,
    results,
  };
  writeFileSync(
    join(
      outputDirectory,
      `report-${report.mode}${baseline ? "-baseline" : ""}.json`,
    ),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));

  if (!sitesMode && !baseline) {
    const inconclusive = results.filter((r) => !r.playerFound);
    const failures = results.filter(
      (r) =>
        r.playerFound &&
        (r.adShowingSeen ||
          r.enforcementWall ||
          r.maxAdPlacements > 0 ||
          r.maxPlayerAds > 0 ||
          r.visibleFeedAds > 0),
    );
    if (failures.length > 0) {
      console.error(
        `YouTube ads or anti-adblock detected on ${failures.length}/${results.length} pages:`,
        failures.map((f) => f.label).join(", "),
      );
      process.exitCode = 1;
    } else if (inconclusive.length === results.length) {
      // e.g. YouTube's "unusual traffic" page for datacenter IPs: nothing was tested.
      console.error(
        "Inconclusive: no YouTube player loaded (consent/captcha page?). See the screenshots.",
      );
      process.exitCode = 2;
    } else {
      console.log(
        `No YouTube ads detected on ${results.length - inconclusive.length} pages${inconclusive.length ? ` (${inconclusive.length} inconclusive)` : ""}.`,
      );
    }
  }
}

async function cleanup() {
  try {
    detach?.();
  } catch {}
  if (window && !window.isDestroyed()) window.destroy();
  if (app.isReady()) app.quit();
}

run()
  .then(cleanup)
  .catch(async (error) => {
    console.error("Ad-block harness failed:", error);
    process.exitCode = 1;
    await cleanup();
  });
