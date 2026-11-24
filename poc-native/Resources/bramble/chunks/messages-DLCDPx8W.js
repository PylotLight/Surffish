function e(e) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(e) ? e : `https://${e}`;
}
function t(t) {
  try {
    let n = new URL(e(t.trim()));
    return n.protocol === `https:` || n.protocol === `http:` ? n.href : null;
  } catch {
    return null;
  }
}
var n = `bramble.sh`;
function r(e) {
  return (e.endsWith(`.`) ? e.slice(0, -1) : e).toLowerCase() === n;
}
var i = new Set([`androidapp:`, `android:`, `iosapp:`, `ios:`, `appid:`]);
function a(e) {
  try {
    return i.has(new URL(e).protocol.toLowerCase());
  } catch {
    return !1;
  }
}
function o(e) {
  if (!a(e)) return null;
  let t = new URL(e).hostname;
  return t.length > 0 ? t : null;
}
function s(t) {
  if (a(t)) return ``;
  try {
    return new URL(e(t)).hostname;
  } catch {
    return t;
  }
}
function c(e) {
  let t = [],
    n = [];
  for (let r of e) {
    let e = s(r);
    e.length !== 0 && (t.push(e), n.push(l(r)));
  }
  return n.some((e) => e !== ``)
    ? { hostnames: t, ports: n }
    : { hostnames: t };
}
function l(t) {
  try {
    return new URL(e(t)).port;
  } catch {
    return ``;
  }
}
function u(e) {
  if (!e) return;
  let t = e.filter((e) => e.value).map((e) => ({ key: e.key, value: e.value }));
  return t.length > 0 ? t : void 0;
}
function d(e) {
  let { hostnames: t, ports: n } = c(e.urls);
  return {
    type: `login`,
    id: e.id,
    hostnames: t,
    ports: n,
    name: e.name,
    username: e.username,
    password: e.password,
    totp: e.totp,
    customFields: u(e.customFields),
    autofillEnabled: e.autofillEnabled,
    autoSubmit: e.autoSubmit,
    subdomainMatch: e.subdomainMatch,
    passkeys: f(e),
  };
}
function f(e) {
  let t = e.passkeys?.filter((e) => !r(e.rpId));
  return t?.length ? t : void 0;
}
function p(e) {
  return {
    type: `card`,
    id: e.id,
    name: e.name,
    brand: e.brand,
    cardholderName: e.cardholderName,
    number: e.number,
    expMonth: e.expMonth,
    expYear: e.expYear,
    cvv: e.cvv,
    customFields: u(e.customFields),
  };
}
function m(e) {
  let t = [];
  for (let n of e)
    n.archivedAt === void 0 &&
      (n.type === `login`
        ? t.push(d(n))
        : n.type === `card`
          ? t.push(p(n))
          : n.type === `unlock-key` &&
            t.push({ type: `unlock-key`, id: n.id, passkey: n.passkey }));
  return t;
}
function h(e) {
  let t = Object.values(e).filter((e) => typeof e == `number`);
  return Object.entries(e)
    .filter(([e, n]) => t.indexOf(+e) === -1)
    .map(([e, t]) => t);
}
function ee(e, t = `|`) {
  return e.map((e) => Se(e)).join(t);
}
function te(e, t) {
  return typeof t == `bigint` ? t.toString() : t;
}
var ne = class {
  constructor(e) {
    ((this._getter = e), (this._value = void 0));
  }
  get value() {
    let e = this._getter;
    return (
      e !== void 0 && ((this._value = e()), (this._getter = void 0)),
      this._value
    );
  }
};
function re(e) {
  return new ne(e);
}
function ie(e) {
  return e == null;
}
function ae(e) {
  let t = +!!e.startsWith(`^`),
    n = e.endsWith(`$`) ? e.length - 1 : e.length;
  return e.slice(t, n);
}
function oe(e, t) {
  let n = e / t,
    r = Math.round(n),
    i = 4 * 2 ** -52 * Math.max(Math.abs(n), 1);
  return Math.abs(n - r) < i ? 0 : n - r;
}
function g(e, t, n) {
  Object.defineProperty(e, t, {
    value: n,
    writable: !0,
    enumerable: !0,
    configurable: !0,
  });
}
function se(e) {
  let t = Object.getOwnPropertyDescriptor(e, `shape`);
  return t?.get ? t.get.raw : t?.value;
}
function _(e) {
  return se(e._zod.def) ?? e._zod.def.shape;
}
function ce(e, t, n) {
  Object.defineProperty(e, t, {
    get() {
      let e = n();
      return (g(this, t, e), e);
    },
    enumerable: !0,
    configurable: !0,
  });
}
function le(e, t, n) {
  t in e ? g(e, t, n) : (e[t] = n);
}
function ue(e, t, n, r) {
  let i = _(t);
  for (let a of n) {
    let n = Object.getOwnPropertyDescriptor(i, a);
    n.enumerable &&
      (n.get
        ? ce(e, a, () => {
            let e = t._zod.def.shape[a];
            return r ? r(e, a) : e;
          })
        : le(e, a, r ? r(n.value, a) : n.value));
  }
}
function de(e, t) {
  for (let n of Reflect.ownKeys(t)) {
    let r = Object.getOwnPropertyDescriptor(t, n);
    r.enumerable && (r.get ? ce(e, n, () => t[n]) : le(e, n, r.value));
  }
}
function v(...e) {
  let t = {};
  for (let n of e) {
    let e = Object.getOwnPropertyDescriptors(n);
    Object.assign(t, e);
  }
  return Object.defineProperties({}, t);
}
function fe(e) {
  return JSON.stringify(e);
}
function pe(e) {
  return e
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, ``)
    .replace(/[\s_-]+/g, `-`)
    .replace(/^-+|-+$/g, ``);
}
var me = `captureStackTrace` in Error ? Error.captureStackTrace : (...e) => {};
function he(e) {
  return typeof e == `object` && !!e && !Array.isArray(e);
}
var ge = re(() => {
  if (
    C.jitless ||
    (typeof navigator < `u` && navigator?.userAgent?.includes(`Cloudflare`))
  )
    return !1;
  try {
    return (Function(``), !0);
  } catch {
    return !1;
  }
});
function _e(e) {
  if (he(e) === !1) return !1;
  let t = e.constructor;
  if (t === void 0 || typeof t != `function`) return !0;
  let n = t.prototype;
  return (
    he(n) !== !1 &&
    Object.prototype.hasOwnProperty.call(n, `isPrototypeOf`) !== !1
  );
}
function ve(e) {
  return _e(e)
    ? { ...e }
    : Array.isArray(e)
      ? [...e]
      : e instanceof Map
        ? new Map(e)
        : e instanceof Set
          ? new Set(e)
          : e;
}
var ye = new Set([`string`, `number`, `symbol`]);
function be(e) {
  return e.replace(/[.*+?^${}()|[\]\\]/g, `\\$&`);
}
function xe(e, t, n) {
  let r = new e._zod.constr(t ?? e._zod.def);
  return ((!t || n?.parent) && (r._zod.parent = e), r);
}
function y(e) {
  let t = e;
  if (!t) return {};
  if (typeof t == `string`) return { error: () => t };
  if (t?.message !== void 0) {
    if (t?.error !== void 0)
      throw Error("Cannot specify both `message` and `error` params");
    t.error = t.message;
  }
  return (
    delete t.message,
    typeof t.error == `string` ? { ...t, error: () => t.error } : t
  );
}
function Se(e) {
  return typeof e == `bigint`
    ? e.toString() + `n`
    : typeof e == `string`
      ? `"${e}"`
      : `${e}`;
}
function Ce(e) {
  return Object.keys(e).filter(
    (t) => e[t]._zod.optin !== void 0 && e[t]._zod.optout === `optional`,
  );
}
var we = {
    safeint: [-(2 ** 53 - 1), 2 ** 53 - 1],
    int32: [-2147483648, 2147483647],
    uint32: [0, 4294967295],
    float32: [-34028234663852886e22, 34028234663852886e22],
    float64: [-Number.MAX_VALUE, Number.MAX_VALUE],
  },
  Te = {
    int64: [BigInt(`-9223372036854775808`), BigInt(`9223372036854775807`)],
    uint64: [BigInt(0), BigInt(`18446744073709551615`)],
  };
function Ee(e, t) {
  let n = e._zod.def,
    r = n.checks;
  if (r && r.length > 0)
    throw Error(
      `.pick() cannot be used on object schemas containing refinements`,
    );
  let i = {};
  return (ue(i, e, De(e, t)), xe(e, v(n, { shape: i, checks: [] })));
}
function De(e, t) {
  let n = _(e),
    r = [];
  for (let e of Reflect.ownKeys(t)) {
    if (!Object.getOwnPropertyDescriptor(n, e)?.enumerable)
      throw Error(`Unrecognized key: "${String(e)}"`);
    t[e] && r.push(e);
  }
  return r;
}
function Oe(e, t) {
  let n = e._zod.def,
    r = n.checks;
  if (r && r.length > 0)
    throw Error(
      `.omit() cannot be used on object schemas containing refinements`,
    );
  let i = new Set(De(e, t)),
    a = {};
  return (
    ue(
      a,
      e,
      Reflect.ownKeys(_(e)).filter((e) => !i.has(e)),
    ),
    xe(e, v(n, { shape: a, checks: [] }))
  );
}
function ke(e, t) {
  if (!_e(t)) throw Error(`Invalid input to extend: expected a plain object`);
  let n = e._zod.def.checks;
  if (n && n.length > 0) {
    let n = _(e);
    for (let e of Reflect.ownKeys(t))
      if (Object.getOwnPropertyDescriptor(n, e) !== void 0)
        throw Error(
          "Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.",
        );
  }
  return xe(e, v(e._zod.def, { shape: Ae(e, t) }));
}
function Ae(e, t) {
  let n = {};
  return (ue(n, e, Reflect.ownKeys(_(e))), de(n, t), n);
}
function je(e, t) {
  if (!_e(t))
    throw Error(`Invalid input to safeExtend: expected a plain object`);
  return xe(e, v(e._zod.def, { shape: Ae(e, t) }));
}
function Me(e, t) {
  if (!t?._zod?.def)
    throw Error(
      "Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.",
    );
  if (e._zod.def.checks?.length)
    throw Error(
      `.merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.`,
    );
  let n = {};
  return (
    ue(n, e, Reflect.ownKeys(_(e))),
    ue(n, t, Reflect.ownKeys(_(t))),
    xe(
      e,
      v(e._zod.def, {
        shape: n,
        get catchall() {
          return t._zod.def.catchall;
        },
        checks: t._zod.def.checks ?? [],
      }),
    )
  );
}
function Ne(e, t, n, r = `partial`) {
  let i = t._zod.def.checks;
  if (i && i.length > 0)
    throw Error(
      `.${r}() cannot be used on object schemas containing refinements`,
    );
  let a = n ? new Set(De(t, n)) : void 0,
    o = {};
  return (
    ue(
      o,
      t,
      Reflect.ownKeys(_(t)),
      e &&
        ((t, n) =>
          a && !a.has(n) ? t : new e({ type: `optional`, innerType: t })),
    ),
    xe(t, v(t._zod.def, { shape: o, checks: [] }))
  );
}
function Pe(e, t, n) {
  let r = n ? new Set(De(t, n)) : void 0,
    i = {};
  return (
    ue(i, t, Reflect.ownKeys(_(t)), (t, n) =>
      r && !r.has(n) ? t : new e({ type: `nonoptional`, innerType: t }),
    ),
    xe(t, v(t._zod.def, { shape: i }))
  );
}
function b(e, t = 0) {
  if (e.aborted === !0) return !0;
  for (let n = t; n < e.issues.length; n++)
    if (e.issues[n]?.continue !== !0) return !0;
  return !1;
}
function Fe(e, t = 0) {
  if (e.aborted === !0) return !0;
  for (let n = t; n < e.issues.length; n++)
    if (e.issues[n]?.continue === !1) return !0;
  return !1;
}
function Ie(e, t) {
  return t.map((t) => {
    var n;
    return ((n = t).path ?? (n.path = []), t.path.unshift(e), t);
  });
}
function Le(e) {
  return typeof e == `string` ? e : e?.message;
}
function Re(e) {
  let t = [];
  for (let n of e ?? []) {
    let e = n._zod.def;
    if (!/_(length|size)$|_equals$/.test(e.check)) break;
    let r = e.maximum ?? e.length ?? e.size;
    r >= 0 && t.push([r, n]);
  }
  return t;
}
function ze(e, t, n) {
  var r;
  for (let i = t; i < e.length; i++) (r = e[i]).schema ?? (r.schema = n);
}
function Be(e, t, n) {
  var r;
  let i = e.inst?._zod?.traits;
  i?.has(`$ZodType`) &&
    (i.has(`$ZodCheck`)
      ? ((r = e).schema ?? (r.schema = e.inst))
      : (e.schema = e.inst));
  let a = e.schema === e.inst ? void 0 : e.schema?._zod.def?.error,
    o = e.message
      ? e.message
      : (Le(e.inst?._zod.def?.error?.(e)) ??
        Le(a?.(e)) ??
        Le(t?.error?.(e)) ??
        Le(n.customError?.(e)) ??
        Le(n.localeError?.(e)) ??
        `Invalid input`),
    s = {};
  for (let t of Object.keys(e))
    t !== `inst` &&
      t !== `schema` &&
      t !== `continue` &&
      t !== `input` &&
      t !== `__proto__` &&
      (s[t] = e[t]);
  return (
    (s.path ??= []),
    (s.message = o),
    t?.reportInput && (s.input = e.input),
    s
  );
}
var Ve = /[\uD800-\uDBFF]/;
function He(e) {
  let t = e.length;
  if (!Ve.test(e)) return t;
  let n = t;
  for (let r = 0; r < t - 1; r++)
    (e.charCodeAt(r) & 64512) == 55296 &&
      (e.charCodeAt(r + 1) & 64512) == 56320 &&
      (n--, r++);
  return n;
}
function Ue(e) {
  return Array.isArray(e)
    ? `array`
    : typeof e == `string`
      ? `string`
      : `unknown`;
}
function We(e) {
  let t = typeof e;
  switch (t) {
    case `number`:
      return Number.isNaN(e) ? `nan` : `number`;
    case `object`: {
      if (e === null) return `null`;
      if (Array.isArray(e)) return `array`;
      let t = e;
      if (
        t &&
        Object.getPrototypeOf(t) !== Object.prototype &&
        `constructor` in t &&
        t.constructor
      )
        return t.constructor.name;
    }
  }
  return t;
}
function Ge(...e) {
  let [t, n, r] = e;
  return typeof t == `string`
    ? { message: t, code: `custom`, input: n, inst: r }
    : { ...t };
}
function Ke(e, t) {
  for (let n in t) {
    let r = Object.getOwnPropertyDescriptor(t, n);
    r.get
      ? Object.defineProperty(e, n, { ...r, enumerable: !1 })
      : Xe(e, n, r.value);
  }
}
function qe(e, t, n, r = !0) {
  return (
    Object.defineProperty(e, t, {
      configurable: !0,
      writable: !0,
      enumerable: r,
      value: n,
    }),
    n
  );
}
function Je(e, t, n) {
  return qe(e, t, n, !1);
}
function Ye(e, t) {
  for (let n in e) {
    let r = e[n];
    Object.defineProperty(t, n, {
      configurable: !0,
      enumerable: !0,
      get() {
        return qe(this, n, r(this));
      },
      set(e) {
        qe(this, n, e);
      },
    });
  }
  return t;
}
function Xe(e, t, n) {
  Object.defineProperty(e, t, {
    configurable: !0,
    get() {
      return this == null ? n : qe(this, t, n.bind(this));
    },
    set(e) {
      qe(this, t, e);
    },
  });
}
function Ze(e, t) {
  let n = Object.getPrototypeOf(e);
  return t in n ? void 0 : n;
}
var Qe,
  $e = !1,
  et = {
    configurable: !0,
    get() {
      $e = !0;
    },
  };
function x(e, t, n) {
  let r = Object.getPrototypeOf(e._zod);
  t in r && Qe !== e._zod
    ? (Qe = void 0)
    : ((Qe = e._zod),
      Object.defineProperty(r, t, {
        configurable: !0,
        get() {
          Object.defineProperty(this, t, et);
          let e = $e;
          $e = !1;
          try {
            let r = n(this);
            return (
              $e
                ? delete this[t]
                : Object.defineProperty(this, t, {
                    configurable: !0,
                    writable: !0,
                    value: r,
                  }),
              ($e ||= e),
              r
            );
          } catch (n) {
            throw (delete this[t], ($e ||= e), n);
          }
        },
        set(e) {
          Object.defineProperty(this, t, {
            configurable: !0,
            writable: !0,
            value: e,
          });
        },
      }));
}
function tt(e, t, n, r) {
  let i = Ze(e, t);
  i &&
    Object.defineProperty(i, t, {
      configurable: !0,
      get() {
        let e = {
          configurable: !0,
          writable: !0,
          enumerable: r,
          value: void 0,
        };
        return (
          Object.defineProperty(this, t, e),
          (e.value = n(this)),
          Object.defineProperty(this, t, e),
          e.value
        );
      },
      set(e) {
        Object.defineProperty(this, t, {
          configurable: !0,
          writable: !0,
          enumerable: r,
          value: e,
        });
      },
    });
}
var nt = `~constantCatch`;
function rt(e) {
  let t = () => e;
  return ((t[nt] = !0), t);
}
var it,
  at = { value: void 0, enumerable: !1 },
  ot = `captureStackTrace` in Error ? Error : null;
function st(e) {
  let t = ot;
  if (t) {
    let n = t.stackTraceLimit;
    if (typeof n == `number`) {
      try {
        t.stackTraceLimit = 0;
      } catch {
        return ((ot = null), new e());
      }
      try {
        return new e();
      } finally {
        t.stackTraceLimit = n;
      }
    }
  }
  return new e();
}
function S(e, t, n, r) {
  let i = {};
  function a(e) {
    ((this.def = e), (this.constr = d), (this.traits = new Set()));
  }
  a.prototype = i;
  let o = n,
    s = o && new WeakSet();
  function c(n, r) {
    if (!n._zod) {
      at.value = new a(r);
      try {
        Object.defineProperty(n, "_zod", at);
      } finally {
        at.value = void 0;
      }
    } else if (n._zod.traits.has(e)) return;
    if ((n._zod.traits.add(e), t(n, r), s)) {
      let e = Object.getPrototypeOf(n),
        t = n._zod.constr.prototype,
        r = e;
      for (; r && r !== t;) r = Object.getPrototypeOf(r);
      let i = r ?? e;
      s.has(i) || (s.add(i), Ke(i, o));
    }
    let i = d.prototype;
    for (let e in i)
      Object.prototype.hasOwnProperty.call(i, e) &&
        (e in n || (n[e] = i[e].bind(n)));
  }
  let l = r?.Parent ?? Object;
  class u extends l {}
  Object.defineProperty(u, "name", { value: e });
  function d(e) {
    let t = r?.Parent ? st(u) : this;
    c(t, e);
    let n = t._zod.deferred;
    if (n) {
      for (let e of n) e();
      t._zod.deferred = void 0;
    }
    let i = globalThis.__zod_globalConfig?.postProcessor;
    return (i && i(t), t);
  }
  return (
    Object.defineProperty(d, "init", { value: c }),
    Object.defineProperty(d, Symbol.hasInstance, {
      value: (t) =>
        r?.Parent && t instanceof r.Parent ? !0 : t?._zod?.traits?.has(e),
    }),
    Object.defineProperty(d, "name", { value: e }),
    d
  );
}
var ct = class extends Error {
    constructor() {
      super(
        `Encountered Promise during synchronous parse. Use .parseAsync() instead.`,
      );
    }
  },
  lt = class extends Error {
    constructor(e) {
      (super(`Encountered unidirectional transform during encode: ${e}`),
        (this.name = `ZodEncodeError`));
    }
  };
(it = globalThis).__zod_globalConfig ?? (it.__zod_globalConfig = {});
var C = globalThis.__zod_globalConfig;
function w(e) {
  return (e && Object.assign(C, e), C);
}
function ut() {
  let e = this._zod;
  return ((e.message ??= JSON.stringify(e.def, te, 2)), e.message);
}
function dt(e) {
  this._zod.message = e;
}
var ft = { get: ut, set: dt, enumerable: !0, configurable: !0 },
  pt = { value: void 0, enumerable: !1 },
  mt = new WeakSet([Object.prototype, Error.prototype]),
  ht = S(`$ZodError`, (e, t) => {
    ((e.name = `$ZodError`),
      (pt.value = t),
      Object.defineProperty(e, "issues", pt),
      (pt.value = void 0),
      Object.defineProperty(e, "message", ft));
    let n = Object.getPrototypeOf(e);
    mt.has(n) ||
      (mt.add(n),
      Object.defineProperty(n, "toString", {
        configurable: !0,
        enumerable: !1,
        get() {
          let e = () => this.message;
          return (
            Object.defineProperty(this, "toString", {
              value: e,
              configurable: !0,
              writable: !0,
            }),
            e
          );
        },
        set(e) {
          Object.defineProperty(this, "toString", {
            value: e,
            configurable: !0,
            writable: !0,
          });
        },
      }));
  });
function gt(e, t, n) {
  return (
    Object.prototype.hasOwnProperty.call(e, t) ||
      (t === `__proto__`
        ? Object.defineProperty(e, t, {
            value: n(),
            writable: !0,
            enumerable: !0,
            configurable: !0,
          })
        : (e[t] = n())),
    e[t]
  );
}
function _t(e, t = (e) => e.message) {
  let n = {},
    r = [];
  for (let i of e.issues)
    i.path.length > 0 ? gt(n, i.path[0], () => []).push(t(i)) : r.push(t(i));
  return { formErrors: r, fieldErrors: n };
}
function vt(e, t = (e) => e.message) {
  let n = { _errors: [] },
    r = (e, i = []) => {
      for (let a of e.issues)
        if (a.code === `invalid_union` && a.errors.length)
          a.errors.map((e) => r({ issues: e }, [...i, ...a.path]));
        else if (a.code === `invalid_key`)
          r({ issues: a.issues }, [...i, ...a.path]);
        else if (a.code === `invalid_element`)
          r({ issues: a.issues }, [...i, ...a.path]);
        else {
          let e = [...i, ...a.path];
          if (e.length === 0) n._errors.push(t(a));
          else {
            let r = n,
              i = 0;
            for (; i < e.length;) {
              let n = e[i],
                o = i === e.length - 1;
              if (n === `_errors`) {
                (o && r._errors.push(t(a)), i++);
                continue;
              }
              Object.prototype.hasOwnProperty.call(r, n) ||
                Object.defineProperty(r, n, {
                  value: { _errors: [] },
                  enumerable: !0,
                  writable: !0,
                  configurable: !0,
                });
              let s = r[n];
              (o && s._errors.push(t(a)), (r = s), i++);
            }
          }
        }
    };
  return (r(e), n);
}
function yt(e, t) {
  return { callee: t?.callee ?? e, Err: t?.Err };
}
var bt = (e) => {
    let t = (n, r, i, a) => {
      let o = i ? { ...i, async: !1 } : { async: !1 },
        s = n._zod.run({ value: r, issues: [] }, o);
      if (s instanceof Promise) throw new ct();
      if (s.issues.length) {
        let n = new (a?.Err ?? e)(s.issues.map((e) => Be(e, o, w())));
        throw (me(n, a?.callee ?? t), n);
      }
      return s.value;
    };
    return t;
  },
  xt = (e) => {
    let t = async (n, r, i, a) => {
      let o = i ? { ...i, async: !0 } : { async: !0 },
        s = n._zod.run({ value: r, issues: [] }, o);
      if ((s instanceof Promise && (s = await s), s.issues.length)) {
        let n = new (a?.Err ?? e)(s.issues.map((e) => Be(e, o, w())));
        throw (me(n, a?.callee ?? t), n);
      }
      return s.value;
    };
    return t;
  },
  St = (e) => (t, n, r) => {
    let i = r ? { ...r, async: !1 } : { async: !1 },
      a = t._zod.run({ value: n, issues: [] }, i);
    if (a instanceof Promise) throw new ct();
    return a.issues.length
      ? Ct(e, a.issues, i)
      : { success: !0, data: a.value };
  };
function Ct(e, t, n) {
  let r;
  return {
    success: !1,
    get error() {
      return (
        r ||
          ((r = new e(t.map((e) => Be(e, n, w())))),
          (t = void 0),
          (n = void 0)),
        r
      );
    },
    set error(e) {
      ((r = e), (t = void 0), (n = void 0));
    },
  };
}
var wt = (e) => async (t, n, r) => {
    let i = r ? { ...r, async: !0 } : { async: !0 },
      a = t._zod.run({ value: n, issues: [] }, i);
    return (
      a instanceof Promise && (a = await a),
      a.issues.length ? Ct(e, a.issues, i) : { success: !0, data: a.value }
    );
  },
  Tt = Symbol.for(`zod.compile.invalid`),
  Et = Symbol.for(`zod.compile.fallback`),
  Dt = (e, t, n) => {
    let r = e._zod.bag.validator;
    if (r !== void 0) {
      if (r(t) !== Tt) return !0;
      if (r.definite === !0 && n === void 0) return !1;
    }
    return Ot(e, t, n);
  };
