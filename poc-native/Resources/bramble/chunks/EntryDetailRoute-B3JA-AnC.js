import { u as e } from "./build-vault-Dl7gFnhh.js";
import {
  B as t,
  U as n,
  c as r,
  o as i,
  p as a,
  r as o,
  s,
  z as c,
} from "./text-field-D_94fmjl.js";
import { vt as l } from "./storage-nmIf6WgJ.js";
import {
  _ as u,
  c as d,
  f,
  g as p,
  l as m,
  p as h,
  t as g,
  u as _,
} from "./button-DmLv96bj.js";
import {
  A as v,
  B as y,
  D as b,
  Z as x,
  gt as S,
  rt as C,
  st as w,
  z as T,
} from "./view-port-9v7d8f_U.js";
import { t as E } from "./useNavigate-B45lxN2s.js";
import { n as D } from "./format-date-DY5h_i7e.js";
import { a as O, i as k, n as A, r as j, t as M } from "./trash-2-tR7gLzyo.js";
import { a as N } from "./select-field-BTL4AK3t.js";
import { t as P } from "./entry-modes-DgaIEd6h.js";
import { p as F } from "./toggle-DZvvq5Oc.js";
import { n as I, o as L } from "./tags-Cmf0oxp3.js";
import { t as R } from "./useCanAddFiles-BzYqZRl7.js";
import { t as z } from "./useDeviceNames-BwAdTB9R.js";
var B = _(`CloudDownload`, [
    [`path`, { d: `M12 13v8l-4-4`, key: `1f5nwf` }],
    [`path`, { d: `m12 21 4-4`, key: `1lfcce` }],
    [
      `path`,
      {
        d: `M4.393 15.269A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.436 8.284`,
        key: `ui1hmy`,
      },
    ],
  ]),
  ee = _(`CopyPlus`, [
    [`line`, { x1: `15`, x2: `15`, y1: `12`, y2: `18`, key: `1p7wdc` }],
    [`line`, { x1: `12`, x2: `18`, y1: `15`, y2: `15`, key: `1nscbv` }],
    [
      `rect`,
      {
        width: `14`,
        height: `14`,
        x: `8`,
        y: `8`,
        rx: `2`,
        ry: `2`,
        key: `17jyea`,
      },
    ],
    [
      `path`,
      {
        d: `M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2`,
        key: `zix9uf`,
      },
    ],
  ]),
  te = _(`FileLock2`, [
    [
      `path`,
      { d: `M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v1`, key: `jmtmu2` },
    ],
    [`path`, { d: `M14 2v4a2 2 0 0 0 2 2h4`, key: `tnqrlb` }],
    [
      `rect`,
      { width: `8`, height: `5`, x: `2`, y: `13`, rx: `1`, key: `10y5wo` },
    ],
    [`path`, { d: `M8 13v-2a2 2 0 1 0-4 0v2`, key: `1pdxzg` }],
  ]),
  V = _(`GitMerge`, [
    [`circle`, { cx: `18`, cy: `18`, r: `3`, key: `1xkwt0` }],
    [`circle`, { cx: `6`, cy: `6`, r: `3`, key: `1lh9wr` }],
    [`path`, { d: `M6 21V9a9 9 0 0 0 9 9`, key: `7kw0sc` }],
  ]),
  H = e(u(), 1);
