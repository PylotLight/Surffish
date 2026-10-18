/** The narrow API the editor preload exposes (src/preload/pdf-editor.cjs). */
import type { NewSavedSignature, SavedSignature } from '../../../shared/pdf-signatures'

export type PdfEditorCommand = 'save' | 'undo' | 'redo'
export interface SavedSignaturesResult { signatures: SavedSignature[]; persistent: boolean }
export type PdfEditorLoadResult =
  | { ok: true; name: string; sourceUrl: string; local: boolean; bytes: Uint8Array }
  | { ok: false; name: string; sourceUrl: string; error: string }

export interface SurffishPdfBridge {
  load(): Promise<PdfEditorLoadResult>
  save(bytes: Uint8Array, options?: { saveAs?: boolean }): Promise<{ saved: boolean; filename?: string }>
  signatures: {
    list(): Promise<SavedSignaturesResult>
    add(signature: NewSavedSignature): Promise<SavedSignaturesResult>
    remove(id: string): Promise<SavedSignaturesResult>
  }
  setDirty(dirty: boolean): void
  backToViewer(): void
  onCommand(callback: (command: PdfEditorCommand) => void): void
}

export function getBridge(): SurffishPdfBridge {
  const bridge = (window as unknown as { surffishPdf?: SurffishPdfBridge }).surffishPdf
  if (!bridge) throw new Error('The PDF editor bridge is unavailable.')
  return bridge
}
