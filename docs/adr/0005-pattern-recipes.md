# Custom patterns are data recipes, designed in a browser simulator

New patterns shouldn't need a firmware build. A pattern becomes a **recipe**: a small JSON
file that stacks layers (fill, pool, trail, flash, sparkle, chase) and binds their knobs to
tilt and stomps. One engine in the firmware will run any recipe, so a boot can take a new
pattern over BLE or USB and keep it in flash. [`docs/recipe-format.md`](../recipe-format.md)
is the format.

Recipes are designed in `designer/`, a web app for a computer screen. It simulates the boot
from above and from the side with a tilt slider and a stomp button, so a pattern can be
tuned before any boot sees it. Recipes live in three places:

- **Drafts**: in the designer's browser storage, while they're being worked on.
- **Files**: download and import, for passing one around.
- **Keepers**: `patterns/<name>.json` in this repo, written by the designer's Save while its
  dev server runs.

Phase 1, this decision's first change, is the format, the designer, and starter recipes.
Next come a C++ recipe engine in the firmware, commands that upload a recipe and store it on
the boot, and then editing in the iPhone app.

## Considered options

- **Parameters for the built-in patterns only**: rejected. It's the smallest change, but
  every new look still needs a firmware build.
- **Keyframes or palettes without layers**: rejected. They can't express what the built-in
  patterns do with tilt and stomps, so flow and fire-trail couldn't be recipes.
- **A bytecode VM or a script engine (Lua, Berry, WASM)**: rejected for now. Any pattern
  becomes possible, at the cost of a sandbox, a time and memory budget, and a much harder
  safety story on a board that also drives a strip and a radio. Recipes cover the patterns
  we have, and a layer type can be added when one doesn't.
- **One engine compiled to WASM for the designer**: deferred. The designer's engine is
  TypeScript for now (`designer/src/engine/`), written to mirror the firmware's `Pattern`
  interface: integer frames, a seeded random generator, and no allocation per frame. The C++
  engine will be checked against it frame by frame on the same recipes, so the two can't
  drift apart quietly.
- **A cloud or database store for recipes**: rejected. The repo already reviews, versions,
  and backs them up.

## Consequences

- Built-in patterns stay in C++. `rainbow-pool` and `fire-stomp` are recipe versions of flow
  and fire-trail, for comparing the two. Whether keepers in `patterns/` also get built into
  the firmware is still open.
- The format is versioned, and a reader refuses a version it doesn't know.
- Recipes see tilt from -1 to 1, not degrees, so a threshold like fire-trail's flat range
  (`FIRE_TRAIL_FLAT_DEG`) is a fraction of the calibrated range in a recipe.
- The designer has to keep up with the firmware's strip map and patterns. Its strip math is
  a port of `include/firewalker_strip_map.h`, with its own tests.
