# Patterns on main reach boots through a CDN catalog that the phone syncs on connect

Merging a pull request with a new or changed pattern should be enough to get it onto both boots.
Sending each one from the designer by hand is easy to forget, and a boot can quietly fall behind.
So **main is canonical**: whatever recipes `patterns/` holds on main are what every boot gets.
Anything sent from the designer is an **experiment copy**.

1. **On every push to main**, the Publish pattern catalog workflow
   (`.github/workflows/publish-catalog.yml`) runs the recipe tests, compiles every recipe in
   `patterns/` into one **pattern catalog** file (`designer/server/catalog.ts`, format in
   `shared/patternCatalog.ts`), and uploads it to
   `https://cdn.foxyblocks.com/files/firewalker-catalog.json` with a one-minute cache. A recipe that
   can't compile fails the build, so a broken catalog is never published. The catalog carries each
   pattern's compiled bytes, their checksum, and the source recipe.
2. **The iPhone app** downloads the catalog at launch and whenever it returns to the foreground,
   and keeps the last good copy, so it can sync boots later with no signal
   (`app/src/core/patternLibrary.ts`). The file is about 12 KB, so this doesn't wait for Wi-Fi. A
   catalog with any entry that fails its own checksum, size, or name check is rejected whole.
3. **When a boot connects**, the app asks it what it has uploaded, and uploads only recipes that
   are new or changed by checksum (`app/src/core/syncPlan.ts`, run by `patternSync.ts`). It never
   selects a pattern. It needs no firmware change and works with any firmware that has the recipe
   commands (protocol 3 and up).

Sync deletes an upload only if this phone put it there earlier and main no longer has it. The
phone remembers what it put on each boot, keyed by the boot's own id. An upload the phone never put
there, and that main doesn't have, is someone's experiment, so sync leaves it alone. An experiment
that reuses a main pattern's name is reset to main's version the next time that boot connects.

## Considered options

- **Ship the recipes inside the app**: rejected. Every pattern change would need an app build and
  a new install on the phone, which is the step this removes.
- **Serve the catalog from the hosted desktop app** (firewalker.vercel.app already ships
  `/patterns.json`): rejected. It sits behind Vercel's sign-in, which the phone can't pass.
- **Have the phone compile recipes from `patterns/*.json`**: rejected. It would pull the
  designer's compiler into the phone bundle, and the phone would have to trust that its compiler
  matches the firmware's decoder. The catalog carries the exact bytes CI compiled and tested.
- **Have boots fetch the catalog themselves**: rejected. Boots have no internet connection, only
  Bluetooth and USB.
- **Wait for Wi-Fi before downloading**: rejected. The file is small, and waiting would leave boots
  behind for no gain.
- **Send CORS headers from the CDN**: not needed. The CDN's Worker serves files without them, and
  the phone downloads through Capacitor's native HTTP, which has no origin to check. Chrome, which
  does check, gets a live catalog from the dev server instead (`app/build/catalog.ts`).

## Consequences

- `recipe info` only answers for uploads, not built-ins, so sync can't tell whether a built-in
  matches main. It uploads every catalog recipe, built-ins included, as an upload that overrides
  the built-in of the same name. A boot has 16 upload slots, so **16 patterns on main is the
  ceiling** for now, and a boot's own experiments share those slots. When slots run out, sync
  uploads what fits and the remote says how many didn't. The follow-up that lifts this is a
  firmware change: `recipe info` reporting built-ins' checksums too, so sync can skip a built-in
  that already matches main.
- A boot whose firmware can't read a recipe's version keeps the rest, and the remote says it needs
  a firmware update for that many patterns.
- The catalog workflow needs three repository secrets for the CDN's R2 bucket: `R2_ACCOUNT_ID`,
  `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. The token is an R2 API token with Object Read &
  Write on the `foxyblocks-cdn` bucket only. Until they're added, the workflow fails with a message
  naming them, and the catalog stays at its last published copy.
- Only the iPhone build syncs. The desktop app leaves boots alone, so trying a recipe from the
  designer isn't undone while the designer is open. Desktop could opt in later by starting a
  `PatternSync` the way `app/src/native.tsx` does.
- Each recipe takes its own turn in a boot's command queue, so remote taps get through between
  recipes. `PatternSync.pause` holds one boot's sync between recipes, for a future live-editing
  session that needs the queue.
- The phone's library already has room for the person's own pattern copies beside main's:
  library patterns carry an origin (`canonical` or `mine`), each origin has its own storage key,
  and main's pattern wins a name both have.
