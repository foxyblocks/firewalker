import { dragTo, nudge, shownStrip, sliderRange, type StripValues } from "./stripSetup";
import type { BootState } from "./boot";
import type { StatusReply } from "./protocol";

const VALUES: StripValues = { leds: 110, maxLeds: 160, toe: 40, heel: 90 };

const reporting = (status: Partial<StatusReply>, pending: BootState["pending"] = {}): BootState =>
  ({ link: "online", patterns: [], pending, motionHistory: [], audioHistory: [], status: { t: "status", proto: 2, ...status } }) as BootState;

describe("shownStrip", () => {
  it("is what the boot reports", () => {
    const state = reporting({ leds: 110, maxLeds: 160, toe: 40, heel: 90 });
    expect(shownStrip(state)).toEqual(VALUES);
  });

  it("prefers a value still on its way to the boot", () => {
    const state = reporting({ leds: 110, maxLeds: 160, toe: 40, heel: 90 }, { leds: 120, toe: 41 });
    expect(shownStrip(state)).toEqual({ leds: 120, maxLeds: 160, toe: 41, heel: 90 });
  });

  it("has nothing to show for a boot too old to have a layout", () => {
    expect(shownStrip(reporting({ proto: 1 }))).toBeUndefined();
  });

  it("has nothing to show before a boot's first report", () => {
    expect(shownStrip({ link: "connecting", patterns: [], pending: {}, motionHistory: [], audioHistory: [] })).toBeUndefined();
  });
});

describe("sliderRange", () => {
  it("runs the count from the smallest ring up to what the boot can drive", () => {
    expect(sliderRange("leds", VALUES)).toEqual({ min: 2, max: 160 });
  });

  it("runs toe and heel across the pixels in the ring", () => {
    expect(sliderRange("toe", VALUES)).toEqual({ min: 0, max: 109 });
    expect(sliderRange("heel", VALUES)).toEqual({ min: 0, max: 109 });
  });
});

describe("dragTo", () => {
  it("lands where the finger is", () => {
    expect(dragTo("leds", 125, VALUES)).toBe(125);
    expect(dragTo("toe", 12, VALUES)).toBe(12);
    expect(dragTo("heel", 100, VALUES)).toBe(100);
  });

  it("stays inside the slider's range", () => {
    expect(dragTo("leds", 500, VALUES)).toBe(160);
    expect(dragTo("leds", 0, VALUES)).toBe(2);
    expect(dragTo("toe", 200, VALUES)).toBe(109);
  });

  it("keeps toe and heel off each other's pixel by staying put", () => {
    expect(dragTo("toe", 90, VALUES)).toBe(40);
    expect(dragTo("heel", 40, VALUES)).toBe(90);
  });

  it("lets toe pass the heel, for a strip wound the other way", () => {
    expect(dragTo("toe", 91, VALUES)).toBe(91);
  });
});

describe("nudge", () => {
  it("moves one pixel", () => {
    expect(nudge("leds", 1, VALUES)).toBe(111);
    expect(nudge("toe", -1, VALUES)).toBe(39);
    expect(nudge("heel", 1, VALUES)).toBe(91);
  });

  it("stops at the ends", () => {
    expect(nudge("leds", 1, { ...VALUES, leds: 160 })).toBe(160);
    expect(nudge("leds", -1, { ...VALUES, leds: 2, toe: 0, heel: 1 })).toBe(2);
    expect(nudge("toe", -1, { ...VALUES, toe: 0 })).toBe(0);
    expect(nudge("heel", 1, { ...VALUES, heel: 109 })).toBe(109);
  });

  it("hops over the other marker", () => {
    expect(nudge("toe", 1, { ...VALUES, toe: 89 })).toBe(91);
    expect(nudge("heel", -1, { ...VALUES, heel: 41 })).toBe(39);
  });

  it("stays put when the only pixel past the other marker doesn't exist", () => {
    expect(nudge("toe", 1, { ...VALUES, toe: 108, heel: 109 })).toBe(108);
    expect(nudge("heel", -1, { ...VALUES, toe: 0, heel: 1 })).toBe(1);
  });
});
