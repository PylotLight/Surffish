"use strict";
// Surffish tab volume frame preload. Registered on every page session for every frame (sandboxed,
// context-isolated), so iframes (YouTube embeds) are covered too. Electron has no per-WebContents
// volume, so the page is turned down from inside (see shared/tab-volume.ts):
//
// - Media elements play at `page volume × tab volume`. HTMLMediaElement's volume getter/setter is
//   wrapped in the page's own world so the page still reads and sets its own value (a site's volume
//   slider keeps working and never sees the tab level). Elements are picked up when the page touches
//   their volume, plays them, or they start loading/playing (also inside shadow roots), and by a
//   scan of the document when the level changes.
// - Web Audio: a connection to a (realtime) AudioContext's destination goes through one GainNode
//   per context instead. Elements the page routes into Web Audio (createMediaElementSource) are
//   left at the page's volume, so they are turned down once (by the gain), not twice.
// - No createMediaElementSource of our own (cross-origin media would go silent), and mute is left
//   to Chromium's per-tab flag: volume 0 is not mute.
//
// The level is asked from main synchronously the first time the frame uses media (so a page with
// none costs no IPC), and pushed later over `surffish:tab-volume:set`. The two worlds talk over a
// random, per-frame event name.
const { ipcRenderer, webFrame } = require("electron");

const GET_CHANNEL = "surffish:tab-volume:get";
const SET_CHANNEL = "surffish:tab-volume:set";

