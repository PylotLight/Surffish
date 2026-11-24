import { u as e } from "./build-vault-Dl7gFnhh.js";
import {
  a as t,
  g as n,
  m as r,
  o as i,
  s as a,
  t as o,
} from "./text-field-D_94fmjl.js";
import { D as s, E as c } from "./storage-nmIf6WgJ.js";
import {
  _ as l,
  c as u,
  g as d,
  l as f,
  p,
  t as m,
} from "./button-DmLv96bj.js";
import {
  D as h,
  J as g,
  O as _,
  Y as v,
  at as y,
  m as b,
  nt as x,
  p as S,
  rt as C,
} from "./view-port-9v7d8f_U.js";
import { t as w } from "./useNavigate-B45lxN2s.js";
import { i as T } from "./entry-modes-DgaIEd6h.js";
import { t as E } from "./circle-check-DEDBApdD.js";
import { r as D } from "./useRevealState-BLRULnQh.js";
import { t as O } from "./shield-check-y3jRWLWG.js";
import { kn as k } from "./messages-DLCDPx8W.js";
var A = e(l(), 1),
  j = (e) => e.toLowerCase().replace(/[^a-z0-9]/g, ``);
function M(e) {
  try {
    return new URL(k(e.trim())).hostname;
  } catch {
    return ``;
  }
}
function N(e, t, n) {
  let r = j(t);
  if (!r) return [];
  let i = (e) =>
      r.length < 3
        ? e
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .includes(r)
        : j(e).includes(r),
    a = n.trim().toLowerCase();
  return e
    .filter((e) => e.archivedAt === void 0)
    .filter((e) => i(e.name) || e.urls.some((e) => i(M(e))))
    .sort(
      (e, t) =>
        Number(!!a && t.username.toLowerCase() === a) -
        Number(!!a && e.username.toLowerCase() === a),
    );
}
var P = d();
function F({
  issuer: e,
  account: t,
  totp: n,
  copied: r,
  onCopy: i,
  suggested: a,
  results: s,
  query: c,
  onQueryChange: l,
  onAdd: d,
  onCreateNew: p,
}) {
  let { _: h } = f(),
    [g, _] = (0, A.useState)(a.length > 0 ? `existing` : `new`),
    [v, x] = (0, A.useState)(e || t || h({ id: `lUV-1q` })),
    [C, w] = (0, A.useState)(t),
    [E, D] = (0, A.useState)(null),
    [k, j] = (0, A.useState)(!1),
    M = [e, t].filter(Boolean).join(` · `),
    N = c.trim() !== ``,
    F = async (e, t) => {
      (D(e), j(!1));
      try {
        await t();
      } catch {
        (j(!0), D(null));
      }
    },
    R = (e) => F(e, () => d(e));
  return (0, P.jsxs)(`main`, {
    className: `flex-1 min-h-0 flex flex-col w-full max-w-5xl mx-auto px-4 py-5`,
    children: [
      (0, P.jsxs)(`div`, {
        className: `mb-4 flex items-start gap-3`,
        children: [
          (0, P.jsx)(`div`, {
            className: `shrink-0 w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center`,
            children: (0, P.jsx)(O, { className: `w-5 h-5 text-primary` }),
          }),
          (0, P.jsxs)(`div`, {
            className: `min-w-0`,
            children: [
              (0, P.jsx)(`h2`, {
                className: `text-base`,
                children: (0, P.jsx)(u, { id: `4vT943` }),
              }),
              M &&
                (0, P.jsx)(`p`, {
                  className: `text-sm text-muted-foreground truncate`,
                  children: M,
                }),
            ],
          }),
        ],
      }),
      (0, P.jsxs)(`section`, {
        className: `mb-4 rounded-lg border border-border/50 bg-card/50 px-4 py-3 space-y-1`,
        children: [
          (0, P.jsx)(`p`, {
            className: `text-xs text-muted-foreground`,
            children: (0, P.jsx)(u, { id: `FqAoEk` }),
          }),
          (0, P.jsx)(T, { totp: n, copied: r, onCopy: i }),
          (0, P.jsx)(`p`, {
            className: `text-xs text-muted-foreground`,
            children: (0, P.jsx)(u, { id: `-8zTB8` }),
          }),
        ],
      }),
      (0, P.jsxs)(S, {
        className: `mb-4`,
        children: [
          (0, P.jsx)(b, {
            active: g === `existing`,
            disabled: E !== null,
            onClick: () => _(`existing`),
            children: (0, P.jsx)(u, { id: `GgbQ9f` }),
          }),
          (0, P.jsx)(b, {
            active: g === `new`,
            disabled: E !== null,
            onClick: () => _(`new`),
            children: (0, P.jsx)(u, { id: `3UUCyn` }),
          }),
        ],
      }),
      g === `existing`
        ? (0, P.jsxs)(P.Fragment, {
            children: [
              (0, P.jsx)(o, {
                label: h({ id: `v8vJR1` }),
                type: `search`,
                value: c,
                onChange: (e) => l(e.target.value),
                startAdornment: (0, P.jsx)(y, { className: `w-4 h-4` }),
                className: `mb-3`,
              }),
              (0, P.jsx)(`div`, {
                className: `flex-1 min-h-0 overflow-y-auto`,
                children: N
                  ? s.length > 0
                    ? (0, P.jsx)(L, { targets: s, busy: E, onAdd: R })
                    : (0, P.jsx)(I, {
                        children: (0, P.jsx)(u, { id: `veKbcO` }),
                      })
                  : a.length > 0
                    ? (0, P.jsxs)(P.Fragment, {
                        children: [
                          (0, P.jsx)(`p`, {
                            className: `mb-2 px-1 text-xs font-medium text-muted-foreground`,
                            children: (0, P.jsx)(u, { id: `nyQWMb` }),
                          }),
                          (0, P.jsx)(L, { targets: a, busy: E, onAdd: R }),
                        ],
                      })
                    : (0, P.jsx)(I, {
                        children: (0, P.jsx)(u, { id: `_I8uJ3` }),
                      }),
              }),
            ],
          })
        : (0, P.jsxs)(`form`, {
            className: `space-y-3`,
            onSubmit: (e) => {
              (e.preventDefault(), F(`new`, () => p(v.trim(), C.trim())));
            },
            children: [
              (0, P.jsx)(o, {
                label: h({ id: `6YtxFj` }),
                value: v,
                onChange: (e) => x(e.target.value),
              }),
              (0, P.jsx)(o, {
                label: h({ id: `7sNhEz` }),
                value: C,
                onChange: (e) => w(e.target.value),
              }),
              (0, P.jsx)(m, {
                type: `submit`,
                variant: `primary`,
                fullWidth: !0,
                disabled: E !== null || !v.trim(),
                children:
                  E === `new`
                    ? (0, P.jsx)(u, { id: `K_F6pa` })
                    : (0, P.jsx)(u, { id: `CCM6UW` }),
              }),
            ],
          }),
      k &&
        (0, P.jsx)(`p`, {
          role: `alert`,
          className: `mt-3 px-1 text-sm text-destructive`,
          children: (0, P.jsx)(u, { id: `Z7Feyd` }),
        }),
    ],
  });
}
function I({ children: e }) {
  return (0, P.jsx)(`p`, {
    className: `py-8 text-center text-sm text-muted-foreground`,
    children: e,
  });
}
function L({ targets: e, busy: t, onAdd: n }) {
  let { _: r } = f();
  return (0, P.jsx)(`ul`, {
    className: `space-y-1`,
    children: e.map((e) =>
      (0, P.jsxs)(
        `li`,
        {
          className: `flex items-center gap-3 px-3 py-2.5 rounded-lg border border-border/50 bg-card/50`,
          children: [
            (0, P.jsx)(`span`, {
              className: `shrink-0 w-9 h-9 rounded-lg bg-muted flex items-center justify-center text-xs text-muted-foreground`,
              children:
                e.initials ?? (0, P.jsx)(e.icon, { className: `w-4 h-4` }),
            }),
            (0, P.jsxs)(`span`, {
              className: `min-w-0 flex-1`,
              children: [
                (0, P.jsx)(`span`, {
                  className: `block truncate text-sm`,
                  children: e.name,
                }),
                (0, P.jsx)(`span`, {
                  className: `block truncate text-xs text-muted-foreground`,
                  children: e.secondary,
                }),
              ],
            }),
            e.hasTotp
              ? (0, P.jsx)(h, {
                  className: `shrink-0`,
                  variant: `destructiveOutline`,
                  prompt: (0, P.jsxs)(`span`, {
                    className: `hidden sm:flex items-center gap-1 text-warning`,
                    children: [
                      (0, P.jsx)(C, { className: `w-3.5 h-3.5` }),
                      (0, P.jsx)(u, { id: `CO3asQ` }),
                    ],
                  }),
                  confirmLabel: (0, P.jsx)(u, { id: `fqSfXY` }),
                  busyLabel: (0, P.jsx)(u, { id: `H2zn3t` }),
                  onConfirm: () => n(e.id),
                  trigger: (n) =>
                    (0, P.jsx)(m, {
                      variant: `secondary`,
                      size: `sm`,
                      disabled: t !== null,
                      onClick: n,
                      "aria-label": r({ id: `zCUTmm`, values: { 0: e.name } }),
                      children: (0, P.jsx)(u, { id: `fqSfXY` }),
                    }),
                })
              : (0, P.jsx)(m, {
                  variant: `secondary`,
                  size: `sm`,
                  className: `shrink-0`,
                  disabled: t !== null,
                  onClick: () => void n(e.id),
                  "aria-label": r({ id: `frdwcz`, values: { 0: e.name } }),
                  children:
                    t === e.id
                      ? (0, P.jsx)(u, { id: `Z4OdvO` })
                      : (0, P.jsx)(u, { id: `m16xKo` }),
                }),
          ],
        },
        e.id,
      ),
    ),
  });
}
function R({ failure: e, vendor: t, onDismiss: n }) {
  let { _: r } = f();
  return (0, P.jsxs)(`main`, {
    className: `flex-1 min-h-0 flex flex-col items-center justify-center w-full max-w-md mx-auto px-6 text-center`,
    children: [
      (0, P.jsx)(`div`, {
        className: `w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4`,
        children: (0, P.jsx)(D, { className: `w-6 h-6 text-destructive` }),
      }),
      (0, P.jsx)(`h2`, {
        className: `text-base mb-2`,
        children: (0, P.jsx)(u, { id: `72ZnSH` }),
      }),
      (0, P.jsx)(`p`, {
        className: `text-sm text-muted-foreground mb-6`,
        children: (() => {
          switch (e) {
            case `vendor-app`:
              return r({
                id: `E2N9Ju`,
                values: { 0: t ?? `another authenticator app` },
              });
            case `migration`:
              return r({ id: `Fvv7VB` });
            case `not-totp`:
              return r({ id: `lTK875` });
            default:
              return r({ id: `dpThoA` });
          }
        })(),
      }),
      (0, P.jsx)(m, { onClick: n, children: (0, P.jsx)(u, { id: `Zi9Ump` }) }),
    ],
  });
}
var z = 5;
function B() {
  let e = w(),
    { entries: o } = i(),
    { addEntry: l, updateEntry: u } = a(),
    { clipboard: d } = p(),
    m = x(),
    { _: h } = f(),
    [y, b] = (0, A.useState)(() => v()),
    [S, C] = (0, A.useState)(``),
    [T, D] = (0, A.useState)(!1);
  ((0, A.useEffect)(
    () =>
      g(() => {
        let e = v();
        e && (b(e), C(``));
      }),
    [],
  ),
    (0, A.useEffect)(() => {
      if (!T) return;
      let e = setTimeout(() => D(!1), 1500);
      return () => clearTimeout(e);
    }, [T]));
  let O = (0, A.useMemo)(() => c(y), [y]),
    k = (0, A.useMemo)(() => (O.uri ? s(O.uri) : null), [O.uri]);
  (0, A.useEffect)(() => {
    y === null && e({ to: `/vault`, replace: !0 });
  }, [y, e]);
  let j = (0, A.useMemo)(() => o.filter(t), [o]),
    M = (0, A.useMemo)(
      () => (k ? N(j, k.issuer, k.account).slice(0, z).map(V) : []),
      [j, k],
    ),
    I = (0, A.useMemo)(() => {
      if (!S.trim()) return [];
      let e = new Map(j.map((e) => [e.id, e]));
      return n(
        o.map((e) => _(e, !1)),
        { ...r, q: S, type: `login` },
      ).flatMap((t) => {
        let n = e.get(t.id);
        return n ? [V(n)] : [];
      });
    }, [o, j, S]);
  if (y === null) return null;
  if (!O.uri || !k)
    return (0, P.jsx)(R, {
      failure: O.failure ?? `not-totp`,
      vendor: O.vendor,
      onDismiss: () => void e({ to: `/vault` }),
    });
  let L = O.uri,
    B = (e) => m.show({ message: e, variant: `success`, icon: E });
  return (0, P.jsx)(
    F,
    {
      issuer: k.issuer,
      account: k.account,
      totp: k.totp,
      copied: T,
      onCopy: (e) =>
        void d
          .copy(e)
          .then(() => D(!0))
          .catch(() => {}),
      suggested: M,
      results: I,
      query: S,
      onQueryChange: C,
      onCreateNew: async (t, n) => {
        (await l({
          type: `login`,
          name: t,
          urls: [],
          username: n,
          password: ``,
          totp: L,
        }),
          B(h({ id: `wa5Lry`, values: { name: t } })),
          e({ to: `/vault` }));
      },
      onAdd: async (t) => {
        let n = j.find((e) => e.id === t);
        if (!n) return;
        let { id: r, ...i } = n;
        (await u(t, { ...i, totp: L }),
          B(h({ id: `83qtfn`, values: { 0: n.name } })),
          e({ to: `/vault/$entryId`, params: { entryId: t } }));
      },
    },
    L,
  );
}
function V(e) {
  let t = _(e, !1);
  return {
    id: e.id,
    name: t.name,
    secondary: t.secondary,
    icon: t.icon,
    initials: t.initials,
    hasTotp: !!e.totp?.trim(),
  };
}
export { B as TotpSetupRoute };
