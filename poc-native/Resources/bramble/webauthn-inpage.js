(function () {
  function e(e) {
    let t =
        e instanceof ArrayBuffer
          ? new Uint8Array(e)
          : new Uint8Array(e.buffer, e.byteOffset, e.byteLength),
      n = ``;
    for (let e = 0; e < t.length; e++) n += String.fromCharCode(t[e] ?? 0);
    return btoa(n).replace(/\+/g, `-`).replace(/\//g, `_`).replace(/=+$/, ``);
  }
  function t(e) {
    let t = e.length % 4,
      n =
        e.replace(/-/g, `+`).replace(/_/g, `/`) + (t ? `=`.repeat(4 - t) : ``),
      r = atob(n),
      i = new Uint8Array(r.length);
    for (let e = 0; e < r.length; e++) i[e] = r.charCodeAt(e);
    return i.buffer;
  }
  function n(t) {
    return (t ?? []).map((t) => ({
      type: t.type,
      id: e(t.id),
      transports: t.transports,
    }));
  }
  function r(e) {
    return e instanceof ArrayBuffer || ArrayBuffer.isView(e);
  }
  function i(t) {
    if (typeof t != `object` || !t) return;
    let { first: n, second: i } = t;
    if (r(n))
      return i === void 0
        ? { first: e(n) }
        : r(i)
          ? { first: e(n), second: e(i) }
          : void 0;
  }
  function a(e, t) {
    let n = e?.prf;
    if (typeof n != `object` || !n) return;
    let { eval: r, evalByCredential: a } = n,
      o = {},
      s = i(r);
    return (
      s && (o.eval = s),
      t &&
        typeof a == `object` &&
        a &&
        (o.evalByCredential = Object.fromEntries(
          Object.entries(a).flatMap(([e, t]) => {
            let n = i(t);
            return n ? [[e, n]] : [];
          }),
        )),
      { prf: o }
    );
  }
  function o(e) {
    let n = { ...e.clientExtensionResults },
      r = n.prf,
      i = r?.results?.first;
    if (typeof i == `string`) {
      let e = r?.results?.second;
      n.prf = {
        ...r,
        results: {
          first: t(i),
          ...(typeof e == `string` ? { second: t(e) } : {}),
        },
      };
    }
    return n;
  }
  function s(t) {
    return {
      rp: { id: t.rp?.id, name: t.rp?.name },
      user: {
        id: e(t.user.id),
        name: t.user.name,
        displayName: t.user.displayName,
      },
      challenge: e(t.challenge),
      pubKeyCredParams: (t.pubKeyCredParams ?? []).map((e) => ({
        type: e.type,
        alg: e.alg,
      })),
      excludeCredentials: n(t.excludeCredentials),
      authenticatorSelection: t.authenticatorSelection,
      attestation: t.attestation,
      timeout: t.timeout,
      extensions: a(t.extensions, !1),
    };
  }
  function c(t) {
    return {
      challenge: e(t.challenge),
      rpId: t.rpId,
      allowCredentials: n(t.allowCredentials),
      userVerification: t.userVerification,
      timeout: t.timeout,
      extensions: a(t.extensions, !0),
    };
  }
  function l(e, t) {
    let n = globalThis[t],
      r = typeof n == `function` ? n.prototype : void 0;
    if (r)
      try {
        Object.setPrototypeOf(e, r);
      } catch {}
  }
  function u(e) {
    let n = e.response,
      r = {
        clientDataJSON: t(n.clientDataJSON),
        attestationObject: t(n.attestationObject),
        getAuthenticatorData: () => t(n.authenticatorData),
        getPublicKey: () => (n.publicKey ? t(n.publicKey) : null),
        getPublicKeyAlgorithm: () => n.publicKeyAlgorithm,
        getTransports: () => n.transports ?? [],
      };
    l(r, `AuthenticatorAttestationResponse`);
    let i = {
      id: e.id,
      rawId: t(e.rawId),
      type: e.type,
      authenticatorAttachment: e.authenticatorAttachment ?? `platform`,
      response: r,
      getClientExtensionResults: () => o(e),
      toJSON: () => e,
    };
    return (l(i, `PublicKeyCredential`), i);
  }
  function d(e) {
    let n = e.response,
      r = {
        clientDataJSON: t(n.clientDataJSON),
        authenticatorData: t(n.authenticatorData),
        signature: t(n.signature),
        userHandle: n.userHandle ? t(n.userHandle) : null,
      };
    l(r, `AuthenticatorAssertionResponse`);
    let i = {
      id: e.id,
      rawId: t(e.rawId),
      type: e.type,
      authenticatorAttachment: e.authenticatorAttachment ?? `platform`,
      response: r,
      getClientExtensionResults: () => o(e),
      toJSON: () => e,
    };
    return (l(i, `PublicKeyCredential`), i);
  }
  function f(e, t, n = 18e4) {
    return new Promise((r, i) => {
      let a = crypto.randomUUID(),
        o = setTimeout(() => {
          (c(), i(Error(`passkey transport timeout`)));
        }, n);
      function s(e) {
        if (e.source !== window) return;
        let t = e.data;
        t &&
          t.__bramble_pk === `res` &&
          t.id === a &&
          (c(), r(t.result ?? { passthrough: !0 }));
      }
      function c() {
        (clearTimeout(o), window.removeEventListener(`message`, s));
      }
      (window.addEventListener(`message`, s),
        window.postMessage(
          { __bramble_pk: `req`, id: a, method: e, payload: t },
          location.origin,
        ));
    });
  }
  function p() {
    try {
      return (
        window.top === window ||
        (window.top != null && location.origin === window.top.location.origin)
      );
    } catch {
      return !1;
    }
  }
  async function m() {
    if (!p()) return !1;
    try {
      let e = await f(`isUvpaa`, null, 5e3);
      return `isUvpaa` in e && e.isUvpaa;
    } catch {
      return !1;
    }
  }
  function h() {
    let e = globalThis.PublicKeyCredential;
    if (typeof e?.isUserVerifyingPlatformAuthenticatorAvailable != `function`)
      return;
    let t = e.isUserVerifyingPlatformAuthenticatorAvailable.bind(e);
    if (
      (Object.defineProperty(
        e,
        "isUserVerifyingPlatformAuthenticatorAvailable",
        {
          configurable: !0,
          writable: !0,
          value: async () => (await t()) || (await m()),
        },
      ),
      typeof e.getClientCapabilities != `function`)
    )
      return;
    let n = e.getClientCapabilities.bind(e);
    Object.defineProperty(e, "getClientCapabilities", {
      configurable: !0,
      writable: !0,
      value: async () => {
        let e = await n();
        return (await m())
          ? {
              ...e,
              passkeyPlatformAuthenticator: !0,
              userVerifyingPlatformAuthenticator: !0,
            }
          : e;
      },
    });
  }
  function g() {
    let e = navigator.credentials;
    if (!e || typeof e.create != `function` || typeof e.get != `function`)
      return;
    let t = e.create.bind(e),
      n = e.get.bind(e),
      r = async (e) => {
        let n =
          e?.publicKey?.authenticatorSelection?.authenticatorAttachment ===
          `cross-platform`;
        if (!e?.publicKey || n || !p()) return t(e);
        let r;
        try {
          r = await f(`create`, s(e.publicKey));
        } catch {
          throw new DOMException(
            `The operation either timed out or was not allowed.`,
            `NotAllowedError`,
          );
        }
        if (`passthrough` in r) return t(e);
        if (`error` in r) throw new DOMException(r.error.message, r.error.name);
        try {
          return u(JSON.parse(r.responseJson));
        } catch {
          throw new DOMException(
            `passkey response could not be built`,
            `NotAllowedError`,
          );
        }
      },
      i = async (e) => {
        if (!e?.publicKey || e.mediation === `conditional` || !p()) return n(e);
        let t;
        try {
          t = await f(`get`, c(e.publicKey));
        } catch {
          return n(e);
        }
        if (`passthrough` in t) return n(e);
        if (`error` in t) throw new DOMException(t.error.message, t.error.name);
        try {
          return d(JSON.parse(t.responseJson));
        } catch {
          throw new DOMException(
            `passkey response could not be built`,
            `NotAllowedError`,
          );
        }
      };
    try {
      (Object.defineProperty(e, "create", {
        configurable: !0,
        writable: !0,
        value: r,
      }),
        Object.defineProperty(e, "get", {
          configurable: !0,
          writable: !0,
          value: i,
        }),
        h());
    } catch {}
  }
  g();
})();
