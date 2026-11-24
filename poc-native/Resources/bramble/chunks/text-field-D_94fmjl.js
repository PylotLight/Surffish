import {
  i as e,
  n as t,
  r as n,
  t as r,
  u as i,
} from "./build-vault-Dl7gFnhh.js";
import {
  At as a,
  D as o,
  H as s,
  M as c,
  P as l,
  S as u,
  T as d,
  U as f,
  et as p,
  lt as m,
  nt as h,
  pt as g,
  rt as _,
  tt as v,
  vt as y,
  yt as ee,
} from "./storage-nmIf6WgJ.js";
import {
  _ as b,
  a as te,
  g as x,
  l as ne,
  o as re,
  p as ie,
  r as S,
} from "./button-DmLv96bj.js";
import {
  $ as ae,
  $t as C,
  At as oe,
  B as se,
  Ct as ce,
  Dt as le,
  Et as ue,
  Ft as w,
  G as de,
  H as fe,
  Ht as pe,
  I as me,
  J as T,
  K as E,
  Kt as he,
  Lt as ge,
  Mt as _e,
  Nt as ve,
  Pt as ye,
  R as be,
  Rt as D,
  St as xe,
  Tn as Se,
  Tt as Ce,
  U as we,
  Ut as Te,
  V as Ee,
  W as De,
  Z as Oe,
  _t as ke,
  an as Ae,
  bt as je,
  ct as Me,
  dn as Ne,
  dt as Pe,
  en as O,
  et as Fe,
  fn as Ie,
  ft as Le,
  gn as Re,
  gt as ze,
  hn as Be,
  ht as Ve,
  in as k,
  it as He,
  jt as Ue,
  kn as We,
  ln as A,
  lt as Ge,
  mn as j,
  mt as M,
  nn as Ke,
  nt as qe,
  ot as Je,
  pn as Ye,
  qt as Xe,
  rn as Ze,
  rt as Qe,
  un as $e,
  ut as et,
  vn as N,
  wn as tt,
  wt as nt,
  xn as P,
  zt as rt,
} from "./messages-DLCDPx8W.js";
var F = `interrupted`,
  it = `invalidated`,
  at = `lockout`;
function ot(e, t) {
  return typeof e == `object` && !!e && e.code === t;
}
function st(e) {
  return ot(e, F);
}
function ct(e) {
  return ot(e, it);
}
function lt(e) {
  return ot(e, at);
}
function ut(e) {
  return (
    e.entryCount === 0 &&
    e.fileCount === 0 &&
    !dt(e.quarantineRaw) &&
    e.rosterDevices <= 1 &&
    !e.hasAliasConfig
  );
}
function dt(e) {
  if (e === null || e === ``) return !1;
  try {
    let t = JSON.parse(e);
    return !Array.isArray(t) || t.length > 0;
  } catch {
    return !0;
  }
}
async function ft(e, t, n, r) {
  let i = await e.getMeta(f(`sync.group`, t)),
    a = await e.getMeta(v(t)),
    o = await e.getMeta(p(t));
  return {
    entryCount: n,
    fileCount: r,
    quarantineRaw: (await e.readQuarantine?.(t)) ?? null,
    rosterDevices: Math.max(1, i?.roster?.devices?.length ?? 0),
    hasAliasConfig: a === !0 || o != null,
  };
}
var pt = /^[A-Za-z0-9_-]+$/,
  mt = /^[A-Za-z0-9+/]+={0,2}$/,
  ht = 1023,
  gt = 1023,
  _t = 1024,
  vt = 4096;
function yt(e) {
  return Math.ceil((e * 4) / 3);
}
var bt = 32;
function I(e, t) {
  let n = (e) => e.length > 0 && e.length <= 1024;
  if (!n(e) || (t?.length && !n(t))) return;
  let r = t?.length ? t : crypto.getRandomValues(new Uint8Array(bt));
  return { credWithUV: k(e), credWithoutUV: k(r) };
}
var L = `\0`;
function R(e) {
  throw Error(L + e);
}
function z(e) {
  let t = e instanceof Error ? e.message : ``;
  return t.startsWith(L) ? t.slice(1) : null;
}
function xt(e, t) {
  return (
    e.length === 0 && R(`empty`),
    e.length > yt(t) && R(`longer than the ${t}-byte maximum`),
    (pt.test(e) && e.length % 4 != 1) || R(`not valid unpadded base64url`),
    e
  );
}
function St(e, t) {
  let n = Ze(xt(e, t));
  return (
    n.length === 0 && R(`empty`),
    n.length > t && R(`longer than the ${t}-byte maximum`),
    k(n)
  );
}
function Ct(e) {
  return St(e, gt);
}
function wt(e) {
  return Ke(xt(e, _t));
}
function Tt(e) {
  (e.length === 0 && R(`empty`),
    e.length > vt && R(`longer than the ${vt}-character maximum`),
    e.includes(`BEGIN EC PRIVATE KEY`) && R(`in SEC1 form rather than PKCS#8`));
  let t = e.indexOf(`-----BEGIN PRIVATE KEY-----`),
    n = e.indexOf(`-----END PRIVATE KEY-----`);
  (t === -1 || n === -1 || n < t) && R(`not a PKCS#8 PEM private key`);
  let r = e.slice(t + 27, n).replace(/\s+/g, ``);
  return (
    r.length === 0 && R(`empty`),
    r.length > yt(1024) && R(`longer than the ${_t}-byte maximum`),
    mt.test(r) || R(`not valid base64`),
    r
  );
}
function Et(e) {
  return e.length === 0 || e.length > 253
    ? !1
    : e
        .split(`.`)
        .every((e) =>
          /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(e),
        );
}
function Dt(e, t) {
  return e.failed === 0 || e.converted > 0
    ? null
    : `No passkey could be converted, which usually means the app's crypto module is out of date rather than a problem with your ${t}.`;
}
var B = Uint8Array,
  Ot = Uint16Array,
  kt = Int32Array,
  At = new B([
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5,
    5, 5, 5, 0, 0, 0, 0,
  ]),
  jt = new B([
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10,
    11, 11, 12, 12, 13, 13, 0, 0,
  ]),
  Mt = new B([
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
  ]),
  Nt = function (e, t) {
    for (var n = new Ot(31), r = 0; r < 31; ++r) n[r] = t += 1 << e[r - 1];
    for (var i = new kt(n[30]), r = 1; r < 30; ++r)
      for (var a = n[r]; a < n[r + 1]; ++a) i[a] = ((a - n[r]) << 5) | r;
    return { b: n, r: i };
  },
  V = Nt(At, 2),
  Pt = V.b,
  Ft = V.r;
((Pt[28] = 258), (Ft[258] = 28));
var It = Nt(jt, 0),
  H = It.b;
It.r;
for (var Lt = new Ot(32768), U = 0; U < 32768; ++U) {
  var W = ((U & 43690) >> 1) | ((U & 21845) << 1);
  ((W = ((W & 52428) >> 2) | ((W & 13107) << 2)),
    (W = ((W & 61680) >> 4) | ((W & 3855) << 4)),
    (Lt[U] = (((W & 65280) >> 8) | ((W & 255) << 8)) >> 1));
}
for (
  var Rt = function (e, t, n) {
      for (var r = e.length, i = 0, a = new Ot(t); i < r; ++i)
        e[i] && ++a[e[i] - 1];
      var o = new Ot(t);
      for (i = 1; i < t; ++i) o[i] = (o[i - 1] + a[i - 1]) << 1;
      var s;
      if (n) {
        s = new Ot(1 << t);
        var c = 15 - t;
        for (i = 0; i < r; ++i)
          if (e[i])
            for (
              var l = (i << 4) | e[i],
                u = t - e[i],
                d = o[e[i] - 1]++ << u,
                f = d | ((1 << u) - 1);
              d <= f;
              ++d
            )
              s[Lt[d] >> c] = l;
      } else
        for (s = new Ot(r), i = 0; i < r; ++i)
          e[i] && (s[i] = Lt[o[e[i] - 1]++] >> (15 - e[i]));
      return s;
    },
    zt = new B(288),
    U = 0;
  U < 144;
  ++U
)
  zt[U] = 8;
for (var U = 144; U < 256; ++U) zt[U] = 9;
for (var U = 256; U < 280; ++U) zt[U] = 7;
for (var U = 280; U < 288; ++U) zt[U] = 8;
for (var Bt = new B(32), U = 0; U < 32; ++U) Bt[U] = 5;
var Vt = Rt(zt, 9, 1),
  Ht = Rt(Bt, 5, 1),
  Ut = function (e) {
    for (var t = e[0], n = 1; n < e.length; ++n) e[n] > t && (t = e[n]);
    return t;
  },
  G = function (e, t, n) {
    var r = (t / 8) | 0;
    return ((e[r] | (e[r + 1] << 8)) >> (t & 7)) & n;
  },
  Wt = function (e, t) {
    var n = (t / 8) | 0;
    return (e[n] | (e[n + 1] << 8) | (e[n + 2] << 16)) >> (t & 7);
  },
  Gt = function (e) {
    return ((e + 7) / 8) | 0;
  },
  Kt = function (e, t, n) {
    return (
      (t == null || t < 0) && (t = 0),
      (n == null || n > e.length) && (n = e.length),
      new B(e.subarray(t, n))
    );
  },
  qt = [
    `unexpected EOF`,
    `invalid block type`,
    `invalid length/literal`,
    `invalid distance`,
    `stream finished`,
    `no stream handler`,
    ,
    `no callback`,
    `invalid UTF-8 data`,
    `extra field too long`,
    `date not in range 1980-2099`,
    `filename too long`,
    `stream finishing`,
    `invalid zip data`,
  ],
  K = function (e, t, n) {
    var r = Error(t || qt[e]);
    if (
      ((r.code = e),
      Error.captureStackTrace && Error.captureStackTrace(r, K),
      !n)
    )
      throw r;
    return r;
  },
  Jt = function (e, t, n, r) {
    var i = e.length,
      a = r ? r.length : 0;
    if (!i || (t.f && !t.l)) return n || new B(0);
    var o = !n,
      s = o || t.i != 2,
      c = t.i;
    o && (n = new B(i * 3));
    var l = function (e) {
        var t = n.length;
        if (e > t) {
          var r = new B(Math.max(t * 2, e));
          (r.set(n), (n = r));
        }
      },
      u = t.f || 0,
      d = t.p || 0,
      f = t.b || 0,
      p = t.l,
      m = t.d,
      h = t.m,
      g = t.n,
      _ = i * 8;
    do {
      if (!p) {
        u = G(e, d, 1);
        var v = G(e, d + 1, 3);
        if (((d += 3), !v)) {
          var y = Gt(d) + 4,
            ee = e[y - 4] | (e[y - 3] << 8),
            b = y + ee;
          if (b > i) {
            c && K(0);
            break;
          }
          (s && l(f + ee),
            n.set(e.subarray(y, b), f),
            (t.b = f += ee),
            (t.p = d = b * 8),
            (t.f = u));
          continue;
        }
        if (v == 1) ((p = Vt), (m = Ht), (h = 9), (g = 5));
        else if (v == 2) {
          var te = G(e, d, 31) + 257,
            x = G(e, d + 10, 15) + 4,
            ne = te + G(e, d + 5, 31) + 1;
          d += 14;
          for (var re = new B(ne), ie = new B(19), S = 0; S < x; ++S)
            ie[Mt[S]] = G(e, d + S * 3, 7);
          d += x * 3;
          for (
            var ae = Ut(ie), C = (1 << ae) - 1, oe = Rt(ie, ae, 1), S = 0;
            S < ne;
          ) {
            var se = oe[G(e, d, C)];
            d += se & 15;
            var y = se >> 4;
            if (y < 16) re[S++] = y;
            else {
              var ce = 0,
                le = 0;
              for (
                y == 16
                  ? ((le = 3 + G(e, d, 3)), (d += 2), (ce = re[S - 1]))
                  : y == 17
                    ? ((le = 3 + G(e, d, 7)), (d += 3))
                    : y == 18 && ((le = 11 + G(e, d, 127)), (d += 7));
                le--;
              )
                re[S++] = ce;
            }
          }
          var ue = re.subarray(0, te),
            w = re.subarray(te);
          ((h = Ut(ue)), (g = Ut(w)), (p = Rt(ue, h, 1)), (m = Rt(w, g, 1)));
        } else K(1);
        if (d > _) {
          c && K(0);
          break;
        }
      }
      s && l(f + 131072);
      for (var de = (1 << h) - 1, fe = (1 << g) - 1, pe = d; ; pe = d) {
        var ce = p[Wt(e, d) & de],
          me = ce >> 4;
        if (((d += ce & 15), d > _)) {
          c && K(0);
          break;
        }
        if ((ce || K(2), me < 256)) n[f++] = me;
        else if (me == 256) {
          ((pe = d), (p = null));
          break;
        } else {
          var T = me - 254;
          if (me > 264) {
            var S = me - 257,
              E = At[S];
            ((T = G(e, d, (1 << E) - 1) + Pt[S]), (d += E));
          }
          var he = m[Wt(e, d) & fe],
            ge = he >> 4;
          (he || K(3), (d += he & 15));
          var w = H[ge];
          if (ge > 3) {
            var E = jt[ge];
            ((w += Wt(e, d) & ((1 << E) - 1)), (d += E));
          }
          if (d > _) {
            c && K(0);
            break;
          }
          s && l(f + 131072);
          var _e = f + T;
          if (f < w) {
            var ve = a - w,
              ye = Math.min(w, _e);
            for (ve + f < 0 && K(3); f < ye; ++f) n[f] = r[ve + f];
          }
          for (; f < _e; ++f) n[f] = n[f - w];
        }
      }
      ((t.l = p),
        (t.p = pe),
        (t.b = f),
        (t.f = u),
        p && ((u = 1), (t.m = h), (t.d = m), (t.n = g)));
    } while (!u);
    return f != n.length && o ? Kt(n, 0, f) : n.subarray(0, f);
  },
  Yt = new B(0),
  q = function (e, t) {
    return e[t] | (e[t + 1] << 8);
  },
  J = function (e, t) {
    return (e[t] | (e[t + 1] << 8) | (e[t + 2] << 16) | (e[t + 3] << 24)) >>> 0;
  },
  Xt = function (e, t) {
    return J(e, t) + J(e, t + 4) * 4294967296;
  };
function Zt(e, t) {
  return Jt(e, { i: 2 }, t && t.out, t && t.dictionary);
}
var Qt = typeof TextDecoder < `u` && new TextDecoder();
try {
  Qt.decode(Yt, { stream: !0 });
} catch {}
var $t = function (e) {
  for (var t = ``, n = 0; ;) {
    var r = e[n++],
      i = (r > 127) + (r > 223) + (r > 239);
    if (n + i > e.length) return { s: t, r: Kt(e, n - 1) };
    i
      ? i == 3
        ? ((r =
            (((r & 15) << 18) |
              ((e[n++] & 63) << 12) |
              ((e[n++] & 63) << 6) |
              (e[n++] & 63)) -
            65536),
          (t += String.fromCharCode(55296 | (r >> 10), 56320 | (r & 1023))))
        : i & 1
          ? (t += String.fromCharCode(((r & 31) << 6) | (e[n++] & 63)))
          : (t += String.fromCharCode(
              ((r & 15) << 12) | ((e[n++] & 63) << 6) | (e[n++] & 63),
            ))
      : (t += String.fromCharCode(r));
  }
};
function en(e, t) {
  if (t) {
    for (var n = ``, r = 0; r < e.length; r += 16384)
      n += String.fromCharCode.apply(null, e.subarray(r, r + 16384));
    return n;
  }
  if (Qt) return Qt.decode(e);
  var i = $t(e),
    a = i.s,
    n = i.r;
  return (n.length && K(8), a);
}
var tn = function (e, t) {
    return t + 30 + q(e, t + 26) + q(e, t + 28);
  },
  nn = function (e, t, n) {
    var r = q(e, t + 28),
      i = q(e, t + 30),
      a = en(e.subarray(t + 46, t + 46 + r), !(q(e, t + 8) & 2048)),
      o = t + 46 + r,
      s = rn(e, o, i, n, J(e, t + 20), J(e, t + 24), J(e, t + 42)),
      c = s[0],
      l = s[1],
      u = s[2];
    return [q(e, t + 10), c, l, a, o + i + q(e, t + 32), u];
  },
  rn = function (e, t, n, r, i, a, o) {
    var s = i == 4294967295,
      c = a == 4294967295,
      l = o == 4294967295,
      u = t + n,
      d = s + c + l;
    if (r && d) {
      for (; t + 4 < u; t += 4 + q(e, t + 2))
        if (q(e, t) == 1)
          return [
            s ? Xt(e, t + 4 + 8 * c) : i,
            c ? Xt(e, t + 4) : a,
            l ? Xt(e, t + 4 + 8 * (c + s)) : o,
            1,
          ];
      r < 2 && K(13);
    }
    return [i, a, o, 0];
  };
function an(e, t) {
  for (var n = {}, r = e.length - 22; J(e, r) != 101010256; --r)
    (!r || e.length - r > 65558) && K(13);
  var i = q(e, r + 8);
  if (!i) return {};
  var a = J(e, r + 16),
    o = J(e, r - 20) == 117853008;
  if (o) {
    var s = J(e, r - 12);
    ((o = J(e, s) == 101075792), o && ((i = J(e, s + 32)), (a = J(e, s + 48))));
  }
  for (var c = t && t.filter, l = 0; l < i; ++l) {
    var u = nn(e, a, o),
      d = u[0],
      f = u[1],
      p = u[2],
      m = u[3],
      h = u[4],
      g = u[5],
      _ = tn(e, g);
    ((a = h),
      (!c || c({ name: m, size: f, originalSize: p, compression: d })) &&
        (d
          ? d == 8
            ? (n[m] = Zt(e.subarray(_, _ + f), { out: new B(p) }))
            : K(14, `unknown compression type ` + d)
          : (n[m] = Kt(e, _, _ + f))));
  }
  return n;
}
function on(e) {
  let t = [];
  for (let { key: n, value: r, hidden: i } of e)
    n &&
      r &&
      t.push(i ? { key: n, value: r, hidden: !0 } : { key: n, value: r });
  return t.length ? t : void 0;
}
function sn(e) {
  let t = {};
  for (let n of e) t[n.type] = (t[n.type] ?? 0) + 1;
  return t;
}
function cn(e) {
  if (e.type !== `login` || e.subdomainMatch !== void 0) return e;
  let { hostnames: t, ports: n } = tt(e.urls);
  return t.length === 1 && n ? { ...e, subdomainMatch: `exact` } : e;
}
function ln(e, t, n, r = []) {
  let i = [],
    a = new Map(),
    o = 0;
  for (let t of e) {
    if (!Ve.safeParse(t).success) {
      o++;
      continue;
    }
    let e = cn(t);
    (i.push(e), a.set(t, e));
  }
  o > 0 && n.push(`${o} item(s) had an unexpected shape and were skipped.`);
  let s = [];
  for (let e of r) {
    let t = a.get(e.entry);
    t && s.push({ ...e, entry: t });
  }
  if (s.length < r.length) {
    let e = r.length - s.length;
    n.push(`${e} attachment(s) belonged to items that couldn't be imported.`);
  }
  let c = { imported: i, byType: sn(i), skipped: t + o, warnings: n };
  return s.length > 0 ? { ...c, attachments: s } : c;
}
var un = (e) =>
  `${e} attachment(s) are named in this export but not stored in it.`;
