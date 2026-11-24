const __vite__mapDeps = (
  i,
  m = __vite__mapDeps,
  d = m.f ||
    (m.f = [
      "chunks/offscreen-core-CKUmtqN_.js",
      "chunks/build-vault-Dl7gFnhh.js",
      "chunks/messages-DLCDPx8W.js",
      "chunks/ice-DMaODnYu.js",
      "chunks/pairing-sas-Ckxg-Wi_.js",
      "chunks/sender-DSrAWqxj.js",
    ]),
) => i.map((i) => d[i]);
import {
  A as e,
  B as t,
  C as n,
  D as r,
  Et as i,
  F as a,
  G as o,
  I as s,
  L as c,
  M as l,
  O as u,
  Ot as d,
  P as f,
  R as p,
  St as ee,
  U as te,
  V as ne,
  X as m,
  Y as re,
  _ as h,
  a as ie,
  b as ae,
  c as oe,
  dt as se,
  f as ce,
  ft as le,
  g,
  h as ue,
  i as _,
  kt as de,
  l as fe,
  m as pe,
  mt as me,
  n as he,
  o as v,
  pt as ge,
  r as _e,
  rt as ve,
  s as ye,
  t as y,
  tt as be,
  u as xe,
  v as Se,
  y as Ce,
} from "./chunks/storage-nmIf6WgJ.js";
import {
  $t as b,
  At as we,
  Ct as Te,
  D as Ee,
  Dn as De,
  Dt as Oe,
  E as x,
  Et as ke,
  Gt as Ae,
  Jt as je,
  Q as Me,
  Qt as Ne,
  Rt as Pe,
  S as Fe,
  Tt as Ie,
  Wt as Le,
  X as Re,
  Xt as ze,
  Y as Be,
  Yt as Ve,
  Zt as He,
  _ as Ue,
  a as We,
  an as Ge,
  at as Ke,
  b as qe,
  d as Je,
  en as Ye,
  gt as Xe,
  i as Ze,
  in as S,
  it as Qe,
  jt as $e,
  k as et,
  n as tt,
  nn as nt,
  o as rt,
  pt as it,
  q as at,
  rn as ot,
  rt as st,
  st as ct,
  t as lt,
  ut,
  v as dt,
  vt as ft,
  w as pt,
  wn as mt,
  xt as ht,
  zt as gt,
} from "./chunks/messages-DLCDPx8W.js";
import { a as _t } from "./chunks/pairing-sas-Ckxg-Wi_.js";
import { r as vt, t as C } from "./chunks/sender-DSrAWqxj.js";
import {
  c as yt,
  d as bt,
  f as xt,
  i as St,
  l as Ct,
  n as wt,
  o as Tt,
  r as Et,
  s as Dt,
  t as Ot,
  u as kt,
} from "./chunks/link-sas-BR8c91xi.js";
import { t as At } from "./chunks/wordlist-eff-CgqBt_LE.js";
var jt = new Set();
function Mt(e) {
  return (jt.add(e), () => jt.delete(e));
}
function Nt() {
  for (let e of jt) e();
}
function Pt(e) {
  let t = new Map(),
    n = new Map(),
    r = (n) => {
      let r = t.get(n.id);
      return (r || ((r = e(n)), t.set(n.id, r)), r);
    };
  return {
    plan: r,
    fingerprint: async (e) => (await r(e)).fingerprint,
    blocked: async (e) => (await r(e)).blocked,
    body: (e) => {
      let t = n.get(e.id);
      return (t || ((t = r(e).then((e) => e.body())), n.set(e.id, t)), t);
    },
  };
}
async function Ft(t, n) {
  let r = { attempted: 0, succeeded: [], failed: [], skipped: 0, waiting: 0 },
    i = await t.listVaults();
  for (let a of i) {
    let i = await t.loadTargets(a.id);
    if (!i.some((e) => St(e, n))) continue;
    let o = await t.blocked?.(a);
    if (o) {
      let s = i.filter((e) => St(e, n)),
        c = await t.loadTargets(a.id);
      (await t.saveTargets(
        a.id,
        e(c, new Map(s.map((e) => [e.id, { blocked: o }])), n),
      ),
        (r.waiting += s.length));
      continue;
    }
    let s = await t.hashVault(a),
      c = Tt(i, n, s);
    if (c.length === 0) {
      if (i.some((e) => e.waiting)) {
        let e = await t.loadTargets(a.id);
        await t.saveTargets(
          a.id,
          e.map((e) => (e.waiting ? { ...e, waiting: void 0 } : e)),
        );
      }
      continue;
    }
    let l = new Map();
    for (let e of c)
      try {
        let n = null;
        if (
          !f(e.creds) &&
          ((n = await t.decryptSecrets(a.id, e.creds)), n === null)
        ) {
          r.skipped += 1;
          continue;
        }
        (await t.upload(a.id, e, n, a), l.set(e.id, { hash: s }));
      } catch (t) {
        l.set(e.id, { error: t.message, hash: s });
      }
    if (l.size === 0) continue;
    let u = await t.loadTargets(a.id);
    await t.saveTargets(a.id, e(u, l, n));
    for (let [e, t] of l)
      ((r.attempted += 1),
        t.error === void 0
          ? r.succeeded.push({ vaultId: a.id, id: e })
          : r.failed.push({ vaultId: a.id, id: e, error: t.error }));
  }
  return r;
}
var It = `vault.vek:`,
  Lt = `vault.unlockedMru`,
  Rt = `vault.vek`,
  zt = `vault.vek.locked`,
  Bt = new Set([
    `CRYPTO_GENERATE_VEK`,
    `CRYPTO_UNWRAP_PASSWORD_SLOT`,
    `CRYPTO_UNWRAP_WEBAUTHN_SLOT`,
    `CRYPTO_UNLOCK_WITH_VEK`,
    `CRYPTO_ROTATE_VEK`,
  ]),
  w = new Map(),
  T = [],
  E = null,
  Vt = 0,
  Ht = Promise.resolve(),
  Ut = new Set(),
  Wt = !1,
  Gt = !1,
  Kt = 0,
  qt = 8,
  Jt = [],
  Yt = (e) => `${It}${e}`;
function Xt(e) {
  let t = Ht.then(e, e);
  return (
    (Ht = t.then(
      () => void 0,
      () => void 0,
    )),
    t
  );
}
function Zt(e, t) {
  return Error(`${d}: ${e} failed: ${String(t)}`);
}
function Qt(e) {
  return typeof e == `string` ? e : null;
}
function $t(e, t) {
  let n = { revision: ++Kt, oldValue: Qt(e), newValue: Qt(t) };
  for (Jt.push(n); Jt.length > qt;) Jt.shift();
  return n;
}
function en(e) {
  let t = Jt.findIndex((t) => t.revision === e.revision);
  t >= 0 && Jt.splice(t, 1);
}
function tn(e) {
  let t = Qt(e.oldValue),
    n = Qt(e.newValue),
    r = Jt.findIndex((e) => e.oldValue === t && e.newValue === n);
  return r < 0 ? !1 : (Jt.splice(r, 1), !0);
}
function nn() {
  ((Gt = !0), w.clear(), (T = []), (E = null));
}
async function rn() {
  Wt = !0;
  try {
    await x.storage.session.set({ [zt]: !0 });
  } catch {}
}
async function an() {
  await x.storage.session.set({ [Lt]: T });
}
async function on(e) {
  let t = Yt(e);
  (w.delete(e), (T = T.filter((t) => t !== e)));
  try {
    (await x.storage.session.remove([t]), await an(), Ut.delete(t));
  } catch (e) {
    throw (await rn(), nn(), Zt(`rollback`, e));
  }
}
function sn(e) {
  return Bt.has(e);
}
function cn() {
  return ++Vt;
}
function ln() {
  return Vt;
}
function D(e) {
  return e === Vt;
}
var un = (async () => {
  try {
    let e = await x.storage.session.get(null);
    if (((Wt = e[zt] !== void 0), Wt)) {
      let t = Object.keys(e).filter((e) => e.startsWith(It));
      try {
        await x.storage.session.remove([...t, Lt, g]);
      } catch (e) {
        (nn(), console.warn(`[bramble:bg] VEK lock cleanup retry failed`, e));
      }
      return;
    }
    for (let [t, n] of Object.entries(e))
      t.startsWith(It) &&
        typeof n == `string` &&
        (w.set(t.slice(10), n), Ut.add(t));
    let t = e[Lt];
    T = Array.isArray(t)
      ? t.filter((e) => typeof e == `string` && w.has(e))
      : [];
    let n = e[g];
    ((E = typeof n == `string` ? n : null),
      e[Rt] !== void 0 && (await x.storage.session.remove([Rt])));
  } catch (e) {
    console.warn(`[bramble:bg] vek-store hydration failed`, e);
  }
})();
function dn(e) {
  let t = Qt(e);
  return t !== E && ((E = t), cn(), !0);
}
function fn(e) {
  return w.get(e) ?? null;
}
function pn(e) {
  return w.has(e);
}
function O() {
  return E;
}
async function mn() {
  try {
    let e = (await x.storage.session.get([g]))[g];
    return typeof e == `string` ? e : null;
  } catch {
    return null;
  }
}
async function hn() {
  try {
    let e = (await x.storage.session.get([g]))[g];
    return typeof e == `string` ? e : null;
  } catch {
    return;
  }
}
function gn() {
  return Gt || Wt || E === null || !w.has(E);
}
function _n() {
  return T.filter((e) => w.has(e));
}
async function vn(e, t, n = Vt) {
  return Xt(async () => {
    if (!D(n)) return !1;
    if (Gt) throw Error(`${d}: requires lock cleanup`);
    let r = Yt(e);
    (Ut.add(r), w.set(e, t), (T = [e, ...T.filter((t) => t !== e)]));
    try {
      (await x.storage.session.set({ [r]: t, [Lt]: T }),
        (Wt &&= (await x.storage.session.remove([zt]), !1)));
    } catch (t) {
      throw (await on(e), Zt(`install`, t));
    }
    return D(n) ? !0 : (await on(e), !1);
  });
}
async function yn(e) {
  (cn(),
    await Xt(async () => {
      if (Gt) throw Error(`${d}: requires lock cleanup`);
      let t = Yt(e);
      (w.delete(e), (T = T.filter((t) => t !== e)));
      try {
        (await x.storage.session.remove([t]), await an(), Ut.delete(t));
      } catch (e) {
        throw (await rn(), nn(), Zt(`remove`, e));
      }
    }));
}
async function bn() {
  (cn(),
    await Xt(async () => {
      let e = E,
        t = new Set(
          [...Ut, ...w.keys()].map((e) => (e.startsWith(It) ? e : Yt(e))),
        );
      (w.clear(), (T = []), (E = null), (Wt = !0));
      let n;
      try {
        await x.storage.session.set({ [zt]: !0 });
      } catch (e) {
        n = e;
      }
      let r,
        i = e;
      try {
        let e = await x.storage.session.get(null);
        for (let n of Object.keys(e)) n.startsWith(It) && t.add(n);
        i = e[g];
      } catch (e) {
        r = e;
      }
      let a,
        o = i === void 0 ? void 0 : $t(i, void 0);
      try {
        await x.storage.session.remove([...t, Lt, g]);
        for (let e of t) Ut.delete(e);
      } catch (e) {
        ((a = e), o && en(o));
      }
      if (n || r || a) throw (nn(), Zt(`lock cleanup`, n ?? r ?? a));
      Gt = !1;
    }));
}
var xn = `offscreen.html`,
  Sn = x.offscreen !== void 0,
  Cn = null;
function wn(e) {
  Cn = e;
}
var Tn = null;
async function En() {
  Sn &&
    ((await x.offscreen.hasDocument?.()) ||
      ((Tn ||= x.offscreen
        .createDocument({
          url: xn,
          reasons: [
            x.offscreen.Reason.WORKERS,
            x.offscreen.Reason.CLIPBOARD,
            x.offscreen.Reason.WEB_RTC,
          ],
          justification: `Hosts the Vault WASM crypto module, clears the clipboard after a copy, and runs the WebRTC sync transport.`,
        })
        .then(() => {})
        .catch((e) => {
          if (!String(e).includes(`Only a single offscreen document`)) throw e;
        })
        .finally(() => {
          Tn = null;
        })),
      await Tn));
}
var Dn = null;
function On() {
  return (
    (Dn ||= ft(
      () =>
        import(`./chunks/offscreen-core-CKUmtqN_.js`)
          .then((e) => e.n)
          .then((e) => {
            if (!Cn) throw Error(`sync bridge not registered`);
            return (e.setSyncBridge(Cn), e);
          }),
      __vite__mapDeps([0, 1, 2, 3, 4, 5]),
    ).catch((e) => {
      throw ((Dn = null), e);
    })),
    Dn
  );
}
async function kn(e) {
  if (Sn)
    return (
      (await x.runtime.sendMessage({ ...e, target: `offscreen` })) ?? {
        ok: !1,
        error: `no response from offscreen`,
      }
    );
  let { handleHostMessage: t } = await On();
  return t(e.type, e.payload);
}
var An = new Set([
    `CRYPTO_WRAP_PASSWORD_SLOT`,
    `CRYPTO_WRAP_WEBAUTHN_SLOT`,
    `CRYPTO_ENCRYPT`,
    `CRYPTO_DECRYPT`,
    `CRYPTO_DECRYPT_BATCH`,
    `CRYPTO_CHECK_ENTRIES`,
    `CRYPTO_DECRYPT_INDEX`,
    `CRYPTO_ENCRYPT_OUTER`,
    `CRYPTO_DECRYPT_OUTER`,
    `CRYPTO_MAILBOX_ID`,
    `CRYPTO_MAILBOX_SEAL`,
    `CRYPTO_MAILBOX_OPEN`,
    `CRYPTO_FILE_SEAL`,
    `CRYPTO_FILE_OPEN`,
    `CRYPTO_FILE_META`,
    `CRYPTO_FILE_RESEAL_META`,
    `CRYPTO_SAVE_KDBX`,
  ]),
  jn = new Set([`CRYPTO_FILE_SEAL`, `CRYPTO_FILE_OPEN`, `CRYPTO_SAVE_KDBX`]);
async function k(e, t = ln()) {
  await En();
  let n = e.type;
  if (typeof n != `string` || !n.startsWith(`CRYPTO_`)) return kn(e);
  let r = (typeof e.vaultId == `string` ? e.vaultId : null) ?? (await mn());
  if (n === `CRYPTO_EXPORT_VEK`) {
    let e = r === null ? null : fn(r);
    return e === null ? { ok: !1, error: `vault locked` } : { ok: !0, data: e };
  }
  if (n === `CRYPTO_IS_LOCKED`) return { ok: !0, data: !(r !== null && pn(r)) };
  if (n === `CRYPTO_UNLOCK_WITH_VEK`) {
    let n = e.payload?.vekB64;
    return r === null || typeof n != `string`
      ? { ok: !1, error: `unlock needs a vault id and vek` }
      : (await vn(r, n, t))
        ? { ok: !0, data: null }
        : { ok: !1, error: de };
  }
  if (An.has(n)) {
    if (r === null) return { ok: !1, error: `vault locked` };
    let t = fn(r);
    if (t === null) return { ok: !1, error: `vault locked` };
    let i = { ...e.payload, vekB64: t, ...(jn.has(n) ? { vaultId: r } : {}) };
    return kn({ ...e, payload: i });
  }
  if (n === `CRYPTO_GENERATE_VEK` || n === `CRYPTO_ROTATE_VEK`) {
    let n = await kn(e);
    return n.ok &&
      typeof n.data == `string` &&
      r !== null &&
      !(await vn(r, n.data, t))
      ? { ok: !1, error: de }
      : n;
  }
  if (
    n === `CRYPTO_UNWRAP_PASSWORD_SLOT` ||
    n === `CRYPTO_UNWRAP_WEBAUTHN_SLOT`
  ) {
    let n = await kn(e);
    if (!n.ok) return n;
    let i = n.data;
    return i.ok &&
      typeof i.vekB64 == `string` &&
      r !== null &&
      !(await vn(r, i.vekB64, t))
      ? { ok: !1, error: de }
      : { ok: !0, data: i.ok };
  }
  return kn(e);
}
var Mn = 262144,
  Nn = 1e3,
  Pn = (e) => new Promise((t) => setTimeout(t, e)),
  Fn = {
    async send({ method: e, url: t, headers: n, body: r }) {
      let a = null,
        o;
      r instanceof Uint8Array && r.length <= Mn
        ? (o = { inline: S(r) })
        : r &&
          ((a = await pt(r instanceof Uint8Array ? new Blob([r]) : await i(r))),
          (o = { handoff: a }));
      try {
        let r = await k({
          type: `HTTP_JOB_START`,
          payload: { method: e, url: t, headers: n, body: o },
        });
        if (!r.ok || typeof r.data != `string`)
          throw Error(r.error ?? `the request could not be started`);
        for (;;) {
          await Pn(Nn);
          let e = await k({ type: `HTTP_JOB_POLL`, payload: { id: r.data } });
          if (!e.ok) throw Error(e.error ?? `the request was lost`);
          let t = e.data;
          if (t.done) {
            if (`error` in t) throw Error(t.error);
            return {
              status: t.status,
              ok: t.status >= 200 && t.status < 300,
              body: Ye(t.body),
            };
          }
        }
      } finally {
        a && (await qe(a).catch(() => {}));
      }
    },
  },
  In = null;
function Ln() {
  return (
    (In ||= (async () => {
      let e = await st(
        (e) => y.getMeta(e),
        (e, t) => y.setMeta(e, t),
      );
      return Qe(`${e}#bg`);
    })()),
    In
  );
}
async function Rn() {
  return (await Ln()).send();
}
async function zn(e) {
  (await Ln()).witness(e);
}
async function Bn(e) {
  let t = await Ln();
  for (let n of e) t.witness(n);
}
async function Vn(e) {
  return we(await y.readVaultBlob(e));
}
async function Hn(e, t) {
  await y.writeVaultBlob(e, t);
}
async function Un(e, t, n) {
  let r;
  if (e.entriesCiphertext.length === 0) r = ke();
  else {
    let t = await k({
      type: `CRYPTO_DECRYPT_OUTER`,
      vaultId: n,
      payload: { iv: S(e.entriesIv), ciphertext: S(e.entriesCiphertext) },
    });
    if (!t.ok || typeof t.data != `string`)
      throw Error(`outer decrypt failed: ${t.error ?? `no data`}`);
    r = Ie(t.data);
  }
  for (let e of [...r.entries, ...(r.conflicts ?? []), ...r.tombstones])
    for (let t of [
      e.hlc,
      ...(e.floor ? [e.floor] : []),
      ...Object.values(e.vv ?? {}),
    ])
      await zn(t);
  let i = await t(r.entries, r),
    a = await k({
      type: `CRYPTO_ENCRYPT_OUTER`,
      vaultId: n,
      payload: { plaintext: Oe({ ...r, entries: i }) },
    });
  if (!a.ok || !a.data || typeof a.data != `object`)
    throw Error(`outer encrypt failed: ${a.error ?? `no data`}`);
  let { iv: o, ciphertext: s } = a.data;
  return { entriesIv: Ye(o), entriesCiphertext: Ye(s), entryCount: i.length };
}
async function Wn() {
  try {
    await x.runtime.sendMessage({ type: `VAULT_CHANGED_EXTERNAL` });
  } catch {}
}
var Gn = `pref.aliasProvider`;
async function Kn() {
  let e = Ec();
  if (!e) return null;
  try {
    let t = await Vn(e);
    if (t.entriesCiphertext.length === 0) return null;
    let n = await k({
      type: `CRYPTO_DECRYPT_OUTER`,
      vaultId: e,
      payload: { iv: S(t.entriesIv), ciphertext: S(t.entriesCiphertext) },
    });
    if (!n.ok || typeof n.data != `string`) return null;
    let r = Ie(n.data).settings?.[Gn]?.value;
    return ve(r) ? r : null;
  } catch {
    return null;
  }
}
async function qn() {
  return (await Kn()) !== null;
}
async function Jn() {
  let e = m(await y.getMeta(o).catch(() => null));
  for (let t of re(e))
    if ((await y.getMeta(be(t.id)).catch(() => void 0)) === !0) return !0;
  return !1;
}
async function Yn(e) {
  let t = await Kn();
  if (!t) throw new me(`auth`, `Unlock Bramble to create an alias.`);
  let { address: r } = await n(t, t.apiKey ?? ``).create({
    site: e,
    description: e ? `Bramble (${e})` : `Bramble`,
  });
  return r;
}
var Xn = new Map(),
  Zn = [],
  Qn = [],
  $n = Promise.resolve();
