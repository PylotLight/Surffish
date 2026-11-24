import { p as e, t } from "./chunks/storage-nmIf6WgJ.js";
import { d as n, g as r } from "./chunks/button-DmLv96bj.js";
import {
  a as i,
  c as a,
  i as o,
  l as s,
  n as c,
  o as l,
  r as u,
  s as d,
  t as f,
  u as p,
  y as m,
} from "./chunks/view-port-9v7d8f_U.js";
import { E as h } from "./chunks/messages-DLCDPx8W.js";
var g = p(),
  _ = 1500,
  v = 500;
function y(e, t) {
  let n = () => `${e.screenX},${e.screenY},${e.outerWidth},${e.outerHeight}`,
    r = n(),
    i = setTimeout(t, _),
    a = setInterval(() => {
      let e = n();
      e !== r && ((r = e), clearTimeout(i), (i = setTimeout(t, _)));
    }, v);
  return () => {
    (clearInterval(a), clearTimeout(i));
  };
}
var b = r();
(f(), l());
var x = {
  target: u,
  storage: t,
  crypto: d,
  autofill: s,
  shell: c,
  clipboard: a,
  desktopLink: i,
  files: o,
};
async function S() {
  let t = document.getElementById(`root`);
  if (!t) throw Error(`missing #root`);
  let r, i, a;
  if (c.isDetached()) {
    ((document.documentElement.style.height = `100%`),
      (document.documentElement.style.width = `100%`),
      (document.documentElement.style.overflow = `auto`),
      (document.body.style.height = `100%`),
      (document.body.style.width = `100%`),
      (document.body.style.overflow = `auto`),
      e(),
      u === `firefox` &&
        y(window, () => {
          h.runtime
            .sendMessage({ type: `POPOUT_BOUNDS_SETTLED` })
            .catch(() => {});
        }));
    let t = await c.consumeHandoff();
    if (t) ((r = t.path), (i = t.draft), (a = t.vaultId));
    else if (!(await d.isLocked())) {
      let e = await c.restoreRoute?.();
      e && (r = e);
    }
  } else if (!(await d.isLocked())) {
    let e = await c.restoreRoute?.();
    e && (r = e);
  }
  (0, g.createRoot)(t).render(
    (0, b.jsx)(n, {
      platform: x,
      children: (0, b.jsx)(m, {
        initialPath: r,
        initialDraft: i,
        initialVaultId: a,
      }),
    }),
  );
}
S();
