#include "firewalker_remote.h"

#include <Arduino.h>
#include <stdio.h>
#include <string.h>

#include "config.h"
#include "firewalker_remote_protocol.h"

#if defined(ARDUINO_SILABS_STACK_BLE_SILABS)
#include "FreeRTOS.h"
#include "queue.h"
#include "sl_bluetooth.h"
#endif

namespace Firewalker {

static char deviceId[5] = "";

// The Bluetooth stack can boot before setup() runs, and its advertised name needs the
// id, so whichever side gets there first fills it in. The value never changes.
static const char* loadDeviceId() {
  if (deviceId[0] == '\0') {
    snprintf(deviceId, sizeof(deviceId), "%04X", (unsigned)(getDeviceUniqueId() & 0xFFFF));
  }
  return deviceId;
}

// ── USB console ──────────────────────────────────────────────────────────

// One extra byte beyond REMOTE_COMMAND_MAX lets an overlong line stay overlong after
// truncation, so the parser reports it rather than acting on the front half.
static char usbLine[REMOTE_COMMAND_MAX + 1];
static size_t usbLength = 0;

// Collects serial bytes until a line ends. Returns true when `usbLine` holds one. The core buffers only
// 32 received bytes until something reads them, and the main loop can be busy for longer than those take to
// arrive, so a longer line can lose characters. docs/remote-protocol.md tells clients to stay under that.
static bool readUsbLine() {
  while (Serial.available()) {
    const int byte = Serial.read();
    if (byte == '\n' || byte == '\r') {
      if (usbLength == 0) continue;  // the second half of a CRLF
      usbLine[usbLength] = '\0';
      usbLength = 0;
      return true;
    }
    if (usbLength < sizeof(usbLine) - 1) usbLine[usbLength++] = (char)byte;
  }
  return false;
}

// ── BLE service ──────────────────────────────────────────────────────────
#if defined(ARDUINO_SILABS_STACK_BLE_SILABS)

// Nordic UART Service, 6E400001-B5A3-F393-E0A9-E50E24DCCA9E. BLE stores UUIDs least
// significant byte first, so these read backwards.
#define NUS_UUID(id)                                                                        \
  {                                                                                         \
    .data = {                                                                               \
      0x9E, 0xCA, 0xDC, 0x24, 0x0E, 0xE5, 0xA9, 0xE0, 0x93, 0xF3, 0xA3, 0xB5, id, 0x00, 0x40, 0x6E \
    }                                                                                       \
  }
static const uuid_128 NUS_SERVICE_UUID = NUS_UUID(0x01);
static const uuid_128 NUS_RX_UUID = NUS_UUID(0x02);
static const uuid_128 NUS_TX_UUID = NUS_UUID(0x03);

// Advertising needs a name plus the service UUID, and together they overflow one
// packet. The UUID goes in the advertisement so apps can filter on it, and the name
// goes in the scan response.
static uint8_t advertisingSet = 0xFF;
static char deviceName[20];
static uint16_t txCharacteristic = 0;
static uint16_t rxCharacteristic = 0;

// sl_bt_on_event runs on the Bluetooth stack's task, so it hands commands to the main
// loop through this queue rather than touching app state.
struct RxLine {
  char text[REMOTE_COMMAND_MAX + 1];
};
static StaticQueue_t rxQueueStorage;
static uint8_t rxQueueBuffer[REMOTE_RX_QUEUE_DEPTH * sizeof(RxLine)];
static QueueHandle_t rxQueue = nullptr;

static volatile bool clientSubscribed = false;
static volatile bool clientReadyPending = false;
static volatile uint16_t attMtu = 23;

// Reply bytes waiting to go out as notifications. A line is queued whole or not at
// all, so a client never sees half a line followed by the start of another.
static char txBuffer[REMOTE_TX_BUFFER_BYTES];
static size_t txHead = 0;
static size_t txCount = 0;

static void startAdvertising() {
  sl_status_t status;
  if (advertisingSet == 0xFF) {
    status = sl_bt_advertiser_create_set(&advertisingSet);
    app_assert_status(status);
    status = sl_bt_advertiser_set_timing(advertisingSet, REMOTE_ADVERTISE_INTERVAL, REMOTE_ADVERTISE_INTERVAL, 0, 0);
    app_assert_status(status);
  }

  uint8_t advertising[21] = {0x02, 0x01, 0x06, 0x11, 0x07};
  memcpy(&advertising[5], NUS_SERVICE_UUID.data, sizeof(NUS_SERVICE_UUID.data));
  status = sl_bt_legacy_advertiser_set_data(advertisingSet, sl_bt_advertiser_advertising_data_packet,
                                            sizeof(advertising), advertising);
  app_assert_status(status);

  uint8_t scanResponse[31];
  const size_t nameLength = strlen(deviceName);
  scanResponse[0] = (uint8_t)(nameLength + 1);
  scanResponse[1] = 0x09;  // complete local name
  memcpy(&scanResponse[2], deviceName, nameLength);
  status = sl_bt_legacy_advertiser_set_data(advertisingSet, sl_bt_advertiser_scan_response_packet,
                                            nameLength + 2, scanResponse);
  app_assert_status(status);

  status = sl_bt_legacy_advertiser_start(advertisingSet, sl_bt_advertiser_connectable_scannable);
  app_assert_status(status);
}

static void buildGattDatabase() {
  uint16_t session;
  uint16_t service;
  uint16_t characteristic;
  sl_status_t status = sl_bt_gattdb_new_session(&session);
  app_assert_status(status);

  const uint8_t genericAccessUuid[] = {0x00, 0x18};
  status = sl_bt_gattdb_add_service(session, sl_bt_gattdb_primary_service, 0,
                                    sizeof(genericAccessUuid), genericAccessUuid, &service);
  app_assert_status(status);
  const sl_bt_uuid_16_t deviceNameUuid = {.data = {0x00, 0x2A}};
  status = sl_bt_gattdb_add_uuid16_characteristic(
      session, service, SL_BT_GATTDB_CHARACTERISTIC_READ, 0, 0, deviceNameUuid,
      sl_bt_gattdb_fixed_length_value, strlen(deviceName), strlen(deviceName),
      (const uint8_t*)deviceName, &characteristic);
  app_assert_status(status);
  status = sl_bt_gattdb_start_service(session, service);
  app_assert_status(status);

  status = sl_bt_gattdb_add_service(session, sl_bt_gattdb_primary_service,
                                    SL_BT_GATTDB_ADVERTISED_SERVICE,
                                    sizeof(NUS_SERVICE_UUID.data), NUS_SERVICE_UUID.data, &service);
  app_assert_status(status);
  status = sl_bt_gattdb_add_uuid128_characteristic(
      session, service, SL_BT_GATTDB_CHARACTERISTIC_WRITE | SL_BT_GATTDB_CHARACTERISTIC_WRITE_NO_RESPONSE,
      0, 0, NUS_RX_UUID, sl_bt_gattdb_variable_length_value, REMOTE_COMMAND_MAX, 0, nullptr,
      &rxCharacteristic);
  app_assert_status(status);
  status = sl_bt_gattdb_add_uuid128_characteristic(
      session, service, SL_BT_GATTDB_CHARACTERISTIC_NOTIFY, 0, 0, NUS_TX_UUID,
      sl_bt_gattdb_variable_length_value, REMOTE_ATT_VALUE_MAX, 0, nullptr, &txCharacteristic);
  app_assert_status(status);
  status = sl_bt_gattdb_start_service(session, service);
  app_assert_status(status);
  status = sl_bt_gattdb_commit(session);
  app_assert_status(status);
}

// Queues one newline-terminated line, or drops it if it can't fit whole. Telemetry
// only uses the first half of the buffer, so it can never crowd out a reply.
static void queueForBle(const char* line, RemotePriority priority) {
  if (!clientSubscribed) return;
  const size_t length = strlen(line) + 1;
  const size_t limit =
      (priority == RemotePriority::Telemetry) ? sizeof(txBuffer) / 2 : sizeof(txBuffer);
  if (txCount + length > limit) return;

  size_t tail = (txHead + txCount) % sizeof(txBuffer);
  for (size_t i = 0; i < length; i++) {
    txBuffer[tail] = (i == length - 1) ? '\n' : line[i];
    tail = (tail + 1) % sizeof(txBuffer);
  }
  txCount += length;
}

static void sendQueuedBle() {
  if (!clientSubscribed) {
    txCount = 0;
    return;
  }
  for (uint8_t sent = 0; sent < REMOTE_NOTIFICATIONS_PER_LOOP && txCount > 0; sent++) {
    // A notification carries the ATT MTU minus its 3-byte header, and it can't wrap
    // around the end of the ring buffer.
    size_t chunk = attMtu - 3;
    if (chunk > REMOTE_ATT_VALUE_MAX) chunk = REMOTE_ATT_VALUE_MAX;
    if (chunk > txCount) chunk = txCount;
    if (chunk > sizeof(txBuffer) - txHead) chunk = sizeof(txBuffer) - txHead;

    const sl_status_t status = sl_bt_gatt_server_notify_all(txCharacteristic, chunk, (const uint8_t*)&txBuffer[txHead]);
    if (status != SL_STATUS_OK) return;  // the stack's queue is full, so retry next loop
    txHead = (txHead + chunk) % sizeof(txBuffer);
    txCount -= chunk;
  }
}

}  // namespace Firewalker

