import { u as e } from "./build-vault-Dl7gFnhh.js";
import { p as t, t as n } from "./text-field-D_94fmjl.js";
import { ut as r } from "./storage-nmIf6WgJ.js";
import {
  _ as i,
  c as a,
  g as o,
  l as s,
  p as c,
  r as l,
  t as u,
} from "./button-DmLv96bj.js";
import {
  c as d,
  i as f,
  n as p,
  o as m,
  t as h,
} from "./select-field-BTL4AK3t.js";
function g(e) {
  let t = e?.trim();
  if (t)
    try {
      return (
        new URL(/^https?:/i.test(t) ? t : `https://${t}`).hostname || void 0
      );
    } catch {
      return;
    }
}
var _ = e(i(), 1);
function v(e, t) {
  return Object.keys(e).every((n) => e[n] === t[n]);
}
var y = 400;
function b() {
  let { prefs: e, loaded: n, update: i } = t(),
    [a, o] = (0, _.useState)(e.generator),
    [s, c] = (0, _.useState)(``),
    l = (0, _.useRef)(!1);
  (0, _.useEffect)(() => {
    !l.current && n && ((l.current = !0), o(e.generator));
  }, [n, e.generator]);
  let u = (0, _.useRef)(0),
    d = (0, _.useCallback)(() => {
      let e = ++u.current;
      r(a).then((t) => {
        u.current === e && c(t);
      });
    }, [a]);
  (0, _.useEffect)(d, [d]);
  let f = (0, _.useRef)(null),
    p = (0, _.useRef)(i);
  return (
    (0, _.useEffect)(() => {
      p.current = i;
    }, [i]),
    (0, _.useEffect)(() => {
      if (!l.current || v(a, e.generator)) return;
      f.current = a;
      let t = setTimeout(() => {
        ((f.current = null), i(`generator`, a));
      }, y);
      return () => clearTimeout(t);
    }, [a, e.generator, i]),
    (0, _.useEffect)(
      () => () => {
        f.current && p.current(`generator`, f.current);
      },
      [],
    ),
    {
      settings: a,
      set: (0, _.useCallback)((e, t) => {
        ((l.current = !0), o((n) => ({ ...n, [e]: t })));
      }, []),
      value: s,
      regenerate: d,
    }
  );
}
var x = o();
function S({
  label: e,
  value: t,
  min: n,
  max: r,
  onChange: i,
  className: a,
  ...o
}) {
  let s = (0, _.useId)();
  return (0, x.jsxs)(`div`, {
    className: a,
    children: [
      (0, x.jsxs)(`div`, {
        className: `flex items-center justify-between mb-1`,
        children: [
          (0, x.jsx)(`label`, {
            htmlFor: s,
            className: `text-xs text-muted-foreground`,
            children: e,
          }),
          (0, x.jsx)(`span`, {
            className: `text-xs tabular-nums`,
            children: t,
          }),
        ],
      }),
      (0, x.jsx)(`input`, {
        id: s,
        type: `range`,
        min: n,
        max: r,
        value: t,
        onChange: (e) => i(Number(e.target.value)),
        className: `w-full h-5 cursor-pointer accent-primary bg-transparent rounded-full`,
        ...o,
      }),
    ],
  });
}
function C(e) {
  return e >= `0` && e <= `9`
    ? `text-sky-700 dark:text-sky-500`
    : /[a-z]/i.test(e)
      ? ``
      : `text-warning`;
}
function w({ value: e, className: t }) {
  return (0, x.jsx)(`p`, {
    className: l(`font-mono text-sm break-all leading-relaxed`, t),
    children: [...e].map((e, t) =>
      (0, x.jsx)(
        `span`,
        { className: C(e), children: e === ` ` ? `\xA0` : e },
        t,
      ),
    ),
  });
}
var T = [
  { key: `lowercase`, label: `a-z` },
  { key: `uppercase`, label: `A-Z` },
  { key: `digits`, label: `0-9` },
  { key: `symbols`, label: `!@#` },
];
function E({ onUse: e, onCancel: t, useLabel: r, className: i }) {
  let { _: o } = s(),
    { clipboard: g } = c(),
    { settings: v, set: y, value: C, regenerate: E } = b(),
    [D, O] = (0, _.useState)(!1);
  (0, _.useEffect)(() => {
    if (!D) return;
    let e = setTimeout(() => O(!1), 1500);
    return () => clearTimeout(e);
  }, [D]);
  let k = async () => {
      try {
        (await g.copy(C), O(!0));
      } catch {}
    },
    A = [
      { mode: `password`, label: o({ id: `8ZsakT` }) },
      { mode: `passphrase`, label: o({ id: `syWzbL` }) },
      { mode: `pin`, label: o({ id: `sXULwc` }) },
    ],
    j = T.filter((e) => v[e.key]).length,
    M = (e, t) => {
      (t || j !== 1) && y(e, t);
    };
  return (0, x.jsxs)(`div`, {
    className: l(`space-y-4`, i),
    children: [
      (0, x.jsx)(`div`, {
        className: `rounded-lg border border-border bg-muted/30 p-3`,
        children: (0, x.jsxs)(`div`, {
          className: `flex items-start gap-2`,
          children: [
            (0, x.jsx)(`div`, {
              className: `flex-1 min-w-0`,
              children: (0, x.jsx)(w, { value: C }),
            }),
            (0, x.jsxs)(`div`, {
              className: `flex items-center gap-1 shrink-0`,
              children: [
                (0, x.jsx)(u, {
                  variant: `ghost`,
                  size: `none`,
                  onClick: E,
                  className: `p-1.5 rounded-md`,
                  "aria-label": o({ id: `7ctz7h` }),
                  children: (0, x.jsx)(f, { className: `w-3.5 h-3.5` }),
                }),
                (0, x.jsx)(u, {
                  variant: `ghost`,
                  size: `none`,
                  onClick: k,
                  className: `p-1.5 rounded-md`,
                  "aria-label": o({ id: `he3ygx` }),
                  children: D
                    ? (0, x.jsx)(d, { className: `w-3.5 h-3.5 text-primary` })
                    : (0, x.jsx)(m, { className: `w-3.5 h-3.5` }),
                }),
              ],
            }),
          ],
        }),
      }),
      (0, x.jsx)(`div`, {
        className: `flex gap-0.5 rounded-lg border border-border p-0.5`,
        children: A.map((e) =>
          (0, x.jsx)(
            u,
            {
              variant: `ghost`,
              size: `none`,
              onClick: () => y(`mode`, e.mode),
              "aria-pressed": v.mode === e.mode,
              className: l(
                `flex-1 px-2 py-1.5 text-xs rounded-md border-transparent`,
                v.mode === e.mode
                  ? `bg-primary text-primary-foreground hover:bg-primary`
                  : `text-muted-foreground`,
              ),
              children: e.label,
            },
            e.mode,
          ),
        ),
      }),
      v.mode === `password` &&
        (0, x.jsxs)(`div`, {
          className: `space-y-3`,
          children: [
            (0, x.jsx)(S, {
              label: o({ id: `NC2AI2` }),
              value: v.length,
              min: 8,
              max: 128,
              onChange: (e) => y(`length`, e),
            }),
            (0, x.jsx)(`div`, {
              className: `grid grid-cols-2 gap-2`,
              children: T.map((e) =>
                (0, x.jsx)(
                  p,
                  {
                    checked: v[e.key],
                    onChange: (t) => M(e.key, t),
                    className: `font-mono`,
                    children: e.label,
                  },
                  e.key,
                ),
              ),
            }),
            v.symbols &&
              (0, x.jsxs)(`div`, {
                className: `pt-0.5`,
                children: [
                  (0, x.jsx)(n, {
                    size: `sm`,
                    label: o({ id: `FpCOaI` }),
                    type: `text`,
                    autoComplete: `off`,
                    autoCapitalize: `off`,
                    spellCheck: !1,
                    className: `font-mono`,
                    value: v.symbolSet,
                    onChange: (e) => y(`symbolSet`, e.target.value),
                  }),
                  !v.symbolSet.trim() &&
                    (0, x.jsx)(`p`, {
                      className: `mt-1 text-xs text-muted-foreground`,
                      children: (0, x.jsx)(a, { id: `0iST7w` }),
                    }),
                ],
              }),
            (0, x.jsx)(p, {
              checked: v.avoidAmbiguous,
              onChange: (e) => y(`avoidAmbiguous`, e),
              children: (0, x.jsx)(a, { id: `RTc3Gg` }),
            }),
          ],
        }),
      v.mode === `passphrase` &&
        (0, x.jsxs)(`div`, {
          className: `space-y-3`,
          children: [
            (0, x.jsx)(S, {
              label: o({ id: `5tK0NB` }),
              value: v.words,
              min: 3,
              max: 12,
              onChange: (e) => y(`words`, e),
            }),
            (0, x.jsxs)(h, {
              label: o({ id: `yLq4w4` }),
              value: v.separator,
              onChange: (e) => y(`separator`, e.target.value),
              children: [
                (0, x.jsx)(`option`, {
                  value: `-`,
                  children: o({ id: `PVvWKp` }),
                }),
                (0, x.jsx)(`option`, {
                  value: `.`,
                  children: o({ id: `A8QO7O` }),
                }),
                (0, x.jsx)(`option`, {
                  value: `_`,
                  children: o({ id: `lynlrj` }),
                }),
                (0, x.jsx)(`option`, {
                  value: `,`,
                  children: o({ id: `fkLtw5` }),
                }),
                (0, x.jsx)(`option`, {
                  value: ` `,
                  children: o({ id: `pOE8Vh` }),
                }),
                (0, x.jsx)(`option`, {
                  value: ``,
                  children: o({ id: `EdQY6l` }),
                }),
              ],
            }),
            (0, x.jsx)(p, {
              checked: v.capitalize,
              onChange: (e) => y(`capitalize`, e),
              children: (0, x.jsx)(a, { id: `6wnM9X` }),
            }),
            (0, x.jsx)(p, {
              checked: v.wordNumber,
              onChange: (e) => y(`wordNumber`, e),
              children: (0, x.jsx)(a, { id: `qHOW6U` }),
            }),
          ],
        }),
      v.mode === `pin` &&
        (0, x.jsx)(S, {
          label: o({ id: `RVGwxt` }),
          value: v.pinLength,
          min: 4,
          max: 12,
          onChange: (e) => y(`pinLength`, e),
        }),
      e &&
        (0, x.jsxs)(`div`, {
          className: `flex items-center justify-end gap-2 pt-1`,
          children: [
            t &&
              (0, x.jsx)(u, {
                variant: `secondary`,
                size: `sm`,
                onClick: t,
                children: (0, x.jsx)(a, { id: `dEgA5A` }),
              }),
            (0, x.jsx)(u, {
              variant: `primary`,
              size: `sm`,
              onClick: () => e(C),
              disabled: !C,
              children: r ?? (0, x.jsx)(a, { id: `TnXNBl` }),
            }),
          ],
        }),
    ],
  });
}
export { g as n, E as t };
