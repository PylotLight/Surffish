"use strict";
// Session frame preload (sandboxed, isolated world). Only on chromewebstore.google.com detail
// pages: relabel the store's "Add to Chrome" / "Switch to Chrome" button to "Add to Surffish" and
// route clicks to Surffish's installer. The page never gets a bridge; main reads the extension ID
// from this frame's own URL, not from anything the page says.
const { ipcRenderer } = require("electron");

const STORE_HOST = "chromewebstore.google.com";
const MARKER = "data-surffish-add";
const CHROME_LABEL =
  /^(add to chrome|switch to chrome|remove from chrome|get chrome)$/i;

function isDetailPage() {
  return (
    location.hostname === STORE_HOST && /^\/detail\//.test(location.pathname)
  );
}

function relabel(button) {
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (CHROME_LABEL.test(node.nodeValue.trim()))
      node.nodeValue = "Add to Surffish";
  }
  button.removeAttribute("disabled");
  button.setAttribute("aria-disabled", "false");
  button.setAttribute(MARKER, "1");
  button.title = "Install this extension in Surffish";
}

function scan() {
  if (!isDetailPage()) return;
  for (const button of document.querySelectorAll("button")) {
    const text = (button.textContent || "").trim();
    if (CHROME_LABEL.test(text)) relabel(button);
  }
}

if (location.hostname === STORE_HOST && window === window.top) {
  document.addEventListener(
    "click",
    (event) => {
      const target =
        event.target instanceof Element
          ? event.target.closest(`button[${MARKER}]`)
          : null;
      if (!target || !isDetailPage()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      ipcRenderer
        .invoke("browser:extensions:store-page-install")
        .catch(() => {});
    },
    true,
  );
  const start = () => {
    scan();
    new MutationObserver(() => scan()).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}
