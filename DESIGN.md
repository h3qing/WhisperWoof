# Design System — WhisperWoof

How WhisperWoof looks and why. It is Apple's Liquid Glass, adapted the way
the Glassfolio system adapts it (glass for navigation, solid sheets for
content), in the colors of Mando, the shepherd/dingo mix the app is named
after. Implementation notes: `docs/design/liquid-glass.md`.

Source of truth: `src/index.css` (tokens and utilities),
`src/components/ControlPanel.tsx` + `ControlPanelSidebar.tsx` (layout),
`src/components/ui/` (controls), `website/index.html` (site),
`src/assets/logo.svg` (icon).

## Product context

- **What this is:** local voice dictation for macOS. Hold fn, talk, and the
  words land at your cursor (or clipboard, a note, a project), cleaned up by
  an on-device model.
- **Who it's for:** people who write all day and would rather talk, often in
  Chinese and English at once.
- **Project type:** a desktop app (Electron control panel, floating dictation
  overlay, Cmd+K bar) plus a one-page marketing site.

## 1. Principles

1. **Glass until it lands.** Glass is for things still in motion: the
   dictation overlay floating over someone else's app, the live words while
   Mando is still listening, Cmd+K, the sidebar, toolbars and popovers.
   Anything that has landed (history, notes, settings) sits on a solid sheet.
   Never put text you need to read closely on a moving background.
2. **One signature element.** Words the recognizer may still rewrite sit in
   a frosted caramel capsule (`live-words`); committed words are plain ink.
   This is the product idea in one mark. Don't spend glass anywhere else for
   decoration.
3. **The material is light, not color.** Glass is a thin tint, blur and
   saturation, a bright rim where light catches the edge, a soft sheen near
   the top and a float shadow. Its color comes from the Mando backdrop behind
   it, so there is always a backdrop behind glass.
4. **Capsules and nested corners.** Every control is a capsule. A panel
   inside a panel subtracts its inset from the parent's radius.
5. **Quiet frame, meaningful color.** One accent (caramel), three inks, and
   status colors kept for status. Mando is the one playful element.
6. **Plain words.** Pages open with a sentence stating what happened, not a
   dashboard of tiles. Labels use the user's words, in sentence case.

## 2. Color

Sampled from photos of Mando: the caramel coat, the smoky saddle across the
shoulders, the white chest and the mauve nose. Dark mode is its own palette,
chosen by hand: the accent gets lighter and warmer, sheets go brown-black
rather than gray.

| Token (Tailwind) | Light | Dark | Use |
|---|---|---|---|
| `foreground` (ink) | `#2a211b` | `#f3ede6` | primary text (15.3:1 on a sheet) |
| `muted-foreground` (ink 2) | `#64564b` | `#bfb2a6` | secondary text, labels (6.8:1) |
| `faint` (ink 3) | `#8e8074` | `#8f8276` | raw transcripts, hints, chevrons |
| `primary` (accent) | `#8f5a2a` | `#e2a867` | primary button, icons, focus ring, links (5.6:1) |
| `primary-foreground` | `#ffffff` | `#1d130b` | text on the accent |
| `select` | accent @ 14% | accent @ 22% | selected nav item, pressed toggle, drop hover |
| `live` / `live-glass` | `#b87a3c` / coat @ 22% | `#e2a867` / @ 22% | outline and fill of words still being heard |
| `card` / `surface-2` (sheet) | `#fdfbf8` | `#1a1512` | content sheets |
| `surface-1` (sheet 2) | `#f5f0ea` | `#221c18` | inputs, nested panels, chips |
| `surface-3` | `#f3ede6` | `#261f1a` | hovered or selected row |
| `border` (sheet line) | `#e8e0d6` | `#312822` | row separators, input borders |
| `background` (backdrop base) | `#ebe4dc` | `#120e0b` | behind everything |
| `success` / `warning` / `destructive` | `#3b7a4c` / `#80660f` / `#b0382c` | `#72c291` / `#dcc15a` / `#ef7d72` | status only |
| `mando` / `mando-light` | `#c48a4c` / `#e2a867` | `#d69a57` / `#e8b27a` | the coat itself: heatmap, illustrations |

Warning is mustard, not amber, so it never reads as the caramel accent.
Status always pairs an icon and a label with its color.

**Backdrop.** Three large, soft radial gradients over the base, still (it
never drifts): caramel coat at the top left, mauve nose at the bottom right,
cream chest at the top. `.mando-field` draws it inside each window; the site
sets it on `body` with `background-attachment: fixed`.

| Glow | Light | Dark |
|---|---|---|
| top left (coat) | `#f0c996` | `#6e4521` |
| bottom right (nose) | `#e3c1bc` | `#57312f` |
| top (chest) | `#f4e7d3` | `#45372a` |

