/** The narrow API the editor preload exposes (src/preload/pdf-editor.cjs). */
export type PdfEditorCommand = 'save' | 'undo' | 'redo'
export type PdfEditorLoadResult =
  | { ok: true; name: string; sourceUrl: string; local: boolean; bytes: Uint8Array }
  | { ok: false; name: string; sourceUrl: string; error: string }

export interface SurffishPdfBridge {
  load(): Promise<PdfEditorLoadResult>
  save(bytes: Uint8Array): Promise<{ saved: boolean; filename?: string }>
  setDirty(dirty: boolean): void
  backToViewer(): void
  onCommand(callback: (command: PdfEditorCommand) => void): void
}

export function getBridge(): SurffishPdfBridge {
  const bridge = (window as unknown as { surffishPdf?: SurffishPdfBridge }).surffishPdf
  if (!bridge) throw new Error('The PDF editor bridge is unavailable.')
  return bridge
}
