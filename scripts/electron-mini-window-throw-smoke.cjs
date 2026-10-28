// Throw smoke for mini windows (real pointer under Xvfb), against the production build. A mini window
// is dragged by its floating header with the real pointer (xdotool) and let go while still moving;
// every BaseWindow.setBounds is traced, then:
//   1. Glide: it carries on in the throw's direction after release (several frame-paced steps, one
//      setBounds per tick, slowing down), its floating header in the same tick, and stops on screen.
//   2. Edge: thrown hard at the left edge (tucking off) it eases into the edge and stops flush, never
//      past it.
//   3. Grab: pressing the header again mid-glide stops it at once.
//   4. No throw: a slow drag, a pointer that rested before letting go, the setting off, Reduce Motion.
//   5. Fling to tuck: a fast throw at the right edge (tucking on) tucks it, the slide carrying on in
//      the throw's direction (no jump back, no restart).
//   6. Stack: the leader of a docked 'stack' group thrown along its edge: the follower and the floating
//      header move in the same tick as the leader for the whole glide.
//   7. Handle: a tucked handle let go while moving along the edge glides on.
// `bun run build && bun run test:electron-mini-window-throw` (headless Linux: xvfb-run; needs xdotool).
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  app,
  BaseWindow,
  screen,
  systemPreferences,
  webContents: allWebContents,
} = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(
  tmpdir(),
  `surffish-mini-window-throw-smoke-${process.pid}`,
);
const PAGE = (n) =>
  `<!doctype html><meta charset="utf-8"><title>Throw ${n}</title><body style="margin:0;font:16px system-ui"><p>Throw ${n}</p></body>`;
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const page = /^\/t(\d)$/.exec(path);
  const body =
    path === "/start"
      ? "<!doctype html><title>Start</title><p>start</p>"
      : page
        ? PAGE(Number(page[1]))
        : null;
  response.writeHead(body ? 200 : 404, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body ?? "not found");
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
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${description}.${lastError ? ` Last error: ${lastError}` : ""}`,
  );
}
function pointerMove(x, y) {
  execFileSync("xdotool", [
    "mousemove",
    String(Math.round(x)),
    String(Math.round(y)),
  ]);
}
/** Move the real pointer from `from` by (dx, dy) in `steps` moves, `stepMs` apart: one async xdotool process (a blocking exec would stall main's timers). */
function pointerGlide(from, dx, dy, steps, stepMs) {
  const args = [];
  for (let i = 1; i <= steps; i++)
    args.push(
      "mousemove",
      String(Math.round(from.x + (dx * i) / steps)),
      String(Math.round(from.y + (dy * i) / steps)),
      "sleep",
      String(stepMs / 1000),
    );
  return new Promise((resolvePromise, reject) =>
    execFile("xdotool", args, (error) =>
      error ? reject(error) : resolvePromise(),
    ),
  );
}

// --- setBounds trace.
let trace = null;
let lastSetBounds = 0;
const realSetBounds = BaseWindow.prototype.setBounds;
BaseWindow.prototype.setBounds = function setBounds(rect, ...rest) {
  if (!this.isDestroyed()) lastSetBounds = performance.now();
  if (trace && !this.isDestroyed() && this.isVisible())
    trace.push({ t: performance.now(), id: this.id, rect: { ...rect } });
  return realSetBounds.call(this, rect, ...rest);
};
const quiet = (ms = 300) =>
  waitFor(
    () => performance.now() - lastSetBounds >= ms,
    "the mini windows to stop moving",
  );

const liveContents = () =>
  allWebContents
    .getAllWebContents()
    .filter((contents) => !contents.isDestroyed());
const pageContents = (predicate) =>
  liveContents().find((contents) => predicate(contents.getURL(), contents));
const dataTitled = (title) => (contents) =>
  contents.getURL().startsWith("data:text/html") &&
  decodeURIComponent(contents.getURL()).includes(`<title>${title}</title>`);
const isHandlePage = dataTitled("Mini Window Handle");
const isMiniHeader = dataTitled("Mini Window");
const surfaceFor = (view) => {
  try {
    return new URL(view.webContents.getURL()).searchParams.get("surface");
  } catch {
    return null;
  }
};
const allWindows = () =>
  BaseWindow.getAllWindows().filter((win) => !win.isDestroyed());
const miniWindows = () =>
  allWindows().filter((win) => /(^| — )Mini Window$/.test(win.getTitle()));
const handleWindows = () =>
  allWindows().filter((win) => win.getTitle() === "Mini Window Handle");
const visibleHandles = () => handleWindows().filter((win) => win.isVisible());
const panelWindows = () =>
  allWindows().filter((win) => win.getTitle() === "Mini Window Header");
const viewOf = (win, contents) =>
  win.contentView.children.find((view) => view.webContents === contents);
const hostOf = (contents) => allWindows().find((win) => viewOf(win, contents));
const handlePage = (win) =>
  win.contentView.children.find(
    (view) => view.webContents && isHandlePage(view.webContents),
  )?.webContents;

/** For each step of `lead` after `from`, how far (ms) the nearest step of `other` was (same tick ≈ 0). */
function skew(events, lead, other) {
  const a = events.filter((event) => event.id === lead);
  const b = events.filter((event) => event.id === other);
  if (a.length === 0 || b.length === 0) return [Infinity];
  return a.map((x) => Math.min(...b.map((y) => Math.abs(x.t - y.t))));
}
const max = (values) => values.reduce((m, v) => Math.max(m, v), 0);

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
  const origin = `http://127.0.0.1:${server.address().port}`;
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({ version: 1, tabs: [`${origin}/start`], activeIndex: 0 }),
  );
  // No throwMomentum key: an older settings file, which must default to on.
  writeFileSync(
    join(userData, "browser-mini-window.json"),
    JSON.stringify({
      defaultUrl: "",
      shortcut: "CommandOrControl+Shift+Space",
      opacity: 1,
      tuckToEdge: false,
      peekOnHover: false,
      peekDelayMs: 200,
      grouping: "separate",
      headerPlacement: "float",
    }),
  );

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  const mainWindow = await waitFor(() => allWindows()[0], "the main window");
  mainWindow.setBounds({ x: 0, y: 0, width: 900, height: 700 });
  const surface = (win, name) =>
    win.contentView.children.find(
      (view) =>
        view.webContents &&
        !view.webContents.isDestroyed() &&
        surfaceFor(view) === name,
    );
  await waitFor(
    () => surface(mainWindow, "content") && surface(mainWindow, "toolbar"),
    "the renderer surfaces",
  );
  const toolbar = surface(mainWindow, "toolbar").webContents;
  const content = surface(mainWindow, "content").webContents;
  await waitFor(
    () =>
      smoke.evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  await waitFor(
    () =>
      smoke.evaluate(
        content,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the content renderer",
  );
  const tabs = () => smoke.evaluate(toolbar, "window.api.browser.tabs.get()");
  const runCommand = (id) =>
    smoke.evaluate(
      toolbar,
      `window.api.browser.commands.run(${JSON.stringify(id)})`,
    );
  const update = (patch) =>
    smoke.evaluate(
      content,
      `window.api.browser.miniWindow.update(${JSON.stringify(patch)})`,
    );
  const getSettings = () =>
    smoke.evaluate(content, "window.api.browser.miniWindow.getSettings()");
  const wa = screen.getPrimaryDisplay().workArea;
  const frameMs = 1000 / (screen.getPrimaryDisplay().displayFrequency || 60);
  const park = async () => {
    pointerMove(wa.x + 290, wa.y + 395);
    await delay(60);
    pointerMove(wa.x + 300, wa.y + 400);
    await delay(60);
  };
  await park();

  smoke.step("settings: throw with momentum defaults to on");
  const initial = await getSettings();
  assert.equal(
    initial.settings.throwMomentum,
    true,
    "an older settings file migrates to throw on",
  );

  const pages = [];
  for (const n of [1, 2]) {
    await smoke.evaluate(
      toolbar,
      `window.api.browser.tabs.create(${JSON.stringify(`${origin}/t${n}`)})`,
    );
    const contents = await waitFor(
      () =>
        pageContents((url, c) => url === `${origin}/t${n}` && !c.isLoading()),
      `page t${n}`,
    );
    pages.push({
      n,
      contents,
      id: (await tabs()).find((tab) => tab.url === `${origin}/t${n}`).id,
    });
  }
  const miniWith = (entry) =>
    miniWindows().find((win) => viewOf(win, entry.contents));
  const popOut = async (entry) => {
    await smoke.evaluate(
      toolbar,
      `window.api.browser.tabs.activate(${JSON.stringify(entry.id)})`,
    );
    await waitFor(
      async () => (await tabs()).find((tab) => tab.active)?.id === entry.id,
      `t${entry.n} active`,
    );
    await runCommand("miniWindow.popOut");
    const win = await waitFor(() => miniWith(entry), `mini t${entry.n}`);
    await waitFor(() => win.isVisible(), "shown");
    return win;
  };
  const [t1, t2] = pages;
  const w1 = await popOut(t1);
  await delay(500);

  /** Reveal `win`'s floating header (pointer near its top) and find where to grab it. */
  async function grabPoint(win, entry) {
    const bounds = win.getContentBounds();
    pointerMove(bounds.x + 150, bounds.y + 8);
    entry.contents.sendInputEvent({ type: "mouseMove", x: 150, y: 8 });
    const panel = await waitFor(
      () =>
        panelWindows().find(
          (candidate) =>
            candidate.isVisible() &&
            Math.abs(candidate.getBounds().x - win.getBounds().x) <= 1,
        ),
      "the floating header",
      3000,
    );
    const header = liveContents().find(
      (contents) => isMiniHeader(contents) && hostOf(contents) === panel,
    );
    const at = await smoke.evaluate(
      header,
      '(() => { const r = document.getElementById("where").getBoundingClientRect(); return { x: Math.round(r.x + 12), y: Math.round(r.y + r.height / 2) } })()',
    );
    const pb = panel.getContentBounds();
    return { panel, header, at, start: { x: pb.x + at.x, y: pb.y + at.y } };
  }

  /**
   * Drag `win` by its floating header: press, move the real pointer (dx, dy) over `steps` moves `stepMs`
   * apart, wait `restMs`, let go. Returns the trace from the press until it has stopped moving, and
   * the time it was let go.
   */
  async function headerThrow(
    win,
    entry,
    { dx, dy, steps = 30, stepMs = 4, restMs = 0, afterRelease = null },
  ) {
    await quiet(200);
    const grab = await grabPoint(win, entry);
    pointerMove(grab.start.x, grab.start.y);
    grab.header.sendInputEvent({
      type: "mouseMove",
      x: grab.at.x,
      y: grab.at.y,
    });
    await delay(80);
    grab.header.sendInputEvent({
      type: "mouseDown",
      x: grab.at.x,
      y: grab.at.y,
      button: "left",
      clickCount: 1,
    });
    await delay(80);
    trace = [];
    await pointerGlide(grab.start, dx, dy, steps, stepMs);
    if (restMs) await delay(restMs);
    const releasedAt = performance.now();
    const atRelease = win.getBounds();
    grab.header.sendInputEvent({
      type: "mouseUp",
      x: grab.at.x,
      y: grab.at.y,
      button: "left",
      clickCount: 1,
    });
    if (afterRelease) await afterRelease(grab);
    await quiet(300);
    const events = trace;
    trace = null;
    const after = events.filter((event) => event.t > releasedAt + 2);
    return {
      grab,
      events,
      after,
      releasedAt,
      atRelease,
      final: win.getBounds(),
    };
  }

  smoke.step("1. glide after a throw");
  w1.setBounds({ x: wa.x + 400, y: wa.y + 300, width: 420, height: 300 });
  await delay(400);
  const glide = await headerThrow(w1, t1, {
    dx: 180,
    dy: 0,
    steps: 30,
    stepMs: 4,
  });
  const glideSteps = glide.after.filter((event) => event.id === w1.id);
  console.log(
    `THROW glide: released at x=${glide.atRelease.x}, ${glideSteps.length} steps after release, stopped at x=${glide.final.x}`,
  );
  assert.ok(
    glideSteps.length >= 4,
    `it glides on after release (${glideSteps.length} steps)`,
  );
  assert.ok(
    glide.final.x >= glide.atRelease.x + 30,
    `it carried on to the right (${glide.atRelease.x} → ${glide.final.x})`,
  );
  for (let i = 1; i < glideSteps.length; i++)
    assert.ok(
      glideSteps[i].rect.x >= glideSteps[i - 1].rect.x,
      "never turns back",
    );
  // Slowing down: the last steps are shorter than the first ones.
  const stepSizes = glideSteps
    .slice(1)
    .map((event, i) => event.rect.x - glideSteps[i].rect.x);
  if (stepSizes.length >= 4)
    assert.ok(
      stepSizes.at(-1) < stepSizes[0],
      `it slows down (${stepSizes.join(",")})`,
    );
  for (let i = 1; i < glideSteps.length; i++)
    assert.ok(
      glideSteps[i].t - glideSteps[i - 1].t >= 2,
      "one setBounds per tick",
    );
  assert.ok(
    glide.final.x + glide.final.width <= wa.x + wa.width &&
      glide.final.x >= wa.x,
    "stops on screen",
  );
  assert.equal(
    glide.final.y,
    glide.atRelease.y,
    "a horizontal throw stays at its height",
  );
  const panelSkew = max(skew(glide.after, w1.id, glide.grab.panel.id));
  assert.ok(
    panelSkew <= 2,
    `the floating header moves in the same tick (max ${panelSkew.toFixed(1)} ms)`,
  );
  await park();

  smoke.step("2. thrown hard at the left edge: eases in, stops flush");
  w1.setBounds({ x: wa.x + 260, y: wa.y + 300, width: 420, height: 300 });
  await delay(400);
  const edge = await headerThrow(w1, t1, {
    dx: -200,
    dy: 0,
    steps: 25,
    stepMs: 4,
  });
  const edgeSteps = edge.after.filter((event) => event.id === w1.id);
  console.log(
    `THROW edge: released at x=${edge.atRelease.x}, ${edgeSteps.length} steps, stopped at x=${edge.final.x} (work area x=${wa.x})`,
  );
  assert.equal(edge.final.x, wa.x, "stops flush with the left edge");
  for (const event of edgeSteps)
    assert.ok(event.rect.x >= wa.x, `never past the edge (${event.rect.x})`);
  assert.ok(
    edgeSteps.length >= 2,
    `it eased into the edge (${edgeSteps.length} steps)`,
  );
  await park();

  smoke.step("3. grabbing it again mid-glide stops it");
  w1.setBounds({ x: wa.x + 300, y: wa.y + 300, width: 420, height: 300 });
  await delay(400);
  let grabbedAt = 0;
  const grabbed = await headerThrow(w1, t1, {
    dx: 200,
    dy: 0,
    steps: 25,
    stepMs: 4,
    afterRelease: async (grab) => {
      await delay(70);
      grabbedAt = performance.now();
      grab.header.sendInputEvent({
        type: "mouseDown",
        x: grab.at.x,
        y: grab.at.y,
        button: "left",
        clickCount: 1,
      });
      await delay(300);
      grab.header.sendInputEvent({
        type: "mouseUp",
        x: grab.at.x,
        y: grab.at.y,
        button: "left",
        clickCount: 1,
      });
    },
  });
  const beforeGrab = grabbed.after.filter(
    (event) => event.id === w1.id && event.t < grabbedAt,
  );
  const afterGrab = grabbed.after.filter(
    (event) => event.id === w1.id && event.t > grabbedAt + frameMs * 1.5,
  );
  console.log(
    `THROW grab: ${beforeGrab.length} steps before the grab, ${afterGrab.length} after`,
  );
  assert.ok(beforeGrab.length >= 1, "it was gliding when grabbed");
  assert.equal(
    afterGrab.length,
    0,
    "grabbing it stops the glide at once (and a press without moving throws nothing)",
  );
  await park();

  smoke.step(
    "4. no throw: slow drag, rested pointer, setting off, Reduce Motion",
  );
  const noThrow = async (label, options) => {
    w1.setBounds({ x: wa.x + 400, y: wa.y + 300, width: 420, height: 300 });
    await delay(400);
    const result = await headerThrow(w1, t1, options);
    const moves = result.after.filter((event) => event.id === w1.id);
    console.log(`THROW ${label}: ${moves.length} moves after release`);
    assert.equal(moves.length, 0, `${label}: stays where it was let go`);
    await park();
  };
  // ~0.1 px/ms: under the threshold.
  await noThrow("slow drag", { dx: 60, dy: 0, steps: 30, stepMs: 20 });
  await noThrow("rested before letting go", {
    dx: 180,
    dy: 0,
    steps: 30,
    stepMs: 4,
    restMs: 200,
  });
  assert.equal((await update({ throwMomentum: false })).ok, true);
  await noThrow("setting off", { dx: 180, dy: 0, steps: 30, stepMs: 4 });
  assert.equal((await update({ throwMomentum: true })).ok, true);
  const realAnimationSettings = systemPreferences.getAnimationSettings;
  systemPreferences.getAnimationSettings = () => ({
    ...realAnimationSettings.call(systemPreferences),
    prefersReducedMotion: true,
  });
  try {
    await noThrow("Reduce Motion", { dx: 180, dy: 0, steps: 30, stepMs: 4 });
  } finally {
    systemPreferences.getAnimationSettings = realAnimationSettings;
  }

  smoke.step("5. fling at the right edge tucks it");
  assert.equal((await update({ tuckToEdge: true })).ok, true);
  w1.setBounds({
    x: wa.x + wa.width - 420 - 260,
    y: wa.y + 300,
    width: 420,
    height: 300,
  });
  await delay(400);
  const fling = await headerThrow(w1, t1, {
    dx: 220,
    dy: 0,
    steps: 20,
    stepMs: 4,
  });
  await waitFor(
    () => !w1.isVisible() && visibleHandles().length === 1,
    "flung into a tuck",
    3000,
  );
  const flingSteps = fling.after.filter((event) => event.id === w1.id);
  console.log(
    `THROW fling: released at x=${fling.atRelease.x}, ${flingSteps.length} steps, ${flingSteps.map((event) => event.rect.x).join(",")}`,
  );
  assert.ok(
    flingSteps.length >= 2,
    `the tuck slides (${flingSteps.length} steps)`,
  );
  assert.ok(
    flingSteps[0].rect.x > fling.atRelease.x,
    "the first step carries on to the right from where it was let go",
  );
  for (let i = 1; i < flingSteps.length; i++)
    assert.ok(
      flingSteps[i].rect.x >= flingSteps[i - 1].rect.x,
      "never jumps back (the throw carries on into the tuck)",
    );
  assert.ok(
    flingSteps.at(-1).rect.x >= wa.x + wa.width,
    "ends past the right edge (tucked)",
  );
  await park();

  smoke.step(
    "6. stack: the leader thrown along its edge, follower and header in step",
  );
  assert.equal((await update({ grouping: "stack" })).ok, true);
  await delay(500);
  // w1 is tucked on the right edge; dock w2 on the same edge below it, then bring the group out.
  const w2 = await popOut(t2);
  w2.setBounds({
    x: wa.x + wa.width - 420 + 60,
    y: wa.y + 520,
    width: 420,
    height: 300,
  });
  await waitFor(
    () => !w2.isVisible() && visibleHandles().length === 1,
    "the stack tucked behind one handle",
  );
  await delay(800);
  await runCommand("miniWindow.toggle");
  await waitFor(() => w1.isVisible() && w2.isVisible(), "the group out");
  await delay(800);
  const [leaderWin, followerWin] = [w1, w2].sort(
    (a, b) => a.getBounds().y - b.getBounds().y,
  );
  const leaderEntry = leaderWin === w1 ? t1 : t2;
  // Up along the edge (the follower below has room to come along), ~1 px/ms: under the fling speed, so it glides rather than tucking.
  const stack = await headerThrow(leaderWin, leaderEntry, {
    dx: 0,
    dy: -100,
    steps: 25,
    stepMs: 4,
  });
  const leaderSteps = stack.after.filter((event) => event.id === leaderWin.id);
  const followerSteps = stack.after.filter(
    (event) => event.id === followerWin.id,
  );
  const stackPanelSkew = max(
    skew(
      stack.after.filter(
        (event) => leaderSteps.length && event.t <= leaderSteps.at(-1).t + 1,
      ),
      leaderWin.id,
      stack.grab.panel.id,
    ),
  );
  const followerSkew = max(
    skew(
      stack.after.filter(
        (event) => leaderSteps.length && event.t <= leaderSteps.at(-1).t + 1,
      ),
      leaderWin.id,
      followerWin.id,
    ),
  );
  console.log(
    `THROW stack: leader ${leaderSteps.length} steps, follower ${followerSteps.length}, skew header ${stackPanelSkew.toFixed(1)} ms, follower ${followerSkew.toFixed(1)} ms`,
  );
  assert.ok(
    leaderSteps.length >= 3,
    `the leader glides (${leaderSteps.length} steps)`,
  );
  assert.ok(
    followerSteps.length >= 3,
    `the follower comes along (${followerSteps.length} steps)`,
  );
  assert.ok(
    stackPanelSkew <= 2,
    `the floating header moves in the same tick as the leader (max ${stackPanelSkew.toFixed(1)} ms)`,
  );
  assert.ok(
    followerSkew <= 2,
    `the follower moves in the same tick as the leader (max ${followerSkew.toFixed(1)} ms)`,
  );
  assert.ok(stack.final.y >= wa.y, "the leader stops on screen");
  await park();

  smoke.step("7. a tucked handle let go while moving glides along the edge");
  await runCommand("miniWindow.toggle");
  await waitFor(() => !w1.isVisible() && !w2.isVisible(), "the group tucked");
  await delay(800);
  const handle = visibleHandles()[0];
  const contents = handlePage(handle);
  await waitFor(
    () =>
      !contents.isLoading() &&
      smoke.evaluate(
        contents,
        "Boolean(window.miniWindow) && document.body.className.length > 0",
      ),
    "the handle page",
  );
  const hb = handle.getBounds();
  const { width: hw, height: hh } = handle.getContentBounds();
  const hx = Math.floor(hw / 2);
  const hy = Math.floor(hh / 2);
  const hStart = { x: hb.x + hx, y: hb.y + hy };
  pointerMove(hStart.x, hStart.y);
  contents.sendInputEvent({ type: "mouseMove", x: hx, y: hy });
  contents.sendInputEvent({
    type: "mouseDown",
    x: hx,
    y: hy,
    button: "left",
    clickCount: 1,
  });
  await delay(50);
  // Past the page's drag threshold (main then follows the real pointer).
  contents.sendInputEvent({
    type: "mouseMove",
    x: hx,
    y: hy + 8,
    modifiers: ["leftButtonDown"],
  });
  await delay(80);
  await quiet(150);
  trace = [];
  await pointerGlide(hStart, 0, 120, 25, 4);
  const handleReleasedAt = performance.now();
  const handleAtRelease = handle.getBounds();
  contents.sendInputEvent({
    type: "mouseUp",
    x: hx,
    y: hy + 8,
    button: "left",
    clickCount: 1,
  });
  await quiet(300);
  const handleEvents = trace;
  trace = null;
  const handleSteps = handleEvents.filter(
    (event) => event.id === handle.id && event.t > handleReleasedAt + 2,
  );
  console.log(
    `THROW handle: released at y=${handleAtRelease.y}, ${handleSteps.length} steps after release, now y=${handle.getBounds().y}`,
  );
  assert.ok(
    handleSteps.length >= 3,
    `the handle glides on along the edge (${handleSteps.length} steps)`,
  );
  assert.ok(
    handle.getBounds().y > handleAtRelease.y,
    "in the direction it was thrown",
  );
  assert.ok(
    handle.getBounds().y + handle.getBounds().height <= wa.y + wa.height,
    "and stops on the edge",
  );
  contents.sendInputEvent({ type: "mouseLeave", x: -1, y: -1 });

  await runCommand("miniWindow.return");
  await waitFor(
    () => miniWindows().length === 0 && handleWindows().length === 0,
    "all closed",
  );
  console.log("Electron mini window throw smoke passed.");
}

run().then(
  () => app.exit(0),
  (error) => {
    console.error("Electron mini window throw smoke failed:", error);
    app.exit(1);
  },
);
