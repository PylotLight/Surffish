import { u as e } from "./button-DmLv96bj.js";
var t = (e) => typeof e == `string`,
  n = (e) => typeof e == `function`,
  r = new Map(),
  i = `en`;
function a(e) {
  return [...(Array.isArray(e) ? e : [e]), i];
}
function o(e, n, r) {
  let i = a(e);
  r ||= `default`;
  let o;
  if (typeof r == `string`)
    switch (((o = { day: `numeric`, month: `short`, year: `numeric` }), r)) {
      case `full`:
        o.weekday = `long`;
      case `long`:
        o.month = `long`;
        break;
      case `short`:
        o.month = `numeric`;
    }
  else o = r;
  return u(
    () => d(`date`, i, r),
    () => new Intl.DateTimeFormat(i, o),
  ).format(t(n) ? new Date(n) : n);
}
function s(e, t, n) {
  let r;
  if (((n ||= `default`), typeof n == `string`))
    switch (
      ((r = { second: `numeric`, minute: `numeric`, hour: `numeric` }), n)
    ) {
      case `full`:
      case `long`:
        r.timeZoneName = `short`;
        break;
      case `short`:
        delete r.second;
    }
  else r = n;
  return o(e, t, r);
}
function c(e, t, n) {
  let r = a(e);
  return u(
    () => d(`number`, r, n),
    () => new Intl.NumberFormat(r, n),
  ).format(t);
}
function l(e, t, n, { offset: r = 0, ...i }) {
  let o = a(e),
    s = t
      ? u(
          () => d(`plural-ordinal`, o),
          () => new Intl.PluralRules(o, { type: `ordinal` }),
        )
      : u(
          () => d(`plural-cardinal`, o),
          () => new Intl.PluralRules(o, { type: `cardinal` }),
        );
  return i[n] ?? i[s.select(n - r)] ?? i.other;
}
function u(e, t) {
  let n = e(),
    i = r.get(n);
  return (i || ((i = t()), r.set(n, i)), i);
}
function d(e, t, n) {
  return `${e}-${t.join(`-`)}-${JSON.stringify(n)}`;
}
var f = /\\u[a-fA-F0-9]{4}|\\x[a-fA-F0-9]{2}/,
  p = (e) =>
    e.replace(/\\u([a-fA-F0-9]{4})|\\x([a-fA-F0-9]{2})/g, (e, t, n) => {
      if (t) {
        let e = parseInt(t, 16);
        return String.fromCharCode(e);
      }
      {
        let e = parseInt(n, 16);
        return String.fromCharCode(e);
      }
    }),
  m = `%__lingui_octothorpe__%`,
  h = (e, t, n = {}) => {
    let r = t || e,
      i = (e) => (typeof e == `object` ? e : n[e]),
      a = (e, t) => {
        let a = Object.keys(n).length ? i(`number`) : void 0,
          o = c(r, e, a);
        return t.replace(new RegExp(m, `g`), o);
      };
    return {
      plural: (e, t) => {
        let { offset: n = 0 } = t,
          i = l(r, !1, e, t);
        return a(e - n, i);
      },
      selectordinal: (e, t) => {
        let { offset: n = 0 } = t,
          i = l(r, !0, e, t);
        return a(e - n, i);
      },
      select: g,
      number: (e, t) => c(r, e, i(t) || { style: t }),
      date: (e, t) => o(r, e, i(t) || t),
      time: (e, t) => s(r, e, i(t) || t),
    };
  },
  g = (e, t) => t[e] ?? t.other;