function dn(e) {
  if (!e) return ``;
  try {
    return new URL(e).hostname || e;
  } catch {
    try {
      return new URL(`https://${e}`).hostname || e;
    } catch {
      return e;
    }
  }
}
function fn(e) {
  return typeof e == `string` ? e : en(e);
}
function pn(e) {
  let t = e.charCodeAt(0) === 65279 ? e.slice(1) : e,
    n = [],
    r = [],
    i = ``,
    a = !1;
  for (let e = 0; e < t.length; e++) {
    let o = t[e];
    a
      ? o === `"`
        ? t[e + 1] === `"`
          ? ((i += `"`), e++)
          : (a = !1)
        : (i += o)
      : o === `"`
        ? (a = !0)
        : o === `,`
          ? (r.push(i), (i = ``))
          : o ===
                `
` || o === `\r`
            ? (o === `\r` &&
                t[e + 1] ===
                  `
` &&
                e++,
              r.push(i),
              n.push(r),
              (r = []),
              (i = ``))
            : (i += o);
  }
  return (
    (i !== `` || r.length > 0) && (r.push(i), n.push(r)),
    n.filter((e) => e.length > 1 || e[0] !== ``)
  );
}
function mn(e) {
  if (typeof e == `string`) throw Error(`expected file bytes, received text`);
  return e;
}
var hn = 209715200,
  gn = `This archive decompresses to more than ${hn / 1024 / 1024} MB and looks unsafe to process.`;
function _n(e, t) {
  let n = 0,
    r;
  try {
    r = an(mn(e), { filter: (e) => ((n += e.originalSize), n <= hn) });
  } catch {
    throw Error(t);
  }
  if (n > hn) throw Error(gn);
  return (yn(r), r);
}
function vn(e, t) {
  let n = _n(e, t.corruptError),
    r = t.findData(n);
  if (!r) throw Error(t.formatError);
  let i;
  try {
    i = JSON.parse(en(r));
  } catch {
    throw Error(t.formatError);
  }
  let a = t.schema.safeParse(i);
  if (!a.success) throw Error(t.formatError);
  return { data: a.data, files: n };
}
function yn(e) {
  let t = 0;
  for (let n in e) {
    let r = e[n];
    if ((r && (t += r.byteLength), t > hn)) throw Error(gn);
  }
}
function bn(e) {
  let t = e.replace(/\D/g, ``);
  if (/^4/.test(t)) return `Visa`;
  if (/^(5[1-5]|2[2-7])/.test(t)) return `Mastercard`;
  if (/^3[47]/.test(t)) return `Amex`;
  if (/^6(?:011|5)/.test(t)) return `Discover`;
}
var xn = new Map([
  [`visa`, `Visa`],
  [`mastercard`, `Mastercard`],
  [`master card`, `Mastercard`],
  [`amex`, `Amex`],
  [`american express`, `Amex`],
  [`discover`, `Discover`],
]);
function Sn(e) {
  return xn.get(e.trim().toLowerCase());
}
var Cn = /^[\d\s-]+$/;
function wn(e) {
  return e.replace(/\D/g, ``);
}
function Tn(e) {
  if (!Cn.test(e)) return e;
  let t = wn(e);
  return bn(t) === `Amex` && t.length === 15
    ? `${t.slice(0, 4)} ${t.slice(4, 10)} ${t.slice(10)}`
    : t.replace(/(\d{4})(?=\d)/g, `$1 `);
}
function En(e) {
  return Cn.test(e) ? wn(e) : e;
}
var Dn = 12,
  On = 19,
  kn = { Visa: [13, 16, 19], Mastercard: [16], Amex: [15], Discover: [16, 19] };
function An(e) {
  if (!e) return !1;
  let t = 0,
    n = !1;
  for (let r = e.length - 1; r >= 0; r--) {
    let i = e.charCodeAt(r) - 48;
    if (i < 0 || i > 9) return !1;
    let a = i;
    (n && ((a *= 2), a > 9 && (a -= 9)), (t += a), (n = !n));
  }
  return t % 10 == 0;
}
var Y = (e) => ({ error: e, abort: !0 }),
  jn = N()
    .trim()
    .min(1)
    .refine((e) => !/[^\d\s-]/.test(e), Y(`non-digit`))
    .refine((e) => {
      let t = wn(e).length;
      return t >= Dn && t <= On;
    }, Y(`length`))
    .refine((e) => {
      let t = wn(e),
        n = kn[bn(t) ?? ``];
      return !n || n.includes(t.length);
    }, Y(`brand-length`))
    .refine((e) => An(wn(e)), Y(`checksum`));
function Mn(e) {
  return Nn(jn, e, `checksum`);
}
function Nn(e, t, n) {
  if (!t?.trim()) return null;
  let r = e.safeParse(t);
  return r.success ? null : (r.error.issues[0]?.message ?? n);
}
var Pn = 2e3,
  Fn = 2099,
  In = N()
    .trim()
    .min(1)
    .refine((e) => /^\d{1,2}$/.test(e), Y(`non-digit`))
    .refine((e) => {
      let t = Number(e);
      return t >= 1 && t <= 12;
    }, Y(`range`)),
  Ln = N()
    .trim()
    .min(1)
    .refine((e) => /^\d+$/.test(e), Y(`non-digit`))
    .refine((e) => e.length === 2 || e.length === 4, Y(`length`))
    .refine((e) => {
      if (e.length === 2) return !0;
      let t = Number(e);
      return t >= Pn && t <= Fn;
    }, Y(`range`)),
  Rn = N()
    .trim()
    .min(1)
    .refine((e) => /^\d+$/.test(e), Y(`non-digit`))
    .refine((e) => e.length === 3 || e.length === 4, Y(`length`));