## 3. Glass

The utilities live in `src/index.css`:

| Utility | Use |
|---|---|
| `glass` | popovers, toasts, the live panel, capsule groups |
| `glass-thick` | the sidebar, settings window, menus, anything holding a lot of text |
| `glass-rim` | adds the specular gradient rim (a positioned element only) |
| `glass-tint` | the one caramel glass action |
| `sheet` | a solid content surface |
| `live-words` | the signature: provisional words in frosted caramel |
| `press` | the spring on press for capsule buttons |

Recipe: tint (`--glass-regular` / `--glass-thick`), backdrop blur 22px with
saturation and a touch of brightness, an inner top highlight, a thin rim, a
thickness shade at the bottom, a contact shadow and a float shadow, plus a
radial sheen near the top. `glass-rim` draws a 1px 145° gradient ring (bright
at the top-left and bottom-right, faint on the sides).

Rules:
- No glass on glass: a control inside a glass group drops its own track.
- Two strengths only: regular for surfaces, thick for text-heavy chrome.
- Glass never sits under numbers, tables or charts.

## 4. Shape and spacing

| Token | Value | Use |
|---|---|---|
| `--radius-window` (`rounded-window`) | 26px | sidebar, settings window, dialogs |
| `--radius-sheet` (`rounded-sheet`) | 22px | content sheets, the live panel |
| nested panel | sheet − inset (14px, 18px) | settings groups, drawers |
| `rounded-lg` | 12px | rows, text areas, clipboard cards |
| `rounded-full` | 999px | every button, input, select, segmented control, nav item, chip |

In components that take a `className`, write the sheet radius as
`rounded-[var(--radius-sheet)]` so tailwind-merge can override it.

The floating layer sits 10px from the window edges. Gaps: 16px between
sheets, 12px inside control rows, 2px between nav items. 4px base unit.

## 5. Type

**Nunito**, bundled (`src/assets/fonts/nunito.css`, variable 200–1000, SIL
OFL, about 40 KB per subset). Rounded ends give the friendliness Mando has
while staying legible at 13px in dense lists. Chinese falls back to PingFang
SC. The site self-hosts the same files and makes no third-party requests.

| Role | Size / weight / tracking |
|---|---|
| Page title (toolbar) | 26 / 800 / −0.02em |
| Headline sentence | 26–28 / 800 / −0.022em, max 30ch, balanced |
| Settings window title | 19 / 700 / −0.01em |
| Fact value | 19 / 700 / −0.01em, tabular |
| Brand | 17 / 700 |
| Section title | 15 / 700 |
| Body, nav items, settings labels | 14–15 / 500–600 |
| Labels, descriptions | 13 / 500, `muted-foreground` |
| Badges, notes | 12 |

Every number that lines up uses `tabular-nums`. Sentence case everywhere: no
all-caps labels, no small labels floating above headings. Negative tracking
only on large type.

## 6. Layout

```
╭──────────────╮
│ ● ● ●        │  Home
│ WhisperWoof  │  ╭──────────────── sheet ─────────────────╮
│ (Search   ⌘K)│  │ 93 entries in the last 7 days, 24 of   │  ▦▦▦▦▦
│(Home        )│  │ them today.                            │  ▦▦▦▦▦
│ History      │  │ Streak  Average recording  Voice  …    │
│ Notes        │  ╰────────────────────────────────────────╯
│ Clipboard    │  ╭──────────────── sheet ─────────────────╮
│ Tools        │  │ 04:57 PM  We need a place for …        │
│ Memory       │  │ ────────────────────────────────────── │
│ …            │  ╰────────────────────────────────────────╯
│ Settings     │
╰──────────────╯
220px glass     fluid content on solid sheets
```

- **Sidebar:** a floating `glass-thick glass-rim` slab, 220px wide, 10px from
  every window edge, radius 26. The traffic lights sit inside it
  (`trafficLightPosition: {x: 24, y: 24}`). Top to bottom: brand, search
  capsule, nav, section labels in sentence case, settings.
- **Toolbar without a bar:** the page title on the left (the window drags
  from it), matching the sidebar label. Views don't repeat it.
- **Content:** sheets with 16px gaps. Home opens with a headline sentence and
  a row of facts (`src/whisperwoof/ui/home/home-summary.ts`); History is two
  sheets (the list, the entry it opens); Notes is a glass folder column next
  to two sheets.
- **Settings:** a `glass-thick glass-rim` window (radius 26) with a capsule
  nav; the content is a sheet nested inside it (radius 18), and groups are
  flat nested panels on `surface-1` (radius 14), not cards on cards.

## 7. Components

