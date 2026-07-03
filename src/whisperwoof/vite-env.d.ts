/// <reference types="vite/client" />

// Electron preload bridge — pull in the real Window.electronAPI declaration from
// src/types/electron.ts instead of redeclaring it as `any` (a second declaration
// with a different type is a TS2717 error when the parent src tsconfig compiles
// both files together).
/// <reference path="../types/electron.ts" />
