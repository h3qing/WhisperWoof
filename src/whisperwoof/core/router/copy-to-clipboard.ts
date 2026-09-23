// Copy text from the dictation overlay (Fn+T route, "keep in clipboard").
// The overlay window never takes focus, and Chromium rejects
// navigator.clipboard.writeText from an unfocused document, so the write goes
// through the main process's native clipboard. The renderer API is only a
// fallback for a browser preview without the Electron bridge.

interface ClipboardBridge {
  writeClipboard?: (text: string) => Promise<unknown>;
}

export async function copyTextFromOverlay(
  text: string,
  bridge: ClipboardBridge | undefined,
  rendererWrite: (text: string) => Promise<void>
): Promise<void> {
  if (bridge?.writeClipboard) {
    await bridge.writeClipboard(text);
    return;
  }
  await rendererWrite(text);
}
