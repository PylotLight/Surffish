import { a as e, c as t, s as n, u as r } from "./build-vault-Dl7gFnhh.js";
import {
  G as i,
  J as a,
  K as o,
  Q as s,
  U as c,
  W as l,
  X as u,
  Y as d,
  Z as f,
} from "./storage-nmIf6WgJ.js";
var p = t((e) => {
    var t = Symbol.for(`react.transitional.element`),
      n = Symbol.for(`react.portal`),
      r = Symbol.for(`react.fragment`),
      i = Symbol.for(`react.strict_mode`),
      a = Symbol.for(`react.profiler`),
      o = Symbol.for(`react.consumer`),
      s = Symbol.for(`react.context`),
      c = Symbol.for(`react.forward_ref`),
      l = Symbol.for(`react.suspense`),
      u = Symbol.for(`react.memo`),
      d = Symbol.for(`react.lazy`),
      f = Symbol.for(`react.activity`),
      p = Symbol.iterator;
    function m(e) {
      return typeof e != `object` || !e
        ? null
        : ((e = (p && e[p]) || e[`@@iterator`]),
          typeof e == `function` ? e : null);
    }
    var h = {
        isMounted: function () {
          return !1;
        },
        enqueueForceUpdate: function () {},
        enqueueReplaceState: function () {},
        enqueueSetState: function () {},
      },
      g = Object.assign,
      _ = {};
    function v(e, t, n) {
      ((this.props = e),
        (this.context = t),
        (this.refs = _),
        (this.updater = n || h));
    }
    ((v.prototype.isReactComponent = {}),
      (v.prototype.setState = function (e, t) {
        if (typeof e != `object` && typeof e != `function` && e != null)
          throw Error(
            `takes an object of state variables to update or a function which returns an object of state variables.`,
          );
        this.updater.enqueueSetState(this, e, t, `setState`);
      }),
      (v.prototype.forceUpdate = function (e) {
        this.updater.enqueueForceUpdate(this, e, `forceUpdate`);
      }));
    function y() {}
    y.prototype = v.prototype;
    function b(e, t, n) {
      ((this.props = e),
        (this.context = t),
        (this.refs = _),
        (this.updater = n || h));
    }
    var x = (b.prototype = new y());
    ((x.constructor = b), g(x, v.prototype), (x.isPureReactComponent = !0));
    var S = Array.isArray;
    function C() {}
    var w = { H: null, A: null, T: null, S: null },
      T = Object.prototype.hasOwnProperty;
    function E(e, n, r) {
      var i = r.ref;
      return {
        $$typeof: t,
        type: e,
        key: n,
        ref: i === void 0 ? null : i,
        props: r,
      };
    }
    function D(e, t) {
      return E(e.type, t, e.props);
    }
    function O(e) {
      return typeof e == `object` && !!e && e.$$typeof === t;
    }
    function k(e) {
      var t = { "=": `=0`, ":": `=2` };
      return (
        `$` +
        e.replace(/[=:]/g, function (e) {
          return t[e];
        })
      );
    }
    var A = /\/+/g;
    function j(e, t) {
      return typeof e == `object` && e && e.key != null
        ? k(`` + e.key)
        : t.toString(36);
    }
    function M(e) {
      switch (e.status) {
        case `fulfilled`:
          return e.value;
        case `rejected`:
          throw e.reason;
        default:
          switch (
            (typeof e.status == `string`
              ? e.then(C, C)
              : ((e.status = `pending`),
                e.then(
                  function (t) {
                    e.status === `pending` &&
                      ((e.status = `fulfilled`), (e.value = t));
                  },
                  function (t) {
                    e.status === `pending` &&
                      ((e.status = `rejected`), (e.reason = t));
                  },
                )),
            e.status)
          ) {
            case `fulfilled`:
              return e.value;
            case `rejected`:
              throw e.reason;
          }
      }
      throw e;
    }
    function N(e, r, i, a, o) {
      var s = typeof e;
      (s === `undefined` || s === `boolean`) && (e = null);
      var c = !1;
      if (e === null) c = !0;
      else
        switch (s) {
          case `bigint`:
          case `string`:
          case `number`:
            c = !0;
            break;
          case `object`:
            switch (e.$$typeof) {
              case t:
              case n:
                c = !0;
                break;
              case d:
                return ((c = e._init), N(c(e._payload), r, i, a, o));
            }
        }
      if (c)
        return (
          (o = o(e)),
          (c = a === `` ? `.` + j(e, 0) : a),
          S(o)
            ? ((i = ``),
              c != null && (i = c.replace(A, `$&/`) + `/`),
              N(o, r, i, ``, function (e) {
                return e;
              }))
            : o != null &&
              (O(o) &&
                (o = D(
                  o,
                  i +
                    (o.key == null || (e && e.key === o.key)
                      ? ``
                      : (`` + o.key).replace(A, `$&/`) + `/`) +
                    c,
                )),
              r.push(o)),
          1
        );
      c = 0;
      var l = a === `` ? `.` : a + `:`;
      if (S(e))
        for (var u = 0; u < e.length; u++)
          ((a = e[u]), (s = l + j(a, u)), (c += N(a, r, i, s, o)));
      else if (((u = m(e)), typeof u == `function`))
        for (e = u.call(e), u = 0; !(a = e.next()).done;)
          ((a = a.value), (s = l + j(a, u++)), (c += N(a, r, i, s, o)));
      else if (s === `object`) {
        if (typeof e.then == `function`) return N(M(e), r, i, a, o);
        throw (
          (r = String(e)),
          Error(
            `Objects are not valid as a React child (found: ` +
              (r === `[object Object]`
                ? `object with keys {` + Object.keys(e).join(`, `) + `}`
                : r) +
              `). If you meant to render a collection of children, use an array instead.`,
          )
        );
      }
      return c;
    }
    function P(e, t, n) {
      if (e == null) return e;
      var r = [],
        i = 0;
      return (
        N(e, r, ``, ``, function (e) {
          return t.call(n, e, i++);
        }),
        r
      );
    }
    function F(e) {
      if (e._status === -1) {
        var t = e._result;
        ((t = t()),
          t.then(
            function (t) {
              (e._status === 0 || e._status === -1) &&
                ((e._status = 1), (e._result = t));
            },
            function (t) {
              (e._status === 0 || e._status === -1) &&
                ((e._status = 2), (e._result = t));
            },
          ),
          e._status === -1 && ((e._status = 0), (e._result = t)));
      }
      if (e._status === 1) return e._result.default;
      throw e._result;
    }
    var I =
        typeof reportError == `function`
          ? reportError
          : function (e) {
              if (
                typeof window == `object` &&
                typeof window.ErrorEvent == `function`
              ) {
                var t = new window.ErrorEvent(`error`, {
                  bubbles: !0,
                  cancelable: !0,
                  message:
                    typeof e == `object` && e && typeof e.message == `string`
                      ? String(e.message)
                      : String(e),
                  error: e,
                });
                if (!window.dispatchEvent(t)) return;
              } else if (
                typeof process == `object` &&
                typeof process.emit == `function`
              ) {
                process.emit(`uncaughtException`, e);
                return;
              }
              console.error(e);
            },
      L = {
        map: P,
        forEach: function (e, t, n) {
          P(
            e,
            function () {
              t.apply(this, arguments);
            },
            n,
          );
        },
        count: function (e) {
          var t = 0;
          return (
            P(e, function () {
              t++;
            }),
            t
          );
        },
        toArray: function (e) {
          return (
            P(e, function (e) {
              return e;
            }) || []
          );
        },
        only: function (e) {
          if (!O(e))
            throw Error(
              `React.Children.only expected to receive a single React element child.`,
            );
          return e;
        },
      };
    ((e.Activity = f),
      (e.Children = L),
      (e.Component = v),
      (e.Fragment = r),
      (e.Profiler = a),
      (e.PureComponent = b),
      (e.StrictMode = i),
      (e.Suspense = l),
      (e.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = w),
      (e.__COMPILER_RUNTIME = {
        __proto__: null,
        c: function (e) {
          return w.H.useMemoCache(e);
        },
      }),
      (e.cache = function (e) {
        return function () {
          return e.apply(null, arguments);
        };
      }),
      (e.cacheSignal = function () {
        return null;
      }),
      (e.cloneElement = function (e, t, n) {
        if (e == null)
          throw Error(
            `The argument must be a React element, but you passed ` + e + `.`,
          );
        var r = g({}, e.props),
          i = e.key;
        if (t != null)
          for (a in (t.key !== void 0 && (i = `` + t.key), t))
            !T.call(t, a) ||
              a === `key` ||
              a === `__self` ||
              a === `__source` ||
              (a === `ref` && t.ref === void 0) ||
              (r[a] = t[a]);
        var a = arguments.length - 2;
        if (a === 1) r.children = n;
        else if (1 < a) {
          for (var o = Array(a), s = 0; s < a; s++) o[s] = arguments[s + 2];
          r.children = o;
        }
        return E(e.type, i, r);
      }),
      (e.createContext = function (e) {
        return (
          (e = {
            $$typeof: s,
            _currentValue: e,
            _currentValue2: e,
            _threadCount: 0,
            Provider: null,
            Consumer: null,
          }),
          (e.Provider = e),
          (e.Consumer = { $$typeof: o, _context: e }),
          e
        );
      }),
      (e.createElement = function (e, t, n) {
        var r,
          i = {},
          a = null;
        if (t != null)
          for (r in (t.key !== void 0 && (a = `` + t.key), t))
            T.call(t, r) &&
              r !== `key` &&
              r !== `__self` &&
              r !== `__source` &&
              (i[r] = t[r]);
        var o = arguments.length - 2;
        if (o === 1) i.children = n;
        else if (1 < o) {
          for (var s = Array(o), c = 0; c < o; c++) s[c] = arguments[c + 2];
          i.children = s;
        }
        if (e && e.defaultProps)
          for (r in ((o = e.defaultProps), o)) i[r] === void 0 && (i[r] = o[r]);
        return E(e, a, i);
      }),
      (e.createRef = function () {
        return { current: null };
      }),
      (e.forwardRef = function (e) {
        return { $$typeof: c, render: e };
      }),
      (e.isValidElement = O),
      (e.lazy = function (e) {
        return { $$typeof: d, _payload: { _status: -1, _result: e }, _init: F };
      }),
      (e.memo = function (e, t) {
        return { $$typeof: u, type: e, compare: t === void 0 ? null : t };
      }),
      (e.startTransition = function (e) {
        var t = w.T,
          n = {};
        w.T = n;
        try {
          var r = e(),
            i = w.S;
          (i !== null && i(n, r),
            typeof r == `object` &&
              r &&
              typeof r.then == `function` &&
              r.then(C, I));
        } catch (e) {
          I(e);
        } finally {
          (t !== null && n.types !== null && (t.types = n.types), (w.T = t));
        }
      }),
      (e.unstable_useCacheRefresh = function () {
        return w.H.useCacheRefresh();
      }),
      (e.use = function (e) {
        return w.H.use(e);
      }),
      (e.useActionState = function (e, t, n) {
        return w.H.useActionState(e, t, n);
      }),
      (e.useCallback = function (e, t) {
        return w.H.useCallback(e, t);
      }),
      (e.useContext = function (e) {
        return w.H.useContext(e);
      }),
      (e.useDebugValue = function () {}),
      (e.useDeferredValue = function (e, t) {
        return w.H.useDeferredValue(e, t);
      }),
      (e.useEffect = function (e, t) {
        return w.H.useEffect(e, t);
      }),
      (e.useEffectEvent = function (e) {
        return w.H.useEffectEvent(e);
      }),
      (e.useId = function () {
        return w.H.useId();
      }),
      (e.useImperativeHandle = function (e, t, n) {
        return w.H.useImperativeHandle(e, t, n);
      }),
      (e.useInsertionEffect = function (e, t) {
        return w.H.useInsertionEffect(e, t);
      }),
      (e.useLayoutEffect = function (e, t) {
        return w.H.useLayoutEffect(e, t);
      }),
      (e.useMemo = function (e, t) {
        return w.H.useMemo(e, t);
      }),
      (e.useOptimistic = function (e, t) {
        return w.H.useOptimistic(e, t);
      }),
      (e.useReducer = function (e, t, n) {
        return w.H.useReducer(e, t, n);
      }),
      (e.useRef = function (e) {
        return w.H.useRef(e);
      }),
      (e.useState = function (e) {
        return w.H.useState(e);
      }),
      (e.useSyncExternalStore = function (e, t, n) {
        return w.H.useSyncExternalStore(e, t, n);
      }),
      (e.useTransition = function () {
        return w.H.useTransition();
      }),
      (e.version = `19.2.8`));
  }),
  m = t((e, t) => {
    t.exports = p();
  }),
  h = t((e) => {
    var t = Symbol.for(`react.transitional.element`),
      n = Symbol.for(`react.fragment`);
    function r(e, n, r) {
      var i = null;
      if (
        (r !== void 0 && (i = `` + r),
        n.key !== void 0 && (i = `` + n.key),
        `key` in n)
      )
        for (var a in ((r = {}), n)) a !== `key` && (r[a] = n[a]);
      else r = n;
      return (
        (n = r.ref),
        { $$typeof: t, type: e, key: i, ref: n === void 0 ? null : n, props: r }
      );
    }
    ((e.Fragment = n), (e.jsx = r), (e.jsxs = r));
  }),
  g = t((e, t) => {
    t.exports = h();
  }),
  _ = t((e) => {
    var t = m();
    function n(e, t) {
      return (e === t && (e !== 0 || 1 / e == 1 / t)) || (e !== e && t !== t);
    }
    var r = typeof Object.is == `function` ? Object.is : n,
      i = t.useState,
      a = t.useEffect,
      o = t.useLayoutEffect,
      s = t.useDebugValue;
    function c(e, t) {
      var n = t(),
        r = i({ inst: { value: n, getSnapshot: t } }),
        c = r[0].inst,
        u = r[1];
      return (
        o(
          function () {
            ((c.value = n), (c.getSnapshot = t), l(c) && u({ inst: c }));
          },
          [e, n, t],
        ),
        a(
          function () {
            return (
              l(c) && u({ inst: c }),
              e(function () {
                l(c) && u({ inst: c });
              })
            );
          },
          [e],
        ),
        s(n),
        n
      );
    }
    function l(e) {
      var t = e.getSnapshot;
      e = e.value;
      try {
        var n = t();
        return !r(e, n);
      } catch {
        return !0;
      }
    }
    function u(e, t) {
      return t();
    }
    var d =
      typeof window > `u` ||
      window.document === void 0 ||
      window.document.createElement === void 0
        ? u
        : c;
    e.useSyncExternalStore =
      t.useSyncExternalStore === void 0 ? d : t.useSyncExternalStore;
  }),
  v = t((e, t) => {
    t.exports = _();
  }),
  y = v(),
  b = r(m(), 1),
  x = g(),
  S = (0, b.createContext)(null);
