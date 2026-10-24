import { describe, expect, test } from "bun:test";
import {
  browserProxyEndpoint,
  describeSshTunnelStatus,
  networkHelperUpstreamSettings,
  SURFFISH_NETWORK_HELPER,
  type SshTunnelStatus,
} from "./network-helper";
import type { BrowserProxySettings } from "./types";
import {
  buildOpenSshDynamicForwardArgs,
  DEFAULT_SSH_CLIENT,
  parseSshClient,
  parseSshTarget,
  validateSshClient,
  validateSshTarget,
} from "./ssh-tunnel";

const connected: SshTunnelStatus = {
  configured: true,
  enabled: true,
  target: "work-vpn",
  host: "127.0.0.1",
  port: 54321,
  starting: false,
  running: true,
  error: null,
};

const settings: BrowserProxySettings = {
  enabled: true,
  host: "127.0.0.1",
  port: 1085,
  sshHost: "work-vpn",
  bypassLocalNetwork: true,
};

describe("managed SSH target validation", () => {
  test("accepts and trims one alias or explicit user@host", () => {
    expect(validateSshTarget("  alice@example.net ")).toBe("alice@example.net");
    expect(parseSshTarget("  nas ")).toBe("nas");
    expect(parseSshTarget("  alice@example.net ")).toBe("alice@example.net");
  });

  test("rejects options, whitespace, and shell fragments", () => {
    for (const value of ["-oProxyCommand=bad", "host with spaces", "host;id"]) {
      expect(() => validateSshTarget(value)).toThrow();
    }
    expect(parseSshTarget("-oProxyCommand=bad")).toBe("");
  });
});

describe("system OpenSSH dynamic forward args", () => {
  test("passes the alias as one argument after -- with a loopback-only dynamic forward", () => {
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
      "--",
      "work-vpn",
    ]);
  });

  test("adds -v only for SURFFISH_SSH_DEBUG tracing", () => {
    const args = buildOpenSshDynamicForwardArgs(" alice@example.net ", 2000, {
      verbose: true,
    });
    expect(args[0]).toBe("-v");
    expect(args.at(-1)).toBe("alice@example.net");
  });

  test("rejects options, whitespace, shell fragments, blanks and bad ports", () => {
    for (const value of [
      "-oProxyCommand=bad",
      "host with spaces",
      "host;id",
      "",
    ])
      expect(() => buildOpenSshDynamicForwardArgs(value, 1080)).toThrow();
    expect(() => buildOpenSshDynamicForwardArgs("work", 0)).toThrow();
    expect(() => buildOpenSshDynamicForwardArgs("work", 65536)).toThrow();
  });
});

describe("SSH client choice", () => {
  test("defaults to the built-in client for missing or unknown saved values", () => {
    expect(DEFAULT_SSH_CLIENT).toBe("builtin");
    expect(parseSshClient(undefined)).toBe("builtin");
    expect(parseSshClient("openssh")).toBe("builtin");
    expect(parseSshClient("system")).toBe("system");
  });

  test("validates renderer input", () => {
    expect(validateSshClient(undefined)).toBe("builtin");
    expect(validateSshClient("system")).toBe("system");
    expect(() => validateSshClient("bash")).toThrow();
  });
});

describe("managed SSH endpoint selection", () => {
  test("routes Surffish and other apps through the configured endpoint", () => {
    expect(browserProxyEndpoint(settings)).toMatchObject({
      enabled: true,
      host: SURFFISH_NETWORK_HELPER.host,
      port: settings.port,
      sshHost: "work-vpn",
    });
    expect(browserProxyEndpoint({ ...settings, port: 1088 }).port).toBe(1088);
  });

  test("keeps the private in-app SOCKS port internal to the helper", () => {
    expect(networkHelperUpstreamSettings(settings, connected)).toMatchObject({
      enabled: true,
      host: "127.0.0.1",
      port: 54321,
    });
    expect(browserProxyEndpoint(settings).port).toBe(settings.port);
  });

  test("fails closed until a configured SSH tunnel is ready", () => {
    expect(
      networkHelperUpstreamSettings(settings, {
        ...connected,
        running: false,
        port: null,
      }),
    ).toMatchObject({ enabled: false });
  });

  test("leaves manual proxy settings unchanged without a managed SSH host", () => {
    const manual = { ...settings, sshHost: "" };
    expect(browserProxyEndpoint(manual)).toEqual(manual);
    expect(
      networkHelperUpstreamSettings(manual, {
        ...connected,
        configured: false,
        enabled: false,
        target: null,
        running: false,
        port: null,
      }),
    ).toEqual(manual);
  });
});

describe("managed SSH status summary", () => {
  test("confirms the SSH session and shared public endpoint", () => {
    expect(
      describeSshTunnelStatus({ ...connected, port: settings.port }),
    ).toEqual({
      state: "connected",
      title: "SSH session connected",
      detail:
        "Connected to work-vpn; Surffish and other apps use SOCKS5 at 127.0.0.1:1085.",
    });
  });

  test("shows checking, unconfigured, disabled, connecting, and failed states", () => {
    expect(describeSshTunnelStatus(null).state).toBe("checking");
    expect(
      describeSshTunnelStatus({
        ...connected,
        configured: false,
        target: null,
        enabled: false,
        running: false,
      }),
    ).toMatchObject({
      state: "unconfigured",
      title: "No managed SSH tunnel",
      detail:
        "Enter an SSH host alias above to have Surffish start a tunnel. Without one, the SOCKS5 proxy setting expects an existing service at the configured host and port.",
    });
    expect(
      describeSshTunnelStatus({ ...connected, enabled: false, running: false })
        .state,
    ).toBe("disabled");
    expect(
      describeSshTunnelStatus({ ...connected, starting: true, running: false })
        .state,
    ).toBe("connecting");
    expect(
      describeSshTunnelStatus({
        ...connected,
        running: false,
        error: "Permission denied.",
      }),
    ).toMatchObject({
      state: "error",
      detail:
        "Surffish could not establish an SSH session to work-vpn: Permission denied.",
    });
  });
});
