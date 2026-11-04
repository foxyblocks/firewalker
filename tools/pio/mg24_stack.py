"""PlatformIO build step for the XIAO MG24: radio stack, compiler, and safe uploads.

Loaded by platformio.ini (`extra_scripts = pre:tools/pio/mg24_stack.py`) for every
MG24 environment. It sits on top of Seeed's platform and changes three things:

1. Stack selection. Seeed's platform always compiles the Silicon Labs core's
   Matter variant, which owns the Bluetooth stack, so firmware can't add its own
   BLE service. The core ships other variants, the ones arduino-cli offers as
   `protocol_stack`. This script replaces Seeed's framework step with one that
   builds the variant named by `custom_mg24_stack` in platformio.ini:
     * `none`       no radio. Used by the bench and diagnostic builds.
     * `ble_silabs` Silicon Labs Bluetooth (`sl_bt_*`). Used by the app.
   Its flags and libraries come from the core's boards.txt and platform.txt for
   the `xiao_mg24` board, so compare against those when bumping the core.

2. Compiler. Silicon Labs ships its Bluetooth libraries as link-time-optimization
   objects built by Arm GNU 12.2.rel1. Only a compiler without zstd support can read
   them, and the platform's xPack 12.3.1 has it, so linking fails with "original not
   compressed with zstd". Arm's archive isn't a PlatformIO package, so this script
   downloads it once into the PlatformIO core folder and checks it against Arm's
   published SHA-256.

3. Upload targeting. OpenOCD otherwise programs the first debug probe it finds,
   which could be the wrong shoe when both are plugged in. Uploads now resolve one
   board by USB serial and refuse to guess. `--upload-port` accepts a serial
   number or a `/dev/cu.usbmodem...` path.
"""

import hashlib
import os
import platform as host
import shutil
import subprocess
import sys
import tempfile
from os.path import isdir, isfile, join

Import("env")

MG24_USB_VID = 0x2886
MG24_USB_PID = 0x0062

STACKS = {
    "none": {
        "dir": "noradio",
        "defines": ["ARDUINO_SILABS_STACK_NONE"],
        "libs": [],
        "link_flags": [],
    },
    "ble_silabs": {
        "dir": "ble_silabs",
        "defines": [
            "ARDUINO_SILABS_STACK_BLE_SILABS",
            ("SL_RAIL_LIB_MULTIPROTOCOL_SUPPORT", 0),
            ("SL_RAIL_UTIL_PA_CONFIG_HEADER", '\\"sl_rail_util_pa_config.h\\"'),
            ("SLI_RADIOAES_REQUIRES_MASKING", 1),
        ],
        # Link order follows the core's precompiled_libs list for this variant.
        "libs": [
            "libbgapi_core.a",
            "libbgcommon.a",
            "libble_bgapi_gatt_client.a",
            "libble_bgapi_gatt_server.a",
            "libble_bgapi.a",
            "libble_host_accept_list_stub.a",
            "libble_host_hal_series2.a",
            "libble_host_hci.a",
            "libble_host.a",
            "libble_system.a",
            "libbondingdb.a",
            "liblinklayer.a",
            "librail_efr32xg24_gcc_release.a",
        ],
        "link_flags": ["-flto=auto"],
    },
}


TOOLCHAIN_VERSION = "12.2.rel1"
TOOLCHAIN_URL = (
    "https://developer.arm.com/-/media/Files/downloads/gnu/12.2.rel1/binrel/"
    "arm-gnu-toolchain-12.2.rel1-%s-arm-none-eabi.tar.xz"
)
# Arm's name for each host, with the SHA-256 it publishes for that download.
TOOLCHAIN_HOSTS = {
    ("Darwin", "arm64"): (
        "darwin-arm64",
        "21a9e875250bcb0db8df4cb23dd43c94c00a1d3b98ecba9cdd6ed51586b12248",
    ),
    ("Darwin", "x86_64"): (
        "darwin-x86_64",
        "00c0eeb57ae92332f216151ac66df6ba17d2d3b306dac86f4006006f437b2902",
    ),
    ("Linux", "x86_64"): (
        "x86_64",
        "84be93d0f9e96a15addd490b6e237f588c641c8afdf90e7610a628007fc96867",
    ),
    ("Linux", "aarch64"): (
        "aarch64",
        "7ee332f7558a984e239e768a13aed86c6c3ac85c90b91d27f4ed38d7ec6b3e8c",
    ),
}


