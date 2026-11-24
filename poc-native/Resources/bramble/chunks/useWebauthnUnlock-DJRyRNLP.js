import { R as e } from "./text-field-D_94fmjl.js";
import { f as t } from "./button-DmLv96bj.js";
import { t as n } from "./useMatch-C-IM4M7q.js";
function r(e) {
  return n({
    from: e.from,
    strict: e.strict,
    shouldThrow: e.shouldThrow,
    structuralSharing: e.structuralSharing,
    select: (t) => (e.select ? e.select(t.search) : t.search),
  });
}
function i() {
  return t(`webauthnUnlock`) && e();
}
export { r as n, i as t };
