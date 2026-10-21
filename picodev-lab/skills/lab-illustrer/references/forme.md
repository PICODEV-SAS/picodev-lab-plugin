# Forme et mise en situation (axonometric plan)

Adapted from diagram-design's axonometric plan type (Cathryn Lavery, MIT), turned to the product:
its proposed shape, or the product standing where it is used.

**Best for:**

- **Forme** : the enclosure the visitor described or a neutral proposal (a box with rounded
  corners, its display and buttons on the top face, its connectors on a side).
- **Mise en situation** : the product in its place of use, seen from above at an angle: on a wall,
  in an electrical panel, on a desk, in a field, in a vehicle. The place is a plate, the product a
  box on it, the surroundings a few simple boxes.

**Not this type:** parts pulled apart → `eclate.md`; blocks and signals → `synoptique.md`.

## Projection

The same 2:1 dimetric as the exploded view, one function for every point:

```python
def iso(x, y, z, ox, oy):
    return ox + x - y, oy + (x + y) / 2 - z
```

Every element is a box standing on the plate, shaded as in `eclate.md` (top `paper`, left face ink
0.07, right face ink 0.15, outline ink 1.2).

## Layout

- **Plate**: the floor, the wall seen flat, the desk top; one slab, 6 units thick. Nothing extends
  past it.
- **The product**: the focal box, in coral (`accent` faces at 0.10 / 0.20 / 0.32). Its size to
  scale with the surroundings only if the visitor gave sizes; otherwise plausible and the caption
  says « proposition ».
- **Surroundings**: 2 to 6 neutral boxes (a desk, a cabinet, a pipe, a person as a simple
  cylinder), heights to scale with each other, footprints never overlapping. Paths and zones as
  flat fills on the plate (`ink` at 0.07).
- **Shape view**: no plate, the product alone and larger; details on its top face (display,
  buttons, LED) as insets 4 units inside the edges, two levels of detail at most; connectors as
  small boxes on the side they are on.
- **Paint order**: plate, flat marks, then boxes back to front: box A before box B when A lies
  entirely behind B (`A.x1 <= B.x0` or `A.y1 <= B.y0`).
- **Tags**: horizontal, never tilted: a name (`node-name`, 600, 12px) above an optional sublabel,
  on an opaque `paper` backing with a `rule` hairline, 32px tall; on the box or on open floor,
  painted after every box, never overlapping. One or two words.
- Canvas 1000 wide, plate centred, height as needed plus 48px on top.

## No

Shadows, gradients, perspective, photographs, people drawn in detail, brand marks on the product,
dimensions the visitor did not give.
