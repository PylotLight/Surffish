import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listSshHostAliases, resolveSshConnection } from "./ssh-config.ts";

function createHome(): { home: string; ssh: string } {
  const home = mkdtempSync(join(tmpdir(), "surffish-ssh-config-"));
  const ssh = join(home, ".ssh");
  mkdirSync(ssh, { recursive: true });
  return { home, ssh };
}

test("discovers concrete aliases from OpenSSH Host entries and included files", async () => {
  const { home, ssh } = createHome();
  const includeDirectory = join(ssh, "config.d");
  mkdirSync(includeDirectory, { recursive: true });
  writeFileSync(
    join(ssh, "config"),
    [
      "# Hosts I use",
      "Host work-vpn jump-box",
      "  HostName example.net",
      "Host *.internal !blocked.internal",
      'Host "quoted-host" # comments after a directive are ignored',
      "Host *",
      "Include config.d/*.conf",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(includeDirectory, "office.conf"),
    "Host office+vpn\n  HostName office.example.net\n",
  );
  writeFileSync(
    join(includeDirectory, "nested.conf"),
    "Include nested/hosts.conf\n",
  );
  mkdirSync(join(includeDirectory, "nested"));
  writeFileSync(
    join(includeDirectory, "nested", "hosts.conf"),
    "Host home-nas\n",
  );

  try {
    assert.deepEqual(await listSshHostAliases(home), [
      "home-nas",
      "jump-box",
      "office+vpn",
      "quoted-host",
      "work-vpn",
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("resolves HostName, User, Port, IdentityFile, known_hosts, and first-value precedence", async () => {
  const { home, ssh } = createHome();
  const includeDirectory = join(ssh, "config.d");
  mkdirSync(includeDirectory);
  mkdirSync(join(ssh, "keys"));
  writeFileSync(join(ssh, "keys", "nas_key"), "test-key");
  writeFileSync(join(ssh, "nas-known-hosts"), "");
  writeFileSync(
    join(ssh, "config"),
    [
      "Host *",
      "  User first-user",
      "  Port 22",
      "  Include config.d/nas.conf",
      "Host nas",
      "  User later-user",
      "  Port 2222",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(includeDirectory, "nas.conf"),
    [
      "Host nas",
      "  HostName 192.0.2.55",
      "  IdentityFile ~/.ssh/keys/nas_key",
      "  UserKnownHostsFile ~/.ssh/nas-known-hosts",
      "  HostKeyAlias nas-entry",
      "",
    ].join("\n"),
  );

  try {
    const resolved = await resolveSshConnection("nas", home, "local-user");
    assert.deepEqual(resolved, {
      target: "nas",
      host: "192.0.2.55",
      port: 22,
      username: "first-user",
      identityFiles: [join(ssh, "keys", "nas_key")],
      hostKeyNames: ["nas-entry"],
      knownHostsFiles: [
        join(ssh, "nas-known-hosts"),
        "/etc/ssh/ssh_known_hosts",
        "/etc/ssh/ssh_known_hosts2",
      ],
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("uses explicit user@host and non-default port for host-key lookup", async () => {
  const { home, ssh } = createHome();
  writeFileSync(join(ssh, "id_ed25519"), "test-key");
  writeFileSync(
    join(ssh, "config"),
    "Host nas\n  HostName nas.local\n  Port 2222\n  IdentityFile ~/.ssh/id_ed25519\n",
  );
  try {
    const resolved = await resolveSshConnection(
      "backup@nas",
      home,
      "local-user",
    );
    assert.equal(resolved.username, "backup");
    assert.equal(resolved.host, "nas.local");
    assert.equal(resolved.port, 2222);
    assert.deepEqual(resolved.hostKeyNames, ["[nas]:2222", "[nas.local]:2222"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("rejects configured ProxyCommand and ProxyJump rather than silently bypassing them", async () => {
  const { home, ssh } = createHome();
  writeFileSync(join(ssh, "config"), "Host nas\n  ProxyJump jump-box\n");
  try {
    await assert.rejects(
      resolveSshConnection("nas", home, "tester"),
      /ProxyJump is not supported/,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("does not apply an Include nested inside a nonmatching Host block", async () => {
  const { home, ssh } = createHome();
  const includeDirectory = join(ssh, "config.d");
  mkdirSync(includeDirectory);
  writeFileSync(join(ssh, "id_ed25519"), "test-key");
  writeFileSync(
    join(ssh, "config"),
    "Host other\n  Include config.d/other.conf\nHost nas\n  IdentityFile ~/.ssh/id_ed25519\n",
  );
  writeFileSync(
    join(includeDirectory, "other.conf"),
    "Host other\n  ProxyJump jump-box\n",
  );
  try {
    const resolved = await resolveSshConnection("nas", home, "tester");
    assert.equal(resolved.target, "nas");
    assert.deepEqual(resolved.identityFiles, [join(ssh, "id_ed25519")]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("returns an empty list when the user has no SSH config", async () => {
  const { home } = createHome();
  try {
    assert.deepEqual(await listSshHostAliases(home), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
