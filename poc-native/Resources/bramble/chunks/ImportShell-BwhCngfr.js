import { u as e } from "./build-vault-Dl7gFnhh.js";
import {
  $ as t,
  At as n,
  Ct as r,
  Dt as i,
  Et as a,
  Mt as o,
  Nt as s,
  Ot as c,
  Pt as l,
  Q as u,
  St as d,
  Tt as f,
  U as p,
  Y as m,
  _t as h,
  at as g,
  bt as _,
  gt as v,
  ht as y,
  it as b,
  jt as x,
  kt as S,
  mt as C,
  nt as w,
  o as ee,
  ot as T,
  pt as E,
  tt as te,
  vt as D,
  wt as ne,
  xt as O,
  yt as re,
} from "./text-field-D_94fmjl.js";
import { bt as ie } from "./storage-nmIf6WgJ.js";
import {
  _ as k,
  c as A,
  g as j,
  l as ae,
  o as oe,
  p as se,
  t as M,
  u as N,
} from "./button-DmLv96bj.js";
import {
  E as ce,
  I as le,
  T as ue,
  _ as de,
  ht as fe,
} from "./view-port-9v7d8f_U.js";
import { s as P } from "./format-date-DY5h_i7e.js";
import {
  i as pe,
  n as me,
  r as he,
  t as ge,
} from "./useExchangeAvailability-DGX3pkGa.js";
import { a as _e, c as ve } from "./select-field-BTL4AK3t.js";
import { r as F, t as I } from "./entry-modes-DgaIEd6h.js";
import { f as ye } from "./toggle-DZvvq5Oc.js";
import { t as be } from "./shield-check-y3jRWLWG.js";
import {
  _n as xe,
  bn as L,
  cn as R,
  dn as Se,
  en as Ce,
  gn as z,
  hn as B,
  in as V,
  mn as we,
  nn as Te,
  un as H,
  vn as U,
  xn as W,
} from "./messages-DLCDPx8W.js";
import { t as Ee } from "./XMLParser-DhBCWQtQ.js";
import { t as De } from "./useCanAddFiles-BzYqZRl7.js";
import { t as Oe } from "./VaultChoiceList-DqsBEa5k.js";
var ke = N(`Database`, [
    [`ellipse`, { cx: `12`, cy: `5`, rx: `9`, ry: `3`, key: `msslwz` }],
    [`path`, { d: `M3 5V19A9 3 0 0 0 21 19V5`, key: `1wlel7` }],
    [`path`, { d: `M3 12A9 3 0 0 0 21 12`, key: `mv7ke4` }],
  ]),
  G = e(k(), 1),
  Ae = {
    label: `Apple Passwords`,
    signature: [`title`, `url`, `username`, `password`, `otpauth`],
  },
  je = {
    label: `Google Password Manager`,
    signature: [`name`, `url`, `username`, `password`],
    reject: [`extra`, `grouping`],
  },
  Me = {
    label: `LastPass`,
    signature: [`url`, `username`, `password`, `extra`, `name`, `grouping`],
  },
  Ne = { label: `AliasVault`, signature: [`servicename`, `currentpassword`] },
  Pe = {
    label: `RoboForm`,
    signature: [`name`, `url`, `login`, `note`, `folder`],
  },
  K = {
    label: `Dashlane`,
    signature: [`username`, `username2`, `title`, `password`, `url`],
  },
  Fe = [Ae, je, Me, Ne, Pe, K];
function q(e) {
  return (e ?? []).map((e) => e.trim().toLowerCase());
}
function Ie(e, t) {
  return e.signature.every((e) => t.includes(e))
    ? !e.reject?.some((e) => t.includes(e))
    : !1;
}
function J(e, t) {
  if (Ie(e, t)) return;
  let n = Fe.find((n) => n !== e && Ie(n, t));
  throw Error(
    n
      ? `This looks like an export from ${n.label}. Go back and choose ${n.label} instead.`
      : `This doesn't look like an export from ${e.label}. Its first line should be the column names.`,
  );
}
var Y = {
    name: `servicename`,
    folder: `folderpath`,
    url: `serviceurl`,
    username: `username`,
    password: `currentpassword`,
    email: `aliasemail`,
    totp: `twofactorsecret`,
    cardholder: `cardholdername`,
    number: `cardnumber`,
    expMonth: `cardexpirymonth`,
    expYear: `cardexpiryyear`,
    cvv: `cardcvv`,
    pin: `cardpin`,
    notes: `notes`,
    createdAt: `createdat`,
    updatedAt: `updatedat`,
  },
  Le = [
    [`aliasfirstname`, `First name`],
    [`aliaslastname`, `Last name`],
    [`aliasnickname`, `Nickname`],
    [`aliasgender`, `Gender`],
    [`aliasbirthdate`, `Birth date`],
  ],
  Re = new Set([...Object.values(Y), ...Le.map(([e]) => e)]),
  ze = /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2}):(\d{2}))?$/,
  Be = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2}))?$/;
function Ve(e) {
  let t = e.trim(),
    n = ze.exec(t);
  if (n) {
    let [, e = ``, t = ``, r = ``, i = `0`, a = `0`, o = `0`] = n;
    return { y: r, mo: e, d: t, h: i, mi: a, s: o };
  }
  let r = Be.exec(t);
  if (r) {
    let [, e = ``, t = ``, n = ``, i = `0`, a = `0`, o = `0`] = r;
    return { y: e, mo: t, d: n, h: i, mi: a, s: o };
  }
  return null;
}
function He(e) {
  let t = Ve(e);
  if (!t) return;
  let n = Date.UTC(+t.y, t.mo - 1, +t.d, +t.h, +t.mi, +t.s),
    r = new Date(n);
  return r.getUTCMonth() === t.mo - 1 && r.getUTCDate() === +t.d ? n : void 0;
}
function Ue(e) {
  let t = Ve(e);
  return t ? `${t.y}-${t.mo}-${t.d}` : e;
}
function We(e) {
  let t = v(E(e)),
    n = q(t[0]);
  J(Ne, n);
  let r = (e, t) => {
      let r = n.indexOf(t);
      return r === -1 ? `` : (e[r] ?? ``);
    },
    i = (t[0] ?? [])
      .map((e, t) => ({ label: e.trim(), i: t }))
      .filter(({ label: e }) => e && !Re.has(e.toLowerCase())),
    a = [],
    o = 0,
    s = 0;
  for (let e of t.slice(1)) {
    let t = (t) => r(e, t),
      n = t(Y.name).trim(),
      c = t(Y.notes) || void 0,
      l = He(t(Y.createdAt)),
      u = He(t(Y.updatedAt)),
      d = i.map(({ label: t, i: n }) => ({ key: t, value: e[n] ?? `` })),
      f = w(t(Y.folder).split(`/`)),
      p = { name: n, notes: c, tags: f, createdAt: l, updatedAt: u },
      m = t(Y.number),
      h = {
        cardholderName: t(Y.cardholder),
        number: m,
        expMonth: t(Y.expMonth).trim(),
        expYear: t(Y.expYear).trim(),
        cvv: t(Y.cvv),
        pin: t(Y.pin),
      },
      v = t(Y.url),
      y = t(Y.username),
      b = t(Y.password),
      x = t(Y.email),
      S = t(Y.totp),
      ee = Le.map(([e, n]) => {
        let r = t(e);
        return { key: n, value: e === `aliasbirthdate` && r ? Ue(r) : r };
      }),
      T;
    if (Object.values(h).some((e) => e.trim())) {
      let e = Number(h.expMonth);
      T = {
        type: `card`,
        ...p,
        cardholderName: h.cardholderName,
        number: m,
        brand: g(m),
        expMonth: h.expMonth && Number.isInteger(e) ? String(e) : h.expMonth,
        expYear: h.expYear,
        cvv: h.cvv,
        customFields: _([{ key: `PIN`, value: h.pin, hidden: !0 }, ...d]),
      };
    } else if (v || y || b || x || S || ee.some((e) => e.value)) {
      let e = v
          .split(`,`)
          .map((e) => e.trim())
          .filter(Boolean),
        t = y && x !== y ? [{ key: `Email`, value: x }] : [];
      T = {
        type: `login`,
        ...p,
        name: n || C(e[0] ?? ``) || y || x,
        urls: e,
        username: y || x,
        password: b,
        totp: S || void 0,
        customFields: _([...t, ...ee, ...d]),
      };
    } else if (n || c || d.some((e) => e.value))
      T = { type: `note`, ...p, customFields: _(d) };
    else {
      o++;
      continue;
    }
    (f && s++, a.push(T));
  }
  let c = [];
  return (
    s > 0 &&
      c.push(`${s} item(s) were in an AliasVault folder, imported as tags.`),
    D(a, o, c)
  );
}
var Ge = z({ name: U().nullish(), value: U().nullish(), type: B().nullish() }),
  Ke = z({
    type: B().nullish(),
    name: U().nullish(),
    notes: U().nullish(),
    creationDate: U().nullish(),
    archivedDate: U().nullish(),
    folderId: U().nullish(),
    collectionIds: H(U()).nullish(),
    fields: H(Ge).nullish(),
    login: z({
      uris: H(z({ uri: U().nullish(), match: B().nullish() })).nullish(),
      username: U().nullish(),
      password: U().nullish(),
      totp: U().nullish(),
      fido2Credentials: H(W()).nullish(),
    }).nullish(),
    card: z({
      cardholderName: U().nullish(),
      brand: U().nullish(),
      number: U().nullish(),
      expMonth: U().nullish(),
      expYear: U().nullish(),
      code: U().nullish(),
    }).nullish(),
    identity: xe(U(), W()).nullish(),
    sshKey: z({
      privateKey: U().nullish(),
      publicKey: U().nullish(),
    }).nullish(),
  }),
  qe = z({
    items: H(Ke),
    folders: H(z({ id: U().nullish(), name: U().nullish() })).nullish(),
    collections: H(z({ id: U().nullish(), name: U().nullish() })).nullish(),
  }),
  Je = z({
    credentialId: U(),
    keyType: U(),
    keyAlgorithm: U(),
    keyCurve: U(),
    keyValue: U(),
    rpId: U(),
    rpName: U().nullish(),
    userHandle: U(),
    userName: U().nullish(),
    userDisplayName: U().nullish(),
    counter: U().nullish(),
    creationDate: U().nullish(),
  }),
  Ye = `This doesn't look like a Bitwarden JSON export.`,
  Xe = `This is an encrypted (password-protected) Bitwarden export. Re-export from Bitwarden as a plain .json with "Password protected" turned off, then import that file.`,
  Ze =
    /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i;
