// Integration smoke for address bar "arrow to fill" (Chrome/Firefox style): Up/Down (and Tab) onto a
// suggestion puts its full URL in the bar with the caret at the end and the dropdown unchanged;
// editing that text re-queries and Enter goes to the edited address; Esc puts back what was typed,
// a second Esc goes back to the page URL; hovering a row never changes the bar.
// Runs the production build: `bun run build && bun run test:electron-omnibox-fill`
// (headless Linux: `xvfb-run -a electron --no-sandbox scripts/electron-omnibox-fill-smoke.cjs`).
// SURFFISH_SMOKE_SCREENSHOTS=<dir> also saves the dropdown before and after arrowing.
const smoke = require("./smoke-harness.cjs");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BaseWindow } = require("electron");
const { ElectronBlocker } = require("@ghostery/adblocker-electron");

const userData = join(tmpdir(), `surffish-omnibox-fill-smoke-${process.pid}`);
const screenshots = process.env.SURFFISH_SMOKE_SCREENSHOTS;
const HOST = "www.surftube.test";
// The fixture site gets a real-looking host (www., a dotted name) so the URL formatting is exercised.
app.commandLine.appendSwitch("host-resolver-rules", `MAP ${HOST} 127.0.0.1`);

const TITLES = {
  "/@veritasium": "Veritasium - YouTube",
  "/@3blue1brown": "3Blue1Brown - YouTube",
  "/@vsauce": "Vsauce - YouTube",
  "/home": "Home",
};
const server = createServer((request, response) => {
  const path = (request.url || "/").split("?")[0];
  const title = TITLES[path] || `Channel ${path}`;
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(
    `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;padding:24px;background:#f5f5f4"><h1>${title}</h1></body>`,
  );
});

let mainWindow;
const delay = (ms) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

