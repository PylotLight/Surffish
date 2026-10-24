import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listSshHostAliases } from "./ssh-config.ts";

test("discovers concrete aliases from OpenSSH Host entries and included files", async () => {
  const home = mkdtempSync(join(tmpdir(), "surffish-ssh-config-"));
  const sshDirectory = join(home, ".ssh");
  const includeDirectory = join(sshDirectory, "config.d");
  mkdirSync(includeDirectory, { recursive: true });
  writeFileSync(
    join(sshDirectory, "config"),
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

test("returns an empty list when the user has no SSH config", async () => {
  const home = mkdtempSync(join(tmpdir(), "surffish-ssh-config-empty-"));
  try {
    assert.deepEqual(await listSshHostAliases(home), []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
