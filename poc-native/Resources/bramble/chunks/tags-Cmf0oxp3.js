import { u as e } from "./build-vault-Dl7gFnhh.js";
import { n as t, nt as n, rt as r } from "./text-field-D_94fmjl.js";
import {
  _ as i,
  c as a,
  g as o,
  l as s,
  r as c,
  t as l,
} from "./button-DmLv96bj.js";
import { it as u } from "./view-port-9v7d8f_U.js";
import { f as d, l as f } from "./toggle-DZvvq5Oc.js";
var p = globalThis.crypto,
  m = 1e4;
async function h(e) {
  if (typeof e != `string`) throw Error(`Password must be a string`);
  let t = await p.subtle.digest(`SHA-1`, new TextEncoder().encode(e)),
    n = Array.from(new Uint8Array(t))
      .map((e) => e.toString(16).padStart(2, `0`))
      .join(``),
    r = n.substring(0, 5).toUpperCase(),
    i = new AbortController(),
    a = setTimeout(() => i.abort(), m);
  try {
    return (
      await (
        await fetch(`https://api.pwnedpasswords.com/range/${r}`, {
          headers: { "Add-Padding": `true` },
          signal: i.signal,
        })
      ).text()
    ).includes(n.substring(5).toUpperCase());
  } finally {
    clearTimeout(a);
  }
}
async function g(e) {
  if (e)
    try {
      return { leaked: await h(e), checkedAt: Date.now() };
    } catch {
      return;
    }
}
var _ = e(i(), 1),
  v = o(),
  y = `tags`;
