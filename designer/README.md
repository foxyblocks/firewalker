# Firewalker pattern designer

A web app for designing pattern **recipes** on a computer: stack layers, set their knobs, and
watch a simulated boot react as you tilt it and stomp. Recipes save to the repo's
[`patterns/`](../patterns) folder. The format is in
[`docs/recipe-format.md`](../docs/recipe-format.md), and why it works this way is in
[ADR-0005](../docs/adr/0005-pattern-recipes.md).

Boots can't run recipes yet. Sending one to a boot comes with the firmware's recipe engine.

## Run it

```bash
cd designer
bun install
bun run dev          # http://localhost:5174
bun run test         # engine, format, storage, and geometry tests, and every file in patterns/
bun run typecheck
```

It runs on port 5174, so it can sit beside the iPhone app's dev server on 5173.

## Using it

- **Patterns** lists every recipe in `patterns/` plus this browser's drafts. Click a card to
  open it. Create one blank or as a copy of another, then duplicate, rename, download,
  import, or delete.
- **Design** has the layer stack on the left, the boot in the middle, and the selected
  layer's settings on the right. Drag a layer by its grip, or use its arrows, to restack it.
  Any number can be **Fixed**, or **Follows** tilt, a stomp, or a wave. The JSON tab shows
  the file as it will be saved.
- **The boot** shows from above and from its outer side, with the strip in index order
  below. Drag **Tilt**, or press **Stomp** or the space bar. A stomp lifts the boot and drops
  it, and the pattern gets the stomp the moment it lands, at the **Strength** you set.
  **Beat** stomps on every beat at the BPM beside it, and **Walk** plays a steady gait. The
  strip menu switches between each boot's saved layout and the uncut bench strip.
- **Boot brightness** shows what a boot's brightness setting does to a pattern, using the
  firmware's own math. At the default of 16 each color channel has only 17 steps, so fades
  move in jumps and very dim colors can shift or go black. It keeps full white at full on
  your screen, so it shows those lost steps rather than how dim the boot really is. Pattern
  list thumbnails don't use it.
- **Undo** and **Redo** with ⌘Z and ⇧⌘Z. **Save** with ⌘S.

## Where recipes are kept

Every edit keeps as a draft in this browser's local storage, so nothing is lost when you
close the tab. **Save** writes `patterns/<name>.json` through the dev server and clears the
draft. A rename moves the file on the next save, and **Discard changes** goes back to the
saved file.

Save won't overwrite a file that changed after its draft started, such as in a `git pull`. The
designer rereads the folder when its window regains focus, and checks again at Save. If a file
moved on, you choose whether to overwrite it with your draft or drop the draft and use the
file. Drafts live in this browser rather than in a checkout, so a draft from one branch also
shows up on another, and this check covers that too.

The dev server only listens on localhost. It only writes `.json` files with valid recipe
names, inside the patterns folder, and checks each recipe before writing it. To try things
without touching the repo, point it somewhere else:

```bash
PATTERNS_DIR=/tmp/scratch-patterns bun run dev
```

A built copy (`bun run build`) has no dev server, so it works from drafts, download, and
import only. Save and Delete stay off, and a banner says why.

## How the simulation works

- `src/recipe/`: the format. `spec.ts` has every layer's fields, ranges, and defaults, which
  the validator and the settings panel both read. `serialize.ts` writes files the same way
  every time.
- `src/engine/`: runs a recipe one 16 ms frame at a time, like the firmware's patterns.
  `strip.ts` is a port of `include/firewalker_strip_map.h`, and `output.ts` is a port of how
  the strip driver applies brightness. `referenceFrames.ts` saves what this engine draws for a
  fixed script of motion to `test/fixtures/recipe-frames/`, using only the test recipes in that
  folder, so the firmware's engine can be checked against it. Nothing in `patterns/` affects these
  files. They only change with the engine or those test recipes, and `bun run reference-frames`
  rewrites them.
- `src/sim/`: the boot drawings and the frame loop. The drawings assume the controller, and
  so pixel 0, is on the boot's outer side.
- `server/`: the dev server's `/api/patterns` endpoints.

The screen shows LEDs brighter than the raw numbers, because LEDs are linear and screens
aren't (a 1/2.2 gamma). Colors on a real strip will look a little different, especially
dim ones. Check a recipe on a boot before calling it done.
