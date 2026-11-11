import {
  cpSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const source = process.argv[2] ?? process.env.CEF_POC_BRAMBLE_STAGED;
const target = process.argv[3] ?? process.env.CEF_POC_BRAMBLE_PROBE;
if (!source || !target) {
  throw new Error(
    "Usage: bun prepare-bramble-probe.mjs <Surffish-staged-Bramble-dir> <new-probe-dir>",
  );
}
const sourceDir = resolve(source);
const targetDir = resolve(target);
if (!existsSync(`${sourceDir}/manifest.json`)) {
  throw new Error(`Staged Bramble manifest not found: ${sourceDir}/manifest.json`);
}
if (existsSync(targetDir)) {
  throw new Error(`Refusing to overwrite an existing probe directory: ${targetDir}`);
}

cpSync(sourceDir, targetDir, { recursive: true, dereference: false });
const manifestPath = `${targetDir}/manifest.json`;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const aliasFile = "surffish-bramble-browser-alias.js";
const probeFile = "cef-api-probe.js";
const scriptEntry = manifest.content_scripts?.find(
  (entry) => Array.isArray(entry.js) && entry.js.includes(aliasFile),
);
if (!scriptEntry) {
  throw new Error("Staged manifest has no Surffish browser-alias content script.");
}
if (!scriptEntry.js.includes(probeFile)) {
  scriptEntry.js.splice(scriptEntry.js.indexOf(aliasFile) + 1, 0, probeFile);
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const key = "__surffish_cef_bramble_background_probe";
writeFileSync(
  `${targetDir}/${probeFile}`,
  `(() => {
  const extensionApi = globalThis.browser ?? globalThis.chrome;
  const result = {
    runtimeId: typeof extensionApi?.runtime?.id === 'string',
    runtimeMessage: typeof extensionApi?.runtime?.sendMessage === 'function',
    runtimeMessageSucceeded: false,
    originProbe: null,
    storageGet: typeof extensionApi?.storage?.local?.get === 'function',
  };
  const originUrl = __SURFFISH_CEF_ORIGIN_PROBE_URL__;
  const isBackgroundComplete = (phase) => phase === 'background-imported';
  let sentOriginProbe = false;
  let attempts = 0;
  const sendOriginProbe = () => {
    sentOriginProbe = true;
    result.originProbe = { pending: true };
    try {
      extensionApi.runtime.sendMessage({ __surffishCefOriginProbe: originUrl }, (reply) => {
        const error = extensionApi.runtime.lastError;
        if (error) {
          result.originProbe = { pending: false, ok: false, error: error.message };
          return;
        }
        result.originProbe = reply ?? { pending: false, ok: false, error: 'No worker response' };
        result.runtimeMessageSucceeded = result.originProbe.ok === true;
      });
    } catch (error) {
      result.originProbe = { pending: false, ok: false, error: String(error) };
    }
  };
  const poll = async () => {
    if (!document.documentElement) {
      setTimeout(poll, 50);
      return;
    }
    let worker = null;
    try {
      if (result.storageGet) worker = await extensionApi.storage.local.get('${key}');
    } catch {}
    const background = worker?.['${key}'] ?? null;
    if (!sentOriginProbe && isBackgroundComplete(background?.phase) && result.runtimeMessage) {
      sendOriginProbe();
    }
    document.documentElement.dataset.cefBrambleProbe = JSON.stringify({
      ...result,
      background,
    });
    if ((!isBackgroundComplete(background?.phase) || result.originProbe?.pending) && attempts++ < 90) {
      setTimeout(poll, 100);
    }
  };
  void poll();
})();\n`,
);

const aliasPath = `${targetDir}/${aliasFile}`;
let aliasSource = readFileSync(aliasPath, "utf8");
const aliasAnchor = "  const extensionApi = globalThis.browser;";
const nativeApis = `  globalThis.__cefBrambleNativeApis = {
    alarms: typeof extensionApi?.alarms?.create === 'function',
    idle: typeof extensionApi?.idle?.queryState === 'function',
    windows: typeof extensionApi?.windows?.create === 'function',
    offscreen: typeof extensionApi?.offscreen?.createDocument === 'function',
    identity: typeof extensionApi?.identity?.getAuthToken === 'function',
    connectNative: typeof extensionApi?.runtime?.connectNative === 'function'
  };`;
if (!aliasSource.includes(nativeApis)) {
  if (!aliasSource.includes(aliasAnchor)) {
    throw new Error("Cannot instrument the staged browser alias at its expected anchor.");
  }
  aliasSource = aliasSource.replace(aliasAnchor, `${aliasAnchor}\n${nativeApis}`);
  writeFileSync(aliasPath, aliasSource);
}

const workerPath = `${targetDir}/surffish-bramble-background.js`;
const workerSource = readFileSync(workerPath, "utf8");
if (!workerSource.includes("import './background.js';")) {
  throw new Error("Expected Bramble's staged background.js static import in its worker entrypoint.");
}
writeFileSync(
  `${targetDir}/cef-worker-start-probe.js`,
  `const extensionApi = globalThis.browser ?? globalThis.chrome;
const native = globalThis.__cefBrambleNativeApis ?? {};
const key = '${key}';
const record = async (phase) => {
  const value = {
    ...native,
    phase,
    runtimeMessage: typeof extensionApi?.runtime?.sendMessage === 'function',
    storage: typeof extensionApi?.storage?.local?.set === 'function',
    alarms: typeof extensionApi?.alarms?.create === 'function',
    idle: typeof extensionApi?.idle?.queryState === 'function',
    windows: typeof extensionApi?.windows?.create === 'function',
    offscreen: typeof extensionApi?.offscreen?.createDocument === 'function',
  };
  await extensionApi.storage.local.set({ [key]: value });
};
extensionApi?.runtime?.onMessage?.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.__surffishCefOriginProbe !== 'string') return false;
  fetch(message.__surffishCefOriginProbe, { mode: 'cors', credentials: 'omit' })
    .then(async (response) => ({
      pending: false,
      ok: response.ok,
      status: response.status,
      ...(await response.json()),
    }))
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ pending: false, ok: false, error: String(error) }));
  return true;
});
globalThis.__surffishCefRecord = record;
void record('worker-started').catch((error) => console.error('CEF POC worker start probe failed', error));
`,
);
writeFileSync(
  `${targetDir}/cef-worker-end-probe.js`,
  `void globalThis.__surffishCefRecord?.('background-imported').catch((error) => console.error('CEF POC worker end probe failed', error));\n`,
);
writeFileSync(
  workerPath,
  `import './surffish-bramble-browser-alias.js';
import './cef-worker-start-probe.js';
import './background.js';
import './cef-worker-end-probe.js';
`,
);

console.log(
  JSON.stringify(
    { source: sourceDir, probeCopy: targetDir, version: manifest.version, testOnly: true },
    null,
    2,
  ),
);
