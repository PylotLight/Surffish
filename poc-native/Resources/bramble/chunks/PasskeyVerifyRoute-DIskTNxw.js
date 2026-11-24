import { u as e } from "./build-vault-Dl7gFnhh.js";
import { o as t } from "./text-field-D_94fmjl.js";
import {
  _ as n,
  c as r,
  g as i,
  l as a,
  p as o,
  t as s,
} from "./button-DmLv96bj.js";
import { I as c } from "./view-port-9v7d8f_U.js";
import { n as l, t as u } from "./useWebauthnUnlock-DJRyRNLP.js";
import { r as d } from "./useRevealState-BLRULnQh.js";
var f = e(n(), 1),
  p = i();
function m({ id: e, rp: n }) {
  let {
      hasPasswordSlot: i,
      hasWebauthnSlot: l,
      verifyMasterPassword: m,
      verifyWithWebauthnKey: h,
    } = t(),
    g = u() && l,
    { shell: _ } = o(),
    { _: v } = a(),
    [y, b] = (0, f.useState)(``),
    [x, S] = (0, f.useState)(null),
    [C, w] = (0, f.useState)(null),
    [T, E] = (0, f.useState)(!1),
    D = async (t) => {
      (await _.reportPasskeyVerification?.(e, t))?.signInAgain
        ? E(!0)
        : window.close();
    },
    O = async (e, t, n) => {
      (S(e), w(null));
      try {
        (await t()) ? await D(!0) : w(n);
      } catch (e) {
        w(e.message);
      } finally {
        S(null);
      }
    };
  return T
    ? (0, p.jsxs)(`div`, {
        className: `flex-1 p-6 space-y-4`,
        children: [
          (0, p.jsx)(`p`, {
            className: `text-sm`,
            children: (0, p.jsx)(r, { id: `zuofnH`, values: { rp: n } }),
          }),
          (0, p.jsx)(s, {
            variant: `primary`,
            onClick: () => window.close(),
            children: (0, p.jsx)(r, { id: `yz7wBu` }),
          }),
        ],
      })
    : (0, p.jsxs)(`form`, {
        className: `flex-1 p-6 space-y-4`,
        onSubmit: (e) => {
          (e.preventDefault(), O(`password`, () => m(y), v({ id: `wdOZo1` })));
        },
        children: [
          (0, p.jsxs)(`div`, {
            className: `flex items-center gap-3`,
            children: [
              (0, p.jsx)(d, { className: `w-5 h-5 text-primary` }),
              (0, p.jsx)(`h1`, {
                className: `text-base font-semibold`,
                children: (0, p.jsx)(r, { id: `6uNoaV` }),
              }),
            ],
          }),
          (0, p.jsx)(`p`, {
            className: `text-sm text-muted-foreground`,
            children: (0, p.jsx)(r, { id: `4Ggf74`, values: { rp: n } }),
          }),
          i &&
            (0, p.jsx)(c, {
              label: v({ id: `xvo56c` }),
              autoFocus: !0,
              value: y,
              onChange: (e) => b(e.target.value),
              disabled: x !== null,
            }),
          C &&
            (0, p.jsx)(`p`, {
              className: `text-xs text-destructive`,
              children: C,
            }),
          (0, p.jsxs)(`div`, {
            className: `flex flex-wrap gap-2`,
            children: [
              i &&
                (0, p.jsx)(s, {
                  type: `submit`,
                  variant: `primary`,
                  disabled: x !== null || !y,
                  children: (0, p.jsx)(r, { id: `7VpPHA` }),
                }),
              g &&
                (0, p.jsxs)(s, {
                  variant: i ? `secondary` : `primary`,
                  onClick: () => void O(`key`, h, v({ id: `KeFpuA` })),
                  disabled: x !== null,
                  children: [
                    (0, p.jsx)(d, { className: `w-4 h-4` }),
                    v(x === `key` ? { id: `vUbBaQ` } : { id: `5teclJ` }),
                  ],
                }),
              (0, p.jsx)(s, {
                variant: `secondary`,
                onClick: () => void D(!1),
                disabled: x !== null,
                children: (0, p.jsx)(r, { id: `dEgA5A` }),
              }),
            ],
          }),
        ],
      });
}
function h() {
  let { id: e, rp: t } = l({ from: `/_app/passkey-verify` });
  return (0, p.jsx)(m, { id: e, rp: t });
}
export { m as PasskeyVerify, h as PasskeyVerifyRoute };
