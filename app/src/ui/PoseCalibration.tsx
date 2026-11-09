/**
 * The Poses sheet opened from one boot's Configuration. It teaches how your foot moves:
 * neutral, then heel down, then toe down. It's meant to be done wearing the boots. The
 * firmware does the capture and keeps the results, so this only walks you through it and shows
 * the outcome. It only ever talks to the one boot it's given.
 *
 * Tapping Capture starts a short countdown so you can settle into the pose with the phone
 * still in your hand, and a buzz at the end means you don't need to watch the screen. The
 * firmware then collects for two seconds and finds the pose in whatever your foot did, so
 * a wobble doesn't fail it (OrientationCalibrator in include/firewalker_orientation.h). Any pose can be
 * tapped to retake it, and heel and toe can be skipped. Neutral alone doesn't tell the boot
 * which way the foot points, so until heel or toe is saved too, a line under the list asks for
 * one (`orientationCalibrated` in the status line).
 *
 * A saved row has a small clear icon inside its right edge. Heel and toe clear separately;
 * clearing neutral resets all poses because it anchors the side poses. BootClient confirms the
 * saved change before the icon disappears. Strip and audio settings stay put.
 *
 * A countdown, capture, or clear reports `onBusy`, so the screen can hold its navigation and
 * side buttons still until it ends.
 */

import { useEffect, useRef, useState } from "react";
import type { BootClient, CaptureResult } from "../core/boot";
import { failureMessage, POSE_INSTRUCTIONS, POSE_NAMES } from "../core/calibration";
import { ORIENTATION_PROTOCOL_VERSION, type CalibrationClearTarget, type Pose, type StatusReply } from "../core/protocol";
import { orientationCalibratedOf } from "./bootFacts";
import { Button } from "./components/Button";
import { Notice } from "./components/Notice";
import { PoseList, PoseRow, type PoseStatus } from "./components/PoseRow";
import { TiltStrip } from "./components/TiltStrip";
import { buzz } from "./haptics";

const COUNTDOWN_SECONDS = 3;
const TILT_REFRESH_MS = 500;
const POSES: Pose[] = ["neutral", "heel", "toe"];

type Phase =
  | { kind: "ready" }
  | { kind: "countdown"; seconds: number }
  | { kind: "capturing" }
  | { kind: "clearing"; target: CalibrationClearTarget };

const clearTargetFor = (pose: Pose): CalibrationClearTarget => (pose === "neutral" ? "all" : pose);

