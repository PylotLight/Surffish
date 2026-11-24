const __vite__mapDeps = (
  i,
  m = __vite__mapDeps,
  d = m.f ||
    (m.f = [
      "chunks/jsQR-CGzg4Qjr.js",
      "chunks/build-vault-Dl7gFnhh.js",
      "chunks/messages-DLCDPx8W.js",
    ]),
) => i.map((i) => d[i]);
import {
  i as e,
  l as t,
  n,
  o as r,
  t as i,
  u as a,
} from "./build-vault-Dl7gFnhh.js";
import {
  A as o,
  C as s,
  E as c,
  F as l,
  Ft as u,
  I as d,
  J as f,
  K as p,
  L as m,
  M as h,
  N as g,
  Ot as ee,
  P as te,
  S as ne,
  St as re,
  T as _,
  Tt as v,
  U as y,
  Vt as ie,
  Y as ae,
  Z as oe,
  c as se,
  cn as ce,
  en as b,
  f as le,
  in as x,
  j as ue,
  l as de,
  m as fe,
  o as pe,
  p as me,
  q as S,
  r as he,
  s as ge,
  sn as C,
  t as _e,
  tn as ve,
  tt as ye,
  vt as be,
  w,
  x as T,
  yt as xe,
  z as Se,
} from "./messages-DLCDPx8W.js";
import { n as Ce, r as we, t as Te } from "./ice-DMaODnYu.js";
import { i as Ee, t as De } from "./pairing-sas-Ckxg-Wi_.js";
import {
  A as Oe,
  C as ke,
  D as Ae,
  E as je,
  O as Me,
  S as Ne,
  T as Pe,
  _ as Fe,
  a as Ie,
  b as Le,
  c as Re,
  d as ze,
  f as Be,
  g as Ve,
  h as He,
  i as Ue,
  k as We,
  l as Ge,
  m as Ke,
  n as qe,
  o as Je,
  p as Ye,
  s as Xe,
  u as Ze,
  v as Qe,
  w as $e,
  x as et,
  y as tt,
} from "./sender-DSrAWqxj.js";
var nt = () => () => {};
function rt(e, t = {}) {
  let { onUnlocked: n, onLocked: r } = t;
  return {
    async generateVek() {
      let t = await (await e()).generate_vek();
      return (n?.(), t);
    },
    async unlockWithVek(t) {
      (await (await e()).unlock_with_vek(t), n?.());
    },
    async exportVek() {
      return (await e()).export_vek();
    },
    async rotateVek() {
      return (await e()).rotate_vek();
    },
    async lock() {
      (await (await e()).lock(), r?.());
    },
    async isLocked() {
      return (await e()).is_locked();
    },
    onExternalLock: t.onExternalLock ?? nt,
    onExternalChange: t.onExternalChange ?? nt,
    async generateSalt() {
      return (await e()).generate_salt();
    },
    async generateSlotId() {
      return (await e()).generate_slot_id();
    },
    async wrapVekPassword(t) {
      return (await e()).wrap_vek_password(
        t.password,
        t.saltB64,
        t.slotIdB64,
        t.magicVersion,
      );
    },
    async unwrapVekPassword(t) {
      let r = await (
        await e()
      ).unwrap_vek_password(
        t.password,
        t.saltB64,
        t.slotIdB64,
        t.verifierB64,
        t.wrapIvB64,
        t.wrappedVekB64,
        t.magicVersion,
      );
      return (r && n?.(), r);
    },
    async verifyPasswordSlot(t) {
      return (await e()).verify_password_slot(
        t.password,
        t.saltB64,
        t.slotIdB64,
        t.verifierB64,
        t.magicVersion,
      );
    },
    async wrapVekWebauthn(t) {
      return (await e()).wrap_vek_webauthn(
        t.hmacSecretB64,
        t.slotIdB64,
        t.magicVersion,
      );
    },
    async unwrapVekWebauthn(t) {
      let r = await (
        await e()
      ).unwrap_vek_webauthn(
        t.hmacSecretB64,
        t.slotIdB64,
        t.verifierB64,
        t.wrapIvB64,
        t.wrappedVekB64,
        t.magicVersion,
      );
      return (r && n?.(), r);
    },
    async verifyWebauthnSlot(t) {
      return (await e()).verify_webauthn_slot(
        t.hmacSecretB64,
        t.slotIdB64,
        t.verifierB64,
        t.magicVersion,
      );
    },
    async encryptEntry(t) {
      return (await e()).encrypt_entry(t);
    },
    async decryptEntry(t) {
      return (await e()).decrypt_entry(
        t.ciphertext,
        t.iv,
        t.wrappedDek,
        t.dekIv,
      );
    },
    async decryptEntries(t) {
      let n = await e();
      return n.decrypt_entries
        ? n.decrypt_entries(t)
        : Promise.all(
            t.map((e) =>
              n.decrypt_entry(e.ciphertext, e.iv, e.wrappedDek, e.dekIv),
            ),
          );
    },
    async encryptWithVek(t) {
      return (await e()).encrypt_with_vek(t);
    },
    async decryptWithVek(t, n) {
      return (await e()).decrypt_with_vek(t, n);
    },
    async mailboxId(t) {
      return (await e()).mailbox_id(t);
    },
    async mailboxSeal(t, n, r) {
      return (await e()).mailbox_seal(t, n, r);
    },
    async mailboxOpen(t, n, r) {
      return (await e()).mailbox_open(t, n, r);
    },
    async passkeyMakeCredential(t, n) {
      return (await e()).passkey_make_credential(t, n);
    },
    async passkeyImportPkcs8(t) {
      return (await e()).passkey_import_pkcs8(t);
    },
    async passkeyGetAssertion(t, n, r, i, a) {
      return (await e()).passkey_get_assertion(t, n, r, i, a);
    },
    async passkeyPrfEval(t, n, r) {
      return (await e()).passkey_prf_eval(t, n, r);
    },
    async openKdbx(t) {
      let n = await (await e()).open_kdbx4(t.file, t.password, t.keyfile);
      return {
        entries: n.entries,
        attachments: n.attachments.map((e) =>
          e instanceof Uint8Array
            ? { source: { kind: `blob`, blob: new Blob([e]) }, size: e.length }
            : {
                source: { kind: `path`, path: e.path, size: e.size },
                size: e.size,
              },
        ),
        release: n.release ?? (async () => {}),
      };
    },
    async sealPortableVault(t) {
      let n = await e();
      if (!n.seal_portable_vault)
        throw Error(`Exporting a .bramble isn't available here.`);
      return n.seal_portable_vault(t.entriesJson, t.password, t.magicVersion);
    },
    async openPortableVault(t) {
      let n = await e();
      if (!n.open_portable_vault)
        throw Error(`Opening a .bramble isn't available here.`);
      return (
        (await n.open_portable_vault(t.password, t.file, t.magicVersion)) ??
        null
      );
    },
  };
}
function E(e) {
  let t = [],
    n = null;
  return {
    channel: {
      send: e,
      recv: () =>
        new Promise((e) => {
          let r = t.shift();
          r === void 0 ? (n = e) : e(r);
        }),
    },
    push: (e) => {
      if (n) {
        let t = n;
        ((n = null), t(e));
      } else t.push(e);
    },
  };
}
var it = `desktop`,
  at = () => crypto.getRandomValues(new Uint32Array(1))[0];
function ot(e) {
  return async ({ onPeer: t, report: n }) => {
    let r = null,
      i = null,
      a = !1,
      o = () => {
        if (a) return;
        let o = at(),
          { channel: s, push: c } = E((t) => {
            r?.stream === o &&
              e
                .send(o, t)
                .then((e) => {
                  !e && r?.stream === o && (r = null);
                })
                .catch(() => {});
          });
        ((r = { stream: o, push: c }),
          n(`desktop app offered as a file peer`),
          t({
            remotePubkey: it,
            initiator: !0,
            channel: s,
            close: () => {
              r?.stream === o && (r = null);
            },
            onGone: (e) => {
              i = e;
            },
          }));
      },
      s = e.subscribe({
        frame: (e, t) => {
          r?.stream === e && r.push(t);
        },
        poke: o,
        down: () => {
          r = null;
          let e = i;
          ((i = null), e?.());
        },
      });
    return (
      (await e.up()) && o(),
      {
        stop() {
          ((a = !0), (r = null), s());
        },
      }
    );
  };
}
async function st(e, t, n) {
  for (let r = !1; !r;) {
    let i = await e.handshake_read(n, await t.recv());
    (i.message && t.send(i.message), (r = i.done));
  }
}
async function ct(e, t, n) {
  let { sessionId: r, message: i } = await n();
  return (
    t.send(i),
    await st(e, t, r),
    { sessionId: r, remoteStatic: await e.handshake_remote_static(r) }
  );
}
async function lt(e, t, n) {
  let r = await n();
  return (
    await st(e, t, r),
    { sessionId: r, remoteStatic: await e.handshake_remote_static(r) }
  );
}
var ut = 15e3;
function D(e, t) {
  return e.devices.some((e) => e.publicKey === t);
}
async function O(e) {
  if (!e.fetchLocalRoster) return e.roster;
  try {
    return S(await e.fetchLocalRoster());
  } catch {
    return e.roster;
  }
}
async function dt(t, n) {
  let { channel: r } = n,
    { wasm: i, devicePrivB64: a, devicePubB64: o } = t;
  r.send(o);
  try {
    let s = await e(r.recv(), ut, `roster-auth`);
    return t.skipPeer?.(s)
      ? (t.report(`${s.slice(0, 8)} is on the local link, not over the relay`),
        n.skip ? n.skip() : n.close(),
        null)
      : D(await O(t), s)
        ? {
            peerPub: s,
            sessionId: (
              await e(
                o < s
                  ? ct(i, r, () => i.handshake_start_initiator(a, s))
                  : lt(i, r, () => i.handshake_start_responder(a, s)),
                ut,
                `handshake`,
              )
            ).sessionId,
          }
        : (t.report(`⚠ ${s.slice(0, 8)} not in roster, ignoring`),
          n.close(),
          null);
  } catch (e) {
    return (t.report(`handshake failed: ${e.message}`), n.close(), null);
  }
}
var k = 32768,
  A = 8;
