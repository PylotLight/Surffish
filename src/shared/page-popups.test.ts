import { describe, expect, test } from "bun:test";
import {
  isActivatingKeyInput,
  isActivatingMouseInput,
  isClosePopupShortcut,
  isPopupNavigationUrl,
  isPopupStartUrl,
  isScriptPopupRequest,
  POPUP_ACTIVATION_MS,
  PopupActivation,
} from "./page-popups";

describe("script popups", () => {
  test("Disqus's sized login window.open is a script popup; links and Shift+click are not", () => {
    // What Disqus's lounge passes for Login → Disqus (openWindow(url, '_blank', {width, height})).
    expect(
      isScriptPopupRequest({
        disposition: "new-window",
        features:
          "width=478,height=590,left=721,top=245,location=1,status=1,resizable=1,scrollbars=1",
      }),
    ).toBe(true);
    expect(
      isScriptPopupRequest({ disposition: "new-window", features: "popup" }),
    ).toBe(true);
    expect(
      isScriptPopupRequest({ disposition: "new-window", features: "" }),
    ).toBe(false); // Shift+click on a link
    expect(
      isScriptPopupRequest({ disposition: "foreground-tab", features: "" }),
    ).toBe(false); // target=_blank / window.open(url)
    expect(
      isScriptPopupRequest({
        disposition: "background-tab",
        features: "width=10",
      }),
    ).toBe(false);
  });

  test("popups start on http(s) or about:blank and only navigate to http(s)", () => {
    expect(isPopupStartUrl("https://disqus.com/next/login/?forum=x")).toBe(
      true,
    );
    expect(isPopupStartUrl("about:blank")).toBe(true);
    expect(isPopupStartUrl("")).toBe(true);
    expect(isPopupStartUrl("file:///etc/passwd")).toBe(false);
    expect(isPopupStartUrl("javascript:alert(1)")).toBe(false);
    expect(isPopupNavigationUrl("https://disqus.com/")).toBe(true);
    expect(isPopupNavigationUrl("about:blank")).toBe(false);
    expect(isPopupNavigationUrl("surffish://settings")).toBe(false);
    expect(isPopupNavigationUrl("not a url")).toBe(false);
  });
});

describe("user activation", () => {
  test("mouse presses and ordinary keys activate; moves, Escape and bare modifiers do not", () => {
    expect(isActivatingMouseInput({ type: "mouseDown" })).toBe(true);
    expect(isActivatingMouseInput({ type: "mouseUp" })).toBe(true);
    expect(isActivatingMouseInput({ type: "mouseMove" })).toBe(false);
    expect(isActivatingMouseInput({ type: "mouseWheel" })).toBe(false);
    expect(isActivatingKeyInput({ type: "keyDown", key: "Enter" })).toBe(true);
    expect(isActivatingKeyInput({ type: "keyDown", key: " " })).toBe(true);
    expect(isActivatingKeyInput({ type: "keyUp", key: "Enter" })).toBe(false);
    expect(isActivatingKeyInput({ type: "keyDown", key: "Escape" })).toBe(
      false,
    );
    expect(isActivatingKeyInput({ type: "keyDown", key: "Shift" })).toBe(false);
  });

  test("activation lasts 5 s and one click buys one popup", () => {
    const activation = new PopupActivation();
    expect(activation.consume(1_000)).toBe(false); // never activated
    activation.note(1_000);
    expect(activation.isActive(1_000 + POPUP_ACTIVATION_MS)).toBe(true);
    expect(activation.isActive(1_001 + POPUP_ACTIVATION_MS)).toBe(false);
    expect(activation.consume(2_000)).toBe(true);
    expect(activation.consume(2_001)).toBe(false); // spent
    activation.note(10_000);
    expect(activation.consume(10_000 + POPUP_ACTIVATION_MS + 1)).toBe(false); // expired
    activation.note(20_000);
    expect(activation.consume(19_999)).toBe(false); // clock went backwards: not active
  });
});

describe("popup close shortcut", () => {
  test("Cmd+W on macOS, Ctrl+W elsewhere; nothing else", () => {
    expect(
      isClosePopupShortcut({ type: "keyDown", key: "w", meta: true }, "darwin"),
    ).toBe(true);
    expect(
      isClosePopupShortcut({ type: "keyDown", key: "W", meta: true }, "darwin"),
    ).toBe(true);
    expect(
      isClosePopupShortcut(
        { type: "keyDown", key: "w", control: true },
        "darwin",
      ),
    ).toBe(false);
    expect(
      isClosePopupShortcut(
        { type: "keyDown", key: "w", control: true },
        "linux",
      ),
    ).toBe(true);
    expect(
      isClosePopupShortcut(
        { type: "keyDown", key: "w", control: true, shift: true },
        "linux",
      ),
    ).toBe(false);
    expect(
      isClosePopupShortcut({ type: "keyUp", key: "w", control: true }, "win32"),
    ).toBe(false);
    expect(
      isClosePopupShortcut(
        { type: "keyDown", key: "q", control: true },
        "linux",
      ),
    ).toBe(false);
  });
});
