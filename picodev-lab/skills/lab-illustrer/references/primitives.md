# Primitives

Adapted from diagram-design's core SVG primitives and layout budget (Cathryn Lavery, MIT). Colours
and fonts are named by role (`{ink}`, `{paper}`, `{node-name}`…): resolve them with `style.md`.
Uppercase names (`X`, `W`) are geometry you compute.

## The file

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 H" width="1000" height="H"
     role="img" aria-labelledby="synoptique-title synoptique-desc">
  <title id="synoptique-title">Synoptique du capteur d'air</title>
  <desc id="synoptique-desc">Le capteur de CO2 et le bouton entrent dans le Nano, qui pilote l'écran et la LED.</desc>
  <rect width="1000" height="H" fill="{paper}"/>
  <!-- arrows first, then boxes, then labels -->
</svg>
```

- `<title>` first, short (60 characters or so); `<desc>` one sentence saying what the figure shows,
  not its geometry. IDs prefixed with the file's name.
- Width 1000; height what the content needs plus 40px margins. Structure on a 4px grid: boxes
  80–320 wide, gaps 20–48, padding 8–16, corner radius 4–8.
- Paint order: background, zones, arrows, boxes, labels. Arrows behind boxes.

## Box

```svg
<rect x="X" y="Y" width="W" height="H" rx="6" fill="{paper}" stroke="{ink}" stroke-width="1"/>
<text x="CX" y="CY+2" fill="{ink}" font-size="12" font-weight="600" font-family="{node-name}" text-anchor="middle">Nano</text>
<text x="CX" y="CY+18" fill="{muted}" font-size="9" font-family="{sublabel}" text-anchor="middle">ATmega328P · 5 V</text>
```

The focal box: `stroke="{accent}"`, `fill="{accent-tint}"`, its name still `{ink}`.

## Arrows

Draw each arrowhead as a small polygon at the end of its line (the PDF renderer does not always
honour `<marker>`):

```svg
<path d="M X1 Y H X2" fill="none" stroke="{muted}" stroke-width="1"/>
<polygon points="X2,Y X2-8,Y-3 X2-8,Y+3" fill="{muted}"/>
```

- Right angles only: a connector between boxes that do not share an x or a y bends with a quarter
  arc (`r` 8, 6 in tight places). Never a diagonal.
- A connector leaves and enters a box perpendicular to its edge, at least 8px from a corner.
- Two connectors on one edge get their own attach points, 12px apart at least
  (`L * k / (N + 1)` along an edge of length `L`).
- No two connectors on top of each other; 12px apart when parallel. A connector never passes behind
  a box that is not one of its ends; reroute.
- Dashed (`stroke-dasharray="5,4"`) for what is optional or occasional (a USB cable used only to
  program, a battery backup).

## Arrow labels

All capitals, 14 characters at most, on an opaque mask, 6 to 10px above the line (beside it for a
vertical segment), never on it:

```svg
<rect x="MX-18" y="AY-20" width="36" height="12" rx="2" fill="{paper}"/>
<text x="MX" y="AY-11" fill="{soft}" font-size="8" font-family="{arrow-label}" text-anchor="middle" letter-spacing="0.06em">I2C</text>
```

A label's mask never overlaps a box.

## Budget per figure

At most 9 boxes, 12 arrows, 1 focal element (2 at most), 2 callouts. Over budget: draw an overview
and leave the detail to the text of the spec.

## Legend

Only if the figure needs one (dashed vs solid, say): a strip under the figure, after a hairline,
never inside the drawing; add 60px to the height.