function ft(e) {
  if (e <= 32) return 32;
  let t = 1 << (Math.floor(Math.log2(e - 1)) + 1),
    n = t <= 256 ? 32 : t / 8;
  return n * (Math.floor((e - 1) / n) + 1);
}
function pt(e) {
  let t = e.length.toString(16).padStart(A, `0`),
    n = ft(A + e.length);
  return t + e + `0`.repeat(n - A - e.length);
}
function mt(e) {
  let t = Number.parseInt(e.slice(0, A), 16);
  return e.slice(A, A + t);
}
function ht(e, t) {
  let n = Math.max(1, Math.ceil(t.length / k)),
    r = [];
  for (let i = 0; i < n; i++)
    r.push({ msgId: e, idx: i, total: n, chunk: t.slice(i * k, (i + 1) * k) });
  return r;
}
var gt = (e) =>
  Number.isInteger(e.msgId) &&
  Number.isInteger(e.total) &&
  e.total >= 1 &&
  e.total <= 16 &&
  Number.isInteger(e.idx) &&
  e.idx >= 0 &&
  e.idx < e.total &&
  typeof e.chunk == `string` &&
  e.chunk.length <= 32768;
function _t(e) {
  let t = new Map();
  return (n) => {
    if (!gt(n)) return;
    let r = t.get(n.msgId);
    if (!r)
      (t.size >= 8 && t.delete(t.keys().next().value),
        (r = { parts: Array(n.total), have: 0, total: n.total }),
        t.set(n.msgId, r));
    else if (r.total !== n.total) return;
    (r.parts[n.idx] === void 0 && ((r.parts[n.idx] = n.chunk), r.have++),
      r.have === r.total && (t.delete(n.msgId), e(r.parts.join(``))));
  };
}
var vt = 6e4;
function yt({
  initiator: e,
  iceServers: t,
  onSignal: n,
  onOpen: r,
  onMessage: i,
  onClose: a,
  onState: o,
}) {
  let s = new RTCPeerConnection({ iceServers: t ?? [] }),
    c = null,
    l = !1,
    u = [],
    d = !1,
    f = () => {
      if (!d) {
        ((d = !0), clearTimeout(p));
        try {
          c?.close();
        } catch {}
        (s.close(), a());
      }
    },
    p = setTimeout(() => {
      (o?.(`not connected, giving up`), f());
    }, vt),
    m = (e) => {
      ((c = e),
        (e.onopen = () => {
          (clearTimeout(p), r());
        }),
        (e.onmessage = (e) => i(typeof e.data == `string` ? e.data : ``)),
        (e.onclose = f));
    },
    h = 0;
  ((s.onicecandidate = (e) => {
    e.candidate
      ? (h++, n({ kind: `candidate`, candidate: e.candidate.toJSON() }))
      : o?.(`gathered ${h} candidate(s)`);
  }),
    (s.onconnectionstatechange = () => {
      (o?.(`conn ${s.connectionState}`),
        (s.connectionState === `failed` || s.connectionState === `closed`) &&
          f());
    }),
    (s.oniceconnectionstatechange = () => {
      (o?.(`ice ${s.iceConnectionState}`),
        s.iceConnectionState === `failed` && f());
    }),
    e
      ? (m(s.createDataChannel(`sync`)),
        (async () => {
          try {
            let e = await s.createOffer();
            (await s.setLocalDescription(e),
              e.sdp && n({ kind: `offer`, sdp: e.sdp }),
              o?.(`offer sent`));
          } catch (e) {
            (o?.(`offer error: ${e.message}`), f());
          }
        })())
      : (s.ondatachannel = (e) => m(e.channel)));
  let g = async () => {
    l = !0;
    for (let e of u.splice(0)) await s.addIceCandidate(e).catch(() => {});
  };
  return {
    async handleSignal(e) {
      try {
        if (e.kind === `offer`) {
          (o?.(`offer received`),
            await s.setRemoteDescription({ type: `offer`, sdp: e.sdp }),
            await g());
          let t = await s.createAnswer();
          (await s.setLocalDescription(t),
            t.sdp && n({ kind: `answer`, sdp: t.sdp }),
            o?.(`answer sent`));
        } else
          e.kind === `answer`
            ? (await s.setRemoteDescription({ type: `answer`, sdp: e.sdp }),
              await g(),
              o?.(`answer applied`))
            : l
              ? await s.addIceCandidate(e.candidate).catch(() => {})
              : u.push(e.candidate);
      } catch (t) {
        (o?.(`signal error (${e.kind}): ${t.message}`),
          e.kind === `offer` && f());
      }
    },
    send(e) {
      c?.readyState === `open` && c.send(e);
    },
    close: f,
  };
}
var bt = 1e3,
  xt = 3e4,
  St = 32,
  Ct = () => Math.floor(Date.now() / 1e3),
  j = (e) => e.slice(0, 8),
  wt = (e) => {
    try {
      return new URL(e).host;
    } catch {
      return e;
    }
  },
  M = null;
function Tt() {
  if (M !== null) return M;
  try {
    typeof RTCPeerConnection > `u`
      ? (M = !1)
      : (new RTCPeerConnection().close(), (M = !0));
  } catch {
    M = !1;
  }
  return M;
}
var Et = 1e4,
  Dt = 36e5,
  Ot = 6e4,
  kt = () => Math.floor(Date.now() / Dt),
  At = 3e4,
  jt = class {
    opts;
    peers = new Map();
    pendingPeers = new Map();
    relayPeers = new Map();
    known = new Set();
    skipped = new Set();
    early = new Map();
    socket;
    client;
    epoch = 0;
    rooms = [];
    publishRoom = ``;
    rollTimer;
    announceTimer;
    clockWarned = !1;
    rejectionWarned = !1;
    stopped = !1;
    reconnectTimer;
    attempts = 0;
    constructor(e) {
      this.opts = e;
    }
    async roll() {
      let { groupKey: e, roomLabel: t, epochRooms: n } = this.opts;
      n
        ? ((this.epoch = kt()),
          (this.publishRoom = await g(e, t, this.epoch)),
          (this.rooms = [this.publishRoom, await g(e, t, this.epoch - 1)]))
        : ((this.publishRoom = await g(e, t)),
          (this.rooms = [this.publishRoom]));
    }
    async start() {
      let e = this.opts.relayUrl;
      if (!Ee(e))
        throw Error(`the relay URL isn't valid: check it under Advanced`);
      await this.roll();
      let t = wt(e);
      this.socket = new WebSocket(e);
      let n = !1,
        r = !1,
        i = (e) => {
          r || ((r = !0), this.opts.onStatus(e));
        },
        a = setTimeout(() => {
          if (!n) {
            i(
              `relay unreachable — no response from ${t} (check this device's network access)`,
            );
            try {
              this.socket.close();
            } catch {}
          }
        }, Et);
      ((this.socket.onerror = () => {
        n || this.opts.onStatus(`relay connection error (${t})`);
      }),
        (this.socket.onclose = (e) => {
          clearTimeout(a);
          let r = e?.code;
          (i(
            n
              ? `relay disconnected`
              : `relay unreachable${r ? ` (code ${r})` : ``} — couldn't reach ${t}`,
          ),
            this.scheduleReconnect());
        }),
        (this.client = o(
          this.socket,
          this.rooms,
          (e) => this.onEvent(e),
          () => {
            ((n = !0),
              (this.attempts = 0),
              clearTimeout(a),
              this.opts.onStatus(`relay connected (${t})`));
          },
          (e) => {
            this.rejectionWarned ||
              ((this.rejectionWarned = !0),
              this.opts.onStatus(`relay refused an event: ${e.slice(0, 200)}`));
          },
        )),
        this.sendHello(),
        this.opts.epochRooms &&
          !this.rollTimer &&
          (this.rollTimer = setInterval(() => void this.maybeRoll(), Ot)),
        (this.announceTimer ||= setInterval(() => this.announce(), At)));
    }
    announce() {
      for (let e of this.known)
        this.peers.has(e) ||
          this.pendingPeers.has(e) ||
          this.relayPeers.has(e) ||
          this.known.delete(e);
      this.sendHello();
    }
    async maybeRoll() {
      this.opts.epochRooms &&
        kt() !== this.epoch &&
        (await this.roll(),
        this.client.resubscribe(this.rooms),
        this.sendHello());
    }
    scheduleReconnect() {
      if (this.stopped || this.reconnectTimer) return;
      let e = Math.min(xt, bt * 2 ** this.attempts);
      (this.attempts++,
        (this.reconnectTimer = setTimeout(() => {
          ((this.reconnectTimer = void 0),
            !this.stopped &&
              (this.opts.onStatus(`reconnecting to the relay…`),
              this.start().catch((e) => {
                (this.opts.onStatus(`relay reconnect failed: ${String(e)}`),
                  this.scheduleReconnect());
              })));
        }, e)));
    }
    stop() {
      ((this.stopped = !0),
        this.reconnectTimer && clearTimeout(this.reconnectTimer),
        this.rollTimer && clearInterval(this.rollTimer),
        this.announceTimer && clearInterval(this.announceTimer));
      for (let e of this.peers.values()) e.close();
      for (let e of this.relayPeers.values()) e.close();
      this.client?.close();
    }
    async publish(e) {
      try {
        let t = await te(this.opts.groupKey, JSON.stringify(e)),
          n = await ue(this.opts.signer.signer, this.publishRoom, t, Ct());
        this.client.publish(n);
      } catch (e) {
        this.opts.onStatus(`publish failed: ${e.message}`);
      }
    }
    sendHello() {
      this.publish({ kind: `hello`, rtc: Tt() });
    }
    checkClockSkew(e) {
      if (this.clockWarned) return;
      let t = ie(Ct(), e.created_at);
      t !== null &&
        ((this.clockWarned = !0),
        this.opts.onStatus(
          `⚠ clock skew: this device is ~${t} min ahead of a peer — check its date & time, or your synced changes may be dropped`,
        ));
    }
    onEvent(e) {
      this.handleEvent(e);
    }
    async handleEvent(e) {
      if (e.pubkey === this.opts.signer.pubkeyHex) return;
      if (!(await l(this.opts.signer.verifier, e))) {
        this.opts.onStatus(`ignored bad-signature event from ${j(e.pubkey)}`);
        return;
      }
      this.checkClockSkew(e);
      let t;
      try {
        t = JSON.parse(await h(this.opts.groupKey, e.content));
      } catch {
        return;
      }
      if (t.kind === `hello`) return this.discover(e.pubkey, t.rtc === !0);
      if (!(t.to && t.to !== this.opts.signer.pubkeyHex)) {
        if (t.kind === `data`)
          return this.opts.webrtcOnly ? void 0 : this.routeData(e.pubkey, t);
        await this.routeSignal(e.pubkey, t);
      }
    }
    async discover(e, t) {
      if (this.known.has(e) || this.skipped.has(e)) return;
      (this.known.add(e),
        this.opts.onPeerState?.(e, `found`),
        this.sendHello());
      let n = this.opts.signer.pubkeyHex < e;
      if (Tt() && t) {
        if (n) {
          this.opts.onStatus(`peer ${j(e)} found — initiating (webrtc)`);
          try {
            await this.makePeer(e, !0);
          } catch (e) {
            this.opts.onStatus(`peer setup failed: ${e.message}`);
          }
        } else
          this.opts.onStatus(`peer ${j(e)} found — awaiting offer (webrtc)`);
      } else
        this.opts.webrtcOnly
          ? this.opts.onStatus(
              `peer ${j(e)} found, but it needs a WebRTC connection`,
            )
          : (this.opts.onStatus(`peer ${j(e)} found — relay transport`),
            this.ensureRelayPeer(e, n));
    }
    async routeSignal(e, t) {
      if (this.skipped.has(e)) return;
      let n = this.peers.get(e);
      if ((n && t.kind === `offer` && (n.close(), (n = void 0)), !n)) {
        if (t.kind === `candidate` && !this.pendingPeers.has(e)) {
          let n = this.early.get(e) ?? [];
          (n.length < St && n.push(t), this.early.set(e, n));
          return;
        }
        if (t.kind !== `offer` && !this.pendingPeers.has(e)) return;
        this.known.add(e);
        try {
          n = await this.makePeer(e, !1);
        } catch (e) {
          this.opts.onStatus(`peer setup failed: ${e.message}`);
          return;
        }
      }
      if (!this.stopped && (await n?.handleSignal(t), t.kind === `offer`)) {
        let t = this.early.get(e) ?? [];
        this.early.delete(e);
        for (let e of t) this.stopped || (await n?.handleSignal(e));
      }
    }
    makePeer(e, t) {
      let n = this.peers.get(e);
      if (n) return Promise.resolve(n);
      let r = this.pendingPeers.get(e);
      if (r) return r;
      let i = (async () => {
        if (this.stopped) return;
        let n = this.opts.getIceServers
          ? await this.opts.getIceServers((await this.client?.ticket()) ?? null)
          : this.opts.iceServers;
        if (!this.stopped) return this.openPeer(e, t, n);
      })().finally(() => this.pendingPeers.delete(e));
      return (this.pendingPeers.set(e, i), i);
    }
    openPeer(e, t, n) {
      let r,
        { channel: i, push: a } = E((e) => r.send(e));
      return (
        (r = yt({
          initiator: t,
          iceServers: n,
          onSignal: (t) => void this.publish({ to: e, ...t }),
          onMessage: a,
          onOpen: () => {
            (this.opts.onPeerState?.(e, `open`),
              this.opts.onPeer({
                remotePubkey: e,
                initiator: t,
                channel: i,
                close: () => r.close(),
                skip: () => {
                  (this.skipped.add(e), r.close());
                },
              }));
          },
          onClose: () => {
            (this.opts.onPeerState?.(e, `closed`),
              this.peers.delete(e),
              this.known.delete(e),
              this.opts.onStatus(`channel closed with ${j(e)}`));
          },
          onState: (t) => this.opts.onStatus(`${j(e)}: ${t}`),
        })),
        this.peers.set(e, r),
        r
      );
    }
    routeData(e, t) {
      this.skipped.has(e) ||
        this.ensureRelayPeer(e, this.opts.signer.pubkeyHex < e).receive(t);
    }
    ensureRelayPeer(e, t) {
      let n = this.relayPeers.get(e);
      if (n) return n;
      let r = 0,
        { channel: i, push: a } = E((t) => {
          let n = r++;
          for (let r of ht(n, pt(t)))
            this.publish({ kind: `data`, to: e, ...r });
        }),
        o = {
          receive: _t((e) => a(mt(e))),
          close: () => {
            (this.relayPeers.delete(e), this.known.delete(e));
          },
        };
      return (
        this.relayPeers.set(e, o),
        this.opts.onPeer({
          remotePubkey: e,
          initiator: t,
          channel: i,
          close: o.close,
          skip: () => {
            (this.skipped.add(e), o.close());
          },
        }),
        o
      );
    }
  };
