# Recipe engine, built-in recipes, and upload

Status: Approved by foxy on 2026-11-04, with `starfield` and `lava-pour` taken out of the built-ins.
Firmware work starts on the `recipe-engine` branch, cut from `main` once PR #9 merges.
Date: 2026-11-04

## Summary

Boots start running recipes. One phase delivers three things together:

1. A C++ recipe engine in the firmware.
2. A chosen set of recipes from `patterns/` built into the firmware: `rainbow-pool`, `fire-stomp`,
   and `comet`.
3. Uploading, listing, and deleting recipes over BLE and USB.

The designer compiles a recipe's JSON into a small binary. That one compiler feeds both the
built-ins and uploads. The firmware only ever sees the binary.

## Decisions

foxy approved these on 2026-11-04.

| # | Decision | Why |
|---|---|---|
| 1 | Engine, built-ins, and upload ship as one phase | foxy's choice on the roadmap |
| 2 | One compiler, in the designer. The firmware has no JSON parser | One format to get right, and a much smaller firmware job |
| 3 | One recipe is one flash entry of at most 254 bytes, name and checksum included | A single entry saves all at once, so a power cut can't leave half a recipe |
| 4 | The TypeScript engine is the reference. C++ must match its frames within ±1 per channel | Catches drift before a boot ever sees it |
| 5 | `flow` and `fire-trail` stay in C++ this phase | Lets us compare them against `rainbow-pool` and `fire-stomp` on a real boot before retiring anything |
| 6 | Patterns are known by name everywhere. `PatternId` goes away | A fixed list can't hold uploads, and a name means the same thing after any firmware change |
| 7 | Upload is 15 bytes per command, one at a time. The recipe's own CRC-32 is the checksum | Fits the 48-byte command limit, and nothing is saved until the whole recipe checks out |
| 8 | Each boot has 16 upload slots | Far more than today's five keepers, and only about 4 KB of a 40 KB region |
| 9 | An upload can replace a built-in of the same name, on that boot. `flow`, `fire-trail`, and `off` can't be replaced | Otherwise you couldn't send a tweaked `comet` to a boot to try it |
| 10 | The boot lists the recipe versions it can read. Version 1 freezes when the first firmware ships | Boots only update over USB, so the designer will often be newer |
| 11 | Built-ins are a generated file checked into the repo. A stale file fails the firmware build | Firmware builds don't need Bun, and you can't flash old built-ins by accident |
| 12 | The designer is the only upload client this phase | The iPhone app already lists and selects whatever a boot reports |
| 13 | Measure flash, RAM, and frame time on a board before version 1 freezes | A legal recipe may be too slow at 39 MHz, and the fix is a lower limit in the format |
| 14 | Only `rainbow-pool`, `fire-stomp`, and `comet` are built in. `starfield` and `lava-pour` stay in `patterns/` as recipes you upload. A list in `patterns/built-ins.txt` sets this | foxy's change to the draft. Being in `patterns/` means a recipe is kept, and being on the list means every boot ships with it |

Rejected for storage:

- **Splitting a recipe across several flash entries.** It removes the 254-byte limit, but a
  power cut could then leave half a recipe, so it needs commit logic. No recipe we have comes
  close to needing it.
- **The board's 4 MB external flash.** It's reachable through `SPI1`, with chip select on
  pin 21 (PA6), but the core has no driver for storing data on it, and it hasn't been tested
  on a board. NVM3 already fits everything. It stays an option if slots or sizes ever run out.

## Problem Statement

The designer makes recipes that no boot can run. A boot's pattern list is a fixed enum, and
its commands max out at 48 bytes. Recipes are 577 to 1,252 bytes of JSON, while a flash entry
holds 254. So running a recipe needs an engine, a smaller format, a dynamic pattern list, and
a way to send a recipe in pieces.

## Goals

- Run the built-in recipes on a boot with no upload.
- Send any other recipe to a boot in a couple of seconds, with no firmware build. That includes the
  ones kept in `patterns/` that aren't built in.
- Keep uploads through a firmware update and a power cycle.
- Make a recipe look the same in the simulator and on a boot, apart from what the strip and
  brightness do to color.
