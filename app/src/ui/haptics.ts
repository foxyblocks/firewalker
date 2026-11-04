import { Haptics, NotificationType } from "@capacitor/haptics";

/**
 * A buzz at the end of a capture, so you can hold a pose without watching the phone.
 * It's only a nicety, so anything that goes wrong here stays quiet.
 */
export function buzz(outcome: "success" | "failure"): void {
  const type = outcome === "success" ? NotificationType.Success : NotificationType.Error;
  void Haptics.notification({ type }).catch(() => undefined);
}