function A(e, t) {
  Xn.set(e, t);
}
function er(e, t) {
  Zn.push([e, t]);
}
function tr(e) {
  Qn.push(e);
}
function j(e) {
  return (t, n) =>
    C(n) ? e(t, n) : Promise.resolve({ ok: !1, error: `forbidden` });
}
function nr(e) {
  $n = e.then(
    () => void 0,
    () => void 0,
  );
}
function rr() {
  return $n;
}
function ir(e) {
  if (e === void 0) return;
  let t = Xn.get(e);
  if (t) return t;
  for (let [t, n] of Zn) if (e.startsWith(t)) return n;
}
x.runtime.onMessage.addListener((e, t, n) => {
  if (e?.target === `offscreen`) return !1;
  let r = ir(e?.type);
  if (!r) return !1;
  for (let n of Qn)
    try {
      n(e, t);
    } catch (e) {
      console.error(`[bramble:bg] pre-dispatch hook failed`, e);
    }
  return (
    (async () => {
      await $n;
      try {
        n(await r(e, t));
      } catch (e) {
        n({ ok: !1, error: String(e) });
      }
    })(),
    !0
  );
});
var ar = `app.bramble.desktop`,
  or = `link-native-proxy`,
  sr = 1,
  M = `desktopLink`,
  N = (e) => `${M}:${e}`,
  cr = (e) => `linkAppSyncKey:${e.publicKey}`,
  lr = `not linked to this app`,
  ur = `not linked to the open vault`,
  dr = (e) => {
    let t = e;
    return t?.ok === !1 && (t.error === lr || t.error === ur) ? t.error : null;
  },
  fr = 1e4;
async function pr() {
  try {
    return await x.permissions.contains({ permissions: [`nativeMessaging`] });
  } catch {
    return !1;
  }
}
async function mr() {
  return typeof x.runtime.connectNative == `function` && (await pr());
}
async function hr(e) {
  let t = (await x.storage.local.get(e))[e];
  return t?.privateKey && t?.appPublicKey ? t : null;
}
async function gr(e) {
  let t = await hr(e);
  (await x.storage.local.remove(e), t && (await x.storage.local.remove(cr(t))));
}
var P = null;
async function _r() {
  let e = O();
  if (e) return e;
  let t = (await x.storage.local.get(Se))[Se];
  return typeof t == `string` ? t : null;
}
async function vr(e) {
  let t = e ? await hr(N(e)) : null;
  if (t) return { state: t, legacy: !1, vaultId: e };
  let n = await hr(M);
  return n ? { state: n, legacy: !0, vaultId: e } : null;
}
async function yr() {
  return P ? { state: P.state, legacy: !1, vaultId: null } : vr(await _r());
}
var F = 0;
async function br() {
  return (await yr())?.state ?? null;
}
async function xr(e) {
  let t = await hr(M);
  if (!t) return;
  let n = await Hr(e, { op: `syncIdentity` }).catch(() => null),
    r = n?.ok === !0 ? n.identity : null;
  if (typeof r != `string`) return;
  let i = [];
  try {
    let e = m(await y.getMeta(o));
    for (let t of e.vaults)
      (await y.getMeta(te(`sync.group`, t.id)))?.roster?.devices?.some(
        (e) => e.publicKey === r,
      ) && i.push(t.id);
  } catch {
    return;
  }
  if (i.length > 1) return;
  let [a] = i;
  (a ? await Sr(a, t) : await gr(M),
    a && a === e.vaultId ? (e.legacy = !1) : L === e && (await B()));
}
async function Sr(e, t) {
  ((await hr(N(e))) || (await x.storage.local.set({ [N(e)]: t })),
    await x.storage.local.remove(M));
}
async function Cr(e) {
  let t = L;
  if (!t?.legacy || t.vaultId !== e) return;
  let n = await hr(M);
  n && (await Sr(e, n), (t.legacy = !1));
}
async function wr(e) {
  e.legacy ? await gr(M) : e.vaultId ? await gr(N(e.vaultId)) : await Ai();
}
var Tr = class {
    port;
    queue = [];
    failed = null;
    onUnsolicited = null;
    deadListeners = [];
    constructor(e) {
      ((this.port = e),
        e.onMessage.addListener((e) => {
          if (typeof e?.dead == `string`) return this.die(e.dead);
          if (this.onUnsolicited?.(e?.frame)) return;
          let t = this.queue.shift();
          t && t(e?.frame);
        }),
        e.onDisconnect.addListener(() =>
          this.die(`the pairing window closed`),
        ));
    }
    die(e) {
      if (!this.failed) {
        this.failed = e;
        for (let e of this.queue.splice(0)) e(null);
        for (let e of this.deadListeners.splice(0)) e();
      }
    }
    intercept(e) {
      this.onUnsolicited = e;
    }
    get dead() {
      return this.failed !== null;
    }
    onDead(e) {
      this.failed ? e() : this.deadListeners.push(e);
    }
    request(e) {
      return this.failed
        ? Promise.reject(Error(this.failed))
        : new Promise((t, n) => {
            (this.queue.push((e) => {
              e == null ? n(Error(this.failed ?? `disconnected`)) : t(e);
            }),
              this.send(e));
          });
    }
    send(e) {
      this.port.postMessage({ frame: e });
    }
    close() {
      try {
        this.port.postMessage({ release: !0 });
      } catch {}
    }
  },
  Er = new Map(),
  Dr = (e) => {
    let t = e?.via;
    return typeof t == `string` ? t : void 0;
  };
x.runtime.onConnect.addListener((e) => {
  if (!e.name.startsWith(`${or}:`)) return;
  if (!e.sender || !C(e.sender)) return e.disconnect();
  let t = e.name.slice(18);
  (Er.set(t, e),
    e.onDisconnect.addListener(() => {
      Er.get(t) === e && Er.delete(t);
    }),
    e.postMessage({ ready: !0 }));
});
async function Or(e) {
  if (e !== void 0) {
    let t = Er.get(e);
    if ((Er.delete(e), t)) return new Tr(t);
  }
  return (await mr()) ? new kr() : null;
}
var kr = class {
  port;
  queue = [];
  failed = null;
  onUnsolicited = null;
  constructor() {
    ((this.port = x.runtime.connectNative(ar)),
      this.port.onMessage.addListener((e) => {
        if (this.onUnsolicited?.(e)) return;
        let t = this.queue.shift();
        t && t(e);
      }),
      this.port.onDisconnect.addListener(() => {
        this.failed = Ee(this.port);
        for (let e of this.queue.splice(0)) e(null);
      }));
  }
  request(e) {
    return this.failed
      ? Promise.reject(Error(this.failed))
      : new Promise((t, n) => {
          this.queue.push((e) => {
            e === null ? n(Error(this.failed ?? `disconnected`)) : t(e);
          });
          try {
            this.port.postMessage(e);
          } catch (e) {
            n(e instanceof Error ? e : Error(String(e)));
          }
        });
  }
  send(e) {
    this.port.postMessage(e);
  }
  intercept(e) {
    this.onUnsolicited = e;
  }
  get dead() {
    return this.failed !== null;
  }
  onDead(e) {
    this.failed ? e() : this.port.onDisconnect.addListener(e);
  }
  close() {
    this.port.disconnect();
  }
};
async function I(e, t) {
  let n = await k(t ? { type: e, payload: t } : { type: e });
  if (!n.ok) throw Error(n.error ?? `${e} failed`);
  return n.data;
}
async function Ar(e, t) {
  let n = await I(`SYNC_GENERATE_KEYPAIR`),
    r = await Ni(e),
    i = await I(`LINK_ENROLL_INITIATOR`, { privateKey: n.privateKey, psk: r }),
    a = await Or(t);
  if (!a)
    throw (
      await I(`LINK_CLOSE`, { sessionId: i.sessionId }).catch(() => {}),
      Error(`This browser cannot reach the desktop app yet.`)
    );
  try {
    a.send({ kind: `pair`, v: sr, label: await ce() });
    let e = await a.request({ message: i.message });
    if (!e?.ok) throw Error(`The desktop app refused the code.`);
    let t = await I(`LINK_READ`, {
      sessionId: i.sessionId,
      message: e.message,
    });
    if (!t.message) throw Error(`Pairing did not complete.`);
    if (!(await a.request({ message: t.message }))?.done)
      throw Error(`The desktop app refused the code.`);
    let r = await I(`LINK_REMOTE_STATIC`, { sessionId: i.sessionId });
    return Di(
      {
        privateKey: n.privateKey,
        publicKey: n.publicKey,
        appPublicKey: r,
        pairedAt: Date.now(),
      },
      !0,
    );
  } finally {
    (await I(`LINK_CLOSE`, { sessionId: i.sessionId }).catch(() => {}),
      a.close());
  }
}
var jr = new Map(),
  Mr = 18e4;
async function Nr(e) {
  let t = jr.get(e);
  t &&
    (jr.delete(e),
    await I(`LINK_CLOSE`, { sessionId: t.sessionId }).catch(() => {}),
    t.session.close());
}
var Pr = /not found|no such native application/i,
  Fr = 15e3,
  Ir = `The desktop app didn't answer. Check that it's open, then try again.`;
async function Lr(e) {
  let t = await I(`SYNC_GENERATE_KEYPAIR`),
    n = await I(`LINK_PAIR_INITIATOR`, { privateKey: t.privateKey }),
    r = await Or(e);
  if (!r)
    throw (
      await I(`LINK_CLOSE`, { sessionId: n.sessionId }).catch(() => {}),
      Error(`This browser cannot reach the desktop app yet.`)
    );
  let i = async () => {
    (await I(`LINK_CLOSE`, { sessionId: n.sessionId }).catch(() => {}),
      r.close());
  };
  try {
    r.send({ kind: `link`, v: sr, label: await ce() });
    let e,
      a,
      o = new Promise((e, t) => {
        a = setTimeout(() => t(Error(Ir)), Fr);
      });
    try {
      e = await Promise.race([r.request({ message: n.message }), o]);
    } catch (e) {
      if (
        (e instanceof Error && e.message === Ir) ||
        (e instanceof Error && Pr.test(e.message))
      )
        throw e;
      return (await i(), { legacy: !0 });
    } finally {
      clearTimeout(a);
    }
    if (!e?.ok || !e.message)
      throw Error(`Open Connect a browser in the desktop app, then try again.`);
    let s = await I(`LINK_READ`, {
      sessionId: n.sessionId,
      message: e.message,
    });
    if (!s.message) throw Error(`Linking did not complete.`);
    if (!(await r.request({ message: s.message }))?.done)
      throw Error(`The desktop app refused.`);
    let c = async (e) => {
        let t = await I(`LINK_SEAL`, {
            sessionId: n.sessionId,
            plaintext: JSON.stringify(e),
          }),
          i = await r.request({ sealed: t }),
          a = await I(`LINK_OPEN`, {
            sessionId: n.sessionId,
            sealed: i?.sealed,
          });
        return JSON.parse(a);
      },
      l = S(crypto.getRandomValues(new Uint8Array(32))),
      u = await c({ op: `linkCommit`, commit: await Ot(l) });
    if (
      u.ok !== !0 ||
      typeof u.nonce != `string` ||
      (await c({ op: `linkReveal`, nonce: l })).ok !== !0
    )
      throw Error(`The desktop app refused.`);
    let d = await I(`LINK_HANDSHAKE_HASH`, { sessionId: n.sessionId }),
      f = await I(`LINK_REMOTE_STATIC`, { sessionId: n.sessionId }),
      p = crypto.randomUUID();
    return (
      jr.set(p, {
        session: r,
        sessionId: n.sessionId,
        privateKey: t.privateKey,
        publicKey: t.publicKey,
        appPublicKey: f,
        startedAt: Date.now(),
      }),
      setTimeout(() => void Nr(p), Mr),
      { id: p, sas: await wt(await Et(d, u.nonce, l)) }
    );
  } catch (e) {
    throw (await i(), e);
  }
}
async function Rr(e, t) {
  let n = jr.get(e);
  if (!n || Date.now() - n.startedAt > Mr)
    throw (await Nr(e), Error(`That link is no longer in progress.`));
  jr.delete(e);
  let { session: r, sessionId: i } = n,
    a = async () => {
      (await I(`LINK_CLOSE`, { sessionId: i }).catch(() => {}), r.close());
    };
  if (!t)
    throw (
      await a(),
      Error(`The symbols did not match, so nothing was linked.`)
    );
  let o = {
    session: r,
    vaultId: null,
    legacy: !1,
    sessionId: i,
    inbound: Promise.resolve(),
    outbound: Promise.resolve(),
    files: !1,
    asking: Promise.resolve(),
    answer: null,
  };
  r.intercept(
    (e) =>
      typeof e?.sealed == `string` &&
      ((o.inbound = o.inbound.then(() => Ei(o, e.sealed))), !0),
  );
  let s = `The desktop app did not approve the link.`;
  try {
    let e = await new Promise((e, t) => {
      ((o.answer = e),
        r.onDead(() => t(Error(s))),
        Wr(o, { op: `linkConfirm` }).catch(() => t(Error(s))));
    });
    if (e.ok !== !0 || e.paired !== !0) throw Error(s);
    let t = await Di({
      privateKey: n.privateKey,
      publicKey: n.publicKey,
      appPublicKey: n.appPublicKey,
      pairedAt: Date.now(),
    });
    return (
      (o.files = await Hr(o, { op: `caps`, caps: [qr] })
        .then((e) => Array.isArray(e?.caps) && e.caps.includes(qr))
        .catch(() => !1)),
      r.onDead(() => {
        let e = L === o;
        (e && (L = null),
          P?.state === t && !P.listed ? Ai() : e && z().catch(() => {}));
      }),
      (L = o),
      ($r = !0),
      si(),
      t
    );
  } catch (e) {
    throw ((o.answer = null), await a(), e);
  }
}
async function zr(e, t) {
  let n = await yr();
  if (!n) throw Error(`Not linked to the desktop app.`);
  let r = await z();
  if (r) return Hr(r, e);
  let i = Vr(n, e, t);
  return ((Br = Promise.allSettled([Br, i])), i);
}
var Br = Promise.resolve();
async function Vr(e, t, n) {
  let r = e.state,
    i = await I(`LINK_START_INITIATOR`, {
      privateKey: r.privateKey,
      remotePublicKey: r.appPublicKey,
    }),
    a = await Or(n);
  if (!a)
    throw (
      await I(`LINK_CLOSE`, { sessionId: i.sessionId }).catch(() => {}),
      Error(`This browser cannot reach the desktop app yet.`)
    );
  try {
    a.send({ kind: `hello`, v: sr, publicKey: r.publicKey });
    let n = await a.request({ message: i.message });
    if (n?.ok !== !0 || n?.done !== !0) throw Error(`The desktop app refused.`);
    n.message &&
      (await I(`LINK_READ`, { sessionId: i.sessionId, message: n.message }));
    let o = await I(`LINK_SEAL`, {
        sessionId: i.sessionId,
        plaintext: JSON.stringify(t),
      }),
      s = await a.request({ sealed: o }),
      c = await I(`LINK_OPEN`, { sessionId: i.sessionId, sealed: s.sealed }),
      l = JSON.parse(c);
    return (dr(l) === lr && (await wr(e)), l);
  } finally {
    (await I(`LINK_CLOSE`, { sessionId: i.sessionId }).catch(() => {}),
      a.close());
  }
}
function Hr(e, t) {
  let n = e.asking.then(() => Ur(e, t));
  return ((e.asking = n.catch(() => {})), n);
}
async function Ur(e, t) {
  let n = new Promise((t, n) => {
    let r = setTimeout(() => {
      ((e.answer = null),
        L === e && B(),
        n(Error(`The desktop app did not answer.`)));
    }, fr);
    e.answer = (e) => {
      (clearTimeout(r), t(e));
    };
  });
  return (await Wr(e, t), n);
}
function Wr(e, t) {
  let n = e.outbound.then(async () => {
    let n = await I(`LINK_SEAL`, {
      sessionId: e.sessionId,
      plaintext: JSON.stringify(t),
    });
    e.session.send({ sealed: n });
  });
  return ((e.outbound = n.catch(() => {})), n);
}
async function Gr() {
  let e = await br();
  if (!e || !(await mr())) return !1;
  let t = await I(`LINK_START_INITIATOR`, {
      privateKey: e.privateKey,
      remotePublicKey: e.appPublicKey,
    }),
    n = new kr();
  try {
    n.send({ kind: `hello`, v: sr, publicKey: e.publicKey });
    let r = await n.request({ message: t.message });
    return r?.ok !== !0 || r?.done !== !0
      ? !1
      : (r.message &&
          (await I(`LINK_READ`, {
            sessionId: t.sessionId,
            message: r.message,
          })),
        !0);
  } finally {
    (await I(`LINK_CLOSE`, { sessionId: t.sessionId }).catch(() => {}),
      n.close());
  }
}
var L = null,
  Kr = null,
  qr = `files`,
  Jr = null,
  Yr = null,
  Xr = null,
  Zr = null;
function Qr(e) {
  Zr = e;
}
var $r = !1,
  ei = null;
function ti(e) {
  ei = e;
}
function ni() {
  return L !== null && !L.session.dead;
}
async function ri(e) {
  let t = L;
  if (t && !t.session.dead)
    try {
      await Wr(t, { op: `activeTab`, hostname: e });
    } catch {}
}
var ii = 2e4,
  ai;
