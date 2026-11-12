# Patterns

Pattern recipes worth keeping, one `<name>.json` each. The designer in
[`designer/`](../designer) reads and writes this folder, and
[`docs/recipe-format.md`](../docs/recipe-format.md) describes the files.

| Recipe | Built in | What it does |
| --- | --- | --- |
| `rainbow-pool` | Yes | A cycling spectrum that pools toward the low end, a white flash on a flat stomp, and trails on a tilted one |
| `fire-stomp` | Yes | Stomp-launched fire from whichever end is down to the other |
| `comet` | Yes | Two neon comets circling faster the more you tilt |
| `cat-prowl` | No | Bold purple and pink stripes slinking around the ring. Tilt steers their speed and direction, and a stomp makes the fur twitch |
| `cat-peek` | No | Stripes flowing up both sides into a dark face at the toe, where two yellow eyes drift and blink on their own |
| `cat-vanish` | No | The striped cat melts away tail first until only its eyes and grin are left, then fades back in. A stomp snaps it back |
| `lava-pour` | No | Lava colors crawling around the ring, pooled hard toward the low end, with sparks |
| `bass-ripple` | Yes | A rainbow volume bar on both sides, sliding downhill with tilt and flashing from 70% to 100% brightness on a stomp |
| `starfield` | No | A dim sky with twinkling stars, and an ice-blue flash on a stomp |

[`built-ins.txt`](built-ins.txt) lists the recipes compiled into the firmware, so every boot ships with
them. The rest reach a boot by upload.


Edit them in the designer rather than by hand. It checks every value and writes the file
the same way each time, so diffs stay small. `bun run test` in `designer/` checks every file
here too.
