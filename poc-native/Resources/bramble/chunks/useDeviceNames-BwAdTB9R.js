import { u as e } from "./build-vault-Dl7gFnhh.js";
import { F as t } from "./text-field-D_94fmjl.js";
import { _ as n } from "./button-DmLv96bj.js";
var r = e(n(), 1),
  i = (e) => `device.name:${e}`;
function a() {
  let { settings: e, ready: n, set: a } = t();
  return {
    nameOf: (0, r.useCallback)(
      (t) => {
        let n = e?.[i(t.id)]?.value;
        return typeof n == `string` && n.trim() ? n.trim() : t.label;
      },
      [e],
    ),
    rename: (0, r.useCallback)((e, t) => a(i(e), t.trim() || null), [a]),
    canRename: n,
  };
}
export { a as t };
