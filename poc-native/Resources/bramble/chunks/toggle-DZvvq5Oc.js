const __vite__mapDeps = (
  i,
  m = __vite__mapDeps,
  d = m.f ||
    (m.f = [
      "chunks/main-Ct9HAmZq.js",
      "chunks/build-vault-Dl7gFnhh.js",
      "chunks/messages-DLCDPx8W.js",
    ]),
) => i.map((i) => d[i]);
import { c as e, u as t } from "./build-vault-Dl7gFnhh.js";
import {
  _ as n,
  c as r,
  g as i,
  l as a,
  r as o,
  t as s,
  u as c,
} from "./button-DmLv96bj.js";
import { o as l } from "./format-date-DY5h_i7e.js";
import { s as u } from "./select-field-BTL4AK3t.js";
import { vt as d } from "./messages-DLCDPx8W.js";
var f = c(`ExternalLink`, [
    [`path`, { d: `M15 3h6v6`, key: `1q9fwt` }],
    [`path`, { d: `M10 14 21 3`, key: `gplh6r` }],
    [
      `path`,
      {
        d: `M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6`,
        key: `a6xqqp`,
      },
    ],
  ]),
  p = c(`X`, [
    [`path`, { d: `M18 6 6 18`, key: `1bl5f8` }],
    [`path`, { d: `m6 6 12 12`, key: `d8bk6v` }],
  ]),
  m = e((e) => {
    var t = n();
    function r(e) {
      var t = `https://react.dev/errors/` + e;
      if (1 < arguments.length) {
        t += `?args[]=` + encodeURIComponent(arguments[1]);
        for (var n = 2; n < arguments.length; n++)
          t += `&args[]=` + encodeURIComponent(arguments[n]);
      }
      return (
        `Minified React error #` +
        e +
        `; visit ` +
        t +
        ` for the full message or use the non-minified dev environment for full errors and additional helpful warnings.`
      );
    }
    function i() {}
    var a = {
        d: {
          f: i,
          r: function () {
            throw Error(r(522));
          },
          D: i,
          C: i,
          L: i,
          m: i,
          X: i,
          S: i,
          M: i,
        },
        p: 0,
        findDOMNode: null,
      },
      o = Symbol.for(`react.portal`);
    function s(e, t, n) {
      var r =
        3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
      return {
        $$typeof: o,
        key: r == null ? null : `` + r,
        children: e,
        containerInfo: t,
        implementation: n,
      };
    }
    var c = t.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    function l(e, t) {
      if (e === `font`) return ``;
      if (typeof t == `string`) return t === `use-credentials` ? t : ``;
    }
    ((e.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = a),
      (e.createPortal = function (e, t) {
        var n =
          2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
        if (!t || (t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11))
          throw Error(r(299));
        return s(e, t, null, n);
      }),
      (e.flushSync = function (e) {
        var t = c.T,
          n = a.p;
        try {
          if (((c.T = null), (a.p = 2), e)) return e();
        } finally {
          ((c.T = t), (a.p = n), a.d.f());
        }
      }),
      (e.preconnect = function (e, t) {
        typeof e == `string` &&
          (t
            ? ((t = t.crossOrigin),
              (t =
                typeof t == `string`
                  ? t === `use-credentials`
                    ? t
                    : ``
                  : void 0))
            : (t = null),
          a.d.C(e, t));
      }),
      (e.prefetchDNS = function (e) {
        typeof e == `string` && a.d.D(e);
      }),
      (e.preinit = function (e, t) {
        if (typeof e == `string` && t && typeof t.as == `string`) {
          var n = t.as,
            r = l(n, t.crossOrigin),
            i = typeof t.integrity == `string` ? t.integrity : void 0,
            o = typeof t.fetchPriority == `string` ? t.fetchPriority : void 0;
          n === `style`
            ? a.d.S(
                e,
                typeof t.precedence == `string` ? t.precedence : void 0,
                { crossOrigin: r, integrity: i, fetchPriority: o },
              )
            : n === `script` &&
              a.d.X(e, {
                crossOrigin: r,
                integrity: i,
                fetchPriority: o,
                nonce: typeof t.nonce == `string` ? t.nonce : void 0,
              });
        }
      }),
      (e.preinitModule = function (e, t) {
        if (typeof e == `string`) {
          if (typeof t == `object` && t) {
            if (t.as == null || t.as === `script`) {
              var n = l(t.as, t.crossOrigin);
              a.d.M(e, {
                crossOrigin: n,
                integrity:
                  typeof t.integrity == `string` ? t.integrity : void 0,
                nonce: typeof t.nonce == `string` ? t.nonce : void 0,
              });
            }
          } else t ?? a.d.M(e);
        }
      }),
      (e.preload = function (e, t) {
        if (
          typeof e == `string` &&
          typeof t == `object` &&
          t &&
          typeof t.as == `string`
        ) {
          var n = t.as,
            r = l(n, t.crossOrigin);
          a.d.L(e, n, {
            crossOrigin: r,
            integrity: typeof t.integrity == `string` ? t.integrity : void 0,
            nonce: typeof t.nonce == `string` ? t.nonce : void 0,
            type: typeof t.type == `string` ? t.type : void 0,
            fetchPriority:
              typeof t.fetchPriority == `string` ? t.fetchPriority : void 0,
            referrerPolicy:
              typeof t.referrerPolicy == `string` ? t.referrerPolicy : void 0,
            imageSrcSet:
              typeof t.imageSrcSet == `string` ? t.imageSrcSet : void 0,
            imageSizes: typeof t.imageSizes == `string` ? t.imageSizes : void 0,
            media: typeof t.media == `string` ? t.media : void 0,
          });
        }
      }),
      (e.preloadModule = function (e, t) {
        if (typeof e == `string`) {
          if (t) {
            var n = l(t.as, t.crossOrigin);
            a.d.m(e, {
              as: typeof t.as == `string` && t.as !== `script` ? t.as : void 0,
              crossOrigin: n,
              integrity: typeof t.integrity == `string` ? t.integrity : void 0,
            });
          } else a.d.m(e);
        }
      }),
      (e.requestFormReset = function (e) {
        a.d.r(e);
      }),
      (e.unstable_batchedUpdates = function (e, t) {
        return e(t);
      }),
      (e.useFormState = function (e, t, n) {
        return c.H.useFormState(e, t, n);
      }),
      (e.useFormStatus = function () {
        return c.H.useHostTransitionStatus();
      }),
      (e.version = `19.2.8`));
  }),
  h = e((e, t) => {
    function n() {
      if (
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ < `u` &&
        typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE == `function`
      )
        try {
          __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
        } catch (e) {
          console.error(e);
        }
    }
    (n(), (t.exports = m()));
  }),
  g = t(n(), 1),
  _ = h(),
  v = i();
function y({
  open: e,
  onClose: t,
  dismissable: n = !0,
  className: r,
  backdropClassName: i = `bg-black/50 backdrop-blur-sm`,
  children: s,
}) {
  let { _: c } = a();
  return (
    (0, g.useEffect)(() => {
      if (!e || !n) return;
      let r = (e) => {
        e.key === `Escape` && t();
      };
      return (
        window.addEventListener(`keydown`, r),
        () => window.removeEventListener(`keydown`, r)
      );
    }, [e, n, t]),
    (0, g.useEffect)(() => {
      if (!e) return;
      let t = document.body.style.overflow;
      return (
        (document.body.style.overflow = `hidden`),
        () => {
          document.body.style.overflow = t;
        }
      );
    }, [e]),
    e
      ? (0, _.createPortal)(
          (0, v.jsxs)(`div`, {
            className: `fixed inset-0 z-50 flex items-center justify-center p-4`,
            children: [
              (0, v.jsx)(`button`, {
                type: `button`,
                "aria-label": c({ id: `yz7wBu` }),
                tabIndex: -1,
                onClick: n ? t : void 0,
                className: o(`absolute inset-0`, i),
              }),
              (0, v.jsx)(`div`, {
                role: `dialog`,
                "aria-modal": `true`,
                className: o(
                  `relative w-full max-w-md rounded-xl border border-border bg-card shadow-xl`,
                  `max-h-[calc(100vh-2rem)] overflow-y-auto`,
                  r,
                ),
                children: s,
              }),
            ],
          }),
          document.body,
        )
      : null
  );
}
var b = (e) => e.type === `checkbox`,
  x = (e) => e.type === `file`,
  S = (e) => e instanceof Date,
  C = (e) => e == null,
  w = (e) => typeof e == `object`,
  T = (e) => !C(e) && !Array.isArray(e) && w(e) && !S(e),
  E = (e) =>
    T(e) && e.target
      ? b(e.target)
        ? e.target.checked
        : x(e.target)
          ? e.target.files
          : e.target.value
      : e,
  ee = (e, t) =>
    t
      .split(`.`)
      .some((t, n, r) => !isNaN(Number(t)) && e.has(r.slice(0, n).join(`.`))),
  D =
    typeof window < `u` &&
    window.HTMLElement !== void 0 &&
    typeof document < `u`;
