import { describe, expect, test } from "bun:test";
import {
  buildOpenSshDynamicForwardArgs,
  parseSshTarget,
  validateSshTarget,
} from "./ssh-tunnel";

describe("managed OpenSSH SOCKS tunnel config", () => {
  test("uses a host alias as one argument with a loopback-only dynamic forward", () => {
    expect(buildOpenSshDynamicForwardArgs("work-vpn", 1080)).toEqual([
      "-N",
      "-D",
      "127.0.0.1:1080",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "BatchMode=yes",
      "-o",
      "ServerAliveInterval=30",
      "-o",
      "ServerAliveCountMax=3",
      "work-vpn",
    ]);
  });

  test("accepts an explicit user@host destination and trims it", () => {
    expect(validateSshTarget("  alice@example.net ")).toBe("alice@example.net");
    expect(parseSshTarget("  alice@example.net ")).toBe("alice@example.net");
  });

  test("rejects options, whitespace, shell fragments, and invalid ports", () => {
    for (const value of [
      "-oProxyCommand=bad",
      "host with spaces",
      "host;id",
      "",
    ]) {
      expect(() => buildOpenSshDynamicForwardArgs(value, 1080)).toThrow();
    }
    expect(() => buildOpenSshDynamicForwardArgs("work", 0)).toThrow();
    expect(() => buildOpenSshDynamicForwardArgs("work", 65536)).toThrow();
    expect(parseSshTarget("-oProxyCommand=bad")).toBe("");
  });
});
