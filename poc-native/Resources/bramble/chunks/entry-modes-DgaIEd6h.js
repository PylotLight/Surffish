import { u as e } from "./build-vault-Dl7gFnhh.js";
import {
  at as t,
  ct as n,
  dt as r,
  ft as i,
  lt as a,
  n as o,
  p as s,
  st as c,
  t as l,
  ut as u,
} from "./text-field-D_94fmjl.js";
import {
  D as d,
  E as f,
  O as p,
  ht as ee,
  ut as te,
} from "./storage-nmIf6WgJ.js";
import {
  _ as ne,
  c as m,
  g as h,
  l as g,
  n as re,
  p as ie,
  r as _,
  t as v,
  u as y,
} from "./button-DmLv96bj.js";
import {
  a as ae,
  o as b,
  r as x,
  s as S,
  t as oe,
} from "./format-date-DY5h_i7e.js";
import {
  a as se,
  c as C,
  i as ce,
  l as le,
  o as w,
  r as ue,
  s as T,
  t as de,
} from "./select-field-BTL4AK3t.js";
import {
  a as fe,
  f as pe,
  l as E,
  n as me,
  p as D,
  s as he,
  t as O,
  u as k,
} from "./toggle-DZvvq5Oc.js";
import { a as A, i as j, n as M, r as N } from "./useRevealState-BLRULnQh.js";
import { Dn as P, On as F } from "./messages-DLCDPx8W.js";
import { n as ge, t as _e } from "./PasswordGenerator-8BxJvmhr.js";
var ve = y(`Camera`, [
    [
      `path`,
      {
        d: `M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z`,
        key: `1tc9qg`,
      },
    ],
    [`circle`, { cx: `12`, cy: `13`, r: `3`, key: `1vg3eu` }],
  ]),
  I = y(`CreditCard`, [
    [
      `rect`,
      { width: `20`, height: `14`, x: `2`, y: `5`, rx: `2`, key: `ynyp8z` },
    ],
    [`line`, { x1: `2`, x2: `22`, y1: `10`, y2: `10`, key: `1b3vmo` }],
  ]),
  L = y(`FileText`, [
    [
      `path`,
      {
        d: `M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z`,
        key: `1rqfz7`,
      },
    ],
    [`path`, { d: `M14 2v4a2 2 0 0 0 2 2h4`, key: `tnqrlb` }],
    [`path`, { d: `M10 9H8`, key: `b1mrlr` }],
    [`path`, { d: `M16 13H8`, key: `t4e002` }],
    [`path`, { d: `M16 17H8`, key: `z1uh3a` }],
  ]),
  R = y(`Globe`, [
    [`circle`, { cx: `12`, cy: `12`, r: `10`, key: `1mglay` }],
    [
      `path`,
      { d: `M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20`, key: `13o1zl` },
    ],
    [`path`, { d: `M2 12h20`, key: `9i4pu4` }],
  ]),
  z = y(`History`, [
    [
      `path`,
      { d: `M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8`, key: `1357e3` },
    ],
    [`path`, { d: `M3 3v5h5`, key: `1xhq8a` }],
    [`path`, { d: `M12 7v5l4 2`, key: `1fdv2h` }],
  ]),
  ye = y(`Sparkles`, [
    [
      `path`,
      {
        d: `M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z`,
        key: `4pj2yx`,
      },
    ],
    [`path`, { d: `M20 3v4`, key: `1olli1` }],
    [`path`, { d: `M22 5h-4`, key: `1gvqau` }],
    [`path`, { d: `M4 17v2`, key: `vumght` }],
    [`path`, { d: `M5 18H3`, key: `zchphs` }],
  ]),
  B = e(ne(), 1),
  V = h();
