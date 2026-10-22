export interface ShellIpcSenderCheck {
  registered: boolean;
  senderIsMainFrame: boolean;
  currentDocumentUrl: string;
  expectedDocumentUrl: string;
}

/** Compare the complete app document identity, ignoring only an inert URL fragment. */
export function isExpectedRendererDocument(
  currentUrl: string,
  expectedUrl: string,
): boolean {
  try {
    const current = new URL(currentUrl);
    const expected = new URL(expectedUrl);
    current.hash = "";
    expected.hash = "";
    return current.href === expected.href;
  } catch {
    return false;
  }
}

/** Central policy used by privileged IPC: registered surface, main frame, expected local document. */
export function isAuthorizedShellIpcSender(
  check: ShellIpcSenderCheck,
): boolean {
  return (
    check.registered &&
    check.senderIsMainFrame &&
    isExpectedRendererDocument(
      check.currentDocumentUrl,
      check.expectedDocumentUrl,
    )
  );
}
