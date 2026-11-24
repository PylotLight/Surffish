import { u as e } from "./build-vault-Dl7gFnhh.js";
import { _ as t } from "./button-DmLv96bj.js";
import { t as n } from "./useRouter-C1oMopOF.js";
var r = e(t(), 1);
function i(e) {
  let t = n();
  return r.useCallback(
    (n) => t.navigate({ ...n, from: n.from ?? e?.from }),
    [e?.from, t],
  );
}
export { i as t };