- Keep motion sensing and the radio healthy whatever recipe is running.
- Keep every boot's saved settings through this update, including foxy's captured poses.

## Non-Goals

- Upload or editing from the iPhone app. Its pattern list works as is.
- Retiring `flow` and `fire-trail`.
- A WASM build of the engine. Reference frames cover drift for now.
- The external flash chip.
- New layer types or knob sources.
- Pairing or any other access control. Anyone nearby can already send a boot commands, and
  uploads don't change that. See Risks.
- Synchronization between shoes, and over-the-air firmware updates.
- Recording a real walk and replaying it in the simulator. That's worth doing, separately.

## Terms

Add these to `CONTEXT.md`.

- **Native pattern**: written in C++. Today `flow` and `fire-trail`.
- **Kept recipe**, or **keeper**: any recipe in `patterns/`. It's in the repo, but it only reaches
  a boot by being built in or uploaded.
- **Built-in recipe**: a keeper listed in `patterns/built-ins.txt`, compiled into the firmware. It
  can't be deleted.
- **Uploaded recipe**: a recipe stored in one boot's flash, in a **slot**.
- **Compiled recipe**: the binary form of a recipe.

## The compiler

One module, `designer/src/recipe/compile.ts`, with no Node imports so it runs in the browser
and in scripts.

- `compileRecipe(recipe)` returns the bytes, or a list of problems in plain language.
- `decodeRecipe(bytes)` turns bytes back into a recipe, for tests and reference frames.

It runs the validator first. Then it:

- Drops `description`, `label`, and `format`, which the boot never uses.
- Drops disabled layers, since a boot has no way to turn one on. A recipe with no enabled
  layer is an error.
- Refuses a result over 254 bytes, and says how far over it is.

`bun run build-recipes`, a script in `designer/scripts/`, writes two things:

| File | Holds |
|---|---|
| `include/generated/recipe_builtins.h` | Each built-in's bytes, and a hash of the list and the files they came from |
| `include/generated/recipe_tables.h` | Every layer's field order, kinds, and ranges, plus the format's limits and reserved names, all from `spec.ts` and `types.ts` |

Checks that keep these honest:

- The designer's Save compiles the recipe first, and refuses one that doesn't compile.
- When the saved recipe is on the built-ins list, Save then re-runs the built-ins step, so the
  header changes in the same commit as the recipe. Saving any other recipe, or saving to a
  `PATTERNS_DIR` scratch folder, doesn't touch it.
- A PlatformIO build step recomputes the hash and fails the build if the header is stale,
  telling you to run `bun run build-recipes`. This needs Python only, not Bun.
- A designer test fails if any generated file differs from what the script would write.

### Choosing the built-ins

`patterns/built-ins.txt` lists them, one name per line. Lines starting with `#` are comments.

```text
# Recipes compiled into the firmware. Everything else in this folder can still be uploaded.
comet
fire-stomp
rainbow-pool
```

- **Adding or removing a built-in** means editing this file, running `bun run build-recipes`, and
  flashing the boots.
- **`bun run build-recipes` fails** on a name with no recipe, or on more than 14 names.
- **The designer shows a "Built in" label** on those recipes. It's read-only for now.
- **Renaming a built-in** in the designer updates the list. **Deleting one** removes it from the list,
  and the delete dialog says so.

It's a `.txt` file so the designer, which treats every `.json` in the folder as a recipe, ignores it.

Rejected:

- **A `builtIn` field in each recipe.** A recipe describes a look, and which recipes boots ship with is
  a choice about the firmware. The field would also travel with every download and import, and the boot
  has no use for it.
- **Reading the table in `patterns/README.md`.** Editing the docs shouldn't be able to change the
  firmware.
- **A list in `config.h` or `platformio.ini`.** The compiler that needs the list runs in the designer,
  which would then have to parse firmware files. It also puts the list far from the recipes it names.

## Binary layout

Version 1. Numbers are little-endian. The first byte is the same `version` as the JSON file,
so there's one version number to think about.

**Recipe**

| Bytes | Field |
|---|---|
| 1 | `version`, 1 |
| 1 | Name length, 1 to 12 |
| 1 to 12 | Name, ASCII |
| 1 | Layer count, 1 to 8 |
| varies | Layers, first drawn first |
| 4 | CRC-32 of everything before it, using the firmware's existing `settingsCrc` |

