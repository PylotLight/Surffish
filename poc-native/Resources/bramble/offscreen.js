import { r as e, t } from "./chunks/offscreen-core-CKUmtqN_.js";
import { E as n } from "./chunks/messages-DLCDPx8W.js";
import { t as r } from "./chunks/sender-DSrAWqxj.js";
var i = {
  fetchLocalPayload: async (e) => {
    let t = await n.runtime.sendMessage({
      type: `SYNC_LOCAL_PAYLOAD`,
      payload: { vaultId: e },
    });
    if (!t?.ok || typeof t.data != `string`)
      throw Error(t?.error ?? `local payload unavailable`);
    return t.data;
  },
  pushRemotePayload: async (e, t) => {
    let r = { vaultId: e, payloadJson: t },
      i = await n.runtime.sendMessage({
        type: `SYNC_APPLY_REMOTE`,
        payload: r,
      });
    if (!i?.ok) throw Error(i?.error ?? `merge failed`);
  },
  fetchLocalRoster: async (e) => {
    let t = await n.runtime.sendMessage({
      type: `SYNC_LOCAL_ROSTER`,
      payload: { vaultId: e },
    });
    return t?.ok && typeof t.data == `string` ? t.data : ``;
  },
  pushRemoteRoster: async (e, t) => {
    let r = await n.runtime.sendMessage({
      type: `SYNC_APPLY_ROSTER`,
      payload: { vaultId: e, rosterJson: t },
    });
    if (!r?.ok) throw Error(r?.error ?? `roster merge failed`);
  },
  blobArrived: () => {
    n.runtime.sendMessage({ type: `BLOB_ARRIVED` }).catch(() => {});
  },
  linkSend: (e, t) => a(`LINK_SYNC_SEND`, { frame: e, room: t }),
  linkBlobSend: (e, t) => a(`LINK_BLOB_SEND`, { stream: e, frame: t }),
  linkBlobUp: () => a(`LINK_BLOB_UP`),
  linkAuthenticated: (e) => {
    n.runtime
      .sendMessage({ type: `DESKTOP_LINK_PROVEN`, vaultId: e })
      .catch(() => {});
  },
  linkDesktopSyncKey: async () => {
    try {
      let e = await n.runtime.sendMessage({ type: `DESKTOP_LINK_SYNC_KEY` });
      return e?.ok === !0 ? (e.data ?? null) : null;
    } catch {
      return null;
    }
  },
};
async function a(e, t) {
  try {
    let r = await n.runtime.sendMessage({ type: e, payload: t });
    return r?.ok === !0 && r.data === !0;
  } catch {
    return !1;
  }
}
e(i);
var o = window.matchMedia(`(prefers-color-scheme: dark)`);
function s() {
  n.runtime
    .sendMessage({ type: `THEME_ICON_SET`, payload: { dark: o.matches } })
    .catch(() => {});
}
(s(),
  o.addEventListener(`change`, s),
  n.runtime.onMessage.addListener((e, n, i) =>
    e?.target === `offscreen`
      ? r(n)
        ? (t(e.type ?? ``, e.payload).then(i), !0)
        : (console.warn(`[offscreen] rejected non-extension sender`, {
            origin: n.origin,
            url: n.url,
            tab: n.tab?.id,
          }),
          i({ ok: !1, error: `forbidden` }),
          !1)
      : !1,
  ));
