#pragma once

#if defined(FIREWALKER_MODE_FSR_DEBUG)
#include "fsr_debug.h"
namespace ActiveMode = FsrDebugMode;
#elif defined(FIREWALKER_MODE_FINAL_APP)
#include "final_app.h"
namespace ActiveMode = FinalAppMode;
#elif defined(FIREWALKER_MODE_IMU_DEBUG)
#include "imu_debug.h"
namespace ActiveMode = ImuDebugMode;
#else
#error "Define one Firewalker mode: FIREWALKER_MODE_FINAL_APP, FIREWALKER_MODE_FSR_DEBUG, or FIREWALKER_MODE_IMU_DEBUG"
#endif
