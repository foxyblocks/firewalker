# Patterns

Pattern recipes worth keeping, one `<name>.json` each. The designer in
[`designer/`](../designer) reads and writes this folder, and
[`docs/recipe-format.md`](../docs/recipe-format.md) describes the files.

| Recipe | Built in | What it does |
| --- | --- | --- |
| `rainbow-pool` | Yes | A cycling spectrum that pools toward the low end, a white flash on a flat stomp, and trails on a tilted one |
| `rainbow-spin` | Yes | A full rainbow rotating around the ring about once a second, with every pixel lit |
| `fire-stomp` | Yes | Stomp-launched fire from whichever end is down to the other |
| `comet` | Yes | Two neon comets circling faster the more you tilt |
| `lava-pour` | No | Lava colors crawling around the ring, pooled hard toward the low end, with sparks |
| `bass-ripple` | Yes | A rainbow volume bar on both sides, sliding downhill with tilt and flashing from 70% to 100% brightness on a stomp |
| `heat-pour` | No | A heat map that pours downhill: dark blue at the up end, warming through purple, red, and orange to a white-yellow tip at full tilt, with a yellow flash on a stomp |
| `heat-inferno` | No | The heat map in the reference photo's colors, with a long purple and magenta ramp, ends that glow magenta when flat, and a stomp that bursts hot and cools back |
| `heat-forge` | No | A glowing-metal heat map, steel blue to dull red, orange, and white-hot, with embers twinkling where it's hot and a white-hot flash on a stomp |
| `starfield` | No | A dim sky with twinkling stars, and an ice-blue flash on a stomp |

[`built-ins.txt`](built-ins.txt) lists the recipes compiled into the firmware, so every boot ships with
them. The rest reach a boot by upload.

Everything here on `main` reaches the boots without a firmware build: each push to `main` publishes
these recipes as the pattern catalog, and the iPhone app uploads them to each boot as it connects
([ADR-0007](../docs/adr/0007-sync-patterns-from-main.md)). A boot has 16 upload slots, so keep this
folder to 16 recipes or fewer; `bun run test` in `designer/` checks that.


Edit them in the designer rather than by hand. It checks every value and writes the file
the same way each time, so diffs stay small. `bun run test` in `designer/` checks every file
here too.
