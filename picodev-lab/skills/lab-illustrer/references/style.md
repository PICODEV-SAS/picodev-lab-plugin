# Style: Picodev

Adapted from diagram-design's style guide (Cathryn Lavery, MIT), with Picodev's own palette (the
lab's `DESIGN.md`) in place of the original skin. Light figures only: they are printed in a PDF on
white pages.

## Colours by role

Snippets in the other references name colours by role. Resolve each role to its value below.

| Role | Value | Use |
|---|---|---|
| `paper` | `#FFFFFF` | Background, opaque mask behind labels, node fill |
| `paper-2` | `#F4F6F9` | Secondary fill (zones, alternate bands) |
| `ink` | `#0A2440` | Main text, strong strokes (Picodev navy; never pure black) |
| `muted` | `#3A4C63` | Secondary text, default arrows |
| `soft` | `#4A5B70` | Sublabels, arrow labels |
| `rule` | `#DDE3EA` | Hairlines, borders between bands |
| `accent` | `#E7746F` | The one focal element: stroke, arrow, small tint (Picodev coral) |
| `accent-ink` | `#B8433E` | Accent used as text (coral itself is too light for text on white) |
| `accent-tint` | `#FCE9E8` | Fill of the accent-bordered box |

An opacity is written as an attribute (`fill="#0A2440" fill-opacity="0.10"`,
`stroke-opacity`), never as `rgba()`: the PDF renderer reads attributes more reliably.

## Contrast

Text at least 4.5:1 against its background: `ink`, `muted`, `soft` and `accent-ink` on `paper`
pass; `accent` (coral) never carries text. Lines and arrows at least 3:1 against what is next to
them. Tints are decoration, never the only carrier of meaning.

## Type

| Role | Family | Size | Weight | Use |
|---|---|---|---|---|
| `node-name` | `Geist, Helvetica, Arial, sans-serif` | 12–16px | 600 | Names of blocks and parts |
| `sublabel` | `Geist Mono, Courier, monospace` | 9–10px | 400 | Technical detail: signal, voltage, bus |
| `eyebrow` | `Geist Mono, Courier, monospace` | 8px | 400, letter-spacing 0.12em | Small capitals: tags, zone names |
| `arrow-label` | `Geist Mono, Courier, monospace` | 8px | 400 | Labels on arrows, all capitals |

Width budget for a label: 0.60em per character in sans, 0.62em in mono. No web font, no `@import`,
no `<style>` with `url()`: the family names fall back to the PDF's fonts.

## No

Shadows, gradients, glow, icons, logos, brand marks, photographs, emoji. One accent element, two at
most.
