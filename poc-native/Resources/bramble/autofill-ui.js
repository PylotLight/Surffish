function e(e) {
  return String(e ?? ``)
    .replace(/&/g, `&amp;`)
    .replace(/</g, `&lt;`)
    .replace(/>/g, `&gt;`)
    .replace(/"/g, `&quot;`)
    .replace(/'/g, `&#39;`);
}
function t(t, ...n) {
  let r = t[0] ?? ``;
  for (let i = 0; i < n.length; i++) {
    let a = n[i];
    ((r += Array.isArray(a) ? a.join(``) : e(a)), (r += t[i + 1] ?? ``));
  }
  return r;
}
var n = new URLSearchParams(location.search).get(`parentOrigin`) ?? ``,
  r = null,
  i = new URLSearchParams(location.search).get(`relayId`) ?? ``,
  a = i.length > 0,
  o = `tp-ui-here`,
  s = 100,
  c = 25,
  l = 8,
  u = 128,
  d = null,
  f = 500,
  p = -1 / 0,
  m = !1,
  h = [],
  g = -1;
function _(e) {
  a ? d && d.win.postMessage(e, d.origin) : r?.postMessage(e);
}
function v(e) {
  let t = { type: `UI_RESIZE`, height: e };
  a ? n && window.parent.postMessage(t, n) : r?.postMessage(t);
}
function y(e) {
  let t = e.trim();
  if (!t) return `??`;
  let n = t.split(/\s+/);
  return n.length >= 2 && n[0] && n[1]
    ? (n[0][0] + n[1][0]).toUpperCase()
    : t.slice(0, 2).toUpperCase();
}
var b = [
  `#7C3AED`,
  `#2563EB`,
  `#0E7490`,
  `#047857`,
  `#4D7C0F`,
  `#A16207`,
  `#C2410C`,
  `#DC2626`,
  `#DB2777`,
];
function x(e) {
  let t = 0;
  for (let n = 0; n < e.length; n++) t = (t * 31 + e.charCodeAt(n)) >>> 0;
  return b[t % b.length];
}
var S = `
	:root {
		color-scheme: light dark;
		--tp-surface: #ffffff; /* --popover */
		--tp-foreground: oklch(20.5% 0 0); /* --popover-foreground */
		--tp-muted: oklch(52% 0 0); /* --muted-foreground */
		--tp-border: oklch(87% 0 0); /* --border */
		--tp-primary: oklch(20.5% 0 0); /* --primary */
		--tp-on-primary: #ffffff; /* --primary-foreground */
	}
	@media (prefers-color-scheme: dark) {
		:root {
			--tp-surface: oklch(26.9% 0 0);
			--tp-foreground: oklch(97% 0 0);
			--tp-muted: oklch(70.8% 0 0);
			--tp-border: oklch(37.1% 0 0);
			--tp-primary: oklch(97% 0 0);
			--tp-on-primary: oklch(20.5% 0 0);
		}
	}
	.tp-list {
		background: var(--tp-surface);
		border: 1px solid var(--tp-border);
		border-radius: 16px;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.15);
		font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
		font-size: 13px;
		color: var(--tp-foreground);
		text-align: left;
		max-height: 360px;
		overflow-y: auto;
		padding: 6px;
		box-sizing: border-box;
	}
	.tp-item {
		padding: 10px 12px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 12px;
		border-radius: 12px;
		transition: background 0.12s ease;
	}
	.tp-item:hover { background: color-mix(in oklab, var(--tp-foreground) 8%, transparent); }
	.tp-item.tp-active { background: color-mix(in oklab, var(--tp-foreground) 12%, transparent); }
	.tp-avatar {
		width: 40px;
		height: 40px;
		border-radius: 11px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 15px;
		font-weight: 700;
		color: #fff;
		flex-shrink: 0;
		letter-spacing: 0.3px;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), inset 0 -1px 0 rgba(0, 0, 0, 0.14);
	}
	.tp-avatar-locked {
		background: color-mix(in oklab, var(--tp-foreground) 10%, transparent);
		color: var(--tp-muted);
	}
	.tp-avatar-locked svg { width: 20px; height: 20px; }
	.tp-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
	.tp-name {
		font-weight: 600;
		font-size: 15px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--tp-foreground);
		line-height: 1.3;
	}
	.tp-user {
		color: var(--tp-muted);
		font-size: 13px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-top: 2px;
		line-height: 1.3;
	}
	.tp-badge {
		margin-left: auto;
		flex-shrink: 0;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.2px;
		padding: 3px 8px;
		border-radius: 999px;
		color: var(--tp-muted);
		background: color-mix(in oklab, var(--tp-foreground) 10%, transparent);
	}
	.tp-launch {
		margin-left: auto;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		color: var(--tp-muted);
		transition: color 0.12s ease;
	}
	.tp-item:hover .tp-launch { color: var(--tp-foreground); }
	.tp-avatar-suggest { background: var(--tp-primary); color: var(--tp-on-primary); }
	.tp-avatar-alias { background: var(--tp-primary); color: var(--tp-on-primary); }
	.tp-avatar-alias svg { width: 20px; height: 20px; }
	.tp-alias-busy { opacity: 0.75; cursor: default; }
	.tp-alias-error .tp-user { color: var(--tp-danger, #dc2626); }
	.tp-spin { animation: tp-spin 0.9s linear infinite; }
	.tp-new-login { display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 12px; border: 0; border-top: 1px solid var(--tp-border); background: none; color: var(--tp-muted); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
	.tp-new-login:hover { color: var(--tp-foreground); }
	.tp-hint { padding: 8px 12px; color: var(--tp-muted); font-size: 12px; }
	@keyframes tp-spin { to { transform: rotate(360deg); } }
	.tp-avatar-suggest svg { width: 20px; height: 20px; }
	.tp-suggest-pw {
		font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
		font-size: 14px;
		letter-spacing: 0.5px;
	}
	.tp-regenerate {
		margin-left: auto;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border: 0;
		border-radius: 8px;
		background: transparent;
		color: var(--tp-muted);
		cursor: pointer;
		transition: background 0.12s ease, color 0.12s ease;
	}
	.tp-regenerate:hover { background: color-mix(in oklab, var(--tp-foreground) 12%, transparent); color: var(--tp-foreground); }
`;
function C(e, n) {
  let r = n ? t`<span class="tp-badge">${w(`cardUsedHere`)}</span>` : ``;
  return t`
		<div class="tp-item" data-entry-id="${e.id}" role="option">
			<div class="tp-avatar" style="background: ${x(e.name)};">${y(e.name)}</div>
			<div class="tp-text">
				<span class="tp-name">${e.name}</span>
				<span class="tp-user">${e.secondary}</span>
			</div>
			${[r]}
		</div>
	`;
}
function w(e) {
  let t = globalThis;
  return (t.browser ?? t.chrome)?.i18n.getMessage(e) ?? e;
}
function T(e) {
  return e.state === `busy`
    ? t`
		<div class="tp-item tp-alias tp-alias-busy">
			<div class="tp-avatar tp-avatar-alias">
				<svg class="tp-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
			</div>
			<div class="tp-text">
				<span class="tp-name">${w(`aliasTitle`)}</span>
				<span class="tp-user">${w(`aliasWorking`)}</span>
			</div>
		</div>
	`
    : e.state === `error`
      ? t`
		<div class="tp-item tp-alias tp-alias-error" data-tp-alias="1" role="option">
			<div class="tp-avatar tp-avatar-alias">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg>
			</div>
			<div class="tp-text">
				<span class="tp-name">${w(`aliasFailed`)}</span>
				<span class="tp-user">${e.message ?? w(`aliasRetry`)}</span>
			</div>
		</div>
	`
      : t`
		<div class="tp-item tp-alias" data-tp-alias="1" role="option">
			<div class="tp-avatar tp-avatar-alias">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"></path></svg>
			</div>
			<div class="tp-text">
				<span class="tp-name">${w(`aliasTitle`)}</span>
				<span class="tp-user">${w(`aliasUse`)}</span>
			</div>
		</div>
	`;
}
function E(e) {
  return t`
		<div class="tp-item tp-suggest" data-tp-suggest="1" role="option">
			<div class="tp-avatar tp-avatar-suggest">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"></circle><path d="M10.7 12.3 20 3"></path><path d="m16 6 3 3"></path><path d="m14 8 3 3"></path></svg>
			</div>
			<div class="tp-text">
				<span class="tp-name tp-suggest-pw">${e}</span>
				<span class="tp-user">${w(`suggestPasswordUse`)}</span>
			</div>
			<button class="tp-regenerate" data-tp-regenerate="1" type="button" aria-label="${w(`suggestPasswordRegenerate`)}">
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path><path d="M3 21v-5h5"></path></svg>
			</button>
		</div>
	`;
}
function D() {
  return t`
		<button type="button" class="tp-new-login" data-tp-new-login="1">
			<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
			${w(`newLoginTitle`)}
		</button>
	`;
}
function O() {
  return t`
		<div class="tp-item tp-locked" data-tp-popout="1">
			<div class="tp-avatar tp-avatar-locked">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10.5" width="16" height="10" rx="2.4"></rect><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"></path></svg>
			</div>
			<div class="tp-text">
				<span class="tp-name">${w(`vaultLocked`)}</span>
				<span class="tp-user">${w(`vaultLockedUnlockHint`)}</span>
			</div>
			<span class="tp-launch">
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"></path><path d="M20 4l-8.5 8.5"></path><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"></path></svg>
			</span>
		</div>
	`;
}
function k(e) {
  ((document.body.innerHTML = `<style>${S}</style><div class="tp-list" role="listbox">${e}</div>`),
    A());
}
function A() {
  requestAnimationFrame(() => {
    let e = document.body.querySelector(`.tp-list`);
    v(e ? Math.ceil(e.getBoundingClientRect().height) : 0);
  });
}
var j =
    typeof IntersectionObserver < `u` &&
    `trackVisibility` in IntersectionObserver.prototype,
  M = !1;
j &&
  new IntersectionObserver(
    (e) => {
      M = e[e.length - 1]?.isVisible === !0;
    },
    { threshold: [0], trackVisibility: !0, delay: 100 },
  ).observe(document.body);
function N() {
  if (a && performance.now() - p < f) return !1;
  if (!j || M) return !0;
  let e = document.body.querySelector(`.tp-list`);
  return (
    e &&
      !e.querySelector(`.tp-hint`) &&
      (e.insertAdjacentHTML(
        `beforeend`,
        t`<div class="tp-hint" role="status">${w(`pickerUseKeyboard`)}</div>`,
      ),
      A()),
    !1
  );
}
function P(e) {
  ((g = e),
    document.body.querySelectorAll(`.tp-item`).forEach((e, t) => {
      let n = t === g;
      (e.classList.toggle(`tp-active`, n),
        n && e.scrollIntoView({ block: `nearest` }));
    }),
    _({ type: `UI_HIGHLIGHT`, active: g >= 0 }));
}
function F(e) {
  let t = h.length;
  t !== 0 &&
    P(g < 0 ? (e > 0 ? 0 : t - 1) : Math.max(0, Math.min(t - 1, g + e)));
}
function I(e) {
  let t = h[e];
  t &&
    (t.kind === `match`
      ? _({ type: `UI_PICK`, entryId: t.id, otpOnly: m })
      : t.kind === `suggest`
        ? _({ type: `UI_USE_SUGGESTED` })
        : t.kind === `alias`
          ? _({ type: `UI_USE_ALIAS` })
          : _({ type: `UI_POPOUT` }));
}
document.addEventListener(`mousedown`, (e) => {
  if (!e.isTrusted) return;
  let t = e.target;
  if (t?.closest(`[data-tp-regenerate]`)) {
    (e.preventDefault(), _({ type: `UI_REGENERATE` }));
    return;
  }
  let n = t?.closest(`[data-entry-id]`);
  n?.dataset.entryId
    ? (e.preventDefault(),
      N() &&
        _({
          type: `UI_PICK`,
          entryId: n.dataset.entryId,
          otpOnly: m,
          pointer: !0,
        }))
    : t?.closest(`[data-tp-suggest]`)
      ? (e.preventDefault(),
        N() && _({ type: `UI_USE_SUGGESTED`, pointer: !0 }))
      : t?.closest(`[data-tp-alias]`)
        ? (e.preventDefault(), N() && _({ type: `UI_USE_ALIAS`, pointer: !0 }))
        : t?.closest(`[data-tp-new-login]`)
          ? (e.preventDefault(), _({ type: `UI_NEW_LOGIN` }))
          : t?.closest(`[data-tp-popout]`) &&
            (e.preventDefault(), _({ type: `UI_POPOUT` }));
});
var L = new Set([`RENDER_MATCHES`, `RENDER_LOCKED`, `UI_KEY`]);
window.addEventListener(`message`, (e) => {
  if (a) {
    let t = e.data?.type;
    if (t === `UI_MOVED` && e.source === window.parent) {
      p = performance.now();
      return;
    }
    if (!e.source || !t || !L.has(t)) return;
    ((d = { win: e.source, origin: e.origin }), R(e.data));
  } else
    r ||
      e.source !== window.parent ||
      (n && e.origin !== n) ||
      (e.data?.type === `UI_CONNECT` &&
        e.ports[0] &&
        ((r = e.ports[0]),
        (r.onmessage = (e) => R(e.data)),
        r.postMessage({ type: `UI_CONNECTED` })));
});
function R(e) {
  switch (e?.type) {
    case `RENDER_MATCHES`: {
      ((m = !!e.otpOnly), (g = -1), (h = []));
      let t = [];
      (e.alias &&
        (e.alias.state !== `busy` && h.push({ kind: `alias` }),
        t.push(T(e.alias))),
        e.suggest &&
          (h.push({ kind: `suggest` }), t.push(E(e.suggest.password))));
      for (let n of e.matches)
        (h.push({ kind: `match`, id: n.id }),
          t.push(C(n, n.id === e.carriedId)));
      (e.newLogin && t.push(D()),
        k(t.join(``)),
        (p = performance.now()),
        _({ type: `UI_HIGHLIGHT`, active: !1 }));
      break;
    }
    case `RENDER_LOCKED`:
      ((h = [{ kind: `locked` }]),
        (g = -1),
        k(O()),
        (p = performance.now()),
        _({ type: `UI_HIGHLIGHT`, active: !1 }));
      break;
    case `UI_KEY`:
      e.key === `ArrowDown`
        ? F(1)
        : e.key === `ArrowUp`
          ? F(-1)
          : e.key === `Enter` && g >= 0 && I(g);
  }
}
function z() {
  let e = { __tp: o, relayId: i },
    t = 0,
    n = (r, i) => {
      if (i > l || t >= u) return;
      let a = 0;
      try {
        a = r.length;
      } catch {
        return;
      }
      for (let o = 0; o < a; o++) {
        if (t >= u) return;
        let a = null;
        try {
          a = r[o] ?? null;
        } catch {
          continue;
        }
        if (a && a !== window) {
          t++;
          try {
            a.postMessage(e, `*`);
          } catch {}
          n(a, i + 1);
        }
      }
    },
    r = window;
  try {
    r = window.top ?? window;
  } catch {
    r = window;
  }
  if (r !== window)
    try {
      r.postMessage(e, `*`);
    } catch {}
  n(r, 0);
}
if (a) {
  let e = c;
  z();
  let t = setInterval(() => {
    d || --e <= 0 ? clearInterval(t) : z();
  }, s);
} else n && window.parent.postMessage({ type: `AUTOFILL_UI_READY` }, n);