function zn(e) {
  return Nn(In, e, `range`);
}
function Bn(e) {
  return Nn(Ln, e, `range`);
}
function Vn(e) {
  return Nn(Rn, e, `length`);
}
function X(e) {
  return e.trim().toLocaleLowerCase();
}
function Hn(e) {
  if (!Array.isArray(e)) return;
  let t = [],
    n = new Set();
  for (let r of e) {
    if (typeof r != `string`) continue;
    let e = r
      .trim()
      .replace(/^#+/, ``)
      .replace(/\s+/g, `-`)
      .replace(/^-+|-+$/g, ``)
      .slice(0, 64);
    if (!e) continue;
    let i = X(e);
    if (!n.has(i) && (n.add(i), t.push(e), t.length >= 32)) break;
  }
  return t.length > 0 ? t : void 0;
}
function Un(e) {
  let t = (e) => String(e).padStart(2, `0`);
  return `imported-${`${e.getFullYear()}-${t(e.getMonth() + 1)}-${t(e.getDate())}`}-${t(e.getHours())}${t(e.getMinutes())}`;
}
function Wn(e, t) {
  let n = Un(t);
  return e.map((e) => ({ ...e, tags: Hn([...(e.tags ?? []), n]) }));
}
function Gn(e, t) {
  return e === t
    ? !0
    : !e || !t || e.length !== t.length
      ? !1
      : e.every((e, n) => e === t[n]);
}
function Kn(e) {
  let t = new Map();
  for (let n of e)
    for (let e of n.tags ?? []) {
      let n = X(e);
      n && !t.has(n) && t.set(n, e);
    }
  return [...t.values()].sort((e, t) =>
    e.localeCompare(t, void 0, { sensitivity: `base` }),
  );
}
var qn = A([
    `string`,
    `concealed-string`,
    `email`,
    `number`,
    `boolean`,
    `date`,
    `year-month`,
    `wifi-network-security-type`,
    `country-code`,
    `subdivision-code`,
  ]),
  Jn = j({
    id: N().optional(),
    fieldType: qn.catch(`string`).optional(),
    value: N().optional(),
    label: N().optional(),
  }),
  Yn = j({
    type: Ye(`basic-auth`),
    username: Jn.optional(),
    password: Jn.optional(),
  }),
  Xn = j({
    type: Ye(`totp`),
    secret: N(),
    period: Be().optional(),
    digits: Be().optional(),
    username: N().optional(),
    algorithm: A([`sha1`, `sha256`, `sha512`]).catch(`sha1`).optional(),
    issuer: N().optional(),
  }),
  Zn = j({
    type: Ye(`passkey`),
    credentialId: N(),
    rpId: N(),
    username: N().optional(),
    userDisplayName: N().optional(),
    userHandle: N(),
    key: N(),
    fido2Extensions: j({})
      .optional()
      .catch(void 0),
  }),
  Qn = j({
    algorithm: N().optional(),
    credWithUV: N(),
    credWithoutUV: N().optional(),
  }),
  $n = j({ type: Ye(`note`), content: Jn.optional() }),
  er = j({
    type: Ye(`credit-card`),
    number: Jn.optional(),
    fullName: Jn.optional(),
    cardType: Jn.optional(),
    verificationNumber: Jn.optional(),
    pin: Jn.optional(),
    expiryDate: Jn.optional(),
    validFrom: Jn.optional(),
  }),
  tr = j({
    type: Ye(`ssh-key`),
    keyType: N().optional(),
    privateKey: N(),
    keyComment: N().optional(),
  }),
  nr = j({
    type: Ye(`custom-fields`),
    id: N().optional(),
    label: N().optional(),
    fields: $e(Jn).optional(),
  }),
  rr = Ie(`type`, [Yn, Xn, Zn, $n, er, tr, nr]),
  ir = j({ type: N() }),
  ar = j({ urls: $e(N()).optional(), androidApps: $e(P()).optional() }),
  or = j({
    id: N().optional(),
    creationAt: Be().optional(),
    modifiedAt: Be().optional(),
    title: N().optional(),
    subtitle: N().optional(),
    favorite: Ne().optional(),
    scope: ar.optional(),
    credentials: $e(P()).optional(),
    tags: $e(N()).optional(),
  }),
  sr = j({
    id: N().optional(),
    username: N().optional(),
    email: N().optional(),
    fullName: N().optional(),
    collections: $e(P()).optional(),
    items: $e(or).optional(),
  }),
  cr = j({ major: Be().optional(), minor: Be().optional() }),
  lr = j({
    version: cr.optional(),
    exporterRpId: N().optional(),
    exporterDisplayName: N().optional(),
    timestamp: Be().optional(),
    accounts: $e(sr).optional(),
  }),
  ur = { major: 1, minor: 0 },
  dr = `This doesn't look like a credential exchange payload.`;
function fr(e) {
  return e?.value ?? ``;
}
function pr(e) {
  return e?.fieldType === `concealed-string`;
}
function mr(e) {
  let t = { passkeys: [], notes: [], fields: [], unknownTypes: [] };
  for (let n of e) {
    let e = rr.safeParse(n);
    if (!e.success) {
      hr(n, t);
      continue;
    }
    let r = e.data;
    switch (r.type) {
      case `basic-auth`:
        t.basicAuth ??= r;
        break;
      case `totp`:
        t.totp ??= r;
        break;
      case `passkey`:
        t.passkeys.push(r);
        break;
      case `credit-card`:
        t.card ??= r;
        break;
      case `ssh-key`:
        t.ssh ??= r;
        break;
      case `note`: {
        let e = fr(r.content);
        e && t.notes.push(e);
        break;
      }
      case `custom-fields`:
        for (let e of r.fields ?? [])
          t.fields.push({ key: e.label ?? ``, value: fr(e), hidden: pr(e) });
    }
  }
  return t;
}
function hr(e, t) {
  let n = ir.safeParse(e);
  if (n.success) {
    t.unknownTypes.push(n.data.type);
    for (let [e, r] of Object.entries(n.data))
      e !== `type` &&
        typeof r == `string` &&
        t.fields.push({ key: e, value: r });
  }
}
function gr(e) {
  if (!e) return { unusable: !1, badLargeBlob: !1 };
  let { hmacCredentials: t, ...n } = e,
    { kept: r, badLargeBlob: i } = Xe(n);
  if (t === void 0) return { rest: r, unusable: !1, badLargeBlob: i };
  let a = Qn.safeParse(t),
    o = a.success ? (a.data.algorithm ?? `hmac-sha256`) : ``,
    s;
  if (a.success && o.toLowerCase() === `hmac-sha256`)
    try {
      let e = (e) => Ze(xt(e, Te)),
        { credWithUV: t, credWithoutUV: n } = a.data;
      s = I(e(t), n ? e(n) : void 0);
    } catch {
      s = void 0;
    }
  return { prf: s, rest: r, unusable: !s, badLargeBlob: i };
}
function _r(e) {
  return `-----BEGIN PRIVATE KEY-----\n${(Ke(e).match(/.{1,64}/g) ?? []).join(`
`)}\n-----END PRIVATE KEY-----\n`;
}
async function vr(e, t, n, r, i, a) {
  let o = [];
  for (let s of e) {
    let e;
    try {
      (Et(s.rpId) || R(`has an invalid relying-party ID`),
        (e = {
          credentialId: St(s.credentialId, ht),
          userHandle: Ct(s.userHandle),
          key: wt(s.key),
        }));
    } catch (e) {
      r.push(
        `A passkey on "${t}" ${z(e) ?? `couldn't be read`}, so it was skipped.`,
      );
      continue;
    }
    let c;
    try {
      c = await i.passkeyImportPkcs8(e.key);
    } catch {
      (r.push(
        `A passkey on "${t}" uses a key type we can't read and was skipped.`,
      ),
        a.failed++);
      continue;
    }
    a.converted++;
    let {
      prf: l,
      rest: u,
      unusable: d,
      badLargeBlob: f,
    } = gr(s.fido2Extensions);
    (d &&
      r.push(
        `A passkey on "${t}" had a PRF secret Bramble can't use, so it was left out. Signing in works, but a site that encrypted data with it can't decrypt that data.`,
      ),
      f &&
        r.push(
          `A passkey on "${t}" had a large blob Bramble can't use, so it was left out.`,
        ),
      o.push({
        credentialId: e.credentialId,
        rpId: s.rpId,
        userHandle: e.userHandle,
        userName: s.username || void 0,
        userDisplayName: s.userDisplayName || void 0,
        alg: c.alg,
        publicKeyCose: c.publicKeyCose,
        privateKey: c.privateKey,
        signCount: 0,
        createdAt: n,
        ...(l ? { prf: l } : {}),
        ...(u ? { fido2Extensions: u } : {}),
      }));
  }
  return o;
}
function yr(e, t, n, r) {
  try {
    return d({
      secret: e.secret,
      issuer: e.issuer,
      account: e.username,
      digits: e.digits,
      period: e.period,
      algorithm: e.algorithm,
    });
  } catch {
    (n.push({ key: `TOTP`, value: e.secret, hidden: !0 }),
      r.push(
        `The one-time-code key on "${t}" wasn't readable; kept as a custom field.`,
      ));
    return;
  }
}
async function br(e, t, n, r) {
  let i = mr(e.credentials ?? []),
    a = e.title || e.subtitle || `Untitled`,
    o =
      i.notes.join(`

`) || void 0,
    s = e.creationAt === void 0 ? void 0 : ke(e.creationAt * 1e3),
    c = e.modifiedAt === void 0 ? void 0 : ke(e.modifiedAt * 1e3),
    l = Hn(e.tags),
    u = {
      ...(s === void 0 ? {} : { createdAt: s }),
      ...(c === void 0 ? {} : { updatedAt: c }),
      ...(l ? { tags: l } : {}),
    };
  for (let e of new Set(i.unknownTypes))
    t.push(`"${a}" holds a ${e} credential, which became custom fields.`);
  if (i.basicAuth || i.totp || i.passkeys.length > 0) {
    let c = i.totp ? yr(i.totp, a, i.fields, t) : void 0,
      l = await vr(i.passkeys, a, s ?? Date.now(), t, n, r),
      d = e.scope?.urls ?? [];
    return {
      type: `login`,
      name: a,
      notes: o,
      ...u,
      urls: d.length
        ? d
        : [...new Set(i.passkeys.map((e) => `https://${e.rpId}`))],
      username:
        fr(i.basicAuth?.username) ||
        i.totp?.username ||
        i.passkeys[0]?.username ||
        ``,
      password: fr(i.basicAuth?.password),
      ...(c ? { totp: c } : {}),
      ...(l.length ? { passkeys: l } : {}),
      customFields: on(i.fields),
    };
  }
  if (i.card) {
    let e = fr(i.card.number),
      t = fr(i.card.expiryDate).split(`-`);
    return (
      fr(i.card.pin) &&
        i.fields.push({ key: `PIN`, value: fr(i.card.pin), hidden: !0 }),
      {
        type: `card`,
        name: a,
        notes: o,
        ...u,
        cardholderName: fr(i.card.fullName),
        number: e,
        brand: fr(i.card.cardType) || bn(e),
        expMonth: t[1] ? String(Number(t[1])) : ``,
        expYear: t[0] ?? ``,
        cvv: fr(i.card.verificationNumber),
        customFields: on(i.fields),
      }
    );
  }
  return i.ssh
    ? (i.ssh.keyComment &&
        i.fields.push({ key: `Comment`, value: i.ssh.keyComment }),
      {
        type: `ssh-key`,
        name: a,
        notes: o,
        ...u,
        publicKey: ``,
        privateKey: _r(i.ssh.privateKey),
        keyType: i.ssh.keyType || void 0,
        customFields: on(i.fields),
      })
    : !o && i.fields.length === 0
      ? null
      : { type: `note`, name: a, notes: o, ...u, customFields: on(i.fields) };
}
async function xr(e, t) {
  let n;
  try {
    n = JSON.parse(fn(e));
  } catch {
    throw Error(dr);
  }
  let r = lr.safeParse(n);
  if (!r.success || !r.data.accounts) throw Error(dr);
  let i = [],
    a = [],
    o = { converted: 0, failed: 0 },
    s = 0;
  for (let e of r.data.accounts)
    for (let n of e.items ?? []) {
      let e = await br(n, a, t, o);
      e ? i.push(e) : s++;
    }
  let c = Dt(o, `transfer`);
  return (c && a.push(c), ln(i, s, a));
}
function Sr(e) {
  return e.filter((e) => e.type !== `unlock-key`);
}
var Cr = 32,
  wr = new Uint8Array([
    48, 65, 2, 1, 0, 48, 19, 6, 7, 42, 134, 72, 206, 61, 2, 1, 6, 8, 42, 134,
    72, 206, 61, 3, 1, 7, 4, 39, 48, 37, 2, 1, 1, 4, 32,
  ]);
function Tr(e) {
  let t;
  try {
    t = O(e);
  } catch {
    return null;
  }
  if (t.length !== Cr) return null;
  let n = new Uint8Array(wr.length + Cr);
  return (n.set(wr, 0), n.set(t, wr.length), Ae(n));
}
var Er = new TextEncoder();
function Dr(e) {
  return Ae(Er.encode(e));
}
function Z(e, t = !1) {
  if (e) return { fieldType: t ? `concealed-string` : `string`, value: e };
}
function Or(e) {
  return e === void 0 ? void 0 : Math.floor(e / 1e3);
}
function kr(e) {
  let t = [];
  for (let n of e) {
    let e = n.trim();
    e && t.push(We(e));
  }
  return t;
}
function Ar(e, t, n) {
  if (e.alg !== -7) return null;
  let r = Tr(e.privateKey);
  if (!r) return null;
  let i =
    e.prf && he(e.prf.credWithUV) && he(e.prf.credWithoutUV) ? e.prf : void 0;
  e.prf &&
    !i &&
    t.push(
      `A passkey on "${n}" has PRF secrets Bramble can't read; it went without them.`,
    );
  let { kept: a, badLargeBlob: o } = Xe(e.fido2Extensions);
  o &&
    t.push(
      `A passkey on "${n}" has a large blob Bramble can't read; it went without it.`,
    );
  let s = {
    ...a,
    ...(i
      ? {
          hmacCredentials: {
            algorithm: `hmac-sha256`,
            credWithUV: C(i.credWithUV),
            credWithoutUV: C(i.credWithoutUV),
          },
        }
      : {}),
  };
  return {
    type: `passkey`,
    credentialId: C(e.credentialId),
    rpId: e.rpId,
    username: e.userName ?? ``,
    userDisplayName: e.userDisplayName ?? e.userName ?? ``,
    userHandle: C(e.userHandle),
    key: r,
    ...(Object.keys(s).length ? { fido2Extensions: s } : {}),
  };
}
function jr(e) {
  let t = 0;
  for (let n of e)
    for (let e of n.credentials ?? [])
      e.type === `passkey` &&
        e.fido2Extensions &&
        (delete e.fido2Extensions, t++);
  return t;
}
function Mr(e) {
  let t = o(e);
  if (!t || t.steam) return null;
  let { totp: n, issuer: r, account: i } = t;
  return {
    type: `totp`,
    secret: n.secret.base32,
    period: n.period,
    digits: n.digits,
    algorithm: n.algorithm.toLowerCase(),
    ...(i ? { username: i } : {}),
    ...(r ? { issuer: r } : {}),
  };
}
function Nr(e) {
  let t = [];
  for (let { key: n, value: r, hidden: i } of e)
    n &&
      r &&
      t.push({
        fieldType: i ? `concealed-string` : `string`,
        value: r,
        label: n,
      });
  return t.length ? { type: `custom-fields`, fields: t } : null;
}
function Pr(e, t) {
  let n = [],
    r = [...(e.customFields ?? [])];
  if (
    ((e.username || e.password) &&
      n.push({
        type: `basic-auth`,
        ...(Z(e.username) ? { username: Z(e.username) } : {}),
        ...(Z(e.password, !0) ? { password: Z(e.password, !0) } : {}),
      }),
    e.totp)
  ) {
    let i = Mr(e.totp);
    i
      ? n.push(i)
      : (r.push({ key: `TOTP`, value: e.totp, hidden: !0 }),
        t.push(
          `"${e.name}" has a one-time-code key we couldn't read; sent as a custom field.`,
        ));
  }
  for (let r of e.passkeys ?? []) {
    let i = Ar(r, t, e.name);
    i
      ? n.push(i)
      : t.push(
          `A passkey on "${e.name}" uses a key we can't export and was left behind.`,
        );
  }
  return [...n, ...Fr(r)];
}
function Fr(e) {
  let t = Nr(e);
  return t ? [t] : [];
}
function Ir(e) {
  let t =
    e.expMonth && e.expYear
      ? `${e.expYear}-${e.expMonth.padStart(2, `0`)}`
      : void 0;
  return {
    type: `credit-card`,
    ...(Z(e.number, !0) ? { number: Z(e.number, !0) } : {}),
    ...(Z(e.cardholderName) ? { fullName: Z(e.cardholderName) } : {}),
    ...(Z(e.brand) ? { cardType: Z(e.brand) } : {}),
    ...(Z(e.cvv, !0) ? { verificationNumber: Z(e.cvv, !0) } : {}),
    ...(t ? { expiryDate: { fieldType: `year-month`, value: t } } : {}),
  };
}
function Lr(e, t) {
  if (e.type === `login`) return Pr(e, t);
  let n = [...(e.customFields ?? [])];
  return e.type === `card`
    ? [Ir(e), ...Fr(n)]
    : e.type === `ssh-key`
      ? (t.push(`"${e.name}" is an SSH key, which travels as custom fields.`),
        Fr([
          { key: `Key Type`, value: e.keyType ?? `` },
          { key: `Public Key`, value: e.publicKey },
          { key: `Private Key`, value: e.privateKey, hidden: !0 },
          { key: `Passphrase`, value: e.passphrase ?? ``, hidden: !0 },
          ...n,
        ]))
      : Fr(n);
}
function Rr(e, t) {
  let n = Lr(e, t);
  (e.notes &&
    n.push({ type: `note`, content: { fieldType: `string`, value: e.notes } }),
    n.length === 0 &&
      n.push({ type: `note`, content: { fieldType: `string`, value: `` } }));
  let r = e.type === `login` ? kr(e.urls) : [];
  return {
    id: Dr(e.id),
    title: e.name,
    ...(Or(e.createdAt) === void 0 ? {} : { creationAt: Or(e.createdAt) }),
    ...(Or(e.updatedAt) === void 0 ? {} : { modifiedAt: Or(e.updatedAt) }),
    ...(r.length ? { scope: { urls: r, androidApps: [] } } : {}),
    ...(e.tags?.length ? { tags: e.tags } : {}),
    credentials: n,
  };
}
function zr(e, t) {
  let n = [],
    r = Sr(e).map((e) => Rr(e, n));
  if (t.passkeyExtensions === !1) {
    let e = jr(r);
    e > 0 &&
      n.push(
        `${e === 1 ? `1 passkey` : `${e} passkeys`} went without ${e === 1 ? `its` : `their`} PRF secrets or other extension data, which this iOS version can't transfer. Update to iOS 26.4 or later and transfer again to bring it.`,
      );
  }
  return {
    payload: {
      version: { ...ur },
      exporterRpId: t.exporterRpId,
      exporterDisplayName: t.exporterDisplayName,
      timestamp: Math.floor(t.now / 1e3),
      accounts: [
        {
          id: Dr(t.exporterRpId),
          username: ``,
          email: ``,
          collections: [],
          items: r,
        },
      ],
    },
    warnings: n,
  };
}
async function Br(e, t) {
  let n = await e.claimImportToken();
  if (!n) return null;
  let r = await xr(await e.redeemImportToken(n), t);
  return (
    (await e.availability()).passkeyExtensions === !1 &&
      r.imported.some((e) => e.type === `login` && e.passkeys?.length) &&
      r.warnings.push(
        `This iOS version doesn't pass passkey PRF secrets between apps (iOS 26.4 and later do). If a site uses one of these passkeys to encrypt data, update iOS and transfer again.`,
      ),
    r
  );
}
async function Vr(e, t, n, r = Date.now()) {
  let i = [],
    { passkeyExtensions: a } = await e.availability();
  return (
    await e.exportToApp(() => {
      let o = zr(t, {
        exporterRpId: e.exporterId,
        exporterDisplayName: n,
        now: r,
        passkeyExtensions: a,
      });
      return ((i = o.warnings), JSON.stringify(o.payload));
    }),
    i
  );
}
var Hr = class {
  out = [];
  seen = new Set();
  add(e, t, n = !1) {
    e && t && this.out.push({ key: this.unique(e), value: t, protected: n });
  }
  unique(e) {
    if (!this.seen.has(e)) return (this.seen.add(e), e);
    let t = 2;
    for (; this.seen.has(`${e} (${t})`);) t++;
    let n = `${e} (${t})`;
    return (this.seen.add(n), n);
  }
  done() {
    return this.out;
  }
};
function Ur(e, t) {
  let n = o(t);
  if (n?.steam) {
    let t = encodeURIComponent(`Steam:${n.account}`);
    e.add(
      `otp`,
      `otpauth://totp/${t}?secret=${n.totp.secret.base32}&issuer=Steam&encoder=steam`,
      !0,
    );
  } else
    /^otpauth:\/\//i.test(t.trim())
      ? e.add(`otp`, t, !0)
      : e.add(`TOTP Seed`, t, !0);
}
function Wr(e) {
  let t = new Hr();
  if (
    (t.add(`Title`, e.name),
    t.add(`Notes`, e.notes),
    e.tags?.length && t.add(`Tags`, e.tags.join(`,`)),
    e.archivedAt !== void 0 &&
      t.add(`Archived`, new Date(e.archivedAt).toISOString()),
    e.type === `login`)
  ) {
    (t.add(`UserName`, e.username), t.add(`Password`, e.password, !0));
    let [n, ...r] = e.urls;
    t.add(`URL`, n);
    for (let [e, n] of r.entries()) t.add(`URL ${e + 2}`, n);
    e.totp && Ur(t, e.totp);
  } else
    e.type === `card`
      ? (t.add(`Cardholder Name`, e.cardholderName),
        t.add(`Number`, e.number, !0),
        t.add(`Brand`, e.brand),
        t.add(`Expiry Month`, e.expMonth),
        t.add(`Expiry Year`, e.expYear),
        t.add(`CVV`, e.cvv, !0))
      : e.type === `ssh-key` &&
        (t.add(`Key Type`, e.keyType),
        t.add(`Public Key`, e.publicKey),
        t.add(`Private Key`, e.privateKey, !0),
        t.add(`Passphrase`, e.passphrase, !0));
  for (let n of e.customFields ?? []) t.add(n.key, n.value, n.hidden === !0);
  return t.done();
}
function Gr(e) {
  return e.map((e) => ({ strings: Wr(e) }));
}
async function Kr(e, t, n, r) {
  let i = Gr(e),
    a = new Map(e.map((e, t) => [e.id, t])),
    o,
    s = new Map(),
    c = [];
  for (let e of t) {
    let t = e.entryId === void 0 ? void 0 : a.get(e.entryId);
    t === void 0 &&
      ((o ??=
        i.push({ strings: [{ key: `Title`, value: n, protected: !1 }] }) - 1),
      (t = o));
    let l = s.get(t) ?? new Set();
    (s.set(t, l),
      c.push({ entry: t, record: e, name: qr((await r(e)).name, l) }));
  }
  return { entries: i, files: c };
}
function qr(e, t) {
  let n = e,
    r = e.lastIndexOf(`.`),
    [i, a] = r > 0 ? [e.slice(0, r), e.slice(r)] : [e, ``];
  for (let e = 2; t.has(n); e++) n = `${i} (${e})${a}`;
  return (t.add(n), n);
}
var Jr = class extends Error {};
function Yr(e, t) {
  return !e || t;
}
var Xr = 1e4;
async function Zr(t, n, r, i) {
  let a = n.holdsKeyNatively
      ? null
      : await e(t.exportVek(), Xr, `Reading this vault's key`),
    o = n.enable(a, r, i);
  await (n.enableIsSilent ? e(o, Xr, `Saving the key to this device`) : o);
}
async function Qr(e, t, n, r) {
  let i = await t.unlock(n, r);
  if (!t.holdsKeyNatively) {
    if (i === null) throw Error(`The biometric gate returned no key`);
    await e.unlockWithVek(i);
  }
}
var $r = class extends Error {};
async function ei(e) {
  e.biometric.enableIsSilent &&
    (await e.biometric.isEnabled(e.vaultId)) &&
    (await Zr(e.crypto, e.biometric, e.vaultId, e.allowPasscode));
}
async function ti(e) {
  try {
    await Qr(e.crypto, e.biometric, e.vaultId, e.allowPasscode);
  } catch (t) {
    throw (
      ct(t) &&
        (await e.biometric.disable(e.vaultId).catch(() => {}),
        e.onStaleCache()),
      t
    );
  }
  try {
    await e.loadEntries();
  } catch (t) {
    throw (
      await e.crypto.lock().catch(() => {}),
      await e.biometric.disable(e.vaultId).catch(() => {}),
      e.onStaleCache(),
      console.error(
        `[vault] biometric VEK failed to open the vault; cache cleared:`,
        t,
      ),
      new $r(
        `Biometric unlock is out of date. Unlock with your password to re-enable it.`,
      )
    );
  }
}
var ni = new Set([
  `id`,
  `createdAt`,
  `updatedAt`,
  `lastUsedAt`,
  `archivedAt`,
  `tags`,
  `breach`,
  `passwordChangelog`,
  ...Le,
]);
function ri(e) {
  if (Array.isArray(e)) return e.map(ri);
  if (typeof e != `object` || !e) return e;
  let t = {};
  for (let n of Object.keys(e).sort()) {
    if (ni.has(n)) continue;
    let r = e[n];
    r !== void 0 && (t[n] = ri(r));
  }
  return t;
}
function ii(e) {
  return JSON.stringify(ri(e));
}
function ai(e) {
  let t = e.trim();
  if (!t) return ``;
  try {
    let e = new URL(We(t));
    return e.protocol === `http:` || e.protocol === `https:`
      ? e.hostname.toLowerCase().replace(/^www\./, ``)
      : t.toLowerCase();
  } catch {
    return ``;
  }
}
var oi = (e) => (e ?? ``).trim().toLowerCase();
function si(e) {
  return e.type === `login`
    ? {
        hosts: new Set((e.urls ?? []).map(ai).filter((e) => e !== ``)),
        name: oi(e.name),
        password: e.password ?? ``,
      }
    : null;
}
function ci(e, t) {
  if (e.hosts.size === 0 || t.hosts.size === 0)
    return e.hosts.size === 0 && t.hosts.size === 0 && e.name === t.name;
  for (let n of e.hosts) if (t.hosts.has(n)) return !0;
  return !1;
}
var li = (e) => (e.type === `card` ? (e.number ?? ``).replace(/\D/g, ``) : ``);
function ui(e, t) {
  let n = new Map(),
    r = new Map(),
    i = new Map();
  for (let t of e) {
    let e = ii(t);
    n.has(e) || n.set(e, t.id ?? t);
    let a = si(t);
    if (a && t.type === `login`) {
      let e = oi(t.username);
      r.set(e, [...(r.get(e) ?? []), { cred: a, id: t.id }]);
    }
    let o = li(t);
    o.length >= 12 && !i.has(o) && i.set(o, t.id);
  }
  let a = {
      fresh: [],
      duplicates: 0,
      likelyDuplicates: [],
      passwordDiffers: 0,
      sameAs: new Map(),
      resembles: new Map(),
    },
    o = (e, t) => {
      (a.likelyDuplicates.push(e), t !== void 0 && a.resembles.set(e, t));
    };
  for (let e of t) {
    let t = ii(e),
      s = n.get(t);
    if (s !== void 0) {
      (a.duplicates++, a.sameAs.set(e, s));
      continue;
    }
    n.set(t, e);
    let c = si(e);
    if (c && e.type === `login` && c.password !== ``) {
      let t = (r.get(oi(e.username)) ?? []).filter((e) => ci(e.cred, c)),
        n = t.find((e) => e.cred.password === c.password);
      if (n) {
        o(e, n.id);
        continue;
      }
      oi(e.username) !== `` && t.length > 0 && a.passwordDiffers++;
    }
    let l = li(e);
    l.length >= 12 && i.has(l) ? o(e, i.get(l)) : a.fresh.push(e);
  }
  return a;
}
async function di(e, t, n) {
  let r = new Map(),
    i = e.map(({ id: e, ...t }) => {
      let n = t;
      return (r.set(e, n), n);
    }),
    a = [],
    o = 0;
  for (let e of t) {
    let t = e.entryId === void 0 ? void 0 : r.get(e.entryId);
    if (!t || !n?.stage) o++;
    else
      try {
        a.push({ entry: t, ...(await n.stage(e)) });
      } catch {
        o++;
      }
  }
  return { items: i, files: a, uncarried: o };
}
function fi(e, t) {
  let n = e,
    r = Hn([...(e.tags ?? []), ...(t.tags ?? [])]),
    i = new Set((e.tags ?? []).map(X));
  if (
    ((t.tags ?? []).some((e) => !i.has(X(e))) &&
      !Gn(e.tags, r) &&
      (n = { ...n, tags: r }),
    e.archivedAt !== void 0 && t.archivedAt === void 0)
  ) {
    let { archivedAt: e, ...t } = n;
    n = t;
  }
  if (n.type === `login` && t.type === `login`) {
    let { password: e, passwordChangelog: r = [] } = n,
      i = (t.passwordChangelog ?? []).some(
        (t) => t.value !== e && !r.some((e) => e.value === t.value),
      )
        ? Me(n, [t], 0)
        : void 0;
    i &&
      JSON.stringify(i) !== JSON.stringify(r) &&
      (n = { ...n, passwordChangelog: i });
  }
  return n;
}
var pi = (e, t) => {
  let n = new Set((e.tags ?? []).map(X));
  return (Hn(t.tags) ?? []).every((e) => n.has(X(e)));
};
function mi(e, t) {
  let n = ui(e, t.items),
    r = new Set(n.likelyDuplicates),
    i = new Map(e.map((e) => [e.id, e])),
    a = new Map(),
    o = [],
    s = 0;
  for (let [e, t] of n.sameAs) {
    let n = typeof t == `string` ? i.get(t) : (a.get(t) ?? t),
      r = fi(n, e);
    (pi(r, e) || s++,
      typeof t == `string`
        ? r !== n && (i.set(t, r), o.push({ id: t, copy: e }))
        : a.set(t, r));
  }
  let c = (e) => a.get(e) ?? e,
    l = [],
    u = [];
  for (let e of t.files) {
    let t = (t) => ({
        onto: t,
        name: e.name,
        mime: e.mime,
        source: e.source,
        size: e.size,
      }),
      i = n.sameAs.get(e.entry);
    if (typeof i == `string`) {
      l.push(t({ entryId: i }));
      continue;
    }
    let a = i ?? e.entry;
    (r.has(a) ? u : l).push(t({ item: c(a) }));
  }
  return {
    items: n.fresh.map(c),
    attachments: l,
    heldBack: { items: n.likelyDuplicates.map(c), attachments: u },
    matched: o,
    tagsLeftOver: s,
  };
}
async function hi(e, t) {
  let n = [],
    r = 0;
  for (let i of e ?? []) {
    let {
        creds: e,
        lastBackupAt: a,
        lastVaultHash: o,
        lastError: s,
        waiting: c,
        failures: u,
        failedAt: d,
        ...f
      } = i,
      { sharedFolder: p, ...m } = f;
    if (l(e)) r++;
    else
      try {
        n.push({
          target: m,
          secrets: await t.decryptWithVek(e.iv, e.ciphertext),
        });
      } catch {
        r++;
      }
  }
  return { targets: n, unreadable: r };
}
function gi(e, t) {
  return Promise.all(
    e.map(async ({ target: e, secrets: n }) => {
      let { iv: r, ciphertext: i } = await t.encryptWithVek(n);
      return { ...e, creds: { iv: r, ciphertext: i } };
    }),
  );
}
function _i(e, t) {
  return e.length === t.length && e.every((e, n) => e === t[n]);
}
function vi({
  crypto: e,
  storage: t,
  readDecodedBlob: n,
  verifyVekBeforeWrite: r = !1,
}) {
  return {
    async readEntriesPayload() {
      let { blob: t } = await n();
      if (t.entriesCiphertext.length === 0) return ue();
      let r = await e.decryptWithVek(k(t.entriesIv), k(t.entriesCiphertext));
      return Ce(r);
    },
    async writeEntriesBlob(i, a) {
      let { blob: o } = await n();
      if (r && o.entriesCiphertext.length > 0)
        try {
          await e.decryptWithVek(k(o.entriesIv), k(o.entriesCiphertext));
        } catch {
          throw Error(
            `Refusing to write: the loaded key doesn't match this vault's existing entries.`,
          );
        }
      let { iv: s, ciphertext: c } = await e.encryptWithVek(le(i)),
        l = O(c);
      (await t.writeVaultBlob(
        Ue({ slots: o.slots, entriesIv: O(s), entriesCiphertext: l }),
      ),
        a?.(l));
    },
  };
}
function yi(e) {
  return JSON.stringify({ name: e.name, mime: e.mime });
}
function bi(e) {
  let t = JSON.parse(e);
  if (typeof t.name != `string` || typeof t.mime != `string`)
    throw Error(`file metadata is malformed`);
  return { name: t.name, mime: t.mime };
}
var xi = 16;
function Si(e) {
  return e - xi * Math.max(1, Math.ceil(e / 262160));
}
var Ci = 255,
  wi = class extends Error {
    limit;
    constructor(e) {
      (super(`attachment is over the ${e}-byte limit`), (this.limit = e));
    }
  },
  Ti = class extends Error {
    constructor() {
      super(`that entry is no longer in the vault`);
    }
  };
function Ei(e) {
  if (e.kind === `blob`) return e.blob.size;
  if (e.kind === `bytes`) return e.bytes.length;
  if (e.kind === `path`) return e.size;
}
function Di(e) {
  let t = e.trim();
  if (t.length === 0) throw Error(`file name must not be empty`);
  if (t.length > Ci) throw Error(`file name must be at most ${Ci}`);
  if (/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(t))
    throw Error(`file name has a control or bidi-override character`);
  return t;
}
function Oi(e) {
  return {
    files: e.manifest?.files ?? [],
    fileTombstones: e.manifest?.fileTombstones ?? [],
    fileCascades: e.manifest?.fileCascades ?? [],
  };
}
function ki({ files: e, fileTombstones: t, fileCascades: n }) {
  if (e.length !== 0 || t.length !== 0 || n.length !== 0)
    return {
      ...(e.length > 0 ? { files: e } : {}),
      ...(t.length > 0 ? { fileTombstones: t } : {}),
      ...(n.length > 0 ? { fileCascades: n } : {}),
    };
}
function Ai(e, t, n) {
  let r = Oi(e),
    i = r.files.filter((e) => e.entryId !== void 0 && t.has(e.entryId));
  if (i.length === 0) return e.manifest;
  let a = new Set(i.map((e) => e.id));
  return ki({
    ...r,
    fileCascades: [
      ...r.fileCascades.filter((e) => !a.has(e.id)),
      ...i.map((e) => ({ id: e.id, hlc: n() })),
    ],
  });
}
async function ji(e, t) {
  let n = Di(t.name),
    r = Ei(t.source);
  if (r !== void 0 && r > 94371840) throw new wi(y);
  return e.seal(t.source, { name: n, mime: t.mime });
}
function Mi(e, t, n) {
  let r = Oi(e),
    i = t.map(({ sealed: e, entryId: t }) => ({
      id: globalThis.crypto.randomUUID(),
      hlc: n(),
      ...(t ? { entryId: t } : {}),
      ...e,
    }));
  return ki({ ...r, files: [...r.files, ...i] });
}
function Ni({ sealer: e, persist: t, clock: n }) {
  return {
    async attach(r, i) {
      if (i.entryId !== void 0 && !r.entries.some((e) => e.id === i.entryId))
        throw new Ti();
      let a = await ji(e, i),
        o = await n(),
        s = Mi(r, [{ sealed: a, entryId: i.entryId }], () => o.send());
      return t({ ...r, manifest: s });
    },
    async detach(e, r) {
      let i = Oi(e);
      if (!i.files.some((e) => e.id === r)) return e;
      let a = await n();
      return t({
        ...e,
        manifest: ki({
          ...i,
          files: i.files.filter((e) => e.id !== r),
          fileTombstones: [...i.fileTombstones, { id: r, hlc: a.send() }],
        }),
      });
    },
    async rename(r, i, a) {
      let o = Di(a),
        s = Oi(r),
        c = s.files.find((e) => e.id === i);
      if (!c) return r;
      let l = await e.describe(c);
      if (l.name === o) return r;
      let u = await e.resealMeta(c, { name: o, mime: l.mime }),
        d = await n();
      return t({
        ...r,
        manifest: ki({
          ...s,
          files: s.files.map((e) =>
            e.id === i ? { ...e, ...u, hlc: d.send() } : e,
          ),
        }),
      });
    },
  };
}
var Pi = 6e4;
function Fi() {
  return {
    entries: [],
    stamps: new Map(),
    causal: new Map(),
    tombstones: new Map(),
    tombstoneCausal: new Map(),
    conflicts: [],
  };
}
var Ii = (e) =>
  e.vv ? (e.floor ? { vv: e.vv, floor: e.floor } : { vv: e.vv }) : void 0;
function Li(e, t) {
  let n = new Set(t.map((e) => e.id)),
    r = e.entries.filter((e) => n.has(e.id)),
    i = new Map();
  for (let e of r) {
    let t = Ii(e);
    t && i.set(e.id, t);
  }
  let a = new Map();
  for (let t of e.tombstones) {
    let e = Ii(t);
    e && a.set(t.id, e);
  }
  let o = {
    entries: t,
    stamps: new Map(r.map((e) => [e.id, e.hlc])),
    causal: i,
    tombstones: new Map(e.tombstones.map((e) => [e.id, e.hlc])),
    tombstoneCausal: a,
    conflicts: e.conflicts ?? [],
  };
  return (
    e.settings && (o.settings = e.settings),
    (e.files || e.fileTombstones || e.fileCascades) &&
      (o.manifest = {
        files: e.files,
        fileTombstones: e.fileTombstones,
        fileCascades: e.fileCascades,
      }),
    o
  );
}
var Ri = (e, t) => {
    let n = e.stamps.get(t);
    return n ? { hlc: n, ...e.causal.get(t) } : void 0;
  },
  zi = (e, t) => {
    let n = e.tombstones.get(t);
    return n ? { hlc: n, ...e.tombstoneCausal.get(t) } : void 0;
  };
function Bi(e, t) {
  let n = Ri(e, t),
    r = zi(e, t);
  return [
    ...(n ? [n] : []),
    ...e.conflicts.filter((e) => e.id === t),
    ...(r ? [r] : []),
  ];
}
function Vi(e, t) {
  let n = e.entries.find((e) => e.id === t),
    r = Ri(e, t);
  return n && r ? { data: n, version: r } : void 0;
}
function Hi(e, t, n) {
  let r = Ri(e, t);
  return rt({ hlc: n, bases: r ? [r] : [], held: Bi(e, t) });
}
function Ui(e) {
  let t = (e, t) => [...e].map(([e, n]) => ({ id: e, hlc: n, ...t.get(e) }));
  return je({
    entries: t(e.stamps, e.causal),
    conflicts: e.conflicts,
    tombstones: t(e.tombstones, e.tombstoneCausal),
  });
}
var Wi = (e, t) =>
  e !== null && e.length === t.length && e.every((e, n) => e === t[n]);
function Gi(e) {
  let {
      crypto: t,
      storage: n,
      autofill: r,
      readDecodedBlob: i,
      clock: a,
      onDiskMerged: o,
    } = e,
    { readEntriesPayload: s, writeEntriesBlob: c } = vi({
      crypto: t,
      storage: n,
      readDecodedBlob: i,
    }),
    l = async (e) => {
      let n = {
        entries: await Promise.all(
          e.entries.map(async (n) => {
            let { id: r, ...i } = n,
              a = await t.encryptEntry(JSON.stringify(i)),
              o = e.stamps.get(r);
            if (!o) throw Error(`missing sync stamp for entry ${r}`);
            return {
              id: r,
              wrappedDek: a.wrappedDek,
              dekIv: a.dekIv,
              ciphertext: a.ciphertext,
              iv: a.iv,
              hlc: o,
              ...e.causal.get(r),
              ...(i.type === `unlock-key` ? { localOnly: !0 } : {}),
            };
          }),
        ),
        tombstones: [...e.tombstones].map(([t, n]) => ({
          id: t,
          hlc: n,
          ...e.tombstoneCausal.get(t),
        })),
      };
      return (
        e.settings && (n.settings = e.settings),
        e.conflicts.length > 0 && (n.conflicts = e.conflicts),
        e.manifest?.files?.length && (n.files = e.manifest.files),
        e.manifest?.fileTombstones?.length &&
          (n.fileTombstones = e.manifest.fileTombstones),
        e.manifest?.fileCascades?.length &&
          (n.fileCascades = e.manifest.fileCascades),
        n
      );
    },
    u = (e) =>
      t.decryptEntries(
        e.conflicts.map(
          ({ ciphertext: e, iv: t, wrappedDek: n, dekIv: r }) => ({
            ciphertext: e,
            iv: t,
            wrappedDek: n,
            dekIv: r,
          }),
        ),
      ),
    d = async (e, n) => {
      let r = await l(e);
      r.conflicts &&= await Promise.all(
        r.conflicts.map(async (e, r) => {
          let i = n[r];
          if (i == null) return e;
          let a = await t.encryptEntry(i);
          return { ...e, ...a };
        }),
      );
      let { iv: i, ciphertext: a } = await t.encryptWithVek(le(r));
      return {
        entriesIv: O(i),
        entriesCiphertext: O(a),
        conflicts: r.conflicts ?? [],
      };
    },
    f = async (e) => {
      let n = await r.beginIndexUpdate?.(),
        a = await l(e),
        u = e.diskSeen,
        d = !1;
      return (
        u !== void 0 && !Wi(u, (await i()).blob.entriesCiphertext)
          ? (await c(ce(a, await s())), (u = null), (d = !0))
          : await c(a, (e) => {
              u !== void 0 && (u = e);
            }),
        t.notifyExternalChange?.(),
        await r.setIndex(Se(e.entries), n),
        d && o?.(),
        u === void 0 ? e : { ...e, diskSeen: u }
      );
    },
    p = (e) => {
      let t = Ve.safeParse(e);
      if (!t.success) {
        let e = t.error.issues
          .map((e) => e.path.join(`.`) || `<root>`)
          .join(`, `);
        throw Error(`entry failed validation (${e})`);
      }
      return e;
    },
    m = async (e, t) => {
      let n = new Set(t);
      if (n.size === 0) return e;
      let r = await a(),
        i = new Map(e.stamps),
        o = new Map(e.causal),
        s = new Map(e.tombstones),
        c = new Map(e.tombstoneCausal);
      for (let t of n) {
        let n = r.send(),
          a = Bi(e, t);
        (i.delete(t),
          o.delete(t),
          s.set(t, n),
          c.set(t, D({ hlc: n, bases: a, held: a })));
      }
      return f({
        ...e,
        entries: e.entries.filter((e) => !n.has(e.id)),
        stamps: i,
        causal: o,
        tombstones: s,
        tombstoneCausal: c,
        conflicts: e.conflicts.filter((e) => !n.has(e.id)),
        manifest: Ai(e, n, () => r.send()),
      });
    };
  return {
    readEntriesPayload: s,
    persist: f,
    writeEntriesBlob: c,
    add: async (e, t) => {
      let n = p(t),
        r = (await a()).send(),
        i = M(
          et(
            {
              id: globalThis.crypto.randomUUID(),
              ...n,
              createdAt: n.createdAt ?? r.wall,
              updatedAt: r.wall,
            },
            void 0,
            r.wall,
          ),
          void 0,
          r,
        ),
        o = new Map(e.stamps);
      o.set(i.id, r);
      let s = new Map(e.causal);
      return (
        s.set(i.id, D({ hlc: r, bases: [], held: [] })),
        f({ ...e, entries: [...e.entries, i], stamps: o, causal: s })
      );
    },
    importMany: async (e, t, n = [], r = {}) => {
      let i = t.map(p),
        o = await a(),
        s = new Map(e.stamps),
        c = new Map(e.causal),
        l = i.map((e) => {
          let t = o.send(),
            n = globalThis.crypto.randomUUID();
          (s.set(n, t), c.set(n, D({ hlc: t, bases: [], held: [] })));
          let i = et(
            {
              id: n,
              ...e,
              createdAt: e.createdAt ?? t.wall,
              updatedAt: e.updatedAt ?? t.wall,
            },
            void 0,
            t.wall,
          );
          return M(r.ownVault ? Ge(i, e) : i, void 0, t);
        }),
        u = new Map();
      for (let { id: e, copy: t } of r.matched ?? [])
        u.set(e, [...(u.get(e) ?? []), t]);
      let d = e.entries.map((t) => {
          let n = (u.get(t.id) ?? []).reduce(fi, t);
          if (n === t) return t;
          let r = Hi(e, t.id, o.send());
          return (
            s.set(t.id, r.hlc),
            c.set(t.id, r.causal),
            M(n, Vi(e, t.id), r.hlc)
          );
        }),
        m = new Set(e.entries.map((e) => e.id)),
        h = n.map(({ sealed: e, ...t }) => {
          let n = `item` in t ? l[t.item]?.id : t.entryId;
          if (n === void 0 || (`entryId` in t && !m.has(n)))
            throw Error(`an attachment's entry is not in the vault`);
          return { sealed: e, entryId: n };
        });
      return f({
        ...e,
        entries: [...d, ...l],
        stamps: s,
        causal: c,
        manifest: h.length > 0 ? Mi(e, h, () => o.send()) : e.manifest,
      });
    },
    update: async (e, n, r, i) => {
      if (i && i.data.id !== n)
        throw Error(`the version this edit opened belongs to another entry`);
      let o = p(r),
        s = (await a()).send(),
        c = e.entries.find((e) => e.id === n),
        l = Ri(e, n),
        u = i && l && pe(i.hlc, l.hlc) !== 0 ? i : void 0,
        d = u ? u.data : c,
        m = u ? rt({ hlc: s, bases: [u], held: Bi(e, n) }) : Hi(e, n, s),
        h = e.conflicts;
      if (u && c && l) {
        let { id: e, ...r } = c,
          i = await t.encryptEntry(JSON.stringify(r)),
          a = { hlc: m.hlc, ...m.causal };
        h = [
          ...h.filter((e) => e.id !== n || !ge(e, a)),
          { id: n, ...i, ...l },
        ];
      }
      let g = e.entries.map((t) =>
          t.id === n
            ? M(
                et(
                  {
                    id: n,
                    ...o,
                    createdAt: d?.createdAt ?? o.createdAt ?? s.wall,
                    updatedAt: s.wall,
                    lastUsedAt: o.lastUsedAt ?? d?.lastUsedAt,
                  },
                  d,
                  s.wall,
                ),
                u ? { data: u.data, version: u } : Vi(e, n),
                m.hlc,
              )
            : t,
        ),
        _ = new Map(e.stamps);
      _.set(n, m.hlc);
      let v = new Map(e.causal);
      return (
        v.set(n, m.causal),
        f({ ...e, entries: g, stamps: _, causal: v, conflicts: h })
      );
    },
    resolve: async (e, t, n) => {
      let r = e.entries.find((e) => e.id === t);
      if (!r) return e;
      let i = await a(),
        o = i.send(),
        s = Bi(e, t),
        c = new Map(e.stamps),
        l = new Map(e.causal);
      (c.set(t, o), l.set(t, D({ hlc: o, bases: s, held: s })));
      let u = [
          ...n.superseded,
          ...(n.kind === `keepBoth` ? [n.data] : []),
          ...(e.tombstones.has(t) ? [{ type: r.type }] : []),
        ],
        d = e.entries.map((r) =>
          r.id === t ? M(Pe(r, n.superseded, o.wall), Vi(e, t), o, u) : r,
        );
      if (n.kind === `use`) {
        let e = p(n.data),
          i = et(
            {
              id: t,
              ...e,
              createdAt: r.createdAt ?? e.createdAt ?? o.wall,
              updatedAt: o.wall,
              lastUsedAt: e.lastUsedAt ?? r.lastUsedAt,
            },
            r,
            o.wall,
          ),
          a = n.version ? { data: n.data, version: n.version } : void 0;
        d = d.map((e) =>
          e.id === t ? M(Pe(i, n.superseded, o.wall), a, o, u) : e,
        );
      }
      if (n.kind === `keepBoth`) {
        let e = p(n.data),
          t = i.send(),
          r = globalThis.crypto.randomUUID(),
          a = M(
            et(
              {
                id: r,
                ...e,
                createdAt: e.createdAt ?? t.wall,
                updatedAt: t.wall,
              },
              { id: r, ...e },
              t.wall,
            ),
            void 0,
            t,
          );
        (c.set(r, t),
          l.set(r, D({ hlc: t, bases: [], held: [] })),
          (d = [...d, a]));
      }
      return f({
        ...e,
        entries: d,
        stamps: c,
        causal: l,
        conflicts: e.conflicts.filter((e) => e.id !== t),
      });
    },
    setSetting: async (e, t, n) => {
      let r = await a(),
        i = { ...e.settings, [t]: { hlc: r.send(), value: n } };
      return f({ ...e, settings: i });
    },
    touch: async (e, t) => {
      let n = e.entries.find((e) => e.id === t);
      if (!n) return e;
      let r = (await a()).send().wall;
      if (n.lastUsedAt !== void 0 && r - n.lastUsedAt < Pi) return e;
      let i = e.entries.map((e) => (e.id === t ? { ...e, lastUsedAt: r } : e));
      return f({ ...e, entries: i });
    },
    setBreach: async (e, t, n) => {
      if (!e.entries.some((e) => e.id === t && e.type === `login`)) return e;
      let r = e.entries.map((e) =>
        e.id === t && e.type === `login` ? { ...e, breach: n } : e,
      );
      return f({ ...e, entries: r });
    },
    remove: (e, t) => m(e, [t]),
    removeMany: m,
    setArchived: async (e, t, n) => {
      let r = new Set(t),
        i = new Set(
          e.entries
            .filter((e) => r.has(e.id) && (e.archivedAt !== void 0) !== n)
            .map((e) => e.id),
        );
      if (i.size === 0) return e;
      let o = await a(),
        s = new Map(e.stamps),
        c = new Map(e.causal),
        l = e.entries.map((t) => {
          if (!i.has(t.id)) return t;
          let r = o.send(),
            a = Hi(e, t.id, r);
          (s.set(t.id, a.hlc), c.set(t.id, a.causal));
          let { archivedAt: l, ...u } = t,
            d = n ? { ...t, archivedAt: r.wall } : u;
          return M(d, Vi(e, t.id), a.hlc);
        });
      return f({ ...e, entries: l, stamps: s, causal: c });
    },
    setTags: async (e, t, n) => {
      let r = Hn(n.add) ?? [],
        i = new Set((n.remove ?? []).map(X).filter(Boolean));
      if (r.length === 0 && i.size === 0) return e;
      let o = new Set(t),
        s = new Map();
      for (let t of e.entries) {
        if (!o.has(t.id)) continue;
        let e = Hn([...(t.tags ?? []).filter((e) => !i.has(X(e))), ...r]);
        Gn(t.tags, e) || s.set(t.id, e);
      }
      if (s.size === 0) return e;
      let c = await a(),
        l = new Map(e.stamps),
        u = new Map(e.causal),
        d = e.entries.map((t) => {
          if (!s.has(t.id)) return t;
          let n = Hi(e, t.id, c.send());
          (l.set(t.id, n.hlc), u.set(t.id, n.causal));
          let r = s.get(t.id),
            { tags: i, ...a } = t,
            o = r === void 0 ? a : { ...t, tags: r };
          return M(o, Vi(e, t.id), n.hlc);
        });
      return f({ ...e, entries: d, stamps: l, causal: u });
    },
    sealAll: d,
    openConflicts: u,
  };
}
async function Ki(e, t) {
  let n = e.now ?? Date.now(),
    r = Ji(await e.storage.readQuarantine(e.vaultId), n),
    i = new Set(r.filter(qi).map(Je)),
    a = t.filter((e) => !i.has(Je(e))).map((e) => ({ ...e, quarantinedAt: n }));
  a.length > 0 &&
    (await e.storage.writeQuarantine(JSON.stringify([...r, ...a]), e.vaultId));
  let o = new Set(t.map(Je)),
    s = await e.store.readEntriesPayload();
  await e.store.writeEntriesBlob({
    ...s,
    entries: s.entries.filter((e) => !o.has(Je(e))),
  });
}
var qi = (e) => typeof e == `object` && !!e && `id` in e && `hlc` in e;
function Ji(e, t) {
  if (e === null) return [];
  try {
    let t = JSON.parse(e);
    if (Array.isArray(t)) return t;
  } catch {}
  return [{ unreadableStore: e, quarantinedAt: t }];
}
var Yi = (e, t) => e.decryptWithVek(k(t.entriesIv), k(t.entriesCiphertext));
async function Xi({ crypto: e, storage: t, onRestored: n }, r) {
  try {
    return await Yi(e, r);
  } catch (r) {
    if (!t.readVaultBackup) throw r;
    let i = null;
    try {
      let n = await t.readVaultBackup();
      if (n) {
        let t = oe(n);
        t.entriesCiphertext.length > 0 && (i = await Yi(e, t));
      }
    } catch {
      i = null;
    }
    if (i === null) throw r;
    return (n?.(), await t.restoreVaultFromBackup(), i);
  }
}
var Zi = `0123456789ABCDEFGHJKMNPQRSTVWXYZ`;
function Qi() {
  let e = new Uint8Array(30);
  globalThis.crypto.getRandomValues(e);
  let t = ``;
  for (let n = 0; n < e.length; n++) t += Zi[e[n] & 31];
  return t.match(/.{1,5}/g).join(`-`);
}
function $i(e) {
  return e
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, ``)
    .replace(/O/g, `0`)
    .replace(/[IL]/g, `1`);
}
function ea(e, t) {
  if (e.length !== t.length) return !1;
  for (let n = 0; n < e.length; n++) if (e[n] !== t[n]) return !1;
  return !0;
}
function ta(e) {
  return e.kind === 1 || e.kind === 2;
}
var na = [66, 82, 77, 85];
function ra(e) {
  return na.every((t, n) => e[n] === t);
}
function ia(e) {
  return e.kind === 2 ? !ra(e.credentialId) : ta(e);
}
var aa = `Bramble Desktop holds your only other key. Add a security key or passkey first.`;
function oa(e) {
  if (e.slots.length > 16)
    throw Error(`This vault already has the maximum number of slots (16).`);
  return e;
}
function sa(e, t) {
  return e.find((e) => ea(e.credentialId, t)) ?? null;
}
function ca(e, t, n) {
  return e.map((e) => {
    let r = n(e.slotId),
      i = t[r];
    return {
      slotIdB64: r,
      label: i?.label ?? `Security key`,
      addedAt: i?.addedAt ?? 0,
      kind: i?.kind ?? `securityKey`,
      synced: i?.synced ?? !1,
      ...(e.credentialId && ra(e.credentialId) ? { heldByBramble: !0 } : {}),
    };
  });
}
function la(e, t) {
  return oa({ ...e, slots: [...e.slots, t] });
}
function ua(e, t) {
  let n = e.slots.filter((e) => !(e.kind === 2 && ea(e.slotId, t)));
  if (n.length === e.slots.length)
    throw Error(`Security key not found on this vault.`);
  if (!n.some(ta))
    throw Error(
      `Can't remove the last unlock method. Register another security key or set a master password first.`,
    );
  if (!n.some(ia)) throw Error(aa);
  return { ...e, slots: n };
}
function da(e, t) {
  let n = e.slots.filter((e) => e.kind !== 1);
  return oa({ ...e, slots: [...n, t] });
}
function fa(e) {
  if (!e.slots.some((e) => e.kind === 1))
    throw Error(`This vault has no master password to disable.`);
  let t = e.slots.filter((e) => e.kind !== 1);
  if (!t.some(ta))
    throw Error(
      `Can't disable the master password. Register a security key first so you can still unlock.`,
    );
  if (!t.some(ia)) throw Error(aa);
  return { ...e, slots: t };
}
function pa(e, t) {
  let n = e.slots.filter((e) => e.kind !== 3);
  return oa({ ...e, slots: [...n, t] });
}
var ma = (e) => e();
function ha(e) {
  ma = e;
}
var ga,
  _a = !0;