function _(e, n, r) {
  return (i = {}, a) => {
    let o = h(n, r, a),
      s = (e, n = !1) =>
        Array.isArray(e)
          ? e.reduce((e, r) => {
              if (r === `#` && n) return e + m;
              if (t(r)) return e + r;
              let [a, c, l] = r,
                u = {};
              c === `plural` || c === `selectordinal` || c === `select`
                ? Object.entries(l).forEach(([e, t]) => {
                    u[e] = s(t, c === `plural` || c === `selectordinal`);
                  })
                : (u = l);
              let d;
              if (c) {
                let e = o[c];
                d = e(i[a], u);
              } else d = i[a];
              return d == null ? e : e + d;
            }, ``)
          : e,
      c = s(e);
    return t(c) && f.test(c) ? p(c) : t(c) ? c : c ? String(c) : ``;
  };
}
var v = class {
    _events = {};
    on(e, t) {
      return (
        (this._events[e] ??= new Set()),
        this._events[e].add(t),
        () => this.removeListener(e, t)
      );
    }
    removeListener(e, t) {
      let n = this._events[e];
      (n?.delete(t), n?.size === 0 && delete this._events[e]);
    }
    emit(e, ...t) {
      let n = this._events[e];
      if (n) for (let e of [...n]) e.apply(this, t);
    }
  },
  y = class extends v {
    _locale = ``;
    _locales;
    _messages = {};
    _missing;
    _messageCompiler;
    constructor(e) {
      (super(),
        e.missing != null && (this._missing = e.missing),
        e.messages != null && this.load(e.messages),
        (typeof e.locale == `string` || e.locales) &&
          this.activate(e.locale ?? i, e.locales));
    }
    get locale() {
      return this._locale;
    }
    get locales() {
      return this._locales;
    }
    get messages() {
      return this._messages[this._locale] ?? {};
    }
    setMessagesCompiler(e) {
      return ((this._messageCompiler = e), this);
    }
    _load(e, t) {
      let n = this._messages[e];
      n ? Object.assign(n, t) : (this._messages[e] = t);
    }
    load(e, t) {
      (typeof e == `string` && typeof t == `object`
        ? this._load(e, t)
        : Object.entries(e).forEach(([e, t]) => this._load(e, t)),
        this.emit(`change`));
    }
    loadAndActivate({ locale: e, locales: t, messages: n }) {
      ((this._locale = e),
        (this._locales = t || void 0),
        (this._messages[this._locale] = n),
        this.emit(`change`));
    }
    activate(e, t) {
      ((this._locale = e), (this._locales = t), this.emit(`change`));
    }
    _(e, r, i) {
      if (!this.locale)
        throw Error(`Lingui: Attempted to call a translation function without setting a locale.
Make sure to call \`i18n.activate(locale)\` before using Lingui functions.
This issue may also occur due to a race condition in your initialization logic.`);
      let a = i?.message;
      ((e ||= ``), t(e) || ((r = e.values || r), (a = e.message), (e = e.id)));
      let o = this.messages[e],
        s = o === void 0,
        c = this._missing;
      if (c && s) return n(c) ? c(this._locale, e) : c;
      s && this.emit(`missing`, { id: e, locale: this._locale });
      let l = o || a || e;
      return (
        t(l) &&
          (this._messageCompiler
            ? (l = this._messageCompiler(l))
            : console.warn(`Uncompiled message detected! Message:

> ${l}

That means you use raw catalog or your catalog doesn't have a translation for the message and fallback was used.
ICU features such as interpolation and plurals will not work properly for that message.

Please compile your catalog first.
`)),
        t(l) && f.test(l)
          ? p(l)
          : t(l)
            ? l
            : _(l, this._locale, this._locales)(r, i?.formats)
      );
    }
    t = this._.bind(this);
    date(e, t) {
      return o(this._locales || this._locale, e, t);
    }
    number(e, t) {
      return c(this._locales || this._locale, e, t);
    }
  };
function b(e = {}) {
  return new y(e);
}
var x = b(),
  S = e(`ChevronRight`, [[`path`, { d: `m9 18 6-6-6-6`, key: `mthhwq` }]]),
  C = e(`Plus`, [
    [`path`, { d: `M5 12h14`, key: `1ays0h` }],
    [`path`, { d: `M12 5v14`, key: `s699le` }],
  ]);
function w(e) {
  return x.date(typeof e == `number` ? new Date(e) : e, {
    dateStyle: `medium`,
  });
}
function T(e) {
  return x.date(typeof e == `number` ? new Date(e) : e, {
    dateStyle: `medium`,
    timeStyle: `short`,
  });
}
function E(e) {
  let t = new Intl.RelativeTimeFormat(x.locale, { numeric: `always` }),
    n = Math.round(e / 6e4);
  if (n < 60) return t.format(Math.max(1, n), `minute`);
  let r = Math.round(n / 60);
  return r < 24 ? t.format(r, `hour`) : t.format(Math.round(r / 24), `day`);
}
function D(e) {
  return x.date(typeof e == `number` ? new Date(e) : e, {
    dateStyle: `medium`,
    timeStyle: `medium`,
  });
}
export { C as a, E as i, T as n, S as o, D as r, x as s, w as t };
