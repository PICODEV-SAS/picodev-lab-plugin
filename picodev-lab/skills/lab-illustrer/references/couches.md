# Couches (layer stack)

Adapted from diagram-design's layer stack type (Cathryn Lavery, MIT).

**Best for:** ordered levels: the software layers of the product (application, protocol,
drivers, hardware), a communication stack, the levels of an installation.

**Not this type:** levels that are physical parts → `eclate.md`; blocks with flows → `synoptique.md`.

## Layout

- Horizontal bands stacked vertically, same x and width (800–880 in a 1000 viewBox), 56–72px high,
  3 to 6 bands.
- In each band, left to right: an index tag (`eyebrow`, 8–9px: `L1`, `APPLICATION`), the band's
  name (`node-name`, 14–16px, 600), a note on the right (`sublabel`, 9–10px, `muted`) only if the
  visitor gave one.
- Bands separated by a `rule` hairline; outer outline 1px `ink`. Fills all `paper`, or alternating
  `paper` and `paper-2`: one or the other.
- A direction on the left margin, outside the stack, if it helps: a small arrow and an `eyebrow`
  label (`abstraction ↑`).
- One focal band in coral (stroke, `accent-tint` fill).

## No

Bands that are not really ordered, skipped numbering, a different colour for every band.
