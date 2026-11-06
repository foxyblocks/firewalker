/**
 * The Calibrate sheet, with pose, strip, and audio calibration tabs. Poses teaches a boot how your foot moves,
 * and it's the flow below. StripSetup maps its pixels, and AudioSetup handles saved
 * microphone tuning.
 *
 * The poses flow is meant to be done wearing the boots: neutral, then heel down, then toe
 * down. The firmware does the capture and keeps the results, so this only walks you through
 * it and shows each boot's outcome.
 *
 * Tapping Capture starts a short countdown so you can settle into the pose with the phone
 * still in your hand, and a buzz at the end means you don't need to watch the screen. The
 * firmware then collects for two seconds and finds the pose in whatever your foot did, so
 * a wobble doesn't fail it (PoseCapture in include/firewalker_calibration.h).
 * Any step can be tapped to retake it, and heel and toe can be skipped, since the firmware
 * falls back to a default range for a side with no captured pose.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { CaptureResult } from "../core/boot";
import type { BootsStore, Side } from "../core/boots";
import { calibrationSteps, failureMessage, POSE_INSTRUCTIONS, POSE_NAMES, type CalibrationStep } from "../core/calibration";
import type { Pose, StatusReply } from "../core/protocol";
import { buzz } from "./haptics";
import { joinNames, TiltStrip } from "./parts";
import { StripSetup } from "./StripSetup";
import { AudioSetup } from "./AudioSetup";

const COUNTDOWN_SECONDS = 3;
const TILT_REFRESH_MS = 500;

type Phase = { kind: "ready" } | { kind: "countdown"; seconds: number } | { kind: "capturing" };

const resultKey = (side: Side, pose: Pose) => `${side}:${pose}`;

type Tab = "poses" | "strip" | "audio";
const TABS: { id: Tab; name: string }[] = [
  { id: "poses", name: "Poses" },
  { id: "strip", name: "Strip" },
  { id: "audio", name: "Audio" },
];

export function CalibrateSheet({ store, onClose }: { store: BootsStore; onClose: () => void }) {
  // The plan is fixed when the sheet opens, so a boot dropping mid-flow can't reorder it.
  const [poseSides] = useState(() => store.calibrationSides());
  // A boot with no working sensor can't take poses, but it can still set its strip.
  const [tab, setTab] = useState<Tab>(poseSides.length > 0 ? "poses" : "strip");
  // A capture in progress holds the tabs, because leaving would lose sight of its result.
  const [capturing, setCapturing] = useState(false);
  const sides = tab === "poses" ? poseSides : store.targetSides();
  const title =
    sides.length > 1 ? "Calibrate both" : `Calibrate ${joinNames(sides.map((side) => store.displayName(side)))}`;

  return (
    <div className="sheet-backdrop">
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="screen-title">{title}</h2>
        <div className="tabs tabs-sheet" role="tablist" aria-label="What to calibrate">
          {TABS.map(({ id, name }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`tab${tab === id ? " tab-on" : ""}`}
              disabled={capturing || (id === "poses" && poseSides.length === 0)}
              onClick={() => setTab(id)}
            >
              <span className="tab-name">{name}</span>
            </button>
          ))}
        </div>
        {tab === "poses" ? (
          <PoseSteps store={store} sides={poseSides} onBusy={setCapturing} onClose={onClose} />
        ) : tab === "audio" ? (
          <AudioSetup store={store} onBusy={setCapturing} onClose={onClose} />
        ) : (
          <StripSetup store={store} onClose={onClose} />
        )}
      </section>
    </div>
  );
}

function PoseSteps({
  store,
  sides,
  onBusy,
  onClose,
}: {
  store: BootsStore;
  sides: Side[];
  onBusy: (busy: boolean) => void;
  onClose: () => void;
}) {
  const multiple = sides.length > 1;
  const steps = useMemo(() => calibrationSteps(sides), [sides]);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: "ready" });
  const [results, setResults] = useState<Record<string, CaptureResult>>({});
  const countdownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const step = steps[index];
  const done = !step;
  const watchedSide = step?.sides[0];
  const watched = watchedSide ? store.client(watchedSide) : undefined;

  useEffect(() => watched?.watchTilt(TILT_REFRESH_MS), [watched]);
  useEffect(() => () => {
    if (countdownTimer.current) clearTimeout(countdownTimer.current);
  }, []);

  const capture = async (current: CalibrationStep) => {
    setPhase({ kind: "capturing" });
    const outcomes = await Promise.all(
      current.sides.map(async (side) => {
        const client = store.client(side);
        const result: CaptureResult = client
          ? await client.calibrate(current.pose)
          : { ok: false, pose: current.pose, reason: "offline" };
        return [side, result] as const;
      }),
    );

    setResults((previous) => {
      const next = { ...previous };
      for (const [side, result] of outcomes) next[resultKey(side, current.pose)] = result;
      return next;
    });
    const allGood = outcomes.every(([, result]) => result.ok);
    buzz(allGood ? "success" : "failure");
    setPhase({ kind: "ready" });
    if (allGood) setIndex((value) => value + 1);
  };

  const startCountdown = (current: CalibrationStep, seconds: number) => {
    if (seconds === 0) {
      void capture(current);
      return;
    }
    setPhase({ kind: "countdown", seconds });
    countdownTimer.current = setTimeout(() => startCountdown(current, seconds - 1), 1000);
  };

  const stepName = (candidate: CalibrationStep) => {
    if (!multiple) return POSE_NAMES[candidate.pose];
    const who = candidate.sides.length > 1 ? "both" : store.displayName(candidate.sides[0]!);
    return candidate.pose === "neutral" ? `Neutral, ${who}` : `${who}: ${POSE_NAMES[candidate.pose].toLowerCase()}`;
  };

  const liveTilt = watched?.getState().status?.tilt ?? 0;
  const busy = phase.kind !== "ready";
  useEffect(() => onBusy(busy), [busy, onBusy]);

  return (
    <>
      <p className="sheet-help">
        {done
          ? "All done, and saved on the boot. Rock your foot and watch the lights follow."
          : `Step ${index + 1} of ${steps.length}. ${POSE_INSTRUCTIONS[step.pose]}`}
      </p>

      <ol className="steps">
        {steps.map((candidate, position) => (
          <StepRow
            key={stepName(candidate)}
            name={stepName(candidate)}
            active={position === index}
            disabled={busy}
            outcomes={candidate.sides.map((side) => ({
              side,
              name: store.displayName(side),
              result: results[resultKey(side, candidate.pose)],
              saved: savedAngle(store.client(side)?.getState().status, candidate.pose),
            }))}
            capturing={position === index && phase.kind === "capturing"}
            onSelect={() => setIndex(position)}
          />
        ))}
      </ol>

      <div className="strip-block">
        <TiltStrip tilt={liveTilt} />
        <div className="strip-ends">
          <span>Heel</span>
          <span>Neutral</span>
          <span>Toe</span>
        </div>
      </div>

      {done ? (
        <button type="button" className="button button-primary button-wide" onClick={onClose}>
          Done
        </button>
      ) : (
        <>
          <button
            type="button"
            className={`button button-primary button-wide${phase.kind === "capturing" ? " button-capturing" : ""}`}
            disabled={busy}
            onClick={() => startCountdown(step, COUNTDOWN_SECONDS)}
          >
            {phase.kind === "countdown"
              ? `Hold it in ${phase.seconds}`
              : phase.kind === "capturing"
                ? "Stay there"
                : `Capture ${POSE_NAMES[step.pose].toLowerCase()}`}
          </button>
          <div className="sheet-foot">
            {step.pose !== "neutral" && (
              <button type="button" className="link" disabled={busy} onClick={() => setIndex(index + 1)}>
                Skip this pose
              </button>
            )}
            <button type="button" className="link" disabled={busy} onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </>
  );
}

function savedAngle(status: StatusReply | undefined, pose: Pose): number | undefined {
  if (!status) return undefined;
  if (pose === "neutral") return status.calibrated ? status.neutralDeg : undefined;
  return (pose === "heel" ? status.heelDeg : status.toeDeg) ?? undefined;
}

function StepRow({
  name,
  active,
  disabled,
  capturing,
  outcomes,
  onSelect,
}: {
  name: string;
  active: boolean;
  disabled: boolean;
  capturing: boolean;
  outcomes: { side: Side; name: string; result?: CaptureResult; saved?: number }[];
  onSelect: () => void;
}) {
  const failures = outcomes.flatMap((outcome) =>
    outcome.result && !outcome.result.ok ? [{ name: outcome.name, reason: outcome.result.reason }] : [],
  );
  const allDone = outcomes.every((outcome) => outcome.result?.ok);
  const firstResult = outcomes[0]?.result;
  const shared = outcomes.length > 1;

  let summary: string;
  if (capturing) summary = "Stay there";
  else if (failures.length > 0) summary = "Try again";
  else if (allDone && firstResult?.ok && !shared) summary = `Done, ${firstResult.angleDeg.toFixed(1)}°`;
  else if (allDone) summary = "Done";
  else if (!shared && outcomes[0]?.saved !== undefined) summary = `Saved, ${outcomes[0].saved.toFixed(1)}°`;
  else summary = active ? "Now" : "Next";

  const tone = failures.length > 0 ? " step-bad" : allDone ? " step-good" : active ? " step-active" : "";

  return (
    <li>
      <button type="button" className={`step${tone}`} disabled={disabled} aria-current={active} onClick={onSelect}>
        <span className="step-line">
          <span className="card-name">{name}</span>
          <span className="readout">{summary}</span>
        </span>
        {failures.map((failure) => (
          <span key={failure.name} className="step-failure">
            {shared ? `${failure.name}: ` : ""}
            {failureMessage(failure.reason)} Previous calibration kept.
          </span>
        ))}
      </button>
    </li>
  );
}
