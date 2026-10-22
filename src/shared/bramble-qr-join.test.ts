import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const page = require("./bramble-qr-join-page.cjs") as {
  extractPairingCode: (text: unknown) => string | null;
  passwordFromQrText: (text: unknown) => string | null;
  cameraErrorMessage: (error: unknown) => string;
};

// Same shape as Bramble's encodePairingCode (packages/core/src/sync/enrollment.ts): prefix + base64(JSON).
const payload = {
  v: 1,
  groupKey: "Z3JvdXAta2V5LWdyb3VwLWtleS1ncm91cC1rZXktMDA=",
  inviterPub: "aW52aXRlci1wdWItaW52aXRlci1wdWItaW52aXRlcjA=",
  psk: "cHNrLXBzay1wc2stcHNrLXBzay1wc2stcHNrLXBzazA=",
  relay: "wss://relay.example",
  exp: 1893456000000,
};
const body = Buffer.from(JSON.stringify(payload)).toString("base64");
const CODE = `bramble-pair-1.${body}`;

describe("extractPairingCode", () => {
  test("a bare code (what Bramble’s Add a device QR holds) passes through", () => {
    expect(page.extractPairingCode(CODE)).toBe(CODE);
    expect(page.extractPairingCode(`  ${CODE}\n`)).toBe(CODE);
    // Line-wrapped copy
    expect(
      page.extractPairingCode(`${CODE.slice(0, 40)}\n${CODE.slice(40)}`),
    ).toBe(CODE);
  });
  test("a code wrapped in a URL or deep link is pulled out", () => {
    expect(
      page.extractPairingCode(`https://bramble.sh/join?code=${CODE}`),
    ).toBe(CODE);
    expect(
      page.extractPairingCode(
        `https://bramble.sh/join?code=${encodeURIComponent(CODE)}&x=1`,
      ),
    ).toBe(CODE);
    expect(
      page.extractPairingCode(`bramble://pair#${encodeURIComponent(CODE)}`),
    ).toBe(CODE);
    expect(page.extractPairingCode(`bramble://pair/${CODE}`)).toBe(CODE);
  });
  test("base64url bodies and a link carrying just the payload", () => {
    const url = body.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(
      page.extractPairingCode(`bramble://join?c=bramble-pair-1.${url}`),
    ).toBe(CODE);
    expect(
      page.extractPairingCode(
        `bramble://join?code=${encodeURIComponent(body)}`,
      ),
    ).toBe(CODE);
  });
  test("anything else is not a pairing code", () => {
    expect(page.extractPairingCode("")).toBeNull();
    expect(page.extractPairingCode("hello world")).toBeNull();
    expect(page.extractPairingCode("otpauth://totp/x?secret=ABC")).toBeNull();
    expect(
      page.extractPairingCode(
        `https://x.test/?code=bramble-pair-1.${Buffer.from('{"v":2}').toString("base64")}`,
      ),
    ).toBeNull();
    expect(page.extractPairingCode(42)).toBeNull();
  });
});

describe("passwordFromQrText", () => {
  test("plain text as-is, minus a trailing line break", () => {
    expect(page.passwordFromQrText("correct horse battery staple")).toBe(
      "correct horse battery staple",
    );
    expect(page.passwordFromQrText(" spaced pw \r\n")).toBe(" spaced pw ");
  });
  test("refuses empty text and pairing codes", () => {
    expect(page.passwordFromQrText("")).toBeNull();
    expect(page.passwordFromQrText("\n")).toBeNull();
    expect(page.passwordFromQrText(CODE)).toBeNull();
  });
});

describe("cameraErrorMessage", () => {
  test("says what went wrong", () => {
    expect(page.cameraErrorMessage({ name: "NotAllowedError" })).toContain(
      "System Settings",
    );
    expect(page.cameraErrorMessage({ name: "NotFoundError" })).toContain(
      "No camera",
    );
    expect(page.cameraErrorMessage({ name: "NotReadableError" })).toContain(
      "busy",
    );
    expect(page.cameraErrorMessage(new Error("x"))).toContain(
      "Couldn’t start the camera",
    );
  });
});
