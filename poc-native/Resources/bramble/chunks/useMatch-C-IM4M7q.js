import { c as e, u as t } from "./build-vault-Dl7gFnhh.js";
import { _ as n, h as r } from "./button-DmLv96bj.js";
import { t as i } from "./useRouter-C1oMopOF.js";
function a(e) {
  return e[e.length - 1];
}
function o(e, t) {
  return typeof e == `function` ? e(t) : e;
}
var s = Object.prototype.hasOwnProperty,
  c = Object.prototype.propertyIsEnumerable;
function l(e) {
  for (let t in e) if (s.call(e, t)) return !0;
  return !1;
}
var u = () => Object.create(null),
  d = (e, t) => f(e, t, u);
function f(e, t, n = () => ({}), r = 0) {
  if (e === t) return e;
  if (r > 500) return t;
  let i = t,
    a = g(e) && g(i);
  if (!a && !(m(e) && m(i))) return i;
  let o = a ? e : p(e);
  if (!o) return i;
  let c = a ? i : p(i);
  if (!c) return i;
  let l = o.length,
    u = c.length,
    d = a ? Array(u) : n(),
    h = 0;
  for (let t = 0; t < u; t++) {
    let o = a ? t : c[t],
      u = e[o],
      p = i[o];
    if (u === p) {
      ((d[o] = u), (a ? t < l : s.call(e, o)) && h++);
      continue;
    }
    if (
      u === null ||
      p === null ||
      typeof u != `object` ||
      typeof p != `object`
    ) {
      d[o] = p;
      continue;
    }
    let m = f(u, p, n, r + 1);
    ((d[o] = m), m === u && h++);
  }
  return l === u && h === l ? e : d;
}
function p(e) {
  let t = Object.keys(e);
  if (t.length !== Object.getOwnPropertyNames(e).length) return !1;
  let n = Object.getOwnPropertySymbols(e);
  if (n.length === 0) return t;
  for (let r of n) {
    if (!c.call(e, r)) return !1;
    t.push(r);
  }
  return t;
}
function m(e) {
  if (!h(e)) return !1;
  let t = e.constructor;
  if (t === void 0) return !0;
  let n = t.prototype;
  return !(!h(n) || !n.hasOwnProperty(`isPrototypeOf`));
}
function h(e) {
  return Object.prototype.toString.call(e) === `[object Object]`;
}
function g(e) {
  return Array.isArray(e) && e.length === Object.keys(e).length;
}
function _(e, t, n) {
  if (e === t) return !0;
  if (typeof e != typeof t) return !1;
  if (Array.isArray(e) && Array.isArray(t)) {
    if (e.length !== t.length) return !1;
    for (let r = 0, i = e.length; r < i; r++) if (!_(e[r], t[r], n)) return !1;
    return !0;
  }
  if (m(e) && m(t)) {
    let r = n?.ignoreUndefined ?? !0;
    if (n?.partial) {
      for (let i in t)
        if ((!r || t[i] !== void 0) && !_(e[i], t[i], n)) return !1;
      return !0;
    }
    let i = 0;
    if (!r) i = Object.keys(e).length;
    else for (let t in e) e[t] !== void 0 && i++;
    let a = 0;
    for (let o in t)
      if ((!r || t[o] !== void 0) && (a++, a > i || !_(e[o], t[o], n)))
        return !1;
    return i === a;
  }
  return !1;
}
function v(e) {
  return typeof e?.message == `string`
    ? e.message.startsWith(`Failed to fetch dynamically imported module`) ||
        e.message.startsWith(`error loading dynamically imported module`) ||
        e.message.startsWith(`Importing a module script failed`)
    : !1;
}
var y = /[\x00-\x1f\x7f"<>`{}]/g;
function b(e) {
  return e.replace(
    y,
    (e) => `%` + e.charCodeAt(0).toString(16).toUpperCase().padStart(2, `0`),
  );
}
function x(e) {
  let t;
  try {
    t = decodeURI(e);
  } catch {
    t = e.replaceAll(/%[0-9A-F]{2}/gi, (e) => {
      try {
        return decodeURI(e);
      } catch {
        return e;
      }
    });
  }
  return b(t);
}
var S = [`http:`, `https:`, `mailto:`, `tel:`];
function C(e, t) {
  if (!e) return !1;
  try {
    let n = new URL(e);
    return !t.has(n.protocol);
  } catch {
    return !1;
  }
}
function w(e) {
  if (!e || (!/[%\\\x00-\x1f\x7f]/.test(e) && !e.startsWith(`//`)))
    return { path: e, handledProtocolRelativeURL: !1 };
  let t = /%25|%5C/gi,
    n = 0,
    r = ``,
    i;
  for (; (i = t.exec(e)) !== null;)
    ((r += x(e.slice(n, i.index)) + i[0]), (n = t.lastIndex));
  r += x(n ? e.slice(n) : e);
  let a = !1;
  return (
    r.startsWith(`//`) && ((a = !0), (r = `/` + r.replace(/^\/+/, ``))),
    { path: r, handledProtocolRelativeURL: a }
  );
}
function T(e) {
  return /\s|[^\u0000-\u007F]/.test(e)
    ? e.replace(/\s|[^\u0000-\u007F]/gu, encodeURIComponent)
    : e;
}
function E(e, t) {
  if (e === t) return !0;
  if (e.length !== t.length) return !1;
  for (let n = 0; n < e.length; n++) if (e[n] !== t[n]) return !1;
  return !0;
}
function D() {
  throw Error(`Invariant failed`);
}
var O = t(n(), 1),
  k = O.createContext(void 0),
  A = O.createContext(void 0),
  j = e((e) => {
    var t = n(),
      i = r();
    function a(e, t) {
      return (e === t && (e !== 0 || 1 / e == 1 / t)) || (e !== e && t !== t);
    }
    var o = typeof Object.is == `function` ? Object.is : a,
      s = i.useSyncExternalStore,
      c = t.useRef,
      l = t.useEffect,
      u = t.useMemo,
      d = t.useDebugValue;
    e.useSyncExternalStoreWithSelector = function (e, t, n, r, i) {
      var a = c(null);
      if (a.current === null) {
        var f = { hasValue: !1, value: null };
        a.current = f;
      } else f = a.current;
      a = u(
        function () {
          function e(e) {
            if (!a) {
              if (((a = !0), (s = e), (e = r(e)), i !== void 0 && f.hasValue)) {
                var t = f.value;
                if (i(t, e)) return (c = t);
              }
              return (c = e);
            }
            if (((t = c), o(s, e))) return t;
            var n = r(e);
            return i !== void 0 && i(t, n) ? ((s = e), t) : ((s = e), (c = n));
          }
          var a = !1,
            s,
            c,
            l = n === void 0 ? null : n;
          return [
            function () {
              return e(t());
            },
            l === null
              ? void 0
              : function () {
                  return e(l());
                },
          ];
        },
        [t, n, r, i],
      );
      var p = s(e, a[0], a[1]);
      return (
        l(
          function () {
            ((f.hasValue = !0), (f.value = p));
          },
          [p],
        ),
        d(p),
        p
      );
    };
  }),
  M = e((e, t) => {
    t.exports = j();
  })();
function N(e, t) {
  return e === t;
}
function P(e, t, n = N) {
  let r = (0, O.useCallback)(
      (t) => {
        if (!e) return () => {};
        let { unsubscribe: n } = e.subscribe(t);
        return n;
      },
      [e],
    ),
    i = (0, O.useCallback)(() => e?.get(), [e]);
  return (0, M.useSyncExternalStoreWithSelector)(r, i, i, t, n);
}
var F = {};
function I(e, t) {
  let n = O.useRef();
  return (r) => {
    let i = e?.select ? e.select(r) : r;
    return (e?.structuralSharing ?? t.options.defaultStructuralSharing)
      ? (n.current = f(n.current, i))
      : i;
  };
}
function L(e) {
  let t = i(),
    n = O.useContext(e.from ? A : k),
    r = e.from ?? n,
    a = t.stores.getMatchStore(r),
    o = I(e, t),
    s = P(a, (e) => (e ? o(e) : F));
  if (s !== F) return s;
  (e.shouldThrow ?? !0) && D();
}
export {
  f as _,
  D as a,
  w as c,
  o as d,
  l as f,
  d as g,
  a as h,
  k as i,
  _ as l,
  v as m,
  I as n,
  S as o,
  C as p,
  P as r,
  E as s,
  L as t,
  T as u,
};
