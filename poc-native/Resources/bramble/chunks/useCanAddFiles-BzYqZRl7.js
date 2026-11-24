import { u as e } from "./build-vault-Dl7gFnhh.js";
import { _ as t, f as n, p as r } from "./button-DmLv96bj.js";
var i = e(t(), 1);
function a() {
  let e = n(`addFiles`),
    { desktopLink: t } = r(),
    [a, o] = (0, i.useState)(!1);
  return (
    (0, i.useEffect)(() => {
      if (e || !t) return;
      let n = !0;
      return (
        t
          .status()
          .then((e) => {
            n && o(e.paired && e.permitted !== !1);
          })
          .catch(() => {}),
        () => {
          n = !1;
        }
      );
    }, [e, t]),
    e || a
  );
}
export { a as t };