function C({ platform: e, children: t }) {
  return (0, x.jsx)(S.Provider, { value: e, children: t });
}
function w() {
  let e = (0, b.useContext)(S);
  if (!e) throw Error(`usePlatform called outside PlatformProvider`);
  return e;
}
function T(t) {
  return e(t, w().target);
}
function E() {
  return n(w().target);
}
var D = (e) => e.replace(/([a-z0-9])([A-Z])/g, `$1-$2`).toLowerCase(),
  O = (...e) =>
    e
      .filter((e, t, n) => !!e && e.trim() !== `` && n.indexOf(e) === t)
      .join(` `)
      .trim(),
  k = {
    xmlns: `http://www.w3.org/2000/svg`,
    width: 24,
    height: 24,
    viewBox: `0 0 24 24`,
    fill: `none`,
    stroke: `currentColor`,
    strokeWidth: 2,
    strokeLinecap: `round`,
    strokeLinejoin: `round`,
  },
  A = (0, b.forwardRef)(
    (
      {
        color: e = `currentColor`,
        size: t = 24,
        strokeWidth: n = 2,
        absoluteStrokeWidth: r,
        className: i = ``,
        children: a,
        iconNode: o,
        ...s
      },
      c,
    ) =>
      (0, b.createElement)(
        `svg`,
        {
          ref: c,
          ...k,
          width: t,
          height: t,
          stroke: e,
          strokeWidth: r ? (Number(n) * 24) / Number(t) : n,
          className: O(`lucide`, i),
          ...s,
        },
        [
          ...o.map(([e, t]) => (0, b.createElement)(e, t)),
          ...(Array.isArray(a) ? a : [a]),
        ],
      ),
  ),
  j = (e, t) => {
    let n = (0, b.forwardRef)(({ className: n, ...r }, i) =>
      (0, b.createElement)(A, {
        ref: i,
        iconNode: t,
        className: O(`lucide-${D(e)}`, n),
        ...r,
      }),
    );
    return ((n.displayName = `${e}`), n);
  },
  M = /<([a-zA-Z0-9]+)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9]+)\/>/,
  N = {
    area: !0,
    base: !0,
    br: !0,
    col: !0,
    embed: !0,
    hr: !0,
    img: !0,
    input: !0,
    keygen: !0,
    link: !0,
    meta: !0,
    param: !0,
    source: !0,
    track: !0,
    wbr: !0,
    menuitem: !0,
  };