async function R() {
  if (!(await br())) return (await fi(), !1);
  if (!(await mr())) return L && !L.session.dead ? !0 : (await pi(), !1);
  (await fi(), ($r = !0), si());
  let e = (await z()) !== null;
  return (e && console.log(`[bramble:link] connected to the desktop app`), e);
}
async function oi() {
  (($r = !1), await _i());
}
function si() {
  ai ||= setInterval(() => {
    z().catch(() => {});
  }, ii);
}
function ci() {
  ai &&= (clearInterval(ai), void 0);
}
var li = `desktop-link-wake`,
  ui = 1.05,
  di = !1;
async function fi() {
  ((di = !1), await x.alarms.clear(li));
}
async function pi() {
  (ci(),
    typeof x.runtime.connectNative == `function` || !(await pr())
      ? await fi()
      : (Xr && I(`LINK_DOWN`).catch(() => {}),
        x.runtime
          .sendMessage({ type: `DESKTOP_LINK_PIPE_LOST` })
          .catch(() => {}),
        !di &&
          ((di = !0),
          await x.alarms.create(li, {
            delayInMinutes: ui,
            periodInMinutes: ui,
          }))));
}
async function mi() {
  return typeof x.runtime.connectNative == `function` ||
    P ||
    (L && !L.session.dead) ||
    !(await br())
    ? !1
    : pr();
}
async function hi(e) {
  return (($r = !0), (await z(e)) !== null);
}
async function gi(e) {
  let t = Xr === null ? L : null;
  return (
    (Xr = e),
    t && !t.session.dead
      ? !(await Hr(t, { op: `syncRestart` })
          .then((e) => e?.ok === !0)
          .catch(() => !1)) &&
        L === t &&
        (await B())
      : t && (await B()),
    R()
  );
}
async function _i() {
  if (((Xr = null), $r)) return;
  ci();
  let e = L;
  ((L = null),
    e &&
      (await I(`LINK_CLOSE`, { sessionId: e.sessionId }).catch(() => {}),
      e.session.close()));
}
async function vi(e, t) {
  return yi(await z(), { op: `sync`, frame: e, ...(t ? { room: t } : {}) });
}
async function yi(e, t) {
  if (!e) return !1;
  try {
    return (await Wr(e, t), !0);
  } catch {
    return (await B(), !1);
  }
}
function bi(e, t) {
  ((Jr = e), (Yr = t));
}
function xi() {
  ((Jr = null), (Yr = null));
}
function Si() {
  return L !== null && !L.session.dead && L.files;
}
async function Ci(e, t) {
  return yi(Si() ? L : null, { op: `blob`, stream: e, frame: t });
}
async function z(e) {
  if (L && !L.session.dead) return L;
  if (!Kr || wi !== F) {
    wi = F;
    let t = Ti(e).finally(() => {
      Kr === t && (Kr = null);
    });
    Kr = t;
  }
  return Kr;
}
var wi = -1;
async function Ti(e) {
  if ((L && (await B()), !$r)) return null;
  await Promise.race([Br, new Promise((e) => setTimeout(e, fr))]);
  let t = F,
    n = await yr();
  if (!n) return null;
  let r = n.state,
    i = await Or(e);
  if (!i) return (await pi(), null);
  let a = await I(`LINK_START_INITIATOR`, {
      privateKey: r.privateKey,
      remotePublicKey: r.appPublicKey,
    }),
    o,
    s = {
      session: i,
      vaultId: n.vaultId,
      legacy: n.legacy,
      sessionId: a.sessionId,
      inbound: new Promise((e) => {
        o = e;
      }),
      outbound: Promise.resolve(),
      files: !1,
      asking: Promise.resolve(),
      answer: null,
    };
  i.intercept(
    (e) =>
      typeof e?.sealed == `string` &&
      ((s.inbound = s.inbound.then(() => Ei(s, e.sealed))), !0),
  );
  try {
    i.send({ kind: `hello`, v: sr, publicKey: r.publicKey });
    let e = await i.request({ message: a.message });
    if (e?.ok !== !0 || e?.done !== !0) throw Error(`refused`);
    e.message &&
      (await I(`LINK_READ`, { sessionId: a.sessionId, message: e.message }));
  } catch (e) {
    return (
      console.warn(`[bramble:link] desktop app refused or unreachable:`, e),
      await I(`LINK_CLOSE`, { sessionId: a.sessionId }).catch(() => {}),
      i.close(),
      null
    );
  }
  (o(),
    i.onDead(() => {
      let e = L === s;
      (e && (L = null), e && i instanceof Tr && z().catch(() => {}));
    }));
  let c = await Hr(s, { op: `caps`, caps: [qr] }).catch(() => null),
    l = dr(c);
  return l || t !== F
    ? (l === lr && (await wr(s)),
      await I(`LINK_CLOSE`, { sessionId: a.sessionId }).catch(() => {}),
      i.close(),
      null)
    : ((s.files = Array.isArray(c?.caps) && c.caps.includes(qr)),
      (L = s),
      n.legacy && xr(s),
      s);
}
async function Ei(e, t) {
  let n;
  try {
    let r = await I(`LINK_OPEN`, { sessionId: e.sessionId, sealed: t });
    n = JSON.parse(r);
  } catch {
    (e.answer?.({ ok: !1, error: `unreadable frame` }),
      (e.answer = null),
      L === e && (await B()));
    return;
  }
  typeof n.sync == `string` && n.room === `enroll`
    ? Zr?.(n.sync)
    : typeof n.sync == `string`
      ? Xr?.(n.sync, typeof n.room == `string` ? n.room : void 0)
      : typeof n.blob == `string` && typeof n.stream == `number`
        ? Jr?.(n.stream, n.blob)
        : n.blobPoke === !0
          ? Yr?.()
          : n.fill && typeof n.fill.password == `string`
            ? ei?.({
                username: n.fill.username ?? ``,
                password: n.fill.password,
                totpKey: n.fill.totp ?? null,
              })
            : (dr(n) === lr && wr(e), e.answer?.(n), (e.answer = null));
}
async function Di(e, t = !1) {
  return ((P = { state: e, listed: t }), F++, await B(), e);
}
async function Oi(e) {
  if (!P) return !1;
  let { state: t, listed: n } = P;
  if (n) return (await ki(e, t), !0);
  let r = L?.vaultId === null ? L : await z(),
    i = r ? await Hr(r, { op: `linkComplete` }).catch(() => null) : null,
    a = typeof i?.error == `string` && i.error.startsWith(`bad request`);
  return i?.ok !== !0 && !a ? (await Ai(), !1) : (await ki(e, t), !0);
}
async function ki(e, t) {
  ((P = null),
    F++,
    await x.storage.local.set({ [N(e)]: t }),
    L?.vaultId === null && (L.vaultId = e),
    L && L.vaultId !== O() && (await B()),
    R().catch(() => {}));
}
async function Ai() {
  P &&
    ((P = null), F++, L?.vaultId === null && (await B()), R().catch(() => {}));
}
function ji(e) {
  queueMicrotask(() => {
    P || (F++, L && e !== null && L.vaultId !== e && B(), R().catch(() => {}));
  });
}
async function B() {
  let e = L;
  ((L = null),
    e &&
      (await I(`LINK_CLOSE`, { sessionId: e.sessionId }).catch(() => {}),
      e.session.close()));
}
var Mi = `bramble/desktop/extension-pairing/psk/v1`;
async function Ni(e) {
  let t = new TextEncoder().encode(Mi + e.trim().toUpperCase()),
    n = await crypto.subtle.digest(`SHA-256`, t);
  return btoa(String.fromCharCode(...new Uint8Array(n)));
}
async function Pi(e) {
  let t = await vr(e);
  t && (await gr(t.legacy ? M : N(e)));
  let n = [
    ...m(await y.getMeta(o).catch(() => null)).vaults.map((e) => N(e.id)),
    M,
  ];
  return {
    remaining: (await Promise.all(n.map((e) => hr(e)))).filter(Boolean).length,
  };
}
async function Fi() {
  let e = (await vr(await _r()))?.state ?? null,
    t = await pr();
  return e
    ? { paired: !0, pairedAt: e.pairedAt, permitted: t }
    : { paired: !1, permitted: t };
}
(x.permissions?.onRemoved?.addListener((e) => {
  e.permissions?.includes(`nativeMessaging`) && oi().catch(() => {});
}),
  A(
    `DESKTOP_LINK_CLAIM_INVITE`,
    j(async (e) => {
      try {
        let t = await zr({ op: `syncInvite` }, Dr(e));
        return { ok: !0, data: t?.ok === !0 ? (t.invite ?? null) : null };
      } catch {
        return { ok: !0, data: null };
      }
    }),
  ));
async function Ii(e) {
  try {
    let t = await zr({ op: `vaultSummary` }, e);
    return t?.ok === !0 ? (t.summary ?? null) : null;
  } catch {
    return null;
  }
}
A(
  `DESKTOP_LINK_VAULT_SUMMARY`,
  j(async (e) => ({ ok: !0, data: await Ii(Dr(e)) })),
);
async function Li(e) {
  let t = await br();
  if (!t) return null;
  let n = cr(t);
  try {
    let t = await zr({ op: `syncIdentity` }, e);
    if (t?.ok === !0 && t.identity)
      return (await x.storage.local.set({ [n]: t.identity }), t.identity);
  } catch {}
  let r = (await x.storage.local.get(n))[n];
  return typeof r == `string` ? r : null;
}
(A(
  `DESKTOP_LINK_SYNC_KEY`,
  j(async (e) => ({ ok: !0, data: await Li(Dr(e)) })),
),
  A(
    `LINK_SYNC_SEND`,
    j(async (e) => {
      let { frame: t, room: n } = e.payload ?? {};
      return typeof t == `string`
        ? { ok: !0, data: await vi(t, typeof n == `string` ? n : void 0) }
        : { ok: !1, error: `LINK_SYNC_SEND requires a frame` };
    }),
  ),
  A(
    `LINK_BLOB_SEND`,
    j(async (e) => {
      let { stream: t, frame: n } = e.payload ?? {};
      return typeof t != `number` || typeof n != `string`
        ? { ok: !1, error: `LINK_BLOB_SEND requires a stream and a frame` }
        : { ok: !0, data: await Ci(t, n) };
    }),
  ),
  A(
    `LINK_BLOB_UP`,
    j(async () => ({ ok: !0, data: Si() })),
  ),
  A(
    `DESKTOP_LINK_START`,
    j(async (e) => ({ ok: !0, data: await Lr(Dr(e)) })),
  ),
  A(
    `DESKTOP_LINK_CANCEL`,
    j(async (e) => {
      let { id: t } = e;
      return (typeof t == `string` && (await Nr(t)), { ok: !0 });
    }),
  ),
  A(
    `DESKTOP_LINK_CONFIRM`,
    j(async (e) => {
      let { id: t, matches: n } = e;
      if (typeof t != `string`) return { ok: !1, error: `no link id` };
      let r = await Rr(t, n === !0);
      return (
        R().catch(() => {}),
        { ok: !0, data: { publicKey: r.publicKey, pairedAt: r.pairedAt } }
      );
    }),
  ),
  A(
    `DESKTOP_LINK_PAIR`,
    j(async (e) => {
      let t = String(e.code ?? ``);
      if (!t) return { ok: !1, error: `no code` };
      let n = await Ar(t, Dr(e));
      return (
        R().catch(() => {}),
        { ok: !0, data: { publicKey: n.publicKey, pairedAt: n.pairedAt } }
      );
    }),
  ),
  A(
    `DESKTOP_LINK_CONNECT`,
    j(async () => ({ ok: !0, data: await Gr() })),
  ));
async function Ri() {
  return !(await mr());
}
(A(
  `DESKTOP_LINK_TRANSPORT_NEEDED`,
  j(async () => ({ ok: !0, data: await Ri() })),
),
  A(
    `DESKTOP_LINK_PIPE_WANTED`,
    j(async () => ({ ok: !0, data: await mi() })),
  ),
  A(
    `DESKTOP_LINK_LEND_PIPE`,
    j(async (e) => {
      let t = Dr(e);
      return { ok: !0, data: t !== void 0 && (await hi(t)) };
    }),
  ),
  A(
    `DESKTOP_LINK_STATUS`,
    j(async () => ({ ok: !0, data: await Fi() })),
  ),
  A(
    `DESKTOP_LINK_QUERY`,
    j(async (e) => {
      let t = String(e.hostname ?? ``);
      return t
        ? { ok: !0, data: await zr({ op: `query`, hostname: t }) }
        : { ok: !1, error: `no hostname` };
    }),
  ),
  A(
    `DESKTOP_LINK_UNLINK`,
    j(async () => {
      let e = O();
      if (!e) return { ok: !1, error: `no vault is open` };
      let t = await Pi(e);
      return (await oi(), { ok: !0, data: t });
    }),
  ),
  A(
    `DESKTOP_LINK_ATTACH`,
    j(async (e) => {
      let { vaultId: t } = e;
      return typeof t == `string`
        ? { ok: !0, data: await Oi(t) }
        : { ok: !1, error: `no vault id` };
    }),
  ));
async function zi(e) {
  (await gr(N(e)), L?.vaultId === e && (await B()));
}
(A(
  `DESKTOP_LINK_FORGET_VAULT`,
  j(async (e) => {
    let { vaultId: t } = e;
    return (typeof t == `string` && (await zi(t)), { ok: !0 });
  }),
),
  A(
    `DESKTOP_LINK_PROVEN`,
    j(async (e) => {
      let { vaultId: t } = e;
      return (typeof t == `string` && (await Cr(t)), { ok: !0 });
    }),
  ),
  A(
    `DESKTOP_LINK_ABANDON`,
    j(async () => (await Ai(), { ok: !0 })),
  ));
var Bi = `pref.autoLockMinutes`,
  Vi = `pref.clipboardClearSeconds`,
  Hi = `pref.offerToSave`,
  Ui = `pref.autofillEnabled`,
  Wi = `pref.neverSaveSites`,
  Gi = `pref.passkeyProviderEnabled`,
  Ki = `pref.lockOnScreenLock`,
  qi = `pref.passkeyConfirmOncePerUnlock`,
  Ji = `pref.generator`,
  Yi = 15,
  Xi = 30,
  Zi = !0,
  Qi = !0,
  $i = !0,
  ea = !1;
async function ta() {
  try {
    let e = (await x.storage.local.get(Bi))[Bi];
    if (typeof e == `number` && Number.isFinite(e)) return e;
  } catch {}
  return Yi;
}
async function na() {
  try {
    let e = (await x.storage.local.get(Ki))[Ki];
    if (typeof e == `boolean`) return e;
  } catch {}
  return $i;
}
async function ra() {
  try {
    let e = (await x.storage.local.get(Vi))[Vi];
    if (typeof e == `number` && e > 0) return e;
  } catch {}
  return Xi;
}
async function ia() {
  try {
    let e = (await x.storage.local.get(Hi))[Hi];
    if (typeof e == `boolean`) return e;
  } catch {}
  return Zi;
}
async function aa() {
  try {
    let e = (await x.storage.local.get(Ui))[Ui];
    if (typeof e == `boolean`) return e;
  } catch {}
  return Qi;
}
async function oa() {
  try {
    if ((await x.storage.local.get(qi))[qi] === !0) return !0;
  } catch {}
  return !1;
}
async function sa() {
  try {
    let e = (await x.storage.local.get(Gi))[Gi];
    if (typeof e == `boolean`) return e;
  } catch {}
  return ea;
}
async function ca() {
  try {
    let e = await x.storage.local.get(Ji);
    return ge(e[Ji]);
  } catch {
    return ge(void 0);
  }
}
async function la() {
  try {
    let e = (await x.storage.local.get(Wi))[Wi];
    if (Array.isArray(e)) return new Set(e.filter((e) => typeof e == `string`));
  } catch {}
  return new Set();
}
async function ua(e) {
  let t = await la();
  t.has(e) || (t.add(e), await x.storage.local.set({ [Wi]: Array.from(t) }));
}
var da = `tp-view`,
  fa = 150,
  pa = 8e3,
  ma = new Set(),
  ha = 0,
  V;
async function ga() {
  try {
    await Nc();
  } catch (e) {
    console.error(`[bramble:bg] view-close session cleanup failed`, e);
  } finally {
    await k({ type: `CRYPTO_LOCK` }).catch(() => {});
  }
}
function _a() {
  (V && clearTimeout(V),
    (V = setTimeout(() => void va(), Math.max(fa, ha - Date.now()))));
}
async function va() {
  if (((V = void 0), !(ma.size > 0))) {
    if (Date.now() < ha) return _a();
    Z() || (await ta()) >= 0 || (await ga());
  }
}
function ya(e = pa) {
  ((ha = Date.now() + e), ma.size === 0 && V && _a());
}
function ba() {
  x.runtime.onConnect.addListener((e) => {
    e.name === da &&
      (ma.add(e),
      (V &&= (clearTimeout(V), void 0)),
      e.onDisconnect.addListener(() => {
        (ma.delete(e), ma.size === 0 && _a());
      }));
  });
}
var xa = `popout.handoff`,
  Sa = `popout.windowId`,
  Ca = `popout.unlockWindowId`;
async function wa() {
  try {
    if ((await mn()) !== null) return;
    let e = await y.getMeta(Se);
    if (typeof e != `string`) return;
    m(await y.getMeta(`vault.registry`)).vaults.some((t) => t.id === e) &&
      (await x.storage.session.set({ [g]: e }));
  } catch {}
}
async function Ta() {
  let e = (await x.storage.session.get(Sa))[Sa];
  if (typeof e != `number`) return !1;
  let t = await x.windows.get(e).catch(() => void 0);
  if (t?.id === void 0) return !1;
  let n = { focused: !0 };
  return (
    t.state === `minimized` && (n.state = `normal`),
    await x.windows.update(t.id, n).catch(() => void 0),
    !0
  );
}
var Ea = 500,
  Da = 600,
  Oa = 80;
