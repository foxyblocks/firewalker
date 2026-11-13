/**
 * Gives a pretend boot (fakeBoot.ts) recipe slots, so recipe features can be tried and tested with
 * no boot around. The slots themselves are shared/fakeRecipeBoot.ts, which checks uploads the way
 * the firmware does; this splices its replies into the pretend boot's own and keeps the boot's
 * pattern list in step with what's uploaded.
 *
 * The phone build's fake mode uses `attachFakeRecipes`, so pattern sync can be watched in Chrome
 * (`?boot=fake`, see setup.ts). The desktop app attaches the designer's version instead
 * (desktop/fakeRecipes.ts), which also runs the designer's full decoder. Keep the designer out of
 * this file: the phone's bundle imports it.
 */
import { FakeRecipeBoot } from "../../../shared/fakeRecipeBoot";
import type { FakeBoot } from "./fakeBoot";

/** Answers `recipes` and `recipe ...` lines on `boot` from `recipes`, and returns `recipes`. */
export function attachRecipes<T extends FakeRecipeBoot>(boot: FakeBoot, recipes: T): T {
  const builtIns = [...boot.availablePatterns];
  boot.commandExtension = (line) => {
    if (boot.proto < 3 || !(line === "recipes" || line.startsWith("recipe "))) return null;
    const replies = recipes.handle(line);
    boot.availablePatterns.splice(0, boot.availablePatterns.length, ...new Set([...builtIns, ...recipes.stored.keys()]));
    return replies.map((reply) => {
      const body = JSON.parse(reply) as { t: string };
      return body.t === "patterns" ? JSON.stringify({ t: "patterns", list: boot.availablePatterns }) : reply;
    });
  };
  return recipes;
}

/**
 * Recipe slots for the phone build's pretend boots. `&slots=4` gives each boot fewer slots, and
 * `&versions=1` makes their firmware read only recipe version 1, as older firmware does.
 */
export function attachFakeRecipes(boot: FakeBoot, params: URLSearchParams = new URLSearchParams()): void {
  const slots = params.get("slots");
  const versions = params.get("versions");
  attachRecipes(boot, new FakeRecipeBoot({
    id: boot.id,
    proto: boot.proto,
    ...(slots === null ? {} : { slots: Number(slots) }),
    ...(versions === null ? {} : { versions: versions.split(",").map(Number) }),
  }));
}
