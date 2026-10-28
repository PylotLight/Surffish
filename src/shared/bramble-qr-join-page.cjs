/**
 * Surffish-only "Scan QR" for Bramble's "Join a device" form (options.html). Bramble's extension build
 * pastes pairing codes only (its `cameraScan` capability is off outside mobile), so Surffish stages this
 * file next to Bramble's own scripts and adds one <script> tag to options.html. Bramble itself is never
 * patched (see bramble-poc-adapter.ts, addBrambleQrJoin).
 *
 * - Finds the pairing-code textarea (id "pairing-code", or the "Add a device" placeholder) and puts a
 *   small Scan QR button under it. A MutationObserver keeps it there across React re-renders.
 * - Opens the webcam inline (preview mirrored, frames decoded unmirrored), decodes with BarcodeDetector
 *   where Chromium has it (macOS), else with the bundled jsQR (surffish-jsqr.js, loaded on first scan).
 * - Fills the textarea through the native value setter + input/change events, which is what React's
 *   controlled inputs listen for, then stops the camera.
 * - Optional: "Scan password QR" under the master password field fills it from a plain-text QR. The
 *   value only ever goes into Bramble's own field: never logged, stored or sent anywhere.
 *
 * Pairing code format (flythenimbus/bramble packages/core/src/sync/enrollment.ts): "bramble-pair-1."
 * followed by base64 of JSON { v: 1, groupKey, inviterPub, psk, relay, iceUrl?, exp? }. The "Add a
 * device" screen encodes exactly that string as the QR (QRCodeSVG value={pairingCode}).
 *
 * Plain script, no imports: it runs as a classic <script> in Bramble's page. Under Node/Bun (tests)
 * it exports its pure helpers instead of touching the DOM.
 */