// Called by the Bluetooth stack on its own task for every stack event.
void sl_bt_on_event(sl_bt_msg_t* event) {
  using namespace Firewalker;
  switch (SL_BT_MSG_ID(event->header)) {
    case sl_bt_evt_system_boot_id: {
      snprintf(deviceName, sizeof(deviceName), "Firewalker-%s", loadDeviceId());
      uint16_t grantedMtu;
      sl_bt_gatt_server_set_max_mtu(REMOTE_ATT_VALUE_MAX + 3, &grantedMtu);
      buildGattDatabase();
      startAdvertising();
      break;
    }

    case sl_bt_evt_connection_opened_id:
      attMtu = 23;
      break;

    case sl_bt_evt_gatt_mtu_exchanged_id:
      attMtu = event->data.evt_gatt_mtu_exchanged.mtu;
      break;

    case sl_bt_evt_connection_closed_id:
      clientSubscribed = false;
      startAdvertising();
      break;

    case sl_bt_evt_gatt_server_attribute_value_id: {
      const auto& written = event->data.evt_gatt_server_attribute_value;
      if (written.attribute != rxCharacteristic || !rxQueue) break;
      RxLine line;
      size_t length = written.value.len;
      if (length > sizeof(line.text) - 1) length = sizeof(line.text) - 1;
      memcpy(line.text, written.value.data, length);
      line.text[length] = '\0';
      // A full queue drops this command, which keeps a flood of writes bounded.
      xQueueSend(rxQueue, &line, 0);
      break;
    }

    case sl_bt_evt_gatt_server_characteristic_status_id: {
      const auto& changed = event->data.evt_gatt_server_characteristic_status;
      if (changed.characteristic != txCharacteristic ||
          changed.status_flags != sl_bt_gatt_server_client_config) {
        break;
      }
      clientSubscribed = (changed.client_config_flags & sl_bt_gatt_notification) != 0;
      if (clientSubscribed) clientReadyPending = true;
      break;
    }

    default:
      break;
  }
}

