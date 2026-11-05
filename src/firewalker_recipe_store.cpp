#include "firewalker_recipe_store.h"

#include <Arduino.h>

#include "firewalker_recipe_upload.h"
#include "nvm3.h"
#include "nvm3_default.h"

namespace Firewalker {

// The keys just after the settings' 0xF100. The core's EEPROM emulation uses the lowest keys.
static constexpr nvm3_ObjectKey_t FIRST_RECIPE_KEY = 0xF110;

static nvm3_ObjectKey_t keyFor(uint8_t slot) { return FIRST_RECIPE_KEY + slot; }

void recipeStoreLoad(UploadedRecipe* slots, uint8_t count) {
  // Static, because this runs before the main loop has much stack to spare.
  static uint8_t bytes[RECIPE_MAX_BYTES];
  for (uint8_t slot = 0; slot < count; slot++) {
    slots[slot] = UploadedRecipe{};
    uint32_t objectType = 0;
    size_t size = 0;
    const Ecode_t info = nvm3_getObjectInfo(nvm3_defaultHandle, keyFor(slot), &objectType, &size);
    if (info == ECODE_NVM3_ERR_KEY_NOT_FOUND) continue;
    if (info != ECODE_NVM3_OK || size > sizeof(bytes) ||
        nvm3_readData(nvm3_defaultHandle, keyFor(slot), bytes, size) != ECODE_NVM3_OK ||
        !describeStoredRecipe(bytes, size, slots[slot])) {
      Serial.print(F("[firewalker] recipe slot "));
      Serial.print(slot);
      Serial.println(F(" is damaged, so it counts as empty"));
    }
  }
}

bool recipeStoreRead(uint8_t slot, uint8_t* out, size_t size) {
  return nvm3_readData(nvm3_defaultHandle, keyFor(slot), out, size) == ECODE_NVM3_OK;
}

bool recipeStoreWrite(uint8_t slot, const uint8_t* bytes, size_t size) {
  if (nvm3_writeData(nvm3_defaultHandle, keyFor(slot), bytes, size) != ECODE_NVM3_OK) return false;
  // Compacts old entries out of flash once they've built up. A failure here doesn't lose what was just
  // written, so it doesn't count as a failed save.
  if (nvm3_repackNeeded(nvm3_defaultHandle)) nvm3_repack(nvm3_defaultHandle);
  return true;
}

bool recipeStoreDelete(uint8_t slot) {
  const Ecode_t result = nvm3_deleteObject(nvm3_defaultHandle, keyFor(slot));
  return result == ECODE_NVM3_OK || result == ECODE_NVM3_ERR_KEY_NOT_FOUND;
}

}  // namespace Firewalker
