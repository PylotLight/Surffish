(function () {
  var e = globalThis.browser ?? globalThis.chrome,
    t = {
      create: `WEBAUTHN_CREATE`,
      get: `WEBAUTHN_GET`,
      isUvpaa: `WEBAUTHN_IS_UVPAA`,
    };
  function n(e) {
    return (
      typeof e == `object` &&
      !!e &&
      e.__bramble_pk === `req` &&
      typeof e.id == `string` &&
      Object.hasOwn(t, e.method)
    );
  }
  window.addEventListener(`message`, (r) => {
    if (r.source !== window) return;
    let i = r.data;
    if (!n(i)) return;
    let a = t[i.method],
      o = (e) =>
        window.postMessage(
          { __bramble_pk: `res`, id: i.id, result: e },
          r.origin || `*`,
        );
    Promise.resolve()
      .then(() => e.runtime.sendMessage({ type: a, payload: i.payload }))
      .then((e) => {
        let t = e;
        o(t?.ok && t.data ? t.data : { passthrough: !0 });
      })
      .catch(() => o({ passthrough: !0 }));
  });
})();
