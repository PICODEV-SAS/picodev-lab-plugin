# Synoptique (block diagram)

Adapted from diagram-design's high-level type (Cathryn Lavery, MIT): its left-to-right reading in
phases, without its data-stack inputs and without icons.

**Best for:** what the product is made of and what flows between the blocks: inputs (sensors,
buttons, network), the brain (microcontroller, module), outputs (display, relay, motor, radio), and
the power supply under them.

**Not this type:** the physical stacking of parts → `eclate.md`; the product's shape or where it is
used → `forme.md`.

## Layout

- Three columns, left to right: **Entrées**, **Traitement**, **Sorties** (in English: Inputs,
  Processing, Outputs). An `eyebrow` label at the top of each column, `muted`.
- Inputs and outputs: boxes 160×56, 24px apart vertically. The processing block in the middle,
  taller (as high as the inputs it receives), 200 wide.
- **Power** as a full-width band at the bottom (`paper-2` fill, `rule` border, 40px high), its
  name and voltage on the left (`Alimentation · 5 V USB`). Thin vertical lines from the band to
  the blocks it powers, dashed if the visitor did not say.
- Arrows from each input to the processing block, from the processing block to each output;
  label each with the signal or bus if the visitor named it (`I2C`, `PWM`, `ANALOGIQUE`), else no
  label.
- Outside the product (the user, a phone, a server): to the far left or right, dashed box
  (`stroke-dasharray="4,3"`), name in `muted`.
- Focal: the block the spec is about (often the processing block, or a sensor that is the point of
  the product) in coral; one only.

## Names

The visitor's words for the blocks ("capteur de CO2", "écran"); the component as a sublabel only if
they gave it ("SCD40"). Never pick a component for them.

## No

More than 9 blocks (merge the minor ones: "boutons ×3"), arrows crossing the processing block,
icons for sensors, a legend for an obvious figure.