function Qe(e) {
  let t = Ze.exec(e);
  if (t) {
    let e = R(t.slice(1).join(``));
    return (e.length === 0 && n(`empty`), V(e));
  }
  return (
    e.startsWith(`b64.`) || n(`neither a UUID nor a b64.-prefixed value`),
    e.length > 4 + a(1023) && n(`longer than the ${r}-byte maximum`),
    f(e.slice(4), r)
  );
}
function $e(e) {
  if (!e) return;
  let t = Date.parse(e);
  return Number.isFinite(t) ? t : void 0;
}
async function et(e, t, n, r, i, a, o) {
  if (!e?.length) return;
  let u = [];
  for (let [d, f] of e.entries()) {
    let e = `"${t}" passkey ${d + 1}`,
      p = Je.safeParse(f);
    if (!p.success) {
      a.push(`${e} had an unexpected shape and was skipped.`);
      continue;
    }
    let m = p.data;
    if (
      m.keyType !== `public-key` ||
      m.keyAlgorithm !== `ECDSA` ||
      m.keyCurve !== `P-256`
    ) {
      a.push(
        `${e} uses an unsupported key type, algorithm, or curve and was skipped.`,
      );
      continue;
    }
    if (!l(m.rpId)) {
      a.push(`${e} has an invalid relying-party ID and was skipped.`);
      continue;
    }
    let h = [
        [`credential ID`, () => Qe(m.credentialId)],
        [`user handle`, () => s(m.userHandle)],
        [`private key`, () => c(m.keyValue)],
      ],
      g = [],
      _ = !1;
    for (let [t, n] of h)
      try {
        g.push(n());
      } catch (n) {
        let r = x(n);
        (a.push(
          r
            ? `${e} has a ${t} that is ${r}, so it was skipped.`
            : `${e} has a ${t} we couldn't read, so it was skipped.`,
        ),
          (_ = !0));
        break;
      }
    if (_) continue;
    let [v, y, b] = g,
      S;
    try {
      if (
        ((S = await i.passkeyImportPkcs8(b)), !S.privateKey || !S.publicKeyCose)
      )
        throw Error(`empty converted key`);
    } catch {
      (a.push(`${e} has invalid private-key material and was skipped.`),
        o.failed++);
      continue;
    }
    let C = $e(m.creationDate);
    (o.converted++,
      u.push({
        credentialId: v,
        rpId: m.rpId,
        rpName: m.rpName || void 0,
        userHandle: y,
        userName: m.userName || void 0,
        userDisplayName: m.userDisplayName || void 0,
        alg: S.alg,
        publicKeyCose: S.publicKeyCose,
        privateKey: S.privateKey,
        signCount: 0,
        createdAt: C ?? n ?? r,
      }),
      m.counter != null &&
        m.counter !== `0` &&
        a.push(`${e} had its signature counter reset to zero.`),
      C === void 0 &&
        a.push(`${e} had no valid creation date; a fallback date was used.`));
  }
  return u.length ? u : void 0;
}
function tt(e) {
  return (e ?? []).some((e) => typeof e.match == `number` && e.match !== 0)
    ? `exact`
    : void 0;
}
function nt(e) {
  return e
    ? e
        .filter((e) => e.type !== 3)
        .map((e) => ({
          key: e.name ?? ``,
          value: e.value ?? ``,
          hidden: e.type === 1,
        }))
    : [];
}
async function rt(e, t) {
  let n;
  try {
    n = JSON.parse(E(e));
  } catch {
    throw Error(Ye);
  }
  if (typeof n == `object` && n) {
    let e = n;
    if (e.encrypted === !0 || e.passwordProtected === !0) throw Error(Xe);
  }
  let r = qe.safeParse(n);
  if (!r.success) throw Error(Ye);
  let i = [],
    a = [],
    s = Date.now(),
    c = { converted: 0, failed: 0 },
    l = new Map();
  for (let e of [...(r.data.folders ?? []), ...(r.data.collections ?? [])])
    e.id && e.name && l.set(e.id, e.name);
  for (let e of r.data.items) {
    let n = e.name ?? ``,
      r = e.notes || void 0,
      o = w(
        [e.folderId, ...(e.collectionIds ?? [])]
          .map((e) => (e ? l.get(e) : void 0))
          .filter((e) => !!e),
      ),
      u = nt(e.fields),
      d = $e(e.creationDate),
      f = $e(e.archivedDate);
    if (e.type === 1) {
      let l = e.login ?? {},
        p = await et(l.fido2Credentials, n, d, s, t, a, c),
        m = (l.uris ?? [])
          .map((e) => e.uri)
          .filter((e) => typeof e == `string` && e.length > 0);
      i.push({
        type: `login`,
        name: n,
        notes: r,
        tags: o,
        archivedAt: f,
        urls: m,
        username: l.username ?? ``,
        password: l.password ?? ``,
        totp: l.totp || void 0,
        subdomainMatch: tt(l.uris),
        customFields: _(u),
        createdAt: d,
        passkeys: p,
      });
    } else if (e.type === 3) {
      let t = e.card ?? {},
        a = t.number ?? ``;
      i.push({
        type: `card`,
        name: n,
        notes: r,
        tags: o,
        archivedAt: f,
        cardholderName: t.cardholderName ?? ``,
        number: a,
        brand: t.brand || g(a),
        expMonth: t.expMonth ?? ``,
        expYear: t.expYear ?? ``,
        cvv: t.code ?? ``,
        customFields: _(u),
      });
    } else if (e.type === 5) {
      let t = e.sshKey ?? {},
        a = t.publicKey ?? ``,
        s = t.privateKey ?? ``;
      i.push({
        type: `ssh-key`,
        name: n,
        notes: r,
        tags: o,
        archivedAt: f,
        publicKey: a,
        privateKey: s,
        keyType: F(a, s),
        customFields: _(u),
      });
    } else {
      let t = e.identity
        ? Object.entries(e.identity).map(([e, t]) => ({
            key: e,
            value: t == null ? `` : String(t),
          }))
        : [];
      i.push({
        type: `note`,
        name: n,
        notes: r,
        tags: o,
        archivedAt: f,
        customFields: _([...u, ...t]),
      });
    }
  }
  let u = o(c, `export`);
  return (u && a.push(u), D(i, 0, a));
}
var it = {
    format: Ae,
    columns: {
      name: [`title`],
      url: [`url`],
      username: [`username`],
      password: [`password`],
      notes: [`notes`],
      totp: [`otpauth`],
    },
  },
  at = {
    format: je,
    columns: {
      name: [`name`],
      url: [`url`],
      username: [`username`],
      password: [`password`],
      notes: [`note`, `notes`],
      totp: [],
    },
  };
function ot(e, t) {
  let n = v(E(t)),
    r = q(n[0]);
  J(e.format, r);
  let i = (t) => {
      for (let n of e.columns[t]) {
        let e = r.indexOf(n);
        if (e !== -1) return e;
      }
      return -1;
    },
    a = (e, t) => (t === -1 ? `` : (e[t] ?? ``)),
    o = {
      name: i(`name`),
      url: i(`url`),
      username: i(`username`),
      password: i(`password`),
      notes: i(`notes`),
      totp: i(`totp`),
    },
    s = [],
    c = 0;
  for (let e of n.slice(1)) {
    let t = a(e, o.url),
      n = a(e, o.username),
      r = a(e, o.password),
      i = a(e, o.notes),
      l = a(e, o.totp);
    !t && !n && !r && !i && !l
      ? c++
      : s.push({
          type: `login`,
          name: a(e, o.name) || C(t) || n,
          notes: i || void 0,
          urls: t ? [t] : [],
          username: n,
          password: r,
          totp: l || void 0,
        });
  }
  return D(s, c, []);
}
function st(e) {
  return ot(it, e);
}
function ct(e) {
  return ot(at, e);
}
var lt = [
    [`credentials`, K.signature],
    [`payments`, [`type`, `account_name`, `cc_number`]],
    [`ids`, [`type`, `number`, `issue_date`]],
    [`personalInfo`, [`type`, `first_name`, `item_name`]],
    [`securenotes`, [`title`, `note`]],
  ],
  ut = [`credentials`, `securenotes`, `payments`, `ids`, `personalInfo`],
  dt = {
    username2: `Username 2`,
    username3: `Username 3`,
    account_holder: `Account holder`,
    routing_number: `Routing number`,
    account_number: `Account number`,
    country: `Country`,
    issuing_bank: `Bank`,
    number: `Number`,
    name: `Name`,
    issue_date: `Issued`,
    expiration_date: `Expires`,
    place_of_issue: `Place of issue`,
    state: `State`,
    title: `Title`,
    first_name: `First name`,
    middle_name: `Middle name`,
    last_name: `Last name`,
    login: `Username`,
    date_of_birth: `Date of birth`,
    place_of_birth: `Place of birth`,
    email: `Email`,
    email_type: `Email type`,
    item_name: `Item name`,
    phone_number: `Phone`,
    address: `Address`,
    city: `City`,
    zip: `Postcode`,
    address_recipient: `Recipient`,
    address_building: `Building`,
    address_apartment: `Apartment`,
    address_floor: `Floor`,
    address_door_code: `Door code`,
    job_title: `Job title`,
    url: `Website`,
  },
  ft = new Set([`issue_date`, `expiration_date`, `date_of_birth`]),
  pt = new Set([`payment_card`, `credit_card`]),
  mt = {
    card: `ID card`,
    passport: `Passport`,
    license: `Driver's license`,
    social_security: `Social security number`,
    tax_number: `Tax number`,
  },
  ht = {
    email: `Email`,
    number: `Phone`,
    address: `Address`,
    website: `Website`,
    company: `Company`,
  },
  gt = `This doesn't look like a Dashlane export.`,
  _t = `Couldn't read this Dashlane file. It may be corrupt.`,
  vt = `This is one file of a Dashlane export. Import its other CSV files the same way, or choose the .zip.`;
function yt(e) {
  let t = v(e),
    n = q(t[0]);
  return {
    kind: lt.find(([, e]) => e.every((e) => n.includes(e)))?.[0],
    header: n,
    labels: (t[0] ?? []).map((e) => e.trim()),
    rows: t.slice(1),
  };
}
function bt(e) {
  let t = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(e.trim());
  if (!t) return e;
  let [, n = ``, r = ``, i = ``] = t;
  return `${n}-${r.padStart(2, `0`)}-${i.padStart(2, `0`)}`;
}
function xt(e, t) {
  let n = (e) => (e === -1 ? `` : (t[e] ?? ``));
  return {
    get: (t) => n(e.header.indexOf(t)),
    rest: (t) =>
      e.header.flatMap((r, i) => {
        if (t.includes(r)) return [];
        let a = ft.has(r) ? bt(n(i)) : n(i);
        return [{ key: dt[r] ?? e.labels[i] ?? r, value: a }];
      }),
  };
}
function St(e, t, n) {
  let r = t.get(`note`) || void 0;
  switch (e) {
    case `credentials`: {
      let e = t.get(`url`),
        i = t.get(`username`);
      return {
        type: `login`,
        name: t.get(`title`).trim() || C(e) || i,
        notes: r,
        urls: e ? [e] : [],
        username: i,
        password: t.get(`password`),
        totp: t.get(`otpurl`) || t.get(`otpsecret`) || void 0,
        customFields: _(
          t.rest([
            `username`,
            `title`,
            `password`,
            `note`,
            `url`,
            `category`,
            `otpurl`,
            `otpsecret`,
          ]),
        ),
        tags: n,
      };
    }
    case `securenotes`:
      return {
        type: `note`,
        name: t.get(`title`).trim(),
        notes: r,
        customFields: _(t.rest([`title`, `note`, `category`])),
        tags: n,
      };
    case `payments`: {
      let e = t.get(`name`).trim() || t.get(`account_name`).trim(),
        i = [`type`, `account_name`, `name`, `note`, `category`];
      if (!pt.has(t.get(`type`)))
        return {
          type: `note`,
          name: e,
          notes: r,
          customFields: _(t.rest(i)),
          tags: n,
        };
      let a = t.get(`cc_number`),
        o = t.get(`expiration_month`).trim(),
        s = [`cc_number`, `code`, `expiration_month`, `expiration_year`];
      return {
        type: `card`,
        name: e,
        notes: r,
        cardholderName: t.get(`account_name`),
        number: a,
        brand: g(a),
        expMonth: o && Number.isInteger(Number(o)) ? String(Number(o)) : o,
        expYear: t.get(`expiration_year`).trim(),
        cvv: t.get(`code`),
        customFields: _(t.rest([...i, ...s])),
        tags: n,
      };
    }
    case `ids`: {
      let e = t.get(`type`),
        i = mt[e] ?? e,
        a = t.get(`name`).trim();
      return {
        type: `note`,
        name: a ? `${i} (${a})` : i,
        notes: r,
        customFields: _(t.rest([`type`, `note`, `category`])),
        tags: n,
      };
    }
    case `personalInfo`: {
      let e = t.get(`type`),
        i = [`first_name`, `middle_name`, `last_name`].map((e) =>
          t.get(e).trim(),
        ),
        a =
          e === `name`
            ? i.filter(Boolean).join(` `)
            : t.get(`item_name`).trim() || ht[e] || e,
        o =
          e === `name`
            ? [`type`, `note`, `category`]
            : [`type`, `item_name`, `note`, `category`];
      return {
        type: `note`,
        name: a,
        notes: r,
        customFields: _(t.rest(o)),
        tags: n,
      };
    }
  }
}
function Ct(e, t) {
  let n = [],
    r = 0,
    i = 0;
  for (let t of ut)
    for (let a of e.filter((e) => e.kind === t))
      for (let e of a.rows) {
        if (e.every((e) => !e.trim())) {
          r++;
          continue;
        }
        let o = xt(a, e),
          s = w(o.get(`category`).split(`,`));
        (s && i++, n.push(St(t, o, s)));
      }
  return (
    i > 0 && t.push(`${i} item(s) had a Dashlane category, imported as tags.`),
    D(n, r, t)
  );
}
function wt(e) {
  return typeof e != `string` && e[0] === 80 && e[1] === 75;
}
function Tt(e) {
  let t = [];
  if (!wt(e)) {
    let n = yt(E(e));
    if (!n.kind) throw (J(K, n.header), Error(gt));
    return (t.push(vt), Ct([{ ...n, kind: n.kind }], t));
  }
  let n = [];
  for (let [r, i] of Object.entries(O(e, _t))) {
    let e = r.split(`/`).pop() ?? ``;
    if (!e || e.startsWith(`.`) || r.startsWith(`__MACOSX/`)) continue;
    let a = yt(d(i));
    a.kind
      ? n.push({ ...a, kind: a.kind })
      : t.push(
          `${e} isn't a Dashlane file Bramble knows, so it wasn't imported.`,
        );
  }
  if (n.length === 0) throw Error(gt);
  return Ct(n, t);
}
var Et = L([B(), Se()]).nullish(),
  Dt = z({
    type: U().nullish(),
    label: U().nullish(),
    value: L([U(), B()]).nullish(),
    sensitive: Et,
    deleted: Et,
  }),
  Ot = z({
    title: U().nullish(),
    note: U().nullish(),
    template_type: U().nullish(),
    fields: H(Dt).nullish(),
    folders: H(U()).nullish(),
    attachments: H(W()).nullish(),
    trashed: Et,
    archived: Et,
    createdAt: B().nullish(),
    updated_at: B().nullish(),
  }),
  kt = z({
    items: H(Ot),
    folders: H(
      z({
        uuid: U().nullish(),
        parent_uuid: U().nullish(),
        title: U().nullish(),
      }),
    ).nullish(),
  }),
  At = `This doesn't look like an Enpass .json export.`,
  jt = new Set([`password`, `totp`, `pin`, `ccPin`, `ccCvc`, `ccTxnpassword`]);