function P(e, t = {}) {
  let n = e.split(M);
  if (n.length === 1) return e;
  let r = I(0, `$lingui$`),
    i = [],
    a = n.shift();
  a && i.push(a);
  for (let [e, a, o] of F(n)) {
    let n = e === void 0 ? void 0 : t[e];
    ((!n || (N[n.type] && a)) &&
      (console.error(
        n
          ? `${n.type} is a void element tag therefore it must have no children`
          : `Can't use element at index '${e}' as it is not declared in the original translation`,
      ),
      (n = (0, x.jsx)(x.Fragment, {}))),
      Array.isArray(n) && (n = (0, x.jsx)(x.Fragment, { children: n })),
      i.push(
        (0, b.cloneElement)(n, { key: r() }, a ? P(a, t) : n.props.children),
      ),
      o && i.push(o));
  }
  return i.length === 1 ? i[0] : i;
}
function F(e) {
  if (!e.length) return [];
  let [t, n, r, i] = e.slice(0, 4);
  return [[t || r, n || ``, i]].concat(F(e.slice(4, e.length)));
}
var I =
  (e = 0, t = ``) =>
  () =>
    `${t}_${e++}`;
function L(e) {
  let {
      render: t,
      component: n,
      id: r,
      message: i,
      formats: a,
      lingui: { i18n: o, defaultComponent: s },
    } = e,
    { values: c, components: l } = te(e),
    u =
      o && typeof o._ == `function` ? o._(r, c, { message: i, formats: a }) : r,
    d = u ? P(u, l) : null;
  if (t === null || n === null) return d;
  let f = s || ee,
    p = { id: r, message: i, translation: d, children: d };
  if (t && n)
    console.error(
      "You can't use both `component` and `render` prop at the same time. `component` is ignored.",
    );
  else if (t && typeof t != `function`)
    console.error(
      `Invalid value supplied to prop \`render\`. It must be a function, provided ${t}`,
    );
  else if (n && typeof n != `function`)
    return (
      console.error(
        `Invalid value supplied to prop \`component\`. It must be a React component, provided ${n}`,
      ),
      (0, x.jsx)(f, { ...p, children: d })
    );
  return typeof t == `function`
    ? t(p)
    : (0, x.jsx)(n || f, { ...p, children: d });
}
var ee = ({ children: e }) => e,
  te = (e) => {
    if (!e.values) return { values: void 0, components: e.components };
    let t = { ...e.values },
      n = { ...e.components };
    return (
      Object.entries(e.values).forEach(([e, r]) => {
        if (typeof r == `string` || typeof r == `number`) return;
        let i = Object.keys(n).length;
        ((n[i] = (0, x.jsx)(x.Fragment, { children: r })), (t[e] = `<${i}/>`));
      }),
      { values: t, components: n }
    );
  },
  ne = (0, b.createContext)(null),
  re = (e) => (0, b.useContext)(ne);
function ie() {
  return re();
}
var ae = (e, t) => ({
    i18n: new Proxy(e, {}),
    defaultComponent: t,
    _: e.t.bind(e),
  }),
  oe = (e, t) => {
    let n = e.locale,
      r = ae(e, t),
      i = () => {
        ((n = e.locale), (r = ae(e, t)));
      };
    return {
      getSnapshot: () => (n !== e.locale && i(), r),
      subscribe: (t) =>
        e.on(`change`, () => {
          (i(), t());
        }),
    };
  },
  se = ({ i18n: e, defaultComponent: t, children: n }) => {
    let r = (0, b.useMemo)(() => oe(e, t), [e, t]),
      i = (0, y.useSyncExternalStore)(
        r.subscribe,
        r.getSnapshot,
        r.getSnapshot,
      );
    return i.i18n.locale
      ? (0, x.jsx)(ne.Provider, { value: i, children: n })
      : null;
  };
function ce(e) {
  let t = re(void 0);
  return (0, x.jsx)(L, { ...e, lingui: t });
}
var le = (0, b.createContext)({
    ready: !0,
    vaults: [],
    defaultVaultId: void 0,
    activeId: void 0,
    syncKey: (e) => e,
    selectVault: () => {},
    clearSelection: () => {},
    createRecord: async () => ``,
    rename: async () => {},
    dropActiveRecord: async () => {},
    refresh: async () => {},
    hide: async () => {},
    forgetEmptyRecord: async () => {},
  }),
  ue = (e) => {
    let t = d(e);
    return t.length === 1 ? t[0]?.id : void 0;
  };
