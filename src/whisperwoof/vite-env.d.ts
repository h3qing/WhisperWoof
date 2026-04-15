/// <reference types="vite/client" />

// Electron preload bridge — the full shape lives in src/types/electron.ts (outside whisperwoof tsconfig).
// This minimal declaration silences TS2551 in whisperwoof UI files that access window.electronAPI.
interface Window {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  electronAPI: any;
}