function Mt(e) {
  let t = [];
  for (let n of e.fields ?? []) {
    let e = n.type ?? ``,
      r = n.value == null ? `` : String(n.value);
    n.deleted ||
      e === `section` ||
      r === `` ||
      t.push({
        type: e,
        label: n.label?.trim() || e,
        value: r,
        hidden: !!n.sensitive || jt.has(e),
      });
  }
  return t;
}
var Nt = (e) => ({ key: e.label, value: e.value, hidden: e.hidden });
function Pt(e, t) {
  let n =
      e.find((e) => e.type === `username`) ?? e.find((e) => e.type === `email`),
    r = ``,
    i = ``,
    a = [],
    o = [];
  for (let t of e)
    t !== n &&
      (t.type === `password` && !r
        ? (r = t.value)
        : t.type === `totp` && !i
          ? (i = t.value)
          : t.type === `url`
            ? a.push(t.value)
            : o.push(Nt(t)));
  let s = n?.value ?? ``;
  return {
    type: `login`,
    ...t,
    name: t.name || C(a[0] ?? ``) || s,
    urls: a,
    username: s,
    password: r,
    totp: i || void 0,
    customFields: _(o),
  };
}
function Ft(e) {
  let t = /^(\d{1,2})\s*[/-]\s*(\d{2}|\d{4})$/.exec(e.trim()),
    n = Number(t?.[1]);
  return !t?.[2] || n < 1 || n > 12
    ? null
    : { expMonth: String(n), expYear: t[2] };
}
function It(e, t) {
  let n = ``,
    r = ``,
    i = ``,
    a = null,
    o,
    s = [];
  for (let t of e) {
    let e = t.type === `ccExpiry` && !a ? Ft(t.value) : null,
      c = t.type === `ccType` && !o ? T(t.value) : void 0;
    t.type === `ccName` && !n
      ? (n = t.value)
      : t.type === `ccNumber` && !r
        ? (r = t.value)
        : t.type === `ccCvc` && !i
          ? (i = t.value)
          : e
            ? (a = e)
            : c
              ? (o = c)
              : s.push(Nt(t));
  }
  return {
    type: `card`,
    ...t,
    cardholderName: n,
    number: r,
    brand: g(r) ?? o,
    expMonth: a?.expMonth ?? ``,
    expYear: a?.expYear ?? ``,
    cvv: i,
    customFields: _(s),
  };
}
function Lt(e) {
  let t = new Map((e ?? []).filter((e) => e.uuid).map((e) => [e.uuid, e]));
  return (e) => {
    let n = [],
      r = new Set();
    for (
      let i = t.get(e);
      i?.uuid && !r.has(i.uuid);
      i = t.get(i.parent_uuid ?? ``)
    )
      (r.add(i.uuid), n.unshift(i.title ?? ``));
    return n;
  };
}
var Rt = (e) => (e ? e * 1e3 : void 0);
function zt(e) {
  let t;
  try {
    t = JSON.parse(E(e));
  } catch {
    throw Error(At);
  }
  let n = kt.safeParse(t);
  if (!n.success) throw Error(At);
  let r = Lt(n.data.folders),
    i = Date.now(),
    a = [],
    o = 0,
    s = 0;
  for (let e of n.data.items) {
    if (e.trashed) {
      o++;
      continue;
    }
    s += e.attachments?.length ?? 0;
    let t = Rt(e.updated_at),
      n = {
        name: e.title?.trim() ?? ``,
        notes: e.note || void 0,
        tags: w((e.folders ?? []).flatMap(r)),
        createdAt: Rt(e.createdAt),
        updatedAt: t,
        archivedAt: e.archived ? (t ?? i) : void 0,
      },
      c = Mt(e),
      l = e.template_type ?? ``;
    l.startsWith(`creditcard.`)
      ? a.push(It(c, n))
      : l.startsWith(`login.`) ||
          l.startsWith(`password.`) ||
          (!l.startsWith(`identity.`) && c.some((e) => e.type === `password`))
        ? a.push(Pt(c, n))
        : a.push({ type: `note`, ...n, customFields: _(c.map(Nt)) });
  }
  let c = [];
  return (
    o > 0 && c.push(`${o} item(s) in Enpass's trash were left out.`),
    s > 0 &&
      c.push(
        `${s} attachment(s) weren't imported, as attachments aren't supported yet. Save them from Enpass before you delete it.`,
      ),
    D(a, o, c)
  );
}
var X = `KPEX_PASSKEY_`,
  Bt = `${X}CREDENTIAL_ID`,
  Vt = `${X}PRIVATE_KEY_PEM`,
  Ht = `${X}RELYING_PARTY`,
  Ut = `${X}USERNAME`,
  Wt = `${X}USER_HANDLE`,
  Gt = `${X}GENERATED_USER_ID`;
function Kt(e) {
  return e.some((e) => e.key.startsWith(X));
}
function qt(e) {
  let t = new Map(),
    n = [];
  for (let r of e) r.key.startsWith(X) ? t.set(r.key, r.value) : n.push(r);
  return { passkey: t, rest: n };
}
function Jt(e, t, r) {
  let i = e.get(t)?.trim();
  return (i || n(`has no ${r}`), i);
}
async function Yt(e, t, a, o, c, u) {
  if (!Kt(e)) return { credential: null, fields: e };
  let { passkey: d, rest: p } = qt(e),
    m = `"${t}"`,
    h = (t) => (
      c.push(`The passkey on ${m} ${t}, so it was kept as fields instead.`),
      u.failed++,
      { credential: null, fields: e }
    ),
    g,
    _,
    v,
    y;
  try {
    ((g = f(Jt(d, Bt, `credential ID`), r)),
      (_ = s(d.get(Wt)?.trim() || Jt(d, Gt, `user handle`))),
      (v = Jt(d, Ht, `relying-party ID`)),
      l(v) || n(`has an invalid relying-party ID`),
      (y = i(Jt(d, Vt, `private key`))));
  } catch (e) {
    return h(x(e) ?? `could not be read`);
  }
  let b;
  try {
    if (
      ((b = await o.passkeyImportPkcs8(y)), !b.privateKey || !b.publicKeyCose)
    )
      throw Error(`empty converted key`);
  } catch {
    return (
      u.failed++,
      c.push(
        `The passkey on ${m} has key material we can't read, so it was kept as fields instead.`,
      ),
      { credential: null, fields: e }
    );
  }
  return (
    u.converted++,
    {
      credential: {
        credentialId: g,
        rpId: v,
        userHandle: _,
        userName: d.get(Ut)?.trim() || void 0,
        alg: b.alg,
        publicKeyCose: b.publicKeyCose,
        privateKey: b.privateKey,
        signCount: 0,
        createdAt: a,
      },
      fields: p,
    }
  );
}
var Xt = `This doesn't look like a KeePass 2.x XML export.`,
  Zt = `Recycle Bin`,
  Qt = new Set([
    `Title`,
    `UserName`,
    `Password`,
    `URL`,
    `Notes`,
    `Tags`,
    `Group`,
  ]);
function $t(e) {
  return e == null ? [] : Array.isArray(e) ? e : [e];
}
var en = /&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6}));/g,
  tn = { amp: `&`, lt: `<`, gt: `>`, quot: `"`, apos: `'` };
function nn(e) {
  return e.includes(`&`)
    ? e.replace(en, (e, t, n, r) => {
        if (t) return tn[t] ?? e;
        let i = Number.parseInt(n ?? r, n ? 10 : 16);
        return i > 1114111 || (i >= 55296 && i <= 57343)
          ? e
          : String.fromCodePoint(i);
      })
    : e;
}
function rn(e) {
  return e == null
    ? { text: ``, hidden: !1 }
    : typeof e == `string`
      ? { text: nn(e), hidden: !1 }
      : {
          text: nn(e[`#text`] ?? ``),
          hidden: e[`@_ProtectInMemory`] === `True`,
        };
}
function an(e, t = []) {
  let n = e.Name ? nn(e.Name) : void 0;
  if (n === Zt) return [];
  let r = n ? [...t, n] : t,
    i = $t(e.Entry).map((e) => ({ entry: e, path: r })),
    a = $t(e.Group).flatMap((e) => an(e, r));
  return [...i, ...a];
}
function on(e) {
  let t = ``,
    n = ``,
    r = ``,
    i = ``,
    a = ``,
    o,
    s = [],
    c = [];
  for (let { key: l, value: u, hidden: d } of e)
    switch (l) {
      case `Title`:
        t = u;
        break;
      case `UserName`:
        n = u;
        break;
      case `Password`:
        r = u;
        break;
      case `URL`:
        i = u;
        break;
      case `Notes`:
        a = u;
        break;
      case `otp`:
        o = u || o;
        break;
      case `TOTP Seed`:
        o ||= u;
        break;
      case `TOTP Settings`:
        break;
      case `Tags`:
        c.push(...u.split(/[,;]/));
        break;
      case `Group`:
        c.push(...u.split(`/`));
        break;
      default:
        Qt.has(l) || s.push({ key: l, value: u, hidden: d });
    }
  return {
    type: `login`,
    name: t,
    notes: a || void 0,
    urls: i ? [i] : [],
    username: n,
    password: r,
    totp: o || void 0,
    customFields: _(s),
    tags: w(c),
  };
}
async function sn(e, t, n, r, i) {
  let { credential: a, fields: o } = await Yt(
      e,
      e.find((e) => e.key === `Title`)?.value || `Untitled`,
      n,
      t,
      r,
      i,
    ),
    s = on(o);
  return !a || s.type !== `login` ? s : { ...s, passkeys: [a] };
}
function cn({ entry: e, path: t }) {
  let n = $t(e.String).map((e) => {
    let { text: t, hidden: n } = rn(e.Value);
    return { key: nn(String(e.Key ?? ``)), value: t, hidden: n };
  });
  e.Tags && n.push({ key: `Tags`, value: nn(e.Tags), hidden: !1 });
  let r = t.slice(1).join(`/`);
  return (r && n.push({ key: `Group`, value: r, hidden: !1 }), n);
}
async function ln(e, t) {
  let n = E(e),
    r;
  try {
    r = new Ee({
      ignoreAttributes: !1,
      attributeNamePrefix: `@_`,
      parseTagValue: !1,
      processEntities: !1,
    }).parse(n);
  } catch {
    throw Error(Xt);
  }
  let i = r?.KeePassFile?.Root;
  if (!i) throw Error(Xt);
  let a = $t(i.Group).flatMap((e) => an(e)),
    s = [],
    c = { converted: 0, failed: 0 },
    l = Date.now(),
    u = [];
  for (let e of a) u.push(await sn(cn(e), t, l, s, c));
  let d = o(c, `export`);
  return (d && s.push(d), D(u, 0, s));
}
var un = `http://sn`,
  dn = `http://`,
  fn = {
    "Bank Account": [
      `Bank Name`,
      `Account Type`,
      `Routing Number`,
      `Account Number`,
      `SWIFT Code`,
      `IBAN Number`,
      `Pin`,
      `Branch Address`,
      `Branch Phone`,
    ],
    "Credit Card": [
      `Name on Card`,
      `Type`,
      `Number`,
      `Security Code`,
      `Start Date`,
      `Expiration Date`,
    ],
    Database: [
      `Type`,
      `Hostname`,
      `Port`,
      `Database`,
      `Username`,
      `Password`,
      `SID`,
      `Alias`,
    ],
    "Driver's License": [
      `Number`,
      `Expiration Date`,
      `License Class`,
      `Name`,
      `Address`,
      `City / Town`,
      `State`,
      `ZIP / Postal Code`,
      `Country`,
      `Date of Birth`,
      `Sex`,
      `Height`,
    ],
    "Email Account": [
      `Username`,
      `Password`,
      `Server`,
      `Port`,
      `Type`,
      `SMTP Server`,
      `SMTP Port`,
    ],
    "Health Insurance": [
      `Company`,
      `Company Phone`,
      `Policy Type`,
      `Policy Number`,
      `Group ID`,
      `Member Name`,
      `Member ID`,
      `Physician Name`,
      `Physician Phone`,
      `Physician Address`,
      `Co-pay`,
    ],
    "Instant Messenger": [`Type`, `Username`, `Password`, `Server`, `Port`],
    Insurance: [
      `Company`,
      `Policy Type`,
      `Policy Number`,
      `Expiration`,
      `Agent Name`,
      `Agent Phone`,
      `URL`,
    ],
    Membership: [
      `Organization`,
      `Membership Number`,
      `Member Name`,
      `Start Date`,
      `Expiration Date`,
      `Website`,
      `Telephone`,
      `Password`,
    ],
    Passport: [
      `Type`,
      `Name`,
      `Country`,
      `Number`,
      `Sex`,
      `Nationality`,
      `Date of Birth`,
      `Issued Date`,
      `Expiration Date`,
    ],
    Server: [`Hostname`, `Username`, `Password`],
    "Software License": [
      `License Key`,
      `Licensee`,
      `Version`,
      `Publisher`,
      `Support Email`,
      `Website`,
      `Price`,
      `Purchase Date`,
      `Order Number`,
      `Number of Licenses`,
      `Order Total`,
    ],
    "SSH Key": [
      `Bit Strength`,
      `Format`,
      `Passphrase`,
      `Private Key`,
      `Public Key`,
      `Hostname`,
      `Date`,
    ],
    "Social Security": [`Name`, `Number`],
    "Wi-Fi Password": [
      `SSID`,
      `Password`,
      `Connection Type`,
      `Connection Mode`,
      `Authentication`,
      `Encryption`,
      `Use 802.1X`,
      `FIPS Mode`,
      `Key Type`,
      `Protected`,
      `Key Index`,
    ],
    Address: [
      `Title`,
      `First Name`,
      `Middle Name`,
      `Last Name`,
      `Username`,
      `Gender`,
      `Birthday`,
      `Company`,
      `Address 1`,
      `Address 2`,
      `Address 3`,
      `City / Town`,
      `County`,
      `State`,
      `Zip / Postal Code`,
      `Country`,
      `Timezone`,
      `Email Address`,
      `Phone`,
      `Evening Phone`,
      `Mobile Phone`,
      `Fax`,
    ],
  },
  pn = new Set([`password`, `pin`, `passphrase`, `private key`]),
  mn = [
    `january`,
    `february`,
    `march`,
    `april`,
    `may`,
    `june`,
    `july`,
    `august`,
    `september`,
    `october`,
    `november`,
    `december`,
  ];