/** Runs in the page's main world (serialised with toString); must not reference anything outside. */
function installTabVolume(eventName) {
  "use strict";
  const w = window;
  const Media = w.HTMLMediaElement;
  if (!Media) return;
  const MediaProto = Media.prototype;
  const volumeDescriptor = Object.getOwnPropertyDescriptor(
    MediaProto,
    "volume",
  );
  if (
    !volumeDescriptor ||
    typeof volumeDescriptor.get !== "function" ||
    typeof volumeDescriptor.set !== "function"
  )
    return;

  const apply = Reflect.apply;
  const slice = Array.prototype.slice;
  const define = Object.defineProperty;
  const describe = Object.getOwnPropertyDescriptor;
  const ProxyCtor = Proxy;
  const WeakRefCtor = w.WeakRef;
  const EventCtor = w.Event;
  const setTimer = w.setTimeout;
  const nativeGet = volumeDescriptor.get;
  const nativeSet = volumeDescriptor.set;
  const nativeAddListener = w.EventTarget.prototype.addEventListener;
  const nativeDispatch = w.EventTarget.prototype.dispatchEvent;
  const docQuery = w.Document.prototype.querySelectorAll;
  const fragmentQuery = w.DocumentFragment.prototype.querySelectorAll;
  const eventTarget = describe(w.Event.prototype, "target").get;
  const customDetail = describe(w.CustomEvent.prototype, "detail").get;
  const MEDIA_EVENTS = ["play", "playing", "loadstart", "volumechange"];

  /** The page's own volume per element (what it set, or what it had when first seen). */
  const pageVolume = new WeakMap();
  /** Elements the page routes into Web Audio: the context's gain turns them down instead. */
  const routed = new WeakSet();
  /** Volume changes of ours an element still has to report (their volumechange is swallowed). */
  const ownChanges = new WeakMap();
  const seenEvents = new WeakSet();
  const elements = new Set();
  const roots = new Set();
  let tabVolume = 1;
  /** The tab's level was asked for (or pushed). Asked on first media use, so pages without media cost no IPC. */
  let known = false;

  function ensureKnown() {
    if (known) return;
    known = true;
    // The isolated world answers synchronously (sendSync) by dispatching `eventName` back.
    try {
      apply(nativeDispatch, w, [new EventCtor(eventName + "?")]);
    } catch {
      /* keep 100% */
    }
  }

  function clamp(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 1;
  }

  function readNative(element) {
    try {
      return apply(nativeGet, element, []);
    } catch {
      return null;
    }
  }

  function targetFor(element) {
    const page = pageVolume.get(element);
    return routed.has(element)
      ? page
      : Math.min(1, Math.max(0, page * tabVolume));
  }

  /** Set what the element really plays at; true when it changed (a volumechange is then queued). */
  function writeNative(element, value, own) {
    const current = readNative(element);
    if (current === null || Math.abs(current - value) < 1e-9) return false;
    try {
      apply(nativeSet, element, [value]);
    } catch {
      return false;
    }
    if (own) ownChanges.set(element, (ownChanges.get(element) || 0) + 1);
    return true;
  }

  function track(element) {
    if (!element) return;
    ensureKnown();
    if (pageVolume.has(element)) return;
    const current = readNative(element);
    if (current === null) return;
    pageVolume.set(element, current);
    elements.add(new WeakRefCtor(element));
    try {
      apply(nativeAddListener, element, [
        "volumechange",
        swallowOwnChange,
        true,
      ]);
    } catch {
      /* not an EventTarget */
    }
    if (tabVolume !== 1) writeNative(element, targetFor(element), true);
  }

  /** Our own volume writes aren't the page's business: its volumechange listeners never see them. */
  function swallowOwnChange(event) {
    if (seenEvents.has(event)) return;
    seenEvents.add(event);
    const element = apply(eventTarget, event, []);
    const pending = ownChanges.get(element);
    if (!pending) return;
    if (pending === 1) ownChanges.delete(element);
    else ownChanges.set(element, pending - 1);
    event.stopImmediatePropagation();
  }

  function onMediaEvent(event) {
    if (event.type === "volumechange") return swallowOwnChange(event);
    track(apply(eventTarget, event, []));
  }

  function watch(root) {
    for (const type of MEDIA_EVENTS) {
      try {
        apply(nativeAddListener, root, [type, onMediaEvent, true]);
      } catch {
        /* gone */
      }
    }
  }

  function wrap(fn, handler) {
    return new ProxyCtor(fn, { apply: handler });
  }

  function replaceMethod(proto, name, makeHandler) {
    const descriptor = proto && describe(proto, name);
    if (!descriptor || typeof descriptor.value !== "function") return null;
    define(proto, name, {
      ...descriptor,
      value: wrap(descriptor.value, makeHandler(descriptor.value)),
    });
    return descriptor.value;
  }

  // --- Media elements -------------------------------------------------------------------------
  define(MediaProto, "volume", {
    ...volumeDescriptor,
    get: wrap(nativeGet, (target, element, args) => {
      if (pageVolume.has(element)) return pageVolume.get(element);
      const value = apply(target, element, args);
      track(element);
      return value;
    }),
    set: wrap(nativeSet, (target, element, args) => {
      const value = Number(args[0]);
      // Out of range / not a number: the native setter throws the page's usual error.
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1 ||
        readNative(element) === null
      )
        return apply(target, element, args);
      track(element);
      const before = pageVolume.get(element);
      pageVolume.set(element, value);
      // The page still gets its volumechange when only its own value moved (tab level at 0, or routed).
      if (
        !writeNative(element, targetFor(element), false) &&
        before !== value
      ) {
        setTimer(() => {
          try {
            apply(nativeDispatch, element, [new EventCtor("volumechange")]);
          } catch {
            /* gone */
          }
        }, 0);
      }
    }),
  });
  replaceMethod(MediaProto, "play", (native) => (target, element, args) => {
    try {
      track(element);
    } catch {
      /* not ours to fix */
    }
    return apply(native, element, args);
  });
  watch(w);
  replaceMethod(
    w.Element && w.Element.prototype,
    "attachShadow",
    () => (target, host, args) => {
      const root = apply(target, host, args);
      try {
        watch(root);
        roots.add(new WeakRefCtor(root));
      } catch {
        /* keep the page's root whatever happens */
      }
      return root;
    },
  );

  function liveElements() {
    const found = new Set();
    for (const ref of elements) {
      const element = ref.deref();
      if (element) found.add(element);
      else elements.delete(ref);
    }
    const scan = (query, root) => {
      try {
        for (const element of apply(query, root, ["audio, video"]))
          found.add(element);
      } catch {
        /* detached */
      }
    };
    scan(docQuery, w.document);
    for (const ref of roots) {
      const root = ref.deref();
      if (root) scan(fragmentQuery, root);
      else roots.delete(ref);
    }
    return found;
  }

  // --- Web Audio --------------------------------------------------------------------------------
  const AudioNodeProto = w.AudioNode && w.AudioNode.prototype;
  const Destination = w.AudioDestinationNode;
  const Realtime = w.AudioContext;
  const Gain = w.GainNode;
  const gains = new WeakMap();
  const contexts = new Set();
  let nativeConnect = null;
  let setGainTarget = null;
  let gainParam = null;
  let currentTime = null;
  let contextState = null;
  let setParamValue = null;
  if (AudioNodeProto && Destination && Realtime && Gain) {
    const contextOf = describe(AudioNodeProto, "context").get;
    gainParam = describe(Gain.prototype, "gain").get;
    setGainTarget = w.AudioParam.prototype.setTargetAtTime;
    currentTime = describe(w.BaseAudioContext.prototype, "currentTime").get;
    contextState = describe(w.BaseAudioContext.prototype, "state").get;
    setParamValue = describe(w.AudioParam.prototype, "value").set;

    /** The gain a connection to this destination goes through (made on first use), or null. */
    const gainFor = (node) => {
      if (!(node instanceof Destination)) return null;
      const context = apply(contextOf, node, []);
      if (!(context instanceof Realtime)) return null;
      let gain = gains.get(context);
      if (!gain) {
        ensureKnown();
        gain = new Gain(context, { gain: tabVolume });
        apply(nativeConnect, gain, [node]);
        gains.set(context, gain);
        contexts.add(new WeakRefCtor(context));
      }
      return gain;
    };
    nativeConnect = replaceMethod(
      AudioNodeProto,
      "connect",
      () => (target, node, args) => {
        let gain;
        try {
          gain = args.length > 0 ? gainFor(args[0]) : null;
        } catch {
          gain = null;
        }
        if (!gain) return apply(target, node, args);
        apply(target, node, [gain, ...apply(slice, args, [1])]);
        return args[0];
      },
    );
    replaceMethod(AudioNodeProto, "disconnect", () => (target, node, args) => {
      let gain = null;
      try {
        if (args.length > 0 && args[0] instanceof Destination)
          gain = gains.get(apply(contextOf, args[0], [])) || null;
      } catch {
        gain = null;
      }
      return apply(
        target,
        node,
        gain ? [gain, ...apply(slice, args, [1])] : args,
      );
    });
    const markRouted = (element) => {
      if (readNative(element) === null) return;
      track(element);
      routed.add(element);
      writeNative(element, targetFor(element), true);
    };
    replaceMethod(
      Realtime.prototype,
      "createMediaElementSource",
      () => (target, context, args) => {
        const node = apply(target, context, args);
        try {
          markRouted(args[0]);
        } catch {
          /* the page's node is what matters */
        }
        return node;
      },
    );
    const SourceNode = w.MediaElementAudioSourceNode;
    const sourceDescriptor =
      SourceNode && describe(w, "MediaElementAudioSourceNode");
    if (sourceDescriptor && "value" in sourceDescriptor) {
      const construct = Reflect.construct;
      const proxied = new ProxyCtor(SourceNode, {
        construct(target, args, newTarget) {
          const node = construct(
            target,
            args,
            newTarget === proxied ? target : newTarget,
          );
          try {
            if (args[1] && args[1].mediaElement)
              markRouted(args[1].mediaElement);
          } catch {
            /* ignore */
          }
          return node;
        },
      });
      define(w, "MediaElementAudioSourceNode", {
        ...sourceDescriptor,
        value: proxied,
      });
    }
  }

  function applyToAudioContexts() {
    if (!setGainTarget) return;
    for (const ref of contexts) {
      const context = ref.deref();
      if (!context) {
        contexts.delete(ref);
        continue;
      }
      const param = apply(gainParam, gains.get(context), []);
      try {
        // Running: glide there (no click). Suspended/closed: the ramp would wait, so jump.
        if (apply(contextState, context, []) === "running")
          apply(setGainTarget, param, [
            tabVolume,
            apply(currentTime, context, []),
            0.015,
          ]);
        else apply(setParamValue, param, [tabVolume]);
      } catch {
        /* closed */
      }
    }
  }

  apply(nativeAddListener, w, [
    eventName,
    (event) => {
      let detail;
      try {
        detail = apply(customDetail, event, []);
      } catch {
        return;
      }
      const next = clamp(detail);
      known = true;
      if (next === tabVolume) return;
      tabVolume = next;
      for (const element of liveElements()) {
        if (pageVolume.has(element))
          writeNative(element, targetFor(element), true);
        else track(element);
      }
      applyToAudioContexts();
    },
  ]);
}

function askVolume() {
  try {
    const value = ipcRenderer.sendSync(GET_CHANNEL);
    return typeof value === "number" && Number.isFinite(value)
      ? Math.min(1, Math.max(0, value))
      : 1;
  } catch {
    return 1;
  }
}

function randomEventName() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `sf-tv-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

const eventName = randomEventName();
let current = 1;
function deliver(volume) {
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail: volume }));
  } catch {
    // The frame may be going away.
  }
}
// The main world's first media use: ask main now (synchronously, before the element plays).
window.addEventListener(`${eventName}?`, () => {
  current = askVolume();
  deliver(current);
});
try {
  // Main world, synchronous, before the page's own scripts (and not subject to its CSP).
  const result = webFrame.executeJavaScript(
    `(${installTabVolume.toString()})(${JSON.stringify(eventName)})`,
  );
  if (result && typeof result.catch === "function") result.catch(() => {});
} catch {
  // Never break the page.
}

ipcRenderer.on(SET_CHANNEL, (_event, value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  const next = Math.min(1, Math.max(0, value));
  if (next === current) return;
  current = next;
  deliver(next);
});
