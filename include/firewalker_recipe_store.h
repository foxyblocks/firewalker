#pragma once

// Keeps uploaded recipes in this controller's flash, using the same NVM3 store as its settings. Each
// recipe is one NVM3 entry, written whole, so a power cut during a save leaves the old recipe or the
// new one, never half of either. That's why a compiled recipe is limited to one entry's 254 bytes. The
// entries survive a firmware update. What makes a stored recipe usable is in firewalker_recipe_upload.h.

#include <stddef.h>
#include <stdint.h>

#include "firewalker_pattern_list.h"

namespace Firewalker {

// Reads every slot's description into `slots`, for the firmware to keep in RAM. A damaged entry reads
// as an empty slot, and gets logged. Call once at startup.
void recipeStoreLoad(UploadedRecipe* slots, uint8_t count);

// Reads a stored recipe's bytes. Returns false if it can't. `size` is what the slot's description says.
bool recipeStoreRead(uint8_t slot, uint8_t* out, size_t size);

// Each of these returns false if the write failed, which leaves what was stored as it was.
bool recipeStoreWrite(uint8_t slot, const uint8_t* bytes, size_t size);
bool recipeStoreDelete(uint8_t slot);

}  // namespace Firewalker
