var e = globalThis,
  t = e.browser ?? e.chrome,
  n = new URLSearchParams(location.search).get(`id`) ?? ``,
  r = document.querySelector(`input`);
r.setAttribute(`aria-label`, t.i18n.getMessage(`fieldUsername`));
function i(e) {
  try {
    return t.runtime
      .sendMessage({ type: `CORNER_FIELD`, payload: { id: n, ...e } })
      .then(
        (e) => e,
        () => void 0,
      );
  } catch {
    return Promise.resolve(void 0);
  }
}
function a(e) {
  i({ op: `value`, value: r.value, ...(e === void 0 ? {} : { flush: e }) });
}
var o = !1;
(r.addEventListener(`input`, () => {
  ((o = !0), a());
}),
  window.addEventListener(`message`, (e) => {
    let t = e.data;
    e.source === window.parent &&
      t?.type === `CORNER_FIELD_FLUSH` &&
      typeof t.n == `number` &&
      a(t.n);
  }),
  i({ op: `open` }).then((e) => {
    e?.ok && (o || (r.value = e.data?.value ?? ``), a());
  }));
