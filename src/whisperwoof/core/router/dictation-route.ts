// Where a dictation goes, decided by the hotkey held at release (hotkey = intent).

export type DictationRoute = "paste-at-cursor" | "copy-to-clipboard" | "save-as-markdown" | "project";

const ROUTES: Readonly<Record<string, DictationRoute>> = Object.freeze({
  "Fn+T": "copy-to-clipboard",
  "Fn+N": "save-as-markdown",
  "Fn+P": "project",
});

export const ROUTED_HOTKEYS: readonly string[] = Object.freeze(Object.keys(ROUTES));

export function routeForHotkey(hotkey: string | null | undefined): DictationRoute {
  return (hotkey && ROUTES[hotkey]) || "paste-at-cursor";
}