function de() {
  return (0, b.useContext)(le);
}
function fe({ children: e, initialActiveId: t }) {
  let { storage: n, shell: r } = w(),
    [p, m] = (0, b.useState)(!1),
    [h, g] = (0, b.useState)(l),
    [_, v] = (0, b.useState)(t),
    y = (0, b.useCallback)(async () => {
      let e = u(await n.getMeta(i));
      g(e);
      let t = (await r?.getActiveVault?.()) ?? null,
        a = t && e.vaults.some((e) => e.id === t) ? t : void 0;
      (v((t) => t ?? a ?? ue(e)), m(!0));
    }, [n, r]);
  (0, b.useEffect)(() => {
    y();
  }, [y]);
  let S = (0, b.useCallback)((e) => v(e), []),
    C = (0, b.useCallback)(() => v(void 0), []),
    T = (0, b.useCallback)(
      (e) => {
        let t = _ ?? d(h)[0]?.id;
        return t ? c(e, t) : e;
      },
      [_, h],
    ),
    E = (0, b.useCallback)(
      async (e) => {
        (await n.setMeta(i, e), g(e));
      },
      [n],
    ),
    D = (0, b.useCallback)(
      async (e = ``) => {
        let t = crypto.randomUUID(),
          r = u(await n.getMeta(i));
        return (
          await E(o(r, { id: t, label: e, createdAt: Date.now() })),
          v(t),
          t
        );
      },
      [n, E],
    ),
    O = (0, b.useCallback)(
      async (e) => {
        if (!_) return;
        let t = u(await n.getMeta(i));
        await E(s(t, _, e));
      },
      [n, E, _],
    ),
    k = (0, b.useCallback)(async () => {
      if (!_) return;
      let e = f(u(await n.getMeta(i)), _);
      (await E(e), v(ue(e)));
    }, [n, E, _]),
    A = (0, b.useCallback)(
      async (e, t) => {
        let r = u(await n.getMeta(i));
        await E(a(r, e, { at: Date.now(), ...t }));
      },
      [n, E],
    ),
    j = (0, b.useCallback)(
      async (e) => {
        if (e === _) return;
        let t = u(await n.getMeta(i));
        await E(f(t, e));
      },
      [_, n, E],
    ),
    M = (0, b.useMemo)(
      () => ({
        ready: p,
        vaults: d(h),
        defaultVaultId: h.vaults[0]?.id,
        activeId: _,
        syncKey: T,
        selectVault: S,
        clearSelection: C,
        createRecord: D,
        rename: O,
        dropActiveRecord: k,
        refresh: y,
        hide: A,
        forgetEmptyRecord: j,
      }),
      [p, h, _, T, S, C, D, O, k, y, A, j],
    );
  return (0, x.jsx)(le.Provider, { value: M, children: e });
}
function pe(e, t) {
  return {
    hasVaultHandle: (n) => e.hasVaultHandle(n ?? t),
    readVaultBlob: (n) => e.readVaultBlob(n ?? t),
    writeVaultBlob: (n, r) => e.writeVaultBlob(n, r ?? t),
    restoreVaultFromBackup: (n) => e.restoreVaultFromBackup(n ?? t),
    readQuarantine: e.readQuarantine && ((n) => e.readQuarantine(n ?? t)),
    writeQuarantine:
      e.writeQuarantine && ((n, r) => e.writeQuarantine(n, r ?? t)),
    deleteVaultBlob: (t) => e.deleteVaultBlob(t),
    getMeta: e.getMeta,
    setMeta: e.setMeta,
    removeMeta: e.removeMeta,
    subscribeMeta: e.subscribeMeta,
  };
}
function R(e) {
  var t,
    n,
    r = ``;
  if (typeof e == `string` || typeof e == `number`) r += e;
  else if (typeof e == `object`) {
    if (Array.isArray(e)) {
      var i = e.length;
      for (t = 0; t < i; t++)
        e[t] && (n = R(e[t])) && (r && (r += ` `), (r += n));
    } else for (n in e) e[n] && (r && (r += ` `), (r += n));
  }
  return r;
}
function z() {
  for (var e, t, n = 0, r = ``, i = arguments.length; n < i; n++)
    (e = arguments[n]) && (t = R(e)) && (r && (r += ` `), (r += t));
  return r;
}
var B = (e) => (typeof e == `boolean` ? `${e}` : e === 0 ? `0` : e),
  me = z,
  he = (e, t) => (n) => {
    if (t?.variants == null) return me(e, n?.class, n?.className);
    let { variants: r, defaultVariants: i } = t,
      a = Object.keys(r).map((e) => {
        let t = n?.[e],
          a = i?.[e];
        if (t === null) return null;
        let o = B(t) || B(a);
        return r[e][o];
      }),
      o =
        n &&
        Object.entries(n).reduce((e, t) => {
          let [n, r] = t;
          return (r === void 0 || (e[n] = r), e);
        }, {});
    return me(
      e,
      a,
      t?.compoundVariants?.reduce((e, t) => {
        let { class: n, className: r, ...a } = t;
        return Object.entries(a).every((e) => {
          let [t, n] = e;
          return Array.isArray(n)
            ? n.includes({ ...i, ...o }[t])
            : { ...i, ...o }[t] === n;
        })
          ? [...e, n, r]
          : e;
      }, []),
      n?.class,
      n?.className,
    );
  },
  V = `-`,
  ge = (e) => {
    let t = be(e),
      { conflictingClassGroups: n, conflictingClassGroupModifiers: r } = e;
    return {
      getClassGroupId: (e) => {
        let n = e.split(V);
        return (n[0] === `` && n.length !== 1 && n.shift(), _e(n, t) || ye(e));
      },
      getConflictingClassGroupIds: (e, t) => {
        let i = n[e] || [];
        return t && r[e] ? [...i, ...r[e]] : i;
      },
    };
  },
  _e = (e, t) => {
    if (e.length === 0) return t.classGroupId;
    let n = e[0],
      r = t.nextPart.get(n),
      i = r ? _e(e.slice(1), r) : void 0;
    if (i) return i;
    if (t.validators.length === 0) return;
    let a = e.join(V);
    return t.validators.find(({ validator: e }) => e(a))?.classGroupId;
  },
  ve = /^\[(.+)\]$/,
  ye = (e) => {
    if (ve.test(e)) {
      let t = ve.exec(e)[1],
        n = t?.substring(0, t.indexOf(`:`));
      if (n) return `arbitrary..` + n;
    }
  },
  be = (e) => {
    let { theme: t, prefix: n } = e,
      r = { nextPart: new Map(), validators: [] };
    return (
      Ce(Object.entries(e.classGroups), n).forEach(([e, n]) => {
        H(n, r, e, t);
      }),
      r
    );
  },
  H = (e, t, n, r) => {
    e.forEach((e) => {
      if (typeof e == `string`) {
        let r = e === `` ? t : xe(t, e);
        r.classGroupId = n;
      } else if (typeof e == `function`) {
        if (Se(e)) {
          H(e(r), t, n, r);
          return;
        }
        t.validators.push({ validator: e, classGroupId: n });
      } else
        Object.entries(e).forEach(([e, i]) => {
          H(i, xe(t, e), n, r);
        });
    });
  },
  xe = (e, t) => {
    let n = e;
    return (
      t.split(V).forEach((e) => {
        (n.nextPart.has(e) ||
          n.nextPart.set(e, { nextPart: new Map(), validators: [] }),
          (n = n.nextPart.get(e)));
      }),
      n
    );
  },
  Se = (e) => e.isThemeGetter,
  Ce = (e, t) =>
    t
      ? e.map(([e, n]) => [
          e,
          n.map((e) =>
            typeof e == `string`
              ? t + e
              : typeof e == `object`
                ? Object.fromEntries(
                    Object.entries(e).map(([e, n]) => [t + e, n]),
                  )
                : e,
          ),
        ])
      : e,
  we = (e) => {
    if (e < 1) return { get: () => void 0, set: () => {} };
    let t = 0,
      n = new Map(),
      r = new Map(),
      i = (i, a) => {
        (n.set(i, a), t++, t > e && ((t = 0), (r = n), (n = new Map())));
      };
    return {
      get(e) {
        let t = n.get(e);
        if (t !== void 0) return t;
        if ((t = r.get(e)) !== void 0) return (i(e, t), t);
      },
      set(e, t) {
        n.has(e) ? n.set(e, t) : i(e, t);
      },
    };
  },
  Te = `!`,
  Ee = (e) => {
    let { separator: t, experimentalParseClassName: n } = e,
      r = t.length === 1,
      i = t[0],
      a = t.length,
      o = (e) => {
        let n = [],
          o = 0,
          s = 0,
          c;
        for (let l = 0; l < e.length; l++) {
          let u = e[l];
          if (o === 0) {
            if (u === i && (r || e.slice(l, l + a) === t)) {
              (n.push(e.slice(s, l)), (s = l + a));
              continue;
            }
            if (u === `/`) {
              c = l;
              continue;
            }
          }
          u === `[` ? o++ : u === `]` && o--;
        }
        let l = n.length === 0 ? e : e.substring(s),
          u = l.startsWith(Te);
        return {
          modifiers: n,
          hasImportantModifier: u,
          baseClassName: u ? l.substring(1) : l,
          maybePostfixModifierPosition: c && c > s ? c - s : void 0,
        };
      };
    return n ? (e) => n({ className: e, parseClassName: o }) : o;
  },
  De = (e) => {
    if (e.length <= 1) return e;
    let t = [],
      n = [];
    return (
      e.forEach((e) => {
        e[0] === `[` ? (t.push(...n.sort(), e), (n = [])) : n.push(e);
      }),
      t.push(...n.sort()),
      t
    );
  },
  Oe = (e) => ({ cache: we(e.cacheSize), parseClassName: Ee(e), ...ge(e) }),
  ke = /\s+/,
  Ae = (e, t) => {
    let {
        parseClassName: n,
        getClassGroupId: r,
        getConflictingClassGroupIds: i,
      } = t,
      a = [],
      o = e.trim().split(ke),
      s = ``;
    for (let e = o.length - 1; e >= 0; --e) {
      let t = o[e],
        {
          modifiers: c,
          hasImportantModifier: l,
          baseClassName: u,
          maybePostfixModifierPosition: d,
        } = n(t),
        f = !!d,
        p = r(f ? u.substring(0, d) : u);
      if (!p) {
        if (!f || ((p = r(u)), !p)) {
          s = t + (s.length > 0 ? ` ` + s : s);
          continue;
        }
        f = !1;
      }
      let m = De(c).join(`:`),
        h = l ? m + Te : m,
        g = h + p;
      if (a.includes(g)) continue;
      a.push(g);
      let _ = i(p, f);
      for (let e = 0; e < _.length; ++e) {
        let t = _[e];
        a.push(h + t);
      }
      s = t + (s.length > 0 ? ` ` + s : s);
    }
    return s;
  };