async function ka(e) {
  let t = {
    url: x.runtime.getURL(`popup.html?detached=1`),
    type: `popup`,
    focused: !0,
    width: Ea,
    height: Da,
  };
  if (!e) return x.windows.create(t).catch(() => void 0);
  let n = (e.top ?? 0) + Oa,
    r = (e.left ?? 0) + (e.width ?? Ea) - Ea,
    i = await x.windows.create({ ...t, top: n, left: r }).catch(() => void 0);
  return i
    ? (i.id !== void 0 &&
        (await x.windows
          .update(i.id, {
            state: `normal`,
            width: Ea,
            height: Da,
            top: n,
            left: r,
          })
          .catch(() => void 0)),
      i)
    : x.windows.create(t).catch(() => void 0);
}
async function Aa() {
  await wa();
  try {
    let e = x.action.openPopup;
    if (typeof e == `function`) {
      await e.call(x.action);
      return;
    }
  } catch {}
  return (await ka())?.id;
}
async function ja(e) {
  return (await x.storage.session.set({ [xa]: { path: e } }), (await ka())?.id);
}
async function Ma(e, t) {
  ya();
  let n = e.payload,
    r = n?.reason === `new-login`,
    i = r ? { path: `/vault/new/login` } : n?.handoff;
  if (!r && i?.draft === void 0 && (await Ta())) return { ok: !0 };
  (n?.reason === `unlock` && (await wa()),
    i
      ? await x.storage.session.set({ [xa]: i })
      : await x.storage.session.remove([xa]));
  let a;
  (t.tab?.windowId !== void 0 &&
    (a = await x.windows.get(t.tab.windowId).catch(() => void 0)),
    (a ||= await x.windows.getCurrent().catch(() => void 0)));
  let o = await ka(a);
  return (
    o?.id !== void 0 &&
      (await x.storage.session.set({ [Sa]: o.id }),
      a?.id !== void 0 && (await x.storage.session.set({ [ae]: a.id })),
      n?.reason === `unlock` && (await x.storage.session.set({ [Ca]: o.id }))),
    { ok: !0 }
  );
}
async function Na(e) {
  try {
    if (!e()) return;
    let t = await x.storage.session.get(Ca);
    if (!e()) return;
    let n = t[Ca];
    if (
      typeof n != `number` ||
      (await x.storage.session.remove([Ca]), (await ta()) < 0) ||
      !e()
    )
      return;
    let r = await x.storage.session.get(h);
    if (!e() || r[`cornerPrompt.handoff`]) return;
    (await x.windows.remove(n).catch(() => void 0),
      (await x.storage.session.get(Sa))[Sa] === n &&
        (await x.storage.session.remove([Sa])));
  } catch {}
}
async function Pa() {
  let e = null;
  try {
    ((e =
      (await x.storage.session.get(`popout.handoff`))[`popout.handoff`] ??
      null),
      await x.storage.session.remove([xa]));
  } catch {}
  return { ok: !0, data: e };
}
async function Fa(e, t) {
  if (!C(t)) return { ok: !1, error: `forbidden` };
  let n = await pe();
  if (n?.id === void 0 || n.state !== `normal`) return { ok: !0 };
  let { left: r, top: i, width: a, height: o } = n;
  return (
    await x.windows
      .update(n.id, { left: r, top: i, width: a, height: o })
      .catch(() => void 0),
    { ok: !0 }
  );
}
(A(`POPOUT_OPEN`, Ma),
  A(`POPOUT_BOUNDS_SETTLED`, Fa),
  A(`POPOUT_CONSUME_HANDOFF`, Pa));
var Ia = 3e4,
  La = new Map();
function Ra(e) {
  if (e === void 0) return !1;
  let t = La.get(e);
  return t
    ? Date.now() >= t.expiresAt || !X(t.owner)
      ? (La.delete(e), !1)
      : !0
    : !1;
}
function za(e) {
  e !== void 0 && La.delete(e);
}
function Ba(e, t) {
  La.set(e, { owner: t, expiresAt: Date.now() + Ia });
}
async function Va(e) {
  let t =
    e?.id ?? (await x.tabs.query({ active: !0, lastFocusedWindow: !0 }))[0]?.id;
  if (t === void 0) return;
  let n = Y();
  n
    ? (Ba(t, n),
      await x.tabs
        .sendMessage(t, { type: `AUTOFILL_SHORTCUT` })
        .catch(() => {}))
    : await Aa();
}
(x.commands?.onCommand.addListener((e, t) => {
  e === `fill-login` && Va(t);
}),
  x.tabs.onRemoved?.addListener((e) => {
    La.delete(e);
  }));
var Ha = 6e4,
  Ua = 15e3,
  Wa = new Map();
function Ga(e, t, n, r) {
  Wa.set(e, { entryId: t, owner: n, protocol: r, expiresAt: Date.now() + Ha });
}
function Ka(e) {
  let t = Wa.get(e);
  return t
    ? Date.now() >= t.expiresAt || !X(t.owner)
      ? (Wa.delete(e), null)
      : t
    : null;
}
function qa(e) {
  Wa.delete(e);
}
x.tabs.onRemoved?.addListener((e) => {
  Wa.delete(e);
});
async function Ja() {
  let e = await ca();
  return e.mode === `passphrase` ? se(e, At()) : le(e);
}
async function Ya() {
  return { ok: !0, data: { password: await Ja() } };
}
A(`GENERATE_PASSWORD`, Ya);
var Xa = `autofill.knownHostnames`,
  H = null,
  Za = 0,
  Qa = null,
  U = new Set(),
  $a = 1e3,
  eo = 3e5,
  W = null;
function to(e, t, n) {
  if (e !== `card` || n === void 0) return;
  let r = Y();
  r && (W = { owner: r, tabId: n, entryId: t, expiresAt: Date.now() + eo });
}
function no(e) {
  return W
    ? Date.now() > W.expiresAt || !X(W.owner)
      ? ((W = null), null)
      : e !== void 0 && W.tabId === e
        ? W.entryId
        : null
    : null;
}
function ro() {
  (x.tabs.onUpdated?.addListener((e, t) => {
    t.url && W?.tabId === e && (W = null);
  }),
    x.tabs.onRemoved?.addListener((e) => {
      W?.tabId === e && (W = null);
    }));
}
ro();
function io(e) {
  if ((U.delete(e), U.size >= $a)) {
    let e = U.values().next().value;
    e !== void 0 && U.delete(e);
  }
  U.add(e);
}
function ao(e, t) {
  return (
    e.vaultId === t.vaultId &&
    e.generation === t.generation &&
    e.token === t.token
  );
}
function G() {
  let e = Y();
  return e && H && ao(H.owner, e) ? H.entries : (H && ((H = null), Za++), null);
}
function oo(e, t, n) {
  return Za !== t || !X(e) ? !1 : ((H = { owner: e, entries: n }), !0);
}
var so = (async () => {
  try {
    let e = (await x.storage.local.get([Xa]))[Xa];
    if (Array.isArray(e)) {
      for (let t of e) typeof t == `string` && io(t);
      e.length > $a && (await co());
    }
  } catch (e) {
    console.warn(`[bramble:bg] hostname hydration failed`, e);
  }
})();
async function co() {
  try {
    await x.storage.local.set({ [Xa]: Array.from(U) });
  } catch (e) {
    console.warn(`[bramble:bg] persistKnownHostnames failed`, e);
  }
}
function lo() {
  ((H = null), Za++, (W = null));
}
function uo(e) {
  return G()?.get(e);
}
async function fo(e) {
  let t = G();
  if (t) {
    t.set(e.id, e);
    for (let t of e.hostnames) io(t);
    await co();
  }
}
function po(e, t, n) {
  let r = G(),
    i = r?.get(e);
  i && i.type === `login` && r?.set(e, { ...i, username: t, password: n });
}
function mo(e, t, n, r) {
  return _e(G(), e, t, n, r);
}
function ho(e) {
  let t = e.number.replace(/\D/g, ``).slice(-4),
    n = t ? `•••• ${t}` : ``;
  return [e.brand, n].filter(Boolean).join(` `);
}
function go() {
  return {
    logins: [],
    cards: [],
    otps: [],
    locked: !1,
    hasPotentialMatch: !1,
    disabled: !0,
  };
}
function _o(e, t, n, r, i) {
  let a = G();
  if (!a || Z()) {
    let t = ye(e),
      n = !1;
    for (let e of U)
      if (ye(e) === t) {
        n = !0;
        break;
      }
    return {
      logins: [],
      cards: [],
      otps: [],
      locked: !0,
      hasPotentialMatch: n,
    };
  }
  let o = [],
    s = [],
    c = [],
    l = new Map();
  for (let u of a.values())
    if (u.type === `login`) {
      if (!v(u, e, t)) continue;
      (l.set(u.id, ie(u.hostnames, e)),
        n &&
          o.push({
            id: u.id,
            name: u.name,
            secondary: u.username,
            autofillEnabled: u.autofillEnabled,
            autoSubmit: u.autoSubmit,
          }),
        i &&
          u.totp &&
          c.push({
            id: u.id,
            name: u.name,
            secondary: u.username,
            autofillEnabled: u.autofillEnabled,
          }));
    } else r && s.push({ id: u.id, name: u.name, secondary: ho(u) });
  let u = (e, t) => (l.get(e.id) ?? 0) - (l.get(t.id) ?? 0);
  return (
    o.sort(u),
    c.sort(u),
    {
      logins: o,
      cards: s,
      otps: c,
      locked: !1,
      hasPotentialMatch: o.length > 0,
    }
  );
}
function vo(e) {
  let t = r(e);
  return t ? u(t.totp).code : void 0;
}
function yo(e) {
  let t = G()?.get(e);
  if (!t) throw Error(`entry not found: ${e}`);
  return t.type === `login`
    ? {
        kind: `login`,
        username: t.username,
        password: t.password,
        totp: vo(t.totp),
        autoSubmit: t.autoSubmit,
        customFields: t.customFields,
      }
    : {
        kind: `card`,
        cardholderName: t.cardholderName,
        number: t.number,
        expMonth: t.expMonth,
        expYear: t.expYear,
        cvv: t.cvv,
        customFields: t.customFields,
      };
}
function bo(e) {
  try {
    let t = e.origin ?? e.url ?? e.tab?.url ?? ``;
    if (t) return new URL(t);
  } catch {}
  return null;
}
function xo(e) {
  if (e.frameId === 0) return !0;
  try {
    let t = new URL(e.origin ?? e.url ?? ``),
      n = new URL(e.tab?.url ?? ``);
    return t.protocol === n.protocol && ye(t.hostname) === ye(n.hostname);
  } catch {
    return !1;
  }
}
function So(e) {
  if (C(e) || e.tab?.id === void 0) return null;
  let t = bo(e);
  return t?.hostname ? t : null;
}
function Co(e) {
  return So(e)?.hostname ?? null;
}
function wo(e) {
  return [`hasLogin`, `hasCard`, `hasOtp`].every(
    (t) => !(t in e) || typeof e[t] == `boolean`,
  );
}
function To(e) {
  if (!e || typeof e != `object`) return !1;
  let t = e;
  return (
    typeof t.entryId == `string` &&
    t.entryId.length > 0 &&
    t.entryId.length <= 256 &&
    (t.isAuto === void 0 || typeof t.isAuto == `boolean`) &&
    (t.otpOnly === void 0 || typeof t.otpOnly == `boolean`)
  );
}
function Eo(e) {
  if (!e || typeof e != `object`) return !1;
  let t = e;
  return (
    typeof t.vaultId == `string` &&
    t.vaultId.length > 0 &&
    t.vaultId.length <= 256 &&
    typeof t.token == `string` &&
    t.token.length > 0 &&
    t.token.length <= 256
  );
}
function Do(e) {
  if (!e || typeof e != `object`) return !1;
  let t = e;
  return Array.isArray(t.entries) && Eo(t.owner);
}
function Oo(e) {
  return !e || typeof e != `object` ? !1 : Eo(e.owner);
}
function ko(e, t, n) {
  let r = G()?.get(e);
  if (r?.type === `login` && !v(r, t, n))
    throw Error(`entry is not offered on this origin`);
}
async function Ao(e, t) {
  try {
    let n = await Vn(e.vaultId),
      r = new Set();
    if (n.entriesCiphertext.length === 0) return oo(e, t, new Map());
    let i = await k({
      type: `CRYPTO_DECRYPT_OUTER`,
      vaultId: e.vaultId,
      payload: { iv: S(n.entriesIv), ciphertext: S(n.entriesCiphertext) },
    });
    if (!i.ok || typeof i.data != `string`) return !1;
    let { entries: a } = Ie(i.data),
      o = new Map(),
      s = await k({
        type: `CRYPTO_DECRYPT_INDEX`,
        vaultId: e.vaultId,
        payload: {
          entries: a.map((e) => ({
            id: e.id,
            ciphertext: e.ciphertext,
            iv: e.iv,
            wrappedDek: e.wrappedDek,
            dekIv: e.dekIv,
          })),
        },
      });
    if (!s.ok) return !1;
    let c = vt.safeParse(s.data);
    if (!c.success || c.data.length !== a.length) return !1;
    let l = new Map(c.data.map((e) => [e.id, e.plaintext]));
    if (!a.every((e) => l.has(e.id))) return !1;
    for (let e of a) {
      let t = l.get(e.id);
      if (typeof t != `string`) continue;
      let n;
      try {
        n = Xe(JSON.parse(t));
      } catch {
        continue;
      }
      if (n.archivedAt !== void 0) continue;
      let i =
          n.customFields
            ?.filter((e) => e.value)
            .map((e) => ({ key: e.key, value: e.value })) ?? void 0,
        a = i && i.length > 0 ? i : void 0;
      if (n.type === `login`) {
        let { hostnames: t, ports: i } = mt(n.urls.filter((e) => !!e));
        o.set(e.id, {
          type: `login`,
          id: e.id,
          hostnames: t,
          ports: i,
          name: n.name,
          username: n.username,
          password: n.password,
          totp: n.totp,
          customFields: a,
          autofillEnabled: n.autofillEnabled,
          autoSubmit: n.autoSubmit,
          subdomainMatch: n.subdomainMatch,
        });
        for (let e of t) r.add(e);
      } else
        n.type === `card` &&
          o.set(e.id, {
            type: `card`,
            id: e.id,
            name: n.name,
            brand: n.brand,
            cardholderName: n.cardholderName,
            number: n.number,
            expMonth: n.expMonth,
            expYear: n.expYear,
            cvv: n.cvv,
            customFields: a,
          });
    }
    if (!oo(e, t, o)) return !1;
    for (let e of r) io(e);
    return (await co(), X(e));
  } catch (e) {
    return (
      console.warn(`[bramble:bg] hydrateAutofillIndexFromDisk failed`, e),
      !1
    );
  }
}
async function K() {
  let e = Y();
  if (!e) return !1;
  if (G() !== null) return !0;
  let t = Za;
  if (Qa && Qa.revision === t && ao(Qa.owner, e)) return Qa.promise;
  let n = Ao(e, t).finally(() => {
    Qa?.promise === n && (Qa = null);
  });
  return ((Qa = { owner: e, revision: t, promise: n }), n);
}
async function jo(e, t) {
  if (!C(t)) return { ok: !1, error: `forbidden` };
  if (!Do(e.payload)) return { ok: !1, error: `invalid_request` };
  let { entries: n, owner: r } = e.payload;
  if (!bc(r)) return { ok: !1, error: `unavailable` };
  let i = Y();
  if (!i || i.vaultId !== r.vaultId || i.token !== r.token)
    return { ok: !1, error: `unavailable` };
  let a = new Map();
  U.clear();
  for (let e of n)
    if (e.type !== `unlock-key` && (a.set(e.id, e), e.type === `login`))
      for (let t of e.hostnames) io(t);
  return (
    Za++,
    (H = { owner: i, entries: a }),
    await co(),
    await Q(),
    X(i) && bc(r) ? { ok: !0, data: null } : { ok: !1, error: `unavailable` }
  );
}
async function Mo(e, t) {
  return C(t)
    ? e.payload === void 0 && Z()
      ? (lo(), { ok: !0, data: null })
      : Oo(e.payload)
        ? bc(e.payload.owner)
          ? (lo(), { ok: !0, data: null })
          : { ok: !1, error: `unavailable` }
        : { ok: !1, error: `invalid_request` }
    : { ok: !1, error: `forbidden` };
}
async function No(e, t) {
  if (!C(t)) return { ok: !1, error: `forbidden` };
  let n = Y();
  if (!n)
    return Z()
      ? {
          ok: !0,
          data: _o(
            e.payload.hostname,
            void 0,
            e.payload.hasLogin !== !1,
            e.payload.hasCard === !0,
            e.payload.hasOtp === !0,
          ),
        }
      : { ok: !1, error: `unavailable` };
  await K();
  let { hostname: r, hasLogin: i, hasCard: a, hasOtp: o } = e.payload;
  if (!X(n)) return { ok: !1, error: `unavailable` };
  let s = _o(r, void 0, i !== !1, a === !0, o === !0);
  return s.locked
    ? { ok: !0, data: s }
    : (await Q(),
      X(n)
        ? { ok: !0, data: _o(r, void 0, i !== !1, a === !0, o === !0) }
        : { ok: !1, error: `unavailable` });
}
async function Po(e, t) {
  if (!C(t)) return { ok: !1, error: `forbidden` };
  let n = Y();
  if (!n || (await K(), await Q(), !X(n)))
    return { ok: !1, error: `unavailable` };
  let { entryId: r } = e.payload;
  return { ok: !0, data: yo(r) };
}
async function Fo(e, t) {
  let n = So(t);
  if (!wo(e)) return { ok: !1, error: `invalid_request` };
  if (!n) return { ok: !1, error: `forbidden` };
  let r = _c();
  try {
    if (!(await aa()) && !Ra(t.tab?.id)) return { ok: !0, data: go() };
    await K();
    let i = e.hasLogin !== !1,
      a = e.hasCard === !0,
      o = e.hasOtp === !0,
      s = _o(n.hostname, _(n), i, a, o);
    if (
      ((s.sameSiteAsTop = xo(t)),
      i && !s.locked && Uo(t, n) && (s.launch = !0),
      a && !s.locked)
    ) {
      let e = no(t.tab?.id);
      e && s.cards.some((t) => t.id === e) && (s.carriedCardId = e);
    }
    return (
      i && (s.generated = await Ja()),
      i && (s.aliasReady = s.locked ? await Jn() : await qn()),
      s.locked || (await Q()),
      vc(r) ? { ok: !0, data: s } : { ok: !1, error: `unavailable` }
    );
  } catch {
    return { ok: !1, error: `unavailable` };
  }
}
async function Io(e, t) {
  let n = So(t);
  if (!To(e.payload)) return { ok: !1, error: `invalid_request` };
  if (!n) return { ok: !1, error: `forbidden` };
  let r = _c();
  if (!yc(r) || (!(await aa()) && !Ra(t.tab?.id)))
    return { ok: !1, error: `unavailable` };
  try {
    if ((await K(), await Q(), !yc(r))) return { ok: !1, error: `unavailable` };
    ko(e.payload.entryId, n.hostname, _(n));
    let i = yo(e.payload.entryId);
    return (
      to(i.kind, e.payload.entryId, t.tab?.id),
      za(t.tab?.id),
      i.kind === `login` &&
        !e.payload.otpOnly &&
        t.tab?.id !== void 0 &&
        qa(t.tab.id),
      {
        ok: !0,
        data: {
          payload: i,
          isAuto: !!e.payload.isAuto,
          otpOnly: !!e.payload.otpOnly,
          sessionGeneration: r,
        },
      }
    );
  } catch {
    return { ok: !1, error: `unavailable` };
  }
}
function Lo(e) {
  let t = e ?? {};
  if (
    typeof t.entryId != `string` ||
    !t.entryId ||
    t.entryId.length > 256 ||
    typeof t.url != `string`
  )
    return null;
  try {
    let e = new URL(t.url);
    return e.protocol === `http:` || e.protocol === `https:`
      ? { entryId: t.entryId, url: e }
      : null;
  } catch {
    return null;
  }
}
async function Ro(e, t, n) {
  if (!(await aa()) || (await K(), !X(e))) return !1;
  let r = G()?.get(t);
  return (
    r?.type === `login` &&
    r.autofillEnabled !== !1 &&
    !!r.password &&
    v(r, n.hostname, _(n))
  );
}
async function zo(e) {
  let t = await pe();
  if (t?.id === void 0)
    return (await x.windows.create({ url: e }))?.tabs?.[0]?.id;
  let n = await x.tabs.create({ url: e, windowId: t.id, active: !0 });
  return (await x.windows.update(t.id, { focused: !0 }).catch(() => {}), n.id);
}
async function Bo(e) {
  let t = Lo(e.payload);
  if (!t) return { ok: !1, error: `invalid_request` };
  let n = Y(),
    r = !!n && (await Ro(n, t.entryId, t.url));
  r && ya(Ua);
  let i = await zo(t.url.href);
  return (
    n && r && i !== void 0 && Ga(i, t.entryId, n, t.url.protocol),
    { ok: !0, data: null }
  );
}
async function Vo(e) {
  let t = e.payload?.entryId;
  if (typeof t != `string` || !t || t.length > 256)
    return { ok: !1, error: `invalid_request` };
  let n = Y();
  if (!n) return { ok: !1, error: `unavailable` };
  let r = await ue();
  if (r?.id === void 0 || !r.url) return { ok: !1, error: `no_form` };
  let i = new URL(r.url);
  if ((await K(), !X(n))) return { ok: !1, error: `unavailable` };
  let a = G()?.get(t);
  return a?.type !== `login` ||
    a.autofillEnabled === !1 ||
    !v(a, i.hostname, _(i))
    ? { ok: !1, error: `no_form` }
    : (Ba(r.id, n),
      ya(Ua),
      (
        await x.tabs
          .sendMessage(
            r.id,
            { type: `AUTOFILL_FILL_ENTRY`, payload: { entryId: t } },
            { frameId: 0 },
          )
          .catch(() => void 0)
      )?.ok === !0
        ? { ok: !0, data: null }
        : (za(r.id), { ok: !1, error: `no_form` }));
}
function Ho(e, t) {
  if (!xo(t)) return !1;
  try {
    let n = new URL(t.tab?.url ?? ``);
    return v(e, n.hostname, _(n));
  } catch {
    return !1;
  }
}
function Uo(e, t) {
  let n = e.tab?.id;
  if (n === void 0) return null;
  let r = Ka(n);
  if (!r || (t.protocol === `http:` && r.protocol !== `http:`)) return null;
  let i = G()?.get(r.entryId);
  return i?.type !== `login` ||
    i.autofillEnabled === !1 ||
    !v(i, t.hostname, _(t))
    ? null
    : e.frameId === 0 || Ho(i, e)
      ? r
      : null;
}
function Wo(e) {
  let t = e ?? {};
  return (
    typeof t.frameWidth == `number` &&
    Number.isFinite(t.frameWidth) &&
    typeof t.frameHeight == `number` &&
    Number.isFinite(t.frameHeight)
  );
}
async function Go(e, t) {
  let n = await x.tabs
    .sendMessage(
      e,
      { type: `AUTOFILL_LAUNCH_TOP_CHECK`, payload: t },
      { frameId: 0 },
    )
    .catch(() => void 0);
  return n?.hasPassword === !1 && n.frameVisible === !0;
}
async function Ko(e, t) {
  let n = So(t);
  if (!n) return { ok: !1, error: `forbidden` };
  let r = t.tab?.id;
  if (r === void 0) return { ok: !1, error: `forbidden` };
  let i = t.frameId !== 0;
  if (i && !Wo(e.payload)) return { ok: !1, error: `invalid_request` };
  let a = _c();
  if (!yc(a) || !(await aa())) return { ok: !1, error: `unavailable` };
  try {
    if (
      (await K(),
      !Uo(t, n) || (await Q(), i && !(await Go(r, e.payload))) || !yc(a))
    )
      return { ok: !1, error: `unavailable` };
    let o = Uo(t, n);
    if (!o) return { ok: !1, error: `unavailable` };
    ko(o.entryId, n.hostname, _(n));
    let s = yo(o.entryId);
    return (
      qa(r),
      {
        ok: !0,
        data: { payload: s, isAuto: !0, otpOnly: !1, sessionGeneration: a },
      }
    );
  } catch {
    return { ok: !1, error: `unavailable` };
  }
}
async function qo(e, t) {
  return !So(t) || t.tab?.id === void 0
    ? { ok: !1, error: `forbidden` }
    : (qa(t.tab.id), { ok: !0, data: null });
}
async function Jo(e, t) {
  return !So(t) || t.tab?.id === void 0
    ? { ok: !1, error: `forbidden` }
    : { ok: !0, data: { live: Ka(t.tab.id) !== null } };
}
async function Yo(e, t) {
  if (!Co(t)) return { ok: !1, error: `forbidden` };
  let n = e.sessionGeneration;
  return !Number.isSafeInteger(n) || n < 0
    ? { ok: !1, error: `invalid_request` }
    : yc(n)
      ? { ok: !0, data: { sessionGeneration: n } }
      : { ok: !1, error: `unavailable` };
}
A(`AUTOFILL_SET_INDEX`, jo);
async function Xo(e) {
  let [t] = await x.tabs
    .query({ active: !0, lastFocusedWindow: !0 })
    .catch(() => []);
  if (t?.id === void 0) {
    console.warn(`[bramble:link] fill: no active tab to fill`);
    return;
  }
  let n = vo(e.totpKey);
  e.totpKey &&
    !n &&
    console.warn(`[bramble:link] fill: unusable authenticator key`);
  let r = await x.tabs
    .sendMessage(
      t.id,
      {
        type: `DESKTOP_FILL`,
        payload: { username: e.username, password: e.password, totp: n },
      },
      { frameId: 0 },
    )
    .catch((e) => {
      console.warn(`[bramble:link] fill: the page did not answer:`, e);
    });
  r && r.ok !== !0 && console.warn(`[bramble:link] fill declined:`, r);
}
ti((e) => {
  Xo(e).catch((e) => console.warn(`[bramble:link] fill failed:`, e));
});
function Zo() {
  let e = async () => {
    if (!ni()) return;
    let [e] = await x.tabs
        .query({ active: !0, lastFocusedWindow: !0 })
        .catch(() => []),
      t = ``;
    try {
      t = e?.url ? new URL(e.url).hostname : ``;
    } catch {}
    await ri(t);
  };
  (x.tabs.onActivated?.addListener(() => void e()),
    x.tabs.onUpdated?.addListener((t, n) => {
      n.url && e();
    }),
    e());
}
Zo();
async function Qo(e) {
  try {
    let t = await x.tabs.query({});
    for (let n of t)
      n.id !== void 0 &&
        x.tabs
          .sendMessage(n.id, {
            type: `AUTOFILL_ENABLED`,
            payload: { enabled: e },
          })
          .catch(() => {});
  } catch {}
}
A(
  `AUTOFILL_SET_ENABLED`,
  j(async (e) => {
    let { enabled: t } = e.payload ?? {};
    return (await Qo(!!t), { ok: !0, data: null });
  }),
);
async function $o(e, t) {
  let n = Co(t);
  if (!n || !(await aa())) return { ok: !1, error: `forbidden` };
  try {
    return { ok: !0, data: { address: await Yn(n) } };
  } catch (e) {
    let t = e instanceof me ? e : null;
    return {
      ok: !1,
      error: t?.providerMessage
        ? `${t.message} ${t.providerMessage}`
        : (t?.message ?? `unavailable`),
    };
  }
}
(A(`ALIAS_CREATE`, $o),
  A(`AUTOFILL_CLEAR_INDEX`, Mo),
  A(`AUTOFILL_FIND`, No),
  A(`AUTOFILL_FETCH`, Po),
  A(`AUTOFILL_QUERY`, Fo),
  A(`AUTOFILL_SELECT`, Io),
  A(`AUTOFILL_LAUNCH`, j(Bo)),
  A(`AUTOFILL_FILL_TAB`, j(Vo)),
  A(`AUTOFILL_LAUNCH_CLAIM`, Ko),
  A(`AUTOFILL_LAUNCH_END`, qo),
  A(`AUTOFILL_LAUNCH_LIVE`, Jo),
  A(`AUTOFILL_REVALIDATE_SUBMIT`, Yo));