**Layer**

| Bytes | Field |
|---|---|
| 1 | Type: fill 0, pool 1, trail 2, flash 3, sparkle 4, chase 5 |
| 1 | Bound-knob mask. Bit k set means the layer's k-th knob is a binding |
| varies | Fields in the order below |

| Type | Fields in order (knobs marked \*) |
|---|---|
| fill | palette, spread, repeat\*, offset\*, scroll\*, brightness\*, blend, opacity\* |
| pool | baseline\*, blend, opacity\* |
| trail | trigger, from, flatZone, palette, speed\*, length, brightness\*, maxFronts, blend, opacity\* |
| flash | trigger, palette, fadeMs, brightness\*, blend, opacity\* |
| sparkle | palette, density\*, fadeMs, brightness\*, blend, opacity\* |
| chase | path, palette, count, speed\*, length, brightness\*, blend, opacity\* |

**Fields**

| Kind | Bytes | Encoding |
|---|---|---|
| Choice | 1 | Index into the field's options, in `spec.ts` order |
| Whole number (`length`, `fadeMs`, `count`, `maxFronts`) | 2 | `uint16` |
| Fraction (`flatZone`) | 2 | Scaled, below |
| Palette | 1 + 3n | Color count, then R, G, B per color |
| Fixed knob | 2 | Scaled |
| Bound knob | 5 or 7 | Source, scaled `min`, scaled `max`, and for `wave` or `stompFade` a `uint16` for `periodMs` or `fadeMs` |

Sources: tilt 0, tiltAmount 1, stompStrength 2, stompFade 3, wave 4.

**Scaled numbers** are `int16`. With `range` as the larger of the field's `|min|` and `|max|`:

- Encode: `round(value / range × 32767)`
- Decode: `raw / 32767 × range`, then clamp to the field's `min` and `max`

So a speed of 60 on a ±400 field is stored as 4915 and reads back as 59.9994. The error is
at most about 0.002% of the range, which can't show up in 8-bit color. The ranges live in the
generated table, so nothing needs a second copy of them.

Reordering a field or an option changes what saved recipes mean. A test pins the exact bytes
of the test recipes that sit with the reference frames, so that can't happen quietly. It doesn't use
the recipes in `patterns/`, so tuning a pattern can't trip it.

## Size limits

| Limit | Value | Set by |
|---|---|---|
| Compiled recipe | 254 bytes, all included | NVM3's largest entry |
| Layers | 8 | Format, unchanged |
| Palette colors | 16 | Format, unchanged |
| Upload slots | 16 | `RECIPE_SLOTS` in `config.h` |
| Built-in recipes | 14 | Keeps the `patterns` reply under its line limit |

NVM3's numbers come from the core's `variants/xiao_mg24/ble_silabs/include/nvm3_default_config.h`,
and read the same in the built firmware: a 40,960-byte region, a 254-byte largest entry, and a
200-entry cache. They're compiled into the core's `gsdk.a`, so editing the header alone wouldn't
change them.

Sizes under this layout. No compiler exists yet, so these come from a throwaway encoder that
follows the layout above:

| Recipe | JSON | Compiled |
|---|---|---|
| `fire-stomp` | 577 | 50 |
| `lava-pour` | 885 | 68 |
| `comet` | 1,004 | 74 |
| `starfield` | 1,053 | 83 |
| `rainbow-pool` | 1,252 | 103 |

What fits in 254 bytes, with 12-character names:

| Recipe shape | Bytes | |
|---|---|---|
| 5 layers, 6 colors each, one binding each | 179 | Fits |
| 6 layers, 4 colors each, one binding each | 187 | Fits |
| 8 layers, 3 colors each, no bindings | 193 | Fits |
| 8 layers, 4 colors each, one binding each | 254 | Just fits |
| 8 layers, 6 colors each, one binding each | 296 | Too big |
| 8 fills, 16 colors each, every knob bound | 723 | Too big, the largest legal recipe |

Every kept recipe is meant to run on a boot, built in or uploaded, so a recipe has to compile to be
kept. The designer shows the size all the time, such as `103 / 254 bytes`, and turns it red when
over. A draft can go over while you work. Save and Send to boot both refuse it, with a clear reason.

