import { Dt as e, wt as t } from "./storage-nmIf6WgJ.js";
import {
  an as n,
  en as r,
  gn as i,
  in as a,
  vn as o,
} from "./messages-DLCDPx8W.js";
import { n as s } from "./pairing-sas-Ckxg-Wi_.js";
import { t as c } from "./XMLParser-DhBCWQtQ.js";
var l = {
  dropbox: {
    authUrl: `https://www.dropbox.com/oauth2/authorize`,
    tokenUrl: `https://api.dropboxapi.com/oauth2/token`,
    clientId: `z3dojxeco2znshq`,
    scopes: [
      `files.content.write`,
      `files.content.read`,
      `files.metadata.read`,
    ],
    authParams: { token_access_type: `offline` },
  },
};
function u(e) {
  return !l[e].clientId.startsWith(`REPLACE_WITH_`);
}
async function d() {
  let e = n(crypto.getRandomValues(new Uint8Array(32))),
    t = await crypto.subtle.digest(`SHA-256`, new TextEncoder().encode(e));
  return { verifier: e, challenge: n(new Uint8Array(t)) };
}
async function f(e, t) {
  return fetch(e, {
    method: `POST`,
    headers: { "Content-Type": `application/x-www-form-urlencoded` },
    body: new URLSearchParams(t),
  });
}
var p = i({ access_token: o(), refresh_token: o() }),
  ee = i({ access_token: o() }),
  m = i({ error: o().optional(), error_description: o().optional() });
async function h(e) {
  try {
    let t = m.safeParse(await e.json()),
      n = t.success ? (t.data.error_description ?? t.data.error) : void 0;
    if (n) return n;
  } catch {}
  return `HTTP ${e.status}`;
}
async function g(e) {
  let t = l[e.providerId],
    n = await f(t.tokenUrl, {
      grant_type: `authorization_code`,
      code: e.code,
      code_verifier: e.codeVerifier,
      client_id: t.clientId,
      redirect_uri: e.redirectUri,
    });
  if (!n.ok) throw Error(`Sign-in failed (${n.status}). ${await h(n)}`);
  let r = p.safeParse(await n.json());
  if (!r.success)
    throw Error(
      `The provider didn't return a refresh token. Try connecting again.`,
    );
  return {
    accessToken: r.data.access_token,
    refreshToken: r.data.refresh_token,
  };
}
async function _(e, t) {
  let n = l[e],
    r = await f(n.tokenUrl, {
      grant_type: `refresh_token`,
      refresh_token: t,
      client_id: n.clientId,
    });
  if (!r.ok)
    throw Error(
      `Couldn't refresh access (${r.status}: ${await h(r)}). Reconnect the account.`,
    );
  let i = ee.safeParse(await r.json());
  if (!i.success)
    throw Error(`No access token returned. Reconnect the account.`);
  return i.data.access_token;
}
var v = 16777216;
async function y(e) {
  return e.read(0, e.size);
}
function b(e) {
  return new TextDecoder().decode(e.body);
}
var x = (e) => JSON.parse(b(e) || `{}`),
  S = `https://content.dropboxapi.com/2`,
  C = `https://api.dropboxapi.com/2`,
  w = 3,
  T = 3e4,
  E = (e) => new Promise((t) => setTimeout(t, e));
