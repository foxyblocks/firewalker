# Open questions — hardware unknowns

Unresolved hardware facts. Recorded here (not hidden in code comments) so they
get decided deliberately. Resolve → move the decision into `wiring.md`,
`power-budget.md`, `CONTEXT.md`, or an ADR as appropriate.

## Power delivery (highest priority)

- How is the strip powered in the **final wearable**? Single-cell LiPo + 5V
  boost? 2×AA? USB power bank? This sets the real current ceiling and the safe
  brightness/animation envelope.
- What is the **total** physical strip length vs. the 39 pixels currently
  driven? Worst-case current scales with the number actually lit.
- Are the recommended **data-line series resistor** and **bulk capacitor**
  actually installed on the rig, or assumed?

## Controller / final board

- Uno R3 is the *test* board. What is the **production** controller (Gemma M0,
  Flora, QT Py, …)? A 3.3 V board changes logic-level handling and the framework
  target in `platformio.ini`.
- If 3.3 V: level shifter on the data line, or rely on the "first pixel as level
  shifter" trick / a known-tolerant strip?

## Wearable constraints

- Mounting: how/where does the strip attach to the shoe, and how is the
  controller + battery enclosed and strain-relieved?
- Connector strategy for removing electronics before washing?

## Behavior (later — out of current scope)

- Step / impact detection source (accelerometer model, mount point, threshold)?
- Desired animations and their power profile once the above is settled?
