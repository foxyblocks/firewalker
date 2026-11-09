import { STRIP_PIXELS } from "./PixelSlider";

/**
 * Live tilt as a strip: light pools from the center toward whichever end is down, which
 * is roughly what the flow pattern does on the boot itself.
 */
export function TiltStrip({ tilt }: { tilt: number }) {
  const center = (STRIP_PIXELS - 1) / 2;
  const reach = tilt * center;
  return (
    <div className="strip strip-tilt" role="img" aria-label={`Tilt ${tilt.toFixed(2)}`}>
      {Array.from({ length: STRIP_PIXELS }, (_, index) => {
        const offset = index - center;
        const inPool = Math.abs(offset) < 1 || (Math.sign(offset) === Math.sign(reach) && Math.abs(offset) <= Math.abs(reach));
        return <span key={index} className={`pixel${inPool ? " pixel-lit" : ""}`} />;
      })}
    </div>
  );
}