function va(e, t = {}) {
  ((ga = e), (_a = t.implicitUsable ?? !0));
}
function ya() {
  return ga !== void 0 || _a;
}
function ba(e) {
  return e === `platform` ? ga : void 0;
}
function xa(e) {
  let t = e ? [ga, void 0] : [void 0, ga],
    n = t
      .filter((e, n) => t.indexOf(e) === n)
      .filter((e) => e !== void 0 || _a);
  return n.length > 0 ? n : [void 0];
}
function Sa(e) {
  return e === `platform`
    ? {
        authenticatorAttachment: `platform`,
        residentKey: `required`,
        userVerification: `required`,
      }
    : { residentKey: `discouraged`, userVerification: `preferred` };
}
function Ca(e) {
  let t = e.getAuthenticatorData?.();
  if (!t) return !1;
  let n = new Uint8Array(t);
  return n.length > 32 && !!(n[32] & 16);
}
function wa(e) {
  return Error(
    e === `platform`
      ? `That passkey provider can't unlock your vault. Try again and choose iCloud Keychain or Windows Hello rather than saving the passkey to your browser.`
      : `This authenticator didn't return a PRF secret. Try a YubiKey 5+ or Windows Hello.`,
  );
}
var Ta = `No key was used to unlock. If you dismissed the prompt, try again. Keys are registered per browser, so one added in a different browser won't work here - add a key in this browser, or use your master password.`,
  Ea = `No key was used to unlock. If you dismissed the prompt, try again. If you removed this browser's key in Bramble Desktop, remove it here too, under Tap to unlock, after unlocking with your master password.`;
