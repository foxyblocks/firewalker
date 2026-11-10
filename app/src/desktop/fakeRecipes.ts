/** Combines the existing remote and recipe fake protocols for desktop demos and tests. */
import type { FakeBoot } from "../transport/fakeBoot";
import { FakeBoot as RecipeBoot } from "../../../designer/src/boot/fakeBoot";

export function configureFakeRecipes(boot: FakeBoot): void {
  const recipes = new RecipeBoot({ id: boot.id, proto: boot.proto });
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
}