async function Mt(e) {
  let t = new jt(e);
  return (await t.start(), t);
}
var Nt = `bramble-relay.flythenimbus.workers.dev`;
function Pt(e) {
  try {
    return new URL(e).host === Nt;
  } catch {
    return !1;
  }
}
async function Ft(e, t) {
  let n = await e.nostr_generate_key(),
    r = ve(n.publicKey),
    i = Pt(t),
    a = async (e) => {
      let t = C(e),
        n = C(await xe(ce(e)));
      return i ? [n, t] : [t, n];
    };
  return {
    pubkeyHex: r,
    signer: {
      pubkeyHex: r,
      sign: async (t) => {
        let [r] = await a(t);
        return ve(await e.nostr_sign(n.secretKey, r));
      },
    },
    verifier: {
      verify: async (t, n, r) => {
        let [i, o] = await a(n),
          s = C(t),
          c = C(r);
        return (await e.nostr_verify(s, i, c)) || e.nostr_verify(s, o, c);
      },
    },
  };
}
async function N(e) {
  if (e.peerSource) {
    let t = await e.peerSource({
        onPeer: (t) =>
          void e.onPeer(t).catch((t) => e.report(`peer error: ${String(t)}`)),
        report: e.report,
      }),
      n = !1;
    return {
      stop() {
        n || ((n = !0), e.onStop?.(), t.stop());
      },
    };
  }
  let t = e.join ?? Mt,
    n = e.fetchIce ?? Ce,
    r = await t({
      relayUrl: e.relayUrl,
      groupKey: b(e.groupKeyB64),
      roomLabel: e.roomLabel,
      signer: await Ft(e.wasm, e.relayUrl),
      getIceServers: async (t) => {
        let r = e.iceUrl || Te(e.relayUrl),
          i = await n(r, we(r, e.relayUrl) ? t : null);
        return (
          e.report(
            i.length ? `ICE: relay servers ready` : `ICE: direct (host) only`,
          ),
          i
        );
      },
      epochRooms: e.epochRooms,
      webrtcOnly: e.webrtcOnly,
      onPeerState: e.onPeerState,
      onStatus: e.report,
      onPeer: (t) =>
        void e.onPeer(t).catch((t) => e.report(`peer error: ${String(t)}`)),
    }),
    i = !1;
  return {
    stop() {
      i || ((i = !0), e.onStop?.(), r.stop());
    },
  };
}
var It = 32768,
  Lt = new TextEncoder(),
  Rt = new TextDecoder();
function zt(e, t) {
  let n = Lt.encode(e);
  if (n.length <= t) return [e];
  let r = [];
  for (let e = 0; e < n.length;) {
    let i = Math.min(e + t, n.length);
    for (; i < n.length && (n[i] & 192) == 128 && i > e;) i--;
    (r.push(Rt.decode(n.subarray(e, i))), (e = i));
  }
  return r;
}
function Bt(e) {
  if (e.charCodeAt(0) !== 123) return null;
  try {
    let t = JSON.parse(e);
    if (
      typeof t.i == `number` &&
      typeof t.n == `number` &&
      typeof t.c == `string`
    )
      return t;
  } catch {}
  return null;
}
async function P(e, t, n, r) {
  let i = zt(r, It);
  if (i.length === 1) {
    e.send(await t.handshake_encrypt(n, i[0]));
    return;
  }
  let a = i.length;
  for (let r = 0; r < a; r++) {
    let o = await t.handshake_encrypt(n, i[r]);
    e.send(JSON.stringify({ i: r, n: a, c: o }));
  }
}
async function F(e, t, n) {
  let r = await e();
  if (r === null) return null;
  let i = Bt(r);
  if (!i) return t.handshake_decrypt(n, r);
  let a = await t.handshake_decrypt(n, i.c);
  for (let r = 1; r < i.n; r++) {
    let i = await e();
    if (i === null) return null;
    let o = Bt(i);
    if (!o || o.i !== r)
      throw Error(
        `secure channel: expected frame ${r}, got ${o ? o.i : `non-frame`}`,
      );
    a += await t.handshake_decrypt(n, o.c);
  }
  return a;
}
var Vt = 1048576,
  Ht = 23552,
  Ut = 3e4,
  Wt = 3e4,
  Gt = 1e4,
  Kt = 12e4;
function qt(e) {
  let t = new Map();
  for (let n of re(e)) t.set(n.hash, n.size);
  return [...t].map(([e, t]) => ({ hash: e, size: t }));
}
function Jt(e, t) {
  if (t.active?.hash === e) {
    let { from: e, received: n, size: r } = t.active;
    return { state: `downloading`, from: t.device(e), received: n, size: r };
  }
  let n = t.peers.filter((t) => t.has.has(e)),
    r = n.find((n) => (t.passOver.get(`${n.pub}:${e}`) ?? 0) <= t.now);
  return r
    ? { state: `queued`, from: t.device(r.pub) }
    : n[0]
      ? { state: `retrying`, from: t.device(n[0].pub) }
      : t.unreachable
        ? { state: `unreachable` }
        : t.peers.length > 0
          ? { state: `not-on-connected` }
          : t.linkOnly
            ? { state: `desktop-only` }
            : { state: `waiting` };
}
var Yt = 2e4,
  Xt = 12e4,
  Zt = /^[0-9a-f]{64}$/;
