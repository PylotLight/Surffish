import { u as e } from "./build-vault-Dl7gFnhh.js";
import { _ as t, p as n, u as r } from "./button-DmLv96bj.js";
import { s as i } from "./format-date-DY5h_i7e.js";
var a = r(`ArrowLeftRight`, [
    [`path`, { d: `M8 3 4 7l4 4`, key: `9rb6wj` }],
    [`path`, { d: `M4 7h16`, key: `6tx8e3` }],
    [`path`, { d: `m16 21 4-4-4-4`, key: `siv7j2` }],
    [`path`, { d: `M20 17H4`, key: `h6l3hr` }],
  ]),
  o = r(`Upload`, [
    [`path`, { d: `M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4`, key: `ih7n3h` }],
    [`polyline`, { points: `17 8 12 3 7 8`, key: `t8dd8p` }],
    [`line`, { x1: `12`, x2: `12`, y1: `3`, y2: `15`, key: `widbto` }],
  ]),
  s = e(t(), 1);
function c() {
  let { exchange: e } = n(),
    [t, r] = (0, s.useState)(null);
  return (
    (0, s.useEffect)(() => {
      if (!e) return;
      let t = !0;
      return (
        e
          .availability()
          .then((e) => {
            t && r(e);
          })
          .catch((e) => {
            t &&
              r({
                available: !1,
                providerEnabled: !1,
                error: e instanceof Error ? e.message : String(e),
              });
          }),
        () => {
          t = !1;
        }
      );
    }, [e]),
    t
  );
}
function l(e) {
  if (!e) return null;
  if (e.error) return i._({ id: `eaS0ME` });
  if (!e.available) {
    let t = e.osVersion;
    return t
      ? i._({ id: `5ao1bZ`, values: { version: t } })
      : i._({ id: `FSMBUj` });
  }
  return null;
}
export { a as i, c as n, o as r, l as t };
