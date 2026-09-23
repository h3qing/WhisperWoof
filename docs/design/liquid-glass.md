# Liquid glass in Mando's hue

WhisperWoof's UI follows Apple's Liquid Glass layering, tinted by Mando's coat.
Tokens and utilities live in `src/index.css`.

## Layers

1. **Colour field (content backdrop).** A slow, heavily blurred field of Mando
   hues behind each full window: `<div className="mando-field" aria-hidden />`
   as the first child of a `relative` window root. Strength is
   `--field-strength` (default 0.6). Glass picks its colour up from here —
   glass itself is not painted amber.
2. **Content.** Lists, cards, history entries, settings rows, forms. **Solid**:
   `bg-card` / `bg-surface-*` with `shadow-card`, radius `rounded-lg` (12px).
   Never glass: text on glass over a moving field is hard to read.
3. **Functional layer (glass).** Sidebars, toolbars / top bars, floating panels,
   popovers, menus, sheets, toasts, the dictation overlay, Cmd+K.
   - `glass` — regular: floating controls and panels, popovers, toasts.
   - `glass-thick` — sidebars and text-heavy chrome (more opaque).
   - `glass-clear` — only over rich imagery; rarely.
   - `glass-tint` — the **one** primary action or selected state in a view.
   - No glass on glass: a popover over a glass sidebar is `glass`; the sidebar
     items inside it are not glass again (use `bg-accent` / transparent).

## Colour

- Use tokens only: `primary`, `foreground`, `muted-foreground`, `card`,
  `surface-0..3`, `border*`, `mando`, `mando-deep`, `mando-light`,
  `mando-cream`, `success|warning|destructive`. No hex/rgba literals in UI code
  (charts may map data series to `mando`, `mando-deep`, `mando-light`,
  `success`, `warning`, `info` via CSS variables).
- Both themes must work: every surface is checked in light and dark. Anything
  that was dark-only (hard-coded near-black, `text-white/..` on a surface that
  is light in light mode) gets tokens.
- Amber (`primary` / `glass-tint`) sparingly: primary button, selected nav item,
  toggles on, focus ring. Secondary buttons stay neutral.

## Shape

Concentric radii: controls `rounded-md` (8px) or `rounded-full` capsules for
pills and segmented controls; cards/panels `rounded-lg` (12px); sheets and
floating panels `rounded-xl` (16px); windows/modals `rounded-2xl` (20px).

## Accessibility

`prefers-reduced-transparency` turns glass solid and flattens the field;
`prefers-contrast: more` strengthens hairlines; `prefers-reduced-motion` stops
the field drifting. Don't add effects that bypass these (e.g. a hard-coded
`backdrop-blur-xl` next to your own translucent bg) — use the utilities.

## Native vibrancy (macOS)

Floating windows whose content is a single panel use Electron `vibrancy`
(real desktop blur, native rounded corners). The window must be the panel's
size — any transparent margin becomes glass too. CSS then adds only a light
Mando tint over the native material (`bg-mando/[0.07]`), with no CSS radius:
the window's native corners are the panel's corners.

- Dictation overlay: only `LIVE_PANEL` carries a material (`vibrancyForSize`
  in `src/helpers/windowConfig.js`). Idle live mode (`LIVE`, same rectangle,
  just Mando) and the toast/menu sizes stay transparent, and the live panel
  falls back to CSS `glass` there.
- Agent overlay: the panel fills the window, so the window is the material.
- Meeting/update notifications keep CSS glass: they have a margin and slide in.
- `nativeTheme.themeSource` follows the app's theme (`app-theme-changed` IPC
  from `useTheme`), so the native material and the token colours on it agree.
