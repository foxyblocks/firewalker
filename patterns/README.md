# Patterns

Pattern recipes worth keeping, one `<name>.json` each. The designer in
[`designer/`](../designer) reads and writes this folder, and
[`docs/recipe-format.md`](../docs/recipe-format.md) describes the files.

| Recipe | What it does |
| --- | --- |
| `rainbow-pool` | The built-in flow as a recipe: a cycling spectrum that pools toward the low end, a white flash on a flat stomp, and trails on a tilted one |
| `fire-stomp` | The built-in fire-trail as a recipe: fire from whichever end is down to the other |
| `lava-pour` | Lava colors crawling around the ring, pooled hard toward the low end, with sparks |
| `starfield` | A dim sky with twinkling stars, and an ice-blue flash on a stomp |
| `comet` | Two neon comets circling faster the more you tilt |

Edit them in the designer rather than by hand. It checks every value and writes the file
the same way each time, so diffs stay small. `bun run test` in `designer/` checks every file
here too.

The firmware engine's [reference frames](../test/fixtures/recipe-frames/README.md) are made from
these recipes. After adding or changing one, run `bun run reference-frames` in `designer/` and
commit the result along with it.