function hn(e) {
  if (!e.startsWith(`NoteType:`)) return null;
  let t = e.split(`
`),
    n = (t[0] ?? ``).slice(9).trim(),
    r = fn[n],
    i = [`Language`, ...(r ?? []), `Notes`],
    a = new Map(),
    o = ``,
    s = [],
    c = 0,
    l = () => {
      o &&
        a.set(
          o,
          s.join(`
`),
        );
    };
  for (let e of t.slice(1)) {
    if (o !== `Notes`) {
      let t = i.findIndex((t, n) => n >= c && e.startsWith(`${t}:`));
      if (t !== -1) {
        (l(), (o = i[t]), (s = [e.slice(o.length + 1)]), (c = t + 1));
        continue;
      }
      let n = r ? null : /^([^:\n]+):/.exec(e);
      if (n?.[1]) {
        (l(), (o = n[1]), (s = [e.slice(o.length + 1)]));
        continue;
      }
    }
    s.push(e);
  }
  l();
  let u = a.get(`Notes`) ?? ``;
  return (
    a.delete(`Notes`),
    a.delete(`Language`),
    { noteType: n, fields: a, notes: u }
  );
}
function gn(e) {
  return e.replace(/[,\s]/g, ``) === ``;
}
function _n(e) {
  let t = e.split(`,`).map((e) => e.trim()),
    n = mn.indexOf((t[0] ?? ``).toLowerCase()),
    r = t.slice(1).find((e) => /^(\d{2}|\d{4})$/.test(e));
  return { expMonth: n === -1 ? `` : String(n + 1), expYear: r ?? `` };
}
function vn(e, t) {
  let n = new Set(t),
    r = [];
  for (let [t, i] of e)
    n.has(t) ||
      gn(i) ||
      r.push({ key: t, value: i, hidden: pn.has(t.toLowerCase()) || void 0 });
  return r;
}
var yn = [`Name on Card`, `Number`, `Security Code`, `Expiration Date`],
  bn = [`Public Key`, `Private Key`, `Passphrase`];