| Component | Recipe |
|---|---|
| Nav item | capsule, min height 36px, icon in `primary`. Hover: `--glass-hover` (solid under Reduce Transparency). Selected: `bg-select`, weight 600, `aria-current="page"`. |
| Button (outline) | capsule, `--glass-strong` fill with a lit top edge and a 1px `border` (no blur of its own). Press: `press` (scale .96, spring). |
| Primary button | capsule, accent at 88% with a soft accent glow under it. One per view. |
| Input / select | capsule on `surface-1`/`input` with a 1px `border`; focus: `border-active` plus a 3px `select` ring. Text areas radius 12. |
| Segmented control | capsule track on `surface-1` with an inset hairline; a white knob slides with `cubic-bezier(.3,.7,.3,1.15)`. |
| Toggle | capsule track, accent at 88% when on; a white 20px thumb that springs. `role="switch"`. |
| Sheet | `card`, radius 22, two-part shadow, no border. |
| Rows | hovered or selected rows become rounded (`rounded-lg`) with `surface-3` or `select`. |
| Live words | `live-words`: gradient sheen over `live-glass`, 1px inset `live` outline, `box-decoration-break: clone`. Caret in `live`. |
| Status | icon, label and color together, never color alone. |

## 8. Motion

Motion only answers something the user did. The backdrop never drifts; there
are no entrance animations. Mando's sprite is the exception: it animates to
show state (listening, thinking, landed), and even it honors reduced motion.

| What | Timing |
|---|---|
| Hover backgrounds | background-color .18s ease |
| Button press | transform .2s cubic-bezier(.3,.7,.4,1.4) |
| Segmented knob, toggle thumb | transform .32s cubic-bezier(.3,.7,.3,1.15) |

## 9. Accessibility and system settings

- `prefers-reduced-transparency`: glass turns opaque (sheet colors, no blur,
  no sheen).
- `prefers-contrast: more`: glass gets more opaque, hairlines stronger.
- `prefers-reduced-motion`: transitions and animations off.
- Focus is always visible (a 2px ring in the accent).
- Real controls with ARIA state: `aria-current`, `aria-pressed`,
  `aria-selected`, `aria-checked`, `aria-expanded`.

## 10. Native shell (macOS)

The control panel is an opaque window (`backgroundColor` matches
`--color-background`, pinned by a test) with the Mando backdrop drawn in CSS:
native vibrancy would take its color from the wallpaper and lose Mando's.
Floating single-panel windows (the live dictation panel, the agent overlay)
use Electron `vibrancy` with only a light Mando tint on top. See
`docs/design/liquid-glass.md`.

## 11. Words

- Name things by what people see: "History", "Cleaned up", "Voice recorded",
  "Went to", not "entries table" or "polish rate".
- Open with a sentence that states what happened: "93 entries in the last 7
  days, 24 of them today."
- Loading says what is happening; errors say what happened and how to fix it,
  without apologizing.
- Buttons say exactly what they do, and the confirmation uses the same verb.

## 12. App icon

Mando's head (the original traced artwork) on a "smoky night" squircle:
saddle brown with caramel and mauve glows, a cream die-cut sticker edge so the
navy outline reads on the dark ground, and a specular rim. Drawn to Apple's
grid (824 on a 1024 canvas) so macOS 26 doesn't put it in a gray tile. Source
`src/assets/logo.svg`; rebuild the PNG/ICNS/ICO with
`node scripts/build-app-icon.js`.

## 13. Don'ts

- Glass under numbers, tables or charts; glass on glass; glass on a flat
  background.
- Borders on sheets (their shadow and the surface difference are enough).
- Radii that don't nest, or square controls.
- All-caps labels, letter-spaced eyebrows.
- A drifting or animated backdrop, entrance or scroll animations.
- Status colors used as categories; amber that competes with the accent.
- Tiles of big numbers in place of a sentence and a list.
- Hex literals in UI code: use the tokens.

## Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-09-24 | Adopt the Glassfolio system in Mando's colors | The user's own Glassfolio design language; palette re-derived from photos of Mando instead of copying Glassfolio's blues |
| 2026-09-24 | Glass means "not landed yet"; `live-words` is the signature | WhisperWoof's own reason for glass, as Glassfolio's glass bar means "held through funds" |
| 2026-09-24 | Nunito instead of Noto Sans / SF Pro | User asked for a cuter font; SF Pro Rounded is not reachable from Chromium; Nunito stays legible at 13px |
| 2026-09-24 | Keep the original Mando head in the icon, new "smoky night" background | User preferred the original artwork over a redraw |
| 2026-09-24 | Static backdrop, no drift | Motion only answers the user |
| Earlier (v1.19.0) | Liquid glass in Mando's hue | First glass round |