function Qt(e) {
  let t;
  try {
    t = JSON.parse(e);
  } catch {
    return null;
  }
  if (!t || typeof t != `object`) return null;
  let n = t,
    r = (e) => typeof e == `string` && Zt.test(e),
    i = (e) => typeof e == `number` && Number.isSafeInteger(e) && e >= 0;
  switch (n.t) {
    case `have`:
      return Array.isArray(n.h) ? { t: `have`, h: n.h.filter(r) } : null;
    case `want`:
      return r(n.h) && i(n.o) && i(n.n) && n.n <= 1048576
        ? { t: `want`, h: n.h, o: n.o, n: n.n }
        : null;
    case `data`:
      return r(n.h) && i(n.o) && typeof n.d == `string`
        ? { t: `data`, h: n.h, o: n.o, d: n.d }
        : null;
    case `nope`:
      return r(n.h) ? { t: `nope`, h: n.h } : null;
    default:
      return null;
  }
}
async function $t(e) {
  let t = new Map(),
    n = new Set(),
    r = new Map(),
    i = null,
    a = new Map(),
    o = !1,
    s = !1,
    c = new Map(),
    l = (e, t) => {
      let n = Date.now();
      c.set(e, { firstAt: c.get(e)?.firstAt ?? n, at: n, open: t === `open` });
    },
    u = async () => {
      let t = n,
        r = await e.blobs.list();
      return ((n = new Set(r)), n.size !== t.size || r.some((e) => !t.has(e)));
    },
    d = async () => {
      (await u(),
        (r = new Map((await e.wanted()).map((e) => [e.hash, e.size]))));
    },
    f = () => ({ t: `have`, h: [...n] }),
    p = 0,
    m = async () => {
      p = Date.now();
      let e = f();
      for (let n of t.values()) await n.send(e).catch(() => {});
    },
    h = () => {
      if (s || o) return;
      let e = Date.now();
      for (let [i, c] of r) {
        if (n.has(i)) continue;
        let r = [...t.values()].find(
          (t) => t.has.has(i) && (a.get(`${t.pub}:${i}`) ?? 0) <= e,
        );
        if (r) {
          ((s = !0),
            g(i, c, r).finally(() => {
              ((s = !1), o || h());
            }));
          return;
        }
      }
    },
    g = async (t, r, s) => {
      let c;
      try {
        c = await e.blobs.receive(t);
      } catch {
        await d();
        return;
      }
      let l = {
        hash: t,
        peer: s,
        offset: c.resumeFrom,
        windowEnd: c.resumeFrom,
        pending: [],
        settle: null,
      };
      i = l;
      let u = (n) => {
        (e.report(`file ${t.slice(0, 8)} from ${s.pub.slice(0, 8)}: ${n}`),
          a.set(`${s.pub}:${t}`, Date.now() + Kt));
      };
      try {
        for (; l.offset < r && !o;) {
          let e = Math.min(Vt, r - l.offset);
          l.windowEnd = l.offset + e;
          let n = new Promise((e) => {
              l.settle = e;
            }),
            i = setTimeout(() => l.settle?.(!1), Ut);
          await s.send({ t: `want`, h: t, o: l.offset, n: e });
          let a = await n;
          if ((clearTimeout(i), (l.settle = null), !a)) {
            u(`stopped before the file was complete`);
            return;
          }
          let o = new Uint8Array(l.offset - (l.windowEnd - e)),
            d = 0;
          for (let e of l.pending) (o.set(e, d), (d += e.length));
          ((l.pending = []), await c.append(o));
        }
        if (o) return;
        (await c.commit(),
          n.add(t),
          e.report(`received file ${t.slice(0, 8)} (${r} bytes)`),
          e.onReceived?.(t),
          m());
      } catch (e) {
        u(`rejected: ${e.message}`);
      } finally {
        i === l && (i = null);
      }
    },
    ee = async (e, t) => {
      let n = i;
      if (!n || n.peer !== e || n.hash !== t.h || !n.settle) return;
      let r = b(t.d);
      t.o !== n.offset || n.offset + r.length > n.windowEnd
        ? n.settle(!1)
        : (n.pending.push(r),
          (n.offset += r.length),
          n.offset === n.windowEnd && n.settle(!0));
    },
    te = async (t, n) => {
      if (!D(await O(e), t.pub)) {
        t.close();
        return;
      }
      let r = await e.blobs.size(n.h);
      if (r === null || n.o >= r) {
        await t.send({ t: `nope`, h: n.h });
        return;
      }
      let i = await e.blobs.read(n.h, n.o, Math.min(n.n, r - n.o));
      for (let e = 0; e < i.length; e += Ht) {
        let r = i.subarray(e, e + Ht);
        await t.send({ t: `data`, h: n.h, o: n.o + e, d: x(r) });
      }
    },
    ne = async (n, r) => {
      let a = await dt(
        e.relay !== !1 && r === 0 ? e : { ...e, skipPeer: void 0 },
        n,
      );
      if (!a || o) return;
      let { peerPub: s, sessionId: c } = a,
        l = `${r}:${s}`,
        u = n.channel,
        d = Promise.resolve(),
        p = null,
        m = new Promise((e) => {
          p = () => e(null);
        }),
        g = {
          key: l,
          pub: s,
          has: new Set(),
          lastSeen: Date.now(),
          send(t) {
            let n = d.then(() => P(u, e.wasm, c, JSON.stringify(t)));
            return ((d = n.catch(() => {})), n);
          },
          close() {
            (p?.(),
              n.close(),
              t.get(l) === g && t.delete(l),
              i?.peer === g && i.settle?.(!1));
          },
        };
      (t.get(l)?.close(),
        t.set(l, g),
        n.onGone?.(() => g.close()),
        e.report(`file peer ${s.slice(0, 8)} connected`),
        await g.send(f()));
      let ne = () => Promise.race([u.recv(), m]);
      for (;;) {
        let t;
        try {
          t = await F(ne, e.wasm, c);
        } catch {
          break;
        }
        if (t === null || o) break;
        g.lastSeen = Date.now();
        let n = Qt(t);
        n &&
          (n.t === `have`
            ? ((g.has = new Set(n.h)), h())
            : n.t === `want`
              ? await te(g, n).catch(() => {})
              : n.t === `data`
                ? await ee(g, n)
                : n.t === `nope` &&
                  (g.has.delete(n.h),
                  i?.peer === g && i.hash === n.h && i.settle?.(!1)));
      }
      g.close();
    };
  await d();
  let re = () => {
      ((o = !0), clearInterval(y), i?.settle?.(!1));
      for (let e of [...t.values()]) e.close();
      t.clear();
    },
    _ = [...(e.relay === !1 ? [] : [void 0]), ...(e.localSources ?? [])],
    v = [];
  for (let [t, n] of _.entries())
    try {
      v.push(
        await N({
          relayUrl: e.relayUrl,
          iceUrl: e.iceUrl,
          groupKeyB64: e.groupKeyB64,
          roomLabel: `bramble/blob`,
          wasm: e.wasm,
          report: e.report,
          epochRooms: !0,
          webrtcOnly: !0,
          peerSource: n,
          onPeerState: n ? void 0 : l,
          onPeer: (e) => ne(e, t),
        }),
      );
    } catch (t) {
      e.report(
        `file sync: ${n ? `local link` : `relay`} unavailable: ${t.message}`,
      );
    }
  let y = setInterval(() => {
    let n = Date.now();
    for (let [e, t] of c) n - t.at > Xt && c.delete(e);
    for (let r of [...t.values()])
      n - r.lastSeen > 4 * Wt &&
        (e.report(`file peer ${r.pub.slice(0, 8)} idle, dropping`), r.close());
    u()
      .then((e) => {
        if (e || Date.now() - p >= Wt) return m();
      })
      .catch(() => {});
  }, Gt);
  return {
    stop() {
      if (!o) {
        re();
        for (let e of v) e.stop();
      }
    },
    poke() {
      d()
        .then(m)
        .then(() => h())
        .catch(() => {});
    },
    async status(o) {
      let s = Date.now(),
        l = await O(e),
        u = {
          now: s,
          active: i && {
            hash: i.hash,
            from: i.peer.pub,
            received: i.offset,
            size: r.get(i.hash) ?? i.windowEnd,
          },
          peers: [...t.values()],
          passOver: a,
          unreachable: [...c.values()].some(
            (e) => !e.open && s - e.at < Xt && s - e.firstAt >= Yt,
          ),
          linkOnly: e.relay === !1,
          device: (e) => {
            let t = l.devices.find((t) => t.publicKey === e);
            return t ? { id: t.id, label: t.label } : null;
          },
        },
        d = {};
      for (let e of o) n.has(e) || (d[e] = Jt(e, u));
      return d;
    },
  };
}
var en = 3e4,
  tn = d,
  nn = 6e4,
  rn = 5e3,
  an = `bramble/enroll/received`,
  on = `bramble/enroll/rejected`;