namespace Firewalker {
#endif  // ARDUINO_SILABS_STACK_BLE_SILABS

// ── Shared interface ─────────────────────────────────────────────────────

void remoteBegin() {
  loadDeviceId();
#if defined(ARDUINO_SILABS_STACK_BLE_SILABS)
  rxQueue = xQueueCreateStatic(REMOTE_RX_QUEUE_DEPTH, sizeof(RxLine), rxQueueBuffer, &rxQueueStorage);
#endif
}

bool remoteNextLine(char* out, size_t size) {
#if defined(ARDUINO_SILABS_STACK_BLE_SILABS)
  RxLine line;
  if (rxQueue && xQueueReceive(rxQueue, &line, 0) == pdTRUE) {
    strncpy(out, line.text, size - 1);
    out[size - 1] = '\0';
    return true;
  }
#endif
  if (readUsbLine()) {
    strncpy(out, usbLine, size - 1);
    out[size - 1] = '\0';
    return true;
  }
  return false;
}

void remoteSend(const char* line, RemotePriority priority) {
  Serial.println(line);
#if defined(ARDUINO_SILABS_STACK_BLE_SILABS)
  queueForBle(line, priority);
#else
  (void)priority;
#endif
}

void remoteUpdate() {
#if defined(ARDUINO_SILABS_STACK_BLE_SILABS)
  sendQueuedBle();
#endif
}

bool remoteBleConnected() {
#if defined(ARDUINO_SILABS_STACK_BLE_SILABS)
  return clientSubscribed;
#else
  return false;
#endif
}

bool remoteTakeClientReady() {
#if defined(ARDUINO_SILABS_STACK_BLE_SILABS)
  if (!clientReadyPending) return false;
  clientReadyPending = false;
  return true;
#else
  return false;
#endif
}

const char* remoteDeviceId() { return loadDeviceId(); }

}  // namespace Firewalker
