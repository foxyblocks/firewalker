#pragma once

// Reads and writes this controller's settings in its own flash, using the Silicon
// Labs NVM3 key-value store. NVM3 handles wear leveling and writes each record as
// one atomic object, so a power cut during a save leaves the previous record intact.
// What's stored, and how it's validated, is in firewalker_settings.h.

#include "firewalker_settings.h"

namespace Firewalker {

// Loads saved settings into `out`, which holds the defaults on entry. Anything
// absent, damaged, unsupported, or out of bounds leaves `out` untouched. Returns a
// short reason for the log, such as "loaded" or "absent".
const char* loadSettings(const SettingsBounds& bounds, Settings& out);

// Writes the settings unless flash already holds the same record. Returns false only
// if the write failed, in which case the settings won't survive a reboot.
bool saveSettings(const Settings& settings);

// Actual flash writes since boot. Lets a test confirm that a slider burst saved
// once rather than once per update.
uint32_t settingsWriteCount();

}  // namespace Firewalker
