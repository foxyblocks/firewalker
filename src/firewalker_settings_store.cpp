#include "firewalker_settings_store.h"

#include <Arduino.h>
#include <string.h>

#include "nvm3.h"
#include "nvm3_default.h"

namespace Firewalker {

// Keys below 0x10000 are the application's. The core's EEPROM emulation uses the
// lowest keys, so this sits well above those.
static constexpr nvm3_ObjectKey_t SETTINGS_KEY = 0xF100;

static uint32_t writeCount = 0;

const char* loadSettings(const SettingsBounds& bounds, Settings& out) {
  uint32_t objectType = 0;
  size_t objectSize = 0;
  const Ecode_t info = nvm3_getObjectInfo(nvm3_defaultHandle, SETTINGS_KEY, &objectType, &objectSize);
  if (info == ECODE_NVM3_ERR_KEY_NOT_FOUND) return "absent";
  if (info != ECODE_NVM3_OK) return "read-failed";

  SettingsDecode decoded;
  if (objectSize == sizeof(SettingsRecord)) {
    SettingsRecord record;
    if (nvm3_readData(nvm3_defaultHandle, SETTINGS_KEY, &record, sizeof(record)) != ECODE_NVM3_OK) {
      return "read-failed";
    }
    decoded = decodeSettings(record, bounds, out);
  } else if (objectSize == sizeof(SettingsRecordV2)) {
    SettingsRecordV2 record;
    if (nvm3_readData(nvm3_defaultHandle, SETTINGS_KEY, &record, sizeof(record)) != ECODE_NVM3_OK) {
      return "read-failed";
    }
    decoded = decodeSettingsV2(record, bounds, out);
  } else {
    // A record from a firmware with a different layout can't be read into this one.
    return "unsupported";
  }

  switch (decoded) {
    case SettingsDecode::Ok: return "loaded";
    case SettingsDecode::Corrupt: return "corrupt";
    case SettingsDecode::Unsupported: return "unsupported";
    case SettingsDecode::Invalid: return "invalid";
  }
  return "invalid";
}

bool saveSettings(const Settings& settings) {
  const SettingsRecord record = encodeSettings(settings);

  SettingsRecord existing;
  if (nvm3_readData(nvm3_defaultHandle, SETTINGS_KEY, &existing, sizeof(existing)) == ECODE_NVM3_OK &&
      memcmp(&existing, &record, sizeof(record)) == 0) {
    return true;
  }

  if (nvm3_writeData(nvm3_defaultHandle, SETTINGS_KEY, &record, sizeof(record)) != ECODE_NVM3_OK) {
    return false;
  }
  writeCount++;

  // Compacts old records out of flash once they've built up. A failure here doesn't
  // lose the record just written, so it doesn't count as a failed save.
  if (nvm3_repackNeeded(nvm3_defaultHandle)) nvm3_repack(nvm3_defaultHandle);
  return true;
}

uint32_t settingsWriteCount() { return writeCount; }

}  // namespace Firewalker