function xn(e, t, n) {
  let r = e.fields,
    i = e.notes || void 0;
  if (e.noteType === `Credit Card`) {
    let e = r.get(`Number`) ?? ``,
      a = r.get(`Type`) ?? ``,
      o = T(a),
      s = g(e) ?? o,
      c = o ? [...yn, `Type`] : yn;
    return {
      type: `card`,
      name: t,
      notes: i,
      cardholderName: r.get(`Name on Card`) ?? ``,
      number: e,
      brand: s,
      ..._n(r.get(`Expiration Date`) ?? ``),
      cvv: r.get(`Security Code`) ?? ``,
      customFields: _(vn(r, c)),
      tags: n,
    };
  }
  let a = r.get(`Public Key`) ?? ``,
    o = r.get(`Private Key`) ?? ``;
  return e.noteType === `SSH Key` && (a || o)
    ? {
        type: `ssh-key`,
        name: t,
        notes: i,
        publicKey: a,
        privateKey: o,
        passphrase: r.get(`Passphrase`) || void 0,
        keyType: F(a, o),
        customFields: _(vn(r, bn)),
        tags: n,
      }
    : { type: `note`, name: t, notes: i, customFields: _(vn(r, [])), tags: n };
}
function Sn(e) {
  let t = v(E(e)),
    n = q(t[0]);
  J(Me, n);
  let r = {
      url: n.indexOf(`url`),
      username: n.indexOf(`username`),
      password: n.indexOf(`password`),
      totp: n.indexOf(`totp`),
      extra: n.indexOf(`extra`),
      name: n.indexOf(`name`),
      grouping: n.indexOf(`grouping`),
    },
    i = (e, t) => (t === -1 ? `` : (e[t] ?? ``)),
    a = [],
    o = [],
    s = 0,
    c = 0;
  for (let e of t.slice(1)) {
    let t = i(e, r.url),
      n = i(e, r.username),
      o = i(e, r.password),
      l = i(e, r.totp),
      u = i(e, r.extra),
      d = i(e, r.name).trim(),
      f = i(e, r.grouping).trim();
    if (!t && !n && !o && !u && !d) {
      s++;
      continue;
    }
    let p = w(f.split(`\\`));
    if ((p && c++, t === un)) {
      let e = hn(u);
      a.push(
        e
          ? xn(e, d, p)
          : { type: `note`, name: d, notes: u || void 0, tags: p },
      );
      continue;
    }
    let m = t === dn ? `` : t;
    a.push({
      type: `login`,
      name: d || C(m) || n,
      notes: u || void 0,
      urls: m ? [m] : [],
      username: n,
      password: o,
      totp: l || void 0,
      tags: p,
    });
  }
  return (
    c > 0 &&
      o.push(`${c} item(s) were in a LastPass folder, imported as tags.`),
    D(a, s, o)
  );
}
var Cn = {
  pdf: `application/pdf`,
  png: `image/png`,
  jpg: `image/jpeg`,
  jpeg: `image/jpeg`,
  gif: `image/gif`,
  webp: `image/webp`,
  heic: `image/heic`,
  txt: `text/plain`,
  md: `text/markdown`,
  csv: `text/csv`,
  json: `application/json`,
  zip: `application/zip`,
  doc: `application/msword`,
  docx: `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
  xlsx: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
  key: `application/octet-stream`,
  pem: `application/x-pem-file`,
};
function wn(e) {
  return (
    Cn[e.includes(`.`) ? e.slice(e.lastIndexOf(`.`) + 1).toLowerCase() : ``] ??
    `application/octet-stream`
  );
}
var Tn = z({ fileName: U().nullish(), documentId: U().nullish() }),
  En = z({
    string: U().nullish(),
    concealed: U().nullish(),
    totp: U().nullish(),
    creditCardNumber: U().nullish(),
    monthYear: B().nullish(),
    email: L([U(), z({ email_address: U().nullish() })]).nullish(),
    phone: U().nullish(),
    url: U().nullish(),
    date: B().nullish(),
    file: Tn.nullish(),
  }),
  Dn = z({ id: U().nullish(), title: U().nullish(), value: En.nullish() }),
  On = z({
    categoryUuid: U().nullish(),
    state: U().nullish(),
    updatedAt: B().nullish(),
    overview: z({
      title: U().nullish(),
      url: U().nullish(),
      urls: H(z({ label: U().nullish(), url: U().nullish() })).nullish(),
      tags: H(U()).nullish(),
    }).nullish(),
    details: z({
      loginFields: H(
        z({ value: U().nullish(), designation: U().nullish() }),
      ).nullish(),
      sections: H(z({ fields: H(Dn).nullish() })).nullish(),
      notesPlain: U().nullish(),
      password: U().nullish(),
      documentAttributes: Tn.nullish(),
    }).nullish(),
  }),
  kn = z({
    accounts: H(z({ vaults: H(z({ items: H(On).nullish() })).nullish() })),
  }),
  An = `This doesn't look like a 1Password .1pux export.`,
  jn = `001`,
  Mn = `002`,
  Nn = `005`,
  Pn = `114`;
function Fn(e) {
  return e
    ? typeof e.totp == `string`
      ? { text: e.totp, hidden: !1, totp: e.totp }
      : typeof e.concealed == `string`
        ? { text: e.concealed, hidden: !0 }
        : typeof e.string == `string`
          ? { text: e.string, hidden: !1 }
          : typeof e.creditCardNumber == `string`
            ? { text: e.creditCardNumber, hidden: !1 }
            : typeof e.monthYear == `number`
              ? { text: String(e.monthYear), hidden: !1 }
              : typeof e.url == `string`
                ? { text: e.url, hidden: !1 }
                : typeof e.phone == `string`
                  ? { text: e.phone, hidden: !1 }
                  : typeof e.date == `number`
                    ? { text: String(e.date), hidden: !1 }
                    : typeof e.email == `string`
                      ? { text: e.email, hidden: !1 }
                      : e.email && typeof e.email == `object`
                        ? { text: e.email.email_address ?? ``, hidden: !1 }
                        : { text: ``, hidden: !1 }
    : { text: ``, hidden: !1 };
}
function In(e) {
  let t = [];
  for (let n of e.details?.sections ?? [])
    for (let e of n.fields ?? []) {
      let n = Fn(e.value);
      t.push({ id: e.id ?? ``, title: e.title || e.id || `Field`, ...n });
    }
  return t;
}
function Ln(e) {
  let t = [],
    n = (e) => {
      typeof e == `string` && e && !t.includes(e) && t.push(e);
    };
  n(e.overview?.url);
  for (let t of e.overview?.urls ?? []) n(t.url);
  return t;
}
function Rn(e) {
  let t = e.details?.loginFields ?? [];
  return {
    username: t.find((e) => e.designation === `username`)?.value ?? ``,
    password:
      t.find((e) => e.designation === `password`)?.value ??
      e.details?.password ??
      ``,
  };
}
function zn(e, t, n) {
  let { username: r, password: i } = Rn(e),
    a = In(e),
    o = a.find((e) => e.totp)?.totp,
    s = a
      .filter((e) => !e.totp)
      .map((e) => ({ key: e.title, value: e.text, hidden: e.hidden }));
  return {
    type: `login`,
    name: t,
    notes: n,
    urls: Ln(e),
    username: r,
    password: i,
    totp: o || void 0,
    customFields: _(s),
  };
}
function Bn(e, t, n) {
  let r = ``,
    i = ``,
    a = ``,
    o = ``,
    s = ``,
    c = [];
  for (let t of In(e))
    switch (t.id) {
      case `ccnum`:
        r = t.text;
        break;
      case `cardholder`:
        i = t.text;
        break;
      case `cvv`:
        a = t.text;
        break;
      case `expiry`: {
        let e = Number(t.text);
        Number.isFinite(e) &&
          e > 0 &&
          ((s = String(Math.floor(e / 100))), (o = String(e % 100)));
        break;
      }
      case `type`:
        break;
      default:
        c.push({ key: t.title, value: t.text, hidden: t.hidden });
    }
  return {
    type: `card`,
    name: t,
    notes: n,
    cardholderName: i,
    number: r,
    brand: g(r),
    expMonth: o,
    expYear: s,
    cvv: a,
    customFields: _(c),
  };
}
function Vn(e, t, n) {
  let r = In(e),
    i = r.find((e) => /PRIVATE KEY/.test(e.text))?.text ?? ``,
    a = r.find((e) => /^(ssh-|ecdsa-|sk-)/.test(e.text.trim()))?.text ?? ``,
    o = r
      .filter((e) => e.text !== i && e.text !== a)
      .map((e) => ({ key: e.title, value: e.text, hidden: e.hidden }));
  return !i && !a
    ? { type: `note`, name: t, notes: n, customFields: _(o) }
    : {
        type: `ssh-key`,
        name: t,
        notes: n,
        publicKey: a,
        privateKey: i,
        keyType: F(a, i),
        customFields: _(o),
      };
}
function Hn(e, t, n) {
  let r = In(e).map((e) => ({ key: e.title, value: e.text, hidden: e.hidden }));
  return { type: `note`, name: t, notes: n, customFields: _(r) };
}
function Un(e) {
  let t = [],
    n = (e) => {
      e?.documentId &&
        t.push({
          documentId: e.documentId,
          name: e.fileName?.trim() || `attachment`,
        });
    };
  n(e.details?.documentAttributes);
  for (let t of e.details?.sections ?? [])
    for (let e of t.fields ?? []) n(e.value?.file);
  return t;
}
function Wn(e) {
  let t = new Map();
  for (let [n, r] of Object.entries(e)) {
    let e = /(?:^|\/)files\/([^/_]+)_[^/]*$/.exec(n)?.[1];
    e && t.set(e, r);
  }
  return t;
}
function Gn(e) {
  let { data: t, files: n } = h(e, {
      findData: (e) =>
        e[`export.data`] ??
        Object.entries(e).find(([e]) => e.endsWith(`export.data`))?.[1],
      schema: kn,
      corruptError: `Couldn't read this .1pux file. It may be corrupt.`,
      formatError: An,
    }),
    r = Wn(n),
    i = Date.now(),
    a = [],
    o = [],
    s = 0;
  for (let e of t.accounts)
    for (let t of e.vaults ?? [])
      for (let e of t.items ?? []) {
        let t = e.overview?.title ?? ``,
          n = e.details?.notesPlain || void 0,
          c = w(e.overview?.tags),
          l;
        switch (e.categoryUuid) {
          case jn:
          case Nn:
            l = zn(e, t, n);
            break;
          case Mn:
            l = Bn(e, t, n);
            break;
          case Pn:
            l = Vn(e, t, n);
            break;
          default:
            l = Hn(e, t, n);
        }
        (c && (l = { ...l, tags: c }),
          e.state === `archived` &&
            (l = { ...l, archivedAt: e.updatedAt ? e.updatedAt * 1e3 : i }),
          a.push(l));
        for (let { documentId: t, name: n } of Un(e)) {
          let e = r.get(t);
          e
            ? o.push({
                entry: l,
                name: n,
                mime: wn(n),
                source: { kind: `blob`, blob: new Blob([e]) },
                size: e.length,
              })
            : s++;
        }
      }
  let c = [];
  return (s > 0 && c.push(y(s)), D(a, 0, c, o));
}
var Kn = 32;
function qn(e) {
  let t = new DataView(e.buffer, e.byteOffset, e.byteLength),
    n = new TextDecoder(`utf-8`, { fatal: !0 }),
    r = 0,
    i = (t) => {
      if (t > e.length - r) throw Error(`MessagePack value is truncated`);
      return ((r += t), r - t);
    },
    a = () => t.getUint8(i(1)),
    o = () => t.getUint16(i(2)),
    s = () => t.getUint32(i(4)),
    c = (e) => {
      let n = i(8),
        r = Number(e ? t.getBigInt64(n) : t.getBigUint64(n));
      if (!Number.isSafeInteger(r))
        throw Error(`MessagePack integer is out of range`);
      return r;
    },
    l = (t) => {
      let r = i(t);
      return n.decode(e.subarray(r, r + t));
    },
    u = (t) => {
      let n = i(t);
      return e.slice(n, n + t);
    },
    d = (e, t) => {
      let n = [];
      for (let r = 0; r < e; r++) n.push(p(t));
      return n;
    },
    f = (e, t) => {
      let n = new Map();
      for (let r = 0; r < e; r++) n.set(p(t), p(t));
      return n;
    };
  function p(e) {
    if (e > Kn) throw Error(`MessagePack value is nested too deeply`);
    let n = a();
    if (n <= 127) return n;
    if (n >= 224) return n - 256;
    if (n >= 160 && n <= 191) return l(n & 31);
    if (n >= 144 && n <= 159) return d(n & 15, e + 1);
    if (n >= 128 && n <= 143) return f(n & 15, e + 1);
    switch (n) {
      case 192:
        return null;
      case 194:
        return !1;
      case 195:
        return !0;
      case 196:
        return u(a());
      case 197:
        return u(o());
      case 198:
        return u(s());
      case 202:
        return t.getFloat32(i(4));
      case 203:
        return t.getFloat64(i(8));
      case 204:
        return a();
      case 205:
        return o();
      case 206:
        return s();
      case 207:
        return c(!1);
      case 208:
        return t.getInt8(i(1));
      case 209:
        return t.getInt16(i(2));
      case 210:
        return t.getInt32(i(4));
      case 211:
        return c(!0);
      case 217:
        return l(a());
      case 218:
        return l(o());
      case 219:
        return l(s());
      case 220:
        return d(o(), e + 1);
      case 221:
        return d(s(), e + 1);
      case 222:
        return f(o(), e + 1);
      case 223:
        return f(s(), e + 1);
      default:
        throw Error(`MessagePack value uses an unsupported type`);
    }
  }
  let m = p(0);
  if (r !== e.length) throw Error(`MessagePack value has trailing bytes`);
  return m;
}
var Jn = z({
    content: U(),
    rpName: U().nullish(),
    userName: U().nullish(),
    userDisplayName: U().nullish(),
    createTime: B().nullish(),
  }),
  Yn = 8192,
  Xn = 32,
  Zn = -1,
  Qn = -4,
  $n = 1,
  Z = (e, t) => (e instanceof Map ? e.get(t) : void 0),
  er = (e, t) => (Z(e, `t`) === t ? Z(e, `c`) : void 0),
  tr = (e) => typeof e == `number` && Number.isInteger(e) && e >= 0 && e <= 255;
function nr(e) {
  return e instanceof Uint8Array
    ? e
    : !Array.isArray(e) || !e.every(tr)
      ? null
      : Uint8Array.from(e);
}
function rr(e) {
  let t = nr(Z(e, `inner`));
  if (!t || t.length > 16) return null;
  let n = 0;
  for (let e = t.length - 1; e >= 0; e--) n = n * 256 + (t[e] ?? 0);
  return Number.isSafeInteger(n) ? n : null;
}
function ir(e) {
  let t = Z(e, `alg`);
  (er(Z(e, `kty`), `assign`) !== `EC2` ||
    (t != null && er(t, `assign`) !== `ES256`)) &&
    n(`uses a key type other than P-256`);
  let r = Z(e, `par`),
    i = null,
    a = null;
  for (let e of Array.isArray(r) ? r : []) {
    if (!Array.isArray(e)) continue;
    let t = er(e[0], `int`);
    (t === Zn && (i = rr(er(e[1], `int`))),
      t === Qn && (a = nr(er(e[1], `bytes`))));
  }
  return (
    i !== $n && n(`uses a key type other than P-256`),
    a?.length !== Xn && n(`has no private key`),
    a
  );
}
function ar(e, t, r) {
  let i = nr(e);
  return (
    i?.length || n(`has no ${t}`),
    i.length > r && n(`has a ${t} longer than the ${r}-byte maximum`),
    i
  );
}
function or(e) {
  e.length > Yn && n(`is larger than any Proton Pass passkey`);
  let t = qn(Ce(e));
  return (
    t instanceof Map || n(`couldn't be read`),
    t.get(`v`) !== 1 && n(`is in a newer Proton Pass format we can't read yet`),
    qn(nr(Z(t, `c`)) ?? n(`couldn't be read`))
  );
}
var sr = (e) => (typeof e == `string` && e ? e : void 0);
async function cr(e, i, a, o, s, c, u) {
  if (!e?.length) return;
  let d = [];
  for (let [f, p] of e.entries()) {
    let e = `"${i}" passkey ${f + 1}`,
      m = Jn.safeParse(p);
    if (!m.success) {
      c.push(`${e} had an unexpected shape and was skipped.`);
      continue;
    }
    let h = m.data,
      g,
      _;
    try {
      g = or(h.content);
      let e = Z(g, `rid`);
      ((typeof e == `string` && l(e)) || n(`has an invalid relying-party ID`),
        (_ = {
          credentialId: ar(Z(g, `cid`), `credential ID`, r),
          rpId: e,
          userHandle: ar(Z(g, `uhd`), `user handle`, ne),
          scalar: ir(Z(g, `key`)),
        }));
    } catch (t) {
      c.push(`${e} ${x(t) ?? `couldn't be read`}, so it was skipped.`);
      continue;
    }
    let v;
    try {
      let e = t(V(_.scalar));
      if (!e) throw Error(`not a P-256 scalar`);
      if (
        ((v = await s.passkeyImportPkcs8(Te(e))),
        !v.privateKey || !v.publicKeyCose)
      )
        throw Error(`empty converted key`);
    } catch {
      (c.push(`${e} has invalid private-key material and was skipped.`),
        u.failed++);
      continue;
    }
    let y =
        h.createTime != null && h.createTime > 0 ? h.createTime * 1e3 : void 0,
      b = Z(Z(g, `ext`), `hmac_secret`),
      C = b == null ? null : nr(Z(b, `cred_with_uv`)),
      w = C ? S(C, nr(Z(b, `cred_without_uv`))) : void 0;
    (u.converted++,
      d.push({
        credentialId: V(_.credentialId),
        rpId: _.rpId,
        rpName: h.rpName || void 0,
        userHandle: V(_.userHandle),
        userName: h.userName || sr(Z(g, `un`)),
        userDisplayName: h.userDisplayName || sr(Z(g, `udn`)),
        alg: v.alg,
        publicKeyCose: v.publicKeyCose,
        privateKey: v.privateKey,
        signCount: 0,
        createdAt: y ?? a ?? o,
        ...(w ? { prf: w } : {}),
      }));
    let ee = Z(g, `cnt`);
    (typeof ee == `number` &&
      ee !== 0 &&
      c.push(`${e} had its signature counter reset to zero.`),
      b != null &&
        !w &&
        c.push(
          `${e} had a PRF secret Bramble couldn't read, so it was left out. Signing in works, but a site that encrypted data with it can't decrypt that data.`,
        ),
      y === void 0 &&
        c.push(`${e} had no valid creation date; a fallback date was used.`));
  }
  return d.length ? d : void 0;
}
var lr = z({
    fieldName: U().nullish(),
    type: U().nullish(),
    data: z({ content: U().nullish() }).nullish(),
  }),
  ur = we({
    itemEmail: U().nullish(),
    itemUsername: U().nullish(),
    username: U().nullish(),
    password: U().nullish(),
    urls: H(U()).nullish(),
    autofillUrls: H(W()).nullish(),
    totpUri: U().nullish(),
    passkeys: H(W()).nullish(),
    cardholderName: U().nullish(),
    number: U().nullish(),
    verificationNumber: U().nullish(),
    expirationDate: U().nullish(),
    pin: U().nullish(),
  }),
  dr = z({
    state: B().nullish(),
    createTime: B().nullish(),
    aliasEmail: U().nullish(),
    shareId: U().nullish(),
    files: H(W()).nullish(),
    data: z({
      type: U().nullish(),
      metadata: z({ name: U().nullish(), note: U().nullish() }).nullish(),
      content: ur.nullish(),
      extraFields: H(lr).nullish(),
    }).nullish(),
  }),
  fr = z({
    vaults: xe(U(), z({ name: U().nullish(), items: H(dr).nullish() })),
  }),
  pr = z({ url: U(), mode: W() }),
  mr = `This doesn't look like a Proton Pass export.`,
  hr = 2,
  gr = 0,
  _r = 2,
  vr = `Never autofill on`;
function yr(e) {
  let t = { urls: [], never: [], ruled: 0 },
    n = new Set();
  for (let r of e.autofillUrls ?? []) {
    let e = pr.safeParse(r);
    if (!e.success || !e.data.url) continue;
    let { url: i, mode: a } = e.data;
    (n.add(i),
      a === _r
        ? t.never.push({ key: vr, value: i })
        : (t.urls.push(i), a != null && a !== gr && t.ruled++));
  }
  for (let r of e.urls ?? []) r && !n.has(r) && (n.add(r), t.urls.push(r));
  return t;
}
function br(e) {
  let t = 0;
  for (let n = 0; n < e.length; n++) t = ((t << 5) - t + e.charCodeAt(n)) | 0;
  return t;
}
var xr = (e) => e.replace(/[/\\]/g, `_`).trim();
function Sr(e, t) {
  if (!t) return e;
  let n = Math.abs(br(t)).toString(16),
    r = RegExp(`^(.*)\\.${n}[0-9a-f]+(\\.[^.]+)?$`).exec(e);
  return (r && `${r[1]}${r[2] ?? ``}`) || e;
}
function Cr(e) {
  return e
    ? e.map((e) => ({
        key: e.fieldName ?? ``,
        value: e.data?.content ?? ``,
        hidden: e.type === `hidden`,
      }))
    : [];
}
function wr(e) {
  if (!e) return { expMonth: ``, expYear: `` };
  if (e.includes(`-`)) {
    let [t, n] = e.split(`-`);
    return { expMonth: String(Number(n ?? ``)), expYear: t ?? `` };
  }
  return { expMonth: String(Number(e.slice(0, 2))), expYear: e.slice(2) };
}
async function Tr(e, t) {
  let { data: n, files: r } = h(e, {
      findData: (e) =>
        Object.entries(e).find(([e]) => e.endsWith(`data.json`))?.[1],
      schema: fr,
      corruptError: `Couldn't read this Proton Pass file. It may be corrupt.`,
      formatError: mr,
    }),
    i = [],
    a = [],
    s = Date.now(),
    c = { converted: 0, failed: 0 },
    l =
      Object.keys(r)
        .find((e) => e.endsWith(`data.json`))
        ?.slice(0, -9) ?? ``,
    u = [],
    d = 0,
    f = 0,
    p = 0;
  for (let e of Object.values(n.vaults)) {
    let n = w([e.name]);
    for (let o of e.items ?? []) {
      if (o.state === hr) continue;
      let e = o.data ?? {},
        m = e.metadata?.name ?? ``,
        h = e.metadata?.note || void 0,
        v = e.content ?? {},
        y = Cr(e.extraFields),
        b = e.extraFields?.find((e) => e.type === `totp`)?.data?.content,
        x;
      switch (e.type) {
        case `login`:
        case `alias`: {
          let e = o.createTime ? o.createTime * 1e3 : void 0,
            r = await cr(v.passkeys, m, e, s, t, a, c),
            i =
              v.itemUsername || v.username || v.itemEmail || o.aliasEmail || ``,
            l = v.itemEmail,
            u = l && l !== i ? [{ key: `email`, value: l }] : [],
            { urls: d, never: g, ruled: S } = yr(v);
          ((f += S),
            (p += g.length),
            (x = {
              type: `login`,
              name: m,
              notes: h,
              tags: n,
              urls: d,
              ...(S > 0 ? { subdomainMatch: `exact` } : {}),
              username: i,
              password: v.password ?? ``,
              totp: v.totpUri || b || void 0,
              customFields: _([
                ...u,
                ...g,
                ...y.filter((e) => e.value !== (v.totpUri || b)),
              ]),
              passkeys: r,
            }));
          break;
        }
        case `creditCard`: {
          let { expMonth: e, expYear: t } = wr(v.expirationDate),
            r = v.number ?? ``,
            i = v.pin ? [{ key: `PIN`, value: v.pin, hidden: !0 }] : [];
          x = {
            type: `card`,
            name: m,
            notes: h,
            tags: n,
            cardholderName: v.cardholderName ?? ``,
            number: r,
            brand: g(r),
            expMonth: e,
            expYear: t,
            cvv: v.verificationNumber ?? ``,
            customFields: _([...i, ...y]),
          };
          break;
        }
        case `note`:
          x = { type: `note`, name: m, notes: h, tags: n, customFields: _(y) };
          break;
        default:
          x = {
            type: `note`,
            name: m,
            notes: h,
            tags: n,
            customFields: _([
              ...Object.entries(v).map(([e, t]) => ({
                key: e,
                value: typeof t == `string` ? t : ``,
              })),
              ...y,
            ]),
          };
      }
      i.push(x);
      for (let e of o.files ?? []) {
        let t = typeof e == `string` ? xr(e) : ``,
          n = t ? r[`${l}files/${t}`] : void 0;
        if (!n) {
          d++;
          continue;
        }
        let i = Sr(t, o.shareId);
        u.push({
          entry: x,
          name: i,
          mime: wn(i),
          source: { kind: `blob`, blob: new Blob([n]) },
          size: n.length,
        });
      }
    }
  }
  (f > 0 &&
    a.push(
      `${f} website(s) had a Proton autofill rule Bramble doesn't have, so their logins now match the exact site only.`,
    ),
    p > 0 &&
      a.push(
        `${p} website(s) were set to never autofill in Proton, so they're kept in a "${vr}" field instead of the login's websites.`,
      ),
    d > 0 && a.push(y(d)));
  let m = o(c, `export`);
  return (m && a.push(m), D(i, 0, a, u));
}
var Er = /^([^,]*),[^,]*,[^,]*,([^,]*),([\s\S]*)$/;
function Dr(e) {
  return e.replace(/^'(?=[=+\-@'])/, ``);
}
function Or(e, t, n) {
  let r,
    i = [];
  for (let a of e) {
    let e = Er.exec(a);
    if (!e) {
      i.push({ key: `Field`, value: a });
      continue;
    }
    let [, o = ``, s = ``, c = ``] = e,
      l = Dr(c);
    if (o === `TOTP KEY$` && !r) r = l;
    else if (o === `User ID$`) l !== t && i.push({ key: `Username`, value: l });
    else if (o === `Password$`)
      l !== n && i.push({ key: `Password`, value: l, hidden: !0 });
    else {
      let e = o && o !== `-no-name-` ? o : `Field`;
      i.push({ key: e, value: l, hidden: s === `pwd` || void 0 });
    }
  }
  return { totp: r, extras: i };
}
function kr(e) {
  let t = v(E(e)),
    n = q(t[0]);
  J(Pe, n);
  let r = (...e) => n.findIndex((t) => e.includes(t)),
    i = {
      name: r(`name`),
      url: r(`url`),
      matchUrl: r(`matchurl`),
      login: r(`login`),
      password: r(`pwd`, `password`),
      note: r(`note`),
      folder: r(`folder`),
      fields: r(`rffieldsv2`, `rf_fields`),
    },
    a = (e, t) => (t === -1 ? `` : (e[t] ?? ``)),
    o = [],
    s = 0,
    c = 0;
  for (let e of t.slice(1)) {
    let t = a(e, i.name).trim(),
      n = a(e, i.url),
      r = a(e, i.matchUrl),
      l = Dr(a(e, i.login)),
      u = Dr(a(e, i.password)),
      d = a(e, i.note) || void 0,
      f = i.fields === -1 ? [] : e.slice(i.fields).filter(Boolean),
      p = w(a(e, i.folder).split(`/`)),
      m;
    if (r || l || u || f.length > 0) {
      let { totp: e, extras: i } = Or(f, l, u),
        a = [...new Set([n, r].filter(Boolean))];
      m = {
        type: `login`,
        name: t || C(a[0] ?? ``) || l,
        notes: d,
        urls: a,
        username: l,
        password: u,
        totp: e,
        customFields: _(i),
        tags: p,
      };
    } else if (n)
      m = {
        type: `note`,
        name: t || C(n),
        notes: d,
        customFields: _([{ key: `URL`, value: n }]),
        tags: p,
      };
    else if (t || d) m = { type: `note`, name: t, notes: d, tags: p };
    else {
      s++;
      continue;
    }
    (p && c++, o.push(m));
  }
  let l = [];
  return (
    c > 0 &&
      l.push(`${c} item(s) were in a RoboForm folder, imported as tags.`),
    D(o, s, l)
  );
}
async function Ar(e, t) {
  let n = [],
    r = { converted: 0, failed: 0 },
    i = Date.now(),
    a = [],
    s = [],
    c = 0;
  for (let o of e.entries) {
    let l = await sn(
      o.strings.map((e) => ({
        key: e.key,
        value: e.value,
        hidden: e.protected,
      })),
      t,
      i,
      n,
      r,
    );
    a.push(l);
    for (let t of o.binaries ?? []) {
      let n = e.attachments[t.index];
      if (!n) {
        c++;
        continue;
      }
      let r = t.name.trim() || `attachment`;
      s.push({ entry: l, name: r, mime: wn(r), ...n });
    }
  }
  let l = o(r, `database`);
  return (
    l && n.push(l),
    c > 0 &&
      n.push(
        `${c} attachment(s) are named in this database but not stored in it.`,
      ),
    D(a, 0, n, s)
  );
}
var jr = {
    bitwarden: rt,
    onepassword: Gn,
    protonpass: Tr,
    keepass: ln,
    lastpass: Sn,
    dashlane: Tt,
    enpass: zt,
    aliasvault: We,
    roboform: kr,
    apple: st,
    google: ct,
  },
  Mr = [
    {
      id: `credential-exchange`,
      label: `Another app on this device`,
      blurb: `Passwords, passkeys and codes, with no file in between`,
      viaSystem: !0,
    },
    {
      id: `bramble`,
      label: `Bramble (.bramble)`,
      blurb: `An export from another Bramble vault, passkeys included`,
      accept: `.bramble`,
      reads: `bytes`,
      needsCredential: !0,
    },
    {
      id: `bitwarden`,
      label: `Bitwarden`,
      blurb: `Unencrypted .json export`,
      accept: `.json,application/json`,
      reads: `text`,
    },
    {
      id: `onepassword`,
      label: `1Password`,
      blurb: `.1pux export`,
      accept: `.1pux,.zip`,
      reads: `bytes`,
    },
    {
      id: `protonpass`,
      label: `Proton Pass`,
      blurb: `Unencrypted .zip export, with file attachments turned on`,
      accept: `.zip`,
      reads: `bytes`,
    },
    {
      id: `lastpass`,
      label: `LastPass`,
      blurb: `Unencrypted .csv export`,
      accept: `.csv,text/csv`,
      reads: `text`,
    },
    {
      id: `dashlane`,
      label: `Dashlane`,
      blurb: `Unencrypted CSV export (.zip)`,
      accept: `.zip,.csv,text/csv`,
      reads: `bytes`,
    },
    {
      id: `enpass`,
      label: `Enpass`,
      blurb: `Unencrypted .json export`,
      accept: `.json,application/json`,
      reads: `text`,
    },
    {
      id: `roboform`,
      label: `RoboForm`,
      blurb: `Account & Data → Export (.csv, no identities or cards)`,
      accept: `.csv,text/csv`,
      reads: `text`,
    },
    {
      id: `aliasvault`,
      label: `AliasVault`,
      blurb: `Import / Export → Export to CSV (no passkeys or attachments)`,
      accept: `.csv,text/csv`,
      reads: `text`,
    },
    {
      id: `keepass`,
      label: `KeePass (XML)`,
      blurb: `File → Export → KeePass 2.x XML`,
      accept: `.xml,text/xml,application/xml`,
      reads: `text`,
    },
    {
      id: `keepass-kdbx`,
      label: `KeePass (.kdbx)`,
      blurb: `Encrypted .kdbx database (KDBX4)`,
      accept: `.kdbx`,
      reads: `bytes`,
      needsCredential: !0,
    },
    {
      id: `apple`,
      label: `Apple Passwords`,
      blurb: `Passwords → Export All Passwords (.csv)`,
      accept: `.csv,text/csv`,
      reads: `text`,
    },
    {
      id: `google`,
      label: `Google Password Manager`,
      blurb: `passwords.google.com → Export (.csv)`,
      accept: `.csv,text/csv`,
      reads: `text`,
    },
  ];
