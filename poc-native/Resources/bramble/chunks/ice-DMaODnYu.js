function e(e) {
  try {
    let t = new URL(e);
    return (
      t.protocol === `ws:`
        ? (t.protocol = `http:`)
        : t.protocol === `wss:` && (t.protocol = `https:`),
      (t.pathname = `/ice-servers`),
      (t.hash = ``),
      t.toString()
    );
  } catch {
    return ``;
  }
}
function t(t, n) {
  try {
    return new URL(t).origin === new URL(e(n)).origin;
  } catch {
    return !1;
  }
}
async function n(e, t) {
  if (!e) return [];
  try {
    let n = await fetch(
      e,
      t
        ? {
            method: `POST`,
            headers: { "Content-Type": `text/plain` },
            body: JSON.stringify({ ticket: t }),
          }
        : { method: `POST` },
    );
    return n.ok ? i(await n.json()) : [];
  } catch {
    return [];
  }
}
var r = (e) => typeof e.urls == `string` || Array.isArray(e.urls);
function i(e) {
  let t = e && typeof e == `object` && !Array.isArray(e) ? e.iceServers : e;
  return (Array.isArray(t) ? t : t ? [t] : []).filter(
    (e) => !!e && typeof e == `object` && r(e),
  );
}
export { n, t as r, e as t };
