# Wiring — FeatherWing Proto carrier board (FOX-183)

Soldering/placement plan for moving the bench rig onto an **Adafruit FeatherWing
Proto** that carries the GY-521 IMU, the D6 button, and a JST pigtail for the
LED strip. The *electrical* nets are unchanged from
[`wiring.md`](wiring.md) + [`wiring-mpu6050.md`](wiring-mpu6050.md) — this doc
is about physical layout: which face, which orientation, which direction the
wires leave.

See the rendered placement diagram in
[`wiring-protoboard.html`](wiring-protoboard.html).

## Decisions (FOX-183)

- **Mounted on the inner ankle of both shoes.** The two assemblies are
  **identical hardware builds** — left vs right is handled in firmware (the
  foot-side build flag flips the chirality-sensitive IMU signs; see
  `platformio.ini` envs `final_app_left` / `final_app_right`), not by
  mirroring the hardware.
- **The strip's DIN end starts directly under the assembly** (pixel 0 at the
  inner ankle), so the JST pigtail's run to the strip is short. The strip is a
  40-pixel ring around the foot — toe at 13, heel at 33 (see CONTEXT.md
  "Strip").
- **Stack-up:** the protoboard sits **beneath** the Feather. The Feather
  already has male pin headers on its underside; the wing gets **female
  stacking sockets on its top face** that the Feather plugs into.
- **The assembly is mounted flipped:** the wing's underside becomes the
  outward, visible face. The Feather faces the leg.
- **Components on the outward face:** the GY-521 and the D6 button are
  soldered to the wing's underside so they're exposed (button pressable, IMU
  clear of the header-height gap under the Feather).
- **Orientation on the leg:** the Feather's **USB port points up the leg**.
  The **JST pigtail for the strip exits the opposite (down) edge**, toward the
  shoe.
- **No data-line resistor, no level shifter.** Direct 3.3 V data into the
  5 V strip is confirmed working on this rig; keeping the bench wiring as-is.
- **Per-foot sign confirmation is required after assembly.** The axis
  assignments in `include/config.h` match the bench-confirmed USB-up
  orientation, but the chirality-sensitive signs flip between feet
  (`IMU_MOUNT_FOOT_SIGN`), and which physical foot gets which sign is a
  geometry-derived hypothesis until the `imu_debug` pass on each shoe. No code
  changes needed beyond the config constants and the mount comment.

## Mirror warning (read before soldering)

The layout view that matters is the **exposed face** — the wing's underside,
the face you look at when the shoe is assembled. Viewed from that face with
the USB end up, the Feather's header rows are **mirrored** relative to the
usual top-view pinout diagrams:

- **12-pin row** (BAT, EN, USB, D13 … D6, D5, SCL, SDA) appears on the **left**
- **16-pin row** (RST, 3V3, 3V3, GND, A0 … TX, D4) appears on the **right**

Both rows end flush at the down-leg end; the 12-pin row starts ~0.4" lower
than the 16-pin row at the USB end. The wing's bused **3V3 / GND strips** and
inner duplicated rows also mirror. **Confirm every hole against the wing's
silkscreen and a continuity check before soldering** — don't trust
left/right from any diagram, including this one.

## Placement (exposed face, USB end up)

| Item | Zone | Notes |
|---|---|---|
| Female stacking sockets | Both outer header rows, wing **top** face | Soldered from the exposed face. Feather plugs in component-side toward the leg. |
| GY-521 | Lower half of the proto grid | Pin row toward the 12-pin (SDA/SCL) side for short I2C jumpers. Mount on ~2–3 mm pin stubs so the body clears the socket solder fillets; component side outward. **Record the silk X/Y arrow direction relative to "up the leg"** — the recalibration pass needs it. |
| D6 button | Upper-middle proto grid | Momentary, through-hole. One leg → D6, other → GND (internal pull-up, no resistor). Pressable from outside once mounted. |
| JST pigtail (strip) | Down-leg edge | 3 wires: 5 V, GND, data. Lace through two free grid holes before soldering (strain relief), then add epoxy/hot-glue over the joints — this pigtail is the highest mechanical-stress point on the build. |
| AD0 jumper | At the GY-521 | AD0 → GND keeps the address at `0x68` (`IMU_I2C_ADDR`). |

## Netlist (unchanged from existing wiring docs)

| Net | Feather pin | To | Notes |
|---|---|---|---|
| IMU power | **3V3** | GY-521 VCC | 3V3, *not* USB/5 V — keeps I2C pull-ups at logic level |
| IMU ground | **GND** | GY-521 GND | wing GND strip is convenient if continuity-confirmed |
| I2C clock | **SCL** (GP3) | GY-521 SCL | bottom of the 12-pin row — short jumper |
| I2C data | **SDA** (GP2) | GY-521 SDA | bottom of the 12-pin row — short jumper |
| I2C address | **GND** | GY-521 AD0 | low → `0x68` |
| Strip 5 V | **USB** (VBUS) | JST red | runs nearly the full board length (USB pin is at the up-leg end); use real hookup wire, ~600 mA worst case |
| Strip ground | **GND** | JST black | common ground with Feather + IMU |
| Strip data | **D5** (GP7) | JST data | direct, no series resistor (decision above) |
| Button | **D6** (GP8) + GND | momentary button | `INPUT_PULLUP` |
| Unused | — | GY-521 INT, XDA, XCL | leave disconnected |

## Assembly order

1. Solder the female stacking sockets into the wing's outer header rows (top
   face, soldered from the exposed face).
2. Test-fit the Feather. Mark the USB end on the exposed face with a sharpie —
   this is "up the leg" from here on.
3. Solder the D6 button and its two jumpers (D6, GND).
4. Mount the GY-521 on short pin stubs, component side out; note the silk axis
   arrows vs. the USB-end mark. Wire VCC/GND/SCL/SDA and the AD0→GND jumper.
5. Lace the JST pigtail through strain-relief holes at the down-leg edge;
   solder 5 V (from USB pin), GND, data (from D5). Strain-relieve.
6. **Before plugging the Feather in:** continuity-check every net; verify no
   shorts between 5 V, 3V3, and GND.
7. Plug in the Feather, flash `imu_debug`, and run the bench-calibration
   checklist in [`open-questions.md`](open-questions.md): re-derive the
   `IMU_MOUNT_*` axis map and signs for the new orientation, update the mount
   comment in `include/config.h`, re-check stomp thresholds.

## What this does *not* change

- Strip power still comes from USB/VBUS — the final wearable power source is
  still the top open question (`open-questions.md`); revisit JST wire gauge if
  that answer changes the current ceiling.
- The Feather's BOOTSEL/reset face the leg once mounted. Normal `pio` uploads
  reset over USB, but recovery flashing means unstrapping the assembly.
- The onboard NeoPixel is hidden against the leg — harmless, it's a status
  light.
