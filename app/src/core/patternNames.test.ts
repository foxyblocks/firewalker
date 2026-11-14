import { patternDisplay } from "./patternNames";

describe("patternDisplay", () => {
  it("uses the friendly name and description for a known pattern", () => {
    expect(patternDisplay("fire-stomp")).toEqual({ name: "Fire stomp", description: "Stomps launch fire" });
  });

  it("makes a readable name for a pattern this build hasn't heard of", () => {
    expect(patternDisplay("pattern-4")).toEqual({ name: "Pattern 4" });
    expect(patternDisplay("ice_storm")).toEqual({ name: "Ice storm" });
  });

  it("uses main's description for a pattern with no shorter one here", () => {
    expect(patternDisplay("lava-pour", "Lava pours downhill.")).toEqual({ name: "Lava pour", description: "Lava pours downhill." });
    expect(patternDisplay("fire-stomp", "A long catalog sentence.")).toEqual({ name: "Fire stomp", description: "Stomps launch fire" });
  });
});
