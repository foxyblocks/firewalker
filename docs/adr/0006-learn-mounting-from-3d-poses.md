# Learn each boot's mounting from three-dimensional held poses

Controllers attach to boot cloth at arbitrary angles. The app captures gravity vectors
for neutral, heel, and toe, and uses those poses to learn the boot's fore-aft plane in
chip coordinates. All three gyro axes track gravity between accelerometer corrections;
only the final projection becomes a single tilt input for patterns. This replaces the
fixed X/Z accelerometer plane and Y gyro assumption in ADR-0004.

Neutral alone cannot identify the foot's direction. At least one side pose is required;
the other side keeps a default range. Capturing neutral again resets both side poses,
because they describe the previous mounting reference. A remount needs new poses.

The saved settings format stores the 3D vectors atomically with the other settings.
Older scalar angles cannot recover them: upgrading preserves pattern, brightness, strip,
and audio settings but requires pose recapture. We use a gravity vector rather than a
full heading estimate because visual effects need fore-aft tilt, not compass heading.
The physical basis is the rotated gravity measurement described in
[NXP's tilt-sensing application note](https://www.nxp.com/docs/en/application-note/AN3461.pdf).