async function sn(e, t) {
  let n = null,
    r,
    i = un(
      e,
      t,
      () => n?.stop(),
      () => {
        (clearTimeout(r),
          e === `inviter` &&
            (r = setTimeout(() => {
              (t.report(
                `nobody confirmed the code in time: generate a new one to add a device`,
              ),
                t.onInviteExpired?.(),
                n?.stop());
            }, tn)));
      },
    );
  return (
    (n = await N({
      relayUrl: t.relayUrl,
      iceUrl: t.iceUrl,
      groupKeyB64: t.groupKeyB64,
      roomLabel: `bramble/enroll`,
      wasm: t.wasm,
      report: t.report,
      onPeer: i,
      onStop: () => clearTimeout(r),
      join: t.join,
      fetchIce: t.fetchIce,
      peerSource: t.peerSource,
    })),
    e === `inviter` &&
      (r = setTimeout(() => {
        (t.report(`invite expired: generate a new code to add a device`),
          t.onInviteExpired?.(),
          n?.stop());
      }, d)),
    t.report(
      e === `inviter`
        ? `waiting for a device to join…`
        : `connecting to inviter…`,
    ),
    n
  );
}
function cn(e, t, n) {
  let r = e.unlock_with_vek(t);
  return r instanceof Promise ? r.then(n) : Promise.resolve(n());
}
function ln(e, t) {
  return {
    generateSalt: () => Promise.resolve(e.generate_salt()),
    generateSlotId: () => Promise.resolve(e.generate_slot_id()),
    wrapVekPassword: (n) =>
      cn(e, t, () =>
        e.wrap_vek_password(n.password, n.saltB64, n.slotIdB64, n.magicVersion),
      ),
    encryptWithVek: (n) => cn(e, t, () => e.encrypt_with_vek(n)),
  };
}
function un(t, n, r, i = () => {}) {
  let a = !1;
  return async (o) => {
    let { channel: s, remotePubkey: c } = o;
    n.report(`channel open with ${c.slice(0, 8)}: authenticating…`);
    let { wasm: l, devicePrivB64: u, psk: d } = n,
      f;
    try {
      f = await e(
        t === `inviter`
          ? lt(l, s, () => l.handshake_enroll_responder(u, d))
          : ct(l, s, () => l.handshake_enroll_initiator(u, d)),
        en,
        `enrollment handshake`,
      );
    } catch (e) {
      (n.report(`⚠ handshake with ${c.slice(0, 8)} failed: ${e.message}`),
        t === `inviter` &&
          n.onEnrollAttemptFailed?.(
            `A device tried to connect but didn't finish. This code still works: try again from the other device.`,
          ),
        o.close());
      return;
    }
    if (t === `joiner`) {
      if (!n.inviterPub)
        throw Error(`enroll: joining without an inviter key to pin`);
      if (f.remoteStatic !== n.inviterPub) {
        (n.report(
          `⚠ ${c.slice(0, 8)} is not the inviter, ignoring (possible MITM)`,
        ),
          o.close());
        return;
      }
      if (!n.ownEntry)
        throw Error(`enroll: joining without a roster entry to present`);
      n.report(
        `authenticated ✅, waiting for confirmation on your other device…`,
      );
      try {
        (await P(s, n.wasm, f.sessionId, JSON.stringify(n.ownEntry)),
          n.onSas?.(await De(n.psk, n.ownEntry.publicKey, f.remoteStatic)),
          await hn(n, o, f));
      } catch (e) {
        (n.report(`⚠ enrollment failed: ${e.message}`),
          o.close(),
          n.onJoinError?.(
            `Pairing didn't complete. Check the code was confirmed on your other device, then generate a new one.`,
          ));
      }
    } else if (a)
      (n.report(
        `⚠ refusing ${c.slice(0, 8)}: this invite has already been used`,
      ),
        o.close());
    else {
      ((a = !0), i(), n.report(`authenticated ✅, identifying the device…`));
      try {
        await dn(n, s, f);
      } finally {
        r();
      }
    }
  };
}
async function dn(e, t, n) {
  if (!e.devicePubB64)
    throw Error(`enroll: refusing to invite without this device's key`);
  if (!e.approve)
    throw Error(`enroll: refusing to invite without an approval gate`);
  let r = await pn(e, t, n);
  if (!r) return;
  let i = await De(e.psk, e.devicePubB64, n.remoteStatic);
  (e.report(`confirm this code matches on the other device: ${i.digits}`),
    (await e.approve(i, r.label))
      ? (e.report(`confirmed ✅, transferring vault…`),
        await mn(e, t, n),
        e.onEnrolled?.(JSON.stringify(r)),
        e.report(`device enrolled ✅`),
        await fn(e, t, n, nn))
      : (e.report(
          `⚠ pairing rejected: this code is now dead, generate a new one`,
        ),
        await P(t, e.wasm, n.sessionId, on),
        await fn(e, t, n, rn)));
}
async function fn(t, n, r, i) {
  try {
    await F(() => e(n.recv(), i, `acknowledgement`), t.wasm, r.sessionId);
  } catch {
    t.report(`note: the other device didn't confirm receipt`);
  }
}
async function pn(t, n, r) {
  let i;
  try {
    i =
      (await F(
        () => e(n.recv(), en, `device introduction`),
        t.wasm,
        r.sessionId,
      )) ?? ``;
  } catch {
    return (
      t.report(
        `⚠ no response: update Bramble on your other device to pair with this one`,
      ),
      t.onEnrollFailed?.(
        `That device didn't respond. It's probably running an older version of Bramble: update it there, then generate a new code.`,
      ),
      null
    );
  }
  let a = null;
  try {
    a = y.parse(JSON.parse(i));
  } catch {
    a = null;
  }
  return !a ||
    a.publicKey !== r.remoteStatic ||
    !oe(t.roster ?? { devices: [], revoked: [] }, a)
    ? (t.report(
        `⚠ the joining device sent an invalid introduction, not enrolling`,
      ),
      t.onEnrollFailed?.(
        `That device couldn't be verified, so nothing was sent. Generate a new code and try again.`,
      ),
      null)
    : a;
}
async function mn(e, t, n) {
  if (!e.vekB64)
    throw Error(`enroll: refusing to send a bundle without an explicit VEK`);
  let r = Se({
    vek: e.vekB64,
    roster: e.roster ?? { devices: [], revoked: [] },
    entries: e.entries ?? { entries: [], tombstones: [] },
    primaryPasswordCheck: e.passwordCheck,
    recoverySlots: e.recoverySlots,
  });
  await P(t, e.wasm, n.sessionId, r);
}
async function hn(t, r, a) {
  let { channel: o } = r,
    s = !0,
    c =
      (await F(
        () => {
          let t = s ? tn : en,
            n = s ? `confirmation on the other device` : `vault transfer`;
          return ((s = !1), e(o.recv(), t, n));
        },
        t.wasm,
        a.sessionId,
      )) ?? ``;
  if (c === `bramble/enroll/rejected`) {
    (t.report(`⚠ the other device rejected this pairing`),
      await P(o, t.wasm, a.sessionId, an),
      r.close(),
      t.onJoinError?.(
        `Your other device didn't confirm this pairing. That code is now used up. Generate a new one there and try again.`,
      ));
    return;
  }
  let l = m(c);
  if (
    l.primaryPasswordCheck &&
    !(await t.wasm.verify_password_slot(
      t.password ?? ``,
      l.primaryPasswordCheck.saltB64,
      l.primaryPasswordCheck.slotIdB64,
      l.primaryPasswordCheck.verifierB64,
      u(),
    ))
  ) {
    (t.report(`⚠ password doesn't match your existing device, aborting`),
      r.close(),
      t.onJoinError?.(
        `That doesn't match your other device's master password.`,
      ));
    return;
  }
  await t.wasm.unlock_with_vek(l.vek);
  let d = ln(t.wasm, l.vek),
    f = await n(d, t.password ?? ``),
    p = (l.recoverySlots ?? []).map((e) => ({
      kind: 3,
      slotId: b(e.slotIdB64),
      salt: b(e.saltB64),
      verifier: b(e.verifierB64),
      wrapIv: b(e.wrapIvB64),
      wrappedVek: b(e.wrappedVekB64),
    })),
    h = await i(d, [f, ...p], l.entries);
  (await P(o, t.wasm, a.sessionId, an),
    t.report(`vault received ✅, finishing setup`),
    t.onJoined?.({ vaultBlobB64: x(h), roster: l.roster }));
}
var gn = 4e3,
  _n = `{}`,
  vn = JSON.stringify({ resend: !0 }),
  yn = 6e5;