def ensure_toolchain(env):
    """Return the compiler's bin folder, installing it on first use."""
    key = (host.system(), host.machine())
    if key not in TOOLCHAIN_HOSTS:
        sys.stderr.write("mg24: no Arm toolchain listed for %s %s\n" % key)
        env.Exit(1)
    arm_host, expected_sha256 = TOOLCHAIN_HOSTS[key]

    install_dir = join(env.subst("$PROJECT_CORE_DIR"), "firewalker", "arm-gnu-" + TOOLCHAIN_VERSION)
    bin_dir = join(install_dir, "bin")
    if isfile(join(bin_dir, "arm-none-eabi-gcc")):
        return bin_dir

    url = TOOLCHAIN_URL % arm_host
    print("mg24: downloading Arm GNU %s (about 200 MB, first build only)" % TOOLCHAIN_VERSION)
    with tempfile.TemporaryDirectory() as scratch:
        archive = join(scratch, "toolchain.tar.xz")
        subprocess.check_call(["curl", "-fL", "--progress-bar", "-o", archive, url])

        digest = hashlib.sha256()
        with open(archive, "rb") as stream:
            for block in iter(lambda: stream.read(1 << 20), b""):
                digest.update(block)
        if digest.hexdigest() != expected_sha256:
            sys.stderr.write("mg24: the toolchain download failed its checksum\n")
            env.Exit(1)

        # Unpack beside the destination and rename, so an interrupted build can't
        # leave a half-installed compiler that looks finished.
        os.makedirs(os.path.dirname(install_dir), exist_ok=True)
        unpack_dir = tempfile.mkdtemp(dir=os.path.dirname(install_dir))
        try:
            subprocess.check_call(
                ["tar", "-xf", archive, "-C", unpack_dir, "--strip-components=1"]
            )
            os.rename(unpack_dir, install_dir)
        except Exception:
            shutil.rmtree(unpack_dir, ignore_errors=True)
            raise
    return bin_dir


def use_toolchain(env, bin_dir):
    """Point the build at the pinned compiler in place of the platform's default."""
    tool = lambda name: join(bin_dir, "arm-none-eabi-" + name)
    env.Replace(
        AR=tool("ar"),
        AS=tool("as"),
        CC=tool("gcc"),
        CXX=tool("g++"),
        GDB=tool("gdb"),
        OBJCOPY=tool("objcopy"),
        RANLIB=tool("ranlib"),
        SIZETOOL=tool("size"),
    )


