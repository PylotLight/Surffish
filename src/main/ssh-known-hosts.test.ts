import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadKnownHostVerifier } from "./ssh-known-hosts.ts";

function hashHost(host: string): string {
  const salt = Buffer.from("fixed-known-host-salt");
  const hash = createHmac("sha1", salt).update(host).digest("base64");
  return `|1|${salt.toString("base64")}|${hash}`;
}

function createKnownHosts(contents: string): { home: string; file: string } {
  const home = mkdtempSync(join(tmpdir(), "surffish-known-hosts-"));
  const file = join(home, "known_hosts");
  writeFileSync(file, contents);
  return { home, file };
}

test("accepts an exact key from a hashed known_hosts hostname", async () => {
  const key = Buffer.from("host-key-blob");
  const { home, file } = createKnownHosts(
    `${hashHost("nas.local")} ssh-ed25519 ${key.toString("base64")} nas\n`,
  );
  try {
    const verifier = await loadKnownHostVerifier(["nas.local"], [file]);
    assert.equal(verifier.verify(key), true);
    assert.equal(verifier.error(), null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("matches wildcard host patterns and honors a negative pattern", async () => {
  const key = Buffer.from("wildcard-host-key");
  const { home, file } = createKnownHosts(
    `nas?.local,!nasx.local ssh-ed25519 ${key.toString("base64")}\n`,
  );
  try {
    const included = await loadKnownHostVerifier(["nas1.local"], [file]);
    const excluded = await loadKnownHostVerifier(["nasx.local"], [file]);
    assert.equal(included.verify(key), true);
    assert.equal(excluded.verify(key), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("rejects an unrecognized key for a previously known host", async () => {
  const trustedKey = Buffer.from("old-key");
  const changedKey = Buffer.from("new-key");
  const { home, file } = createKnownHosts(
    `nas ssh-ed25519 ${trustedKey.toString("base64")}\n`,
  );
  try {
    const verifier = await loadKnownHostVerifier(["nas"], [file]);
    assert.equal(verifier.verify(changedKey), false);
    assert.match(verifier.error() ?? "", /changed/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("rejects an unknown host key instead of accepting it on first use", async () => {
  const { home, file } = createKnownHosts("");
  try {
    const verifier = await loadKnownHostVerifier(["nas"], [file]);
    assert.equal(verifier.verify(Buffer.from("new-key")), false);
    assert.match(verifier.error() ?? "", /not trusted/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("rejects a revoked key even when its key blob is present", async () => {
  const revokedKey = Buffer.from("revoked-key");
  const { home, file } = createKnownHosts(
    `@revoked nas ssh-ed25519 ${revokedKey.toString("base64")}\n`,
  );
  try {
    const verifier = await loadKnownHostVerifier(["nas"], [file]);
    assert.equal(verifier.verify(revokedKey), false);
    assert.match(verifier.error() ?? "", /revoked/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("does not accept a matching CA record as an ordinary host key", async () => {
  const caKey = Buffer.from("ca-key");
  const { home, file } = createKnownHosts(
    `@cert-authority nas ssh-ed25519 ${caKey.toString("base64")}\n`,
  );
  try {
    const verifier = await loadKnownHostVerifier(["nas"], [file]);
    assert.equal(verifier.verify(caKey), false);
    assert.match(verifier.error() ?? "", /certificates are not supported/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