async function bn(e) {
  let t = ee(await e.fetchLocalPayload()),
    n = e.fetchLocalRoster ? await e.fetchLocalRoster() : void 0;
  return JSON.stringify({ entries: t, roster: n });
}
async function xn(e, t, n) {
  let r;
  try {
    r = JSON.parse(t);
  } catch {
    return !1;
  }
  return (
    r.resend === !0 ||
    (r.roster && e.pushRemoteRoster && (await Sn(e, r.roster, n)),
    r.entries && (await e.pushRemotePayload(r.entries)),
    !1)
  );
}
async function Sn(e, t, n) {
  let r = n,
    i = -1;
  for (;;) {
    let n = await Cn(e, t, r);
    if (n === null) return;
    let a = S(n).devices.length;
    if (a <= i || (await e.pushRemoteRoster?.(n), a === S(t).devices.length))
      return;
    ((i = a), (r = await O(e)));
  }
}
async function Cn(e, t, n) {
  let i;
  try {
    i = S(t);
  } catch {
    return null;
  }
  let a = e.wasm.roster_verify;
  if (!a) return t;
  let o = n ?? (await O(e)),
    s = new Set(),
    c = new Set();
  for (let e of i.devices) {
    if (e.sigKey && e.sig)
      try {
        (await a(e.sigKey, p(e), e.sig)) && s.add(e);
      } catch {}
    if (e.admission) {
      let t = o.devices.find((t) => t.id === e.admission?.by);
      if (t?.admissionKey)
        try {
          (await a(t.admissionKey, p(e), e.admission.sig)) && c.add(e);
        } catch {}
    }
  }
  return ae(
    ye(
      o,
      i,
      (e) => s.has(e),
      (e) => c.has(e),
      {
        signatures: r.rosterRequireSignatures,
        admission: r.rosterRequireAdmission,
      },
    ),
  );
}
var wn = 5 * gn;
async function Tn(e) {
  let t = new Map(),
    n,
    r = await N({
      relayUrl: e.relayUrl,
      iceUrl: e.iceUrl,
      groupKeyB64: e.groupKeyB64,
      roomLabel: `bramble/sync`,
      wasm: e.wasm,
      report: e.report,
      epochRooms: !0,
      peerSource: e.peerSource,
      onPeer: (n) => kn(e, n, t),
      onStop: () => {
        n && clearInterval(n);
        for (let e of t.values()) e.close();
        t.clear();
      },
    });
  return (
    (n = setInterval(() => {
      (On(e, t), Dn(e, t));
    }, gn)),
    e.report(`syncing — listening for peers…`),
    { ...r, broadcastNow: () => Dn(e, t) }
  );
}
function En(e, t, n) {
  for (let [r, i] of t)
    D(n, r) ||
      (e.report(`peer ${r.slice(0, 8)} revoked — disconnecting`),
      i.close(),
      t.delete(r));
}
async function Dn(e, t) {
  if (t.size === 0 || (En(e, t, await O(e)), t.size === 0)) return;
  let n = await bn(e),
    r = Date.now();
  for (let e of t.values()) {
    let t = e.lastSent !== n || r - e.lastFullAt >= yn;
    (t && ((e.lastSent = n), (e.lastFullAt = r)), await e.send(t ? n : _n));
  }
}
function On(e, t, n = Date.now()) {
  for (let [r, i] of t)
    n - i.lastSeen > wn &&
      (e.report(`peer ${r.slice(0, 8)} idle — dropping`),
      i.close(),
      t.delete(r));
}
async function kn(e, t, n) {
  let { channel: r } = t,
    { wasm: i } = e,
    a = await dt(e.peerSource ? { ...e, skipPeer: void 0 } : e, t);
  if (!a) return;
  let { peerPub: o } = a;
  e.onAuthenticated?.(o, t.remotePubkey);
  let s = { sessionId: a.sessionId },
    c = null,
    l = new Promise((e) => {
      c = () => e(null);
    }),
    u = Promise.resolve(),
    d = {
      channel: r,
      sessionId: s.sessionId,
      lastSeen: Date.now(),
      close: () => {
        (c?.(), t.close());
      },
      send: (e) => {
        let t = u.then(() => P(r, i, s.sessionId, e));
        return ((u = t.catch(() => {})), t);
      },
      lastSent: null,
      lastFullAt: 0,
    };
  (n.set(o, d),
    t.onGone?.(() => {
      (n.get(o) === d && n.delete(o), d.close());
    }),
    e.report(`synced with ${o.slice(0, 8)} ✅`));
  let f = await bn(e);
  ((d.lastSent = f), (d.lastFullAt = Date.now()), await d.send(f));
  let p = () => Promise.race([r.recv(), l]);
  for (;;) {
    let t = await F(p, i, s.sessionId);
    if (t === null) break;
    d.lastSeen = Date.now();
    let r = await O(e);
    if (!D(r, o)) {
      (d.close(), n.delete(o));
      break;
    }
    try {
      (await xn(e, t, r)) && (d.lastSent = null);
    } catch (t) {
      (e.report(
        `merge from ${o.slice(0, 8)} failed, asking again: ${String(t)}`,
      ),
        await d.send(vn).catch(() => {}));
    }
    En(e, n, await O(e));
  }
}
var I = 262144;
async function An(e, t) {
  let n = await _(t.handoff);
  if (!n) throw Error(`the file to attach is no longer staged`);
  e.unlock_with_vek(t.vekB64);
  let r = new e.FileSealStream(t.metaJson),
    i = T(t.vaultId),
    a = `seal-${globalThis.crypto.randomUUID()}`;
  try {
    let e = Math.max(1, Math.ceil(n.size / I));
    for (let t = 0; t < e; t++) {
      let o = n.slice(t * I, (t + 1) * I),
        s = new Uint8Array(await o.arrayBuffer()),
        c = r.seal_next(s, t === e - 1);
      (s.fill(0), await i.appendStaged(a, c));
    }
    let o = r.finish();
    return (await s(t.vaultId, a, o.hash), o);
  } catch (e) {
    throw (await i.discardStaged(a).catch(() => {}), e);
  } finally {
    r.free();
  }
}
async function jn(e, t) {
  let n = T(t.vaultId),
    r = await n.size(t.hash);
  if (r === null)
    throw Error(`this attachment's file isn't on this device yet`);
  e.unlock_with_vek(t.vekB64);
  let i = new e.FileOpenStream(t.wrappedFek, t.fekIv, t.noncePrefix, r),
    a = [];
  try {
    for (let e = i.next_range(); e; e = i.next_range()) {
      let [r, o] = e;
      a.push(i.open_next(await n.read(t.hash, r, o)));
    }
  } finally {
    i.free();
  }
  return w(new Blob(a, { type: `application/octet-stream` }));
}
async function Mn(e, t) {
  let n = T(t.vaultId);
  for (let e of t.files)
    if ((await n.size(e.hash)) !== e.size)
      throw Error(`an attachment hasn't reached this device yet`);
  let r = new e.KdbxWriter(t.password),
    i = [];
  try {
    e.unlock_with_vek(t.vekB64);
    for (let n of t.files)
      i.push({
        entry: n.entry,
        hash: n.hash,
        name: n.name,
        stream: new e.FileOpenStream(
          n.wrappedFek,
          n.fekIv,
          n.noncePrefix,
          n.size,
        ),
      });
    let a = [],
      o = () => {
        let e = r.take();
        e.length > 0 && a.push(new Blob([e]));
      };
    o();
    let s = new Map();
    for (let e of i) {
      let t = r.begin_binary(e.stream.plaintext_len());
      for (let t = e.stream.next_range(); t; t = e.stream.next_range()) {
        let [i, a] = t,
          s = e.stream.open_next(await n.read(e.hash, i, a));
        (r.write_binary(s), s.fill(0), o());
      }
      s.set(e.entry, [...(s.get(e.entry) ?? []), { name: e.name, index: t }]);
    }
    let c = t.entries.map((e, t) => ({ ...e, binaries: s.get(t) ?? [] }));
    return (
      a.push(new Blob([r.finish(c)])),
      w(new Blob(a, { type: `application/octet-stream` }))
    );
  } finally {
    for (let e of i) e.stream.free();
    r.free();
  }
}
var L = new Map(),
  Nn = 3e5;
async function Pn(e) {
  let t;
  if (
    (e.body && `inline` in e.body && (t = b(e.body.inline)),
    e.body && `handoff` in e.body)
  ) {
    let n = await _(e.body.handoff);
    if (!n) throw Error(`the request body is no longer staged`);
    t = n;
  }
  let n = globalThis.crypto.randomUUID();
  L.set(n, { done: !1 });
  let r = (e) => {
    (L.set(n, e), setTimeout(() => L.delete(n), Nn));
  };
  return (
    fetch(e.url, {
      method: e.method,
      headers: e.headers,
      body: t,
      credentials: `omit`,
      redirect: `manual`,
    })
      .then(async (e) =>
        r({
          done: !0,
          status: e.status,
          body: x(new Uint8Array(await e.arrayBuffer())),
        }),
      )
      .catch((e) =>
        r({ done: !0, error: e instanceof Error ? e.message : String(e) }),
      ),
    n
  );
}
function Fn(e) {
  let t = L.get(e);
  return t
    ? (t.done && L.delete(e), t)
    : {
        done: !0,
        error: `the request was lost when the crypto host restarted`,
      };
}
var In = 3e4,
  Ln = `desktop`;
function Rn(e, { eager: t = !1 } = {}) {
  return async ({ onPeer: n, report: r }) => {
    let i = null,
      a = null,
      o = 0,
      s = !1,
      c = () => {
        if (s || i || Date.now() < o) return;
        let { channel: t, push: c } = E((t) => {
          e.send(t).then((e) => {
            e || (i = null);
          });
        });
        ((i = c),
          r(`desktop app offered as a sync peer`),
          n({
            remotePubkey: Ln,
            initiator: !0,
            channel: t,
            close: () => {
              i === c && ((i = null), (o = Date.now() + In));
            },
            onGone: (e) => {
              a = e;
            },
          }));
      },
      l = e.subscribe((e) => {
        (i || c(), i?.(e));
      });
    t && c();
    let u = e.subscribeDown?.(() => {
      i = null;
      let e = a;
      ((a = null), e?.());
    });
    return {
      stop() {
        ((s = !0), (i = null), l(), u?.());
      },
    };
  };
}
var R = null;
function zn() {
  return (
    R ||
    ((R = (async () => {
      let e = await import(chrome.runtime.getURL(`wasm/vault_crypto.js`));
      return (
        await e.default(c.runtime.getURL(`wasm/vault_crypto_bg.wasm`)),
        e
      );
    })()),
    R)
  );
}
var Bn = t({
    addEnrolledToLocalRoster: () => tr,
    clearClipboard: () => $n,
    handleHostMessage: () => nr,
    setSyncBridge: () => Hn,
  }),
  Vn = null;
function Hn(e) {
  Vn = e;
}
var Un = {
    fetchLocalPayload: async () => {
      throw Error(`sync bridge not registered`);
    },
    pushRemotePayload: async () => {},
    fetchLocalRoster: async () => ``,
    pushRemoteRoster: async () => {},
  },
  z = null,
  Wn = 2e3,
  B = null,
  V = null,
  H = null,
  U = null,
  W = null,
  G = Promise.resolve();
function Gn(e) {
  return JSON.stringify([
    e.vaultId,
    e.relayUrl,
    e.iceUrl ?? ``,
    e.groupKeyB64,
    e.devicePubB64,
  ]);
}
function Kn() {
  (B?.stop(),
    (B = null),
    V?.stop(),
    (V = null),
    H?.stop(),
    (H = null),
    (U = null),
    (W = null));
}
async function qn(e, t) {
  let n = Gn(e);
  if (B && V && U === n) return;
  let r = await Q();
  Kn();
  let i = {
      ...e,
      wasm: r,
      report: X,
      fetchLocalPayload: () => t.fetchLocalPayload(e.vaultId),
      pushRemotePayload: async (n) => {
        (await t.pushRemotePayload(e.vaultId, n), H?.poke());
      },
      fetchLocalRoster: () => t.fetchLocalRoster(e.vaultId),
      pushRemoteRoster: (n) => t.pushRemoteRoster(e.vaultId, n),
    },
    a = await Promise.race([
      t.linkDesktopSyncKey?.().catch(() => null) ?? Promise.resolve(null),
      new Promise((e) => setTimeout(() => e(null), Wn)),
    ]),
    o = (e) => e === a;
  ((B = await Tn({ ...i, skipPeer: o })),
    (V = await Tn({
      ...i,
      onAuthenticated: (n) => {
        ((a = n), t.linkAuthenticated?.(e.vaultId));
      },
      peerSource: Rn({
        send: (e) => t.linkSend?.(e) ?? Promise.resolve(!1),
        subscribe: (e) => Jn(`sync`, e),
        subscribeDown: (e) => (Yn.add(e), () => Yn.delete(e)),
      }),
    })),
    (H = await $t({
      ...i,
      blobs: ne(e.vaultId),
      wanted: async () => qt(v(await t.fetchLocalPayload(e.vaultId))),
      onReceived: () => t.blobArrived?.(),
      relay: typeof RTCPeerConnection < `u`,
      skipPeer: o,
      localSources: [
        ot({
          up: () => t.linkBlobUp?.() ?? Promise.resolve(!1),
          send: (e, n) => t.linkBlobSend?.(e, n) ?? Promise.resolve(!1),
          subscribe: (e) => (q.add(e), () => q.delete(e)),
        }),
      ],
    })),
    (U = n),
    (W = e.vaultId));
}
var K = new Map();
function Jn(e, t) {
  let n = K.get(e) ?? new Set();
  return (K.set(e, n), n.add(t), () => n.delete(t));
}
var q = new Set(),
  Yn = new Set(),
  J = null;