## The C++ engine

| File | Role |
|---|---|
| `include/firewalker_recipe.h` | Decoded structs and the decoder. Pure, no Arduino |
| `include/firewalker_recipe_engine.h` | The engine. Pure, no Arduino |
| `include/patterns/recipe_pattern.h`, `src/patterns/recipe_pattern.cpp` | The `Pattern` that copies the engine's frame to `strip` |

The pure files live in `include/` so `pio test -e native` can run them, like the strip map.
There's one engine with static buffers sized for `STRIP_MAX_PIXELS`, because only one pattern
runs at a time. Nothing allocates after startup.

**The decoder trusts nothing.** Uploads come from anyone in range. It refuses a wrong version,
a bad checksum, a bad name, too many layers, an unknown type or option or source, a palette of
0 or more than 16 colors, data running past the end, and leftover bytes. It clamps every number
to its field's range. Refusing means the recipe doesn't run. It never means a crash.

**Rules that keep the two engines matching.** The TypeScript engine does its math in doubles and
C++ floats don't round the same way, so:

- State that builds up over time is `double`: fill phase, chase position and progress, front
  heads, and sparkle's pending count. Per-pixel work is `float`, since the chip's math hardware
  only does floats.
- Time is whole milliseconds in `uint32_t`. A `float` loses whole milliseconds after about 4.6
  hours, and `wave` would start to jitter.
- Rounding is `floor(x + 0.5)`, because that's JavaScript's `Math.round`. C's `round` differs on
  negative halves.
- Scaled numbers decode in single precision on both sides, so a fixed knob is the exact same value.
  Knob values are then worked out in `double`, since they feed the state that builds up.
- Random numbers use the same xorshift32, the same seed, and the same order of draws.
- "No stomp yet" is an explicit state, where TypeScript uses `Infinity`.
- Both engines clamp `dt` to 250 ms, so a long stall can't make one frame do unbounded work.
- A frame becomes 8-bit with `floor(v × 255 + 0.5)`. Brightness stays in `LedStrip`.
- A speed-up is fine if the output doesn't change, such as a precomputed color ramp for a trail.

A change to engine behavior goes into both engines in one commit, with new reference frames.

## Reference frames

These are the acceptance test for the port. They already exist, in `test/fixtures/recipe-frames/`,
written by `bun run reference-frames`. That folder's README describes the file formats. They only
change when the engine or their test recipes do, so saving a pattern never touches them.

- **Inputs:** a fixed script of about 7 seconds, with uneven `dt`, a tilt sweep, stomps at several
  strengths, and stomps at exactly level so `flat` triggers fire.
- **Recipes:** only the small test recipes in that folder's `recipes/`, which together cover every layer
  type, blend, knob source, trail origin, and chase path. A test fails if a new one has no coverage.
  Their compiled bytes sit beside the frames, so the C++ test doesn't depend on which recipes are built in.
- **Not the recipes in `patterns/`.** They're combinations of the same layers, and they change every time
  someone tunes a pattern. If the built-ins ever need parity checks, the compiler's round-trip tests can
  cover them.
- **Layouts:** the uncut bench strip (160 px, toe 52, heel 132) and boot `3EB5` (107 px, toe 72,
  heel 19). One runs toe first and the other heel first.
- **Path:** JSON, then compile, then decode, then the TypeScript engine. So rounding from the
  binary format can't cause a false failure.
- **Stored:** 8-bit frames every 16th frame, as binary files, about 220 KB in all. A native test reads
  them. The C++ engine still runs every frame in between.
- **Pass:** every checked channel within ±1. A failure names the recipe, frame, pixel, and channel.

## Dynamic pattern list

A new pure header, `include/firewalker_pattern_list.h`, answers two questions: what can this boot
show, and what does a name mean? It looks in this order:

1. `off` and the native patterns.
2. Uploaded recipes.
3. Built-in recipes.

So an upload hides a built-in of the same name, and deleting the upload brings the built-in back.

`patterns` lists native patterns, then built-ins and uploads together in alphabetical order, with
each name once. The most names is 32 (2 native, 14 built-in, 16 uploaded). Raise `REMOTE_LINE_MAX`
from 440 to 520 so the longest list fits on one line.

