const __vite__mapDeps = (
  i,
  m = __vite__mapDeps,
  d = m.f ||
    (m.f = [
      "chunks/wordlist-eff-CgqBt_LE.js",
      "chunks/build-vault-Dl7gFnhh.js",
      "chunks/messages-DLCDPx8W.js",
    ]),
) => i.map((i) => d[i]);
import {
  At as e,
  E as t,
  St as n,
  Tt as r,
  _n as i,
  dn as a,
  en as o,
  gn as s,
  hn as c,
  in as l,
  kt as u,
  on as d,
  un as f,
  vn as p,
  vt as m,
  xn as h,
  yn as g,
  yt as _,
} from "./messages-DLCDPx8W.js";
var v = `vek_session_changed`,
  y = `vek_persistence_failed`,
  b = `VAULT_OPEN_FAILED`,
  x = `transfer/interrupted`,
  S = 4194304;
async function C(e) {
  let t = [];
  for (let n = 0; n < e.size; n += S)
    t.push(new Blob([await e.read(n, Math.min(S, e.size - n))]));
  return new Blob(t);
}
var w = {
    async send({ method: e, url: t, headers: n, body: r }) {
      let i = await fetch(t, {
        method: e,
        headers: n,
        body: r && !(r instanceof Uint8Array) ? await C(r) : r,
        credentials: `omit`,
        redirect: `manual`,
      });
      return {
        status: i.status,
        ok: i.ok,
        body: new Uint8Array(await i.arrayBuffer()),
        headers: Object.fromEntries(i.headers),
      };
    },
  },
  T = new TextEncoder();
async function E(e, t) {
  let n = await crypto.subtle.importKey(
    `raw`,
    new Uint8Array(e),
    { name: `HMAC`, hash: `SHA-256` },
    !1,
    [`sign`],
  );
  return new Uint8Array(await crypto.subtle.sign(`HMAC`, n, T.encode(t)));
}
function D(e, t = !0) {
  let n = ``;
  for (let r of e)
    if (/[A-Za-z0-9\-._~]/.test(r)) n += r;
    else if (r === `/` && !t) n += `/`;
    else
      for (let e of T.encode(r))
        n += `%${e.toString(16).toUpperCase().padStart(2, `0`)}`;
  return n;
}
function O(e) {
  let t = e;
  try {
    t = decodeURIComponent(e);
  } catch {}
  return D(t, !1);
}
function ee(e) {
  let t = [...e].map(([e, t]) => [D(e), D(t)]);
  return (
    t.sort((e, t) =>
      e[0] < t[0] ? -1 : e[0] > t[0] ? 1 : e[1] < t[1] ? -1 : +(e[1] > t[1]),
    ),
    t.map(([e, t]) => `${e}=${t}`).join(`&`)
  );
}
function te() {
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g, ``);
}
async function ne(e) {
  let t = e.service ?? `s3`,
    n = new URL(e.url),
    r = e.amzDate ?? te(),
    i = r.slice(0, 8),
    a = await _(e.body ?? ``),
    o = { host: n.host, "x-amz-content-sha256": a, "x-amz-date": r };
  for (let [t, n] of Object.entries(e.headers ?? {})) o[t.toLowerCase()] = n;
  let s = Object.keys(o).sort(),
    c = s.map((e) => `${e}:${(o[e] ?? ``).trim()}\n`).join(``),
    l = s.join(`;`),
    u = [e.method, O(n.pathname), ee(n.searchParams), c, l, a].join(`
`),
    f = `${i}/${e.credentials.region}/${t}/aws4_request`,
    p = [`AWS4-HMAC-SHA256`, r, f, await _(u)].join(`
`),
    m = await E(
      await E(
        await E(
          await E(T.encode(`AWS4${e.credentials.secretAccessKey}`), i),
          e.credentials.region,
        ),
        t,
      ),
      `aws4_request`,
    ),
    h = d(await E(m, p));
  return {
    headers: {
      ...(e.headers ?? {}),
      "x-amz-content-sha256": a,
      "x-amz-date": r,
      Authorization: `AWS4-HMAC-SHA256 Credential=${e.credentials.accessKeyId}/${f}, SignedHeaders=${l}, Signature=${h}`,
    },
  };
}
var k = class extends Error {},
  A = 67324752,
  re = 33639248,
  ie = 101010256,
  ae = 101075792,
  oe = 117853008,
  se = 1,
  j = 4294967295,
  ce = 65535,
  M = 22,
  le = 56,
  ue = 20,
  de = 10273,
  fe = 0,
  pe = 813,
  me = (33188 << 16) >>> 0,
  N = null;
function he() {
  if (N) return N;
  N = new Uint32Array(256);
  for (let e = 0; e < 256; e++) {
    let t = e;
    for (let e = 0; e < 8; e++) t = t & 1 ? 3988292384 ^ (t >>> 1) : t >>> 1;
    N[e] = t >>> 0;
  }
  return N;
}
function ge() {
  let e = he(),
    t = j;
  return {
    update(n) {
      for (let r = 0; r < n.length; r++) t = e[(t ^ n[r]) & 255] ^ (t >>> 8);
    },
    get value() {
      return (t ^ j) >>> 0;
    },
  };
}
var _e = class {
    bytes;
    view;
    at = 0;
    constructor(e) {
      ((this.bytes = new Uint8Array(e)),
        (this.view = new DataView(this.bytes.buffer)));
    }
    u16(e) {
      (this.view.setUint16(this.at, e, !0), (this.at += 2));
    }
    u32(e) {
      (this.view.setUint32(this.at, e >>> 0, !0), (this.at += 4));
    }
    u64(e) {
      (this.view.setBigUint64(this.at, BigInt(e), !0), (this.at += 8));
    }
    raw(e) {
      (this.bytes.set(e, this.at), (this.at += e.length));
    }
  },
  ve = (e) => new TextEncoder().encode(e);
function ye(e, t = {}) {
  let n = [],
    r = (e) => {
      let t = n[n.length - 1];
      if (e.kind === `bytes` && t?.kind === `bytes`) {
        let r = new Uint8Array(t.bytes.length + e.bytes.length);
        (r.set(t.bytes),
          r.set(e.bytes, t.bytes.length),
          (n[n.length - 1] = { kind: `bytes`, bytes: r }));
      } else n.push(e);
    },
    i = [],
    a = 0;
  for (let n of e) {
    let e = ve(n.name),
      o = t.forceZip64 || n.size >= j,
      s = new _e(30 + e.length + (o ? 20 : 0));
    (s.u32(A),
      s.u16(o ? 45 : 10),
      s.u16(0),
      s.u16(0),
      s.u16(fe),
      s.u16(de),
      s.u32(n.crc),
      s.u32(o ? j : n.size),
      s.u32(o ? j : n.size),
      s.u16(e.length),
      s.u16(o ? 20 : 0),
      s.raw(e),
      o && (s.u16(se), s.u16(16), s.u64(n.size), s.u64(n.size)),
      r({ kind: `bytes`, bytes: s.bytes }),
      r(n.data),
      i.push({ name: e, size: n.size, crc: n.crc, offset: a }),
      (a += s.bytes.length + n.size));
  }
  let o = a,
    s = 0;
  for (let e of i) {
    let n = t.forceZip64 || e.size >= j,
      i = t.forceZip64 || e.offset >= j,
      a = (n ? 16 : 0) + (i ? 8 : 0),
      o = new _e(46 + e.name.length + (a ? 4 + a : 0));
    (o.u32(re),
      o.u16(pe),
      o.u16(n || i ? 45 : 10),
      o.u16(0),
      o.u16(0),
      o.u16(fe),
      o.u16(de),
      o.u32(e.crc),
      o.u32(n ? j : e.size),
      o.u32(n ? j : e.size),
      o.u16(e.name.length),
      o.u16(a ? 4 + a : 0),
      o.u16(0),
      o.u16(0),
      o.u16(0),
      o.u32(me),
      o.u32(i ? j : e.offset),
      o.raw(e.name),
      a &&
        (o.u16(se),
        o.u16(a),
        n && (o.u64(e.size), o.u64(e.size)),
        i && o.u64(e.offset)),
      r({ kind: `bytes`, bytes: o.bytes }),
      (s += o.bytes.length));
  }
  let c = o + s,
    l = t.forceZip64 || e.length >= ce || s >= j || o >= j || c >= j,
    u = new _e((l ? 76 : 0) + M);
  return (
    l &&
      (u.u32(ae),
      u.u64(44),
      u.u16(pe),
      u.u16(45),
      u.u32(0),
      u.u32(0),
      u.u64(e.length),
      u.u64(e.length),
      u.u64(s),
      u.u64(o),
      u.u32(oe),
      u.u32(0),
      u.u64(c),
      u.u32(1)),
    u.u32(ie),
    u.u16(0),
    u.u16(0),
    u.u16(l ? ce : e.length),
    u.u16(l ? ce : e.length),
    u.u32(l ? j : s),
    u.u32(l ? j : o),
    u.u16(0),
    r({ kind: `bytes`, bytes: u.bytes }),
    { size: c + u.bytes.length, parts: n }
  );
}
function be(e) {
  return { size: e.length, read: async (t, n) => e.subarray(t, t + n) };
}
var P = class {
    bytes;
    view;
    at = 0;
    constructor(e) {
      ((this.bytes = e),
        (this.view = new DataView(e.buffer, e.byteOffset, e.byteLength)));
    }
    need(e) {
      if (this.at + e > this.bytes.length) throw new k(`truncated record`);
    }
    u16() {
      this.need(2);
      let e = this.view.getUint16(this.at, !0);
      return ((this.at += 2), e);
    }
    u32() {
      this.need(4);
      let e = this.view.getUint32(this.at, !0);
      return ((this.at += 4), e);
    }
    u64() {
      this.need(8);
      let e = this.view.getBigUint64(this.at, !0);
      if (((this.at += 8), e > BigInt(2 ** 53 - 1)))
        throw new k(`size out of range`);
      return Number(e);
    }
    raw(e) {
      this.need(e);
      let t = this.bytes.subarray(this.at, this.at + e);
      return ((this.at += e), t);
    }
  },
  F = 67108864;
function xe(e, t) {
  let n = new P(e);
  for (; n.at < e.length;) {
    let e = n.u16(),
      r = n.u16(),
      i = new P(n.raw(r));
    if (e !== se) continue;
    let a = {};
    if (t.size) {
      let e = i.u64();
      if (e !== i.u64()) throw new k(`compressed entry`);
      a.size = e;
    }
    return (t.offset && (a.offset = i.u64()), a);
  }
  if (t.size || t.offset) throw new k(`missing ZIP64 field`);
  return {};
}
async function I(e) {
  if (e.size < M) throw new k(`too short`);
  let t = new P(await e.read(e.size - M, M));
  if (t.u32() !== ie) throw new k(`no end record (or a comment)`);
  if (t.u16() !== 0 || t.u16() !== 0) throw new k(`multi-disk archive`);
  let n = t.u16();
  if (t.u16() !== n) throw new k(`inconsistent entry count`);
  let r = t.u32(),
    i = t.u32();
  if (t.u16() !== 0) throw new k(`comment`);
  let a = e.size - M;
  if (n === ce || r === j || i === j) {
    if (e.size < 98) throw new k(`too short`);
    let t = new P(await e.read(e.size - M - ue, ue));
    if (t.u32() !== oe || t.u32() !== 0) throw new k(`no ZIP64 locator`);
    let o = t.u64();
    if (t.u32() !== 1) throw new k(`multi-disk archive`);
    if (o + le !== e.size - M - ue) throw new k(`misplaced ZIP64 end record`);
    let s = new P(await e.read(o, le));
    if (s.u32() !== ae || s.u64() !== 44) throw new k(`bad ZIP64 end record`);
    if ((s.u16(), s.u16(), s.u32() !== 0 || s.u32() !== 0))
      throw new k(`multi-disk archive`);
    if (((n = s.u64()), s.u64() !== n)) throw new k(`inconsistent entry count`);
    ((r = s.u64()), (i = s.u64()), (a = o));
  }
  if (i + r !== a) throw new k(`misplaced directory`);
  if (r > F) throw new k(`directory too large`);
  let o = new P(await e.read(i, r)),
    s = [],
    c = [],
    l = new Set();
  for (let t = 0; t < n; t++) {
    if (o.u32() !== re) throw new k(`bad directory entry`);
    if ((o.u16(), o.u16(), o.u16() & -2049))
      throw new k(`encrypted or streamed entry`);
    if (o.u16() !== 0) throw new k(`compressed entry`);
    (o.u16(), o.u16());
    let t = o.u32(),
      n = o.u32(),
      r = o.u32();
    if (n !== r) throw new k(`compressed entry`);
    let a = o.u16(),
      u = o.u16(),
      d = o.u16();
    if (o.u16() !== 0) throw new k(`multi-disk archive`);
    (o.u16(), o.u32());
    let f = o.u32(),
      p = o.raw(a),
      m = o.raw(u);
    o.raw(d);
    let h = new TextDecoder(`utf-8`, { fatal: !0 }).decode(p);
    if (l.has(h)) throw new k(`the same file twice`);
    l.add(h);
    let g = xe(m, { size: r === j, offset: f === j }),
      _ = g.size ?? r,
      v = g.offset ?? f,
      y = new P(await e.read(v, Math.min(30, e.size - v)));
    if (y.u32() !== A) throw new k(`bad local header`);
    if ((y.u16(), y.u16() & -2049)) throw new k(`encrypted or streamed entry`);
    if (y.u16() !== 0) throw new k(`compressed entry`);
    if ((y.u16(), y.u16(), y.u32() !== t))
      throw new k(`local header disagrees`);
    let b = y.u32(),
      x = y.u32(),
      S = y.u16(),
      C = y.u16(),
      w = new P(await e.read(v + 30, S + C)),
      T = w.raw(S);
    if (S !== a || T.some((e, t) => e !== p[t]))
      throw new k(`local header disagrees`);
    let E = w.raw(C);
    if (x === j || b === j) {
      if (xe(E, { size: !0, offset: !1 }).size !== _)
        throw new k(`local header disagrees`);
    } else if (x !== _ || b !== _) throw new k(`local header disagrees`);
    let D = v + 30 + S + C;
    if (D + _ > i) throw new k(`entry runs into the directory`);
    (s.push({ name: h, offset: D, size: _, crc: t }),
      c.push({ start: v, end: D + _ }));
  }
  if (o.at !== r) throw new k(`directory has trailing bytes`);
  c.sort((e, t) => e.start - t.start);
  for (let e = 1; e < c.length; e++)
    if (c[e].start < c[e - 1].end) throw new k(`entries overlap`);
  return s;
}
var Se = `vault.bramble`,
  Ce = `blobs/`,
  we = 94371840,
  Te = 536870912,
  Ee = 1048576,
  De = class extends Error {
    blocked;
    constructor(e) {
      (super(
        e.reason === `missing`
          ? `${e.count} attachment(s) are not on this device yet`
          : `the vault's attachment list cannot be read while it is locked`,
      ),
        (this.blocked = e));
    }
  };
async function Oe(t) {
  try {
    let i = e(t.vault);
    if (i.entriesCiphertext.length === 0) return [];
    let a = await t.decryptWithVek(l(i.entriesIv), l(i.entriesCiphertext));
    return n(r(a));
  } catch {
    return null;
  }
}
async function ke(e, t) {
  let n = await _(e),
    r = [...new Set(t)].sort();
  return r.length === 0 ? n : _(`${n}:${r.join(`,`)}`);
}
function Ae(e, t) {
  let n = [],
    r = 0;
  for (let t of e.parts)
    (n.push(r), (r += t.kind === `bytes` ? t.bytes.length : t.size));
  return {
    size: e.size,
    async read(r, i) {
      if (r < 0 || i < 0 || r + i > e.size)
        throw RangeError(`read past the end of the backup`);
      let a = new Uint8Array(i),
        o = 0,
        s = 0,
        c = n.length - 1;
      for (; s < c;) {
        let e = (s + c + 1) >> 1;
        n[e] <= r ? (s = e) : (c = e - 1);
      }
      for (let c = s; o < i; c++) {
        let s = e.parts[c];
        if (!s) throw RangeError(`read past the end of the backup`);
        let l = n[c],
          u = s.kind === `bytes` ? s.bytes.length : s.size,
          d = Math.max(0, r + o - l),
          f = Math.min(u - d, i - o);
        if (!(f <= 0)) {
          if (s.kind === `bytes`) a.set(s.bytes.subarray(d, d + f), o);
          else {
            if (!t) throw Error(`this backup needs an attachment store`);
            let e = await t.read(s.hash, d, f);
            if (e.length !== f)
              throw Error(`an attachment is shorter than recorded`);
            a.set(e, o);
          }
          o += f;
        }
      }
      return a;
    },
  };
}
async function je(e, t, n) {
  let r = ge();
  for (let i = 0; i < n; i += Ee)
    r.update(await e.read(t, i, Math.min(Ee, n - i)));
  return r.value;
}
async function Me(e, t, n) {
  let r = ge();
  r.update(e);
  let i = [
    {
      name: Se,
      size: e.length,
      crc: r.value,
      data: { kind: `bytes`, bytes: e },
    },
  ];
  for (let e of [...n].sort()) {
    let n = await t.size(e);
    if (n === null) throw new De({ reason: `missing`, count: 1 });
    i.push({
      name: `${Ce}${e}`,
      size: n,
      crc: await je(t, e, n),
      data: { kind: `blob`, hash: e, size: n },
    });
  }
  return ye(i);
}
async function Ne(e) {
  let t = async () => ({
      fingerprint: await ke(e.vault, []),
      attachments: 0,
      body: async () => be(e.vault),
    }),
    n = async (t) => ({
      fingerprint: await ke(e.vault, []),
      attachments: 0,
      blocked: t,
      body: async () => {
        throw new De(t);
      },
    }),
    r = e.blobs;
  if (!r) return t();
  let i = await _(e.vault),
    a,
    o = await Oe(e);
  if (o)
    ((a = [...new Set(o.map((e) => e.hash))]),
      await e.listCache?.set({ vaultHash: i, hashes: a }).catch(() => {}));
  else {
    let t = await e.listCache?.get().catch(() => null);
    if (!t || t.vaultHash !== i) return n({ reason: `locked` });
    a = t.hashes;
  }
  if (a.length === 0) return t();
  let s = 0;
  for (let e of a) (await r.has(e)) || s++;
  return s > 0
    ? n({ reason: `missing`, count: s })
    : {
        fingerprint: await ke(e.vault, a),
        attachments: a.length,
        body: async () => Ae(await Me(e.vault, r, a), r),
      };
}
async function Pe(e) {
  let t = await Ne(e);
  return {
    body: await t.body(),
    fingerprint: t.fingerprint,
    attachments: t.attachments,
  };
}
var Fe = class extends Error {};
function Ie(e) {
  return (
    e.length >= 4 && e[0] === 80 && e[1] === 75 && e[2] === 3 && e[3] === 4
  );
}
async function Le(e) {
  if (!Ie(await e.read(0, Math.min(4, e.size)))) {
    if (e.size > Te) throw Error(`too large to be a vault`);
    return { kind: `vault`, vault: await e.read(0, e.size) };
  }
  let t;
  try {
    t = await I(e);
  } catch (e) {
    throw e instanceof k ? new Fe(`This backup file is damaged.`) : e;
  }
  let n,
    r = [];
  for (let e of t) {
    if (e.name === `vault.bramble`) {
      n = e;
      continue;
    }
    let t = e.name.slice(6);
    if (!e.name.startsWith(Ce) || !u.test(t))
      throw new Fe(
        `This isn't a Bramble backup: it holds a file a Bramble backup never contains.`,
      );
    r.push({ hash: t, offset: e.offset, size: e.size });
  }
  if (!n) throw new Fe(`This backup file has no vault in it.`);
  if (n.size > Te) throw new Fe(`This backup file is damaged.`);
  let i = await e.read(n.offset, n.size),
    a = ge();
  if ((a.update(i), a.value !== n.crc))
    throw new Fe(`This backup file is damaged.`);
  return { kind: `archive`, vault: i, attachments: r };
}
async function Re(e) {
  if (!Ie(e)) return !1;
  try {
    return (await Le(be(e))).kind === `archive`;
  } catch {
    return !1;
  }
}
async function ze(e, t, n) {
  let r = 0,
    i = 0;
  for (let a of n) {
    if (await e.has(a.hash)) {
      r++;
      continue;
    }
    let n = await e.receive(a.hash);
    try {
      for (let e = n.resumeFrom; e < a.size; e += Ee)
        await n.append(await t.read(a.offset + e, Math.min(Ee, a.size - e)));
      (await n.commit(), r++);
    } catch {
      (await n.abort().catch(() => {}), i++);
    }
  }
  return { restored: r, rejected: i };
}
var L = class extends Error {
  kind;
  status;
  providerMessage;
  constructor(e, t, n = {}) {
    (super(t),
      (this.name = `AliasError`),
      (this.kind = e),
      (this.status = n.status),
      (this.providerMessage = n.providerMessage));
  }
};
function Be(e) {
  return e instanceof L && e.providerMessage
    ? `${e.message} ${e.providerMessage}`
    : e instanceof Error
      ? e.message
      : String(e);
}
var Ve = s({
  message: p().optional(),
  error: p().optional(),
  detail: p().optional(),
});
function He(e) {
  let t = Ve.safeParse(e);
  if (t.success)
    return (
      t.data.message?.trim() ||
      t.data.error?.trim() ||
      t.data.detail?.trim() ||
      void 0
    );
}
function Ue(e) {
  return e === 401 || e === 403
    ? `auth`
    : e === 402
      ? `payment`
      : e === 429
        ? `rate-limit`
        : `provider`;
}
var We = {
  auth: `The provider rejected this API key.`,
  payment: `This provider's plan does not include alias creation.`,
  quota: `This account has no alias allowance left.`,
  "rate-limit": `The provider is rate-limiting requests. Try again shortly.`,
  network: `Could not reach the provider.`,
  provider: `The provider could not create an alias.`,
  config: `This provider needs more setup before it can create an alias.`,
};
function Ge(e, t) {
  return new L(e, We[e], { providerMessage: t });
}
var Ke = `Bramble was closed before the provider answered. Check your provider before trying again, in case the alias was made.`;
async function qe(e, t, n, r = w) {
  let i;
  try {
    i = await r.send({
      method: t.method ?? `GET`,
      url: e,
      headers: t.headers,
      body:
        t.body === void 0
          ? void 0
          : new TextEncoder().encode(JSON.stringify(t.body)),
    });
  } catch (e) {
    throw e instanceof Error && e.message === `transfer/interrupted`
      ? new L(`network`, Ke)
      : new L(`network`, We.network, {
          providerMessage: e instanceof Error ? e.message : void 0,
        });
  }
  if (i.status === 0 || (i.status >= 300 && i.status < 400))
    throw new L(`auth`, We.auth, { status: i.status });
  let a = new TextDecoder().decode(i.body),
    o;
  try {
    o = a ? JSON.parse(a) : void 0;
  } catch {
    o = void 0;
  }
  if (!i.ok)
    throw new L(Ue(i.status), We[Ue(i.status)], {
      status: i.status,
      providerMessage: He(o),
    });
  let s = n.safeParse(o);
  if (!s.success)
    throw new L(`provider`, `The provider returned an unexpected response.`, {
      status: i.status,
    });
  return s.data;
}
function Je(e) {
  return (t, n, r) => qe(t, n, r, e);
}
var Ye = `https://app.addy.io`,
  Xe = [
    `random_characters`,
    `uuid`,
    `random_words`,
    `random_male_name`,
    `random_female_name`,
    `random_noun`,
  ],
  Ze = s({ data: s({ email: p() }) }),
  Qe = s({
    data: f(p()),
    sharedDomains: f(p()).optional(),
    defaultAliasDomain: p().optional(),
  }),
  $e = s({
    data: s({
      username: p().optional(),
      active_shared_domain_alias_count: c().optional(),
      active_shared_domain_alias_limit: c().optional(),
    }),
  });
function et(e) {
  return {
    Authorization: `Bearer ${e}`,
    "Content-Type": `application/json`,
    Accept: `application/json`,
    "X-Requested-With": `XMLHttpRequest`,
  };
}
var tt = (e) => e.replace(/\/+$/, ``);
function nt(e, t, n) {
  let r = tt(e.baseUrl || `https://app.addy.io`),
    i = et(t),
    a = Je(n);
  return {
    async verify() {
      let e = (await a(`${r}/api/v1/account-details`, { headers: i }, $e)).data,
        t =
          e.active_shared_domain_alias_count !== void 0 &&
          e.active_shared_domain_alias_limit !== void 0
            ? {
                used: e.active_shared_domain_alias_count,
                limit: e.active_shared_domain_alias_limit,
              }
            : void 0;
      return { label: e.username, quota: t };
    },
    async domains() {
      let e = await a(`${r}/api/v1/domain-options`, { headers: i }, Qe),
        t = new Set(e.sharedDomains ?? e.data);
      return {
        options: e.data.map((e) => ({ domain: e, shared: t.has(e) })),
        default: e.defaultAliasDomain,
      };
    },
    async create(t) {
      if (!e.domain)
        throw new L(
          `config`,
          `Choose an Addy domain before generating an alias.`,
        );
      return {
        address: (
          await a(
            `${r}/api/v1/aliases`,
            {
              method: `POST`,
              headers: i,
              body: {
                domain: e.domain,
                ...(e.format ? { format: e.format } : {}),
                ...(t.description ? { description: t.description } : {}),
              },
            },
            Ze,
          )
        ).data.email,
      };
    },
  };
}
var rt = `abcdefghijklmnopqrstuvwxyz`,
  it = `ABCDEFGHIJKLMNOPQRSTUVWXYZ`,
  at = `0123456789`,
  ot = `!@#$%^&*()_+-=[]{}|;:,.<>?`,
  st = `Il1|O0o`,
  ct = 3,
  lt = {
    mode: `password`,
    length: 20,
    lowercase: !0,
    uppercase: !0,
    digits: !0,
    symbols: !0,
    avoidAmbiguous: !1,
    symbolSet: ot,
    words: 5,
    separator: `-`,
    capitalize: !1,
    wordNumber: !1,
    pinLength: 6,
  };
function ut(e, t, n) {
  return Number.isFinite(e) ? Math.min(n, Math.max(t, Math.round(e))) : t;
}
function R(e) {
  if (e <= 1) return 0;
  let t = Math.floor(4294967296 / e) * e,
    n = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(n);
    let r = n[0];
    if (r < t) return r % e;
  }
}
function dt(e) {
  return e.charAt(R(e.length));
}
function ft(e) {
  for (let t = e.length - 1; t > 0; t--) {
    let n = R(t + 1);
    [e[t], e[n]] = [e[n], e[t]];
  }
  return e;
}
function pt(e) {
  return [...e].filter((e) => !st.includes(e)).join(``);
}
function mt(e) {
  let t = [],
    n = (t) => (e.avoidAmbiguous ? pt(t) : t);
  if (
    (e.lowercase && t.push(n(rt)),
    e.uppercase && t.push(n(it)),
    e.digits && t.push(n(at)),
    e.symbols)
  ) {
    let r = n(e.symbolSet.trim() || `!@#$%^&*()_+-=[]{}|;:,.<>?`);
    r && t.push(r);
  }
  let r = t.filter((e) => e.length > 0);
  return r.length > 0 ? r : [rt];
}
function ht(e) {
  if (e.mode === `pin`) {
    let t = ut(e.pinLength, 4, 12);
    return Array.from({ length: t }, () => dt(at)).join(``);
  }
  let t = mt(e),
    n = ut(e.length, 8, 128),
    r = t.join(``),
    i = t.slice(0, n).map(dt);
  for (; i.length < n;) i.push(dt(r));
  return ft(i).join(``);
}
function gt(e) {
  return e.charAt(0).toUpperCase() + e.slice(1);
}
function _t(e, t) {
  let n = ut(e.words, 3, 12),
    r = Array.from({ length: n }, () => {
      let n = t[R(t.length)];
      return e.capitalize ? gt(n) : n;
    });
  if (e.wordNumber) {
    let e = R(r.length);
    r[e] = `${r[e]}${R(10)}`;
  }
  return r.join(e.separator);
}
async function vt(e) {
  if (e.mode !== `passphrase`) return ht(e);
  let { effWordlist: t } = await m(
    async () => {
      let { effWordlist: e } = await import(`./wordlist-eff-CgqBt_LE.js`).then(
        (e) => e.n,
      );
      return { effWordlist: e };
    },
    __vite__mapDeps([0, 1, 2]),
  );
  return _t(e, t());
}
function yt(e, t) {
  return typeof e == `boolean` ? e : t;
}
function bt(e, t, n, r) {
  return typeof e == `number` && Number.isFinite(e) ? ut(e, t, n) : r;
}
function xt(e) {
  let t = lt;
  if (!e || typeof e != `object`) return t;
  let n = e,
    r =
      n.mode === `passphrase` || n.mode === `pin` || n.mode === `password`
        ? n.mode
        : t.mode,
    i =
      typeof n.symbolSet == `string` && n.symbolSet.trim()
        ? n.symbolSet
        : t.symbolSet,
    a = typeof n.separator == `string` ? n.separator.slice(0, ct) : t.separator,
    o = {
      mode: r,
      length: bt(n.length, 8, 128, t.length),
      lowercase: yt(n.lowercase, t.lowercase),
      uppercase: yt(n.uppercase, t.uppercase),
      digits: yt(n.digits, t.digits),
      symbols: yt(n.symbols, t.symbols),
      avoidAmbiguous: yt(n.avoidAmbiguous, t.avoidAmbiguous),
      symbolSet: i,
      words: bt(n.words, 3, 12, t.words),
      separator: a,
      capitalize: yt(n.capitalize, t.capitalize),
      wordNumber: yt(n.wordNumber, t.wordNumber),
      pinLength: bt(n.pinLength, 4, 12, t.pinLength),
    };
  return (
    o.lowercase || o.uppercase || o.digits || o.symbols || (o.lowercase = !0),
    o
  );
}
var St = [`words`, `characters`],
  Ct = `abcdefghijkmnpqrstuvwxyz23456789`,
  wt = 10,
  Tt = 2,
  Et = 12;
function Dt() {
  let e = ``;
  for (let t = 0; t < wt; t++) e += Ct.charAt(R(32));
  return e;
}
async function Ot() {
  let { effWordlist: e } = await m(
      async () => {
        let { effWordlist: e } = await import(
          `./wordlist-eff-CgqBt_LE.js`
        ).then((e) => e.n);
        return { effWordlist: e };
      },
      __vite__mapDeps([0, 1, 2]),
    ),
    t = e(),
    n = [];
  for (let e = 0; e < Tt; e++) n.push(t[R(t.length)]);
  return `${n.join(`-`)}-${String(R(100)).padStart(2, `0`)}`;
}
function kt(e) {
  let t = e.trim().toLowerCase();
  return !t || t.includes(`@`) || t.includes(` `) || t.includes(`/`)
    ? !1
    : /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
        t,
      );
}
function At(e) {
  return {
    async verify() {
      return {};
    },
    async create(t) {
      let n = e.domain?.trim().toLowerCase();
      if (!n || !kt(n))
        throw new L(
          `config`,
          `Add the domain you want aliases on, in Settings.`,
        );
      let r = new Set((t.taken ?? []).map((e) => e.trim().toLowerCase())),
        i = e.style === `characters` ? Dt : Ot;
      for (let e = 0; e < Et; e++) {
        let e = `${await i()}@${n}`;
        if (!r.has(e)) return { address: e };
      }
      throw new L(`provider`, `Could not make an unused address. Try again.`);
    },
  };
}
var jt = `https://quack.duckduckgo.com`,
  Mt = `duck.com`,
  Nt = s({ address: p() });
function Pt(e) {
  return {
    Authorization: `Bearer ${e}`,
    "Content-Type": `application/json`,
    Accept: `application/json`,
  };
}
var Ft = (e) => e.replace(/\/+$/, ``);
function It(e, t, n) {
  let r = Ft(e.baseUrl || `https://quack.duckduckgo.com`),
    i = Pt(t),
    a = Je(n);
  return {
    async verify() {
      return { unchecked: !0 };
    },
    async create() {
      return {
        address: `${(await a(`${r}/api/email/addresses`, { method: `POST`, headers: i }, Nt)).address}@${Mt}`,
      };
    },
  };
}
var Lt = `https://api.fastmail.com`,
  Rt = `urn:ietf:params:jmap:core`,
  zt = `https://www.fastmail.com/dev/maskedemail`,
  Bt = `bramble`,
  Vt = s({
    apiUrl: p(),
    username: p().optional(),
    primaryAccounts: i(p(), p()),
  }),
  Ht = s({ methodResponses: f(g([p(), i(p(), h()), p()])) }),
  Ut = s({ type: p(), description: p().optional() }),
  Wt = s({
    created: i(p(), s({ email: p() })).nullish(),
    notCreated: i(p(), Ut).nullish(),
  }),
  Gt = new Set([
    `forbidden`,
    `accountNotFound`,
    `accountNotSupportedByMethod`,
    `accountReadOnly`,
  ]),
  Kt = { forbidden: `auth`, overQuota: `quota`, rateLimit: `rate-limit` };
function qt(e) {
  return {
    Authorization: `Bearer ${e}`,
    "Content-Type": `application/json`,
    Accept: `application/json`,
  };
}
var Jt = (e) => e.replace(/\/+$/, ``);
function Yt(e, t) {
  let n = new URL(t).hostname,
    r;
  try {
    r = new URL(e, t);
  } catch {
    r = void 0;
  }
  if (
    r?.protocol !== `https:` ||
    (r.hostname !== n && !r.hostname.endsWith(`.${n}`))
  )
    throw new L(
      `provider`,
      `Fastmail named an API address outside its own servers, so Bramble did not send your token there.`,
    );
  return r.href;
}
function Xt(e, t, n) {
  let r = `${Jt(e.baseUrl || `https://api.fastmail.com`)}/jmap/session`,
    i = qt(t),
    a = Je(n);
  async function o() {
    let e = await a(r, { headers: i }, Vt),
      t = e.primaryAccounts[zt];
    if (!t)
      throw new L(
        `auth`,
        `This Fastmail token has no Masked Email access. Create one with Masked Email ticked.`,
      );
    return { apiUrl: Yt(e.apiUrl, r), accountId: t, username: e.username };
  }
  async function s(e, t, n) {
    let [r, o] =
      (
        await a(
          e,
          {
            method: `POST`,
            headers: i,
            body: { using: [Rt, zt], methodCalls: [[t, n, `0`]] },
          },
          Ht,
        )
      ).methodResponses[0] ?? [];
    if (r === `error`) {
      let e = Ut.safeParse(o);
      throw Ge(
        e.success && Gt.has(e.data.type) ? `auth` : `provider`,
        e.success ? e.data.description : void 0,
      );
    }
    if (r !== t || !o)
      throw new L(`provider`, `The provider returned an unexpected response.`);
    return o;
  }
  return {
    async verify() {
      let { apiUrl: e, accountId: t, username: n } = await o();
      return (
        await s(e, `MaskedEmail/get`, { accountId: t, ids: [] }),
        { label: n }
      );
    },
    async create(e) {
      let { apiUrl: t, accountId: n } = await o(),
        r = await s(t, `MaskedEmail/set`, {
          accountId: n,
          create: {
            [Bt]: {
              state: `enabled`,
              forDomain: e.site ? `https://${e.site}` : ``,
              description: ``,
            },
          },
        }),
        i = Wt.safeParse(r),
        a = i.success ? i.data.notCreated?.[Bt] : void 0;
      if (a) throw Ge(Kt[a.type] ?? `provider`, a.description);
      let c = i.success ? i.data.created?.[Bt]?.email : void 0;
      if (!c)
        throw new L(
          `provider`,
          `The provider returned an unexpected response.`,
        );
      return { address: c };
    },
  };
}
var Zt = `https://relay.firefox.com`,
  Qt = s({ full_address: p() }),
  $t = f(s({ has_premium: a().optional(), email: p().optional() })),
  en = 5,
  tn = f(s({}).loose());
function nn(e) {
  return {
    Authorization: `Token ${e}`,
    "Content-Type": `application/json`,
    Accept: `application/json`,
  };
}
var rn = (e) => e.replace(/\/+$/, ``);
function an(e, t, n) {
  let r = rn(e.baseUrl || `https://relay.firefox.com`),
    i = nn(t),
    a = Je(n);
  return {
    async verify() {
      let e = (await a(`${r}/api/v1/profiles/`, { headers: i }, $t))[0];
      if (!e)
        throw new L(`auth`, `This key does not belong to a Relay account.`);
      let t;
      if (e.has_premium === !1) {
        let e = await a(
          `${r}/api/v1/relayaddresses/`,
          { headers: i },
          tn,
        ).catch(() => null);
        e && (t = { used: e.length, limit: en });
      }
      return { label: e.email, quota: t };
    },
    async create(e) {
      return {
        address: (
          await a(
            `${r}/api/v1/relayaddresses/`,
            {
              method: `POST`,
              headers: i,
              body: {
                enabled: !0,
                ...(e.site ? { generated_for: e.site } : {}),
                ...(e.description ? { description: e.description } : {}),
              },
            },
            Qt,
          )
        ).full_address,
      };
    },
  };
}
var on = `https://app.simplelogin.io`,
  sn = [`word`, `uuid`],
  cn = s({ email: p() }),
  ln = s({ email: p().optional(), is_premium: a().optional() }),
  un = s({
    can_create: a().optional(),
    prefix_suggestion: p().optional(),
    suffixes: f(
      s({ suffix: p(), signed_suffix: p(), is_custom: a().optional() }),
    ),
  }),
  dn = s({ mailboxes: f(s({ id: c(), default: a().optional() })) });
function fn(e) {
  return { Authentication: e, "Content-Type": `application/json` };
}
var pn = (e) => e.replace(/\/+$/, ``);
function mn(e) {
  let t = e.lastIndexOf(`@`);
  return t === -1 ? e : e.slice(t + 1);
}
function hn() {
  let e = globalThis.crypto.getRandomValues(new Uint8Array(4));
  return Array.from(e, (e) => e.toString(16).padStart(2, `0`)).join(``);
}
function gn(e) {
  return e
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, `-`)
    .replace(/^-+|-+$/g, ``)
    .slice(0, 40);
}
function _n(e, t, n) {
  let r = pn(e.baseUrl || `https://app.simplelogin.io`),
    i = fn(t),
    a = Je(n),
    o = (e) =>
      `${r}/api/v5/alias/options${e ? `?hostname=${encodeURIComponent(e)}` : ``}`;
  async function s(t) {
    let n = new URLSearchParams();
    (t.site && n.set(`hostname`, t.site), e.mode && n.set(`mode`, e.mode));
    let o = n.toString();
    return {
      address: (
        await a(
          `${r}/api/alias/random/new${o ? `?${o}` : ``}`,
          {
            method: `POST`,
            headers: i,
            body: { ...(t.description ? { note: t.description } : {}) },
          },
          cn,
        )
      ).email,
    };
  }
  async function c(e, t) {
    let [n, s] = await Promise.all([
      a(o(e.site), { headers: i }, un),
      a(`${r}/api/v2/mailboxes`, { headers: i }, dn),
    ]);
    if (n.can_create === !1)
      throw new L(
        `quota`,
        `This SimpleLogin account cannot create more aliases.`,
      );
    let c = n.suffixes.find((e) => mn(e.suffix) === t);
    if (!c)
      throw new L(
        `config`,
        `SimpleLogin no longer offers ${t}. Choose another in Settings.`,
      );
    let l = s.mailboxes.find((e) => e.default) ?? s.mailboxes[0];
    if (!l) throw new L(`config`, `This SimpleLogin account has no mailbox.`);
    let u = gn(n.prefix_suggestion || e.site || ``),
      d = c.is_custom === !0 ? `${u ? `${u}-` : ``}${hn()}` : u || hn();
    return {
      address: (
        await a(
          `${r}/api/v3/alias/custom/new${e.site ? `?hostname=${encodeURIComponent(e.site)}` : ``}`,
          {
            method: `POST`,
            headers: i,
            body: {
              alias_prefix: d,
              signed_suffix: c.signed_suffix,
              mailbox_ids: [l.id],
              ...(e.description ? { note: e.description } : {}),
            },
          },
          cn,
        )
      ).email,
    };
  }
  return {
    async verify() {
      return {
        label: (await a(`${r}/api/user_info`, { headers: i }, ln)).email,
      };
    },
    async domains() {
      let e = await a(o(), { headers: i }, un),
        t = new Set(),
        n = [];
      for (let r of e.suffixes) {
        let e = mn(r.suffix);
        t.has(e) ||
          (t.add(e), n.push({ domain: e, shared: r.is_custom !== !0 }));
      }
      return { options: n };
    },
    create: (t) => (e.domain ? c(t, e.domain) : s(t)),
  };
}
var vn = [
  {
    id: `addy`,
    label: `Addy.io`,
    defaultBaseUrl: Ye,
    needsApiKey: !0,
    selfHostable: !0,
    keyUrl: `https://app.addy.io/settings/api`,
    fields: [
      { key: `domain`, options: `domains`, required: !0 },
      { key: `format`, options: Xe, required: !1 },
    ],
  },
  {
    id: `simplelogin`,
    label: `SimpleLogin`,
    defaultBaseUrl: on,
    needsApiKey: !0,
    selfHostable: !0,
    keyUrl: `https://app.simplelogin.io/dashboard/api_key`,
    fields: [
      { key: `domain`, options: `domains`, required: !1 },
      { key: `mode`, options: sn, required: !1 },
    ],
  },
  {
    id: `fastmail`,
    label: `Fastmail`,
    defaultBaseUrl: Lt,
    needsApiKey: !0,
    selfHostable: !1,
    keyUrl: `https://app.fastmail.com/settings/security`,
    fields: [],
  },
  {
    id: `duckduckgo`,
    label: `DuckDuckGo`,
    defaultBaseUrl: jt,
    needsApiKey: !0,
    selfHostable: !1,
    keyUrl: `https://duckduckgo.com/email/settings/autofill`,
    fields: [],
  },
  {
    id: `relay`,
    label: `Firefox Relay`,
    defaultBaseUrl: Zt,
    needsApiKey: !0,
    selfHostable: !1,
    keyUrl: `https://relay.firefox.com/accounts/settings/`,
    fields: [],
  },
  {
    id: `catchall`,
    label: `Your own domain`,
    defaultBaseUrl: ``,
    needsApiKey: !1,
    selfHostable: !1,
    keyUrl: ``,
    fields: [
      { key: `domain`, options: `text`, required: !0 },
      { key: `style`, options: St, required: !1 },
    ],
  },
];
function yn(e) {
  let t = vn.find((t) => t.id === e);
  if (!t) throw Error(`unknown alias provider: ${e}`);
  return t;
}
function bn(e, t) {
  return yn(e)
    .fields.filter((e) => e.required && !t[e.key])
    .map((e) => e.key);
}
var xn = `alias.config`;
function Sn(e) {
  return `${xn}:${e}`;
}
var Cn = `alias.configured`;
function wn(e) {
  return `${Cn}:${e}`;
}
function Tn(e, t, n) {
  return t ? null : Dn(e?.[n]?.value);
}
function En(e, t) {
  let n = (e) =>
    JSON.stringify(
      Object.entries(e.options).sort(([e], [t]) => e.localeCompare(t)),
    );
  return (
    e.provider === t.provider &&
    (e.baseUrl ?? ``) === (t.baseUrl ?? ``) &&
    (e.apiKey ?? ``) === (t.apiKey ?? ``) &&
    n(e) === n(t)
  );
}
function Dn(e) {
  if (!e || typeof e != `object`) return !1;
  let t = e;
  return !vn.some((e) => e.id === t.provider) ||
    (t.baseUrl !== void 0 && typeof t.baseUrl != `string`) ||
    !t.options ||
    typeof t.options != `object`
    ? !1
    : t.provider === `catchall`
      ? t.apiKey === void 0 || typeof t.apiKey == `string`
      : typeof t.apiKey == `string` && t.apiKey.length > 0;
}
var z = `vault.registry`,
  On = s({
    id: p().min(1),
    label: p(),
    createdAt: c(),
    number: c().int().positive().optional(),
    hidden: s({ at: c(), blobHash: p(), into: p() }).optional(),
  }),
  kn = s({ vaults: f(On) }),
  An = { vaults: [] };
function jn(e) {
  if (e == null) return An;
  let t = kn.safeParse(e);
  return t.success ? Mn(t.data) : An;
}
function Mn(e) {
  if (e.vaults.every((e) => e.number !== void 0)) return e;
  let t = new Set(
      e.vaults.flatMap((e) => (e.number === void 0 ? [] : [e.number])),
    ),
    n = Rn(e),
    r = [...n, ...e.vaults.filter((e) => !n.includes(e))],
    i = new Map();
  return (
    r.forEach((e, n) => {
      if (e.number !== void 0) return;
      let r = n + 1;
      for (; t.has(r);) r++;
      (t.add(r), i.set(e.id, r));
    }),
    { vaults: e.vaults.map((e) => ({ ...e, number: e.number ?? i.get(e.id) })) }
  );
}
function Nn(e, t) {
  if (e.vaults.some((e) => e.id === t.id))
    throw Error(`vault id already registered: ${t.id}`);
  let n = Mn(e),
    r = Math.max(0, ...n.vaults.map((e) => e.number ?? 0)) + 1;
  return { vaults: [...n.vaults, { ...t, number: r }] };
}
function Pn(e, t) {
  return {
    vaults: e.vaults
      .filter((e) => e.id !== t)
      .map((e) => (e.hidden?.into === t ? Fn(e) : e)),
  };
}
function Fn(e) {
  let { hidden: t, ...n } = e;
  return n;
}
function In(e, t, n) {
  return {
    ...e,
    vaults: e.vaults.map((e) => (e.id === t ? { ...e, label: n } : e)),
  };
}
function Ln(e, t, n) {
  return {
    ...e,
    vaults: e.vaults.map((e) => (e.id === t ? { ...e, hidden: n } : e)),
  };
}
function Rn(e) {
  let t = e.vaults.filter((e) => e.hidden === void 0);
  return t.length > 0 ? t : e.vaults;
}
function zn(e, t) {
  let n = e.label.trim();
  return n.length > 0 ? n : `Vault ${e.number ?? t + 1}`;
}
var Bn = [
  `sync.group`,
  `sync.lastSyncedAt`,
  `sync.deviceId`,
  `sync.deviceKeypair`,
  `sync.signingKey`,
];
function Vn(e, t) {
  return `${e}:${t}`;
}
var Hn = `backup.targets`,
  Un = `backup.config`;
function Wn(e) {
  return `${Hn}:${e}`;
}
function Gn(e) {
  return e.startsWith(`${Hn}:`);
}
function Kn(e) {
  return e.wrap === `os`;
}
function qn(e, t, n) {
  return e.map((e) => {
    let r = t.get(e.id);
    return r
      ? r.blocked
        ? { ...e, waiting: r.blocked }
        : r.error === `transfer/interrupted`
          ? r.hash !== void 0 && r.hash === e.lastVaultHash
            ? e
            : { ...e, lastError: r.error }
          : r.error === void 0
            ? {
                ...e,
                lastBackupAt: n,
                lastVaultHash: r.hash,
                lastError: void 0,
                waiting: void 0,
                failedAt: void 0,
                failures: void 0,
              }
            : {
                ...e,
                lastError: r.error,
                failedAt: n,
                failures: (e.failures ?? 0) + 1,
              }
      : e;
  });
}
function Jn(e) {
  return e.failedAt === void 0 && e.failures === void 0
    ? e
    : { ...e, failedAt: void 0, failures: void 0 };
}
function Yn(e, t) {
  if (e.provider === `s3`) {
    let n = t;
    return {
      kind: `s3`,
      endpoint: e.endpoint ?? ``,
      region: e.region ?? ``,
      bucket: e.bucket ?? ``,
      prefix: e.prefix,
      accessKeyId: n.accessKeyId,
      secretAccessKey: n.secretAccessKey,
    };
  }
  if (e.provider === `dropbox`)
    return { kind: `dropbox`, refreshToken: t.refreshToken, path: e.path };
  let n = t;
  return {
    kind: `webdav`,
    serverUrl: e.serverUrl ?? ``,
    username: n.username,
    password: n.password,
  };
}
function Xn(e) {
  return (
    (e.provider === `webdav` ? e.path : e.prefix)
      ?.trim()
      .replace(/^\/+|\/+$/g, ``) || `bramble`
  );
}
function Zn(e, t, n) {
  return n ? e : `${e}-${t}`;
}
function Qn(e, t, n) {
  let r = Xn(e);
  return e.sharedFolder ? Zn(r, t, n) : r;
}
function $n(e, t) {
  return e.sharedFolder ? void 0 : t;
}
var er = `backup/foreign-creds`;
async function tr(e, t, n) {
  if (t.length === 0) return;
  let r = await e.getMeta(Hn),
    i = r ? void 0 : await e.getMeta(Un);
  if (!r && !i) return;
  let a = (r ?? [{ ...i, id: n() }]).map((e) => ({ ...e, sharedFolder: !0 }));
  for (let n of t) {
    let t = Wn(n);
    (await e.getMeta(t)) === void 0 && (await e.setMeta(t, a));
  }
  (await e.removeMeta(Hn), await e.removeMeta(Un));
}
function nr(e) {
  let t = e.endpoint.trim(),
    n = e.bucket.trim(),
    r = (e.prefix ?? ``).trim().replace(/^\/+|\/+$/g, ``),
    i = /^https?:\/\//i.test(n) ? n : t;
  try {
    let e = new URL(i),
      t = `${e.protocol}//${e.host}`,
      a = e.pathname.split(`/`).filter(Boolean);
    return a.length === 0
      ? { endpoint: t, bucket: n, prefix: r || void 0 }
      : {
          endpoint: t,
          bucket: a[0] ?? ``,
          prefix: [a.slice(1).join(`/`), r].filter(Boolean).join(`/`) || void 0,
        };
  } catch {
    return { endpoint: t, bucket: n, prefix: r || void 0 };
  }
}
function rr(e) {
  return `backup.attachments:${e}`;
}
function ir(e, t) {
  let n = rr(t);
  return {
    get: async () => (await e.getMeta(n)) ?? null,
    set: (t) => e.setMeta(n, t),
  };
}
var ar = (e) => {
  let t = new Uint8Array(new ArrayBuffer(8)),
    n = e;
  for (let e = 7; e >= 0 && n !== 0; e--)
    ((t[e] = n & 255), (n -= t[e]), (n /= 256));
  return t;
};
function or(e) {
  return (
    e instanceof Uint8Array ||
    (ArrayBuffer.isView(e) &&
      e.constructor.name === `Uint8Array` &&
      `BYTES_PER_ELEMENT` in e &&
      e.BYTES_PER_ELEMENT === 1)
  );
}
function sr(e, t = ``) {
  if (typeof e != `number`) {
    let n = t && `"${t}" `;
    throw TypeError(`${n}expected number, got ${typeof e}`);
  }
  if (!Number.isSafeInteger(e) || e < 0) {
    let n = t && `"${t}" `;
    throw RangeError(`${n}expected integer >= 0, got ${e}`);
  }
}
function cr(e, t, n = ``) {
  let r = or(e),
    i = e?.length;
  if (!r || t !== void 0) {
    let t = n && `"${n}" `,
      a = r ? `length=${i}` : `type=${typeof e}`,
      o = t + `expected Uint8Array, got ` + a;
    throw r ? RangeError(o) : TypeError(o);
  }
  return e;
}
function lr(e) {
  if (typeof e != `function` || typeof e.create != `function`)
    throw TypeError(`Hash must wrapped by utils.createHasher`);
  if ((sr(e.outputLen), sr(e.blockLen), e.outputLen < 1))
    throw Error(`"outputLen" must be >= 1`);
  if (e.blockLen < 1) throw Error(`"blockLen" must be >= 1`);
}
function ur(e, t = !0) {
  if (e.destroyed) throw Error(`Hash instance has been destroyed`);
  if (t && e.finished) throw Error(`Hash#digest() has already been called`);
}
function dr(e, t) {
  cr(e, void 0, `digestInto() output`);
  let n = t.outputLen;
  if (e.length < n)
    throw RangeError(`"digestInto() output" expected to be of length >=` + n);
}
function fr(e) {
  return new Uint32Array(e.buffer, e.byteOffset, Math.floor(e.byteLength / 4));
}
function B(...e) {
  for (let t = 0; t < e.length; t++) e[t].fill(0);
}
function pr(e) {
  return new DataView(e.buffer, e.byteOffset, e.byteLength);
}
function V(e, t) {
  return (e << (32 - t)) | (e >>> t);
}
function mr(e, t) {
  return (e << t) | ((e >>> (32 - t)) >>> 0);
}
var hr = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68;
function gr(e) {
  return (
    ((e << 24) & 4278190080) |
    ((e << 8) & 16711680) |
    ((e >>> 8) & 65280) |
    ((e >>> 24) & 255)
  );
}
function _r(e) {
  for (let t = 0; t < e.length; t++) e[t] = gr(e[t]);
  return e;
}
var vr = hr ? (e) => e : _r;
function yr(e, t = {}) {
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
var H = (e) => ({
    oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, e]),
  }),
  br = class {
    update(e) {
      return (ur(this), this.iHash.update(e), this);
    }
    digestInto(e) {
      (ur(this), dr(e, this), (this.finished = !0));
      let t = e.subarray(0, this.outputLen);
      (this.iHash.digestInto(t),
        this.oHash.update(t),
        this.oHash.digestInto(t),
        this.destroy());
    }
    digest() {
      let e = new Uint8Array(this.oHash.outputLen);
      return (this.digestInto(e), e);
    }
    _cloneInto(e) {
      e ||= Object.create(Object.getPrototypeOf(this), {});
      let {
        oHash: t,
        iHash: n,
        finished: r,
        destroyed: i,
        blockLen: a,
        outputLen: o,
      } = this;
      return (
        (e = e),
        (e.finished = r),
        (e.destroyed = i),
        (e.blockLen = a),
        (e.outputLen = o),
        (e.oHash = t._cloneInto(e.oHash)),
        (e.iHash = n._cloneInto(e.iHash)),
        e
      );
    }
    clone() {
      return this._cloneInto();
    }
    destroy() {
      ((this.destroyed = !0), this.oHash.destroy(), this.iHash.destroy());
    }
    constructor(e, t) {
      if (
        ((this.canXOF = !1),
        (this.finished = !1),
        (this.destroyed = !1),
        lr(e),
        cr(t, void 0, `key`),
        (this.iHash = e.create()),
        typeof this.iHash.update != `function`)
      )
        throw Error(`Expected instance of class which extends utils.Hash`);
      ((this.blockLen = this.iHash.blockLen),
        (this.outputLen = this.iHash.outputLen));
      let n = this.blockLen,
        r = new Uint8Array(n);
      r.set(t.length > n ? e.create().update(t).digest() : t);
      for (let e = 0; e < r.length; e++) r[e] ^= 54;
      (this.iHash.update(r), (this.oHash = e.create()));
      for (let e = 0; e < r.length; e++) r[e] ^= 106;
      (this.oHash.update(r), B(r));
    }
  },
  xr = (() => {
    let e = (e, t, n) => new br(e, t).update(n).digest();
    return ((e.create = (e, t) => new br(e, t)), e);
  })();
function Sr(e, t, n) {
  return (e & t) ^ (~e & n);
}
function Cr(e, t, n) {
  return (e & t) ^ (e & n) ^ (t & n);
}
var wr = class {
    update(e) {
      (ur(this), cr(e));
      let { view: t, buffer: n, blockLen: r } = this,
        i = e.length;
      for (let a = 0; a < i;) {
        let o = Math.min(r - this.pos, i - a);
        if (o === r) {
          let t = pr(e);
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
      (ur(this), dr(e, this), (this.finished = !0));
      let { buffer: t, view: n, blockLen: r, isLE: i } = this,
        { pos: a } = this;
      ((t[a++] = 128),
        B(this.buffer.subarray(a)),
        this.padOffset > r - a && (this.process(n, 0), (a = 0)));
      for (let e = a; e < r; e++) t[e] = 0;
      (n.setBigUint64(r - 8, BigInt(this.length * 8), i), this.process(n, 0));
      let o = pr(e),
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
    constructor(e, t, n, r) {
      ((this.canXOF = !1),
        (this.finished = !1),
        (this.length = 0),
        (this.pos = 0),
        (this.destroyed = !1),
        (this.blockLen = e),
        (this.outputLen = t),
        (this.padOffset = n),
        (this.isLE = r),
        (this.buffer = new Uint8Array(e)),
        (this.view = pr(this.buffer)));
    }
  },
  U = Uint32Array.from([
    1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924,
    528734635, 1541459225,
  ]),
  W = Uint32Array.from([
    3238371032, 914150663, 812702999, 4144912697, 4290775857, 1750603025,
    1694076839, 3204075428,
  ]),
  G = Uint32Array.from([
    3418070365, 3238371032, 1654270250, 914150663, 2438529370, 812702999,
    355462360, 4144912697, 1731405415, 4290775857, 2394180231, 1750603025,
    3675008525, 1694076839, 1203062813, 3204075428,
  ]),
  K = Uint32Array.from([
    1779033703, 4089235720, 3144134277, 2227873595, 1013904242, 4271175723,
    2773480762, 1595750129, 1359893119, 2917565137, 2600822924, 725511199,
    528734635, 4215389547, 1541459225, 327033209,
  ]),
  Tr = Uint32Array.from([
    1732584193, 4023233417, 2562383102, 271733878, 3285377520,
  ]),
  q = new Uint32Array(80),
  Er = class extends wr {
    get() {
      let { A: e, B: t, C: n, D: r, E: i } = this;
      return [e, t, n, r, i];
    }
    set(e, t, n, r, i) {
      ((this.A = e | 0),
        (this.B = t | 0),
        (this.C = n | 0),
        (this.D = r | 0),
        (this.E = i | 0));
    }
    process(e, t) {
      for (let n = 0; n < 16; n++, t += 4) q[n] = e.getUint32(t, !1);
      for (let e = 16; e < 80; e++)
        q[e] = mr(q[e - 3] ^ q[e - 8] ^ q[e - 14] ^ q[e - 16], 1);
      let { A: n, B: r, C: i, D: a, E: o } = this;
      for (let e = 0; e < 80; e++) {
        let t, s;
        e < 20
          ? ((t = Sr(r, i, a)), (s = 1518500249))
          : e < 40
            ? ((t = r ^ i ^ a), (s = 1859775393))
            : e < 60
              ? ((t = Cr(r, i, a)), (s = 2400959708))
              : ((t = r ^ i ^ a), (s = 3395469782));
        let c = (mr(n, 5) + t + o + s + q[e]) | 0;
        ((o = a), (a = i), (i = mr(r, 30)), (r = n), (n = c));
      }
      ((n = (n + this.A) | 0),
        (r = (r + this.B) | 0),
        (i = (i + this.C) | 0),
        (a = (a + this.D) | 0),
        (o = (o + this.E) | 0),
        this.set(n, r, i, a, o));
    }
    roundClean() {
      B(q);
    }
    destroy() {
      ((this.destroyed = !0), this.set(0, 0, 0, 0, 0), B(this.buffer));
    }
    constructor() {
      (super(64, 20, 8, !1),
        (this.A = Tr[0] | 0),
        (this.B = Tr[1] | 0),
        (this.C = Tr[2] | 0),
        (this.D = Tr[3] | 0),
        (this.E = Tr[4] | 0));
    }
  },
  Dr = yr(() => new Er()),
  Or = BigInt(2 ** 32 - 1),
  kr = BigInt(32);
function Ar(e, t = !1) {
  return t
    ? { h: Number(e & Or), l: Number((e >> kr) & Or) }
    : { h: Number((e >> kr) & Or) | 0, l: Number(e & Or) | 0 };
}
function jr(e, t = !1) {
  let n = e.length,
    r = new Uint32Array(n),
    i = new Uint32Array(n);
  for (let a = 0; a < n; a++) {
    let { h: n, l: o } = Ar(e[a], t);
    [r[a], i[a]] = [n, o];
  }
  return [r, i];
}
var Mr = (e, t, n) => e >>> n,
  Nr = (e, t, n) => (e << (32 - n)) | (t >>> n),
  Pr = (e, t, n) => (e >>> n) | (t << (32 - n)),
  Fr = (e, t, n) => (e << (32 - n)) | (t >>> n),
  Ir = (e, t, n) => (e << (64 - n)) | (t >>> (n - 32)),
  Lr = (e, t, n) => (e >>> (n - 32)) | (t << (64 - n)),
  Rr = (e, t, n) => (e << n) | (t >>> (32 - n)),
  zr = (e, t, n) => (t << n) | (e >>> (32 - n)),
  Br = (e, t, n) => (t << (n - 32)) | (e >>> (64 - n)),
  Vr = (e, t, n) => (e << (n - 32)) | (t >>> (64 - n));
function J(e, t, n, r) {
  let i = (t >>> 0) + (r >>> 0);
  return { h: (e + n + ((i / 2 ** 32) | 0)) | 0, l: i | 0 };
}
var Hr = (e, t, n) => (e >>> 0) + (t >>> 0) + (n >>> 0),
  Ur = (e, t, n, r) => (t + n + r + ((e / 2 ** 32) | 0)) | 0,
  Wr = (e, t, n, r) => (e >>> 0) + (t >>> 0) + (n >>> 0) + (r >>> 0),
  Gr = (e, t, n, r, i) => (t + n + r + i + ((e / 2 ** 32) | 0)) | 0,
  Kr = (e, t, n, r, i) =>
    (e >>> 0) + (t >>> 0) + (n >>> 0) + (r >>> 0) + (i >>> 0),
  qr = (e, t, n, r, i, a) => (t + n + r + i + a + ((e / 2 ** 32) | 0)) | 0,
  Jr = Uint32Array.from([
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
  Y = new Uint32Array(64),
  Yr = class extends wr {
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
      for (let n = 0; n < 16; n++, t += 4) Y[n] = e.getUint32(t, !1);
      for (let e = 16; e < 64; e++) {
        let t = Y[e - 15],
          n = Y[e - 2],
          r = V(t, 7) ^ V(t, 18) ^ (t >>> 3),
          i = V(n, 17) ^ V(n, 19) ^ (n >>> 10);
        Y[e] = (i + Y[e - 7] + r + Y[e - 16]) | 0;
      }
      let { A: n, B: r, C: i, D: a, E: o, F: s, G: c, H: l } = this;
      for (let e = 0; e < 64; e++) {
        let t = V(o, 6) ^ V(o, 11) ^ V(o, 25),
          u = (l + t + Sr(o, s, c) + Jr[e] + Y[e]) | 0,
          d = ((V(n, 2) ^ V(n, 13) ^ V(n, 22)) + Cr(n, r, i)) | 0;
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
      B(Y);
    }
    destroy() {
      ((this.destroyed = !0), this.set(0, 0, 0, 0, 0, 0, 0, 0), B(this.buffer));
    }
    constructor(e) {
      super(64, e, 8, !1);
    }
  },
  Xr = class extends Yr {
    constructor() {
      (super(32),
        (this.A = U[0] | 0),
        (this.B = U[1] | 0),
        (this.C = U[2] | 0),
        (this.D = U[3] | 0),
        (this.E = U[4] | 0),
        (this.F = U[5] | 0),
        (this.G = U[6] | 0),
        (this.H = U[7] | 0));
    }
  },
  Zr = class extends Yr {
    constructor() {
      (super(28),
        (this.A = W[0] | 0),
        (this.B = W[1] | 0),
        (this.C = W[2] | 0),
        (this.D = W[3] | 0),
        (this.E = W[4] | 0),
        (this.F = W[5] | 0),
        (this.G = W[6] | 0),
        (this.H = W[7] | 0));
    }
  },
  Qr = jr(
    `0x428a2f98d728ae22.0x7137449123ef65cd.0xb5c0fbcfec4d3b2f.0xe9b5dba58189dbbc.0x3956c25bf348b538.0x59f111f1b605d019.0x923f82a4af194f9b.0xab1c5ed5da6d8118.0xd807aa98a3030242.0x12835b0145706fbe.0x243185be4ee4b28c.0x550c7dc3d5ffb4e2.0x72be5d74f27b896f.0x80deb1fe3b1696b1.0x9bdc06a725c71235.0xc19bf174cf692694.0xe49b69c19ef14ad2.0xefbe4786384f25e3.0x0fc19dc68b8cd5b5.0x240ca1cc77ac9c65.0x2de92c6f592b0275.0x4a7484aa6ea6e483.0x5cb0a9dcbd41fbd4.0x76f988da831153b5.0x983e5152ee66dfab.0xa831c66d2db43210.0xb00327c898fb213f.0xbf597fc7beef0ee4.0xc6e00bf33da88fc2.0xd5a79147930aa725.0x06ca6351e003826f.0x142929670a0e6e70.0x27b70a8546d22ffc.0x2e1b21385c26c926.0x4d2c6dfc5ac42aed.0x53380d139d95b3df.0x650a73548baf63de.0x766a0abb3c77b2a8.0x81c2c92e47edaee6.0x92722c851482353b.0xa2bfe8a14cf10364.0xa81a664bbc423001.0xc24b8b70d0f89791.0xc76c51a30654be30.0xd192e819d6ef5218.0xd69906245565a910.0xf40e35855771202a.0x106aa07032bbd1b8.0x19a4c116b8d2d0c8.0x1e376c085141ab53.0x2748774cdf8eeb99.0x34b0bcb5e19b48a8.0x391c0cb3c5c95a63.0x4ed8aa4ae3418acb.0x5b9cca4f7763e373.0x682e6ff3d6b2b8a3.0x748f82ee5defb2fc.0x78a5636f43172f60.0x84c87814a1f0ab72.0x8cc702081a6439ec.0x90befffa23631e28.0xa4506cebde82bde9.0xbef9a3f7b2c67915.0xc67178f2e372532b.0xca273eceea26619c.0xd186b8c721c0c207.0xeada7dd6cde0eb1e.0xf57d4f7fee6ed178.0x06f067aa72176fba.0x0a637dc5a2c898a6.0x113f9804bef90dae.0x1b710b35131c471b.0x28db77f523047d84.0x32caab7b40c72493.0x3c9ebe0a15c9bebc.0x431d67c49c100d4c.0x4cc5d4becb3e42b6.0x597f299cfc657e2a.0x5fcb6fab3ad6faec.0x6c44198c4a475817`
      .split(`.`)
      .map((e) => BigInt(e)),
  ),
  $r = Qr[0],
  ei = Qr[1],
  X = new Uint32Array(80),
  Z = new Uint32Array(80),
  ti = class extends wr {
    get() {
      let {
        Ah: e,
        Al: t,
        Bh: n,
        Bl: r,
        Ch: i,
        Cl: a,
        Dh: o,
        Dl: s,
        Eh: c,
        El: l,
        Fh: u,
        Fl: d,
        Gh: f,
        Gl: p,
        Hh: m,
        Hl: h,
      } = this;
      return [e, t, n, r, i, a, o, s, c, l, u, d, f, p, m, h];
    }
    set(e, t, n, r, i, a, o, s, c, l, u, d, f, p, m, h) {
      ((this.Ah = e | 0),
        (this.Al = t | 0),
        (this.Bh = n | 0),
        (this.Bl = r | 0),
        (this.Ch = i | 0),
        (this.Cl = a | 0),
        (this.Dh = o | 0),
        (this.Dl = s | 0),
        (this.Eh = c | 0),
        (this.El = l | 0),
        (this.Fh = u | 0),
        (this.Fl = d | 0),
        (this.Gh = f | 0),
        (this.Gl = p | 0),
        (this.Hh = m | 0),
        (this.Hl = h | 0));
    }
    process(e, t) {
      for (let n = 0; n < 16; n++, t += 4)
        ((X[n] = e.getUint32(t)), (Z[n] = e.getUint32((t += 4))));
      for (let e = 16; e < 80; e++) {
        let t = X[e - 15] | 0,
          n = Z[e - 15] | 0,
          r = Pr(t, n, 1) ^ Pr(t, n, 8) ^ Mr(t, n, 7),
          i = Fr(t, n, 1) ^ Fr(t, n, 8) ^ Nr(t, n, 7),
          a = X[e - 2] | 0,
          o = Z[e - 2] | 0,
          s = Pr(a, o, 19) ^ Ir(a, o, 61) ^ Mr(a, o, 6),
          c = Wr(
            i,
            Fr(a, o, 19) ^ Lr(a, o, 61) ^ Nr(a, o, 6),
            Z[e - 7],
            Z[e - 16],
          ),
          l = Gr(c, r, s, X[e - 7], X[e - 16]);
        ((X[e] = l | 0), (Z[e] = c | 0));
      }
      let {
        Ah: n,
        Al: r,
        Bh: i,
        Bl: a,
        Ch: o,
        Cl: s,
        Dh: c,
        Dl: l,
        Eh: u,
        El: d,
        Fh: f,
        Fl: p,
        Gh: m,
        Gl: h,
        Hh: g,
        Hl: _,
      } = this;
      for (let e = 0; e < 80; e++) {
        let t = Pr(u, d, 14) ^ Pr(u, d, 18) ^ Ir(u, d, 41),
          v = Fr(u, d, 14) ^ Fr(u, d, 18) ^ Lr(u, d, 41),
          y = (u & f) ^ (~u & m),
          b = (d & p) ^ (~d & h),
          x = Kr(_, v, b, ei[e], Z[e]),
          S = qr(x, g, t, y, $r[e], X[e]),
          C = x | 0,
          w = Pr(n, r, 28) ^ Ir(n, r, 34) ^ Ir(n, r, 39),
          T = Fr(n, r, 28) ^ Lr(n, r, 34) ^ Lr(n, r, 39),
          E = (n & i) ^ (n & o) ^ (i & o),
          D = (r & a) ^ (r & s) ^ (a & s);
        ((g = m | 0),
          (_ = h | 0),
          (m = f | 0),
          (h = p | 0),
          (f = u | 0),
          (p = d | 0),
          ({ h: u, l: d } = J(c | 0, l | 0, S | 0, C | 0)),
          (c = o | 0),
          (l = s | 0),
          (o = i | 0),
          (s = a | 0),
          (i = n | 0),
          (a = r | 0));
        let O = Hr(C, T, D);
        ((n = Ur(O, S, w, E)), (r = O | 0));
      }
      (({ h: n, l: r } = J(this.Ah | 0, this.Al | 0, n | 0, r | 0)),
        ({ h: i, l: a } = J(this.Bh | 0, this.Bl | 0, i | 0, a | 0)),
        ({ h: o, l: s } = J(this.Ch | 0, this.Cl | 0, o | 0, s | 0)),
        ({ h: c, l } = J(this.Dh | 0, this.Dl | 0, c | 0, l | 0)),
        ({ h: u, l: d } = J(this.Eh | 0, this.El | 0, u | 0, d | 0)),
        ({ h: f, l: p } = J(this.Fh | 0, this.Fl | 0, f | 0, p | 0)),
        ({ h: m, l: h } = J(this.Gh | 0, this.Gl | 0, m | 0, h | 0)),
        ({ h: g, l: _ } = J(this.Hh | 0, this.Hl | 0, g | 0, _ | 0)),
        this.set(n, r, i, a, o, s, c, l, u, d, f, p, m, h, g, _));
    }
    roundClean() {
      B(X, Z);
    }
    destroy() {
      ((this.destroyed = !0),
        B(this.buffer),
        this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
    }
    constructor(e) {
      super(128, e, 16, !1);
    }
  },
  ni = class extends ti {
    constructor() {
      (super(64),
        (this.Ah = K[0] | 0),
        (this.Al = K[1] | 0),
        (this.Bh = K[2] | 0),
        (this.Bl = K[3] | 0),
        (this.Ch = K[4] | 0),
        (this.Cl = K[5] | 0),
        (this.Dh = K[6] | 0),
        (this.Dl = K[7] | 0),
        (this.Eh = K[8] | 0),
        (this.El = K[9] | 0),
        (this.Fh = K[10] | 0),
        (this.Fl = K[11] | 0),
        (this.Gh = K[12] | 0),
        (this.Gl = K[13] | 0),
        (this.Hh = K[14] | 0),
        (this.Hl = K[15] | 0));
    }
  },
  ri = class extends ti {
    constructor() {
      (super(48),
        (this.Ah = G[0] | 0),
        (this.Al = G[1] | 0),
        (this.Bh = G[2] | 0),
        (this.Bl = G[3] | 0),
        (this.Ch = G[4] | 0),
        (this.Cl = G[5] | 0),
        (this.Dh = G[6] | 0),
        (this.Dl = G[7] | 0),
        (this.Eh = G[8] | 0),
        (this.El = G[9] | 0),
        (this.Fh = G[10] | 0),
        (this.Fl = G[11] | 0),
        (this.Gh = G[12] | 0),
        (this.Gl = G[13] | 0),
        (this.Hh = G[14] | 0),
        (this.Hl = G[15] | 0));
    }
  },
  ii = yr(() => new Xr(), H(1)),
  ai = yr(() => new Zr(), H(4)),
  oi = yr(() => new ni(), H(3)),
  si = yr(() => new ri(), H(2)),
  ci = BigInt(0),
  li = BigInt(1),
  ui = BigInt(2),
  di = BigInt(7),
  fi = BigInt(256),
  pi = BigInt(113),
  mi = [],
  hi = [],
  gi = [];
for (let e = 0, t = li, n = 1, r = 0; e < 24; e++) {
  (([n, r] = [r, (2 * n + 3 * r) % 5]),
    mi.push(2 * (5 * r + n)),
    hi.push((((e + 1) * (e + 2)) / 2) % 64));
  let i = ci;
  for (let e = 0; e < 7; e++)
    ((t = ((t << li) ^ ((t >> di) * pi)) % fi),
      t & ui && (i ^= li << ((li << BigInt(e)) - li)));
  gi.push(i);
}
var _i = jr(gi, !0),
  vi = _i[0],
  yi = _i[1],
  bi = (e, t, n) => (n > 32 ? Br(e, t, n) : Rr(e, t, n)),
  xi = (e, t, n) => (n > 32 ? Vr(e, t, n) : zr(e, t, n));
function Si(e, t = 24) {
  if ((sr(t, `rounds`), t < 1 || t > 24))
    throw Error(`"rounds" expected integer 1..24`);
  let n = new Uint32Array(10);
  for (let r = 24 - t; r < 24; r++) {
    for (let t = 0; t < 10; t++)
      n[t] = e[t] ^ e[t + 10] ^ e[t + 20] ^ e[t + 30] ^ e[t + 40];
    for (let t = 0; t < 10; t += 2) {
      let r = (t + 8) % 10,
        i = (t + 2) % 10,
        a = n[i],
        o = n[i + 1],
        s = bi(a, o, 1) ^ n[r],
        c = xi(a, o, 1) ^ n[r + 1];
      for (let n = 0; n < 50; n += 10) ((e[t + n] ^= s), (e[t + n + 1] ^= c));
    }
    let t = e[2],
      i = e[3];
    for (let n = 0; n < 24; n++) {
      let r = hi[n],
        a = bi(t, i, r),
        o = xi(t, i, r),
        s = mi[n];
      ((t = e[s]), (i = e[s + 1]), (e[s] = a), (e[s + 1] = o));
    }
    for (let t = 0; t < 50; t += 10) {
      let n = e[t],
        r = e[t + 1],
        i = e[t + 2],
        a = e[t + 3];
      ((e[t] ^= ~e[t + 2] & e[t + 4]),
        (e[t + 1] ^= ~e[t + 3] & e[t + 5]),
        (e[t + 2] ^= ~e[t + 4] & e[t + 6]),
        (e[t + 3] ^= ~e[t + 5] & e[t + 7]),
        (e[t + 4] ^= ~e[t + 6] & e[t + 8]),
        (e[t + 5] ^= ~e[t + 7] & e[t + 9]),
        (e[t + 6] ^= ~e[t + 8] & n),
        (e[t + 7] ^= ~e[t + 9] & r),
        (e[t + 8] ^= ~n & i),
        (e[t + 9] ^= ~r & a));
    }
    ((e[0] ^= vi[r]), (e[1] ^= yi[r]));
  }
  B(n);
}
var Ci = class e {
    clone() {
      return this._cloneInto();
    }
    keccak() {
      (vr(this.state32),
        Si(this.state32, this.rounds),
        vr(this.state32),
        (this.posOut = 0),
        (this.pos = 0));
    }
    update(e) {
      (ur(this), cr(e));
      let { blockLen: t, state: n } = this,
        r = e.length;
      for (let i = 0; i < r;) {
        let a = Math.min(t - this.pos, r - i);
        for (let t = 0; t < a; t++) n[this.pos++] ^= e[i++];
        this.pos === t && this.keccak();
      }
      return this;
    }
    finish() {
      if (this.finished) return;
      this.finished = !0;
      let { state: e, suffix: t, pos: n, blockLen: r } = this;
      ((e[n] ^= t),
        t & 128 && n === r - 1 && this.keccak(),
        (e[r - 1] ^= 128),
        this.keccak());
    }
    writeInto(e) {
      (ur(this, !1), cr(e), this.finish());
      let t = this.state,
        { blockLen: n } = this;
      for (let r = 0, i = e.length; r < i;) {
        this.posOut >= n && this.keccak();
        let a = Math.min(n - this.posOut, i - r);
        (e.set(t.subarray(this.posOut, this.posOut + a), r),
          (this.posOut += a),
          (r += a));
      }
      return e;
    }
    xofInto(e) {
      if (!this.enableXOF) throw Error(`XOF is not possible for this instance`);
      return this.writeInto(e);
    }
    xof(e) {
      return (sr(e), this.xofInto(new Uint8Array(e)));
    }
    digestInto(e) {
      if ((dr(e, this), this.finished))
        throw Error(`digest() was already called`);
      (this.writeInto(e.subarray(0, this.outputLen)), this.destroy());
    }
    digest() {
      let e = new Uint8Array(this.outputLen);
      return (this.digestInto(e), e);
    }
    destroy() {
      ((this.destroyed = !0), B(this.state));
    }
    _cloneInto(t) {
      let {
        blockLen: n,
        suffix: r,
        outputLen: i,
        rounds: a,
        enableXOF: o,
      } = this;
      return (
        (t ||= new e(n, r, i, o, a)),
        (t.blockLen = n),
        t.state32.set(this.state32),
        (t.pos = this.pos),
        (t.posOut = this.posOut),
        (t.finished = this.finished),
        (t.rounds = a),
        (t.suffix = r),
        (t.outputLen = i),
        (t.enableXOF = o),
        (t.canXOF = this.canXOF),
        (t.destroyed = this.destroyed),
        t
      );
    }
    constructor(e, t, n, r = !1, i = 24) {
      if (
        ((this.pos = 0),
        (this.posOut = 0),
        (this.finished = !1),
        (this.destroyed = !1),
        (this.enableXOF = !1),
        (this.blockLen = e),
        (this.suffix = t),
        (this.outputLen = n),
        (this.enableXOF = r),
        (this.canXOF = r),
        (this.rounds = i),
        sr(n, `outputLen`),
        !(0 < e && e < 200))
      )
        throw Error(`only keccak-f1600 function is supported`);
      ((this.state = new Uint8Array(200)), (this.state32 = fr(this.state)));
    }
  },
  wi = (e, t, n, r = {}) => yr(() => new Ci(t, e, n), r),
  Ti = wi(6, 144, 28, H(7)),
  Ei = wi(6, 136, 32, H(8)),
  Di = wi(6, 104, 48, H(9)),
  Oi = wi(6, 72, 64, H(10)),
  ki = (() => {
    if (typeof globalThis == `object`) return globalThis;
    Object.defineProperty(Object.prototype, "__GLOBALTHIS__", {
      get() {
        return this;
      },
      configurable: !0,
    });
    try {
      if (typeof __GLOBALTHIS__ < `u`) return __GLOBALTHIS__;
    } finally {
      delete Object.prototype.__GLOBALTHIS__;
    }
    if (typeof self < `u`) return self;
    if (typeof window < `u`) return window;
    if (typeof global < `u`) return global;
  })(),
  Ai = {
    SHA1: Dr,
    SHA224: ai,
    SHA256: ii,
    SHA384: si,
    SHA512: oi,
    "SHA3-224": Ti,
    "SHA3-256": Ei,
    "SHA3-384": Di,
    "SHA3-512": Oi,
  },
  ji = (e) => {
    switch (!0) {
      case /^(?:SHA-?1|SSL3-SHA1)$/i.test(e):
        return `SHA1`;
      case /^SHA(?:2?-)?224$/i.test(e):
        return `SHA224`;
      case /^SHA(?:2?-)?256$/i.test(e):
        return `SHA256`;
      case /^SHA(?:2?-)?384$/i.test(e):
        return `SHA384`;
      case /^SHA(?:2?-)?512$/i.test(e):
        return `SHA512`;
      case /^SHA3-224$/i.test(e):
        return `SHA3-224`;
      case /^SHA3-256$/i.test(e):
        return `SHA3-256`;
      case /^SHA3-384$/i.test(e):
        return `SHA3-384`;
      case /^SHA3-512$/i.test(e):
        return `SHA3-512`;
      default:
        throw TypeError(`Unknown hash algorithm: ${e}`);
    }
  },
  Mi = (e, t, n) => {
    if (xr) return xr(Ai[e] ?? Ai[ji(e)], t, n);
    throw Error(`Missing HMAC function`);
  },
  Ni = `ABCDEFGHIJKLMNOPQRSTUVWXYZ234567`,
  Pi = (e) => {
    e = e.replace(/ /g, ``);
    let t = e.length;
    for (; e[t - 1] === `=`;) --t;
    e = (t < e.length ? e.substring(0, t) : e).toUpperCase();
    let n = new ArrayBuffer(((e.length * 5) / 8) | 0),
      r = new Uint8Array(n),
      i = 0,
      a = 0,
      o = 0;
    for (let t = 0; t < e.length; t++) {
      let n = Ni.indexOf(e[t]);
      if (n === -1) throw TypeError(`Invalid character found: ${e[t]}`);
      ((a = (a << 5) | n), (i += 5), i >= 8 && ((i -= 8), (r[o++] = a >>> i)));
    }
    return r;
  },
  Fi = (e) => {
    let t = 0,
      n = 0,
      r = ``;
    for (let i = 0; i < e.length; i++)
      for (n = (n << 8) | e[i], t += 8; t >= 5;)
        ((r += Ni[(n >>> (t - 5)) & 31]), (t -= 5));
    return (t > 0 && (r += Ni[(n << (5 - t)) & 31]), r);
  },
  Ii = (e) => {
    e = e.replace(/ /g, ``);
    let t = new ArrayBuffer(e.length / 2),
      n = new Uint8Array(t);
    for (let t = 0; t < e.length; t += 2)
      n[t / 2] = parseInt(e.substring(t, t + 2), 16);
    return n;
  },
  Li = (e) => {
    let t = ``;
    for (let n = 0; n < e.length; n++) {
      let r = e[n].toString(16);
      (r.length === 1 && (t += `0`), (t += r));
    }
    return t.toUpperCase();
  },
  Ri = (e) => {
    let t = new ArrayBuffer(e.length),
      n = new Uint8Array(t);
    for (let t = 0; t < e.length; t++) n[t] = e.charCodeAt(t) & 255;
    return n;
  },
  zi = (e) => {
    let t = ``;
    for (let n = 0; n < e.length; n++) t += String.fromCharCode(e[n]);
    return t;
  },
  Bi = ki.TextEncoder ? new ki.TextEncoder() : null,
  Vi = ki.TextDecoder ? new ki.TextDecoder() : null,
  Hi = (e) => {
    if (!Bi) throw Error(`Encoding API not available`);
    return Bi.encode(e);
  },
  Ui = (e) => {
    if (!Vi) throw Error(`Encoding API not available`);
    return Vi.decode(e);
  },
  Wi = (e) => {
    if (ki.crypto?.getRandomValues)
      return ki.crypto.getRandomValues(new Uint8Array(e));
    throw Error(`Cryptography API not available`);
  },
  Gi = class e {
    static fromLatin1(t) {
      return new e({ buffer: Ri(t).buffer });
    }
    static fromUTF8(t) {
      return new e({ buffer: Hi(t).buffer });
    }
    static fromBase32(t) {
      return new e({ buffer: Pi(t).buffer });
    }
    static fromHex(t) {
      return new e({ buffer: Ii(t).buffer });
    }
    get buffer() {
      return this.bytes.buffer;
    }
    get latin1() {
      return (
        Object.defineProperty(this, "latin1", {
          enumerable: !0,
          writable: !1,
          configurable: !1,
          value: zi(this.bytes),
        }),
        this.latin1
      );
    }
    get utf8() {
      return (
        Object.defineProperty(this, "utf8", {
          enumerable: !0,
          writable: !1,
          configurable: !1,
          value: Ui(this.bytes),
        }),
        this.utf8
      );
    }
    get base32() {
      return (
        Object.defineProperty(this, "base32", {
          enumerable: !0,
          writable: !1,
          configurable: !1,
          value: Fi(this.bytes),
        }),
        this.base32
      );
    }
    get hex() {
      return (
        Object.defineProperty(this, "hex", {
          enumerable: !0,
          writable: !1,
          configurable: !1,
          value: Li(this.bytes),
        }),
        this.hex
      );
    }
    constructor({ buffer: e, size: t = 20 } = {}) {
      ((this.bytes = e === void 0 ? Wi(t) : new Uint8Array(e)),
        Object.defineProperty(this, "bytes", {
          enumerable: !0,
          writable: !1,
          configurable: !1,
          value: this.bytes,
        }));
    }
  },
  Ki = (e, t) => {
    {
      if (e.length !== t.length)
        throw TypeError(`Input strings must have the same length`);
      let n = -1,
        r = 0;
      for (; ++n < e.length;) r |= e.charCodeAt(n) ^ t.charCodeAt(n);
      return r === 0;
    }
  },
  qi = class e {
    static get defaults() {
      return {
        issuer: ``,
        label: `OTPAuth`,
        issuerInLabel: !0,
        algorithm: `SHA1`,
        digits: 6,
        counter: 0,
        window: 1,
      };
    }
    static generate({
      secret: t,
      algorithm: n = e.defaults.algorithm,
      digits: r = e.defaults.digits,
      counter: i = e.defaults.counter,
      hmac: a = Mi,
    }) {
      let o = ar(i),
        s = a(n, t.bytes, o);
      if (!s?.byteLength || s.byteLength < 19)
        throw TypeError(`Return value must be at least 19 bytes`);
      let c = s[s.byteLength - 1] & 15;
      return (
        (((s[c] & 127) << 24) |
          ((s[c + 1] & 255) << 16) |
          ((s[c + 2] & 255) << 8) |
          (s[c + 3] & 255)) %
        10 ** r
      )
        .toString()
        .padStart(r, `0`);
    }
    generate({ counter: t = this.counter++ } = {}) {
      return e.generate({
        secret: this.secret,
        algorithm: this.algorithm,
        digits: this.digits,
        counter: t,
        hmac: this.hmac,
      });
    }
    static validate({
      token: t,
      secret: n,
      algorithm: r,
      digits: i = e.defaults.digits,
      counter: a = e.defaults.counter,
      window: o = e.defaults.window,
      hmac: s = Mi,
    }) {
      if (t.length !== i) return null;
      let c = null,
        l = (o) => {
          Ki(
            t,
            e.generate({
              secret: n,
              algorithm: r,
              digits: i,
              counter: o,
              hmac: s,
            }),
          ) && (c = o - a);
        };
      l(a);
      for (
        let e = 1;
        e <= o &&
        c === null &&
        (l(a - e), !(c !== null || (l(a + e), c !== null)));
        ++e
      );
      return c;
    }
    validate({ token: t, counter: n = this.counter, window: r }) {
      return e.validate({
        token: t,
        secret: this.secret,
        algorithm: this.algorithm,
        digits: this.digits,
        counter: n,
        window: r,
        hmac: this.hmac,
      });
    }
    toString() {
      let e = encodeURIComponent;
      return `otpauth://hotp/${this.issuer.length > 0 ? (this.issuerInLabel ? `${e(this.issuer)}:${e(this.label)}?issuer=${e(this.issuer)}&` : `${e(this.label)}?issuer=${e(this.issuer)}&`) : `${e(this.label)}?`}secret=${e(this.secret.base32)}&algorithm=${e(this.algorithm)}&digits=${e(this.digits)}&counter=${e(this.counter)}`;
    }
    constructor({
      issuer: t = e.defaults.issuer,
      label: n = e.defaults.label,
      issuerInLabel: r = e.defaults.issuerInLabel,
      secret: i = new Gi(),
      algorithm: a = e.defaults.algorithm,
      digits: o = e.defaults.digits,
      counter: s = e.defaults.counter,
      hmac: c,
    } = {}) {
      ((this.issuer = t),
        (this.label = n),
        (this.issuerInLabel = r),
        (this.secret = typeof i == `string` ? Gi.fromBase32(i) : i),
        (this.algorithm = c ? a : ji(a)),
        (this.digits = o),
        (this.counter = s),
        (this.hmac = c));
    }
  },
  Ji = class e {
    static get defaults() {
      return {
        issuer: ``,
        label: `OTPAuth`,
        issuerInLabel: !0,
        algorithm: `SHA1`,
        digits: 6,
        period: 30,
        window: 1,
      };
    }
    static counter({
      period: t = e.defaults.period,
      timestamp: n = Date.now(),
    } = {}) {
      return Math.floor(n / 1e3 / t);
    }
    counter({ timestamp: t = Date.now() } = {}) {
      return e.counter({ period: this.period, timestamp: t });
    }
    static remaining({
      period: t = e.defaults.period,
      timestamp: n = Date.now(),
    } = {}) {
      return t * 1e3 - (n % (t * 1e3));
    }
    remaining({ timestamp: t = Date.now() } = {}) {
      return e.remaining({ period: this.period, timestamp: t });
    }
    static generate({
      secret: t,
      algorithm: n,
      digits: r,
      period: i = e.defaults.period,
      timestamp: a = Date.now(),
      hmac: o,
    }) {
      return qi.generate({
        secret: t,
        algorithm: n,
        digits: r,
        counter: e.counter({ period: i, timestamp: a }),
        hmac: o,
      });
    }
    generate({ timestamp: t = Date.now() } = {}) {
      return e.generate({
        secret: this.secret,
        algorithm: this.algorithm,
        digits: this.digits,
        period: this.period,
        timestamp: t,
        hmac: this.hmac,
      });
    }
    static validate({
      token: t,
      secret: n,
      algorithm: r,
      digits: i,
      period: a = e.defaults.period,
      timestamp: o = Date.now(),
      window: s,
      hmac: c,
    }) {
      return qi.validate({
        token: t,
        secret: n,
        algorithm: r,
        digits: i,
        counter: e.counter({ period: a, timestamp: o }),
        window: s,
        hmac: c,
      });
    }
    validate({ token: t, timestamp: n, window: r }) {
      return e.validate({
        token: t,
        secret: this.secret,
        algorithm: this.algorithm,
        digits: this.digits,
        period: this.period,
        timestamp: n,
        window: r,
        hmac: this.hmac,
      });
    }
    toString() {
      let e = encodeURIComponent;
      return `otpauth://totp/${this.issuer.length > 0 ? (this.issuerInLabel ? `${e(this.issuer)}:${e(this.label)}?issuer=${e(this.issuer)}&` : `${e(this.label)}?issuer=${e(this.issuer)}&`) : `${e(this.label)}?`}secret=${e(this.secret.base32)}&algorithm=${e(this.algorithm)}&digits=${e(this.digits)}&period=${e(this.period)}`;
    }
    constructor({
      issuer: t = e.defaults.issuer,
      label: n = e.defaults.label,
      issuerInLabel: r = e.defaults.issuerInLabel,
      secret: i = new Gi(),
      algorithm: a = e.defaults.algorithm,
      digits: o = e.defaults.digits,
      period: s = e.defaults.period,
      hmac: c,
    } = {}) {
      ((this.issuer = t),
        (this.label = n),
        (this.issuerInLabel = r),
        (this.secret = typeof i == `string` ? Gi.fromBase32(i) : i),
        (this.algorithm = c ? a : ji(a)),
        (this.digits = o),
        (this.period = s),
        (this.hmac = c));
    }
  },
  Yi = `23456789BCDFGHJKMNPQRTVWXY`,
  Xi = class extends Ji {
    constructor(e) {
      super({ ...e, algorithm: `SHA1`, digits: 10, period: 30 });
    }
    generate(e) {
      let t = Number(super.generate(e)),
        n = ``;
      for (let e = 0; e < 5; e++) ((n += Yi[t % 26]), (t = Math.floor(t / 26)));
      return n;
    }
  };
function Zi(e) {
  let t = e?.replace(/[\s-]/g, ``).toUpperCase();
  return t && !/^=*$/.test(t) ? Gi.fromBase32(t) : null;
}
function Qi(e) {
  try {
    return decodeURIComponent(e);
  } catch {
    return e;
  }
}
function $i(e) {
  let t = new URL(e),
    n = t.host.toLowerCase(),
    r = new Map();
  for (let [e, n] of t.searchParams) r.set(e.toLowerCase(), n);
  let i = n === `steam` || r.get(`encoder`)?.toLowerCase() === `steam`;
  if (n !== `totp` && !i) return null;
  let a = Zi(r.get(`secret`));
  if (!a) return null;
  let o = Qi(t.pathname.replace(/^\//, ``)),
    s = o.indexOf(`:`),
    c = s < 0 ? o : o.slice(s + 1).trim(),
    l = r.get(`issuer`) || (s < 0 ? `` : o.slice(0, s));
  if (i)
    return {
      totp: new Xi({ secret: a, issuer: l, label: c }),
      issuer: l,
      account: c,
      steam: i,
    };
  let u = Number(r.get(`period`) ?? 30),
    d = Number(r.get(`digits`) ?? 6);
  return !Number.isInteger(u) ||
    u < 1 ||
    !Number.isInteger(d) ||
    d < 1 ||
    d > 10
    ? null
    : {
        totp: new Ji({
          secret: a,
          issuer: l,
          label: c,
          algorithm: r.get(`algorithm`) ?? `SHA1`,
          digits: d,
          period: u,
        }),
        issuer: l,
        account: c,
        steam: i,
      };
}
function ea(e) {
  let t = e?.trim();
  if (!t) return null;
  try {
    if (/^otpauth:\/\//i.test(t)) return $i(t);
    if (/^steam:\/\//i.test(t)) {
      let e = Zi(t.slice(8));
      return e
        ? {
            totp: new Xi({ secret: e, issuer: `Steam`, label: `` }),
            issuer: `Steam`,
            account: ``,
            steam: !0,
          }
        : null;
    }
    let e = Zi(t);
    return e
      ? {
          totp: new Ji({ secret: e, algorithm: `SHA1`, digits: 6, period: 30 }),
          issuer: ``,
          account: ``,
          steam: !1,
        }
      : null;
  } catch {
    return null;
  }
}
var ta = [
  {
    re: /authenticatorApp\/activateAccount/i,
    vendor: `Microsoft Authenticator`,
  },
];
function na(e) {
  let t = e?.trim();
  if (!t) return { failure: `not-found` };
  if (ea(t)) return { uri: t };
  if (/^otpauth-migration:\/\//i.test(t)) return { failure: `migration` };
  for (let { re: e, vendor: n } of ta)
    if (e.test(t)) return { failure: `vendor-app`, vendor: n };
  return { failure: `not-totp` };
}
function ra(e) {
  return new Ji({
    secret: Gi.fromBase32(e.secret.replace(/[\s-]/g, ``).toUpperCase()),
    issuer: e.issuer ?? ``,
    label: e.account || `account`,
    algorithm: (e.algorithm ?? `SHA1`).toUpperCase(),
    digits: e.digits ?? 6,
    period: e.period ?? 30,
  }).toString();
}
function ia(e, t = Date.now()) {
  return {
    code: e.generate({ timestamp: t }),
    secondsRemaining: e.period - (Math.floor(t / 1e3) % e.period),
  };
}
function aa(e, t, n, r, i) {
  switch (e) {
    case `addy`:
      return nt({ baseUrl: n, domain: t.domain, format: t.format }, r, i);
    case `catchall`:
      return At({ domain: t.domain, style: t.style });
    case `duckduckgo`:
      return It({ baseUrl: n }, r, i);
    case `fastmail`:
      return Xt({ baseUrl: n }, r, i);
    case `relay`:
      return an({ baseUrl: n }, r, i);
    case `simplelogin`:
      return _n({ baseUrl: n, mode: t.mode, domain: t.domain }, r, i);
  }
}
function oa(e, t, n) {
  return aa(e.provider, e.options, e.baseUrl, t, n);
}
function sa(e = la(), t = typeof navigator < `u` ? navigator : {}) {
  return /firefox/i.test(e)
    ? `Firefox`
    : /edg\//i.test(e)
      ? `Edge`
      : /opr\//i.test(e)
        ? `Opera`
        : /chrome/i.test(e)
          ? t.brave
            ? `Brave`
            : `Chrome`
          : /safari/i.test(e)
            ? `Safari`
            : `Browser`;
}
function ca(e = la(), t = sa(e, {})) {
  return /android/i.test(e)
    ? `Android device`
    : /iphone/i.test(e)
      ? `iPhone`
      : /ipad/i.test(e)
        ? `iPad`
        : /macintosh|mac os x/i.test(e)
          ? `${t} on Mac`
          : /windows/i.test(e)
            ? `${t} on Windows`
            : /linux/i.test(e)
              ? `${t} on Linux`
              : t === `Browser`
                ? `This device`
                : t;
}
function la() {
  return typeof navigator < `u` ? navigator.userAgent : ``;
}
var ua = `vault.activeId`,
  da = `sync.openedVault`,
  fa = `vault.lastOpenedId`,
  pa = `cornerPrompt.handoff`,
  ma = `popout.anchorWindowId`;
async function ha() {
  let e = await t.windows
    .getLastFocused({ windowTypes: [`normal`] })
    .catch(() => void 0);
  if (e?.type === `normal`) return e;
  let n = await t.storage.session.get(ma).catch(() => ({})),
    r = (await t.windows.getAll().catch(() => [])).filter(
      (e) => e.type === `normal`,
    );
  return r.find((e) => e.id === n[`popout.anchorWindowId`]) ?? r[0];
}
async function ga() {
  let e = await ha();
  if (e?.id === void 0) return;
  let [n] = await t.tabs.query({ active: !0, windowId: e.id }).catch(() => []);
  try {
    return n?.url && /^https?:$/.test(new URL(n.url).protocol) ? n : void 0;
  } catch {
    return;
  }
}
function _a() {
  t.windows.onFocusChanged.addListener((e) => {
    e !== t.windows.WINDOW_ID_NONE &&
      t.windows
        .get(e)
        .then((n) =>
          n.type === `normal` ? t.storage.session.set({ [ma]: e }) : void 0,
        )
        .catch(() => {});
  });
}
async function va(e = t.runtime, n = navigator, r = navigator.userAgent) {
  if (typeof e.getBrowserInfo == `function`) {
    let t = await e.getBrowserInfo().catch(() => void 0);
    return t?.zen
      ? `Zen`
      : t?.name && t.name !== `Firefox`
        ? t.name
        : `Firefox`;
  }
  return (
    n.vendor === void 0 ? !(`userAgentData` in n) : /^Apple/.test(n.vendor)
  )
    ? `Orion`
    : sa(r, n);
}
async function ya() {
  return ca(navigator.userAgent, await va());
}
var ba = { permissions: [`privacy`] },
  xa = () => t.privacy?.services;
function Sa(e) {
  return [e.passwordSavingEnabled, e.autofillCreditCardEnabled].filter(
    (e) => !!e,
  );
}
function Ca(e) {
  return e.levelOfControl === `controlled_by_this_extension` && !e.value
    ? `bramble`
    : e.levelOfControl === `not_controllable` ||
        e.levelOfControl === `controlled_by_other_extensions`
      ? `locked`
      : `browser`;
}
async function wa() {
  try {
    if (!(await t.permissions.contains(ba))) return `browser`;
    let e = xa();
    if (!e?.passwordSavingEnabled) return `bramble`;
    let n = Ca(await e.passwordSavingEnabled.get({}));
    return n === `browser`
      ? (await Promise.allSettled(Sa(e).map((e) => e.set({ value: !1 }))),
        Ca(await e.passwordSavingEnabled.get({})))
      : n;
  } catch {
    return `browser`;
  }
}
async function Ta(e) {
  if (e) {
    if (!(await t.permissions.request(ba))) return `browser`;
  } else if (await t.permissions.contains(ba)) {
    let e = xa();
    (e && (await Promise.allSettled(Sa(e).map((e) => e.clear({})))),
      await t.permissions.remove(ba));
  }
  return wa();
}
function Ea(e, t) {
  return e.endsWith(t)
    ? e.length === t.length || e[e.length - t.length - 1] === `.`
    : !1;
}
function Da(e, t) {
  let n = e.length - t.length - 2,
    r = e.lastIndexOf(`.`, n);
  return r === -1 ? e : e.slice(r + 1);
}
function Oa(e, t, n) {
  if (n.validHosts !== null) {
    let e = n.validHosts;
    for (let n of e) if (Ea(t, n)) return n;
  }
  let r = 0;
  if (t.startsWith(`.`)) for (; r < t.length && t[r] === `.`;) r += 1;
  return e.length === t.length - r ? null : Da(t, e);
}
function ka(e, t) {
  return e.slice(0, -t.length - 1);
}
function Aa(e, t) {
  let n = 0,
    r = e.length,
    i = !1;
  if (!t) {
    if (e.startsWith(`data:`)) return null;
    for (; n < e.length && e.charCodeAt(n) <= 32;) n += 1;
    for (; r > n + 1 && e.charCodeAt(r - 1) <= 32;) --r;
    if (e.charCodeAt(n) === 47 && e.charCodeAt(n + 1) === 47) n += 2;
    else {
      let t = e.indexOf(`:/`, n);
      if (t !== -1) {
        let r = t - n,
          i = e.charCodeAt(n),
          a = e.charCodeAt(n + 1),
          o = e.charCodeAt(n + 2),
          s = e.charCodeAt(n + 3),
          c = e.charCodeAt(n + 4);
        if (
          (r !== 5 ||
            i !== 104 ||
            a !== 116 ||
            o !== 116 ||
            s !== 112 ||
            c !== 115) &&
          (r !== 4 || i !== 104 || a !== 116 || o !== 116 || s !== 112) &&
          (r !== 3 || i !== 119 || a !== 115 || o !== 115) &&
          (r !== 2 || i !== 119 || a !== 115)
        )
          for (let r = n; r < t; r += 1) {
            let t = e.charCodeAt(r) | 32;
            if (!(
              (t >= 97 && t <= 122) ||
              (t >= 48 && t <= 57) ||
              t === 46 ||
              t === 45 ||
              t === 43
            ))
              return null;
          }
        for (n = t + 2; e.charCodeAt(n) === 47;) n += 1;
      }
    }
    let t = -1,
      a = -1,
      o = -1;
    for (let s = n; s < r; s += 1) {
      let n = e.charCodeAt(s);
      if (n === 35 || n === 47 || n === 63) {
        r = s;
        break;
      }
      n === 64
        ? (t = s)
        : n === 93
          ? (a = s)
          : n === 58
            ? (o = s)
            : n >= 65 && n <= 90 && (i = !0);
    }
    if ((t !== -1 && t > n && t < r && (n = t + 1), e.charCodeAt(n) === 91))
      return a === -1 ? null : e.slice(n + 1, a).toLowerCase();
    o !== -1 && o > n && o < r && (r = o);
  }
  for (; r > n + 1 && e.charCodeAt(r - 1) === 46;) --r;
  let a = n !== 0 || r !== e.length ? e.slice(n, r) : e;
  return i ? a.toLowerCase() : a;
}
function ja(e) {
  if (e.length < 7 || e.length > 15) return !1;
  let t = 0;
  for (let n = 0; n < e.length; n += 1) {
    let r = e.charCodeAt(n);
    if (r === 46) t += 1;
    else if (r < 48 || r > 57) return !1;
  }
  return t === 3 && e.charCodeAt(0) !== 46 && e.charCodeAt(e.length - 1) !== 46;
}
function Ma(e) {
  if (e.length < 3) return !1;
  let t = +!!e.startsWith(`[`),
    n = e.length;
  if ((e[n - 1] === `]` && --n, n - t > 39)) return !1;
  let r = !1;
  for (; t < n; t += 1) {
    let n = e.charCodeAt(t);
    if (n === 58) r = !0;
    else if (!(
      (n >= 48 && n <= 57) ||
      (n >= 97 && n <= 102) ||
      (n >= 65 && n <= 90)
    ))
      return !1;
  }
  return r;
}
function Na(e) {
  return Ma(e) || ja(e);
}
function Pa(e) {
  return (e >= 97 && e <= 122) || (e >= 48 && e <= 57) || e > 127;
}
function Fa(e) {
  if (
    e.length > 255 ||
    e.length === 0 ||
    (!Pa(e.charCodeAt(0)) && e.charCodeAt(0) !== 46 && e.charCodeAt(0) !== 95)
  )
    return !1;
  let t = -1,
    n = -1,
    r = e.length;
  for (let i = 0; i < r; i += 1) {
    let r = e.charCodeAt(i);
    if (r === 46) {
      if (i - t > 64 || n === 46 || n === 45 || n === 95) return !1;
      t = i;
    } else if (!(Pa(r) || r === 45 || r === 95)) return !1;
    n = r;
  }
  return r - t - 1 <= 63 && n !== 45;
}
function Ia({
  allowIcannDomains: e = !0,
  allowPrivateDomains: t = !1,
  detectIp: n = !0,
  extractHostname: r = !0,
  mixedInputs: i = !0,
  validHosts: a = null,
  validateHostname: o = !0,
}) {
  return {
    allowIcannDomains: e,
    allowPrivateDomains: t,
    detectIp: n,
    extractHostname: r,
    mixedInputs: i,
    validHosts: a,
    validateHostname: o,
  };
}
var La = Ia({});
function Ra(e) {
  return e === void 0 ? La : Ia(e);
}
function za(e, t) {
  return t.length === e.length ? `` : e.slice(0, -t.length - 1);
}
function Ba() {
  return {
    domain: null,
    domainWithoutSuffix: null,
    hostname: null,
    isIcann: null,
    isIp: null,
    isPrivate: null,
    publicSuffix: null,
    subdomain: null,
  };
}
function Va(e) {
  ((e.domain = null),
    (e.domainWithoutSuffix = null),
    (e.hostname = null),
    (e.isIcann = null),
    (e.isIp = null),
    (e.isPrivate = null),
    (e.publicSuffix = null),
    (e.subdomain = null));
}
function Ha(e, t, n, r, i) {
  let a = Ra(r);
  return typeof e != `string` ||
    ((i.hostname = a.extractHostname
      ? a.mixedInputs
        ? Aa(e, Fa(e))
        : Aa(e, !1)
      : e),
    t === 0 || i.hostname === null) ||
    (a.detectIp && ((i.isIp = Na(i.hostname)), i.isIp))
    ? i
    : a.validateHostname && a.extractHostname && !Fa(i.hostname)
      ? ((i.hostname = null), i)
      : (n(i.hostname, a, i),
        t === 2 ||
          i.publicSuffix === null ||
          ((i.domain = Oa(i.publicSuffix, i.hostname, a)),
          t === 3 || i.domain === null) ||
          ((i.subdomain = za(i.hostname, i.domain)), t === 4) ||
          (i.domainWithoutSuffix = ka(i.domain, i.publicSuffix)),
        i);
}
function Ua(e, t, n) {
  if (!t.allowPrivateDomains && e.length > 3) {
    let t = e.length - 1,
      r = e.charCodeAt(t),
      i = e.charCodeAt(t - 1),
      a = e.charCodeAt(t - 2),
      o = e.charCodeAt(t - 3);
    if (r === 109 && i === 111 && a === 99 && o === 46)
      return (
        (n.isIcann = !0),
        (n.isPrivate = !1),
        (n.publicSuffix = `com`),
        !0
      );
    if (r === 103 && i === 114 && a === 111 && o === 46)
      return (
        (n.isIcann = !0),
        (n.isPrivate = !1),
        (n.publicSuffix = `org`),
        !0
      );
    if (r === 117 && i === 100 && a === 101 && o === 46)
      return (
        (n.isIcann = !0),
        (n.isPrivate = !1),
        (n.publicSuffix = `edu`),
        !0
      );
    if (r === 118 && i === 111 && a === 103 && o === 46)
      return (
        (n.isIcann = !0),
        (n.isPrivate = !1),
        (n.publicSuffix = `gov`),
        !0
      );
    if (r === 116 && i === 101 && a === 110 && o === 46)
      return (
        (n.isIcann = !0),
        (n.isPrivate = !1),
        (n.publicSuffix = `net`),
        !0
      );
    if (r === 101 && i === 100 && a === 46)
      return (
        (n.isIcann = !0),
        (n.isPrivate = !1),
        (n.publicSuffix = `de`),
        !0
      );
  }
  return !1;
}
var Wa = (function () {
    let e = [1, {}],
      t = [2, {}],
      n = [0, { city: e }];
    return [
      0,
      {
        ck: [0, { www: e }],
        jp: [
          0,
          {
            kawasaki: n,
            kitakyushu: n,
            kobe: n,
            nagoya: n,
            sapporo: n,
            sendai: n,
            yokohama: n,
          },
        ],
        dev: [
          0,
          {
            hrsn: [
              0,
              {
                psl: [0, { wc: [0, { ignored: t, sub: [0, { ignored: t }] }] }],
              },
            ],
          },
        ],
      },
    ];
  })(),
  Ga = (function () {
    let e = [1, {}],
      t = [2, {}],
      n = [1, { com: e, edu: e, gov: e, net: e, org: e }],
      r = [1, { com: e, edu: e, gov: e, mil: e, net: e, org: e }],
      i = [0, { "*": t }],
      a = [2, { s: i }],
      o = [0, { relay: t }],
      s = [2, { id: t }],
      c = [1, { gov: e }],
      l = [0, { "transfer-webapp": t }],
      u = [0, { notebook: t, studio: t }],
      d = [0, { labeling: t, notebook: t, studio: t }],
      f = [0, { notebook: t }],
      p = [0, { labeling: t, notebook: t, "notebook-fips": t, studio: t }],
      m = [0, { notebook: t, "notebook-fips": t, studio: t, "studio-fips": t }],
      h = [0, { "*": e }],
      g = [1, { co: t }],
      _ = [0, { objects: t }],
      v = [2, { nodes: t }],
      y = [0, { my: i }],
      b = [0, { s3: t, "s3-accesspoint": t, "s3-website": t }],
      x = [0, { s3: t, "s3-accesspoint": t }],
      S = [0, { direct: t }],
      C = [0, { "webview-assets": t }],
      w = [0, { vfs: t, "webview-assets": t }],
      T = [
        0,
        {
          "execute-api": t,
          "emrappui-prod": t,
          "emrnotebooks-prod": t,
          "emrstudio-prod": t,
          dualstack: b,
          s3: t,
          "s3-accesspoint": t,
          "s3-object-lambda": t,
          "s3-website": t,
          "aws-cloud9": C,
          cloud9: w,
        },
      ],
      E = [
        0,
        {
          "execute-api": t,
          "emrappui-prod": t,
          "emrnotebooks-prod": t,
          "emrstudio-prod": t,
          dualstack: x,
          s3: t,
          "s3-accesspoint": t,
          "s3-object-lambda": t,
          "s3-website": t,
          "aws-cloud9": C,
          cloud9: w,
        },
      ],
      D = [
        0,
        {
          "execute-api": t,
          "emrappui-prod": t,
          "emrnotebooks-prod": t,
          "emrstudio-prod": t,
          dualstack: b,
          s3: t,
          "s3-accesspoint": t,
          "s3-object-lambda": t,
          "s3-website": t,
          "analytics-gateway": t,
          "aws-cloud9": C,
          cloud9: w,
        },
      ],
      O = [
        0,
        {
          "execute-api": t,
          "emrappui-prod": t,
          "emrnotebooks-prod": t,
          "emrstudio-prod": t,
          dualstack: b,
          s3: t,
          "s3-accesspoint": t,
          "s3-object-lambda": t,
          "s3-website": t,
        },
      ],
      ee = [
        0,
        {
          s3: t,
          "s3-accesspoint": t,
          "s3-accesspoint-fips": t,
          "s3-fips": t,
          "s3-website": t,
        },
      ],
      te = [
        0,
        {
          "execute-api": t,
          "emrappui-prod": t,
          "emrnotebooks-prod": t,
          "emrstudio-prod": t,
          dualstack: ee,
          s3: t,
          "s3-accesspoint": t,
          "s3-accesspoint-fips": t,
          "s3-fips": t,
          "s3-object-lambda": t,
          "s3-website": t,
          "aws-cloud9": C,
          cloud9: w,
        },
      ],
      ne = [
        0,
        {
          "execute-api": t,
          "emrappui-prod": t,
          "emrnotebooks-prod": t,
          "emrstudio-prod": t,
          dualstack: ee,
          s3: t,
          "s3-accesspoint": t,
          "s3-accesspoint-fips": t,
          "s3-deprecated": t,
          "s3-fips": t,
          "s3-object-lambda": t,
          "s3-website": t,
          "analytics-gateway": t,
          "aws-cloud9": C,
          cloud9: w,
        },
      ],
      k = [
        0,
        {
          "execute-api": t,
          "emrappui-prod": t,
          "emrnotebooks-prod": t,
          "emrstudio-prod": t,
          dualstack: [
            0,
            {
              s3: t,
              "s3-accesspoint": t,
              "s3-accesspoint-fips": t,
              "s3-fips": t,
            },
          ],
          s3: t,
          "s3-accesspoint": t,
          "s3-accesspoint-fips": t,
          "s3-fips": t,
          "s3-object-lambda": t,
          "s3-website": t,
        },
      ],
      A = [0, { auth: t }],
      re = [0, { auth: t, "auth-fips": t }],
      ie = [0, { "auth-fips": t }],
      ae = [0, { apps: t }],
      oe = [0, { paas: t }],
      se = [2, { eu: t }],
      j = [0, { app: t }],
      ce = [0, { site: t }],
      M = [1, { com: e, edu: e, net: e, org: e }],
      le = [0, { j: t }],
      ue = [0, { dyn: t }],
      de = [1, { co: e, com: e, edu: e, gov: e, net: e, org: e }],
      fe = [0, { p: t }],
      pe = [0, { user: t }],
      me = [0, { shop: t }],
      N = [0, { cdn: t }],
      he = [0, { cust: t, reservd: t }],
      ge = [0, { cust: t }],
      _e = [0, { s3: t }],
      ve = [1, { biz: e, com: e, edu: e, gov: e, info: e, net: e, org: e }],
      ye = [0, { ipfs: t }],
      be = [1, { framer: t }],
      P = [0, { forgot: t }],
      F = [1, { gs: e }],
      xe = [0, { nes: e }],
      I = [1, { k12: e, cc: e, lib: e }],
      Se = [1, { cc: e, lib: e }];
    return [
      0,
      {
        ac: [
          1,
          {
            com: e,
            edu: e,
            gov: e,
            mil: e,
            net: e,
            org: e,
            drr: t,
            feedback: t,
            forms: t,
          },
        ],
        ad: e,
        ae: [1, { ac: e, co: e, gov: e, mil: e, net: e, org: e, sch: e }],
        aero: [
          1,
          {
            airline: e,
            airport: e,
            "accident-investigation": e,
            "accident-prevention": e,
            aerobatic: e,
            aeroclub: e,
            aerodrome: e,
            agents: e,
            "air-surveillance": e,
            "air-traffic-control": e,
            aircraft: e,
            airtraffic: e,
            ambulance: e,
            association: e,
            author: e,
            ballooning: e,
            broker: e,
            caa: e,
            cargo: e,
            catering: e,
            certification: e,
            championship: e,
            charter: e,
            civilaviation: e,
            club: e,
            conference: e,
            consultant: e,
            consulting: e,
            control: e,
            council: e,
            crew: e,
            design: e,
            dgca: e,
            educator: e,
            emergency: e,
            engine: e,
            engineer: e,
            entertainment: e,
            equipment: e,
            exchange: e,
            express: e,
            federation: e,
            flight: e,
            freight: e,
            fuel: e,
            gliding: e,
            government: e,
            groundhandling: e,
            group: e,
            hanggliding: e,
            homebuilt: e,
            insurance: e,
            journal: e,
            journalist: e,
            leasing: e,
            logistics: e,
            magazine: e,
            maintenance: e,
            marketplace: e,
            media: e,
            microlight: e,
            modelling: e,
            navigation: e,
            parachuting: e,
            paragliding: e,
            "passenger-association": e,
            pilot: e,
            press: e,
            production: e,
            recreation: e,
            repbody: e,
            res: e,
            research: e,
            rotorcraft: e,
            safety: e,
            scientist: e,
            services: e,
            show: e,
            skydiving: e,
            software: e,
            student: e,
            taxi: e,
            trader: e,
            trading: e,
            trainer: e,
            union: e,
            workinggroup: e,
            works: e,
          },
        ],
        af: n,
        ag: [1, { co: e, com: e, net: e, nom: e, org: e, obj: t }],
        ai: [1, { com: e, net: e, off: e, org: e, uwu: t, framer: t }],
        al: r,
        am: [1, { co: e, com: e, commune: e, net: e, org: e, radio: t }],
        ao: [
          1,
          { co: e, ed: e, edu: e, gov: e, gv: e, it: e, og: e, org: e, pb: e },
        ],
        aq: e,
        ar: [
          1,
          {
            bet: e,
            com: e,
            coop: e,
            edu: e,
            gob: e,
            gov: e,
            int: e,
            mil: e,
            musica: e,
            mutual: e,
            net: e,
            org: e,
            seg: e,
            senasa: e,
            tur: e,
          },
        ],
        arpa: [
          1,
          { e164: e, home: e, "in-addr": e, ip6: e, iris: e, uri: e, urn: e },
        ],
        as: c,
        asia: [1, { cloudns: t, daemon: t, dix: t }],
        at: [
          1,
          {
            ac: [1, { sth: e }],
            co: e,
            gv: e,
            or: e,
            funkfeuer: [0, { wien: t }],
            futurecms: [0, { "*": t, ex: i, in: i }],
            futurehosting: t,
            futuremailing: t,
            ortsinfo: [0, { ex: i, kunden: i }],
            biz: t,
            info: t,
            "123webseite": t,
            priv: t,
            myspreadshop: t,
            "12hp": t,
            "2ix": t,
            "4lima": t,
            "lima-city": t,
          },
        ],
        au: [
          1,
          {
            asn: e,
            com: [1, { cloudlets: [0, { mel: t }], myspreadshop: t }],
            edu: [
              1,
              {
                act: e,
                catholic: e,
                nsw: [1, { schools: e }],
                nt: e,
                qld: e,
                sa: e,
                tas: e,
                vic: e,
                wa: e,
              },
            ],
            gov: [1, { qld: e, sa: e, tas: e, vic: e, wa: e }],
            id: e,
            net: e,
            org: e,
            conf: e,
            oz: e,
            act: e,
            nsw: e,
            nt: e,
            qld: e,
            sa: e,
            tas: e,
            vic: e,
            wa: e,
          },
        ],
        aw: [1, { com: e }],
        ax: e,
        az: [
          1,
          {
            biz: e,
            co: e,
            com: e,
            edu: e,
            gov: e,
            info: e,
            int: e,
            mil: e,
            name: e,
            net: e,
            org: e,
            pp: e,
            pro: e,
          },
        ],
        ba: [1, { com: e, edu: e, gov: e, mil: e, net: e, org: e, rs: t }],
        bb: [
          1,
          {
            biz: e,
            co: e,
            com: e,
            edu: e,
            gov: e,
            info: e,
            net: e,
            org: e,
            store: e,
            tv: e,
          },
        ],
        bd: h,
        be: [
          1,
          {
            ac: e,
            cloudns: t,
            webhosting: t,
            interhostsolutions: [0, { cloud: t }],
            kuleuven: [0, { ezproxy: t }],
            "123website": t,
            myspreadshop: t,
            transurl: i,
          },
        ],
        bf: c,
        bg: [
          1,
          {
            0: e,
            1: e,
            2: e,
            3: e,
            4: e,
            5: e,
            6: e,
            7: e,
            8: e,
            9: e,
            a: e,
            b: e,
            c: e,
            d: e,
            e,
            f: e,
            g: e,
            h: e,
            i: e,
            j: e,
            k: e,
            l: e,
            m: e,
            n: e,
            o: e,
            p: e,
            q: e,
            r: e,
            s: e,
            t: e,
            u: e,
            v: e,
            w: e,
            x: e,
            y: e,
            z: e,
            barsy: t,
          },
        ],
        bh: n,
        bi: [1, { co: e, com: e, edu: e, or: e, org: e }],
        biz: [
          1,
          {
            activetrail: t,
            "cloud-ip": t,
            cloudns: t,
            jozi: t,
            dyndns: t,
            "for-better": t,
            "for-more": t,
            "for-some": t,
            "for-the": t,
            selfip: t,
            webhop: t,
            orx: t,
            mmafan: t,
            myftp: t,
            "no-ip": t,
            dscloud: t,
          },
        ],
        bj: [
          1,
          {
            africa: e,
            agro: e,
            architectes: e,
            assur: e,
            avocats: e,
            co: e,
            com: e,
            eco: e,
            econo: e,
            edu: e,
            info: e,
            loisirs: e,
            money: e,
            net: e,
            org: e,
            ote: e,
            restaurant: e,
            resto: e,
            tourism: e,
            univ: e,
          },
        ],
        bm: n,
        bn: [1, { com: e, edu: e, gov: e, net: e, org: e, co: t }],
        bo: [
          1,
          {
            com: e,
            edu: e,
            gob: e,
            int: e,
            mil: e,
            net: e,
            org: e,
            tv: e,
            web: e,
            academia: e,
            agro: e,
            arte: e,
            blog: e,
            bolivia: e,
            ciencia: e,
            cooperativa: e,
            democracia: e,
            deporte: e,
            ecologia: e,
            economia: e,
            empresa: e,
            indigena: e,
            industria: e,
            info: e,
            medicina: e,
            movimiento: e,
            musica: e,
            natural: e,
            nombre: e,
            noticias: e,
            patria: e,
            plurinacional: e,
            politica: e,
            profesional: e,
            pueblo: e,
            revista: e,
            salud: e,
            tecnologia: e,
            tksat: e,
            transporte: e,
            wiki: e,
          },
        ],
        br: [
          1,
          {
            "9guacu": e,
            abc: e,
            adm: e,
            adv: e,
            agr: e,
            aju: e,
            am: e,
            anani: e,
            aparecida: e,
            app: e,
            arq: e,
            art: e,
            ato: e,
            b: e,
            barueri: e,
            belem: e,
            bet: e,
            bhz: e,
            bib: e,
            bio: e,
            blog: e,
            bmd: e,
            boavista: e,
            bsb: e,
            campinagrande: e,
            campinas: e,
            caxias: e,
            cim: e,
            cng: e,
            cnt: e,
            com: [1, { simplesite: t }],
            contagem: e,
            coop: e,
            coz: e,
            cri: e,
            cuiaba: e,
            curitiba: e,
            def: e,
            des: e,
            det: e,
            dev: e,
            ecn: e,
            eco: e,
            edu: e,
            emp: e,
            enf: e,
            eng: e,
            esp: e,
            etc: e,
            eti: e,
            far: e,
            feira: e,
            flog: e,
            floripa: e,
            fm: e,
            fnd: e,
            fortal: e,
            fot: e,
            foz: e,
            fst: e,
            g12: e,
            geo: e,
            ggf: e,
            goiania: e,
            gov: [
              1,
              {
                ac: e,
                al: e,
                am: e,
                ap: e,
                ba: e,
                ce: e,
                df: e,
                es: e,
                go: e,
                ma: e,
                mg: e,
                ms: e,
                mt: e,
                pa: e,
                pb: e,
                pe: e,
                pi: e,
                pr: e,
                rj: e,
                rn: e,
                ro: e,
                rr: e,
                rs: e,
                sc: e,
                se: e,
                sp: e,
                to: e,
              },
            ],
            gru: e,
            imb: e,
            ind: e,
            inf: e,
            jab: e,
            jampa: e,
            jdf: e,
            joinville: e,
            jor: e,
            jus: e,
            leg: [
              1,
              {
                ac: t,
                al: t,
                am: t,
                ap: t,
                ba: t,
                ce: t,
                df: t,
                es: t,
                go: t,
                ma: t,
                mg: t,
                ms: t,
                mt: t,
                pa: t,
                pb: t,
                pe: t,
                pi: t,
                pr: t,
                rj: t,
                rn: t,
                ro: t,
                rr: t,
                rs: t,
                sc: t,
                se: t,
                sp: t,
                to: t,
              },
            ],
            leilao: e,
            lel: e,
            log: e,
            londrina: e,
            macapa: e,
            maceio: e,
            manaus: e,
            maringa: e,
            mat: e,
            med: e,
            mil: e,
            morena: e,
            mp: e,
            mus: e,
            natal: e,
            net: e,
            niteroi: e,
            nom: h,
            not: e,
            ntr: e,
            odo: e,
            ong: e,
            org: e,
            osasco: e,
            palmas: e,
            poa: e,
            ppg: e,
            pro: e,
            psc: e,
            psi: e,
            pvh: e,
            qsl: e,
            radio: e,
            rec: e,
            recife: e,
            rep: e,
            ribeirao: e,
            rio: e,
            riobranco: e,
            riopreto: e,
            salvador: e,
            sampa: e,
            santamaria: e,
            santoandre: e,
            saobernardo: e,
            saogonca: e,
            seg: e,
            sjc: e,
            slg: e,
            slz: e,
            sorocaba: e,
            srv: e,
            taxi: e,
            tc: e,
            tec: e,
            teo: e,
            the: e,
            tmp: e,
            trd: e,
            tur: e,
            tv: e,
            udi: e,
            vet: e,
            vix: e,
            vlog: e,
            wiki: e,
            zlg: e,
          },
        ],
        bs: [1, { com: e, edu: e, gov: e, net: e, org: e, we: t }],
        bt: n,
        bv: e,
        bw: [1, { ac: e, co: e, gov: e, net: e, org: e }],
        by: [1, { gov: e, mil: e, com: e, of: e, mediatech: t }],
        bz: [
          1,
          {
            co: e,
            com: e,
            edu: e,
            gov: e,
            net: e,
            org: e,
            za: t,
            mydns: t,
            gsj: t,
          },
        ],
        ca: [
          1,
          {
            ab: e,
            bc: e,
            mb: e,
            nb: e,
            nf: e,
            nl: e,
            ns: e,
            nt: e,
            nu: e,
            on: e,
            pe: e,
            qc: e,
            sk: e,
            yk: e,
            gc: e,
            barsy: t,
            awdev: i,
            co: t,
            "no-ip": t,
            myspreadshop: t,
            box: t,
          },
        ],
        cat: e,
        cc: [
          1,
          {
            cleverapps: t,
            cloudns: t,
            ftpaccess: t,
            "game-server": t,
            myphotos: t,
            scrapping: t,
            twmail: t,
            csx: t,
            fantasyleague: t,
            spawn: [0, { instances: t }],
          },
        ],
        cd: c,
        cf: e,
        cg: e,
        ch: [
          1,
          {
            square7: t,
            cloudns: t,
            cloudscale: [0, { cust: t, lpg: _, rma: _ }],
            flow: [0, { ae: [0, { alp1: t }], appengine: t }],
            "linkyard-cloud": t,
            gotdns: t,
            dnsking: t,
            "123website": t,
            myspreadshop: t,
            firenet: [0, { "*": t, svc: i }],
            "12hp": t,
            "2ix": t,
            "4lima": t,
            "lima-city": t,
          },
        ],
        ci: [
          1,
          {
            ac: e,
            "xn--aroport-bya": e,
            aéroport: e,
            asso: e,
            co: e,
            com: e,
            ed: e,
            edu: e,
            go: e,
            gouv: e,
            int: e,
            net: e,
            or: e,
            org: e,
          },
        ],
        ck: h,
        cl: [1, { co: e, gob: e, gov: e, mil: e, cloudns: t }],
        cm: [1, { co: e, com: e, gov: e, net: e }],
        cn: [
          1,
          {
            ac: e,
            com: [
              1,
              {
                amazonaws: [
                  0,
                  {
                    "cn-north-1": [
                      0,
                      {
                        "execute-api": t,
                        "emrappui-prod": t,
                        "emrnotebooks-prod": t,
                        "emrstudio-prod": t,
                        dualstack: b,
                        s3: t,
                        "s3-accesspoint": t,
                        "s3-deprecated": t,
                        "s3-object-lambda": t,
                        "s3-website": t,
                      },
                    ],
                    "cn-northwest-1": [
                      0,
                      {
                        "execute-api": t,
                        "emrappui-prod": t,
                        "emrnotebooks-prod": t,
                        "emrstudio-prod": t,
                        dualstack: x,
                        s3: t,
                        "s3-accesspoint": t,
                        "s3-object-lambda": t,
                        "s3-website": t,
                      },
                    ],
                    compute: i,
                    airflow: [0, { "cn-north-1": i, "cn-northwest-1": i }],
                    eb: [0, { "cn-north-1": t, "cn-northwest-1": t }],
                    elb: i,
                  },
                ],
                sagemaker: [0, { "cn-north-1": u, "cn-northwest-1": u }],
              },
            ],
            edu: e,
            gov: e,
            mil: e,
            net: e,
            org: e,
            "xn--55qx5d": e,
            公司: e,
            "xn--od0alg": e,
            網絡: e,
            "xn--io0a7i": e,
            网络: e,
            ah: e,
            bj: e,
            cq: e,
            fj: e,
            gd: e,
            gs: e,
            gx: e,
            gz: e,
            ha: e,
            hb: e,
            he: e,
            hi: e,
            hk: e,
            hl: e,
            hn: e,
            jl: e,
            js: e,
            jx: e,
            ln: e,
            mo: e,
            nm: e,
            nx: e,
            qh: e,
            sc: e,
            sd: e,
            sh: [1, { as: t }],
            sn: e,
            sx: e,
            tj: e,
            tw: e,
            xj: e,
            xz: e,
            yn: e,
            zj: e,
            "canva-apps": t,
            canvasite: y,
            myqnapcloud: t,
            quickconnect: S,
          },
        ],
        co: [
          1,
          {
            com: e,
            edu: e,
            gov: e,
            mil: e,
            net: e,
            nom: e,
            org: e,
            carrd: t,
            crd: t,
            otap: i,
            leadpages: t,
            lpages: t,
            mypi: t,
            xmit: i,
            firewalledreplit: s,
            repl: s,
            supabase: t,
          },
        ],
        com: [
          1,
          {
            a2hosted: t,
            cpserver: t,
            adobeaemcloud: [2, { dev: i }],
            africa: t,
            airkitapps: t,
            "airkitapps-au": t,
            aivencloud: t,
            alibabacloudcs: t,
            kasserver: t,
            amazonaws: [
              0,
              {
                "af-south-1": T,
                "ap-east-1": E,
                "ap-northeast-1": D,
                "ap-northeast-2": D,
                "ap-northeast-3": T,
                "ap-south-1": D,
                "ap-south-2": O,
                "ap-southeast-1": D,
                "ap-southeast-2": D,
                "ap-southeast-3": O,
                "ap-southeast-4": O,
                "ap-southeast-5": [
                  0,
                  {
                    "execute-api": t,
                    dualstack: b,
                    s3: t,
                    "s3-accesspoint": t,
                    "s3-deprecated": t,
                    "s3-object-lambda": t,
                    "s3-website": t,
                  },
                ],
                "ca-central-1": te,
                "ca-west-1": [
                  0,
                  {
                    "execute-api": t,
                    "emrappui-prod": t,
                    "emrnotebooks-prod": t,
                    "emrstudio-prod": t,
                    dualstack: ee,
                    s3: t,
                    "s3-accesspoint": t,
                    "s3-accesspoint-fips": t,
                    "s3-fips": t,
                    "s3-object-lambda": t,
                    "s3-website": t,
                  },
                ],
                "eu-central-1": D,
                "eu-central-2": O,
                "eu-north-1": E,
                "eu-south-1": T,
                "eu-south-2": O,
                "eu-west-1": [
                  0,
                  {
                    "execute-api": t,
                    "emrappui-prod": t,
                    "emrnotebooks-prod": t,
                    "emrstudio-prod": t,
                    dualstack: b,
                    s3: t,
                    "s3-accesspoint": t,
                    "s3-deprecated": t,
                    "s3-object-lambda": t,
                    "s3-website": t,
                    "analytics-gateway": t,
                    "aws-cloud9": C,
                    cloud9: w,
                  },
                ],
                "eu-west-2": E,
                "eu-west-3": T,
                "il-central-1": [
                  0,
                  {
                    "execute-api": t,
                    "emrappui-prod": t,
                    "emrnotebooks-prod": t,
                    "emrstudio-prod": t,
                    dualstack: b,
                    s3: t,
                    "s3-accesspoint": t,
                    "s3-object-lambda": t,
                    "s3-website": t,
                    "aws-cloud9": C,
                    cloud9: [0, { vfs: t }],
                  },
                ],
                "me-central-1": O,
                "me-south-1": E,
                "sa-east-1": T,
                "us-east-1": [
                  2,
                  {
                    "execute-api": t,
                    "emrappui-prod": t,
                    "emrnotebooks-prod": t,
                    "emrstudio-prod": t,
                    dualstack: ee,
                    s3: t,
                    "s3-accesspoint": t,
                    "s3-accesspoint-fips": t,
                    "s3-deprecated": t,
                    "s3-fips": t,
                    "s3-object-lambda": t,
                    "s3-website": t,
                    "analytics-gateway": t,
                    "aws-cloud9": C,
                    cloud9: w,
                  },
                ],
                "us-east-2": ne,
                "us-gov-east-1": k,
                "us-gov-west-1": k,
                "us-west-1": te,
                "us-west-2": ne,
                compute: i,
                "compute-1": i,
                airflow: [
                  0,
                  {
                    "af-south-1": i,
                    "ap-east-1": i,
                    "ap-northeast-1": i,
                    "ap-northeast-2": i,
                    "ap-northeast-3": i,
                    "ap-south-1": i,
                    "ap-south-2": i,
                    "ap-southeast-1": i,
                    "ap-southeast-2": i,
                    "ap-southeast-3": i,
                    "ap-southeast-4": i,
                    "ca-central-1": i,
                    "ca-west-1": i,
                    "eu-central-1": i,
                    "eu-central-2": i,
                    "eu-north-1": i,
                    "eu-south-1": i,
                    "eu-south-2": i,
                    "eu-west-1": i,
                    "eu-west-2": i,
                    "eu-west-3": i,
                    "il-central-1": i,
                    "me-central-1": i,
                    "me-south-1": i,
                    "sa-east-1": i,
                    "us-east-1": i,
                    "us-east-2": i,
                    "us-west-1": i,
                    "us-west-2": i,
                  },
                ],
                s3: t,
                "s3-1": t,
                "s3-ap-east-1": t,
                "s3-ap-northeast-1": t,
                "s3-ap-northeast-2": t,
                "s3-ap-northeast-3": t,
                "s3-ap-south-1": t,
                "s3-ap-southeast-1": t,
                "s3-ap-southeast-2": t,
                "s3-ca-central-1": t,
                "s3-eu-central-1": t,
                "s3-eu-north-1": t,
                "s3-eu-west-1": t,
                "s3-eu-west-2": t,
                "s3-eu-west-3": t,
                "s3-external-1": t,
                "s3-fips-us-gov-east-1": t,
                "s3-fips-us-gov-west-1": t,
                "s3-global": [0, { accesspoint: [0, { mrap: t }] }],
                "s3-me-south-1": t,
                "s3-sa-east-1": t,
                "s3-us-east-2": t,
                "s3-us-gov-east-1": t,
                "s3-us-gov-west-1": t,
                "s3-us-west-1": t,
                "s3-us-west-2": t,
                "s3-website-ap-northeast-1": t,
                "s3-website-ap-southeast-1": t,
                "s3-website-ap-southeast-2": t,
                "s3-website-eu-west-1": t,
                "s3-website-sa-east-1": t,
                "s3-website-us-east-1": t,
                "s3-website-us-gov-west-1": t,
                "s3-website-us-west-1": t,
                "s3-website-us-west-2": t,
                elb: i,
              },
            ],
            amazoncognito: [
              0,
              {
                "af-south-1": A,
                "ap-east-1": A,
                "ap-northeast-1": A,
                "ap-northeast-2": A,
                "ap-northeast-3": A,
                "ap-south-1": A,
                "ap-south-2": A,
                "ap-southeast-1": A,
                "ap-southeast-2": A,
                "ap-southeast-3": A,
                "ap-southeast-4": A,
                "ap-southeast-5": A,
                "ca-central-1": A,
                "ca-west-1": A,
                "eu-central-1": A,
                "eu-central-2": A,
                "eu-north-1": A,
                "eu-south-1": A,
                "eu-south-2": A,
                "eu-west-1": A,
                "eu-west-2": A,
                "eu-west-3": A,
                "il-central-1": A,
                "me-central-1": A,
                "me-south-1": A,
                "sa-east-1": A,
                "us-east-1": re,
                "us-east-2": re,
                "us-gov-east-1": ie,
                "us-gov-west-1": ie,
                "us-west-1": re,
                "us-west-2": re,
              },
            ],
            amplifyapp: t,
            awsapprunner: i,
            awsapps: t,
            elasticbeanstalk: [
              2,
              {
                "af-south-1": t,
                "ap-east-1": t,
                "ap-northeast-1": t,
                "ap-northeast-2": t,
                "ap-northeast-3": t,
                "ap-south-1": t,
                "ap-southeast-1": t,
                "ap-southeast-2": t,
                "ap-southeast-3": t,
                "ca-central-1": t,
                "eu-central-1": t,
                "eu-north-1": t,
                "eu-south-1": t,
                "eu-west-1": t,
                "eu-west-2": t,
                "eu-west-3": t,
                "il-central-1": t,
                "me-south-1": t,
                "sa-east-1": t,
                "us-east-1": t,
                "us-east-2": t,
                "us-gov-east-1": t,
                "us-gov-west-1": t,
                "us-west-1": t,
                "us-west-2": t,
              },
            ],
            awsglobalaccelerator: t,
            siiites: t,
            appspacehosted: t,
            appspaceusercontent: t,
            "on-aptible": t,
            myasustor: t,
            "balena-devices": t,
            boutir: t,
            bplaced: t,
            cafjs: t,
            "canva-apps": t,
            "cdn77-storage": t,
            br: t,
            cn: t,
            de: t,
            eu: t,
            jpn: t,
            mex: t,
            ru: t,
            sa: t,
            uk: t,
            us: t,
            za: t,
            "clever-cloud": [0, { services: i }],
            dnsabr: t,
            "ip-ddns": t,
            jdevcloud: t,
            wpdevcloud: t,
            "cf-ipfs": t,
            "cloudflare-ipfs": t,
            trycloudflare: t,
            co: t,
            devinapps: i,
            builtwithdark: t,
            datadetect: [0, { demo: t, instance: t }],
            dattolocal: t,
            dattorelay: t,
            dattoweb: t,
            mydatto: t,
            digitaloceanspaces: i,
            discordsays: t,
            discordsez: t,
            drayddns: t,
            dreamhosters: t,
            durumis: t,
            mydrobo: t,
            blogdns: t,
            cechire: t,
            dnsalias: t,
            dnsdojo: t,
            doesntexist: t,
            dontexist: t,
            doomdns: t,
            "dyn-o-saur": t,
            dynalias: t,
            "dyndns-at-home": t,
            "dyndns-at-work": t,
            "dyndns-blog": t,
            "dyndns-free": t,
            "dyndns-home": t,
            "dyndns-ip": t,
            "dyndns-mail": t,
            "dyndns-office": t,
            "dyndns-pics": t,
            "dyndns-remote": t,
            "dyndns-server": t,
            "dyndns-web": t,
            "dyndns-wiki": t,
            "dyndns-work": t,
            "est-a-la-maison": t,
            "est-a-la-masion": t,
            "est-le-patron": t,
            "est-mon-blogueur": t,
            "from-ak": t,
            "from-al": t,
            "from-ar": t,
            "from-ca": t,
            "from-ct": t,
            "from-dc": t,
            "from-de": t,
            "from-fl": t,
            "from-ga": t,
            "from-hi": t,
            "from-ia": t,
            "from-id": t,
            "from-il": t,
            "from-in": t,
            "from-ks": t,
            "from-ky": t,
            "from-ma": t,
            "from-md": t,
            "from-mi": t,
            "from-mn": t,
            "from-mo": t,
            "from-ms": t,
            "from-mt": t,
            "from-nc": t,
            "from-nd": t,
            "from-ne": t,
            "from-nh": t,
            "from-nj": t,
            "from-nm": t,
            "from-nv": t,
            "from-oh": t,
            "from-ok": t,
            "from-or": t,
            "from-pa": t,
            "from-pr": t,
            "from-ri": t,
            "from-sc": t,
            "from-sd": t,
            "from-tn": t,
            "from-tx": t,
            "from-ut": t,
            "from-va": t,
            "from-vt": t,
            "from-wa": t,
            "from-wi": t,
            "from-wv": t,
            "from-wy": t,
            getmyip: t,
            gotdns: t,
            "hobby-site": t,
            homelinux: t,
            homeunix: t,
            iamallama: t,
            "is-a-anarchist": t,
            "is-a-blogger": t,
            "is-a-bookkeeper": t,
            "is-a-bulls-fan": t,
            "is-a-caterer": t,
            "is-a-chef": t,
            "is-a-conservative": t,
            "is-a-cpa": t,
            "is-a-cubicle-slave": t,
            "is-a-democrat": t,
            "is-a-designer": t,
            "is-a-doctor": t,
            "is-a-financialadvisor": t,
            "is-a-geek": t,
            "is-a-green": t,
            "is-a-guru": t,
            "is-a-hard-worker": t,
            "is-a-hunter": t,
            "is-a-landscaper": t,
            "is-a-lawyer": t,
            "is-a-liberal": t,
            "is-a-libertarian": t,
            "is-a-llama": t,
            "is-a-musician": t,
            "is-a-nascarfan": t,
            "is-a-nurse": t,
            "is-a-painter": t,
            "is-a-personaltrainer": t,
            "is-a-photographer": t,
            "is-a-player": t,
            "is-a-republican": t,
            "is-a-rockstar": t,
            "is-a-socialist": t,
            "is-a-student": t,
            "is-a-teacher": t,
            "is-a-techie": t,
            "is-a-therapist": t,
            "is-an-accountant": t,
            "is-an-actor": t,
            "is-an-actress": t,
            "is-an-anarchist": t,
            "is-an-artist": t,
            "is-an-engineer": t,
            "is-an-entertainer": t,
            "is-certified": t,
            "is-gone": t,
            "is-into-anime": t,
            "is-into-cars": t,
            "is-into-cartoons": t,
            "is-into-games": t,
            "is-leet": t,
            "is-not-certified": t,
            "is-slick": t,
            "is-uberleet": t,
            "is-with-theband": t,
            "isa-geek": t,
            "isa-hockeynut": t,
            issmarterthanyou: t,
            "likes-pie": t,
            likescandy: t,
            "neat-url": t,
            "saves-the-whales": t,
            selfip: t,
            "sells-for-less": t,
            "sells-for-u": t,
            servebbs: t,
            "simple-url": t,
            "space-to-rent": t,
            "teaches-yoga": t,
            writesthisblog: t,
            ddnsfree: t,
            ddnsgeek: t,
            giize: t,
            gleeze: t,
            kozow: t,
            loseyourip: t,
            ooguy: t,
            theworkpc: t,
            mytuleap: t,
            "tuleap-partners": t,
            encoreapi: t,
            evennode: [
              0,
              {
                "eu-1": t,
                "eu-2": t,
                "eu-3": t,
                "eu-4": t,
                "us-1": t,
                "us-2": t,
                "us-3": t,
                "us-4": t,
              },
            ],
            onfabrica: t,
            "fastly-edge": t,
            "fastly-terrarium": t,
            "fastvps-server": t,
            mydobiss: t,
            firebaseapp: t,
            fldrv: t,
            forgeblocks: t,
            framercanvas: t,
            "freebox-os": t,
            freeboxos: t,
            freemyip: t,
            aliases121: t,
            gentapps: t,
            gentlentapis: t,
            githubusercontent: t,
            "0emm": i,
            appspot: [2, { r: i }],
            blogspot: t,
            codespot: t,
            googleapis: t,
            googlecode: t,
            pagespeedmobilizer: t,
            withgoogle: t,
            withyoutube: t,
            grayjayleagues: t,
            hatenablog: t,
            hatenadiary: t,
            herokuapp: t,
            gr: t,
            smushcdn: t,
            wphostedmail: t,
            wpmucdn: t,
            pixolino: t,
            "apps-1and1": t,
            "live-website": t,
            dopaas: t,
            "hosted-by-previder": oe,
            hosteur: [0, { "rag-cloud": t, "rag-cloud-ch": t }],
            "ik-server": [0, { jcloud: t, "jcloud-ver-jpc": t }],
            jelastic: [0, { demo: t }],
            massivegrid: oe,
            wafaicloud: [0, { jed: t, ryd: t }],
            webadorsite: t,
            joyent: [0, { cns: i }],
            lpusercontent: t,
            linode: [0, { members: t, nodebalancer: i }],
            linodeobjects: i,
            linodeusercontent: [0, { ip: t }],
            localtonet: t,
            lovableproject: t,
            barsycenter: t,
            barsyonline: t,
            modelscape: t,
            mwcloudnonprod: t,
            polyspace: t,
            mazeplay: t,
            miniserver: t,
            atmeta: t,
            fbsbx: ae,
            meteorapp: se,
            routingthecloud: t,
            mydbserver: t,
            hostedpi: t,
            "mythic-beasts": [
              0,
              {
                caracal: t,
                customer: t,
                fentiger: t,
                lynx: t,
                ocelot: t,
                oncilla: t,
                onza: t,
                sphinx: t,
                vs: t,
                x: t,
                yali: t,
              },
            ],
            nospamproxy: [0, { cloud: [2, { o365: t }] }],
            "4u": t,
            nfshost: t,
            "3utilities": t,
            blogsyte: t,
            ciscofreak: t,
            damnserver: t,
            ddnsking: t,
            ditchyourip: t,
            dnsiskinky: t,
            dynns: t,
            geekgalaxy: t,
            "health-carereform": t,
            homesecuritymac: t,
            homesecuritypc: t,
            myactivedirectory: t,
            mysecuritycamera: t,
            myvnc: t,
            "net-freaks": t,
            onthewifi: t,
            point2this: t,
            quicksytes: t,
            securitytactics: t,
            servebeer: t,
            servecounterstrike: t,
            serveexchange: t,
            serveftp: t,
            servegame: t,
            servehalflife: t,
            servehttp: t,
            servehumour: t,
            serveirc: t,
            servemp3: t,
            servep2p: t,
            servepics: t,
            servequake: t,
            servesarcasm: t,
            stufftoread: t,
            unusualperson: t,
            workisboring: t,
            myiphost: t,
            observableusercontent: [0, { static: t }],
            simplesite: t,
            orsites: t,
            operaunite: t,
            "customer-oci": [0, { "*": t, oci: i, ocp: i, ocs: i }],
            oraclecloudapps: i,
            oraclegovcloudapps: i,
            "authgear-staging": t,
            authgearapps: t,
            skygearapp: t,
            outsystemscloud: t,
            ownprovider: t,
            pgfog: t,
            pagexl: t,
            gotpantheon: t,
            paywhirl: i,
            upsunapp: t,
            "postman-echo": t,
            prgmr: [0, { xen: t }],
            pythonanywhere: se,
            qa2: t,
            "alpha-myqnapcloud": t,
            "dev-myqnapcloud": t,
            mycloudnas: t,
            mynascloud: t,
            myqnapcloud: t,
            qualifioapp: t,
            ladesk: t,
            qbuser: t,
            quipelements: i,
            rackmaze: t,
            "readthedocs-hosted": t,
            rhcloud: t,
            onrender: t,
            render: j,
            "subsc-pay": t,
            "180r": t,
            dojin: t,
            sakuratan: t,
            sakuraweb: t,
            x0: t,
            code: [0, { builder: i, "dev-builder": i, "stg-builder": i }],
            salesforce: [
              0,
              {
                platform: [
                  0,
                  { "code-builder-stg": [0, { test: [0, { "001": i }] }] },
                ],
              },
            ],
            logoip: t,
            scrysec: t,
            "firewall-gateway": t,
            myshopblocks: t,
            myshopify: t,
            shopitsite: t,
            "1kapp": t,
            appchizi: t,
            applinzi: t,
            sinaapp: t,
            vipsinaapp: t,
            streamlitapp: t,
            "try-snowplow": t,
            "playstation-cloud": t,
            myspreadshop: t,
            "w-corp-staticblitz": t,
            "w-credentialless-staticblitz": t,
            "w-staticblitz": t,
            "stackhero-network": t,
            stdlib: [0, { api: t }],
            strapiapp: [2, { media: t }],
            "streak-link": t,
            streaklinks: t,
            streakusercontent: t,
            "temp-dns": t,
            dsmynas: t,
            familyds: t,
            mytabit: t,
            taveusercontent: t,
            "tb-hosting": ce,
            reservd: t,
            thingdustdata: t,
            "townnews-staging": t,
            typeform: [0, { pro: t }],
            hk: t,
            it: t,
            "deus-canvas": t,
            vultrobjects: i,
            wafflecell: t,
            hotelwithflight: t,
            "reserve-online": t,
            cprapid: t,
            pleskns: t,
            remotewd: t,
            wiardweb: [0, { pages: t }],
            wixsite: t,
            wixstudio: t,
            messwithdns: t,
            "woltlab-demo": t,
            wpenginepowered: [2, { js: t }],
            xnbay: [2, { u2: t, "u2-local": t }],
            yolasite: t,
          },
        ],
        coop: e,
        cr: [1, { ac: e, co: e, ed: e, fi: e, go: e, or: e, sa: e }],
        cu: [1, { com: e, edu: e, gob: e, inf: e, nat: e, net: e, org: e }],
        cv: [
          1,
          { com: e, edu: e, id: e, int: e, net: e, nome: e, org: e, publ: e },
        ],
        cw: M,
        cx: [
          1,
          {
            gov: e,
            cloudns: t,
            ath: t,
            info: t,
            assessments: t,
            calculators: t,
            funnels: t,
            paynow: t,
            quizzes: t,
            researched: t,
            tests: t,
          },
        ],
        cy: [
          1,
          {
            ac: e,
            biz: e,
            com: [1, { scaleforce: le }],
            ekloges: e,
            gov: e,
            ltd: e,
            mil: e,
            net: e,
            org: e,
            press: e,
            pro: e,
            tm: e,
          },
        ],
        cz: [
          1,
          {
            contentproxy9: [0, { rsc: t }],
            realm: t,
            e4: t,
            co: t,
            metacentrum: [0, { cloud: i, custom: t }],
            muni: [0, { cloud: [0, { flt: t, usr: t }] }],
          },
        ],
        de: [
          1,
          {
            bplaced: t,
            square7: t,
            com: t,
            cosidns: ue,
            dnsupdater: t,
            "dynamisches-dns": t,
            "internet-dns": t,
            "l-o-g-i-n": t,
            ddnss: [2, { dyn: t, dyndns: t }],
            "dyn-ip24": t,
            dyndns1: t,
            "home-webserver": [2, { dyn: t }],
            "myhome-server": t,
            dnshome: t,
            fuettertdasnetz: t,
            isteingeek: t,
            istmein: t,
            lebtimnetz: t,
            leitungsen: t,
            traeumtgerade: t,
            frusky: i,
            goip: t,
            "xn--gnstigbestellen-zvb": t,
            günstigbestellen: t,
            "xn--gnstigliefern-wob": t,
            günstigliefern: t,
            "hs-heilbronn": [0, { it: [0, { pages: t, "pages-research": t }] }],
            "dyn-berlin": t,
            "in-berlin": t,
            "in-brb": t,
            "in-butter": t,
            "in-dsl": t,
            "in-vpn": t,
            iservschule: t,
            "mein-iserv": t,
            schulplattform: t,
            schulserver: t,
            "test-iserv": t,
            keymachine: t,
            "git-repos": t,
            "lcube-server": t,
            "svn-repos": t,
            barsy: t,
            webspaceconfig: t,
            "123webseite": t,
            rub: t,
            "ruhr-uni-bochum": [2, { noc: [0, { io: t }] }],
            logoip: t,
            "firewall-gateway": t,
            "my-gateway": t,
            "my-router": t,
            spdns: t,
            speedpartner: [0, { customer: t }],
            myspreadshop: t,
            "taifun-dns": t,
            "12hp": t,
            "2ix": t,
            "4lima": t,
            "lima-city": t,
            "dd-dns": t,
            "dray-dns": t,
            draydns: t,
            "dyn-vpn": t,
            dynvpn: t,
            "mein-vigor": t,
            "my-vigor": t,
            "my-wan": t,
            "syno-ds": t,
            "synology-diskstation": t,
            "synology-ds": t,
            uberspace: i,
            "virtual-user": t,
            virtualuser: t,
            "community-pro": t,
            diskussionsbereich: t,
          },
        ],
        dj: e,
        dk: [
          1,
          {
            biz: t,
            co: t,
            firm: t,
            reg: t,
            store: t,
            "123hjemmeside": t,
            myspreadshop: t,
          },
        ],
        dm: de,
        do: [
          1,
          {
            art: e,
            com: e,
            edu: e,
            gob: e,
            gov: e,
            mil: e,
            net: e,
            org: e,
            sld: e,
            web: e,
          },
        ],
        dz: [
          1,
          {
            art: e,
            asso: e,
            com: e,
            edu: e,
            gov: e,
            net: e,
            org: e,
            pol: e,
            soc: e,
            tm: e,
          },
        ],
        ec: [
          1,
          {
            com: e,
            edu: e,
            fin: e,
            gob: e,
            gov: e,
            info: e,
            k12: e,
            med: e,
            mil: e,
            net: e,
            org: e,
            pro: e,
            base: t,
            official: t,
          },
        ],
        edu: [1, { rit: [0, { "git-pages": t }] }],
        ee: [
          1,
          {
            aip: e,
            com: e,
            edu: e,
            fie: e,
            gov: e,
            lib: e,
            med: e,
            org: e,
            pri: e,
            riik: e,
          },
        ],
        eg: [
          1,
          {
            ac: e,
            com: e,
            edu: e,
            eun: e,
            gov: e,
            info: e,
            me: e,
            mil: e,
            name: e,
            net: e,
            org: e,
            sci: e,
            sport: e,
            tv: e,
          },
        ],
        er: h,
        es: [
          1,
          {
            com: e,
            edu: e,
            gob: e,
            nom: e,
            org: e,
            "123miweb": t,
            myspreadshop: t,
          },
        ],
        et: [
          1,
          { biz: e, com: e, edu: e, gov: e, info: e, name: e, net: e, org: e },
        ],
        eu: [
          1,
          {
            airkitapps: t,
            cloudns: t,
            dogado: [0, { jelastic: t }],
            barsy: t,
            spdns: t,
            transurl: i,
            diskstation: t,
          },
        ],
        fi: [
          1,
          {
            aland: e,
            dy: t,
            "xn--hkkinen-5wa": t,
            häkkinen: t,
            iki: t,
            cloudplatform: [0, { fi: t }],
            datacenter: [0, { demo: t, paas: t }],
            kapsi: t,
            "123kotisivu": t,
            myspreadshop: t,
          },
        ],
        fj: [
          1,
          {
            ac: e,
            biz: e,
            com: e,
            gov: e,
            info: e,
            mil: e,
            name: e,
            net: e,
            org: e,
            pro: e,
          },
        ],
        fk: h,
        fm: [1, { com: e, edu: e, net: e, org: e, radio: t, user: i }],
        fo: e,
        fr: [
          1,
          {
            asso: e,
            com: e,
            gouv: e,
            nom: e,
            prd: e,
            tm: e,
            avoues: e,
            cci: e,
            greta: e,
            "huissier-justice": e,
            "en-root": t,
            "fbx-os": t,
            fbxos: t,
            "freebox-os": t,
            freeboxos: t,
            goupile: t,
            "123siteweb": t,
            "on-web": t,
            "chirurgiens-dentistes-en-france": t,
            dedibox: t,
            aeroport: t,
            avocat: t,
            chambagri: t,
            "chirurgiens-dentistes": t,
            "experts-comptables": t,
            medecin: t,
            notaires: t,
            pharmacien: t,
            port: t,
            veterinaire: t,
            myspreadshop: t,
            ynh: t,
          },
        ],
        ga: e,
        gb: e,
        gd: [1, { edu: e, gov: e }],
        ge: [1, { com: e, edu: e, gov: e, net: e, org: e, pvt: e, school: e }],
        gf: e,
        gg: [
          1,
          {
            co: e,
            net: e,
            org: e,
            botdash: t,
            kaas: t,
            stackit: t,
            panel: [2, { daemon: t }],
          },
        ],
        gh: [1, { com: e, edu: e, gov: e, mil: e, org: e }],
        gi: [1, { com: e, edu: e, gov: e, ltd: e, mod: e, org: e }],
        gl: [1, { co: e, com: e, edu: e, net: e, org: e, biz: t }],
        gm: e,
        gn: [1, { ac: e, com: e, edu: e, gov: e, net: e, org: e }],
        gov: e,
        gp: [1, { asso: e, com: e, edu: e, mobi: e, net: e, org: e }],
        gq: e,
        gr: [
          1,
          { com: e, edu: e, gov: e, net: e, org: e, barsy: t, simplesite: t },
        ],
        gs: e,
        gt: [1, { com: e, edu: e, gob: e, ind: e, mil: e, net: e, org: e }],
        gu: [
          1,
          { com: e, edu: e, gov: e, guam: e, info: e, net: e, org: e, web: e },
        ],
        gw: e,
        gy: de,
        hk: [
          1,
          {
            com: e,
            edu: e,
            gov: e,
            idv: e,
            net: e,
            org: e,
            "xn--ciqpn": e,
            个人: e,
            "xn--gmqw5a": e,
            個人: e,
            "xn--55qx5d": e,
            公司: e,
            "xn--mxtq1m": e,
            政府: e,
            "xn--lcvr32d": e,
            敎育: e,
            "xn--wcvs22d": e,
            教育: e,
            "xn--gmq050i": e,
            箇人: e,
            "xn--uc0atv": e,
            組織: e,
            "xn--uc0ay4a": e,
            組织: e,
            "xn--od0alg": e,
            網絡: e,
            "xn--zf0avx": e,
            網络: e,
            "xn--mk0axi": e,
            组織: e,
            "xn--tn0ag": e,
            组织: e,
            "xn--od0aq3b": e,
            网絡: e,
            "xn--io0a7i": e,
            网络: e,
            inc: t,
            ltd: t,
          },
        ],
        hm: e,
        hn: [1, { com: e, edu: e, gob: e, mil: e, net: e, org: e }],
        hr: [1, { com: e, from: e, iz: e, name: e, brendly: me }],
        ht: [
          1,
          {
            adult: e,
            art: e,
            asso: e,
            com: e,
            coop: e,
            edu: e,
            firm: e,
            gouv: e,
            info: e,
            med: e,
            net: e,
            org: e,
            perso: e,
            pol: e,
            pro: e,
            rel: e,
            shop: e,
            rt: t,
          },
        ],
        hu: [
          1,
          {
            2e3: e,
            agrar: e,
            bolt: e,
            casino: e,
            city: e,
            co: e,
            erotica: e,
            erotika: e,
            film: e,
            forum: e,
            games: e,
            hotel: e,
            info: e,
            ingatlan: e,
            jogasz: e,
            konyvelo: e,
            lakas: e,
            media: e,
            news: e,
            org: e,
            priv: e,
            reklam: e,
            sex: e,
            shop: e,
            sport: e,
            suli: e,
            szex: e,
            tm: e,
            tozsde: e,
            utazas: e,
            video: e,
          },
        ],
        id: [
          1,
          {
            ac: e,
            biz: e,
            co: e,
            desa: e,
            go: e,
            mil: e,
            my: e,
            net: e,
            or: e,
            ponpes: e,
            sch: e,
            web: e,
            zone: t,
          },
        ],
        ie: [1, { gov: e, myspreadshop: t }],
        il: [
          1,
          {
            ac: e,
            co: [1, { ravpage: t, mytabit: t, tabitorder: t }],
            gov: e,
            idf: e,
            k12: e,
            muni: e,
            net: e,
            org: e,
          },
        ],
        "xn--4dbrk0ce": [
          1,
          {
            "xn--4dbgdty6c": e,
            "xn--5dbhl8d": e,
            "xn--8dbq2a": e,
            "xn--hebda8b": e,
          },
        ],
        ישראל: [1, { אקדמיה: e, ישוב: e, צהל: e, ממשל: e }],
        im: [
          1,
          {
            ac: e,
            co: [1, { ltd: e, plc: e }],
            com: e,
            net: e,
            org: e,
            tt: e,
            tv: e,
          },
        ],
        in: [
          1,
          {
            "5g": e,
            "6g": e,
            ac: e,
            ai: e,
            am: e,
            bihar: e,
            biz: e,
            business: e,
            ca: e,
            cn: e,
            co: e,
            com: e,
            coop: e,
            cs: e,
            delhi: e,
            dr: e,
            edu: e,
            er: e,
            firm: e,
            gen: e,
            gov: e,
            gujarat: e,
            ind: e,
            info: e,
            int: e,
            internet: e,
            io: e,
            me: e,
            mil: e,
            net: e,
            nic: e,
            org: e,
            pg: e,
            post: e,
            pro: e,
            res: e,
            travel: e,
            tv: e,
            uk: e,
            up: e,
            us: e,
            cloudns: t,
            barsy: t,
            web: t,
            supabase: t,
          },
        ],
        info: [
          1,
          {
            cloudns: t,
            "dynamic-dns": t,
            "barrel-of-knowledge": t,
            "barrell-of-knowledge": t,
            dyndns: t,
            "for-our": t,
            "groks-the": t,
            "groks-this": t,
            "here-for-more": t,
            knowsitall: t,
            selfip: t,
            webhop: t,
            barsy: t,
            mayfirst: t,
            mittwald: t,
            mittwaldserver: t,
            typo3server: t,
            dvrcam: t,
            ilovecollege: t,
            "no-ip": t,
            forumz: t,
            nsupdate: t,
            dnsupdate: t,
            "v-info": t,
          },
        ],
        int: [1, { eu: e }],
        io: [
          1,
          {
            2038: t,
            co: e,
            com: e,
            edu: e,
            gov: e,
            mil: e,
            net: e,
            nom: e,
            org: e,
            "on-acorn": i,
            myaddr: t,
            apigee: t,
            "b-data": t,
            beagleboard: t,
            bitbucket: t,
            bluebite: t,
            boxfuse: t,
            brave: a,
            browsersafetymark: t,
            bubble: N,
            bubbleapps: t,
            bigv: [0, { uk0: t }],
            cleverapps: t,
            cloudbeesusercontent: t,
            dappnode: [0, { dyndns: t }],
            darklang: t,
            definima: t,
            dedyn: t,
            "fh-muenster": t,
            shw: t,
            forgerock: [0, { id: t }],
            github: t,
            gitlab: t,
            lolipop: t,
            "hasura-app": t,
            hostyhosting: t,
            hypernode: t,
            moonscale: i,
            beebyte: oe,
            beebyteapp: [0, { sekd1: t }],
            jele: t,
            webthings: t,
            loginline: t,
            barsy: t,
            azurecontainer: i,
            ngrok: [2, { ap: t, au: t, eu: t, in: t, jp: t, sa: t, us: t }],
            nodeart: [0, { stage: t }],
            pantheonsite: t,
            pstmn: [2, { mock: t }],
            protonet: t,
            qcx: [2, { sys: i }],
            qoto: t,
            vaporcloud: t,
            myrdbx: t,
            "rb-hosting": ce,
            "on-k3s": i,
            "on-rio": i,
            readthedocs: t,
            resindevice: t,
            resinstaging: [0, { devices: t }],
            hzc: t,
            sandcats: t,
            scrypted: [0, { client: t }],
            "mo-siemens": t,
            lair: ae,
            stolos: i,
            musician: t,
            utwente: t,
            edugit: t,
            telebit: t,
            thingdust: [0, { dev: he, disrec: he, prod: ge, testing: he }],
            tickets: t,
            webflow: t,
            webflowtest: t,
            editorx: t,
            wixstudio: t,
            basicserver: t,
            virtualserver: t,
          },
        ],
        iq: r,
        ir: [
          1,
          {
            ac: e,
            co: e,
            gov: e,
            id: e,
            net: e,
            org: e,
            sch: e,
            "xn--mgba3a4f16a": e,
            ایران: e,
            "xn--mgba3a4fra": e,
            ايران: e,
            arvanedge: t,
          },
        ],
        is: e,
        it: [
          1,
          {
            edu: e,
            gov: e,
            abr: e,
            abruzzo: e,
            "aosta-valley": e,
            aostavalley: e,
            bas: e,
            basilicata: e,
            cal: e,
            calabria: e,
            cam: e,
            campania: e,
            "emilia-romagna": e,
            emiliaromagna: e,
            emr: e,
            "friuli-v-giulia": e,
            "friuli-ve-giulia": e,
            "friuli-vegiulia": e,
            "friuli-venezia-giulia": e,
            "friuli-veneziagiulia": e,
            "friuli-vgiulia": e,
            "friuliv-giulia": e,
            "friulive-giulia": e,
            friulivegiulia: e,
            "friulivenezia-giulia": e,
            friuliveneziagiulia: e,
            friulivgiulia: e,
            fvg: e,
            laz: e,
            lazio: e,
            lig: e,
            liguria: e,
            lom: e,
            lombardia: e,
            lombardy: e,
            lucania: e,
            mar: e,
            marche: e,
            mol: e,
            molise: e,
            piedmont: e,
            piemonte: e,
            pmn: e,
            pug: e,
            puglia: e,
            sar: e,
            sardegna: e,
            sardinia: e,
            sic: e,
            sicilia: e,
            sicily: e,
            taa: e,
            tos: e,
            toscana: e,
            "trentin-sud-tirol": e,
            "xn--trentin-sd-tirol-rzb": e,
            "trentin-süd-tirol": e,
            "trentin-sudtirol": e,
            "xn--trentin-sdtirol-7vb": e,
            "trentin-südtirol": e,
            "trentin-sued-tirol": e,
            "trentin-suedtirol": e,
            trentino: e,
            "trentino-a-adige": e,
            "trentino-aadige": e,
            "trentino-alto-adige": e,
            "trentino-altoadige": e,
            "trentino-s-tirol": e,
            "trentino-stirol": e,
            "trentino-sud-tirol": e,
            "xn--trentino-sd-tirol-c3b": e,
            "trentino-süd-tirol": e,
            "trentino-sudtirol": e,
            "xn--trentino-sdtirol-szb": e,
            "trentino-südtirol": e,
            "trentino-sued-tirol": e,
            "trentino-suedtirol": e,
            "trentinoa-adige": e,
            trentinoaadige: e,
            "trentinoalto-adige": e,
            trentinoaltoadige: e,
            "trentinos-tirol": e,
            trentinostirol: e,
            "trentinosud-tirol": e,
            "xn--trentinosd-tirol-rzb": e,
            "trentinosüd-tirol": e,
            trentinosudtirol: e,
            "xn--trentinosdtirol-7vb": e,
            trentinosüdtirol: e,
            "trentinosued-tirol": e,
            trentinosuedtirol: e,
            "trentinsud-tirol": e,
            "xn--trentinsd-tirol-6vb": e,
            "trentinsüd-tirol": e,
            trentinsudtirol: e,
            "xn--trentinsdtirol-nsb": e,
            trentinsüdtirol: e,
            "trentinsued-tirol": e,
            trentinsuedtirol: e,
            tuscany: e,
            umb: e,
            umbria: e,
            "val-d-aosta": e,
            "val-daosta": e,
            "vald-aosta": e,
            valdaosta: e,
            "valle-aosta": e,
            "valle-d-aosta": e,
            "valle-daosta": e,
            valleaosta: e,
            "valled-aosta": e,
            valledaosta: e,
            "vallee-aoste": e,
            "xn--valle-aoste-ebb": e,
            "vallée-aoste": e,
            "vallee-d-aoste": e,
            "xn--valle-d-aoste-ehb": e,
            "vallée-d-aoste": e,
            valleeaoste: e,
            "xn--valleaoste-e7a": e,
            valléeaoste: e,
            valleedaoste: e,
            "xn--valledaoste-ebb": e,
            valléedaoste: e,
            vao: e,
            vda: e,
            ven: e,
            veneto: e,
            ag: e,
            agrigento: e,
            al: e,
            alessandria: e,
            "alto-adige": e,
            altoadige: e,
            an: e,
            ancona: e,
            "andria-barletta-trani": e,
            "andria-trani-barletta": e,
            andriabarlettatrani: e,
            andriatranibarletta: e,
            ao: e,
            aosta: e,
            aoste: e,
            ap: e,
            aq: e,
            aquila: e,
            ar: e,
            arezzo: e,
            "ascoli-piceno": e,
            ascolipiceno: e,
            asti: e,
            at: e,
            av: e,
            avellino: e,
            ba: e,
            balsan: e,
            "balsan-sudtirol": e,
            "xn--balsan-sdtirol-nsb": e,
            "balsan-südtirol": e,
            "balsan-suedtirol": e,
            bari: e,
            "barletta-trani-andria": e,
            barlettatraniandria: e,
            belluno: e,
            benevento: e,
            bergamo: e,
            bg: e,
            bi: e,
            biella: e,
            bl: e,
            bn: e,
            bo: e,
            bologna: e,
            bolzano: e,
            "bolzano-altoadige": e,
            bozen: e,
            "bozen-sudtirol": e,
            "xn--bozen-sdtirol-2ob": e,
            "bozen-südtirol": e,
            "bozen-suedtirol": e,
            br: e,
            brescia: e,
            brindisi: e,
            bs: e,
            bt: e,
            bulsan: e,
            "bulsan-sudtirol": e,
            "xn--bulsan-sdtirol-nsb": e,
            "bulsan-südtirol": e,
            "bulsan-suedtirol": e,
            bz: e,
            ca: e,
            cagliari: e,
            caltanissetta: e,
            "campidano-medio": e,
            campidanomedio: e,
            campobasso: e,
            "carbonia-iglesias": e,
            carboniaiglesias: e,
            "carrara-massa": e,
            carraramassa: e,
            caserta: e,
            catania: e,
            catanzaro: e,
            cb: e,
            ce: e,
            "cesena-forli": e,
            "xn--cesena-forl-mcb": e,
            "cesena-forlì": e,
            cesenaforli: e,
            "xn--cesenaforl-i8a": e,
            cesenaforlì: e,
            ch: e,
            chieti: e,
            ci: e,
            cl: e,
            cn: e,
            co: e,
            como: e,
            cosenza: e,
            cr: e,
            cremona: e,
            crotone: e,
            cs: e,
            ct: e,
            cuneo: e,
            cz: e,
            "dell-ogliastra": e,
            dellogliastra: e,
            en: e,
            enna: e,
            fc: e,
            fe: e,
            fermo: e,
            ferrara: e,
            fg: e,
            fi: e,
            firenze: e,
            florence: e,
            fm: e,
            foggia: e,
            "forli-cesena": e,
            "xn--forl-cesena-fcb": e,
            "forlì-cesena": e,
            forlicesena: e,
            "xn--forlcesena-c8a": e,
            forlìcesena: e,
            fr: e,
            frosinone: e,
            ge: e,
            genoa: e,
            genova: e,
            go: e,
            gorizia: e,
            gr: e,
            grosseto: e,
            "iglesias-carbonia": e,
            iglesiascarbonia: e,
            im: e,
            imperia: e,
            is: e,
            isernia: e,
            kr: e,
            "la-spezia": e,
            laquila: e,
            laspezia: e,
            latina: e,
            lc: e,
            le: e,
            lecce: e,
            lecco: e,
            li: e,
            livorno: e,
            lo: e,
            lodi: e,
            lt: e,
            lu: e,
            lucca: e,
            macerata: e,
            mantova: e,
            "massa-carrara": e,
            massacarrara: e,
            matera: e,
            mb: e,
            mc: e,
            me: e,
            "medio-campidano": e,
            mediocampidano: e,
            messina: e,
            mi: e,
            milan: e,
            milano: e,
            mn: e,
            mo: e,
            modena: e,
            monza: e,
            "monza-brianza": e,
            "monza-e-della-brianza": e,
            monzabrianza: e,
            monzaebrianza: e,
            monzaedellabrianza: e,
            ms: e,
            mt: e,
            na: e,
            naples: e,
            napoli: e,
            no: e,
            novara: e,
            nu: e,
            nuoro: e,
            og: e,
            ogliastra: e,
            "olbia-tempio": e,
            olbiatempio: e,
            or: e,
            oristano: e,
            ot: e,
            pa: e,
            padova: e,
            padua: e,
            palermo: e,
            parma: e,
            pavia: e,
            pc: e,
            pd: e,
            pe: e,
            perugia: e,
            "pesaro-urbino": e,
            pesarourbino: e,
            pescara: e,
            pg: e,
            pi: e,
            piacenza: e,
            pisa: e,
            pistoia: e,
            pn: e,
            po: e,
            pordenone: e,
            potenza: e,
            pr: e,
            prato: e,
            pt: e,
            pu: e,
            pv: e,
            pz: e,
            ra: e,
            ragusa: e,
            ravenna: e,
            rc: e,
            re: e,
            "reggio-calabria": e,
            "reggio-emilia": e,
            reggiocalabria: e,
            reggioemilia: e,
            rg: e,
            ri: e,
            rieti: e,
            rimini: e,
            rm: e,
            rn: e,
            ro: e,
            roma: e,
            rome: e,
            rovigo: e,
            sa: e,
            salerno: e,
            sassari: e,
            savona: e,
            si: e,
            siena: e,
            siracusa: e,
            so: e,
            sondrio: e,
            sp: e,
            sr: e,
            ss: e,
            "xn--sdtirol-n2a": e,
            südtirol: e,
            suedtirol: e,
            sv: e,
            ta: e,
            taranto: e,
            te: e,
            "tempio-olbia": e,
            tempioolbia: e,
            teramo: e,
            terni: e,
            tn: e,
            to: e,
            torino: e,
            tp: e,
            tr: e,
            "trani-andria-barletta": e,
            "trani-barletta-andria": e,
            traniandriabarletta: e,
            tranibarlettaandria: e,
            trapani: e,
            trento: e,
            treviso: e,
            trieste: e,
            ts: e,
            turin: e,
            tv: e,
            ud: e,
            udine: e,
            "urbino-pesaro": e,
            urbinopesaro: e,
            va: e,
            varese: e,
            vb: e,
            vc: e,
            ve: e,
            venezia: e,
            venice: e,
            verbania: e,
            vercelli: e,
            verona: e,
            vi: e,
            "vibo-valentia": e,
            vibovalentia: e,
            vicenza: e,
            viterbo: e,
            vr: e,
            vs: e,
            vt: e,
            vv: e,
            "12chars": t,
            ibxos: t,
            iliadboxos: t,
            neen: [0, { jc: t }],
            "123homepage": t,
            "16-b": t,
            "32-b": t,
            "64-b": t,
            myspreadshop: t,
            syncloud: t,
          },
        ],
        je: [1, { co: e, net: e, org: e, of: t }],
        jm: h,
        jo: [
          1,
          {
            agri: e,
            ai: e,
            com: e,
            edu: e,
            eng: e,
            fm: e,
            gov: e,
            mil: e,
            net: e,
            org: e,
            per: e,
            phd: e,
            sch: e,
            tv: e,
          },
        ],
        jobs: e,
        jp: [
          1,
          {
            ac: e,
            ad: e,
            co: e,
            ed: e,
            go: e,
            gr: e,
            lg: e,
            ne: [
              1,
              {
                aseinet: pe,
                gehirn: t,
                ivory: t,
                "mail-box": t,
                mints: t,
                mokuren: t,
                opal: t,
                sakura: t,
                sumomo: t,
                topaz: t,
              },
            ],
            or: e,
            aichi: [
              1,
              {
                aisai: e,
                ama: e,
                anjo: e,
                asuke: e,
                chiryu: e,
                chita: e,
                fuso: e,
                gamagori: e,
                handa: e,
                hazu: e,
                hekinan: e,
                higashiura: e,
                ichinomiya: e,
                inazawa: e,
                inuyama: e,
                isshiki: e,
                iwakura: e,
                kanie: e,
                kariya: e,
                kasugai: e,
                kira: e,
                kiyosu: e,
                komaki: e,
                konan: e,
                kota: e,
                mihama: e,
                miyoshi: e,
                nishio: e,
                nisshin: e,
                obu: e,
                oguchi: e,
                oharu: e,
                okazaki: e,
                owariasahi: e,
                seto: e,
                shikatsu: e,
                shinshiro: e,
                shitara: e,
                tahara: e,
                takahama: e,
                tobishima: e,
                toei: e,
                togo: e,
                tokai: e,
                tokoname: e,
                toyoake: e,
                toyohashi: e,
                toyokawa: e,
                toyone: e,
                toyota: e,
                tsushima: e,
                yatomi: e,
              },
            ],
            akita: [
              1,
              {
                akita: e,
                daisen: e,
                fujisato: e,
                gojome: e,
                hachirogata: e,
                happou: e,
                higashinaruse: e,
                honjo: e,
                honjyo: e,
                ikawa: e,
                kamikoani: e,
                kamioka: e,
                katagami: e,
                kazuno: e,
                kitaakita: e,
                kosaka: e,
                kyowa: e,
                misato: e,
                mitane: e,
                moriyoshi: e,
                nikaho: e,
                noshiro: e,
                odate: e,
                oga: e,
                ogata: e,
                semboku: e,
                yokote: e,
                yurihonjo: e,
              },
            ],
            aomori: [
              1,
              {
                aomori: e,
                gonohe: e,
                hachinohe: e,
                hashikami: e,
                hiranai: e,
                hirosaki: e,
                itayanagi: e,
                kuroishi: e,
                misawa: e,
                mutsu: e,
                nakadomari: e,
                noheji: e,
                oirase: e,
                owani: e,
                rokunohe: e,
                sannohe: e,
                shichinohe: e,
                shingo: e,
                takko: e,
                towada: e,
                tsugaru: e,
                tsuruta: e,
              },
            ],
            chiba: [
              1,
              {
                abiko: e,
                asahi: e,
                chonan: e,
                chosei: e,
                choshi: e,
                chuo: e,
                funabashi: e,
                futtsu: e,
                hanamigawa: e,
                ichihara: e,
                ichikawa: e,
                ichinomiya: e,
                inzai: e,
                isumi: e,
                kamagaya: e,
                kamogawa: e,
                kashiwa: e,
                katori: e,
                katsuura: e,
                kimitsu: e,
                kisarazu: e,
                kozaki: e,
                kujukuri: e,
                kyonan: e,
                matsudo: e,
                midori: e,
                mihama: e,
                minamiboso: e,
                mobara: e,
                mutsuzawa: e,
                nagara: e,
                nagareyama: e,
                narashino: e,
                narita: e,
                noda: e,
                oamishirasato: e,
                omigawa: e,
                onjuku: e,
                otaki: e,
                sakae: e,
                sakura: e,
                shimofusa: e,
                shirako: e,
                shiroi: e,
                shisui: e,
                sodegaura: e,
                sosa: e,
                tako: e,
                tateyama: e,
                togane: e,
                tohnosho: e,
                tomisato: e,
                urayasu: e,
                yachimata: e,
                yachiyo: e,
                yokaichiba: e,
                yokoshibahikari: e,
                yotsukaido: e,
              },
            ],
            ehime: [
              1,
              {
                ainan: e,
                honai: e,
                ikata: e,
                imabari: e,
                iyo: e,
                kamijima: e,
                kihoku: e,
                kumakogen: e,
                masaki: e,
                matsuno: e,
                matsuyama: e,
                namikata: e,
                niihama: e,
                ozu: e,
                saijo: e,
                seiyo: e,
                shikokuchuo: e,
                tobe: e,
                toon: e,
                uchiko: e,
                uwajima: e,
                yawatahama: e,
              },
            ],
            fukui: [
              1,
              {
                echizen: e,
                eiheiji: e,
                fukui: e,
                ikeda: e,
                katsuyama: e,
                mihama: e,
                minamiechizen: e,
                obama: e,
                ohi: e,
                ono: e,
                sabae: e,
                sakai: e,
                takahama: e,
                tsuruga: e,
                wakasa: e,
              },
            ],
            fukuoka: [
              1,
              {
                ashiya: e,
                buzen: e,
                chikugo: e,
                chikuho: e,
                chikujo: e,
                chikushino: e,
                chikuzen: e,
                chuo: e,
                dazaifu: e,
                fukuchi: e,
                hakata: e,
                higashi: e,
                hirokawa: e,
                hisayama: e,
                iizuka: e,
                inatsuki: e,
                kaho: e,
                kasuga: e,
                kasuya: e,
                kawara: e,
                keisen: e,
                koga: e,
                kurate: e,
                kurogi: e,
                kurume: e,
                minami: e,
                miyako: e,
                miyama: e,
                miyawaka: e,
                mizumaki: e,
                munakata: e,
                nakagawa: e,
                nakama: e,
                nishi: e,
                nogata: e,
                ogori: e,
                okagaki: e,
                okawa: e,
                oki: e,
                omuta: e,
                onga: e,
                onojo: e,
                oto: e,
                saigawa: e,
                sasaguri: e,
                shingu: e,
                shinyoshitomi: e,
                shonai: e,
                soeda: e,
                sue: e,
                tachiarai: e,
                tagawa: e,
                takata: e,
                toho: e,
                toyotsu: e,
                tsuiki: e,
                ukiha: e,
                umi: e,
                usui: e,
                yamada: e,
                yame: e,
                yanagawa: e,
                yukuhashi: e,
              },
            ],
            fukushima: [
              1,
              {
                aizubange: e,
                aizumisato: e,
                aizuwakamatsu: e,
                asakawa: e,
                bandai: e,
                date: e,
                fukushima: e,
                furudono: e,
                futaba: e,
                hanawa: e,
                higashi: e,
                hirata: e,
                hirono: e,
                iitate: e,
                inawashiro: e,
                ishikawa: e,
                iwaki: e,
                izumizaki: e,
                kagamiishi: e,
                kaneyama: e,
                kawamata: e,
                kitakata: e,
                kitashiobara: e,
                koori: e,
                koriyama: e,
                kunimi: e,
                miharu: e,
                mishima: e,
                namie: e,
                nango: e,
                nishiaizu: e,
                nishigo: e,
                okuma: e,
                omotego: e,
                ono: e,
                otama: e,
                samegawa: e,
                shimogo: e,
                shirakawa: e,
                showa: e,
                soma: e,
                sukagawa: e,
                taishin: e,
                tamakawa: e,
                tanagura: e,
                tenei: e,
                yabuki: e,
                yamato: e,
                yamatsuri: e,
                yanaizu: e,
                yugawa: e,
              },
            ],
            gifu: [
              1,
              {
                anpachi: e,
                ena: e,
                gifu: e,
                ginan: e,
                godo: e,
                gujo: e,
                hashima: e,
                hichiso: e,
                hida: e,
                higashishirakawa: e,
                ibigawa: e,
                ikeda: e,
                kakamigahara: e,
                kani: e,
                kasahara: e,
                kasamatsu: e,
                kawaue: e,
                kitagata: e,
                mino: e,
                minokamo: e,
                mitake: e,
                mizunami: e,
                motosu: e,
                nakatsugawa: e,
                ogaki: e,
                sakahogi: e,
                seki: e,
                sekigahara: e,
                shirakawa: e,
                tajimi: e,
                takayama: e,
                tarui: e,
                toki: e,
                tomika: e,
                wanouchi: e,
                yamagata: e,
                yaotsu: e,
                yoro: e,
              },
            ],
            gunma: [
              1,
              {
                annaka: e,
                chiyoda: e,
                fujioka: e,
                higashiagatsuma: e,
                isesaki: e,
                itakura: e,
                kanna: e,
                kanra: e,
                katashina: e,
                kawaba: e,
                kiryu: e,
                kusatsu: e,
                maebashi: e,
                meiwa: e,
                midori: e,
                minakami: e,
                naganohara: e,
                nakanojo: e,
                nanmoku: e,
                numata: e,
                oizumi: e,
                ora: e,
                ota: e,
                shibukawa: e,
                shimonita: e,
                shinto: e,
                showa: e,
                takasaki: e,
                takayama: e,
                tamamura: e,
                tatebayashi: e,
                tomioka: e,
                tsukiyono: e,
                tsumagoi: e,
                ueno: e,
                yoshioka: e,
              },
            ],
            hiroshima: [
              1,
              {
                asaminami: e,
                daiwa: e,
                etajima: e,
                fuchu: e,
                fukuyama: e,
                hatsukaichi: e,
                higashihiroshima: e,
                hongo: e,
                jinsekikogen: e,
                kaita: e,
                kui: e,
                kumano: e,
                kure: e,
                mihara: e,
                miyoshi: e,
                naka: e,
                onomichi: e,
                osakikamijima: e,
                otake: e,
                saka: e,
                sera: e,
                seranishi: e,
                shinichi: e,
                shobara: e,
                takehara: e,
              },
            ],
            hokkaido: [
              1,
              {
                abashiri: e,
                abira: e,
                aibetsu: e,
                akabira: e,
                akkeshi: e,
                asahikawa: e,
                ashibetsu: e,
                ashoro: e,
                assabu: e,
                atsuma: e,
                bibai: e,
                biei: e,
                bifuka: e,
                bihoro: e,
                biratori: e,
                chippubetsu: e,
                chitose: e,
                date: e,
                ebetsu: e,
                embetsu: e,
                eniwa: e,
                erimo: e,
                esan: e,
                esashi: e,
                fukagawa: e,
                fukushima: e,
                furano: e,
                furubira: e,
                haboro: e,
                hakodate: e,
                hamatonbetsu: e,
                hidaka: e,
                higashikagura: e,
                higashikawa: e,
                hiroo: e,
                hokuryu: e,
                hokuto: e,
                honbetsu: e,
                horokanai: e,
                horonobe: e,
                ikeda: e,
                imakane: e,
                ishikari: e,
                iwamizawa: e,
                iwanai: e,
                kamifurano: e,
                kamikawa: e,
                kamishihoro: e,
                kamisunagawa: e,
                kamoenai: e,
                kayabe: e,
                kembuchi: e,
                kikonai: e,
                kimobetsu: e,
                kitahiroshima: e,
                kitami: e,
                kiyosato: e,
                koshimizu: e,
                kunneppu: e,
                kuriyama: e,
                kuromatsunai: e,
                kushiro: e,
                kutchan: e,
                kyowa: e,
                mashike: e,
                matsumae: e,
                mikasa: e,
                minamifurano: e,
                mombetsu: e,
                moseushi: e,
                mukawa: e,
                muroran: e,
                naie: e,
                nakagawa: e,
                nakasatsunai: e,
                nakatombetsu: e,
                nanae: e,
                nanporo: e,
                nayoro: e,
                nemuro: e,
                niikappu: e,
                niki: e,
                nishiokoppe: e,
                noboribetsu: e,
                numata: e,
                obihiro: e,
                obira: e,
                oketo: e,
                okoppe: e,
                otaru: e,
                otobe: e,
                otofuke: e,
                otoineppu: e,
                oumu: e,
                ozora: e,
                pippu: e,
                rankoshi: e,
                rebun: e,
                rikubetsu: e,
                rishiri: e,
                rishirifuji: e,
                saroma: e,
                sarufutsu: e,
                shakotan: e,
                shari: e,
                shibecha: e,
                shibetsu: e,
                shikabe: e,
                shikaoi: e,
                shimamaki: e,
                shimizu: e,
                shimokawa: e,
                shinshinotsu: e,
                shintoku: e,
                shiranuka: e,
                shiraoi: e,
                shiriuchi: e,
                sobetsu: e,
                sunagawa: e,
                taiki: e,
                takasu: e,
                takikawa: e,
                takinoue: e,
                teshikaga: e,
                tobetsu: e,
                tohma: e,
                tomakomai: e,
                tomari: e,
                toya: e,
                toyako: e,
                toyotomi: e,
                toyoura: e,
                tsubetsu: e,
                tsukigata: e,
                urakawa: e,
                urausu: e,
                uryu: e,
                utashinai: e,
                wakkanai: e,
                wassamu: e,
                yakumo: e,
                yoichi: e,
              },
            ],
            hyogo: [
              1,
              {
                aioi: e,
                akashi: e,
                ako: e,
                amagasaki: e,
                aogaki: e,
                asago: e,
                ashiya: e,
                awaji: e,
                fukusaki: e,
                goshiki: e,
                harima: e,
                himeji: e,
                ichikawa: e,
                inagawa: e,
                itami: e,
                kakogawa: e,
                kamigori: e,
                kamikawa: e,
                kasai: e,
                kasuga: e,
                kawanishi: e,
                miki: e,
                minamiawaji: e,
                nishinomiya: e,
                nishiwaki: e,
                ono: e,
                sanda: e,
                sannan: e,
                sasayama: e,
                sayo: e,
                shingu: e,
                shinonsen: e,
                shiso: e,
                sumoto: e,
                taishi: e,
                taka: e,
                takarazuka: e,
                takasago: e,
                takino: e,
                tamba: e,
                tatsuno: e,
                toyooka: e,
                yabu: e,
                yashiro: e,
                yoka: e,
                yokawa: e,
              },
            ],
            ibaraki: [
              1,
              {
                ami: e,
                asahi: e,
                bando: e,
                chikusei: e,
                daigo: e,
                fujishiro: e,
                hitachi: e,
                hitachinaka: e,
                hitachiomiya: e,
                hitachiota: e,
                ibaraki: e,
                ina: e,
                inashiki: e,
                itako: e,
                iwama: e,
                joso: e,
                kamisu: e,
                kasama: e,
                kashima: e,
                kasumigaura: e,
                koga: e,
                miho: e,
                mito: e,
                moriya: e,
                naka: e,
                namegata: e,
                oarai: e,
                ogawa: e,
                omitama: e,
                ryugasaki: e,
                sakai: e,
                sakuragawa: e,
                shimodate: e,
                shimotsuma: e,
                shirosato: e,
                sowa: e,
                suifu: e,
                takahagi: e,
                tamatsukuri: e,
                tokai: e,
                tomobe: e,
                tone: e,
                toride: e,
                tsuchiura: e,
                tsukuba: e,
                uchihara: e,
                ushiku: e,
                yachiyo: e,
                yamagata: e,
                yawara: e,
                yuki: e,
              },
            ],
            ishikawa: [
              1,
              {
                anamizu: e,
                hakui: e,
                hakusan: e,
                kaga: e,
                kahoku: e,
                kanazawa: e,
                kawakita: e,
                komatsu: e,
                nakanoto: e,
                nanao: e,
                nomi: e,
                nonoichi: e,
                noto: e,
                shika: e,
                suzu: e,
                tsubata: e,
                tsurugi: e,
                uchinada: e,
                wajima: e,
              },
            ],
            iwate: [
              1,
              {
                fudai: e,
                fujisawa: e,
                hanamaki: e,
                hiraizumi: e,
                hirono: e,
                ichinohe: e,
                ichinoseki: e,
                iwaizumi: e,
                iwate: e,
                joboji: e,
                kamaishi: e,
                kanegasaki: e,
                karumai: e,
                kawai: e,
                kitakami: e,
                kuji: e,
                kunohe: e,
                kuzumaki: e,
                miyako: e,
                mizusawa: e,
                morioka: e,
                ninohe: e,
                noda: e,
                ofunato: e,
                oshu: e,
                otsuchi: e,
                rikuzentakata: e,
                shiwa: e,
                shizukuishi: e,
                sumita: e,
                tanohata: e,
                tono: e,
                yahaba: e,
                yamada: e,
              },
            ],
            kagawa: [
              1,
              {
                ayagawa: e,
                higashikagawa: e,
                kanonji: e,
                kotohira: e,
                manno: e,
                marugame: e,
                mitoyo: e,
                naoshima: e,
                sanuki: e,
                tadotsu: e,
                takamatsu: e,
                tonosho: e,
                uchinomi: e,
                utazu: e,
                zentsuji: e,
              },
            ],
            kagoshima: [
              1,
              {
                akune: e,
                amami: e,
                hioki: e,
                isa: e,
                isen: e,
                izumi: e,
                kagoshima: e,
                kanoya: e,
                kawanabe: e,
                kinko: e,
                kouyama: e,
                makurazaki: e,
                matsumoto: e,
                minamitane: e,
                nakatane: e,
                nishinoomote: e,
                satsumasendai: e,
                soo: e,
                tarumizu: e,
                yusui: e,
              },
            ],
            kanagawa: [
              1,
              {
                aikawa: e,
                atsugi: e,
                ayase: e,
                chigasaki: e,
                ebina: e,
                fujisawa: e,
                hadano: e,
                hakone: e,
                hiratsuka: e,
                isehara: e,
                kaisei: e,
                kamakura: e,
                kiyokawa: e,
                matsuda: e,
                minamiashigara: e,
                miura: e,
                nakai: e,
                ninomiya: e,
                odawara: e,
                oi: e,
                oiso: e,
                sagamihara: e,
                samukawa: e,
                tsukui: e,
                yamakita: e,
                yamato: e,
                yokosuka: e,
                yugawara: e,
                zama: e,
                zushi: e,
              },
            ],
            kochi: [
              1,
              {
                aki: e,
                geisei: e,
                hidaka: e,
                higashitsuno: e,
                ino: e,
                kagami: e,
                kami: e,
                kitagawa: e,
                kochi: e,
                mihara: e,
                motoyama: e,
                muroto: e,
                nahari: e,
                nakamura: e,
                nankoku: e,
                nishitosa: e,
                niyodogawa: e,
                ochi: e,
                okawa: e,
                otoyo: e,
                otsuki: e,
                sakawa: e,
                sukumo: e,
                susaki: e,
                tosa: e,
                tosashimizu: e,
                toyo: e,
                tsuno: e,
                umaji: e,
                yasuda: e,
                yusuhara: e,
              },
            ],
            kumamoto: [
              1,
              {
                amakusa: e,
                arao: e,
                aso: e,
                choyo: e,
                gyokuto: e,
                kamiamakusa: e,
                kikuchi: e,
                kumamoto: e,
                mashiki: e,
                mifune: e,
                minamata: e,
                minamioguni: e,
                nagasu: e,
                nishihara: e,
                oguni: e,
                ozu: e,
                sumoto: e,
                takamori: e,
                uki: e,
                uto: e,
                yamaga: e,
                yamato: e,
                yatsushiro: e,
              },
            ],
            kyoto: [
              1,
              {
                ayabe: e,
                fukuchiyama: e,
                higashiyama: e,
                ide: e,
                ine: e,
                joyo: e,
                kameoka: e,
                kamo: e,
                kita: e,
                kizu: e,
                kumiyama: e,
                kyotamba: e,
                kyotanabe: e,
                kyotango: e,
                maizuru: e,
                minami: e,
                minamiyamashiro: e,
                miyazu: e,
                muko: e,
                nagaokakyo: e,
                nakagyo: e,
                nantan: e,
                oyamazaki: e,
                sakyo: e,
                seika: e,
                tanabe: e,
                uji: e,
                ujitawara: e,
                wazuka: e,
                yamashina: e,
                yawata: e,
              },
            ],
            mie: [
              1,
              {
                asahi: e,
                inabe: e,
                ise: e,
                kameyama: e,
                kawagoe: e,
                kiho: e,
                kisosaki: e,
                kiwa: e,
                komono: e,
                kumano: e,
                kuwana: e,
                matsusaka: e,
                meiwa: e,
                mihama: e,
                minamiise: e,
                misugi: e,
                miyama: e,
                nabari: e,
                shima: e,
                suzuka: e,
                tado: e,
                taiki: e,
                taki: e,
                tamaki: e,
                toba: e,
                tsu: e,
                udono: e,
                ureshino: e,
                watarai: e,
                yokkaichi: e,
              },
            ],
            miyagi: [
              1,
              {
                furukawa: e,
                higashimatsushima: e,
                ishinomaki: e,
                iwanuma: e,
                kakuda: e,
                kami: e,
                kawasaki: e,
                marumori: e,
                matsushima: e,
                minamisanriku: e,
                misato: e,
                murata: e,
                natori: e,
                ogawara: e,
                ohira: e,
                onagawa: e,
                osaki: e,
                rifu: e,
                semine: e,
                shibata: e,
                shichikashuku: e,
                shikama: e,
                shiogama: e,
                shiroishi: e,
                tagajo: e,
                taiwa: e,
                tome: e,
                tomiya: e,
                wakuya: e,
                watari: e,
                yamamoto: e,
                zao: e,
              },
            ],
            miyazaki: [
              1,
              {
                aya: e,
                ebino: e,
                gokase: e,
                hyuga: e,
                kadogawa: e,
                kawaminami: e,
                kijo: e,
                kitagawa: e,
                kitakata: e,
                kitaura: e,
                kobayashi: e,
                kunitomi: e,
                kushima: e,
                mimata: e,
                miyakonojo: e,
                miyazaki: e,
                morotsuka: e,
                nichinan: e,
                nishimera: e,
                nobeoka: e,
                saito: e,
                shiiba: e,
                shintomi: e,
                takaharu: e,
                takanabe: e,
                takazaki: e,
                tsuno: e,
              },
            ],
            nagano: [
              1,
              {
                achi: e,
                agematsu: e,
                anan: e,
                aoki: e,
                asahi: e,
                azumino: e,
                chikuhoku: e,
                chikuma: e,
                chino: e,
                fujimi: e,
                hakuba: e,
                hara: e,
                hiraya: e,
                iida: e,
                iijima: e,
                iiyama: e,
                iizuna: e,
                ikeda: e,
                ikusaka: e,
                ina: e,
                karuizawa: e,
                kawakami: e,
                kiso: e,
                kisofukushima: e,
                kitaaiki: e,
                komagane: e,
                komoro: e,
                matsukawa: e,
                matsumoto: e,
                miasa: e,
                minamiaiki: e,
                minamimaki: e,
                minamiminowa: e,
                minowa: e,
                miyada: e,
                miyota: e,
                mochizuki: e,
                nagano: e,
                nagawa: e,
                nagiso: e,
                nakagawa: e,
                nakano: e,
                nozawaonsen: e,
                obuse: e,
                ogawa: e,
                okaya: e,
                omachi: e,
                omi: e,
                ookuwa: e,
                ooshika: e,
                otaki: e,
                otari: e,
                sakae: e,
                sakaki: e,
                saku: e,
                sakuho: e,
                shimosuwa: e,
                shinanomachi: e,
                shiojiri: e,
                suwa: e,
                suzaka: e,
                takagi: e,
                takamori: e,
                takayama: e,
                tateshina: e,
                tatsuno: e,
                togakushi: e,
                togura: e,
                tomi: e,
                ueda: e,
                wada: e,
                yamagata: e,
                yamanouchi: e,
                yasaka: e,
                yasuoka: e,
              },
            ],
            nagasaki: [
              1,
              {
                chijiwa: e,
                futsu: e,
                goto: e,
                hasami: e,
                hirado: e,
                iki: e,
                isahaya: e,
                kawatana: e,
                kuchinotsu: e,
                matsuura: e,
                nagasaki: e,
                obama: e,
                omura: e,
                oseto: e,
                saikai: e,
                sasebo: e,
                seihi: e,
                shimabara: e,
                shinkamigoto: e,
                togitsu: e,
                tsushima: e,
                unzen: e,
              },
            ],
            nara: [
              1,
              {
                ando: e,
                gose: e,
                heguri: e,
                higashiyoshino: e,
                ikaruga: e,
                ikoma: e,
                kamikitayama: e,
                kanmaki: e,
                kashiba: e,
                kashihara: e,
                katsuragi: e,
                kawai: e,
                kawakami: e,
                kawanishi: e,
                koryo: e,
                kurotaki: e,
                mitsue: e,
                miyake: e,
                nara: e,
                nosegawa: e,
                oji: e,
                ouda: e,
                oyodo: e,
                sakurai: e,
                sango: e,
                shimoichi: e,
                shimokitayama: e,
                shinjo: e,
                soni: e,
                takatori: e,
                tawaramoto: e,
                tenkawa: e,
                tenri: e,
                uda: e,
                yamatokoriyama: e,
                yamatotakada: e,
                yamazoe: e,
                yoshino: e,
              },
            ],
            niigata: [
              1,
              {
                aga: e,
                agano: e,
                gosen: e,
                itoigawa: e,
                izumozaki: e,
                joetsu: e,
                kamo: e,
                kariwa: e,
                kashiwazaki: e,
                minamiuonuma: e,
                mitsuke: e,
                muika: e,
                murakami: e,
                myoko: e,
                nagaoka: e,
                niigata: e,
                ojiya: e,
                omi: e,
                sado: e,
                sanjo: e,
                seiro: e,
                seirou: e,
                sekikawa: e,
                shibata: e,
                tagami: e,
                tainai: e,
                tochio: e,
                tokamachi: e,
                tsubame: e,
                tsunan: e,
                uonuma: e,
                yahiko: e,
                yoita: e,
                yuzawa: e,
              },
            ],
            oita: [
              1,
              {
                beppu: e,
                bungoono: e,
                bungotakada: e,
                hasama: e,
                hiji: e,
                himeshima: e,
                hita: e,
                kamitsue: e,
                kokonoe: e,
                kuju: e,
                kunisaki: e,
                kusu: e,
                oita: e,
                saiki: e,
                taketa: e,
                tsukumi: e,
                usa: e,
                usuki: e,
                yufu: e,
              },
            ],
            okayama: [
              1,
              {
                akaiwa: e,
                asakuchi: e,
                bizen: e,
                hayashima: e,
                ibara: e,
                kagamino: e,
                kasaoka: e,
                kibichuo: e,
                kumenan: e,
                kurashiki: e,
                maniwa: e,
                misaki: e,
                nagi: e,
                niimi: e,
                nishiawakura: e,
                okayama: e,
                satosho: e,
                setouchi: e,
                shinjo: e,
                shoo: e,
                soja: e,
                takahashi: e,
                tamano: e,
                tsuyama: e,
                wake: e,
                yakage: e,
              },
            ],
            okinawa: [
              1,
              {
                aguni: e,
                ginowan: e,
                ginoza: e,
                gushikami: e,
                haebaru: e,
                higashi: e,
                hirara: e,
                iheya: e,
                ishigaki: e,
                ishikawa: e,
                itoman: e,
                izena: e,
                kadena: e,
                kin: e,
                kitadaito: e,
                kitanakagusuku: e,
                kumejima: e,
                kunigami: e,
                minamidaito: e,
                motobu: e,
                nago: e,
                naha: e,
                nakagusuku: e,
                nakijin: e,
                nanjo: e,
                nishihara: e,
                ogimi: e,
                okinawa: e,
                onna: e,
                shimoji: e,
                taketomi: e,
                tarama: e,
                tokashiki: e,
                tomigusuku: e,
                tonaki: e,
                urasoe: e,
                uruma: e,
                yaese: e,
                yomitan: e,
                yonabaru: e,
                yonaguni: e,
                zamami: e,
              },
            ],
            osaka: [
              1,
              {
                abeno: e,
                chihayaakasaka: e,
                chuo: e,
                daito: e,
                fujiidera: e,
                habikino: e,
                hannan: e,
                higashiosaka: e,
                higashisumiyoshi: e,
                higashiyodogawa: e,
                hirakata: e,
                ibaraki: e,
                ikeda: e,
                izumi: e,
                izumiotsu: e,
                izumisano: e,
                kadoma: e,
                kaizuka: e,
                kanan: e,
                kashiwara: e,
                katano: e,
                kawachinagano: e,
                kishiwada: e,
                kita: e,
                kumatori: e,
                matsubara: e,
                minato: e,
                minoh: e,
                misaki: e,
                moriguchi: e,
                neyagawa: e,
                nishi: e,
                nose: e,
                osakasayama: e,
                sakai: e,
                sayama: e,
                sennan: e,
                settsu: e,
                shijonawate: e,
                shimamoto: e,
                suita: e,
                tadaoka: e,
                taishi: e,
                tajiri: e,
                takaishi: e,
                takatsuki: e,
                tondabayashi: e,
                toyonaka: e,
                toyono: e,
                yao: e,
              },
            ],
            saga: [
              1,
              {
                ariake: e,
                arita: e,
                fukudomi: e,
                genkai: e,
                hamatama: e,
                hizen: e,
                imari: e,
                kamimine: e,
                kanzaki: e,
                karatsu: e,
                kashima: e,
                kitagata: e,
                kitahata: e,
                kiyama: e,
                kouhoku: e,
                kyuragi: e,
                nishiarita: e,
                ogi: e,
                omachi: e,
                ouchi: e,
                saga: e,
                shiroishi: e,
                taku: e,
                tara: e,
                tosu: e,
                yoshinogari: e,
              },
            ],
            saitama: [
              1,
              {
                arakawa: e,
                asaka: e,
                chichibu: e,
                fujimi: e,
                fujimino: e,
                fukaya: e,
                hanno: e,
                hanyu: e,
                hasuda: e,
                hatogaya: e,
                hatoyama: e,
                hidaka: e,
                higashichichibu: e,
                higashimatsuyama: e,
                honjo: e,
                ina: e,
                iruma: e,
                iwatsuki: e,
                kamiizumi: e,
                kamikawa: e,
                kamisato: e,
                kasukabe: e,
                kawagoe: e,
                kawaguchi: e,
                kawajima: e,
                kazo: e,
                kitamoto: e,
                koshigaya: e,
                kounosu: e,
                kuki: e,
                kumagaya: e,
                matsubushi: e,
                minano: e,
                misato: e,
                miyashiro: e,
                miyoshi: e,
                moroyama: e,
                nagatoro: e,
                namegawa: e,
                niiza: e,
                ogano: e,
                ogawa: e,
                ogose: e,
                okegawa: e,
                omiya: e,
                otaki: e,
                ranzan: e,
                ryokami: e,
                saitama: e,
                sakado: e,
                satte: e,
                sayama: e,
                shiki: e,
                shiraoka: e,
                soka: e,
                sugito: e,
                toda: e,
                tokigawa: e,
                tokorozawa: e,
                tsurugashima: e,
                urawa: e,
                warabi: e,
                yashio: e,
                yokoze: e,
                yono: e,
                yorii: e,
                yoshida: e,
                yoshikawa: e,
                yoshimi: e,
              },
            ],
            shiga: [
              1,
              {
                aisho: e,
                gamo: e,
                higashiomi: e,
                hikone: e,
                koka: e,
                konan: e,
                kosei: e,
                koto: e,
                kusatsu: e,
                maibara: e,
                moriyama: e,
                nagahama: e,
                nishiazai: e,
                notogawa: e,
                omihachiman: e,
                otsu: e,
                ritto: e,
                ryuoh: e,
                takashima: e,
                takatsuki: e,
                torahime: e,
                toyosato: e,
                yasu: e,
              },
            ],
            shimane: [
              1,
              {
                akagi: e,
                ama: e,
                gotsu: e,
                hamada: e,
                higashiizumo: e,
                hikawa: e,
                hikimi: e,
                izumo: e,
                kakinoki: e,
                masuda: e,
                matsue: e,
                misato: e,
                nishinoshima: e,
                ohda: e,
                okinoshima: e,
                okuizumo: e,
                shimane: e,
                tamayu: e,
                tsuwano: e,
                unnan: e,
                yakumo: e,
                yasugi: e,
                yatsuka: e,
              },
            ],
            shizuoka: [
              1,
              {
                arai: e,
                atami: e,
                fuji: e,
                fujieda: e,
                fujikawa: e,
                fujinomiya: e,
                fukuroi: e,
                gotemba: e,
                haibara: e,
                hamamatsu: e,
                higashiizu: e,
                ito: e,
                iwata: e,
                izu: e,
                izunokuni: e,
                kakegawa: e,
                kannami: e,
                kawanehon: e,
                kawazu: e,
                kikugawa: e,
                kosai: e,
                makinohara: e,
                matsuzaki: e,
                minamiizu: e,
                mishima: e,
                morimachi: e,
                nishiizu: e,
                numazu: e,
                omaezaki: e,
                shimada: e,
                shimizu: e,
                shimoda: e,
                shizuoka: e,
                susono: e,
                yaizu: e,
                yoshida: e,
              },
            ],
            tochigi: [
              1,
              {
                ashikaga: e,
                bato: e,
                haga: e,
                ichikai: e,
                iwafune: e,
                kaminokawa: e,
                kanuma: e,
                karasuyama: e,
                kuroiso: e,
                mashiko: e,
                mibu: e,
                moka: e,
                motegi: e,
                nasu: e,
                nasushiobara: e,
                nikko: e,
                nishikata: e,
                nogi: e,
                ohira: e,
                ohtawara: e,
                oyama: e,
                sakura: e,
                sano: e,
                shimotsuke: e,
                shioya: e,
                takanezawa: e,
                tochigi: e,
                tsuga: e,
                ujiie: e,
                utsunomiya: e,
                yaita: e,
              },
            ],
            tokushima: [
              1,
              {
                aizumi: e,
                anan: e,
                ichiba: e,
                itano: e,
                kainan: e,
                komatsushima: e,
                matsushige: e,
                mima: e,
                minami: e,
                miyoshi: e,
                mugi: e,
                nakagawa: e,
                naruto: e,
                sanagochi: e,
                shishikui: e,
                tokushima: e,
                wajiki: e,
              },
            ],
            tokyo: [
              1,
              {
                adachi: e,
                akiruno: e,
                akishima: e,
                aogashima: e,
                arakawa: e,
                bunkyo: e,
                chiyoda: e,
                chofu: e,
                chuo: e,
                edogawa: e,
                fuchu: e,
                fussa: e,
                hachijo: e,
                hachioji: e,
                hamura: e,
                higashikurume: e,
                higashimurayama: e,
                higashiyamato: e,
                hino: e,
                hinode: e,
                hinohara: e,
                inagi: e,
                itabashi: e,
                katsushika: e,
                kita: e,
                kiyose: e,
                kodaira: e,
                koganei: e,
                kokubunji: e,
                komae: e,
                koto: e,
                kouzushima: e,
                kunitachi: e,
                machida: e,
                meguro: e,
                minato: e,
                mitaka: e,
                mizuho: e,
                musashimurayama: e,
                musashino: e,
                nakano: e,
                nerima: e,
                ogasawara: e,
                okutama: e,
                ome: e,
                oshima: e,
                ota: e,
                setagaya: e,
                shibuya: e,
                shinagawa: e,
                shinjuku: e,
                suginami: e,
                sumida: e,
                tachikawa: e,
                taito: e,
                tama: e,
                toshima: e,
              },
            ],
            tottori: [
              1,
              {
                chizu: e,
                hino: e,
                kawahara: e,
                koge: e,
                kotoura: e,
                misasa: e,
                nanbu: e,
                nichinan: e,
                sakaiminato: e,
                tottori: e,
                wakasa: e,
                yazu: e,
                yonago: e,
              },
            ],
            toyama: [
              1,
              {
                asahi: e,
                fuchu: e,
                fukumitsu: e,
                funahashi: e,
                himi: e,
                imizu: e,
                inami: e,
                johana: e,
                kamiichi: e,
                kurobe: e,
                nakaniikawa: e,
                namerikawa: e,
                nanto: e,
                nyuzen: e,
                oyabe: e,
                taira: e,
                takaoka: e,
                tateyama: e,
                toga: e,
                tonami: e,
                toyama: e,
                unazuki: e,
                uozu: e,
                yamada: e,
              },
            ],
            wakayama: [
              1,
              {
                arida: e,
                aridagawa: e,
                gobo: e,
                hashimoto: e,
                hidaka: e,
                hirogawa: e,
                inami: e,
                iwade: e,
                kainan: e,
                kamitonda: e,
                katsuragi: e,
                kimino: e,
                kinokawa: e,
                kitayama: e,
                koya: e,
                koza: e,
                kozagawa: e,
                kudoyama: e,
                kushimoto: e,
                mihama: e,
                misato: e,
                nachikatsuura: e,
                shingu: e,
                shirahama: e,
                taiji: e,
                tanabe: e,
                wakayama: e,
                yuasa: e,
                yura: e,
              },
            ],
            yamagata: [
              1,
              {
                asahi: e,
                funagata: e,
                higashine: e,
                iide: e,
                kahoku: e,
                kaminoyama: e,
                kaneyama: e,
                kawanishi: e,
                mamurogawa: e,
                mikawa: e,
                murayama: e,
                nagai: e,
                nakayama: e,
                nanyo: e,
                nishikawa: e,
                obanazawa: e,
                oe: e,
                oguni: e,
                ohkura: e,
                oishida: e,
                sagae: e,
                sakata: e,
                sakegawa: e,
                shinjo: e,
                shirataka: e,
                shonai: e,
                takahata: e,
                tendo: e,
                tozawa: e,
                tsuruoka: e,
                yamagata: e,
                yamanobe: e,
                yonezawa: e,
                yuza: e,
              },
            ],
            yamaguchi: [
              1,
              {
                abu: e,
                hagi: e,
                hikari: e,
                hofu: e,
                iwakuni: e,
                kudamatsu: e,
                mitou: e,
                nagato: e,
                oshima: e,
                shimonoseki: e,
                shunan: e,
                tabuse: e,
                tokuyama: e,
                toyota: e,
                ube: e,
                yuu: e,
              },
            ],
            yamanashi: [
              1,
              {
                chuo: e,
                doshi: e,
                fuefuki: e,
                fujikawa: e,
                fujikawaguchiko: e,
                fujiyoshida: e,
                hayakawa: e,
                hokuto: e,
                ichikawamisato: e,
                kai: e,
                kofu: e,
                koshu: e,
                kosuge: e,
                "minami-alps": e,
                minobu: e,
                nakamichi: e,
                nanbu: e,
                narusawa: e,
                nirasaki: e,
                nishikatsura: e,
                oshino: e,
                otsuki: e,
                showa: e,
                tabayama: e,
                tsuru: e,
                uenohara: e,
                yamanakako: e,
                yamanashi: e,
              },
            ],
            "xn--ehqz56n": e,
            三重: e,
            "xn--1lqs03n": e,
            京都: e,
            "xn--qqqt11m": e,
            佐賀: e,
            "xn--f6qx53a": e,
            兵庫: e,
            "xn--djrs72d6uy": e,
            北海道: e,
            "xn--mkru45i": e,
            千葉: e,
            "xn--0trq7p7nn": e,
            和歌山: e,
            "xn--5js045d": e,
            埼玉: e,
            "xn--kbrq7o": e,
            大分: e,
            "xn--pssu33l": e,
            大阪: e,
            "xn--ntsq17g": e,
            奈良: e,
            "xn--uisz3g": e,
            宮城: e,
            "xn--6btw5a": e,
            宮崎: e,
            "xn--1ctwo": e,
            富山: e,
            "xn--6orx2r": e,
            山口: e,
            "xn--rht61e": e,
            山形: e,
            "xn--rht27z": e,
            山梨: e,
            "xn--nit225k": e,
            岐阜: e,
            "xn--rht3d": e,
            岡山: e,
            "xn--djty4k": e,
            岩手: e,
            "xn--klty5x": e,
            島根: e,
            "xn--kltx9a": e,
            広島: e,
            "xn--kltp7d": e,
            徳島: e,
            "xn--c3s14m": e,
            愛媛: e,
            "xn--vgu402c": e,
            愛知: e,
            "xn--efvn9s": e,
            新潟: e,
            "xn--1lqs71d": e,
            東京: e,
            "xn--4pvxs": e,
            栃木: e,
            "xn--uuwu58a": e,
            沖縄: e,
            "xn--zbx025d": e,
            滋賀: e,
            "xn--8pvr4u": e,
            熊本: e,
            "xn--5rtp49c": e,
            石川: e,
            "xn--ntso0iqx3a": e,
            神奈川: e,
            "xn--elqq16h": e,
            福井: e,
            "xn--4it168d": e,
            福岡: e,
            "xn--klt787d": e,
            福島: e,
            "xn--rny31h": e,
            秋田: e,
            "xn--7t0a264c": e,
            群馬: e,
            "xn--uist22h": e,
            茨城: e,
            "xn--8ltr62k": e,
            長崎: e,
            "xn--2m4a15e": e,
            長野: e,
            "xn--32vp30h": e,
            青森: e,
            "xn--4it797k": e,
            静岡: e,
            "xn--5rtq34k": e,
            香川: e,
            "xn--k7yn95e": e,
            高知: e,
            "xn--tor131o": e,
            鳥取: e,
            "xn--d5qv7z876c": e,
            鹿児島: e,
            kawasaki: h,
            kitakyushu: h,
            kobe: h,
            nagoya: h,
            sapporo: h,
            sendai: h,
            yokohama: h,
            buyshop: t,
            fashionstore: t,
            handcrafted: t,
            kawaiishop: t,
            supersale: t,
            theshop: t,
            "0am": t,
            "0g0": t,
            "0j0": t,
            "0t0": t,
            mydns: t,
            pgw: t,
            wjg: t,
            usercontent: t,
            angry: t,
            babyblue: t,
            babymilk: t,
            backdrop: t,
            bambina: t,
            bitter: t,
            blush: t,
            boo: t,
            boy: t,
            boyfriend: t,
            but: t,
            candypop: t,
            capoo: t,
            catfood: t,
            cheap: t,
            chicappa: t,
            chillout: t,
            chips: t,
            chowder: t,
            chu: t,
            ciao: t,
            cocotte: t,
            coolblog: t,
            cranky: t,
            cutegirl: t,
            daa: t,
            deca: t,
            deci: t,
            digick: t,
            egoism: t,
            fakefur: t,
            fem: t,
            flier: t,
            floppy: t,
            fool: t,
            frenchkiss: t,
            girlfriend: t,
            girly: t,
            gloomy: t,
            gonna: t,
            greater: t,
            hacca: t,
            heavy: t,
            her: t,
            hiho: t,
            hippy: t,
            holy: t,
            hungry: t,
            icurus: t,
            itigo: t,
            jellybean: t,
            kikirara: t,
            kill: t,
            kilo: t,
            kuron: t,
            littlestar: t,
            lolipopmc: t,
            lolitapunk: t,
            lomo: t,
            lovepop: t,
            lovesick: t,
            main: t,
            mods: t,
            mond: t,
            mongolian: t,
            moo: t,
            namaste: t,
            nikita: t,
            nobushi: t,
            noor: t,
            oops: t,
            parallel: t,
            parasite: t,
            pecori: t,
            peewee: t,
            penne: t,
            pepper: t,
            perma: t,
            pigboat: t,
            pinoko: t,
            punyu: t,
            pupu: t,
            pussycat: t,
            pya: t,
            raindrop: t,
            readymade: t,
            sadist: t,
            schoolbus: t,
            secret: t,
            staba: t,
            stripper: t,
            sub: t,
            sunnyday: t,
            thick: t,
            tonkotsu: t,
            under: t,
            upper: t,
            velvet: t,
            verse: t,
            versus: t,
            vivian: t,
            watson: t,
            weblike: t,
            whitesnow: t,
            zombie: t,
            hateblo: t,
            hatenablog: t,
            hatenadiary: t,
            "2-d": t,
            bona: t,
            crap: t,
            daynight: t,
            eek: t,
            flop: t,
            halfmoon: t,
            jeez: t,
            matrix: t,
            mimoza: t,
            netgamers: t,
            nyanta: t,
            o0o0: t,
            rdy: t,
            rgr: t,
            rulez: t,
            sakurastorage: [0, { isk01: _e, isk02: _e }],
            saloon: t,
            sblo: t,
            skr: t,
            tank: t,
            "uh-oh": t,
            undo: t,
            webaccel: [0, { rs: t, user: t }],
            websozai: t,
            xii: t,
          },
        ],
        ke: [
          1,
          { ac: e, co: e, go: e, info: e, me: e, mobi: e, ne: e, or: e, sc: e },
        ],
        kg: [1, { com: e, edu: e, gov: e, mil: e, net: e, org: e, us: t }],
        kh: h,
        ki: ve,
        km: [
          1,
          {
            ass: e,
            com: e,
            edu: e,
            gov: e,
            mil: e,
            nom: e,
            org: e,
            prd: e,
            tm: e,
            asso: e,
            coop: e,
            gouv: e,
            medecin: e,
            notaires: e,
            pharmaciens: e,
            presse: e,
            veterinaire: e,
          },
        ],
        kn: [1, { edu: e, gov: e, net: e, org: e }],
        kp: [1, { com: e, edu: e, gov: e, org: e, rep: e, tra: e }],
        kr: [
          1,
          {
            ac: e,
            ai: e,
            co: e,
            es: e,
            go: e,
            hs: e,
            io: e,
            it: e,
            kg: e,
            me: e,
            mil: e,
            ms: e,
            ne: e,
            or: e,
            pe: e,
            re: e,
            sc: e,
            busan: e,
            chungbuk: e,
            chungnam: e,
            daegu: e,
            daejeon: e,
            gangwon: e,
            gwangju: e,
            gyeongbuk: e,
            gyeonggi: e,
            gyeongnam: e,
            incheon: e,
            jeju: e,
            jeonbuk: e,
            jeonnam: e,
            seoul: e,
            ulsan: e,
            c01: t,
            "eliv-dns": t,
          },
        ],
        kw: [1, { com: e, edu: e, emb: e, gov: e, ind: e, net: e, org: e }],
        ky: M,
        kz: [1, { com: e, edu: e, gov: e, mil: e, net: e, org: e, jcloud: t }],
        la: [
          1,
          {
            com: e,
            edu: e,
            gov: e,
            info: e,
            int: e,
            net: e,
            org: e,
            per: e,
            bnr: t,
          },
        ],
        lb: n,
        lc: [1, { co: e, com: e, edu: e, gov: e, net: e, org: e, oy: t }],
        li: e,
        lk: [
          1,
          {
            ac: e,
            assn: e,
            com: e,
            edu: e,
            gov: e,
            grp: e,
            hotel: e,
            int: e,
            ltd: e,
            net: e,
            ngo: e,
            org: e,
            sch: e,
            soc: e,
            web: e,
          },
        ],
        lr: n,
        ls: [
          1,
          {
            ac: e,
            biz: e,
            co: e,
            edu: e,
            gov: e,
            info: e,
            net: e,
            org: e,
            sc: e,
          },
        ],
        lt: c,
        lu: [1, { "123website": t }],
        lv: [
          1,
          {
            asn: e,
            com: e,
            conf: e,
            edu: e,
            gov: e,
            id: e,
            mil: e,
            net: e,
            org: e,
          },
        ],
        ly: [
          1,
          {
            com: e,
            edu: e,
            gov: e,
            id: e,
            med: e,
            net: e,
            org: e,
            plc: e,
            sch: e,
          },
        ],
        ma: [1, { ac: e, co: e, gov: e, net: e, org: e, press: e }],
        mc: [1, { asso: e, tm: e }],
        md: [1, { ir: t }],
        me: [
          1,
          {
            ac: e,
            co: e,
            edu: e,
            gov: e,
            its: e,
            net: e,
            org: e,
            priv: e,
            c66: t,
            craft: t,
            edgestack: t,
            filegear: t,
            glitch: t,
            "filegear-sg": t,
            lohmus: t,
            barsy: t,
            mcdir: t,
            brasilia: t,
            ddns: t,
            dnsfor: t,
            hopto: t,
            loginto: t,
            noip: t,
            webhop: t,
            soundcast: t,
            tcp4: t,
            vp4: t,
            diskstation: t,
            dscloud: t,
            i234: t,
            myds: t,
            synology: t,
            transip: ce,
            nohost: t,
          },
        ],
        mg: [
          1,
          { co: e, com: e, edu: e, gov: e, mil: e, nom: e, org: e, prd: e },
        ],
        mh: e,
        mil: e,
        mk: [1, { com: e, edu: e, gov: e, inf: e, name: e, net: e, org: e }],
        ml: [
          1,
          {
            ac: e,
            art: e,
            asso: e,
            com: e,
            edu: e,
            gouv: e,
            gov: e,
            info: e,
            inst: e,
            net: e,
            org: e,
            pr: e,
            presse: e,
          },
        ],
        mm: h,
        mn: [1, { edu: e, gov: e, org: e, nyc: t }],
        mo: n,
        mobi: [1, { barsy: t, dscloud: t }],
        mp: [1, { ju: t }],
        mq: e,
        mr: c,
        ms: [1, { com: e, edu: e, gov: e, net: e, org: e, minisite: t }],
        mt: M,
        mu: [1, { ac: e, co: e, com: e, gov: e, net: e, or: e, org: e }],
        museum: e,
        mv: [
          1,
          {
            aero: e,
            biz: e,
            com: e,
            coop: e,
            edu: e,
            gov: e,
            info: e,
            int: e,
            mil: e,
            museum: e,
            name: e,
            net: e,
            org: e,
            pro: e,
          },
        ],
        mw: [
          1,
          {
            ac: e,
            biz: e,
            co: e,
            com: e,
            coop: e,
            edu: e,
            gov: e,
            int: e,
            net: e,
            org: e,
          },
        ],
        mx: [1, { com: e, edu: e, gob: e, net: e, org: e }],
        my: [
          1,
          { biz: e, com: e, edu: e, gov: e, mil: e, name: e, net: e, org: e },
        ],
        mz: [
          1,
          { ac: e, adv: e, co: e, edu: e, gov: e, mil: e, net: e, org: e },
        ],
        na: [1, { alt: e, co: e, com: e, gov: e, net: e, org: e }],
        name: [1, { her: P, his: P }],
        nc: [1, { asso: e, nom: e }],
        ne: e,
        net: [
          1,
          {
            adobeaemcloud: t,
            "adobeio-static": t,
            adobeioruntime: t,
            akadns: t,
            akamai: t,
            "akamai-staging": t,
            akamaiedge: t,
            "akamaiedge-staging": t,
            akamaihd: t,
            "akamaihd-staging": t,
            akamaiorigin: t,
            "akamaiorigin-staging": t,
            akamaized: t,
            "akamaized-staging": t,
            edgekey: t,
            "edgekey-staging": t,
            edgesuite: t,
            "edgesuite-staging": t,
            alwaysdata: t,
            myamaze: t,
            cloudfront: t,
            appudo: t,
            "atlassian-dev": [0, { prod: N }],
            myfritz: t,
            onavstack: t,
            shopselect: t,
            blackbaudcdn: t,
            boomla: t,
            bplaced: t,
            square7: t,
            cdn77: [0, { r: t }],
            "cdn77-ssl": t,
            gb: t,
            hu: t,
            jp: t,
            se: t,
            uk: t,
            clickrising: t,
            "ddns-ip": t,
            "dns-cloud": t,
            "dns-dynamic": t,
            cloudaccess: t,
            cloudflare: [2, { cdn: t }],
            cloudflareanycast: N,
            cloudflarecn: N,
            cloudflareglobal: N,
            ctfcloud: t,
            "feste-ip": t,
            "knx-server": t,
            "static-access": t,
            cryptonomic: i,
            dattolocal: t,
            mydatto: t,
            debian: t,
            definima: t,
            deno: t,
            "at-band-camp": t,
            blogdns: t,
            "broke-it": t,
            buyshouses: t,
            dnsalias: t,
            dnsdojo: t,
            "does-it": t,
            dontexist: t,
            dynalias: t,
            dynathome: t,
            endofinternet: t,
            "from-az": t,
            "from-co": t,
            "from-la": t,
            "from-ny": t,
            "gets-it": t,
            "ham-radio-op": t,
            homeftp: t,
            homeip: t,
            homelinux: t,
            homeunix: t,
            "in-the-band": t,
            "is-a-chef": t,
            "is-a-geek": t,
            "isa-geek": t,
            "kicks-ass": t,
            "office-on-the": t,
            podzone: t,
            "scrapper-site": t,
            selfip: t,
            "sells-it": t,
            servebbs: t,
            serveftp: t,
            thruhere: t,
            webhop: t,
            casacam: t,
            dynu: t,
            dynv6: t,
            twmail: t,
            ru: t,
            channelsdvr: [2, { u: t }],
            fastly: [
              0,
              {
                freetls: t,
                map: t,
                prod: [0, { a: t, global: t }],
                ssl: [0, { a: t, b: t, global: t }],
              },
            ],
            fastlylb: [2, { map: t }],
            edgeapp: t,
            "keyword-on": t,
            "live-on": t,
            "server-on": t,
            "cdn-edges": t,
            heteml: t,
            cloudfunctions: t,
            "grafana-dev": t,
            iobb: t,
            moonscale: t,
            "in-dsl": t,
            "in-vpn": t,
            oninferno: t,
            botdash: t,
            "apps-1and1": t,
            ipifony: t,
            cloudjiffy: [2, { "fra1-de": t, "west1-us": t }],
            elastx: [0, { "jls-sto1": t, "jls-sto2": t, "jls-sto3": t }],
            massivegrid: [
              0,
              {
                paas: [
                  0,
                  {
                    "fr-1": t,
                    "lon-1": t,
                    "lon-2": t,
                    "ny-1": t,
                    "ny-2": t,
                    "sg-1": t,
                  },
                ],
              },
            ],
            saveincloud: [0, { jelastic: t, "nordeste-idc": t }],
            scaleforce: le,
            kinghost: t,
            uni5: t,
            krellian: t,
            ggff: t,
            localcert: t,
            localhostcert: t,
            localto: i,
            barsy: t,
            memset: t,
            "azure-api": t,
            "azure-mobile": t,
            azureedge: t,
            azurefd: t,
            azurestaticapps: [
              2,
              {
                1: t,
                2: t,
                3: t,
                4: t,
                5: t,
                6: t,
                7: t,
                centralus: t,
                eastasia: t,
                eastus2: t,
                westeurope: t,
                westus2: t,
              },
            ],
            azurewebsites: t,
            cloudapp: t,
            trafficmanager: t,
            windows: [0, { core: [0, { blob: t }], servicebus: t }],
            mynetname: [0, { sn: t }],
            routingthecloud: t,
            bounceme: t,
            ddns: t,
            "eating-organic": t,
            mydissent: t,
            myeffect: t,
            mymediapc: t,
            mypsx: t,
            mysecuritycamera: t,
            nhlfan: t,
            "no-ip": t,
            pgafan: t,
            privatizehealthinsurance: t,
            redirectme: t,
            serveblog: t,
            serveminecraft: t,
            sytes: t,
            dnsup: t,
            hicam: t,
            "now-dns": t,
            ownip: t,
            vpndns: t,
            cloudycluster: t,
            ovh: [0, { hosting: i, webpaas: i }],
            rackmaze: t,
            myradweb: t,
            in: t,
            "subsc-pay": t,
            squares: t,
            schokokeks: t,
            "firewall-gateway": t,
            seidat: t,
            senseering: t,
            siteleaf: t,
            mafelo: t,
            myspreadshop: t,
            "vps-host": [2, { jelastic: [0, { atl: t, njs: t, ric: t }] }],
            srcf: [0, { soc: t, user: t }],
            supabase: t,
            dsmynas: t,
            familyds: t,
            ts: [2, { c: i }],
            torproject: [2, { pages: t }],
            vusercontent: t,
            "reserve-online": t,
            "community-pro": t,
            meinforum: t,
            yandexcloud: [2, { storage: t, website: t }],
            za: t,
          },
        ],
        nf: [
          1,
          {
            arts: e,
            com: e,
            firm: e,
            info: e,
            net: e,
            other: e,
            per: e,
            rec: e,
            store: e,
            web: e,
          },
        ],
        ng: [
          1,
          {
            com: e,
            edu: e,
            gov: e,
            i: e,
            mil: e,
            mobi: e,
            name: e,
            net: e,
            org: e,
            sch: e,
            biz: [2, { co: t, dl: t, go: t, lg: t, on: t }],
            col: t,
            firm: t,
            gen: t,
            ltd: t,
            ngo: t,
            plc: t,
          },
        ],
        ni: [
          1,
          {
            ac: e,
            biz: e,
            co: e,
            com: e,
            edu: e,
            gob: e,
            in: e,
            info: e,
            int: e,
            mil: e,
            net: e,
            nom: e,
            org: e,
            web: e,
          },
        ],
        nl: [
          1,
          {
            co: t,
            "hosting-cluster": t,
            gov: t,
            khplay: t,
            "123website": t,
            myspreadshop: t,
            transurl: i,
            cistron: t,
            demon: t,
          },
        ],
        no: [
          1,
          {
            fhs: e,
            folkebibl: e,
            fylkesbibl: e,
            idrett: e,
            museum: e,
            priv: e,
            vgs: e,
            dep: e,
            herad: e,
            kommune: e,
            mil: e,
            stat: e,
            aa: F,
            ah: F,
            bu: F,
            fm: F,
            hl: F,
            hm: F,
            "jan-mayen": F,
            mr: F,
            nl: F,
            nt: F,
            of: F,
            ol: F,
            oslo: F,
            rl: F,
            sf: F,
            st: F,
            svalbard: F,
            tm: F,
            tr: F,
            va: F,
            vf: F,
            akrehamn: e,
            "xn--krehamn-dxa": e,
            åkrehamn: e,
            algard: e,
            "xn--lgrd-poac": e,
            ålgård: e,
            arna: e,
            bronnoysund: e,
            "xn--brnnysund-m8ac": e,
            brønnøysund: e,
            brumunddal: e,
            bryne: e,
            drobak: e,
            "xn--drbak-wua": e,
            drøbak: e,
            egersund: e,
            fetsund: e,
            floro: e,
            "xn--flor-jra": e,
            florø: e,
            fredrikstad: e,
            hokksund: e,
            honefoss: e,
            "xn--hnefoss-q1a": e,
            hønefoss: e,
            jessheim: e,
            jorpeland: e,
            "xn--jrpeland-54a": e,
            jørpeland: e,
            kirkenes: e,
            kopervik: e,
            krokstadelva: e,
            langevag: e,
            "xn--langevg-jxa": e,
            langevåg: e,
            leirvik: e,
            mjondalen: e,
            "xn--mjndalen-64a": e,
            mjøndalen: e,
            "mo-i-rana": e,
            mosjoen: e,
            "xn--mosjen-eya": e,
            mosjøen: e,
            nesoddtangen: e,
            orkanger: e,
            osoyro: e,
            "xn--osyro-wua": e,
            osøyro: e,
            raholt: e,
            "xn--rholt-mra": e,
            råholt: e,
            sandnessjoen: e,
            "xn--sandnessjen-ogb": e,
            sandnessjøen: e,
            skedsmokorset: e,
            slattum: e,
            spjelkavik: e,
            stathelle: e,
            stavern: e,
            stjordalshalsen: e,
            "xn--stjrdalshalsen-sqb": e,
            stjørdalshalsen: e,
            tananger: e,
            tranby: e,
            vossevangen: e,
            aarborte: e,
            aejrie: e,
            afjord: e,
            "xn--fjord-lra": e,
            åfjord: e,
            agdenes: e,
            akershus: xe,
            aknoluokta: e,
            "xn--koluokta-7ya57h": e,
            ákŋoluokta: e,
            al: e,
            "xn--l-1fa": e,
            ål: e,
            alaheadju: e,
            "xn--laheadju-7ya": e,
            álaheadju: e,
            alesund: e,
            "xn--lesund-hua": e,
            ålesund: e,
            alstahaug: e,
            alta: e,
            "xn--lt-liac": e,
            áltá: e,
            alvdal: e,
            amli: e,
            "xn--mli-tla": e,
            åmli: e,
            amot: e,
            "xn--mot-tla": e,
            åmot: e,
            andasuolo: e,
            andebu: e,
            andoy: e,
            "xn--andy-ira": e,
            andøy: e,
            ardal: e,
            "xn--rdal-poa": e,
            årdal: e,
            aremark: e,
            arendal: e,
            "xn--s-1fa": e,
            ås: e,
            aseral: e,
            "xn--seral-lra": e,
            åseral: e,
            asker: e,
            askim: e,
            askoy: e,
            "xn--asky-ira": e,
            askøy: e,
            askvoll: e,
            asnes: e,
            "xn--snes-poa": e,
            åsnes: e,
            audnedaln: e,
            aukra: e,
            aure: e,
            aurland: e,
            "aurskog-holand": e,
            "xn--aurskog-hland-jnb": e,
            "aurskog-høland": e,
            austevoll: e,
            austrheim: e,
            averoy: e,
            "xn--avery-yua": e,
            averøy: e,
            badaddja: e,
            "xn--bdddj-mrabd": e,
            bådåddjå: e,
            "xn--brum-voa": e,
            bærum: e,
            bahcavuotna: e,
            "xn--bhcavuotna-s4a": e,
            báhcavuotna: e,
            bahccavuotna: e,
            "xn--bhccavuotna-k7a": e,
            báhccavuotna: e,
            baidar: e,
            "xn--bidr-5nac": e,
            báidár: e,
            bajddar: e,
            "xn--bjddar-pta": e,
            bájddar: e,
            balat: e,
            "xn--blt-elab": e,
            bálát: e,
            balestrand: e,
            ballangen: e,
            balsfjord: e,
            bamble: e,
            bardu: e,
            barum: e,
            batsfjord: e,
            "xn--btsfjord-9za": e,
            båtsfjord: e,
            bearalvahki: e,
            "xn--bearalvhki-y4a": e,
            bearalváhki: e,
            beardu: e,
            beiarn: e,
            berg: e,
            bergen: e,
            berlevag: e,
            "xn--berlevg-jxa": e,
            berlevåg: e,
            bievat: e,
            "xn--bievt-0qa": e,
            bievát: e,
            bindal: e,
            birkenes: e,
            bjarkoy: e,
            "xn--bjarky-fya": e,
            bjarkøy: e,
            bjerkreim: e,
            bjugn: e,
            bodo: e,
            "xn--bod-2na": e,
            bodø: e,
            bokn: e,
            bomlo: e,
            "xn--bmlo-gra": e,
            bømlo: e,
            bremanger: e,
            bronnoy: e,
            "xn--brnny-wuac": e,
            brønnøy: e,
            budejju: e,
            buskerud: xe,
            bygland: e,
            bykle: e,
            cahcesuolo: e,
            "xn--hcesuolo-7ya35b": e,
            čáhcesuolo: e,
            davvenjarga: e,
            "xn--davvenjrga-y4a": e,
            davvenjárga: e,
            davvesiida: e,
            deatnu: e,
            dielddanuorri: e,
            divtasvuodna: e,
            divttasvuotna: e,
            donna: e,
            "xn--dnna-gra": e,
            dønna: e,
            dovre: e,
            drammen: e,
            drangedal: e,
            dyroy: e,
            "xn--dyry-ira": e,
            dyrøy: e,
            eid: e,
            eidfjord: e,
            eidsberg: e,
            eidskog: e,
            eidsvoll: e,
            eigersund: e,
            elverum: e,
            enebakk: e,
            engerdal: e,
            etne: e,
            etnedal: e,
            evenassi: e,
            "xn--eveni-0qa01ga": e,
            evenášši: e,
            evenes: e,
            "evje-og-hornnes": e,
            farsund: e,
            fauske: e,
            fedje: e,
            fet: e,
            finnoy: e,
            "xn--finny-yua": e,
            finnøy: e,
            fitjar: e,
            fjaler: e,
            fjell: e,
            fla: e,
            "xn--fl-zia": e,
            flå: e,
            flakstad: e,
            flatanger: e,
            flekkefjord: e,
            flesberg: e,
            flora: e,
            folldal: e,
            forde: e,
            "xn--frde-gra": e,
            førde: e,
            forsand: e,
            fosnes: e,
            "xn--frna-woa": e,
            fræna: e,
            frana: e,
            frei: e,
            frogn: e,
            froland: e,
            frosta: e,
            froya: e,
            "xn--frya-hra": e,
            frøya: e,
            fuoisku: e,
            fuossko: e,
            fusa: e,
            fyresdal: e,
            gaivuotna: e,
            "xn--givuotna-8ya": e,
            gáivuotna: e,
            galsa: e,
            "xn--gls-elac": e,
            gálsá: e,
            gamvik: e,
            gangaviika: e,
            "xn--ggaviika-8ya47h": e,
            gáŋgaviika: e,
            gaular: e,
            gausdal: e,
            giehtavuoatna: e,
            gildeskal: e,
            "xn--gildeskl-g0a": e,
            gildeskål: e,
            giske: e,
            gjemnes: e,
            gjerdrum: e,
            gjerstad: e,
            gjesdal: e,
            gjovik: e,
            "xn--gjvik-wua": e,
            gjøvik: e,
            gloppen: e,
            gol: e,
            gran: e,
            grane: e,
            granvin: e,
            gratangen: e,
            grimstad: e,
            grong: e,
            grue: e,
            gulen: e,
            guovdageaidnu: e,
            ha: e,
            "xn--h-2fa": e,
            hå: e,
            habmer: e,
            "xn--hbmer-xqa": e,
            hábmer: e,
            hadsel: e,
            "xn--hgebostad-g3a": e,
            hægebostad: e,
            hagebostad: e,
            halden: e,
            halsa: e,
            hamar: e,
            hamaroy: e,
            hammarfeasta: e,
            "xn--hmmrfeasta-s4ac": e,
            hámmárfeasta: e,
            hammerfest: e,
            hapmir: e,
            "xn--hpmir-xqa": e,
            hápmir: e,
            haram: e,
            hareid: e,
            harstad: e,
            hasvik: e,
            hattfjelldal: e,
            haugesund: e,
            hedmark: [0, { os: e, valer: e, "xn--vler-qoa": e, våler: e }],
            hemne: e,
            hemnes: e,
            hemsedal: e,
            hitra: e,
            hjartdal: e,
            hjelmeland: e,
            hobol: e,
            "xn--hobl-ira": e,
            hobøl: e,
            hof: e,
            hol: e,
            hole: e,
            holmestrand: e,
            holtalen: e,
            "xn--holtlen-hxa": e,
            holtålen: e,
            hordaland: [0, { os: e }],
            hornindal: e,
            horten: e,
            hoyanger: e,
            "xn--hyanger-q1a": e,
            høyanger: e,
            hoylandet: e,
            "xn--hylandet-54a": e,
            høylandet: e,
            hurdal: e,
            hurum: e,
            hvaler: e,
            hyllestad: e,
            ibestad: e,
            inderoy: e,
            "xn--indery-fya": e,
            inderøy: e,
            iveland: e,
            ivgu: e,
            jevnaker: e,
            jolster: e,
            "xn--jlster-bya": e,
            jølster: e,
            jondal: e,
            kafjord: e,
            "xn--kfjord-iua": e,
            kåfjord: e,
            karasjohka: e,
            "xn--krjohka-hwab49j": e,
            kárášjohka: e,
            karasjok: e,
            karlsoy: e,
            karmoy: e,
            "xn--karmy-yua": e,
            karmøy: e,
            kautokeino: e,
            klabu: e,
            "xn--klbu-woa": e,
            klæbu: e,
            klepp: e,
            kongsberg: e,
            kongsvinger: e,
            kraanghke: e,
            "xn--kranghke-b0a": e,
            kråanghke: e,
            kragero: e,
            "xn--krager-gya": e,
            kragerø: e,
            kristiansand: e,
            kristiansund: e,
            krodsherad: e,
            "xn--krdsherad-m8a": e,
            krødsherad: e,
            "xn--kvfjord-nxa": e,
            kvæfjord: e,
            "xn--kvnangen-k0a": e,
            kvænangen: e,
            kvafjord: e,
            kvalsund: e,
            kvam: e,
            kvanangen: e,
            kvinesdal: e,
            kvinnherad: e,
            kviteseid: e,
            kvitsoy: e,
            "xn--kvitsy-fya": e,
            kvitsøy: e,
            laakesvuemie: e,
            "xn--lrdal-sra": e,
            lærdal: e,
            lahppi: e,
            "xn--lhppi-xqa": e,
            láhppi: e,
            lardal: e,
            larvik: e,
            lavagis: e,
            lavangen: e,
            leangaviika: e,
            "xn--leagaviika-52b": e,
            leaŋgaviika: e,
            lebesby: e,
            leikanger: e,
            leirfjord: e,
            leka: e,
            leksvik: e,
            lenvik: e,
            lerdal: e,
            lesja: e,
            levanger: e,
            lier: e,
            lierne: e,
            lillehammer: e,
            lillesand: e,
            lindas: e,
            "xn--linds-pra": e,
            lindås: e,
            lindesnes: e,
            loabat: e,
            "xn--loabt-0qa": e,
            loabát: e,
            lodingen: e,
            "xn--ldingen-q1a": e,
            lødingen: e,
            lom: e,
            loppa: e,
            lorenskog: e,
            "xn--lrenskog-54a": e,
            lørenskog: e,
            loten: e,
            "xn--lten-gra": e,
            løten: e,
            lund: e,
            lunner: e,
            luroy: e,
            "xn--lury-ira": e,
            lurøy: e,
            luster: e,
            lyngdal: e,
            lyngen: e,
            malatvuopmi: e,
            "xn--mlatvuopmi-s4a": e,
            málatvuopmi: e,
            malselv: e,
            "xn--mlselv-iua": e,
            målselv: e,
            malvik: e,
            mandal: e,
            marker: e,
            marnardal: e,
            masfjorden: e,
            masoy: e,
            "xn--msy-ula0h": e,
            måsøy: e,
            "matta-varjjat": e,
            "xn--mtta-vrjjat-k7af": e,
            "mátta-várjjat": e,
            meland: e,
            meldal: e,
            melhus: e,
            meloy: e,
            "xn--mely-ira": e,
            meløy: e,
            meraker: e,
            "xn--merker-kua": e,
            meråker: e,
            midsund: e,
            "midtre-gauldal": e,
            moareke: e,
            "xn--moreke-jua": e,
            moåreke: e,
            modalen: e,
            modum: e,
            molde: e,
            "more-og-romsdal": [0, { heroy: e, sande: e }],
            "xn--mre-og-romsdal-qqb": [0, { "xn--hery-ira": e, sande: e }],
            "møre-og-romsdal": [0, { herøy: e, sande: e }],
            moskenes: e,
            moss: e,
            mosvik: e,
            muosat: e,
            "xn--muost-0qa": e,
            muosát: e,
            naamesjevuemie: e,
            "xn--nmesjevuemie-tcba": e,
            nååmesjevuemie: e,
            "xn--nry-yla5g": e,
            nærøy: e,
            namdalseid: e,
            namsos: e,
            namsskogan: e,
            nannestad: e,
            naroy: e,
            narviika: e,
            narvik: e,
            naustdal: e,
            navuotna: e,
            "xn--nvuotna-hwa": e,
            návuotna: e,
            "nedre-eiker": e,
            nesna: e,
            nesodden: e,
            nesseby: e,
            nesset: e,
            nissedal: e,
            nittedal: e,
            "nord-aurdal": e,
            "nord-fron": e,
            "nord-odal": e,
            norddal: e,
            nordkapp: e,
            nordland: [
              0,
              {
                bo: e,
                "xn--b-5ga": e,
                bø: e,
                heroy: e,
                "xn--hery-ira": e,
                herøy: e,
              },
            ],
            "nordre-land": e,
            nordreisa: e,
            "nore-og-uvdal": e,
            notodden: e,
            notteroy: e,
            "xn--nttery-byae": e,
            nøtterøy: e,
            odda: e,
            oksnes: e,
            "xn--ksnes-uua": e,
            øksnes: e,
            omasvuotna: e,
            oppdal: e,
            oppegard: e,
            "xn--oppegrd-ixa": e,
            oppegård: e,
            orkdal: e,
            orland: e,
            "xn--rland-uua": e,
            ørland: e,
            orskog: e,
            "xn--rskog-uua": e,
            ørskog: e,
            orsta: e,
            "xn--rsta-fra": e,
            ørsta: e,
            osen: e,
            osteroy: e,
            "xn--ostery-fya": e,
            osterøy: e,
            ostfold: [0, { valer: e }],
            "xn--stfold-9xa": [0, { "xn--vler-qoa": e }],
            østfold: [0, { våler: e }],
            "ostre-toten": e,
            "xn--stre-toten-zcb": e,
            "østre-toten": e,
            overhalla: e,
            "ovre-eiker": e,
            "xn--vre-eiker-k8a": e,
            "øvre-eiker": e,
            oyer: e,
            "xn--yer-zna": e,
            øyer: e,
            oygarden: e,
            "xn--ygarden-p1a": e,
            øygarden: e,
            "oystre-slidre": e,
            "xn--ystre-slidre-ujb": e,
            "øystre-slidre": e,
            porsanger: e,
            porsangu: e,
            "xn--porsgu-sta26f": e,
            porsáŋgu: e,
            porsgrunn: e,
            rade: e,
            "xn--rde-ula": e,
            råde: e,
            radoy: e,
            "xn--rady-ira": e,
            radøy: e,
            "xn--rlingen-mxa": e,
            rælingen: e,
            rahkkeravju: e,
            "xn--rhkkervju-01af": e,
            ráhkkerávju: e,
            raisa: e,
            "xn--risa-5na": e,
            ráisa: e,
            rakkestad: e,
            ralingen: e,
            rana: e,
            randaberg: e,
            rauma: e,
            rendalen: e,
            rennebu: e,
            rennesoy: e,
            "xn--rennesy-v1a": e,
            rennesøy: e,
            rindal: e,
            ringebu: e,
            ringerike: e,
            ringsaker: e,
            risor: e,
            "xn--risr-ira": e,
            risør: e,
            rissa: e,
            roan: e,
            rodoy: e,
            "xn--rdy-0nab": e,
            rødøy: e,
            rollag: e,
            romsa: e,
            romskog: e,
            "xn--rmskog-bya": e,
            rømskog: e,
            roros: e,
            "xn--rros-gra": e,
            røros: e,
            rost: e,
            "xn--rst-0na": e,
            røst: e,
            royken: e,
            "xn--ryken-vua": e,
            røyken: e,
            royrvik: e,
            "xn--ryrvik-bya": e,
            røyrvik: e,
            ruovat: e,
            rygge: e,
            salangen: e,
            salat: e,
            "xn--slat-5na": e,
            sálat: e,
            "xn--slt-elab": e,
            sálát: e,
            saltdal: e,
            samnanger: e,
            sandefjord: e,
            sandnes: e,
            sandoy: e,
            "xn--sandy-yua": e,
            sandøy: e,
            sarpsborg: e,
            sauda: e,
            sauherad: e,
            sel: e,
            selbu: e,
            selje: e,
            seljord: e,
            siellak: e,
            sigdal: e,
            siljan: e,
            sirdal: e,
            skanit: e,
            "xn--sknit-yqa": e,
            skánit: e,
            skanland: e,
            "xn--sknland-fxa": e,
            skånland: e,
            skaun: e,
            skedsmo: e,
            ski: e,
            skien: e,
            skierva: e,
            "xn--skierv-uta": e,
            skiervá: e,
            skiptvet: e,
            skjak: e,
            "xn--skjk-soa": e,
            skjåk: e,
            skjervoy: e,
            "xn--skjervy-v1a": e,
            skjervøy: e,
            skodje: e,
            smola: e,
            "xn--smla-hra": e,
            smøla: e,
            snaase: e,
            "xn--snase-nra": e,
            snåase: e,
            snasa: e,
            "xn--snsa-roa": e,
            snåsa: e,
            snillfjord: e,
            snoasa: e,
            sogndal: e,
            sogne: e,
            "xn--sgne-gra": e,
            søgne: e,
            sokndal: e,
            sola: e,
            solund: e,
            somna: e,
            "xn--smna-gra": e,
            sømna: e,
            "sondre-land": e,
            "xn--sndre-land-0cb": e,
            "søndre-land": e,
            songdalen: e,
            "sor-aurdal": e,
            "xn--sr-aurdal-l8a": e,
            "sør-aurdal": e,
            "sor-fron": e,
            "xn--sr-fron-q1a": e,
            "sør-fron": e,
            "sor-odal": e,
            "xn--sr-odal-q1a": e,
            "sør-odal": e,
            "sor-varanger": e,
            "xn--sr-varanger-ggb": e,
            "sør-varanger": e,
            sorfold: e,
            "xn--srfold-bya": e,
            sørfold: e,
            sorreisa: e,
            "xn--srreisa-q1a": e,
            sørreisa: e,
            sortland: e,
            sorum: e,
            "xn--srum-gra": e,
            sørum: e,
            spydeberg: e,
            stange: e,
            stavanger: e,
            steigen: e,
            steinkjer: e,
            stjordal: e,
            "xn--stjrdal-s1a": e,
            stjørdal: e,
            stokke: e,
            "stor-elvdal": e,
            stord: e,
            stordal: e,
            storfjord: e,
            strand: e,
            stranda: e,
            stryn: e,
            sula: e,
            suldal: e,
            sund: e,
            sunndal: e,
            surnadal: e,
            sveio: e,
            svelvik: e,
            sykkylven: e,
            tana: e,
            telemark: [0, { bo: e, "xn--b-5ga": e, bø: e }],
            time: e,
            tingvoll: e,
            tinn: e,
            tjeldsund: e,
            tjome: e,
            "xn--tjme-hra": e,
            tjøme: e,
            tokke: e,
            tolga: e,
            tonsberg: e,
            "xn--tnsberg-q1a": e,
            tønsberg: e,
            torsken: e,
            "xn--trna-woa": e,
            træna: e,
            trana: e,
            tranoy: e,
            "xn--trany-yua": e,
            tranøy: e,
            troandin: e,
            trogstad: e,
            "xn--trgstad-r1a": e,
            trøgstad: e,
            tromsa: e,
            tromso: e,
            "xn--troms-zua": e,
            tromsø: e,
            trondheim: e,
            trysil: e,
            tvedestrand: e,
            tydal: e,
            tynset: e,
            tysfjord: e,
            tysnes: e,
            "xn--tysvr-vra": e,
            tysvær: e,
            tysvar: e,
            ullensaker: e,
            ullensvang: e,
            ulvik: e,
            unjarga: e,
            "xn--unjrga-rta": e,
            unjárga: e,
            utsira: e,
            vaapste: e,
            vadso: e,
            "xn--vads-jra": e,
            vadsø: e,
            "xn--vry-yla5g": e,
            værøy: e,
            vaga: e,
            "xn--vg-yiab": e,
            vågå: e,
            vagan: e,
            "xn--vgan-qoa": e,
            vågan: e,
            vagsoy: e,
            "xn--vgsy-qoa0j": e,
            vågsøy: e,
            vaksdal: e,
            valle: e,
            vang: e,
            vanylven: e,
            vardo: e,
            "xn--vard-jra": e,
            vardø: e,
            varggat: e,
            "xn--vrggt-xqad": e,
            várggát: e,
            varoy: e,
            vefsn: e,
            vega: e,
            vegarshei: e,
            "xn--vegrshei-c0a": e,
            vegårshei: e,
            vennesla: e,
            verdal: e,
            verran: e,
            vestby: e,
            vestfold: [0, { sande: e }],
            vestnes: e,
            "vestre-slidre": e,
            "vestre-toten": e,
            vestvagoy: e,
            "xn--vestvgy-ixa6o": e,
            vestvågøy: e,
            vevelstad: e,
            vik: e,
            vikna: e,
            vindafjord: e,
            voagat: e,
            volda: e,
            voss: e,
            co: t,
            "123hjemmeside": t,
            myspreadshop: t,
          },
        ],
        np: h,
        nr: ve,
        nu: [1, { merseine: t, mine: t, shacknet: t, enterprisecloud: t }],
        nz: [
          1,
          {
            ac: e,
            co: e,
            cri: e,
            geek: e,
            gen: e,
            govt: e,
            health: e,
            iwi: e,
            kiwi: e,
            maori: e,
            "xn--mori-qsa": e,
            māori: e,
            mil: e,
            net: e,
            org: e,
            parliament: e,
            school: e,
            cloudns: t,
          },
        ],
        om: [
          1,
          {
            co: e,
            com: e,
            edu: e,
            gov: e,
            med: e,
            museum: e,
            net: e,
            org: e,
            pro: e,
          },
        ],
        onion: e,
        org: [
          1,
          {
            altervista: t,
            pimienta: t,
            poivron: t,
            potager: t,
            sweetpepper: t,
            cdn77: [0, { c: t, rsc: t }],
            "cdn77-secure": [0, { origin: [0, { ssl: t }] }],
            ae: t,
            cloudns: t,
            "ip-dynamic": t,
            ddnss: t,
            dpdns: t,
            duckdns: t,
            tunk: t,
            blogdns: t,
            blogsite: t,
            boldlygoingnowhere: t,
            dnsalias: t,
            dnsdojo: t,
            doesntexist: t,
            dontexist: t,
            doomdns: t,
            dvrdns: t,
            dynalias: t,
            dyndns: [2, { go: t, home: t }],
            endofinternet: t,
            endoftheinternet: t,
            "from-me": t,
            "game-host": t,
            gotdns: t,
            "hobby-site": t,
            homedns: t,
            homeftp: t,
            homelinux: t,
            homeunix: t,
            "is-a-bruinsfan": t,
            "is-a-candidate": t,
            "is-a-celticsfan": t,
            "is-a-chef": t,
            "is-a-geek": t,
            "is-a-knight": t,
            "is-a-linux-user": t,
            "is-a-patsfan": t,
            "is-a-soxfan": t,
            "is-found": t,
            "is-lost": t,
            "is-saved": t,
            "is-very-bad": t,
            "is-very-evil": t,
            "is-very-good": t,
            "is-very-nice": t,
            "is-very-sweet": t,
            "isa-geek": t,
            "kicks-ass": t,
            misconfused: t,
            podzone: t,
            readmyblog: t,
            selfip: t,
            sellsyourhome: t,
            servebbs: t,
            serveftp: t,
            servegame: t,
            "stuff-4-sale": t,
            webhop: t,
            accesscam: t,
            camdvr: t,
            freeddns: t,
            mywire: t,
            webredirect: t,
            twmail: t,
            eu: [
              2,
              {
                al: t,
                asso: t,
                at: t,
                au: t,
                be: t,
                bg: t,
                ca: t,
                cd: t,
                ch: t,
                cn: t,
                cy: t,
                cz: t,
                de: t,
                dk: t,
                edu: t,
                ee: t,
                es: t,
                fi: t,
                fr: t,
                gr: t,
                hr: t,
                hu: t,
                ie: t,
                il: t,
                in: t,
                int: t,
                is: t,
                it: t,
                jp: t,
                kr: t,
                lt: t,
                lu: t,
                lv: t,
                me: t,
                mk: t,
                mt: t,
                my: t,
                net: t,
                ng: t,
                nl: t,
                no: t,
                nz: t,
                pl: t,
                pt: t,
                ro: t,
                ru: t,
                se: t,
                si: t,
                sk: t,
                tr: t,
                uk: t,
                us: t,
              },
            ],
            fedorainfracloud: t,
            fedorapeople: t,
            fedoraproject: [0, { cloud: t, os: j, stg: [0, { os: j }] }],
            freedesktop: t,
            hatenadiary: t,
            hepforge: t,
            "in-dsl": t,
            "in-vpn": t,
            js: t,
            barsy: t,
            mayfirst: t,
            routingthecloud: t,
            bmoattachments: t,
            "cable-modem": t,
            collegefan: t,
            couchpotatofries: t,
            hopto: t,
            mlbfan: t,
            myftp: t,
            mysecuritycamera: t,
            nflfan: t,
            "no-ip": t,
            "read-books": t,
            ufcfan: t,
            zapto: t,
            dynserv: t,
            "now-dns": t,
            "is-local": t,
            httpbin: t,
            pubtls: t,
            jpn: t,
            "my-firewall": t,
            myfirewall: t,
            spdns: t,
            "small-web": t,
            dsmynas: t,
            familyds: t,
            teckids: _e,
            tuxfamily: t,
            diskstation: t,
            hk: t,
            us: t,
            toolforge: t,
            wmcloud: t,
            wmflabs: t,
            za: t,
          },
        ],
        pa: [
          1,
          {
            abo: e,
            ac: e,
            com: e,
            edu: e,
            gob: e,
            ing: e,
            med: e,
            net: e,
            nom: e,
            org: e,
            sld: e,
          },
        ],
        pe: [1, { com: e, edu: e, gob: e, mil: e, net: e, nom: e, org: e }],
        pf: [1, { com: e, edu: e, org: e }],
        pg: h,
        ph: [
          1,
          {
            com: e,
            edu: e,
            gov: e,
            i: e,
            mil: e,
            net: e,
            ngo: e,
            org: e,
            cloudns: t,
          },
        ],
        pk: [
          1,
          {
            ac: e,
            biz: e,
            com: e,
            edu: e,
            fam: e,
            gkp: e,
            gob: e,
            gog: e,
            gok: e,
            gop: e,
            gos: e,
            gov: e,
            net: e,
            org: e,
            web: e,
          },
        ],
        pl: [
          1,
          {
            com: e,
            net: e,
            org: e,
            agro: e,
            aid: e,
            atm: e,
            auto: e,
            biz: e,
            edu: e,
            gmina: e,
            gsm: e,
            info: e,
            mail: e,
            media: e,
            miasta: e,
            mil: e,
            nieruchomosci: e,
            nom: e,
            pc: e,
            powiat: e,
            priv: e,
            realestate: e,
            rel: e,
            sex: e,
            shop: e,
            sklep: e,
            sos: e,
            szkola: e,
            targi: e,
            tm: e,
            tourism: e,
            travel: e,
            turystyka: e,
            gov: [
              1,
              {
                ap: e,
                griw: e,
                ic: e,
                is: e,
                kmpsp: e,
                konsulat: e,
                kppsp: e,
                kwp: e,
                kwpsp: e,
                mup: e,
                mw: e,
                oia: e,
                oirm: e,
                oke: e,
                oow: e,
                oschr: e,
                oum: e,
                pa: e,
                pinb: e,
                piw: e,
                po: e,
                pr: e,
                psp: e,
                psse: e,
                pup: e,
                rzgw: e,
                sa: e,
                sdn: e,
                sko: e,
                so: e,
                sr: e,
                starostwo: e,
                ug: e,
                ugim: e,
                um: e,
                umig: e,
                upow: e,
                uppo: e,
                us: e,
                uw: e,
                uzs: e,
                wif: e,
                wiih: e,
                winb: e,
                wios: e,
                witd: e,
                wiw: e,
                wkz: e,
                wsa: e,
                wskr: e,
                wsse: e,
                wuoz: e,
                wzmiuw: e,
                zp: e,
                zpisdn: e,
              },
            ],
            augustow: e,
            "babia-gora": e,
            bedzin: e,
            beskidy: e,
            bialowieza: e,
            bialystok: e,
            bielawa: e,
            bieszczady: e,
            boleslawiec: e,
            bydgoszcz: e,
            bytom: e,
            cieszyn: e,
            czeladz: e,
            czest: e,
            dlugoleka: e,
            elblag: e,
            elk: e,
            glogow: e,
            gniezno: e,
            gorlice: e,
            grajewo: e,
            ilawa: e,
            jaworzno: e,
            "jelenia-gora": e,
            jgora: e,
            kalisz: e,
            karpacz: e,
            kartuzy: e,
            kaszuby: e,
            katowice: e,
            "kazimierz-dolny": e,
            kepno: e,
            ketrzyn: e,
            klodzko: e,
            kobierzyce: e,
            kolobrzeg: e,
            konin: e,
            konskowola: e,
            kutno: e,
            lapy: e,
            lebork: e,
            legnica: e,
            lezajsk: e,
            limanowa: e,
            lomza: e,
            lowicz: e,
            lubin: e,
            lukow: e,
            malbork: e,
            malopolska: e,
            mazowsze: e,
            mazury: e,
            mielec: e,
            mielno: e,
            mragowo: e,
            naklo: e,
            nowaruda: e,
            nysa: e,
            olawa: e,
            olecko: e,
            olkusz: e,
            olsztyn: e,
            opoczno: e,
            opole: e,
            ostroda: e,
            ostroleka: e,
            ostrowiec: e,
            ostrowwlkp: e,
            pila: e,
            pisz: e,
            podhale: e,
            podlasie: e,
            polkowice: e,
            pomorskie: e,
            pomorze: e,
            prochowice: e,
            pruszkow: e,
            przeworsk: e,
            pulawy: e,
            radom: e,
            "rawa-maz": e,
            rybnik: e,
            rzeszow: e,
            sanok: e,
            sejny: e,
            skoczow: e,
            slask: e,
            slupsk: e,
            sosnowiec: e,
            "stalowa-wola": e,
            starachowice: e,
            stargard: e,
            suwalki: e,
            swidnica: e,
            swiebodzin: e,
            swinoujscie: e,
            szczecin: e,
            szczytno: e,
            tarnobrzeg: e,
            tgory: e,
            turek: e,
            tychy: e,
            ustka: e,
            walbrzych: e,
            warmia: e,
            warszawa: e,
            waw: e,
            wegrow: e,
            wielun: e,
            wlocl: e,
            wloclawek: e,
            wodzislaw: e,
            wolomin: e,
            wroclaw: e,
            zachpomor: e,
            zagan: e,
            zarow: e,
            zgora: e,
            zgorzelec: e,
            art: t,
            gliwice: t,
            krakow: t,
            poznan: t,
            wroc: t,
            zakopane: t,
            beep: t,
            "ecommerce-shop": t,
            cfolks: t,
            dfirma: t,
            dkonto: t,
            you2: t,
            shoparena: t,
            homesklep: t,
            sdscloud: t,
            unicloud: t,
            lodz: t,
            pabianice: t,
            plock: t,
            sieradz: t,
            skierniewice: t,
            zgierz: t,
            krasnik: t,
            leczna: t,
            lubartow: t,
            lublin: t,
            poniatowa: t,
            swidnik: t,
            co: t,
            torun: t,
            simplesite: t,
            myspreadshop: t,
            gda: t,
            gdansk: t,
            gdynia: t,
            med: t,
            sopot: t,
            bielsko: t,
          },
        ],
        pm: [1, { own: t, name: t }],
        pn: [1, { co: e, edu: e, gov: e, net: e, org: e }],
        post: e,
        pr: [
          1,
          {
            biz: e,
            com: e,
            edu: e,
            gov: e,
            info: e,
            isla: e,
            name: e,
            net: e,
            org: e,
            pro: e,
            ac: e,
            est: e,
            prof: e,
          },
        ],
        pro: [
          1,
          {
            aaa: e,
            aca: e,
            acct: e,
            avocat: e,
            bar: e,
            cpa: e,
            eng: e,
            jur: e,
            law: e,
            med: e,
            recht: e,
            "12chars": t,
            cloudns: t,
            barsy: t,
            ngrok: t,
          },
        ],
        ps: [1, { com: e, edu: e, gov: e, net: e, org: e, plo: e, sec: e }],
        pt: [
          1,
          {
            com: e,
            edu: e,
            gov: e,
            int: e,
            net: e,
            nome: e,
            org: e,
            publ: e,
            "123paginaweb": t,
          },
        ],
        pw: [1, { gov: e, cloudns: t, x443: t }],
        py: [1, { com: e, coop: e, edu: e, gov: e, mil: e, net: e, org: e }],
        qa: [
          1,
          { com: e, edu: e, gov: e, mil: e, name: e, net: e, org: e, sch: e },
        ],
        re: [1, { asso: e, com: e, netlib: t, can: t }],
        ro: [
          1,
          {
            arts: e,
            com: e,
            firm: e,
            info: e,
            nom: e,
            nt: e,
            org: e,
            rec: e,
            store: e,
            tm: e,
            www: e,
            co: t,
            shop: t,
            barsy: t,
          },
        ],
        rs: [
          1,
          {
            ac: e,
            co: e,
            edu: e,
            gov: e,
            in: e,
            org: e,
            brendly: me,
            barsy: t,
            ox: t,
          },
        ],
        ru: [
          1,
          {
            ac: t,
            edu: t,
            gov: t,
            int: t,
            mil: t,
            eurodir: t,
            adygeya: t,
            bashkiria: t,
            bir: t,
            cbg: t,
            com: t,
            dagestan: t,
            grozny: t,
            kalmykia: t,
            kustanai: t,
            marine: t,
            mordovia: t,
            msk: t,
            mytis: t,
            nalchik: t,
            nov: t,
            pyatigorsk: t,
            spb: t,
            vladikavkaz: t,
            vladimir: t,
            na4u: t,
            mircloud: t,
            myjino: [2, { hosting: i, landing: i, spectrum: i, vps: i }],
            cldmail: [0, { hb: t }],
            mcdir: [2, { vps: t }],
            mcpre: t,
            net: t,
            org: t,
            pp: t,
            lk3: t,
            ras: t,
          },
        ],
        rw: [1, { ac: e, co: e, coop: e, gov: e, mil: e, net: e, org: e }],
        sa: [
          1,
          { com: e, edu: e, gov: e, med: e, net: e, org: e, pub: e, sch: e },
        ],
        sb: n,
        sc: n,
        sd: [
          1,
          { com: e, edu: e, gov: e, info: e, med: e, net: e, org: e, tv: e },
        ],
        se: [
          1,
          {
            a: e,
            ac: e,
            b: e,
            bd: e,
            brand: e,
            c: e,
            d: e,
            e,
            f: e,
            fh: e,
            fhsk: e,
            fhv: e,
            g: e,
            h: e,
            i: e,
            k: e,
            komforb: e,
            kommunalforbund: e,
            komvux: e,
            l: e,
            lanbib: e,
            m: e,
            n: e,
            naturbruksgymn: e,
            o: e,
            org: e,
            p: e,
            parti: e,
            pp: e,
            press: e,
            r: e,
            s: e,
            t: e,
            tm: e,
            u: e,
            w: e,
            x: e,
            y: e,
            z: e,
            com: t,
            iopsys: t,
            "123minsida": t,
            itcouldbewor: t,
            myspreadshop: t,
          },
        ],
        sg: [1, { com: e, edu: e, gov: e, net: e, org: e, enscaled: t }],
        sh: [
          1,
          {
            com: e,
            gov: e,
            mil: e,
            net: e,
            org: e,
            hashbang: t,
            botda: t,
            platform: [0, { ent: t, eu: t, us: t }],
            now: t,
          },
        ],
        si: [1, { f5: t, gitapp: t, gitpage: t }],
        sj: e,
        sk: e,
        sl: n,
        sm: e,
        sn: [1, { art: e, com: e, edu: e, gouv: e, org: e, perso: e, univ: e }],
        so: [1, { com: e, edu: e, gov: e, me: e, net: e, org: e, surveys: t }],
        sr: e,
        ss: [
          1,
          {
            biz: e,
            co: e,
            com: e,
            edu: e,
            gov: e,
            me: e,
            net: e,
            org: e,
            sch: e,
          },
        ],
        st: [
          1,
          {
            co: e,
            com: e,
            consulado: e,
            edu: e,
            embaixada: e,
            mil: e,
            net: e,
            org: e,
            principe: e,
            saotome: e,
            store: e,
            helioho: t,
            kirara: t,
            noho: t,
          },
        ],
        su: [
          1,
          {
            abkhazia: t,
            adygeya: t,
            aktyubinsk: t,
            arkhangelsk: t,
            armenia: t,
            ashgabad: t,
            azerbaijan: t,
            balashov: t,
            bashkiria: t,
            bryansk: t,
            bukhara: t,
            chimkent: t,
            dagestan: t,
            "east-kazakhstan": t,
            exnet: t,
            georgia: t,
            grozny: t,
            ivanovo: t,
            jambyl: t,
            kalmykia: t,
            kaluga: t,
            karacol: t,
            karaganda: t,
            karelia: t,
            khakassia: t,
            krasnodar: t,
            kurgan: t,
            kustanai: t,
            lenug: t,
            mangyshlak: t,
            mordovia: t,
            msk: t,
            murmansk: t,
            nalchik: t,
            navoi: t,
            "north-kazakhstan": t,
            nov: t,
            obninsk: t,
            penza: t,
            pokrovsk: t,
            sochi: t,
            spb: t,
            tashkent: t,
            termez: t,
            togliatti: t,
            troitsk: t,
            tselinograd: t,
            tula: t,
            tuva: t,
            vladikavkaz: t,
            vladimir: t,
            vologda: t,
          },
        ],
        sv: [1, { com: e, edu: e, gob: e, org: e, red: e }],
        sx: c,
        sy: r,
        sz: [1, { ac: e, co: e, org: e }],
        tc: e,
        td: e,
        tel: e,
        tf: [1, { sch: t }],
        tg: e,
        th: [
          1,
          {
            ac: e,
            co: e,
            go: e,
            in: e,
            mi: e,
            net: e,
            or: e,
            online: t,
            shop: t,
          },
        ],
        tj: [
          1,
          {
            ac: e,
            biz: e,
            co: e,
            com: e,
            edu: e,
            go: e,
            gov: e,
            int: e,
            mil: e,
            name: e,
            net: e,
            nic: e,
            org: e,
            test: e,
            web: e,
          },
        ],
        tk: e,
        tl: c,
        tm: [
          1,
          { co: e, com: e, edu: e, gov: e, mil: e, net: e, nom: e, org: e },
        ],
        tn: [
          1,
          {
            com: e,
            ens: e,
            fin: e,
            gov: e,
            ind: e,
            info: e,
            intl: e,
            mincom: e,
            nat: e,
            net: e,
            org: e,
            perso: e,
            tourism: e,
            orangecloud: t,
          },
        ],
        to: [
          1,
          {
            611: t,
            com: e,
            edu: e,
            gov: e,
            mil: e,
            net: e,
            org: e,
            oya: t,
            x0: t,
            quickconnect: S,
            vpnplus: t,
          },
        ],
        tr: [
          1,
          {
            av: e,
            bbs: e,
            bel: e,
            biz: e,
            com: e,
            dr: e,
            edu: e,
            gen: e,
            gov: e,
            info: e,
            k12: e,
            kep: e,
            mil: e,
            name: e,
            net: e,
            org: e,
            pol: e,
            tel: e,
            tsk: e,
            tv: e,
            web: e,
            nc: c,
          },
        ],
        tt: [
          1,
          {
            biz: e,
            co: e,
            com: e,
            edu: e,
            gov: e,
            info: e,
            mil: e,
            name: e,
            net: e,
            org: e,
            pro: e,
          },
        ],
        tv: [
          1,
          {
            "better-than": t,
            dyndns: t,
            "on-the-web": t,
            "worse-than": t,
            from: t,
            sakura: t,
          },
        ],
        tw: [
          1,
          {
            club: e,
            com: [1, { mymailer: t }],
            ebiz: e,
            edu: e,
            game: e,
            gov: e,
            idv: e,
            mil: e,
            net: e,
            org: e,
            url: t,
            mydns: t,
          },
        ],
        tz: [
          1,
          {
            ac: e,
            co: e,
            go: e,
            hotel: e,
            info: e,
            me: e,
            mil: e,
            mobi: e,
            ne: e,
            or: e,
            sc: e,
            tv: e,
          },
        ],
        ua: [
          1,
          {
            com: e,
            edu: e,
            gov: e,
            in: e,
            net: e,
            org: e,
            cherkassy: e,
            cherkasy: e,
            chernigov: e,
            chernihiv: e,
            chernivtsi: e,
            chernovtsy: e,
            ck: e,
            cn: e,
            cr: e,
            crimea: e,
            cv: e,
            dn: e,
            dnepropetrovsk: e,
            dnipropetrovsk: e,
            donetsk: e,
            dp: e,
            if: e,
            "ivano-frankivsk": e,
            kh: e,
            kharkiv: e,
            kharkov: e,
            kherson: e,
            khmelnitskiy: e,
            khmelnytskyi: e,
            kiev: e,
            kirovograd: e,
            km: e,
            kr: e,
            kropyvnytskyi: e,
            krym: e,
            ks: e,
            kv: e,
            kyiv: e,
            lg: e,
            lt: e,
            lugansk: e,
            luhansk: e,
            lutsk: e,
            lv: e,
            lviv: e,
            mk: e,
            mykolaiv: e,
            nikolaev: e,
            od: e,
            odesa: e,
            odessa: e,
            pl: e,
            poltava: e,
            rivne: e,
            rovno: e,
            rv: e,
            sb: e,
            sebastopol: e,
            sevastopol: e,
            sm: e,
            sumy: e,
            te: e,
            ternopil: e,
            uz: e,
            uzhgorod: e,
            uzhhorod: e,
            vinnica: e,
            vinnytsia: e,
            vn: e,
            volyn: e,
            yalta: e,
            zakarpattia: e,
            zaporizhzhe: e,
            zaporizhzhia: e,
            zhitomir: e,
            zhytomyr: e,
            zp: e,
            zt: e,
            cc: t,
            inf: t,
            ltd: t,
            cx: t,
            ie: t,
            biz: t,
            co: t,
            pp: t,
            v: t,
          },
        ],
        ug: [
          1,
          {
            ac: e,
            co: e,
            com: e,
            edu: e,
            go: e,
            gov: e,
            mil: e,
            ne: e,
            or: e,
            org: e,
            sc: e,
            us: e,
          },
        ],
        uk: [
          1,
          {
            ac: e,
            co: [
              1,
              {
                bytemark: [0, { dh: t, vm: t }],
                layershift: le,
                barsy: t,
                barsyonline: t,
                retrosnub: ge,
                "nh-serv": t,
                "no-ip": t,
                adimo: t,
                myspreadshop: t,
              },
            ],
            gov: [1, { api: t, campaign: t, service: t }],
            ltd: e,
            me: e,
            net: e,
            nhs: e,
            org: [
              1,
              {
                glug: t,
                lug: t,
                lugs: t,
                affinitylottery: t,
                raffleentry: t,
                weeklylottery: t,
              },
            ],
            plc: e,
            police: e,
            sch: h,
            conn: t,
            copro: t,
            hosp: t,
            "independent-commission": t,
            "independent-inquest": t,
            "independent-inquiry": t,
            "independent-panel": t,
            "independent-review": t,
            "public-inquiry": t,
            "royal-commission": t,
            pymnt: t,
            barsy: t,
            nimsite: t,
            oraclegovcloudapps: i,
          },
        ],
        us: [
          1,
          {
            dni: e,
            isa: e,
            nsn: e,
            ak: I,
            al: I,
            ar: I,
            as: I,
            az: I,
            ca: I,
            co: I,
            ct: I,
            dc: I,
            de: [1, { cc: e, lib: t }],
            fl: I,
            ga: I,
            gu: I,
            hi: Se,
            ia: I,
            id: I,
            il: I,
            in: I,
            ks: I,
            ky: I,
            la: I,
            ma: [
              1,
              { k12: [1, { chtr: e, paroch: e, pvt: e }], cc: e, lib: e },
            ],
            md: I,
            me: I,
            mi: [
              1,
              {
                k12: e,
                cc: e,
                lib: e,
                "ann-arbor": e,
                cog: e,
                dst: e,
                eaton: e,
                gen: e,
                mus: e,
                tec: e,
                washtenaw: e,
              },
            ],
            mn: I,
            mo: I,
            ms: I,
            mt: I,
            nc: I,
            nd: Se,
            ne: I,
            nh: I,
            nj: I,
            nm: I,
            nv: I,
            ny: I,
            oh: I,
            ok: I,
            or: I,
            pa: I,
            pr: I,
            ri: Se,
            sc: I,
            sd: Se,
            tn: I,
            tx: I,
            ut: I,
            va: I,
            vi: I,
            vt: I,
            wa: I,
            wi: I,
            wv: [1, { cc: e }],
            wy: I,
            cloudns: t,
            "is-by": t,
            "land-4-sale": t,
            "stuff-4-sale": t,
            heliohost: t,
            enscaled: [0, { phx: t }],
            mircloud: t,
            ngo: t,
            golffan: t,
            noip: t,
            pointto: t,
            freeddns: t,
            srv: [2, { gh: t, gl: t }],
            platterp: t,
            servername: t,
          },
        ],
        uy: [1, { com: e, edu: e, gub: e, mil: e, net: e, org: e }],
        uz: [1, { co: e, com: e, net: e, org: e }],
        va: e,
        vc: [
          1,
          {
            com: e,
            edu: e,
            gov: e,
            mil: e,
            net: e,
            org: e,
            gv: [2, { d: t }],
            "0e": i,
            mydns: t,
          },
        ],
        ve: [
          1,
          {
            arts: e,
            bib: e,
            co: e,
            com: e,
            e12: e,
            edu: e,
            emprende: e,
            firm: e,
            gob: e,
            gov: e,
            info: e,
            int: e,
            mil: e,
            net: e,
            nom: e,
            org: e,
            rar: e,
            rec: e,
            store: e,
            tec: e,
            web: e,
          },
        ],
        vg: [1, { edu: e }],
        vi: [1, { co: e, com: e, k12: e, net: e, org: e }],
        vn: [
          1,
          {
            ac: e,
            ai: e,
            biz: e,
            com: e,
            edu: e,
            gov: e,
            health: e,
            id: e,
            info: e,
            int: e,
            io: e,
            name: e,
            net: e,
            org: e,
            pro: e,
            angiang: e,
            bacgiang: e,
            backan: e,
            baclieu: e,
            bacninh: e,
            "baria-vungtau": e,
            bentre: e,
            binhdinh: e,
            binhduong: e,
            binhphuoc: e,
            binhthuan: e,
            camau: e,
            cantho: e,
            caobang: e,
            daklak: e,
            daknong: e,
            danang: e,
            dienbien: e,
            dongnai: e,
            dongthap: e,
            gialai: e,
            hagiang: e,
            haiduong: e,
            haiphong: e,
            hanam: e,
            hanoi: e,
            hatinh: e,
            haugiang: e,
            hoabinh: e,
            hungyen: e,
            khanhhoa: e,
            kiengiang: e,
            kontum: e,
            laichau: e,
            lamdong: e,
            langson: e,
            laocai: e,
            longan: e,
            namdinh: e,
            nghean: e,
            ninhbinh: e,
            ninhthuan: e,
            phutho: e,
            phuyen: e,
            quangbinh: e,
            quangnam: e,
            quangngai: e,
            quangninh: e,
            quangtri: e,
            soctrang: e,
            sonla: e,
            tayninh: e,
            thaibinh: e,
            thainguyen: e,
            thanhhoa: e,
            thanhphohochiminh: e,
            thuathienhue: e,
            tiengiang: e,
            travinh: e,
            tuyenquang: e,
            vinhlong: e,
            vinhphuc: e,
            yenbai: e,
          },
        ],
        vu: M,
        wf: [1, { biz: t, sch: t }],
        ws: [
          1,
          {
            com: e,
            edu: e,
            gov: e,
            net: e,
            org: e,
            advisor: i,
            cloud66: t,
            dyndns: t,
            mypets: t,
          },
        ],
        yt: [1, { org: t }],
        "xn--mgbaam7a8h": e,
        امارات: e,
        "xn--y9a3aq": e,
        հայ: e,
        "xn--54b7fta0cc": e,
        বাংলা: e,
        "xn--90ae": e,
        бг: e,
        "xn--mgbcpq6gpa1a": e,
        البحرين: e,
        "xn--90ais": e,
        бел: e,
        "xn--fiqs8s": e,
        中国: e,
        "xn--fiqz9s": e,
        中國: e,
        "xn--lgbbat1ad8j": e,
        الجزائر: e,
        "xn--wgbh1c": e,
        مصر: e,
        "xn--e1a4c": e,
        ею: e,
        "xn--qxa6a": e,
        ευ: e,
        "xn--mgbah1a3hjkrd": e,
        موريتانيا: e,
        "xn--node": e,
        გე: e,
        "xn--qxam": e,
        ελ: e,
        "xn--j6w193g": [
          1,
          {
            "xn--gmqw5a": e,
            "xn--55qx5d": e,
            "xn--mxtq1m": e,
            "xn--wcvs22d": e,
            "xn--uc0atv": e,
            "xn--od0alg": e,
          },
        ],
        香港: [1, { 個人: e, 公司: e, 政府: e, 教育: e, 組織: e, 網絡: e }],
        "xn--2scrj9c": e,
        ಭಾರತ: e,
        "xn--3hcrj9c": e,
        ଭାରତ: e,
        "xn--45br5cyl": e,
        ভাৰত: e,
        "xn--h2breg3eve": e,
        भारतम्: e,
        "xn--h2brj9c8c": e,
        भारोत: e,
        "xn--mgbgu82a": e,
        ڀارت: e,
        "xn--rvc1e0am3e": e,
        ഭാരതം: e,
        "xn--h2brj9c": e,
        भारत: e,
        "xn--mgbbh1a": e,
        بارت: e,
        "xn--mgbbh1a71e": e,
        بھارت: e,
        "xn--fpcrj9c3d": e,
        భారత్: e,
        "xn--gecrj9c": e,
        ભારત: e,
        "xn--s9brj9c": e,
        ਭਾਰਤ: e,
        "xn--45brj9c": e,
        ভারত: e,
        "xn--xkc2dl3a5ee0h": e,
        இந்தியா: e,
        "xn--mgba3a4f16a": e,
        ایران: e,
        "xn--mgba3a4fra": e,
        ايران: e,
        "xn--mgbtx2b": e,
        عراق: e,
        "xn--mgbayh7gpa": e,
        الاردن: e,
        "xn--3e0b707e": e,
        한국: e,
        "xn--80ao21a": e,
        қаз: e,
        "xn--q7ce6a": e,
        ລາວ: e,
        "xn--fzc2c9e2c": e,
        ලංකා: e,
        "xn--xkc2al3hye2a": e,
        இலங்கை: e,
        "xn--mgbc0a9azcg": e,
        المغرب: e,
        "xn--d1alf": e,
        мкд: e,
        "xn--l1acc": e,
        мон: e,
        "xn--mix891f": e,
        澳門: e,
        "xn--mix082f": e,
        澳门: e,
        "xn--mgbx4cd0ab": e,
        مليسيا: e,
        "xn--mgb9awbf": e,
        عمان: e,
        "xn--mgbai9azgqp6j": e,
        پاکستان: e,
        "xn--mgbai9a5eva00b": e,
        پاكستان: e,
        "xn--ygbi2ammx": e,
        فلسطين: e,
        "xn--90a3ac": [
          1,
          {
            "xn--80au": e,
            "xn--90azh": e,
            "xn--d1at": e,
            "xn--c1avg": e,
            "xn--o1ac": e,
            "xn--o1ach": e,
          },
        ],
        срб: [1, { ак: e, обр: e, од: e, орг: e, пр: e, упр: e }],
        "xn--p1ai": e,
        рф: e,
        "xn--wgbl6a": e,
        قطر: e,
        "xn--mgberp4a5d4ar": e,
        السعودية: e,
        "xn--mgberp4a5d4a87g": e,
        السعودیة: e,
        "xn--mgbqly7c0a67fbc": e,
        السعودیۃ: e,
        "xn--mgbqly7cvafr": e,
        السعوديه: e,
        "xn--mgbpl2fh": e,
        سودان: e,
        "xn--yfro4i67o": e,
        新加坡: e,
        "xn--clchc0ea0b2g2a9gcd": e,
        சிங்கப்பூர்: e,
        "xn--ogbpf8fl": e,
        سورية: e,
        "xn--mgbtf8fl": e,
        سوريا: e,
        "xn--o3cw4h": [
          1,
          {
            "xn--o3cyx2a": e,
            "xn--12co0c3b4eva": e,
            "xn--m3ch0j3a": e,
            "xn--h3cuzk1di": e,
            "xn--12c1fe0br": e,
            "xn--12cfi8ixb8l": e,
          },
        ],
        ไทย: [
          1,
          { ทหาร: e, ธุรกิจ: e, เน็ต: e, รัฐบาล: e, ศึกษา: e, องค์กร: e },
        ],
        "xn--pgbs0dh": e,
        تونس: e,
        "xn--kpry57d": e,
        台灣: e,
        "xn--kprw13d": e,
        台湾: e,
        "xn--nnx388a": e,
        臺灣: e,
        "xn--j1amh": e,
        укр: e,
        "xn--mgb2ddes": e,
        اليمن: e,
        xxx: e,
        ye: r,
        za: [
          0,
          {
            ac: e,
            agric: e,
            alt: e,
            co: e,
            edu: e,
            gov: e,
            grondar: e,
            law: e,
            mil: e,
            net: e,
            ngo: e,
            nic: e,
            nis: e,
            nom: e,
            org: e,
            school: e,
            tm: e,
            web: e,
          },
        ],
        zm: [
          1,
          {
            ac: e,
            biz: e,
            co: e,
            com: e,
            edu: e,
            gov: e,
            info: e,
            mil: e,
            net: e,
            org: e,
            sch: e,
          },
        ],
        zw: [1, { ac: e, co: e, gov: e, mil: e, org: e }],
        aaa: e,
        aarp: e,
        abb: e,
        abbott: e,
        abbvie: e,
        abc: e,
        able: e,
        abogado: e,
        abudhabi: e,
        academy: [1, { official: t }],
        accenture: e,
        accountant: e,
        accountants: e,
        aco: e,
        actor: e,
        ads: e,
        adult: e,
        aeg: e,
        aetna: e,
        afl: e,
        africa: e,
        agakhan: e,
        agency: e,
        aig: e,
        airbus: e,
        airforce: e,
        airtel: e,
        akdn: e,
        alibaba: e,
        alipay: e,
        allfinanz: e,
        allstate: e,
        ally: e,
        alsace: e,
        alstom: e,
        amazon: e,
        americanexpress: e,
        americanfamily: e,
        amex: e,
        amfam: e,
        amica: e,
        amsterdam: e,
        analytics: e,
        android: e,
        anquan: e,
        anz: e,
        aol: e,
        apartments: e,
        app: [
          1,
          {
            adaptable: t,
            aiven: t,
            beget: i,
            brave: a,
            clerk: t,
            clerkstage: t,
            wnext: t,
            csb: [2, { preview: t }],
            convex: t,
            deta: t,
            ondigitalocean: t,
            easypanel: t,
            encr: t,
            evervault: o,
            expo: [2, { staging: t }],
            edgecompute: t,
            "on-fleek": t,
            flutterflow: t,
            e2b: t,
            framer: t,
            hosted: i,
            run: i,
            web: t,
            hasura: t,
            botdash: t,
            loginline: t,
            lovable: t,
            medusajs: t,
            messerli: t,
            netfy: t,
            netlify: t,
            ngrok: t,
            "ngrok-free": t,
            developer: i,
            noop: t,
            northflank: i,
            upsun: i,
            replit: s,
            nyat: t,
            snowflake: [0, { "*": t, privatelink: i }],
            streamlit: t,
            storipress: t,
            telebit: t,
            typedream: t,
            vercel: t,
            bookonline: t,
            wdh: t,
            windsurf: t,
            zeabur: t,
            zerops: i,
          },
        ],
        apple: e,
        aquarelle: e,
        arab: e,
        aramco: e,
        archi: e,
        army: e,
        art: e,
        arte: e,
        asda: e,
        associates: e,
        athleta: e,
        attorney: e,
        auction: e,
        audi: e,
        audible: e,
        audio: e,
        auspost: e,
        author: e,
        auto: e,
        autos: e,
        aws: [
          1,
          {
            sagemaker: [
              0,
              {
                "ap-northeast-1": d,
                "ap-northeast-2": d,
                "ap-south-1": d,
                "ap-southeast-1": d,
                "ap-southeast-2": d,
                "ca-central-1": p,
                "eu-central-1": d,
                "eu-west-1": d,
                "eu-west-2": d,
                "us-east-1": p,
                "us-east-2": p,
                "us-west-2": p,
                "af-south-1": u,
                "ap-east-1": u,
                "ap-northeast-3": u,
                "ap-south-2": f,
                "ap-southeast-3": u,
                "ap-southeast-4": f,
                "ca-west-1": [0, { notebook: t, "notebook-fips": t }],
                "eu-central-2": u,
                "eu-north-1": u,
                "eu-south-1": u,
                "eu-south-2": u,
                "eu-west-3": u,
                "il-central-1": u,
                "me-central-1": u,
                "me-south-1": u,
                "sa-east-1": u,
                "us-gov-east-1": m,
                "us-gov-west-1": m,
                "us-west-1": [
                  0,
                  { notebook: t, "notebook-fips": t, studio: t },
                ],
                experiments: i,
              },
            ],
            repost: [0, { private: i }],
            on: [
              0,
              {
                "ap-northeast-1": l,
                "ap-southeast-1": l,
                "ap-southeast-2": l,
                "eu-central-1": l,
                "eu-north-1": l,
                "eu-west-1": l,
                "us-east-1": l,
                "us-east-2": l,
                "us-west-2": l,
              },
            ],
          },
        ],
        axa: e,
        azure: e,
        baby: e,
        baidu: e,
        banamex: e,
        band: e,
        bank: e,
        bar: e,
        barcelona: e,
        barclaycard: e,
        barclays: e,
        barefoot: e,
        bargains: e,
        baseball: e,
        basketball: [1, { aus: t, nz: t }],
        bauhaus: e,
        bayern: e,
        bbc: e,
        bbt: e,
        bbva: e,
        bcg: e,
        bcn: e,
        beats: e,
        beauty: e,
        beer: e,
        bentley: e,
        berlin: e,
        best: e,
        bestbuy: e,
        bet: e,
        bharti: e,
        bible: e,
        bid: e,
        bike: e,
        bing: e,
        bingo: e,
        bio: e,
        black: e,
        blackfriday: e,
        blockbuster: e,
        blog: e,
        bloomberg: e,
        blue: e,
        bms: e,
        bmw: e,
        bnpparibas: e,
        boats: e,
        boehringer: e,
        bofa: e,
        bom: e,
        bond: e,
        boo: e,
        book: e,
        booking: e,
        bosch: e,
        bostik: e,
        boston: e,
        bot: e,
        boutique: e,
        box: e,
        bradesco: e,
        bridgestone: e,
        broadway: e,
        broker: e,
        brother: e,
        brussels: e,
        build: [1, { v0: t, windsurf: t }],
        builders: [1, { cloudsite: t }],
        business: g,
        buy: e,
        buzz: e,
        bzh: e,
        cab: e,
        cafe: e,
        cal: e,
        call: e,
        calvinklein: e,
        cam: e,
        camera: e,
        camp: [1, { emf: [0, { at: t }] }],
        canon: e,
        capetown: e,
        capital: e,
        capitalone: e,
        car: e,
        caravan: e,
        cards: e,
        care: e,
        career: e,
        careers: e,
        cars: e,
        casa: [1, { nabu: [0, { ui: t }] }],
        case: e,
        cash: e,
        casino: e,
        catering: e,
        catholic: e,
        cba: e,
        cbn: e,
        cbre: e,
        center: e,
        ceo: e,
        cern: e,
        cfa: e,
        cfd: e,
        chanel: e,
        channel: e,
        charity: e,
        chase: e,
        chat: e,
        cheap: e,
        chintai: e,
        christmas: e,
        chrome: e,
        church: e,
        cipriani: e,
        circle: e,
        cisco: e,
        citadel: e,
        citi: e,
        citic: e,
        city: e,
        claims: e,
        cleaning: e,
        click: e,
        clinic: e,
        clinique: e,
        clothing: e,
        cloud: [
          1,
          {
            convex: t,
            elementor: t,
            encoway: [0, { eu: t }],
            statics: i,
            ravendb: t,
            axarnet: [0, { "es-1": t }],
            diadem: t,
            jelastic: [0, { vip: t }],
            jele: t,
            "jenv-aruba": [0, { aruba: [0, { eur: [0, { it1: t }] }], it1: t }],
            keliweb: [2, { cs: t }],
            oxa: [2, { tn: t, uk: t }],
            primetel: [2, { uk: t }],
            reclaim: [0, { ca: t, uk: t, us: t }],
            trendhosting: [0, { ch: t, de: t }],
            jotelulu: t,
            kuleuven: t,
            laravel: t,
            linkyard: t,
            magentosite: i,
            matlab: t,
            observablehq: t,
            perspecta: t,
            vapor: t,
            "on-rancher": i,
            scw: [
              0,
              {
                baremetal: [0, { "fr-par-1": t, "fr-par-2": t, "nl-ams-1": t }],
                "fr-par": [
                  0,
                  {
                    cockpit: t,
                    fnc: [2, { functions: t }],
                    k8s: v,
                    s3: t,
                    "s3-website": t,
                    whm: t,
                  },
                ],
                instances: [0, { priv: t, pub: t }],
                k8s: t,
                "nl-ams": [
                  0,
                  { cockpit: t, k8s: v, s3: t, "s3-website": t, whm: t },
                ],
                "pl-waw": [0, { cockpit: t, k8s: v, s3: t, "s3-website": t }],
                scalebook: t,
                smartlabeling: t,
              },
            ],
            servebolt: t,
            onstackit: [0, { runs: t }],
            trafficplex: t,
            "unison-services": t,
            urown: t,
            voorloper: t,
            zap: t,
          },
        ],
        club: [1, { cloudns: t, jele: t, barsy: t }],
        clubmed: e,
        coach: e,
        codes: [1, { owo: i }],
        coffee: e,
        college: e,
        cologne: e,
        commbank: e,
        community: [1, { nog: t, ravendb: t, myforum: t }],
        company: e,
        compare: e,
        computer: e,
        comsec: e,
        condos: e,
        construction: e,
        consulting: e,
        contact: e,
        contractors: e,
        cooking: e,
        cool: [1, { elementor: t, de: t }],
        corsica: e,
        country: e,
        coupon: e,
        coupons: e,
        courses: e,
        cpa: e,
        credit: e,
        creditcard: e,
        creditunion: e,
        cricket: e,
        crown: e,
        crs: e,
        cruise: e,
        cruises: e,
        cuisinella: e,
        cymru: e,
        cyou: e,
        dad: e,
        dance: e,
        data: e,
        date: e,
        dating: e,
        datsun: e,
        day: e,
        dclk: e,
        dds: e,
        deal: e,
        dealer: e,
        deals: e,
        degree: e,
        delivery: e,
        dell: e,
        deloitte: e,
        delta: e,
        democrat: e,
        dental: e,
        dentist: e,
        desi: e,
        design: [1, { graphic: t, bss: t }],
        dev: [
          1,
          {
            "12chars": t,
            myaddr: t,
            panel: t,
            lcl: i,
            lclstage: i,
            stg: i,
            stgstage: i,
            pages: t,
            r2: t,
            workers: t,
            deno: t,
            "deno-staging": t,
            deta: t,
            evervault: o,
            fly: t,
            githubpreview: t,
            gateway: i,
            hrsn: [2, { psl: [0, { sub: t, wc: [0, { "*": t, sub: i }] }] }],
            botdash: t,
            inbrowser: i,
            "is-a-good": t,
            "is-a": t,
            iserv: t,
            runcontainers: t,
            localcert: [0, { user: i }],
            loginline: t,
            barsy: t,
            mediatech: t,
            modx: t,
            ngrok: t,
            "ngrok-free": t,
            "is-a-fullstack": t,
            "is-cool": t,
            "is-not-a": t,
            localplayer: t,
            xmit: t,
            "platter-app": t,
            replit: [
              2,
              {
                archer: t,
                bones: t,
                canary: t,
                global: t,
                hacker: t,
                id: t,
                janeway: t,
                kim: t,
                kira: t,
                kirk: t,
                odo: t,
                paris: t,
                picard: t,
                pike: t,
                prerelease: t,
                reed: t,
                riker: t,
                sisko: t,
                spock: t,
                staging: t,
                sulu: t,
                tarpit: t,
                teams: t,
                tucker: t,
                wesley: t,
                worf: t,
              },
            ],
            crm: [0, { d: i, w: i, wa: i, wb: i, wc: i, wd: i, we: i, wf: i }],
            vercel: t,
            webhare: i,
          },
        ],
        dhl: e,
        diamonds: e,
        diet: e,
        digital: [1, { cloudapps: [2, { london: t }] }],
        direct: [1, { libp2p: t }],
        directory: e,
        discount: e,
        discover: e,
        dish: e,
        diy: e,
        dnp: e,
        docs: e,
        doctor: e,
        dog: e,
        domains: e,
        dot: e,
        download: e,
        drive: e,
        dtv: e,
        dubai: e,
        dunlop: e,
        dupont: e,
        durban: e,
        dvag: e,
        dvr: e,
        earth: e,
        eat: e,
        eco: e,
        edeka: e,
        education: g,
        email: [1, { crisp: [0, { on: t }], tawk: fe, tawkto: fe }],
        emerck: e,
        energy: e,
        engineer: e,
        engineering: e,
        enterprises: e,
        epson: e,
        equipment: e,
        ericsson: e,
        erni: e,
        esq: e,
        estate: [1, { compute: i }],
        eurovision: e,
        eus: [1, { party: pe }],
        events: [1, { koobin: t, co: t }],
        exchange: e,
        expert: e,
        exposed: e,
        express: e,
        extraspace: e,
        fage: e,
        fail: e,
        fairwinds: e,
        faith: e,
        family: e,
        fan: e,
        fans: e,
        farm: [1, { storj: t }],
        farmers: e,
        fashion: e,
        fast: e,
        fedex: e,
        feedback: e,
        ferrari: e,
        ferrero: e,
        fidelity: e,
        fido: e,
        film: e,
        final: e,
        finance: e,
        financial: g,
        fire: e,
        firestone: e,
        firmdale: e,
        fish: e,
        fishing: e,
        fit: e,
        fitness: e,
        flickr: e,
        flights: e,
        flir: e,
        florist: e,
        flowers: e,
        fly: e,
        foo: e,
        food: e,
        football: e,
        ford: e,
        forex: e,
        forsale: e,
        forum: e,
        foundation: e,
        fox: e,
        free: e,
        fresenius: e,
        frl: e,
        frogans: e,
        frontier: e,
        ftr: e,
        fujitsu: e,
        fun: e,
        fund: e,
        furniture: e,
        futbol: e,
        fyi: e,
        gal: e,
        gallery: e,
        gallo: e,
        gallup: e,
        game: e,
        games: [1, { pley: t, sheezy: t }],
        gap: e,
        garden: e,
        gay: [1, { pages: t }],
        gbiz: e,
        gdn: [1, { cnpy: t }],
        gea: e,
        gent: e,
        genting: e,
        george: e,
        ggee: e,
        gift: e,
        gifts: e,
        gives: e,
        giving: e,
        glass: e,
        gle: e,
        global: [1, { appwrite: t }],
        globo: e,
        gmail: e,
        gmbh: e,
        gmo: e,
        gmx: e,
        godaddy: e,
        gold: e,
        goldpoint: e,
        golf: e,
        goo: e,
        goodyear: e,
        goog: [1, { cloud: t, translate: t, usercontent: i }],
        google: e,
        gop: e,
        got: e,
        grainger: e,
        graphics: e,
        gratis: e,
        green: e,
        gripe: e,
        grocery: e,
        group: [1, { discourse: t }],
        gucci: e,
        guge: e,
        guide: e,
        guitars: e,
        guru: e,
        hair: e,
        hamburg: e,
        hangout: e,
        haus: e,
        hbo: e,
        hdfc: e,
        hdfcbank: e,
        health: [1, { hra: t }],
        healthcare: e,
        help: e,
        helsinki: e,
        here: e,
        hermes: e,
        hiphop: e,
        hisamitsu: e,
        hitachi: e,
        hiv: e,
        hkt: e,
        hockey: e,
        holdings: e,
        holiday: e,
        homedepot: e,
        homegoods: e,
        homes: e,
        homesense: e,
        honda: e,
        horse: e,
        hospital: e,
        host: [
          1,
          {
            cloudaccess: t,
            freesite: t,
            easypanel: t,
            fastvps: t,
            myfast: t,
            tempurl: t,
            wpmudev: t,
            jele: t,
            mircloud: t,
            wp2: t,
            half: t,
          },
        ],
        hosting: [1, { opencraft: t }],
        hot: e,
        hotels: e,
        hotmail: e,
        house: e,
        how: e,
        hsbc: e,
        hughes: e,
        hyatt: e,
        hyundai: e,
        ibm: e,
        icbc: e,
        ice: e,
        icu: e,
        ieee: e,
        ifm: e,
        ikano: e,
        imamat: e,
        imdb: e,
        immo: e,
        immobilien: e,
        inc: e,
        industries: e,
        infiniti: e,
        ing: e,
        ink: e,
        institute: e,
        insurance: e,
        insure: e,
        international: e,
        intuit: e,
        investments: e,
        ipiranga: e,
        irish: e,
        ismaili: e,
        ist: e,
        istanbul: e,
        itau: e,
        itv: e,
        jaguar: e,
        java: e,
        jcb: e,
        jeep: e,
        jetzt: e,
        jewelry: e,
        jio: e,
        jll: e,
        jmp: e,
        jnj: e,
        joburg: e,
        jot: e,
        joy: e,
        jpmorgan: e,
        jprs: e,
        juegos: e,
        juniper: e,
        kaufen: e,
        kddi: e,
        kerryhotels: e,
        kerryproperties: e,
        kfh: e,
        kia: e,
        kids: e,
        kim: e,
        kindle: e,
        kitchen: e,
        kiwi: e,
        koeln: e,
        komatsu: e,
        kosher: e,
        kpmg: e,
        kpn: e,
        krd: [1, { co: t, edu: t }],
        kred: e,
        kuokgroup: e,
        kyoto: e,
        lacaixa: e,
        lamborghini: e,
        lamer: e,
        lancaster: e,
        land: e,
        landrover: e,
        lanxess: e,
        lasalle: e,
        lat: e,
        latino: e,
        latrobe: e,
        law: e,
        lawyer: e,
        lds: e,
        lease: e,
        leclerc: e,
        lefrak: e,
        legal: e,
        lego: e,
        lexus: e,
        lgbt: e,
        lidl: e,
        life: e,
        lifeinsurance: e,
        lifestyle: e,
        lighting: e,
        like: e,
        lilly: e,
        limited: e,
        limo: e,
        lincoln: e,
        link: [
          1,
          {
            myfritz: t,
            cyon: t,
            dweb: i,
            inbrowser: i,
            nftstorage: ye,
            mypep: t,
            storacha: ye,
            w3s: ye,
          },
        ],
        live: [1, { aem: t, hlx: t, ewp: i }],
        living: e,
        llc: e,
        llp: e,
        loan: e,
        loans: e,
        locker: e,
        locus: e,
        lol: [1, { omg: t }],
        london: e,
        lotte: e,
        lotto: e,
        love: e,
        lpl: e,
        lplfinancial: e,
        ltd: e,
        ltda: e,
        lundbeck: e,
        luxe: e,
        luxury: e,
        madrid: e,
        maif: e,
        maison: e,
        makeup: e,
        man: e,
        management: e,
        mango: e,
        map: e,
        market: e,
        marketing: e,
        markets: e,
        marriott: e,
        marshalls: e,
        mattel: e,
        mba: e,
        mckinsey: e,
        med: e,
        media: be,
        meet: e,
        melbourne: e,
        meme: e,
        memorial: e,
        men: e,
        menu: [1, { barsy: t, barsyonline: t }],
        merck: e,
        merckmsd: e,
        miami: e,
        microsoft: e,
        mini: e,
        mint: e,
        mit: e,
        mitsubishi: e,
        mlb: e,
        mls: e,
        mma: e,
        mobile: e,
        moda: e,
        moe: e,
        moi: e,
        mom: [1, { ind: t }],
        monash: e,
        money: e,
        monster: e,
        mormon: e,
        mortgage: e,
        moscow: e,
        moto: e,
        motorcycles: e,
        mov: e,
        movie: e,
        msd: e,
        mtn: e,
        mtr: e,
        music: e,
        nab: e,
        nagoya: e,
        navy: e,
        nba: e,
        nec: e,
        netbank: e,
        netflix: e,
        network: [1, { alces: i, co: t, arvo: t, azimuth: t, tlon: t }],
        neustar: e,
        new: e,
        news: [1, { noticeable: t }],
        next: e,
        nextdirect: e,
        nexus: e,
        nfl: e,
        ngo: e,
        nhk: e,
        nico: e,
        nike: e,
        nikon: e,
        ninja: e,
        nissan: e,
        nissay: e,
        nokia: e,
        norton: e,
        now: e,
        nowruz: e,
        nowtv: e,
        nra: e,
        nrw: e,
        ntt: e,
        nyc: e,
        obi: e,
        observer: e,
        office: e,
        okinawa: e,
        olayan: e,
        olayangroup: e,
        ollo: e,
        omega: e,
        one: [1, { kin: i, service: t }],
        ong: [1, { obl: t }],
        onl: e,
        online: [1, { eero: t, "eero-stage": t, websitebuilder: t, barsy: t }],
        ooo: e,
        open: e,
        oracle: e,
        orange: [1, { tech: t }],
        organic: e,
        origins: e,
        osaka: e,
        otsuka: e,
        ott: e,
        ovh: [1, { nerdpol: t }],
        page: [
          1,
          {
            aem: t,
            hlx: t,
            hlx3: t,
            translated: t,
            codeberg: t,
            heyflow: t,
            prvcy: t,
            rocky: t,
            pdns: t,
            plesk: t,
          },
        ],
        panasonic: e,
        paris: e,
        pars: e,
        partners: e,
        parts: e,
        party: e,
        pay: e,
        pccw: e,
        pet: e,
        pfizer: e,
        pharmacy: e,
        phd: e,
        philips: e,
        phone: e,
        photo: e,
        photography: e,
        photos: be,
        physio: e,
        pics: e,
        pictet: e,
        pictures: [1, { 1337: t }],
        pid: e,
        pin: e,
        ping: e,
        pink: e,
        pioneer: e,
        pizza: [1, { ngrok: t }],
        place: g,
        play: e,
        playstation: e,
        plumbing: e,
        plus: e,
        pnc: e,
        pohl: e,
        poker: e,
        politie: e,
        porn: e,
        pramerica: e,
        praxi: e,
        press: e,
        prime: e,
        prod: e,
        productions: e,
        prof: e,
        progressive: e,
        promo: e,
        properties: e,
        property: e,
        protection: e,
        pru: e,
        prudential: e,
        pub: [1, { id: i, kin: i, barsy: t }],
        pwc: e,
        qpon: e,
        quebec: e,
        quest: e,
        racing: e,
        radio: e,
        read: e,
        realestate: e,
        realtor: e,
        realty: e,
        recipes: e,
        red: e,
        redstone: e,
        redumbrella: e,
        rehab: e,
        reise: e,
        reisen: e,
        reit: e,
        reliance: e,
        ren: e,
        rent: e,
        rentals: e,
        repair: e,
        report: e,
        republican: e,
        rest: e,
        restaurant: e,
        review: e,
        reviews: e,
        rexroth: e,
        rich: e,
        richardli: e,
        ricoh: e,
        ril: e,
        rio: e,
        rip: [1, { clan: t }],
        rocks: [1, { myddns: t, stackit: t, "lima-city": t, webspace: t }],
        rodeo: e,
        rogers: e,
        room: e,
        rsvp: e,
        rugby: e,
        ruhr: e,
        run: [
          1,
          {
            appwrite: i,
            development: t,
            ravendb: t,
            liara: [2, { iran: t }],
            servers: t,
            build: i,
            code: i,
            database: i,
            migration: i,
            onporter: t,
            repl: t,
            stackit: t,
            val: [0, { express: t, web: t }],
            wix: t,
          },
        ],
        rwe: e,
        ryukyu: e,
        saarland: e,
        safe: e,
        safety: e,
        sakura: e,
        sale: e,
        salon: e,
        samsclub: e,
        samsung: e,
        sandvik: e,
        sandvikcoromant: e,
        sanofi: e,
        sap: e,
        sarl: e,
        sas: e,
        save: e,
        saxo: e,
        sbi: e,
        sbs: e,
        scb: e,
        schaeffler: e,
        schmidt: e,
        scholarships: e,
        school: e,
        schule: e,
        schwarz: e,
        science: e,
        scot: [1, { gov: [2, { service: t }] }],
        search: e,
        seat: e,
        secure: e,
        security: e,
        seek: e,
        select: e,
        sener: e,
        services: [1, { loginline: t }],
        seven: e,
        sew: e,
        sex: e,
        sexy: e,
        sfr: e,
        shangrila: e,
        sharp: e,
        shell: e,
        shia: e,
        shiksha: e,
        shoes: e,
        shop: [
          1,
          { base: t, hoplix: t, barsy: t, barsyonline: t, shopware: t },
        ],
        shopping: e,
        shouji: e,
        show: e,
        silk: e,
        sina: e,
        singles: e,
        site: [
          1,
          {
            square: t,
            canva: y,
            cloudera: i,
            convex: t,
            cyon: t,
            fastvps: t,
            figma: t,
            heyflow: t,
            jele: t,
            jouwweb: t,
            loginline: t,
            barsy: t,
            notion: t,
            omniwe: t,
            opensocial: t,
            madethis: t,
            platformsh: i,
            tst: i,
            byen: t,
            srht: t,
            novecore: t,
            cpanel: t,
            wpsquared: t,
          },
        ],
        ski: e,
        skin: e,
        sky: e,
        skype: e,
        sling: e,
        smart: e,
        smile: e,
        sncf: e,
        soccer: e,
        social: e,
        softbank: e,
        software: e,
        sohu: e,
        solar: e,
        solutions: e,
        song: e,
        sony: e,
        soy: e,
        spa: e,
        space: [
          1,
          {
            myfast: t,
            heiyu: t,
            hf: [2, { static: t }],
            "app-ionos": t,
            project: t,
            uber: t,
            xs4all: t,
          },
        ],
        sport: e,
        spot: e,
        srl: e,
        stada: e,
        staples: e,
        star: e,
        statebank: e,
        statefarm: e,
        stc: e,
        stcgroup: e,
        stockholm: e,
        storage: e,
        store: [1, { barsy: t, sellfy: t, shopware: t, storebase: t }],
        stream: e,
        studio: e,
        study: e,
        style: e,
        sucks: e,
        supplies: e,
        supply: e,
        support: [1, { barsy: t }],
        surf: e,
        surgery: e,
        suzuki: e,
        swatch: e,
        swiss: e,
        sydney: e,
        systems: [1, { knightpoint: t }],
        tab: e,
        taipei: e,
        talk: e,
        taobao: e,
        target: e,
        tatamotors: e,
        tatar: e,
        tattoo: e,
        tax: e,
        taxi: e,
        tci: e,
        tdk: e,
        team: [1, { discourse: t, jelastic: t }],
        tech: [1, { cleverapps: t }],
        technology: g,
        temasek: e,
        tennis: e,
        teva: e,
        thd: e,
        theater: e,
        theatre: e,
        tiaa: e,
        tickets: e,
        tienda: e,
        tips: e,
        tires: e,
        tirol: e,
        tjmaxx: e,
        tjx: e,
        tkmaxx: e,
        tmall: e,
        today: [1, { prequalifyme: t }],
        tokyo: e,
        tools: [1, { addr: ue, myaddr: t }],
        top: [1, { ntdll: t, wadl: i }],
        toray: e,
        toshiba: e,
        total: e,
        tours: e,
        town: e,
        toyota: e,
        toys: e,
        trade: e,
        trading: e,
        training: e,
        travel: e,
        travelers: e,
        travelersinsurance: e,
        trust: e,
        trv: e,
        tube: e,
        tui: e,
        tunes: e,
        tushu: e,
        tvs: e,
        ubank: e,
        ubs: e,
        unicom: e,
        university: e,
        uno: e,
        uol: e,
        ups: e,
        vacations: e,
        vana: e,
        vanguard: e,
        vegas: e,
        ventures: e,
        verisign: e,
        versicherung: e,
        vet: e,
        viajes: e,
        video: e,
        vig: e,
        viking: e,
        villas: e,
        vin: e,
        vip: e,
        virgin: e,
        visa: e,
        vision: e,
        viva: e,
        vivo: e,
        vlaanderen: e,
        vodka: e,
        volvo: e,
        vote: e,
        voting: e,
        voto: e,
        voyage: e,
        wales: e,
        walmart: e,
        walter: e,
        wang: e,
        wanggou: e,
        watch: e,
        watches: e,
        weather: e,
        weatherchannel: e,
        webcam: e,
        weber: e,
        website: be,
        wed: e,
        wedding: e,
        weibo: e,
        weir: e,
        whoswho: e,
        wien: e,
        wiki: be,
        williamhill: e,
        win: e,
        windows: e,
        wine: e,
        winners: e,
        wme: e,
        wolterskluwer: e,
        woodside: e,
        work: e,
        works: e,
        world: e,
        wow: e,
        wtc: e,
        wtf: e,
        xbox: e,
        xerox: e,
        xihuan: e,
        xin: e,
        "xn--11b4c3d": e,
        कॉम: e,
        "xn--1ck2e1b": e,
        セール: e,
        "xn--1qqw23a": e,
        佛山: e,
        "xn--30rr7y": e,
        慈善: e,
        "xn--3bst00m": e,
        集团: e,
        "xn--3ds443g": e,
        在线: e,
        "xn--3pxu8k": e,
        点看: e,
        "xn--42c2d9a": e,
        คอม: e,
        "xn--45q11c": e,
        八卦: e,
        "xn--4gbrim": e,
        موقع: e,
        "xn--55qw42g": e,
        公益: e,
        "xn--55qx5d": e,
        公司: e,
        "xn--5su34j936bgsg": e,
        香格里拉: e,
        "xn--5tzm5g": e,
        网站: e,
        "xn--6frz82g": e,
        移动: e,
        "xn--6qq986b3xl": e,
        我爱你: e,
        "xn--80adxhks": e,
        москва: e,
        "xn--80aqecdr1a": e,
        католик: e,
        "xn--80asehdb": e,
        онлайн: e,
        "xn--80aswg": e,
        сайт: e,
        "xn--8y0a063a": e,
        联通: e,
        "xn--9dbq2a": e,
        קום: e,
        "xn--9et52u": e,
        时尚: e,
        "xn--9krt00a": e,
        微博: e,
        "xn--b4w605ferd": e,
        淡马锡: e,
        "xn--bck1b9a5dre4c": e,
        ファッション: e,
        "xn--c1avg": e,
        орг: e,
        "xn--c2br7g": e,
        नेट: e,
        "xn--cck2b3b": e,
        ストア: e,
        "xn--cckwcxetd": e,
        アマゾン: e,
        "xn--cg4bki": e,
        삼성: e,
        "xn--czr694b": e,
        商标: e,
        "xn--czrs0t": e,
        商店: e,
        "xn--czru2d": e,
        商城: e,
        "xn--d1acj3b": e,
        дети: e,
        "xn--eckvdtc9d": e,
        ポイント: e,
        "xn--efvy88h": e,
        新闻: e,
        "xn--fct429k": e,
        家電: e,
        "xn--fhbei": e,
        كوم: e,
        "xn--fiq228c5hs": e,
        中文网: e,
        "xn--fiq64b": e,
        中信: e,
        "xn--fjq720a": e,
        娱乐: e,
        "xn--flw351e": e,
        谷歌: e,
        "xn--fzys8d69uvgm": e,
        電訊盈科: e,
        "xn--g2xx48c": e,
        购物: e,
        "xn--gckr3f0f": e,
        クラウド: e,
        "xn--gk3at1e": e,
        通販: e,
        "xn--hxt814e": e,
        网店: e,
        "xn--i1b6b1a6a2e": e,
        संगठन: e,
        "xn--imr513n": e,
        餐厅: e,
        "xn--io0a7i": e,
        网络: e,
        "xn--j1aef": e,
        ком: e,
        "xn--jlq480n2rg": e,
        亚马逊: e,
        "xn--jvr189m": e,
        食品: e,
        "xn--kcrx77d1x4a": e,
        飞利浦: e,
        "xn--kput3i": e,
        手机: e,
        "xn--mgba3a3ejt": e,
        ارامكو: e,
        "xn--mgba7c0bbn0a": e,
        العليان: e,
        "xn--mgbab2bd": e,
        بازار: e,
        "xn--mgbca7dzdo": e,
        ابوظبي: e,
        "xn--mgbi4ecexp": e,
        كاثوليك: e,
        "xn--mgbt3dhd": e,
        همراه: e,
        "xn--mk1bu44c": e,
        닷컴: e,
        "xn--mxtq1m": e,
        政府: e,
        "xn--ngbc5azd": e,
        شبكة: e,
        "xn--ngbe9e0a": e,
        بيتك: e,
        "xn--ngbrx": e,
        عرب: e,
        "xn--nqv7f": e,
        机构: e,
        "xn--nqv7fs00ema": e,
        组织机构: e,
        "xn--nyqy26a": e,
        健康: e,
        "xn--otu796d": e,
        招聘: e,
        "xn--p1acf": [
          1,
          {
            "xn--90amc": t,
            "xn--j1aef": t,
            "xn--j1ael8b": t,
            "xn--h1ahn": t,
            "xn--j1adp": t,
            "xn--c1avg": t,
            "xn--80aaa0cvac": t,
            "xn--h1aliz": t,
            "xn--90a1af": t,
            "xn--41a": t,
          },
        ],
        рус: [
          1,
          {
            биз: t,
            ком: t,
            крым: t,
            мир: t,
            мск: t,
            орг: t,
            самара: t,
            сочи: t,
            спб: t,
            я: t,
          },
        ],
        "xn--pssy2u": e,
        大拿: e,
        "xn--q9jyb4c": e,
        みんな: e,
        "xn--qcka1pmc": e,
        グーグル: e,
        "xn--rhqv96g": e,
        世界: e,
        "xn--rovu88b": e,
        書籍: e,
        "xn--ses554g": e,
        网址: e,
        "xn--t60b56a": e,
        닷넷: e,
        "xn--tckwe": e,
        コム: e,
        "xn--tiq49xqyj": e,
        天主教: e,
        "xn--unup4y": e,
        游戏: e,
        "xn--vermgensberater-ctb": e,
        vermögensberater: e,
        "xn--vermgensberatung-pwb": e,
        vermögensberatung: e,
        "xn--vhquv": e,
        企业: e,
        "xn--vuq861b": e,
        信息: e,
        "xn--w4r85el8fhu5dnra": e,
        嘉里大酒店: e,
        "xn--w4rs40l": e,
        嘉里: e,
        "xn--xhq521b": e,
        广东: e,
        "xn--zfr164b": e,
        政务: e,
        xyz: [1, { botdash: t, telebit: i }],
        yachts: e,
        yahoo: e,
        yamaxun: e,
        yandex: e,
        yodobashi: e,
        yoga: e,
        yokohama: e,
        you: e,
        youtube: e,
        yun: e,
        zappos: e,
        zara: e,
        zero: e,
        zip: e,
        zone: [1, { cloud66: t, triton: i, stackit: t, lima: t }],
        zuerich: e,
      },
    ];
  })();
function Ka(e, t, n, r) {
  let i = null,
    a = t;
  for (
    ;
    a !== void 0 &&
    ((a[0] & r) !== 0 &&
      (i = { index: n + 1, isIcann: a[0] === 1, isPrivate: a[0] === 2 }),
    n !== -1);
  ) {
    let t = a[1];
    ((a = Object.prototype.hasOwnProperty.call(t, e[n]) ? t[e[n]] : t[`*`]),
      --n);
  }
  return i;
}
function qa(e, t, n) {
  if (Ua(e, t, n)) return;
  let r = e.split(`.`),
    i = (t.allowPrivateDomains ? 2 : 0) | !!t.allowIcannDomains,
    a = Ka(r, Wa, r.length - 1, i);
  if (a !== null) {
    ((n.isIcann = a.isIcann),
      (n.isPrivate = a.isPrivate),
      (n.publicSuffix = r.slice(a.index + 1).join(`.`)));
    return;
  }
  let o = Ka(r, Ga, r.length - 1, i);
  o === null
    ? ((n.isIcann = !1),
      (n.isPrivate = !1),
      (n.publicSuffix = r[r.length - 1] ?? null))
    : ((n.isIcann = o.isIcann),
      (n.isPrivate = o.isPrivate),
      (n.publicSuffix = r.slice(o.index).join(`.`)));
}
var Ja = Ba();
function Ya(e, t = {}) {
  return (Va(Ja), Ha(e, 3, qa, t, Ja).domain);
}
function Xa(e) {
  return Ya(e, { allowPrivateDomains: !0 });
}
function Za(e) {
  return Xa(e) ?? e;
}
var Qa = { "http:": `80`, "https:": `443` };
function $a(e) {
  return e.port || Qa[e.protocol] || ``;
}
function eo(e, t, n) {
  let r = t.toLowerCase(),
    i = e.subdomainMatch ?? `etld1`,
    a = i === `exact` || i === `subdomain` ? r : Za(r);
  for (let [t, o] of e.hostnames.entries()) {
    if (!to(o, i, r, a)) continue;
    let s = i === `exact` ? (e.ports?.[t] ?? ``) : ``;
    if (s === `` || s === n) return !0;
  }
  return !1;
}
function to(e, t, n, r) {
  let i = e.toLowerCase();
  switch (t) {
    case `exact`:
      return i === n;
    case `subdomain`:
      return n === i || n.endsWith(`.${i}`);
    default:
      return Za(i) === r;
  }
}
var no = (e) => (e.startsWith(`www.`) ? e.slice(4) : e),
  ro = (e) => e.split(`.`).length;
function io(e, t) {
  let n = no(t.toLowerCase()),
    r = 1 / 0;
  for (let t of e) {
    let e = no(t.toLowerCase()),
      i = 1e3;
    (e === n
      ? (i = 0)
      : n.endsWith(`.${e}`)
        ? (i = ro(n) - ro(e))
        : e.endsWith(`.${n}`) && (i = 100 + ro(e) - ro(n)),
      (r = Math.min(r, i)));
  }
  return r;
}
function ao(e, t, n, r, i) {
  if (!e) return { kind: `save` };
  let a = [];
  for (let o of e.values())
    if (o.type === `login` && eo(o, t, i)) {
      if (o.username === n && o.password === r) return { kind: `exact` };
      a.push(o);
    }
  return a.length === 0
    ? { kind: `save` }
    : (a.sort(
        (e, r) =>
          (e.username === n ? 0 : 1) - (r.username === n ? 0 : 1) ||
          io(e.hostnames, t) - io(r.hostnames, t),
      ),
      { kind: `update`, candidates: a });
}
var oo = `vault-storage`,
  so = `handles`,
  co = `vault-file`;
async function lo() {
  return new Promise((e, t) => {
    let n = indexedDB.open(oo, 1);
    ((n.onupgradeneeded = () => n.result.createObjectStore(so)),
      (n.onsuccess = () => e(n.result)),
      (n.onerror = () => t(n.error)));
  });
}
async function uo() {
  try {
    let e = await lo();
    return await new Promise((t, n) => {
      let r = e.transaction(so, `readonly`).objectStore(so).get(co);
      ((r.onsuccess = () => t(r.result ?? null)),
        (r.onerror = () => n(r.error)));
    });
  } catch {
    return null;
  }
}
async function fo() {
  try {
    let e = await lo();
    await new Promise((t, n) => {
      let r = e.transaction(so, `readwrite`).objectStore(so).delete(co);
      ((r.onsuccess = () => t()), (r.onerror = () => n(r.error)));
    });
  } catch {}
}
var po = `vault-blob-b64`,
  mo = `vault-blob-backup-b64`;
function Q(e) {
  return `${po}:${e}`;
}
function ho(e) {
  return `${mo}:${e}`;
}
function go(e) {
  return `vault-quarantine:${e}`;
}
function _o(e) {
  return e === `vault-blob-b64` || e.startsWith(`vault-blob-b64:`);
}
async function vo(e, n) {
  if (
    (await e.queryPermission({ mode: `read` })) !== `granted` &&
    (await e.requestPermission({ mode: `read` })) !== `granted`
  )
    throw Error(`permission denied for vault file`);
  let r = new Uint8Array(await (await e.getFile()).arrayBuffer());
  return (await t.storage.local.set({ [Q(n)]: l(r) }), await fo(), r);
}
async function yo(e) {
  let n = (await t.storage.local.get(e))[e];
  return typeof n == `string` && n.length > 0 ? o(n) : null;
}
async function bo() {
  return jn((await t.storage.local.get(z))[z]);
}
async function xo(e) {
  await t.storage.local.set({ [z]: e });
}
var So = null;
function $() {
  return ((So ||= Co()), So);
}
async function Co() {
  (await Eo(), await To());
}
var wo = 3e5;
async function To() {
  let e = await bo();
  if (e.vaults.length === 0) return;
  let n = Date.now(),
    r = new Set();
  for (let i of e.vaults) {
    if (n - i.createdAt < wo) continue;
    let e = await t.storage.local.get([
      Q(i.id),
      ho(i.id),
      Vn(`sync.group`, i.id),
    ]);
    Object.values(e).every((e) => e == null) && r.add(i.id);
  }
  if (r.size === 0 || (await uo()) !== null) return;
  let i = await bo(),
    a = i.vaults.filter((e) => !r.has(e.id));
  a.length !== i.vaults.length && (await xo({ vaults: a }));
}
async function Eo() {
  let e = (await t.storage.local.get(z))[z];
  if (e != null) {
    let t = typeof e.legacyBlobVaultId == `string` ? e.legacyBlobVaultId : null;
    if (t == null) return;
    (await Oo(t), await xo(jn(e)), await ko());
    return;
  }
  let n = (await yo(po)) !== null,
    r = !n && (await uo()) !== null;
  if (!n && !r) {
    (await Do()) || (await xo(An));
    return;
  }
  let i = crypto.randomUUID();
  (await Oo(i),
    (await Do())
      ? await t.storage.local.remove([Q(i), ho(i), ...Bn.map((e) => Vn(e, i))])
      : (await xo(Nn(An, { id: i, label: ``, createdAt: Date.now() })),
        await ko()));
}
async function Do() {
  return (await t.storage.local.get(z))[z] != null;
}
async function Oo(e) {
  let n = await t.storage.local.get([po, mo, ...Bn]),
    r = {};
  (n[`vault-blob-b64`] !== void 0 && (r[Q(e)] = n[po]),
    n[mo] !== void 0 && (r[ho(e)] = n[mo]));
  for (let t of Bn) n[t] !== void 0 && (r[Vn(t, e)] = n[t]);
  Object.keys(r).length > 0 && (await t.storage.local.set(r));
}
async function ko() {
  await t.storage.local.remove([po, mo, ...Bn]);
}
async function Ao(e, n) {
  try {
    let r = (await t.storage.local.get(e))[e];
    if (typeof r != `string` || r.length === 0) {
      await t.storage.local.remove(n);
      return;
    }
    await t.storage.local.set({ [n]: r });
  } catch {}
}
var jo = {
  async hasVaultHandle(e) {
    await $();
    let t = await bo();
    return e == null
      ? t.vaults.length > 0 || (await uo()) !== null
      : (await yo(Q(e))) !== null ||
          (e === t.vaults[0]?.id && (await uo()) !== null);
  },
  async readVaultBlob(e) {
    await $();
    let t = await bo(),
      n = e ?? t.vaults[0]?.id;
    if (n == null) throw Error(`no vault stored`);
    let r = await yo(Q(n));
    if (r !== null) return r;
    if (n === t.vaults[0]?.id) {
      let e = await uo();
      if (e) return vo(e, n);
    }
    throw Error(`no vault stored`);
  },
  async writeVaultBlob(e, n) {
    await $();
    let r = await bo(),
      i = n ?? r.vaults[0]?.id;
    if (i == null)
      throw Error(`writeVaultBlob: no vault id, and no vault registered`);
    let a = Q(i);
    (await Ao(a, ho(i)), await t.storage.local.set({ [a]: l(e) }));
  },
  async restoreVaultFromBackup(e) {
    await $();
    let n = await bo(),
      r = e ?? n.vaults[0]?.id;
    if (r == null) return !1;
    let i = ho(r),
      a = (await t.storage.local.get(i))[i];
    return typeof a != `string` || a.length === 0
      ? !1
      : (await t.storage.local.set({ [Q(r)]: a }), !0);
  },
  async readQuarantine(e) {
    if (!e) throw Error(`readQuarantine needs a vault id`);
    await $();
    let n = go(e),
      r = (await t.storage.local.get(n))[n];
    return typeof r == `string` ? r : null;
  },
  async writeQuarantine(e, n) {
    if (!n) throw Error(`writeQuarantine needs a vault id`);
    (await $(), await t.storage.local.set({ [go(n)]: e }));
  },
  async deleteVaultBlob(e) {
    (await $(),
      await t.storage.local.remove(Q(e)),
      await t.storage.local.remove(ho(e)),
      await t.storage.local.remove(go(e)));
  },
  async getMeta(e) {
    return (await $(), (await t.storage.local.get(e))[e]);
  },
  async setMeta(e, n) {
    (await $(), await t.storage.local.set({ [e]: n }));
  },
  async removeMeta(e) {
    await t.storage.local.remove(e);
  },
  subscribeMeta(e, n) {
    let r = (t, r) => {
      r === `local` && e in t && n();
    };
    return (
      t.storage.onChanged.addListener(r),
      () => t.storage.onChanged.removeListener(r)
    );
  },
};
export {
  xn as $,
  qn as A,
  b as At,
  Qn as B,
  oa as C,
  ze as Ct,
  ea as D,
  w as Dt,
  na as E,
  C as Et,
  Gn as F,
  z as G,
  Bn as H,
  $n as I,
  Ln as J,
  Nn as K,
  ir as L,
  Wn as M,
  Jn as N,
  ia as O,
  y as Ot,
  Kn as P,
  In as Q,
  tr as R,
  ca as S,
  Ne as St,
  ra as T,
  x as Tt,
  Vn as U,
  Yn as V,
  An as W,
  jn as X,
  Rn as Y,
  Pn as Z,
  pa as _,
  De as _t,
  io as a,
  vn as at,
  ma as b,
  Re as bt,
  Xa as c,
  kt as ct,
  Ta as d,
  _t as dt,
  Sn as et,
  ya as f,
  ht as ft,
  ua as g,
  Fe as gt,
  ga as h,
  Be as ht,
  $a as i,
  En as it,
  Xn as j,
  er as k,
  v as kt,
  ba as l,
  lt,
  ha as m,
  L as mt,
  _o as n,
  Tn as nt,
  eo as o,
  yn as ot,
  _a as p,
  xt as pt,
  zn as q,
  ao as r,
  Dn as rt,
  Za as s,
  bn as st,
  jo as t,
  wn as tt,
  wa as u,
  vt as ut,
  fa as v,
  we as vt,
  aa as w,
  ne as wt,
  sa as x,
  Le as xt,
  da as y,
  Pe as yt,
  nr as z,
};