function Y(e) {
  let t = J;
  ((J = null), t?.settle(e));
}
function X(e) {
  console.log(`[bramble:sync]`, e);
  let t = { status: e, at: Date.now() };
  c.runtime.sendMessage({ type: `SYNC_STATUS`, payload: t }).catch(() => {});
}
function Z(e) {
  c.runtime.sendMessage({ type: `SYNC_EVENT`, payload: e }).catch(() => {});
}
var Xn = null;
async function Q() {
  return ((Xn ||= await zn()), Xn);
}
var Zn = rt(Q);
function $(e, t, n) {
  return (t !== void 0 && e.unlock_with_vek(t), n(e));
}
async function Qn(e, t, n) {
  switch (t) {
    case `CRYPTO_WRAP_PASSWORD_SLOT`: {
      let e = We.parse(n);
      return $(await Q(), e.vekB64, (t) =>
        t.wrap_vek_password(
          e.password,
          e.saltB64,
          e.slotIdB64,
          new Uint8Array(e.magicVersion),
        ),
      );
    }
    case `CRYPTO_WRAP_WEBAUTHN_SLOT`: {
      let e = Oe.parse(n);
      return $(await Q(), e.vekB64, (t) =>
        t.wrap_vek_webauthn(
          e.hmacSecretB64,
          e.slotIdB64,
          new Uint8Array(e.magicVersion),
        ),
      );
    }
    case `CRYPTO_ENCRYPT`: {
      let e = Re.parse(n);
      return $(await Q(), e.vekB64, (t) => t.encrypt_entry(e.plaintextJson));
    }
    case `CRYPTO_DECRYPT`: {
      let e = Je.parse(n);
      return $(await Q(), e.vekB64, (t) =>
        t.decrypt_entry(e.ciphertext, e.iv, e.wrappedDek, e.dekIv),
      );
    }
    case `CRYPTO_DECRYPT_BATCH`: {
      let e = qe.parse(n);
      return $(await Q(), e.vekB64, (t) =>
        t.decrypt_entries(
          e.entries.map(
            ({ ciphertext: e, iv: t, wrappedDek: n, dekIv: r }) => ({
              ciphertext: e,
              iv: t,
              wrappedDek: n,
              dekIv: r,
            }),
          ),
        ),
      );
    }
    case `CRYPTO_CHECK_ENTRIES`: {
      let e = qe.parse(n);
      return $(await Q(), e.vekB64, (t) =>
        t
          .decrypt_entries(
            e.entries.map(
              ({ ciphertext: e, iv: t, wrappedDek: n, dekIv: r }) => ({
                ciphertext: e,
                iv: t,
                wrappedDek: n,
                dekIv: r,
              }),
            ),
          )
          .map((e) => e != null),
      );
    }
    case `CRYPTO_DECRYPT_INDEX`: {
      let e = Ue.parse(n);
      return $(await Q(), e.vekB64, (t) =>
        e.entries.map((e) => {
          try {
            return {
              id: e.id,
              plaintext: t.decrypt_entry(
                e.ciphertext,
                e.iv,
                e.wrappedDek,
                e.dekIv,
              ),
            };
          } catch {
            return { id: e.id, plaintext: null };
          }
        }),
      );
    }
    case `CRYPTO_ENCRYPT_OUTER`: {
      let e = Xe.parse(n);
      return $(await Q(), e.vekB64, (t) => t.encrypt_with_vek(e.plaintext));
    }
    case `CRYPTO_DECRYPT_OUTER`: {
      let e = Ie.parse(n);
      return $(await Q(), e.vekB64, (t) =>
        t.decrypt_with_vek(e.iv, e.ciphertext),
      );
    }
    case `CRYPTO_MAILBOX_ID`: {
      let e = Ye.parse(n);
      return $(await Q(), e.vekB64, (t) => t.mailbox_id(e.groupKeyB64));
    }
    case `CRYPTO_MAILBOX_SEAL`: {
      let e = He.parse(n);
      return $(await Q(), e.vekB64, (t) =>
        t.mailbox_seal(e.groupKeyB64, e.aad, e.plaintext),
      );
    }
    case `CRYPTO_MAILBOX_OPEN`: {
      let e = Ke.parse(n);
      return $(await Q(), e.vekB64, (t) =>
        t.mailbox_open(e.groupKeyB64, e.aad, e.sealedB64),
      );
    }
    case `CRYPTO_FILE_SEAL`: {
      let e = Be.parse(n),
        t = await An(await Q(), e);
      return (H?.poke(), t);
    }
    case `CRYPTO_FILE_OPEN`: {
      let e = Ze.parse(n);
      return jn(await Q(), e);
    }
    case `CRYPTO_FILE_META`: {
      let e = Ge.parse(n);
      return $(await Q(), e.vekB64, (t) =>
        t.open_file_meta(e.wrappedFek, e.fekIv, e.metaBlob, e.metaIv),
      );
    }
    case `CRYPTO_FILE_RESEAL_META`: {
      let e = ze.parse(n);
      return $(await Q(), e.vekB64, (t) =>
        t.reseal_file_meta(e.wrappedFek, e.fekIv, e.metaJson),
      );
    }
    case `CRYPTO_UNWRAP_PASSWORD_SLOT`: {
      let e = Pe.parse(n),
        t = await Q();
      return t.unwrap_vek_password(
        e.password,
        e.saltB64,
        e.slotIdB64,
        e.verifierB64,
        e.wrapIvB64,
        e.wrappedVekB64,
        new Uint8Array(e.magicVersion),
      )
        ? { ok: !0, vekB64: t.export_vek() }
        : { ok: !1 };
    }
    case `CRYPTO_UNWRAP_WEBAUTHN_SLOT`: {
      let e = je.parse(n),
        t = await Q();
      return t.unwrap_vek_webauthn(
        e.hmacSecretB64,
        e.slotIdB64,
        e.verifierB64,
        e.wrapIvB64,
        e.wrappedVekB64,
        new Uint8Array(e.magicVersion),
      )
        ? { ok: !0, vekB64: t.export_vek() }
        : { ok: !1 };
    }
  }
  switch (t) {
    case `CRYPTO_LOCK`:
      return e.lock().then(() => null);
    case `CRYPTO_IS_LOCKED`:
      return e.isLocked();
    case `CRYPTO_GENERATE_VEK`:
      return e.generateVek();
    case `CRYPTO_UNLOCK_WITH_VEK`:
      return e.unlockWithVek($e.parse(n).vekB64).then(() => null);
    case `CRYPTO_EXPORT_VEK`:
      return e.exportVek();
    case `CRYPTO_ROTATE_VEK`:
      return e.rotateVek();
    case `CRYPTO_GENERATE_SALT`:
      return e.generateSalt();
    case `CRYPTO_GENERATE_SLOT_ID`:
      return e.generateSlotId();
    case `CRYPTO_VERIFY_PASSWORD_SLOT`: {
      let t = Ae.parse(n);
      return e.verifyPasswordSlot({
        password: t.password,
        saltB64: t.saltB64,
        slotIdB64: t.slotIdB64,
        verifierB64: t.verifierB64,
        magicVersion: new Uint8Array(t.magicVersion),
      });
    }
    case `CRYPTO_VERIFY_WEBAUTHN_SLOT`: {
      let t = Me.parse(n);
      return e.verifyWebauthnSlot({
        hmacSecretB64: t.hmacSecretB64,
        slotIdB64: t.slotIdB64,
        verifierB64: t.verifierB64,
        magicVersion: new Uint8Array(t.magicVersion),
      });
    }
    case `CRYPTO_OPEN_KDBX`: {
      let t = Ve.parse(n),
        r = await _(t.handoff);
      if (!r) throw Error(`the database to import is no longer staged`);
      let i = await e.openKdbx({
          file: new Uint8Array(await r.arrayBuffer()),
          password: t.password,
          keyfile: t.keyfileB64 ? b(t.keyfileB64) : void 0,
        }),
        a = [];
      for (let { source: e, size: t } of i.attachments) {
        if (e.kind !== `blob`) throw Error(`expected the attachment as a Blob`);
        a.push({ token: await w(e.blob), size: t });
      }
      return { entries: i.entries, attachments: a };
    }
    case `CRYPTO_SAVE_KDBX`: {
      let e = Ne.parse(n);
      return Mn(await Q(), e);
    }
    case `CRYPTO_SEAL_PORTABLE_VAULT`: {
      let t = ke.parse(n);
      if (!e.sealPortableVault)
        throw Error(`Exporting a .bramble isn't available here.`);
      return e.sealPortableVault({
        entriesJson: t.entriesJson,
        password: t.password,
        magicVersion: Uint8Array.from(t.magicVersion),
      });
    }
    case `CRYPTO_OPEN_PORTABLE_VAULT`: {
      let t = Fe.parse(n);
      if (!e.openPortableVault)
        throw Error(`Opening a .bramble isn't available here.`);
      return e.openPortableVault({
        password: t.password,
        file: t.file,
        magicVersion: Uint8Array.from(t.magicVersion),
      });
    }
    case `CRYPTO_PASSKEY_MAKE`: {
      let t = Le.parse(n);
      return e.passkeyMakeCredential(t.rpId, t.userVerified);
    }
    case `CRYPTO_PASSKEY_GET`: {
      let t = Qe.parse(n);
      return e.passkeyGetAssertion(
        t.rpId,
        t.privateKeyB64,
        t.alg,
        t.clientDataHashB64,
        t.userVerified,
      );
    }
    case `CRYPTO_PASSKEY_IMPORT_PKCS8`: {
      let t = tt.parse(n);
      return e.passkeyImportPkcs8(t.pkcs8B64);
    }
    case `CRYPTO_PASSKEY_PRF`: {
      let t = et.parse(n);
      return e.passkeyPrfEval(t.secretB64, t.firstB64, t.secondB64);
    }
    default:
      throw Error(`unknown crypto message: ${t}`);
  }
}
async function $n() {
  try {
    return (await navigator.clipboard.writeText(``), !0);
  } catch {
    return !1;
  }
}
async function er(e) {
  let { default: t } = await be(
      async () => {
        let { default: e } = await import(`./jsQR-CGzg4Qjr.js`).then((e) =>
          a(e.default, 1),
        );
        return { default: e };
      },
      __vite__mapDeps([0, 1, 2]),
    ),
    n = await (await fetch(e)).blob(),
    r = await createImageBitmap(n),
    i = new OffscreenCanvas(r.width, r.height),
    o = i.getContext(`2d`);
  if (!o) return null;
  (o.drawImage(r, 0, 0), r.close());
  let {
    data: s,
    width: c,
    height: l,
  } = o.getImageData(0, 0, i.width, i.height);
  return t(s, c, l)?.data ?? null;
}
async function tr(e, t, n, r) {
  try {
    let i = y.parse(JSON.parse(r)),
      a = await e.fetchLocalRoster(t).then(S).catch(f);
    if (!oe(a, i)) return;
    let o = i;
    if (n) {
      let e = (await Q()).roster_admission_sign(n.password, n.saltB64, p(i));
      o = { ...i, admission: { by: n.adminId, sig: e } };
    }
    await e.pushRemoteRoster(t, ae({ devices: [o], revoked: [] }));
  } catch (e) {
    console.warn(`[offscreen] host-side roster add failed`, e);
  }
}
async function nr(e, t) {
  let n = Vn ?? Un;
  try {
    switch (e) {
      case `CLIPBOARD_CLEAR`:
        return { ok: !0, data: await $n() };
      case `HTTP_JOB_START`:
        return { ok: !0, data: await Pn(t) };
      case `HTTP_JOB_POLL`:
        return { ok: !0, data: Fn(String(t?.id ?? ``)) };
      case `QR_DECODE`: {
        let e = t?.dataUrl;
        if (typeof e != `string`) throw Error(`QR_DECODE requires a dataUrl`);
        return { ok: !0, data: await er(e) };
      }
      case `SYNC_DISCONNECT`: {
        (Y(!1), z?.stop(), (z = null));
        let e = G.then(() => Kn());
        return (
          (G = e.catch(() => {})),
          await e,
          X(`disconnected`),
          { ok: !0 }
        );
      }
      case `SYNC_ROSTER_STOP`: {
        let { keepVaultId: e } = me.parse(t),
          n = G.then(() => {
            W !== null && W !== e && Kn();
          });
        return ((G = n.catch(() => {})), await n, { ok: !0 });
      }
      case `SYNC_ENROLL_STOP`:
        return (Y(!1), z?.stop(), (z = null), X(`invite closed`), { ok: !0 });
      case `SYNC_ENROLL_APPROVE`:
        return (Y(ge.parse(t).approved), { ok: !0 });
      case `SYNC_ENROLL_PENDING`:
        return {
          ok: !0,
          data: J ? { sas: J.sas, sasEmoji: J.sasEmoji, label: J.label } : null,
        };
      case `SYNC_BROADCAST_NOW`:
        return (
          await B?.broadcastNow?.(),
          await V?.broadcastNow?.(),
          H?.poke(),
          { ok: !0 }
        );
      case `BLOB_STATUS`: {
        let { vaultId: e, hashes: n } = pe.parse(t);
        return !H || W !== e
          ? { ok: !0, data: null }
          : { ok: !0, data: await H.status(n) };
      }
      case `LINK_SYNC_FRAME`: {
        let { frame: e, room: n } = t ?? {};
        if (typeof e != `string`)
          throw Error(`LINK_SYNC_FRAME requires a frame`);
        for (let t of K.get(typeof n == `string` ? n : `sync`) ?? []) t(e);
        return { ok: !0 };
      }
      case `LINK_BLOB_FRAME`: {
        let { stream: e, frame: n } = t ?? {};
        if (typeof e != `number` || typeof n != `string`)
          throw Error(`LINK_BLOB_FRAME requires a stream and a frame`);
        for (let t of q) t.frame(e, n);
        return { ok: !0 };
      }
      case `LINK_BLOB_POKE`:
        for (let e of q) e.poke();
        return { ok: !0 };
      case `LINK_DOWN`:
        for (let e of Yn) e();
        for (let e of q) e.down();
        return { ok: !0 };
      case `SYNC_ROSTER_SYNC`: {
        let e = fe.parse(t),
          r = G.then(() => qn(e, n));
        return ((G = r.catch(() => {})), await r, { ok: !0 });
      }
      case `SYNC_GENERATE_KEYPAIR`:
        return { ok: !0, data: (await Q()).handshake_generate_keypair() };
      case `LINK_ENROLL_INITIATOR`: {
        let e = await Q(),
          { privateKey: n, psk: r } = t;
        return { ok: !0, data: e.handshake_enroll_initiator(n, r) };
      }
      case `LINK_START_INITIATOR`: {
        let e = await Q(),
          { privateKey: n, remotePublicKey: r } = t;
        return { ok: !0, data: e.handshake_start_initiator(n, r) };
      }
      case `LINK_READ`: {
        let e = await Q(),
          { sessionId: n, message: r } = t;
        return { ok: !0, data: e.handshake_read(n, r) };
      }
      case `LINK_PAIR_INITIATOR`: {
        let e = await Q(),
          { privateKey: n } = t;
        return { ok: !0, data: e.handshake_link_initiator(n) };
      }
      case `LINK_HANDSHAKE_HASH`: {
        let e = await Q(),
          { sessionId: n } = t;
        return { ok: !0, data: e.handshake_hash(n) };
      }
      case `LINK_REMOTE_STATIC`: {
        let e = await Q(),
          { sessionId: n } = t;
        return { ok: !0, data: e.handshake_remote_static(n) };
      }
      case `LINK_SEAL`: {
        let e = await Q(),
          { sessionId: n, plaintext: r } = t;
        return { ok: !0, data: e.handshake_encrypt(n, r) };
      }
      case `LINK_OPEN`: {
        let e = await Q(),
          { sessionId: n, sealed: r } = t;
        return { ok: !0, data: e.handshake_decrypt(n, r) };
      }
      case `LINK_CLOSE`: {
        let e = await Q(),
          { sessionId: n } = t;
        return (e.handshake_close(n), { ok: !0 });
      }
      case `SYNC_GENERATE_SIGNING_KEY`:
        return { ok: !0, data: (await Q()).roster_sig_generate_key() };
      case `SYNC_ROSTER_SIGN`: {
        let e = await Q(),
          { secretB64: n, message: r } = le.parse(t);
        return { ok: !0, data: e.roster_sign(n, r) };
      }
      case `SYNC_ROSTER_ADMISSION_PUBKEY`: {
        let e = await Q(),
          { password: n, saltB64: r } = _e.parse(t);
        return { ok: !0, data: e.roster_admission_public_key(n, r) };
      }
      case `SYNC_ROSTER_ADMISSION_SIGN`: {
        let e = await Q(),
          { password: n, saltB64: r, message: i } = he.parse(t);
        return { ok: !0, data: e.roster_admission_sign(n, r, i) };
      }
      case `SYNC_ENROLL_INVITE`:
      case `SYNC_ENROLL_JOIN`: {
        let r = await Q(),
          i = e === `SYNC_ENROLL_INVITE` ? `inviter` : `joiner`,
          a = i === `inviter` ? se.parse(t) : de.parse(t),
          o = i === `inviter` ? a.admission : void 0,
          s = i === `inviter` ? a.vaultId : void 0;
        (z?.stop(), Y(!1));
        let c = i === `joiner` && a.viaLink === !0;
        return (
          (z = await sn(i, {
            ...a,
            wasm: r,
            report: X,
            peerSource: c
              ? Rn(
                  {
                    send: (e) =>
                      n.linkSend?.(e, `enroll`) ?? Promise.resolve(!1),
                    subscribe: (e) => Jn(`enroll`, e),
                  },
                  { eager: !0 },
                )
              : void 0,
            approve: (e, t) =>
              new Promise((n) => {
                ((J = {
                  sas: e.digits,
                  sasEmoji: e.emoji,
                  label: t,
                  settle: n,
                }),
                  Z({
                    kind: `enroll-approval`,
                    sas: e.digits,
                    sasEmoji: e.emoji,
                    label: t,
                  }));
              }),
            onSas: c
              ? void 0
              : (e) => Z({ kind: `sas`, sas: e.digits, sasEmoji: e.emoji }),
            onInviteExpired: () => {
              (Y(!1), Z({ kind: `enroll-expired` }));
            },
            onEnrollFailed: (e) => Z({ kind: `enroll-failed`, message: e }),
            onEnrollAttemptFailed: (e) =>
              Z({ kind: `enroll-attempt-failed`, message: e }),
            onJoined: (e) => Z({ kind: `joined`, ...e }),
            onJoinError: (e) => Z({ kind: `join-error`, message: e }),
            onEnrolled: (e) => {
              (s && tr(n, s, o, e), Z({ kind: `enrolled`, entryJson: e }));
            },
          })),
          { ok: !0 }
        );
      }
      default:
        if (!e.startsWith(`CRYPTO_`)) throw Error(`unknown message type: ${e}`);
        return { ok: !0, data: await Qn(Zn, e, t) };
    }
  } catch (e) {
    return { ok: !1, error: String(e) };
  }
}
export { Bn as n, Hn as r, nr as t };