(function (root) {
  "use strict";

  var PREFIX = "bramble-pair-1.";
  var CODE_PATTERN = /bramble-pair-1\.[A-Za-z0-9+/_=-]+/;
  var HOST_ATTR = "data-surffish-qr";

  function decodeBase64(body) {
    var normalized = body.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4 !== 0) normalized += "=";
    var binary = root.atob(normalized);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { normalized: normalized, text: new TextDecoder().decode(bytes) };
  }

  /** Base64 body -> canonical body when it holds a v1 pairing payload, else null. */
  function canonicalPairingBody(body) {
    try {
      var decoded = decodeBase64(body);
      var payload = JSON.parse(decoded.text);
      if (!payload || typeof payload !== "object" || payload.v !== 1)
        return null;
      if (
        typeof payload.groupKey !== "string" ||
        typeof payload.inviterPub !== "string" ||
        typeof payload.psk !== "string"
      )
        return null;
      return decoded.normalized;
    } catch (_error) {
      return null;
    }
  }

  function safeDecodeURIComponent(text) {
    try {
      return decodeURIComponent(text);
    } catch (_error) {
      return text;
    }
  }

  /**
   * The Bramble pairing code inside scanned QR text, or null. Accepts the bare code (what Bramble's
   * "Add a device" QR holds) and the same code wrapped in a URL or deep link (query, fragment or path,
   * percent-encoded or not, base64url or not). A wrapped body that does not decode to a v1 pairing
   * payload is rejected; a bare "bramble-pair-1." code is passed through as-is so Bramble can show its
   * own error (e.g. a newer version).
   */
  function extractPairingCode(input) {
    if (typeof input !== "string") return null;
    var text = input.trim();
    if (!text) return null;
    var compact = text.replace(/\s+/g, "");
    if (
      compact.indexOf(PREFIX) === 0 &&
      /^bramble-pair-1\.[A-Za-z0-9+/=]+$/.test(compact)
    )
      return compact;
    var candidates = [
      compact,
      safeDecodeURIComponent(compact),
      safeDecodeURIComponent(safeDecodeURIComponent(compact)),
    ];
    for (var i = 0; i < candidates.length; i++) {
      var match = CODE_PATTERN.exec(candidates[i]);
      if (!match) continue;
      var body = canonicalPairingBody(match[0].slice(PREFIX.length));
      if (body) return PREFIX + body;
    }
    // No prefix at all: a deep link might carry just the base64 payload (e.g. ?code=eyJ2Ijox...).
    for (var j = 0; j < candidates.length; j++) {
      var tokens = candidates[j].split(/[?&#=/:]+/);
      for (var k = 0; k < tokens.length; k++) {
        var token = tokens[k];
        if (token.length < 40 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(token))
          continue;
        var bare = canonicalPairingBody(token);
        if (bare) return PREFIX + bare;
      }
    }
    return null;
  }

  /** Master password from a plain-text QR: the text as-is, minus a trailing line break. */
  function passwordFromQrText(input) {
    if (typeof input !== "string") return null;
    var value = input.replace(/[\r\n]+$/, "");
    if (!value || value.length > 1024) return null;
    if (extractPairingCode(value)) return null;
    return value;
  }

  /** What to tell the user when getUserMedia fails. */
  function cameraErrorMessage(error) {
    var name =
      error && typeof error === "object" ? String(error.name || "") : "";
    if (
      name === "NotAllowedError" ||
      name === "SecurityError" ||
      name === "PermissionDeniedError"
    ) {
      return "Camera access is blocked. On a Mac, allow Surffish in System Settings → Privacy & Security → Camera, then try again.";
    }
    if (
      name === "NotFoundError" ||
      name === "DevicesNotFoundError" ||
      name === "OverconstrainedError"
    )
      return "No camera found. Plug one in, or paste the code instead.";
    if (
      name === "NotReadableError" ||
      name === "TrackStartError" ||
      name === "AbortError"
    )
      return "The camera is busy in another app. Close it there and try again.";
    if (name === "Unsupported")
      return "Camera access isn’t available here. Paste the code instead.";
    return "Couldn’t start the camera. Paste the code instead.";
  }

  if (typeof module === "object" && module && module.exports) {
    module.exports = {
      extractPairingCode: extractPairingCode,
      passwordFromQrText: passwordFromQrText,
      cameraErrorMessage: cameraErrorMessage,
    };
    return;
  }

  var document = root.document;
  if (!document || root.__surffishBrambleQrJoin) return;
  root.__surffishBrambleQrJoin = true;

  // Resolve surffish-jsqr.js next to this file (works for chrome-extension:// and test fixtures).
  var scriptSrc = document.currentScript && document.currentScript.src;
  var jsqrUrl = (function () {
    try {
      return new URL("surffish-jsqr.js", scriptSrc || root.location.href).href;
    } catch (_error) {
      return "surffish-jsqr.js";
    }
  })();

  // ---------------------------------------------------------------------------
  // Filling React-controlled fields

  function setNativeValue(element, value) {
    var proto =
      element instanceof root.HTMLTextAreaElement
        ? root.HTMLTextAreaElement.prototype
        : root.HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    // React tracks the value on the element instance; the prototype setter skips that tracker, so the
    // input event below reaches React's onChange as a real change.
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ---------------------------------------------------------------------------
  // Decoding

  var jsqrPromise = null;
  function loadJsQr() {
    if (typeof root.jsQR === "function") return Promise.resolve(root.jsQR);
    if (jsqrPromise) return jsqrPromise;
    jsqrPromise = new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.src = jsqrUrl;
      script.async = true;
      script.onload = function () {
        typeof root.jsQR === "function"
          ? resolve(root.jsQR)
          : reject(new Error("jsQR did not load"));
      };
      script.onerror = function () {
        reject(new Error("jsQR did not load"));
      };
      (document.head || document.documentElement).appendChild(script);
    });
    jsqrPromise.catch(function () {
      jsqrPromise = null;
    });
    return jsqrPromise;
  }

  /** A decoder: (video) => Promise<string | null>. BarcodeDetector when it can read QR, else jsQR. */
  function createDecoder() {
    var Detector = root.BarcodeDetector;
    var detectorReady =
      Detector && typeof Detector.getSupportedFormats === "function"
        ? Detector.getSupportedFormats().then(
            function (formats) {
              return formats.indexOf("qr_code") >= 0
                ? new Detector({ formats: ["qr_code"] })
                : null;
            },
            function () {
              return null;
            },
          )
        : Promise.resolve(null);
    var canvas = document.createElement("canvas");
    var context = null;
    var fallback = null;
    function jsqrDecode(video) {
      if (!fallback) fallback = loadJsQr();
      return fallback.then(function (jsQR) {
        var width = video.videoWidth;
        var height = video.videoHeight;
        if (!width || !height) return null;
        // Centre square, scaled to at most 900px: a phone held up to the camera fills the middle, and
        // jsQR on a full 1080p frame is slow.
        var side = Math.min(width, height);
        var scale = Math.min(1, 900 / side);
        var size = Math.max(1, Math.round(side * scale));
        if (canvas.width !== size) {
          canvas.width = size;
          canvas.height = size;
        }
        context =
          context || canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return null;
        context.drawImage(
          video,
          (width - side) / 2,
          (height - side) / 2,
          side,
          side,
          0,
          0,
          size,
          size,
        );
        var image = context.getImageData(0, 0, size, size);
        var found = jsQR(image.data, size, size, {
          inversionAttempts: "attemptBoth",
        });
        return found && found.data ? found.data : null;
      });
    }
    var useDetector = true;
    return function decode(video) {
      return detectorReady.then(function (detector) {
        if (detector && useDetector) {
          return detector.detect(video).then(
            function (codes) {
              for (var i = 0; i < codes.length; i++)
                if (codes[i] && codes[i].rawValue) return codes[i].rawValue;
              return null;
            },
            function () {
              useDetector = false;
              return jsqrDecode(video);
            },
          );
        }
        return jsqrDecode(video);
      });
    };
  }

  // ---------------------------------------------------------------------------
  // UI (shadow DOM, so Bramble's Tailwind and ours never meet)

  var STYLE = [
    ':host { display: block; margin-top: 6px; font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: inherit; }',
    ".row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }",
    "button { font: inherit; color: inherit; background: transparent; border: 1px solid color-mix(in srgb, currentColor 28%, transparent); border-radius: 8px; padding: 4px 10px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }",
    "button:hover { background: color-mix(in srgb, currentColor 8%, transparent); }",
    "button:focus-visible { outline: 2px solid color-mix(in srgb, currentColor 60%, transparent); outline-offset: 1px; }",
    "button.link { border: 0; padding: 2px 0; opacity: 0.75; }",
    "button.link:hover { background: transparent; opacity: 1; text-decoration: underline; }",
    "svg { width: 14px; height: 14px; flex: none; }",
    ".panel { margin-top: 8px; border: 1px solid color-mix(in srgb, currentColor 20%, transparent); border-radius: 10px; overflow: hidden; }",
    ".stage { position: relative; overflow: hidden; background: #000; aspect-ratio: 16 / 9; max-height: 320px; width: 100%; }",
    "video { width: 100%; height: 100%; object-fit: cover; display: block; transform: scaleX(-1); }",
    ".frame { position: absolute; inset: 0; margin: auto; width: 56%; aspect-ratio: 1; max-height: 86%; border: 2px solid rgba(255,255,255,0.85); border-radius: 12px; box-shadow: 0 0 0 9999px rgba(0,0,0,0.28); pointer-events: none; }",
    ".bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 10px; }",
    ".status { opacity: 0.8; }",
    ".status.error { color: #dc2626; opacity: 1; }",
    "@media (prefers-color-scheme: dark) { .status.error { color: #f87171; } }",
    ".ok { color: #16a34a; }",
    "[hidden] { display: none !important; }",
  ].join("\n");

  var QR_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 15h2v2h-2zM19 15h2M15 19h2M19 19h2v2"/></svg>';

  var activeSession = null;

  /** One scanner host: a button plus the inline camera panel. `accept(text)` returns the value to fill or null. */
  function createHost(options) {
    var host = document.createElement("div");
    host.setAttribute(HOST_ATTR, options.kind);
    var shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML =
      "<style>" +
      STYLE +
      "</style>" +
      '<div class="row"><button type="button" class="' +
      (options.kind === "password" ? "link" : "") +
      '" part="scan">' +
      QR_ICON +
      "<span>" +
      options.label +
      "</span></button>" +
      '<span class="status" role="status" aria-live="polite"></span></div>' +
      '<div class="panel" hidden><div class="stage"><video playsinline muted autoplay></video><div class="frame"></div></div>' +
      '<div class="bar"><span class="status hint" aria-live="polite">' +
      options.hint +
      '</span><button type="button" class="cancel">Cancel</button></div></div>';
    var scanButton = shadow.querySelector('button[part="scan"]');
    var rowStatus = shadow.querySelector(".row .status");
    var panel = shadow.querySelector(".panel");
    var video = shadow.querySelector("video");
    var hint = shadow.querySelector(".hint");
    var cancelButton = shadow.querySelector(".cancel");

    function setRowStatus(text, kind) {
      rowStatus.textContent = text || "";
      rowStatus.className =
        "status" + (kind === "error" ? " error" : kind === "ok" ? " ok" : "");
    }
    function setHint(text, kind) {
      hint.textContent = text;
      hint.className = "status hint" + (kind === "error" ? " error" : "");
    }

    var session = null;
    function stop(reason) {
      if (!session) return;
      var current = session;
      session = null;
      if (activeSession === current) activeSession = null;
      current.stopped = true;
      if (current.timer) root.clearTimeout(current.timer);
      if (current.stream)
        current.stream.getTracks().forEach(function (track) {
          try {
            track.stop();
          } catch (_error) {
            /* A stopped media track is already released; continue teardown. */
          }
        });
      try {
        video.pause();
      } catch (_error) {
        /* Video may already be paused or unavailable during teardown. */
      }
      video.srcObject = null;
      panel.hidden = true;
      scanButton.disabled = false;
      if (reason === "cancel") setRowStatus("");
    }

    function fail(message) {
      stop("error");
      setRowStatus(message, "error");
    }

    function start() {
      if (session) return;
      if (activeSession) activeSession.stopFn("cancel");
      setRowStatus("");
      var mediaDevices = root.navigator && root.navigator.mediaDevices;
      if (!mediaDevices || typeof mediaDevices.getUserMedia !== "function") {
        fail(cameraErrorMessage({ name: "Unsupported" }));
        return;
      }
      session = { stopped: false, stream: null, timer: 0, stopFn: stop };
      activeSession = session;
      var current = session;
      scanButton.disabled = true;
      panel.hidden = false;
      setHint(options.hint);
      var constraints = {
        audio: false,
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: { ideal: "environment" },
        },
      };
      mediaDevices
        .getUserMedia(constraints)
        .catch(function (error) {
          // An exotic camera that can't do the ideal shape: ask for any video at all.
          if (error && error.name === "OverconstrainedError")
            return mediaDevices.getUserMedia({ audio: false, video: true });
          throw error;
        })
        .then(
          function (stream) {
            if (current.stopped) {
              stream.getTracks().forEach(function (track) {
                track.stop();
              });
              return;
            }
            current.stream = stream;
            video.srcObject = stream;
            var played = video.play();
            if (played && typeof played.catch === "function")
              played.catch(function () {});
            var decode = createDecoder();
            var tick = function () {
              if (current.stopped) return;
              if (video.readyState < 2) {
                current.timer = root.setTimeout(tick, 100);
                return;
              }
              decode(video).then(
                function (text) {
                  if (current.stopped) return;
                  if (text) {
                    var value = options.accept(text);
                    if (value) {
                      stop("done");
                      options.fill(value);
                      setRowStatus(options.done, "ok");
                      return;
                    }
                    setHint(options.wrongCode, "error");
                  }
                  current.timer = root.setTimeout(tick, 120);
                },
                function () {
                  fail(
                    "QR decoding isn’t available in this build. Paste the code instead.",
                  );
                },
              );
            };
            tick();
          },
          function (error) {
            if (current.stopped) return;
            fail(cameraErrorMessage(error));
          },
        )
        .catch(function (error) {
          if (current.stopped) return;
          fail(cameraErrorMessage(error));
        });
    }

    scanButton.addEventListener("click", start);
    cancelButton.addEventListener("click", function () {
      stop("cancel");
    });
    shadow.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && session) {
        event.preventDefault();
        stop("cancel");
      }
    });
    host.__surffishStop = stop;
    return host;
  }

  // ---------------------------------------------------------------------------
  // Finding Bramble's fields

  function findPairingTextareas() {
    var found = [];
    var all = document.querySelectorAll("textarea");
    for (var i = 0; i < all.length; i++) {
      var textarea = all[i];
      var placeholder = (
        textarea.getAttribute("placeholder") || ""
      ).toLowerCase();
      if (
        textarea.id === "pairing-code" ||
        placeholder.indexOf("add a device") >= 0 ||
        placeholder.indexOf("pairing code") >= 0
      )
        found.push(textarea);
    }
    return found;
  }

  function labelText(input) {
    var text = "";
    if (input.id) {
      var labels = document.querySelectorAll(
        'label[for="' +
          (root.CSS && root.CSS.escape ? root.CSS.escape(input.id) : input.id) +
          '"]',
      );
      for (var i = 0; i < labels.length; i++)
        text += " " + labels[i].textContent;
    }
    return (
      text +
      " " +
      (input.getAttribute("aria-label") || "")
    ).toLowerCase();
  }

  /** The master password input in the same form as the pairing code. */
  function findMasterPasswordInput(textarea) {
    var form = textarea.closest("form");
    if (!form) return null;
    var inputs = form.querySelectorAll("input");
    var candidates = [];
    for (var i = 0; i < inputs.length; i++) {
      var type = (inputs[i].getAttribute("type") || "text").toLowerCase();
      if (type === "password" || type === "text") candidates.push(inputs[i]);
    }
    for (var j = 0; j < candidates.length; j++)
      if (labelText(candidates[j]).indexOf("master password") >= 0)
        return candidates[j];
    // PasswordField flips type password<->text with its eye button; the join form has just that one.
    return candidates.length === 1 ? candidates[0] : null;
  }

  /** Bramble's TextField wraps the input in a positioned box; our host goes right after that box. */
  function fieldBox(input) {
    var box = input.parentElement;
    return box && box.parentElement ? box : input;
  }

  var pairingHosts = new WeakMap();
  var passwordHosts = new WeakMap();

  function place(anchor, host) {
    if (anchor.nextSibling === host) return;
    if (!anchor.parentNode) return;
    anchor.parentNode.insertBefore(host, anchor.nextSibling);
  }

  function ensure() {
    var textareas = findPairingTextareas();
    for (var i = 0; i < textareas.length; i++) {
      var textarea = textareas[i];
      var host = pairingHosts.get(textarea);
      if (!host) {
        host = createHost({
          kind: "pairing",
          label: "Scan QR",
          hint: "Hold the “Add a device” QR from your other device up to the camera.",
          done: "Code filled from the QR.",
          wrongCode:
            "That QR isn’t a Bramble pairing code. Show the “Add a device” QR.",
          accept: extractPairingCode,
          fill: (function (target) {
            return function (value) {
              setNativeValue(target, value);
              var password = findMasterPasswordInput(target);
              if (password && !password.value) {
                try {
                  password.focus();
                } catch (_error) {
                  /* Focus is best-effort; keep the password submission flow intact. */
                }
              }
            };
          })(textarea),
        });
        pairingHosts.set(textarea, host);
      }
      place(textarea, host);

      var password = findMasterPasswordInput(textarea);
      if (password) {
        var passwordHost = passwordHosts.get(password);
        if (!passwordHost) {
          passwordHost = createHost({
            kind: "password",
            label: "Scan password QR",
            hint: "Hold a QR holding just your master password up to the camera.",
            done: "Password filled.",
            wrongCode: "That looks like a pairing code, not a password.",
            accept: passwordFromQrText,
            fill: (function (target) {
              return function (value) {
                setNativeValue(target, value);
              };
            })(password),
          });
          passwordHosts.set(password, passwordHost);
        }
        place(fieldBox(password), passwordHost);
      }
    }
    // A host whose field went away (React swapped screens) must not keep the camera running.
    var hosts = document.querySelectorAll("[" + HOST_ATTR + "]");
    for (var h = 0; h < hosts.length; h++) {
      var previous = hosts[h].previousElementSibling;
      var kind = hosts[h].getAttribute(HOST_ATTR);
      var stillAnchored =
        kind === "pairing"
          ? previous &&
            previous.tagName === "TEXTAREA" &&
            pairingHosts.get(previous) === hosts[h]
          : previous &&
            previous.querySelector &&
            passwordHosts.get(previous.querySelector("input")) === hosts[h];
      if (!stillAnchored) {
        if (hosts[h].__surffishStop) hosts[h].__surffishStop("cancel");
        hosts[h].remove();
      }
    }
  }

  var scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    root.requestAnimationFrame(function () {
      scheduled = false;
      ensure();
    });
  }

  function boot() {
    ensure();
    new root.MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        // Ignore our own insertions so placing a host doesn't loop.
        var nodes = records[i].addedNodes;
        var ours = nodes.length > 0;
        for (var n = 0; n < nodes.length; n++)
          if (!(nodes[n].nodeType === 1 && nodes[n].hasAttribute(HOST_ATTR)))
            ours = false;
        if (!ours) {
          schedule();
          return;
        }
      }
    }).observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
    root.addEventListener("pagehide", function () {
      if (activeSession) activeSession.stopFn("cancel");
    });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})(typeof globalThis !== "undefined" ? globalThis : this);