function Nr(e, t, n) {
  return jr[e](t, n);
}
function Pr(e, t, n) {
  let r = b(e, n),
    i = new Map(e.map((e, t) => [e, r[t] ?? e]));
  return {
    items: r,
    attachments: t.map((e) =>
      `item` in e.onto
        ? { ...e, onto: { item: i.get(e.onto.item) ?? e.onto.item } }
        : e,
    ),
  };
}
var Q = j();
function Fr({ subtitle: e }) {
  return (0, Q.jsxs)(`div`, {
    className: `text-center mb-6`,
    children: [
      (0, Q.jsx)(`div`, {
        className: `inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary/80 mb-3`,
        children: (0, Q.jsx)(ke, {
          className: `w-7 h-7 text-primary-foreground`,
        }),
      }),
      (0, Q.jsx)(`h1`, {
        className: `text-2xl`,
        children: (0, Q.jsx)(A, { id: `CKnl_-` }),
      }),
      (0, Q.jsx)(`p`, {
        className: `text-sm text-muted-foreground mt-1`,
        children: e,
      }),
    ],
  });
}
function $({ children: e, onClose: t }) {
  let { _: n } = ae();
  return (0, Q.jsxs)(`div`, {
    className: `relative min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-6`,
    children: [
      t &&
        (0, Q.jsx)(M, {
          variant: `ghost`,
          size: `icon`,
          onClick: t,
          "aria-label": n({ id: `c2EYjZ` }),
          className: `absolute top-4 right-4 z-10 text-muted-foreground hover:text-foreground`,
          children: (0, Q.jsx)(ye, { className: `w-4 h-4` }),
        }),
      (0, Q.jsx)(`div`, { className: `w-full max-w-xl`, children: e }),
    ],
  });
}
function Ir({
  providerLabel: e,
  passwordLabel: t,
  allowKeyfile: n = !0,
  onOpen: r,
  onBack: i,
}) {
  let { _: a } = ae(),
    { shell: o } = se(),
    [s, c] = (0, G.useState)(``),
    [l, u] = (0, G.useState)(null),
    [d, f] = (0, G.useState)(null),
    [p, m] = (0, G.useState)(!1);
  return (0, Q.jsxs)($, {
    children: [
      (0, Q.jsx)(Fr, {
        subtitle: a({ id: `YTaeMK`, values: { providerLabel: e } }),
      }),
      (0, Q.jsxs)(`form`, {
        onSubmit: async (e) => {
          (e.preventDefault(), f(null), m(!0));
          try {
            let e = l ? V(new Uint8Array(await l.arrayBuffer())) : void 0;
            await r(s, e);
          } catch (e) {
            f(e instanceof Error ? e.message : a({ id: `_ftR_p` }));
          } finally {
            m(!1);
          }
        },
        className: `rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm p-6 space-y-4`,
        children: [
          (0, Q.jsx)(le, {
            label: t,
            autoFocus: !0,
            value: s,
            onChange: (e) => c(e.target.value),
            error: d ?? void 0,
          }),
          n &&
            (0, Q.jsxs)(`label`, {
              className: `flex flex-col gap-3`,
              children: [
                (0, Q.jsx)(`span`, {
                  className: `text-sm`,
                  children: (0, Q.jsx)(A, { id: `FmVCoo` }),
                }),
                (0, Q.jsx)(`input`, {
                  type: `file`,
                  onClick: () => o.notifyFilePickerOpening?.(),
                  onChange: (e) => u(e.currentTarget.files?.[0] ?? null),
                  className: `block w-full text-xs text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background/50 file:px-3 file:py-1.5 file:text-sm hover:file:bg-background/80`,
                }),
              ],
            }),
          (0, Q.jsxs)(`div`, {
            className: `flex items-center justify-between gap-3`,
            children: [
              (0, Q.jsxs)(M, {
                variant: `secondary`,
                size: `none`,
                onClick: i,
                disabled: p,
                className: `px-4 py-2 text-sm hover:bg-background/50`,
                children: [
                  (0, Q.jsx)(fe, { className: `w-3.5 h-3.5` }),
                  (0, Q.jsx)(A, { id: `iH8pgl` }),
                ],
              }),
              (0, Q.jsx)(M, {
                type: `submit`,
                variant: `primary`,
                size: `md`,
                disabled: p || (!s && !l),
                children: p
                  ? (0, Q.jsxs)(Q.Fragment, {
                      children: [
                        (0, Q.jsx)(_e, {
                          className: `w-3.5 h-3.5 animate-spin`,
                        }),
                        (0, Q.jsx)(A, { id: `598XO1` }),
                      ],
                    })
                  : a({ id: `xcQiVh` }),
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
function Lr({ onUnlock: e }) {
  let { _: t } = ae(),
    [n, r] = (0, G.useState)(``),
    [i, a] = (0, G.useState)(null),
    [o, s] = (0, G.useState)(!1);
  return (0, Q.jsxs)($, {
    children: [
      (0, Q.jsx)(Fr, { subtitle: t({ id: `nO734_` }) }),
      (0, Q.jsxs)(`form`, {
        onSubmit: async (r) => {
          (r.preventDefault(), a(null), s(!0));
          try {
            await e(n);
          } catch (e) {
            a(e instanceof Error ? e.message : t({ id: `TxjPAE` }));
          } finally {
            s(!1);
          }
        },
        className: `rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm p-6 space-y-4`,
        children: [
          (0, Q.jsx)(le, {
            label: t({ id: `xvo56c` }),
            autoFocus: !0,
            value: n,
            onChange: (e) => r(e.target.value),
            error: i ?? void 0,
          }),
          (0, Q.jsx)(M, {
            type: `submit`,
            variant: `primary`,
            size: `none`,
            fullWidth: !0,
            disabled: o || !n,
            className: `px-5 py-2.5 text-sm`,
            children: t(o ? { id: `VHPcrL` } : { id: `VAOn4r` }),
          }),
        ],
      }),
    ],
  });
}
function Rr(e, t = 0) {
  let n = Object.entries(e.byType).map(
      ([e, t]) => `${t} ${I(e).label}${t === 1 ? `` : `s`}`,
    ),
    r = e.imported.reduce(
      (e, t) => e + (t.type === `login` ? (t.passkeys?.length ?? 0) : 0),
      0,
    );
  return (
    r > 0 && n.push(P._({ id: `XCJWmZ`, values: { passkeys: r } })),
    t > 0 && n.push(P._({ id: `SMDmmd`, values: { attachments: t } })),
    n.join(` · `) || P._({ id: `JBwL_0` })
  );
}
function zr(e) {
  let t = e instanceof Error ? e.message : String(e);
  if (t.includes(`KDBX_WRONG_CREDENTIAL`))
    return `Wrong master password or key file.`;
  if (t.includes(`KDBX_UNSUPPORTED_VERSION`))
    return `Only KeePass KDBX4 databases are supported. Re-save it as KDBX4, or export to XML.`;
  if (t.includes(`KDBX_UNSUPPORTED_CIPHER`))
    return `This database uses an unsupported cipher (only AES-256 and ChaCha20 are supported).`;
  if (t.includes(`KDBX_UNSUPPORTED_KDF`))
    return `This database uses an unsupported key-derivation function. Re-save it with Argon2 in KeePass.`;
  let n = /KDBX_KDF_TOO_EXPENSIVE:(\d+)KiB\/(\d+)/.exec(t);
  return n
    ? `This database's key-derivation settings (${n[1]} KiB of memory over ${n[2]} rounds) are heavier than Bramble will attempt. Lower them in KeePassXC's database settings and save it again.`
    : t.includes(`KDBX_KDF_TOO_EXPENSIVE`)
      ? `This database's key-derivation settings are heavier than Bramble will attempt. Lower the Argon2 memory or rounds in KeePassXC and save it again.`
      : t.includes(`KDBX_UNSUPPORTED_STREAM`)
        ? `This database uses an unsupported inner cipher.`
        : t.includes(`KDBX_NOT_KEEPASS`)
          ? `This doesn't look like a KeePass .kdbx file.`
          : t.includes(`KDBX_CORRUPT`)
            ? `This .kdbx file appears to be damaged.`
            : `Couldn't open this database.`;
}
var Br = 50,
  Vr = Br * 1024 * 1024;
function Hr({ onClose: e } = {}) {
  let {
      ready: t,
      hasVault: n,
      isLocked: r,
      unlock: i,
      importEntries: a,
      entries: o,
      files: s,
      describeFile: c,
    } = ee(),
    { shell: l, crypto: d, exchange: f } = se(),
    { vaults: h, selectVault: g } = oe(),
    { _ } = ae(),
    [v, y] = (0, G.useState)(null),
    [b, x] = (0, G.useState)(null),
    [S, C] = (0, G.useState)(null),
    [w, T] = (0, G.useState)(0),
    [E, D] = (0, G.useState)(``),
    [ne, O] = (0, G.useState)(null),
    [k, j] = (0, G.useState)(!1),
    [N, le] = (0, G.useState)(null),
    [P, F] = (0, G.useState)([]),
    I = De(),
    [ye, xe] = (0, G.useState)(0),
    L = (0, G.useRef)(null),
    R = (0, G.useCallback)(() => {
      let e = L.current;
      ((L.current = null), e?.().catch(() => {}));
    }, []);
  ((0, G.useEffect)(() => R, [R]),
    (0, G.useEffect)(() => {
      r && L.current && (R(), x(null), y(null), F([]), O(_({ id: `Esby7g` })));
    }, [r, R, _]));
  let Se = me(),
    z = ge(Se),
    B = Mr.filter((e) => !e.viaSystem || f),
    [V, we] = (0, G.useState)(null),
    [Te, H] = (0, G.useState)(!1),
    U = V === !0 && h.length > 1 && !Te;
  (0, G.useEffect)(() => {
    f &&
      f
        .hasPendingImport()
        .then(we)
        .catch(() => we(!1));
  }, [f]);
  let W = (0, G.useMemo)(
      () => ({ passkeyImportPkcs8: (e) => d.passkeyImportPkcs8(e) }),
      [d],
    ),
    [Ee, ke] = (0, G.useState)(0),
    [Ae, je] = (0, G.useState)([]),
    [Me, Ne] = (0, G.useState)(0),
    Pe = (0, G.useRef)(null),
    K = (0, G.useCallback)(
      (e, t = []) => {
        let n = m(o, e.imported);
        ((Pe.current = e),
          ke(n.duplicates),
          je(n.likelyDuplicates),
          Ne(n.passwordDiffers),
          F(t),
          xe(I ? 0 : (e.attachments?.length ?? 0)));
        let r = n.fresh.length + n.likelyDuplicates.length + t.length;
        return (
          r > 0 && x({ ...e, imported: n.fresh, byType: re(n.fresh) }),
          r
        );
      },
      [o, I],
    ),
    Fe = (0, G.useCallback)(
      async (e, t = !1) => {
        if (!I) return [];
        let { sameAs: n, resembles: r } = m(o, e.imported),
          i = [];
        for (let { entry: a, ...o } of e.attachments ?? []) {
          let e = n.get(a) ?? a;
          if (
            (typeof e != `string` && !t && (e = r.get(e) ?? e),
            typeof e != `string`)
          ) {
            i.push({ ...o, onto: { item: e } });
            continue;
          }
          let l = !1;
          for (let t of s)
            if (
              t.entryId === e &&
              p(t.size) === o.size &&
              (await c(t).catch(() => null))?.name === o.name
            ) {
              l = !0;
              break;
            }
          l || i.push({ ...o, onto: { entryId: e } });
        }
        return i;
      },
      [o, s, c, I],
    ),
    q = (e) =>
      !I && e.attachments?.length ? _({ id: `9dh_kO` }) : _({ id: `E0UxUk` }),
    Ie = async () => {
      (x((e) => {
        if (!e) return e;
        let t = [...e.imported, ...Ae];
        return { ...e, imported: t, byType: re(t) };
      }),
        je([]),
        Pe.current?.attachments?.length && F(await Fe(Pe.current, !0)));
    },
    J = (0, G.useRef)(!1);
  if (
    ((0, G.useEffect)(() => {
      f &&
        t &&
        !r &&
        !J.current &&
        (V === null ||
          U ||
          ((J.current = !0),
          (async () => {
            j(!0);
            try {
              let e = await u(f, W),
                t = Mr.find((e) => e.viaSystem);
              e && e.imported.length > 0 && t && K(e) > 0 && y(t);
            } catch {
            } finally {
              j(!1);
            }
          })()));
    }, [f, t, r, V, U, W, K]),
    !t)
  )
    return (0, Q.jsx)($, {
      onClose: e,
      children: (0, Q.jsx)(`div`, {
        className: `flex justify-center py-12`,
        children: (0, Q.jsx)(_e, {
          className: `w-6 h-6 animate-spin text-muted-foreground`,
        }),
      }),
    });
  if (U)
    return (0, Q.jsxs)($, {
      onClose: e,
      children: [
        (0, Q.jsx)(Fr, { subtitle: _({ id: `Gqapjo` }) }),
        (0, Q.jsx)(Oe, {
          onSelect: (e) => {
            (g(e), H(!0));
          },
        }),
      ],
    });
  if (!n)
    return (0, Q.jsxs)($, {
      onClose: e,
      children: [
        (0, Q.jsx)(Fr, { subtitle: _({ id: `OZXyTK` }) }),
        (0, Q.jsxs)(`div`, {
          className: `rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm p-6 text-center space-y-4`,
          children: [
            (0, Q.jsx)(`p`, {
              className: `text-sm text-muted-foreground`,
              children: (0, Q.jsx)(A, {
                id: `pPC-I0`,
                values: { 0: l.appName },
              }),
            }),
            (0, Q.jsx)(M, {
              variant: `primary`,
              size: `none`,
              onClick: () => window.location.assign(window.location.pathname),
              className: `px-5 py-2.5 text-sm`,
              children: (0, Q.jsx)(A, { id: `oooLt1` }),
            }),
          ],
        }),
      ],
    });
  if (r) return (0, Q.jsx)(Lr, { onUnlock: i });
  if (S !== null)
    return (0, Q.jsx)($, {
      onClose: e,
      children: (0, Q.jsxs)(`div`, {
        className: `rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm p-8 text-center space-y-3`,
        children: [
          (0, Q.jsx)(`div`, {
            className: `inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-linear-to-br from-primary to-primary/80`,
            children: (0, Q.jsx)(ve, {
              className: `w-7 h-7 text-primary-foreground`,
            }),
          }),
          (0, Q.jsx)(`h1`, {
            className: `text-2xl`,
            children:
              S > 0
                ? (0, Q.jsx)(A, { id: `jI0vO6`, values: { imported: S } })
                : (0, Q.jsx)(A, { id: `zNY20L`, values: { importedFiles: w } }),
          }),
          S > 0 &&
            (0, Q.jsx)(`p`, {
              className: `text-sm`,
              children: (0, Q.jsx)(A, {
                id: `tvPOkN`,
                values: { importedTag: E },
              }),
            }),
          S > 0 &&
            w > 0 &&
            (0, Q.jsx)(`p`, {
              className: `text-sm`,
              children: (0, Q.jsx)(A, {
                id: `kOSJsM`,
                values: { importedFiles: w },
              }),
            }),
          (0, Q.jsx)(`p`, {
            className: `text-sm text-muted-foreground`,
            children: v?.viaSystem
              ? (0, Q.jsx)(A, { id: `daKRXd` })
              : (0, Q.jsx)(A, { id: `oLTv48` }),
          }),
          e &&
            (0, Q.jsx)(M, {
              variant: `primary`,
              size: `none`,
              onClick: e,
              className: `px-5 py-2.5 text-sm`,
              children: (0, Q.jsx)(A, { id: `DPfwMq` }),
            }),
        ],
      }),
    });
  let Y = async (e, t) => {
      if (t) {
        (O(null), j(!0));
        try {
          if (t.size > Vr) {
            let e = (t.size / 1024 / 1024).toFixed(1);
            O(
              _({
                id: `G85ujI`,
                values: { sizeMb: e, MAX_IMPORT_FILE_MB: Br },
              }),
            );
            return;
          }
          if (e.needsCredential) {
            le({ provider: e, file: new Uint8Array(await t.arrayBuffer()) });
            return;
          }
          let n =
              e.reads === `text`
                ? await t.text()
                : new Uint8Array(await t.arrayBuffer()),
            r = await Nr(e.id, n, W);
          if (r.imported.length === 0) {
            let e = r.skipped === 1 ? _({ id: `_uUlFU` }) : _({ id: `hgr8eo` });
            O(
              r.skipped > 0
                ? _({ id: `7hQ1mb`, values: { 0: r.skipped, noun: e } })
                : _({ id: `7OyZeI` }),
            );
            return;
          }
          if (K(r, await Fe(r)) === 0) {
            O(q(r));
            return;
          }
          y(e);
        } catch (e) {
          O(e instanceof Error ? e.message : _({ id: `QUsKY4` }));
        } finally {
          j(!1);
        }
      }
    },
    Le = async (e) => {
      if (f) {
        (O(null), j(!0));
        try {
          let t = await u(f, W);
          if (!t) {
            O(_({ id: `W_TUFE`, values: { 0: l.appName } }));
            return;
          }
          if (t.imported.length === 0) {
            O(_({ id: `sslfjj` }));
            return;
          }
          if (K(t) === 0) {
            O(_({ id: `cBhpqd` }));
            return;
          }
          y(e);
        } catch (e) {
          O(e instanceof Error ? e.message : _({ id: `wkMaSJ` }));
        } finally {
          j(!1);
        }
      }
    },
    Re = async (e, t) => {
      if (N) {
        try {
          let n = N.provider.id === `bramble` ? await Be(e) : await ze(e, t);
          if (n.imported.length === 0) throw Error(_({ id: `-7IXyx` }));
          if (K(n, await Fe(n)) === 0) throw Error(q(n));
        } catch (e) {
          throw (R(), e);
        }
        (y(N.provider), le(null));
      }
    },
    ze = async (e, t) => {
      if (!N) throw Error(`no pending file`);
      try {
        let n = await d.openKdbx({
          file: N.file,
          password: e,
          keyfile: t ? Ce(t) : void 0,
        });
        return ((L.current = n.release), await Ar(n, W));
      } catch (e) {
        throw Error(zr(e));
      }
    },
    Be = async (e) => {
      if (!N) throw Error(`no pending file`);
      let t = _({ id: `X51Xe1` }),
        n = N.file;
      if (await ie(n)) throw Error(t);
      let r = ce(n);
      if (!r) throw Error(_({ id: `jT1S76` }));
      let i;
      try {
        i = await ue(d, r, e);
      } catch (e) {
        throw e instanceof Error &&
          e.message === `That's a full vault backup. Restore it instead.`
          ? Error(t)
          : e;
      }
      if (i === null) throw Error(_({ id: `vCA9WO` }));
      return { imported: i, byType: re(i), skipped: 0, warnings: [] };
    };
  return b && v
    ? (0, Q.jsxs)($, {
        onClose: e,
        children: [
          (0, Q.jsx)(Fr, {
            subtitle: _({ id: `crj-QE`, values: { 0: v.label } }),
          }),
          (0, Q.jsxs)(`div`, {
            className: `rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden`,
            children: [
              (0, Q.jsxs)(`div`, {
                className: `p-4 space-y-3`,
                children: [
                  (0, Q.jsxs)(`div`, {
                    className: `flex items-center gap-2.5`,
                    children: [
                      (0, Q.jsx)(be, {
                        className: `w-5 h-5 text-primary shrink-0`,
                      }),
                      (0, Q.jsx)(`p`, {
                        className: `text-sm`,
                        children:
                          b.imported.length > 0
                            ? (0, Q.jsx)(A, {
                                id: `PcwndO`,
                                values: { 0: b.imported.length },
                                components: {
                                  0: (0, Q.jsx)(`span`, {
                                    className: `text-base`,
                                  }),
                                },
                              })
                            : (0, Q.jsx)(A, { id: `cxNByk` }),
                      }),
                    ],
                  }),
                  b.imported.length > 0 &&
                    (0, Q.jsx)(`p`, {
                      className: `text-xs text-muted-foreground`,
                      children: Rr(b, P.filter((e) => `item` in e.onto).length),
                    }),
                  (0, Q.jsx)(Ur, { placed: P }),
                  ye > 0 &&
                    (0, Q.jsx)(`p`, {
                      className: `text-xs text-muted-foreground`,
                      children: (0, Q.jsx)(A, {
                        id: `WcvquZ`,
                        values: { skippedFiles: ye },
                      }),
                    }),
                  Ee > 0 &&
                    (0, Q.jsx)(`p`, {
                      className: `text-xs text-muted-foreground`,
                      children: (0, Q.jsx)(A, {
                        id: `uDH2iH`,
                        values: { duplicates: Ee },
                      }),
                    }),
                  Ae.length > 0 &&
                    (0, Q.jsxs)(`div`, {
                      className: `space-y-2`,
                      children: [
                        (0, Q.jsx)(`p`, {
                          className: `text-xs text-muted-foreground`,
                          children: (0, Q.jsx)(A, {
                            id: `Kl7Mb_`,
                            values: { 0: Ae.length },
                          }),
                        }),
                        (0, Q.jsx)(M, {
                          variant: `secondary`,
                          size: `sm`,
                          onClick: Ie,
                          disabled: k,
                          children: (0, Q.jsx)(A, { id: `X-5hEu` }),
                        }),
                      ],
                    }),
                  Me > 0 &&
                    (0, Q.jsx)(`p`, {
                      className: `text-xs text-muted-foreground`,
                      children: (0, Q.jsx)(A, {
                        id: `FWYDOh`,
                        values: { passwordDiffers: Me },
                      }),
                    }),
                  b.warnings.length > 0 &&
                    (0, Q.jsxs)(`ul`, {
                      className: `text-xs text-warning space-y-1 list-disc pl-4`,
                      children: [
                        b.warnings
                          .slice(0, 8)
                          .map((e) => (0, Q.jsx)(`li`, { children: e }, e)),
                        b.warnings.length > 8 &&
                          (0, Q.jsx)(`li`, {
                            children: (0, Q.jsx)(A, {
                              id: `tdiulg`,
                              values: { 0: b.warnings.length - 8 },
                            }),
                          }),
                      ],
                    }),
                  ne &&
                    (0, Q.jsx)(`p`, {
                      className: `text-xs text-destructive`,
                      children: ne,
                    }),
                ],
              }),
              (0, Q.jsxs)(`div`, {
                className: `p-4 bg-muted/30 border-t border-border/50 flex items-center justify-between gap-3`,
                children: [
                  (0, Q.jsxs)(M, {
                    variant: `secondary`,
                    size: `none`,
                    onClick: () => {
                      (R(), x(null), F([]), y(null), O(null));
                    },
                    disabled: k,
                    className: `px-4 py-2 text-sm hover:bg-background/50`,
                    children: [
                      (0, Q.jsx)(fe, { className: `w-3.5 h-3.5` }),
                      (0, Q.jsx)(A, { id: `0KHIyx` }),
                    ],
                  }),
                  (0, Q.jsx)(M, {
                    variant: `primary`,
                    size: `md`,
                    onClick: async () => {
                      if (b) {
                        (j(!0), O(null));
                        try {
                          let e = new Date(),
                            t = Pr(b.imported, P, e);
                          (await a(t.items, t.attachments),
                            D(te(e)),
                            C(b.imported.length),
                            T(P.length),
                            R());
                        } catch (e) {
                          O(
                            e instanceof Error
                              ? e.message
                              : _({ id: `1UlvvN` }),
                          );
                        } finally {
                          j(!1);
                        }
                      }
                    },
                    disabled: k || (b.imported.length === 0 && P.length === 0),
                    children: k
                      ? (0, Q.jsxs)(Q.Fragment, {
                          children: [
                            (0, Q.jsx)(_e, {
                              className: `w-3.5 h-3.5 animate-spin`,
                            }),
                            (0, Q.jsx)(A, { id: `skj9zM` }),
                          ],
                        })
                      : b.imported.length > 0
                        ? (0, Q.jsx)(A, {
                            id: `hdSJsM`,
                            values: { 0: b.imported.length },
                          })
                        : (0, Q.jsx)(A, {
                            id: `YsuGNX`,
                            values: { 0: P.length },
                          }),
                  }),
                ],
              }),
            ],
          }),
        ],
      })
    : N
      ? (0, Q.jsx)(Ir, {
          providerLabel: N.provider.label,
          passwordLabel:
            N.provider.id === `bramble`
              ? _({ id: `7mqbMA` })
              : _({ id: `DEzfDT` }),
          allowKeyfile: N.provider.id !== `bramble`,
          onOpen: Re,
          onBack: () => {
            (le(null), O(null));
          },
        })
      : (0, Q.jsxs)($, {
          onClose: e,
          children: [
            (0, Q.jsx)(Fr, { subtitle: _({ id: `ftO2zH` }) }),
            (0, Q.jsx)(`div`, {
              className: `space-y-2.5`,
              children: B.map((e) =>
                e.viaSystem
                  ? (0, Q.jsxs)(
                      `button`,
                      {
                        type: `button`,
                        disabled: k || z !== null,
                        onClick: () => void Le(e),
                        className: `w-full flex items-center gap-3 p-4 rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm text-left hover:border-border hover:bg-card/80 active:scale-[0.99] transition-all disabled:opacity-60`,
                        children: [
                          (0, Q.jsx)(`div`, {
                            className: `flex items-center justify-center w-10 h-10 rounded-lg bg-linear-to-br from-primary/20 to-primary/10 shrink-0`,
                            children: (0, Q.jsx)(pe, {
                              className: `w-4 h-4 text-primary`,
                            }),
                          }),
                          (0, Q.jsxs)(`div`, {
                            className: `min-w-0 flex-1`,
                            children: [
                              (0, Q.jsx)(`p`, {
                                className: `text-sm`,
                                children: e.label,
                              }),
                              (0, Q.jsx)(`p`, {
                                className: `text-xs text-muted-foreground`,
                                children: z ?? e.blurb,
                              }),
                            ],
                          }),
                        ],
                      },
                      e.id,
                    )
                  : (0, Q.jsx)(
                      de,
                      {
                        accept: e.accept,
                        icon: (0, Q.jsx)(`span`, {
                          className: `text-sm text-primary`,
                          children: e.label.charAt(0),
                        }),
                        title: e.label,
                        subtitle: e.blurb,
                        trailing: (0, Q.jsx)(he, {
                          className: `w-4 h-4 text-muted-foreground shrink-0`,
                        }),
                        onPick: (t) => Y(e, t),
                      },
                      e.id,
                    ),
              ),
            }),
            k &&
              (0, Q.jsxs)(`div`, {
                className: `flex items-center justify-center gap-2 mt-4 text-sm text-muted-foreground`,
                children: [
                  (0, Q.jsx)(_e, { className: `w-4 h-4 animate-spin` }),
                  (0, Q.jsx)(A, { id: `q8xS2d` }),
                ],
              }),
            ne &&
              (0, Q.jsx)(`p`, {
                className: `text-sm text-destructive text-center mt-4`,
                children: ne,
              }),
            (0, Q.jsx)(`p`, {
              className: `text-xs text-muted-foreground text-center mt-6`,
              children: (0, Q.jsx)(A, { id: `ALcuLh` }),
            }),
          ],
        });
}
function Ur({ placed: e }) {
  let t = e.filter((e) => !(`item` in e.onto)).length;
  return t === 0
    ? null
    : (0, Q.jsx)(`p`, {
        className: `text-xs text-muted-foreground`,
        children: (0, Q.jsx)(A, { id: `1v8fUE`, values: { toExisting: t } }),
      });
}
export { Hr as ImportShell };