function D(e, t) {
  let n = Number(e.headers?.[`retry-after`]);
  return n > 0 ? n * 1e3 : 1e3 * 2 ** t;
}
function O(e, t) {
  let n = b(t),
    r = n.trim().slice(0, 200);
  try {
    let e = JSON.parse(n),
      t =
        typeof e.user_message == `string`
          ? e.user_message
          : e.user_message?.text;
    typeof t == `string` && t
      ? (r = t)
      : typeof e.error_summary == `string` &&
        (r = e.error_summary.replace(/[./]+$/, ``));
  } catch {}
  return Error(`Dropbox ${e} failed (${r ? `${t.status}: ${r}` : t.status})`);
}
function k(e) {
  let t = (e ?? ``).replace(/^\/+|\/+$/g, ``);
  return t ? `/${t}` : ``;
}
function te(t, n = e) {
  let r = k(t.path),
    i = t.accessToken ?? ``,
    a = (e) => `${r}/${e.replace(/^\/+/, ``)}`;
  async function o() {
    return ((i ||= await _(`dropbox`, t.refreshToken)), i);
  }
  async function s(e, t, r = !0, a = 0) {
    let c = await n.send({
      method: t.method,
      url: e,
      body: t.body,
      headers: { ...t.headers, Authorization: `Bearer ${await o()}` },
    });
    if (c.status === 401 && r) return ((i = ``), s(e, t, !1, a));
    if (c.status === 429 && a < w) {
      let n = D(c, a);
      if (n <= T) return (await E(n), s(e, t, r, a + 1));
    }
    return c;
  }
  async function c(e, t, n) {
    let r = await s(`${S}/files/upload_session/${e}`, {
      method: `POST`,
      headers: {
        "Dropbox-API-Arg": JSON.stringify(t),
        "Content-Type": `application/octet-stream`,
      },
      body: n,
    });
    if (!r.ok) throw O(`upload ${e}`, r);
    return r;
  }
  async function l(e, t) {
    let { session_id: n } = x(
        await c(`start`, { close: !1 }, new Uint8Array()),
      ),
      r = 0;
    for (; r < t.size;) {
      let e = await t.read(r, Math.min(v, t.size - r));
      (await c(
        `append_v2`,
        { cursor: { session_id: n, offset: r }, close: !1 },
        e,
      ),
        (r += e.length));
    }
    await c(
      `finish`,
      {
        cursor: { session_id: n, offset: r },
        commit: { path: a(e), mode: `overwrite`, mute: !0 },
      },
      new Uint8Array(),
    );
  }
  return {
    async put(e, t, n) {
      if (t.size >= 16777216) {
        await l(e, t);
        return;
      }
      let r = JSON.stringify({ path: a(e), mode: `overwrite`, mute: !0 }),
        i = await s(`${S}/files/upload`, {
          method: `POST`,
          headers: {
            "Dropbox-API-Arg": r,
            "Content-Type": n ?? `application/octet-stream`,
          },
          body: await y(t),
        });
      if (!i.ok) throw O(`upload`, i);
    },
    async get(e) {
      let t = await s(`${S}/files/download`, {
        method: `POST`,
        headers: { "Dropbox-API-Arg": JSON.stringify({ path: a(e) }) },
      });
      if (!t.ok) throw O(`download`, t);
      return t.body;
    },
    async list(e) {
      let t = `${r}/${e.replace(/\/+$/, ``)}`,
        n = await s(`${C}/files/list_folder`, {
          method: `POST`,
          headers: { "Content-Type": `application/json` },
          body: new TextEncoder().encode(
            JSON.stringify({ path: t, recursive: !1, limit: 2e3 }),
          ),
        });
      if (n.status === 409) return [];
      if (!n.ok) throw O(`list`, n);
      return (x(n).entries ?? [])
        .filter((e) => e[`.tag`] === `file` && e.name)
        .map((t) => ({
          key: `${e}${t.name}`,
          size: Number(t.size ?? 0),
          lastModified: t.server_modified,
        }));
    },
    async remove(e) {
      let t = await s(`${C}/files/delete_v2`, {
        method: `POST`,
        headers: { "Content-Type": `application/json` },
        body: new TextEncoder().encode(JSON.stringify({ path: a(e) })),
      });
      if (!t.ok && t.status !== 409) throw O(`delete`, t);
    },
  };
}
function ne(e) {
  return e.toISOString().replace(/[:-]|\.\d{3}/g, ``);
}
function A(e) {
  return e.replace(/-/g, ``).slice(0, 8);
}
function re(e, t, n, r) {
  let i = r ? `-v${A(r)}` : ``;
  return `${e}/bramble-${t}-${n.slice(0, 8)}${i}.bramble`;
}
function ie(e) {
  let t = e.lastIndexOf(`/`);
  return `${e.slice(0, t + 1)}.${e.slice(t + 1)}.partial`;
}
function j(e, t) {
  return e.includes(`/bramble-`)
    ? t
      ? e.endsWith(`-v${A(t)}.bramble`)
      : !/-v[0-9a-f]{8}\.bramble$/i.test(e)
    : !1;
}
function M(e, t, n) {
  let r = n ? `-v${A(n)}.bramble.partial` : void 0;
  return e
    .filter((e) => {
      let n = e.key.slice(e.key.lastIndexOf(`/`) + 1);
      if (
        !n.startsWith(`.bramble-`) ||
        !n.endsWith(`.bramble.partial`) ||
        (r ? !n.endsWith(r) : /-v[0-9a-f]{8}\.bramble\.partial$/i.test(n))
      )
        return !1;
      let i = Date.parse(e.lastModified ?? ``);
      return Number.isFinite(i) && t.getTime() - i > 36e5;
    })
    .map((e) => e.key);
}
function N(e, t, n) {
  return t <= 0
    ? []
    : [...e.filter((e) => j(e.key, n))]
        .sort((e, t) => (e.key < t.key ? 1 : e.key > t.key ? -1 : 0))
        .slice(t)
        .map((e) => e.key);
}
async function P(e, t, n) {
  let r = n.prefix ?? `bramble`,
    i = n.keep ?? 30,
    a = n.fingerprint,
    o = n.now ?? new Date(),
    s = re(r, ne(o), a, n.vaultId);
  await e.put(s, t, `application/octet-stream`);
  let c = [];
  if (i <= 0) return { key: s, hash: a, uploaded: t.size, prunedKeys: c };
  try {
    let t = await e.list(`${r}/`);
    c = N(t, i, n.vaultId);
    for (let r of [...c, ...M(t, o, n.vaultId)])
      try {
        await e.remove(r);
      } catch {}
  } catch {
    c = [];
  }
  try {
    await e.sweepIncomplete?.(`${r}/`, o, (e) => j(e, n.vaultId));
  } catch {}
  return { key: s, hash: a, uploaded: t.size, prunedKeys: c };
}
var F = new c(),
  I = new c({ parseTagValue: !1 }),
  L = 1e4,
  R = 1048576,
  z = (e) => (Array.isArray(e) ? e : e ? [e] : []);
