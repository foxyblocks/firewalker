# Patterns

Pattern recipes worth keeping, one `<name>.json` each. The designer in
[`designer/`](../designer) reads and writes this folder, and
[`docs/recipe-format.md`](../docs/recipe-format.md) describes the files.

| Recipe | Built in | What it does |
| --- | --- | --- |
| `rainbow-pool` | Yes | The native flow as a recipe: a cycling spectrum that pools toward the low end, a white flash on a flat stomp, and trails on a tilted one |
| `fire-stomp` | Yes | The native fire-trail as a recipe: fire from whichever end is down to the other |
| `comet` | Yes | Two neon comets circling faster the more you tilt |
| `lava-pour` | No | Lava colors crawling around the ring, pooled hard toward the low end, with sparks |
| `starfield` | No | A dim sky with twinkling stars, and an ice-blue flash on a stomp |

[`built-ins.txt`](built-ins.txt) lists the recipes compiled into the firmware, so every boot ships with
them. The rest reach a boot by upload.

Edit them in the designer rather than by hand. It checks every value and writes the file
the same way each time, so diffs stay small. `bun run test` in `designer/` checks every file
here too.
