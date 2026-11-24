import { Dt as e, Ft as t, en as n, jt as r } from "./messages-DLCDPx8W.js";
var i = Object.create,
  a = Object.defineProperty,
  o = Object.getOwnPropertyDescriptor,
  s = Object.getOwnPropertyNames,
  c = Object.getPrototypeOf,
  l = Object.prototype.hasOwnProperty,
  u = (e, t) => () => (
    t || (e((t = { exports: {} }).exports, t, t.exports), (e = null)),
    t.exports
  ),
  d = (e, t) => {
    let n = {};
    for (var r in e) a(n, r, { get: e[r], enumerable: !0 });
    return (t || a(n, Symbol.toStringTag, { value: `Module` }), n);
  },
  f = (e, t, n, r) => {
    if ((t && typeof t == `object`) || typeof t == `function`)
      for (var i = s(t), c = 0, u = i.length, d; c < u; c++)
        ((d = i[c]),
          !l.call(e, d) &&
            d !== n &&
            a(e, d, {
              get: ((e) => t[e]).bind(null, d),
              enumerable: !(r = o(t, d)) || r.enumerable,
            }));
    return e;
  },
  p = (e, t, n) => (
    (n = e == null ? {} : i(c(e))),
    f(
      t || !e || !e.__esModule || !l.call(e, `default`)
        ? a(n, `default`, { value: e, enumerable: !0 })
        : n,
      e,
    )
  ),
  m = {
    rosterRequireSignatures: !1,
    rosterRequireAdmission: !1,
    rotateVaultSecret: !1,
  },
  h = {
    chromium: `pointer`,
    firefox: `pointer`,
    android: `touch`,
    ios: `touch`,
    desktop: `pointer`,
  },
  g = {
    chromium: `extension`,
    firefox: `extension`,
    android: `mobile`,
    ios: `mobile`,
    desktop: `desktop`,
  };
function _(e) {
  return h[e];
}
var v = {
  popOut: { extension: !0, mobile: !1, desktop: !1 },
  cameraScan: { extension: !1, mobile: !0, desktop: !1 },
  cloudBackup: { extension: !0, mobile: !0, desktop: !0 },
  securityKeys: {
    chromium: !0,
    firefox: !1,
    android: !1,
    ios: !1,
    desktop: !1,
  },
  webauthnUnlock: {
    chromium: !0,
    firefox: !0,
    android: !1,
    ios: !1,
    desktop: !1,
  },
  saveCapture: { chromium: !0, firefox: !0, android: !0, ios: !1, desktop: !1 },
  autofillToggle: {
    chromium: !0,
    firefox: !0,
    android: !1,
    ios: !1,
    desktop: !1,
  },
  webauthnNeedsWindow: {
    chromium: !1,
    firefox: !0,
    android: !1,
    ios: !1,
    desktop: !1,
  },
  passkeyProviderToggle: {
    chromium: !0,
    firefox: !0,
    android: !1,
    ios: !1,
    desktop: !1,
  },
  credentialExchange: {
    chromium: !1,
    firefox: !1,
    android: !1,
    ios: !0,
    desktop: !1,
  },
  filePickerAcceptFilter: { extension: !0, mobile: !1, desktop: !0 },
  filePickerNeedsWindow: { extension: !0, mobile: !1, desktop: !1 },
  addFiles: { chromium: !0, firefox: !1, android: !0, ios: !0, desktop: !0 },
  biometricPasscodeFallback: {
    chromium: !1,
    firefox: !1,
    android: !1,
    ios: !0,
    desktop: !0,
  },
  immediateAutoLock: { extension: !0, mobile: !0, desktop: !1 },
  lockOnScreenLock: {
    chromium: !0,
    firefox: !1,
    android: !1,
    ios: !1,
    desktop: !1,
  },
  perVaultSync: { extension: !0, mobile: !1, desktop: !1 },
};
function y(e, t) {
  let n = v[e];
  return typeof n == `boolean` ? n : `chromium` in n ? n[t] : n[g[t]];
}
function b(e, t, n) {
  let r,
    i = new Promise((e, i) => {
      r = setTimeout(() => i(Error(`${n} timed out`)), t);
    });
  return Promise.race([e, i]).finally(() => clearTimeout(r));
}
async function x(e, r) {
  let i = await e.generateSalt(),
    a = await e.generateSlotId(),
    o = await e.wrapVekPassword({
      password: r,
      saltB64: i,
      slotIdB64: a,
      magicVersion: t(),
    });
  return {
    slotId: n(a),
    salt: n(i),
    verifier: n(o.verifier),
    wrapIv: n(o.wrapIv),
    wrappedVek: n(o.wrappedVek),
  };
}
async function S(e, t) {
  return { kind: 1, ...(await x(e, t)) };
}
async function C(e, t) {
  return { kind: 3, ...(await x(e, t)) };
}
async function w(t, i, a) {
  let { iv: o, ciphertext: s } = await t.encryptWithVek(e(a)),
    c = { slots: i, entriesIv: n(o), entriesCiphertext: n(s) };
  return r(c);
}
export {
  y as a,
  u as c,
  b as i,
  d as l,
  S as n,
  m as o,
  C as r,
  _ as s,
  w as t,
  p as u,
};
