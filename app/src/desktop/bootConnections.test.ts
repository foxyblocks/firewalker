// Exercise the desktop's real remote and designer interfaces together against
// the protocol fake, so a recipe upload and remote controls share one live boot.
import { BootsStore } from "../core/boots";
import { FakeBoot, FakeTransport } from "../transport/fakeBoot";
import { SharedBootConnections } from "./bootConnections";
import { configureFakeRecipes } from "./fakeRecipes";
import { newLayer } from "../../../designer/src/recipe/spec";
import type { Recipe } from "../../../designer/src/recipe/types";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("uploads through the remote's connection and shows the recipe on the remote afterward", async () => {
  const boot = new FakeBoot();
  configureFakeRecipes(boot);
  const store = new BootsStore(new FakeTransport([boot]), { get: async () => null, set: async () => undefined });
  await store.load();
  store.assign({ deviceId: boot.deviceId, name: boot.name }, "left");
  await vi.advanceTimersByTimeAsync(400);
  const designer = new SharedBootConnections(store, { list: async () => [], free: async () => ({ freed: false }) });
  const recipe: Recipe = { format: "firewalker-recipe", version: 2, name: "ember", description: "", layers: [newLayer("fill")] };

  const uploading = designer.send(boot.deviceId, recipe);
  await vi.advanceTimersByTimeAsync(50);
  store.setBrightness(32);
  await vi.advanceTimersByTimeAsync(2000);
  await uploading;

  expect(designer.getSnapshot().boots[0]).toMatchObject({ failed: false, sending: false, uploads: ["ember"] });
  expect(store.view().tiles).toContainEqual({ id: "ember", runningOn: ["left"], missingOn: [] });
  expect(store.view().brightness).toBe(32);
  await store.client("left")!.disconnect();
});
