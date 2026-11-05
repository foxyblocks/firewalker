"""PlatformIO build step for the native tests: turns on memory and undefined-behavior checks.

`build_flags` only reaches the compiler, and these also have to be given to the linker.
"""

Import("env")

SANITIZE = ["-fsanitize=address,undefined", "-fno-sanitize-recover=undefined", "-fno-omit-frame-pointer", "-g"]

env.Append(CCFLAGS=SANITIZE, LINKFLAGS=SANITIZE)
