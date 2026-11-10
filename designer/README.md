# Firewalker pattern designer

The desktop designer for pattern **recipes**: stack layers, set their knobs, and
watch a simulated boot react as you tilt it and stomp. Recipes save to the repo's
[`patterns/`](../patterns) folder. The format is in
[`docs/recipe-format.md`](../docs/recipe-format.md), and why it works this way is in
[ADR-0005](../docs/adr/0005-pattern-recipes.md).

**Send to boot** tries a pattern on a real boot, with no firmware build.

## Combined app

Open the **Designer** section of the Firewalker app at <http://localhost:5173>.
Start it with `bun run --cwd app dev` from the repo root, after
`bash tools/setup-worktree.sh`. It shares boot connections with the Remote section.
The [app README](../app/README.md) covers the combined workspace and Vercel deployment.

The hosted app includes every repo recipe and saves your library in this browser.
Download and import recipes to move them between devices. Local development keeps
saving directly into `patterns/`.

## Standalone development

The standalone editor remains available for focused designer development:

```bash
cd app && bun install && cd ..   # Send to boot reuses the iPhone app's connection code
cd designer
bun install
bun run dev          # http://localhost:5174
bun run test         # engine, format, storage, and geometry tests, and every file in patterns/
bun run typecheck
```

This standalone editor runs on port 5174 and manages its own boot connections. Use the
combined app on 5173 for shared Remote/Designer connections.

## Using it

- **Patterns** lists every recipe in `patterns/` plus this browser's drafts. Click a card to
  open it. Create one blank or as a copy of another, then duplicate, rename, download,
  import, or delete.
- **Design** has the layer stack on the left, the boot in the middle, and the selected
  layer's settings on the right. Drag a layer by its grip, or use its arrows, to restack it.
  Any knob can be **Fixed**, or **Follows** tilt, a stomp, a wave, or **Audio level**. The JSON tab shows
  the file as it will be saved.
- **The boot** shows from above and from its outer side, with the strip in index order
  below. Drag **Tilt**, or press **Stomp** or the space bar. A stomp lifts the boot and drops
  it, and the pattern gets the stomp the moment it lands, at the **Strength** you set.
  **Beat** stomps on every beat at the BPM beside it, and **Walk** plays a steady gait. The
  strip menu switches between each boot's saved layout and the uncut bench strip.
- **Audio source** above the boot selects Microphone or Computer audio. Click **Listen**
  to start capture and see its level and spectrum. Set a knob to **Follows → Audio level**
  and choose its Min and Max to make it react. Stopping capture returns the source to zero.
- **Boot brightness** shows what a boot's brightness setting does to a pattern, using the
  firmware's own math. It runs from 1 to 255 and starts at a new boot's default, its soft cap
  of 96, which the phone app shows as 100%. The readout gives the app's percent, and says
  "cap off" past 96, where a boot needs its cap turned off. Each color channel has 97 steps at
  96, and only 17 at 16, so fades move in jumps and very dim colors can shift or go black. It keeps full white at full on
  your screen, so it shows those lost steps rather than how dim the boot really is. Pattern
  list thumbnails don't use it.
- **Send to boot** connects to boots over USB or Bluetooth, and sends the pattern as it is right
  now, with no need to save first. It works in Chrome and Arc, and it lists and deletes what's on a
  boot too. A boot takes one connection at a time, so disconnect the iPhone app or `pio device
  monitor` first. Add `?boot=fake` to the URL to try it with pretend boots.
- Tune each boot’s microphone in the [boot remote](../app/README.md), under **Calibrate → Audio**.
- **Undo** and **Redo** with ⌘Z and ⇧⌘Z. **Save** with ⌘S.
- **The size at the top**, such as `103 / 254 bytes`, is what a recipe takes on a boot. A draft
  can go over while you work, but it turns red and can't be saved until it fits.

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

Recipes on `patterns/built-ins.txt` are built into the firmware, and they show a "Built in" label.
Saving one also updates `include/generated/recipe_builtins.h`, so commit the two together. Renaming
one updates the list, and deleting one takes it off. To add or remove a built-in, edit that file and
run `bun run build-recipes`.

The dev server only listens on localhost. It only writes `.json` files with valid recipe
names, inside the patterns folder, and checks each recipe before writing it. To try things
without touching the repo, point it somewhere else:

```bash
PATTERNS_DIR=/tmp/scratch-patterns bun run dev
```

A standalone built copy (`bun run build` in `designer/`) has no dev server, so it works from drafts, download, and
import only. Save and Delete stay off, and a banner says why.

## If a boot won't connect

The designer releases its connections after two minutes without input, or when its
tab is hidden. Boot rows stay in Send to boot; interacting reconnects them, and Send
waits for a fresh connection before uploading. An upload finishes before pausing.
The shared timeout is in [`../config/control-surfaces.json`](../config/control-surfaces.json);
see [`../config/README.md`](../config/README.md) to change or disable it.

A USB port can only be open in one program at a time. When Send to boot can't open one, it names what has it
open. For `./cli`, `pio device monitor`, a PlatformIO upload, miniterm, or a pyserial script, **Free it** asks that
program to close and connects again. If that leaves its terminal acting oddly, type `reset` there. A browser or
anything else you close yourself, because it could be doing something you'd lose. The same list from a terminal:

```bash
lsof /dev/cu.usbmodem*
```

A boot also takes one Bluetooth connection at a time, and it disappears from the browser's picker while it has
one. It's usually the iPhone app, so close the app, or connect over USB. To check, `status` over USB reports
`"ble":true` while something's connected over Bluetooth, but a boot can't say what.

## How the simulation works

- `src/recipe/`: the format. `spec.ts` has every layer's fields, ranges, and defaults, which
  the validator and the settings panel both read. `serialize.ts` writes files the same way
  every time. `compile.ts` turns a recipe into the binary a boot runs. `generateTables.ts` gives
  the firmware its copy of the format, and `bun run build-recipes` rewrites that after a format
  change.
- `src/engine/`: runs a recipe one 16 ms frame at a time, like the firmware's patterns.
  `strip.ts` is a port of `include/firewalker_strip_map.h`, and `output.ts` is a port of how
  the strip driver applies brightness. `referenceFrames.ts` saves what this engine draws for a
  fixed script of motion to `test/fixtures/recipe-frames/`, using only the test recipes in that
  folder, so the firmware's engine can be checked against it. Nothing in `patterns/` affects these
  files. They only change with the engine or those test recipes, and `bun run reference-frames`
  rewrites them.
- `src/sim/`: the boot drawings and the frame loop. The drawings assume the controller, and
  so pixel 0, is on the boot's outer side.
- `src/boot/`: connecting to boots and sending recipes. It reuses the iPhone app's Bluetooth and USB
  code from `app/`.
- `server/`: the dev server's `/api/patterns` endpoints, and `builtins.ts`, which keeps the
  firmware's built-in recipes in step with `patterns/built-ins.txt`.

The screen shows LEDs brighter than the raw numbers, because LEDs are linear and screens
aren't (a 1/2.2 gamma). Colors on a real strip will look a little different, especially
dim ones. Check a recipe on a boot before calling it done.
