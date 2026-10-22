import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { extensionIdFromPublicKey, parseCrx } from "./crx.ts";
import { storedZip } from "./test-zip-fixture.ts";

function varint(value: number): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

function bytesField(field: number, value: Buffer): Buffer {
  return Buffer.concat([varint((field << 3) | 2), varint(value.length), value]);
}

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    publicDer: publicKey.export({ format: "der", type: "spki" }) as Buffer,
    privateKey,
  };
}

/** Build a CRX3 the way the Web Store does: publisher proof + an unrelated second proof. */
function buildCrx3(archive: Buffer, options: { tamperArchive?: boolean } = {}) {
  const publisher = keyPair();
  const other = keyPair();
  const crxId = createHash("sha256")
    .update(publisher.publicDer)
    .digest()
    .subarray(0, 16);
  const signedHeaderData = bytesField(1, crxId);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedHeaderData.length);
  const payload = Buffer.concat([
    Buffer.from("CRX3 SignedData\0", "binary"),
    length,
    signedHeaderData,
    archive,
  ]);
  const proof = (pair: ReturnType<typeof keyPair>) =>
    bytesField(
      2,
      Buffer.concat([
        bytesField(1, pair.publicDer),
        bytesField(2, sign("sha256", payload, pair.privateKey)),
      ]),
    );
  const header = Buffer.concat([
    proof(other),
    proof(publisher),
    bytesField(10000, signedHeaderData),
  ]);
  const prefix = Buffer.alloc(12);
  prefix.write("Cr24", 0, "binary");
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  const shipped = options.tamperArchive
    ? Buffer.from(archive.toString("binary").replace("1.0", "9.9"), "binary")
    : archive;
  return { crx: Buffer.concat([prefix, header, shipped]), publisher };
}

const archive = storedZip({
  "manifest.json": '{"manifest_version":3,"name":"Fixture","version":"1.0"}',
  "content.js": "console.log(1)",
});

test("extension IDs are the a–p encoding of the SPKI SHA-256 prefix", () => {
  const key = Buffer.from("fixture public key");
  const id = extensionIdFromPublicKey(key);
  assert.match(id, /^[a-p]{32}$/);
  const hex = createHash("sha256").update(key).digest("hex").slice(0, 32);
  assert.equal(
    id,
    [...hex]
      .map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16)))
      .join(""),
  );
});

test("parses a CRX3, finds the publisher proof, and verifies its signature", () => {
  const { crx, publisher } = buildCrx3(archive);
  const parsed = parseCrx(crx);
  assert.equal(parsed.format, 3);
  assert.equal(
    parsed.extensionId,
    extensionIdFromPublicKey(publisher.publicDer),
  );
  assert.deepEqual(parsed.publicKey, publisher.publicDer);
  assert.equal(parsed.signatureVerified, true);
  assert.deepEqual(parsed.archive, archive);
});

test("a CRX3 whose ZIP was altered after signing fails verification", () => {
  const parsed = parseCrx(buildCrx3(archive, { tamperArchive: true }).crx);
  assert.equal(parsed.signatureVerified, false);
});

test("a CRX3 whose crx_id matches no proof key is rejected", () => {
  const signed = bytesField(10000, bytesField(1, Buffer.alloc(16, 1)));
  const prefix = Buffer.alloc(12);
  prefix.write("Cr24", 0, "binary");
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(signed.length, 8);
  assert.throws(
    () => parseCrx(Buffer.concat([prefix, signed, archive])),
    /no publisher key matching/,
  );
});

test("parses a CRX2 package", () => {
  const pair = keyPair();
  const signature = sign("sha1", archive, pair.privateKey);
  const prefix = Buffer.alloc(16);
  prefix.write("Cr24", 0, "binary");
  prefix.writeUInt32LE(2, 4);
  prefix.writeUInt32LE(pair.publicDer.length, 8);
  prefix.writeUInt32LE(signature.length, 12);
  const parsed = parseCrx(
    Buffer.concat([prefix, pair.publicDer, signature, archive]),
  );
  assert.equal(parsed.format, 2);
  assert.equal(parsed.extensionId, extensionIdFromPublicKey(pair.publicDer));
  assert.equal(parsed.signatureVerified, true);
  assert.deepEqual(parsed.archive, archive);
});

test("rejects non-CRX data, unknown versions, and truncated headers", () => {
  assert.throws(() => parseCrx(Buffer.from("<html>not found</html>")), /Cr24/);
  const v4 = Buffer.alloc(12);
  v4.write("Cr24", 0, "binary");
  v4.writeUInt32LE(4, 4);
  assert.throws(() => parseCrx(v4), /version 4/);
  const truncated = Buffer.alloc(12);
  truncated.write("Cr24", 0, "binary");
  truncated.writeUInt32LE(3, 4);
  truncated.writeUInt32LE(9999, 8);
  assert.throws(() => parseCrx(truncated), /header size/);
});
