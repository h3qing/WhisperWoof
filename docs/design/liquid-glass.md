# Liquid glass in Mando's hue: implementation notes

The design system itself (principles, palette, type, layout, components) is in
`DESIGN.md`. This page is how it's built. Tokens and utilities live in
`src/index.css`.

## Layers

1. **Mando backdrop.** `<div className="mando-field" aria-hidden />` as the
   first child of a `relative` window root (control panel, onboarding,
   permissions gate). Three still radial gradients (`--field-a/b/c`) over
   `--color-background`. Glass picks its color up from here; glass itself is
   not painted caramel.
2. **Content: sheets.** History, notes, settings rows, forms. Solid
   `bg-card shadow-card` at `rounded-[var(--radius-sheet)]` (22px), no
   border. A panel nested in a sheet uses `bg-surface-1` at the sheet radius
   minus its inset (14px for settings groups). Never glass.
3. **Functional layer: glass.**
   - `glass`: popovers, toasts, the non-native live panel, capsule groups.
   - `glass-thick`: the sidebar, the notes folder column, the settings
     window, menus and select lists (text-heavy, so more opaque).
   - `glass-rim`: the 1px specular gradient ring. It uses `::before`, so add
     it only to an element that is already positioned (relative, absolute or
     fixed): the sidebar, the settings window, dialogs, the live panel.
   - `glass-tint`: the one caramel glass action.
   - `glass-clear`: only over rich imagery; unused today.
   - No glass on glass: an item inside a glass panel uses `bg-select` or a
     transparent hover (`hover:bg-[var(--glass-hover)]`, solid under Reduce
     Transparency), never glass again.

`glass` and `glass-thick` draw the rim and sheen with inset shadows and a
background image, not pseudo-elements, so they are safe on Radix content that
positions itself.

## The signature: `live-words`

The provisional tail of a live dictation is wrapped in
`<span className="live-words">`: a gradient sheen over `--color-live-glass`
with a 1px inset `--color-live` outline, `box-decoration-break: clone` so it
wraps cleanly. Used by `LiveDictationPanel` (pinned by its test), the
dictation-mode demo in Settings, and the website hero. Don't reuse it as
decoration.

## Color

- Tokens only: `primary`, `foreground`, `muted-foreground`, `faint`, `card`,
  `surface-0..3`, `border*`, `select`, `live`, `live-glass`, `mando*`,
  `success|warning|destructive`. No hex or rgba literals in UI code.
- Both themes are checked for every surface. `.dark` overrides the tokens; it
  is its own palette, not an inversion.
- `controlPanelBackground()` in `src/helpers/windowConfig.js` must equal
  `--color-background` in both themes (the window is painted before the
  renderer loads). `window-position.test.ts` reads `index.css` to enforce it.

## Shape

`rounded-full` for every control; `rounded-lg` (12px) for rows and text
areas; `rounded-[var(--radius-sheet)]` (22px) for sheets;
`rounded-[var(--radius-window)]` / `rounded-window` (26px) for the sidebar,
settings window and dialogs. Nest: child radius = parent radius − inset.

## Accessibility

`prefers-reduced-transparency` makes glass opaque (sheet colors, no blur,
no sheen); `prefers-contrast: more` makes glass more opaque and hairlines
stronger; `prefers-reduced-motion` switches transitions off. Don't add
effects that bypass these (for example a hard-coded `backdrop-blur-xl` next
to your own translucent background): use the utilities.

## Native vibrancy (macOS)

Floating windows whose content is a single panel use Electron `vibrancy`
(real desktop blur, native rounded corners). The window must be the panel's
size: any transparent margin becomes glass too. CSS then adds only a light
Mando tint over the native material (`bg-mando/[0.07]`), with no CSS radius:
the window's native corners are the panel's corners.

- Dictation overlay: only `LIVE_PANEL` carries a material (`vibrancyForSize`
  in `src/helpers/windowConfig.js`). Idle live mode (`LIVE`, same rectangle,
  just Mando) and the toast/menu sizes stay transparent, and the live panel
  falls back to CSS `glass` there. That transparent window has no desktop to
  blur, so its CSS glass is made nearly opaque (`:root:has(.dictation-window)`).
- Agent overlay: the panel fills the window, so the window is the material.
- Meeting/update notifications keep CSS glass: they have a margin and slide in.
- The control panel stays an opaque window with the CSS backdrop: native
  vibrancy would take its color from the wallpaper and lose Mando's.
- `nativeTheme.themeSource` follows the app's theme (`app-theme-changed` IPC
  from `useTheme`), so the native material and the token colors on it agree.
