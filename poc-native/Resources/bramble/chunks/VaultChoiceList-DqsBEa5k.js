import { q as e } from "./storage-nmIf6WgJ.js";
import { g as t, l as n, o as r, t as i } from "./button-DmLv96bj.js";
import { o as a, t as o } from "./format-date-DY5h_i7e.js";
var s = t();
function c(e) {
  let t = e.trim().split(/\s+/).filter(Boolean);
  return t.length === 0
    ? `V`
    : t.length === 1
      ? t[0].slice(0, 2).toUpperCase()
      : (t[0][0] + t[1][0]).toUpperCase();
}
function l({ onSelect: t }) {
  let { vaults: l } = r(),
    { _: u } = n();
  return (0, s.jsx)(`div`, {
    className: `space-y-3`,
    children: l.map((n, r) => {
      let l = e(n, r);
      return (0, s.jsxs)(
        i,
        {
          variant: `secondary`,
          size: `none`,
          fullWidth: !0,
          onClick: () => t(n.id),
          className: `group flex gap-3 rounded-xl border-border/60 bg-card/50 backdrop-blur-sm p-4 text-left hover:bg-primary/5 active:scale-[0.99]`,
          children: [
            (0, s.jsx)(`span`, {
              className: `flex-none w-11 h-11 rounded-full bg-primary/10 text-primary text-sm font-medium flex items-center justify-center`,
              children: c(l),
            }),
            (0, s.jsxs)(`span`, {
              className: `flex-1 min-w-0`,
              children: [
                (0, s.jsx)(`span`, {
                  className: `block text-sm text-foreground truncate`,
                  children: l,
                }),
                (0, s.jsx)(`span`, {
                  className: `block text-xs text-muted-foreground`,
                  children: u({ id: `t3sqJR`, values: { 0: o(n.createdAt) } }),
                }),
              ],
            }),
            (0, s.jsx)(a, {
              className: `flex-none w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors`,
            }),
          ],
        },
        n.id,
      );
    }),
  });
}
export { l as t };
