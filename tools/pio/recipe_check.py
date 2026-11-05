"""PlatformIO build step: stops a firmware build whose built-in recipes are out of date.

The firmware builds from include/generated/recipe_builtins.h, so it doesn't need Bun. That header
carries a hash of patterns/built-ins.txt and the recipes it lists. This recomputes the hash, and if
they differ, the build stops and says how to fix it, so old built-ins can't be flashed by accident.
designer/server/builtins.ts works out the same hash when it writes the header.
"""

import hashlib
import os
import re
import sys

Import("env")

project = env["PROJECT_DIR"]
patterns = os.path.join(project, "patterns")
header = os.path.join(project, "include", "generated", "recipe_builtins.h")
FIX = "Run `bun run build-recipes` in designer/."


def fail(reason):
    sys.stderr.write("\nError: %s %s\n\n" % (reason, FIX))
    env.Exit(1)


def read(path):
    with open(path, "rb") as file:
        return file.read()


if not os.path.exists(header):
    fail("include/generated/recipe_builtins.h is missing.")

list_bytes = read(os.path.join(patterns, "built-ins.txt"))
digest = hashlib.sha256(list_bytes)
for line in list_bytes.decode("utf8").split("\n"):
    name = line.strip()
    if not name or name.startswith("#"):
        continue
    recipe = os.path.join(patterns, name + ".json")
    if not os.path.exists(recipe):
        fail("patterns/built-ins.txt lists %s, but there's no %s.json." % (name, name))
    digest.update(read(recipe))

match = re.search(r"source-hash: ([0-9a-f]{64})", read(header).decode("utf8"))
if not match or match.group(1) != digest.hexdigest():
    fail("The built-in recipes changed, so include/generated/recipe_builtins.h is out of date.")