function je() {
  let e = 0,
    t,
    n,
    r = ``;
  for (; e < arguments.length;)
    (t = arguments[e++]) && (n = Me(t)) && (r && (r += ` `), (r += n));
  return r;
}
var Me = (e) => {
  if (typeof e == `string`) return e;
  let t,
    n = ``;
  for (let r = 0; r < e.length; r++)
    e[r] && (t = Me(e[r])) && (n && (n += ` `), (n += t));
  return n;
};
function Ne(e, ...t) {
  let n,
    r,
    i,
    a = o;
  function o(o) {
    return (
      (n = Oe(t.reduce((e, t) => t(e), e()))),
      (r = n.cache.get),
      (i = n.cache.set),
      (a = s),
      s(o)
    );
  }
  function s(e) {
    let t = r(e);
    if (t) return t;
    let a = Ae(e, n);
    return (i(e, a), a);
  }
  return function () {
    return a(je.apply(null, arguments));
  };
}
var U = (e) => {
    let t = (t) => t[e] || [];
    return ((t.isThemeGetter = !0), t);
  },
  Pe = /^\[(?:([a-z-]+):)?(.+)\]$/i,
  Fe = /^\d+\/\d+$/,
  Ie = new Set([`px`, `full`, `screen`]),
  Le = /^(\d+(\.\d+)?)?(xs|sm|md|lg|xl)$/,
  Re =
    /\d+(%|px|r?em|[sdl]?v([hwib]|min|max)|pt|pc|in|cm|mm|cap|ch|ex|r?lh|cq(w|h|i|b|min|max))|\b(calc|min|max|clamp)\(.+\)|^0$/,
  ze = /^(rgba?|hsla?|hwb|(ok)?(lab|lch)|color-mix)\(.+\)$/,
  Be = /^(inset_)?-?((\d+)?\.?(\d+)[a-z]+|0)_-?((\d+)?\.?(\d+)[a-z]+|0)/,
  Ve =
    /^(url|image|image-set|cross-fade|element|(repeating-)?(linear|radial|conic)-gradient)\(.+\)$/,
  W = (e) => K(e) || Ie.has(e) || Fe.test(e),
  G = (e) => Q(e, `length`, Ye),
  K = (e) => !!e && !Number.isNaN(Number(e)),
  q = (e) => Q(e, `number`, K),
  J = (e) => !!e && Number.isInteger(Number(e)),
  He = (e) => e.endsWith(`%`) && K(e.slice(0, -1)),
  Y = (e) => Pe.test(e),
  X = (e) => Le.test(e),
  Ue = new Set([`length`, `size`, `percentage`]),
  We = (e) => Q(e, Ue, Xe),
  Ge = (e) => Q(e, `position`, Xe),
  Ke = new Set([`image`, `url`]),
  qe = (e) => Q(e, Ke, Qe),
  Je = (e) => Q(e, ``, Ze),
  Z = () => !0,
  Q = (e, t, n) => {
    let r = Pe.exec(e);
    return r
      ? r[1]
        ? typeof t == `string`
          ? r[1] === t
          : t.has(r[1])
        : n(r[2])
      : !1;
  },
  Ye = (e) => Re.test(e) && !ze.test(e),
  Xe = () => !1,
  Ze = (e) => Be.test(e),
  Qe = (e) => Ve.test(e),
  $e = Ne(() => {
    let e = U(`colors`),
      t = U(`spacing`),
      n = U(`blur`),
      r = U(`brightness`),
      i = U(`borderColor`),
      a = U(`borderRadius`),
      o = U(`borderSpacing`),
      s = U(`borderWidth`),
      c = U(`contrast`),
      l = U(`grayscale`),
      u = U(`hueRotate`),
      d = U(`invert`),
      f = U(`gap`),
      p = U(`gradientColorStops`),
      m = U(`gradientColorStopPositions`),
      h = U(`inset`),
      g = U(`margin`),
      _ = U(`opacity`),
      v = U(`padding`),
      y = U(`saturate`),
      b = U(`scale`),
      x = U(`sepia`),
      S = U(`skew`),
      C = U(`space`),
      w = U(`translate`),
      T = () => [`auto`, `contain`, `none`],
      E = () => [`auto`, `hidden`, `clip`, `visible`, `scroll`],
      D = () => [`auto`, Y, t],
      O = () => [Y, t],
      k = () => [``, W, G],
      A = () => [`auto`, K, Y],
      j = () => [
        `bottom`,
        `center`,
        `left`,
        `left-bottom`,
        `left-top`,
        `right`,
        `right-bottom`,
        `right-top`,
        `top`,
      ],
      M = () => [`solid`, `dashed`, `dotted`, `double`, `none`],
      N = () => [
        `normal`,
        `multiply`,
        `screen`,
        `overlay`,
        `darken`,
        `lighten`,
        `color-dodge`,
        `color-burn`,
        `hard-light`,
        `soft-light`,
        `difference`,
        `exclusion`,
        `hue`,
        `saturation`,
        `color`,
        `luminosity`,
      ],
      P = () => [
        `start`,
        `end`,
        `center`,
        `between`,
        `around`,
        `evenly`,
        `stretch`,
      ],
      F = () => [``, `0`, Y],
      I = () => [
        `auto`,
        `avoid`,
        `all`,
        `avoid-page`,
        `page`,
        `left`,
        `right`,
        `column`,
      ],
      L = () => [K, Y];
    return {
      cacheSize: 500,
      separator: `:`,
      theme: {
        colors: [Z],
        spacing: [W, G],
        blur: [`none`, ``, X, Y],
        brightness: L(),
        borderColor: [e],
        borderRadius: [`none`, ``, `full`, X, Y],
        borderSpacing: O(),
        borderWidth: k(),
        contrast: L(),
        grayscale: F(),
        hueRotate: L(),
        invert: F(),
        gap: O(),
        gradientColorStops: [e],
        gradientColorStopPositions: [He, G],
        inset: D(),
        margin: D(),
        opacity: L(),
        padding: O(),
        saturate: L(),
        scale: L(),
        sepia: F(),
        skew: L(),
        space: O(),
        translate: O(),
      },
      classGroups: {
        aspect: [{ aspect: [`auto`, `square`, `video`, Y] }],
        container: [`container`],
        columns: [{ columns: [X] }],
        "break-after": [{ "break-after": I() }],
        "break-before": [{ "break-before": I() }],
        "break-inside": [
          { "break-inside": [`auto`, `avoid`, `avoid-page`, `avoid-column`] },
        ],
        "box-decoration": [{ "box-decoration": [`slice`, `clone`] }],
        box: [{ box: [`border`, `content`] }],
        display: [
          `block`,
          `inline-block`,
          `inline`,
          `flex`,
          `inline-flex`,
          `table`,
          `inline-table`,
          `table-caption`,
          `table-cell`,
          `table-column`,
          `table-column-group`,
          `table-footer-group`,
          `table-header-group`,
          `table-row-group`,
          `table-row`,
          `flow-root`,
          `grid`,
          `inline-grid`,
          `contents`,
          `list-item`,
          `hidden`,
        ],
        float: [{ float: [`right`, `left`, `none`, `start`, `end`] }],
        clear: [{ clear: [`left`, `right`, `both`, `none`, `start`, `end`] }],
        isolation: [`isolate`, `isolation-auto`],
        "object-fit": [
          { object: [`contain`, `cover`, `fill`, `none`, `scale-down`] },
        ],
        "object-position": [{ object: [...j(), Y] }],
        overflow: [{ overflow: E() }],
        "overflow-x": [{ "overflow-x": E() }],
        "overflow-y": [{ "overflow-y": E() }],
        overscroll: [{ overscroll: T() }],
        "overscroll-x": [{ "overscroll-x": T() }],
        "overscroll-y": [{ "overscroll-y": T() }],
        position: [`static`, `fixed`, `absolute`, `relative`, `sticky`],
        inset: [{ inset: [h] }],
        "inset-x": [{ "inset-x": [h] }],
        "inset-y": [{ "inset-y": [h] }],
        start: [{ start: [h] }],
        end: [{ end: [h] }],
        top: [{ top: [h] }],
        right: [{ right: [h] }],
        bottom: [{ bottom: [h] }],
        left: [{ left: [h] }],
        visibility: [`visible`, `invisible`, `collapse`],
        z: [{ z: [`auto`, J, Y] }],
        basis: [{ basis: D() }],
        "flex-direction": [
          { flex: [`row`, `row-reverse`, `col`, `col-reverse`] },
        ],
        "flex-wrap": [{ flex: [`wrap`, `wrap-reverse`, `nowrap`] }],
        flex: [{ flex: [`1`, `auto`, `initial`, `none`, Y] }],
        grow: [{ grow: F() }],
        shrink: [{ shrink: F() }],
        order: [{ order: [`first`, `last`, `none`, J, Y] }],
        "grid-cols": [{ "grid-cols": [Z] }],
        "col-start-end": [{ col: [`auto`, { span: [`full`, J, Y] }, Y] }],
        "col-start": [{ "col-start": A() }],
        "col-end": [{ "col-end": A() }],
        "grid-rows": [{ "grid-rows": [Z] }],
        "row-start-end": [{ row: [`auto`, { span: [J, Y] }, Y] }],
        "row-start": [{ "row-start": A() }],
        "row-end": [{ "row-end": A() }],
        "grid-flow": [
          { "grid-flow": [`row`, `col`, `dense`, `row-dense`, `col-dense`] },
        ],
        "auto-cols": [{ "auto-cols": [`auto`, `min`, `max`, `fr`, Y] }],
        "auto-rows": [{ "auto-rows": [`auto`, `min`, `max`, `fr`, Y] }],
        gap: [{ gap: [f] }],
        "gap-x": [{ "gap-x": [f] }],
        "gap-y": [{ "gap-y": [f] }],
        "justify-content": [{ justify: [`normal`, ...P()] }],
        "justify-items": [
          { "justify-items": [`start`, `end`, `center`, `stretch`] },
        ],
        "justify-self": [
          { "justify-self": [`auto`, `start`, `end`, `center`, `stretch`] },
        ],
        "align-content": [{ content: [`normal`, ...P(), `baseline`] }],
        "align-items": [
          { items: [`start`, `end`, `center`, `baseline`, `stretch`] },
        ],
        "align-self": [
          { self: [`auto`, `start`, `end`, `center`, `stretch`, `baseline`] },
        ],
        "place-content": [{ "place-content": [...P(), `baseline`] }],
        "place-items": [
          { "place-items": [`start`, `end`, `center`, `baseline`, `stretch`] },
        ],
        "place-self": [
          { "place-self": [`auto`, `start`, `end`, `center`, `stretch`] },
        ],
        p: [{ p: [v] }],
        px: [{ px: [v] }],
        py: [{ py: [v] }],
        ps: [{ ps: [v] }],
        pe: [{ pe: [v] }],
        pt: [{ pt: [v] }],
        pr: [{ pr: [v] }],
        pb: [{ pb: [v] }],
        pl: [{ pl: [v] }],
        m: [{ m: [g] }],
        mx: [{ mx: [g] }],
        my: [{ my: [g] }],
        ms: [{ ms: [g] }],
        me: [{ me: [g] }],
        mt: [{ mt: [g] }],
        mr: [{ mr: [g] }],
        mb: [{ mb: [g] }],
        ml: [{ ml: [g] }],
        "space-x": [{ "space-x": [C] }],
        "space-x-reverse": [`space-x-reverse`],
        "space-y": [{ "space-y": [C] }],
        "space-y-reverse": [`space-y-reverse`],
        w: [{ w: [`auto`, `min`, `max`, `fit`, `svw`, `lvw`, `dvw`, Y, t] }],
        "min-w": [{ "min-w": [Y, t, `min`, `max`, `fit`] }],
        "max-w": [
          {
            "max-w": [
              Y,
              t,
              `none`,
              `full`,
              `min`,
              `max`,
              `fit`,
              `prose`,
              { screen: [X] },
              X,
            ],
          },
        ],
        h: [{ h: [Y, t, `auto`, `min`, `max`, `fit`, `svh`, `lvh`, `dvh`] }],
        "min-h": [
          { "min-h": [Y, t, `min`, `max`, `fit`, `svh`, `lvh`, `dvh`] },
        ],
        "max-h": [
          { "max-h": [Y, t, `min`, `max`, `fit`, `svh`, `lvh`, `dvh`] },
        ],
        size: [{ size: [Y, t, `auto`, `min`, `max`, `fit`] }],
        "font-size": [{ text: [`base`, X, G] }],
        "font-smoothing": [`antialiased`, `subpixel-antialiased`],
        "font-style": [`italic`, `not-italic`],
        "font-weight": [
          {
            font: [
              `thin`,
              `extralight`,
              `light`,
              `normal`,
              `medium`,
              `semibold`,
              `bold`,
              `extrabold`,
              `black`,
              q,
            ],
          },
        ],
        "font-family": [{ font: [Z] }],
        "fvn-normal": [`normal-nums`],
        "fvn-ordinal": [`ordinal`],
        "fvn-slashed-zero": [`slashed-zero`],
        "fvn-figure": [`lining-nums`, `oldstyle-nums`],
        "fvn-spacing": [`proportional-nums`, `tabular-nums`],
        "fvn-fraction": [`diagonal-fractions`, `stacked-fractions`],
        tracking: [
          {
            tracking: [
              `tighter`,
              `tight`,
              `normal`,
              `wide`,
              `wider`,
              `widest`,
              Y,
            ],
          },
        ],
        "line-clamp": [{ "line-clamp": [`none`, K, q] }],
        leading: [
          {
            leading: [
              `none`,
              `tight`,
              `snug`,
              `normal`,
              `relaxed`,
              `loose`,
              W,
              Y,
            ],
          },
        ],
        "list-image": [{ "list-image": [`none`, Y] }],
        "list-style-type": [{ list: [`none`, `disc`, `decimal`, Y] }],
        "list-style-position": [{ list: [`inside`, `outside`] }],
        "placeholder-color": [{ placeholder: [e] }],
        "placeholder-opacity": [{ "placeholder-opacity": [_] }],
        "text-alignment": [
          { text: [`left`, `center`, `right`, `justify`, `start`, `end`] },
        ],
        "text-color": [{ text: [e] }],
        "text-opacity": [{ "text-opacity": [_] }],
        "text-decoration": [
          `underline`,
          `overline`,
          `line-through`,
          `no-underline`,
        ],
        "text-decoration-style": [{ decoration: [...M(), `wavy`] }],
        "text-decoration-thickness": [
          { decoration: [`auto`, `from-font`, W, G] },
        ],
        "underline-offset": [{ "underline-offset": [`auto`, W, Y] }],
        "text-decoration-color": [{ decoration: [e] }],
        "text-transform": [
          `uppercase`,
          `lowercase`,
          `capitalize`,
          `normal-case`,
        ],
        "text-overflow": [`truncate`, `text-ellipsis`, `text-clip`],
        "text-wrap": [{ text: [`wrap`, `nowrap`, `balance`, `pretty`] }],
        indent: [{ indent: O() }],
        "vertical-align": [
          {
            align: [
              `baseline`,
              `top`,
              `middle`,
              `bottom`,
              `text-top`,
              `text-bottom`,
              `sub`,
              `super`,
              Y,
            ],
          },
        ],
        whitespace: [
          {
            whitespace: [
              `normal`,
              `nowrap`,
              `pre`,
              `pre-line`,
              `pre-wrap`,
              `break-spaces`,
            ],
          },
        ],
        break: [{ break: [`normal`, `words`, `all`, `keep`] }],
        hyphens: [{ hyphens: [`none`, `manual`, `auto`] }],
        content: [{ content: [`none`, Y] }],
        "bg-attachment": [{ bg: [`fixed`, `local`, `scroll`] }],
        "bg-clip": [{ "bg-clip": [`border`, `padding`, `content`, `text`] }],
        "bg-opacity": [{ "bg-opacity": [_] }],
        "bg-origin": [{ "bg-origin": [`border`, `padding`, `content`] }],
        "bg-position": [{ bg: [...j(), Ge] }],
        "bg-repeat": [
          { bg: [`no-repeat`, { repeat: [``, `x`, `y`, `round`, `space`] }] },
        ],
        "bg-size": [{ bg: [`auto`, `cover`, `contain`, We] }],
        "bg-image": [
          {
            bg: [
              `none`,
              { "gradient-to": [`t`, `tr`, `r`, `br`, `b`, `bl`, `l`, `tl`] },
              qe,
            ],
          },
        ],
        "bg-color": [{ bg: [e] }],
        "gradient-from-pos": [{ from: [m] }],
        "gradient-via-pos": [{ via: [m] }],
        "gradient-to-pos": [{ to: [m] }],
        "gradient-from": [{ from: [p] }],
        "gradient-via": [{ via: [p] }],
        "gradient-to": [{ to: [p] }],
        rounded: [{ rounded: [a] }],
        "rounded-s": [{ "rounded-s": [a] }],
        "rounded-e": [{ "rounded-e": [a] }],
        "rounded-t": [{ "rounded-t": [a] }],
        "rounded-r": [{ "rounded-r": [a] }],
        "rounded-b": [{ "rounded-b": [a] }],
        "rounded-l": [{ "rounded-l": [a] }],
        "rounded-ss": [{ "rounded-ss": [a] }],
        "rounded-se": [{ "rounded-se": [a] }],
        "rounded-ee": [{ "rounded-ee": [a] }],
        "rounded-es": [{ "rounded-es": [a] }],
        "rounded-tl": [{ "rounded-tl": [a] }],
        "rounded-tr": [{ "rounded-tr": [a] }],
        "rounded-br": [{ "rounded-br": [a] }],
        "rounded-bl": [{ "rounded-bl": [a] }],
        "border-w": [{ border: [s] }],
        "border-w-x": [{ "border-x": [s] }],
        "border-w-y": [{ "border-y": [s] }],
        "border-w-s": [{ "border-s": [s] }],
        "border-w-e": [{ "border-e": [s] }],
        "border-w-t": [{ "border-t": [s] }],
        "border-w-r": [{ "border-r": [s] }],
        "border-w-b": [{ "border-b": [s] }],
        "border-w-l": [{ "border-l": [s] }],
        "border-opacity": [{ "border-opacity": [_] }],
        "border-style": [{ border: [...M(), `hidden`] }],
        "divide-x": [{ "divide-x": [s] }],
        "divide-x-reverse": [`divide-x-reverse`],
        "divide-y": [{ "divide-y": [s] }],
        "divide-y-reverse": [`divide-y-reverse`],
        "divide-opacity": [{ "divide-opacity": [_] }],
        "divide-style": [{ divide: M() }],
        "border-color": [{ border: [i] }],
        "border-color-x": [{ "border-x": [i] }],
        "border-color-y": [{ "border-y": [i] }],
        "border-color-s": [{ "border-s": [i] }],
        "border-color-e": [{ "border-e": [i] }],
        "border-color-t": [{ "border-t": [i] }],
        "border-color-r": [{ "border-r": [i] }],
        "border-color-b": [{ "border-b": [i] }],
        "border-color-l": [{ "border-l": [i] }],
        "divide-color": [{ divide: [i] }],
        "outline-style": [{ outline: [``, ...M()] }],
        "outline-offset": [{ "outline-offset": [W, Y] }],
        "outline-w": [{ outline: [W, G] }],
        "outline-color": [{ outline: [e] }],
        "ring-w": [{ ring: k() }],
        "ring-w-inset": [`ring-inset`],
        "ring-color": [{ ring: [e] }],
        "ring-opacity": [{ "ring-opacity": [_] }],
        "ring-offset-w": [{ "ring-offset": [W, G] }],
        "ring-offset-color": [{ "ring-offset": [e] }],
        shadow: [{ shadow: [``, `inner`, `none`, X, Je] }],
        "shadow-color": [{ shadow: [Z] }],
        opacity: [{ opacity: [_] }],
        "mix-blend": [{ "mix-blend": [...N(), `plus-lighter`, `plus-darker`] }],
        "bg-blend": [{ "bg-blend": N() }],
        filter: [{ filter: [``, `none`] }],
        blur: [{ blur: [n] }],
        brightness: [{ brightness: [r] }],
        contrast: [{ contrast: [c] }],
        "drop-shadow": [{ "drop-shadow": [``, `none`, X, Y] }],
        grayscale: [{ grayscale: [l] }],
        "hue-rotate": [{ "hue-rotate": [u] }],
        invert: [{ invert: [d] }],
        saturate: [{ saturate: [y] }],
        sepia: [{ sepia: [x] }],
        "backdrop-filter": [{ "backdrop-filter": [``, `none`] }],
        "backdrop-blur": [{ "backdrop-blur": [n] }],
        "backdrop-brightness": [{ "backdrop-brightness": [r] }],
        "backdrop-contrast": [{ "backdrop-contrast": [c] }],
        "backdrop-grayscale": [{ "backdrop-grayscale": [l] }],
        "backdrop-hue-rotate": [{ "backdrop-hue-rotate": [u] }],
        "backdrop-invert": [{ "backdrop-invert": [d] }],
        "backdrop-opacity": [{ "backdrop-opacity": [_] }],
        "backdrop-saturate": [{ "backdrop-saturate": [y] }],
        "backdrop-sepia": [{ "backdrop-sepia": [x] }],
        "border-collapse": [{ border: [`collapse`, `separate`] }],
        "border-spacing": [{ "border-spacing": [o] }],
        "border-spacing-x": [{ "border-spacing-x": [o] }],
        "border-spacing-y": [{ "border-spacing-y": [o] }],
        "table-layout": [{ table: [`auto`, `fixed`] }],
        caption: [{ caption: [`top`, `bottom`] }],
        transition: [
          {
            transition: [
              `none`,
              `all`,
              ``,
              `colors`,
              `opacity`,
              `shadow`,
              `transform`,
              Y,
            ],
          },
        ],
        duration: [{ duration: L() }],
        ease: [{ ease: [`linear`, `in`, `out`, `in-out`, Y] }],
        delay: [{ delay: L() }],
        animate: [{ animate: [`none`, `spin`, `ping`, `pulse`, `bounce`, Y] }],
        transform: [{ transform: [``, `gpu`, `none`] }],
        scale: [{ scale: [b] }],
        "scale-x": [{ "scale-x": [b] }],
        "scale-y": [{ "scale-y": [b] }],
        rotate: [{ rotate: [J, Y] }],
        "translate-x": [{ "translate-x": [w] }],
        "translate-y": [{ "translate-y": [w] }],
        "skew-x": [{ "skew-x": [S] }],
        "skew-y": [{ "skew-y": [S] }],
        "transform-origin": [
          {
            origin: [
              `center`,
              `top`,
              `top-right`,
              `right`,
              `bottom-right`,
              `bottom`,
              `bottom-left`,
              `left`,
              `top-left`,
              Y,
            ],
          },
        ],
        accent: [{ accent: [`auto`, e] }],
        appearance: [{ appearance: [`none`, `auto`] }],
        cursor: [
          {
            cursor: [
              `auto`,
              `default`,
              `pointer`,
              `wait`,
              `text`,
              `move`,
              `help`,
              `not-allowed`,
              `none`,
              `context-menu`,
              `progress`,
              `cell`,
              `crosshair`,
              `vertical-text`,
              `alias`,
              `copy`,
              `no-drop`,
              `grab`,
              `grabbing`,
              `all-scroll`,
              `col-resize`,
              `row-resize`,
              `n-resize`,
              `e-resize`,
              `s-resize`,
              `w-resize`,
              `ne-resize`,
              `nw-resize`,
              `se-resize`,
              `sw-resize`,
              `ew-resize`,
              `ns-resize`,
              `nesw-resize`,
              `nwse-resize`,
              `zoom-in`,
              `zoom-out`,
              Y,
            ],
          },
        ],
        "caret-color": [{ caret: [e] }],
        "pointer-events": [{ "pointer-events": [`none`, `auto`] }],
        resize: [{ resize: [`none`, `y`, `x`, ``] }],
        "scroll-behavior": [{ scroll: [`auto`, `smooth`] }],
        "scroll-m": [{ "scroll-m": O() }],
        "scroll-mx": [{ "scroll-mx": O() }],
        "scroll-my": [{ "scroll-my": O() }],
        "scroll-ms": [{ "scroll-ms": O() }],
        "scroll-me": [{ "scroll-me": O() }],
        "scroll-mt": [{ "scroll-mt": O() }],
        "scroll-mr": [{ "scroll-mr": O() }],
        "scroll-mb": [{ "scroll-mb": O() }],
        "scroll-ml": [{ "scroll-ml": O() }],
        "scroll-p": [{ "scroll-p": O() }],
        "scroll-px": [{ "scroll-px": O() }],
        "scroll-py": [{ "scroll-py": O() }],
        "scroll-ps": [{ "scroll-ps": O() }],
        "scroll-pe": [{ "scroll-pe": O() }],
        "scroll-pt": [{ "scroll-pt": O() }],
        "scroll-pr": [{ "scroll-pr": O() }],
        "scroll-pb": [{ "scroll-pb": O() }],
        "scroll-pl": [{ "scroll-pl": O() }],
        "snap-align": [{ snap: [`start`, `end`, `center`, `align-none`] }],
        "snap-stop": [{ snap: [`normal`, `always`] }],
        "snap-type": [{ snap: [`none`, `x`, `y`, `both`] }],
        "snap-strictness": [{ snap: [`mandatory`, `proximity`] }],
        touch: [{ touch: [`auto`, `none`, `manipulation`] }],
        "touch-x": [{ "touch-pan": [`x`, `left`, `right`] }],
        "touch-y": [{ "touch-pan": [`y`, `up`, `down`] }],
        "touch-pz": [`touch-pinch-zoom`],
        select: [{ select: [`none`, `text`, `all`, `auto`] }],
        "will-change": [
          { "will-change": [`auto`, `scroll`, `contents`, `transform`, Y] },
        ],
        fill: [{ fill: [e, `none`] }],
        "stroke-w": [{ stroke: [W, G, q] }],
        stroke: [{ stroke: [e, `none`] }],
        sr: [`sr-only`, `not-sr-only`],
        "forced-color-adjust": [{ "forced-color-adjust": [`auto`, `none`] }],
      },
      conflictingClassGroups: {
        overflow: [`overflow-x`, `overflow-y`],
        overscroll: [`overscroll-x`, `overscroll-y`],
        inset: [
          `inset-x`,
          `inset-y`,
          `start`,
          `end`,
          `top`,
          `right`,
          `bottom`,
          `left`,
        ],
        "inset-x": [`right`, `left`],
        "inset-y": [`top`, `bottom`],
        flex: [`basis`, `grow`, `shrink`],
        gap: [`gap-x`, `gap-y`],
        p: [`px`, `py`, `ps`, `pe`, `pt`, `pr`, `pb`, `pl`],
        px: [`pr`, `pl`],
        py: [`pt`, `pb`],
        m: [`mx`, `my`, `ms`, `me`, `mt`, `mr`, `mb`, `ml`],
        mx: [`mr`, `ml`],
        my: [`mt`, `mb`],
        size: [`w`, `h`],
        "font-size": [`leading`],
        "fvn-normal": [
          `fvn-ordinal`,
          `fvn-slashed-zero`,
          `fvn-figure`,
          `fvn-spacing`,
          `fvn-fraction`,
        ],
        "fvn-ordinal": [`fvn-normal`],
        "fvn-slashed-zero": [`fvn-normal`],
        "fvn-figure": [`fvn-normal`],
        "fvn-spacing": [`fvn-normal`],
        "fvn-fraction": [`fvn-normal`],
        "line-clamp": [`display`, `overflow`],
        rounded: [
          `rounded-s`,
          `rounded-e`,
          `rounded-t`,
          `rounded-r`,
          `rounded-b`,
          `rounded-l`,
          `rounded-ss`,
          `rounded-se`,
          `rounded-ee`,
          `rounded-es`,
          `rounded-tl`,
          `rounded-tr`,
          `rounded-br`,
          `rounded-bl`,
        ],
        "rounded-s": [`rounded-ss`, `rounded-es`],
        "rounded-e": [`rounded-se`, `rounded-ee`],
        "rounded-t": [`rounded-tl`, `rounded-tr`],
        "rounded-r": [`rounded-tr`, `rounded-br`],
        "rounded-b": [`rounded-br`, `rounded-bl`],
        "rounded-l": [`rounded-tl`, `rounded-bl`],
        "border-spacing": [`border-spacing-x`, `border-spacing-y`],
        "border-w": [
          `border-w-s`,
          `border-w-e`,
          `border-w-t`,
          `border-w-r`,
          `border-w-b`,
          `border-w-l`,
        ],
        "border-w-x": [`border-w-r`, `border-w-l`],
        "border-w-y": [`border-w-t`, `border-w-b`],
        "border-color": [
          `border-color-s`,
          `border-color-e`,
          `border-color-t`,
          `border-color-r`,
          `border-color-b`,
          `border-color-l`,
        ],
        "border-color-x": [`border-color-r`, `border-color-l`],
        "border-color-y": [`border-color-t`, `border-color-b`],
        "scroll-m": [
          `scroll-mx`,
          `scroll-my`,
          `scroll-ms`,
          `scroll-me`,
          `scroll-mt`,
          `scroll-mr`,
          `scroll-mb`,
          `scroll-ml`,
        ],
        "scroll-mx": [`scroll-mr`, `scroll-ml`],
        "scroll-my": [`scroll-mt`, `scroll-mb`],
        "scroll-p": [
          `scroll-px`,
          `scroll-py`,
          `scroll-ps`,
          `scroll-pe`,
          `scroll-pt`,
          `scroll-pr`,
          `scroll-pb`,
          `scroll-pl`,
        ],
        "scroll-px": [`scroll-pr`, `scroll-pl`],
        "scroll-py": [`scroll-pt`, `scroll-pb`],
        touch: [`touch-x`, `touch-y`, `touch-pz`],
        "touch-x": [`touch`],
        "touch-y": [`touch`],
        "touch-pz": [`touch`],
      },
      conflictingClassGroupModifiers: { "font-size": [`leading`] },
    };
  });