function be(e) {
  let t = e.parentElement;
  (t && (t.style.minHeight = `${t.offsetHeight}px`),
    (e.style.overflowY = `hidden`),
    (e.style.height = `auto`));
  let n = e.scrollHeight;
  (n &&
    ((e.style.height = `${n}px`),
    n > Number.parseFloat(getComputedStyle(e).maxHeight) &&
      (e.style.overflowY = `auto`)),
    t && (t.style.minHeight = ``));
}
function H(e, t) {
  (0, B.useLayoutEffect)(() => {
    let n = e.current;
    if (!t || !n) return;
    let r = () => be(n),
      i = Object.getOwnPropertyDescriptor(n, `value`),
      a =
        i ??
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, `value`);
    Object.defineProperty(n, "value", {
      configurable: !0,
      get: () => a?.get?.call(n),
      set: (e) => {
        (a?.set?.call(n, e), r());
      },
    });
    let o = 0,
      s = new ResizeObserver(() => {
        (cancelAnimationFrame(o), (o = requestAnimationFrame(r)));
      });
    return (
      s.observe(n),
      n.addEventListener(`input`, r),
      r(),
      () => {
        (n.removeEventListener(`input`, r),
          s.disconnect(),
          cancelAnimationFrame(o),
          i
            ? Object.defineProperty(n, "value", i)
            : Reflect.deleteProperty(n, `value`));
      }
    );
  }, [e, t]);
}
var U = (0, B.forwardRef)(function (
  {
    label: e,
    error: t,
    className: n,
    disabled: r,
    rows: i = 3,
    autoGrow: a = !1,
    ...s
  },
  c,
) {
  let l = (0, B.useId)(),
    u = !!t,
    d = (0, B.useRef)(null);
  return (
    (0, B.useImperativeHandle)(c, () => d.current, []),
    H(d, a),
    (0, V.jsxs)(`div`, {
      children: [
        (0, V.jsxs)(`div`, {
          className: `group relative`,
          children: [
            (0, V.jsx)(`textarea`, {
              ref: d,
              id: l,
              rows: i,
              disabled: r,
              placeholder: ` `,
              "aria-invalid": u || void 0,
              className: _(
                `peer relative block w-full appearance-none bg-transparent`,
                `px-3 pt-3 pb-3 text-sm text-foreground resize-none`,
                `placeholder-transparent outline-none`,
                `disabled:opacity-50 disabled:cursor-not-allowed`,
                a && `max-h-[60vh]`,
                n,
              ),
              ...s,
            }),
            (0, V.jsx)(o, { label: e, invalid: u, notch: `textarea` }),
            (0, V.jsx)(`label`, {
              htmlFor: l,
              className: _(
                `pointer-events-none absolute left-3 top-3 origin-[0]`,
                `text-sm text-muted-foreground transition-all duration-150`,
                `peer-focus:top-0 peer-focus:-translate-y-1/2 peer-focus:scale-75 peer-focus:text-primary`,
                `peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:-translate-y-1/2 peer-[:not(:placeholder-shown)]:scale-75`,
                u && `text-destructive peer-focus:text-destructive`,
              ),
              children: e,
            }),
          ],
        }),
        t &&
          (0, V.jsx)(`p`, {
            className: `text-xs text-destructive mt-1`,
            children: t,
          }),
      ],
    })
  );
});
function W({ children: e, mono: t, wrap: n }) {
  return (0, V.jsx)(`span`, {
    className: _(
      `block text-sm`,
      t && `font-mono`,
      n ? `break-all max-h-40 overflow-y-auto` : `truncate`,
    ),
    children: e,
  });
}
function G({ value: e }) {
  return (0, V.jsx)(`span`, {
    className: `block`,
    children: Array.from(e, (e, t) =>
      (0, V.jsx)(
        `span`,
        {
          "data-pos": t + 1,
          className: `mr-0.5 mb-1.5 inline-block min-w-3.5 text-center align-top whitespace-pre after:block after:font-sans after:text-[10px] after:leading-none after:text-muted-foreground after:tabular-nums after:content-[attr(data-pos)_/_'']`,
          children: e,
        },
        t,
      ),
    ),
  });
}
function K({
  label: e,
  children: t,
  copied: n,
  copyName: r,
  onCopy: i,
  extraAction: a,
}) {
  let { _: o } = g(),
    s = r ? n === r : !1;
  return (0, V.jsxs)(`div`, {
    className: `flex items-center gap-2 px-3 py-2.5`,
    children: [
      (0, V.jsx)(`div`, { className: `flex-1 min-w-0`, children: t }),
      a,
      (0, V.jsx)(v, {
        variant: `ghost`,
        size: `none`,
        onClick: i,
        className: `p-1.5 rounded-md`,
        "aria-label": o({ id: `K3rHrY`, values: { 0: e.toLowerCase() } }),
        children: s
          ? (0, V.jsx)(C, { className: `w-3.5 h-3.5 text-primary` })
          : (0, V.jsx)(w, { className: `w-3.5 h-3.5` }),
      }),
    ],
  });
}
function q({ label: e, children: t }) {
  return (0, V.jsxs)(`div`, {
    className: `space-y-1.5`,
    children: [
      (0, V.jsx)(`p`, {
        className: `text-xs text-muted-foreground`,
        children: e,
      }),
      (0, V.jsx)(`div`, {
        className: `rounded-md border border-border/50 divide-y divide-border/50`,
        children: t,
      }),
    ],
  });
}
var J = Object.assign(
  function (e) {
    return (0, V.jsx)(q, { label: e.label, children: (0, V.jsx)(K, { ...e }) });
  },
  { Group: q, Item: K },
);
function Y({ label: e, value: t, copied: n, copy: r }) {
  let { _: i } = g();
  return (0, V.jsxs)(`div`, {
    className: `space-y-1.5`,
    children: [
      (0, V.jsxs)(`div`, {
        className: `flex items-center justify-between`,
        children: [
          (0, V.jsx)(`p`, {
            className: `text-xs text-muted-foreground`,
            children: e,
          }),
          (0, V.jsx)(v, {
            variant: `ghost`,
            size: `none`,
            onClick: () => r(`notes`, t),
            className: `p-1.5 rounded-md`,
            "aria-label": i({ id: `K3rHrY`, values: { 0: e.toLowerCase() } }),
            children:
              n === `notes`
                ? (0, V.jsx)(C, { className: `w-3.5 h-3.5 text-primary` })
                : (0, V.jsx)(w, { className: `w-3.5 h-3.5` }),
          }),
        ],
      }),
      (0, V.jsx)(`p`, {
        className: `text-sm whitespace-pre-wrap`,
        "data-selectable": !0,
        children: t || `-`,
      }),
    ],
  });
}
function X(e) {
  return e.replace(/\D/g, ``).slice(-4);
}
function xe(e) {
  let n = X(e.number);
  return [e.brand ?? t(e.number), n ? `•••• ${n}` : ``]
    .filter(Boolean)
    .join(` `);
}
function Z(e) {
  return [e.expMonth, e.expYear].filter(Boolean).join(` / `);
}
function Se() {
  let {
      register: e,
      formState: { errors: t },
    } = E(),
    { _: r } = g(),
    [i, o] = M(!1),
    [s, d] = M(!1),
    f = (e) => {
      switch (u(e ?? ``)) {
        case `non-digit`:
          return r({ id: `gktl-I` });
        case `length`:
          return r({ id: `Ex9N__` });
        case `brand-length`:
          return r({ id: `oRm_fy` });
        case `checksum`:
          return r({ id: `3OhHqZ` });
        default:
          return !0;
      }
    },
    p = (e) => {
      switch (n(e ?? ``)) {
        case `non-digit`:
          return r({ id: `_amZzD` });
        case `range`:
          return r({ id: `0_cDgL` });
        default:
          return !0;
      }
    },
    ee = (e) => {
      switch (a(e ?? ``)) {
        case `non-digit`:
          return r({ id: `_amZzD` });
        case `length`:
          return r({ id: `aCxS7f` });
        case `range`:
          return r({ id: `B0nBVg` });
        default:
          return !0;
      }
    },
    te = (e) => {
      switch (c(e ?? ``)) {
        case `non-digit`:
          return r({ id: `_amZzD` });
        case `length`:
          return r({ id: `EeX95S` });
        default:
          return !0;
      }
    };
  return (0, V.jsxs)(V.Fragment, {
    children: [
      (0, V.jsx)(l, {
        label: r({ id: `6YtxFj` }),
        type: `text`,
        autoComplete: `off`,
        ...e(`name`),
      }),
      (0, V.jsx)(l, {
        label: r({ id: `-Yj5xu` }),
        type: `text`,
        autoComplete: `off`,
        ...e(`cardholderName`),
      }),
      (0, V.jsx)(l, {
        label: r({ id: `xHIEQ5` }),
        type: i ? `text` : `password`,
        inputMode: `numeric`,
        autoComplete: `off`,
        className: `font-mono`,
        error: t.number?.message,
        maxLength: 23,
        endAdornment: (0, V.jsx)(v, {
          variant: `ghost`,
          size: `none`,
          onClick: () => o((e) => !e),
          className: `p-1.5 rounded-md`,
          "aria-label": r(i ? { id: `x780jN` } : { id: `YTQt39` }),
          children: i
            ? (0, V.jsx)(A, { className: `w-3.5 h-3.5` })
            : (0, V.jsx)(j, { className: `w-3.5 h-3.5` }),
        }),
        ...e(`number`, { validate: f }),
      }),
      (0, V.jsxs)(`div`, {
        className: `grid grid-cols-3 gap-3`,
        children: [
          (0, V.jsx)(l, {
            label: r({ id: `N8za-k` }),
            type: `text`,
            inputMode: `numeric`,
            autoComplete: `off`,
            maxLength: 2,
            error: t.expMonth?.message,
            ...e(`expMonth`, { validate: p }),
          }),
          (0, V.jsx)(l, {
            label: r({ id: `xL6xKK` }),
            type: `text`,
            inputMode: `numeric`,
            autoComplete: `off`,
            maxLength: 4,
            error: t.expYear?.message,
            ...e(`expYear`, { validate: ee }),
          }),
          (0, V.jsx)(l, {
            label: r({ id: `1F4FGR` }),
            type: s ? `text` : `password`,
            inputMode: `numeric`,
            autoComplete: `off`,
            maxLength: 4,
            error: t.cvv?.message,
            endAdornment: (0, V.jsx)(v, {
              variant: `ghost`,
              size: `none`,
              onClick: () => d((e) => !e),
              className: `p-1.5 rounded-md`,
              "aria-label": r(s ? { id: `JmvM05` } : { id: `Y_pkUD` }),
              children: s
                ? (0, V.jsx)(A, { className: `w-3.5 h-3.5` })
                : (0, V.jsx)(j, { className: `w-3.5 h-3.5` }),
            }),
            ...e(`cvv`, { validate: te }),
          }),
        ],
      }),
      (0, V.jsx)(U, {
        label: r({ id: `4aIVmV` }),
        rows: 2,
        autoGrow: !0,
        ...e(`notes`),
      }),
    ],
  });
}
function Ce({ entry: e, copied: t, copy: n }) {
  let a = e,
    { _: o } = g(),
    [s, c] = M(!1),
    [l, u] = M(!1),
    d = Z(a);
  return (0, V.jsxs)(V.Fragment, {
    children: [
      (0, V.jsx)(J, {
        label: o({ id: `-Yj5xu` }),
        copied: t,
        copyName: `cardholder name`,
        onCopy: () => n(`cardholder name`, a.cardholderName),
        children: (0, V.jsx)(W, { children: a.cardholderName || `-` }),
      }),
      (0, V.jsx)(J, {
        label: o({ id: `xHIEQ5` }),
        copied: t,
        copyName: `card number`,
        onCopy: () => n(`card number`, r(a.number)),
        extraAction: (0, V.jsx)(v, {
          variant: `ghost`,
          size: `none`,
          onClick: () => c((e) => !e),
          className: `p-1.5 rounded-md`,
          "aria-label": o(s ? { id: `x780jN` } : { id: `YTQt39` }),
          children: s
            ? (0, V.jsx)(A, { className: `w-3.5 h-3.5` })
            : (0, V.jsx)(j, { className: `w-3.5 h-3.5` }),
        }),
        children: (0, V.jsx)(W, {
          mono: !0,
          wrap: s,
          children: s ? i(a.number) : `•••• ${X(a.number)}`,
        }),
      }),
      (0, V.jsxs)(`div`, {
        className: `grid grid-cols-2 gap-3`,
        children: [
          (0, V.jsx)(J, {
            label: o({ id: `KnN1Tu` }),
            copied: t,
            copyName: `expiry`,
            onCopy: () => n(`expiry`, d),
            children: (0, V.jsx)(W, { mono: !0, children: d || `-` }),
          }),
          (0, V.jsx)(J, {
            label: o({ id: `1F4FGR` }),
            copied: t,
            copyName: `CVV`,
            onCopy: () => n(`CVV`, a.cvv),
            extraAction: (0, V.jsx)(v, {
              variant: `ghost`,
              size: `none`,
              onClick: () => u((e) => !e),
              className: `p-1.5 rounded-md`,
              "aria-label": o(l ? { id: `JmvM05` } : { id: `Y_pkUD` }),
              children: l
                ? (0, V.jsx)(A, { className: `w-3.5 h-3.5` })
                : (0, V.jsx)(j, { className: `w-3.5 h-3.5` }),
            }),
            children: (0, V.jsx)(W, {
              mono: !0,
              wrap: l,
              children: l ? a.cvv : `•`.repeat(a.cvv.length),
            }),
          }),
        ],
      }),
      a.notes &&
        (0, V.jsx)(Y, {
          label: o({ id: `1DBGsz` }),
          value: a.notes,
          copied: t,
          copy: n,
        }),
    ],
  });
}
var we = {
  type: `card`,
  get label() {
    return S._({ id: `42CzFY` });
  },
  get description() {
    return S._({ id: `acRER3` });
  },
  icon: I,
  emptyForm: () => ({
    name: ``,
    cardholderName: ``,
    number: ``,
    expMonth: ``,
    expYear: ``,
    cvv: ``,
    notes: ``,
  }),
  toForm: (e) => {
    let t = e;
    return {
      name: t.name,
      cardholderName: t.cardholderName,
      number: t.number,
      expMonth: t.expMonth,
      expYear: t.expYear,
      cvv: t.cvv,
      notes: t.notes ?? ``,
    };
  },
  toEntry: (e) => {
    let n = e;
    return {
      type: `card`,
      name: n.name,
      cardholderName: n.cardholderName,
      number: n.number,
      brand: t(n.number),
      expMonth: n.expMonth,
      expYear: n.expYear,
      cvv: n.cvv,
      notes: n.notes || void 0,
    };
  },
  Fields: Se,
  Detail: Ce,
  detailSubtitle: (e) => xe(e) || void 0,
  row: (e) => {
    let t = e;
    return {
      icon: I,
      secondary: xe(t) || S._({ id: `42CzFY` }),
      copyItems: [
        ...(t.number
          ? [{ label: S._({ id: `cQOi_5` }), value: r(t.number) }]
          : []),
        ...(Z(t) ? [{ label: S._({ id: `7ekmhR` }), value: Z(t) }] : []),
        ...(t.cvv ? [{ label: S._({ id: `1F4FGR` }), value: t.cvv }] : []),
      ],
    };
  },
  searchText: (e) => {
    let n = e,
      r = n.brand ?? t(n.number) ?? ``;
    return `${n.cardholderName} ${r} ${X(n.number)}`.toLowerCase();
  },
};
function Te({ href: e, entryId: t, onOpen: n }) {
  let { _: r } = g(),
    { shell: i } = ie();
  return (0, V.jsx)(`a`, {
    href: e,
    target: `_blank`,
    rel: `noreferrer noopener`,
    onClick: (r) => {
      n?.();
      let a = !r.ctrlKey && !r.metaKey && !r.shiftKey && !r.altKey;
      t && a && i?.launchLogin && (r.preventDefault(), i.launchLogin(t, e));
    },
    className: _(re({ variant: `ghost`, size: `none` }), `p-1.5 rounded-md`),
    "aria-label": r({ id: `yxTdsJ` }),
    title: r({ id: `yxTdsJ` }),
    children: (0, V.jsx)(D, { className: `w-3.5 h-3.5` }),
  });
}
function Ee({ open: e, onClose: t, onUse: n, useLabel: r }) {
  return (0, V.jsx)(k, {
    open: e,
    onClose: t,
    children: (0, V.jsxs)(`div`, {
      className: `p-5 space-y-4`,
      children: [
        (0, V.jsx)(`h3`, {
          className: `text-base`,
          children: (0, V.jsx)(m, { id: `19BWU3` }),
        }),
        (0, V.jsx)(_e, {
          onUse: (e) => {
            (n(e), t());
          },
          onCancel: t,
          useLabel: r,
        }),
      ],
    }),
  });
}
function De({ totp: e, copied: t, onCopy: n }) {
  let { _: r } = g(),
    [i, a] = (0, B.useState)(() => Date.now());
  (0, B.useEffect)(() => {
    let e = setInterval(() => a(Date.now()), 1e3);
    return () => clearInterval(e);
  }, []);
  let { code: o, secondsRemaining: s } = p(e, i);
  return (0, V.jsxs)(`div`, {
    className: `flex items-center justify-between gap-3`,
    children: [
      (0, V.jsx)(`div`, {
        className: `flex items-baseline gap-3 font-mono text-2xl tracking-wider tabular-nums`,
        children:
          o.length === 6
            ? (0, V.jsxs)(V.Fragment, {
                children: [
                  (0, V.jsx)(`span`, { children: o.slice(0, 3) }),
                  (0, V.jsx)(`span`, { children: o.slice(3) }),
                ],
              })
            : (0, V.jsx)(`span`, { children: o }),
      }),
      (0, V.jsxs)(`div`, {
        className: `flex items-center gap-3`,
        children: [
          (0, V.jsx)(Oe, { remaining: s, period: e.period }),
          (0, V.jsx)(v, {
            variant: `ghost`,
            size: `none`,
            onClick: () => n(o),
            className: `p-1.5 rounded-md`,
            "aria-label": r({ id: `bId_5q` }),
            children: t
              ? (0, V.jsx)(C, { className: `w-4 h-4 text-primary` })
              : (0, V.jsx)(w, { className: `w-4 h-4` }),
          }),
        ],
      }),
    ],
  });
}
function Oe({ remaining: e, period: t }) {
  let { _: n } = g(),
    r = 2 * Math.PI * 11,
    i = Math.max(0, Math.min(1, e / t)),
    a = e <= 5;
  return (0, V.jsxs)(`div`, {
    className: `relative flex items-center justify-center w-7 h-7`,
    title: n({ id: `IeCBVp`, values: { remaining: e } }),
    children: [
      (0, V.jsxs)(`svg`, {
        width: `28`,
        height: `28`,
        viewBox: `0 0 28 28`,
        className: `-rotate-90`,
        "aria-hidden": `true`,
        children: [
          (0, V.jsx)(`circle`, {
            cx: `14`,
            cy: `14`,
            r: 11,
            fill: `none`,
            strokeWidth: `2`,
            className: `stroke-muted`,
          }),
          (0, V.jsx)(`circle`, {
            cx: `14`,
            cy: `14`,
            r: 11,
            fill: `none`,
            strokeWidth: `2`,
            strokeLinecap: `round`,
            strokeDasharray: r,
            strokeDashoffset: r * (1 - i),
            className: a ? `stroke-destructive` : `stroke-foreground`,
            style: { transition: `stroke-dashoffset 1s linear` },
          }),
        ],
      }),
      (0, V.jsx)(`span`, {
        className: `absolute text-[10px] tabular-nums ${a ? `text-destructive` : `text-muted-foreground`}`,
        children: e,
      }),
    ],
  });
}
function ke({ initialBreach: e }) {
  let {
      register: t,
      control: n,
      watch: r,
      setValue: i,
      getValues: a,
      setFocus: o,
    } = E(),
    { shell: c } = ie(),
    { prefs: u } = s(),
    { _: d } = g(),
    [p, ne] = M(!1),
    { fields: h, append: re, remove: _ } = he({ control: n, name: `urls` }),
    y = r(`urls`),
    [b, x] = (0, B.useState)(null);
  (0, B.useEffect)(() => {
    let e = !1;
    return (
      c
        .getCurrentTabOrigin()
        .then((t) => {
          e || x(t);
        })
        .catch(() => {}),
      () => {
        e = !0;
      }
    );
  }, [c]);
  let S = (e, t) => {
      (i(`urls.${e}.value`, t, { shouldDirty: !0 }), o(`urls.${e}.value`));
    },
    [C, w] = (0, B.useState)(!1),
    T = ue(),
    [D, O] = (0, B.useState)({ kind: `idle` }),
    [k, P] = (0, B.useState)({ kind: `idle` }),
    [F, _e] = M(!1),
    [I] = (0, B.useState)(() => a(`password`)),
    L = r(`passkeys`) ?? [],
    R = (e) =>
      i(
        `passkeys`,
        L.filter((t) => t.credentialId !== e),
        { shouldDirty: !0 },
      ),
    z = r(`password`),
    be = e?.leaked === !0 && z === I,
    H = (e) => i(`password`, e, { shouldDirty: !0, shouldValidate: !0 }),
    W = async () => H(await te(u.generator)),
    G = async () => {
      O({ kind: `busy` });
      try {
        (i(`username`, await T.generate(ge(a(`urls`)?.[0]?.value)), {
          shouldDirty: !0,
          shouldValidate: !0,
        }),
          O({ kind: `idle` }));
      } catch (e) {
        O({ kind: `error`, message: ee(e) });
      }
    },
    K = async () => {
      P({ kind: `scanning` });
      try {
        let {
          uri: e,
          failure: t,
          vendor: n,
        } = f(await c.scanQrFromActiveTab());
        e
          ? (i(`totp`, e, { shouldDirty: !0 }), P({ kind: `idle` }))
          : P({ kind: `failed`, failure: t ?? `not-totp`, vendor: n });
      } catch {
        P({ kind: `failed`, failure: `not-found` });
      }
    },
    q = () => {
      if (k.kind !== `failed`) return d({ id: `_GtRNj` });
      switch (k.failure) {
        case `vendor-app`:
          return d({
            id: `bXs4aR`,
            values: { 0: k.vendor ?? `another authenticator app` },
          });
        case `migration`:
          return d({ id: `Gm7hh2` });
        case `not-totp`:
          return d({ id: `rFeP0B` });
        default:
          return d({ id: `fSQ9Sn` });
      }
    };
  return (0, V.jsxs)(V.Fragment, {
    children: [
      (0, V.jsx)(l, { label: d({ id: `6YtxFj` }), type: `text`, ...t(`name`) }),
      (0, V.jsxs)(`div`, {
        children: [
          (0, V.jsxs)(`div`, {
            className: `flex items-center justify-between mb-2`,
            children: [
              (0, V.jsx)(`span`, {
                className: `block text-sm`,
                children: (0, V.jsx)(m, { id: `1J9wMe` }),
              }),
              (0, V.jsxs)(v, {
                variant: `secondary`,
                size: `none`,
                onClick: () => re({ value: `` }),
                className: `flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md`,
                children: [
                  (0, V.jsx)(ae, { className: `w-3 h-3` }),
                  (0, V.jsx)(m, { id: `dn-x7E` }),
                ],
              }),
            ],
          }),
          h.length > 0
            ? (0, V.jsx)(`div`, {
                className: `space-y-2`,
                children: h.map((e, n) =>
                  (0, V.jsxs)(
                    `div`,
                    {
                      className: `flex gap-2 items-start`,
                      children: [
                        (0, V.jsx)(`div`, {
                          className: `flex-1`,
                          children: (0, V.jsx)(l, {
                            label: d({ id: `XYcw7G` }),
                            type: `url`,
                            autoComplete: `off`,
                            endAdornment:
                              b && !y?.[n]?.value?.trim()
                                ? (0, V.jsx)(v, {
                                    variant: `ghost`,
                                    size: `none`,
                                    onClick: () => S(n, b),
                                    className: `p-1.5 rounded-md`,
                                    "aria-label": d({ id: `P5P4p2` }),
                                    title: d({
                                      id: `3bWH5l`,
                                      values: { currentSite: b },
                                    }),
                                    children: (0, V.jsx)(ae, {
                                      className: `w-3.5 h-3.5`,
                                    }),
                                  })
                                : void 0,
                            ...t(`urls.${n}.value`),
                          }),
                        }),
                        (0, V.jsx)(v, {
                          variant: `ghost`,
                          size: `icon`,
                          onClick: () => _(n),
                          className: `mt-2 shrink-0 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30`,
                          "aria-label": d({ id: `ErYkP_` }),
                          children: (0, V.jsx)(pe, { className: `w-4 h-4` }),
                        }),
                      ],
                    },
                    e.id,
                  ),
                ),
              })
            : (0, V.jsx)(`p`, {
                className: `text-xs text-muted-foreground`,
                children: (0, V.jsx)(m, { id: `yYxdmB` }),
              }),
        ],
      }),
      (0, V.jsxs)(`div`, {
        children: [
          (0, V.jsx)(`span`, {
            className: `block text-sm mb-2`,
            children: (0, V.jsx)(m, { id: `URmyfc` }),
          }),
          (0, V.jsxs)(`div`, {
            className: `space-y-3`,
            children: [
              (0, V.jsxs)(`div`, {
                children: [
                  (0, V.jsx)(l, {
                    label: d({ id: `5E4MzW` }),
                    type: `text`,
                    autoComplete: `off`,
                    endAdornment: T.enabled
                      ? (0, V.jsx)(v, {
                          variant: `ghost`,
                          size: `none`,
                          onClick: G,
                          disabled: D.kind === `busy`,
                          className: `p-1.5 rounded-md`,
                          "aria-label": d({ id: `K9aTF3` }),
                          children:
                            D.kind === `busy`
                              ? (0, V.jsx)(se, {
                                  className: `w-3.5 h-3.5 animate-spin`,
                                })
                              : (0, V.jsx)(le, { className: `w-3.5 h-3.5` }),
                        })
                      : void 0,
                    ...t(`username`),
                  }),
                  D.kind === `error` &&
                    (0, V.jsx)(`p`, {
                      className: `mt-1.5 text-xs text-destructive`,
                      children: D.message,
                    }),
                ],
              }),
              (0, V.jsxs)(`div`, {
                children: [
                  (0, V.jsx)(l, {
                    label: d({ id: `8ZsakT` }),
                    type: p ? `text` : `password`,
                    autoComplete: `off`,
                    endAdornment: (0, V.jsxs)(V.Fragment, {
                      children: [
                        (0, V.jsx)(v, {
                          variant: `ghost`,
                          size: `none`,
                          onClick: W,
                          className: `p-1.5 rounded-md`,
                          "aria-label": d({ id: `19BWU3` }),
                          children: (0, V.jsx)(ce, {
                            className: `w-3.5 h-3.5`,
                          }),
                        }),
                        (0, V.jsx)(v, {
                          variant: `ghost`,
                          size: `none`,
                          onClick: () => ne(!p),
                          className: `p-1.5 rounded-md`,
                          "aria-label": d(
                            p ? { id: `Pw01g0` } : { id: `7C-Jn5` },
                          ),
                          children: p
                            ? (0, V.jsx)(A, { className: `w-3.5 h-3.5` })
                            : (0, V.jsx)(j, { className: `w-3.5 h-3.5` }),
                        }),
                      ],
                    }),
                    ...t(`password`),
                  }),
                  (0, V.jsx)(me, {
                    value: z,
                    label: d({ id: `osAB4a` }),
                    breached: be,
                    className: `mt-2.5`,
                  }),
                  (0, V.jsxs)(v, {
                    variant: `secondary`,
                    size: `none`,
                    onClick: () => w(!0),
                    className: `mt-3 flex items-center gap-2 px-3 py-1.5 text-xs border-primary/50 bg-primary/5 text-primary hover:bg-primary/10`,
                    children: [
                      (0, V.jsx)(ye, { className: `w-3.5 h-3.5` }),
                      (0, V.jsx)(m, { id: `i6S8Ei` }),
                    ],
                  }),
                  (0, V.jsx)(Ee, { open: C, onClose: () => w(!1), onUse: H }),
                ],
              }),
              (0, V.jsxs)(`div`, {
                children: [
                  (0, V.jsx)(l, {
                    label: d({ id: `3RG_6_` }),
                    type: F ? `text` : `password`,
                    autoComplete: `off`,
                    endAdornment: (0, V.jsxs)(V.Fragment, {
                      children: [
                        (0, V.jsx)(v, {
                          variant: `ghost`,
                          size: `none`,
                          onClick: K,
                          disabled: k.kind === `scanning`,
                          className: `p-1.5 rounded-md`,
                          "aria-label": d({ id: `Bky5fY` }),
                          title: d({ id: `7nLXf1` }),
                          children:
                            k.kind === `scanning`
                              ? (0, V.jsx)(se, {
                                  className: `w-3.5 h-3.5 animate-spin`,
                                })
                              : (0, V.jsx)(ve, { className: `w-3.5 h-3.5` }),
                        }),
                        (0, V.jsx)(v, {
                          variant: `ghost`,
                          size: `none`,
                          onClick: () => _e((e) => !e),
                          className: `p-1.5 rounded-md`,
                          "aria-label": d(
                            F ? { id: `CADM83` } : { id: `lXA9vC` },
                          ),
                          children: F
                            ? (0, V.jsx)(A, { className: `w-3.5 h-3.5` })
                            : (0, V.jsx)(j, { className: `w-3.5 h-3.5` }),
                        }),
                      ],
                    }),
                    ...t(`totp`),
                  }),
                  (0, V.jsx)(`p`, {
                    className: `text-xs mt-1.5 ${k.kind === `failed` ? `text-destructive` : `text-muted-foreground`}`,
                    children: q(),
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      L.length > 0 &&
        (0, V.jsxs)(`div`, {
          children: [
            (0, V.jsx)(`span`, {
              className: `block text-sm mb-2`,
              children: (0, V.jsx)(m, { id: `UZKLEA` }),
            }),
            (0, V.jsx)(`div`, {
              className: `space-y-2`,
              children: L.map((e) =>
                (0, V.jsxs)(
                  `div`,
                  {
                    className: `flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border bg-muted/30`,
                    children: [
                      (0, V.jsx)(N, {
                        className: `w-4 h-4 text-primary shrink-0`,
                      }),
                      (0, V.jsxs)(`div`, {
                        className: `min-w-0 flex-1`,
                        children: [
                          (0, V.jsx)(`div`, {
                            className: `text-sm truncate`,
                            children: e.userName || e.userDisplayName || e.rpId,
                          }),
                          (0, V.jsxs)(`div`, {
                            className: `text-xs text-muted-foreground truncate`,
                            children: [
                              e.rpId,
                              e.createdAt ? ` · ${oe(e.createdAt)}` : ``,
                            ],
                          }),
                        ],
                      }),
                      (0, V.jsx)(v, {
                        variant: `ghost`,
                        size: `icon`,
                        onClick: () => R(e.credentialId),
                        className: `shrink-0 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30`,
                        "aria-label": d({ id: `IGepJ3` }),
                        children: (0, V.jsx)(pe, { className: `w-4 h-4` }),
                      }),
                    ],
                  },
                  e.credentialId,
                ),
              ),
            }),
            (0, V.jsx)(`p`, {
              className: `text-xs text-muted-foreground mt-1.5`,
              children: (0, V.jsx)(m, { id: `8g-klg` }),
            }),
          ],
        }),
      (0, V.jsx)(U, {
        label: d({ id: `4aIVmV` }),
        rows: 3,
        autoGrow: !0,
        ...t(`notes`),
      }),
      (0, V.jsxs)(fe, {
        children: [
          (0, V.jsx)(Ae, {
            title: d({ id: `gm0ulD` }),
            subtitle: d({ id: `osfZ5h` }),
            checked: r(`autofillEnabled`),
            onChange: (e) => i(`autofillEnabled`, e, { shouldDirty: !0 }),
          }),
          (0, V.jsx)(Ae, {
            title: d({ id: `zcJNip` }),
            subtitle: d({ id: `KBOMek` }),
            checked: r(`autoSubmit`),
            onChange: (e) => i(`autoSubmit`, e, { shouldDirty: !0 }),
          }),
          (0, V.jsxs)(`div`, {
            children: [
              (0, V.jsxs)(de, {
                label: d({ id: `JcbCHt` }),
                ...t(`subdomainMatch`),
                children: [
                  (0, V.jsx)(`option`, {
                    value: `etld1`,
                    children: d({ id: `pNZYTa` }),
                  }),
                  (0, V.jsx)(`option`, {
                    value: `exact`,
                    children: d({ id: `PWPBTG` }),
                  }),
                  (0, V.jsx)(`option`, {
                    value: `subdomain`,
                    children: d({ id: `XY7UWx` }),
                  }),
                ],
              }),
              (0, V.jsx)(`p`, {
                className: `text-xs text-muted-foreground mt-1.5`,
                children: (0, V.jsx)(m, { id: `ZX7Xhz` }),
              }),
            ],
          }),
        ],
      }),
    ],
  });
}
function Ae({ title: e, subtitle: t, checked: n, onChange: r }) {
  return (0, V.jsxs)(`div`, {
    className: `flex items-start justify-between gap-3`,
    children: [
      (0, V.jsxs)(`div`, {
        className: `min-w-0`,
        children: [
          (0, V.jsx)(`p`, { className: `text-sm`, children: e }),
          (0, V.jsx)(`p`, {
            className: `text-xs text-muted-foreground mt-0.5`,
            children: t,
          }),
        ],
      }),
      (0, V.jsx)(O, { checked: n, onChange: r, label: e }),
    ],
  });
}
function je({ value: e, copied: t, copy: n }) {
  let r = (0, B.useMemo)(() => d(e), [e]);
  return r
    ? (0, V.jsxs)(`div`, {
        className: `border-t border-border/40 pt-3 space-y-2`,
        children: [
          (0, V.jsx)(`p`, {
            className: `text-sm text-muted-foreground`,
            children: (0, V.jsx)(m, { id: `lT2niU` }),
          }),
          (0, V.jsx)(De, {
            totp: r.totp,
            copied: t === `totp`,
            onCopy: (e) => n(`totp`, e),
          }),
        ],
      })
    : (0, V.jsxs)(`div`, {
        className: `border-t border-border/40 pt-3 space-y-1.5`,
        children: [
          (0, V.jsx)(`p`, {
            className: `text-sm text-muted-foreground`,
            children: (0, V.jsx)(m, { id: `lT2niU` }),
          }),
          (0, V.jsx)(`p`, {
            className: `text-sm text-destructive`,
            children: (0, V.jsx)(m, { id: `gV1fQ4` }),
          }),
        ],
      });
}
function Me({ changelog: e, copied: t, copy: n }) {
  let { _: r } = g(),
    [i, a] = (0, B.useState)(!1),
    [o, s] = M(new Set()),
    c = (e) => {
      s((t) => {
        let n = new Set(t);
        return (n.delete(e) || n.add(e), n);
      });
    },
    l = e[0].changedAt;
  return (0, V.jsxs)(`div`, {
    className: `space-y-1.5`,
    children: [
      (0, V.jsxs)(v, {
        variant: `link`,
        size: `none`,
        onClick: () => a((e) => !e),
        className: `gap-1.5 text-xs`,
        "aria-expanded": i,
        children: [
          i
            ? (0, V.jsx)(T, { className: `w-3 h-3 shrink-0` })
            : (0, V.jsx)(b, { className: `w-3 h-3 shrink-0` }),
          (0, V.jsx)(z, { className: `w-3 h-3 shrink-0` }),
          (0, V.jsx)(`span`, {
            className: `truncate`,
            children: r({ id: `N7JCDk`, values: { 0: x(l) } }),
          }),
        ],
      }),
      i &&
        (0, V.jsx)(`div`, {
          className: `space-y-1.5`,
          children: e.map((e, i) => {
            let a = `password-changelog-${i}`,
              s = o.has(i);
            return (0, V.jsxs)(
              `div`,
              {
                className: `flex items-center gap-2 px-3 py-2 rounded-md border border-border/50 bg-muted/20`,
                children: [
                  (0, V.jsxs)(`div`, {
                    className: `flex-1 min-w-0`,
                    children: [
                      (0, V.jsx)(W, {
                        mono: !0,
                        wrap: s,
                        children: s
                          ? e.value
                          : `•`.repeat(Math.min(e.value.length, 16)),
                      }),
                      (0, V.jsx)(`span`, {
                        className: `block text-[10px] text-muted-foreground tabular-nums`,
                        children: r({
                          id: `hqDBFZ`,
                          values: { 0: x(e.changedAt) },
                        }),
                      }),
                    ],
                  }),
                  (0, V.jsx)(v, {
                    variant: `ghost`,
                    size: `none`,
                    onClick: () => c(i),
                    className: `p-1.5 rounded-md`,
                    "aria-label": r(s ? { id: `Be5481` } : { id: `jRtvbH` }),
                    children: s
                      ? (0, V.jsx)(A, { className: `w-3.5 h-3.5` })
                      : (0, V.jsx)(j, { className: `w-3.5 h-3.5` }),
                  }),
                  (0, V.jsx)(v, {
                    variant: `ghost`,
                    size: `none`,
                    onClick: () => n(a, e.value),
                    className: `p-1.5 rounded-md`,
                    "aria-label": r({ id: `6Djk1f` }),
                    children:
                      t === a
                        ? (0, V.jsx)(C, {
                            className: `w-3.5 h-3.5 text-primary`,
                          })
                        : (0, V.jsx)(w, { className: `w-3.5 h-3.5` }),
                  }),
                ],
              },
              `${e.changedAt}-${i}`,
            );
          }),
        }),
    ],
  });
}
function Ne({ entry: e, copied: t, copy: n }) {
  let r = e,
    { _: i } = g(),
    [a, o] = M(!1);
  return (0, V.jsxs)(V.Fragment, {
    children: [
      r.urls.length > 0 &&
        (0, V.jsx)(J.Group, {
          label: r.urls.length > 1 ? i({ id: `1J9wMe` }) : i({ id: `On0aF2` }),
          children: r.urls.map((a, o) => {
            let s = r.urls.length === 1 ? `website` : `website-${o}`,
              c = F(a);
            return (0, V.jsx)(
              J.Item,
              {
                label: i({ id: `On0aF2` }),
                copied: t,
                copyName: s,
                onCopy: () => n(s, a),
                extraAction: c && (0, V.jsx)(Te, { href: c, entryId: e.id }),
                children: (0, V.jsxs)(`div`, {
                  className: `flex items-center gap-2 text-sm`,
                  children: [
                    (0, V.jsx)(R, {
                      className: `w-3.5 h-3.5 text-muted-foreground shrink-0`,
                    }),
                    (0, V.jsx)(`span`, { className: `truncate`, children: a }),
                  ],
                }),
              },
              `${a}-${o}`,
            );
          }),
        }),
      (0, V.jsx)(J, {
        label: i({ id: `7sNhEz` }),
        copied: t,
        copyName: `username`,
        onCopy: () => n(`username`, r.username),
        children: (0, V.jsx)(W, { children: r.username || `-` }),
      }),
      (0, V.jsx)(J, {
        label: i({ id: `8ZsakT` }),
        copied: t,
        copyName: `password`,
        onCopy: () => n(`password`, r.password),
        extraAction: (0, V.jsx)(v, {
          variant: `ghost`,
          size: `none`,
          onClick: () => o((e) => !e),
          className: `p-1.5 rounded-md`,
          "aria-label": i(a ? { id: `Pw01g0` } : { id: `7C-Jn5` }),
          children: a
            ? (0, V.jsx)(A, { className: `w-3.5 h-3.5` })
            : (0, V.jsx)(j, { className: `w-3.5 h-3.5` }),
        }),
        children: (0, V.jsx)(W, {
          mono: !0,
          wrap: a,
          children: a
            ? (0, V.jsx)(G, { value: r.password })
            : `•`.repeat(Math.min(r.password.length, 16)),
        }),
      }),
      r.passwordChangelog &&
        r.passwordChangelog.length > 0 &&
        (0, V.jsx)(Me, { changelog: r.passwordChangelog, copied: t, copy: n }),
      r.totp && (0, V.jsx)(je, { value: r.totp, copied: t, copy: n }),
      r.passkeys &&
        r.passkeys.length > 0 &&
        (0, V.jsxs)(`div`, {
          className: `space-y-1.5`,
          children: [
            (0, V.jsx)(`p`, {
              className: `text-xs text-muted-foreground`,
              children: (0, V.jsx)(m, { id: `UZKLEA` }),
            }),
            (0, V.jsx)(`div`, {
              className: `flex flex-wrap gap-1.5`,
              children: r.passkeys.map((e) =>
                (0, V.jsxs)(
                  `span`,
                  {
                    className: `inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded-md bg-primary/10 text-primary border border-primary/20`,
                    title: i({ id: `UeGJeu` }),
                    children: [
                      (0, V.jsx)(N, { className: `w-3 h-3` }),
                      e.userName || e.userDisplayName || e.rpId,
                    ],
                  },
                  e.credentialId,
                ),
              ),
            }),
            r.passkeys.some((e) => P(e.rpId)) &&
              (0, V.jsx)(`p`, {
                className: `text-xs text-muted-foreground`,
                children: (0, V.jsx)(m, { id: `nBOWie` }),
              }),
          ],
        }),
      r.notes &&
        (0, V.jsx)(Y, {
          label: i({ id: `1DBGsz` }),
          value: r.notes,
          copied: t,
          copy: n,
        }),
    ],
  });
}
function Pe(e) {
  if (!e) return ``;
  try {
    return new URL(e).hostname.replace(/^www\./, ``);
  } catch {
    return ``;
  }
}
var Q = {
  type: `login`,
  get label() {
    return S._({ id: `z0t9bb` });
  },
  get description() {
    return S._({ id: `LJw43F` });
  },
  icon: R,
  emptyForm: ({ defaultUrl: e }) => ({
    name: Pe(e),
    urls: e ? [{ value: e }] : [],
    username: ``,
    password: ``,
    totp: ``,
    notes: ``,
    customFields: [],
    autofillEnabled: !0,
    autoSubmit: !1,
    subdomainMatch: `etld1`,
    passkeys: [],
  }),
  toForm: (e) => {
    let t = e;
    return {
      name: t.name,
      urls: t.urls.map((e) => ({ value: e })),
      username: t.username,
      password: t.password,
      totp: t.totp ?? ``,
      notes: t.notes ?? ``,
      autofillEnabled: t.autofillEnabled !== !1,
      autoSubmit: t.autoSubmit === !0,
      subdomainMatch: t.subdomainMatch ?? `etld1`,
      passkeys: t.passkeys ?? [],
    };
  },
  toEntry: (e) => {
    let t = e,
      n = t.urls.map((e) => e.value.trim()).filter((e) => e.length > 0);
    return {
      type: `login`,
      name: t.name,
      urls: n,
      username: t.username,
      password: t.password,
      totp: t.totp.trim() || void 0,
      notes: t.notes || void 0,
      autofillEnabled: t.autofillEnabled ? void 0 : !1,
      autoSubmit: t.autoSubmit ? !0 : void 0,
      subdomainMatch: t.subdomainMatch === `etld1` ? void 0 : t.subdomainMatch,
      passkeys: t.passkeys?.length ? t.passkeys : void 0,
    };
  },
  Fields: ke,
  Detail: Ne,
  detailSubtitle: (e) => e.urls[0] || void 0,
  detailAlert: (e) =>
    e.breach?.leaked === !0
      ? { title: S._({ id: `63CbY6` }), body: S._({ id: `iadCuL` }) }
      : null,
  row: (e) => {
    let t = e,
      n = d(t.totp);
    return {
      icon: R,
      initials: t.name.substring(0, 2).toUpperCase(),
      secondary: t.username,
      copyItems: [
        { label: S._({ id: `silO9A` }), value: t.username },
        { label: S._({ id: `OMcfn6` }), value: t.password },
        ...(n
          ? [{ label: S._({ id: `XfPZnq` }), value: () => p(n.totp).code }]
          : []),
      ],
      leaked: t.breach?.leaked === !0,
      passkeys: t.passkeys?.length ?? 0,
      launchUrl: t.urls.map(F).find((e) => e !== null) ?? void 0,
    };
  },
  searchText: (e) => {
    let t = e;
    return `${t.username} ${t.urls.join(` `)}`.toLowerCase();
  },
};
function Fe(e) {
  return (
    (e ?? ``)
      .split(
        `
`,
      )
      .find((e) => e.trim().length > 0)
      ?.trim() ?? ``
  );
}
function Ie() {
  let { register: e } = E(),
    { _: t } = g();
  return (0, V.jsxs)(V.Fragment, {
    children: [
      (0, V.jsx)(l, { label: t({ id: `MHrjPM` }), type: `text`, ...e(`name`) }),
      (0, V.jsx)(U, {
        label: t({ id: `4b3oEV` }),
        rows: 8,
        autoGrow: !0,
        ...e(`notes`),
      }),
    ],
  });
}
function Le({ entry: e, copied: t, copy: n }) {
  let r = e,
    { _: i } = g();
  return (0, V.jsx)(Y, {
    label: i({ id: `4b3oEV` }),
    value: r.notes ?? ``,
    copied: t,
    copy: n,
  });
}
var $ = {
  type: `note`,
  get label() {
    return S._({ id: `tF8MKq` });
  },
  get description() {
    return S._({ id: `y-0X8f` });
  },
  icon: L,
  emptyForm: () => ({ name: ``, notes: `` }),
  toForm: (e) => {
    let t = e;
    return { name: t.name, notes: t.notes ?? `` };
  },
  toEntry: (e) => {
    let t = e;
    return { type: `note`, name: t.name, notes: t.notes || void 0 };
  },
  Fields: Ie,
  Detail: Le,
  row: (e) => {
    let t = e;
    return {
      icon: L,
      secondary: Fe(t.notes) || S._({ id: `tF8MKq` }),
      copyItems: t.notes
        ? [{ label: S._({ id: `CTvzDa` }), value: t.notes }]
        : [],
    };
  },
  searchText: () => ``,
};
function Re(e, t) {
  let n = e.trim().split(/\s+/)[0]?.toLowerCase() ?? ``;
  if (n.includes(`ed25519`)) return `ed25519`;
  if (n === `ssh-rsa`) return `rsa`;
  if (n.startsWith(`ecdsa-sha2`) || n.startsWith(`sk-ecdsa`)) return `ecdsa`;
  if (n === `ssh-dss`) return `dsa`;
  if (/BEGIN OPENSSH PRIVATE KEY/.test(t)) return `openssh`;
  if (/BEGIN RSA PRIVATE KEY/.test(t)) return `rsa`;
  if (/BEGIN EC PRIVATE KEY/.test(t)) return `ecdsa`;
  if (/BEGIN DSA PRIVATE KEY/.test(t)) return `dsa`;
}
async function ze(e) {
  let t = e.trim().split(/\s+/)[1];
  if (!t) return;
  let n;
  try {
    let e = atob(t);
    n = new Uint8Array(new ArrayBuffer(e.length));
    for (let t = 0; t < e.length; t++) n[t] = e.charCodeAt(t);
  } catch {
    return;
  }
  let r = new Uint8Array(await crypto.subtle.digest(`SHA-256`, n)),
    i = ``;
  for (let e = 0; e < r.length; e++) i += String.fromCharCode(r[e] ?? 0);
  return `SHA256:${btoa(i).replace(/=+$/, ``)}`;
}
var Be = (0, B.forwardRef)(function (
  {
    label: e,
    error: t,
    className: n,
    disabled: r,
    rows: i = 6,
    defaultRevealed: a = !1,
    ...s
  },
  c,
) {
  let { _: l } = g(),
    u = (0, B.useId)(),
    d = !!t,
    [f, p] = M(a);
  return (0, V.jsxs)(`div`, {
    children: [
      (0, V.jsxs)(`div`, {
        className: `group relative`,
        children: [
          (0, V.jsx)(`textarea`, {
            ref: c,
            id: u,
            rows: i,
            disabled: r,
            placeholder: ` `,
            spellCheck: !1,
            autoCapitalize: `off`,
            autoCorrect: `off`,
            "aria-invalid": d || void 0,
            className: _(
              `peer relative block w-full appearance-none bg-transparent`,
              `px-3 pt-3 pb-3 pr-10 text-sm text-foreground font-mono resize-none`,
              `placeholder-transparent outline-none`,
              `disabled:opacity-50 disabled:cursor-not-allowed`,
              !f && `[-webkit-text-security:disc]`,
              n,
            ),
            ...s,
          }),
          (0, V.jsx)(v, {
            variant: `ghost`,
            size: `none`,
            onClick: () => p((e) => !e),
            className: `absolute right-2 top-2 z-10 p-1.5 rounded-md`,
            "aria-label": l(f ? { id: `7cLn0S` } : { id: `8OhHog` }),
            children: f
              ? (0, V.jsx)(A, { className: `w-3.5 h-3.5` })
              : (0, V.jsx)(j, { className: `w-3.5 h-3.5` }),
          }),
          (0, V.jsx)(o, { label: e, invalid: d, notch: `textarea` }),
          (0, V.jsx)(`label`, {
            htmlFor: u,
            className: _(
              `pointer-events-none absolute left-3 top-3 origin-[0]`,
              `text-sm text-muted-foreground transition-all duration-150`,
              `peer-focus:top-0 peer-focus:-translate-y-1/2 peer-focus:scale-75 peer-focus:text-primary`,
              `peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:-translate-y-1/2 peer-[:not(:placeholder-shown)]:scale-75`,
              d && `text-destructive peer-focus:text-destructive`,
            ),
            children: e,
          }),
        ],
      }),
      t &&
        (0, V.jsx)(`p`, {
          className: `text-xs text-destructive mt-1`,
          children: t,
        }),
    ],
  });
});
function Ve(e) {
  let [t, n] = (0, B.useState)(void 0);
  return (
    (0, B.useEffect)(() => {
      let t = !1;
      if ((n(void 0), e))
        return (
          ze(e).then((e) => {
            t || n(e);
          }),
          () => {
            t = !0;
          }
        );
    }, [e]),
    t
  );
}
function He() {
  let { register: e } = E(),
    { _: t } = g(),
    [n, r] = M(!1);
  return (0, V.jsxs)(V.Fragment, {
    children: [
      (0, V.jsx)(l, { label: t({ id: `6YtxFj` }), type: `text`, ...e(`name`) }),
      (0, V.jsx)(U, {
        label: t({ id: `WGwujV` }),
        rows: 2,
        className: `font-mono`,
        ...e(`publicKey`),
      }),
      (0, V.jsx)(Be, {
        label: t({ id: `jMZnEc` }),
        rows: 6,
        autoComplete: `off`,
        ...e(`privateKey`),
      }),
      (0, V.jsx)(l, {
        label: t({ id: `WavXAs` }),
        type: n ? `text` : `password`,
        autoComplete: `off`,
        endAdornment: (0, V.jsx)(v, {
          variant: `ghost`,
          size: `none`,
          onClick: () => r((e) => !e),
          className: `p-1.5 rounded-md`,
          "aria-label": t(n ? { id: `gajjM0` } : { id: `cIKJZI` }),
          children: n
            ? (0, V.jsx)(A, { className: `w-3.5 h-3.5` })
            : (0, V.jsx)(j, { className: `w-3.5 h-3.5` }),
        }),
        ...e(`passphrase`),
      }),
      (0, V.jsx)(U, {
        label: t({ id: `4aIVmV` }),
        rows: 2,
        autoGrow: !0,
        ...e(`notes`),
      }),
    ],
  });
}
function Ue({
  label: e,
  value: t,
  copyName: n,
  copied: r,
  onCopy: i,
  secret: a,
}) {
  let { _: o } = g(),
    [s, c] = M(!1),
    l = a && !s;
  return (0, V.jsxs)(`div`, {
    className: `space-y-1.5`,
    children: [
      (0, V.jsxs)(`div`, {
        className: `flex items-center justify-between`,
        children: [
          (0, V.jsx)(`p`, {
            className: `text-xs text-muted-foreground`,
            children: e,
          }),
          (0, V.jsxs)(`div`, {
            className: `flex items-center gap-1`,
            children: [
              a &&
                (0, V.jsx)(v, {
                  variant: `ghost`,
                  size: `none`,
                  onClick: () => c((e) => !e),
                  className: `p-1.5 rounded-md`,
                  "aria-label": o(s ? { id: `CoP79K` } : { id: `bsfdXb` }),
                  children: s
                    ? (0, V.jsx)(A, { className: `w-3.5 h-3.5` })
                    : (0, V.jsx)(j, { className: `w-3.5 h-3.5` }),
                }),
              (0, V.jsx)(v, {
                variant: `ghost`,
                size: `none`,
                onClick: i,
                className: `p-1.5 rounded-md`,
                "aria-label": o({
                  id: `K3rHrY`,
                  values: { 0: e.toLowerCase() },
                }),
                children:
                  r === n
                    ? (0, V.jsx)(C, { className: `w-3.5 h-3.5 text-primary` })
                    : (0, V.jsx)(w, { className: `w-3.5 h-3.5` }),
              }),
            ],
          }),
        ],
      }),
      (0, V.jsx)(`pre`, {
        className: `text-xs font-mono whitespace-pre-wrap break-all rounded-md border border-border/50 p-3 max-h-48 overflow-auto`,
        children: l ? `•`.repeat(48) : t || `-`,
      }),
    ],
  });
}
function We({ entry: e, copied: t, copy: n }) {
  let r = e,
    { _: i } = g(),
    [a, o] = M(!1),
    s = Ve(r.publicKey);
  return (0, V.jsxs)(V.Fragment, {
    children: [
      s &&
        (0, V.jsx)(J, {
          label: i({ id: `up0ZSW` }),
          copied: t,
          copyName: `fingerprint`,
          onCopy: () => n(`fingerprint`, s),
          children: (0, V.jsx)(W, { mono: !0, children: s }),
        }),
      r.publicKey &&
        (0, V.jsx)(Ue, {
          label: i({ id: `WGwujV` }),
          value: r.publicKey,
          copyName: `public key`,
          copied: t,
          onCopy: () => n(`public key`, r.publicKey),
        }),
      (0, V.jsx)(Ue, {
        label: i({ id: `jMZnEc` }),
        value: r.privateKey,
        copyName: `private key`,
        copied: t,
        onCopy: () => n(`private key`, r.privateKey),
        secret: !0,
      }),
      r.passphrase &&
        (0, V.jsx)(J, {
          label: i({ id: `syWzbL` }),
          copied: t,
          copyName: `passphrase`,
          onCopy: () => n(`passphrase`, r.passphrase ?? ``),
          extraAction: (0, V.jsx)(v, {
            variant: `ghost`,
            size: `none`,
            onClick: () => o((e) => !e),
            className: `p-1.5 rounded-md`,
            "aria-label": i(a ? { id: `gajjM0` } : { id: `cIKJZI` }),
            children: a
              ? (0, V.jsx)(A, { className: `w-3.5 h-3.5` })
              : (0, V.jsx)(j, { className: `w-3.5 h-3.5` }),
          }),
          children: (0, V.jsx)(W, {
            mono: !0,
            wrap: a,
            children: a
              ? r.passphrase
              : `•`.repeat(Math.min(r.passphrase.length, 16)),
          }),
        }),
      r.notes &&
        (0, V.jsx)(Y, {
          label: i({ id: `1DBGsz` }),
          value: r.notes,
          copied: t,
          copy: n,
        }),
    ],
  });
}
var Ge = {
    type: `ssh-key`,
    get label() {
      return S._({ id: `IknW7X` });
    },
    get description() {
      return S._({ id: `604NEW` });
    },
    icon: N,
    emptyForm: () => ({
      name: ``,
      publicKey: ``,
      privateKey: ``,
      passphrase: ``,
      notes: ``,
    }),
    toForm: (e) => {
      let t = e;
      return {
        name: t.name,
        publicKey: t.publicKey,
        privateKey: t.privateKey,
        passphrase: t.passphrase ?? ``,
        notes: t.notes ?? ``,
      };
    },
    toEntry: (e) => {
      let t = e;
      return {
        type: `ssh-key`,
        name: t.name,
        publicKey: t.publicKey,
        privateKey: t.privateKey,
        passphrase: t.passphrase || void 0,
        keyType: Re(t.publicKey, t.privateKey),
        notes: t.notes || void 0,
      };
    },
    Fields: He,
    Detail: We,
    detailSubtitle: (e) => e.keyType || void 0,
    row: (e) => {
      let t = e;
      return {
        icon: N,
        secondary: t.keyType
          ? S._({ id: `5wckC_`, values: { 0: t.keyType } })
          : S._({ id: `IknW7X` }),
        copyItems: [
          ...(t.publicKey
            ? [{ label: S._({ id: `701Vm6` }), value: t.publicKey }]
            : []),
          ...(t.privateKey
            ? [{ label: S._({ id: `XcUqmk` }), value: t.privateKey }]
            : []),
        ],
      };
    },
    searchText: (e) => {
      let t = e;
      return `${t.keyType ?? ``} ${t.publicKey}`.toLowerCase();
    },
  },
  Ke = { login: Q, card: we, note: $, "ssh-key": Ge },
  qe = [Q, we, $, Ge];
function Je(e) {
  return Ke[e] ?? Q;
}
export { Te as a, G as c, De as i, qe as n, J as o, Re as r, W as s, Je as t };