function Ot(e, t, n) {
  let r = n
      ? { ...n, async: !1, abortEarly: !0 }
      : { async: !1, abortEarly: !0 },
    i = e._zod.bag.fallbackRun,
    a;
  if (
    (i
      ? ((r[Et] = !0), (a = i({ value: t, issues: [] }, r)))
      : (a = e._zod.run({ value: t, issues: [] }, r)),
    a instanceof Promise)
  )
    throw new ct();
  return a.issues.length === 0;
}
var kt = async (e, t, n) => {
    let r = n
        ? { ...n, async: !0, abortEarly: !0 }
        : { async: !0, abortEarly: !0 },
      i = e._zod.run({ value: t, issues: [] }, r);
    return (i instanceof Promise && (i = await i), i.issues.length === 0);
  },
  At = (e) => {
    let t = bt(e),
      n = (e, r, i, a) => {
        let o = i ? { ...i, direction: `backward` } : { direction: `backward` };
        return t(e, r, o, yt(n, a));
      };
    return n;
  },
  jt = (e) => {
    let t = bt(e),
      n = (e, r, i, a) => t(e, r, i, yt(n, a));
    return n;
  },
  Mt = (e) => {
    let t = xt(e),
      n = async (e, r, i, a) => {
        let o = i ? { ...i, direction: `backward` } : { direction: `backward` };
        return await t(e, r, o, yt(n, a));
      };
    return n;
  },
  Nt = (e) => {
    let t = xt(e),
      n = async (e, r, i, a) => await t(e, r, i, yt(n, a));
    return n;
  },
  Pt = (e) => (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` };
    return St(e)(t, n, i);
  },
  Ft = (e) => (t, n, r) => St(e)(t, n, r),
  It = (e) => async (t, n, r) => {
    let i = r ? { ...r, direction: `backward` } : { direction: `backward` };
    return wt(e)(t, n, i);
  },
  Lt = (e) => async (t, n, r) => wt(e)(t, n, r),
  Rt = /^[cC][0-9a-z]{6,}$/,
  zt = /^[0-9a-z]+$/,
  Bt = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/,
  Vt = /^[0-9a-vA-V]{20}$/,
  Ht = /^[A-Za-z0-9]{27}$/,
  Ut = /^[a-zA-Z0-9_-]{21}$/;
function Wt(e) {
  return RegExp(`^[a-zA-Z0-9_-]{${e}}$`);
}
var Gt =
    /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/,
  Kt =
    /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/,
  qt = (e) =>
    e
      ? RegExp(
          `^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`,
        )
      : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/,
  Jt =
    /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/,
  Yt = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function Xt() {
  return new RegExp(Yt, `u`);
}
var Zt =
    /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/,
  Qt =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/,
  $t =
    /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/,
  en =
    /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/,
  tn =
    /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/,
  nn = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/,
  rn = /^https?$/,
  an = /^\+[1-9]\d{6,14}$/,
  on = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
function sn(e) {
  return RegExp(`^${e}$`);
}
var cn = sn(on);
function ln(e) {
  let t = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  return typeof e.precision == `number`
    ? e.precision === -1
      ? `${t}`
      : e.precision === 0
        ? `${t}:[0-5]\\d`
        : `${t}:[0-5]\\d\\.\\d{${e.precision}}`
    : e.seconds
      ? `${t}:[0-5]\\d(?:\\.\\d+)?`
      : `${t}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function un(e) {
  return RegExp(`^${ln(e)}$`);
}
function dn(e) {
  let t = [`Z`];
  e.offset && t.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  let n = `${ln({ precision: e.precision, seconds: !0 })}(?:${t.join(`|`)})`,
    r = e.local ? `${n}|${ln({ precision: e.precision })}` : n;
  return RegExp(`^${on}T(?:${r})$`);
}
var fn = /^[\s\S]{0,}$/,
  pn = /^-?\d+$/,
  mn = /^-?\d+(?:\.\d+)?$/,
  hn = /^(?:true|false)$/i,
  gn = /^[^A-Z]*$/,
  _n = /^[^a-z]*$/,
  T = S(`$ZodCheck`, (e, t) => {
    var n;
    ((e._zod ??= {}),
      (e._zod.def = t),
      (n = e._zod).onattach ?? (n.onattach = []));
  }),
  vn = (e) => {
    let t = e.value;
    return !ie(t) && t.length !== void 0;
  },
  yn = { number: `number`, bigint: `bigint`, object: `date` },
  bn = S(`$ZodCheckLessThan`, (e, t) => {
    T.init(e, t);
    let n = yn[typeof t.value];
    e._zod.check = (r) => {
      (t.inclusive ? r.value <= t.value : r.value < t.value) ||
        r.issues.push({
          origin: yn[typeof r.value] ?? n,
          code: `too_big`,
          maximum: typeof t.value == `object` ? t.value.getTime() : t.value,
          input: r.value,
          inclusive: t.inclusive,
          inst: e,
          continue: !t.abort,
        });
    };
  }),
  xn = S(`$ZodCheckGreaterThan`, (e, t) => {
    T.init(e, t);
    let n = yn[typeof t.value];
    e._zod.check = (r) => {
      (t.inclusive ? r.value >= t.value : r.value > t.value) ||
        r.issues.push({
          origin: yn[typeof r.value] ?? n,
          code: `too_small`,
          minimum: typeof t.value == `object` ? t.value.getTime() : t.value,
          input: r.value,
          inclusive: t.inclusive,
          inst: e,
          continue: !t.abort,
        });
    };
  }),
  Sn = S(`$ZodCheckMultipleOf`, (e, t) => {
    (T.init(e, t),
      (e._zod.check = (n) => {
        if (typeof n.value != typeof t.value)
          throw Error(`Cannot mix number and bigint in multiple_of check.`);
        (typeof n.value == `bigint`
          ? t.value !== BigInt(0) && n.value % t.value === BigInt(0)
          : oe(n.value, t.value) === 0) ||
          n.issues.push({
            origin: typeof n.value,
            code: `not_multiple_of`,
            divisor: t.value,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  Cn = S(`$ZodCheckNumberFormat`, (e, t) => {
    (T.init(e, t), (t.format = t.format || `float64`));
    let n = t.format?.includes(`int`),
      r = n ? `int` : `number`,
      [i, a] = we[t.format];
    e._zod.check = (o) => {
      let s = o.value;
      if (n) {
        if (!Number.isInteger(s)) {
          o.issues.push({
            expected: r,
            format: t.format,
            code: `invalid_type`,
            continue: !1,
            input: s,
            inst: e,
          });
          return;
        }
        if (!Number.isSafeInteger(s)) {
          s > 0
            ? o.issues.push({
                input: s,
                code: `too_big`,
                maximum: 2 ** 53 - 1,
                note: `Integers must be within the safe integer range.`,
                inst: e,
                origin: r,
                inclusive: !0,
                continue: !t.abort,
              })
            : o.issues.push({
                input: s,
                code: `too_small`,
                minimum: -(2 ** 53 - 1),
                note: `Integers must be within the safe integer range.`,
                inst: e,
                origin: r,
                inclusive: !0,
                continue: !t.abort,
              });
          return;
        }
      }
      (s < i &&
        o.issues.push({
          origin: `number`,
          input: s,
          code: `too_small`,
          minimum: i,
          inclusive: !0,
          inst: e,
          continue: !t.abort,
        }),
        s > a &&
          o.issues.push({
            origin: `number`,
            input: s,
            code: `too_big`,
            maximum: a,
            inclusive: !0,
            inst: e,
            continue: !t.abort,
          }));
    };
  }),
  wn = S(`$ZodCheckMaxLength`, (e, t) => {
    var n;
    (T.init(e, t),
      (n = e._zod.def).when ?? (n.when = vn),
      (e._zod.check = (n) => {
        let r = n.value,
          i = r.length;
        if ((typeof r == `string` && i > t.maximum ? He(r) : i) <= t.maximum)
          return;
        let a = Ue(r);
        n.issues.push({
          origin: a,
          code: `too_big`,
          maximum: t.maximum,
          inclusive: !0,
          input: r,
          inst: e,
          continue: !t.abort,
        });
      }));
  }),
  Tn = S(`$ZodCheckMinLength`, (e, t) => {
    var n;
    (T.init(e, t),
      (n = e._zod.def).when ?? (n.when = vn),
      (e._zod.check = (n) => {
        let r = n.value,
          i = r.length;
        if (
          (typeof r == `string` && i >= t.minimum && i < t.minimum * 2
            ? He(r)
            : i) >= t.minimum
        )
          return;
        let a = Ue(r);
        n.issues.push({
          origin: a,
          code: `too_small`,
          minimum: t.minimum,
          inclusive: !0,
          input: r,
          inst: e,
          continue: !t.abort,
        });
      }));
  }),
  En = S(`$ZodCheckLengthEquals`, (e, t) => {
    var n;
    (T.init(e, t),
      (n = e._zod.def).when ?? (n.when = vn),
      (e._zod.check = (n) => {
        let r = n.value,
          i = r.length,
          a =
            typeof r == `string` && i >= t.length && i <= t.length * 2
              ? He(r)
              : i;
        if (a === t.length) return;
        let o = Ue(r),
          s = a > t.length;
        n.issues.push({
          origin: o,
          ...(s
            ? { code: `too_big`, maximum: t.length }
            : { code: `too_small`, minimum: t.length }),
          inclusive: !0,
          exact: !0,
          input: n.value,
          inst: e,
          continue: !t.abort,
        });
      }));
  }),
  Dn = S(`$ZodCheckStringFormat`, (e, t) => {
    var n, r;
    (T.init(e, t),
      t.pattern
        ? ((n = e._zod).check ??
          (n.check = (n) => {
            ((t.pattern.lastIndex = 0),
              !t.pattern.test(n.value) &&
                n.issues.push({
                  origin: `string`,
                  code: `invalid_format`,
                  format: t.format,
                  input: n.value,
                  ...(t.pattern ? { pattern: t.pattern.toString() } : {}),
                  inst: e,
                  continue: !t.abort,
                }));
          }))
        : ((r = e._zod).check ?? (r.check = () => {})));
  }),
  On = S(`$ZodCheckRegex`, (e, t) => {
    (Dn.init(e, t),
      (e._zod.check = (n) => {
        ((t.pattern.lastIndex = 0),
          !t.pattern.test(n.value) &&
            n.issues.push({
              origin: `string`,
              code: `invalid_format`,
              format: `regex`,
              input: n.value,
              pattern: t.pattern.toString(),
              inst: e,
              continue: !t.abort,
            }));
      }));
  }),
  kn = S(`$ZodCheckLowerCase`, (e, t) => {
    ((t.pattern ??= gn), Dn.init(e, t));
  }),
  An = S(`$ZodCheckUpperCase`, (e, t) => {
    ((t.pattern ??= _n), Dn.init(e, t));
  }),
  jn = S(`$ZodCheckIncludes`, (e, t) => {
    T.init(e, t);
    let n = be(t.includes);
    ((t.pattern = new RegExp(
      typeof t.position == `number` ? `^.{${t.position},}${n}` : n,
    )),
      (e._zod.check = (n) => {
        n.value.includes(t.includes, t.position) ||
          n.issues.push({
            origin: `string`,
            code: `invalid_format`,
            format: `includes`,
            includes: t.includes,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  Mn = S(`$ZodCheckStartsWith`, (e, t) => {
    T.init(e, t);
    let n = RegExp(`^${be(t.prefix)}.*`);
    ((t.pattern ??= n),
      (e._zod.check = (n) => {
        n.value.startsWith(t.prefix) ||
          n.issues.push({
            origin: `string`,
            code: `invalid_format`,
            format: `starts_with`,
            prefix: t.prefix,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  Nn = S(`$ZodCheckEndsWith`, (e, t) => {
    T.init(e, t);
    let n = RegExp(`.*${be(t.suffix)}$`);
    ((t.pattern ??= n),
      (e._zod.check = (n) => {
        n.value.endsWith(t.suffix) ||
          n.issues.push({
            origin: `string`,
            code: `invalid_format`,
            format: `ends_with`,
            suffix: t.suffix,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  Pn = S(`$ZodCheckOverwrite`, (e, t) => {
    (T.init(e, t),
      (e._zod.check = (e) => {
        e.value = t.tx(e.value);
      }));
  }),
  Fn = class {
    constructor(e = [], t = {}) {
      ((this.content = []),
        (this.indent = 0),
        (this.args = e),
        (this.closed = t));
    }
    indented(e) {
      this.indent += 1;
      try {
        e(this);
      } finally {
        --this.indent;
      }
    }
    write(e) {
      if (typeof e == `function`) {
        (e(this, { execution: `sync` }), e(this, { execution: `async` }));
        return;
      }
      let t = e
          .split(
            `
`,
          )
          .filter((e) => e),
        n = Math.min(...t.map((e) => e.length - e.trimStart().length)),
        r = t
          .map((e) => e.slice(n))
          .map((e) => ` `.repeat(this.indent * 2) + e);
      for (let e of r) this.content.push(e);
    }
    compile() {
      let e = Function,
        t = this?.content ?? [``];
      return new e(
        ...Object.keys(this.closed),
        `return function (${this.args.join(`, `)}) {\n${t.join(`
`)}\n};`,
      )(...Object.values(this.closed));
    }
  },
  In = { major: 4, minor: 6, patch: 7 },
  E = S(
    `$ZodType`,
    (e, t) => {
      var n;
      ((e ??= {}),
        (e._zod.def = t),
        (e._zod.bag = e._zod.bag || {}),
        (e._zod.version = In));
      let r = e._zod.def.checks,
        i = e._zod.traits.has(`$ZodCheck`)
          ? [e, ...(r ?? [])]
          : r?.length
            ? [...r]
            : [];
      for (let t of i) for (let n of t._zod.onattach) n(e);
      if (i.length === 0)
        ((n = e._zod).deferred ?? (n.deferred = []),
          e._zod.deferred?.push(() => {
            e._zod.run = e._zod.parse;
          }));
      else {
        let t = (t, n, r) => {
            if (t.memo) return t;
            let i = b(t),
              a;
            for (let o of n) {
              if (o._zod.def.when) {
                if (Fe(t) || !o._zod.def.when(t)) continue;
              } else if (i) continue;
              let n = t.issues.length,
                s = o._zod.check(t);
              if (s instanceof Promise && r?.async === !1) throw new ct();
              if (a || s instanceof Promise)
                a = (a ?? Promise.resolve()).then(async () => {
                  (await s,
                    t.issues.length !== n &&
                      (ze(t.issues, n, e), (i ||= b(t, n))));
                });
              else {
                if (t.issues.length === n) continue;
                (ze(t.issues, n, e), (i ||= b(t, n)));
              }
            }
            return a ? a.then(() => t) : t;
          },
          n = (n, r, a) => {
            if (b(n)) return ((n.aborted = !0), n);
            let o = t(r, i, a);
            if (o instanceof Promise) {
              if (a.async === !1) throw new ct();
              return o.then((t) => e._zod.parse(t, a));
            }
            return e._zod.parse(o, a);
          };
        e._zod.run = (r, a) => {
          if (a.skipChecks) return e._zod.parse(r, a);
          if (a.direction === `backward`) {
            let t = e._zod.parse(
              { value: r.value, issues: [] },
              { ...a, skipChecks: !0 },
            );
            return t instanceof Promise
              ? t.then((e) => n(e, r, a))
              : n(t, r, a);
          }
          let o = e._zod.parse(r, a);
          if (o instanceof Promise) {
            if (a.async === !1) throw new ct();
            return o.then((e) => t(e, i, a));
          }
          return t(o, i, a);
        };
      }
    },
    {
      get "~standard"() {
        return Je(this, `~standard`, zn(this));
      },
      set "~standard"(e) {
        qe(this, `~standard`, e);
      },
    },
  ),
  Ln = (e, t) =>
    e.issues.length
      ? { issues: e.issues.map((e) => Be(e, t, w())) }
      : { value: e.value };
async function Rn(e, t) {
  let n = { async: !0 };
  return Ln(await e._zod.run({ value: t, issues: [] }, n), n);
}
function zn(e) {
  return {
    validate: (t) => {
      let n = { async: !1 };
      try {
        let r = e._zod.run({ value: t, issues: [] }, n);
        if (!(r instanceof Promise)) return Ln(r, n);
      } catch {}
      return Rn(e, t);
    },
    vendor: `zod`,
    version: 1,
  };
}
var Bn = S(`$ZodString`, (e, t) => {
    (E.init(e, t),
      (e._zod.pattern = t.pattern ?? fn),
      (e._zod.parse = (n, r) => {
        if (t.coerce)
          try {
            n.value = String(n.value);
          } catch {}
        return (
          typeof n.value == `string` ||
            n.issues.push({
              expected: `string`,
              code: `invalid_type`,
              input: n.value,
              inst: e,
            }),
          n
        );
      }));
  }),
  D = S(`$ZodStringFormat`, (e, t) => {
    (Dn.init(e, t), Bn.init(e, t));
  }),
  Vn = S(`$ZodGUID`, (e, t) => {
    ((t.pattern ??= Kt), D.init(e, t));
  }),
  Hn = S(`$ZodUUID`, (e, t) => {
    if (t.version) {
      let e = { v1: 1, v2: 2, v3: 3, v4: 4, v5: 5, v6: 6, v7: 7, v8: 8 }[
        t.version
      ];
      if (e === void 0) throw Error(`Invalid UUID version: "${t.version}"`);
      t.pattern ??= qt(e);
    } else t.pattern ??= qt();
    D.init(e, t);
  }),
  Un = S(`$ZodEmail`, (e, t) => {
    ((t.pattern ??= Jt), D.init(e, t));
  });
function Wn(e) {
  try {
    return typeof URL < `u` && typeof URL.canParse == `function`
      ? URL.canParse(e)
      : (new URL(e), !0);
  } catch {
    return !1;
  }
}
function Gn(e, t) {
  return !(`normalize` in t) && !(`hostname` in t) && !(`protocol` in t)
    ? Wn(e) || 2
    : Kn(e, t);
}
function Kn(e, t) {
  if (
    !t.normalize &&
    t.protocol?.source === rn.source &&
    !/^https?:\/\//i.test(e)
  )
    return 1;
  try {
    if (typeof URL < `u`) {
      let t = URL;
      if (typeof t.parse == `function`) return t.parse(e) ?? 2;
    }
    return new URL(e);
  } catch {
    return 2;
  }
}
var qn = /[\t\n\r]/g;
function Jn(e) {
  return e.replace(qn, ``);
}
function Yn(e, t) {
  return ((t.lastIndex = 0), t.test(e.hostname));
}
function Xn(e, t) {
  return (
    (t.lastIndex = 0),
    t.test(e.protocol.endsWith(`:`) ? e.protocol.slice(0, -1) : e.protocol)
  );
}
var Zn = S(`$ZodURL`, (e, t) => {
    (D.init(e, t),
      (e._zod.check = (n) => {
        try {
          let r = n.value.trim(),
            i = Gn(r, t);
          if (i === 1) {
            n.issues.push({
              code: `invalid_format`,
              format: `url`,
              note: `Invalid URL format`,
              input: n.value,
              inst: e,
              continue: !t.abort,
            });
            return;
          }
          if (i === 2) {
            n.issues.push({
              code: `invalid_format`,
              format: `url`,
              input: n.value,
              inst: e,
              continue: !t.abort,
            });
            return;
          }
          if (i === !0) {
            n.value = Jn(r);
            return;
          }
          (t.hostname &&
            !Yn(i, t.hostname) &&
            n.issues.push({
              code: `invalid_format`,
              format: `url`,
              note: `Invalid hostname`,
              pattern: t.hostname.source,
              input: n.value,
              inst: e,
              continue: !t.abort,
            }),
            t.protocol &&
              !Xn(i, t.protocol) &&
              n.issues.push({
                code: `invalid_format`,
                format: `url`,
                note: `Invalid protocol`,
                pattern: t.protocol.source,
                input: n.value,
                inst: e,
                continue: !t.abort,
              }),
            (n.value = t.normalize ? i.href : Jn(r)));
          return;
        } catch {
          n.issues.push({
            code: `invalid_format`,
            format: `url`,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
        }
      }));
  }),
  Qn = S(`$ZodEmoji`, (e, t) => {
    ((t.pattern ??= Xt()), D.init(e, t));
  }),
  $n = S(`$ZodNanoID`, (e, t) => {
    if (t.length !== void 0 && (!Number.isInteger(t.length) || t.length < 1))
      throw Error(`Invalid nanoid length: ${t.length}`);
    ((t.pattern ??= t.length === void 0 ? Ut : Wt(t.length)), D.init(e, t));
  }),
  er = S(`$ZodCUID`, (e, t) => {
    ((t.pattern ??= Rt), D.init(e, t));
  }),
  tr = S(`$ZodCUID2`, (e, t) => {
    ((t.pattern ??= zt), D.init(e, t));
  }),
  nr = S(`$ZodULID`, (e, t) => {
    ((t.pattern ??= Bt), D.init(e, t));
  }),
  rr = S(`$ZodXID`, (e, t) => {
    ((t.pattern ??= Vt), D.init(e, t));
  }),
  ir = S(`$ZodKSUID`, (e, t) => {
    ((t.pattern ??= Ht), D.init(e, t));
  }),
  ar = S(`$ZodISODateTime`, (e, t) => {
    ((t.pattern ??= dn(t)), D.init(e, t));
  }),
  or = S(`$ZodISODate`, (e, t) => {
    ((t.pattern ??= cn), D.init(e, t));
  }),
  sr = S(`$ZodISOTime`, (e, t) => {
    ((t.pattern ??= un(t)), D.init(e, t));
  }),
  cr = S(`$ZodISODuration`, (e, t) => {
    ((t.pattern ??= Gt), D.init(e, t));
  }),
  lr = S(`$ZodIPv4`, (e, t) => {
    ((t.pattern ??= Zt), D.init(e, t));
  }),
  ur = /^[0-9a-fA-F:.]+$/;
function dr(e) {
  return ur.test(e) ? Wn(`http://[${e}]`) : !1;
}
var fr = S(`$ZodIPv6`, (e, t) => {
    ((t.pattern ??= Qt),
      D.init(e, t),
      (e._zod.check = (n) => {
        dr(n.value) ||
          n.issues.push({
            code: `invalid_format`,
            format: `ipv6`,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  pr = S(`$ZodCIDRv4`, (e, t) => {
    ((t.pattern ??= $t), D.init(e, t));
  });
function mr(e) {
  let t = e.split(`/`);
  if (t.length !== 2) return !1;
  let [n, r] = t;
  if (!r) return !1;
  let i = Number(r);
  return `${i}` !== r || i < 0 || i > 128 ? !1 : dr(n);
}
var hr = S(`$ZodCIDRv6`, (e, t) => {
  ((t.pattern ??= en),
    D.init(e, t),
    (e._zod.check = (n) => {
      mr(n.value) ||
        n.issues.push({
          code: `invalid_format`,
          format: `cidrv6`,
          input: n.value,
          inst: e,
          continue: !t.abort,
        });
    }));
});
function gr(e) {
  if (e === ``) return !0;
  if (/\s/.test(e) || e.length % 4 != 0) return !1;
  try {
    return (atob(e), !0);
  } catch {
    return !1;
  }
}
var _r = /^[0-9a-zA-Z+/]*={0,2}$/,
  vr = S(`$ZodBase64`, (e, t) => {
    ((t.pattern ??= _r),
      D.init(e, t),
      (e._zod.check = (n) => {
        gr(n.value) ||
          n.issues.push({
            code: `invalid_format`,
            format: `base64`,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  yr = /^[A-Za-z0-9_-]*$/;
function br(e) {
  if (!yr.test(e)) return !1;
  let t = e.replace(/[-_]/g, (e) => (e === `-` ? `+` : `/`));
  return gr(t.padEnd(Math.ceil(t.length / 4) * 4, `=`));
}
var xr = S(`$ZodBase64URL`, (e, t) => {
    ((t.pattern ??= yr),
      D.init(e, t),
      (e._zod.check = (n) => {
        br(n.value) ||
          n.issues.push({
            code: `invalid_format`,
            format: `base64url`,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  Sr = S(`$ZodE164`, (e, t) => {
    ((t.pattern ??= an), D.init(e, t));
  });
function Cr(e, t = null) {
  try {
    let n = e.split(`.`);
    if (n.length !== 3) return !1;
    let [r] = n;
    if (!r) return !1;
    let i = JSON.parse(atob(r));
    return !(
      (`typ` in i && i?.typ !== `JWT`) ||
      !i.alg ||
      (t && (!(`alg` in i) || i.alg !== t))
    );
  } catch {
    return !1;
  }
}
var wr = S(`$ZodJWT`, (e, t) => {
    (D.init(e, t),
      (e._zod.check = (n) => {
        Cr(n.value, t.alg) ||
          n.issues.push({
            code: `invalid_format`,
            format: `jwt`,
            input: n.value,
            inst: e,
            continue: !t.abort,
          });
      }));
  }),
  Tr = S(`$ZodNumber`, (e, t) => {
    (E.init(e, t),
      (e._zod.pattern = mn),
      (e._zod.parse = (n, r) => {
        if (t.coerce)
          try {
            n.value = Number(n.value);
          } catch {}
        let i = n.value;
        if (typeof i == `number` && !Number.isNaN(i) && Number.isFinite(i))
          return n;
        let a =
          typeof i == `number`
            ? Number.isNaN(i)
              ? `NaN`
              : Number.isFinite(i)
                ? void 0
                : String(i)
            : void 0;
        return (
          n.issues.push({
            expected: `number`,
            code: `invalid_type`,
            input: i,
            inst: e,
            ...(a ? { received: a } : {}),
          }),
          n
        );
      }));
  }),
  Er = S(`$ZodNumberFormat`, (e, t) => {
    (Cn.init(e, t), Tr.init(e, t));
  }),
  Dr = S(`$ZodBoolean`, (e, t) => {
    (E.init(e, t),
      (e._zod.pattern = hn),
      (e._zod.parse = (n, r) => {
        if (t.coerce)
          try {
            n.value = !!n.value;
          } catch {}
        let i = n.value;
        return (
          typeof i == `boolean` ||
            n.issues.push({
              expected: `boolean`,
              code: `invalid_type`,
              input: i,
              inst: e,
            }),
          n
        );
      }));
  }),
  Or = S(`$ZodUnknown`, (e, t) => {
    (E.init(e, t), (e._zod.parse = (e) => e));
  }),
  kr = S(`$ZodNever`, (e, t) => {
    (E.init(e, t),
      (e._zod.parse = (t, n) => (
        t.issues.push({
          expected: `never`,
          code: `invalid_type`,
          input: t.value,
          inst: e,
        }),
        t
      )));
  });
function Ar(e, t) {
  let n = Re(e._zod.def.checks);
  if (!n.length) return;
  let r = Math.min(...n.map((e) => e[0])),
    i = e._zod.parse;
  e._zod.parse = (n, a) => {
    let o = t(n.value);
    if (o > r && !a?.skipChecks && a?.direction !== `backward`) {
      for (let [t, r] of Re(e._zod.def.checks))
        if (o > t && r._zod.def.when(n)) {
          let t = n.issues.length;
          return (
            r._zod.check(n),
            (n.issues[t].continue = !1),
            ze(n.issues, t, e),
            n
          );
        }
    }
    return i(n, a);
  };
}
var jr = (e) => (Array.isArray(e) ? e.length : -1);
function Mr(e, t, n) {
  (e.issues.length && t.issues.push(...Ie(n, e.issues)),
    (t.value[n] = e.value));
}
var Nr = S(`$ZodArray`, (e, t) => {
  E.init(e, t);
  let n = C.memoizer;
  (n?.attach(e),
    (e._zod.parse = (r, i) => {
      let a = r.value;
      if (!Array.isArray(a))
        return (
          r.issues.push({
            expected: `array`,
            code: `invalid_type`,
            input: a,
            inst: e,
          }),
          r
        );
      r.value = n ? n.alloc(e, r, Array(a.length), i) : Array(a.length);
      let o = [],
        s = i?.abortEarly;
      for (let e = 0; e < a.length; e++) {
        let n = a[e],
          c = t.element._zod.run({ value: n, issues: [] }, i);
        if (c instanceof Promise) o.push(c.then((t) => Mr(t, r, e)));
        else if ((Mr(c, r, e), s && c.issues.length !== 0 && b(c))) break;
      }
      return o.length ? Promise.all(o).then(() => r) : r;
    }),
    Ar(e, jr));
});
function Pr(e, t, n, r, i, a) {
  let o = n in r,
    s = a === `optional`;
  if (o || !s || i !== `optional`) {
    if (e.issues.length) {
      if (i !== void 0 && s && !o) return;
      t.issues.push(...Ie(n, e.issues));
    }
    !o && i === void 0
      ? e.issues.length ||
        t.issues.push({
          code: `invalid_type`,
          expected: `nonoptional`,
          input: void 0,
          path: [n],
        })
      : e.value === void 0
        ? (o || (i === `defaulted` && !s)) && (t.value[n] = void 0)
        : (t.value[n] = e.value);
  }
}
var Fr = [];
function Ir(e) {
  let t = Object.keys(e.shape),
    n = Object.getOwnPropertySymbols(e.shape),
    r = n.length ? n : Fr,
    i = r.length ? [...t, ...r] : t;
  for (let t of i)
    if (!e.shape?.[t]?._zod?.traits?.has(`$ZodType`))
      throw Error(
        `Invalid element at key "${String(t)}": expected a Zod schema`,
      );
  let a = Ce(e.shape);
  return {
    ...e,
    allKeys: i,
    symbolKeys: r,
    keySet: new Set(t),
    numKeys: t.length,
    optionalKeys: new Set(a),
  };
}
function Lr(e, t, n, r, i, a, o) {
  let s = [],
    c = i.keySet,
    l = i.catchall._zod,
    u = l.def.type,
    d = l.optin,
    f = l.optout,
    p = 0;
  for (let i in t) {
    if (o && n.issues.length !== p) {
      if (b(n, p)) break;
      p = n.issues.length;
    }
    if (c.has(i)) continue;
    if (i === `__proto__`) {
      u === `never` && s.push(i);
      continue;
    }
    if (u === `never`) {
      s.push(i);
      continue;
    }
    let a = l.run({ value: t[i], issues: [] }, r);
    a instanceof Promise
      ? e.push(a.then((e) => Pr(e, n, i, t, d, f)))
      : Pr(a, n, i, t, d, f);
  }
  return (
    s.length &&
      n.issues.push({
        code: `unrecognized_keys`,
        keys: s,
        input: t,
        inst: a,
        continue: !0,
      }),
    e.length ? Promise.all(e).then(() => n) : n
  );
}
var Rr = S(`$ZodObject`, (e, t) => {
    E.init(e, t);
    let n = Object.getOwnPropertyDescriptor(t, `shape`),
      r = n?.get ? n.get.raw : (t.shape ?? {});
    if (r) {
      let e = () => {
        let n = { ...r };
        return (
          Object.defineProperty(t, "shape", { value: n }),
          (e.raw = n),
          n
        );
      };
      ((e.raw = r), Object.defineProperty(t, "shape", { get: e }));
    }
    let i = re(() => Ir(t));
    x(e, `propValues`, (e) => {
      let t = e.def.shape,
        n = {};
      for (let e in t) {
        let r = t[e]._zod;
        if (r.values) {
          Object.prototype.hasOwnProperty.call(n, e) || g(n, e, new Set());
          for (let t of r.values) n[e].add(t);
          r.optin !== void 0 && n[e].add(void 0);
        }
      }
      return n;
    });
    let a = he,
      o = t.catchall,
      s,
      c = C.memoizer;
    (c?.attach(e),
      (e._zod.parse = (t, n) => {
        s ??= i.value;
        let r = t.value;
        if (!a(r))
          return (
            t.issues.push({
              expected: `object`,
              code: `invalid_type`,
              input: r,
              inst: e,
            }),
            t
          );
        t.value = c ? c.alloc(e, t, {}, n) : {};
        let l = [],
          u = s.shape,
          d = n?.abortEarly,
          f = t.issues.length;
        for (let e of s.allKeys) {
          if (d && t.issues.length !== f) {
            if (b(t, f)) break;
            f = t.issues.length;
          }
          if (e === `__proto__`) continue;
          let i = u[e],
            a = i._zod.optin,
            o = i._zod.optout,
            s = i._zod.run({ value: r[e], issues: [] }, n);
          s instanceof Promise
            ? l.push(s.then((n) => Pr(n, t, e, r, a, o)))
            : Pr(s, t, e, r, a, o);
        }
        return o
          ? Lr(l, r, t, n, i.value, e, d === !0)
          : l.length
            ? Promise.all(l).then(() => t)
            : t;
      }));
  }),
  zr = S(`$ZodObjectJIT`, (e, t) => {
    Rr.init(e, t);
    let n = e._zod.parse,
      r = re(() => Ir(t)),
      i = C.memoizer,
      a = (t) => {
        let n = r.value,
          a = n.symbolKeys,
          o = new Fn([`payload`, `ctx`], {
            shape: t,
            inst: e,
            memo: i,
            syms: a,
          }),
          s = (e) =>
            `shape[${e}]._zod.run({ value: input[${e}], issues: [] }, ctx)`,
          c = (e, t) => `
          let ${e}_ab = false;
          for (let i = 0; i < ${e}.issues.length; i++) {
            const iss = ${e}.issues[i];
            iss.path = iss.path ? [${t}, ...iss.path] : [${t}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${e}_ab = true;
          }
          if (${e}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
        o.write(`const input = payload.value;`);
        let l = Object.create(null),
          u = 0;
        for (let e of n.allKeys) l[e] = `key_${u++}`;
        o.write(
          i
            ? `const newResult = memo.alloc(inst, payload, {}, ctx);`
            : `const newResult = {};`,
        );
        for (let e of n.allKeys) {
          if (e === `__proto__`) continue;
          let n = l[e],
            r = typeof e == `symbol` ? `syms[${a.indexOf(e)}]` : fe(e),
            i = `${r} in input`,
            u = t[e],
            d = u?._zod?.optin,
            f = d !== void 0,
            p = u?._zod?.optout === `optional`;
          if ((o.write(`const ${n} = ${s(r)};`), f && p)) {
            let e =
              d === `optional`
                ? `${n}_present`
                : `${n}.value !== undefined || ${n}_present`;
            o.write(`
        const ${n}_present = ${i};
        if (!${n}.issues.length || ${n}_present) {
          if (${n}.issues.length) {${c(n, r)}
          }

          if (${e}) {
            newResult[${r}] = ${n}.value;
          }
        }

      `);
          } else
            f
              ? (o.write(`
        if (${n}.issues.length) {${c(n, r)}
        }
      `),
                d === `defaulted`
                  ? o.write(`newResult[${r}] = ${n}.value;`)
                  : o.write(`
        if (${n}.value !== undefined || ${i}) {
          newResult[${r}] = ${n}.value;
        }
      `))
              : o.write(`
        const ${n}_present = ${i};
        if (${n}.issues.length) {${c(n, r)}
        }
        if (!${n}_present && !${n}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${r}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${n}_present) {
          newResult[${r}] = ${n}.value;
        }

      `);
        }
        return (
          o.write(`payload.value = newResult;`),
          o.write(`return payload;`),
          o.compile()
        );
      },
      o,
      s = he,
      c = !C.jitless,
      l = c && ge.value,
      u = t.catchall,
      d;
    e._zod.parse = (i, f) => {
      d ??= r.value;
      let p = i.value;
      return s(p)
        ? c && l && f?.async === !1 && f.jitless !== !0
          ? ((o ||= a(t.shape)),
            (i = o(i, f)),
            u ? Lr([], p, i, f, d, e, f?.abortEarly === !0) : i)
          : n(i, f)
        : (i.issues.push({
            expected: `object`,
            code: `invalid_type`,
            input: p,
            inst: e,
          }),
          i);
    };
  });
function Br(e, t, n, r) {
  for (let n of e) if (n.issues.length === 0) return ((t.value = n.value), t);
  let i = e.filter((e) => !b(e));
  return i.length === 1
    ? ((t.value = i[0].value), i[0])
    : (t.issues.push({
        code: `invalid_union`,
        input: t.value,
        inst: n,
        errors: e.map((e) => e.issues.map((e) => Be(e, r, w()))),
      }),
      t);
}
var Vr = S(`$ZodUnion`, (e, t) => {
  (E.init(e, t),
    x(e, `optin`, (e) =>
      e.def.options.some((e) => e._zod.optin === `defaulted`)
        ? `defaulted`
        : e.def.options.some((e) => e._zod.optin !== void 0)
          ? `optional`
          : void 0,
    ),
    x(e, `optout`, (e) =>
      e.def.options.some((e) => e._zod.optout === `optional`)
        ? `optional`
        : void 0,
    ),
    x(e, `values`, (e) => {
      if (e.def.options.every((e) => e._zod.values))
        return new Set(e.def.options.flatMap((e) => Array.from(e._zod.values)));
    }),
    x(e, `pattern`, (e) => {
      if (e.def.options.every((e) => e._zod.pattern)) {
        let t = e.def.options.map((e) => e._zod.pattern);
        return RegExp(`^(${t.map((e) => ae(e.source)).join(`|`)})$`);
      }
    }));
  let n = t.options.length === 1 ? t.options[0]._zod.run : null;
  e._zod.parse = (r, i) => {
    if (n) return n(r, i);
    let a = !1,
      o = [];
    for (let e of t.options) {
      let t = e._zod.run({ value: r.value, issues: [] }, i);
      if (t instanceof Promise) (o.push(t), (a = !0));
      else {
        if (t.issues.length === 0) return t;
        o.push(t);
      }
    }
    return a ? Promise.all(o).then((t) => Br(t, r, e, i)) : Br(o, r, e, i);
  };
});
function Hr(e) {
  let t = new Map();
  for (let n of e.options) {
    let r = n._zod.propValues?.[e.discriminator];
    if (!r || r.size === 0)
      throw Error(
        `Invalid discriminated union option at index "${e.options.indexOf(n)}"`,
      );
    for (let e of r)
      if (t.has(e)) {
        if (e !== void 0)
          throw Error(`Duplicate discriminator value "${String(e)}"`);
        t.set(e, null);
      } else t.set(e, n);
  }
  return t;
}
var Ur = S(`$ZodDiscriminatedUnion`, (e, t) => {
    ((t.inclusive = !1), Vr.init(e, t));
    let n = e._zod.parse;
    (x(e, `propValues`, (e) => {
      let t = {},
        n = 0;
      for (let r of e.def.options) {
        let i = r._zod.propValues;
        if (!i || Object.keys(i).length === 0)
          throw Error(
            `Invalid discriminated union option at index "${e.def.options.indexOf(r)}"`,
          );
        i[e.def.discriminator]?.has(void 0) && n++;
        for (let [e, n] of Object.entries(i)) {
          Object.prototype.hasOwnProperty.call(t, e) || g(t, e, new Set());
          for (let r of n) t[e].add(r);
        }
      }
      return (
        !e.def.unionFallback && n > 1 && t[e.def.discriminator]?.delete(void 0),
        t
      );
    }),
      t.options.forEach((e, n) => {
        let r = se(e._zod.def);
        if (r && !Object.prototype.hasOwnProperty.call(r, t.discriminator))
          throw Error(`Invalid discriminated union option at index "${n}"`);
      }));
    let r = re(() => Hr(t));
    e._zod.parse = (i, a) => {
      let o = i.value;
      if (!he(o))
        return (
          i.issues.push({
            code: `invalid_type`,
            expected: `object`,
            input: o,
            inst: e,
          }),
          i
        );
      let s = o?.[t.discriminator],
        c = r.value.get(s);
      return c && (s !== void 0 || a.direction !== `backward`)
        ? c._zod.run(i, a)
        : t.unionFallback || a.direction === `backward`
          ? n(i, a)
          : (i.issues.push({
              code: `invalid_union`,
              errors: [],
              note: `No matching discriminator`,
              discriminator: t.discriminator,
              options: Array.from(r.value.keys()).filter(
                (e) => r.value.get(e) !== null,
              ),
              input: o,
              path: [t.discriminator],
              inst: e,
            }),
            i);
    };
  }),
  Wr = S(`$ZodIntersection`, (e, t) => {
    (E.init(e, t),
      (e._zod.parse = (e, n) => {
        let r = e.value,
          i = t.left._zod.run({ value: r, issues: [] }, n),
          a = t.right._zod.run({ value: r, issues: [] }, n);
        return i instanceof Promise || a instanceof Promise
          ? Promise.all([i, a]).then(([t, n]) => Kr(e, t, n))
          : Kr(e, i, a);
      }));
  });
function Gr(e, t) {
  if (e === t || (e instanceof Date && t instanceof Date && +e == +t))
    return { valid: !0, data: e };
  if (_e(e) && _e(t)) {
    let n = Object.keys(t),
      r = Object.keys(e).filter((e) => n.indexOf(e) !== -1),
      i = { ...e, ...t };
    Object.prototype.hasOwnProperty.call(i, `__proto__`) && delete i.__proto__;
    for (let n of r) {
      if (n === `__proto__`) continue;
      let r = Gr(e[n], t[n]);
      if (!r.valid)
        return { valid: !1, mergeErrorPath: [n, ...r.mergeErrorPath] };
      i[n] = r.data;
    }
    return { valid: !0, data: i };
  }
  if (Array.isArray(e) && Array.isArray(t)) {
    if (e.length !== t.length) return { valid: !1, mergeErrorPath: [] };
    let n = [];
    for (let r = 0; r < e.length; r++) {
      let i = e[r],
        a = t[r],
        o = Gr(i, a);
      if (!o.valid)
        return { valid: !1, mergeErrorPath: [r, ...o.mergeErrorPath] };
      n.push(o.data);
    }
    return { valid: !0, data: n };
  }
  return { valid: !1, mergeErrorPath: [] };
}
function Kr(e, t, n) {
  let r = new Map(),
    i,
    a = new Map(),
    o = (e, t) => {
      let n;
      if (e.code === `unrecognized_keys` && !e.path?.length)
        ((i ??= e), (n = e.keys));
      else if (
        e.code === `invalid_key` &&
        e.origin === `record` &&
        e.path?.length === 1
      ) {
        let t = String(e.path[0]);
        (a.has(t) || a.set(t, e), (n = [t]));
      } else return !1;
      for (let e of n) (r.has(e) || r.set(e, {}), (r.get(e)[t] = !0));
      return !0;
    };
  for (let n of t.issues) o(n, `l`) || e.issues.push(n);
  for (let t of n.issues) o(t, `r`) || e.issues.push(t);
  let s = [...r].filter(([, e]) => e.l && e.r).map(([e]) => e);
  if (s.length) {
    let t = i ? s.filter((e) => i.keys.includes(e)) : [];
    t.length && e.issues.push({ ...i, keys: t });
    for (let n of s) !t.includes(n) && a.has(n) && e.issues.push(a.get(n));
  }
  let c = Gr(t.value, n.value);
  if (!c.valid) {
    if (b(e)) return e;
    throw Error(
      `Unmergable intersection. Error path: ${JSON.stringify(c.mergeErrorPath)}`,
    );
  }
  return ((e.value = c.data), e);
}
var qr = S(`$ZodTuple`, (e, t) => {
  E.init(e, t);
  let n = t.items,
    r = C.memoizer;
  (r?.attach(e),
    (e._zod.parse = (i, a) => {
      let o = i.value;
      if (!Array.isArray(o))
        return (
          i.issues.push({
            input: o,
            inst: e,
            expected: `tuple`,
            code: `invalid_type`,
          }),
          i
        );
      i.value = r ? r.alloc(e, i, [], a) : [];
      let s = [],
        c = Jr(n, `optin`),
        l = Jr(n, `optout`);
      if (!t.rest) {
        if (o.length < c)
          return (
            i.issues.push({
              code: `too_small`,
              minimum: c,
              inclusive: !0,
              input: o,
              inst: e,
              origin: `array`,
            }),
            i
          );
        o.length > n.length &&
          i.issues.push({
            code: `too_big`,
            maximum: n.length,
            inclusive: !0,
            input: o,
            inst: e,
            origin: `array`,
          });
      }
      let u = Array(n.length),
        d = t.rest ? a?.abortEarly : void 0,
        f = !1;
      for (let e = 0; e < n.length; e++) {
        let t = n[e]._zod.run({ value: o[e], issues: [] }, a);
        t instanceof Promise
          ? s.push(
              t.then((t) => {
                u[e] = t;
              }),
            )
          : ((u[e] = t), d && !f && t.issues.length && (f = b(t)));
      }
      if (t.rest && !f) {
        let e = n.length - 1,
          r = o.slice(n.length),
          c = i.issues.length;
        for (let n of r) {
          if (d && i.issues.length !== c) {
            if (b(i, c)) break;
            c = i.issues.length;
          }
          e++;
          let r = t.rest._zod.run({ value: n, issues: [] }, a);
          r instanceof Promise
            ? s.push(r.then((t) => Yr(t, i, e)))
            : Yr(r, i, e);
        }
      }
      return s.length
        ? Promise.all(s).then(() => Xr(u, i, n, o, l))
        : Xr(u, i, n, o, l);
    }));
});
function Jr(e, t) {
  for (let n = e.length - 1; n >= 0; n--)
    if (
      !(t === `optin`
        ? e[n]._zod.optin !== void 0
        : e[n]._zod.optout === `optional`)
    )
      return n + 1;
  return 0;
}
function Yr(e, t, n) {
  (e.issues.length && t.issues.push(...Ie(n, e.issues)),
    (t.value[n] = e.value));
}
function Xr(e, t, n, r, i) {
  for (let a = 0; a < n.length; a++) {
    let o = e[a],
      s = a < r.length;
    if (!s && a >= i && n[a]._zod.optin === `optional`) {
      t.value.length = a;
      break;
    }
    if (o.issues.length) {
      if (!s && a >= i) {
        t.value.length = a;
        break;
      }
      t.issues.push(...Ie(a, o.issues));
    }
    t.value[a] = o.value;
  }
  for (
    let e = t.value.length - 1;
    e >= r.length && n[e]._zod.optout === `optional` && t.value[e] === void 0;
    e--
  )
    t.value.length = e;
  return t;
}
var Zr = S(`$ZodRecord`, (e, t) => {
    E.init(e, t);
    let n = C.memoizer;
    (n?.attach(e),
      (e._zod.parse = (r, i) => {
        let a = r.value;
        if (!_e(a))
          return (
            r.issues.push({
              expected: `record`,
              code: `invalid_type`,
              input: a,
              inst: e,
            }),
            r
          );
        let o = [],
          s = t.keyType._zod.values;
        if (s && !t.partial) {
          r.value = n ? n.alloc(e, r, {}, i) : {};
          let c = new Set();
          for (let n of s)
            if (
              typeof n == `string` ||
              typeof n == `number` ||
              typeof n == `symbol`
            ) {
              if (
                (c.add(typeof n == `number` ? n.toString() : n),
                n === `__proto__`)
              )
                continue;
              let s = t.keyType._zod.run({ value: n, issues: [] }, i);
              if (s instanceof Promise)
                throw Error(
                  `Async schemas not supported in object keys currently`,
                );
              if (s.issues.length) {
                r.issues.push({
                  code: `invalid_key`,
                  origin: `record`,
                  issues: s.issues.map((e) => Be(e, i, w())),
                  input: n,
                  path: [n],
                  inst: e,
                });
                continue;
              }
              let l = s.value;
              if (l === `__proto__`) continue;
              let u = t.valueType._zod.run({ value: a[n], issues: [] }, i);
              u instanceof Promise
                ? o.push(
                    u.then((e) => {
                      (e.issues.length && r.issues.push(...Ie(n, e.issues)),
                        (r.value[l] = e.value));
                    }),
                  )
                : (u.issues.length && r.issues.push(...Ie(n, u.issues)),
                  (r.value[l] = u.value));
            }
          let l;
          for (let e in a)
            if (!c.has(e)) {
              if (t.mode === `loose`) {
                if (e === `__proto__`) continue;
                r.value[e] = a[e];
              } else ((l ??= []), l.push(e));
            }
          l &&
            l.length > 0 &&
            r.issues.push({
              code: `unrecognized_keys`,
              input: a,
              inst: e,
              keys: l,
              continue: !0,
            });
        } else {
          r.value = n ? n.alloc(e, r, {}, i) : {};
          let c;
          for (let n of Reflect.ownKeys(a)) {
            if (
              n === `__proto__` ||
              !Object.prototype.propertyIsEnumerable.call(a, n)
            )
              continue;
            let l = t.keyType._zod.run({ value: n, issues: [] }, i);
            if (l instanceof Promise)
              throw Error(
                `Async schemas not supported in object keys currently`,
              );
            if (typeof n == `string` && mn.test(n) && l.issues.length) {
              let e = t.keyType._zod.run({ value: Number(n), issues: [] }, i);
              if (e instanceof Promise)
                throw Error(
                  `Async schemas not supported in object keys currently`,
                );
              e.issues.length === 0 && (l = e);
            }
            if (l.issues.length) {
              t.mode === `loose`
                ? (r.value[n] = a[n])
                : s
                  ? ((c ??= []), c.push(n))
                  : r.issues.push({
                      code: `invalid_key`,
                      origin: `record`,
                      issues: l.issues.map((e) => Be(e, i, w())),
                      input: n,
                      path: [n],
                      inst: e,
                    });
              continue;
            }
            let u = l.value;
            if (u === `__proto__`) continue;
            let d = t.valueType._zod.run({ value: a[n], issues: [] }, i);
            d instanceof Promise
              ? o.push(
                  d.then((e) => {
                    (e.issues.length && r.issues.push(...Ie(n, e.issues)),
                      (r.value[u] = e.value));
                  }),
                )
              : (d.issues.length && r.issues.push(...Ie(n, d.issues)),
                (r.value[u] = d.value));
          }
          c &&
            c.length > 0 &&
            r.issues.push({
              code: `unrecognized_keys`,
              input: a,
              inst: e,
              keys: c,
              continue: !0,
            });
        }
        return o.length ? Promise.all(o).then(() => r) : r;
      }));
  }),
  Qr = S(`$ZodEnum`, (e, t) => {
    E.init(e, t);
    let n = h(t.entries),
      r = new Set(n);
    ((e._zod.values = r),
      x(e, `pattern`, (e) => {
        let t = h(e.def.entries).filter((e) => ye.has(typeof e));
        return RegExp(
          t.length
            ? `^(${t.map((e) => be(e.toString())).join(`|`)})$`
            : `^[^\\s\\S]$`,
        );
      }),
      (e._zod.parse = (t, i) => {
        let a = t.value;
        return (
          r.has(a) ||
            t.issues.push({
              code: `invalid_value`,
              values: n,
              input: a,
              inst: e,
            }),
          t
        );
      }));
  }),
  $r = S(`$ZodLiteral`, (e, t) => {
    E.init(e, t);
    let n = new Set(t.values);
    ((e._zod.values = n),
      x(e, `pattern`, (e) => {
        let t = e.def.values;
        return RegExp(
          t.length
            ? `^(${t.map((e) => (typeof e == `string` ? be(e) : e ? be(e.toString()) : String(e))).join(`|`)})$`
            : `^[^\\s\\S]$`,
        );
      }),
      (e._zod.parse = (r, i) => {
        let a = r.value;
        return (
          n.has(a) ||
            r.issues.push({
              code: `invalid_value`,
              values: t.values,
              input: a,
              inst: e,
            }),
          r
        );
      }));
  }),
  ei = S(`$ZodTransform`, (e, t) => {
    (E.init(e, t),
      (e._zod.optin = `optional`),
      C.memoizer?.guard(e),
      (e._zod.parse = (n, r) => {
        if (r.direction === `backward`) throw new lt(e.constructor.name);
        let i = t.transform(n.value, n);
        if (r.async)
          return (i instanceof Promise ? i : Promise.resolve(i)).then(
            (e) => ((n.value = e), n),
          );
        if (i instanceof Promise) throw new ct();
        return ((n.value = i), n);
      }));
  });
function ti(e, t) {
  return ((e.value = t.issues.length ? void 0 : t.value), e);
}
var ni = S(`$ZodOptional`, (e, t) => {
    (E.init(e, t),
      x(e, `optin`, (e) =>
        e.def.innerType._zod.optin === `defaulted` ? `defaulted` : `optional`,
      ),
      (e._zod.optout = `optional`),
      x(e, `values`, (e) => {
        let t = e.def.innerType._zod.values;
        return t ? new Set([...t, void 0]) : void 0;
      }),
      x(e, `pattern`, (e) => {
        let t = e.def.innerType._zod.pattern;
        return t ? RegExp(`^(${ae(t.source)})?$`) : void 0;
      }),
      (e._zod.parse = (e, n) => {
        if (e.value === void 0) {
          if (t.innerType._zod.optin !== `defaulted`) return e;
          let r = t.innerType._zod.run({ value: e.value, issues: [] }, n);
          return r instanceof Promise ? r.then((t) => ti(e, t)) : ti(e, r);
        }
        return t.innerType._zod.run(e, n);
      }));
  }),
  ri = S(`$ZodExactOptional`, (e, t) => {
    (ni.init(e, t),
      x(e, `values`, (e) => e.def.innerType._zod.values),
      x(e, `pattern`, (e) => e.def.innerType._zod.pattern),
      (e._zod.parse = (e, n) => t.innerType._zod.run(e, n)));
  }),
  ii = S(`$ZodNullable`, (e, t) => {
    (E.init(e, t),
      x(e, `optin`, (e) => e.def.innerType._zod.optin),
      x(e, `optout`, (e) => e.def.innerType._zod.optout),
      x(e, `pattern`, (e) => {
        let t = e.def.innerType._zod.pattern;
        return t ? RegExp(`^(${ae(t.source)}|null)$`) : void 0;
      }),
      x(e, `values`, (e) =>
        e.def.innerType._zod.values
          ? new Set([...e.def.innerType._zod.values, null])
          : void 0,
      ),
      (e._zod.parse = (e, n) =>
        e.value === null ? e : t.innerType._zod.run(e, n)));
  }),
  ai = S(`$ZodDefault`, (e, t) => {
    (E.init(e, t),
      (e._zod.optin = `defaulted`),
      x(e, `values`, (e) => e.def.innerType._zod.values),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) return t.innerType._zod.run(e, n);
        if (e.value === void 0) return ((e.value = t.defaultValue), e);
        let r = t.innerType._zod.run(e, n);
        return r instanceof Promise ? r.then((e) => oi(e, t)) : oi(r, t);
      }));
  });
function oi(e, t) {
  return (e.value === void 0 && (e.value = t.defaultValue), e);
}
var si = S(`$ZodPrefault`, (e, t) => {
    (E.init(e, t),
      (e._zod.optin = `defaulted`),
      x(e, `values`, (e) => e.def.innerType._zod.values),
      (e._zod.parse = (e, n) => (
        n.direction === `backward` ||
          (e.value === void 0 && (e.value = t.defaultValue)),
        t.innerType._zod.run(e, n)
      )));
  }),
  ci = S(`$ZodNonOptional`, (e, t) => {
    (E.init(e, t),
      x(e, `values`, (e) => {
        let t = e.def.innerType._zod.values;
        return t ? new Set([...t].filter((e) => e !== void 0)) : void 0;
      }),
      (e._zod.parse = (n, r) => {
        let i = t.innerType._zod.run(n, r);
        return i instanceof Promise ? i.then((t) => li(t, e)) : li(i, e);
      }));
  });
function li(e, t) {
  return (
    !e.issues.length &&
      e.value === void 0 &&
      e.issues.push({
        code: `invalid_type`,
        expected: `nonoptional`,
        input: e.value,
        inst: t,
      }),
    e
  );
}
function ui(e, t, n, r) {
  return t.issues.length
    ? ((e.value = n.catchValue({
        ...t,
        value: e.value,
        error: { issues: t.issues.map((e) => Be(e, r, w())) },
        input: e.value,
      })),
      e)
    : ((e.value = t.value), t.memo && (e.memo = !0), e);
}
var di = S(`$ZodCatch`, (e, t) => {
    (E.init(e, t),
      x(e, `optin`, (e) =>
        e.def.innerType._zod.optin === `defaulted` ? `defaulted` : `optional`,
      ),
      x(e, `optout`, (e) => e.def.innerType._zod.optout),
      x(e, `values`, (e) => e.def.innerType._zod.values),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) return t.innerType._zod.run(e, n);
        let r = t.innerType._zod.run({ value: e.value, issues: [] }, n);
        return r instanceof Promise
          ? r.then((r) => ui(e, r, t, n))
          : ui(e, r, t, n);
      }));
  }),
  fi = S(`$ZodPipe`, (e, t) => {
    (E.init(e, t),
      x(e, `values`, (e) => e.def.in._zod.values),
      x(e, `optin`, (e) => e.def.in._zod.optin),
      x(e, `optout`, (e) => e.def.out._zod.optout),
      x(e, `propValues`, (e) => e.def.in._zod.propValues),
      (e._zod.parse = (e, n) => {
        if (n.direction === `backward`) {
          let r = t.out._zod.run(e, n);
          return r instanceof Promise
            ? r.then((e) => pi(e, t.in, n))
            : pi(r, t.in, n);
        }
        let r = t.in._zod.run(e, n);
        return r instanceof Promise
          ? r.then((e) => pi(e, t.out, n))
          : pi(r, t.out, n);
      }));
  });
function pi(e, t, n) {
  return e.issues.some((e) => e.code !== `unrecognized_keys`)
    ? ((e.aborted = !0), e)
    : t._zod.run({ value: e.value, issues: e.issues }, n);
}
var mi = S(`$ZodReadonly`, (e, t) => {
  (E.init(e, t),
    x(e, `propValues`, (e) => e.def.innerType._zod.propValues),
    x(e, `values`, (e) => e.def.innerType._zod.values),
    x(e, `optin`, (e) => e.def.innerType?._zod?.optin),
    x(e, `optout`, (e) => e.def.innerType?._zod?.optout),
    (e._zod.parse = (e, n) => {
      if (n.direction === `backward`) return t.innerType._zod.run(e, n);
      let r = t.innerType._zod.run(e, n);
      return r instanceof Promise ? r.then(hi) : hi(r);
    }));
});
function hi(e) {
  return (e.memo || (e.value = Object.freeze(e.value)), e);
}
var gi = S(`$ZodCustom`, (e, t) => {
  (T.init(e, t),
    E.init(e, t),
    (e._zod.parse = (e, t) => e),
    (e._zod.check = (n) => {
      let r = n.value,
        i = t.fn(r);
      if (i instanceof Promise) return i.then((t) => _i(t, n, r, e));
      _i(i, n, r, e);
    }));
});
function _i(e, t, n, r) {
  if (!e) {
    let e = {
      code: `custom`,
      input: n,
      inst: r,
      path: [...(r._zod.def.path ?? [])],
      continue: !r._zod.def.abort,
    };
    (r._zod.def.params && (e.params = r._zod.def.params), t.issues.push(Ge(e)));
  }
}
var vi = class extends Error {
    constructor() {
      (super(`Cannot parse a reference cycle that closes through a transform`),
        (this.name = `ZodCyclicError`));
    }
  },
  yi = `~memo`,
  bi = [];
function xi(e) {
  return typeof e == `object` && !!e;
}
function Si(e) {
  return e.map((e) => (e.path ? { ...e, path: e.path.slice() } : { ...e }));
}
var Ci = new WeakMap(),
  wi = 0,
  Ti = 1,
  Ei = 2;
function Di(e, t, n) {
  let r = Ci.get(e);
  if (r !== void 0) return r ? Ei : wi;
  if (t.has(e)) return Ei;
  t.add(e);
  let i = wi,
    a = (e) => {
      if (i !== Ei && e?._zod) {
        let r = Di(e, t, n);
        r > i && (i = r);
      }
    },
    o = (e, r) => {
      let i = wi;
      for (let a of Reflect.ownKeys(e)) {
        let o = Object.getOwnPropertyDescriptor(e, a);
        if (r && !o.enumerable) continue;
        let s = o.get ? Ti : o.value?._zod ? Di(o.value, t, n) : wi;
        s > i && (i = s);
      }
      return i;
    },
    s = (e) => {
      e > i && (i = e);
    },
    c = e._zod.def;
  switch (c.type) {
    case `object`: {
      let e = se(c);
      (s(e ? o(e, !0) : Ti), a(c.catchall));
      break;
    }
    case `array`:
      a(c.element);
      break;
    case `tuple`:
      for (let e of c.items) a(e);
      a(c.rest);
      break;
    case `record`:
    case `map`:
      (a(c.keyType), a(c.valueType));
      break;
    case `set`:
      a(c.valueType);
      break;
    case `union`:
      for (let e of c.options) a(e);
      break;
    case `intersection`:
      (a(c.left), a(c.right));
      break;
    case `optional`:
    case `nullable`:
    case `default`:
    case `prefault`:
    case `catch`:
    case `readonly`:
    case `nonoptional`:
    case `promise`:
    case `success`:
      a(c.innerType);
      break;
    case `pipe`:
      (a(c.in), a(c.out));
      break;
    case `function`:
      (a(c.input), a(c.output));
      break;
    case `lazy`: {
      let r = c._cachedInner ?? (n ? e._zod.innerType : void 0);
      s(r ? Di(r, t, !1) : Ti);
      break;
    }
    case `template_literal`:
    case `string`:
    case `number`:
    case `int`:
    case `boolean`:
    case `bigint`:
    case `symbol`:
    case `undefined`:
    case `null`:
    case `void`:
    case `never`:
    case `any`:
    case `unknown`:
    case `date`:
    case `nan`:
    case `enum`:
    case `literal`:
    case `file`:
    case `transform`:
    case `custom`:
      break;
    default:
      for (let e in c) {
        let t = Object.getOwnPropertyDescriptor(c, e);
        if (!t || t.get) continue;
        let n = t.value;
        if (n && typeof n == `object`) {
          if (n._zod) a(n);
          else if (Array.isArray(n)) for (let e of n) a(e);
        }
      }
  }
  return (t.delete(e), Oi(e, i));
}
function Oi(e, t) {
  return (t !== Ti && Ci.set(e, t === Ei), t);
}
function ki(e, t) {
  let n = e.buckets.get(t);
  return (n || ((n = new WeakMap()), e.buckets.set(t, n)), n);
}
var Ai,
  ji = [],
  Mi = {
    alloc(e, t, n) {
      let r = Ai;
      if (!r) return n;
      Ai = void 0;
      let i = { value: n, issues: null };
      return (r.set(t.value, i), ji.push(i), n);
    },
    guard(e) {
      var t;
      ((t = e._zod).deferred ?? (t.deferred = []),
        e._zod.deferred.push(() => {
          let t = e._zod.parse,
            n = (e, n) => {
              if (n.direction !== `backward` && Pi(n, e.value)) throw new vi();
              return t(e, n);
            };
          ((e._zod.parse = n), e._zod.run === t && (e._zod.run = n));
        }));
    },
    attach(e) {
      var t;
      let n,
        r = !1,
        i,
        a;
      ((t = e._zod).deferred ?? (t.deferred = []),
        e._zod.deferred.push(() => {
          let t = e._zod.parse,
            o = (s, c) => {
              if (n === void 0) {
                let i = Di(e, new Set(), !1);
                if (i === wi)
                  return (
                    (e._zod.parse = t),
                    e._zod.run === o && (e._zod.run = t),
                    t(s, c)
                  );
                i === Ei || r ? (n = !0) : (r = !0);
              }
              let l = s.value;
              if (!xi(l)) return t(s, c);
              let u = c[yi];
              u ||
                ((u = { buckets: new WeakMap(), backEdges: void 0 }),
                (c[yi] = u));
              let d;
              i === c ? (d = a) : ((d = ki(u, e)), (i = c), (a = d));
              let f = d.get(l);
              if (f)
                return (
                  (s.value = f.value),
                  f.issues
                    ? f.issues.length && s.issues.push(...Si(f.issues))
                    : ((s.memo = !0),
                      u.backEdges ?? (u.backEdges = new WeakSet()),
                      u.backEdges.add(f.value)),
                  s
                );
              Ai = d;
              let p = ji.length,
                m = t(s, c);
              Ai = void 0;
              let h = ji.length > p ? ji.pop() : void 0;
              return m instanceof Promise
                ? m.then(
                    (e) => (
                      h && (h.issues = e.issues.length ? Si(e.issues) : bi),
                      e
                    ),
                  )
                : (h && (h.issues = m.issues.length ? Si(m.issues) : bi), m);
            };
          ((e._zod.parse = o), e._zod.run === t && (e._zod.run = o));
        }));
    },
  };
function Ni() {
  return Mi;
}
function Pi(e, t) {
  let n = e[yi]?.backEdges;
  return n !== void 0 && xi(t) && n.has(t);
}
var Fi = () => {
  let e = {
    string: { unit: `characters`, verb: `to have` },
    file: { unit: `bytes`, verb: `to have` },
    array: { unit: `items`, verb: `to have` },
    set: { unit: `items`, verb: `to have` },
    map: { unit: `entries`, verb: `to have` },
  };
  function t(t) {
    return e[t] ?? null;
  }
  let n = {
      regex: `input`,
      email: `email address`,
      url: `URL`,
      emoji: `emoji`,
      uuid: `UUID`,
      uuidv4: `UUIDv4`,
      uuidv6: `UUIDv6`,
      nanoid: `nanoid`,
      guid: `GUID`,
      cuid: `cuid`,
      cuid2: `cuid2`,
      ulid: `ULID`,
      xid: `XID`,
      ksuid: `KSUID`,
      datetime: `ISO datetime`,
      date: `ISO date`,
      time: `ISO time`,
      duration: `ISO duration`,
      ipv4: `IPv4 address`,
      ipv6: `IPv6 address`,
      mac: `MAC address`,
      cidrv4: `IPv4 range`,
      cidrv6: `IPv6 range`,
      base64: `base64-encoded string`,
      base64url: `base64url-encoded string`,
      json_string: `JSON string`,
      e164: `E.164 number`,
      currency_code: `currency code`,
      credit_card: `credit card number`,
      iban: `IBAN`,
      jwt: `JWT`,
      template_literal: `input`,
    },
    r = { nan: `NaN` };
  function i(e, t) {
    return e === `number` && typeof t == `number` && !Number.isFinite(t)
      ? String(t)
      : (r[e] ?? e);
  }
  return (e) => {
    switch (e.code) {
      case `invalid_type`:
        return `Invalid input: expected ${i(e.expected)}, received ${i(We(e.input), e.input)}`;
      case `invalid_value`:
        return e.values.length === 1
          ? `Invalid input: expected ${Se(e.values[0])}`
          : `Invalid option: expected one of ${ee(e.values, `|`)}`;
      case `too_big`: {
        let n = e.exact ? `exactly ` : e.inclusive ? `<=` : `<`,
          r = t(e.origin);
        return r
          ? `Too big: expected ${e.origin ?? `value`} to have ${n}${e.maximum.toString()} ${r.unit ?? `elements`}`
          : `Too big: expected ${e.origin ?? `value`} to be ${n}${e.maximum.toString()}`;
      }
      case `too_small`: {
        let n = e.exact ? `exactly ` : e.inclusive ? `>=` : `>`,
          r = t(e.origin);
        return r
          ? `Too small: expected ${e.origin} to have ${n}${e.minimum.toString()} ${r.unit}`
          : `Too small: expected ${e.origin} to be ${n}${e.minimum.toString()}`;
      }
      case `invalid_format`: {
        let t = e;
        return t.format === `starts_with`
          ? `Invalid string: must start with "${t.prefix}"`
          : t.format === `ends_with`
            ? `Invalid string: must end with "${t.suffix}"`
            : t.format === `includes`
              ? `Invalid string: must include "${t.includes}"`
              : t.format === `regex`
                ? `Invalid string: must match pattern ${t.pattern}`
                : `Invalid ${n[t.format] ?? e.format}`;
      }
      case `not_multiple_of`:
        return `Invalid number: must be a multiple of ${e.divisor}`;
      case `unrecognized_keys`:
        return `Unrecognized key${e.keys.length > 1 ? `s` : ``}: ${ee(e.keys, `, `)}`;
      case `invalid_key`:
        return `Invalid key in ${e.origin}`;
      case `invalid_union`:
        return e.options && Array.isArray(e.options) && e.options.length > 0
          ? `Invalid discriminator value. Expected ${e.options.map((e) => `'${e}'`).join(` | `)}`
          : e.inclusive === !1
            ? `Invalid input: more than one option matched`
            : `Invalid input`;
      case `invalid_element`:
        return `Invalid value in ${e.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function Ii() {
  return { localeError: Fi() };
}
var Li,
  Ri = class {
    constructor() {
      ((this._map = new WeakMap()), (this._idmap = new Map()));
    }
    add(e, ...t) {
      let n = t[0];
      return (
        this._map.set(e, n),
        n && typeof n == `object` && `id` in n && this._idmap.set(n.id, e),
        this
      );
    }
    clear() {
      return ((this._map = new WeakMap()), (this._idmap = new Map()), this);
    }
    remove(e) {
      let t = this._map.get(e);
      return (
        t && typeof t == `object` && `id` in t && this._idmap.delete(t.id),
        this._map.delete(e),
        this
      );
    }
    get(e) {
      let t = e._zod.parent;
      if (t) {
        let n = { ...(this.get(t) ?? {}) };
        delete n.id;
        let r = { ...n, ...this._map.get(e) };
        return Object.keys(r).length ? r : void 0;
      }
      return this._map.get(e);
    }
    has(e) {
      return this._map.has(e);
    }
  };
function zi() {
  return new Ri();
}
(Li = globalThis).__zod_globalRegistry ?? (Li.__zod_globalRegistry = zi());
var Bi = globalThis.__zod_globalRegistry;
function Vi(e) {
  return ((e.checks &&= [...e.checks]), e);
}
function Hi(e, t) {
  return new e(Vi({ type: `string`, ...y(t) }));
}
function Ui(e, t) {
  return new e({
    type: `string`,
    format: `email`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function Wi(e, t) {
  return new e({
    type: `string`,
    format: `guid`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function Gi(e, t) {
  return new e({
    type: `string`,
    format: `uuid`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function Ki(e, t) {
  return new e({
    type: `string`,
    format: `uuid`,
    check: `string_format`,
    abort: !1,
    version: `v4`,
    ...y(t),
  });
}
function qi(e, t) {
  return new e({
    type: `string`,
    format: `uuid`,
    check: `string_format`,
    abort: !1,
    version: `v6`,
    ...y(t),
  });
}
function Ji(e, t) {
  return new e({
    type: `string`,
    format: `uuid`,
    check: `string_format`,
    abort: !1,
    version: `v7`,
    ...y(t),
  });
}
function Yi(e, t) {
  return new e({
    type: `string`,
    format: `url`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function Xi(e, t) {
  return new e({
    type: `string`,
    format: `emoji`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function Zi(e, t) {
  return new e({
    type: `string`,
    format: `nanoid`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function Qi(e, t) {
  return new e({
    type: `string`,
    format: `cuid`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function $i(e, t) {
  return new e({
    type: `string`,
    format: `cuid2`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function ea(e, t) {
  return new e({
    type: `string`,
    format: `ulid`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function ta(e, t) {
  return new e({
    type: `string`,
    format: `xid`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function na(e, t) {
  return new e({
    type: `string`,
    format: `ksuid`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function ra(e, t) {
  return new e({
    type: `string`,
    format: `ipv4`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function ia(e, t) {
  return new e({
    type: `string`,
    format: `ipv6`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function aa(e, t) {
  return new e({
    type: `string`,
    format: `cidrv4`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function oa(e, t) {
  return new e({
    type: `string`,
    format: `cidrv6`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function sa(e, t) {
  return new e({
    type: `string`,
    format: `base64`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function ca(e, t) {
  return new e({
    type: `string`,
    format: `base64url`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function la(e, t) {
  return new e({
    type: `string`,
    format: `e164`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function ua(e, t) {
  return new e({
    type: `string`,
    format: `jwt`,
    check: `string_format`,
    abort: !1,
    ...y(t),
  });
}
function da(e, t) {
  return new e({
    type: `string`,
    format: `datetime`,
    check: `string_format`,
    offset: !1,
    local: !1,
    precision: null,
    ...y(t),
  });
}
function fa(e, t) {
  return new e({
    type: `string`,
    format: `date`,
    check: `string_format`,
    ...y(t),
  });
}
function pa(e, t) {
  return new e({
    type: `string`,
    format: `time`,
    check: `string_format`,
    precision: null,
    ...y(t),
  });
}
function ma(e, t) {
  return new e({
    type: `string`,
    format: `duration`,
    check: `string_format`,
    ...y(t),
  });
}
function ha(e, t) {
  return new e(Vi({ type: `number`, checks: [], ...y(t) }));
}
function ga(e, t) {
  return new e({
    type: `number`,
    check: `number_format`,
    abort: !1,
    format: `safeint`,
    ...y(t),
  });
}
function _a(e, t) {
  return new e({ type: `boolean`, ...y(t) });
}
function va(e) {
  return new e({ type: `unknown` });
}
function ya(e, t) {
  return new e({ type: `never`, ...y(t) });
}
function ba(e, t) {
  return new bn({ check: `less_than`, ...y(t), value: e, inclusive: !1 });
}
function xa(e, t) {
  return new bn({ check: `less_than`, ...y(t), value: e, inclusive: !0 });
}
function Sa(e, t) {
  return new xn({ check: `greater_than`, ...y(t), value: e, inclusive: !1 });
}
function Ca(e, t) {
  return new xn({ check: `greater_than`, ...y(t), value: e, inclusive: !0 });
}
function wa(e, t) {
  return new Sn({ check: `multiple_of`, ...y(t), value: e });
}
function Ta(e, t) {
  return new wn({ check: `max_length`, ...y(t), maximum: e });
}
function Ea(e, t) {
  return new Tn({ check: `min_length`, ...y(t), minimum: e });
}
function Da(e, t) {
  return new En({ check: `length_equals`, ...y(t), length: e });
}
function Oa(e, t) {
  return new On({
    check: `string_format`,
    format: `regex`,
    ...y(t),
    pattern: e,
  });
}
function ka(e) {
  return new kn({ check: `string_format`, format: `lowercase`, ...y(e) });
}
function Aa(e) {
  return new An({ check: `string_format`, format: `uppercase`, ...y(e) });
}
function ja(e, t) {
  return new jn({
    check: `string_format`,
    format: `includes`,
    ...y(t),
    includes: e,
  });
}
function Ma(e, t) {
  return new Mn({
    check: `string_format`,
    format: `starts_with`,
    ...y(t),
    prefix: e,
  });
}
function Na(e, t) {
  return new Nn({
    check: `string_format`,
    format: `ends_with`,
    ...y(t),
    suffix: e,
  });
}
function Pa(e) {
  return new Pn({ check: `overwrite`, tx: e });
}
function Fa(e) {
  return Pa((t) => t.normalize(e));
}
function Ia() {
  return Pa((e) => e.trim());
}
function La() {
  return Pa((e) => e.toLowerCase());
}
function Ra() {
  return Pa((e) => e.toUpperCase());
}
function za() {
  return Pa((e) => pe(e));
}
function Ba(e, t, n) {
  return new e({ type: `array`, element: t, ...y(n) });
}
function Va(e, t, n) {
  let r = y(n);
  return (
    (r.abort ??= !0),
    new e({ type: `custom`, check: `custom`, fn: t, ...r })
  );
}
function Ha(e, t, n) {
  return new e({ type: `custom`, check: `custom`, fn: t, ...y(n) });
}
function Ua(e, t) {
  let n = Wa(
    (t) => (
      (t.addIssue = (e) => {
        if (typeof e == `string`) t.issues.push(Ge(e, t.value, n._zod.def));
        else {
          let r = e;
          (r.fatal && (r.continue = !1),
            (r.code ??= `custom`),
            `input` in r || (r.input = t.value),
            (r.inst ??= n),
            (r.continue ??= !n._zod.def.abort),
            t.issues.push(Ge(r)));
        }
      }),
      e(t.value, t)
    ),
    t,
  );
  return n;
}
function Wa(e, t) {
  let n = new T({ check: `custom`, ...y(t) });
  return ((n._zod.check = e), n);
}
function Ga(e, ...t) {
  for (let n of t)
    for (let t of Reflect.ownKeys(n))
      Object.prototype.propertyIsEnumerable.call(n, t) && g(e, t, n[t]);
  return e;
}
function Ka(e) {
  let t = e?.target ?? `draft-2020-12`;
  return (
    t === `draft-4` && (t = `draft-04`),
    t === `draft-7` && (t = `draft-07`),
    {
      processors: e.processors ?? {},
      metadataRegistry: e?.metadata ?? Bi,
      target: t,
      unrepresentable: e?.unrepresentable ?? `throw`,
      override: e?.override ?? (() => {}),
      io: e?.io ?? `output`,
      counter: 0,
      seen: new Map(),
      sharedDefsExtractedFor: void 0,
      sharedEmitDoneFor: void 0,
      cycles: e?.cycles ?? `ref`,
      reused: e?.reused ?? `inline`,
      intersections: [],
      deferred: [],
      external: e?.external ?? void 0,
    }
  );
}
function qa(e, t, n, r, i) {
  let a =
    typeof t.unrepresentable == `function`
      ? t.unrepresentable({ zodSchema: e, path: r.path, message: i })
      : t.unrepresentable;
  if (a === `any`) return !1;
  if (a === void 0 || a === `throw`) throw Error(i);
  return (Object.assign(n, a), !0);
}
function O(e, t, n = { path: [], schemaPath: [] }) {
  var r;
  let i = e._zod.def,
    a = t.seen.get(e);
  if (a)
    return (
      a.count++,
      n.schemaPath.includes(e) && (a.cycle = n.path),
      a.schema
    );
  let o = { schema: {}, count: 1, cycle: void 0, path: n.path };
  (t.seen.set(e, o),
    (t.sharedDefsExtractedFor = void 0),
    (t.sharedEmitDoneFor = void 0));
  let s = e._zod.toJSONSchema?.();
  if (s) o.schema = s;
  else {
    let r = { ...n, schemaPath: [...n.schemaPath, e], path: n.path };
    if (e._zod.processJSONSchema) e._zod.processJSONSchema(t, o.schema, r);
    else {
      let n = o.schema,
        a = t.processors[i.type];
      if (!a)
        throw Error(
          `[toJSONSchema]: Non-representable type encountered: ${i.type}`,
        );
      a(e, t, n, r);
    }
    let a = e._zod.parent;
    a && ((o.ref ||= a), O(a, t, r), (t.seen.get(a).isParent = !0));
  }
  let c = t.metadataRegistry.get(e);
  return (
    c && Ga(o.schema, c),
    t.io === `input` &&
      k(e) &&
      (delete o.schema.examples, delete o.schema.default),
    t.io === `input` &&
      `_prefault` in o.schema &&
      ((r = o.schema).default ?? (r.default = o.schema._prefault)),
    delete o.schema._prefault,
    t.seen.get(e).schema
  );
}
function Ja(e) {
  return e.replace(/~/g, `~0`).replace(/\//g, `~1`);
}
function Ya(e, t) {
  let n = e.seen.get(t);
  if (!n) throw Error(`Unprocessed schema. This is a bug in Zod.`);
  if (e.external && e.sharedDefsExtractedFor === e.external) return;
  let r = new Map();
  for (let t of e.seen.entries()) {
    let n = e.metadataRegistry.get(t[0])?.id;
    if (n) {
      let e = r.get(n);
      if (e && e !== t[0])
        throw Error(
          `Duplicate schema id "${n}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`,
        );
      r.set(n, t[0]);
    }
  }
  let i = (t) => {
      let r = e.target === `draft-2020-12` ? `$defs` : `definitions`;
      if (e.external) {
        let n = e.external.registry.get(t[0])?.id,
          i = e.external.uri ?? ((e) => e);
        if (n) return { ref: i(n) };
        let a = t[1].defId ?? t[1].schema.id ?? `schema${e.counter++}`;
        return (
          (t[1].defId = a),
          { defId: a, ref: `${i(`__shared`)}#/${r}/${Ja(a)}` }
        );
      }
      let i = `#/${r}/`;
      if (t[1] === n && !t[1].schema.id) return { ref: `#` };
      let a = t[1].schema.id ?? `__schema${e.counter++}`;
      return { defId: a, ref: i + Ja(a) };
    },
    a = (e) => {
      if (e[1].schema.$ref) return;
      let t = e[1],
        { ref: n, defId: r } = i(e);
      ((t.def = { ...t.schema }), r && (t.defId = r));
      let a = t.schema;
      for (let e in a) delete a[e];
      a.$ref = n;
    };
  if (e.cycles === `throw`)
    for (let t of e.seen.entries()) {
      let e = t[1];
      if (e.cycle)
        throw Error(`Cycle detected: #/${e.cycle?.join(`/`)}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
    }
  for (let n of e.seen.entries()) {
    let r = n[1];
    if (t === n[0]) a(n);
    else {
      if (e.external) {
        let r = e.external.registry.get(n[0])?.id;
        if (t !== n[0] && r) {
          a(n);
          continue;
        }
      }
      (e.metadataRegistry.get(n[0])?.id ||
        r.cycle ||
        (r.count > 1 && e.reused === `ref`)) &&
        a(n);
    }
  }
  e.external && (e.sharedDefsExtractedFor = e.external);
}
function Xa(e) {
  let t = e.anyOf;
  if (!Array.isArray(t) || t.length === 0 || e.type !== void 0) return;
  let n = [];
  for (let e of t) {
    if (!e || typeof e != `object`) return;
    Xa(e);
    let t = Object.keys(e);
    if (t.length !== 1 || t[0] !== `type`) return;
    let r = e.type;
    for (let e of Array.isArray(r) ? r : [r]) {
      if (typeof e != `string`) return;
      n.includes(e) || n.push(e);
    }
  }
  (delete e.anyOf, (e.type = n.length === 1 ? n[0] : n));
}
var Za = new Set([`type`, `properties`, `required`, `additionalProperties`]),
  Qa = [`oneOf`, `anyOf`];
function $a(e) {
  let t = e.additionalProperties;
  return t === void 0 || t === !1 || typeof t != `object` || !t
    ? null
    : Object.keys(t).length
      ? t
      : null;
}
function eo(e) {
  let t = [];
  for (let n of e) {
    if (typeof n != `object` || n.type !== `object`) return null;
    for (let e in n) if (!Za.has(e)) return null;
    t.push(n);
  }
  let n = {},
    r = new Set();
  for (let e of t) {
    for (let r in e.properties) {
      if (Object.prototype.hasOwnProperty.call(n, r)) continue;
      let e = [];
      for (let n of t) {
        let t = n.properties?.[r] ?? $a(n);
        t != null &&
          (e.some((e) => JSON.stringify(e) === JSON.stringify(t)) || e.push(t));
      }
      g(n, r, e.length === 1 ? e[0] : (eo(e) ?? { allOf: e }));
    }
    for (let t of e.required ?? []) r.add(t);
  }
  let i = { type: `object`, properties: n };
  if (
    (r.size && (i.required = [...r]),
    t.every((e) => e.additionalProperties === !1))
  )
    i.additionalProperties = !1;
  else {
    let e = [];
    for (let n of t) {
      let t = $a(n);
      t && !e.some((e) => JSON.stringify(e) === JSON.stringify(t)) && e.push(t);
    }
    e.length === 1
      ? (i.additionalProperties = e[0])
      : e.length > 1 && (i.additionalProperties = { allOf: e });
  }
  return i;
}
function to(e) {
  let t = e.allOf;
  if (!Array.isArray(t) || t.length < 2) return;
  for (let t of Za) if (t in e) return;
  let n = t.filter((e) => Qa.some((t) => Array.isArray(e[t]))),
    r = null;
  if (!n.length) r = eo(t);
  else {
    let e = n[0],
      i = Qa.find((t) => Array.isArray(e[t]));
    if (Object.keys(e).length !== 1) return;
    let a = t.filter((t) => t !== e),
      o = e[i].map((e) => eo([...a, e]));
    if (o.some((e) => !e)) return;
    r = { [i]: o };
  }
  r && (delete e.allOf, Ga(e, r));
}
function no(e, t) {
  let n = e.seen.get(t);
  if (!n) throw Error(`Unprocessed schema. This is a bug in Zod.`);
  let r = (t) => {
    let n = e.seen.get(t);
    if (n.ref === null) return;
    let i = n.def ?? n.schema,
      a = { ...i },
      o = n.ref;
    if (((n.ref = null), o)) {
      r(o);
      let n = e.seen.get(o),
        s = n.schema;
      if (
        (s.$ref &&
        (e.target === `draft-07` ||
          e.target === `draft-04` ||
          e.target === `openapi-3.0`)
          ? ((i.allOf = i.allOf ?? []), i.allOf.push(s))
          : Ga(i, s),
        Ga(i, a),
        t._zod.parent === o)
      )
        for (let e in i)
          e !== `$ref` && e !== `allOf` && (e in a || delete i[e]);
      if (s.$ref && n.def)
        for (let e in i)
          e !== `$ref` &&
            e !== `allOf` &&
            e in n.def &&
            JSON.stringify(i[e]) === JSON.stringify(n.def[e]) &&
            delete i[e];
    }
    let s = t._zod.parent;
    if (s && s !== o) {
      r(s);
      let t = e.seen.get(s);
      if (t?.schema.$ref && ((i.$ref = t.schema.$ref), t.def))
        for (let e in i)
          e !== `$ref` &&
            e !== `allOf` &&
            e in t.def &&
            JSON.stringify(i[e]) === JSON.stringify(t.def[e]) &&
            delete i[e];
    }
    e.override({ zodSchema: t, jsonSchema: i, path: n.path ?? [] });
  };
  if (!e.external || e.sharedEmitDoneFor !== e.external) {
    for (let t of [...e.seen.entries()].reverse()) r(t[0]);
    if (e.target !== `openapi-3.0`)
      for (let t of e.seen.entries()) Xa(t[1].def ?? t[1].schema);
    for (let t of e.deferred) t();
    if (e.intersections.length) {
      let t = new Map();
      for (let n of e.seen.values())
        for (let e of [n.schema, n.def]) {
          let n = e?.allOf;
          if (!Array.isArray(n)) continue;
          let r = t.get(n);
          r ? r.push(e) : t.set(n, [e]);
        }
      for (let n of e.intersections) for (let e of t.get(n) ?? []) to(e);
    }
  }
  let i = {};
  if (
    (e.target === `draft-2020-12`
      ? (i.$schema = `https://json-schema.org/draft/2020-12/schema`)
      : e.target === `draft-07`
        ? (i.$schema = `http://json-schema.org/draft-07/schema#`)
        : e.target === `draft-04`
          ? (i.$schema = `http://json-schema.org/draft-04/schema#`)
          : e.target,
    e.external?.uri)
  ) {
    let n = e.external.registry.get(t)?.id;
    if (!n) throw Error("Schema is missing an `id` property");
    i.$id = e.external.uri(n);
  }
  Ga(i, n.defId ? n.schema : (n.def ?? n.schema));
  let a = e.metadataRegistry.get(t)?.id;
  a !== void 0 && i.id === a && delete i.id;
  let o = e.external?.defs ?? {};
  if (!e.external || e.sharedEmitDoneFor !== e.external)
    for (let t of e.seen.entries()) {
      let e = t[1];
      e.def &&
        e.defId &&
        (e.def.id === e.defId && delete e.def.id, g(o, e.defId, e.def));
    }
  (e.external && (e.sharedEmitDoneFor = e.external),
    e.external ||
      (Object.keys(o).length > 0 &&
        (e.target === `draft-2020-12` ? (i.$defs = o) : (i.definitions = o))));
  try {
    let n = JSON.parse(JSON.stringify(i));
    return (
      Object.defineProperty(n, "~standard", {
        value: {
          ...t[`~standard`],
          jsonSchema: {
            input: io(t, `input`, e.processors),
            output: io(t, `output`, e.processors),
          },
        },
        enumerable: !1,
        writable: !1,
      }),
      n
    );
  } catch {
    throw Error(`Error converting schema to JSON.`);
  }
}
function k(e, t) {
  let n = t ?? { seen: new Set() };
  if (n.seen.has(e)) return !1;
  n.seen.add(e);
  let r = e._zod.def;
  if (r.type === `transform`) return !0;
  if (r.type === `array`) return k(r.element, n);
  if (r.type === `set`) return k(r.valueType, n);
  if (r.type === `lazy`) return k(r.getter(), n);
  if (
    r.type === `promise` ||
    r.type === `optional` ||
    r.type === `nonoptional` ||
    r.type === `nullable` ||
    r.type === `readonly` ||
    r.type === "default" ||
    r.type === `prefault` ||
    r.type === `catch`
  )
    return k(r.innerType, n);
  if (r.type === `intersection`) return k(r.left, n) || k(r.right, n);
  if (r.type === `record` || r.type === `map`)
    return k(r.keyType, n) || k(r.valueType, n);
  if (r.type === `pipe`)
    return e._zod.traits.has(`$ZodCodec`) ? !0 : k(r.in, n) || k(r.out, n);
  if (r.type === `object`) {
    for (let e in r.shape) if (k(r.shape[e], n)) return !0;
    return !1;
  }
  if (r.type === `union`) {
    for (let e of r.options) if (k(e, n)) return !0;
    return !1;
  }
  if (r.type === `tuple`) {
    for (let e of r.items) if (k(e, n)) return !0;
    return !!(r.rest && k(r.rest, n));
  }
  return !1;
}
var ro =
    (e, t = {}) =>
    (n) => {
      let r = Ka({ ...n, processors: t });
      return (O(e, r), Ya(r, e), no(r, e));
    },
  io =
    (e, t, n = {}) =>
    (r) => {
      let { libraryOptions: i, target: a } = r ?? {},
        o = Ka({ ...(i ?? {}), target: a, io: t, processors: n });
      return (O(e, o), Ya(o, e), no(o, e));
    },
  ao = (e, t, n) => {
    (e[t] === void 0 || n > e[t]) && (e[t] = n);
  },
  oo = (e, t, n) => {
    (e[t] === void 0 || n < e[t]) && (e[t] = n);
  },
  so = (e, t) => {
    (ao(e, `minimum`, t), oo(e, `maximum`, t));
  },
  co = (e, t) => {
    ((e.multipleOf ??= []), e.multipleOf.includes(t) || e.multipleOf.push(t));
  },
  lo = (e, t) => {
    ((e.patterns ??= new Set()), e.patterns.add(t));
  },
  uo = (e, t) => {
    e.mime = e.mime ? e.mime.filter((e) => t.includes(e)) : [...t];
  },
  fo = (e, t) => {
    ((e.format = t), t.includes(`int`) && (e.isInt = !0));
  },
  po = (e, t) => ao(e, `minimum`, t.minimum),
  mo = (e, t) => oo(e, `maximum`, t.maximum),
  ho = (e) => (t, n) => {
    fo(t, n.format);
    let [r, i] = e[n.format];
    (ao(t, `minimum`, r), oo(t, `maximum`, i));
  },
  go = {
    greater_than: (e, t) =>
      ao(e, t.inclusive ? `minimum` : `exclusiveMinimum`, t.value),
    less_than: (e, t) =>
      oo(e, t.inclusive ? `maximum` : `exclusiveMaximum`, t.value),
    multiple_of: (e, t) => co(e, t.value),
    number_format: ho(we),
    bigint_format: ho(Te),
    min_length: po,
    max_length: mo,
    length_equals: (e, t) => so(e, t.length),
    min_size: po,
    max_size: mo,
    size_equals: (e, t) => so(e, t.size),
    string_format: (e, t) => {
      (fo(e, t.format),
        t.pattern && lo(e, t.pattern),
        (t.format === `base64` || t.format === `base64url`) &&
          (e.contentEncoding = t.format),
        (t.local || t.precision === -1) && (e.laxFormat = !0));
    },
    mime_type: (e, t) => uo(e, t.mime),
  };
function A(e) {
  let t = {},
    n = e._zod.def,
    r = e._zod.traits.has(`$ZodCheck`)
      ? [e, ...(n.checks ?? [])]
      : (n.checks ?? []);
  for (let e of r) go[e._zod.def.check]?.(t, e._zod.def);
  let i = e._zod.bag;
  (i.minimum !== void 0 && ao(t, `minimum`, i.minimum),
    i.exclusiveMinimum !== void 0 &&
      ao(t, `exclusiveMinimum`, i.exclusiveMinimum),
    i.maximum !== void 0 && oo(t, `maximum`, i.maximum),
    i.exclusiveMaximum !== void 0 &&
      oo(t, `exclusiveMaximum`, i.exclusiveMaximum),
    i.multipleOf !== void 0 && co(t, i.multipleOf),
    i.format !== void 0 &&
      ((t.format ??= i.format), i.format.includes(`int`) && (t.isInt = !0)),
    i.mime && uo(t, i.mime));
  for (let e of i.patterns ?? []) lo(t, e);
  return t;
}
var _o = {
    guid: `uuid`,
    url: `uri`,
    datetime: `date-time`,
    json_string: `json-string`,
    regex: ``,
  },
  vo = new Map([
    [_r, tn],
    [yr, nn],
  ]),
  yo = (e) => vo.get(e) ?? e,
  bo = (e, t, n, r) => {
    let i = n;
    i.type = `string`;
    let {
      minimum: a,
      maximum: o,
      format: s,
      patterns: c,
      contentEncoding: l,
      laxFormat: u,
    } = A(e);
    if (
      (typeof a == `number` && (i.minLength = a),
      typeof o == `number` && (i.maxLength = o),
      s &&
        ((i.format = _o[s] ?? s),
        i.format === `` && delete i.format,
        (s === `time` || u) && delete i.format),
      l && (i.contentEncoding = l),
      c && c.size > 0)
    ) {
      let e = [...c].map(yo);
      e.length === 1
        ? (i.pattern = e[0].source)
        : e.length > 1 &&
          (i.allOf = [
            ...e.map((e) => ({
              ...(t.target === `draft-07` ||
              t.target === `draft-04` ||
              t.target === `openapi-3.0`
                ? { type: `string` }
                : {}),
              pattern: e.source,
            })),
          ]);
    }
  },
  xo = (e, t, n, r) => {
    let i = n,
      {
        minimum: a,
        maximum: o,
        multipleOf: s,
        exclusiveMaximum: c,
        exclusiveMinimum: l,
        isInt: u,
      } = A(e);
    i.type = u ? `integer` : `number`;
    let d = typeof l == `number` && l >= (a ?? -1 / 0),
      f = typeof c == `number` && c <= (o ?? 1 / 0),
      p = t.target === `draft-04` || t.target === `openapi-3.0`;
    if (
      (d
        ? p
          ? ((i.minimum = l), (i.exclusiveMinimum = !0))
          : (i.exclusiveMinimum = l)
        : typeof a == `number` && (i.minimum = a),
      f
        ? p
          ? ((i.maximum = c), (i.exclusiveMaximum = !0))
          : (i.exclusiveMaximum = c)
        : typeof o == `number` && (i.maximum = o),
      s)
    ) {
      let n = new Set();
      for (let a of s)
        Number.isFinite(a) && a !== 0
          ? n.add(Math.abs(a))
          : qa(
              e,
              t,
              i,
              r,
              `A multipleOf divisor of ${a} cannot be represented in JSON Schema`,
            );
      let [a, ...o] = n;
      (a !== void 0 && (i.multipleOf = a),
        o.length &&
          (i.allOf = [
            ...(i.allOf ?? []),
            ...o.map((e) => ({ multipleOf: e })),
          ]));
    }
  },
  So = (e, t, n, r) => {
    n.type = `boolean`;
  },
  Co = (e, t, n, r) => {
    n.not = {};
  },
  wo = (e, t, n, r) => {
    let i = e._zod.def,
      a = h(i.entries);
    a.length === 0
      ? (n.not = {})
      : (a.every((e) => typeof e == `number`) && (n.type = `number`),
        a.every((e) => typeof e == `string`) && (n.type = `string`),
        (n.enum = a));
  },
  To = (e, t, n, r) => {
    let i = e._zod.def;
    if (i.values.length === 0) {
      n.not = {};
      return;
    }
    let a = [];
    for (let o of i.values)
      if (o === void 0) {
        if (
          qa(
            e,
            t,
            n,
            r,
            "Literal `undefined` cannot be represented in JSON Schema",
          )
        )
          return;
      } else if (typeof o == `bigint`) {
        if (
          qa(e, t, n, r, `BigInt literals cannot be represented in JSON Schema`)
        )
          return;
        a.push(Number(o));
      } else a.push(o);
    if (a.length !== 0) {
      if (a.length === 1) {
        let e = a[0];
        ((n.type = e === null ? `null` : typeof e),
          t.target === `draft-04` || t.target === `openapi-3.0`
            ? (n.enum = [e])
            : (n.const = e));
      } else
        (a.every((e) => typeof e == `number`) && (n.type = `number`),
          a.every((e) => typeof e == `string`) && (n.type = `string`),
          a.every((e) => typeof e == `boolean`) && (n.type = `boolean`),
          a.every((e) => e === null) && (n.type = `null`),
          (n.enum = a));
    }
  },
  Eo = (e, t, n, r) => {
    qa(e, t, n, r, `Custom types cannot be represented in JSON Schema`);
  },
  Do = (e, t, n, r) => {
    qa(e, t, n, r, `Transforms cannot be represented in JSON Schema`);
  },
  Oo = (e, t, n, r) => {
    let i = n,
      a = e._zod.def,
      { minimum: o, maximum: s } = A(e);
    (typeof o == `number` && (i.minItems = o),
      typeof s == `number` && (i.maxItems = s),
      (i.type = `array`),
      (i.items = O(a.element, t, { ...r, path: [...r.path, `items`] })));
  };
function ko(e) {
  let t = e._zod.def;
  return t.type === `pipe` && t.in._zod.traits.has(`$ZodTransform`)
    ? ko(t.out)
    : t.type === `catch`
      ? ko(t.innerType)
      : e._zod.optin;
}
var Ao = (e, t, n, r) => {
    let i = n,
      a = e._zod.def,
      o = a.shape;
    if (
      Object.getOwnPropertySymbols(o).length &&
      qa(e, t, i, r, `Symbol keys cannot be represented in JSON Schema`)
    )
      return;
    ((i.type = `object`), (i.properties = {}));
    for (let e in o)
      g(
        i.properties,
        e,
        O(o[e], t, { ...r, path: [...r.path, `properties`, e] }),
      );
    let s = [];
    for (let e of Object.keys(o)) {
      let n = a.shape[e];
      (t.io === `input` ? ko(n) === void 0 : n._zod.optout === void 0) &&
        s.push(e);
    }
    (s.length > 0 && (i.required = s),
      a.catchall?._zod.def.type === `never`
        ? (i.additionalProperties = !1)
        : a.catchall
          ? a.catchall &&
            (i.additionalProperties = O(a.catchall, t, {
              ...r,
              path: [...r.path, `additionalProperties`],
            }))
          : t.io === `output` && (i.additionalProperties = !1));
  },
  jo = (e, t, n, r) => {
    let i = e._zod.def,
      a = i.inclusive === !1,
      o = i.options.map((e, n) =>
        O(e, t, { ...r, path: [...r.path, a ? `oneOf` : `anyOf`, n] }),
      );
    a ? (n.oneOf = o) : (n.anyOf = o);
  },
  Mo = (e, t, n, r) => {
    let i = e._zod.def,
      a = O(i.left, t, { ...r, path: [...r.path, `allOf`, 0] }),
      o = O(i.right, t, { ...r, path: [...r.path, `allOf`, 1] }),
      s = (e) => `allOf` in e && Object.keys(e).length === 1,
      c = [...(s(a) ? a.allOf : [a]), ...(s(o) ? o.allOf : [o])];
    ((n.allOf = c), t.intersections.push(c));
  },
  No = (e, t, n, r) => {
    let i = n,
      a = e._zod.def;
    i.type = `array`;
    let o = t.target === `draft-2020-12` ? `prefixItems` : `items`,
      s =
        t.target === `draft-2020-12` || t.target === `openapi-3.0`
          ? `items`
          : `additionalItems`,
      c = a.items.map((e, n) => O(e, t, { ...r, path: [...r.path, o, n] })),
      l = a.rest
        ? O(a.rest, t, {
            ...r,
            path: [
              ...r.path,
              s,
              ...(t.target === `openapi-3.0` ? [a.items.length] : []),
            ],
          })
        : null,
      u = a.items.length;
    for (; u > 0;) {
      let e = a.items[u - 1];
      if (!(t.io === `input` ? ko(e) !== void 0 : e._zod.optout === `optional`))
        break;
      u--;
    }
    let d = a.items.length,
      f = !a.rest;
    t.target === `draft-2020-12`
      ? ((i.prefixItems = c),
        f ? (i.items = !1) : l && (i.items = l),
        u > 0 && (i.minItems = u),
        f && (i.maxItems = d))
      : t.target === `openapi-3.0`
        ? ((i.items = { anyOf: c }),
          l && i.items.anyOf.push(l),
          u > 0 && (i.minItems = u),
          f && (i.maxItems = d))
        : ((i.items = c),
          f ? (i.additionalItems = !1) : l && (i.additionalItems = l),
          u > 0 && (i.minItems = u),
          f && (i.maxItems = d));
    let { minimum: p, maximum: m } = A(e);
    (typeof p == `number` && (i.minItems = p),
      typeof m == `number` && (i.maxItems = m));
  };
function Po(e, t, n) {
  if (t.$ref) {
    if (n.has(t)) return t;
    n.add(t);
    let r = e.get(t)?.def;
    if (!r) return t;
    let i = Po(e, r, n);
    return i === r ? t : i;
  }
  for (let r of [`anyOf`, `oneOf`]) {
    let i = t[r];
    if (!Array.isArray(i)) continue;
    let a = i.map((t) => Po(e, t, n));
    a.some((e, t) => e !== i[t]) && (t = { ...t, [r]: a });
  }
  let r = Array.isArray(t.type) ? t.type : [t.type],
    i =
      !r.includes(`string`) && r.some((e) => e === `number` || e === `integer`),
    a = t.enum ?? (t.const === void 0 ? void 0 : [t.const]);
  if (!i && !a?.some((e) => typeof e == `number`)) return t;
  let {
    minimum: o,
    maximum: s,
    exclusiveMinimum: c,
    exclusiveMaximum: l,
    multipleOf: u,
    format: d,
    id: f,
    ...p
  } = t;
  return (
    p.enum
      ? (p.enum = p.enum.map((e) => (typeof e == `number` ? String(e) : e)))
      : typeof p.const == `number` && (p.const = String(p.const)),
    i &&
      ((p.type = `string`),
      a || (p.pattern = (r.includes(`number`) ? mn : pn).source)),
    p
  );
}
var Fo = new WeakMap();
function Io(e) {
  let t = new Map();
  for (let n of e.seen.values())
    n.def && !t.has(n.schema) && t.set(n.schema, n);
  let n = new Map();
  for (let r of Fo.get(e) ?? []) {
    let i = e.seen.get(r),
      a = (i?.def ?? i?.schema)?.propertyNames;
    if (!a || a === !0 || n.has(a)) continue;
    let o = Po(t, a, new Set());
    o !== a && n.set(a, o);
  }
  if (n.size)
    for (let t of e.seen.values())
      for (let e of [t.schema, t.def]) {
        let t = e && n.get(e.propertyNames);
        t && (e.propertyNames = t);
      }
}
var Lo = (e, t, n, r) => {
    let i = n,
      a = e._zod.def;
    i.type = `object`;
    let o = a.keyType,
      s = A(o).patterns;
    if (a.mode === `loose` && s && s.size > 0) {
      let e = O(a.valueType, t, {
        ...r,
        path: [...r.path, `patternProperties`, `*`],
      });
      i.patternProperties = {};
      for (let t of s) g(i.patternProperties, yo(t).source, e);
    } else {
      if (t.target === `draft-07` || t.target === `draft-2020-12`) {
        i.propertyNames = O(a.keyType, t, {
          ...r,
          path: [...r.path, `propertyNames`],
        });
        let n = Fo.get(t);
        (n || ((n = []), Fo.set(t, n), t.deferred.push(() => Io(t))),
          n.push(e));
      }
      i.additionalProperties = O(a.valueType, t, {
        ...r,
        path: [...r.path, `additionalProperties`],
      });
    }
    let c = o._zod.values,
      l = t.io === `input` && ko(a.valueType) !== void 0;
    if (c && !a.partial && !l) {
      let e = [...c].filter(
        (e) => typeof e == `string` || typeof e == `number`,
      );
      e.length > 0 && (i.required = e.map(String));
    }
  },
  Ro = (e, t, n, r) => {
    let i = e._zod.def,
      a = O(i.innerType, t, r),
      o = t.seen.get(e);
    t.target === `openapi-3.0`
      ? ((o.ref = i.innerType), (n.nullable = !0))
      : (n.anyOf = [a, { type: `null` }]);
  },
  zo = (e, t, n, r) => {
    let i = e._zod.def;
    O(i.innerType, t, r);
    let a = t.seen.get(e);
    a.ref = i.innerType;
  },
  Bo = Symbol();
function Vo(e, t, n, r, i) {
  let a = !1,
    o = JSON.stringify(e, (e, t) =>
      typeof t == `bigint` ? ((a = !0), null) : t,
    );
  return a
    ? (qa(t, n, r, i, `BigInt defaults cannot be represented in JSON Schema`),
      Bo)
    : JSON.parse(o);
}
var Ho = (e, t, n, r) => {
    let i = e._zod.def;
    O(i.innerType, t, r);
    let a = t.seen.get(e);
    a.ref = i.innerType;
    let o = Vo(i.defaultValue, e, t, n, r);
    o !== Bo && (n.default = o);
  },
  Uo = (e, t, n, r) => {
    let i = e._zod.def;
    O(i.innerType, t, r);
    let a = t.seen.get(e);
    if (((a.ref = i.innerType), t.io !== `input`)) return;
    let o = Vo(i.defaultValue, e, t, n, r);
    o !== Bo && (n._prefault = o);
  },
  Wo = (e, t, n, r) => {
    let i = e._zod.def;
    O(i.innerType, t, r);
    let a = t.seen.get(e);
    a.ref = i.innerType;
    let o;
    try {
      o = i.catchValue(void 0);
    } catch {
      qa(e, t, n, r, `Dynamic catch values are not supported in JSON Schema`);
      return;
    }
    n.default = o;
  },
  Go = (e, t, n, r) => {
    let i = e._zod.def,
      a = i.in._zod.traits.has(`$ZodTransform`),
      o = t.io === `input` ? (a ? i.out : i.in) : i.out;
    O(o, t, r);
    let s = t.seen.get(e);
    s.ref = o;
  },
  Ko = (e, t, n, r) => {
    let i = e._zod.def;
    O(i.innerType, t, r);
    let a = t.seen.get(e);
    ((a.ref = i.innerType), (n.readOnly = !0));
  },
  qo = (e, t, n, r) => {
    let i = e._zod.def;
    O(i.innerType, t, r);
    let a = t.seen.get(e);
    a.ref = i.innerType;
  },
  Jo = new WeakSet([Object.prototype, Error.prototype]);
function Yo(e, t, n) {
  Object.defineProperty(e, t, {
    configurable: !0,
    enumerable: !1,
    get() {
      let e = n(this);
      return (
        Object.defineProperty(this, t, {
          value: e,
          configurable: !0,
          writable: !0,
        }),
        e
      );
    },
    set(e) {
      Object.defineProperty(this, t, {
        value: e,
        configurable: !0,
        writable: !0,
      });
    },
  });
}
var j = S(
    `ZodError`,
    (e, t) => {
      (ht.init(e, t), (e.name = `ZodError`));
      let n = Object.getPrototypeOf(e);
      Jo.has(n) ||
        (Jo.add(n),
        Yo(n, `format`, (e) => (t) => vt(e, t)),
        Yo(n, `flatten`, (e) => (t) => _t(e, t)),
        Yo(n, `addIssue`, (e) => (t) => {
          (e.issues.push(t), (e.message = JSON.stringify(e.issues, te, 2)));
        }),
        Yo(n, `addIssues`, (e) => (t) => {
          (e.issues.push(...t), (e.message = JSON.stringify(e.issues, te, 2)));
        }),
        Object.defineProperty(n, "isEmpty", {
          configurable: !0,
          enumerable: !1,
          get() {
            return this.issues.length === 0;
          },
        }));
    },
    void 0,
    { Parent: Error },
  ),
  Xo = bt(j),
  Zo = xt(j),
  Qo = St(j),
  $o = wt(j),
  es = At(j),
  ts = jt(j),
  ns = Mt(j),
  rs = Nt(j),
  is = Pt(j),
  as = Ft(j),
  os = It(j),
  ss = Lt(j);
function cs() {
  C.localeError || w(Ii());
}
function ls() {
  C.memoizer || w({ memoizer: Ni() });
}
var M = S(
    `ZodType`,
    (e, t) => (cs(), E.init(e, t), (e.def = t), (e.type = t.type), e),
    {
      check(...e) {
        let t = this.def;
        return this.clone(
          v(t, {
            checks: [
              ...(t.checks ?? []),
              ...e.map((e) =>
                typeof e == `function`
                  ? {
                      _zod: {
                        check: e,
                        def: { check: `custom` },
                        onattach: [],
                      },
                    }
                  : e,
              ),
            ],
          }),
          { parent: !0 },
        );
      },
      with(...e) {
        return this.check(...e);
      },
      clone(e, t) {
        return xe(this, e, t);
      },
      brand() {
        return this;
      },
      register(e, t) {
        return (e.add(this, t), this);
      },
      refine(e, t) {
        return this.check(Ec(e, t));
      },
      superRefine(e, t) {
        return this.check(Dc(e, t));
      },
      overwrite(e) {
        return this.check(Pa(e));
      },
      optional() {
        return sc(this);
      },
      exactOptional() {
        return lc(this);
      },
      nullable() {
        return dc(this);
      },
      nullish() {
        return sc(dc(this));
      },
      nonoptional(e) {
        return _c(this, e);
      },
      array() {
        return R(this);
      },
      or(e) {
        return Ks([this, e]);
      },
      and(e) {
        return Xs(this, e);
      },
      transform(e) {
        return xc(this, ac(e));
      },
      default(e) {
        return pc(this, e);
      },
      prefault(e) {
        return hc(this, e);
      },
      catch(e) {
        return yc(this, e);
      },
      pipe(e) {
        return xc(this, e);
      },
      readonly() {
        return Cc(this);
      },
      describe(e) {
        let t = this.clone();
        return (Bi.add(t, { description: e }), t);
      },
      meta(...e) {
        if (e.length === 0) return Bi.get(this);
        let t = this.clone();
        return (Bi.add(t, e[0]), t);
      },
      isOptional() {
        return this.safeParse(void 0).success;
      },
      isNullable() {
        return this.safeParse(null).success;
      },
      apply(e, ...t) {
        return t.length === 0 ? e(this) : e(this, ...t);
      },
      get "~standard"() {
        return Je(this, `~standard`, {
          ...zn(this),
          jsonSchema: { input: io(this, `input`), output: io(this, `output`) },
        });
      },
      set "~standard"(e) {
        qe(this, `~standard`, e);
      },
      parse: function e(t, n) {
        return Xo(this, t, n, { callee: e });
      },
      parseAsync: async function e(t, n) {
        return await Zo(this, t, n, { callee: e });
      },
      safeParse(e, t) {
        return Qo(this, e, t);
      },
      async safeParseAsync(e, t) {
        return $o(this, e, t);
      },
      get spa() {
        return this?.safeParseAsync;
      },
      set spa(e) {
        qe(this, `spa`, e);
      },
      validate(e, t) {
        return Dt(this, e, t);
      },
      validateAsync(e, t) {
        return kt(this, e, t);
      },
      encode: function e(t, n) {
        return es(this, t, n, { callee: e });
      },
      decode: function e(t, n) {
        return ts(this, t, n, { callee: e });
      },
      encodeAsync: async function e(t, n) {
        return await ns(this, t, n, { callee: e });
      },
      decodeAsync: async function e(t, n) {
        return await rs(this, t, n, { callee: e });
      },
      safeEncode(e, t) {
        return is(this, e, t);
      },
      safeDecode(e, t) {
        return as(this, e, t);
      },
      async safeEncodeAsync(e, t) {
        return os(this, e, t);
      },
      async safeDecodeAsync(e, t) {
        return ss(this, e, t);
      },
      toJSONSchema(e) {
        return ro(this, {})(e);
      },
      get description() {
        return Bi.get(this)?.description;
      },
      get _def() {
        return this._zod.def;
      },
    },
  ),
  us = S(
    `_ZodString`,
    (e, t) => {
      (Bn.init(e, t),
        M.init(e, t),
        (e._zod.processJSONSchema = (t, n, r) => bo(e, t, n, r)));
    },
    Ye(
      {
        format: (e) => A(e).format ?? null,
        minLength: (e) => A(e).minimum ?? null,
        maxLength: (e) => A(e).maximum ?? null,
      },
      {
        regex(...e) {
          return this.check(Oa(...e));
        },
        includes(...e) {
          return this.check(ja(...e));
        },
        startsWith(...e) {
          return this.check(Ma(...e));
        },
        endsWith(...e) {
          return this.check(Na(...e));
        },
        min(...e) {
          return this.check(Ea(...e));
        },
        max(...e) {
          return this.check(Ta(...e));
        },
        length(...e) {
          return this.check(Da(...e));
        },
        nonempty(...e) {
          return this.check(Ea(1, ...e));
        },
        lowercase(e) {
          return this.check(ka(e));
        },
        uppercase(e) {
          return this.check(Aa(e));
        },
        trim() {
          return this.check(Ia());
        },
        normalize(...e) {
          return this.check(Fa(...e));
        },
        toLowerCase() {
          return this.check(La());
        },
        toUpperCase() {
          return this.check(Ra());
        },
        slugify() {
          return this.check(za());
        },
      },
    ),
  ),
  ds = S(
    `ZodString`,
    (e, t) => {
      (Bn.init(e, t), us.init(e, t));
    },
    {
      email(e) {
        return this.check(Ui(gs, e));
      },
      url(e) {
        return this.check(Yi(ys, e));
      },
      jwt(e) {
        return this.check(ua(Ps, e));
      },
      emoji(e) {
        return this.check(Xi(bs, e));
      },
      guid(e) {
        return this.check(Wi(_s, e));
      },
      uuid(e) {
        return this.check(Gi(vs, e));
      },
      uuidv4(e) {
        return this.check(Ki(vs, e));
      },
      uuidv6(e) {
        return this.check(qi(vs, e));
      },
      uuidv7(e) {
        return this.check(Ji(vs, e));
      },
      nanoid(e) {
        return this.check(Zi(xs, e));
      },
      cuid(e) {
        return this.check(Qi(Ss, e));
      },
      cuid2(e) {
        return this.check($i(Cs, e));
      },
      ulid(e) {
        return this.check(ea(ws, e));
      },
      base64(e) {
        return this.check(sa(js, e));
      },
      base64url(e) {
        return this.check(ca(Ms, e));
      },
      xid(e) {
        return this.check(ta(Ts, e));
      },
      ksuid(e) {
        return this.check(na(Es, e));
      },
      ipv4(e) {
        return this.check(ra(Ds, e));
      },
      ipv6(e) {
        return this.check(ia(Os, e));
      },
      cidrv4(e) {
        return this.check(aa(ks, e));
      },
      cidrv6(e) {
        return this.check(oa(As, e));
      },
      e164(e) {
        return this.check(la(Ns, e));
      },
      datetime(e) {
        return this.check(da(fs, e));
      },
      date(e) {
        return this.check(fa(ps, e));
      },
      time(e) {
        return this.check(pa(ms, e));
      },
      duration(e) {
        return this.check(ma(hs, e));
      },
    },
  );
function N(e) {
  return Hi(ds, e);
}
var P = S(`ZodStringFormat`, (e, t) => {
    (D.init(e, t), us.init(e, t));
  }),
  fs = S(`ZodISODateTime`, (e, t) => {
    (ar.init(e, t), P.init(e, t));
  }),
  ps = S(`ZodISODate`, (e, t) => {
    (or.init(e, t), P.init(e, t));
  }),
  ms = S(`ZodISOTime`, (e, t) => {
    (sr.init(e, t), P.init(e, t));
  }),
  hs = S(`ZodISODuration`, (e, t) => {
    (cr.init(e, t), P.init(e, t));
  }),
  gs = S(`ZodEmail`, (e, t) => {
    (Un.init(e, t), P.init(e, t));
  }),
  _s = S(`ZodGUID`, (e, t) => {
    (Vn.init(e, t), P.init(e, t));
  }),
  vs = S(`ZodUUID`, (e, t) => {
    (Hn.init(e, t), P.init(e, t));
  }),
  ys = S(`ZodURL`, (e, t) => {
    (Zn.init(e, t), P.init(e, t));
  }),
  bs = S(`ZodEmoji`, (e, t) => {
    (Qn.init(e, t), P.init(e, t));
  }),
  xs = S(`ZodNanoID`, (e, t) => {
    ($n.init(e, t), P.init(e, t));
  }),
  Ss = S(`ZodCUID`, (e, t) => {
    (er.init(e, t), P.init(e, t));
  }),
  Cs = S(`ZodCUID2`, (e, t) => {
    (tr.init(e, t), P.init(e, t));
  }),
  ws = S(`ZodULID`, (e, t) => {
    (nr.init(e, t), P.init(e, t));
  }),
  Ts = S(`ZodXID`, (e, t) => {
    (rr.init(e, t), P.init(e, t));
  }),
  Es = S(`ZodKSUID`, (e, t) => {
    (ir.init(e, t), P.init(e, t));
  }),
  Ds = S(`ZodIPv4`, (e, t) => {
    (lr.init(e, t), P.init(e, t));
  }),
  Os = S(`ZodIPv6`, (e, t) => {
    (fr.init(e, t), P.init(e, t));
  }),
  ks = S(`ZodCIDRv4`, (e, t) => {
    (pr.init(e, t), P.init(e, t));
  }),
  As = S(`ZodCIDRv6`, (e, t) => {
    (hr.init(e, t), P.init(e, t));
  }),
  js = S(`ZodBase64`, (e, t) => {
    (vr.init(e, t), P.init(e, t));
  }),
  Ms = S(`ZodBase64URL`, (e, t) => {
    (xr.init(e, t), P.init(e, t));
  }),
  Ns = S(`ZodE164`, (e, t) => {
    (Sr.init(e, t), P.init(e, t));
  }),
  Ps = S(`ZodJWT`, (e, t) => {
    (wr.init(e, t), P.init(e, t));
  }),
  Fs = S(
    `ZodNumber`,
    (e, t) => {
      (Tr.init(e, t),
        M.init(e, t),
        (e._zod.processJSONSchema = (t, n, r) => xo(e, t, n, r)),
        (e.isFinite = !0));
    },
    Ye(
      {
        minValue: (e) => {
          let { minimum: t, exclusiveMinimum: n } = A(e);
          return Math.max(t ?? -1 / 0, n ?? -1 / 0);
        },
        maxValue: (e) => {
          let { maximum: t, exclusiveMaximum: n } = A(e);
          return Math.min(t ?? 1 / 0, n ?? 1 / 0);
        },
        isInt: (e) => {
          let { isInt: t, multipleOf: n } = A(e);
          return !!t || !!n?.some(Number.isSafeInteger);
        },
        format: (e) => A(e).format ?? null,
      },
      {
        gt(e, t) {
          return this.check(Sa(e, t));
        },
        gte(e, t) {
          return this.check(Ca(e, t));
        },
        min(e, t) {
          return this.check(Ca(e, t));
        },
        lt(e, t) {
          return this.check(ba(e, t));
        },
        lte(e, t) {
          return this.check(xa(e, t));
        },
        max(e, t) {
          return this.check(xa(e, t));
        },
        int(e) {
          return this.check(I(e));
        },
        safe(e) {
          return this.check(I(e));
        },
        positive(e) {
          return this.check(Sa(0, e));
        },
        nonnegative(e) {
          return this.check(Ca(0, e));
        },
        negative(e) {
          return this.check(ba(0, e));
        },
        nonpositive(e) {
          return this.check(xa(0, e));
        },
        multipleOf(e, t) {
          return this.check(wa(e, t));
        },
        step(e, t) {
          return this.check(wa(e, t));
        },
        finite() {
          return this;
        },
      },
    ),
  );
function F(e) {
  return ha(Fs, e);
}
var Is = S(`ZodNumberFormat`, (e, t) => {
  (Er.init(e, t), Fs.init(e, t));
});
function I(e) {
  return ga(Is, e);
}
var Ls = S(`ZodBoolean`, (e, t) => {
  (Dr.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => So(e, t, n, r)));
});
function L(e) {
  return _a(Ls, e);
}
var Rs = S(`ZodUnknown`, (e, t) => {
  (Or.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (e, t, n) => void 0));
});
function zs() {
  return va(Rs);
}
var Bs = S(`ZodNever`, (e, t) => {
  (kr.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Co(e, t, n, r)));
});
function Vs(e) {
  return ya(Bs, e);
}
var Hs = S(
  `ZodArray`,
  (e, t) => {
    (ls(),
      Nr.init(e, t),
      M.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => Oo(e, t, n, r)),
      (e.element = t.element));
  },
  {
    min(e, t) {
      return this.check(Ea(e, t));
    },
    nonempty(e) {
      return this.check(Ea(1, e));
    },
    max(e, t) {
      return this.check(Ta(e, t));
    },
    length(e, t) {
      return this.check(Da(e, t));
    },
    unwrap() {
      return this.element;
    },
  },
);
function R(e, t) {
  return Ba(Hs, e, t);
}
var Us = S(
  `ZodObject`,
  (e, t) => {
    (ls(),
      zr.init(e, t),
      M.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => Ao(e, t, n, r)),
      tt(e, `shape`, (e) => e._zod.def.shape, !1));
  },
  {
    keyof() {
      return nc(Object.keys(this._zod.def.shape));
    },
    catchall(e) {
      return this.clone(v(this._zod.def, { catchall: e }));
    },
    passthrough() {
      return this.clone(v(this._zod.def, { catchall: zs() }));
    },
    loose() {
      return this.clone(v(this._zod.def, { catchall: zs() }));
    },
    strict() {
      return this.clone(v(this._zod.def, { catchall: Vs() }));
    },
    strip() {
      return this.clone(v(this._zod.def, { catchall: void 0 }));
    },
    extend(e) {
      return ke(this, e);
    },
    safeExtend(e) {
      return je(this, e);
    },
    merge(e) {
      return Me(this, e);
    },
    pick(e) {
      return Ee(this, e);
    },
    omit(e) {
      return Oe(this, e);
    },
    partial(...e) {
      return Ne(oc, this, e[0]);
    },
    exactPartial(...e) {
      return Ne(cc, this, e[0], `exactPartial`);
    },
    required(...e) {
      return Pe(gc, this, e[0]);
    },
  },
);
function z(e, t) {
  return new Us({ type: `object`, shape: e ?? {}, ...y(t) });
}
function Ws(e, t) {
  return new Us({ type: `object`, shape: e, catchall: zs(), ...y(t) });
}
var Gs = S(`ZodUnion`, (e, t) => {
  (Vr.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => jo(e, t, n, r)),
    (e.options = t.options));
});
function Ks(e, t) {
  return new Gs({ type: `union`, options: e, ...y(t) });
}
var qs = S(`ZodDiscriminatedUnion`, (e, t) => {
  (Gs.init(e, t), Ur.init(e, t));
});
function Js(e, t, n) {
  return new qs({ type: `union`, options: t, discriminator: e, ...y(n) });
}
var Ys = S(`ZodIntersection`, (e, t) => {
  (Wr.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Mo(e, t, n, r)));
});
function Xs(e, t) {
  return new Ys({ type: `intersection`, left: e, right: t });
}
var Zs = S(
  `ZodTuple`,
  (e, t) => {
    (ls(),
      qr.init(e, t),
      M.init(e, t),
      (e._zod.processJSONSchema = (t, n, r) => No(e, t, n, r)));
  },
  {
    rest(e) {
      return this.clone({ ...this._zod.def, rest: e });
    },
    partial() {
      let e = this._zod.def;
      if (e.checks?.length)
        throw Error(
          `.partial() cannot be used on tuple schemas containing refinements`,
        );
      return this.clone({
        ...e,
        items: e.items.map((e) => new oc({ type: `optional`, innerType: e })),
      });
    },
  },
);
function Qs(e, t, n) {
  let r = t instanceof E;
  return new Zs({
    type: `tuple`,
    items: e,
    rest: r ? t : null,
    ...y(r ? n : t),
  });
}
var $s = S(`ZodRecord`, (e, t) => {
  (ls(),
    Zr.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Lo(e, t, n, r)),
    (e.keyType = t.keyType),
    (e.valueType = t.valueType));
});
function ec(e, t, n) {
  return !t || !t._zod
    ? new $s({ type: `record`, keyType: N(), valueType: e, ...y(t) })
    : new $s({ type: `record`, keyType: e, valueType: t, ...y(n) });
}
var tc = S(`ZodEnum`, (e, t) => {
  (Qr.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => wo(e, t, n, r)),
    (e.enum = t.entries),
    (e.options = [...e._zod.values]));
  let n = new Set(Object.keys(t.entries));
  ((e.extract = (e, r) => {
    let i = {};
    for (let r of e)
      if (n.has(r)) i[r] = t.entries[r];
      else throw Error(`Key ${r} not found in enum`);
    return new tc({ ...t, checks: [], ...y(r), entries: i });
  }),
    (e.exclude = (e, r) => {
      let i = { ...t.entries };
      for (let t of e)
        if (n.has(t)) delete i[t];
        else throw Error(`Key ${t} not found in enum`);
      return new tc({ ...t, checks: [], ...y(r), entries: i });
    }));
});
function nc(e, t) {
  return new tc({
    type: `enum`,
    entries: Array.isArray(e) ? Object.fromEntries(e.map((e) => [e, e])) : e,
    ...y(t),
  });
}
var rc = S(`ZodLiteral`, (e, t) => {
  ($r.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => To(e, t, n, r)),
    (e.values = new Set(t.values)),
    Object.defineProperty(e, "value", {
      get() {
        if (t.values.length > 1)
          throw Error(
            "This schema contains multiple valid literal values. Use `.values` instead.",
          );
        return t.values[0];
      },
    }));
});
function B(e, t) {
  return new rc({
    type: `literal`,
    values: Array.isArray(e) ? e : [e],
    ...y(t),
  });
}
var ic = S(`ZodTransform`, (e, t) => {
  (ls(),
    ei.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Do(e, t, n, r)),
    (e._zod.parse = (n, r) => {
      if (r.direction === `backward`) throw new lt(e.constructor.name);
      n.addIssue = (r) => {
        if (typeof r == `string`) n.issues.push(Ge(r, n.value, t));
        else {
          let t = r;
          (t.fatal && (t.continue = !1),
            (t.code ??= `custom`),
            `input` in t || (t.input = n.value),
            (t.inst ??= e),
            n.issues.push(Ge(t)));
        }
      };
      let i = t.transform(n.value, n);
      return i instanceof Promise
        ? i.then((e) => ((n.value = e), n))
        : ((n.value = i), n);
    }));
});
function ac(e) {
  return new ic({ type: `transform`, transform: e });
}
var oc = S(`ZodOptional`, (e, t) => {
  (ni.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => qo(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType));
});
function sc(e) {
  return new oc({ type: `optional`, innerType: e });
}
var cc = S(`ZodExactOptional`, (e, t) => {
  (ri.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => qo(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType));
});
function lc(e) {
  return new cc({ type: `optional`, innerType: e });
}
var uc = S(`ZodNullable`, (e, t) => {
  (ii.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Ro(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType));
});
function dc(e) {
  return new uc({ type: `nullable`, innerType: e });
}
var fc = S(`ZodDefault`, (e, t) => {
  (ai.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Ho(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeDefault = e.unwrap));
});
function pc(e, t) {
  return new fc({
    type: `default`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : ve(t);
    },
  });
}
var mc = S(`ZodPrefault`, (e, t) => {
  (si.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Uo(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType));
});
function hc(e, t) {
  return new mc({
    type: `prefault`,
    innerType: e,
    get defaultValue() {
      return typeof t == `function` ? t() : ve(t);
    },
  });
}
var gc = S(`ZodNonOptional`, (e, t) => {
  (ci.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => zo(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType));
});
function _c(e, t) {
  return new gc({ type: `nonoptional`, innerType: e, ...y(t) });
}
var vc = S(`ZodCatch`, (e, t) => {
  (di.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Wo(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType),
    (e.removeCatch = e.unwrap));
});
function yc(e, t) {
  return new vc({
    type: `catch`,
    innerType: e,
    catchValue: typeof t == `function` ? t : rt(t),
  });
}
var bc = S(`ZodPipe`, (e, t) => {
  (fi.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Go(e, t, n, r)),
    (e.in = t.in),
    (e.out = t.out));
});
function xc(e, t) {
  return new bc({ type: `pipe`, in: e, out: t });
}
var Sc = S(`ZodReadonly`, (e, t) => {
  (mi.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Ko(e, t, n, r)),
    (e.unwrap = () => e._zod.def.innerType));
});
function Cc(e) {
  return new Sc({ type: `readonly`, innerType: e });
}
var wc = S(`ZodCustom`, (e, t) => {
  (gi.init(e, t),
    M.init(e, t),
    (e._zod.processJSONSchema = (t, n, r) => Eo(e, t, n, r)));
});
function Tc(e, t) {
  return Va(wc, e ?? (() => !0), t);
}
function Ec(e, t = {}) {
  return Ha(wc, e, t);
}
function Dc(e, t) {
  return Ua(e, t);
}
var Oc = `0123456789abcdef`;
function kc(e) {
  let t = ``;
  for (let n = 0; n < e.length; n++) t += String.fromCharCode(e[n] ?? 0);
  return btoa(t);
}
function Ac(e) {
  let t = atob(e),
    n = new Uint8Array(t.length);
  for (let e = 0; e < t.length; e++) n[e] = t.charCodeAt(e);
  return n;
}
function jc(e) {
  let t = ``;
  for (let n of e) t += Oc[n >> 4] + Oc[n & 15];
  return t;
}
function Mc(e) {
  let t = new Uint8Array(e.length / 2);
  for (let n = 0; n < t.length; n++)
    t[n] = Number.parseInt(e.slice(n * 2, n * 2 + 2), 16);
  return t;
}
var Nc = (e) => kc(Mc(e)),
  Pc = (e) => jc(Ac(e)),
  Fc = (e) => e.replace(/\+/g, `-`).replace(/\//g, `_`).replace(/=+$/, ``),
  Ic = (e) => {
    let t = e.length % 4;
    return (
      e.replace(/-/g, `+`).replace(/_/g, `/`) + (t ? `=`.repeat(4 - t) : ``)
    );
  },
  Lc = (e) => Fc(kc(e)),
  Rc = (e) => Ac(Ic(e)),
  zc = 1024;
function Bc(e) {
  if (e.length > 1368 || e.length % 4 != 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(e))
    return !1;
  try {
    let t = Ac(e).length;
    return t > 0 && t <= 1024;
  } catch {
    return !1;
  }
}
var Vc = z({
  uncompressedSize: F().int().nonnegative(),
  data: N().regex(/^[A-Za-z0-9_-]*$/),
});
function Hc(e) {
  if (!e) return { badLargeBlob: !1 };
  let t = `largeBlob` in e && !Vc.safeParse(e.largeBlob).success,
    { largeBlob: n, ...r } = e,
    i = t ? r : e;
  return { kept: Object.keys(i).length ? i : void 0, badLargeBlob: t };
}
function Uc(e, t, n) {
  if (r(t)) return [];
  let i = n?.length ? new Set(n) : null,
    a = [];
  for (let n of e)
    if (n.type === `login` && n.passkeys && n.archivedAt === void 0)
      for (let e of n.passkeys)
        e.rpId === t &&
          (!i || i.has(e.credentialId)) &&
          a.push({ entryId: n.id, passkey: e });
  return a;
}
function Wc(e, t) {
  let n = t.toLowerCase();
  for (let t of e) {
    if (!t) continue;
    let e = s(t).toLowerCase();
    if (e === n || e.endsWith(`.${n}`)) return !0;
  }
  return !1;
}
function Gc(e, t) {
  return e.filter(
    (e) => e.type === `login` && e.archivedAt === void 0 && Wc(e.urls, t),
  );
}
function Kc(e, t, n) {
  let r = Gc(e, t);
  if (r.length <= 1) return r[0];
  let i = n?.trim().toLowerCase();
  if (!i) return;
  let a = r.filter((e) => e.username.trim().toLowerCase() === i);
  return a.length === 1 ? a[0] : void 0;
}
function qc(e, t) {
  return [...(e ?? []).filter((e) => e.credentialId !== t.credentialId), t];
}
function Jc(e, t) {
  return { kind: `attach`, entryId: e.id, passkey: t };
}
function Yc(e, t, n) {
  return {
    kind: `create`,
    data: {
      type: `login`,
      name: t?.trim() || e,
      urls: [`https://${e}`],
      username: n.userName ?? n.userDisplayName ?? ``,
      password: ``,
      passkeys: [n],
    },
  };
}
function Xc(e, t, n, i) {
  if (r(t))
    return {
      kind: `create`,
      data: { type: `unlock-key`, name: t, passkey: i },
    };
  let a = Kc(e, t, i.userName);
  return a ? Jc(a, i) : Yc(t, n, i);
}
var V = z({
    wall: F().int().nonnegative(),
    counter: F().int().nonnegative(),
    node: N().min(1),
  }),
  Zc = 2147483647,
  Qc = 3e5;
function H(e, t) {
  return e.wall === t.wall
    ? e.counter === t.counter
      ? e.node === t.node
        ? 0
        : e.node < t.node
          ? -1
          : 1
      : e.counter < t.counter
        ? -1
        : 1
    : e.wall < t.wall
      ? -1
      : 1;
}
function U(e, t = Date.now()) {
  return e.wall > t + Qc;
}
function $c(e, t) {
  let n = (e - t) * 1e3;
  return n > 3e5 ? Math.round(n / 6e4) : null;
}
function el(e) {
  return `${e.wall}:${e.counter}:${e.node}`;
}
var tl = class {
    node;
    now;
    wall = 0;
    counter = 0;
    constructor(e, t = () => Date.now()) {
      if (((this.node = e), (this.now = t), e.length === 0))
        throw Error(`HybridClock requires a non-empty node id`);
    }
    send() {
      let e = this.now(),
        t = Math.max(this.wall, e);
      return this.advance(t, t === this.wall ? this.counter + 1 : 0);
    }
    receive(e) {
      let t = this.now(),
        n = this.wall,
        r = Math.min(e.wall, t + Qc),
        i = Math.max(n, r, t),
        a = 0;
      return (
        i === n && i === r
          ? (a = Math.max(this.counter, e.counter) + 1)
          : i === n
            ? (a = this.counter + 1)
            : i === r && (a = e.counter + 1),
        this.advance(i, a)
      );
    }
    witness(e) {
      this.receive(e);
    }
    advance(e, t) {
      return (
        t > Zc
          ? ((this.wall = e + 1), (this.counter = 0))
          : ((this.wall = e), (this.counter = t)),
        { wall: this.wall, counter: this.counter, node: this.node }
      );
    }
  },
  nl = ec(N(), V),
  rl = (e, t) => (e ? (t ? (H(e, t) >= 0 ? e : t) : e) : t),
  il = (e, t) => t !== void 0 && H(e, t) <= 0;
function al(e) {
  return e.vv
    ? e.floor
      ? { vv: e.vv, floor: e.floor }
      : { vv: e.vv }
    : { vv: {}, floor: e.hlc };
}
function ol(e) {
  if (!e.vv) return e.hlc.node;
  for (let [t, n] of Object.entries(e.vv)) if (H(n, e.hlc) === 0) return t;
  return e.hlc.node;
}
function sl(e, t, n) {
  return il(n, e.floor) || il(n, e.vv[t]);
}
function cl(e, t, n) {
  return sl(al(n), e, t);
}
var ll = `~merge:`;
function ul(e, t) {
  let n = ol(e);
  if (cl(n, e.hlc, t)) return !0;
  if (!e.vv || !n.startsWith(`~merge:`)) return !1;
  let { [n]: r, ...i } = e.vv;
  return dl(t, { hlc: e.hlc, vv: i, ...(e.floor ? { floor: e.floor } : {}) });
}
function dl(e, t) {
  let n = al(e),
    r = al(t);
  return r.floor && !il(r.floor, n.floor)
    ? !1
    : Object.entries(r.vv).every(([e, t]) => sl(n, e, t));
}
function fl(e) {
  let t = {},
    n;
  for (let r of e) {
    let e = al(r);
    n = rl(n, e.floor);
    for (let [n, r] of Object.entries(e.vv)) {
      let e = t[n];
      (!e || H(r, e) > 0) && (t[n] = r);
    }
  }
  return n ? { vv: t, floor: n } : { vv: t };
}
function pl(e, t) {
  let n;
  for (let r of t)
    n = rl(n, r.vv ? r.vv[e] : r.hlc.node === e ? r.hlc : void 0);
  return n;
}
function ml(e) {
  let t = fl(e.bases),
    n = [...e.held, ...e.bases],
    r = (e) => {
      let r = pl(e, n);
      return r === void 0 || sl(t, e, r);
    },
    i = e.hlc.node,
    a = i;
  if (!r(i)) {
    let t = `${i}~`;
    a =
      [...new Set(n.flatMap((e) => Object.keys(e.vv ?? {})))]
        .filter((e) => e.startsWith(t))
        .sort()
        .find(r) ?? `${t}${el(e.hlc)}`;
  }
  let o = { ...t.vv, [a]: e.hlc };
  return t.floor ? { vv: o, floor: t.floor } : { vv: o };
}
function hl(e) {
  let t = ml(e),
    n = ol({ hlc: e.hlc, ...t });
  if (n === e.hlc.node) return { hlc: e.hlc, causal: t };
  let r = { ...e.hlc, node: n };
  return { hlc: r, causal: { ...t, vv: { ...t.vv, [n]: r } } };
}
function gl(e, t = Date.now()) {
  return U(e.hlc, t) || (e.floor && U(e.floor, t))
    ? !0
    : Object.values(e.vv ?? {}).some((e) => U(e, t));
}
function _l(e) {
  let t = e.vv
    ? Object.entries(e.vv)
        .sort(([e], [t]) => (e < t ? -1 : +(e > t)))
        .map(([e, t]) => `${e}=${el(t)}`)
        .join(`,`)
    : `-`;
  return `${el(e.hlc)}|${t}|${e.floor ? el(e.floor) : ``}`;
}
var W = new Uint8Array([86, 76, 84, 49]),
  vl = W.length + 1 + 1,
  yl = 3,
  bl = 124,
  xl = 142,
  Sl = [1, 2, 3],
  Cl = Tc((e) => e instanceof Uint8Array, `expected Uint8Array`),
  G = (e, t) =>
    Cl.refine((t) => t.length === e, { message: `${t} must be ${e} bytes` }),
  wl = z({
    kind: B(1),
    slotId: G(16, `slotId`),
    salt: G(16, `salt`),
    verifier: G(32, `verifier`),
    wrapIv: G(12, `wrapIv`),
    wrappedVek: G(48, `wrappedVek`),
  }),
  Tl = z({
    kind: B(2),
    slotId: G(16, `slotId`),
    credentialId: Cl.refine((e) => e.length >= 1 && e.length <= 65535, {
      message: `credentialId must be 1..65535 bytes`,
    }),
    salt: G(32, `salt`),
    verifier: G(32, `verifier`),
    wrapIv: G(12, `wrapIv`),
    wrappedVek: G(48, `wrappedVek`),
  }),
  El = z({
    kind: B(3),
    slotId: G(16, `slotId`),
    salt: G(16, `salt`),
    verifier: G(32, `verifier`),
    wrapIv: G(12, `wrapIv`),
    wrappedVek: G(48, `wrappedVek`),
  }),
  Dl = Ks([
    wl,
    Tl,
    El,
    z({
      kind: F().refine((e) => !Sl.includes(e), {
        message: `opaque slot kind is reserved`,
      }),
      payload: Cl,
    }),
  ]),
  Ol = z({
    id: N(),
    wrappedDek: N(),
    dekIv: N(),
    ciphertext: N(),
    iv: N(),
    hlc: V,
    vv: nl.optional(),
    floor: V.optional(),
    localOnly: B(!0).optional(),
  }),
  kl = z({
    slots: R(Dl)
      .min(1, { message: `vault must have at least one slot` })
      .max(16, { message: `vault has more slots than the max of 16` }),
    entriesIv: G(12, `entriesIv`),
    entriesCiphertext: Cl,
  });
function Al() {
  let e = new Uint8Array(W.length + 1);
  return (e.set(W, 0), (e[W.length] = 2), e);
}
function jl(e) {
  let t = new Uint8Array(bl),
    n = 0;
  return (
    t.set(e.slotId, n),
    (n += 16),
    t.set(e.salt, n),
    (n += 16),
    t.set(e.verifier, n),
    (n += 32),
    t.set(e.wrapIv, n),
    (n += 12),
    t.set(e.wrappedVek, n),
    t
  );
}
function Ml(e) {
  let t = new Uint8Array(xl + e.credentialId.length),
    n = 0;
  return (
    t.set(e.slotId, n),
    (n += 16),
    (t[n++] = (e.credentialId.length >> 8) & 255),
    (t[n++] = e.credentialId.length & 255),
    t.set(e.credentialId, n),
    (n += e.credentialId.length),
    t.set(e.salt, n),
    (n += 32),
    t.set(e.verifier, n),
    (n += 32),
    t.set(e.wrapIv, n),
    (n += 12),
    t.set(e.wrappedVek, n),
    t
  );
}
function Nl(e) {
  return e.kind === 1
    ? jl(e)
    : e.kind === 2
      ? Ml(e)
      : e.kind === 3
        ? jl(e)
        : e.payload;
}
function Pl(e) {
  let t = 0,
    n = e.slice(t, t + 16);
  t += 16;
  let r = e.slice(t, t + 16);
  t += 16;
  let i = e.slice(t, t + 32);
  t += 32;
  let a = e.slice(t, t + 12);
  return (
    (t += 12),
    {
      slotId: n,
      salt: r,
      verifier: i,
      wrapIv: a,
      wrappedVek: e.slice(t, t + 48),
    }
  );
}
function Fl(e) {
  if (e.length < 143)
    throw Error(`webauthn slot payload too short: ${e.length}`);
  let t = 16,
    n = e.slice(0, t),
    r = ((e[t] << 8) | e[t + 1]) & 65535;
  if (((t += 2), t + r + 32 + 32 + 12 + 48 !== e.length))
    throw Error(`webauthn slot payload length mismatch (credIdLen=${r})`);
  let i = e.slice(t, t + r);
  t += r;
  let a = e.slice(t, t + 32);
  t += 32;
  let o = e.slice(t, t + 32);
  t += 32;
  let s = e.slice(t, t + 12);
  t += 12;
  let c = e.slice(t, t + 48);
  return Tl.parse({
    kind: 2,
    slotId: n,
    credentialId: i,
    salt: a,
    verifier: o,
    wrapIv: s,
    wrappedVek: c,
  });
}
function Il(e, t) {
  return e === 1
    ? wl.parse({ kind: e, ...Pl(t) })
    : e === 2
      ? Fl(t)
      : e === 3
        ? El.parse({ kind: e, ...Pl(t) })
        : { kind: e, payload: t };
}
function Ll(e) {
  let t = kl.parse(e),
    n = t.slots.map(Nl),
    r = 0;
  for (let e of n) {
    if (e.length > 65535)
      throw Error(`slot payload too large (${e.length} bytes, max 65535)`);
    r += yl + e.length;
  }
  let i = new Uint8Array(vl + r + 12 + t.entriesCiphertext.length),
    a = 0;
  (i.set(W, a), (a += W.length), (i[a++] = 2), (i[a++] = t.slots.length));
  for (let e = 0; e < t.slots.length; e++) {
    let r = t.slots[e],
      o = n[e];
    ((i[a++] = r.kind),
      (i[a++] = (o.length >> 8) & 255),
      (i[a++] = o.length & 255),
      i.set(o, a),
      (a += o.length));
  }
  return (i.set(t.entriesIv, a), (a += 12), i.set(t.entriesCiphertext, a), i);
}
function Rl(e) {
  if (e.length < vl)
    throw Error(
      `vault blob too short: ${e.length} bytes (need at least ${vl})`,
    );
  for (let t = 0; t < W.length; t++)
    if (e[t] !== W[t])
      throw Error(`invalid vault magic bytes (not a VLT1 file)`);
  let t = e[W.length];
  if (t !== 2) throw Error(`unsupported vault version: ${t} (expected 2)`);
  let n = e[W.length + 1];
  if (n === 0) throw Error(`vault has no slots`);
  if (n > 16) throw Error(`vault has ${n} slots (max 16)`);
  let r = [],
    i = vl;
  for (let t = 0; t < n; t++) {
    if (i + yl > e.length)
      throw Error(`slot ${t} truncated (header overruns blob)`);
    let n = e[i++],
      a = ((e[i] << 8) | e[i + 1]) & 65535;
    if (((i += 2), i + a > e.length))
      throw Error(`slot ${t} truncated (payload overruns blob)`);
    let o = e.slice(i, i + a);
    ((i += a), r.push(Il(n, o)));
  }
  if (i + 12 > e.length)
    throw Error(`vault blob truncated (entries IV overruns blob)`);
  let a = e.slice(i, i + 12);
  return ((i += 12), { slots: r, entriesIv: a, entriesCiphertext: e.slice(i) });
}
function zl(e) {
  for (let t of e.slots) if (t.kind === 1) return t;
  return null;
}
function Bl(e) {
  let t = [];
  for (let n of e.slots) n.kind === 2 && t.push(n);
  return t;
}
function Vl(e) {
  let t = [];
  for (let n of e.slots) n.kind === 3 && t.push(n);
  return t;
}
var Hl = 1e3,
  Ul = 1e4,
  Wl = /^[A-Za-z0-9_-]{43}$/,
  Gl = /^[A-Za-z0-9_-]{22}$/,
  Kl = /^[A-Za-z0-9+/]{43}=$/,
  ql = /^[0-9a-f]{64}$/,
  Jl = N().regex(Kl);
N().regex(Wl);
var Yl = N().regex(Gl),
  Xl = N().regex(ql),
  Zl = I().min(1).max(3650),
  Ql = (e = 0) => R(Jl).min(e).max(64);
(z({ members: Ql(1), retentionDays: Zl.optional() }),
  z({ retentionDays: Zl }),
  z({ add: Ql().default([]), remove: Ql().default([]) }),
  z({ active: L() }),
  z({
    id: Yl,
    to: N()
      .transform((e) => e.split(`,`))
      .pipe(Ql(1))
      .optional(),
  }),
  z({ replaces: R(Yl).min(1).max(Hl) }),
  z({
    messages: R(Yl).max(Hl).default([]),
    blobs: R(Xl).max(Hl).default([]),
    markers: R(I().min(1)).max(Hl).default([]),
  }),
  z({ hashes: R(Xl).max(Ul) }),
  z({
    members: R(
      z({
        sigKey: Jl,
        status: nc([`eligible`, `active`]),
        lastCheckedDay: I().nullable(),
      }),
    ),
  }),
  z({ stored: L(), recipients: I().min(0) }),
  z({
    messages: R(z({ id: Yl, sender: Jl, size: I(), createdAt: I() })),
    blobs: R(z({ hash: Xl, size: I(), uploader: Jl, createdAt: I() })),
    wanted: R(Xl),
    wantedMore: L(),
    markers: R(z({ id: I(), sender: Jl, count: I(), expiredAt: I() })),
    more: L(),
    retentionDays: I(),
    usedBytes: I(),
    quotaBytes: I().nullable(),
    serverTime: I(),
  }),
  z({ wantedAfter: Xl.optional() }),
  z({
    error: nc([
      `bad_request`,
      `bad_signature`,
      `stale_time`,
      `token_required`,
      `not_member`,
      `not_active`,
      `not_eligible`,
      `not_found`,
      `exists`,
      `id_conflict`,
      `too_large`,
      `quota_exceeded`,
      `hash_mismatch`,
      `collect_only`,
    ]),
    serverTime: I().optional(),
  }));
var $l = z({ id: N(), hlc: V, vv: nl.optional(), floor: V.optional() }),
  eu = z({ hlc: V, value: zs() }),
  tu = ec(N(), eu),
  nu = z({
    id: N(),
    hlc: V,
    entryId: N().optional(),
    hash: N().regex(ql, `hash must be lowercase hex sha-256`),
    size: F().int().nonnegative(),
    wrappedFek: N(),
    fekIv: N(),
    noncePrefix: N(),
    metaBlob: N(),
    metaIv: N(),
  }),
  ru = z({
    entries: R(Ol),
    tombstones: R($l),
    settings: tu.optional(),
    files: R(nu).optional(),
    fileTombstones: R($l).optional(),
    fileCascades: R($l).optional(),
    conflicts: R(Ol).optional(),
  });
function iu(e) {
  let t = (e) => !e.localOnly;
  return {
    ...e,
    entries: e.entries.filter(t),
    ...(e.conflicts ? { conflicts: e.conflicts.filter(t) } : {}),
  };
}
function au(e) {
  return e.includes(`"localOnly"`) ? su(iu(cu(e))) : e;
}
function ou() {
  return { entries: [], tombstones: [] };
}
function su(e) {
  return JSON.stringify(ru.parse(e));
}
function cu(e) {
  return ru.parse(JSON.parse(e));
}
function lu(e, t = Date.now()) {
  let n = e.settings
      ? Object.fromEntries(
          Object.entries(e.settings).filter(([, e]) => !U(e.hlc, t)),
        )
      : void 0,
    r = e.files?.filter((e) => !U(e.hlc, t)),
    i = e.fileTombstones?.filter((e) => !U(e.hlc, t)),
    a = e.fileCascades?.filter((e) => !U(e.hlc, t)),
    o = e.conflicts?.filter((e) => !gl(e, t));
  return {
    entries: e.entries.filter((e) => !gl(e, t)),
    tombstones: e.tombstones.filter((e) => !gl(e, t)),
    ...(n ? { settings: n } : {}),
    ...(r ? { files: r } : {}),
    ...(i ? { fileTombstones: i } : {}),
    ...(a ? { fileCascades: a } : {}),
    ...(o ? { conflicts: o } : {}),
  };
}
function uu(e, t = []) {
  let n = new Map();
  for (let t of e) {
    let e = n.get(t.id);
    (!e || H(t.hlc, e.hlc) > 0) && n.set(t.id, t);
  }
  let r = new Map();
  for (let [e, n] of t) {
    let t = r.get(e);
    (!t || H(n, t) > 0) && r.set(e, n);
  }
  return { records: n, tombstones: r };
}
function du(e, t) {
  let n = new Map();
  for (let r of [e.records, t.records])
    for (let [e, t] of r) {
      let r = n.get(e);
      (!r || H(t.hlc, r.hlc) > 0) && n.set(e, t);
    }
  let r = new Map();
  for (let n of [e.tombstones, t.tombstones])
    for (let [e, t] of n) {
      let n = r.get(e);
      (!n || H(t, n) > 0) && r.set(e, t);
    }
  return { records: n, tombstones: r };
}
function fu(e) {
  let t = [];
  for (let [n, r] of e.records) {
    let i = e.tombstones.get(n);
    (!i || H(r.hlc, i) > 0) && t.push(r);
  }
  return t;
}
function pu(e) {
  return uu(
    e.files ?? [],
    (e.fileTombstones ?? []).map((e) => [e.id, e.hlc]),
  );
}
function mu(e, t) {
  let n = new Map();
  for (let r of [...e, ...t]) {
    let e = n.get(r.id);
    (!e || H(r.hlc, e) > 0) && n.set(r.id, r.hlc);
  }
  return [...n].map(([e, t]) => ({ id: e, hlc: t }));
}
function hu(e, t) {
  let n = new Set((e.fileCascades ?? []).map((e) => e.id));
  return fu(pu(e)).filter(
    (e) => e.entryId === void 0 || t.has(e.entryId) || !n.has(e.id),
  );
}
function gu(e) {
  return hu(e, new Set(e.entries.map((e) => e.id)));
}
function _u(e) {
  let t = new Map();
  for (let n of e) {
    let e = `${n.hlc.wall}:${n.hlc.counter}:${n.hlc.node}`,
      r = t.get(e);
    (!r || (!r.vv && n.vv)) && t.set(e, n);
  }
  return [...t.values()];
}
function vu(e, t) {
  if (!e) return t;
  if (!t) return e;
  if (H(e.hlc, t.hlc) === 0 && !(e.vv && t.vv)) return e.vv ? e : t;
  if (!e.vv && cl(ol(e), e.hlc, t)) return t;
  if (!t.vv && cl(ol(t), t.hlc, e)) return e;
  let n = H(e.hlc, t.hlc) >= 0 ? e.hlc : t.hlc,
    { vv: r, floor: i } = fl([e, t]);
  return Object.keys(r).length === 0 && i && H(i, n) === 0
    ? { id: e.id, hlc: n }
    : i
      ? { id: e.id, hlc: n, vv: r, floor: i }
      : { id: e.id, hlc: n, vv: r };
}
function yu(e) {
  return [..._u(e)].sort((e, t) => H(t.hlc, e.hlc)).slice(0, 1);
}
function bu(e, t) {
  let n = [];
  for (let r of [..._u(e)].sort((e, t) => H(t.hlc, e.hlc)))
    (t && ul(r, t)) || n.some((e) => ul(r, e)) || n.push(r);
  return n;
}
function xu(e, t) {
  let n = [],
    r = new Map(),
    i = (e) => {
      let t = r.get(e.id);
      t ? t.push(e) : (r.set(e.id, [e]), n.push(e.id));
    };
  for (let t of e.entries) i(t);
  for (let e of t.entries) i(e);
  for (let t of e.conflicts ?? []) i(t);
  for (let e of t.conflicts ?? []) i(e);
  let a = new Map();
  for (let n of [...e.tombstones, ...t.tombstones]) {
    let e = vu(a.get(n.id), n);
    e && a.set(n.id, e);
  }
  let o = du(pu(e), pu(t)),
    s = fu(o),
    c = [...o.tombstones].map(([e, t]) => ({ id: e, hlc: t })),
    l = mu(e.fileCascades ?? [], t.fileCascades ?? []),
    u = new Set(l.map((e) => e.id)),
    d = new Set(
      s.flatMap((e) =>
        e.entryId !== void 0 && !u.has(e.id) ? [e.entryId] : [],
      ),
    ),
    f = [],
    p = [];
  for (let e of n) {
    let t = r.get(e) ?? [],
      n = bu(t, a.get(e));
    n.length === 0 && d.has(e) && (n = yu(t));
    let [i, ...o] = n;
    (i && f.push(i), p.push(...o));
  }
  let m = { entries: f, tombstones: [...a.values()] };
  p.length > 0 && (m.conflicts = p);
  let h = wu(e.settings, t.settings);
  return {
    ...m,
    ...(h ? { settings: h } : {}),
    ...(s.length > 0 ? { files: s } : {}),
    ...(c.length > 0 ? { fileTombstones: c } : {}),
    ...(l.length > 0 ? { fileCascades: l } : {}),
  };
}
function Su(e, t) {
  return [
    ...e.entries.filter((e) => e.id === t),
    ...(e.conflicts ?? []).filter((e) => e.id === t),
    ...e.tombstones.filter((e) => e.id === t),
  ];
}
function Cu(e) {
  let t = new Map();
  for (let n of e.conflicts ?? []) t.set(n.id, [...(t.get(n.id) ?? []), n]);
  let n = new Map(e.tombstones.map((e) => [e.id, e])),
    r = new Map();
  for (let i of e.entries) {
    let e = t.get(i.id) ?? [],
      a = n.get(i.id),
      o = !!a && ![i, ...e].some((e) => dl(e, a));
    (e.length > 0 || o) && r.set(i.id, { versions: e.length, deleted: o });
  }
  return r;
}
function wu(e, t) {
  if (!e) return t;
  if (!t) return e;
  let n = { ...e };
  for (let [e, r] of Object.entries(t)) {
    let t = n[e];
    (!t || H(r.hlc, t.hlc) > 0) && (n[e] = r);
  }
  return n;
}
var Tu = new TextEncoder();
async function Eu(e) {
  let t = typeof e == `string` ? Tu.encode(e) : e,
    n = await crypto.subtle.digest(`SHA-256`, new Uint8Array(t));
  return jc(new Uint8Array(n));
}
var Du = (function () {
    let e = typeof document < `u` && document.createElement(`link`).relList;
    return e && e.supports && e.supports(`modulepreload`)
      ? `modulepreload`
      : `preload`;
  })(),
  Ou = function (e) {
    return `/` + e;
  },
  ku = {},
  Au = function (e) {
    return e.pathname.endsWith(`.css`);
  },
  ju = function (e, t, n) {
    if (t in e) return e[t];
    let r = n();
    if (!r) {
      e[t] = void 0;
      return;
    }
    let i = r.then(
      () => {
        e[t] = void 0;
      },
      (n) => {
        throw ((e[t] = void 0), n);
      },
    );
    return ((e[t] = i), i);
  },
  Mu = function (e, t, n) {
    let r = Promise.resolve();
    if (t && t.length > 0) {
      let e,
        i = document.querySelector(`meta[property=csp-nonce]`),
        a = i?.nonce || i?.getAttribute(`nonce`);
      function o(e) {
        return Promise.all(
          e.map((e) =>
            Promise.resolve(e).then(
              (e) => ({ status: `fulfilled`, value: e }),
              (e) => ({ status: `rejected`, reason: e }),
            ),
          ),
        );
      }
      function s(e) {
        return import.meta.resolve
          ? new URL(import.meta.resolve(e))
          : new URL(e, import.meta.url);
      }
      r = o(
        t
          .map((t) => {
            t = Ou(t, n);
            let r = s(t),
              i = Au(r);
            return ju(ku, r.href, () => {
              if (e === void 0) {
                e = { all: new Set(), styles: new Set() };
                let t = document.getElementsByTagName(`link`);
                for (let n = t.length - 1; n >= 0; n--) {
                  let r = t[n];
                  (e.all.add(r.href),
                    r.rel === `stylesheet` && e.styles.add(r.href));
                }
              }
              if ((i ? e.styles : e.all).has(r.href)) return;
              let t = document.createElement(`link`);
              if (
                ((t.rel = i ? `stylesheet` : Du),
                i || (t.as = `script`),
                (t.crossOrigin = ``),
                (t.href = r.href),
                a && t.setAttribute(`nonce`, a),
                document.head.appendChild(t),
                i)
              )
                return new Promise((e, n) => {
                  (t.addEventListener(`load`, e),
                    t.addEventListener(`error`, () =>
                      n(Error(`Unable to preload CSS for ${r}`)),
                    ));
                });
            });
          })
          .filter((e) => e !== void 0),
      );
    }
    function i(e) {
      let t = new Event(`vite:preloadError`, { cancelable: !0 });
      if (((t.payload = e), window.dispatchEvent(t), !t.defaultPrevented))
        throw e;
    }
    return r.then((t) => {
      for (let e of t || []) e.status === `rejected` && i(e.reason);
      return e().catch(i);
    });
  },
  Nu = 9783072e5,
  Pu = 864e5;
function Fu(e, t = Date.now()) {
  let n = t + Pu;
  return e > n && e - 9783072e5 <= n ? e - Nu : e;
}
var Iu = z({ key: N(), value: N(), hidden: L().optional() }),
  Lu = {
    name: N(),
    notes: N().optional(),
    customFields: R(Iu).optional(),
    createdAt: F().optional(),
    updatedAt: F().optional(),
    lastUsedAt: F().optional(),
    archivedAt: F().optional(),
    tags: R(N()).optional(),
    partStamps: ec(N(), V).optional(),
    itemStamps: z({
      urls: ec(N(), V).optional(),
      tags: ec(N(), V).optional(),
      passkeys: ec(N(), V).optional(),
    }).optional(),
    partStampsAt: V.optional(),
  },
  Ru = z({
    credentialId: N(),
    rpId: N(),
    rpName: N().optional(),
    userHandle: N(),
    userName: N().optional(),
    userDisplayName: N().optional(),
    alg: F(),
    publicKeyCose: N(),
    privateKey: N(),
    signCount: F(),
    createdAt: F(),
    lastUsedAt: F().optional(),
    prf: z({
      credWithUV: N().refine(Bc),
      credWithoutUV: N().refine(Bc),
    }).optional(),
    fido2Extensions: Ws({ largeBlob: Vc.optional() }).optional(),
  }),
  zu = z({ value: N(), changedAt: F() }),
  Bu = Js(`type`, [
    z({
      ...Lu,
      type: B(`login`),
      urls: R(N()),
      username: N(),
      password: N(),
      totp: N().optional(),
      breach: z({ leaked: L(), checkedAt: F() }).optional(),
      autofillEnabled: L().optional(),
      autoSubmit: L().optional(),
      subdomainMatch: nc([`etld1`, `exact`, `subdomain`]).optional(),
      passkeys: R(Ru).optional(),
      passwordChangelog: R(zu).optional(),
    }),
    z({
      ...Lu,
      type: B(`card`),
      cardholderName: N(),
      number: N(),
      brand: N().optional(),
      expMonth: N(),
      expYear: N(),
      cvv: N(),
    }),
    z({ ...Lu, type: B(`note`) }),
    z({
      ...Lu,
      type: B(`ssh-key`),
      publicKey: N(),
      privateKey: N(),
      passphrase: N().optional(),
      keyType: N().optional(),
    }),
    z({ ...Lu, type: B(`unlock-key`), passkey: Ru }),
  ]);
function Vu(e) {
  let t = e.type ? { ...e } : { type: `login`, ...e };
  if (t.type === `login` && !Array.isArray(t.urls)) {
    let e = typeof t.url == `string` ? t.url : ``;
    ((t.urls = e ? [e] : []), delete t.url);
  }
  for (let e of [`createdAt`, `updatedAt`]) {
    let n = t[e];
    typeof n == `number` && (t[e] = Fu(n));
  }
  if (
    (Array.isArray(t.passkeys) &&
      (t.passkeys = t.passkeys.map((e) =>
        e &&
        typeof e == `object` &&
        `createdAt` in e &&
        typeof e.createdAt == `number`
          ? { ...e, createdAt: Fu(e.createdAt) }
          : e,
      )),
    !Bu.safeParse(t).success)
  ) {
    let e = typeof t?.type == `string` ? t.type : `<missing>`,
      n = Object.keys(t ?? {})
        .sort()
        .join(`,`);
    console.error(
      `[vault] decrypted entry has an unexpected shape (type=${e}, keys=${n})`,
    );
  }
  return t;
}
var Hu = [`urls`, `tags`, `passkeys`],
  Uu = [`partStamps`, `itemStamps`, `partStampsAt`],
  Wu = {
    login: { credential: [`username`, `password`, `totp`] },
    card: {
      card: [`cardholderName`, `number`, `brand`, `expMonth`, `expYear`, `cvv`],
    },
    "ssh-key": { key: [`publicKey`, `privateKey`, `passphrase`, `keyType`] },
  },
  Gu = new Set([
    `id`,
    `type`,
    `createdAt`,
    `updatedAt`,
    `lastUsedAt`,
    `breach`,
    `passwordChangelog`,
    ...Uu,
    ...Hu,
  ]),
  Ku = `field:`;
function qu(e, t) {
  return t.startsWith(Ku) ? [t.slice(6)] : (Wu[e]?.[t] ?? [t]);
}
function Ju(e) {
  if (e != null && e !== ``) {
    if (Array.isArray(e)) return e.length === 0 ? void 0 : e.map(Ju);
    if (typeof e == `object`) {
      let t = {};
      for (let n of Object.keys(e).sort()) {
        let r = Ju(e[n]);
        r !== void 0 && (t[n] = r);
      }
      return Object.keys(t).length === 0 ? void 0 : t;
    }
    return e;
  }
}
function Yu(e, t) {
  return JSON.stringify(Ju(e)) === JSON.stringify(Ju(t));
}
function Xu(e) {
  let t = e,
    n = Wu[e.type] ?? {},
    r = new Set(Object.values(n).flat()),
    i = new Map();
  for (let [e, r] of Object.entries(n))
    i.set(e, Ju(Object.fromEntries(r.map((e) => [e, t[e]]))));
  for (let e of Object.keys(t))
    Gu.has(e) || r.has(e) || i.set(e in n ? `${Ku}${e}` : e, Ju(t[e]));
  return i;
}
function Zu(e, t) {
  let n = e[t];
  return Array.isArray(n)
    ? t === `tags`
      ? new Map(n.map((e) => [e.trim().toLowerCase(), e]))
      : t === `passkeys`
        ? new Map(n.map((e) => [e.credentialId, e]))
        : new Map(n.map((e) => [e, e]))
    : new Map();
}
function Qu(e, t) {
  let n = !e.partStampsAt || H(e.partStampsAt, t.hlc) !== 0,
    r = new Set(Object.values(Wu[e.type] ?? {}).flat()),
    i = {};
  if (!n)
    for (let [t, n] of Object.entries(e.partStamps ?? {}))
      r.has(t) || (i[t] = n);
  for (let r of Xu(e).keys()) (n || !i[r]) && (i[r] = t.hlc);
  let a = {};
  for (let r of Hu) {
    let i = n ? {} : (e.itemStamps?.[r] ?? {});
    a[r] = Object.fromEntries(
      [...Zu(e, r).keys()].map((e) => [e, i[e] ?? t.hlc]),
    );
  }
  return { stale: n, parts: i, items: a };
}
function $u(e, t, n, r = []) {
  let i = Xu(e),
    a = t ? Qu(t.data, t.version) : void 0,
    o = t ? Xu(t.data) : new Map(),
    s = r.map(Xu),
    c = {},
    l = new Set([
      ...i.keys(),
      ...o.keys(),
      ...Object.keys(a?.parts ?? {}),
      ...s.flatMap((e) => [...e.keys()]),
    ]);
  for (let e of l) {
    let t = a?.parts[e],
      r = i.get(e),
      l = s.some((t) => !Yu(t.get(e), r));
    t && !l && Yu(o.get(e), r)
      ? (r === void 0 || H(t, n) !== 0) && (c[e] = t)
      : r === void 0 && (t || l) && (c[e] = n);
  }
  let u = {};
  for (let t of Hu) {
    let i = r.map((e) => Zu(e, t)),
      o = [];
    for (let r of Zu(e, t).keys()) {
      let e = a?.items[t][r];
      e && !i.some((e) => !e.has(r)) && H(e, n) !== 0 && o.push([r, e]);
    }
    o.length > 0 && (u[t] = Object.fromEntries(o));
  }
  let { partStamps: d, itemStamps: f, ...p } = e;
  return {
    ...p,
    ...(Object.keys(c).length > 0 ? { partStamps: c } : {}),
    ...(Object.keys(u).length > 0 ? { itemStamps: u } : {}),
    partStampsAt: n,
  };
}
function ed(e, t, n, r) {
  let i = (e) => Vu(e),
    { id: a, ...o } = $u(
      { ...i(t), id: e },
      n && { data: i(n.data), version: n.version },
      r,
    );
  return JSON.stringify(o);
}
function td(e, t, n) {
  if (e?.type !== `login`) return;
  let r = e.passwordChangelog ?? [];
  return e.password === t.password || e.password === ``
    ? r.length > 0
      ? r
      : void 0
    : [{ value: e.password, changedAt: n }, ...r].slice(0, 5);
}
function nd(e, t) {
  return e.type !== `login` ||
    t.type !== `login` ||
    !t.passwordChangelog?.length
    ? e
    : { ...e, passwordChangelog: t.passwordChangelog.slice(0, 5) };
}
function rd(e, t, n) {
  return e.type === `login` ? { ...e, passwordChangelog: td(t, e, n) } : e;
}
function id(e, t, n) {
  let r = [...(e.passwordChangelog ?? [])];
  for (let e of t)
    e.type === `login` &&
      (e.password && r.push({ value: e.password, changedAt: n }),
      r.push(...(e.passwordChangelog ?? [])));
  let i = new Map();
  for (let t of r) {
    if (t.value === `` || t.value === e.password) continue;
    let n = i.get(t.value);
    (!n || t.changedAt > n.changedAt) && i.set(t.value, t);
  }
  let a = [...i.values()].sort((e, t) => t.changedAt - e.changedAt).slice(0, 5);
  return a.length > 0 ? a : void 0;
}
function ad(e, t, n) {
  return e.type === `login` ? { ...e, passwordChangelog: id(e, t, n) } : e;
}
function od(e, t, n, r = !1) {
  let i = t.vv?.[e.node];
  if (r || (i && H(e, i) <= 0)) {
    let t = n.vv?.[e.node];
    return t !== void 0 && H(e, t) <= 0;
  }
  return cl(e.node, e, n);
}
function sd(e) {
  let t = Qu(e.data, e.envelope);
  return {
    data: e.data,
    version: e.envelope,
    stale: t.stale,
    parts: t.parts,
    items: t.items,
  };
}
var cd = (e, t, n) => od(e, t.version, n.version, !t.stale && !t.version.vv),
  ld = (e, t) => (e.stale ? e.version.hlc : e.parts[t]),
  ud = (e, t) => (H(e, t) >= 0 ? e : t);
function dd(e, t, n, r, i) {
  let a = ld(e, n),
    o = ld(t, n);
  if (Yu(r, i)) return !a || (o && H(o, a) > 0) ? `b` : `a`;
  if (!a) return o && cd(o, t, e) ? `a` : `b`;
  if (!o) return cd(a, e, t) ? `b` : `a`;
  let s = cd(a, e, t),
    c = cd(o, t, e);
  return s && !c ? `b` : c && !s ? `a` : null;
}
function fd(e, t, n, r) {
  return e.stale && cd(r, n, e) ? r : n.stale && cd(t, e, n) ? t : ud(t, r);
}
var pd = (e) =>
  Hu.every((t) => {
    let n = e[t];
    return !Array.isArray(n) || Zu(e, t).size === n.length;
  });
function md(e, t) {
  if (
    e.data.type !== t.data.type ||
    (e.stale && t.stale) ||
    !pd(e.data) ||
    !pd(t.data)
  )
    return null;
  let n = String(e.data.type),
    r = Xu(e.data),
    i = Xu(t.data),
    a = new Set([
      ...r.keys(),
      ...i.keys(),
      ...Object.keys(e.parts),
      ...Object.keys(t.parts),
    ]),
    o = { ...e.data },
    s = {},
    c = e;
  for (let l of [...a].sort()) {
    let a = dd(e, t, l, r.get(l), i.get(l));
    if (!a) return null;
    let u = a === `a` ? e : t;
    l === `credential` && (c = u);
    for (let e of qu(n, l))
      u.data[e] === void 0 ? delete o[e] : (o[e] = u.data[e]);
    let d = ld(u, l);
    d && (s[l] = d);
  }
  let l = {};
  for (let r of Hu) {
    let i = Zu(e.data, r),
      a = Zu(t.data, r),
      s = [];
    for (let [n, a] of i) {
      let i = e.items[r][n],
        o = t.items[r][n];
      if (o) s.push([n, a, fd(e, i, t, o)]);
      else if (!cd(i, e, t)) {
        if (e.stale) return null;
        s.push([n, a, i]);
      }
    }
    for (let [n, o] of a) {
      let a = t.items[r][n];
      if (!(i.has(n) || cd(a, t, e))) {
        if (t.stale) return null;
        s.push([n, o, a]);
      }
    }
    ((l[r] = Object.fromEntries(s.map(([e, , t]) => [e, t]))),
      s.length > 0
        ? (o[r] = s.map(([, e]) => e))
        : r === `urls` && n === `login`
          ? (o[r] = [])
          : delete o[r]);
  }
  let u = (e, t) =>
      typeof e == `number` && typeof t == `number` ? Math.min(e, t) : (e ?? t),
    d = (e, t) =>
      typeof e == `number` && typeof t == `number` ? Math.max(e, t) : (e ?? t);
  ((o.createdAt = u(e.data.createdAt, t.data.createdAt)),
    (o.updatedAt = d(e.data.updatedAt, t.data.updatedAt)),
    (o.lastUsedAt = d(e.data.lastUsedAt, t.data.lastUsedAt)));
  for (let e of [`createdAt`, `updatedAt`, `lastUsedAt`])
    o[e] === void 0 && delete o[e];
  n === `login` &&
    (c.data.breach === void 0 ? delete o.breach : (o.breach = c.data.breach));
  let f = fl([e.version, t.version]);
  return {
    data: o,
    version: { hlc: ud(e.version.hlc, t.version.hlc), ...f },
    stale: !1,
    parts: s,
    items: l,
  };
}
async function hd(e) {
  let t = e.map((e) => _l(e.envelope)).sort().join(`
`),
    n = new Uint8Array(
      await globalThis.crypto.subtle.digest(
        `SHA-256`,
        new TextEncoder().encode(t),
      ),
    );
  return `${ll}${btoa(String.fromCharCode(...n.slice(0, 16)))
    .replace(/\+/g, `-`)
    .replace(/\//g, `_`)
    .replace(/=+$/, ``)}`;
}
async function gd(e, t = 1) {
  let [n, ...r] = [...e].sort((e, t) => H(t.envelope.hlc, e.envelope.hlc));
  if (!n) return null;
  let i = sd(n),
    a = [n];
  for (let e of r) {
    let t = md(i, sd(e));
    t && ((i = t), a.push(e));
  }
  if (a.length < 2) return null;
  let o = n.envelope.hlc,
    s = { wall: o.wall, counter: o.counter + t, node: await hd(a) },
    c = fl(a.map((e) => e.envelope)),
    l = {
      vv: { ...c.vv, [s.node]: s },
      ...(c.floor ? { floor: c.floor } : {}),
    },
    { id: u, ...d } = ad(
      {
        ...i.data,
        partStamps: i.parts,
        itemStamps: _d(i.items),
        partStampsAt: s,
      },
      a.map((e) => e.data),
      (i.parts.credential ?? s).wall,
    );
  return { data: d, hlc: s, causal: l, replaces: a.map((e) => e.envelope) };
}
function _d(e) {
  let t = {};
  for (let n of Hu) Object.keys(e[n]).length > 0 && (t[n] = e[n]);
  return t;
}
async function vd(e, t, n) {
  let r = [...new Set((e.conflicts ?? []).map((e) => e.id))].filter(
      (e) => !n || n.has(e),
    ),
    i = [];
  for (let n of r)
    try {
      let r = await yd(e, n, t);
      r && i.push(r);
    } catch (e) {
      console.warn(
        `[sync] couldn't combine an entry's versions; keeping them as they are:`,
        e,
      );
    }
  return i.length === 0
    ? { payload: e, stamps: [] }
    : {
        payload: xu(e, { entries: i, tombstones: [] }),
        stamps: i.map((e) => e.hlc),
      };
}
async function yd(e, t, n) {
  let r = [
      ...e.entries.filter((e) => e.id === t),
      ...(e.conflicts ?? []).filter((e) => e.id === t),
    ],
    i = await n.decryptEntries(
      r.map(({ ciphertext: e, iv: t, wrappedDek: n, dekIv: r }) => ({
        ciphertext: e,
        iv: t,
        wrappedDek: n,
        dekIv: r,
      })),
    ),
    a = await gd(
      r.flatMap((e, t) => {
        let n = i[t];
        if (n == null) return [];
        try {
          return [{ envelope: e, data: Vu(JSON.parse(n)) }];
        } catch {
          return [];
        }
      }),
    );
  if (!a) return null;
  let o = JSON.stringify(a.data),
    s = await n.encryptEntry(o),
    [c] = await n.decryptEntries([s]);
  return c === o
    ? { id: t, ...s, hlc: a.hlc, ...a.causal }
    : (console.warn(
        `[sync] a combined version didn't open again; keeping the versions it combined`,
      ),
      null);
}
var bd = (e) => `${e.id}|${e.hlc.wall}|${e.hlc.counter}|${e.hlc.node}`;
function xd(e) {
  return [
    ...[...e.entries, ...(e.conflicts ?? []), ...e.tombstones].flatMap((e) => [
      e.hlc,
      ...(e.floor ? [e.floor] : []),
      ...Object.values(e.vv ?? {}),
    ]),
    ...(e.files ?? []).map((e) => e.hlc),
    ...(e.fileTombstones ?? []).map((e) => e.hlc),
    ...(e.fileCascades ?? []).map((e) => e.hlc),
  ];
}
function Sd(e) {
  return new Map(e.map((e) => [e.id, e.hlc]));
}
function Cd(e, t) {
  if (e.size !== t.size) return !1;
  for (let [n, r] of e) {
    let e = t.get(n);
    if (!e || H(r, e) !== 0) return !1;
  }
  return !0;
}
function wd(e) {
  return new Map(Object.entries(e ?? {}).map(([e, t]) => [e, t.hlc]));
}
function Td(e) {
  return new Set((e ?? []).map((e) => `${e.id}|${_l(e)}`));
}
function Ed(e, t) {
  return e.size === t.size && [...e].every((e) => t.has(e));
}
function Dd(e, t) {
  return (
    Ed(Td(e.entries), Td(t.entries)) &&
    Ed(Td(e.conflicts), Td(t.conflicts)) &&
    Ed(Td(e.tombstones), Td(t.tombstones)) &&
    Cd(wd(e.settings), wd(t.settings)) &&
    Cd(Sd(e.files ?? []), Sd(t.files ?? [])) &&
    Cd(Sd(e.fileTombstones ?? []), Sd(t.fileTombstones ?? [])) &&
    Cd(Sd(e.fileCascades ?? []), Sd(t.fileCascades ?? []))
  );
}
function Od(e, t) {
  let n = (e) => !t.has(bd(e)),
    r = { ...e, entries: e.entries.filter(n) };
  return (e.conflicts && (r.conflicts = e.conflicts.filter(n)), r);
}
async function kd(e, t, n, r) {
  let i = new Set([...t.entries, ...(t.conflicts ?? [])].map(bd)),
    a = new Set(),
    o = Od(n, r);
  for (;;) {
    let n = xu(t, o),
      s = [...n.entries, ...(n.conflicts ?? [])].filter((e) => {
        let t = bd(e);
        return !i.has(t) && !a.has(t);
      });
    if (s.length === 0) return { admitted: o, merged: n };
    let c = await e.openable(s),
      l = s.filter((e, t) => !c[t]);
    for (let e of s.filter((e, t) => c[t])) a.add(bd(e));
    if (l.length === 0) return { admitted: o, merged: n };
    console.warn(
      `[sync] refused ${l.length} entries that don't decrypt in this vault`,
    );
    for (let e of l) r.add(bd(e));
    o = Od(o, r);
  }
}
function Ad(e, t) {
  let n = (e, t) =>
    Su(e, t).map(_l).sort().join(`
`);
  return new Set(
    (t.conflicts ?? []).map((e) => e.id).filter((r) => n(e, r) !== n(t, r)),
  );
}
async function jd(e, t, { rejected: n = new Set(), combine: r = !1 } = {}) {
  let i = lu(t),
    a = await e.readLocal(),
    { admitted: o, merged: s } = await kd(e, a, i, n),
    c = { payload: s, stamps: [] },
    l = r && e.combineSiblings ? Ad(a, s) : new Set(),
    u =
      e.combineSiblings && l.size > 0
        ? await e
            .combineSiblings(s, l)
            .catch(
              (e) => (
                console.warn(
                  `[sync] combining siblings failed; keeping them as they are:`,
                  e,
                ),
                c
              ),
            )
        : c,
    d = !Dd(a, u.payload);
  return (
    d &&
      (await e.witnessRemote([...xd(o), ...u.stamps]),
      await e.writeMerged(u.payload)),
    { payload: u.payload, changed: d }
  );
}
var Md = `sync.deviceId`;
async function Nd(e, t) {
  let n = await e(Md);
  if (n) return n;
  let r = globalThis.crypto.randomUUID();
  return (await t(Md, r), r);
}
function Pd(e) {
  return new tl(e);
}
var Fd = z({
  id: N().min(1),
  publicKey: N().min(1),
  label: N(),
  addedAt: F().int().nonnegative(),
  hlc: V,
  sigKey: N().min(1).optional(),
  sig: N().min(1).optional(),
  admissionKey: N().min(1).optional(),
  admission: z({ by: N().min(1), sig: N().min(1) }).optional(),
});
function Id(e) {
  return JSON.stringify([
    e.id,
    e.publicKey,
    e.sigKey ?? ``,
    e.admissionKey ?? ``,
    e.addedAt,
    e.hlc.wall,
    e.hlc.counter,
    e.hlc.node,
  ]);
}
async function Ld(e, t, n) {
  let r = { ...e, sigKey: t };
  return { ...r, sig: await n(Id(r)) };
}
var Rd = z({ devices: R(Fd), revoked: R($l) });
function zd() {
  return { devices: [], revoked: [] };
}
function Bd(e) {
  return JSON.stringify(Rd.parse(e));
}
function Vd(e) {
  return Rd.parse(JSON.parse(e));
}
function Hd(e) {
  return uu(
    e.devices,
    e.revoked.map((e) => [e.id, e.hlc]),
  );
}
function Ud(e) {
  let t = [];
  for (let [n, r] of e.records) e.tombstones.has(n) || t.push(r);
  return t;
}
function Wd(e) {
  return {
    devices: Ud(e),
    revoked: [...e.tombstones].map(([e, t]) => ({ id: e, hlc: t })),
  };
}
function Gd(e, t) {
  return Wd(du(Hd(e), Hd(t)));
}
function Kd(e, t = Date.now()) {
  return {
    devices: e.devices.filter((e) => !U(e.hlc, t)),
    revoked: e.revoked.filter((e) => !U(e.hlc, t)),
  };
}
function qd(e, t, n = Date.now()) {
  return Gd(e, Kd(t, n));
}
function Jd(e, t, n, r, i = {}) {
  let a = new Map();
  for (let t of e.devices) t.sigKey && a.set(t.id, t.sigKey);
  let o = new Set(e.revoked.map((e) => e.id));
  return {
    devices: t.devices.filter((e) => {
      if (o.has(e.id)) return !1;
      let t = a.get(e.id);
      if (t !== void 0) return e.sigKey === t && e.sig !== void 0 && n(e);
      if (e.sigKey !== void 0 && e.sig !== void 0) {
        if (!n(e)) return !1;
      } else if (i.signatures) return !1;
      return e.admission === void 0 ? !i.admission : r(e);
    }),
    revoked: t.revoked,
  };
}
function Yd(e, t) {
  return Gd(e, { devices: [t], revoked: [] });
}
function Xd(e, t) {
  if (e.revoked.some((e) => e.id === t.id)) return !1;
  let n = e.devices.find((e) => e.id === t.id);
  return !n || n.publicKey === t.publicKey;
}
function Zd(e, t, n) {
  return Gd(e, { devices: [], revoked: [{ id: t, hlc: n }] });
}
function Qd(e) {
  return Ud(Hd(e));
}
function $d(e, t) {
  return e.some((e) => e.devices.some((e) => e.publicKey === t && !!e.sigKey));
}
var ef = `bramble-pair-1.`;
function tf(e = 32) {
  return kc(crypto.getRandomValues(new Uint8Array(e)));
}
var nf = 18e4,
  rf = 6e4,
  af = z({
    v: B(1),
    groupKey: N().min(1),
    inviterPub: N().min(1),
    psk: N().min(1),
    relay: N().min(1),
    iceUrl: N().optional(),
    exp: F().int().positive().optional(),
  });
function of(e, t = Date.now(), n = rf) {
  return e.exp !== void 0 && t - n > e.exp;
}
function sf(e) {
  let t = JSON.stringify(af.parse(e));
  return ef + kc(new TextEncoder().encode(t));
}
function cf(e) {
  let t = e.trim();
  if (!t.startsWith(ef)) throw Error(`not a bramble pairing code`);
  let n = t.slice(15),
    r = new TextDecoder().decode(
      Uint8Array.from(atob(n), (e) => e.charCodeAt(0)),
    );
  return af.parse(JSON.parse(r));
}
var lf = z({
  vek: N().min(1),
  roster: Rd,
  entries: ru,
  primaryPasswordCheck: z({
    saltB64: N(),
    slotIdB64: N(),
    verifierB64: N(),
  }).optional(),
  recoverySlots: R(
    z({
      saltB64: N(),
      slotIdB64: N(),
      verifierB64: N(),
      wrapIvB64: N(),
      wrappedVekB64: N(),
    }),
  ).optional(),
});
function uf(e) {
  let t = lf.parse(e);
  return JSON.stringify({ ...t, entries: iu(t.entries) });
}
function df(e) {
  return lf.parse(JSON.parse(e));
}
var ff = 2e4,
  pf = `bramble/signal`,
  mf = `d`,
  hf = `bramble/room-id`,
  gf = `bramble/signal-key`,
  K = (e) => e;
async function _f(e, t) {
  let n = await crypto.subtle.importKey(`raw`, K(e), `HKDF`, !1, [
      `deriveBits`,
    ]),
    r = await crypto.subtle.deriveBits(
      {
        name: `HKDF`,
        hash: `SHA-256`,
        salt: new Uint8Array(),
        info: K(new TextEncoder().encode(t)),
      },
      n,
      256,
    );
  return new Uint8Array(r);
}
function vf(e) {
  return JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
}
function yf(e) {
  return Eu(new TextEncoder().encode(vf(e)));
}
async function bf(e, t = pf, n) {
  let r = await _f(e, hf),
    i = await crypto.subtle.importKey(
      `raw`,
      K(r),
      { name: `HMAC`, hash: `SHA-256` },
      !1,
      [`sign`],
    ),
    a = n === void 0 ? t : `${t}:${n}`,
    o = await crypto.subtle.sign(`HMAC`, i, K(new TextEncoder().encode(a)));
  return jc(new Uint8Array(o));
}
async function xf(e, t) {
  let n = await _f(e, gf),
    r = await crypto.subtle.importKey(`raw`, K(n), `AES-GCM`, !1, [`encrypt`]),
    i = crypto.getRandomValues(new Uint8Array(12)),
    a = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: `AES-GCM`, iv: K(i) },
        r,
        K(new TextEncoder().encode(t)),
      ),
    ),
    o = new Uint8Array(i.length + a.length);
  return (o.set(i), o.set(a, i.length), kc(o));
}
async function Sf(e, t) {
  let n = Ac(t),
    r = n.slice(0, 12),
    i = n.slice(12),
    a = await _f(e, gf),
    o = await crypto.subtle.importKey(`raw`, K(a), `AES-GCM`, !1, [`decrypt`]),
    s = await crypto.subtle.decrypt({ name: `AES-GCM`, iv: K(r) }, o, K(i));
  return new TextDecoder().decode(s);
}
async function Cf(e, t, n, r) {
  let i = {
      pubkey: e.pubkeyHex,
      created_at: r,
      kind: ff,
      tags: [[mf, t]],
      content: n,
    },
    a = await yf(i),
    o = await e.sign(a);
  return { ...i, id: a, sig: o };
}
async function wf(e, t) {
  return (await yf(t)) === t.id && e.verify(t.pubkey, t.id, t.sig);
}
function Tf(e) {
  return { kinds: [ff], [`#${mf}`]: Array.isArray(e) ? e : [e] };
}
var Ef = 0,
  Df = `ping`,
  Of = 25e3,
  kf = 7e4,
  Af = `BRAMBLE_TICKET`,
  jf = 2e3;
function Mf(e, t, n, r, i) {
  let a = `s${Ef++}`,
    o = !1,
    s = [],
    c = 0,
    l = !1,
    u,
    d = () => {
      (u !== void 0 && clearInterval(u), (u = void 0));
    },
    f = () => {},
    p = new Promise((e) => {
      f = e;
    }),
    m = (t) => {
      o ? e.send(t) : s.push(t);
    },
    h = (e) => m(JSON.stringify([`REQ`, a, Tf(e)]));
  ((e.onopen = () => {
    ((o = !0), (c = Date.now()), r?.(), h(t));
    for (let t of s) e.send(t);
    ((s.length = 0),
      e.send(JSON.stringify([Af])),
      setTimeout(() => f(null), jf),
      (u = setInterval(() => {
        l && Date.now() - c > kf ? (d(), e.close()) : e.send(Df);
      }, Of)));
  }),
    (e.onmessage = (e) => {
      if (((c = Date.now()), e.data === `pong`)) {
        l = !0;
        return;
      }
      let t;
      try {
        t = JSON.parse(e.data);
      } catch {
        return;
      }
      Array.isArray(t) &&
        (t[0] === `BRAMBLE_TICKET`
          ? f(typeof t[1] == `string` && t[1] ? t[1] : null)
          : t[0] === `OK` && t[2] === !1
            ? i?.(String(t[3] ?? ``))
            : t[0] === `EVENT` && t[1] === a && t[2] && n(t[2]));
    }));
  let ee = e.onclose;
  return (
    (e.onclose = (e) => {
      (d(), ee?.(e));
    }),
    {
      publish: (e) => m(JSON.stringify([`EVENT`, e])),
      resubscribe: h,
      ticket: () =>
        Promise.race([p, new Promise((e) => setTimeout(() => e(null), jf))]),
      close: () => {
        d();
        try {
          e.send(JSON.stringify([`CLOSE`, a]));
        } catch {}
        e.close();
      },
    }
  );
}
var Nf = `sync.lastSyncedAt`,
  Pf =
    `🐶.🐱.🦁.🐎.🦄.🐷.🐘.🐰.🐼.🐓.🐧.🐢.🐟.🐙.🦋.🌷.🌳.🌵.🍄.🌏.🌙.☁️.🔥.🍌.🍎.🍓.🌽.🍕.🎂.❤️.🙂.🤖.🎩.👓.🔧.🎅.👍.☂️.⌛.⏰.🎁.💡.📖.✏️.📎.✂️.🔒.🔑.🔨.☎️.🏁.🚂.🚲.✈️.🚀.🏆.⚽.🎸.🎺.🔔.⚓.🎧.📁.📌`.split(
      `.`,
    );
function Ff(e) {
  return (
    e instanceof Uint8Array ||
    (ArrayBuffer.isView(e) &&
      e.constructor.name === `Uint8Array` &&
      `BYTES_PER_ELEMENT` in e &&
      e.BYTES_PER_ELEMENT === 1)
  );
}
function If(e, t, n = ``) {
  let r = Ff(e),
    i = e?.length,
    a = t !== void 0;
  if (!r || (a && i !== t)) {
    let o = n && `"${n}" `,
      s = a ? ` of length ${t}` : ``,
      c = r ? `length=${i}` : `type=${typeof e}`,
      l = o + `expected Uint8Array` + s + `, got ` + c;
    throw r ? RangeError(l) : TypeError(l);
  }
  return e;
}
function Lf(e, t = !0) {
  if (e.destroyed) throw Error(`Hash instance has been destroyed`);
  if (t && e.finished) throw Error(`Hash#digest() has already been called`);
}
function Rf(e, t) {
  If(e, void 0, `digestInto() output`);
  let n = t.outputLen;
  if (e.length < n)
    throw RangeError(`"digestInto() output" expected to be of length >=` + n);
}
function zf(...e) {
  for (let t = 0; t < e.length; t++) e[t].fill(0);
}
function Bf(e) {
  return new DataView(e.buffer, e.byteOffset, e.byteLength);
}
function q(e, t) {
  return (e << (32 - t)) | (e >>> t);
}
var Vf =
    typeof Uint8Array.from([]).toHex == `function` &&
    typeof Uint8Array.fromHex == `function`,
  Hf = Array.from({ length: 256 }, (e, t) => t.toString(16).padStart(2, `0`));
function Uf(e) {
  if ((If(e), Vf)) return e.toHex();
  let t = ``;
  for (let n = 0; n < e.length; n++) t += Hf[e[n]];
  return t;
}
function Wf(e, t = {}) {
  let n = (t, n) => e(n).update(t).digest(),
    r = e(void 0);
  return (
    (n.outputLen = r.outputLen),
    (n.blockLen = r.blockLen),
    (n.canXOF = r.canXOF),
    (n.create = (t) => e(t)),
    Object.assign(n, t),
    Object.freeze(n)
  );
}
var Gf = (e) => ({
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, e]),
});
function Kf(e, t, n) {
  return (e & t) ^ (~e & n);
}
function qf(e, t, n) {
  return (e & t) ^ (e & n) ^ (t & n);
}
var Jf = class {
    blockLen;
    outputLen;
    canXOF = !1;
    padOffset;
    isLE;
    buffer;
    view;
    finished = !1;
    length = 0;
    pos = 0;
    destroyed = !1;
    constructor(e, t, n, r) {
      ((this.blockLen = e),
        (this.outputLen = t),
        (this.padOffset = n),
        (this.isLE = r),
        (this.buffer = new Uint8Array(e)),
        (this.view = Bf(this.buffer)));
    }
    update(e) {
      (Lf(this), If(e));
      let { view: t, buffer: n, blockLen: r } = this,
        i = e.length;
      for (let a = 0; a < i;) {
        let o = Math.min(r - this.pos, i - a);
        if (o === r) {
          let t = Bf(e);
          for (; r <= i - a; a += r) this.process(t, a);
        } else
          (n.set(e.subarray(a, a + o), this.pos),
            (this.pos += o),
            (a += o),
            this.pos === r && (this.process(t, 0), (this.pos = 0)));
      }
      return ((this.length += e.length), this.roundClean(), this);
    }
    digestInto(e) {
      (Lf(this), Rf(e, this), (this.finished = !0));
      let { buffer: t, view: n, blockLen: r, isLE: i } = this,
        { pos: a } = this;
      ((t[a++] = 128),
        zf(this.buffer.subarray(a)),
        this.padOffset > r - a && (this.process(n, 0), (a = 0)));
      for (let e = a; e < r; e++) t[e] = 0;
      (n.setBigUint64(r - 8, BigInt(this.length * 8), i), this.process(n, 0));
      let o = Bf(e),
        s = this.outputLen;
      if (s % 4) throw Error(`_sha2: outputLen must be aligned to 32bit`);
      let c = s / 4,
        l = this.get();
      if (c > l.length) throw Error(`_sha2: outputLen bigger than state`);
      for (let e = 0; e < c; e++) o.setUint32(4 * e, l[e], i);
    }
    digest() {
      let { buffer: e, outputLen: t } = this;
      this.digestInto(e);
      let n = e.slice(0, t);
      return (this.destroy(), n);
    }
    _cloneInto(e) {
      ((e ||= new this.constructor()), e.set(...this.get()));
      let {
        blockLen: t,
        buffer: n,
        length: r,
        finished: i,
        destroyed: a,
        pos: o,
      } = this;
      return (
        (e.destroyed = a),
        (e.finished = i),
        (e.length = r),
        (e.pos = o),
        r % t && e.buffer.set(n),
        e
      );
    }
    clone() {
      return this._cloneInto();
    }
  },
  Yf = Uint32Array.from([
    1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924,
    528734635, 1541459225,
  ]),
  Xf = Uint32Array.from([
    1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993,
    2453635748, 2870763221, 3624381080, 310598401, 607225278, 1426881987,
    1925078388, 2162078206, 2614888103, 3248222580, 3835390401, 4022224774,
    264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
    2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711,
    113926993, 338241895, 666307205, 773529912, 1294757372, 1396182291,
    1695183700, 1986661051, 2177026350, 2456956037, 2730485921, 2820302411,
    3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
    430227734, 506948616, 659060556, 883997877, 958139571, 1322822218,
    1537002063, 1747873779, 1955562222, 2024104815, 2227730452, 2361852424,
    2428436474, 2756734187, 3204031479, 3329325298,
  ]),
  Zf = new Uint32Array(64),
  Qf = class extends Jf {
    constructor(e) {
      super(64, e, 8, !1);
    }
    get() {
      let { A: e, B: t, C: n, D: r, E: i, F: a, G: o, H: s } = this;
      return [e, t, n, r, i, a, o, s];
    }
    set(e, t, n, r, i, a, o, s) {
      ((this.A = e | 0),
        (this.B = t | 0),
        (this.C = n | 0),
        (this.D = r | 0),
        (this.E = i | 0),
        (this.F = a | 0),
        (this.G = o | 0),
        (this.H = s | 0));
    }
    process(e, t) {
      for (let n = 0; n < 16; n++, t += 4) Zf[n] = e.getUint32(t, !1);
      for (let e = 16; e < 64; e++) {
        let t = Zf[e - 15],
          n = Zf[e - 2],
          r = q(t, 7) ^ q(t, 18) ^ (t >>> 3),
          i = q(n, 17) ^ q(n, 19) ^ (n >>> 10);
        Zf[e] = (i + Zf[e - 7] + r + Zf[e - 16]) | 0;
      }
      let { A: n, B: r, C: i, D: a, E: o, F: s, G: c, H: l } = this;
      for (let e = 0; e < 64; e++) {
        let t = q(o, 6) ^ q(o, 11) ^ q(o, 25),
          u = (l + t + Kf(o, s, c) + Xf[e] + Zf[e]) | 0,
          d = ((q(n, 2) ^ q(n, 13) ^ q(n, 22)) + qf(n, r, i)) | 0;
        ((l = c),
          (c = s),
          (s = o),
          (o = (a + u) | 0),
          (a = i),
          (i = r),
          (r = n),
          (n = (u + d) | 0));
      }
      ((n = (n + this.A) | 0),
        (r = (r + this.B) | 0),
        (i = (i + this.C) | 0),
        (a = (a + this.D) | 0),
        (o = (o + this.E) | 0),
        (s = (s + this.F) | 0),
        (c = (c + this.G) | 0),
        (l = (l + this.H) | 0),
        this.set(n, r, i, a, o, s, c, l));
    }
    roundClean() {
      zf(Zf);
    }
    destroy() {
      ((this.destroyed = !0),
        this.set(0, 0, 0, 0, 0, 0, 0, 0),
        zf(this.buffer));
    }
  },
  $f = class extends Qf {
    A = Yf[0] | 0;
    B = Yf[1] | 0;
    C = Yf[2] | 0;
    D = Yf[3] | 0;
    E = Yf[4] | 0;
    F = Yf[5] | 0;
    G = Yf[6] | 0;
    H = Yf[7] | 0;
    constructor() {
      super(32);
    }
  },
  ep = Wf(() => new $f(), Gf(1)),
  tp = 262144;
function np(e) {
  if (!ql.test(e)) throw Error(`not a blob hash: ${e}`);
}
function rp({ backend: e, createHasher: t }) {
  let n = {
    async has(t) {
      return (np(t), e.has(t));
    },
    async size(t) {
      return (np(t), e.size(t));
    },
    async read(t, n = 0, r) {
      if ((np(t), n < 0 || (r !== void 0 && r < 0)))
        throw Error(`blob read range must not be negative`);
      let i = await e.size(t);
      if (i === null) throw Error(`blob not held: ${t}`);
      let a = Math.min(n, i),
        o = r === void 0 ? i - a : Math.min(r, i - a);
      return o === 0 ? new Uint8Array() : e.read(t, a, o);
    },
    async receive(n) {
      if ((np(n), await e.has(n))) throw Error(`blob already held: ${n}`);
      let r = t(),
        i = await e.stagedSize(n);
      for (let t = 0; t < i; t += tp) {
        let a = Math.min(tp, i - t);
        await r.update(await e.readStaged(n, t, a));
      }
      i === 0 && (await e.appendStaged(n, new Uint8Array()));
      let a = !0;
      return {
        resumeFrom: i,
        async append(t) {
          if (!a) throw Error(`blob receipt is closed`);
          return (
            t.length === 0 ||
              (await e.appendStaged(n, t), await r.update(t), (i += t.length)),
            i
          );
        },
        async commit() {
          if (!a) throw Error(`blob receipt is closed`);
          a = !1;
          let t = await r.finish();
          if (t !== n)
            throw (
              await e.discardStaged(n),
              Error(`blob hash mismatch: wanted ${n}, got ${t}`)
            );
          await e.publishStaged(n);
        },
        async abort() {
          a && ((a = !1), await e.discardStaged(n));
        },
      };
    },
    async put(t, r) {
      if ((np(t), await e.has(t))) return;
      await e.discardStaged(t);
      let i = await n.receive(t);
      (await i.append(r), await i.commit());
    },
    async reserveStagingPath(t) {
      return e.reserveStagingPath ? e.reserveStagingPath(t) : null;
    },
    async adoptStagingPath(t, n) {
      if ((np(n), !e.adoptStagingPath))
        throw Error(`this blob store has no staging paths`);
      await e.adoptStagingPath(t, n);
    },
    async discardStagingPath(t) {
      await e.discardStaged(t);
    },
    async delete(t) {
      (np(t), await e.remove(t), await e.discardStaged(t));
    },
    async list() {
      return (await e.list()).map((e) => e.hash);
    },
    async totalBytes() {
      return (await e.list()).reduce((e, t) => e + t.size, 0);
    },
    async sweep(t) {
      let n = new Set(t),
        r = [];
      for (let { hash: t } of await e.list())
        n.has(t) || (await e.remove(t), r.push(t));
      return r;
    },
  };
  return n;
}
function ip() {
  let e = ep.create();
  return {
    update(t) {
      e.update(t);
    },
    finish() {
      return Uf(e.digest());
    },
  };
}
var ap = globalThis,
  op = ap.browser ?? ap.chrome;
function sp(e) {
  return e.error?.message ?? op.runtime.lastError?.message ?? `disconnected`;
}
var cp = `bramble-files`,
  lp = 1,
  J = `objects`,
  Y = `parts`,
  X = `handoff`,
  up = 262160,
  dp = null;
function fp() {
  return (
    (dp ||= new Promise((e, t) => {
      let n = indexedDB.open(cp, lp);
      ((n.onupgradeneeded = () => {
        let e = n.result;
        (e.objectStoreNames.contains(J) || e.createObjectStore(J),
          e.objectStoreNames.contains(Y) || e.createObjectStore(Y),
          e.objectStoreNames.contains(X) || e.createObjectStore(X));
      }),
        (n.onsuccess = () => {
          let t = n.result;
          ((t.onversionchange = () => {
            (t.close(), (dp = null));
          }),
            e(t));
        }),
        (n.onerror = () => t(n.error)),
        (n.onblocked = () =>
          t(Error(`attachment store is blocked by another context`))));
    }).catch((e) => {
      throw ((dp = null), e);
    })),
    dp
  );
}
function Z(e) {
  return new Promise((t, n) => {
    ((e.onsuccess = () => t(e.result)), (e.onerror = () => n(e.error)));
  });
}
async function Q(e, t, n) {
  let r = (await fp()).transaction(e, t),
    i = new Promise((e, t) => {
      ((r.oncomplete = () => e()),
        (r.onerror = () => t(r.error)),
        (r.onabort = () =>
          t(r.error ?? Error(`attachment store transaction aborted`))));
    }),
    a;
  try {
    a = await n(r);
  } catch (e) {
    try {
      r.abort();
    } catch {}
    throw (i.catch(() => {}), e);
  }
  return (await i, a);
}
var pp = (e, t, n) => [e, t, n],
  mp = (e) => IDBKeyRange.bound([e, 0], [e, 1 / 0]);
async function $(e, t, n, r) {
  return Z(e.objectStore(J).get(pp(t, n, r)));
}
async function hp(e, t, n, r) {
  let i = await $(e, t, n, r);
  i &&
    (await Z(e.objectStore(J).delete(pp(t, n, r))),
    await Z(e.objectStore(Y).delete(mp(i.obj))));
}
async function gp(e, t, n, r, i) {
  return Q([J, Y], `readonly`, async (a) => {
    let o = await $(a, e, t, n);
    if (!o) throw Error(`no ${t} object ${n}`);
    if (r < 0 || i < 0 || r + i > o.size)
      throw Error(`read past the end of an attachment object`);
    let s = new Uint8Array(i);
    if (i === 0) return s;
    let c = Math.floor(r / up),
      l = Math.floor((r + i - 1) / up),
      u = await Z(
        a.objectStore(Y).getAll(IDBKeyRange.bound([o.obj, c], [o.obj, l])),
      );
    if (u.length !== l - c + 1)
      throw Error(`attachment object is missing parts`);
    let d = 0;
    for (let e = 0; e < u.length; e++) {
      let t = u[e],
        n = e === 0 ? r - c * up : 0,
        a = Math.min(t.length - n, i - d);
      (s.set(t.subarray(n, n + a), d), (d += a));
    }
    if (d !== i) throw Error(`attachment object is shorter than recorded`);
    return s;
  });
}
async function _p(e, t, n) {
  await Q([J, Y], `readwrite`, async (r) => {
    let i = r.objectStore(Y),
      a = (await $(r, e, `staged`, t)) ?? {
        obj: globalThis.crypto.randomUUID(),
        size: 0,
      },
      o = a.size,
      s = 0,
      c = Math.floor(o / up),
      l = o % up;
    if (l > 0 && n.length > 0) {
      let e = await Z(i.get([a.obj, c]));
      if (!e || e.length !== l)
        throw Error(`staged attachment is inconsistent`);
      let t = Math.min(up - l, n.length),
        r = new Uint8Array(l + t);
      (r.set(e),
        r.set(n.subarray(0, t), l),
        await Z(i.put(r, [a.obj, c])),
        (s = t),
        (o += t),
        o % 262160 == 0 && c++);
    }
    for (; s < n.length;) {
      let e = Math.min(up, n.length - s);
      (await Z(i.put(n.slice(s, s + e), [a.obj, c])), c++, (s += e), (o += e));
    }
    await Z(r.objectStore(J).put({ obj: a.obj, size: o }, pp(e, `staged`, t)));
  });
}
async function vp(e, t, n) {
  await Q([J, Y], `readwrite`, async (r) => {
    let i = await $(r, e, `staged`, t);
    if (!i) throw Error(`nothing staged to publish`);
    (await Z(r.objectStore(J).delete(pp(e, `staged`, t))),
      (await $(r, e, `blob`, n))
        ? await Z(r.objectStore(Y).delete(mp(i.obj)))
        : await Z(r.objectStore(J).put(i, pp(e, `blob`, n))));
  });
}
function yp(e) {
  return rp({ backend: bp(e), createHasher: ip });
}
function bp(e) {
  return {
    appendStaged: (t, n) => _p(e, t, n),
    stagedSize: (t) =>
      Q([J], `readonly`, async (n) => (await $(n, e, `staged`, t))?.size ?? 0),
    readStaged: (t, n, r) => gp(e, `staged`, t, n, r),
    publishStaged: (t) => vp(e, t, t),
    discardStaged: (t) => Q([J, Y], `readwrite`, (n) => hp(n, e, `staged`, t)),
    has: (t) =>
      Q([J], `readonly`, async (n) => (await $(n, e, `blob`, t)) !== void 0),
    size: (t) =>
      Q([J], `readonly`, async (n) => (await $(n, e, `blob`, t))?.size ?? null),
    read: (t, n, r) => gp(e, `blob`, t, n, r),
    remove: (t) => Q([J, Y], `readwrite`, (n) => hp(n, e, `blob`, t)),
    list: () =>
      Q([J], `readonly`, async (t) => {
        let n = t.objectStore(J),
          r = IDBKeyRange.bound([e, `blob`, ``], [e, `blob`, []]),
          [i, a] = await Promise.all([Z(n.getAllKeys(r)), Z(n.getAll(r))]);
        return i.map((e, t) => ({ hash: e[2], size: a[t].size }));
      }),
  };
}
async function xp(e) {
  await Q([J, Y], `readwrite`, async (t) => {
    let n = t.objectStore(J),
      r = IDBKeyRange.bound([e], [e, []]),
      [i, a] = await Promise.all([Z(n.getAllKeys(r)), Z(n.getAll(r))]);
    for (let e = 0; e < i.length; e++)
      (await Z(n.delete(i[e])), await Z(t.objectStore(Y).delete(mp(a[e].obj))));
  });
}
async function Sp(e) {
  let t = globalThis.crypto.randomUUID();
  return (
    await Q([X], `readwrite`, async (n) => {
      await Z(n.objectStore(X).put({ blob: e, at: Date.now() }, t));
    }),
    t
  );
}
async function Cp(e) {
  return Q(
    [X],
    `readonly`,
    async (t) => (await Z(t.objectStore(X).get(e)))?.blob ?? null,
  );
}
async function wp(e) {
  await Q([X], `readwrite`, async (t) => {
    await Z(t.objectStore(X).delete(e));
  });
}
async function Tp(e) {
  await Q([X], `readwrite`, async (t) => {
    let n = t.objectStore(X);
    if (e === void 0) {
      await Z(n.clear());
      return;
    }
    let r = Date.now() - e,
      [i, a] = await Promise.all([Z(n.getAllKeys()), Z(n.getAll())]);
    for (let e = 0; e < i.length; e++) a[e].at < r && (await Z(n.delete(i[e])));
  });
}
var Ep = z({
    vaultId: N(),
    relayUrl: N(),
    iceUrl: N().optional(),
    groupKeyB64: N(),
    roster: Rd,
    devicePrivB64: N(),
    devicePubB64: N(),
  }),
  Dp = z({
    vaultId: N(),
    relayUrl: N(),
    iceUrl: N().optional(),
    groupKeyB64: N(),
    psk: N(),
    devicePrivB64: N(),
    devicePubB64: N().optional(),
    vekB64: N().optional(),
    roster: Rd,
    entries: ru,
    passwordCheck: z({
      saltB64: N(),
      slotIdB64: N(),
      verifierB64: N(),
    }).optional(),
    recoverySlots: R(
      z({
        saltB64: N(),
        slotIdB64: N(),
        verifierB64: N(),
        wrapIvB64: N(),
        wrappedVekB64: N(),
      }),
    ).optional(),
    admission: z({ password: N(), saltB64: N(), adminId: N() }).optional(),
  }),
  Op = z({
    relayUrl: N(),
    iceUrl: N().optional(),
    groupKeyB64: N(),
    psk: N(),
    devicePrivB64: N(),
    inviterPub: N(),
    ownEntry: Fd,
    password: N().optional(),
    viaLink: L().optional(),
  }),
  kp = z({ vaultId: N(), payloadJson: N() }),
  Ap = z({ vaultId: N(), rosterJson: N() }),
  jp = z({ vaultId: N() }),
  Mp = z({ vaultId: N(), hashes: R(N().regex(/^[0-9a-f]{64}$/)).max(256) }),
  Np = z({ keepVaultId: N().nullable() }),
  Pp = z({ canonical: N() }),
  Fp = z({ secretB64: N(), message: N() }),
  Ip = z({ password: N(), saltB64: N() }),
  Lp = z({ password: N(), saltB64: N(), canonical: N() }),
  Rp = z({ password: N(), saltB64: N(), message: N() }),
  zp = z({ approved: L() }),
  Bp = z({
    sas: N(),
    sasEmoji: R(F().int()).optional(),
    label: N(),
  }).nullable(),
  Vp = z({
    kind: N(),
    vaultBlobB64: N().optional(),
    roster: Rd.optional(),
    entryJson: N().optional(),
    message: N().optional(),
    sas: N().optional(),
    sasEmoji: R(F().int()).optional(),
    label: N().optional(),
  }),
  Hp = z({ status: N(), at: F().optional() });
export {
  Zd as $,
  Fc as $t,
  Mf as A,
  Rl as At,
  sf as B,
  V as Bt,
  vp as C,
  s as Cn,
  xu as Ct,
  sp as D,
  r as Dn,
  su as Dt,
  op as E,
  n as En,
  ou as Et,
  wf as F,
  Al as Ft,
  Yd as G,
  Uc as Gt,
  tf as H,
  H as Ht,
  nf as I,
  nl as It,
  zd as J,
  Gc as Jt,
  Id as K,
  Bc as Kt,
  df as L,
  ul as Lt,
  Sf as M,
  zl as Mt,
  bf as N,
  Vl as Nt,
  Pf as O,
  t as On,
  au as Ot,
  xf as P,
  Bl as Pt,
  qd as Q,
  qc as Qt,
  cf as R,
  ml as Rt,
  yp as S,
  o as Sn,
  gu as St,
  Cp as T,
  m as Tn,
  cu as Tt,
  Fd as U,
  zc as Ut,
  of as V,
  $c as Vt,
  Qd as W,
  Jc as Wt,
  $d as X,
  Kc as Xt,
  Bd as Y,
  Yc as Yt,
  Xd as Z,
  Xc as Zt,
  jp as _,
  ec as _n,
  Fu as _t,
  Ap as a,
  Lc as an,
  jd as at,
  wp as b,
  Ks as bn,
  Cu as bt,
  Dp as c,
  Mc as cn,
  id as ct,
  Pp as d,
  L as dn,
  ad as dt,
  Ac as en,
  Ld as et,
  Fp as f,
  Js as fn,
  Uu as ft,
  Hp as g,
  z as gn,
  Vu as gt,
  Vp as h,
  F as hn,
  Bu as ht,
  kp as i,
  kc as in,
  Pd as it,
  Cf as j,
  Ll as jt,
  Nf as k,
  e as kn,
  ql as kt,
  Op as l,
  nc as ln,
  nd as lt,
  Ep as m,
  Ws as mn,
  $u as mt,
  Lp as n,
  Ic as nn,
  Md as nt,
  Mp as o,
  jc as on,
  bd as ot,
  Np as p,
  B as pn,
  ed as pt,
  Vd as q,
  Hc as qt,
  Rp as r,
  Rc as rn,
  Nd as rt,
  zp as s,
  Nc as sn,
  vd as st,
  Ip as t,
  Pc as tn,
  Jd as tt,
  Bp as u,
  R as un,
  rd as ut,
  Tp as v,
  N as vn,
  Mu as vt,
  Sp as w,
  c as wn,
  hu as wt,
  bp as x,
  zs as xn,
  Su as xt,
  xp as y,
  Qs as yn,
  Eu as yt,
  uf as z,
  hl as zt,
};