function et(...e) {
  return $e(z(e));
}
var $ = he(
    `inline-flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed`,
    {
      variants: {
        variant: {
          primary: `rounded-lg bg-primary text-primary-foreground border border-primary/20 hover:bg-primary/90 active:scale-[0.98]`,
          secondary: `rounded-lg border border-border hover:bg-primary/5 hover:border-primary/50 active:scale-[0.98]`,
          destructive: `rounded-lg bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.98]`,
          destructiveOutline: `rounded-lg border border-destructive/50 text-destructive hover:bg-destructive/10 active:scale-[0.98]`,
          ghost: `rounded-lg border border-transparent hover:bg-primary/10 hover:border-border active:scale-[0.95]`,
          link: `text-muted-foreground hover:text-foreground`,
        },
        size: {
          sm: `px-3 py-1.5 text-xs`,
          md: `px-5 py-2 text-sm`,
          lg: `px-5 py-3 text-base`,
          icon: `p-2`,
          none: ``,
        },
        fullWidth: { true: `w-full` },
      },
      defaultVariants: { variant: `secondary`, size: `md` },
    },
  ),
  tt = (0, b.forwardRef)(function (
    {
      className: e,
      variant: t,
      size: n,
      fullWidth: r,
      type: i = `button`,
      ...a
    },
    o,
  ) {
    return (0, x.jsx)(`button`, {
      ref: o,
      type: i,
      className: et($({ variant: t, size: n, fullWidth: r }), e),
      ...a,
    });
  });
export {
  m as _,
  pe as a,
  ce as c,
  C as d,
  T as f,
  g,
  v as h,
  fe as i,
  ie as l,
  E as m,
  $ as n,
  de as o,
  w as p,
  et as r,
  se as s,
  tt as t,
  j as u,
};