**What changes in the code:**

- `Command.pattern` holds a name. The parser checks only that it's a legal name. "Is there such a
  pattern" moves to `final_app`, which still answers `unknown-pattern`.
- `SELECTABLE_PATTERNS` and `patternName` go away. `showPattern` takes a name.
- `formatPatterns` and `formatStatus` take strings.
- `REMOTE_PROTOCOL_VERSION` goes to 3.

**The iPhone app needs no change for this.** It treats a boot as outdated only below protocol 2,
it accepts a `patterns` line at any time, its parser skips reply types it doesn't know, and
`patternDisplay` makes a name for a pattern it doesn't know, such as "Rainbow pool".

## Migrating saved settings

`SettingsRecord` version 4 stores names:

| Field | Change |
|---|---|
| `pattern`, `lastLitPattern` | From `uint8_t` to `char[13]` |
| Everything else | Same values |
| Size | 60 bytes. Version 3 is 32 and version 2 is 28, and the store tells them apart by size |

- A version 3 record maps 1 to `flow`, 2 to `fire-trail`, and 3 to `off`, and keeps everything else.
- A version 2 record still loads the way it does today.
- The numbers live on only inside those old decoders, as named constants.
- The first save after the update writes version 4.
- Going back to older firmware loses the settings, as it does today. It also finds uploads it can't
  read and ignores them.

**A saved name that no longer exists** is normal, because a recipe can be deleted. The boot switches
to `flow`, saves that, and keeps its brightness, poses, and strip layout. A missing pattern never
costs a calibration. `lastLitPattern` falls back the same way.

## Commands

All of these fit `REMOTE_COMMAND_MAX` (48, so 47 characters), and all work the same over BLE and USB.

| Command | Effect | Longest |
|---|---|---|
| `recipes` | Lists uploaded recipes, free slots, and readable versions | 7 |
| `recipe info <name>` | Reports one uploaded recipe's size and checksum | 24 |
| `recipe begin <name> <bytes>` | Starts an upload | 29 |
| `recipe data <offset> <hex>` | Sends up to 15 bytes, as up to 30 hex characters | 46 |
| `recipe end` | Checks the whole recipe and saves it | 10 |
| `recipe cancel` | Abandons the upload | 13 |
| `recipe delete <name>` | Deletes an uploaded recipe | 26 |

An upload looks like this. The first line of data is `comet`'s real first 15 bytes.

```text
> recipe begin comet 74
< {"t":"ack","cmd":"recipe","ok":true,"next":0}
> recipe data 0 0105636f6d6574030000027a00ffff
< {"t":"ack","cmd":"recipe","ok":true,"next":15}
  ...
> recipe end
< {"t":"ack","cmd":"recipe","ok":true}
< {"t":"patterns","list":["flow","fire-trail","comet",...]}
```

- **One line at a time.** A client waits for each `ack`, so the 8-line BLE queue can't overflow.
- **The offset guards the order.** A lost or repeated line gets `wrong-offset` with the right `next`,
  and the client carries on from there.
- **The checksum is the recipe's own CRC-32.** `recipe end` checks the size, the checksum, and the
  decoder, and that the name inside matches `begin`. So the same check covers the trip and later
  storage.
- **Nothing touches flash until `recipe end`.** Bytes wait in one 254-byte RAM buffer. A `recipe cancel`,
  or 5 seconds of silence (`RECIPE_UPLOAD_IDLE_MS`), throws them away. So a dropped link just times out.
  A new `begin` replaces any upload in progress.
- **Saving is one NVM3 write,** to keys `0xF110` to `0xF11F`. Replacing a recipe overwrites its own
  key, so a power cut leaves the old recipe or the new one.
- **The pattern keeps running throughout.** If the recipe on the strip is replaced, it restarts with
  the new version, which makes tuning on a boot quick. Upload doesn't select a recipe by itself. The
  designer sends `pattern <name>` after it.
- **Recipe commands don't send a status line** until something has actually changed.

**Replies**

```json
{"t":"recipes","versions":[1],"slots":16,"free":15,"list":["comet"]}
{"t":"recipe","name":"comet","bytes":74,"crc":"cb75d224"}
```

