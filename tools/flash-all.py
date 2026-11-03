#!/usr/bin/env python3
"""Flash every connected Firewalker boot with its correct firmware.

Each boot is identified by its USB serial number — stable per board, unlike the
/dev/cu.usbmodem* port name, which floats with the USB location. We map each
known serial to a PlatformIO env (the foot-specific app build) and, for every
connected board we recognize, flash that env to the board's current port.

Add a new boot by plugging it in, running this script once to read the serial it
prints under "unknown boots", and adding a `serial: env` line to BOOTS below.

Usage:
    tools/flash-all.py            # flash all known connected boots
    tools/flash-all.py --list     # just list what's connected, flash nothing
"""
import json
import subprocess
import sys

# USB serial number -> PlatformIO env. The serials are each RP2040's flash-chip
# unique ID (see `pio device list --json-output`, the SER= field of hwid).
BOOTS = {
    "DF6548405F4A4628": "final_app_left",
    "DF6548405F5A4828": "final_app_right",
}

# Feather RP2040 USB VID:PID, used only to label other boards in --list output.
FEATHER_VID_PID = "239A:80F1"


def connected_boards():
    """Return [(port, serial, hwid), ...] for ports that expose a USB serial."""
    out = subprocess.run(
        ["pio", "device", "list", "--json-output"],
        capture_output=True, text=True, check=True,
    ).stdout
    boards = []
    for dev in json.loads(out):
        hwid = dev.get("hwid", "") or ""
        serial = next(
            (tok[4:] for tok in hwid.split() if tok.startswith("SER=")), None
        )
        if serial:
            boards.append((dev["port"], serial, hwid))
    return boards


def flash(env, port):
    """Flash one env to one port; return True on success."""
    print(f"\n=== {env}  ->  {port} ===", flush=True)
    return subprocess.run(
        ["pio", "run", "-e", env, "-t", "upload", "--upload-port", port]
    ).returncode == 0


def main():
    list_only = "--list" in sys.argv[1:]
    boards = connected_boards()

    known = [(p, s) for p, s, _ in boards if s in BOOTS]
    unknown = [(p, s) for p, s, _ in boards if s not in BOOTS]

    print(f"Connected serial boards: {len(boards)}  "
          f"(known {len(known)}, unknown {len(unknown)})")
    for port, serial in known:
        print(f"  known    {serial}  {BOOTS[serial]:16s} {port}")
    for port, serial in unknown:
        print(f"  unknown  {serial}  {'?':16s} {port}  "
              f"(add to BOOTS to flash)")

    if list_only:
        return 0
    if not known:
        print("\nNo known Firewalker boots connected — nothing to flash.")
        return 1

    # Flash one at a time: each boot resets only its own --upload-port into
    # BOOTSEL, so picotool can't grab the wrong board.
    failures = []
    for port, serial in known:
        if not flash(BOOTS[serial], port):
            failures.append((BOOTS[serial], port))

    print()
    if failures:
        for env, port in failures:
            print(f"FAILED: {env} -> {port}")
        return 1
    print(f"Flashed {len(known)} boot(s) successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