function Da(e) {
  return e.some((e) => ra(e.credentialId)) ? Ea : Ta;
}
async function Oa(e, t, n = {}) {
  let r = new Uint8Array(32);
  globalThis.crypto.getRandomValues(r);
  let i = n.rpId,
    a = e.filter((e) => e.salt),
    o = {
      challenge: r,
      ...(i ? { rpId: i } : {}),
      allowCredentials: e.map((e) => ({
        type: `public-key`,
        id: e.credentialId,
      })),
      userVerification: `preferred`,
      extensions: {
        prf: {
          eval: { first: t },
          ...(a.length > 0
            ? {
                evalByCredential: Object.fromEntries(
                  a.map((e) => [Ae(e.credentialId), { first: e.salt }]),
                ),
              }
            : {}),
        },
      },
    },
    s;
  try {
    s = await ma(() => navigator.credentials.get({ publicKey: o }));
  } catch (t) {
    throw n.forUnlock && t?.name === `NotAllowedError` ? Error(Da(e)) : t;
  }
  if (!s)
    throw Error(n.forUnlock ? Da(e) : `Authenticator returned no credential.`);
  let c = s.getClientExtensionResults().prf?.results?.first;
  if (!c) throw wa(`securityKey`);
  return { rawId: new Uint8Array(s.rawId), hmacSecret: new Uint8Array(c) };
}
async function ka(e, t, n) {
  let r;
  for (let i = 0; i < n.length; i++) {
    let a = n[i],
      o = i === n.length - 1;
    try {
      return { ...(await Oa(e, t, { rpId: a, forUnlock: o })), rpId: a };
    } catch (e) {
      if (o) throw e;
      let t = e?.name;
      if (t !== `NotAllowedError` && t !== `SecurityError`) throw e;
      r = e;
    }
  }
  throw r ?? Error(`No rpID to try.`);
}
async function Aa(e, t = { kind: `securityKey` }) {
  let n = new Uint8Array(32);
  globalThis.crypto.getRandomValues(n);
  let r = new Uint8Array(16);
  globalThis.crypto.getRandomValues(r);
  let i = new Uint8Array(32);
  globalThis.crypto.getRandomValues(i);
  let a = t.rpId ?? ba(t.kind);
  try {
    let o = await ma(() =>
      navigator.credentials.create({
        publicKey: {
          challenge: n,
          rp: a ? { name: `Vault`, id: a } : { name: `Vault` },
          user: { id: r, name: e || `Vault`, displayName: e || `Vault` },
          pubKeyCredParams: [
            { type: `public-key`, alg: -7 },
            { type: `public-key`, alg: -257 },
          ],
          authenticatorSelection: Sa(t.kind),
          attestation: `none`,
          extensions: { prf: { eval: { first: i } } },
        },
      }),
    );
    if (!o) throw Error(`Authenticator returned no credential.`);
    let s = new Uint8Array(o.rawId),
      c = o.getClientExtensionResults(),
      l = c.prf?.results?.first;
    if (!l && c.prf?.enabled === !1) throw wa(t.kind);
    return {
      credentialId: s,
      salt: i,
      hmacSecret: l
        ? new Uint8Array(l)
        : (await Oa([{ credentialId: s }], i, { rpId: a })).hmacSecret,
      synced: Ca(o.response),
    };
  } catch (e) {
    throw a && e?.name === `SecurityError`
      ? Error(
          `This browser is too old to register a key for Bramble. Chrome 122 or Firefox 150 and newer are supported.`,
        )
      : e?.name === `NotAllowedError`
        ? Error(
            t.kind === `platform`
              ? `Registration was cancelled or timed out. Please try again.`
              : `Registration was cancelled or timed out. Adding a security key takes two taps: one to create the key, then a second to unlock its secret. Please try again and complete both prompts.`,
          )
        : e;
  }
}
var Q = i(b(), 1),
  ja = (0, Q.createContext)({
    settings: void 0,
    ready: !1,
    set: async () => {
      throw Error(`synced settings are unavailable while the vault is locked`);
    },
  });
function Ma() {
  return (0, Q.useContext)(ja);
}
var Na = `https://github.com/bramble-sh/bramble`,
  Pa = `${Na}/issues`,
  Fa = 864e5,
  Ia = 1e4,
  La = {
    ios: `https://bramble.sh/ios/latest.json`,
    android: `https://bramble.sh/android/latest.json`,
  },
  Ra = `https://apps.apple.com/app/id6783071787`,
  za = `${Na}/releases/download/`,
  Ba = /^\d+(\.\d+){0,2}$/;
function Va(e) {
  let t = e.match(/^\d+(\.\d+){0,2}/)?.[0];
  return t && !/^0(\.0)*$/.test(t) ? t : null;
}
function Ha(e, t) {
  let n = e.split(`.`).map(Number),
    r = t.split(`.`).map(Number);
  for (let e = 0; e < Math.max(n.length, r.length); e++) {
    let t = (n[e] ?? 0) - (r[e] ?? 0);
    if (t !== 0) return t > 0;
  }
  return !1;
}
function Ua(e, t) {
  return e.checkedAt === void 0 || e.checkedAt > t || t - e.checkedAt >= Fa;
}
function Wa(e) {
  if (!e || typeof e != `object`) return {};
  let t = e,
    n = t.latest;
  return {
    checkedAt: typeof t.checkedAt == `number` ? t.checkedAt : void 0,
    latest:
      n && typeof n.version == `string` && typeof n.url == `string`
        ? { version: n.version, url: n.url }
        : void 0,
    dismissed: typeof t.dismissed == `string` ? t.dismissed : void 0,
  };
}
function Ga(e, t) {
  let n = e.latest;
  return !n || n.version === e.dismissed ? null : Ha(n.version, t) ? n : null;
}
function Ka(e, t) {
  let n = t ?? {};
  if (typeof n.version != `string` || !Ba.test(n.version))
    throw Error(`manifest: bad version`);
  if (e === `ios`) return { version: n.version, url: Ra };
  if (
    typeof n.url != `string` ||
    !n.url.startsWith(za) ||
    !n.url.endsWith(`.apk`)
  )
    throw Error(`manifest: bad url`);
  return { version: n.version, url: n.url };
}
async function qa(e) {
  let t = La[e];
  if (!t) throw Error(`no update manifest for ${e}`);
  let n = new AbortController(),
    r = setTimeout(() => n.abort(), Ia);
  try {
    let r = await fetch(t, {
      credentials: `omit`,
      cache: `no-store`,
      signal: n.signal,
    });
    if (!r.ok) throw Error(`manifest: ${r.status}`);
    return Ka(e, await r.json());
  } finally {
    clearTimeout(r);
  }
}
var Ja = 864e5,
  Ya = {
    minInstallAgeDays: 14,
    minSessions: 10,
    minEntries: 3,
    maxAsks: 2,
    daysBetweenAsks: 90,
  };
function Xa(e) {
  return { installedAt: e, sessions: 0, asks: 0, rated: !1 };
}
function Za(e, t) {
  if (!e || typeof e != `object`) return Xa(t);
  let n = e,
    r =
      typeof n.installedAt == `number` && n.installedAt > 0
        ? Math.min(n.installedAt, t)
        : t,
    i = (e) => (typeof e == `number` && e >= 0 ? Math.floor(e) : 0);
  return {
    installedAt: r,
    sessions: i(n.sessions),
    asks: i(n.asks),
    lastAskedAt: typeof n.lastAskedAt == `number` ? n.lastAskedAt : void 0,
    rated: n.rated === !0,
  };
}
function Qa(e) {
  return { ...e, sessions: e.sessions + 1 };
}
function $a(e, t) {
  return { ...e, asks: e.asks + 1, lastAskedAt: t };
}
function eo(e, t) {
  return { ...$a(e, t), rated: !0 };
}
function to(e, t = Ya) {
  return {
    installedAt: e - (t.minInstallAgeDays + 1) * Ja,
    sessions: t.minSessions,
    asks: 0,
    rated: !1,
  };
}
function no(e, t = Ya) {
  return e.rated || e.asks >= t.maxAsks;
}
function ro(e, t, n = Ya) {
  return !(
    no(e, n) ||
    t.now - e.installedAt < n.minInstallAgeDays * Ja ||
    e.sessions < n.minSessions ||
    t.entries < n.minEntries ||
    (e.lastAskedAt !== void 0 && t.now - e.lastAskedAt < n.daysBetweenAsks * Ja)
  );
}
var io = {
  chromium: `https://chromewebstore.google.com/detail/bramble/kmokhdhoggbdcgoepifeckhgbfakaknm/reviews`,
  firefox: `https://addons.mozilla.org/firefox/addon/bramble/reviews/`,
  ios: `https://apps.apple.com/app/id6783071787?action=write-review`,
};
function ao(e) {
  return io[e];
}
var oo = [`all`, `login`, `card`, `note`, `ssh-key`],
  so = [
    `name-asc`,
    `name-desc`,
    `recent-activity`,
    `recent-used`,
    `recent-added`,
    `recent-updated`,
  ],
  co = (e) => so.includes(e),
  lo = [`all`, `atRisk`, `strong`],
  uo = {
    q: ``,
    type: `all`,
    sort: `name-asc`,
    archived: !1,
    attachments: !1,
    health: `all`,
  },
  fo = Re({
    q: N()
      .optional()
      .catch(void 0),
    type: A(oo)
      .optional()
      .catch(void 0),
    sort: A(so)
      .optional()
      .catch(void 0),
    archived: Ne()
      .optional()
      .catch(void 0),
    attachments: Ne()
      .optional()
      .catch(void 0),
    health: A(lo)
      .optional()
      .catch(void 0),
  });