function B(e) {
  return e.replace(/&/g, `&amp;`).replace(/</g, `&lt;`).replace(/>/g, `&gt;`);
}
function V(e) {
  return String(e ?? ``)
    .replace(/&#x([0-9a-f]+);/gi, (e, t) =>
      String.fromCodePoint(Number.parseInt(t, 16)),
    )
    .replace(/&#(\d+);/g, (e, t) => String.fromCodePoint(Number(t)));
}
function H(n, r = e) {
  let i = {
    accessKeyId: n.accessKeyId,
    secretAccessKey: n.secretAccessKey,
    region: n.region,
  };
  return {
    async send({ method: e, url: n, headers: a, body: o }) {
      if (o && !(o instanceof Uint8Array))
        throw Error(`S3 uploads go up in parts`);
      let s = await t({
        method: e,
        url: n,
        body: o,
        headers: a,
        credentials: i,
      });
      return r.send({ method: e, url: n, headers: s.headers, body: o });
    },
  };
}
function U(e, t = H(e)) {
  let n = e.endpoint.replace(/\/+$/, ``),
    r = (t) => `${n}/${e.bucket}/${t}`;
  async function i(e, n, r, i) {
    let a = await t.send({
      method: e,
      url: n,
      body: r,
      headers: i ? { "content-type": i } : void 0,
    });
    if (!a.ok) throw Error(`S3 ${e} failed (${a.status})`);
    return a;
  }
  async function a(e, t) {
    let n = [],
      a = ``;
    for (;;) {
      let o = `${r(e)}?uploadId=${encodeURIComponent(t)}${a ? `&part-number-marker=${encodeURIComponent(a)}` : ``}`,
        s = I.parse(b(await i(`GET`, o)))?.ListPartsResult;
      for (let e of z(s?.Part))
        n.push({
          number: Number(e.PartNumber),
          etag: V(e.ETag),
          size: Number(e.Size),
        });
      if (
        ((a = String(s?.NextPartNumberMarker ?? ``)),
        String(s?.IsTruncated) !== `true` || !a)
      )
        return n;
    }
  }
  async function o(e, n, o) {
    let s = await i(`POST`, `${r(e)}?uploads`, void 0, o),
      c = V(I.parse(b(s))?.InitiateMultipartUploadResult?.UploadId);
    if (!c) throw Error(`S3 did not start a multipart upload`);
    let l = `uploadId=${encodeURIComponent(c)}`;
    try {
      let t = Math.max(v, Math.ceil(n.size / L / R) * R),
        o = [];
      for (let a = 0, s = 1; a < n.size; a += t, s++) {
        let c = await n.read(a, Math.min(t, n.size - a));
        (await i(`PUT`, `${r(e)}?partNumber=${s}&${l}`, c),
          o.push({ number: s, size: c.length }));
      }
      let s = await a(e, c);
      if (!(
        s.length === o.length &&
        o.every((e, t) => s[t]?.number === e.number && s[t]?.size === e.size)
      ))
        throw Error(`S3 does not hold every part that was uploaded`);
      let u = `<CompleteMultipartUpload>${s.map((e) => `<Part><PartNumber>${e.number}</PartNumber><ETag>${B(e.etag)}</ETag></Part>`).join(``)}</CompleteMultipartUpload>`,
        d = await i(
          `POST`,
          `${r(e)}?${l}`,
          new TextEncoder().encode(u),
          `application/xml`,
        );
      if (I.parse(b(d))?.Error) throw Error(`S3 failed to complete the upload`);
    } catch (n) {
      throw (
        await t.send({ method: `DELETE`, url: `${r(e)}?${l}` }).catch(() => {}),
        n
      );
    }
  }
  return {
    async put(e, t, n) {
      let a = n ?? `application/octet-stream`;
      t.size < 16777216
        ? await i(`PUT`, r(e), await y(t), a)
        : await o(e, t, a);
    },
    async get(e) {
      return (await i(`GET`, r(e))).body;
    },
    async list(t) {
      let r = `${n}/${e.bucket}?list-type=2&prefix=${encodeURIComponent(t)}`,
        a = F.parse(b(await i(`GET`, r)))?.ListBucketResult?.Contents;
      return (Array.isArray(a) ? a : a ? [a] : []).map((e) => ({
        key: String(e.Key),
        size: Number(e.Size),
        lastModified: e.LastModified,
      }));
    },
    async remove(e) {
      await i(`DELETE`, r(e));
    },
    async sweepIncomplete(a, o, s) {
      let c = `${n}/${e.bucket}?uploads&prefix=${encodeURIComponent(a)}`,
        l = I.parse(b(await i(`GET`, c)))?.ListMultipartUploadsResult;
      for (let e of z(l?.Upload)) {
        let n = Date.parse(String(e.Initiated ?? ``));
        if (!Number.isFinite(n) || o.getTime() - n <= 36e5) continue;
        let i = V(e.Key);
        s(i) &&
          (await t
            .send({
              method: `DELETE`,
              url: `${r(i)}?uploadId=${encodeURIComponent(V(e.UploadId))}`,
            })
            .catch(() => {}));
      }
    },
  };
}
var W = new c({ removeNSPrefix: !0 });
function G(e, t) {
  let n = e.replace(/\/+$/, ``),
    r = t.replace(/^\/+/, ``);
  return r ? `${n}/${r}` : `${n}/`;
}
function K(e) {
  if (e.status === 429)
    return `: rate-limited by the server, which throttles after failed sign-ins. Check the address and credentials, then wait a few minutes and retry`;
  try {
    let t = W.parse(b(e))?.error?.message;
    return typeof t == `string` && t.trim() ? `: ${t.trim()}` : ``;
  } catch {
    return ``;
  }
}
function q(t, n = e) {
  let r = `Basic ${btoa(`${t.username}:${t.password}`)}`;
  return {
    send: ({ method: e, url: t, headers: i, body: a }) =>
      n.send({
        method: e,
        url: t,
        headers: { Authorization: r, ...i },
        body: a,
      }),
  };
}
function J(e, t = q(e)) {
  let n = G(e.serverUrl, ``),
    r = new URL(n).pathname,
    i = (e) => G(n, e);
  async function a(e, n, r = {}) {
    let i = await t.send({ method: e, url: n, ...r });
    if (!i.ok) throw Error(`WebDAV ${e} failed (${i.status})${K(i)}`);
    return i;
  }
  async function o(e) {
    let r = e.split(`/`).filter(Boolean).slice(0, -1);
    for (let e = 1; e <= r.length; e++)
      try {
        await t.send({ method: `MKCOL`, url: G(n, r.slice(0, e).join(`/`)) });
      } catch {}
  }
  function s(e) {
    let t = e;
    try {
      t = new URL(e, n).pathname;
    } catch {}
    return (
      t.startsWith(r) && (t = t.slice(r.length)),
      decodeURIComponent(t.replace(/^\/+/, ``))
    );
  }
  return {
    async put(e, n, r) {
      await o(e);
      let s = ie(e);
      try {
        await a(`PUT`, i(s), {
          body: n.size < 16777216 ? await y(n) : n,
          headers: r ? { "Content-Type": r } : void 0,
        });
        let t = await a(`PROPFIND`, i(s), { headers: { Depth: `0` } }),
          o = [W.parse(b(t))?.multistatus?.response?.propstat ?? []].flat(),
          c = Number(
            o.find((e) => e?.prop?.getcontentlength !== void 0)?.prop
              ?.getcontentlength,
          );
        if (c !== n.size)
          throw Error(`WebDAV stored ${c} bytes of a ${n.size}-byte backup`);
        await a(`MOVE`, i(s), {
          headers: { Destination: i(e), Overwrite: `T` },
        });
      } catch (e) {
        throw (
          await t.send({ method: `DELETE`, url: i(s) }).catch(() => {}),
          e
        );
      }
    },
    async get(e) {
      return (await a(`GET`, i(e))).body;
    },
    async list(e) {
      let t = await a(`PROPFIND`, G(n, e), { headers: { Depth: `1` } }),
        r = W.parse(b(t))?.multistatus?.response,
        i = Array.isArray(r) ? r : r ? [r] : [],
        o = [];
      for (let e of i) {
        let t = e?.propstat?.prop ?? e?.propstat?.[0]?.prop,
          n = t?.getcontentlength,
          r = s(e?.href ?? ``);
        n !== void 0 &&
          r &&
          o.push({ key: r, size: Number(n), lastModified: t?.getlastmodified });
      }
      return o;
    },
    async remove(e) {
      await a(`DELETE`, i(e));
    },
  };
}
function ae(e, t) {
  switch (e.kind) {
    case `s3`:
      return U(e, t);
    case `webdav`:
      return J(e, t);
    case `dropbox`:
      return te(e, t);
  }
}
function oe(e, t) {
  switch (e.kind) {
    case `s3`:
      return H(e, t);
    case `webdav`:
      return q(e, t);
    case `dropbox`:
      return;
  }
}
var Y = 864e5;
function X(e) {
  switch (e) {
    case `daily`:
      return Y;
    case `weekly`:
      return 7 * Y;
    case `monthly`:
      return 30 * Y;
    default:
      return 1 / 0;
  }
}
var se = 9e5;
function Z(e, t) {
  return e <= 0 ? 0 : Math.min(se * 2 ** (e - 1), X(t));
}
function Q(e, t) {
  if (e.frequency === `off`) return !1;
  if (e.lastError === `transfer/interrupted`) return !0;
  if (e.failedAt != null) {
    let n = t - e.failedAt;
    if (n >= 0 && n < Z(e.failures ?? 1, e.frequency)) return !1;
  }
  return e.lastBackupAt == null || t - e.lastBackupAt >= X(e.frequency);
}
function ce(e, t, n) {
  return e.filter((e) => Q(e, t) && e.lastVaultHash !== n);
}
var le = `bramble/link/sas/v1`,
  ue = `bramble/link/sas-input/v1`;
async function de(e, t, n) {
  let i = [new TextEncoder().encode(ue), r(e), r(t), r(n)],
    o = new Uint8Array(i.reduce((e, t) => e + t.length, 0)),
    s = 0;
  for (let e of i) (o.set(e, s), (s += e.length));
  return a(new Uint8Array(await crypto.subtle.digest(`SHA-256`, $(o))));
}
async function fe(e) {
  return a(new Uint8Array(await crypto.subtle.digest(`SHA-256`, $(r(e)))));
}
var $ = (e) => e;
async function pe(e) {
  let t = await crypto.subtle.importKey(`raw`, $(r(e)), `HKDF`, !1, [
      `deriveBits`,
    ]),
    n = await crypto.subtle.deriveBits(
      {
        name: `HKDF`,
        hash: `SHA-256`,
        salt: $(new Uint8Array()),
        info: $(new TextEncoder().encode(le)),
      },
      t,
      64,
    );
  return s(new Uint8Array(n));
}
export {
  Z as a,
  oe as c,
  g as d,
  d as f,
  Q as i,
  P as l,
  pe as n,
  ce as o,
  u as p,
  de as r,
  ae as s,
  fe as t,
  l as u,
};
