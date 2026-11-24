import { g as e } from "./button-DmLv96bj.js";
var t = e();
function n({ icon: e, title: n, children: r }) {
  return (0, t.jsxs)(`div`, {
    className: `rounded-lg border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden`,
    children: [
      (0, t.jsx)(`div`, {
        className: `px-4 py-3 border-b border-border/50`,
        children: (0, t.jsxs)(`h3`, {
          className: `text-sm flex items-center gap-2`,
          children: [e, n],
        }),
      }),
      (0, t.jsx)(`div`, { className: `p-4 space-y-4`, children: r }),
    ],
  });
}
function r({ icon: e, title: n, subtitle: r, children: i }) {
  return (0, t.jsxs)(`div`, {
    className: `flex items-center justify-between gap-3`,
    children: [
      (0, t.jsxs)(`div`, {
        className: `flex items-start gap-3 min-w-0`,
        children: [
          (0, t.jsx)(`div`, {
            className: `flex items-center justify-center w-9 h-9 rounded-lg bg-primary/10 shrink-0`,
            children: e,
          }),
          (0, t.jsxs)(`div`, {
            className: `min-w-0`,
            children: [
              (0, t.jsx)(`p`, { className: `text-sm`, children: n }),
              (0, t.jsx)(`p`, {
                className: `text-xs text-muted-foreground mt-0.5`,
                children: r,
              }),
            ],
          }),
        ],
      }),
      (0, t.jsx)(`div`, { className: `shrink-0`, children: i }),
    ],
  });
}
function i({ label: e, children: n }) {
  return (0, t.jsxs)(`div`, {
    className: `space-y-4`,
    children: [
      (0, t.jsx)(`h4`, {
        className: `text-[10px] uppercase tracking-wide text-muted-foreground`,
        children: e,
      }),
      n,
    ],
  });
}
export { i as n, n as r, r as t };
