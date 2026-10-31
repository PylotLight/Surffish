// Does attaching the CDP debugger (the inspector's Network capture) make the page report
// navigator.webdriver === true? Real Chrome with F12 open does not; a CDP client does.
// One mode per app instance (a second partition window cannot start in this raw setup):
//   bunx electron scripts/probe-webdriver.cjs none|before|after
const { app, BrowserWindow, session } = require("electron");
const { createServer } = require("node:http");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { mkdirSync } = require("node:fs");

const mode = process.argv[2] ?? "none";
const cleanUa = mode !== "none";

const chromeUa = (ua) =>
  ua
    .replace(/\s(?:Electron|Surffish)\/\S+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

const PAGE = `<title>probe</title><body>ok<script>
  window.probe = JSON.stringify({
    webdriver: navigator.webdriver,
    ua: navigator.userAgent,
    brands: navigator.userAgentData ? navigator.userAgentData.brands.map(b => b.brand + "/" + b.version) : null,
    platform: navigator.userAgentData ? navigator.userAgentData.platform : null,
  });
</script>`;

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

async function report(contents) {
  await delay(300);
  return JSON.parse(await contents.executeJavaScript("window.probe"));
}

let port = 0;
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(PAGE);
});

app.setPath(
  "userData",
  join(tmpdir(), `surffish-webdriver-probe-${process.pid}`),
);
mkdirSync(app.getPath("userData"), { recursive: true, mode: 0o700 });
app.whenReady().then(async () => {
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  port = server.address().port;
  const win = new BrowserWindow({
    show: false,
    webPreferences: { partition: "probe-main" },
  });
  const probeSession = win.webContents.session;
  if (cleanUa) probeSession.setUserAgent(chromeUa(probeSession.getUserAgent()));
  if (mode === "before") win.webContents.debugger.attach("1.3");
  await win.loadURL(`http://127.0.0.1:${port}/page`);
  if (mode === "after") {
    win.webContents.debugger.attach("1.3");
    void win.webContents.debugger
      .sendCommand("Network.enable", {})
      .catch(() => {});
    await win.webContents.reload();
  }
  const result = await report(win.webContents);
  console.log(
    `${mode} (clean UA: ${cleanUa}): ` +
      `webdriver=${result.webdriver} ua=${result.ua.replace(/Mozilla\/5\.0 /, "")} ` +
      `brands=[${(result.brands ?? []).join(", ")}] platform=${result.platform}`,
  );
  win.webContents.debugger.detach();
  win.destroy();
  server.close();
  app.exit(0);
});