async function waitFor(
  predicate,
  description,
  timeout = Number(process.env.SMOKE_WAIT_MS || 20000),
) {
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

async function evaluate(contents, expression) {
  try {
    return await contents.executeJavaScript(expression);
  } catch (error) {
    throw new Error(`${expression.slice(0, 120)}: ${error.message}`);
  }
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
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  const origin = `http://${HOST}:${server.address().port}`;
  writeFileSync(
    join(userData, "browser-session.json"),
    JSON.stringify({
      version: 1,
      tabs: [`${origin}/@veritasium`],
      activeIndex: 0,
    }),
  );

  await import(pathToFileURL(resolve(__dirname, "../out/main/index.js")).href);
  await app.whenReady();
  mainWindow = await waitFor(
    () => BaseWindow.getAllWindows()[0],
    "the main window",
  );
  mainWindow.setBounds({ x: 0, y: 0, width: 1500, height: 800 });
  await waitFor(
    () => surface("content") && surface("toolbar") && surface("sidebar"),
    "the renderer surfaces",
  );
  const toolbar = surface("toolbar").webContents;
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'document.readyState === "complete" && Boolean(window.api)',
      ),
    "the toolbar renderer",
  );
  const state = () => evaluate(toolbar, "window.api.browser.state()");
  const INPUT = 'document.querySelector(".browser-toolbar input[type=text]")';
  const bar = () => evaluate(toolbar, `${INPUT}.value`);
  const caret = () =>
    evaluate(
      toolbar,
      `[${INPUT}.selectionStart, ${INPUT}.selectionEnd, ${INPUT}.value.length]`,
    );
  const rows = () =>
    evaluate(
      toolbar,
      'Array.from(document.querySelectorAll("#address-suggestions .address-suggestion:not(.keyword-suggestion)")).map((row) => ({ url: row.querySelector(".suggestion-url")?.getAttribute("title") ?? "", source: row.querySelector(".suggestion-source")?.textContent ?? "", selected: row.classList.contains("is-selected") }))',
    );
  // main's state() answers at once, but the toolbar renderer hears about a navigation from the tab
  // broadcast (coalesced per frame), so it can still show the previous page for a moment. Every
  // step below types into that renderer, so wait until it, not just main, is on the page.
  const visit = async (path) => {
    await evaluate(
      toolbar,
      `window.api.browser.navigate(${JSON.stringify(`${origin}${path}`)})`,
    );
    await waitFor(async () => {
      const current = await state();
      return current.url === `${origin}${path}` && !current.loading;
    }, `the ${path} page`);
    await waitFor(
      async () => (await bar()) === `${origin}${path}`,
      `the toolbar showing ${path}`,
    );
  };
  // History, oldest first; ends on /home so the three channels are History rows.
  await waitFor(async () => {
    const current = await state();
    return current.url === `${origin}/@veritasium` && !current.loading;
  }, "the first page");
  await visit("/@3blue1brown");
  await visit("/@vsauce");
  await visit("/home");
  // Every visit recorded with its title, so a history refresh while the dropdown is open (it
  // refreshes on focus) can't reorder the rows under the arrow keys.
  await waitFor(async () => {
    const entries = await evaluate(toolbar, "window.api.browser.history.get()");
    return Object.entries(TITLES).every(([path, title]) =>
      entries.some(
        (entry) => entry.url === `${origin}${path}` && entry.title === title,
      ),
    );
  }, "history entries for every visit, with titles");
  const dropdownOpen = () =>
    evaluate(
      toolbar,
      'Boolean(document.querySelector("#address-suggestions"))',
    );
  const key = (keyCode, modifiers = []) => {
    toolbar.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    if (keyCode === "Enter")
      toolbar.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
    toolbar.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  };
  const focusBar = async () => {
    toolbar.focus();
    await evaluate(
      toolbar,
      `(() => { ${INPUT}.focus(); ${INPUT}.select() })()`,
    );
    await waitFor(
      () =>
        evaluate(
          toolbar,
          `document.activeElement === ${INPUT} && document.hasFocus()`,
        ),
      "the focused address bar",
    );
  };
  const typeQuery = async (text) => {
    await focusBar();
    await toolbar.insertText(text);
    await waitFor(
      async () => (await bar()) === text,
      `the typed text ${JSON.stringify(text)}`,
    ).catch(async (error) => {
      throw new Error(
        `${error.message} — bar shows ${JSON.stringify(await bar())}`,
      );
    });
    // Settled: the open tab row is the page the tab is on now (the toolbar's tab list is current),
    // so the rows can't reshuffle while the test arrows through them.
    const page = (await state()).url;
    return waitFor(async () => {
      const list = await rows();
      return (
        list.length >= 3 &&
        list.some((row) => row.source === "Open tab" && row.url === page) &&
        list
      );
    }, "History suggestions for the query");
  };
  const expectBar = (value, description) =>
    waitFor(async () => (await bar()) === value, description).catch(
      async (error) => {
        throw new Error(
          `${error.message} — bar shows ${JSON.stringify(await bar())}`,
        );
      },
    );
  const shot = async (name) => {
    if (!screenshots) return;
    mkdirSync(screenshots, { recursive: true });
    await delay(250);
    const image = await toolbar.capturePage();
    const size = image.getSize();
    writeFileSync(
      join(screenshots, `${name}.png`),
      image
        .crop({
          x: 0,
          y: 0,
          width: size.width,
          height: Math.min(size.height, 460),
        })
        .toPNG(),
    );
  };

  // --- arrowing fills the bar with each row's full URL, caret at the end, list unchanged
  const typed = "surftube";
  const initial = await typeQuery(typed);
  const urls = initial.map((row) => row.url);
  await shot("omnibox-typed");
  key("Down");
  await expectBar(urls[0], "Down fills the first row");
  const [start, end, length] = await caret();
  assert.equal(start, length, "caret at the end");
  assert.equal(end, length, "nothing selected");
  assert.equal(
    await evaluate(
      toolbar,
      `${INPUT}.scrollWidth <= ${INPUT}.clientWidth || ${INPUT}.scrollLeft > 0`,
    ),
    true,
    "the field scrolls to show the caret",
  );
  assert.deepEqual(
    (await rows()).map((row) => row.url),
    urls,
    "the dropdown keeps matching the typed text",
  );
  assert.equal(
    (await rows())[0].selected,
    true,
    "the filled row is highlighted",
  );
  key("Down");
  await expectBar(urls[1], "Down again fills the second row");
  await shot("omnibox-arrow-filled");
  key("Up");
  await expectBar(urls[0], "Up goes back a row");
  key("Tab");
  await expectBar(urls[1], "Tab moves down like Chrome");
  key("Tab", ["shift"]);
  await expectBar(urls[0], "Shift+Tab moves up");
  key("Up");
  await expectBar(typed, "Up from the first row returns to the typed text");

  // --- Esc puts back what was typed (dropdown stays), a second Esc reverts to the page URL
  key("Down");
  key("Down");
  await expectBar(urls[1], "arrowed to the second row");
  key("Escape");
  await expectBar(typed, "first Esc restores the typed text");
  assert.equal(
    await dropdownOpen(),
    true,
    "the dropdown stays open after the first Esc",
  );
  key("Escape");
  await expectBar(`${origin}/home`, "second Esc reverts to the page URL");

  // --- hovering a row never changes the bar
  await typeQuery(typed);
  const rect = await evaluate(
    toolbar,
    '(() => { const r = document.querySelectorAll("#address-suggestions .address-suggestion:not(.keyword-suggestion)")[1].getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()',
  );
  toolbar.sendInputEvent({ type: "mouseMove", x: rect.x - 4, y: rect.y });
  toolbar.sendInputEvent({ type: "mouseMove", x: rect.x, y: rect.y });
  await waitFor(
    () =>
      evaluate(
        toolbar,
        'Boolean(document.querySelectorAll("#address-suggestions .address-suggestion:not(.keyword-suggestion)")[1]?.matches(":hover"))',
      ),
    "the hovered row",
  );
  await delay(250);
  assert.equal(await bar(), typed, "hover does not fill the bar");
  assert.equal(
    (await rows()).some((row) => row.selected),
    false,
    "hover does not select a row",
  );
  toolbar.sendInputEvent({ type: "mouseMove", x: 5, y: 700 });

  // --- edit a filled-in URL into a similar one; the edit sticks and Enter goes there
  const channelRow = urls.findIndex((url) => url.includes("/@"));
  assert.ok(channelRow >= 0, "a channel row to edit");
  for (let index = 0; index <= channelRow; index++) key("Down");
  const filled = urls[channelRow];
  await expectBar(filled, "filled before editing");
  const channel = filled.slice(filled.lastIndexOf("@") + 1);
  for (let index = 0; index < channel.length; index++) key("Backspace");
  await expectBar(
    filled.slice(0, filled.length - channel.length),
    "Backspace edits the filled text",
  );
  await toolbar.insertText("newchannel");
  const edited = `${filled.slice(0, filled.length - channel.length)}newchannel`;
  await expectBar(edited, "typing after arrowing edits the filled text");
  await delay(300);
  assert.equal(await bar(), edited, "the re-query does not overwrite the edit");
  assert.equal(
    (await rows()).some((row) => row.selected),
    false,
    "editing drops the row highlight",
  );
  key("Enter");
  await waitFor(async () => {
    const current = await state();
    return current.url === edited && !current.loading;
  }, "Enter navigates to the edited address").catch(async (error) => {
    throw new Error(
      `${error.message} — tab at ${JSON.stringify((await state()).url)}, bar shows ${JSON.stringify(await bar())}`,
    );
  });

  console.log("Omnibox arrow-to-fill smoke passed.");
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
