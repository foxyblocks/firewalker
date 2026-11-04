# Move to the XIAO MG24 Sense, with a BLE remote and per-controller settings

The firmware moves from the Feather RP2040, external GY-521, and D6 button to one
all-in-one board, the Seeed XIAO MG24 Sense, driving a denser BTF FCOB strip. Bluetooth
comes into scope, which supersedes the earlier guardrail against all wireless features,
because a shoe needs live control and calibration while it's on a foot. Synchronization
between shoes stays out of scope.

Both shoes run one firmware binary. A mounting difference no longer needs a per-foot
build: the controllers mount in the same orientation, and each one captures and stores
its own neutral offset. Settings live in the controller's flash rather than in the
build, and the phone app is optional once a shoe is set up.

## Considered options

- **Keep the Feather and add a BLE module**: rejected. It adds a second board and
  wiring to something meant to fit on a shoe, when the MG24 Sense has the radio and
  motion sensor built in.
- **Build the MG24 through Arduino CLI**: rejected. The prototype did this, and it left
  two toolchains on two core versions. PlatformIO stays the single build path (ADR-0001),
  and native tests and pinned dependencies stay with it.
- **Use Seeed's PlatformIO platform as it is**: not possible for BLE. It always compiles
  the core's Matter variant, whose stack owns Bluetooth, and its compiler can't link the
  core's Bluetooth libraries. `tools/pio/mg24_stack.py` selects the core's other variants
  and pins the Arm compiler those libraries need. It tracks the core's own `boards.txt`,
  so a core upgrade has to re-check it.
- **Per-feature GATT characteristics** (the first proposal for the app): rejected in favor
  of one line protocol over the Nordic UART Service UUIDs. USB and BLE share one parser
  that native tests cover, generic BLE terminals can debug it, and adding a command doesn't
  change the GATT layout. See [`docs/remote-protocol.md`](../remote-protocol.md).

- **The Adafruit NeoPixel library**: not possible. It doesn't compile on this core ("Architecture
  not supported"). The core's own `ezWS2812gpio` derives its timing from `getCPUClock()`, which
  misreports on this board and leaves the strip dark.
- **CPU-timed strip pulses** (the prototype's driver): rejected once BLE was in the build.
  Measured in the firmware, about one zero pulse in 3000 stretched, some as long as a one,
  even with interrupts off, which lit stray pixels. The same driver was clean with no radio.
  The driver now sends each frame through SPI and DMA, so hardware sets every edge and
  interrupts stay on.

## Consequences

- Tilt is calibrated per boot from up to three held poses, because a worn boot's real range
  differs by foot and by side. This replaces a fixed 30 degrees each way, which now only
  applies to a side with no captured pose.
- D10 has to stay the SPI data pin, and D8 and D9 are claimed along with it.
- USB stays a full control and log channel: the MG24's USB port carries the sketch's
  `Serial` in both directions, through the onboard debug chip. Bench work and motion logs
  need neither the phone nor a UART adapter.
- The Feather hardware, its wiring guides, and left/right builds are retired. Earlier
  ADRs describe that hardware as history: ADR-0002's D6 button and FSR retirement, and
  ADR-0001's Feather environments, no longer describe current setup.
- The firmware has no physical control, so a shoe without a phone or USB cable stays on
  whatever it last saved.
- BLE has no pairing, so anyone nearby can connect and change a shoe's settings. That's an
  accepted risk for shoes, and it would need revisiting before anything sensitive sits
  behind this service.
