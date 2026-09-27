// The shortcut cheat sheet in Settings. The canonical defaults live in
// bridge/keybindings-pure.js, which is CommonJS (main process) and can't be
// imported into the renderer, so this mirrors it; shortcut-cheatsheet.test.ts
// fails if the two drift apart.

export const SHORTCUT_CHEATSHEET: Array<{ group: string; items: Array<{ key: string; label: string }> }> = [
  {
    group: "Recording",
    items: [
      { key: "Fn", label: "Toggle recording / paste at cursor" },
      { key: "CommandOrControl+K", label: "Command bar" },
    ],
  },
  {
    group: "Routing",
    items: [
      { key: "Fn+T", label: "Copy to clipboard" },
      { key: "Fn+N", label: "Save as Markdown" },
      { key: "Fn+P", label: "Route to project" },
    ],
  },
  {
    group: "Navigation",
    items: [
      { key: "CommandOrControl+H", label: "Open history" },
      { key: "CommandOrControl+P", label: "Open projects" },
      { key: "CommandOrControl+,", label: "Open settings" },
    ],
  },
];
