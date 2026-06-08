# Orientation from accelerometer + gyroscope fusion, not the gyro alone

The **flow** pattern needs the shoe's tilt ("which side dips down"). Static
orientation relative to gravity is fundamentally an **accelerometer**
measurement; the **gyroscope** measures angular *rate* and, integrated on its
own, drifts within seconds and has no absolute "down." We estimate tilt with a
**complementary filter** that fuses the two — the accelerometer anchors the
absolute angle (low-frequency), the gyroscope smooths fast motion
(high-frequency).

This is recorded because the original feature request said "when the gyroscope
tilts," which reads as gyro-only; the physics says otherwise, and we don't want
that re-litigated.

## Considered options

- **Gyro only** (as first described) — rejected: drifts, no absolute reference,
  can't answer "which side is low" at rest.
- **Accelerometer only** — viable and simpler, but jittery under foot impact and
  vibration; the gyro term smooths it. Acceptable fallback if fusion proves
  unnecessary in practice.
