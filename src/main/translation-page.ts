// Runs in an isolated Electron world: websites cannot access translation state or callbacks.
// Never insert provider text as HTML or change form values / editable content.
export function translationPage(action: string, payload: any): any {
  const scope = globalThis as any;
  const key = "__surffishTranslation";
  if (action === "begin") {
    scope[key]?.restore();
    const originals = new Map<Text, { original: string; translated: string }>();
    const nodes: Text[] = [];
    let cancelled = false;
    const host = document.createElement("div");
    host.setAttribute("data-surffish-translation", "");
    host.style.cssText =
      "all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;";
    const shadow = host.attachShadow({ mode: "closed" });
    const panel = document.createElement("div");
    panel.style.cssText =
      "font:14px/1.5 system-ui,sans-serif;color:#eee;background:#202124;border:1px solid #555;border-radius:12px;padding:12px 16px;box-shadow:0 6px 24px #0005;max-width:360px;max-height:50vh;overflow:auto;";
    panel.setAttribute("role", "status");
    const status = document.createElement("div");
    status.textContent = "Translating with Google…";
    const result = document.createElement("div");
    result.style.cssText =
      "white-space:pre-wrap;margin-top:8px;user-select:text;";
    const restore = document.createElement("button");
    restore.textContent = payload.selection
      ? "Close"
      : "Show original / Cancel";
    restore.style.cssText =
      "font:inherit;color:#fff;background:#3c4043;border:1px solid #777;border-radius:6px;padding:5px 10px;margin-top:10px;cursor:pointer;";
    const state = {
      id: payload.id,
      originals,
      nodes,
      get cancelled() {
        return cancelled;
      },
      status,
      result,
      restore() {
        cancelled = true;
        for (const [node, saved] of originals) {
          // A framework may have replaced this text since translation: do not overwrite its update.
          if (node.isConnected && node.data === saved.translated)
            node.data = saved.original;
        }
        originals.clear();
        nodes.length = 0;
        host.remove();
      },
    };
    restore.onclick = () => state.restore();
    panel.append(status, result, restore);
    shadow.append(panel);
    document.documentElement.append(host);
    scope[key] = state;
    if (payload.selection)
      return { id: payload.id, texts: [payload.selection], limited: false };
    if (!document.body) return { id: payload.id, texts: [], limited: false };
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    let total = 0;
    let limited = false;
    const texts: string[] = [];
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const parent = node.parentElement;
      if (
        !parent ||
        !node.data.trim() ||
        parent.closest(
          'script,style,noscript,textarea,input,select,option,code,pre,svg,math,[contenteditable]:not([contenteditable="false"]),[translate="no"],.notranslate,[hidden],[aria-hidden="true"],[data-surffish-translation]',
        )
      )
        continue;
      const style = getComputedStyle(parent);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        !parent.checkVisibility({
          opacityProperty: true,
          visibilityProperty: true,
        }) ||
        !parent.getClientRects().length
      )
        continue;
      if (node.data.length > 4000) {
        limited = true;
        continue;
      }
      if (nodes.length >= 200 || total + node.data.length > 50000) {
        limited = true;
        break;
      }
      total += node.data.length;
      nodes.push(node);
      texts.push(node.data);
    }
    return { id: payload.id, texts, limited };
  }
  const state = scope[key];
  if (!state || state.id !== payload.id || state.cancelled) return false;
  if (action === "apply") {
    if (payload.selection) state.result.textContent = payload.text;
    else {
      const node = state.nodes[payload.index] as Text | undefined;
      if (node?.isConnected && node.data === payload.original) {
        state.originals.set(node, {
          original: node.data,
          translated: payload.text,
        });
        node.data = payload.text;
      }
    }
    return true;
  }
  if (action === "status") {
    state.status.textContent = payload.text;
    return true;
  }
  return action === "active";
}