function U(e, t) {
  let {
    id: n,
    createdAt: r,
    updatedAt: i,
    lastUsedAt: a,
    archivedAt: o,
    partStamps: s,
    itemStamps: c,
    partStampsAt: l,
    ...u
  } = e;
  if (u.type === `login`) {
    let { passkeys: e, passwordChangelog: n, breach: r, ...i } = u;
    return { ...i, name: t };
  }
  return { ...u, name: t };
}
var W = p();
function G({ entryId: e }) {
  let { files: t, canAttachFiles: n } = r(),
    i = R(),
    a = (0, H.useMemo)(() => t.filter((t) => t.entryId === e), [t, e]),
    { held: o, status: s } = Y(n ? a : q);
  return !n || (!i && a.length === 0)
    ? null
    : (0, W.jsxs)(`div`, {
        className: `pt-3 border-t border-border/50 space-y-2`,
        children: [
          (0, W.jsxs)(`div`, {
            className: `flex items-center gap-1.5 text-xs text-muted-foreground`,
            children: [
              (0, W.jsx)(w, { className: `w-3.5 h-3.5` }),
              (0, W.jsx)(d, { id: `w_Sphq` }),
            ],
          }),
          a.map((e) =>
            (0, W.jsx)(
              Z,
              { record: e, held: o.get(e.hash) ?? null, status: s[e.hash] },
              e.id,
            ),
          ),
          i && (0, W.jsx)(re, { entryId: e }),
        ],
      });
}
function K(e) {
  if (e < 1024) return `${e} B`;
  let t = [`KB`, `MB`, `GB`],
    n = e / 1024,
    r = 0;
  for (; n >= 1024 && r < t.length - 1;) ((n /= 1024), r++);
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${t[r]}`;
}
var q = [],
  J = 4e3;
function Y(e) {
  let { hasFile: t, fileStatus: n } = s(),
    [r, i] = (0, H.useState)(() => new Map()),
    [a, o] = (0, H.useState)({});
  return (
    (0, H.useEffect)(() => {
      let r = !0,
        a,
        s = async () => {
          let c = await Promise.all(
            e.map(async (e) => [e.hash, await t(e).catch(() => !1)]),
          );
          if (!r) return;
          let l = new Map(c);
          i(l);
          let u = e.filter((e) => !l.get(e.hash)).map((e) => e.hash);
          if (u.length === 0) return;
          let d = await n(u).catch(() => ({}));
          r && (o(d), (a = setTimeout(s, J)));
        };
      return (
        s(),
        () => {
          ((r = !1), clearTimeout(a));
        }
      );
    }, [t, n, e]),
    { held: r, status: a }
  );
}
function X({ status: e }) {
  let { nameOf: t } = z();
  switch (e?.state) {
    case `downloading`: {
      let n = Math.min(
          99,
          Math.floor((e.received / Math.max(e.size, 1)) * 100),
        ),
        r = e.from && t(e.from);
      return r
        ? (0, W.jsx)(d, { id: `bYwIhn`, values: { from: r, percent: n } })
        : (0, W.jsx)(d, { id: `0p9PmY`, values: { percent: n } });
    }
    case `queued`: {
      let n = e.from && t(e.from);
      return n
        ? (0, W.jsx)(d, { id: `VRnbvb`, values: { from: n } })
        : (0, W.jsx)(d, { id: `NcGjGj` });
    }
    case `retrying`: {
      let n = e.from && t(e.from);
      return n
        ? (0, W.jsx)(d, { id: `VRhXwJ`, values: { from: n } })
        : (0, W.jsx)(d, { id: `CEgcjX` });
    }
    case `unreachable`:
      return (0, W.jsx)(d, { id: `Ad9K-1` });
    case `not-on-connected`:
      return (0, W.jsx)(d, { id: `CShzZV` });
    case `desktop-only`:
      return (0, W.jsx)(d, { id: `AGZ0BW` });
    default:
      return (0, W.jsx)(d, { id: `JMG_-b` });
  }
}
function Z({ record: e, held: t, status: i }) {
  let { detachFile: a, describeFile: o, openFile: c, saveFile: l } = s(),
    { canOpenFiles: u, canSaveFiles: f } = r(),
    [p, h] = (0, H.useState)(!1),
    [_, v] = (0, H.useState)(!1),
    { _: y } = m(),
    [x, S] = (0, H.useState)(null),
    [C, w] = (0, H.useState)(!1),
    [T, E] = (0, H.useState)(null);
  return (
    (0, H.useEffect)(() => {
      let t = !0;
      return (
        o(e)
          .then((e) => t && S(e.name))
          .catch(() => t && S(null)),
        () => {
          t = !1;
        }
      );
    }, [o, e]),
    (0, W.jsxs)(`div`, {
      className: `flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border/50 bg-card/40`,
      children: [
        (0, W.jsx)(te, { className: `w-4 h-4 text-muted-foreground shrink-0` }),
        (0, W.jsxs)(`div`, {
          className: `min-w-0 flex-1`,
          children: [
            (0, W.jsx)(`p`, {
              className: `text-sm truncate`,
              children:
                x ??
                (0, W.jsx)(`span`, {
                  className: `text-muted-foreground`,
                  children: y({ id: `G2fuEb` }),
                }),
            }),
            (0, W.jsx)(`p`, {
              className: `text-xs text-muted-foreground`,
              children: K(n(e.size)),
            }),
            t === !1 &&
              (0, W.jsxs)(`p`, {
                className: `flex items-center gap-1 text-xs text-muted-foreground mt-0.5`,
                children: [
                  (0, W.jsx)(B, { className: `w-3.5 h-3.5 shrink-0` }),
                  (0, W.jsx)(X, { status: i }),
                ],
              }),
            T &&
              (0, W.jsx)(`p`, {
                className: `text-xs text-destructive mt-0.5`,
                children: T,
              }),
          ],
        }),
        u &&
          t !== !1 &&
          !C &&
          (0, W.jsx)(g, {
            variant: `ghost`,
            size: `icon`,
            disabled: p || t === null,
            "aria-label": y({ id: `HuBoiS` }),
            title: y({ id: `1TNIig` }),
            onClick: async () => {
              (h(!0), E(null));
              try {
                await c(e);
              } catch (e) {
                E(e.message);
              } finally {
                h(!1);
              }
            },
            children: p
              ? (0, W.jsx)(N, { className: `w-4 h-4 animate-spin` })
              : (0, W.jsx)(F, { className: `w-4 h-4` }),
          }),
        f &&
          t !== !1 &&
          !C &&
          (0, W.jsx)(g, {
            variant: `ghost`,
            size: `icon`,
            disabled: _ || t === null,
            "aria-label": y({ id: `Z0vVF3` }),
            title: y({ id: `tfDRzk` }),
            onClick: async () => {
              (v(!0), E(null));
              try {
                await l(e);
              } catch (e) {
                E(e.message);
              } finally {
                v(!1);
              }
            },
            children: _
              ? (0, W.jsx)(N, { className: `w-4 h-4 animate-spin` })
              : (0, W.jsx)(j, { className: `w-4 h-4` }),
          }),
        (0, W.jsx)(b, {
          armed: C,
          onArmedChange: (e) => {
            (w(e), e && E(null));
          },
          confirmLabel: (0, W.jsx)(d, { id: `t_YqKh` }),
          busyLabel: (0, W.jsx)(d, { id: `APfagk` }),
          onConfirm: () => a(e.id),
          onError: (e) => E(e.message),
          trigger: (e) =>
            (0, W.jsx)(g, {
              variant: `ghost`,
              size: `icon`,
              "aria-label": y({ id: `uowbPn` }),
              title: y({ id: `t_YqKh` }),
              className: `hover:bg-destructive/10 hover:text-destructive`,
              onClick: e,
              children: (0, W.jsx)(M, { className: `w-4 h-4` }),
            }),
        }),
      ],
    })
  );
}
var ne = Math.round(l / 1048576);
function re({ entryId: e }) {
  let { shell: n } = h(),
    { attachFile: i, pickFile: a } = s(),
    { canPickFiles: o } = r(),
    { canPopOut: l, popOut: u } = x(),
    p = f(`filePickerNeedsWindow`) && l,
    { _: g } = m(),
    [_, v] = (0, H.useState)(!1),
    [y, b] = (0, H.useState)(null),
    S = async (e) => {
      (v(!0), b(null));
      try {
        await i(e);
      } catch (e) {
        b(
          e instanceof t
            ? g({ id: `pA4XrS`, values: { LIMIT_MB: ne } })
            : e instanceof c
              ? g({ id: `WrYnCl` })
              : e.message,
        );
      } finally {
        v(!1);
      }
    },
    C = _
      ? (0, W.jsxs)(W.Fragment, {
          children: [
            (0, W.jsx)(N, { className: `w-4 h-4 animate-spin` }),
            (0, W.jsx)(d, { id: `KEdzhM` }),
          ],
        })
      : (0, W.jsxs)(W.Fragment, {
          children: [
            (0, W.jsx)(w, { className: `w-4 h-4` }),
            (0, W.jsx)(d, { id: `tCyvAw` }),
          ],
        }),
    T = `flex w-full items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border/60 text-sm text-muted-foreground transition-colors ${_ ? `opacity-60` : `cursor-pointer hover:border-border hover:text-foreground`}`;
  return (0, W.jsxs)(`div`, {
    children: [
      p
        ? (0, W.jsxs)(`button`, {
            type: `button`,
            className: T,
            onClick: () => u(),
            children: [
              (0, W.jsx)(F, { className: `w-4 h-4` }),
              (0, W.jsx)(d, { id: `qxp-kd` }),
            ],
          })
        : o
          ? (0, W.jsx)(`button`, {
              type: `button`,
              className: T,
              disabled: _,
              onClick: async () => {
                n.notifyFilePickerOpening?.();
                let t;
                try {
                  t = await a();
                } catch (e) {
                  b(e.message);
                  return;
                }
                t && (await S({ ...t, entryId: e }));
              },
              children: C,
            })
          : (0, W.jsxs)(`label`, {
              className: T,
              children: [
                (0, W.jsx)(`input`, {
                  type: `file`,
                  className: `hidden`,
                  disabled: _,
                  onClick: () => n.notifyFilePickerOpening?.(),
                  onChange: async (t) => {
                    let n = t.currentTarget,
                      r = n.files?.[0];
                    ((n.value = ``),
                      r &&
                        (await S({
                          source: { kind: `blob`, blob: r },
                          name: r.name,
                          mime: r.type || `application/octet-stream`,
                          entryId: e,
                        })));
                  },
                }),
                C,
              ],
            }),
      y &&
        (0, W.jsx)(`p`, {
          className: `text-xs text-destructive mt-1`,
          children: y,
        }),
    ],
  });
}
var Q = (e) =>
  new Set(
    (e.type === `login` ? (e.passkeys ?? []) : []).map((e) => e.credentialId),
  );
function ie({
  entry: e,
  conflict: t,
  onReadVersions: n,
  onResolve: r,
  onDelete: i,
}) {
  let { _: a } = m(),
    [s, c] = (0, H.useState)(!1),
    [l, u] = (0, H.useState)(null),
    [f, p] = (0, H.useState)(!1),
    [h, _] = (0, H.useState)(null),
    v = (0, H.useRef)(n);
  ((v.current = n),
    (0, H.useEffect)(() => {
      if (!s) return;
      let e = !0;
      return (
        v.current().then((t) => {
          e && u(t);
        }),
        () => {
          e = !1;
        }
      );
    }, [s, t, e]));
  let y = async (e) => {
      (p(!0), _(null));
      try {
        await e();
      } catch (e) {
        (_(e instanceof Error ? e.message : String(e)),
          e instanceof o && s && u(await v.current()));
      } finally {
        p(!1);
      }
    },
    b = l?.map((e) => e.hlc) ?? [],
    x = (0, W.jsx)(g, {
      variant: `destructive`,
      size: `sm`,
      disabled: f,
      onClick: () => void y(i),
      children: (0, W.jsx)(d, { id: `5qa5l_` }),
    }),
    S = (t) => {
      let n = [];
      e.type === `login` &&
        t.type === `login` &&
        e.password !== t.password &&
        n.push(a({ id: `gUv5tx` }));
      let r = Q(e),
        i = [...Q(t)].filter((e) => !r.has(e)).length;
      return (
        i === 1
          ? n.push(a({ id: `0qCbKs` }))
          : i > 1 && n.push(a({ id: `jLrcLU`, values: { extra: i } })),
        n
      );
    },
    C = new Set(l?.flatMap((e) => [...Q(e.data)]) ?? []),
    w = [...Q(e)].filter((e) => !C.has(e)).length;
  return (0, W.jsxs)(`div`, {
    className: `mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm`,
    children: [
      (0, W.jsxs)(`div`, {
        className: `flex items-start gap-2.5`,
        children: [
          (0, W.jsx)(V, { className: `w-4 h-4 mt-0.5 shrink-0 text-warning` }),
          (0, W.jsxs)(`div`, {
            className: `min-w-0 flex-1 space-y-1`,
            children: [
              t.versions > 0 &&
                (0, W.jsx)(`p`, { children: (0, W.jsx)(d, { id: `8dmHqv` }) }),
              t.deleted &&
                (0, W.jsx)(`p`, { children: (0, W.jsx)(d, { id: `KJFk_G` }) }),
              (0, W.jsx)(`div`, {
                className: `flex flex-wrap gap-2 pt-1`,
                children:
                  t.versions > 0
                    ? !s &&
                      (0, W.jsx)(g, {
                        variant: `secondary`,
                        size: `sm`,
                        disabled: f,
                        onClick: () => c(!0),
                        children: (0, W.jsx)(d, { id: `XoIL8B` }),
                      })
                    : (0, W.jsxs)(W.Fragment, {
                        children: [
                          (0, W.jsx)(g, {
                            variant: `secondary`,
                            size: `sm`,
                            disabled: f,
                            onClick: () =>
                              void y(() => r({ kind: `keep`, seen: b })),
                            children: (0, W.jsx)(d, { id: `RQElWR` }),
                          }),
                          x,
                        ],
                      }),
              }),
              h &&
                (0, W.jsx)(`p`, {
                  className: `text-xs text-destructive`,
                  role: `alert`,
                  children: h,
                }),
            ],
          }),
        ],
      }),
      s &&
        l &&
        (0, W.jsxs)(`div`, {
          className: `mt-3 space-y-3`,
          children: [
            (0, W.jsx)($, {
              title: a({ id: `p12aTb` }),
              saved: e.updatedAt,
              entry: e,
              notes:
                w === 0
                  ? []
                  : [
                      a(
                        w === 1
                          ? { id: `FLELCl` }
                          : { id: `xspxsF`, values: { shownOnly: w } },
                      ),
                    ],
              actions: (0, W.jsx)(g, {
                variant: `secondary`,
                size: `sm`,
                disabled: f,
                onClick: () => void y(() => r({ kind: `keep`, seen: b })),
                children: (0, W.jsx)(d, { id: `m4ejI-` }),
              }),
            }),
            l.map((t) =>
              (0, W.jsx)(
                $,
                {
                  title: a({ id: `dU7qWa` }),
                  saved: t.hlc.wall,
                  entry: { ...t.data, id: e.id },
                  notes: S(t.data),
                  actions: (0, W.jsxs)(W.Fragment, {
                    children: [
                      (0, W.jsx)(g, {
                        variant: `secondary`,
                        size: `sm`,
                        disabled: f,
                        onClick: () =>
                          void y(() => r({ kind: `use`, hlc: t.hlc, seen: b })),
                        children: (0, W.jsx)(d, { id: `xELC5l` }),
                      }),
                      (0, W.jsx)(g, {
                        variant: `secondary`,
                        size: `sm`,
                        disabled: f,
                        onClick: () =>
                          void y(() =>
                            r({ kind: `keepBoth`, hlc: t.hlc, seen: b }),
                          ),
                        children: (0, W.jsx)(d, { id: `AT0e50` }),
                      }),
                    ],
                  }),
                },
                `${t.hlc.wall}:${t.hlc.counter}:${t.hlc.node}`,
              ),
            ),
            t.deleted &&
              (0, W.jsx)(`div`, { className: `flex justify-end`, children: x }),
          ],
        }),
    ],
  });
}
function $({ title: e, saved: t, entry: n, notes: r, actions: i }) {
  let { _: a } = m(),
    { clipboard: o } = h(),
    [s, c] = (0, H.useState)(null),
    l = P(n.type).Detail,
    u = async (e, t) => {
      try {
        (await o.copy(t), c(e));
      } catch {}
    };
  return (0, W.jsxs)(`div`, {
    className: `rounded-lg border border-border/50 bg-card/50 p-3 space-y-2`,
    children: [
      (0, W.jsxs)(`div`, {
        className: `flex items-baseline justify-between gap-2`,
        children: [
          (0, W.jsx)(`p`, {
            className: `font-medium text-foreground`,
            children: e,
          }),
          t !== void 0 &&
            (0, W.jsx)(`p`, {
              className: `text-[10px] text-muted-foreground`,
              children: a({ id: `dCKzkm`, values: { 0: D(t) } }),
            }),
        ],
      }),
      (0, W.jsx)(`p`, { className: `text-base truncate`, children: n.name }),
      r.map((e) =>
        (0, W.jsx)(`p`, { className: `text-xs text-warning`, children: e }, e),
      ),
      (0, W.jsx)(l, { entry: n, copied: s, copy: u }),
      n.customFields &&
        n.customFields.length > 0 &&
        (0, W.jsx)(v, { fields: n.customFields, copied: s, copy: u }),
      n.tags &&
        n.tags.length > 0 &&
        (0, W.jsx)(`div`, {
          className: `flex flex-wrap gap-1.5`,
          children: n.tags.map((e) =>
            (0, W.jsx)(
              `span`,
              {
                className: `rounded-full border border-border/50 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground`,
                children: e,
              },
              e,
            ),
          ),
        }),
      (0, W.jsx)(`div`, {
        className: `flex flex-wrap justify-end gap-2`,
        children: i,
      }),
    ],
  });
}
function ae({
  entry: e,
  onEdit: t,
  onDelete: n,
  onSetArchived: r,
  onDuplicate: i,
  onSelectTag: a,
  onUse: o,
  conflict: s,
  onReadConflictVersions: c,
  onResolveConflict: l,
}) {
  let { clipboard: u } = h(),
    { _: f } = m(),
    [p, _] = (0, H.useState)(null),
    [y, b] = (0, H.useState)(!1),
    [x, S] = (0, H.useState)(!1),
    [w, T] = (0, H.useState)(!1),
    E = e.archivedAt !== void 0,
    j = P(e.type),
    { icon: N, initials: F } = j.row(e),
    L = j.detailSubtitle?.(e),
    R = j.detailAlert?.(e) ?? null,
    z = j.Detail;
  (0, H.useEffect)(() => {
    if (!p) return;
    let e = setTimeout(() => _(null), 1500);
    return () => clearTimeout(e);
  }, [p]);
  let B = async (e, t) => {
    try {
      (await u.copy(t), _(e), o?.());
    } catch {}
  };
  return (0, W.jsxs)(`main`, {
    className: `max-w-5xl mx-auto px-4 py-3`,
    children: [
      E &&
        (0, W.jsxs)(`div`, {
          className: `mb-3 flex items-start gap-2.5 px-4 py-2.5 rounded-lg border border-border/50 bg-muted/40 text-muted-foreground`,
          role: `status`,
          children: [
            (0, W.jsx)(k, { className: `w-4 h-4 mt-0.5 shrink-0` }),
            (0, W.jsxs)(`div`, {
              className: `text-sm`,
              children: [
                (0, W.jsx)(`p`, {
                  className: `font-medium text-foreground`,
                  children: (0, W.jsx)(d, { id: `TdfEV7` }),
                }),
                (0, W.jsx)(`p`, {
                  className: `text-xs mt-0.5`,
                  children: (0, W.jsx)(d, { id: `bIUPM5` }),
                }),
              ],
            }),
          ],
        }),
      s &&
        c &&
        l &&
        (0, W.jsx)(ie, {
          entry: e,
          conflict: s,
          onReadVersions: c,
          onResolve: l,
          onDelete: n,
        }),
      R &&
        (0, W.jsxs)(`div`, {
          className: `mb-3 flex items-start gap-2.5 px-4 py-2.5 rounded-lg border border-destructive/40 bg-destructive/10 text-destructive`,
          role: `alert`,
          children: [
            (0, W.jsx)(C, { className: `w-4 h-4 mt-0.5 shrink-0` }),
            (0, W.jsxs)(`div`, {
              className: `text-sm`,
              children: [
                (0, W.jsx)(`p`, {
                  className: `font-medium`,
                  children: R.title,
                }),
                (0, W.jsx)(`p`, {
                  className: `text-xs mt-0.5 opacity-90`,
                  children: R.body,
                }),
              ],
            }),
          ],
        }),
      (0, W.jsxs)(`div`, {
        className: `rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden`,
        children: [
          (0, W.jsxs)(`div`, {
            className: `p-4 space-y-3`,
            children: [
              (0, W.jsxs)(`div`, {
                className: `flex items-center gap-3`,
                children: [
                  (0, W.jsx)(`div`, {
                    className: `flex items-center justify-center w-10 h-10 rounded-lg bg-linear-to-br from-primary/20 to-primary/10 shadow-sm shrink-0`,
                    children: F
                      ? (0, W.jsx)(`span`, {
                          className: `text-sm text-primary`,
                          children: F,
                        })
                      : (0, W.jsx)(N, { className: `w-4 h-4 text-primary` }),
                  }),
                  (0, W.jsxs)(`div`, {
                    className: `min-w-0 flex-1`,
                    children: [
                      (0, W.jsx)(`h2`, {
                        className: `text-base truncate`,
                        children: e.name,
                      }),
                      L &&
                        (0, W.jsx)(`p`, {
                          className: `text-xs text-muted-foreground truncate`,
                          children: L,
                        }),
                    ],
                  }),
                  (0, W.jsxs)(g, {
                    variant: `secondary`,
                    onClick: t,
                    "aria-label": f({ id: `BiSSQP` }),
                    className: `shrink-0 gap-1.5 px-3`,
                    children: [
                      (0, W.jsx)(A, { className: `w-4 h-4` }),
                      (0, W.jsx)(d, { id: `ePK91l` }),
                    ],
                  }),
                ],
              }),
              (0, W.jsx)(z, { entry: e, copied: p, copy: B }),
              e.customFields &&
                e.customFields.length > 0 &&
                (0, W.jsx)(v, { fields: e.customFields, copied: p, copy: B }),
              (0, W.jsx)(G, { entryId: e.id }),
              e.tags &&
                e.tags.length > 0 &&
                (0, W.jsx)(I, { tags: e.tags, onSelect: a }),
            ],
          }),
          (e.createdAt !== void 0 || e.updatedAt !== void 0) &&
            (0, W.jsxs)(`div`, {
              className: `px-4 py-2.5 border-t border-border/50 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground`,
              children: [
                e.createdAt !== void 0 &&
                  (0, W.jsx)(`span`, {
                    children: f({
                      id: `MXSt4t`,
                      values: { 0: D(e.createdAt) },
                    }),
                  }),
                e.updatedAt !== void 0 &&
                  (0, W.jsx)(`span`, {
                    children: f({
                      id: `4Y9aig`,
                      values: { 0: D(e.updatedAt) },
                    }),
                  }),
                e.archivedAt !== void 0 &&
                  (0, W.jsx)(`span`, {
                    children: f({
                      id: `fBiAdW`,
                      values: { 0: D(e.archivedAt) },
                    }),
                  }),
              ],
            }),
          (0, W.jsxs)(`div`, {
            className: `px-4 py-2.5 border-t border-border/50 flex flex-wrap items-center justify-end gap-2`,
            children: [
              (0, W.jsxs)(g, {
                variant: `secondary`,
                size: `sm`,
                onClick: i,
                "aria-label": f({ id: `vfkizH` }),
                className: `gap-1.5 mr-auto`,
                children: [
                  (0, W.jsx)(ee, { className: `w-3.5 h-3.5` }),
                  (0, W.jsx)(d, { id: `euc6Ns` }),
                ],
              }),
              (0, W.jsxs)(g, {
                variant: `secondary`,
                size: `sm`,
                onClick: async () => {
                  T(!0);
                  try {
                    await r(!E);
                  } finally {
                    T(!1);
                  }
                },
                disabled: w,
                "aria-label": f(E ? { id: `wed-fi` } : { id: `og1u2r` }),
                className: `gap-1.5`,
                children: [
                  E
                    ? (0, W.jsx)(O, { className: `w-3.5 h-3.5` })
                    : (0, W.jsx)(k, { className: `w-3.5 h-3.5` }),
                  E
                    ? (0, W.jsx)(d, { id: `yKu_3Y` })
                    : (0, W.jsx)(d, { id: `B495Gs` }),
                ],
              }),
              (0, W.jsxs)(g, {
                variant: `destructiveOutline`,
                size: `sm`,
                onClick: () => b(!0),
                "aria-label": f({ id: `Qd9nQC` }),
                className: `gap-1.5`,
                children: [
                  (0, W.jsx)(M, { className: `w-3.5 h-3.5` }),
                  (0, W.jsx)(d, { id: `cnGeoo` }),
                ],
              }),
            ],
          }),
          y &&
            (0, W.jsxs)(`div`, {
              className: `p-4 bg-muted/30 border-t border-border/50 flex items-center justify-between gap-3`,
              children: [
                (0, W.jsx)(`p`, {
                  className: `flex-1 text-xs text-destructive`,
                  children: (0, W.jsx)(d, { id: `D4Y4S7` }),
                }),
                (0, W.jsx)(g, {
                  variant: `secondary`,
                  size: `none`,
                  onClick: () => b(!1),
                  disabled: x,
                  className: `px-4 py-2 text-sm hover:bg-background/50 hover:border-border`,
                  children: (0, W.jsx)(d, { id: `dEgA5A` }),
                }),
                (0, W.jsx)(g, {
                  variant: `destructive`,
                  size: `md`,
                  onClick: async () => {
                    S(!0);
                    try {
                      await n();
                    } finally {
                      S(!1);
                    }
                  },
                  disabled: x,
                  children: x
                    ? (0, W.jsx)(d, { id: `gXQX4x` })
                    : (0, W.jsx)(d, { id: `cnGeoo` }),
                }),
              ],
            }),
        ],
      }),
    ],
  });
}
var oe = 6048e5;
function se() {
  let { _: e } = m(),
    t = E(),
    n = T(),
    { entryId: r } = S({ from: `/_app/vault/$entryId` }),
    {
      entries: o,
      conflicts: s,
      deleteEntry: c,
      setEntriesArchived: l,
      touchEntry: u,
      setEntryBreach: d,
      readConflictVersions: f,
      resolveConflict: p,
    } = i(),
    { prefs: h, loaded: g } = a(),
    _ = o.find((e) => e.id === r),
    v = (0, H.useRef)(null);
  if (
    ((0, H.useEffect)(() => {
      _?.type === `login` &&
        g &&
        h.breachCheckEnabled &&
        v.current !== _.id &&
        (!_.breach || Date.now() - _.breach.checkedAt > oe) &&
        ((v.current = _.id),
        (async () => {
          let e = await L(_.password);
          e && (await d(_.id, e));
        })());
    }, [_, g, h.breachCheckEnabled, d]),
    !_)
  )
    return null;
  let b =
    h.breachCheckEnabled || _.type !== `login` ? _ : { ..._, breach: void 0 };
  return (0, W.jsx)(`div`, {
    className: `flex-1 overflow-y-auto`,
    children: (0, W.jsx)(ae, {
      entry: b,
      onEdit: () => t({ to: `/vault/$entryId/edit`, params: { entryId: r } }),
      onDelete: async () => {
        (await c(r), n ? n() : t({ to: `/vault` }));
      },
      onSetArchived: (e) => l([r], e),
      onDuplicate: () => {
        (y(U(_, e({ id: `wqtZLy`, values: { 0: _.name } }))),
          t({ to: `/vault/new/$type`, params: { type: _.type } }));
      },
      onSelectTag: (e) => t({ to: `/vault`, search: { q: `#${e}` } }),
      onUse: () => void u(r),
      conflict: s.get(r),
      onReadConflictVersions: () => f(r),
      onResolveConflict: (e) => p(r, e),
    }),
  });
}
export { se as EntryDetailRoute };
