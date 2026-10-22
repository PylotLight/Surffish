"use strict";
// Surffish ad-filter frame preload. Registered on the browser session for every
// frame (sandboxed, context-isolated). It asks the main process for this
// frame's scriptlets and cosmetic CSS *synchronously* so uBO scriptlets such as
// json-prune / set-constant run before the page's own scripts, then watches
// the DOM to add generic hiding rules for classes/ids/links the page uses.
const { ipcRenderer, webFrame } = require("electron");

const FRAME_START_CHANNEL = "surffish:adblock:frame-start";
const FRAME_UPDATE_CHANNEL = "surffish:adblock:frame-update";
const IGNORED_TAGS = new Set([
  "br",
  "head",
  "link",
  "meta",
  "script",
  "style",
  "s",
]);

function insertStyles(styles) {
  if (typeof styles !== "string" || styles.length === 0) return;
  try {
    webFrame.insertCSS(styles, { cssOrigin: "user" });
  } catch {
    // The frame may be going away.
  }
}

function runScriptlets(scripts) {
  if (!Array.isArray(scripts)) return;
  for (const script of scripts) {
    if (typeof script !== "string" || script.length === 0) continue;
    try {
      // Main world, synchronous evaluation, not subject to the page's CSP.
      // Each scriptlet is its own classic script in one global scope, so wrap
      // it in a block: top-level `class`/`let`/`const` helpers (e.g. uBO's
      // JSONPath used by trusted-edit-inbound-object) would otherwise collide
      // with the next scriptlet and throw "already been declared". `var`
      // globals such as scriptletGlobals stay shared as intended.
      const result = webFrame.executeJavaScript(`{\n${script}\n}`);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch {
      // A broken scriptlet must never break the page.
    }
  }
}

function startDomObserver() {
  const seenClasses = new Set();
  const seenIds = new Set();
  const seenHrefs = new Set();
  let pending = { classes: [], ids: [], hrefs: [] };
  let timer = null;
  let maxTimer = null;

  function collect(element) {
    if (!element || element.nodeType !== 1) return;
    if (IGNORED_TAGS.has(element.localName)) return;
    const id = element.id;
    if (id && !seenIds.has(id)) {
      seenIds.add(id);
      pending.ids.push(id);
    }
    const classList = element.classList;
    if (classList) {
      for (const name of classList) {
        if (!seenClasses.has(name)) {
          seenClasses.add(name);
          pending.classes.push(name);
        }
      }
    }
    if (element.localName === "a") {
      const href = element.getAttribute("href");
      if (href && !seenHrefs.has(href)) {
        seenHrefs.add(href);
        pending.hrefs.push(href);
      }
    }
  }

  function collectTree(root) {
    if (!root || root.nodeType !== 1) return;
    collect(root);
    const elements = root.querySelectorAll("[id],[class],a[href]");
    for (let i = 0; i < elements.length; i += 1) collect(elements[i]);
  }

  function flush() {
    clearTimeout(timer);
    clearTimeout(maxTimer);
    timer = null;
    maxTimer = null;
    if (
      pending.classes.length === 0 &&
      pending.ids.length === 0 &&
      pending.hrefs.length === 0
    )
      return;
    const features = pending;
    pending = { classes: [], ids: [], hrefs: [] };
    ipcRenderer
      .invoke(FRAME_UPDATE_CHANNEL, window.location.href, features)
      .then(insertStyles)
      .catch(() => {});
  }

  function schedule() {
    if (maxTimer === null) maxTimer = setTimeout(flush, 1000);
    clearTimeout(timer);
    timer = setTimeout(flush, 25);
  }

  const start = () => {
    collectTree(document.documentElement);
    flush();
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          collect(mutation.target);
        } else {
          for (const node of mutation.addedNodes) collectTree(node);
        }
      }
      schedule();
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["class", "id", "href"],
    });
    window.addEventListener(
      "pagehide",
      () => {
        observer.disconnect();
        clearTimeout(timer);
        clearTimeout(maxTimer);
      },
      { once: true },
    );
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

(function main() {
  const protocol = window.location.protocol;
  if (protocol !== "http:" && protocol !== "https:") return;
  let payload = null;
  try {
    payload = ipcRenderer.sendSync(FRAME_START_CHANNEL, window.location.href);
  } catch {
    return;
  }
  if (!payload || payload.active !== true) return;
  runScriptlets(payload.scripts);
  insertStyles(payload.styles);
  if (payload.observe === true) startDomObserver();
})();
