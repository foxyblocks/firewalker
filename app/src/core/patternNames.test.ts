import { patternDisplay } from "./patternNames";

describe("patternDisplay", () => {
  it("uses the friendly name and description for a known pattern", () => {
    expect(patternDisplay("fire-trail")).toEqual({ name: "Fire-trail", description: "Stomps launch fire" });
  });

  it("makes a readable name for a pattern this build hasn't heard of", () => {
    expect(patternDisplay("pattern-4")).toEqual({ name: "Pattern 4" });
    expect(patternDisplay("ice_storm")).toEqual({ name: "Ice storm" });
  });
});
