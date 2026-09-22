# WhisperWoof Design System

## Brand
**Name:** WhisperWoof. **Named after:** Mando (shepherd/dingo mix).
**Aesthetic:** Industrial Warmth — dark, dense, confident, with organic warmth.

## Colors (sampled from Mando's fur)

| Token | Value | Source |
|-------|-------|--------|
| Background | `#0E0C0A` | Nose shadow |
| Surface | `#1A1714` | Dark coat |
| Surface 2 | `#221E1A` | Lifted |
| Border | `#2E2923` | Dark ear fur |
| Text | `#E8DDD0` | Chest cream |
| Text secondary | `#A69888` | Muted tan |
| Text muted | `#736858` | Fur shadow |
| Accent | `#A06A3C` | Main coat |
| Accent hover | `#B8863C` | Eye amber |
| Success | `#5C8A4C` | Forest green |
| Error | `#B84C3C` | Warm red |

**Fur reference:** Dark `#5C3A1E`, Coat `#A06A3C`, Inner ear `#C4956A`, Cream `#E8D5C4`, White `#F0E4D4`

## Typography
Geist (Vercel). Geist Mono for timestamps/code.
Scale: 11px xs, 13px sm, 15px base, 17px lg, 20px xl.

## Spacing
4px base. Compact density.

## Floating Indicator
Soundbar (180px wide) topped by the animated Mando character (64px, spritesheet
stepped by CSS from the Mando-assets-v6 pack, see `MandoSprite`). This is the
default `full` indicator style; `compact` and `dot` render no Mando and never
wait for a hop. The Cmd+K agent bar shows the same "think" loop at 30px.
- Idle: Mando sits still (first frame of the head-tilt), dimmed, bars flat
- Waiting for voice: head-tilt loop, bars flat
- Speaking: nodding loop, waveform active
- Processing: chin-scratch "think" loop, amber bars pulse slowly
- Text landed: one hop, then back to sitting; auto-hide waits for the hop

## Principles
1. Warm amber accent is the only brand color. Everything else is neutral.
2. Mando is the brand. No other productivity tool has a dog that reacts to you.
3. Dark mode primary. Light mode supported but not prioritized.
4. Compact density — power users want information, not whitespace.
5. Motion is minimal except for Mando (the one playful element). Everything
   else moves only to convey state, and honors prefers-reduced-motion.
