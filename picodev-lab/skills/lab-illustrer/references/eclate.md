# Vue éclatée (exploded axonometric)

Adapted from diagram-design's exploded axonometric type (Cathryn Lavery, MIT).

**Best for:** one object drawn in parallel projection with its parts pulled apart along one axis and
labelled: enclosure, board, battery, display, cover. Shows what goes inside what, and in which
order it assembles.

**Not this type:** blocks and what flows between them → `synoptique.md`; ordered levels with no
physical thickness → `couches.md`.

## Projection

2:1 dimetric. x runs right and down, y left and down, z up. Compute every point with one function,
never by hand:

```python
def iso(x, y, z, ox, oy):
    """Model point to SVG point; (ox, oy) is where model (0, 0, 0) lands."""
    return ox + x - y, oy + (x + y) / 2 - z
```

Model units in multiples of 4 land edges on whole pixels. Each part is a box (a prism): its top face
`iso` of the four top corners, its left face (x side) and right face (y side) below it. Draw faces
as plain `<polygon>` with the projected points written in; no `transform` for geometry.

## Parts

- 2 to 5 parts, bottom to top. Parts side by side in the assembled object (a board and its battery)
  share a level and lift together.
- One gap between levels: half the top-face height of the largest part, or three times the
  thickest part, whichever is larger, rounded up to 4.
- Paint the bottom level first; within a level, farther parts (smaller `x + y`) first.
- At most two details on a part's top face (a display outline, a connector), 4 units inside the
  edge. No more.

## Faces and lines

| Element | Value |
|---|---|
| Top face | `{paper}` |
| Left face (lit) | `{ink}` at fill-opacity 0.07 over `{paper}` |
| Right face (shade) | `{ink}` at fill-opacity 0.15 over `{paper}` |
| Focal part faces | `{accent}` at 0.10 / 0.20 / 0.32 over `{paper}` |
| Outline | `{ink}`, 1.2 |
| Inner edges, details | `{ink}`, stroke-opacity 0.55, 0.8 |
| Trace lines (assembly axis) | `{ink}`, stroke-opacity 0.30, 0.8, dashed `4,3`, painted first |

Draw each face as an opaque `{paper}` polygon, then the same polygon with the `{ink}` overlay: parts
behind never show through. Always shade; an outline-only box reads both ways.

## Labels

One per part, in one column right of the object: the name (`node-name`, 600, 14–16px) above a
sublabel (`sublabel`, 10px, `muted`) only if the visitor gave one. A horizontal leader (0.8,
`{ink}` at 0.40) from a 2px dot on the part's right edge to the column; leaders never bend or cross
a part. The focal part's dot and leader in coral, its name in `ink`. No numbered key.

## Proposals

Proportions are the visitor's if they gave sizes, otherwise neutral and said so in the caption
(« proposition, sans cotes »). Never write a dimension on the figure that the visitor did not give.
