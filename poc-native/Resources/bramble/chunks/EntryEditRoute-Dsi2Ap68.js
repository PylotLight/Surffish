import { u as e } from "./build-vault-Dl7gFnhh.js";
import { o as t, p as n } from "./text-field-D_94fmjl.js";
import { _ as r, g as i } from "./button-DmLv96bj.js";
import { Z as a, gt as o, z as s } from "./view-port-9v7d8f_U.js";
import { t as c } from "./useNavigate-B45lxN2s.js";
import { t as l } from "./entry-modes-DgaIEd6h.js";
import {
  Bt as u,
  It as d,
  gn as f,
  mn as p,
  vn as m,
} from "./messages-DLCDPx8W.js";
import { o as h } from "./tags-Cmf0oxp3.js";
import { t as g } from "./EntryForm-MLZ0-PeV.js";
var _ = e(r(), 1),
  v = f({
    hlc: u,
    vv: d.optional(),
    floor: u.optional(),
    data: p({ id: m(), type: m() }),
  }),
  y = (e) => typeof e == `object` && !!e && !Array.isArray(e);
function b(e) {
  if (!y(e)) return;
  let t = Object.keys(e);
  if (!(y(e.values) && t.every((e) => e === `values` || e === `opened`)))
    return { values: e };
  let n = v.safeParse(e.opened);
  return n.success
    ? { values: e.values, opened: n.data }
    : { values: e.values };
}
var x = i();
function S() {
  let e = c(),
    { entryId: r } = o({ from: `/_app/vault/$entryId/edit` }),
    { entries: i, updateEntry: u, openVersion: d } = t(),
    { prefs: f } = n(),
    { registerDraftGetter: p, takeInitialDraft: m } = a(),
    v = s(),
    [y] = (0, _.useState)(() => b(m())),
    S = i.find((e) => e.id === r),
    C = (0, _.useRef)(y?.opened ? { version: y.opened } : null);
  C.current === null && S && (C.current = { version: d(r) });
  let w = C.current?.version,
    T = (0, _.useCallback)(
      (e) => p(e && (() => ({ values: e(), opened: w }))),
      [p, w],
    );
  if (!S) return null;
  let E = l(S.type);
  return (0, x.jsx)(`div`, {
    className: `flex-1 min-h-0 flex flex-col pb-3`,
    children: (0, x.jsx)(
      g,
      {
        type: S.type,
        initialEntry: S,
        initialBreach:
          f.breachCheckEnabled && S.type === `login` ? S.breach : void 0,
        draftValues: y?.values,
        registerDraft: T,
        submitLabel: `Update ${E.label}`,
        onBack:
          v ?? (() => e({ to: `/vault/$entryId`, params: { entryId: r } })),
        onSave: async (e) => {
          let t = w?.data ?? S,
            { id: n, ...i } = t,
            a = { ...i, ...e };
          if (a.type === `login` && t.type === `login`) {
            let e =
              a.password !== t.password && f.breachCheckEnabled
                ? await h(a.password)
                : t.breach;
            await u(r, { ...a, breach: e }, w);
          } else await u(r, a, w);
        },
      },
      S.type,
    ),
  });
}
export { S as EntryEditRoute };
