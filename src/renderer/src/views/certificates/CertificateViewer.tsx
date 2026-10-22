import { useState } from "react";
import {
  certificateLabel,
  certificateVerdict,
  type CertificateDetails,
  type DistinguishedName,
  type SiteCertificateInfo,
} from "../../../../shared/certificates";
import "./CertificateViewer.css";

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function publicKeyText(details: CertificateDetails): string {
  const key = details.publicKey;
  if (!key) return "Unknown";
  if (key.type === "rsa" || key.type === "rsa-pss" || key.type === "dsa")
    return `${key.type.toUpperCase()}${key.bits ? ` ${key.bits} bits` : ""}`;
  if (key.type === "ec")
    return `EC${key.curve ? ` (${key.curve === "prime256v1" ? "P-256" : key.curve === "secp384r1" ? "P-384" : key.curve === "secp521r1" ? "P-521" : key.curve})` : ""}`;
  return key.type.toUpperCase();
}

function NameRows({ name }: { name: DistinguishedName }): React.JSX.Element {
  const rows: Array<[string, string | null]> = [
    ["Common name (CN)", name.commonName],
    ["Organisation (O)", name.organization],
    ["Organisational unit (OU)", name.organizationalUnit],
    ["Locality (L)", name.locality],
    ["State (ST)", name.state],
    ["Country (C)", name.country],
  ];
  const shown = rows.filter(([, value]) => value);
  if (shown.length === 0)
    return (
      <div className="cert-field">
        <dt>Name</dt>
        <dd className="is-muted">Not in certificate</dd>
      </div>
    );
  return (
    <>
      {shown.map(([label, value]) => (
        <div className="cert-field" key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </>
  );
}

function Field({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className="cert-field">
      <dt>{label}</dt>
      <dd className={mono ? "is-mono" : undefined}>{children}</dd>
    </div>
  );
}

/**
 * Certificate viewer: verdict, the chain (each certificate selectable) and every field of the
 * selected one. Used by the site menu (toolbar) and the certificate error page (content).
 */
export function CertificateViewer({
  info,
  onBack,
}: {
  info: SiteCertificateInfo;
  onBack?: () => void;
}): React.JSX.Element {
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(false);
  const verdict = certificateVerdict(info);
  const cert =
    info.chain[Math.min(selected, Math.max(0, info.chain.length - 1))];
  const now = Date.now();
  return (
    <div className="cert-viewer" aria-label={`Certificate for ${info.host}`}>
      <div className="cert-viewer-header">
        {onBack && (
          <button
            type="button"
            className="cert-viewer-back"
            aria-label="Back"
            title="Back"
            onClick={onBack}
          >
            ‹
          </button>
        )}
        <span className="cert-viewer-heading">
          <strong>Certificate viewer</strong>
          <span>{info.host}</span>
        </span>
      </div>
      <div
        className={`cert-verdict ${verdict.valid ? "is-valid" : "is-invalid"}`}
        role="status"
      >
        <strong>{verdict.title}</strong>
        <span>{verdict.detail}</span>
        {info.error && (
          <code>
            {info.status === "os-trusted"
              ? `Built-in check: ${info.error}`
              : info.error}
          </code>
        )}
      </div>
      {info.chain.length > 1 && (
        <div
          className="cert-chain"
          role="tablist"
          aria-label="Certificate chain"
        >
          {info.chain.map((entry, index) => (
            <button
              key={`${entry.fingerprintSha256}-${index}`}
              type="button"
              role="tab"
              aria-selected={index === selected}
              className={`cert-chain-entry${index === selected ? " is-selected" : ""}`}
              style={{ paddingLeft: `${8 + Math.min(index, 4) * 12}px` }}
              onClick={() => {
                setSelected(index);
                setCopied(false);
              }}
            >
              <span className="cert-chain-kind">
                {index === 0 ? "Site" : entry.selfSigned ? "Root" : "Issuer"}
              </span>
              <span className="cert-chain-name">{certificateLabel(entry)}</span>
            </button>
          ))}
        </div>
      )}
      {cert ? (
        <dl className="cert-fields">
          <div className="cert-section">Issued to</div>
          <NameRows name={cert.subject} />
          <div className="cert-section">Issued by</div>
          <NameRows name={cert.issuer} />
          <div className="cert-section">Validity</div>
          <Field label="Issued on">{formatDate(cert.validFrom)}</Field>
          <Field label="Expires on">
            {formatDate(cert.validTo)}
            {new Date(cert.validTo).getTime() < now && (
              <span className="cert-badge is-bad">Expired</span>
            )}
            {new Date(cert.validFrom).getTime() > now && (
              <span className="cert-badge is-bad">Not yet valid</span>
            )}
          </Field>
          <div className="cert-section">Fingerprints</div>
          <Field label="SHA-256" mono>
            {cert.fingerprintSha256}
          </Field>
          <Field label="SHA-1" mono>
            {cert.fingerprintSha1}
          </Field>
          <div className="cert-section">Details</div>
          <Field label="Serial number" mono>
            {cert.serialNumber}
          </Field>
          <Field label="Subject alternative names">
            {cert.subjectAltNames.length === 0 ? (
              <span className="is-muted">None</span>
            ) : (
              <ul className="cert-san-list">
                {cert.subjectAltNames.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            )}
          </Field>
          <Field label="Public key">{publicKeyText(cert)}</Field>
          {cert.keyUsage.length > 0 && (
            <Field label="Extended key usage">{cert.keyUsage.join(", ")}</Field>
          )}
          <Field label="Certificate authority">
            {cert.isCA ? "Yes" : "No"}
            {cert.selfSigned ? " (self-signed)" : ""}
          </Field>
        </dl>
      ) : (
        <p className="cert-empty">
          No certificate details were captured for this page. Reload it to
          capture them.
        </p>
      )}
      <div className="cert-viewer-actions">
        {cert && (
          <button
            type="button"
            className="cert-action"
            onClick={() => {
              void navigator.clipboard
                .writeText(cert.pem)
                .then(() => setCopied(true))
                .catch(() => undefined);
            }}
          >
            {copied ? "Copied PEM" : "Copy PEM"}
          </button>
        )}
        {info.nativeViewer && (
          <button
            type="button"
            className="cert-action"
            onClick={() =>
              void window.api.browser.certificate
                .showNative()
                .catch(() => undefined)
            }
          >
            Show in macOS…
          </button>
        )}
      </div>
    </div>
  );
}