`recipe info` lets the designer see that a boot already has this exact recipe, and skip sending it.

Deleting sends a fresh `patterns` line. If the deleted recipe was on the strip, its built-in takes over
if there is one. Otherwise the boot switches to `flow`.

**New errors:** `bad-name`, `name-reserved`, `name-mismatch`, `too-big`, `no-room`, `no-upload`,
`wrong-offset`, `bad-hex`, `short`, `bad-checksum`, `bad-recipe`, `unsupported-version`, `save-failed`,
`not-found`, and `built-in`, for trying to delete a built-in that has no upload over it.

**BLE writes:** today's protocol promises that every command fits a default 20-byte write. `recipe`
commands break that promise, and every other command keeps it. Clients must send them as writes with
response, which the app's `BleClient.write` already does. Test this at the default packet size as well
as a negotiated one.

**At these sizes,** `rainbow-pool` takes 7 data lines and the largest recipe 17. By my estimate that's
under 2 seconds over BLE, and less over USB.

## Reporting recipe versions

`versions` in the `recipes` reply lists every version this firmware can read. Protocol 3 is what says
`recipes` exists at all, so the designer checks in this order:

1. `proto` below 3: "This boot needs a firmware update over USB."
2. `versions` doesn't include the recipe's version: the same message.
3. Otherwise, send it.

After version 1 freezes, any change to a field, its order, or an option is version 2. New firmware keeps
reading version 1 for as long as it can, because uploads live through firmware updates. An upload in a
version the firmware can't read stays in `recipes` so it can be deleted or replaced, but it isn't
selectable.

Fields added while building the designer, such as a chase's `path`, didn't need a new version because
nothing had shipped. That ends with this phase.

## Names that clash

| Name | Rule |
|---|---|
| `off` | Reserved |
| `flow`, `fire-trail` | Reserved while they're native patterns |
| A built-in's name | Allowed. The upload replaces it on that boot |
| Another upload's name | Allowed. The upload replaces it |

- The validator already refuses all three, so the designer and dev server do too. The compiler runs
  the same check.
- The firmware refuses them on its own too, with `name-reserved`.
- The reserved list is generated into `recipe_tables.h`, and a native test checks that it matches the
  firmware's native patterns.

## Budgets on the board

The chip runs at 39 MHz, per the core's `boards.txt`. Measure on a real board, with BLE connected and
`debug on`, before version 1 freezes.

| Budget | Today | This phase adds (estimate) | Pass |
|---|---|---|---|
| Program flash | 266,304 bytes, 16.9% of the chip's 1,572,864 | 30 KB | Under 350 KB |
| Static RAM | 28,272 bytes of 262,144 | 16 KB at 160 px | Under 50 KB |
| Heap, shared with BLE | 231,528-byte region, free amount unknown | Nothing | At least 64 KB free while connected |
| Loop task stack | Core sets 2048, units to confirm | Static buffers only | At least 512 bytes spare at its deepest |
| NVM3 region | 40,960 bytes, shared with settings and BLE | Up to 4,064 bytes | All 16 slots full at 254 bytes, with settings still saving |
| Frame time | 16 ms per frame | Below | Below |

PlatformIO reports flash as 4.6% of 5,767,168. That total appears to include the external chip, which
this build doesn't use, so the table uses the chip's own flash.

**Frame time.** Each frame has 16 ms. `show()` takes about 4.8 ms, because it always sends all 160
pixels, and it blocks the main loop. That leaves about 11 ms, and motion and the radio need some of it.

| Case | Engine time per frame |
|---|---|
| The five keepers, on their real boots | Under 4 ms |
| The heaviest legal recipes, at 160 px | Under 9 ms |

Also pass: at least 50 frames a second, no missed stomps, and no BLE drops, including while saving a
recipe.

Add `frameUs`, the slowest engine time since the last line, to the debug `motion` line. It stays after
this phase. Test with three heavy recipes, built in for a test build only:

- 8 fills spread around the ring, with mixed blends.
- 8 trails, each with 16 fronts of 60 pixels.
- 8 sparkles at full density.

**The trail recipe is the likely failure.** It's only 187 bytes, so it's legal, and it can paint up to
7,680 pixels a frame. My rough estimate is about 20 ms at 39 MHz. Being over budget doesn't crash
anything, since animations follow `dt` and just drop frames, but it squeezes motion and the radio.

