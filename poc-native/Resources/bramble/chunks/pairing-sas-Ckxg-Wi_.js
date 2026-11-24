import { en as e } from "./messages-DLCDPx8W.js";
var t = `wss://bramble-relay.flythenimbus.workers.dev`;
function n(e) {
  return (
    (typeof e == `string` && e.trim()) ||
    `wss://bramble-relay.flythenimbus.workers.dev`
  );
}
function r(e) {
  try {
    return [`ws:`, `wss:`, `http:`, `https:`].includes(new URL(e).protocol);
  } catch {
    return !1;
  }
}
var i = `bramble/sync/sas/v1`,
  a = 12,
  o = 4,
  s = 6,
  c = (e) => e;
function l(e, t, n) {
  let r = [],
    i = 0,
    a = 0;
  for (let o of e) {
    for (i = (i << 8) | o, a += 8; a >= t && r.length < n;)
      ((a -= t), r.push((i >>> a) & ((1 << t) - 1)));
    if (((i &= (1 << a) - 1), r.length === n)) break;
  }
  return r;
}
async function u(t, n, r) {
  let a = await crypto.subtle.importKey(`raw`, c(e(t)), `HKDF`, !1, [
      `deriveBits`,
    ]),
    o = new TextEncoder(),
    s = await crypto.subtle.deriveBits(
      {
        name: `HKDF`,
        hash: `SHA-256`,
        salt: c(o.encode([n, r].sort().join(``))),
        info: c(o.encode(i)),
      },
      a,
      64,
    );
  return d(new Uint8Array(s));
}
function d(e) {
  let t = 0n;
  for (let n of e) t = (t << 8n) | BigInt(n);
  let n = (t % 10n ** BigInt(a)).toString().padStart(a, `0`);
  return {
    emoji: l(e, s, 7),
    digits: [n.slice(0, o), n.slice(o, 8), n.slice(8)].join(` `),
  };
}
export { n as a, r as i, d as n, t as r, u as t };
