#pragma once

// The firmware's two control channels behind one line-based interface: the USB
// serial console, always on, and a BLE service in builds with the Bluetooth stack.
// Commands from either channel come out of remoteNextLine(), and remoteSend() answers
// on both. The commands and replies are in firewalker_remote_protocol.h and
// docs/remote-protocol.md. Only the app handles commands; this module just moves lines.
//
// The BLE service uses the Nordic UART Service UUIDs, so generic BLE terminals can
// talk to a shoe too: a client writes one command per write to the RX characteristic,
// and receives newline-terminated replies as TX notifications. A reply longer than a
// notification is split across several, so clients join them until the newline.

#include <stddef.h>

namespace Firewalker {

// Starts the channels. BLE advertises as Firewalker-XXXX, using this controller's id.
void remoteBegin();

// Copies the next received command line into `out`, returning false if there is none.
// A line too long for `out` comes back at full length, so the parser rejects it.
bool remoteNextLine(char* out, size_t size);

// How urgently a line needs to arrive. Motion lines are the first to be dropped when
// BLE falls behind, which keeps replies flowing and memory bounded.
enum class RemotePriority : unsigned char { Reply, Telemetry };

// Sends one line on both channels; the newline is added here. Doesn't wait for BLE,
// which sends from a queue in remoteUpdate().
void remoteSend(const char* line, RemotePriority priority = RemotePriority::Reply);

// Sends queued BLE data, a little at a time so it can't hold up the main loop.
void remoteUpdate();

// True when a BLE client has connected and subscribed to replies.
bool remoteBleConnected();

// True once each time a client newly subscribes, so the app can report its current
// state to a reconnecting phone without being asked.
bool remoteTakeClientReady();

// Four hex digits identifying this controller, unique enough to tell two shoes apart.
const char* remoteDeviceId();

}  // namespace Firewalker