If a case fails, fix it in this order, before version 1 freezes:

1. Speed up the engine without changing its output, such as color ramps and skipping dark pixels.
2. Lower the format's limits, such as fronts or trail length, in both the validator and the decoder.

## The designer

- **Size meter**, as described above.
- **Send to boot**, on the Design screen. It connects over USB or BLE, checks versions, skips an
  identical recipe, sends the current version with no need to Save first, selects it, and shows
  progress. Errors use plain language.
- **Each boot is sent to separately,** because a boot takes one connection and keeps its own flash.
- **It shares the app's connection code, without copying it,** through a Bun workspace: the `Transport`
  seam, `protocol.ts`, and `ble.ts`. USB comes from draft PR #8's `usb.ts`, so that PR merges first.
- The upload steps are one pure function over `write(line)`, tested against `fakeBoot`.

## Risks and Mitigations

- **Frame time at 39 MHz.** The biggest unknown, so it's measured before the format freezes. See above.
- **Two engines drifting.** Reference frames, and the rule that behavior changes go into both at once.
- **Anyone nearby can upload.** There's no pairing today, so anyone in range can already change a boot's
  pattern or calibration. Uploading adds a nuisance: filling slots. The decoder keeps bad data from
  crashing a boot, and the brightness cap still limits current on any recipe.
- **Flash shared with BLE.** Test all 16 slots full, repeated uploads, and a power cut during a save.
  Measure any frame hiccup when NVM3 compacts.
- **A status or list line getting too long.** The longest status line with 12-character names is about
  400 characters, under the limit. A native test builds the longest possible `patterns` line.
- **Web Serial's buffer.** PR #8 found a status line already passes Web Serial's default 255 bytes. Check
  that its buffer also fits a 520-byte `patterns` line.
- **Recipes that look different on a boot.** Expected at low brightness, where the default of 16 gives
  only 17 steps per channel. The simulator's Boot brightness setting shows that.
- **Flashing boots other people are using.** Check the board is free and ask foxy first. A boot's settings
  can be lost by a flash during a check.

## Rollout

Each step lands on its own, building and passing its tests.

1. **Compiler.** `compile.ts`, generated tables, reference frames from compiled recipes, size meter, and
   the CI job from the Open Questions. No firmware changes.
2. **Engine, off hardware.** Decoder and engine in pure C++, passing reference frames under
   `pio test -e native`.
3. **Budgets.** Run the keepers and the heavy recipes on one board. Change limits if needed. Then freeze
   version 1.
4. **Dynamic list and built-ins.** Pattern list, settings version 4, protocol 3, `RecipePattern`,
   generated built-ins, and the build's staleness check. Check the upgrade on a boot with real poses.
5. **Upload.** Recipe store, upload commands, and their tests, driven over the USB console first.
6. **Send to boot.** The shared connection code and the designer's button, over USB and then BLE.
7. **Both boots, and docs.** Run the acceptance list on `3EB5` and `3ED8`. Update:
   - `docs/recipe-format.md`: the binary layout.
   - `docs/remote-protocol.md`: the new commands, and protocol 3.
   - `docs/adr/0005-pattern-recipes.md`: close the open question on built-ins.
   - `CONTEXT.md`, `CLAUDE.md`, `designer/README.md`, and `patterns/README.md`, which should say which
     recipes are built in and point to `built-ins.txt`.
   - `docs/open-questions.md`: its scope list still names only flow and fire-trail.

## Testing Plan

**Designer (`bun run test`)**

- Every keeper compiles. Every test recipe's bytes match a pinned copy.
- Compile then decode returns the same recipe, within rounding.
- Too big, no enabled layers, and reserved names all give clear errors.
- Generated files are current. Saving a recipe that isn't built in leaves them unchanged.
- `build-recipes` fails on a listed name with no recipe, and on too many names. A rename updates the
  list, and a delete removes the name from it.
- Upload steps against `fakeBoot`: normal, `wrong-offset`, an error at each step, and a dropped link.

**Firmware (`pio test -e native`)**

