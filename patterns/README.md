# Patterns

Pattern recipes worth keeping, one `<name>.json` each. The designer in
[`designer/`](../designer) reads and writes this folder, and
[`docs/recipe-format.md`](../docs/recipe-format.md) describes the files.

| Recipe | Built in | What it does |
| --- | --- | --- |
| `rainbow-pool` | Yes | A cycling spectrum that pools toward the low end, a white flash on a flat stomp, and trails on a tilted one |
| `fire-stomp` | Yes | Stomp-launched fire from whichever end is down to the other |
| `comet` | Yes | Two neon comets circling faster the more you tilt |
| `lava-pour` | No | Lava colors crawling around the ring, pooled hard toward the low end, with sparks |
| `bass-ripple` | Yes | A rainbow volume bar on both sides, sliding downhill with tilt and flashing from 70% to 100% brightness on a stomp |
| `starfield` | No | A dim sky with twinkling stars, and an ice-blue flash on a stomp |
| `charon-mist` | No | Violet and blue river fog in drifting banks. Tilt pushes it along the foot, each step breathes it brighter, and sound swells it |
| `charon-wake` | No | A dark boot with dim embers. Every footfall sends a plume of violet smoke along both sides, and sound wakes pale sparks |
| `charon-wisp` | No | Pale spirits circling the boot in two opposing currents. They surge with tilt and glow with sound |

[`built-ins.txt`](built-ins.txt) lists the recipes compiled into the firmware, so every boot ships with
them. The rest reach a boot by upload.


Edit them in the designer rather than by hand. It checks every value and writes the file
the same way each time, so diffs stay small. `bun run test` in `designer/` checks every file
here too.