function O(e) {
  if (typeof e != `object` || !e) return e;
  if (e instanceof Date) return new Date(e);
  let t = typeof FileList < `u` && e instanceof FileList;
  if (D && (e instanceof Blob || t)) return e;
  let n = Array.isArray(e);
  if (!n && e.constructor !== Object) return e;
  let r = n ? [] : Object.create(Object.getPrototypeOf(e));
  for (let t in e)
    Object.prototype.hasOwnProperty.call(e, t) && (r[t] = O(e[t]));
  return r;
}
var k = {
    BLUR: `blur`,
    FOCUS_OUT: `focusout`,
    CHANGE: `change`,
    SUBMIT: `submit`,
    TRIGGER: `trigger`,
    VALID: `valid`,
  },
  A = {
    onBlur: `onBlur`,
    onChange: `onChange`,
    onSubmit: `onSubmit`,
    onTouched: `onTouched`,
    all: `all`,
  },
  j = {
    max: `max`,
    min: `min`,
    maxLength: `maxLength`,
    minLength: `minLength`,
    pattern: `pattern`,
    required: `required`,
    validate: `validate`,
  },
  te = `root`,
  M = [`__proto__`, `constructor`, `prototype`],
  ne = /^\w*$/,
  N = (e) => ne.test(e),
  P = (e) => e === void 0,
  re = /[.[\]'"]/,
  ie = (e) => e.split(re).filter(Boolean),
  F = (e, t, n) => {
    if (!t || !T(e)) return n;
    let r = N(t) ? [t] : ie(t);
    if (r.some((e) => M.includes(e))) return n;
    let i = r.reduce((e, t) => (C(e) ? void 0 : e[t]), e);
    return P(i) || i === e ? (P(e[t]) ? n : e[t]) : i;
  },
  I = (e) => typeof e == `boolean`,
  L = (e) => typeof e == `function`,
  R = (e, t, n) => {
    let r = -1,
      i = N(t) ? [t] : ie(t),
      a = i.length,
      o = a - 1;
    for (; ++r < a;) {
      let t = i[r],
        a = n;
      if (r !== o) {
        let n = e[t];
        a = T(n) || Array.isArray(n) ? n : isNaN(+i[r + 1]) ? {} : [];
      }
      if (M.includes(t)) return;
      ((e[t] = a), (e = e[t]));
    }
  },
  ae = g.createContext(null);
ae.displayName = `HookFormControlContext`;
var oe = () => g.useContext(ae),
  se = (e, t, n, r = !0) => {
    let i = {};
    for (let a in e)
      Object.defineProperty(i, a, {
        get: () => {
          let i = a;
          return (
            t._proxyFormState[i] !== A.all &&
              (t._proxyFormState[i] = !r || A.all),
            n && (n[i] = !0),
            e[i]
          );
        },
      });
    return i;
  },
  ce = D ? g.useLayoutEffect : g.useEffect,
  le = (e) => {
    let t = e.constructor && e.constructor.prototype;
    return T(t) && t.hasOwnProperty(`isPrototypeOf`);
  },
  ue = (e) => C(e) || !w(e),
  de = (e, t) => t.length === 0 && !Array.isArray(e) && !le(e);
function z(e, t, n = new WeakMap()) {
  if (e === t) return !0;
  if (ue(e) || ue(t)) return Object.is(e, t);
  if (S(e) && S(t)) return Object.is(e.getTime(), t.getTime());
  let r = Object.keys(e),
    i = Object.keys(t);
  if (r.length !== i.length) return !1;
  if (de(e, r) || de(t, i)) return Object.is(e, t);
  if (!r.length && Array.isArray(e) !== Array.isArray(t)) return !1;
  let a = n.get(e);
  if (a && a.has(t)) return !0;
  if (a) a.add(t);
  else {
    let r = new WeakSet();
    (r.add(t), n.set(e, r));
  }
  for (let i of r) {
    let r = e[i];
    if (!(i in t)) return !1;
    if (i !== `ref`) {
      let e = t[i];
      if (
        (S(r) && S(e)) ||
        ((T(r) || Array.isArray(r)) && (T(e) || Array.isArray(e)))
          ? !z(r, e, n)
          : !Object.is(r, e)
      )
        return !1;
    }
  }
  return !0;
}
function B() {
  let e = g.useRef(!1),
    t = g.useRef(void 0);
  return {
    resyncIfNeeded: g.useCallback((n, r, i) => {
      if (n && e.current) {
        let e = r();
        z(t.current, e) || i(e);
      }
      e.current = !0;
    }, []),
    snapshot: g.useCallback((e, n) => {
      e && (t.current = O(n()));
    }, []),
  };
}
var V = (e) => typeof e == `string`,
  fe = (e, t, n, r, i) =>
    V(e)
      ? (r && t.watch.add(e), F(n, e, i))
      : Array.isArray(e)
        ? e.map((e) => (r && t.watch.add(e), F(n, e)))
        : (r && (t.watchAll = !0), n),
  H = () =>
    typeof crypto < `u` && crypto.randomUUID
      ? crypto.randomUUID()
      : `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`.replace(/[xy]/g, (e) => {
          let t = (Math.random() * 16) | 0;
          return (e === `x` ? t : (t & 3) | 8).toString(16);
        }),
  pe = (e, t, n = {}) =>
    n.shouldFocus || P(n.shouldFocus)
      ? n.focusName || `${e}.${P(n.focusIndex) ? t : n.focusIndex}.`
      : ``,
  U = (e) => ({
    isOnSubmit: !e || e === A.onSubmit,
    isOnBlur: e === A.onBlur,
    isOnChange: e === A.onChange,
    isOnAll: e === A.all,
    isOnTouch: e === A.onTouched,
  }),
  me = (e, t, n) => {
    if (n) return !1;
    if (t.watchAll || t.watch.has(e)) return !0;
    for (let n of t.watch)
      if (e.startsWith(n) && e.charAt(n.length) === `.`) return !0;
    return !1;
  },
  W = (e, t, n, r) => {
    for (let i of n || Object.keys(e)) {
      if (i === `_f`) continue;
      let a = n ? F(e, i) : e[i];
      if (a) {
        let { _f: e } = a;
        if (e) {
          if (
            (e.refs && e.refs[0] && t(e.refs[0], i) && !r) ||
            (e.ref && t(e.ref, e.name) && !r)
          )
            return !0;
          if (W(a, t)) break;
        } else if ((T(a) || Array.isArray(a)) && W(a, t)) break;
      }
    }
  },
  he = (e, t, n) => {
    let r = F(e, n),
      i = Array.isArray(r) ? r : [];
    return (R(i, te, t[n]), R(e, n, i), e);
  },
  G = (e) => T(e) && !Object.keys(e).length,
  ge = (e) => {
    if (!D) return !1;
    let t = e ? e.ownerDocument : 0;
    return (
      e instanceof
      (t && t.defaultView ? t.defaultView.HTMLElement : HTMLElement)
    );
  },
  K = (e) => e.type === `radio`,
  _e = (e) => e instanceof RegExp,
  q = (e, t, n, r, i) =>
    t
      ? {
          ...n[e],
          types: { ...(n[e] && n[e].types ? n[e].types : {}), [r]: i || !0 },
        }
      : {},
  ve = { value: !1, isValid: !1 },
  ye = { value: !0, isValid: !0 },
  be = (e) => {
    if (!Array.isArray(e)) return ve;
    if (e.length > 1) {
      let t = e
        .filter((e) => e && e.checked && !e.disabled)
        .map((e) => e.value);
      return { value: t, isValid: !!t.length };
    }
    let t = e[0];
    return !t || !t.checked || t.disabled
      ? ve
      : !t.attributes ||
          !(`value` in t.attributes) ||
          P(t.value) ||
          t.value === ``
        ? ye
        : { value: t.value, isValid: !0 };
  },
  xe = { isValid: !1, value: null },
  Se = (e) =>
    Array.isArray(e)
      ? e.reduce(
          (e, t) =>
            t && t.checked && !t.disabled ? { isValid: !0, value: t.value } : e,
          xe,
        )
      : xe;
function J(e, t, n = `validate`) {
  if (V(e) || (Array.isArray(e) && e.every(V)) || (I(e) && !e))
    return { type: n, message: V(e) ? e : ``, ref: t };
}
var Y = (e) => (T(e) && !_e(e) ? e : { value: e, message: `` }),
  Ce = async (e, t, n, r, i, a) => {
    let {
        ref: o,
        refs: s,
        required: c,
        maxLength: l,
        minLength: u,
        min: d,
        max: f,
        pattern: p,
        validate: m,
        name: h,
        valueAsNumber: g,
        mount: _,
      } = e._f,
      v = F(n, h);
    if (!_ || t.has(h)) return {};
    let y = s ? s[0] : o,
      w = (e) => {
        if (i && y.reportValidity) {
          let t = I(e) ? `` : e || ``;
          (s
            ? s.forEach((e) => e.setCustomValidity(t))
            : y.setCustomValidity(t),
            y.reportValidity());
        }
      },
      E = {},
      ee = K(o),
      D = b(o),
      O = ee || D,
      k =
        ((g || x(o)) && P(o.value) && P(v)) ||
        (ge(o) && o.value === ``) ||
        v === `` ||
        (Array.isArray(v) && !v.length),
      A = q.bind(null, h, r, E),
      te = (e, t, n, r = j.maxLength, i = j.minLength) => {
        let a = e ? t : n;
        E[h] = { type: e ? r : i, message: a, ref: o, ...A(e ? r : i, a) };
      };
    if (
      a
        ? !Array.isArray(v) || !v.length
        : c &&
          ((!O && (k || C(v))) ||
            (I(v) && !v) ||
            (D && !be(s).isValid) ||
            (ee && !Se(s).isValid))
    ) {
      let { value: e, message: t } = V(c) ? { value: !!c, message: c } : Y(c);
      if (
        e &&
        ((E[h] = { type: j.required, message: t, ref: y, ...A(j.required, t) }),
        !r)
      )
        return (w(t), E);
    }
    if (!k && (!C(d) || !C(f))) {
      let e,
        t,
        n = Y(f),
        i = Y(d);
      if (!C(v) && !S(v) && !isNaN(v)) {
        let r = o.valueAsNumber || (v && +v);
        (C(n.value) || (e = r > n.value), C(i.value) || (t = r < i.value));
      } else {
        let r = o.valueAsDate || new Date(v),
          a = (e) => new Date(new Date().toDateString() + ` ` + e),
          s = o.type == `time`,
          c = o.type == `week`;
        (V(n.value) &&
          v &&
          (e = s ? a(v) > a(n.value) : c ? v > n.value : r > new Date(n.value)),
          V(i.value) &&
            v &&
            (t = s
              ? a(v) < a(i.value)
              : c
                ? v < i.value
                : r < new Date(i.value)));
      }
      if ((e || t) && (te(!!e, n.message, i.message, j.max, j.min), !r))
        return (w(E[h].message), E);
    }
    if ((l || u) && !k && (V(v) || (a && Array.isArray(v)))) {
      let e = Y(l),
        t = Y(u),
        n = !C(e.value) && v.length > +e.value,
        i = !C(t.value) && v.length < +t.value;
      if ((n || i) && (te(n, e.message, t.message), !r))
        return (w(E[h].message), E);
    }
    if (p && !k && V(v)) {
      let { value: e, message: t } = Y(p);
      if (
        _e(e) &&
        !v.match(e) &&
        ((E[h] = { type: j.pattern, message: t, ref: o, ...A(j.pattern, t) }),
        !r)
      )
        return (w(t), E);
    }
    if (m) {
      if (L(m)) {
        let e = J(await m(v, n), y);
        if (e && ((E[h] = { ...e, ...A(j.validate, e.message) }), !r))
          return (w(e.message), E);
      } else if (T(m)) {
        let e = {};
        for (let t in m) {
          if (!G(e) && !r) break;
          let i = J(await m[t](v, n), y, t);
          i &&
            ((e = { ...i, ...A(t, i.message) }), w(i.message), r && (E[h] = e));
        }
        if (!G(e) && ((E[h] = { ref: y, ...e }), !r)) return E;
      }
    }
    let M = E[h];
    return (w(!M || M.message), E);
  },
  X = (e) => (Array.isArray(e) ? e : [e]),
  we = (e, t) => [...e, ...X(t)],
  Te = (e) => (Array.isArray(e) ? e.map(() => void 0) : void 0);
function Ee(e, t, n) {
  return [...e.slice(0, t), ...X(n), ...e.slice(t)];
}
var De = (e, t, n) =>
    Array.isArray(e)
      ? (P(e[n]) && (e[n] = void 0), e.splice(n, 0, e.splice(t, 1)[0]), e)
      : [],
  Oe = (e, t) => [...X(t), ...X(e)],
  ke = (e) => (Array.isArray(e) ? e.filter(Boolean) : []);
function Ae(e, t) {
  let n = 0,
    r = [...e];
  for (let e of t) (r.splice(e - n, 1), n++);
  return ke(r).length ? r : [];
}
var je = (e, t) =>
    P(t)
      ? []
      : Ae(
          e,
          X(t).sort((e, t) => e - t),
        ),
  Z = (e, t, n) => {
    [e[t], e[n]] = [e[n], e[t]];
  };
function Me(e, t) {
  let n = t.length - 1,
    r = 0;
  for (; r < n;) {
    if (C(e)) {
      e = void 0;
      break;
    }
    ((e = e[t[r]]), r++);
  }
  return e;
}
function Ne(e) {
  for (let t in e) if (e.hasOwnProperty(t) && !P(e[t])) return !1;
  return !0;
}
function Q(e, t) {
  if (V(t) && Object.prototype.hasOwnProperty.call(e, t))
    return (delete e[t], e);
  let n = Array.isArray(t) ? t : N(t) ? [t] : ie(t);
  if (n.some((e) => M.includes(String(e)))) return e;
  let r = n.length === 1 ? e : Me(e, n),
    i = n.length - 1,
    a = n[i];
  return (
    r && delete r[a],
    i !== 0 &&
      ((T(r) && G(r)) || (Array.isArray(r) && Ne(r))) &&
      Q(e, n.slice(0, -1)),
    e
  );
}
var Pe = (e, t, n) => ((e[t] = n), e);
function Fe(e) {
  let t = oe(),
    {
      control: n = t,
      name: r,
      keyName: i = `id`,
      disabled: a,
      shouldUnregister: o,
      rules: s,
    } = e,
    [c, l] = g.useState(n._getFieldArray(r)),
    u = g.useRef(n._getFieldArray(r).map(H)),
    d = g.useRef(!1);
  (a || n._names.array.add(r),
    g.useMemo(
      () => !a && s && c.length >= 0 && n.register(r, s),
      [n, r, c.length, s, a],
    ),
    ce(() => {
      if (!a)
        return n._subjects.array.subscribe({
          next: ({ values: e, name: t }) => {
            if (t === r || !t) {
              let n = F(e, r);
              Array.isArray(n)
                ? (l(n), (u.current = n.map(H)))
                : t || (l([]), (u.current = []));
            }
          },
        }).unsubscribe;
    }, [n, r, a]));
  let f = g.useCallback(
    (e) => {
      ((d.current = !0), n._setFieldArray(r, e));
    },
    [n, r],
  );
  return (
    g.useEffect(() => {
      if (a) {
        n._state.actionArrayLengths.delete(r);
        return;
      }
      ((n._state.action = !1),
        n._state.actionArrayLengths.delete(r),
        me(r, n._names) && n._subjects.state.next({ ...n._formState }));
      let e = U(n._options.mode);
      if (
        d.current &&
        (!e.isOnSubmit || n._formState.isSubmitted) &&
        !U(n._options.reValidateMode).isOnSubmit &&
        !e.isOnBlur
      ) {
        if (n._options.resolver)
          n._runSchema([r]).then((e) => {
            n._updateIsValidating([r]);
            let t = F(e.errors, r),
              i = F(n._formState.errors, r),
              a = i && (i.type || i.root?.type),
              o = i && (i.message || i.root?.message);
            (i
              ? (!t && a) || (t && (a !== t.type || o !== t.message))
              : t && t.type) &&
              (t
                ? T(t) && !Object.keys(t).some((e) => !Number.isNaN(+e))
                  ? he(n._formState.errors, { [r]: t }, r)
                  : R(n._formState.errors, r, t)
                : Q(n._formState.errors, r),
              n._subjects.state.next({ errors: n._formState.errors }));
          });
        else {
          let e = F(n._fields, r);
          e &&
            e._f &&
            Ce(
              e,
              n._names.disabled,
              n._formValues,
              n._options.criteriaMode === A.all,
              n._options.shouldUseNativeValidation,
              !0,
            ).then(
              (e) =>
                !G(e) &&
                n._subjects.state.next({
                  errors: he(n._formState.errors, e, r),
                }),
            );
        }
      }
      (d.current &&
        n._subjects.state.next({ name: r, values: O(n._formValues) }),
        n._names.focus &&
          W(n._fields, (e, t) => {
            if (n._names.focus && t.startsWith(n._names.focus) && e.focus)
              return (e.focus(), 1);
          }),
        (n._names.focus = ``),
        n._setValid(),
        (d.current = !1));
    }, [c, r, n, a]),
    g.useEffect(
      () => (
        a || (!F(n._formValues, r) && n._setFieldArray(r)),
        () => {
          if ((n._state.actionArrayLengths.delete(r), a)) return;
          let e = !(n._options.shouldUnregister || o);
          (d.current &&
            e &&
            n._subjects.state.next({ name: r, values: O(n._formValues) }),
            e
              ? ((e, t) => {
                  let r = F(n._fields, e);
                  r && r._f && (r._f.mount = t);
                })(r, !1)
              : n.unregister(r));
        }
      ),
      [r, n, i, o, a],
    ),
    {
      swap: g.useCallback(
        (e, t) => {
          if (a) return;
          let i = n._getFieldArray(r);
          (Z(i, e, t),
            Z(u.current, e, t),
            f(i),
            l(i),
            n._setFieldArray(r, i, Z, { argA: e, argB: t }, !1));
        },
        [f, r, n, a],
      ),
      move: g.useCallback(
        (e, t) => {
          if (a) return;
          let i = n._getFieldArray(r);
          (De(i, e, t),
            De(u.current, e, t),
            f(i),
            l(i),
            n._setFieldArray(r, i, De, { argA: e, argB: t }, !1));
        },
        [f, r, n, a],
      ),
      prepend: g.useCallback(
        (e, t) => {
          if (a) return;
          let i = X(O(e)),
            o = Oe(n._getFieldArray(r), i);
          ((n._names.focus = pe(r, 0, t)),
            (u.current = Oe(u.current, i.map(H))),
            f(o),
            l(o),
            n._setFieldArray(r, o, Oe, { argA: Te(e) }));
        },
        [f, r, n, a],
      ),
      append: g.useCallback(
        (e, t) => {
          if (a) return;
          let i = X(O(e)),
            o = we(n._getFieldArray(r), i);
          ((n._names.focus = pe(r, o.length - 1, t)),
            (u.current = we(u.current, i.map(H))),
            f(o),
            l(o),
            n._setFieldArray(r, o, we, { argA: Te(e) }));
        },
        [f, r, n, a],
      ),
      remove: g.useCallback(
        (e) => {
          if (a) return;
          let t = je(n._getFieldArray(r), e);
          ((u.current = je(u.current, e)),
            f(t),
            l(t),
            !Array.isArray(F(n._fields, r)) && R(n._fields, r, void 0),
            n._setFieldArray(r, t, je, { argA: e }));
        },
        [f, r, n, a],
      ),
      insert: g.useCallback(
        (e, t, i) => {
          if (a) return;
          let o = X(O(t)),
            s = Ee(n._getFieldArray(r), e, o);
          ((n._names.focus = pe(r, e, i)),
            (u.current = Ee(u.current, e, o.map(H))),
            f(s),
            l(s),
            n._setFieldArray(r, s, Ee, { argA: e, argB: Te(t) }));
        },
        [f, r, n, a],
      ),
      update: g.useCallback(
        (e, t) => {
          if (a) return;
          let i = O(t),
            o = Pe(n._getFieldArray(r), e, i);
          ((u.current = [...o].map((t, n) =>
            !t || n === e ? H() : u.current[n],
          )),
            f(o),
            l([...o]),
            n._setFieldArray(r, o, Pe, { argA: e, argB: Te(t) }));
        },
        [f, r, n, a],
      ),
      replace: g.useCallback(
        (e) => {
          if (a) return;
          let t = X(O(e));
          ((u.current = t.map(H)),
            f([...t]),
            l([...t]),
            n._setFieldArray(r, [...t], (e) => e, {}, !0, !1));
        },
        [f, r, n, a],
      ),
      fields: g.useMemo(
        () =>
          c.map((e, t) => ({
            ...e,
            ...(I(a) ? { disabled: a } : {}),
            [i]: u.current[t] || H(),
          })),
        [c, i, a],
      ),
    }
  );
}
var Ie = g.createContext(null);
Ie.displayName = `HookFormContext`;
var Le = () => g.useContext(Ie),
  Re = ({
    children: e,
    watch: t,
    getValues: n,
    getErrors: r,
    getFieldState: i,
    setError: a,
    clearErrors: o,
    setValue: s,
    setValues: c,
    trigger: l,
    formState: u,
    resetField: d,
    reset: f,
    resetDefaultValues: p,
    handleSubmit: m,
    unregister: h,
    control: _,
    register: v,
    setFocus: y,
    subscribe: b,
  }) => {
    let x = g.useMemo(
      () => ({
        watch: t,
        getValues: n,
        getErrors: r,
        getFieldState: i,
        setError: a,
        clearErrors: o,
        setValue: s,
        setValues: c,
        trigger: l,
        formState: u,
        resetField: d,
        reset: f,
        resetDefaultValues: p,
        handleSubmit: m,
        unregister: h,
        control: _,
        register: v,
        setFocus: y,
        subscribe: b,
      }),
      [o, _, u, r, i, n, m, v, f, p, d, a, y, s, c, b, l, h, t],
    );
    return g.createElement(
      Ie.Provider,
      { value: x },
      g.createElement(ae.Provider, { value: x.control }, e),
    );
  },
  ze = () => {
    let e = [];
    return {
      get observers() {
        return e;
      },
      next: (t) => {
        for (let n of e) n.next && n.next(t);
      },
      subscribe: (t) => (
        e.push(t),
        {
          unsubscribe: () => {
            e = e.filter((e) => e !== t);
          },
        }
      ),
      unsubscribe: () => {
        e = [];
      },
    };
  };
function Be(e, t) {
  let n = {};
  for (let r in e)
    if (e.hasOwnProperty(r)) {
      let i = e[r],
        a = t[r];
      if (i && T(i) && a) {
        let e = Be(i, a);
        T(e) && (n[r] = e);
      } else e[r] && (n[r] = a);
    }
  return n;
}
var Ve = (e, t) =>
    e !== null && w(e) && Object.prototype.hasOwnProperty.call(e, t),
  He = (e, t) => {
    if (!t) return !1;
    let n = e;
    for (let r of N(t) ? [t] : ie(t)) {
      if (!Ve(n, r)) return Ve(e, t);
      n = n[r];
    }
    return !0;
  },
  Ue = (e) => e.type === `select-multiple`,
  We = (e) => K(e) || b(e),
  Ge = (e) => ge(e) && e.isConnected;
function Ke(e) {
  return Array.isArray(e) || T(e);
}
function qe(e, t, n = ``, r = []) {
  for (let i in e) {
    let a = n ? `${n}.${i}` : i,
      o = e[i];
    Ke(o) && Ke(F(t, a)) ? qe(o, t, a, r) : r.push(a);
  }
  return r;
}
var Je = (e) => {
  for (let t in e) if (L(e[t])) return !0;
  return !1;
};
function Ye(e) {
  return Array.isArray(e) || (T(e) && !Je(e));
}
function Xe(e) {
  return !!(e && `_f` in e);
}
function Ze(e) {
  return Array.isArray(e) ? !e.some((e) => !P(e)) : !Object.keys(e).length;
}
function Qe(e, t) {
  Array.isArray(e) ? (e[t] = void 0) : delete e[t];
}
function $e(e, t = {}, n) {
  for (let r in e) {
    let i = e[r],
      a = n && n[r];
    Ye(i) && (!Array.isArray(i) || !Xe(a))
      ? ((t[r] = Array.isArray(i) ? [] : {}),
        $e(i, t[r], a),
        Ze(t[r]) && Qe(t, r))
      : P(i) || (t[r] = !0);
  }
  return t;
}
function $(e, t, n, r) {
  n ||= $e(t, {}, r);
  for (let i in e) {
    let a = e[i],
      o = r && r[i];
    Ye(a) && (!Array.isArray(a) || !Xe(o))
      ? (P(t) || ue(n[i])
          ? (n[i] = $e(a, Array.isArray(a) ? [] : {}, o))
          : $(a, C(t) ? {} : t[i], n[i], o),
        Ze(n[i]) && Qe(n, i))
      : z(a, t[i])
        ? Qe(n, i)
        : (n[i] = !0);
  }
  return n;
}
var et = (e, t) => {
    let n = t.split(`.`),
      r = [],
      i = n[0];
    for (let t = 1; t < n.length; i += `.` + n[t++])
      !isNaN(+n[t]) && e.has(i) && r.push(`${i}.${n[t]}`);
    return r;
  },
  tt = (e, { valueAsNumber: t, valueAsDate: n, setValueAs: r }) =>
    P(e)
      ? e
      : t
        ? e === ``
          ? NaN
          : e && +e
        : n && V(e)
          ? new Date(e)
          : r
            ? r(e)
            : e;
function nt(e) {
  let t = e.ref;
  return x(t)
    ? t.files
    : K(t)
      ? Se(e.refs).value
      : Ue(t)
        ? [...t.selectedOptions].map(({ value: e }) => e)
        : b(t)
          ? be(e.refs).value
          : tt(t.value, e);
}
var rt = (e, t, n, r) => {
    let i = {};
    for (let n of e) {
      let e = F(t, n);
      e && R(i, n, e._f);
    }
    return {
      criteriaMode: n,
      names: [...e],
      fields: i,
      shouldUseNativeValidation: r,
    };
  },
  it = (e) =>
    P(e)
      ? e
      : _e(e)
        ? e.source
        : T(e)
          ? _e(e.value)
            ? e.value.source
            : e.value
          : e,
  at = `AsyncFunction`,
  ot = (e) => {
    if (!e || !e.validate) return !1;
    if (L(e.validate)) return e.validate.constructor.name === at;
    if (T(e.validate)) {
      for (let t in e.validate)
        if (e.validate[t].constructor.name === at) return !0;
    }
    return !1;
  },
  st = (e) =>
    e.mount &&
    (e.required ||
      (!P(e.required) && e.required !== !1) ||
      !P(e.min) ||
      !P(e.max) ||
      !P(e.maxLength) ||
      !P(e.minLength) ||
      e.pattern ||
      e.validate);
function ct(e, t, n) {
  let r = F(e, n);
  if (r || N(n)) return { error: r, name: n };
  let i = n.split(`.`);
  for (; i.length;) {
    let r = i.join(`.`),
      a = F(t, r),
      o = F(e, r);
    if (a && !Array.isArray(a) && n !== r) return { name: n };
    if (o && o.type) return { name: r, error: o };
    if (o && o.root && o.root.type) return { name: `${r}.root`, error: o.root };
    i.pop();
  }
  return { name: n };
}
var lt = (e, t, n, r) => {
    n(e);
    let i = Object.keys(e).filter((e) => e !== `name`);
    return (
      !i.length ||
      (r && i.length >= Object.keys(t).length) ||
      i.find((e) => t[e] === (!r || A.all))
    );
  },
  ut = (e, t, n) =>
    !e ||
    !t ||
    e === t ||
    X(e).some(
      (e) =>
        e &&
        (n
          ? e === t || e.startsWith(t + `.`)
          : e.startsWith(t) || t.startsWith(e)),
    ),
  dt = (e, t, n, r, i) =>
    i.isOnAll
      ? !1
      : !n && i.isOnTouch
        ? !(t || e)
        : (n ? r.isOnBlur : i.isOnBlur)
          ? !e
          : !(n ? r.isOnChange : i.isOnChange) || e,
  ft = (e, t) => {
    let n = F(e, t);
    !ke(n).length && !(n != null && n.root) && Q(e, t);
  },
  pt = { mode: A.onSubmit, reValidateMode: A.onChange, shouldFocusError: !0 },
  mt = `form`,
  ht = (e, t) => {
    for (let n in e) n in t || delete e[n];
    Object.assign(e, t);
  },
  gt = {
    submitCount: 0,
    isDirty: !1,
    isReady: !1,
    isValidating: !1,
    isSubmitted: !1,
    isSubmitting: !1,
    isSubmitSuccessful: !1,
    isValid: !1,
    touchedFields: {},
    dirtyFields: {},
    validatingFields: {},
  };
function _t(e = {}) {
  let t = { ...pt, ...e },
    n = {
      ...O(gt),
      isLoading: L(t.defaultValues),
      errors: t.errors || {},
      disabled: t.disabled || !1,
    },
    r = {},
    i =
      ((T(t.defaultValues) || T(t.values)) && O(t.defaultValues || t.values)) ||
      {},
    a = t.shouldUnregister ? {} : O(i),
    o = {
      action: !1,
      actionArrayLengths: new Map(),
      mount: !1,
      watch: !1,
      keepIsValid: !1,
    },
    s = {
      mount: new Set(),
      disabled: new Set(),
      unMount: new Set(),
      array: new Set(),
      watch: new Set(),
      registerName: new Set(),
    },
    c = {},
    l = {},
    u = 0,
    d = U(t.mode),
    f = U(t.reValidateMode),
    p = {
      isDirty: !1,
      dirtyFields: !1,
      validatingFields: !1,
      touchedFields: !1,
      isValidating: !1,
      isValid: !1,
      errors: !1,
    },
    m = { ...p },
    h = { ...m },
    g = { array: ze(), state: ze() },
    _ = 0,
    v = t.criteriaMode === A.all,
    y = (e, t) => (n) => {
      (clearTimeout(l[e]), (l[e] = setTimeout(t, n)));
    },
    w = async (e) => {
      if (!o.keepIsValid && !t.disabled && (m.isValid || h.isValid || e)) {
        let e = ++_,
          i;
        (t.resolver
          ? ((i = G((await B()).errors)), e === _ && M())
          : (i = await K({
              fields: r,
              onlyCheckValid: !0,
              eventType: k.VALID,
            })),
          e === _ && i !== n.isValid && g.state.next({ isValid: i }));
      }
    },
    M = (e, r) => {
      !t.disabled &&
        (m.isValidating ||
          m.validatingFields ||
          h.isValidating ||
          h.validatingFields) &&
        ((e || s.mount).forEach((e) => {
          e && (r ? R(n.validatingFields, e, r) : Q(n.validatingFields, e));
        }),
        g.state.next({
          validatingFields: n.validatingFields,
          isValidating: !G(n.validatingFields),
        }));
    },
    ne = () => {
      n.dirtyFields = $(i, a, void 0, r);
    },
    re = (e, i = [], s, c, l = !0, u = !0) => {
      if (c && s && !t.disabled) {
        o.action = !0;
        let t = F(r, e);
        if (
          (o.actionArrayLengths.has(e) ||
            o.actionArrayLengths.set(e, Array.isArray(t) ? t.length : 0),
          u && Array.isArray(t))
        ) {
          let n = s(t, c.argA, c.argB);
          l && R(r, e, n);
        }
        let a = F(n.errors, e);
        if (u && Array.isArray(a)) {
          let t = a.root,
            r = s(a, c.argA, c.argB) || a;
          (t && (r.root = t), l && R(n.errors, e, r), ft(n.errors, e));
        }
        let d = F(n.touchedFields, e);
        if ((m.touchedFields || h.touchedFields) && u && Array.isArray(d)) {
          let t = s(d, c.argA, c.argB);
          l && R(n.touchedFields, e, t);
        }
        ((m.dirtyFields || h.dirtyFields) && ne(),
          g.state.next({
            name: e,
            isDirty: q(e, i),
            dirtyFields: n.dirtyFields,
            errors: n.errors,
            isValid: n.isValid,
          }));
      } else R(a, e, i);
    },
    ae = (e, t) => {
      (R(n.errors, e, t),
        (n.errors = { ...n.errors }),
        g.state.next({ errors: n.errors }));
    },
    oe = (e) => {
      ((n.errors = e), g.state.next({ errors: n.errors, isValid: !1 }));
    },
    se = (e) => {
      let t = N(e) ? [e] : ie(e),
        n = a,
        r = i;
      for (let e = 0; e < t.length - 1; e++) {
        let i = t[e];
        if (
          ((n = C(n) ? n : n[i]),
          (r = C(r) ? r : r[i]),
          n === null && r !== null)
        )
          return !0;
      }
      return !1;
    },
    ce = (e) => {
      if (!o.actionArrayLengths.size) return !1;
      let t = N(e) ? [e] : ie(e),
        n = a,
        r = ``,
        i = -1,
        s = 0;
      for (let e = 0; e < t.length; e++) {
        if (C(n)) return !1;
        let a = t[e];
        if (((r = r ? `${r}.${a}` : a), Array.isArray(n) && +a >= n.length))
          return i === -1 ? !1 : e !== i || +a < s;
        (o.actionArrayLengths.has(r) &&
          ((i = e + 1), (s = o.actionArrayLengths.get(r))),
          (n = n[a]));
      }
      return !1;
    },
    le = (t, c, l, u) => {
      let d = F(r, t);
      if (d) {
        if (se(t) || ce(t)) return;
        let r = P(F(a, t)),
          f = F(a, t, P(l) ? F(i, t) : l);
        (P(f) || (u && u.defaultChecked) || c
          ? R(a, t, c ? f : nt(d._f))
          : be(t, f),
          o.mount &&
            !o.action &&
            (w(),
            r &&
              n.isDirty &&
              (m.isDirty || h.isDirty) &&
              (q() || ((n.isDirty = !1), g.state.next({ ...n }))),
            e.shouldUnregister &&
              r &&
              !P(F(a, t)) &&
              me(t, s) &&
              (o.watch = !0)));
      }
    },
    ue = (e, o, s, c, l) => {
      let u = !1,
        d = !1,
        f = { name: e };
      if (!t.disabled || c === !0) {
        if (!s || c) {
          let t = z(F(i, e), o);
          ((m.isDirty || h.isDirty) &&
            ((d = n.isDirty),
            (n.isDirty = f.isDirty = !t || q()),
            (u = d !== f.isDirty)),
            (d = !!F(n.dirtyFields, e)),
            t === n.isDirty
              ? t
                ? Q(n.dirtyFields, e)
                : R(n.dirtyFields, e, !0)
              : ht(n.dirtyFields, $(i, a, void 0, r)),
            (f.dirtyFields = n.dirtyFields),
            (u ||= (m.dirtyFields || h.dirtyFields) && d !== !t));
        }
        if (s) {
          let t = F(n.touchedFields, e);
          t ||
            (R(n.touchedFields, e, s),
            (f.touchedFields = n.touchedFields),
            (u ||= (m.touchedFields || h.touchedFields) && t !== s));
        }
        u && l && g.state.next(f);
      }
      return u ? f : {};
    },
    de = (e, r, i, a) => {
      let o = F(n.errors, e),
        s = (m.isValid || h.isValid) && I(r) && n.isValid !== r;
      if (
        (t.delayError && i
          ? ((c[e] = y(e, () => ae(e, i))), c[e](t.delayError))
          : (clearTimeout(l[e]),
            delete c[e],
            i ? R(n.errors, e, i) : Q(n.errors, e),
            (n.errors = { ...n.errors })),
        (i ? !z(o, i) : o) || !G(a) || s)
      ) {
        let t = {
          ...a,
          ...(s && I(r) ? { isValid: r } : {}),
          errors: n.errors,
          name: e,
        };
        g.state.next(t);
      }
    },
    B = async (e) => (
      M(e, !0),
      await t.resolver(
        a,
        t.context,
        rt(e || s.mount, r, t.criteriaMode, t.shouldUseNativeValidation),
      )
    ),
    H = async (e) => {
      let { errors: t } = await B(e);
      if ((M(e), e)) {
        for (let r of e) {
          let e = F(t, r);
          e
            ? s.array.has(r) &&
              T(e) &&
              !Object.keys(e).some((e) => !Number.isNaN(Number(e)))
              ? he(n.errors, { [r]: e }, r)
              : R(n.errors, r, e)
            : Q(n.errors, r);
        }
        n.errors = { ...n.errors };
      } else n.errors = t;
      return t;
    },
    pe = async ({ name: t, eventType: r }) => {
      if (e.validate) {
        let i = await e.validate({
          formValues: a,
          formState: n,
          name: t,
          eventType: r,
        });
        if (T(i))
          for (let e in i) {
            let t = i[e];
            t &&
              Z(`${mt}.${e}`, {
                message: V(t.message) ? t.message : ``,
                type: t.type || j.validate,
              });
          }
        else
          V(i) || !i ? Z(mt, { message: i || ``, type: j.validate }) : je(mt);
        return i;
      }
      return !0;
    },
    K = async ({
      fields: r,
      onlyCheckValid: i,
      name: o,
      eventType: c,
      context: l = { valid: !0, runRootValidation: !1 },
    }) => {
      if (
        e.validate &&
        ((l.runRootValidation = !0),
        !(await pe({ name: o, eventType: c })) && ((l.valid = !1), i))
      )
        return l.valid;
      for (let o in r) {
        let u = r[o];
        if (u) {
          let { _f: r, ...d } = u;
          if (r) {
            let o = s.array.has(r.name),
              c = u._f && ot(u._f),
              d =
                m.validatingFields ||
                m.isValidating ||
                h.validatingFields ||
                h.isValidating;
            c && d && M([r.name], !0);
            let f = await Ce(
              u,
              s.disabled,
              a,
              v,
              t.shouldUseNativeValidation && !i,
              o,
            );
            if (
              (c && d && M([r.name]),
              (f[r.name] && ((l.valid = !1), i)) ||
                (!i &&
                  (F(f, r.name)
                    ? o
                      ? he(n.errors, f, r.name)
                      : R(n.errors, r.name, f[r.name])
                    : Q(n.errors, r.name)),
                e.shouldUseNativeValidation && f[r.name]))
            )
              break;
          }
          !G(d) &&
            (await K({
              context: l,
              onlyCheckValid: i,
              fields: d,
              name: o,
              eventType: c,
            }));
        }
      }
      return l.valid;
    },
    _e = () => {
      for (let e of s.unMount) {
        let t = F(r, e);
        t &&
          (t._f.refs ? t._f.refs.every((e) => !Ge(e)) : !Ge(t._f.ref)) &&
          Fe(e);
      }
      s.unMount = new Set();
    },
    q = (e, t) => (e && t && R(a, e, t), !z(o.mount ? a : i, i)),
    ve = (e, t, n) =>
      fe(e, s, { ...(o.mount ? a : P(t) || V(e) ? i : t) }, n, t),
    ye = (e) =>
      ke(F(o.mount ? a : i, e, t.shouldUnregister ? F(i, e, []) : [])),
    be = (e, t, n = {}, i = !1, o = !1, s = !1) => {
      let c = F(r, e),
        l = t;
      if (c) {
        let n = c._f;
        n &&
          (!n.disabled && R(a, e, tt(t, n)),
          (l = ge(n.ref) && C(t) ? `` : t),
          Ue(n.ref)
            ? [...n.ref.options].forEach(
                (e) => (e.selected = l.includes(e.value)),
              )
            : n.refs
              ? b(n.ref)
                ? n.refs.forEach((e) => {
                    (e.defaultChecked && e.disabled) ||
                      (e.checked = Array.isArray(l)
                        ? !!l.find((t) => t === e.value)
                        : l === e.value || !!l);
                  })
                : n.refs.forEach((e) => (e.checked = e.value === l))
              : x(n.ref)
                ? (n.ref.value = ``)
                : ((n.ref.value = l),
                  n.ref.type ||
                    o ||
                    s ||
                    g.state.next({ name: e, values: i ? a : O(a) })));
      }
      ((n.shouldDirty || n.shouldTouch) &&
        ue(e, l, n.shouldTouch, n.shouldDirty, !o),
        n.shouldValidate && Ee(e, { delayError: n.delayError }));
    },
    xe = (e, t, n, i = !1, o = !1, c = !1) => {
      s.array.has(e) && g.array.next({ name: e, values: i ? a : O(a) });
      for (let a in t) {
        if (!t.hasOwnProperty(a)) return;
        let l = t[a],
          u = e + `.` + a,
          d = F(r, u);
        (s.array.has(e) || T(l) || (d && !d._f)) && !S(l)
          ? xe(u, l, n, i, o, c)
          : be(u, l, n, i, o, c);
      }
    },
    Se = (e, t, i, c, l = !1) => {
      let u = F(r, e),
        d = s.array.has(e),
        f = c ? t : O(t),
        p = z(F(a, e), f);
      if ((p || R(a, e, f), d))
        (g.array.next({ name: e, values: c ? a : O(a) }),
          (m.isDirty || m.dirtyFields || h.isDirty || h.dirtyFields) &&
            i.shouldDirty &&
            (ne(),
            l ||
              g.state.next({
                name: e,
                dirtyFields: n.dirtyFields,
                isDirty: q(e, f),
              })));
      else {
        let t = (Array.isArray(f) && !f.length) || G(f),
          n = !p && !l;
        !u || u._f || C(f) || t ? be(e, f, i, c, l, n) : xe(e, f, i, c, l, n);
      }
      if (!p && !l) {
        let t = me(e, s),
          r = c ? a : O(a);
        if (
          (g.state.next({
            ...(t && n),
            name: o.mount || t ? e : void 0,
            values: r,
          }),
          !d)
        )
          for (let t of et(s.array, e)) g.state.next({ name: t, values: r });
      }
    },
    J = (e, t, n = {}) => Se(e, t, n, !1),
    Y = (e, t = {}) => {
      let r = L(e) ? e(a) : e;
      if (!z(a, r)) {
        a = { ...a, ...r };
        for (let e of s.mount) He(r, e) && Se(e, F(r, e), t, !0, !0);
        (g.state.next({
          ...n,
          name: void 0,
          type: void 0,
          ...(u ? { values: a } : {}),
        }),
          t.shouldValidate && w());
      }
    },
    we = async (i) => {
      o.mount = !0;
      let l = i.target,
        p = l.name,
        _ = !0,
        y = F(r, p),
        b = (e) => {
          _ =
            Number.isNaN(e) || (S(e) && isNaN(e.getTime())) || z(e, F(a, p, e));
        };
      if (y) {
        let o,
          x,
          S = l.type ? nt(y._f) : E(i),
          C = i.type === k.BLUR || i.type === k.FOCUS_OUT,
          T =
            !st(y._f) &&
            !e.validate &&
            !t.resolver &&
            !F(n.errors, p) &&
            !y._f.deps,
          ee = T || dt(C, F(n.touchedFields, p), n.isSubmitted, f, d),
          D = me(p, s, C);
        if ((R(a, p, S), C)) {
          if (!l || !l.readOnly) {
            y._f.onBlur && y._f.onBlur(i);
            let e = c[p];
            e && e(0);
          }
        } else y._f.onChange && y._f.onChange(i);
        let A = ue(p, S, C),
          j = !G(A) || D;
        if (
          (!C &&
            g.state.next({
              name: p,
              type: i.type,
              ...(u ? { values: O(a) } : {}),
            }),
          ee)
        )
          return (
            (T && n.isValid) ||
              (!m.isValid && !h.isValid) ||
              (t.mode === `onBlur` ? C && w() : C || w()),
            j && g.state.next({ name: p, ...(D ? {} : A) })
          );
        if (
          (!t.resolver &&
            e.validate &&
            (await pe({ name: p, eventType: i.type })),
          !C && D && g.state.next({ ...n }),
          t.resolver)
        ) {
          let { errors: e } = await B([p]);
          if ((M([p]), b(S), !_)) {
            !G(A) && g.state.next(A);
            return;
          }
          let t = ct(n.errors, r, p),
            i = ct(e, r, t.name || p);
          ((o = i.error), (p = i.name), (x = G(e)));
        } else
          (M([p], !0),
            (o = (await Ce(y, s.disabled, a, v, t.shouldUseNativeValidation))[
              p
            ]),
            M([p]),
            b(S),
            _ &&
              (o
                ? (x = !1)
                : (m.isValid || h.isValid) &&
                  (x = await K({
                    fields: r,
                    onlyCheckValid: !0,
                    name: p,
                    eventType: i.type,
                  }))));
        _ &&
          (y._f.deps &&
            (!Array.isArray(y._f.deps) || y._f.deps.length > 0) &&
            Ee(y._f.deps),
          de(p, x, o, A));
      }
    },
    Te = (e, t) => {
      if (F(n.errors, t) && e.focus) return (e.focus(), 1);
    },
    Ee = async (e, i = {}) => {
      let a,
        o,
        u = X(e);
      if (t.resolver) {
        let t = await H(P(e) ? e : u);
        ((a = G(t)), (o = e ? !u.some((e) => F(t, e)) : a));
      } else
        e
          ? ((o = (
              await Promise.all(
                u.map(async (e) => {
                  let t = F(r, e);
                  return await K({
                    fields: t && t._f ? { [e]: t } : t,
                    eventType: k.TRIGGER,
                  });
                }),
              )
            ).every(Boolean)),
            (o || n.isValid) && w())
          : (o = a = await K({ fields: r, name: e, eventType: k.TRIGGER }));
      if (i.delayError && t.delayError && V(e)) {
        let r = F(n.errors, e);
        r
          ? (Q(n.errors, e), (c[e] = y(e, () => ae(e, r))), c[e](t.delayError))
          : (clearTimeout(l[e]), delete c[e]);
      }
      return (
        g.state.next({
          ...(!V(e) || ((m.isValid || h.isValid) && a !== n.isValid)
            ? {}
            : { name: e }),
          ...(t.resolver || !e ? { isValid: a } : {}),
          errors: n.errors,
        }),
        i.shouldFocus && !o && W(r, Te, e ? u : s.mount),
        o
      );
    },
    De = (e, t) => {
      let r = { ...(o.mount ? a : i) };
      return (
        t && (r = Be(t.dirtyFields ? n.dirtyFields : n.touchedFields, r)),
        P(e) ? r : V(e) ? F(r, e) : e.map((e) => F(r, e))
      );
    },
    Oe = (e) =>
      P(e)
        ? { ...n.errors }
        : V(e)
          ? F(n.errors, e)
          : e.map((e) => F(n.errors, e)),
    Ae = (e, t) => {
      let r = t || n,
        i = F(r.errors, e);
      return {
        invalid: !!i,
        isDirty: !!F(r.dirtyFields, e),
        error: i,
        isValidating: !!F(n.validatingFields, e),
        isTouched: !!F(r.touchedFields, e),
      };
    },
    je = (e) => {
      let t = e ? X(e) : void 0;
      (t?.forEach((e) => Q(n.errors, e)),
        t
          ? t.forEach((e) => {
              g.state.next({ name: e, errors: n.errors });
            })
          : ((n.errors = {}), g.state.next({ errors: n.errors })));
    },
    Z = (e, t, i) => {
      let a = (F(r, e, { _f: {} })._f || {}).ref,
        { ref: o, message: s, type: c, ...l } = F(n.errors, e) || {};
      (R(n.errors, e, { ...l, ...t, ref: a }),
        g.state.next({ name: e, errors: n.errors, isValid: !1 }),
        i && i.shouldFocus && a && a.focus && a.focus());
    },
    Me = (e, t) => {
      if (L(e)) {
        u++;
        let { unsubscribe: n } = g.state.subscribe({
            next: (n) => `values` in n && e(n.values || ve(void 0, t), n),
          }),
          r = !1;
        return {
          unsubscribe: () => {
            r || ((r = !0), u--, n());
          },
        };
      }
      return ve(e, t, !0);
    },
    Ne = (e) => {
      let t = !!e.formState?.values;
      t && u++;
      let { unsubscribe: r } = g.state.subscribe({
        next: (t) => {
          if (
            ut(e.name, t.name, e.exact) &&
            lt(t, e.formState || m, Qe, e.reRenderRoot)
          ) {
            let r = { ...a };
            e.callback({ values: r, ...n, ...t, defaultValues: i });
          }
        },
      });
      if (!t) return r;
      let o = !1;
      return () => {
        o || ((o = !0), u--, r());
      };
    },
    Pe = (e) => (
      (o.mount = !0),
      (h = { ...h, ...e.formState }),
      Ne({ ...e, formState: { ...p, ...e.formState } })
    ),
    Fe = (e, o = {}) => {
      for (let c of e ? X(e) : s.mount)
        (s.mount.delete(c),
          s.array.delete(c),
          o.keepValue || (Q(r, c), Q(a, c)),
          !o.keepError && Q(n.errors, c),
          !o.keepDirty && Q(n.dirtyFields, c),
          !o.keepTouched && Q(n.touchedFields, c),
          !o.keepIsValidating && Q(n.validatingFields, c),
          !t.shouldUnregister && !o.keepDefaultValue && Q(i, c));
      (u && g.state.next({ values: O(a) }),
        g.state.next({ ...n, ...(o.keepDirty ? {} : { isDirty: q() }) }),
        !o.keepIsValid && w());
    },
    Ie = ({ disabled: e, name: t }) => {
      if ((I(e) && o.mount) || e || s.disabled.has(t)) {
        let n = s.disabled.has(t) !== !!e;
        (e ? s.disabled.add(t) : s.disabled.delete(t),
          n && o.mount && !o.action && w());
      }
    },
    Le = (e, n = {}) => {
      let a = F(r, e),
        c = I(n.disabled) || I(t.disabled),
        l = !s.registerName.has(e) && a && a._f && !a._f.mount;
      return (
        R(r, e, {
          ...(a || {}),
          _f: {
            ...(a && a._f ? a._f : { ref: { name: e } }),
            name: e,
            mount: !0,
            ...n,
          },
        }),
        s.mount.add(e),
        a && !l
          ? Ie({ disabled: I(n.disabled) ? n.disabled : t.disabled, name: e })
          : le(e, !0, n.value),
        {
          ...(c ? { disabled: n.disabled || t.disabled } : {}),
          ...(t.progressive
            ? {
                required: !!n.required,
                min: it(n.min),
                max: it(n.max),
                minLength: it(n.minLength),
                maxLength: it(n.maxLength),
                pattern: it(n.pattern),
              }
            : {}),
          name: e,
          onChange: we,
          onBlur: we,
          ref: (c) => {
            if (c) {
              (s.registerName.add(e),
                Le(e, n),
                s.registerName.delete(e),
                (a = F(r, e)));
              let t =
                  (P(c.value) &&
                    c.querySelectorAll &&
                    c.querySelectorAll(`input,select,textarea`)[0]) ||
                  c,
                o = We(t),
                l = a._f.refs || [];
              if (o ? l.find((e) => e === t) : t === a._f.ref) return;
              let u = { ...a._f };
              (o
                ? ((u.refs = [
                    ...l.filter(Ge),
                    t,
                    ...(Array.isArray(F(i, e)) ? [{}] : []),
                  ]),
                  (u.ref = { type: t.type, name: e }))
                : ((u.ref = t), delete u.refs),
                R(r, e, { _f: u }),
                le(e, !1, void 0, t));
            } else
              ((a = F(r, e, {})),
                a._f && (a._f.mount = !1),
                (t.shouldUnregister || n.shouldUnregister) &&
                  !(ee(s.array, e) && o.action) &&
                  s.unMount.add(e));
          },
        }
      );
    },
    Re = () =>
      t.shouldFocusError && !t.shouldUseNativeValidation && W(r, Te, s.mount),
    Ve = (e) => {
      I(e) &&
        (g.state.next({ disabled: e }),
        W(
          r,
          (t, n) => {
            let i = F(r, n);
            i &&
              ((t.disabled = i._f.disabled || e),
              Array.isArray(i._f.refs) &&
                i._f.refs.forEach((t) => {
                  t.disabled = i._f.disabled || e;
                }));
          },
          0,
          !1,
        ));
    },
    Ke = (e, i) => async (o) => {
      let c, l;
      o && (o.preventDefault && o.preventDefault(), o.persist && o.persist());
      let u = O(a);
      if ((g.state.next({ isSubmitting: !0 }), t.resolver)) {
        let { errors: e, values: t } = await B();
        (M(), (n.errors = e), (u = O(t)));
      } else await K({ fields: r, eventType: k.SUBMIT });
      if (s.disabled.size) for (let e of s.disabled) Q(u, e);
      if ((Q(n.errors, te), G(n.errors))) {
        g.state.next({ errors: {} });
        try {
          c = await e(u, o);
        } catch (e) {
          l = e;
        }
      } else (i && (await i({ ...n.errors }, o)), Re(), setTimeout(Re));
      if (
        (g.state.next({
          isSubmitted: !0,
          isSubmitting: !1,
          isSubmitSuccessful: G(n.errors) && !l,
          submitCount: n.submitCount + 1,
          errors: n.errors,
        }),
        l)
      )
        throw l;
      return c;
    },
    Je = (e, t = {}) => {
      F(r, e) &&
        (P(t.defaultValue)
          ? J(e, O(F(i, e)))
          : (J(e, t.defaultValue), R(i, e, O(t.defaultValue))),
        t.keepTouched || Q(n.touchedFields, e),
        t.keepDirty ||
          (Q(n.dirtyFields, e),
          (n.isDirty = t.defaultValue ? q(e, O(F(i, e))) : q())),
        t.keepError || (Q(n.errors, e), m.isValid && w()),
        g.state.next({ ...n }));
    },
    Ye = (e, c = {}) => {
      let l = e ? O(e) : i,
        u = O(l),
        d = G(e),
        f = u,
        p = r;
      if ((c.keepDefaultValues || (i = l), !c.keepValues)) {
        if (c.keepDirtyValues) {
          let e = new Set([
            ...s.mount,
            ...qe($(i, a, void 0, p), n.dirtyFields),
          ]);
          for (let t of e) {
            let e = F(n.dirtyFields, t),
              r = F(a, t),
              i = F(f, t);
            e && !P(r) ? R(f, t, r) : !e && !P(i) && J(t, i);
          }
        } else {
          if (D && P(e))
            for (let e of s.mount) {
              let t = F(r, e);
              if (t && t._f) {
                let e = Array.isArray(t._f.refs) ? t._f.refs[0] : t._f.ref;
                if (ge(e)) {
                  let t = e.closest(`form`);
                  if (t) {
                    t.reset();
                    break;
                  }
                }
              }
            }
          if (c.keepFieldsRef) for (let e of s.mount) J(e, F(f, e));
          else r = {};
        }
        if (t.shouldUnregister) {
          if (((a = c.keepDefaultValues ? O(i) : {}), c.keepFieldsRef))
            for (let e of s.mount) R(a, e, F(f, e));
        } else a = O(f);
        (g.array.next({ values: { ...f } }),
          g.state.next({ name: void 0, type: void 0, values: { ...f } }));
      }
      ((s = {
        mount: c.keepDirtyValues ? s.mount : new Set(),
        unMount: new Set(),
        array: new Set(),
        registerName: new Set(),
        disabled: new Set(),
        watch: new Set(),
        watchAll: !1,
        focus: ``,
      }),
        (o.mount =
          !m.isValid ||
          !!c.keepIsValid ||
          !!c.keepDirtyValues ||
          (!t.shouldUnregister && !G(f))),
        (o.watch = !!t.shouldUnregister),
        (o.keepIsValid = !!c.keepIsValid),
        (o.action = !1),
        o.actionArrayLengths.clear(),
        c.keepErrors || (n.errors = {}),
        g.state.next({
          submitCount: c.keepSubmitCount ? n.submitCount : 0,
          isDirty: d
            ? !1
            : c.keepDirty
              ? n.isDirty
              : c.keepValues
                ? q()
                : !(!c.keepDefaultValues || z(e, i)),
          isSubmitted: c.keepIsSubmitted ? n.isSubmitted : !1,
          dirtyFields: d
            ? {}
            : c.keepDirtyValues
              ? c.keepDefaultValues && a
                ? $(i, a, void 0, p)
                : n.dirtyFields
              : c.keepDefaultValues && e
                ? $(i, e, void 0, p)
                : c.keepDirty
                  ? n.dirtyFields
                  : {},
          touchedFields: c.keepTouched ? n.touchedFields : {},
          errors: c.keepErrors ? n.errors : {},
          isSubmitSuccessful: c.keepIsSubmitSuccessful
            ? n.isSubmitSuccessful
            : !1,
          isSubmitting: !1,
          defaultValues: i,
        }));
    },
    Xe = (e, n) => Ye(L(e) ? e(a) : e, { ...t.resetOptions, ...n }),
    Ze = (e, t = {}) => {
      let n = F(r, e),
        i = n && n._f;
      if (i) {
        let e = i.refs ? i.refs[0] : i.ref;
        e.focus &&
          setTimeout(() => {
            (e.focus(), t.shouldSelect && L(e.select) && e.select());
          });
      }
    },
    Qe = (e) => {
      let { name: t, type: r, values: i, ...a } = e;
      n = { ...n, ...a };
    };
  g.state.subscribe({ next: Qe });
  let $e = {
    control: {
      register: Le,
      unregister: Fe,
      getFieldState: Ae,
      handleSubmit: Ke,
      setError: Z,
      _subscribe: Ne,
      _runSchema: B,
      _updateIsValidating: M,
      _focusError: Re,
      _getWatch: ve,
      _getDirty: q,
      _setValid: w,
      _setFieldArray: re,
      _setDisabledField: Ie,
      _setErrors: oe,
      _getFieldArray: ye,
      _reset: Ye,
      _resetDefaultValues: () =>
        L(t.defaultValues) &&
        t.defaultValues().then((e) => {
          (Xe(e, t.resetOptions), g.state.next({ isLoading: !1 }));
        }),
      _removeUnmounted: _e,
      _disableForm: Ve,
      _subjects: g,
      _proxyFormState: m,
      get _fields() {
        return r;
      },
      get _formValues() {
        return a;
      },
      get _state() {
        return o;
      },
      set _state(e) {
        o = e;
      },
      get _defaultValues() {
        return i;
      },
      get _names() {
        return s;
      },
      set _names(e) {
        s = e;
      },
      get _formState() {
        return n;
      },
      get _options() {
        return t;
      },
      set _options(e) {
        ((t = { ...t, ...e }), (d = U(t.mode)), (f = U(t.reValidateMode)));
      },
    },
    subscribe: Pe,
    trigger: Ee,
    register: Le,
    handleSubmit: Ke,
    watch: Me,
    setValue: J,
    setValues: Y,
    getValues: De,
    getErrors: Oe,
    reset: Xe,
    resetField: Je,
    resetDefaultValues: (e, t = {}) => {
      if (((i = O(e)), !t.keepDirty)) {
        let e = $(i, a, void 0, r);
        ((n.dirtyFields = e), (n.isDirty = !G(e)));
      }
      (t.keepIsValid || w(), g.state.next({ ...n, defaultValues: i }));
    },
    clearErrors: je,
    unregister: Fe,
    setError: Z,
    setFocus: Ze,
    getFieldState: Ae,
  };
  return { ...$e, formControl: $e };
}
function vt(e = {}) {
  let t = g.useRef(void 0),
    n = g.useRef(void 0),
    r = g.useRef(e.formControl),
    [i, a] = g.useState(() => ({
      ...O(gt),
      isLoading: L(e.defaultValues),
      errors: e.errors || {},
      disabled: e.disabled || !1,
      defaultValues: L(e.defaultValues) ? void 0 : e.defaultValues,
    }));
  if (!t.current || (e.formControl && r.current !== e.formControl)) {
    if (((r.current = e.formControl), e.formControl))
      ((t.current = { ...e.formControl, formState: i }),
        e.defaultValues &&
          !L(e.defaultValues) &&
          e.formControl.reset(e.defaultValues, e.resetOptions));
    else {
      let { formControl: n, ...r } = _t(e);
      t.current = { ...r, formState: i };
    }
  }
  let o = t.current.control;
  o._options = e;
  let { resyncIfNeeded: s, snapshot: c } = B();
  return (
    ce(() => {
      let e = () => ({ ...o._formState, defaultValues: o._defaultValues });
      s(!0, e, a);
      let t = o._subscribe({
        formState: o._proxyFormState,
        callback: () => a({ ...o._formState, defaultValues: o._defaultValues }),
        reRenderRoot: !0,
      });
      return (
        a((e) => ({ ...e, isReady: !0 })),
        (o._formState.isReady = !0),
        () => {
          (t(), c(!0, e));
        }
      );
    }, [o, s, c]),
    g.useEffect(() => o._disableForm(e.disabled), [o, e.disabled]),
    g.useEffect(() => {
      (e.mode && (o._options.mode = e.mode),
        e.reValidateMode && (o._options.reValidateMode = e.reValidateMode));
    }, [o, e.mode, e.reValidateMode]),
    g.useEffect(() => {
      e.errors && (o._setErrors(e.errors), o._focusError());
    }, [o, e.errors]),
    g.useEffect(() => {
      e.shouldUnregister && o._subjects.state.next({ values: o._getWatch() });
    }, [o, e.shouldUnregister]),
    g.useEffect(() => {
      if (o._proxyFormState.isDirty) {
        let e = o._getDirty();
        e !== i.isDirty && o._subjects.state.next({ isDirty: e });
      }
    }, [o, i.isDirty]),
    g.useEffect(() => {
      e.values && !z(e.values, n.current)
        ? (o._reset(e.values, {
            keepFieldsRef: !0,
            ...o._options.resetOptions,
          }),
          o._options.resetOptions?.keepIsValid || o._setValid(),
          (n.current = e.values),
          a((e) => ({ ...e })))
        : o._resetDefaultValues();
    }, [o, e.values]),
    g.useEffect(() => {
      (o._state.mount || (o._setValid(), (o._state.mount = !0)),
        o._state.watch &&
          ((o._state.watch = !1), o._subjects.state.next({ ...o._formState })),
        o._removeUnmounted());
    }),
    (t.current.formState = g.useMemo(() => se(i, o), [o, i])),
    t.current
  );
}
function yt({ children: e, open: t, onOpenChange: n, className: i }) {
  let [a, c] = (0, g.useState)(!1),
    d = t ?? a;
  return (0, v.jsxs)(`div`, {
    children: [
      (0, v.jsxs)(s, {
        variant: `link`,
        size: `none`,
        onClick: () => {
          let e = !d;
          (t === void 0 && c(e), n?.(e));
        },
        className: `gap-1.5 text-xs active:scale-[0.98]`,
        "aria-expanded": d,
        children: [
          d
            ? (0, v.jsx)(u, { className: `w-3.5 h-3.5` })
            : (0, v.jsx)(l, { className: `w-3.5 h-3.5` }),
          (0, v.jsx)(r, { id: `sxkWRg` }),
        ],
      }),
      d &&
        (0, v.jsx)(`div`, {
          className: o(`mt-3 space-y-4 pl-4 border-l border-border/40`, i),
          children: e,
        }),
    ],
  });
}
var bt = 8,
  xt = 100,
  St;
function Ct() {
  return (
    (St ??= d(
      () =>
        import(`./main-Ct9HAmZq.js`)
          .then((e) => t(e.default, 1))
          .then((e) => e.default),
      __vite__mapDeps([0, 1, 2]),
    )),
    St
  );
}
function wt() {
  Ct();
}
async function Tt(e) {
  return (await Ct())(e.slice(0, xt)).score;
}
function Et(e) {
  if (e && e.length < bt) return `Use at least ${bt} characters.`;
}
function Dt(e, t) {
  if (e && !Et(e) && !(t === null || t >= 3))
    return `This password is weak. Anyone who gets your vault file could crack it offline.`;
}
function Ot(e) {
  let [t, n] = (0, g.useState)(null);
  return (
    (0, g.useEffect)(wt, []),
    (0, g.useEffect)(() => {
      if (!e) {
        n(null);
        return;
      }
      let t = !0;
      return (
        Tt(e).then((e) => {
          t && n(e);
        }),
        () => {
          t = !1;
        }
      );
    }, [e]),
    t
  );
}
function kt(e) {
  return Dt(e, Ot(e));
}
function At({ value: e, label: t, breached: n, className: r = `mt-2` }) {
  let { _: i } = a(),
    o = Ot(e);
  if (!e || o === null) return null;
  let s = n || o < 2 ? `destructive` : o < 3 ? `warn` : `ok`,
    c =
      s === `ok`
        ? `bg-primary`
        : s === `warn`
          ? `bg-yellow-500`
          : `bg-destructive`,
    l =
      s === `ok`
        ? `text-primary`
        : s === `warn`
          ? `text-warning`
          : `text-destructive`,
    u = [
      i({ id: `QhjuCF` }),
      i({ id: `9ls_Vs` }),
      i({ id: `F7dRcr` }),
      i({ id: `LLx_nr` }),
      i({ id: `Jb_cTp` }),
    ][o];
  return (0, v.jsxs)(`div`, {
    className: r,
    children: [
      (0, v.jsxs)(`div`, {
        className: `flex items-center justify-between mb-1.5`,
        children: [
          (0, v.jsx)(`span`, {
            className: `text-xs text-muted-foreground`,
            children: t ?? i({ id: `JR0j-9` }),
          }),
          (0, v.jsx)(`span`, {
            className: `text-xs ${l}`,
            children: n ? i({ id: `n1xtfG` }) : u,
          }),
        ],
      }),
      (0, v.jsx)(`div`, {
        className: `h-1.5 bg-muted rounded-full overflow-hidden`,
        children: (0, v.jsx)(`div`, {
          className: `h-full transition-all duration-300 ${c}`,
          style: { width: n ? `5%` : `${((o + 1) / 5) * 100}%` },
        }),
      }),
    ],
  });
}
function jt({ checked: e, onChange: t, label: n, disabled: r = !1 }) {
  return (0, v.jsx)(`button`, {
    type: `button`,
    onClick: () => t(!e),
    disabled: r,
    "aria-label": n,
    "aria-pressed": e,
    className: o(
      `relative shrink-0 w-11 h-6 rounded-full border transition-all disabled:opacity-40 disabled:cursor-not-allowed`,
      e ? `bg-primary border-primary/20` : `bg-muted border-input-border`,
    ),
    children: (0, v.jsx)(`span`, {
      className: o(
        `absolute top-1/2 -translate-y-1/2 size-4.5 rounded-full bg-card shadow-sm transition-all`,
        e
          ? `left-5.5 dark:bg-primary-foreground`
          : `left-0.5 dark:bg-card-foreground`,
      ),
    }),
  });
}
export {
  yt as a,
  vt as c,
  h as d,
  p as f,
  Et as i,
  Le as l,
  At as n,
  Re as o,
  f as p,
  kt as r,
  Fe as s,
  jt as t,
  y as u,
};
