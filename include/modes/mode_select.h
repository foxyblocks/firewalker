#pragma once

#if defined(FIREWALKER_MODE_FINAL_APP)
#include "final_app.h"
namespace ActiveMode = FinalAppMode;
#elif defined(FIREWALKER_MODE_IMU_DEBUG)
#include "imu_debug.h"
namespace ActiveMode = ImuDebugMode;
#elif defined(FIREWALKER_MODE_BENCH)
#include "bench.h"
namespace ActiveMode = BenchMode;
#else
#error "Define one Firewalker mode: FIREWALKER_MODE_FINAL_APP, FIREWALKER_MODE_IMU_DEBUG, or FIREWALKER_MODE_BENCH"
#endif
