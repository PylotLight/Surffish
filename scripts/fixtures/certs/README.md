Test-only certificates for `src/main/certificate-inspect.test.ts` and `scripts/electron-certificates-smoke.cjs`.
Never trusted by Surffish outside tests (the smoke passes `test-root.pem` through `SURFFISH_TEST_TRUST_ANCHORS`,
which only an unpackaged build reads). The keys are throwaway and intentionally public.

- `test-root.pem`: RSA root CA (key discarded) → `test-intermediate.pem` (EC, key discarded) → `trusted-leaf.pem`
  (`trusted.surffish.test`, `localhost`, `127.0.0.1`; key `trusted-leaf.key`).
- `self-signed.pem`: self-signed EC leaf for `selfsigned.surffish.test` / `127.0.0.1` (key `self-signed.key`),
  shaped like a UniFi gateway's certificate.
