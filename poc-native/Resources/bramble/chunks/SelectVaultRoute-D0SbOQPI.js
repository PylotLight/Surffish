import { c as e, g as t, o as n, p as r, t as i } from "./button-DmLv96bj.js";
import { Q as a } from "./view-port-9v7d8f_U.js";
import { a as o } from "./format-date-DY5h_i7e.js";
import { t as s } from "./VaultChoiceList-DqsBEa5k.js";
var c = t();
function l() {
  let { selectVault: t } = n(),
    { shell: l } = r();
  return (0, c.jsx)(`div`, {
    className: `relative h-screen overflow-y-auto bg-linear-to-br from-background via-background to-primary/5`,
    children: (0, c.jsx)(`div`, {
      className: `min-h-full flex items-center justify-center p-6`,
      children: (0, c.jsxs)(`div`, {
        className: `w-full max-w-md`,
        children: [
          (0, c.jsxs)(`div`, {
            className: `text-center mb-6`,
            children: [
              (0, c.jsx)(a, {
                className: `w-14 h-14 text-foreground mb-3 inline-block`,
              }),
              (0, c.jsx)(`h1`, {
                className: `text-xl bg-linear-to-r from-foreground to-foreground/70 bg-clip-text text-transparent`,
                children: (0, c.jsx)(e, { id: `l16W_s` }),
              }),
            ],
          }),
          (0, c.jsxs)(`div`, {
            className: `space-y-3`,
            children: [
              (0, c.jsx)(s, { onSelect: t }),
              (0, c.jsxs)(i, {
                variant: `link`,
                size: `none`,
                fullWidth: !0,
                onClick: () => void l.openSetup(),
                className: `flex gap-3 rounded-xl border border-dashed border-border/70 p-4 text-left hover:border-primary/50 active:scale-[0.99]`,
                children: [
                  (0, c.jsx)(`span`, {
                    className: `flex-none w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center`,
                    children: (0, c.jsx)(o, { className: `w-5 h-5` }),
                  }),
                  (0, c.jsx)(`span`, {
                    className: `flex-1 text-sm`,
                    children: (0, c.jsx)(e, { id: `UrtEsO` }),
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    }),
  });
}
function u() {
  return (0, c.jsx)(l, {});
}
export { u as SelectVaultRoute };