var es = `capture.pending.`;
function ts(e) {
  return es + e;
}
async function ns(e) {
  try {
    let t = ts(e);
    return (await x.storage.session.get(t))[t] ?? null;
  } catch {
    return null;
  }
}
async function rs(e) {
  await x.storage.session.set({ [ts(e.etld1)]: e });
}
async function q(e) {
  await x.storage.session.remove(ts(e));
}
function is(e) {
  return e.newLogin
    ? { kind: `save` }
    : mo(e.hostname, e.username, e.password, e.port);
}
function as(e, t, n) {
  return t.kind === `exact`
    ? null
    : t.kind === `save`
      ? {
          kind: `save-login`,
          promptId: e.promptId,
          hostname: e.hostname,
          locked: n,
          username: e.username,
          password: e.password,
        }
      : {
          kind: `update-login`,
          promptId: e.promptId,
          hostname: e.hostname,
          locked: n,
          candidates: t.candidates.map((e) => ({
            id: e.id,
            name: e.name,
            username: e.username,
          })),
          newPassword: e.password,
        };
}
function os(e, t) {
  let n = t ?? e.username;
  return JSON.stringify({
    type: `login`,
    name: e.hostname,
    urls: [`https://${e.hostname}`],
    username: n,
    password: e.password,
  });
}
async function ss(e, t) {
  let n = Dc(),
    r = await Vn(n),
    i = globalThis.crypto.randomUUID(),
    a = await Rn(),
    o = await k({
      type: `CRYPTO_ENCRYPT`,
      vaultId: n,
      payload: { plaintextJson: it(i, JSON.parse(os(e, t)), void 0, a) },
    });
  if (!o.ok || !o.data)
    throw Error(`encrypt new entry failed: ${o.error ?? `no data`}`);
  let s = { id: i, ...o.data, hlc: a, ...Pe({ hlc: a, bases: [], held: [] }) },
    c = await Un(r, async (e) => [...e, s], n),
    l = {
      slots: r.slots,
      entriesIv: c.entriesIv,
      entriesCiphertext: c.entriesCiphertext,
    };
  await Hn($e(l), n);
  let u = t ?? e.username;
  (await fo({
    type: `login`,
    id: i,
    hostnames: [e.hostname],
    name: e.hostname,
    username: u,
    password: e.password,
  }),
    await Wn());
}
async function cs(e, t) {
  let n = uo(t);
  if (n?.type !== `login`) throw Error(`update target not in index: ${t}`);
  let r = e.username || n.username;
  if (!v(n, e.hostname, e.port))
    throw Error(`update target is not offered on this origin`);
  let i = Dc(),
    a = await Vn(i),
    o = await Un(
      a,
      async (n, a) => {
        let o = [];
        for (let s of n) {
          if (s.id !== t) {
            o.push(s);
            continue;
          }
          let n = await k({
            type: `CRYPTO_DECRYPT`,
            vaultId: i,
            payload: {
              ciphertext: s.ciphertext,
              iv: s.iv,
              wrappedDek: s.wrappedDek,
              dekIv: s.dekIv,
            },
          });
          if (!n.ok || typeof n.data != `string`)
            throw Error(`decrypt entry failed: ${n.error ?? `no data`}`);
          let c = Xe(JSON.parse(n.data)),
            l = await Rn(),
            u = ht(a, s.id),
            d = gt({ hlc: l, bases: [s], held: u }),
            f = ut(
              {
                ...c,
                id: s.id,
                username: r,
                password: e.password,
                breach: void 0,
                updatedAt: d.hlc.wall,
              },
              { ...c, id: s.id },
              d.hlc.wall,
            ),
            p = await k({
              type: `CRYPTO_ENCRYPT`,
              vaultId: i,
              payload: {
                plaintextJson: it(s.id, f, { data: c, version: s }, d.hlc),
              },
            });
          if (!p.ok || !p.data)
            throw Error(`reencrypt entry failed: ${p.error ?? `no data`}`);
          let ee = p.data;
          o.push({ id: s.id, ...ee, hlc: d.hlc, ...d.causal });
        }
        return o;
      },
      i,
    ),
    s = {
      slots: a.slots,
      entriesIv: o.entriesIv,
      entriesCiphertext: o.entriesCiphertext,
    };
  (await Hn($e(s), i), po(t, r, e.password), await Wn());
}
async function ls(e, t) {
  if (!(await ia()) || (await la()).has(e.etld1)) return null;
  await K();
  let n = Z(),
    r = as(e, is(e), n);
  return r
    ? (await rs(e),
      t !== void 0 &&
        (await x.tabs
          .sendMessage(
            t,
            { type: `CORNER_PROMPT_SHOW`, payload: r },
            { frameId: 0 },
          )
          .catch(() => {})),
      r)
    : (await q(e.etld1), null);
}
async function us(e, t) {
  let n = ``,
    r = ``;
  try {
    let e = t.origin ?? t.url ?? t.tab?.url ?? ``;
    if (e) {
      let t = new URL(e);
      ((n = t.hostname), (r = _(t)));
    }
  } catch {}
  if (!n) return { ok: !1, error: `no verifiable origin on sender` };
  let { username: i, password: a, newLogin: o } = e.payload;
  if (!a) return { ok: !0, data: null };
  let s = ye(n);
  return {
    ok: !0,
    data: await ls(
      {
        promptId: globalThis.crypto.randomUUID(),
        etld1: s,
        hostname: n,
        port: r,
        username: i,
        password: a,
        capturedAt: Date.now(),
        newLogin: o === !0,
      },
      t.tab?.id,
    ),
  };
}
async function ds(e, t) {
  let n = ``;
  try {
    let e = t.origin ?? t.url ?? t.tab?.url ?? ``;
    e && (n = new URL(e).hostname);
  } catch {}
  if (!n || !(await ia())) return { ok: !0, data: null };
  let r = ye(n),
    i = await ns(r);
  if (!i) return { ok: !0, data: null };
  await K();
  let a = Z(),
    o = as(i, is(i), a);
  return o ? { ok: !0, data: o } : (await q(r), { ok: !0, data: null });
}
async function fs(e, t) {
  try {
    let n = e.payload,
      r = ``;
    try {
      let e = t.origin ?? t.url ?? t.tab?.url ?? ``;
      e && (r = new URL(e).hostname);
    } catch {}
    let i = r ? ye(r) : ``,
      a = i ? await ns(i) : null;
    if (!a || a.promptId !== n.promptId)
      return (
        n.action === `never` && i && (await ua(i)),
        i && (await q(i)),
        { ok: !0, data: null }
      );
    if (n.action === `dismiss`) return (await q(i), { ok: !0, data: null });
    if (n.action === `never`)
      return (await ua(i), await q(i), { ok: !0, data: null });
    if (n.action === `save-unlock-first`) {
      let e = n.editedUsername ? { ...a, username: n.editedUsername } : a;
      if (!Z()) {
        await K();
        let t = is(e);
        try {
          t.kind === `exact` ||
            (t.kind === `update` &&
            (n.chosenEntryId || t.candidates.length === 1)
              ? await cs(e, n.chosenEntryId ?? t.candidates[0].id)
              : await ss(e, void 0));
        } finally {
          await q(i);
        }
        return { ok: !0, data: null };
      }
      let t = {
        intent: n.chosenEntryId ? `update` : `save`,
        capture: e,
        chosenEntryId: n.chosenEntryId,
      };
      return (
        await x.storage.session.set({ [h]: t }),
        await Aa(),
        { ok: !0, data: null }
      );
    }
    if (n.action === `save`) {
      await K();
      let e = n.editedUsername ? { ...a, username: n.editedUsername } : a,
        t = is(e);
      try {
        t.kind === `exact` ||
          (t.kind === `update` && t.candidates.length === 1
            ? await cs(e, t.candidates[0].id)
            : await ss(e, void 0));
      } finally {
        await q(i);
      }
      return { ok: !0, data: null };
    }
    if (n.action === `save-new`) {
      await K();
      try {
        await ss(a, void 0);
      } finally {
        await q(i);
      }
      return { ok: !0, data: null };
    }
    if (n.action === `update`) {
      if (!n.chosenEntryId)
        return { ok: !1, error: `update missing chosenEntryId` };
      await K();
      try {
        await cs(a, n.chosenEntryId);
      } finally {
        await q(i);
      }
      return { ok: !0, data: null };
    }
    return { ok: !1, error: `unknown action: ${n.action}` };
  } catch (e) {
    return (
      console.error(`[bramble:bg] CORNER_PROMPT_RESPONSE failed`, e),
      { ok: !1, error: String(e) }
    );
  }
}
async function ps() {
  try {
    let e = (await x.storage.session.get(h))[h];
    if (!e) return { ok: !0, data: !1 };
    if ((await Oc(), await K(), Z()))
      return { ok: !1, error: `vault still locked` };
    await x.storage.session.remove(h);
    let t = is(e.capture),
      n = null;
    try {
      if (t.kind !== `exact`) {
        if (t.kind === `update`) {
          let r = e.chosenEntryId ?? t.candidates[0]?.id;
          if (!r) throw Error(`no update target`);
          (await cs(e.capture, r), (n = `update`));
        } else (await ss(e.capture, void 0), (n = `save`));
      }
    } finally {
      await q(e.capture.etld1);
    }
    return (
      n &&
        x.runtime
          .sendMessage({
            type: `CORNER_SAVED`,
            payload: { kind: n, hostname: e.capture.hostname },
          })
          .catch(() => {}),
      { ok: !0, data: !0 }
    );
  } catch (e) {
    return (
      console.error(`[bramble:bg] CORNER_FLUSH_HANDOFF failed`, e),
      { ok: !1, error: String(e) }
    );
  }
}
function ms(e) {
  if (!C(e) || e.tab?.id === void 0 || !e.frameId) return !1;
  try {
    return new URL(e.url ?? ``).pathname === `/corner-field.html`;
  } catch {
    return !1;
  }
}
async function hs(e, t) {
  let n = t.tab?.id;
  return n === void 0 || !ms(t)
    ? { ok: !1, error: `forbidden` }
    : ((await x.tabs
        .sendMessage(
          n,
          { type: `CORNER_FIELD`, payload: e.payload },
          { frameId: 0 },
        )
        .catch(() => void 0)) ?? { ok: !1, error: `no card` });
}
(A(`CORNER_PROMPT_CAPTURE`, us),
  A(`CORNER_PROMPT_QUERY`, ds),
  A(`CORNER_PROMPT_RESPONSE`, fs),
  A(`CORNER_FLUSH_HANDOFF`, ps),
  A(`CORNER_FIELD`, hs));
