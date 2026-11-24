(function () {
  function e(e) {
    return new RegExp(e.join(`|`), `i`);
  }
  var t = e(
      `email,e-mail,\\bmail\\b,user,login,account,signin,sign-in,benutzer,nutzername,anmeldename,anmeld,kundennummer,gebruiker,inloggen,aanmelden,anv(ä|a)ndare,anv(ä|a)ndarnamn,logga.?in,inloggning,\\be.?post\\b,mejl,brugernavn,brukernavn,logg.?inn,log.?ind,k(ä|a)ytt(ä|a)j(ä|a),s(ä|a)hk(ö|o)posti,kirjaudu,utilisateur,identifiant,courriel,connexion,se.?connecter,\\bcompte\\b,usuario,correo,iniciar.?sesi(ó|o)n,\\bsesi(ó|o)n\\b,\\bcuenta\\b,\\bacceso\\b,utilizador,usu(á|a)rio,\\bconta\\b,iniciar.?sess(ã|a)o,utente,\\baccedi\\b,\\baccesso\\b,credenziali,posta.?elettronica,u(ż|z)ytkownik,zaloguj,logowanie,\\bkonto\\b,kullan(ı|i)c(ı|i),\\be.?posta\\b,giri(ş|s),hesap,логин,пользовател,почта,вход,уч(ё|е)тная,ユーザー,メール,ログイン,用户,邮箱,登录,登入,帳號,账号,사용자,이메일,로그인`.split(
        `,`,
      ),
    ),
    n = e([
      `email`,
      `e-mail`,
      `\\bmail\\b`,
      `e.?mail.?adresse`,
      `mailadres`,
      `\\be.?post\\b`,
      `mejl`,
      `s(ä|a)hk(ö|o)posti`,
      `courriel`,
      `adresse.?(é|e)lectronique`,
      `correo`,
      `correio`,
      `e.?mail`,
      `posta.?elettronica`,
      `\\be.?posta\\b`,
      `почта`,
      `эл.?адрес`,
      `メール`,
      `邮箱`,
      `郵箱`,
      `電子郵件`,
      `이메일`,
    ]);
  function r(e, t = document) {
    if (e.type === `password` || e.type === `hidden`) return !1;
    if (
      e.type === `email` ||
      (e.autocomplete?.toLowerCase() ?? ``).split(/\s+/).includes(`email`)
    )
      return !0;
    let r = `${_(e)} ${v(e, t)}`;
    return i.test(r)
      ? !1
      : e.getAttribute(`inputmode`)?.toLowerCase() === `email` || n.test(r);
  }
  var i = e([
      `search`,
      `captcha`,
      `coupon`,
      `otp`,
      `code`,
      `suche`,
      `suchen`,
      `zoek`,
      `recherche`,
      `buscar`,
      `b(ú|u)squeda`,
      `\\bbusca\\b`,
      `\\bcerca\\b`,
      `ricerca`,
      `pesquisa`,
      `\\bs(ö|o)k\\b`,
    ]),
    a = `input[type="text"]:not([readonly]):not([disabled]), input[type="email"]:not([readonly]):not([disabled]), input[type="tel"]:not([readonly]):not([disabled]), input:not([type]):not([readonly]):not([disabled])`,
    o = null,
    s = !1;
  function c() {
    o = null;
  }
  function l() {
    return s;
  }
  function u(e, t) {
    for (let n = e.firstElementChild; n; n = n.nextElementSibling)
      if (t(n) || (n.shadowRoot && u(n.shadowRoot, t)) || u(n, t)) return !0;
    return !1;
  }
  function d(e) {
    let t = e.nodeType === 9 ? e : null;
    if (t && o?.doc === t) return o.present;
    let n = t ? t.documentElement : e,
      r = !1;
    if (n) {
      if (n instanceof Element && n.shadowRoot) r = !0;
      else {
        let e = (n.ownerDocument ?? document).createTreeWalker(
          n,
          NodeFilter.SHOW_ELEMENT,
        );
        for (let t = e.nextNode(); t; t = e.nextNode())
          if (t.shadowRoot) {
            r = !0;
            break;
          }
      }
    }
    return (r && (s = !0), t && (o = { doc: t, present: r }), r);
  }
  function f(e, t = document) {
    if (!d(t)) return Array.from(t.querySelectorAll(e));
    let n = [];
    return (u(t, (t) => (t.matches(e) && n.push(t), !1)), n);
  }
  function p(e, t = document) {
    if (!d(t)) return t.querySelector(e);
    let n = null;
    return (u(t, (t) => (t.matches(e) ? ((n = t), !0) : !1)), n);
  }
  function m(e, t) {
    let n = e;
    for (; n;) {
      let e = n.closest(t);
      if (e) return e;
      let r = n.getRootNode();
      n = r instanceof ShadowRoot ? r.host : null;
    }
    return null;
  }
  function h(e = document) {
    let t = e.activeElement;
    for (; t?.shadowRoot?.activeElement;) t = t.shadowRoot.activeElement;
    return t;
  }
  function g(e) {
    return e.composedPath()[0] ?? e.target;
  }
  var ee = `input:not([readonly]):not([disabled])`,
    te = `input[type="password"]:not([readonly]):not([disabled])`;
  function ne(e, t) {
    return e.filter((e) => e.matches(t));
  }
  function re(e, t, n) {
    let r = ne(t, n);
    return r.find((t) => e.shown(t)) ?? r[0] ?? null;
  }
  function ie(e, t) {
    let n = [],
      r = [];
    for (let i of t) (e.shown(i) ? n : r).push(i);
    return r.length === 0 ? t : [...n, ...r];
  }
  function ae(e = document) {
    let t = e.ownerDocument ?? e,
      n = f(`input`, e),
      r = new Map(),
      i = new Map(),
      a = null;
    return {
      doc: t,
      inputs: n,
      editable: ne(n, ee),
      selects() {
        return (
          a === null && (a = f(`select:not([disabled]):not([readonly])`, e)),
          a
        );
      },
      label(e) {
        let n = r.get(e);
        return (n === void 0 && ((n = v(e, t)), r.set(e, n)), n);
      },
      shown(e) {
        let t = i.get(e);
        return (t === void 0 && ((t = Ye(e)), i.set(e, t)), t);
      },
    };
  }
  function oe(e = document, t = ae(e)) {
    return re(t, t.inputs, te);
  }
  function _(e) {
    return `${e.name} ${e.id} ${e.placeholder} ${e.autocomplete} ${e.getAttribute(`aria-label`) ?? ``}`;
  }
  function v(e, t = document) {
    let n = [],
      r = e.getRootNode();
    if (e.id) {
      let t = typeof CSS < `u` && CSS.escape ? CSS.escape(e.id) : e.id;
      try {
        for (let e of r.querySelectorAll(`label[for="${t}"]`))
          n.push(e.textContent ?? ``);
      } catch {}
    }
    let i = m(e, `label`);
    i && n.push(i.textContent ?? ``);
    let a = e.getAttribute(`aria-labelledby`);
    if (a)
      for (let e of a.split(/\s+/)) {
        if (!e) continue;
        let i = r.getElementById(e) ?? t.getElementById(e);
        i && n.push(i.textContent ?? ``);
      }
    return n.join(` `);
  }
  function se(e) {
    let n = _(e);
    if (i.test(n)) return !1;
    if (e.type === `email`) return !0;
    let r = e.autocomplete?.toLowerCase() ?? ``;
    return r.includes(`username`) || r === `email` ? !0 : t.test(n);
  }
  function ce(e, t = ae(e.ownerDocument)) {
    let n = m(e, `form`),
      r = `${a}, input[type="password"]`,
      o = n ? f(r, n) : ne(t.inputs, r),
      s = null,
      c = null;
    for (let n of o) {
      if (n === e) return c ?? s;
      n.type !== `password` &&
        (i.test(_(n)) || ((s = n), t.shown(n) && (c = n)));
    }
    return c ?? s;
  }
  var le = /card.?number|cardnum|ccnum|cc.?number/i,
    ue = /\bpan\b/i,
    de =
      /card.?scheme|card.?type|cardholder|masked.?pan|expiry|expiration|\bcvv\b|\bcvc\b|\bcsc\b/i,
    fe = /cardholder|name.?on.?card|cc.?name/i,
    pe = /expir(y|ation)/i,
    me = /exp.*month|cc.?month|card.*month/i,
    he = /exp.*year|cc.?year|card.*year/i,
    ge = /\bcvv\b|\bcvc\b|\bcvn\b|\bcsc\b|card.?code|card.?verif/i,
    _e = /security.?code/i;
  function ve(e, t) {
    return re(e, e.editable, `input[autocomplete~="${t}"]`);
  }
  function y(e, t, n, r = !1) {
    let i = [];
    for (let t of ie(e, e.editable))
      t.type !== `hidden` &&
        t.type !== `checkbox` &&
        t.type !== `radio` &&
        (t.type !== `password` || r) &&
        i.push(t);
    for (let e of i) {
      let r = _(e);
      if (!n?.test(r) && t.test(r)) return e;
    }
    for (let r of i) {
      let i = e.label(r);
      if (i && !n?.test(i) && t.test(i)) return r;
    }
    return null;
  }
  function ye(e, t) {
    return e.cvv || e.name || e.expCombined || e.expMonth || e.expYear
      ? !0
      : t.inputs.some((e) => de.test(_(e)));
  }
  function be(e) {
    let t = e.getAttribute(`aria-label`) ?? ``;
    return `${e.name} ${e.id} ${e.autocomplete} ${t} ${v(e)}`;
  }
  function xe(e, t, n) {
    let r = e.selects(),
      i = r.filter((e) => e.matches(`select[autocomplete~="${t}"]`)),
      a = i.length > 0 ? i : r.filter((e) => n.test(be(e)));
    return a.find((e) => Ye(e)) ?? a[0] ?? null;
  }
  function Se(e = document, t = ae(e)) {
    let n = ve(t, `cc-name`) ?? y(t, fe),
      r = ve(t, `cc-exp-month`) ?? y(t, me),
      i = ve(t, `cc-exp-year`) ?? y(t, he),
      a = ve(t, `cc-csc`) ?? y(t, ge, void 0, !0),
      o = ve(t, `cc-number`) ?? y(t, le),
      s = !!(o || a || n || r || i),
      c = r ?? (s ? xe(t, `cc-exp-month`, me) : null),
      l = i ?? (s ? xe(t, `cc-exp-year`, he) : null),
      u = {
        name: n,
        expCombined:
          !c && !l ? (ve(t, `cc-exp`) ?? y(t, pe, /month|year/i)) : null,
        expMonth: c,
        expYear: l,
        cvv: null,
      },
      d = a ?? (o || ye(u, t) ? y(t, _e, void 0, !0) : null),
      f = { ...u, cvv: d };
    return { number: o ?? (ye(f, t) ? y(t, ue) : null), ...f };
  }
  var Ce = [`cc-number`, `cc-exp`, `cc-exp-month`, `cc-exp-year`, `cc-csc`]
    .map((e) => `[autocomplete~="${e}"]`)
    .join(`,`);
  function we(e) {
    if (
      [e.number, e.cvv, e.expCombined, e.expMonth, e.expYear].some((e) =>
        e?.matches(Ce),
      )
    )
      return !0;
    let t = e.expCombined ?? e.expMonth ?? e.expYear;
    return [e.number, e.cvv, t].filter(Boolean).length >= 2;
  }
  function Te(e, t) {
    return (
      t === e.number ||
      t === e.name ||
      t === e.expCombined ||
      t === e.expMonth ||
      t === e.expYear ||
      t === e.cvv
    );
  }
  var Ee = e(
      `(?<![a-z])(otp|otc|totp)(?![a-z]),one.?time,2fa,mfa,two.?factor,authenticator,vip.?(pin|code|token|access),auth.?code,login.?code,verif(y|ication).?code,confirmation.?code,security.?code,passcode,6.?digit,einmal(code|passwort|kennwort),best(ä|ae)tigungscode,sicherheitscode,verifizierungscode,pr(ü|ue)fcode,code de (v(é|e)rification|s(é|e)curit(é|e)),code (à|a) usage unique,c(ó|o)digo de (verificaci(ó|o)n|seguridad|confirmaci(ó|o)n),codice di (verifica|sicurezza),c(ó|o)digo de verifica(ç|c)(ã|a)o,verificatiecode,beveiligingscode,verifieringskod,s(ä|a)kerhetskod,eng(å|a)ngskod`.split(
        `,`,
      ),
    ),
    De = (e) => e.replace(/([a-z])([A-Z])/g, `$1 $2`),
    Oe = e([
      `\\bcode\\b`,
      `\\bkod\\b`,
      `\\bkode\\b`,
      `\\bc(ó|o)digo\\b`,
      `\\bcodice\\b`,
    ]),
    ke = e(
      `card.coupon.promo.presale.postal.\\bzip\\b.country.address.phone.gift.referral.invite.discount.voucher.redeem.karte.gutschein.postleitzahl.\\bplz\\b.adresse.telefon.carte.pays.t(é|e)l(é|e)phone.tarjeta.pa(í|i)s.direcci(ó|o)n.tel(é|e)fono.tessera.postnummer.adress`.split(
        `.`,
      ),
    ),
    Ae = new Set([`text`, `tel`, `number`, ``]),
    je = 4,
    Me = `input:not([type="hidden"])`,
    Ne = /^\^?(\\d|\\w|\[[^\]]+\]|\.)(\{1\})?\$?$/,
    Pe = 4,
    Fe = 8,
    Ie = /\\d|\[0-9\]|\[\\d\]/;
  function Le(e) {
    return ![
      `password`,
      `hidden`,
      `checkbox`,
      `radio`,
      `submit`,
      `button`,
    ].includes(e.type);
  }
  function Re(e) {
    return e.maxLength >= Pe && e.maxLength <= Fe;
  }
  function ze(e) {
    let t = e.getAttribute(`inputmode`)?.toLowerCase() ?? ``;
    return (
      t === `numeric` ||
      t === `tel` ||
      t === `decimal` ||
      e.type === `tel` ||
      e.type === `number` ||
      Ie.test(e.getAttribute(`pattern`) ?? ``)
    );
  }
  function Be(e) {
    return Ae.has(e.type)
      ? e.maxLength === 1 || Ne.test(e.getAttribute(`pattern`) ?? ``)
      : !1;
  }
  function Ve(e) {
    let t = e.parentElement;
    for (; t?.parentElement && t.querySelectorAll(Me).length === 1;)
      t = t.parentElement;
    return t;
  }
  function He(e) {
    let t = [],
      n = null;
    for (let r of e.editable) {
      if (r.type === `hidden`) continue;
      let e = Be(r) && !ke.test(_(r)) ? Ve(r) : null;
      if (e !== n) {
        if (t.length >= je) return t;
        ((t = []), (n = e));
      }
      e && t.push(r);
    }
    return t.length >= je ? t : [];
  }
  function Ue(e, t) {
    let n = [];
    for (let r of e.editable)
      Le(r) &&
        (Te(t, r) ||
          (Re(r) &&
            ze(r) &&
            (ke.test(_(r)) || ke.test(e.label(r)) || n.push(r))));
    return n.length === 1 ? n : [];
  }
  function We(e) {
    let t = Ve(e);
    if (!t) return [e];
    let n = Array.from(t.querySelectorAll(`input`)).filter(
      (e) => !e.readOnly && !e.disabled && Be(e),
    );
    return n.length >= 2 ? n : [e];
  }
  function Ge(e) {
    let t = e.filter(Be);
    return t.length < 2
      ? { boxes: [], whole: e[0] ?? null }
      : {
          boxes: t,
          whole:
            e.find(
              (e) =>
                !t.includes(e) && (e.maxLength <= 0 || e.maxLength >= t.length),
            ) ?? null,
        };
  }
  function Ke(e = document, t, n = ae(e)) {
    let r = ne(n.editable, `input[autocomplete~="one-time-code"]`);
    if (r.length >= 1) return r;
    let i = t ?? Se(e, n),
      a = null;
    for (let e of n.editable) {
      if (!Le(e) || Te(i, e)) continue;
      let t = De(_(e));
      if (ke.test(t)) continue;
      if (Ee.test(t) || (Oe.test(t) && Re(e))) {
        a = e;
        break;
      }
      let r = n.label(e);
      if (r && !ke.test(r) && (Ee.test(r) || (Oe.test(r) && Re(e)))) {
        a = e;
        break;
      }
    }
    if (a) {
      if (a.maxLength === 1) {
        let e = We(a);
        if (e.length >= 2) return e;
      }
      return [a];
    }
    let o = He(n);
    return o.length > 0 ? o : Ue(n, i);
  }
  var qe = [
    `.g-recaptcha:not([data-size='invisible'])`,
    `.h-captcha`,
    `.cf-turnstile`,
    `iframe[src*="recaptcha/api2/anchor"]`,
    `iframe[src*="recaptcha/api2/bframe"]`,
    `iframe[src*="hcaptcha.com"]`,
    `iframe[src*="challenges.cloudflare.com"]`,
    `iframe[src*="arkoselabs.com"]`,
    `iframe[src*="funcaptcha.com"]`,
    `iframe[title*="captcha" i]`,
  ];
  function Je(e) {
    if (e.parentElement) return e.parentElement;
    let t = e.getRootNode();
    return t instanceof ShadowRoot ? t.host : null;
  }
  function Ye(e) {
    if (typeof e.checkVisibility == `function`)
      return e.checkVisibility({ checkOpacity: !0, checkVisibilityCSS: !0 });
    let t = e.ownerDocument?.defaultView;
    if (!t?.getComputedStyle) return !0;
    for (let n = e; n; n = Je(n)) {
      let e = t.getComputedStyle(n);
      if (!e) return !0;
      if (
        e.display === `none` ||
        e.visibility === `hidden` ||
        e.opacity === `0`
      )
        return !1;
    }
    return !0;
  }
  function b(e) {
    let t = e.getBoundingClientRect();
    return t.width < 10 || t.height < 10 ? !1 : Ye(e);
  }
  function Xe(e, t) {
    return !e.isConnected ||
      e.ownerDocument !== document ||
      (t.width <= 0 && t.height <= 0)
      ? !1
      : Ye(e);
  }
  function Ze(e = document) {
    for (let t of qe) for (let n of e.querySelectorAll(t)) if (b(n)) return !0;
    return !1;
  }
  function Qe(e) {
    let t = e.toLowerCase().match(/[a-z0-9]+/g);
    return !t || t.length === 0
      ? null
      : { canonical: t.join(``), hyphen: t.join(`-`) };
  }
  var $e = new Set([`text`, `tel`, `number`, `search`, `url`, ``]);
  function et(e = document, t = ae(e)) {
    return t.editable.filter((e) => $e.has(e.type));
  }
  function tt(e, t) {
    let n = e.autocomplete?.toLowerCase().trim();
    if (n) {
      for (let e of n.split(/\s+/))
        if (e === t.hyphen || e.replace(/[^a-z0-9]/g, ``) === t.canonical)
          return !0;
    }
    for (let n of [
      e.name,
      e.id,
      e.getAttribute(`aria-label`) ?? ``,
      e.placeholder,
      v(e),
    ]) {
      let e = n.toLowerCase().replace(/[^a-z0-9]/g, ``);
      if (
        e &&
        (e === t.canonical ||
          (t.canonical.length >= 5 && e.includes(t.canonical)))
      )
        return !0;
    }
    return !1;
  }
  function nt(e = document) {
    let t = ae(e),
      n = Se(e, t);
    return { login: st(e, t), card: n, otp: Ke(e, n, t) };
  }
  function rt(e, t) {
    if (!(t instanceof HTMLInputElement) || t.readOnly || t.disabled)
      return null;
    let n = we(e.card) && Te(e.card, t);
    return n && t === e.card.cvv && t.type === `password`
      ? `card`
      : t === e.login.username ||
          t === e.login.password ||
          t.type === `password`
        ? `login`
        : n
          ? `card`
          : e.otp.includes(t)
            ? `otp`
            : null;
  }
  function it(e, t) {
    return rt(e, t) !== null;
  }
  var at = new Set([
    `hidden`,
    `checkbox`,
    `radio`,
    `submit`,
    `reset`,
    `button`,
    `image`,
    `file`,
    `color`,
    `range`,
  ]);
  function ot(e) {
    return !(e instanceof HTMLInputElement) || e.readOnly || e.disabled
      ? !1
      : !at.has(e.type);
  }
  function st(e = document, n = ae(e)) {
    let r = oe(e, n);
    if (r) {
      let e = ce(r, n);
      if (e) return { username: e, password: r };
    }
    let o = re(
      n,
      n.editable,
      `input[autocomplete~="username"], input[autocomplete="email"]`,
    );
    if (o) return { username: o, password: r };
    let s = re(n, n.editable, `input[type="email"]`);
    if (s) return { username: s, password: r };
    let c = ie(n, ne(n.inputs, a));
    for (let e of c) if (se(e)) return { username: e, password: r };
    for (let e of c) {
      let a = n.label(e);
      if (a && !i.test(a) && t.test(a)) return { username: e, password: r };
    }
    return { username: null, password: r };
  }
  function ct(e, t) {
    return t?.type !== `password` || t === e.login.password
      ? e.login
      : { username: ce(t), password: t };
  }
  function lt(e = document) {
    let t = f(`input[type="password"]:not([readonly]):not([disabled])`, e);
    if (t.length < 2) return null;
    let n = /new|set/i,
      r = /old|current|confirm|verify|repeat|re.?type|again/i,
      i = null;
    for (let a of t) {
      let t = `${a.autocomplete ?? ``} ${_(a)} ${v(a, e) ?? ``}`;
      if (
        !r.test(t) &&
        (a.autocomplete?.toLowerCase().includes(`new-password`) || n.test(t))
      ) {
        i = a;
        break;
      }
    }
    if (!i?.value) return null;
    for (let e of t) if (e !== i && e.value === i.value) return i;
    return null;
  }
  var ut = null;
  function x() {
    ((ut = null), c());
  }
  function S() {
    return ((ut && !ft(ut)) || (ut = nt()), ut);
  }
  function dt(e) {
    return [
      e.login.username,
      e.login.password,
      e.card.number,
      e.card.name,
      e.card.expCombined,
      e.card.expMonth,
      e.card.expYear,
      e.card.cvv,
      ...e.otp,
    ].filter((e) => e !== null);
  }
  function ft(e) {
    return dt(e).some((e) => !e.isConnected);
  }
  var pt = { bubbles: !0, composed: !0 },
    mt = { ...pt, cancelable: !0 };
  function ht(e, t) {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      `value`,
    )?.set?.call(e, t);
  }
  function gt(e, t, n) {
    let r = t.length === 1 ? t : null;
    (r && e.dispatchEvent(new KeyboardEvent(`keydown`, { key: r, ...mt })),
      e.dispatchEvent(
        new InputEvent(`beforeinput`, { data: t, inputType: n, ...mt }),
      ),
      ht(e, t),
      e.dispatchEvent(
        new InputEvent(`input`, { data: t, inputType: n, ...pt }),
      ),
      r && e.dispatchEvent(new KeyboardEvent(`keyup`, { key: r, ...mt })));
  }
  function C(e, t) {
    (gt(e, t, `insertText`),
      e.dispatchEvent(new Event(`change`, { bubbles: !0 })));
  }
  function _t(e, t) {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      `value`,
    )?.set?.call(e, t);
  }
  function vt(e, t) {
    let n = Array.from(e.options),
      r = (e) => {
        for (let r of t) {
          let t = r.trim().toLowerCase();
          if (!t) continue;
          let i = n.find((n) => e(n, t));
          if (i) return i;
        }
        return null;
      },
      i =
        r((e, t) => e.value.trim().toLowerCase() === t) ??
        r((e, t) => {
          let n = (e.textContent ?? ``).trim().toLowerCase();
          return n === t || n.startsWith(`${t} `) || n.startsWith(`${t}-`);
        });
    return i
      ? (_t(e, i.value),
        e.dispatchEvent(new Event(`input`, pt)),
        e.dispatchEvent(new Event(`change`, { bubbles: !0 })),
        !0)
      : !1;
  }
  var yt = !1;
  function bt() {
    return yt;
  }
  var w = new WeakSet();
  function xt(e, t) {
    return b(e) ? (w.has(e) ? t : e.value !== ``) : !0;
  }
  var St = null;
  function Ct() {
    return St;
  }
  function wt(e, t, n, r = null) {
    let { username: i, password: a } = ct(S(), r),
      o = !1;
    return (
      i && !(n && w.has(i)) && (C(i, e), w.add(i), (o = !0)),
      a && !(n && w.has(a)) && (C(a, t), w.add(a), (St = t), (o = !0)),
      { filled: o, passwordField: a }
    );
  }
  function Tt(e, t) {
    let n = !1;
    for (let r of e) (C(r, t), w.add(r), (n = !0));
    return (n && (St = t), n);
  }
  function Et(e, t) {
    return (C(e, t), w.add(e), !0);
  }
  function Dt(e) {
    if (!e) return;
    let t = m(e, `form`);
    if (t && typeof t.requestSubmit == `function`)
      try {
        t.requestSubmit();
        return;
      } catch {}
    let n = new KeyboardEvent(`keydown`, {
      key: `Enter`,
      code: `Enter`,
      keyCode: 13,
      which: 13,
      bubbles: !0,
      cancelable: !0,
    });
    e.dispatchEvent(n);
  }
  function Ot() {
    let e = new Set(),
      { login: t, card: n, otp: r } = S();
    (t.username && e.add(t.username), t.password && e.add(t.password));
    for (let t of [
      n.number,
      n.name,
      n.expCombined,
      n.expMonth,
      n.expYear,
      n.cvv,
    ])
      t instanceof HTMLInputElement && e.add(t);
    for (let t of r) e.add(t);
    return e;
  }
  function kt(e, t) {
    if (!e || e.length === 0) return;
    let n = Ot(),
      r = et().filter((e) => !n.has(e));
    for (let n of e) {
      if (!n.value) continue;
      let e = Qe(n.key);
      if (e) {
        for (let i of r)
          if (!xt(i, t) && tt(i, e)) {
            (C(i, n.value), w.add(i));
            break;
          }
      }
    }
  }
  function At(e) {
    return e.replace(/\D/g, ``);
  }
  function jt(e, t) {
    let n = t.slice(-2);
    return e.maxLength > 0 && e.maxLength <= 2
      ? n
      : t.length <= 2
        ? `20${n}`
        : t;
  }
  function Mt(e, t) {
    let n = S().card,
      r = !1,
      i = (e, n) => {
        e && n && b(e) && ((t && w.has(e)) || (C(e, n), w.add(e), (r = !0)));
      },
      a = (e, n) => {
        let i = n[0];
        if (e && i && b(e) && !(t && w.has(e))) {
          if (e instanceof HTMLSelectElement) {
            if (!vt(e, n)) return;
          } else C(e, i);
          (w.add(e), (r = !0));
        }
      },
      o = e.expMonth.padStart(2, `0`),
      s = e.expYear.length <= 2 ? `20${e.expYear.slice(-2)}` : e.expYear;
    return (
      i(n.number, At(e.number)),
      i(n.name, e.cardholderName),
      n.expCombined && i(n.expCombined, `${o}/${e.expYear.slice(-2)}`),
      a(n.expMonth, [o, String(Number(o))]),
      n.expYear &&
        a(
          n.expYear,
          n.expYear instanceof HTMLSelectElement
            ? [s, s.slice(-2)]
            : [jt(n.expYear, e.expYear)],
        ),
      i(n.cvv, e.cvv),
      r
    );
  }
  function Nt(e, t) {
    return e.every((e, n) => e.value === (t[n] ?? ``));
  }
  function Pt(e) {
    for (let t of e)
      t.value &&
        (t.focus(),
        t.select(),
        t.dispatchEvent(
          new InputEvent(`beforeinput`, {
            inputType: `deleteContentBackward`,
            ...mt,
          }),
        ),
        ht(t, ``),
        t.dispatchEvent(
          new InputEvent(`input`, {
            inputType: `deleteContentBackward`,
            ...pt,
          }),
        ));
  }
  function Ft(e, t) {
    if (
      typeof ClipboardEvent != `function` ||
      typeof DataTransfer != `function`
    )
      return;
    let n = new DataTransfer();
    (n.setData(`text/plain`, t),
      e.dispatchEvent(
        new ClipboardEvent(`paste`, { clipboardData: n, ...mt }),
      ));
  }
  function It(e, t, n) {
    let r = e[0];
    (r.focus(),
      r.select(),
      Ft(r, n),
      Nt(e, n) ||
        (gt(r, n, `insertFromPaste`),
        r.dispatchEvent(new Event(`change`, { bubbles: !0 }))),
      Nt(e, n) ||
        (Pt(e),
        e.forEach((e, t) => {
          let r = n[t];
          r && (e.focus(), C(e, r));
        })));
    for (let t of e) w.add(t);
    t && (C(t, n), w.add(t));
  }
  function Lt(e) {
    if (!e) return !1;
    let { boxes: t, whole: n } = Ge(S().otp);
    yt = !0;
    try {
      return t.length >= 2
        ? (It(t, n, e), !0)
        : n
          ? (C(n, e), w.add(n), !0)
          : !1;
    } finally {
      yt = !1;
    }
  }
  var Rt = globalThis,
    T = Rt.browser ?? Rt.chrome,
    zt = !0,
    Bt = [];
  function Vt(e) {
    Bt.push(e);
  }
  function Ht() {
    for (let e of Bt) e();
  }
  function Ut() {
    return zt ? (T.runtime?.id ? !0 : ((zt = !1), Ht(), !1)) : !1;
  }
  function Wt() {
    ((zt = !1), Ht());
  }
  function E(e) {
    if (Ut())
      try {
        T.runtime.sendMessage(e);
      } catch {
        ((zt = !1), Ht());
      }
  }
  async function Gt(e) {
    if (!Ut()) return;
    let t;
    try {
      t = T.runtime.sendMessage(e);
    } catch {
      Wt();
      return;
    }
    try {
      return await t;
    } catch {
      return;
    }
  }
  var D = {
      newPasswordToken: 100,
      confirmPair: 100,
      changeForm: 100,
      tosLink: 40,
      nameField: 30,
      signupUrl: 40,
      signupText: 40,
      setPasswordAction: 40,
      createHint: 35,
      identifiedAccount: 30,
      pwRules: 20,
      strengthMeter: 20,
      largeForm: 15,
      loginUrl: -40,
      loginText: -35,
      returningUser: -40,
    },
    Kt = /current.?password|old.?password|existing.?password/i,
    qt =
      /new.?password|create.?password|set.?(a.?)?password|choose.?(a.?)?password|confirm.?password|repeat.?password|re.?enter.?password|re.?type.?password/i,
    Jt = /first.?name|last.?name|full.?name|given.?name|family.?name/i,
    Yt =
      /sign[_-]?up|regist(er|ration|ro|rieren)|\/join\b|create[_-]?account|new[_-]?account|inscription|cadastr|kayit/i,
    Xt = /log[_-]?in|sign[_-]?in|\/auth\b|\/session|anmelden|connexion/i,
    Zt =
      /terms|privacy|\btos\b|eula|conditions|datenschutz|confidential|privacidad|informativa/i,
    Qt =
      `sign up.signup.register.registration.create account.create an account.create your account.get started.join now.join free.crear cuenta.crea tu cuenta.regístrate.registrate.registrarse.s'inscrire.inscription.créer un compte.registrieren.konto erstellen.registrati.iscriviti.crea account.cadastre-se.criar conta.cadastro.registreren.account aanmaken.регистрация.зарегистрироваться.создать аккаунт.注册.创建账户.創建帳戶.新規登録.アカウント作成.会員登録.회원가입.가입하기.계정 만들기.kayıt ol.hesap oluştur.zarejestruj.załóż konto`.split(
        `.`,
      ),
    $t =
      `set password.set a password.set your password.set new password.create password.create a password.create new password.choose a password.choose password.change password.change your password.update password.reset password.reset your password.save password.new password.confirm password.cambiar contrase.crear contrase.restablecer contrase.nueva contrase.changer le mot de passe.modifier le mot de passe.nouveau mot de passe.réinitialiser le mot de passe.reinitialiser le mot de passe.passwort ändern.passwort andern.passwort festlegen.passwort erstellen.passwort zurücksetzen.passwort zurucksetzen.neues passwort.wachtwoord wijzigen.wachtwoord instellen.nieuw wachtwoord.alterar senha.criar senha.redefinir senha.nova senha.cambia password.modifica password.nuova password.nytt lösenord.ändra lösenord.изменить пароль.новый пароль.新密码.修改密码.パスワードを変更.新しいパスワード.비밀번호 변경.새 비밀번호.şifre değiştir.yeni şifre.zmień hasło.nowe hasło`.split(
        `.`,
      ),
    en = [
      `remember me`,
      `forgot password`,
      `forgot your password`,
      `mot de passe oublié`,
      `passwort vergessen`,
      `contraseña olvidada`,
      `olvidaste tu contraseña`,
      `esqueceu a senha`,
      `password dimenticata`,
    ];
  function tn(e) {
    return `${_(e)} ${e.title} ${v(e)}`;
  }
  function nn(e) {
    let t = e.getAttribute(`aria-label`) ?? ``;
    return `${e.name} ${e.id} ${e.placeholder} ${t} ${e.title} ${v(e)}`;
  }
  function rn(e) {
    return (e.autocomplete?.toLowerCase() ?? ``)
      .split(/\s+/)
      .includes(`current-password`)
      ? !0
      : Kt.test(tn(e));
  }
  function an(e) {
    return (e.autocomplete?.toLowerCase() ?? ``)
      .split(/\s+/)
      .includes(`new-password`);
  }
  function on(e) {
    return m(e, `form`);
  }
  function sn(e) {
    let t = f(
      `input[type="password"]:not([readonly]):not([disabled])`,
      on(e) ?? e.ownerDocument,
    ).filter((e) => b(e) && !rn(e));
    return (t.includes(e) || t.unshift(e), t);
  }
  var cn = `button, [role="button"], input[type="submit"], input[type="button"]`;
  function ln(e) {
    return `${e instanceof HTMLInputElement ? e.value : (e.textContent ?? ``)} ${e.title} ${e.getAttribute(`aria-label`) ?? ``}`;
  }
  function un(e, t) {
    let n = [];
    for (let t of f(cn, e)) n.push(ln(t));
    for (let e of t.querySelectorAll(`h1, h2, legend`))
      n.push(e.textContent ?? ``);
    return (n.push(t.title), n.join(` `).toLowerCase());
  }
  function dn(e, t) {
    let n = [t];
    for (let t of f(`a[href]`, e)) n.push(t.textContent ?? ``);
    for (let t of f(`input[type="checkbox"]`, e)) n.push(v(t));
    return n.join(` `).toLowerCase();
  }
  function fn(e) {
    for (let t of f(cn, e)) {
      let e = ln(t).toLowerCase();
      if ($t.some((t) => e.includes(t))) return !0;
    }
    return !1;
  }
  function pn(e) {
    for (let t of f(`a[href]`, e)) {
      let e = t.getAttribute(`href`) ?? ``;
      if (Zt.test(e) || Zt.test(t.textContent ?? ``)) return !0;
    }
    for (let t of f(`input[type="checkbox"]`, e))
      if (Zt.test(`${_(t)} ${v(t)}`)) return !0;
    return !1;
  }
  function mn(e) {
    if (
      p(
        `input[autocomplete~="given-name"], input[autocomplete~="family-name"], input[autocomplete~="name"]`,
        e,
      )
    )
      return !0;
    for (let t of f(
      `input[type="text"]:not([readonly]):not([disabled]), input:not([type]):not([readonly]):not([disabled])`,
      e,
    ))
      if (Jt.test(`${_(t)} ${v(t)}`)) return !0;
    return !1;
  }
  function hn(e) {
    let t = e.getBoundingClientRect(),
      n = e.ownerDocument?.defaultView,
      r = t.left + (n?.scrollX ?? 0),
      i = t.top + (n?.scrollY ?? 0);
    return r + t.width <= 0 || i + t.height <= 0;
  }
  function gn(e) {
    for (let n of f(`input`, e)) {
      if (
        n.type === `hidden` ||
        n.type === `password` ||
        n.readOnly ||
        n.disabled ||
        !b(n) ||
        hn(n)
      )
        continue;
      let e = (n.autocomplete?.toLowerCase() ?? ``).split(/\s+/);
      if (
        n.type === `email` ||
        e.includes(`username`) ||
        e.includes(`email`) ||
        t.test(_(n))
      )
        return !1;
    }
    return !0;
  }
  function _n(e) {
    return e.hasAttribute(`pattern`) || e.hasAttribute(`passwordrules`)
      ? !0
      : e.minLength >= 8;
  }
  function vn(e, t) {
    return e.getAttribute(`aria-describedby`)
      ? !0
      : !!p(`meter, [role="progressbar"], [role="meter"]`, t);
  }
  function yn(e) {
    let t = 0;
    for (let n of f(`input`, e)) n.type !== `hidden` && b(n) && t++;
    return t;
  }
  function bn(e, t = {}) {
    let n = e.ownerDocument,
      r = on(e),
      i = r ?? n,
      a = [];
    if (rn(e)) return { score: 0, veto: !0, signals: [`veto:current`] };
    let o = f(
        `input[type="password"]:not([readonly]):not([disabled])`,
        i,
      ).filter(b),
      s = 0,
      c = (e, t) => {
        ((s += e), a.push(t));
      };
    an(e) && c(D.newPasswordToken, `new-password-token`);
    let l = o.filter((e) => !rn(e)).length >= 2;
    l && c(D.confirmPair, `confirm-pair`);
    let u = !!r && o.some(rn);
    (u && c(D.changeForm, `change-form`),
      pn(i) && c(D.tosLink, `terms-link`),
      mn(i) && c(D.nameField, `name-field`));
    let d = `${location.pathname}${location.search}`;
    Yt.test(d) && c(D.signupUrl, `signup-url`);
    let p = un(i, n);
    (Qt.some((e) => p.includes(e)) && c(D.signupText, `signup-text`),
      r && fn(r) && c(D.setPasswordAction, `set-password-action`),
      qt.test(nn(e)) && c(D.createHint, `create-hint`),
      r && gn(r) && c(D.identifiedAccount, `identified-account`),
      _n(e) && c(D.pwRules, `pw-rules`),
      vn(e, i) && c(D.strengthMeter, `strength-meter`),
      yn(i) > 4 && c(D.largeForm, `large-form`));
    let m = l || u;
    if (!m) {
      Xt.test(d) && c(D.loginUrl, `login-url`);
      let e = dn(i, p);
      en.some((t) => e.includes(t)) && c(D.loginText, `login-text`);
    }
    return (
      t.hasExistingLogins && !m && c(D.returningUser, `returning-user`),
      { score: s, veto: !1, signals: a }
    );
  }
  function xn(e, t = {}) {
    if (e.type !== `password` || e.value) return !1;
    let { score: n, veto: r } = bn(e, t);
    return !r && n >= 100;
  }
  function Sn(e) {
    return !r(e) || e.value ? !1 : En(e);
  }
  function Cn(e) {
    let t = on(e);
    return t
      ? f(`input[type="password"]:not([readonly]):not([disabled])`, t).some(
          (t) => t !== e && b(t) && rn(t),
        )
      : !1;
  }
  function wn(e) {
    if (e.type !== `password` || Cn(e)) return !1;
    let t = on(e);
    if (t && gn(t)) return !1;
    let { score: n, veto: r } = bn(e);
    return !r && n >= 100;
  }
  function Tn(e) {
    let t = 0;
    for (let n of f(`input`, e))
      if (
        n.type !== `hidden` &&
        n.type !== `password` &&
        !(n.readOnly || n.disabled) &&
        b(n) &&
        !hn(n) &&
        r(n) &&
        ++t >= 2
      )
        return !0;
    return !1;
  }
  function En(e) {
    let t = on(e) ?? e.ownerDocument,
      n = f(`input[type="password"]:not([readonly]):not([disabled])`, t).filter(
        b,
      );
    return n.some(rn) ? !1 : n.some(wn) ? !0 : Tn(t);
  }
  var Dn = null,
    On = 0,
    kn = 1500,
    An = null,
    jn = 1e4,
    Mn = 250,
    Nn = null;
  function Pn() {
    Nn !== null && (clearInterval(Nn), (Nn = null));
  }
  function Fn() {
    (Pn(), (Nn = setInterval(() => Kn(), Mn)));
  }
  function In() {
    if (Dn === null || Ze()) return null;
    let e = st();
    if (Ke().length > 0 && !e.password) return null;
    let t = f(`input[type="password"]:not([readonly]):not([disabled])`),
      n = Dn,
      r = e.password;
    if (t.length >= 2) {
      let e = lt();
      if (!e) return null;
      ((n = e.value), (r = e));
    }
    if (n === Ct()) return null;
    let i =
        e.username?.value ?? p(`input[autocomplete~="username"]`)?.value ?? ``,
      a = !!r && wn(r);
    return { username: i, password: n, newLogin: a, field: r };
  }
  function Ln(e) {
    e.password &&
      (E({
        type: `CORNER_PROMPT_CAPTURE`,
        payload: {
          username: e.username,
          password: e.password,
          newLogin: e.newLogin,
        },
      }),
      (Dn = null),
      Rn());
  }
  function Rn() {
    ((An = null), Pn());
  }
  function zn() {
    let e = In();
    e && Ln(e);
  }
  function Bn(e) {
    e instanceof HTMLInputElement &&
      e.type === `password` &&
      ((Dn = e.value), (On = Date.now()), Rn());
  }
  function Vn() {
    zn();
  }
  function Hn(e, t) {
    e === `Enter` &&
      t instanceof HTMLInputElement &&
      t.type === `password` &&
      zn();
  }
  function Un(e) {
    let t = m(
      e,
      `button, input[type="submit"], input[type="image"], input[type="button"]`,
    );
    return !t || (t instanceof HTMLButtonElement && t.type === `reset`)
      ? !1
      : !m(t, `[role="checkbox"], [role="switch"]`);
  }
  function Wn(e) {
    if (Dn === null || !(e instanceof Element) || !Un(e)) return;
    let t = In();
    t?.password &&
      t.field &&
      ((An = { captured: t, field: t.field, at: Date.now() }), Fn());
  }
  function Gn(e) {
    return !e.isConnected || !b(e);
  }
  function Kn() {
    if (An) {
      if (Date.now() - An.at > jn) Rn();
      else if (Gn(An.field) && !Ze()) {
        Ln(An.captured);
        return;
      }
    }
    qn();
  }
  function qn() {
    Dn !== null &&
      Date.now() - On < kn &&
      !p(`input[type="password"]:not([readonly]):not([disabled])`) &&
      zn();
  }
  function Jn(e = document) {
    (e.addEventListener(
      `input`,
      (e) => {
        e.isTrusted && Bn(g(e));
      },
      !0,
    ),
      e.addEventListener(`submit`, () => Vn(), !0),
      e.addEventListener(
        `click`,
        (e) => {
          e.isTrusted && Wn(g(e));
        },
        !0,
      ));
    let t = e.defaultView;
    (t?.addEventListener(`hashchange`, () => Kn()),
      t?.addEventListener(`popstate`, () => Kn()));
  }
  (Vt(Pn), Jn());
  function Yn(e) {
    return String(e ?? ``)
      .replace(/&/g, `&amp;`)
      .replace(/</g, `&lt;`)
      .replace(/>/g, `&gt;`)
      .replace(/"/g, `&quot;`)
      .replace(/'/g, `&#39;`);
  }
  function O(e, ...t) {
    let n = e[0] ?? ``;
    for (let r = 0; r < t.length; r++) {
      let i = t[r];
      ((n += Array.isArray(i) ? i.join(``) : Yn(i)), (n += e[r + 1] ?? ``));
    }
    return n;
  }
  var Xn = `data:image/png;base64,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`,
    Zn = O`
		<style>
			:host {
				display: block;
			}
			.tp-card {
				background: linear-gradient(120deg, rgba(44, 44, 48, 0.9), rgba(14, 14, 16, 0.9));
				-webkit-backdrop-filter: saturate(180%) blur(20px);
				backdrop-filter: saturate(180%) blur(20px);
				border: 1px solid rgba(255, 255, 255, 0.08);
				border-radius: 14px;
				box-shadow:
					0 16px 48px rgba(0, 0, 0, 0.5),
					0 0 0 1px rgba(0, 0, 0, 0.3);
				font-family:
					-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
				font-size: 13px;
				color: #fff;
				text-align: left;
				letter-spacing: normal;
				text-transform: none;
				font-style: normal;
				text-indent: 0;
				margin: 0;
				padding: 20px;
				box-sizing: border-box;
				width: 360px;
			}
			.tp-head {
				display: flex;
				align-items: flex-start;
				justify-content: space-between;
				gap: 12px;
				margin-bottom: 18px;
			}
			.tp-head-main {
				display: flex;
				align-items: center;
				gap: 12px;
				min-width: 0;
			}
			.tp-icon {
				flex-shrink: 0;
				width: 38px;
				height: 38px;
				border-radius: 11px;
				background: rgba(255, 255, 255, 0.08);
				border: 1px solid rgba(255, 255, 255, 0.08);
				display: flex;
				align-items: center;
				justify-content: center;
				color: #fff;
			}
			.tp-glyph {
				width: 22px;
				height: 22px;
				background: currentColor;
				-webkit-mask: url(${[Xn]}) center / contain no-repeat;
				mask: url(${[Xn]}) center / contain no-repeat;
			}
			.tp-choices {
				display: flex;
				flex-direction: column;
				gap: 8px;
				margin-bottom: 4px;
			}
			.tp-choice {
				display: flex;
				align-items: center;
				gap: 12px;
				width: 100%;
				padding: 10px 12px;
				background: rgba(255, 255, 255, 0.04);
				border: 1px solid rgba(255, 255, 255, 0.08);
				border-radius: 10px;
				color: inherit;
				font: inherit;
				text-align: left;
				cursor: pointer;
				transition:
					background 0.1s ease,
					border-color 0.1s ease,
					transform 0.05s ease;
			}
			.tp-choice:hover {
				background: rgba(255, 255, 255, 0.08);
				border-color: rgba(255, 255, 255, 0.2);
			}
			.tp-choice:active {
				transform: scale(0.99);
			}
			.tp-chevron {
				width: 18px;
				height: 18px;
				margin-left: auto;
				flex-shrink: 0;
				color: rgba(235, 235, 245, 0.7);
			}
			.tp-choice:hover .tp-chevron {
				color: rgba(235, 235, 245, 0.75);
			}
			.tp-avatar {
				flex-shrink: 0;
				width: 34px;
				height: 34px;
				border-radius: 50%;
				background: rgba(255, 255, 255, 0.1);
				border: 1px solid rgba(255, 255, 255, 0.1);
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 12px;
				font-weight: 600;
				letter-spacing: 0.3px;
				color: #fff;
			}
			.tp-choice-text {
				display: flex;
				flex-direction: column;
				min-width: 0;
			}
			.tp-choice-primary {
				font-size: 13px;
				font-weight: 500;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
			.tp-choice-sub {
				font-size: 12px;
				color: rgba(235, 235, 245, 0.7);
				margin-top: 1px;
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
			.tp-title {
				font-weight: 600;
				font-size: 16px;
				line-height: 1.3;
			}
			.tp-host {
				color: rgba(235, 235, 245, 0.7);
				font-size: 12px;
				margin-top: 4px;
			}
			.tp-note {
				color: rgba(235, 235, 245, 0.75);
				font-size: 13px;
				line-height: 1.45;
				margin: 2px 0 6px;
			}
			.tp-close {
				background: transparent;
				border: 0;
				color: rgba(235, 235, 245, 0.7);
				cursor: pointer;
				font-size: 18px;
				line-height: 1;
				padding: 2px 6px;
				border-radius: 6px;
			}
			.tp-close:hover {
				background: rgba(255, 255, 255, 0.06);
				color: #fff;
			}
			.tp-row {
				display: flex;
				flex-direction: column;
				gap: 7px;
				margin-bottom: 14px;
			}
			.tp-label {
				font-size: 11px;
				color: rgba(235, 235, 245, 0.7);
				text-transform: uppercase;
				letter-spacing: 0.5px;
				font-weight: 500;
			}
			input.tp-input {
				background: rgba(255, 255, 255, 0.06);
				border: 1px solid rgba(255, 255, 255, 0.1);
				border-radius: 8px;
				color: #fff;
				padding: 10px 12px;
				font: inherit;
				font-size: 13px;
				outline: none;
				width: 100%;
				box-sizing: border-box;
			}
			input.tp-input:focus {
				border-color: rgba(255, 255, 255, 0.7);
			}
			iframe.tp-field {
				display: block;
				width: 100%;
				border: 0;
				margin: 0;
				padding: 0;
				background: transparent;
				color-scheme: light dark;
			}
			iframe.tp-field[hidden] {
				display: none;
			}
			.tp-password-wrap {
				position: relative;
			}
			.tp-password-toggle {
				position: absolute;
				right: 6px;
				top: 50%;
				transform: translateY(-50%);
				background: transparent;
				border: 0;
				color: rgba(235, 235, 245, 0.7);
				cursor: pointer;
				font-size: 11px;
				padding: 6px 8px;
				border-radius: 6px;
			}
			.tp-password-toggle:hover {
				background: rgba(255, 255, 255, 0.08);
				color: #fff;
			}
			.tp-candidates {
				display: flex;
				flex-direction: column;
				gap: 8px;
				margin-bottom: 16px;
			}
			.tp-candidate {
				display: flex;
				align-items: center;
				gap: 12px;
				padding: 12px 14px;
				background: rgba(255, 255, 255, 0.04);
				border: 1px solid rgba(255, 255, 255, 0.08);
				border-radius: 10px;
				cursor: pointer;
			}
			.tp-candidate:hover {
				background: rgba(255, 255, 255, 0.08);
			}
			.tp-candidate input[type="radio"] {
				accent-color: #fff;
			}
			.tp-candidate .tp-cand-name {
				font-weight: 600;
				font-size: 13px;
			}
			.tp-candidate .tp-cand-user {
				color: rgba(235, 235, 245, 0.7);
				font-size: 12px;
				margin-top: 2px;
			}
			.tp-actions {
				display: flex;
				gap: 10px;
				align-items: center;
				margin-top: 18px;
				position: relative;
			}
			button.tp-btn {
				background: transparent;
				color: #fff;
				border: 1px solid rgba(255, 255, 255, 0.14);
				border-radius: 8px;
				padding: 10px 16px;
				font: inherit;
				font-size: 13px;
				font-weight: 500;
				cursor: pointer;
				transition:
					background 0.1s ease,
					border-color 0.1s ease;
			}
			.tp-btn:hover {
				background: rgba(255, 255, 255, 0.06);
				border-color: rgba(255, 255, 255, 0.24);
			}
			button.tp-btn-primary {
				background: #fafafa;
				color: #18181b;
				border: 1px solid rgba(255, 255, 255, 0.2);
			}
			button.tp-btn-primary:hover {
				background: #e4e4e7;
				border-color: rgba(255, 255, 255, 0.3);
			}
			.tp-overflow {
				margin-left: auto;
				background: transparent;
				border: 1px solid transparent;
				color: rgba(235, 235, 245, 0.7);
				cursor: pointer;
				font-size: 18px;
				padding: 6px 10px;
				border-radius: 8px;
				line-height: 1;
			}
			.tp-overflow:hover {
				background: rgba(255, 255, 255, 0.06);
				border-color: rgba(255, 255, 255, 0.14);
				color: #fff;
			}
			.tp-menu {
				position: absolute;
				right: 0;
				bottom: 52px;
				background: rgba(40, 40, 44, 0.98);
				border: 1px solid rgba(255, 255, 255, 0.1);
				border-radius: 10px;
				padding: 6px;
				box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
				z-index: 1;
				min-width: 160px;
			}
			.tp-menu button {
				background: transparent;
				color: #fff;
				border: 0;
				padding: 9px 12px;
				font: inherit;
				font-size: 13px;
				cursor: pointer;
				border-radius: 6px;
				width: 100%;
				text-align: left;
			}
			.tp-menu button:hover {
				background: rgba(255, 255, 255, 0.08);
			}
		</style>
	`;
  function k(e) {
    return T.i18n.getMessage(e);
  }
  function Qn({
    hostname: e,
    username: t,
    password: n,
    primaryAction: r,
    primaryLabel: i,
  }) {
    return O`
		<div class="tp-head">
			<div>
				<div class="tp-title">${k(`saveNewLogin`)}</div>
				<div class="tp-host">${e}</div>
			</div>
			<button class="tp-close" data-tp-action="dismiss" aria-label="Dismiss">×</button>
		</div>
		<div class="tp-row">
			<div class="tp-label">${k(`fieldUsername`)}</div>
			<input class="tp-input" id="tp-username" type="text" value="${t}" autocomplete="off" readonly />
		</div>
		<div class="tp-row">
			<div class="tp-label">${k(`fieldPassword`)}</div>
			<div class="tp-password-wrap">
				<input class="tp-input" id="tp-password" type="password" value="${n}" autocomplete="off" readonly />
				<button class="tp-password-toggle" data-tp-action="toggle-password">${k(`toggleShow`)}</button>
			</div>
		</div>
		<div class="tp-actions">
			<button class="tp-btn tp-btn-primary" data-tp-action="${r}">${i}</button>
			<button class="tp-btn" data-tp-action="dismiss">${k(`notNow`)}</button>
			<button class="tp-overflow" data-tp-action="toggle-menu" aria-label="More">⋯</button>
		</div>
	`;
  }
  var $n = `<svg class="tp-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;
  function er(e) {
    let t = e
      .trim()
      .split(/[\s._@+-]+/)
      .filter(Boolean);
    return (
      (t.length >= 2
        ? (t[0]?.[0] ?? ``) + (t[1]?.[0] ?? ``)
        : (t[0] ?? e).slice(0, 2)
      ).toUpperCase() || `?`
    );
  }
  function tr(e, t, n) {
    return O`<button type="button" class="tp-choice" data-tp-action="passkey-pick" data-tp-value="${e}">
		<span class="tp-avatar">${er(t)}</span>
		<span class="tp-choice-text">
			<span class="tp-choice-primary">${t}</span>
			${n ? [O`<span class="tp-choice-sub">${n}</span>`] : []}
		</span>
		${[$n]}
	</button>`;
  }
  function nr({
    rpId: e,
    rpName: t,
    userName: n,
    intent: r,
    existingLoginName: i,
    candidates: a,
    passkeyChoices: o,
    primaryLabel: s,
    locked: c,
    requester: l,
    pageHost: u,
  }) {
    let d = t && t !== e ? `${t} (${e})` : e,
      f = r === `create` && !!a && a.length > 0,
      p = r === `get` && !!o && o.length > 0,
      m = p || f,
      h = p
        ? o.length > 1
          ? k(`passkeySignInWhich`)
          : k(`passkeyUseTitle`)
        : k(
            f
              ? `passkeyAddToTitle`
              : r === `get`
                ? `passkeyUseTitle`
                : i
                  ? `passkeyAddTitle`
                  : `passkeySaveTitle`,
          ),
      g = [];
    if (c)
      g = [
        O`<div class="tp-note">${k(r === `get` ? `passkeyUnlockUseNote` : `passkeyUnlockSaveNote`)}</div>`,
      ];
    else if (p)
      g = [
        O`<div class="tp-choices">${o.map((e) => tr(e.credentialId, e.label, void 0))}</div>`,
      ];
    else if (f) {
      let e = (a ?? []).map((e) => tr(e.id, e.name, e.username || void 0));
      (e.push(tr(`new`, k(`passkeyCreateNewLogin`), void 0)),
        (g = [O`<div class="tp-choices">${e}</div>`]));
    } else {
      let e = [];
      (i &&
        e.push(
          O`<div class="tp-row"><div class="tp-label">${k(`passkeyAddsTo`)}</div><div>${i}</div></div>`,
        ),
        n &&
          e.push(
            O`<div class="tp-row"><div class="tp-label">${k(`fieldAccount`)}</div><div>${n}</div></div>`,
          ),
        (g = e));
    }
    let ee =
        l && l !== u
          ? [
              O`<div class="tp-row"><div class="tp-label">${k(`passkeyRequestedBy`)}</div><div>${l}</div></div>`,
            ]
          : [],
      te = m
        ? []
        : [
            O`<div class="tp-actions">
			<button class="tp-btn tp-btn-primary" data-tp-action="passkey-approve">${s}</button>
			<button class="tp-btn" data-tp-action="passkey-dismiss">${k(`notNow`)}</button>
		</div>`,
          ];
    return O`
		<div class="tp-head">
			<div class="tp-head-main">
				<div class="tp-icon"><span class="tp-glyph"></span></div>
				<div>
					<div class="tp-title">${h}</div>
					<div class="tp-host">${d}</div>
				</div>
			</div>
			<button class="tp-close" data-tp-action="passkey-dismiss" aria-label="Dismiss">×</button>
		</div>
		${ee}
		${g}
		${te}
	`;
  }
  function rr({
    title: e,
    hostname: t,
    primaryAction: n,
    primaryLabel: r,
    candidates: i,
  }) {
    let a = O`
		<div class="tp-row">
			<div class="tp-label">${k(`fieldAccount`)}</div>
			<div>${i[0]?.name ?? ``} <span style="color: rgba(235,235,245,0.55)">(${i[0]?.username ?? ``})</span></div>
			<input type="hidden" name="tp-update-target" value="${i[0]?.id ?? ``}" />
		</div>
	`;
    return (
      i.length > 1 &&
        (a = O`
			<div class="tp-candidates">
				${i.map(
          (e, t) => O`
						<label class="tp-candidate">
							<input type="radio" name="tp-update-target" value="${e.id}" ${t === 0 ? `checked` : ``} />
							<div>
								<div class="tp-cand-name">${e.name}</div>
								<div class="tp-cand-user">${e.username}</div>
							</div>
						</label>
					`,
        )}
			</div>
		`),
      O`
		<div class="tp-head">
			<div>
				<div class="tp-title">${e}</div>
				<div class="tp-host">${t}</div>
			</div>
			<button class="tp-close" data-tp-action="dismiss" aria-label="Dismiss">×</button>
		</div>
		${[a]}
		<div class="tp-actions">
			<button class="tp-btn tp-btn-primary" data-tp-action="${n}">${r}</button>
			<button class="tp-btn" data-tp-action="save-new" title="${k(`saveAsNewHint`)}">${k(`saveAsNew`)}</button>
			<button class="tp-overflow" data-tp-action="toggle-menu" aria-label="More">⋯</button>
		</div>
	`
    );
  }
  function ir(e) {
    let t = 1;
    for (let n of e.matchAll(/opacity\(\s*([\d.]+)(%?)\s*\)/g))
      t *= Number(n[1]) / (n[2] ? 100 : 1);
    return t;
  }
  function ar(e) {
    let t = 1;
    for (let n = e; n; n = n.parentElement) {
      let e = getComputedStyle(n),
        r = Number.parseFloat(e.opacity);
      t *= (Number.isNaN(r) ? 1 : r) * ir(e.filter ?? ``);
    }
    return t;
  }
  function or(e) {
    let t = e.getBoundingClientRect();
    if (
      t.width < 60 ||
      t.height < 20 ||
      t.bottom <= 0 ||
      t.right <= 0 ||
      t.top >= window.innerHeight ||
      t.left >= window.innerWidth
    )
      return !1;
    let n = getComputedStyle(e);
    if (
      n.visibility !== `visible` ||
      n.display === `none` ||
      ar(e) < 0.9 ||
      n.filter !== `none` ||
      n.mixBlendMode !== `normal` ||
      n.clipPath !== `none`
    )
      return !1;
    let r = document.elementFromPoint(
      t.left + t.width / 2,
      t.top + t.height / 2,
    );
    return r ? r === e || e.contains(r) || r.contains(e) : !1;
  }
  var sr = `bramble-corner-prompt`,
    cr = () => window.top === window.self,
    lr = null,
    A = null,
    j = null,
    ur = 0,
    dr = T.runtime.getURL(`corner-field.html`),
    fr = 1e3,
    pr = null,
    mr = 0,
    hr = null,
    gr = !1,
    _r = new Set([`passkey-approve`, `passkey-pick`]);
  function vr() {
    return !lr || !or(lr) ? !1 : Date.now() - ur >= 500;
  }
  function M() {
    ((lr &&= (lr.remove(), null)),
      (A = null),
      (j = null),
      (pr = null),
      (gr = !1),
      hr?.done());
  }
  function yr() {
    if (cr() && Ut())
      try {
        T.runtime
          .sendMessage({ type: `CORNER_PROMPT_QUERY` })
          .then((e) => {
            e?.ok && e.data && Ar(e.data);
          })
          .catch(() => {});
      } catch {
        Wt();
      }
  }
  function br(e) {
    let t = k(e.locked ? `actionUnlockAndSave` : `actionSave`),
      n = e.locked ? `save-unlock-first` : `save`,
      { username: r, password: i, hostname: a } = e;
    return Qn({
      username: r,
      password: i,
      hostname: a,
      primaryAction: n,
      primaryLabel: t,
    });
  }
  function xr(e) {
    let t = k(e.locked ? `actionUnlockAndUpdate` : `actionUpdate`),
      n = e.locked ? `save-unlock-first` : `update`;
    return rr({
      title: k(
        e.candidates.length > 1 ? `updateExistingTitle` : `updateSavedTitle`,
      ),
      hostname: e.hostname,
      primaryAction: n,
      primaryLabel: t,
      candidates: e.candidates,
    });
  }
  function Sr(e, t) {
    j &&
      E({
        type: `CORNER_PROMPT_RESPONSE`,
        payload: { promptId: j.promptId, action: e, ...t },
      });
  }
  function Cr(e, t) {
    if (!j) return;
    let n = t;
    (e &&
      n === void 0 &&
      (n = A?.querySelector(`input[name="tp-passkey-target"]:checked`)?.value),
      E({
        type: `PASSKEY_PROMPT_RESPONSE`,
        payload: {
          promptId: j.promptId,
          approved: e,
          ...(n ? { choice: n } : {}),
        },
      }));
  }
  function wr() {
    A?.querySelector(`.tp-menu`)?.remove();
  }
  function Tr(e) {
    let t = e.querySelector(`#tp-username`);
    if (!t) return;
    let n = Array.from(crypto.getRandomValues(new Uint8Array(16)), (e) =>
        e.toString(16).padStart(2, `0`),
      ).join(``),
      r = document.createElement(`iframe`);
    ((r.className = `tp-field`),
      (r.title = k(`fieldUsername`)),
      r.setAttribute(`scrolling`, `no`),
      (r.hidden = !0),
      (r.src = `${dr}?id=${n}`),
      t.after(r),
      (pr = { id: n, frame: r, box: t, value: null }));
  }
  function Er(e) {
    let t = e,
      n = pr;
    return !n || j?.kind !== `save-login` || t?.id !== n.id
      ? { ok: !1 }
      : t.op === `open`
        ? { ok: !0, data: { value: n.value ?? j.username } }
        : t.op !== `value` || typeof t.value != `string`
          ? { ok: !1 }
          : (n.value === null &&
              ((n.frame.style.height = `${n.box.offsetHeight || 38}px`),
              (n.frame.hidden = !1),
              (n.box.hidden = !0)),
            (n.value = t.value),
            hr && t.flush === hr.n && hr.done(),
            { ok: !0 });
  }
  function Dr() {
    let e = pr && pr.value !== null ? pr.frame.contentWindow : null;
    return e
      ? new Promise((t) => {
          let n = ++mr,
            r = setTimeout(i, fr);
          function i() {
            (clearTimeout(r), hr?.n === n && (hr = null), t());
          }
          ((hr = { n, done: i }),
            e.postMessage({ type: `CORNER_FIELD_FLUSH`, n }, `*`));
        })
      : Promise.resolve();
  }
  async function Or(e, t = {}) {
    let n = j;
    if (((gr = !0), await Dr(), !n || j !== n)) return;
    let r = pr?.value ?? void 0;
    (Sr(e, { ...t, ...(r === void 0 ? {} : { editedUsername: r }) }), M());
  }
  function kr(e) {
    if (gr) return;
    let t = e.target;
    if (!(t instanceof HTMLElement)) return;
    let n = t.closest(`[data-tp-action]`);
    if (
      (n?.dataset.tpAction !== `toggle-menu` && (t.closest(`.tp-menu`) || wr()),
      !n || !A?.contains(n))
    )
      return;
    let r = n.dataset.tpAction;
    if (r && j && (!_r.has(r) || vr())) {
      if (r === `toggle-password`) {
        let e = A.querySelector(`#tp-password`);
        if (!e) return;
        ((e.type = e.type === `password` ? `text` : `password`),
          (n.textContent = k(
            e.type === `password` ? `toggleShow` : `toggleHide`,
          )));
      } else if (r === `toggle-menu`) {
        let e = A.querySelector(`.tp-menu`);
        if (e) {
          e.remove();
          return;
        }
        let t = document.createElement(`div`);
        ((t.className = `tp-menu`),
          (t.innerHTML = O`<button data-tp-action="never">${k(`menuNeverForSite`)}</button>`),
          (A.querySelector(`.tp-actions`) ?? A).appendChild(t));
      } else if (r === `save`) Or(`save`);
      else if (r === `save-new`) (Sr(`save-new`), M());
      else if (r === `update`) {
        let e = (
          A.querySelector(`input[name="tp-update-target"]:checked`) ??
          A.querySelector(`input[name="tp-update-target"]`)
        )?.value;
        if (!e) return;
        (Sr(`update`, { chosenEntryId: e }), M());
      } else if (r === `save-unlock-first`) {
        let e = A.querySelector(`input[name="tp-update-target"]:checked`);
        Or(`save-unlock-first`, e ? { chosenEntryId: e.value } : {});
      } else
        r === `passkey-pick`
          ? (Cr(!0, n.dataset.tpValue), M())
          : r === `passkey-approve`
            ? (Cr(!0), M())
            : r === `passkey-dismiss`
              ? (Cr(!1), M())
              : r === `dismiss`
                ? (Sr(`dismiss`), M())
                : r === `never` && (Sr(`never`), M());
    }
  }
  function Ar(e) {
    if (!cr()) return;
    (M(), (j = e));
    let t = document.createElement(`div`);
    ((t.id = sr),
      (t.style.cssText = `position: fixed; top: 16px; right: 16px; z-index: 2147483647;`));
    let n = t.attachShadow({ mode: `closed` }),
      r;
    if (e.kind === `save-login`) r = br(e);
    else if (e.kind === `update-login`) r = xr(e);
    else {
      let t;
      ((t =
        e.intent === `get`
          ? k(e.locked ? `passkeyUnlockUse` : `passkeyUse`)
          : e.existingLoginName
            ? k(e.locked ? `passkeyUnlockAdd` : `passkeyAdd`)
            : k(e.locked ? `actionUnlockAndSave` : `passkeySave`)),
        (r = nr({
          rpId: e.rpId,
          rpName: e.rpName,
          userName: e.userName,
          intent: e.intent,
          existingLoginName: e.existingLoginName,
          candidates: e.candidates,
          passkeyChoices: e.passkeyChoices,
          primaryLabel: t,
          locked: e.locked,
          requester: e.requester,
          pageHost: location.hostname,
        })));
    }
    ((n.innerHTML = `${Zn}<div class="tp-card">${r}</div>`),
      n.addEventListener(`click`, kr, !0),
      e.kind === `save-login` && Tr(n),
      (lr = t),
      (A = n),
      (ur = Date.now()),
      document.body.appendChild(t));
  }
  (document.addEventListener(
    `mousedown`,
    (e) => {
      if (!lr) return;
      let t = e.target;
      t instanceof Node && (lr.contains(t) || wr());
    },
    !0,
  ),
    Vt(M));
  var jr = `tp-relay-anchor`,
    Mr = `tp-relay-close`,
    Nr = `tp-relay-dismiss`,
    Pr = 1e6;
  function Fr(e) {
    return typeof e == `number` && Number.isFinite(e);
  }
  function Ir(e) {
    if (!e || typeof e != `object`) return !1;
    let t = e;
    return !Fr(t.x) ||
      !Fr(t.y) ||
      !Fr(t.width) ||
      !Fr(t.height) ||
      t.width < 0 ||
      t.height < 0
      ? !1
      : [t.x, t.y, t.width, t.height].every((e) => Math.abs(e) <= Pr);
  }
  function Lr(e) {
    return typeof e == `string` && e.length > 0 && e.length <= 64;
  }
  function Rr(e) {
    if (!e || typeof e != `object`) return null;
    let t = e;
    return t.__tp !== jr || !Lr(t.relayId) || !Ir(t.rect)
      ? null
      : { __tp: jr, relayId: t.relayId, rect: t.rect };
  }
  function zr(e) {
    if (!e || typeof e != `object`) return null;
    let t = e;
    return t.__tp !== Mr || !Lr(t.relayId)
      ? null
      : { __tp: Mr, relayId: t.relayId };
  }
  function N(e) {
    let t = Number.parseFloat(e ?? ``);
    return Number.isFinite(t) ? t : 0;
  }
  function Br(e, t) {
    if (!t) return null;
    for (let n of f(`iframe, frame`, e)) if (n.contentWindow === t) return n;
    return null;
  }
  function Vr(e, t, n) {
    let r = t.getBoundingClientRect(),
      i = n.getComputedStyle?.(t),
      a = r.left + N(i?.borderLeftWidth) + N(i?.paddingLeft),
      o = r.top + N(i?.borderTopWidth) + N(i?.paddingTop),
      s = r.right - N(i?.borderRightWidth) - N(i?.paddingRight),
      c = r.bottom - N(i?.borderBottomWidth) - N(i?.paddingBottom),
      l = Math.max(e.x + a, a),
      u = Math.max(e.y + o, o),
      d = Math.min(e.x + a + e.width, s) - l,
      f = Math.min(e.y + o + e.height, c) - u;
    return d < 1 || f < 1 ? null : { x: l, y: u, width: d, height: f };
  }
  function Hr(e) {
    let { window: t, document: n } = e,
      r = null,
      i = null,
      a = null,
      o = new Map(),
      s = () => t.parent === t,
      c = (e) => {
        s() || t.parent.postMessage(e, `*`);
      },
      l = () => {
        for (let e = 0; e < t.frames.length; e++)
          try {
            t.frames[e]?.postMessage({ __tp: Nr }, `*`);
          } catch {}
      },
      u = (e) => {
        if (e.data?.__tp === Nr) {
          if (s() || e.source !== t.parent) return;
          (a?.(), l());
          return;
        }
        let u = Rr(e.data),
          d = u ? null : zr(e.data);
        if (!u && !d) return;
        let f = Br(n, e.source);
        if (!f) return;
        let p = (u ?? d).relayId,
          m = o.get(p);
        if (m && m !== f) return;
        if (d) {
          (o.delete(p), s() ? i?.(p) : c(d));
          return;
        }
        if (!u) return;
        let h = Vr(u.rect, f, t);
        if (h) {
          if (!m) {
            for (let [e, t] of o) t.isConnected || o.delete(e);
            o.set(p, f);
          }
          s()
            ? r?.({ relayId: u.relayId, rect: h })
            : c({ __tp: jr, relayId: u.relayId, rect: h });
        }
      };
    return (
      t.addEventListener(`message`, u),
      {
        isTop: s,
        needsRelay(e) {
          return !s() && t.innerHeight - (e.y + e.height) < 160;
        },
        open(e, t) {
          c({ __tp: jr, relayId: e, rect: t });
        },
        close(e) {
          c({ __tp: Mr, relayId: e });
        },
        onAnchor(e) {
          r = e;
        },
        onClose(e) {
          i = e;
        },
        dismissDescendants: l,
        onDismiss(e) {
          a = e;
        },
        dispose() {
          (t.removeEventListener(`message`, u),
            (r = null),
            (i = null),
            (a = null));
        },
      }
    );
  }
  var Ur = `abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=[]{}|;:,.<>?`,
    Wr = 20;
  function Gr() {
    let e = [],
      t = new Uint8Array(Wr);
    for (; e.length < Wr;) {
      crypto.getRandomValues(t);
      for (let n = 0; n < t.length && e.length < Wr; n++) {
        let r = t[n];
        r < 176 && e.push(Ur.charAt(r % 88));
      }
    }
    return e.join(``);
  }
  var Kr = null;
  function qr(e) {
    typeof e == `string` && e && (Kr = e);
  }
  function Jr() {
    let e = Kr;
    return ((Kr = null), e && Xr(), e ?? Gr());
  }
  async function Yr() {
    return (await Zr()) ?? Gr();
  }
  async function Xr() {
    qr(await Zr());
  }
  async function Zr() {
    let e = await Gt({ type: `GENERATE_PASSWORD` });
    if (!e?.ok) return;
    let t = e.data?.password;
    return typeof t == `string` && t ? t : void 0;
  }
  var P = null;
  function Qr(e) {
    let t = e.parentNode;
    if (!t) return { x: window.scrollX, y: window.scrollY };
    (P ||
      ((P = document.createElement(`div`)),
      (P.style.cssText = `position: absolute; top: 0; left: 0; width: 0; height: 0; margin: 0; padding: 0; border: 0; visibility: hidden; pointer-events: none;`)),
      P.parentNode !== t && t.insertBefore(P, e));
    let n = P.getBoundingClientRect();
    return { x: -n.left, y: -n.top };
  }
  Vt(() => {
    (P?.remove(), (P = null));
  });
  function $r(e) {
    return e.state === `busy`
      ? O`
		<div class="tp-item tp-alias tp-alias-busy">
			<div class="tp-avatar tp-avatar-alias">
				<svg class="tp-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
			</div>
			<div class="tp-text">
				<span class="tp-name">${k(`aliasTitle`)}</span>
				<span class="tp-user">${k(`aliasWorking`)}</span>
			</div>
		</div>
	`
      : e.state === `error`
        ? O`
		<div class="tp-item tp-alias tp-alias-error" data-tp-alias="1" role="option">
			<div class="tp-avatar tp-avatar-alias">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg>
			</div>
			<div class="tp-text">
				<span class="tp-name">${k(`aliasFailed`)}</span>
				<span class="tp-user">${e.message ?? k(`aliasRetry`)}</span>
			</div>
		</div>
	`
        : O`
		<div class="tp-item tp-alias" data-tp-alias="1" role="option">
			<div class="tp-avatar tp-avatar-alias">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"></path></svg>
			</div>
			<div class="tp-text">
				<span class="tp-name">${k(`aliasTitle`)}</span>
				<span class="tp-user">${k(`aliasUse`)}</span>
			</div>
		</div>
	`;
  }
  function ei(e) {
    let t = e.trim();
    if (!t) return `??`;
    let n = t.split(/\s+/);
    return n.length >= 2 && n[0] && n[1]
      ? (n[0][0] + n[1][0]).toUpperCase()
      : t.slice(0, 2).toUpperCase();
  }
  var ti = [
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
  function ni(e) {
    let t = 0;
    for (let n = 0; n < e.length; n++) t = (t * 31 + e.charCodeAt(n)) >>> 0;
    return ti[t % ti.length];
  }
  function ri({ id: e, name: t, secondary: n, carried: r }) {
    let i = r ? O`<span class="tp-badge">${k(`cardUsedHere`)}</span>` : ``;
    return O`
    <div class="tp-item" data-entry-id="${e}">
  		<div class="tp-avatar" style="background: ${ni(t)};">
        ${ei(t)}
  		</div>
  		<div class="tp-text">
        <span class="tp-name">${t}</span>
        <span class="tp-user">${n}</span>
  		</div>
      ${[i]}
   	</div>
  `;
  }
  var ii = () => O`
		<div class="tp-item tp-locked" data-tp-popout="1">
			<div class="tp-avatar tp-avatar-locked">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="10.5" width="16" height="10" rx="2.4"></rect><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"></path></svg>
			</div>
			<div class="tp-text">
				<span class="tp-name">${k(`vaultLocked`)}</span>
				<span class="tp-user">${k(`vaultLockedUnlockHint`)}</span>
			</div>
			<span class="tp-launch">
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6"></path><path d="M20 4l-8.5 8.5"></path><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"></path></svg>
			</span>
		</div>
	`,
    ai = () => O`
		<button type="button" class="tp-new-login" data-tp-new-login="1">
			<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>
			${k(`newLoginTitle`)}
		</button>
	`,
    oi = O`
		<style>
			:host {
				display: block;
				color-scheme: light dark;
				--tp-surface: #ffffff; /* --popover */
				--tp-foreground: oklch(20.5% 0 0); /* --popover-foreground */
				--tp-muted: oklch(52% 0 0); /* --muted-foreground */
				--tp-border: oklch(87% 0 0); /* --border */
				--tp-primary: oklch(20.5% 0 0); /* --primary */
				--tp-on-primary: #ffffff; /* --primary-foreground */
			}
			@media (prefers-color-scheme: dark) {
				:host {
					--tp-surface: oklch(26.9% 0 0);
					--tp-foreground: oklch(97% 0 0);
					--tp-muted: oklch(70.8% 0 0);
					--tp-border: oklch(37.1% 0 0);
					--tp-primary: oklch(97% 0 0);
					--tp-on-primary: oklch(20.5% 0 0);
				}
			}
			.tp-dropdown {
				background: var(--tp-surface);
				border: 1px solid var(--tp-border);
				border-radius: 16px;
				box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(0, 0, 0, 0.15);
				font-family:
					-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
				font-size: 13px;
				color: var(--tp-foreground);
				text-align: left;
				letter-spacing: normal;
				text-transform: none;
				font-style: normal;
				text-indent: 0;
				max-height: 360px;
				overflow-y: auto;
				margin: 0;
				padding: 6px;
				box-sizing: border-box;
			}
			.tp-item {
				padding: 10px 12px;
				cursor: pointer !important;
				display: flex;
				align-items: center;
				gap: 12px;
				border-radius: 12px;
				transition: background 0.12s ease;
			}
			.tp-item:hover {
				background: color-mix(in oklab, var(--tp-foreground) 8%, transparent);
			}
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
			.tp-avatar-locked svg {
				width: 20px;
				height: 20px;
			}
			.tp-text {
				display: flex;
				flex-direction: column;
				min-width: 0;
				flex: 1;
			}
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
			.tp-item:hover .tp-launch {
				color: var(--tp-foreground);
			}
			.tp-new-login {
				display: flex;
				align-items: center;
				gap: 6px;
				width: 100%;
				padding: 6px 12px;
				border: 0;
				border-top: 1px solid var(--tp-border);
				background: none;
				color: var(--tp-muted);
				font: inherit;
				font-size: 12px;
				text-align: left;
				cursor: pointer;
			}
			.tp-new-login:hover {
				color: var(--tp-foreground);
			}
			.tp-avatar-suggest {
				background: var(--tp-primary);
				color: var(--tp-on-primary);
			}
			.tp-avatar-suggest svg {
				width: 20px;
				height: 20px;
			}
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
				cursor: pointer !important;
				transition: background 0.12s ease, color 0.12s ease;
			}
			.tp-regenerate:hover {
				background: color-mix(in oklab, var(--tp-foreground) 12%, transparent);
				color: var(--tp-foreground);
			}
		</style>
	`,
    si = (e) => O`
		<div class="tp-item tp-suggest" data-tp-suggest="1" role="option">
			<div class="tp-avatar tp-avatar-suggest">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="15.5" r="4.5"></circle><path d="M10.7 12.3 20 3"></path><path d="m16 6 3 3"></path><path d="m14 8 3 3"></path></svg>
			</div>
			<div class="tp-text">
				<span class="tp-name tp-suggest-pw">${e}</span>
				<span class="tp-user">${k(`suggestPasswordUse`)}</span>
			</div>
			<button class="tp-regenerate" data-tp-regenerate="1" type="button" aria-label="${k(`suggestPasswordRegenerate`)}">
				<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M21 3v5h-5"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path><path d="M3 21v-5h5"></path></svg>
			</button>
		</div>
	`,
    ci = null,
    li = null,
    ui = null,
    di = null,
    fi = null,
    pi = null,
    mi = null;
  function hi(e, t) {
    let n = t?.alias,
      r = n
        ? `a:${n.state}:${n.state === `error` ? (n.message ?? ``) : ``}\0`
        : ``,
      i = t?.carriedId ? `c:${t.carriedId}\0` : ``,
      a = t?.newLogin ? `n\0` : ``;
    return r + i + a + (t?.suggest ? `s:${t.suggest.password}\0` : ``) + wi(e);
  }
  var F = null,
    gi = null,
    _i = null,
    vi = /\bone-time-code\b|\bcc-[a-z]+(-[a-z]+)*\b/i;
  function yi(e) {
    if (
      ((F = e),
      (xi = NaN),
      (Si = !1),
      gi &&
        gi !== e &&
        (_i === null
          ? gi.removeAttribute(`autocomplete`)
          : gi.setAttribute(`autocomplete`, _i),
        (gi = null),
        (_i = null)),
      e && e !== gi)
    ) {
      let t = e.getAttribute(`autocomplete`);
      if (t && vi.test(t)) return;
      ((gi = e), (_i = t), e.setAttribute(`autocomplete`, `off`));
    }
  }
  var bi = 150,
    xi = NaN,
    Si = !1;
  function Ci(e, t) {
    let n = t.left + t.width / 2,
      r = t.top + t.height / 2;
    if (n < 0 || r < 0 || n >= window.innerWidth || r >= window.innerHeight)
      return !0;
    let i = e.getRootNode();
    if (typeof i.elementFromPoint != `function`) return !0;
    let a = i.elementFromPoint(n, r);
    return a ? a === e || e.contains(a) : !1;
  }
  function wi(e) {
    let t = ``;
    for (let n of e) t += `${n.id}\0`;
    return t;
  }
  function Ti(e) {
    if (!F) return !1;
    if (e === F || F.contains(e)) return !0;
    if (e instanceof Element) {
      let t = e.closest(`label`);
      if (t && ((F.id && t.htmlFor === F.id) || t.contains(F))) return !0;
    }
    return !1;
  }
  function Ei(e) {
    return Math.min(Math.max(e, 300), 440);
  }
  function Di(e, t) {
    let n = t.getBoundingClientRect(),
      r = Qr(e),
      i = n.left + r.x,
      a = n.bottom + r.y + 2,
      o = `${Ei(n.width)}px`,
      s = `translate3d(${i}px, ${a}px, 0)`;
    (e.style.transform !== s || e.style.width !== o) &&
      ((e.style.transform = s), (e.style.width = o), ki());
  }
  var Oi = -1 / 0;
  function ki() {
    Oi = performance.now();
  }
  function Ai() {
    return performance.now() - Oi < 500;
  }
  var ji = null,
    Mi = NaN,
    Ni = NaN,
    Pi = NaN,
    Fi = null,
    Ii = !1,
    Li = 0,
    Ri = 120;
  function zi() {
    if (ji !== null) return;
    ((Mi = NaN), (Fi = null), (Ii = !1));
    let e = (t) => {
      let n = ha();
      if (!n || !F) {
        ji = null;
        return;
      }
      let r = F.getBoundingClientRect();
      if (
        ((Number.isNaN(xi) || t - xi >= bi) && ((xi = t), (Si = !Ci(F, r))),
        !Xe(F, r) || Si)
      ) {
        (Bi(), _a());
        return;
      }
      let i = Qr(n),
        a = r.left + i.x,
        o = r.bottom + i.y + 2,
        s = Ei(r.width),
        c = Number.isNaN(Mi) || F !== Fi,
        l = !c && (a !== Mi || o !== Ni || s !== Pi);
      ((c || l) &&
        ((n.style.transform = `translate3d(${a}px, ${o}px, 0)`),
        (n.style.width = `${s}px`),
        ki()),
        (Mi = a),
        (Ni = o),
        (Pi = s),
        (Fi = F),
        l
          ? ((Li = t), (Ii ||= ((n.style.visibility = `hidden`), !0)))
          : Ii &&
            (c || t - Li >= Ri) &&
            ((n.style.visibility = ``), (Ii = !1), ki()),
        (ji = requestAnimationFrame(e)));
    };
    ji = requestAnimationFrame(e);
  }
  function Bi() {
    (ji !== null && (cancelAnimationFrame(ji), (ji = null)), (Ii = !1));
  }
  var Vi = `bramble-autofill-dropdown`,
    I = null,
    Hi = ``,
    Ui = null;
  function Wi() {
    ((I &&= (I.remove(), null)), yi(null), (Hi = ``), (Ui = null));
  }
  function Gi(e) {
    I && Di(I, e);
  }
  function Ki(e, t) {
    (Wi(), yi(e));
    let n = document.createElement(`div`);
    ((n.id = Vi),
      (n.style.cssText = `position: absolute; top: 0; left: 0; z-index: 2147483647;`));
    let r = n.attachShadow({ mode: `closed` });
    return (
      (r.innerHTML = `${oi}<div class="tp-dropdown">${t}</div>`),
      (I = n),
      document.body.appendChild(I),
      Gi(e),
      zi(),
      r
    );
  }
  function qi(e, t, n) {
    if (e.length === 0 && !n?.suggest && !n?.alias) return;
    let r = hi(e, n);
    if (I && F === t && Ui === `matches` && Hi === r) {
      Gi(t);
      return;
    }
    let i = [];
    (n?.alias && i.push($r(n.alias)),
      n?.suggest && i.push(si(n.suggest.password)));
    for (let t of e) i.push(ri({ ...t, carried: t.id === n?.carriedId }));
    n?.newLogin && i.push(ai());
    let a = Ki(t, i.join(``));
    ((Hi = r),
      (Ui = `matches`),
      a.addEventListener(`mousedown`, (e) => {
        if (!e.isTrusted) return;
        let t = e.target;
        if (t?.closest(`[data-tp-regenerate]`)) {
          (e.preventDefault(), fi?.());
          return;
        }
        let r = t?.closest(`[data-entry-id]`);
        r?.dataset.entryId
          ? (e.preventDefault(),
            pa(I, !0) && ci?.(r.dataset.entryId, n?.otpOnly === !0))
          : t?.closest(`[data-tp-suggest]`)
            ? (e.preventDefault(), pa(I, !0) && di?.())
            : t?.closest(`[data-tp-alias]`)
              ? (e.preventDefault(), pa(I, !0) && pi?.())
              : t?.closest(`[data-tp-new-login]`) &&
                (e.preventDefault(), Wi(), mi?.());
      }));
  }
  function Ji(e) {
    if (I && F === e && Ui === `locked`) {
      Gi(e);
      return;
    }
    let t = Ki(e, ii());
    ((Ui = `locked`),
      t.addEventListener(`mousedown`, (e) => {
        if (!e.isTrusted || !e.target?.closest(`[data-tp-popout]`)) return;
        e.preventDefault();
        let t = F;
        (Wi(), li?.(t));
      }));
  }
  var Yi = T.runtime.getURL(`autofill-ui.html`),
    Xi = new URL(Yi).protocol,
    Zi = null,
    Qi = `probe`,
    L = null,
    $i = null,
    R = !1,
    ea = null,
    z = null,
    ta = ``,
    na = !1,
    ra = 0,
    ia = new Set();
  function aa() {
    (L && ((L.style.display = `none`), (L.style.visibility = ``)),
      (ta = ``),
      (na = !1),
      yi(null));
  }
  function oa() {
    (z !== null && (clearTimeout(z), (z = null)),
      (L &&= (L.remove(), null)),
      ($i = null),
      (R = !1),
      ca(),
      (ia = new Set()),
      (ea = null),
      (ta = ``),
      (na = !1),
      yi(null));
  }
  function sa() {
    if (L) {
      (L.style.display === `none` && ki(), (L.style.display = `block`));
      return;
    }
    let e = document.createElement(`div`);
    ((e.id = `tp-${Math.random().toString(36).slice(2, 10)}`),
      (e.style.cssText = `position: absolute; top: 0; left: 0; z-index: 2147483647; margin: 0; padding: 0; border: 0;`));
    let t = e.attachShadow({ mode: `closed` }),
      n = document.createElement(`iframe`);
    ((n.src = `${Yi}?parentOrigin=${encodeURIComponent(location.origin)}`),
      n.setAttribute(`scrolling`, `no`),
      (n.style.cssText = `display: block; width: 100%; height: 0; border: 0; margin: 0; background: transparent; color-scheme: light dark;`),
      t.appendChild(n),
      document.body.appendChild(e),
      (L = e),
      ($i = n),
      (R = !1));
  }
  function ca() {
    (Zi?.close(), (Zi = null));
  }
  function la(e) {
    Zi?.postMessage(e);
  }
  function ua() {
    if (!$i?.contentWindow || !ea) return;
    let e = ea;
    ((ea = null),
      (ia = new Set(e.kind === `matches` ? e.matches.map((e) => e.id) : [])),
      (na = !1),
      (ra =
        e.kind === `locked`
          ? 1
          : e.matches.length +
            +!!e.suggest +
            (e.alias && e.alias.state !== `busy` ? 1 : 0)),
      e.kind === `matches`
        ? la({
            type: `RENDER_MATCHES`,
            matches: e.matches,
            otpOnly: e.otpOnly,
            suggest: e.suggest,
            alias: e.alias,
            carriedId: e.carriedId,
            newLogin: e.newLogin,
          })
        : la({ type: `RENDER_LOCKED` }));
  }
  function da() {
    z !== null ||
      R ||
      (z = window.setTimeout(() => {
        if (((z = null), R)) return;
        Qi = `shadow`;
        let e = F,
          t = ea;
        (oa(),
          e &&
            t &&
            (t.kind === `matches`
              ? qi(t.matches, e, {
                  otpOnly: t.otpOnly,
                  suggest: t.suggest,
                  alias: t.alias,
                  newLogin: t.newLogin,
                })
              : Ji(e)));
      }, 700));
  }
  function fa(e, t) {
    if ((sa(), !L)) return;
    (yi(e), Di(L, e), zi());
    let n =
      t.kind === `matches`
        ? hi(t.matches, {
            suggest: t.suggest,
            alias: t.alias,
            carriedId: t.carriedId,
            newLogin: t.newLogin,
          })
        : `\0locked`;
    (R && n === ta) || ((ta = n), (ea = t), R ? ua() : da());
  }
  function pa(e, t) {
    return t === !0 && Ai() ? !1 : ma(e);
  }
  function ma(e) {
    return !!e && or(e);
  }
  function ha() {
    return I || (L && L.style.display !== `none` ? L : null);
  }
  function ga() {
    let e = ha();
    e && F && Di(e, F);
  }
  function _a() {
    (Wi(), aa());
  }
  function va(e, t, n) {
    (e.length !== 0 || n?.suggest || n?.alias) &&
      (Qi === `shadow`
        ? qi(e, t, n)
        : fa(t, {
            kind: `matches`,
            matches: e,
            otpOnly: n?.otpOnly === !0,
            suggest: n?.suggest,
            alias: n?.alias,
            carriedId: n?.carriedId,
            newLogin: n?.newLogin,
          }));
  }
  function ya(e) {
    Qi === `shadow` ? Ji(e) : fa(e, { kind: `locked` });
  }
  window.addEventListener(`message`, (e) => {
    let t = $i?.contentWindow;
    if (
      !t ||
      e.source !== t ||
      e.data?.type !== `AUTOFILL_UI_READY` ||
      !e.origin.startsWith(`${Xi}//`)
    )
      return;
    ca();
    let n = new MessageChannel();
    ((Zi = n.port1),
      (Zi.onmessage = ba),
      t.postMessage({ type: `UI_CONNECT` }, e.origin, [n.port2]));
  });
  function ba(e) {
    let t = e.data;
    switch (t?.type) {
      case `UI_CONNECTED`:
        ((R = !0),
          (Qi = `iframe`),
          z !== null && (clearTimeout(z), (z = null)),
          ua());
        break;
      case `UI_RESIZE`:
        $i &&
          ($i.style.height = `${Math.max(0, Math.min(400, Number(t.height) || 0))}px`);
        break;
      case `UI_PICK`:
        typeof t.entryId == `string` &&
          ia.has(t.entryId) &&
          pa(L, t.pointer) &&
          ci?.(t.entryId, !!t.otpOnly);
        break;
      case `UI_POPOUT`: {
        let e = F;
        (aa(), li?.(e));
        break;
      }
      case `UI_USE_SUGGESTED`:
        pa(L, t.pointer) && di?.();
        break;
      case `UI_REGENERATE`:
        fi?.();
        break;
      case `UI_USE_ALIAS`:
        pa(L, t.pointer) && pi?.();
        break;
      case `UI_NEW_LOGIN`:
        (aa(), mi?.());
    }
  }
  function xa(e) {
    return Qi !== `iframe` ||
      !R ||
      !L ||
      L.style.display === `none` ||
      document.activeElement !== F ||
      !$i?.contentWindow
      ? !1
      : e.key === `ArrowDown` || e.key === `ArrowUp`
        ? (e.preventDefault(),
          la({ type: `UI_KEY`, key: e.key }),
          ra > 0 && (na = !0),
          !0)
        : e.key === `Escape`
          ? (e.preventDefault(), ui?.(), aa(), !0)
          : e.key === `Enter` && na
            ? (e.preventDefault(), la({ type: `UI_KEY`, key: `Enter` }), !0)
            : !1;
  }
  Vt(() => {
    (Bi(), Wi(), oa());
  });
  var B = {
    showMatches: va,
    showLocked: ya,
    reposition: ga,
    remove: _a,
    removeDropdown: Wi,
    activeHost: ha,
    anchorField: () => F,
    clickIsOnAnchor: Ti,
    handleKey: xa,
    onPick(e) {
      ci = e;
    },
    onUnlockRequest(e) {
      li = e;
    },
    onDismiss(e) {
      ui = e;
    },
    onUseSuggested(e) {
      di = e;
    },
    onRegenerate(e) {
      fi = e;
    },
    onNewLogin(e) {
      mi = e;
    },
    onUseAlias(e) {
      pi = e;
    },
  };
  function Sa() {
    let e = new Set();
    try {
      let t = T.runtime.getURL(``);
      t && e.add(new URL(t).origin);
    } catch {}
    try {
      let t = T.runtime?.id,
        n = new URL(T.runtime.getURL(``)).protocol;
      t && n && e.add(`${n}//${t}`);
    } catch {}
    return e;
  }
  function Ca(e, t = Sa()) {
    return e.length > 0 && t.has(e);
  }
  var wa = `tp-ui-here`,
    Ta = null,
    Ea = null,
    V = null,
    H = null,
    Da = null,
    Oa = null,
    ka = new Set(),
    Aa = !1;
  function ja() {
    return V !== null;
  }
  function Ma() {
    return H !== null && Da !== null;
  }
  function Na() {
    let e = new Uint8Array(16);
    return (
      crypto.getRandomValues(e),
      Array.from(e, (e) => e.toString(16).padStart(2, `0`)).join(``)
    );
  }
  function Pa(e) {
    if (H && Da)
      try {
        H.postMessage(e, Da);
      } catch {}
  }
  function Fa() {
    if (!Oa || !Ma()) return;
    let e = Oa;
    ((Oa = null),
      e.kind === `locked`
        ? ((ka = new Set()), Pa({ type: `RENDER_LOCKED` }))
        : ((ka = new Set(e.matches.map((e) => e.id))),
          (Aa = e.otpOnly),
          Pa({
            type: `RENDER_MATCHES`,
            matches: e.matches,
            otpOnly: e.otpOnly,
            suggest: e.suggest,
            alias: e.alias,
            carriedId: e.carriedId,
            newLogin: e.newLogin,
          })));
  }
  function Ia(e, t) {
    Ta && ((V ||= Na()), (Oa = t), Ta.open(V, e), Fa());
  }
  function La(e) {
    Ta && V && Ta.open(V, e);
  }
  function Ra() {
    (Ta && V && Ta.close(V),
      (V = null),
      (H = null),
      (Da = null),
      (Oa = null),
      (ka = new Set()));
  }
  function za(e) {
    Ma() && Pa({ type: `UI_KEY`, key: e });
  }
  function Ba(e) {
    if (!V) return;
    let t = e.data;
    if (t && typeof t == `object`) {
      if (t.__tp === wa) {
        if (
          t.relayId !== V ||
          !Ca(e.origin) ||
          !e.source ||
          (H && H !== e.source)
        )
          return;
        ((H = e.source), (Da = e.origin), Fa());
      } else if (H && e.source === H && e.origin === Da)
        switch (t.type) {
          case `UI_PICK`: {
            let e = t.entryId;
            if (typeof e != `string` || !ka.has(e)) return;
            Ea?.onPick(e, Aa);
            break;
          }
          case `UI_HIGHLIGHT`:
            Ea?.onHighlight(!!t.active);
            break;
          case `UI_POPOUT`:
            Ea?.onPopout();
            break;
          case `UI_USE_SUGGESTED`:
            Ea?.onUseSuggested();
            break;
          case `UI_REGENERATE`:
            Ea?.onRegenerate();
            break;
          case `UI_NEW_LOGIN`:
            Ea?.onNewLogin();
        }
    }
  }
  function Va(e, t) {
    ((Ta = e), (Ea = t), window.addEventListener(`message`, Ba));
  }
  var Ha = T.runtime.getURL(`autofill-ui.html`),
    Ua = 400;
  function Wa(e) {
    return Math.min(Math.max(e, 300), 440);
  }
  var U = null,
    Ga = null;
  function Ka(e) {
    let t = Qr(e.host),
      n = `translate3d(${e.rect.x + t.x}px, ${e.rect.y + e.rect.height + t.y + 2}px, 0)`,
      r = `${Wa(e.rect.width)}px`;
    if (e.host.style.transform === n && e.host.style.width === r) return;
    let i = e.host.style.transform !== ``;
    ((e.host.style.transform = n),
      (e.host.style.width = r),
      i && e.frame.contentWindow?.postMessage({ type: `UI_MOVED` }, `*`));
  }
  function qa() {
    Ga !== null && (cancelAnimationFrame(Ga), (Ga = null));
  }
  function Ja() {
    (qa(), (U &&= (U.host.remove(), null)));
  }
  function Ya() {
    if (Ga !== null) return;
    let e = () => {
      ((Ga = null),
        U &&
          (U.frame.getBoundingClientRect().height >= 20 && !or(U.host)
            ? Ja()
            : (Ga = requestAnimationFrame(e))));
    };
    Ga = requestAnimationFrame(e);
  }
  function Xa(e) {
    if ((U && U.relayId !== e.relayId && Ja(), U)) {
      ((U.rect = e.rect), Ka(U));
      return;
    }
    let t = document.createElement(`div`);
    ((t.id = `tp-${Math.random().toString(36).slice(2, 10)}`),
      (t.style.cssText = `position: absolute; top: 0; left: 0; z-index: 2147483647; margin: 0; padding: 0; border: 0;`));
    let n = t.attachShadow({ mode: `closed` }),
      r = document.createElement(`iframe`);
    ((r.src = `${Ha}?relayId=${encodeURIComponent(e.relayId)}&parentOrigin=${encodeURIComponent(location.origin)}`),
      r.setAttribute(`scrolling`, `no`),
      (r.style.cssText = `display: block; width: 100%; height: 0; border: 0; margin: 0; background: transparent; color-scheme: light dark;`),
      n.appendChild(r),
      document.body.appendChild(t),
      (U = { relayId: e.relayId, host: t, frame: r, rect: e.rect }),
      Ka(U),
      Ya());
  }
  function Za(e) {
    return !!U && U.host.contains(e);
  }
  function Qa(e) {
    U?.relayId === e && Ja();
  }
  (window.addEventListener(`message`, (e) => {
    if (!U || e.source !== U.frame.contentWindow || !Ca(e.origin)) return;
    let t = e.data;
    if (t?.type !== `UI_RESIZE`) return;
    let n = Math.max(0, Math.min(Ua, Number(t.height) || 0));
    U.frame.style.height = `${n}px`;
  }),
    Vt(Ja));
  var $a = null,
    W = null,
    eo = !1,
    G = !1,
    to = null,
    no = null,
    ro = 0,
    io = null,
    ao = !1,
    oo = 0,
    so = 0,
    K = null,
    co = !1;
  function lo() {
    ((K = null), so++);
  }
  function uo() {
    so++;
  }
  function q() {
    (oo++, lo());
  }
  function fo() {
    return document.visibilityState === `visible` && document.hasFocus();
  }
  function po() {
    return document.visibilityState === `visible`;
  }
  var J = Hr({ window, document }),
    Y = null,
    mo = !1;
  function ho(e) {
    let t = e.getBoundingClientRect();
    return { x: t.left, y: t.top, width: t.width, height: t.height };
  }
  var go = !1,
    _o = 2e3,
    vo = null,
    yo = null;
  function bo(e) {
    return J.isTop() || (rt(S(), e) !== `card` && W?.sameSiteAsTop !== !0)
      ? `local`
      : go
        ? J.needsRelay(ho(e))
          ? `none`
          : `local`
        : `relay`;
  }
  function xo(e) {
    ((yo = e),
      !(vo !== null || Ma()) &&
        (vo = setTimeout(() => {
          if (((vo = null), Ma() || !Y)) return;
          go = !0;
          let e = yo;
          (X(), e?.());
        }, _o)));
  }
  function So() {
    return B.anchorField() ?? Y;
  }
  function X() {
    ((Y = null), (mo = !1), (yo = null), ja() && Ra());
  }
  function Co() {
    return !!B.activeHost() || ja();
  }
  function wo() {
    return !!Y && Xe(Y, ho(Y));
  }
  function To() {
    (B.reposition(), Y && (wo() ? La(ho(Y)) : X()));
  }
  function Z() {
    (B.remove(), X());
  }
  function Q(e, t, n) {
    if (e.length === 0 && !n?.suggest && !n?.alias) return;
    let r = bo(t);
    r === `none`
      ? Z()
      : r === `local`
        ? (X(), B.showMatches(e, t, n))
        : (B.remove(),
          (Y = t),
          Ia(ho(t), {
            kind: `matches`,
            matches: e,
            otpOnly: n?.otpOnly === !0,
            suggest: n?.suggest,
            alias: n?.alias,
            carriedId: n?.carriedId,
            newLogin: n?.newLogin,
          }),
          xo(() => Q(e, t, n)));
  }
  function Eo(e) {
    let t = e.carriedCardId;
    if (!t) return { matches: e.cards };
    let n = e.cards.find((e) => e.id === t);
    return n
      ? {
          matches: [n, ...e.cards.filter((e) => e !== n)],
          opts: { carriedId: t },
        }
      : { matches: e.cards };
  }
  function Do(e) {
    return !ja() || h() !== Y
      ? !1
      : e.key === `ArrowDown` || e.key === `ArrowUp`
        ? (e.preventDefault(), za(e.key), !0)
        : e.key === `Escape`
          ? (e.preventDefault(), (G = !0), X(), !0)
          : e.key === `Enter` && mo
            ? (e.preventDefault(), za(`Enter`), !0)
            : !1;
  }
  function Oo(e) {
    let t = bo(e);
    t === `none`
      ? Z()
      : t === `local`
        ? (X(), B.showLocked(e))
        : (B.remove(), (Y = e), Ia(ho(e), { kind: `locked` }), xo(() => Oo(e)));
  }
  function ko(e) {
    return (
      x(),
      !e.isConnected || e.ownerDocument !== document || e.disabled || e.readOnly
        ? null
        : rt(S(), e)
    );
  }
  function Ao(e) {
    if (!(e instanceof Node)) return !1;
    let t = B.activeHost();
    return !!t && (t.contains(e) || B.clickIsOnAnchor(e));
  }
  function jo(e) {
    if (!e || typeof e != `object`) return null;
    let t = e;
    if (
      (t.isAuto !== !0 && t.isAuto !== !1) ||
      (t.otpOnly !== !0 && t.otpOnly !== !1) ||
      !Number.isSafeInteger(t.sessionGeneration) ||
      t.sessionGeneration < 0
    )
      return null;
    let n = t.payload;
    return No(n)
      ? {
          payload: n,
          isAuto: t.isAuto,
          otpOnly: t.otpOnly,
          sessionGeneration: t.sessionGeneration,
        }
      : null;
  }
  function Mo(e) {
    return (
      e === void 0 ||
      (Array.isArray(e) &&
        e.every(
          (e) =>
            e &&
            typeof e == `object` &&
            typeof e.key == `string` &&
            typeof e.value == `string`,
        ))
    );
  }
  function No(e) {
    return !e || typeof e != `object` || !Mo(e.customFields)
      ? !1
      : e.kind === `login`
        ? typeof e.username == `string` &&
          typeof e.password == `string` &&
          (e.totp === void 0 || typeof e.totp == `string`) &&
          (e.autoSubmit === void 0 || typeof e.autoSubmit == `boolean`)
        : e.kind === `card` &&
          typeof e.cardholderName == `string` &&
          typeof e.number == `string` &&
          typeof e.expMonth == `string` &&
          typeof e.expYear == `string` &&
          typeof e.cvv == `string`;
  }
  function Po(e, t, n) {
    return e === `card`
      ? t.kind === `card` && !n
      : e === `otp`
        ? t.kind === `login` && n
        : t.kind === `login` && !n;
  }
  function Fo(e, t, n) {
    return (
      x(),
      t === so &&
        n() &&
        e.isConnected &&
        e.ownerDocument === document &&
        !e.disabled &&
        !e.readOnly &&
        S().login.password === e &&
        !Ze()
    );
  }
  async function Io(e, t, n, r) {
    if (!Fo(e, t, r)) return;
    let i = await Gt({
      type: `AUTOFILL_REVALIDATE_SUBMIT`,
      sessionGeneration: n,
    });
    i?.ok && i.data.sessionGeneration === n && Fo(e, t, r) && Dt(e);
  }
  function Lo(e, t, n = fo) {
    if (K !== e || ((K = null), !t?.ok)) return !1;
    let r = jo(t.data);
    if (
      !r ||
      !n() ||
      ko(e.target) !== e.targetKind ||
      !Po(e.targetKind, r.payload, r.otpOnly)
    )
      return !1;
    if ((B.removeDropdown(), r.payload.kind === `card`))
      return (
        Mt(r.payload, r.isAuto),
        kt(r.payload.customFields, r.isAuto),
        !0
      );
    if (r.otpOnly) return (Lt(r.payload.totp), !0);
    let { filled: i, passwordField: a } = wt(
      r.payload.username,
      r.payload.password,
      r.isAuto,
      e.target,
    );
    if (
      (kt(r.payload.customFields, r.isAuto),
      Lt(r.payload.totp),
      !i || !r.payload.autoSubmit || !a)
    )
      return !0;
    let o = ++so;
    return (
      setTimeout(() => {
        Io(a, o, r.sessionGeneration, n);
      }, 50),
      !0
    );
  }
  var Ro = new WeakMap(),
    zo = new WeakMap(),
    Bo = new WeakMap();
  function Vo(e) {
    let t = Bo.get(e);
    if (t !== void 0) return t;
    let n = En(e);
    return (Bo.set(e, n), n);
  }
  function Ho(e, t) {
    if (e.type !== `password` || e.value) return null;
    let n = Ro.get(e);
    if (n) return n;
    if (!xn(e, { hasExistingLogins: t })) return null;
    let r = { password: Jr(), newLogin: wn(e) };
    return (Ro.set(e, r), Bo.set(e, r.newLogin), r);
  }
  async function Uo(e) {
    let t = await Yr();
    return (Ro.set(e, { password: t, newLogin: Ro.get(e)?.newLogin ?? !1 }), t);
  }
  function Wo(e, t) {
    let n = t.trim().toLowerCase();
    return n
      ? e.filter((e) => {
          let t = e.secondary.toLowerCase();
          return t.startsWith(n) || n.startsWith(t);
        })
      : e;
  }
  var Go = new WeakMap();
  function Ko(e, t) {
    if (e !== S().login.username) return t;
    let n = Go.get(e);
    return n ? Wo(t, n) : t;
  }
  function qo(e, t) {
    let n = Ho(e, t.length > 0);
    if (n) {
      Q([], e, { suggest: { password: n.password } });
      return;
    }
    let r = zo.get(e);
    if (r || (W?.aliasReady && Sn(e))) {
      Q([], e, { alias: r ?? { state: `idle` } });
      return;
    }
    if (Vo(e)) return;
    let i = Ko(e, t);
    i.length === 0
      ? Z()
      : Q(i, e, e === S().login.username ? { newLogin: !0 } : void 0);
  }
  function Jo(e, t) {
    let n = Ho(e, t);
    n
      ? Q([], e, { suggest: { password: n.password } })
      : W?.aliasReady && Sn(e)
        ? Oo(e)
        : Vo(e) || Oo(e);
  }
  function Yo(e) {
    let t = Ro.get(e);
    if (!t) return;
    let { password: n, newLogin: r } = t;
    Tt(sn(e), n) &&
      E({
        type: `CORNER_PROMPT_CAPTURE`,
        payload: {
          username: S().login.username?.value ?? ``,
          password: n,
          newLogin: r,
        },
      });
  }
  function Xo(e, t, n = !1, r = So(), i = fo) {
    let a = r,
      o = a ? ko(a) : null;
    if (!a || !o) return;
    t || (G = !0);
    let s = { target: a, targetKind: o };
    (lo(),
      (K = s),
      B.remove(),
      X(),
      Gt({
        type: `AUTOFILL_SELECT`,
        payload: { entryId: e, isAuto: t, otpOnly: n },
      }).then((e) => Lo(s, e, i)));
  }
  function Zo() {
    x();
    let e = S().login.password;
    return !e ||
      e.value ||
      e.disabled ||
      e.readOnly ||
      !b(e) ||
      sn(e).some((t) => t !== e) ||
      xn(e, { hasExistingLogins: !0 })
      ? null
      : e;
  }
  function Qo() {
    co && ((co = !1), W && (W.launch = !1), E({ type: `AUTOFILL_LAUNCH_END` }));
  }
  function $o() {
    window === window.top &&
      Gt({ type: `AUTOFILL_LAUNCH_LIVE` }).then((e) => {
        e?.ok && e.data?.live && (co = !0);
      });
  }
  function es() {
    if (K?.launch) return !0;
    if (!W?.launch || K || !po()) return !1;
    let e = window !== window.top;
    if (e && window.parent !== window.top) return !1;
    let t = Zo(),
      n = t ? ko(t) : null;
    if (!t || n !== `login`) return !1;
    let r = { target: t, targetKind: n, launch: !0 };
    return (
      (K = r),
      Z(),
      Gt({
        type: `AUTOFILL_LAUNCH_CLAIM`,
        payload: e
          ? { frameWidth: window.innerWidth, frameHeight: window.innerHeight }
          : void 0,
      }).then((e) => {
        let t = Lo(r, e, po);
        if ((e?.ok && ((co = !1), W && (W.launch = !1)), t)) {
          G = !0;
          return;
        }
        let n = ss();
        n && ds(n);
      }),
      !0
    );
  }
  function ts(e) {
    x();
    let t = S().login.password;
    return {
      hasPassword: !!t && b(t),
      frameVisible: Array.from(document.querySelectorAll(`iframe`)).some(
        (t) =>
          Math.abs(t.clientWidth - e.frameWidth) <= 2 &&
          Math.abs(t.clientHeight - e.frameHeight) <= 2 &&
          or(t),
      ),
    };
  }
  function ns(e, t) {
    let n = t.trim().toLowerCase(),
      r = (e) => e.toLowerCase().startsWith(n);
    if (n) {
      let t = e.find((e) => r(e.secondary)) ?? e.find((e) => r(e.name));
      if (t) return t;
    }
    return e[0];
  }
  function rs() {
    x();
    let e = S().login;
    return [ss(), e.username, e.password].find(
      (e) => !!e && b(e) && ko(e) === `login`,
    );
  }
  async function is(e) {
    let t = await Gt({
      type: `AUTOFILL_QUERY`,
      hasLogin: !e,
      hasCard: !1,
      hasOtp: e,
    });
    if (!t?.ok || !cs(t.data)) return null;
    let { logins: n, otps: r, locked: i, disabled: a } = t.data;
    return i || a ? null : e ? (r ?? []) : n;
  }
  async function as() {
    if (!document.hasFocus() || h() instanceof HTMLIFrameElement) return;
    x();
    let e = ss();
    if (e && ko(e) === `otp`) {
      let [t] = (await is(!0)) ?? [];
      t && Xo(t.id, !1, !0, e);
      return;
    }
    let t = rs();
    if (!t) return;
    let n = await is(!1),
      r = n && ns(n, S().login.username?.value ?? ``);
    r && Xo(r.id, !1, !1, t);
  }
  async function os(e) {
    let t = rs();
    return !t || !(await is(!1))?.some((t) => t.id === e)
      ? !1
      : (Xo(e, !1, !1, t, po), !0);
  }
  function ss() {
    let e = h();
    return e instanceof HTMLInputElement && it(S(), e) ? e : null;
  }
  function cs(e) {
    return (
      typeof e == `object` &&
      !!e &&
      Array.isArray(e.logins) &&
      Array.isArray(e.cards) &&
      typeof e.locked == `boolean`
    );
  }
  function ls(e) {
    if (!cs(e)) return;
    if (e.disabled) {
      us(!1);
      return;
    }
    if (((W = e), qr(e.generated), e.launch && (co = !0), es())) return;
    if (G) {
      to = null;
      return;
    }
    let t = ss() ?? (to?.isConnected ? to : null);
    if (((to = null), !t)) return;
    if (e.locked) {
      Jo(t, e.hasPotentialMatch);
      return;
    }
    let n = rt(S(), t);
    if (n === `card`) {
      let n = Eo(e);
      n.matches.length > 0 && Q(n.matches, t, n.opts);
    } else if (n === `otp`) {
      let n = e.otps ?? [];
      n.length > 0 && Q(n, t, { otpOnly: !0 });
    } else qo(t, e.logins);
  }
  function us(e) {
    ((eo = !e), e ? $() : (q(), (W = null), (to = null), (no = null), Z()));
  }
  function $() {
    if (eo) return;
    let e = S(),
      t = !!(e.login.username || e.login.password),
      n = we(e.card),
      r = e.otp.length > 0;
    if (!t && !n && !r) return;
    let i = ++oo;
    Gt({ type: `AUTOFILL_QUERY`, hasLogin: t, hasCard: n, hasOtp: r }).then(
      (e) => {
        i === oo && e?.ok && ls(e.data);
      },
    );
  }
  function ds(e) {
    if (eo || G) return;
    if (!W) {
      $();
      return;
    }
    if (W.locked) {
      Jo(e, W.hasPotentialMatch);
      return;
    }
    let t = rt(S(), e);
    if (t === `card`) {
      let t = Eo(W);
      (t.matches.length > 0 && Q(t.matches, e, t.opts), $());
    } else if (t === `otp`) {
      let t = W.otps ?? [];
      t.length === 0
        ? $()
        : (t.length > 1 || !e.value) && Q(t, e, { otpOnly: !0 });
    } else if (W.logins.length === 0) {
      let t = Ho(e, !1);
      (t && Q([], e, { suggest: { password: t.password } }), $());
    } else W.logins.length === 1 && e.value ? Z() : qo(e, W.logins);
  }
  var fs = `input, select, textarea, form, iframe, frame`;
  function ps(e) {
    if (e.nodeType !== 1) return !1;
    let t = e;
    return t.tagName.includes(`-`)
      ? !0
      : t.matches(fs) || t.querySelector(fs) !== null;
  }
  function ms(e) {
    if (l()) return !0;
    for (let t of e) {
      for (let e of t.addedNodes) if (ps(e)) return !0;
      for (let e of t.removedNodes) if (ps(e)) return !0;
    }
    return !1;
  }
  var hs = new WeakSet();
  function gs(e) {
    return it(S(), e) ? !0 : !hs.has(e) && (hs.add(e), x(), it(S(), e));
  }
  var _s = 500;
  function vs() {
    if (io !== null) return;
    let e = Date.now() - ro,
      t = e >= 0 && e < _s ? _s - e : 0;
    io = setTimeout(() => {
      ((io = null), (ro = Date.now()), document.hidden ? (ao = !0) : $());
    }, t);
  }
  function ys(e) {
    ms(e) && (x(), Kn(), Y && !wo() && X(), document.hidden ? (ao = !0) : vs());
  }
  (B.onPick((e, t) => Xo(e, !1, t)),
    B.onUnlockRequest((e) => {
      (q(),
        (no = e),
        E({ type: `POPOUT_OPEN`, payload: { reason: `unlock` } }));
    }),
    B.onDismiss(() => {
      (q(), (G = !0));
    }),
    B.onUseSuggested(() => {
      q();
      let e = So();
      e && (Yo(e), (G = !0), B.remove(), X());
    }));
  function bs() {
    (q(),
      (G = !0),
      Z(),
      E({ type: `POPOUT_OPEN`, payload: { reason: `new-login` } }));
  }
  (B.onNewLogin(bs),
    B.onUseAlias(() => {
      q();
      let e = So();
      e &&
        zo.get(e)?.state !== `busy` &&
        (zo.set(e, { state: `busy` }),
        Q([], e, { alias: { state: `busy` } }),
        Gt({ type: `ALIAS_CREATE` }).then((t) => {
          if (So() !== e || !e.isConnected) {
            zo.delete(e);
            return;
          }
          if (!t?.ok || !t.data.address) {
            let n = t && !t.ok ? t.error : void 0;
            (zo.set(e, { state: `error`, message: n }),
              Q([], e, { alias: { state: `error`, message: n } }));
            return;
          }
          (zo.delete(e), Et(e, t.data.address));
          let n = Ct();
          (n &&
            E({
              type: `CORNER_PROMPT_CAPTURE`,
              payload: { username: t.data.address, password: n, newLogin: !0 },
            }),
            (G = !0),
            B.remove(),
            X());
        }));
    }),
    B.onRegenerate(() => {
      q();
      let e = So();
      e &&
        Uo(e).then((t) => {
          So() === e && Q([], e, { suggest: { password: t } });
        });
    }),
    J.isTop()
      ? (J.onAnchor(Xa), J.onClose(Qa))
      : (J.onDismiss(() => {
          Co() && ((G = !0), Z());
        }),
        Va(J, {
          onPick: (e, t) => Xo(e, !1, t),
          onHighlight: (e) => {
            mo = e;
          },
          onPopout: () => {
            q();
            let e = Y;
            (X(),
              (no = e),
              E({ type: `POPOUT_OPEN`, payload: { reason: `unlock` } }));
          },
          onUseSuggested: () => {
            q();
            let e = Y;
            e && (Yo(e), (G = !0), X());
          },
          onRegenerate: () => {
            q();
            let e = Y;
            e &&
              Uo(e).then((t) => {
                Y === e && Q([], e, { suggest: { password: t } });
              });
          },
          onNewLogin: bs,
        })),
    Vt(() => {
      ($a?.disconnect(),
        ($a = null),
        io !== null && (clearTimeout(io), (io = null)),
        q(),
        X());
    }),
    document.addEventListener(
      `keydown`,
      (e) => {
        e.isTrusted && (q(), Qo(), B.handleKey(e) || Do(e) || Hn(e.key, g(e)));
      },
      !0,
    ),
    T.runtime.onMessage.addListener((e, t, n) => {
      if (e?.type === `CORNER_PROMPT_SHOW`)
        return (Ar(e.payload), n({ ok: !0 }), !1);
      if (e?.type === `CORNER_FIELD`) return (n(Er(e.payload)), !1);
      if (e?.type === `DESKTOP_FILL`) {
        let t = e.payload;
        x();
        let r = S().login,
          i = ss() ?? r.username ?? r.password,
          a = i ? ko(i) : null;
        return !t?.password || !i || !a
          ? (n({ ok: !1, error: `no field to fill` }), !1)
          : (lo(),
            B.remove(),
            X(),
            wt(t.username ?? ``, t.password, !1, i),
            t.totp && Lt(t.totp),
            n({ ok: !0 }),
            !1);
      }
      if (e?.type === `AUTOFILL_SHORTCUT`) return (as(), n({ ok: !0 }), !1);
      if (e?.type === `AUTOFILL_FILL_ENTRY`) {
        let t = e.payload?.entryId;
        return window !== window.top || typeof t != `string`
          ? !1
          : (os(t).then((e) => n({ ok: e })), !0);
      }
      if (e?.type === `AUTOFILL_LAUNCH_TOP_CHECK`)
        return (n(ts(e.payload)), !1);
      if (e?.type === `AUTOFILL_ENABLED`)
        return (us(e.payload?.enabled !== !1), n({ ok: !0 }), !1);
      if (e?.type === `VAULT_LOCK_STATE`) {
        q();
        let t = e.payload?.locked === !0;
        W && (W.locked = t);
        let r = ss();
        if (t)
          (Co() && (r ? Jo(r, W?.hasPotentialMatch ?? !1) : Z()), (no = null));
        else {
          let e = Co() ? So() : null,
            t = no?.isConnected ? no : null;
          no = null;
          let n = r ?? e ?? t;
          (Z(), n && ((to = n), $()));
        }
        return (n({ ok: !0 }), !1);
      }
      return !1;
    }));
  function xs() {
    ($(),
      yr(),
      $o(),
      ($a = new MutationObserver((e) => ys(e))),
      $a.observe(document, { childList: !0, subtree: !0 }),
      document.addEventListener(
        `focusin`,
        (e) => {
          if (bt()) return;
          let t = g(e);
          (e.isTrusted && !Ao(t) && uo(),
            e.isTrusted && K && !K.launch && t !== K.target && !Ao(t) && q(),
            ot(t) && gs(t) && ((G = !1), !es() && ds(t)));
        },
        !0,
      ),
      document.addEventListener(
        `focusout`,
        (e) => {
          if (bt()) return;
          let t = So();
          if (!t || g(e) !== t) return;
          let n = e.relatedTarget;
          n && !Ao(n) && ((G = !0), Z());
        },
        !0,
      ),
      document.addEventListener(
        `input`,
        (e) => {
          if (!e.isTrusted) return;
          q();
          let t = g(e);
          if (ot(t) && it(S(), t)) {
            if (((G = !1), t.value ? Go.set(t, t.value) : Go.delete(t), !W))
              $();
            else {
              if (t.value && !W.locked) {
                let e = rt(S(), t);
                if (
                  (e === `card`
                    ? W.cards.length
                    : e === `otp`
                      ? (W.otps ?? []).length
                      : W.logins.length) <= 1
                ) {
                  Z();
                  return;
                }
              }
              ds(t);
            }
          }
        },
        !0,
      ),
      document.addEventListener(
        `pointerdown`,
        (e) => {
          let t = g(e);
          (e.isTrusted && !Ao(t) && uo(),
            e.isTrusted && K && !Ao(t) && q(),
            e.isTrusted && !ot(t) && Qo());
        },
        !0,
      ),
      document.addEventListener(
        `mousedown`,
        (e) => {
          let t = g(e);
          (e.isTrusted && !Ao(t) && uo(),
            e.isTrusted && K && !Ao(t) && t !== K.target && q(),
            e.isTrusted &&
              !(t instanceof Node && Za(t)) &&
              (J.dismissDescendants(), Ja()));
          let n = B.activeHost();
          if (n) {
            if (t instanceof Node && (n.contains(t) || B.clickIsOnAnchor(t)))
              return;
            ((G = !0), B.remove());
          } else
            ja() && t !== Y
              ? ((G = !0), X())
              : ot(t) && gs(t) && ((G = !1), h() === t && ds(t));
        },
        !0,
      ),
      window.addEventListener(`scroll`, () => To(), !0),
      window.addEventListener(`resize`, () => To(), !0),
      window.addEventListener(
        `pagehide`,
        () => {
          (q(), Z());
        },
        !0,
      ),
      window.addEventListener(`pageshow`, (e) => {
        e.persisted && (q(), (W = null), $());
      }),
      document.addEventListener(`visibilitychange`, () => {
        document.visibilityState === `visible`
          ? ao && ((ao = !1), x(), $())
          : q();
      }),
      window.addEventListener(`blur`, () => {
        setTimeout(() => {
          document.hasFocus() || q();
        }, 0);
      }));
  }
  document.readyState === `loading`
    ? document.addEventListener(`DOMContentLoaded`, xs)
    : xs();
})();