- `test_recipe_decode`: every built-in and every reference case decodes, plus corrupted, cut-off, and
  out-of-range bytes, which must
  be refused or clamped without reading out of bounds. Run with address checks on where the host allows.
- `test_recipe_engine`: reference frames.
- `test_recipe_upload`: the upload steps, the timeout, and bad input.
- `test_pattern_list`: lookup order, a hidden built-in, a missing name, and the longest list.
- `test_settings`: version 4, and version 3 and 2 upgrades.
- `test_remote_protocol`: new commands at their longest, and names in place of `PatternId`.

**On a board**

- All budgets above.
- Upload, list, info, and delete over USB and BLE. Use `starfield` and `lava-pour`, which only reach a
  boot this way.
- Power cut during `recipe data`, and during `recipe end`.
- Fill every slot, then get `no-room`. Delete one and upload again.
- Replace the recipe on the strip, and delete the recipe on the strip.
- Reflash the firmware and confirm uploads survive.
- Upgrade a boot on protocol 2, and confirm its poses, strip layout, and pattern survive.
- Compare `rainbow-pool` with `flow`, and `fire-stomp` with `fire-trail`, by eye.
- The iPhone app lists and selects recipes on both boots.
- Upload over USB with the iPhone app connected over BLE. Replies go to both, so the app sees acks it
  didn't ask for, and it must not get confused.

## Acceptance Criteria

- `rainbow-pool`, `fire-stomp`, and `comet` run on both boots with no upload. `starfield` and
  `lava-pour` aren't listed until they're uploaded, and then they run too. All five look like the
  simulator apart from known brightness effects.
- The C++ engine matches every reference frame within ±1.
- A recipe sent from the designer shows on a boot over both USB and BLE, in under 5 seconds.
- Uploads survive a power cycle and a firmware update. A power cut during an upload never damages a
  recipe that was already saved.
- A corrupted upload is refused with a reason, and never crashes a boot.
- `flow`, `fire-trail`, and `off` can't be replaced. An upload can replace a built-in, and deleting it
  brings the built-in back.
- A boot updated from protocol 2 keeps its poses, strip layout, brightness, and pattern.
- Deleting the selected recipe leaves the boot running, with its calibration intact.
- The designer shows a recipe's size, refuses one over the limit, and tells you when a boot needs a
  firmware update.
- Every budget passes on a board, with the results recorded in `docs/power-budget.md` or a new budget doc.
- The iPhone app lists and selects recipes with no app change.
- A stale built-ins header fails the firmware build, and changing `built-ins.txt` without rebuilding
  counts as stale.

## Open Questions

Approving the plan accepted these recommendations. They stand unless foxy says otherwise.

1. **Branch and merge order.** Recommend a new branch named `recipe-engine`, cut from `main` once PR #9
   merges, because this work builds on the designer and `patterns/`. PR #8 merges before step 6.
2. **If the heavy recipes miss the frame budget.** Recommend lowering the format's limits. Raising the
   chip from 39 to 78 MHz might work, but it changes strip timing and sits inside the core's precompiled
   code, so it's a last resort.
3. **Slot count.** Is 16 per boot enough? Going higher costs little flash, but each extra name makes the
   `patterns` line longer.
4. **A CI job.** The repo has no CI and no commit hooks, so these checks only run when someone runs them.
   Recommend one GitHub Actions job for `bun run test` and `pio test -e native`.
5. **Save regenerating the built-ins header.** Recommend yes, so a built-in recipe and its header stay in one
   commit. The cost is that Save changes a second file.
6. **Retiring `flow` and `fire-trail`.** Recommend deciding after the comparison on a boot, as a separate
   change. Then one engine draws everything, and those two names stop being reserved.
7. **Uploading from `./cli`.** Useful on the bench, but not needed for this phase. Recommend a follow-up.

## Related Work

- [ADR-0005: pattern recipes](../docs/adr/0005-pattern-recipes.md)
- [Recipe format](../docs/recipe-format.md) and [remote protocol](../docs/remote-protocol.md)
- [PR #9: pattern designer and recipe format](https://github.com/foxyblocks/firewalker/pull/9)
- [PR #8: web app over USB](https://github.com/foxyblocks/firewalker/pull/8)
- [MG24 migration spec](mg24-migration-spec.md)