async function gs() {
  let e = null;
  try {
    let t = await x.storage.session.get([g]);
    typeof t[`vault.activeId`] == `string` && (e = t[g]);
  } catch {}
  return e &&
    m(
      (await x.storage.local.get(`vault.registry`))[`vault.registry`],
    ).vaults.some((t) => t.id === e)
    ? { vaultId: e }
    : null;
}
function _s(e, t) {
  return te(e, t.vaultId);
}
var vs = `sync.deviceKeypair`;
async function ys(e) {
  let t = _s(vs, e),
    n = (await x.storage.local.get(t))[t];
  return n?.privateKey && n?.publicKey ? n : null;
}
async function bs(e, t) {
  await x.storage.local.set({ [_s(vs, t)]: e });
}
var xs = `sync.signingKey`;
async function Ss(e) {
  let t = _s(xs, e),
    n = (await x.storage.local.get(t))[t];
  return n?.secretKey && n?.publicKey ? n : null;
}
async function Cs(e, t) {
  await x.storage.local.set({ [_s(xs, t)]: e });
}
var ws = `sync.group`;
function Ts(e) {
  return e === ws || e.startsWith(`${ws}:`);
}
async function Es(e) {
  let t = _s(ws, e),
    n = (await x.storage.local.get(t))[t];
  return n?.groupKey ? n : null;
}
async function Ds(e, t) {
  await x.storage.local.set({ [_s(ws, t)]: e });
}
var Os = `sync.relay`;
async function ks() {
  return _t((await x.storage.local.get(Os))[Os]);
}
var As = `sync.iceUrl`;
async function js() {
  let e = (await x.storage.local.get(As))[As];
  return typeof e == `string` ? e : ``;
}
var Ms = 2e4,
  Ns = 3e5,
  Ps = null,
  Fs = 0;
function Is(e, t = Ns) {
  e &&
    ((Fs = Date.now() + t),
    !Ps &&
      (Ps = setInterval(() => {
        Date.now() >= Fs ? Ls() : x.runtime.getPlatformInfo?.().catch(() => {});
      }, Ms)));
}
function Ls() {
  Ps &&= (clearInterval(Ps), null);
}
(x.runtime.onMessage.addListener(
  (e) => (
    e?.type === `SYNC_STATUS` &&
      console.log(`[bramble:sync]`, e.payload?.status ?? ``),
    !1
  ),
),
  A(
    `SYNC_DISCONNECT`,
    j((e) => (Ls(), k(e))),
  ),
  A(
    `SYNC_ENROLL_STOP`,
    j((e) => (Ls(), k(e))),
  ));
async function Rs() {
  let e = await gs();
  if (!e) throw Error(`no active vault`);
  return e;
}
A(
  `SYNC_DEVICE_PUBKEY`,
  j(async () => {
    let e = await Rs(),
      t = await ys(e);
    if (!t) {
      if (await Es(e))
        return { ok: !1, error: `this device's sync key can't be read` };
      let n = await k({ type: `SYNC_GENERATE_KEYPAIR` });
      if (!n.ok || !n.data)
        return { ok: !1, error: n.error ?? `keypair generation failed` };
      ((t = n.data), await bs(t, e));
    }
    return { ok: !0, data: t.publicKey };
  }),
);
var zs = async (e) => {
  let t = await Rs(),
    n = await ys(t);
  if (!n) return { ok: !1, error: `no device key — create a group first` };
  let r;
  return e.type === `SYNC_ENROLL_INVITE` &&
    ((r = fn(t.vaultId) ?? void 0), r === void 0)
    ? { ok: !1, error: `unlock this vault first` }
    : (Is(Vs),
      k({
        ...e,
        payload: {
          ...e.payload,
          devicePrivB64: n.privateKey,
          devicePubB64: n.publicKey,
          ...(r ? { vekB64: r } : {}),
          ...(e.type === `SYNC_ENROLL_INVITE` ? { vaultId: t.vaultId } : {}),
        },
      }));
};
(A(`SYNC_ENROLL_INVITE`, j(zs)),
  A(`SYNC_ENROLL_JOIN`, j(zs)),
  A(
    `SYNC_ENROLL_APPROVE`,
    j((e) => k(e)),
  ),
  A(
    `SYNC_ENROLL_PENDING`,
    j((e) => k(e)),
  ),
  A(
    `SYNC_SIGNING_PUBKEY`,
    j(async () => {
      let e = await Rs(),
        t = await Ss(e);
      if (!t) {
        let n = await Es(e);
        if (n) {
          let t = (await ys(e))?.publicKey;
          if (!t || Re([n.roster], t))
            return { ok: !1, error: `this device's signing key can't be read` };
        }
        let r = await k({ type: `SYNC_GENERATE_SIGNING_KEY` });
        if (!r.ok || !r.data)
          return { ok: !1, error: r.error ?? `signing key generation failed` };
        ((t = r.data), await Cs(t, e));
      }
      return { ok: !0, data: t.publicKey };
    }),
  ),
  A(
    `SYNC_SIGN_ENTRY`,
    j(async (e) => {
      let t = await Ss(await Rs());
      if (!t)
        return {
          ok: !1,
          error: `no signing key — create or join a group first`,
        };
      let { canonical: n } = Je.parse(e.payload);
      return k({
        type: `SYNC_ROSTER_SIGN`,
        payload: { secretB64: t.secretKey, message: n },
      });
    }),
  ),
  A(
    `SYNC_ADMISSION_PUBKEY`,
    j(async (e) => {
      let { password: t, saltB64: n } = lt.parse(e.payload);
      return k({
        type: `SYNC_ROSTER_ADMISSION_PUBKEY`,
        payload: { password: t, saltB64: n },
      });
    }),
  ),
  A(
    `SYNC_ADMISSION_SIGN`,
    j(async (e) => {
      let { password: t, saltB64: n, canonical: r } = tt.parse(e.payload);
      return k({
        type: `SYNC_ROSTER_ADMISSION_SIGN`,
        payload: { password: t, saltB64: n, message: r },
      });
    }),
  ));
var Bs = `sync-keepalive`,
  Vs = !Sn,
  Hs = !1,
  Us = null,
  Ws = 0,
  Gs = Promise.resolve();
function Ks(e, t, n) {
  console.warn(
    `[bramble:bg] sync start abandoned at ${e}: the vault session moved`,
    { stopSuperseded: t !== Ws, vekEpochStale: !D(n), activeVaultLocked: gn() },
  );
}
async function qs(e) {
  let t = e !== void 0,
    n = e ?? ln(),
    r = Ws,
    i = () => r !== Ws || !D(n) || (t && gn());
  if ((await Gs, i())) {
    Ks(`the disconnect barrier`, r, n);
    return;
  }
  let a = await gs();
  if (
    !a ||
    (await x.storage.session.get(`sync.openedVault`))[`sync.openedVault`] !==
      a.vaultId
  )
    return;
  if (i()) {
    Ks(`resolving the vault`, r, n);
    return;
  }
  let o = await Es(a),
    s = await ys(a);
  if (!o || !s) return;
  if (i()) {
    Ks(`reading the group`, r, n);
    return;
  }
  if (Hs && Us === a.vaultId) return;
  if (Hs) return (await Js({ keepVaultId: a.vaultId }), qs(e));
  ((Hs = !0),
    (Us = a.vaultId),
    Vs && x.alarms.create(Bs, { periodInMinutes: 0.5 }));
  let c = {
    vaultId: a.vaultId,
    relayUrl: await ks(),
    iceUrl: await js(),
    groupKeyB64: o.groupKey,
    roster: o.roster,
    devicePrivB64: s.privateKey,
    devicePubB64: s.publicKey,
  };
  i()
    ? (Ks(`the final check before handing the roster to the host`, r, n),
      (Hs = !1),
      (Us = null))
    : (await k({ type: `SYNC_ROSTER_SYNC`, payload: c }),
      bi(
        (e, t) => {
          k({
            type: `LINK_BLOB_FRAME`,
            payload: { stream: e, frame: t },
          }).catch(() => {});
        },
        () => {
          k({ type: `LINK_BLOB_POKE` }).catch(() => {});
        },
      ),
      gi((e) => {
        k({ type: `LINK_SYNC_FRAME`, payload: { frame: e } }).catch(() => {});
      }).catch(() => {}));
}
async function Js({ keepVaultId: e } = {}) {
  let t = ++Ws;
  ((Hs = !1),
    (Us = null),
    xi(),
    _i().catch(() => {}),
    (Gs = (async () => {
      (Vs && (await x.alarms.clear(Bs)),
        t === Ws &&
          (await k(
            e === void 0
              ? { type: `SYNC_DISCONNECT` }
              : { type: `SYNC_ROSTER_STOP`, payload: { keepVaultId: e } },
          ).catch(() => {})));
    })()),
    await Gs);
}
async function Ys() {
  let e = ln();
  if (gn()) throw Error(`the vault is locked`);
  (await Js({ keepVaultId: null }), await qs(e));
}
A(
  `SYNC_RESTART`,
  j(async () => (await Ys(), { ok: !0 })),
);
function Xs(e) {
  (Hs && Us === e) || Js({ keepVaultId: e });
}
async function Zs(e) {
  let t = await Vn(e.vaultId);
  if (t.entriesCiphertext.length === 0) return { blob: t, payload: ke() };
  let n = await k({
    type: `CRYPTO_DECRYPT_OUTER`,
    vaultId: e.vaultId,
    payload: { iv: S(t.entriesIv), ciphertext: S(t.entriesCiphertext) },
  });
  if (!n.ok || typeof n.data != `string`)
    throw Error(n.error ?? `outer decrypt failed`);
  return { blob: t, payload: Ie(n.data) };
}
function Qs(e) {
  return {
    async decryptEntries(t) {
      let n = await k({
        type: `CRYPTO_DECRYPT_BATCH`,
        vaultId: e,
        payload: { entries: t },
      });
      if (!n.ok || !Array.isArray(n.data))
        throw Error(n.error ?? `decrypt failed`);
      return n.data;
    },
    async encryptEntry(t) {
      let n = await k({
        type: `CRYPTO_ENCRYPT`,
        vaultId: e,
        payload: { plaintextJson: t },
      });
      if (!n.ok || !n.data) throw Error(n.error ?? `encrypt failed`);
      return n.data;
    },
  };
}
function $s(e) {
  let t = [];
  return {
    async readLocal() {
      let { blob: n, payload: r } = await Zs(e);
      return ((t = n.slots), r);
    },
    witnessRemote: (e) => Bn(e),
    async writeMerged(n) {
      let r = await Zs(e);
      t = r.blob.slots;
      let i = await k({
        type: `CRYPTO_ENCRYPT_OUTER`,
        vaultId: e.vaultId,
        payload: { plaintext: Oe(Te(r.payload, n)) },
      });
      if (!i.ok || !i.data) throw Error(i.error ?? `outer encrypt failed`);
      let { iv: a, ciphertext: o } = i.data;
      (await Hn(
        $e({ slots: t, entriesIv: Ye(a), entriesCiphertext: Ye(o) }),
        e.vaultId,
      ),
        await Wn());
    },
    async openable(t) {
      let n = await k({
        type: `CRYPTO_CHECK_ENTRIES`,
        vaultId: e.vaultId,
        payload: {
          entries: t.map(
            ({ ciphertext: e, iv: t, wrappedDek: n, dekIv: r }) => ({
              ciphertext: e,
              iv: t,
              wrappedDek: n,
              dekIv: r,
            }),
          ),
        },
      });
      if (!n.ok || !Array.isArray(n.data))
        throw Error(n.error ?? `entry check failed`);
      return n.data;
    },
    combineSiblings: (t, n) => ct(t, Qs(e.vaultId), n),
  };
}
async function ec(e) {
  let t = await gs();
  return t?.vaultId === e ? t : null;
}
var tc = Be({ devices: [], revoked: [] });
async function nc(e) {
  let t = await ec(e);
  if (!t) return Oe(ke());
  let { payload: n } = await Zs(t);
  return Oe(n);
}
var rc = 0,
  ic = new Map(),
  ac = new Map();
async function oc(e, t) {
  let n = (ic.get(e) ?? Promise.resolve()).then(() => sc(e, t));
  return (
    ic.set(
      e,
      n.catch(() => {}),
    ),
    n
  );
}
async function sc(e, t) {
  let n = await ec(e);
  if (!n) return !1;
  let r = Ie(t),
    i = ac.get(n.vaultId) ?? new Set();
  ac.set(n.vaultId, i);
  let { changed: a } = await Ke($s(n), r, { rejected: i }),
    o = Date.now();
  return (
    o - rc >= 3e4 && ((rc = o), await y.setMeta(te(et, n.vaultId), o)),
    a
  );
}
async function cc(e) {
  let t = await ec(e);
  if (!t) return tc;
  let n = await Es(t);
  return n ? Be(n.roster) : tc;
}
async function lc(e, t) {
  let n = await ec(e);
  if (!n) return;
  let r = await Es(n);
  r &&
    (await Ds({ groupKey: r.groupKey, roster: Me(r.roster, at(t)) }, n),
    x.runtime
      .sendMessage({ type: `SYNC_EVENT`, payload: { kind: `roster` } })
      .catch(() => {}));
}
(A(
  `SYNC_LOCAL_PAYLOAD`,
  j(async (e) => ({ ok: !0, data: await nc(Ue.parse(e.payload).vaultId) })),
),
  A(
    `SYNC_APPLY_REMOTE`,
    j(async (e) => {
      let { vaultId: t, payloadJson: n } = Ze.parse(e.payload);
      return { ok: !0, data: await oc(t, n) };
    }),
  ),
  A(
    `SYNC_LOCAL_ROSTER`,
    j(async (e) => ({ ok: !0, data: await cc(Ue.parse(e.payload).vaultId) })),
  ),
  A(
    `SYNC_APPLY_ROSTER`,
    j(async (e) => {
      let { vaultId: t, rosterJson: n } = We.parse(e.payload);
      return (await lc(t, n), { ok: !0 });
    }),
  ),
  Qr((e) => {
    k({ type: `LINK_SYNC_FRAME`, payload: { frame: e, room: `enroll` } }).catch(
      () => {},
    );
  }),
  wn({
    fetchLocalPayload: nc,
    pushRemotePayload: (e, t) => oc(e, t).then(() => {}),
    fetchLocalRoster: cc,
    pushRemoteRoster: lc,
    blobArrived: Nt,
    linkSend: vi,
    linkBlobSend: Ci,
    linkBlobUp: async () => Si(),
    linkDesktopSyncKey: () => Li(),
    linkAuthenticated: (e) => void Cr(e).catch(() => {}),
  }),
  A(
    `BLOB_STATUS`,
    j(async (e) =>
      k({
        type: `BLOB_STATUS`,
        payload: rt.parse({ ...e.payload, vaultId: e.vaultId }),
      }),
    ),
  ),
  A(
    `BLOB_ARRIVED`,
    j(async () => (Nt(), { ok: !0 })),
  ));
var uc = `autofill.index`,
  dc = `vault:autolock`,
  J = 0,
  fc = 0,
  pc = 0,
  mc = 0;
function hc() {
  try {
    return crypto.randomUUID();
  } catch {
    return `autofill-session-${++mc}`;
  }
}
var gc = hc();
function _c() {
  return J;
}
function vc(e) {
  return fc === 0 && e === J;
}
function yc(e) {
  return vc(e) && !Z();
}
function Y() {
  let e = Ec();
  return e === null || !yc(J) ? null : { vaultId: e, generation: J, token: gc };
}
function X(e) {
  return Ec() === e.vaultId && yc(e.generation) && gc === e.token;
}
function bc(e) {
  let t = Y();
  return t !== null && t.vaultId === e.vaultId && t.token === e.token;
}
function xc() {
  (J++, (gc = hc()), fc++);
}
function Sc() {
  fc = Math.max(0, fc - 1);
}
function Cc() {
  (J++, (gc = hc()));
}
function wc(e) {
  return dn(e) ? (Cc(), Xs(O()), ji(O()), !0) : !1;
}
function Tc() {
  let e = Y();
  return e === null
    ? { ok: !1, error: `unavailable` }
    : { ok: !0, data: { vaultId: e.vaultId, token: e.token } };
}
(tr((e, t) => {
  e?.type === `CRYPTO_LOCK` && C(t) && (xc(), cn(), pc++);
}),
  x.storage.onChanged.addListener((e, t) => {
    if (t !== `session`) return;
    let n = e[g];
    n && !tn(n) && wc(n.newValue);
  }));
function Z() {
  return gn();
}
function Ec() {
  return O();
}
function Dc() {
  let e = O();
  if (e === null) throw Error(`vault locked`);
  return e;
}
async function Oc() {
  let e = await hn();
  return (e !== void 0 && wc(e), O());
}
function kc() {
  return _n();
}
var Ac = (async () => {
  try {
    (await un, await x.storage.session.remove([uc]).catch(() => {}));
  } catch (e) {
    console.warn(`[bramble:bg] session hydration failed`, e);
  }
})();
async function Q() {
  let e = await ta();
  e <= 0 ? x.alarms.clear(dc) : x.alarms.create(dc, { delayInMinutes: e });
}
async function jc(e, t = J) {
  try {
    let n = await x.tabs.query({});
    if (t !== J) return;
    for (let t of n)
      t.id !== void 0 &&
        x.tabs
          .sendMessage(t.id, {
            type: `VAULT_LOCK_STATE`,
            payload: { locked: e },
          })
          .catch(() => {});
  } catch {}
}
async function Mc() {
  try {
    let e = await x.storage.session.get(null),
      t = [xa, h];
    for (let n of Object.keys(e)) n.startsWith(`capture.pending.`) && t.push(n);
    await x.storage.session.remove(t);
  } catch {}
}
async function Nc() {
  (xc(), cn());
  try {
    (jc(!0, J), lo(), Js());
    let e;
    try {
      (await bn(), await x.storage.session.remove(Ce));
    } catch (t) {
      e = t;
    }
    if ((await Mc(), dt().catch(() => {}), x.alarms.clear(dc), e)) throw e;
  } finally {
    Sc();
  }
}
async function Pc(e) {
  O() === e ? await Nc() : await yn(e);
}
async function Fc(e) {
  let t = e.type;
  if (t === `CRYPTO_LOCK`) {
    pc > 0 ? pc-- : xc();
    try {
      let t = (typeof e.vaultId == `string` ? e.vaultId : null) ?? (await mn()),
        n = await k(e);
      return (await Oc(), t === null ? await Nc() : await Pc(t), n);
    } finally {
      Sc();
    }
  }
  let n = sn(t);
  n && (await Oc());
  let r = n ? cn() : void 0;
  n && xc();
  try {
    let i = await k(e, r);
    if (n && !D(r)) return { ok: !1, error: de };
    if (i.ok) {
      if (t === `CRYPTO_GENERATE_VEK`) {
        if ((await Oc(), !D(r) || (Cc(), await Q(), !D(r))))
          return { ok: !1, error: de };
        jc(!1, J);
      } else if (t === `CRYPTO_UNLOCK_WITH_VEK` || t === `CRYPTO_ROTATE_VEK`) {
        if ((await Oc(), !D(r))) return { ok: !1, error: de };
        Cc();
      } else if (
        (t === `CRYPTO_UNWRAP_PASSWORD_SLOT` ||
          t === `CRYPTO_UNWRAP_WEBAUTHN_SLOT`) &&
        i.data === !0
      ) {
        if ((await Oc(), !D(r) || (Cc(), await Q(), !D(r))))
          return { ok: !1, error: de };
        let e = () => D(r);
        (Gc(e), jc(!1, J), Na(e));
      }
    }
    return i;
  } finally {
    n && Sc();
  }
}
(er(`CRYPTO_`, j(Fc)),
  A(
    `VAULT_OPENED`,
    j(async (e) => {
      let { vaultId: t } = Ue.parse(e.payload);
      return (await Oc()) !== t || Z()
        ? { ok: !1, error: `not the open vault` }
        : (await x.storage.session.set({ [Ce]: t }),
          await x.storage.local.set({ [Se]: t }).catch(() => {}),
          qs(ln()),
          { ok: !0 });
    }),
  ),
  A(
    `AUTOFILL_GET_SESSION_OWNER`,
    j(async () => Tc()),
  ));
