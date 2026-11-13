/**
 * Pretend boots for desktop demos and tests: the remote's fake boot plus the designer's recipe
 * slots, which check uploads with the designer's full decoder. The phone build attaches lighter
 * slots with no designer code (transport/fakeRecipes.ts).
 */
import type { FakeBoot } from "../transport/fakeBoot";
import { attachRecipes } from "../transport/fakeRecipes";
import { FakeBoot as RecipeBoot } from "../../../designer/src/boot/fakeBoot";

export function configureFakeRecipes(boot: FakeBoot): void {
  attachRecipes(boot, new RecipeBoot({ id: boot.id, proto: boot.proto }));
}