export function PoseCalibration({
  client,
  name,
  onBusy,
}: {
  client: BootClient;
  /** The boot's name, for messages. */
  name: string;
  onBusy: (busy: boolean) => void;
}) {
  const state = client.getState();
  const status = state.status;
  const online = state.link === "online";
  const supportsOrientation = (status?.proto ?? 0) >= ORIENTATION_PROTOCOL_VERSION;
  // Start at the first pose the boot doesn't have, or past the end when it has them all.
  const [index, setIndex] = useState(() => firstUnset(status));
  const [phase, setPhase] = useState<Phase>({ kind: "ready" });
  const [results, setResults] = useState<Partial<Record<Pose, CaptureResult>>>({});
  const [message, setMessage] = useState<{ tone: "info" | "bad"; text: string }>();
  const countdownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const primaryAction = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const mounted = useRef(true);

  const pose = POSES[index];
  const done = pose === undefined;
  const busy = phase.kind !== "ready";

  useEffect(() => client.watchTilt(TILT_REFRESH_MS), [client]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (countdownTimer.current) clearTimeout(countdownTimer.current);
    };
  }, []);
  useEffect(() => onBusy(busy), [busy, onBusy]);
  // Leaving mid-countdown would otherwise leave the screen locked.
  useEffect(() => () => onBusy(false), [onBusy]);

  // A successful clear removes its focused icon. Return keyboard focus to Capture
  // so the next step remains reachable without starting over at the top.
  useEffect(() => {
    if (!returnFocus.current || busy) return;
    returnFocus.current = false;
    if (document.activeElement && document.activeElement !== document.body) return;
    primaryAction.current?.focus();
  }, [busy]);

  const capture = async (current: Pose) => {
    setMessage(undefined);
    setPhase({ kind: "capturing" });
    const result = await client.calibrate(current);
    if (!mounted.current) return;
    // A new neutral replaces the reference the side poses were measured against, so the
    // firmware drops them. Forget this tab's results for them too, and let status speak.
    setResults((previous) =>
      result.ok && current === "neutral" ? { neutral: result } : { ...previous, [current]: result },
    );
    buzz(result.ok ? "success" : "failure");
    setPhase({ kind: "ready" });
    if (result.ok) setIndex(POSES.indexOf(current) + 1);
  };

  // Clear the boot's saved data, then forget this tab's capture outcomes. Rows fall back to
  // the latest status, including when a clear fails, so a cached "Done" can't cover up what
  // is actually saved on the boot.
  const clear = async (target: CalibrationClearTarget) => {
    setMessage(undefined);
    setPhase({ kind: "clearing", target });
    const result = await client.clearCalibration(target);
    if (!mounted.current) return;
    setResults({});
    buzz(result.ok ? "success" : "failure");
    if (result.ok) {
      // Read the confirmed result rather than the render that began this clear.
      // A default range only works while the other side still defines the foot's axis.
      const stillOriented = orientationCalibratedOf(client.getState().status) === true;
      setMessage({
        tone: "info",
        text:
          target === "all"
            ? "Poses reset. Capture neutral to start again."
            : stillOriented
              ? `${POSE_NAMES[target]} cleared. Capture it again, or the boot uses its default range.`
              : `${POSE_NAMES[target]} cleared. Capture heel or toe to make tilt active again.`,
      });
      if (target === "all") setIndex(0);
      else if (done) setIndex(POSES.indexOf(target));
      returnFocus.current = true;
    } else {
      setMessage({ tone: "bad", text: failureMessage(result.reason) });
    }
    setPhase({ kind: "ready" });
  };

  const startCountdown = (current: Pose, seconds: number) => {
    if (seconds === 0) {
      countdownTimer.current = null;
      void capture(current);
      return;
    }
    setPhase({ kind: "countdown", seconds });
    countdownTimer.current = setTimeout(() => startCountdown(current, seconds - 1), 1000);
  };

  if (!status) return <Notice>Waiting for {name}'s first report.</Notice>;
  if (status.sensor !== "ok") {
    return <Notice tone="warn">{name}'s motion sensor isn't available, so it can't take poses. Its strip can still be set.</Notice>;
  }

  const rowStatus = (candidate: Pose): PoseStatus => {
    if (phase.kind === "capturing" && candidate === pose) return "capturing";
    const result = results[candidate];
    if (result && !result.ok) return "failed";
    if (result?.ok) return "done";
    return savedAngle(status, candidate) !== undefined ? "saved" : "unset";
  };
  const needsSidePose = status.calibrated && orientationCalibratedOf(status) === false;

  return (
    <div className="stack">
      {!supportsOrientation && <Notice tone="warn">{failureMessage("orientation-update-required")}</Notice>}
      {supportsOrientation && <p className="help-text">
        {done
          ? "All poses are saved on the boot. Rock your foot and watch the lights follow. Tap a pose to retake it."
          : `Step ${index + 1} of ${POSES.length}. ${POSE_INSTRUCTIONS[pose]}`}
      </p>}

      <PoseList label={`${name} poses`}>
        {POSES.map((candidate, position) => {
          const result = results[candidate];
          const saved = savedAngle(status, candidate);
          const target = clearTargetFor(candidate);
          return (
            <PoseRow
              key={candidate}
              name={POSE_NAMES[candidate]}
              status={rowStatus(candidate)}
              degrees={result?.ok ? result.angleDeg : saved}
              active={position === index}
              disabled={busy}
              failure={result && !result.ok ? `${failureMessage(result.reason)} Previous calibration kept.` : undefined}
              onSelect={() => {
                setMessage(undefined);
                setIndex(position);
              }}
              onClear={saved !== undefined ? () => void clear(target) : undefined}
              clearLabel={clearLabel(candidate, online ? undefined : "needs a connection")}
              clearDisabled={busy || !online}
              clearing={phase.kind === "clearing" && phase.target === target}
            />
          );
        })}
      </PoseList>

      {needsSidePose && (
        <p className="help-text help-small">Capture heel or toe too. Neutral alone doesn't tell the boot which way your foot points.</p>
      )}
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {!online && <Notice>Waiting for {name} to reconnect. Captures need a live connection.</Notice>}

      <div className="strip-block">
        <TiltStrip tilt={status.tilt} />
        <div className="strip-ends">
          <span>Heel</span>
          <span>Neutral</span>
          <span>Toe</span>
        </div>
      </div>

      {!done && (
        <>
          <Button
            ref={primaryAction}
            variant="primary"
            wide
            className={phase.kind === "capturing" ? "button-capturing" : undefined}
            disabled={busy || !online || !supportsOrientation}
            onClick={() => startCountdown(pose, COUNTDOWN_SECONDS)}
          >
            {!supportsOrientation
              ? "Update firmware to capture"
              : phase.kind === "countdown"
              ? `Hold it in ${phase.seconds}`
              : phase.kind === "capturing"
                ? "Stay there"
                : phase.kind === "clearing"
                  ? "Clearing"
                  : `Capture ${POSE_NAMES[pose].toLowerCase()}`}
          </Button>
          {pose !== "neutral" && (
            <div className="sheet-foot">
              <button type="button" className="link" disabled={busy} onClick={() => setIndex(index + 1)}>
                Skip this pose
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function clearLabel(pose: Pose, unavailable?: string): string {
  const action = pose === "neutral" ? "Clear neutral and all poses" : `Clear ${POSE_NAMES[pose].toLowerCase()}`;
  return unavailable ? `${action} (${unavailable})` : action;
}

function firstUnset(status: StatusReply | undefined): number {
  if (!status) return 0;
  const missing = POSES.findIndex((pose) => savedAngle(status, pose) === undefined);
  return missing === -1 ? POSES.length : missing;
}

function savedAngle(status: StatusReply | undefined, pose: Pose): number | undefined {
  if (!status) return undefined;
  if (pose === "neutral") return status.calibrated ? status.neutralDeg : undefined;
  return (pose === "heel" ? status.heelDeg : status.toeDeg) ?? undefined;
}
