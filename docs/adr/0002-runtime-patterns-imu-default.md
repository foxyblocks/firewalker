# Runtime-switchable light patterns; IMU as the default sensor

The firmware needs to show several visual behaviors — **patterns** (flow,
fire-trail) — in one demo, and the IMU has proven a better stomp sensor than the
FSR. We introduce a runtime **Pattern** abstraction: one firmware (`final_app`)
holds the patterns and switches between them live (the **D6 button cycles
them**), instead of selecting a behavior at compile time. We make the **IMU the
sole sensor** and **retire the FSR** — deleting `fsr_debug`, the `FSR_*` config,
and the FSR core code (`sampleFsr`/`fsrPressed`/`renderFsrIdle`) — because
maintaining two sensor paths isn't worth it once the IMU works.

## Considered options

- **Compile-time pattern per build env** (like the existing modes) — rejected:
  you'd reflash to change pattern, painful for a live demo of multiple patterns.
- **Keep the FSR as a dormant / selectable fallback** — rejected: ongoing
  clutter for a sensor we've decided against; git history preserves it if needed.

## Consequences

- `D6` changes meaning in the app: it **cycles patterns** rather than spawning a
  trail. The manual trail-test trigger survives only in `imu_debug`.
- **Mode** now strictly means a compile-time build (`final_app`, `imu_debug`);
  **Pattern** means a runtime visual behavior. See `CONTEXT.md`.
- `renderIdleBrightness` (factored out of the old `renderFsrIdle`) stays as the
  shared solid-fill helper; the FSR-specific wrapper is removed.