function b(e) {
  return e ?? [];
}
function x(e) {
  return n(e);
}
var S = new Set([`Enter`, `,`, `Tab`]);
function C({ suggestions: e }) {
  let { watch: i, setValue: o } = f(),
    { _: p } = s(),
    [m, h] = (0, _.useState)(``),
    g = (0, _.useId)(),
    b = (0, _.useId)(),
    x = (0, _.useId)(),
    C = (0, _.useId)(),
    [w, T] = (0, _.useState)(!1),
    [E, D] = (0, _.useState)(!1),
    O = (0, _.useRef)(null),
    k = (0, _.useRef)(null),
    A = (0, _.useRef)([]),
    j = (0, _.useRef)([]),
    [M, N] = (0, _.useState)(``),
    P = i(`tags`) ?? [],
    F = P.length >= 32,
    I = (e) => o(y, e, { shouldDirty: !0 }),
    L = (e) => {
      let t = n([...P, e]) ?? [];
      (I(t), h(``));
      let r = t.length > P.length ? t[t.length - 1] : e;
      (N(p({ id: `STn7AH`, values: { 0: t.length, added: r } })),
        requestAnimationFrame(() =>
          k.current?.scrollIntoView({ inline: `end`, block: `nearest` }),
        ));
    },
    R = (e) => {
      let t = P[e] ?? ``;
      (I(P.filter((t, n) => n !== e)),
        N(p({ id: `7rQlIG`, values: { 0: P.length - 1, removed: t } })));
      let n = e >= P.length - 1 ? e - 1 : e;
      requestAnimationFrame(() => {
        let e = A.current[n];
        e ? e.focus() : k.current?.focus();
      });
    },
    z = (e) => {
      if (S.has(e.key)) {
        if (e.key === `Tab` && !m.trim()) return;
        (e.preventDefault(), m.trim() && L(m));
      } else
        e.key === `Escape` && W
          ? (e.preventDefault(), D(!0))
          : e.key === `ArrowDown` && W
            ? (e.preventDefault(), j.current[0]?.focus())
            : m ||
              (e.key === `Backspace` && P.length > 0
                ? R(P.length - 1)
                : e.key === `ArrowLeft` &&
                  P.length > 0 &&
                  (e.preventDefault(), A.current[P.length - 1]?.focus()));
    },
    B = (e, t) => {
      switch (e.key) {
        case `ArrowLeft`:
          (e.preventDefault(), A.current[Math.max(0, t - 1)]?.focus());
          break;
        case `ArrowRight`:
          (e.preventDefault(),
            t >= P.length - 1 ? k.current?.focus() : A.current[t + 1]?.focus());
          break;
        case `Backspace`:
        case `Delete`:
          (e.preventDefault(), R(t));
          break;
        case `Escape`:
          (e.preventDefault(), k.current?.focus());
          break;
        default:
          e.key.length === 1 && k.current?.focus();
      }
    },
    V = new Set(P.map(r)),
    H = r(m),
    U = F
      ? []
      : e.filter((e) => !V.has(r(e)) && r(e).startsWith(H)).slice(0, 8),
    W = w && !E && U.length > 0,
    G = () => {
      (T(!0), D(!1));
    },
    K = (e) => {
      O.current?.contains(e.relatedTarget) || (T(!1), D(!1), m.trim() && L(m));
    },
    q = (e, t) => {
      switch (e.key) {
        case `ArrowDown`:
          (e.preventDefault(),
            j.current[Math.min(U.length - 1, t + 1)]?.focus());
          break;
        case `ArrowUp`:
          (e.preventDefault(),
            t === 0 ? k.current?.focus() : j.current[t - 1]?.focus());
          break;
        case `Escape`:
          (e.preventDefault(), D(!0), k.current?.focus());
      }
    };
  return (0, v.jsxs)(`div`, {
    children: [
      (0, v.jsxs)(`div`, {
        className: `flex items-center gap-1.5 mb-4`,
        children: [
          (0, v.jsx)(u, { className: `w-3.5 h-3.5 text-muted-foreground` }),
          (0, v.jsx)(`span`, {
            className: `block text-sm`,
            children: (0, v.jsx)(a, { id: `OYHzN1` }),
          }),
        ],
      }),
      (0, v.jsxs)(`div`, {
        ref: O,
        className: `group relative`,
        children: [
          (0, v.jsxs)(`div`, {
            className: c(
              `flex min-h-11 w-full items-center gap-1.5 overflow-x-auto px-3 py-2.5`,
              `flex-nowrap touch-pan-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`,
              F ? `cursor-not-allowed` : `cursor-text`,
            ),
            children: [
              P.map((e, t) =>
                (0, v.jsxs)(
                  `span`,
                  {
                    className: `inline-flex shrink-0 items-center gap-1 rounded-full border border-border/50 bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs`,
                    children: [
                      e,
                      (0, v.jsx)(l, {
                        ref: (e) => {
                          A.current[t] = e;
                        },
                        variant: `ghost`,
                        size: `none`,
                        tabIndex: -1,
                        onClick: () => R(t),
                        onKeyDown: (e) => B(e, t),
                        onFocus: (e) =>
                          e.currentTarget.scrollIntoView({
                            inline: `nearest`,
                            block: `nearest`,
                          }),
                        className: `rounded-full p-0.5 hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive`,
                        "aria-label": p({ id: `YCwYxb`, values: { tag: e } }),
                        children: (0, v.jsx)(d, { className: `w-3 h-3` }),
                      }),
                    ],
                  },
                  r(e),
                ),
              ),
              (0, v.jsx)(`input`, {
                ref: k,
                id: g,
                type: `text`,
                autoComplete: `off`,
                readOnly: F,
                "aria-describedby": F ? `${b} ${x}` : b,
                value: m,
                onChange: (e) => {
                  (D(!1), h(e.target.value));
                },
                onKeyDown: z,
                onFocus: G,
                onBlur: K,
                role: `combobox`,
                "aria-haspopup": `menu`,
                "aria-expanded": W,
                "aria-controls": W ? C : void 0,
                className: c(
                  `min-w-24 flex-1 bg-transparent text-sm text-foreground outline-none`,
                  F && `cursor-not-allowed`,
                ),
              }),
            ],
          }),
          (0, v.jsx)(t, {
            label: p({ id: `kiL8cg` }),
            notch: `always`,
            className: `group-focus-within:border-primary`,
          }),
          (0, v.jsx)(`label`, {
            htmlFor: g,
            className: c(
              `pointer-events-none absolute left-3 top-0 -translate-y-1/2 text-[0.66rem]`,
              `text-muted-foreground group-focus-within:text-primary`,
            ),
            children: p({ id: `kiL8cg` }),
          }),
          W &&
            (0, v.jsx)(`div`, {
              id: C,
              role: `menu`,
              "aria-label": p({ id: `UBl8p2` }),
              className: `absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-border/50 bg-card shadow-xl shadow-black/10`,
              children: (0, v.jsx)(`div`, {
                className: `max-h-[125px] overflow-y-auto overscroll-contain`,
                children: U.map((e, t) =>
                  (0, v.jsxs)(
                    `button`,
                    {
                      ref: (e) => {
                        j.current[t] = e;
                      },
                      type: `button`,
                      role: `menuitem`,
                      onMouseDown: (e) => e.preventDefault(),
                      onClick: () => {
                        (L(e), k.current?.focus());
                      },
                      onKeyDown: (e) => q(e, t),
                      onFocus: G,
                      onBlur: K,
                      className: `flex w-full items-center gap-2 border-b border-border/30 px-3 py-2 text-left text-xs transition-colors last:border-b-0 hover:bg-primary/5 focus-visible:bg-primary/5 focus-visible:-outline-offset-2`,
                      children: [
                        (0, v.jsx)(u, {
                          className: `w-3 h-3 shrink-0 text-muted-foreground`,
                        }),
                        e,
                      ],
                    },
                    r(e),
                  ),
                ),
              }),
            }),
        ],
      }),
      (0, v.jsx)(`p`, {
        id: b,
        className: `sr-only`,
        children: (0, v.jsx)(a, { id: `X9psa_` }),
      }),
      (0, v.jsx)(`p`, {
        role: `status`,
        "aria-live": `polite`,
        className: `sr-only`,
        children: M,
      }),
      F &&
        (0, v.jsx)(`p`, {
          id: x,
          className: `mt-1 text-xs text-muted-foreground`,
          children: (0, v.jsx)(a, { id: `om0WsD` }),
        }),
    ],
  });
}
function w({ tags: e, onSelect: t }) {
  let { _: n } = s();
  return e.length === 0
    ? null
    : (0, v.jsx)(`div`, {
        className: `flex flex-wrap gap-1.5`,
        children: e.map((e) =>
          (0, v.jsxs)(
            l,
            {
              variant: `link`,
              size: `none`,
              onClick: () => t(e),
              "aria-label": n({ id: `afJ6Ls`, values: { tag: e } }),
              className: `inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-border`,
              children: [(0, v.jsx)(u, { className: `w-3 h-3 shrink-0` }), e],
            },
            r(e),
          ),
        ),
      });
}
export { b as a, x as i, w as n, g as o, C as r, y as t };
