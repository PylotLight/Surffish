import { u as e } from "./build-vault-Dl7gFnhh.js";
import { c as t, n, p as r } from "./text-field-D_94fmjl.js";
import {
  $ as i,
  U as a,
  mt as o,
  ot as s,
  st as c,
  w as l,
} from "./storage-nmIf6WgJ.js";
import {
  _ as u,
  g as d,
  o as f,
  p,
  r as m,
  u as h,
} from "./button-DmLv96bj.js";
var g = h(`AtSign`, [
    [`circle`, { cx: `12`, cy: `12`, r: `4`, key: `4exip2` }],
    [`path`, { d: `M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8`, key: `7n84p3` }],
  ]),
  _ = h(`Check`, [[`path`, { d: `M20 6 9 17l-5-5`, key: `1gmf2c` }]]),
  v = h(`ChevronDown`, [[`path`, { d: `m6 9 6 6 6-6`, key: `qrunsl` }]]),
  y = h(`Copy`, [
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
  b = h(`LoaderCircle`, [
    [`path`, { d: `M21 12a9 9 0 1 1-6.219-8.56`, key: `13zald` }],
  ]),
  x = h(`RefreshCw`, [
    [
      `path`,
      {
        d: `M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8`,
        key: `v9h5vc`,
      },
    ],
    [`path`, { d: `M21 3v5h-5`, key: `1q7to0` }],
    [
      `path`,
      {
        d: `M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16`,
        key: `3uifl3`,
      },
    ],
    [`path`, { d: `M8 16H3v5`, key: `1cv678` }],
  ]),
  S = e(u(), 1);
function C(e) {
  if (!e || typeof e != `object`) return !1;
  let t = e;
  return (
    (t.provider === `addy` || t.provider === `simplelogin`) &&
    typeof t.key?.iv == `string` &&
    typeof t.key?.ciphertext == `string`
  );
}
function w() {
  let { storage: e, crypto: n, http: u } = p(),
    { prefs: d, loaded: m, update: h } = r(),
    { activeId: g, vaults: _ } = f(),
    v = g ?? _[0]?.id,
    y = d.aliasProvider,
    { entries: b } = t(),
    x = (0, S.useCallback)(
      () =>
        b
          .map((e) => (e.type === `login` ? e.username : ``))
          .filter((e) => e.length > 0),
      [b],
    ),
    w = (0, S.useRef)(!1);
  (0, S.useEffect)(() => {
    v &&
      m &&
      y === null &&
      !w.current &&
      ((w.current = !0),
      (async () => {
        let t = a(i, v),
          r = await e.getMeta(t).catch(() => void 0);
        if (C(r)) {
          try {
            let e = await n.decryptWithVek(r.key.iv, r.key.ciphertext);
            await h(`aliasProvider`, {
              provider: r.provider,
              baseUrl: r.baseUrl,
              options: r.options ?? {},
              apiKey: e,
            });
          } catch {}
          await e.removeMeta(t).catch(() => {});
        }
      })());
  }, [e, n, v, m, y, h]);
  let T = (0, S.useCallback)(
      (e) => {
        if (!s(e.provider).needsApiKey) return ``;
        let t = y?.provider === e.provider ? y.apiKey : void 0,
          n = e.apiKey || t;
        if (!n) throw new o(`config`, `Enter your API key.`);
        return n;
      },
      [y],
    ),
    E = (0, S.useCallback)(
      (e) => l(e.provider, e.options, e.baseUrl, T(e), u),
      [T, u],
    ),
    D = (0, S.useCallback)(
      async (e) => {
        let t = s(e.provider).needsApiKey,
          n = y?.provider === e.provider ? y.apiKey : void 0,
          r = t ? e.apiKey || n : void 0;
        if (t && !r) throw new o(`config`, `Enter your API key.`);
        let i = {
          provider: e.provider,
          baseUrl: e.baseUrl || void 0,
          options: e.options,
          ...(r ? { apiKey: r } : {}),
        };
        await h(`aliasProvider`, i);
      },
      [h, y],
    ),
    O = (0, S.useCallback)(async () => {
      await h(`aliasProvider`, null);
    }, [h]),
    k = (0, S.useCallback)(async (e) => E(e).verify(), [E]),
    A = (0, S.useCallback)(
      async (e) => (await E(e).domains?.()) ?? { options: [] },
      [E],
    ),
    j = (0, S.useCallback)(
      async (e) => {
        if (!y) throw new o(`config`, `No alias provider is set up.`);
        if (c(y.provider, y.options).length > 0)
          throw new o(`config`, `This provider needs more setup in Settings.`);
        let { address: t } = await l(
          y.provider,
          y.options,
          y.baseUrl,
          y.apiKey ?? ``,
          u,
        ).create({
          site: e,
          description: e ? `Bramble (${e})` : `Bramble`,
          taken: x(),
        });
        return t;
      },
      [y, x, u],
    );
  return {
    config: y,
    enabled: y !== null,
    save: D,
    disconnect: O,
    verify: k,
    domains: A,
    generate: j,
  };
}
var T = d();
function E({
  checked: e,
  onChange: t,
  ariaLabel: n,
  children: r,
  className: i,
}) {
  return (0, T.jsxs)(`label`, {
    className: m(
      `flex items-center gap-2 cursor-pointer select-none text-[11px] text-foreground`,
      i,
    ),
    children: [
      (0, T.jsx)(`input`, {
        type: `checkbox`,
        checked: e,
        onChange: (e) => t(e.target.checked),
        "aria-label": n,
        className: `peer sr-only`,
      }),
      (0, T.jsx)(`span`, {
        className: m(
          `flex items-center justify-center w-4 h-4 shrink-0 rounded border transition-colors`,
          `peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring`,
          e
            ? `bg-primary border-primary`
            : `border-input-border bg-transparent`,
        ),
        children:
          e &&
          (0, T.jsx)(_, {
            className: `w-3 h-3 text-primary-foreground`,
            strokeWidth: 3,
          }),
      }),
      r,
    ],
  });
}
var D = (0, S.forwardRef)(function (
  { label: e, error: t, className: r, disabled: i, children: a, ...o },
  s,
) {
  let c = (0, S.useId)(),
    l = !!t;
  return (0, T.jsxs)(`div`, {
    children: [
      (0, T.jsxs)(`div`, {
        className: `relative`,
        children: [
          (0, T.jsx)(`select`, {
            ref: s,
            id: c,
            disabled: i,
            "aria-invalid": l || void 0,
            className: m(
              `peer relative block w-full appearance-none bg-transparent`,
              `px-3 pt-3 pb-3 pr-9 text-sm text-foreground cursor-pointer`,
              `outline-none`,
              `disabled:opacity-50 disabled:cursor-not-allowed`,
              r,
            ),
            ...o,
            children: a,
          }),
          (0, T.jsx)(n, { label: e, invalid: l, notch: `always` }),
          (0, T.jsx)(`label`, {
            htmlFor: c,
            className: m(
              `pointer-events-none absolute left-3 top-0 -translate-y-1/2 origin-[0]`,
              `text-sm scale-75`,
              l
                ? `text-destructive`
                : `text-muted-foreground peer-focus:text-primary`,
            ),
            children: e,
          }),
          (0, T.jsx)(v, {
            className: `pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground`,
          }),
        ],
      }),
      t &&
        (0, T.jsx)(`p`, {
          className: `text-xs text-destructive mt-1`,
          children: t,
        }),
    ],
  });
});
export {
  b as a,
  _ as c,
  x as i,
  g as l,
  E as n,
  y as o,
  w as r,
  v as s,
  D as t,
};
