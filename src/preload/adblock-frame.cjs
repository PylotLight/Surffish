"use strict";
// Surffish ad-filter frame preload. Registered on the browser session for every
// frame (sandboxed, context-isolated). It asks the main process for this
// frame's scriptlets and cosmetic CSS *synchronously* so uBO scriptlets such as
// json-prune / set-constant run before the page's own scripts, then watches
// the DOM to add generic hiding rules for classes/ids/links the page uses.

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

// Rules this document already got. The module re-runs for every navigation, so the
// set resets with the document; the inserted CSS is live, so a rule added once
// keeps covering elements added later. Without this, Ghostery re-groups the
// cosmetic filters on every call and the same rules get re-appended on every
// flush: the user stylesheet grows without bound on long-lived pages (YouTube,
// news sites) and every duplicate costs a style recalculation.
const seenCssRules = new Set();

function normalizeCssText(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Split a cosmetic-filter stylesheet into flat `{ selector, declarations }`
 * blocks. Brace-depth aware, so `:is(…)`/`[attr="…"]` selectors and nested
 * `@media` blocks survive. Returns `null` when the text is not the shape the
 * engine produces (unbalanced braces, braceless text, selector-less block).
 */
function splitCssRules(css) {
  if (typeof css !== "string" || css.length === 0) return null;
  const rules = [];
  const length = css.length;
  let i = 0;
  while (i < length) {
    // Whitespace and stray semicolons between blocks.
    while (
      i < length &&
      (css[i] === " " ||
        css[i] === "\t" ||
        css[i] === "\n" ||
        css[i] === "\r" ||
        css[i] === ";")
    )
      i += 1;
    if (i >= length) break;
    const open = css.indexOf("{", i);
    if (open === -1) return null;
    let depth = 0;
    let close = -1;
    for (let j = open; j < length; j += 1) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") {
        depth -= 1;
        if (depth === 0) {
          close = j;
          break;
        }
      }
    }
    if (close === -1) return null;
    const selector = normalizeCssText(css.slice(i, open));
    if (selector.length === 0) return null;
    rules.push({
      selector,
      declarations: normalizeCssText(css.slice(open + 1, close)),
    });
    i = close + 1;
  }
  return rules;
}

/** Selector-list parts, split on top-level commas only (`:is(a, b)` stays whole). */
function splitSelectorList(selector) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i += 1) {
    const ch = selector[i];
    if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (ch === "," && depth === 0) {
      parts.push(selector.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(selector.slice(start));
  return parts;
}

/**
 * Keep only the rules whose normalized (selector, declarations) pair is new,
 * recording them in `seen`. The engine re-emits a rule on every flush as long
 * as it still matches the DOM, re-grouped, so the per-selector key is what
 * makes a later flush a no-op for the rules already applied.
 */
function dedupeCssRules(rules, seen) {
  const fresh = [];
  for (const block of rules) {
    for (const part of splitSelectorList(block.selector)) {
      const selector = normalizeCssText(part);
      if (selector.length === 0) continue;
      const key = `${selector}\u0000${block.declarations}`;
      if (!seen.has(key)) {
        seen.add(key);
        fresh.push({ selector, declarations: block.declarations });
      }
    }
  }
  return fresh;
}

function formatCssRule(rule) {
  return `${rule.selector} { ${rule.declarations} }`;
}

function insertStyles(webFrame, styles) {
  if (typeof styles !== "string" || styles.length === 0) return;
  let css;
  const rules = splitCssRules(styles);
  if (rules === null) {
    // Not the expected shape: insert it whole, as before the dedup existed.
    css = styles;
  } else {
    css = dedupeCssRules(rules, seenCssRules).map(formatCssRule).join("\n");
  }
  if (css.length === 0) return;
  try {
    webFrame.insertCSS(css, { cssOrigin: "user" });
  } catch {
    // The frame may be going away.
  }
}

function runScriptlets(webFrame, scripts) {
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

function startDomObserver(ipcRenderer, webFrame) {
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
      .then((styles) => insertStyles(webFrame, styles))
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

// The helpers are exported for the bun-run unit tests; only the block below
// runs in the real preload, and only inside Electron (mac-trackpad-swipe.cjs
// uses the same guard, so requiring this file under bun stays side-effect-free).
module.exports = {
  splitCssRules,
  splitSelectorList,
  dedupeCssRules,
  formatCssRule,
  insertStyles,
  runScriptlets,
  startDomObserver,
};

if (process.versions.electron) {
  const { ipcRenderer, webFrame } = require("electron");
  (function main() {
    const protocol = window.location.protocol;
    if (protocol !== "http:" && protocol !== "https:") return;
    let payload;
    try {
      payload = ipcRenderer.sendSync(FRAME_START_CHANNEL, window.location.href);
    } catch {
      return;
    }
    if (!payload || payload.active !== true) return;
    runScriptlets(webFrame, payload.scripts);
    insertStyles(webFrame, payload.styles);
    if (payload.observe === true) startDomObserver(ipcRenderer, webFrame);
  })();
}