function po(e) {
  return e.leaked === !0 || e.reused === !0;
}
function mo(e) {
  return e.toLowerCase().split(/\s+/).filter(Boolean);
}
function ho(e) {
  let t = [],
    n = [];
  for (let r of mo(e)) {
    if (!r.startsWith(`#`)) {
      t.push(r);
      continue;
    }
    let e = r.replace(/^#+/, ``);
    e && n.push(e);
  }
  return { text: t, tags: n };
}
function go(e, t) {
  return e.name.localeCompare(t.name, void 0, { sensitivity: `base` });
}
function _o(...e) {
  let t = (t) => Math.max(...e.map((e) => t[e] ?? -1 / 0));
  return (e, n) => {
    let r = t(e),
      i = t(n);
    return r === i ? go(e, n) : i - r;
  };
}
var vo = {
  "name-asc": go,
  "name-desc": (e, t) => go(t, e),
  "recent-activity": _o(`lastUsedAt`, `createdAt`, `updatedAt`),
  "recent-used": _o(`lastUsedAt`),
  "recent-added": _o(`createdAt`),
  "recent-updated": _o(`updatedAt`),
};
function yo(e) {
  if (/\s$/.test(e)) return null;
  let t = e.split(/\s+/).at(-1) ?? ``;
  return t.startsWith(`#`) ? t.replace(/^#+/, ``).toLowerCase() : null;
}
function bo(e, t) {
  let n = e.split(/(\s+)/),
    r = -1;
  for (let e = n.length - 1; e >= 0; e--)
    if ((n[e] ?? ``).trim().length > 0) {
      r = e;
      break;
    }
  return r === -1 ? `#${t} ` : ((n[r] = `#${t}`), `${n.join(``)} `);
}
function xo(e, t, n) {
  let { text: r, tags: i } = ho(t.q),
    a = e.filter((e) => {
      if (
        (e.archived ?? !1) !== t.archived ||
        (t.type !== `all` && e.type !== t.type) ||
        (t.attachments && !e.hasFiles) ||
        (t.health === `atRisk` && !po(e)) ||
        (t.health === `strong` && (e.type !== `login` || po(e)))
      )
        return !1;
      let n = e.tagKeys;
      return i.length > 0 && !i.every((e) => n?.some((t) => t.startsWith(e)))
        ? !1
        : r.every((t) => e.searchText.includes(t));
    }),
    o = vo[t.sort],
    s = new Map(a.map((e) => [e.id, So(e, r)])),
    c = (e) => s.get(e.id) ?? 0,
    l = (e) => +!n?.has(e.id);
  return a.sort((e, t) => c(e) - c(t) || l(e) - l(t) || o(e, t));
}
function So(e, t) {
  let n = e.searchTiers;
  return !n || t.length === 0
    ? 0
    : Math.max(
        ...t.map((e) => {
          let t = n.findIndex((t) => t.includes(e));
          return t === -1 ? n.length : t;
        }),
      );
}
var $ = x(),
  Co = `pref.autoLockMinutes`,
  wo = `pref.breachCheckEnabled`,
  To = `pref.clipboardClearSeconds`,
  Eo = `pref.offerToSave`,
  Do = `pref.autofillEnabled`,
  Oo = `pref.neverSaveSites`,
  ko = `pref.biometricAutoPrompt`,
  Ao = `pref.biometricPasscodeFallback`,
  jo = `pref.autofillQuickType`,
  Mo = `pref.passkeyProviderEnabled`,
  No = `pref.passkeyConfirmOncePerUnlock`,
  Po = `pref.lockOnScreenLock`,
  Fo = `pref.statsCollapsed`,
  Io = `pref.autostartPromptDismissed`,
  Lo = `pref.defaultManagerPromptDismissed`,
  Ro = `pref.generator`,
  zo = `pref.vaultSort`,
  Bo = `pref.aliasProvider`,
  Vo = `pref.reviewNudge`,
  Ho = `pref.updateCheck`,
  Uo = `pref.appUpdate`,
  Wo = !1,
  Go = [],
  Ko = !1,
  qo = !1,
  Jo = !1,
  Yo = !1,
  Xo = !1,
  Zo = !1,
  Qo = !0,
  $o = {
    autoLockMinutes: Co,
    breachCheckEnabled: wo,
    clipboardClearSeconds: To,
    offerToSave: Eo,
    autofillEnabled: Do,
    neverSaveSites: Oo,
    biometricAutoPrompt: ko,
    biometricPasscodeFallback: Ao,
    autofillQuickType: jo,
    passkeyProviderEnabled: Mo,
    passkeyConfirmOncePerUnlock: No,
    lockOnScreenLock: Po,
    statsCollapsed: Fo,
    vaultSort: zo,
    autostartPromptDismissed: Io,
    defaultManagerPromptDismissed: Lo,
    generator: Ro,
    aliasProvider: Bo,
    reviewNudge: Vo,
    updateCheck: Ho,
    appUpdate: Uo,
  },
  es = {
    autoLockMinutes: `device`,
    breachCheckEnabled: `device`,
    clipboardClearSeconds: `device`,
    offerToSave: `device`,
    autofillEnabled: `device`,
    neverSaveSites: `device`,
    biometricAutoPrompt: `vault`,
    autofillQuickType: `device`,
    passkeyProviderEnabled: `device`,
    passkeyConfirmOncePerUnlock: `device`,
    lockOnScreenLock: `device`,
    statsCollapsed: `device`,
    vaultSort: `device`,
    autostartPromptDismissed: `device`,
    defaultManagerPromptDismissed: `device`,
    biometricPasscodeFallback: `vault`,
    generator: `device`,
    aliasProvider: `synced`,
    reviewNudge: `device`,
    updateCheck: `device`,
    appUpdate: `device`,
  },
  ts = Object.keys(es).filter((e) => es[e] === `vault`),
  ns = Object.keys(es).filter((e) => es[e] === `synced`),
  rs = { aliasProvider: (e) => (_(e) ? e : null) };
function is(e, t) {
  let n = os[e];
  if (t == null) return n;
  let r = rs[e];
  return r
    ? r(t)
    : Array.isArray(n)
      ? Array.isArray(t)
        ? t
        : n
      : typeof t == typeof n
        ? t
        : n;
}
var as = ts.map((e) => $o[e]),
  os = {
    autoLockMinutes: 15,
    breachCheckEnabled: Wo,
    clipboardClearSeconds: 30,
    offerToSave: !0,
    autofillEnabled: !0,
    neverSaveSites: Go,
    biometricAutoPrompt: Ko,
    biometricPasscodeFallback: qo,
    autofillQuickType: Jo,
    passkeyProviderEnabled: !1,
    passkeyConfirmOncePerUnlock: !1,
    lockOnScreenLock: !0,
    statsCollapsed: Yo,
    vaultSort: uo.sort,
    autostartPromptDismissed: Xo,
    defaultManagerPromptDismissed: Zo,
    generator: m,
    aliasProvider: null,
    reviewNudge: Xa(Date.now()),
    updateCheck: Qo,
    appUpdate: {},
  },
  ss = (0, Q.createContext)(null);
async function cs(e) {
  await Promise.all(ts.map((t) => e.removeMeta($o[t]).catch(() => {})));
}
async function ls(e, t, n, r) {
  let i = await e.getMeta(n);
  if (i !== void 0 || !r || n === t) return i;
  let a = await e.getMeta(t);
  if (a !== void 0)
    return (await e.setMeta(n, a), await e.removeMeta(t).catch(() => {}), a);
}
function us({ children: e }) {
  let { storage: t } = ie(),
    n = Ma(),
    { activeId: r, vaults: i, ready: a } = re(),
    [o, s] = (0, Q.useState)(os),
    [c, l] = (0, Q.useState)(!1),
    u = r ?? i[0]?.id,
    d = (0, Q.useCallback)(
      (e) => {
        let t = $o[e];
        return es[e] === `vault` && u ? f(t, u) : t;
      },
      [u],
    );
  ((0, Q.useEffect)(() => {
    let e = !1,
      n = a && i.length === 1,
      r = a && i.length > 1;
    return (
      s((e) => ({ ...e, ...Object.fromEntries(ts.map((e) => [e, os[e]])) })),
      (async () => {
        r && (await cs(t));
        let [i, a, o, c, u, f, p, m, h, _, v, y, ee, b, te, x, ne, re, ie, S] =
          await Promise.all([
            t.getMeta(Co),
            t.getMeta(wo),
            t.getMeta(To),
            t.getMeta(Eo),
            t.getMeta(Do),
            t.getMeta(Oo),
            ls(t, ko, d(`biometricAutoPrompt`), n),
            t.getMeta(jo),
            t.getMeta(Mo),
            t.getMeta(Po),
            t.getMeta(Fo),
            t.getMeta(Io),
            ls(t, Ao, d(`biometricPasscodeFallback`), n),
            t.getMeta(Ro),
            t.getMeta(Vo),
            t.getMeta(Lo),
            t.getMeta(No),
            t.getMeta(Ho),
            t.getMeta(Uo),
            t.getMeta(zo),
          ]);
        if (e) return;
        let ae = Date.now();
        (s((e) => ({
          ...e,
          autoLockMinutes: typeof i == `number` ? i : 15,
          breachCheckEnabled: typeof a == `boolean` ? a : Wo,
          clipboardClearSeconds: typeof o == `number` ? o : 30,
          offerToSave: typeof c != `boolean` || c,
          autofillEnabled: typeof u != `boolean` || u,
          neverSaveSites: Array.isArray(f) ? f : Go,
          biometricAutoPrompt: typeof p == `boolean` ? p : Ko,
          autofillQuickType: typeof m == `boolean` ? m : Jo,
          passkeyProviderEnabled: typeof h == `boolean` && h,
          passkeyConfirmOncePerUnlock: typeof ne == `boolean` && ne,
          lockOnScreenLock: typeof _ != `boolean` || _,
          statsCollapsed: typeof v == `boolean` ? v : Yo,
          vaultSort: co(S) ? S : uo.sort,
          autostartPromptDismissed: typeof y == `boolean` ? y : Xo,
          biometricPasscodeFallback: typeof ee == `boolean` ? ee : qo,
          generator: g(b),
          reviewNudge: Za(te, ae),
          defaultManagerPromptDismissed: typeof x == `boolean` ? x : Zo,
          updateCheck: typeof re == `boolean` ? re : Qo,
          appUpdate: Wa(ie),
        })),
          l(!0));
      })(),
      () => {
        e = !0;
      }
    );
  }, [t, d, a, i.length]),
    (0, Q.useEffect)(() => {
      ns.length !== 0 &&
        s((e) => {
          let t = {};
          for (let e of ns) {
            let r = n.settings?.[$o[e]];
            Object.assign(t, { [e]: is(e, r?.value) });
          }
          return { ...e, ...t };
        });
    }, [n.settings]));
  let p = (0, Q.useCallback)(
      async (e, r) => {
        (s((t) => ({ ...t, [e]: r })),
          es[e] === `synced`
            ? await n.set($o[e], r)
            : await t.setMeta(d(e), r));
      },
      [t, d, n],
    ),
    m = (0, Q.useMemo)(() => ({ prefs: o, loaded: c, update: p }), [o, c, p]);
  return (0, $.jsx)(ss.Provider, { value: m, children: e });
}
function ds() {
  let e = (0, Q.useContext)(ss);
  if (!e) throw Error(`usePrefs called outside PrefsProvider`);
  return e;
}
async function fs(e, t) {
  if (!e.syncSigningPublicKey || !e.signRoster) return t;
  let n = await e.syncSigningPublicKey();
  return Fe(t, n, e.signRoster);
}
var ps = class extends Error {
    constructor() {
      (super(`this device's own roster entry is missing or carries an old key`),
        (this.name = `UnrecognizedDeviceError`));
    }
  },
  ms = class extends Error {
    constructor() {
      (super(`adding a device needs this vault's master password`),
        (this.name = `MasterPasswordRequiredError`));
    }
  };
async function hs(e, t, n) {
  if (!t || !e.syncAdmissionSign) return n;
  let r = await e.syncAdmissionSign(t.password, t.saltB64, E(n));
  return { ...n, admission: { by: t.adminId, sig: r } };
}
function gs(e) {
  let {
      storage: t,
      syncKey: n,
      ensureClock: r,
      rotateDeviceId: i,
      readDecodedBlob: a,
      unlock: o,
      readEntriesPayload: s,
    } = e,
    { shell: c } = ie(),
    l = (0, Q.useRef)(null),
    d = (0, Q.useCallback)(async () => {
      let e = await t.getMeta(n(`sync.group`));
      if (e?.groupKey) return e.groupKey;
      let i = await c.syncDevicePublicKey(),
        a = (await r()).send(),
        o = fe(),
        s = await fs(c, {
          id: a.node,
          publicKey: i,
          label: (await c.deviceLabel?.()) ?? u(),
          addedAt: Date.now(),
          hlc: a,
        }),
        l = de(T(), s);
      return (await t.setMeta(n(`sync.group`), { groupKey: o, roster: l }), o);
    }, [t, n, c, r]),
    f = (0, Q.useCallback)(
      async (e) => {
        let r = await t.getMeta(n(`sync.group`));
        r &&
          (await t.setMeta(n(`sync.group`), {
            groupKey: r.groupKey,
            roster: de(r.roster, e),
          }));
      },
      [t, n],
    ),
    p = (0, Q.useCallback)(
      async (e, i, a) => {
        if (!c.syncAdmissionPublicKey || !c.syncAdmissionSign) return null;
        let o = k(a.salt),
          s = await c.syncAdmissionPublicKey(i, o),
          l = await t.getMeta(n(`sync.group`)),
          u = l?.roster.devices.find((t) => t.publicKey === e);
        if (!l || !u) return null;
        if (u.admissionKey !== s) {
          let e = (await r()).send(),
            t = await fs(c, { ...u, admissionKey: s, hlc: e });
          await f(t);
        }
        return { password: i, saltB64: o, adminId: u.id };
      },
      [c, t, n, r, f],
    ),
    m = (0, Q.useCallback)(async () => {
      if (!c.syncSigningPublicKey || !c.signRoster) return;
      let e = () => t.getMeta(n(`sync.group`)),
        i = null;
      for (let a = 0; a < 2; a++) {
        let a = await e();
        if (!a) return;
        i ??= await c.syncDevicePublicKey();
        let o = a.roster.devices.find((e) => e.publicKey === i);
        if (!o || o.sigKey) return;
        let s = await r();
        s.witness(o.hlc);
        let l = await fs(c, { ...o, hlc: s.send() });
        if (!l.sigKey) return;
        let u = await e(),
          d = u?.roster.devices.find((e) => e.publicKey === i);
        if (!u || !d) return;
        if (E(d) === E(o)) {
          await t.setMeta(n(`sync.group`), {
            groupKey: u.groupKey,
            roster: de(u.roster, l),
          });
          return;
        }
      }
    }, [c, t, n, r]);
  return {
    inviteDevice: (0, Q.useCallback)(
      async (e, r, i, o) => {
        let { blob: u } = await a(),
          f = _e(u);
        if (!f || !i) throw new ms();
        (await t.setMeta(`sync.relay`, e),
          await t.setMeta(`sync.iceUrl`, r ?? ``));
        let m = await d(),
          h = await c.syncDevicePublicKey(),
          g = await t.getMeta(n(`sync.group`));
        if (!g || !De(g.roster).some((e) => e.publicKey === h)) throw new ps();
        let _ = fe(),
          v = await s(),
          y = {
            saltB64: k(f.salt),
            slotIdB64: k(f.slotId),
            verifierB64: k(f.verifier),
          },
          ee = ve(u).map((e) => ({
            saltB64: k(e.salt),
            slotIdB64: k(e.slotId),
            verifierB64: k(e.verifier),
            wrapIvB64: k(e.wrapIv),
            wrappedVekB64: k(e.wrappedVek),
          })),
          b = await p(h, i, f),
          te = (await t.getMeta(n(`sync.group`)))?.roster ?? T();
        (l.current?.(),
          (l.current = c.onSyncEvent((e) => {
            if (e.kind !== `enrolled` || !e.entryJson) return;
            let r;
            try {
              r = we.parse(JSON.parse(e.entryJson));
            } catch {
              return;
            }
            (async () => {
              let e = await hs(c, b, r),
                i = await t.getMeta(n(`sync.group`));
              i &&
                Oe(i.roster, e) &&
                (await t.setMeta(n(`sync.group`), {
                  groupKey: i.groupKey,
                  roster: de(i.roster, e),
                }),
                l.current?.(),
                (l.current = null));
            })();
          })));
        let x = Date.now() + me;
        return (
          await c.startEnrollInvite({
            relayUrl: e,
            iceUrl: r,
            groupKeyB64: m,
            psk: _,
            roster: te,
            entries: v,
            passwordCheck: y,
            recoverySlots: ee,
            admission: b ?? void 0,
            viaLink: o?.viaLink,
          }),
          se({
            v: 1,
            groupKey: m,
            inviterPub: h,
            psk: _,
            relay: e,
            iceUrl: r || void 0,
            exp: x,
          })
        );
      },
      [d, c, t, n, s, a, p],
    ),
    joinGroup: (0, Q.useCallback)(
      async (e, a, s) => {
        let l = be(e.trim());
        if (Ee(l))
          throw Error(
            `That pairing code has expired. Generate a new one and try again.`,
          );
        await i();
        let d = await c.syncDevicePublicKey(),
          f = (await r()).send(),
          p = await fs(c, {
            id: f.node,
            publicKey: d,
            label: (await c.deviceLabel?.()) ?? u(),
            addedAt: Date.now(),
            hlc: f,
          }),
          m = new Promise((e, t) => {
            let n = c.onSyncEvent((r) => {
              r.kind === `joined` && r.vaultBlobB64 && r.roster
                ? (n(), e({ vaultBlobB64: r.vaultBlobB64, roster: r.roster }))
                : r.kind === `join-error` &&
                  (n(), t(Error(r.message || `Join failed.`)));
            });
          });
        await c.startEnrollJoin({
          relayUrl: l.relay,
          iceUrl: l.iceUrl,
          groupKeyB64: l.groupKey,
          psk: l.psk,
          inviterPub: l.inviterPub,
          ownEntry: p,
          password: a.password,
          viaLink: s?.viaLink,
        });
        let h, g;
        try {
          ({ vaultBlobB64: h, roster: g } = await m);
        } catch (e) {
          throw (await c.stopSyncSpike().catch(() => {}), e);
        }
        (await t.writeVaultBlob(O(h)),
          await t.setMeta(n(`sync.group`), {
            groupKey: l.groupKey,
            roster: de(g, p),
          }),
          await t.setMeta(`sync.relay`, l.relay),
          await t.setMeta(`sync.iceUrl`, l.iceUrl ?? ``),
          await c.stopSyncSpike(),
          await o(a.password));
      },
      [c, t, n, r, i, o],
    ),
    removeDevice: (0, Q.useCallback)(
      async (e) => {
        let i = await t.getMeta(n(`sync.group`));
        if (!i) return;
        let a = (await r()).send();
        (await t.setMeta(n(`sync.group`), {
          groupKey: i.groupKey,
          roster: ae(i.roster, e, a),
        }),
          await c.syncRosterChanged?.().catch(() => {}));
      },
      [c, t, n, r],
    ),
    ensureOwnEntrySigned: m,
  };
}
function _s(e) {
  return e.type === `login`;
}
var vs = `pref.securityKeyLabels`,
  ys = class extends Error {},
  bs = (e, t) =>
    e.length === t.length && e.every((e) => t.some((t) => pe(e, t) === 0));
function xs() {
  let { entries: e, ...t } = Fi();
  return t;
}
var Ss = new Map(),
  Cs = (e) => e ?? ``,
  ws = (0, Q.createContext)(null),
  Ts = (0, Q.createContext)(null);
function Es({ children: e }) {
  let {
      storage: i,
      crypto: o,
      autofill: l,
      shell: u,
      biometric: d,
      exchange: m,
      backupCreds: g,
      files: _,
      desktopLink: y,
    } = ie(),
    { _: b } = ne(),
    {
      activeId: x,
      ready: S,
      vaults: ae,
      syncKey: C,
      createRecord: se,
      dropActiveRecord: le,
      forgetEmptyRecord: de,
      selectVault: fe,
      refresh: me,
    } = re(),
    T = (0, Q.useMemo)(() => te(i, x), [i, x]),
    E = (0, Q.useMemo)(() => (x ? (o.withVault?.(x) ?? o) : o), [o, x]),
    [he, ge] = (0, Q.useState)(!1),
    [D, we] = (0, Q.useState)(!0),
    [Te, Ee] = (0, Q.useState)(!1),
    [De, Oe] = (0, Q.useState)(!1),
    [ke, Ae] = (0, Q.useState)(!1),
    [je, Me] = (0, Q.useState)(`biometric`),
    [Ne, Pe] = (0, Q.useState)(!1),
    [Fe, Ie] = (0, Q.useState)(!1),
    [Le, Re] = (0, Q.useState)([]),
    Be = (0, Q.useMemo)(() => Sr(Le), [Le]),
    Ve = (0, Q.useMemo)(() => Le.filter((e) => e.type === `unlock-key`), [Le]),
    [We, A] = (0, Q.useState)(null),
    [Ge, j] = (0, Q.useState)([]),
    [M, Ke] = (0, Q.useState)(!1),
    [Je, Ye] = (0, Q.useState)(!1),
    [Xe, Ze] = (0, Q.useState)(!1),
    [$e, et] = (0, Q.useState)(null),
    [N, tt] = (0, Q.useState)({}),
    P = (0, Q.useRef)({
      entries: Le,
      webauthnKeyLabels: N,
      isLocked: D,
      biometricEnabled: ke,
      activeId: x,
    });
  P.current = {
    entries: Le,
    webauthnKeyLabels: N,
    isLocked: D,
    biometricEnabled: ke,
    activeId: x,
  };
  let rt = (0, Q.useRef)(null),
    F = (0, Q.useRef)(xs()),
    it = (0, Q.useRef)(null),
    [at, ot] = (0, Q.useState)(null),
    st = (0, Q.useRef)(() => {}),
    ct = (0, Q.useRef)(0),
    lt = (0, Q.useCallback)((e) => {
      ((it.current = e), ot(e));
    }, []),
    [dt, pt] = (0, Q.useState)(void 0),
    [mt, ht] = (0, Q.useState)(Ss),
    [gt, _t] = (0, Q.useState)([]),
    vt = (0, Q.useRef)(gt);
  vt.current = gt;
  let yt = (0, Q.useCallback)(async () => {
      let e = x ?? null;
      if (rt.current?.vaultId !== e) {
        let t = await Qe(
          () => T.getMeta(C(qe)),
          (e, t) => T.setMeta(C(qe), t),
        );
        rt.current = { vaultId: e, clock: He(t) };
      }
      return rt.current.clock;
    }, [T, C, x]),
    bt = (0, Q.useCallback)(async () => {
      (await T.removeMeta(C(qe)), (rt.current = null));
    }, [T, C]),
    I = (0, Q.useCallback)(async () => {
      let e = async () => {
        let e = await T.readVaultBlob();
        return { bytes: e, blob: oe(e) };
      };
      try {
        return await e();
      } catch (t) {
        if (!(await T.restoreVaultFromBackup().catch(() => !1))) throw t;
        return (
          console.warn(
            `[vault] live vault file failed to decode; restored from backup snapshot`,
          ),
          e()
        );
      }
    }, [T]),
    L = (0, Q.useCallback)(async () => {
      try {
        let [{ blob: e }, t] = await Promise.all([I(), T.getMeta(vs)]);
        (j(ye(e)),
          Ke(_e(e) !== null),
          Ye(ve(e).length > 0),
          tt(t ?? {}),
          et(null));
      } catch (e) {
        (console.error(`[vault] could not read vault for slot metadata:`, e),
          j([]),
          Ke(!1),
          Ye(!1),
          tt({}),
          et(e.message));
      }
    }, [I, T]),
    R = (0, Q.useCallback)(
      async (e, t) => {
        try {
          await l.setIndex(e, t);
        } catch (e) {
          console.warn(`[vault] autofill index not updated for this load:`, e);
        }
      },
      [l],
    ),
    z = (0, Q.useCallback)(
      async (e, t) => {
        let n = e ?? x,
          r = (e) => (E.notifyExternalChange ? { diskSeen: e } : {}),
          i = await l.beginIndexUpdate?.().catch((e) => {
            console.warn(`[vault] no autofill index lease for this load:`, e);
          }),
          { blob: a } = await I();
        if (t?.()) return;
        if (a.entriesCiphertext.length === 0) {
          ((F.current = { ...xs(), ...r(a.entriesCiphertext) }),
            (P.current = { ...P.current, entries: [] }),
            lt(Cs(n)),
            ht(Ss),
            pt(void 0),
            _t([]),
            Re([]),
            await R([], i));
          return;
        }
        let o = await Xi(
            {
              crypto: E,
              storage: T,
              onRestored: () =>
                console.warn(
                  `[vault] entries failed to decrypt; restoring the verified snapshot`,
                ),
            },
            a,
          ),
          s;
        try {
          s = ce(Ce(o), ue());
        } catch (e) {
          throw (
            console.error(`[vault] entries payload failed to decode:`, e),
            new Jr(
              `This vault was created by an incompatible version and can't be opened. Its data format has changed.`,
            )
          );
        }
        if (t?.()) return;
        (pt(s.settings), _t(xe(s)));
        let c = await yt();
        for (let e of [...s.entries, ...(s.conflicts ?? []), ...s.tombstones]) {
          c.witness(e.hlc);
          for (let t of Object.values(e.vv ?? {})) c.witness(t);
        }
        let u = await E.decryptEntries(
          s.entries.map((e) => ({
            ciphertext: e.ciphertext,
            iv: e.iv,
            wrappedDek: e.wrappedDek,
            dekIv: e.dekIv,
          })),
        );
        if (t?.()) return;
        let d = [],
          f = [];
        if (
          (s.entries.forEach((e, t) => {
            let n = u[t];
            n == null ? d.push(e) : f.push({ id: e.id, ...ze(JSON.parse(n)) });
          }),
          d.length > 0)
        ) {
          let e = await E.encryptEntry(`{}`),
            [t] = await E.decryptEntries([e]);
          if (t == null)
            throw Error(`entry decryption is failing on this device`);
          let { readQuarantine: r, writeQuarantine: i } = T;
          if (!n || !r || !i) throw Error(`no quarantine store for this vault`);
          (console.warn(
            `[vault] setting aside ${d.length} entries this vault can't decrypt`,
          ),
            await Ki(
              {
                storage: { readQuarantine: r, writeQuarantine: i },
                store: vi({
                  crypto: E,
                  storage: T,
                  readDecodedBlob: I,
                  verifyVekBeforeWrite: !0,
                }),
                vaultId: n,
              },
              d,
            ));
        }
        let p = Li(s, f),
          { entries: m, ...h } = p;
        ((F.current = { ...h, ...r(a.entriesCiphertext) }),
          (P.current = { ...P.current, entries: f }),
          lt(Cs(n)),
          ht(Ui(p)),
          Re(f),
          await R(Se(f), i));
      },
      [I, E, T, l, yt, R, x, lt],
    ),
    xt = (0, Q.useCallback)(() => {
      let e = ct.current;
      z(void 0, () => e !== ct.current).catch(() => {});
    }, [z]);
  ((0, Q.useEffect)(() => {
    st.current = xt;
  }, [xt]),
    (0, Q.useEffect)(() => {
      ct.current++;
    }, [x]));
  let St = (0, Q.useCallback)(
      async (e) => {
        try {
          await z(e ?? void 0);
        } catch (e) {
          throw (
            console.error(`[vault] vault failed to open after unlock:`, e),
            await E.lock().catch(() => {}),
            e instanceof Jr ? e : Error(a)
          );
        }
        e && u.notifyVaultOpened?.(e);
      },
      [z, E, u],
    ),
    Ct = (0, Q.useCallback)(() => {
      (ct.current++,
        (F.current = xs()),
        (P.current = { ...P.current, entries: [] }),
        lt(null),
        ht(Ss),
        pt(void 0),
        _t([]),
        Re([]),
        we(!0));
    }, [lt]);
  ((0, Q.useEffect)(() => {
    if (!S) return;
    let e = !1;
    return (
      (async () => {
        try {
          let t = await T.hasVaultHandle();
          if (e || (ge(t), !t)) return;
          if (ae.length === 0) {
            await me();
            return;
          }
          await L();
          let n = await E.isLocked();
          if (e) return;
          if (n) {
            Ct();
            return;
          }
          try {
            (await z(), x && u.notifyVaultOpened?.(x));
          } catch (t) {
            (console.error(
              `[vault] loadEntries failed on mount; showing unlock screen:`,
              t,
            ),
              e || we(!0));
            return;
          }
          let r = await E.isLocked();
          if (e) return;
          if (r) {
            Ct();
            return;
          }
          (we(!1), u.flushPendingCornerCapture().catch(() => {}));
        } catch (t) {
          e || A(String(t));
        } finally {
          e || Ie(!0);
        }
      })(),
      () => {
        e = !0;
      }
    );
  }, [S, T, E, z, u, L, ae.length, me, x, Ct]),
    (0, Q.useEffect)(() => {
      !D && x && u.setActiveVault?.(x);
    }, [D, x, u]),
    (0, Q.useEffect)(() => {
      D || Ee(!1);
    }, [D]),
    (0, Q.useEffect)(() => {
      D && Ze(!1);
    }, [D]),
    (0, Q.useEffect)(() => {
      Ze(!1);
    }, [x]),
    (0, Q.useEffect)(() => E.onExternalLock(Ct), [E, Ct]),
    (0, Q.useEffect)(() => E.onExternalChange(xt), [E, xt]));
  let wt = (0, Q.useCallback)(
      async (e, t) => {
        A(null);
        let n;
        try {
          let { blob: e } = await I();
          n = _e(e);
        } catch (e) {
          throw (
            console.error(`[vault] failed to read vault blob:`, e),
            Error(b({ id: `1AcyHt` }))
          );
        }
        if (!n) throw Error(b({ id: `suZ3re` }));
        let r = t ?? x ?? null;
        if (
          (r !== null && (await u.setActiveVault?.(r)),
          !(await E.unwrapVekPassword({
            password: e,
            saltB64: k(n.salt),
            slotIdB64: k(n.slotId),
            verifierB64: k(n.verifier),
            wrapIvB64: k(n.wrapIv),
            wrappedVekB64: k(n.wrappedVek),
            magicVersion: w(),
          })))
        )
          throw Error(b({ id: `wdOZo1` }));
        (await St(r), we(!1), u.flushPendingCornerCapture().catch(() => {}));
      },
      [I, E, St, u, x, b],
    ),
    Tt = (0, Q.useCallback)(async () => {
      Ee(!0);
      try {
        await E.lock();
      } catch (e) {
        throw (Ee(!1), e);
      }
      (await l.clearIndex(), Ct(), Ee(!0));
    }, [E, l, Ct]),
    Et = (0, Q.useCallback)((e) => t(E, e), [E]),
    Dt = (0, Q.useCallback)((e) => n(E, $i(e)), [E]),
    B = (0, Q.useCallback)(
      async (e, t) => {
        if (
          (await u.setActiveVault?.(x ?? null),
          !(await E.unwrapVekWebauthn({
            hmacSecretB64: k(t),
            slotIdB64: k(e.slotId),
            verifierB64: k(e.verifier),
            wrapIvB64: k(e.wrapIv),
            wrappedVekB64: k(e.wrappedVek),
            magicVersion: w(),
          })))
        )
          throw Error(b({ id: `CNIlW5` }));
        (await St(x ?? null),
          we(!1),
          u.flushPendingCornerCapture().catch(() => {}));
      },
      [E, St, u, x, b],
    ),
    Ot = (0, Q.useCallback)(
      async (e) => {
        let t = ca(e, (await T.getMeta(vs)) ?? {}, k).some(
          (e) => e.kind === `platform`,
        );
        return ka(e, e[0].salt, xa(t));
      },
      [T],
    ),
    kt = (0, Q.useCallback)(async () => {
      A(null);
      let e;
      try {
        let { blob: t } = await I();
        e = ye(t);
      } catch (e) {
        throw (
          console.error(`[vault] failed to read vault blob:`, e),
          Error(b({ id: `1AcyHt` }))
        );
      }
      if (e.length === 0) throw Error(b({ id: `7HfY7Q` }));
      let t = await Ot(e),
        n = sa(e, t.rawId);
      if (!n) throw Error(b({ id: `iOE0Iw` }));
      await B(n, t.hmacSecret);
    }, [I, B, Ot, b]),
    At = (0, Q.useCallback)(async () => {
      let { blob: e } = await I(),
        t = ye(e);
      if (t.length === 0) return !1;
      try {
        return sa(t, (await Ot(t)).rawId) !== null;
      } catch {
        return !1;
      }
    }, [I, Ot]),
    jt = (0, Q.useCallback)(
      async (e, t = `securityKey`) => {
        if ((A(null), await E.isLocked())) throw Error(b({ id: `Xvt-ni` }));
        let { blob: n } = await I(),
          {
            credentialId: r,
            salt: i,
            hmacSecret: a,
            synced: o,
          } = await Aa(e, { kind: t }),
          s = await E.generateSlotId(),
          c = await E.wrapVekWebauthn({
            hmacSecretB64: k(a),
            slotIdB64: s,
            magicVersion: w(),
          }),
          l = la(n, {
            kind: 2,
            slotId: O(s),
            credentialId: r,
            salt: i,
            verifier: O(c.verifier),
            wrapIv: O(c.wrapIv),
            wrappedVek: O(c.wrappedVek),
          });
        await T.writeVaultBlob(Ue(l));
        let u = { ...P.current.webauthnKeyLabels };
        ((u[s] = {
          label:
            e.trim() || (t === `platform` ? `This device` : `Security key`),
          addedAt: Date.now(),
          kind: t,
          synced: o,
        }),
          await T.setMeta(vs, u),
          await L());
      },
      [E, I, T, L, b],
    ),
    Mt = (0, Q.useCallback)(
      async (e) => {
        A(null);
        let { blob: t } = await I(),
          n = ua(t, O(e));
        await T.writeVaultBlob(Ue(n));
        let r = { ...P.current.webauthnKeyLabels };
        (delete r[e], await T.setMeta(vs, r), await L());
      },
      [I, T, L],
    ),
    Nt = (0, Q.useCallback)(
      async (e, i = ``) => {
        A(null);
        let a = ae.length === 0,
          s = await se(i);
        (a && (await u.resetSyncState?.()), await u.setActiveVault?.(s));
        let c = o.withVault?.(s) ?? o;
        await c.generateVek();
        let l = await t(c, e),
          d = Qi(),
          f = await n(c, $i(d)),
          p = await r(c, [l, f], ue());
        return (
          await T.writeVaultBlob(p, s),
          (F.current = {
            ...xs(),
            ...(c.notifyExternalChange
              ? { diskSeen: oe(p).entriesCiphertext }
              : {}),
          }),
          lt(s),
          ht(Ss),
          pt(void 0),
          _t([]),
          ge(!0),
          Re([]),
          we(!1),
          d
        );
      },
      [ae, se, u, T, o, lt],
    ),
    V = (0, Q.useMemo)(() => (_ && x ? _.forVault(x) : null), [_, x]),
    Pt = (0, Q.useCallback)(async () => {
      if (!u.exportBytes) throw Error(b({ id: `Mxuz20` }));
      let e = await ee({
          vault: await T.readVaultBlob(),
          blobs: V?.blobs ?? null,
          decryptWithVek: (e, t) => E.decryptWithVek(e, t),
        }),
        t = new Date().toISOString().slice(0, 10);
      await u.exportBytes(
        `bramble-vault-${t}.bramble`,
        e.body,
        `application/octet-stream`,
      );
    }, [u, T, E, V, b]),
    Ft = (0, Q.useCallback)(
      async (e) => {
        if (!u.exportBytes) throw Error(b({ id: `Mxuz20` }));
        if (!E.saveKdbx) throw Error(b({ id: `McBy_a` }));
        if (!e) throw Error(b({ id: `ZbRXo5` }));
        if (!x) throw Error(b({ id: `McBy_a` }));
        let t = await Kr(
          Sr(P.current.entries),
          vt.current,
          b({ id: `w_Sphq` }),
          (e) => {
            if (!V) throw Error(`this platform cannot store file attachments`);
            return V.sealer.describe(e);
          },
        );
        for (let { record: e } of t.files)
          if (!(await V?.blobs.has(e.hash))) throw Error(b({ id: `G1fz4x` }));
        let n = `bramble-vault-${new Date().toISOString().slice(0, 10)}.kdbx`,
          r = await E.saveKdbx({ ...t, vaultId: x, name: n, password: e });
        try {
          await u.exportBytes(n, r, `application/octet-stream`);
        } finally {
          await r.release?.().catch(() => {});
        }
      },
      [u, E, V, x, b],
    ),
    It = (0, Q.useCallback)(async () => {
      if (!m) throw Error(b({ id: `4o_6aw` }));
      let e = await Vr(m, P.current.entries, u.appName);
      return vt.current.length > 0 ? [b({ id: `J9AYag` }), ...e] : e;
    }, [m, u.appName, b]),
    H = (0, Q.useMemo)(
      () =>
        Gi({
          crypto: E,
          storage: T,
          autofill: l,
          readDecodedBlob: I,
          clock: yt,
          onDiskMerged: () => st.current(),
        }),
      [E, T, l, I, yt],
    ),
    Lt = (0, Q.useMemo)(
      () =>
        V ? Ni({ sealer: V.sealer, persist: H.persist, clock: yt }) : null,
      [V, H, yt],
    ),
    U = (0, Q.useCallback)(() => {
      if (it.current !== Cs(P.current.activeId))
        throw Error(`the open vault has not finished loading`);
      return { entries: P.current.entries, ...F.current };
    }, []),
    W = (0, Q.useCallback)((e) => {
      let { entries: t, ...n } = e;
      ((F.current = n),
        ht(Ui(e)),
        (P.current = { ...P.current, entries: e.entries }),
        pt(e.settings),
        _t(
          e.manifest ? nt(e.manifest, new Set(e.entries.map((e) => e.id))) : [],
        ),
        Re(e.entries));
    }, []),
    Rt = (0, Q.useCallback)(async (e) => W(await H.add(U(), e)), [H, U, W]),
    zt = Lt !== null,
    Bt = (0, Q.useCallback)(() => {
      if (!Lt) throw Error(`this platform cannot store file attachments`);
      return Lt;
    }, [Lt]),
    Vt = (0, Q.useCallback)(
      async (e) => W(await Bt().attach(U(), e)),
      [Bt, U, W],
    ),
    Ht = (0, Q.useCallback)(
      async (e) => W(await Bt().detach(U(), e)),
      [Bt, U, W],
    ),
    Ut = (0, Q.useCallback)(
      async (e, t) => W(await Bt().rename(U(), e, t)),
      [Bt, U, W],
    ),
    G = (0, Q.useCallback)(
      async (e) => {
        if (!V) throw Error(`this platform cannot store file attachments`);
        return V.sealer.describe(e);
      },
      [V],
    ),
    Wt = !!V?.present,
    Gt = !!V?.save,
    Kt = !!V?.pick,
    qt = (0, Q.useCallback)(async () => {
      if (!V?.pick) throw Error(`this platform has no file dialog of its own`);
      return V.pick();
    }, [V]),
    K = (0, Q.useCallback)(
      async (e) => {
        if (!V?.present) throw Error(`this platform cannot open attachments`);
        await V.present(e);
      },
      [V],
    ),
    Jt = (0, Q.useCallback)(
      async (e) => {
        if (!V?.save) throw Error(`this platform cannot save attachments`);
        return V.save(e);
      },
      [V],
    ),
    Yt = (0, Q.useCallback)(async (e) => !!(await V?.blobs.has(e.hash)), [V]),
    q = (0, Q.useCallback)(
      async (e) => (await V?.transferStatus?.(e)) ?? {},
      [V],
    ),
    J = (0, Q.useCallback)(
      async (e, t = [], n) => {
        let r = [],
          i = V?.sealer;
        for (let n of t) {
          if (!i) throw Error(`this platform cannot store file attachments`);
          let t = await ji(i, n);
          r.push(
            `item` in n.onto
              ? { sealed: t, item: e.indexOf(n.onto.item) }
              : { sealed: t, entryId: n.onto.entryId },
          );
        }
        return (
          W(await H.importMany(U(), e, r, n)),
          r.map((e) => e.sealed.hash)
        );
      },
      [H, U, W, V],
    ),
    Xt = (0, Q.useCallback)((e) => {
      let t = P.current.entries.find((t) => t.id === e),
        n = F.current.stamps.get(e);
      return t && n ? { hlc: n, ...F.current.causal.get(e), data: t } : void 0;
    }, []),
    Zt = (0, Q.useCallback)(
      async (e, t, n) => {
        let r = await H.update(U(), e, t, n);
        W(r);
      },
      [H, U, W, z],
    ),
    Qt = (0, Q.useCallback)(async (e) => W(await H.remove(U(), e)), [H, U, W]),
    $t = (0, Q.useCallback)(
      async (e) => W(await H.removeMany(U(), e)),
      [H, U, W],
    ),
    en = (0, Q.useCallback)(
      async (e, t) => W(await H.setArchived(U(), e, t)),
      [H, U, W],
    ),
    tn = (0, Q.useCallback)(
      async (e, t) => W(await H.setTags(U(), e, t)),
      [H, U, W],
    ),
    nn = (0, Q.useCallback)(async (e) => W(await H.touch(U(), e)), [H, U, W]),
    rn = (0, Q.useCallback)(
      async (e, t) => W(await H.setBreach(U(), e, t)),
      [H, U, W],
    ),
    an = (0, Q.useCallback)(
      async (e) => {
        let t = F.current.conflicts
            .filter((t) => t.id === e)
            .sort((e, t) => pe(t.hlc, e.hlc)),
          n = await E.decryptEntries(
            t.map(({ ciphertext: e, iv: t, wrappedDek: n, dekIv: r }) => ({
              ciphertext: e,
              iv: t,
              wrappedDek: n,
              dekIv: r,
            })),
          );
        return t.flatMap((e, t) => {
          let r = n[t];
          return r == null ? [] : [{ hlc: e.hlc, data: ze(JSON.parse(r)) }];
        });
      },
      [E],
    ),
    on = (0, Q.useCallback)(
      async (e, t) => {
        let n = await an(e),
          r = () => new ys(b({ id: `7-FUGl` }));
        if (
          !bs(
            n.map((e) => e.hlc),
            t.seen,
          )
        )
          throw r();
        let i = n.map((e) => e.data);
        if (t.kind === `keep`) {
          W(await H.resolve(U(), e, { kind: `keep`, superseded: i }));
          return;
        }
        let a = n.find((e) => pe(e.hlc, t.hlc) === 0);
        if (!a) throw r();
        let o = n.filter((e) => e !== a).map((e) => e.data),
          s = P.current.entries.find((t) => t.id === e);
        W(
          await H.resolve(
            U(),
            e,
            t.kind === `use`
              ? {
                  kind: `use`,
                  data: a.data,
                  superseded: [...(s ? [s] : []), a.data, ...o],
                  version: F.current.conflicts.find(
                    (t) => t.id === e && pe(t.hlc, a.hlc) === 0,
                  ),
                }
              : { kind: `keepBoth`, data: a.data, superseded: o },
          ),
        );
      },
      [H, U, W, an, b],
    ),
    sn = (0, Q.useCallback)(() => P.current.entries, []),
    cn = (0, Q.useCallback)((e) => U().settings?.[e]?.value, [U]),
    ln = (0, Q.useCallback)(
      async (e, t) => {
        W(await H.setSetting(U(), e, t));
      },
      [H, U, W],
    ),
    un = (0, Q.useCallback)(
      async (e) => {
        let { blob: t } = await I(),
          n = _e(t);
        return n
          ? E.verifyPasswordSlot({
              password: e,
              saltB64: k(n.salt),
              slotIdB64: k(n.slotId),
              verifierB64: k(n.verifier),
              magicVersion: w(),
            })
          : !1;
      },
      [E, I],
    ),
    dn = (0, Q.useCallback)(
      async (e) => {
        let { blob: t } = await I(),
          n = $i(e);
        for (let e of ve(t))
          if (
            await E.verifyPasswordSlot({
              password: n,
              saltB64: k(e.salt),
              slotIdB64: k(e.slotId),
              verifierB64: k(e.verifier),
              magicVersion: w(),
            })
          )
            return !0;
        return !1;
      },
      [E, I],
    ),
    fn = (0, Q.useCallback)(
      async (e) => {
        let { blob: t } = await I(),
          n = da(t, await Et(e));
        await T.writeVaultBlob(Ue(n));
        try {
          let { blob: t } = await I(),
            n = _e(t);
          if (!(
            n != null &&
            (await E.verifyPasswordSlot({
              password: e,
              saltB64: k(n.salt),
              slotIdB64: k(n.slotId),
              verifierB64: k(n.verifier),
              magicVersion: w(),
            }))
          ))
            throw Error(`password slot failed post-write verify`);
        } catch {
          throw (
            await T.restoreVaultFromBackup().catch(() => !1),
            Error(b({ id: `MDuYaU` }))
          );
        }
        await L();
      },
      [I, Et, T, E, L, b],
    ),
    pn = (0, Q.useCallback)(
      async (e) => {
        if ((A(null), await E.isLocked())) throw Error(b({ id: `aNbY1N` }));
        let { blob: t } = await I();
        if (!_e(t)) throw Error(b({ id: `TmdqsJ` }));
        await fn(e);
      },
      [E, I, fn, b],
    ),
    mn = (0, Q.useCallback)(
      async (e) => {
        if ((A(null), await E.isLocked())) throw Error(b({ id: `6-2_m6` }));
        await fn(e);
      },
      [E, fn, b],
    ),
    hn = (0, Q.useCallback)(async () => {
      if ((A(null), await E.isLocked())) throw Error(b({ id: `rsqvl9` }));
      if ((await T.getMeta(C(`sync.group`))) != null)
        throw Error(b({ id: `IcHBrb` }));
      let { blob: e } = await I(),
        t = fa(e);
      (await T.writeVaultBlob(Ue(t)), await L());
    }, [E, I, T, C, L, b]),
    gn = (0, Q.useCallback)(
      async (e) => {
        if ((A(null), await E.isLocked())) throw Error(b({ id: `yQjjbo` }));
        if (!(await un(e))) throw Error(b({ id: `GS6g8Z` }));
        if ((F.current.manifest?.files?.length ?? 0) > 0)
          throw Error(b({ id: `BbBSk8` }));
        let { blob: t } = await I(),
          n = U(),
          r = await H.openConflicts(n);
        await E.rotateVek();
        let i,
          a = [];
        try {
          let { conflicts: o, ...s } = await H.sealAll(n, r);
          ((a = o), (i = Qi()));
          let c = pa(da({ ...t, ...s }, await Et(e)), await Dt(i)),
            l = c.slots.filter((e) => e.kind !== 2);
          await T.writeVaultBlob(Ue({ ...c, slots: l }));
          let { blob: u } = await I(),
            d = _e(u);
          if (!(
            d != null &&
            (await E.verifyPasswordSlot({
              password: e,
              saltB64: k(d.salt),
              slotIdB64: k(d.slotId),
              verifierB64: k(d.verifier),
              magicVersion: w(),
            }))
          ))
            throw Error(`rotated password slot failed post-write verify`);
          await E.decryptWithVek(k(u.entriesIv), k(u.entriesCiphertext));
        } catch (e) {
          throw (
            console.error(`[vault] rotation failed; restoring`, e),
            await T.restoreVaultFromBackup().catch(() => !1),
            await E.lock().catch(() => {}),
            we(!0),
            Error(b({ id: `0ZZjl5` }))
          );
        }
        return (
          (F.current = { ...F.current, conflicts: a }),
          await L().catch(() => {}),
          await z().catch(() => {}),
          i
        );
      },
      [E, b, un, I, U, H, Et, Dt, T, L, z],
    ),
    _n = (0, Q.useCallback)(async () => {
      if ((A(null), await E.isLocked())) throw Error(b({ id: `MTkSic` }));
      let { blob: e } = await I(),
        t = Qi(),
        n = pa(e, await Dt(t));
      return (await T.writeVaultBlob(Ue(n)), await L(), t);
    }, [E, I, Dt, T, L, b]),
    vn = (0, Q.useCallback)(
      async (e) => {
        A(null);
        let t;
        try {
          let { blob: e } = await I();
          t = ve(e);
        } catch (e) {
          throw (
            console.error(`[vault] failed to read vault blob:`, e),
            Error(b({ id: `1AcyHt` }))
          );
        }
        if (t.length === 0) throw Error(b({ id: `GYMh_T` }));
        await u.setActiveVault?.(x ?? null);
        let n = $i(e),
          r = !1;
        for (let e of t)
          if (
            await E.unwrapVekPassword({
              password: n,
              saltB64: k(e.salt),
              slotIdB64: k(e.slotId),
              verifierB64: k(e.verifier),
              wrapIvB64: k(e.wrapIv),
              wrappedVekB64: k(e.wrappedVek),
              magicVersion: w(),
            })
          ) {
            r = !0;
            break;
          }
        if (!r) throw Error(b({ id: `I7BlZ6` }));
        (await St(x ?? null),
          we(!1),
          Ze(!0),
          u.flushPendingCornerCapture().catch(() => {}));
      },
      [I, E, St, u, x, b],
    ),
    yn = (0, Q.useCallback)(async () => {
      if (d)
        try {
          let [e, t, n, r] = await Promise.all([
            d.isAvailable(),
            x ? d.isEnabled(x) : Promise.resolve(!1),
            d.biometryType?.() ?? Promise.resolve(`biometric`),
            d.biometryEnrolled?.() ?? d.isAvailable(),
          ]);
          (Oe(e), Ae(t), Me(n), Pe(r));
        } catch (e) {
          console.error(`[vault] biometric state probe failed:`, e);
        }
    }, [d, x]);
  (0, Q.useEffect)(() => {
    yn();
  }, [yn]);
  let bn = (0, Q.useCallback)(
      async (e) => {
        if (!d) throw Error(b({ id: `M0wnru` }));
        if (P.current.isLocked) throw Error(b({ id: `eyodxm` }));
        if (!x) throw Error(b({ id: `lBUbSS` }));
        (await Zr(E, d, x, e), Ae(!0));
      },
      [d, E, x, b],
    ),
    xn = (0, Q.useCallback)(
      async (e) => {
        d &&
          x &&
          (await ei({ crypto: E, biometric: d, vaultId: x, allowPasscode: e }));
      },
      [d, E, x],
    ),
    Sn = (0, Q.useCallback)(async () => {
      d && x && (await d.disable(x), Ae(!1));
    }, [d, x]),
    Cn = (0, Q.useCallback)(
      async (e) => {
        if (!d) throw Error(b({ id: `M0wnru` }));
        if (!x) throw Error(b({ id: `lBUbSS` }));
        (A(null),
          await ti({
            crypto: E,
            biometric: d,
            vaultId: x,
            allowPasscode: e,
            loadEntries: z,
            onStaleCache: () => Ae(!1),
          }),
          u.notifyVaultOpened?.(x),
          we(!1),
          u.flushPendingCornerCapture().catch(() => {}));
      },
      [d, E, z, u, x, b],
    ),
    {
      inviteDevice: wn,
      joinGroup: Tn,
      removeDevice: En,
      ensureOwnEntrySigned: Dn,
    } = gs({
      storage: T,
      syncKey: C,
      ensureClock: yt,
      rotateDeviceId: bt,
      readDecodedBlob: I,
      unlock: wt,
      readEntriesPayload: H.readEntriesPayload,
    }),
    On = (0, Q.useRef)(new Set());
  (0, Q.useEffect)(() => {
    !D &&
      x &&
      (On.current.has(x) ||
        (On.current.add(x),
        Dn().catch((e) => {
          (On.current.delete(x),
            console.warn(
              `[vault] roster signature backfill failed; will retry on next unlock:`,
              e,
            ));
        })));
  }, [D, x, Dn]);
  let [kn, An] = (0, Q.useState)(null),
    [Y, jn] = (0, Q.useState)(null),
    Mn = (0, Q.useRef)(null),
    Nn = (0, Q.useRef)(!1),
    Pn = (0, Q.useRef)(null),
    Fn = (0, Q.useCallback)(
      (e, t, n, r) => {
        if (Pn.current) return Pn.current;
        let i = (async () => {
          jn(null);
          let i = be(e.trim());
          for (let e of ae)
            if (
              (await T.getMeta(f(`sync.group`, e.id)))?.groupKey === i.groupKey
            )
              return (fe(e.id), e.id);
          let a = await se(n);
          return (
            await u.setActiveVault?.(a),
            new Promise((n, i) => {
              ((Mn.current = { resolve: () => n(a), reject: i }),
                An({ code: e, method: t, targetId: a, viaLink: r?.viaLink }));
            })
          );
        })();
        return (
          (Pn.current = i),
          i
            .catch(() => {})
            .finally(() => {
              Pn.current = null;
            }),
          i
        );
      },
      [ae, T, se, u, fe],
    );
  (0, Q.useEffect)(() => {
    if (!kn || x !== kn.targetId || !S || Nn.current) return;
    Nn.current = !0;
    let { code: e, method: t, viaLink: n } = kn;
    (async () => {
      try {
        (await Tn(e, t, { viaLink: n }),
          ge(!0),
          An(null),
          Mn.current?.resolve());
      } catch (e) {
        (await le().catch(() => {}),
          An(null),
          jn(e.message ?? String(e)),
          Mn.current?.reject(e));
      } finally {
        ((Nn.current = !1), (Mn.current = null));
      }
    })();
  }, [kn, x, S, Tn, le]);
  let In = Ge.length > 0,
    Ln = (0, Q.useMemo)(() => ca(Ge, N, k), [Ge, N]),
    Rn = (0, Q.useMemo)(
      () => ({
        hasVault: he,
        isLocked: D,
        lockedByUser: Te,
        ready: Fe,
        joining: kn !== null,
        joinError: Y,
        files: gt,
        canAttachFiles: zt,
        canOpenFiles: Wt,
        canSaveFiles: Gt,
        canPickFiles: Kt,
        entries: Be,
        unlockKeys: Ve,
        conflicts: mt,
        error: We,
        vaultError: $e,
        hasWebauthnSlot: In,
        hasPasswordSlot: M,
        hasRecoveryCode: Je,
        unlockedWithRecoveryCode: Xe,
        webauthnKeys: Ln,
        biometricSupported: d !== void 0,
        biometricAvailable: De,
        biometricEnabled: ke,
        biometryType: je,
        biometryEnrolled: Ne,
      }),
      [
        he,
        D,
        Te,
        Fe,
        kn,
        Y,
        gt,
        zt,
        Wt,
        Gt,
        Kt,
        Be,
        Ve,
        mt,
        We,
        $e,
        In,
        M,
        Je,
        Xe,
        Ln,
        d,
        De,
        ke,
        je,
        Ne,
      ],
    ),
    zn = (0, Q.useCallback)(
      async (e) => {
        (await T.deleteVaultBlob(e).catch(() => {}),
          await _?.deleteVault(e).catch(() => {}),
          await d?.disable(e).catch(() => {}),
          await y?.forgetVault?.(e).catch(() => {}));
        for (let t of s) await T.removeMeta(f(t, e)).catch(() => {});
        for (let t of as) await T.removeMeta(f(t, e)).catch(() => {});
        let t = (await T.getMeta(c(e)).catch(() => void 0)) ?? [];
        for (let n of t) await g?.remove(e, n.id).catch(() => {});
        (await T.removeMeta(c(e)).catch(() => {}),
          await T.removeMeta(p(e)).catch(() => {}),
          await T.removeMeta(v(e)).catch(() => {}));
      },
      [T, d, g, _, y],
    ),
    Bn = (0, Q.useCallback)(
      async (e) =>
        !(`password` in e ? await un(e.password) : await At()) || !x
          ? !1
          : (await Tt(),
            await l.clearProviderData?.().catch(() => {}),
            await zn(x),
            await le(),
            await u.setActiveVault?.(null),
            !0),
      [un, At, x, Tt, le, u, l, zn],
    ),
    Vn = (0, Q.useCallback)(
      async (e, t, n, r) =>
        e === x ||
        !ut(await ft(T, e, t, n)) ||
        (r && !_i(await T.readVaultBlob(e), r))
          ? !1
          : (await zn(e), await de(e), !0),
      [x, T, zn, de],
    ),
    X = (0, Q.useCallback)(async () => {
      let e = await vi({
          crypto: E,
          storage: T,
          readDecodedBlob: I,
        }).readEntriesPayload(),
        t = await E.decryptEntries(
          e.entries.map(
            ({ ciphertext: e, iv: t, wrappedDek: n, dekIv: r }) => ({
              ciphertext: e,
              iv: t,
              wrappedDek: n,
              dekIv: r,
            }),
          ),
        ),
        n = [];
      return (
        e.entries.forEach((e, r) => {
          let i = t[r];
          i != null && n.push({ id: e.id, ...ze(JSON.parse(i)) });
        }),
        {
          entries: n,
          files: xe(e),
          settings: e.settings,
          conflicted: Ui(Li(e, n)).size,
          unreadable: e.entries.length - n.length,
        }
      );
    }, [E, T, I]),
    Hn = (0, Q.useMemo)(
      () => ({
        unlock: wt,
        lock: Tt,
        createVault: Nt,
        deleteVault: Bn,
        deleteEmptyVault: Vn,
        readOpenVaultFromDisk: X,
        exportVault: Pt,
        exportKdbx: Ft,
        exportToApp: It,
        attachFile: Vt,
        detachFile: Ht,
        renameFile: Ut,
        describeFile: G,
        openFile: K,
        saveFile: Jt,
        hasFile: Yt,
        fileStatus: q,
        pickFile: qt,
        addEntry: Rt,
        importEntries: J,
        openVersion: Xt,
        updateEntry: Zt,
        deleteEntry: Qt,
        deleteEntries: $t,
        setEntriesArchived: en,
        setEntriesTags: tn,
        touchEntry: nn,
        setEntryBreach: rn,
        readConflictVersions: an,
        resolveConflict: on,
        readEntries: sn,
        readSetting: cn,
        writeSetting: ln,
        verifyMasterPassword: un,
        verifyRecoveryCode: dn,
        verifyWithWebauthnKey: At,
        changeMasterPassword: pn,
        setMasterPassword: mn,
        disableMasterPassword: hn,
        unlockWithWebauthnKey: kt,
        registerWebauthnKey: jt,
        revokeWebauthnKey: Mt,
        generateRecoveryCode: _n,
        rotateSecret: gn,
        unlockWithRecoveryCode: vn,
        enableBiometric: bn,
        disableBiometric: Sn,
        rearmBiometric: xn,
        unlockWithBiometric: Cn,
        refreshBiometric: yn,
        inviteDevice: wn,
        joinGroup: Tn,
        startJoin: Fn,
        removeDevice: En,
      }),
      [
        wt,
        Tt,
        Nt,
        Bn,
        Vn,
        X,
        Pt,
        Ft,
        It,
        Vt,
        Ht,
        Ut,
        G,
        K,
        Jt,
        Yt,
        q,
        qt,
        Rt,
        J,
        Xt,
        Zt,
        Qt,
        $t,
        en,
        tn,
        nn,
        rn,
        an,
        on,
        sn,
        cn,
        ln,
        un,
        dn,
        At,
        pn,
        mn,
        hn,
        kt,
        jt,
        Mt,
        _n,
        gn,
        vn,
        bn,
        Sn,
        xn,
        Cn,
        yn,
        wn,
        Tn,
        Fn,
        En,
      ],
    );
  (0, Q.useEffect)(() => {
    if (!x) return;
    let e = h(dt, D, Bo);
    e !== null && T.setMeta(v(x), e).catch(() => {});
  }, [T, x, D, dt]);
  let Un = (0, Q.useMemo)(
    () => ({ settings: dt, ready: !D && at === Cs(x), set: ln }),
    [dt, D, at, x, ln],
  );
  return (0, $.jsx)(Ts.Provider, {
    value: Hn,
    children: (0, $.jsx)(ws.Provider, {
      value: Rn,
      children: (0, $.jsx)(ja.Provider, { value: Un, children: e }),
    }),
  });
}
function Ds() {
  let e = (0, Q.useContext)(ws);
  if (!e) throw Error(`useVaultState called outside VaultProvider`);
  return e;
}
function Os() {
  let e = (0, Q.useContext)(Ts);
  if (!e) throw Error(`useVaultActions called outside VaultProvider`);
  return e;
}
function ks() {
  return { ...Ds(), ...Os() };
}
var As = { md: `text-[0.66rem]`, sm: `text-[0.5625rem]` },
  js = {
    input: [
      `group-has-[input:focus]:max-w-full`,
      `group-has-[input:not(:placeholder-shown)]:max-w-full`,
    ],
    textarea: [
      `group-focus-within:max-w-full`,
      `group-has-[textarea:not(:placeholder-shown)]:max-w-full`,
    ],
    always: [],
  };
function Ms({ label: e, invalid: t, notch: n, size: r = `md`, className: i }) {
  return (0, $.jsx)(`fieldset`, {
    "aria-hidden": !0,
    className: S(
      `pointer-events-none absolute inset-0 rounded-md border border-input-border px-2 m-0 transition-colors`,
      `peer-focus:border-primary`,
      t && `border-destructive peer-focus:border-destructive`,
      i,
    ),
    children: (0, $.jsx)(`legend`, {
      className: S(
        `block invisible h-0 overflow-hidden whitespace-nowrap`,
        As[r],
        n === `always`
          ? `max-w-full`
          : [`max-w-[0.01px]`, `transition-[max-width] duration-150`, ...js[n]],
      ),
      children: (0, $.jsx)(`span`, { className: `px-1`, children: e }),
    }),
  });
}
var Ns = {
    md: {
      input: `px-3 pt-3 pb-3 text-sm`,
      startPad: `pl-10`,
      startPos: `left-3`,
      endPad: `pr-10`,
      label: `text-sm left-3`,
      labelStart: `left-10`,
      float: `peer-focus:top-0 peer-focus:scale-75 peer-focus:left-3 peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:scale-75 peer-[:not(:placeholder-shown)]:left-3`,
    },
    sm: {
      input: `px-2.5 pt-2 pb-2 text-xs`,
      startPad: `pl-8`,
      startPos: `left-2.5`,
      endPad: `pr-8`,
      label: `text-xs left-2.5`,
      labelStart: `left-8`,
      float: `peer-focus:top-0 peer-focus:scale-75 peer-focus:left-2.5 peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:scale-75 peer-[:not(:placeholder-shown)]:left-2.5`,
    },
  },
  Ps = (0, Q.forwardRef)(function (
    {
      label: e,
      error: t,
      className: n,
      type: r,
      disabled: i,
      startAdornment: a,
      endAdornment: o,
      size: s = `md`,
      ...c
    },
    l,
  ) {
    let u = (0, Q.useId)(),
      d = !!t,
      f = Ns[s];
    return (0, $.jsxs)(`div`, {
      children: [
        (0, $.jsxs)(`div`, {
          className: `group relative`,
          children: [
            a &&
              (0, $.jsx)(`div`, {
                className: S(
                  `pointer-events-none absolute top-1/2 -translate-y-1/2 text-muted-foreground flex items-center z-10`,
                  f.startPos,
                ),
                children: a,
              }),
            (0, $.jsx)(`input`, {
              ref: l,
              id: u,
              type: r,
              disabled: i,
              placeholder: ` `,
              "aria-invalid": d || void 0,
              className: S(
                `peer relative block w-full appearance-none bg-transparent text-foreground`,
                f.input,
                `placeholder-transparent outline-none`,
                `disabled:opacity-50 disabled:cursor-not-allowed`,
                a && f.startPad,
                o && f.endPad,
                n,
              ),
              ...c,
            }),
            (0, $.jsx)(Ms, { label: e, invalid: d, notch: `input`, size: s }),
            (0, $.jsx)(`label`, {
              htmlFor: u,
              className: S(
                `pointer-events-none absolute top-1/2 -translate-y-1/2 origin-[0]`,
                `text-muted-foreground transition-all duration-150`,
                f.label,
                a && f.labelStart,
                f.float,
                `peer-focus:text-primary`,
                d && `text-destructive peer-focus:text-destructive`,
              ),
              children: e,
            }),
            o &&
              (0, $.jsx)(`div`, {
                className: `absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10`,
                children: o,
              }),
          ],
        }),
        t &&
          (0, $.jsx)(`p`, {
            className: `text-xs text-destructive mt-1`,
            children: t,
          }),
      ],
    });
  });
export {
  Tr as $,
  Va as A,
  R as At,
  wi as B,
  lt as Bt,
  to as C,
  ht as Ct,
  ao as D,
  Tt as Dt,
  ro as E,
  yt as Et,
  Ma as F,
  dt as Ft,
  mi as G,
  yi as H,
  ha as I,
  ut as It,
  gi as J,
  hi as K,
  va as L,
  ft as Lt,
  Ga as M,
  Dt as Mt,
  Pa as N,
  Ct as Nt,
  La as O,
  wt as Ot,
  Na as P,
  Et as Pt,
  Br as Q,
  ya as R,
  st as Rt,
  no as S,
  en as St,
  eo as T,
  St as Tt,
  Si as U,
  bi as V,
  di as W,
  $r as X,
  ui as Y,
  Yr as Z,
  po as _,
  vn as _t,
  _s as a,
  bn as at,
  Ya as b,
  on as bt,
  Ds as c,
  zn as ct,
  Vo as d,
  En as dt,
  Kn as et,
  us as f,
  Tn as ft,
  xo as g,
  pn as gt,
  bo as h,
  un as ht,
  Es as i,
  Wn as it,
  Ua as j,
  z as jt,
  qa as k,
  I as kt,
  ps as l,
  Bn as lt,
  uo as m,
  dn as mt,
  Ms as n,
  Hn as nt,
  ks as o,
  Sn as ot,
  ds as p,
  fn as pt,
  _i as q,
  ys as r,
  X as rt,
  Os as s,
  Vn as st,
  Ps as t,
  Un as tt,
  Bo as u,
  Mn as ut,
  yo as v,
  ln as vt,
  $a as w,
  gt as wt,
  Qa as x,
  _n as xt,
  fo as y,
  sn as yt,
  Ti as z,
  ct as zt,
};
