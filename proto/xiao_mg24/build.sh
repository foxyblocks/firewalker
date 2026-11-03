#!/usr/bin/env bash
#
# Build (and optionally flash) the XIAO MG24 flow prototype.
#
# The XIAO MG24 is a Silicon Labs EFR32MG24 ("gecko" core) — a different
# toolchain from the Feather RP2040 PlatformIO build. It uses arduino-cli + the
# SiliconLabs:silabs core. The sketch reuses the repo's board-agnostic flow,
# fusion, and strip-map sources straight from include/ and src/ via -I include
# paths, so there is no copied code to keep in sync.
#
# One-time setup (already done on this machine; here for reproducibility):
#   brew install arduino-cli
#   arduino-cli config add board_manager.additional_urls \
#       https://siliconlabs.github.io/arduino/package_arduinosilabs_index.json
#   arduino-cli core update-index
#   arduino-cli core install SiliconLabs:silabs
#   arduino-cli lib install "Seeed Arduino LSM6DS3"
#   # NOTE: the real "Adafruit NeoPixel" lib must NOT be installed — it fails to
#   # compile on the gecko core. This sketch ships its own compat shim.
#
# Usage:
#   ./build.sh                 # compile only
#   ./build.sh --upload        # compile, then flash the first detected port
#   ./build.sh --upload PORT   # compile, then flash a specific /dev/cu.* port
set -euo pipefail

SKETCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SKETCH_DIR/../.." && pwd)"

# protocol_stack=none -> plain Arduino (no Matter/BLE), smallest + fastest build.
FQBN="SiliconLabs:silabs:xiao_mg24:protocol_stack=none"

# Reused repo headers/sources resolve through these include dirs; the sketch's
# own dir provides the Adafruit_NeoPixel compat shim. compiler.cpp.extra_flags is
# empty by default in the silabs platform; add include paths and strip settings.
INCLUDES="-I${REPO_ROOT}/include -I${REPO_ROOT}/src -I${SKETCH_DIR} -DFIREWALKER_ADAFRUIT_STRIP_API"

# Spread the ring-based flow demo over the full 160-pixel bench strip. These
# virtual toe/heel positions scale the 40-pixel layout by four, giving two
# 80-step arcs; they are demo coordinates, not measured shoe mounting points.
STRIP_FLAGS="-DFIREWALKER_LED_COUNT=160 -DFIREWALKER_STRIP_TOE_INDEX=52 -DFIREWALKER_STRIP_HEEL_INDEX=132"

echo "Sketch: $SKETCH_DIR"
echo "FQBN:   $FQBN"
arduino-cli compile \
  --fqbn "$FQBN" \
  --build-property "compiler.cpp.extra_flags=${INCLUDES} ${STRIP_FLAGS}" \
  "$SKETCH_DIR"

if [[ "${1:-}" == "--upload" ]]; then
  PORT="${2:-}"
  if [[ -z "$PORT" ]]; then
    PORT="$(ls /dev/cu.usbmodem* 2>/dev/null | head -1 || true)"
  fi
  if [[ -z "$PORT" ]]; then
    echo "No /dev/cu.usbmodem* port found — pass one explicitly." >&2
    exit 1
  fi
  echo "Uploading to $PORT ..."
  arduino-cli upload --fqbn "$FQBN" --port "$PORT" "$SKETCH_DIR"
fi