var Ic = `backup:scheduled`,
  Lc = 30;
async function Rc() {
  let e = m(await y.getMeta(o));
  return e.vaults.map((t) => ({
    id: t.id,
    isDefault: t.id === e.vaults[0]?.id,
  }));
}
async function zc(e) {
  return (await y.getMeta(l(e))) ?? [];
}
async function Bc(e) {
  await p(
    y,
    e.map((e) => e.id),
    () => crypto.randomUUID(),
  );
}
async function Vc() {
  let e = await Rc();
  await Bc(e);
  let t = !1;
  for (let n of e)
    if ((await zc(n.id)).some((e) => e.frequency !== `off`)) {
      t = !0;
      break;
    }
  t ? x.alarms.create(Ic, { periodInMinutes: Lc }) : x.alarms.clear(Ic);
}
async function Hc(e, t) {
  let n = kc(),
    r = [...(n.includes(e) ? [e] : []), ...n.filter((t) => t !== e)];
  for (let e of r) {
    let n = await k({
      type: `CRYPTO_DECRYPT_OUTER`,
      vaultId: e,
      payload: { iv: t.iv, ciphertext: t.ciphertext },
    });
    if (n.ok && typeof n.data == `string`) return JSON.parse(n.data);
  }
  return null;
}
var Uc = !1;
async function Wc() {
  let e = await Rc();
  await Bc(e);
  let t = [];
  for (let n of e)
    try {
      t.push({
        id: n.id,
        blob: await y.readVaultBlob(n.id),
        isDefault: n.isDefault,
      });
    } catch {}
  return t;
}
async function Gc(e = () => !Z()) {
  if (Uc || !e()) return;
  Uc = !0;
  let n = setInterval(
      () => void x.runtime.getPlatformInfo().catch(() => {}),
      2e4,
    ),
    r = Pt((e) =>
      ee({
        vault: e.blob,
        blobs: Fe(e.id),
        decryptWithVek: async (t, n) => {
          let r = await k({
            type: `CRYPTO_DECRYPT_OUTER`,
            vaultId: e.id,
            payload: { iv: t, ciphertext: n },
          });
          if (!r.ok || typeof r.data != `string`)
            throw Error(r.error ?? `locked`);
          return r.data;
        },
        listCache: c(y, e.id),
      }),
    );
  try {
    let n = await Ft(
      {
        listVaults: async () => (e() ? Wc() : []),
        loadTargets: async (t) => (e() ? zc(t) : []),
        saveTargets: async (t, n) => {
          e() && (await y.setMeta(l(t), n));
        },
        hashVault: async (t) => (e() ? r.fingerprint(t) : ``),
        blocked: r.blocked,
        decryptSecrets: async (t, n) => {
          if (!e()) throw Error(`vault session changed`);
          return Hc(t, n);
        },
        upload: async (n, i, a, o) => {
          if (!e()) throw Error(`vault session changed`);
          if (a === null) throw Error(`no credentials for this target`);
          let c = ne(i, a),
            l = Dt(c, yt(c, Fn) ?? Fn);
          await Ct(l, await r.body(o), {
            fingerprint: await r.fingerprint(o),
            prefix: t(i, o.id, o.isDefault),
            keep: i.keep,
            vaultId: s(i, o.id),
          });
        },
      },
      Date.now(),
    );
    n.attempted > 0 &&
      console.info(
        `[bramble:bg] backup: ${n.succeeded.length} ok, ${n.failed.length} failed`,
      );
    for (let e of n.failed)
      console.warn(
        `[bramble:bg] backup failed for ${e.id} (vault ${e.vaultId}):`,
        e.error,
      );
  } finally {
    (clearInterval(n), (Uc = !1));
  }
}
function Kc() {
  let e = setInterval(
    () => void x.runtime.getPlatformInfo().catch(() => {}),
    2e4,
  );
  return () => clearInterval(e);
}
async function qc(e) {
  let t = await k({
    type: `CRYPTO_ENCRYPT_OUTER`,
    vaultId: Ec() ?? void 0,
    payload: { plaintext: e },
  });
  if (!t.ok || !t.data || typeof t.data != `object`)
    throw Error(`Couldn't secure the credentials.`);
  let { iv: n, ciphertext: r } = t.data;
  return { iv: n, ciphertext: r };
}
async function Jc(e) {
  let t = e.payload?.providerId,
    n = e.payload?.targetId;
  if (!t || !kt[t]) return { ok: !1, error: `Unknown provider.` };
  if (Z()) return { ok: !1, error: `Unlock Bramble first, then connect.` };
  let r = kt[t],
    i = x.identity.getRedirectURL(),
    a = await xt(),
    o = crypto.randomUUID(),
    s = new URL(r.authUrl),
    c = s.searchParams;
  (c.set(`client_id`, r.clientId),
    c.set(`response_type`, `code`),
    c.set(`redirect_uri`, i),
    c.set(`scope`, r.scopes.join(` `)),
    c.set(`code_challenge`, a.challenge),
    c.set(`code_challenge_method`, `S256`),
    c.set(`state`, o));
  for (let [e, t] of Object.entries(r.authParams ?? {})) c.set(e, t);
  let u = Kc(),
    d;
  try {
    d = await x.identity.launchWebAuthFlow({
      url: s.toString(),
      interactive: !0,
    });
  } catch (e) {
    return { ok: !1, error: `Sign-in was cancelled or failed: ${e.message}` };
  } finally {
    u();
  }
  if (!d) return { ok: !1, error: `Sign-in was cancelled.` };
  let f = new URL(d),
    p =
      f.searchParams.has(`code`) || f.searchParams.has(`error`)
        ? f.searchParams
        : new URLSearchParams(f.hash.replace(/^#/, ``)),
    ee = p.get(`error_description`) || p.get(`error`);
  if (ee) return { ok: !1, error: `Sign-in failed: ${ee}` };
  if (p.get(`state`) !== o)
    return { ok: !1, error: `Sign-in could not be verified (state mismatch).` };
  let te = p.get(`code`);
  if (!te) return { ok: !1, error: `No authorization code was returned.` };
  let ne = await bt({
      providerId: t,
      code: te,
      codeVerifier: a.verifier,
      redirectUri: i,
    }),
    m = await qc(JSON.stringify({ refreshToken: ne.refreshToken })),
    re = Ec();
  if (!re) return { ok: !1, error: `Unlock Bramble first, then connect.` };
  let h = l(re),
    ie = (await y.getMeta(h)) ?? [];
  if (n && ie.some((e) => e.id === n))
    return (
      await y.setMeta(
        h,
        ie.map((e) => (e.id === n ? { ...e, creds: m, lastError: void 0 } : e)),
      ),
      { ok: !0, data: { targetId: n } }
    );
  let ae = crypto.randomUUID(),
    oe = {
      id: ae,
      providerId: t,
      provider: t,
      frequency: `daily`,
      keep: 30,
      creds: m,
    };
  return (await y.setMeta(h, [...ie, oe]), { ok: !0, data: { targetId: ae } });
}
(A(
  `BACKUP_OAUTH_CONNECT`,
  j((e) => Jc(e)),
),
  x.permissions?.onAdded.addListener((e) => {
    e.permissions?.some((e) => fe.permissions.includes(e)) && xe();
  }),
  xe());
async function Yc() {
  let e = await pe();
  if (e?.id === void 0)
    return { ok: !1, error: `No browser window to capture` };
  let t = await k({
    type: `QR_DECODE`,
    payload: {
      dataUrl: await x.tabs.captureVisibleTab(e.id, { format: `png` }),
    },
  });
  return t.ok
    ? { ok: !0, data: t.data ?? null }
    : { ok: !1, error: t.error ?? `QR decode failed` };
}
A(`CAPTURE_QR_SCAN`, Yc);
var Xc = { 16: `icons/icon-16.png`, 32: `icons/icon-32.png` },
  Zc = { 16: `icons/icon-16-dark.png`, 32: `icons/icon-32-dark.png` };
async function Qc(e) {
  let t = e?.payload?.dark;
  return typeof t == `boolean`
    ? (await x.action.setIcon({ path: t ? Zc : Xc }), { ok: !0 })
    : { ok: !1, error: `missing dark flag` };
}
A(`THEME_ICON_SET`, Qc);
function $c(e) {
  try {
    let t = el(e).extensions,
      n = rl(t) ? t.remoteDesktopClientOverride : void 0;
    if (!rl(n) || typeof n.origin != `string`) return null;
    let r = new URL(n.origin);
    return r.protocol !== `https:` && r.protocol !== `http:`
      ? null
      : { origin: r.origin, crossOrigin: n.sameOriginWithAncestors === !1 };
  } catch {
    return null;
  }
}
function el(e) {
  let t = JSON.parse(e);
  return t.publicKey ?? t;
}
function tl(e) {
  let t = el(e),
    n = t.rp ?? {},
    r = t.user ?? {},
    i = t.pubKeyCredParams ?? [],
    a = t.authenticatorSelection ?? {},
    o = t.excludeCredentials ?? [];
  return {
    rpId: n.id,
    rpName: n.name,
    userHandleB64Url: r.id ?? ``,
    userName: r.name,
    userDisplayName: r.displayName,
    challenge: t.challenge ?? ``,
    algs: i.map((e) => e.alg).filter((e) => typeof e == `number`),
    excludeCredentialsB64Url: o.map((e) => e.id).filter((e) => !!e),
    userVerification: a.userVerification ?? `preferred`,
    prf: cl(t),
  };
}
function nl(e) {
  let t = el(e),
    n = t.allowCredentials ?? [];
  return {
    rpId: t.rpId,
    challenge: t.challenge ?? ``,
    allowCredentialsB64Url: n.map((e) => e.id).filter((e) => !!e),
    userVerification: t.userVerification ?? `preferred`,
    prf: ll(t),
  };
}
var rl = (e) => typeof e == `object` && !!e && !Array.isArray(e);
function il(e) {
  try {
    let t = e.replace(/\+/g, `-`).replace(/\//g, `_`).replace(/=+$/, ``);
    return Ge(ot(t));
  } catch {
    return null;
  }
}
var al = (e) => typeof e == `string` && il(e) === e;
function ol(e) {
  if (rl(e) && al(e.first))
    return e.second === void 0
      ? { first: e.first }
      : al(e.second)
        ? { first: e.first, second: e.second }
        : void 0;
}
function sl(e) {
  let t = e.extensions;
  return rl(t) && rl(t.prf) ? t.prf : void 0;
}
function cl(e) {
  let t = sl(e);
  if (!t) return;
  let n = ol(t.eval);
  return n ? { eval: n } : {};
}
function ll(e) {
  let t = sl(e);
  if (!t) return;
  let n = {},
    r = ol(t.eval);
  if ((r && (n.eval = r), rl(t.evalByCredential))) {
    let e = Object.fromEntries(
      Object.entries(t.evalByCredential).flatMap(([e, t]) => {
        let n = il(e),
          r = ol(t);
        return n && r ? [[n, r]] : [];
      }),
    );
    Object.keys(e).length && (n.evalByCredential = e);
  }
  return n;
}
function ul(e, t) {
  let n = e?.evalByCredential;
  return n && Object.hasOwn(n, t) ? n[t] : e?.eval;
}
function dl(e) {
  return new URL(e).hostname.toLowerCase();
}
function fl(e) {
  return e.toLowerCase();
}
function pl(e, t) {
  if (!t) return !1;
  let n = e.toLowerCase(),
    r = t.toLowerCase();
  return n !== r && !n.endsWith(`.${r}`)
    ? !1
    : r === `localhost` || oe(r) !== null;
}
function ml(e, t, n) {
  let r = JSON.stringify({
      type: e,
      challenge: t,
      origin: n.origin,
      crossOrigin: n.crossOrigin,
    }),
    i = new TextEncoder().encode(r);
  return { json: r, bytes: i, b64Url: Ge(i) };
}
function hl(e) {
  let t = b(e.credentialIdStdB64);
  return JSON.stringify({
    id: t,
    rawId: t,
    type: `public-key`,
    authenticatorAttachment: `platform`,
    response: {
      clientDataJSON: e.clientDataB64Url,
      attestationObject: b(e.attestationObjectStdB64),
      authenticatorData: b(e.authenticatorDataStdB64),
      transports: e.transports ?? [`internal`, `hybrid`],
      publicKeyAlgorithm: -7,
      publicKey: b(e.publicKeyStdB64),
    },
    clientExtensionResults: e.prf ? { prf: e.prf } : {},
  });
}
function gl(e) {
  let t = b(e.credentialIdStdB64);
  return JSON.stringify({
    id: t,
    rawId: t,
    type: `public-key`,
    authenticatorAttachment: `platform`,
    response: {
      clientDataJSON: e.clientDataB64Url,
      authenticatorData: b(e.authenticatorDataStdB64),
      signature: b(e.signatureStdB64),
      userHandle: e.userHandleStdB64 ? b(e.userHandleStdB64) : null,
    },
    clientExtensionResults: e.prf ? { prf: e.prf } : {},
  });
}
async function _l(e, t) {
  let n = await k({
    type: `CRYPTO_PASSKEY_MAKE`,
    payload: { rpId: e, userVerified: t },
  });
  if (!n.ok || !n.data) throw Error(n.error ?? `passkey mint failed`);
  return n.data;
}
async function vl(e, t, n, r, i) {
  let a = await k({
    type: `CRYPTO_PASSKEY_GET`,
    payload: {
      rpId: e,
      privateKeyB64: t,
      alg: n,
      clientDataHashB64: r,
      userVerified: i,
    },
  });
  if (!a.ok || !a.data) throw Error(a.error ?? `passkey assertion failed`);
  return a.data;
}
async function yl(e, t, n) {
  let r = await k({
    type: `CRYPTO_PASSKEY_PRF`,
    payload: { secretB64: e, firstB64: t, secondB64: n },
  });
  if (!r.ok || !r.data) throw Error(r.error ?? `passkey PRF failed`);
  return r.data;
}
async function bl() {
  let e = Dc(),
    t = await Vn(e);
  if (t.entriesCiphertext.length === 0) return [];
  let n = await k({
    type: `CRYPTO_DECRYPT_OUTER`,
    vaultId: e,
    payload: { iv: S(t.entriesIv), ciphertext: S(t.entriesCiphertext) },
  });
  if (!n.ok || typeof n.data != `string`)
    throw Error(`outer decrypt failed: ${n.error ?? `no data`}`);
  let r = [];
  for (let t of Ie(n.data).entries) {
    let n = await k({
      type: `CRYPTO_DECRYPT`,
      vaultId: e,
      payload: {
        ciphertext: t.ciphertext,
        iv: t.iv,
        wrappedDek: t.wrappedDek,
        dekIv: t.dekIv,
      },
    });
    n.ok &&
      typeof n.data == `string` &&
      r.push({ ...Xe(JSON.parse(n.data)), id: t.id });
  }
  return r;
}
async function xl(e, t) {
  let n = await k({
    type: `CRYPTO_ENCRYPT`,
    vaultId: e,
    payload: { plaintextJson: t },
  });
  if (!n.ok || !n.data)
    throw Error(`encrypt entry failed: ${n.error ?? `no data`}`);
  return n.data;
}
async function Sl(e, t, n) {
  let r = {
    slots: t.slots,
    entriesIv: n.entriesIv,
    entriesCiphertext: n.entriesCiphertext,
  };
  await Hn($e(r), e);
}
function Cl(e) {
  try {
    return new URL(e).hostname;
  } catch {
    return e;
  }
}
async function wl(e) {
  let t = Dc(),
    n = await Vn(t);
  if (e.kind === `create`) {
    if (e.data.type !== `login`) throw Error(`only a login can be placed here`);
    let r = globalThis.crypto.randomUUID(),
      i = await Rn(),
      a = {
        id: r,
        ...(await xl(t, it(r, e.data, void 0, i))),
        hlc: i,
        ...Pe({ hlc: i, bases: [], held: [] }),
      };
    (await Sl(t, n, await Un(n, async (e) => [...e, a], t)),
      await fo({
        type: `login`,
        id: r,
        hostnames: e.data.urls.map(Cl).filter(Boolean),
        name: e.data.name,
        username: e.data.username,
        password: e.data.password,
      }));
  } else
    await Sl(
      t,
      n,
      await Un(
        n,
        async (n, r) => {
          let i = [];
          for (let a of n) {
            if (a.id !== e.entryId) {
              i.push(a);
              continue;
            }
            let n = await k({
              type: `CRYPTO_DECRYPT`,
              vaultId: t,
              payload: {
                ciphertext: a.ciphertext,
                iv: a.iv,
                wrappedDek: a.wrappedDek,
                dekIv: a.dekIv,
              },
            });
            if (!n.ok || typeof n.data != `string`)
              throw Error(`decrypt entry failed: ${n.error ?? `no data`}`);
            let o = JSON.parse(n.data),
              s = await Rn(),
              c = ht(r, a.id),
              l = gt({ hlc: s, bases: [a], held: c }),
              u = Ne(o.passkeys, e.passkey),
              d = { ...o, passkeys: u },
              f = await xl(t, it(a.id, d, { data: o, version: a }, l.hlc));
            i.push({ id: a.id, ...f, hlc: l.hlc, ...l.causal });
          }
          return i;
        },
        t,
      ),
    );
  await Wn();
}
var $ = class extends Error {
  domName;
  constructor(e, t) {
    (super(t), (this.domName = e), (this.name = e));
  }
};
function Tl(e) {
  return e.userName?.trim() || e.userDisplayName?.trim() || `Passkey`;
}
function El(e) {
  return e.userVerification === `required` || e.prf !== void 0;
}
async function Dl(e) {
  let t = e.isLocked();
  if (t && (!(await e.showCard({})).approved || !(await e.ensureUnlocked())))
    return null;
  let n = [];
  try {
    n = await e.loadEntries();
  } catch {}
  return { startedLocked: t, entries: n };
}
async function Ol(e, t, n, r) {
  return n || t.unlockVerifies
    ? { approved: !0, userVerified: !0, ...r }
    : e.needsVerification
      ? (await t.verifyUser())
        ? { approved: !0, userVerified: !0, ...r }
        : { approved: !1 }
      : { approved: !0, userVerified: !1, ...r };
}
async function kl(e, t) {
  let n = await Dl(t);
  if (!n) return { approved: !1 };
  let { startedLocked: r, entries: i } = n,
    a = Ae(i, e.rpId, e.allowCredentials);
  if (a.length === 0)
    return !r && !(await t.showCard({})).approved
      ? { approved: !1 }
      : { approved: !1, passthrough: !0 };
  if (r && a.length === 1)
    return Ol(e, t, r, { credentialId: a[0]?.passkey.credentialId });
  let o = await t.showCard({
    passkeyChoices: a.map((e) => ({
      credentialId: e.passkey.credentialId,
      label: Tl(e.passkey),
    })),
  });
  return o.approved
    ? Ol(e, t, r, { credentialId: o.choice ?? a[0]?.passkey.credentialId })
    : { approved: !1 };
}
async function Al(e, t) {
  let n = await Dl(t);
  if (!n) return { approved: !1 };
  let { startedLocked: r, entries: i } = n,
    a = ze(i, e.rpId, e.userName);
  if (a)
    return !r && !(await t.showCard({ existingLoginName: a.name })).approved
      ? { approved: !1 }
      : Ol(e, t, r, { placement: { entryId: a.id } });
  let o = je(i, e.rpId);
  if (o.length === 0)
    return !r && !(await t.showCard({})).approved
      ? { approved: !1 }
      : Ol(e, t, r, { placement: `new` });
  let s = await t.showCard({
    candidates: o.map((e) => ({
      id: e.id,
      name: e.name,
      username: e.username,
    })),
  });
  return s.approved
    ? Ol(e, t, r, {
        placement:
          s.choice && s.choice !== `new` ? { entryId: s.choice } : `new`,
      })
    : { approved: !1 };
}
function jl(e, t) {
  if (!e) throw new $(`NotAllowedError`, `request has no origin`);
  let n = dl(e),
    r = t ?? fl(n);
  if (!pl(n, r))
    throw new $(`SecurityError`, `rpId ${r} is not valid for origin ${e}`);
  return { rpId: r, host: n };
}
async function Ml(e, t, n) {
  try {
    let r = await e.crypto.passkeyPrfEval(
        t,
        nt(n.first),
        n.second === void 0 ? void 0 : nt(n.second),
      ),
      i = b(r.first);
    return r.second === void 0
      ? { first: i }
      : { first: i, second: b(r.second) };
  } catch {
    return;
  }
}
function Nl(e, t, n, r, i) {
  let a = e.placement;
  if (a === `new`) return Ve(n, r, i);
  if (a) {
    let e = t.find((e) => e.type === `login` && e.id === a.entryId);
    if (e) return Le(e, i);
  }
  return He(t, n, r, i);
}
async function Pl(e, t, n, r) {
  try {
    let i = tl(n),
      { rpId: a } = jl(r.origin, i.rpId);
    if (De(a)) throw new $(`NotAllowedError`, `reserved relying party`);
    if (!i.algs.includes(-7))
      throw new $(`NotSupportedError`, `only ES256 (-7) is supported`);
    let o = await e.ceremony({
      kind: `create`,
      rpId: a,
      rpName: i.rpName,
      userName: i.userName,
      origin: r.origin,
      needsVerification: El(i),
    });
    if (!o.approved) {
      if (o.passthrough) return { requestId: t, passthrough: !0 };
      throw new $(`NotAllowedError`, `user declined`);
    }
    let s = await e.loadEntries(),
      c = i.excludeCredentialsB64Url.map(nt);
    if (c.length && Ae(s, a, c).length)
      throw new $(
        `InvalidStateError`,
        `a passkey for this account is already stored`,
      );
    let l = await e.crypto.passkeyMakeCredential(a, o.userVerified),
      u = {
        credentialId: l.credentialId,
        rpId: a,
        rpName: i.rpName,
        userHandle: nt(i.userHandleB64Url),
        userName: i.userName,
        userDisplayName: i.userDisplayName,
        alg: -7,
        publicKeyCose: l.publicKeyCose,
        privateKey: l.privateKey,
        signCount: 0,
        createdAt: e.now(),
        prf: l.prf,
      },
      d = Nl(o, s, a, i.rpName, u);
    (await e.savePlacement(d),
      e.onSaved?.({
        rpId: a,
        created: d.kind === `create`,
        loginName:
          d.kind === `create`
            ? d.data.name
            : (s.find((e) => e.id === d.entryId)?.name ?? a),
      }));
    let f =
        i.prf?.eval && o.userVerified
          ? await Ml(e, l.prf.credWithUV, i.prf.eval)
          : void 0,
      p = ml(`webauthn.create`, i.challenge, r);
    return {
      requestId: t,
      responseJson: hl({
        credentialIdStdB64: l.credentialId,
        attestationObjectStdB64: l.attestationObject,
        authenticatorDataStdB64: l.authenticatorData,
        publicKeyStdB64: l.publicKey,
        clientDataB64Url: p.b64Url,
        prf: i.prf ? { enabled: !0, results: f } : void 0,
      }),
    };
  } catch (e) {
    return { requestId: t, error: Ll(e) };
  }
}
async function Fl(e, t, n, r) {
  try {
    let i = nl(n),
      { rpId: a } = jl(r.origin, i.rpId);
    if (De(a)) throw new $(`NotAllowedError`, `reserved relying party`);
    let o = i.allowCredentialsB64Url.map(nt),
      s = await e.ceremony({
        kind: `get`,
        rpId: a,
        origin: r.origin,
        needsVerification: El(i),
        allowCredentials: o.length ? o : void 0,
      });
    if (!s.approved) {
      if (s.passthrough) return { requestId: t, passthrough: !0 };
      throw new $(`NotAllowedError`, `user declined`);
    }
    let c = s.credentialId ? [s.credentialId] : o.length ? o : void 0,
      l = Ae(await e.loadEntries(), a, c),
      u = l.find((e) => e.passkey.credentialId === s.credentialId) ?? l[0];
    if (!u) throw new $(`NotAllowedError`, `no matching passkey`);
    let d = ml(`webauthn.get`, i.challenge, r),
      f = await e.sha256(d.bytes),
      p = await e.crypto.passkeyGetAssertion(
        a,
        u.passkey.privateKey,
        u.passkey.alg,
        f,
        s.userVerified,
      ),
      ee = ul(i.prf, b(u.passkey.credentialId)),
      te =
        ee && u.passkey.prf && s.userVerified
          ? await Ml(e, u.passkey.prf.credWithUV, ee)
          : void 0;
    return {
      requestId: t,
      responseJson: gl({
        credentialIdStdB64: u.passkey.credentialId,
        authenticatorDataStdB64: p.authenticatorData,
        signatureStdB64: p.signature,
        clientDataB64Url: d.b64Url,
        userHandleStdB64: u.passkey.userHandle || void 0,
        prf: te ? { results: te } : void 0,
      }),
    };
  } catch (e) {
    return { requestId: t, error: Ll(e) };
  }
}
var Il = {
  name: `NotAllowedError`,
  message: `The operation either timed out or was not allowed.`,
};
function Ll(e) {
  return e instanceof $ ? { name: e.domName, message: e.message } : Il;
}
var Rl = 15e4,
  zl = new Map();
async function Bl(e) {
  let t = Date.now() + e;
  for (; Date.now() < t;) {
    if (!Z()) return !0;
    await new Promise((e) => setTimeout(e, 400));
  }
  return !Z();
}
function Vl(e, t, n) {
  return new Promise((r) => {
    (zl.set(t.promptId, r),
      x.tabs
        .sendMessage(
          e,
          { type: `CORNER_PROMPT_SHOW`, payload: t },
          { frameId: 0 },
        )
        .catch(() => {
          zl.delete(t.promptId) && r({ approved: !1 });
        }),
      setTimeout(() => {
        zl.delete(t.promptId) && r({ approved: !1 });
      }, n));
  });
}
function Hl(e, t = {}) {
  return {
    kind: `save-passkey`,
    promptId: globalThis.crypto.randomUUID(),
    hostname: e.rpId,
    locked: Z(),
    intent: e.kind,
    rpId: e.rpId,
    rpName: e.kind === `create` ? e.rpName : void 0,
    requester: new URL(e.origin).hostname,
    userName: e.kind === `create` ? e.userName : void 0,
    ...t,
  };
}
var Ul = new Map(),
  Wl = 6e4,
  Gl = null;
function Kl(e) {
  return !Gl ||
    Gl.origin !== e.origin ||
    Gl.rpId !== e.rpId ||
    Date.now() >= Gl.until
    ? !1
    : ((Gl = null), !0);
}
async function ql(e, t, n) {
  if (Kl(e)) return !0;
  let r = globalThis.crypto.randomUUID(),
    i = new Promise((e) => {
      (Ul.set(r, { settle: e, requestGone: n }),
        setTimeout(() => {
          Ul.delete(r) && e({ verified: !1, keepWindow: !1 });
        }, t));
    }),
    a = await ja(
      `/passkey-verify?${new URLSearchParams({ id: r, rp: e.rpId })}`,
    ),
    { verified: o, keepWindow: s } = await i;
  return (a !== void 0 && !s && (await x.windows.remove(a).catch(() => {})), o);
}
A(
  `PASSKEY_VERIFY_RESULT`,
  j(async (e) => {
    let { id: t, verified: n } = e.payload ?? {},
      r = t ? Ul.get(t) : void 0,
      i = !1;
    return (
      t &&
        r &&
        (Ul.delete(t),
        (i = n === !0 && r.requestGone()),
        r.settle({ verified: n === !0, keepWindow: i })),
      { ok: !0, data: { signInAgain: i } }
    );
  }),
);
async function Jl(e) {
  if (!Z()) return !0;
  let t = await Aa(),
    n = await Bl(e);
  return (n && t !== void 0 && (await x.windows.remove(t).catch(() => {})), n);
}
var Yl = !1;
function Xl(e, t) {
  return async (n) => {
    if (Yl) return { approved: !1 };
    Yl = !0;
    try {
      let r = Date.now() + Rl,
        i = () => Math.max(0, r - Date.now()),
        a = Z(),
        o = !1,
        s = {
          isLocked: () => a,
          ensureUnlocked: () => Jl(i()),
          unlockVerifies: await oa(),
          verifyUser: () => ql(n, i(), t),
          loadEntries: bl,
          showCard: async (t) => {
            let r = await Vl(e, Hl(n, t), i());
            return ((o = !!r.dismissed), r);
          },
        },
        c = await (n.kind === `create` ? Al(n, s) : kl(n, s));
      return !c.approved && o
        ? { approved: !1, passthrough: !0 }
        : (c.approved &&
            c.userVerified &&
            t() &&
            (Gl = { origin: n.origin, rpId: n.rpId, until: Date.now() + Wl }),
          c);
    } finally {
      Yl = !1;
    }
  };
}
async function Zl(e) {
  let t = await globalThis.crypto.subtle.digest(`SHA-256`, new Uint8Array(e));
  return S(new Uint8Array(t));
}
function Ql(e, t = () => !1) {
  return {
    crypto: {
      passkeyMakeCredential: _l,
      passkeyGetAssertion: vl,
      passkeyPrfEval: yl,
    },
    loadEntries: bl,
    savePlacement: wl,
    ceremony: Xl(e, t),
    sha256: Zl,
    now: () => Date.now(),
    onSaved: (e) => {
      x.runtime
        .sendMessage({ type: `PASSKEY_SAVED`, payload: e })
        .catch(() => {});
    },
  };
}
var $l = !1;
function eu() {
  return $l;
}
var tu = !1;
async function nu() {
  let e = await sa();
  tu || ($l = e);
}
var ru = async () => {};
function iu(e) {
  ru = e;
}
(A(`PASSKEY_PROMPT_RESPONSE`, async (e) => {
  let { promptId: t, approved: n, choice: r } = e.payload ?? {},
    i = zl.get(t);
  return (
    i && (zl.delete(t), i({ approved: !!n, choice: r, dismissed: !n })),
    { ok: !0, data: null }
  );
}),
  A(`PASSKEY_PROVIDER_SET_ENABLED`, async (e) => {
    let { enabled: t } = e.payload ?? {},
      n = $l;
    (($l = !!t), (tu = !0));
    try {
      await ru(!!t);
    } catch (e) {
      throw (($l = n), e);
    }
    return { ok: !0, data: null };
  }));
async function au() {
  try {
    let [e] = await x.tabs.query({ active: !0, lastFocusedWindow: !0 });
    if (e?.id === void 0) return null;
    let t = null;
    try {
      t = e.url ? new URL(e.url).origin : null;
    } catch {}
    return { id: e.id, origin: t };
  } catch {
    return null;
  }
}
async function ou(e) {
  let t = $c(e),
    n = await au();
  return !t || !n || (!t.crossOrigin && t.origin !== n.origin)
    ? null
    : { caller: t, tabId: n.id };
}
var su = 0,
  cu = !1,
  lu = new Map();
function uu(e, t) {
  return e === `create`
    ? x.webAuthenticationProxy.completeCreateRequest(t)
    : x.webAuthenticationProxy.completeGetRequest(t);
}
async function du() {
  if (x.webAuthenticationProxy === void 0 || lu.size === 0) return;
  let e = [...lu];
  lu.clear();
  for (let [t, n] of e)
    await uu(n, {
      requestId: t,
      error: {
        name: `NotAllowedError`,
        message: `Bramble paused passkey handling to unlock its own vault. Try again.`,
      },
    }).catch(() => {});
}
var fu = { create: Pl, get: Fl };
function pu(e, t) {
  (lu.set(t.requestId, e),
    (async () => {
      await rr();
      let n = await ou(t.requestDetailsJson),
        r = n
          ? await fu[e](
              Ql(n.tabId, () => !lu.has(t.requestId)),
              t.requestId,
              t.requestDetailsJson,
              n.caller,
            )
          : { requestId: t.requestId, error: Il };
      if (lu.delete(t.requestId))
        try {
          await uu(
            e,
            `passthrough` in r ? { requestId: t.requestId, error: Il } : r,
          );
        } catch (n) {
          (console.error(`[passkey] completing a ${e} request failed`, n),
            await uu(e, { requestId: t.requestId, error: Il }).catch(() => {}));
        }
    })());
}
(A(
  `PASSKEY_PROXY_PAUSE`,
  async () => (
    su === 0 && hu && ((cu = !0), await du(), await vu()),
    su++,
    { ok: !0, data: null }
  ),
),
  A(
    `PASSKEY_PROXY_RESUME`,
    async () => (
      su > 0 && su--,
      su === 0 && cu && ((cu = !1), eu() && (await _u())),
      { ok: !0, data: null }
    ),
  ));
var mu = !1,
  hu = !1;
function gu() {
  mu ||
    x.webAuthenticationProxy === void 0 ||
    ((mu = !0),
    x.webAuthenticationProxy.onIsUvpaaRequest.addListener((e) => {
      x.webAuthenticationProxy.completeIsUvpaaRequest({
        requestId: e.requestId,
        isUvpaa: !0,
      });
    }),
    x.webAuthenticationProxy.onCreateRequest.addListener((e) =>
      pu(`create`, e),
    ),
    x.webAuthenticationProxy.onGetRequest.addListener((e) => pu(`get`, e)));
}
gu();
async function _u() {
  if (x.webAuthenticationProxy === void 0) return;
  if (su > 0) {
    cu = !0;
    return;
  }
  if (hu) return;
  let e = await x.webAuthenticationProxy.attach();
  if (e) throw Error(`webAuthenticationProxy.attach failed: ${e}`);
  hu = !0;
}
async function vu() {
  hu &&= (await x.webAuthenticationProxy.detach(), !1);
}
iu(async (e) => {
  e ? await _u() : await vu();
});
function yu(e) {
  return e.passthrough
    ? { passthrough: !0 }
    : e.error
      ? { error: { name: e.error.name, message: e.error.message } }
      : e.responseJson
        ? { responseJson: e.responseJson }
        : {
            error: { name: `NotAllowedError`, message: `no passkey response` },
          };
}
function bu(e) {
  if (!e) return null;
  try {
    let t = new URL(e);
    return t.protocol === `https:` || t.protocol === `http:` ? t.origin : null;
  } catch {
    return null;
  }
}
function xu(e) {
  let t = bu(e.origin ?? e.url),
    n = e.tab?.id;
  return !t || n === void 0 || (e.frameId !== 0 && t !== bu(e.tab?.url))
    ? null
    : { caller: { origin: t, crossOrigin: !1 }, tabId: n };
}
if (x.webAuthenticationProxy === void 0) {
  for (let [e, t] of [
    [`WEBAUTHN_CREATE`, Pl],
    [`WEBAUTHN_GET`, Fl],
  ])
    A(e, async (e, n) => {
      let r = eu() ? xu(n) : null;
      if (!r) return { ok: !0, data: { passthrough: !0 } };
      let i = JSON.stringify(e.payload ?? {});
      return { ok: !0, data: yu(await t(Ql(r.tabId), 0, i, r.caller)) };
    });
  A(`WEBAUTHN_IS_UVPAA`, async (e, t) => ({
    ok: !0,
    data: { isUvpaa: eu() && xu(t) !== null },
  }));
}
var Su = `vault:clipboard-clear`;
async function Cu() {
  let e = await ra();
  x.alarms.create(Su, { delayInMinutes: e / 60 });
}
async function wu() {
  await k({ type: `CLIPBOARD_CLEAR` }).catch(() => {});
}
async function Tu() {
  return (await Cu(), { ok: !0, data: null });
}
A(`CLIPBOARD_SCHEDULE_CLEAR`, Tu);
var Eu = Promise.all([Ac, so, nu()]);
(nr(Eu),
  Eu.then(() => {
    (R().catch(() => {}), Z() || (qs(), Gc()), Vc());
  }),
  Eu.then(() => {
    eu() && _u().catch((e) => console.warn(`[bramble:bg] passkey proxy`, e));
  }),
  x.runtime.onInstalled.addListener(() => {
    En();
  }),
  x.runtime.onStartup.addListener(() => {
    (En(), dt().catch(() => {}));
  }),
  navigator.storage?.persist?.().catch(() => {}));
async function Du(e) {
  try {
    await Nc();
  } catch (t) {
    console.error(`[bramble:bg] ${e} session cleanup failed`, t);
  } finally {
    await k({ type: `CRYPTO_LOCK` }).catch(() => {});
  }
}
(x.alarms.onAlarm.addListener((e) => {
  e.name === `vault:autolock`
    ? Du(`auto-lock`)
    : e.name === `vault:clipboard-clear`
      ? wu()
      : e.name === `sync-keepalive`
        ? Z() || qs()
        : e.name === `backup:scheduled` && (Z() || Gc());
}),
  x.commands?.onCommand.addListener((e) => {
    e === `lock-vault` && Du(`lock command`);
  }),
  ba(),
  x.idle?.onStateChanged.addListener((e) => {
    e === `locked` &&
      (Z() ||
        (async () => {
          (await na()) && (await Du(`screen lock`));
        })());
  }),
  x.storage.onChanged.addListener((e, t) => {
    t === `local` &&
      (e[`pref.autoLockMinutes`] && !Z() && Q(),
      Object.keys(e).some(he) &&
        !Z() &&
        (async () => {
          (await qs(), await k({ type: `SYNC_BROADCAST_NOW` }).catch(() => {}));
        })(),
      Object.keys(e).some(Ts) && !Z() && qs(),
      Object.keys(e).some(a) && Vc());
  }),
  Mt(() => {
    Z() || Gc();
  }));
