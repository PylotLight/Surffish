import { u as e } from "./build-vault-Dl7gFnhh.js";
import { c as t, et as n } from "./text-field-D_94fmjl.js";
import {
  _ as r,
  c as i,
  g as a,
  l as o,
  p as s,
  t as c,
} from "./button-DmLv96bj.js";
import { M as l, N as u, j as d, k as f } from "./view-port-9v7d8f_U.js";
import { t as p } from "./entry-modes-DgaIEd6h.js";
import { c as m, o as h } from "./toggle-DZvvq5Oc.js";
import { a as g, i as _, r as v, t as y } from "./tags-Cmf0oxp3.js";
var b = e(r(), 1),
  x = a(),
  S = 15e3;
function C({
  type: e,
  defaultUrl: r = ``,
  initialEntry: a,
  isNew: C = !1,
  initialBreach: w,
  draftValues: T,
  registerDraft: E,
  submitLabel: D,
  onBack: O,
  onSaved: k = O,
  onSave: A,
}) {
  let { _: j } = o(),
    M = p(e),
    [N, P] = (0, b.useState)(!1),
    [F, I] = (0, b.useState)(null),
    [L, R] = (0, b.useState)(null),
    { shell: z } = s(),
    { entries: B } = t(),
    V = (0, b.useMemo)(() => n(B), [B]),
    H = m({
      defaultValues: T ?? {
        ...(a ? M.toForm(a) : M.emptyForm({ defaultUrl: r })),
        customFields: l(a?.customFields),
        tags: g(a?.tags),
      },
    }),
    { handleSubmit: U, getValues: W } = H;
  (0, b.useEffect)(() => {
    if (E) return (E(() => W()), () => E(null));
  }, [E, W]);
  let G = async (e) => {
      (I(null), P(!0));
      let t = setTimeout(() => {
        let e = z.pendingNativeCalls?.() ?? [];
        (console.warn(
          `[vault] a save is still running, waiting on:`,
          e.join(`, `) || `unknown`,
        ),
          R(e));
      }, S);
      try {
        (await A({ ...M.toEntry(e), customFields: u(e[f]), tags: _(e[y]) }),
          k());
      } catch (e) {
        I(e.message);
      } finally {
        (clearTimeout(t), R(null), P(!1));
      }
    },
    K = M.Fields,
    q = M.label,
    J =
      a && !C
        ? (0, x.jsx)(i, { id: `BTt2QK`, values: { modeLabel: q } })
        : (0, x.jsx)(i, { id: `EVDYFH`, values: { modeLabel: q } }),
    Y = D ?? j({ id: `-zJoKK`, values: { modeLabel: q } });
  return (0, x.jsx)(`main`, {
    className: `max-w-5xl mx-auto w-full flex-1 min-h-0 flex flex-col px-4 pt-3`,
    children: (0, x.jsx)(h, {
      ...H,
      children: (0, x.jsx)(`form`, {
        onSubmit: U(G),
        autoComplete: `off`,
        "data-form-type": `other`,
        className: `flex-1 min-h-0 flex flex-col`,
        children: (0, x.jsxs)(`div`, {
          className: `flex flex-col max-h-full rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden`,
          children: [
            (0, x.jsx)(`div`, {
              className: `shrink-0 px-5 py-2.5 border-b border-border/50`,
              children: (0, x.jsx)(`h2`, {
                className: `text-xs text-muted-foreground`,
                children: J,
              }),
            }),
            (0, x.jsxs)(`div`, {
              className: `flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3`,
              children: [
                (0, x.jsx)(K, { initialBreach: w }),
                (0, x.jsx)(v, { suggestions: V }),
                (0, x.jsx)(d, {}),
              ],
            }),
            (0, x.jsxs)(`div`, {
              className: `shrink-0 px-5 py-3 bg-muted/30 border-t border-border/50 flex items-center justify-between gap-3`,
              children: [
                (0, x.jsx)(c, {
                  variant: `secondary`,
                  size: `none`,
                  onClick: O,
                  disabled: N,
                  className: `px-4 py-2 text-sm hover:bg-background/50 hover:border-border`,
                  children: (0, x.jsx)(i, { id: `dEgA5A` }),
                }),
                F &&
                  (0, x.jsx)(`p`, {
                    className: `flex-1 text-xs text-destructive truncate`,
                    title: F,
                    children: F,
                  }),
                N &&
                  L &&
                  (0, x.jsxs)(`p`, {
                    className: `flex-1 min-w-0 text-xs text-muted-foreground`,
                    children: [
                      (0, x.jsx)(i, { id: `vuYYpg` }),
                      L.length > 0 &&
                        (0, x.jsx)(`span`, {
                          className: `block truncate`,
                          title: L.join(`, `),
                          children: L.join(`, `),
                        }),
                    ],
                  }),
                (0, x.jsx)(c, {
                  type: `submit`,
                  variant: `primary`,
                  size: `md`,
                  disabled: N,
                  children: N ? j({ id: `K_F6pa` }) : Y,
                }),
              ],
            }),
          ],
        }),
      }),
    }),
  });
}
export { C as t };
