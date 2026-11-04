import { calibrationSteps, failureMessage } from "./calibration";

describe("calibrationSteps", () => {
  const allSupported = () => true;

  it("walks one boot through neutral, heel, and toe", () => {
    expect(calibrationSteps(["left"], allSupported)).toEqual([
      { pose: "neutral", sides: ["left"] },
      { pose: "heel", sides: ["left"] },
      { pose: "toe", sides: ["left"] },
    ]);
  });

  it("takes neutral together on Both, then heel and toe one boot at a time", () => {
    expect(calibrationSteps(["left", "right"], allSupported)).toEqual([
      { pose: "neutral", sides: ["left", "right"] },
      { pose: "heel", sides: ["left"] },
      { pose: "toe", sides: ["left"] },
      { pose: "heel", sides: ["right"] },
      { pose: "toe", sides: ["right"] },
    ]);
  });

  it("offers only neutral on firmware without heel and toe", () => {
    expect(calibrationSteps(["left", "right"], () => false)).toEqual([
      { pose: "neutral", sides: ["left", "right"] },
    ]);
  });

  it("skips heel and toe only for the boot that can't do them", () => {
    expect(calibrationSteps(["left", "right"], (side) => side === "right")).toEqual([
      { pose: "neutral", sides: ["left", "right"] },
      { pose: "heel", sides: ["right"] },
      { pose: "toe", sides: ["right"] },
    ]);
  });
});

describe("failureMessage", () => {
  it("explains each firmware reason in plain words", () => {
    expect(failureMessage("motion")).toBe("It kept moving too much to find one pose. Settle into it and try again.");
    expect(failureMessage("too-close")).toBe("That's too close to neutral. Tilt further and try again.");
  });

  it("still says something useful for a reason this build doesn't know", () => {
    expect(failureMessage("something-new")).toBe("That didn't work (something-new). Try again.");
  });
});
