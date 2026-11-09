import { failureMessage } from "./calibration";

describe("failureMessage", () => {
  it("explains each firmware reason in plain words", () => {
    expect(failureMessage("motion")).toBe("It kept moving too much to find one pose. Settle into it and try again.");
    expect(failureMessage("too-close")).toBe("That's too close to neutral. Tilt further and try again.");
  });

  it("still says something useful for a reason this build doesn't know", () => {
    expect(failureMessage("something-new")).toBe("That didn't work (something-new). Try again.");
  });
});
