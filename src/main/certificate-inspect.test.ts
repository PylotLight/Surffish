import { describe, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  certificateChainDetails,
  certificateDetailsFromPem,
  chainTrustedByAnchors,
  parseDistinguishedName,
} from "./certificate-inspect.ts";

const dir = join(import.meta.dir, "../../scripts/fixtures/certs");
const read = (name: string): string => readFileSync(join(dir, name), "utf8");
const root = read("test-root.pem");
const intermediate = read("test-intermediate.pem");
const leaf = read("trusted-leaf.pem");
const selfSigned = read("self-signed.pem");
const NOW = new Date("2030-01-01T00:00:00Z");

describe("certificate details", () => {
  test("pulls subject, issuer, validity, serial, fingerprints, SANs, key and usages", () => {
    const details = certificateDetailsFromPem(leaf);
    expect(details).not.toBeNull();
    if (!details) return;
    expect(details.subject).toEqual({
      commonName: "trusted.surffish.test",
      organization: "Surffish Test",
      organizationalUnit: "Gateway",
      locality: null,
      state: null,
      country: "AU",
    });
    expect(details.issuer.commonName).toBe("Surffish Test Intermediate CA");
    expect(details.subjectText).toBe(
      "CN=trusted.surffish.test, OU=Gateway, O=Surffish Test, C=AU",
    );
    expect(details.subjectAltNames).toEqual([
      "DNS:trusted.surffish.test",
      "DNS:localhost",
      "IP Address:127.0.0.1",
    ]);
    expect(details.fingerprintSha256).toMatch(
      /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/,
    );
    expect(details.fingerprintSha1).toMatch(/^([0-9A-F]{2}:){19}[0-9A-F]{2}$/);
    expect(details.fingerprintSha256).toBe(
      new X509Certificate(leaf).fingerprint256,
    );
    expect(details.serialNumber).toMatch(/^([0-9A-F]{2}:)*[0-9A-F]{2}$/);
    expect(new Date(details.validFrom).getTime()).toBeLessThan(
      new Date(details.validTo).getTime(),
    );
    expect(details.publicKey).toEqual({
      type: "ec",
      bits: null,
      curve: "prime256v1",
    });
    expect(details.keyUsage).toEqual(["TLS Web Server Authentication"]);
    expect(details.isCA).toBe(false);
    expect(details.selfSigned).toBe(false);
    expect(details.pem).toContain("BEGIN CERTIFICATE");
  });
  test("roots and self-signed leaves", () => {
    const ca = certificateDetailsFromPem(root);
    expect(ca?.isCA).toBe(true);
    expect(ca?.selfSigned).toBe(true);
    expect(ca?.publicKey).toEqual({ type: "rsa", bits: 2048, curve: null });
    expect(certificateDetailsFromPem(selfSigned)?.selfSigned).toBe(true);
    expect(certificateDetailsFromPem("not a cert")).toBeNull();
    expect(
      certificateChainDetails([leaf, "junk", intermediate]).map(
        (entry) => entry.subject.commonName,
      ),
    ).toEqual(["trusted.surffish.test", "Surffish Test Intermediate CA"]);
  });
  test("distinguished names with repeated keys", () => {
    expect(parseDistinguishedName("C=US\nO=Acme\nOU=A\nOU=B\nCN=x")).toEqual({
      commonName: "x",
      organization: "Acme",
      organizationalUnit: "A, B",
      locality: null,
      state: null,
      country: "US",
    });
  });
});

describe("OS-trust fallback chain check", () => {
  const anchors = [new X509Certificate(root)];
  test("a chain to a trusted root verifies for a name or IP in its SANs", () => {
    expect(
      chainTrustedByAnchors(
        [leaf, intermediate],
        "trusted.surffish.test",
        anchors,
        NOW,
      ),
    ).toBe(true);
    expect(
      chainTrustedByAnchors(
        [leaf, intermediate],
        "TRUSTED.surffish.test",
        anchors,
        NOW,
      ),
    ).toBe(true);
    expect(
      chainTrustedByAnchors([leaf, intermediate], "127.0.0.1", anchors, NOW),
    ).toBe(true);
    expect(
      chainTrustedByAnchors(
        [leaf, intermediate, root],
        "localhost",
        anchors,
        NOW,
      ),
    ).toBe(true);
  });
  test("wrong host, missing intermediate, untrusted root, expired or not-yet-valid fail", () => {
    expect(
      chainTrustedByAnchors([leaf, intermediate], "evil.example", anchors, NOW),
    ).toBe(false);
    expect(
      chainTrustedByAnchors([leaf, intermediate], "192.168.1.1", anchors, NOW),
    ).toBe(false);
    expect(
      chainTrustedByAnchors([leaf], "trusted.surffish.test", anchors, NOW),
    ).toBe(false);
    expect(
      chainTrustedByAnchors(
        [leaf, intermediate],
        "trusted.surffish.test",
        [],
        NOW,
      ),
    ).toBe(false);
    expect(
      chainTrustedByAnchors(
        [leaf, intermediate],
        "trusted.surffish.test",
        [new X509Certificate(selfSigned)],
        NOW,
      ),
    ).toBe(false);
    expect(
      chainTrustedByAnchors(
        [leaf, intermediate],
        "trusted.surffish.test",
        anchors,
        new Date("2200-01-01T00:00:00Z"),
      ),
    ).toBe(false);
    expect(
      chainTrustedByAnchors(
        [leaf, intermediate],
        "trusted.surffish.test",
        anchors,
        new Date("2000-01-01T00:00:00Z"),
      ),
    ).toBe(false);
  });
  test("a leaf cannot act as an intermediate, and the CN alone never matches", () => {
    // The self-signed leaf is not a CA: a chain "through" it must not verify.
    expect(
      chainTrustedByAnchors(
        [selfSigned, leaf],
        "selfsigned.surffish.test",
        anchors,
        NOW,
      ),
    ).toBe(false);
  });
  test("a user-trusted self-signed certificate is its own anchor", () => {
    expect(
      chainTrustedByAnchors(
        [selfSigned],
        "selfsigned.surffish.test",
        [new X509Certificate(selfSigned)],
        NOW,
      ),
    ).toBe(true);
    expect(
      chainTrustedByAnchors(
        [selfSigned],
        "other.surffish.test",
        [new X509Certificate(selfSigned)],
        NOW,
      ),
    ).toBe(false);
  });
});
