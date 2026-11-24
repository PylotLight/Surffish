import { u as e } from "./build-vault-Dl7gFnhh.js";
import { p as t, s as n } from "./text-field-D_94fmjl.js";
import { _ as r, g as i, p as a } from "./button-DmLv96bj.js";
import { V as o, Z as s, gt as c, z as l } from "./view-port-9v7d8f_U.js";
import { t as u } from "./useNavigate-B45lxN2s.js";
import { t as d } from "./entry-modes-DgaIEd6h.js";
import { o as f } from "./tags-Cmf0oxp3.js";
import { t as p } from "./EntryForm-MLZ0-PeV.js";
var m = e(r(), 1),
  h = i();
function g() {
  let e = u(),
    r = l(),
    { type: i } = c({ from: `/_app/vault/new/$type` }),
    g = d(i).type,
    { addEntry: _ } = n(),
    { shell: v } = a(),
    { prefs: y } = t(),
    { registerDraftGetter: b, takeInitialDraft: x } = s(),
    [S] = (0, m.useState)(() => x()),
    [C] = (0, m.useState)(() => o()),
    [w, T] = (0, m.useState)(S || C || g !== `login` ? `` : null);
  if (
    ((0, m.useEffect)(() => {
      if (S || C || g !== `login`) return;
      let e = !1;
      return (
        v.getCurrentTabOrigin().then((t) => {
          e || T(t ?? ``);
        }),
        () => {
          e = !0;
        }
      );
    }, [v, S, C, g]),
    w === null)
  )
    return null;
  let E = async (e) => {
      if (e.type === `login`) {
        let t = y.breachCheckEnabled ? await f(e.password) : void 0;
        await _({ ...e, breach: t });
      } else await _(e);
    },
    D = () => e({ to: `/vault` });
  return (0, h.jsx)(`div`, {
    className: `flex-1 min-h-0 flex flex-col pb-3`,
    children: (0, h.jsx)(
      p,
      {
        type: g,
        defaultUrl: w,
        initialEntry: C,
        isNew: !0,
        draftValues: S,
        registerDraft: b,
        onBack: r ?? D,
        onSaved: D,
        onSave: E,
      },
      g,
    ),
  });
}
export { g as CreateEntryRoute };