def build_framework(env, frameworks):
    """Compile the Silicon Labs core and set up the selected stack's link line.

    Replaces PlatformIO's `BuildFrameworks`, which would otherwise run Seeed's
    Matter-only script.
    """
    use_toolchain(env, ensure_toolchain(env))

    stack_name = env.GetProjectOption("custom_mg24_stack", "none")
    if stack_name not in STACKS:
        sys.stderr.write(
            "custom_mg24_stack must be one of: %s\n" % ", ".join(sorted(STACKS))
        )
        env.Exit(1)
    stack = STACKS[stack_name]

    platform = env.PioPlatform()
    framework_dir = platform.get_package_dir("framework-arduino-silabs")
    assert isdir(framework_dir)
    core_dir = join(framework_dir, "cores", "gecko")
    variant_dir = join(framework_dir, "variants", "xiao_mg24")
    stack_dir = join(variant_dir, stack["dir"])
    noradio_dir = join(variant_dir, "noradio")

    fpu_flags = ["-mthumb", "-mcpu=cortex-m33", "-mfpu=fpv5-sp-d16", "-mfloat-abi=hard"]

    env.Append(
        ASFLAGS=fpu_flags,
        ASPPFLAGS=["-x", "assembler-with-cpp", "-imacros", "sl_gcc_preinclude.h"],
        CFLAGS=["-std=c18"],
        CXXFLAGS=["-std=gnu++17", "-fno-exceptions"],
        CCFLAGS=fpu_flags
        + [
            "-g",
            "-Os",
            "-w",
            "-fdata-sections",
            "-ffunction-sections",
            "-fomit-frame-pointer",
            "-imacros",
            "sl_gcc_preinclude.h",
            "-mcmse",
            "--specs=nano.specs",
        ],
        CPPDEFINES=[
            ("F_CPU", "39000000"),
            ("ARDUINO", 10607),
            ("ARDUINO_SILABS", '\\"3.0.0\\"'),
            "ARDUINO_BOARD_XIAO_MG24",
            "ARDUINO_ARCH_SILABS",
            "ARDUINO_SILABS_GECKO",
            "ARDUINO_XIAO_MG24",
            ("NUM_LEDS", 1),
            ("NUM_HW_SERIAL", 2),
            ("NUM_HW_SPI", 2),
            ("NUM_HW_I2C", 2),
            ("NUM_DAC_HW", 2),
            ("ARDUINO_MAIN_TASK_STACK_SIZE", 2048),
            "ARDUINO_SILABS_AIML_CAPABLE",
            ("EFR32MG24B220F1536IM48", 1),
            ("SL_APP_PROPERTIES", 1),
            ("HARDWARE_BOARD_DEFAULT_RF_BAND_2400", 1),
            ("HARDWARE_BOARD_SUPPORTS_1_RF_BAND", 1),
            ("HARDWARE_BOARD_SUPPORTS_RF_BAND_2400", 1),
            ("HFXO_FREQ", 39000000),
            ("SL_BOARD_NAME", '\\"BRD4187C\\"'),
            ("SL_BOARD_REV", '\\"A01\\"'),
            ("configNUM_SDK_THREAD_LOCAL_STORAGE_POINTERS", 2),
            ("SL_COMPONENT_CATALOG_PRESENT", 1),
            ("MBEDTLS_CONFIG_FILE", '\\"sl_mbedtls_config.h\\"'),
            ("MBEDTLS_PSA_CRYPTO_CONFIG_FILE", '\\"psa_crypto_config.h\\"'),
            ("TF_LITE_STATIC_MEMORY", 1),
        ]
        + stack["defines"],
        CPPPATH=[
            core_dir,
            join(core_dir, "api", "deprecated"),
            variant_dir,
            join(stack_dir, "include"),
        ],
        LINKFLAGS=fpu_flags
        + [
            "--specs=nano.specs",
            '-Wl,-Map="%s"' % join("${BUILD_DIR}", "${PROGNAME}.map"),
            "-Wl,--gc-sections",
            "-Wl,--no-warn-rwx-segments",
            "-Wl,--wrap=_malloc_r",
            "-Wl,--wrap=_free_r",
            "-Wl,--wrap=_calloc_r",
            "-Wl,--wrap=_realloc_r",
        ]
        + stack["link_flags"],
        LIBSOURCE_DIRS=[join(framework_dir, "libraries")],
    )
    env.Replace(LDSCRIPT_PATH=join(stack_dir, "linkerfile.ld"))

    # Compile only the variant's top-level sources: the stack folders below it
    # hold prebuilt archives and headers.
    env.Prepend(
        LIBS=[
            env.BuildLibrary(
                join("$BUILD_DIR", "FrameworkArduinoVariant"),
                variant_dir,
                src_filter="+<*.cpp> +<*.c>",
            ),
            env.BuildLibrary(join("$BUILD_DIR", "FrameworkArduino"), core_dir),
        ]
    )

    # The core needs its own objects and the stack's gsdk.a linked in full,
    # because they resolve weak symbols such as sl_bt_on_event. The remaining
    # archives are ordinary libraries, searched as a group after them.
    archives = [join(stack_dir, name) for name in stack["libs"]] + [
        join(noradio_dir, "libcmsis-nn.a"),
        join(noradio_dir, "libtflm.a"),
    ]
    env.Prepend(_LIBFLAGS="-Wl,--whole-archive ")
    env.Append(
        _LIBFLAGS=" %s -Wl,--no-whole-archive -lstdc++ -lgcc -lc -lm -lnosys -lsupc++ %s"
        % (join(stack_dir, "gsdk.a"), " ".join(archives))
    )


def connected_boards():
    """Return (port path, USB serial) for every connected XIAO MG24 debug probe."""
    from serial.tools import list_ports

    return [
        (port.device, port.serial_number)
        for port in list_ports.comports()
        if port.vid == MG24_USB_VID
        and port.pid == MG24_USB_PID
        and port.serial_number
    ]


def resolve_probe_serial(requested, boards):
    """Pick the one board an upload may touch, or explain why it can't choose."""
    if requested:
        matches = [
            board
            for board in boards
            if requested in (board[0], board[1])
        ]
        if not matches:
            found = ", ".join("%s (%s)" % board for board in boards) or "none"
            raise ValueError("no MG24 matches %r. Connected: %s" % (requested, found))
        return matches[0][1]
    if not boards:
        raise ValueError("no MG24 found. Connect one over USB.")
    if len(boards) > 1:
        found = ", ".join("%s (%s)" % board for board in boards)
        raise ValueError(
            "found %d MG24 boards: %s. Pick one with --upload-port <serial>."
            % (len(boards), found)
        )
    return boards[0][1]


def select_upload_probe(target, source, env):
    """Point OpenOCD at exactly one debug probe just before it programs the flash."""
    # Project-level `upload_port` and the --upload-port flag both land here.
    requested = env.subst("$UPLOAD_PORT")
    try:
        serial = resolve_probe_serial(requested, connected_boards())
    except ValueError as error:
        sys.stderr.write("mg24 upload: %s\n" % error)
        env.Exit(1)
    print("mg24 upload: targeting probe %s" % serial)
    env.Prepend(UPLOADERFLAGS=["-c", "adapter serial %s" % serial])


env.AddMethod(build_framework, "BuildFrameworks")
env.AddPreAction("upload", select_upload_probe)
