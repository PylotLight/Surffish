import { u as e } from "./build-vault-Dl7gFnhh.js";
import { t } from "./text-field-D_94fmjl.js";
import { ht as n } from "./storage-nmIf6WgJ.js";
import {
  _ as r,
  c as i,
  g as a,
  l as o,
  p as s,
  t as c,
} from "./button-DmLv96bj.js";
import { ft as l } from "./view-port-9v7d8f_U.js";
import { t as u } from "./useNavigate-B45lxN2s.js";
import {
  a as d,
  c as f,
  l as p,
  o as m,
  r as h,
} from "./select-field-BTL4AK3t.js";
import { n as g, t as _ } from "./PasswordGenerator-8BxJvmhr.js";
import { r as v } from "./primitives-CIDpjeam.js";
var y = e(r(), 1),
  b = a();
function x() {
  let { _: e } = o(),
    r = u(),
    { clipboard: a } = s(),
    l = h(),
    [_, v] = (0, y.useState)(``),
    [x, S] = (0, y.useState)({ kind: `idle` }),
    [C, w] = (0, y.useState)(!1);
  if (
    ((0, y.useEffect)(() => {
      if (!C) return;
      let e = setTimeout(() => w(!1), 1500);
      return () => clearTimeout(e);
    }, [C]),
    !l.enabled)
  )
    return (0, b.jsxs)(`div`, {
      className: `space-y-3`,
      children: [
        (0, b.jsx)(`p`, {
          className: `text-sm text-muted-foreground`,
          children: (0, b.jsx)(i, { id: `djfFj2` }),
        }),
        (0, b.jsx)(c, {
          variant: `secondary`,
          size: `sm`,
          onClick: () =>
            void r({ to: `/settings`, search: { tab: `aliases` } }),
          children: (0, b.jsx)(i, { id: `ycOzPy` }),
        }),
      ],
    });
  let T = async () => {
      (S({ kind: `busy` }), w(!1));
      try {
        S({ kind: `done`, address: await l.generate(g(_)) });
      } catch (e) {
        S({ kind: `error`, message: n(e) });
      }
    },
    E = async (e) => {
      try {
        (await a.copy(e), w(!0));
      } catch {}
    };
  return (0, b.jsxs)(`div`, {
    className: `space-y-3`,
    children: [
      (0, b.jsx)(t, {
        label: e({ id: `lxGcV2` }),
        type: `text`,
        autoComplete: `off`,
        value: _,
        onChange: (e) => v(e.target.value),
      }),
      (0, b.jsxs)(c, {
        onClick: () => void T(),
        disabled: x.kind === `busy`,
        className: `gap-1.5`,
        children: [
          x.kind === `busy`
            ? (0, b.jsx)(d, { className: `w-4 h-4 animate-spin` })
            : (0, b.jsx)(p, { className: `w-4 h-4` }),
          (0, b.jsx)(i, { id: `THpQth` }),
        ],
      }),
      x.kind === `done` &&
        (0, b.jsxs)(`div`, {
          className: `rounded-lg border border-border bg-muted/30 p-3 flex items-center gap-2`,
          children: [
            (0, b.jsx)(`span`, {
              className: `flex-1 min-w-0 break-all font-mono text-sm`,
              children: x.address,
            }),
            (0, b.jsx)(c, {
              variant: `ghost`,
              size: `none`,
              onClick: () => void E(x.address),
              className: `p-1.5 rounded-md shrink-0`,
              "aria-label": e({ id: `he3ygx` }),
              children: C
                ? (0, b.jsx)(f, { className: `w-3.5 h-3.5 text-primary` })
                : (0, b.jsx)(m, { className: `w-3.5 h-3.5` }),
            }),
          ],
        }),
      x.kind === `error` &&
        (0, b.jsx)(`p`, {
          className: `text-xs text-destructive`,
          children: x.message,
        }),
    ],
  });
}
function S() {
  let { _: e } = o();
  return (0, b.jsx)(`div`, {
    className: `flex-1 overflow-y-auto`,
    children: (0, b.jsxs)(`main`, {
      className: `max-w-5xl mx-auto px-4 py-5 space-y-6`,
      children: [
        (0, b.jsx)(v, {
          icon: (0, b.jsx)(l, { className: `w-4 h-4 text-primary` }),
          title: e({ id: `19BWU3` }),
          children: (0, b.jsx)(_, {}),
        }),
        (0, b.jsx)(v, {
          icon: (0, b.jsx)(p, { className: `w-4 h-4 text-primary` }),
          title: e({ id: `sxZ8AK` }),
          children: (0, b.jsx)(x, {}),
        }),
      ],
    }),
  });
}
export { S as GeneratorRoute };
